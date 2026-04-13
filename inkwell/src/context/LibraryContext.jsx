import React, { createContext, useState, useContext, useEffect, useCallback, useRef } from 'react';
import { load } from '@tauri-apps/plugin-store';
import { open } from '@tauri-apps/plugin-dialog';
import { appLocalDataDir, join } from '@tauri-apps/api/path';
import { convertFileSrc } from '@tauri-apps/api/core';

const LibraryContext = createContext();

export const LibraryProvider = ({ children }) => {
  const [allBooks, setAllBooks] = useState([]);
  const [importedBooks, setImportedBooks] = useState([]);
  const [categories, setCategories] = useState([{ id: 'all', name: 'All Books', path: null }]);
  const [activeCategoryId, setActiveCategoryId] = useState('all');
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState(null);
  const [thumbnailsMap, setThumbnailsMap] = useState({});
  const [thumbnailsBaseDir, setThumbnailsBaseDir] = useState(null);
  const [syncTrigger, setSyncTrigger] = useState(0);

  const pendingThumbnailSaves = useRef({});
  const thumbnailSaveTimeout = useRef(null);

  // Initialize store
  useEffect(() => {
    const init = async () => {
      try {
        const store = await load('library.json', { autoSave: false });
        const [cats, imp, all, thumbs] = await Promise.all([
          store.get('categories'), store.get('importedBooks'), 
          store.get('allBooks'), store.get('thumbnailsMap')
        ]);
        if (cats) setCategories([{ id: 'all', name: 'All Books', path: null }, ...cats]);
        if (imp) setImportedBooks(imp);
        if (all) setAllBooks(all);
        if (thumbs) setThumbnailsMap(thumbs);

        const dataDir = await appLocalDataDir();
        setThumbnailsBaseDir(await join(dataDir, 'thumbnails'));
      } catch (err) { console.error("Library load failed", err); }
    };
    init();
  }, []);

  const save = useCallback(async (key, value) => {
    try {
      const store = await load('library.json', { autoSave: false });
      await store.set(key, value);
      await store.save();
    } catch (err) { console.error(`Save ${key} failed`, err); }
  }, []);

  // Optimized thumbnail save (batched)
  const batchedThumbnailSave = useCallback((newMap) => {
    setThumbnailsMap(newMap);
    if (thumbnailSaveTimeout.current) clearTimeout(thumbnailSaveTimeout.current);
    thumbnailSaveTimeout.current = setTimeout(() => {
      save('thumbnailsMap', newMap);
    }, 2000); // Wait 2s before writing to disk
  }, [save]);

  const refreshLibrary = () => setSyncTrigger(t => t + 1);

  const importPDF = async () => {
    try {
      const selected = await open({ multiple: false, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
      const filePath = Array.isArray(selected) ? selected[0] : selected;
      if (filePath) {
        const pathStr = typeof filePath === 'string' ? filePath : filePath.path;
        const name = pathStr.split(/[/\\]/).pop();
        const hue = Math.floor(Math.random() * 360);
        const book = { 
          id: Date.now().toString(), path: pathStr, name, 
          author: 'Unknown', progress: 0, 
          coverColor: `linear-gradient(135deg, hsl(${hue}, 70%, 50%), hsl(${(hue+40)%360}, 70%, 40%))` 
        };
        const next = [...importedBooks, book];
        setImportedBooks(next);
        save('importedBooks', next);
      }
    } catch (err) { console.error("Import failed", err); }
  };

  const removeImportedBook = (path) => {
    const next = importedBooks.filter(b => b.path !== path);
    setImportedBooks(next);
    save('importedBooks', next);
  };

  const getThumbnailUrl = useCallback(async (fileName) => {
    if (!fileName || !thumbnailsBaseDir) return null;
    try {
      return convertFileSrc(await join(thumbnailsBaseDir, fileName));
    } catch (err) { return null; }
  }, [thumbnailsBaseDir]);

  const value = {
    allBooks, setAllBooks, importedBooks, categories, setCategories,
    activeCategoryId, setActiveCategoryId, isScanning, setIsScanning,
    scanError, setScanError, thumbnailsMap, setThumbnailsMap: batchedThumbnailSave,
    refreshLibrary, syncTrigger, importPDF, removeImportedBook, getThumbnailUrl
  };

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
};

export const useLibrary = () => useContext(LibraryContext);
