import { useCallback, useEffect, useRef, useState } from 'react';
import { searchLeads, type CombinedLead } from '../lib/legacyLeadsApi';
import { dedupeLeadContactSearchResults } from '../lib/leadContactSearchUi';

type Options = {
  enabled?: boolean;
  minLength?: number;
  limit?: number;
  debounceMs?: number;
};

export function useLeadContactSearch(query: string, options: Options = {}) {
  const {
    enabled = true,
    minLength = 2,
    limit = 20,
    debounceMs = 180,
  } = options;

  const [results, setResults] = useState<CombinedLead[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<number | null>(null);
  const requestIdRef = useRef(0);
  const resultsRef = useRef<CombinedLead[]>([]);
  resultsRef.current = results;

  // Trim so trailing spaces don't re-fire the same search with different races.
  const trimmedQuery = query.trim();

  const refresh = useCallback(async (searchQuery: string) => {
    const trimmed = searchQuery.trim();
    if (!enabled || trimmed.length < minLength) {
      setResults([]);
      setLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    // Only show spinner when there is nothing to keep visible — otherwise result
    // buttons unmount mid-click and the click never fires.
    if (resultsRef.current.length === 0) {
      setLoading(true);
    }

    try {
      const data = await searchLeads(trimmed, { limit });
      if (requestId !== requestIdRef.current) return;
      setResults(dedupeLeadContactSearchResults(data, trimmed));
    } catch (e) {
      if (requestId !== requestIdRef.current) return;
      console.error('lead contact search', e);
      setResults([]);
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [enabled, limit, minLength]);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);

    if (!enabled || trimmedQuery.length < minLength) {
      setResults([]);
      setLoading(false);
      return;
    }

    // Do not set loading=true here: that would replace the result list with a
    // spinner during debounce and steal clicks from result rows.
    debounceRef.current = window.setTimeout(() => {
      void refresh(trimmedQuery);
    }, debounceMs);

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [debounceMs, enabled, minLength, trimmedQuery, refresh]);

  return { results, loading, refresh };
}
