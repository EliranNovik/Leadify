import React, { useState, useRef, useEffect } from 'react';
import { PhoneIcon, ChevronDownIcon } from '@heroicons/react/24/outline';
import { FaWhatsapp, FaEnvelope } from 'react-icons/fa';

const WHATSAPP_URL = 'https://wa.me/972552780162';
const OFFICE_EMAIL = 'office@lawoffice.org.il';
const OFFICE_PHONE = '+972737895444';

/** Compact “Need help?” contact menu — less visual competition with checkout. */
const PublicPageContactButtons: React.FC = () => {
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

  return (
    <div
      ref={rootRef}
      className="fixed bottom-10 right-6 z-40 print-hide flex flex-col items-end gap-2"
    >
      {open && (
        <div className="bg-white border border-gray-200 rounded-2xl shadow-lg p-3 min-w-[200px] animate-in fade-in">
          <p className="text-xs text-gray-500 px-2 pb-2 border-b border-gray-100 mb-2">
            Contact us
          </p>
          <div className="flex flex-col gap-1">
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-gray-700 hover:bg-gray-50"
              onClick={() => setOpen(false)}
            >
              <FaWhatsapp className="w-4 h-4 text-green-600" />
              WhatsApp
            </a>
            <a
              href={`mailto:${OFFICE_EMAIL}`}
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-gray-700 hover:bg-gray-50"
              onClick={() => setOpen(false)}
            >
              <FaEnvelope className="w-4 h-4 text-blue-600" />
              Email
            </a>
            <a
              href={`tel:${OFFICE_PHONE}`}
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-gray-700 hover:bg-gray-50"
              onClick={() => setOpen(false)}
            >
              <PhoneIcon className="w-4 h-4 text-violet-600" />
              Call
            </a>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 bg-white/95 border border-gray-200/80 rounded-full px-3.5 py-2 shadow-sm hover:shadow text-[13px] font-normal text-gray-600 transition-shadow"
        aria-expanded={open}
      >
        Need help?
        <ChevronDownIcon
          className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
    </div>
  );
};

export default PublicPageContactButtons;
