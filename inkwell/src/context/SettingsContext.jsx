import React, { createContext, useState, useContext, useEffect, useCallback, useRef } from 'react';
import { load } from '@tauri-apps/plugin-store';

const SettingsContext = createContext();

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

export const SettingsProvider = ({ children }) => {
  const defaultShortcuts = {
    fullscreen: 'Enter', nextpage: 'ArrowRight', prevPage: 'ArrowLeft',
    zoomIn: '+', zoomOut: '-', toggleToc: 't', toggleNightMode: 'n',
    goToPage: 'g', backToLibrary: 'Escape', commandPalette: 'k',
    saveHighlight: 'h', removeHighlight: 'x',
  };

  const defaultSettings = {
    accentColor: ACCENT_PRESETS[0], uiDensity: 'comfortable', sidebarPosition: 'left',
    animationsEnabled: true, bgPattern: 'none', defaultZoom: 1.2, scrollBehavior: 'smooth',
    pageTransition: 'fade', nightModeType: 'invert', sepiaWarmth: 50, brightness: 100,
    autoOpenLastBook: false, showReadingTime: true, autoHideDelay: 3,
    defaultViewMode: 'grid', defaultSortOrder: 'name', showFileExtensions: true,
    confirmRemoveFolder: true, pageGlow: true, showBookCovers: true,
    showBookProgress: true, showLibraryStats: true, showHeroSection: true,
    showRecentSection: true, glassIntensity: 0.7, glassBlur: 16, fontFamily: 'sans',
    enable3DEffects: true, libraryGridSize: 1.0, readerZenMode: 'off',
    transitionSpeed: 'normal', startupPage: 'library', spaceToScroll: true,
    readerScrollStep: 0.8,
  };

  const [settings, setSettings] = useState(defaultSettings);
  const [theme, setTheme] = useState('dark');
  const [shortcuts, setShortcuts] = useState(defaultShortcuts);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Load from store
  useEffect(() => {
    const init = async () => {
      try {
        const store = await load('library.json', { autoSave: false });
        const [s, t, sh] = await Promise.all([
          store.get('settings'), store.get('theme'), store.get('shortcuts')
        ]);
        if (s) setSettings(prev => ({ ...prev, ...s }));
        if (t) setTheme(t);
        if (sh) setShortcuts(prev => ({ ...prev, ...sh }));
      } catch (err) { console.error("Settings load failed", err); }
    };
    init();
  }, []);

  // Save to store helper
  const save = useCallback(async (key, value) => {
    try {
      const store = await load('library.json', { autoSave: false });
      await store.set(key, value);
      await store.save();
    } catch (err) { console.error(`Save ${key} failed`, err); }
  }, []);

  const updateSettings = (partial) => {
    const next = { ...settings, ...partial };
    setSettings(next);
    save('settings', next);
  };

  const updateTheme = (newTheme) => {
    setTheme(newTheme);
    save('theme', newTheme);
  };

  // Apply visual styles
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--ink-accent-h', settings.accentColor.h);
    root.style.setProperty('--ink-accent-s', `${settings.accentColor.s}%`);
    root.style.setProperty('--ink-accent-l', `${settings.accentColor.l}%`);
    root.style.setProperty('--ink-glass-opacity', settings.glassIntensity ?? 0.7);
    root.style.setProperty('--ink-glass-blur', `${settings.glassBlur ?? 16}px`);
    
    const fontMap = { sans: 'var(--font-sans)', serif: 'Lora, serif', mono: 'var(--font-mono)' };
    root.style.setProperty('--ink-font-family', fontMap[settings.fontFamily] || 'var(--font-sans)');
    
    const speedMap = { fast: '120ms', normal: '250ms', slow: '450ms' };
    root.style.setProperty('--ink-transition-duration', speedMap[settings.transitionSpeed] || '250ms');
    root.style.setProperty('--ink-grid-scale', settings.libraryGridSize ?? 1.0);
    
    if (theme === 'light') document.body.classList.add('light-theme');
    else document.body.classList.remove('light-theme');
  }, [settings, theme]);

  const value = {
    settings, updateSettings, theme, setTheme: updateTheme,
    shortcuts, setShortcuts, sidebarCollapsed, setSidebarCollapsed
  };

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
};

export const useSettings = () => useContext(SettingsContext);
