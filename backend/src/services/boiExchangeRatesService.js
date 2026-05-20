const supabase = require('../config/supabase');

const BOI_EXR_API_URL =
  'https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/EXR/1.0/';

const DEFAULT_BASE_CURRENCIES = ['USD', 'EUR', 'GBP', 'CHF', 'CAD', 'AUD'];
const CURRENCY_RATES_SOURCE = 'bank_of_israel';

function parseBaseCurrenciesList(raw) {
  if (!raw || !String(raw).trim()) return [...DEFAULT_BASE_CURRENCIES];
  const list = String(raw)
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter((c) => /^[A-Z]{3}$/.test(c));
  return list.length > 0 ? list : [...DEFAULT_BASE_CURRENCIES];
}

function parseBoiExrCsv(csvText) {
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

  const rows = [];
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

function buildBoiExrUrl(baseCurrencies, lastObservations = 1) {
  const params = new URLSearchParams();
  params.set('c[BASE_CURRENCY]', baseCurrencies.join(','));
  params.set('c[COUNTER_CURRENCY]', 'ILS');
  params.set('c[DATA_TYPE]', 'OF00');
  params.set('format', 'csv');
  params.set('lastNObservations', String(lastObservations));
  return `${BOI_EXR_API_URL}?${params.toString()}`;
}

async function fetchBoiRepresentativeRates(baseCurrencies, lastObservations = 1) {
  const url = buildBoiExrUrl(baseCurrencies, lastObservations);
  const res = await fetch(url, { headers: { Accept: 'text/csv' } });
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

async function upsertRates(rows) {
  const { data, error } = await supabase
    .from('boi_exchange_rates')
    .upsert(rows, { onConflict: 'rate_date,base_currency,target_currency,source' })
    .select('id, rate_date, base_currency, target_currency, rate');

  if (error) throw error;
  return data ?? [];
}

/**
 * Fetch latest BOI representative rates and upsert into boi_exchange_rates.
 * @param {{ currencies?: string[], dryRun?: boolean }} [options]
 */
async function syncBoiExchangeRates(options = {}) {
  const baseCurrencies = Array.isArray(options.currencies) && options.currencies.length > 0
    ? options.currencies.map((c) => String(c).trim().toUpperCase()).filter((c) => /^[A-Z]{3}$/.test(c))
    : parseBaseCurrenciesList(process.env.BOI_BASE_CURRENCIES);

  const rows = await fetchBoiRepresentativeRates(baseCurrencies, 1);

  if (options.dryRun) {
    return { dryRun: true, fetched: rows.length, rates: rows };
  }

  const saved = await upsertRates(rows);
  return { fetched: rows.length, saved: saved.length, rates: saved };
}

async function getLatestRates(rateDate = null) {
  if (rateDate) {
    const { data, error } = await supabase
      .from('boi_exchange_rates')
      .select('*')
      .eq('rate_date', rateDate)
      .order('base_currency');
    if (error) throw error;
    return data ?? [];
  }

  const { data, error } = await supabase.rpc('get_boi_exchange_rates_for_date', {
    p_rate_date: null,
  });
  if (error) throw error;
  return data ?? [];
}

module.exports = {
  syncBoiExchangeRates,
  getLatestRates,
  fetchBoiRepresentativeRates,
  parseBaseCurrenciesList,
  DEFAULT_BASE_CURRENCIES,
};
