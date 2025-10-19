import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { DocumentTextIcon, Cog6ToothIcon, ChartPieIcon, PlusIcon, ChatBubbleLeftRightIcon, XMarkIcon, CheckIcon, PrinterIcon, EnvelopeIcon, ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import { generateProformaName } from '../lib/proforma';

const ProformaLegacyCreatePage: React.FC = () => {
  const { leadId } = useParams<{ leadId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [lead, setLead] = useState<any>(null);
  const [proformaData, setProformaData] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [userFullName, setUserFullName] = useState<string | null>(null);

  useEffect(() => {
    const fetchLead = async () => {
      setLoading(true);
      
      console.log('🔍 Full URL:', window.location.href);
      console.log('🔍 Location search:', location.search);
      
      // Get ppr_id from URL parameters
      const urlParams = new URLSearchParams(location.search);
      const pprId = urlParams.get('ppr_id');
      
      console.log('🔍 ProformaLegacyCreate - pprId from URL:', pprId);
      
      // Fetch payment plan row description and order if ppr_id is available
      let paymentPlanDescription = '';
      let paymentPlanOrder = '';
      let pprData: any = null;
      
      if (pprId) {
        console.log('🔍 Fetching payment plan data for pprId:', pprId);
        
        // First, let's check if there are any records with this ID
        const { data: allRecords, error: allRecordsError } = await supabase
          .from('finances_paymentplanrow')
          .select('id, "order", notes')
          .eq('id', pprId);
        
        console.log('🔍 All records with this ID:', { allRecords, allRecordsError });
        
        const { data: fetchedPprData, error: pprError } = await supabase
          .from('finances_paymentplanrow')
          .select('"order", notes, value, value_base, vat_value, currency_id')
          .eq('id', pprId)
          .single();
        
        console.log('🔍 Payment plan data result:', { fetchedPprData, pprError });
        if (pprError) {
          console.error('❌ Payment plan query error:', pprError);
        }
        
        if (fetchedPprData) {
          pprData = fetchedPprData;
          console.log('🔍 Payment plan data:', { 
            notes: pprData.notes, 
            order: pprData.order,
            value: pprData.value,
            value_base: pprData.value_base,
            vat_value: pprData.vat_value,
            currency_id: pprData.currency_id
          });
          
          if (pprData.notes) {
            paymentPlanDescription = pprData.notes;
            console.log('🔍 Set paymentPlanDescription from notes:', paymentPlanDescription);
          }
          if (pprData.order) {
            // Map numeric order to text description (same logic as FinancesTab)
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
            paymentPlanOrder = getOrderText(pprData.order);
            console.log('🔍 Mapped order:', pprData.order, 'to:', paymentPlanOrder);
          }
        }
      } else {
        console.log('🔍 No pprId found in URL parameters');
      }
      
      const { data, error } = await supabase
        .from('leads_lead')
        .select(`
          *,
          accounting_currencies!leads_lead_currency_id_fkey (
            name,
            iso_code
          )
        `)
        .eq('id', leadId)
        .single();
      if (error) {
        toast.error('Failed to load lead details');
        setLoading(false);
        return;
      }
      setLead(data);
      
      // Fetch client contact info from leads_contact via lead_leadcontact
      let clientEmail = '';
      let clientPhone = '';
      
      try {
        // First, let's check what contacts exist for this lead
        const { data: allContacts } = await supabase
          .from('lead_leadcontact')
          .select(`
            main,
            contact_id
          `)
          .eq('lead_id', data.id);
        
        if (allContacts && allContacts.length > 0) {
          // Try different main field values
          let leadContacts = null;
          
          const { data: contactsTrue } = await supabase
            .from('lead_leadcontact')
            .select(`
              main,
              contact_id
            `)
            .eq('lead_id', data.id)
            .eq('main', 'true')
            .limit(1);
          
          if (contactsTrue && contactsTrue.length > 0) {
            leadContacts = contactsTrue;
          } else {
            const { data: contactsBool } = await supabase
              .from('lead_leadcontact')
              .select(`
                main,
                contact_id
              `)
              .eq('lead_id', data.id)
              .eq('main', true)
              .limit(1);
            
            if (contactsBool && contactsBool.length > 0) {
              leadContacts = contactsBool;
            } else {
              const { data: contactsNum } = await supabase
                .from('lead_leadcontact')
                .select(`
                  main,
                  contact_id
                `)
                .eq('lead_id', data.id)
                .eq('main', 1)
                .limit(1);
              
              leadContacts = contactsNum;
            }
          }
          
          if (leadContacts && leadContacts.length > 0) {
            const { data: contactData } = await supabase
              .from('leads_contact')
              .select('email, phone')
              .eq('id', leadContacts[0].contact_id)
              .single();
            
            if (contactData) {
              clientEmail = contactData.email || '';
              clientPhone = contactData.phone || '';
            }
          } else if (allContacts && allContacts.length > 0) {
            // Fallback: use first available contact
            const { data: contactData } = await supabase
              .from('leads_contact')
              .select('email, phone')
              .eq('id', allContacts[0].contact_id)
              .single();
            
            if (contactData) {
              clientEmail = contactData.email || '';
              clientPhone = contactData.phone || '';
            }
          }
        }
      } catch (contactError) {
        // Error handling - contact data will remain empty
      }
      
      console.log('🔍 Final description values:', {
        pprId,
        paymentPlanOrder,
        paymentPlanDescription,
        leadDescription: data.description,
        finalDescription: paymentPlanOrder || paymentPlanDescription || data.description || 'Legal Services'
      });
      
      // Determine currency and amounts - prioritize payment plan data over lead data
      const currencyId = pprData?.currency_id || data.currency_id;
      const paymentAmount = pprData?.value ? Number(pprData.value) : (data.total || 0);
      const baseAmount = pprData?.value_base ? Number(pprData.value_base) : (data.total || 0);
      const vatAmount = pprData?.vat_value ? Number(pprData.vat_value) : 0;
      
      // Get currency symbol - use accounting_currencies data if available, otherwise fallback to mapping
      let currencySymbol = '₪'; // Default
      if (data.accounting_currencies) {
        currencySymbol = data.accounting_currencies.name || data.accounting_currencies.iso_code || '₪';
      } else {
        currencySymbol = getCurrencySymbol(currencyId);
      }
      
      console.log('🔍 Currency info:', {
        leadCurrencyId: data.currency_id,
        paymentPlanCurrencyId: pprData?.currency_id,
        finalCurrencyId: currencyId,
        accountingCurrency: data.accounting_currencies,
        currencySymbol: currencySymbol
      });
      
      console.log('🔍 Amount info:', {
        leadTotal: data.total,
        paymentPlanValue: pprData?.value,
        paymentPlanValueBase: pprData?.value_base,
        paymentPlanVatValue: pprData?.vat_value,
        finalPaymentAmount: paymentAmount,
        finalBaseAmount: baseAmount,
        finalVatAmount: vatAmount
      });
      
      setProformaData({
        client: data.name || 'Client',
        clientId: data.id,
        leadId: data.id,
        pprId: pprId, // Store the payment plan row ID
        payment: paymentAmount,
        base: baseAmount,
        vat: vatAmount,
        language: 'EN',
        rows: [
          { description: paymentPlanOrder || paymentPlanDescription || data.description || 'Legal Services', qty: 1, rate: paymentAmount, total: paymentAmount },
        ],
        addVat: vatAmount > 0, // Only add VAT if there's a VAT amount from the payment plan
        currency: currencySymbol,
        bankAccount: '',
        notes: '',
        email: clientEmail,
        phone: clientPhone,
      });
      setLoading(false);
    };
    if (leadId) fetchLead();
  }, [leadId]);

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
      const totalBase = total;
      
      // Calculate VAT if needed
      let vat = 0;
      if (proformaData.addVat) {
        vat = Math.round(total * 0.18 * 100) / 100;
      }
      const totalWithVat = total + vat;

      // Prepare rows data
      const rowsData = proformaData.rows.map((row: any) => ({
        description: row.description,
        qty: Number(row.qty),
        rate: Number(row.rate),
        total: Number(row.total)
      }));

      // Create proforma using the function we created in SQL
      const { data, error } = await supabase.rpc('create_proforma_with_rows', {
        p_lead_id: parseInt(leadId!),
        p_total: totalWithVat,
        p_total_base: totalBase,
        p_vat_value: vat,
        p_notes: proformaData.notes,
        p_sub_total: totalBase,
        p_add_vat: proformaData.addVat ? 't' : 'f',
        p_currency_id: 1, // Default to Israeli Shekel
        p_client_id: null,
        p_bank_account_id: null,
        p_ppr_id: proformaData.pprId ? parseInt(proformaData.pprId) : null,
        p_rows: JSON.stringify(rowsData)
      });

      if (error) throw error;

      toast.success('Proforma created and saved successfully!');
      navigate(-1);
    } catch (error) {
      console.error('Error saving proforma:', error);
      toast.error('Failed to save proforma. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  // Helper to get currency symbol
  const getCurrencySymbol = (currencyId: string | number | undefined) => {
    if (!currencyId) return '₪';
    
    // Convert to number if it's a string
    const id = typeof currencyId === 'string' ? parseInt(currencyId) : currencyId;
    
    // Map currency IDs to symbols (based on common currency ID mappings)
    switch (id) {
      case 1: return '₪'; // NIS/ILS
      case 2: return '$'; // USD
      case 3: return '€'; // EUR
      case 4: return '£'; // GBP
      default: return '₪'; // Default to NIS
    }
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
      <div className="grid grid-cols-1 2xl:grid-cols-[1fr_28rem] gap-6 2xl:gap-8 items-start">
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
        {/* Right: Classic Invoice Preview */}
        <div className="w-full bg-white border border-gray-200 rounded-2xl shadow-xl p-3 md:p-6 lg:p-8 flex flex-col gap-4 md:gap-6 min-h-[700px] overflow-hidden">
          {/* Header with logo and title */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 md:mb-8 border-b pb-4 md:pb-6">
            <div className="flex items-center gap-3 md:gap-4">
              <div className="w-12 h-12 md:w-16 md:h-16 rounded-full flex items-center justify-center flex-shrink-0">
                <img src="/dpl_logo2.jpg" alt="DPL Logo" className="w-full h-full object-contain rounded-full" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xl md:text-2xl lg:text-3xl font-extrabold text-gray-900 tracking-tight leading-tight">Proforma Invoice</div>
              </div>
            </div>
          </div>
          {/* Info section */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 lg:gap-8 mb-6 md:mb-8">
            {/* Company Info */}
            <div className="mb-4">
              <div className="font-semibold text-gray-700 mb-1">From:</div>
              <div className="font-bold text-gray-900">Decker Pex Levi Law office</div>
              <div className="text-sm text-gray-500">Yad Haruzim 10, Jerusalem;</div>
              <div className="text-sm text-gray-500">150 Begin Rd. Tel-Aviv, Israel</div>
              <div className="text-sm text-gray-500">Phone: +972737895444, +972262914009</div>
              <div className="text-sm text-gray-500">PaymentReport3@lawoffice.org.il</div>
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
              {proformaData.clientId && (
                <div className="text-sm text-gray-500 font-semibold">Lead #: {proformaData.clientId}</div>
              )}
              {!(proformaData.phone || proformaData.email) && (
                <div className="text-xs text-red-400">No client phone/email found.</div>
              )}
            </div>
          </div>
          {/* Proforma number and date row */}
          <div className="flex flex-col sm:flex-row sm:justify-between items-start sm:items-center gap-2 mb-6 md:mb-8">
            <div><span className="font-semibold text-gray-700">Proforma #:</span> <span className="text-gray-900">{leadId}</span></div>
            <div><span className="font-semibold text-gray-700">Date:</span> <span className="text-gray-900">{new Date().toLocaleDateString()}</span></div>
          </div>
          {/* Table */}
          <div className="mb-6 md:mb-8 overflow-x-auto">
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
                    <td className="px-4 py-2 text-right">{proformaData.currency} {row.rate}</td>
                    <td className="px-4 py-2 text-right font-bold">{proformaData.currency} {row.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Totals summary */}
          <div className="flex flex-col sm:flex-row sm:justify-end gap-4 mb-6">
            <div className="w-full sm:w-full md:w-4/5 lg:w-3/4 xl:w-2/3 bg-gray-50 rounded-xl p-4 md:p-6 border border-gray-200">
              <div className="flex justify-between text-lg mb-2">
                <span className="font-semibold text-gray-700">Subtotal</span>
                <span className="font-bold text-gray-900">{proformaData.currency} {proformaData.rows.reduce((sum: number, r: any) => sum + Number(r.total), 0)}</span>
              </div>
              {proformaData.addVat && (
                <div className="flex justify-between text-lg mb-2">
                  <span className="font-semibold text-gray-700">VAT (18%)</span>
                  <span className="font-bold text-gray-900">{proformaData.currency} {(Math.round(proformaData.rows.reduce((sum: number, r: any) => sum + Number(r.total), 0) * 0.18 * 100) / 100).toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-xl mt-4 border-t pt-4 font-extrabold">
                <span>Total</span>
                <span style={{ color: '#006BB1' }}>{proformaData.currency} {proformaData.addVat ? (Math.round(proformaData.rows.reduce((sum: number, r: any) => sum + Number(r.total), 0) * 1.18 * 100) / 100).toFixed(2) : proformaData.rows.reduce((sum: number, r: any) => sum + Number(r.total), 0)}</span>
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

export default ProformaLegacyCreatePage;
