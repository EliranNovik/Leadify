import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { BanknotesIcon, PencilIcon, TrashIcon, XMarkIcon, Squares2X2Icon, Bars3Icon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { ClientTabProps } from '../../types/client';
import { useMsal } from '@azure/msal-react';
import { loginRequest } from '../../msalConfig';
import ReactDOM from 'react-dom';
import { BanknotesIcon as BanknotesIconSolid } from '@heroicons/react/24/solid';
import { PencilLine, Trash2 } from 'lucide-react';
import { DocumentTextIcon, Cog6ToothIcon, ChartPieIcon, PlusIcon, ChatBubbleLeftRightIcon, DocumentCheckIcon } from '@heroicons/react/24/outline';

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
}

interface FinancePlan {
  total: number;
  vat: number;
  payments: PaymentPlan[];
}

const FinancesTab: React.FC<ClientTabProps> = ({ client, onClientUpdate }) => {
  const navigate = useNavigate();
  const { instance } = useMsal();
  const [financePlan, setFinancePlan] = useState<FinancePlan | null>(null);
  const [editingPaymentId, setEditingPaymentId] = useState<string | number | null>(null);
  const [editPaymentData, setEditPaymentData] = useState<any>({});
  const [isSavingPaymentRow, setIsSavingPaymentRow] = useState(false);
  const [viewMode, setViewMode] = useState<'table' | 'boxes'>('boxes');

  // Proforma drawer state
  const [showProformaDrawer, setShowProformaDrawer] = useState(false);
  const [proformaData, setProformaData] = useState<any>(null);
  const [generatedProformaName, setGeneratedProformaName] = useState<string>('');

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

  // Fetch payment plans when component mounts or client changes
  useEffect(() => {
    const fetchPaymentPlans = async () => {
      if (!client?.id) return;
      
      try {
        const { data, error } = await supabase
          .from('payment_plans')
          .select('*')
          .eq('lead_id', client.id)
          .order('due_date', { ascending: true });

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
        console.error('Error fetching payment plans:', error);
      }
    };

    fetchPaymentPlans();
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

  const handleEditPayment = (row: PaymentPlan) => {
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

  // Function to generate sequential proforma name
  const generateProformaName = async (clientId: number) => {
    if (!clientId) {
      const year = new Date().getFullYear();
      const timestamp = Date.now().toString().slice(-4);
      return `${year}-${timestamp} Proforma`;
    }
    
    try {
      // Get all existing proformas for this client
      const { data, error } = await supabase
        .from('payment_plans')
        .select('proforma')
        .eq('lead_id', clientId)
        .not('proforma', 'is', null);

      if (error) throw error;

      // Extract proforma names and find the highest number
      const existingNames = data
        .map(row => row.proforma)
        .filter(proforma => proforma && typeof proforma === 'string')
        .map(proforma => {
          try {
            const parsed = JSON.parse(proforma);
            return parsed.proformaName || '';
          } catch {
            return '';
          }
        })
        .filter(name => name.startsWith(`${new Date().getFullYear()}-`));

      // Find the highest number
      let maxNumber = 0;
      existingNames.forEach(name => {
        const match = name.match(/\d+$/);
        if (match) {
          const num = parseInt(match[0]);
          if (num > maxNumber) maxNumber = num;
        }
      });

      // Generate next number
      const nextNumber = maxNumber + 1;
      const year = new Date().getFullYear();
      return `${year}-${nextNumber.toString().padStart(2, '0')} Proforma`;
    } catch (error) {
      console.error('Error generating proforma name:', error);
      // Fallback to current timestamp
      const year = new Date().getFullYear();
      const timestamp = Date.now().toString().slice(-4);
      return `${year}-${timestamp} Proforma`;
    }
  };

  // Generate proforma content as a structured object
  const generateProformaContent = async (data: any, createdBy: string) => {
    const total = data.rows.reduce((sum: number, r: any) => sum + Number(r.total), 0);
    const totalWithVat = data.addVat ? Math.round(total * 1.18 * 100) / 100 : total;
    
    // Generate proforma name
    const proformaName = await generateProformaName(data.clientId);
    
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
    const proformaName = await generateProformaName(Number(client?.id));
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
      // Get current user (example for MSAL)
      let createdBy = 'Unknown';
      if (instance && typeof instance.getAllAccounts === 'function') {
        const account = instance.getAllAccounts()[0];
        if (account && account.name) createdBy = account.name;
      }
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
        {/* Title and Total */}
        <div className="mb-10 mt-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-end gap-2 sm:gap-6 w-full">
            <span className="inline-flex items-center gap-2 sm:gap-3 text-2xl sm:text-4xl font-black text-primary tracking-tight leading-tight drop-shadow-sm">
              <BanknotesIconSolid className="w-8 h-8 sm:w-10 sm:h-10 text-success/80" />
              Payments Plan
            </span>
            <span className="text-xl sm:text-3xl font-extrabold text-primary">
              ₪{total.toLocaleString()} <span className="text-black font-bold text-lg sm:text-2xl ml-2 sm:ml-4">+ VAT {vat.toLocaleString()}</span>
            </span>
            <span className="text-base sm:text-lg font-semibold text-gray-700 ml-0 sm:ml-2">Total</span>
          </div>
        </div>
        {/* View toggle button */}
        <div className="flex justify-end mb-4">
          <button
            className={`btn btn-outline btn-primary btn-sm flex items-center gap-2 ${viewMode === 'boxes' ? '' : ''}`}
            onClick={() => setViewMode(viewMode === 'table' ? 'boxes' : 'table')}
            title={viewMode === 'table' ? 'Switch to Box View' : 'Switch to Table View'}
          >
            {viewMode === 'table' ? (
              <Squares2X2Icon className="w-5 h-5" />
            ) : (
              <Bars3Icon className="w-5 h-5" />
            )}
            <span className="hidden md:inline">{viewMode === 'table' ? 'Box View' : 'Table View'}</span>
          </button>
        </div>
        {/* Table or Box view */}
        {viewMode === 'table' ? (
          <div className="bg-white rounded-2xl shadow-xl p-4 mb-12 border border-base-200">
            <table className="min-w-full rounded-xl overflow-hidden">
              <thead className="bg-base-200">
                <tr>
                  <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">Due %</th>
                  <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">Due Date</th>
                  <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">Value</th>
                  <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">Client</th>
                  <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">Payment Date</th>
                  <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">Order</th>
                  <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">Proforma</th>
                  <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">Notes</th>
                  <th className="px-4 py-3 text-center"></th>
                </tr>
              </thead>
              <tbody>
                {financePlan.payments.map((p: PaymentPlan, idx: number) => (
                  <tr key={p.id || idx} className={
                    `transition-all ${idx % 2 === 0 ? 'bg-white' : 'bg-base-100'} hover:bg-primary/5 border-b-2 border-base-200 last:border-0` // add row divider
                  } style={{ height: '64px' }}>
                    {editingPaymentId === p.id ? (
                      <>
                        <td className="align-middle text-center"><input className="input input-bordered w-20 text-center" value={editPaymentData.duePercent} onChange={e => setEditPaymentData((d: any) => ({ ...d, duePercent: e.target.value }))} /></td>
                        <td className="align-middle text-center"><input className="input input-bordered w-32 text-center" type="date" value={editPaymentData.dueDate ? editPaymentData.dueDate.slice(0, 10) : ''} onChange={e => setEditPaymentData((d: any) => ({ ...d, dueDate: e.target.value }))} /></td>
                        <td className="align-middle text-center"><input className="input input-bordered w-32 text-center" type="number" value={editPaymentData.value} onChange={e => setEditPaymentData((d: any) => ({ ...d, value: e.target.value }))} /></td>
                        <td className="align-middle text-center"><input className="input input-bordered w-32 text-center" value={editPaymentData.client} onChange={e => setEditPaymentData((d: any) => ({ ...d, client: e.target.value }))} /></td>
                        <td className="align-middle text-center">---</td>
                        <td className="align-middle text-center"><input className="input input-bordered w-32 text-center" value={editPaymentData.order} onChange={e => setEditPaymentData((d: any) => ({ ...d, order: e.target.value }))} /></td>
                        <td className="align-middle text-center">{editPaymentData.proforma && editPaymentData.proforma.trim() !== '' ? <span className="text-green-600">Proforma Saved</span> : <span className="text-gray-400">No Proforma</span>}</td>
                        <td className="align-middle text-center"><input className="input input-bordered w-32 text-center" value={editPaymentData.notes} onChange={e => setEditPaymentData((d: any) => ({ ...d, notes: e.target.value }))} /></td>
                        <td className="align-middle min-w-[120px] sticky right-0 bg-white z-10 flex flex-col gap-2 items-end py-2">
                          <div className="flex gap-2">
                            <button className="btn btn-xs btn-success" onClick={handleSaveEditPayment} disabled={isSavingPaymentRow}>Save</button>
                            <button className="btn btn-xs btn-ghost" onClick={handleCancelEditPayment}>Cancel</button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="font-bold text-lg align-middle text-center">{p.duePercent}</td>
                        <td className="align-middle text-center">{p.dueDate ? (new Date(p.dueDate).toString() !== 'Invalid Date' ? new Date(p.dueDate).toLocaleDateString() : '') : ''}</td>
                        <td className="font-bold align-middle text-center">₪{p.value.toLocaleString(undefined, { minimumFractionDigits: 2 })} <span className='text-gray-500 font-bold'>+ {p.valueVat.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></td>
                        <td className="text-primary font-semibold align-middle text-center">{p.client}</td>
                        <td className="align-middle text-center">---</td>
                        <td className="align-middle text-center">{p.order}</td>
                        <td className="align-middle text-center">
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
                        <td className="align-middle text-center">{p.notes}</td>
                        <td className="flex gap-2 justify-end align-middle min-w-[80px]">
                          {p.id ? (
                            <>
                              <TrashIcon className="w-5 h-5 text-red-500 cursor-pointer hover:text-red-700" title="Delete" onClick={() => handleDeletePayment(p)} />
                              <PencilIcon className="w-5 h-5 text-blue-500 cursor-pointer hover:text-blue-700" title="Edit" onClick={() => handleEditPayment(p)} />
                            </>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-10 flex justify-start">
              <button className="btn btn-primary btn-lg px-10 shadow-lg hover:scale-105 transition-transform">Add new payment</button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
            {financePlan.payments.map((p: PaymentPlan, idx: number) => (
              <div
                key={p.id || idx}
                className="bg-white rounded-2xl p-6 shadow-xl hover:shadow-2xl transition-all duration-200 border border-base-200 flex flex-col gap-0 relative group min-h-[460px]"
              >
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
                      <input className="input input-bordered w-48 text-right" type="number" value={editPaymentData.value} onChange={e => setEditPaymentData((d: any) => ({ ...d, value: e.target.value }))} />
                    </div>
                    <div className="flex items-center justify-between py-3">
                      <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">VAT</span>
                      <input className="input input-bordered w-48 text-right" type="number" value={editPaymentData.valueVat} onChange={e => setEditPaymentData((d: any) => ({ ...d, valueVat: e.target.value }))} />
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
                    <div className="flex items-center bg-primary text-white rounded-t-2xl px-5 py-3" style={{ minHeight: '64px' }}>
                      {/* Order (left) */}
                      <span className="text-xs font-bold uppercase tracking-wider flex-1 text-left truncate">{p.order}</span>
                      {/* Percent (center) */}
                      <span className="font-extrabold text-3xl tracking-tight text-center w-24 flex-shrink-0 flex-grow-0">
                        {totalBalanceWithVat > 0 ? ((Number(p.value || 0) + Number(p.valueVat || 0)) / totalBalanceWithVat * 100).toFixed(1) : '0'}%
                      </span>
                      {/* Actions (right) */}
                      <div className="flex gap-2 items-center ml-4">
                        {p.id ? (
                          <>
                            <button
                              className="btn btn-xs btn-circle bg-white hover:bg-gray-200 text-black border-none shadow-sm flex items-center justify-center"
                              title="Delete"
                              onClick={() => handleDeletePayment(p)}
                              style={{ padding: 0 }}
                            >
                              <Trash2 className="w-4 h-4 text-black" />
                            </button>
                            <button
                              className="btn btn-xs btn-circle bg-white hover:bg-gray-200 text-black border-none shadow-sm flex items-center justify-center"
                              title="Edit"
                              onClick={() => handleEditPayment(p)}
                              style={{ padding: 0 }}
                            >
                              <PencilLine className="w-4 h-4 text-black" />
                            </button>
                          </>
                        ) : (
                          <span className="text-white/50">—</span>
                        )}
                      </div>
                    </div>
                    {/* Due Date */}
                    <div className="flex items-center justify-between py-3">
                      <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Due Date</span>
                      <span className="font-semibold text-black">{p.dueDate ? (new Date(p.dueDate).toString() !== 'Invalid Date' ? new Date(p.dueDate).toLocaleDateString() : '') : ''}</span>
                    </div>
                    {/* Value */}
                    <div className="flex items-center justify-between py-3">
                      <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Value</span>
                      <span className="font-bold text-lg text-primary">₪{p.value.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                    {/* VAT */}
                    <div className="flex items-center justify-between py-3">
                      <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">VAT</span>
                      <span className="font-bold text-black">{p.valueVat.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                    {/* Client */}
                    <div className="flex items-center justify-between py-3">
                      <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Client</span>
                      <span className="font-semibold text-black">{p.client}</span>
                    </div>
                    {/* Proforma */}
                    <div className="flex items-center justify-between py-3">
                      <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Proforma</span>
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
                    </div>
                    {/* Notes */}
                    <div className="flex items-center justify-between py-3">
                      <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Notes</span>
                      <span className="text-right max-w-[60%] text-black">{p.notes}</span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
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
    </>
  );
};

export default FinancesTab; 