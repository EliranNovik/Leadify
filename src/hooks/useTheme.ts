import { useState, useEffect } from 'react';

export const useTheme = () => {
  const [theme, setTheme] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return document.documentElement.getAttribute('data-theme') || 'light';
    }
    return 'light';
  });

  const [isAltTheme, setIsAltTheme] = useState(() => {
    if (typeof window !== 'undefined') {
      return document.documentElement.classList.contains('theme-alt');
    }
    return false;
  });

  useEffect(() => {
    const checkTheme = () => {
      if (typeof window !== 'undefined') {
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
        const hasThemeAlt = document.documentElement.classList.contains('theme-alt');
        setTheme(currentTheme);
        setIsAltTheme(hasThemeAlt);
      }
    };

    // Check on mount
    checkTheme();

    // Watch for theme changes via MutationObserver
    const observer = new MutationObserver(checkTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme']
    });

    // Listen to custom theme change event
    const handleThemeChange = (e: CustomEvent) => {
      setTimeout(checkTheme, 50);
    };
    window.addEventListener('themechange', handleThemeChange as EventListener);

    // Also listen to storage changes
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'theme') {
        setTimeout(checkTheme, 100);
      }
    };
    window.addEventListener('storagechange', handleStorageChange);

    // Poll every 500ms as fallback
    const interval = setInterval(checkTheme, 500);

    return () => {
      observer.disconnect();
      window.removeEventListener('themechange', handleThemeChange as EventListener);
      window.removeEventListener('storagechange', handleStorageChange);
      clearInterval(interval);
    };
  }, []);

  const isDarkTheme = theme === 'dark';

  return { theme, isAltTheme, isDarkTheme };
};
