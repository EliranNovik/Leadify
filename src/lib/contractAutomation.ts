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
    console.log('Processing contract signing for contract:', contract.id);
    console.log('Contract data received:', contract);
    
    // 1. Calculate total contract value
    const isIsraeli = contract.client_country === 'IL';
    console.log('Client country:', contract.client_country, 'Is Israeli:', isIsraeli);
    console.log('Applicant count:', contract.applicant_count);
    
    // 3. Get client information (move this up so client.name is available)
    const { data: client, error: clientError } = await supabase
      .from('leads')
      .select('id, name, lead_number')
      .eq('id', contract.client_id)
      .single();
    if (clientError) {
      console.error('Error fetching client:', clientError);
      throw clientError;
    }

    // 4. Generate payment plan
    let paymentPlan;
    let currency;
    let totalValue;
    if (contract.custom_pricing && Array.isArray(contract.custom_pricing.payment_plan) && contract.custom_pricing.payment_plan.length > 0) {
      paymentPlan = contract.custom_pricing.payment_plan;
      currency = contract.custom_pricing.currency || (isIsraeli ? 'NIS' : 'USD');
      // Calculate totalValue from payment plan rows
      totalValue = paymentPlan.reduce((sum, row) => sum + (typeof row.value === 'number' ? row.value : 0), 0);
      console.log('Using custom payment plan from contract.custom_pricing:', paymentPlan);
    } else {
      totalValue = calculateTotalContractValue(contract.applicant_count, isIsraeli);
      currency = isIsraeli ? 'NIS' : 'USD';
      paymentPlan = generatePaymentPlan(totalValue, currency);
      console.log('Generated default payment plan:', paymentPlan);
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
    const paymentPlanEntries = paymentPlan.map((plan, idx) => ({
      lead_id: contract.client_id,
      due_percent: typeof (plan as any).percent !== 'undefined' ? (plan as any).percent : (plan as any).due_percent,
      due_date: idx === dueDateIdx ? today.toISOString().split('T')[0] : null,
      value: typeof plan.value !== 'undefined' ? plan.value : 0,
      value_vat: typeof plan.value_vat !== 'undefined' ? plan.value_vat : 0,
      client_name: contract.contact_name || client.name || '',
      payment_order: plan.payment_order || `Payment ${idx + 1}`,
      notes: plan.notes || '',
      currency: currency,
    }));
    
    console.log('Payment plan entries to insert:', paymentPlanEntries);
    
    const { data: insertedPayments, error: paymentError } = await supabase
      .from('payment_plans')
      .insert(paymentPlanEntries)
      .select();
    
    if (paymentError) {
      console.error('Error creating payment plan:', paymentError);
      console.error('Payment error details:', paymentError);
      throw paymentError;
    }
    
    console.log(`Created ${insertedPayments.length} payment plan entries`);
    console.log('Inserted payments:', insertedPayments);
    
    // 6. Generate proforma for the first payment
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
        addVat: currency === 'NIS',
        currency: currency === 'NIS' ? '₪' : '$',
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
    
    // 7. Update lead with contract information
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
    
    console.log('Contract signing automation completed successfully');
    
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
    console.log('Fetching contracts for clientId:', clientId, 'Type:', typeof clientId);
    
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
    
    console.log('Contracts query result:', { data, error });
    
    if (error) throw error;
    
    // Log contact information for debugging
    if (data && data.length > 0) {
      data.forEach((contract: any, index: number) => {
        console.log(`Contract ${index + 1}:`, {
          id: contract.id,
          contact_id: contract.contact_id,
          contact_name: contract.contact_name,
          template_name: contract.contract_templates?.name
        });
      });
    }
    
    return data;
  } catch (error) {
    console.error('Error fetching client contracts:', error);
    throw error;
  }
} 