import React, { useState, useRef, useEffect, cloneElement } from 'react';

const Tooltip = ({ children, content, delay = 400, position = 'top' }) => {
  const [visible, setVisible] = useState(false);
  const timeoutRef = useRef(null);

  const show = () => {
    timeoutRef.current = setTimeout(() => setVisible(true), delay);
  };

  const hide = () => {
    clearTimeout(timeoutRef.current);
    setVisible(false);
  };

  useEffect(() => {
    return () => clearTimeout(timeoutRef.current);
  }, []);

  return (
    <div className="tooltip-wrapper" onMouseEnter={show} onMouseLeave={hide}>
      {children}
      {visible && content && (
        <div className={`tooltip ${position}`}>
          {content}
        </div>
      )}
    </div>
  );
};

export default Tooltip;
