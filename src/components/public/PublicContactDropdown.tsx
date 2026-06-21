import React, { useEffect, useRef, useState } from 'react';
import { ChevronDownIcon } from '@heroicons/react/24/outline';
import PublicContactMenuPanel from './PublicContactMenuPanel';

type Props = {
  label?: string;
  variant?: 'default' | 'hero';
  align?: 'left' | 'right';
  placement?: 'up' | 'down';
  className?: string;
  contactUsLabel?: string;
  whatsappLabel?: string;
  emailLabel?: string;
  callLabel?: string;
};

const PublicContactDropdown: React.FC<Props> = ({
  label = 'Contact',
  variant = 'default',
  align = 'right',
  placement = 'up',
  className = '',
  contactUsLabel,
  whatsappLabel,
  emailLabel,
  callLabel,
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const triggerClass =
    variant === 'hero'
      ? 'flex items-center gap-1.5 rounded-full bg-white/15 px-3.5 py-2 text-sm font-medium text-white ring-1 ring-white/25 backdrop-blur-sm transition-colors hover:bg-white/25 drop-shadow-[0_2px_8px_rgba(0,0,0,0.35)]'
      : 'flex items-center gap-2 bg-white/95 border border-gray-200/80 rounded-full px-3.5 py-2 shadow-sm hover:shadow text-[13px] font-normal text-gray-600 transition-shadow';

  const panelPositionClass =
    placement === 'down'
      ? `top-full mt-2 ${align === 'right' ? 'right-0' : 'left-0'}`
      : `bottom-full mb-2 ${align === 'right' ? 'right-0' : 'left-0'}`;

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      {open && (
        <div className={`absolute z-50 ${panelPositionClass}`}>
          <PublicContactMenuPanel
            onItemClick={() => setOpen(false)}
            contactUsLabel={contactUsLabel}
            whatsappLabel={whatsappLabel}
            emailLabel={emailLabel}
            callLabel={callLabel}
          />
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={triggerClass}
        aria-expanded={open}
      >
        {label}
        <ChevronDownIcon className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
    </div>
  );
};

export default PublicContactDropdown;
