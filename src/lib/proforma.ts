import { supabase } from './supabase';

/**
 * Generates a globally unique proforma name for the current year.
 * Format: 'YYYY-XX Proforma', where XX is the next available number for the year.
 */
export async function generateProformaName(): Promise<string> {
  const year = new Date().getFullYear();
  // Fetch all proformas for the year, across all leads
  const { data, error } = await supabase
    .from('payment_plans')
    .select('proforma')
    .not('proforma', 'is', null);

  if (error) throw error;

  // Extract proforma names for the current year
  const existingNames = (data || [])
    .map(row => row.proforma)
    .filter((proforma: any) => proforma && typeof proforma === 'string')
    .map((proforma: string) => {
      try {
        const parsed = JSON.parse(proforma);
        return parsed.proformaName || '';
      } catch {
        return '';
      }
    })
    .filter((name: string) => name.startsWith(`${year}-`));

  // Find the highest number
  let maxNumber = 0;
  existingNames.forEach(name => {
    const match = name.match(/-(\d+) /); // match e.g. 2024-01 Proforma
    if (match) {
      const num = parseInt(match[1]);
      if (num > maxNumber) maxNumber = num;
    }
  });

  // Generate next number
  const nextNumber = maxNumber + 1;
  return `${year}-${nextNumber.toString().padStart(2, '0')} Proforma`;
} 