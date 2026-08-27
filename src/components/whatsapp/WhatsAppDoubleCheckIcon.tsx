import React from 'react';

/** Double-check mark (WhatsApp read-receipt style) for filters and status UI. */
const WhatsAppDoubleCheckIcon: React.FC<{ className?: string; strokeWidth?: number }> = ({
  className = 'w-6 h-6',
  strokeWidth = 2,
}) => (
  <svg
    className={className}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    aria-hidden
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l4 4L11 8" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l4 4L17 8" />
  </svg>
);

export default WhatsAppDoubleCheckIcon;
