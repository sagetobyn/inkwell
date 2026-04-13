import React, { createContext, useState, useContext, useEffect, useCallback, useRef } from 'react';
import { load } from '@tauri-apps/plugin-store';

const ReaderContext = createContext();

export const ReaderProvider = ({ children }) => {
  const [currentBook, setCurrentBook] = useState(null);
  const [totalPagesMap, setTotalPagesMap] = useState({});
  const [bookProgress, setBookProgress] = useState({});
  const [pdfNightMode, setPdfNightMode] = useState(false);
  const [recentBooks, setRecentBooks] = useState([]);
  const [favoriteBookIds, setFavoriteBookIds] = useState([]);

  const progressSaveTimeout = useRef(null);

  useEffect(() => {
    const init = async () => {
      try {
        const store = await load('library.json', { autoSave: false });
        const keys = ['totalPagesMap', 'bookProgress', 'pdfNightMode', 'recentBooks', 'favoriteBookIds'];
        const [
          s_totalPages, s_progress, s_pdfMode, s_recent, s_favorites
        ] = await Promise.all(keys.map(k => store.get(k)));

        if (s_totalPages) setTotalPagesMap(s_totalPages);
        if (s_progress) setBookProgress(s_progress);
        if (s_pdfMode !== undefined) setPdfNightMode(s_pdfMode);
        if (s_recent) setRecentBooks(s_recent);
        if (s_favorites) setFavoriteBookIds(s_favorites);
      } catch (err) { console.error("Reader state load failed", err); }
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

  const updateBookProgress = (path, page) => {
    const next = { ...bookProgress, [path]: { page } };
    setBookProgress(next);
    if (progressSaveTimeout.current) clearTimeout(progressSaveTimeout.current);
    progressSaveTimeout.current = setTimeout(() => save('bookProgress', next), 2000);
  };

  const setBookTotalPages = (path, total) => {
    const next = { ...totalPagesMap, [path]: total };
    setTotalPagesMap(next);
    save('totalPagesMap', next);
  };

  const toggleFavorite = (path) => {
    const next = favoriteBookIds.includes(path) 
      ? favoriteBookIds.filter(id => id !== path) 
      : [...favoriteBookIds, path];
    setFavoriteBookIds(next);
    save('favoriteBookIds', next);
    return !favoriteBookIds.includes(path);
  };

  const addToRecent = (book) => {
    const next = [book, ...recentBooks.filter(b => b.path !== book.path)].slice(0, 10);
    setRecentBooks(next);
    save('recentBooks', next);
  };

  const value = {
    currentBook, setCurrentBook, totalPagesMap, setBookTotalPages,
    bookProgress, updateBookProgress, pdfNightMode, setPdfNightMode,
    recentBooks, addToRecent, favoriteBookIds, toggleFavorite
  };

  return <ReaderContext.Provider value={value}>{children}</ReaderContext.Provider>;
};

export const useReader = () => useContext(ReaderContext);
