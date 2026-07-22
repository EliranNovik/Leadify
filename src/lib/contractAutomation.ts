import { supabase } from './supabase';
// NOTE: Payment plan automation disabled intentionally.
// import { generateProformaName } from './proforma'; // Removed - no longer needed for automatic proforma creation

interface Contract {
  id: string;
  client_id: string; // Changed from number to string (UUID)
  template_id: string;
  applicant_count: number;
  client_country: string;
  status: string;
  signed_at?: string;
  total_amount?: number;
  contact_id?: number;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  contact_mobile?: string;
  custom_pricing?: {
    payment_plan: {
      percent: number;
      due_date: string;
      value: number;
      value_vat: number;
      label: string;
      payment_order: string;
      notes: string;
    }[];
    currency: string;
  };
}

/**
 * Handle contract signing event - automatically create payment plan and proforma
 * @param contract - The signed contract data
 */
export async function handleContractSigned(contract: Contract) {
  try {
    console.log('handleContractSigned: payment plan automation is disabled. No action taken.', {
      contractId: contract?.id,
    });
    return;
  } catch (error) {
    console.error('Error in contract signing automation:', error);
    throw error;
  }
}

/**
 * Get contract details by ID
 * @param contractId - Contract ID
 * @returns Contract data with template information
 */
export async function getContractDetails(contractId: string) {
  try {
    const { data, error } = await supabase
      .from('contracts')
      .select(`
        *,
        contract_templates (
          id,
          name,
          content
        ),
        leads (
          id,
          name,
          email,
          phone
        )
      `)
      .eq('id', contractId)
      .single();
    
    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error fetching contract details:', error);
    throw error;
  }
}

/**
 * Get all contracts for a client
 * @param clientId - New-lead UUID, or legacy id (`legacy_123` / `123`)
 * @returns Array of contracts
 */
export async function getClientContracts(clientId: string) {
  try {
    const raw = String(clientId || '').trim();
    if (!raw) return [];

    const isLegacy =
      raw.startsWith('legacy_') || (/^\d+$/.test(raw) && !raw.includes('-'));
    const legacyId = raw.startsWith('legacy_')
      ? parseInt(raw.replace(/^legacy_/, ''), 10)
      : /^\d+$/.test(raw)
        ? parseInt(raw, 10)
        : NaN;

    let query = supabase
      .from('contracts')
      .select(`
        *,
        contract_templates (
          id,
          name
        )
      `)
      .order('created_at', { ascending: false });

    if (isLegacy && Number.isFinite(legacyId) && legacyId > 0) {
      query = query.eq('legacy_id', legacyId);
    } else {
      query = query.eq('client_id', raw);
    }

    const { data, error } = await query;
    if (error) throw error;

    return data;
  } catch (error) {
    console.error('Error fetching client contracts:', error);
    throw error;
  }
} 