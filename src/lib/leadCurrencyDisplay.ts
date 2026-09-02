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

const CODE_TO_ICON: Record<string, string> = {
  USD: '$',
  US$: '$',
  EUR: '€',
  GBP: '£',
  NIS: '₪',
  ILS: '₪',
};

/** Same icons as the Clients header total-value badge (₪ $ € £). */
export function toLeadCurrencyIcon(currency?: string | number | null, currencyId?: number | null): string {
  const id = parseLeadCurrencyId(currencyId ?? (typeof currency === 'number' ? currency : null));
  if (id && FALLBACK_SYMBOL_BY_ID[id]) return FALLBACK_SYMBOL_BY_ID[id];
  const raw = String(currency ?? '').trim();
  if (!raw) return '₪';
  if (['₪', '$', '€', '£'].includes(raw)) return raw;
  return CODE_TO_ICON[raw.toUpperCase()] || FALLBACK_SYMBOL_BY_ID[parseLeadCurrencyId(raw) || 0] || '₪';
}

export function formatLeadMoneyAmount(amount: number, currency?: string | number | null, currencyId?: number | null): string {
  const symbol = toLeadCurrencyIcon(currency, currencyId);
  return `${symbol}${Math.round(amount).toLocaleString('en-US')}`;
}

/** Clients header: total value minus subcontractor fee (never below 0). */
export function netLeadTotalAfterSubcontractorFee(gross: number, subcontractorFee?: number | null): number {
  const fee = Number(subcontractorFee);
  const reduction = Number.isFinite(fee) && fee > 0 ? fee : 0;
  return Math.max(0, (Number(gross) || 0) - reduction);
}

/** Turn USD / EUR / NIS / ILS / GBP next to amounts into the Clients badge icons. */
export function formatChatCurrencyText(text: string): string {
  return String(text || '').replace(
    /\b(USD|US\$|EUR|GBP|NIS|ILS)\s*(?=[\d])|(?<=[\d.,])\s*(USD|EUR|GBP|NIS|ILS)\b/gi,
    (match) => {
      const code = match.replace(/[^A-Za-z$]/g, '').toUpperCase();
      return CODE_TO_ICON[code] || match;
    },
  );
}
