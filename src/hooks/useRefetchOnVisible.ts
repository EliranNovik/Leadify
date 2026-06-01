import { useEffect, useRef } from 'react';
import { isNarrowViewport } from '../lib/mobileCache';

export { isNarrowViewport };

type UseRefetchOnVisibleOptions = {
  /** When false, listeners are not attached. */
  enabled?: boolean;
  /** Skip refetch if data was fetched more recently than this (ms). */
  staleMs?: number;
  /** Debounce rapid visibility/focus events. */
  debounceMs?: number;
  /** Updated after a successful refetch so resume skips unnecessary work. */
  lastFetchedAtRef?: React.MutableRefObject<number>;
  onRefetch: () => void | Promise<void>;
};

/**
 * Refetch when the tab/window becomes visible or focused again (mobile resume).
 */
export function useRefetchOnVisible({
  enabled = true,
  staleMs = 60_000,
  debounceMs = 300,
  lastFetchedAtRef,
  onRefetch,
}: UseRefetchOnVisibleOptions): void {
  const onRefetchRef = useRef(onRefetch);
  onRefetchRef.current = onRefetch;

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return;

    const run = () => {
      if (document.visibilityState !== 'visible') return;
      const lastMs = lastFetchedAtRef?.current ?? 0;
      if (lastMs > 0 && Date.now() - lastMs < staleMs) return;
      if (inFlightRef.current) return;

      inFlightRef.current = true;
      void Promise.resolve(onRefetchRef.current())
        .catch(() => {
          /* caller handles errors */
        })
        .finally(() => {
          inFlightRef.current = false;
          if (lastFetchedAtRef) {
            lastFetchedAtRef.current = Date.now();
          }
        });
    };

    const schedule = () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        run();
      }, debounceMs);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') schedule();
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', schedule);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', schedule);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [enabled, staleMs, debounceMs, lastFetchedAtRef]);
}
