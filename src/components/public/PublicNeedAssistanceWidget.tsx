import React, { useEffect, useRef, useState } from 'react';
import { LifebuoyIcon } from '@heroicons/react/24/outline';
import { PhoneIcon as PhoneIconSolid } from '@heroicons/react/24/solid';
import { FaWhatsapp, FaEnvelope } from 'react-icons/fa';
import { OFFICE_EMAIL, OFFICE_PHONE_TEL, WHATSAPP_URL } from './publicContactInfo';

const contactIconBtnClass =
  'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white shadow-md transition hover:scale-105 active:scale-95';

const ContactActionLinks: React.FC<{ layout?: 'row' | 'column' }> = ({ layout = 'column' }) => (
  <div
    className={
      layout === 'column'
        ? 'flex flex-col items-stretch gap-2'
        : 'flex items-center justify-center gap-2'
    }
    role="group"
    aria-label="Contact options"
  >
    <a
      href={WHATSAPP_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={`${contactIconBtnClass} bg-green-500 hover:bg-green-600`}
      title="Chat on WhatsApp"
      aria-label="WhatsApp"
    >
      <FaWhatsapp className="h-5 w-5" />
    </a>
    <a
      href={`mailto:${OFFICE_EMAIL}`}
      className={`${contactIconBtnClass} bg-blue-600 hover:bg-blue-700`}
      title="Send Email"
      aria-label="Email"
    >
      <FaEnvelope className="h-5 w-5" />
    </a>
    <a
      href={OFFICE_PHONE_TEL}
      className={`${contactIconBtnClass} bg-purple-600 hover:bg-purple-700`}
      title="Call Office"
      aria-label="Phone"
    >
      <PhoneIconSolid className="h-5 w-5" />
    </a>
  </div>
);

type Props = {
  closerSlot?: React.ReactNode;
  className?: string;
};

const PublicNeedAssistanceWidget: React.FC<Props> = ({ closerSlot, className = '' }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={`print-hide fixed bottom-6 right-4 z-50 flex items-end gap-2 md:right-6 ${className}`}
      style={{ paddingBottom: 'max(0px, env(safe-area-inset-bottom))' }}
    >
      {closerSlot}
      <div className="relative flex flex-col items-end">
        {open && (
          <div className="mb-3 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-lg shadow-slate-900/10 ring-1 ring-slate-100">
            <ContactActionLinks layout="column" />
          </div>
        )}
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-label={open ? 'Close assistance options' : 'Need assistance'}
          className={`inline-flex items-center gap-2.5 rounded-2xl border px-4 py-3 text-sm font-semibold shadow-md transition hover:shadow-lg active:scale-[0.98] ${
            open
              ? 'border-slate-300 bg-slate-700 text-white'
              : 'border-slate-200/80 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50'
          }`}
        >
          <LifebuoyIcon className={`h-5 w-5 shrink-0 ${open ? 'text-white' : 'text-slate-600'}`} />
          <span className="whitespace-nowrap hidden sm:inline">{open ? 'Close' : 'Need assistance?'}</span>
        </button>
      </div>
    </div>
  );
};

export default PublicNeedAssistanceWidget;
