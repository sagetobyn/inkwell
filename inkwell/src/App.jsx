import React, { useEffect, useMemo } from 'react';
import { AppProvider, useAppContext } from './context/AppContext';
import { ToastProvider } from './components/Toast';
import LibraryView from './views/LibraryView';
import ReaderView from './views/ReaderView';
import SettingsView from './views/SettingsView';
import CommandPalette from './components/CommandPalette';
import {
  Settings, Moon, Sun, Maximize, BookOpen,
  ZoomIn, ZoomOut, ArrowLeft, Search, Palette
} from 'lucide-react';
import './components/components.css';
import './App.css';

const AppContent = () => {
  const {
    currentView, setCurrentView,
    commandPaletteOpen, setCommandPaletteOpen,
    theme, setTheme,
    pdfNightMode, togglePdfNightMode,
    closeBook, currentBook,
    settings,
  } = useAppContext();

  // Global keyboard listener for command palette
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Build command list
  const commands = useMemo(() => {
    const cmds = [
      {
        id: 'toggle-theme',
        label: theme === 'dark' ? 'Switch to Light Theme' : 'Switch to Dark Theme',
        icon: theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />,
        category: 'Appearance',
        action: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
      },
      {
        id: 'open-settings',
        label: 'Open Settings',
        icon: <Settings size={16} />,
        category: 'Navigation',
        shortcut: 'Ctrl+,',
        action: () => setCurrentView('settings'),
      },
      {
        id: 'go-library',
        label: 'Go to Library',
        icon: <BookOpen size={16} />,
        category: 'Navigation',
        action: () => { closeBook(); setCurrentView('library'); },
      },
    ];

    if (currentView === 'reader') {
      cmds.push(
        {
          id: 'toggle-night',
          label: pdfNightMode ? 'Disable Night Mode' : 'Enable Night Mode',
          icon: pdfNightMode ? <Sun size={16} /> : <Moon size={16} />,
          category: 'Reader',
          shortcut: 'N',
          action: togglePdfNightMode,
        },
        {
          id: 'back-library',
          label: 'Back to Library',
          icon: <ArrowLeft size={16} />,
          category: 'Reader',
          shortcut: 'Esc',
          action: closeBook,
        },
      );
    }

    return cmds;
  }, [currentView, theme, pdfNightMode]);

  // Apply UI density as data attribute
  useEffect(() => {
    document.documentElement.dataset.density = settings.uiDensity || 'comfortable';
  }, [settings.uiDensity]);

  return (
    <div className="app-container">
      <main className="view-container" key={currentView}>
        <div className={`view-transition ${settings.animationsEnabled !== false ? 'animate-fade-in' : ''}`}>
          {currentView === 'library' && <LibraryView />}
          {currentView === 'reader' && <ReaderView />}
          {currentView === 'settings' && <SettingsView />}
        </div>
      </main>

      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        commands={commands}
      />
    </div>
  );
};

function App() {
  return (
    <AppProvider>
      <ToastProvider>
        <AppContent />
      </ToastProvider>
    </AppProvider>
  );
}

export default App;
