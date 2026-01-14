import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PencilSquareIcon, CheckIcon, XMarkIcon, ChevronDownIcon, ArrowLeftIcon } from '@heroicons/react/24/outline';
import { MagnifyingGlassIcon, Squares2X2Icon, ArrowUturnDownIcon, DocumentDuplicateIcon, ChartPieIcon, AdjustmentsHorizontalIcon, FunnelIcon, ClockIcon, ArrowPathIcon, CheckCircleIcon, BanknotesIcon, UserGroupIcon, UserIcon, AcademicCapIcon, StarIcon, PlusIcon, ChartBarIcon, ListBulletIcon, CurrencyDollarIcon, BriefcaseIcon, RectangleStackIcon } from '@heroicons/react/24/solid';
import { supabase } from '../lib/supabase';
import { convertToNIS, getCurrencySymbol } from '../lib/currencyConversion';
import { fetchStageNames, areStagesEquivalent } from '../lib/stageUtils';
import { usePersistedFilters } from '../hooks/usePersistedState';

type EmployeeOption = {
  id: string;
  display_name: string;
};

type SignedLeadRow = {
  id: string;
  leadType: 'new' | 'legacy';
  leadNumber: string;
  leadIdentifier: string;
  leadName: string;
  createdDate: string | null;
  category: string;
  stage: string;
  signDate: string | null;
  scheduler?: string;
  manager?: string;
  closer?: string;
  expert?: string;
  handler?: string;
  schedulerId?: string | null;
  managerId?: string | null;
  closerId?: string | null;
  expertId?: string | null;
  handlerId?: string | null;
  totalOriginal: number;
  totalOriginalDisplay: string;
  totalNIS: number;
  totalNISDisplay: string;
  hasPaymentPlan?: boolean;
  subcontractorFee?: number;
  subcontractorFeeNIS?: number;
};

type RoleKey = 'scheduler' | 'manager' | 'closer' | 'expert' | 'handler';

type RoleEditorState = {
  leadId: string;
  role: RoleKey;
  value: string;
  initialValue: string;
};

type CurrencyMeta = {
  displaySymbol: string;
  conversionValue: string | number;
};

type FiltersState = {
  fromDate: string;
  toDate: string;
  category: string;
  employee: string;
  language: string;
};

const signedStageNames = [
  'Client signed agreement',
  'Client Signed Agreement',
  'client_signed',
  'Client Signed',
  'Mtng sum+Agreement sent',
];

const currencyCodeToSymbol: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  NIS: '₪',
  ILS: '₪',
  CAD: '$',
  AUD: '$',
  CHF: 'CHF',
  RUB: '₽',
  JPY: '¥',
  CNY: '¥',
};

const symbolToCurrencyCode: Record<string, string> = Object.entries(currencyCodeToSymbol).reduce(
  (acc, [code, symbol]) => {
    if (!acc[symbol]) {
      acc[symbol] = code;
    }
    return acc;
  },
  {} as Record<string, string>
);

const roleConfig: Record<RoleKey, { label: string; newLeadField: string; legacyFields: string[] }> = {
  scheduler: {
    label: 'Scheduler',
    newLeadField: 'scheduler',
    legacyFields: ['meeting_scheduler_id'],
  },
  manager: {
    label: 'Manager',
    newLeadField: 'manager',
    legacyFields: ['meeting_manager_id'],
  },
  closer: {
    label: 'Closer',
    newLeadField: 'closer',
    legacyFields: ['closer_id'],
  },
  expert: {
    label: 'Expert',
    newLeadField: 'expert',
    legacyFields: ['expert_id'],
  },
  handler: {
    label: 'Handler',
    newLeadField: 'handler',
    legacyFields: ['case_handler_id'],
  },
};

const formatCurrencyDisplay = (amount: number, symbol: string) => {
  const rounded = Number.isFinite(amount) ? Math.round(amount) : 0;
  const finalSymbol = symbol && symbol.trim() !== '' ? symbol : '₪';
  return `${finalSymbol} ${rounded.toLocaleString('en-US')}`;
};

const formatDate = (value?: string | null) => {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleDateString();
};

const normalizeString = (value?: string | null) => (value || '').trim().toLowerCase();

const SIGNED_STAGE_TOKENS = new Set([
  'clientsignedagreement',
  'client_signed',
  'client signed agreement',
]);

const toStartOfDayIso = (dateStr: string) => {
  const date = new Date(`${dateStr}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const toNextDayIso = (dateStr: string) => {
  const date = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() + 1);
  return date.toISOString();
};

const computeDateBounds = (fromDate?: string, toDate?: string) => {
  const startIso = fromDate ? toStartOfDayIso(fromDate) : null;
  const endIso = (() => {
    if (toDate) return toNextDayIso(toDate);
    if (fromDate) return toNextDayIso(fromDate);
    return null;
  })();
  return { startIso, endIso };
};

const extractCurrencyCandidate = (candidate: any): any => {
  if (candidate === null || candidate === undefined) return null;
  if (Array.isArray(candidate)) {
    for (const item of candidate) {
      const extracted = extractCurrencyCandidate(item);
      if (extracted !== null && extracted !== undefined) return extracted;
    }
    return null;
  }
  if (typeof candidate === 'object') {
    if ('iso_code' in candidate && candidate.iso_code) return candidate.iso_code;
    if ('symbol' in candidate && candidate.symbol) return candidate.symbol;
    if ('name' in candidate && candidate.name) return candidate.name;
    return null;
  }
  return candidate;
};

const buildCurrencyMeta = (...candidates: any[]): CurrencyMeta => {
  for (const candidate of candidates) {
    const rawValue = extractCurrencyCandidate(candidate);
    if (rawValue === null || rawValue === undefined) continue;

    if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
      return {
        displaySymbol: getCurrencySymbol(rawValue),
        conversionValue: rawValue,
      };
    }

    const valueStr = rawValue.toString().trim();
    if (!valueStr) continue;

    const numeric = Number(valueStr);
    if (!Number.isNaN(numeric) && numeric.toString() === valueStr) {
      return {
        displaySymbol: getCurrencySymbol(numeric),
        conversionValue: numeric,
      };
    }

    if (valueStr.length === 1) {
      if (symbolToCurrencyCode[valueStr]) {
        const code = symbolToCurrencyCode[valueStr];
        return {
          displaySymbol: valueStr,
          conversionValue: code,
        };
      }
      if (!/^[0-9]$/.test(valueStr)) {
        return {
          displaySymbol: valueStr,
          conversionValue: valueStr,
        };
      }
    }

    const upper = valueStr.toUpperCase();
    if (upper === '₪') {
      return {
        displaySymbol: '₪',
        conversionValue: 'NIS',
      };
    }
    if (upper === 'NIS' || upper === 'ILS') {
      return {
        displaySymbol: '₪',
        conversionValue: 'NIS',
      };
    }
    if (currencyCodeToSymbol[upper]) {
      return {
        displaySymbol: currencyCodeToSymbol[upper],
        conversionValue: upper,
      };
    }

    if (symbolToCurrencyCode[valueStr]) {
      const code = symbolToCurrencyCode[valueStr];
      return {
        displaySymbol: valueStr,
        conversionValue: code,
      };
    }

    if (/^[A-Z]{3}$/.test(upper)) {
      return {
        displaySymbol: upper,
        conversionValue: upper,
      };
    }

    return {
      displaySymbol: valueStr,
      conversionValue: valueStr,
    };
  }

  return {
    displaySymbol: '₪',
    conversionValue: 'NIS',
  };
};

// Reports list for search functionality
type ReportItem = {
  label: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  component?: React.FC;
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

const SignedSalesReportPage: React.FC = () => {
  const navigate = useNavigate();
  const todayIso = useMemo(() => new Date().toISOString().split('T')[0], []);
  const [filters, setFilters] = usePersistedFilters<FiltersState>('signedSalesReport_filters', {
    fromDate: todayIso,
    toDate: todayIso,
    category: '',
    employee: '',
    language: '',
  }, {
    storage: 'sessionStorage',
  });
  const [searchQuery, setSearchQuery] = usePersistedFilters<string>('signedSalesReport_searchQuery', '', {
    storage: 'sessionStorage',
  });
  const [stageMap, setStageMap] = useState<{ [key: string]: string }>({});
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [categoryOptions, setCategoryOptions] = useState<string[]>([]);
  const [languageOptions, setLanguageOptions] = useState<string[]>([]);
  const [categoryNameToDataMap, setCategoryNameToDataMap] = useState<Map<string, any>>(new Map());
  const [categoryNameToIdMap, setCategoryNameToIdMap] = useState<Map<string, number>>(new Map());
  const [rows, setRows] = usePersistedFilters<SignedLeadRow[]>('signedSalesReport_results', [], {
    storage: 'sessionStorage',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [searchPerformed, setSearchPerformed] = usePersistedFilters('signedSalesReport_performed', false, {
    storage: 'sessionStorage',
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [roleEditor, setRoleEditor] = useState<RoleEditorState | null>(null);
  const [isSavingRole, setIsSavingRole] = useState(false);
  const [filterDropdownOpen, setFilterDropdownOpen] = useState({
    employee: false,
    category: false,
    language: false,
  });
  const [sortByHandler, setSortByHandler] = useState<boolean>(false);
  const employeeFilterRef = useRef<HTMLDivElement | null>(null);
  const categoryFilterRef = useRef<HTMLDivElement | null>(null);
  const languageFilterRef = useRef<HTMLDivElement | null>(null);

  const employeeOptionLabels = useMemo(() => {
    const labels = employees.map(emp => emp.display_name || '').filter(Boolean);
    return Array.from(new Set(labels)).sort((a, b) => a.localeCompare(b));
  }, [employees]);

  const employeeIdMap = useMemo(() => {
    const map = new Map<string, string>();
    employees.forEach(emp => {
      if (!emp?.id) return;
      const display = emp.display_name || '';
      if (!display) return;
      map.set(emp.id.toString(), display);
    });
    return map;
  }, [employees]);

  const resolveEmployeeDisplayValue = useCallback(
    (value: any) => {
      if (value === null || value === undefined) return '';
      const trimmed = value.toString().trim();
      if (!trimmed) return '';
      return employeeIdMap.get(trimmed) || trimmed;
    },
    [employeeIdMap],
  );

  const resolveEmployeeIdValue = useCallback(
    (value: any) => {
      if (value === null || value === undefined) return null;
      const trimmed = value.toString().trim();
      if (!trimmed) return null;
      return employeeIdMap.has(trimmed) ? trimmed : null;
    },
    [employeeIdMap],
  );

  const filteredEmployeeOptions = useMemo(() => {
    const term = normalizeString(filters.employee);
    if (!term) return employeeOptionLabels;
    return employeeOptionLabels.filter(label => normalizeString(label).includes(term));
  }, [filters.employee, employeeOptionLabels]);

  const filteredCategoryOptions = useMemo(() => {
    const term = normalizeString(filters.category);
    if (!term) return categoryOptions;
    return categoryOptions.filter(option => normalizeString(option).includes(term));
  }, [filters.category, categoryOptions]);

  const filteredLanguageOptions = useMemo(() => {
    const term = normalizeString(filters.language);
    if (!term) return languageOptions;
    return languageOptions.filter(option => normalizeString(option).includes(term));
  }, [filters.language, languageOptions]);

  // Normalize unassigned role values to a single consistent string
  const normalizeRoleValue = (value: string | null | undefined): string => {
    if (!value) return '';
    const trimmed = value.trim();
    // Normalize all variations of "unassigned" to empty string
    if (
      trimmed === '' ||
      trimmed === '---' ||
      trimmed.toLowerCase() === 'not assigned' ||
      trimmed === '—' ||
      trimmed === '–'
    ) {
      return '';
    }
    return trimmed;
  };

  const getRoleDisplay = (row: SignedLeadRow, role: RoleKey): string => {
    let rawValue: string | null | undefined;
    switch (role) {
      case 'scheduler':
        rawValue = row.scheduler;
        break;
      case 'manager':
        rawValue = row.manager;
        break;
      case 'closer':
        rawValue = row.closer;
        break;
      case 'expert':
        rawValue = row.expert;
        break;
      case 'handler':
        rawValue = row.handler;
        break;
      default:
        return '';
    }
    return normalizeRoleValue(rawValue);
  };

  const getRoleIdValue = (row: SignedLeadRow, role: RoleKey): string => {
    switch (role) {
      case 'scheduler':
        return row.schedulerId ?? '';
      case 'manager':
        return row.managerId ?? '';
      case 'closer':
        return row.closerId ?? '';
      case 'expert':
        return row.expertId ?? '';
      case 'handler':
        return row.handlerId ?? '';
      default:
        return '';
    }
  };

  const updateRowWithRole = (
    leadId: string,
    role: RoleKey,
    displayValue: string,
    idValue: string | null
  ) => {
    setRows(prevRows =>
      prevRows.map(row => {
        if (row.id !== leadId) return row;
        const cleanedDisplay = displayValue || '';
        const cleanedId = idValue ?? null;
        switch (role) {
          case 'scheduler':
            return { ...row, scheduler: cleanedDisplay, schedulerId: cleanedId };
          case 'manager':
            return { ...row, manager: cleanedDisplay, managerId: cleanedId };
          case 'closer':
            return { ...row, closer: cleanedDisplay, closerId: cleanedId };
          case 'expert':
            return { ...row, expert: cleanedDisplay, expertId: cleanedId };
          case 'handler':
            return { ...row, handler: cleanedDisplay, handlerId: cleanedId };
          default:
            return row;
        }
      })
    );
  };

  const buildRoleOptions = (row: SignedLeadRow, role: RoleKey) => {
    const isLegacy = row.leadType === 'legacy';
    const baseOptions = employees.map(emp => ({
      value: emp.id,
      label: emp.display_name,
    }));
    const currentValue = getRoleIdValue(row, role);
    const currentLabel = getRoleDisplay(row, role) || currentValue;
    if (
      currentValue &&
      !baseOptions.some(option => option.value === currentValue)
    ) {
      baseOptions.unshift({ value: currentValue, label: currentLabel || currentValue });
    }
    return baseOptions;
  };

  const startRoleEdit = (row: SignedLeadRow, role: RoleKey) => {
    if (isSavingRole) return;
    const initialValue = getRoleIdValue(row, role);
    setRoleEditor({
      leadId: row.id,
      role,
      value: initialValue,
      initialValue,
    });
    setErrorMessage(null);
  };

  const handleRoleValueChange = (value: string) => {
    setRoleEditor(prev => (prev ? { ...prev, value } : prev));
  };

  const cancelRoleEdit = () => {
    if (isSavingRole) return;
    setRoleEditor(null);
  };

  const handleRoleSave = async () => {
    if (!roleEditor) return;
    if (roleEditor.value === roleEditor.initialValue) {
      setRoleEditor(null);
      return;
    }

    const row = rows.find(r => r.id === roleEditor.leadId);
    if (!row) {
      setRoleEditor(null);
      return;
    }

    setIsSavingRole(true);
    setErrorMessage(null);

    try {
      if (row.leadType === 'new') {
        const payload: Record<string, any> = {};
        payload[roleConfig[roleEditor.role].newLeadField] = roleEditor.value || null;
        const leadId = row.id;
        const { error } = await supabase
          .from('leads')
          .update(payload)
          .eq('id', leadId);
        if (error) throw error;

        const displayName =
          roleEditor.value && employeeIdMap.get(roleEditor.value)
            ? employeeIdMap.get(roleEditor.value)!
            : roleEditor.value || '';

        updateRowWithRole(
          row.id,
          roleEditor.role,
          displayName,
          roleEditor.value ? roleEditor.value : null
        );
      } else {
        const numericId = Number(row.id.replace('legacy-', ''));
        if (!Number.isFinite(numericId)) {
          throw new Error('Invalid legacy lead identifier');
        }

        const numericValue = roleEditor.value ? Number(roleEditor.value) : null;
        if (roleEditor.value && Number.isNaN(numericValue)) {
          throw new Error('Invalid employee selection value');
        }

        const payload: Record<string, any> = {};
        roleConfig[roleEditor.role].legacyFields.forEach(field => {
          payload[field] = numericValue;
        });

        const { error } = await supabase
          .from('leads_lead')
          .update(payload)
          .eq('id', numericId);
        if (error) throw error;

        const displayValue = numericValue !== null
          ? employees.find(emp => emp.id === String(numericValue))?.display_name || ''
          : '';

        updateRowWithRole(
          row.id,
          roleEditor.role,
          displayValue,
          numericValue !== null ? String(numericValue) : null
        );
      }

      setRoleEditor(null);
    } catch (error: any) {
      console.error('Failed to update employee assignment:', error);
      setErrorMessage(
        error?.message || 'Failed to update employee assignment. Please try again.'
      );
    } finally {
      setIsSavingRole(false);
    }
  };

  const renderRoleCell = (row: SignedLeadRow, role: RoleKey) => {
    const isEditing = roleEditor && roleEditor.leadId === row.id && roleEditor.role === role;
    const currentDisplay = getRoleDisplay(row, role);

    if (!isEditing) {
      // Use consistent "---" string for all unassigned roles
      const displayText = currentDisplay && currentDisplay.trim() !== '' ? currentDisplay : '---';
      return (
        <div className="flex items-center gap-2">
          <span>{displayText}</span>
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={() => startRoleEdit(row, role)}
            title={`Change ${roleConfig[role].label}`}
            disabled={isSavingRole}
          >
            <PencilSquareIcon className="w-4 h-4" />
          </button>
        </div>
      );
    }

    const options = buildRoleOptions(row, role);
    const disableSave = isSavingRole || roleEditor.value === roleEditor.initialValue;

    return (
      <div className="flex flex-col gap-2">
        <select
          className="select select-bordered select-sm w-full md:w-56"
          value={roleEditor.value}
          onChange={event => handleRoleValueChange(event.target.value)}
          disabled={isSavingRole}
        >
          <option value="">Unassigned</option>
          {options.map(option => (
            <option key={`${row.id}-${role}-${option.value}`} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn btn-primary btn-xs"
            onClick={handleRoleSave}
            disabled={disableSave}
          >
            <CheckIcon className="w-4 h-4" />
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={cancelRoleEdit}
            disabled={isSavingRole}
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  };

  const stageNameLookup = useMemo(() => {
    const lookup = new Map<string, string>();
    Object.values(stageMap).forEach(name => {
      if (!name) return;
      const normalized = normalizeString(name);
      if (normalized) {
        lookup.set(normalized, name);
      }
    });
    return lookup;
  }, [stageMap]);

  useEffect(() => {
    const loadInitialData = async () => {
      try {
        const [
          stageResult,
          activeUsersResult,
          categoriesResult,
          languagesResult,
        ] = await Promise.all([
          fetchStageNames(),
          supabase
            .from('users')
            .select(`
              employee_id,
              full_name,
              is_active,
              tenants_employee!employee_id (
                id,
                display_name
              )
            `)
            .eq('is_active', true)
            .order('full_name', { ascending: true }),
          supabase
            .from('misc_category')
            .select(`
              id,
              name,
              parent_id,
              misc_maincategory!parent_id (
                id,
                name
              )
            `)
            .order('name', { ascending: true }),
          supabase
            .from('misc_language')
            .select('id, name')
            .order('name', { ascending: true }),
        ]);

        setStageMap(stageResult);
        if (activeUsersResult.data) {
          const employeeMap = new Map<string, string>();
          activeUsersResult.data.forEach(user => {
            if (!user?.employee_id) return;
            const employeeRelation = Array.isArray(user.tenants_employee)
              ? user.tenants_employee[0]
              : user.tenants_employee;
            const displayName = employeeRelation?.display_name || user.full_name || '';
            if (!displayName || displayName.includes('@')) return;
            employeeMap.set(String(user.employee_id), displayName.trim());
          });

          const uniqueEmployees = Array.from(employeeMap.entries())
            .map(([id, name]) => ({
              id,
              display_name: name,
            }))
            .sort((a, b) => a.display_name.localeCompare(b.display_name));
          setEmployees(uniqueEmployees);
        }

        if (!categoriesResult.error && categoriesResult.data) {
          // Create a map from category name (normalized) to category data (including main category)
          const nameToDataMap = new Map<string, any>();
          categoriesResult.data.forEach((category: any) => {
            if (category.name) {
              const normalizedName = category.name.trim().toLowerCase();
              nameToDataMap.set(normalizedName, category);
            }
          });
          setCategoryNameToDataMap(nameToDataMap);
          
          // Extract only main categories (unique main category names)
          const mainCategorySet = new Set<string>();
          categoriesResult.data.forEach((category: any) => {
            const mainName = Array.isArray(category.misc_maincategory)
              ? category.misc_maincategory[0]?.name
              : category.misc_maincategory?.name;
            if (mainName && mainName.trim() !== '') {
              mainCategorySet.add(mainName.trim());
            }
          });
          const uniqueMainCategories = Array.from(mainCategorySet).sort((a, b) => a.localeCompare(b));
          setCategoryOptions(uniqueMainCategories);
        } else if (categoriesResult.error) {
          console.error('Error fetching categories for signed report:', categoriesResult.error);
        }

        if (!languagesResult.error && languagesResult.data) {
          const languageLabels = Array.from(
            new Set(
              languagesResult.data
                .map(lang => lang.name)
                .filter((name): name is string => typeof name === 'string' && name.trim() !== '')
            )
          );
          setLanguageOptions(languageLabels);
        } else if (languagesResult.error) {
          console.error('Error fetching languages for signed report:', languagesResult.error);
        }
      } catch (error) {
        console.error('Failed to preload Signed Sales Report data:', error);
      }
    };

    loadInitialData();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (employeeFilterRef.current && !employeeFilterRef.current.contains(target)) {
        setFilterDropdownOpen(prev => ({ ...prev, employee: false }));
      }
      if (categoryFilterRef.current && !categoryFilterRef.current.contains(target)) {
        setFilterDropdownOpen(prev => ({ ...prev, category: false }));
      }
      if (languageFilterRef.current && !languageFilterRef.current.contains(target)) {
        setFilterDropdownOpen(prev => ({ ...prev, language: false }));
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleFilterChange = (field: keyof FiltersState, value: string) => {
    setFilters(prev => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleFilterSelection = (field: Extract<keyof FiltersState, 'employee' | 'category' | 'language'>, value: string) => {
    handleFilterChange(field, value);
    setFilterDropdownOpen(prev => ({ ...prev, [field]: false }));
  };

  const toggleFilterDropdown = (field: Extract<keyof FiltersState, 'employee' | 'category' | 'language'>) => {
    setFilterDropdownOpen(prev => ({ ...prev, [field]: !prev[field] }));
  };

  const employeeNameToId = useMemo(() => {
    const map = new Map<string, string>();
    employees.forEach(emp => {
      map.set(normalizeString(emp.display_name), emp.id);
    });
    return map;
  }, [employees]);

  const parseNumericAmount = (value: any) => {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const cleaned = value.replace(/[^0-9.-]/g, '');
      const parsed = parseFloat(cleaned);
      return Number.isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  };

  const matchesCategoryFilter = (categoryValue: string) => {
    if (!filters.category) return true;
    const normalizedCategory = normalizeString(filters.category);
    const normalizedValue = normalizeString(categoryValue);
    
    // Extract main category from the full category string (format: "Main Category › Sub Category")
    const mainCategoryMatch = normalizedValue.match(/^([^›]+)/);
    const mainCategory = mainCategoryMatch ? mainCategoryMatch[1].trim() : normalizedValue;
    
    // Match if the main category matches the filter
    return mainCategory === normalizedCategory;
  };

  const matchesLanguageFilter = (languageValue: string) => {
    if (!filters.language) return true;
    return normalizeString(languageValue) === normalizeString(filters.language);
  };

  const matchesEmployeeFilterNewLead = (lead: any, employeeName: string) => {
    if (!employeeName) return true;
    const target = normalizeString(employeeName);
    const candidates = [
      lead.scheduler,
      lead.manager,
      lead.closer,
      lead.expert,
      lead.handler,
    ].map(value => normalizeString(resolveEmployeeDisplayValue(value)));
    return candidates.some(candidate => candidate && candidate === target);
  };

  const matchesEmployeeFilterLegacyLead = (lead: any, employeeName: string) => {
    if (!employeeName) return true;
    const normalizedName = normalizeString(employeeName);
    const employeeId = employeeNameToId.get(normalizedName);
    if (!employeeId) return false;
    const numericId = Number(employeeId);
    const legacyIds = [
      lead.meeting_scheduler_id,
      lead.meeting_manager_id,
      lead.meeting_lawyer_id,
      lead.case_handler_id,
      lead.closer_id,
      lead.expert_id,
    ]
      .map(value => (value !== null && value !== undefined ? Number(value) : null))
      .filter(value => value !== null);
    return legacyIds.some(id => id === numericId);
  };

  const resolveLegacyEmployeeName = (identifier?: string | number | null) => {
    if (identifier === null || identifier === undefined) return '';
    const match = employees.find(emp => emp.id === String(identifier));
    return match?.display_name || '';
  };

const resolveCategoryName = (
  categoryValue?: string | null,
  categoryId?: string | number | null,
  miscCategory?: any,
  categoryNameToDataMap?: Map<string, any>
) => {
  // If we have categoryValue but no miscCategory, try to look it up in the map
  let resolvedMiscCategory = miscCategory;
  if (!miscCategory && categoryValue && categoryValue.trim() !== '' && categoryNameToDataMap) {
    const normalizedName = categoryValue.trim().toLowerCase();
    const mappedCategory = categoryNameToDataMap.get(normalizedName);
    if (mappedCategory) {
      resolvedMiscCategory = mappedCategory;
    }
  }
  
  // Handle null/undefined
  if (!resolvedMiscCategory) {
    if (categoryValue && categoryValue.trim() !== '') return categoryValue;
    if (categoryId !== null && categoryId !== undefined) return `Category ${categoryId}`;
    return 'Uncategorized';
  }

  // Handle array case (shouldn't happen, but be safe)
  const categoryRecord = Array.isArray(resolvedMiscCategory) ? resolvedMiscCategory[0] : resolvedMiscCategory;
  if (!categoryRecord) {
    if (categoryValue && categoryValue.trim() !== '') return categoryValue;
    if (categoryId !== null && categoryId !== undefined) return `Category ${categoryId}`;
    return 'Uncategorized';
  }

  // Extract main category (handle both array and object cases)
  let mainCategory = Array.isArray(categoryRecord.misc_maincategory)
    ? categoryRecord.misc_maincategory[0]
    : categoryRecord.misc_maincategory;

  const mainName = mainCategory?.name?.toString().trim();
  const subName = categoryRecord?.name?.toString().trim();

  // Debug logging for missing main categories (can be removed after debugging)
  if (subName && !mainName && categoryId) {
    console.warn('Category missing main category:', {
      categoryId,
      subName,
      categoryRecord,
      hasParentId: !!categoryRecord.parent_id,
      miscMaincategory: categoryRecord.misc_maincategory
    });
  }

  // Always show both if we have them
  if (mainName && subName) {
    return `${mainName} › ${subName}`;
  }
  // If we only have subName, return it (this is the case where join failed or category has no parent)
  if (subName) {
    return subName;
  }
  // If we only have mainName (unusual case), return it
  if (mainName) {
    return mainName;
  }
  // Fallback to categoryValue or categoryId
  if (categoryValue && categoryValue.trim() !== '') return categoryValue;
  if (categoryId !== null && categoryId !== undefined) return `Category ${categoryId}`;
  return 'Uncategorized';
};

const resolveLegacyCategory = (lead: any, categoryNameToDataMap?: Map<string, any>) =>
  resolveCategoryName(lead?.category, lead?.category_id, lead?.misc_category, categoryNameToDataMap);

const resolveLegacyLanguage = (lead: any) => {
  const languageRecord = Array.isArray(lead?.misc_language)
    ? lead.misc_language[0]
    : lead?.misc_language;
  if (languageRecord?.name) {
    return languageRecord.name;
  }
  if (lead?.language && typeof lead.language === 'string') {
    return lead.language;
  }
  if (lead?.language_id !== undefined && lead?.language_id !== null) {
    return String(lead.language_id);
  }
  return '';
};

  const formatStageLabel = (stage: string | null | undefined) => {
    if (!stage) return '—';
    const trimmed = stage.toString().trim();
    const cached = stageMap[trimmed];
    if (cached) return cached.trim();
    return trimmed
      .replace(/_/g, ' ')
      .replace(/\b\w/g, letter => letter.toUpperCase());
  };

  const handleSearch = async () => {
    setIsLoading(true);
    setSearchPerformed(true);
    setErrorMessage(null);

    try {
      const employeeFilterName = filters.employee;
      const fromDate = filters.fromDate;
      const toDate = filters.toDate;
      const categoryFilter = filters.category;
      const languageFilter = filters.language;
      const { startIso, endIso } = computeDateBounds(fromDate, toDate);

      console.log(`🔍 DEBUG Date Filter Input:`, {
        fromDate,
        toDate,
        startIso,
        endIso,
        startDate: startIso ? new Date(startIso).toISOString() : null,
        endDate: endIso ? new Date(endIso).toISOString() : null
      });

      // DEBUG: First check ALL stage 60 records for lead 6 without date filter
      const debugLeadId: number = 6;
      const { data: allRecordsForLead6, error: debugError6 } = await supabase
        .from('leads_leadstage')
        .select('id, lead_id, newlead_id, date, cdate, stage')
        .eq('stage', 60)
        .eq('lead_id', debugLeadId);
      
      if (!debugError6 && allRecordsForLead6 && allRecordsForLead6.length > 0) {
        console.log(`🔍 DEBUG Lead ${debugLeadId}: Found ${allRecordsForLead6.length} stage 60 records WITHOUT date filter:`, allRecordsForLead6.map(r => ({
          id: r.id,
          lead_id: r.lead_id,
          newlead_id: r.newlead_id,
          date: r.date,
          cdate: r.cdate,
          stage: r.stage,
          dateISO: r.date ? new Date(r.date).toISOString() : null,
          cdateISO: r.cdate ? new Date(r.cdate).toISOString() : null,
          dateInRange: startIso && endIso ? (r.date && r.date >= startIso && r.date < endIso) : 'N/A',
          cdateInRange: startIso && endIso ? (r.cdate && r.cdate >= startIso && r.cdate < endIso) : 'N/A',
          dateComparison: startIso && r.date ? {
            date: r.date,
            startIso,
            isGTE: r.date >= startIso,
            endIso,
            isLT: r.date < endIso,
            willPass: r.date >= startIso && r.date < endIso
          } : null
        })));
      } else {
        console.log(`🔍 DEBUG Lead ${debugLeadId}: No stage 60 records found at all (error: ${debugError6?.message || 'none'})`);
      }

      // Fetch ALL stage 60 records from leads_leadstage filtered by date
      // This is the authoritative source for signed agreements
      let stage60Query = supabase
        .from('leads_leadstage')
        .select('id, lead_id, newlead_id, stage, cdate, date')
        .eq('stage', 60); // Stage 60 = Client signed agreement

      // Filter by date column (not cdate)
      if (startIso) {
        stage60Query = stage60Query.gte('date', startIso);
      }
      if (endIso) {
        stage60Query = stage60Query.lt('date', endIso);
      }

      const { data: allStage60Records, error: stage60Error } = await stage60Query;
      
      if (stage60Error) {
        console.error('Failed to load stage 60 records:', stage60Error);
        throw stage60Error;
      }

      console.log(`✅ Fetched ${allStage60Records?.length || 0} stage 60 records with date filter`);
      console.log(`🔍 Date filter: startIso=${startIso}, endIso=${endIso}`);
      
      // DEBUG: Check for specific lead ID 6 in filtered results
      const debugRecords = (allStage60Records || []).filter(r => r.lead_id === debugLeadId);
      if (debugRecords.length > 0) {
        console.log(`🔍 DEBUG Lead ${debugLeadId}: Found ${debugRecords.length} stage 60 records WITH date filter:`, debugRecords.map(r => ({
          id: r.id,
          lead_id: r.lead_id,
          date: r.date,
          cdate: r.cdate,
          stage: r.stage,
          dateInRange: startIso && endIso ? (r.date >= startIso && r.date < endIso) : 'N/A'
        })));
      } else {
        console.log(`🔍 DEBUG Lead ${debugLeadId}: NOT found in filtered results (but exists without filter)`);
      }
      
      // DEBUG: Check for specific lead ID 209614 (keep existing debug)
      const debugLeadId2: number = 209614;
      const debugRecords2 = (allStage60Records || []).filter(r => r.lead_id === debugLeadId2);
      if (debugRecords2.length > 0) {
        console.log(`🔍 DEBUG Lead ${debugLeadId2}: Found ${debugRecords2.length} stage 60 records:`, debugRecords2.map(r => ({
          id: r.id,
          lead_id: r.lead_id,
          date: r.date,
          cdate: r.cdate,
          stage: r.stage,
          dateInRange: startIso && endIso ? (r.date >= startIso && r.date < endIso) : 'N/A'
        })));
      }

      // Separate legacy and new leads, and track sign dates (use date from stage 60 record)
      const legacyLeadIdsSet = new Set<number>();
      const newLeadIdsSet = new Set<string>();
      const legacyStageDates = new Map<number, string>(); // lead_id -> date from stage 60
      const newLeadStageDates = new Map<string, string>(); // newlead_id -> date from stage 60

      (allStage60Records || []).forEach(record => {
        // Legacy leads: use lead_id
        if (record.lead_id !== null && record.lead_id !== undefined) {
          const legacyId = Number(record.lead_id);
          if (Number.isFinite(legacyId)) {
            legacyLeadIdsSet.add(legacyId);
            // Use date as the sign date (preferred) or cdate as fallback
            const signDate = record.date || record.cdate || null;
            if (signDate) {
              const existing = legacyStageDates.get(legacyId);
              // Keep the most recent date if there are multiple stage 60 entries
              if (!existing || new Date(signDate).getTime() > new Date(existing).getTime()) {
                legacyStageDates.set(legacyId, signDate);
              }
            }
          }
        }

        // New leads: use newlead_id
        if (record.newlead_id !== null && record.newlead_id !== undefined) {
          const newLeadId = record.newlead_id.toString();
          newLeadIdsSet.add(newLeadId);
          // Use date as the sign date (preferred) or cdate as fallback
          const signDate = record.date || record.cdate || null;
          if (signDate) {
            const existing = newLeadStageDates.get(newLeadId);
            // Keep the most recent date if there are multiple stage 60 entries
            if (!existing || new Date(signDate).getTime() > new Date(existing).getTime()) {
              newLeadStageDates.set(newLeadId, signDate);
            }
          }
        }
      });

      console.log(`✅ Found ${legacyLeadIdsSet.size} legacy leads and ${newLeadIdsSet.size} new leads with stage 60`);

      // Fetch new leads data (include all leads, active and inactive)
      let newLeads: any[] = [];
      const allNewLeadIds = Array.from(newLeadIdsSet).filter(Boolean);
      if (allNewLeadIds.length > 0) {
        const { data: newLeadsResponse, error: newLeadsError } = await supabase
          .from('leads')
          .select(
            `
              id,
              lead_number,
              manual_id,
              name,
              created_at,
              category,
              category_id,
              stage,
              date_signed,
              currency_id,
              scheduler,
              manager,
              closer,
              expert,
              handler,
              balance,
              balance_currency,
              proposal_total,
              proposal_currency,
              subcontractor_fee,
              language,
              misc_category!category_id(
                id,
                name,
                misc_maincategory!parent_id(
                  id,
                  name
                )
              )
            `
          )
          .in('id', allNewLeadIds)

        if (newLeadsError) {
          console.error('Failed to load new leads:', newLeadsError);
          throw newLeadsError;
        }

        newLeads = newLeadsResponse || [];
        console.log(`✅ Loaded ${newLeads.length} new leads`);
        
        // Debug: Check category data structure for new leads
        if (newLeads.length > 0) {
          const sampleLead = newLeads[0];
          console.log('🔍 DEBUG New Lead Category Structure:', {
            leadId: sampleLead.id,
            leadNumber: sampleLead.lead_number,
            categoryId: sampleLead.category_id,
            categoryValue: sampleLead.category,
            hasMiscCategory: !!sampleLead.misc_category,
            miscCategory: sampleLead.misc_category,
            miscCategoryType: typeof sampleLead.misc_category,
            isArray: Array.isArray(sampleLead.misc_category),
            miscCategoryKeys: sampleLead.misc_category ? Object.keys(sampleLead.misc_category) : null,
            miscMaincategory: sampleLead.misc_category?.misc_maincategory,
            resolvedCategory: resolveCategoryName(sampleLead.category, sampleLead.category_id, sampleLead.misc_category, categoryNameToDataMap)
          });
        }
      }

      // Fetch legacy leads data (only active leads: status = 0)
      let legacyLeadsData: any[] = [];
      const allLegacyLeadIds = Array.from(legacyLeadIdsSet);
      
      // DEBUG: Check if lead 209614 is in the set (debugLeadId already declared above)
      if (allLegacyLeadIds.includes(debugLeadId)) {
        console.log(`🔍 DEBUG Lead ${debugLeadId}: Found in legacyLeadIdsSet`);
      } else {
        console.log(`🔍 DEBUG Lead ${debugLeadId}: NOT found in legacyLeadIdsSet. Set contains:`, Array.from(legacyLeadIdsSet).slice(0, 10));
      }
      
      if (allLegacyLeadIds.length > 0) {
        const { data: legacyLeadsResponse, error: legacyLeadsError } = await supabase
          .from('leads_lead')
          .select(
            `
              id,
              lead_number,
              manual_id,
              master_id,
              name,
              stage,
              cdate,
              case_handler_id,
              closer_id,
              expert_id,
              meeting_scheduler_id,
              meeting_manager_id,
              meeting_lawyer_id,
              total,
              total_base,
              currency_id,
              meeting_total_currency_id,
              subcontractor_fee,
              category,
              category_id,
              language_id,
              status,
              accounting_currencies!leads_lead_currency_id_fkey (
                id,
                iso_code,
                name
              ),
              misc_category!category_id (
                id,
                name,
                misc_maincategory!parent_id (
                  id,
                  name
                )
              ),
              misc_language!leads_lead_language_id_fkey (
                id,
                name
              )
            `
          )
          .in('id', allLegacyLeadIds)

        if (legacyLeadsError) {
          console.error('Failed to load legacy leads:', legacyLeadsError);
          throw legacyLeadsError;
        }

        legacyLeadsData = legacyLeadsResponse || [];
        console.log(`✅ Loaded ${legacyLeadsData.length} legacy leads`);
        
        // Calculate sublead suffixes for legacy leads with master_id
        // Collect all unique master_ids from the fetched leads
        const uniqueMasterIds = new Set<number>();
        legacyLeadsData.forEach(lead => {
          if (lead.master_id && String(lead.master_id).trim() !== '') {
            uniqueMasterIds.add(Number(lead.master_id));
          }
        });
        
        // Query all subleads for each master_id to calculate correct suffixes
        const leadSuffixMap = new Map<number, number>(); // lead.id -> suffix
        if (uniqueMasterIds.size > 0) {
          const masterIdArray = Array.from(uniqueMasterIds);
          for (const masterId of masterIdArray) {
            const { data: allSubLeads } = await supabase
              .from('leads_lead')
              .select('id')
              .eq('master_id', masterId)
              .not('master_id', 'is', null)
              .order('id', { ascending: true });
            
            if (allSubLeads && allSubLeads.length > 0) {
              allSubLeads.forEach((subLead, index) => {
                // Suffix starts at 2 (first sub-lead is /2, second is /3, etc.)
                leadSuffixMap.set(subLead.id, index + 2);
              });
            }
          }
        }
        
        // Helper function to format legacy lead number (same logic as Clients.tsx)
        const formatLegacyLeadNumber = (lead: any): string => {
          const masterId = lead.master_id;
          const leadId = String(lead.id);
          
          // If master_id is null/empty, it's a master lead - return just the ID
          if (!masterId || String(masterId).trim() === '') {
            return leadId;
          }
          
          // If master_id exists, it's a sub-lead - use calculated suffix
          const suffix = leadSuffixMap.get(lead.id);
          if (suffix !== undefined) {
            return `${masterId}/${suffix}`;
          }
          
          // Fallback if suffix not found (shouldn't happen, but just in case)
          return `${masterId}/?`;
        };
        
        // Store the formatted lead number for use in mapping
        (legacyLeadsData as any[]).forEach((lead: any) => {
          (lead as any)._formattedLeadNumber = formatLegacyLeadNumber(lead);
        });
        
        // DEBUG: Check if lead 6 is in the fetched results
        const debugLead6 = legacyLeadsData.find((l: any) => l.id === 6);
        if (debugLead6) {
          console.log(`🔍 DEBUG Lead 6: Found in legacyLeadsData:`, {
            id: debugLead6.id,
            name: debugLead6.name,
            status: debugLead6.status,
            stage: debugLead6.stage,
            category: debugLead6.category,
            category_id: debugLead6.category_id
          });
        } else {
          console.log(`🔍 DEBUG Lead 6: NOT found in legacyLeadsData (might be inactive or filtered out)`);
          // Check if it exists with different status
          const { data: debugLeadCheck6, error: debugCheckError6 } = await supabase
            .from('leads_lead')
            .select('id, name, status, stage')
            .eq('id', 6)
            .maybeSingle();
          if (!debugCheckError6 && debugLeadCheck6) {
            console.log(`🔍 DEBUG Lead 6: Exists in database with status=${debugLeadCheck6.status}, stage=${debugLeadCheck6.stage}`);
          } else {
            console.log(`🔍 DEBUG Lead 6: Does not exist in database or error:`, debugCheckError6);
          }
        }
        
        // DEBUG: Check if lead 209614 is in the fetched results
        const debugLead = legacyLeadsData.find((l: any) => l.id === 209614);
        if (debugLead) {
          console.log(`🔍 DEBUG Lead 209614: Found in legacyLeadsData:`, {
            id: debugLead.id,
            name: debugLead.name,
            status: debugLead.status,
            stage: debugLead.stage
          });
        } else {
          console.log(`🔍 DEBUG Lead 209614: NOT found in legacyLeadsData (might be inactive or filtered out)`);
          // Check if it exists with different status
          const { data: debugLeadCheck, error: debugCheckError } = await supabase
            .from('leads_lead')
            .select('id, name, status, stage')
            .eq('id', 209614)
            .maybeSingle();
          if (!debugCheckError && debugLeadCheck) {
            console.log(`🔍 DEBUG Lead 209614: Exists in database with status=${debugLeadCheck.status}, stage=${debugLeadCheck.stage}`);
          } else {
            console.log(`🔍 DEBUG Lead 209614: Does not exist in database or error:`, debugCheckError);
          }
        }
      }

      const filteredNewLeads = (newLeads || [])
        .filter(lead => matchesEmployeeFilterNewLead(lead, employeeFilterName))
        .filter(lead => matchesCategoryFilter(resolveCategoryName(lead.category, lead.category_id, lead.misc_category)))
        .filter(lead => matchesLanguageFilter(lead.language || ''));

      const newLeadRows: SignedLeadRow[] = filteredNewLeads.map(lead => {
        const balanceAmount = parseNumericAmount(lead.balance);
        const proposalAmount = parseNumericAmount(lead.proposal_total);
        const rawAmount = balanceAmount || proposalAmount || 0;
        // Use raw amount directly (VAT already excluded in database)
        const resolvedAmount = rawAmount;
        const currencyMeta = buildCurrencyMeta(
          lead.currency_id,
          lead.proposal_currency,
          lead.balance_currency
        );
        const amountNIS = convertToNIS(resolvedAmount, currencyMeta.conversionValue);
        // Get subcontractor_fee and convert to NIS
        const subcontractorFee = parseNumericAmount(lead.subcontractor_fee) || 0;
        const subcontractorFeeNIS = convertToNIS(subcontractorFee, currencyMeta.conversionValue);
        // Get sign date from stage 60 record (date)
        const signDate = newLeadStageDates.get(String(lead.id)) || lead.date_signed || null;

        const schedulerDisplay = resolveEmployeeDisplayValue(lead.scheduler);
        const managerDisplay = resolveEmployeeDisplayValue(lead.manager);
        const closerDisplay = resolveEmployeeDisplayValue(lead.closer);
        const expertDisplay = resolveEmployeeDisplayValue(lead.expert);
        const handlerDisplay = resolveEmployeeDisplayValue(lead.handler);

        return {
          id: String(lead.id),
          leadType: 'new',
          leadNumber: lead.lead_number || lead.manual_id || lead.id,
          leadIdentifier: lead.lead_number
            ? String(lead.lead_number)
            : lead.manual_id
            ? String(lead.manual_id)
            : String(lead.id),
          leadName: lead.name || 'Unnamed Lead',
          createdDate: lead.created_at || null,
          category: resolveCategoryName(lead.category, lead.category_id, lead.misc_category, categoryNameToDataMap),
          stage: formatStageLabel(lead.stage),
          signDate,
          scheduler: schedulerDisplay,
          manager: managerDisplay,
          closer: closerDisplay,
          expert: expertDisplay,
          handler: handlerDisplay,
          schedulerId: resolveEmployeeIdValue(lead.scheduler),
          managerId: resolveEmployeeIdValue(lead.manager),
          closerId: resolveEmployeeIdValue(lead.closer),
          expertId: resolveEmployeeIdValue(lead.expert),
          handlerId: resolveEmployeeIdValue(lead.handler),
          totalOriginal: resolvedAmount,
          totalOriginalDisplay: formatCurrencyDisplay(resolvedAmount, currencyMeta.displaySymbol),
          totalNIS: amountNIS,
          totalNISDisplay: formatCurrencyDisplay(amountNIS, '₪'),
          subcontractorFee,
          subcontractorFeeNIS,
        };
      });

      const legacyLeads = (legacyLeadsData || []).filter(lead => matchesEmployeeFilterLegacyLead(lead, employeeFilterName));

      const legacyLeadRows: SignedLeadRow[] = legacyLeads
        .filter(lead => matchesCategoryFilter(resolveLegacyCategory(lead, categoryNameToDataMap)))
        .filter(lead => {
          const languageName = resolveLegacyLanguage(lead);
          return matchesLanguageFilter(languageName);
        })
        .map(lead => {
          // For legacy leads: if currency_id is 1 (NIS/ILS), use total_base; otherwise use total
          const currencyId = lead.currency_id;
          const numericCurrencyId = typeof currencyId === 'string' ? parseInt(currencyId, 10) : Number(currencyId);
          let resolvedAmount = 0;
          if (numericCurrencyId === 1) {
            // Use total_base for NIS/ILS currency
            resolvedAmount = parseNumericAmount(lead.total_base) || 0;
          } else {
            // Use total for other currencies
            resolvedAmount = parseNumericAmount(lead.total) || 0;
          }
          // Get sign date from stage 60 record (date)
          const signDate = legacyStageDates.get(Number(lead.id)) || lead.cdate || null;
          const currencyMeta = buildCurrencyMeta(
            lead.currency_id,
            lead.meeting_total_currency_id,
            lead.accounting_currencies
          );
          const amountNIS = convertToNIS(resolvedAmount, currencyMeta.conversionValue);
          // Get subcontractor_fee and convert to NIS
          const subcontractorFee = parseNumericAmount(lead.subcontractor_fee) || 0;
          const subcontractorFeeNIS = convertToNIS(subcontractorFee, currencyMeta.conversionValue);

          const schedulerName = resolveLegacyEmployeeName(lead.meeting_scheduler_id);
          const managerName = resolveLegacyEmployeeName(lead.meeting_manager_id);
          const closerName = resolveLegacyEmployeeName(lead.closer_id);
          const expertName = resolveLegacyEmployeeName(lead.expert_id);
          const handlerName = resolveLegacyEmployeeName(lead.case_handler_id);

          // Handler should only use case_handler_id, not fall back to meeting_lawyer_id (helper/lawyer)
          const roleHandler = handlerName;
          const handlerIdRaw =
            lead.case_handler_id !== null && lead.case_handler_id !== undefined
              ? lead.case_handler_id
              : null;

          // Format lead number with sublead suffix if applicable (same logic as Clients.tsx)
          const formattedLeadNumber = (lead as any)._formattedLeadNumber || String(lead.id);
          const legacyLeadNumber = formattedLeadNumber;

          return {
            id: `legacy-${lead.id}`,
            leadType: 'legacy',
            leadNumber: legacyLeadNumber,
            leadIdentifier: String(lead.id),
            leadName: lead.name || 'Unnamed Lead',
            createdDate: lead.cdate || null,
            category: resolveLegacyCategory(lead, categoryNameToDataMap),
            stage: formatStageLabel(lead.stage ? String(lead.stage) : 'Client signed agreement'),
            signDate,
            scheduler: schedulerName,
            manager: managerName,
            closer: closerName,
            expert: expertName,
            handler: roleHandler,
            schedulerId: lead.meeting_scheduler_id !== null && lead.meeting_scheduler_id !== undefined ? String(lead.meeting_scheduler_id) : null,
            managerId: lead.meeting_manager_id !== null && lead.meeting_manager_id !== undefined ? String(lead.meeting_manager_id) : null,
            closerId: lead.closer_id !== null && lead.closer_id !== undefined ? String(lead.closer_id) : null,
            expertId: lead.expert_id !== null && lead.expert_id !== undefined ? String(lead.expert_id) : null,
            handlerId: handlerIdRaw !== null && handlerIdRaw !== undefined ? String(handlerIdRaw) : null,
            totalOriginal: resolvedAmount,
            totalOriginalDisplay: formatCurrencyDisplay(resolvedAmount, currencyMeta.displaySymbol),
            totalNIS: amountNIS,
            totalNISDisplay: formatCurrencyDisplay(amountNIS, '₪'),
            subcontractorFee,
            subcontractorFeeNIS,
          };
        });

      // Combine rows and ensure no duplicates (by lead identifier)
      const combinedRowsMap = new Map<string, SignedLeadRow>();
      
      // Add new lead rows (use id as key to prevent duplicates)
      newLeadRows.forEach(row => {
        combinedRowsMap.set(row.id, row);
      });
      
      // Add legacy lead rows (use id as key to prevent duplicates)
      legacyLeadRows.forEach(row => {
        combinedRowsMap.set(row.id, row);
      });
      
      // Convert map to array and sort by sign date (newest first)
      let combinedRows = Array.from(combinedRowsMap.values()).sort((a, b) => {
        const aTime = a.signDate ? new Date(a.signDate).getTime() : 0;
        const bTime = b.signDate ? new Date(b.signDate).getTime() : 0;
        return bTime - aTime;
      });

      // Check for payment plans for all leads
      const newLeadIds = combinedRows.filter(row => row.leadType === 'new').map(row => row.id);
      const legacyLeadIds = combinedRows.filter(row => row.leadType === 'legacy').map(row => row.id.replace('legacy-', ''));

      // Fetch payment plans for new leads
      const leadsWithPaymentPlans = new Set<string>();
      if (newLeadIds.length > 0) {
        const { data: newPaymentPlans, error: newPaymentError } = await supabase
          .from('payment_plans')
          .select('lead_id')
          .in('lead_id', newLeadIds)
          .is('cancel_date', null);
        
        if (!newPaymentError && newPaymentPlans) {
          newPaymentPlans.forEach(plan => {
            if (plan.lead_id) {
              leadsWithPaymentPlans.add(String(plan.lead_id));
            }
          });
        }
      }

      // Fetch payment plans for legacy leads
      if (legacyLeadIds.length > 0) {
        const legacyLeadIdsAsStrings = legacyLeadIds.map(id => String(id));
        const { data: legacyPaymentPlans, error: legacyPaymentError } = await supabase
          .from('finances_paymentplanrow')
          .select('lead_id')
          .in('lead_id', legacyLeadIdsAsStrings)
          .is('cancel_date', null);
        
        if (!legacyPaymentError && legacyPaymentPlans) {
          legacyPaymentPlans.forEach(plan => {
            if (plan.lead_id) {
              // Add both string and number versions to handle type mismatches
              leadsWithPaymentPlans.add(`legacy-${plan.lead_id}`);
              leadsWithPaymentPlans.add(`legacy-${String(plan.lead_id)}`);
            }
          });
        }
      }

      // Update rows with hasPaymentPlan flag
      combinedRows = combinedRows.map(row => ({
        ...row,
        hasPaymentPlan: leadsWithPaymentPlans.has(row.id)
      }));

      console.log(`✅ Final result: ${combinedRows.length} unique signed leads (${newLeadRows.length} new + ${legacyLeadRows.length} legacy)`);
      setRows(combinedRows);
    } catch (error: any) {
      console.error('Failed to build Signed Sales Report:', error);
      setErrorMessage(error.message || 'Failed to fetch signed agreements. Please try again.');
      setRows([]);
    } finally {
      setIsLoading(false);
    }
  };

  // Sort rows by handler (no handler on top) when sortByHandler is true
  const sortedRows = useMemo(() => {
    if (!sortByHandler) return rows;
    return [...rows].sort((a, b) => {
      const aHasHandler = !!(a.handler && a.handler.trim() !== '');
      const bHasHandler = !!(b.handler && b.handler.trim() !== '');
      // No handler comes first (true < false)
      if (aHasHandler === bHasHandler) return 0;
      return aHasHandler ? 1 : -1;
    });
  }, [rows, sortByHandler]);

  const totalInNIS = useMemo(() => sortedRows.reduce((sum, row) => sum + (row.totalNIS || 0), 0), [sortedRows]);
  const totalInNISWithFeeDeducted = useMemo(() => 
    sortedRows.reduce((sum, row) => {
      const total = row.totalNIS || 0;
      const fee = row.subcontractorFeeNIS || 0;
      return sum + (total - fee);
    }, 0), 
    [sortedRows]
  );

  // Filter reports based on search query
  const filteredReports = useMemo(() => {
    if (!searchQuery.trim()) {
      return reports;
    }

    const query = searchQuery.toLowerCase().trim();
    return reports
      .map((section) => {
        const filteredItems = section.items.filter((item) => {
          const matchesLabel = item.label.toLowerCase().includes(query);
          const matchesCategory = section.category.toLowerCase().includes(query);
          return matchesLabel || matchesCategory;
        });

        return {
          ...section,
          items: filteredItems,
        };
      })
      .filter((section) => section.items.length > 0);
  }, [searchQuery]);

  return (
    <div className="space-y-8 px-5 md:px-1">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-4xl font-bold">Signed Agreements Overview</h1>
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
                      item.route === '/sales/signed' ? 'bg-primary text-white' : 'bg-gray-50'
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

      <div className="card bg-base-100 shadow-lg border border-base-200">
        <div className="card-body space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div className="form-control">
              <label className="label">
                <span className="label-text font-medium">From date</span>
              </label>
              <input
                type="date"
                className="input input-bordered"
                value={filters.fromDate}
                onChange={e => handleFilterChange('fromDate', e.target.value)}
              />
            </div>

            <div className="form-control">
              <label className="label">
                <span className="label-text font-medium">To date</span>
              </label>
              <input
                type="date"
                className="input input-bordered"
                value={filters.toDate}
                onChange={e => handleFilterChange('toDate', e.target.value)}
              />
            </div>

            <div className="form-control" ref={employeeFilterRef}>
              <label className="label">
                <span className="label-text font-medium">Employee</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  className="input input-bordered bg-white text-black pr-10"
                  value={filters.employee}
                  placeholder="All"
                  onFocus={() => setFilterDropdownOpen(prev => ({ ...prev, employee: true }))}
                  onChange={e => {
                    handleFilterChange('employee', e.target.value);
                    setFilterDropdownOpen(prev => ({ ...prev, employee: true }));
                  }}
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-2 flex items-center text-gray-400"
                  onClick={() => toggleFilterDropdown('employee')}
                >
                  <ChevronDownIcon
                    className={`w-5 h-5 transition-transform ${
                      filterDropdownOpen.employee ? 'rotate-180 text-gray-600' : ''
                    }`}
                  />
                </button>
                {filterDropdownOpen.employee && (
                  <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl max-h-60 overflow-y-auto">
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100"
                      onClick={() => handleFilterSelection('employee', '')}
                    >
                      All
                    </button>
                    {filteredEmployeeOptions.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-gray-500">No matches</div>
                    ) : (
                      filteredEmployeeOptions.map(option => (
                        <button
                          type="button"
                          key={`employee-option-${option}`}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100"
                          onClick={() => handleFilterSelection('employee', option)}
                        >
                          {option}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="form-control" ref={categoryFilterRef}>
              <label className="label">
                <span className="label-text font-medium">Category</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  className="input input-bordered bg-white text-black pr-10"
                  value={filters.category}
                  placeholder="All"
                  onFocus={() => setFilterDropdownOpen(prev => ({ ...prev, category: true }))}
                  onChange={e => {
                    handleFilterChange('category', e.target.value);
                    setFilterDropdownOpen(prev => ({ ...prev, category: true }));
                  }}
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-2 flex items-center text-gray-400"
                  onClick={() => toggleFilterDropdown('category')}
                >
                  <ChevronDownIcon
                    className={`w-5 h-5 transition-transform ${
                      filterDropdownOpen.category ? 'rotate-180 text-gray-600' : ''
                    }`}
                  />
                </button>
                {filterDropdownOpen.category && (
                  <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl max-h-60 overflow-y-auto">
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100"
                      onClick={() => handleFilterSelection('category', '')}
                    >
                      All
                    </button>
                    {filteredCategoryOptions.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-gray-500">No matches</div>
                    ) : (
                      filteredCategoryOptions.map(option => (
                        <button
                          type="button"
                          key={`category-option-${option}`}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100"
                          onClick={() => handleFilterSelection('category', option)}
                        >
                          {option}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="form-control" ref={languageFilterRef}>
              <label className="label">
                <span className="label-text font-medium">Language</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  className="input input-bordered bg-white text-black pr-10"
                  value={filters.language}
                  placeholder="All"
                  onFocus={() => setFilterDropdownOpen(prev => ({ ...prev, language: true }))}
                  onChange={e => {
                    handleFilterChange('language', e.target.value);
                    setFilterDropdownOpen(prev => ({ ...prev, language: true }));
                  }}
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-2 flex items-center text-gray-400"
                  onClick={() => toggleFilterDropdown('language')}
                >
                  <ChevronDownIcon
                    className={`w-5 h-5 transition-transform ${
                      filterDropdownOpen.language ? 'rotate-180 text-gray-600' : ''
                    }`}
                  />
                </button>
                {filterDropdownOpen.language && (
                  <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl max-h-60 overflow-y-auto">
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100"
                      onClick={() => handleFilterSelection('language', '')}
                    >
                      All
                    </button>
                    {filteredLanguageOptions.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-gray-500">No matches</div>
                    ) : (
                      filteredLanguageOptions.map(option => (
                        <button
                          type="button"
                          key={`language-option-${option}`}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100"
                          onClick={() => handleFilterSelection('language', option)}
                        >
                          {option}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex-1">
              <div className="flex flex-col md:flex-row md:items-center md:gap-4">
                <div className="bg-white border border-base-200 shadow-lg rounded-2xl px-6 py-4 flex items-center gap-5 w-full md:max-w-[280px]">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs uppercase tracking-wider text-gray-500">Total Signed (After Fee)</span>
                    <span className="text-3xl font-extrabold text-gray-900">{`₪ ${Math.round(totalInNISWithFeeDeducted).toLocaleString('en-US')}`}</span>
                  </div>
                  <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-indigo-500 via-purple-500 to-blue-500 flex items-center justify-center text-white text-xl font-bold shadow-lg">
                    {sortedRows.length}
                  </div>
                </div>
                <div className="bg-white border border-base-200 shadow-lg rounded-2xl px-6 py-4 flex items-center gap-5 w-full md:max-w-[280px]">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs uppercase tracking-wider text-gray-500">Total Signed (Before Fee)</span>
                    <span className="text-3xl font-extrabold text-gray-900">{`₪ ${Math.round(totalInNIS).toLocaleString('en-US')}`}</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex justify-end md:w-auto">
              <button
                className="btn btn-primary px-10"
                onClick={handleSearch}
                disabled={isLoading}
              >
                {isLoading ? 'Loading...' : 'Show'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {errorMessage && (
        <div className="alert alert-error shadow-lg">
          <span>{errorMessage}</span>
        </div>
      )}

      {searchPerformed && (
        <div className="card bg-base-100 shadow-xl border border-base-200">
          <div className="card-body">
            {isLoading ? (
              <div className="py-12 flex justify-center">
                <span className="loading loading-spinner loading-lg text-primary" />
              </div>
            ) : sortedRows.length === 0 ? (
              <div className="py-12 text-center text-gray-500">
                No signed agreements found for the selected filters.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="table text-xs md:text-sm">
                  <thead>
                    <tr>
                      <th className="text-xs md:text-sm">Lead</th>
                      <th className="text-xs md:text-sm">C. Date</th>
                      <th className="text-xs md:text-sm">Category</th>
                      <th className="text-xs md:text-sm">Stage</th>
                      <th className="text-xs md:text-sm">Sign Date</th>
                      <th className="text-xs md:text-sm">Scheduler</th>
                      <th className="text-xs md:text-sm">Manager</th>
                      <th className="text-xs md:text-sm">Closer</th>
                      <th className="text-xs md:text-sm">Expert</th>
                      <th 
                        className="text-xs md:text-sm cursor-pointer hover:bg-gray-100 select-none"
                        onClick={() => setSortByHandler(!sortByHandler)}
                        title="Click to sort by handler (no handler on top)"
                      >
                        Handler {sortByHandler && '↑'}
                      </th>
                      <th className="text-xs md:text-sm">Total</th>
                      <th className="text-xs md:text-sm">Total (₪)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.map(row => (
                      <tr key={`${row.leadType}-${row.id}`}>
                        <td>
                          <div className="flex flex-col">
                            <Link
                              to={`/clients/${encodeURIComponent(row.leadIdentifier)}`}
                              className="text-xs md:text-sm font-semibold text-primary hover:underline"
                            >
                              {row.leadNumber}
                            </Link>
                            <span className="text-[10px] md:text-xs text-gray-500">{row.leadName}</span>
                          </div>
                        </td>
                        <td className="text-xs md:text-sm">{formatDate(row.createdDate)}</td>
                        <td className="max-w-[220px] text-xs md:text-sm">
                          <span className="block line-clamp-2 break-words">{row.category}</span>
                        </td>
                        <td className="text-xs md:text-sm font-semibold text-black">{row.stage}</td>
                        <td className="text-xs md:text-sm">
                          <div className="flex flex-col gap-1">
                            <span>{formatDate(row.signDate)}</span>
                            {!row.hasPaymentPlan && (
                              <span className="badge badge-sm text-[10px] px-2 py-0.5 bg-red-500 text-white">No Payment Plan!</span>
                            )}
                          </div>
                        </td>
                        <td className="text-xs md:text-sm">{renderRoleCell(row, 'scheduler')}</td>
                        <td className="text-xs md:text-sm">{renderRoleCell(row, 'manager')}</td>
                        <td className="text-xs md:text-sm">{renderRoleCell(row, 'closer')}</td>
                        <td className="text-xs md:text-sm">{renderRoleCell(row, 'expert')}</td>
                        <td className="text-xs md:text-sm">{renderRoleCell(row, 'handler')}</td>
                        <td className="text-xs md:text-sm">{row.totalOriginalDisplay}</td>
                        <td className="text-xs md:text-sm">
                          {(() => {
                            const totalAfterFee = (row.totalNIS || 0) - (row.subcontractorFeeNIS || 0);
                            const feeDisplay = row.subcontractorFeeNIS && row.subcontractorFeeNIS > 0 
                              ? ` (fee: ₪ ${Math.round(row.subcontractorFeeNIS).toLocaleString('en-US')})`
                              : '';
                            return `${formatCurrencyDisplay(totalAfterFee, '₪')}${feeDisplay}`;
                          })()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SignedSalesReportPage;

