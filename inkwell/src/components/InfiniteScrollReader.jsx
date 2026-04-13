import React, {
  useEffect, useRef, useState, useCallback, useMemo, forwardRef, useImperativeHandle
} from 'react';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// ─── Constants ─────────────────────────────────────────────────────────────
const PAGE_GAP = 16;          // gap between pages in px
const RENDER_BUFFER = 2;      // pages to render ahead/behind the viewport window
const OVERSCAN = 3;           // total overscan (pages kept mounted outside viewport)
const PDF_OPTIONS = {
  cMapUrl: '/cmaps/',
  cMapPacked: true,
  standardFontDataUrl: '/standard_fonts/'
};

// ─── Single Page Renderer ───────────────────────────────────────────────────
// Renders one page onto a canvas with a text layer overlay.
const PageCanvas = React.memo(({ pdf, pageNum, scale, showGlow }) => {
  const canvasRef = useRef(null);
  const wrapperRef = useRef(null);
  const renderTaskRef = useRef(null);
  const [dim, setDim] = useState({ width: 612, height: 792 });
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    let active = true;

    const render = async () => {
      if (!pdf || !canvasRef.current) return;
      try {
        const page = await pdf.getPage(pageNum);
        if (!active) return;

        const stdViewport = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale });
        const dpr = window.devicePixelRatio || 1;
        const w = Math.floor(viewport.width);
        const h = Math.floor(viewport.height);

        setDim({ width: w, height: h });

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        ctx.scale(dpr, dpr);

        if (renderTaskRef.current) {
          renderTaskRef.current.cancel();
          await renderTaskRef.current.promise.catch(() => {});
        }

        renderTaskRef.current = page.render({ canvasContext: ctx, viewport });
        await renderTaskRef.current.promise;
        if (!active) return;
        setRendered(true);

        // ── Text Layer ──
        const textContent = await page.getTextContent();
        const wrapper = wrapperRef.current;
        if (!wrapper) return;

        wrapper.querySelectorAll('.textLayer').forEach(el => el.remove());
        const textDiv = document.createElement('div');
        textDiv.className = 'textLayer';
        textDiv.style.cssText = `
          position: absolute; top: 0; left: 0;
          width: ${w}px; height: ${h}px;
          pointer-events: auto; overflow: hidden;
        `;
        wrapper.appendChild(textDiv);

        const measureCanvas = document.createElement('canvas');
        const measureCtx = measureCanvas.getContext('2d');

        textContent.items.forEach(item => {
          if (!item.str || item.str.trim() === '') return;
          const span = document.createElement('span');
          span.textContent = item.str + (item.hasEOL ? '\n' : '');
          const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
          const fontHeight = Math.sqrt(tx[2] ** 2 + tx[3] ** 2);
          const fontAscent = fontHeight * 0.85;
          const targetWidth = item.width * viewport.scale;
          span.style.cssText = `
            position: absolute;
            left: ${tx[4]}px; top: ${tx[5] - fontAscent}px;
            font-size: ${fontHeight}px; font-family: serif, sans-serif;
            color: transparent; white-space: pre; line-height: 1;
            transform-origin: 0 0; cursor: text;
          `;
          measureCtx.font = `${fontHeight}px serif`;
          const measuredWidth = measureCtx.measureText(item.str).width;
          if (measuredWidth > 0 && targetWidth > 0) {
            span.style.transform = `scaleX(${targetWidth / measuredWidth})`;
          }
          textDiv.appendChild(span);
        });
      } catch (err) {
        if (err.name !== 'RenderingCancelledException') {
          console.error(`Page ${pageNum} render error:`, err);
        }
      }
    };

    render();
    return () => {
      active = false;
      renderTaskRef.current?.cancel();
    };
  }, [pdf, pageNum, scale]);

  return (
    <div
      ref={wrapperRef}
      className="isr-page-wrapper"
      style={{
        position: 'relative',
        width: `${dim.width}px`,
        height: `${dim.height}px`,
        borderRadius: 'var(--radius-sm)',
        boxShadow: showGlow ? 'var(--shadow-4)' : 'none',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      {/* Skeleton shown until rendered */}
      {!rendered && (
        <div
          className="skeleton"
          style={{ position: 'absolute', inset: 0, borderRadius: 'var(--radius-sm)' }}
        />
      )}
      <canvas
        ref={canvasRef}
        style={{
          display: 'block',
          width: `${dim.width}px`,
          height: `${dim.height}px`,
          opacity: rendered ? 1 : 0,
          transition: 'opacity 0.2s ease',
        }}
      />
    </div>
  );
});

PageCanvas.displayName = 'PageCanvas';

// ─── Infinite Scroll Reader ─────────────────────────────────────────────────
// forwardRef so parent can call scrollToPage(n) imperatively.
const InfiniteScrollReader = React.memo(forwardRef(({
  filePath, scale, showGlow, onPageChange, onTotalPages, filter
}, ref) => {
  const [pdf, setPdf] = useState(null);
  const [totalPages, setTotalPages] = useState(0);
  const [error, setError] = useState(null);

  // visibleRange: the window of pages we keep mounted
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: OVERSCAN });

  const scrollContainerRef = useRef(null);
  const pageRefs = useRef([]); // array of refs to each page sentinel div
  const currentPageRef = useRef(1);
  const intersectingPages = useRef(new Set());

  // ── Load PDF ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let active = true;
    setPdf(null);
    setTotalPages(0);
    setError(null);
    setVisibleRange({ start: 0, end: OVERSCAN });

    const load = async () => {
      try {
        let loadingTask;
        if (filePath.startsWith('http') || filePath.startsWith('blob:')) {
          loadingTask = pdfjsLib.getDocument({ url: filePath, ...PDF_OPTIONS });
        } else {
          try {
            const { readFile } = await import('@tauri-apps/plugin-fs');
            const data = await readFile(filePath);
            loadingTask = pdfjsLib.getDocument({ data, ...PDF_OPTIONS });
          } catch (fsErr) {
            console.error('Tauri FS error:', fsErr);
            loadingTask = pdfjsLib.getDocument({ url: filePath, ...PDF_OPTIONS });
          }
        }
        const doc = await loadingTask.promise;
        if (!active) return;
        setPdf(doc);
        setTotalPages(doc.numPages);
        onTotalPages?.(doc.numPages);
      } catch (err) {
        if (active) setError(err.message || String(err));
      }
    };
    load();
    return () => { active = false; };
  }, [filePath]);

  // ── Scroll-to-page (exposed via ref) ──────────────────────────────────────
  const scrollToPage = useCallback((pageNum, behavior = 'smooth') => {
    const idx = pageNum - 1;
    const sentinel = pageRefs.current[idx];
    if (sentinel) {
      sentinel.scrollIntoView({ behavior, block: 'start' });
    } else {
      // page not mounted yet — expand range then scroll
      setVisibleRange(prev => ({
        start: Math.max(0, idx - RENDER_BUFFER),
        end: Math.min(totalPages - 1, idx + RENDER_BUFFER)
      }));
      // Give React a tick to mount the element, then scroll
      requestAnimationFrame(() => {
        setTimeout(() => {
          const el = pageRefs.current[idx];
          el?.scrollIntoView({ behavior, block: 'start' });
        }, 50);
      });
    }
  }, [totalPages]);

  useImperativeHandle(ref, () => ({ scrollToPage }), [scrollToPage]);

  // ── IntersectionObserver: track which pages are in viewport ───────────────
  useEffect(() => {
    if (!totalPages) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const idx = parseInt(entry.target.dataset.pageIdx, 10);
        if (entry.isIntersecting) {
          intersectingPages.current.add(idx);
        } else {
          intersectingPages.current.delete(idx);
        }
      });

      if (intersectingPages.current.size > 0) {
        const sorted = [...intersectingPages.current].sort((a, b) => a - b);
        const topPage = sorted[0];
        const newPage = topPage + 1;

        if (newPage !== currentPageRef.current) {
          currentPageRef.current = newPage;
          onPageChange?.(newPage);
        }

        // Expand render window to include buffer around visible pages
        const minVisible = sorted[0];
        const maxVisible = sorted[sorted.length - 1];
        const newStart = Math.max(0, minVisible - RENDER_BUFFER);
        const newEnd = Math.min(totalPages - 1, maxVisible + RENDER_BUFFER);

        setVisibleRange(prev => {
          if (prev.start !== newStart || prev.end !== newEnd) {
            return { start: newStart, end: newEnd };
          }
          return prev;
        });
      }
    }, {
      root: scrollContainerRef.current,
      rootMargin: '200px 0px',
      threshold: 0.01,
    });

    pageRefs.current.forEach((el) => {
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [totalPages, onPageChange]);

  // ── Ctrl+Wheel zoom pass-through is handled in ReaderView ─────────────────

  // ── Page index array ──────────────────────────────────────────────────────
  const pageIndices = useMemo(
    () => Array.from({ length: totalPages }, (_, i) => i),
    [totalPages]
  );

  if (error) {
    return (
      <div className="isr-error">
        <div className="pdf-error-card">
          <div className="pdf-error-icon">!</div>
          <p className="pdf-error-msg">PDF Load Error: {error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="isr-scroll-container" ref={scrollContainerRef}>
      <div className="isr-page-stack" style={{ filter }}>
        {pageIndices.map((idx) => {
          const pageNum = idx + 1;
          const inRange = idx >= visibleRange.start && idx <= visibleRange.end;

          return (
            <div
              key={idx}
              ref={el => { pageRefs.current[idx] = el; }}
              data-page-idx={idx}
              className="isr-page-sentinel"
              style={{ marginBottom: PAGE_GAP }}
            >
              {!pdf ? (
                // Skeleton before PDF is loaded
                <div className="skeleton isr-skeleton-page" />
              ) : inRange ? (
                <PageCanvas
                  pdf={pdf}
                  pageNum={pageNum}
                  scale={scale}
                  showGlow={showGlow}
                />
              ) : (
                // Placeholder for pages outside render window
                <PagePlaceholder pageNum={pageNum} scale={scale} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}));

InfiniteScrollReader.displayName = 'InfiniteScrollReader';

// ─── Page Placeholder ───────────────────────────────────────────────────────
// A sized but empty div shown for pages outside the render window.
// We use the standard A4 ratio (612:792) scaled.
const PagePlaceholder = React.memo(({ scale }) => {
  const w = Math.round(612 * scale);
  const h = Math.round(792 * scale);
  return (
    <div
      className="isr-page-placeholder"
      style={{ width: w, height: h }}
    />
  );
});
PagePlaceholder.displayName = 'PagePlaceholder';

export default InfiniteScrollReader;
