import { useCallback, useEffect, useRef, useState } from 'react';
import { searchLeads, type CombinedLead } from '../lib/legacyLeadsApi';
import { dedupeLeadContactSearchResults } from '../lib/leadContactSearchUi';
import { getRecentLeads } from '../lib/recentSearchStorage';
import {
  looksLikePhoneSearchQuery,
  phoneDigitsOnly,
  phoneDigitsPrefixMatch,
} from '../lib/phoneSearchUtils';

type Options = {
  enabled?: boolean;
  pause?: boolean;
  minLength?: number;
  limit?: number;
  debounceMs?: number;
};

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: string }).name;
  return name === 'AbortError' || name === 'AbortedError';
}

function isPhoneLikeQuery(query: string): boolean {
  return looksLikePhoneSearchQuery(query);
}

function isEmailLikeQuery(query: string): boolean {
  return query.trim().includes('@');
}

function emailFieldMatchesQuery(email: string | null | undefined, q: string): boolean {
  const value = String(email || '').trim().toLowerCase();
  if (!value || !q) return false;
  return value.includes(q) || value.startsWith(q) || q.startsWith(value);
}

/** Wait until 4 digits before searching 0… / 5… (same idea as minLength 2 for names). */
function isPartialPhonePrefix(query: string): boolean {
  const t = query.trim();
  const d = phoneDigitsOnly(t);
  if (!/^[0-9+\s\-().]+$/.test(t) || d.length >= 4) return false;
  return d.startsWith('0') || d.startsWith('5') || d.startsWith('972') || d.startsWith('00972');
}

/** Same narrowing as names/leads: keep rows that still match what is typed. */
function filterLeadsForQuery(rows: CombinedLead[], query: string): CombinedLead[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const qDigits = phoneDigitsOnly(query);
  const phoneQuery = isPhoneLikeQuery(query);
  const emailQuery = isEmailLikeQuery(query);

  return rows.filter((lead) => {
    if (phoneQuery && qDigits.length >= 4) {
      return (
        phoneDigitsPrefixMatch(lead.phone || '', qDigits) ||
        phoneDigitsPrefixMatch(lead.mobile || '', qDigits)
      );
    }
    if (emailQuery) {
      return emailFieldMatchesQuery(lead.email, q);
    }
    const hay = [
      lead.name,
      lead.contactName,
      lead.email,
      lead.lead_number,
      lead.manual_id,
      lead.phone,
      lead.mobile,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (!hay) return false;
    if (hay.includes(q)) return true;
    const tokens = q.split(/[\s,]+/).filter((t) => t.length >= 2);
    if (tokens.length >= 2) {
      return tokens.every(
        (t) => hay.includes(t) || hay.split(/[\s,./@+-]+/).some((part) => part.startsWith(t)),
      );
    }
    return hay.split(/[\s,./@+-]+/).some((part) => part.startsWith(q));
  });
}

function emptyCombinedLead(partial: Pick<CombinedLead, 'id' | 'lead_number' | 'name' | 'lead_type'>): CombinedLead {
  return {
    id: partial.id,
    lead_number: partial.lead_number,
    name: partial.name,
    email: '',
    phone: '',
    mobile: '',
    topic: '',
    stage: '',
    source: '',
    created_at: '',
    updated_at: '',
    notes: '',
    special_notes: '',
    next_followup: '',
    probability: '',
    category: '',
    language: '',
    balance: '',
    lead_type: partial.lead_type,
    unactivation_reason: null,
    deactivate_note: null,
    isFuzzyMatch: false,
  };
}

function recentLeadsMatching(query: string): CombinedLead[] {
  const rows = getRecentLeads().map((r) =>
    emptyCombinedLead({
      id: r.id,
      lead_number: r.lead_number || r.id,
      name: r.name || '',
      lead_type: r.lead_type === 'legacy' ? 'legacy' : 'new',
    }),
  );
  return filterLeadsForQuery(rows, query);
}

type PrefixCacheEntry = { q: string; rows: CombinedLead[] };
const prefixCache: PrefixCacheEntry[] = [];
const PREFIX_CACHE_MAX = 24;

function rememberPrefix(q: string, rows: CombinedLead[]) {
  const key = q.trim().toLowerCase();
  if (!key || rows.length === 0) return;
  const idx = prefixCache.findIndex((e) => e.q === key);
  if (idx >= 0) prefixCache.splice(idx, 1);
  prefixCache.unshift({ q: key, rows });
  if (prefixCache.length > PREFIX_CACHE_MAX) prefixCache.pop();
}

function instantFromPrefixCache(query: string): CombinedLead[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const queryIsEmail = isEmailLikeQuery(q);
  let best: CombinedLead[] = [];
  let bestLen = -1;
  for (const entry of prefixCache) {
    // Name hits (often missing legacy contact emails) must not drive email queries.
    if (queryIsEmail !== isEmailLikeQuery(entry.q)) continue;
    if (q.startsWith(entry.q) && entry.q.length > bestLen) {
      const narrowed = filterLeadsForQuery(entry.rows, query);
      if (narrowed.length > 0) {
        best = narrowed;
        bestLen = entry.q.length;
      }
    } else if (entry.q.startsWith(q) && q.length > bestLen) {
      const narrowed = filterLeadsForQuery(entry.rows, query);
      if (narrowed.length > 0) {
        best = narrowed;
        bestLen = q.length;
      }
    }
  }
  return best;
}

function mergeInstantHits(primary: CombinedLead[], extra: CombinedLead[]): CombinedLead[] {
  const seen = new Set(primary.map((r) => `${r.lead_type}:${r.id}`));
  const out = [...primary];
  for (const row of extra) {
    const key = `${row.lead_type}:${row.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function instantHitsForQuery(query: string): CombinedLead[] {
  return mergeInstantHits(instantFromPrefixCache(query), recentLeadsMatching(query));
}

export function useLeadContactSearch(query: string, options: Options = {}) {
  const {
    enabled = true,
    pause = false,
    minLength = 1,
    limit = 20,
    debounceMs = 40,
  } = options;

  const [results, setResults] = useState<CombinedLead[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<number | null>(null);
  const emptySettleRef = useRef<number | null>(null);
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const resultsRef = useRef<CombinedLead[]>([]);
  const queryRef = useRef(query.trim());
  const lastFetchedQueryRef = useRef('');
  const inFlightRef = useRef(false);
  const inFlightQueryRef = useRef('');
  const pendingQueryRef = useRef('');
  resultsRef.current = results;
  queryRef.current = query.trim();

  const trimmedQuery = query.trim();

  const clearEmptySettle = useCallback(() => {
    if (emptySettleRef.current != null) {
      window.clearTimeout(emptySettleRef.current);
      emptySettleRef.current = null;
    }
  }, []);

  const applyRows = useCallback((fetchedQuery: string, rows: CombinedLead[]) => {
    const current = queryRef.current;
    const fetched = fetchedQuery.trim();
    rememberPrefix(fetched, rows);

    const currentEmail = isEmailLikeQuery(current);
    const fetchedEmail = isEmailLikeQuery(fetched);

    if (current && fetched && current !== fetched) {
      // A slower name search must not replace the in-progress email query.
      if (currentEmail && !fetchedEmail) return;

      const matching = filterLeadsForQuery(rows, current);
      if (matching.length === 0) return;

      const instant = instantHitsForQuery(current);
      const merged = mergeInstantHits(matching, instant);
      resultsRef.current = merged;
      if (current.toLowerCase().startsWith(fetched.toLowerCase()) && currentEmail === fetchedEmail) {
        lastFetchedQueryRef.current = fetched;
      }
      setResults(merged);
      return;
    }

    lastFetchedQueryRef.current = fetched;
    const instant = current ? instantHitsForQuery(current) : [];
    const merged = mergeInstantHits(rows, instant);
    if (merged.length > 0) {
      resultsRef.current = merged;
      setResults(merged);
      return;
    }
    const keep = filterLeadsForQuery(resultsRef.current, current || fetched);
    if (keep.length > 0) {
      resultsRef.current = keep;
      setResults(keep);
      return;
    }
    emptySettleRef.current = window.setTimeout(() => {
      emptySettleRef.current = null;
      if (queryRef.current !== (current || fetched)) return;
      if (pendingQueryRef.current !== (current || fetched)) return;
      resultsRef.current = [];
      setResults([]);
    }, 180);
  }, []);

  const refresh = useCallback(async (searchQuery: string) => {
    const trimmed = searchQuery.trim();
    pendingQueryRef.current = trimmed;

    if (!enabled || pause || trimmed.length < minLength) {
      clearEmptySettle();
      if (!pause && (!enabled || trimmed.length < minLength)) {
        abortRef.current?.abort();
        abortRef.current = null;
        inFlightRef.current = false;
        setResults([]);
        setLoading(false);
      }
      return;
    }

    if (inFlightRef.current) {
      // The typed query moved on: cancel the stale request so the loop picks up
      // `trimmed` now instead of waiting out its full timeout budget.
      if (inFlightQueryRef.current !== trimmed) abortRef.current?.abort();
      return;
    }
    inFlightRef.current = true;

    try {
      while (true) {
        const q = pendingQueryRef.current;
        if (!enabled || pause || q.length < minLength) break;

        const requestId = ++requestIdRef.current;
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        abortRef.current = controller;
        inFlightQueryRef.current = q;
        clearEmptySettle();
        if (resultsRef.current.length === 0) setLoading(true);

        try {
          const data = await searchLeads(q, {
            limit: q.length <= 2 ? Math.min(limit, 12) : limit,
            signal: controller?.signal,
            timeoutMs: isEmailLikeQuery(q) ? 2800 : q.length <= 2 ? 900 : 1500,
          });
          if (controller?.signal.aborted) {
            if (pendingQueryRef.current !== q) continue;
            break;
          }
          const next = dedupeLeadContactSearchResults(data, q);
          applyRows(q, next);
        } catch (e) {
          lastFetchedQueryRef.current = q;
          if (isAbortError(e)) {
            if (pendingQueryRef.current !== q) continue;
            break;
          }
          if (requestId === requestIdRef.current) {
            console.error('lead contact search', e);
          }
        }

        if (pendingQueryRef.current === q) break;
      }
    } finally {
      inFlightRef.current = false;
      inFlightQueryRef.current = '';
      if (resultsRef.current.length > 0 || pendingQueryRef.current.length < minLength) {
        setLoading(false);
      }
    }

    const leftover = pendingQueryRef.current;
    if (
      enabled &&
      !pause &&
      leftover.length >= minLength &&
      leftover !== lastFetchedQueryRef.current &&
      !inFlightRef.current
    ) {
      void refresh(leftover);
    } else {
      setLoading(false);
    }
  }, [applyRows, clearEmptySettle, enabled, limit, minLength, pause]);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);

    if (pause) {
      if (trimmedQuery.length >= minLength && resultsRef.current.length === 0) setLoading(true);
      return;
    }

    if (!enabled || trimmedQuery.length < minLength || isPartialPhonePrefix(trimmedQuery)) {
      abortRef.current?.abort();
      abortRef.current = null;
      pendingQueryRef.current = '';
      clearEmptySettle();
      requestIdRef.current += 1;
      if (trimmedQuery.length < minLength) {
        lastFetchedQueryRef.current = '';
        setResults([]);
      }
      setLoading(false);
      return;
    }

    const prevQ = lastFetchedQueryRef.current.trim().toLowerCase();
    const nextQ = trimmedQuery.toLowerCase();
    const queryIsEmail = isEmailLikeQuery(nextQ);
    const prevIsEmail = isEmailLikeQuery(prevQ);
    const crossedIntoEmail = queryIsEmail && !prevIsEmail;

    const instant = instantHitsForQuery(trimmedQuery);
    if (instant.length > 0 && !crossedIntoEmail) {
      resultsRef.current = instant;
      setResults(instant);
      setLoading(false);
    }

    const prior = resultsRef.current.length > 0 ? resultsRef.current : instant;

    if (crossedIntoEmail) {
      if (instant.length > 0) {
        resultsRef.current = instant;
        setResults(instant);
        setLoading(false);
      } else {
        setLoading(true);
      }
    } else if (prior.length > 0 && (prevQ || instant.length > 0)) {
      if (!prevQ || nextQ.startsWith(prevQ) || prevQ.startsWith(nextQ) || isPhoneLikeQuery(trimmedQuery)) {
        const narrowed = filterLeadsForQuery(prior, trimmedQuery);
        const shown = mergeInstantHits(narrowed, instant);
        if (shown.length > 0) {
          resultsRef.current = shown;
          setResults(shown);
          setLoading(false);
        } else if (instant.length === 0) {
          setLoading(true);
        }
      }
    } else if (prior.length === 0) {
      setLoading(true);
    }

    const waitMs = queryIsEmail
      ? Math.max(debounceMs, 90)
      : instant.length > 0 || resultsRef.current.length > 0
        ? debounceMs
        : 0;
    debounceRef.current = window.setTimeout(() => {
      void refresh(trimmedQuery);
    }, waitMs);

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [clearEmptySettle, debounceMs, enabled, minLength, pause, trimmedQuery, refresh]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      clearEmptySettle();
    };
  }, [clearEmptySettle]);

  return { results, loading, refresh };
}
