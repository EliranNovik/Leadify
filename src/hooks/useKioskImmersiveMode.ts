import { useCallback, useEffect, useRef, useState } from 'react';

const KIOSK_MANIFEST_HREF = '/manifest-entry-kiosk.json';
const DEFAULT_MANIFEST_HREF = '/manifest.json';
const KIOSK_THEME = '#0a1628';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

function getManifestLink(): HTMLLinkElement | null {
  return document.querySelector('link[rel="manifest"]');
}

/** Installed / launched as PWA — this is what truly removes Chrome's bottom bar on Android tablets. */
function isPwaDisplayMode(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia('(display-mode: fullscreen)').matches) return true;
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
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

/**
 * Chrome Android sometimes reports fullscreen while system nav / gesture chrome
 * still steals a strip at the bottom. Compare layout to the screen.
 */
function hasLikelyBottomSystemChrome(): boolean {
  if (typeof window === 'undefined') return false;
  if (isPwaDisplayMode()) return false;
  const screenH = window.screen?.height || 0;
  const innerH = window.innerHeight || 0;
  const vvH = window.visualViewport?.height || innerH;
  const used = Math.max(innerH, vvH);
  // More than ~a gesture / nav bar still uncovered
  return screenH > 0 && screenH - used > 28;
}

async function requestFullscreenOn(el: HTMLElement): Promise<boolean> {
  const anyEl = el as HTMLElement & {
    requestFullscreen?: (options?: FullscreenOptions) => Promise<void>;
    webkitRequestFullscreen?: () => Promise<void> | void;
    webkitRequestFullScreen?: () => Promise<void> | void;
  };
  try {
    if (typeof anyEl.requestFullscreen === 'function') {
      await anyEl.requestFullscreen({ navigationUI: 'hide' });
      return isDocumentFullscreen();
    }
    if (typeof anyEl.webkitRequestFullscreen === 'function') {
      await Promise.resolve(anyEl.webkitRequestFullscreen());
      return isDocumentFullscreen();
    }
    if (typeof anyEl.webkitRequestFullScreen === 'function') {
      await Promise.resolve(anyEl.webkitRequestFullScreen());
      return isDocumentFullscreen();
    }
  } catch {
    // Gesture required or policy blocked.
  }
  return false;
}

/**
 * Prefer documentElement; fall back to body / #root.
 * navigationUI: 'hide' is what asks Chrome to drop browser + nav UI.
 */
async function requestDocumentFullscreen(): Promise<boolean> {
  const candidates: HTMLElement[] = [
    document.documentElement,
    document.body,
    document.getElementById('root'),
  ].filter((n): n is HTMLElement => Boolean(n));

  for (const el of candidates) {
    const ok = await requestFullscreenOn(el);
    if (ok) return true;
  }
  return false;
}

function applyThemeColor(content: string) {
  const metas = Array.from(
    document.querySelectorAll('meta[name="theme-color"]'),
  ) as HTMLMetaElement[];
  if (metas.length === 0) {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.content = content;
    document.head.appendChild(meta);
    return;
  }
  metas.forEach((meta) => meta.setAttribute('content', content));
}

/**
 * Immersive mode for the office entry tablet:
 * 1. Prefer installed PWA with display: fullscreen (real Chrome chrome removal)
 * 2. Else Fullscreen API with navigationUI: 'hide' (requires a tap)
 * 3. Re-enter fullscreen if the user exits it
 * 4. Offer one-tap install when Chrome exposes beforeinstallprompt
 */
export function useKioskImmersiveMode() {
  const [isImmersive, setIsImmersive] = useState(
    () => isPwaDisplayMode() || isDocumentFullscreen(),
  );
  const [isPwa, setIsPwa] = useState(() => isPwaDisplayMode());
  const [needsTapToFullscreen, setNeedsTapToFullscreen] = useState(false);
  const [needsInstallForTrueFullscreen, setNeedsInstallForTrueFullscreen] = useState(false);
  const [canInstall, setCanInstall] = useState(false);
  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);

  const refreshImmersiveState = useCallback(() => {
    const pwa = isPwaDisplayMode();
    const fs = isDocumentFullscreen();
    const gap = hasLikelyBottomSystemChrome();
    setIsPwa(pwa);
    setIsImmersive(pwa || fs);
    // Still need a tap if we're in a normal Chrome tab without document fullscreen.
    setNeedsTapToFullscreen(!pwa && !fs);
    // Document FS alone often leaves Android system nav on tablets — install is the real fix.
    setNeedsInstallForTrueFullscreen(!pwa && (fs ? gap : true));
    setCanInstall(Boolean(deferredPromptRef.current));
  }, []);

  const enterFullscreen = useCallback(async () => {
    if (isPwaDisplayMode()) {
      refreshImmersiveState();
      return true;
    }
    if (isDocumentFullscreen()) {
      refreshImmersiveState();
      return true;
    }
    const ok = await requestDocumentFullscreen();
    // After FS, give Chrome a frame to update viewport metrics.
    requestAnimationFrame(() => refreshImmersiveState());
    return ok;
  }, [refreshImmersiveState]);

  const installKioskApp = useCallback(async () => {
    const deferred = deferredPromptRef.current;
    if (!deferred) {
      // Manual Chrome path when the browser didn't fire beforeinstallprompt.
      window.alert(
        'Install this kiosk as an app for true fullscreen (hides Chrome’s bottom bar):\n\n' +
          '1. Chrome menu (⋮)\n' +
          '2. “Install app” or “Add to Home screen”\n' +
          '3. Open “Entry Kiosk” from the home screen / app drawer — not from a Chrome tab',
      );
      return false;
    }
    try {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      deferredPromptRef.current = null;
      setCanInstall(false);
      if (outcome === 'accepted') {
        // User still must launch from the installed icon for display: fullscreen.
        window.alert(
          'Installed. Close this Chrome tab and open “Entry Kiosk” from the home screen / app drawer for true fullscreen.',
        );
        refreshImmersiveState();
        return true;
      }
    } catch {
      // ignored
    }
    refreshImmersiveState();
    return false;
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
    html.style.backgroundColor = KIOSK_THEME;
    html.style.colorScheme = 'dark';
    body.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'none';
    body.style.backgroundColor = KIOSK_THEME;
    if (root) root.style.backgroundColor = KIOSK_THEME;
    if (manifestLink) {
      manifestLink.setAttribute('href', KIOSK_MANIFEST_HREF);
    }
    applyThemeColor(KIOSK_THEME);

    refreshImmersiveState();
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
        // If they returned from another app into a Chrome tab, try FS again (may need gesture).
        if (!isPwaDisplayMode() && !isDocumentFullscreen()) {
          void enterFullscreen();
        }
      }
    };
    const onResize = () => refreshImmersiveState();

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      deferredPromptRef.current = e as BeforeInstallPromptEvent;
      setCanInstall(true);
      refreshImmersiveState();
    };

    // If the user exits fullscreen (swipe, Esc), next tap on the page re-enters it.
    const onPointerDownCapture = () => {
      if (isPwaDisplayMode() || isDocumentFullscreen()) return;
      void enterFullscreen();
    };

    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange as EventListener);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    document.addEventListener('pointerdown', onPointerDownCapture, true);

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
      window.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      document.removeEventListener('pointerdown', onPointerDownCapture, true);
      void wakeLock?.release().catch(() => undefined);
      if (isDocumentFullscreen()) {
        void document.exitFullscreen?.().catch(() => undefined);
      }
    };
  }, [enterFullscreen, refreshImmersiveState]);

  return {
    isImmersive,
    isPwa,
    needsTapToFullscreen,
    needsInstallForTrueFullscreen,
    canInstall,
    enterFullscreen,
    installKioskApp,
  };
}
