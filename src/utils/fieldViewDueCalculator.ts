import { convertToNIS } from '../lib/currencyConversion';

/**
 * Calculate due amounts by category for field view
 * This is a pure function that takes payment data and lead category mappings
 */
export interface FieldViewDueInput {
    payments: Array<{
        lead_id: string | number;
        value: number;
        currency?: string;
        currency_id?: number;
        accounting_currencies?: any;
    }>;
    leadToCategoryMap: Map<string | number, string>;
}

/**
 * Calculate due amounts grouped by main category
 */
export const calculateFieldViewDueByCategory = (input: FieldViewDueInput): Map<string, number> => {
    const { payments, leadToCategoryMap } = input;
    const categoryDueMap = new Map<string, number>();

    payments.forEach((payment) => {
        const leadId = typeof payment.lead_id === 'string' ? payment.lead_id : payment.lead_id.toString();
        const numericLeadId = typeof payment.lead_id === 'number' ? payment.lead_id : Number(payment.lead_id);
        
        // Try both string and number keys
        let mainCategoryName = leadToCategoryMap.get(leadId) || 
                              leadToCategoryMap.get(numericLeadId) ||
                              leadToCategoryMap.get(String(payment.lead_id));
        
        if (!mainCategoryName) {
            // Debug: log unmapped payments
            console.warn('⚠️ Field View Due Calculator - Payment without category mapping:', {
                leadId: payment.lead_id,
                leadIdType: typeof payment.lead_id,
                value: payment.value,
                mapSize: leadToCategoryMap.size,
                mapKeysSample: Array.from(leadToCategoryMap.keys()).slice(0, 5)
            });
            return; // Skip if lead doesn't have a category mapping
        }

        // Get payment value
        const value = Number(payment.value || 0);
        
        // Determine currency
        let currency = '₪';
        if (payment.currency) {
            currency = payment.currency;
        } else if (payment.accounting_currencies) {
            const accountingCurrency = Array.isArray(payment.accounting_currencies) 
                ? payment.accounting_currencies[0] 
                : payment.accounting_currencies;
            if (accountingCurrency?.name) {
                currency = accountingCurrency.name;
            } else if (accountingCurrency?.iso_code) {
                currency = accountingCurrency.iso_code;
            }
        } else if (payment.currency_id) {
            switch (payment.currency_id) {
                case 1: currency = '₪'; break;
                case 2: currency = '€'; break;
                case 3: currency = '$'; break;
                case 4: currency = '£'; break;
                default: currency = '₪'; break;
            }
        }

        // Normalize currency
        const normalizedCurrency = currency === '₪' ? 'NIS' :
            currency === '€' ? 'EUR' :
                currency === '$' ? 'USD' :
                    currency === '£' ? 'GBP' : currency;

        // Convert to NIS
        const amountInNIS = convertToNIS(value, normalizedCurrency);

        // Add to category total
        const current = categoryDueMap.get(mainCategoryName) || 0;
        categoryDueMap.set(mainCategoryName, current + amountInNIS);
    });

    return categoryDueMap;
};
