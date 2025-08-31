import { supabase } from './supabase';
import { calculateTotalContractValue, generatePaymentPlan } from './contractPricing';
import { generateProformaName } from './proforma';

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
    // 1. Calculate total contract value
    const isIsraeli = contract.client_country === '₪';
    
    // 3. Get client information (move this up so client.name is available)
    let client;
    let clientError;
    
    // Check if this is a legacy lead (has legacy_id but no client_id)
    if ((contract as any).legacy_id && !contract.client_id) {
      // For legacy leads, fetch from leads_lead table
      const { data: legacyClient, error: legacyError } = await supabase
        .from('leads_lead')
        .select('id, name, lead_number')
        .eq('id', (contract as any).legacy_id)
        .single();
      
      if (legacyError) {
        console.error('Error fetching legacy client:', legacyError);
        throw legacyError;
      }
      
      // Transform legacy client to match expected structure
      client = {
        id: `legacy_${legacyClient.id}`,
        name: legacyClient.name,
        lead_number: legacyClient.id.toString()
      };
    } else {
      // For regular leads, fetch from leads table
      const { data: regularClient, error: regularError } = await supabase
        .from('leads')
        .select('id, name, lead_number')
        .eq('id', contract.client_id)
        .single();
      
      if (regularError) {
        console.error('Error fetching client:', regularError);
        throw regularError;
      }
      
      client = regularClient;
    }

    // 4. Generate payment plan
    let paymentPlan;
    let currency;
    let totalValue;
    if (contract.custom_pricing && Array.isArray(contract.custom_pricing.payment_plan) && contract.custom_pricing.payment_plan.length > 0) {
      paymentPlan = contract.custom_pricing.payment_plan;
      currency = contract.custom_pricing.currency || contract.client_country;
      // Calculate totalValue from payment plan rows
      totalValue = paymentPlan.reduce((sum, row) => sum + (typeof row.value === 'number' ? row.value : 0), 0);
    } else {
      totalValue = calculateTotalContractValue(contract.applicant_count, isIsraeli);
      currency = contract.client_country;
      paymentPlan = generatePaymentPlan(totalValue, currency);
    }

    // 2. Update contract with total amount
    const { error: contractUpdateError } = await supabase
      .from('contracts')
      .update({ 
        total_amount: totalValue,
        status: 'signed',
        signed_at: new Date().toISOString()
      })
      .eq('id', contract.id);
    if (contractUpdateError) {
      console.error('Error updating contract:', contractUpdateError);
      throw contractUpdateError;
    }

    // 5. Insert payment plan entries
    const today = new Date();
    // Find the index of the first payment with 'archival' in payment_order or notes
    const archivalIdx = paymentPlan.findIndex(plan => {
      const str = `${plan.payment_order || ''} ${plan.notes || ''}`.toLowerCase();
      return str.includes('archival');
    });
    // If no archival payment, use the first payment (idx 0)
    const dueDateIdx = archivalIdx !== -1 ? archivalIdx : 0;
    const paymentPlanEntries = paymentPlan.map((plan, idx) => {
      const duePercent = (plan as any).due_percent || (plan as any).percent || 0;
      
      // Parse the value field - it might be a string like "5500 + 990" or a number
      let value = 0;
      let value_vat = 0;
      
      const planValue = plan.value as any;
      if (typeof planValue === 'string' && planValue.includes('+')) {
        // Parse "value + vat" format
        const parts = planValue.split('+').map((part: string) => parseFloat(part.trim()) || 0);
        value = parts[0] || 0;
        value_vat = parts[1] || 0;
      } else {
        // It's already a number or simple string
        value = typeof planValue === 'number' ? planValue : parseFloat(planValue) || 0;
        value_vat = typeof plan.value_vat === 'number' ? plan.value_vat : parseFloat(plan.value_vat as any) || 0;
      }
      
      return {
        lead_id: contract.client_id || null, // Will be null for legacy leads
        due_percent: duePercent,
        percent: duePercent,
        due_date: idx === dueDateIdx ? today.toISOString().split('T')[0] : null,
        value: value,
        value_vat: value_vat,
        client_name: contract.contact_name || client.name || '',
        payment_order: plan.payment_order || (idx === 0 ? 'First Payment' : idx === paymentPlan.length - 1 ? 'Final Payment' : 'Intermediate Payment'),
        notes: plan.notes || '',
        currency: currency,
      };
    });
    
    // For legacy leads, skip payment plan creation since payment_plans table expects UUID lead_id
    let insertedPayments = null;
    if (contract.client_id) {
      const { data: payments, error: paymentError } = await supabase
        .from('payment_plans')
        .insert(paymentPlanEntries)
        .select();
      
      if (paymentError) {
        console.error('Error creating payment plan:', paymentError);
        console.error('Payment error details:', paymentError);
        throw paymentError;
      }
      
      insertedPayments = payments;
    } else {
      console.log('Skipping payment plan creation for legacy lead');
    }
    
    // 6. Generate proforma for the first payment (only for regular leads)
    if (insertedPayments && insertedPayments.length > 0) {
      const firstPayment = insertedPayments[0];
      const proformaName = await generateProformaName();
      
      const proformaContent = {
        client: contract.contact_name || client.name, // Use contact name if available
        clientId: client.id,
        proformaName: proformaName,
        payment: firstPayment.value + firstPayment.value_vat,
        base: firstPayment.value,
        vat: firstPayment.value_vat,
        language: 'EN',
        rows: [
          { 
            description: firstPayment.payment_order, 
            qty: 1, 
            rate: firstPayment.value, 
            total: firstPayment.value 
          },
        ],
        total: firstPayment.value,
        totalWithVat: firstPayment.value + firstPayment.value_vat,
        addVat: currency === '₪',
        currency: currency,
        bankAccount: '',
        notes: `Proforma for ${firstPayment.payment_order} - Contract ${contract.id}`,
        createdAt: new Date().toISOString(),
        createdBy: 'System',
      };
      
      // Save proforma to the first payment
      const { error: proformaError } = await supabase
        .from('payment_plans')
        .update({ proforma: JSON.stringify(proformaContent) })
        .eq('id', firstPayment.id);
      
      if (proformaError) {
        console.error('Error saving proforma:', proformaError);
        // Don't throw here as the main process succeeded
      } else {
        console.log('Generated proforma for first payment');
      }
    }
    
    // 7. Update lead with contract information (only for regular leads)
    if (contract.client_id) {
      const { error: leadUpdateError } = await supabase
        .from('leads')
        .update({
          balance: totalValue,
          balance_currency: currency,
          number_of_applicants_meeting: contract.applicant_count,
          stage: 'Client signed agreement',
        })
        .eq('id', contract.client_id);
      
      if (leadUpdateError) {
        console.error('Error updating lead:', leadUpdateError);
        // Don't throw here as the main process succeeded
      }
    } else {
      // For legacy leads, update the leads_lead table
      const { error: legacyLeadUpdateError } = await supabase
        .from('leads_lead')
        .update({
          total: totalValue,
          stage: 'Client signed agreement',
        })
        .eq('id', (contract as any).legacy_id);
      
      if (legacyLeadUpdateError) {
        console.error('Error updating legacy lead:', legacyLeadUpdateError);
        // Don't throw here as the main process succeeded
      }
    }
    
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
 * @param clientId - Client ID (UUID string)
 * @returns Array of contracts
 */
export async function getClientContracts(clientId: string) {
  try {
    const { data, error } = await supabase
      .from('contracts')
      .select(`
        *,
        contract_templates (
          id,
          name
        )
      `)
      .eq('client_id', clientId)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    return data;
  } catch (error) {
    console.error('Error fetching client contracts:', error);
    throw error;
  }
} 