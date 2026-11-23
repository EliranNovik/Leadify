import React, { useEffect, useRef, useState } from 'react';
import { ChevronDownIcon, QuestionMarkCircleIcon } from '@heroicons/react/24/outline';
import PublicContactMenuPanel from './PublicContactMenuPanel';

type Props = {
  needHelpLabel?: string;
  contactUsLabel?: string;
  whatsappLabel?: string;
  emailLabel?: string;
  callLabel?: string;
  containerClassName?: string;
  darkSurface?: boolean;
  /** In-flow control with the label, used in the mobile footer. */
  labeled?: boolean;
  /** Blue gradient trigger, used by the floating portal button. */
  gradient?: boolean;
};

/** Compact “Need help?” contact menu — fixed bottom-right. */
const PublicPageContactButtons: React.FC<Props> = ({
  needHelpLabel = 'Need help?',
  contactUsLabel,
  whatsappLabel,
  emailLabel,
  callLabel,
  containerClassName = 'fixed bottom-10 end-2 z-40 print-hide flex flex-col items-end gap-2 md:end-6',
  darkSurface = false,
  labeled = false,
  gradient = false,
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

  const mobileBadge = labeled
    ? ''
    : 'max-md:h-10 max-md:w-10 max-md:border-0 max-md:bg-gray-200 max-md:text-gray-700 max-md:shadow-sm max-md:[background-image:none]';
  const triggerClass = gradient
    ? 'flex items-center justify-center gap-2 rounded-full bg-gradient-to-br from-[#1e40af] via-[#1e3a8a] to-[#0b1f4d] text-[13px] font-medium text-white shadow-[0_10px_24px_rgba(30,58,138,0.35)] transition-shadow hover:shadow-[0_14px_28px_rgba(30,58,138,0.45)] max-md:h-11 max-md:w-11 md:px-3.5 md:py-2'
    : labeled
    ? 'inline-flex items-center gap-2 rounded-full bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700'
    : darkSurface
      ? `flex items-center justify-center gap-2 rounded-full border border-white/15 bg-white/[0.06] text-[13px] font-normal text-white/65 transition-colors hover:bg-white/10 hover:text-white/90 md:px-3.5 md:py-2 ${mobileBadge}`
      : `flex items-center justify-center gap-2 rounded-full border border-gray-200/80 bg-white/95 text-[13px] font-normal text-gray-600 shadow-sm transition-shadow hover:shadow md:px-3.5 md:py-2 ${mobileBadge}`;

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
        aria-label={needHelpLabel}
      >
        <QuestionMarkCircleIcon className={labeled ? 'h-6 w-6' : 'h-6 w-6 md:hidden'} aria-hidden />
        <span className={labeled ? '' : 'hidden md:inline'}>{needHelpLabel}</span>
        <ChevronDownIcon
          className={`${labeled ? 'h-4 w-4' : 'hidden h-4 w-4 md:block'} transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
    </div>
  );
};

export default PublicPageContactButtons;
