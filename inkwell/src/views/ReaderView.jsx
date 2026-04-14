import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useAppContext } from '../context/AppContext';
import { useToast } from '../components/Toast';
import { isTauri } from '../utils/tauri';
import Tooltip from '../components/Tooltip';
import {
  ArrowLeft, ZoomIn, ZoomOut, Maximize, Minimize,
  Moon, Sun, ChevronLeft,
  ChevronRight, Columns, Minus, Type, Highlighter, Check, Eraser, Palette, Settings
} from 'lucide-react';
import InfiniteScrollReader from '../components/InfiniteScrollReader';
import PdfRenderer from '../components/PdfRenderer';
import './ReaderView.css';

const ReaderView = () => {
  const {
    closeBook, currentBook, shortcuts, bookProgress, updateBookProgress,
    pdfNightMode, togglePdfNightMode, settings, updateSettings,
    setBookTotalPages, totalPagesMap, updateTheme, openSettingsWindow,
    isFullscreen, toggleFullscreen
  } = useAppContext();

  const addToast = useToast();
  const [scale, setScale] = useState(settings.defaultZoom || 1.2);

  // Whether infinite scroll mode is enabled
  const infiniteScroll = settings.infiniteScroll === true;

  const initialPage = currentBook?.path ? (bookProgress[currentBook.path]?.page || 1) : 1;
  const [page, setPage] = useState(initialPage);
  const [totalPages, setTotalPages] = useState(
    currentBook?.path ? (totalPagesMap[currentBook.path] || 0) : 0
  );

  const [dictQuery, setDictQuery] = useState(null);
  const [showControls, setShowControls] = useState(true);
  const [showGoToPage, setShowGoToPage] = useState(false);
  const [goToPageInput, setGoToPageInput] = useState('');
  const [showPalette, setShowPalette] = useState(false);
  const paletteRef = useRef(null);
  const dictAbortControllerRef = useRef(null);
  const [saveStatus, setSaveStatus] = useState('idle'); // 'idle' | 'saving' | 'success' | 'error'

  const readerRef = useRef(null);   // ref to InfiniteScrollReader (exposes scrollToPage)
  const controlsTimeout = useRef(null);
  const goToPageRef = useRef(null);

  const bookPath = currentBook?.path || null;
  const [selectedHighlight, setSelectedHighlight] = useState(null);

  // Progress percentage
  const progressPercent = totalPages > 0 ? Math.round((page / totalPages) * 100) : 0;

  // Reading time estimate (~1.5 min per page)
  const remainingPages = Math.max(0, totalPages - page);
  const readingTimeMin = Math.round(remainingPages * 1.5);

  // ── Save page progress whenever page changes ────────────────────────────
  const contentRef = useRef(null); // used by single-page mode for scroll reset
  const progressUpdateTimer = useRef(null);
  useEffect(() => {
    if (currentBook?.path) {
      // Debounce the context update to prevent rapid re-renders during scroll
      if (progressUpdateTimer.current) clearTimeout(progressUpdateTimer.current);
      progressUpdateTimer.current = setTimeout(() => {
        updateBookProgress(currentBook.path, page);
      }, 1000);
    }
    // Reset scroll in single-page mode
    if (!infiniteScroll && contentRef.current) {
      contentRef.current.scrollTop = 0;
      contentRef.current.scrollLeft = 0;
    }
    return () => {
      if (progressUpdateTimer.current) clearTimeout(progressUpdateTimer.current);
    };
  }, [page, currentBook?.path, infiniteScroll]);

  // Sync internal page state if currentBook changes (e.g. opened from recent/hero)
  useEffect(() => {
    if (currentBook?.path) {
      const savedPage = bookProgress[currentBook.path]?.page || 1;
      setPage(savedPage);
      // Reset initialScrollDone so it jumps to the correct page for the new book
      initialScrollDone.current = false;
    }
  }, [currentBook?.path]);

  // ── Scroll to initial saved page when PDF loads ─────────────────────────
  const [pdfReady, setPdfReady] = useState(false);
  const initialScrollDone = useRef(false);

  useEffect(() => {
    if (pdfReady && !initialScrollDone.current && initialPage > 1) {
      initialScrollDone.current = true;
      // Use "auto" (instant) for initial jump to prevent intermediate page observer triggers
      readerRef.current?.scrollToPage(initialPage, 'auto');
    }
  }, [pdfReady, initialPage]);

  // ── Page change from scroll ─────────────────────────────────────────────
  const handlePageChange = useCallback((newPage) => {
    setPage(newPage);
  }, []);

  // ── Total pages callback ────────────────────────────────────────────────
  const handleTotalPages = useCallback((n) => {
    setTotalPages(n);
    setPdfReady(true);
    if (bookPath && n !== totalPagesMap[bookPath]) {
      setBookTotalPages(bookPath, n);
    }
  }, [bookPath, totalPagesMap, setBookTotalPages]);

  // ── Zoom handlers ───────────────────────────────────────────────────────
  const handleZoomIn = () => setScale(s => Math.min(s + 0.2, 3.0));
  const handleZoomOut = () => setScale(s => Math.max(s - 0.2, 0.5));

  // ── Fullscreen ──────────────────────────────────────────────────────────

  // ── Auto-hide controls ──────────────────────────────────────────────────
  const resetControlsTimer = useCallback(() => {
    // Zen Mode 'always' keeps controls hidden until specifically toggled or mouse movement (briefly)
    if (settings.readerZenMode === 'always') {
      setShowControls(false);
      if (controlsTimeout.current) clearTimeout(controlsTimeout.current);
      return;
    }

    setShowControls(true);
    if (controlsTimeout.current) clearTimeout(controlsTimeout.current);
    controlsTimeout.current = setTimeout(() => {
      setShowControls(false);
    }, (settings.autoHideDelay || 3) * 1000);
  }, [settings.autoHideDelay, settings.readerZenMode]);

  useEffect(() => {
    const handleMouseMove = () => {
      if (settings.readerZenMode !== 'always') {
        resetControlsTimer();
      }
    };

    const handleScroll = () => {
      if (settings.readerZenMode === 'on_scroll') {
        setShowControls(false);
      } else if (settings.readerZenMode === 'off') {
        resetControlsTimer();
      }
    };

    if (isFullscreen) {
      setShowControls(false);
    }

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('scroll', handleScroll, true);
    resetControlsTimer();
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('scroll', handleScroll, true);
      if (controlsTimeout.current) clearTimeout(controlsTimeout.current);
    };
  }, [resetControlsTimer, settings.readerZenMode]);

  // ── Click Away for Palette ──
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (paletteRef.current && !paletteRef.current.contains(event.target)) {
        setShowPalette(false);
      }
    };
    if (showPalette) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showPalette]);


  // ── Keyboard shortcuts ──────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (showGoToPage) return;
      if (dictQuery) setDictQuery(null);

      if (e.key === shortcuts.fullscreen) { e.preventDefault(); toggleFullscreen(); }
      if (e.key === shortcuts.toggleNightMode) { e.preventDefault(); togglePdfNightMode(); }
      if (e.key === shortcuts.goToPage) { e.preventDefault(); setShowGoToPage(true); }
      if (e.key === shortcuts.backToLibrary) { e.preventDefault(); updateBookProgress(currentBook?.path, page); closeBook(); }
      if (e.key === shortcuts.zoomIn || (e.ctrlKey && e.key === '=')) { e.preventDefault(); handleZoomIn(); }
      if (e.key === shortcuts.zoomOut || (e.ctrlKey && e.key === '-')) { e.preventDefault(); handleZoomOut(); }
      
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const selection = window.getSelection();
        if (selection.isCollapsed && selectedHighlight) {
          e.preventDefault();
          handleEraseHighlight();
        }
      }
      
      if (e.key === shortcuts.brightnessUp) {
        e.preventDefault();
        const current = settings.brightness || 100;
        updateSettings({ brightness: Math.min(current + 10, 150) });
      }
      if (e.key === shortcuts.brightnessDown) {
        e.preventDefault();
        const current = settings.brightness || 100;
        updateSettings({ brightness: Math.max(current - 10, 50) });
      }
      
      if (settings.enableHighlighting !== false) {
        if (e.key === shortcuts.saveHighlight) { e.preventDefault(); handleSaveHighlight(); }
        if (e.key === shortcuts.removeHighlight) { e.preventDefault(); handleRemoveHighlight(); }
      }

      if (settings.spaceToScroll !== false && (e.key === ' ' || e.code === 'Space')) {
        e.preventDefault();
        const container = infiniteScroll 
          ? readerRef.current?.getScrollContainer() 
          : contentRef.current;
        
        if (container) {
          const atBottom = Math.ceil(container.scrollHeight - container.scrollTop) <= container.clientHeight + 5;
          const atTop = container.scrollTop <= 5;

          if (!e.shiftKey && atBottom && !infiniteScroll) {
            // Next page in single-page mode
            setPage(p => totalPages ? Math.min(p + 1, totalPages) : p + 1);
            container.scrollTop = 0;
          } else if (e.shiftKey && atTop && !infiniteScroll) {
            // Previous page in single-page mode
            setPage(p => Math.max(p - 1, 1));
          } else {
            // Standard scroll
            const scrollStep = settings.readerScrollStep || 0.8;
            const scrollAmount = container.clientHeight * scrollStep;
            container.scrollBy({ 
              top: e.shiftKey ? -scrollAmount : scrollAmount, 
              behavior: 'smooth' 
            });
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [shortcuts, dictQuery, page, totalPages, showGoToPage, bookPath, settings, togglePdfNightMode, selectedHighlight]);

  // ── Save Highlight to PDF Binary ─────────────────────────────────────────
  const handleSaveHighlight = async () => {
    if (!isTauri()) {
      addToast('Highlighting is only available in the desktop application.', 'info');
      return;
    }
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !currentBook?.path) {
      addToast('Select some text first to highlight', 'info');
      return;
    }

    const range = selection.getRangeAt(0);
    const rects = Array.from(range.getClientRects());
    
    if (rects.length === 0) {
      addToast('No selection found', 'info');
      return;
    }

    try {
      setSaveStatus('saving');
      
      const { readFile, writeFile } = await import('@tauri-apps/plugin-fs');
      const { PDFDocument, PDFName, PDFArray } = await import('pdf-lib');

      const existingPdfBytes = await readFile(currentBook.path);
      const pdfDoc = await PDFDocument.load(existingPdfBytes);
      const context = pdfDoc.context;

      // 1. Group Rects by Span
      // This ensures we never create multiple overlapping highlights for the same line segment.
      const spanGroups = new Map();
      for (const r of rects) {
        // Find which span this rect belongs to using hit-testing at the center of the rect
        const centerX = r.left + r.width / 2;
        const centerY = r.top + r.height / 2;
        const elementAtPoint = document.elementFromPoint(centerX, centerY);
        const span = elementAtPoint?.closest('.textLayer span[data-page]');
        
        if (!span) continue;
        if (!spanGroups.has(span)) spanGroups.set(span, []);
        spanGroups.get(span).push(r);
      }

      // Group highlights by page for PDF-lib processing
      const pageHighlights = {};

      for (const [span, sRects] of spanGroups.entries()) {
        const pageNum = parseInt(span.getAttribute('data-page'));
        const pageWrapper = span.closest('.pdf-viewport-wrapper, .isr-page-wrapper');
        if (!pageWrapper) continue;

        // Calculate the Union Rect of all selection segments within this span
        const unionRect = {
          left: Math.min(...sRects.map(r => r.left)),
          top: Math.min(...sRects.map(r => r.top)),
          right: Math.max(...sRects.map(r => r.left + r.width)),
          bottom: Math.max(...sRects.map(r => r.top + r.height))
        };
        unionRect.width = unionRect.right - unionRect.left;
        unionRect.height = unionRect.bottom - unionRect.top;

        const pageRect = pageWrapper.getBoundingClientRect();
        const origWidth = parseFloat(pageWrapper.getAttribute('data-pdf-pw') || '612');
        const origHeight = parseFloat(pageWrapper.getAttribute('data-pdf-ph') || '792');
        const origOx = parseFloat(pageWrapper.getAttribute('data-pdf-ox') || '0');
        const origOy = parseFloat(pageWrapper.getAttribute('data-pdf-oy') || '0');

        const scaleX = pageRect.width / origWidth;
        const scaleY = pageRect.height / origHeight;

        // Use the FULL browser selection box height to match 'native selection' look
        const dh = unionRect.height / scaleY;
        const dw = unionRect.width / scaleX;
        const dx = origOx + (unionRect.left - pageRect.left) / scaleX;
        const dy_top = (unionRect.top - pageRect.top) / scaleY;

        // PDF Y is bottom-up. Top-down 'dy_top' maps to 'origHeight - dy_top - dh'
        const dy = origOy + (origHeight - dy_top - dh);

        if (!pageHighlights[pageNum]) pageHighlights[pageNum] = [];
        pageHighlights[pageNum].push({ x: dx, y: dy, w: dw, h: dh, span, unionRect });
      }

      let savedCount = 0;

      for (const [pageNumStr, rawList] of Object.entries(pageHighlights)) {
        const pageNum = parseInt(pageNumStr);
        const pageIndex = pageNum - 1;
        if (pageIndex < 0 || pageIndex >= pdfDoc.getPageCount()) continue;
        
        const pdfPage = pdfDoc.getPage(pageIndex);

        // --- Phase 13: Vertical Snap (The Flush-Fit) ---
        // Sort highlights from top to bottom (PDF Y is bottom-up, so sort descending)
        rawList.sort((a, b) => b.y - a.y);
        for (let i = 0; i < rawList.length - 1; i++) {
          const current = rawList[i];
          const next = rawList[i + 1];
          const currentBottom = current.y;
          const nextTop = next.y + next.h;
          
          // If they overlap or have a tiny gap (< 3pt), snap them together
          const gap = nextTop - currentBottom;
          if (gap > -2 && gap < 8) {
            // Snap the current line's bottom to the next line's top
            // To maintain the top of 'current', we must adjust both y and h
            const shift = nextTop - current.y;
            current.y = nextTop;
            current.h -= shift; 
          }
        }

        rawList.forEach(h => {
          const rect = [h.x, h.y, h.x + h.w, h.y + h.h];

          const highlightAnnot = context.obj({
            Type: 'Annot',
            Subtype: 'Highlight',
            Rect: rect,
            QuadPoints: [h.x, h.y + h.h, h.x + h.w, h.y + h.h, h.x, h.y, h.x + h.w, h.y],
            C: [1, 0.9, 0.2], // Yellow
            CA: 0.4,
          });

          const annotRef = context.register(highlightAnnot);
          
          let annots = pdfPage.node.lookup(PDFName.of('Annots'));
          if (!annots || !(annots instanceof PDFArray)) {
            annots = context.obj([]);
            pdfPage.node.set(PDFName.of('Annots'), annots);
          }
          annots.push(annotRef);

          // Accurate UI feedback: Apply a partial background to the span using linear-gradient
          // This avoids the "entire line" problem while keeping the DOM structure simple.
          const sRect = h.span.getBoundingClientRect();
          const pStart = Math.max(0, ((h.unionRect.left - sRect.left) / sRect.width) * 100);
          const pEnd = Math.min(100, ((h.unionRect.right - sRect.left) / sRect.width) * 100);
          
          const highlightColor = 'rgba(255, 226, 0, 0.35)';
          const currentBg = h.span.style.background || '';
          const newHighlight = `linear-gradient(to right, transparent ${pStart}%, ${highlightColor} ${pStart}%, ${highlightColor} ${pEnd}%, transparent ${pEnd}%)`;
          
          h.span.style.background = currentBg ? `${currentBg}, ${newHighlight}` : newHighlight;
          h.span.classList.add('pdf-highlighted-precise');
          
          savedCount++;
        });
      }

      if (savedCount > 0) {
        const pdfBytes = await pdfDoc.save();
        await writeFile(currentBook.path, pdfBytes);
        setSaveStatus('success');
        // Trigger a "soft refresh" of annotations if the reader supports it
        // For now, the UI gradients provide instant feedback.
      } else {
        addToast('No valid text areas found to highlight', 'info');
        setSaveStatus('idle');
      }

      selection.removeAllRanges();
      setTimeout(() => setSaveStatus('idle'), 1500);

    } catch (err) {
      console.error('Failed to save highlight:', err);
      setSaveStatus('error');
      addToast(`Error: ${err.message}`, 'danger');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  };

  const handleRemoveHighlight = async () => {
    if (!isTauri()) {
      addToast('Highlighting is only available in the desktop application.', 'info');
      return;
    }
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !currentBook?.path) {
      addToast('Select text over highlights to erase them', 'info');
      return;
    }

    const range = selection.getRangeAt(0);
    const rects = Array.from(range.getClientRects());
    
    if (rects.length === 0) return;

    try {
      setSaveStatus('saving');
      
      const { readFile, writeFile } = await import('@tauri-apps/plugin-fs');
      const { PDFDocument, PDFName, PDFArray, PDFDict } = await import('pdf-lib');

      const existingPdfBytes = await readFile(currentBook.path);
      const pdfDoc = await PDFDocument.load(existingPdfBytes);

      // Create bounding boxes for our selection rects in PDF points per page
      const selectionBoxesByPage = {};

      for (const r of rects) {
        const centerX = r.left + r.width / 2;
        const centerY = r.top + r.height / 2;
        const elementAtPoint = document.elementFromPoint(centerX, centerY);
        const span = elementAtPoint?.closest('.textLayer span[data-page]');
        if (!span) continue;

        const pageNum = parseInt(span.getAttribute('data-page'));
        const pageWrapper = span.closest('.pdf-viewport-wrapper, .isr-page-wrapper');
        if (!pageWrapper) continue;

        const pageRect = pageWrapper.getBoundingClientRect();
        const origWidth = parseFloat(pageWrapper.getAttribute('data-pdf-pw') || '612');
        const origHeight = parseFloat(pageWrapper.getAttribute('data-pdf-ph') || '792');
        const currentScale = pageRect.width / origWidth;

        const dx = (r.left - pageRect.left) / currentScale;
        const dy_top = (r.top - pageRect.top) / currentScale;
        const dw = r.width / currentScale;
        const dh = r.height / currentScale;
        const dy = origHeight - dy_top - dh;

        if (!selectionBoxesByPage[pageNum]) selectionBoxesByPage[pageNum] = [];
        selectionBoxesByPage[pageNum].push({ x1: dx, y1: dy, x2: dx + dw, y2: dy + dh, span });
      }

      let removedCount = 0;

      for (const [pageNumStr, sBoxes] of Object.entries(selectionBoxesByPage)) {
        const pageNum = parseInt(pageNumStr);
        const pageIndex = pageNum - 1;
        if (pageIndex < 0 || pageIndex >= pdfDoc.getPageCount()) continue;
        
        const pdfPage = pdfDoc.getPage(pageIndex);
        const annots = pdfPage.node.lookup(PDFName.of('Annots'));
        
        if (annots instanceof PDFArray) {
          for (let i = annots.size() - 1; i >= 0; i--) {
            const annot = annots.lookup(i);
            if (annot instanceof PDFDict) {
              const subtype = annot.lookup(PDFName.of('Subtype'));
              if (subtype === PDFName.of('Highlight')) {
                const rect = annot.lookup(PDFName.of('Rect'));
                if (rect instanceof PDFArray && rect.size() === 4) {
                  const [ax1, ay1, ax2, ay2] = rect.asArray().map(n => n.asNumber());
                  
                  // Check intersection with any of our selection boxes on this page
                  const BUFFER = 3;
                  const intersects = sBoxes.some(sBox => {
                    const overlapX = Math.max(0, Math.min(ax2, sBox.x2) - Math.max(ax1, sBox.x1));
                    const overlapY = Math.max(0, Math.min(ay2, sBox.y2) - Math.max(ay1, sBox.y1));
                    const areaOverlap = overlapX * overlapY;
                    const areaAnnot = (ax2 - ax1) * (ay2 - ay1);
                    return areaOverlap > areaAnnot * 0.3 || // Significant overlap
                           (overlapX > (ax2 - ax1) * 0.5 && overlapY > 2); // Center-cut
                  });

                  if (intersects) {
                    annots.remove(i);
                    removedCount++;
                  }
                }
              }
            }
          }
        }
        
        // Clear UI highlights for involved spans
        sBoxes.forEach(s => {
          s.span.style.background = '';
          s.span.classList.remove('pdf-highlighted-precise');
          s.span.classList.remove('pdf-highlighted'); // fallback for old ones
        });
      }

      if (removedCount > 0) {
        const pdfBytes = await pdfDoc.save();
        await writeFile(currentBook.path, pdfBytes);
        setSaveStatus('success');
        addToast(`Cleared ${removedCount} highlight segments`, 'success');
      } else {
        setSaveStatus('idle');
        addToast('No highlights found in that specific area', 'info');
      }
      
      selection.removeAllRanges();
      setTimeout(() => setSaveStatus('idle'), 1500);

    } catch (err) {
      console.error('Failed to remove highlight:', err);
      setSaveStatus('error');
      addToast(`Error: ${err.message}`, 'danger');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  };

  const handleEraseHighlight = async () => {
    if (!isTauri()) return;
    if (!selectedHighlight || !currentBook?.path) return;
    
    try {
      setSaveStatus('saving');
      const { readFile, writeFile } = await import('@tauri-apps/plugin-fs');
      const { PDFDocument, PDFName, PDFArray, PDFDict } = await import('pdf-lib');

      const bytes = await readFile(currentBook.path);
      const pdfDoc = await PDFDocument.load(bytes);
      const pageIndex = selectedHighlight.page - 1;
      
      if (pageIndex < 0 || pageIndex >= pdfDoc.getPageCount()) {
        throw new Error('Invalid page index');
      }
      
      const pdfPage = pdfDoc.getPage(pageIndex);
      const annots = pdfPage.node.lookup(PDFName.of('Annots'));
      
      if (annots instanceof PDFArray) {
        let foundIndex = -1;
        for (let i = 0; i < annots.size(); i++) {
          const annot = annots.lookup(i);
          if (annot instanceof PDFDict) {
            const rect = annot.lookup(PDFName.of('Rect'));
            if (rect instanceof PDFArray && rect.size() === 4) {
              const [ax1, ay1, ax2, ay2] = rect.asArray().map(n => n.asNumber());
              const [sx1, sy1, sx2, sy2] = selectedHighlight.rect;
              
              // Floating point tolerance
              const match = Math.abs(ax1 - sx1) < 0.1 && 
                            Math.abs(ay1 - sy1) < 0.1 && 
                            Math.abs(ax2 - sx2) < 0.1 && 
                            Math.abs(ay2 - sy2) < 0.1;
              
              if (match) {
                foundIndex = i;
                break;
              }
            }
          }
        }
        
        if (foundIndex !== -1) {
          annots.remove(foundIndex);
          const pdfBytes = await pdfDoc.save();
          await writeFile(currentBook.path, pdfBytes);
          
          addToast('Highlight erased permanently', 'success');
          setSelectedHighlight(null);
          setSaveStatus('success');
          setTimeout(() => setSaveStatus('idle'), 1500);
        } else {
          addToast('Highlight not found in PDF structure', 'info');
          setSaveStatus('idle');
          setSelectedHighlight(null);
        }
      } else {
        addToast('No annotations found on this page', 'info');
        setSaveStatus('idle');
      }
    } catch (err) {
      console.error('Failed to erase highlight:', err);
      addToast(`Eraser Error: ${err.message}`, 'danger');
      setSaveStatus('idle');
    }
  };

  // ── Ctrl+Wheel zoom; plain wheel → page turn in single-page mode ─────────
  useEffect(() => {
    const handleWheel = (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
        if (e.deltaY < 0) setScale(s => Math.min(s + 0.15, 3.0));
        else setScale(s => Math.max(s - 0.15, 0.5));
        return;
      }

      // Single-page mode: turn page when scrolled past top/bottom edge
      if (!infiniteScroll && contentRef.current) {
        const container = contentRef.current;
        const atBottom = Math.ceil(container.scrollHeight - container.scrollTop) <= container.clientHeight + 5;
        const atTop = container.scrollTop <= 5;
        if (e.deltaY > 0 && atBottom) {
          setPage(p => totalPages ? Math.min(p + 1, totalPages) : p + 1);
          container.scrollTop = 0;
        } else if (e.deltaY < 0 && atTop) {
          setPage(p => Math.max(p - 1, 1));
        }
      }
    };
    window.addEventListener('wheel', handleWheel, { passive: false });
    return () => window.removeEventListener('wheel', handleWheel);
  }, [infiniteScroll, totalPages]);

  // ── Dictionary lookup ───────────────────────────────────────────────────
  useEffect(() => {
    const handleMouseUp = async (e) => {
      const selection = window.getSelection();
      const word = selection.toString().trim();

      if (word && word.length > 1 && word.length < 35 && !word.includes('\n')) {
        // Abort previous lookup if any
        if (dictAbortControllerRef.current) {
          dictAbortControllerRef.current.abort();
        }
        dictAbortControllerRef.current = new AbortController();

        const rect = selection.getRangeAt(0).getBoundingClientRect();
        setDictQuery({ 
          word, 
          loading: true, 
          x: rect.left + (rect.width / 2), 
          y: rect.top - 10, 
          data: null 
        });

        try {
          // Allow apostrophes and hyphens in dictionary words
          const cleanWord = word.replace(/[^a-zA-Z'-]/g, '').toLowerCase();
          if (!cleanWord || cleanWord === '-' || cleanWord === "'") throw new Error('Invalid word');

          const signal = dictAbortControllerRef.current.signal;
          const fetchPromise = fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${cleanWord}`, { signal });
          
          // 8s timeout for dictionary lookup
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Timeout')), 8000)
          );

          const res = await Promise.race([fetchPromise, timeoutPromise]);
          
          if (!res.ok) throw new Error('Definition not found');
          const data = await res.json();
          
          if (!Array.isArray(data) || !data[0]) throw new Error('Invalid response');

          setDictQuery(prev => 
            prev && prev.word === word 
              ? { ...prev, loading: false, data: data[0] } 
              : prev
          );
        } catch (err) {
          if (err.name === 'AbortError') return;
          console.warn('Dictionary error:', err.message);
          setDictQuery(prev => 
            prev && prev.word === word 
              ? { ...prev, loading: false, error: err.message === 'Timeout' ? 'Request timed out.' : 'Definition not found.' } 
              : prev
          );
        } finally {
          dictAbortControllerRef.current = null;
        }
      } else {
        if (selection.isCollapsed) {
          // Transparent Hit-Testing (since annoLayer is behind textLayer for selection priority)
          const elements = document.elementsFromPoint(e.clientX, e.clientY);
          const overlay = elements.find(el => el.classList.contains('pdf-anno-overlay'));
          
          if (overlay) {
            // Overlays in ISR/Renderer have an onclick that sets the highlight
            overlay.click();
          } else {
            if (!e.target.closest('.dictionary-popover')) {
              setSelectedHighlight(null);
            }
          }
        }
        
        if (e.target.closest('.dictionary-popover')) return;
        setDictQuery(null);
      }
    };
    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, []);



  // ── Go-to-page ──────────────────────────────────────────────────────────
  const handleGoToPage = () => {
    const num = parseInt(goToPageInput, 10);
    if (num >= 1 && (!totalPages || num <= totalPages)) {
      setPage(num);
      readerRef.current?.scrollToPage(num);
    }
    setShowGoToPage(false);
    setGoToPageInput('');
  };

  useEffect(() => {
    if (showGoToPage && goToPageRef.current) {
      goToPageRef.current.focus();
    }
  }, [showGoToPage]);

  // ── Night mode + Brightness filter ─────────────────────────────────────
  const combinedFilter = useMemo(() => {
    const filters = [];
    const mode = settings.readerMode || 'light';

    // ── Mode-Specific Filters ──
    switch (mode) {
      case 'sepia':
        // Exact match via mix-blend-mode in CSS
        filters.push('contrast(0.9)');
        break;
      case 'dark': // Dust
        filters.push('invert(0.9) hue-rotate(180deg) brightness(1.0)');
        break;
      case 'nord':
        filters.push('invert(0.9) hue-rotate(170deg) brightness(1.1) contrast(0.9)');
        break;
      case 'sunset':
        // Target: #1a1a2e
        filters.push('invert(1) hue-rotate(185deg) brightness(0.6) contrast(1.1)');
        break;
      case 'midnight':
        filters.push('invert(0.9) hue-rotate(180deg) brightness(1.0)');
        break;
      case 'oled':
        filters.push('invert(1) hue-rotate(180deg) brightness(1.0)');
        break;
      case 'matcha':
        // Target: #1b1e17
        filters.push('invert(1) hue-rotate(100deg) brightness(0.6) contrast(1.1)');
        break;
      case 'coffee':
        // Target: #1a1614
        filters.push('invert(1) hue-rotate(30deg) sepia(0.3) brightness(0.6) contrast(1.1)');
        break;
      case 'solarized':
        // Target: #002b36
        filters.push('invert(1) hue-rotate(165deg) brightness(0.8) contrast(1.1)');
        break;
      case 'ocean':
        // Target: #0d1b2a
        filters.push('invert(1) hue-rotate(195deg) brightness(0.7) contrast(1.0)');
        break;
      case 'rose':
        // Target: #1e1a1b
        filters.push('invert(1) hue-rotate(320deg) sepia(0.2) brightness(0.7)');
        break;
      default:
        break;
    }

    // ── Global Brightness Overlays ──
    const brightnessVal = settings.brightness || 100;
    if (brightnessVal !== 100) {
      filters.push(`brightness(${brightnessVal}%)`);
    }

    return filters.length > 0 ? filters.join(' ') : 'none';
  }, [settings.readerMode, settings.brightness]);

  const bookmarksList = [];

  const READER_MODES = [
    { id: 'light', label: 'Day', color: '#f5f6f8', theme: 'light' },
    { id: 'sepia', label: 'Paper', color: '#f4ecd8', theme: 'sepia' },
    { id: 'nord', label: 'Nordic', color: '#2e3440', theme: 'nord' },
    { id: 'midnight', label: 'Midnight', color: '#1a1a1a', theme: 'midnight' },
    { id: 'oled', label: 'OLED', color: '#000000', theme: 'midnight' }
  ];

  const handleSetMode = (mode) => {
    updateSettings({ readerMode: mode.id });
    updateTheme(mode.theme);
    setShowPalette(false);
  };

  const handleBrightnessReset = (e) => {
    if (e) e.stopPropagation();
    if (settings.enableBrightnessReset !== false) {
      updateSettings({ brightness: settings.brightnessResetValue || 100 });
    }
  };

  return (
    <div className={`reader-container ${isFullscreen ? 'fullscreen-active' : ''} ${showControls ? '' : 'controls-hidden'}`}>

      {/* ─── Progress Bar (top) ─── */}
      {settings.showBookProgress !== false && !isFullscreen && (
        <div className={`reader-progress-bar ${showControls ? 'visible' : 'hidden'}`}>
          <div className="reader-progress-fill" style={{ width: `${progressPercent}%` }} />
        </div>
      )}

      {/* TOC Panel Removed */}

      {/* ─── PDF Content ─── */}
      <main className={`reader-content ${infiniteScroll ? 'reader-content-isr' : 'reader-content-single'}`} ref={infiniteScroll ? undefined : contentRef}>
        {bookPath ? (
          <div className="pdf-wrapper">
             {infiniteScroll ? (
               <InfiniteScrollReader
                 ref={readerRef}
                 filePath={bookPath}
                 scale={scale}
                 showGlow={settings.pageGlow}
                 onPageChange={handlePageChange}
                 onTotalPages={handleTotalPages}
                 filter={combinedFilter}
                 onHighlightClick={setSelectedHighlight}
                 selectedHighlight={selectedHighlight}
               />
             ) : (
               <PdfRenderer
                 filePath={bookPath}
                 scale={scale}
                 pageNumber={page}
                 showGlow={settings.pageGlow}
                 filter={combinedFilter}
                 onHighlightClick={setSelectedHighlight}
                 selectedHighlight={selectedHighlight}
                 onPageLoad={(pdfPage, viewport, numPages) => {
                  if (numPages && bookPath && numPages !== totalPagesMap[bookPath]) {
                    setBookTotalPages(bookPath, numPages);
                    setTotalPages(numPages);
                  }
                }}
              />
            )}
          </div>
        ) : (
          <div className="no-book-state">
            <div className="empty-page-placeholder">
              <p>No valid PDF source provided.</p>
            </div>
          </div>
        )}
      </main>

      {/* ─── Floating Controls (auto-hide) ─── */}
      {!isFullscreen && (
        <div className={`reader-controls ${showControls ? 'visible' : 'hidden'}`}>

        {/* Top-left: Back + TOC */}
        <div className="ctrl-group ctrl-top-left">
          <div className="ctrl-pill">
            <Tooltip content="Back to Library" position="bottom">
              <button className="icon-btn-sm" onClick={() => { updateBookProgress(currentBook?.path, page); closeBook(); }}>
                <ArrowLeft size={16} />
              </button>
            </Tooltip>
          </div>
        </div>

        {/* Top-right: Night mode + Fullscreen + Bookmark */}
        <div className="ctrl-group ctrl-top-right">
          <div className="ctrl-pill">
            <Tooltip content={infiniteScroll ? 'Single Page Mode' : 'Infinite Scroll Mode'} position="bottom">
              <button
                className={`icon-btn-sm ${infiniteScroll ? 'active' : ''}`}
                onClick={() => updateSettings({ infiniteScroll: !infiniteScroll })}
              >
                <Columns size={16} />
              </button>
            </Tooltip>
            {/* Removed redundant palette icon here */}
            {settings.enableHighlighting !== false && (
              <>
                <Tooltip content="Highlight Selection (H)" position="bottom">
                  <button 
                    className={`icon-btn-sm highlight-btn ${saveStatus === 'success' ? 'status-success' : ''} ${saveStatus === 'saving' ? 'status-saving' : ''}`} 
                    onClick={handleSaveHighlight}
                  >
                    {saveStatus === 'success' ? <Check size={16} className="animate-pop" /> : <Highlighter size={16} />}
                  </button>
                </Tooltip>
                <Tooltip content="Remove Highlight (X)" position="bottom">
                  <button className="icon-btn-sm" onClick={handleRemoveHighlight}>
                    <Eraser size={16} />
                  </button>
                </Tooltip>
              </>
            )}
            <div className="ctrl-divider" />

            <div 
              className="ctrl-brightness-group"
              style={{ cursor: 'pointer' }}
              onWheel={(e) => {
                e.stopPropagation();
                const current = settings.brightness || 100;
                const delta = e.deltaY < 0 ? 5 : -5;
                updateSettings({ brightness: Math.min(Math.max(current + delta, 50), 150) });
              }}
              onDoubleClick={handleBrightnessReset}
              title={settings.enableBrightnessReset !== false ? `Double-click to reset brightness (${settings.brightnessResetValue || 100}%)` : 'Brightness Controls'}
            >
              <Sun 
                size={14} 
                className="ctrl-brightness-icon" 
                onDoubleClick={handleBrightnessReset}
              />
              <input
                type="range"
                min="50"
                max="150"
                value={settings.brightness || 100}
                onChange={e => updateSettings({ brightness: parseInt(e.target.value) })}
                onDoubleClick={handleBrightnessReset}
                className="brightness-slider-mini"
              />
            </div>

            <div className="ctrl-divider" />

            <Tooltip content="Toggle Fullscreen" position="bottom">
              <button className="icon-btn-sm" onClick={toggleFullscreen}>
                {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
              </button>
            </Tooltip>
            <Tooltip content="Settings" position="bottom">
              <button className="icon-btn-sm" onClick={openSettingsWindow}>
                <Settings size={16} />
              </button>
            </Tooltip>

            <div className="ctrl-divider" />

            <div className="palette-container" ref={paletteRef}>
              <Tooltip content="Reading Mode / Palette" position="bottom">
                <button 
                  className={`icon-btn-sm ${showPalette ? 'active' : ''}`} 
                  onClick={() => setShowPalette(!showPalette)}
                >
                  <Palette size={16} />
                </button>
              </Tooltip>

              {showPalette && (
                <div className="palette-tray animate-scale-in">
                  {READER_MODES.map(m => (
                    <div
                      key={m.id}
                      className={`palette-swatch ${settings.readerMode === m.id ? 'active' : ''}`}
                      style={{ background: m.color }}
                      onClick={() => handleSetMode(m)}
                      title={m.label}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Bottom-center: Page navigation + Zoom */}
        <div className="ctrl-group ctrl-bottom-center">
          <div className="ctrl-pill ctrl-pill-wide">
            <Tooltip content="Previous Page">
              <button className="icon-btn-sm" onClick={() => {
                const prev = Math.max(page - 1, 1);
                setPage(prev);
                readerRef.current?.scrollToPage(prev);
              }}>
                <ChevronLeft size={16} />
              </button>
            </Tooltip>

            <button className="page-indicator mono" onClick={() => setShowGoToPage(true)}>
              {page}{totalPages > 0 ? ` / ${totalPages}` : ''}
            </button>

            <Tooltip content="Next Page">
              <button className="icon-btn-sm" onClick={() => {
                const next = totalPages ? Math.min(page + 1, totalPages) : page + 1;
                setPage(next);
                readerRef.current?.scrollToPage(next);
              }}>
                <ChevronRight size={16} />
              </button>
            </Tooltip>

            {settings.enableHighlighting !== false && (
              <>
                <div className="ctrl-divider" />
                <Tooltip content={selectedHighlight ? "Erase Selected (Del)" : "Select a highlight to erase"}>
                  <button 
                    className={`icon-btn-md highlight-btn ${saveStatus === 'saving' ? 'status-saving' : ''} ${selectedHighlight ? 'pulse-active' : ''}`}
                    onClick={handleEraseHighlight}
                    disabled={saveStatus === 'saving' || !selectedHighlight}
                    style={{ color: selectedHighlight ? 'var(--ink-danger)' : 'inherit' }}
                  >
                    <Eraser size={18} />
                  </button>
                </Tooltip>
              </>
            )}

            <div className="ctrl-divider" />

            <Tooltip content="Zoom Out">
              <button className="icon-btn-sm" onClick={handleZoomOut}>
                <ZoomOut size={15} />
              </button>
            </Tooltip>

            <span className="zoom-label mono">{Math.round(scale * 100)}%</span>

            <Tooltip content="Zoom In">
              <button className="icon-btn-sm" onClick={handleZoomIn}>
                <ZoomIn size={15} />
              </button>
            </Tooltip>

            {settings.showReadingTime && totalPages > 0 && (
              <>
                <div className="ctrl-divider" />
                <span className="reading-time">{readingTimeMin > 0 ? `~${readingTimeMin}m left` : 'Almost done'}</span>
              </>
            )}
          </div>
        </div>
        </div>
      )}


      {/* ─── Go To Page Popover ─── */}
      {showGoToPage && (
        <div className="goto-backdrop" onClick={() => setShowGoToPage(false)}>
          <div className="goto-modal" onClick={e => e.stopPropagation()}>
            <label className="goto-label">Go to page</label>
            <input
              ref={goToPageRef}
              type="number"
              className="goto-input mono"
              placeholder={`1 – ${totalPages || '?'}`}
              value={goToPageInput}
              onChange={e => setGoToPageInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleGoToPage();
                if (e.key === 'Escape') setShowGoToPage(false);
              }}
              min={1}
              max={totalPages || undefined}
            />
            <button className="btn-primary" onClick={handleGoToPage} style={{ width: '100%', justifyContent: 'center' }}>Go</button>
          </div>
        </div>
      )}

      {/* ─── Dictionary Popover ─── */}
      {dictQuery && (
        <div className="dictionary-popover" style={{
          left: `${Math.min(Math.max(dictQuery.x - 150, 10), window.innerWidth - 340)}px`,
          top: `${Math.max(dictQuery.y - (dictQuery.data ? 120 : 60) - window.scrollY, 20)}px`
        }}>
          <h3>{dictQuery.word}</h3>
          {dictQuery.loading ? (
            <p style={{ color: 'var(--ink-text-tertiary)' }}>Looking up meaning...</p>
          ) : dictQuery.error ? (
            <p className="pos" style={{ fontStyle: 'normal', color: 'var(--ink-text-tertiary)' }}>{dictQuery.error}</p>
          ) : dictQuery.data && dictQuery.data.meanings ? (
            <>
              {dictQuery.data.meanings[0] && (
                <>
                  <span className="pos">{dictQuery.data.meanings[0].partOfSpeech}</span>
                  <p>{dictQuery.data.meanings[0].definitions[0].definition}</p>
                </>
              )}
            </>
          ) : (
            <p className="pos">No definition available.</p>
          )}
        </div>
      )}
    </div>
  );
};

export default ReaderView;
