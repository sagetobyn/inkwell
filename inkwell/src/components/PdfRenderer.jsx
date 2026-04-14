import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { convertFileSrc } from '@tauri-apps/api/core';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import 'pdfjs-dist/legacy/web/pdf_viewer.css';

// Configure the worker. Using Vite's ?url syntax ensures it's correctly bundled and served.
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const PdfRenderer = ({ 
  filePath, scale = 1.0, pageNumber = 1, 
  showGlow = true, onPageLoad, filter,
  onHighlightClick, selectedHighlight 
}) => {
  const canvasRef = useRef(null);
  const textLayerRef = useRef(null);
  const annoLayerRef = useRef(null);
  const renderTaskRef = useRef(null);
  const textLayerTaskRef = useRef(null); // Reference to track the TextLayer instance
  const [pdfDoc, setPdfDoc] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [pageRendered, setPageRendered] = useState(false);

  // --- Phase 11: Granite Base (Synchronous Stability) ---
  // We store the 'Original' (unscaled) dimensions so we can calculate
  // the 'Display' (scaled) dimensions SYNCHRONOUSLY based on props.
  const [originalDim, setOriginalDim] = useState({ width: 612, height: 792, ox: 0, oy: 0 });
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
            // Use Tauri's asset protocol for fallback
            const normalizedPath = filePath.replace(/\\/g, '/');
            const assetUrl = convertFileSrc(normalizedPath);
            loadingTask = pdfjsLib.getDocument({ url: assetUrl, ...pdfOptions });
          }
        }

        const pdf = await loadingTask.promise;
        if (!active) return;
        console.log(`[PDF] Loaded ${filePath} (${pdf.numPages} pages)`);
        setPdfDoc(pdf);
        setIsLoading(false);
      } catch (error) {
        console.error("Critical error loading PDF:", error, filePath);
        setErrorMsg(`PDF Load Error: ${error.message || JSON.stringify(error)}. Path: ${filePath}`);
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
        if (originalDim.width !== standardViewport.width || 
            originalDim.height !== standardViewport.height ||
            originalDim.ox !== standardViewport.viewBox[0] ||
            originalDim.oy !== standardViewport.viewBox[1]) {
          setOriginalDim({ 
            width: standardViewport.width, 
            height: standardViewport.height,
            ox: standardViewport.viewBox[0],
            oy: standardViewport.viewBox[1]
          });
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
        const textLayer = textLayerRef.current;
        if (!textLayer) return;

        // Clear existing
        textLayer.innerHTML = '';
        
        // Match CSS dimensions exactly to the viewport
        textLayer.style.width = `${viewport.width}px`;
        textLayer.style.height = `${viewport.height}px`;
        textLayer.style.position = 'absolute';
        textLayer.style.top = '0';
        textLayer.style.left = '0';
        textLayer.style.pointerEvents = 'auto'; // Ensure interactive selection
        textLayer.style.display = 'block';

        // Track tasks for cleanup
        if (textLayerTaskRef.current) {
          // No longer a 'task' object, but we keep the ref for consistency
          textLayerTaskRef.current = null;
        }

        // We use a dummy canvas to measure browser-default text width for scaleX calculation
        const measureCanvas = document.createElement('canvas');
        const measureCtx = measureCanvas.getContext('2d');

        // --- PHASE 12: LOGICAL LINE GROUPING (No Dead Zones) ---
        // Group items into lines for robust selection bridging.
        const items = textContent.items.filter(item => item.str && item.str.trim() !== '');
        const lines = [];
        const Y_THRESHOLD = 5; // Softened threshold to better handle misaligned multi-style lines

        items.forEach(item => {
          const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
          const y = tx[5];
          const fontHeight = Math.sqrt((tx[2] * tx[2]) + (tx[3] * tx[3]));
          
          let line = lines.find(l => Math.abs(l.y - y) < Y_THRESHOLD);
          if (!line) {
            line = { y, items: [], fontHeight };
            lines.push(line);
          }
          line.items.push({ ...item, tx, fontHeight });
          // Track largest font height in line for sizing
          line.fontHeight = Math.max(line.fontHeight, fontHeight);
        });

        // Sort lines by Y (top to bottom)
        lines.sort((a, b) => a.y - b.y);

        lines.forEach((line, index) => {
          const lineDiv = document.createElement('div');
          lineDiv.className = 'textLayer-line';
          
          // Determine line height and vertical gap bridging
          const nextLine = lines[index + 1];
          const lineTop = line.y - line.fontHeight * 0.8;
          let lineHeightPx;
          
          if (nextLine) {
            const nextLineTop = nextLine.y - nextLine.fontHeight * 0.8;
            lineHeightPx = Math.max(line.fontHeight * 1.2, nextLineTop - lineTop);
          } else {
            // --- FINAL LINE STRETCH ---
            // Ensure the last line covers the rest of the page to prevent selection resets.
            const containerHeight = parseFloat(textLayer.style.height) || viewport.height;
            lineHeightPx = Math.max(line.fontHeight * 1.5, containerHeight - lineTop);
          }

          // Line positioning
          lineDiv.style.position = 'absolute';
          lineDiv.style.left = '0';
          lineDiv.style.width = '100%';
          lineDiv.style.top = `${lineTop}px`;
          lineDiv.style.height = `${lineHeightPx}px`;
          lineDiv.style.pointerEvents = 'auto';
          lineDiv.style.userSelect = 'text';

          line.items.sort((a, b) => a.tx[4] - b.tx[4]).forEach(item => {
            const span = document.createElement('span');
            span.textContent = item.str + (item.hasEOL ? '\n' : '');
            
            // --- ATTACH PDF COORDINATE METADATA ---
            // item.transform [a, b, c, d, e, f] where e=x, f=y in PDF points
            span.setAttribute('data-pdf-x', item.transform[4]);
            span.setAttribute('data-pdf-y', item.transform[5]);
            span.setAttribute('data-pdf-w', item.width);
            span.setAttribute('data-pdf-h', item.transform[3]); // font height
            span.setAttribute('data-page', pageNumber);
            
            // Positioning relative to line container
            // We expand the span to cover the full line height to eliminate "dead zones" during selection.
            const itemTopOffset = item.tx[5] - item.fontHeight * 0.8;
            span.style.left = `${item.tx[4]}px`;
            span.style.top = '0';
            span.style.height = '100%';
            span.style.paddingTop = `${itemTopOffset - lineTop}px`;
            span.style.boxSizing = 'border-box';
            
            span.style.fontSize = `${item.fontHeight}px`;
            span.style.fontFamily = 'serif, sans-serif'; 
            span.style.position = 'absolute';
            span.style.color = 'transparent';
            span.style.whiteSpace = 'pre';
            span.style.lineHeight = '1';
            span.style.transformOrigin = '0 0';
            span.style.cursor = 'text';

            // Precise scaleX calculation for visual alignment
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
          annoLayer.style.width = `${viewport.width}px`;
          annoLayer.style.height = `${viewport.height}px`;
          
          annots.filter(a => a.subtype === 'Highlight').forEach(anno => {
            const pdfRect = anno.rect; // [x1, y1, x2, y2] in PDF points
            const rect = viewport.convertToViewportRectangle(pdfRect);
            
            const overlay = document.createElement('div');
            overlay.className = 'pdf-anno-overlay';
            
            // Highlight specific styling
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
            
            // Selection state
            const isSelected = selectedHighlight && 
                              selectedHighlight.page === pageNumber && 
                              selectedHighlight.rect.every((v, i) => Math.abs(v - pdfRect[i]) < 0.1);
            
            if (isSelected) {
              overlay.classList.add('selected');
            }
            
            overlay.onclick = (e) => {
              e.stopPropagation();
              if (onHighlightClick) {
                onHighlightClick({
                  page: pageNumber,
                  rect: pdfRect,
                  color: anno.color,
                  id: anno.id
                });
              }
            };
            
            annoLayer.appendChild(overlay);
          });
        }

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
          {filePath && /^[a-zA-Z]:/.test(filePath) && (
            <button
              className="pdf-error-action-btn"
              onClick={async () => {
                try {
                  const root = filePath.split(':')[0] + ':';
                  console.log(`[Diagnostic] Attempting to wake/re-mount drive at: ${root}`);
                  await revealItemInDir(filePath);
                } catch (err) {
                  console.error("Wake drive failed:", err);
                }
              }}
            >
              Wake Drive (Google Drive / Cloud)
            </button>
          )}
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
        data-pdf-pw={originalDim.width}
        data-pdf-ph={originalDim.height}
        data-pdf-ox={originalDim.ox}
        data-pdf-oy={originalDim.oy}
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
        <div 
          ref={textLayerRef}
          className="textLayer"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            zIndex: 3,
            userSelect: 'text',
            pointerEvents: 'auto'
          }}
        />
        <div 
          ref={annoLayerRef}
          className="annoLayer"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            zIndex: 2,
            pointerEvents: 'none' // children (overlays) will have pointerEvents: auto
          }}
        />
      </div>
    </div>
  );
};

export default PdfRenderer;

