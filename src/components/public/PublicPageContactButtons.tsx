import React, { useEffect, useRef, useState } from 'react';
import { ChevronDownIcon } from '@heroicons/react/24/outline';
import PublicContactMenuPanel from './PublicContactMenuPanel';

type Props = {
  needHelpLabel?: string;
  contactUsLabel?: string;
  whatsappLabel?: string;
  emailLabel?: string;
  callLabel?: string;
  containerClassName?: string;
  darkSurface?: boolean;
};

/** Compact “Need help?” contact menu — fixed bottom-right. */
const PublicPageContactButtons: React.FC<Props> = ({
  needHelpLabel = 'Need help?',
  contactUsLabel,
  whatsappLabel,
  emailLabel,
  callLabel,
  containerClassName = 'fixed bottom-10 end-6 z-40 print-hide flex flex-col items-end gap-2',
  darkSurface = false,
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

  const triggerClass = darkSurface
    ? 'flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3.5 py-2 text-[13px] font-normal text-white/65 transition-colors hover:bg-white/10 hover:text-white/90'
    : 'flex items-center gap-2 rounded-full border border-gray-200/80 bg-white/95 px-3.5 py-2 text-[13px] font-normal text-gray-600 shadow-sm transition-shadow hover:shadow';

  return (
    <div ref={rootRef} className={containerClassName}>
      {open && (
        <div className="mb-2">
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
        {needHelpLabel}
        <ChevronDownIcon
          className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
    </div>
  );
};

export default PublicPageContactButtons;
