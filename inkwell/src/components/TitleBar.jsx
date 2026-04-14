import React from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, X } from 'lucide-react';
import { isTauri } from '../utils/tauri';
import './TitleBar.css';

const TitleBar = () => {
  const handleMinimize = async (e) => {
    e.stopPropagation();
    console.log('[TitleBar] Minimize clicked');
    if (isTauri()) {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      getCurrentWindow().minimize();
    } else {
      console.warn('[TitleBar] Not in Tauri: Minimize suppressed');
    }
  };
  
  const handleMaximize = async (e) => {
    e.stopPropagation();
    console.log('[TitleBar] Maximize clicked');
    if (isTauri()) {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      getCurrentWindow().toggleMaximize();
    } else {
      console.warn('[TitleBar] Not in Tauri: Maximize suppressed');
    }
  };
  
  const handleClose = async (e) => {
    e.stopPropagation();
    console.log('[TitleBar] Close clicked');
    if (isTauri()) {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      getCurrentWindow().close();
    } else {
      console.warn('[TitleBar] Not in Tauri: Close suppressed');
    }
  };

  return (
    <div className="titlebar">
      {/* Dedicate Background for Dragging */}
      <div className="titlebar-drag-region" data-tauri-drag-region />
      
      <div className="titlebar-title" data-tauri-drag-region>Inkwell Reader</div>

      <div className="titlebar-controls">
        <button className="control-btn minimize" onClick={handleMinimize} title="Minimize">
          <Minus size={14} />
        </button>
        <button className="control-btn maximize" onClick={handleMaximize} title="Maximize/Restore">
          <Square size={12} />
        </button>
        <button className="control-btn close" onClick={handleClose} title="Close">
          <X size={14} />
        </button>
      </div>
    </div>
  );
};

export default TitleBar;
