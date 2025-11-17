import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { BanknotesIcon } from '@heroicons/react/24/solid';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { CheckCircleIcon, ExclamationTriangleIcon, XCircleIcon } from '@heroicons/react/24/solid';
import { PencilSquareIcon } from '@heroicons/react/24/outline';

type MainCategory = {
  id: string;
  name: string;
};

type Filters = {
  fromDate: string;
  toDate: string;
  collected: 'all' | 'yes' | 'no_with_proforma' | 'no_without_proforma';
  categoryId: string;
  order: string;
  due: 'ignore' | 'due_only';
};

type PaymentRow = {
  id: string;
  leadId: string;
  leadName: string;
  clientName: string;
  amount: number;
  value: number;
  vat: number;
  currency: string;
  orderCode: string;
  orderLabel: string;
  collected: boolean;
  hasProforma: boolean;
  collectedDate: string | null;
  dueDate: string | null;
  handlerName: string;
  handlerId?: number | null;
  caseNumber: string;
  categoryName: string;
  notes: string;
  mainCategoryId?: string;
  leadType: 'new' | 'legacy';
};

const collectedOptions = [
  { value: 'all', label: 'All' },
  { value: 'yes', label: 'Yes' },
  { value: 'no_with_proforma', label: 'No - With Proforma' },
  { value: 'no_without_proforma', label: 'No - Without Proforma' },
] as const;

const dueOptions = [
  { value: 'ignore', label: 'Ignore' },
  { value: 'due_only', label: 'Due date included' },
] as const;

const orderOptions: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: '1', label: 'First Payment' },
  { value: '5', label: 'Intermediate Payment' },
  { value: '9', label: 'Final Payment' },
  { value: '90', label: 'Single Payment' },
  { value: '99', label: 'Expense (no VAT)' },
];

const formatCurrency = (value: number, currency: string) => {
  const normalized = currency === '₪' ? 'ILS' : currency === '€' ? 'EUR' : currency === '$' ? 'USD' : currency?.length === 3 ? currency : 'ILS';
  const locale = normalized === 'USD' ? 'en-US' : 'en-GB';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: normalized,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency || ''}${value.toLocaleString()}`;
  }
};

const todayIso = new Date().toISOString().split('T')[0];

const CollectionFinancesReport: React.FC = () => {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<Filters>({
    fromDate: todayIso,
    toDate: todayIso,
    collected: 'all',
    categoryId: '',
    order: '',
    due: 'ignore',
  });
  const [categories, setCategories] = useState<MainCategory[]>([]);
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [handlerOptions, setHandlerOptions] = useState<{ id: number; name: string }[]>([]);
  const [handlerEdit, setHandlerEdit] = useState<{ rowId: string; value: string } | null>(null);
  const [notesEdit, setNotesEdit] = useState<{ rowId: string; value: string } | null>(null);
  const [savingHandler, setSavingHandler] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);

  useEffect(() => {
    const fetchCategories = async () => {
      const { data, error } = await supabase.from('misc_maincategory').select('id, name').order('name', { ascending: true });
      if (error) {
        console.error('Failed to load categories', error);
        return;
      }
      setCategories((data || []).map((cat) => ({ id: cat.id.toString(), name: cat.name })));
    };

    fetchCategories();
    const fetchHandlers = async () => {
      const { data, error } = await supabase.from('tenants_employee').select('id, display_name').order('display_name', { ascending: true });
      if (error) {
        console.error('Failed to load handlers', error);
        return;
      }
      setHandlerOptions(
        (data || []).map((emp) => ({
          id: emp.id,
          name: emp.display_name || `Employee #${emp.id}`,
        })),
      );
    };
    fetchHandlers();
  }, []);

  const handleFilterChange = (field: keyof Filters, value: string) => {
    setFilters((prev) => ({ ...prev, [field]: value }));
  };

const loadPayments = async () => {
    setLoading(true);
    setError(null);
    try {
      const [modern, legacy] = await Promise.all([fetchModernPayments(filters), fetchLegacyPayments(filters)]);
      const combined = [...modern, ...legacy];
      const legacyProformaSet = await fetchLegacyProformaStatus(combined);
      const withProforma = combined.map((row) =>
        row.leadType === 'legacy' ? { ...row, hasProforma: legacyProformaSet.has(row.leadId) } : row,
      );
      const filtered = withProforma.filter((row) => {
        if (filters.categoryId && row.mainCategoryId !== filters.categoryId) {
          return false;
        }
        if (filters.collected === 'yes' && !row.collected) return false;
        if (filters.collected === 'no_with_proforma' && (row.collected || !row.hasProforma)) return false;
        if (filters.collected === 'no_without_proforma' && (row.collected || row.hasProforma)) return false;
        if (filters.order && filters.order !== '') {
          if (row.orderCode !== filters.order) return false;
        }
        if (filters.due === 'due_only' && row.dueDate) {
          const due = new Date(row.dueDate).getTime();
          const limit = filters.toDate ? new Date(filters.toDate).getTime() : new Date().getTime();
          if (due > limit) return false;
        }
        return true;
      });
      filtered.sort((a, b) => {
        const aDate = a.collectedDate || a.dueDate || '';
        const bDate = b.collectedDate || b.dueDate || '';
        return bDate.localeCompare(aDate);
      });
      setRows(filtered);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to load collection data.');
    } finally {
      setLoading(false);
    }
  };

  const totals = useMemo(() => {
    const estimated = rows.reduce((sum, row) => sum + row.amount, 0);
    const collected = rows.reduce((sum, row) => (row.collected ? sum + row.amount : sum), 0);
    return {
      estimated,
      collected,
    };
  }, [rows]);

  const handleSaveHandler = async (rowId: string) => {
    if (!handlerEdit || handlerEdit.rowId !== rowId) {
      return;
    }
    const row = rows.find((r) => r.id === rowId);
    if (!row) return;
    const handlerIdValue = handlerEdit.value ? Number(handlerEdit.value) : null;
    if (handlerEdit.value && Number.isNaN(handlerIdValue)) {
      setError('Please select a valid handler.');
      return;
    }
    setSavingHandler(true);
    try {
      let updateError;
      if (row.leadType === 'legacy') {
        const legacyId = parseLegacyLeadId(row.leadId);
        if (legacyId === null) {
          throw new Error('Invalid legacy lead id');
        }
        const { error } = await supabase.from('leads_lead').update({ case_handler_id: handlerIdValue }).eq('id', legacyId);
        updateError = error;
      } else {
        const { error } = await supabase.from('leads').update({ case_handler_id: handlerIdValue }).eq('id', row.leadId);
        updateError = error;
      }
      if (updateError) {
        throw updateError;
      }
      const nextName = handlerIdValue ? handlerOptions.find((opt) => opt.id === handlerIdValue)?.name || '—' : '—';
      setRows((prev) =>
        prev.map((r) =>
          r.id === rowId
            ? {
                ...r,
                handlerName: nextName,
                handlerId: handlerIdValue,
              }
            : r,
        ),
      );
      setHandlerEdit(null);
    } catch (err) {
      console.error('Failed to update handler', err);
      setError(err instanceof Error ? err.message : 'Failed to update handler.');
    } finally {
      setSavingHandler(false);
    }
  };

  const handleSaveNotes = async (rowId: string) => {
    if (!notesEdit || notesEdit.rowId !== rowId) {
      return;
    }
    const row = rows.find((r) => r.id === rowId);
    if (!row) return;
    setSavingNotes(true);
    try {
      const ref = resolvePaymentRecord(row.id);
      const { error } = await supabase.from(ref.table).update({ notes: notesEdit.value }).eq('id', ref.id);
      if (error) {
        throw error;
      }
      setRows((prev) =>
        prev.map((r) =>
          r.id === rowId
            ? {
                ...r,
                notes: notesEdit.value,
              }
            : r,
        ),
      );
      setNotesEdit(null);
    } catch (err) {
      console.error('Failed to update notes', err);
      setError(err instanceof Error ? err.message : 'Failed to update notes.');
    } finally {
      setSavingNotes(false);
    }
  };

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <BanknotesIcon className="w-10 h-10 text-primary" />
            Collection Finances Report
          </h1>
          <p className="text-gray-500 mt-1">Track estimated and collected payments across all leads.</p>
        </div>
        <button className="btn btn-outline" onClick={() => navigate('/reports')}>
          Back to Reports
        </button>
      </div>

      <div className="card bg-base-100 shadow-lg p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <div className="form-control">
            <label className="label"><span className="label-text">From date</span></label>
            <input type="date" className="input input-bordered" value={filters.fromDate} onChange={(e) => handleFilterChange('fromDate', e.target.value)} />
          </div>
          <div className="form-control">
            <label className="label"><span className="label-text">To date</span></label>
            <input type="date" className="input input-bordered" value={filters.toDate} onChange={(e) => handleFilterChange('toDate', e.target.value)} />
          </div>
          <div className="form-control">
            <label className="label"><span className="label-text">Collected</span></label>
            <select className="select select-bordered" value={filters.collected} onChange={(e) => handleFilterChange('collected', e.target.value as Filters['collected'])}>
              {collectedOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="form-control">
            <label className="label"><span className="label-text">Category</span></label>
            <select className="select select-bordered" value={filters.categoryId} onChange={(e) => handleFilterChange('categoryId', e.target.value)}>
              <option value="">All</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </div>
          <div className="form-control">
            <label className="label"><span className="label-text">Order</span></label>
            <select className="select select-bordered" value={filters.order} onChange={(e) => handleFilterChange('order', e.target.value)}>
              {orderOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="form-control">
            <label className="label"><span className="label-text">Due</span></label>
            <select className="select select-bordered" value={filters.due} onChange={(e) => handleFilterChange('due', e.target.value as Filters['due'])}>
              {dueOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <button className="btn btn-primary" onClick={loadPayments} disabled={loading}>
            {loading ? <ArrowPathIcon className="w-5 h-5 animate-spin" /> : 'Show'}
          </button>
          {error && <span className="text-error">{error}</span>}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white border border-gray-200 p-4 rounded-xl">
          <p className="text-sm text-green-600">Total Estimated</p>
          <p className="text-3xl font-bold text-green-800">{formatCurrency(totals.estimated, '₪')}</p>
        </div>
        <div className="bg-white border border-gray-200 p-4 rounded-xl">
          <p className="text-sm text-emerald-600">Total Collected</p>
          <p className="text-3xl font-bold text-emerald-800">{formatCurrency(totals.collected, '₪')}</p>
        </div>
      </div>

      <div className="card bg-base-100 shadow-lg">
        <div className="overflow-x-auto">
          <table className="table w-full">
            <thead>
              <tr>
                <th>Lead Name</th>
                <th>Client</th>
                <th>Amount</th>
                <th>Order</th>
                <th>Collected</th>
                <th>Date</th>
                <th>Handler</th>
                <th>Case</th>
                <th>Category</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !loading && (
                <tr>
                  <td colSpan={10} className="text-center py-6 text-gray-500">No payments found for the selected filters.</td>
                </tr>
              )}
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <Link to={buildLeadLink(row)} className="link link-primary">
                      {row.leadName}
                    </Link>
                  </td>
                  <td>{row.clientName || row.leadName || '—'}</td>
                  <td className="font-semibold">{formatCurrency(row.amount, row.currency)}</td>
                  <td>{row.orderLabel || '—'}</td>
                  <td>
                    {row.collected ? (
                      <span className="inline-flex items-center gap-2 text-green-600 font-semibold">
                        <CheckCircleIcon className="w-5 h-5" />
                        Collected
                      </span>
                    ) : row.hasProforma ? (
                      <span className="inline-flex items-center gap-2 text-yellow-600 font-semibold">
                        <ExclamationTriangleIcon className="w-5 h-5" />
                        Pending (Proforma)
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-2 text-red-600 font-semibold">
                        <XCircleIcon className="w-5 h-5" />
                        Pending
                      </span>
                    )}
                  </td>
                  <td>
                    {row.dueDate ? new Date(row.dueDate).toLocaleDateString() : '—'}
                  </td>
                  <td>
                    {handlerEdit?.rowId === row.id ? (
                      <div className="flex flex-col gap-2 max-w-xs">
                        <select
                          className="select select-bordered select-sm"
                          value={handlerEdit?.value ?? ''}
                          onChange={(e) => setHandlerEdit({ rowId: row.id, value: e.target.value })}
                          disabled={savingHandler}
                        >
                          <option value="">Unassigned</option>
                          {handlerOptions.map((opt) => (
                            <option key={opt.id} value={opt.id.toString()}>
                              {opt.name}
                            </option>
                          ))}
                        </select>
                        <div className="flex gap-2">
                          <button className="btn btn-xs btn-primary" onClick={() => handleSaveHandler(row.id)} disabled={savingHandler}>
                            {savingHandler ? <ArrowPathIcon className="w-4 h-4 animate-spin" /> : 'Save'}
                          </button>
                          <button className="btn btn-xs" onClick={() => setHandlerEdit(null)} disabled={savingHandler}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span>{row.handlerName || '—'}</span>
                        <button
                          className="btn btn-ghost btn-xs"
                          onClick={() => setHandlerEdit({ rowId: row.id, value: row.handlerId ? row.handlerId.toString() : '' })}
                          aria-label="Edit handler"
                        >
                          <PencilSquareIcon className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </td>
                  <td>{row.caseNumber || '—'}</td>
                  <td>{row.categoryName || '—'}</td>
                  <td className="max-w-xs" title={row.notes || ''}>
                    {notesEdit?.rowId === row.id ? (
                      <div className="flex flex-col gap-2">
                        <textarea
                          className="textarea textarea-bordered textarea-sm"
                          value={notesEdit?.value ?? ''}
                          onChange={(e) => setNotesEdit({ rowId: row.id, value: e.target.value })}
                          disabled={savingNotes}
                        />
                        <div className="flex gap-2">
                          <button className="btn btn-xs btn-primary" onClick={() => handleSaveNotes(row.id)} disabled={savingNotes}>
                            {savingNotes ? <ArrowPathIcon className="w-4 h-4 animate-spin" /> : 'Save'}
                          </button>
                          <button className="btn btn-xs" onClick={() => setNotesEdit(null)} disabled={savingNotes}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-2">
                        <span className="flex-1 truncate">{row.notes || '—'}</span>
                        <button
                          className="btn btn-ghost btn-xs"
                          onClick={() => setNotesEdit({ rowId: row.id, value: row.notes || '' })}
                          aria-label="Edit notes"
                        >
                          <PencilSquareIcon className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default CollectionFinancesReport;

async function fetchModernPayments(filters: Filters): Promise<PaymentRow[]> {
  let query = supabase
    .from('payment_plans')
    .select('id, lead_id, value, value_vat, currency, due_date, payment_order, notes, paid, paid_at, proforma, client_name, cancel_date');

  if (filters.fromDate) {
    query = query.gte('due_date', filters.fromDate);
  }
  if (filters.toDate) {
    query = query.lte('due_date', filters.toDate);
  }

  const { data, error } = await query;
  if (error) throw error;

  const activePlans = (data || []).filter((plan: any) => !plan.cancel_date);
  const leadIds = Array.from(new Set(activePlans.map((row) => (row.lead_id ?? '').toString()).filter(Boolean)));
  const leadMeta = await fetchLeadMetadata(leadIds, false);

  return activePlans.map((plan: any) => {
    const key = plan.lead_id?.toString?.() || '';
    const meta = leadMeta.get(key) || null;
    const value = Number(plan.value || 0);
    let vat = Number(plan.value_vat || 0);
    if (!vat && (plan.currency || '₪') === '₪') {
      vat = Math.round(value * 0.18 * 100) / 100;
    }
    const amount = value + vat;
    const hasProforma = hasProformaValue(plan.proforma);
    const orderCode = normalizeOrderCode(plan.payment_order);
    const paidAt = normalizeDate(plan.paid_at);
    const dueDate = normalizeDate(plan.due_date);
    return {
      id: `new-${plan.id}`,
      leadId: key,
      leadName: meta?.leadName || plan.client_name || 'Unknown lead',
      clientName: meta?.contactName || meta?.clientName || meta?.leadName || plan.client_name || '—',
      amount,
      value,
      vat,
      currency: plan.currency || '₪',
      orderCode,
      orderLabel: mapOrderLabel(orderCode, plan.payment_order),
      collected: Boolean(paidAt || plan.paid),
      hasProforma,
      collectedDate: paidAt,
      dueDate,
      handlerName: meta?.handlerName || '—',
      handlerId: meta?.handlerId ?? null,
      caseNumber: meta?.caseNumber || (plan.lead_id ? `#${plan.lead_id}` : '—'),
      categoryName: meta?.categoryName || '—',
      notes: plan.notes || '',
      mainCategoryId: meta?.mainCategoryId,
      leadType: 'new',
    };
  });
}

async function fetchLegacyPayments(filters: Filters): Promise<PaymentRow[]> {
  let query = supabase
    .from('finances_paymentplanrow')
    .select(
      'id, lead_id, value, vat_value, currency_id, due_date, date, order, notes, actual_date, cancel_date, accounting_currencies!finances_paymentplanrow_currency_id_fkey(name, iso_code)',
    );

  if (filters.fromDate) {
    query = query.gte('date', filters.fromDate);
  }
  if (filters.toDate) {
    query = query.lte('date', filters.toDate);
  }

  const { data, error } = await query;
  if (error) throw error;

  const activePlans = (data || []).filter((plan: any) => !plan.cancel_date);
  const leadIds = Array.from(new Set(activePlans.map((row) => (row.lead_id ?? '').toString()).filter(Boolean)));
  const leadMeta = await fetchLeadMetadata(leadIds, true);

  return activePlans.map((plan: any) => {
    const key = plan.lead_id?.toString?.() || '';
    const meta = leadMeta.get(key) || null;
    const value = Number(plan.value || 0);
    let vat = Number(plan.vat_value || 0);
    const currency = plan.accounting_currencies?.name || mapCurrencyId(plan.currency_id);
    if ((!vat || vat === 0) && currency === '₪') {
      vat = Math.round(value * 0.18 * 100) / 100;
    }

    const amount = value + vat;
    const orderCode = normalizeOrderCode(plan.order);
    const dueSource = plan.due_date || plan.date;
    const dueDate = normalizeDate(dueSource);
    const actualDate = normalizeDate(plan.actual_date);
    return {
      id: `legacy-${plan.id}`,
      leadId: `legacy_${plan.lead_id}`,
      leadName: meta?.leadName || meta?.clientName || `Lead #${plan.lead_id}`,
      clientName: meta?.contactName || meta?.clientName || meta?.leadName || `Lead #${plan.lead_id}`,
      amount,
      value,
      vat,
      currency,
      orderCode,
      orderLabel: mapOrderLabel(orderCode, plan.order),
      collected: Boolean(actualDate),
      hasProforma: false,
      collectedDate: actualDate,
      dueDate,
      handlerName: meta?.handlerName || '—',
      handlerId: meta?.handlerId ?? null,
      caseNumber: meta?.caseNumber || `#${plan.lead_id}`,
      categoryName: meta?.categoryName || '—',
      notes: plan.notes || '',
      mainCategoryId: meta?.mainCategoryId,
      leadType: 'legacy',
    };
  });
}

function mapCurrencyId(currencyId?: number | null) {
  switch (currencyId) {
    case 2:
      return '€';
    case 3:
      return '$';
    case 4:
      return '£';
    default:
      return '₪';
  }
}

function normalizeOrderCode(order: string | number | null | undefined): string {
  if (order === null || order === undefined) return '';
  const raw = order.toString().trim();
  if (!raw) return '';
  if (!Number.isNaN(Number(raw))) {
    return raw;
  }
  switch (raw.toLowerCase()) {
    case 'first payment':
      return '1';
    case 'intermediate payment':
      return '5';
    case 'final payment':
      return '9';
    case 'single payment':
      return '90';
    case 'expense (no vat)':
      return '99';
    default:
      return raw;
  }
}

function mapOrderLabel(orderCode?: string, fallback?: string | number | null) {
  const normalized = orderCode || normalizeOrderCode(fallback ?? '');
  const option = orderOptions.find((opt) => opt.value === normalized);
  if (option) return option.label;
  if (fallback && fallback.toString().trim()) return fallback.toString();
  return 'Payment';
}

function hasProformaValue(value: any): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || trimmed.toLowerCase() === 'null' || trimmed === '{}') return false;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && Object.keys(parsed).length === 0) {
        return false;
      }
    } catch {
      // ignore parse error, treat as truthy string
    }
    return true;
  }
  if (typeof value === 'object') {
    return Object.keys(value).length > 0;
  }
  return Boolean(value);
}

type LeadMeta = {
  id: string;
  leadName: string;
  clientName: string;
  caseNumber: string;
  handlerName: string;
  handlerId?: number | null;
  categoryName: string;
  mainCategoryId?: string;
  contactName?: string;
};

async function fetchLeadMetadata(ids: (number | string | null)[], isLegacy: boolean): Promise<Map<string, LeadMeta>> {
  const normalizedIds = Array.from(
    new Set(ids.filter((id): id is string | number => id !== null && id !== undefined)),
  ).map((id) => id.toString());
  const map = new Map<string, LeadMeta>();
  if (!normalizedIds.length) return map;

  if (isLegacy) {
    const numericIds = normalizedIds.map((id) => parseInt(id, 10)).filter((id) => !Number.isNaN(id));
    if (!numericIds.length) return map;
    const { data, error } = await supabase
      .from('leads_lead')
      .select('id, name, anchor_full_name, lead_number, case_handler_id, category, category_id')
      .in('id', numericIds);
    if (error) throw error;
    const categoryMap = await fetchCategoryMap((data || []).map((lead) => lead.category_id).filter(Boolean));
    const legacyHandlerIds = (data || [])
      .map((lead) => normalizeHandlerId(lead.case_handler_id))
      .filter((id): id is number => id !== null);
    const handlerMap = await fetchHandlerNames(legacyHandlerIds);
    const contactMap = await fetchContactNameMap(normalizedIds, true);
    (data || []).forEach((lead) => {
      const key = lead.id?.toString();
      if (!key) return;
      const cat = categoryMap.get(lead.category_id ?? null);
      const contactName = contactMap.get(key);
      const handlerId = normalizeHandlerId(lead.case_handler_id);
      map.set(key, {
        id: key,
        leadName: lead.name || lead.anchor_full_name || contactName || `Lead #${lead.id}`,
        clientName: contactName || lead.anchor_full_name || lead.name || `Lead #${lead.id}`,
        caseNumber: `#${lead.lead_number || lead.id}`,
        handlerName: handlerId !== null ? handlerMap.get(handlerId) || '—' : '—',
        handlerId,
        categoryName: cat?.mainCategoryName || cat?.name || lead.category || '—',
        mainCategoryId: cat?.mainCategoryId,
        contactName: contactName || lead.anchor_full_name || lead.name,
      });
    });
    return map;
  }

  const { data, error } = await supabase
    .from('leads')
    .select('id, name, lead_number, anchor_full_name, case_handler_id, category_id, category')
    .in('id', normalizedIds);
  if (error) throw error;
  const categoryMap = await fetchCategoryMap((data || []).map((lead) => lead.category_id).filter(Boolean));
  const handlerIds = (data || [])
    .map((lead) => normalizeHandlerId(lead.case_handler_id))
    .filter((id): id is number => id !== null);
  const handlerMap = await fetchHandlerNames(handlerIds);
  const contactMap = await fetchContactNameMap(normalizedIds, false);
  (data || []).forEach((lead) => {
    const key = lead.id?.toString();
    if (!key) return;
    const contactName = contactMap.get(key);
    const categoryMeta = categoryMap.get(lead.category_id ?? null);
    const handlerId = normalizeHandlerId(lead.case_handler_id);
    map.set(key, {
      id: key,
      leadName: lead.name || lead.anchor_full_name || contactName || `Lead #${lead.id}`,
      clientName: contactName || lead.anchor_full_name || lead.name || `Lead #${lead.id}`,
      caseNumber: lead.lead_number ? `#${lead.lead_number}` : `#${lead.id}`,
      handlerName: handlerId !== null ? handlerMap.get(handlerId) || '—' : '—',
      handlerId,
      categoryName: categoryMeta?.mainCategoryName || categoryMeta?.name || lead.category || '—',
      mainCategoryId: categoryMeta?.mainCategoryId,
      contactName: contactName || lead.anchor_full_name || lead.name,
    });
  });
  return map;
}

type CategoryMeta = { id: number; name: string; mainCategoryId?: string; mainCategoryName?: string };

async function fetchCategoryMap(categoryIds: (number | null | undefined)[]): Promise<Map<number, CategoryMeta>> {
  const ids = Array.from(new Set(categoryIds.filter((id): id is number => typeof id === 'number')));
  const map = new Map<number, CategoryMeta>();
  if (!ids.length) return map;
  const { data, error } = await supabase
    .from('misc_category')
    .select('id, name, misc_maincategory:parent_id (id, name)')
    .in('id', ids);
  if (error) {
    console.error('Failed to fetch categories', error);
    return map;
  }
  (data as any[] | null | undefined)?.forEach((cat) => {
    const id = typeof cat.id === 'number' ? cat.id : parseInt(cat.id, 10);
    if (Number.isNaN(id)) return;
    const mainCategory = Array.isArray(cat.misc_maincategory) ? cat.misc_maincategory[0] : cat.misc_maincategory;
    map.set(id, {
      id,
      name: cat.name,
      mainCategoryId: mainCategory?.id?.toString(),
      mainCategoryName: mainCategory?.name,
    });
  });
  return map;
}

async function fetchHandlerNames(handlerIds: number[]): Promise<Map<number, string>> {
  const ids = Array.from(new Set(handlerIds));
  const map = new Map<number, string>();
  if (!ids.length) return map;
  const { data, error } = await supabase.from('tenants_employee').select('id, display_name').in('id', ids);
  if (error) {
    console.error('Failed to fetch handler names', error);
    return map;
  }
  (data || []).forEach((emp) => {
    map.set(emp.id, emp.display_name || `Employee #${emp.id}`);
  });
  return map;
}

async function fetchContactNameMap(ids: string[], isLegacy: boolean): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!ids.length) return map;

  const column = isLegacy ? 'lead_id' : 'newlead_id';
  const { data, error } = await supabase
    .from('lead_leadcontact')
    .select(`${column}, main, leads_contact:contact_id(name)`)
    .eq('main', 'true')
    .in(column, isLegacy ? ids.map((id) => parseInt(id, 10)).filter((id) => !Number.isNaN(id)) : ids);

  if (error) {
    console.error('Failed to fetch contact names', error);
    return map;
  }

  (data || []).forEach((entry: any) => {
    const key = (isLegacy ? entry.lead_id : entry.newlead_id)?.toString();
    if (!key) return;
    const contactName = entry.leads_contact?.name;
    if (contactName) {
      map.set(key, contactName);
    }
  });

  return map;
}

function buildLeadLink(row: PaymentRow): string {
  const leadIdentifier = row.leadId?.toString().trim();
  if (leadIdentifier) {
    const normalized = row.leadType === 'legacy' ? leadIdentifier.replace(/^legacy_/, '') : leadIdentifier;
    if (normalized) {
      return `/clients/${encodeURIComponent(normalized)}`;
    }
  }
  const cleanNumber = row.caseNumber?.replace(/^#/, '') || '';
  return cleanNumber ? `/clients/${encodeURIComponent(cleanNumber)}` : '/clients';
}

async function fetchLegacyProformaStatus(rows: PaymentRow[]): Promise<Set<string>> {
  const legacyIds = Array.from(
    new Set(
      rows
        .filter((row) => row.leadType === 'legacy')
        .map((row) => row.leadId.replace(/^legacy_/, ''))
        .filter((id) => id),
    ),
  )
    .map((id) => parseInt(id, 10))
    .filter((id) => !Number.isNaN(id));

  if (!legacyIds.length) {
    return new Set();
  }

  const { data, error } = await supabase
    .from('proformainvoice')
    .select('lead_id, cxd_date')
    .in('lead_id', legacyIds);

  if (error) {
    console.error('Failed to fetch legacy proforma invoices:', error);
    return new Set();
  }

  return new Set(
    (data || [])
      .filter((invoice: any) => !invoice.cxd_date)
      .map((invoice: any) => `legacy_${invoice.lead_id}`),
  );
}

function resolvePaymentRecord(rowId: string): { table: 'payment_plans' | 'finances_paymentplanrow'; id: string | number } {
  const [prefix, ...rest] = rowId.split('-');
  const recordId = rest.join('-');
  if (prefix === 'legacy') {
    const numericId = Number(recordId);
    if (Number.isNaN(numericId)) {
      throw new Error('Invalid legacy payment row id');
    }
    return { table: 'finances_paymentplanrow', id: numericId };
  }
  return { table: 'payment_plans', id: recordId };
}

function parseLegacyLeadId(leadId: string): number | null {
  const trimmed = leadId.replace(/^legacy_/, '');
  const numeric = Number(trimmed);
  return Number.isNaN(numeric) ? null : numeric;
}

function normalizeHandlerId(value: any): number | null {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeDate(value: any): string | null {
  if (value === null || value === undefined) return null;
  const raw = typeof value === 'string' ? value.trim() : value;
  if (!raw) return null;
  const invalidTokens = new Set(['0000-00-00', '0000-00-00 00:00:00', '1970-01-01', '1970-01-01 00:00:00']);
  if (typeof raw === 'string' && invalidTokens.has(raw)) {
    return null;
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString().split('T')[0];
}

