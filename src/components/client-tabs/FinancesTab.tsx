import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import TimelineHistoryButtons from './TimelineHistoryButtons';
import { BanknotesIcon, PencilIcon, TrashIcon, XMarkIcon, Squares2X2Icon, Bars3Icon, CurrencyDollarIcon, UserIcon, MinusIcon, CheckIcon, LinkIcon, ClipboardDocumentIcon, ArrowUturnLeftIcon, ExclamationTriangleIcon, PaperAirplaneIcon, ChevronDownIcon } from '@heroicons/react/24/outline';
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
  ready_to_pay_by?: number | null; // Employee ID who marked it as ready to pay
  ready_to_pay_by_display_name?: string | null; // Display name of employee who marked it as ready to pay
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

  // Helper function to format date as dd/mm/yyyy
  const formatDateDDMMYYYY = (dateString: string | null | undefined): string => {
    if (!dateString) return '';
    const date = new Date(dateString);
    if (date.toString() === 'Invalid Date') return '';
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  };
  const { instance } = useMsal();
  const [financePlan, setFinancePlan] = useState<FinancePlan | null>(null);
  const [isLoadingFinancePlan, setIsLoadingFinancePlan] = useState<boolean>(true);
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
          acc[contactName] = false; // false means open (expanded)
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
  
  // Helper: map lead currency codes/names to the symbols used in the auto‑plan selector
  const mapLeadCurrencyToSymbol = (code?: string | null): string => {
    if (!code) return '₪';
    const normalized = String(code).trim().toUpperCase();
    if (normalized === '₪' || normalized === 'NIS' || normalized === 'ILS') return '₪';
    if (normalized === '$' || normalized === 'USD') return '$';
    if (normalized === '€' || normalized === 'EUR') return '€';
    if (normalized === '£' || normalized === 'GBP') return '£';
    return '₪';
  };

  // Helper to convert numeric order back to descriptive text (used for both legacy and new leads)
  // Must be defined before fetchPaymentPlans which uses it
  const getOrderText = (orderNumber: number | string | null | undefined): string => {
    // Handle string input (for new leads that might already be text)
    if (typeof orderNumber === 'string') {
      // If it's already a descriptive string, return it as-is
      const lowerStr = orderNumber.toLowerCase();
      if (lowerStr.includes('first') || lowerStr.includes('intermediate') || lowerStr.includes('final') || lowerStr.includes('single') || lowerStr.includes('expense')) {
        return orderNumber;
      }
      // Try to parse as number
      const num = parseInt(orderNumber, 10);
      if (!isNaN(num)) {
        orderNumber = num;
      } else {
        return orderNumber; // Return as-is if can't parse
      }
    }
    
    // Handle numeric input
    if (typeof orderNumber === 'number') {
      switch (orderNumber) {
        case 1: return 'First Payment';
        case 5: return 'Intermediate Payment';
        case 9: return 'Final Payment';
        case 90: return 'Single Payment';
        case 99: return 'Expense (no VAT)';
        default: return 'First Payment'; // Default fallback
      }
    }
    
    // Default fallback for null/undefined
    return 'First Payment';
  };

  // Add state for stages dropdown and drawer
  const [showStagesDrawer, setShowStagesDrawer] = useState(false);
  const [autoPlanData, setAutoPlanData] = useState({
    totalAmount: '',
    currency: '₪',
    numberOfPayments: 3,
    // Per‑payment percentages, must always sum to 100
    paymentPercents: [50, 25, 25],
    // Payment orders for each payment
    paymentOrders: ['First Payment', 'Intermediate Payment', 'Final Payment'],
    includeVat: true,
    contact: '', // Contact name for the auto plan
  });
  const [isCustomPaymentCount, setIsCustomPaymentCount] = useState(false);
  const [customPaymentCount, setCustomPaymentCount] = useState<number>(6);

  // Add state for percentage calculation feature
  const [showPercentageModal, setShowPercentageModal] = useState(false);
  const [percentageType, setPercentageType] = useState<'total' | 'leftToPlan'>('total');
  const [percentageValue, setPercentageValue] = useState<number>(0);

  // Add state for deleted payments view
  const [showDeletedPayments, setShowDeletedPayments] = useState(false);
  const [deletedPayments, setDeletedPayments] = useState<any[]>([]);

  // Add state for legacy proformas
  const [legacyProformas, setLegacyProformas] = useState<any[]>([]);

  // Add state for paid date modal
  const [showPaidDateModal, setShowPaidDateModal] = useState(false);
  const [selectedPaymentForPaid, setSelectedPaymentForPaid] = useState<string | number | null>(null);
  const [paidDate, setPaidDate] = useState<string>('');


  // Update autoPlanData currency and contact when client changes
  useEffect(() => {
    if (client) {
      const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
      let currency = '₪'; // Default
      let suggestedTotal = 0;

      if (isLegacyLead) {
        // For legacy leads, prefer balance if available
        currency = mapLeadCurrencyToSymbol(client?.balance_currency || client?.proposal_currency);
        suggestedTotal = Number(client?.balance || 0);
      } else {
        // For new leads, use proposal_currency and balance
        currency = mapLeadCurrencyToSymbol(client?.proposal_currency);
        suggestedTotal = Number(client?.balance || 0);
      }

      setAutoPlanData(prev => ({
        ...prev,
        currency,
        // Only prefill if we don't already have a value and suggestedTotal is positive
        totalAmount:
          (!prev.totalAmount || Number(prev.totalAmount) <= 0) && suggestedTotal > 0
            ? String(suggestedTotal)
            : prev.totalAmount,
        // Set default contact to main client name if not set
        contact: prev.contact || client?.name || '',
      }));
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
  const [editPaymentIncludeVat, setEditPaymentIncludeVat] = useState<boolean>(true); // Track if VAT should be included for the payment being edited

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

  // Handler to mark a payment as ready to pay
  const handleMarkAsReadyToPay = async (payment: PaymentPlan) => {
    try {
      const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
      const currentDate = new Date().toISOString().split('T')[0]; // Get today's date in YYYY-MM-DD format
      const currentUserEmployeeId = await getCurrentUserEmployeeId();
      const currentUserName = await getCurrentUserName();
      
      let error;
      if (isLegacyLead) {
        // For legacy leads, update finances_paymentplanrow table
        const { error: legacyError } = await supabase
          .from('finances_paymentplanrow')
          .update({ 
            ready_to_pay: true,
            ready_to_pay_by: currentUserEmployeeId,
            due_by_id: currentUserEmployeeId,
            date: currentDate,
            due_date: currentDate
          })
          .eq('id', payment.id);
        error = legacyError;
      } else {
        // For new leads, update payment_plans table
        const { error: newError } = await supabase
          .from('payment_plans')
          .update({ 
            ready_to_pay: true,
            ready_to_pay_by: currentUserEmployeeId,
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

      // Log to finance_changes_history (only for new leads)
      if (!isLegacyLead && client?.id) {
        const { error: historyError } = await supabase
          .from('finance_changes_history')
          .insert({
            lead_id: client.id,
            change_type: 'payment_marked_ready_to_pay',
            table_name: 'payment_plans',
            record_id: payment.id,
            old_values: { ready_to_pay: false },
            new_values: { ready_to_pay: true, ready_to_pay_by: currentUserEmployeeId },
            changed_by: currentUserName,
            notes: `Payment marked as ready to pay by ${currentUserName}`
          });
        
        if (historyError) console.error('Error logging payment marked as ready to pay:', historyError);
      }

      // Get current user's display name for immediate UI update
      let currentUserDisplayName = currentUserName;
      try {
        if (currentUserEmployeeId) {
          const { data: employeeData } = await supabase
            .from('tenants_employee')
            .select('display_name')
            .eq('id', currentUserEmployeeId)
            .single();
          if (employeeData?.display_name) {
            currentUserDisplayName = employeeData.display_name;
          }
        }
      } catch (err) {
        console.warn('Could not fetch employee display name, using username:', err);
      }

      // Update the local state immediately to reflect the change
      setFinancePlan(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          payments: prev.payments.map(p => 
            p.id === payment.id 
              ? { 
                  ...p, 
                  ready_to_pay: true, 
                  dueDate: currentDate,
                  ready_to_pay_by: currentUserEmployeeId,
                  ready_to_pay_by_display_name: currentUserDisplayName,
                }
              : p
          )
        };
      });

      toast.success('Payment marked as ready to pay! Due date set to today. It will now appear in the collection page.');
      // Refresh to ensure data is in sync, but UI is already updated
      await refreshPaymentPlans();
    } catch (error) {
      console.error('Error marking payment as ready to pay:', error);
      toast.error('Failed to mark payment as ready to pay');
    }
  };

  // Handler to revert ready to pay
  const handleRevertReadyToPay = async (payment: PaymentPlan) => {
    if (!window.confirm('Are you sure you want to revert this payment from ready to pay?')) return;

    const currentUserName = await getCurrentUserName();
    const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');

    // Update local state immediately
    setFinancePlan(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        payments: prev.payments.map(p => 
          p.id === payment.id 
            ? { ...p, ready_to_pay: false } as PaymentPlan
            : p
        )
      };
    });

    try {
      let error;
      if (isLegacyLead) {
        // For legacy leads, update finances_paymentplanrow table
        // Also clear due_date and due_by_id since they indicate ready_to_pay status
        const { error: legacyError } = await supabase
          .from('finances_paymentplanrow')
          .update({
            ready_to_pay: false,
            ready_to_pay_by: null,
            due_date: null,
            due_by_id: null,
          })
          .eq('id', payment.id);
        error = legacyError;
      } else {
        // For new leads, update payment_plans table
        const { error: newError } = await supabase
          .from('payment_plans')
          .update({
            ready_to_pay: false,
            ready_to_pay_by: null,
          })
          .eq('id', payment.id);
        error = newError;
      }

      if (error) {
        console.error('Error reverting ready to pay:', error);
        // Revert the UI state if database update fails
        setFinancePlan(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            payments: prev.payments.map(p => 
              p.id === payment.id 
                ? { ...p, ready_to_pay: true } as PaymentPlan
                : p
            )
          };
        });
        toast.error('Failed to revert ready to pay');
        return;
      }

      // Log to finance_changes_history (only for new leads)
      if (!isLegacyLead && client?.id) {
        const { error: historyError } = await supabase
          .from('finance_changes_history')
          .insert({
            lead_id: client.id,
            change_type: 'payment_reverted_from_ready_to_pay',
            table_name: 'payment_plans',
            record_id: payment.id,
            old_values: { ready_to_pay: true },
            new_values: { ready_to_pay: false, ready_to_pay_by: null },
            changed_by: currentUserName,
            notes: `Payment reverted from ready to pay by ${currentUserName}`
          });
        
        if (historyError) console.error('Error logging payment reverted from ready to pay:', historyError);
      }

      toast.success('Payment reverted from ready to pay');
      await refreshPaymentPlans();
    } catch (error) {
      console.error('Error reverting ready to pay:', error);
      // Revert the UI state if there's an error
      setFinancePlan(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          payments: prev.payments.map(p => 
            p.id === payment.id 
              ? { ...p, ready_to_pay: true } as PaymentPlan
              : p
          )
        };
      });
      toast.error('Failed to revert ready to pay');
    }
  };

  // Handler to open paid date modal
  const handleOpenPaidDateModal = (id: string | number) => {
    setSelectedPaymentForPaid(id);
    setPaidDate(new Date().toISOString().split('T')[0]); // Set default to today
    setShowPaidDateModal(true);
  };

  // Handler to confirm mark as paid with date
  const handleConfirmMarkAsPaid = async () => {
    if (!selectedPaymentForPaid || !paidDate) {
      toast.error('Please select a date');
      return;
    }

    const id = selectedPaymentForPaid;
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
            ? { ...payment, paid: true, paid_at: new Date(paidDate).toISOString() }
            : payment
        )
      };
    });
    
    if (onPaymentMarkedPaid) onPaymentMarkedPaid(id);
    
    try {
      const currentUserName = await getCurrentUserName();
      const paidAtDate = new Date(paidDate).toISOString();
      
      if (isLegacyPayment) {
        // For legacy payments, update finances_paymentplanrow table
        const { error } = await supabase
          .from('finances_paymentplanrow')
          .update({
            actual_date: paidDate, // Set actual_date to selected date
          })
          .eq('id', id);
          
        if (!error) {
          toast.success('Legacy payment marked as paid!');
          setShowPaidDateModal(false);
          setSelectedPaymentForPaid(null);
          setPaidDate('');
          await refreshPaymentPlans();
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
              new_values: { paid: true, paid_at: paidAtDate, paid_by: currentUserName },
              changed_by: currentUserName,
              notes: `Payment marked as paid by ${currentUserName} on ${paidDate}`
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
              actual_date: paidDate, // Use actual_date for legacy
            })
            .eq('id', id);
          error = legacyError;
        } else {
          // For new leads, update payment_plans table
          const { error: newError } = await supabase
            .from('payment_plans')
            .update({
              paid: true,
              paid_at: paidAtDate,
              paid_by: currentUserName,
            })
            .eq('id', id);
          error = newError;
        }
          
        if (!error) {
          toast.success('Payment marked as paid!');
          setShowPaidDateModal(false);
          setSelectedPaymentForPaid(null);
          setPaidDate('');
          await refreshPaymentPlans();
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

  // Fetch current user's superuser status and collection status
  useEffect(() => {
    const fetchUserPermissions = async () => {
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        
        if (authError || !user) {
          setIsSuperuser(false);
          setIsCollection(false);
          return;
        }

        // Try to find user by auth_id first
        let { data: userData, error } = await supabase
          .from('users')
          .select('is_superuser, employee_id')
          .eq('auth_id', user.id)
          .maybeSingle();
        
        // If not found by auth_id, try by email
        if (!userData && user.email) {
          const { data: userByEmail, error: emailError } = await supabase
            .from('users')
            .select('is_superuser, employee_id')
            .eq('email', user.email)
            .maybeSingle();
          
          userData = userByEmail;
          error = emailError;
        }

        if (!error && userData) {
          // Check if user is superuser (handle boolean, string, or number)
          const superuserStatus = userData.is_superuser === true || 
                                  userData.is_superuser === 'true' || 
                                  userData.is_superuser === 1;
          setIsSuperuser(superuserStatus);

          // Check if user has is_collection = true in tenants_employee table
          if (userData.employee_id) {
            const { data: employeeData, error: employeeError } = await supabase
              .from('tenants_employee')
              .select('is_collection')
              .eq('id', userData.employee_id)
              .maybeSingle();
            
            if (!employeeError && employeeData) {
              // Check if is_collection is true (handle boolean, string 't', or number)
              const collectionStatus = employeeData.is_collection === true || 
                                      employeeData.is_collection === 't' || 
                                      employeeData.is_collection === 'true' ||
                                      employeeData.is_collection === 1;
              setIsCollection(collectionStatus);
            } else {
              setIsCollection(false);
            }
          } else {
            setIsCollection(false);
          }
        } else {
          setIsSuperuser(false);
          setIsCollection(false);
        }
      } catch (error) {
        console.error('Error fetching user permissions:', error);
        setIsSuperuser(false);
        setIsCollection(false);
      }
    };

    fetchUserPermissions();
  }, []);

  // Define fetchContacts at component level so it can be called from multiple places
  // Returns the contacts array so it can be used immediately without waiting for state update
  const fetchContacts = async (): Promise<any[]> => {
    if (!client?.id) return [];
    
    // Check if this is a legacy lead
    const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
    
    if (isLegacyLead) {
      // For legacy leads, fetch contacts from leads_contact and lead_leadcontact tables
      const legacyId = client.id.toString().replace('legacy_', '');
      
      try {
        // Fetch contacts from lead_leadcontact and leads_contact tables
        const { data: leadContacts, error: leadContactsError } = await supabase
          .from('lead_leadcontact')
          .select(`
            id,
            main,
            contact_id,
            lead_id,
            leads_contact!inner(
              id,
              name,
              email,
              phone,
              mobile
            )
          `)
          .eq('lead_id', legacyId);
        
        if (leadContactsError) {
          console.error('Error fetching legacy lead contacts:', leadContactsError);
          setContacts([]);
          return [];
        }
        
        if (leadContacts && leadContacts.length > 0) {
          // Transform contacts to include the contact data
          const contactsWithData = leadContacts.map((leadContact: any) => {
            const contactData = Array.isArray(leadContact.leads_contact) 
              ? leadContact.leads_contact[0] 
              : leadContact.leads_contact;
            
            return {
              id: contactData?.id || leadContact.contact_id,
              name: contactData?.name || '',
              email: contactData?.email || '',
              phone: contactData?.phone || '',
              mobile: contactData?.mobile || '',
              isMain: leadContact.main === 'true' || leadContact.main === true,
            };
          });
          
          setContacts(contactsWithData);
          console.log('✅ fetchContacts: Loaded contacts', contactsWithData.map(c => ({ id: c.id, name: c.name })));
          return contactsWithData;
        } else {
          setContacts([]);
          return [];
        }
      } catch (error) {
        console.error('Error fetching legacy contacts:', error);
        setContacts([]);
        return [];
      }
    }
    
    // For new leads, fetch contacts from lead_leadcontact and leads_contact tables using newlead_id
    try {
      console.log('🔍 fetchContacts: Fetching contacts for new lead with leadId:', client.id);
      
      const { data: leadContacts, error: leadContactsError } = await supabase
        .from('lead_leadcontact')
        .select(`
          id,
          main,
          contact_id,
          newlead_id,
          leads_contact!inner(
            id,
            name,
            email,
            phone,
            mobile
          )
        `)
        .eq('newlead_id', client.id);
      
      console.log('🔍 leadContacts query result:', { leadContacts, leadContactsError, leadId: client.id });
      
      if (leadContactsError) {
        console.error('Error fetching new lead contacts:', leadContactsError);
        setContacts([]);
        return [];
      }
      
      if (leadContacts && leadContacts.length > 0) {
        // Transform contacts to include the contact data
        const contactsWithData = leadContacts.map((leadContact: any) => {
          const contactData = Array.isArray(leadContact.leads_contact) 
            ? leadContact.leads_contact[0] 
            : leadContact.leads_contact;
          
          return {
            id: contactData?.id || leadContact.contact_id,
            name: contactData?.name || '',
            email: contactData?.email || '',
            phone: contactData?.phone || '',
            mobile: contactData?.mobile || '',
            isMain: leadContact.main === 'true' || leadContact.main === true,
          };
        });
        
        console.log('✅ Processed contacts:', contactsWithData);
        console.log('✅ Setting contacts state with', contactsWithData.length, 'contacts');
        setContacts(contactsWithData);
        return contactsWithData;
      } else {
        console.warn('⚠️ No contacts found for new lead, leadId:', client.id);
        setContacts([]);
        return [];
      }
    } catch (error) {
      console.error('Error fetching new lead contacts:', error);
      setContacts([]);
      return [];
    }
  };

  // Use a ref to track if we're currently fetching to prevent infinite loops
  const isFetchingRef = React.useRef(false);
  const contactsLoadedRef = React.useRef<string | null>(null);

  // Fetch payment plans when component mounts or client changes
  useEffect(() => {
      const fetchPaymentPlans = async () => {
    if (!client?.id) {
      setIsLoadingFinancePlan(false);
      return;
    }
    
    // Prevent duplicate fetches
    if (isFetchingRef.current) {
      return;
    }
    
    // Check if contacts are already loaded for this client
    const clientIdKey = client.id.toString();
    const contactsAlreadyLoaded = contactsLoadedRef.current === clientIdKey && contacts.length > 0;
    
    isFetchingRef.current = true;
    setIsLoadingFinancePlan(true);
    
    // CRITICAL: Ensure contacts are loaded BEFORE fetching payment plans
    // This prevents payment plans from being incorrectly labeled with main client name
    // Get contacts directly from fetchContacts (returns immediately, doesn't wait for state update)
    let currentContacts = contacts;
    if (!contactsAlreadyLoaded) {
      currentContacts = await fetchContacts();
      contactsLoadedRef.current = clientIdKey;
    }
    
    // Check if this is a legacy lead
    const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
      
      try {
        let data = null;
        let error = null;
        
        if (isLegacyLead) {
          // For legacy leads, fetch from finances_paymentplanrow table
          const legacyIdStr = client.id.toString().replace('legacy_', '');
          const legacyId = legacyIdStr ? parseInt(legacyIdStr, 10) : null;
          
          if (!legacyId || isNaN(legacyId)) {
            console.error('Invalid legacy lead ID:', client.id);
            setIsLoadingFinancePlan(false);
            isFetchingRef.current = false;
            return;
          }
          
          // For legacy leads, fetch payments by BOTH lead_id AND client_id (contact_id)
          // This ensures subleads with the same contact don't show each other's finance plans
          // Contacts are now guaranteed to be loaded before this function runs (via await fetchContacts())
          const contactIds = currentContacts.length > 0 ? currentContacts.map(c => c.id).filter(id => id != null && !isNaN(Number(id))).map(id => Number(id)) : [];
          
          // Build query to fetch payments for this specific lead/sublead
          // CRITICAL: We must filter by BOTH lead_id AND client_id to prevent showing payments from other leads
          // First, fetch by lead_id to get all payments for this specific lead
          let { data: legacyData, error: legacyError } = await supabase
            .from('finances_paymentplanrow')
            .select(`
              *,
              accounting_currencies!finances_paymentplanrow_currency_id_fkey (
                name,
                iso_code
              ),
              tenants_employee:ready_to_pay_by (
                id,
                display_name
              )
            `)
            .eq('lead_id', legacyId) // Use numeric lead_id to ensure correct matching for this specific lead
            .is('cancel_date', null)
            .order('date', { ascending: true });
          
          // CRITICAL: Filter in JavaScript to ensure we ONLY show payments for contacts associated with THIS lead
          // This prevents payments from other leads (subleads) that share the same contact_id from appearing
          // Even though we filter by lead_id in the query, we need this additional filter to be absolutely sure
          if (legacyData && !legacyError) {
            console.log('🔍 fetchPaymentPlans (legacy): Filtering payments', {
              legacyId,
              contactIds,
              totalPayments: legacyData.length,
              payments: legacyData.map((p: any) => ({ id: p.id, lead_id: p.lead_id, client_id: p.client_id }))
            });
            
            legacyData = legacyData.filter((plan: any) => {
              const planClientId = plan.client_id ? Number(plan.client_id) : null;
              const planLeadId = plan.lead_id ? Number(plan.lead_id) : null;
              
              // CRITICAL: Double-check that lead_id matches (should already be filtered, but be extra safe)
              if (planLeadId !== legacyId) {
                console.warn('⚠️ Payment plan has incorrect lead_id:', { planLeadId, expectedLeadId: legacyId, planId: plan.id });
                return false;
              }
              
              // Include payment if:
              // 1. client_id is null (legacy payments without contact assignment)
              // 2. client_id matches a contact_id for THIS lead (new payment plans with correct contact_id)
              // 3. client_id matches the lead_id (backward compatibility for old payment plans that used lead_id as client_id)
              //    Since we already filter by lead_id in the query, if client_id === lead_id, it's definitely for this lead
              let shouldInclude = false;
              
              if (planClientId === null) {
                // Legacy payments without contact assignment
                shouldInclude = true;
              } else if (contactIds.includes(planClientId)) {
                // New payment plans with correct contact_id
                shouldInclude = true;
              } else if (planClientId === legacyId) {
                // Backward compatibility: Old payment plans that used lead_id as client_id
                // Since we already filter by lead_id in the query, if client_id === lead_id, it's definitely for this lead
                console.log('✅ Including payment with lead_id as client_id (backward compatibility):', { 
                  planId: plan.id, 
                  planClientId, 
                  legacyId
                });
                shouldInclude = true;
              }
              
              if (!shouldInclude) {
                console.log('🔍 Excluding payment (client_id mismatch):', { planId: plan.id, planClientId, contactIds, legacyId });
              }
              return shouldInclude;
            });
            
            console.log('✅ fetchPaymentPlans (legacy): Filtered payments', {
              legacyId,
              filteredCount: legacyData.length,
              filteredPayments: legacyData.map((p: any) => ({ id: p.id, lead_id: p.lead_id, client_id: p.client_id }))
            });
          }
          
          data = legacyData;
          error = legacyError;
        } else {
          // For regular leads, fetch from payment_plans table
          // Filter out canceled payments (cancel_date is null for active payments)
          // Match by BOTH lead_id AND client_id (contact_id) to ensure subleads with same contact don't show each other's plans
          const contactIds = currentContacts.length > 0 ? currentContacts.map(c => c.id).filter(id => id != null && !isNaN(Number(id))).map(id => Number(id)) : [];
          
          // Build query to fetch payments for this specific lead/sublead
          // CRITICAL: We must filter by BOTH lead_id AND client_id to prevent showing payments from other leads
          // First, fetch by lead_id to get all payments for this specific lead
          let { data: regularData, error: regularError } = await supabase
            .from('payment_plans')
            .select(`
              *,
              tenants_employee:ready_to_pay_by (
                id,
                display_name
              )
            `)
            .eq('lead_id', client.id) // Use the specific lead_id for this lead/sublead
            .is('cancel_date', null)
            .order('date', { ascending: true });
          
          // CRITICAL: Filter in JavaScript to ensure we ONLY show payments for contacts associated with THIS lead
          // This prevents payments from other leads (subleads) that share the same contact_id from appearing
          // Even though we filter by lead_id in the query, we need this additional filter to be absolutely sure
          if (regularData && !regularError) {
            console.log('🔍 fetchPaymentPlans (new): Filtering payments', {
              leadId: client.id,
              contactIds,
              totalPayments: regularData.length,
              payments: regularData.map((p: any) => ({ id: p.id, lead_id: p.lead_id, client_id: p.client_id }))
            });
            
            regularData = regularData.filter((plan: any) => {
              const planClientId = plan.client_id ? Number(plan.client_id) : null;
              const planLeadId = plan.lead_id ? String(plan.lead_id) : null;
              
              // CRITICAL: Double-check that lead_id matches (should already be filtered, but be extra safe)
              if (planLeadId !== String(client.id)) {
                console.warn('⚠️ Payment plan has incorrect lead_id:', { planLeadId, expectedLeadId: client.id, planId: plan.id });
                return false;
              }
              
              // Include payment if:
              // 1. client_id is null (payments without contact assignment)
              // 2. client_id matches a contact_id for THIS lead (new payment plans with correct contact_id)
              // Note: For new leads, we don't need backward compatibility since they should always use contact_id
              const shouldInclude = planClientId === null || contactIds.includes(planClientId);
              if (!shouldInclude) {
                console.log('🔍 Excluding payment (client_id mismatch):', { planId: plan.id, planClientId, contactIds });
              }
              return shouldInclude;
            });
            
            console.log('✅ fetchPaymentPlans (new): Filtered payments', {
              leadId: client.id,
              filteredCount: regularData.length,
              filteredPayments: regularData.map((p: any) => ({ id: p.id, lead_id: p.lead_id, client_id: p.client_id }))
            });
          }
          
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
            // Fetch employee display names for due_by_id values
            const dueByIds = new Set<number>();
            data.forEach((plan: any) => {
              if (plan.due_by_id) {
                dueByIds.add(plan.due_by_id);
              }
            });
            
            const dueByEmployeeMap = new Map<number, string>();
            if (dueByIds.size > 0) {
              const { data: employeesData } = await supabase
                .from('tenants_employee')
                .select('id, display_name')
                .in('id', Array.from(dueByIds));
              
              if (employeesData) {
                employeesData.forEach((emp: any) => {
                  if (emp.id && emp.display_name) {
                    dueByEmployeeMap.set(emp.id, emp.display_name);
                  }
                });
              }
            }
            
            // Transform legacy data to match the finance plan structure
            // First, process all payments to calculate totals and get currency info
            const processedPayments = data.map(plan => {
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
              
              return {
                plan,
                value,
                valueVat,
                currency,
                currencyId,
                paymentTotal
              };
            });
            
          // Calculate totals using the same VAT logic
          let total = 0;
          let vat = 0;
          processedPayments.forEach(processed => {
            total += processed.paymentTotal;
            vat += processed.valueVat;
          });
          
          // Group payments by contact to calculate percentages per contact
          const paymentsByContact = new Map<string, typeof processedPayments>();
          processedPayments.forEach(processed => {
            const contactName = getContactNameFromClientId(processed.plan.client_id, currentContacts);
            if (!paymentsByContact.has(contactName)) {
              paymentsByContact.set(contactName, []);
            }
            paymentsByContact.get(contactName)!.push(processed);
          });
          
          // Calculate total per contact and then calculate percentages
          payments = processedPayments.map(processed => {
            const { plan, value, valueVat, currency, paymentTotal } = processed;
            
            // Get contact name from client_id
            const contactName = getContactNameFromClientId(plan.client_id, currentContacts);
            
            // Calculate total for this contact's payments
            const contactPayments = paymentsByContact.get(contactName) || [];
            const contactTotal = contactPayments.reduce((sum, p) => sum + p.paymentTotal, 0);
            
            // Calculate percentage based on this contact's total, not the global total
            const calculatedDuePercent = contactTotal > 0 ? Math.round((paymentTotal / contactTotal) * 100).toString() + '%' : '0%';

            // Debug: Log employee data if available
            if (plan.ready_to_pay && plan.ready_to_pay_by) {
              console.log('🔍 Payment ready_to_pay debug:', {
                paymentId: plan.id,
                ready_to_pay_by: plan.ready_to_pay_by,
                tenants_employee: plan.tenants_employee,
                display_name: plan.tenants_employee?.display_name
              });
            }

            // For legacy leads: if due_date and due_by_id are set, treat as ready_to_pay
            // This is because legacy leads use due_date and due_by_id instead of ready_to_pay flag
            const hasDueDateAndDueBy = plan.due_date && plan.due_by_id;
            const isReadyToPay = plan.ready_to_pay || hasDueDateAndDueBy;
            // For legacy leads, prioritize due_by_id over ready_to_pay_by
            const readyToPayBy = hasDueDateAndDueBy ? plan.due_by_id : (plan.ready_to_pay_by || null);
            // For legacy leads, get employee name from due_by_id using the map we fetched
            const readyToPayByDisplayName = hasDueDateAndDueBy 
              ? (dueByEmployeeMap.get(plan.due_by_id) || null)
              : (plan.tenants_employee?.display_name || null);
            
            return {
              id: plan.id,
              duePercent: calculatedDuePercent,
              dueDate: plan.date || plan.due_date,
              value,
              valueVat,
              client: contactName, // Use contact name from client_id mapping
              order: plan.order ? getOrderText(plan.order) : 'First Payment',
              proforma: null, // Legacy doesn't have proforma
              notes: plan.notes || '',
              paid: plan.actual_date ? true : false, // If actual_date is set, consider it paid
              paid_at: plan.actual_date,
              paid_by: undefined, // Legacy doesn't track who paid
              currency,
              isLegacy: true, // Flag to identify legacy payments
              ready_to_pay: isReadyToPay,
              ready_to_pay_text: (plan as any).ready_to_pay_text || null,
              ready_to_pay_date: (plan as any).ready_to_pay_date || null,
              ready_to_pay_by: readyToPayBy,
              ready_to_pay_by_display_name: readyToPayByDisplayName,
            };
          });
          } else {
            // Transform regular data to match the finance plan structure
            // First, process all payments - use vat_value directly from database (no auto-calculation)
            const processedPayments = data.map(plan => {
              const value = Number(plan.value);
              // Use the actual vat_value from the database (numeric column)
              const valueVat = Number(plan.value_vat || 0);
              const currency = plan.currency || '₪';
              
              // Do NOT auto-calculate VAT - use the value from the database
              // This allows VAT to be 0 when checkbox is unchecked
              
              const paymentTotal = value + valueVat;
              
              return {
                plan,
                value,
                valueVat,
                currency,
                paymentTotal
              };
            });
            
            // Calculate totals using the same VAT logic
            total = processedPayments.reduce((sum, processed) => sum + processed.paymentTotal, 0);
            vat = processedPayments.reduce((sum, processed) => sum + processed.valueVat, 0);
            
            // Group payments by contact to calculate percentages per contact
            const paymentsByContact = new Map<string, typeof processedPayments>();
            processedPayments.forEach(processed => {
              const contactName = processed.plan.client_name || 'Unknown Contact';
              if (!paymentsByContact.has(contactName)) {
                paymentsByContact.set(contactName, []);
              }
              paymentsByContact.get(contactName)!.push(processed);
            });
            
            // Calculate total per contact and then calculate percentages
            payments = processedPayments.map(processed => {
              const { plan, value, valueVat, currency, paymentTotal } = processed;
              
              // Get contact name
              const contactName = plan.client_name || 'Unknown Contact';
              
              // Calculate total for this contact's payments
              const contactPayments = paymentsByContact.get(contactName) || [];
              const contactTotal = contactPayments.reduce((sum, p) => sum + p.paymentTotal, 0);
              
              // Calculate percentage based on this contact's total, not the global total
              const duePercentStr = contactTotal > 0 ? Math.round((paymentTotal / contactTotal) * 100).toString() + '%' : '0%';
              
              return {
                id: plan.id,
                duePercent: duePercentStr,
                dueDate: plan.due_date,
                value,
                valueVat,
                client: contactName,
                order: typeof plan.payment_order === 'number' ? getOrderText(plan.payment_order) : (plan.payment_order || 'First Payment'),
                proforma: plan.proforma || null,
                notes: plan.notes || '',
                paid: plan.paid || false,
                paid_at: plan.paid_at || null,
                paid_by: plan.paid_by || null,
                currency,
                isLegacy: false,
                ready_to_pay: plan.ready_to_pay || false, // Include ready_to_pay field
                ready_to_pay_text: (plan as any).ready_to_pay_text || null,
                ready_to_pay_date: (plan as any).ready_to_pay_date || null,
                ready_to_pay_by: plan.ready_to_pay_by || null,
                ready_to_pay_by_display_name: plan.tenants_employee?.display_name || null,
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
        setFinancePlan(null);
        setPaidMap({});
      } finally {
        setIsLoadingFinancePlan(false);
        isFetchingRef.current = false;
      }
    };
    
    fetchPaymentPlans();
  }, [client?.id]);

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

  // Separate useEffect for loading contacts, contracts, and currencies
  useEffect(() => {
    // Add event listener for payment marked as paid
    const handlePaymentMarkedPaid = (event: CustomEvent) => {
      // Refresh payment plans to reflect the updated paid status
      refreshPaymentPlans();
    };

    // Add the event listener
    window.addEventListener('paymentMarkedPaid', handlePaymentMarkedPaid as EventListener);

    // Fetch contacts first, then fetch payment plans (which needs contacts to be loaded)
    // Note: fetchPaymentPlans now ensures contacts are loaded internally via await fetchContacts()
    const loadData = async () => {
      await fetchContacts();
      // fetchPaymentPlans will be called by its own useEffect, and it will await fetchContacts() again
      // This ensures contacts are always loaded before payment plans
      fetchContracts();
      
      // Fetch available currencies
      try {
        const { data, error } = await supabase
          .from('accounting_currencies')
          .select('id, name, iso_code')
          .order('id', { ascending: true });
        
        if (error) {
          console.error('Error fetching currencies:', error);
          // Set fallback currencies
          setAvailableCurrencies([
            { id: 1, name: '₪', iso_code: 'ILS' },
            { id: 2, name: '€', iso_code: 'EUR' },
            { id: 3, name: '$', iso_code: 'USD' },
            { id: 4, name: '£', iso_code: 'GBP' },
          ]);
        } else if (data && data.length > 0) {
          setAvailableCurrencies(data);
        } else {
          // Set fallback currencies if no data
          setAvailableCurrencies([
            { id: 1, name: '₪', iso_code: 'ILS' },
            { id: 2, name: '€', iso_code: 'EUR' },
            { id: 3, name: '$', iso_code: 'USD' },
            { id: 4, name: '£', iso_code: 'GBP' },
          ]);
        }
      } catch (error) {
        console.error('Error fetching currencies:', error);
        // Set fallback currencies
        setAvailableCurrencies([
          { id: 1, name: '₪', iso_code: 'ILS' },
          { id: 2, name: '€', iso_code: 'EUR' },
          { id: 3, name: '$', iso_code: 'USD' },
          { id: 4, name: '£', iso_code: 'GBP' },
        ]);
      }
    };
    loadData();

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
    
    // CRITICAL: Ensure contacts are loaded BEFORE fetching payment plans
    // This prevents payment plans from being incorrectly labeled with main client name
    // Get contacts directly from fetchContacts (returns immediately, doesn't wait for state update)
    const clientIdKey = client.id.toString();
    const contactsAlreadyLoaded = contactsLoadedRef.current === clientIdKey && contacts.length > 0;
    let currentContacts = contacts;
    if (!contactsAlreadyLoaded) {
      currentContacts = await fetchContacts();
      contactsLoadedRef.current = clientIdKey;
    }
    
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
              // Fetch payments by both lead_id (text) and client_id (bigint) for legacy leads
              const numericId = parseInt(legacyId);
              const isNumericIdValid = !isNaN(numericId);
              
              // Build OR condition: lead_id matches OR client_id matches main lead ID or contact IDs
              // Only use contact IDs if contacts array is loaded (non-empty)
              const contactIds = contacts.length > 0 ? contacts.map(c => c.id).filter(id => id != null) : [];
              const allClientIds = [numericId, ...contactIds].filter(id => id != null && !isNaN(Number(id)));
              
              // Build OR condition properly - each condition separated by comma
              let orCondition = `lead_id.eq.${legacyId}`;
              if (isNumericIdValid) {
                orCondition += `,client_id.eq.${numericId}`;
              }
              // Add contact IDs to OR condition
              contactIds.forEach(contactId => {
                if (contactId != null && !isNaN(Number(contactId))) {
                  orCondition += `,client_id.eq.${contactId}`;
                }
              });
              
              const { data: legacyData, error: legacyError } = await supabase
                .from('finances_paymentplanrow')
                .select(`
                  *,
                  accounting_currencies!finances_paymentplanrow_currency_id_fkey (
                    name,
                    iso_code
                  ),
                  tenants_employee:ready_to_pay_by (
                    id,
                    display_name
                  )
                `)
                .or(orCondition)
                .is('cancel_date', null)
                .order('date', { ascending: true });
          
          data = legacyData;
          error = legacyError;
      } else {
        // For regular leads, fetch from payment_plans table
        // Filter out canceled payments (cancel_date is null for active payments)
        const { data: regularData, error: regularError } = await supabase
          .from('payment_plans')
          .select(`
            *,
            tenants_employee:ready_to_pay_by (
              id,
              display_name
            )
          `)
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
          // Fetch employee display names for due_by_id values
          const dueByIds = new Set<number>();
          data.forEach((plan: any) => {
            if (plan.due_by_id) {
              dueByIds.add(plan.due_by_id);
            }
          });
          
          const dueByEmployeeMap = new Map<number, string>();
          if (dueByIds.size > 0) {
            const { data: employeesData } = await supabase
              .from('tenants_employee')
              .select('id, display_name')
              .in('id', Array.from(dueByIds));
            
            if (employeesData) {
              employeesData.forEach((emp: any) => {
                if (emp.id && emp.display_name) {
                  dueByEmployeeMap.set(emp.id, emp.display_name);
                }
              });
            }
          }
          
          // Transform legacy data with proper currency and VAT handling
          // First, process all payments to calculate totals and get currency info
          const processedPayments = data.map(plan => {
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
            
            return {
              plan,
              value,
              valueVat,
              currency,
              paymentTotal
            };
          });
          
          // Calculate totals using the same VAT logic
          let total = 0;
          let vat = 0;
          processedPayments.forEach(processed => {
            total += processed.paymentTotal;
            vat += processed.valueVat;
          });
          
          // Group payments by contact to calculate percentages per contact
          const paymentsByContact = new Map<string, typeof processedPayments>();
          processedPayments.forEach(processed => {
            const contactName = getContactNameFromClientId(processed.plan.client_id, currentContacts);
            if (!paymentsByContact.has(contactName)) {
              paymentsByContact.set(contactName, []);
            }
            paymentsByContact.get(contactName)!.push(processed);
          });
          
          // Calculate total per contact and then calculate percentages
          payments = processedPayments.map(processed => {
            const { plan, value, valueVat, currency, paymentTotal } = processed;
            
            // Get contact name from client_id
            const contactName = getContactNameFromClientId(plan.client_id, currentContacts);
            
            // Calculate total for this contact's payments
            const contactPayments = paymentsByContact.get(contactName) || [];
            const contactTotal = contactPayments.reduce((sum, p) => sum + p.paymentTotal, 0);
            
            // Calculate percentage based on this contact's total, not the global total
            const calculatedDuePercent = contactTotal > 0 ? Math.round((paymentTotal / contactTotal) * 100).toString() + '%' : '0%';
            
            // For legacy leads: if due_date and due_by_id are set, treat as ready_to_pay
            // This is because legacy leads use due_date and due_by_id instead of ready_to_pay flag
            const hasDueDateAndDueBy = plan.due_date && plan.due_by_id;
            const isReadyToPay = plan.ready_to_pay || hasDueDateAndDueBy;
            // For legacy leads, prioritize due_by_id over ready_to_pay_by
            const readyToPayBy = hasDueDateAndDueBy ? plan.due_by_id : (plan.ready_to_pay_by || null);
            // For legacy leads, get employee name from due_by_id using the map we fetched
            const readyToPayByDisplayName = hasDueDateAndDueBy 
              ? (dueByEmployeeMap.get(plan.due_by_id) || null)
              : (plan.tenants_employee?.display_name || null);
            
            return {
              id: plan.id,
              duePercent: calculatedDuePercent,
              dueDate: plan.date || plan.due_date,
              value,
              valueVat,
              client: contactName, // Use contact name from client_id mapping
              order: plan.order ? getOrderText(plan.order) : 'First Payment',
              proforma: null,
              notes: plan.notes || '',
              paid: plan.actual_date ? true : false,
              paid_at: plan.actual_date,
              paid_by: null,
              currency,
              isLegacy: true,
              ready_to_pay: isReadyToPay,
              ready_to_pay_by: readyToPayBy,
              ready_to_pay_by_display_name: readyToPayByDisplayName,
            };
          });
        } else {
          // Transform regular data
          // First, process all payments to calculate totals with consistent VAT logic
          const processedPayments = data.map(plan => {
            const value = Number(plan.value);
            let valueVat = Number(plan.value_vat || 0);
            const currency = plan.currency || '₪';
            
            // For NIS currency, calculate VAT if not set
            if (currency === '₪' && (!valueVat || valueVat === 0)) {
              valueVat = Math.round(value * 0.18 * 100) / 100;
            }
            
            const paymentTotal = value + valueVat;
            
            return {
              plan,
              value,
              valueVat,
              currency,
              paymentTotal
            };
          });
          
          // Calculate totals using the same VAT logic
          total = processedPayments.reduce((sum, processed) => sum + processed.paymentTotal, 0);
          vat = processedPayments.reduce((sum, processed) => sum + processed.valueVat, 0);
          
          // Group payments by contact to calculate percentages per contact
          const paymentsByContact = new Map<string, typeof processedPayments>();
          processedPayments.forEach(processed => {
            const contactName = processed.plan.client_name || 'Unknown Contact';
            if (!paymentsByContact.has(contactName)) {
              paymentsByContact.set(contactName, []);
            }
            paymentsByContact.get(contactName)!.push(processed);
          });
          
          // Calculate total per contact and then calculate percentages
          payments = processedPayments.map(processed => {
            const { plan, value, valueVat, currency, paymentTotal } = processed;
            
            // Get contact name
            const contactName = plan.client_name || 'Unknown Contact';
            
            // Calculate total for this contact's payments
            const contactPayments = paymentsByContact.get(contactName) || [];
            const contactTotal = contactPayments.reduce((sum, p) => sum + p.paymentTotal, 0);
            
            // Calculate percentage based on this contact's total, not the global total
            const duePercentStr = contactTotal > 0 ? Math.round((paymentTotal / contactTotal) * 100).toString() + '%' : '0%';
            
            return {
              id: plan.id,
              duePercent: duePercentStr,
              dueDate: plan.due_date,
              value,
              valueVat,
              client: contactName,
              order: typeof plan.payment_order === 'number' ? getOrderText(plan.payment_order) : (plan.payment_order || 'First Payment'),
              proforma: plan.proforma || null,
              notes: plan.notes || '',
              paid: plan.paid || false,
              paid_at: plan.paid_at || null,
              paid_by: plan.paid_by || null,
              currency,
              isLegacy: false,
              ready_to_pay: plan.ready_to_pay || false,
              ready_to_pay_by: plan.ready_to_pay_by || null,
              ready_to_pay_by_display_name: plan.tenants_employee?.display_name || null,
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

  const getLeftToPlanAmount = (forContact?: string) => {
    if (!financePlan) return 0;
    
    const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
    
    // If a specific contact is provided, calculate left to plan for that contact only
    if (forContact) {
      // Filter payments for this specific contact
      const contactPayments = financePlan.payments.filter(p => p.client === forContact);
      const contactPlannedValue = contactPayments.reduce((sum, payment) => sum + payment.value, 0);
      
      // For legacy leads, use contract total_amount if available
      if (isLegacyLead && contracts.length > 0) {
        const legacyContract = contracts.find(c => c.isLegacy);
        if (legacyContract && legacyContract.total_amount > 0) {
          // For now, use the full contract amount for each contact
          // In the future, this could be split per contact if needed
          const leftToPlan = legacyContract.total_amount - contactPlannedValue;
          return Math.max(0, leftToPlan);
        }
      }
      
      // For new leads, use balance
      if (!isLegacyLead && client?.balance) {
        const leftToPlan = client.balance - contactPlannedValue;
        return Math.max(0, leftToPlan);
      }
      
      // Fallback: use total amount
      const totalAmount = getTotalAmount();
      return Math.max(0, totalAmount - contactPlannedValue);
    }
    
    // Global calculation (all contacts combined)
    // For legacy leads, calculate based on total column vs payment values
    if (isLegacyLead && contracts.length > 0) {
      const legacyContract = contracts.find(c => c.isLegacy);
      if (legacyContract && legacyContract.total_amount > 0) {
        // Calculate sum of payment values (without VAT) across all contacts
        const totalPlannedValue = financePlan.payments.reduce((sum, payment) => sum + payment.value, 0);
        // Left to plan = Total column - Sum of payment values
        const leftToPlan = legacyContract.total_amount - totalPlannedValue;
        return Math.max(0, leftToPlan); // Don't return negative values
      }
    }
    
    // For new leads, calculate based on balance vs payment values
    if (!isLegacyLead && client?.balance) {
      // Calculate sum of payment values (without VAT) across all contacts
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
    // Get the contact name from newPaymentData or addingPaymentContact
    const contactName = newPaymentData.client || addingPaymentContact || '';
    const baseAmount = type === 'total' ? getTotalAmount() : getLeftToPlanAmount(contactName || undefined);
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
    // Get the contact name from newPaymentData or addingPaymentContact
    const contactName = newPaymentData.client || addingPaymentContact || '';
    const amount = type === 'total' ? getTotalAmount() : getLeftToPlanAmount(contactName || undefined);
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

  // Helper function to get all available contacts (main + additional) with IDs
  const getAllAvailableContacts = (): Array<{ name: string; isMain: boolean; id?: number }> => {
    const allContacts: Array<{ name: string; isMain: boolean; id?: number }> = [];
    const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
    
    console.log('🔍 getAllAvailableContacts called:', { 
      contactsLength: contacts?.length || 0, 
      contacts: contacts,
      currentClientName: client?.name,
      isLegacyLead 
    });
    
    if (isLegacyLead) {
      // For legacy leads, include contacts from the contacts array
      // The main contact's ID is the legacy lead ID (numeric)
      const legacyId = client?.id?.toString().replace('legacy_', '');
      const numericLegacyId = legacyId ? parseInt(legacyId, 10) : null;
      
      // Add main contact with its ID (the legacy lead's numeric ID)
      if (client?.name && numericLegacyId && !isNaN(numericLegacyId)) {
        allContacts.push({ name: client.name, isMain: true, id: numericLegacyId });
      }
      
      // Add additional contacts from contacts array (they have contact_id from leads_contact)
      if (contacts && contacts.length > 0) {
        contacts.forEach(contact => {
          if (contact.name && contact.name !== client?.name && contact.id) {
            allContacts.push({ name: contact.name, isMain: contact.isMain || false, id: contact.id });
          }
        });
      }
    } else {
      // For new leads, use contacts from the contacts state (which are fetched from lead_leadcontact and leads_contact tables)
      // This works the same way as legacy leads since we're using the same tables
      if (contacts && contacts.length > 0) {
        contacts.forEach(contact => {
          if (contact.name) {
            allContacts.push({ 
              name: contact.name, 
              isMain: contact.isMain || false, 
              id: contact.id 
            });
          }
        });
        console.log('✅ getAllAvailableContacts: Returning', allContacts.length, 'contacts from state');
      } else if (client?.name) {
        // Fallback: if no contacts found in database, at least include the main client name
        // Note: client.id is a string (UUID) for new leads, but id in contacts should be number
        // So we don't set id here for new leads fallback
        allContacts.push({ 
          name: client.name, 
          isMain: true
        });
        console.log('⚠️ getAllAvailableContacts: No contacts in state, using fallback:', client.name);
      } else {
        console.warn('⚠️ getAllAvailableContacts: No contacts and no currentClient name');
      }
    }
    
    return allContacts;
  };
  
  // Helper function to get client_id for a contact name
  const getClientIdForContact = (contactName: string): number | null => {
    const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
    
    if (!contactName) {
      console.warn('🔍 getClientIdForContact: contactName is empty or undefined');
      return null;
    }
    
    // CRITICAL: Always look up the contact in the contacts array first
    // This ensures we use the contact_id (from leads_contact table) instead of the lead_id
    const normalizedContactName = contactName.trim();
    const contact = contacts.find(c => c.name && c.name.trim() === normalizedContactName);
    
    if (contact?.id) {
      console.log('🔍 getClientIdForContact: Contact found in contacts array', { 
        contactName: normalizedContactName, 
        contactId: contact.id, 
        isMain: contact.isMain,
        allContacts: contacts.map(c => ({ name: c.name, id: c.id }))
      });
      return contact.id; // Return the contact_id from leads_contact table
    }
    
    // Fallback: If contact not found in array, try legacy lead ID (for backward compatibility)
    // But this should rarely happen if contacts are loaded correctly
    if (isLegacyLead) {
      const normalizedClientName = (client?.name || '').trim();
      if (normalizedContactName === normalizedClientName) {
        const legacyId = client?.id?.toString().replace('legacy_', '');
        const numericLegacyId = legacyId ? parseInt(legacyId, 10) : null;
        console.warn('⚠️ getClientIdForContact: Main contact not found in contacts array, using lead_id as fallback', { 
          contactName: normalizedContactName, 
          clientId: numericLegacyId,
          availableContacts: contacts.map(c => ({ name: c.name, id: c.id }))
        });
        return numericLegacyId && !isNaN(numericLegacyId) ? numericLegacyId : null;
      }
    }
    
    console.warn('🔍 getClientIdForContact: Contact not found', { 
      contactName: normalizedContactName, 
      clientName: client?.name,
      availableContacts: contacts.map(c => ({ name: c.name, id: c.id }))
    });
    return null;
  };
  
  // Helper function to get contact name from client_id for legacy payments
  // contactsArray parameter allows passing contacts directly to avoid state timing issues
  const getContactNameFromClientId = (clientId: number | null | undefined, contactsArray?: any[]): string => {
    // Use provided contacts array or fallback to state
    const contactsToUse = contactsArray || contacts;
    if (!clientId) {
      return client?.name || 'Legacy Client';
    }
    
    const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
    if (!isLegacyLead) {
      return client?.name || 'Legacy Client';
    }
    
    // Check if client_id matches the main lead ID
    const legacyId = client?.id?.toString().replace('legacy_', '');
    const numericLegacyId = legacyId ? parseInt(legacyId, 10) : null;
    if (numericLegacyId && clientId === numericLegacyId) {
      return client?.name || 'Legacy Client';
    }
    
    // Check if client_id matches a contact ID
    // Normalize both IDs to numbers for comparison to handle type mismatches
    const normalizedClientId = typeof clientId === 'string' ? parseInt(clientId, 10) : clientId;
    const contact = contactsToUse.find(c => {
      const normalizedContactId = typeof c.id === 'string' ? parseInt(c.id, 10) : c.id;
      return normalizedContactId === normalizedClientId;
    });
    
    if (contact?.name) {
      console.log('✅ getContactNameFromClientId: Found contact', { clientId, contactId: contact.id, contactName: contact.name });
      return contact.name;
    }
    
    // Debug: Log when contact is not found
    console.warn('⚠️ getContactNameFromClientId: Contact not found', { 
      clientId, 
      normalizedClientId,
      contactsCount: contactsToUse.length,
      availableContactIds: contactsToUse.map(c => ({ id: c.id, name: c.name, idType: typeof c.id }))
    });
    
    // If contact not found, don't fallback to main client - return a placeholder
    // This prevents incorrectly labeling contact payments as main client payments
    // The name will be corrected once contacts are loaded and payment plans refresh
    return `Contact #${clientId}`;
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
    // Set VAT checkbox based on whether VAT value exists and is > 0
    setEditPaymentIncludeVat((row.valueVat || 0) > 0);
  };

  const handleCancelEditPayment = () => {
    setEditingPaymentId(null);
    setEditPaymentData({});
    setEditPaymentIncludeVat(true); // Reset to default
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
      
      // Helper function to extract numeric value from duePercent (may be "100%" or 100)
      const parseDuePercent = (value: any): number => {
        if (typeof value === 'string') {
          // Remove % sign and parse
          const numStr = value.replace('%', '').trim();
          const num = parseFloat(numStr);
          return isNaN(num) ? 0 : num;
        }
        return typeof value === 'number' ? value : 0;
      };
      
      // Convert both original and edit values to numbers for proper comparison
      // Handle different field names for legacy vs new payments
      const originalDuePercent = parseDuePercent(isLegacyPayment ? originalPayment.due_percent : originalPayment.due_percent);
      const editDuePercent = parseDuePercent(editPaymentData.duePercent);
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
          changed_at: new Date().toISOString(),
        });
      }

      const originalDueDate = isLegacyPayment ? originalPayment?.date : originalPayment?.due_date;

      if (originalDueDate !== editPaymentData.dueDate) {
        changes.push({
          payment_plan_id: editPaymentData.id,
          field_name: isLegacyPayment ? 'date' : 'due_date',
          old_value: originalDueDate || '',
          new_value: editPaymentData.dueDate || '',
          changed_by: currentUserName,
          changed_at: new Date().toISOString(),
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
      
      // Check order changes - handle both legacy (numeric) and new (string) payments
      if (isLegacyPayment) {
        // For legacy payments, order is stored as a number, need to convert for comparison
        const getOrderNumber = (orderString: string): number => {
          switch (orderString) {
            case 'First Payment': return 1;
            case 'Intermediate Payment': return 5;
            case 'Final Payment': return 9;
            case 'Single Payment': return 90;
            case 'Expense (no VAT)': return 99;
            default: return 1;
          }
        };
        const getOrderText = (orderNumber: number | null | undefined): string => {
          if (orderNumber === null || orderNumber === undefined) return '';
          switch (orderNumber) {
            case 1: return 'First Payment';
            case 5: return 'Intermediate Payment';
            case 9: return 'Final Payment';
            case 90: return 'Single Payment';
            case 99: return 'Expense (no VAT)';
            default: return 'First Payment';
          }
        };
        const originalOrderText = getOrderText(originalPayment.order);
        const editOrderNumber = editPaymentData.order ? getOrderNumber(editPaymentData.order) : null;
        if (originalPayment.order !== editOrderNumber) {
          changes.push({
            payment_plan_id: editPaymentData.id,
            field_name: 'order',
            old_value: originalOrderText || '',
            new_value: editPaymentData.order || '',
            changed_by: currentUserName,
            changed_at: new Date().toISOString()
          });
        }
      } else {
        // For new payments, order is stored as a string
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
        const dueDateValue = editPaymentData.dueDate || null;
        
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
        
        const orderValue = editPaymentData.order ? getOrderNumber(editPaymentData.order) : null;
        
        // Parse due_percent to remove % sign if present
        const duePercentValue = parseDuePercent(editPaymentData.duePercent);
        
        const { error: legacyError } = await supabase
          .from('finances_paymentplanrow')
          .update({
            due_percent: duePercentValue,
            date: dueDateValue,
            due_date: dueDateValue,
            value: editPaymentData.value,
            vat_value: editPaymentData.valueVat,
            order: orderValue,
            notes: editPaymentData.notes,
          })
          .eq('id', editPaymentData.id);
        error = legacyError;
      } else {
        // For new payments, update payment_plans table
        // Parse due_percent to remove % sign if present
        const duePercentValue = parseDuePercent(editPaymentData.duePercent);
        
        // Calculate VAT based on checkbox state at save time
        // If checkbox is unchecked, VAT must be 0
        // If checkbox is checked, calculate 18% of the value
        const vatValue = !editPaymentIncludeVat
          ? 0
          : Math.round(Number(editPaymentData.value || 0) * 0.18 * 100) / 100;
        
        console.log('💾 Saving payment - VAT calculation:', {
          editPaymentIncludeVat,
          checkboxChecked: editPaymentIncludeVat,
          editPaymentDataValue: editPaymentData.value,
          calculatedVatValue: vatValue,
          editPaymentDataValueVat: editPaymentData.valueVat
        });
        
        const { error: newError } = await supabase
          .from('payment_plans')
          .update({
            due_percent: duePercentValue,
            due_date: editPaymentData.dueDate || null, // Set to null if empty
            value: editPaymentData.value,
            value_vat: vatValue, // Save VAT: 0 if checkbox unchecked, otherwise use value from state
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

  // Handler to delete all payments for a specific contact
  const handleDeletePaymentPlan = async (contactName: string) => {
    if (!window.confirm(`Are you sure you want to delete all payment rows for "${contactName}"? This action cannot be undone.`)) return;
    
    try {
      const currentUserName = await getCurrentUserName();
      const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
      
      if (isLegacyLead) {
        // For legacy leads, get client_id for the contact
        const clientIdForContact = getClientIdForContact(contactName);
        
        if (clientIdForContact === null) {
          toast.error(`Failed to find contact ID for "${contactName}". Cannot delete payment plan.`);
          return;
        }
        
        // Get all payments for this contact before deletion (for logging)
        const legacyId = client?.id?.toString().replace('legacy_', '');
        const { data: paymentsToDelete, error: fetchError } = await supabase
          .from('finances_paymentplanrow')
          .select('*')
          .eq('lead_id', legacyId)
          .eq('client_id', clientIdForContact)
          .is('cancel_date', null);
        
        if (fetchError) {
          console.error('Error fetching payments to delete:', fetchError);
          toast.error('Failed to fetch payments for deletion.');
          return;
        }
        
        if (!paymentsToDelete || paymentsToDelete.length === 0) {
          toast.success('No payments found for this contact.');
          return;
        }
        
        // Soft delete all payments for this contact
        const { error: deleteError } = await supabase
          .from('finances_paymentplanrow')
          .update({ cancel_date: new Date().toISOString().split('T')[0] })
          .eq('lead_id', legacyId)
          .eq('client_id', clientIdForContact)
          .is('cancel_date', null);
        
        if (deleteError) throw deleteError;
        
        toast.success(`Successfully deleted ${paymentsToDelete.length} payment(s) for "${contactName}"`);
      } else {
        // For new leads, use client_name to identify payments
        // Get all payments for this contact before deletion (for logging)
        const { data: paymentsToDelete, error: fetchError } = await supabase
          .from('payment_plans')
          .select('*')
          .eq('lead_id', client?.id)
          .eq('client_name', contactName)
          .is('cancel_date', null);
        
        if (fetchError) {
          console.error('Error fetching payments to delete:', fetchError);
          toast.error('Failed to fetch payments for deletion.');
          return;
        }
        
        if (!paymentsToDelete || paymentsToDelete.length === 0) {
          toast.success('No payments found for this contact.');
          return;
        }
        
        // Log deletions in payment_plan_changes table
        const changesToInsert = paymentsToDelete.map(payment => ({
          payment_plan_id: payment.id,
          lead_id: client?.id,
          field_name: 'payment_plan_deleted',
          old_value: JSON.stringify({
            id: payment.id,
            due_percent: payment.due_percent,
            due_date: payment.due_date,
            value: payment.value,
            value_vat: payment.value_vat,
            client_name: payment.client_name,
            payment_order: payment.payment_order,
            notes: payment.notes,
          }),
          new_value: '',
          changed_by: currentUserName,
          changed_at: new Date().toISOString()
        }));
        
        if (changesToInsert.length > 0) {
          const { error: historyError } = await supabase
            .from('payment_plan_changes')
            .insert(changesToInsert);
          
          if (historyError) {
            console.error('Error logging deletions:', historyError);
            // Continue with deletion even if logging fails
          }
        }
        
        // Soft delete all payments for this contact
        const { error: deleteError } = await supabase
          .from('payment_plans')
          .update({ cancel_date: new Date().toISOString().split('T')[0] })
          .eq('lead_id', client?.id)
          .eq('client_name', contactName)
          .is('cancel_date', null);
        
        if (deleteError) throw deleteError;
        
        toast.success(`Successfully deleted ${paymentsToDelete.length} payment(s) for "${contactName}"`);
      }
      
      await refreshPaymentPlans();
    } catch (error) {
      console.error('Error deleting payment plan:', error);
      toast.error('Failed to delete payment plan.');
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

  // Add state for new payment rows
  const [addingPaymentContact, setAddingPaymentContact] = useState<string | null>(null); // table context
  const [showDrawerNewPayment, setShowDrawerNewPayment] = useState(false); // finance-plan drawer context
  const [newPaymentData, setNewPaymentData] = useState<any>({});
  
  // Add superuser state
  const [isSuperuser, setIsSuperuser] = useState(false);
  // Add collection user state
  const [isCollection, setIsCollection] = useState(false);
  
  // Add state for available currencies
  const [availableCurrencies, setAvailableCurrencies] = useState<Array<{ id: number; name: string; iso_code: string }>>([]);

  // Shared initializer for new payment data
  const initNewPaymentData = (contactName: string) => {
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

    // Default amount: use balance/total where available
    let defaultAmount = 0;
    if (isLegacyLead && Array.isArray(contracts) && contracts.length > 0) {
      const legacyContract = contracts.find(c => c.isLegacy);
      if (legacyContract && legacyContract.total_amount > 0) {
        defaultAmount = Number(legacyContract.total_amount) || 0;
      }
    } else if (!isLegacyLead && typeof client?.balance === 'number' && client.balance > 0) {
      defaultAmount = Number(client.balance) || 0;
    }

    // Prefill duePercent as 100% when we have a default amount
    const defaultDuePercent = defaultAmount > 0 ? '100' : '';

    setNewPaymentData({
      dueDate: '',
      value: defaultAmount ? String(defaultAmount) : '',
      duePercent: defaultDuePercent,
      paymentOrder: 'Intermediate Payment',
      client: contactName,
      notes: '',
      paid: false,
      paid_at: null,
      paid_by: null,
      currency, // Set the correct currency
      includeVat: currency === '₪', // Default to true for NIS, false for others
      currencyId: currency === '₪' ? 1 : currency === '€' ? 2 : currency === '$' ? 3 : currency === '£' ? 4 : 1,
    });
  };

  // Handler to start adding a new payment in the main table for a contact
  const handleAddNewPayment = (contactName: string) => {
    setAddingPaymentContact(contactName);
    initNewPaymentData(contactName);
  };

  // Handler to start adding a new payment from inside the finance-plan drawer
  const handleOpenDrawerNewPayment = (contactName?: string) => {
    const selectedContact = contactName || client?.name || 'Main Contact';
    initNewPaymentData(selectedContact);
    setShowDrawerNewPayment(true);
  };

  // Handler to cancel adding new payment
  const handleCancelNewPayment = () => {
    setAddingPaymentContact(null);
    setShowDrawerNewPayment(false);
    setNewPaymentData({});
  };

  // Helper to get contract country for a contact name
  const getContractCountryForContact = (contactName: string) => {
    const contract = contracts.find(c => c.contact_name === contactName);
    return contract?.client_country || null;
  };

  // Handler to save new payment
  const handleSaveNewPayment = async () => {
    // Ensure client is set from context (addingPaymentContact or contactName from the section)
    const contactForPayment = newPaymentData.client || addingPaymentContact || client?.name || '';
    if (!newPaymentData.value || !contactForPayment || !newPaymentData.duePercent) {
      toast.error('Please fill in all required fields (Value and Due Percentage)');
      return;
    }

    setIsSavingPaymentRow(true);
    try {
      const currentUserName = await getCurrentUserName();
      
      // Check if this is a legacy lead
      const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
      
      if (isLegacyLead) {
        // For legacy leads, save to finances_paymentplanrow table
        const legacyIdStr = client?.id?.toString().replace('legacy_', '');
        const legacyId = legacyIdStr ? parseInt(legacyIdStr, 10) : null;
        
        if (!legacyId || isNaN(legacyId)) {
          throw new Error('Invalid legacy lead ID');
        }
        
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

        // Generate a unique numeric ID for the new payment
        const paymentId = Date.now() + Math.floor(Math.random() * 1000000);
        
        // Get client_id for the contact (from context, as dropdown is removed)
        const contactForPayment = newPaymentData.client || addingPaymentContact || client?.name || '';
        const clientIdForContact = getClientIdForContact(contactForPayment);
        
        const paymentData = {
          id: paymentId,
          cdate: new Date().toISOString().split('T')[0], // Current date
          udate: new Date().toISOString().split('T')[0], // Current date
          date: newPaymentData.dueDate || null, // Set to null if empty
          value: Number(newPaymentData.value),
          vat_value: (currency === '₪' && newPaymentData.includeVat !== false) ? Math.round(Number(newPaymentData.value) * 0.18 * 100) / 100 : 0,
          lead_id: legacyId, // Use numeric lead_id to ensure correct matching for subleads
          notes: newPaymentData.notes || '',
          due_date: newPaymentData.dueDate || null, // Set to null if empty
          due_percent: (() => {
            const percent = newPaymentData.duePercent || '0';
            const percentStr = percent.toString();
            return percentStr.includes('%') ? percentStr : percentStr + '%';
          })(), // Store the due percentage as text with % sign
          order: getOrderNumber(newPaymentData.paymentOrder || 'Intermediate Payment'), // Convert string to numeric
          currency_id: currencyId,
          client_id: clientIdForContact, // Set client_id to separate payments by contact
        };
        
        const { data, error } = await supabase
          .from('finances_paymentplanrow')
          .insert(paymentData)
          .select();

        if (error) throw error;
      } else {
        // For new leads, save to payment_plans table
        // Get client_id for the contact
        const contactForPayment = newPaymentData.client || addingPaymentContact || client?.name || '';
        const clientIdForContact = getClientIdForContact(contactForPayment);
        
        // Calculate VAT based on checkbox state (includeVat)
        // If checkbox is checked, calculate VAT; if unchecked, VAT is 0
        const vatValue = newPaymentData.includeVat !== false 
          ? Math.round(Number(newPaymentData.value) * 0.18 * 100) / 100 
          : 0;
        
        // Ensure we're using the correct lead_id for this specific lead/sublead
        const leadIdForPayment = client?.id;
        if (!leadIdForPayment) {
          throw new Error('Invalid lead ID');
        }
        
        const paymentData: any = {
          lead_id: leadIdForPayment, // Use the specific lead_id for this lead/sublead
          due_percent: Number(newPaymentData.duePercent) || Number(100),
          percent: Number(newPaymentData.duePercent) || Number(100),
          due_date: newPaymentData.dueDate || null, // Set to null if empty
          value: Number(newPaymentData.value),
          value_vat: vatValue, // Use calculated VAT based on checkbox state
          client_name: newPaymentData.client || addingPaymentContact || client?.name || '',
          payment_order: newPaymentData.paymentOrder || 'One-time Payment',
          notes: newPaymentData.notes || '',
          currency: newPaymentData.currency || '₪',
          created_by: currentUserName,
        };
        
        // Add client_id if available (int8 column for contact_id)
        // This ensures payments are correctly associated with the specific contact for this lead
        if (clientIdForContact !== null) {
          paymentData.client_id = clientIdForContact;
        }
        
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
    if (!autoPlanData.totalAmount || !autoPlanData.numberOfPayments || !autoPlanData.contact) {
      toast.error('Please fill in all required fields (Total Amount, Number of Payments, and Contact)');
      return;
    }

    const percents = autoPlanData.paymentPercents || [];
    const activePercents = percents.slice(0, autoPlanData.numberOfPayments);
    const sumPercents = activePercents.reduce((sum, value) => sum + Number(value || 0), 0);

    if (sumPercents !== 100) {
      toast.error('The sum of all payment percentages must be exactly 100%. Please adjust the values.');
      return;
    }

    setIsSavingPaymentRow(true);
    try {
      const currentUserName = await getCurrentUserName();
      const totalAmount = Number(autoPlanData.totalAmount);

      // Check if this is a legacy lead
      const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
      
      if (isLegacyLead) {
        // For legacy leads, save to finances_paymentplanrow table
        const legacyIdStr = client?.id?.toString().replace('legacy_', '');
        const legacyId = legacyIdStr ? parseInt(legacyIdStr, 10) : null;
        
        if (!legacyId || isNaN(legacyId)) {
          throw new Error('Invalid legacy lead ID');
        }
        
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

        // Helper function to convert text order to numeric (same as new leads logic)
        const getOrderNumber = (orderString: string): number => {
          switch (orderString) {
            case 'First Payment': return 1;
            case 'Intermediate Payment': return 5;
            case 'Final Payment': return 9;
            case 'Single Payment': return 90;
            case 'Expense (no VAT)': return 99;
            default: return 5; // Default to intermediate
          }
        };

        const legacyPayments = [];
        const today = new Date();
        
        // Get client_id for the selected contact (outside the loop since it's the same for all payments)
        const selectedContactName = autoPlanData.contact || client?.name || '';
        console.log('🔍 handleCreateAutoPlan: Getting client_id for contact', { 
          selectedContactName, 
          autoPlanDataContact: autoPlanData.contact,
          clientName: client?.name,
          contactsCount: contacts.length,
          contacts: contacts.map(c => ({ name: c.name, id: c.id }))
        });
        const clientIdForContact = getClientIdForContact(selectedContactName);
        console.log('🔍 handleCreateAutoPlan: client_id result', { clientIdForContact, selectedContactName });
        
        if (clientIdForContact === null && selectedContactName !== client?.name) {
          console.error('⚠️ handleCreateAutoPlan: Failed to get client_id for contact', { selectedContactName });
          toast.error(`Failed to find contact ID for "${selectedContactName}". Please ensure the contact exists.`);
          setIsSavingPaymentRow(false);
          return;
        }

        // Ensure paymentOrders array is properly initialized
        const paymentOrders = autoPlanData.paymentOrders || [];
        while (paymentOrders.length < autoPlanData.numberOfPayments) {
          const idx = paymentOrders.length;
          const defaultOrder = idx === 0 ? 'First Payment' : idx === autoPlanData.numberOfPayments - 1 ? 'Final Payment' : 'Intermediate Payment';
          paymentOrders.push(defaultOrder);
        }

        for (let i = 0; i < autoPlanData.numberOfPayments; i++) {
          const paymentPercent = Number(activePercents[i] || 0);
          const value = (totalAmount * paymentPercent) / 100;
          // Use custom order from paymentOrders array, or fallback to default based on position
          const defaultOrder = i === 0 ? 'First Payment' : i === autoPlanData.numberOfPayments - 1 ? 'Final Payment' : 'Intermediate Payment';
          const orderText = paymentOrders[i] || defaultOrder;
          // Convert to numeric for database storage
          const orderValue = getOrderNumber(orderText);

          // Calculate due date: 3 months apart for each payment (i * 3 months from today)
          const dueDate = new Date(today);
          dueDate.setMonth(dueDate.getMonth() + (i * 3));
          const dueDateStr = dueDate.toISOString().split('T')[0];

          const paymentRow = {
            cdate: new Date().toISOString().split('T')[0], // Current date
            udate: new Date().toISOString().split('T')[0], // Current date
            date: dueDateStr, // Keep the calculated date
            value,
            vat_value: autoPlanData.includeVat
              ? Math.round(value * 0.18 * 100) / 100
              : 0,
            lead_id: legacyId, // Convert to number (bigint)
            notes: '',
            due_date: null, // MUST be null for legacy leads - only set when marking as ready to pay
            due_percent: `${paymentPercent}%`, // Store the due percentage as text with % sign
            order: orderValue, // Convert text order to numeric for database
            currency_id: currencyId,
            client_id: clientIdForContact, // Set client_id to separate payments by contact
          };
          
          console.log('🔍 handleCreateAutoPlan: Adding payment row', { 
            paymentIndex: i, 
            client_id: paymentRow.client_id, 
            contactName: selectedContactName,
            lead_id: paymentRow.lead_id 
          });
          
          legacyPayments.push(paymentRow);
        }

        console.log('🔍 handleCreateAutoPlan: Inserting payments', { 
          count: legacyPayments.length, 
          samplePayment: legacyPayments[0],
          allClientIds: legacyPayments.map(p => p.client_id)
        });
        
        const { data: insertedLegacyPayments, error: legacyPaymentInsertError } = await supabase
          .from('finances_paymentplanrow')
          .insert(legacyPayments)
          .select('id, client_id');

        if (legacyPaymentInsertError) {
          console.error('❌ handleCreateAutoPlan: Error inserting payments', legacyPaymentInsertError);
          throw legacyPaymentInsertError;
        }
        
        console.log('✅ handleCreateAutoPlan: Payments inserted successfully', { 
          inserted: insertedLegacyPayments,
          insertedClientIds: insertedLegacyPayments?.map(p => p.client_id)
        });
      } else {
        // For new leads, save to payment_plans table
        const payments = [];
        const today = new Date();

        // Get client_id for the selected contact (for new leads)
        const selectedContactName = autoPlanData.contact || client?.name || '';
        const clientIdForContact = getClientIdForContact(selectedContactName);
        console.log('🔍 handleCreateAutoPlan (new leads): Getting client_id for contact', { 
          selectedContactName, 
          clientIdForContact,
          contactsCount: contacts.length,
          contacts: contacts.map(c => ({ name: c.name, id: c.id }))
        });

        // Ensure paymentOrders array is properly initialized
        const paymentOrders = autoPlanData.paymentOrders || [];
        while (paymentOrders.length < autoPlanData.numberOfPayments) {
          const idx = paymentOrders.length;
          const defaultOrder = idx === 0 ? 'First Payment' : idx === autoPlanData.numberOfPayments - 1 ? 'Final Payment' : 'Intermediate Payment';
          paymentOrders.push(defaultOrder);
        }

        for (let i = 0; i < autoPlanData.numberOfPayments; i++) {
          const paymentPercent = Number(activePercents[i] || 0);
          const value = (totalAmount * paymentPercent) / 100;

          // Calculate due date: 3 months apart for each payment (i * 3 months from today)
          const dueDate = new Date(today);
          dueDate.setMonth(dueDate.getMonth() + (i * 3));
          const dueDateStr = dueDate.toISOString().split('T')[0];

          // Calculate VAT based on checkbox state (includeVat)
          // If checkbox is checked, calculate VAT; if unchecked, VAT is 0
          const vatValue = autoPlanData.includeVat
            ? Math.round(value * 0.18 * 100) / 100
            : 0;
          
          // Use custom order from paymentOrders array, or fallback to default based on position
          const defaultOrder = i === 0 ? 'First Payment' : i === autoPlanData.numberOfPayments - 1 ? 'Final Payment' : 'Intermediate Payment';
          const orderText = paymentOrders[i] || defaultOrder;
          
          // Ensure we're using the correct lead_id for this specific lead/sublead
          const leadIdForPayment = client?.id;
          if (!leadIdForPayment) {
            throw new Error('Invalid lead ID');
          }
          
          const paymentData: any = {
            lead_id: leadIdForPayment, // Use the specific lead_id for this lead/sublead
            due_percent: paymentPercent,
            due_date: dueDateStr,
            value,
            value_vat: vatValue, // Use calculated VAT based on checkbox state
            client_name: autoPlanData.contact || client?.name || 'Main Contact',
            payment_order: orderText,
            notes: '',
            currency: autoPlanData.currency,
            created_by: currentUserName,
          };
          
          // Add client_id if available (int8 column for contact_id)
          // This ensures payments are correctly associated with the specific contact for this lead
          if (clientIdForContact !== null) {
            paymentData.client_id = clientIdForContact;
          }
          
          payments.push(paymentData);
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
        paymentPercents: [50, 25, 25],
        paymentOrders: ['First Payment', 'Intermediate Payment', 'Final Payment'],
        includeVat: true,
        contact: '', // Reset contact
      });
      setIsCustomPaymentCount(false);
      setCustomPaymentCount(6);
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
      paymentPercents: [50, 25, 25],
      paymentOrders: ['First Payment', 'Intermediate Payment', 'Final Payment'],
      includeVat: true,
      contact: '', // Reset contact
    });
    setIsCustomPaymentCount(false);
    setCustomPaymentCount(6);
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

  // Helper function to get current user's employee_id from Supabase users table
  const getCurrentUserEmployeeId = async (): Promise<number | null> => {
    try {
      // Get current user from Supabase auth
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        return null;
      }
    
      // Get user from users table with employee_id
      const { data: userData, error } = await supabase
        .from('users')
        .select('employee_id')
        .eq('auth_id', user.id)
        .single();
      
      if (error || !userData) {
        // Try by email as fallback
        if (user.email) {
          const { data: userDataByEmail } = await supabase
            .from('users')
            .select('employee_id')
            .eq('email', user.email)
            .single();
          
          if (userDataByEmail?.employee_id && typeof userDataByEmail.employee_id === 'number') {
            return userDataByEmail.employee_id;
          }
        }
        return null;
      }
      
      if (userData?.employee_id && typeof userData.employee_id === 'number') {
        return userData.employee_id;
      }
      
      return null;
    } catch (error) {
      console.error('Error getting current user employee_id:', error);
      return null;
    }
  };

  if (isLoadingFinancePlan) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <span className="loading loading-spinner loading-lg text-primary"></span>
        <div className="text-lg font-medium text-gray-600 mt-4">Loading finance plan...</div>
      </div>
    );
  }

  if (!financePlan) {
    return (
      <>
        <div className="flex flex-col items-center justify-center h-64 text-center">
          <BanknotesIcon className="w-16 h-16 text-primary mb-4" />
          <div className="text-2xl font-bold text-gray-800 mb-2">No finance plan created yet.</div>
          <div className="text-gray-500 mb-6">Create a payments plan to see finances here.</div>
          <button
            type="button"
            className="btn btn-md bg-black text-white border-none gap-3 shadow-sm text-lg font-bold py-3 px-6"
            onClick={() => {
              handleOpenStagesDrawer();
            }}
          >
            <BanknotesIcon className="w-5 h-5 text-white" />
            Create Finance Plan
          </button>
        </div>

        {/* Stages Drawer for creating a new finance plan */}
        {showStagesDrawer && ReactDOM.createPortal(
          <div className="fixed inset-0 z-[100] flex">
            {/* Overlay */}
            <div className="fixed inset-0 bg-black/30" onClick={handleCloseStagesDrawer} />
            {/* Drawer */}
            <div className="ml-auto w-full max-w-4xl h-full bg-white shadow-2xl p-0 flex flex-col animate-slideInRight z-[110] overflow-hidden">
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
                          className="input input-bordered w-full no-arrows"
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
                          {availableCurrencies.length === 0 ? (
                            <>
                              <option value="₪">₪ (ILS)</option>
                              <option value="€">€ (EUR)</option>
                              <option value="$">$ (USD)</option>
                              <option value="£">£ (GBP)</option>
                            </>
                          ) : (
                            availableCurrencies.map((curr) => (
                              <option key={curr.id} value={curr.name}>
                                {curr.name} ({curr.iso_code})
                              </option>
                            ))
                          )}
                        </select>
                      </div>
                    </div>
                    <div className="form-control">
                      <label className="label">
                        <span className="label-text font-medium">Contact</span>
                      </label>
                      <select
                        className="select select-bordered w-full"
                        value={autoPlanData.contact}
                        onChange={(e) => setAutoPlanData(prev => ({ ...prev, contact: e.target.value }))}
                      >
                        <option value="">Select contact...</option>
                        {getAllAvailableContacts().map((contact, idx) => (
                          <option key={idx} value={contact.name}>
                            {contact.name} {contact.isMain && '(Main)'}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="form-control">
                        <label className="label">
                          <span className="label-text font-medium">Number of Payments</span>
                        </label>
                        <select
                          className="select select-bordered w-full"
                          value={isCustomPaymentCount ? 'custom' : autoPlanData.numberOfPayments}
                          onChange={(e) => {
                            if (e.target.value === 'custom') {
                              setIsCustomPaymentCount(true);
                            } else {
                              setIsCustomPaymentCount(false);
                              const count = Number(e.target.value);
                            setAutoPlanData(prev => {
                              let percents: number[];
                              let orders: string[];
                              if (count === 1) {
                                // For single payment, set to 100%
                                percents = [100];
                                orders = ['Single Payment'];
                              } else if (count === 3) {
                                // Special default for 3 payments
                                percents = [50, 25, 25];
                                orders = ['First Payment', 'Intermediate Payment', 'Final Payment'];
                              } else {
                                // Even split that sums to 100
                                const base = Math.floor(100 / count);
                                percents = Array.from({ length: count }, () => base);
                                const remainder = 100 - base * count;
                                for (let i = 0; i < remainder; i++) {
                                  percents[i] += 1;
                                }
                                // Generate default orders
                                orders = Array.from({ length: count }, (_, i) => {
                                  if (i === 0) return 'First Payment';
                                  if (i === count - 1) return 'Final Payment';
                                  return 'Intermediate Payment';
                                });
                              }
                              return {
                                ...prev,
                                numberOfPayments: count,
                                paymentPercents: percents,
                                paymentOrders: orders,
                              };
                            });
                            }
                          }}
                        >
                          <option value={1}>1 Payment</option>
                          <option value={2}>2 Payments</option>
                          <option value={3}>3 Payments</option>
                          <option value={4}>4 Payments</option>
                          <option value={5}>5 Payments</option>
                          <option value="custom">Custom</option>
                        </select>
                        {isCustomPaymentCount && (
                          <div className="mt-2">
                            <input
                              type="number"
                              className="input input-bordered w-full"
                              min={1}
                              max={100}
                              value={customPaymentCount}
                              onChange={(e) => {
                                const count = Number(e.target.value) || 1;
                                setCustomPaymentCount(count);
                                setAutoPlanData(prev => {
                                  let percents: number[];
                                  let orders: string[];
                                  if (count === 1) {
                                    // For single payment, set to 100%
                                    percents = [100];
                                    orders = ['Single Payment'];
                                  } else if (count === 3) {
                                    // Special default for 3 payments
                                    percents = [50, 25, 25];
                                    orders = ['First Payment', 'Intermediate Payment', 'Final Payment'];
                                  } else {
                                    // Even split that sums to 100
                                    const base = Math.floor(100 / count);
                                    percents = Array.from({ length: count }, () => base);
                                    const remainder = 100 - base * count;
                                    for (let i = 0; i < remainder; i++) {
                                      percents[i] += 1;
                                    }
                                    // Generate default orders
                                    orders = Array.from({ length: count }, (_, i) => {
                                      if (i === 0) return 'First Payment';
                                      if (i === count - 1) return 'Final Payment';
                                      return 'Intermediate Payment';
                                    });
                                  }
                                  return {
                                    ...prev,
                                    numberOfPayments: count,
                                    paymentPercents: percents,
                                    paymentOrders: orders,
                                  };
                                });
                              }}
                              placeholder="Enter number of payments"
                            />
                          </div>
                        )}
                      </div>
                      <div className="form-control">
                        <label className="label">
                          <span className="label-text font-medium">Payment Percentages & Amounts</span>
                        </label>
                        <div className="space-y-2">
                          {Array.from({ length: autoPlanData.numberOfPayments }).map((_, index) => {
                            const isFirst = index === 0;
                            const isLast = index === autoPlanData.numberOfPayments - 1;
                            const defaultLabel =
                              isFirst ? 'First Payment' : isLast ? 'Final Payment' : 'Intermediate Payment';
                            const currentOrder = autoPlanData.paymentOrders?.[index] || defaultLabel;
                            return (
                            <div key={index} className="flex items-center gap-2">
                              <select
                                className="select select-bordered w-40 text-sm"
                                value={currentOrder}
                                onChange={(e) => {
                                  setAutoPlanData(prev => {
                                    const next = [...(prev.paymentOrders || [])];
                                    // Ensure array length
                                    while (next.length < prev.numberOfPayments) {
                                      const idx = next.length;
                                      const defaultOrder = idx === 0 ? 'First Payment' : idx === prev.numberOfPayments - 1 ? 'Final Payment' : 'Intermediate Payment';
                                      next.push(defaultOrder);
                                    }
                                    next[index] = e.target.value;
                                    return {
                                      ...prev,
                                      paymentOrders: next,
                                    };
                                  });
                                }}
                              >
                                <option value="First Payment">First Payment</option>
                                <option value="Intermediate Payment">Intermediate Payment</option>
                                <option value="Final Payment">Final Payment</option>
                                <option value="Single Payment">Single Payment</option>
                                <option value="Expense (no VAT)">Expense (no VAT)</option>
                              </select>
                              <input
                                type="number"
                                className="input input-bordered w-24 no-arrows"
                                min={0}
                                max={100}
                                value={autoPlanData.paymentPercents[index] ?? 0}
                                onChange={(e) => {
                                  const percentValue = Number(e.target.value || 0);
                                  const totalAmount = Number(autoPlanData.totalAmount || 0);
                                  setAutoPlanData(prev => {
                                    const next = [...(prev.paymentPercents || [])];
                                    // Ensure array length
                                    while (next.length < prev.numberOfPayments) next.push(0);
                                    next[index] = percentValue;
                                    return {
                                      ...prev,
                                      paymentPercents: next,
                                    };
                                  });
                                }}
                              />
                              <span className="text-sm">%</span>
                              <input
                                type="number"
                                className="input input-bordered w-32 no-arrows"
                                min={0}
                                step="0.01"
                                value={(() => {
                                  const totalAmount = Number(autoPlanData.totalAmount || 0);
                                  const percent = autoPlanData.paymentPercents[index] ?? 0;
                                  return totalAmount > 0 ? ((totalAmount * percent) / 100).toFixed(2) : '0.00';
                                })()}
                                onChange={(e) => {
                                  const amountValue = Number(e.target.value || 0);
                                  const totalAmount = Number(autoPlanData.totalAmount || 0);
                                  if (totalAmount > 0) {
                                    const newPercent = (amountValue / totalAmount) * 100;
                                    setAutoPlanData(prev => {
                                      const next = [...(prev.paymentPercents || [])];
                                      // Ensure array length
                                      while (next.length < prev.numberOfPayments) next.push(0);
                                      next[index] = Math.round(newPercent * 100) / 100; // Round to 2 decimal places
                                      return {
                                        ...prev,
                                        paymentPercents: next,
                                      };
                                    });
                                  }
                                }}
                                placeholder="0.00"
                              />
                              <span className="text-sm">{autoPlanData.currency || '₪'}</span>
                            </div>
                          )})}
                          <div className="text-xs text-gray-500">
                            Sum must be exactly 100%. If not, you'll see an error when creating the plan.
                          </div>
                        </div>
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
                        <span className="label-text font-medium">Include VAT (18%)</span>
                      </label>
                    </div>
                    <button
                      className="btn btn-primary w-full"
                      onClick={handleCreateAutoPlan}
                      disabled={isSavingPaymentRow || !autoPlanData.totalAmount || !autoPlanData.contact}
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
              </div>
            </div>
          </div>, document.body)
        }
      </>
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
        {/* COMMENTED OUT - Contract Information Section
        {contracts.length > 0 ? (
          <div className="mb-8">
            <div className="bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden">
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
              
              <div className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {contracts.map((contract) => (
                    <div key={contract.id} className="group relative bg-white rounded-xl p-6 border border-gray-200 hover:border-purple-300 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-[1.02]">
                      <div className="absolute top-4 right-4">
                        <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold ${
                          contract.status === 'signed' 
                            ? 'bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none shadow-sm' 
                            : 'bg-yellow-100 text-yellow-800 border border-yellow-200'
                        }`}>
                          {contract.status === 'signed' ? 'Signed' : 'Draft'}
                        </span>
                      </div>
                      
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
                                contract.total_amount > 0 ? (
                                  <>
                                    {getCurrencySymbol(client?.balance_currency)}{contract.total_amount.toLocaleString()}
                                  </>
                                ) : (
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
        */}

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
    <span className="text-sm font-bold text-gray-900">{formatDateDDMMYYYY(p.dueDate)}</span>
  )}
</td>
                                        <td className="font-bold align-middle text-center px-4 py-3 whitespace-nowrap">
  {editingPaymentId === p.id ? (
    <div className="flex items-center gap-2">
      <input
        type="number"
        className="input input-bordered input-lg w-32 text-right font-bold rounded-xl border-2 border-blue-300 focus:border-blue-500 no-arrows"
        value={editPaymentData.value}
        onChange={(e) => {
          const newValue = Number(e.target.value) || 0;
          const currency = editPaymentData.currency || p.currency || '₪';
          // Recalculate VAT based on checkbox state: 18% if includeVat is checked, 0 otherwise
          const newValueVat = editPaymentIncludeVat ? Math.round(newValue * 0.18 * 100) / 100 : 0;
          setEditPaymentData((d: any) => ({ 
            ...d, 
            value: newValue,
            valueVat: newValueVat,
            currency: currency // Explicitly preserve currency
          }));
        }}
      />
                      <span className='text-gray-500 font-bold'>+
        <input
          type="number"
          className={`input input-bordered input-lg w-20 text-right font-bold rounded-xl border-2 border-blue-300 no-arrows ${editingValueVatId === p.id ? '' : 'bg-gray-100 text-gray-500 cursor-not-allowed'}`}
          value={editPaymentData.valueVat || 0}
          readOnly={editingValueVatId !== p.id}
          onChange={editingValueVatId === p.id ? (e) => setEditPaymentData((d: any) => ({ ...d, valueVat: e.target.value })) : undefined}
          title={editingValueVatId !== p.id ? 'Click pencil icon to manually edit VAT' : ''}
        />
      </span>
      {editingValueVatId === p.id ? (
        <button className="btn btn-xs btn-ghost ml-1" onClick={() => setEditingValueVatId(null)} title="Done editing VAT manually">
          <CheckIcon className="w-4 h-4 text-green-600" />
        </button>
      ) : (
        <button className="btn btn-xs btn-ghost ml-1" onClick={() => setEditingValueVatId(p.id)} title="Manually edit VAT (overrides auto-calculation)">
          <PencilIcon className="w-4 h-4 text-blue-600" />
        </button>
      )}
      <label className="label cursor-pointer gap-2 ml-2">
        <input
          type="checkbox"
          className="checkbox checkbox-sm checkbox-primary"
          checked={editPaymentIncludeVat}
          onChange={(e) => {
            const includeVat = e.target.checked;
            setEditPaymentIncludeVat(includeVat);
            const newValueVat = includeVat ? Math.round(Number(editPaymentData.value || 0) * 0.18 * 100) / 100 : 0;
            setEditPaymentData((d: any) => ({ ...d, valueVat: newValueVat }));
          }}
        />
        <span className="label-text text-xs">VAT</span>
      </label>
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
                                          {p.paid_at ? new Date(p.paid_at).toLocaleDateString() : '---'}
                                        </td>
                                        <td className="align-middle text-center px-4 py-3 whitespace-nowrap">
                                          {editingPaymentId === p.id ? (
                                            <select 
                                              className="select select-bordered w-full max-w-[200px]"
                                              value={editPaymentData.order || 'Intermediate Payment'}
                                              onChange={e => setEditPaymentData((d: any) => ({ ...d, order: e.target.value }))}
                                            >
                                              <option value="First Payment">First Payment</option>
                                              <option value="Intermediate Payment">Intermediate Payment</option>
                                              <option value="Final Payment">Final Payment</option>
                                              <option value="Single Payment">Single Payment</option>
                                              <option value="Expense (no VAT)">Expense (no VAT)</option>
                                            </select>
                                          ) : (
                                            p.order
                                          )}
                                        </td>
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
                                                    className="btn btn-sm btn-circle bg-blue-100 hover:bg-blue-200 text-blue-700 border-blue-300 border-2 shadow-sm flex items-center justify-center" 
                                                    title="Create Proforma" 
                                                    onClick={e => { e.preventDefault(); navigate(`/proforma-legacy/create/${client.id.toString().replace('legacy_', '')}?ppr_id=${p.id}`); }}
                                                    style={{ padding: 0 }}
                                                  >
                                                    <PlusIcon className="w-5 h-5" />
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
                                              className="btn btn-sm btn-circle bg-blue-100 hover:bg-blue-200 text-blue-700 border-blue-300 border-2 shadow-sm flex items-center justify-center" 
                                              title="Create Proforma" 
                                              onClick={e => { e.preventDefault(); navigate(`/proforma/create/${p.id}`); }}
                                              style={{ padding: 0 }}
                                            >
                                              <PlusIcon className="w-5 h-5" />
                                            </button>
                                          )}
                                        </td>
                                        <td className="align-middle text-center px-4 py-3 whitespace-nowrap">
                                          {editingPaymentId === p.id ? (
                                            <input 
                                              className="input input-bordered w-full max-w-[200px] text-right" 
                                              value={editPaymentData.notes || ''} 
                                              onChange={e => setEditPaymentData((d: any) => ({ ...d, notes: e.target.value }))} 
                                              placeholder="Notes" 
                                            />
                                          ) : (
                                            p.notes
                                          )}
                                        </td>
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
                                                {/* Sent to Finances indicator with revert button */}
                                                {!isPaid && p.ready_to_pay && (
                                                  <div className="tooltip tooltip-top z-[9999]" data-tip={p.ready_to_pay_by_display_name ? `Marked by ${p.ready_to_pay_by_display_name} - Click to revert` : 'Ready to pay - Click to revert'}>
                                                    <button
                                                      className="btn btn-sm btn-circle bg-red-100 hover:bg-red-200 text-red-700 border-red-300 border-2 shadow-sm flex items-center justify-center"
                                                      title={p.ready_to_pay_by_display_name ? `Marked by ${p.ready_to_pay_by_display_name} - Click to revert` : 'Revert Ready to Pay'}
                                                      onClick={() => handleRevertReadyToPay(p)}
                                                      style={{ padding: 0 }}
                                                    >
                                                      <XMarkIcon className="w-5 h-5" />
                                                    </button>
                                                  </div>
                                                )}
                                                {/* Dollar icon (small) - only for superusers or collection users */}
                                                {!isPaid && (isSuperuser || isCollection) && (
                                                  <button
                                                    className="btn btn-sm btn-circle bg-green-100 hover:bg-green-200 text-green-700 border-green-300 border-2 shadow-sm flex items-center justify-center"
                                                    title={p.isLegacy ? "Mark Legacy Payment as Paid" : "Mark as Paid"}
                                                    onClick={() => handleOpenPaidDateModal(p.id)}
                                                    style={{ padding: 0 }}
                                                  >
                                                    <CurrencyDollarIcon className="w-5 h-5" />
                                                  </button>
                                                )}
                                                {/* Edit icon (small) - only for superusers/collection if paid, available for all if not paid */}
                                                {(!isPaid || isSuperuser || isCollection) && (
                                                  <button
                                                    className="btn btn-sm btn-circle bg-gray-100 hover:bg-gray-200 text-primary border-none shadow-sm flex items-center justify-center"
                                                    title="Edit"
                                                    onClick={() => handleEditPayment(p)}
                                                    style={{ padding: 0 }}
                                                  >
                                                    <PencilIcon className="w-5 h-5" />
                                                  </button>
                                                )}
                                                {/* Delete icon (small) - available for all users */}
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
                                      <tr key={`new-payment-${contactName}`}>
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
                                              // Calculate VAT based on currency and includeVat flag
                                              const currency = newPaymentData.currency || '₪';
                                              const includeVat = newPaymentData.includeVat !== false; // Default to true if not set
                                              if (currency === '₪' && includeVat) {
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
                                          <div className="flex flex-col gap-2 items-center">
                                            <input className="input input-bordered w-full max-w-[200px] text-right" value={newPaymentData.notes} onChange={e => setNewPaymentData((d: any) => ({ ...d, notes: e.target.value }))} placeholder="Notes" />
                                            <div className="flex gap-2 items-center">
                                              <select 
                                                className="select select-bordered select-xs w-24" 
                                                value={newPaymentData.currency || '₪'} 
                                                onChange={e => {
                                                  const selectedCurrency = e.target.value;
                                                  const selectedCurrencyData = availableCurrencies.find(c => c.name === selectedCurrency);
                                                  let vat = 0;
                                                  const includeVat = newPaymentData.includeVat !== false && selectedCurrency === '₪';
                                                  if (selectedCurrency === '₪' && includeVat) {
                                                    vat = Math.round(Number(newPaymentData.value || 0) * 0.18 * 100) / 100;
                                                  }
                                                  setNewPaymentData((d: any) => ({ 
                                                    ...d, 
                                                    currency: selectedCurrency,
                                                    currencyId: selectedCurrencyData?.id || 1,
                                                    includeVat: selectedCurrency === '₪' ? (d.includeVat !== false) : false,
                                                    valueVat: vat
                                                  }));
                                                }}
                                              >
                                                {availableCurrencies.length === 0 ? (
                                                  <>
                                                    <option value="₪">₪</option>
                                                    <option value="€">€</option>
                                                    <option value="$">$</option>
                                                    <option value="£">£</option>
                                                  </>
                                                ) : (
                                                  availableCurrencies.map((curr) => (
                                                    <option key={curr.id} value={curr.name}>{curr.name}</option>
                                                  ))
                                                )}
                                              </select>
                                              <label className="label cursor-pointer gap-1">
                                                <input 
                                                  type="checkbox" 
                                                  className="checkbox checkbox-xs" 
                                                  checked={newPaymentData.includeVat !== false && (newPaymentData.currency || '₪') === '₪'} 
                                                  disabled={(newPaymentData.currency || '₪') !== '₪'}
                                                  onChange={e => {
                                                    const includeVat = e.target.checked;
                                                    let vat = 0;
                                                    if (includeVat && (newPaymentData.currency || '₪') === '₪') {
                                                      vat = Math.round(Number(newPaymentData.value || 0) * 0.18 * 100) / 100;
                                                    }
                                                    setNewPaymentData((d: any) => ({ ...d, includeVat, valueVat: vat }));
                                                  }}
                                                />
                                                <span className="label-text text-xs">VAT</span>
                                              </label>
                                            </div>
                                          </div>
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
                                              // Calculate VAT based on currency and includeVat flag
                                              const currency = newPaymentData.currency || '₪';
                                              const includeVat = newPaymentData.includeVat !== false; // Default to true if not set
                                              if (currency === '₪' && includeVat) {
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
                                            <input type="number" className="input input-bordered input-lg w-28 text-right font-bold rounded-xl border-2 border-blue-300 no-arrows bg-gray-100 text-gray-500 cursor-not-allowed" value={newPaymentData.valueVat || 0} readOnly />
                                          </div>
                                          <div className="flex items-center justify-between py-3">
                                            <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Currency</span>
                                            <select 
                                              className="select select-bordered w-full" 
                                              value={newPaymentData.currency || '₪'} 
                                              onChange={e => {
                                                const selectedCurrency = e.target.value;
                                                const selectedCurrencyData = availableCurrencies.find(c => c.name === selectedCurrency);
                                                let vat = 0;
                                                const includeVat = newPaymentData.includeVat !== false && selectedCurrency === '₪';
                                                if (selectedCurrency === '₪' && includeVat) {
                                                  vat = Math.round(Number(newPaymentData.value || 0) * 0.18 * 100) / 100;
                                                }
                                                setNewPaymentData((d: any) => ({ 
                                                  ...d, 
                                                  currency: selectedCurrency,
                                                  currencyId: selectedCurrencyData?.id || 1,
                                                  includeVat: selectedCurrency === '₪' ? (d.includeVat !== false) : false,
                                                  valueVat: vat
                                                }));
                                              }}
                                            >
                                              {availableCurrencies.length === 0 ? (
                                                <>
                                                  <option value="₪">₪ (ILS)</option>
                                                  <option value="€">€ (EUR)</option>
                                                  <option value="$">$ (USD)</option>
                                                  <option value="£">£ (GBP)</option>
                                                </>
                                              ) : (
                                                availableCurrencies.map((curr) => (
                                                  <option key={curr.id} value={curr.name}>{curr.name} ({curr.iso_code})</option>
                                                ))
                                              )}
                                            </select>
                                          </div>
                                          <div className="flex items-center justify-between py-3">
                                            <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Include VAT</span>
                                            <label className="label cursor-pointer justify-end gap-2">
                                              <input 
                                                type="checkbox" 
                                                className="checkbox checkbox-sm" 
                                                checked={newPaymentData.includeVat !== false && (newPaymentData.currency || '₪') === '₪'} 
                                                disabled={(newPaymentData.currency || '₪') !== '₪'}
                                                onChange={e => {
                                                  const includeVat = e.target.checked;
                                                  let vat = 0;
                                                  if (includeVat && (newPaymentData.currency || '₪') === '₪') {
                                                    vat = Math.round(Number(newPaymentData.value || 0) * 0.18 * 100) / 100;
                                                  }
                                                  setNewPaymentData((d: any) => ({ ...d, includeVat, valueVat: vat }));
                                                }}
                                              />
                                              <span className="label-text text-xs">Include VAT</span>
                                            </label>
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
                              
                              {/* Add new payment and Delete payment plan buttons for this contact (table view) */}
                              {!addingPaymentContact && (
                                <div className="mt-4 flex justify-start gap-2">
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-outline btn-primary text-xs font-medium flex items-center gap-2"
                                    onClick={() => handleAddNewPayment(contactName)}
                                  >
                                    <PlusIcon className="w-4 h-4" />
                                    Add new payment
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-outline btn-error text-xs font-medium flex items-center gap-2"
                                    onClick={() => handleDeletePaymentPlan(contactName)}
                                  >
                                    <TrashIcon className="w-4 h-4" />
                                    Delete payment plan
                                  </button>
                                </div>
                              )}
                              
                              {/* Total and Left to Plan Display - Below Payment Table */}
                              {addingPaymentContact === contactName && (
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
                                        {getCurrencySymbol(financePlan?.payments[0]?.currency || '₪')}{getLeftToPlanAmount(newPaymentData.client || addingPaymentContact || undefined).toLocaleString()}
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
                            <>
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
                                            <span className="text-sm font-bold text-gray-900">{formatDateDDMMYYYY(p.dueDate)}</span>
                                          )}
                                        </div>
                                        <div className="flex items-center justify-between py-3">
                                          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Value</span>
                                          <div className="flex items-center gap-2">
                                            <input
                                              type="number"
                                              className="input input-bordered input-lg w-32 text-right font-bold rounded-xl border-2 border-blue-300 focus:border-blue-500 no-arrows"
                                              value={editPaymentData.value}
                                              onChange={(e) => {
                                                const newValue = Number(e.target.value) || 0;
                                                const currency = editPaymentData.currency || p.currency || '₪';
                                                // Recalculate VAT based on checkbox state: 18% if includeVat is checked, 0 otherwise
                                                const newValueVat = editPaymentIncludeVat ? Math.round(newValue * 0.18 * 100) / 100 : 0;
                                                setEditPaymentData((d: any) => ({ 
                                                  ...d, 
                                                  value: newValue,
                                                  valueVat: newValueVat,
                                                  currency: currency // Explicitly preserve currency
                                                }));
                                              }}
                                            />
                                            <span className='text-gray-500 font-bold'>+</span>
                                            <input
                                              type="number"
                                              className={`input input-bordered input-lg w-20 text-right font-bold rounded-xl border-2 border-blue-300 no-arrows ${editingValueVatId === p.id ? '' : 'bg-gray-100 text-gray-500 cursor-not-allowed'}`}
                                              value={editPaymentData.valueVat || 0}
                                              readOnly={editingValueVatId !== p.id}
                                              onChange={editingValueVatId === p.id ? (e) => setEditPaymentData((d: any) => ({ ...d, valueVat: e.target.value })) : undefined}
                                              title={editingValueVatId !== p.id ? 'Click pencil icon to manually edit VAT' : ''}
                                            />
                                            {editingValueVatId === p.id ? (
                                              <button className="btn btn-xs btn-ghost ml-1" onClick={() => setEditingValueVatId(null)} title="Done editing VAT manually">
                                                <CheckIcon className="w-4 h-4 text-green-600" />
                                              </button>
                                            ) : (
                                              <button className="btn btn-xs btn-ghost ml-1" onClick={() => setEditingValueVatId(p.id)} title="Manually edit VAT (overrides auto-calculation)">
                                                <PencilIcon className="w-4 h-4 text-blue-600" />
                                              </button>
                                            )}
                                            <label className="label cursor-pointer gap-2 ml-2">
                                              <input
                                                type="checkbox"
                                                className="checkbox checkbox-sm checkbox-primary"
                                                checked={editPaymentIncludeVat}
                                                onChange={(e) => {
                                                  const includeVat = e.target.checked;
                                                  setEditPaymentIncludeVat(includeVat);
                                                  const newValueVat = includeVat ? Math.round(Number(editPaymentData.value || 0) * 0.18 * 100) / 100 : 0;
                                                  setEditPaymentData((d: any) => ({ ...d, valueVat: newValueVat }));
                                                }}
                                              />
                                              <span className="label-text text-xs">VAT</span>
                                            </label>
                                          </div>
                                        </div>
                                        <div className="flex items-center justify-between py-3">
                                          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Total</span>
                                          <div className="flex items-center gap-2">
                                            <input
                                              type="number"
                                              className="input input-bordered input-lg w-28 text-right font-bold rounded-xl border-2 border-blue-300 no-arrows bg-gray-100 text-gray-500 cursor-not-allowed"
                                              value={Number(editPaymentData.value || 0) + Number(editPaymentData.valueVat || 0)}
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
                                          <select 
                                            className="select select-bordered w-48"
                                            value={editPaymentData.order || 'Intermediate Payment'}
                                            onChange={e => setEditPaymentData((d: any) => ({ ...d, order: e.target.value }))}
                                          >
                                            <option value="First Payment">First Payment</option>
                                            <option value="Intermediate Payment">Intermediate Payment</option>
                                            <option value="Final Payment">Final Payment</option>
                                            <option value="Single Payment">Single Payment</option>
                                            <option value="Expense (no VAT)">Expense (no VAT)</option>
                                          </select>
                                        </div>
                                        <div className="flex flex-col py-3">
                                          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">Notes</span>
                                          <textarea 
                                            className="textarea textarea-bordered w-full resize-none overflow-hidden" 
                                            value={editPaymentData.notes || ''} 
                                            onChange={(e) => {
                                              const target = e.target as HTMLTextAreaElement;
                                              setEditPaymentData((d: any) => ({ ...d, notes: target.value }));
                                              // Auto-expand textarea
                                              target.style.height = 'auto';
                                              target.style.height = target.scrollHeight + 'px';
                                            }}
                                            onFocus={(e) => {
                                              // Initialize height on focus
                                              const target = e.target as HTMLTextAreaElement;
                                              target.style.height = 'auto';
                                              target.style.height = target.scrollHeight + 'px';
                                            }}
                                            rows={1}
                                            style={{ minHeight: '2.5rem' }}
                                          />
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
                                            {p.duePercent && p.duePercent.includes('%') ? p.duePercent : `${p.duePercent || '0'}%`}
                                          </span>
                                          {/* Actions (right) */}
                                          <div className="flex gap-2 items-center ml-4">
                                            {p.id ? (
                                              <>
                                                {!p.isLegacy && isSuperuser && (
                                                  <button
                                                    className="btn btn-sm btn-circle bg-gray-100 hover:bg-gray-200 text-primary border-none shadow-sm flex items-center justify-center"
                                                    title="Delete"
                                                    onClick={() => handleDeletePayment(p)}
                                                    style={{ padding: 0 }}
                                                  >
                                                    <TrashIcon className="w-5 h-5" />
                                                  </button>
                                                )}
                                                {!p.isLegacy && (!isPaid || isSuperuser || isCollection) && (
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
                                            <span className="text-sm font-bold text-gray-900">{formatDateDDMMYYYY(p.dueDate)}</span>
                                          </div>
                                          <div className="flex items-center justify-between py-3">
                                            <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">VALUE</span>
                                            <span className="text-sm font-bold text-gray-900">
                                              {getCurrencySymbol(p.currency)}
                                              {p.value.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                              + {p.valueVat.toLocaleString(undefined, { minimumFractionDigits: 2 })}
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
                                                        className="btn btn-sm btn-circle bg-blue-100 hover:bg-blue-200 text-blue-700 border-blue-300 border-2 shadow-sm flex items-center justify-center" 
                                                        title="Create Proforma" 
                                                        onClick={e => { e.preventDefault(); navigate(`/proforma-legacy/create/${client.id.toString().replace('legacy_', '')}?ppr_id=${p.id}`); }}
                                                        style={{ padding: 0 }}
                                                      >
                                                        <PlusIcon className="w-5 h-5" />
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
                                                  className="btn btn-sm btn-circle bg-blue-100 hover:bg-blue-200 text-blue-700 border-blue-300 border-2 shadow-sm flex items-center justify-center" 
                                                  title="Create Proforma" 
                                                  onClick={e => { e.preventDefault(); navigate(`/proforma/create/${p.id}`); }}
                                                  style={{ padding: 0 }}
                                                >
                                                  <PlusIcon className="w-5 h-5" />
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
                                          {/* Sent to Finances indicator with revert button */}
                                          {!isPaid && p.ready_to_pay && (
                                            <div className="tooltip tooltip-top z-[9999]" data-tip={p.ready_to_pay_by_display_name ? `Marked by ${p.ready_to_pay_by_display_name} - Click to revert` : 'Ready to pay - Click to revert'}>
                                              <button
                                                className="btn btn-circle btn-md bg-red-100 hover:bg-red-200 text-red-700 border-red-300 border-2 shadow-sm flex items-center justify-center"
                                                title={p.ready_to_pay_by_display_name ? `Marked by ${p.ready_to_pay_by_display_name} - Click to revert` : 'Revert Ready to Pay'}
                                                onClick={() => handleRevertReadyToPay(p)}
                                                style={{ padding: 0 }}
                                              >
                                                <XMarkIcon className="w-5 h-5" />
                                              </button>
                                            </div>
                                          )}
                                          {/* Dollar icon (small) - only for superusers or collection users */}
                                          {!isPaid && (isSuperuser || isCollection) && (
                                            <button
                                              className="btn btn-circle btn-md bg-green-100 hover:bg-green-200 text-green-700 border-green-300 border-2 shadow-sm flex items-center justify-center"
                                              title={p.isLegacy ? "Mark Legacy Payment as Paid" : "Mark as Paid"}
                                              onClick={() => handleOpenPaidDateModal(p.id)}
                                              style={{ padding: 0 }}
                                            >
                                              <CurrencyDollarIcon className="w-5 h-5" />
                                            </button>
                                          )}
                                          {/* Edit icon (small) - only for superusers/collection if paid, available for all if not paid */}
                                          {(!isPaid || isSuperuser || isCollection) && (
                                            <button
                                              className="btn btn-circle btn-md bg-gray-100 hover:bg-gray-200 text-primary border-none shadow-sm flex items-center justify-center"
                                              title="Edit"
                                              onClick={() => handleEditPayment(p)}
                                              style={{ padding: 0 }}
                                            >
                                              <PencilIcon className="w-5 h-5" />
                                            </button>
                                          )}
                                          {/* Delete icon (small) - available for all users */}
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
                            {/* Add new payment and Delete payment plan buttons for this contact (box view) */}
                            {!addingPaymentContact && (
                              <div className="mt-4 flex justify-start gap-2">
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline btn-primary text-xs font-medium flex items-center gap-2"
                                  onClick={() => handleAddNewPayment(contactName)}
                                >
                                  <PlusIcon className="w-4 h-4" />
                                  Add new payment
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline btn-error text-xs font-medium flex items-center gap-2"
                                  onClick={() => handleDeletePaymentPlan(contactName)}
                                >
                                  <TrashIcon className="w-4 h-4" />
                                  Delete payment plan
                                </button>
                              </div>
                            )}
                            </>
                          )}
                        </>
                      )}
                    </div>
                  );
                });
              })()}
              
              {/* Buttons for creating payment plans */}
              <div className="mt-10 flex justify-start gap-4">
                <button
                  type="button"
                  className="btn btn-outline btn-primary text-xs font-medium flex items-center gap-2"
                  onClick={handleOpenStagesDrawer}
                >
                  <ChartPieIcon className="w-4 h-4" />
                  Create New Payment Plan
                </button>
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
                                  {formatDateDDMMYYYY(p.date || p.due_date)}
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
      
      {!hideTimelineHistory && <TimelineHistoryButtons client={client} />}

      {/* Stages Drawer for creating a new finance plan */}
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
                        className="input input-bordered w-full no-arrows"
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
                        {availableCurrencies.length === 0 ? (
                          <>
                            <option value="₪">₪ (ILS)</option>
                            <option value="€">€ (EUR)</option>
                            <option value="$">$ (USD)</option>
                            <option value="£">£ (GBP)</option>
                          </>
                        ) : (
                          availableCurrencies.map((curr) => (
                            <option key={curr.id} value={curr.name}>
                              {curr.name} ({curr.iso_code})
                            </option>
                          ))
                        )}
                      </select>
                    </div>
                  </div>
                  <div className="form-control">
                    <label className="label">
                      <span className="label-text font-medium">Contact</span>
                    </label>
                    <select
                      className="select select-bordered w-full"
                      value={autoPlanData.contact}
                      onChange={(e) => setAutoPlanData(prev => ({ ...prev, contact: e.target.value }))}
                    >
                      <option value="">Select contact...</option>
                      {getAllAvailableContacts().map((contact, idx) => (
                        <option key={idx} value={contact.name}>
                          {contact.name} {contact.isMain && '(Main)'}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="form-control">
                      <label className="label">
                        <span className="label-text font-medium">Number of Payments</span>
                      </label>
                      <select
                        className="select select-bordered w-full"
                        value={isCustomPaymentCount ? 'custom' : autoPlanData.numberOfPayments}
                        onChange={(e) => {
                          if (e.target.value === 'custom') {
                            setIsCustomPaymentCount(true);
                          } else {
                            setIsCustomPaymentCount(false);
                            const count = Number(e.target.value);
                            setAutoPlanData(prev => {
                              let percents: number[];
                              let orders: string[];
                              if (count === 3) {
                                // Special default for 3 payments
                                percents = [50, 25, 25];
                                orders = ['First Payment', 'Intermediate Payment', 'Final Payment'];
                              } else {
                                // Even split that sums to 100
                                const base = Math.floor(100 / count);
                                percents = Array.from({ length: count }, () => base);
                                const remainder = 100 - base * count;
                                for (let i = 0; i < remainder; i++) {
                                  percents[i] += 1;
                                }
                                // Generate default orders
                                orders = Array.from({ length: count }, (_, i) => {
                                  if (i === 0) return 'First Payment';
                                  if (i === count - 1) return 'Final Payment';
                                  return 'Intermediate Payment';
                                });
                              }
                              return {
                                ...prev,
                                numberOfPayments: count,
                                paymentPercents: percents,
                                paymentOrders: orders,
                              };
                            });
                          }
                        }}
                      >
                        <option value={2}>2 Payments</option>
                        <option value={3}>3 Payments</option>
                        <option value={4}>4 Payments</option>
                        <option value={5}>5 Payments</option>
                        <option value="custom">Custom</option>
                      </select>
                      {isCustomPaymentCount && (
                        <div className="mt-2">
                          <input
                            type="number"
                            className="input input-bordered w-full"
                            min={1}
                            max={100}
                            value={customPaymentCount}
                            onChange={(e) => {
                              const count = Number(e.target.value) || 1;
                              setCustomPaymentCount(count);
                              setAutoPlanData(prev => {
                                let percents: number[];
                                let orders: string[];
                                if (count === 1) {
                                  // For single payment, set to 100%
                                  percents = [100];
                                  orders = ['Single Payment'];
                                } else if (count === 3) {
                                  // Special default for 3 payments
                                  percents = [50, 25, 25];
                                  orders = ['First Payment', 'Intermediate Payment', 'Final Payment'];
                                } else {
                                  // Even split that sums to 100
                                  const base = Math.floor(100 / count);
                                  percents = Array.from({ length: count }, () => base);
                                  const remainder = 100 - base * count;
                                  for (let i = 0; i < remainder; i++) {
                                    percents[i] += 1;
                                  }
                                  // Generate default orders
                                  orders = Array.from({ length: count }, (_, i) => {
                                    if (i === 0) return 'First Payment';
                                    if (i === count - 1) return 'Final Payment';
                                    return 'Intermediate Payment';
                                  });
                                }
                                return {
                                  ...prev,
                                  numberOfPayments: count,
                                  paymentPercents: percents,
                                  paymentOrders: orders,
                                };
                              });
                            }}
                            placeholder="Enter number of payments"
                          />
                        </div>
                      )}
                    </div>
                    <div className="form-control">
                      <label className="label">
                        <span className="label-text font-medium">Payment Percentages & Amounts</span>
                      </label>
                      <div className="space-y-2">
                        {Array.from({ length: autoPlanData.numberOfPayments }).map((_, index) => {
                          const isFirst = index === 0;
                          const isLast = index === autoPlanData.numberOfPayments - 1;
                          const defaultLabel =
                            isFirst ? 'First Payment' : isLast ? 'Final Payment' : 'Intermediate Payment';
                          const currentOrder = autoPlanData.paymentOrders?.[index] || defaultLabel;
                          return (
                          <div key={index} className="flex items-center gap-2">
                            <select
                              className="select select-bordered w-40 text-sm"
                              value={currentOrder}
                              onChange={(e) => {
                                setAutoPlanData(prev => {
                                  const next = [...(prev.paymentOrders || [])];
                                  // Ensure array length
                                  while (next.length < prev.numberOfPayments) {
                                    const idx = next.length;
                                    const defaultOrder = idx === 0 ? 'First Payment' : idx === prev.numberOfPayments - 1 ? 'Final Payment' : 'Intermediate Payment';
                                    next.push(defaultOrder);
                                  }
                                  next[index] = e.target.value;
                                  return {
                                    ...prev,
                                    paymentOrders: next,
                                  };
                                });
                              }}
                            >
                              <option value="First Payment">First Payment</option>
                              <option value="Intermediate Payment">Intermediate Payment</option>
                              <option value="Final Payment">Final Payment</option>
                              <option value="Single Payment">Single Payment</option>
                              <option value="Expense (no VAT)">Expense (no VAT)</option>
                            </select>
                            <input
                              type="number"
                              className="input input-bordered w-24 no-arrows"
                              min={0}
                              max={100}
                              value={autoPlanData.paymentPercents[index] ?? 0}
                              onChange={(e) => {
                                const percentValue = Number(e.target.value || 0);
                                const totalAmount = Number(autoPlanData.totalAmount || 0);
                                setAutoPlanData(prev => {
                                  const next = [...(prev.paymentPercents || [])];
                                  // Ensure array length
                                  while (next.length < prev.numberOfPayments) next.push(0);
                                  next[index] = percentValue;
                                  return {
                                    ...prev,
                                    paymentPercents: next,
                                  };
                                });
                              }}
                            />
                            <span className="text-sm">%</span>
                            <input
                              type="number"
                              className="input input-bordered w-32 no-arrows"
                              min={0}
                              step="0.01"
                              value={(() => {
                                const totalAmount = Number(autoPlanData.totalAmount || 0);
                                const percent = autoPlanData.paymentPercents[index] ?? 0;
                                return totalAmount > 0 ? ((totalAmount * percent) / 100).toFixed(2) : '0.00';
                              })()}
                              onChange={(e) => {
                                const amountValue = Number(e.target.value || 0);
                                const totalAmount = Number(autoPlanData.totalAmount || 0);
                                if (totalAmount > 0) {
                                  const newPercent = (amountValue / totalAmount) * 100;
                                  setAutoPlanData(prev => {
                                    const next = [...(prev.paymentPercents || [])];
                                    // Ensure array length
                                    while (next.length < prev.numberOfPayments) next.push(0);
                                    next[index] = Math.round(newPercent * 100) / 100; // Round to 2 decimal places
                                    return {
                                      ...prev,
                                      paymentPercents: next,
                                    };
                                  });
                                }
                              }}
                              placeholder="0.00"
                            />
                            <span className="text-sm">{autoPlanData.currency || '₪'}</span>
                          </div>
                        )})}
                        <div className="text-xs text-gray-500">
                          Sum must be exactly 100%. If not, you'll see an error when creating the plan.
                        </div>
                      </div>
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
                      <span className="label-text font-medium">Include VAT (18%)</span>
                    </label>
                  </div>
                  <button
                    className="btn btn-primary w-full"
                    onClick={handleCreateAutoPlan}
                    disabled={isSavingPaymentRow || !autoPlanData.totalAmount || !autoPlanData.contact}
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
            </div>
          </div>
        </div>, document.body)
      }

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
                  <span className="font-bold text-lg">{(percentageType === 'total' ? getTotalAmount() : getLeftToPlanAmount(newPaymentData.client || addingPaymentContact || undefined)).toLocaleString()}</span>
                </div>
                {percentageValue > 0 && (
                  <div className="text-sm text-gray-600 mt-1">
                    <span className="font-medium">Calculated amount:</span> {getCurrencySymbol(financePlan?.payments[0]?.currency || '₪')}
                    <span className="font-bold text-lg text-green-600">
                      {Math.round(((percentageType === 'total' ? getTotalAmount() : getLeftToPlanAmount(newPaymentData.client || addingPaymentContact || undefined)) * percentageValue) / 100).toLocaleString()}
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

      {/* Paid Date Modal */}
      {showPaidDateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-bold mb-4">Select Paid Date</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Paid Date
                </label>
                <input
                  type="date"
                  className="input input-bordered w-full"
                  value={paidDate}
                  onChange={(e) => setPaidDate(e.target.value)}
                  max={new Date().toISOString().split('T')[0]}
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    setShowPaidDateModal(false);
                    setSelectedPaymentForPaid(null);
                    setPaidDate('');
                  }}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleConfirmMarkAsPaid}
                  disabled={!paidDate}
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </>
  );
};

export default FinancesTab; 