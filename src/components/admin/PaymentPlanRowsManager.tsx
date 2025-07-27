import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useMsal } from '@azure/msal-react';

interface PaymentPlanRow {
  id: number;
  created_at: string;
  lead_id: string;
  due_percent: number;
  due_date: string | null;
  value: number;
  value_vat: number;
  client_name: string;
  payment_order: string;
  proforma: string | null;
  notes: string;
  paid: boolean;
  paid_at: string | null;
  paid_by: string | null;
  currency: string;
  percent: number;
  contract_id: string | null;
  updated_at: string;
  updated_by: string | null;
}

interface Lead {
  id: string;
  lead_number: string;
  name: string;
  email: string;
  phone: string;
  client_country: string;
}

interface ChangeHistory {
  id: number;
  payment_plan_id: number;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  changed_by: string;
  changed_at: string;
}

const PaymentPlanRowsManager: React.FC = () => {
  const [paymentPlans, setPaymentPlans] = useState<PaymentPlanRow[]>([]);
  const [leads, setLeads] = useState<{ [key: string]: Lead }>({});
  const [selectedPlan, setSelectedPlan] = useState<PaymentPlanRow | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editedPlan, setEditedPlan] = useState<PaymentPlanRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [changeHistory, setChangeHistory] = useState<ChangeHistory[]>([]);
  const { instance } = useMsal();

  // Fetch payment plans and leads
  useEffect(() => {
    fetchPaymentPlans();
    fetchLeads();
  }, []);

  const fetchPaymentPlans = async () => {
    try {
      const { data, error } = await supabase
        .from('payment_plans')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setPaymentPlans(data || []);
    } catch (error) {
      console.error('Error fetching payment plans:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchLeads = async () => {
    try {
      const { data, error } = await supabase
        .from('leads')
        .select('id, lead_number, name, email, phone, client_country');

      if (error) throw error;
      
      const leadsMap: { [key: string]: Lead } = {};
      data?.forEach(lead => {
        leadsMap[lead.id] = lead;
      });
      setLeads(leadsMap);
    } catch (error) {
      console.error('Error fetching leads:', error);
    }
  };

  const fetchChangeHistory = async (paymentPlanId: number) => {
    try {
      const { data, error } = await supabase
        .from('payment_plan_changes')
        .select('*')
        .eq('payment_plan_id', paymentPlanId)
        .order('changed_at', { ascending: false });

      if (error) throw error;
      setChangeHistory(data || []);
    } catch (error) {
      console.error('Error fetching change history:', error);
    }
  };

  const getCurrentUser = async () => {
    try {
      const account = instance.getActiveAccount();
      if (!account) return null;

      const { data: user } = await supabase
        .from('users')
        .select('full_name')
        .eq('email', account.username)
        .single();

      return user?.full_name || account.username;
    } catch (error) {
      console.error('Error getting current user:', error);
      return 'Unknown User';
    }
  };

  const handleRowClick = (plan: PaymentPlanRow) => {
    setSelectedPlan(plan);
    setEditedPlan({ ...plan });
    setIsEditing(false);
    setShowHistory(false);
    // Fetch history when a row is clicked
    fetchChangeHistory(plan.id);
  };

  const handleEdit = () => {
    setIsEditing(true);
  };

  const handleSave = async () => {
    if (!editedPlan) return;

    try {
      const currentUser = await getCurrentUser();
      
      // Get the original plan for comparison
      const originalPlan = paymentPlans.find(p => p.id === editedPlan.id);
      if (!originalPlan) return;

      // Prepare changes for history
      const changes: any[] = [];
      const fieldsToTrack = ['payment_order', 'due_date', 'value', 'value_vat', 'notes', 'currency', 'due_percent'];
      
      fieldsToTrack.forEach(field => {
        const oldValue = originalPlan[field as keyof PaymentPlanRow];
        const newValue = editedPlan[field as keyof PaymentPlanRow];
        
        if (oldValue !== newValue) {
          changes.push({
            payment_plan_id: editedPlan.id,
            field_name: field,
            old_value: oldValue?.toString() || null,
            new_value: newValue?.toString() || null,
            changed_by: currentUser,
            changed_at: new Date().toISOString()
          });
        }
      });

      // Update the payment plan
      const { error: updateError } = await supabase
        .from('payment_plans')
        .update({
          ...editedPlan,
          updated_at: new Date().toISOString(),
          updated_by: currentUser
        })
        .eq('id', editedPlan.id);

      if (updateError) throw updateError;

      // Insert change history records
      if (changes.length > 0) {
        const { error: historyError } = await supabase
          .from('payment_plan_changes')
          .insert(changes);

        if (historyError) {
          console.error('Error saving change history:', historyError);
        }
      }

      // Refresh data
      await fetchPaymentPlans();
      setIsEditing(false);
      setSelectedPlan(editedPlan);
    } catch (error) {
      console.error('Error saving payment plan:', error);
    }
  };

  const handleDelete = async () => {
    if (!selectedPlan) return;

    if (!confirm('Are you sure you want to delete this payment plan?')) return;

    try {
      const { error } = await supabase
        .from('payment_plans')
        .delete()
        .eq('id', selectedPlan.id);

      if (error) throw error;

      setSelectedPlan(null);
      setEditedPlan(null);
      setIsEditing(false);
      setShowHistory(false);
      await fetchPaymentPlans();
    } catch (error) {
      console.error('Error deleting payment plan:', error);
    }
  };



  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getCurrencySymbol = (currency: string) => {
    switch (currency?.toUpperCase()) {
      case 'USD': return '$';
      case 'NIS':
      case 'ILS': return '₪';
      case 'EUR': return '€';
      default: return currency || '₪';
    }
  };

  // Filter payment plans based on search term
  const filteredPaymentPlans = paymentPlans.filter(plan => {
    if (!searchTerm) return true;
    
    const lead = leads[plan.lead_id];
    const leadNumber = lead?.lead_number || '';
    const clientName = plan.client_name || '';
    
    return (
      leadNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      clientName.toLowerCase().includes(searchTerm.toLowerCase())
    );
  });

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
            <h2 className="text-2xl font-bold">Payment Plan Rows</h2>
            <div className="text-sm text-gray-500">
              Total: {filteredPaymentPlans.length} of {paymentPlans.length} payment plans
            </div>
          </div>

          {/* Search Bar */}
          <div className="mb-6">
            <div className="form-control w-full max-w-md">
              <div className="input-group">
                <input
                  type="text"
                  placeholder="Search by lead number or client name..."
                  className="input input-bordered w-full"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                {searchTerm && (
                  <button 
                    className="btn btn-square btn-outline"
                    onClick={() => setSearchTerm('')}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Desktop Table View */}
          <div className="hidden md:block overflow-x-auto bg-base-100 rounded-lg shadow">
            <table className="table w-full">
              <thead>
                <tr>
                  <th>Creation Date</th>
                  <th>Lead #</th>
                  <th>Client</th>
                  <th>Currency</th>
                  <th>Value</th>
                  <th>VAT</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {filteredPaymentPlans.map((plan) => {
                  const lead = leads[plan.lead_id];
                  const total = plan.value + plan.value_vat;
                  
                  return (
                    <tr 
                      key={plan.id}
                      className="cursor-pointer hover:bg-primary/10 transition-colors"
                      onClick={() => handleRowClick(plan)}
                    >
                      <td className="font-mono text-sm">
                        {formatDate(plan.created_at)}
                      </td>
                      <td className="font-bold">
                        {lead?.lead_number || 'N/A'}
                      </td>
                      <td className="max-w-xs truncate">
                        {plan.client_name}
                      </td>
                      <td className="font-mono">
                        {getCurrencySymbol(plan.currency)}
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
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Card View */}
          <div className="md:hidden space-y-4">
            {filteredPaymentPlans.map((plan) => {
              const lead = leads[plan.lead_id];
              const total = plan.value + plan.value_vat;
              
              return (
                <div 
                  key={plan.id}
                  className="card bg-base-100 shadow-lg hover:shadow-2xl transition-all duration-300 ease-in-out transform hover:-translate-y-1 cursor-pointer group"
                  onClick={() => handleRowClick(plan)}
                >
                  <div className="card-body p-5">
                    <div className="flex justify-between items-start mb-2">
                      <h2 className="card-title text-xl font-bold group-hover:text-primary transition-colors">
                        {plan.client_name}
                      </h2>
                      <div className="badge badge-primary badge-sm">
                        {getCurrencySymbol(plan.currency)}{total.toLocaleString()}
                      </div>
                    </div>
                    
                    <p className="text-sm text-base-content/60 font-mono mb-4">#{lead?.lead_number || 'N/A'}</p>

                    <div className="divider my-0"></div>

                    <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm mt-4">
                      <div>
                        <div className="text-xs text-base-content/60 mb-1">Creation Date</div>
                        <div className="font-medium">{formatDate(plan.created_at)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-base-content/60 mb-1">Payment Order</div>
                        <div>{plan.payment_order}</div>
                      </div>
                      <div>
                        <div className="text-xs text-base-content/60 mb-1">Value</div>
                        <div>{getCurrencySymbol(plan.currency)}{plan.value.toLocaleString()}</div>
                      </div>
                      <div>
                        <div className="text-xs text-base-content/60 mb-1">VAT</div>
                        <div>{getCurrencySymbol(plan.currency)}{plan.value_vat.toLocaleString()}</div>
                      </div>
                    </div>

                    <div className="mt-4 pt-4 border-t border-base-200/50">
                      <p className="text-sm font-semibold text-base-content/80">
                        {plan.notes || 'No notes specified'}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
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
            </div>
            <div className="flex gap-2">
              {!isEditing ? (
                <button 
                  className="btn btn-primary btn-sm"
                  onClick={handleEdit}
                >
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
                className="btn btn-primary btn-sm"
                onClick={handleDelete}
              >
                Delete
              </button>
            </div>
          </div>


            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div>
                  <label className="label">
                    <span className="label-text font-semibold">Order</span>
                  </label>
                  {isEditing ? (
                    <input
                      type="text"
                      className="input input-bordered w-full"
                      value={editedPlan?.payment_order || ''}
                      onChange={(e) => setEditedPlan(prev => prev ? { ...prev, payment_order: e.target.value } : null)}
                    />
                  ) : (
                    <div className="p-3 bg-base-200 rounded-lg">
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
                      onChange={(e) => setEditedPlan(prev => prev ? { ...prev, due_date: e.target.value } : null)}
                  />
                  ) : (
                    <div className="p-3 bg-base-200 rounded-lg">
                      {selectedPlan.due_date ? formatDate(selectedPlan.due_date) : 'Not set'}
                    </div>
                  )}
                </div>

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
                    </select>
                  ) : (
                    <div className="p-3 bg-base-200 rounded-lg">
                      {getCurrencySymbol(selectedPlan.currency)}
                    </div>
                  )}
                </div>
              </div>

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
                    <div className="p-3 bg-base-200 rounded-lg font-mono">
                      {selectedPlan.value.toLocaleString()}
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
                    <div className="p-3 bg-base-200 rounded-lg font-mono">
                      {selectedPlan.value_vat.toLocaleString()}
                    </div>
                  )}
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
                    <div className="p-3 bg-base-200 rounded-lg min-h-[4rem]">
                      {selectedPlan.notes || 'No notes'}
                    </div>
                  )}
                </div>
              </div>
            </div>

          {/* Change History Section */}
          <div className="mt-8 pt-6 border-t border-base-300">
            <h4 className="text-lg font-semibold mb-4">Change History</h4>
            {changeHistory.length === 0 ? (
              <p className="text-gray-500">No changes recorded</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="table table-sm w-full">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Field</th>
                      <th>Old Value</th>
                      <th>New Value</th>
                      <th>Changed By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {changeHistory.map((change) => (
                      <tr key={change.id}>
                        <td className="font-mono text-sm">
                          {formatDate(change.changed_at)}
                        </td>
                        <td className="font-semibold">
                          {change.field_name.replace('_', ' ')}
                        </td>
                        <td className="text-gray-500">
                          {change.old_value || 'null'}
                        </td>
                        <td className="text-success font-semibold">
                          {change.new_value || 'null'}
                        </td>
                        <td className="text-sm">
                          {change.changed_by}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Additional Info */}
          <div className="mt-6 pt-6 border-t border-base-300">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div>
                <span className="font-semibold">Created:</span> {formatDate(selectedPlan.created_at)}
              </div>
              <div>
                <span className="font-semibold">Lead:</span> {leads[selectedPlan.lead_id]?.name || 'Unknown'}
              </div>
              <div>
                <span className="font-semibold">Status:</span> 
                <span className={`badge ml-2 ${selectedPlan.paid ? 'badge-success' : 'badge-warning'}`}>
                  {selectedPlan.paid ? 'Paid' : 'Pending'}
                </span>
              </div>
            </div>
            {selectedPlan.updated_at && (
              <div className="mt-2 text-xs text-gray-500">
                <span className="font-semibold">Last updated:</span> {formatDate(selectedPlan.updated_at)}
                {selectedPlan.updated_by && (
                  <span className="ml-2">by {selectedPlan.updated_by}</span>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default PaymentPlanRowsManager; 