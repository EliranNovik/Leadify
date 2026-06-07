import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

/** Minimal shape of a Supabase realtime postgres_changes payload (we only ever read new/old rows). */
export interface RealtimeChangePayload {
  eventType?: 'INSERT' | 'UPDATE' | 'DELETE';
  new?: Record<string, unknown> | null;
  old?: Record<string, unknown> | null;
}

/**
 * Declarative description of a single Postgres table to listen to for realtime changes.
 *
 * IMPORTANT: prefer the client-side `match` predicate over the server-side `filter`. Filtered
 * postgres_changes are unreliable in this project (UUID / RLS / replication quirks), which is why
 * the existing ClientHeader / CalendarPage subscriptions subscribe table-wide and match in JS.
 */
export interface RealtimeTableSubscription {
  table: string;
  schema?: string;
  event?: '*' | 'INSERT' | 'UPDATE' | 'DELETE';
  /** Server-side filter (e.g. `lead_id=eq.123`). Usually leave unset; use `match` instead. */
  filter?: string;
  /** Client-side row matcher. When provided, a change only triggers a refetch if this returns true. */
  match?: (payload: RealtimeChangePayload) => boolean;
}

export interface UseRealtimeRefreshOptions {
  /** Unique channel name. Use something stable + scoped, e.g. `client-interactions-<leadId>`. */
  channelName: string;
  /** Tables to subscribe to. When empty (or `enabled` is false) no channel is opened. */
  tables: RealtimeTableSubscription[];
  /**
   * Silent refetch callback. Called (debounced) whenever a subscribed table changes, the window
   * regains focus, or the tab becomes visible again. This should refresh data IN PLACE — it must
   * NOT toggle a full-page loading spinner, so the UI updates without a visible page refresh.
   */
  onChange: () => void | Promise<void>;
  enabled?: boolean;
  /** Debounce window so a burst of DB changes triggers a single refetch. Defaults to 400ms. */
  debounceMs?: number;
  /** Also refetch on window focus / tab visibility. Defaults to true. */
  refreshOnFocus?: boolean;
}

/**
 * Subscribe to live Postgres changes (plus window focus / tab-visibility) and trigger a debounced,
 * silent refetch. Mirrors the freshness pattern used by ClientHeader / CalendarPage /
 * CollectionFinancesReport: cached data renders instantly, then this keeps it live without
 * re-rendering the whole page.
 *
 * The latest `onChange` and the latest `match` predicates are always used via refs, so passing
 * inline callbacks never re-opens the channel. The channel is only re-created when `channelName`,
 * the serializable shape of `tables` (table/schema/event/filter), or `enabled` change.
 */
export function useRealtimeRefresh({
  channelName,
  tables,
  onChange,
  enabled = true,
  debounceMs = 400,
  refreshOnFocus = true,
}: UseRealtimeRefreshOptions): void {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Keep latest table configs (incl. non-serializable `match` fns) available to the channel handler.
  const tablesRef = useRef(tables);
  tablesRef.current = tables;

  // Stable dependency from only the serializable parts, so changing a `match` closure each render
  // does not tear down and recreate the realtime channel.
  const tablesKey = JSON.stringify(
    (tables ?? []).map((t) => ({
      table: t.table,
      schema: t.schema ?? 'public',
      event: t.event ?? '*',
      filter: t.filter ?? null,
    })),
  );

  useEffect(() => {
    if (!enabled) return;
    const shape: Array<{ table: string; schema: string; event: string; filter: string | null }> =
      JSON.parse(tablesKey);
    if (!shape.length) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const triggerReload = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        void onChangeRef.current();
      }, debounceMs);
    };

    let channel = supabase.channel(channelName);
    shape.forEach((t, index) => {
      channel = channel.on(
        'postgres_changes',
        {
          event: t.event,
          schema: t.schema,
          table: t.table,
          ...(t.filter ? { filter: t.filter } : {}),
        } as never,
        (payload: RealtimeChangePayload) => {
          const matcher = tablesRef.current?.[index]?.match;
          if (matcher && !matcher(payload)) return;
          triggerReload();
        },
      );
    });
    channel.subscribe();

    const handleFocus = () => triggerReload();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') triggerReload();
    };

    if (refreshOnFocus) {
      window.addEventListener('focus', handleFocus);
      document.addEventListener('visibilitychange', handleVisibility);
    }

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      if (refreshOnFocus) {
        window.removeEventListener('focus', handleFocus);
        document.removeEventListener('visibilitychange', handleVisibility);
      }
      void supabase.removeChannel(channel);
    };
  }, [channelName, tablesKey, enabled, debounceMs, refreshOnFocus]);
}
