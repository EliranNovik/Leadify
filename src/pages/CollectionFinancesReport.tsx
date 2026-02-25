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
  collected: string[]; // Multi-select
  categoryId: string[]; // Changed to array for multi-select
  order: string[]; // Changed to array for multi-select
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
  proformaDate: string | null;
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
  { value: 'yes_with_proforma', label: 'Yes - With Proforma' },
  { value: 'yes_without_proforma', label: 'Yes - Without Proforma' },
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
    collected: [], // Multi-select
    categoryId: [], // Changed to empty array for multi-select
    order: [], // Changed to empty array for multi-select
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
  const [showCollectedDropdown, setShowCollectedDropdown] = useState(false);
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [showOrderDropdown, setShowOrderDropdown] = useState(false);

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

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (showCollectedDropdown && !target.closest('.dropdown')) {
        setShowCollectedDropdown(false);
      }
      if (showCategoryDropdown && !target.closest('.dropdown')) {
        setShowCategoryDropdown(false);
      }
      if (showOrderDropdown && !target.closest('.dropdown')) {
        setShowOrderDropdown(false);
      }
    };

    if (showCollectedDropdown || showCategoryDropdown || showOrderDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showCollectedDropdown, showCategoryDropdown, showOrderDropdown]);

  const handleFilterChange = (field: keyof Filters, value: string) => {
    setFilters((prev) => ({ ...prev, [field]: value }));
  };

  const handleCollectedToggle = (collectedValue: string) => {
    setFilters(prev => {
      const currentCollected = Array.isArray(prev.collected) ? prev.collected : [];
      const newCollected = currentCollected.includes(collectedValue)
        ? currentCollected.filter(c => c !== collectedValue)
        : [...currentCollected, collectedValue];
      return { ...prev, collected: newCollected };
    });
  };

  const handleSelectAllCollected = () => {
    setFilters(prev => ({ 
      ...prev, 
      collected: ['yes_with_proforma', 'yes_without_proforma', 'no_with_proforma', 'no_without_proforma'] 
    }));
  };

  const handleClearAllCollected = () => {
    setFilters(prev => ({ ...prev, collected: [] }));
  };

  const handleCategoryToggle = (categoryId: string) => {
    setFilters(prev => {
      const currentCategories = Array.isArray(prev.categoryId) ? prev.categoryId : [];
      const newCategories = currentCategories.includes(categoryId)
        ? currentCategories.filter(c => c !== categoryId)
        : [...currentCategories, categoryId];
      return { ...prev, categoryId: newCategories };
    });
  };

  const handleSelectAllCategories = () => {
    setFilters(prev => ({ ...prev, categoryId: categories.map(cat => cat.id) }));
  };

  const handleClearAllCategories = () => {
    setFilters(prev => ({ ...prev, categoryId: [] }));
  };

  const handleOrderToggle = (orderValue: string) => {
    setFilters(prev => {
      const currentOrders = Array.isArray(prev.order) ? prev.order : [];
      const newOrders = currentOrders.includes(orderValue)
        ? currentOrders.filter(o => o !== orderValue)
        : [...currentOrders, orderValue];
      return { ...prev, order: newOrders };
    });
  };

  const handleSelectAllOrders = () => {
    setFilters(prev => ({ ...prev, order: ['1', '5', '9', '90', '99'] }));
  };

  const handleClearAllOrders = () => {
    setFilters(prev => ({ ...prev, order: [] }));
  };

const loadPayments = async () => {
    setLoading(true);
    setError(null);
    try {
      console.log(`🔍 [loadPayments] Starting with filters:`, filters);
      const [modern, legacy] = await Promise.all([fetchModernPayments(filters), fetchLegacyPayments(filters)]);
      console.log(`✅ [loadPayments] Fetched ${modern.length} modern payments, ${legacy.length} legacy payments`);
      
      // Debug: Check for lead 199849 in modern payments
      const modern199849 = modern.filter((row) => 
        row.leadId?.toString().includes('199849') || row.caseNumber?.includes('199849')
      );
      console.log(`🔍 [loadPayments] Modern payments for 199849:`, modern199849.length, modern199849.map((p: any) => ({
        id: p.id,
        leadId: p.leadId,
        caseNumber: p.caseNumber,
        dueDate: p.dueDate,
        collectedDate: p.collectedDate,
        collected: p.collected,
        categoryId: p.mainCategoryId,
        orderCode: p.orderCode,
      })));
      
      // Debug: Check for lead 199849 in legacy payments
      const legacy199849 = legacy.filter((row) => 
        row.leadId?.toString().includes('199849') || row.caseNumber?.includes('199849')
      );
      console.log(`🔍 [loadPayments] Legacy payments for 199849:`, legacy199849.length, legacy199849.map((p: any) => ({
        id: p.id,
        leadId: p.leadId,
        caseNumber: p.caseNumber,
        dueDate: p.dueDate,
        collectedDate: p.collectedDate,
        collected: p.collected,
        categoryId: p.mainCategoryId,
        orderCode: p.orderCode,
      })));
      
      // Debug: Check for lead 155026 in modern payments
      const modern155026 = modern.filter((row) => 
        row.leadId?.toString().includes('155026') || row.caseNumber?.includes('155026')
      );
      console.log(`🔍 [loadPayments] Modern payments for 155026:`, modern155026.length, modern155026.map((p: any) => ({
        id: p.id,
        leadId: p.leadId,
        caseNumber: p.caseNumber,
        dueDate: p.dueDate,
        collectedDate: p.collectedDate,
        collected: p.collected,
        categoryId: p.mainCategoryId,
        orderCode: p.orderCode,
        hasProforma: p.hasProforma,
      })));
      
      // Debug: Check for lead 155026 in legacy payments
      const legacy155026 = legacy.filter((row) => 
        row.leadId?.toString().includes('155026') || row.caseNumber?.includes('155026')
      );
      console.log(`🔍 [loadPayments] Legacy payments for 155026:`, legacy155026.length, legacy155026.map((p: any) => ({
        id: p.id,
        leadId: p.leadId,
        caseNumber: p.caseNumber,
        dueDate: p.dueDate,
        collectedDate: p.collectedDate,
        collected: p.collected,
        categoryId: p.mainCategoryId,
        orderCode: p.orderCode,
        hasProforma: p.hasProforma,
      })));
      
      const combined = [...modern, ...legacy];
      const combined199849 = combined.filter((row) => 
        row.leadId?.toString().includes('199849') || row.caseNumber?.includes('199849')
      );
      console.log(`🔍 [loadPayments] Combined payments for 199849:`, combined199849.length);
      
      // Debug: Check for lead 155026 in combined payments
      const combined155026 = combined.filter((row) => 
        row.leadId?.toString().includes('155026') || row.caseNumber?.includes('155026')
      );
      console.log(`🔍 [loadPayments] Combined payments for 155026:`, combined155026.length, combined155026.map((p: any) => ({
        id: p.id,
        leadId: p.leadId,
        caseNumber: p.caseNumber,
        dueDate: p.dueDate,
        collectedDate: p.collectedDate,
        collected: p.collected,
        categoryId: p.mainCategoryId,
        orderCode: p.orderCode,
        hasProforma: p.hasProforma,
        leadType: p.leadType,
      })));
      
      // Note: For legacy leads, hasProforma is already correctly set in fetchLegacyPayments
      // based on proformaDate (which matches by lead_id + client_id)
      // So we don't need to override it here with fetchLegacyProformaStatus
      const withProforma = combined;
      const beforeFiltering = withProforma.length;
      const filtered = withProforma.filter((row) => {
        // Category filter (multi-select)
        if (Array.isArray(filters.categoryId) && filters.categoryId.length > 0) {
          if (!row.mainCategoryId || !filters.categoryId.includes(row.mainCategoryId)) {
            return false;
          }
        }
        
        // Collected filter (multi-select)
        if (Array.isArray(filters.collected) && filters.collected.length > 0) {
          let matchesFilter = false;
          
          if (filters.collected.includes('yes_with_proforma')) {
            // Collected with proforma
            if (row.collected && row.hasProforma) {
              matchesFilter = true;
            }
          }
          if (filters.collected.includes('yes_without_proforma')) {
            // Collected without proforma
            if (row.collected && !row.hasProforma) {
              matchesFilter = true;
            }
          }
          if (filters.collected.includes('no_with_proforma')) {
            // Uncollected with proforma
            if (!row.collected && row.hasProforma) {
              matchesFilter = true;
            }
          }
          if (filters.collected.includes('no_without_proforma')) {
            // Uncollected without proforma
            if (!row.collected && !row.hasProforma) {
              matchesFilter = true;
            }
          }
          
          if (!matchesFilter) return false;
        }
        
        // Order filter (multi-select)
        if (Array.isArray(filters.order) && filters.order.length > 0) {
          if (!row.orderCode || !filters.order.includes(row.orderCode)) {
            return false;
          }
        }
        
        // Date range filter - always apply client-side to check all dates including proforma dates
        // This ensures "No - With Proforma" filter works correctly even when "Due date included" is selected
        if (filters.fromDate || filters.toDate) {
          // When "Due date included" is selected, database already filtered by due_date
          // But we still need to check proforma dates for payments that might have been excluded
          // When "Due date included" is NOT selected, check all dates
          
          // Check if ANY of the dates (due_date, collectedDate, or proformaDate) fall within the range
          const datesToCheck = [
            row.dueDate,
            row.collectedDate,
            row.proformaDate, // Include proforma date for "No - With Proforma" filter
          ].filter(Boolean);
          
          // If no dates at all, include it (don't exclude payment plans with no date info)
          if (datesToCheck.length === 0) {
            // Include payments with no dates
          } else {
            // Check if at least one date falls within the range
            const fromDate = filters.fromDate ? new Date(filters.fromDate + 'T00:00:00') : null;
            const toDate = filters.toDate ? new Date(filters.toDate + 'T23:59:59') : null;
            
            const hasDateInRange = datesToCheck.some((dateStr) => {
              if (!dateStr) return false;
              const date = new Date(dateStr);
              if (Number.isNaN(date.getTime())) return false;
              
              if (fromDate && date < fromDate) return false;
              if (toDate && date > toDate) return false;
              return true;
            });
            
            if (!hasDateInRange) {
              return false;
            }
          }
        }
        
        return true;
      });
      console.log(`✅ [loadPayments] After client-side filtering: ${filtered.length} plans (was ${beforeFiltering})`);
      
      // Debug: Check for lead 199849 after filtering
      const plansFor199849AfterFilter = filtered.filter((row) => 
        row.leadId?.toString().includes('199849') || row.caseNumber?.includes('199849')
      );
      console.log(`🔍 [loadPayments] Filtered plans for 199849:`, plansFor199849AfterFilter.length, plansFor199849AfterFilter.map((p: any) => ({
        id: p.id,
        leadId: p.leadId,
        caseNumber: p.caseNumber,
        dueDate: p.dueDate,
        collectedDate: p.collectedDate,
        collected: p.collected,
        categoryId: p.mainCategoryId,
        orderCode: p.orderCode,
        hasProforma: p.hasProforma,
      })));
      
      // Debug: Check for lead 155026 after filtering
      const plansFor155026AfterFilter = filtered.filter((row) => 
        row.leadId?.toString().includes('155026') || row.caseNumber?.includes('155026')
      );
      console.log(`🔍 [loadPayments] Filtered plans for 155026:`, plansFor155026AfterFilter.length, plansFor155026AfterFilter.map((p: any) => ({
        id: p.id,
        leadId: p.leadId,
        caseNumber: p.caseNumber,
        dueDate: p.dueDate,
        collectedDate: p.collectedDate,
        collected: p.collected,
        categoryId: p.mainCategoryId,
        orderCode: p.orderCode,
        hasProforma: p.hasProforma,
        leadType: p.leadType,
      })));
      
      // Debug: Check why 199849 might have been filtered out
      const beforeFilter199849 = withProforma.filter((row) => 
        row.leadId?.toString().includes('199849') || row.caseNumber?.includes('199849')
      );
      if (beforeFilter199849.length > 0 && plansFor199849AfterFilter.length === 0) {
        console.log(`❌ [loadPayments] 199849 was filtered out! Before filter:`, beforeFilter199849[0]);
        console.log(`🔍 [loadPayments] Filter reasons:`, {
          categoryFilter: filters.categoryId ? `Category must be ${filters.categoryId}, got ${beforeFilter199849[0].mainCategoryId}` : 'No category filter',
          collectedFilter: filters.collected !== 'all' ? `Collected filter: ${filters.collected}, row collected: ${beforeFilter199849[0].collected}, hasProforma: ${beforeFilter199849[0].hasProforma}` : 'No collected filter',
          orderFilter: filters.order ? `Order must be ${filters.order}, got ${beforeFilter199849[0].orderCode}` : 'No order filter',
        });
      }
      
      // Debug: Check why 155026 might have been filtered out
      const beforeFilter155026 = withProforma.filter((row) => 
        row.leadId?.toString().includes('155026') || row.caseNumber?.includes('155026')
      );
      if (beforeFilter155026.length > 0 && plansFor155026AfterFilter.length === 0) {
        console.log(`❌ [loadPayments] 155026 was filtered out! Before filter:`, beforeFilter155026[0]);
        console.log(`🔍 [loadPayments] Filter reasons for 155026:`, {
          categoryFilter: filters.categoryId ? `Category must be ${filters.categoryId}, got ${beforeFilter155026[0].mainCategoryId}` : 'No category filter',
          collectedFilter: filters.collected !== 'all' ? `Collected filter: ${filters.collected}, row collected: ${beforeFilter155026[0].collected}, hasProforma: ${beforeFilter155026[0].hasProforma}` : 'No collected filter',
          orderFilter: filters.order ? `Order must be ${filters.order}, got ${beforeFilter155026[0].orderCode}` : 'No order filter',
          dueDate: beforeFilter155026[0].dueDate,
          collectedDate: beforeFilter155026[0].collectedDate,
          dateRange: `fromDate: ${filters.fromDate}, toDate: ${filters.toDate}`,
        });
      } else if (beforeFilter155026.length === 0) {
        console.log(`❌ [loadPayments] 155026 was NOT found in combined payments before filtering!`);
        console.log(`🔍 [loadPayments] This means it was filtered out during fetchModernPayments or fetchLegacyPayments`);
      }
      
      filtered.sort((a, b) => {
        const aDate = a.collectedDate || a.dueDate || '';
        const bDate = b.collectedDate || b.dueDate || '';
        return bDate.localeCompare(aDate);
      });
      
      // Debug: Final check before setting rows
      const final199849 = filtered.filter((row) => 
        row.leadId?.toString().includes('199849') || row.caseNumber?.includes('199849')
      );
      console.log(`🔍 [loadPayments] Final rows to set: ${filtered.length} total, ${final199849.length} for 199849`);
      if (final199849.length > 0) {
        console.log(`✅ [loadPayments] Payment plan for 199849 WILL BE SET:`, final199849[0]);
      } else {
        console.log(`❌ [loadPayments] Payment plan for 199849 WILL NOT BE SET`);
      }
      
      // Debug: Final check for 155026 before setting rows
      const final155026 = filtered.filter((row) => 
        row.leadId?.toString().includes('155026') || row.caseNumber?.includes('155026')
      );
      console.log(`🔍 [loadPayments] Final rows to set: ${filtered.length} total, ${final155026.length} for 155026`);
      if (final155026.length > 0) {
        console.log(`✅ [loadPayments] Payment plan for 155026 WILL BE SET:`, final155026[0]);
      } else {
        console.log(`❌ [loadPayments] Payment plan for 155026 WILL NOT BE SET`);
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
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 items-end">
          <div className="form-control">
            <label className="label mb-2"><span className="label-text">From date:</span></label>
            <input type="date" className="input input-bordered" value={filters.fromDate} onChange={(e) => handleFilterChange('fromDate', e.target.value)} />
          </div>
          <div className="form-control">
            <label className="label mb-2"><span className="label-text">To date:</span></label>
            <input type="date" className="input input-bordered" value={filters.toDate} onChange={(e) => handleFilterChange('toDate', e.target.value)} />
          </div>
          <div className="form-control">
            <label className="label mb-2"><span className="label-text">Collected:</span></label>
            <div className="dropdown dropdown-bottom w-full">
              <button
                type="button"
                className="btn btn-outline w-full justify-between"
                onClick={() => setShowCollectedDropdown(!showCollectedDropdown)}
              >
                <span>
                  {Array.isArray(filters.collected) && filters.collected.length > 0
                    ? `${filters.collected.length} selected`
                    : 'ALL'}
                </span>
                <svg
                  className={`w-4 h-4 transition-transform ${showCollectedDropdown ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showCollectedDropdown && (
                <ul className="dropdown-content menu p-2 shadow-lg bg-base-100 rounded-box w-full z-[1] border border-gray-200 mt-1">
                  <li>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost w-full justify-start"
                      onClick={handleSelectAllCollected}
                    >
                      Select All
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost w-full justify-start"
                      onClick={handleClearAllCollected}
                    >
                      Clear All
                    </button>
                  </li>
                  <li className="divider my-1"></li>
                  {collectedOptions.filter(opt => opt.value !== 'all').map(option => {
                    const isSelected = Array.isArray(filters.collected) && filters.collected.includes(option.value);
                    return (
                      <li key={option.value}>
                        <button
                          type="button"
                          className="w-full text-left"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleCollectedToggle(option.value);
                          }}
                        >
                          <label className="label cursor-pointer justify-start gap-2 py-2 hover:bg-gray-100 rounded w-full">
                            <input
                              type="checkbox"
                              className="checkbox checkbox-sm pointer-events-none"
                              checked={isSelected}
                              readOnly
                            />
                            <span className="label-text flex-1">{option.label}</span>
                          </label>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
          <div className="form-control">
            <label className="label mb-2"><span className="label-text">Category:</span></label>
            <div className="dropdown dropdown-bottom w-full">
              <button
                type="button"
                className="btn btn-outline w-full justify-between"
                onClick={() => setShowCategoryDropdown(!showCategoryDropdown)}
              >
                <span>
                  {Array.isArray(filters.categoryId) && filters.categoryId.length > 0
                    ? `${filters.categoryId.length} selected`
                    : 'ALL'}
                </span>
                <svg
                  className={`w-4 h-4 transition-transform ${showCategoryDropdown ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showCategoryDropdown && (
                <div className="dropdown-content bg-base-100 shadow-lg rounded-box w-full z-[1] border border-gray-200 mt-1" style={{ maxHeight: '240px', overflowY: 'auto', overflowX: 'hidden' }}>
                  <div className="p-2">
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost w-full justify-start mb-1"
                      onClick={handleSelectAllCategories}
                    >
                      Select All
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost w-full justify-start mb-1"
                      onClick={handleClearAllCategories}
                    >
                      Clear All
                    </button>
                    <div className="divider my-1"></div>
                    {categories.map(cat => {
                      const isSelected = Array.isArray(filters.categoryId) && filters.categoryId.includes(cat.id);
                      return (
                        <div key={cat.id} className="py-1">
                          <label className="label cursor-pointer justify-start gap-2 py-2 hover:bg-gray-100 rounded w-full">
                            <input
                              type="checkbox"
                              className="checkbox checkbox-sm"
                              checked={isSelected}
                              onChange={() => handleCategoryToggle(cat.id)}
                            />
                            <span className="label-text flex-1 break-words">{cat.name}</span>
                          </label>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="form-control">
            <label className="label mb-2"><span className="label-text">Order:</span></label>
            <div className="dropdown dropdown-bottom w-full">
              <button
                type="button"
                className="btn btn-outline w-full justify-between"
                onClick={() => setShowOrderDropdown(!showOrderDropdown)}
              >
                <span>
                  {Array.isArray(filters.order) && filters.order.length > 0
                    ? `${filters.order.length} selected`
                    : 'ALL'}
                </span>
                <svg
                  className={`w-4 h-4 transition-transform ${showOrderDropdown ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showOrderDropdown && (
                <ul className="dropdown-content menu p-2 shadow-lg bg-base-100 rounded-box w-full z-[1] border border-gray-200 mt-1">
                  <li>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost w-full justify-start"
                      onClick={handleSelectAllOrders}
                    >
                      Select All
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost w-full justify-start"
                      onClick={handleClearAllOrders}
                    >
                      Clear All
                    </button>
                  </li>
                  <li className="divider my-1"></li>
                  {orderOptions.filter(opt => opt.value !== '').map(option => {
                    const isSelected = Array.isArray(filters.order) && filters.order.includes(option.value);
                    return (
                      <li key={option.value}>
                        <button
                          type="button"
                          className="w-full text-left"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleOrderToggle(option.value);
                          }}
                        >
                          <label className="label cursor-pointer justify-start gap-2 py-2 hover:bg-gray-100 rounded w-full">
                            <input
                              type="checkbox"
                              className="checkbox checkbox-sm pointer-events-none"
                              checked={isSelected}
                              readOnly
                            />
                            <span className="label-text flex-1">{option.label}</span>
                          </label>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
          <div className="form-control">
            <label className="label mb-2"><span className="label-text">Due:</span></label>
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
                <th>Proforma Date</th>
                <th>Handler</th>
                <th>Case</th>
                <th>Category</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !loading && (
                <tr>
                  <td colSpan={12} className="text-center py-6 text-gray-500">No payments found for the selected filters.</td>
                </tr>
              )}
              {(() => {
                // Debug: Check rows for 199849 in render
                const rowsFor199849 = rows.filter((row) => 
                  row.leadId?.toString().includes('199849') || row.caseNumber?.includes('199849')
                );
                if (rowsFor199849.length > 0) {
                  console.log(`✅ [RENDER] Found ${rowsFor199849.length} rows for 199849 in render:`, rowsFor199849.map((r: any) => ({
                    id: r.id,
                    leadId: r.leadId,
                    leadName: r.leadName,
                    caseNumber: r.caseNumber,
                    dueDate: r.dueDate,
                    collectedDate: r.collectedDate,
                    collected: r.collected,
                    categoryId: r.mainCategoryId,
                    orderCode: r.orderCode,
                  })));
                } else {
                  console.log(`❌ [RENDER] No rows for 199849 in render. Total rows: ${rows.length}`);
                }
                
                // Debug: Check rows for 155026 in render
                const rowsFor155026 = rows.filter((row) => 
                  row.leadId?.toString().includes('155026') || row.caseNumber?.includes('155026')
                );
                if (rowsFor155026.length > 0) {
                  console.log(`✅ [RENDER] Found ${rowsFor155026.length} rows for 155026 in render:`, rowsFor155026.map((r: any) => ({
                    id: r.id,
                    leadId: r.leadId,
                    leadName: r.leadName,
                    caseNumber: r.caseNumber,
                    dueDate: r.dueDate,
                    collectedDate: r.collectedDate,
                    collected: r.collected,
                    categoryId: r.mainCategoryId,
                    orderCode: r.orderCode,
                    hasProforma: r.hasProforma,
                    leadType: r.leadType,
                  })));
                } else {
                  console.log(`❌ [RENDER] No rows for 155026 in render. Total rows: ${rows.length}`);
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
                        {row.hasProforma ? 'Collected - With Proforma' : 'Collected - Without Proforma'}
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
                    {row.proformaDate ? new Date(row.proformaDate).toLocaleDateString() : '—'}
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
  console.log(`🔍 [fetchModernPayments] Starting with filters:`, filters);
  let query = supabase
    .from('payment_plans')
    .select('id, lead_id, value, value_vat, currency, due_date, payment_order, notes, paid, paid_at, proforma, client_name, cancel_date, ready_to_pay');

  // Always filter out cancelled plans
  query = query.is('cancel_date', null);
  
  // If "due date included" is selected, we still need to fetch payments that might have proforma dates
  // even if their due_date is outside the range, so we can filter by proforma date client-side
  // The comprehensive date filtering (including proforma dates) is done in loadPayments
  if (filters.due === 'due_only') {
    console.log(`🔍 [fetchModernPayments] Using 'due_only' filter mode - fetching ready_to_pay payments`);
    query = query
      .eq('ready_to_pay', true) // Sent to finance
      .not('due_date', 'is', null); // Must have due_date
      // Note: We don't filter by due_date range here - that's done client-side to include proforma dates
      // Note: Removed .eq('paid', false) to show both paid and unpaid payments
  }
  // When "due date included" is NOT selected, we fetch all non-cancelled plans
  // Date filtering (including proforma dates) is done client-side in loadPayments

  const { data, error } = await query;
  if (error) throw error;
  
  console.log(`✅ [fetchModernPayments] Fetched ${data?.length || 0} payment plans from database`);
  console.log(`🔍 [fetchModernPayments] Query filters applied:`, {
    due: filters.due,
    fromDate: filters.fromDate,
    toDate: filters.toDate,
    ready_to_pay: filters.due === 'due_only' ? true : undefined,
    cancel_date: 'null',
  });
  
  // Debug: Check for lead 155026 in raw data BEFORE any filtering
  const raw155026BeforeFilter = (data || []).filter((plan: any) => 
    plan.lead_id?.toString() === '155026' || plan.lead_id === 155026
  );
  console.log(`🔍 [fetchModernPayments] Raw payment plans for 155026 (BEFORE date filtering):`, raw155026BeforeFilter.length, raw155026BeforeFilter.map((p: any) => ({
    id: p.id,
    lead_id: p.lead_id,
    due_date: p.due_date,
    paid_at: p.paid_at,
    paid: p.paid,
    cancel_date: p.cancel_date,
    ready_to_pay: p.ready_to_pay,
    value: p.value,
    currency: p.currency,
  })));
  
  // Debug: Check for lead 199849 in raw data
  const raw199849 = (data || []).filter((plan: any) => 
    plan.lead_id?.toString() === '199849' || plan.lead_id === 199849
  );
  console.log(`🔍 [fetchModernPayments] Raw payment plans for 199849:`, raw199849.length, raw199849.map((p: any) => ({
    id: p.id,
    lead_id: p.lead_id,
    due_date: p.due_date,
    paid_at: p.paid_at,
    paid: p.paid,
    cancel_date: p.cancel_date,
    ready_to_pay: p.ready_to_pay,
    value: p.value,
  })));
  
  // Debug: Check for lead 155026 in raw data
  const raw155026 = (data || []).filter((plan: any) => 
    plan.lead_id?.toString() === '155026' || plan.lead_id === 155026
  );
  console.log(`🔍 [fetchModernPayments] Raw payment plans for 155026:`, raw155026.length, raw155026.map((p: any) => ({
    id: p.id,
    lead_id: p.lead_id,
    due_date: p.due_date,
    paid_at: p.paid_at,
    paid: p.paid,
    cancel_date: p.cancel_date,
    ready_to_pay: p.ready_to_pay,
    value: p.value,
    currency: p.currency,
  })));

  // When "due date included" is selected, all filtering is done in the query
  // When NOT selected, we only filter out cancelled plans here
  // Date range filtering (including proforma dates) is done in loadPayments after proforma dates are extracted
  const dateFilteredPlans = filters.due === 'due_only' 
    ? (data || []) // All filtering already done in query (due_date range, ready_to_pay, paid, cancel_date)
    : (data || []).filter((plan: any) => {
        // Only filter out cancelled plans here
        // Date filtering will be done in loadPayments after proforma dates are extracted
        if (plan.cancel_date) {
          return false;
        }
        return true;
      });
  
  // Debug: Check for lead 199849 after date filtering
  const dateFiltered199849 = dateFilteredPlans.filter((plan: any) => 
    plan.lead_id?.toString() === '199849' || plan.lead_id === 199849
  );
  console.log(`🔍 [fetchModernPayments] Date-filtered plans for 199849:`, dateFiltered199849.length);
  
  // Debug: Check for lead 155026 after date filtering
  const dateFiltered155026 = dateFilteredPlans.filter((plan: any) => 
    plan.lead_id?.toString() === '155026' || plan.lead_id === 155026
  );
  console.log(`🔍 [fetchModernPayments] Date-filtered plans for 155026:`, dateFiltered155026.length, dateFiltered155026.map((p: any) => ({
    id: p.id,
    lead_id: p.lead_id,
    due_date: p.due_date,
    paid_at: p.paid_at,
    paid: p.paid,
    cancel_date: p.cancel_date,
    ready_to_pay: p.ready_to_pay,
    value: p.value,
    currency: p.currency,
  })));
  
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
    
    // Extract createdAt from proforma JSON for new leads
    let proformaDate: string | null = null;
    if (plan.proforma) {
      try {
        const proformaData = typeof plan.proforma === 'string' ? JSON.parse(plan.proforma) : plan.proforma;
        if (proformaData?.createdAt) {
          // Normalize the createdAt timestamp to a date string
          proformaDate = normalizeDate(proformaData.createdAt);
        }
      } catch (e) {
        // If parsing fails, proformaDate remains null
      }
    }
    
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
      proformaDate,
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

  // Always filter out cancelled plans
  query = query.is('cancel_date', null);
  
  // If "due date included" is selected, we still need to fetch payments that might have proforma dates
  // even if their due_date is outside the range, so we can filter by proforma date client-side
  // The comprehensive date filtering (including proforma dates) is done in loadPayments
  if (filters.due === 'due_only') {
    // For legacy leads: if due_date exists, it means ready to pay (no need to check ready_to_pay flag)
    query = query.not('due_date', 'is', null); // Only fetch if due_date has a date (not NULL) - for legacy leads, due_date means ready to pay
    // Note: We don't filter by due_date range here - that's done client-side to include proforma dates
    // Note: Removed .is('actual_date', null) to show both paid and unpaid payments
    console.log(`🔍 [fetchLegacyPayments] Using 'due_only' filter mode - fetching payments with due_date`);
  }
  // When "due date included" is NOT selected, we fetch all non-cancelled plans
  // Date filtering (including proforma dates) is done client-side in loadPayments

  const { data, error } = await query;
  if (error) {
    console.error('❌ [fetchLegacyPayments] Query error:', error);
    throw error;
  }
  
  console.log(`✅ [fetchLegacyPayments] Fetched ${data?.length || 0} payment plans from database`);
  console.log(`🔍 [fetchLegacyPayments] Query filters applied:`, {
    due: filters.due,
    fromDate: filters.fromDate,
    toDate: filters.toDate,
    due_date_not_null: filters.due === 'due_only' ? true : undefined,
    cancel_date: 'null',
  });
  console.log('🔍 [fetchLegacyPayments] Sample payment plans:', data?.slice(0, 3).map((p: any) => ({
    id: p.id,
    lead_id: p.lead_id,
    client_id: p.client_id,
    date: p.date,
    due_date: p.due_date,
    cancel_date: p.cancel_date,
    actual_date: p.actual_date,
  })));
  
  // Debug: Check for lead 155026 in raw data BEFORE any filtering
  const raw155026BeforeFilter = (data || []).filter((plan: any) => 
    plan.lead_id?.toString() === '155026' || plan.lead_id === 155026 || plan.client_id?.toString() === '155026' || plan.client_id === 155026
  );
  console.log(`🔍 [fetchLegacyPayments] Raw payment plans for 155026 (BEFORE filtering):`, raw155026BeforeFilter.length, raw155026BeforeFilter.map((p: any) => ({
    id: p.id,
    lead_id: p.lead_id,
    client_id: p.client_id,
    date: p.date,
    due_date: p.due_date,
    value: p.value,
    value_base: p.value_base,
    cancel_date: p.cancel_date,
    actual_date: p.actual_date,
    ready_to_pay: p.ready_to_pay,
    currency_id: p.currency_id,
  })));

  // When "due date included" is selected, all filtering is done in the query
  // (due_date not null, actual_date is null, cancel_date is null, and date range on due_date)
  // When NOT selected, we need to filter out cancelled plans
  const activePlans = filters.due === 'due_only' 
    ? (data || []) // All filtering already done in query
    : (data || []).filter((plan: any) => !plan.cancel_date);
  
  console.log(`✅ [fetchLegacyPayments] Active plans: ${activePlans.length}`);
  
  // Debug: Check for lead 199849 specifically
  const plansFor199849 = activePlans.filter((plan: any) => 
    plan.lead_id?.toString() === '199849' || plan.lead_id === 199849 || plan.client_id?.toString() === '199849' || plan.client_id === 199849
  );
  console.log(`🔍 [fetchLegacyPayments] Payment plans for lead/client 199849:`, plansFor199849.length, plansFor199849.map((p: any) => ({
    id: p.id,
    lead_id: p.lead_id,
    client_id: p.client_id,
    date: p.date,
    due_date: p.due_date,
    value: p.value,
    cancel_date: p.cancel_date,
    actual_date: p.actual_date,
    ready_to_pay: p.ready_to_pay,
  })));
  
  // Debug: Check for lead 155026 specifically
  const plansFor155026 = activePlans.filter((plan: any) => 
    plan.lead_id?.toString() === '155026' || plan.lead_id === 155026 || plan.client_id?.toString() === '155026' || plan.client_id === 155026
  );
  console.log(`🔍 [fetchLegacyPayments] Payment plans for lead/client 155026:`, plansFor155026.length, plansFor155026.map((p: any) => ({
    id: p.id,
    lead_id: p.lead_id,
    client_id: p.client_id,
    date: p.date,
    due_date: p.due_date,
    value: p.value,
    value_base: p.value_base,
    cancel_date: p.cancel_date,
    actual_date: p.actual_date,
    ready_to_pay: p.ready_to_pay,
    currency_id: p.currency_id,
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
  console.log(`🔍 [fetchLegacyPayments] Checking if 199849 is in lead IDs:`, leadIds.includes('199849'));
  console.log(`🔍 [fetchLegacyPayments] Checking if 155026 is in lead IDs:`, leadIds.includes('155026'));
  
  // Fetch lead metadata (only for lead_ids, not client_ids)
  const leadMeta = await fetchLeadMetadata(leadIds, true);
  console.log(`✅ [fetchLegacyPayments] Fetched metadata for ${leadMeta.size} leads`);
  console.log(`🔍 [fetchLegacyPayments] Metadata for 199849:`, leadMeta.get('199849'));
  console.log(`🔍 [fetchLegacyPayments] Metadata for 155026:`, leadMeta.get('155026'));
  
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
  
  // Fetch proforma dates from proformainvoice table for legacy leads
  // IMPORTANT: Match by ppr_id (payment plan row id) to get the correct proforma for each specific payment row
  // This aligns with FinancesTab.tsx which matches proformas by ppr_id === payment.id
  const proformaDateMap = new Map<number, string | null>(); // Key: ppr_id (payment plan row id)
  if (leadIds.length > 0) {
    const numericLeadIds = leadIds.map((id) => parseInt(id, 10)).filter((id) => !Number.isNaN(id));
    if (numericLeadIds.length > 0) {
      const { data: proformas, error: proformasError } = await supabase
        .from('proformainvoice')
        .select('ppr_id, cdate')
        .in('lead_id', numericLeadIds)
        .is('cxd_date', null) // Only get active proformas (not cancelled)
        .not('ppr_id', 'is', null); // Only get proformas linked to specific payment rows
      
      if (!proformasError && proformas) {
        proformas.forEach((proforma: any) => {
          if (proforma.ppr_id) {
            const pprId = Number(proforma.ppr_id);
            if (!Number.isNaN(pprId)) {
              const normalizedDate = normalizeDate(proforma.cdate);
              
              // If multiple proformas exist for the same ppr_id, keep the most recent one
              const existingDate = proformaDateMap.get(pprId);
              if (!existingDate || (normalizedDate && existingDate && normalizedDate > existingDate)) {
                proformaDateMap.set(pprId, normalizedDate);
              }
            }
          }
        });
      }
      console.log(`✅ [fetchLegacyPayments] Fetched ${proformaDateMap.size} proforma dates (matched by ppr_id)`);
    }
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
    
    // Get proforma date for this specific payment row
    // IMPORTANT: Match by ppr_id (payment plan row id) to get the correct proforma for each payment row
    // This aligns with FinancesTab.tsx which matches proformas by ppr_id === payment.id
    const paymentRowId = plan.id ? (typeof plan.id === 'number' ? plan.id : Number(plan.id)) : null;
    let proformaDate: string | null = null;
    if (paymentRowId !== null && !Number.isNaN(paymentRowId)) {
      proformaDate = proformaDateMap.get(paymentRowId) || null;
    }
    
    // Determine if there's a proforma for this specific payment row
    const hasProforma = proformaDate !== null;
    
    // Debug for 199849
    if ((leadIdKey === '199849' || plan.lead_id === 199849)) {
      console.log(`✅ [fetchLegacyPayments] Processing payment plan for 199849:`, {
        planId: plan.id,
        lead_id: plan.lead_id,
        client_id: plan.client_id,
        contactName,
        metaFound: !!meta,
        leadName: meta?.leadName,
        caseNumber: meta?.caseNumber,
        value,
        dueDate,
        actualDate,
        proformaDate,
        hasProforma,
        collected: Boolean(actualDate),
      });
    }
    
    // Debug for 155026
    if ((leadIdKey === '155026' || plan.lead_id === 155026)) {
      console.log(`✅ [fetchLegacyPayments] Processing payment plan for 155026:`, {
        planId: plan.id,
        lead_id: plan.lead_id,
        client_id: plan.client_id,
        contactName,
        metaFound: !!meta,
        leadName: meta?.leadName,
        caseNumber: meta?.caseNumber,
        value,
        value_base: plan.value_base,
        dueDate,
        date: plan.date,
        actualDate,
        proformaDate,
        hasProforma,
        collected: Boolean(actualDate),
        cancel_date: plan.cancel_date,
        ready_to_pay: plan.ready_to_pay,
        currency_id: plan.currency_id,
        filters: {
          fromDate: filters.fromDate,
          toDate: filters.toDate,
          due: filters.due,
        },
      });
    }
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
      hasProforma,
      collectedDate: actualDate,
      dueDate,
      proformaDate,
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
      .select('id, name, anchor_full_name, lead_number, case_handler_id, category, category_id, master_id, manual_id')
      .in('id', numericIds);
    if (error) throw error;
    const categoryMap = await fetchCategoryMap((data || []).map((lead) => lead.category_id).filter(Boolean));
    const legacyHandlerIds = (data || [])
      .map((lead) => normalizeHandlerId(lead.case_handler_id))
      .filter((id): id is number => id !== null);
    const handlerMap = await fetchHandlerNames(legacyHandlerIds);
    const contactMap = await fetchContactNameMap(normalizedIds, true);
    
    // Calculate sublead suffixes for all leads with master_id
    const subLeadSuffixMap = new Map<string, number>();
    const leadsWithMaster = (data || []).filter((lead) => lead.master_id);
    const masterIds = Array.from(new Set(leadsWithMaster.map((lead) => lead.master_id?.toString()).filter(Boolean)));
    
    if (masterIds.length > 0) {
      // Fetch all subleads for all master_ids in one query
      const numericMasterIds = masterIds.map((id) => parseInt(id, 10)).filter((id) => !Number.isNaN(id));
      if (numericMasterIds.length > 0) {
        const { data: allSubLeads } = await supabase
          .from('leads_lead')
          .select('id, master_id')
          .in('master_id', numericMasterIds)
          .not('master_id', 'is', null)
          .order('master_id', { ascending: true })
          .order('id', { ascending: true });
        
        if (allSubLeads) {
          // Group by master_id and calculate suffixes
          const subLeadsByMaster = new Map<number, any[]>();
          allSubLeads.forEach((subLead) => {
            const masterId = subLead.master_id;
            if (masterId) {
              if (!subLeadsByMaster.has(masterId)) {
                subLeadsByMaster.set(masterId, []);
              }
              subLeadsByMaster.get(masterId)!.push(subLead);
            }
          });
          
          // Calculate suffixes for each master's subleads
          subLeadsByMaster.forEach((subLeads, masterId) => {
            subLeads.forEach((subLead, index) => {
              const subLeadKey = subLead.id?.toString();
              if (subLeadKey) {
                // Suffix starts at 2 (first sub-lead is /2, second is /3, etc.)
                subLeadSuffixMap.set(subLeadKey, index + 2);
              }
            });
          });
        }
      }
    }
    
    (data || []).forEach((lead) => {
      const key = lead.id?.toString();
      if (!key) return;
      const cat = categoryMap.get(lead.category_id ?? null);
      const contactName = contactMap.get(key);
      const handlerId = normalizeHandlerId(lead.case_handler_id);
      
      // Format case number with sublead suffix if applicable
      let caseNumber: string;
      if (lead.master_id) {
        // It's a sublead - format as master_id/suffix
        const suffix = subLeadSuffixMap.get(key) || 2;
        caseNumber = `#${lead.master_id}/${suffix}`;
      } else {
        // It's a master lead or standalone lead
        caseNumber = `#${lead.lead_number || lead.manual_id || lead.id}`;
      }
      
      map.set(key, {
        id: key,
        leadName: lead.name || lead.anchor_full_name || contactName || `Lead #${lead.id}`,
        clientName: contactName || lead.anchor_full_name || lead.name || `Lead #${lead.id}`,
        caseNumber,
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
    .select('id, name, lead_number, anchor_full_name, case_handler_id, category_id, category, master_id, manual_id')
    .in('id', normalizedIds);
  if (error) throw error;
  const categoryMap = await fetchCategoryMap((data || []).map((lead) => lead.category_id).filter(Boolean));
  const handlerIds = (data || [])
    .map((lead) => normalizeHandlerId(lead.case_handler_id))
    .filter((id): id is number => id !== null);
  const handlerMap = await fetchHandlerNames(handlerIds);
  const contactMap = await fetchContactNameMap(normalizedIds, false);
  
  // Calculate sublead suffixes for all leads with master_id
  const subLeadSuffixMap = new Map<string, number>();
  const leadsWithMaster = (data || []).filter((lead) => lead.master_id);
  const masterIds = Array.from(new Set(leadsWithMaster.map((lead) => lead.master_id?.toString()).filter(Boolean)));
  
  if (masterIds.length > 0) {
    // Fetch all subleads for all master_ids in one query
    const { data: allSubLeads } = await supabase
      .from('leads')
      .select('id, master_id')
      .in('master_id', masterIds)
      .not('master_id', 'is', null)
      .order('master_id', { ascending: true })
      .order('id', { ascending: true });
    
    if (allSubLeads) {
      // Group by master_id and calculate suffixes
      const subLeadsByMaster = new Map<string, any[]>();
      allSubLeads.forEach((subLead) => {
        const masterId = subLead.master_id?.toString();
        if (masterId) {
          if (!subLeadsByMaster.has(masterId)) {
            subLeadsByMaster.set(masterId, []);
          }
          subLeadsByMaster.get(masterId)!.push(subLead);
        }
      });
      
      // Calculate suffixes for each master's subleads
      subLeadsByMaster.forEach((subLeads, masterId) => {
        subLeads.forEach((subLead, index) => {
          const subLeadKey = subLead.id?.toString();
          if (subLeadKey) {
            // Suffix starts at 2 (first sub-lead is /2, second is /3, etc.)
            subLeadSuffixMap.set(subLeadKey, index + 2);
          }
        });
      });
    }
  }
  
  (data || []).forEach((lead) => {
    const key = lead.id?.toString();
    if (!key) return;
    const contactName = contactMap.get(key);
    const categoryMeta = categoryMap.get(lead.category_id ?? null);
    const handlerId = normalizeHandlerId(lead.case_handler_id);
    
    // Format case number with sublead suffix if applicable
    let caseNumber: string;
    if (lead.master_id) {
      // It's a sublead - format as master_id/suffix
      const suffix = subLeadSuffixMap.get(key) || 2;
      caseNumber = `#${lead.master_id}/${suffix}`;
    } else {
      // It's a master lead or standalone lead
      caseNumber = lead.lead_number ? `#${lead.lead_number}` : `#${lead.id}`;
    }
    
    map.set(key, {
      id: key,
      leadName: lead.name || lead.anchor_full_name || contactName || `Lead #${lead.id}`,
      clientName: contactName || lead.anchor_full_name || lead.name || `Lead #${lead.id}`,
      caseNumber,
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
  // For new leads, use caseNumber (which contains lead_number) instead of leadId (which is the id)
  if (row.leadType === 'new') {
    const cleanNumber = row.caseNumber?.replace(/^#/, '') || '';
    if (cleanNumber) {
      return `/clients/${encodeURIComponent(cleanNumber)}`;
    }
  }
  
  // For legacy leads, use leadId (remove legacy_ prefix)
  const leadIdentifier = row.leadId?.toString().trim();
  if (leadIdentifier) {
    const normalized = leadIdentifier.replace(/^legacy_/, '');
    if (normalized) {
      return `/clients/${encodeURIComponent(normalized)}`;
    }
  }
  
  // Fallback to caseNumber if available
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

