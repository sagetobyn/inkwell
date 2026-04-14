import React, { useEffect, useMemo } from 'react';
import { AppProvider, useAppContext } from './context/AppContext';
import { ToastProvider } from './components/Toast';
import LibraryView from './views/LibraryView';
import ReaderView from './views/ReaderView';
import SettingsView from './views/SettingsView';
import CommandPalette from './components/CommandPalette';
import TitleBar from './components/TitleBar';
import {
  Settings, Moon, Sun, Maximize, BookOpen,
  ZoomIn, ZoomOut, ArrowLeft, Search, Palette
} from 'lucide-react';
import './components/components.css';
import './App.css';


class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error("View Crash:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '2rem', color: 'white', background: '#1a1a1a', height: '100vh' }}>
          <h2>View Crashed</h2>
          <pre style={{ color: '#ef4444', marginTop: '1rem', whiteSpace: 'pre-wrap' }}>
            {this.state.error?.toString()}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop: '2rem', padding: '0.5rem 1rem', background: '#3b82f6', border: 'none', borderRadius: '4px', color: 'white', cursor: 'pointer' }}
          >
            Reload App
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const AppContent = () => {
  const {
    currentView, setCurrentView,
    commandPaletteOpen, setCommandPaletteOpen,
    theme, setTheme,
    pdfNightMode, togglePdfNightMode,
    closeBook, currentBook,
    settings,
    openSettingsWindow,
    isFullscreen,
  } = useAppContext();

  const isSettingsWindow = useMemo(() => {
    return new URLSearchParams(window.location.search).get('view') === 'settings';
  }, []);

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
        action: openSettingsWindow,
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



  return (
    <div className={`app-container ${isSettingsWindow ? 'settings-window-active' : ''} ${isFullscreen && currentView === 'reader' ? 'fullscreen-mode' : ''}`}>
      {!(isFullscreen && currentView === 'reader') && <TitleBar />}
      {/* Global Background for Skinning */}
      <div className="app-bg-container" />

      <main className="view-container">
        <div className="view-transition" key={currentView}>
          {currentView === 'library' && <LibraryView />}
          {currentView === 'reader' && <ReaderView />}
          {currentView === 'settings' && <SettingsView />}
        </div>
      </main>

      {!isSettingsWindow && (
        <CommandPalette
          isOpen={commandPaletteOpen}
          onClose={() => setCommandPaletteOpen(false)}
          commands={commands}
        />
      )}
    </div>
  );
};

function App() {
  return (
    <AppProvider>
      <ToastProvider>
        <ErrorBoundary>
          <AppContent />
        </ErrorBoundary>
      </ToastProvider>
    </AppProvider>
  );
}

export default App;
