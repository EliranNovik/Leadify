import React from 'react';

/** Double-check mark (WhatsApp read-receipt style) for filters and status UI. */
const WhatsAppDoubleCheckIcon: React.FC<{ className?: string }> = ({ className = 'w-6 h-6' }) => (
  <svg
    className={className}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2}
    aria-hidden
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l4 4L11 8" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l4 4L17 8" />
  </svg>
);

export default WhatsAppDoubleCheckIcon;
