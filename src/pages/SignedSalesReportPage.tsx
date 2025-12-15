import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PencilSquareIcon, CheckIcon, XMarkIcon, ChevronDownIcon, ArrowLeftIcon } from '@heroicons/react/24/outline';
import { MagnifyingGlassIcon, Squares2X2Icon, ArrowUturnDownIcon, DocumentDuplicateIcon, ChartPieIcon, AdjustmentsHorizontalIcon, FunnelIcon, ClockIcon, ArrowPathIcon, CheckCircleIcon, BanknotesIcon, UserGroupIcon, UserIcon, AcademicCapIcon, StarIcon, PlusIcon, ChartBarIcon, ListBulletIcon, CurrencyDollarIcon, BriefcaseIcon, RectangleStackIcon } from '@heroicons/react/24/solid';
import { supabase } from '../lib/supabase';
import { convertToNIS, getCurrencySymbol } from '../lib/currencyConversion';
import { fetchStageNames, areStagesEquivalent } from '../lib/stageUtils';

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
    legacyFields: ['case_handler_id', 'meeting_lawyer_id'],
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
  const [filters, setFilters] = useState<FiltersState>({
    fromDate: todayIso,
    toDate: todayIso,
    category: '',
    employee: '',
    language: '',
  });
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [stageMap, setStageMap] = useState<{ [key: string]: string }>({});
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [categoryOptions, setCategoryOptions] = useState<string[]>([]);
  const [languageOptions, setLanguageOptions] = useState<string[]>([]);
  const [rows, setRows] = useState<SignedLeadRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchPerformed, setSearchPerformed] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [roleEditor, setRoleEditor] = useState<RoleEditorState | null>(null);
  const [isSavingRole, setIsSavingRole] = useState(false);
  const [filterDropdownOpen, setFilterDropdownOpen] = useState({
    employee: false,
    category: false,
    language: false,
  });
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

  const getRoleDisplay = (row: SignedLeadRow, role: RoleKey): string => {
    switch (role) {
      case 'scheduler':
        return row.scheduler || '';
      case 'manager':
        return row.manager || '';
      case 'closer':
        return row.closer || '';
      case 'expert':
        return row.expert || '';
      case 'handler':
        return row.handler || '';
      default:
        return '';
    }
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
      return (
        <div className="flex items-center gap-2">
          <span>{currentDisplay && currentDisplay.trim() !== '' ? currentDisplay : '—'}</span>
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
          const formattedCategories = categoriesResult.data.map((category: any) => {
            const mainName = Array.isArray(category.misc_maincategory)
              ? category.misc_maincategory[0]?.name
              : category.misc_maincategory?.name;
            return mainName ? `${mainName} › ${category.name}` : category.name;
          });
          const uniqueCategoryLabels = Array.from(new Set(formattedCategories.filter(Boolean)));
          setCategoryOptions(uniqueCategoryLabels);
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
    return normalizedValue === normalizedCategory || normalizedValue.includes(normalizedCategory);
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
  miscCategory?: any
) => {
  const categoryRecord = Array.isArray(miscCategory) ? miscCategory[0] : miscCategory;
  const mainCategory = Array.isArray(categoryRecord?.misc_maincategory)
    ? categoryRecord.misc_maincategory[0]
    : categoryRecord?.misc_maincategory;

  const mainName = mainCategory?.name?.toString().trim();
  const subName = categoryRecord?.name?.toString().trim();

  if (mainName && subName) return `${mainName} › ${subName}`;
  if (mainName) return mainName;
  if (subName) return subName;
  if (categoryValue && categoryValue.trim() !== '') return categoryValue;
  if (categoryId !== null && categoryId !== undefined) return `Category ${categoryId}`;
  return 'Uncategorized';
};

const resolveLegacyCategory = (lead: any) =>
  resolveCategoryName(lead?.category, lead?.category_id, lead?.misc_category);

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

      // Fetch signed new leads
      let newLeadsContractsQuery = supabase
        .from('contracts')
        .select(
          `
            id,
            client_id,
            legacy_id,
            signed_at,
            total_amount
          `
        )
        .not('client_id', 'is', null)
        .not('signed_at', 'is', null)
        .eq('status', 'signed');

      if (startIso) newLeadsContractsQuery = newLeadsContractsQuery.gte('signed_at', startIso);
      if (endIso) newLeadsContractsQuery = newLeadsContractsQuery.lt('signed_at', endIso);

      const stageMatchesSigned = (stageValue: any) => {
        if (stageValue === null || stageValue === undefined) return false;
        const raw = stageValue.toString().trim();
        if (!raw) return false;

        const normalizedRaw = normalizeString(raw);
        if (SIGNED_STAGE_TOKENS.has(normalizedRaw)) return true;

        const numericStage = Number(raw);
        if (!Number.isNaN(numericStage) && numericStage === 60) return true;

        const mappedStageName =
          stageMap?.[raw] ??
          stageMap?.[String(numericStage)] ??
          stageNameLookup.get(normalizedRaw);

        if (mappedStageName) {
          const normalizedMapped = normalizeString(mappedStageName);
          if (SIGNED_STAGE_TOKENS.has(normalizedMapped)) return true;
          if (areStagesEquivalent(mappedStageName, 'Client signed agreement')) return true;
        }

        if (areStagesEquivalent(raw, 'Client signed agreement')) return true;

        return false;
      };

      const { data: contractRows, error: contractsError } = await newLeadsContractsQuery;
      if (contractsError) {
        console.error('Failed to load contract signatures:', contractsError);
        throw contractsError;
      }

      const newLeadContracts = new Map<string, { signedAt: string; totalAmount: number | null }>();
      const legacyContracts = new Map<number, { signedAt: string; totalAmount: number | null }>();

      (contractRows || []).forEach(row => {
        if (!row?.signed_at) return;
        const signedAt = row.signed_at as string;
        const totalAmount = row.total_amount ?? null;

        if (row.client_id) {
          const clientId = row.client_id.toString();
          const existing = newLeadContracts.get(clientId);
          if (!existing || new Date(signedAt).getTime() > new Date(existing.signedAt).getTime()) {
            newLeadContracts.set(clientId, { signedAt, totalAmount });
          }
        }

        if (row.legacy_id !== null && row.legacy_id !== undefined) {
          const legacyId = Number(row.legacy_id);
          if (Number.isFinite(legacyId)) {
            const existing = legacyContracts.get(legacyId);
            if (!existing || new Date(signedAt).getTime() > new Date(existing.signedAt).getTime()) {
              legacyContracts.set(legacyId, { signedAt, totalAmount });
            }
          }
        }
      });

      // Fetch stage changes for new leads (leads_leadstage table)
      // For new leads, use newlead_id (UUID) and filter for stage 60 (client signed agreement)
      const newLeadStageDates = new Map<string, string>();
      try {
        const stageColumns = 'id, newlead_id, stage, cdate, date';
        // Query all stage 60 records for new leads, then filter by date client-side
        const { data: newLeadStageResponse, error: newLeadStageError } = await supabase
          .from('leads_leadstage')
          .select(stageColumns)
          .not('newlead_id', 'is', null) // Only new leads (not legacy)
          .eq('stage', 60); // Stage 60 = Client signed agreement

        if (newLeadStageError) {
          console.warn('Error fetching new lead stage history:', newLeadStageError);
          // Continue without stage data - not critical
        } else {
          (newLeadStageResponse || [])
            .filter(record => record?.newlead_id) // Filter for new leads only
            .filter(record => {
              // Filter by date range client-side
              const timestamp = record.date || record.cdate || null;
              if (!timestamp) return false;
              const recordTime = new Date(timestamp).getTime();
              if (Number.isNaN(recordTime)) return false;
              if (startIso) {
                const startTime = new Date(startIso).getTime();
                if (recordTime < startTime) return false;
              }
              if (endIso) {
                const endTime = new Date(endIso).getTime();
                if (recordTime >= endTime) return false;
              }
              return true;
            })
            .forEach(record => {
              const leadId = record.newlead_id?.toString?.();
              if (!leadId) return;
              // Use date or cdate as timestamp
              const timestamp = record.date || record.cdate || null;
              if (!timestamp) return;
              const existingTimestamp = newLeadStageDates.get(leadId);
              const nextTime = new Date(timestamp).getTime();
              if (!existingTimestamp) {
                newLeadStageDates.set(leadId, timestamp);
                return;
              }
              const existingTime = new Date(existingTimestamp).getTime();
              if (Number.isNaN(existingTime) || (!Number.isNaN(nextTime) && nextTime > existingTime)) {
                newLeadStageDates.set(leadId, timestamp);
              }
            });
        }
      } catch (stageError) {
        console.error('Failed to load new lead stage history:', stageError);
      }

      // Also fetch leads with date_signed in the date range (second factor)
      const newLeadsWithDateSigned = new Map<string, string>();
      try {
        let dateSignedQuery = supabase
          .from('leads')
          .select('id, date_signed')
          .not('date_signed', 'is', null);

        if (startIso) {
          dateSignedQuery = dateSignedQuery.gte('date_signed', startIso);
        }
        if (endIso) {
          dateSignedQuery = dateSignedQuery.lt('date_signed', endIso);
        }

        const { data: dateSignedData, error: dateSignedError } = await dateSignedQuery;

        if (dateSignedError) {
          console.warn('Error fetching leads with date_signed:', dateSignedError);
        } else {
          (dateSignedData || []).forEach(lead => {
            if (lead?.id && lead?.date_signed) {
              const leadId = lead.id.toString();
              const existingTimestamp = newLeadsWithDateSigned.get(leadId);
              const signedTime = new Date(lead.date_signed).getTime();
              if (!existingTimestamp) {
                newLeadsWithDateSigned.set(leadId, lead.date_signed);
              } else {
                const existingTime = new Date(existingTimestamp).getTime();
                if (Number.isNaN(existingTime) || (!Number.isNaN(signedTime) && signedTime > existingTime)) {
                  newLeadsWithDateSigned.set(leadId, lead.date_signed);
                }
              }
            }
          });
        }
      } catch (dateSignedError) {
        console.error('Failed to load leads with date_signed:', dateSignedError);
      }

      // Combine both sources: contracts, stage 60 records, and date_signed
      const combinedNewLeadIdSet = new Set<string>();
      newLeadContracts.forEach((_info, clientId) => combinedNewLeadIdSet.add(clientId));
      newLeadStageDates.forEach((_timestamp, leadId) => combinedNewLeadIdSet.add(leadId));
      newLeadsWithDateSigned.forEach((_timestamp, leadId) => combinedNewLeadIdSet.add(leadId));

      let newLeads: any[] = [];
      const allNewLeadIds = Array.from(combinedNewLeadIdSet).filter(Boolean);
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
          .in('id', allNewLeadIds);

        if (newLeadsError) {
          console.error('Failed to load signed leads:', newLeadsError);
          throw newLeadsError;
        }

        newLeads = newLeadsResponse || [];
      }

      let legacyStageRecords: any[] = [];
      let legacyLeadsData: any[] = [];
      {
        let legacyStageQuery = supabase
          .from('leads_leadstage')
          .select('id, lead_id, stage, date, cdate, creator_id');

        if (startIso) {
          legacyStageQuery = legacyStageQuery.gte('cdate', startIso);
        }
        if (endIso) {
          legacyStageQuery = legacyStageQuery.lt('cdate', endIso);
        }

        const { data: stageData, error: stageError } = await legacyStageQuery;

        if (stageError) {
          console.error('Failed to load legacy lead stages:', stageError);
          throw stageError;
        }

        legacyStageRecords = (stageData || [])
          .filter(record => stageMatchesSigned(record.stage))
          .filter(record => record.lead_id !== null && record.lead_id !== undefined);

        const legacyLeadIdsSet = new Set<number>();
        legacyStageRecords.forEach(record => {
          const id = Number(record.lead_id);
          if (Number.isFinite(id)) legacyLeadIdsSet.add(id);
        });
        legacyContracts.forEach((_, legacyId) => {
          if (Number.isFinite(legacyId)) legacyLeadIdsSet.add(legacyId);
        });

        if (legacyLeadIdsSet.size > 0) {
          const { data: legacyLeadsResponse, error: legacyLeadsError } = await supabase
            .from('leads_lead')
            .select(
              `
                id,
                lead_number,
                manual_id,
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
                currency_id,
                meeting_total_currency_id,
                category,
                category_id,
                language_id,
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
            .in('id', Array.from(legacyLeadIdsSet));

          if (legacyLeadsError) {
            console.error('Failed to load legacy signed leads:', legacyLeadsError);
            throw legacyLeadsError;
          }

          legacyLeadsData = legacyLeadsResponse || [];
        }
      }

      const stageRecordsByLead = new Map<number, { cdate: string | null; date: string | null }>();
      legacyStageRecords.forEach(record => {
        const leadId = Number(record.lead_id);
        if (!Number.isFinite(leadId)) return;

            let recordDateValue: string | null = null;
            if (record.cdate) {
              recordDateValue = record.cdate;
            } else if (record.date) {
              const synthetic = toStartOfDayIso(record.date);
              recordDateValue = synthetic;
            }
        if (!recordDateValue) return;

        const existing = stageRecordsByLead.get(leadId);
        if (!existing) {
          stageRecordsByLead.set(leadId, {
            cdate: record.cdate ?? null,
            date: record.date ?? null,
          });
        } else {
          const existingDateValue = existing.date || existing.cdate;
          if (!existingDateValue || new Date(recordDateValue).getTime() > new Date(existingDateValue).getTime()) {
            stageRecordsByLead.set(leadId, {
              cdate: record.cdate ?? null,
              date: record.date ?? null,
            });
          }
        }
      });

      legacyContracts.forEach((info, legacyId) => {
        if (!Number.isFinite(legacyId) || !info.signedAt) return;
        const existing = stageRecordsByLead.get(legacyId);
        if (!existing) {
          stageRecordsByLead.set(legacyId, {
            cdate: info.signedAt,
            date: info.signedAt,
          });
        } else {
          const existingDateValue = existing.date || existing.cdate;
          if (!existingDateValue || new Date(info.signedAt).getTime() > new Date(existingDateValue).getTime()) {
            stageRecordsByLead.set(legacyId, {
              cdate: info.signedAt,
              date: info.signedAt,
            });
          }
        }
      });

      const filteredNewLeads = (newLeads || [])
        .filter(lead => matchesEmployeeFilterNewLead(lead, employeeFilterName))
        .filter(lead => matchesCategoryFilter(resolveCategoryName(lead.category, lead.category_id, lead.misc_category)))
        .filter(lead => matchesLanguageFilter(lead.language || ''));

      const newLeadRows: SignedLeadRow[] = filteredNewLeads.map(lead => {
        const balanceAmount = parseNumericAmount(lead.balance);
        const proposalAmount = parseNumericAmount(lead.proposal_total);
        const contractInfo = newLeadContracts.get(String(lead.id));
        const contractAmount = parseNumericAmount(contractInfo?.totalAmount ?? 0);
        const resolvedAmount = balanceAmount || proposalAmount || contractAmount || 0;
        const currencyMeta = buildCurrencyMeta(
          lead.currency_id,
          lead.proposal_currency,
          lead.balance_currency
        );
        const amountNIS = convertToNIS(resolvedAmount, currencyMeta.conversionValue);
        // Get sign date from multiple sources: contract, stage 60 record, or date_signed
        const stageDate = newLeadStageDates.get(String(lead.id));
        const dateSignedValue = newLeadsWithDateSigned.get(String(lead.id));
        const signDate = contractInfo?.signedAt || stageDate || dateSignedValue || lead.date_signed || null;

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
          category: resolveCategoryName(lead.category, lead.category_id, lead.misc_category),
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
        };
      });

      const legacyLeads = (legacyLeadsData || []).filter(lead => matchesEmployeeFilterLegacyLead(lead, employeeFilterName));

      const legacyLeadRows: SignedLeadRow[] = legacyLeads
        .filter(lead => matchesCategoryFilter(resolveLegacyCategory(lead)))
        .filter(lead => {
          const languageName = resolveLegacyLanguage(lead);
          return matchesLanguageFilter(languageName);
        })
        .map(lead => {
          const stageEntry = stageRecordsByLead.get(Number(lead.id));
          const contractInfo = legacyContracts.get(Number(lead.id));
          const contractAmount = parseNumericAmount(contractInfo?.totalAmount ?? 0);
          const amountRaw = parseNumericAmount(lead.total);
          const resolvedAmount = amountRaw || contractAmount || 0;
          const signDate = contractInfo?.signedAt || stageEntry?.date || stageEntry?.cdate || lead.cdate || null;
          const currencyMeta = buildCurrencyMeta(
            lead.currency_id,
            lead.meeting_total_currency_id,
            lead.accounting_currencies
          );
          const amountNIS = convertToNIS(resolvedAmount, currencyMeta.conversionValue);

          const schedulerName = resolveLegacyEmployeeName(lead.meeting_scheduler_id);
          const managerName = resolveLegacyEmployeeName(lead.meeting_manager_id);
          const closerName = resolveLegacyEmployeeName(lead.closer_id);
          const expertName = resolveLegacyEmployeeName(lead.expert_id);
          const handlerName = resolveLegacyEmployeeName(lead.case_handler_id);
          const lawyerName = resolveLegacyEmployeeName(lead.meeting_lawyer_id);

          const roleHandler = handlerName || lawyerName;
          const handlerIdRaw =
            lead.case_handler_id !== null && lead.case_handler_id !== undefined
              ? lead.case_handler_id
              : lead.meeting_lawyer_id ?? null;

          const legacyLeadNumber =
            lead.lead_number ||
            lead.manual_id ||
            `${lead.id}`;

          return {
            id: `legacy-${lead.id}`,
            leadType: 'legacy',
            leadNumber: String(legacyLeadNumber),
            leadIdentifier: String(lead.id),
            leadName: lead.name || 'Unnamed Lead',
            createdDate: lead.cdate || null,
            category: resolveLegacyCategory(lead),
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
          };
        });

      const combinedRows = [...newLeadRows, ...legacyLeadRows].sort((a, b) => {
        const aTime = a.signDate ? new Date(a.signDate).getTime() : 0;
        const bTime = b.signDate ? new Date(b.signDate).getTime() : 0;
        return bTime - aTime;
      });

      setRows(combinedRows);
    } catch (error: any) {
      console.error('Failed to build Signed Sales Report:', error);
      setErrorMessage(error.message || 'Failed to fetch signed agreements. Please try again.');
      setRows([]);
    } finally {
      setIsLoading(false);
    }
  };

  const totalInNIS = useMemo(() => rows.reduce((sum, row) => sum + (row.totalNIS || 0), 0), [rows]);

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
                    <span className="text-xs uppercase tracking-wider text-gray-500">Total Signed</span>
                    <span className="text-3xl font-extrabold text-gray-900">{`₪ ${Math.round(totalInNIS).toLocaleString('en-US')}`}</span>
                  </div>
                  <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-indigo-500 via-purple-500 to-blue-500 flex items-center justify-center text-white text-xl font-bold shadow-lg">
                    {rows.length}
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
            ) : rows.length === 0 ? (
              <div className="py-12 text-center text-gray-500">
                No signed agreements found for the selected filters.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Lead</th>
                      <th>C. Date</th>
                      <th>Category</th>
                      <th>Stage</th>
                      <th>Sign Date</th>
                      <th>Scheduler</th>
                      <th>Manager</th>
                      <th>Closer</th>
                      <th>Expert</th>
                      <th>Handler</th>
                      <th>Total</th>
                      <th>Total (₪)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(row => (
                      <tr key={`${row.leadType}-${row.id}`}>
                        <td>
                          <div className="flex flex-col">
                            <Link
                              to={`/clients/${encodeURIComponent(row.leadIdentifier)}`}
                              className="font-semibold text-primary hover:underline"
                            >
                              {row.leadNumber}
                            </Link>
                            <span className="text-sm text-gray-500">{row.leadName}</span>
                          </div>
                        </td>
                        <td>{formatDate(row.createdDate)}</td>
                        <td className="max-w-[220px]">
                          <span className="truncate block">{row.category}</span>
                        </td>
                        <td className="text-sm font-semibold text-black">{row.stage}</td>
                        <td>{formatDate(row.signDate)}</td>
                        <td>{renderRoleCell(row, 'scheduler')}</td>
                        <td>{renderRoleCell(row, 'manager')}</td>
                        <td>{renderRoleCell(row, 'closer')}</td>
                        <td>{renderRoleCell(row, 'expert')}</td>
                        <td>{renderRoleCell(row, 'handler')}</td>
                        <td>{row.totalOriginalDisplay}</td>
                        <td>{row.totalNISDisplay}</td>
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

