const currencyIdToCode: Record<number, string> = {
  1: 'NIS',
  2: 'USD',
  3: 'EUR',
  4: 'GBP',
};

const currencySymbolMap: Record<string, string> = {
  ILS: '₪',
  NIS: '₪',
  USD: '$',
  EUR: '€',
  GBP: '£',
  AUD: 'A$',
  CAD: 'C$',
  CHF: 'CHF',
  JPY: '¥',
};

const normalizeCurrencyCode = (currency?: string | null): string | undefined => {
  if (!currency) return undefined;
  const trimmed = currency.toString().trim();
  if (!trimmed) return undefined;
  const upper = trimmed.toUpperCase();
  if (upper in currencySymbolMap) {
    return upper;
  }

  // Handle symbol inputs
  const symbolEntry = Object.entries(currencySymbolMap).find(([, symbol]) => symbol === trimmed);
  if (symbolEntry) {
    return symbolEntry[0];
  }

  return upper;
};

export const getCurrencySymbol = (currency?: string | null): string => {
  const code = normalizeCurrencyCode(currency);
  if (!code) {
    return '₪';
  }
  return currencySymbolMap[code] || currency || '₪';
};

export interface MeetingValueInput {
  leadBalance?: number | string | null;
  leadBalanceCurrency?: string | null;
  legacyTotal?: number | string | null;
  legacyCurrencyId?: number | null;
  legacyCurrencyCode?: string | null;
  meetingAmount?: number | string | null;
  meetingCurrency?: string | null;
}

export interface MeetingValueResult {
  amount: number;
  currencyCode: string;
  display: string;
}

const asNumber = (value?: number | string | null): number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const trimmed = value.toString().trim();
  if (!trimmed || trimmed === '--') return null;
  const parsed = Number(trimmed.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
};

export const formatMeetingValue = (input: MeetingValueInput): MeetingValueResult => {
  let amount = asNumber(input.leadBalance);
  let currencyCode = normalizeCurrencyCode(input.leadBalanceCurrency);

  if (amount === null || amount === 0) {
    const legacyAmount = asNumber(input.legacyTotal);
    if (legacyAmount !== null && legacyAmount !== 0) {
      amount = legacyAmount;
      currencyCode =
        normalizeCurrencyCode(input.legacyCurrencyCode) ||
        (input.legacyCurrencyId !== undefined && input.legacyCurrencyId !== null
          ? normalizeCurrencyCode(currencyIdToCode[input.legacyCurrencyId])
          : undefined);
    }
  }

  if (amount === null || amount === 0) {
    const meetingAmount = asNumber(input.meetingAmount);
    if (meetingAmount !== null && meetingAmount !== 0) {
      amount = meetingAmount;
      currencyCode = normalizeCurrencyCode(input.meetingCurrency) || currencyCode;
    }
  }

  if (amount === null || !Number.isFinite(amount)) {
    amount = 0;
  }

  if (!currencyCode) {
    currencyCode = 'NIS';
  }

  const symbol = getCurrencySymbol(currencyCode);

  return {
    amount,
    currencyCode,
    display: `${symbol}${Math.round(amount).toLocaleString()}`,
  };
};

