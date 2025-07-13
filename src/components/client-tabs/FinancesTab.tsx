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
                      <span className="font-extrabold text-3xl tracking-tight text-center w-24 flex-shrink-0 flex-grow-0">{p.duePercent}%</span>
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
          <div className="ml-auto w-full max-w-2xl h-full bg-base-100 shadow-2xl p-8 flex flex-col animate-slideInRight z-[110] overflow-y-auto relative">
            {/* Close Button */}
            <button className="absolute top-4 right-4 btn btn-ghost btn-sm" onClick={() => setShowProformaDrawer(false)}>
              <XMarkIcon className="w-6 h-6" />
            </button>
            {/* Header */}
            <div className="mb-6 p-4 rounded-lg bg-blue-100 border border-blue-200">
              <div className="text-lg font-semibold mb-1">
                Client: <span className="text-blue-700 font-bold">{proformaData.client}</span> <span className="inline-block text-blue-700 ml-2"><svg className="w-5 h-5 inline" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M12 8v4l3 3" /></svg></span> <span className="text-blue-900 font-bold">Missing Tax ID!</span>
              </div>
              <div className="text-md font-medium">Payment: <span className="text-blue-900 font-bold">₪ {proformaData.payment.toLocaleString()}</span></div>
              <div className="text-md">Language: {proformaData.language}</div>
              <div className="text-md mt-2">
                <span className="text-blue-900 font-bold">Proforma Name: </span>
                <span className="text-blue-700">{generatedProformaName}</span>
              </div>
            </div>
            <div className="mb-4 text-xl font-bold">Language: {proformaData.language}</div>
            {/* Editable table */}
            <table className="table w-full mb-4">
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Qty</th>
                  <th>Rate</th>
                  <th>Total</th>
                  {!proformaData?.isViewMode && <th>Delete</th>}
                </tr>
              </thead>
              <tbody>
                {proformaData.rows.map((row: any, idx: number) => (
                  <tr key={idx}>
                    <td>
                      <input 
                        className="input input-bordered w-full" 
                        value={row.description} 
                        onChange={e => handleProformaRowChange(idx, 'description', e.target.value)}
                        readOnly={proformaData?.isViewMode}
                      />
                    </td>
                    <td>
                      <input 
                        className="input input-bordered w-16" 
                        type="number" 
                        value={row.qty} 
                        onChange={e => handleProformaRowChange(idx, 'qty', Number(e.target.value))}
                        readOnly={proformaData?.isViewMode}
                      />
                    </td>
                    <td>
                      <input 
                        className="input input-bordered w-24" 
                        type="number" 
                        value={row.rate} 
                        onChange={e => handleProformaRowChange(idx, 'rate', Number(e.target.value))}
                        readOnly={proformaData?.isViewMode}
                      />
                    </td>
                    <td><input className="input input-bordered w-24" type="number" value={row.total} readOnly /></td>
                    {!proformaData?.isViewMode && (
                      <td><a className="text-blue-600 hover:underline cursor-pointer" onClick={() => handleDeleteProformaRow(idx)}>delete</a></td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {!proformaData?.isViewMode && (
              <a className="text-blue-600 hover:underline cursor-pointer mb-2" onClick={handleAddProformaRow}>add row</a>
            )}
            {/* Totals */}
            <div className="mb-2 flex gap-4 items-center">
              <div>Total:</div>
              <input className="input input-bordered w-32" type="number" value={proformaData.rows.reduce((sum: number, r: any) => sum + Number(r.total), 0)} readOnly />
            </div>
            <div className="mb-4 flex gap-4 items-center">
              <div>Total with VAT:</div>
              <input className="input input-bordered w-32" type="number" value={proformaData.addVat ? Math.round(proformaData.rows.reduce((sum: number, r: any) => sum + Number(r.total), 0) * 1.18 * 100) / 100 : proformaData.rows.reduce((sum: number, r: any) => sum + Number(r.total), 0)} readOnly />
            </div>
            {/* VAT, currency, bank, notes */}
            <div className="mb-4 flex items-center gap-4">
              <label className="flex items-center gap-2">
                <input 
                  type="checkbox" 
                  checked={proformaData.addVat} 
                  onChange={e => setProformaData((prev: any) => ({ ...prev, addVat: e.target.checked }))}
                  disabled={proformaData?.isViewMode}
                /> Add vat
              </label>
              <label>Currency:
                <select 
                  className="select select-bordered ml-2" 
                  value={proformaData.currency} 
                  onChange={e => setProformaData((prev: any) => ({ ...prev, currency: e.target.value }))}
                  disabled={proformaData?.isViewMode}
                >
                  <option value="₪">₪</option>
                  <option value="$">$</option>
                  <option value="€">€</option>
                </select>
              </label>
              <label>Bank account:
                <select 
                  className="select select-bordered ml-2" 
                  value={proformaData.bankAccount} 
                  onChange={e => setProformaData((prev: any) => ({ ...prev, bankAccount: e.target.value }))}
                  disabled={proformaData?.isViewMode}
                >
                  <option value="">---------</option>
                  <option value="1">Account 1</option>
                  <option value="2">Account 2</option>
                </select>
              </label>
            </div>
            <div className="mb-4">
              <label>Notes:</label>
              <textarea 
                className="textarea textarea-bordered w-full min-h-[100px]" 
                value={proformaData.notes} 
                onChange={e => setProformaData((prev: any) => ({ ...prev, notes: e.target.value }))}
                readOnly={proformaData?.isViewMode}
              />
            </div>
            {proformaData?.isViewMode ? (
              <div className="flex gap-2">
                <button className="btn btn-primary w-32" onClick={() => setShowProformaDrawer(false)}>Close</button>
                <button className="btn btn-outline w-32" onClick={() => {
                  // Remove view mode flag to allow editing
                  setProformaData((prev: any) => ({ ...prev, isViewMode: false }));
                }}>Edit</button>
              </div>
            ) : (
              <>
                <button className="btn btn-primary w-32" onClick={handleCreateProforma}>Create</button>
                <div className="mt-2 text-xs text-gray-500">* Once you create, CHANGES CANNOT be made!</div>
              </>
            )}
          </div>
        </div>, document.body)}
    </>
  );
};

export default FinancesTab; 