import React, { useEffect, useRef, useState } from 'react';
import { ChevronDownIcon } from '@heroicons/react/24/outline';
import { useTranslation } from 'react-i18next';
import {
  isPortalAppLocale,
  type PortalAppLocale,
  writeStoredPortalLocale,
} from '../i18n/portalLocaleStorage';

const OPTIONS: { code: PortalAppLocale; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'he', label: 'עברית' },
];

type Props = {
  /** Compact control for the authenticated header next to the user menu. */
  compact?: boolean;
};

const PortalAppLanguageSwitcher: React.FC<Props> = ({ compact = true }) => {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const locale: PortalAppLocale = isPortalAppLocale(i18n.language) ? i18n.language : 'en';
  const currentLabel = OPTIONS.find((o) => o.code === locale)?.label ?? 'English';

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

  const setLocale = (next: PortalAppLocale) => {
    writeStoredPortalLocale(next);
    void i18n.changeLanguage(next);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      {open ? (
        <div className="absolute end-0 top-full z-50 mt-2 min-w-[140px] rounded-2xl border border-gray-200 bg-white p-1.5 shadow-lg">
          {OPTIONS.map((option) => (
            <button
              key={option.code}
              type="button"
              className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm transition-colors hover:bg-gray-50 ${
                locale === option.code ? 'bg-primary/10 font-semibold text-primary' : 'text-gray-700'
              }`}
              onClick={() => setLocale(option.code)}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={
          compact
            ? 'inline-flex items-center gap-1 rounded-full border border-gray-200/80 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 shadow-sm transition-colors hover:bg-gray-50 sm:px-3 sm:text-[13px]'
            : 'inline-flex items-center gap-1.5 rounded-full border border-gray-200/80 bg-white/95 px-3 py-2 text-[13px] font-normal text-gray-600 shadow-sm transition-shadow hover:shadow'
        }
        aria-expanded={open}
        aria-label={t('common.language')}
      >
        <span className="sm:hidden">{locale.toUpperCase()}</span>
        <span className="hidden sm:inline">{currentLabel}</span>
        <ChevronDownIcon className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
    </div>
  );
};

export default PortalAppLanguageSwitcher;
