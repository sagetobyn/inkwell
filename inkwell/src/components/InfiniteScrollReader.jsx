import React, {
    useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo, forwardRef, useImperativeHandle
} from 'react';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { convertFileSrc } from '@tauri-apps/api/core';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
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
// Optimized with CSS scaling for intermediate zoom levels.
const PageCanvas = React.memo(({
    pdf, pageNum, scale, showGlow,
    originalWidth, originalHeight,
    originalOx, originalOy,
    onHighlightClick, selectedHighlight
}) => {
    const canvasRef = useRef(null);
    const wrapperRef = useRef(null);
    const textLayerRef = useRef(null);
    const annoLayerRef = useRef(null);
    const renderTaskRef = useRef(null);
    const [dim, setDim] = useState({ width: 612, height: 792 });
    const [rendered, setRendered] = useState(false);

    // renderedScale tracks the scale the canvas was actually drawn at.
    // We use this to apply CSS scaling while zooming.
    const [renderedScale, setRenderedScale] = useState(scale);
    const zoomDebounceRef = useRef(null);

    useEffect(() => {
        let active = true;

        const render = async (targetScale) => {
            if (!pdf || !canvasRef.current) return;
            try {
                const page = await pdf.getPage(pageNum);
                if (!active) return;

                const viewport = page.getViewport({ scale: targetScale });
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
                    await renderTaskRef.current.promise.catch(() => { });
                }

                renderTaskRef.current = page.render({ canvasContext: ctx, viewport });
                await renderTaskRef.current.promise;

                if (!active) return;
                setRendered(true);
                setRenderedScale(targetScale);

                // ── Text Layer ──
                const textContent = await page.getTextContent();
                const textLayer = textLayerRef.current;
                if (!textLayer) return;

                textLayer.innerHTML = '';
                textLayer.style.width = `${w}px`;
                textLayer.style.height = `${h}px`;

                const fragment = document.createDocumentFragment();
                const measureCanvas = document.createElement('canvas');
                const measureCtx = measureCanvas.getContext('2d');

                // --- PHASE 12: LOGICAL LINE GROUPING ---
                const items = textContent.items.filter(item => item.str && item.str.trim() !== '');
                const lines = [];
                const Y_THRESHOLD = 5;

                items.forEach(item => {
                    const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
                    const y = tx[5];
                    const fontHeight = Math.sqrt(tx[2] ** 2 + tx[3] ** 2);

                    let line = lines.find(l => Math.abs(l.y - y) < Y_THRESHOLD);
                    if (!line) {
                        line = { y, items: [], fontHeight };
                        lines.push(line);
                    }
                    line.items.push({ ...item, tx, fontHeight });
                    line.fontHeight = Math.max(line.fontHeight, fontHeight);
                });

                lines.sort((a, b) => a.y - b.y);

                lines.forEach((line, index) => {
                    const lineDiv = document.createElement('div');
                    lineDiv.className = 'textLayer-line';

                    const nextLine = lines[index + 1];
                    const lineTop = line.y - line.fontHeight * 0.8;
                    let lineHeightPx;

                    if (nextLine) {
                        const nextLineTop = nextLine.y - nextLine.fontHeight * 0.8;
                        lineHeightPx = Math.max(line.fontHeight * 1.2, nextLineTop - lineTop);
                    } else {
                        // Final line stretch to cover page bottom
                        const containerHeight = viewport.height;
                        lineHeightPx = Math.max(line.fontHeight * 1.5, containerHeight - lineTop);
                    }

                    lineDiv.style.cssText = `
            position: absolute; left: 0; width: 100%;
            top: ${lineTop}px;
            height: ${lineHeightPx}px;
            pointer-events: auto; user-select: text;
          `;

                    line.items.sort((a, b) => a.tx[4] - b.tx[4]).forEach(item => {
                        const span = document.createElement('span');
                        span.textContent = item.str + (item.hasEOL ? '\n' : '');

                        // --- ATTACH PDF COORDINATE METADATA ---
                        span.setAttribute('data-pdf-x', item.transform[4]);
                        span.setAttribute('data-pdf-y', item.transform[5]);
                        span.setAttribute('data-pdf-w', item.width);
                        span.setAttribute('data-pdf-h', item.transform[3]);
                        span.setAttribute('data-page', pageNum);

                        const itemTopOffset = item.tx[5] - item.fontHeight * 0.8;
                        span.style.cssText = `
              position: absolute;
              left: ${item.tx[4]}px; top: 0;
              height: 100%; padding-top: ${itemTopOffset - lineTop}px;
              box-sizing: border-box;
              font-size: ${item.fontHeight}px; font-family: serif, sans-serif;
              color: transparent; white-space: pre; line-height: 1;
              transform-origin: 0 0; cursor: text;
            `;

                        measureCtx.font = `${item.fontHeight}px serif`;
                        const targetWidth = item.width * viewport.scale;
                        const measuredWidth = measureCtx.measureText(item.str).width;
                        if (measuredWidth > 0 && targetWidth > 0) {
                            span.style.transform = `scaleX(${targetWidth / measuredWidth})`;
                        }
                        lineDiv.appendChild(span);
                    });
                    textLayer.appendChild(lineDiv);
                });

                // --- Phase 10: Annotation Layer (Interactive Highlights) ---
                const annots = await page.getAnnotations();
                const annoLayer = annoLayerRef.current;
                if (annoLayer && active) {
                    annoLayer.innerHTML = '';
                    annoLayer.style.width = `${w}px`;
                    annoLayer.style.height = `${h}px`;

                    annots.filter(a => a.subtype === 'Highlight').forEach(anno => {
                        const pdfRect = anno.rect; // [x1, y1, x2, y2]
                        const rect = viewport.convertToViewportRectangle(pdfRect);

                        const overlay = document.createElement('div');
                        overlay.className = 'pdf-anno-overlay';

                        const color = anno.color ? `rgba(${anno.color[0]}, ${anno.color[1]}, ${anno.color[2]}, 0.2)` : 'rgba(255, 226, 0, 0.2)';
                        overlay.style.position = 'absolute';
                        overlay.style.left = `${rect[0]}px`;
                        overlay.style.top = `${rect[1]}px`;
                        overlay.style.width = `${rect[2] - rect[0]}px`;
                        overlay.style.height = `${rect[3] - rect[1]}px`;
                        overlay.style.backgroundColor = color;
                        overlay.style.cursor = 'pointer';
                        overlay.style.pointerEvents = 'auto';
                        overlay.style.zIndex = '3';

                        const isSelected = selectedHighlight &&
                            selectedHighlight.page === pageNum &&
                            selectedHighlight.rect.every((v, i) => Math.abs(v - pdfRect[i]) < 0.1);

                        if (isSelected) overlay.classList.add('selected');

                        overlay.onclick = (e) => {
                            e.stopPropagation();
                            if (onHighlightClick) {
                                onHighlightClick({
                                    page: pageNum,
                                    rect: pdfRect,
                                    color: anno.color,
                                    id: anno.id
                                });
                            }
                        };

                        annoLayer.appendChild(overlay);
                    });
                }
            } catch (err) {
                if (err.name !== 'RenderingCancelledException') {
                    console.error(`Page ${pageNum} render error:`, err);
                }
            }
        };

        // If scale changed, debounce the re-render.
        // Use the existing scale immediately for CSS scaling.
        if (!rendered) {
            render(scale);
        } else {
            if (zoomDebounceRef.current) clearTimeout(zoomDebounceRef.current);
            zoomDebounceRef.current = setTimeout(() => {
                if (active) render(scale);
            }, 300); // 300ms debounce for high-quality re-render
        }

        return () => {
            active = false;
            if (zoomDebounceRef.current) clearTimeout(zoomDebounceRef.current);
            renderTaskRef.current?.cancel();
        };
    }, [pdf, pageNum, scale]);

    // Intermediate zoom: scale the existing canvas
    const displayScale = scale / renderedScale;
    const displayWidth = rendered ? dim.width * displayScale : dim.width;
    const displayHeight = rendered ? dim.height * displayScale : dim.height;

    return (
        <div
            ref={wrapperRef}
            className="isr-page-wrapper"
            data-pdf-pw={originalWidth}
            data-pdf-ph={originalHeight}
            data-pdf-ox={originalOx}
            data-pdf-oy={originalOy}
            style={{
                position: 'relative',
                width: `${displayWidth}px`,
                height: `${displayHeight}px`,
                borderRadius: 'var(--radius-sm)',
                boxShadow: showGlow ? 'var(--shadow-4)' : 'none',
                overflow: 'hidden',
                flexShrink: 0,
                transition: 'box-shadow 0.2s ease',
            }}
        >
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
                    transform: `scale(${displayScale})`,
                    transformOrigin: '0 0',
                    opacity: rendered ? 1 : 0,
                    transition: 'opacity 0.2s ease',
                    willChange: 'transform',
                }}
            />
            <div
                ref={textLayerRef}
                className="textLayer"
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: `${dim.width}px`,
                    height: `${dim.height}px`,
                    transform: `scale(${displayScale})`,
                    transformOrigin: '0 0',
                    pointerEvents: 'auto',
                    zIndex: 3,
                    userSelect: 'text'
                }}
            />
            <div
                ref={annoLayerRef}
                className="annoLayer"
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: `${dim.width}px`,
                    height: `${dim.height}px`,
                    transform: `scale(${displayScale})`,
                    transformOrigin: '0 0',
                    pointerEvents: 'none',
                    zIndex: 2
                }}
            />
        </div>
    );
});

PageCanvas.displayName = 'PageCanvas';

// ─── Infinite Scroll Reader ─────────────────────────────────────────────────
const InfiniteScrollReader = React.memo(forwardRef(({
    filePath, scale, showGlow, onPageChange, onTotalPages, filter,
    onHighlightClick, selectedHighlight
}, ref) => {
    const [pdf, setPdf] = useState(null);
    const [totalPages, setTotalPages] = useState(0);
    const [error, setError] = useState(null);

    // metrics: { height, top, width } for every page
    const [metrics, setMetrics] = useState([]);
    const [totalHeight, setTotalHeight] = useState(0);
    const [visibleRange, setVisibleRange] = useState({ start: 0, end: OVERSCAN });

    const scrollContainerRef = useRef(null);
    const pageRefs = useRef([]); // kept for scrollToPage logic
    const currentPageRef = useRef(1);
    const lastScrollTop = useRef(0);

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
                        console.error('[ISR] FS error fallback:', fsErr);
                        const normalizedPath = filePath.replace(/\\/g, '/');
                        const assetUrl = convertFileSrc(normalizedPath);
                        loadingTask = pdfjsLib.getDocument({ url: assetUrl, ...PDF_OPTIONS });
                    }
                }
                const doc = await loadingTask.promise;
                if (!active) return;

                console.log(`[ISR] Successfully loaded document: ${filePath} (${doc.numPages} pages)`);

                // --- Dimension Pre-calculation ---
                // We fetch all viewports at scale 1.0 to build a precise height map.
                // This is done in consecutive blocks to avoid blocking the UI thread too much,
                // but it's generally very fast as it doesn't render anything.
                const pageMetrics = [];
                let currentTop = 0;

                for (let i = 1; i <= doc.numPages; i++) {
                    const page = await doc.getPage(i);
                    const viewport = page.getViewport({ scale: 1.0 });
                    const h = viewport.height;
                    pageMetrics.push({
                        height: h,
                        width: viewport.width,
                        top: currentTop,
                        ox: viewport.viewBox[0],
                        oy: viewport.viewBox[1]
                    });
                    currentTop += h + PAGE_GAP;
                }

                if (!active) return;
                setMetrics(pageMetrics);
                setTotalHeight(currentTop);
                setPdf(doc);
                setTotalPages(doc.numPages);
                onTotalPages?.(doc.numPages);
            } catch (err) {
                console.error('[ISR] Critical loading error:', err, filePath);
                if (active) setError(`${err.message || String(err)} (File: ${filePath})`);
            }
        };
        load();
        return () => { active = false; };
    }, [filePath]);

    // ── Scroll-to-page ────────────────────────────────────────────────────────
    const scrollToPage = useCallback((pageNum, behavior = 'smooth') => {
        const idx = pageNum - 1;
        if (metrics[idx]) {
            const container = scrollContainerRef.current;
            if (container) {
                // Calculate the target scroll top based on metrics and scale
                const top = metrics[idx].top * scale;
                // Adjust for container padding (8 * 16px = 32px based on ReaderView.css padding: var(--space-8))
                // Actually, ReaderView.css says padding: var(--space-8) var(--space-4);
                // var(--space-8) is 2.5rem = 40px usually. 
                // We'll just scroll the container.
                container.scrollTo({ top, behavior });
            }
        }
    }, [metrics, scale]);

    useImperativeHandle(ref, () => ({
        scrollToPage,
        getScrollContainer: () => scrollContainerRef.current
    }), [scrollToPage]);

    // ── Optimized Visibility Tracking ─────────────────────────────────────────
    // ── Optimized scroll-based virtualization ─────────────────────────────────
    const updateVisibleRange = useCallback(() => {
        if (!metrics.length || !scrollContainerRef.current) return;

        const container = scrollContainerRef.current;
        const scrollTop = container.scrollTop;
        const viewportHeight = container.clientHeight;

        // Adjust scrollTop by scale since the metrics are at scale 1.0
        const scaledScrollTop = scrollTop / scale;
        const scaledViewportHeight = viewportHeight / scale;

        // Find the first visible page using binary search on metrics
        let low = 0;
        let high = metrics.length - 1;
        let startIdx = 0;

        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            if (metrics[mid].top <= scaledScrollTop + 10) { // small buffer for precision
                startIdx = mid;
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }

        // Find the last visible page
        let endIdx = startIdx;
        for (let i = startIdx; i < metrics.length; i++) {
            if (metrics[i].top > scaledScrollTop + scaledViewportHeight + 400) { // 400px overscan
                break;
            }
            endIdx = i;
        }

        const newStart = Math.max(0, startIdx - RENDER_BUFFER);
        const newEnd = Math.min(metrics.length - 1, endIdx + RENDER_BUFFER);

        setVisibleRange(prev => {
            if (prev.start !== newStart || prev.end !== newEnd) {
                return { start: newStart, end: newEnd };
            }
            return prev;
        });

        // Update current page for onPageChange
        const currentIdx = startIdx + 1;
        if (currentIdx !== currentPageRef.current) {
            currentPageRef.current = currentIdx;
            onPageChange?.(currentIdx);
        }
    }, [metrics, scale, onPageChange]);

    useEffect(() => {
        const container = scrollContainerRef.current;
        if (!container) return;

        let rafId;
        const handleScroll = () => {
            if (rafId) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(updateVisibleRange);
        };

        container.addEventListener('scroll', handleScroll, { passive: true });
        // Initial update
        updateVisibleRange();

        return () => {
            container.removeEventListener('scroll', handleScroll);
            if (rafId) cancelAnimationFrame(rafId);
        };
    }, [updateVisibleRange]);

    // --- Scroll Anchoring (Zoom Consistency) ---
    const lastScaleRef = useRef(scale);
    useLayoutEffect(() => {
        const container = scrollContainerRef.current;
        if (!container || scale === lastScaleRef.current) return;

        const oldScale = lastScaleRef.current;
        const currentScrollTop = container.scrollTop;
        const viewportHeight = container.clientHeight;

        // Anchor to the center of the viewport
        const centerOffset = currentScrollTop + viewportHeight / 2;
        const scaledCenter = centerOffset * (scale / oldScale);
        const newScrollTop = scaledCenter - viewportHeight / 2;

        container.scrollTop = newScrollTop;
        lastScaleRef.current = scale;

        // Force an immediate update of visible range for the page indicator
        updateVisibleRange();
    }, [scale, updateVisibleRange]);

    if (error) {
        return (
            <div className="isr-error">
                <div className="pdf-error-card">
                    <div className="pdf-error-icon">!</div>
                    <p className="pdf-error-msg">PDF Load Error: {error}</p>
                    {filePath && /^[a-zA-Z]:/.test(filePath) && (
                        <button
                            className="pdf-error-action-btn"
                            onClick={async () => {
                                try {
                                    await revealItemInDir(filePath);
                                } catch (err) {
                                    console.error("Failed to wake drive:", err);
                                }
                            }}
                        >
                            Wake Drive (Google Drive / Cloud)
                        </button>
                    )}
                </div>
            </div>
        );
    }

    // Calculate pages to actually render
    const renderedPages = [];
    if (pdf && metrics.length) {
        for (let i = visibleRange.start; i <= visibleRange.end; i++) {
            const pageNum = i + 1;
            renderedPages.push(
                <div
                    key={i}
                    className="isr-page-sentinel"
                    style={{
                        position: 'absolute',
                        top: `${metrics[i].top * scale}px`,
                        left: '50%',
                        transform: 'translateX(-50%)',
                    }}
                >
                    <PageCanvas
                        pdf={pdf}
                        pageNum={pageNum}
                        scale={scale}
                        showGlow={showGlow}
                        originalWidth={metrics[i].width}
                        originalHeight={metrics[i].height}
                        originalOx={metrics[i].ox}
                        originalOy={metrics[i].oy}
                        onHighlightClick={onHighlightClick}
                        selectedHighlight={selectedHighlight}
                    />
                </div>
            );
        }
    }

    return (
        <div className="isr-scroll-container" ref={scrollContainerRef}>
            <div
                className="isr-page-stack"
                style={{
                    filter,
                    position: 'relative',
                    height: `${totalHeight * scale}px`,
                    width: '100%'
                }}
            >
                {renderedPages}
            </div>
        </div>
    );
}));

InfiniteScrollReader.displayName = 'InfiniteScrollReader';

// ─── Page Placeholder ───────────────────────────────────────────────────────
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

