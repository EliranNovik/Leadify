import React, { useEffect, type ReactNode } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';
import portalI18n from './portalI18n';
import {
  isPortalAppLocale,
  type PortalAppLocale,
  writeStoredPortalLocale,
} from './portalLocaleStorage';

function PortalDocumentDirSync({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  const locale = (isPortalAppLocale(i18n.language) ? i18n.language : 'en') as PortalAppLocale;
  const dir = locale === 'he' ? 'rtl' : 'ltr';

  useEffect(() => {
    const html = document.documentElement;
    const prevDir = html.getAttribute('dir');
    const prevLang = html.getAttribute('lang');

    html.setAttribute('dir', dir);
    html.setAttribute('lang', locale);
    writeStoredPortalLocale(locale);

    return () => {
      if (prevDir) html.setAttribute('dir', prevDir);
      else html.removeAttribute('dir');
      if (prevLang) html.setAttribute('lang', prevLang);
      else html.removeAttribute('lang');
    };
  }, [dir, locale]);

  return (
    <div dir={dir} lang={locale} className="min-h-[100dvh]">
      {children}
    </div>
  );
}

export function PortalI18nProvider({ children }: { children: ReactNode }) {
  return (
    <I18nextProvider i18n={portalI18n}>
      <PortalDocumentDirSync>{children}</PortalDocumentDirSync>
    </I18nextProvider>
  );
}
