import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import 'pdfjs-dist/legacy/web/pdf_viewer.css';

// Configure the worker. Using Vite's ?url syntax ensures it's correctly bundled and served.
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const PdfRenderer = ({ filePath, scale = 1.0, pageNumber = 1, showGlow = true, onPageLoad, filter }) => {
  const canvasRef = useRef(null);
  const renderTaskRef = useRef(null);
  const textLayerTaskRef = useRef(null); // Reference to track the TextLayer instance
  const [pdfDoc, setPdfDoc] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [pageRendered, setPageRendered] = useState(false);

  // --- Phase 11: Granite Base (Synchronous Stability) ---
  // We store the 'Original' (unscaled) dimensions so we can calculate
  // the 'Display' (scaled) dimensions SYNCHRONOUSLY based on props.
  const [originalDim, setOriginalDim] = useState({ width: 612, height: 792 });
  const displayDim = useMemo(() => ({
    width: Math.floor(originalDim.width * scale),
    height: Math.floor(originalDim.height * scale)
  }), [originalDim, scale]);

  const lastFilePath = useRef(null);

  useEffect(() => {
    let active = true;

    const loadPdf = async () => {
      try {
        setErrorMsg(null);
        setIsLoading(true);
        // Only reset pageRendered (skeleton) if switching to a completely new file
        if (lastFilePath.current !== filePath) {
          setPageRendered(false);
        }
        lastFilePath.current = filePath;

        let loadingTask;

        // Options required for standard fonts to render
        const pdfOptions = {
          cMapUrl: '/cmaps/',
          cMapPacked: true,
          standardFontDataUrl: '/standard_fonts/'
        };

        // If it's a web URL or we're in browser development
        if (filePath.startsWith('http') || filePath.startsWith('blob:')) {
          loadingTask = pdfjsLib.getDocument({ url: filePath, ...pdfOptions });
        } else {
          // Native Tauri file reading
          try {
            const { readFile } = await import('@tauri-apps/plugin-fs');
            const fileData = await readFile(filePath);
            loadingTask = pdfjsLib.getDocument({ data: fileData, ...pdfOptions });
          } catch (fsError) {
            console.error("Tauri FS error, falling back locally:", fsError);
            setErrorMsg(`Tauri FS Error: ${fsError.message || JSON.stringify(fsError)}`);
            loadingTask = pdfjsLib.getDocument({ url: filePath, ...pdfOptions });
          }
        }

        const pdf = await loadingTask.promise;
        if (!active) return;
        setPdfDoc(pdf);
        setIsLoading(false);
      } catch (error) {
        console.error("Error loading PDF:", error);
        setErrorMsg(`PDF Load Error: ${error.message || JSON.stringify(error)}`);
        setIsLoading(false);
      }
    };

    if (filePath) {
      loadPdf();
    }

    return () => {
      active = false;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }
      if (textLayerTaskRef.current) {
        textLayerTaskRef.current.cancel();
      }
    };
  }, [filePath]);

  useEffect(() => {
    let active = true;

    const renderPage = async () => {
      if (!pdfDoc || !canvasRef.current) return;

      try {
        const clampedPage = Math.min(Math.max(pageNumber, 1), pdfDoc.numPages);
        const page = await pdfDoc.getPage(clampedPage);
        if (!active) return;

        // --- Phase 11: Aspect Ratio Lock ---
        // Get standard viewport at scale 1 to lock in the unscaled aspect ratio.
        // This ensures the SYNCHRONOUS displayDim calculation in the render body
        // is always using the most accurate unscaled dimensions.
        const standardViewport = page.getViewport({ scale: 1 });
        if (originalDim.width !== standardViewport.width || originalDim.height !== standardViewport.height) {
          setOriginalDim({ width: standardViewport.width, height: standardViewport.height });
        }

        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');

        // --- High-DPI (Retina) Scaling Logic ---
        const dpr = window.devicePixelRatio || 1;
        const width = Math.floor(viewport.width);
        const height = Math.floor(viewport.height);

        // Internal buffer resolution (high res for crisp text)
        canvas.width = width * dpr;
        canvas.height = height * dpr;

        // Normalize coordinate system
        context.scale(dpr, dpr);

        const renderContext = {
          canvasContext: context,
          viewport: viewport,
        };

        if (renderTaskRef.current) {
          await renderTaskRef.current.promise.catch(() => { });
        }

        renderTaskRef.current = page.render(renderContext);
        await renderTaskRef.current.promise;

        if (!active) return;
        setPageRendered(true);

        // --- Phase 8: Precision Manual Overlay (Mathematical Fit) ---
        const textContent = await page.getTextContent();
        const textLayerContainer = document.createElement('div');
        textLayerContainer.className = 'textLayer';

        // Match CSS dimensions exactly to the viewport
        textLayerContainer.style.width = canvas.style.width;
        textLayerContainer.style.height = canvas.style.height;
        textLayerContainer.style.position = 'absolute';
        textLayerContainer.style.top = '0';
        textLayerContainer.style.left = '0';
        textLayerContainer.style.pointerEvents = 'auto'; // Ensure interactive selection

        const wrapper = canvas.parentElement;
        wrapper.querySelectorAll('.textLayer').forEach(el => el.remove());
        wrapper.appendChild(textLayerContainer);

        // Track tasks for cleanup
        if (textLayerTaskRef.current) {
          // No longer a 'task' object, but we keep the ref for consistency
          textLayerTaskRef.current = null;
        }

        // We use a dummy canvas to measure browser-default text width for scaleX calculation
        const measureCanvas = document.createElement('canvas');
        const measureCtx = measureCanvas.getContext('2d');

        textContent.items.forEach(item => {
          if (!item.str || item.str.trim() === '') return;

          const span = document.createElement('span');
          span.textContent = item.str + (item.hasEOL ? '\n' : '');

          // Get the PDF transform matrix mapped to viewport coordinates
          const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);

          // Basic font metric extraction
          const fontHeight = Math.sqrt((tx[2] * tx[2]) + (tx[3] * tx[3]));
          const fontAscent = fontHeight * 0.85; // Heuristic for vertical baseline correction

          // The PDF intended width in CSS pixels
          const targetWidth = item.width * viewport.scale;

          // Positioning
          span.style.left = `${tx[4]}px`;
          span.style.top = `${tx[5] - fontAscent}px`;
          span.style.fontSize = `${fontHeight}px`;
          span.style.fontFamily = 'serif, sans-serif'; // Generic fallbacks used for interaction

          // Style setup
          span.style.position = 'absolute';
          span.style.color = 'transparent';
          span.style.whiteSpace = 'pre';
          span.style.lineHeight = '1';
          span.style.transformOrigin = '0 0';
          span.style.cursor = 'text';

          // --- HORIZONTAL SYNC (The 'Mathematical Fit') ---
          // We measure how wide the browser thinks this word is by default
          measureCtx.font = `${fontHeight}px serif`;
          const measuredWidth = measureCtx.measureText(item.str).width;

          // If there is a discrepancy, we force-stretch the word to fit the PDF ink
          if (measuredWidth > 0 && targetWidth > 0) {
            const sx = targetWidth / measuredWidth;
            span.style.transform = `scaleX(${sx})`;
          }

          textLayerContainer.appendChild(span);
        });

        // Notify parent about page load
        if (onPageLoad) onPageLoad(page, viewport, pdfDoc.numPages);
      } catch (error) {
        if (error.name !== 'RenderingCancelledException') {
          console.error("Error rendering page:", error);
          setErrorMsg(`Render Error: ${error.message || error}`);
        }
      }
    };

    renderPage();

    return () => {
      active = false;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }
    };
    // NOTE: onPageLoad intentionally excluded to prevent infinite render loop.
    // Including it causes: render → onPageLoad → state update → new callback ref → re-render → loop.
  }, [pdfDoc, pageNumber, scale]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      className="pdf-canvas-container"
      style={{
        position: 'relative',
        display: 'grid',
        placeItems: 'center',
        width: '100%',
        minHeight: '100%'
      }}
    >
      {/* Error State */}
      {errorMsg && (
        <div className="pdf-error-card">
          <div className="pdf-error-icon">!</div>
          <p className="pdf-error-msg">{errorMsg}</p>
        </div>
      )}

      {/* Shimmer Skeleton while loading */}
      {(isLoading || !pageRendered) && !errorMsg && (
        <div className="pdf-skeleton">
          <div className="skeleton" style={{ width: `${Math.round(612 * scale)}px`, height: `${Math.round(792 * scale)}px`, maxWidth: '90vw' }} />
        </div>
      )}

      {/* Canvas Wrapper (perfectly sized to viewport) */}
      <div
        className="pdf-viewport-wrapper"
        style={{
          position: 'relative',
          width: displayDim.width ? `${displayDim.width}px` : `${Math.round(612 * scale)}px`,
          height: displayDim.height ? `${displayDim.height}px` : `${Math.round(792 * scale)}px`,
          overflow: 'hidden',
          filter
        }}
      >
        <canvas
          ref={canvasRef}
          className="pdf-canvas"
          style={{
            display: (errorMsg || isLoading) ? 'none' : 'block',
            opacity: pageRendered ? 1 : 0,
            transition: 'opacity 0.2s ease',
            borderRadius: 'var(--radius-sm)',
            boxShadow: showGlow ? 'var(--shadow-4)' : 'none',
            position: 'absolute',
            top: 0,
            left: 0,
          }}
        />
      </div>
    </div>
  );
};

export default PdfRenderer;
