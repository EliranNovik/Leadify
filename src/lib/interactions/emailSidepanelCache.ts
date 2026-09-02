import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

type CacheEntry<T> = {
  ts: number;
  data: T;
};

const memoryCache = new Map<string, CacheEntry<unknown>>();
const DEFAULT_TTL_MS = 2 * 60 * 1000;

function storageKey(key: string) {
  return `email-sidepanel-cache:v3:${key}`;
}

export function readEmailSidepanelCache<T>(key: string, ttlMs = DEFAULT_TTL_MS): T | null {
  const mem = memoryCache.get(key) as CacheEntry<T> | undefined;
  if (mem && Date.now() - mem.ts < ttlMs) return mem.data;

  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(storageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry<T>;
    if (!parsed?.ts || Date.now() - parsed.ts > ttlMs) return null;
    memoryCache.set(key, parsed);
    return parsed.data;
  } catch {
    return null;
  }
}

export function writeEmailSidepanelCache<T>(key: string, data: T): void {
  const entry: CacheEntry<T> = { ts: Date.now(), data };
  memoryCache.set(key, entry);
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(storageKey(key), JSON.stringify(entry));
  } catch {
    /* quota / private mode */
  }
}

export function invalidateEmailSidepanelCache(keyPrefix?: string): void {
  if (!keyPrefix) {
    memoryCache.clear();
    return;
  }
  for (const key of Array.from(memoryCache.keys())) {
    if (key.startsWith(keyPrefix)) memoryCache.delete(key);
  }
  if (typeof sessionStorage === 'undefined') return;
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(storageKey(keyPrefix))) toRemove.push(k);
    }
    toRemove.forEach((k) => sessionStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

/**
 * Subscribe to emails changes for a lead/contact sidepanel.
 * Returns an unsubscribe function.
 */
export function subscribeEmailSidepanel(
  supabaseClient: SupabaseClient,
  options: {
    channelName: string;
    filter?: string;
    onChange: () => void;
  },
): () => void {
  let channel: RealtimeChannel | null = null;
  try {
    const builder = supabaseClient.channel(options.channelName).on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'emails',
        ...(options.filter ? { filter: options.filter } : {}),
      },
      () => {
        options.onChange();
      },
    );
    channel = builder.subscribe();
  } catch {
    channel = null;
  }

  return () => {
    if (channel) {
      void supabaseClient.removeChannel(channel);
    }
  };
}
