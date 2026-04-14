import React from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import './TitleBar.css';

const TitleBar = () => {
  const appWindow = getCurrentWindow();

  const handleMinimize = (e) => {
    e.stopPropagation();
    appWindow.minimize();
  };
  
  const handleMaximize = (e) => {
    e.stopPropagation();
    appWindow.toggleMaximize();
  };
  
  const handleClose = (e) => {
    e.stopPropagation();
    appWindow.close();
  };

  return (
    <div className="titlebar" data-tauri-drag-region>
      <div className="titlebar-controls">
        <button className="control-dot close" onClick={handleClose}>
          <svg viewBox="0 0 10 10"><path d="M 2,2 L 8,8 M 8,2 L 2,8" /></svg>
        </button>
        <button className="control-dot minimize" onClick={handleMinimize}>
          <svg viewBox="0 0 10 10"><path d="M 2,5 L 8,5" /></svg>
        </button>
        <button className="control-dot maximize" onClick={handleMaximize}>
          <svg viewBox="0 0 10 10"><path d="M 2.5,2.5 L 7.5,2.5 L 7.5,7.5 L 2.5,7.5 Z" /></svg>
        </button>
      </div>
      <div className="titlebar-title" data-tauri-drag-region>Inkwell Reader</div>
    </div>
  );
};

export default TitleBar;
