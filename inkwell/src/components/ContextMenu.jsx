import React, { useEffect } from 'react';

const ContextMenu = ({ x, y, items, onClose }) => {
  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  // Adjust position to stay within viewport
  const adjustedX = Math.min(x, window.innerWidth - 200);
  const adjustedY = Math.min(y, window.innerHeight - (items.length * 36 + 20));

  return (
    <>
      <div className="context-menu-backdrop" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div className="context-menu" style={{ left: adjustedX, top: adjustedY }}>
        {items.map((item, i) => {
          if (item.divider) {
            return <div key={`d-${i}`} className="context-menu-divider" />;
          }
          return (
            <button
              key={item.label}
              className={`context-menu-item ${item.danger ? 'danger' : ''}`}
              onClick={() => { item.action(); onClose(); }}
            >
              {item.icon && <span style={{ display: 'flex', flexShrink: 0 }}>{item.icon}</span>}
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </>
  );
};

export default ContextMenu;
