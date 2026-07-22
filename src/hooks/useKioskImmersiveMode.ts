import { useCallback, useEffect, useState } from 'react';

const KIOSK_MANIFEST_HREF = '/manifest-entry-kiosk.json';
const DEFAULT_MANIFEST_HREF = '/manifest.json';

function getManifestLink(): HTMLLinkElement | null {
  return document.querySelector('link[rel="manifest"]');
}

function isDisplayModeImmersive(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia('(display-mode: fullscreen)').matches) return true;
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  if (window.matchMedia('(display-mode: minimal-ui)').matches) return true;
  // iOS Safari installed web app
  if ((window.navigator as Navigator & { standalone?: boolean }).standalone === true) {
    return true;
  }
  return false;
}

function isDocumentFullscreen(): boolean {
  const doc = document as Document & {
    webkitFullscreenElement?: Element | null;
  };
  return Boolean(document.fullscreenElement || doc.webkitFullscreenElement);
}

async function requestDocumentFullscreen(): Promise<boolean> {
  const el = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
  };
  try {
    if (el.requestFullscreen) {
      await el.requestFullscreen({ navigationUI: 'hide' });
      return true;
    }
    if (el.webkitRequestFullscreen) {
      await Promise.resolve(el.webkitRequestFullscreen());
      return true;
    }
  } catch {
    // Gesture required or policy blocked — caller shows tap prompt.
  }
  return false;
}

/**
 * Immersive mode for the office entry tablet:
 * - Swaps to a kiosk-specific PWA manifest (display: fullscreen)
 * - Requests browser Fullscreen API when possible
 * - Holds a screen wake lock while the page is open
 */
export function useKioskImmersiveMode() {
  const [isImmersive, setIsImmersive] = useState(
    () => isDisplayModeImmersive() || isDocumentFullscreen(),
  );
  const [needsTapToFullscreen, setNeedsTapToFullscreen] = useState(false);

  const refreshImmersiveState = useCallback(() => {
    const immersive = isDisplayModeImmersive() || isDocumentFullscreen();
    setIsImmersive(immersive);
    setNeedsTapToFullscreen(!immersive);
  }, []);

  const enterFullscreen = useCallback(async () => {
    if (isDisplayModeImmersive() || isDocumentFullscreen()) {
      refreshImmersiveState();
      return true;
    }
    const ok = await requestDocumentFullscreen();
    refreshImmersiveState();
    return ok;
  }, [refreshImmersiveState]);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById('root');
    const prevOverflow = body.style.overflow;
    const prevOverscroll = body.style.overscrollBehavior;
    const prevHtmlBg = html.style.backgroundColor;
    const prevBodyBg = body.style.backgroundColor;
    const prevRootBg = root?.style.backgroundColor ?? '';
    const prevColorScheme = html.style.colorScheme;
    const manifestLink = getManifestLink();
    const prevManifestHref = manifestLink?.getAttribute('href') || DEFAULT_MANIFEST_HREF;
    const themeMetas = Array.from(
      document.querySelectorAll('meta[name="theme-color"]'),
    ) as HTMLMetaElement[];
    const prevThemes = themeMetas.map((meta) => meta.getAttribute('content'));

    html.classList.add('entry-kiosk-active');
    html.style.backgroundColor = '#0a1628';
    html.style.colorScheme = 'dark';
    body.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'none';
    body.style.backgroundColor = '#0a1628';
    if (root) root.style.backgroundColor = '#0a1628';
    if (manifestLink) {
      manifestLink.setAttribute('href', KIOSK_MANIFEST_HREF);
    }
    // Chrome uses theme-color for the bottom toolbar / gesture strip — keep every meta dark.
    if (themeMetas.length === 0) {
      const meta = document.createElement('meta');
      meta.name = 'theme-color';
      meta.content = '#0a1628';
      document.head.appendChild(meta);
      themeMetas.push(meta);
      prevThemes.push(null);
    } else {
      themeMetas.forEach((meta) => meta.setAttribute('content', '#0a1628'));
    }

    refreshImmersiveState();

    // Best-effort auto fullscreen (often blocked until a user gesture on mobile Chrome).
    void enterFullscreen();

    let wakeLock: WakeLockSentinel | null = null;
    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          wakeLock = await navigator.wakeLock.request('screen');
        }
      } catch {
        // Unsupported or denied — ignore.
      }
    };
    void requestWakeLock();

    const onFsChange = () => refreshImmersiveState();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void requestWakeLock();
        refreshImmersiveState();
      }
    };

    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange as EventListener);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      html.classList.remove('entry-kiosk-active');
      html.style.backgroundColor = prevHtmlBg;
      html.style.colorScheme = prevColorScheme;
      body.style.overflow = prevOverflow;
      body.style.overscrollBehavior = prevOverscroll;
      body.style.backgroundColor = prevBodyBg;
      if (root) root.style.backgroundColor = prevRootBg;
      if (manifestLink) manifestLink.setAttribute('href', prevManifestHref);
      themeMetas.forEach((meta, i) => {
        const prev = prevThemes[i];
        if (prev == null) meta.remove();
        else meta.setAttribute('content', prev);
      });
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange as EventListener);
      document.removeEventListener('visibilitychange', onVisibility);
      void wakeLock?.release().catch(() => undefined);
      if (isDocumentFullscreen()) {
        void document.exitFullscreen?.().catch(() => undefined);
      }
    };
  }, [enterFullscreen, refreshImmersiveState]);

  return {
    isImmersive,
    needsTapToFullscreen,
    enterFullscreen,
  };
}
