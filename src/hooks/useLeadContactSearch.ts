import { useCallback, useEffect, useRef, useState } from 'react';
import { searchLeads, type CombinedLead } from '../lib/legacyLeadsApi';
import { dedupeLeadContactSearchResults } from '../lib/leadContactSearchUi';

type Options = {
  enabled?: boolean;
  minLength?: number;
  limit?: number;
  debounceMs?: number;
};

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  return (err as { name?: string }).name === 'AbortError';
}

export function useLeadContactSearch(query: string, options: Options = {}) {
  const {
    enabled = true,
    minLength = 2,
    limit = 20,
    debounceMs = 80,
  } = options;

  const [results, setResults] = useState<CombinedLead[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<number | null>(null);
  const emptySettleRef = useRef<number | null>(null);
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const resultsRef = useRef<CombinedLead[]>([]);
  const queryRef = useRef(query.trim());
  resultsRef.current = results;
  queryRef.current = query.trim();

  const trimmedQuery = query.trim();

  const clearEmptySettle = useCallback(() => {
    if (emptySettleRef.current != null) {
      window.clearTimeout(emptySettleRef.current);
      emptySettleRef.current = null;
    }
  }, []);

  const refresh = useCallback(async (searchQuery: string) => {
    const trimmed = searchQuery.trim();
    if (!enabled || trimmed.length < minLength) {
      abortRef.current?.abort();
      abortRef.current = null;
      clearEmptySettle();
      setResults([]);
      setLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    // Abort only the previous in-flight request when a new one actually starts —
    // not on every keystroke (that raced debounce and flickered the dropdown).
    abortRef.current?.abort();
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    abortRef.current = controller;
    clearEmptySettle();

    // Keep prior rows visible while the next request runs (stale-while-revalidate).
    setLoading(true);

    try {
      const data = await searchLeads(trimmed, {
        limit,
        signal: controller?.signal,
      });
      if (requestId !== requestIdRef.current || controller?.signal.aborted) return;

      const next = dedupeLeadContactSearchResults(data, trimmed);
      if (next.length > 0) {
        setResults(next);
        return;
      }

      // Empty hit: don't blank the list immediately (typing "dav" then "david"
      // was flashing empty → results). Only commit empty after a short settle
      // if this query is still current.
      emptySettleRef.current = window.setTimeout(() => {
        emptySettleRef.current = null;
        if (requestId !== requestIdRef.current) return;
        if (queryRef.current !== trimmed) return;
        setResults([]);
      }, 220);
    } catch (e) {
      if (requestId !== requestIdRef.current || isAbortError(e) || controller?.signal.aborted) {
        return;
      }
      console.error('lead contact search', e);
      // Keep previous results on error — don't collapse the dropdown.
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [clearEmptySettle, enabled, limit, minLength]);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);

    if (!enabled || trimmedQuery.length < minLength) {
      abortRef.current?.abort();
      abortRef.current = null;
      clearEmptySettle();
      requestIdRef.current += 1;
      setResults([]);
      setLoading(false);
      return;
    }

    // Do not abort in-flight search here — only clear the debounce timer.
    // Aborting on every keystroke cancelled work and caused open/close flicker.
    debounceRef.current = window.setTimeout(() => {
      void refresh(trimmedQuery);
    }, debounceMs);

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [clearEmptySettle, debounceMs, enabled, minLength, trimmedQuery, refresh]);

  // Abort only on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      clearEmptySettle();
    };
  }, [clearEmptySettle]);

  return { results, loading, refresh };
}
