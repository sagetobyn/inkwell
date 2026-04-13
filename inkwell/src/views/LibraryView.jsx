import React, { useState, useRef, useCallback } from 'react';
import { useAppContext } from '../context/AppContext';
import { useToast } from '../components/Toast';
import Tooltip from '../components/Tooltip';
import ContextMenu from '../components/ContextMenu';
import {
  Settings, Plus, Search, BookOpen, Folder, Trash2, RefreshCw,
  Grid3X3, List, ChevronDown, Heart, Clock, Star,
  ArrowUpDown, PanelLeftClose, PanelLeft, Import, FilePlus,
  MoreVertical, ExternalLink, BookMarked, Command
} from 'lucide-react';
import './LibraryView.css';

const LibraryView = () => {
  const {
    setCurrentView, openBook, categories, activeCategoryId, setActiveCategoryId,
    books, scanError, isScanning, addCategory, removeCategory, importPDF, refreshLibrary,
    searchQuery, setSearchQuery, viewMode, updateViewMode, sortOrder, updateSortOrder,
    sidebarCollapsed, setSidebarCollapsed, recentBooks, isFavorite, toggleFavorite,
    setCommandPaletteOpen, settings, removeImportedBook, bookProgress, totalPagesMap,
    thumbnailsMap, getThumbnailUrl
  } = useAppContext();

  const addToast = useToast();
  const [contextMenu, setContextMenu] = useState(null);
  const [isDragging, setIsDragging] = useState(false);

  // Helper component for async thumbnail resolution
  const BookCover = ({ book, isList = false, isRecent = false }) => {
    const [url, setUrl] = useState(null);
    const fileName = thumbnailsMap[book.path];

    useState(() => {
      let active = true;
      if (fileName && getThumbnailUrl) {
        getThumbnailUrl(fileName).then(resolved => {
          if (active) setUrl(resolved);
        });
      }
      return () => { active = false; };
    }, [fileName, getThumbnailUrl]);

    const fallback = (
      <span className={isList ? '' : (isRecent ? 'recent-cover-letter' : 'book-cover-letter')}>
        {book.name.charAt(0).toUpperCase()}
      </span>
    );

    let className = 'book-cover';
    if (isList) className = 'book-list-cover';
    if (isRecent) className = 'recent-cover';

    return (
      <div
        className={className}
        style={{ background: book.coverColor }}
      >
        {url ? (
          <img src={url} alt="" className="book-cover-img" loading="lazy" />
        ) : fallback}

        {!isList && !isRecent && isFavorite(book.path) && (
          <div className="book-fav-badge">
            <Heart size={10} fill="currentColor" />
          </div>
        )}
      </div>
    );
  };

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
          <p>Import a PDF or map a folder to get started.</p>
          <div className="empty-state-actions">
            <button className="btn-primary" onClick={importPDF}>
              <FilePlus size={16} />
              Import PDF
            </button>
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
              style={{ animationDelay: `${(index % 20) * 30}ms` }}
              onClick={() => openBook(book)}
              onContextMenu={(e) => handleContextMenu(e, book)}
            >
              <BookCover book={book} isList={true} />
              <div className="book-list-info">
                <span className="book-list-name truncate">{settings.showFileExtensions !== false ? book.name : book.name.replace(/\.pdf$/i, '')}</span>
                <span className="book-list-meta">{book.folder || 'Library'}</span>
              </div>
              <div className="book-list-progress">
                <div className="progress-bar-mini">
                  <div className="progress-fill-mini" style={{ width: `${getBookProgress(book)}%` }} />
                </div>
              </div>
              {isFavorite(book.path) && (
                <Heart size={14} className="book-list-fav" fill="currentColor" />
              )}
            </div>
          ))}
        </div>
      );
    }

    // Group books by folder
    const groupedBooks = books.reduce((acc, book) => {
      const f = book.folder || 'Root';
      if (!acc[f]) acc[f] = [];
      acc[f].push(book);
      return acc;
    }, {});

    return Object.entries(groupedBooks).sort(([a], [b]) => a.localeCompare(b)).map(([folderName, folderBooks]) => (
      <div key={folderName} className="subfolder-group">
        <div className="subfolder-header">
          <Folder size={14} />
          <span>{folderName}</span>
          <span className="badge">{folderBooks.length}</span>
        </div>
        <div className="books-grid">
          {folderBooks.map((book, index) => (
            <div
              key={book.id}
              className="book-card animate-slide-up"
              style={{ animationDelay: `${(index % 10) * 40}ms` }}
              onClick={() => openBook(book)}
              onContextMenu={(e) => handleContextMenu(e, book)}
            >
              <BookCover book={book} />
              <div className="book-info">
                <h3 className="book-title truncate" title={book.name}>
                  {settings.showFileExtensions !== false ? book.name : book.name.replace(/\.pdf$/i, '')}
                </h3>
                <div className="book-progress-row">
                  <div className="progress-bar-slim">
                    <div className="progress-fill-slim" style={{ width: `${getBookProgress(book)}%` }} />
                  </div>
                  <span className="progress-label mono">{getBookProgress(book)}%</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    ));
  };

  const renderRecentStrip = () => {
    if (recentBooks.length === 0) return null;
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
              <BookCover book={book} isRecent={true} />
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
          <Tooltip content="Command Palette (Ctrl+K)">
            <button className="icon-btn" onClick={() => setCommandPaletteOpen(true)}>
              <Command size={18} />
            </button>
          </Tooltip>
          <Tooltip content="Sync Library">
            <button className="icon-btn" onClick={refreshLibrary}>
              <RefreshCw size={18} className={isScanning ? 'spin' : ''} />
            </button>
          </Tooltip>
          <button className="btn-primary" onClick={importPDF}>
            <Plus size={16} />
            <span>Import</span>
          </button>
          <Tooltip content="Settings">
            <button className="icon-btn" onClick={() => setCurrentView('settings')}>
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

            <div className="sidebar-section-label">Categories</div>
            <nav className="sidebar-nav">
              {categories.map(cat => (
                <div
                  key={cat.id}
                  className={`sidebar-item ${cat.id === activeCategoryId ? 'active' : ''}`}
                  onClick={() => setActiveCategoryId(cat.id)}
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
              <h2 className="content-title">{activeCategoryName}</h2>
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

          {/* Recent Strip */}
          {activeCategoryId === 'all' && renderRecentStrip()}

          {/* Books */}
          <div className="books-scroll">
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
