import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { BanknotesIcon, MagnifyingGlassIcon, Squares2X2Icon, ArrowUturnDownIcon, DocumentDuplicateIcon, ChartPieIcon, AdjustmentsHorizontalIcon, FunnelIcon, ClockIcon, ArrowPathIcon, CheckCircleIcon, UserGroupIcon, UserIcon, AcademicCapIcon, StarIcon, PlusIcon, ChartBarIcon, ListBulletIcon, CurrencyDollarIcon, BriefcaseIcon, RectangleStackIcon } from '@heroicons/react/24/solid';
import { PencilSquareIcon, XMarkIcon, ArrowLeftIcon, XCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { usePersistedFilters, usePersistedState } from '../hooks/usePersistedState';
import { convertToNIS } from '../lib/currencyConversion';

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

// Reports list for search functionality
type ReportItem = {
  label: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  route?: string;
};

type ReportSection = {
  category: string;
  items: ReportItem[];
};

const reports: ReportSection[] = [
  {
    category: 'Search',
    items: [
      { label: 'Full Search', icon: MagnifyingGlassIcon, route: '/reports' },
      { label: 'Stage Search', icon: Squares2X2Icon, route: '/reports' },
      { label: 'Anchor Search', icon: ArrowUturnDownIcon, route: '/reports' },
      { label: 'Duplicate Search', icon: DocumentDuplicateIcon, route: '/reports' },
    ],
  },
  {
    category: 'Marketing',
    items: [
      { label: 'Sources pie', icon: ChartPieIcon, route: '/reports' },
      { label: 'Category & source', icon: AdjustmentsHorizontalIcon, route: '/reports' },
      { label: 'Convertion', icon: FunnelIcon, route: '/reports' },
      { label: 'Convertion Steps', icon: FunnelIcon, route: '/reports' },
    ],
  },
  {
    category: 'Meetings',
    items: [
      { label: 'Scheduled', icon: ClockIcon, route: '/reports' },
      { label: 'Rescheduled', icon: ArrowPathIcon, route: '/reports' },
      { label: 'Results', icon: CheckCircleIcon, route: '/reports' },
      { label: 'Collection', icon: BanknotesIcon, route: '/reports' },
      { label: 'Convertion', icon: FunnelIcon, route: '/reports' },
    ],
  },
  {
    category: 'Sales',
    items: [
      { label: 'Actual', icon: UserGroupIcon, route: '/reports' },
      { label: 'Target', icon: UserIcon, route: '/reports' },
      { label: 'Signed', icon: AcademicCapIcon, route: '/sales/signed' },
      { label: 'Scheduling Bonuses', icon: StarIcon, route: '/reports' },
      { label: 'Bonuses (v4)', icon: PlusIcon, route: '/reports' },
    ],
  },
  {
    category: 'Pipelines',
    items: [
      { label: 'General Sales', icon: Squares2X2Icon, route: '/reports' },
      { label: 'Employee', icon: UserIcon, route: '/reports' },
      { label: 'Unhandled', icon: UserIcon, route: '/reports' },
      { label: 'Expert', icon: AcademicCapIcon, route: '/reports' },
    ],
  },
  {
    category: 'Schedulers',
    items: [
      { label: 'Super Pipeline', icon: BanknotesIcon, route: '/reports' },
      { label: 'Schedulers Quality', icon: StarIcon, route: '/reports' },
      { label: 'Performance', icon: ChartBarIcon, route: '/reports' },
      { label: 'Performance by Cat.', icon: ChartBarIcon, route: '/reports' },
    ],
  },
  {
    category: 'Closers',
    items: [
      { label: 'Super Pipeline', icon: BanknotesIcon, route: '/reports' },
      { label: 'Closers Quality', icon: StarIcon, route: '/reports' },
    ],
  },
  {
    category: 'Experts',
    items: [
      { label: 'Experts Assignment', icon: AcademicCapIcon, route: '/reports' },
      { label: 'Experts Results', icon: AcademicCapIcon, route: '/reports' },
    ],
  },
  {
    category: 'Contribution',
    items: [
      { label: 'All', icon: RectangleStackIcon, route: '/reports' },
    ],
  },
  {
    category: 'Analysis',
    items: [
      { label: 'Employees Performance', icon: ChartBarIcon, route: '/reports' },
      { label: 'Statistics', icon: ChartPieIcon, route: '/reports' },
      { label: 'Pies', icon: ChartPieIcon, route: '/reports' },
      { label: 'Tasks', icon: ListBulletIcon, route: '/reports' },
    ],
  },
  {
    category: 'Finances',
    items: [
      { label: 'Profitability', icon: CurrencyDollarIcon, route: '/reports' },
      { label: 'Collection', icon: BanknotesIcon, route: '/reports/collection-finances' },
      { label: 'Collection Due', icon: BanknotesIcon, route: '/reports' },
    ],
  },
  {
    category: 'Cases',
    items: [
      { label: 'Sum Active', icon: BriefcaseIcon, route: '/reports' },
    ],
  },
];

const CollectionFinancesReport: React.FC = () => {
  const navigate = useNavigate();
  const [filters, setFilters] = usePersistedFilters<Filters>('collectionFinancesReport_filters', {
    fromDate: todayIso,
    toDate: todayIso,
    collected: 'all',
    categoryId: '',
    order: '',
    due: 'ignore',
  }, {
    storage: 'sessionStorage',
  });
  const [categories, setCategories] = useState<MainCategory[]>([]);
  const [rows, setRows] = usePersistedFilters<PaymentRow[]>('collectionFinancesReport_results', [], {
    storage: 'sessionStorage',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [handlerOptions, setHandlerOptions] = useState<{ id: number; name: string }[]>([]);
  const [handlerEdit, setHandlerEdit] = useState<{ rowId: string; value: string } | null>(null);
  const [notesEdit, setNotesEdit] = useState<{ rowId: string; value: string } | null>(null);
  const [savingHandler, setSavingHandler] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);
  const [searchQuery, setSearchQuery] = usePersistedState<string>('collectionFinancesReport_searchQuery', '', {
    storage: 'sessionStorage',
  });

  // Filter reports based on search query
  const filteredReports = useMemo(() => {
    if (!searchQuery.trim()) {
      return reports;
    }

    const query = searchQuery.toLowerCase().trim();
    return reports
      .map((section) => {
        const filteredItems = section.items.filter((item) => {
          const labelMatch = item.label.toLowerCase().includes(query);
          const categoryMatch = section.category.toLowerCase().includes(query);
          return labelMatch || categoryMatch;
        });
        return { ...section, items: filteredItems };
      })
      .filter((section) => section.items.length > 0);
  }, [searchQuery]);

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
      const beforeFiltering = withProforma.length;
      const filtered = withProforma.filter((row) => {
        // Category filter
        if (filters.categoryId && row.mainCategoryId !== filters.categoryId) {
          return false;
        }
        
        // Collected filter
        if (filters.collected !== 'all') {
          if (filters.collected === 'yes') {
            if (!row.collected) return false;
          } else if (filters.collected === 'no_with_proforma') {
            // Keep only uncollected rows with proforma
            if (row.collected || !row.hasProforma) return false;
          } else if (filters.collected === 'no_without_proforma') {
            // Keep only uncollected rows without proforma
            if (row.collected || row.hasProforma) return false;
          }
        }
        
        // Order filter
        if (filters.order && filters.order !== '') {
          if (row.orderCode !== filters.order) return false;
        }
        
        // Due date filter is now handled in the database queries above
        // No client-side filtering needed
        
        return true;
      });
      console.log(`✅ [loadPayments] After client-side filtering: ${filtered.length} plans (was ${beforeFiltering})`);
      
      // Debug: Check for lead 34379 after filtering
      const plansFor34379AfterFilter = filtered.filter((row) => 
        row.leadId?.toString().includes('34379') || row.caseNumber?.includes('34379')
      );
      console.log(`🔍 [loadPayments] Filtered plans for 34379:`, plansFor34379AfterFilter.length, plansFor34379AfterFilter.map((p: any) => ({
        id: p.id,
        leadId: p.leadId,
        caseNumber: p.caseNumber,
        dueDate: p.dueDate,
        collected: p.collected,
        categoryId: p.mainCategoryId,
        orderCode: p.orderCode,
      })));
      filtered.sort((a, b) => {
        const aDate = a.collectedDate || a.dueDate || '';
        const bDate = b.collectedDate || b.dueDate || '';
        return bDate.localeCompare(aDate);
      });
      
      // Debug: Final check before setting rows
      const final34379 = filtered.filter((row) => 
        row.leadId?.toString().includes('34379') || row.caseNumber?.includes('34379')
      );
      console.log(`🔍 [loadPayments] Final rows to set: ${filtered.length} total, ${final34379.length} for 34379`);
      if (final34379.length > 0) {
        console.log(`✅ [loadPayments] Payment plan for 34379 WILL BE SET:`, final34379[0]);
      }
      
      setRows(filtered);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to load collection data.');
    } finally {
      setLoading(false);
    }
  };

  const totals = useMemo(() => {
    // Match CollectionDueReport logic: convert value (without VAT) to NIS
    const estimated = rows.reduce((sum, row) => {
      // Normalize currency: convert symbols to codes for convertToNIS
      let currencyForConversion = row.currency || 'NIS';
      if (currencyForConversion === '₪') currencyForConversion = 'NIS';
      else if (currencyForConversion === '€') currencyForConversion = 'EUR';
      else if (currencyForConversion === '$') currencyForConversion = 'USD';
      else if (currencyForConversion === '£') currencyForConversion = 'GBP';
      
      // Convert value to NIS (same as CollectionDueReport line 8815)
      const valueInNIS = convertToNIS(row.value, currencyForConversion);
      return sum + valueInNIS;
    }, 0);
    const collected = rows.reduce((sum, row) => {
      if (row.collected) {
        // Normalize currency: convert symbols to codes for convertToNIS
        let currencyForConversion = row.currency || 'NIS';
        if (currencyForConversion === '₪') currencyForConversion = 'NIS';
        else if (currencyForConversion === '€') currencyForConversion = 'EUR';
        else if (currencyForConversion === '$') currencyForConversion = 'USD';
        else if (currencyForConversion === '£') currencyForConversion = 'GBP';
        
        // Convert value to NIS (same as CollectionDueReport)
        const valueInNIS = convertToNIS(row.value, currencyForConversion);
        return sum + valueInNIS;
      }
      return sum;
    }, 0);
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
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <BanknotesIcon className="w-10 h-10 text-primary" />
            Collection Finances Report
          </h1>
          <p className="text-gray-500 mt-1">Track estimated and collected payments across all leads.</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Search Bar */}
          <div className="relative max-w-xs">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search other reports..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-sm"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <XMarkIcon className="w-4 h-4" />
              </button>
            )}
          </div>
          {/* Back to Reports Button */}
          <Link
            to="/reports"
            className="btn btn-outline btn-primary flex items-center gap-2"
          >
            <ArrowLeftIcon className="w-5 h-5" />
            Back to Reports
          </Link>
        </div>
      </div>

      {/* Search Results Dropdown */}
      {searchQuery && (
        <div className="border border-gray-200 rounded-lg bg-white shadow-lg max-h-96 overflow-y-auto">
          <div className="p-4">
            <p className="text-sm font-semibold text-gray-700 mb-3">Quick Switch to:</p>
            <div className="space-y-2">
              {filteredReports.map((section) =>
                section.items.map((item) => (
                  <button
                    key={item.label}
                    onClick={() => {
                      if (item.route) {
                        navigate(item.route);
                        setSearchQuery('');
                      }
                    }}
                    className={`w-full text-left px-4 py-2 rounded-md hover:bg-primary hover:text-white transition-colors flex items-center gap-3 ${
                      item.route === '/reports/collection-finances' ? 'bg-primary text-white' : 'bg-gray-50'
                    }`}
                  >
                    <item.icon className="w-5 h-5" />
                    <div className="flex-1">
                      <div className="font-medium">{item.label}</div>
                      <div className="text-xs opacity-75">{section.category}</div>
                    </div>
                  </button>
                ))
              )}
            </div>
            {filteredReports.length === 0 && (
              <div className="text-center py-4 text-gray-500 text-sm">
                No reports found matching "{searchQuery}"
              </div>
            )}
          </div>
        </div>
      )}

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
                <th>Amount (in NIS)</th>
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
                  <td colSpan={11} className="text-center py-6 text-gray-500">No payments found for the selected filters.</td>
                </tr>
              )}
              {(() => {
                // Debug: Check rows for 34379 in render
                const rowsFor34379 = rows.filter((row) => 
                  row.leadId?.toString().includes('34379') || row.caseNumber?.includes('34379')
                );
                if (rowsFor34379.length > 0) {
                  console.log(`✅ [RENDER] Found ${rowsFor34379.length} rows for 34379 in render:`, rowsFor34379.map((r: any) => ({
                    id: r.id,
                    leadId: r.leadId,
                    leadName: r.leadName,
                    caseNumber: r.caseNumber,
                  })));
                } else {
                  console.log(`❌ [RENDER] No rows for 34379 in render. Total rows: ${rows.length}`);
                }
                return null;
              })()}
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <Link to={buildLeadLink(row)} className="link link-primary">
                      {row.leadName}
                    </Link>
                  </td>
                  <td>{row.clientName || row.leadName || '—'}</td>
                  <td className="font-semibold">
                    {formatCurrency(row.value, row.currency)}
                    {row.vat > 0 && (
                      <span className="text-gray-600 ml-1">
                        + {formatCurrency(row.vat, row.currency)}
                      </span>
                    )}
                  </td>
                  <td className="font-semibold">
                    {(() => {
                      // Normalize currency: convert symbols to codes for convertToNIS
                      let currencyForConversion = row.currency || 'NIS';
                      if (currencyForConversion === '₪') currencyForConversion = 'NIS';
                      else if (currencyForConversion === '€') currencyForConversion = 'EUR';
                      else if (currencyForConversion === '$') currencyForConversion = 'USD';
                      else if (currencyForConversion === '£') currencyForConversion = 'GBP';
                      
                      // Convert value to NIS
                      const valueInNIS = convertToNIS(row.value, currencyForConversion);
                      const vatInNIS = convertToNIS(row.vat, currencyForConversion);
                      const totalInNIS = valueInNIS + vatInNIS;
                      return formatCurrency(totalInNIS, '₪');
                    })()}
                  </td>
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
    .select('id, lead_id, value, value_vat, currency, due_date, payment_order, notes, paid, paid_at, proforma, client_name, cancel_date, ready_to_pay');

  // If "due date included" is selected, use the same logic as CollectionDueReport
  if (filters.due === 'due_only') {
    query = query
      .eq('ready_to_pay', true) // Sent to finance
      .eq('paid', false) // Only unpaid payments
      .not('due_date', 'is', null) // Must have due_date
      .is('cancel_date', null); // Exclude cancelled
    
    // Filter by due_date in date range (same as CollectionDueReport)
    if (filters.fromDate) {
      const fromDateTime = `${filters.fromDate}T00:00:00`;
      query = query.gte('due_date', fromDateTime);
    }
    if (filters.toDate) {
      const toDateTime = `${filters.toDate}T23:59:59`;
      query = query.lte('due_date', toDateTime);
    }
  } else {
    // When "due date included" is NOT selected, filter by cancel_date and apply date range filtering
    query = query.is('cancel_date', null);
    
    // For date range filtering, we need to handle payment plans where:
    // 1. due_date falls within the range, OR
    // 2. paid_at falls within the range (for collected payments)
    // Since Supabase filtering by due_date excludes NULL values, we'll fetch all plans
    // and apply comprehensive date filtering client-side to catch all relevant payment plans
  }

  const { data, error } = await query;
  if (error) throw error;

  // When "due date included" is selected, all filtering is done in the query
  // When NOT selected, we need to apply client-side date filtering
  const dateFilteredPlans = filters.due === 'due_only' 
    ? (data || []) // All filtering already done in query (due_date range, ready_to_pay, paid, cancel_date)
    : (data || []).filter((plan: any) => {
        // Filter out cancelled plans
        if (plan.cancel_date) return false;
        
        // Apply date range filtering
        if (!filters.fromDate && !filters.toDate) return true;
        if (!filters.fromDate && !filters.toDate) return true;
        
        const dueDate = plan.due_date ? new Date(plan.due_date) : null;
        const paidAt = plan.paid_at ? new Date(plan.paid_at) : null;
        const fromDate = filters.fromDate ? new Date(filters.fromDate + 'T00:00:00') : null;
        const toDate = filters.toDate ? new Date(filters.toDate + 'T23:59:59') : null;
        
        // Check if due_date is in range (primary filter)
        if (dueDate) {
          if (fromDate && dueDate < fromDate) return false;
          if (toDate && dueDate > toDate) return false;
          return true;
        }
        
        // If due_date is NULL, check paid_at (for collected payments)
        if (paidAt) {
          if (fromDate && paidAt < fromDate) return false;
          if (toDate && paidAt > toDate) return false;
          return true;
        }
        
        // If both due_date and paid_at are NULL, include it (don't exclude payment plans with no date info)
        // This handles cases where payment plans might not have dates set yet
        return true;
      });
  
  const leadIds = Array.from(new Set(dateFilteredPlans.map((row) => (row.lead_id ?? '').toString()).filter(Boolean)));
  const leadMeta = await fetchLeadMetadata(leadIds, false);

  // Process all payments (same as CollectionDueReport) - don't filter by metadata existence
  // IMPORTANT: All payment values come from payment_plans table, NOT from leads table
  return dateFilteredPlans
    .map((plan: any) => {
    const key = plan.lead_id?.toString?.() || '';
    const meta = leadMeta.get(key) || null;
    // Get value from payment_plans table (plan.value from payment_plans query)
    const value = Number(plan.value || 0);
    // Get VAT from payment_plans table (plan.value_vat from payment_plans query)
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
  console.log('🔍 [fetchLegacyPayments] Starting fetch with filters:', filters);
  
  let query = supabase
    .from('finances_paymentplanrow')
    .select(
      'id, lead_id, client_id, value, value_base, vat_value, currency_id, due_date, date, order, notes, actual_date, cancel_date, ready_to_pay, accounting_currencies!finances_paymentplanrow_currency_id_fkey(name, iso_code)',
    );

  // If "due date included" is selected, use the same logic as CollectionDueReport
  if (filters.due === 'due_only') {
    // For legacy leads: if due_date exists, it means ready to pay (no need to check ready_to_pay flag)
    query = query
      .not('due_date', 'is', null) // Only fetch if due_date has a date (not NULL) - for legacy leads, due_date means ready to pay
      .is('cancel_date', null) // Exclude cancelled payments
      .is('actual_date', null); // Only unpaid payments (actual_date IS NULL means not paid yet)
    
    // Filter by 'due_date' column for date range (this is what determines when payment is due)
    // For legacy leads, only fetch payment rows if due_date is available (due_date means ready to pay)
    if (filters.fromDate) {
      const fromDateTime = `${filters.fromDate}T00:00:00`;
      console.log('🔍 [fetchLegacyPayments] Filtering by due_date >=', fromDateTime);
      query = query.gte('due_date', fromDateTime);
    }
    if (filters.toDate) {
      const toDateTime = `${filters.toDate}T23:59:59`;
      console.log('🔍 [fetchLegacyPayments] Filtering by due_date <=', toDateTime);
      query = query.lte('due_date', toDateTime);
    }
  } else {
    // When "due date included" is NOT selected, filter by 'date' column for date range
    if (filters.fromDate) {
      const fromDateTime = `${filters.fromDate}T00:00:00`;
      console.log('🔍 [fetchLegacyPayments] Filtering by date >=', fromDateTime);
      query = query.gte('date', fromDateTime);
    }
    if (filters.toDate) {
      const toDateTime = `${filters.toDate}T23:59:59`;
      console.log('🔍 [fetchLegacyPayments] Filtering by date <=', toDateTime);
      query = query.lte('date', toDateTime);
    }
  }

  const { data, error } = await query;
  if (error) {
    console.error('❌ [fetchLegacyPayments] Query error:', error);
    throw error;
  }
  
  console.log(`✅ [fetchLegacyPayments] Fetched ${data?.length || 0} payment plans from database`);
  console.log('🔍 [fetchLegacyPayments] Sample payment plans:', data?.slice(0, 3).map((p: any) => ({
    id: p.id,
    lead_id: p.lead_id,
    client_id: p.client_id,
    date: p.date,
    due_date: p.due_date,
    cancel_date: p.cancel_date,
    actual_date: p.actual_date,
  })));

  // When "due date included" is selected, all filtering is done in the query
  // (due_date not null, actual_date is null, cancel_date is null, and date range on due_date)
  // When NOT selected, we need to filter out cancelled plans
  const activePlans = filters.due === 'due_only' 
    ? (data || []) // All filtering already done in query
    : (data || []).filter((plan: any) => !plan.cancel_date);
  
  console.log(`✅ [fetchLegacyPayments] Active plans: ${activePlans.length}`);
  
  // Debug: Check for lead 34379 specifically
  const plansFor34379 = activePlans.filter((plan: any) => 
    plan.lead_id?.toString() === '34379' || plan.client_id?.toString() === '34379' || plan.client_id === 34379
  );
  console.log(`🔍 [fetchLegacyPayments] Payment plans for lead/client 34379:`, plansFor34379.length, plansFor34379.map((p: any) => ({
    id: p.id,
    lead_id: p.lead_id,
    client_id: p.client_id,
    date: p.date,
    due_date: p.due_date,
    value: p.value,
    cancel_date: p.cancel_date,
  })));
  
  // Collect lead_ids for metadata fetching (client_id is a contact_id, not a lead_id)
  const allLeadIds = new Set<string>();
  const allClientIds = new Set<number>();
  activePlans.forEach((plan: any) => {
    const leadId = plan.lead_id?.toString();
    const clientId = plan.client_id ? Number(plan.client_id) : null;
    if (leadId) allLeadIds.add(leadId);
    if (clientId && !Number.isNaN(clientId)) allClientIds.add(clientId);
  });
  const leadIds = Array.from(allLeadIds);
  console.log(`🔍 [fetchLegacyPayments] Unique lead_ids found:`, leadIds.slice(0, 10), `(total: ${leadIds.length})`);
  console.log(`🔍 [fetchLegacyPayments] Unique client_ids (contact_ids) found:`, Array.from(allClientIds).slice(0, 10), `(total: ${allClientIds.size})`);
  console.log(`🔍 [fetchLegacyPayments] Checking if 34379 is in lead IDs:`, leadIds.includes('34379'));
  
  // Fetch lead metadata (only for lead_ids, not client_ids)
  const leadMeta = await fetchLeadMetadata(leadIds, true);
  console.log(`✅ [fetchLegacyPayments] Fetched metadata for ${leadMeta.size} leads`);
  console.log(`🔍 [fetchLegacyPayments] Metadata for 34379:`, leadMeta.get('34379'));
  
  // Fetch contact information for client_ids (contact_ids)
  const contactMap = new Map<number, string>();
  if (allClientIds.size > 0) {
    const clientIdArray = Array.from(allClientIds);
    const { data: contacts, error: contactsError } = await supabase
      .from('leads_contact')
      .select('id, name')
      .in('id', clientIdArray);
    if (!contactsError && contacts) {
      contacts.forEach((contact: any) => {
        if (contact.id && contact.name) {
          contactMap.set(contact.id, contact.name);
        }
      });
    }
    console.log(`✅ [fetchLegacyPayments] Fetched ${contactMap.size} contact names for client_ids`);
  }

  // Process all payments (same as CollectionDueReport) - don't filter by metadata existence
  return activePlans
    .map((plan: any) => {
    // For per-contact payment plans: use lead_id for lead metadata, client_id for contact name
    const leadIdKey = plan.lead_id?.toString?.() || '';
    const clientId = plan.client_id ? Number(plan.client_id) : null;
    
    // Get lead metadata
    const meta = leadMeta.get(leadIdKey) || null;
    
    // Get contact name for client_id (contact_id)
    const contactName = clientId && !Number.isNaN(clientId) ? contactMap.get(clientId) : null;
    
    // Debug for 34379
    if ((leadIdKey === '34379' || plan.lead_id === 34379)) {
      console.log(`✅ [fetchLegacyPayments] Processing payment plan for 34379:`, {
        planId: plan.id,
        lead_id: plan.lead_id,
        client_id: plan.client_id,
        contactName,
        metaFound: !!meta,
        leadName: meta?.leadName,
        caseNumber: meta?.caseNumber,
      });
    }
    // IMPORTANT: Get value from finances_paymentplanrow table, NOT from leads_lead table
    // Use value for legacy payments (value_base may be null/0, value contains the actual amount)
    // Same logic as CollectionDueReport - plan.value and plan.value_base come from finances_paymentplanrow query
    const value = Number(plan.value || plan.value_base || 0);
    // Get VAT from finances_paymentplanrow table (plan.vat_value from finances_paymentplanrow query)
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
    // Always use lead_id metadata for lead information (leadName, caseNumber, etc.)
    // Use contact name from client_id (contact_id) for clientName field
    return {
      id: `legacy-${plan.id}`,
      leadId: `legacy_${leadIdKey}`, // Always use original lead_id for navigation/filtering
      leadName: meta?.leadName || `Lead #${leadIdKey}`, // Use lead metadata for lead name
      clientName: contactName || meta?.contactName || meta?.clientName || meta?.leadName || `Lead #${leadIdKey}`, // Prefer contact name from client_id, then fallback to lead metadata
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
      caseNumber: meta?.caseNumber || `#${leadIdKey}`, // Always use lead_id for case number
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

