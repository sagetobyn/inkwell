import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAppContext } from '../context/AppContext';
import { useToast } from '../components/Toast';
import Tooltip from '../components/Tooltip';
import {
  ArrowLeft, ZoomIn, ZoomOut, Maximize, Minimize,
  Moon, Sun, BookmarkPlus, Bookmark, List, ChevronLeft,
  ChevronRight, Columns, Minus, Type
} from 'lucide-react';
import InfiniteScrollReader from '../components/InfiniteScrollReader';
import PdfRenderer from '../components/PdfRenderer';
import './ReaderView.css';

const ReaderView = () => {
  const {
    closeBook, currentBook, shortcuts, bookProgress, updateBookProgress,
    pdfNightMode, togglePdfNightMode, settings, updateSettings,
    addBookmark, removeBookmark, isBookmarked, getBookmarks, setBookTotalPages,
    totalPagesMap
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

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [dictQuery, setDictQuery] = useState(null);
  const [showToc, setShowToc] = useState(false);
  const [tocItems] = useState([]);
  const [showControls, setShowControls] = useState(true);
  const [showGoToPage, setShowGoToPage] = useState(false);
  const [goToPageInput, setGoToPageInput] = useState('');

  const readerRef = useRef(null);   // ref to InfiniteScrollReader (exposes scrollToPage)
  const controlsTimeout = useRef(null);
  const goToPageRef = useRef(null);

  const bookPath = currentBook?.path || null;

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
  const toggleFullscreen = async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const appWindow = getCurrentWindow();
      const current = await appWindow.isFullscreen();
      await appWindow.setFullscreen(!current);
      setIsFullscreen(!current);
    } catch (err) {
      console.error('Fullscreen API error:', err);
    }
  };

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
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('scroll', handleScroll, true);
    resetControlsTimer();
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('scroll', handleScroll, true);
      if (controlsTimeout.current) clearTimeout(controlsTimeout.current);
    };
  }, [resetControlsTimer, settings.readerZenMode]);

  // ── Keyboard shortcuts ──────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (showGoToPage) return;
      if (dictQuery) setDictQuery(null);

      if (e.key === shortcuts.fullscreen) { e.preventDefault(); toggleFullscreen(); }
      if (e.key === shortcuts.toggleToc) { e.preventDefault(); setShowToc(t => !t); }
      if (e.key === shortcuts.toggleNightMode) { e.preventDefault(); togglePdfNightMode(); }
      if (e.key === shortcuts.goToPage) { e.preventDefault(); setShowGoToPage(true); }
      if (e.key === shortcuts.backToLibrary) { e.preventDefault(); updateBookProgress(currentBook?.path, page); closeBook(); }
      if (e.key === shortcuts.zoomIn || (e.ctrlKey && e.key === '=')) { e.preventDefault(); handleZoomIn(); }
      if (e.key === shortcuts.zoomOut || (e.ctrlKey && e.key === '-')) { e.preventDefault(); handleZoomOut(); }

      // Ctrl+D to bookmark
      if (e.ctrlKey && e.key === 'd') {
        e.preventDefault();
        if (bookPath) {
          if (isBookmarked(bookPath, page)) {
            removeBookmark(bookPath, page);
            addToast('Bookmark removed', 'info');
          } else {
            addBookmark(bookPath, page);
            addToast(`Page ${page} bookmarked`, 'success');
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [shortcuts, dictQuery, page, totalPages, showGoToPage, bookPath]);

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

      if (word && word.length > 1 && word.length < 25 && !word.includes(' ')) {
        const rect = selection.getRangeAt(0).getBoundingClientRect();
        setDictQuery({ word, loading: true, x: rect.left + (rect.width / 2), y: rect.top - 10, data: null });

        try {
          const cleanWord = word.replace(/[^a-zA-Z]/g, '').toLowerCase();
          if (!cleanWord) throw new Error('Invalid word');
          const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${cleanWord}`);
          if (!res.ok) throw new Error('Not found');
          const data = await res.json();
          setDictQuery(prev => prev && prev.word === word ? { ...prev, loading: false, data: data[0] } : prev);
        } catch (err) {
          setDictQuery(prev => prev && prev.word === word ? { ...prev, loading: false, error: 'Definition not found.' } : prev);
        }
      } else {
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
    if (pdfNightMode) {
      if (settings.nightModeType === 'sepia') {
        const warmth = settings.sepiaWarmth || 50;
        filters.push(`sepia(${warmth / 100}) brightness(0.9) contrast(0.95)`);
      } else {
        filters.push('invert(0.88) hue-rotate(180deg) contrast(0.95)');
      }
    }
    const brightnessVal = settings.brightness || 100;
    if (brightnessVal !== 100) {
      filters.push(`brightness(${brightnessVal}%)`);
    }
    return filters.length > 0 ? filters.join(' ') : 'none';
  }, [pdfNightMode, settings.nightModeType, settings.sepiaWarmth, settings.brightness]);

  const currentBookmarked = bookPath ? isBookmarked(bookPath, page) : false;
  const bookmarksList = bookPath ? getBookmarks(bookPath) : [];

  return (
    <div className={`reader-container ${isFullscreen ? 'fullscreen-active' : ''} ${showControls ? '' : 'controls-hidden'}`}>

      {/* ─── Progress Bar (top) ─── */}
      {settings.showBookProgress !== false && (
        <div className={`reader-progress-bar ${showControls ? 'visible' : 'hidden'}`}>
          <div className="reader-progress-fill" style={{ width: `${progressPercent}%` }} />
        </div>
      )}

      {/* ─── TOC Panel ─── */}
      <aside className={`toc-panel ${showToc ? 'open' : ''}`}>
        <div className="toc-header">
          <h3>Contents</h3>
          <button className="icon-btn-sm" onClick={() => setShowToc(false)}>
            <ChevronLeft size={16} />
          </button>
        </div>

        {bookmarksList.length > 0 && (
          <div className="toc-section">
            <div className="toc-section-title">Bookmarks</div>
            {bookmarksList.map(pg => (
              <button
                key={pg}
                className={`toc-item ${pg === page ? 'active' : ''}`}
                onClick={() => { setPage(pg); readerRef.current?.scrollToPage(pg); }}
              >
                <Bookmark size={13} />
                <span>Page {pg}</span>
              </button>
            ))}
          </div>
        )}

        {tocItems.length > 0 && (
          <div className="toc-section">
            <div className="toc-section-title">Outline</div>
            {tocItems.map((item, i) => (
              <button
                key={i}
                className="toc-item"
                style={{ paddingLeft: `${(item.level || 0) * 12 + 12}px` }}
                onClick={() => item.page && (setPage(item.page), readerRef.current?.scrollToPage(item.page))}
              >
                <span>{item.title}</span>
              </button>
            ))}
          </div>
        )}

        {bookmarksList.length === 0 && tocItems.length === 0 && (
          <div className="toc-empty">
            <p>No outline or bookmarks yet.</p>
            <p className="toc-hint">Press Ctrl+D to bookmark a page.</p>
          </div>
        )}
      </aside>

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
              />
            ) : (
              <PdfRenderer
                filePath={bookPath}
                scale={scale}
                pageNumber={page}
                showGlow={settings.pageGlow}
                filter={combinedFilter}
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
      <div className={`reader-controls ${showControls ? 'visible' : 'hidden'}`}>

        {/* Top-left: Back + TOC */}
        <div className="ctrl-group ctrl-top-left">
          <div className="ctrl-pill">
            <Tooltip content="Back to Library">
              <button className="icon-btn-sm" onClick={() => { updateBookProgress(currentBook?.path, page); closeBook(); }}>
                <ArrowLeft size={16} />
              </button>
            </Tooltip>
            <div className="ctrl-divider" />
            <Tooltip content="Table of Contents (T)">
              <button className={`icon-btn-sm ${showToc ? 'active' : ''}`} onClick={() => setShowToc(t => !t)}>
                <List size={16} />
              </button>
            </Tooltip>
          </div>
        </div>

        {/* Top-right: Night mode + Fullscreen + Bookmark */}
        <div className="ctrl-group ctrl-top-right">
          <div className="ctrl-pill">
            <Tooltip content={infiniteScroll ? 'Single Page Mode' : 'Infinite Scroll Mode'}>
              <button 
                className={`icon-btn-sm ${infiniteScroll ? 'active' : ''}`} 
                onClick={() => updateSettings({ infiniteScroll: !infiniteScroll })}
              >
                <Columns size={16} />
              </button>
            </Tooltip>
            <Tooltip content={pdfNightMode ? 'Day Mode (N)' : 'Night Mode (N)'}>
              <button className="icon-btn-sm" onClick={togglePdfNightMode}>
                {pdfNightMode ? <Sun size={16} /> : <Moon size={16} />}
              </button>
            </Tooltip>
            <Tooltip content={currentBookmarked ? 'Remove Bookmark (Ctrl+D)' : 'Bookmark Page (Ctrl+D)'}>
              <button className={`icon-btn-sm ${currentBookmarked ? 'active' : ''}`} onClick={() => {
                if (bookPath) {
                  if (currentBookmarked) {
                    removeBookmark(bookPath, page);
                    addToast('Bookmark removed', 'info');
                  } else {
                    addBookmark(bookPath, page);
                    addToast(`Page ${page} bookmarked`, 'success');
                  }
                }
              }}>
                {currentBookmarked ? <Bookmark size={16} fill="currentColor" /> : <BookmarkPlus size={16} />}
              </button>
            </Tooltip>
            <div className="ctrl-divider" />

            <div className="ctrl-brightness-group">
              <Sun size={14} className="ctrl-brightness-icon" />
              <input
                type="range"
                min="50"
                max="150"
                value={settings.brightness || 100}
                onChange={e => updateSettings({ brightness: parseInt(e.target.value) })}
                className="brightness-slider-mini"
              />
            </div>

            <div className="ctrl-divider" />

            <Tooltip content="Toggle Fullscreen">
              <button className="icon-btn-sm" onClick={toggleFullscreen}>
                {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
              </button>
            </Tooltip>
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

      {/* ─── Page Slider ─── */}
      {totalPages > 0 && showControls && (
        <div className="page-slider-container">
          <input
            type="range"
            className="page-slider"
            min={1}
            max={totalPages}
            value={page}
            onChange={e => {
              const p = parseInt(e.target.value, 10);
              setPage(p);
              readerRef.current?.scrollToPage(p);
            }}
          />
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
            <p className="pos">{dictQuery.error}</p>
          ) : dictQuery.data ? (
            <>
              {dictQuery.data.meanings[0] && (
                <>
                  <span className="pos">{dictQuery.data.meanings[0].partOfSpeech}</span>
                  <p>{dictQuery.data.meanings[0].definitions[0].definition}</p>
                </>
              )}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
};

export default ReaderView;
