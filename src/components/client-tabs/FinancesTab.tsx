import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import TimelineHistoryButtons from './TimelineHistoryButtons';
import { BanknotesIcon, PencilIcon, TrashIcon, XMarkIcon, Squares2X2Icon, Bars3Icon, CurrencyDollarIcon, UserIcon, MinusIcon, CheckIcon, LinkIcon, ClipboardDocumentIcon, ArrowUturnLeftIcon, ExclamationTriangleIcon, PaperAirplaneIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { ClientTabProps } from '../../types/client';
import { useMsal } from '@azure/msal-react';
import { loginRequest } from '../../msalConfig';
import ReactDOM from 'react-dom';
import { BanknotesIcon as BanknotesIconSolid } from '@heroicons/react/24/solid';
import { PencilLine, Trash2 } from 'lucide-react';
import { DocumentTextIcon, Cog6ToothIcon, ChartPieIcon, PlusIcon, ChatBubbleLeftRightIcon, DocumentCheckIcon } from '@heroicons/react/24/outline';
import { generateProformaName } from '../../lib/proforma';
import { getClientContracts, getContractDetails } from '../../lib/contractAutomation';
import { ArrowPathIcon } from '@heroicons/react/24/outline';

interface PaymentPlan {
  id: string | number;
  duePercent: string;
  dueDate: string;
  value: number;
  valueVat: number;
  client: string;
  order: string;
  proforma?: string | null;
  notes: string;
  paid?: boolean;
  paid_at?: string;
  paid_by?: string;
  currency?: string;
  isLegacy?: boolean; // Flag to identify legacy payments
  ready_to_pay?: boolean; // Flag to indicate if payment is ready for collection
}

interface FinancePlan {
  total: number;
  vat: number;
  payments: PaymentPlan[];
}

interface FinancesTabProps extends ClientTabProps {
  onPaymentMarkedPaid?: (paymentId: string | number) => void;
  onCreateFinancePlan?: () => void;
  hideTimelineHistory?: boolean; // Hide timeline and history buttons
}

const FinancesTab: React.FC<FinancesTabProps> = ({ client, onClientUpdate, onPaymentMarkedPaid, onCreateFinancePlan, hideTimelineHistory = false }) => {
  const navigate = useNavigate();
  const { instance } = useMsal();
  const [financePlan, setFinancePlan] = useState<FinancePlan | null>(null);
  const [editingPaymentId, setEditingPaymentId] = useState<string | number | null>(null);
  const [editPaymentData, setEditPaymentData] = useState<any>({});
  const [isSavingPaymentRow, setIsSavingPaymentRow] = useState(false);
  const [viewMode, setViewMode] = useState<'table' | 'boxes'>('table');
  const [collapsedContacts, setCollapsedContacts] = useState<{ [key: string]: boolean }>({});
  
  // Initialize all contacts as collapsed by default
  useEffect(() => {
    if (financePlan && financePlan.payments.length > 0) {
      const contacts = [...new Set(financePlan.payments.map(p => p.client))];
      
      // Only initialize if we haven't set up collapse state yet
      if (Object.keys(collapsedContacts).length === 0) {
        const initialCollapsedState = contacts.reduce((acc, contactName) => {
          acc[contactName] = true; // true means collapsed
          return acc;
        }, {} as { [key: string]: boolean });
        setCollapsedContacts(initialCollapsedState);
      }
    }
  }, [financePlan]);

  // Proforma drawer state
  const [showProformaDrawer, setShowProformaDrawer] = useState(false);
  const [proformaData, setProformaData] = useState<any>(null);
  const [generatedProformaName, setGeneratedProformaName] = useState<string>('');

  // Contract state
  const [contracts, setContracts] = useState<any[]>([]);
  const [selectedContract, setSelectedContract] = useState<any>(null);
  const [contacts, setContacts] = useState<any[]>([]);

  // Add state and handler for editing subtotal at the top of the component:
  const [isEditingSubtotal, setIsEditingSubtotal] = useState(false);
  const [editableSubtotal, setEditableSubtotal] = useState('');
  
  // Add state for stages dropdown and drawer
  const [showStagesDrawer, setShowStagesDrawer] = useState(false);
  const [autoPlanData, setAutoPlanData] = useState({
    totalAmount: '',
    currency: '₪',
    numberOfPayments: 3,
    firstPaymentPercent: 50,
    includeVat: true
  });

  // Add state for percentage calculation feature
  const [showPercentageModal, setShowPercentageModal] = useState(false);
  const [percentageType, setPercentageType] = useState<'total' | 'leftToPlan'>('total');
  const [percentageValue, setPercentageValue] = useState<number>(0);

  // Add state for deleted payments view
  const [showDeletedPayments, setShowDeletedPayments] = useState(false);
  const [deletedPayments, setDeletedPayments] = useState<any[]>([]);

  // Add state for legacy proformas
  const [legacyProformas, setLegacyProformas] = useState<any[]>([]);

  // Update autoPlanData currency when client changes
  useEffect(() => {
    if (client) {
      const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
      let currency = '₪'; // Default
      
      if (isLegacyLead) {
        // For legacy leads, use balance_currency
        currency = client?.balance_currency || '₪';
      } else {
        // For new leads, use proposal_currency
        currency = client?.proposal_currency || '₪';
      }
      
      setAutoPlanData(prev => ({ ...prev, currency }));
    }
  }, [client]);
  
  const saveSubtotal = () => {
    // Update the first row's total to match the edited subtotal
    if (proformaData && proformaData.rows && proformaData.rows.length > 0) {
      const diff = parseFloat(editableSubtotal) - proformaData.rows.reduce((sum: number, r: any) => sum + Number(r.total), 0);
      const newRows = [...proformaData.rows];
      newRows[0].total = parseFloat(editableSubtotal);
      setProformaData((prev: any) => ({ ...prev, rows: newRows }));
    }
    setIsEditingSubtotal(false);
  };

  // Add paid state for each payment row
  const [paidMap, setPaidMap] = useState<{ [id: string]: boolean }>({});
  const [editingValueVatId, setEditingValueVatId] = useState<string | number | null>(null);

  // Handler to generate and copy payment link
  const handleGeneratePaymentLink = async (payment: PaymentPlan) => {
    try {
      // Generate secure token
      const secureToken = `payment_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
      
      // Set expiration date (30 days from now)
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);

      // Create payment link in database
      const { data: paymentLink, error } = await supabase
        .from('payment_links')
        .insert({
          payment_plan_id: payment.id,
          client_id: client.id,
          secure_token: secureToken,
          amount: payment.value,
          vat_amount: payment.valueVat,
          total_amount: payment.value + payment.valueVat,
          currency: payment.currency || '₪',
          description: `${payment.order} - ${client?.name} (#${client?.lead_number})`,
          status: 'pending',
          expires_at: expiresAt.toISOString()
        })
        .select()
        .single();

      if (error) throw error;

      // Generate the payment URL
      const paymentUrl = `${window.location.origin}/payment/${secureToken}`;
      
      // Copy to clipboard
      await navigator.clipboard.writeText(paymentUrl);
      
      toast.success('Payment link copied to clipboard!');
    } catch (error) {
      console.error('Error generating payment link:', error);
      toast.error('Failed to generate payment link');
    }
  };

  // Handler to mark a payment as paid
  const handleMarkAsReadyToPay = async (payment: PaymentPlan) => {
    try {
      const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
      const currentDate = new Date().toISOString().split('T')[0]; // Get today's date in YYYY-MM-DD format
      
      let error;
      if (isLegacyLead) {
        // For legacy leads, update finances_paymentplanrow table
        const { error: legacyError } = await supabase
          .from('finances_paymentplanrow')
          .update({ 
            ready_to_pay: true,
            due_date: currentDate // Set due date to current date
          })
          .eq('id', payment.id);
        error = legacyError;
      } else {
        // For new leads, update payment_plans table
        const { error: newError } = await supabase
          .from('payment_plans')
          .update({ 
            ready_to_pay: true,
            due_date: currentDate // Set due date to current date
          })
          .eq('id', payment.id);
        error = newError;
      }

      if (error) {
        console.error('Error marking payment as ready to pay:', error);
        toast.error('Failed to mark payment as ready to pay');
        return;
      }

      // Update the local state to reflect the change
      setFinancePlan(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          payments: prev.payments.map(p => 
            p.id === payment.id 
              ? { ...p, ready_to_pay: true, dueDate: currentDate }
              : p
          )
        };
      });

      toast.success('Payment marked as ready to pay! Due date set to today. It will now appear in the collection page.');
    } catch (error) {
      console.error('Error marking payment as ready to pay:', error);
      toast.error('Failed to mark payment as ready to pay');
    }
  };

  const handleMarkAsPaid = async (id: string | number) => {
    // Find the payment to check if it's legacy
    const payment = financePlan?.payments.find(p => p.id === id);
    const isLegacyPayment = payment?.isLegacy;
    
    // Immediately update the UI state
    setPaidMap(prev => ({ ...prev, [id]: true }));
    
    // Update the finance plan state to immediately show paid status
    setFinancePlan(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        payments: prev.payments.map(payment => 
          payment.id === id 
            ? { ...payment, paid: true, paid_at: new Date().toISOString() }
            : payment
        )
      };
    });
    
    if (onPaymentMarkedPaid) onPaymentMarkedPaid(id);
    
    try {
      const currentUserName = await getCurrentUserName();
      
      if (isLegacyPayment) {
        // For legacy payments, update finances_paymentplanrow table
        const { error } = await supabase
          .from('finances_paymentplanrow')
          .update({
            actual_date: new Date().toISOString().split('T')[0], // Set actual_date to today
          })
          .eq('id', id);
          
        if (!error) {
          toast.success('Legacy payment marked as paid!');
        } else {
          // Revert the UI state if database update fails
          setPaidMap(prev => ({ ...prev, [id]: false }));
          setFinancePlan(prev => {
            if (!prev) return prev;
            return {
              ...prev,
              payments: prev.payments.map(payment => 
                payment.id === id 
                  ? { ...payment, paid: false, paid_at: undefined }
                  : payment
              )
            };
          });
          toast.error('Failed to mark legacy payment as paid.');
        }
      } else {
        // For regular payments, log the payment marked as paid (only for new payments)
        // Legacy payments don't use this table since lead_id has NOT NULL constraint
        if (!(client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_'))) {
          const { error: historyError } = await supabase
            .from('finance_changes_history')
            .insert({
              lead_id: client?.id, // Use UUID for new leads
              change_type: 'payment_marked_paid',
              table_name: 'payment_plans',
              record_id: id,
              old_values: { paid: false },
              new_values: { paid: true, paid_at: new Date().toISOString(), paid_by: currentUserName },
              changed_by: currentUserName,
              notes: `Payment marked as paid by ${currentUserName}`
            });
          
          if (historyError) console.error('Error logging payment marked as paid:', historyError);
        } else {
          // Legacy payment marked as paid - skipping change logging
        }
        
        // Check if this is a legacy lead
        const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
        
        // Update DB based on lead type
        let error = null;
        if (isLegacyLead) {
          // For legacy leads, update finances_paymentplanrow table
          const { error: legacyError } = await supabase
            .from('finances_paymentplanrow')
            .update({
              actual_date: new Date().toISOString().split('T')[0], // Use actual_date for legacy
            })
            .eq('id', id);
          error = legacyError;
        } else {
          // For new leads, update payment_plans table
          const { error: newError } = await supabase
            .from('payment_plans')
            .update({
              paid: true,
              paid_at: new Date().toISOString(),
              paid_by: currentUserName,
            })
            .eq('id', id);
          error = newError;
        }
          
        if (!error) {
          toast.success('Payment marked as paid!');
        } else {
          // Revert the UI state if database update fails
          setPaidMap(prev => ({ ...prev, [id]: false }));
          setFinancePlan(prev => {
            if (!prev) return prev;
            return {
              ...prev,
              payments: prev.payments.map(payment => 
                payment.id === id 
                  ? { ...payment, paid: false, paid_at: undefined }
                  : payment
              )
            };
          });
          toast.error('Failed to mark as paid.');
        }
      }
    } catch (error) {
      console.error('Error marking payment as paid:', error);
      // Revert the UI state if there's an error
      setPaidMap(prev => ({ ...prev, [id]: false }));
      setFinancePlan(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          payments: prev.payments.map(payment => 
            payment.id === id 
              ? { ...payment, paid: false, paid_at: undefined }
              : payment
          )
        };
      });
      toast.error('Failed to mark as paid.');
    }
  };

  // Fetch payment plans when component mounts or client changes
  useEffect(() => {
      const fetchPaymentPlans = async () => {
    if (!client?.id) {
      return;
    }
    
    // Check if this is a legacy lead
    const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
      
      try {
        let data = null;
        let error = null;
        
        if (isLegacyLead) {
          // For legacy leads, fetch from finances_paymentplanrow table
          const legacyId = client.id.toString().replace('legacy_', '');
          
          // Now query for the specific legacy ID - the lead_id column is text, so we need to query with the string ID
          // Join with accounting_currencies table to get proper currency symbols
          // Filter out canceled payments (cancel_date is null for active payments)
          let { data: legacyData, error: legacyError } = await supabase
            .from('finances_paymentplanrow')
            .select(`
              *,
              accounting_currencies!finances_paymentplanrow_currency_id_fkey (
                name,
                iso_code
              )
            `)
            .eq('lead_id', legacyId)
            .is('cancel_date', null)
            .order('due_date', { ascending: true });
          
          // If no results with lead_id, try client_id (which is bigint)
          if (!legacyData || legacyData.length === 0) {
            const numericId = parseInt(legacyId);
            if (!isNaN(numericId)) {
              const { data: clientData, error: clientError } = await supabase
                .from('finances_paymentplanrow')
                .select(`
                  *,
                  accounting_currencies!finances_paymentplanrow_currency_id_fkey (
                    name,
                    iso_code
                  )
                `)
                .eq('client_id', numericId)
                .is('cancel_date', null)
                .order('due_date', { ascending: true });
              
              legacyData = clientData;
              legacyError = clientError;
            }
          }
          
          data = legacyData;
          error = legacyError;
        } else {
          // For regular leads, fetch from payment_plans table
          // Filter out canceled payments (cancel_date is null for active payments)
          const { data: regularData, error: regularError } = await supabase
            .from('payment_plans')
            .select('*')
            .eq('lead_id', client.id)
            .is('cancel_date', null)
            .order('due_date', { ascending: true });
          
          data = regularData;
          error = regularError;
        }

        if (error) {
          console.error('Error fetching payment plans:', error);
          return;
        }

        if (data && data.length > 0) {
          let total = 0;
          let vat = 0;
          let payments = [];
          
          if (isLegacyLead) {
            // Transform legacy data to match the finance plan structure
            // First, calculate proper totals with VAT for NIS currency
            let total = 0;
            let vat = 0;
            
            data.forEach(plan => {
              const value = Number(plan.value || 0);
              let valueVat = Number(plan.vat_value || 0);
              
              // For NIS (currency_id = 1), ensure VAT calculation is correct
              if (plan.currency_id === 1 && (valueVat === 0 || !plan.vat_value)) {
                valueVat = Math.round(value * 0.18 * 100) / 100;
              }
              
              total += value + valueVat;
              vat += valueVat;
            });
            
            // Calculate the total amount for percentage calculation
            const totalAmount = total;
            
            payments = data.map(plan => {
              const value = Number(plan.value || 0);
              let valueVat = Number(plan.vat_value || 0);
              
              // Get currency from the joined accounting_currencies table
              let currency = '₪'; // Default fallback
              let currencyId = plan.currency_id;
              
              if (plan.accounting_currencies && plan.accounting_currencies.name) {
                currency = plan.accounting_currencies.name;
                currencyId = plan.accounting_currencies.id;
              } else if (plan.currency_id) {
                // If we have currency_id but no joined data, use a simple mapping
                // Map known currency IDs to symbols
                switch (plan.currency_id) {
                  case 1: currency = '₪'; break; // NIS
                  case 2: currency = '€'; break; // EUR
                  case 3: currency = '$'; break; // USD
                  case 4: currency = '£'; break; // GBP
                  default: currency = '₪'; break;
                }
              }
              
              // For NIS (currency_id = 1), ensure VAT calculation is correct
              // If vat_value is 0 or null, calculate it based on the value
              if (currencyId === 1 && (valueVat === 0 || !plan.vat_value)) {
                valueVat = Math.round(value * 0.18 * 100) / 100;
              }
              
              const paymentTotal = value + valueVat;
              
              // Calculate percentage based on this payment's total amount vs total of all payments
              const duePercent = totalAmount > 0 ? Math.round((paymentTotal / totalAmount) * 100) : 0;
              
              // Map numeric order to text for display
              const getOrderText = (orderNumber: number): string => {
                switch (orderNumber) {
                  case 1: return 'First Payment';
                  case 5: return 'Intermediate Payment';
                  case 9: return 'Final Payment';
                  case 90: return 'Single Payment';
                  case 99: return 'Expense (no VAT)';
                  default: return 'First Payment'; // Default fallback
                }
              };

              // Use stored percentage value if available, otherwise auto-calculate for existing payments
              let calculatedDuePercent = '0';
              if (plan.due_percent && plan.due_percent !== 'null' && plan.due_percent !== '') {
                // Use stored percentage value
                calculatedDuePercent = plan.due_percent;
              } else {
                // Auto-calculate percentage based on payment amount vs total
                // This only happens for existing payments that don't have a stored percentage
                const paymentTotal = value + valueVat;
                calculatedDuePercent = totalAmount > 0 ? Math.round((paymentTotal / totalAmount) * 100).toString() : '0';
              }
              
              // Ensure the percentage has the % sign
              if (!calculatedDuePercent.includes('%')) {
                calculatedDuePercent = calculatedDuePercent + '%';
              }

              return {
                id: plan.id,
                duePercent: calculatedDuePercent,
                dueDate: plan.due_date,
                value,
                valueVat,
                client: client.name || 'Legacy Client', // Use client name from the main client object
                order: plan.order ? getOrderText(plan.order) : 'First Payment',
                proforma: null, // Legacy doesn't have proforma
                notes: plan.notes || '',
                paid: plan.actual_date ? true : false, // If actual_date is set, consider it paid
                paid_at: plan.actual_date,
                paid_by: undefined, // Legacy doesn't track who paid
                currency,
                isLegacy: true, // Flag to identify legacy payments
                ready_to_pay: plan.ready_to_pay || false, // Include ready_to_pay field
              };
            });
          } else {
            // Transform regular data to match the finance plan structure
            total = data.reduce((sum, plan) => sum + Number(plan.value) + Number(plan.value_vat), 0);
            vat = data.reduce((sum, plan) => sum + Number(plan.value_vat), 0);
            
            payments = data.map(plan => {
              const value = Number(plan.value);
              let valueVat = 0;
              const currency = plan.currency || '₪';
              if (currency === '₪') {
                valueVat = Math.round(value * 0.18 * 100) / 100;
              }
              return {
                id: plan.id,
                duePercent: String(plan.due_percent || plan.percent || 0),
                dueDate: plan.due_date,
                value,
                valueVat,
                client: plan.client_name,
                order: plan.payment_order,
                proforma: plan.proforma || null,
                notes: plan.notes || '',
                paid: plan.paid || false,
                paid_at: plan.paid_at || null,
                paid_by: plan.paid_by || null,
                currency,
                isLegacy: false,
                ready_to_pay: plan.ready_to_pay || false, // Include ready_to_pay field
              };
            });
          }

          // Update paidMap to reflect the paid status from database
          const newPaidMap: { [id: string]: boolean } = {};
          payments.forEach(payment => {
            newPaidMap[payment.id.toString()] = payment.paid || false;
          });
          setPaidMap(newPaidMap);

          setFinancePlan({
            total: Math.round(total * 100) / 100,
            vat: Math.round(vat * 100) / 100,
            payments: payments,
          });
        } else {
          setFinancePlan(null);
          setPaidMap({});
        }
      } catch (error) {
        console.error('Error fetching payment plans:', error);
      }
    };

      const fetchContracts = async () => {
    if (!client?.id || typeof client.id !== 'string' || client.id.length === 0) return;
    
    // Check if this is a legacy lead
    const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
    
    if (isLegacyLead) {
      // For legacy leads, fetch contract information from lead_leadcontact table
      try {
        const legacyId = client.id.toString().replace('legacy_', '');
        
        // Fetch legacy contract data with lead information
        const { data: legacyContracts, error } = await supabase
          .from('lead_leadcontact')
          .select(`
            id,
            contract_html,
            signed_contract_html,
            public_token,
            main,
            contact_id,
            lead_id,
            leads_lead!inner(
              total,
              no_of_applicants
            )
          `)
          .eq('lead_id', legacyId);
        
        if (error) {
          console.error('Error fetching legacy contracts:', error);
          setContracts([]);
          return;
        }
        
        if (legacyContracts && legacyContracts.length > 0) {
          // Fetch signed date from stage 60 (agreement signed) for this lead
          const { data: signedStageData, error: stageError } = await supabase
            .from('leads_leadstage')
            .select('cdate')
            .eq('lead_id', legacyId)
            .eq('stage', 60)
            .order('cdate', { ascending: false })
            .limit(1)
            .single();
          
          const signedDate = signedStageData?.cdate || null;
          
          // Transform legacy contract data to match the expected format
          const transformedContracts = legacyContracts.map((contract, index) => {
            // Use database fields instead of parsing HTML
            const leadData = Array.isArray(contract.leads_lead) ? contract.leads_lead[0] : contract.leads_lead;
            const totalAmount = leadData?.total || 0;
            const applicantCount = leadData?.no_of_applicants || 1;
            const costPerApplicant = applicantCount > 0 ? totalAmount / applicantCount : 0;
            
            return {
              id: contract.id,
              status: contract.signed_contract_html ? 'signed' : 'draft',
              contract_html: contract.contract_html,
              signed_contract_html: contract.signed_contract_html,
              public_token: contract.public_token,
              contact_id: contract.contact_id,
              lead_id: contract.lead_id,
              main: contract.main,
              // Add legacy-specific fields
              contract_templates: {
                name: 'Contract'
              },
              applicant_count: applicantCount,
              total_amount: totalAmount,
              cost_per_applicant: costPerApplicant,
              signed_at: signedDate, // Use the signed date from stage 60
              client_country: 'IL', // Default for legacy
              contact_name: client.name || 'Legacy Client',
              isLegacy: true
            };
          });
          
          setContracts(transformedContracts);
        } else {
          setContracts([]);
        }
      } catch (error) {
        console.error('Error fetching legacy contracts:', error);
        setContracts([]);
      }
      return;
    }
    
    try {
      const contractData = await getClientContracts(client.id);
      setContracts(contractData || []);
    } catch (error) {
      console.error('Error fetching contracts:', error);
    }
  };

    const fetchContacts = async () => {
      if (!client?.id) return;
      
      // Check if this is a legacy lead
      const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
      
      if (isLegacyLead) {
        // For legacy leads, additional contacts are not supported, so set empty array
        setContacts([]);
        return;
      }
      
      try {
        // First check if we have additional_contacts in the client object
        if (client.additional_contacts && Array.isArray(client.additional_contacts)) {
          const contactsWithIds = client.additional_contacts.map((contact: any, index: number) => ({
            id: index + 1, // Use index + 1 as ID to match contact_id
            ...contact
          }));
          setContacts(contactsWithIds);
        } else {
          // If not, fetch from database
          const { data: leadData, error } = await supabase
            .from('leads')
            .select('additional_contacts')
            .eq('id', client.id)
            .single();
          
          if (!error && leadData?.additional_contacts) {
            // Transform additional_contacts to include IDs
            const contactsWithIds = leadData.additional_contacts.map((contact: any, index: number) => ({
              id: index + 1, // Use index + 1 as ID to match contact_id
              ...contact
            }));
            setContacts(contactsWithIds);
          } else {
            setContacts([]);
          }
        }
      } catch (error) {
        console.error('Error fetching contacts:', error);
        setContacts([]);
      }
    };

    // Add event listener for payment marked as paid
    const handlePaymentMarkedPaid = (event: CustomEvent) => {
      // Refresh payment plans to reflect the updated paid status
      refreshPaymentPlans();
    };

    // Add the event listener
    window.addEventListener('paymentMarkedPaid', handlePaymentMarkedPaid as EventListener);

    fetchPaymentPlans();
    fetchContracts();
    fetchContacts();

    // Cleanup function to remove event listener
    return () => {
      window.removeEventListener('paymentMarkedPaid', handlePaymentMarkedPaid as EventListener);
    };
  }, [client?.id]);

  // Fetch legacy proformas when client changes
  useEffect(() => {
    if (client) {
      fetchLegacyProformas();
    }
  }, [client]);

  const refreshPaymentPlans = async () => {
    if (!client?.id) return;
    
    // Check if this is a legacy lead
    const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
    
    try {
      let data = null;
      let error = null;
      
              if (isLegacyLead) {
          // For legacy leads, fetch from finances_paymentplanrow table
          const legacyId = client.id.toString().replace('legacy_', '');
          
          // Query finances_paymentplanrow table with currency information
          // Filter out canceled payments (cancel_date is null for active payments)
          const { data: legacyData, error: legacyError } = await supabase
            .from('finances_paymentplanrow')
            .select(`
              *,
              accounting_currencies!finances_paymentplanrow_currency_id_fkey (
                name,
                iso_code
              )
            `)
            .eq('lead_id', legacyId)
            .is('cancel_date', null)
            .order('due_date', { ascending: true });
          
          data = legacyData;
          error = legacyError;
      } else {
        // For regular leads, fetch from payment_plans table
        // Filter out canceled payments (cancel_date is null for active payments)
        const { data: regularData, error: regularError } = await supabase
          .from('payment_plans')
          .select('*')
          .eq('lead_id', client.id)
          .is('cancel_date', null)
          .order('due_date', { ascending: true });
        
        data = regularData;
        error = regularError;
      }
      
      if (error) throw error;
      if (data && data.length > 0) {
        let total = 0;
        let vat = 0;
        let payments = [];
        
        if (isLegacyLead) {
          // Transform legacy data with proper currency and VAT handling
          // First, calculate proper totals with VAT for NIS currency
          let total = 0;
          let vat = 0;
          
          data.forEach(plan => {
            const value = Number(plan.value || 0);
            let valueVat = Number(plan.vat_value || 0);
            
            // For NIS (currency_id = 1), ensure VAT calculation is correct
            if (plan.currency_id === 1 && (valueVat === 0 || !plan.vat_value)) {
              valueVat = Math.round(value * 0.18 * 100) / 100;
            }
            
            total += value + valueVat;
            vat += valueVat;
          });
          
          // Calculate the total amount for percentage calculation
          const totalAmount = total;
          
          payments = data.map(plan => {
            const value = Number(plan.value || 0);
            let valueVat = Number(plan.vat_value || 0);
            
            // Get currency from the joined accounting_currencies table
            let currency = '₪'; // Default fallback
            let currencyId = plan.currency_id;
            
            if (plan.accounting_currencies && plan.accounting_currencies.name) {
              currency = plan.accounting_currencies.name;
              currencyId = plan.accounting_currencies.id;
                          } else if (plan.currency_id) {
                // If we have currency_id but no joined data, use a simple mapping
                // Map known currency IDs to symbols
                switch (plan.currency_id) {
                case 1: currency = '₪'; break; // NIS
                case 2: currency = '€'; break; // EUR
                case 3: currency = '$'; break; // USD
                case 4: currency = '£'; break; // GBP
                default: currency = '₪'; break;
              }
            }
            
            // For NIS (currency_id = 1), ensure VAT calculation is correct
            if (currencyId === 1 && (valueVat === 0 || !plan.vat_value)) {
              valueVat = Math.round(value * 0.18 * 100) / 100;
            }
            
            const paymentTotal = value + valueVat;
            
            // Calculate percentage based on this payment's total amount vs total of all payments
            const duePercent = totalAmount > 0 ? Math.round((paymentTotal / totalAmount) * 100) : 0;
            
            return {
              id: plan.id,
              duePercent: duePercent.toString(), // Calculate percentage based on payment amount
              dueDate: plan.due_date,
              value,
              valueVat,
              client: client.name || 'Legacy Client',
              order: plan.order ? `Payment ${plan.order}` : 'Payment',
              proforma: null,
              notes: plan.notes || '',
              paid: plan.actual_date ? true : false,
              paid_at: plan.actual_date,
              paid_by: null,
              currency,
              isLegacy: true,
            };
          });
        } else {
          // Transform regular data
          total = data.reduce((sum, plan) => sum + Number(plan.value) + Number(plan.value_vat), 0);
          vat = data.reduce((sum, plan) => sum + Number(plan.value_vat), 0);
          
          payments = data.map(plan => {
            const value = Number(plan.value);
            let valueVat = 0;
            const currency = plan.currency || '₪';
            if (currency === '₪') {
              valueVat = Math.round(value * 0.18 * 100) / 100;
            }
            return {
              id: plan.id,
              duePercent: String(plan.due_percent || plan.percent || 0),
              dueDate: plan.due_date,
              value,
              valueVat,
              client: plan.client_name,
              order: plan.payment_order,
              proforma: plan.proforma || null,
              notes: plan.notes || '',
              paid: plan.paid || false,
              paid_at: plan.paid_at || null,
              paid_by: plan.paid_by || null,
              currency,
              isLegacy: false,
            };
          });
        }
        
        // Update paidMap to reflect the paid status from database
        const newPaidMap: { [id: string]: boolean } = {};
        payments.forEach(payment => {
          newPaidMap[payment.id.toString()] = payment.paid || false;
        });
        setPaidMap(newPaidMap);
        
        setFinancePlan({
          total: Math.round(total * 100) / 100,
          vat: Math.round(vat * 100) / 100,
          payments: payments,
        });
      } else {
        setFinancePlan(null);
        setPaidMap({});
      }
    } catch (error) {
      toast.error('Failed to refresh payment plans.');
    }
  };

  // Add a refresh function for contracts
  const refreshContracts = async () => {
    if (!client?.id || typeof client.id !== 'string' || client.id.length === 0) return;
    try {
      const contractData = await getClientContracts(client.id);
      setContracts(contractData || []);
    } catch (error) {
      console.error('Error refreshing contracts:', error);
    }
  };

  // Combined refresh function
  const refreshAllData = async () => {
    await Promise.all([refreshPaymentPlans(), refreshContracts()]);
  };

  // Update client balance to match finance plan total
  const updateClientBalance = async (newBalance: number) => {
    if (!client?.id) return;
    try {
      // Get the currency from the first payment in the finance plan
      const currency = financePlan?.payments?.[0]?.currency || '₪';
      
      // Check if this is a legacy lead
      const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
      
      if (isLegacyLead) {
        // For legacy leads, update the leads_lead table
        const legacyId = client.id.toString().replace('legacy_', '');
        
        const { error } = await supabase
          .from('leads_lead')
          .update({ 
            total: newBalance
            // Note: leads_lead table doesn't have balance_currency field, 
            // it uses currency_id instead, but we'll keep it simple for now
          })
          .eq('id', legacyId);
        
        if (error) {
          console.error('Error updating legacy lead balance:', error);
          toast.error('Failed to update client balance');
        } else {
          // Update local client state
          if (onClientUpdate) {
            await onClientUpdate();
          }
          toast.success('Client balance updated');
        }
      } else {
        // For new leads, update the leads table
        const { error } = await supabase
          .from('leads')
          .update({ 
            balance: newBalance,
            balance_currency: currency
          })
          .eq('id', client.id);
        
        if (error) {
          console.error('Error updating client balance:', error);
          toast.error('Failed to update client balance');
        } else {
          // Update local client state
          if (onClientUpdate) {
            await onClientUpdate();
          }
          toast.success('Client balance updated');
        }
      }
    } catch (error) {
      console.error('Error updating client balance:', error);
      toast.error('Failed to update client balance');
    }
  };

  // Helper functions for percentage calculation feature
  const getTotalAmount = () => {
    if (!financePlan) return 0;
    
    // For legacy leads, use the contract total from leads_lead.total column
    const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
    if (isLegacyLead && contracts.length > 0) {
      const legacyContract = contracts.find(c => c.isLegacy);
      if (legacyContract && legacyContract.total_amount > 0) {
        return legacyContract.total_amount;
      }
    }
    
    // For new leads, use the client's balance column
    if (!isLegacyLead && client?.balance) {
      return client.balance;
    }
    
    // Final fallback: Calculate total from all payments (both paid and unpaid)
    return financePlan.payments.reduce((sum, payment) => sum + payment.value + payment.valueVat, 0);
  };

  const getLeftToPlanAmount = () => {
    if (!financePlan) return 0;
    
    const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
    
    // For legacy leads, calculate based on total column vs payment values
    if (isLegacyLead && contracts.length > 0) {
      const legacyContract = contracts.find(c => c.isLegacy);
      if (legacyContract && legacyContract.total_amount > 0) {
        // Calculate sum of payment values (without VAT)
        const totalPlannedValue = financePlan.payments.reduce((sum, payment) => sum + payment.value, 0);
        // Left to plan = Total column - Sum of payment values
        const leftToPlan = legacyContract.total_amount - totalPlannedValue;
        return Math.max(0, leftToPlan); // Don't return negative values
      }
    }
    
    // For new leads, calculate based on balance vs payment values
    if (!isLegacyLead && client?.balance) {
      // Calculate sum of payment values (without VAT)
      const totalPlannedValue = financePlan.payments.reduce((sum, payment) => sum + payment.value, 0);
      // Left to plan = Balance - Sum of payment values
      const leftToPlan = client.balance - totalPlannedValue;
      return Math.max(0, leftToPlan); // Don't return negative values
    }
    
    // Fallback: Use percentage-based calculation
    const totalAmount = getTotalAmount();
    
    // Calculate total planned amount based on due percentages
    const totalPlannedPercent = financePlan.payments.reduce((sum, payment) => {
      const percent = typeof payment.duePercent === 'string' 
        ? parseFloat(payment.duePercent.replace('%', '')) 
        : (payment.duePercent || 0);
      return sum + percent;
    }, 0);
    
    // If 100% is already planned, there's nothing left to plan
    if (totalPlannedPercent >= 100) {
      return 0;
    }
    
    // Calculate remaining percentage and convert to amount
    const remainingPercent = 100 - totalPlannedPercent;
    return Math.round((totalAmount * remainingPercent) / 100);
  };

  const handlePercentageCalculation = (percentage: number, type: 'total' | 'leftToPlan') => {
    const baseAmount = type === 'total' ? getTotalAmount() : getLeftToPlanAmount();
    const calculatedValue = Math.round((baseAmount * percentage) / 100);
    // Calculate percentage based on the payment value vs total column
    const calculatedPercent = Math.round((calculatedValue / getTotalAmount()) * 100);
    
    // Get the currency from the finance plan or client data
    const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
    let currency = '₪'; // Default
    if (isLegacyLead) {
      currency = financePlan?.payments[0]?.currency || client?.balance_currency || '₪';
    } else {
      currency = financePlan?.payments[0]?.currency || client?.balance_currency || '₪';
    }
    
    // Only apply VAT for Israeli Shekels (₪), not for other currencies like USD ($)
    const shouldApplyVat = currency === '₪';
    
    setNewPaymentData((prev: any) => ({
      ...prev,
      value: calculatedValue,
      duePercent: calculatedPercent,
      valueVat: shouldApplyVat ? Math.round(calculatedValue * 0.18 * 100) / 100 : 0
    }));
    
    setShowPercentageModal(false);
    setPercentageValue(percentage);
  };

  const openPercentageModal = (type: 'total' | 'leftToPlan') => {
    setPercentageType(type);
    setPercentageValue(0);
    setShowPercentageModal(true);
  };

  const handleBoxClick = (type: 'total' | 'leftToPlan') => {
    const amount = type === 'total' ? getTotalAmount() : getLeftToPlanAmount();
    const totalAmount = getTotalAmount();
    
    // Calculate the percentage based on the amount
    const percentage = totalAmount > 0 ? Math.round((amount / totalAmount) * 100) : 0;
    
    // Get the currency from the finance plan or client data
    const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
    let currency = '₪'; // Default
    if (isLegacyLead) {
      currency = financePlan?.payments[0]?.currency || client?.balance_currency || '₪';
    } else {
      currency = financePlan?.payments[0]?.currency || client?.balance_currency || '₪';
    }
    
    // Only apply VAT for Israeli Shekels (₪), not for other currencies like USD ($)
    const shouldApplyVat = currency === '₪';
    
    // Set the values in the new payment form
    setNewPaymentData((prev: any) => ({
      ...prev,
      value: amount,
      duePercent: percentage,
      valueVat: shouldApplyVat ? Math.round(amount * 0.18 * 100) / 100 : 0
    }));
  };

  // Function to fetch deleted payments
  const fetchDeletedPayments = async () => {
    if (!client) return;
    
    const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
    
    if (isLegacyLead) {
      const legacyId = client.id.toString().replace('legacy_', '');
      
      try {
        // Fetch canceled payments (cancel_date is not null)
        const { data: deletedData, error } = await supabase
          .from('finances_paymentplanrow')
          .select(`
            *,
            accounting_currencies!finances_paymentplanrow_currency_id_fkey (
              name,
              iso_code
            )
          `)
          .eq('lead_id', legacyId)
          .not('cancel_date', 'is', null)
          .order('cancel_date', { ascending: false });
        
        if (error) {
          console.error('Error fetching deleted payments:', error);
          return;
        }
        
        setDeletedPayments(deletedData || []);
      } catch (error) {
        console.error('Error fetching deleted payments:', error);
      }
    } else {
      // For new leads, fetch deleted payments from payment_plans table
      try {
        // Fetch canceled payments (cancel_date is not null)
        const { data: deletedData, error } = await supabase
          .from('payment_plans')
          .select('*')
          .eq('lead_id', client.id)
          .not('cancel_date', 'is', null)
          .order('cancel_date', { ascending: false });
        
        if (error) {
          console.error('Error fetching deleted payments:', error);
          return;
        }
        
        setDeletedPayments(deletedData || []);
      } catch (error) {
        console.error('Error fetching deleted payments:', error);
      }
    }
  };

  // Function to restore a deleted payment
  const handleRestorePayment = async (paymentId: number) => {
    try {
      const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
      
      let error;
      if (isLegacyLead) {
        // Restore legacy payment in finances_paymentplanrow table
        const { error: legacyError } = await supabase
          .from('finances_paymentplanrow')
          .update({ cancel_date: null })
          .eq('id', paymentId);
        error = legacyError;
      } else {
        // Restore new payment in payment_plans table
        const { error: newError } = await supabase
          .from('payment_plans')
          .update({ cancel_date: null })
          .eq('id', paymentId);
        error = newError;
      }
      
      if (error) throw error;
      
      toast.success('Payment restored successfully!');
      await fetchDeletedPayments(); // Refresh deleted payments list
      await refreshPaymentPlans(); // Refresh main payments list
    } catch (error) {
      console.error('Error restoring payment:', error);
      toast.error('Failed to restore payment.');
    }
  };

  // Function to fetch legacy proformas
  const fetchLegacyProformas = async () => {
    if (!client) return;
    
    const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
    
    if (isLegacyLead) {
      const legacyId = client.id.toString().replace('legacy_', '');
      
      try {
        // Use the view we created in the SQL script
        const { data: proformaData, error } = await supabase
          .from('proforma_with_rows')
          .select('*')
          .eq('lead_id', legacyId)
          .order('cdate', { ascending: false });
        
        if (error) {
          console.error('Error fetching legacy proformas:', error);
          return;
        }
        
        setLegacyProformas(proformaData || []);
      } catch (error) {
        console.error('Error fetching legacy proformas:', error);
      }
    }
  };

  // Helper function to get contact name by contact_id
  const getContactName = (contactId: number, contract?: any) => {
    
    // If contract has contact_name, use it directly
    if (contract?.contact_name) {
      return contract.contact_name;
    }
    
    // If contactId is null, undefined, or 0, return main contact name
    if (!contactId || contactId === 0) {
      return client?.name || 'Main Contact';
    }
    
    // Try to find the contact by ID
    const contact = contacts.find(c => c.id === contactId);
    if (contact?.name) {
      return contact.name;
    }
    
    // If not found, try to get from additional_contacts array
    if (client?.additional_contacts && Array.isArray(client.additional_contacts)) {
      // contact_id might be the index in the additional_contacts array
      const contactIndex = contactId - 1; // Assuming contact_id starts from 1
      if (client.additional_contacts[contactIndex]) {
        return client.additional_contacts[contactIndex].name || `Contact ${contactId}`;
      }
    }
    
    // Fallback
    return `Contact ${contactId}`;
  };

  const handleEditPayment = (row: PaymentPlan) => {
    setEditingPaymentId(row.id);
    // Preserve the original values instead of recalculating
    setEditPaymentData({ ...row });
  };

  const handleCancelEditPayment = () => {
    setEditingPaymentId(null);
    setEditPaymentData({});
  };

  const handleSaveEditPayment = async () => {
    setIsSavingPaymentRow(true);
    try {
      const currentUserName = await getCurrentUserName();
      
      // Check if this is a legacy payment
      const isLegacyPayment = editPaymentData.isLegacy;
      
      // Get the original payment data to compare changes
      let originalPayment;
      if (isLegacyPayment) {
        // For legacy payments, fetch from finances_paymentplanrow table
        const { data: legacyPayment } = await supabase
          .from('finances_paymentplanrow')
          .select('*')
          .eq('id', editPaymentData.id)
          .single();
        originalPayment = legacyPayment;
      } else {
        // For new payments, fetch from payment_plans table
        const { data: newPayment } = await supabase
          .from('payment_plans')
          .select('*')
          .eq('id', editPaymentData.id)
          .single();
        originalPayment = newPayment;
      }
      
      if (!originalPayment) {
        throw new Error('Original payment not found');
      }
      
      // Original payment and edit payment data available for comparison
      
      // Track changes for each field
      const changes = [];
      
      // Convert both original and edit values to numbers for proper comparison
      // Handle different field names for legacy vs new payments
      const originalDuePercent = Number(isLegacyPayment ? originalPayment.due_percent : originalPayment.due_percent);
      const editDuePercent = Number(editPaymentData.duePercent);
      const originalValue = Number(originalPayment.value);
      const editValue = Number(editPaymentData.value);
      const originalValueVat = Number(isLegacyPayment ? originalPayment.vat_value : originalPayment.value_vat);
      const editValueVat = Number(editPaymentData.valueVat);
      
              if (originalDuePercent !== editDuePercent) {
          changes.push({
          payment_plan_id: editPaymentData.id,
          field_name: 'due_percent',
          old_value: originalPayment.due_percent?.toString() || '',
          new_value: editPaymentData.duePercent?.toString() || '',
          changed_by: currentUserName,
          changed_at: new Date().toISOString()
        });
      }
      
              if (originalPayment.due_date !== editPaymentData.dueDate) {
          changes.push({
          payment_plan_id: editPaymentData.id,
          field_name: 'due_date',
          old_value: originalPayment.due_date || '',
          new_value: editPaymentData.dueDate || '',
          changed_by: currentUserName,
          changed_at: new Date().toISOString()
        });
      }
      
              if (originalValue !== editValue) {
          changes.push({
          payment_plan_id: editPaymentData.id,
          field_name: 'value',
          old_value: originalPayment.value?.toString() || '',
          new_value: editPaymentData.value?.toString() || '',
          changed_by: currentUserName,
          changed_at: new Date().toISOString()
        });
      }
      
              if (originalValueVat !== editValueVat) {
          changes.push({
          payment_plan_id: editPaymentData.id,
          field_name: isLegacyPayment ? 'vat_value' : 'value_vat',
          old_value: (isLegacyPayment ? originalPayment.vat_value : originalPayment.value_vat)?.toString() || '',
          new_value: editPaymentData.valueVat?.toString() || '',
          changed_by: currentUserName,
          changed_at: new Date().toISOString()
        });
      }
      
              if (originalPayment.client_name !== editPaymentData.client) {
          changes.push({
          payment_plan_id: editPaymentData.id,
          field_name: 'client_name',
          old_value: originalPayment.client_name || '',
          new_value: editPaymentData.client || '',
          changed_by: currentUserName,
          changed_at: new Date().toISOString()
        });
      }
      
              if (originalPayment.payment_order !== editPaymentData.order) {
          changes.push({
          payment_plan_id: editPaymentData.id,
          field_name: 'payment_order',
          old_value: originalPayment.payment_order || '',
          new_value: editPaymentData.order || '',
          changed_by: currentUserName,
          changed_at: new Date().toISOString()
        });
      }
      
              if (originalPayment.notes !== editPaymentData.notes) {
          changes.push({
          payment_plan_id: editPaymentData.id,
          field_name: 'notes',
          old_value: originalPayment.notes || '',
          new_value: editPaymentData.notes || '',
          changed_by: currentUserName,
          changed_at: new Date().toISOString()
        });
      }
      
              // Total changes detected and logged
      
      // Update the payment plan
      let error;
      if (isLegacyPayment) {
        // For legacy payments, update finances_paymentplanrow table
        const { error: legacyError } = await supabase
          .from('finances_paymentplanrow')
          .update({
            due_percent: editPaymentData.duePercent,
            due_date: editPaymentData.dueDate || null, // Set to null if empty
            value: editPaymentData.value,
            vat_value: editPaymentData.valueVat,
            notes: editPaymentData.notes,
          })
          .eq('id', editPaymentData.id);
        error = legacyError;
      } else {
        // For new payments, update payment_plans table
        const { error: newError } = await supabase
          .from('payment_plans')
          .update({
            due_percent: editPaymentData.duePercent,
            due_date: editPaymentData.dueDate || null, // Set to null if empty
            value: editPaymentData.value,
            value_vat: editPaymentData.valueVat,
            client_name: editPaymentData.client,
            payment_order: editPaymentData.order,
            notes: editPaymentData.notes,
          })
          .eq('id', editPaymentData.id);
        error = newError;
      }
      if (error) throw error;
      
      // Insert all changes into payment_plan_changes table (only for new payments)
      // Legacy payments don't use this table since lead_id has NOT NULL constraint
      if (changes.length > 0 && !isLegacyPayment) {
        // Add lead_id to each change record
        const changesWithLeadId = changes.map(change => ({
          ...change,
          lead_id: client?.id // Use UUID for new leads
        }));
        
        const { error: changesError } = await supabase
          .from('payment_plan_changes')
          .insert(changesWithLeadId);
        
                  if (changesError) {
            console.error('Error logging changes:', changesError);
          }
        } else if (changes.length > 0 && isLegacyPayment) {
          // Legacy payment changes - skipping change logging
        }
      
      toast.success('Payment row updated!');
      setEditingPaymentId(null);
      setEditPaymentData({});
      await refreshPaymentPlans();
    } catch (error) {
      console.error('Error updating payment:', error);
      toast.error('Failed to update payment row.');
    } finally {
      setIsSavingPaymentRow(false);
    }
  };

  const handleDeletePayment = async (row: PaymentPlan) => {
    if (!window.confirm('Are you sure you want to delete this payment row?')) return;
    try {
      const currentUserName = await getCurrentUserName();
      
      // Check if this is a legacy payment
      const isLegacyPayment = row.isLegacy;
      
      // Log the deletion in payment_plan_changes table (only for new payments)
      // Legacy payments don't use this table since lead_id has NOT NULL constraint
      if (!isLegacyPayment) {
        const { error: historyError } = await supabase
          .from('payment_plan_changes')
          .insert({
            payment_plan_id: null, // Set to null since we're deleting it
            lead_id: client?.id, // Use UUID for new leads
            field_name: 'payment_deleted',
            old_value: JSON.stringify({
              id: row.id,
              due_percent: row.duePercent,
              due_date: row.dueDate,
              value: row.value,
              value_vat: row.valueVat,
              client_name: row.client,
              payment_order: row.order,
              notes: row.notes,
              isLegacy: isLegacyPayment
            }),
            new_value: '',
            changed_by: currentUserName,
            changed_at: new Date().toISOString()
          });
        
        if (historyError) {
          console.error('Error logging deletion:', historyError);
          toast.error('Failed to log deletion history.');
          return;
        }
      } else {
        // Legacy payment deletion - skipping change logging
      }
      
      // Delete the payment plan
      let error;
      if (isLegacyPayment) {
        // For legacy payments, use soft delete by setting cancel_date
        const { error: legacyError } = await supabase
          .from('finances_paymentplanrow')
          .update({ cancel_date: new Date().toISOString().split('T')[0] })
          .eq('id', row.id);
        error = legacyError;
      } else {
        // For new payments, use soft delete by setting cancel_date
        const { error: newError } = await supabase
          .from('payment_plans')
          .update({ cancel_date: new Date().toISOString().split('T')[0] })
          .eq('id', row.id);
        error = newError;
      }
      if (error) throw error;
      
      toast.success('Payment row deleted!');
      await refreshPaymentPlans();
    } catch (error) {
      console.error('Error deleting payment:', error);
      toast.error('Failed to delete payment row.');
    }
  };

  // Generate proforma content as a structured object
  const generateProformaContent = async (data: any, createdBy: string) => {
    const total = data.rows.reduce((sum: number, r: any) => sum + Number(r.total), 0);
    const totalWithVat = data.addVat ? Math.round(total * 1.18 * 100) / 100 : total;
    
    // Generate proforma name
    const proformaName = await generateProformaName();
    
    return JSON.stringify({
      client: data.client,
      clientId: data.clientId,
      proformaName: proformaName,
      payment: data.payment,
      base: data.base,
      vat: data.vat,
      language: data.language,
      rows: data.rows,
      total: total,
      totalWithVat: totalWithVat,
      addVat: data.addVat,
      currency: data.currency,
      bankAccount: data.bankAccount,
      notes: data.notes,
      createdAt: new Date().toISOString(),
      createdBy: createdBy,
    });
  };

  // Handler to open proforma drawer
  const handleOpenProforma = async (payment: PaymentPlan) => {
    const proformaName = await generateProformaName();
    setGeneratedProformaName(proformaName);
    
    setProformaData({
      client: client?.name,
      clientId: client?.id,
      paymentRowId: payment.id,
      payment: payment.value + payment.valueVat,
      base: payment.value,
      vat: payment.valueVat,
      language: 'EN',
      rows: [
        { description: payment.order, qty: 1, rate: payment.value, total: payment.value },
      ],
      addVat: true,
      currency: '₪',
      bankAccount: '',
      notes: '',
    });
    setShowProformaDrawer(true);
  };

  // Handler for proforma row changes
  const handleProformaRowChange = (idx: number, field: string, value: any) => {
    setProformaData((prev: any) => {
      const rows = prev.rows.map((row: any, i: number) =>
        i === idx ? { ...row, [field]: value, total: field === 'qty' || field === 'rate' ? value * (field === 'qty' ? row.rate : row.qty) : row.total } : row
      );
      return { ...prev, rows };
    });
  };

  // Handler to add row
  const handleAddProformaRow = () => {
    setProformaData((prev: any) => ({
      ...prev,
      rows: [...prev.rows, { description: '', qty: 1, rate: 0, total: 0 }],
    }));
  };

  // Handler to delete row
  const handleDeleteProformaRow = (idx: number) => {
    setProformaData((prev: any) => ({
      ...prev,
      rows: prev.rows.filter((_: any, i: number) => i !== idx),
    }));
  };

  // Handler for create proforma
  const handleCreateProforma = async () => {
    if (!proformaData) return;
    try {
      let createdBy = 'Unknown';
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user && user.email) {
          const { data: userData, error } = await supabase
            .from('users')
            .select('full_name')
            .eq('email', user.email)
            .single();
          if (!error && userData?.full_name) {
            createdBy = userData.full_name;
          } else {
            createdBy = user.email;
          }
        }
      } catch {}
      // Generate proforma content with name and createdBy
      const proformaContent = await generateProformaContent(proformaData, createdBy);
      // Save proforma to the database for the specific payment row
      const { error } = await supabase
        .from('payment_plans')
        .update({ proforma: proformaContent })
        .eq('id', proformaData.paymentRowId);
      if (error) throw error;
      toast.success('Proforma created and saved successfully!');
      setShowProformaDrawer(false);
      setProformaData(null);
      await refreshPaymentPlans();
    } catch (error) {
      console.error('Error saving proforma:', error);
      toast.error('Failed to save proforma. Please try again.');
    }
  };

  // Function to view existing proforma
  const handleViewProforma = (payment: PaymentPlan) => {
    if (!payment.proforma || payment.proforma.trim() === '') return;
    
    try {
      const proformaData = JSON.parse(payment.proforma);
      setGeneratedProformaName(proformaData.proformaName || 'Proforma');
      setProformaData({
        ...proformaData,
        paymentRowId: payment.id,
        isViewMode: true, // Flag to indicate view-only mode
      });
      setShowProformaDrawer(true);
    } catch (error) {
      console.error('Error parsing proforma data:', error);
      toast.error('Failed to load proforma data.');
    }
  };

  const getProformaName = (proformaData: string) => {
    if (!proformaData || proformaData.trim() === '') {
      return 'Proforma';
    }
    
    try {
      const parsed = JSON.parse(proformaData);
      return parsed.proformaName || 'Proforma';
    } catch {
      return 'Proforma';
    }
  };

  // Add state for new payment row
  const [addingPaymentContact, setAddingPaymentContact] = useState<string | null>(null);
  const [newPaymentData, setNewPaymentData] = useState<any>({});

  // Handler to start adding a new payment for a contact
  const handleAddNewPayment = (contactName: string) => {
    // Determine the correct currency for this client
    let currency = '₪'; // Default
    const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
    
    if (isLegacyLead) {
      // For legacy leads, use balance_currency
      currency = client?.balance_currency || '₪';
    } else {
      // For new leads, use proposal_currency
      currency = client?.proposal_currency || '₪';
    }
    
    setAddingPaymentContact(contactName);
    setNewPaymentData({
      dueDate: '',
      value: '',
      duePercent: '',
      paymentOrder: 'Intermediate Payment',
      client: contactName,
      notes: '',
      paid: false,
      paid_at: null,
      paid_by: null,
      currency: currency, // Set the correct currency
    });
  };

  // Handler to cancel adding new payment
  const handleCancelNewPayment = () => {
    setAddingPaymentContact(null);
    setNewPaymentData({});
  };

  // Helper to get contract country for a contact name
  const getContractCountryForContact = (contactName: string) => {
    const contract = contracts.find(c => c.contact_name === contactName);
    return contract?.client_country || null;
  };

  // Handler to save new payment
  const handleSaveNewPayment = async () => {
    if (!newPaymentData.value || !newPaymentData.client || !newPaymentData.duePercent) {
      toast.error('Please fill in all required fields (Value, Client, and Due Percentage)');
      return;
    }

    setIsSavingPaymentRow(true);
    try {
      const currentUserName = await getCurrentUserName();
      
      // Check if this is a legacy lead
      const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
      
      if (isLegacyLead) {
        // For legacy leads, save to finances_paymentplanrow table
        const legacyId = client?.id?.toString().replace('legacy_', '');
        
        // Determine currency_id based on the payment currency
        let currencyId = 1; // Default to NIS
        const currency = newPaymentData.currency || '₪';
        if (currency) {
          switch (currency) {
            case '₪': currencyId = 1; break;
            case '€': currencyId = 2; break;
            case '$': currencyId = 3; break;
            case '£': currencyId = 4; break;
            default: currencyId = 1; break;
          }
        }
        
        // Map payment order strings to numeric values for legacy payments
        const getOrderNumber = (orderString: string): number => {
          switch (orderString) {
            case 'First Payment': return 1;
            case 'Intermediate Payment': return 5;
            case 'Final Payment': return 9;
            case 'Single Payment': return 90;
            case 'Expense (no VAT)': return 99;
            default: return 1; // Default to first payment
          }
        };

        // Map numeric values back to payment order strings for display
        const getOrderText = (orderNumber: number): string => {
          switch (orderNumber) {
            case 1: return 'First Payment';
            case 5: return 'Intermediate Payment';
            case 9: return 'Final Payment';
            case 90: return 'Single Payment';
            case 99: return 'Expense (no VAT)';
            default: return 'First Payment'; // Default fallback
          }
        };

        // Generate a unique numeric ID for the new payment
        const paymentId = Date.now() + Math.floor(Math.random() * 1000000);
        
        const paymentData = {
          id: paymentId,
          cdate: new Date().toISOString().split('T')[0], // Current date
          udate: new Date().toISOString().split('T')[0], // Current date
          date: newPaymentData.dueDate || null, // Set to null if empty
          value: Number(newPaymentData.value),
          vat_value: currency === '₪' ? Math.round(Number(newPaymentData.value) * 0.18 * 100) / 100 : 0,
          lead_id: legacyId,
          notes: newPaymentData.notes || '',
          due_date: newPaymentData.dueDate || null, // Set to null if empty
          due_percent: (() => {
            const percent = newPaymentData.duePercent || '0';
            const percentStr = percent.toString();
            return percentStr.includes('%') ? percentStr : percentStr + '%';
          })(), // Store the due percentage as text with % sign
          order: getOrderNumber(newPaymentData.paymentOrder || 'Intermediate Payment'), // Convert string to numeric
          currency_id: currencyId,
          client_id: null, // Will be null for legacy leads
        };
        
        const { data, error } = await supabase
          .from('finances_paymentplanrow')
          .insert(paymentData)
          .select();

        if (error) throw error;
      } else {
        // For new leads, save to payment_plans table
        const paymentData = {
          lead_id: client?.id,
          due_percent: Number(newPaymentData.duePercent) || Number(100),
          percent: Number(newPaymentData.duePercent) || Number(100),
          due_date: newPaymentData.dueDate || null, // Set to null if empty
          value: Number(newPaymentData.value),
          value_vat: 0,
          client_name: newPaymentData.client,
          payment_order: newPaymentData.paymentOrder || 'One-time Payment',
          notes: newPaymentData.notes || '',
          currency: newPaymentData.currency || '₪',
          created_by: currentUserName,
        };
        
        const { data, error } = await supabase
          .from('payment_plans')
          .insert(paymentData)
          .select();

        if (error) throw error;
      }

      // Payment created successfully

      toast.success('Payment plan created successfully');
      handleCancelNewPayment();
      refreshPaymentPlans();
    } catch (error) {
      console.error('Error creating payment plan:', error);
      toast.error('Failed to create payment plan');
    } finally {
      setIsSavingPaymentRow(false);
    }
  };

  // Add handlers for auto plan functionality
  const handleCreateAutoPlan = async () => {
    if (!autoPlanData.totalAmount || !autoPlanData.numberOfPayments) {
      toast.error('Please fill in all required fields');
      return;
    }

    setIsSavingPaymentRow(true);
    try {
      const currentUserName = await getCurrentUserName();
      const totalAmount = Number(autoPlanData.totalAmount);
      const firstPaymentAmount = (totalAmount * autoPlanData.firstPaymentPercent) / 100;
      const remainingAmount = totalAmount - firstPaymentAmount;
      const remainingPayments = autoPlanData.numberOfPayments - 1;
      const remainingPaymentAmount = remainingPayments > 0 ? remainingAmount / remainingPayments : 0;

      // Check if this is a legacy lead
      const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
      
      if (isLegacyLead) {
        // For legacy leads, save to finances_paymentplanrow table
        const legacyId = client?.id?.toString().replace('legacy_', '');
        
        // Determine currency_id based on the payment currency
        let currencyId = 1; // Default to NIS
        const currency = autoPlanData.currency || '₪';
        if (currency) {
          switch (currency) {
            case '₪': currencyId = 1; break;
            case '€': currencyId = 2; break;
            case '$': currencyId = 3; break;
            case '£': currencyId = 4; break;
            default: currencyId = 1; break;
          }
        }

        const legacyPayments = [];
        
        // Create first payment
        legacyPayments.push({
          cdate: new Date().toISOString().split('T')[0], // Current date
          udate: new Date().toISOString().split('T')[0], // Current date
          date: new Date().toISOString().split('T')[0], // Today's date
          value: firstPaymentAmount,
          vat_value: autoPlanData.includeVat && autoPlanData.currency === '₪' ? Math.round(firstPaymentAmount * 0.18 * 100) / 100 : 0,
          lead_id: legacyId,
          notes: '',
          due_date: new Date().toISOString().split('T')[0], // Today's date
          due_percent: autoPlanData.firstPaymentPercent.toString() + '%', // Store the due percentage as text with % sign
          order: 1, // First Payment
          currency_id: currencyId,
          client_id: null, // Will be null for legacy leads
        });

        // Create remaining payments
        for (let i = 1; i < autoPlanData.numberOfPayments; i++) {
          const paymentPercent = remainingPayments > 0 ? (100 - autoPlanData.firstPaymentPercent) / remainingPayments : 0;
          // Determine order based on position: first = 1, intermediate = 5, final = 9
          let orderValue = 5; // Default to intermediate
          if (i === autoPlanData.numberOfPayments - 1) {
            orderValue = 9; // Final payment
          } else if (i === 0) {
            orderValue = 1; // First payment
          }
          
          legacyPayments.push({
            cdate: new Date().toISOString().split('T')[0], // Current date
            udate: new Date().toISOString().split('T')[0], // Current date
            date: null, // No due date for subsequent payments
            value: remainingPaymentAmount,
            vat_value: autoPlanData.includeVat && autoPlanData.currency === '₪' ? Math.round(remainingPaymentAmount * 0.18 * 100) / 100 : 0,
            lead_id: legacyId,
            notes: '',
            due_date: null, // No due date for subsequent payments
            due_percent: paymentPercent.toString() + '%', // Store the calculated due percentage as text with % sign
            order: orderValue, // Use proper numeric order values
            currency_id: currencyId,
            client_id: null, // Will be null for legacy leads
          });
        }

        const { data: insertedLegacyPayments, error: legacyPaymentInsertError } = await supabase
          .from('finances_paymentplanrow')
          .insert(legacyPayments)
          .select('id');

        if (legacyPaymentInsertError) throw legacyPaymentInsertError;
      } else {
        // For new leads, save to payment_plans table
        const payments = [];
        
        // Create first payment
        payments.push({
          lead_id: client?.id,
          due_percent: autoPlanData.firstPaymentPercent,
          due_date: new Date().toISOString().split('T')[0], // Today's date
          value: firstPaymentAmount,
          value_vat: autoPlanData.includeVat && autoPlanData.currency === '₪' ? Math.round(firstPaymentAmount * 0.18 * 100) / 100 : 0,
          client_name: client?.name || 'Main Contact',
          payment_order: 'First Payment',
          notes: '',
          currency: autoPlanData.currency,
          created_by: currentUserName,
        });

        // Create remaining payments
        for (let i = 1; i < autoPlanData.numberOfPayments; i++) {
          const paymentPercent = remainingPayments > 0 ? (100 - autoPlanData.firstPaymentPercent) / remainingPayments : 0;
          payments.push({
            lead_id: client?.id,
            due_percent: paymentPercent,
            due_date: null, // No due date for subsequent payments
            value: remainingPaymentAmount,
            value_vat: autoPlanData.includeVat && autoPlanData.currency === '₪' ? Math.round(remainingPaymentAmount * 0.18 * 100) / 100 : 0,
            client_name: client?.name || 'Main Contact',
            payment_order: i === 1 ? 'Intermediate Payment' : i === 2 ? 'Final Payment' : `${i + 1}th Payment`,
            notes: '',
            currency: autoPlanData.currency,
            created_by: currentUserName,
          });
        }

        // Log the auto plan creation in payment_plan_changes table
        const changesToInsert = payments.map(payment => ({
          lead_id: client?.id,
          payment_plan_id: null, // Will be set after insertion
          field_name: 'auto_plan_created',
          old_value: null,
          new_value: JSON.stringify({
            payment_order: payment.payment_order,
            value: payment.value,
            due_date: payment.due_date,
            client_name: payment.client_name,
            total_amount: totalAmount,
            currency: autoPlanData.currency
          }),
          changed_by: currentUserName,
          changed_at: new Date().toISOString()
        }));

        // Insert the payment plans first
        const { data: insertedPayments, error: paymentInsertError } = await supabase
          .from('payment_plans')
          .insert(payments)
          .select('id');

        if (paymentInsertError) throw paymentInsertError;

        // Now update the payment_plan_id in the changes records
        if (insertedPayments && insertedPayments.length > 0) {
          const updatedChanges = changesToInsert.map((change, index) => ({
            ...change,
            payment_plan_id: insertedPayments[index]?.id || null
          }));

          const { error: historyError } = await supabase
            .from('payment_plan_changes')
            .insert(updatedChanges);
          
          if (historyError) console.error('Error logging auto plan creation:', historyError);
        }
      }

      toast.success('Auto finance plan created successfully');
      setShowStagesDrawer(false);
      setAutoPlanData({
        totalAmount: '',
        currency: '₪',
        numberOfPayments: 3,
        firstPaymentPercent: 50,
        includeVat: true
      });
      refreshPaymentPlans();
    } catch (error) {
      console.error('Error creating auto plan:', error);
      toast.error('Failed to create auto finance plan');
    } finally {
      setIsSavingPaymentRow(false);
    }
  };

  const handleOpenStagesDrawer = () => {
    setShowStagesDrawer(true);
  };

  const handleCloseStagesDrawer = () => {
    setShowStagesDrawer(false);
    setAutoPlanData({
      totalAmount: '',
      currency: '₪',
      numberOfPayments: 3,
      firstPaymentPercent: 50,
      includeVat: true
    });
  };

  // 1. Add state to track which contact's history is open
  const [openHistoryContact, setOpenHistoryContact] = useState<string | null>(null);
  const [paymentHistory, setPaymentHistory] = useState<{ [contact: string]: any[] }>({});

  // 2. Add a function to fetch payment history for a contact
  const fetchPaymentHistory = async (contactName: string) => {
    if (!client?.id) return;
    if (paymentHistory[contactName]) {
      setOpenHistoryContact(openHistoryContact === contactName ? null : contactName);
      return;
    }
    try {
      // 1. Get all payment links for this client
      const { data: links, error: linksError } = await supabase
        .from('payment_links')
        .select('id')
        .eq('client_id', client.id);
      if (linksError) throw linksError;
      const linkIds = links?.map(link => link.id) || [];
      if (linkIds.length === 0) {
        setPaymentHistory((prev) => ({ ...prev, [contactName]: [] }));
        setOpenHistoryContact(contactName);
        return;
      }
      // 2. Get all payment transactions for those links
      const { data, error } = await supabase
        .from('payment_transactions')
        .select('*')
        .in('payment_link_id', linkIds)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setPaymentHistory((prev) => ({ ...prev, [contactName]: data || [] }));
      setOpenHistoryContact(contactName);
    } catch (error) {
      toast.error('Failed to fetch payment history');
    }
  };

  // Helper function to get current user's full name from Supabase users table
  const getCurrentUserName = async (): Promise<string> => {
          try {
        // Get current user from Supabase auth
        const { data: { user } } = await supabase.auth.getUser();
        
        if (!user?.email) {
          return 'System User';
        }
      
              // Get user from users table
        const { data: userData, error } = await supabase
          .from('users')
          .select('full_name, first_name, last_name, email')
          .eq('email', user.email)
          .single();
        
        if (error) {
          return user.email;
        }
        
        if (userData) {
          if (userData.full_name) {
            return userData.full_name;
          } else if (userData.first_name && userData.last_name) {
            const name = `${userData.first_name} ${userData.last_name}`;
            return name;
          } else if (userData.first_name) {
            return userData.first_name;
          } else if (userData.last_name) {
            return userData.last_name;
          } else {
            return userData.email;
          }
        }
        
        return user.email;
    } catch (error) {
      console.error('Error getting current user name:', error);
      return 'System User';
    }
  };

  if (!financePlan) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <BanknotesIcon className="w-16 h-16 text-primary mb-4" />
        <div className="text-2xl font-bold text-gray-800 mb-2">No finance plan created yet.</div>
        <div className="text-gray-500 mb-6">Create a payments plan to see finances here.</div>
        {onCreateFinancePlan && (
          <button
            className="btn btn-md bg-black text-white border-none gap-3 shadow-sm text-lg font-bold py-3 px-6"
            onClick={onCreateFinancePlan}
          >
            <BanknotesIcon className="w-5 h-5 text-white" />
            Create Finance Plan
          </button>
        )}
      </div>
    );
  }

  // Calculate totals from current payments
  const total = financePlan.payments.reduce((sum: number, p: PaymentPlan) => sum + Number(p.value), 0);
  const vat = financePlan.payments.reduce((sum: number, p: PaymentPlan) => sum + Number(p.valueVat), 0);

  // Group payments by currency for overall total
  const paymentsByCurrency = financePlan.payments.reduce((acc: { [currency: string]: number }, p: PaymentPlan) => {
    const currency = p.currency || '₪';
    acc[currency] = (acc[currency] || 0) + Number(p.value) + Number(p.valueVat);
    return acc;
  }, {});

  // Before rendering payment rows, calculate total:
  const totalPayments = financePlan.payments.reduce((sum, p) => sum + Number(p.value || 0) + Number(p.valueVat || 0), 0);
  // Before rendering payment rows, calculate totalBalanceWithVat:
  const totalBalanceWithVat = (client?.balance || 0) * 1.18;

  // Helper to get currency symbol
  const getCurrencySymbol = (currency: string | undefined) => {
    if (!currency) return '₪';
    // Map currency codes to symbols
    if (currency === 'ILS' || currency === '₪') return '₪';
    if (currency === 'USD' || currency === '$') return '$';
    if (currency === 'EUR' || currency === '€') return '€';
    // If it's already a symbol, return as-is
    return currency;
  };

  // Helper to convert numeric order back to descriptive text
  const getOrderText = (orderNumber: number): string => {
    switch (orderNumber) {
      case 1: return 'First Payment';
      case 5: return 'Intermediate Payment';
      case 9: return 'Final Payment';
      case 90: return 'Single Payment';
      case 99: return 'Expense (no VAT)';
      default: return `Payment ${orderNumber}`;
    }
  };

  // Sort payments by due date (or fallback to original order if no due dates)
  const sortedPayments = [...financePlan.payments].sort((a, b) => {
    if (a.dueDate && b.dueDate) {
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    } else if (a.dueDate && !b.dueDate) {
      return -1; // a comes before b
    } else if (!a.dueDate && b.dueDate) {
      return 1; // b comes before a
    }
    return 0; // both have no dueDate, keep original order
  });
  const firstPaymentId = sortedPayments[0]?.id;

  // Find the payment that should display the due date: 'First Payment' or 'archival' in order/label, or duePercent === '100'
  const dueDatePayment = financePlan.payments.find(p => {
    const order = (p.order || '').toLowerCase();
    return order.includes('first payment') || order.includes('archival') || p.duePercent === '100';
  });
  const dueDatePaymentId = dueDatePayment ? dueDatePayment.id : financePlan.payments[0]?.id;

  return (
    <>
      <div className="overflow-x-auto w-full">
        {/* Contract Information Section */}
        {contracts.length > 0 ? (
          <div className="mb-8">
            <div className="bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden">
              {/* Header */}
              <div className="px-6 py-4 border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <DocumentTextIcon className="w-6 h-6 text-purple-600" />
                    <div>
                      <h3 className="text-xl font-bold text-gray-900">Contract Information</h3>
                      <p className="text-gray-500 text-sm">Active contracts and details</p>
                    </div>
                  </div>
                  {!hideTimelineHistory && (
                    <button 
                      className="btn btn-sm btn-outline"
                      onClick={refreshAllData}
                      title="Refresh data"
                    >
                      <ArrowPathIcon className="w-4 h-4" />
                      Refresh
                    </button>
                  )}
                </div>
              </div>
              
              {/* Contract Cards */}
              <div className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {contracts.map((contract) => (
                    <div key={contract.id} className="group relative bg-white rounded-xl p-6 border border-gray-200 hover:border-purple-300 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-[1.02]">
                      {/* Status badge */}
                      <div className="absolute top-4 right-4">
                        <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold ${
                          contract.status === 'signed' 
                            ? 'bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none shadow-sm' 
                            : 'bg-yellow-100 text-yellow-800 border border-yellow-200'
                        }`}>
                          {contract.status === 'signed' ? 'Signed' : 'Draft'}
                        </span>
                      </div>
                      
                      {/* Contract title */}
                      <div className="mb-4">
                        <h4 className="text-lg font-bold text-gray-900 mb-1">
                          {contract.contract_templates?.name || 'Contract'}
                        </h4>
                        {(contract.contact_id || contract.isLegacy) && (
                          <p className="text-sm text-purple-600 font-medium mb-1">
                            {contract.isLegacy ? (contract.contact_name || client.name || 'Legacy Client') : getContactName(contract.contact_id, contract)}
                          </p>
                        )}
                        <div className="w-12 h-1 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full"></div>
                      </div>
                      
                      {/* Contract details */}
                      <div className="space-y-3">
                        
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-gray-500">Applicants</span>
                          <span className="text-sm font-bold text-gray-900">
                            {contract.isLegacy ? contract.applicant_count : contract.applicant_count}
                          </span>
                        </div>
                        {contract.isLegacy && contract.cost_per_applicant > 0 && (
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-gray-500">Cost per Applicant</span>
                            <span className="text-sm font-bold text-gray-900">
                              {getCurrencySymbol(client?.balance_currency)}{contract.cost_per_applicant.toLocaleString()}
                            </span>
                          </div>
                        )}
                        
                        
                        
                        {(contract.total_amount || contract.isLegacy) && (
                          <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                            <span className="text-sm font-medium text-gray-500">Total Amount</span>
                            <span className="text-lg font-bold text-purple-700">
                              {contract.isLegacy ? (
                                // For legacy contracts, use the calculated total from contract
                                contract.total_amount > 0 ? (
                                  <>
                                    {getCurrencySymbol(client?.balance_currency)}{contract.total_amount.toLocaleString()}
                                  </>
                                ) : (
                                  // Fallback to finance plan total if contract total is 0
                                  financePlan ? (
                                    <>
                                      {getCurrencySymbol(financePlan.payments[0]?.currency || client?.balance_currency)}
                                      {financePlan.total.toLocaleString()}
                                    </>
                                  ) : (
                                    'N/A'
                                  )
                                )
                              ) : (
                                // For new contracts, use the contract total
                                <>
                                  {getCurrencySymbol(contract.client_country)}{contract.total_amount.toLocaleString()}
                                </>
                              )}
                            </span>
                          </div>
                        )}
                        
                        {(contract.signed_at || (contract.isLegacy && contract.status === 'signed')) && (
                          <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                            <span className="text-sm font-medium text-gray-500">Signed Date</span>
                            <span className="text-sm font-bold text-gray-900">
                              {contract.signed_at ? 
                                new Date(contract.signed_at).toLocaleDateString('en-GB') : 
                                '---'
                              }
                            </span>
                          </div>
                        )}
                      </div>
                      

                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="mb-8">
            <div className="bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden">
              {/* Header */}
              <div className="px-6 py-4 border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <DocumentTextIcon className="w-6 h-6 text-purple-600" />
                    <div>
                      <h3 className="text-xl font-bold text-gray-900">Contract Information</h3>
                      <p className="text-gray-500 text-sm">Active contracts and details</p>
                    </div>
                  </div>
                  {!hideTimelineHistory && (
                    <button 
                      className="btn btn-sm btn-outline"
                      onClick={refreshAllData}
                      title="Refresh data"
                    >
                      <ArrowPathIcon className="w-4 h-4" />
                      Refresh
                    </button>
                  )}
                </div>
              </div>
              
              {/* Empty state */}
              <div className="p-12 text-center">
                <div className="w-20 h-20 bg-gradient-to-br from-gray-100 to-gray-200 rounded-full flex items-center justify-center mx-auto mb-6">
                  <DocumentTextIcon className="w-10 h-10 text-gray-400" />
                </div>
                <h4 className="text-lg font-bold text-gray-800 mb-2">No Contracts Found</h4>
                <p className="text-gray-500 mb-4">This client doesn't have any contracts yet.</p>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 max-w-md mx-auto">
                  <p className="text-sm text-blue-800">
                    💡 <strong>Tip:</strong> Create a contract in the Contact Info tab to see it displayed here.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Payments Plan Section */}
        <div className="mb-8">
          <div className="bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <BanknotesIconSolid className="w-6 h-6 text-green-600" />
                  <div>
                    <h3 className="text-xl font-bold text-gray-900">Payments Plan</h3>
                    <p className="text-gray-500 text-sm">Payment schedule and financial overview</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  {/* Total Amount Display */}
                  <div className="text-right">
                    <div className="text-lg font-bold text-gray-900">
                      {Object.keys(paymentsByCurrency).length === 1 ? (
                        // Single currency
                        <>
                          {Object.entries(paymentsByCurrency).map(([currency, amount]) => {
                            const currencyPayments = financePlan.payments.filter(p => p.currency === currency);
                            const totalValue = currencyPayments.reduce((sum, p) => sum + Number(p.value), 0);
                            const totalVat = currencyPayments.reduce((sum, p) => sum + Number(p.valueVat), 0);
                            return (
                              <span key={currency}>
                                {getCurrencySymbol(currency)}{totalValue.toLocaleString()}
                                {totalVat > 0 && (
                                  <span className="text-gray-600"> + {getCurrencySymbol(currency)}{totalVat.toLocaleString()}</span>
                                )}
                              </span>
                            );
                          })}
                        </>
                      ) : (
                        // Multiple currencies
                        <>
                          {Object.entries(paymentsByCurrency).map(([currency, amount], idx) => {
                            const currencyPayments = financePlan.payments.filter(p => p.currency === currency);
                            const totalValue = currencyPayments.reduce((sum, p) => sum + Number(p.value), 0);
                            const totalVat = currencyPayments.reduce((sum, p) => sum + Number(p.valueVat), 0);
                            return (
                              <span key={currency}>
                                {getCurrencySymbol(currency)}{totalValue.toLocaleString()}
                                {totalVat > 0 && (
                                  <span className="text-gray-600"> + {getCurrencySymbol(currency)}{totalVat.toLocaleString()}</span>
                                )}
                                {idx < Object.entries(paymentsByCurrency).length - 1 ? ' | ' : ''}
                              </span>
                            );
                          })}
                        </>
                      )}
                    </div>
                    <div className="text-xs text-gray-500">Total Amount</div>
                  </div>
                  {/* Sync Balance Button */}
                  {financePlan && client?.balance !== total && (
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => updateClientBalance(total)}
                      title="Sync client balance with finance plan total"
                    >
                      <ArrowPathIcon className="w-4 h-4" />
                      <span className="hidden md:inline ml-1">Sync Balance</span>
                    </button>
                  )}
                  {/* View Toggle Button */}
                  <button
                    className="btn btn-sm btn-outline"
                    onClick={() => setViewMode(viewMode === 'table' ? 'boxes' : 'table')}
                    title={viewMode === 'table' ? 'Switch to Box View' : 'Switch to Table View'}
                  >
                    {viewMode === 'table' ? (
                      <Squares2X2Icon className="w-4 h-4" />
                    ) : (
                      <Bars3Icon className="w-4 h-4" />
                    )}
                    <span className="hidden md:inline ml-1">{viewMode === 'table' ? 'Box View' : 'Table View'}</span>
                  </button>
                  
                </div>
              </div>
            </div>
            
            {/* Content */}
            <div className="p-6">
              {/* Group payments by contact */}
              {(() => {
                // Group payments by client name
                const paymentsByContact = financePlan.payments.reduce((acc: { [key: string]: PaymentPlan[] }, payment: PaymentPlan) => {
                  const contactName = payment.client;
                  if (!acc[contactName]) {
                    acc[contactName] = [];
                  }
                  acc[contactName].push(payment);
                  return acc;
                }, {});

                return Object.entries(paymentsByContact).map(([contactName, payments], contactIndex) => {
                  // Sort this contact's payments by due date (or fallback to original order if no due dates)
                  // Robust due date parsing and sorting
                  const parseDueDate = (dateStr: string | null | undefined) => {
                    if (!dateStr) return Infinity;
                    const d = new Date(dateStr);
                    return isNaN(d.getTime()) ? Infinity : d.getTime();
                  };
                  const sortedContactPayments = [...payments].sort((a, b) => {
                    const aTime = parseDueDate(a.dueDate);
                    const bTime = parseDueDate(b.dueDate);
                    return aTime - bTime;
                  });
                  // Sorted payments for this contact
                  // Find the payment that should display the due date for this contact
                  const dueDatePayment = sortedContactPayments.find(p => {
                    const order = (p.order || '').toLowerCase();
                    return order.includes('first payment') || order.includes('archival') || p.duePercent === '100';
                  });
                  const dueDatePaymentId = dueDatePayment ? dueDatePayment.id : sortedContactPayments[0]?.id;
                  return (
                    <div key={contactName} className="mb-8">
                      {/* Contact Header */}
                      <div className="mb-4">
                      <div className="mb-2 flex justify-end">
       <button
         className="btn btn-xs btn-outline btn-primary"
         onClick={() => fetchPaymentHistory(contactName)}
       >
         {openHistoryContact === contactName ? 'Hide' : 'Show'} Payment History
       </button>
     </div>
     {openHistoryContact === contactName && (
       <div className="bg-base-100 rounded-lg shadow p-4 mt-2">
         <h4 className="font-semibold mb-2">Payment History</h4>
         {paymentHistory[contactName]?.length ? (
           <table className="table w-full text-sm">
             <thead>
               <tr>
                 <th>Date</th>
                 <th>Amount</th>
                 <th>Method</th>
                 <th>Status</th>
               </tr>
             </thead>
             <tbody>
               {paymentHistory[contactName].map((tx, idx) => (
                 <tr key={tx.id || idx}>
                   <td>{tx.created_at ? new Date(tx.created_at).toLocaleString() : ''}</td>
                   <td>{tx.amount ? `₪${tx.amount.toLocaleString()}` : ''}</td>
                   <td>{tx.payment_method || ''}</td>
                   <td>{tx.status || ''}</td>
                 </tr>
               ))}
             </tbody>
           </table>
         ) : (
           <div className="text-gray-500">No payment history found.</div>
         )}
       </div>
     )}
                        <div 
                          className="flex items-center gap-3 bg-white rounded-lg p-4 border border-purple-200 cursor-pointer hover:from-purple-100 hover:to-blue-100 transition-all duration-200"
                          onClick={() => setCollapsedContacts(prev => ({ ...prev, [contactName]: !prev[contactName] }))}
                          title={collapsedContacts[contactName] ? "Expand payments" : "Collapse payments"}
                        >
                          <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-blue-600 rounded-full flex items-center justify-center">
                            <UserIcon className="w-5 h-5 text-white" />
                          </div>
                          <div className="flex-1">
                            <h3 className="text-lg font-bold text-gray-900">{contactName}</h3>
                            <p className="text-sm text-gray-600">Finance Plan</p>
                          </div>
                          <div className="text-right mr-4">
                            <div className="text-lg font-bold text-gray-900">
                              {/* Use the currency of the first payment for this contact */}
                              {getCurrencySymbol(payments[0]?.currency)}{payments.reduce((sum, p) => sum + p.value + p.valueVat, 0).toLocaleString()}
                            </div>
                            <div className="text-xs text-gray-500">Total for {contactName}</div>
                          </div>
                          {/* Collapse/Expand Arrow */}
                          <div className="flex items-center justify-center w-8 h-8">
                            {collapsedContacts[contactName] ? (
                              <svg className="w-5 h-5 text-purple-600 transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            ) : (
                              <svg className="w-5 h-5 text-purple-600 transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                              </svg>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Table or Box view for this contact */}
                      {!collapsedContacts[contactName] && (
                        <>
                          {viewMode === 'table' ? (
                            <div className="bg-white rounded-xl p-4 border border-gray-200 overflow-x-auto">
                              <table className="min-w-full rounded-xl overflow-hidden">
                                <thead className="bg-base-200 sticky top-0 z-10">
                                  <tr>
                                    <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">Due %</th>
                                    <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">Due Date</th>
                                    <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">Value</th>
                                    <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">Total</th>
                                    <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">Contact</th>
                                    <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">Payment Date</th>
                                    <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">Order</th>
                                    <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">Proforma</th>
                                    <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">Notes</th>
                                    <th className="px-4 py-3 text-center"></th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {sortedContactPayments.map((p: PaymentPlan, idx: number) => {
                                    const isPaid = p.paid;
                                    return (
                                      <tr
                                        key={p.id || idx}
                                        className={`transition-all duration-200 ${
                                          isPaid
                                            ? 'bg-green-50 border-l-4 border-green-400'
                                            : idx % 2 === 0
                                              ? 'bg-white border-l-4 border-transparent'
                                              : 'bg-base-100 border-l-4 border-transparent'
                                        } hover:bg-blue-50 rounded-xl shadow-sm`}
                                        style={{ 
                                          verticalAlign: 'middle', 
                                          position: 'relative',
                                          ...(isPaid && {
                                            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='100' viewBox='0 0 200 100'%3E%3Ctext x='100' y='50' font-family='Arial, sans-serif' font-size='24' font-weight='bold' fill='rgba(34,197,94,0.13)' text-anchor='middle' dominant-baseline='middle' transform='rotate(-20 100 50)'%3EPAID%3C/text%3E%3C/svg%3E")`,
                                            backgroundRepeat: 'no-repeat',
                                            backgroundPosition: 'center',
                                            backgroundSize: 'contain'
                                          }),
                                        }}
                                      >
                                        {/* Each column in correct order: */}
                                        <td className="font-bold text-lg align-middle text-center px-4 py-3 whitespace-nowrap">
  {editingPaymentId === p.id ? (
    <input
      type="number"
      min={0}
      max={100}
      className="input input-bordered input-lg w-20 text-center font-bold rounded-xl border-2 border-blue-300 focus:border-blue-500 no-arrows"
      value={editPaymentData.duePercent}
      onChange={e => {
        const newDuePercent = Number(e.target.value);
        setEditPaymentData((d: any) => ({ ...d, duePercent: newDuePercent }));
      }}
    />
  ) : (
    p.duePercent
  )}
</td>
                                        <td className="align-middle text-center px-4 py-3 whitespace-nowrap">
  {editingPaymentId === p.id ? (
    <input
      type="date"
      className="input input-bordered w-48 text-right"
      value={editPaymentData.dueDate ? editPaymentData.dueDate.slice(0, 10) : ''}
      onChange={e => setEditPaymentData((d: any) => ({ ...d, dueDate: e.target.value }))}
      required
    />
  ) : (
    <span className="text-sm font-bold text-gray-900">{p.dueDate && new Date(p.dueDate).toString() !== 'Invalid Date' ? new Date(p.dueDate).toLocaleDateString() : ''}</span>
  )}
</td>
                                        <td className="font-bold align-middle text-center px-4 py-3 whitespace-nowrap">
  {editingPaymentId === p.id ? (
    <div className="flex items-center gap-2">
      <input
        type="number"
        className={`input input-bordered input-lg w-32 text-right font-bold rounded-xl border-2 border-blue-300 no-arrows ${editingValueVatId === p.id ? '' : 'bg-gray-100 text-gray-500 cursor-not-allowed'}`}
        value={editPaymentData.value}
        readOnly={editingValueVatId !== p.id}
        onChange={editingValueVatId === p.id ? (e) => setEditPaymentData((d: any) => ({ ...d, value: e.target.value })) : undefined}
      />
      <span className='text-gray-500 font-bold'>+
        <input
          type="number"
          className={`input input-bordered input-lg w-20 text-right font-bold rounded-xl border-2 border-blue-300 no-arrows ${editingValueVatId === p.id ? '' : 'bg-gray-100 text-gray-500 cursor-not-allowed'}`}
          value={editPaymentData.valueVat}
          readOnly={editingValueVatId !== p.id}
          onChange={editingValueVatId === p.id ? (e) => setEditPaymentData((d: any) => ({ ...d, valueVat: e.target.value })) : undefined}
        />
      </span>
      {editingValueVatId === p.id ? (
        <button className="btn btn-xs btn-ghost ml-1" onClick={() => setEditingValueVatId(null)} title="Done editing Value/VAT">
          <CheckIcon className="w-4 h-4 text-green-600" />
        </button>
      ) : (
        <button className="btn btn-xs btn-ghost ml-1" onClick={() => setEditingValueVatId(p.id)} title="Edit Value/VAT">
          <PencilIcon className="w-4 h-4 text-blue-600" />
        </button>
      )}
    </div>
  ) : (
    <span className="text-sm font-bold text-gray-900">
      {getCurrencySymbol(p.currency)}
      {p.value.toLocaleString(undefined, { minimumFractionDigits: 2 })}
      + {p.valueVat.toLocaleString(undefined, { minimumFractionDigits: 2 })}
    </span>
  )}
</td>
                                        <td className="font-bold align-middle text-center px-4 py-3 whitespace-nowrap">
                                          <span className="text-sm font-bold text-gray-900">{getCurrencySymbol(p.currency)}{(p.value + p.valueVat).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                        </td>
                                        <td className="align-middle text-center px-4 py-3 whitespace-nowrap">
                                          <div className="flex items-center justify-center gap-2">
                                            <div className="w-6 h-6 bg-gradient-to-br from-purple-500 to-blue-600 rounded-full flex items-center justify-center">
                                              <UserIcon className="w-3 h-3 text-white" />
                                            </div>
                                            <div className="text-left">
                                              <div className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                                                {p.client}
                                              </div>
                                              {/* Removed contract template name */}
                                            </div>
                                          </div>
                                        </td>
                                        <td className="align-middle text-center px-4 py-3 whitespace-nowrap">
                                          {p.paid_at ? new Date(p.paid_at).toLocaleDateString() : '---'}
                                        </td>
                                        <td className="align-middle text-center px-4 py-3 whitespace-nowrap">{p.order}</td>
                                        <td className="align-middle text-center px-4 py-3 whitespace-nowrap">
                                          {p.isLegacy ? (
                                            // For legacy leads, show proforma if available
                                            (() => {
                                              // For legacy leads, try to match proformas with specific payment rows
                                              // Only show proformas that are specifically linked to this payment row
                                              const paymentProformas = legacyProformas.filter(proforma => 
                                                proforma.ppr_id === p.id
                                              );
                                              
                                              if (paymentProformas.length > 0) {
                                                return (
                                                  <div className="flex flex-col gap-1">
                                                    {paymentProformas.slice(0, 2).map((proforma, idx) => (
                                                      <button 
                                                        key={proforma.id}
                                                        className="btn btn-sm btn-outline btn-success border-success/40 text-xs font-medium" 
                                                        title={`View Proforma ${proforma.id}`}
                                                        onClick={e => { e.preventDefault(); navigate(`/proforma-legacy/${proforma.id}`); }}
                                                      >
                                                        Proforma {proforma.id}
                                                      </button>
                                                    ))}
                                                    {paymentProformas.length > 2 && (
                                                      <span className="text-xs text-gray-500">+{paymentProformas.length - 2} more</span>
                                                    )}
                                                  </div>
                                                );
                                              } else {
                                                return (
                                                  <button 
                                                    className="btn btn-sm btn-outline btn-primary text-xs font-medium" 
                                                    title="Create Proforma" 
                                                    onClick={e => { e.preventDefault(); navigate(`/proforma-legacy/create/${client.id.toString().replace('legacy_', '')}?ppr_id=${p.id}`); }}
                                                  >
                                                    Create Proforma
                                                  </button>
                                                );
                                              }
                                            })()
                                          ) : p.proforma && p.proforma.trim() !== '' ? (
                                            <button 
                                              className="btn btn-sm btn-outline btn-success text-xs font-medium border-success/40" 
                                              title="View Proforma" 
                                              onClick={e => { e.preventDefault(); navigate(`/proforma/${p.id}`); }}
                                            >
                                              {getProformaName(p.proforma)}
                                            </button>
                                          ) : (
                                            <button 
                                              className="btn btn-sm btn-outline btn-primary text-xs font-medium" 
                                              title="Create Proforma" 
                                              onClick={e => { e.preventDefault(); navigate(`/proforma/create/${p.id}`); }}
                                            >
                                              Create Proforma
                                            </button>
                                          )}
                                        </td>
                                        <td className="align-middle text-center px-4 py-3 whitespace-nowrap">{p.notes}</td>
                                        <td className="flex gap-2 justify-end align-middle min-w-[80px] px-4 py-3">
                                          {p.id ? (
                                            editingPaymentId === p.id ? (
                                              <>
                                                <button
                                                  className="btn btn-xs btn-success"
                                                  onClick={handleSaveEditPayment}
                                                  disabled={isSavingPaymentRow}
                                                >
                                                  <CheckIcon className="w-4 h-4" />
                                                </button>
                                                <button
                                                  className="btn btn-xs btn-ghost"
                                                  onClick={handleCancelEditPayment}
                                                  title="Cancel"
                                                >
                                                  <XMarkIcon className="w-4 h-4 text-red-500" />
                                                </button>
                                              </>
                                            ) : (
                                              <>
                                                {/* Payment Link icon - disabled for legacy */}
                                                {p.proforma && !isPaid && !p.isLegacy && (
                                                  <button
                                                    className="btn btn-sm btn-circle bg-blue-100 hover:bg-blue-200 text-blue-700 border-blue-300 border-2 shadow-sm flex items-center justify-center"
                                                    title="Generate Payment Link"
                                                    onClick={() => handleGeneratePaymentLink(p)}
                                                    style={{ padding: 0 }}
                                                  >
                                                    <LinkIcon className="w-5 h-5" />
                                                  </button>
                                                )}
                                                {/* Ready to Pay button - available for all */}
                                                {!isPaid && !p.ready_to_pay && (
                                                  <button
                                                    className="btn btn-sm btn-circle bg-yellow-100 hover:bg-yellow-200 text-yellow-700 border-yellow-300 border-2 shadow-sm flex items-center justify-center"
                                                    title="Mark as Ready to Pay"
                                                    onClick={() => handleMarkAsReadyToPay(p)}
                                                    style={{ padding: 0 }}
                                                  >
                                                    <PaperAirplaneIcon className="w-5 h-5" />
                                                  </button>
                                                )}
                                                {/* Sent to Finances indicator */}
                                                {!isPaid && p.ready_to_pay && (
                                                  <div className="flex items-center gap-1 text-red-600 text-xs font-bold">
                                                    <ExclamationTriangleIcon className="w-4 h-4" />
                                                    <span>Sent to Finances</span>
                                                  </div>
                                                )}
                                                {/* Dollar icon (small) - available for all */}
                                                {!isPaid && (
                                                  <button
                                                    className="btn btn-sm btn-circle bg-green-100 hover:bg-green-200 text-green-700 border-green-300 border-2 shadow-sm flex items-center justify-center"
                                                    title={p.isLegacy ? "Mark Legacy Payment as Paid" : "Mark as Paid"}
                                                    onClick={() => handleMarkAsPaid(p.id)}
                                                    style={{ padding: 0 }}
                                                  >
                                                    <CurrencyDollarIcon className="w-5 h-5" />
                                                  </button>
                                                )}
                                                {/* Edit icon (small) - available for all */}
                                                <button
                                                  className="btn btn-sm btn-circle bg-gray-100 hover:bg-gray-200 text-primary border-none shadow-sm flex items-center justify-center"
                                                  title="Edit"
                                                  onClick={() => handleEditPayment(p)}
                                                  style={{ padding: 0 }}
                                                >
                                                  <PencilIcon className="w-5 h-5" />
                                                </button>
                                                {/* Delete icon (small) - available for all */}
                                                <button
                                                  className="btn btn-sm btn-circle bg-red-100 hover:bg-red-200 text-red-500 border-none shadow-sm flex items-center justify-center"
                                                  title="Delete"
                                                  onClick={() => handleDeletePayment(p)}
                                                  style={{ padding: 0 }}
                                                >
                                                  <TrashIcon className="w-5 h-5" />
                                                </button>
                                              </>
                                            )
                                          ) : (
                                            <span className="text-gray-400">—</span>
                                          )}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                  {addingPaymentContact === contactName && (
                                    viewMode === 'table' ? (
                                      <tr>
                                        <td className="font-bold text-lg align-middle text-center px-4 py-3 whitespace-nowrap">
                                          <input 
                                            type="number" 
                                            className="input input-bordered w-20 text-center" 
                                            value={newPaymentData.duePercent} 
                                            onChange={e => setNewPaymentData((d: any) => ({ ...d, duePercent: e.target.value }))} 
                                            placeholder="%"
                                          />
                                        </td>
                                        <td className="align-middle text-center px-4 py-3 whitespace-nowrap">
                                          <input type="date" className="input input-bordered w-48 text-right" value={newPaymentData.dueDate} onChange={e => setNewPaymentData((d: any) => ({ ...d, dueDate: e.target.value }))} />
                                        </td>
                                        <td className="font-bold align-middle text-center px-4 py-3 whitespace-nowrap">
                                          <div className="flex items-center gap-2 justify-center">
                                            <input type="number" className="input input-bordered input-lg w-32 text-right font-bold rounded-xl border-2 border-blue-300 no-arrows" value={newPaymentData.value} onChange={e => {
                                              const value = e.target.value;
                                              let vat = 0;
                                              // Only apply VAT for Israeli Shekels (₪), not for other currencies like USD ($)
                                              const currency = financePlan?.payments[0]?.currency || '₪';
                                              if (currency === '₪') {
                                                vat = Math.round(Number(value) * 0.18 * 100) / 100;
                                              }
                                              
                                              // Calculate due percentage based on value vs total column
                                              const totalAmount = getTotalAmount();
                                              const duePercent = totalAmount > 0 ? Math.round((Number(value) / totalAmount) * 100) : 0;
                                              
                                              setNewPaymentData((d: any) => ({ ...d, value, valueVat: vat, duePercent }));
                                            }} />
                                            <span className='text-gray-500 font-bold'>+</span>
                                            <input type="number" className="input input-bordered input-lg w-20 text-right font-bold rounded-xl border-2 border-blue-300 no-arrows bg-gray-100 text-gray-500 cursor-not-allowed" value={newPaymentData.valueVat || 0} readOnly />
                                          </div>
                                        </td>
                                        <td className="font-bold align-middle text-center px-4 py-3 whitespace-nowrap">
                                          <span className="text-sm font-bold text-gray-900">
                                            {getCurrencySymbol(newPaymentData.currency || '₪')}
                                            {(Number(newPaymentData.value || 0) + Number(newPaymentData.valueVat || 0)).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                          </span>
                                        </td>
                                        <td className="align-middle text-center px-4 py-3 whitespace-nowrap">
                                          <select className="select select-bordered w-full max-w-[200px]" value={newPaymentData.client} onChange={e => setNewPaymentData((d: any) => ({ ...d, client: e.target.value }))}>
                                            <option value="">Select contact</option>
                                            <option value={client.name}>{client.name} (Main)</option>
                                            {contacts.map((c, idx) => (
                                              <option key={c.id || idx} value={c.name}>{c.name}</option>
                                            ))}
                                          </select>
                                        </td>
                                        <td className="align-middle text-center px-4 py-3 whitespace-nowrap"></td>
                                        <td className="align-middle text-center px-4 py-3 whitespace-nowrap">
                                          <select 
                                            className="select select-bordered w-full max-w-[200px]" 
                                            value={newPaymentData.paymentOrder} 
                                            onChange={e => setNewPaymentData((d: any) => ({ ...d, paymentOrder: e.target.value }))}
                                          >
                                            <option value="First Payment">First Payment</option>
                                            <option value="Intermediate Payment">Intermediate Payment</option>
                                            <option value="Final Payment">Final Payment</option>
                                            <option value="Single Payment">Single Payment</option>
                                            <option value="Expense (no VAT)">Expense (no VAT)</option>
                                          </select>
                                        </td>
                                        <td className="align-middle text-center px-4 py-3 whitespace-nowrap"></td>
                                        <td className="align-middle text-center px-4 py-3 whitespace-nowrap">
                                          <input className="input input-bordered w-full max-w-[200px] text-right" value={newPaymentData.notes} onChange={e => setNewPaymentData((d: any) => ({ ...d, notes: e.target.value }))} placeholder="Notes" />
                                        </td>
                                        <td className="flex gap-2 justify-end align-middle min-w-[80px] px-4 py-3">
                                          <button className="btn btn-sm btn-success" onClick={handleSaveNewPayment} disabled={isSavingPaymentRow || !newPaymentData.value || !newPaymentData.duePercent}><CheckIcon className="w-4 h-4" /></button>
                                          <button className="btn btn-sm btn-ghost" onClick={handleCancelNewPayment}><XMarkIcon className="w-4 h-4 text-red-500" /></button>
                                        </td>
                                      </tr>
                                    ) : (
                                      <div className="bg-white rounded-2xl p-6 shadow-2xl border flex flex-col gap-0 relative group min-h-[480px] mt-4">
                                        <div className="flex flex-col gap-0 divide-y divide-base-200">
                                          <div className="flex items-center justify-between py-3">
                                            <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Due %</span>
                                            <input 
                                              type="number" 
                                              className="input input-bordered w-20 text-center" 
                                              value={newPaymentData.duePercent} 
                                              onChange={e => setNewPaymentData((d: any) => ({ ...d, duePercent: e.target.value }))} 
                                              placeholder="%"
                                            />
                                          </div>
                                          <div className="flex items-center justify-between py-3">
                                            <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Due Date</span>
                                            {/* Only show due date input for the first payment row (idx === 0), else show disabled input */}
                                            {0 === 0 ? (
                                              <input
                                                type="date"
                                                className="input input-bordered w-48 text-right"
                                                value={newPaymentData.dueDate}
                                                onChange={e => setNewPaymentData((d: any) => ({ ...d, dueDate: e.target.value }))}
                                              />
                                            ) : (
                                              <input
                                                type="text"
                                                className="input input-bordered w-48 text-right bg-gray-100 text-gray-400"
                                                value={''}
                                                disabled
                                              />
                                            )}
                                          </div>
                                          <div className="flex items-center justify-between py-3">
                                            <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Value</span>
                                            <input type="number" className="input input-bordered input-lg w-32 text-right font-bold rounded-xl border-2 border-blue-300 no-arrows" value={newPaymentData.value} onChange={e => {
                                              const value = e.target.value;
                                              let vat = 0;
                                              // Only apply VAT for Israeli Shekels (₪), not for other currencies like USD ($)
                                              const currency = financePlan?.payments[0]?.currency || '₪';
                                              if (currency === '₪') {
                                                vat = Math.round(Number(value) * 0.18 * 100) / 100;
                                              }
                                              
                                              // Calculate due percentage based on value vs total column
                                              const totalAmount = getTotalAmount();
                                              const duePercent = totalAmount > 0 ? Math.round((Number(value) / totalAmount) * 100) : 0;
                                              
                                              setNewPaymentData((d: any) => ({ ...d, value, valueVat: vat, duePercent }));
                                            }} />
                                          </div>
                                          <div className="flex items-center justify-between py-3">
                                            <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">VAT</span>
                                            <input type="number" className="input input-bordered input-lg w-28 text-right font-bold rounded-xl border-2 border-blue-300 no-arrows bg-gray-100 text-gray-500 cursor-not-allowed" value={(getContractCountryForContact(newPaymentData.client) === 'IL') ? Math.round(Number(newPaymentData.value || 0) * 0.18 * 100) / 100 : 0} readOnly />
                                          </div>
                                          <div className="flex items-center justify-between py-3">
                                            <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Contact</span>
                                            <select className="select select-bordered w-full" value={newPaymentData.client} onChange={e => setNewPaymentData((d: any) => ({ ...d, client: e.target.value }))}>
                                              <option value="">Select contact</option>
                                              <option value={client.name}>{client.name} (Main)</option>
                                              {contacts.map((c, idx) => (
                                                <option key={c.id || idx} value={c.name}>{c.name}</option>
                                              ))}
                                            </select>
                                          </div>
                                          <div className="flex items-center justify-between py-3">
                                            <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Order</span>
                                            <select 
                                              className="select select-bordered w-full" 
                                              value={newPaymentData.paymentOrder} 
                                              onChange={e => setNewPaymentData((d: any) => ({ ...d, paymentOrder: e.target.value }))}
                                            >
                                              <option value="First Payment">First Payment</option>
                                              <option value="Intermediate Payment">Intermediate Payment</option>
                                              <option value="Final Payment">Final Payment</option>
                                              <option value="Single Payment">Single Payment</option>
                                              <option value="Expense (no VAT)">Expense (no VAT)</option>
                                            </select>
                                          </div>
                                          <div className="flex items-center justify-between py-3">
                                            <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Notes</span>
                                            <input className="input input-bordered w-48 text-right" value={newPaymentData.notes} onChange={e => setNewPaymentData((d: any) => ({ ...d, notes: e.target.value }))} />
                                          </div>
                                          <div className="flex gap-2 justify-end pt-4">
                                            <button className="btn btn-xs btn-success" onClick={handleSaveNewPayment} disabled={isSavingPaymentRow || !newPaymentData.value || !newPaymentData.duePercent}>Save</button>
                                            <button className="btn btn-xs btn-ghost" onClick={handleCancelNewPayment}>Cancel</button>
                                          </div>
                                        </div>
                                      </div>
                                    )
                                  )}
                                </tbody>
                              </table>
                              
                              {/* Total and Left to Plan Display - Below Payment Table */}
                              {addingPaymentContact && (
                              <div className="mt-6 p-6">
                                <div className="flex flex-col md:flex-row gap-6 items-center justify-center">
                                  {/* Total Amount */}
                                  <div 
                                    className="flex items-center gap-4 bg-white rounded-xl px-6 py-4 shadow-lg border border-purple-200 min-w-[200px] cursor-pointer hover:shadow-xl hover:scale-105 transition-all duration-200"
                                    onClick={() => handleBoxClick('total')}
                                    title="Click to use full total amount"
                                  >
                                    <div className="flex flex-col items-center">
                                      <span className="text-base font-medium text-gray-600">Total Amount</span>
                                      <span className="text-2xl font-bold text-purple-600">
                                        {getCurrencySymbol(financePlan?.payments[0]?.currency || '₪')}{getTotalAmount().toLocaleString()}
                                      </span>
                                    </div>
                                    <button 
                                      className="btn btn-md bg-purple-600 text-white border-purple-600 hover:bg-purple-700 hover:border-purple-700 rounded-full px-4"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openPercentageModal('total');
                                      }}
                                      title="Calculate percentage of total amount"
                                    >
                                      %
                                    </button>
                                  </div>
                                  
                                  {/* Left to Plan Amount */}
                                  <div 
                                    className="flex items-center gap-4 bg-white rounded-xl px-6 py-4 shadow-lg border border-green-200 min-w-[200px] cursor-pointer hover:shadow-xl hover:scale-105 transition-all duration-200"
                                    onClick={() => handleBoxClick('leftToPlan')}
                                    title="Click to use left to plan amount"
                                  >
                                    <div className="flex flex-col items-center">
                                      <span className="text-base font-medium text-gray-600">Left to Plan</span>
                                      <span className="text-2xl font-bold text-green-600">
                                        {getCurrencySymbol(financePlan?.payments[0]?.currency || '₪')}{getLeftToPlanAmount().toLocaleString()}
                                      </span>
                                    </div>
                                    <button 
                                      className="btn btn-md btn-success rounded-full px-4"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openPercentageModal('leftToPlan');
                                      }}
                                      title="Calculate percentage of left to plan amount"
                                    >
                                      %
                                    </button>
                                  </div>
                                </div>
                              </div>
                              )}
                            </div>
                          ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 gap-y-8">
                              {sortedContactPayments.map((p: PaymentPlan, idx: number) => {
                                const isPaid = p.paid;
                                return (
                                  <div
                                    key={p.id || idx}
                                    className={`bg-white rounded-2xl p-6 shadow-2xl hover:shadow-3xl transition-all duration-200 border flex flex-col gap-0 relative group min-h-[480px] ${isPaid ? 'border-green-500 ring-2 ring-green-400' : 'border-base-200'}`}
                                    style={{ position: 'relative', overflow: 'hidden' }}
                                  >

                                    {/* Paid Watermark */}
                                    {isPaid && (
                                      <div style={{
                                        position: 'absolute',
                                        top: '50%',
                                        left: '50%',
                                        transform: 'translate(-50%, -50%) rotate(-20deg)',
                                        fontSize: '3rem',
                                        color: 'rgba(34,197,94,0.15)',
                                        fontWeight: 900,
                                        letterSpacing: 2,
                                        pointerEvents: 'none',
                                        zIndex: 10,
                                        textShadow: '0 2px 8px rgba(34,197,94,0.2)'
                                      }}>PAID</div>
                                    )}
                                    {/* Due Badge */}
                                    {p.proforma && !isPaid && (
                                      <span className="absolute top-4 right-4 bg-yellow-400 text-white font-bold px-4 py-1 rounded-full shadow-lg text-xs z-20 animate-pulse">Due</span>
                                    )}
                                    {/* Card content */}
                                    {editingPaymentId === p.id ? (
                                      <div className="flex flex-col gap-0 divide-y divide-base-200">
                                        <div className="flex items-center justify-between py-3">
                                          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Due %</span>
                                          <input className="input input-bordered w-40 text-right" value={editPaymentData.duePercent} onChange={e => setEditPaymentData((d: any) => ({ ...d, duePercent: e.target.value }))} />
                                        </div>
                                        <div className="flex items-center justify-between py-3">
                                          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Due Date</span>
                                          {editingPaymentId === p.id ? (
                                            <input
                                              type="date"
                                              className="input input-bordered w-48 text-right"
                                              value={editPaymentData.dueDate ? editPaymentData.dueDate.slice(0, 10) : ''}
                                              onChange={e => setEditPaymentData((d: any) => ({ ...d, dueDate: e.target.value }))}
                                              required
                                            />
                                          ) : (
                                            <span className="text-sm font-bold text-gray-900">{p.dueDate && new Date(p.dueDate).toString() !== 'Invalid Date' ? new Date(p.dueDate).toLocaleDateString() : ''}</span>
                                          )}
                                        </div>
                                        <div className="flex items-center justify-between py-3">
                                          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Value</span>
                                          <div className="flex items-center gap-2">
                                            <input
                                              type="number"
                                              className={`input input-bordered input-lg w-32 text-right font-bold rounded-xl border-2 border-blue-300 no-arrows ${editingValueVatId === p.id ? '' : 'bg-gray-100 text-gray-500 cursor-not-allowed'}`}
                                              value={editPaymentData.value}
                                              readOnly={editingValueVatId !== p.id}
                                              onChange={editingValueVatId === p.id ? (e) => setEditPaymentData((d: any) => ({ ...d, value: e.target.value })) : undefined}
                                            />
                                            {editingValueVatId === p.id ? (
                                              <button className="btn btn-xs btn-ghost ml-1" onClick={() => setEditingValueVatId(null)} title="Done editing Value">
                                                <CheckIcon className="w-4 h-4 text-green-600" />
                                              </button>
                                            ) : (
                                              <button className="btn btn-xs btn-ghost ml-1" onClick={() => setEditingValueVatId(p.id)} title="Edit Value">
                                                <PencilIcon className="w-4 h-4 text-blue-600" />
                                              </button>
                                            )}
                                          </div>
                                        </div>
                                        <div className="flex items-center justify-between py-3">
                                          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Total</span>
                                          <div className="flex items-center gap-2">
                                            <input
                                              type="number"
                                              className={`input input-bordered input-lg w-28 text-right font-bold rounded-xl border-2 border-blue-300 no-arrows ${editingValueVatId === p.id ? '' : 'bg-gray-100 text-gray-500 cursor-not-allowed'}`}
                                              value={editPaymentData.value + editPaymentData.valueVat}
                                              readOnly={true}
                                            />
                                            <span className="text-xs text-gray-500">(auto)</span>
                                          </div>
                                        </div>
                                        <div className="flex items-center justify-between py-3">
                                          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Client</span>
                                          <input className="input input-bordered w-48 text-right" value={editPaymentData.client} onChange={e => setEditPaymentData((d: any) => ({ ...d, client: e.target.value }))} />
                                        </div>
                                        <div className="flex items-center justify-between py-3">
                                          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Order</span>
                                          <input className="input input-bordered w-48 text-right" value={editPaymentData.order} onChange={e => setEditPaymentData((d: any) => ({ ...d, order: e.target.value }))} />
                                        </div>
                                        <div className="flex items-center justify-between py-3">
                                          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Notes</span>
                                          <input className="input input-bordered w-48 text-right" value={editPaymentData.notes} onChange={e => setEditPaymentData((d: any) => ({ ...d, notes: e.target.value }))} />
                                        </div>
                                        <div className="flex gap-2 justify-end pt-4">
                                          <button className="btn btn-xs btn-success" onClick={handleSaveEditPayment} disabled={isSavingPaymentRow}>Save</button>
                                          <button className="btn btn-xs btn-ghost" onClick={handleCancelEditPayment}>Cancel</button>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="flex flex-col gap-0 divide-y divide-base-200">
                                        {/* Improved purple row: order left, percent center, actions right (icons black on white circle) */}
                                        <div className="flex items-center bg-white text-primary rounded-t-2xl px-5 py-3" style={{ minHeight: '64px' }}>
                                          {/* Order (left) */}
                                          <span className="text-xs font-bold uppercase tracking-wider text-left truncate" style={{ minWidth: '120px' }}>{p.order}</span>
                                          {/* Percent (center) */}
                                          <span className="font-extrabold text-3xl tracking-tight text-center w-24 flex-shrink-0 flex-grow-0">
                                            {p.duePercent}%
                                          </span>
                                          {/* Actions (right) */}
                                          <div className="flex gap-2 items-center ml-4">
                                            {p.id ? (
                                              <>
                                                {!p.isLegacy && (
                                                  <button
                                                    className="btn btn-sm btn-circle bg-gray-100 hover:bg-gray-200 text-primary border-none shadow-sm flex items-center justify-center"
                                                    title="Delete"
                                                    onClick={() => handleDeletePayment(p)}
                                                    style={{ padding: 0 }}
                                                  >
                                                    <TrashIcon className="w-5 h-5" />
                                                  </button>
                                                )}
                                                {!p.isLegacy && (
                                                  <button
                                                    className="btn btn-sm btn-circle bg-gray-100 hover:bg-gray-200 text-primary border-none shadow-sm flex items-center justify-center"
                                                    title="Edit"
                                                    onClick={() => handleEditPayment(p)}
                                                    style={{ padding: 0 }}
                                                  >
                                                    <PencilIcon className="w-5 h-5" />
                                                  </button>
                                                )}
                                              </>
                                            ) : (
                                              <span className="text-gray-400">—</span>
                                            )}
                                          </div>
                                        </div>
                                        
                                        {/* Payment details */}
                                        <div className="flex flex-col gap-0 divide-y divide-base-200">
                                          <div className="flex items-center justify-between py-3">
                                            <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">DUE DATE</span>
                                            <span className="text-sm font-bold text-gray-900">{p.id === dueDatePaymentId ? (p.dueDate ? (new Date(p.dueDate).toString() !== 'Invalid Date' ? new Date(p.dueDate).toLocaleDateString() : '') : '') : ''}</span>
                                          </div>
                                          <div className="flex items-center justify-between py-3">
                                            <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">VALUE</span>
                                            <span className="text-sm font-bold text-gray-900">
                                              {getCurrencySymbol(p.currency)}
                                              {p.value.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                            </span>
                                          </div>
                                          <div className="flex items-center justify-between py-3">
                                            <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">TOTAL</span>
                                            <span className="text-sm font-bold text-gray-900">
                                              {getCurrencySymbol(p.currency)}
                                              {(p.value + p.valueVat).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                            </span>
                                          </div>
                                          <div className="flex items-center justify-between py-3">
                                            <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">CLIENT</span>
                                            <div className="flex items-center gap-2">
                                              <span className="text-sm font-bold text-gray-900">{p.client}</span>
                                            </div>
                                          </div>
                                          <div className="flex items-center justify-between py-3">
                                            <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">PAYMENT DATE</span>
                                            <span className="text-sm font-bold text-gray-900">
                                              {p.paid_at ? new Date(p.paid_at).toLocaleDateString() : '---'}
                                            </span>
                                          </div>
                                          <div className="flex items-center justify-between py-3">
                                            <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">PROFORMA</span>
                                            <div className="text-sm">
                                              {p.isLegacy ? (
                                                // For legacy leads, show proforma if available
                                                (() => {
                                                  // For legacy leads, try to match proformas with specific payment rows
                                                  // Only show proformas that are specifically linked to this payment row
                                                  const paymentProformas = legacyProformas.filter(proforma => 
                                                    proforma.ppr_id === p.id
                                                  );
                                                  
                                                  if (paymentProformas.length > 0) {
                                                    return (
                                                      <div className="flex flex-col gap-1">
                                                        {paymentProformas.slice(0, 1).map((proforma, idx) => (
                                                          <button 
                                                            key={proforma.id}
                                                            className="btn btn-sm btn-outline btn-success border-success/40 text-xs font-medium" 
                                                            title={`View Proforma ${proforma.id}`}
                                                            onClick={e => { e.preventDefault(); navigate(`/proforma-legacy/${proforma.id}`); }}
                                                          >
                                                            Proforma {proforma.id}
                                                          </button>
                                                        ))}
                                                        {paymentProformas.length > 1 && (
                                                          <span className="text-xs text-gray-500">+{paymentProformas.length - 1} more</span>
                                                        )}
                                                      </div>
                                                    );
                                                  } else {
                                                    return (
                                                      <button 
                                                        className="btn btn-sm btn-outline btn-primary text-xs font-medium" 
                                                        title="Create Proforma" 
                                                        onClick={e => { e.preventDefault(); navigate(`/proforma-legacy/create/${client.id.toString().replace('legacy_', '')}?ppr_id=${p.id}`); }}
                                                      >
                                                        Create Proforma
                                                      </button>
                                                    );
                                                  }
                                                })()
                                              ) : p.proforma && p.proforma.trim() !== '' ? (
                                                <button 
                                                  className="btn btn-sm btn-outline btn-success text-xs font-medium border-success/40" 
                                                  title="View Proforma" 
                                                  onClick={e => { e.preventDefault(); navigate(`/proforma/${p.id}`); }}
                                                >
                                                  {getProformaName(p.proforma)}
                                                </button>
                                              ) : (
                                                <button 
                                                  className="btn btn-sm btn-outline btn-primary text-xs font-medium" 
                                                  title="Create Proforma" 
                                                  onClick={e => { e.preventDefault(); navigate(`/proforma/create/${p.id}`); }}
                                                >
                                                  Create Proforma
                                                </button>
                                              )}
                                            </div>
                                          </div>
                                          <div className="flex items-center justify-between py-3">
                                            <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">NOTES</span>
                                            <span className="text-sm font-bold text-gray-900">{p.notes}</span>
                                          </div>
                                        </div>
                                        
                                        {/* Payment status indicator */}
                                        <div className="absolute bottom-4 right-4 flex gap-2">
                                          {/* Payment Link icon - disabled for legacy */}
                                          {p.proforma && !isPaid && !p.isLegacy && (
                                            <button
                                              className="btn btn-circle btn-md bg-blue-100 hover:bg-blue-200 text-blue-700 border-blue-300 border-2 shadow-sm flex items-center justify-center"
                                              title="Generate Payment Link"
                                              onClick={() => handleGeneratePaymentLink(p)}
                                              style={{ padding: 0 }}
                                            >
                                              <LinkIcon className="w-5 h-5" />
                                            </button>
                                          )}
                                          {/* Ready to Pay button - available for all */}
                                          {!isPaid && !p.ready_to_pay && (
                                            <button
                                              className="btn btn-circle btn-md bg-yellow-100 hover:bg-yellow-200 text-yellow-700 border-yellow-300 border-2 shadow-sm flex items-center justify-center"
                                              title="Mark as Ready to Pay"
                                              onClick={() => handleMarkAsReadyToPay(p)}
                                              style={{ padding: 0 }}
                                            >
                                              <PaperAirplaneIcon className="w-5 h-5" />
                                            </button>
                                          )}
                                          {/* Sent to Finances indicator */}
                                          {!isPaid && p.ready_to_pay && (
                                            <div className="flex items-center gap-1 text-red-600 text-xs font-bold bg-white px-2 py-1 rounded-full border border-red-200">
                                              <ExclamationTriangleIcon className="w-4 h-4" />
                                              <span>Sent to Finances</span>
                                            </div>
                                          )}
                                          {/* Dollar icon (small) - available for all */}
                                          {!isPaid && (
                                            <button
                                              className="btn btn-circle btn-md bg-green-100 hover:bg-green-200 text-green-700 border-green-300 border-2 shadow-sm flex items-center justify-center"
                                              title={p.isLegacy ? "Mark Legacy Payment as Paid" : "Mark as Paid"}
                                              onClick={() => handleMarkAsPaid(p.id)}
                                              style={{ padding: 0 }}
                                            >
                                              <CurrencyDollarIcon className="w-5 h-5" />
                                            </button>
                                          )}
                                          {/* Edit icon (small) - available for all */}
                                          <button
                                            className="btn btn-circle btn-md bg-gray-100 hover:bg-gray-200 text-primary border-none shadow-sm flex items-center justify-center"
                                            title="Edit"
                                            onClick={() => handleEditPayment(p)}
                                            style={{ padding: 0 }}
                                          >
                                            <PencilIcon className="w-5 h-5" />
                                          </button>
                                          {/* Delete icon (small) - available for all */}
                                          <button
                                            className="btn btn-circle btn-md bg-red-100 hover:bg-red-200 text-red-500 border-none shadow-sm flex items-center justify-center"
                                            title="Delete"
                                            onClick={() => handleDeletePayment(p)}
                                            style={{ padding: 0 }}
                                          >
                                            <TrashIcon className="w-5 h-5" />
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                });
              })()}
              
              {/* Add new payment button */}
              <div className="mt-10 flex justify-start">
                <button className="btn btn-outline btn-primary text-xs font-medium" onClick={() => handleAddNewPayment(client?.name || 'Main Contact')}>Add new payment</button>
              </div>

              {/* Deleted Payments Section */}
              <div className="mt-8">
                <div className="flex items-center gap-3 bg-white rounded-xl p-4 border border-gray-200 cursor-pointer hover:bg-gray-50 transition-all duration-200" onClick={() => {
                  setShowDeletedPayments(!showDeletedPayments);
                  if (!showDeletedPayments) {
                    fetchDeletedPayments();
                  }
                }}>
                  <div className="flex items-center gap-2">
                    <TrashIcon className="w-5 h-5 text-orange-500" />
                    <h4 className="text-lg font-bold text-gray-800">Deleted Payments</h4>
                  </div>
                  <div className="flex items-center gap-2 ml-auto">
                    <span className="text-sm text-gray-500">{deletedPayments.length} deleted payment{deletedPayments.length !== 1 ? 's' : ''}</span>
                    <svg className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${showDeletedPayments ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
                
                {showDeletedPayments && (
                  <div className="mt-4 p-6 bg-white rounded-xl border border-gray-200">
                  
                  {deletedPayments.length > 0 ? (
                    <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
                      <table className="min-w-full rounded-xl overflow-hidden">
                        <thead className="bg-base-200 sticky top-0 z-10">
                          <tr>
                            <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">Due %</th>
                            <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">Due Date</th>
                            <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">Value</th>
                            <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">Total</th>
                            <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">Contact</th>
                            <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">Payment Date</th>
                            <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">Order</th>
                            <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">Proforma</th>
                            <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">Notes</th>
                            <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">Deleted Date</th>
                            <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {deletedPayments.map((p: any, idx: number) => (
                            <tr
                              key={p.id || idx}
                              className="bg-red-50 border-l-4 border-red-400 hover:bg-red-100 rounded-xl shadow-sm transition-all duration-200"
                              style={{ 
                                verticalAlign: 'middle', 
                                position: 'relative'
                              }}
                            >
                              {/* Due % */}
                              <td className="font-bold text-lg align-middle text-center px-4 py-3 whitespace-nowrap">
                                {p.due_percent || p.duePercent}
                              </td>
                              
                              {/* Due Date */}
                              <td className="align-middle text-center px-4 py-3 whitespace-nowrap">
                                <span className="text-sm font-bold text-gray-900">
                                  {p.due_date ? (new Date(p.due_date).toString() !== 'Invalid Date' ? new Date(p.due_date).toLocaleDateString() : '') : ''}
                                </span>
                              </td>
                              
                              {/* Value */}
                              <td className="font-bold align-middle text-center px-4 py-3 whitespace-nowrap">
                                <span className="text-sm font-bold text-gray-900">
                                  {(() => {
                                    const isLegacyPayment = p.accounting_currencies;
                                    const currency = isLegacyPayment 
                                      ? p.accounting_currencies?.iso_code || '₪'
                                      : p.currency || '₪';
                                    const vatValue = isLegacyPayment ? p.vat_value : p.value_vat;
                                    
                                    return (
                                      <>
                                        {getCurrencySymbol(currency)}{Number(p.value || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                        + {Number(vatValue || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                      </>
                                    );
                                  })()}
                                </span>
                              </td>
                              
                              {/* Total */}
                              <td className="font-bold align-middle text-center px-4 py-3 whitespace-nowrap">
                                <span className="text-sm font-bold text-gray-900">
                                  {(() => {
                                    const isLegacyPayment = p.accounting_currencies;
                                    const currency = isLegacyPayment 
                                      ? p.accounting_currencies?.iso_code || '₪'
                                      : p.currency || '₪';
                                    const vatValue = isLegacyPayment ? p.vat_value : p.value_vat;
                                    
                                    return (
                                      <>
                                        {getCurrencySymbol(currency)}{(Number(p.value || 0) + Number(vatValue || 0)).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                      </>
                                    );
                                  })()}
                                </span>
                              </td>
                              
                              {/* Contact */}
                              <td className="align-middle text-center px-4 py-3 whitespace-nowrap">
                                <div className="flex items-center justify-center gap-2">
                                  <div className="w-6 h-6 bg-gradient-to-br from-red-500 to-pink-600 rounded-full flex items-center justify-center">
                                    <UserIcon className="w-3 h-3 text-white" />
                                  </div>
                                  <div className="text-left">
                                    <div className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                                      {p.client || p.client_name}
                                    </div>
                                  </div>
                                </div>
                              </td>
                              
                              {/* Payment Date */}
                              <td className="align-middle text-center px-4 py-3 whitespace-nowrap">
                                {p.paid_at ? new Date(p.paid_at).toLocaleDateString() : '---'}
                              </td>
                              
                              {/* Order */}
                              <td className="align-middle text-center px-4 py-3 whitespace-nowrap">
                                {p.order ? getOrderText(p.order) : p.payment_order ? getOrderText(p.payment_order) : '---'}
                              </td>
                              
                              {/* Proforma */}
                              <td className="align-middle text-center px-4 py-3 whitespace-nowrap">
                                {p.proforma && p.proforma.trim() !== '' ? (
                                  <span className="text-sm text-gray-600 line-through">
                                    {p.proforma}
                                  </span>
                                ) : (
                                  <span className="text-sm text-gray-400">---</span>
                                )}
                              </td>
                              
                              {/* Notes */}
                              <td className="align-middle text-center px-4 py-3 whitespace-nowrap">
                                {p.notes || '---'}
                              </td>
                              
                              {/* Deleted Date */}
                              <td className="align-middle text-center px-4 py-3 whitespace-nowrap">
                                <span className="text-sm font-medium text-red-600">
                                  {p.cancel_date ? new Date(p.cancel_date).toLocaleDateString() : '---'}
                                </span>
                              </td>
                              
                              {/* Actions */}
                              <td className="flex gap-2 justify-end align-middle min-w-[80px] px-4 py-3">
                                <button
                                  className="btn btn-xs btn-success"
                                  onClick={() => handleRestorePayment(p.id)}
                                  title="Restore this payment"
                                >
                                  <ArrowUturnLeftIcon className="w-3 h-3" />
                                  Restore
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="text-center py-8 text-gray-500">
                      <TrashIcon className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                      <p>No deleted payments found</p>
                    </div>
                  )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Proforma Drawer */}
      {showProformaDrawer && proformaData && ReactDOM.createPortal(
        <div className="fixed inset-0 z-[100] flex">
          {/* Overlay */}
          <div className="fixed inset-0 bg-black/30" onClick={() => setShowProformaDrawer(false)} />
          {/* Drawer */}
          <div className="ml-auto w-full max-w-4xl h-full bg-white shadow-2xl p-0 flex flex-col animate-slideInRight z-[110] overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-r from-indigo-700 via-purple-700 to-teal-600 text-white p-8 border-b border-blue-200">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-3xl font-extrabold mb-1">Create Proforma</h2>
                  <p className="text-blue-100 text-lg">Client: {proformaData.client}</p>
                </div>
                <button className="btn btn-ghost btn-lg text-white hover:bg-white/20" onClick={() => setShowProformaDrawer(false)}>
                  <XMarkIcon className="w-8 h-8" />
                </button>
              </div>
            </div>

            {/* Main Content - Two Column Layout */}
            <div className="flex-1 flex flex-col md:flex-row overflow-y-auto md:overflow-hidden">
              {/* Left Column - Invoice Items */}
              <div className="flex-1 p-4 md:p-6 md:overflow-y-auto">
                <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
                  <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                    <DocumentTextIcon className="w-5 h-5 text-blue-600" />
                    Invoice Items
                  </h3>
                  {/* Editable table */}
                  <div className="overflow-x-auto">
                    <table className="table w-full min-w-[500px]">
                      <thead>
                        <tr className="bg-gray-50">
                          <th className="text-sm font-semibold text-gray-700">Description</th>
                          <th className="text-sm font-semibold text-gray-700">Qty</th>
                          <th className="text-sm font-semibold text-gray-700">Rate</th>
                          <th className="text-sm font-semibold text-gray-700">Total</th>
                          {!proformaData?.isViewMode && <th className="text-sm font-semibold text-gray-700">Actions</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {proformaData.rows.map((row: any, idx: number) => (
                          <tr key={idx} className="hover:bg-gray-50 transition-colors">
                            <td>
                              <input 
                                className="input input-bordered w-56 text-base py-3 px-4" 
                                value={row.description} 
                                onChange={e => handleProformaRowChange(idx, 'description', e.target.value)}
                                readOnly={proformaData?.isViewMode}
                                placeholder="Item description"
                              />
                            </td>
                            <td>
                              <input 
                                className="input input-bordered w-16 text-base text-right py-3 px-4" 
                                type="number" 
                                value={row.qty} 
                                onChange={e => handleProformaRowChange(idx, 'qty', Number(e.target.value))}
                                readOnly={proformaData?.isViewMode}
                              />
                            </td>
                            <td>
                              <input 
                                className="input input-bordered w-32 text-base text-right py-3 px-4" 
                                type="number" 
                                value={row.rate} 
                                onChange={e => handleProformaRowChange(idx, 'rate', Number(e.target.value))}
                                readOnly={proformaData?.isViewMode}
                              />
                            </td>
                            <td>
                              <input className="input input-bordered w-32 text-base text-right font-semibold py-3 px-4" type="number" value={row.total} readOnly />
                            </td>
                            {!proformaData?.isViewMode && (
                              <td>
                                <button 
                                  className="btn btn-ghost btn-xs text-red-500 hover:bg-red-50" 
                                  onClick={() => handleDeleteProformaRow(idx)}
                                >
                                  <TrashIcon className="w-4 h-4" />
                                </button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!proformaData?.isViewMode && (
                    <button 
                      className="btn btn-outline btn-sm mt-4 text-blue-600 border-blue-300 hover:bg-blue-50" 
                      onClick={handleAddProformaRow}
                    >
                      <PlusIcon className="w-4 h-4 mr-1" />
                      Add Row
                    </button>
                  )}
                </div>

                {/* Settings Section */}
                <div className="bg-white rounded-xl shadow-lg p-6 mb-8">
                  <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                    <Cog6ToothIcon className="w-5 h-5 text-green-600" />
                    Settings
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="form-control">
                      <label className="label cursor-pointer justify-start gap-3">
                        <input 
                          type="checkbox" 
                          className="checkbox checkbox-primary" 
                          checked={proformaData.addVat} 
                          onChange={e => setProformaData((prev: any) => ({ ...prev, addVat: e.target.checked }))}
                          disabled={proformaData?.isViewMode}
                        />
                        <span className="label-text font-medium">Add VAT (18%)</span>
                      </label>
                    </div>
                    {/* In the settings section, remove the currency field (dropdown and label) */}
                    <div className="form-control">
                      <label className="label">
                        <span className="label-text font-medium">Bank Account</span>
                      </label>
                      <select 
                        className="select select-bordered w-full" 
                        value={proformaData.bankAccount} 
                        onChange={e => setProformaData((prev: any) => ({ ...prev, bankAccount: e.target.value }))}
                        disabled={proformaData?.isViewMode}
                      >
                        <option value="">Select account...</option>
                        <option value="1">Account 1</option>
                        <option value="2">Account 2</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Notes Section */}
                <div className="bg-white rounded-xl shadow-lg p-6">
                  <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                    <ChatBubbleLeftRightIcon className="w-5 h-5 text-purple-600" />
                    Notes
                  </h3>
                  <textarea 
                    className="textarea textarea-bordered w-full min-h-[120px] text-sm" 
                    value={proformaData.notes} 
                    onChange={e => setProformaData((prev: any) => ({ ...prev, notes: e.target.value }))}
                    readOnly={proformaData?.isViewMode}
                    placeholder="Add any additional notes or terms..."
                  />
                </div>
              </div>

              {/* Right Column - Summary & Actions */}
              <div className="w-full md:w-80 bg-white border-l border-gray-200 p-4 md:p-6 flex flex-col mt-6 md:mt-0">
                {/* Summary Card */}
                <div className="bg-white rounded-xl p-6 mb-6 border border-blue-200 w-full shadow-lg">
                  {/* In the summary card, move the edit button to the top, next to the 'Summary' title: */}
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                      <ChartPieIcon className="w-5 h-5 text-blue-600" />
                      Summary
                    </h3>
                    <button className="btn btn-ghost btn-xs" onClick={() => setIsEditingSubtotal(true)} title="Edit total amount">
                      <PencilLine className="w-4 h-4 text-gray-500" />
                    </button>
                  </div>
                  <div className="space-y-3">
                    {/* In the subtotal row, remove the edit button and just show the value or input: */}
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium text-gray-600">Subtotal:</span>
                      {isEditingSubtotal ? (
                        <input
                          className="input input-bordered w-24 text-base text-right py-2 px-3 mr-2"
                          type="number"
                          value={editableSubtotal}
                          onChange={e => setEditableSubtotal(e.target.value)}
                          onBlur={saveSubtotal}
                          autoFocus
                        />
                      ) : (
                        <span className="font-semibold text-gray-800">
                          {proformaData.currency} {proformaData.rows.reduce((sum: number, r: any) => sum + Number(r.total), 0).toLocaleString()}
                        </span>
                      )}
                    </div>
                    {proformaData.addVat && proformaData.currency === '₪' && (
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-medium text-gray-600">VAT (18%):</span>
                        <span className="font-semibold text-gray-800">
                          {proformaData.currency} {Math.round(proformaData.rows.reduce((sum: number, r: any) => sum + Number(r.total), 0) * 0.18 * 100) / 100}
                        </span>
                      </div>
                    )}
                    <div className="border-t border-gray-300 pt-3">
                      <div className="flex justify-between items-center">
                        <span className="text-lg font-bold text-gray-800">Total:</span>
                        <span className="text-xl font-bold text-purple-700">
                          {proformaData.currency} {proformaData.addVat && proformaData.currency === '₪' ? Math.round(proformaData.rows.reduce((sum: number, r: any) => sum + Number(r.total), 0) * 1.18 * 100) / 100 : proformaData.rows.reduce((sum: number, r: any) => sum + Number(r.total), 0)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Proforma Info */}
                <div className="bg-white rounded-xl p-4 mb-6 w-full shadow-lg">
                  <h4 className="font-semibold text-gray-800 mb-2">Proforma Details</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Name:</span>
                      <span className="font-medium">{generatedProformaName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Language:</span>
                      <span className="font-medium">{proformaData.language}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Payment:</span>
                      <span className="font-medium">{proformaData.currency} {proformaData.payment.toLocaleString()}</span>
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="mt-auto space-y-3">
                  {proformaData?.isViewMode ? (
                    <>
                      <button className="btn btn-primary w-full" onClick={() => setShowProformaDrawer(false)}>
                        Close
                      </button>
                      <button className="btn btn-outline w-full" onClick={() => {
                        setProformaData((prev: any) => ({ ...prev, isViewMode: false }));
                      }}>
                        Edit Proforma
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="btn btn-primary w-full shadow-lg hover:shadow-xl transition-shadow" onClick={handleCreateProforma}>
                        <DocumentCheckIcon className="w-5 h-5 mr-2" />
                        Create Proforma
                      </button>
                      <div className="text-xs text-gray-500 text-center bg-yellow-50 p-3 rounded-lg border border-yellow-200">
                        ⚠️ Once created, changes cannot be made!
                      </div>
                    </>
                  )}
                </div>
                {proformaData?.createdBy && (
                  <div className="absolute bottom-4 left-6 text-xs text-gray-400">
                    Created by: {proformaData.createdBy}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>, document.body)
      }
      
      {/* Stages Drawer */}
      {showStagesDrawer && ReactDOM.createPortal(
        <div className="fixed inset-0 z-[100] flex">
          {/* Overlay */}
          <div className="fixed inset-0 bg-black/30" onClick={handleCloseStagesDrawer} />
          {/* Drawer */}
          <div className="ml-auto w-full max-w-2xl h-full bg-white shadow-2xl p-0 flex flex-col animate-slideInRight z-[110] overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-r from-purple-700 to-blue-600 text-white p-6 border-b border-purple-200">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold mb-1">Finance Plan Stages</h2>
                  <p className="text-purple-100">Client: {client?.name}</p>
                </div>
                <button className="btn btn-ghost btn-lg text-white hover:bg-white/20" onClick={handleCloseStagesDrawer}>
                  <XMarkIcon className="w-6 h-6" />
                </button>
              </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 p-6 overflow-y-auto">
              {/* Auto Plan Section */}
              <div className="bg-white rounded-xl shadow-lg p-6 mb-6 border border-purple-200">
                <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                  <ChartPieIcon className="w-5 h-5 text-purple-600" />
                  Create Auto Finance Plan
                </h3>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="form-control">
                      <label className="label">
                        <span className="label-text font-medium">Total Amount</span>
                      </label>
                      <input
                        type="number"
                        className="input input-bordered w-full"
                        value={autoPlanData.totalAmount}
                        onChange={(e) => setAutoPlanData(prev => ({ ...prev, totalAmount: e.target.value }))}
                        placeholder="Enter total amount"
                      />
                    </div>
                    <div className="form-control">
                      <label className="label">
                        <span className="label-text font-medium">Currency</span>
                      </label>
                      <select
                        className="select select-bordered w-full"
                        value={autoPlanData.currency}
                        onChange={(e) => setAutoPlanData(prev => ({ ...prev, currency: e.target.value }))}
                      >
                        {(() => {
                          const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
                          const clientCurrency = isLegacyLead ? client?.balance_currency : client?.proposal_currency;
                          
                          // Create options with client's currency first
                          const currencies = [
                            { value: '₪', label: '₪ (NIS)' },
                            { value: '$', label: '$ (USD)' },
                            { value: '€', label: '€ (EUR)' },
                            { value: '£', label: '£ (GBP)' }
                          ];
                          
                          // Move client's currency to the top if it exists
                          if (clientCurrency && clientCurrency !== '₪') {
                            const clientCurrencyOption = currencies.find(c => c.value === clientCurrency);
                            if (clientCurrencyOption) {
                              const filteredCurrencies = currencies.filter(c => c.value !== clientCurrency);
                              return [
                                <option key={clientCurrency} value={clientCurrency}>{clientCurrencyOption.label}</option>,
                                ...filteredCurrencies.map(c => <option key={c.value} value={c.value}>{c.label}</option>)
                              ];
                            }
                          }
                          
                          return currencies.map(c => <option key={c.value} value={c.value}>{c.label}</option>);
                        })()}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="form-control">
                      <label className="label">
                        <span className="label-text font-medium">Number of Payments</span>
                      </label>
                      <select
                        className="select select-bordered w-full"
                        value={autoPlanData.numberOfPayments}
                        onChange={(e) => setAutoPlanData(prev => ({ ...prev, numberOfPayments: Number(e.target.value) }))}
                      >
                        <option value={2}>2 Payments</option>
                        <option value={3}>3 Payments</option>
                        <option value={4}>4 Payments</option>
                        <option value={5}>5 Payments</option>
                      </select>
                    </div>
                    <div className="form-control">
                      <label className="label">
                        <span className="label-text font-medium">First Payment %</span>
                      </label>
                      <select
                        className="select select-bordered w-full"
                        value={autoPlanData.firstPaymentPercent}
                        onChange={(e) => setAutoPlanData(prev => ({ ...prev, firstPaymentPercent: Number(e.target.value) }))}
                      >
                        <option value={25}>25%</option>
                        <option value={30}>30%</option>
                        <option value={40}>40%</option>
                        <option value={50}>50%</option>
                        <option value={60}>60%</option>
                      </select>
                    </div>
                  </div>
                  <div className="form-control">
                    <label className="label cursor-pointer justify-start gap-3">
                      <input
                        type="checkbox"
                        className="checkbox checkbox-primary"
                        checked={autoPlanData.includeVat}
                        onChange={(e) => setAutoPlanData(prev => ({ ...prev, includeVat: e.target.checked }))}
                      />
                      <span className="label-text font-medium">Include VAT (18% for NIS)</span>
                    </label>
                  </div>
                  <button
                    className="btn btn-primary w-full"
                    onClick={handleCreateAutoPlan}
                    disabled={isSavingPaymentRow || !autoPlanData.totalAmount}
                  >
                    {isSavingPaymentRow ? (
                      <span className="loading loading-spinner loading-sm"></span>
                    ) : (
                      <PlusIcon className="w-4 h-4 mr-2" />
                    )}
                    Create Auto Finance Plan
                  </button>
                </div>
              </div>

              {/* Add New Payment Section */}
              <div className="bg-white rounded-xl shadow-lg p-6 border border-blue-200">
                <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                  <PlusIcon className="w-5 h-5 text-blue-600" />
                  Add New Payment
                </h3>
                <p className="text-gray-600 mb-4">Create a single payment plan for this client.</p>
                <button
                  className="btn btn-outline btn-primary w-full"
                  onClick={() => {
                    handleCloseStagesDrawer();
                    handleAddNewPayment(client?.name || 'Main Contact');
                  }}
                >
                  <PlusIcon className="w-4 h-4 mr-2" />
                  Add New Payment
                </button>
              </div>
            </div>
          </div>
        </div>, document.body)
      }
      
      {!hideTimelineHistory && <TimelineHistoryButtons client={client} />}

      {/* Percentage Calculation Modal */}
      {showPercentageModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-[500px] max-w-[90vw] mx-4 max-h-[80vh] overflow-y-auto">
            <h3 className="text-xl font-bold mb-4">
              Calculate Payment Amount
            </h3>
            <p className="text-sm text-gray-600 mb-6">
              Calculate {percentageType === 'total' ? 'total amount' : 'left to plan amount'} percentage:
            </p>
            
            <div className="space-y-6">
              {/* Percentage Buttons */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="text-sm font-medium text-gray-700 mb-3">Select Percentage:</h4>
                <div className="grid grid-cols-5 gap-2">
                  {[10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((percentage) => (
                    <button
                      key={percentage}
                      className="btn btn-sm btn-outline hover:btn-primary hover:text-white"
                      onClick={() => {
                        setPercentageValue(percentage);
                        handlePercentageCalculation(percentage, percentageType);
                      }}
                    >
                      {percentage}%
                    </button>
                  ))}
                </div>
              </div>
              
              {/* Custom Input */}
              <div className="border-t pt-4">
                <h4 className="text-sm font-medium text-gray-700 mb-3">Or Enter Custom Percentage:</h4>
                <div className="flex gap-3">
                  <input
                    type="number"
                    className="input input-bordered flex-1 text-lg"
                    placeholder="Enter percentage"
                    value={percentageValue || ''}
                    onChange={(e) => setPercentageValue(Number(e.target.value))}
                    min="0"
                    max="100"
                    step="0.1"
                  />
                  <button
                    className="btn btn-primary btn-lg"
                    onClick={() => handlePercentageCalculation(percentageValue, percentageType)}
                    disabled={!percentageValue || percentageValue <= 0 || percentageValue > 100}
                  >
                    Apply
                  </button>
                </div>
              </div>
              
              {/* Base Amount Info */}
              <div className="bg-blue-50 rounded-lg p-3">
                <div className="text-sm text-gray-600">
                  <span className="font-medium">Base amount:</span> {getCurrencySymbol(financePlan?.payments[0]?.currency || '₪')}
                  <span className="font-bold text-lg">{(percentageType === 'total' ? getTotalAmount() : getLeftToPlanAmount()).toLocaleString()}</span>
                </div>
                {percentageValue > 0 && (
                  <div className="text-sm text-gray-600 mt-1">
                    <span className="font-medium">Calculated amount:</span> {getCurrencySymbol(financePlan?.payments[0]?.currency || '₪')}
                    <span className="font-bold text-lg text-green-600">
                      {Math.round(((percentageType === 'total' ? getTotalAmount() : getLeftToPlanAmount()) * percentageValue) / 100).toLocaleString()}
                    </span>
                  </div>
                )}
              </div>
            </div>
            
            <div className="flex justify-end gap-3 mt-6 pt-4 border-t">
              <button
                className="btn btn-ghost"
                onClick={() => setShowPercentageModal(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default FinancesTab; 