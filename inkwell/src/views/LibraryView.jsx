import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useAppContext } from '../context/AppContext';
import { useToast } from '../components/Toast';
import Tooltip from '../components/Tooltip';
import ContextMenu from '../components/ContextMenu';
import ProgressRing from '../components/ProgressRing';
import {
  Settings, Plus, Search, BookOpen, Folder, Trash2, RefreshCw,
  Grid3X3, List, ChevronDown, Heart, Clock, Star,
  ArrowUpDown, PanelLeftClose, PanelLeft, Import, FilePlus,
  MoreVertical, ExternalLink, BookMarked, Command,
  Play, Flame, BookText, Library, FolderOpen, LayoutDashboard,
  Pin, PinOff
} from 'lucide-react';
import './LibraryView.css';

// Stable memoized component — MUST be outside LibraryView to prevent flicker
const BookCover = React.memo(({ book, isList, isRecent, isFav, isHero, thumbnailFileName, getThumbnailUrl, showCovers, isFavoriteCheck }) => {
  const [url, setUrl] = useState(null);

  useEffect(() => {
    let active = true;
    if (showCovers !== false && thumbnailFileName && getThumbnailUrl) {
      getThumbnailUrl(thumbnailFileName).then(resolved => {
        if (active) setUrl(resolved);
      });
    } else {
      setUrl(null);
    }
    return () => { active = false; };
  }, [thumbnailFileName, getThumbnailUrl, showCovers]);

  const letterChar = book.name.charAt(0).toUpperCase();

  if (isHero) {
    return (
      <div className="hero-cover" style={{ background: book.coverColor }}>
        {url ? (
          <img
            src={url}
            alt=""
            className="hero-cover-img book-cover-img"
            loading="lazy"
            onLoad={() => console.log(`[Thumbnails] Successfully loaded hero cover: ${url}`)}
            onError={() => {
              console.warn(`[Thumbnails] Failed to load hero cover: ${url}`);
              setUrl(null);
            }}
          />
        ) : (
          <span className="hero-cover-letter">{letterChar}</span>
        )}
      </div>
    );
  }

  if (isFav) {
    return (
      <div className="favorite-cover" style={{ background: book.coverColor }}>
        {url ? (
          <img
            src={url}
            alt=""
            className="book-cover-img"
            loading="lazy"
            onLoad={() => console.log(`[Thumbnails] Successfully loaded favorite cover: ${url}`)}
            onError={() => {
              console.warn(`[Thumbnails] Failed to load favorite cover: ${url}`);
              setUrl(null);
            }}
          />
        ) : (
          <span className="favorite-cover-letter">{letterChar}</span>
        )}
        <div className="favorite-badge">
          <Heart size={10} fill="currentColor" />
        </div>
      </div>
    );
  }

  const fallback = (
    <span className={isList ? '' : (isRecent ? 'recent-cover-letter' : 'book-cover-letter')}>
      {letterChar}
    </span>
  );

  let className = 'book-cover';
  if (isList) className = 'book-list-cover';
  if (isRecent) className = 'recent-cover';

  return (
    <div className={className} style={{ background: book.coverColor }}>
      <div className="book-spine-detail" />
      {url ? (
        <img
          src={url}
          alt=""
          className="book-cover-img"
          loading="lazy"
          onLoad={() => console.log(`[Thumbnails] Successfully loaded cover: ${url}`)}
          onError={() => {
            console.warn(`[Thumbnails] Failed to load cover: ${url}`);
            setUrl(null);
          }}
        />
      ) : fallback}

      {!isList && !isRecent && isFavoriteCheck && (
        <div className="book-fav-badge">
          <Heart size={10} fill="currentColor" />
        </div>
      )}
    </div>
  );
});

const LibraryView = () => {
  const {
    setCurrentView, openBook, categories, activeCategoryId, setActiveCategoryId,
    books, scanError, isScanning, addCategory, removeCategory, importPDF, refreshLibrary,
    searchQuery, setSearchQuery, viewMode, updateViewMode, sortOrder, updateSortOrder,
    sidebarCollapsed, setSidebarCollapsed, recentBooks, isFavorite, toggleFavorite,
    setCommandPaletteOpen, settings, updateSettings, removeImportedBook, bookProgress, totalPagesMap,
    thumbnailsMap, getThumbnailUrl, continueReadingBook, computedStats, favoriteBookIds,
    pinnedSubfolders, togglePinSubfolder, isSubfolderPinned, activeSubfolder, setActiveSubfolder,
    openSettingsWindow
  } = useAppContext();

  const addToast = useToast();
  const [contextMenu, setContextMenu] = useState(null);
  const [isDragging, setIsDragging] = useState(false);


  const activeCategoryName = categories.find(c => c.id === activeCategoryId)?.name || "Library";
  const bookCount = books.length;

  const handleContextMenu = (e, book) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      book,
    });
  };

  const getContextMenuItems = (book) => [
    { label: 'Open', icon: <BookOpen size={14} />, action: () => openBook(book) },
    {
      label: isFavorite(book.path) ? 'Remove from Favorites' : 'Add to Favorites', icon: <Heart size={14} />, action: () => {
        const nowFav = toggleFavorite(book.path);
        addToast(nowFav ? 'Added to favorites' : 'Removed from favorites', 'success');
      }
    },
    { divider: true },
    {
      label: 'Remove from Library', icon: <Trash2 size={14} />, danger: true, action: () => {
        removeImportedBook(book.path);
        addToast('Removed from library', 'info');
      }
    },
  ];

  // Drag and drop handlers
  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
    // Note: Tauri handles file drops differently — this is a visual indicator
    addToast('Use "Import PDF" to add files', 'info');
  }, []);

  const getBookProgress = (book) => {
    const prog = bookProgress[book.path];
    const total = totalPagesMap[book.path];
    if (prog && total && total > 0) {
      return Math.round((prog.page / total) * 100);
    }
    return 0;
  };

  // Get all favorite books
  const favoriteBooks = useMemo(() => {
    return books.filter(b => isFavorite(b.path));
  }, [books, favoriteBookIds]);

  // ─── Continue Reading Hero ───
  const renderHeroSection = () => {
    if (settings.showHeroSection === false || !continueReadingBook || searchQuery) return null;

    const progress = getBookProgress(continueReadingBook);
    const displayName = settings.showFileExtensions !== false
      ? continueReadingBook.name
      : continueReadingBook.name.replace(/\.pdf$/i, '');
    const prog = bookProgress[continueReadingBook.path];
    const total = totalPagesMap[continueReadingBook.path];
    const pageInfo = prog && total ? `Page ${prog.page} of ${total}` : '';

    return (
      <section className="hero-section">
        <div
          className="hero-card"
          onClick={() => openBook(continueReadingBook)}
        >
          <BookCover
            book={continueReadingBook}
            isHero={true}
            thumbnailFileName={thumbnailsMap[continueReadingBook.path]}
            getThumbnailUrl={getThumbnailUrl}
            showCovers={settings.showBookCovers}
          />

          <div className="hero-info">
            <div className="hero-label">
              <div className="hero-label-dot" />
              Continue Reading
            </div>
            <h2 className="hero-title truncate">{displayName}</h2>
            <div className="hero-meta">
              {pageInfo && <span>{pageInfo}</span>}
              {settings.showBookProgress !== false && progress > 0 && <span>{progress}% complete</span>}
            </div>
            <button
              className="hero-resume-btn"
              onClick={(e) => { e.stopPropagation(); openBook(continueReadingBook); }}
            >
              <Play size={14} fill="currentColor" />
              Resume Reading
            </button>
          </div>

          {settings.showBookProgress !== false && (
            <div className="hero-progress-ring">
              <ProgressRing progress={progress} size={80} stroke={5} />
              <span className="hero-progress-text">{progress}%</span>
            </div>
          )}
        </div>
      </section>
    );
  };

  // ─── Reading Stats Strip ───
  const renderStatsStrip = () => {
    if (books.length === 0 || searchQuery || settings.showLibraryStats === false) return null;

    return (
      <section className="stats-strip stagger-parent">
        <div className="stat-card stagger-child">
          <Library size={18} className="stat-card-icon" />
          <span className="stat-card-value">{computedStats.booksInLibrary}</span>
          <span className="stat-card-label">In Library</span>
        </div>
        <div className="stat-card stagger-child">
          <BookText size={18} className="stat-card-icon" />
          <span className="stat-card-value">{computedStats.totalPagesRead}</span>
          <span className="stat-card-label">Pages Read</span>
        </div>
        <div className="stat-card stagger-child">
          <BookOpen size={18} className="stat-card-icon" />
          <span className="stat-card-value">{computedStats.totalBooksOpened}</span>
          <span className="stat-card-label">Books Opened</span>
        </div>
        <div className="stat-card stagger-child">
          <Flame size={18} className="stat-card-icon" />
          <span className="stat-card-value">{computedStats.readingStreak}</span>
          <span className="stat-card-label">Day Streak</span>
        </div>
      </section>
    );
  };

  // ─── Favorites Shelf ───
  const renderFavoritesShelf = () => {
    if (favoriteBooks.length === 0 || searchQuery) return null;

    return (
      <section className="favorites-section">
        <div className="section-header-row">
          <Heart size={14} />
          <h3>Favorites</h3>
        </div>
        <div className="favorites-scroll">
          {favoriteBooks.map((book) => (
            <div
              key={book.id}
              className="favorite-card"
              onClick={() => openBook(book)}
              onContextMenu={(e) => handleContextMenu(e, book)}
            >
              <BookCover
                book={book}
                isFav={true}
                thumbnailFileName={thumbnailsMap[book.path]}
                getThumbnailUrl={getThumbnailUrl}
                showCovers={settings.showBookCovers}
              />
              <span className="favorite-name truncate">
                {settings.showFileExtensions !== false ? book.name : book.name.replace(/\.pdf$/i, '')}
              </span>
            </div>
          ))}
        </div>
      </section>
    );
  };

  // Handle Tauri native file drops
  useEffect(() => {
    let unlisten;
    const setupDropListener = async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        unlisten = await getCurrentWindow().onFileDropEvent((event) => {
          if (event.payload.type === 'hover') {
            setIsDragging(true);
          } else if (event.payload.type === 'cancel') {
            setIsDragging(false);
          } else if (event.payload.type === 'drop') {
            setIsDragging(false);
            const droppedPaths = event.payload.paths;
            const pdfs = droppedPaths.filter(p => p.toLowerCase().endsWith('.pdf'));
            if (pdfs.length > 0) {
              addToast(`Importing ${pdfs.length} files...`, 'success');
            }
          }
        });
      } catch (err) {
        console.error("Failed to setup drop listener", err);
      }
    };
    setupDropListener();
    return () => { if (unlisten) unlisten(); };
  }, [addToast]);

  // Group books by folder — MEMOIZED for performance
  const groupedBooks = useMemo(() => {
    return books.reduce((acc, book) => {
      const f = book.folder || 'Root';
      if (!acc[f]) acc[f] = [];
      acc[f].push(book);
      return acc;
    }, {});
  }, [books]);

  const renderBookGrid = () => {
      if (isScanning && books.length === 0) {
        return (
          <div className="books-grid">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="book-card-skeleton">
                <div className="skeleton" style={{ aspectRatio: '2/3', marginBottom: '0.75rem' }} />
                <div className="skeleton" style={{ height: '14px', width: '80%', marginBottom: '0.5rem' }} />
                <div className="skeleton" style={{ height: '10px', width: '50%' }} />
              </div>
            ))}
          </div>
        );
      }

      if (books.length === 0) {
        return (
          <div className="empty-state">
            <div className="empty-state-icon">
              <BookOpen size={48} strokeWidth={1.2} />
            </div>
            <h3>Your library is empty</h3>
            <p>Import a PDF or map a folder to start building your reading collection.</p>
            <div className="empty-state-cards">
              <div className="empty-action-card" onClick={importPDF}>
                <div className="empty-action-icon">
                  <FilePlus size={24} />
                </div>
                <span className="empty-action-label">Import PDF</span>
                <span className="empty-action-desc">Add individual files</span>
              </div>
              <div className="empty-action-card" onClick={addCategory}>
                <div className="empty-action-icon">
                  <FolderOpen size={24} />
                </div>
                <span className="empty-action-label">Map Folder</span>
                <span className="empty-action-desc">Watch an entire directory</span>
              </div>
            </div>
          </div>
        );
      }

      if (viewMode === 'list') {
        return (
          <div className="books-list">
            {books.map((book, index) => (
              <div
                key={book.id}
                className="book-list-item animate-slide-up"
                style={{ animationDelay: `${(index % 40) * 20}ms` }}
                onClick={() => openBook(book)}
                onContextMenu={(e) => handleContextMenu(e, book)}
              >
                <BookCover
                  book={book}
                  isList={true}
                  thumbnailFileName={thumbnailsMap[book.path]}
                  getThumbnailUrl={getThumbnailUrl}
                  showCovers={settings.showBookCovers}
                />
                <div className="book-list-info">
                  <span className="book-list-name truncate">{settings.showFileExtensions !== false ? book.name : book.name.replace(/\.pdf$/i, '')}</span>
                  <span className="book-list-meta">{book.folder || 'Library'}</span>
                </div>
                {settings.showBookProgress !== false && (
                  <div className="book-list-progress">
                    <div className="progress-bar-mini">
                      <div className="progress-fill-mini" style={{ width: `${getBookProgress(book)}%` }} />
                    </div>
                  </div>
                )}
                {isFavorite(book.path) && (
                  <Heart size={14} className="book-list-fav" fill="currentColor" />
                )}
              </div>
            ))}
          </div>
        );
      }

      return Object.entries(groupedBooks).sort(([a], [b]) => a.localeCompare(b)).map(([folderName, folderBooks]) => (
        <div key={folderName} className="subfolder-group">
          <div className="subfolder-header">
            <div className="subfolder-header-left">
              <Folder size={14} />
              <span>{folderName}</span>
              <span className="badge">{folderBooks.length}</span>
            </div>
            <button
              className={`pin-btn ${isSubfolderPinned(activeCategoryId, folderName) ? 'active' : ''}`}
              onClick={(e) => { e.stopPropagation(); togglePinSubfolder(activeCategoryId, folderName); }}
              title={isSubfolderPinned(activeCategoryId, folderName) ? 'Unpin Folder' : 'Pin Folder'}
            >
              {isSubfolderPinned(activeCategoryId, folderName) ? <PinOff size={14} /> : <Pin size={14} />}
            </button>
          </div>
          <div className="books-grid stagger-parent">
            {folderBooks.map((book, index) => (
              <div
                key={book.id}
                className={`book-card stagger-child shine-overlay ${settings.enable3DEffects !== false ? 'card-3d' : ''}`}
                style={{ animationDelay: `${(index % 30) * 40}ms` }}
                onClick={() => openBook(book)}
                onContextMenu={(e) => handleContextMenu(e, book)}
              >
                <div className={settings.enable3DEffects !== false ? 'card-3d-inner' : ''}>
                  <BookCover
                    book={book}
                    thumbnailFileName={thumbnailsMap[book.path]}
                    getThumbnailUrl={getThumbnailUrl}
                    showCovers={settings.showBookCovers}
                    isFavoriteCheck={isFavorite(book.path)}
                  />
                  <div className="book-info">
                    <h3 className="book-title truncate" title={book.name}>
                      {settings.showFileExtensions !== false ? book.name : book.name.replace(/\.pdf$/i, '')}
                    </h3>
                    {settings.showBookProgress !== false && (
                      <div className="book-progress-row">
                        <div className="progress-bar-slim">
                          <div className="progress-fill-slim" style={{ width: `${getBookProgress(book)}%` }} />
                        </div>
                        <span className="progress-label mono">{getBookProgress(book)}%</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ));
    };

    const renderRecentStrip = () => {
      if (settings.showRecentSection === false || recentBooks.length === 0 || searchQuery) return null;
      return (
        <section className="recent-section">
          <div className="section-header-row">
            <Clock size={14} />
            <h3>Recently Opened</h3>
          </div>
          <div className="recent-scroll">
            {recentBooks.slice(0, 8).map((book) => (
              <div
                key={book.id}
                className="recent-card"
                onClick={() => openBook(book)}
              >
                <BookCover
                  book={book}
                  isRecent={true}
                  thumbnailFileName={thumbnailsMap[book.path]}
                  getThumbnailUrl={getThumbnailUrl}
                  showCovers={settings.showBookCovers}
                />
                <span className="recent-name truncate">{book.name}</span>
              </div>
            ))}
          </div>
        </section>
      );
    };

    return (
      <div
        className={`library-container ${isDragging ? 'drag-active' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* ─── Header ─── */}
        <header className="lib-header">
          <div className="lib-header-left">
            <Tooltip content="Toggle Sidebar">
              <button className="icon-btn" onClick={() => setSidebarCollapsed(c => !c)}>
                {sidebarCollapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
              </button>
            </Tooltip>
            <div className="lib-brand">
              <BookOpen size={20} className="lib-brand-icon" />
              <h1 className="lib-brand-name">InkWell</h1>
            </div>
          </div>

          <div className="lib-header-center">
            <div className="search-bar">
              <Search size={16} />
              <input
                type="text"
                placeholder="Search library..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button className="icon-btn-sm" onClick={() => setSearchQuery('')} style={{ width: 20, height: 20 }}>
                  ×
                </button>
              )}
            </div>
          </div>

          <div className="lib-header-right">
            <button className="btn-primary" onClick={importPDF}>
              <Plus size={16} />
              <span>Import</span>
            </button>
            <Tooltip content="Settings">
              <button className="icon-btn" onClick={openSettingsWindow}>
                <Settings size={18} />
              </button>
            </Tooltip>
          </div>
        </header>

        {/* ─── Main Layout ─── */}
        <div className="lib-body">
          {/* ─── Sidebar ─── */}
          <aside className={`lib-sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
            <div className="sidebar-content">

              {pinnedSubfolders.length > 0 && (
                <>
                  <div className="sidebar-section-label">Pinned</div>
                  <nav className="sidebar-nav">
                    {pinnedSubfolders.map((pin, idx) => {
                      const parentCat = categories.find(c => c.id === pin.categoryId);
                      const isActive = activeCategoryId === pin.categoryId && activeSubfolder === pin.folderName;
                      return (
                        <div
                          key={`pin-${idx}`}
                          className={`sidebar-item pinned-item ${isActive ? 'active' : ''}`}
                          onClick={() => {
                            setActiveCategoryId(pin.categoryId);
                            setActiveSubfolder(pin.folderName);
                          }}
                        >
                          <span className="sidebar-item-inner">
                            <Pin size={14} className="pin-icon-fixed" />
                            <span className="sidebar-item-name truncate">
                              {pin.folderName}
                              <span className="parent-cat-hint">{parentCat?.name || ''}</span>
                            </span>
                          </span>
                          <button
                            className="sidebar-item-action"
                            onClick={(e) => { e.stopPropagation(); togglePinSubfolder(pin.categoryId, pin.folderName); }}
                          >
                            <PinOff size={13} />
                          </button>
                        </div>
                      );
                    })}
                  </nav>
                </>
              )}

              <div className="sidebar-section-label">Categories</div>
              <nav className="sidebar-nav">
                {categories.map(cat => (
                  <div
                    key={cat.id}
                    className={`sidebar-item ${cat.id === activeCategoryId && !activeSubfolder ? 'active' : ''}`}
                    onClick={() => {
                      setActiveCategoryId(cat.id);
                      setActiveSubfolder(null);
                    }}
                  >
                    <span className="sidebar-item-inner">
                      {cat.id === 'all' ? <BookOpen size={15} /> : <Folder size={15} />}
                      <span className="sidebar-item-name truncate">{cat.name}</span>
                    </span>
                    {cat.id !== 'all' && (
                      <button
                        className="sidebar-item-action"
                        onClick={(e) => { e.stopPropagation(); removeCategory(cat.id); }}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                ))}
              </nav>
            </div>
          </aside>

          {/* ─── Content ─── */}
          <main className="lib-content">
            {/* ─── Content Header ─── */}
            <div className="content-toolbar">
              <div className="content-toolbar-left">
                <div className="breadcrumb">
                  <h2 className="content-title">{activeCategoryName}</h2>
                  {activeSubfolder && (
                    <>
                      <span className="breadcrumb-sep">/</span>
                      <span className="breadcrumb-current">{activeSubfolder}</span>
                    </>
                  )}
                </div>
                {isScanning && <span className="scanning-badge pulse">Scanning...</span>}
                <span className="content-count badge">{bookCount} book{bookCount !== 1 ? 's' : ''}</span>
              </div>
              <div className="content-toolbar-right">
                <div className="sort-control">
                  <ArrowUpDown size={14} />
                  <select value={sortOrder} onChange={e => updateSortOrder(e.target.value)}>
                    <option value="name">Name</option>
                    <option value="date">Date Added</option>
                    <option value="lastRead">Last Read</option>
                    <option value="progress">Progress</option>
                  </select>
                </div>
                <div className="view-toggle">
                  <button className={`icon-btn-sm ${viewMode === 'grid' ? 'active' : ''}`} onClick={() => updateViewMode('grid')}>
                    <Grid3X3 size={15} />
                  </button>
                  <button className={`icon-btn-sm ${viewMode === 'list' ? 'active' : ''}`} onClick={() => updateViewMode('list')}>
                    <List size={15} />
                  </button>
                </div>
              </div>
            </div>

            {scanError && <div className="error-banner">{scanError}</div>}

            {/* Books */}
            <div className="books-scroll">
              {/* ── Premium Homepage Sections ── Moved inside scroll area */}
              {activeCategoryId === 'all' && settings.showDashboard && (
                <div className="dashboard-sections animate-fade-in">
                  {renderHeroSection()}
                  {renderStatsStrip()}
                  {renderFavoritesShelf()}
                  {renderRecentStrip()}
                </div>
              )}
              {renderBookGrid()}
            </div>
          </main>
        </div>

        {/* ─── Status Bar ─── */}
        <footer className="status-bar">
          <span>{bookCount} book{bookCount !== 1 ? 's' : ''} · {categories.filter(c => c.id !== 'all').length} folder{categories.filter(c => c.id !== 'all').length !== 1 ? 's' : ''}</span>
          <span className="mono" style={{ fontSize: 'var(--font-2xs)' }}>InkWell v0.2.0</span>
        </footer>

        {/* ─── Context Menu ─── */}
        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            items={getContextMenuItems(contextMenu.book)}
            onClose={() => setContextMenu(null)}
          />
        )}

        {/* ─── Drag Overlay ─── */}
        {isDragging && (
          <div className="drag-overlay">
            <Import size={48} strokeWidth={1.2} />
            <p>Drop PDF to import</p>
          </div>
        )}
      </div>
    );
  };

  export default LibraryView;
