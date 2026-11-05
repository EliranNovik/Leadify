export const PORTAL_LOCALE_STORAGE_KEY = 'portal_login_locale';

export type PortalAppLocale = 'en' | 'he';

export function isPortalAppLocale(value: string): value is PortalAppLocale {
  return value === 'en' || value === 'he';
}

/** Map login locales (fr/de) to the app catalog until those packs exist. */
export function resolvePortalAppLocale(stored: string | null | undefined): PortalAppLocale {
  if (stored === 'he') return 'he';
  return 'en';
}

export function readStoredPortalAppLocale(): PortalAppLocale {
  try {
    return resolvePortalAppLocale(localStorage.getItem(PORTAL_LOCALE_STORAGE_KEY));
  } catch {
    return 'en';
  }
}

export function writeStoredPortalLocale(locale: PortalAppLocale): void {
  try {
    localStorage.setItem(PORTAL_LOCALE_STORAGE_KEY, locale);
  } catch {
    // ignore
  }
}
