import React, { useEffect, useRef, useState } from 'react';
import { LanguageIcon, ChevronDownIcon } from '@heroicons/react/24/outline';
import {
  PORTAL_LOGIN_LOCALES,
  type PortalLoginLocale,
} from '../i18n/portalLoginLocales';
import { usePortalLoginI18n } from '../i18n/PortalLoginI18nContext';

const PortalLanguageSelector: React.FC = () => {
  const { locale, setLocale } = usePortalLoginI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const current = PORTAL_LOGIN_LOCALES.find((l) => l.code === locale) ?? PORTAL_LOGIN_LOCALES[0];

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
    <div ref={rootRef} className="relative">
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 min-w-[148px] rounded-2xl border border-gray-200 bg-white p-1.5 shadow-lg">
          {PORTAL_LOGIN_LOCALES.map((item) => (
            <button
              key={item.code}
              type="button"
              className={`flex w-full items-center rounded-xl px-3 py-2 text-left text-sm transition-colors ${
                item.code === locale
                  ? 'bg-primary/10 font-semibold text-primary'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
              onClick={() => {
                setLocale(item.code as PortalLoginLocale);
                setOpen(false);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-2 text-sm font-medium text-white ring-1 ring-white/25 backdrop-blur-sm transition-colors hover:bg-white/25 drop-shadow-[0_2px_8px_rgba(0,0,0,0.35)]"
        aria-expanded={open}
        aria-label="Language"
      >
        <LanguageIcon className="h-4 w-4 shrink-0" />
        <span className="hidden sm:inline">{current.label}</span>
        <ChevronDownIcon className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
    </div>
  );
};

export default PortalLanguageSelector;
