import React, {
  createContext,
  useState,
  useContext,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { load } from "@tauri-apps/plugin-store";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { appLocalDataDir, join } from "@tauri-apps/api/path";
import { convertFileSrc } from "@tauri-apps/api/core";
import { isTauri } from "../utils/tauri";

const AppContext = createContext();

// Accent color presets (HSL)
export const ACCENT_PRESETS = [
  { name: "Indigo", h: 239, s: 84, l: 67 },
  { name: "Teal", h: 168, s: 76, l: 42 },
  { name: "Rose", h: 347, s: 77, l: 63 },
  { name: "Amber", h: 38, s: 92, l: 50 },
  { name: "Emerald", h: 160, s: 84, l: 39 },
  { name: "Sky", h: 199, s: 89, l: 48 },
  { name: "Purple", h: 271, s: 81, l: 56 },
  { name: "Crimson", h: 0, s: 72, l: 51 },
];

export const AppProvider = ({ children }) => {
  /* ───────── Defaults ───────── */
  const defaultShortcuts = {
    fullscreen: "Enter",
    nextPage: "ArrowRight",
    prevPage: "ArrowLeft",
    zoomIn: "+",
    zoomOut: "-",
    toggleNightMode: "n",
    goToPage: "g",
    backToLibrary: "Escape",
    commandPalette: "k",
    saveHighlight: "h",
    removeHighlight: "x",
    brightnessUp: "]",
    brightnessDown: "[",
  };

  const defaultSettings = {
    accentColor: ACCENT_PRESETS[0],
    uiDensity: "comfortable", // comfortable | compact | spacious
    sidebarPosition: "left",
    animationsEnabled: true,
    bgPattern: "none", // none | dots | grid
    defaultZoom: 1.2,
    scrollBehavior: "smooth",
    pageTransition: "fade", // none | fade | slide
    nightModeType: "invert", // invert | sepia
    sepiaWarmth: 50,
    brightness: 100, // brightness percentage (50-150)
    autoOpenLastBook: false,
    showReadingTime: true,
    autoHideDelay: 3,
    defaultViewMode: "grid", // grid | list
    defaultSortOrder: "name", // name | date | lastRead | progress
    showFileExtensions: true,
    confirmRemoveFolder: true,
    pageGlow: true,
    showBookCovers: true,
    showBookProgress: true,
    showLibraryStats: true,
    showHeroSection: true,
    showRecentSection: true,
    // Premium Settings
    glassIntensity: 0.7, // backdrop opacity (0-1)
    glassBlur: 16, // backdrop blur (0-40)
    fontFamily: "sans", // sans | serif | mono
    enable3DEffects: true,
    enableBrightnessReset: true,
    brightnessResetValue: 100,
    libraryGridSize: 1.0, // multiplier for card sizing
    readerZenMode: "off", // off | on_scroll | always
    transitionSpeed: "normal", // fast | normal | slow
    startupPage: "library", // library | recent | resume
    showThemeBackgroundImage: false,
    themeBackgroundImage: null, // DataURL
    showDashboard: true, // Migrated from local state
    enableHighlighting: true, // Whether to show highlight/eraser actions
    readerMode: "light", // light | sepia | dust | night | midnight | nord
  };

  /* ───────── State ───────── */
  const [currentView, setCurrentView] = useState(() => {
    // Check if we are in a settings window
    const params = new URLSearchParams(window.location.search);
    return params.get("view") === "settings" ? "settings" : "library";
  });
  const [currentBook, setCurrentBook] = useState(null);
  const [theme, setTheme] = useState("dark");
  const [pdfNightMode, setPdfNightMode] = useState(false);
  const [categories, setCategories] = useState([
    { id: "all", name: "All Books", path: null },
  ]);
  const [activeCategoryId, setActiveCategoryId] = useState("all");
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState("grid");
  const [sortOrder, setSortOrder] = useState("name");
  const [totalPagesMap, setTotalPagesMap] = useState({}); // { [bookPath]: number }
  const [thumbnailsMap, setThumbnailsMap] = useState({}); // { [bookPath]: fileName }
  const [thumbnailsBaseDir, setThumbnailsBaseDir] = useState(null);
  const [readingStats, setReadingStats] = useState({
    totalBooksOpened: 0,
    lastReadDate: null,
    readDates: [],
  });
  const [pinnedSubfolders, setPinnedSubfolders] = useState([]); // Array of { categoryId, folderName }
  const [activeSubfolder, setActiveSubfolder] = useState(null); // Track name of subfolder being viewed
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Debounced save ref
  const saveTimeout = useRef(null);
  const thumbnailQueueRef = useRef([]);
  const isGeneratingThumbnails = useRef(false);
  const failedThumbnails = useRef(new Set());

  const refreshLibrary = () => setSyncTrigger((t) => t + 1);

  /* ───────── Fullscreen State Listener ───────── */
  useEffect(() => {
    if (!isTauri()) return;

    let unlisten;
    const initFullscreenListener = async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();

        // Sync initial state
        const initial = await win.isFullscreen();
        setIsFullscreen(initial);

        // Listen for changes (includes resize events that transition to/from fullscreen)
        unlisten = await win.onResized(async () => {
          const current = await win.isFullscreen();
          setIsFullscreen(current);
        });
      } catch (err) {
        console.error("[Fullscreen] Listener setup failed:", err);
      }
    };

    initFullscreenListener();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  /* ───────── Thumbnail Generation ───────── */
  const generateThumbnail = async (bookPath) => {
    try {
      const { readFile, writeFile, mkdir } =
        await import("@tauri-apps/plugin-fs");
      const { appLocalDataDir, join } = await import("@tauri-apps/api/path");
      const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const pdfWorkerUrl =
        await import("pdfjs-dist/legacy/build/pdf.worker.mjs?url");

      pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl.default;

      const dataDir = await appLocalDataDir();
      const thumbDir = await join(dataDir, "thumbnails");

      // Ensure directory exists
      try {
        await mkdir(thumbDir, { recursive: true });
      } catch (e) {}

      // Create a unique filename based on the path
      const hash = Array.from(bookPath)
        .reduce((acc, char) => acc + char.charCodeAt(0), 0)
        .toString(36);
      const cleanName = bookPath
        .split(/[/\\]/)
        .pop()
        .replace(/[^a-z0-9]/gi, "_")
        .substring(0, 50);
      const thumbName = `thumb_${hash}_${cleanName}.jpg`;
      const thumbPath = await join(thumbDir, thumbName);

      // Read the PDF file directly (most reliable method)
      const fileData = await readFile(bookPath);

      // Wrap pdf.js in a timeout to prevent hanging on corrupt files
      const pdf = await Promise.race([
        pdfjsLib.getDocument({ data: fileData }).promise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("PDF load timeout")), 8000),
        ),
      ]);

      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 0.3 });
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      // Fill with white background
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);

      await Promise.race([
        page.render({ canvasContext: context, viewport }).promise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Render timeout")), 5000),
        ),
      ]);

      // Convert to blob
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.7),
      );
      if (!blob) throw new Error("Canvas toBlob returned null");

      const arrayBuffer = await blob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      await writeFile(thumbPath, uint8Array);

      // Clean up
      canvas.width = 0;
      canvas.height = 0;
      pdf.destroy();

      // Update state and persistent store
      setThumbnailsMap((prev) => {
        const next = { ...prev, [bookPath]: thumbName };
        immediateStoreSave("thumbnailsMap", next);
        return next;
      });

      return thumbName;
    } catch (err) {
      console.warn(
        "Thumbnail gen failed for",
        bookPath.split(/[/\\]/).pop(),
        err.message,
      );
      failedThumbnails.current.add(bookPath);
      return null;
    }
  };

  /* ───────── Background Thumbnail Queue ───────── */
  useEffect(() => {
    if (settings.showBookCovers === false || allBooks.length === 0) return;

    const processQueue = async () => {
      if (isGeneratingThumbnails.current) return;

      const missing = allBooks
        .filter(
          (b) =>
            !thumbnailsMap[b.path] && !failedThumbnails.current.has(b.path),
        )
        .map((b) => b.path);
      if (missing.length === 0) return;

      isGeneratingThumbnails.current = true;
      console.log(`[Thumbnails] Generating ${missing.length} covers...`);

      // Process all missing books sequentially
      for (let i = 0; i < missing.length; i++) {
        await generateThumbnail(missing[i]);
        // Brief yield every 3 books to let UI breathe
        if (i % 3 === 2) {
          await new Promise((r) => setTimeout(r, 50));
        }
      }

      isGeneratingThumbnails.current = false;
      console.log(
        `[Thumbnails] Done. Failed: ${failedThumbnails.current.size}`,
      );
    };

    const timer = setTimeout(processQueue, 2000);
    return () => clearTimeout(timer);
  }, [allBooks, thumbnailsMap, settings.showBookCovers]);

  /* ───────── Apply Theme ───────── */
  useEffect(() => {
    // List of all theme classes to remove
    const themeClasses = [
      "theme-light",
      "theme-dark",
      "theme-sepia",
      "theme-midnight",
      "theme-nord",
      "theme-sunset",
      "theme-matcha",
      "theme-coffee",
      "theme-solarized",
      "theme-ocean",
      "theme-rose",
      "theme-custom",
    ];
    document.body.classList.remove(...themeClasses);

    // Convert old "light/dark" values to new "theme-xxx" if necessary, though ideally they are updated in state
    const themeClass = theme.startsWith("theme-") ? theme : `theme-${theme}`;
    document.body.classList.add(themeClass);

    // If it's a custom theme, apply custom variables from settings
    if (theme === "theme-custom" && settings.customTheme) {
      const root = document.documentElement;
      Object.entries(settings.customTheme).forEach(([prop, val]) => {
        root.style.setProperty(prop, val);
      });
    }

    // Apply Background Image Skin
    if (settings.showThemeBackgroundImage && settings.themeBackgroundImage) {
      document.body.classList.add("has-background-image");
      document.documentElement.style.setProperty(
        "--app-bg-image",
        `url(${settings.themeBackgroundImage})`,
      );
    } else {
      document.body.classList.remove("has-background-image");
    }
  }, [
    theme,
    settings.customTheme,
    settings.showThemeBackgroundImage,
    settings.themeBackgroundImage,
  ]);

  /* ───────── Apply Styles (Theme, Accent, Glass, Font) ───────── */
  useEffect(() => {
    const root = document.documentElement;
    // Accent
    root.style.setProperty("--ink-accent-h", settings.accentColor.h);
    root.style.setProperty("--ink-accent-s", `${settings.accentColor.s}%`);
    root.style.setProperty("--ink-accent-l", `${settings.accentColor.l}%`);

    // Glassmorphism
    root.style.setProperty(
      "--ink-glass-opacity",
      settings.glassIntensity ?? 0.7,
    );
    root.style.setProperty("--ink-glass-blur", `${settings.glassBlur ?? 16}px`);

    // Typography
    const fontMap = {
      sans: "var(--font-sans)",
      serif: 'Lora, "Georgia", serif',
      mono: "var(--font-mono)",
    };
    root.style.setProperty(
      "--ink-font-family",
      fontMap[settings.fontFamily] || "var(--font-sans)",
    );

    // Reader & Transitions
    const speedMap = { fast: "120ms", normal: "250ms", slow: "450ms" };
    root.style.setProperty(
      "--ink-transition-duration",
      speedMap[settings.transitionSpeed] || "250ms",
    );

    // Grid Size
    root.style.setProperty("--ink-grid-scale", settings.libraryGridSize ?? 1.0);
  }, [
    settings.accentColor,
    settings.glassIntensity,
    settings.glassBlur,
    settings.fontFamily,
    settings.transitionSpeed,
    settings.libraryGridSize,
  ]);

  /* ───────── Cross-Window Sync ───────── */
  useEffect(() => {
    let unlistenSettings;
    let unlistenTheme;
    let unlistenShortcuts;

    const setupListeners = async () => {
      try {
        if (!isTauri()) {
          console.warn("[Init] Store skipped: Not in Tauri environment.");
          return;
        }
        const store = await load("library.json", { autoSave: false });

        // Settings Sync
        unlistenSettings = await store.onKeyChange("settings", (val) => {
          if (val) setSettings((prev) => ({ ...prev, ...val }));
        });

        // Theme Sync
        unlistenTheme = await store.onKeyChange("theme", (val) => {
          if (val) setTheme(val);
        });

        // Shortcuts Sync
        unlistenShortcuts = await store.onKeyChange("shortcuts", (val) => {
          if (val) setShortcuts((prev) => ({ ...prev, ...val }));
        });
      } catch (err) {
        console.error("Store listener setup failed", err);
      }
    };

    setupListeners();

    return () => {
      if (unlistenSettings) unlistenSettings();
      if (unlistenTheme) unlistenTheme();
      if (unlistenShortcuts) unlistenShortcuts();
    };
  }, []);

  /* ───────── Debounced Store Save ───────── */
  const debouncedSave = useCallback(async (key, value) => {
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(async () => {
      try {
        if (!isTauri()) return;
        const store = await load("library.json", { autoSave: false });
        await store.set(key, value);
        await store.save();
      } catch (err) {
        console.error(`Error saving ${key}:`, err);
      }
    }, 300);
  }, []);

  const immediateStoreSave = useCallback(async (key, value) => {
    try {
      if (!isTauri()) return;
      const store = await load("library.json", { autoSave: false });
      await store.set(key, value);
      await store.save();
    } catch (err) {
      console.error(`Error saving ${key}:`, err);
    }
  }, []);

  /* ───────── Load from Store (Parallelized) ───────── */
  useEffect(() => {
    let isMounted = true;
    const startTime = performance.now();

    const revealWindow = async (source) => {
      try {
        if (isTauri()) {
          const win = getCurrentWindow();
          await win.show();
        } else {
          console.log(`[Init] Skip window.show() via ${source} (Standard Web)`);
        }

        // Small delay to ensure React has rendered before removing splash
        setTimeout(() => {
          const splash = document.getElementById("splash");
          if (splash) splash.classList.add("splash-hidden");
        }, 150);

        console.log(
          `[Init] Window revealed via ${source} at ${Math.round(performance.now() - startTime)}ms`,
        );
      } catch (e) {
        console.error(`[Init] Failed to reveal window (${source})`, e);
      }
    };

    // Safety fallback: if store loading is extremely slow, show the window anyway after 5s
    const safetyTimeout = setTimeout(() => {
      if (isMounted) {
        console.warn(
          "[Init] Safety fallback triggered. Data loading may be hanging.",
        );
        revealWindow("timeout-fallback");
      }
    }, 5000);

    const initStore = async () => {
      console.log("[Init] Starting store initialization...");

      try {
        console.log("[Init] Loading library.json...");
        const store = await load("library.json", { autoSave: false });
        console.log("[Init] Store plugin ready.");

        const keys = [
          "categories",
          "importedBooks",
          "allBooks",
          "bookProgress",
          "shortcuts",
          "pdfNightMode",
          "theme",
          "settings",
          "recentBooks",
          "favoriteBookIds",
          "viewMode",
          "sortOrder",
          "readingStats",
          "totalPagesMap",
          "thumbnailsMap",
          "pinnedSubfolders",
        ];

        console.log(`[Init] Fetching ${keys.length} keys...`);
        const results = await Promise.all(keys.map((key) => store.get(key)));

        const [
          s_categories,
          s_imported,
          s_allBooks,
          s_progress,
          s_shortcuts,
          s_pdfMode,
          s_theme,
          s_settings,
          s_recent,
          s_favorites,
          s_viewMode,
          s_sortOrder,
          s_readingStats,
          s_totalPages,
          s_thumbnails,
          s_pinned,
        ] = results;

        console.log(
          `[Init] Raw data received in ${Math.round(performance.now() - startTime)}ms`,
        );

        if (Array.isArray(s_categories)) {
          setCategories([
            { id: "all", name: "All Books", path: null },
            ...s_categories,
          ]);
        }
        if (Array.isArray(s_imported)) setImportedBooks(s_imported);
        if (Array.isArray(s_allBooks)) setAllBooks(s_allBooks);
        if (s_progress) setBookProgress(s_progress);
        if (s_shortcuts) {
          // Filter out legacy shortcuts that are no longer in defaults
          const validKeys = Object.keys(defaultShortcuts);
          const filtered = Object.keys(s_shortcuts).reduce((acc, key) => {
            if (validKeys.includes(key)) acc[key] = s_shortcuts[key];
            return acc;
          }, {});
          setShortcuts({ ...defaultShortcuts, ...filtered });
        }
        if (s_pdfMode !== null && s_pdfMode !== undefined)
          setPdfNightMode(s_pdfMode);
        if (s_theme) setTheme(s_theme);
        if (s_settings) setSettings((prev) => ({ ...prev, ...s_settings }));
        if (Array.isArray(s_recent)) setRecentBooks(s_recent);
        if (Array.isArray(s_favorites)) setFavoriteBookIds(s_favorites);
        if (s_viewMode) setViewMode(s_viewMode);
        if (s_sortOrder) setSortOrder(s_sortOrder);
        if (s_readingStats)
          setReadingStats((prev) => ({ ...prev, ...s_readingStats }));
        if (s_totalPages) setTotalPagesMap(s_totalPages);
        if (s_thumbnails) setThumbnailsMap(s_thumbnails);
        if (Array.isArray(s_pinned)) setPinnedSubfolders(s_pinned);

        if (isTauri()) {
          const dataDir = await appLocalDataDir();
          const thumbDir = await join(dataDir, "thumbnails");
          setThumbnailsBaseDir(thumbDir);
        }

        console.log(
          `[Init] State hydration complete in ${Math.round(performance.now() - startTime)}ms.`,
        );
      } catch (err) {
        console.error("[Init] Critical failure during hydration:", err);
      } finally {
        if (isMounted) {
          clearTimeout(safetyTimeout);
          await revealWindow("standard-init");
        }
      }
    };

    initStore();
    return () => {
      isMounted = false;
      clearTimeout(safetyTimeout);
    };
  }, []);

  /* ───────── Directory Scanner (unchanged logic) ───────── */
  const scanPdfsRecursively = async (dirPath) => {
    let results = [];
    try {
      const { readDir } = await import("@tauri-apps/plugin-fs");
      const { join } = await import("@tauri-apps/api/path");

      let entries = [];
      try {
        if (!isTauri()) return [];
        entries = await readDir(dirPath);
      } catch (readErr) {
        console.warn("Skipping unreadable dir:", dirPath, readErr);
        return [];
      }

      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;

        const childPath = await join(dirPath, entry.name);

        if (entry.isDirectory) {
          results.push(...(await scanPdfsRecursively(childPath)));
        } else if (entry.isFile && entry.name.toLowerCase().endsWith(".pdf")) {
          const hue1 = (childPath.length * 13) % 360;
          const hue2 = (hue1 + 40) % 360;
          const coverColor = `linear-gradient(135deg, hsl(${hue1}, 70%, 50%) 0%, hsl(${hue2}, 70%, 40%) 100%)`;
          let parentFolder =
            dirPath.split(/[/\\]/).filter(Boolean).pop() || "Library";

          results.push({
            id: childPath,
            path: childPath,
            name: entry.name,
            author: "Unknown",
            progress: 0,
            folder: parentFolder,
            coverColor,
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
        if (!isTauri()) {
          console.log("[Scanner] Skipping: Not in Tauri environment.");
          return;
        }

        // Only scan custom directories
        const customCats = categories.filter((c) => c.id !== "all" && c.path);
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
        await immediateStoreSave("allBooks", unique);
      } catch (err) {
        setScanError(`Scan Error: ${err.message || "Unknown FS error"}`);
      } finally {
        setIsScanning(false);
      }
    };

    // Defer the initial scan to give UI time to settle
    const timer = setTimeout(
      () => {
        runScan();
      },
      allBooks.length > 0 ? 10000 : 1000,
    ); // 10s if we already have books, 1s if first-time

    return () => clearTimeout(timer);
  }, [categories.length, syncTrigger]); // ONLY trigger on cat count change or manual refresh

  /* ───────── Actions ───────── */
  const addCategory = async () => {
    try {
      if (!isTauri()) {
        setScanError(
          "Desktop App Required: Mapping folders is only available in the InkWell desktop application.",
        );
        return;
      }
      const selectedPath = await open({ directory: true, multiple: false });
      if (selectedPath) {
        let folderPath;
        if (Array.isArray(selectedPath)) {
          folderPath =
            typeof selectedPath[0] === "string"
              ? selectedPath[0]
              : selectedPath[0]?.path;
        } else if (typeof selectedPath === "string") {
          folderPath = selectedPath;
        } else {
          folderPath = selectedPath?.path;
        }
        if (!folderPath)
          throw new Error(
            "Could not extract path from " + JSON.stringify(selectedPath),
          );

        let folderName =
          folderPath.split(/[/\\]/).filter(Boolean).pop() || "New Category";

        const newCat = {
          id: Date.now().toString(),
          name: folderName,
          path: folderPath,
        };
        const existingCustom = categories.filter((c) => c.id !== "all");
        const updatedCustom = [...existingCustom, newCat];

        await immediateStoreSave("categories", updatedCustom);
        setCategories([
          { id: "all", name: "All Books", path: null },
          ...updatedCustom,
        ]);
        setActiveCategoryId(newCat.id);
      }
    } catch (err) {
      console.error("Error adding category mapping:", err);
      setScanError(
        `Adding Category Failed: ${err.message || JSON.stringify(err)}`,
      );
    }
  };

  const importPDF = async () => {
    try {
      if (!isTauri()) {
        setScanError(
          "Desktop App Required: Importing local PDFs is only available in the InkWell desktop application.",
        );
        return;
      }
      const selected = await open({
        multiple: false,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (selected) {
        let filePath;
        if (Array.isArray(selected)) {
          filePath =
            typeof selected[0] === "string" ? selected[0] : selected[0]?.path;
        } else if (typeof selected === "string") {
          filePath = selected;
        } else {
          filePath = selected?.path;
        }
        if (!filePath)
          throw new Error(
            "Could not extract file from " + JSON.stringify(selected),
          );

        let fileName =
          filePath.split(/[/\\]/).filter(Boolean).pop() || "Unknown";
        const hue1 = Math.floor(Math.random() * 360);
        const hue2 = (hue1 + 40) % 360;
        const coverColor = `linear-gradient(135deg, hsl(${hue1}, 70%, 50%) 0%, hsl(${hue2}, 70%, 40%) 100%)`;

        const newBook = {
          id: Date.now().toString(),
          path: filePath,
          name: fileName,
          author: "Unknown",
          progress: 0,
          coverColor,
        };
        const updatedImported = [...importedBooks, newBook];
        setImportedBooks(updatedImported);
        await immediateStoreSave("importedBooks", updatedImported);
        setActiveCategoryId("all");
      }
    } catch (err) {
      console.error("Error importing PDF:", err);
      setScanError(
        `Importing PDF Failed: ${err.message || JSON.stringify(err)}`,
      );
    }
  };

  const removeCategory = async (catId) => {
    if (catId === "all") return;
    const existingCustom = categories.filter(
      (c) => c.id !== "all" && c.id !== catId,
    );
    await immediateStoreSave("categories", existingCustom);
    setCategories([
      { id: "all", name: "All Books", path: null },
      ...existingCustom,
    ]);
    if (activeCategoryId === catId) setActiveCategoryId("all");
  };

  const openBook = (book) => {
    setCurrentBook(book);
    setCurrentView("reader");
    addToRecent(book);
  };

  const closeBook = () => {
    setCurrentBook(null);
    setCurrentView("library");
  };

  const openSettingsWindow = async () => {
    setCurrentView("settings");
  };

  const updateBookProgress = async (path, page) => {
    const newProgress = { ...bookProgress, [path]: { page } };
    setBookProgress(newProgress);
    debouncedSave("bookProgress", newProgress);
  };

  const updateShortcuts = async (newShortcuts) => {
    setShortcuts(newShortcuts);
    await immediateStoreSave("shortcuts", newShortcuts);
  };

  const togglePdfNightMode = useCallback(async () => {
    setPdfNightMode((prev) => {
      const newVal = !prev;
      immediateStoreSave("pdfNightMode", newVal);
      return newVal;
    });
  }, [immediateStoreSave]);

  const updateTheme = async (newTheme) => {
    setTheme(newTheme);
    await immediateStoreSave("theme", newTheme);
  };

  const toggleFullscreen = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const appWindow = getCurrentWindow();
      const wasFullscreen = await appWindow.isFullscreen();

      // Perform the native toggle
      await appWindow.setFullscreen(!wasFullscreen);

      // Rely on the window resize listener to update isFullscreen state
      // but toggle it locally too for snappy UI feedback
      setIsFullscreen(!wasFullscreen);
    } catch (err) {
      console.error("Fullscreen API error:", err);
    }
  }, []);

  /* ───────── New Actions ───────── */
  const updateSettings = async (partial) => {
    const newSettings = { ...settings, ...partial };
    setSettings(newSettings);
    debouncedSave("settings", newSettings);
  };

  const addToRecent = async (book) => {
    const updated = [
      book,
      ...recentBooks.filter((b) => b.path !== book.path),
    ].slice(0, 10);
    setRecentBooks(updated);
    debouncedSave("recentBooks", updated);

    // Update reading stats
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    setReadingStats((prev) => {
      const dates = prev.readDates || [];
      const updatedDates = dates.includes(today)
        ? dates
        : [...dates, today].slice(-90); // Keep 90 days
      const newStats = {
        totalBooksOpened: (prev.totalBooksOpened || 0) + 1,
        lastReadDate: today,
        readDates: updatedDates,
      };
      debouncedSave("readingStats", newStats);
      return newStats;
    });
  };

  const toggleFavorite = async (bookPath) => {
    const updated = favoriteBookIds.includes(bookPath)
      ? favoriteBookIds.filter((id) => id !== bookPath)
      : [...favoriteBookIds, bookPath];
    setFavoriteBookIds(updated);
    await immediateStoreSave("favoriteBookIds", updated);
    return !favoriteBookIds.includes(bookPath); // return new state
  };

  const isFavorite = (bookPath) => favoriteBookIds.includes(bookPath);

  const setBookTotalPages = async (bookPath, numPages) => {
    const updated = { ...totalPagesMap, [bookPath]: numPages };
    setTotalPagesMap(updated);
    debouncedSave("totalPagesMap", updated);
  };

  const updateViewMode = async (mode) => {
    setViewMode(mode);
    await immediateStoreSave("viewMode", mode);
  };

  const updateSortOrder = async (order) => {
    setSortOrder(order);
    await immediateStoreSave("sortOrder", order);
  };

  const removeImportedBook = async (bookPath) => {
    const updated = importedBooks.filter((b) => b.path !== bookPath);
    setImportedBooks(updated);
    await immediateStoreSave("importedBooks", updated);
  };

  const togglePinSubfolder = async (categoryId, folderName) => {
    const isPinned = pinnedSubfolders.some(
      (p) => p.categoryId === categoryId && p.folderName === folderName,
    );
    let updated;
    if (isPinned) {
      updated = pinnedSubfolders.filter(
        (p) => !(p.categoryId === categoryId && p.folderName === folderName),
      );
    } else {
      updated = [...pinnedSubfolders, { categoryId, folderName }];
    }
    setPinnedSubfolders(updated);
    await immediateStoreSave("pinnedSubfolders", updated);
  };

  const isSubfolderPinned = (categoryId, folderName) => {
    return pinnedSubfolders.some(
      (p) => p.categoryId === categoryId && p.folderName === folderName,
    );
  };

  const clearThumbnailCache = async () => {
    try {
      const { removeDir, mkdir } = await import("@tauri-apps/plugin-fs");
      if (thumbnailsBaseDir) {
        await removeDir(thumbnailsBaseDir, { recursive: true });
        await mkdir(thumbnailsBaseDir, { recursive: true });
        setThumbnailsMap({});
        await immediateStoreSave("thumbnailsMap", {});
        return true;
      }
    } catch (err) {
      console.error("Failed to clear thumbnail cache:", err);
      throw err;
    }
  };

  const getThumbnailUrl = useCallback(
    async (fileName) => {
      if (!fileName || !thumbnailsBaseDir) return null;
      try {
        const { join } = await import("@tauri-apps/api/path");
        const { convertFileSrc } = await import("@tauri-apps/api/core");
        const fullPath = await join(thumbnailsBaseDir, fileName);
        const url = convertFileSrc(fullPath);
        // Only log once per session or for specific debug needs
        if (!window.__THUMB_LOGGED__) {
          console.log(`[Thumbnails] Sample resolved URL:`, url);
          window.__THUMB_LOGGED__ = true;
        }
        return url;
      } catch (err) {
        console.error("Error creating thumbnail URL:", err);
        return null;
      }
    },
    [thumbnailsBaseDir],
  );

  /* ───────── Filter books by category ───────── */
  const booksByCategory = React.useMemo(() => {
    let filtered;
    if (activeCategoryId === "all") {
      filtered = [...allBooks, ...importedBooks];
    } else {
      const cat = categories.find((c) => c.id === activeCategoryId);
      if (!cat || !cat.path) {
        filtered = importedBooks;
      } else {
        // Filter allBooks for those that are in this category's path
        filtered = allBooks.filter((b) => b.path.startsWith(cat.path));
      }
    }

    // Secondary filter: Active subfolder
    if (activeSubfolder) {
      filtered = filtered.filter((b) => b.folder === activeSubfolder);
    }

    return filtered;
  }, [allBooks, importedBooks, activeCategoryId, categories, activeSubfolder]);

  /* ───────── Sort books ───────── */
  const sortedBooks = React.useMemo(() => {
    let sorted = [...booksByCategory];
    switch (sortOrder) {
      case "name":
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "date":
        sorted.reverse();
        break;
      case "lastRead":
        sorted.sort((a, b) => {
          const aIdx = recentBooks.findIndex((r) => r.path === a.path);
          const bIdx = recentBooks.findIndex((r) => r.path === b.path);
          if (aIdx === -1 && bIdx === -1) return 0;
          if (aIdx === -1) return 1;
          if (bIdx === -1) return -1;
          return aIdx - bIdx;
        });
        break;
      case "progress":
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
    return sortedBooks.filter((b) => b.name.toLowerCase().includes(q));
  }, [sortedBooks, searchQuery]);

  /* ───────── Continue Reading Book ───────── */
  const continueReadingBook = React.useMemo(() => {
    if (recentBooks.length === 0) return null;
    // Find the most recent book that has progress but isn't 100% done
    for (const book of recentBooks) {
      const prog = bookProgress[book.path];
      const total = totalPagesMap[book.path];
      if (prog && total && total > 0) {
        const pct = Math.round((prog.page / total) * 100);
        if (pct > 0 && pct < 100) return book;
      }
    }
    // If no in-progress book, just return the most recent
    return recentBooks[0];
  }, [recentBooks, bookProgress, totalPagesMap]);

  /* ───────── Reading Stats (computed) ───────── */
  const computedStats = React.useMemo(() => {
    // Calculate streak (consecutive days with reading)
    const dates = readingStats.readDates || [];
    let streak = 0;
    if (dates.length > 0) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      let checkDate = new Date(today);

      // Check if user read today or yesterday
      const todayStr = today.toISOString().slice(0, 10);
      const yesterdayDate = new Date(today);
      yesterdayDate.setDate(yesterdayDate.getDate() - 1);
      const yesterdayStr = yesterdayDate.toISOString().slice(0, 10);

      if (!dates.includes(todayStr) && !dates.includes(yesterdayStr)) {
        streak = 0;
      } else {
        if (!dates.includes(todayStr)) {
          checkDate = yesterdayDate;
        }
        while (true) {
          const ds = checkDate.toISOString().slice(0, 10);
          if (dates.includes(ds)) {
            streak++;
            checkDate.setDate(checkDate.getDate() - 1);
          } else {
            break;
          }
        }
      }
    }

    // Total pages read across all books
    let totalPagesRead = 0;
    Object.entries(bookProgress).forEach(([path, prog]) => {
      if (prog && prog.page) totalPagesRead += prog.page;
    });

    return {
      totalBooksOpened: readingStats.totalBooksOpened || 0,
      readingStreak: streak,
      totalPagesRead,
      booksInLibrary: allBooks.length + importedBooks.length,
    };
  }, [readingStats, bookProgress, allBooks.length, importedBooks.length]);

  /* ───────── Context value ───────── */
  const value = {
    // View
    currentView,
    setCurrentView,
    currentBook,
    setCurrentBook,
    openBook,
    closeBook,
    openSettingsWindow,

    // Theme
    theme,
    setTheme: updateTheme,
    pdfNightMode,
    togglePdfNightMode,
    isFullscreen,
    toggleFullscreen,

    // Library
    categories,
    activeCategoryId,
    setActiveCategoryId,
    books: filteredBooks,
    bookProgress,
    updateBookProgress,
    isScanning,
    scanError,
    addCategory,
    removeCategory,
    importPDF,
    refreshLibrary,

    // Settings
    settings,
    updateSettings,
    shortcuts,
    updateShortcuts,

    // New features
    recentBooks,
    addToRecent,
    favoriteBookIds,
    toggleFavorite,
    isFavorite,
    sidebarCollapsed,
    setSidebarCollapsed,
    commandPaletteOpen,
    setCommandPaletteOpen,
    searchQuery,
    setSearchQuery,
    viewMode,
    updateViewMode,
    sortOrder,
    updateSortOrder,
    totalPagesMap,
    setBookTotalPages,
    thumbnailsMap,
    removeImportedBook,
    pinnedSubfolders,
    togglePinSubfolder,
    isSubfolderPinned,
    activeSubfolder,
    setActiveSubfolder,
    getThumbnailUrl,
    thumbnailsBaseDir,
    continueReadingBook,
    computedStats,
    clearThumbnailCache,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useAppContext must be used within an AppProvider");
  }
  return context;
};
