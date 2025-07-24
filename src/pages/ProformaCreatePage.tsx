import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { DocumentTextIcon, Cog6ToothIcon, ChartPieIcon, PlusIcon, ChatBubbleLeftRightIcon, XMarkIcon, CheckIcon, PrinterIcon, EnvelopeIcon, ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import { generateProformaName } from '../lib/proforma';

const ProformaCreatePage: React.FC = () => {
  const { paymentId } = useParams<{ paymentId: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [payment, setPayment] = useState<any>(null);
  const [proformaData, setProformaData] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [userFullName, setUserFullName] = useState<string | null>(null);

  useEffect(() => {
    const fetchPayment = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('payment_plans')
        .select('*')
        .eq('id', paymentId)
        .single();
      if (error) {
        toast.error('Failed to load payment details');
        setLoading(false);
        return;
      }
      // Fetch client info for email/phone
      let clientEmail = '';
      let clientPhone = '';
      if (data.lead_id) {
        const { data: leadData } = await supabase
          .from('leads')
          .select('email, phone')
          .eq('id', data.lead_id)
          .single();
        if (leadData) {
          clientEmail = leadData.email || '';
          clientPhone = leadData.phone || '';
        }
      }
      setPayment(data);
      setProformaData({
        client: data.client_name,
        clientId: data.lead_id,
        paymentRowId: data.id,
        payment: data.value + data.value_vat,
        base: data.value,
        vat: data.value_vat,
        language: 'EN',
        rows: [
          { description: data.payment_order, qty: 1, rate: data.value, total: data.value },
        ],
        addVat: true,
        currency: data.currency || '₪',
        bankAccount: '',
        notes: '',
        email: clientEmail,
        phone: clientPhone,
      });
      setLoading(false);
    };
    if (paymentId) fetchPayment();
  }, [paymentId]);

  useEffect(() => {
    const fetchUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user && user.email) {
        const { data: userData, error } = await supabase
          .from('users')
          .select('full_name')
          .eq('email', user.email)
          .single();
        if (!error && userData?.full_name) {
          setUserFullName(userData.full_name);
        }
      }
    };
    fetchUser();
  }, []);

  const handleProformaRowChange = (idx: number, field: string, value: any) => {
    setProformaData((prev: any) => {
      const rows = prev.rows.map((row: any, i: number) =>
        i === idx ? { ...row, [field]: value, total: field === 'qty' || field === 'rate' ? value * (field === 'qty' ? row.rate : row.qty) : row.total } : row
      );
      return { ...prev, rows };
    });
  };

  const handleAddProformaRow = () => {
    setProformaData((prev: any) => ({
      ...prev,
      rows: [...prev.rows, { description: '', qty: 1, rate: 0, total: 0 }],
    }));
  };

  const handleDeleteProformaRow = (idx: number) => {
    setProformaData((prev: any) => ({
      ...prev,
      rows: prev.rows.filter((_: any, i: number) => i !== idx),
    }));
  };

  const handleSaveProforma = async () => {
    setIsSaving(true);
    try {
      // Generate proforma name
      const proformaName = await generateProformaName();
      // Calculate totals
      const total = proformaData.rows.reduce((sum: number, r: any) => sum + Number(r.total), 0);
      // --- VAT logic: recalculate if NIS/ILS/₪ and Israeli client ---
      let vat = 0;
      let addVat = proformaData.addVat;
      let currency = proformaData.currency || '₪';
      let clientCountry = '';
      // Try to fetch client country from lead
      if (proformaData.clientId) {
        const { data: leadData } = await supabase
          .from('leads')
          .select('client_country')
          .eq('id', proformaData.clientId)
          .single();
        if (leadData && leadData.client_country) {
          clientCountry = leadData.client_country;
        }
      }
      if (
        addVat &&
        clientCountry === 'IL' &&
        (currency === '₪' || currency === 'NIS' || currency === 'ILS')
      ) {
        vat = Math.round(total * 0.18 * 100) / 100;
      }
      const totalWithVat = addVat ? total + vat : total;
      // Ensure email/phone are present
      const email = proformaData.email || '';
      const phone = proformaData.phone || '';
      const proformaContent = JSON.stringify({
        ...proformaData,
        proformaName,
        total,
        vat,
        totalWithVat,
        createdAt: new Date().toISOString(),
        createdBy: userFullName || '',
        email,
        phone,
        addVat,
        currency,
      });
      const { error } = await supabase
        .from('payment_plans')
        .update({ proforma: proformaContent })
        .eq('id', paymentId);
      if (error) throw error;
      toast.success('Proforma created and saved successfully!');
      navigate(-1);
    } catch (error) {
      toast.error('Failed to save proforma. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  // Helper to get currency symbol
  const getCurrencySymbol = (currency: string | undefined) => {
    if (!currency) return '₪';
    if (currency === 'USD' || currency === '$') return '$';
    if (currency === 'ILS' || currency === 'NIS' || currency === '₪') return '₪';
    return currency;
  };

  if (loading || !proformaData) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen text-center">
        <DocumentTextIcon className="w-16 h-16 text-primary mb-4" />
        <div className="text-2xl font-bold text-gray-800 mb-2">Loading proforma...</div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto py-10 px-2 md:px-8">
      {/* Top bar with close/back button */}
      <div className="flex items-center mb-8">
        <button className="btn btn-ghost btn-lg mr-4" onClick={() => navigate(-1)}>
          <span className="sr-only">Back</span>X
        </button>
        <h2 className="text-3xl font-extrabold text-gray-900">Create Proforma</h2>
      </div>
      {/* Main two-column layout: left = editor, right = live preview */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_32rem] gap-8 items-start">
        {/* Left: All editing tools in one card */}
        <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-8 flex flex-col gap-8">
          {/* Invoice Items */}
          <h3 className="text-lg font-bold text-gray-800 mb-4">Invoice Items</h3>
          <div className="overflow-x-auto mb-4">
            <table className="table w-full min-w-[500px]">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="text-sm font-semibold text-gray-700">Description</th>
                    <th className="text-sm font-semibold text-gray-700">Qty</th>
                    <th className="text-sm font-semibold text-gray-700">Rate</th>
                    <th className="text-sm font-semibold text-gray-700">Total</th>
                    <th className="text-sm font-semibold text-gray-700">Actions</th>
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
                          placeholder="Item description"
                        />
                      </td>
                      <td>
                        <input 
                          className="input input-bordered w-16 text-base text-right py-3 px-4 no-arrows" 
                          type="number" 
                          value={row.qty} 
                          onChange={e => handleProformaRowChange(idx, 'qty', Number(e.target.value))}
                          inputMode="numeric"
                          pattern="[0-9]*"
                          style={{ MozAppearance: 'textfield' }}
                        />
                      </td>
                      <td>
                        <input 
                          className="input input-bordered w-32 text-base text-right py-3 px-4 no-arrows" 
                          type="number" 
                          value={row.rate} 
                          onChange={e => handleProformaRowChange(idx, 'rate', Number(e.target.value))}
                          inputMode="numeric"
                          pattern="[0-9]*"
                          style={{ MozAppearance: 'textfield' }}
                        />
                      </td>
                      <td>
                        <input className="input input-bordered w-32 text-base text-right font-semibold py-3 px-4 no-arrows" type="number" value={row.total} readOnly 
                          inputMode="numeric"
                          pattern="[0-9]*"
                          style={{ MozAppearance: 'textfield' }}
                        />
                      </td>
                      <td>
                        <button 
                          className="btn btn-ghost btn-xs text-red-500 hover:bg-red-50" 
                          onClick={() => handleDeleteProformaRow(idx)}
                        >
                          <XMarkIcon className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            <button 
              className="btn btn-outline btn-sm mt-4 text-blue-600 border-blue-300 hover:bg-blue-50" 
              onClick={handleAddProformaRow}
            >
              Add Row
            </button>
          </div>
          {/* Settings */}
          <h3 className="text-lg font-bold text-gray-800 mb-4">Settings</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div className="form-control">
              <label className="label cursor-pointer justify-start gap-3">
                <input 
                  type="checkbox" 
                  className="checkbox checkbox-primary" 
                  checked={proformaData.addVat} 
                  onChange={e => setProformaData((prev: any) => ({ ...prev, addVat: e.target.checked }))}
                />
                <span className="label-text font-medium">Add VAT (18%)</span>
              </label>
            </div>
            <div className="form-control">
              <label className="label">
                <span className="label-text font-medium">Bank Account</span>
              </label>
              <select 
                className="select select-bordered w-full" 
                value={proformaData.bankAccount} 
                onChange={e => setProformaData((prev: any) => ({ ...prev, bankAccount: e.target.value }))}
              >
                <option value="">Select account...</option>
                <option value="1">Account 1</option>
                <option value="2">Account 2</option>
              </select>
            </div>
          </div>
          {/* Notes */}
          <h3 className="text-lg font-bold text-gray-800 mb-4">Notes</h3>
          <textarea 
            className="textarea textarea-bordered w-full min-h-[120px] text-sm mb-4" 
            value={proformaData.notes} 
            onChange={e => setProformaData((prev: any) => ({ ...prev, notes: e.target.value }))}
            placeholder="Add any additional notes or terms..."
          />
          {/* Action buttons */}
          <div className="flex justify-end gap-4 mt-4">
            <button className="btn btn-outline" onClick={() => navigate(-1)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={handleSaveProforma} disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save Proforma'}
            </button>
          </div>
        </div>
        {/* Right: Classic Invoice Preview (matches ProformaViewPage) */}
        <div className="w-full bg-white border border-gray-200 rounded-2xl shadow-xl p-8 flex flex-col gap-6 min-h-[700px]">
          {/* Header with logo and title */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-8 border-b pb-6">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center border border-gray-200">
                {/* <img src="/logo.png" alt="Logo" className="w-14 h-14 object-contain" /> */}
                <span className="text-2xl font-bold text-primary">RMQ</span>
              </div>
              <div>
                <div className="text-3xl font-extrabold text-gray-900 tracking-tight leading-tight">Proforma Invoice</div>
                {/* Proforma number removed */}
              </div>
            </div>
            {/* Buttons removed */}
          </div>
          {/* Info section */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
            {/* Company Info */}
            <div className="mb-4">
              <div className="font-semibold text-gray-700 mb-1">Rainmaker Queen</div>
              <div className="text-sm text-gray-500">123 Main St, Tel Aviv</div>
              <div className="text-sm text-gray-500">+972-3-1234567</div>
              <div className="text-sm text-gray-500">info@rainmakerqueen.com</div>
            </div>
            <div>
              <div className="font-semibold text-gray-700 mb-1">Bill To:</div>
              <div className="text-lg font-bold text-gray-900">{proformaData.client}</div>
              {proformaData.phone && (
                <div className="text-sm text-gray-500">{proformaData.phone}</div>
              )}
              {proformaData.email && (
                <div className="text-sm text-gray-500">{proformaData.email}</div>
              )}
            </div>
            <div className="flex flex-col gap-1 md:items-end">
              <div><span className="font-semibold text-gray-700">Proforma #:</span> <span className="text-gray-900">{proformaData.proformaName || ''}</span></div>
              <div><span className="font-semibold text-gray-700">Date:</span> <span className="text-gray-900">{new Date().toLocaleDateString()}</span></div>
            </div>
          </div>
          {/* Table */}
          <div className="mb-8">
            <table className="min-w-full border rounded-xl overflow-hidden">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Description</th>
                  <th className="px-4 py-3 text-right text-xs font-bold text-gray-700 uppercase tracking-wider">Qty</th>
                  <th className="px-4 py-3 text-right text-xs font-bold text-gray-700 uppercase tracking-wider">Rate</th>
                  <th className="px-4 py-3 text-right text-xs font-bold text-gray-700 uppercase tracking-wider">Total</th>
                </tr>
              </thead>
              <tbody>
                {proformaData.rows.map((row: any, idx: number) => (
                  <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-4 py-2 text-gray-900 font-medium">{row.description}</td>
                    <td className="px-4 py-2 text-right">{row.qty}</td>
                    <td className="px-4 py-2 text-right">{getCurrencySymbol(proformaData.currency)} {row.rate}</td>
                    <td className="px-4 py-2 text-right font-bold">{getCurrencySymbol(proformaData.currency)} {row.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Totals summary */}
          <div className="flex flex-col md:flex-row md:justify-end gap-4 mb-6">
            <div className="w-full md:w-1/2 bg-gray-50 rounded-xl p-6 border border-gray-200">
              <div className="flex justify-between text-lg mb-2">
                <span className="font-semibold text-gray-700">Subtotal</span>
                <span className="font-bold text-gray-900">{getCurrencySymbol(proformaData.currency)} {proformaData.rows.reduce((sum: number, r: any) => sum + Number(r.total), 0)}</span>
              </div>
              {proformaData.addVat && (
                <div className="flex justify-between text-lg mb-2">
                  <span className="font-semibold text-gray-700">VAT (18%)</span>
                  <span className="font-bold text-gray-900">{getCurrencySymbol(proformaData.currency)} {(Math.round(proformaData.rows.reduce((sum: number, r: any) => sum + Number(r.total), 0) * 0.18 * 100) / 100).toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-xl mt-4 border-t pt-4 font-extrabold">
                <span>Total</span>
                <span className="text-primary">{getCurrencySymbol(proformaData.currency)} {proformaData.addVat ? (Math.round(proformaData.rows.reduce((sum: number, r: any) => sum + Number(r.total), 0) * 1.18 * 100) / 100).toFixed(2) : proformaData.rows.reduce((sum: number, r: any) => sum + Number(r.total), 0)}</span>
              </div>
            </div>
          </div>
          {/* Notes */}
          {proformaData.notes && (
            <div className="mt-6 p-4 bg-yellow-50 rounded-lg border-l-4 border-yellow-400 text-gray-700 italic">
              <span className="font-semibold">Notes:</span> {proformaData.notes}
            </div>
          )}
          {/* Created by at bottom left inside the card */}
          <div className="mt-8 text-xs text-gray-400 text-left">
            Created by: {userFullName || ''}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProformaCreatePage; 