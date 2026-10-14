/**
 * Dark / light theme for the three WhatsApp surfaces: the WhatsApp page, the WhatsApp leads page and
 * the Interactions tab.
 *
 * Follows the AI drawer's approach (`AI_DRAWER_THEME_KEY` in AIChatWindow): one root class on the
 * surface, a stylesheet of CSS variables keyed on it, and the choice remembered in localStorage.
 *
 * Why a class and variables rather than Tailwind's `dark:` variant: these screens carry over five
 * hundred hardcoded neutral utilities between them and no `dark:` variants at all, and `darkMode` is
 * set to `'class'`, so a `dark` class here would also repaint the surrounding app shell. Scoping to
 * `wa-dark` keeps the change inside the WhatsApp surfaces.
 *
 * The three surfaces share one key on purpose — switching theme in a client's Interactions tab and
 * finding the full WhatsApp page still light would read as a bug.
 */
import { useCallback, useEffect, useState } from 'react';

const WHATSAPP_THEME_KEY = 'rmqWhatsAppTheme';

export const WHATSAPP_DARK_CLASS = 'wa-dark';
export const WHATSAPP_LIGHT_CLASS = 'wa-light';

/**
 * Light unless told otherwise, unlike the AI drawer which defaults dark.
 *
 * These screens have always been light and are used all day; flipping everyone to dark on deploy
 * would be a surprise rather than a feature.
 */
export function readWhatsAppDark(): boolean {
  try {
    return localStorage.getItem(WHATSAPP_THEME_KEY) === 'dark';
  } catch {
    // Private browsing and blocked storage both throw; the theme is not worth failing a render over.
    return false;
  }
}

function writeWhatsAppDark(isDark: boolean): void {
  try {
    localStorage.setItem(WHATSAPP_THEME_KEY, isDark ? 'dark' : 'light');
  } catch {
    /* ignore */
  }
}

export type WhatsAppTheme = {
  isDark: boolean;
  toggle: () => void;
  /** Goes on the surface's outermost element; everything else is styled from it. */
  rootClass: string;
};

export function useWhatsAppTheme(): WhatsAppTheme {
  const [isDark, setIsDark] = useState(readWhatsAppDark);

  useEffect(() => {
    writeWhatsAppDark(isDark);
  }, [isDark]);

  /*
   * Keeps the surfaces in step while they are open together — the Interactions tab sits inside a
   * client page that can be open beside the WhatsApp page, and `storage` fires on the other tabs.
   */
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== WHATSAPP_THEME_KEY) return;
      setIsDark(event.newValue === 'dark');
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const toggle = useCallback(() => setIsDark((value) => !value), []);

  return {
    isDark,
    toggle,
    rootClass: isDark ? WHATSAPP_DARK_CLASS : WHATSAPP_LIGHT_CLASS,
  };
}
