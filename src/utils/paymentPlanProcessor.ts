import { convertToNIS } from '../lib/currencyConversion';
import type { BoiDateRateConverter } from '../lib/boiCurrencyConversion';
import { toDateOnlyKey } from '../lib/boiCurrencyConversion';

const normalizePaymentCurrency = (currency: string | undefined): string => {
    const c = currency || 'NIS';
    if (c === '₪') return 'NIS';
    if (c === '€') return 'EUR';
    if (c === '$') return 'USD';
    if (c === '£') return 'GBP';
    return c;
};

/**
 * Process new payment plans and convert to NIS
 * Returns a map of lead_id -> total amount in NIS
 */
export const processNewPayments = (payments: any[]): Map<string, number> => {
    const paymentsMap = new Map<string, number>();

    payments.forEach((payment: any) => {
        const leadId = payment.lead_id;
        // Use value only (no VAT) - same as modal logic
        const value = Number(payment.value || 0);
        const currency = payment.currency || '₪';

        // Normalize currency for conversion
        const normalizedCurrency = currency === '₪' ? 'NIS' :
            currency === '€' ? 'EUR' :
                currency === '$' ? 'USD' :
                    currency === '£' ? 'GBP' : currency;

        // Convert value to NIS
        const amountNIS = convertToNIS(value, normalizedCurrency);
        const current = paymentsMap.get(leadId) || 0;
        paymentsMap.set(leadId, current + amountNIS);
    });

    return paymentsMap;
};

/**
 * Process new payment plans with BOI rate on due_date.
 */
export const processNewPaymentsAsync = async (
    payments: any[],
    converter: BoiDateRateConverter,
): Promise<Map<string, number>> => {
    const paymentsMap = new Map<string, number>();

    for (const payment of payments) {
        const leadId = payment.lead_id;
        const value = Number(payment.value || 0);
        const normalizedCurrency = normalizePaymentCurrency(payment.currency);
        const dueDate = toDateOnlyKey(payment.due_date);
        const amountNIS = await converter.toNis(value, normalizedCurrency, dueDate);
        const current = paymentsMap.get(leadId) || 0;
        paymentsMap.set(leadId, current + amountNIS);
    }

    return paymentsMap;
};

/**
 * Process legacy payment plans and convert to NIS
 * Returns a map of lead_id -> total amount in NIS
 */
export const processLegacyPayments = (payments: any[], legacyLeadsMap?: Map<number, any>): Map<number, number> => {
    const paymentsMap = new Map<number, number>();

    payments.forEach((payment: any) => {
        const leadId = Number(payment.lead_id);
        // Use value only (no VAT) - same as modal logic
        const value = Number(payment.value || payment.value_base || 0);

        // Get currency (same as modal logic)
        const accountingCurrency: any = payment.accounting_currencies
            ? (Array.isArray(payment.accounting_currencies) ? payment.accounting_currencies[0] : payment.accounting_currencies)
            : null;
        let currency = '₪';
        if (accountingCurrency?.name) {
            currency = accountingCurrency.name;
        } else if (accountingCurrency?.iso_code) {
            currency = accountingCurrency.iso_code;
        } else if (payment.currency_id) {
            switch (payment.currency_id) {
                case 1: currency = '₪'; break;
                case 2: currency = '€'; break;
                case 3: currency = '$'; break;
                case 4: currency = '£'; break;
                default: currency = '₪'; break;
            }
        } else if (legacyLeadsMap) {
            // Fallback to lead's currency if payment currency not available
            const lead = legacyLeadsMap.get(leadId);
            currency = lead?.accounting_currencies?.iso_code || '₪';
        }

        // Normalize currency for conversion
        const normalizedCurrency = currency === '₪' ? 'NIS' :
            currency === '€' ? 'EUR' :
                currency === '$' ? 'USD' :
                    currency === '£' ? 'GBP' : currency;

        // Convert value to NIS
        const amountNIS = convertToNIS(value, normalizedCurrency);
        const current = paymentsMap.get(leadId) || 0;
        paymentsMap.set(leadId, current + amountNIS);
    });

    return paymentsMap;
};

/**
 * Process legacy payment plans with BOI rate on due_date.
 */
export const processLegacyPaymentsAsync = async (
    payments: any[],
    converter: BoiDateRateConverter,
    legacyLeadsMap?: Map<number, any>,
): Promise<Map<number, number>> => {
    const paymentsMap = new Map<number, number>();

    for (const payment of payments) {
        const leadId = Number(payment.lead_id);
        const value = Number(payment.value || payment.value_base || 0);
        const currency = extractCurrencyFromLegacyPayment(payment, legacyLeadsMap?.get(leadId));
        const normalizedCurrency = normalizePaymentCurrency(currency);
        const dueDate = toDateOnlyKey(payment.due_date);
        const amountNIS = await converter.toNis(value, normalizedCurrency, dueDate);
        const current = paymentsMap.get(leadId) || 0;
        paymentsMap.set(leadId, current + amountNIS);
    }

    return paymentsMap;
};

/**
 * Extract currency from legacy payment accounting_currencies
 */
export const extractCurrencyFromLegacyPayment = (payment: any, fallbackLead?: any): string => {
    const accountingCurrency: any = payment.accounting_currencies
        ? (Array.isArray(payment.accounting_currencies) ? payment.accounting_currencies[0] : payment.accounting_currencies)
        : null;
    
    if (accountingCurrency?.name) {
        return accountingCurrency.name;
    } else if (accountingCurrency?.iso_code) {
        return accountingCurrency.iso_code;
    } else if (payment.currency_id) {
        switch (payment.currency_id) {
            case 1: return '₪';
            case 2: return '€';
            case 3: return '$';
            case 4: return '£';
            default: return '₪';
        }
    } else if (fallbackLead) {
        return fallbackLead?.accounting_currencies?.iso_code || '₪';
    }
    
    return '₪';
};
