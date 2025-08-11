// Contract pricing utility with volume discounts
// Israeli clients: NIS with VAT (18%)
// American/Other clients: USD without VAT

interface IsraeliPriceTier {
  minApplicants: number;
  maxApplicants: number;
  price: number; // Base price without VAT
  priceWithVat: number; // Price including 18% VAT
}

interface AmericanPriceTier {
  minApplicants: number;
  maxApplicants: number;
  price: number; // Price in USD
}

// Israeli pricing tiers (NIS with VAT)
const israeliPricing: IsraeliPriceTier[] = [
  { minApplicants: 1, maxApplicants: 1, price: 15000, priceWithVat: 17700 },
  { minApplicants: 2, maxApplicants: 2, price: 14000, priceWithVat: 16520 },
  { minApplicants: 3, maxApplicants: 3, price: 13500, priceWithVat: 15930 },
  { minApplicants: 4, maxApplicants: 4, price: 13000, priceWithVat: 15340 },
  { minApplicants: 5, maxApplicants: 5, price: 12500, priceWithVat: 14750 },
  { minApplicants: 6, maxApplicants: 10, price: 12000, priceWithVat: 14160 },
  { minApplicants: 11, maxApplicants: 15, price: 11500, priceWithVat: 13570 },
  { minApplicants: 16, maxApplicants: 20, price: 11000, priceWithVat: 12980 },
  { minApplicants: 21, maxApplicants: 999, price: 10500, priceWithVat: 12390 },
];

// American pricing tiers (USD without VAT)
const americanPricing: AmericanPriceTier[] = [
  { minApplicants: 1, maxApplicants: 1, price: 5000 },
  { minApplicants: 2, maxApplicants: 2, price: 4700 },
  { minApplicants: 3, maxApplicants: 3, price: 4500 },
  { minApplicants: 4, maxApplicants: 4, price: 4300 },
  { minApplicants: 5, maxApplicants: 5, price: 4100 },
  { minApplicants: 6, maxApplicants: 10, price: 3900 },
  { minApplicants: 11, maxApplicants: 15, price: 3700 },
  { minApplicants: 16, maxApplicants: 20, price: 3500 },
  { minApplicants: 21, maxApplicants: 999, price: 3300 },
];

/**
 * Get the price per applicant based on the number of applicants and client country
 * @param applicantCount - Number of applicants
 * @param isIsraeli - Whether the client is Israeli (affects currency and VAT)
 * @returns Price tier object with pricing information
 */
export function getPricePerApplicant(applicantCount: number, isIsraeli: boolean): IsraeliPriceTier | AmericanPriceTier {
  const pricing = isIsraeli ? israeliPricing : americanPricing;
  
  const tier = pricing.find(tier => 
    applicantCount >= tier.minApplicants && applicantCount <= tier.maxApplicants
  );
  
  if (!tier) {
    // Fallback to the highest tier if applicant count exceeds all tiers
    return pricing[pricing.length - 1];
  }
  
  return tier;
}

/**
 * Calculate total contract value based on applicant count and country
 * @param applicantCount - Number of applicants
 * @param isIsraeli - Whether the client is Israeli
 * @returns Total contract value
 */
export function calculateTotalContractValue(applicantCount: number, isIsraeli: boolean): number {
  const priceTier = getPricePerApplicant(applicantCount, isIsraeli);
  
  if (isIsraeli && 'priceWithVat' in priceTier) {
    return priceTier.priceWithVat * applicantCount;
  } else {
    return priceTier.price * applicantCount;
  }
}

/**
 * Generate payment plan based on total value (50/25/25 split)
 * @param totalValue - Total contract value
 * @param currency - Currency code (NIS or USD)
 * @returns Array of payment plan entries
 */
export function generatePaymentPlan(totalValue: number, currency: string) {
  const firstPayment = Math.round(totalValue * 0.5 * 100) / 100; // 50%
  const secondPayment = Math.round(totalValue * 0.25 * 100) / 100; // 25%
  const thirdPayment = Math.round((totalValue - firstPayment - secondPayment) * 100) / 100; // Remaining 25%
  
  const today = new Date();
  const thirtyDays = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
  const sixtyDays = new Date(today.getTime() + 60 * 24 * 60 * 60 * 1000);
  
  return [
    {
      due_percent: 50,
      due_date: today.toISOString().split('T')[0],
      value: firstPayment,
      value_vat: currency === '₪' ? Math.round(firstPayment * 0.18 * 100) / 100 : 0,
      payment_order: 'First Payment',
      notes: '50% of total contract value',
    },
    {
      due_percent: 25,
      due_date: thirtyDays.toISOString().split('T')[0],
      value: secondPayment,
      value_vat: currency === '₪' ? Math.round(secondPayment * 0.18 * 100) / 100 : 0,
      payment_order: 'Intermediate Payment',
      notes: '25% of total contract value',
    },
    {
      due_percent: 25,
      due_date: sixtyDays.toISOString().split('T')[0],
      value: thirdPayment,
      value_vat: currency === '₪' ? Math.round(thirdPayment * 0.18 * 100) / 100 : 0,
      payment_order: 'Final Payment',
      notes: 'Final 25% of total contract value',
    },
  ];
} 