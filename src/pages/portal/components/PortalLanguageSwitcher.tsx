import React, { useEffect, useRef, useState } from 'react';
import { ChevronDownIcon } from '@heroicons/react/24/outline';
import {
  PORTAL_LOGIN_LOCALE_LABELS,
  PORTAL_LOGIN_LOCALES,
  type PortalLoginLocale,
} from '../i18n/portalLoginMessages';
import { usePortalLoginI18n } from '../i18n/PortalLoginI18nContext';

type Props = {
  variant?: 'hero' | 'default';
};

const PortalLanguageSwitcher: React.FC<Props> = ({ variant = 'hero' }) => {
  const { locale, setLocale, t } = usePortalLoginI18n();
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
      ? 'flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-2 text-sm font-medium text-white ring-1 ring-white/25 backdrop-blur-sm transition-colors hover:bg-white/25 drop-shadow-[0_2px_8px_rgba(0,0,0,0.35)]'
      : 'flex items-center gap-1.5 rounded-full border border-gray-200/80 bg-white/95 px-3 py-2 text-[13px] font-normal text-gray-600 shadow-sm transition-shadow hover:shadow';

  return (
    <div ref={rootRef} className="relative">
      {open && (
        <div className="absolute top-full z-50 mt-2 min-w-[160px] end-0 rounded-2xl border border-gray-200 bg-white p-2 shadow-lg">
          {PORTAL_LOGIN_LOCALES.map((code) => (
            <button
              key={code}
              type="button"
              className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm transition-colors hover:bg-gray-50 ${
                locale === code ? 'bg-primary/10 font-semibold text-primary' : 'text-gray-700'
              }`}
              onClick={() => {
                setLocale(code as PortalLoginLocale);
                setOpen(false);
              }}
            >
              <span className="sm:hidden">{code.toUpperCase()}</span>
              <span className="hidden sm:inline">{PORTAL_LOGIN_LOCALE_LABELS[code]}</span>
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={triggerClass}
        aria-expanded={open}
        aria-label={t.language}
      >
        <span className="sm:hidden">{locale.toUpperCase()}</span>
        <span className="hidden sm:inline">{PORTAL_LOGIN_LOCALE_LABELS[locale]}</span>
        <ChevronDownIcon className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
    </div>
  );
};

export default PortalLanguageSwitcher;
