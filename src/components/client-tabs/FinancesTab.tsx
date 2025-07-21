import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import TimelineHistoryButtons from './TimelineHistoryButtons';
import { BanknotesIcon, PencilIcon, TrashIcon, XMarkIcon, Squares2X2Icon, Bars3Icon, CurrencyDollarIcon, UserIcon, MinusIcon, CheckIcon } from '@heroicons/react/24/outline';
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
}

interface FinancePlan {
  total: number;
  vat: number;
  payments: PaymentPlan[];
}

interface FinancesTabProps extends ClientTabProps {
  onPaymentMarkedPaid?: (paymentId: string | number) => void;
}

const FinancesTab: React.FC<FinancesTabProps> = ({ client, onClientUpdate, onPaymentMarkedPaid }) => {
  const navigate = useNavigate();
  const { instance } = useMsal();
  const [financePlan, setFinancePlan] = useState<FinancePlan | null>(null);
  const [editingPaymentId, setEditingPaymentId] = useState<string | number | null>(null);
  const [editPaymentData, setEditPaymentData] = useState<any>({});
  const [isSavingPaymentRow, setIsSavingPaymentRow] = useState(false);
  const [viewMode, setViewMode] = useState<'table' | 'boxes'>('boxes');
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

  // Handler to mark a payment as paid
  const handleMarkAsPaid = async (id: string | number) => {
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
    
    let paidBy = 'Unknown';
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user && user.email) {
        const { data: userData, error } = await supabase
          .from('users')
          .select('full_name')
          .eq('email', user.email)
          .single();
        if (!error && userData?.full_name) {
          paidBy = userData.full_name;
        } else {
          paidBy = user.email;
        }
      }
    } catch {}
    
    // Update DB
    const { error } = await supabase
      .from('payment_plans')
      .update({
        paid: true,
        paid_at: new Date().toISOString(),
        paid_by: paidBy,
      })
      .eq('id', id);
      
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
  };

  // Fetch payment plans when component mounts or client changes
  useEffect(() => {
    const fetchPaymentPlans = async () => {
      console.log('fetchPaymentPlans called with client:', client);
      if (!client?.id) {
        console.log('fetchPaymentPlans: No client.id, returning early');
        return;
      }
      
      try {
        console.log('fetchPaymentPlans: Querying payment_plans for lead_id:', client.id);
        const { data, error } = await supabase
          .from('payment_plans')
          .select('*')
          .eq('lead_id', client.id)
          .order('due_date', { ascending: true });

        console.log('fetchPaymentPlans: Query result:', { data, error });

        if (error) {
          console.error('Error fetching payment plans:', error);
          return;
        }

        if (data && data.length > 0) {
          // Transform database data to match the finance plan structure
          const total = data.reduce((sum, plan) => sum + Number(plan.value) + Number(plan.value_vat), 0);
          const vat = data.reduce((sum, plan) => sum + Number(plan.value_vat), 0);
          
          const payments = data.map(plan => ({
            id: plan.id,
            duePercent: plan.due_percent,
            dueDate: plan.due_date,
            value: Number(plan.value),
            valueVat: Number(plan.value_vat),
            client: plan.client_name,
            order: plan.payment_order,
            proforma: plan.proforma || null,
            notes: plan.notes || '',
            paid: plan.paid || false,
            paid_at: plan.paid_at || null,
            paid_by: plan.paid_by || null,
          }));

          console.log('fetchPaymentPlans: Transformed payments:', payments);

          setFinancePlan({
            total: Math.round(total * 100) / 100,
            vat: Math.round(vat * 100) / 100,
            payments: payments,
          });
        } else {
          console.log('fetchPaymentPlans: No payment plans found, setting financePlan to null');
          setFinancePlan(null);
        }
      } catch (error) {
        console.error('Error fetching payment plans:', error);
      }
    };

    const fetchContracts = async () => {
      console.log('fetchContracts called with client:', client);
      if (!client?.id || typeof client.id !== 'string' || client.id.length === 0) {
        console.log('fetchContracts: Invalid client.id, returning early');
        return;
      }
      try {
        console.log('fetchContracts: Calling getClientContracts with clientId:', client.id);
        const contractData = await getClientContracts(client.id);
        console.log('fetchContracts: Received contract data:', contractData);
        
        // Log contact_id values for debugging
        if (contractData && contractData.length > 0) {
          contractData.forEach((contract: any, index: number) => {
            console.log(`Contract ${index + 1}:`, {
              id: contract.id,
              contact_id: contract.contact_id,
              template_name: contract.contract_templates?.name
            });
          });
        }
        
        setContracts(contractData || []);
      } catch (error) {
        console.error('Error fetching contracts:', error);
      }
    };

    const fetchContacts = async () => {
      if (!client?.id) return;
      try {
        // First check if client already has additional_contacts
        if (client.additional_contacts && Array.isArray(client.additional_contacts)) {
          console.log('fetchContacts - using client.additional_contacts:', client.additional_contacts);
          const contactsWithIds = client.additional_contacts.map((contact: any, index: number) => ({
            id: index + 1, // Use index + 1 as ID to match contact_id
            ...contact
          }));
          console.log('fetchContacts - contactsWithIds from client:', contactsWithIds);
          setContacts(contactsWithIds);
          return;
        }
        
        // If not, fetch from database
        const { data: leadData, error } = await supabase
          .from('leads')
          .select('additional_contacts')
          .eq('id', client.id)
          .single();
        
        console.log('fetchContacts - leadData from DB:', leadData);
        
        if (!error && leadData?.additional_contacts) {
          // Transform additional_contacts to include IDs
          const contactsWithIds = leadData.additional_contacts.map((contact: any, index: number) => ({
            id: index + 1, // Use index + 1 as ID to match contact_id
            ...contact
          }));
          console.log('fetchContacts - contactsWithIds from DB:', contactsWithIds);
          setContacts(contactsWithIds);
        } else {
          console.log('fetchContacts - no additional_contacts found');
          setContacts([]);
        }
      } catch (error) {
        console.error('Error fetching contacts:', error);
        setContacts([]);
      }
    };

    fetchPaymentPlans();
    fetchContracts();
    fetchContacts();
  }, [client?.id]);

  const refreshPaymentPlans = async () => {
    if (!client?.id) return;
    try {
      const { data, error } = await supabase
        .from('payment_plans')
        .select('*')
        .eq('lead_id', client.id)
        .order('due_date', { ascending: true });
      if (error) throw error;
      if (data && data.length > 0) {
        const total = data.reduce((sum, plan) => sum + Number(plan.value) + Number(plan.value_vat), 0);
        const vat = data.reduce((sum, plan) => sum + Number(plan.value_vat), 0);
        const payments = data.map(plan => ({
          id: plan.id,
          duePercent: plan.due_percent,
          dueDate: plan.due_date,
          value: Number(plan.value),
          valueVat: Number(plan.value_vat),
          client: plan.client_name,
          order: plan.payment_order,
          proforma: plan.proforma || null,
          notes: plan.notes || '',
          paid: plan.paid || false,
          paid_at: plan.paid_at || null,
          paid_by: plan.paid_by || null,
        }));
        setFinancePlan({
          total: Math.round(total * 100) / 100,
          vat: Math.round(vat * 100) / 100,
          payments: payments,
        });
      } else {
        setFinancePlan(null);
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
      const { error } = await supabase
        .from('leads')
        .update({ balance: newBalance })
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
    } catch (error) {
      console.error('Error updating client balance:', error);
      toast.error('Failed to update client balance');
    }
  };

  // Helper function to get contact name by contact_id
  const getContactName = (contactId: number, contract?: any) => {
    console.log('getContactName called with contactId:', contactId, 'contract:', contract, 'contacts:', contacts);
    
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
    // Find the contract for this contact
    const contract = contracts.find(c => getContactName(c.contact_id, c) === row.client);
    const totalAmount = contract ? Number(contract.total_amount) || 0 : 0;
    let vatRate = 0;
    if (contract) {
      vatRate = contract.client_country === 'IL' ? 0.17 : 0.0;
    } else if (client && client.client_country === 'IL') {
      vatRate = 0.17;
    }
    const newValue = Math.round((Number(row.duePercent) / 100) * totalAmount * 100) / 100;
    const newVat = Math.round(newValue * vatRate * 100) / 100;
    setEditingPaymentId(row.id);
    setEditPaymentData({ ...row, value: newValue, valueVat: newVat });
  };

  const handleCancelEditPayment = () => {
    setEditingPaymentId(null);
    setEditPaymentData({});
  };

  const handleSaveEditPayment = async () => {
    setIsSavingPaymentRow(true);
    try {
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
      toast.success('Payment row updated!');
      setEditingPaymentId(null);
      setEditPaymentData({});
      await refreshPaymentPlans();
    } catch (error) {
      toast.error('Failed to update payment row.');
    } finally {
      setIsSavingPaymentRow(false);
    }
  };

  const handleDeletePayment = async (row: PaymentPlan) => {
    if (!window.confirm('Are you sure you want to delete this payment row?')) return;
    try {
      const { error } = await supabase
        .from('payment_plans')
        .delete()
        .eq('id', row.id);
      if (error) throw error;
      toast.success('Payment row deleted!');
      await refreshPaymentPlans();
    } catch (error) {
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

  if (!financePlan) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <BanknotesIcon className="w-16 h-16 text-primary mb-4" />
        <div className="text-2xl font-bold text-gray-800 mb-2">No finance plan created yet.</div>
        <div className="text-gray-500">Create a payments plan to see finances here.</div>
      </div>
    );
  }

  // Calculate totals from current payments
  const total = financePlan.payments.reduce((sum: number, p: PaymentPlan) => sum + Number(p.value), 0);
  const vat = financePlan.payments.reduce((sum: number, p: PaymentPlan) => sum + Number(p.valueVat), 0);

  // Before rendering payment rows, calculate total:
  const totalPayments = financePlan.payments.reduce((sum, p) => sum + Number(p.value || 0) + Number(p.valueVat || 0), 0);
  // Before rendering payment rows, calculate totalBalanceWithVat:
  const totalBalanceWithVat = (client?.balance || 0) * 1.18;

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
                  <button 
                    className="btn btn-sm btn-outline"
                    onClick={refreshAllData}
                    title="Refresh data"
                  >
                    <ArrowPathIcon className="w-4 h-4" />
                    Refresh
                  </button>
                </div>
              </div>
              
              {/* Contract Cards */}
              <div className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {contracts.map((contract) => (
                    <div key={contract.id} className="group relative bg-white rounded-xl p-6 border border-gray-200 hover:border-blue-300 hover:shadow-lg transition-all duration-300 hover:scale-[1.02]">
                      {/* Status badge */}
                      <div className="absolute top-4 right-4">
                        <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold ${
                          contract.status === 'signed' 
                            ? 'bg-green-100 text-green-800 border border-green-200' 
                            : 'bg-yellow-100 text-yellow-800 border border-yellow-200'
                        }`}>
                          {contract.status === 'signed' ? '✓ Signed' : 'Draft'}
                        </span>
                      </div>
                      
                      {/* Contract title */}
                      <div className="mb-4">
                        <h4 className="text-lg font-bold text-gray-900 mb-1">
                          {contract.contract_templates?.name || 'Contract'}
                        </h4>
                        {contract.contact_id && (
                          <p className="text-sm text-purple-600 font-medium mb-1">
                          {getContactName(contract.contact_id, contract)}
                          </p>
                        )}
                        <div className="w-12 h-1 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full"></div>
                      </div>
                      
                      {/* Contract details */}
                      <div className="space-y-3">
                        
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-gray-500">Applicants</span>
                          <span className="text-sm font-bold text-gray-900">{contract.applicant_count}</span>
                        </div>
                        
                        
                        
                        {contract.total_amount && (
                          <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                            <span className="text-sm font-medium text-gray-500">Total Amount</span>
                            <span className="text-lg font-bold text-purple-700">
                              {contract.client_country === 'IL' ? '₪' : '$'}{contract.total_amount.toLocaleString()}
                            </span>
                          </div>
                        )}
                        
                        {contract.signed_at && (
                          <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                            <span className="text-sm font-medium text-gray-500">Signed Date</span>
                            <span className="text-sm font-bold text-gray-900">
                              {new Date(contract.signed_at).toLocaleDateString()}
                            </span>
                          </div>
                        )}
                      </div>
                      
                      {/* Hover effect overlay */}
                      <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-purple-500/5 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"></div>
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
                  <button 
                    className="btn btn-sm btn-outline"
                    onClick={refreshAllData}
                    title="Refresh data"
                  >
                    <ArrowPathIcon className="w-4 h-4" />
                    Refresh
                  </button>
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
                        ₪{total.toLocaleString()} <span className="text-gray-500 font-medium text-sm">+ VAT {vat.toLocaleString()}</span>
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

                return Object.entries(paymentsByContact).map(([contactName, payments], contactIndex) => (
                  <div key={contactName} className="mb-8">
                    {/* Contact Header */}
                    <div className="mb-4">
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
                            ₪{payments.reduce((sum, p) => sum + p.value + p.valueVat, 0).toLocaleString()}
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
                                  <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">Contact</th>
                                  <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">Payment Date</th>
                                  <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">Order</th>
                                  <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">Proforma</th>
                                  <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">Notes</th>
                                  <th className="px-4 py-3 text-center"></th>
                                </tr>
                              </thead>
                              <tbody>
                                {payments.map((p: PaymentPlan, idx: number) => {
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
                                    })
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
        const contract = contracts.find(c => getContactName(c.contact_id, c) === p.client);
        const totalAmount = contract ? Number(contract.total_amount) || 0 : 0;
        let vatRate = 0;
        if (contract) {
          vatRate = contract.client_country === 'IL' ? 0.17 : 0.0;
        } else if (client && client.client_country === 'IL') {
          vatRate = 0.17;
        }
        const newValue = Math.round((newDuePercent / 100) * totalAmount * 100) / 100;
        const newVat = Math.round(newValue * vatRate * 100) / 100;
        setEditPaymentData((d: any) => ({ ...d, duePercent: newDuePercent, value: newValue, valueVat: newVat }));
      }}
    />
  ) : (
    p.duePercent
  )}
</td>
                                      <td className="align-middle text-center px-4 py-3 whitespace-nowrap">{p.dueDate ? (new Date(p.dueDate).toString() !== 'Invalid Date' ? new Date(p.dueDate).toLocaleDateString() : '') : ''}</td>
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
    `₪${p.value.toLocaleString(undefined, { minimumFractionDigits: 2 })} + ${p.valueVat.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
  )}
</td>
                                      <td className="align-middle text-center px-4 py-3 whitespace-nowrap">
                                        <div className="flex items-center justify-center gap-2">
                                          <div className="w-6 h-6 bg-gradient-to-br from-purple-500 to-blue-600 rounded-full flex items-center justify-center">
                                            <UserIcon className="w-3 h-3 text-white" />
                                          </div>
                                          <div className="text-left">
                                            <div className="text-sm font-semibold text-gray-900">
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
                                        {p.proforma && p.proforma.trim() !== '' ? (
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
                                            onClick={e => { e.preventDefault(); handleOpenProforma(p); }}
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
                                              {/* Dollar icon (small) */}
                                              {p.proforma && !isPaid && (
                                                <button
                                                  className="btn btn-xs btn-circle bg-green-100 hover:bg-green-200 text-green-700 border-green-300 border-2 shadow-sm flex items-center justify-center"
                                                  title="Mark as Paid"
                                                  onClick={() => handleMarkAsPaid(p.id)}
                                                  style={{ padding: 0 }}
                                                >
                                                  <CurrencyDollarIcon className="w-4 h-4" />
                                                </button>
                                              )}
                                              {/* Edit icon (small) */}
                                              <button
                                                className="btn btn-xs btn-circle bg-gray-100 hover:bg-gray-200 text-primary border-none shadow-sm flex items-center justify-center"
                                                title="Edit"
                                                onClick={() => handleEditPayment(p)}
                                                style={{ padding: 0 }}
                                              >
                                                <PencilIcon className="w-4 h-4" />
                                              </button>
                                              {/* Delete icon (small) */}
                                              <button
                                                className="btn btn-xs btn-circle bg-red-100 hover:bg-red-200 text-red-500 border-none shadow-sm flex items-center justify-center"
                                                title="Delete"
                                                onClick={() => handleDeletePayment(p)}
                                                style={{ padding: 0 }}
                                              >
                                                <TrashIcon className="w-4 h-4" />
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
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 gap-y-8">
                            {payments.map((p: PaymentPlan, idx: number) => {
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
                                        <input className="input input-bordered w-48 text-right" type="date" value={editPaymentData.dueDate ? editPaymentData.dueDate.slice(0, 10) : ''} onChange={e => setEditPaymentData((d: any) => ({ ...d, dueDate: e.target.value }))} />
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
                                        <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">VAT</span>
                                        <div className="flex items-center gap-2">
                                          <input
                                            type="number"
                                            className={`input input-bordered input-lg w-28 text-right font-bold rounded-xl border-2 border-blue-300 no-arrows ${editingValueVatId === p.id ? '' : 'bg-gray-100 text-gray-500 cursor-not-allowed'}`}
                                            value={editPaymentData.valueVat}
                                            readOnly={editingValueVatId !== p.id}
                                            onChange={editingValueVatId === p.id ? (e) => setEditPaymentData((d: any) => ({ ...d, valueVat: e.target.value })) : undefined}
                                          />
                                          {editingValueVatId === p.id ? (
                                            <button className="btn btn-xs btn-ghost ml-1" onClick={() => setEditingValueVatId(null)} title="Done editing VAT">
                                              <CheckIcon className="w-4 h-4 text-green-600" />
                                            </button>
                                          ) : (
                                            <button className="btn btn-xs btn-ghost ml-1" onClick={() => setEditingValueVatId(p.id)} title="Edit VAT">
                                              <PencilIcon className="w-4 h-4 text-blue-600" />
                                            </button>
                                          )}
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
                                              <button
                                                className="btn btn-xs btn-circle bg-gray-100 hover:bg-gray-200 text-primary border-none shadow-sm flex items-center justify-center"
                                                title="Delete"
                                                onClick={() => handleDeletePayment(p)}
                                                style={{ padding: 0 }}
                                              >
                                                <TrashIcon className="w-4 h-4" />
                                              </button>
                                              <button
                                                className="btn btn-xs btn-circle bg-gray-100 hover:bg-gray-200 text-primary border-none shadow-sm flex items-center justify-center"
                                                title="Edit"
                                                onClick={() => handleEditPayment(p)}
                                                style={{ padding: 0 }}
                                              >
                                                <PencilIcon className="w-4 h-4" />
                                              </button>
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
                                          <span className="text-sm font-bold text-gray-900">{p.dueDate ? (new Date(p.dueDate).toString() !== 'Invalid Date' ? new Date(p.dueDate).toLocaleDateString() : '') : ''}</span>
                                        </div>
                                        <div className="flex items-center justify-between py-3">
                                          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">VALUE</span>
                                          <span className="text-sm font-bold text-gray-900">₪{p.value.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                        </div>
                                        <div className="flex items-center justify-between py-3">
                                          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">VAT</span>
                                          <span className="text-sm font-bold text-gray-900">{p.valueVat.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                        </div>
                                        <div className="flex items-center justify-between py-3">
                                          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">CLIENT</span>
                                          <span className="text-sm font-bold text-gray-900">{p.client}</span>
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
                                            {p.proforma && p.proforma.trim() !== '' ? (
                                              <button 
                                                className="btn btn-xs btn-outline btn-success text-xs font-medium border-success/40" 
                                                title="View Proforma" 
                                                onClick={e => { e.preventDefault(); navigate(`/proforma/${p.id}`); }}
                                              >
                                                {getProformaName(p.proforma)}
                                              </button>
                                            ) : (
                                              <button 
                                                className="btn btn-xs btn-outline btn-primary text-xs font-medium" 
                                                title="Create Proforma" 
                                                onClick={e => { e.preventDefault(); handleOpenProforma(p); }}
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
                                      <div className="absolute bottom-4 right-4">
                                        {p.proforma && !isPaid && (
                                          <button
                                            className="btn btn-circle btn-md bg-green-100 hover:bg-green-200 text-green-700 border-green-300 border-2 shadow-sm flex items-center justify-center"
                                            title="Mark as Paid"
                                            onClick={() => handleMarkAsPaid(p.id)}
                                            style={{ padding: 0 }}
                                          >
                                            <CurrencyDollarIcon className="w-4 h-4" />
                                          </button>
                                        )}
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
                ));
              })()}
              
              {/* Add new payment button */}
              <div className="mt-10 flex justify-start">
                <button className="btn btn-primary btn-lg px-10 shadow-lg hover:scale-105 transition-transform">Add new payment</button>
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
                                className="input input-bordered w-full text-base py-3 px-4" 
                                value={row.description} 
                                onChange={e => handleProformaRowChange(idx, 'description', e.target.value)}
                                readOnly={proformaData?.isViewMode}
                                placeholder="Item description"
                              />
                            </td>
                            <td>
                              <input 
                                className="input input-bordered w-24 text-base text-right py-3 px-4" 
                                type="number" 
                                value={row.qty} 
                                onChange={e => handleProformaRowChange(idx, 'qty', Number(e.target.value))}
                                readOnly={proformaData?.isViewMode}
                              />
                            </td>
                            <td>
                              <input 
                                className="input input-bordered w-24 text-base text-right py-3 px-4" 
                                type="number" 
                                value={row.rate} 
                                onChange={e => handleProformaRowChange(idx, 'rate', Number(e.target.value))}
                                readOnly={proformaData?.isViewMode}
                              />
                            </td>
                            <td>
                              <input className="input input-bordered w-24 text-base text-right font-semibold py-3 px-4" type="number" value={row.total} readOnly />
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
                <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-6 mb-6 border border-blue-200 w-full">
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
                          {proformaData.rows.reduce((sum: number, r: any) => sum + Number(r.total), 0).toLocaleString()}
                        </span>
                      )}
                    </div>
                    {proformaData.addVat && (
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-medium text-gray-600">VAT (18%):</span>
                        <span className="font-semibold text-gray-800">
                          {Math.round(proformaData.rows.reduce((sum: number, r: any) => sum + Number(r.total), 0) * 0.18 * 100) / 100}
                        </span>
                      </div>
                    )}
                    <div className="border-t border-gray-300 pt-3">
                      <div className="flex justify-between items-center">
                        <span className="text-lg font-bold text-gray-800">Total:</span>
                        <span className="text-xl font-bold text-blue-600">
                          {proformaData.addVat ? Math.round(proformaData.rows.reduce((sum: number, r: any) => sum + Number(r.total), 0) * 1.18 * 100) / 100 : proformaData.rows.reduce((sum: number, r: any) => sum + Number(r.total), 0)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Proforma Info */}
                <div className="bg-gray-50 rounded-xl p-4 mb-6 w-full">
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
                      <span className="font-medium">{proformaData.payment.toLocaleString()}</span>
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
      
      <TimelineHistoryButtons client={client} />
    </>
  );
};

export default FinancesTab; 