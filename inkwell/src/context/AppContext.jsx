import React, { createContext, useState, useContext, useEffect, useCallback, useRef } from 'react';
import { load } from '@tauri-apps/plugin-store';
import { open } from '@tauri-apps/plugin-dialog';

const AppContext = createContext();

// Accent color presets (HSL)
export const ACCENT_PRESETS = [
  { name: 'Indigo', h: 239, s: 84, l: 67 },
  { name: 'Teal', h: 168, s: 76, l: 42 },
  { name: 'Rose', h: 347, s: 77, l: 63 },
  { name: 'Amber', h: 38, s: 92, l: 50 },
  { name: 'Emerald', h: 160, s: 84, l: 39 },
  { name: 'Sky', h: 199, s: 89, l: 48 },
  { name: 'Purple', h: 271, s: 81, l: 56 },
  { name: 'Crimson', h: 0, s: 72, l: 51 },
];

export const AppProvider = ({ children }) => {
  /* ───────── Defaults ───────── */
  const defaultShortcuts = {
    fullscreen: 'Enter',
    nextPage: 'ArrowRight',
    prevPage: 'ArrowLeft',
    zoomIn: '+',
    zoomOut: '-',
    toggleToc: 't',
    toggleNightMode: 'n',
    goToPage: 'g',
    backToLibrary: 'Escape',
    commandPalette: 'k',
  };

  const defaultSettings = {
    accentColor: ACCENT_PRESETS[0],
    uiDensity: 'comfortable',    // comfortable | compact | spacious
    sidebarPosition: 'left',
    animationsEnabled: true,
    bgPattern: 'none',           // none | dots | grid
    defaultZoom: 1.2,
    scrollBehavior: 'smooth',
    pageTransition: 'fade',      // none | fade | slide
    nightModeType: 'invert',     // invert | sepia
    sepiaWarmth: 50,
    brightness: 100,             // brightness percentage (50-150)
    autoOpenLastBook: false,
    showReadingTime: true,
    autoHideDelay: 3,
    defaultViewMode: 'grid',     // grid | list
    defaultSortOrder: 'name',    // name | date | lastRead | progress
    showFileExtensions: true,
    confirmRemoveFolder: true,
    pageGlow: true,
  };

  /* ───────── State ───────── */
  const [currentView, setCurrentView] = useState('library');
  const [currentBook, setCurrentBook] = useState(null);
  const [theme, setTheme] = useState('dark');
  const [pdfNightMode, setPdfNightMode] = useState(false);
  const [categories, setCategories] = useState([{ id: 'all', name: 'All Books', path: null }]);
  const [activeCategoryId, setActiveCategoryId] = useState('all');
  const [allBooks, setAllBooks] = useState([]);
  const [importedBooks, setImportedBooks] = useState([]);
  const [bookProgress, setBookProgress] = useState({});
  const [shortcuts, setShortcuts] = useState(defaultShortcuts);
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState(null);
  const [syncTrigger, setSyncTrigger] = useState(0);

  // New state
  const [settings, setSettings] = useState(defaultSettings);
  const [recentBooks, setRecentBooks] = useState([]);
  const [favoriteBookIds, setFavoriteBookIds] = useState([]);
  const [bookmarks, setBookmarks] = useState({});      // { [bookPath]: [pageNum, ...] }
  const [annotations, setAnnotations] = useState({});   // { [bookPath]: { [page]: [...] } }
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState('grid');
  const [sortOrder, setSortOrder] = useState('name');
  const [totalPagesMap, setTotalPagesMap] = useState({}); // { [bookPath]: number }
  const [thumbnailsMap, setThumbnailsMap] = useState({}); // { [bookPath]: fileName }
  const [thumbnailsBaseDir, setThumbnailsBaseDir] = useState(null);

  // Debounced save ref
  const saveTimeout = useRef(null);
  const thumbnailQueueRef = useRef([]);
  const isGeneratingThumbnails = useRef(false);

  const refreshLibrary = () => setSyncTrigger(t => t + 1);

  /* ───────── Thumbnail Generation ───────── */
  const generateThumbnail = async (bookPath) => {
    try {
      const { readFile, writeFile, mkdir } = await import('@tauri-apps/plugin-fs');
      const { appLocalDataDir, join } = await import('@tauri-apps/api/path');
      const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const pdfWorkerUrl = await import('pdfjs-dist/legacy/build/pdf.worker.mjs?url');

      pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl.default;

      const dataDir = await appLocalDataDir();
      const thumbDir = await join(dataDir, 'thumbnails');

      // Ensure directory exists
      try { await mkdir(thumbDir, { recursive: true }); } catch (e) { }

      // Create a unique filename based on the path
      const hash = Array.from(bookPath).reduce((acc, char) => acc + char.charCodeAt(0), 0).toString(36);
      const cleanName = bookPath.split(/[/\\]/).pop().replace(/[^a-z0-9]/gi, '_').substring(0, 50);
      const thumbName = `thumb_${hash}_${cleanName}.jpg`;
      const thumbPath = await join(thumbDir, thumbName);

      // Load PDF data
      const fileData = await readFile(bookPath);
      const loadingTask = pdfjsLib.getDocument({
        data: fileData,
        cMapUrl: '/cmaps/',
        cMapPacked: true,
        standardFontDataUrl: '/standard_fonts/'
      });
      const pdf = await loadingTask.promise;
      const page = await pdf.getPage(1);

      const viewport = page.getViewport({ scale: 0.5 }); // High quality but small
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      await page.render({ canvasContext: context, viewport }).promise;

      // Convert to blob
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8));
      const arrayBuffer = await blob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      await writeFile(thumbPath, uint8Array);

      // Update state and persistent store
      setThumbnailsMap(prev => {
        const next = { ...prev, [bookPath]: thumbName };
        immediateStoreSave('thumbnailsMap', next);
        return next;
      });

      return thumbName;
    } catch (err) {
      console.error("Thumbnail gen failed for", bookPath, err);
      return null;
    }
  };

  /* ───────── Background Thumbnail Queue ───────── */
  useEffect(() => {
    if (isGeneratingThumbnails.current || allBooks.length === 0) return;

    const processQueue = async () => {
      if (isGeneratingThumbnails.current) return;

      const missing = allBooks.filter(b => !thumbnailsMap[b.path]).map(b => b.path);
      if (missing.length === 0) return;

      isGeneratingThumbnails.current = true;

      // Process a few at a time to avoid heavy lag
      for (const path of missing.slice(0, 5)) {
        await generateThumbnail(path);
        // Small breathing room for UI
        await new Promise(r => setTimeout(r, 100));
      }

      isGeneratingThumbnails.current = false;
    };

    const timer = setTimeout(processQueue, 3000); // Wait for library to settle
    return () => clearTimeout(timer);
  }, [allBooks, thumbnailsMap]);

  /* ───────── Apply Theme ───────── */
  useEffect(() => {
    if (theme === 'light') {
      document.body.classList.add('light-theme');
    } else {
      document.body.classList.remove('light-theme');
    }
  }, [theme]);

  /* ───────── Apply Accent Color ───────── */
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--ink-accent-h', settings.accentColor.h);
    root.style.setProperty('--ink-accent-s', `${settings.accentColor.s}%`);
    root.style.setProperty('--ink-accent-l', `${settings.accentColor.l}%`);
  }, [settings.accentColor]);

  /* ───────── Debounced Store Save ───────── */
  const debouncedSave = useCallback(async (key, value) => {
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(async () => {
      try {
        const store = await load('library.json', { autoSave: false });
        await store.set(key, value);
        await store.save();
      } catch (err) {
        console.error(`Error saving ${key}:`, err);
      }
    }, 300);
  }, []);

  const immediateStoreSave = useCallback(async (key, value) => {
    try {
      const store = await load('library.json', { autoSave: false });
      await store.set(key, value);
      await store.save();
    } catch (err) {
      console.error(`Error saving ${key}:`, err);
    }
  }, []);

  /* ───────── Load from Store ───────── */
  useEffect(() => {
    const initStore = async () => {
      try {
        const store = await load('library.json', { autoSave: false });

        const savedCategories = await store.get('categories') || [];
        if (Array.isArray(savedCategories)) {
          setCategories([{ id: 'all', name: 'All Books', path: null }, ...savedCategories]);
        }

        const savedImported = await store.get('importedBooks') || [];
        if (Array.isArray(savedImported)) setImportedBooks(savedImported);

        const savedAllBooks = await store.get('allBooks') || [];
        if (Array.isArray(savedAllBooks)) setAllBooks(savedAllBooks);

        const savedProgress = await store.get('bookProgress') || {};
        setBookProgress(savedProgress);

        const savedShortcuts = await store.get('shortcuts');
        if (savedShortcuts) setShortcuts({ ...defaultShortcuts, ...savedShortcuts });

        const savedPdfMode = await store.get('pdfNightMode');
        if (savedPdfMode !== null && savedPdfMode !== undefined) setPdfNightMode(savedPdfMode);

        const savedTheme = await store.get('theme');
        if (savedTheme) setTheme(savedTheme);

        const savedSettings = await store.get('settings');
        if (savedSettings) setSettings(prev => ({ ...prev, ...savedSettings }));

        const savedRecent = await store.get('recentBooks') || [];
        if (Array.isArray(savedRecent)) setRecentBooks(savedRecent);

        const savedFavorites = await store.get('favoriteBookIds') || [];
        if (Array.isArray(savedFavorites)) setFavoriteBookIds(savedFavorites);

        const savedBookmarks = await store.get('bookmarks') || {};
        setBookmarks(savedBookmarks);

        const savedAnnotations = await store.get('annotations') || {};
        setAnnotations(savedAnnotations);

        const savedViewMode = await store.get('viewMode');
        if (savedViewMode) setViewMode(savedViewMode);

        const savedSortOrder = await store.get('sortOrder');
        if (savedSortOrder) setSortOrder(savedSortOrder);

        const savedTotalPages = await store.get('totalPagesMap') || {};
        setTotalPagesMap(savedTotalPages);

        const savedThumbnails = await store.get('thumbnailsMap') || {};
        setThumbnailsMap(savedThumbnails);

        const { appLocalDataDir, join } = await import('@tauri-apps/api/path');
        const dataDir = await appLocalDataDir();
        const thumbDir = await join(dataDir, 'thumbnails');
        setThumbnailsBaseDir(thumbDir);
      } catch (err) {
        console.error("Failed to load library store", err);
      }
    };
    initStore();
  }, []);

  /* ───────── Directory Scanner (unchanged logic) ───────── */
  const scanPdfsRecursively = async (dirPath) => {
    let results = [];
    try {
      const { readDir } = await import('@tauri-apps/plugin-fs');
      const { join } = await import('@tauri-apps/api/path');

      let entries = [];
      try {
        entries = await readDir(dirPath);
      } catch (readErr) {
        console.warn("Skipping unreadable dir:", dirPath, readErr);
        return [];
      }

      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;

        const childPath = await join(dirPath, entry.name);

        if (entry.isDirectory) {
          results.push(...await scanPdfsRecursively(childPath));
        } else if (entry.isFile && entry.name.toLowerCase().endsWith('.pdf')) {
          const hue1 = (childPath.length * 13) % 360;
          const hue2 = (hue1 + 40) % 360;
          const coverColor = `linear-gradient(135deg, hsl(${hue1}, 70%, 50%) 0%, hsl(${hue2}, 70%, 40%) 100%)`;
          let parentFolder = dirPath.split(/[/\\]/).filter(Boolean).pop() || "Library";

          results.push({
            id: childPath,
            path: childPath,
            name: entry.name,
            author: 'Unknown',
            progress: 0,
            folder: parentFolder,
            coverColor
          });
        }
      }
    } catch (err) {
      console.error("Critical error in scanner", dirPath, err);
    }
    return results;
  };

  /* ───────── Rescan on category/sync change ───────── */
  /* ───────── Library Scanning (Optimized) ───────── */
  useEffect(() => {
    const runScan = async () => {
      if (categories.length === 0) return;
      
      setIsScanning(true);
      setScanError(null);
      let scanned = [];

      try {
        // Only scan custom directories
        const customCats = categories.filter(c => c.id !== 'all' && c.path);
        for (const cat of customCats) {
          const results = await scanPdfsRecursively(cat.path);
          scanned.push(...results);
        }

        // Deduplicate
        const unique = [];
        const paths = new Set();
        for (const b of scanned) {
          if (!paths.has(b.path)) {
            paths.add(b.path);
            unique.push(b);
          }
        }
        setAllBooks(unique);
        await immediateStoreSave('allBooks', unique);
      } catch (err) {
        setScanError(`Scan Error: ${err.message || 'Unknown FS error'}`);
      } finally {
        setIsScanning(false);
      }
    };

    // Defer the initial scan to give UI time to settle
    const timer = setTimeout(() => {
      runScan();
    }, allBooks.length > 0 ? 10000 : 1000); // 10s if we already have books, 1s if first-time
    
    return () => clearTimeout(timer);
  }, [categories.length, syncTrigger]); // ONLY trigger on cat count change or manual refresh

  /* ───────── Actions ───────── */
  const addCategory = async () => {
    try {
      const selectedPath = await open({ directory: true, multiple: false });
      if (selectedPath) {
        let folderPath;
        if (Array.isArray(selectedPath)) {
          folderPath = typeof selectedPath[0] === 'string' ? selectedPath[0] : selectedPath[0]?.path;
        } else if (typeof selectedPath === 'string') {
          folderPath = selectedPath;
        } else {
          folderPath = selectedPath?.path;
        }
        if (!folderPath) throw new Error("Could not extract path from " + JSON.stringify(selectedPath));

        let folderName = folderPath.split(/[/\\]/).filter(Boolean).pop() || "New Category";

        const newCat = { id: Date.now().toString(), name: folderName, path: folderPath };
        const existingCustom = categories.filter(c => c.id !== 'all');
        const updatedCustom = [...existingCustom, newCat];

        await immediateStoreSave('categories', updatedCustom);
        setCategories([{ id: 'all', name: 'All Books', path: null }, ...updatedCustom]);
        setActiveCategoryId(newCat.id);
      }
    } catch (err) {
      console.error("Error adding category mapping:", err);
      setScanError(`Adding Category Failed: ${err.message || JSON.stringify(err)}`);
    }
  };

  const importPDF = async () => {
    try {
      const selected = await open({ multiple: false, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
      if (selected) {
        let filePath;
        if (Array.isArray(selected)) {
          filePath = typeof selected[0] === 'string' ? selected[0] : selected[0]?.path;
        } else if (typeof selected === 'string') {
          filePath = selected;
        } else {
          filePath = selected?.path;
        }
        if (!filePath) throw new Error("Could not extract file from " + JSON.stringify(selected));

        let fileName = filePath.split(/[/\\]/).filter(Boolean).pop() || "Unknown";
        const hue1 = Math.floor(Math.random() * 360);
        const hue2 = (hue1 + 40) % 360;
        const coverColor = `linear-gradient(135deg, hsl(${hue1}, 70%, 50%) 0%, hsl(${hue2}, 70%, 40%) 100%)`;

        const newBook = { id: Date.now().toString(), path: filePath, name: fileName, author: 'Unknown', progress: 0, coverColor };
        const updatedImported = [...importedBooks, newBook];
        setImportedBooks(updatedImported);
        await immediateStoreSave('importedBooks', updatedImported);
        setActiveCategoryId('all');
      }
    } catch (err) {
      console.error("Error importing PDF:", err);
      setScanError(`Importing PDF Failed: ${err.message || JSON.stringify(err)}`);
    }
  };

  const removeCategory = async (catId) => {
    if (catId === 'all') return;
    const existingCustom = categories.filter(c => c.id !== 'all' && c.id !== catId);
    await immediateStoreSave('categories', existingCustom);
    setCategories([{ id: 'all', name: 'All Books', path: null }, ...existingCustom]);
    if (activeCategoryId === catId) setActiveCategoryId('all');
  };

  const openBook = (book) => {
    setCurrentBook(book);
    setCurrentView('reader');
    addToRecent(book);
  };

  const closeBook = () => {
    setCurrentBook(null);
    setCurrentView('library');
  };

  const updateBookProgress = async (path, page) => {
    const newProgress = { ...bookProgress, [path]: { page } };
    setBookProgress(newProgress);
    debouncedSave('bookProgress', newProgress);
  };

  const updateShortcuts = async (newShortcuts) => {
    setShortcuts(newShortcuts);
    await immediateStoreSave('shortcuts', newShortcuts);
  };

  const togglePdfNightMode = async () => {
    const newVal = !pdfNightMode;
    setPdfNightMode(newVal);
    await immediateStoreSave('pdfNightMode', newVal);
  };

  const updateTheme = async (newTheme) => {
    setTheme(newTheme);
    await immediateStoreSave('theme', newTheme);
  };

  /* ───────── New Actions ───────── */
  const updateSettings = async (partial) => {
    const newSettings = { ...settings, ...partial };
    setSettings(newSettings);
    debouncedSave('settings', newSettings);
  };

  const addToRecent = async (book) => {
    const updated = [book, ...recentBooks.filter(b => b.path !== book.path)].slice(0, 10);
    setRecentBooks(updated);
    debouncedSave('recentBooks', updated);
  };

  const toggleFavorite = async (bookPath) => {
    const updated = favoriteBookIds.includes(bookPath)
      ? favoriteBookIds.filter(id => id !== bookPath)
      : [...favoriteBookIds, bookPath];
    setFavoriteBookIds(updated);
    await immediateStoreSave('favoriteBookIds', updated);
    return !favoriteBookIds.includes(bookPath); // return new state
  };

  const isFavorite = (bookPath) => favoriteBookIds.includes(bookPath);

  const addBookmark = async (bookPath, pageNum) => {
    const bookBm = bookmarks[bookPath] || [];
    if (bookBm.includes(pageNum)) return;
    const updated = { ...bookmarks, [bookPath]: [...bookBm, pageNum].sort((a, b) => a - b) };
    setBookmarks(updated);
    await immediateStoreSave('bookmarks', updated);
  };

  const removeBookmark = async (bookPath, pageNum) => {
    const bookBm = bookmarks[bookPath] || [];
    const updated = { ...bookmarks, [bookPath]: bookBm.filter(p => p !== pageNum) };
    setBookmarks(updated);
    await immediateStoreSave('bookmarks', updated);
  };

  const isBookmarked = (bookPath, pageNum) => (bookmarks[bookPath] || []).includes(pageNum);

  const getBookmarks = (bookPath) => bookmarks[bookPath] || [];

  const setBookTotalPages = async (bookPath, numPages) => {
    const updated = { ...totalPagesMap, [bookPath]: numPages };
    setTotalPagesMap(updated);
    debouncedSave('totalPagesMap', updated);
  };

  const updateViewMode = async (mode) => {
    setViewMode(mode);
    await immediateStoreSave('viewMode', mode);
  };

  const updateSortOrder = async (order) => {
    setSortOrder(order);
    await immediateStoreSave('sortOrder', order);
  };

  const removeImportedBook = async (bookPath) => {
    const updated = importedBooks.filter(b => b.path !== bookPath);
    setImportedBooks(updated);
    await immediateStoreSave('importedBooks', updated);
  };

  /* ───────── Filter books by category ───────── */
  const booksByCategory = React.useMemo(() => {
    if (activeCategoryId === 'all') {
      return [...allBooks, ...importedBooks];
    }
    const cat = categories.find(c => c.id === activeCategoryId);
    if (!cat || !cat.path) return importedBooks;

    // Filter allBooks for those that are in this category's path
    return allBooks.filter(b => b.path.startsWith(cat.path));
  }, [allBooks, importedBooks, activeCategoryId, categories]);

  /* ───────── Sort books ───────── */
  const sortedBooks = React.useMemo(() => {
    let sorted = [...booksByCategory];
    switch (sortOrder) {
      case 'name':
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'date':
        sorted.reverse();
        break;
      case 'lastRead':
        sorted.sort((a, b) => {
          const aIdx = recentBooks.findIndex(r => r.path === a.path);
          const bIdx = recentBooks.findIndex(r => r.path === b.path);
          if (aIdx === -1 && bIdx === -1) return 0;
          if (aIdx === -1) return 1;
          if (bIdx === -1) return -1;
          return aIdx - bIdx;
        });
        break;
      case 'progress':
        sorted.sort((a, b) => (b.progress || 0) - (a.progress || 0));
        break;
      default:
        break;
    }
    return sorted;
  }, [booksByCategory, sortOrder, recentBooks]);

  /* ───────── Filter books by search ───────── */
  const filteredBooks = React.useMemo(() => {
    if (!searchQuery.trim()) return sortedBooks;
    const q = searchQuery.toLowerCase();
    return sortedBooks.filter(b => b.name.toLowerCase().includes(q));
  }, [sortedBooks, searchQuery]);

  /* ───────── Context value ───────── */
  const value = {
    // View
    currentView, setCurrentView,
    currentBook, setCurrentBook,
    openBook, closeBook,

    // Theme
    theme, setTheme: updateTheme,
    pdfNightMode, togglePdfNightMode,

    // Library
    categories, activeCategoryId, setActiveCategoryId,
    books: filteredBooks,
    bookProgress, updateBookProgress,
    isScanning, scanError,
    addCategory, removeCategory, importPDF, refreshLibrary,

    // Settings
    settings, updateSettings,
    shortcuts, updateShortcuts,

    // New features
    recentBooks, addToRecent,
    favoriteBookIds, toggleFavorite, isFavorite,
    bookmarks, addBookmark, removeBookmark, isBookmarked, getBookmarks,
    annotations, setAnnotations,
    sidebarCollapsed, setSidebarCollapsed,
    commandPaletteOpen, setCommandPaletteOpen,
    searchQuery, setSearchQuery,
    viewMode, updateViewMode,
    sortOrder, updateSortOrder,
    totalPagesMap, setBookTotalPages,
    thumbnailsMap,
    removeImportedBook,
    getThumbnailUrl: (fileName) => {
      if (!fileName || !thumbnailsBaseDir) return null;
      // In a real implementation, we'd use join and convertFileSrc here
      // but for this simplified version, let's assume the UI can handle the construction
      // if we provide the base dir.
      return null;
    },
    thumbnailsBaseDir
  };

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
};

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
};
