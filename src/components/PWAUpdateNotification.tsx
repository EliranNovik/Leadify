import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowPathIcon, XMarkIcon } from '@heroicons/react/24/outline';

const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Drop every cache before reloading, so the new version comes down from the network instead of
 * being partly served from the old bundle cache. `location.reload(true)` is a no-op in modern
 * browsers, so clearing Cache Storage is what actually makes this a hard refresh.
 */
async function hardReload(): Promise<void> {
  try {
    if ('caches' in window) {
      const names = await caches.keys();
      await Promise.all(names.map((name) => caches.delete(name)));
    }
  } catch (error) {
    console.warn('⚠️ PWAUpdateNotification: cache clear failed, reloading anyway:', error);
  }
  window.location.reload();
}

const PWAUpdateNotification: React.FC = () => {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [updating, setUpdating] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  /** Set only by the Update button, so an unrelated controller change never reloads the page. */
  const updateRequestedRef = useRef(false);
  const reloadingRef = useRef(false);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);

  const reloadOnce = useCallback(() => {
    if (reloadingRef.current) return;
    reloadingRef.current = true;
    void hardReload();
  }, []);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    let cancelled = false;
    let teardown: (() => void) | null = null;
    /** Last worker we surfaced — guards against re-showing one the user already dismissed. */
    let announced: ServiceWorker | null = null;

    const announce = (worker: ServiceWorker | null | undefined) => {
      if (cancelled || !worker || worker === announced) return;
      // No controller means this is the very first install, not an update.
      if (!navigator.serviceWorker.controller) return;
      announced = worker;
      setWaitingWorker(worker);
      setDismissed(false);
    };

    const watchInstalling = (worker: ServiceWorker | null) => {
      if (!worker) return;
      if (worker.state === 'installed') {
        announce(worker);
        return;
      }
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed') announce(worker);
      });
    };

    const onControllerChange = () => {
      // Only the Update button should trigger a reload; a background takeover must not yank the
      // page out from under someone mid-form.
      if (!updateRequestedRef.current) return;
      reloadOnce();
    };

    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    navigator.serviceWorker.ready
      .then((registration) => {
        if (cancelled) return;
        registrationRef.current = registration;

        // Read the current state, don't just wait for the event: the worker usually finishes
        // installing before this component mounts, so `updatefound` has already fired and missing
        // it is why the prompt only appeared sometimes.
        announce(registration.waiting);
        watchInstalling(registration.installing);

        const onUpdateFound = () => watchInstalling(registration.installing);
        registration.addEventListener('updatefound', onUpdateFound);

        const check = () => {
          registration.update().catch((error) => {
            console.warn('⚠️ PWAUpdateNotification: update check failed:', error);
          });
        };
        check();

        const interval = window.setInterval(check, UPDATE_CHECK_INTERVAL_MS);
        const onFocus = () => check();
        const onVisibilityChange = () => {
          if (document.visibilityState === 'visible') check();
        };
        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', onVisibilityChange);

        teardown = () => {
          window.clearInterval(interval);
          window.removeEventListener('focus', onFocus);
          document.removeEventListener('visibilitychange', onVisibilityChange);
          registration.removeEventListener('updatefound', onUpdateFound);
        };
      })
      .catch((error) => {
        console.warn('⚠️ PWAUpdateNotification: service worker unavailable:', error);
      });

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      teardown?.();
    };
  }, []);

  const handleUpdate = useCallback(() => {
    if (updating) return;
    setUpdating(true);
    updateRequestedRef.current = true;

    // Read the live registration rather than trusting state: another deploy may have replaced the
    // worker we rendered, and messaging a redundant one would never hand over.
    const worker = registrationRef.current?.waiting ?? waitingWorker;

    if (worker && worker.state === 'installed') {
      // Hand over, then reload once the new worker is actually in charge. Reloading straight away
      // races the handover and can boot the old version again. `controllerchange` normally gets
      // there first; watching the worker reach `activated` covers the case where it doesn't.
      worker.addEventListener('statechange', () => {
        if (worker.state === 'activated') reloadOnce();
      });
      worker.postMessage({ type: 'SKIP_WAITING' });
      return;
    }

    // Nothing parked (an older build self-activated, or the worker went redundant): just refresh.
    reloadOnce();
  }, [updating, waitingWorker, reloadOnce]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
  }, []);

  if (!waitingWorker || (dismissed && !updating)) return null;

  return (
    <div className="fixed top-4 left-4 right-4 md:left-auto md:right-6 md:w-[22.5rem] z-50 animate-slide-down">
      <div className="overflow-hidden rounded-2xl border border-base-300/60 bg-base-100/95 shadow-xl ring-1 ring-black/5 backdrop-blur-xl">
        <div className="flex items-start gap-3 p-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ArrowPathIcon className={`h-5 w-5 ${updating ? 'animate-spin' : ''}`} aria-hidden="true" />
          </span>

          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold tracking-tight text-base-content">
              {updating ? 'Updating RMQ 2.0' : 'Update available'}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-base-content/60">
              {updating
                ? 'Clearing the cache and reloading with the new version.'
                : 'A newer version is ready. Updating clears the cache and reloads the app.'}
            </p>

            <div className="mt-3 flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleUpdate}
                disabled={updating}
                className="btn btn-primary btn-sm h-8 min-h-0 gap-1.5 rounded-lg px-3 text-xs font-semibold shadow-none"
              >
                {updating ? (
                  <>
                    <span className="loading loading-spinner loading-xs" aria-hidden="true" />
                    Updating
                  </>
                ) : (
                  'Update now'
                )}
              </button>
              {!updating && (
                <button
                  type="button"
                  onClick={handleDismiss}
                  className="btn btn-ghost btn-sm h-8 min-h-0 rounded-lg px-3 text-xs font-medium text-base-content/60"
                >
                  Later
                </button>
              )}
            </div>
          </div>

          {!updating && (
            <button
              type="button"
              onClick={handleDismiss}
              className="shrink-0 rounded-lg p-1 text-base-content/35 transition-colors hover:bg-base-200 hover:text-base-content/70"
              aria-label="Dismiss update notice"
            >
              <XMarkIcon className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>

        {updating && <progress className="progress progress-primary h-0.5 w-full rounded-none" />}
      </div>
    </div>
  );
};

export default PWAUpdateNotification;
