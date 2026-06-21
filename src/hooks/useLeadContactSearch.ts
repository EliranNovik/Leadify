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
    debounceMs = 300,
  } = options;

  const [results, setResults] = useState<CombinedLead[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<number | null>(null);
  const requestIdRef = useRef(0);

  const refresh = useCallback(async (searchQuery: string) => {
    const trimmed = searchQuery.trim();
    if (!enabled || trimmed.length < minLength) {
      setResults([]);
      setLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    setLoading(true);

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

    const trimmed = query.trim();
    if (!enabled || trimmed.length < minLength) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    debounceRef.current = window.setTimeout(() => {
      void refresh(trimmed);
    }, debounceMs);

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [debounceMs, enabled, minLength, query, refresh]);

  return { results, loading, refresh };
}
