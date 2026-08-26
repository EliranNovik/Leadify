export type LeadCurrencyCatalogRow = {
  id?: string | number | null;
  name?: string | null;
  iso_code?: string | null;
};

const FALLBACK_SYMBOL_BY_ID: Record<number, string> = {
  1: '₪',
  2: '€',
  3: '$',
  4: '£',
};

export function parseLeadCurrencyId(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'string' ? parseInt(value, 10) : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function joinRecord(join: unknown): { id?: unknown; name?: unknown } | null {
  if (!join) return null;
  const rec = Array.isArray(join) ? join[0] : join;
  if (!rec || typeof rec !== 'object') return null;
  return rec as { id?: unknown; name?: unknown };
}

/**
 * Resolve the lead total-value currency from `currency_id`.
 * Do not trust a stale `accounting_currencies` join unless its id matches.
 * Never silently fall back to currency 1 when a different id is set — that
 * is what made the header flicker ₪ vs $ after a DB currency change.
 */
export function resolveLeadCurrencyName(
  currencyId: unknown,
  join: unknown,
  catalog?: LeadCurrencyCatalogRow[] | null,
): string {
  const id = parseLeadCurrencyId(currencyId) ?? 1;
  const rec = joinRecord(join);
  const joinId = parseLeadCurrencyId(rec?.id);
  const joinName = typeof rec?.name === 'string' ? rec.name.trim() : '';

  if (joinName && joinId === id) return joinName;

  const fromCatalog = (catalog || []).find((row) => parseLeadCurrencyId(row.id) === id);
  if (fromCatalog?.name?.trim()) return fromCatalog.name.trim();

  return FALLBACK_SYMBOL_BY_ID[id] || '';
}
