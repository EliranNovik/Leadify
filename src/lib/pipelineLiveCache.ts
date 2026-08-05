import { useEffect, useLayoutEffect, useRef } from 'react';
import { supabase } from './supabase';

/**
 * Shared "instant paint + live patch" plumbing for the pipeline pages.
 *
 * Both the Case Pipeline and the Closer/Scheduler pipeline keep their last result in a
 * module-scope snapshot so navigating away and back repaints from memory instead of showing a
 * spinner, revalidate silently in the background, restore the scroll offset, and subscribe to
 * the tables their rows are built from.
 */

/** The authenticated shell scrolls inside <main class="app-main-scroll">, not the window. */
export function getAppScrollContainer(): HTMLElement | null {
  return (
    (document.querySelector('.app-main-scroll') as HTMLElement | null) ||
    (document.querySelector('main') as HTMLElement | null)
  );
}

export const DEFAULT_PIPELINE_STALE_MS = 5 * 60 * 1000;

export type SnapshotStore<T> = {
  get(): T | null;
  set(data: T): void;
  /** Mutate the cached value in place; ignored when nothing is cached yet. */
  update(updater: (previous: T) => T): void;
  clear(): void;
  fetchedAt(): number;
  isStale(staleMs?: number): boolean;
  getScrollTop(): number;
  setScrollTop(value: number): void;
};

/**
 * Module-scope cache for one page's data.
 *
 * `version` is a manual invalidation lever: bump it whenever the cached shape changes so an
 * older snapshot left over from a previous build inside the same session is discarded.
 */
export function createSnapshotStore<T>(version: number): SnapshotStore<T> {
  let entry: { data: T; fetchedAt: number; version: number } | null = null;
  let scrollTop = 0;

  const read = () => {
    if (entry && entry.version !== version) entry = null;
    return entry;
  };

  return {
    get: () => read()?.data ?? null,
    set: (data: T) => {
      entry = { data, fetchedAt: Date.now(), version };
    },
    update: (updater) => {
      const current = read();
      if (!current) return;
      current.data = updater(current.data);
    },
    clear: () => {
      entry = null;
    },
    fetchedAt: () => read()?.fetchedAt ?? 0,
    isStale: (staleMs = DEFAULT_PIPELINE_STALE_MS) => {
      const current = read();
      return !current || Date.now() - current.fetchedAt >= staleMs;
    },
    getScrollTop: () => scrollTop,
    setScrollTop: (value: number) => {
      scrollTop = value;
    },
  };
}

/**
 * Keeps the app shell's scroll offset across mounts so returning to a page lands exactly where
 * the user left it.
 *
 * `contentReadyKey` should change when the rows finish rendering (typically the loading flag):
 * the restore retries until the container is actually tall enough to reach the saved offset.
 */
export function useScrollRestoration(
  store: Pick<SnapshotStore<unknown>, 'getScrollTop' | 'setScrollTop'>,
  contentReadyKey: unknown,
  enabled = true,
): void {
  const frozenRef = useRef(false);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  // Capture the final offset before the DOM is torn down; a layout cleanup still sees it.
  useLayoutEffect(() => {
    frozenRef.current = false;
    return () => {
      const container = getAppScrollContainer();
      if (container && enabledRef.current) store.setScrollTop(container.scrollTop);
      // Removing our rows can make the shell clamp scrollTop to 0 and emit a scroll event.
      frozenRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const container = getAppScrollContainer();
    if (!container) return;

    const target = store.getScrollTop();
    const timers: number[] = [];
    const frames: number[] = [];
    let restored = target <= 0;

    if (!restored) {
      // Rows may still be laying out, so retry until the container is tall enough to scroll.
      [0, 60, 160, 320].forEach((delay) => {
        timers.push(
          window.setTimeout(() => {
            if (restored) return;
            frames.push(
              window.requestAnimationFrame(() => {
                if (container.scrollHeight - container.clientHeight >= target) {
                  container.scrollTop = target;
                  restored = true;
                }
              }),
            );
          }, delay),
        );
      });
    }

    const onScroll = () => {
      if (frozenRef.current) return;
      store.setScrollTop(container.scrollTop);
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', onScroll);
      timers.forEach((t) => window.clearTimeout(t));
      frames.forEach((f) => window.cancelAnimationFrame(f));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentReadyKey, enabled]);
}

/**
 * Realtime patches only arrive while a page is mounted, so a tab that sat in the background
 * with an idle socket revalidates when it becomes visible again.
 */
export function useRevalidateOnVisible(options: {
  enabled?: boolean;
  isStale: () => boolean;
  onRevalidate: () => void;
}): void {
  const { enabled = true, isStale, onRevalidate } = options;
  const isStaleRef = useRef(isStale);
  const onRevalidateRef = useRef(onRevalidate);
  isStaleRef.current = isStale;
  onRevalidateRef.current = onRevalidate;

  useEffect(() => {
    if (!enabled) return;
    const revalidateIfStale = () => {
      if (document.visibilityState !== 'visible') return;
      if (!isStaleRef.current()) return;
      onRevalidateRef.current();
    };
    window.addEventListener('focus', revalidateIfStale);
    document.addEventListener('visibilitychange', revalidateIfStale);
    return () => {
      window.removeEventListener('focus', revalidateIfStale);
      document.removeEventListener('visibilitychange', revalidateIfStale);
    };
  }, [enabled]);
}

export type RealtimeTableSubscription = {
  table: string;
  handler: (payload: any) => void;
};

/**
 * Subscribes to `postgres_changes` on a set of tables for as long as the caller is enabled.
 *
 * Handlers are read through a ref so a page can pass inline closures without tearing the
 * channel down and re-subscribing on every render.
 */
export function useRealtimeTables(
  channelName: string,
  subscriptions: RealtimeTableSubscription[],
  options: { enabled?: boolean; resubscribeKey?: unknown } = {},
): void {
  const { enabled = true, resubscribeKey } = options;
  const subscriptionsRef = useRef(subscriptions);
  subscriptionsRef.current = subscriptions;

  useEffect(() => {
    if (!enabled) return;

    const channel = supabase.channel(channelName);
    subscriptionsRef.current.forEach(({ table }, index) => {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
        subscriptionsRef.current[index]?.handler(payload);
      });
    });
    channel.subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [channelName, enabled, resubscribeKey]);
}

/**
 * Collapses bursts of realtime events into a single trailing call. Bulk writes emit one event
 * per row, and every one of them would otherwise trigger its own refetch.
 */
export function useDebouncedCallback(callback: () => void, delayMs: number): () => void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    };
  }, []);

  return useRef(() => {
    if (typeof window === 'undefined') return;
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      callbackRef.current();
    }, delayMs);
  }).current;
}
