import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  interpolate,
  isPortalLoginLocale,
  portalLoginMessages,
  type PortalLoginLocale,
  type PortalLoginMessages,
} from './portalLoginMessages';

const STORAGE_KEY = 'portal_login_locale';

function readStoredLocale(): PortalLoginLocale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && isPortalLoginLocale(stored)) return stored;
  } catch {
    // ignore
  }
  return 'en';
}

type PortalLoginI18nContextValue = {
  locale: PortalLoginLocale;
  setLocale: (locale: PortalLoginLocale) => void;
  t: PortalLoginMessages;
  format: (key: keyof PortalLoginMessages, vars?: Record<string, string>) => string;
  dir: 'ltr' | 'rtl';
};

const PortalLoginI18nContext = createContext<PortalLoginI18nContextValue | null>(null);

export function PortalLoginI18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<PortalLoginLocale>(() => readStoredLocale());

  const setLocale = useCallback((next: PortalLoginLocale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  const t = portalLoginMessages[locale];
  const dir = locale === 'he' ? 'rtl' : 'ltr';

  const format = useCallback(
    (key: keyof PortalLoginMessages, vars?: Record<string, string>) => {
      const template = portalLoginMessages[locale][key];
      return vars ? interpolate(template, vars) : template;
    },
    [locale],
  );

  useEffect(() => {
    const html = document.documentElement;
    const prevDir = html.getAttribute('dir');
    const prevLang = html.getAttribute('lang');

    html.setAttribute('dir', dir);
    html.setAttribute('lang', locale);

    return () => {
      if (prevDir) html.setAttribute('dir', prevDir);
      else html.removeAttribute('dir');
      if (prevLang) html.setAttribute('lang', prevLang);
      else html.removeAttribute('lang');
    };
  }, [dir, locale]);

  const value = useMemo(
    () => ({ locale, setLocale, t, format, dir }),
    [locale, setLocale, t, format, dir],
  );

  return (
    <PortalLoginI18nContext.Provider value={value}>{children}</PortalLoginI18nContext.Provider>
  );
}

export function usePortalLoginI18n(): PortalLoginI18nContextValue {
  const ctx = useContext(PortalLoginI18nContext);
  if (!ctx) {
    throw new Error('usePortalLoginI18n must be used within PortalLoginI18nProvider');
  }
  return ctx;
}

export function usePortalLoginI18nOptional(): PortalLoginI18nContextValue | null {
  return useContext(PortalLoginI18nContext);
}
