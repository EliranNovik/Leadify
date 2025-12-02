import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { toast } from 'react-hot-toast';
import { 
  PlusIcon, 
  PencilIcon, 
  TrashIcon, 
  XMarkIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MagnifyingGlassIcon
} from '@heroicons/react/24/outline';

interface LegacyPaymentPlan {
  id: number;
  lead_id: string;
  client_id: number | null;
  date: string | null;
  due_date: string | null;
  value: number;
  vat_value: number;
  due_percent: string;
  order: number;
  currency_id: number;
  notes: string;
  cancel_date: string | null;
  ready_to_pay: boolean;
  actual_date: string | null;
  cdate: string;
  udate: string;
  accounting_currencies?: {
    name: string;
    iso_code: string;
  };
}

interface NewPaymentPlan {
  id: number;
  lead_id: string;
  due_date: string | null;
  value: number;
  value_vat: number;
  due_percent: number;
  percent?: number;
  payment_order: string;
  currency: string;
  notes: string;
  client_name: string;
  contract_id: string | null;
  paid: boolean;
  paid_at: string | null;
  paid_by: string | null;
  cancel_date: string | null;
  ready_to_pay: boolean;
  created_at?: string;
  cdate?: string;
  date?: string;
  updated_at?: string;
  udate?: string;
  created_by?: string | null;
  updated_by?: string | null;
  proforma: string | null;
}

interface UnifiedPaymentPlan {
  id: number;
  lead_id: string;
  lead_type: 'legacy' | 'new';
  lead_number?: string;
  lead_name?: string;
  due_date: string | null;
  value: number;
  value_vat: number;
  due_percent: string | number;
  payment_order: string;
  currency: string;
  currency_symbol: string;
  notes: string;
  client_name: string;
  paid: boolean;
  paid_at: string | null;
  paid_by: string | null;
  cancel_date: string | null;
  ready_to_pay: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  // Legacy specific
  order?: number;
  actual_date?: string | null;
  // New specific
  contract_id?: string | null;
  proforma?: string | null;
}

interface Lead {
  id: string;
  lead_number: string;
  name: string;
  email: string;
  phone: string;
}

interface LegacyLead {
  id: number;
  name: string;
  email: string;
  phone: string;
}

const PaymentPlansManager: React.FC = () => {
  const [paymentPlans, setPaymentPlans] = useState<UnifiedPaymentPlan[]>([]);
  const [leads, setLeads] = useState<{ [key: string]: Lead }>({});
  const [legacyLeads, setLegacyLeads] = useState<{ [key: string]: LegacyLead }>({});
  const [selectedPlan, setSelectedPlan] = useState<UnifiedPaymentPlan | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editedPlan, setEditedPlan] = useState<UnifiedPaymentPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [leadTypeFilter, setLeadTypeFilter] = useState<'all' | 'legacy' | 'new'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(50);

  // Fetch payment plans and leads
  useEffect(() => {
    fetchPaymentPlans();
    fetchLeads();
    fetchLegacyLeads();
  }, []);

  const fetchLeads = async (): Promise<{ [key: string]: Lead }> => {
    try {
      const { data, error } = await supabase
        .from('leads')
        .select('id, lead_number, name, email, phone');

      if (error) throw error;
      
      const leadsMap: { [key: string]: Lead } = {};
      data?.forEach(lead => {
        leadsMap[lead.id] = lead;
      });
      setLeads(leadsMap);
      return leadsMap;
    } catch (error) {
      console.error('Error fetching leads:', error);
      return {};
    }
  };

  const fetchLegacyLeads = async (): Promise<{ [key: string]: LegacyLead }> => {
    try {
      const { data, error } = await supabase
        .from('leads_lead')
        .select('id, name, email, phone');

      if (error) throw error;
      
      const legacyLeadsMap: { [key: string]: LegacyLead } = {};
      data?.forEach(lead => {
        legacyLeadsMap[String(lead.id)] = lead;
      });
      setLegacyLeads(legacyLeadsMap);
      return legacyLeadsMap;
    } catch (error) {
      console.error('Error fetching legacy leads:', error);
      return {};
    }
  };

  const fetchLegacyClients = async (clientIds: (number | null)[]): Promise<{ [key: number]: LegacyLead }> => {
    try {
      // Filter out null values
      const validClientIds = clientIds.filter((id): id is number => id !== null);
      
      if (validClientIds.length === 0) {
        return {};
      }

      const { data, error } = await supabase
        .from('leads_lead')
        .select('id, name, email, phone')
        .in('id', validClientIds);

      if (error) throw error;
      
      const clientsMap: { [key: number]: LegacyLead } = {};
      data?.forEach(client => {
        clientsMap[client.id] = client;
      });
      
      return clientsMap;
    } catch (error) {
      console.error('Error fetching legacy clients:', error);
      return {};
    }
  };

  const getCurrencySymbol = (currency: string | number): string => {
    if (typeof currency === 'number') {
      // Legacy currency_id mapping
      switch (currency) {
        case 1: return '₪';
        case 2: return '€';
        case 3: return '$';
        case 4: return '£';
        default: return '₪';
      }
    }
    // New currency string
    switch (currency?.toUpperCase()) {
      case 'USD': return '$';
      case 'NIS':
      case 'ILS': 
      case '₪': return '₪';
      case 'EUR': 
      case '€': return '€';
      case 'GBP':
      case '£': return '£';
      default: return currency || '₪';
    }
  };

  const getOrderText = (order: number | string): string => {
    if (typeof order === 'number') {
      // Legacy order number
      switch (order) {
        case 1: return 'First Payment';
        case 5: return 'Intermediate Payment';
        case 9: return 'Final Payment';
        case 90: return 'Single Payment';
        case 99: return 'Expense (no VAT)';
        default: return 'First Payment';
      }
    }
    // New order string
    return order as string;
  };

  const fetchPaymentPlans = async () => {
    setLoading(true);
    try {
      // Fetch leads data first and get the returned maps
      const [leadsMap, legacyLeadsMap] = await Promise.all([
        fetchLeads(),
        fetchLegacyLeads()
      ]);

      // Fetch legacy payment plans
      const { data: legacyData, error: legacyError } = await supabase
        .from('finances_paymentplanrow')
        .select(`
          *,
          accounting_currencies!finances_paymentplanrow_currency_id_fkey (
            name,
            iso_code
          )
        `)
        .is('cancel_date', null)
        .order('cdate', { ascending: false });

      if (legacyError) {
        console.error('Error fetching legacy payment plans:', legacyError);
      }

      // Extract unique client_ids from legacy payment plans
      const clientIds = (legacyData || [])
        .map((plan: LegacyPaymentPlan) => plan.client_id)
        .filter((id): id is number => id !== null);
      
      // Fetch client information using client_id
      const legacyClientsMap = await fetchLegacyClients(clientIds);

      // Fetch new payment plans
      // Try ordering by id descending as fallback (newest first)
      const { data: newData, error: newError } = await supabase
        .from('payment_plans')
        .select('*')
        .is('cancel_date', null)
        .order('id', { ascending: false });

      if (newError) {
        console.error('Error fetching new payment plans:', newError);
      }

      // Transform legacy payment plans
      const legacyPlans: UnifiedPaymentPlan[] = (legacyData || []).map((plan: LegacyPaymentPlan) => {
        const currency = plan.accounting_currencies?.name || '₪';
        // Use client_id to get client name, fallback to lead_id if client_id is null
        const client = plan.client_id ? legacyClientsMap[plan.client_id] : null;
        const lead = plan.lead_id ? legacyLeadsMap[String(plan.lead_id)] : null;
        const clientName = client?.name || lead?.name || 'Unknown';
        
        return {
          id: plan.id,
          lead_id: String(plan.lead_id || ''),
          lead_type: 'legacy',
          due_date: plan.due_date,
          value: Number(plan.value || 0),
          value_vat: Number(plan.vat_value || 0),
          due_percent: plan.due_percent,
          payment_order: getOrderText(plan.order),
          currency: currency,
          currency_symbol: getCurrencySymbol(plan.currency_id),
          notes: plan.notes || '',
          client_name: clientName,
          paid: !!plan.actual_date,
          paid_at: plan.actual_date,
          paid_by: null,
          cancel_date: plan.cancel_date,
          ready_to_pay: plan.ready_to_pay || false,
          created_at: plan.cdate,
          updated_at: plan.udate,
          created_by: null,
          updated_by: null,
          order: plan.order,
          actual_date: plan.actual_date,
        };
      });

      // Transform new payment plans
      const newPlans: UnifiedPaymentPlan[] = (newData || []).map((plan: any) => {
        const lead = leadsMap[plan.lead_id];
        // Handle different possible date column names
        const createdDate = plan.created_at || plan.cdate || plan.date || new Date().toISOString();
        const updatedDate = plan.updated_at || plan.udate || createdDate;
        
        return {
          id: plan.id,
          lead_id: plan.lead_id,
          lead_type: 'new',
          lead_number: lead?.lead_number,
          lead_name: lead?.name,
          due_date: plan.due_date,
          value: Number(plan.value || 0),
          value_vat: Number(plan.value_vat || 0),
          due_percent: plan.due_percent,
          payment_order: plan.payment_order,
          currency: plan.currency,
          currency_symbol: getCurrencySymbol(plan.currency),
          notes: plan.notes || '',
          client_name: plan.client_name || lead?.name || 'Unknown',
          paid: plan.paid || false,
          paid_at: plan.paid_at,
          paid_by: plan.paid_by,
          cancel_date: plan.cancel_date,
          ready_to_pay: plan.ready_to_pay || false,
          created_at: createdDate,
          updated_at: updatedDate,
          created_by: plan.created_by || null,
          updated_by: plan.updated_by || null,
          contract_id: plan.contract_id,
          proforma: plan.proforma,
        };
      });

      // Combine and sort by creation date
      const combined = [...legacyPlans, ...newPlans].sort((a, b) => 
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      setPaymentPlans(combined);
    } catch (error) {
      console.error('Error fetching payment plans:', error);
      toast.error('Failed to fetch payment plans');
    } finally {
      setLoading(false);
    }
  };

  const handleRowClick = (plan: UnifiedPaymentPlan) => {
    setSelectedPlan(plan);
    setEditedPlan({ ...plan });
    setIsEditing(false);
  };

  const handleEdit = () => {
    setIsEditing(true);
  };

  const handleSave = async () => {
    if (!editedPlan) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      const currentUser = user?.email || 'System';

      if (editedPlan.lead_type === 'legacy') {
        // Update legacy payment plan
        const currencyId = editedPlan.currency === '₪' ? 1 :
                          editedPlan.currency === '€' ? 2 :
                          editedPlan.currency === '$' ? 3 :
                          editedPlan.currency === '£' ? 4 : 1;

        const orderNumber = editedPlan.payment_order === 'First Payment' ? 1 :
                           editedPlan.payment_order === 'Intermediate Payment' ? 5 :
                           editedPlan.payment_order === 'Final Payment' ? 9 :
                           editedPlan.payment_order === 'Single Payment' ? 90 :
                           editedPlan.payment_order === 'Expense (no VAT)' ? 99 : 1;

        const { error } = await supabase
          .from('finances_paymentplanrow')
          .update({
            date: editedPlan.due_date,
            due_date: editedPlan.due_date,
            value: editedPlan.value,
            vat_value: editedPlan.value_vat,
            due_percent: String(editedPlan.due_percent),
            order: orderNumber,
            currency_id: currencyId,
            notes: editedPlan.notes,
            ready_to_pay: editedPlan.ready_to_pay,
            udate: new Date().toISOString().split('T')[0],
          })
          .eq('id', editedPlan.id);

        if (error) throw error;
      } else {
        // Update new payment plan
        const { error } = await supabase
          .from('payment_plans')
          .update({
            due_date: editedPlan.due_date,
            value: editedPlan.value,
            value_vat: editedPlan.value_vat,
            due_percent: Number(editedPlan.due_percent),
            percent: Number(editedPlan.due_percent),
            payment_order: editedPlan.payment_order,
            currency: editedPlan.currency,
            notes: editedPlan.notes,
            client_name: editedPlan.client_name,
            ready_to_pay: editedPlan.ready_to_pay,
            updated_at: new Date().toISOString(),
            updated_by: currentUser,
          })
          .eq('id', editedPlan.id);

        if (error) throw error;
      }

      toast.success('Payment plan updated successfully');
      await fetchPaymentPlans();
      setIsEditing(false);
      setSelectedPlan(editedPlan);
    } catch (error) {
      console.error('Error saving payment plan:', error);
      toast.error('Failed to save payment plan');
    }
  };

  const handleChangeStatus = async () => {
    if (!selectedPlan || !selectedPlan.paid) return;

    if (!confirm('Are you sure you want to change this payment status from Paid to Pending?')) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      const currentUser = user?.email || 'System';

      if (selectedPlan.lead_type === 'legacy') {
        // For legacy leads, clear actual_date
        const { error } = await supabase
          .from('finances_paymentplanrow')
          .update({ 
            actual_date: null,
            udate: new Date().toISOString().split('T')[0]
          })
          .eq('id', selectedPlan.id);

        if (error) throw error;
      } else {
        // For new leads, set paid to false and clear paid_at
        const { error } = await supabase
          .from('payment_plans')
          .update({ 
            paid: false,
            paid_at: null,
            paid_by: null,
            updated_at: new Date().toISOString(),
            updated_by: currentUser
          })
          .eq('id', selectedPlan.id);

        if (error) throw error;
      }

      toast.success('Payment status changed to Pending');
      
      // Refresh payment plans first
      await fetchPaymentPlans();
      
      // Update the selected plan to reflect the change
      const updatedPlan: UnifiedPaymentPlan = {
        ...selectedPlan,
        paid: false,
        paid_at: null,
        actual_date: null,
      };
      setSelectedPlan(updatedPlan);
      setEditedPlan({ ...updatedPlan });
    } catch (error) {
      console.error('Error changing payment status:', error);
      toast.error('Failed to change payment status');
    }
  };

  const handleDelete = async () => {
    if (!selectedPlan) return;

    if (!confirm('Are you sure you want to delete this payment plan?')) return;

    try {
      if (selectedPlan.lead_type === 'legacy') {
        // Soft delete legacy payment plan
        const { error } = await supabase
          .from('finances_paymentplanrow')
          .update({ cancel_date: new Date().toISOString().split('T')[0] })
          .eq('id', selectedPlan.id);

        if (error) throw error;
      } else {
        // Soft delete new payment plan
        const { error } = await supabase
          .from('payment_plans')
          .update({ cancel_date: new Date().toISOString().split('T')[0] })
          .eq('id', selectedPlan.id);

        if (error) throw error;
      }

      toast.success('Payment plan deleted successfully');
      setSelectedPlan(null);
      setEditedPlan(null);
      setIsEditing(false);
      await fetchPaymentPlans();
    } catch (error) {
      console.error('Error deleting payment plan:', error);
      toast.error('Failed to delete payment plan');
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Not set';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatDateTime = (dateString: string | null) => {
    if (!dateString) return 'Not set';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Filter payment plans
  const filteredPaymentPlans = paymentPlans.filter(plan => {
    if (leadTypeFilter !== 'all' && plan.lead_type !== leadTypeFilter) return false;
    
    if (!searchTerm) return true;
    
    const searchLower = searchTerm.toLowerCase();
    return (
      plan.client_name.toLowerCase().includes(searchLower) ||
      plan.lead_number?.toLowerCase().includes(searchLower) ||
      plan.lead_id.toLowerCase().includes(searchLower) ||
      plan.payment_order.toLowerCase().includes(searchLower) ||
      plan.notes.toLowerCase().includes(searchLower)
    );
  });

  // Pagination
  const totalPages = Math.ceil(filteredPaymentPlans.length / pageSize);
  const paginatedPlans = filteredPaymentPlans.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="loading loading-spinner loading-lg"></span>
      </div>
    );
  }

  return (
    <div className="w-full">
      {!selectedPlan ? (
        // Table View
        <>
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold">Payment Plans</h2>
            <div className="text-sm text-gray-500">
              Total: {filteredPaymentPlans.length} of {paymentPlans.length} payment plans
            </div>
          </div>

          {/* Filters and Search */}
          <div className="mb-6 flex flex-col md:flex-row gap-4">
            <div className="form-control flex-1">
              <div className="input-group">
                <span className="bg-base-200">
                  <MagnifyingGlassIcon className="w-5 h-5" />
                </span>
                <input
                  type="text"
                  placeholder="Search by lead number, client name, or notes..."
                  className="input input-bordered w-full"
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setCurrentPage(1);
                  }}
                />
                {searchTerm && (
                  <button 
                    className="btn btn-square btn-outline"
                    onClick={() => setSearchTerm('')}
                  >
                    <XMarkIcon className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
            <div className="form-control">
              <select
                className="select select-bordered"
                value={leadTypeFilter}
                onChange={(e) => {
                  setLeadTypeFilter(e.target.value as 'all' | 'legacy' | 'new');
                  setCurrentPage(1);
                }}
              >
                <option value="all">All Leads</option>
                <option value="legacy">Legacy Leads</option>
                <option value="new">New Leads</option>
              </select>
            </div>
          </div>

          {/* Desktop Table View */}
          <div className="hidden md:block overflow-x-auto bg-base-100 rounded-lg shadow">
            <table className="table w-full">
              <thead>
                <tr>
                  <th>Lead #</th>
                  <th>Client</th>
                  <th>Order</th>
                  <th>Currency</th>
                  <th>Value</th>
                  <th>VAT</th>
                  <th>Total</th>
                  <th>Due Date</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {paginatedPlans.map((plan) => {
                  const total = plan.value + plan.value_vat;
                  
                  return (
                    <tr 
                      key={`${plan.lead_type}-${plan.id}`}
                      className="cursor-pointer"
                      onClick={() => handleRowClick(plan)}
                    >
                      <td className="font-bold">
                        {plan.lead_number || plan.lead_id}
                      </td>
                      <td className="max-w-xs truncate">
                        {plan.client_name}
                      </td>
                      <td className="text-sm">
                        {plan.payment_order}
                      </td>
                      <td className="font-mono">
                        {plan.currency_symbol}
                      </td>
                      <td className="font-mono text-right">
                        {plan.value.toLocaleString()}
                      </td>
                      <td className="font-mono text-right">
                        {plan.value_vat.toLocaleString()}
                      </td>
                      <td className="font-mono text-right font-bold">
                        {total.toLocaleString()}
                      </td>
                      <td className="font-mono text-sm">
                        {formatDate(plan.due_date)}
                      </td>
                      <td>
                        {plan.paid ? 'Paid' : 'Pending'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Card View */}
          <div className="md:hidden space-y-4">
            {paginatedPlans.map((plan) => {
              const total = plan.value + plan.value_vat;
              
              return (
                <div 
                  key={`${plan.lead_type}-${plan.id}`}
                  className="card bg-base-100 shadow-lg cursor-pointer group"
                  onClick={() => handleRowClick(plan)}
                >
                  <div className="card-body p-5">
                    <div className="flex justify-between items-start mb-2">
                      <h2 className="card-title text-xl font-bold group-hover:text-primary transition-colors">
                        {plan.client_name}
                      </h2>
                      <div className="badge badge-primary badge-sm">
                        {plan.currency_symbol}{total.toLocaleString()}
                      </div>
                    </div>
                    
                    <p className="text-sm text-base-content/60 font-mono mb-4">
                      #{plan.lead_number || plan.lead_id} • {plan.payment_order}
                    </p>

                    <div className="divider my-0"></div>

                    <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm mt-4">
                      <div>
                        <div className="text-xs text-base-content/60 mb-1">Due Date</div>
                        <div className="font-medium">{formatDate(plan.due_date)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-base-content/60 mb-1">Status</div>
                        <div className="font-medium">{plan.paid ? 'Paid' : 'Pending'}</div>
                      </div>
                      <div>
                        <div className="text-xs text-base-content/60 mb-1">Value</div>
                        <div>{plan.currency_symbol}{plan.value.toLocaleString()}</div>
                      </div>
                      <div>
                        <div className="text-xs text-base-content/60 mb-1">VAT</div>
                        <div>{plan.currency_symbol}{plan.value_vat.toLocaleString()}</div>
                      </div>
                    </div>

                    {plan.notes && (
                      <div className="mt-4 pt-4 border-t border-base-200/50">
                        <p className="text-sm font-semibold text-base-content/80">
                          {plan.notes}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex justify-center items-center gap-2 mt-6">
              <button
                className="btn btn-sm btn-outline"
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
              >
                <ChevronLeftIcon className="w-4 h-4" />
              </button>
              <span className="text-sm">
                Page {currentPage} of {totalPages}
              </span>
              <button
                className="btn btn-sm btn-outline"
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
              >
                <ChevronRightIcon className="w-4 h-4" />
              </button>
            </div>
          )}
        </>
      ) : (
        // Detail/Edit View
        <div className="bg-base-100 rounded-lg shadow p-6">
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center gap-4">
              <button 
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setSelectedPlan(null);
                  setEditedPlan(null);
                  setIsEditing(false);
                }}
              >
                ← Back to List
              </button>
              <h3 className="text-xl font-bold">Payment Plan Details</h3>
              <span className={`badge ${selectedPlan.lead_type === 'legacy' ? 'badge-warning' : 'badge-info'}`}>
                {selectedPlan.lead_type === 'legacy' ? 'Legacy Lead' : 'New Lead'}
              </span>
            </div>
            <div className="flex gap-2">
              {!isEditing ? (
                <button 
                  className="btn btn-primary btn-sm"
                  onClick={handleEdit}
                >
                  <PencilIcon className="w-4 h-4 mr-1" />
                  Edit
                </button>
              ) : (
                <>
                  <button 
                    className="btn btn-success btn-sm"
                    onClick={handleSave}
                  >
                    Save
                  </button>
                  <button 
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setIsEditing(false);
                      setEditedPlan({ ...selectedPlan });
                    }}
                  >
                    Cancel
                  </button>
                </>
              )}
              <button 
                className="btn btn-error btn-sm"
                onClick={handleDelete}
              >
                <TrashIcon className="w-4 h-4 mr-1" />
                Delete
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
            {/* Column 1 */}
            <div className="space-y-4">
              <div>
                <label className="label">
                  <span className="label-text font-semibold">Lead Number</span>
                </label>
                <div className="p-3">
                  {selectedPlan.lead_number || selectedPlan.lead_id}
                </div>
              </div>

              <div>
                <label className="label">
                  <span className="label-text font-semibold">Client Name</span>
                </label>
                {isEditing ? (
                  <input
                    type="text"
                    className="input input-bordered w-full"
                    value={editedPlan?.client_name || ''}
                    onChange={(e) => setEditedPlan(prev => prev ? { ...prev, client_name: e.target.value } : null)}
                  />
                ) : (
                  <div className="p-3">
                    {selectedPlan.client_name}
                  </div>
                )}
              </div>
            </div>

            {/* Column 2 */}
            <div className="space-y-4">
              <div>
                <label className="label">
                  <span className="label-text font-semibold">Payment Order</span>
                </label>
                {isEditing ? (
                  <select
                    className="select select-bordered w-full"
                    value={editedPlan?.payment_order || ''}
                    onChange={(e) => setEditedPlan(prev => prev ? { ...prev, payment_order: e.target.value } : null)}
                  >
                    <option value="First Payment">First Payment</option>
                    <option value="Intermediate Payment">Intermediate Payment</option>
                    <option value="Final Payment">Final Payment</option>
                    <option value="Single Payment">Single Payment</option>
                    <option value="Expense (no VAT)">Expense (no VAT)</option>
                    <option value="One-time Payment">One-time Payment</option>
                  </select>
                ) : (
                  <div className="p-3">
                    {selectedPlan.payment_order}
                  </div>
                )}
              </div>

              <div>
                <label className="label">
                  <span className="label-text font-semibold">Due Date</span>
                </label>
                {isEditing ? (
                  <input
                    type="date"
                    className="input input-bordered w-full"
                    value={editedPlan?.due_date || ''}
                    onChange={(e) => setEditedPlan(prev => prev ? { ...prev, due_date: e.target.value || null } : null)}
                  />
                ) : (
                  <div className="p-3">
                    {formatDate(selectedPlan.due_date)}
                  </div>
                )}
              </div>
            </div>

            {/* Column 3 */}
            <div className="space-y-4">
              <div>
                <label className="label">
                  <span className="label-text font-semibold">Currency</span>
                </label>
                {isEditing ? (
                  <select
                    className="select select-bordered w-full"
                    value={editedPlan?.currency || '₪'}
                    onChange={(e) => setEditedPlan(prev => prev ? { ...prev, currency: e.target.value } : null)}
                  >
                    <option value="₪">₪ (NIS)</option>
                    <option value="USD">$ (USD)</option>
                    <option value="EUR">€ (EUR)</option>
                    <option value="GBP">£ (GBP)</option>
                  </select>
                ) : (
                  <div className="p-3">
                    {selectedPlan.currency_symbol} ({selectedPlan.currency})
                  </div>
                )}
              </div>

              <div>
                <label className="label">
                  <span className="label-text font-semibold">Due Percent</span>
                </label>
                {isEditing ? (
                  <input
                    type="text"
                    className="input input-bordered w-full"
                    value={editedPlan?.due_percent || ''}
                    onChange={(e) => setEditedPlan(prev => prev ? { ...prev, due_percent: e.target.value } : null)}
                    placeholder="e.g., 25% or 25"
                  />
                ) : (
                  <div className="p-3">
                    {selectedPlan.due_percent}
                  </div>
                )}
              </div>
            </div>

            {/* Column 4 */}
            <div className="space-y-4">
              <div>
                <label className="label">
                  <span className="label-text font-semibold">Value</span>
                </label>
                {isEditing ? (
                  <input
                    type="number"
                    step="0.01"
                    className="input input-bordered w-full"
                    value={editedPlan?.value || 0}
                    onChange={(e) => setEditedPlan(prev => prev ? { ...prev, value: parseFloat(e.target.value) || 0 } : null)}
                  />
                ) : (
                  <div className="p-3 font-mono">
                    {selectedPlan.currency_symbol}{selectedPlan.value.toLocaleString()}
                  </div>
                )}
              </div>

              <div>
                <label className="label">
                  <span className="label-text font-semibold">VAT</span>
                </label>
                {isEditing ? (
                  <input
                    type="number"
                    step="0.01"
                    className="input input-bordered w-full"
                    value={editedPlan?.value_vat || 0}
                    onChange={(e) => setEditedPlan(prev => prev ? { ...prev, value_vat: parseFloat(e.target.value) || 0 } : null)}
                  />
                ) : (
                  <div className="p-3 font-mono">
                    {selectedPlan.currency_symbol}{selectedPlan.value_vat.toLocaleString()}
                  </div>
                )}
              </div>

              <div>
                <label className="label">
                  <span className="label-text font-semibold">Total</span>
                </label>
                <div className="p-3 font-mono font-bold text-lg">
                  {selectedPlan.currency_symbol}{(selectedPlan.value + selectedPlan.value_vat).toLocaleString()}
                </div>
              </div>
            </div>

            {/* Column 5 */}
            <div className="space-y-4">
              <div>
                <label className="label">
                  <span className="label-text font-semibold">Ready to Pay</span>
                </label>
                {isEditing ? (
                  <input
                    type="checkbox"
                    className="toggle toggle-primary"
                    checked={editedPlan?.ready_to_pay || false}
                    onChange={(e) => setEditedPlan(prev => prev ? { ...prev, ready_to_pay: e.target.checked } : null)}
                  />
                ) : (
                  <div className="p-3">
                    {selectedPlan.ready_to_pay ? 'Yes (sent to finance)' : 'No'}
                  </div>
                )}
              </div>

              <div>
                <label className="label">
                  <span className="label-text font-semibold">Status</span>
                </label>
                <div className="p-3">
                  <div className="flex items-center gap-2">
                    <span>{selectedPlan.paid ? 'Paid' : 'Pending'}</span>
                    {selectedPlan.paid && !isEditing && (
                      <button
                        className="btn btn-xs btn-outline btn-warning"
                        onClick={handleChangeStatus}
                        title="Change status from Paid to Pending"
                      >
                        Mark as Pending
                      </button>
                    )}
                  </div>
                  {selectedPlan.paid && (
                    <div className="text-xs text-gray-500 mt-1">
                      {selectedPlan.lead_type === 'legacy' && selectedPlan.actual_date ? (
                        <>Paid on: {formatDate(selectedPlan.actual_date)}</>
                      ) : selectedPlan.lead_type === 'new' && selectedPlan.paid_at ? (
                        <>Paid on: {formatDate(selectedPlan.paid_at)}</>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="label">
                  <span className="label-text font-semibold">Notes</span>
                </label>
                {isEditing ? (
                  <textarea
                    className="textarea textarea-bordered w-full"
                    rows={3}
                    value={editedPlan?.notes || ''}
                    onChange={(e) => setEditedPlan(prev => prev ? { ...prev, notes: e.target.value } : null)}
                  />
                ) : (
                  <div className="p-3 min-h-[4rem]">
                    {selectedPlan.notes || 'No notes'}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Additional Info */}
          <div className="mt-6 pt-6 border-t border-base-300">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div>
                <span className="font-semibold">Created:</span> {formatDateTime(selectedPlan.created_at)}
                {selectedPlan.created_by && (
                  <div className="text-xs text-gray-500">by {selectedPlan.created_by}</div>
                )}
              </div>
              <div>
                <span className="font-semibold">Updated:</span> {formatDateTime(selectedPlan.updated_at)}
                {selectedPlan.updated_by && (
                  <div className="text-xs text-gray-500">by {selectedPlan.updated_by}</div>
                )}
              </div>
              {selectedPlan.paid_by && (
                <div>
                  <span className="font-semibold">Paid By:</span> {selectedPlan.paid_by}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PaymentPlansManager;

