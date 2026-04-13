import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Search, Settings, Moon, Sun, Maximize, ArrowLeft, BookOpen, 
  ZoomIn, ZoomOut, Bookmark, Hash, Palette, ToggleLeft, 
  Clock, List
} from 'lucide-react';
import './CommandPalette.css';

const CommandPalette = ({ isOpen, onClose, commands }) => {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const filteredCommands = useMemo(() => {
    if (!query.trim()) return commands;
    const q = query.toLowerCase();
    return commands.filter(cmd => 
      cmd.label.toLowerCase().includes(q) || 
      (cmd.category && cmd.category.toLowerCase().includes(q))
    );
  }, [query, commands]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const executeCommand = (cmd) => {
    onClose();
    setTimeout(() => cmd.action(), 50);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      onClose();
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => Math.min(i + 1, filteredCommands.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredCommands[activeIndex]) {
        executeCommand(filteredCommands[activeIndex]);
      }
    }
  };

  // Scroll active item into view
  useEffect(() => {
    if (listRef.current) {
      const activeEl = listRef.current.children[activeIndex];
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [activeIndex]);

  if (!isOpen) return null;

  // Group commands by category
  let lastCategory = null;

  return (
    <div className="cmd-backdrop" onClick={onClose}>
      <div className="cmd-modal" onClick={e => e.stopPropagation()}>
        <div className="cmd-search-wrapper">
          <Search size={18} className="cmd-search-icon" />
          <input
            ref={inputRef}
            className="cmd-search-input"
            type="text"
            placeholder="Type a command..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <kbd className="kbd">Esc</kbd>
        </div>

        <div className="cmd-list" ref={listRef}>
          {filteredCommands.length === 0 && (
            <div className="cmd-empty">No matching commands</div>
          )}
          {filteredCommands.map((cmd, index) => {
            const showCategory = cmd.category && cmd.category !== lastCategory;
            lastCategory = cmd.category;

            return (
              <React.Fragment key={cmd.id || cmd.label}>
                {showCategory && (
                  <div className="cmd-category">{cmd.category}</div>
                )}
                <button
                  className={`cmd-item ${index === activeIndex ? 'active' : ''}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => executeCommand(cmd)}
                >
                  <span className="cmd-item-icon">
                    {cmd.icon || <Hash size={16} />}
                  </span>
                  <span className="cmd-item-label">{cmd.label}</span>
                  {cmd.shortcut && (
                    <span className="cmd-item-shortcut">
                      {cmd.shortcut.split('+').map((k, i) => (
                        <kbd key={i} className="kbd">{k}</kbd>
                      ))}
                    </span>
                  )}
                </button>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default CommandPalette;
