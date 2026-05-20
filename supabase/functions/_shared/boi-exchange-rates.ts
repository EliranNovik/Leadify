/**
 * Bank of Israel representative exchange rates (EXR / OF00).
 * @see https://edge.boi.gov.il/ — BOI.STATISTICS/EXR/1.0
 */

export const BOI_EXR_API_URL =
  'https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/EXR/1.0/';

export const DEFAULT_BASE_CURRENCIES = ['USD', 'EUR', 'GBP', 'CHF', 'CAD', 'AUD'] as const;

export const CURRENCY_RATES_SOURCE = 'bank_of_israel';

export type BoiRateRow = {
  rate_date: string;
  base_currency: string;
  target_currency: string;
  rate: number;
  source: string;
};

export function parseBaseCurrenciesList(raw: string | undefined): string[] {
  if (!raw?.trim()) return [...DEFAULT_BASE_CURRENCIES];
  const list = raw
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter((c) => /^[A-Z]{3}$/.test(c));
  return list.length > 0 ? list : [...DEFAULT_BASE_CURRENCIES];
}

/** Minimal CSV parser (BOI returns standard comma-separated, no quoted commas in sample). */
export function parseBoiExrCsv(csvText: string): BoiRateRow[] {
  const lines = csvText.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map((h) => h.trim());
  const idx = {
    base: headers.indexOf('BASE_CURRENCY'),
    counter: headers.indexOf('COUNTER_CURRENCY'),
    period: headers.indexOf('TIME_PERIOD'),
    value: headers.indexOf('OBS_VALUE'),
  };
  if (idx.base < 0 || idx.counter < 0 || idx.period < 0 || idx.value < 0) {
    throw new Error(`Unexpected BOI CSV headers: ${headers.join(',')}`);
  }

  const rows: BoiRateRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const base = cols[idx.base]?.trim().toUpperCase();
    const target = cols[idx.counter]?.trim().toUpperCase();
    const rateDate = cols[idx.period]?.trim();
    const rateRaw = cols[idx.value]?.trim();
    if (!base || !target || !rateDate || !rateRaw) continue;

    const rate = Number(rateRaw);
    if (!Number.isFinite(rate) || rate <= 0) continue;

    rows.push({
      rate_date: rateDate,
      base_currency: base,
      target_currency: target,
      rate,
      source: CURRENCY_RATES_SOURCE,
    });
  }
  return rows;
}

export function buildBoiExrUrl(baseCurrencies: string[], lastObservations = 1): string {
  const bases = baseCurrencies.join(',');
  const params = new URLSearchParams();
  params.set('c[BASE_CURRENCY]', bases);
  params.set('c[COUNTER_CURRENCY]', 'ILS');
  params.set('c[DATA_TYPE]', 'OF00');
  params.set('format', 'csv');
  params.set('lastNObservations', String(lastObservations));
  return `${BOI_EXR_API_URL}?${params.toString()}`;
}

export async function fetchBoiRepresentativeRates(
  baseCurrencies: string[],
  lastObservations = 1,
): Promise<BoiRateRow[]> {
  const url = buildBoiExrUrl(baseCurrencies, lastObservations);
  const res = await fetch(url, {
    headers: { Accept: 'text/csv' },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`BOI API ${res.status}: ${text.slice(0, 400)}`);
  }
  const rows = parseBoiExrCsv(text);
  if (rows.length === 0) {
    throw new Error('BOI API returned no parseable rate rows');
  }
  return rows;
}
