import React from 'react';

/**
 * ProgressRing — SVG circular progress indicator.
 * Animated on mount with CSS transitions.
 *
 * @param {number} progress - 0 to 100
 * @param {number} size     - Diameter in px (default 64)
 * @param {number} stroke   - Stroke width in px (default 4)
 * @param {string} className - Additional class name
 */
const ProgressRing = ({ progress = 0, size = 64, stroke = 4, className = '' }) => {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (progress / 100) * circumference;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={`progress-ring ${className}`}
      style={{ transform: 'rotate(-90deg)' }}
    >
      {/* Background track */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--ink-border)"
        strokeWidth={stroke}
      />
      {/* Progress arc */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--ink-primary)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        style={{
          '--ring-circumference': circumference,
          '--ring-offset': offset,
          transition: 'stroke-dashoffset 0.8s cubic-bezier(0.16, 1, 0.3, 1)',
          animation: 'progressRingDraw 1s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        }}
      />
    </svg>
  );
};

export default ProgressRing;
