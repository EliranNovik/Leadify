import React from 'react';
import { MoonIcon, SunIcon } from '@heroicons/react/24/outline';

interface WhatsAppThemeToggleProps {
  isDark: boolean;
  onToggle: () => void;
  className?: string;
}

/**
 * Dark / light switch for the WhatsApp surfaces — the same control as the AI drawer's, so the two
 * read as one product. Its styling lives in WhatsAppThemeStyles, which the surface already renders.
 */
const WhatsAppThemeToggle: React.FC<WhatsAppThemeToggleProps> = ({ isDark, onToggle, className }) => {
  const label = isDark ? 'Switch to light theme' : 'Switch to dark theme';
  return (
    <button
      type="button"
      className={`wa-theme-switch${className ? ` ${className}` : ''}`}
      onClick={onToggle}
      title={label}
      aria-label={label}
      aria-pressed={isDark}
    >
      <span className={`wa-theme-knob ${isDark ? 'is-dark' : ''}`}>
        {isDark ? <MoonIcon className="text-white" /> : <SunIcon className="text-amber-500" />}
      </span>
    </button>
  );
};

export default WhatsAppThemeToggle;
