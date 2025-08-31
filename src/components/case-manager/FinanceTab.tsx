import React, { useState, useEffect } from 'react';
import { 
  ChartBarIcon,
  CurrencyDollarIcon,
  PencilIcon,
  TrashIcon,
  XMarkIcon,
  CheckIcon,
  PlusIcon,
  DocumentTextIcon,
  DocumentArrowDownIcon
} from '@heroicons/react/24/outline';
import { supabase } from '../../lib/supabase';
import { toast } from 'react-hot-toast';
import { generateProformaName } from '../../lib/proforma';

interface HandlerLead {
  id: string;
  lead_number: string;
  name: string;
  email?: string;
  phone?: string;
  category?: string;
  stage: string;
  handler_stage?: string;
  created_at: string;
  balance?: number;
  balance_currency?: string;
  onedrive_folder_link?: string;
  expert?: string;
  handler?: string;
  closer?: string;
  scheduler?: string;
  manager?: string;
}

interface HandlerTabProps {
  leads: HandlerLead[];
  uploadFiles: (lead: HandlerLead, files: File[]) => Promise<void>;
  uploadingLeadId: string | null;
  uploadedFiles: { [leadId: string]: any[] };
  isUploading: boolean;
  handleFileInput: (lead: HandlerLead, e: React.ChangeEvent<HTMLInputElement>) => void;
  refreshLeads: () => Promise<void>;
  refreshDashboardData: () => Promise<void>;
}

const FinanceTab: React.FC<HandlerTabProps> = ({ leads, refreshDashboardData }) => {
  const [financePlan, setFinancePlan] = useState<any>(null);
  const [contracts, setContracts] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'table' | 'boxes'>('boxes');
  const [collapsedContacts, setCollapsedContacts] = useState<{ [key: string]: boolean }>({});
  const [editingPaymentId, setEditingPaymentId] = useState<string | number | null>(null);
  const [editPaymentData, setEditPaymentData] = useState<any>({});
  const [isSavingPaymentRow, setIsSavingPaymentRow] = useState(false);
  const [paidMap, setPaidMap] = useState<{ [id: string]: boolean }>({});
  const [editingValueVatId, setEditingValueVatId] = useState<string | number | null>(null);
  const [addingPaymentContact, setAddingPaymentContact] = useState<string | null>(null);
  const [newPaymentData, setNewPaymentData] = useState<any>({});
  const [showStagesDrawer, setShowStagesDrawer] = useState(false);
  const [autoPlanData, setAutoPlanData] = useState({
    totalAmount: '',
    currency: '₪',
    numberOfPayments: 3,
    firstPaymentPercent: 50,
    includeVat: true
  });
  const [creatingProforma, setCreatingProforma] = useState<string | null>(null);

  // Get the current case from the leads array (assuming we're in a case context)
  const currentCase = leads.length > 0 ? leads[0] : null;

  // Fetch finance data for current case
  const fetchFinanceData = async (leadId: string) => {
    setLoading(true);
    try {
      // Fetch payment plans
      const { data: paymentPlans, error: paymentError } = await supabase
        .from('payment_plans')
        .select('*')
        .eq('lead_id', leadId)
        .order('due_date', { ascending: true });

      if (paymentError) throw paymentError;

      if (paymentPlans && paymentPlans.length > 0) {
        const total = paymentPlans.reduce((sum, plan) => sum + Number(plan.value) + Number(plan.value_vat), 0);
        const vat = paymentPlans.reduce((sum, plan) => sum + Number(plan.value_vat), 0);
        
        const payments = paymentPlans.map(plan => {
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
          };
        });

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

        // Initialize collapse state for contacts
        if (Object.keys(collapsedContacts).length === 0) {
          const contacts = [...new Set(payments.map(p => p.client))];
          const initialCollapsedState = contacts.reduce((acc, contactName) => {
            acc[contactName] = true; // true means collapsed
            return acc;
          }, {} as { [key: string]: boolean });
          setCollapsedContacts(initialCollapsedState);
        }
      } else {
        setFinancePlan(null);
        setPaidMap({});
      }

      // Fetch contracts
      const { data: contractData, error: contractError } = await supabase
        .from('contracts')
        .select(`
          *,
          lead:leads(name, lead_number)
        `)
        .eq('lead_id', leadId);

      if (!contractError && contractData) {
        setContracts(contractData);
      }

      // Fetch contacts
      const { data: leadData, error: leadError } = await supabase
        .from('leads')
        .select('additional_contacts')
        .eq('id', leadId)
        .single();
      
      if (!leadError && leadData?.additional_contacts) {
        const contactsWithIds = leadData.additional_contacts.map((contact: any, index: number) => ({
          id: index + 1,
          ...contact
        }));
        setContacts(contactsWithIds);
      } else {
        setContacts([]);
      }

    } catch (error) {
      console.error('Error fetching finance data:', error);
      toast.error('Failed to fetch finance data');
    } finally {
      setLoading(false);
    }
  };

  // Auto-load finance data when component mounts or current case changes
  useEffect(() => {
    if (currentCase) {
      fetchFinanceData(currentCase.id);
    }
  }, [currentCase]);

  const getCurrencySymbol = (currency: string | undefined) => {
    if (!currency) return '₪';
    // Since we're now storing currency symbols directly, just return the currency
    return currency;
  };

  // Helper function to get current user's full name from Supabase users table
  const getCurrentUserName = async (): Promise<string> => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user?.email) {
        return 'System User';
      }
      
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
          return `${userData.first_name} ${userData.last_name}`;
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

  // Handler to mark a payment as paid
  const handleMarkAsPaid = async (id: string | number) => {
    setPaidMap((prev: { [id: string]: boolean }) => ({ ...prev, [id]: true }));
    
    setFinancePlan((prev: any) => {
      if (!prev) return prev;
      return {
        ...prev,
        payments: prev.payments.map((payment: any) => 
          payment.id === id 
            ? { ...payment, paid: true, paid_at: new Date().toISOString() }
            : payment
        )
      };
    });
    
    try {
      const currentUserName = await getCurrentUserName();
      
      const { error: historyError } = await supabase
        .from('finance_changes_history')
        .insert({
          lead_id: currentCase?.id,
          change_type: 'payment_marked_paid',
          table_name: 'payment_plans',
          record_id: id,
          old_values: { paid: false },
          new_values: { paid: true, paid_at: new Date().toISOString(), paid_by: currentUserName },
          changed_by: currentUserName,
          notes: `Payment marked as paid by ${currentUserName}`
        });
      
      if (historyError) console.error('Error logging payment marked as paid:', historyError);
      
      const { error } = await supabase
        .from('payment_plans')
        .update({
          paid: true,
          paid_at: new Date().toISOString(),
          paid_by: currentUserName,
        })
        .eq('id', id);
        
      if (!error) {
        toast.success('Payment marked as paid!');
        // Refresh dashboard data to update the total balance
        if (refreshDashboardData) {
          await refreshDashboardData();
        }
      } else {
        setPaidMap((prev: { [id: string]: boolean }) => ({ ...prev, [id]: false }));
        setFinancePlan((prev: any) => {
          if (!prev) return prev;
          return {
            ...prev,
            payments: prev.payments.map((payment: any) => 
              payment.id === id 
                ? { ...payment, paid: false, paid_at: undefined }
                : payment
            )
          };
        });
        toast.error('Failed to mark as paid.');
      }
    } catch (error) {
      console.error('Error marking payment as paid:', error);
      setPaidMap((prev: { [id: string]: boolean }) => ({ ...prev, [id]: false }));
      setFinancePlan((prev: any) => {
        if (!prev) return prev;
        return {
          ...prev,
          payments: prev.payments.map((payment: any) => 
            payment.id === id 
              ? { ...payment, paid: false, paid_at: undefined }
              : payment
          )
        };
      });
      toast.error('Failed to mark as paid.');
    }
  };

  const handleEditPayment = (row: any) => {
    setEditingPaymentId(row.id);
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
      
      const { error } = await supabase
        .from('payment_plans')
        .update({
          due_percent: editPaymentData.duePercent,
          due_date: editPaymentData.dueDate,
          value: editPaymentData.value,
          value_vat: editPaymentData.valueVat,
          client_name: editPaymentData.client,
          payment_order: editPaymentData.order,
          notes: editPaymentData.notes,
        })
        .eq('id', editPaymentData.id);
      if (error) throw error;
      
      toast.success('Payment updated successfully!');
      setEditingPaymentId(null);
      setEditPaymentData({});
      await fetchFinanceData(currentCase!.id);
    } catch (error) {
      console.error('Error updating payment:', error);
      toast.error('Failed to update payment row.');
    } finally {
      setIsSavingPaymentRow(false);
    }
  };

  const handleDeletePayment = async (row: any) => {
    if (!window.confirm('Are you sure you want to delete this payment row?')) return;
    try {
      const currentUserName = await getCurrentUserName();
      
      const { error: historyError } = await supabase
        .from('payment_plan_changes')
        .insert({
          payment_plan_id: null,
          lead_id: currentCase?.id,
          field_name: 'payment_deleted',
          old_value: JSON.stringify({
            id: row.id,
            due_percent: row.duePercent,
            due_date: row.dueDate,
            value: row.value,
            value_vat: row.valueVat,
            client: row.client,
            payment_order: row.order,
            notes: row.notes
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
      
      const { error } = await supabase
        .from('payment_plans')
        .delete()
        .eq('id', row.id);
      if (error) throw error;
      
      toast.success('Payment row deleted!');
      await fetchFinanceData(currentCase!.id);
    } catch (error) {
      console.error('Error deleting payment:', error);
      toast.error('Failed to delete payment row.');
    }
  };

  const handleAddNewPayment = (contactName: string) => {
    setAddingPaymentContact(contactName);
    setNewPaymentData({
      dueDate: '',
      value: '',
      client: contactName,
      notes: '',
      currency: '₪',
      paid: false,
      paid_at: null,
      paid_by: null,
    });
  };

  const handleCancelNewPayment = () => {
    setAddingPaymentContact(null);
    setNewPaymentData({});
  };

  const handleSaveNewPayment = async () => {
    if (!newPaymentData.dueDate || !newPaymentData.value || !newPaymentData.client) {
      toast.error('Please fill in all required fields');
      return;
    }

    setIsSavingPaymentRow(true);
    try {
      const currentUserName = await getCurrentUserName();
      
      const paymentData = {
        lead_id: currentCase?.id,
        due_percent: Number(100),
        percent: Number(100),
        due_date: newPaymentData.dueDate,
        value: Number(newPaymentData.value),
        value_vat: Number(newPaymentData.valueVat || 0),
        client_name: newPaymentData.client,
        payment_order: 'One-time Payment',
        currency: newPaymentData.currency || '₪',
        created_by: currentUserName,
      };
      
      const { data, error } = await supabase
        .from('payment_plans')
        .insert(paymentData)
        .select();
      if (error) throw error;
      
      toast.success('Payment plan created successfully!');
      handleCancelNewPayment();
      await fetchFinanceData(currentCase!.id);
    } catch (error) {
      console.error('Error creating payment plan:', error);
      toast.error('Failed to create payment plan');
    } finally {
      setIsSavingPaymentRow(false);
    }
  };

  // Function to create proforma for a payment plan
  const handleCreateProforma = async (payment: any) => {
    if (!currentCase) {
      toast.error('No case selected');
      return;
    }

    setCreatingProforma(payment.id);
    try {
      const currentUserName = await getCurrentUserName();
      
      // Generate proforma content as JSON
      const proformaContent = await generateProformaContent(payment, currentUserName);
      
      // Update payment plan with proforma content directly
      const { error: updateError } = await supabase
        .from('payment_plans')
        .update({
          proforma: proformaContent
        })
        .eq('id', payment.id);

      if (updateError) throw updateError;

      toast.success('Proforma created successfully!');
      await fetchFinanceData(currentCase.id);
    } catch (error) {
      console.error('Error creating proforma:', error);
      toast.error('Failed to create proforma');
    } finally {
      setCreatingProforma(null);
    }
  };

  // Function to generate proforma content
  const generateProformaContent = async (payment: any, createdBy: string) => {
    const currentDate = new Date().toLocaleDateString();
    const dueDate = payment.dueDate ? new Date(payment.dueDate).toLocaleDateString() : 'TBD';
    const totalAmount = payment.value + payment.valueVat;
    
    // Generate proper proforma name
    const proformaName = await generateProformaName();
    
    // Create proforma data structure matching the existing implementation
    const proformaData = {
      client: payment.client,
      clientId: currentCase?.id,
      proformaName: proformaName,
      payment: payment.id,
      base: payment.value,
      vat: payment.valueVat,
      language: 'en',
      rows: [
        {
          description: `Payment for ${payment.duePercent}% of total amount`,
          qty: 1,
          rate: payment.value,
          total: payment.value
        }
      ],
      total: payment.value,
      totalWithVat: totalAmount,
      addVat: true,
      currency: payment.currency || '₪',
      bankAccount: '',
      notes: `Payment plan ID: ${payment.id}`,
      createdAt: new Date().toISOString(),
      createdBy: createdBy,
    };
    
    return JSON.stringify(proformaData);
  };

  return (
    <div className="w-full px-2 sm:px-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6 sm:mb-8">
        <div>
          <h3 className="text-lg sm:text-xl font-bold text-gray-900">Finance Management</h3>
          <p className="text-sm sm:text-base text-gray-600">Manage finance plans and payment tracking</p>
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="text-center py-16 px-8">
          <div className="loading loading-spinner loading-lg text-purple-600"></div>
          <p className="text-gray-600 mt-4">Loading finance data...</p>
        </div>
      )}

      {currentCase && !loading && (
        <div className="space-y-6">
          {/* Contract Information */}
          {contracts.length > 0 && (
            <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-3 sm:p-8 mb-4 sm:mb-8">
              <h4 className="text-base sm:text-lg font-bold text-gray-900 mb-3 sm:mb-4 flex items-center gap-2">
                <DocumentTextIcon className="w-4 h-4 sm:w-5 sm:h-5 text-purple-600" />
                Contract Information
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                {contracts.map((contract) => (
                  <div key={contract.id} className="bg-white rounded-lg p-3 sm:p-4 border border-gray-200 shadow-sm hover:shadow-lg hover:shadow-purple-100 hover:border-purple-200 transition-all duration-300 cursor-pointer">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs sm:text-sm font-semibold text-gray-700">
                        {contract.contract_type || 'Contract'}
                      </span>
                      <span className="badge badge-xs sm:badge-sm bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none shadow-sm">
                        {contract.status || 'Active'}
                      </span>
                    </div>
                    {contract.total_amount && (
                      <div className="text-base sm:text-lg font-bold text-purple-700">
                        {getCurrencySymbol(contract.currency)}{contract.total_amount.toLocaleString()}
                      </div>
                    )}
                    {contract.signed_at && (
                      <div className="text-xs sm:text-sm text-gray-600 mt-1">
                        Signed: {new Date(contract.signed_at).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Finance Plan */}
          {financePlan ? (
            <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-3 sm:p-8 mb-4 sm:mb-8">
              <div className="flex items-center justify-between mb-3 sm:mb-4">
                <h4 className="text-base sm:text-lg font-bold text-gray-900 flex items-center gap-2">
                  <ChartBarIcon className="w-4 h-4 sm:w-5 sm:h-5 text-gray-600" />
                  Finance Plan
                </h4>
                <button
                  className="btn btn-xs sm:btn-sm btn-outline text-xs sm:text-sm"
                  onClick={() => setViewMode(viewMode === 'table' ? 'boxes' : 'table')}
                >
                  {viewMode === 'table' ? 'Box View' : 'Table View'}
                </button>
              </div>

              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4 mb-6 sm:mb-8">
                <div className="bg-white rounded-lg p-3 sm:p-4 border border-gray-200 shadow-sm hover:shadow-lg hover:shadow-purple-100 transition-all duration-300 cursor-pointer">
                  <div className="text-xs sm:text-sm text-gray-600">Total Amount</div>
                  <div className="text-lg sm:text-xl font-bold text-gray-900">
                    {getCurrencySymbol(financePlan.payments[0]?.currency)}{Math.round((financePlan.total - financePlan.vat) * 100) / 100}
                  </div>
                </div>
                <div className="bg-white rounded-lg p-3 sm:p-4 border border-gray-200 shadow-sm hover:shadow-lg hover:shadow-purple-100 transition-all duration-300 cursor-pointer">
                  <div className="text-xs sm:text-sm text-gray-600">Total</div>
                  <div className="text-lg sm:text-xl font-bold text-gray-900">
                    {getCurrencySymbol(financePlan.payments[0]?.currency)}{Math.round(financePlan.total * 100) / 100}
                  </div>
                </div>
                <div className="bg-white rounded-lg p-3 sm:p-4 border border-gray-200 shadow-sm hover:shadow-lg hover:shadow-purple-100 transition-all duration-300 cursor-pointer">
                  <div className="text-xs sm:text-sm text-gray-600">Payments</div>
                  <div className="text-lg sm:text-xl font-bold text-gray-900">
                    {financePlan.payments.length}
                  </div>
                </div>
              </div>

              {/* Group payments by contact */}
              {(() => {
                const paymentsByContact = financePlan.payments.reduce((acc: { [key: string]: any[] }, payment: any) => {
                  const contactName = payment.client;
                  if (!acc[contactName]) {
                    acc[contactName] = [];
                  }
                  acc[contactName].push(payment);
                  return acc;
                }, {});

                return Object.entries(paymentsByContact).map(([contactName, payments]) => (
                  <div key={contactName} className="mb-8 sm:mb-10">
                    {/* Contact Header */}
                    <div 
                      className="flex items-center gap-2 sm:gap-3 bg-white rounded-lg p-3 sm:p-4 border border-purple-200 cursor-pointer hover:shadow-lg hover:shadow-purple-100 hover:border-purple-300 transition-all duration-300"
                      onClick={() => setCollapsedContacts(prev => ({ ...prev, [contactName]: !prev[contactName] }))}
                    >
                      <div className="w-8 h-8 sm:w-10 sm:h-10 bg-gradient-to-br from-purple-500 to-blue-600 rounded-full flex items-center justify-center">
                        <span className="text-white font-bold text-xs sm:text-sm">
                          {contactName.split(' ').map(n => n[0]).join('').toUpperCase()}
                        </span>
                      </div>
                      <div className="flex-1">
                        <h5 className="font-semibold text-gray-900 text-sm sm:text-base">{contactName}</h5>
                        <p className="text-xs sm:text-sm text-gray-600">{(payments as any[]).length} payment(s)</p>
                      </div>
                      <div className="text-right mr-2 sm:mr-4">
                        <div className="text-base sm:text-lg font-bold text-gray-900">
                          {getCurrencySymbol((payments as any[])[0]?.currency)}{(payments as any[]).reduce((sum: number, p: any) => sum + p.value + p.valueVat, 0).toLocaleString()}
                        </div>
                        <div className="text-xs text-gray-500">Total for {contactName}</div>
                      </div>
                      <div className="flex items-center justify-center w-6 h-6 sm:w-8 sm:h-8">
                        {collapsedContacts[contactName] ? (
                          <svg className="w-4 h-4 sm:w-5 sm:h-5 text-purple-600 transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4 sm:w-5 sm:h-5 text-purple-600 transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                          </svg>
                        )}
                      </div>
                    </div>

                    {/* Table or Box view for this contact */}
                    {!collapsedContacts[contactName] && (
                      <div className="mt-4 sm:mt-6">
                        {viewMode === 'table' ? (
                          <div className="bg-white rounded-xl p-2 sm:p-4 border border-gray-200 overflow-x-auto">
                            <table className="min-w-full rounded-xl overflow-hidden">
                              <thead className="bg-base-200 sticky top-0 z-10">
                                <tr>
                                  <th className="text-center px-2 sm:px-4 py-2 sm:py-3 font-bold text-sm sm:text-lg">%</th>
                                  <th className="text-center px-2 sm:px-4 py-2 sm:py-3 font-semibold text-xs sm:text-sm">Due Date</th>
                                  <th className="text-center px-2 sm:px-4 py-2 sm:py-3 font-semibold text-xs sm:text-sm">Value + VAT</th>
                                  <th className="text-center px-2 sm:px-4 py-2 sm:py-3 font-semibold text-xs sm:text-sm">Total</th>
                                  <th className="text-center px-2 sm:px-4 py-2 sm:py-3 font-semibold text-xs sm:text-sm">Status</th>
                                  <th className="text-center px-2 sm:px-4 py-2 sm:py-3 font-semibold text-xs sm:text-sm">Actions</th>
                                </tr>
                              </thead>
                                                              <tbody>
                                  {(payments as any[]).map((p) => (
                                    <tr key={p.id} className="border-b border-gray-100 hover:bg-gray-50">
                                      <td className="font-bold text-sm sm:text-lg align-middle text-center px-2 sm:px-4 py-2 sm:py-3 whitespace-nowrap">
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
                                        <span className="text-lg font-bold">{p.duePercent}%</span>
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
                                        <span className="text-sm font-medium">
                                          {p.dueDate ? new Date(p.dueDate).toLocaleDateString() : 'No due date'}
                                        </span>
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
                                    <td className="align-middle text-center px-2 sm:px-4 py-2 sm:py-3 whitespace-nowrap">
                                      <div className="flex items-center justify-center gap-2">
                                        {p.paid ? (
                                          <span className="badge badge-sm sm:badge-md bg-gradient-to-tr from-green-500 to-green-600 text-white border-none shadow-sm">
                                            Paid
                                          </span>
                                        ) : (
                                          <span className="badge badge-sm sm:badge-md bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none shadow-sm">
                                            Pending
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                    <td className="flex gap-1 sm:gap-2 justify-end align-middle min-w-[80px] px-2 sm:px-4 py-2 sm:py-3">
                                      {p.id ? (
                                        editingPaymentId === p.id ? (
                                          <>
                                            <button
                                              className="btn btn-xs btn-success bg-gradient-to-tr from-green-500 to-green-600 text-white border-none shadow-sm"
                                              onClick={handleSaveEditPayment}
                                              disabled={isSavingPaymentRow}
                                            >
                                              <CheckIcon className="w-3 h-3 sm:w-4 sm:h-4" />
                                            </button>
                                            <button
                                              className="btn btn-xs btn-ghost text-red-500 hover:bg-red-50 border-none"
                                              onClick={handleCancelEditPayment}
                                              title="Cancel"
                                            >
                                              <XMarkIcon className="w-3 h-3 sm:w-4 sm:h-4" />
                                            </button>
                                          </>
                                        ) : (
                                          <>
                                            {!p.paid && (
                                              <button
                                                className="btn btn-xs btn-circle bg-gradient-to-tr from-green-500 to-green-600 text-white border-none shadow-sm flex items-center justify-center hover:from-green-600 hover:to-green-700 transition-all duration-200"
                                                title="Mark as Paid"
                                                onClick={() => handleMarkAsPaid(p.id)}
                                                style={{ padding: 0 }}
                                              >
                                                <CurrencyDollarIcon className="w-3 h-3 sm:w-4 sm:h-4" />
                                              </button>
                                            )}
                                            {!p.proforma && (
                                              <button
                                                className="btn btn-xs btn-circle bg-gradient-to-tr from-blue-500 to-blue-600 text-white border-none shadow-sm flex items-center justify-center hover:from-blue-600 hover:to-blue-700 transition-all duration-200"
                                                title="Create Proforma"
                                                onClick={() => handleCreateProforma(p)}
                                                disabled={creatingProforma === p.id}
                                                style={{ padding: 0 }}
                                              >
                                                {creatingProforma === p.id ? (
                                                  <div className="loading loading-spinner loading-xs"></div>
                                                ) : (
                                                  <DocumentArrowDownIcon className="w-3 h-3 sm:w-4 sm:h-4" />
                                                )}
                                              </button>
                                            )}
                                            <button
                                              className="btn btn-xs btn-circle bg-gradient-to-tr from-purple-500 to-purple-600 text-white border-none shadow-sm flex items-center justify-center hover:from-purple-600 hover:to-purple-700 transition-all duration-200"
                                              title="Edit"
                                              onClick={() => handleEditPayment(p)}
                                              style={{ padding: 0 }}
                                            >
                                              <PencilIcon className="w-3 h-3 sm:w-4 sm:h-4" />
                                            </button>
                                            <button
                                              className="btn btn-xs btn-circle bg-gradient-to-tr from-purple-500 to-purple-600 text-white border-none shadow-sm flex items-center justify-center hover:from-purple-600 hover:to-purple-700 transition-all duration-200"
                                              title="Delete"
                                              onClick={() => handleDeletePayment(p)}
                                              style={{ padding: 0 }}
                                            >
                                              <TrashIcon className="w-3 h-3 sm:w-4 sm:h-4" />
                                            </button>
                                          </>
                                        )
                                      ) : (
                                        <button
                                          className="btn btn-xs btn-primary bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none shadow-sm"
                                          onClick={handleSaveNewPayment}
                                          disabled={isSavingPaymentRow}
                                        >
                                          Save
                                        </button>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                            {(payments as any[]).map((p) => (
                              <div key={p.id} className="card bg-base-100 shadow-lg border border-gray-200 hover:shadow-xl hover:shadow-purple-100 hover:border-purple-200 transition-all duration-300 cursor-pointer">
                                <div className="card-body p-3 sm:p-4">
                                  <div className="flex items-center justify-between mb-3">
                                    <span className="text-base sm:text-lg font-bold text-purple-600">{p.duePercent}%</span>
                                    {p.paid ? (
                                      <span className="badge badge-sm sm:badge-md bg-gradient-to-tr from-green-500 to-green-600 text-white border-none shadow-sm">
                                        Paid
                                      </span>
                                    ) : (
                                      <span className="badge badge-sm sm:badge-md bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none shadow-sm">
                                        Pending
                                      </span>
                                    )}
                                  </div>
                                  
                                  <div className="space-y-0">
                                    <div className="flex items-center justify-between py-2 border-b border-gray-100">
                                      <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Due Date</span>
                                      <span className="text-xs sm:text-sm font-medium">
                                        {p.dueDate ? new Date(p.dueDate).toLocaleDateString() : 'No due date'}
                                      </span>
                                    </div>
                                    <div className="flex items-center justify-between py-3 border-b border-gray-100">
                                      <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Value</span>
                                      <span className="text-xs sm:text-sm font-bold text-gray-900">
                                        {getCurrencySymbol(p.currency)}{p.value.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                        + {p.valueVat.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                      </span>
                                    </div>
                                    <div className="flex items-center justify-between py-3 border-b border-gray-100">
                                      <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Total</span>
                                      <span className="text-xs sm:text-sm font-bold text-gray-900">{getCurrencySymbol(p.currency)}{(p.value + p.valueVat).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                    </div>
                                    <div className="flex items-center justify-between py-3">
                                      <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Client</span>
                                      <span className="text-xs sm:text-sm font-medium text-gray-900">{p.client}</span>
                                    </div>
                                  </div>
                                  
                                  <div className="flex gap-1 sm:gap-2 mt-3 sm:mt-4 pt-3 border-t border-gray-100">
                                    {!p.paid && (
                                      <button
                                        className="btn btn-xs bg-gradient-to-tr from-green-500 to-green-600 text-white border-none shadow-sm text-xs hover:from-green-600 hover:to-green-700 transition-all duration-200"
                                        onClick={() => handleMarkAsPaid(p.id)}
                                      >
                                        Mark Paid
                                      </button>
                                    )}
                                    {!p.proforma && (
                                      <button
                                        className="btn btn-xs bg-gradient-to-tr from-blue-500 to-blue-600 text-white border-none shadow-sm text-xs hover:from-blue-600 hover:to-blue-700 transition-all duration-200"
                                        onClick={() => handleCreateProforma(p)}
                                        disabled={creatingProforma === p.id}
                                      >
                                        {creatingProforma === p.id ? (
                                          <>
                                            <div className="loading loading-spinner loading-xs"></div>
                                            Creating...
                                          </>
                                        ) : (
                                          <>
                                            <DocumentArrowDownIcon className="w-3 h-3 sm:w-4 sm:h-4" />
                                            Proforma
                                          </>
                                        )}
                                      </button>
                                    )}
                                    <button
                                      className="btn btn-xs bg-gradient-to-tr from-purple-500 to-purple-600 text-white border-none shadow-sm text-xs hover:from-purple-600 hover:to-purple-700 transition-all duration-200"
                                      onClick={() => handleEditPayment(p)}
                                    >
                                      Edit
                                    </button>
                                    <button
                                      className="btn btn-xs bg-gradient-to-tr from-purple-500 to-purple-600 text-white border-none shadow-sm text-xs hover:from-purple-600 hover:to-purple-700 transition-all duration-200"
                                      onClick={() => handleDeletePayment(p)}
                                    >
                                      Delete
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ));
              })()}
            </div>
          ) : (
            <div className="text-center py-16 px-8">
              <ChartBarIcon className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <h4 className="text-lg font-bold text-gray-800 mb-2">No Finance Plan</h4>
              <p className="text-gray-600">No payment plans have been created for this case yet.</p>
            </div>
          )}
        </div>
      )}

      {!currentCase && !loading && (
        <div className="text-center py-16 px-8">
          <ChartBarIcon className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h4 className="text-lg font-bold text-gray-800 mb-2">Select a Case</h4>
          <p className="text-gray-600">Please select a case to view its finance information.</p>
        </div>
      )}
    </div>
  );
};

export default FinanceTab; 