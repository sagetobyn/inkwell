import React, { useState } from 'react';
import { useAppContext, ACCENT_PRESETS } from '../context/AppContext';
import { useToast } from '../components/Toast';
import Tooltip from '../components/Tooltip';
import {
  ArrowLeft, Monitor, Keyboard, BookOpen, Palette, Info,
  Eye, ChevronRight, RotateCcw, Download, Upload, Plus, Trash2
} from 'lucide-react';
import './SettingsView.css';

const TABS = [
  { id: 'appearance', label: 'Appearance', icon: <Palette size={16} /> },
  { id: 'reader', label: 'Reader', icon: <BookOpen size={16} /> },
  { id: 'library', label: 'Library', icon: <Eye size={16} /> },
  { id: 'shortcuts', label: 'Shortcuts', icon: <Keyboard size={16} /> },
  { id: 'advanced', label: 'Advanced', icon: <Monitor size={16} /> },
  { id: 'about', label: 'About', icon: <Info size={16} /> },
];

const Toggle = ({ checked, onChange }) => (
  <label className="toggle-switch">
    <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
    <div className="toggle-track">
      <div className="toggle-thumb" />
    </div>
  </label>
);

const SettingRow = ({ label, description, children }) => (
  <div className="setting-row">
    <div className="setting-info">
      <h4 className="setting-label">{label}</h4>
      {description && <p className="setting-desc">{description}</p>}
    </div>
    <div className="setting-control">{children}</div>
  </div>
);

const SettingsView = () => {
  const {
    settings, updateSettings, addCategory, categories, removeCategory,
    clearThumbnailCache
  } = useAppContext();

  const isSettingsWindow = React.useMemo(() => {
    return new URLSearchParams(window.location.search).get('view') === 'settings';
  }, []);

  const addToast = useToast();
  const [activeTab, setActiveTab] = useState('appearance');
  const [listeningKey, setListeningKey] = useState(null);

  const customFolders = categories.filter(c => c.id !== 'all');

  const handleRemoveFolder = (cat) => {
    if (settings.confirmRemoveFolder !== false) {
      if (window.confirm(`Are you sure you want to stop watching "${cat.name}"?`)) {
        removeCategory(cat.id);
        addToast('Folder mapping removed', 'info');
      }
    } else {
      removeCategory(cat.id);
      addToast('Folder mapping removed', 'info');
    }
  };

  const handleKeyDown = (e, action) => {
    e.preventDefault();
    if (listeningKey === action) {
      const newShortcuts = { ...shortcuts, [action]: e.key };
      updateShortcuts(newShortcuts);
      setListeningKey(null);
      addToast('Shortcut updated', 'success');
    }
  };

  const resetShortcuts = () => {
    updateShortcuts({
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
    });
    addToast('Shortcuts reset to defaults', 'success');
  };

  const exportSettings = () => {
    const data = { theme, shortcuts, settings, categories: customFolders };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'inkwell-settings.json';
    a.click();
    URL.revokeObjectURL(url);
    addToast('Settings exported', 'success');
  };

  const importSettings = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (data.theme) setTheme(data.theme);
        if (data.shortcuts) updateShortcuts(data.shortcuts);
        if (data.settings) updateSettings(data.settings);
        addToast('Settings imported', 'success');
      } catch (err) {
        addToast('Failed to import settings', 'error');
      }
    };
    input.click();
  };

  const shortcutLabels = {
    fullscreen: 'Toggle Fullscreen',
    nextPage: 'Next Page',
    prevPage: 'Previous Page',
    zoomIn: 'Zoom In',
    zoomOut: 'Zoom Out',
    toggleToc: 'Toggle Table of Contents',
    toggleNightMode: 'Toggle Night Mode',
    goToPage: 'Go to Page',
    backToLibrary: 'Back to Library',
    commandPalette: 'Command Palette',
  };

  return (
    <div className="settings-container">
      {/* Header */}
      <header className="settings-header">
        <div className="settings-header-left">
          <Tooltip content={isSettingsWindow ? "Close" : "Back to Library"}>
            <button className="icon-btn" onClick={async () => {
              if (isSettingsWindow) {
                const { getCurrentWindow } = await import('@tauri-apps/api/window');
                getCurrentWindow().close();
              } else {
                setCurrentView('library');
              }
            }}>
              <ArrowLeft size={18} />
            </button>
          </Tooltip>
          <h1 className="settings-title">Settings</h1>
        </div>
      </header>

      <div className="settings-body">
        {/* Sidebar */}
        <aside className="settings-sidebar">
          <nav className="settings-nav">
            {TABS.map(tab => (
              <button
                key={tab.id}
                className={`settings-tab ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            ))}
          </nav>
        </aside>

        {/* Content */}
        <main className="settings-content">
          <div className="settings-scroll">

            {/* ─── Appearance ─── */}
            {activeTab === 'appearance' && (
              <div className="settings-section animate-fade-in">
                <div className="section-heading">
                  <div className="section-icon" style={{ background: 'var(--ink-primary)' }}>
                    <Palette size={20} color="white" />
                  </div>
                  <div>
                    <h2>Appearance</h2>
                    <p>Customize how InkWell looks.</p>
                  </div>
                </div>
                <hr className="divider" />

                <SettingRow label="Theme" description="Toggle between light and dark interface.">
                  <div className="theme-toggle-group">
                    <button className={`theme-btn ${theme === 'dark' ? 'active' : ''}`} onClick={() => setTheme('dark')}>Dark</button>
                    <button className={`theme-btn ${theme === 'light' ? 'active' : ''}`} onClick={() => setTheme('light')}>Light</button>
                  </div>
                </SettingRow>

                <SettingRow label="Accent Color" description="Choose your preferred accent color.">
                  <div className="accent-grid">
                    {ACCENT_PRESETS.map(preset => (
                      <Tooltip key={preset.name} content={preset.name}>
                        <button
                          className={`accent-swatch ${settings.accentColor?.name === preset.name ? 'active' : ''}`}
                          style={{ background: `hsl(${preset.h}, ${preset.s}%, ${preset.l}%)` }}
                          onClick={() => updateSettings({ accentColor: preset })}
                        />
                      </Tooltip>
                    ))}
                  </div>
                </SettingRow>

                <SettingRow label="UI Density" description="Adjust the spacing of interface elements.">
                  <div className="theme-toggle-group">
                    {['compact', 'comfortable', 'spacious'].map(d => (
                      <button key={d} className={`theme-btn ${settings.uiDensity === d ? 'active' : ''}`} onClick={() => updateSettings({ uiDensity: d })}>
                        {d.charAt(0).toUpperCase() + d.slice(1)}
                      </button>
                    ))}
                  </div>
                </SettingRow>

                <SettingRow label="Animations" description="Enable or disable interface animations.">
                  <Toggle checked={settings.animationsEnabled !== false} onChange={v => updateSettings({ animationsEnabled: v })} />
                </SettingRow>

                <SettingRow label="Background Pattern" description="Pattern behind PDF pages while reading.">
                  <div className="theme-toggle-group">
                    {['none', 'dots', 'grid'].map(p => (
                      <button key={p} className={`theme-btn ${settings.bgPattern === p ? 'active' : ''}`} onClick={() => updateSettings({ bgPattern: p })}>
                        {p.charAt(0).toUpperCase() + p.slice(1)}
                      </button>
                    ))}
                  </div>
                </SettingRow>

                <SettingRow label="Gradient Mesh" description="Animated background effect in the library.">
                  <Toggle checked={settings.gradientMesh !== false} onChange={v => updateSettings({ gradientMesh: v })} />
                </SettingRow>

                <hr className="divider" />
                <div className="section-subtitle">Glassmorphism</div>

                <SettingRow label="Backdrop Opacity" description={`${Math.round((settings.glassIntensity ?? 0.7) * 100)}%`}>
                  <div className="slider-container">
                    <input
                      type="range"
                      className="slider-track"
                      min={0}
                      max={100}
                      value={Math.round((settings.glassIntensity ?? 0.7) * 100)}
                      onChange={e => updateSettings({ glassIntensity: parseInt(e.target.value, 10) / 100 })}
                    />
                    <span className="slider-value mono">{Math.round((settings.glassIntensity ?? 0.7) * 100)}%</span>
                  </div>
                </SettingRow>

                <SettingRow label="Backdrop Blur" description={`${settings.glassBlur ?? 16}px`}>
                  <div className="slider-container">
                    <input
                      type="range"
                      className="slider-track"
                      min={0}
                      max={40}
                      value={settings.glassBlur ?? 16}
                      onChange={e => updateSettings({ glassBlur: parseInt(e.target.value, 10) })}
                    />
                    <span className="slider-value mono">{settings.glassBlur ?? 16}px</span>
                  </div>
                </SettingRow>

                <hr className="divider" />
                <div className="section-subtitle">Typography</div>

                <SettingRow label="App Font Family" description="Choose the typeface for the entire application.">
                  <div className="theme-toggle-group">
                    {[
                      { id: 'sans', label: 'Sans' },
                      { id: 'serif', label: 'Serif' },
                      { id: 'mono', label: 'Mono' }
                    ].map(f => (
                      <button 
                        key={f.id} 
                        className={`theme-btn ${settings.fontFamily === f.id ? 'active' : ''}`} 
                        onClick={() => updateSettings({ fontFamily: f.id })}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </SettingRow>
              </div>
            )}

            {/* ─── Reader ─── */}
            {activeTab === 'reader' && (
              <div className="settings-section animate-fade-in">
                <div className="section-heading">
                  <div className="section-icon" style={{ background: 'var(--ink-accent-teal)' }}>
                    <BookOpen size={20} color="white" />
                  </div>
                  <div>
                    <h2>Reader</h2>
                    <p>Configure your reading experience.</p>
                  </div>
                </div>
                <hr className="divider" />

                <SettingRow label="Default Zoom" description={`${Math.round((settings.defaultZoom || 1.2) * 100)}%`}>
                  <div className="slider-container">
                    <input
                      type="range"
                      className="slider-track"
                      min={50}
                      max={200}
                      value={Math.round((settings.defaultZoom || 1.2) * 100)}
                      onChange={e => updateSettings({ defaultZoom: parseInt(e.target.value, 10) / 100 })}
                    />
                    <span className="slider-value mono">{Math.round((settings.defaultZoom || 1.2) * 100)}%</span>
                  </div>
                </SettingRow>

                <SettingRow label="Page Transition" description="Animation between page turns.">
                  <div className="theme-toggle-group">
                    {['none', 'fade', 'slide'].map(t => (
                      <button key={t} className={`theme-btn ${settings.pageTransition === t ? 'active' : ''}`} onClick={() => updateSettings({ pageTransition: t })}>
                        {t.charAt(0).toUpperCase() + t.slice(1)}
                      </button>
                    ))}
                  </div>
                </SettingRow>

                <SettingRow label="Night Mode Type" description="How night mode processing works.">
                  <div className="theme-toggle-group">
                    <button className={`theme-btn ${settings.nightModeType === 'invert' ? 'active' : ''}`} onClick={() => updateSettings({ nightModeType: 'invert' })}>Invert</button>
                    <button className={`theme-btn ${settings.nightModeType === 'sepia' ? 'active' : ''}`} onClick={() => updateSettings({ nightModeType: 'sepia' })}>Sepia</button>
                  </div>
                </SettingRow>

                <SettingRow label="Brightness" description={`${settings.brightness || 100}%`}>
                  <div className="slider-container">
                    <input
                      type="range"
                      className="slider-track"
                      min={50}
                      max={150}
                      value={settings.brightness || 100}
                      onChange={e => updateSettings({ brightness: parseInt(e.target.value, 10) })}
                    />
                    <span className="slider-value mono">{settings.brightness || 100}%</span>
                  </div>
                </SettingRow>

                {settings.nightModeType === 'sepia' && (
                  <SettingRow label="Sepia Warmth" description={`${settings.sepiaWarmth || 50}%`}>
                    <div className="slider-container">
                      <input
                        type="range"
                        className="slider-track"
                        min={10}
                        max={100}
                        value={settings.sepiaWarmth || 50}
                        onChange={e => updateSettings({ sepiaWarmth: parseInt(e.target.value, 10) })}
                      />
                      <span className="slider-value mono">{settings.sepiaWarmth || 50}%</span>
                    </div>
                  </SettingRow>
                )}

                <SettingRow label="Page Glow" description="Soft aesthetic shadow around the document.">
                  <Toggle checked={settings.pageGlow !== false} onChange={v => updateSettings({ pageGlow: v })} />
                </SettingRow>

                <SettingRow label="Auto-Hide Controls" description={`${settings.autoHideDelay || 3}s delay`}>
                  <div className="slider-container">
                    <input
                      type="range"
                      className="slider-track"
                      min={1}
                      max={10}
                      value={settings.autoHideDelay || 3}
                      onChange={e => updateSettings({ autoHideDelay: parseInt(e.target.value, 10) })}
                    />
                    <span className="slider-value mono">{settings.autoHideDelay || 3}s</span>
                  </div>
                </SettingRow>

                <SettingRow label="Show Reading Time" description="Display estimated time remaining.">
                  <Toggle checked={settings.showReadingTime !== false} onChange={v => updateSettings({ showReadingTime: v })} />
                </SettingRow>

                <SettingRow label="Auto-Open Last Book" description="Open the last read book on startup.">
                  <Toggle checked={settings.autoOpenLastBook === true} onChange={v => updateSettings({ autoOpenLastBook: v })} />
                </SettingRow>

                <SettingRow label="Infinite Scroll" description="Scroll continuously through all pages instead of one page at a time.">
                  <Toggle checked={settings.infiniteScroll === true} onChange={v => updateSettings({ infiniteScroll: v })} />
                </SettingRow>

                <SettingRow label="Zen Mode" description="Automatically hide all UI during focused reading.">
                  <div className="theme-toggle-group">
                    {[
                      { id: 'off', label: 'Off' },
                      { id: 'on_scroll', label: 'On Scroll' },
                      { id: 'always', label: 'Always' }
                    ].map(m => (
                      <button 
                        key={m.id} 
                        className={`theme-btn ${settings.readerZenMode === m.id ? 'active' : ''}`} 
                        onClick={() => updateSettings({ readerZenMode: m.id })}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </SettingRow>

                <SettingRow label="Transition Speed" description="Adjust the speed of page turns and UI animations.">
                  <div className="theme-toggle-group">
                    {['fast', 'normal', 'slow'].map(s => (
                      <button 
                        key={s} 
                        className={`theme-btn ${settings.transitionSpeed === s ? 'active' : ''}`} 
                        onClick={() => updateSettings({ transitionSpeed: s })}
                      >
                        {s.charAt(0).toUpperCase() + s.slice(1)}
                      </button>
                    ))}
                  </div>
                </SettingRow>
              </div>
            )}

            {/* ─── Library ─── */}
            {activeTab === 'library' && (
              <div className="settings-section animate-fade-in">
                <div className="section-heading">
                  <div className="section-icon" style={{ background: '#f59e0b' }}>
                    <Eye size={20} color="white" />
                  </div>
                  <div>
                    <h2>Library</h2>
                    <p>Configure your library display and folders.</p>
                  </div>
                </div>
                <hr className="divider" />

                <div className="folder-management-section">
                  <div className="section-subtitle">Mapped Folders</div>
                  <div className="folder-list">
                    {customFolders.length === 0 ? (
                      <div className="folder-empty-state">No folders currently mapped.</div>
                    ) : (
                      customFolders.map(cat => (
                        <div key={cat.id} className="folder-item">
                          <div className="folder-info">
                            <span className="folder-item-name">{cat.name}</span>
                            <span className="folder-item-path">{cat.path}</span>
                          </div>
                          <button className="icon-btn-danger" onClick={() => handleRemoveFolder(cat)}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                  <button className="btn-surface" onClick={addCategory} style={{ marginTop: 'var(--space-4)', width: '100%', justifyContent: 'center' }}>
                    <Plus size={16} />
                    Map New Folder
                  </button>
                </div>

                <hr className="divider" style={{ margin: 'var(--space-6) 0' }} />

                <SettingRow label="Show Book Covers" description="Render first page of PDF as cover (can affect performance).">
                  <Toggle checked={settings.showBookCovers !== false} onChange={v => updateSettings({ showBookCovers: v })} />
                </SettingRow>

                <SettingRow label="Show Reading Progress" description="Display progress bars and rings for your books.">
                  <Toggle checked={settings.showBookProgress !== false} onChange={v => updateSettings({ showBookProgress: v })} />
                </SettingRow>

                <SettingRow label="Show 'Continue Reading' Hero" description="Display the large hero section for your most recent book.">
                  <Toggle checked={settings.showHeroSection !== false} onChange={v => updateSettings({ showHeroSection: v })} />
                </SettingRow>

                <SettingRow label="Show 'Recently Opened' Section" description="Display the horizontal scroll of recently accessed books.">
                  <Toggle checked={settings.showRecentSection !== false} onChange={v => updateSettings({ showRecentSection: v })} />
                </SettingRow>

                <SettingRow label="Show Reading Stats" description="Display reading statistics in the library dashboard.">
                  <Toggle checked={settings.showLibraryStats !== false} onChange={v => updateSettings({ showLibraryStats: v })} />
                </SettingRow>

                <SettingRow label="Show File Extensions" description="Display .pdf extension in book titles.">
                  <Toggle checked={settings.showFileExtensions !== false} onChange={v => updateSettings({ showFileExtensions: v })} />
                </SettingRow>

                <SettingRow label="Confirm Folder Removal" description="Ask before removing a mapped folder.">
                  <Toggle checked={settings.confirmRemoveFolder !== false} onChange={v => updateSettings({ confirmRemoveFolder: v })} />
                </SettingRow>

                <SettingRow label="3D Motion Effects" description="Enable immersive 3D tilt effects on book covers.">
                  <Toggle checked={settings.enable3DEffects !== false} onChange={v => updateSettings({ enable3DEffects: v })} />
                </SettingRow>

                <SettingRow label="Grid Card Size" description={`${Math.round((settings.libraryGridSize ?? 1.0) * 100)}%`}>
                  <div className="slider-container">
                    <input
                      type="range"
                      className="slider-track"
                      min={70}
                      max={150}
                      value={Math.round((settings.libraryGridSize ?? 1.0) * 100)}
                      onChange={e => updateSettings({ libraryGridSize: parseInt(e.target.value, 10) / 100 })}
                    />
                    <span className="slider-value mono">{Math.round((settings.libraryGridSize ?? 1.0) * 100)}%</span>
                  </div>
                </SettingRow>
              </div>
            )}

            {/* ─── Shortcuts ─── */}
            {activeTab === 'shortcuts' && (
              <div className="settings-section animate-fade-in">
                <div className="section-heading">
                  <div className="section-icon" style={{ background: '#8b5cf6' }}>
                    <Keyboard size={20} color="white" />
                  </div>
                  <div>
                    <h2>Keyboard Shortcuts</h2>
                    <p>Click a keybind to change it.</p>
                  </div>
                </div>
                <hr className="divider" />

                {Object.entries(shortcuts).map(([action, keyName]) => (
                  <SettingRow key={action} label={shortcutLabels[action] || action}>
                    <button
                      className={`shortcut-key-btn ${listeningKey === action ? 'listening' : ''}`}
                      onClick={(e) => { e.target.focus(); setListeningKey(action); }}
                      onKeyDown={(e) => handleKeyDown(e, action)}
                      onBlur={() => setListeningKey(null)}
                    >
                      {listeningKey === action ? (
                        <span className="shortcut-listening">Press a key...</span>
                      ) : (
                        <kbd className="kbd" style={{ fontSize: 'var(--font-sm)', padding: '0.25rem 0.6rem' }}>{keyName}</kbd>
                      )}
                    </button>
                  </SettingRow>
                ))}

                <div style={{ marginTop: 'var(--space-6)' }}>
                  <button className="btn-ghost" onClick={resetShortcuts}>
                    <RotateCcw size={14} />
                    Reset to Defaults
                  </button>
                </div>
              </div>
            )}

            {/* ─── Advanced ─── */}
            {activeTab === 'advanced' && (
              <div className="settings-section animate-fade-in">
                <div className="section-heading">
                  <div className="section-icon" style={{ background: 'var(--ink-text-secondary)' }}>
                    <Monitor size={20} color="white" />
                  </div>
                  <div>
                    <h2>Advanced</h2>
                    <p>Power user settings and maintenance.</p>
                  </div>
                </div>
                <hr className="divider" />

                <SettingRow label="Startup Page" description="Which page to show when InkWell opens.">
                  <div className="theme-toggle-group">
                    {[
                      { id: 'library', label: 'Library' },
                      { id: 'recent', label: 'Recent' },
                      { id: 'resume', label: 'Resume Last' }
                    ].map(p => (
                      <button 
                        key={p.id} 
                        className={`theme-btn ${settings.startupPage === p.id ? 'active' : ''}`} 
                        onClick={() => updateSettings({ startupPage: p.id })}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </SettingRow>

                <hr className="divider" />
                <div className="section-subtitle">Maintenance</div>

                <div className="danger-zone">
                  <div className="danger-zone-item">
                    <div className="danger-zone-info">
                      <h4 className="danger-zone-label">Clear Thumbnail Cache</h4>
                      <p className="danger-zone-desc">Deletes all generated book covers. They will be recreated on next visit.</p>
                    </div>
                    <button 
                      className="btn-surface" 
                      onClick={async () => {
                        if (window.confirm('Are you sure? This will delete all generated thumbnails.')) {
                          await clearThumbnailCache();
                          addToast('Thumbnail cache cleared', 'success');
                        }
                      }}
                      style={{ color: 'var(--ink-danger)' }}
                    >
                      Clear Cache
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ─── About ─── */}
            {activeTab === 'about' && (
              <div className="settings-section animate-fade-in">
                <div className="section-heading">
                  <div className="section-icon" style={{ background: 'var(--ink-primary)' }}>
                    <Info size={20} color="white" />
                  </div>
                  <div>
                    <h2>About InkWell</h2>
                    <p>Version 0.2.0</p>
                  </div>
                </div>
                <hr className="divider" />

                <div className="about-description">
                  <p>
                    InkWell is a state-of-the-art, offline-first PDF reader designed specifically for thinkers, writers, and deep readers.
                  </p>
                  <p style={{ marginTop: 'var(--space-3)', color: 'var(--ink-text-tertiary)', fontSize: 'var(--font-xs)' }}>
                    Built with technical precision using Tauri, React, and PDF.js. Optimized for performance and private, focused reading.
                  </p>
                </div>

                <hr className="divider" />

                <div className="about-actions">
                  <button className="btn-surface" onClick={exportSettings}>
                    <Download size={14} />
                    Export Settings
                  </button>
                  <button className="btn-surface" onClick={importSettings}>
                    <Upload size={14} />
                    Import Settings
                  </button>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};

export default SettingsView;
