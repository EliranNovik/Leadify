// Currency conversion utility
// This file provides smart currency conversion functionality for the application

// Currency conversion rates (you can make this dynamic by fetching from an API)
export const currencyRates = {
  'USD': 3.7,  // 1 USD = 3.7 NIS (approximate)
  'EUR': 4.0,  // 1 EUR = 4.0 NIS (approximate)
  'GBP': 4.7,  // 1 GBP = 4.7 NIS (approximate)
  'NIS': 1,    // 1 NIS = 1 NIS
  '₪': 1,      // 1 ₪ = 1 NIS
  'ILS': 1     // 1 ILS = 1 NIS
};

// Currency ID to symbol mapping (based on the database structure)
export const currencyIdToSymbol = {
  1: '₪',   // NIS
  2: '€',   // EUR
  3: '$',   // USD
  4: '£'    // GBP
};

// Currency ID to code mapping
export const currencyIdToCode = {
  1: 'NIS',
  2: 'EUR', 
  3: 'USD',
  4: 'GBP'
};

/**
 * Convert any currency amount to NIS
 * @param amount - The amount to convert
 * @param currency - The currency (can be symbol, code, or ID)
 * @returns The amount converted to NIS
 */
export const convertToNIS = (amount: number, currency: string | number | null | undefined): number => {
  if (!amount || amount <= 0) return 0;
  
  let currencyCode = '';
  
  // Handle different currency input types
  if (typeof currency === 'number') {
    // Currency ID (1, 2, 3, 4)
    currencyCode = currencyIdToCode[currency as keyof typeof currencyIdToCode] || 'NIS';
  } else if (typeof currency === 'string') {
    // Currency symbol or code
    currencyCode = currency.toUpperCase().trim();
  } else {
    // Default to NIS if currency is null/undefined
    currencyCode = 'NIS';
  }
  
  const rate = currencyRates[currencyCode as keyof typeof currencyRates] || 1;
  return amount * rate;
};

/**
 * Get currency symbol from currency ID
 * @param currencyId - The currency ID (1, 2, 3, 4)
 * @returns The currency symbol
 */
export const getCurrencySymbol = (currencyId: string | number | null | undefined): string => {
  if (typeof currencyId === 'number') {
    return currencyIdToSymbol[currencyId as keyof typeof currencyIdToSymbol] || '₪';
  } else if (typeof currencyId === 'string') {
    const id = parseInt(currencyId);
    return currencyIdToSymbol[id as keyof typeof currencyIdToSymbol] || '₪';
  }
  return '₪'; // Default to NIS
};

/**
 * Get currency code from currency ID
 * @param currencyId - The currency ID (1, 2, 3, 4)
 * @returns The currency code
 */
export const getCurrencyCode = (currencyId: string | number | null | undefined): string => {
  if (typeof currencyId === 'number') {
    return currencyIdToCode[currencyId as keyof typeof currencyIdToCode] || 'NIS';
  } else if (typeof currencyId === 'string') {
    const id = parseInt(currencyId);
    return currencyIdToCode[id as keyof typeof currencyIdToCode] || 'NIS';
  }
  return 'NIS'; // Default to NIS
};

/**
 * Format currency amount with proper symbol and conversion to NIS
 * @param amount - The amount to format
 * @param currencyId - The currency ID
 * @param showOriginalCurrency - Whether to show original currency in parentheses
 * @returns Formatted currency string
 */
export const formatCurrencyWithConversion = (
  amount: number, 
  currencyId: string | number | null | undefined,
  showOriginalCurrency: boolean = false
): string => {
  const convertedAmount = convertToNIS(amount, currencyId);
  const originalSymbol = getCurrencySymbol(currencyId);
  const originalCode = getCurrencyCode(currencyId);
  
  const formattedAmount = Math.ceil(convertedAmount).toLocaleString('en-US', { maximumFractionDigits: 0 });
  
  if (showOriginalCurrency && originalCode !== 'NIS') {
    return `₪${formattedAmount} (${originalSymbol}${Math.ceil(amount).toLocaleString('en-US', { maximumFractionDigits: 0 })})`;
  }
  
  return `₪${formattedAmount}`;
};

/**
 * Calculate total revenue from an array of items with currency conversion
 * @param items - Array of items with amount and currency
 * @returns Total revenue in NIS
 */
export const calculateTotalRevenueInNIS = (items: Array<{ amount: number; currency?: string | number | null }>): number => {
  return items.reduce((total, item) => {
    return total + convertToNIS(item.amount, item.currency);
  }, 0);
};
