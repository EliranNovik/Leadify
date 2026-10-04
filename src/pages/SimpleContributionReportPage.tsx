import React, { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import { usePersistedFilters, usePersistedState } from '../hooks/usePersistedState';
import { ChevronDownIcon, ChevronRightIcon, ChartBarIcon, UserGroupIcon, BuildingOfficeIcon, SpeakerWaveIcon, CurrencyDollarIcon, PencilIcon, CheckIcon, XMarkIcon, GlobeAltIcon, FlagIcon, BriefcaseIcon, HomeIcon, AcademicCapIcon, RocketLaunchIcon, MapPinIcon, DocumentTextIcon, ScaleIcon, ShieldCheckIcon, BanknotesIcon, CogIcon, HeartIcon, WrenchScrewdriverIcon, ClipboardDocumentListIcon, ExclamationTriangleIcon, UsersIcon, Squares2X2Icon, MagnifyingGlassIcon, LinkIcon, InformationCircleIcon, TrophyIcon, FunnelIcon, ArrowLeftIcon } from '@heroicons/react/24/outline';
import EmployeeRoleLeadsModal from '../components/EmployeeRoleLeadsModal';
import EmployeeFieldAssignmentsModal from '../components/EmployeeFieldAssignmentsModal';
import DynamicIsland from '../components/DynamicIsland';
import DynamicTab from '../components/DynamicTab';
import FixedContributionModal from '../components/FixedContributionModal';
import EmployeeDepartmentRolesModal from '../components/EmployeeDepartmentRolesModal';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  calculateSignedPortionAmount,
  legacyLeadMatchesExpert,
  newLeadFieldMatchesEmployee,
  newLeadMatchesExpert,
  resolveHelperCloserValue,
} from '../utils/rolePercentageCalculator';
import { fetchAllPagedRows, fetchAllRowsForLeadIds } from '../lib/invoicedInstallments';
import {
  calculateEmployeeMetrics,
  parseNumericAmount,
  buildCurrencyMeta,
  calculateNewLeadAmount,
  calculateLegacyLeadAmount,
  calculateNewLeadFullAmount,
  calculateLegacyLeadFullAmount,
  buildSignDateMapsFromStageHistory,
  enrichLeadWithSignedNisAmounts,
  enrichLeadsMapsWithSignedNis,
  type EmployeeCalculationInput,
  type EmployeeCalculationResult
} from '../utils/salesContributionCalculator';
import { createBoiDateRateConverter } from '../lib/boiCurrencyConversion';
import { processNewPaymentsAsync, processLegacyPaymentsAsync } from '../utils/paymentPlanProcessor';
import {
  DUE_INVOICED_EXTRA_COLUMNS,
  DUE_INVOICED_LEGACY_EXTRA_COLUMNS,
  DUE_INVOICED_PAID_COLUMNS,
  dueInvoicedAllRowsFilter,
  dueInvoicedReadyToPayFilter,
  scopeDueInvoicedQuery,
  scopeLegacyInvoicedWithoutDueDate,
} from '../utils/contributionDueInvoiced';
import {
  resolveMainCategory as resolveMainCategoryUtil,
  preprocessLeadsCategories as preprocessLeadsCategoriesUtil,
  findBestCategoryMatch as findBestCategoryMatchUtil,
  normalizeCategoryText as normalizeCategoryTextUtil
} from '../utils/categoryResolver';
import { fetchContributionIncomeNisForDateRange } from '../lib/fetchInvoicedLast30TotalDueNis';
import { resolveNewLeadIdsForHandler } from '../utils/handlerNewLeadIds';
import {
  applySubcontractorFeeTotalsToLeads,
  fetchSubcontractorFeeTotalsByLeadIds,
} from '../lib/leadSubcontractorFees';

// Types and every Signed / Due / Contribution / Contribution Fixed rule live in the calculation
// module so this file stays a report view. See simpleContributionCalculator for why there is no
// cross-contribution here.
import {
  calculateSimpleEmployeeMetrics,
  computeMaxIncentives,
  computeSalaryBudget,
  resolveContributionFixed,
  roundContributionMoney,
  scaleDepartmentsToInvoicedIncome,
  type DepartmentData,
  type EmployeeData,
} from '../utils/simpleContributionCalculator';

/**
 * Share of invoiced due recognised as income. A deliberate ~10% haircut, so "Total income" here is
 * expected to sit below the Dashboard Invoiced scoreboard's Total for the same date range.
 */
const INVOICED_TO_INCOME_RATE = 0.9;

/** Preset ranges lock From/To dates and use averaged salary over the same calendar months. */
export type SalesContributionPeriodPreset = 'custom' | 'last3months' | 'last6months' | 'last12months';

function getPresetMonthCount(preset: SalesContributionPeriodPreset): number {
  switch (preset) {
    case 'last3months':
      return 3;
    case 'last6months':
      return 6;
    case 'last12months':
      return 12;
    default:
      return 0;
  }
}

/** In-memory only: survives route changes in the same tab (module scope), not a full page refresh. */
function buildSimpleContributionCacheKey(
  f: { fromDate: string; toDate: string },
  periodPreset: SalesContributionPeriodPreset,
  salaryFilter: { month: number; year: number },
  dueNormalized: number,
  includeFixedContribution: boolean
): string {
  return JSON.stringify({
    fromDate: f.fromDate,
    toDate: f.toDate,
    periodPreset,
    salaryMonth: salaryFilter.month,
    salaryYear: salaryFilter.year,
    dueNormalized,
    includeFixedContribution,
  });
}

type SimpleContributionMemoryCache = {
  key: string;
  departmentData: Map<string, DepartmentData>;
  totalIncome: number;
  totalSignedValue: number;
  employeeMap: Map<number, { display_name: string; department: string; photo_url?: string | null }>;
};

let simpleContributionMemoryCache: SimpleContributionMemoryCache | null = null;

function formatYmdLocalFromDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** First day of (current − (N−1) months) through today, for N = 3 | 6 | 12. */
export function computeSalesContributionPresetDateRange(
  preset: Exclude<SalesContributionPeriodPreset, 'custom'>,
  ref: Date = new Date()
): { fromDate: string; toDate: string } {
  const n = getPresetMonthCount(preset);
  const toDate = formatYmdLocalFromDate(new Date(ref.getFullYear(), ref.getMonth(), ref.getDate()));
  const from = new Date(ref.getFullYear(), ref.getMonth() - (n - 1), 1);
  return { fromDate: formatYmdLocalFromDate(from), toDate };
}

/** Inclusive list of calendar months from fromDate through toDate (by month). */
function enumerateMonthsFromRange(fromDateStr: string, toDateStr: string): { month: number; year: number }[] {
  const pairs: { month: number; year: number }[] = [];
  const [fy, fm] = fromDateStr.split('-').map(Number);
  const [ty, tm] = toDateStr.split('-').map(Number);
  let y = fy;
  let m = fm;
  for (;;) {
    pairs.push({ month: m, year: y });
    if (y === ty && m === tm) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    if (pairs.length > 400) break;
  }
  return pairs;
}

async function fetchSalaryDataMapForSalesReport(
  employeeIds: number[],
  periodPreset: SalesContributionPeriodPreset,
  filters: { fromDate?: string; toDate?: string },
  salaryFilter: { month?: number; year?: number }
): Promise<Map<number, { salaryBrutto: number; totalSalaryCost: number }>> {
  const result = new Map<number, { salaryBrutto: number; totalSalaryCost: number }>();
  if (employeeIds.length === 0) return result;

  let months: { month: number; year: number }[];
  if (periodPreset === 'custom') {
    if (!salaryFilter?.month || !salaryFilter?.year) return result;
    months = [{ month: salaryFilter.month, year: salaryFilter.year }];
  } else {
    if (!filters.fromDate || !filters.toDate) return result;
    months = enumerateMonthsFromRange(filters.fromDate, filters.toDate);
  }
  if (months.length === 0) return result;

  const allowed = new Set(months.map((p) => `${p.year}-${p.month}`));
  const denom = months.length;
  const minYear = Math.min(...months.map((p) => p.year));
  const maxYear = Math.max(...months.map((p) => p.year));

  const { data, error } = await supabase
    .from('employee_salary')
    .select('employee_id, net_salary, gross_salary, salary_month, salary_year')
    .in('employee_id', employeeIds)
    .gte('salary_year', minYear)
    .lte('salary_year', maxYear);

  if (error || !data) {
    if (error) console.error('fetchSalaryDataMapForSalesReport:', error);
    return result;
  }

  const sumByEmp = new Map<number, { sumNet: number; sumGross: number }>();
  for (const row of data) {
    const yr = Number(row.salary_year);
    const mo = Number(row.salary_month);
    if (!allowed.has(`${yr}-${mo}`)) continue;
    const eid = Number(row.employee_id);
    if (!sumByEmp.has(eid)) sumByEmp.set(eid, { sumNet: 0, sumGross: 0 });
    const agg = sumByEmp.get(eid)!;
    agg.sumNet += Number(row.net_salary || 0);
    agg.sumGross += Number(row.gross_salary || 0);
  }

  for (const eid of employeeIds) {
    const agg = sumByEmp.get(eid);
    result.set(eid, {
      salaryBrutto: denom > 0 && agg ? agg.sumNet / denom : 0,
      totalSalaryCost: denom > 0 && agg ? agg.sumGross / denom : 0,
    });
  }
  return result;
}

// Helper functions for date range filtering (same as SignedSalesReportPage.tsx)
const toStartOfDayIso = (dateStr: string) => {
  // Use explicit UTC time to avoid timezone shifts
  // Format: YYYY-MM-DDTHH:mm:ss.sssZ
  return `${dateStr}T00:00:00.000Z`;
};

const toEndOfDayIso = (dateStr: string) => {
  // Use explicit UTC time for end of day (23:59:59.999)
  // Format: YYYY-MM-DDTHH:mm:ss.sssZ
  return `${dateStr}T23:59:59.999Z`;
};

const computeDateBounds = (fromDate?: string, toDate?: string) => {
  const startIso = fromDate ? toStartOfDayIso(fromDate) : null;
  const endIso = (() => {
    if (toDate) return toEndOfDayIso(toDate);
    if (fromDate) return toEndOfDayIso(fromDate);
    return null;
  })();
  return { startIso, endIso };
};

const formatContributionGraphDate = (value: string): string => {
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
  }).format(date).replace(/\//g, '.');
};

const formatContributionGraphWeekday = (value: string): string => {
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    timeZone: 'UTC',
  }).format(date);
};

/** Sticky thead — vertical scroll is on `.app-main-scroll`; do not wrap table in `overflow-x-auto`. */
const SC_TABLE_THEAD_STICKY =
  '[&_th]:sticky [&_th]:top-0 [&_th]:z-[30] [&_th]:border-b [&_th]:border-base-300 [&_th]:align-middle [&_th]:bg-white dark:[&_th]:bg-base-100';

const CONTRIBUTION_TABLE_COLUMNS = [
  { key: 'employee', label: 'Employee' },
  { key: 'department', label: 'Department' },
  { key: 'signed', label: 'Signed' },
  { key: 'due', label: 'Due' },
  { key: 'contribution', label: 'Contribution' },
  { key: 'contributionFixed', label: 'C. Fixed' },
  { key: 'salaryBudget', label: 'Salary Budget' },
  { key: 'salary', label: 'Salary (B)' },
  { key: 'totalCost', label: 'Total Cost' },
  { key: 'incentives', label: 'Incentives' },
] as const;

const SimpleContributionReportPage = () => {
  const navigate = useNavigate();

  // Helper function to format date as YYYY-MM-DD in local timezone
  const formatDateLocal = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const today = new Date();
  const firstDayOfMonth = formatDateLocal(new Date(today.getFullYear(), today.getMonth(), 1));
  const lastDayOfMonth = formatDateLocal(new Date(today.getFullYear(), today.getMonth() + 1, 0));
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(today.getDate() - 30);
  const last30DaysFrom = formatDateLocal(thirtyDaysAgo);
  const last30DaysTo = formatDateLocal(today);

  // Calculate previous month and year for salary filter default
  const previousMonthDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const previousMonth = previousMonthDate.getMonth() + 1; // 1-12
  const previousYear = previousMonthDate.getFullYear();

  const [filters, setFilters] = usePersistedFilters('simpleContribution_filters', {
    fromDate: last30DaysFrom,
    toDate: last30DaysTo,
  }, {
    storage: 'sessionStorage',
  });

  const [departmentData, setDepartmentData] = useState<Map<string, DepartmentData>>(new Map());
  const [loading, setLoading] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);
  const [allCategories, setAllCategories] = useState<any[]>([]);
  const [categoryNameToDataMap, setCategoryNameToDataMap] = useState<Map<string, any>>(new Map());
  const [categoriesLoaded, setCategoriesLoaded] = useState(false);
  const [searchPerformed, setSearchPerformed] = usePersistedState('simpleContribution_reportShown_v2', false, {
    storage: 'sessionStorage',
  });
  /** 90% of the invoiced income base for the report From/To filter — see fetchContributionIncomeNisForDateRange */
  const [totalIncome, setTotalIncome] = useState(0);
  const totalIncomeRef = useRef(0);
  totalIncomeRef.current = totalIncome ?? 0;
  /** Monotonic counter so overlapping Search runs do not read stale total-signed ref or clobber UI state. */
  const salesContributionSearchSeqRef = useRef(0);
  const scrollToEmployeeResultAfterSearchRef = useRef(false);
  const [loadingInvoicedIncome, setLoadingInvoicedIncome] = useState(false);
  const [dueNormalizedPercentage, setDueNormalizedPercentage] = usePersistedState('simpleContribution_dueNormalizedPercentage', 0, {
    storage: 'sessionStorage',
  });
  const [employeeSearchTerm, setEmployeeSearchTerm] = usePersistedState('simpleContribution_employeeSearchTerm', '', {
    storage: 'sessionStorage',
  });
  const [filterTrophyBadgeEmployeesOnly, setFilterTrophyBadgeEmployeesOnly] = usePersistedState(
    'simpleContribution_filterTrophyBadgeEmployeesOnly',
    false,
    { storage: 'sessionStorage' }
  );

  // Salary filter state (defaults to previous month/year)
  const [salaryFilter, setSalaryFilter] = usePersistedState('simpleContribution_salaryFilter', {
    month: previousMonth, // 1-12
    year: previousYear,
  }, {
    storage: 'sessionStorage',
  });

  const [periodPreset, setPeriodPreset] = usePersistedState<SalesContributionPeriodPreset>(
    'simpleContribution_periodPreset',
    'custom',
    { storage: 'sessionStorage' }
  );

  const periodFiltersLocked = periodPreset !== 'custom';

  // Define department names to match (must be before functions that use it)
  const departmentNames = ['Sales', 'Handlers', 'Partners', 'Marketing', 'Finance'];

  // Department percentage settings
  const [departmentPercentages, setDepartmentPercentages] = useState<Map<string, number>>(new Map());
  const [editingPercentage, setEditingPercentage] = useState<string | null>(null);
  const [tempPercentage, setTempPercentage] = useState<string>('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [loadingSettings, setLoadingSettings] = useState(false);

  // Role percentage settings
  const [rolePercentages, setRolePercentages] = useState<Map<string, number>>(new Map());
  const [tempRolePercentages, setTempRolePercentages] = useState<Map<string, string>>(new Map());
  const [isDynamicIslandOpen, setIsDynamicIslandOpen] = useState(false);
  const [isFixedContributionModalOpen, setIsFixedContributionModalOpen] = useState(false);
  const [isDepartmentRolesModalOpen, setIsDepartmentRolesModalOpen] = useState(false);
  const [isCorrectionInfoModalOpen, setIsCorrectionInfoModalOpen] = useState(false);
  const [isFiltersOpen, setIsFiltersOpen] = useState(true);
  const [isColumnSettingsOpen, setIsColumnSettingsOpen] = useState(false);
  const [isReportScrolled, setIsReportScrolled] = useState(false);
  const [forceBottomFilters, setForceBottomFilters] = useState(false);
  const [mainProgressGraphsVisible, setMainProgressGraphsVisible] = useState({
    salesSigned: true,
    handlersDue: true,
  });
  const [mainProgressDailyData, setMainProgressDailyData] = useState<{
    salesSigned: Array<{ date: string; total: number }>;
    handlersDue: Array<{ date: string; total: number }>;
  }>({ salesSigned: [], handlersDue: [] });
  const columnSettingsRef = useRef<HTMLDivElement>(null);
  const [visibleContributionColumns, setVisibleContributionColumns] = usePersistedState<string[]>(
    'simpleContribution_visibleColumns',
    CONTRIBUTION_TABLE_COLUMNS.map((column) => column.key),
    { storage: 'localStorage' }
  );
  const [includeFixedContribution, setIncludeFixedContribution] = usePersistedState(
    'simpleContribution_includeFixedContribution',
    false,
    { storage: 'localStorage' }
  );
  const includeFixedContributionRef = useRef(includeFixedContribution);
  includeFixedContributionRef.current = includeFixedContribution;

  useEffect(() => {
    if (!isColumnSettingsOpen) return;

    const handleClickAway = (event: MouseEvent | TouchEvent) => {
      if (!columnSettingsRef.current?.contains(event.target as Node)) {
        setIsColumnSettingsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickAway);
    document.addEventListener('touchstart', handleClickAway);
    return () => {
      document.removeEventListener('mousedown', handleClickAway);
      document.removeEventListener('touchstart', handleClickAway);
    };
  }, [isColumnSettingsOpen]);

  useEffect(() => {
    const scrollContainer = document.querySelector<HTMLElement>('.app-main-scroll');
    const target = scrollContainer || window;
    const readScrollTop = () =>
      scrollContainer ? scrollContainer.scrollTop : window.scrollY;
    const handleScroll = () => setIsReportScrolled(readScrollTop() > 240);

    handleScroll();
    target.addEventListener('scroll', handleScroll, { passive: true });
    return () => target.removeEventListener('scroll', handleScroll);
  }, []);

  const [useFixedContributionFromDb, setUseFixedContributionFromDb] = useState(false);
  const [savingRolePercentages, setSavingRolePercentages] = useState(false);
  const [loadingRolePercentages, setLoadingRolePercentages] = useState(false);

  // Employee field assignments modal state
  const [fieldAssignmentsModalOpen, setFieldAssignmentsModalOpen] = useState(false);
  const [selectedEmployeeForModal, setSelectedEmployeeForModal] = useState<{
    id: number;
    name: string;
    photoUrl?: string;
  } | null>(null);


  // Fetch department percentages and income from database
  const fetchSettings = useCallback(async () => {
    setLoadingSettings(true);
    try {
      // Fetch department percentages
      const { data: departmentSettings, error: deptError } = await supabase
        .from('sales_contribution_settings')
        .select('department_name, percentage')
        .order('department_name');

      if (deptError) {
        console.error('Error fetching department percentages:', deptError);
        // If table doesn't exist, initialize with defaults
        const defaultPercentages = new Map<string, number>();
        departmentNames.forEach(dept => {
          defaultPercentages.set(dept, 0);
        });
        setDepartmentPercentages(defaultPercentages);
      } else if (departmentSettings) {
        const percentagesMap = new Map<string, number>();
        departmentSettings.forEach(setting => {
          percentagesMap.set(setting.department_name, Number(setting.percentage) || 0);
        });
        setDepartmentPercentages(percentagesMap);
      }

      // Total income is computed from invoiced due for the report date range — not loaded from DB
      const { data: incomeSettings, error: incomeError } = await supabase
        .from('sales_contribution_income')
        .select('due_normalized_percentage')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!incomeError && incomeSettings) {
        if (incomeSettings.due_normalized_percentage !== null && incomeSettings.due_normalized_percentage !== undefined) {
          const duePercentage = Number(incomeSettings.due_normalized_percentage);
          if (!isNaN(duePercentage) && duePercentage >= 0 && duePercentage <= 100) {
            setDueNormalizedPercentage(duePercentage);
          }
        }
      }

      // Fetch "use fixed contribution from DB" toggle (default false = hardcoded logic)
      const { data: fixedToggleRow } = await supabase
        .from('sales_contribution_use_fixed_from_db')
        .select('use_fixed_contribution_from_db')
        .eq('id', 1)
        .maybeSingle();
      setUseFixedContributionFromDb(!!fixedToggleRow?.use_fixed_contribution_from_db);
    } catch (error) {
      console.error('Error fetching settings:', error);
    } finally {
      setLoadingSettings(false);
    }
  }, [departmentNames, setDueNormalizedPercentage]);

  const refreshIncomeFromInvoicedForFilter = useCallback(async (): Promise<number> => {
    if (!filters.fromDate || !filters.toDate) {
      setTotalIncome(0);
      setLoadingInvoicedIncome(false);
      return 0;
    }
    setLoadingInvoicedIncome(true);
    try {
      /*
       * Must be the contribution-income fetcher, not the due-based one.
       *
       * They differ from October 2026 on: the due-based total counts whatever fell due, while this
       * report counts what was actually invoiced — the same rule the per-employee Due / Invoiced cells
       * apply. Reading the due-based total here made the header disagree with the column beneath it,
       * showing income for money that no invoice had been sent for.
       */
      const totalDueNis = await fetchContributionIncomeNisForDateRange(filters.fromDate, filters.toDate);
      // Intentional ~10% haircut: income recognised for contribution purposes sits deliberately below
      // the invoiced total it is derived from.
      const income = Math.round(totalDueNis * INVOICED_TO_INCOME_RATE);
      setTotalIncome(income);
      return income;
    } catch (e) {
      console.error('Failed to compute income from invoiced total due for date range:', e);
      setTotalIncome(0);
      return 0;
    } finally {
      setLoadingInvoicedIncome(false);
    }
  }, [filters.fromDate, filters.toDate]);

  // Fetch role percentages from database
  const fetchRolePercentages = useCallback(async () => {
    setLoadingRolePercentages(true);
    try {
      const { data: roleSettings, error: roleError } = await supabase
        .from('role_percentages')
        .select('role_name, percentage, description')
        .order('role_name');

      if (roleError) {
        console.error('Error fetching role percentages:', roleError);
        // Initialize with defaults if table doesn't exist
        const defaultRolePercentages = new Map<string, number>();
        defaultRolePercentages.set('CLOSER', 40);
        defaultRolePercentages.set('SCHEDULER', 30);
        defaultRolePercentages.set('MANAGER', 20);
        defaultRolePercentages.set('EXPERT', 10);
        defaultRolePercentages.set('HANDLER', 0);
        defaultRolePercentages.set('CLOSER_WITH_HELPER', 20);
        defaultRolePercentages.set('HELPER_CLOSER', 20);
        defaultRolePercentages.set('HELPER_HANDLER', 0);
        defaultRolePercentages.set('DEPARTMENT_MANAGER', 0);
        setRolePercentages(defaultRolePercentages);
      } else if (roleSettings && roleSettings.length > 0) {
        const percentagesMap = new Map<string, number>();
        roleSettings.forEach(setting => {
          percentagesMap.set(setting.role_name, Number(setting.percentage) || 0);
        });
        setRolePercentages(percentagesMap);
        // Initialize temp map with current values
        const tempMap = new Map<string, string>();
        roleSettings.forEach(setting => {
          tempMap.set(setting.role_name, setting.percentage.toString());
        });
        // Ensure all roles are in temp map
        const allRoles = ['CLOSER', 'SCHEDULER', 'MANAGER', 'EXPERT', 'HANDLER', 'CLOSER_WITH_HELPER', 'HELPER_CLOSER', 'HELPER_HANDLER', 'DEPARTMENT_MANAGER'];
        allRoles.forEach(role => {
          if (!tempMap.has(role)) {
            tempMap.set(role, '0');
          }
        });
        setTempRolePercentages(tempMap);
      } else {
        // No data in database, use defaults
        const defaultRolePercentages = new Map<string, number>();
        defaultRolePercentages.set('CLOSER', 40);
        defaultRolePercentages.set('SCHEDULER', 30);
        defaultRolePercentages.set('MANAGER', 20);
        defaultRolePercentages.set('EXPERT', 10);
        defaultRolePercentages.set('HANDLER', 0);
        defaultRolePercentages.set('CLOSER_WITH_HELPER', 20);
        defaultRolePercentages.set('HELPER_CLOSER', 20);
        defaultRolePercentages.set('HELPER_HANDLER', 0);
        defaultRolePercentages.set('DEPARTMENT_MANAGER', 0);
        setRolePercentages(defaultRolePercentages);
        // Initialize temp map with defaults
        const tempMap = new Map<string, string>();
        defaultRolePercentages.forEach((value, key) => {
          tempMap.set(key, value.toString());
        });
        setTempRolePercentages(tempMap);
      }
    } catch (error) {
      console.error('Error fetching role percentages:', error);
      toast.error('Failed to load role percentages');
    } finally {
      setLoadingRolePercentages(false);
    }
  }, []);

  // Helper function to generate a hash of role percentages for cache key
  const getRolePercentagesHash = useCallback((percentages: Map<string, number>): string => {
    const roleNames = ['CLOSER', 'SCHEDULER', 'MANAGER', 'EXPERT', 'HANDLER', 'CLOSER_WITH_HELPER', 'HELPER_CLOSER', 'HELPER_HANDLER', 'DEPARTMENT_MANAGER'];
    const values = roleNames.map(role => `${role}:${percentages.get(role) || 0}`).join('|');
    // Simple hash - just use the values string (could use a proper hash function if needed)
    return values;
  }, []);

  // Save role percentages to database
  const saveRolePercentages = useCallback(async () => {
    setSavingRolePercentages(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const userId = user?.id || null;

      const roleNames = ['CLOSER', 'SCHEDULER', 'MANAGER', 'EXPERT', 'HANDLER', 'CLOSER_WITH_HELPER', 'HELPER_CLOSER', 'HELPER_HANDLER', 'DEPARTMENT_MANAGER'];
      const savePromises = roleNames.map(async (roleName) => {
        // Get value from tempRolePercentages, fallback to rolePercentages, then to '0'
        const percentageStr = tempRolePercentages.get(roleName) || rolePercentages.get(roleName)?.toString() || '0';
        const percentage = parseFloat(percentageStr);

        if (isNaN(percentage) || percentage < 0 || percentage > 100) {
          throw new Error(`Invalid percentage for ${roleName}: ${percentageStr}`);
        }

        const { error } = await supabase
          .from('role_percentages')
          .upsert({
            role_name: roleName,
            percentage: percentage,
            updated_at: new Date().toISOString(),
            updated_by: userId,
          }, {
            onConflict: 'role_name'
          });

        if (error) {
          console.error(`Error saving percentage for ${roleName}:`, error);
          throw error;
        }

        // Update the actual role percentages map
        setRolePercentages(prev => {
          const updated = new Map(prev);
          updated.set(roleName, percentage);
          return updated;
        });
      });

      await Promise.all(savePromises);

      // Clear cache to force recalculation with new role percentages
      setRoleDataCache(new Map());

      toast.success('Role percentages saved successfully. Click Search to refresh the report.');
    } catch (error: any) {
      console.error('Error saving role percentages:', error);
      toast.error(error.message || 'Failed to save role percentages');
    } finally {
      setSavingRolePercentages(false);
    }
  }, [tempRolePercentages, rolePercentages]);

  // Save department percentages and income to database
  const saveSettings = useCallback(async () => {
    setSavingSettings(true);
    try {
      // Get current user for tracking
      const { data: { user } } = await supabase.auth.getUser();
      const userId = user?.id || null;

      // Save department percentages
      const percentagePromises = departmentNames.map(async (deptName) => {
        const percentage = departmentPercentages.get(deptName) || 0;
        const { error } = await supabase
          .from('sales_contribution_settings')
          .upsert({
            department_name: deptName,
            percentage: percentage,
            updated_at: new Date().toISOString(),
            updated_by: userId,
          }, {
            onConflict: 'department_name'
          });

        if (error) {
          console.error(`Error saving percentage for ${deptName}:`, error);
          console.error('Error details:', JSON.stringify(error, null, 2));
          throw error;
        }
      });

      // Save income and due normalized percentage - get existing row first, then update or insert
      const { data: existingIncome } = await supabase
        .from('sales_contribution_income')
        .select('id')
        .limit(1)
        .maybeSingle();

      let incomeError;
      if (existingIncome?.id) {
        // Update existing row
        const { error } = await supabase
          .from('sales_contribution_income')
          .update({
            income_amount: totalIncome,
            due_normalized_percentage: dueNormalizedPercentage,
            updated_at: new Date().toISOString(),
            updated_by: userId,
          })
          .eq('id', existingIncome.id);
        incomeError = error;
      } else {
        // Insert new row (shouldn't happen, but handle it)
        const { error } = await supabase
          .from('sales_contribution_income')
          .insert({
            income_amount: totalIncome,
            due_normalized_percentage: dueNormalizedPercentage,
            updated_at: new Date().toISOString(),
            updated_by: userId,
          });
        incomeError = error;
      }

      if (incomeError) {
        console.error('Error saving income:', incomeError);
        console.error('Income error details:', JSON.stringify(incomeError, null, 2));
        throw incomeError;
      }

      await Promise.all(percentagePromises);
      toast.success('Settings saved successfully');

      // Recalculate signed portions for all employees after income change
      // Clear role data cache to force recalculation with new income
      // The cache key includes income, so clearing cache will force refetch with new income
      setRoleDataCache(new Map());
    } catch (error: any) {
      console.error('Error saving settings:', error);
      console.error('Error details:', JSON.stringify(error, null, 2));

      // Provide more specific error messages
      let errorMessage = 'Failed to save settings';
      if (error?.code === '42P01') {
        errorMessage = 'Database table does not exist. Please run the SQL migration.';
      } else if (error?.code === '42501') {
        errorMessage = 'Permission denied. Please check database permissions.';
      } else if (error?.message) {
        errorMessage = `Failed to save: ${error.message}`;
      }

      toast.error(errorMessage);
    } finally {
      setSavingSettings(false);
    }
  }, [departmentNames, departmentPercentages, totalIncome, dueNormalizedPercentage, filters.fromDate, filters.toDate, departmentData]);

  // Fetch all categories with their parent main category names (for mapping text categories)
  useEffect(() => {
    const fetchCategories = async () => {
      // Fetch categories
      const { data: categoriesData, error: categoriesError } = await supabase
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
        .order('name', { ascending: true });

      // Fetch main categories directly
      const { data: mainCategoriesData, error: mainCategoriesError } = await supabase
        .from('misc_maincategory')
        .select('id, name')
        .order('name', { ascending: true });

      if (!categoriesError && categoriesData) {
        setAllCategories(categoriesData);

        // Create a map from category name (normalized) to category data (including main category)
        const nameToDataMap = new Map<string, any>();

        // First, add all categories to the map
        categoriesData.forEach((category: any) => {
          if (category.name) {
            const normalizedName = category.name.trim().toLowerCase();
            nameToDataMap.set(normalizedName, category);

            // Also map the main category name if it exists
            const mainCategory = Array.isArray(category.misc_maincategory)
              ? category.misc_maincategory[0]
              : category.misc_maincategory;

            if (mainCategory && mainCategory.name) {
              const normalizedMainCategoryName = mainCategory.name.trim().toLowerCase();
              // Always add main category name mapping (even if same as category name)
              // This ensures we can match text categories that are main category names
              if (!nameToDataMap.has(normalizedMainCategoryName)) {
                nameToDataMap.set(normalizedMainCategoryName, category);
              }
            }
          }
        });

        // Also add main categories directly to the map
        // This helps when leads have text categories that match main category names exactly
        if (!mainCategoriesError && mainCategoriesData) {
          mainCategoriesData.forEach((mainCategory: any) => {
            if (mainCategory.name) {
              const normalizedMainCategoryName = mainCategory.name.trim().toLowerCase();

              // Find a category that belongs to this main category
              const categoryForMainCategory = categoriesData.find((cat: any) => {
                const catMainCategory = Array.isArray(cat.misc_maincategory)
                  ? cat.misc_maincategory[0]
                  : cat.misc_maincategory;
                return catMainCategory && catMainCategory.id === mainCategory.id;
              });

              // If we found a category, use it; otherwise create a synthetic entry
              if (categoryForMainCategory) {
                if (!nameToDataMap.has(normalizedMainCategoryName)) {
                  nameToDataMap.set(normalizedMainCategoryName, categoryForMainCategory);
                }
              } else {
                // Create a synthetic category entry for this main category
                const syntheticCategory = {
                  id: null,
                  name: mainCategory.name,
                  parent_id: mainCategory.id,
                  misc_maincategory: mainCategory
                };
                nameToDataMap.set(normalizedMainCategoryName, syntheticCategory);
              }
            }
          });
        }

        setCategoryNameToDataMap(nameToDataMap);
        setCategoriesLoaded(true);

        // Debug: Log the map size and sample keys
        console.log('🔍 Category Name to Data Map populated:', {
          size: nameToDataMap.size,
          sampleKeys: Array.from(nameToDataMap.keys()).slice(0, 30),
          hasSmallWithoutMeeting: nameToDataMap.has('small without meetin'),
          mainCategoriesCount: mainCategoriesData?.length || 0
        });
      } else {
        // Even if there's an error, mark as loaded so we don't wait forever
        setCategoriesLoaded(true);
      }
    };
    fetchCategories();
  }, []);

  // Load settings on mount (only once)
  const hasLoadedSettingsRef = useRef(false);
  useEffect(() => {
    if (!hasLoadedSettingsRef.current) {
      hasLoadedSettingsRef.current = true;
      fetchSettings();
      fetchRolePercentages();
    }
  }, [fetchRolePercentages]); // Only run once on mount

  // Update tempRolePercentages when rolePercentages changes and modal is open
  useEffect(() => {
    if (isDynamicIslandOpen && rolePercentages.size > 0) {
      const tempMap = new Map<string, string>();
      rolePercentages.forEach((value, key) => {
        tempMap.set(key, value.toString());
      });
      // Ensure all roles are in temp map
      const allRoles = ['CLOSER', 'SCHEDULER', 'MANAGER', 'EXPERT', 'HANDLER', 'CLOSER_WITH_HELPER', 'HELPER_CLOSER', 'HELPER_HANDLER', 'DEPARTMENT_MANAGER'];
      allRoles.forEach(role => {
        if (!tempMap.has(role)) {
          tempMap.set(role, '0');
        }
      });
      setTempRolePercentages(tempMap);
    }
  }, [isDynamicIslandOpen, rolePercentages]);

  const [totalSignedValue, setTotalSignedValue] = useState<number>(0);
  const totalSignedValueRef = useRef<number>(0);
  const [loadingSignedValue, setLoadingSignedValue] = useState<boolean>(false);
  const [roleDataCache, setRoleDataCache] = useState<Map<string, any[]>>(new Map());
  const [loadingRoleData, setLoadingRoleData] = useState<Set<string>>(new Set());
  // Track which role sections are expanded/collapsed: Map<fieldName_roleName, boolean>
  const [modalOpen, setModalOpen] = useState(false);
  const [modalEmployeeId, setModalEmployeeId] = useState<number | null>(null);
  const [modalEmployeeName, setModalEmployeeName] = useState<string>('');
  const [modalRole, setModalRole] = useState<string>('');
  const [employeeMap, setEmployeeMap] = useState<Map<number, { display_name: string; department: string; photo_url?: string | null }>>(new Map());
  const scMemoryRestoreAttemptedRef = useRef(false);
  const scPrevLoadingForScCacheRef = useRef(false);
  const imageErrorCache = useRef<Map<number, boolean>>(new Map());

  /** Preset reports span multiple months; top summary badges show monthly averages (same month count as avg. salary). */
  const summaryMonthlyDivisor = useMemo(() => {
    if (periodPreset === 'custom') return 1;
    if (filters.fromDate && filters.toDate) {
      const n = enumerateMonthsFromRange(filters.fromDate, filters.toDate).length;
      return n > 0 ? n : 1;
    }
    const n = getPresetMonthCount(periodPreset);
    return n > 0 ? n : 1;
  }, [periodPreset, filters.fromDate, filters.toDate]);

  const hasPositiveMaxIncentives = useCallback((emp: EmployeeData) => {
    const periodScale = periodPreset === 'custom' ? 1 : summaryMonthlyDivisor;
    const maxIncentives = ((emp.salaryBudget ?? 0) / periodScale) - (emp.totalSalaryCost ?? 0);
    return maxIncentives > 0;
  }, [periodPreset, summaryMonthlyDivisor]);

  const employeeMatchesRowFilters = useCallback((emp: EmployeeData) => {
    if (filterTrophyBadgeEmployeesOnly && !hasPositiveMaxIncentives(emp)) {
      return false;
    }
    if (!employeeSearchTerm.trim()) return true;
    const searchLower = employeeSearchTerm.toLowerCase().trim();
    return (
      emp.employeeName.toLowerCase().includes(searchLower) ||
      (emp.department ?? '').toLowerCase().includes(searchLower)
    );
  }, [filterTrophyBadgeEmployeesOnly, hasPositiveMaxIncentives, employeeSearchTerm]);

  useEffect(() => {
    if (
      loading ||
      isCalculating ||
      !searchPerformed ||
      !scrollToEmployeeResultAfterSearchRef.current ||
      !employeeSearchTerm.trim()
    ) {
      return;
    }

    const matchingDepartment = departmentNames.find((departmentName) =>
      departmentData.get(departmentName)?.employees.some(employeeMatchesRowFilters)
    );
    scrollToEmployeeResultAfterSearchRef.current = false;
    if (!matchingDepartment) return;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document
          .getElementById(`contribution-table-${matchingDepartment.toLowerCase()}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }, [
    loading,
    isCalculating,
    searchPerformed,
    employeeSearchTerm,
    departmentData,
    employeeMatchesRowFilters,
  ]);

  useEffect(() => {
    const term = employeeSearchTerm.trim();
    if (!term || loading || isCalculating || !searchPerformed) return;

    const timeout = window.setTimeout(() => {
      const matchingDepartment = departmentNames.find((departmentName) =>
        departmentData.get(departmentName)?.employees.some(employeeMatchesRowFilters)
      );
      if (!matchingDepartment) return;
      document
        .getElementById(`contribution-table-${matchingDepartment.toLowerCase()}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 350);

    return () => window.clearTimeout(timeout);
  }, [
    employeeSearchTerm,
    loading,
    isCalculating,
    searchPerformed,
    departmentData,
    employeeMatchesRowFilters,
  ]);

  /** Summary KPIs always represent the full report period, regardless of employee-name filtering. */
  const totalCostAllEmployees = useMemo(() => {
    let sum = 0;
    for (const deptName of departmentNames) {
      const deptData = departmentData.get(deptName);
      if (!deptData) continue;
      sum += deptData.employees.reduce(
        (s, emp) => s + (emp.totalSalaryCost ?? 0),
        0
      );
    }
    return sum;
    // departmentNames is constant list; omit from deps to avoid new [] reference each render
  }, [departmentData]);

  const displayTotalCostForTopBadge = totalCostAllEmployees;

  // Sum of salary budget across all employees in all departments
  const totalSalaryBudgetAllEmployees = useMemo(() => {
    let sum = 0;
    for (const dept of departmentData.values()) {
      for (const emp of dept.employees) {
        sum += emp.salaryBudget ?? 0;
      }
    }
    return sum;
  }, [departmentData]);

  const displaySummaryTotalSigned = totalSignedValue / summaryMonthlyDivisor;
  const displaySummaryTotalIncome = (totalIncome || 0) / summaryMonthlyDivisor;
  const displaySummarySalaryBudget = totalSalaryBudgetAllEmployees / summaryMonthlyDivisor;
  /** Gross salary cost is already monthly avg per employee in preset mode (see fetchSalaryDataMapForSalesReport); summing is team monthly cost — do not divide by N again. */
  const displaySummaryTotalCost =
    periodPreset !== 'custom'
      ? displayTotalCostForTopBadge
      : displayTotalCostForTopBadge / summaryMonthlyDivisor;

  /**
   * Sum of stored `contribution + contributionFixed` for all employees in the report. After
   * `scaleDepartmentsToInvoicedIncome`, when department % values sum to 100%, this matches `totalIncome`
   * (apart from tiny rounding drift). Per-table "Total" rows can differ (links/marketing display).
   */
  const totalStoredContributionAndFixed = useMemo(() => {
    let sum = 0;
    for (const dept of departmentData.values()) {
      for (const emp of dept.employees) {
        sum += (emp.contribution ?? 0) + (emp.contributionFixed ?? 0);
      }
    }
    return sum;
  }, [departmentData]);

  // Helper function to get employee initials
  const getEmployeeInitials = (name: string) => {
    if (!name) return '--';
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  // Employee Avatar component
  const EmployeeAvatar: React.FC<{
    employeeId: number;
    size?: 'sm' | 'md' | 'lg';
    showPositiveMaxIncentiveBadge?: boolean;
    maxIncentivesTooltip?: string;
  }> = ({ employeeId, size = 'md', showPositiveMaxIncentiveBadge = false, maxIncentivesTooltip }) => {
    const [imageError, setImageError] = useState(false);
    const employee = employeeMap.get(employeeId);

    const badgeSizeClasses =
      size === 'sm'
        ? 'h-3.5 min-w-3.5 -top-0.5 -right-1'
        : size === 'md'
          ? 'h-4 min-w-4 -top-0.5 -right-1'
          : 'h-[1.125rem] min-w-[1.125rem] -top-0.5 -right-1.5';

    const badgeIconSizeClasses =
      size === 'sm'
        ? 'h-2.5 w-2.5'
        : size === 'md'
          ? 'h-3 w-3'
          : 'h-4 w-4';

    const wrapAvatar = (avatarNode: React.ReactNode) => (
      <span className="relative inline-flex flex-shrink-0">
        {avatarNode}
        {showPositiveMaxIncentiveBadge && (
          <span
            className={`absolute z-[1] flex items-center justify-center rounded-full bg-gradient-to-br from-yellow-400 via-amber-500 to-orange-500 p-0.5 text-white ${badgeSizeClasses}`}
            title={maxIncentivesTooltip || 'Positive max incentives'}
          >
            <TrophyIcon className={`${badgeIconSizeClasses} shrink-0 stroke-[2.5]`} aria-hidden="true" />
          </span>
        )}
      </span>
    );

    if (!employee) {
      const sizeClasses = size === 'sm' ? 'w-8 h-8' : size === 'md' ? 'w-10 h-10' : 'w-12 h-12';
      return wrapAvatar(
        <div className={`${sizeClasses} rounded-full flex items-center justify-center bg-gray-200 text-gray-500 text-xs font-semibold`}>
          --
        </div>
      );
    }

    const photoUrl = employee.photo_url;
    const initials = getEmployeeInitials(employee.display_name);
    const sizeClasses = size === 'sm' ? 'w-8 h-8 text-xs' : size === 'md' ? 'w-10 h-10 text-sm' : 'w-12 h-12 text-base';

    // Check cache for image errors
    const cachedError = imageErrorCache.current.get(employeeId) || false;
    const hasError = cachedError || imageError;

    // If we know there's no photo URL or we have a cached error, show initials immediately
    if (hasError || !photoUrl) {
      return wrapAvatar(
        <div className={`${sizeClasses} rounded-full flex items-center justify-center bg-green-100 text-green-700 font-semibold`}>
          {initials}
        </div>
      );
    }

    // Try to render image
    return wrapAvatar(
      <img
        src={photoUrl}
        alt={employee.display_name}
        className={`${sizeClasses} rounded-full object-cover`}
        onError={() => {
          // Cache the error to prevent flickering on re-renders
          imageErrorCache.current.set(employeeId, true);
          setImageError(true);
        }}
      />
    );
  };

  // Fetch total signed value based on date filter - using same logic as Dashboard's agreement signed total column
  const fetchTotalSignedValue = useCallback(async () => {
    if (!filters.fromDate || !filters.toDate) {
      setTotalSignedValue(0);
      totalSignedValueRef.current = 0;
      return;
    }

    setLoadingSignedValue(true);
    try {
      // Use explicit UTC timestamps to include full day: from 00:00:00.000 to 23:59:59.999
      // IMPORTANT: Filter by sign date (when stage 60 was set), NOT creation date
      const { startIso, endIso } = computeDateBounds(filters.fromDate, filters.toDate);
      const fromDateTime = startIso;
      const toDateTime = endIso;

      // Fetch legacy leads stage records (stage 60) - same as Dashboard
      const { data: legacyStageRecords, error: legacyStageError } = await supabase
        .from('leads_leadstage')
        .select('id, date, cdate, lead_id')
        .eq('stage', 60)
        .not('lead_id', 'is', null)
        .gte('date', fromDateTime)
        .lte('date', toDateTime);

      if (legacyStageError) {
        console.error('Error fetching legacy stage records:', legacyStageError);
      }

      // Fetch new leads stage records (stage 60) - same as Dashboard
      const { data: newLeadStageRecords, error: newLeadStageError } = await supabase
        .from('leads_leadstage')
        .select('id, date, cdate, newlead_id')
        .eq('stage', 60)
        .not('newlead_id', 'is', null)
        .gte('date', fromDateTime)
        .lte('date', toDateTime);

      if (newLeadStageError) {
        console.error('Error fetching new lead stage records:', newLeadStageError);
      }

      // Deduplicate legacy leads - keep only latest date for each lead_id (same as Dashboard)
      const legacyRecordsMap = new Map<number, any>();
      (legacyStageRecords || []).forEach(record => {
        if (!record.lead_id) return;
        const leadId = record.lead_id;
        const recordDate = record.date || record.cdate;
        if (!recordDate) return;

        const existingRecord = legacyRecordsMap.get(leadId);
        if (!existingRecord) {
          legacyRecordsMap.set(leadId, record);
        } else {
          const existingDate = existingRecord.date || existingRecord.cdate;
          if (existingDate && new Date(recordDate) > new Date(existingDate)) {
            legacyRecordsMap.set(leadId, record);
          }
        }
      });

      // Deduplicate new leads - keep only latest date for each newlead_id (same as Dashboard)
      const newLeadRecordsMap = new Map<string, any>();
      (newLeadStageRecords || []).forEach(record => {
        if (!record.newlead_id) return;
        const newLeadId = String(record.newlead_id);
        const recordDate = record.date || record.cdate;
        if (!recordDate) return;

        const existingRecord = newLeadRecordsMap.get(newLeadId);
        if (!existingRecord) {
          newLeadRecordsMap.set(newLeadId, record);
        } else {
          const existingDate = existingRecord.date || existingRecord.cdate;
          if (existingDate && new Date(recordDate) > new Date(existingDate)) {
            newLeadRecordsMap.set(newLeadId, record);
          }
        }
      });

      // Fetch legacy leads data - include total_base and subcontractor_fee (same as Dashboard)
      const legacyLeadIds = Array.from(legacyRecordsMap.keys());
      let legacyLeadsData: any[] = [];
      if (legacyLeadIds.length > 0) {
        // Chunked and paged: a bare `.in()` select is capped at 1000 rows, and without an
        // ORDER BY the page that comes back is arbitrary, so leads vanish silently.
        const legacyLeads = await fetchAllRowsForLeadIds<any>(legacyLeadIds, (chunk) =>
          supabase
            .from('leads_lead')
            .select(`
              id, total, total_base, currency_id, subcontractor_fee, meeting_total_currency_id,
              accounting_currencies!leads_lead_currency_id_fkey(iso_code, name)
            `)
            .in('id', chunk),
        );

        if (legacyLeads.length > 0) {
          legacyLeadsData = legacyLeads;
        }
      }

      // Fetch new leads data - include subcontractor_fee (same as Dashboard)
      const newLeadIds = Array.from(newLeadRecordsMap.keys());
      let newLeadsData: any[] = [];
      if (newLeadIds.length > 0) {
        // Chunked and paged: a bare `.in()` select is capped at 1000 rows, and without an
        // ORDER BY the page that comes back is arbitrary, so leads vanish silently.
        const newLeads = await fetchAllRowsForLeadIds<any>(newLeadIds, (chunk) =>
          supabase
            .from('leads')
            .select(`
              id, balance, proposal_total, currency_id, balance_currency, proposal_currency, subcontractor_fee,
              accounting_currencies!leads_currency_id_fkey(iso_code, name)
            `)
            .in('id', chunk),
        );

        if (newLeads.length > 0) {
          newLeadsData = newLeads;
        }
      }

      const signDates = buildSignDateMapsFromStageHistory([
        ...(legacyStageRecords || []),
        ...(newLeadStageRecords || []),
      ]);
      const boiConverter = await createBoiDateRateConverter();
      const legacyLeadsMapForEnrich = new Map(legacyLeadsData.map((l: any) => [Number(l.id), l]));
      const newLeadsMapForEnrich = new Map(newLeadsData.map((l: any) => [l.id, l]));
      await enrichLeadsMapsWithSignedNis(newLeadsMapForEnrich, legacyLeadsMapForEnrich, signDates, boiConverter);

      // Calculate total signed value in NIS - AFTER subcontractor fee (matches SignedSalesReportPage)
      let totalNIS = 0;

      legacyLeadsData.forEach(lead => {
        totalNIS += calculateLegacyLeadAmount(lead);
      });

      newLeadsData.forEach(lead => {
        totalNIS += calculateNewLeadAmount(lead);
      });

      // Round up to match Dashboard behavior (Math.ceil)
      const finalValue = Math.ceil(totalNIS);
      setTotalSignedValue(finalValue);
      totalSignedValueRef.current = finalValue;
    } catch (error) {
      console.error('Error fetching total signed value:', error);
      setTotalSignedValue(0);
      totalSignedValueRef.current = 0;
    } finally {
      setLoadingSignedValue(false);
    }
  }, [filters.fromDate, filters.toDate]);

  const handleFilterChange = (field: string, value: any) => {
    setFilters(prev => ({ ...prev, [field]: value }));
  };

  const handlePeriodPresetChange = (value: SalesContributionPeriodPreset) => {
    setPeriodPreset(value);
    if (value !== 'custom') {
      const r = computeSalesContributionPresetDateRange(value);
      setFilters((prev) => ({ ...prev, fromDate: r.fromDate, toDate: r.toDate }));
    }
  };

  // Keep From/To aligned with a persisted preset (e.g. after refresh)
  useEffect(() => {
    if (periodPreset === 'custom') return;
    const r = computeSalesContributionPresetDateRange(periodPreset);
    setFilters((prev) => {
      if (prev.fromDate === r.fromDate && prev.toDate === r.toDate) return prev;
      return { ...prev, fromDate: r.fromDate, toDate: r.toDate };
    });
  }, [periodPreset]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('he-IL', {
      style: 'currency',
      currency: 'ILS',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatPercent = (value: number) => {
    return `${value.toFixed(2)}%`;
  };

  // DEBUG: Helper Closer (L210620 / employee 129)
  const DEBUG_HELPER_CLOSER = true; // set false to disable
  const DEBUG_EMPLOYEE_ID = 129;
  const DEBUG_LEAD_NUMBER = 'L210620';

  // Fetch role data for an employee
  const fetchRoleData = useCallback(async (employeeId: number, employeeName: string) => {
    if (DEBUG_HELPER_CLOSER && employeeId === DEBUG_EMPLOYEE_ID) {
      console.log('[SalesContribution fetchRoleData] employeeId=', employeeId, 'employeeName=', employeeName, 'dateRange=', filters.fromDate, '-', filters.toDate);
    }
    // Include date range, income, due normalized percentage, and role percentages hash in cache key to ensure data is refetched when any of these change
    const dateRangeKey = `${filters.fromDate || ''}_${filters.toDate || ''}`;
    const incomeKey = totalIncome || 0;
    const dueNormalizedPercentageKey = dueNormalizedPercentage || 0;
    const rolePercentagesHash = getRolePercentagesHash(rolePercentages);
    const employeeKey = `${employeeId}_${dateRangeKey}`;
    const cacheKey = `${employeeId}_${dateRangeKey}_${incomeKey}_${dueNormalizedPercentageKey}_${rolePercentagesHash}`;

    // Check cache - but always recalculate signed portion with current income
    // Skip only if we have cached data for this exact combination (date + income)
    const cachedData = roleDataCache.get(cacheKey);
    if (cachedData) {
      // Still update signed totals from cache (exclude "Handler only" rows)
      const totalSignedFromCache = cachedData.reduce((sum, roleItem) => {
        // Exclude "Handler only" from signed totals
        const isHandlerOnly = roleItem.role === 'Handler';
        return sum + (isHandlerOnly ? 0 : (roleItem.signedTotal || 0));
      }, 0);
      updateEmployeeSignedTotal(employeeId, totalSignedFromCache);

      // Recalculate signed/due normalized and salary budget from cached data
      // We need to recalculate these because totalSignedValue might have changed
      // Use ref to get the latest value
      const totalSignedOverallFromCache = totalSignedValueRef.current || 0;
      const incomeAmountFromCache = totalIncome || 0;
      let normalizationRatioFromCache = 1;
      if (incomeAmountFromCache > 0 && totalSignedOverallFromCache > 0 && incomeAmountFromCache < totalSignedOverallFromCache) {
        normalizationRatioFromCache = incomeAmountFromCache / totalSignedOverallFromCache;
      }

      // Fetch due amount for this employee (if they are a handler)
      const dueAmountFromCache = await fetchDueAmounts(employeeId, employeeName);

      // Signed normalized: only use signed amounts (no due)
      const signedNormalized = totalSignedFromCache * normalizationRatioFromCache;

      // Due normalized: use separate percentage from due_normalized_percentage
      const dueNormalizedPercentageValueFromCache = (dueNormalizedPercentage || 0) / 100; // Convert percentage to decimal
      const dueNormalized = dueAmountFromCache * dueNormalizedPercentageValueFromCache;

      // Calculate signed portion from cached role data
      // We need to recalculate this from the actual leads, but for now use a simplified approach
      // Actually, we should recalculate it properly, so let's continue with the fetch
      // But first update what we can from cache

      // Calculate due portion: Handler gets a percentage of due amounts
      const handlerPercentageFromCache = rolePercentages && rolePercentages.has('HANDLER')
        ? (rolePercentages.get('HANDLER')! / 100)
        : 0;
      const duePortionFromCache = dueAmountFromCache * handlerPercentageFromCache;

      setDepartmentData(prev => {
        const updated = new Map(prev);
        updated.forEach((deptData, deptName) => {
          const updatedEmployees = deptData.employees.map(emp => {
            if (emp.employeeId === employeeId) {
              // Note: We can't accurately calculate contribution from cache because we need
              // the raw totalSignedPortion which is calculated from individual leads.
              // Contribution will be recalculated in the full fetch below.
              // For now, just update the normalized values.
              return {
                ...emp,
                signed: totalSignedFromCache,
                due: dueAmountFromCache,
                signedNormalized: signedNormalized,
                dueNormalized: dueNormalized,
                // Keep existing signedPortion and salaryBudget - they will be updated in full fetch
              };
            }
            return emp;
          });

          // Recalculate department totals
          const deptSigned = updatedEmployees.reduce((sum, emp) => sum + emp.signed, 0);
          const deptDue = updatedEmployees.reduce((sum, emp) => sum + (emp.due || 0), 0);
          const deptSignedNormalized = updatedEmployees.reduce((sum, emp) => sum + (emp.signedNormalized || 0), 0);
          const deptDueNormalized = updatedEmployees.reduce((sum, emp) => sum + (emp.dueNormalized || 0), 0);
          const deptSignedPortion = updatedEmployees.reduce((sum, emp) => sum + emp.signedPortion, 0);
          const deptSalaryBudget = updatedEmployees.reduce((sum, emp) => sum + (emp.salaryBudget || 0), 0);

          updated.set(deptName, {
            ...deptData,
            employees: updatedEmployees,
            totals: {
              ...deptData.totals,
              signed: deptSigned,
              due: deptDue,
              signedNormalized: deptSignedNormalized,
              dueNormalized: deptDueNormalized,
              signedPortion: deptSignedPortion,
              salaryBudget: deptSalaryBudget,
            },
          });
        });
        return updated;
      });

      // Don't return early - we need to recalculate signed portion to ensure it's correct
      // Continue with the fetch to recalculate signed portion
    }

    // Use employee ID only for loading state (not date-specific)
    setLoadingRoleData(prev => {
      const newSet = new Set(prev);
      newSet.add(`${employeeId}`);
      return newSet;
    });

    try {
      // Define roles and their field mappings (fixed roles as requested)
      const roles = [
        { name: 'Closer', legacyField: 'closer_id', newField: 'closer' },
        { name: 'Scheduler', legacyField: 'meeting_scheduler_id', newField: 'scheduler' },
        { name: 'Helper Closer', legacyField: 'meeting_lawyer_id', newField: 'helper' },
        { name: 'Handler', legacyField: 'case_handler_id', newField: 'handler' },
        { name: 'Meeting Manager', legacyField: 'meeting_manager_id', newField: 'meeting_manager_id' },
        { name: 'Helper Handler', legacyField: null, newField: null }, // No direct field exists - will show 0
        { name: 'Expert', legacyField: 'expert_id', newField: 'expert' },
      ];

      const roleDataResults: any[] = [];

      // Step 1: Find signed leads (stage 60) in date range
      // IMPORTANT: Filter by sign date (when stage 60 was set), NOT creation date
      // Use 'date' field from leads_leadstage table (not 'cdate') to match fetchTotalSignedValue logic
      // Use explicit UTC timestamps to include full day: from 00:00:00.000 to 23:59:59.999
      const { startIso, endIso } = computeDateBounds(filters.fromDate, filters.toDate);
      const fromDateTime = startIso;
      const toDateTime = endIso;

      let stageHistoryQuery = supabase
        .from('leads_leadstage')
        .select('id, stage, date, cdate, lead_id, newlead_id')
        .eq('stage', 60); // Only stage 60 (signed agreements)

      // Filter by the date when the lead was signed (stage 60 date), not when it was created
      // Include full day: from 00:00:00.000 to 23:59:59.999 UTC
      if (fromDateTime) {
        stageHistoryQuery = stageHistoryQuery.gte('date', fromDateTime);
      }
      if (toDateTime) {
        stageHistoryQuery = stageHistoryQuery.lte('date', toDateTime);
      }

      const { data: stageHistoryData, error: stageHistoryError } = await stageHistoryQuery;
      if (stageHistoryError) throw stageHistoryError;

      // Separate new and legacy lead IDs
      const newLeadIds = new Set<string>();
      const legacyLeadIds = new Set<number>();

      stageHistoryData?.forEach((entry: any) => {
        if (entry.newlead_id) {
          newLeadIds.add(entry.newlead_id.toString());
        }
        if (entry.lead_id !== null && entry.lead_id !== undefined) {
          legacyLeadIds.add(Number(entry.lead_id));
        }
      });

      if (DEBUG_HELPER_CLOSER && employeeId === DEBUG_EMPLOYEE_ID) {
        console.log('[SalesContribution Step1] newLeadIds.size=', newLeadIds.size, 'legacyLeadIds.size=', legacyLeadIds.size, 'newLeadIds sample=', Array.from(newLeadIds).slice(0, 5));
      }

      // Step 2: Fetch new leads data
      // NOTE: No date filtering here - we already filtered by sign date in step 1
      // We're only fetching leads that have stage 60 entries in the date range
      const newLeadsMap = new Map();
      if (newLeadIds.size > 0) {
        const newLeadIdsArray = Array.from(newLeadIds);
        // Chunked and paged: a bare `.in()` select is capped at 1000 rows, and without an
        // ORDER BY the page that comes back is arbitrary, so leads vanish silently.
        const newLeads = await fetchAllRowsForLeadIds<any>(newLeadIdsArray, (chunk) =>
          supabase
            .from('leads')
            .select(`
              id,
              lead_number,
              name,
              balance,
              balance_currency,
              proposal_total,
              proposal_currency,
              currency_id,
              closer,
              scheduler,
              handler,
              helper,
              meeting_lawyer_id,
              lawyer,
              expert,
              expert_id,
              case_handler_id,
              manager,
              meeting_manager_id,
              subcontractor_fee,
              category_id,
              category,
              accounting_currencies!leads_currency_id_fkey(name, iso_code),
              misc_category!category_id(
                id,
                name,
                parent_id,
                misc_maincategory!parent_id(
                  id,
                  name
                )
              )
            `)
            .in('id', chunk),
        );

        if (newLeads.length > 0) {
          // Use joined data directly (misc_category, misc_maincategory from select) - no preprocess map
          newLeads.forEach((lead: any) => {
            newLeadsMap.set(lead.id, lead);
          });
          if (DEBUG_HELPER_CLOSER && employeeId === DEBUG_EMPLOYEE_ID) {
            const debugLead = newLeads.find((l: any) => (l.lead_number || '').toString().includes('210620'));
            if (debugLead) {
              console.log('[SalesContribution Step2] Lead L210620 found in newLeads:', {
                id: debugLead.id,
                lead_number: debugLead.lead_number,
                helper: debugLead.helper,
                helperType: typeof debugLead.helper,
                meeting_lawyer_id: debugLead.meeting_lawyer_id,
                lawyer: debugLead.lawyer,
                inNewLeadIds: newLeadIds.has(String(debugLead.id)),
              });
            } else {
              console.log('[SalesContribution Step2] Lead L210620 NOT in newLeads fetch. newLeadIds.size=', newLeadIds.size, 'lead_numbers in fetch=', newLeads.map((l: any) => l.lead_number).filter(Boolean).slice(0, 10));
            }
          }
        }
      }

      // Step 3: Fetch legacy leads data - include total_base and subcontractor_fee for proper calculation
      // NOTE: No date filtering here - we already filtered by sign date in step 1
      // We're only fetching leads that have stage 60 entries in the date range
      const legacyLeadsMap = new Map();
      if (legacyLeadIds.size > 0) {
        const legacyLeadIdsArray = Array.from(legacyLeadIds);
        // Chunked and paged: a bare `.in()` select is capped at 1000 rows, and without an
        // ORDER BY the page that comes back is arbitrary, so leads vanish silently.
        const legacyLeads = await fetchAllRowsForLeadIds<any>(legacyLeadIdsArray, (chunk) =>
          supabase
            .from('leads_lead')
            .select(`
              id,
              total,
              total_base,
              currency_id,
              subcontractor_fee,
              meeting_total_currency_id,
              closer_id,
              meeting_scheduler_id,
              meeting_lawyer_id,
              case_handler_id,
              meeting_manager_id,
              expert_id,
              category_id,
              category,
              accounting_currencies!leads_lead_currency_id_fkey(name, iso_code),
              misc_category!category_id(
                id,
                name,
                parent_id,
                misc_maincategory!parent_id(
                  id,
                  name
                )
              )
            `)
            .in('id', chunk),
        );

        if (legacyLeads.length > 0) {
          // Use joined data directly (misc_category, misc_maincategory from select) - no preprocess map
          legacyLeads.forEach((lead: any) => {
            legacyLeadsMap.set(Number(lead.id), lead);
          });
        }
      }

      const signDates = buildSignDateMapsFromStageHistory(stageHistoryData);
      const boiConverter = await createBoiDateRateConverter();
      await enrichLeadsMapsWithSignedNis(newLeadsMap, legacyLeadsMap, signDates, boiConverter);

      // Step 4: Fetch payment plans for due amounts
      const newPaymentsMap = new Map<string, number>();
      if (newLeadIds.size > 0) {
        try {
          const newLeadIdsArray = Array.from(newLeadIds);
          if (newLeadIdsArray.length === 0) {
            // Skip if no new lead IDs - but don't return, just continue
          } else {
            const newPayments = await fetchAllRowsForLeadIds<any>(newLeadIdsArray, (chunk) => {
              let q = scopeDueInvoicedQuery(
                supabase
                  .from('payment_plans')
                  .select(`lead_id, value, value_vat, currency, due_date, ${DUE_INVOICED_EXTRA_COLUMNS}, ${DUE_INVOICED_PAID_COLUMNS}`)
                  .in('lead_id', chunk)
                  .not('due_date', 'is', null)
                  .is('cancel_date', null),
              );
              if (fromDateTime) q = q.gte('due_date', fromDateTime);
              if (toDateTime) q = q.lte('due_date', toDateTime);
              return q;
            });

            const processedPayments = await processNewPaymentsAsync(newPayments, boiConverter, dueInvoicedReadyToPayFilter);
            processedPayments.forEach((amount, leadId) => {
              const current = newPaymentsMap.get(leadId) || 0;
              newPaymentsMap.set(leadId, current + amount);
            });
          }
        } catch (error) {
          console.error('Error in new payment plans fetch:', error);
          // Continue without payment data rather than failing completely
        }
      }

      // Step 5: Fetch legacy payment plans
      const legacyPaymentsMap = new Map<number, number>();
      if (legacyLeadIds.size > 0) {
        try {
          const legacyLeadIdsArray = Array.from(legacyLeadIds);
          if (legacyLeadIdsArray.length > 0) {
            const legacySelect = `lead_id, value, value_base, currency_id, due_date, accounting_currencies!finances_paymentplanrow_currency_id_fkey(name, iso_code), ${DUE_INVOICED_LEGACY_EXTRA_COLUMNS}`;

            const legacyPayments = await fetchAllRowsForLeadIds<any>(legacyLeadIdsArray, (chunk) => {
              let q = scopeDueInvoicedQuery(
                supabase
                  .from('finances_paymentplanrow')
                  .select(legacySelect)
                  .in('lead_id', chunk)
                  .not('due_date', 'is', null),
              );
              if (fromDateTime) q = q.gte('due_date', fromDateTime);
              if (toDateTime) q = q.lte('due_date', toDateTime);
              return q;
            });

            // Plus rows invoiced in the window that never reached finance, so carry no due date.
            const legacyInvoicedNoDueDate = await fetchAllRowsForLeadIds<any>(legacyLeadIdsArray, (chunk) =>
              scopeLegacyInvoicedWithoutDueDate(
                supabase
                  .from('finances_paymentplanrow')
                  .select(legacySelect)
                  .in('lead_id', chunk),
                fromDateTime,
                toDateTime,
              ),
            );

            const processedPayments = await processLegacyPaymentsAsync([...legacyPayments, ...legacyInvoicedNoDueDate], boiConverter, legacyLeadsMap, dueInvoicedReadyToPayFilter);
            processedPayments.forEach((amount, leadId) => {
              const current = legacyPaymentsMap.get(leadId) || 0;
              legacyPaymentsMap.set(leadId, current + amount);
            });
          }
        } catch (error) {
          console.error('Error in legacy payment plans fetch:', error);
          // Continue without payment data rather than failing completely
        }
      }

      // Step 6: For Handler role, also fetch payment plans for ALL handler leads (not just signed ones)
      // This ensures due amounts are calculated from payment plans filtered by due_date, not by signed status
      // Get employee display name for matching
      const { data: employeeDataForPayments } = await supabase
        .from('tenants_employee')
        .select('id, display_name')
        .eq('id', employeeId)
        .single();

      if (employeeDataForPayments) {
        const employeeDisplayNameForPayments = employeeDataForPayments.display_name;

        // For payment plans, use explicit UTC timestamps to include full day: from 00:00:00.000 to 23:59:59.999
        const { startIso: fromDateTimeForPayments, endIso: toDateTimeForPayments } = computeDateBounds(filters.fromDate, filters.toDate);

        // Find ALL new leads where this employee is handler (not just signed ones)
        const allHandlerNewLeads = await fetchAllPagedRows<any>((from, to) =>
          supabase
            .from('leads')
            .select('id, handler, case_handler_id')
            .or(`handler.eq.${employeeDisplayNameForPayments},case_handler_id.eq.${employeeId}`)
            .order('id', { ascending: true })
            .range(from, to),
        );

        if (allHandlerNewLeads.length > 0) {
          const allHandlerNewLeadIds = allHandlerNewLeads.map(l => l.id).filter(Boolean);

          // Fetch payment plans for these leads with due dates in range
          const allHandlerPayments = await fetchAllRowsForLeadIds<any>(allHandlerNewLeadIds, (chunk) => {
            let q = scopeDueInvoicedQuery(
              supabase
                .from('payment_plans')
                .select(`lead_id, value, value_vat, currency, due_date, ${DUE_INVOICED_EXTRA_COLUMNS}, ${DUE_INVOICED_PAID_COLUMNS}`)
                .not('due_date', 'is', null)
                .is('cancel_date', null)
                .in('lead_id', chunk),
            );
            if (fromDateTimeForPayments) q = q.gte('due_date', fromDateTimeForPayments);
            if (toDateTimeForPayments) q = q.lte('due_date', toDateTimeForPayments);
            return q;
          });

          const processedPayments = await processNewPaymentsAsync(allHandlerPayments, boiConverter, dueInvoicedReadyToPayFilter);
          processedPayments.forEach((amount, leadId) => {
            // Add to map (sum if already exists from signed leads)
            const current = newPaymentsMap.get(leadId) || 0;
            newPaymentsMap.set(leadId, current + amount);
          });
        }

        // Find ALL legacy leads where this employee is handler (not just signed ones)
        const allHandlerLegacyLeads = await fetchAllPagedRows<any>((from, to) =>
          supabase
            .from('leads_lead')
            .select('id, case_handler_id')
            .eq('case_handler_id', employeeId)
            .order('id', { ascending: true })
            .range(from, to),
        );

        if (allHandlerLegacyLeads.length > 0) {
          const allHandlerLegacyLeadIds = allHandlerLegacyLeads.map(l => l.id).filter(Boolean).map(id => Number(id));

          // Fetch payment plans for these leads with due dates in range
          const allHandlerLegacySelect = `lead_id, value, value_base, vat_value, currency_id, due_date, accounting_currencies!finances_paymentplanrow_currency_id_fkey(name, iso_code), ${DUE_INVOICED_LEGACY_EXTRA_COLUMNS}`;

          const allHandlerLegacyPayments = await fetchAllRowsForLeadIds<any>(allHandlerLegacyLeadIds, (chunk) => {
            let q = supabase
              .from('finances_paymentplanrow')
              .select(allHandlerLegacySelect)
              .not('due_date', 'is', null)
              .is('cancel_date', null)
              .in('lead_id', chunk);
            if (fromDateTimeForPayments) q = q.gte('due_date', fromDateTimeForPayments);
            if (toDateTimeForPayments) q = q.lte('due_date', toDateTimeForPayments);
            return q;
          });

          // Plus rows invoiced in the window that never reached finance, so carry no due date.
          const allHandlerLegacyInvoicedNoDueDate = await fetchAllRowsForLeadIds<any>(allHandlerLegacyLeadIds, (chunk) =>
            scopeLegacyInvoicedWithoutDueDate(
              supabase
                .from('finances_paymentplanrow')
                .select(allHandlerLegacySelect)
                .is('cancel_date', null)
                .in('lead_id', chunk),
              fromDateTimeForPayments,
              toDateTimeForPayments,
            ),
          );

          const processedPayments = await processLegacyPaymentsAsync([...allHandlerLegacyPayments, ...allHandlerLegacyInvoicedNoDueDate], boiConverter, legacyLeadsMap, dueInvoicedAllRowsFilter);
          processedPayments.forEach((amount, leadId) => {
            // Add to map (sum if already exists from signed leads)
            const current = legacyPaymentsMap.get(leadId) || 0;
            legacyPaymentsMap.set(leadId, current + amount);
          });
        }
      }

      // Note: Field view data processing is now done in handleSearch batch calculation
      // to avoid multiple calls and ensure due amounts are calculated correctly

      // Step 6: Group leads by role combinations
      // Map to store role combinations and their totals
      const roleCombinationMap = new Map<string, { roles: string[], signedTotal: number, dueTotal: number }>();

      // Helper function to check if employee is in a role for a new lead
      const checkEmployeeInRole = (lead: any, roleField: string, roleName: string): boolean => {
        if (roleName === 'Helper Handler') {
          return false; // No direct field exists
        }

        if (roleField === 'closer' && lead.closer) {
          return newLeadFieldMatchesEmployee(lead.closer, employeeId, employeeName);
        } else if (roleField === 'scheduler' && lead.scheduler) {
          return newLeadFieldMatchesEmployee(lead.scheduler, employeeId, employeeName);
        } else if (roleField === 'handler') {
          // Check both handler (text) and case_handler_id (numeric) for new leads
          if (lead.handler) {
            const handlerValue = lead.handler;
            if (typeof handlerValue === 'string' && handlerValue.toLowerCase() === employeeName.toLowerCase()) {
              return true;
            }
            if (Number(handlerValue) === employeeId) {
              return true;
            }
          }
          // Also check case_handler_id for new leads
          if (lead.case_handler_id && Number(lead.case_handler_id) === employeeId) {
            return true;
          }
          return false;
        } else if (roleField === 'helper') {
          // Helper Closer: check helper, meeting_lawyer_id (new leads), and lawyer (display name)
          const isDebugHelper = DEBUG_HELPER_CLOSER && employeeId === DEBUG_EMPLOYEE_ID && (lead.lead_number || '').toString().includes('210620');
          if (lead.helper != null && lead.helper !== '') {
            const helperValue = lead.helper;
            const matchName = typeof helperValue === 'string' && helperValue.toLowerCase() === employeeName.toLowerCase();
            const matchId = Number(helperValue) === employeeId;
            if (isDebugHelper) {
              console.log('[SalesContribution checkEmployeeInRole helper]', {
                lead_number: lead.lead_number,
                helperValue,
                helperType: typeof helperValue,
                employeeId,
                employeeName,
                matchName,
                matchId,
                result: matchName || matchId,
              });
            }
            if (matchName || matchId) return true;
          }
          if (lead.meeting_lawyer_id != null && Number(lead.meeting_lawyer_id) === employeeId) {
            if (isDebugHelper) console.log('[SalesContribution checkEmployeeInRole helper] match via meeting_lawyer_id');
            return true;
          }
          if (lead.lawyer != null && lead.lawyer !== '') {
            const lawyerValue = lead.lawyer;
            const matchName = typeof lawyerValue === 'string' && lawyerValue.toLowerCase() === employeeName.toLowerCase();
            const matchId = Number(lawyerValue) === employeeId;
            if (matchName || matchId) return true;
          }
          if (isDebugHelper) {
            console.log('[SalesContribution checkEmployeeInRole helper] L210620 no match. helper=', lead.helper, 'meeting_lawyer_id=', lead.meeting_lawyer_id, 'lawyer=', lead.lawyer);
          }
          return false;
        } else if (roleField === 'expert') {
          return newLeadMatchesExpert(lead, employeeId, employeeName);
        } else if (roleField === 'manager' || roleField === 'meeting_manager_id') {
          // newField may be 'manager' (labels) or 'meeting_manager_id' (id column); check both + fallback id
          if (lead.manager) {
            const managerValue = lead.manager;
            // Check if it's a numeric string (ID) or a number
            if (typeof managerValue === 'string') {
              const numericValue = Number(managerValue);
              // If it's a valid number, treat it as an ID
              if (!isNaN(numericValue) && numericValue.toString() === managerValue.trim()) {
                return numericValue === employeeId;
              }
              // Otherwise, treat it as a name
              return managerValue.toLowerCase() === employeeName.toLowerCase();
            }
            // If it's already a number, compare directly
            return Number(managerValue) === employeeId;
          }
          // Fallback to meeting_manager_id if manager is not set
          if (lead.meeting_manager_id) {
            return Number(lead.meeting_manager_id) === employeeId;
          }
          return false;
        }
        return false;
      };

      // Helper function to check if employee is in a role for a legacy lead
      const checkEmployeeInRoleLegacy = (lead: any, roleField: string): boolean => {
        if (roleField === 'closer_id' && lead.closer_id) {
          return Number(lead.closer_id) === employeeId;
        } else if (roleField === 'meeting_scheduler_id' && lead.meeting_scheduler_id) {
          return Number(lead.meeting_scheduler_id) === employeeId;
        } else if (roleField === 'meeting_lawyer_id' && lead.meeting_lawyer_id) {
          return Number(lead.meeting_lawyer_id) === employeeId;
        } else if (roleField === 'case_handler_id' && lead.case_handler_id) {
          return Number(lead.case_handler_id) === employeeId;
        } else if (roleField === 'expert_id') {
          return legacyLeadMatchesExpert(lead, employeeId, employeeName);
        } else if (roleField === 'meeting_manager_id' && lead.meeting_manager_id) {
          return Number(lead.meeting_manager_id) === employeeId;
        }
        return false;
      };

      // Helper functions are now imported from salesContributionCalculator

      // Process new leads - determine role combinations
      newLeadsMap.forEach((lead: any, leadId: string) => {
        const employeeRoles: string[] = [];

        roles.forEach(role => {
          if (role.newField && checkEmployeeInRole(lead, role.newField, role.name)) {
            employeeRoles.push(role.name);
          }
        });

        if (DEBUG_HELPER_CLOSER && employeeId === DEBUG_EMPLOYEE_ID && (lead.lead_number || '').toString().includes('210620')) {
          console.log('[SalesContribution newLeads process] L210620 employeeRoles=', employeeRoles, 'leadId=', leadId, 'helper=', lead.helper);
        }

        // Check if employee is handler for this lead (needed for due amounts)
        const isHandler = checkEmployeeInRole(lead, 'handler', 'Handler');

        // If employee has no roles but is a handler, add Handler role for due amount tracking
        if (employeeRoles.length === 0 && isHandler) {
          employeeRoles.push('Handler');
        }

        // Only process if employee has at least one role in this lead
        if (employeeRoles.length > 0) {
          // Sort roles to create consistent combination key
          const sortedRoles = [...employeeRoles].sort();
          const combinationKey = sortedRoles.join(', ');

          // Check if this is "Handler only" - exclude from signed totals but still show if has due amounts
          const isHandlerOnly = employeeRoles.length === 1 && employeeRoles[0] === 'Handler';

          // Same full-amount basis as batch calculator (salesContributionCalculator) for signed totals
          const amountNIS = calculateNewLeadFullAmount(lead);

          // Due amount: only count if employee is handler for this lead
          const dueAmount = isHandler ? (newPaymentsMap.get(leadId) || 0) : 0;

          const existing = roleCombinationMap.get(combinationKey);
          if (existing) {
            // Only add to signedTotal if NOT handler only
            if (!isHandlerOnly) {
              existing.signedTotal += amountNIS;
            }
            existing.dueTotal += dueAmount;
          } else {
            roleCombinationMap.set(combinationKey, {
              roles: sortedRoles,
              // Only set signedTotal if NOT handler only
              signedTotal: isHandlerOnly ? 0 : amountNIS,
              dueTotal: dueAmount,
            });
          }
        }
      });

      // Process legacy leads - determine role combinations
      legacyLeadsMap.forEach((lead: any, leadId: number) => {
        const employeeRoles: string[] = [];

        roles.forEach(role => {
          if (role.legacyField && checkEmployeeInRoleLegacy(lead, role.legacyField)) {
            employeeRoles.push(role.name);
          }
        });

        // Check if employee is handler for this lead (needed for due amounts)
        const isHandler = checkEmployeeInRoleLegacy(lead, 'case_handler_id');

        // If employee has no roles but is a handler, add Handler role for due amount tracking
        if (employeeRoles.length === 0 && isHandler) {
          employeeRoles.push('Handler');
        }

        // Only process if employee has at least one role in this lead
        if (employeeRoles.length > 0) {
          // Sort roles to create consistent combination key
          const sortedRoles = [...employeeRoles].sort();
          const combinationKey = sortedRoles.join(', ');

          // Check if this is "Handler only" - exclude from signed totals but still show if has due amounts
          const isHandlerOnly = employeeRoles.length === 1 && employeeRoles[0] === 'Handler';

          const amountNIS = calculateLegacyLeadFullAmount(lead);

          // Due amount: only count if employee is handler for this lead (isHandler already checked above)
          const dueAmount = isHandler ? (legacyPaymentsMap.get(leadId) || 0) : 0;

          const existing = roleCombinationMap.get(combinationKey);
          if (existing) {
            // Only add to signedTotal if NOT handler only
            if (!isHandlerOnly) {
              existing.signedTotal += amountNIS;
            }
            existing.dueTotal += dueAmount;
          } else {
            roleCombinationMap.set(combinationKey, {
              roles: sortedRoles,
              // Only set signedTotal if NOT handler only
              signedTotal: isHandlerOnly ? 0 : amountNIS,
              dueTotal: dueAmount,
            });
          }
        }
      });

      // Calculate signed/due normalized and signed portion
      // Get total signed value (already calculated by fetchTotalSignedValue)
      const totalSignedOverall = totalSignedValueRef.current || 0;
      const incomeAmount = totalIncome || 0;

      // Calculate normalization ratio: if income < total signed, apply percentage reduction
      let normalizationRatio = 1; // Default: no normalization
      if (incomeAmount > 0 && totalSignedOverall > 0 && incomeAmount < totalSignedOverall) {
        // If income is less than total signed, we need to reduce proportionally
        normalizationRatio = incomeAmount / totalSignedOverall;
      }

      // Fetch due amount for this employee (if they are a handler)
      const dueAmount = await fetchDueAmounts(employeeId, employeeName);

      console.log(`📊 Signed/Due Normalized Calculation for employee ${employeeId}:`, {
        totalIncome: incomeAmount,
        totalSigned: totalSignedOverall,
        dueAmount: dueAmount,
        normalizationRatio: normalizationRatio,
        willNormalize: incomeAmount < totalSignedOverall
      });

      // Role percentages on the same full-amount basis as batch calculator (matches norm signed / totalSigned)
      let totalSignedPortion = 0;

      // Process new leads to calculate signed portion
      newLeadsMap.forEach((lead: any, leadId: string) => {
        // Check if this employee has any role in this lead
        const employeeRoles: string[] = [];
        roles.forEach(role => {
          if (role.newField && checkEmployeeInRole(lead, role.newField, role.name)) {
            employeeRoles.push(role.name);
          }
        });

        // Exclude "Handler only" from signed portion calculation
        const isHandlerOnly = employeeRoles.length === 1 && employeeRoles[0] === 'Handler';

        if (employeeRoles.length > 0 && !isHandlerOnly) {
          const amountForSignedPortion = calculateNewLeadFullAmount(lead);
          const leadRoles = {
            closer: lead.closer,
            scheduler: lead.scheduler,
            manager: lead.manager || lead.meeting_manager_id,
            meeting_manager_id: lead.meeting_manager_id,
            expert: lead.expert,
            expert_id: lead.expert_id,
            handler: lead.handler, // Handler role
            helperCloser: resolveHelperCloserValue(lead),
          };

          const signedPortion = calculateSignedPortionAmount(
            amountForSignedPortion,
            leadRoles,
            employeeId,
            false, // isLegacy = false for new leads
            rolePercentages,
            employeeName
          );

          totalSignedPortion += signedPortion;
        }
      });

      // Process legacy leads to calculate signed portion
      legacyLeadsMap.forEach((lead: any, leadId: number) => {
        // Check if this employee has any role in this lead
        const employeeRoles: string[] = [];
        roles.forEach(role => {
          if (role.legacyField && checkEmployeeInRoleLegacy(lead, role.legacyField)) {
            employeeRoles.push(role.name);
          }
        });

        // Exclude "Handler only" from signed portion calculation
        const isHandlerOnly = employeeRoles.length === 1 && employeeRoles[0] === 'Handler';

        if (employeeRoles.length > 0 && !isHandlerOnly) {
          const amountForSignedPortion = calculateLegacyLeadFullAmount(lead);
          const leadRoles = {
            closer_id: lead.closer_id,
            meeting_scheduler_id: lead.meeting_scheduler_id,
            meeting_manager_id: lead.meeting_manager_id,
            expert_id: lead.expert_id,
            expert: (lead as any).expert,
            case_handler_id: lead.case_handler_id, // Handler role
            meeting_lawyer_id: lead.meeting_lawyer_id, // Helper Closer
          };

          const signedPortion = calculateSignedPortionAmount(
            amountForSignedPortion,
            leadRoles,
            employeeId,
            true, // isLegacy = true for legacy leads
            rolePercentages,
            employeeName
          );

          totalSignedPortion += signedPortion;
        }
      });

      // Use fetchDueAmounts to get the total due amount for this employee
      // This ensures we capture ALL due amounts, even from leads not in the signed leads list
      // fetchDueAmounts queries ALL leads where employee is handler, not just signed ones
      const totalDueFromFetchDueAmounts = await fetchDueAmounts(employeeId, employeeName);

      // Check if Handler is already in any role combination
      let handlerFoundInCombinations = false;
      let handlerCombinationKey: string | null = null;
      roleCombinationMap.forEach((data, key) => {
        if (data.roles.includes('Handler')) {
          handlerFoundInCombinations = true;
          // If it's Handler only (not combined with other roles), track it
          if (data.roles.length === 1 && data.roles[0] === 'Handler') {
            handlerCombinationKey = key;
          }
        }
      });

      // If Handler role combination doesn't exist but there are due amounts, create it
      if (!handlerFoundInCombinations && totalDueFromFetchDueAmounts > 0) {
        roleCombinationMap.set('Handler', {
          roles: ['Handler'],
          signedTotal: 0, // Handler only doesn't count toward signed
          dueTotal: totalDueFromFetchDueAmounts,
        });
      } else if (handlerCombinationKey && totalDueFromFetchDueAmounts > 0) {
        // If Handler-only combination exists, update its due total to match fetchDueAmounts
        // This ensures the Handler role shows the correct total (all handler leads, not just signed ones)
        const handlerData = roleCombinationMap.get(handlerCombinationKey);
        if (handlerData) {
          // Replace the dueTotal with the authoritative total from fetchDueAmounts
          // This ensures consistency with the main table's Due column
          handlerData.dueTotal = totalDueFromFetchDueAmounts;
          roleCombinationMap.set(handlerCombinationKey, handlerData);
        }
      } else {
        // If Handler appears in combinations with other roles, we need to ensure the total is correct
        // Sum all dueTotal values that include Handler role
        let totalDueFromHandlerCombinations = 0;
        roleCombinationMap.forEach((data, key) => {
          if (data.roles.includes('Handler')) {
            totalDueFromHandlerCombinations += data.dueTotal || 0;
          }
        });

        // If the sum from role combinations doesn't match fetchDueAmounts, 
        // it means there are handler leads with due amounts that aren't in signed leads
        // In this case, we should still show the correct total in the main table
        // The role breakdown will show individual combinations, but the main table uses fetchDueAmounts
      }

      // Convert map to array for display
      roleCombinationMap.forEach((data, combinationKey) => {
        roleDataResults.push({
          role: combinationKey, // Display all roles combined
          signedTotal: data.signedTotal,
          dueTotal: data.dueTotal,
          roles: data.roles, // Store individual roles for modal filtering
          action: '',
        });
      });

      // Update employee signed total from role data (exclude Handler only)
      const totalSigned = roleDataResults.reduce((sum, roleItem) => {
        const isHandlerOnly = roleItem.role === 'Handler';
        return sum + (isHandlerOnly ? 0 : (roleItem.signedTotal || 0));
      }, 0);

      // Calculate total due from all role combinations
      // Sum all dueTotal values from role combinations
      const totalDueFromRoleCombinations = roleDataResults.reduce((sum, roleItem) => {
        return sum + (roleItem.dueTotal || 0);
      }, 0);

      // Fetch due amount for this employee (if they are a handler)
      // Use fetchDueAmounts to get the authoritative total (includes all handler leads, not just signed ones)
      // This ensures consistency with the modal which also uses fetchDueAmounts logic
      // fetchDueAmounts queries ALL leads where employee is handler and filters payment plans by due_date
      const dueAmountForEmployee = await fetchDueAmounts(employeeId, employeeName);

      // Calculate signed normalized: only use signed amounts, apply normalization ratio based on income
      // IMPORTANT: Use ref to get the latest totalSignedValue to avoid stale closure issues
      const totalSignedOverallForEmployee = totalSignedValueRef.current || 0;
      const incomeAmountForEmployee = totalIncome || 0;
      let normalizationRatioForEmployee = 1;
      if (incomeAmountForEmployee > 0 && totalSignedOverallForEmployee > 0 && incomeAmountForEmployee < totalSignedOverallForEmployee) {
        normalizationRatioForEmployee = incomeAmountForEmployee / totalSignedOverallForEmployee;
      }

      // Signed normalized: only use signed amounts (no due)
      const signedNormalized = totalSigned * normalizationRatioForEmployee;

      // Due normalized: use separate percentage from due_normalized_percentage
      const dueNormalizedPercentageValue = (dueNormalizedPercentage || 0) / 100; // Convert percentage to decimal
      const dueNormalized = dueAmountForEmployee * dueNormalizedPercentageValue;

      // Calculate due portion: Handler gets a percentage of due amounts
      // Get handler percentage from rolePercentages (0-100, convert to 0-1)
      const handlerPercentage = rolePercentages && rolePercentages.has('HANDLER')
        ? (rolePercentages.get('HANDLER')! / 100)
        : 0; // Default to 0 if not found

      const duePortion = dueAmountForEmployee * handlerPercentage;

      // Normalize signed portion: apply normalization ratio to signedPortion
      const signedPortionNormalized = totalSignedPortion * normalizationRatioForEmployee;

      // Normalize due portion: apply due normalized percentage to duePortion
      const duePortionNormalized = duePortion * dueNormalizedPercentageValue;

      // Calculate base contribution: combine normalized signed portion + normalized due portion
      const baseContribution = signedPortionNormalized + duePortionNormalized;

      // Apply department % from sales_contribution_settings: use Sales % for Partners, Marketing, Finance; own % for Sales and Handlers
      const deptNameForEmployee = Array.from(departmentData.entries()).find(([, d]) => d.employees.some((e: { employeeId: number }) => e.employeeId === employeeId))?.[0] ?? 'Sales';
      const pctDept = ['Partners', 'Marketing', 'Finance'].includes(deptNameForEmployee) ? 'Sales' : deptNameForEmployee;
      const deptPctForRoleCache = (departmentPercentages.get(pctDept) ?? 35) / 100;
      const contribution = baseContribution * deptPctForRoleCache;

      // Calculate Salary Budget from Contribution
      const salaryBudget = contribution * 0.4;

      setRoleDataCache(prev => {
        const newCache = new Map(prev);
        // Include date range, income, due normalized percentage, and role percentages hash in cache key
        const dateRangeKey = `${filters.fromDate || ''}_${filters.toDate || ''}`;
        const incomeKey = totalIncome || 0;
        const dueNormalizedPercentageKey = dueNormalizedPercentage || 0;
        const rolePercentagesHash = getRolePercentagesHash(rolePercentages);
        const cacheKey = `${employeeId}_${dateRangeKey}_${incomeKey}_${dueNormalizedPercentageKey}_${rolePercentagesHash}`;
        newCache.set(cacheKey, roleDataResults);
        return newCache;
      });

      // Update ALL employee data in a single state update to avoid race conditions
      setDepartmentData(prev => {
        const updated = new Map(prev);
        updated.forEach((deptData, deptName) => {
          const updatedEmployees = deptData.employees.map(emp => {
            if (emp.employeeId === employeeId) {
              return {
                ...emp,
                signed: totalSigned, // Update signed here too to ensure consistency
                due: dueAmountForEmployee, // Update due amount
                signedNormalized: signedNormalized,
                dueNormalized: dueNormalized,
                signedPortion: contribution, // Use normalized contribution
                salaryBudget: salaryBudget
              };
            }
            return emp;
          });

          // Recalculate department totals from all employees
          const deptSigned = updatedEmployees.reduce((sum, emp) => sum + (emp.signed || 0), 0);
          const deptSignedNormalized = updatedEmployees.reduce((sum, emp) => sum + (emp.signedNormalized || 0), 0);
          const deptDueNormalized = updatedEmployees.reduce((sum, emp) => sum + (emp.dueNormalized || 0), 0);
          const deptSignedPortion = updatedEmployees.reduce((sum, emp) => sum + (emp.signedPortion || 0), 0);
          const deptSalaryBudget = updatedEmployees.reduce((sum, emp) => sum + (emp.salaryBudget || 0), 0);

          updated.set(deptName, {
            ...deptData,
            employees: updatedEmployees,
            totals: {
              ...deptData.totals,
              signed: deptSigned,
              signedNormalized: deptSignedNormalized,
              dueNormalized: deptDueNormalized,
              signedPortion: deptSignedPortion,
              salaryBudget: deptSalaryBudget,
            },
          });
        });
        return updated;
      });

      // Also update via updateEmployeeSignedTotal for consistency (but the above update is primary)
      updateEmployeeSignedTotal(employeeId, totalSigned);
    } catch (error) {
      console.error('Error fetching role data:', error);
      toast.error('Failed to load role data');
    } finally {
      // Use employee ID only for loading state (not date-specific)
      setLoadingRoleData(prev => {
        const newSet = new Set(prev);
        newSet.delete(`${employeeId}`);
        return newSet;
      });
    }
  }, [filters.fromDate, filters.toDate, totalSignedValue, totalIncome, dueNormalizedPercentage, rolePercentages, getRolePercentagesHash, categoriesLoaded, categoryNameToDataMap, allCategories]);

  // Report refresh: user clicks Search only (no auto-run on income / due-% / entry).

  // Update employee signed total in department data
  const updateEmployeeSignedTotal = useCallback((employeeId: number, signedTotal: number) => {
    setDepartmentData(prev => {
      const updated = new Map(prev);

      updated.forEach((deptData, deptName) => {
        const updatedEmployees = deptData.employees.map(emp => {
          if (emp.employeeId === employeeId) {
            return { ...emp, signed: signedTotal };
          }
          return emp;
        });

        // Recalculate department totals
        const deptSigned = updatedEmployees.reduce((sum, emp) => sum + emp.signed, 0);

        updated.set(deptName, {
          ...deptData,
          employees: updatedEmployees,
          totals: {
            ...deptData.totals,
            signed: deptSigned,
          },
        });
      });

      return updated;
    });
  }, []);

  // Update employee signed portion in department data
  // Fetch due amounts for employees who are handlers
  const fetchDueAmounts = useCallback(async (employeeId: number, employeeName: string) => {
    try {
      // Use explicit UTC timestamps to include full day: from 00:00:00.000 to 23:59:59.999
      const { startIso: fromDateTime, endIso: toDateTime } = computeDateBounds(filters.fromDate, filters.toDate);

      let totalDue = 0;
      const boiConverter = await createBoiDateRateConverter();

      // Fetch new payment plans where employee is handler
      // For new leads, handler is stored in 'handler' field (text) or 'case_handler_id' (numeric)
      // First, get employee's display_name to match against handler field
      const { data: employeeData } = await supabase
        .from('tenants_employee')
        .select('id, display_name')
        .eq('id', employeeId)
        .single();

      if (!employeeData) {
        return 0;
      }

      const employeeDisplayName = employeeData.display_name;

      // Same new-lead handler discovery as EmployeeRoleLeadsModal (incl. handler = id string, not only display name)
      const newLeadIds = await resolveNewLeadIdsForHandler(employeeId, employeeDisplayName);
      if (newLeadIds.length > 0) {
        // Fetch payment plans for these leads
        const newPayments = await fetchAllRowsForLeadIds<any>(newLeadIds, (chunk) => {
            let q = scopeDueInvoicedQuery(
              supabase
                .from('payment_plans')
                .select(`id, lead_id, value, value_vat, currency, due_date, cancel_date, ${DUE_INVOICED_EXTRA_COLUMNS}, ${DUE_INVOICED_PAID_COLUMNS}`)
                .not('due_date', 'is', null)
                .is('cancel_date', null)
                .in('lead_id', chunk),
            );
            if (fromDateTime) q = q.gte('due_date', fromDateTime);
            if (toDateTime) q = q.lte('due_date', toDateTime);
            return q;
          });

          const processedPayments = await processNewPaymentsAsync(newPayments, boiConverter, dueInvoicedReadyToPayFilter);
          processedPayments.forEach((amount) => {
            totalDue += amount;
          });
      }

      // Fetch legacy leads where this employee is handler (case_handler_id)
      const legacyLeadsWithHandler = await fetchAllPagedRows<any>((from, to) =>
        supabase
          .from('leads_lead')
          .select('id, case_handler_id')
          .eq('case_handler_id', employeeId)
          .order('id', { ascending: true })
          .range(from, to),
      );

      if (legacyLeadsWithHandler.length > 0) {
        const legacyLeadIds = legacyLeadsWithHandler.map(l => l.id).filter(Boolean).map(id => Number(id));

        if (legacyLeadIds.length > 0) {
          // Fetch payment plans for these leads
          const legacySelect = `
                id,
                lead_id,
                value,
                value_base,
                vat_value,
                currency_id,
                due_date,
                cancel_date,
                accounting_currencies!finances_paymentplanrow_currency_id_fkey(name, iso_code),
                ${DUE_INVOICED_LEGACY_EXTRA_COLUMNS}
              `;

          const legacyPayments = await fetchAllRowsForLeadIds<any>(legacyLeadIds, (chunk) => {
            let q = supabase
              .from('finances_paymentplanrow')
              .select(legacySelect)
              .not('due_date', 'is', null)
              .is('cancel_date', null)
              .in('lead_id', chunk);
            if (fromDateTime) q = q.gte('due_date', fromDateTime);
            if (toDateTime) q = q.lte('due_date', toDateTime);
            return q;
          });

          // Plus rows invoiced in the window that never reached finance, so carry no due date.
          const legacyInvoicedNoDueDate = await fetchAllRowsForLeadIds<any>(legacyLeadIds, (chunk) =>
            scopeLegacyInvoicedWithoutDueDate(
              supabase
                .from('finances_paymentplanrow')
                .select(legacySelect)
                .is('cancel_date', null)
                .in('lead_id', chunk),
              fromDateTime,
              toDateTime,
            ),
          );

          const emptyLegacyLeadsMap = new Map<number, any>();
          const processedPayments = await processLegacyPaymentsAsync([...legacyPayments, ...legacyInvoicedNoDueDate], boiConverter, emptyLegacyLeadsMap, dueInvoicedAllRowsFilter);
          processedPayments.forEach((amount) => {
            totalDue += amount;
          });
        }
      }

      return totalDue;
    } catch (error) {
      console.error('Error fetching due amounts:', error);
      return 0;
    }
  }, [filters.fromDate, filters.toDate]);

  const updateEmployeeSignedPortion = useCallback((employeeId: number, signedPortion: number) => {
    setDepartmentData(prev => {
      const updated = new Map(prev);

      updated.forEach((deptData, deptName) => {
        const updatedEmployees = deptData.employees.map(emp => {
          if (emp.employeeId === employeeId) {
            return { ...emp, signedPortion: signedPortion };
          }
          return emp;
        });

        // Recalculate department totals
        const deptSignedPortion = updatedEmployees.reduce((sum, emp) => sum + emp.signedPortion, 0);

        updated.set(deptName, {
          ...deptData,
          employees: updatedEmployees,
          totals: {
            ...deptData.totals,
            signedPortion: deptSignedPortion,
          },
        });
      });

      return updated;
    });
  }, []);


  const handleSearch = async () => {
    scrollToEmployeeResultAfterSearchRef.current = Boolean(employeeSearchTerm.trim());
    // Wait for categories to be loaded before processing
    if (!categoriesLoaded) {
      console.warn('⚠️ handleSearch - Waiting for categories to load...');
      // Wait up to 5 seconds for categories to load
      let waitCount = 0;
      while (!categoriesLoaded && waitCount < 50) {
        await new Promise(resolve => setTimeout(resolve, 100));
        waitCount++;
      }
      if (!categoriesLoaded) {
        console.error('❌ handleSearch - Categories not loaded after waiting, proceeding anyway');
      }
    }

    const searchSeq = ++salesContributionSearchSeqRef.current;
    setLoading(true);
    setSearchPerformed(true);
    setRoleDataCache(new Map());
    const incomeForRun = await refreshIncomeFromInvoicedForFilter();
    totalIncomeRef.current = incomeForRun;
    // Fetch total signed value when search is triggered - MUST complete before calculating portions
    await fetchTotalSignedValue();
    if (salesContributionSearchSeqRef.current !== searchSeq) {
      return;
    }
    const totalSignedForRun = totalSignedValueRef.current || 0;
    try {
      const totalIncome = incomeForRun;
      console.log('🔍 Sales Contribution Report - Starting search with filters:', filters);
      console.log('🔍 Categories loaded:', {
        categoriesLoaded,
        mapSize: categoryNameToDataMap.size,
        allCategoriesCount: allCategories.length
      });

      // Step 1: Fetch ALL employees (similar to EmployeePerformancePage)
      // Fetch employees from users table with tenants_employee join (only active staff users)
      const { data: allEmployeesData, error: allEmployeesDataError } = await supabase
        .from('users')
        .select(`
          id,
          full_name,
          email,
          employee_id,
          is_active,
          is_staff,
          tenants_employee!employee_id(
            id,
            display_name,
            bonuses_role,
            department_id,
            user_id,
            photo_url,
            photo,
            tenant_departement!department_id(
              id,
              name
            )
          )
        `)
        .not('employee_id', 'is', null)
        .eq('is_active', true)
        .eq('is_staff', true);

      if (allEmployeesDataError) {
        console.error('❌ Sales Contribution Report - Error fetching employees:', allEmployeesDataError);
        throw allEmployeesDataError;
      }

      // Process employees data
      const processedEmployees = (allEmployeesData || [])
        .filter(user => user.tenants_employee && user.email)
        .map(user => {
          const employee = user.tenants_employee as any;
          const dept = Array.isArray(employee.tenant_departement) ? employee.tenant_departement[0] : employee.tenant_departement;
          return {
            id: Number(employee.id),
            display_name: employee.display_name,
            bonuses_role: employee.bonuses_role || null,
            department: dept?.name || 'Unknown',
            department_id: employee.department_id || dept?.id || null,
            photo_url: employee.photo_url || employee.photo || null,
            email: user.email,
          };
        });

      // Deduplicate by employee ID
      const uniqueEmployeesMap = new Map();
      processedEmployees.forEach(emp => {
        if (!uniqueEmployeesMap.has(emp.id)) {
          uniqueEmployeesMap.set(emp.id, emp);
        }
      });
      const allEmployees = Array.from(uniqueEmployeesMap.values());

      // Store employee data in employeeMap for avatar access
      const newEmployeeMap = new Map<number, { display_name: string; department: string; photo_url?: string | null }>();
      allEmployees.forEach(emp => {
        newEmployeeMap.set(emp.id, {
          display_name: emp.display_name,
          department: emp.department,
          photo_url: emp.photo_url,
        });
      });
      setEmployeeMap(newEmployeeMap);

      // Filter out excluded employees (same as EmployeePerformancePage)
      const excludedEmployees = ['FINANCE', 'INTERNS', 'NO SCHEDULER', 'Mango Test', 'pink', 'Interns'];
      const filteredEmployees = allEmployees.filter(emp =>
        !excludedEmployees.includes(emp.display_name)
      );

      console.log('✅ Sales Contribution Report - Fetched', filteredEmployees.length, 'employees');

      // Step 2: Group employees by department role from employee_field_assignments (aligned with Department Roles modal)
      const { data: roleAssignments, error: roleAssignmentsError } = await supabase
        .from('employee_field_assignments')
        .select('employee_id, department_role')
        .in('department_role', departmentNames)
        .eq('is_active', true);

      if (roleAssignmentsError) {
        console.error('❌ Sales Contribution Report - Error fetching department role assignments:', roleAssignmentsError);
        throw roleAssignmentsError;
      }

      const employeeIdsByRole = new Map<string, Set<number>>();
      departmentNames.forEach(name => employeeIdsByRole.set(name, new Set()));
      (roleAssignments || []).forEach((row: any) => {
        const role = row.department_role;
        const empId = Number(row.employee_id);
        if (role && !isNaN(empId) && employeeIdsByRole.has(role)) {
          employeeIdsByRole.get(role)!.add(empId);
        }
      });

      const salesEmployees = filteredEmployees.filter(emp => employeeIdsByRole.get('Sales')?.has(emp.id));
      const handlersEmployees = filteredEmployees.filter(emp => employeeIdsByRole.get('Handlers')?.has(emp.id));
      const marketingEmployees = filteredEmployees.filter(emp => employeeIdsByRole.get('Marketing')?.has(emp.id));
      const financeEmployees = filteredEmployees.filter(emp => employeeIdsByRole.get('Finance')?.has(emp.id));
      const partnersEmployees = filteredEmployees.filter(emp => employeeIdsByRole.get('Partners')?.has(emp.id));

      console.log('✅ Sales Contribution Report - Grouped employees (from employee_field_assignments):', {
        Sales: salesEmployees.length,
        Handlers: handlersEmployees.length,
        Marketing: marketingEmployees.length,
        Finance: financeEmployees.length,
        Partners: partnersEmployees.length,
      });

      // Step 3: Create EmployeeData entries for all employees (with 0 data for now)
      const departmentEmployeeData = new Map<string, Map<number, EmployeeData>>();

      // Initialize department maps
      departmentNames.forEach(deptName => {
        departmentEmployeeData.set(deptName, new Map());
      });

      // Helper to create employee data with zeros
      const createEmployeeData = (emp: any): EmployeeData => {
        return {
          employeeId: emp.id,
          employeeName: emp.display_name,
          department: emp.department || 'Unknown',
          photoUrl: emp.photo_url || null,
          signed: 0,
          signedNormalized: 0,
          dueNormalized: 0,
          signedPortion: 0,
          contributionFixed: 0,
          salaryBudget: 0,
          salaryBrutto: 0,
          totalSalaryCost: 0,
          maxIncentives: 0,
          due: 0,
          duePortion: 0,
          total: 0,
          totalPortionDue: 0,
          percentOfIncome: 0,
          normalized: 0,
        };
      };

      // Add employees to their respective departments
      salesEmployees.forEach(emp => {
        const deptMap = departmentEmployeeData.get('Sales')!;
        deptMap.set(emp.id, createEmployeeData(emp));
      });

      handlersEmployees.forEach(emp => {
        const deptMap = departmentEmployeeData.get('Handlers')!;
        deptMap.set(emp.id, createEmployeeData(emp));
      });

      marketingEmployees.forEach(emp => {
        const deptMap = departmentEmployeeData.get('Marketing')!;
        deptMap.set(emp.id, createEmployeeData(emp));
      });

      financeEmployees.forEach(emp => {
        const deptMap = departmentEmployeeData.get('Finance')!;
        deptMap.set(emp.id, createEmployeeData(emp));
      });

      partnersEmployees.forEach(emp => {
        const deptMap = departmentEmployeeData.get('Partners')!;
        deptMap.set(emp.id, createEmployeeData(emp));
      });

      // Step 4: Calculate totals and percentages (all zeros for now)
      let globalTotal = 0;
      // Note: Don't reset totalIncome here - it should persist across searches

      // Calculate portions and percentages
      const finalDepartmentData = new Map<string, DepartmentData>();

      departmentNames.forEach(deptName => {
        const empMap = departmentEmployeeData.get(deptName);
        if (!empMap) {
          finalDepartmentData.set(deptName, {
            departmentName: deptName,
            employees: [],
            totals: {
              signed: 0,
              signedNormalized: 0,
              dueNormalized: 0,
              signedPortion: 0,
              contribution: 0,
              contributionFixed: 0,
              salaryBudget: 0,
              salaryBrutto: 0,
              totalSalaryCost: 0,
              maxIncentives: 0,
              due: 0,
              duePortion: 0,
              total: 0,
              totalPortionDue: 0,
              percentOfIncome: 0,
              normalized: 0,
            },
          });
          return;
        }

        const employees: EmployeeData[] = [];
        let deptSigned = 0;
        let deptSignedNormalized = 0;
        let deptDueNormalized = 0;
        let deptSignedPortion = 0;
        let deptContribution = 0;
        let deptContributionFixed = 0;
        let deptSalaryBudget = 0;
        let deptSalaryBrutto = 0;
        let deptTotalSalaryCost = 0;
        let deptMaxIncentives = 0;
        let deptDue = 0;
        let deptDuePortion = 0;
        let deptTotal = 0;
        let deptTotalPortionDue = 0;

        empMap.forEach(empData => {
          // Calculate signed total from role breakdown if available
          // Include date range, income, due normalized percentage, and role percentages hash in cache key to get correct data
          const dateRangeKey = `${filters.fromDate || ''}_${filters.toDate || ''}`;
          const incomeKey = totalIncome || 0;
          const dueNormalizedPercentageKey = dueNormalizedPercentage || 0;
          const rolePercentagesHash = getRolePercentagesHash(rolePercentages);
          const cacheKey = `${empData.employeeId}_${dateRangeKey}_${incomeKey}_${dueNormalizedPercentageKey}_${rolePercentagesHash}`;
          const roleData = roleDataCache.get(cacheKey) || [];
          if (roleData.length > 0) {
            // Sum up all signedTotal from role combinations for this employee
            const totalSigned = roleData.reduce((sum, roleItem) => sum + (roleItem.signedTotal || 0), 0);
            empData.signed = totalSigned;
          }

          // Calculate maxIncentives: salaryBudget - totalSalaryCost
          // If either value is null/undefined, set to 0
          const salaryBudget = empData.salaryBudget ?? 0;
          const totalSalaryCost = empData.totalSalaryCost ?? 0;
          empData.maxIncentives = salaryBudget - totalSalaryCost;

          // Portions are already calculated during processing based on role percentages
          // Calculate percent of income and normalized
          empData.percentOfIncome = globalTotal > 0 ? (empData.total / globalTotal) * 100 : 0;
          empData.normalized = empData.total; // Already in NIS

          employees.push(empData);

          deptSigned += empData.signed;
          deptSignedNormalized += empData.signedNormalized || 0;
          deptDueNormalized += empData.dueNormalized || 0;
          deptSignedPortion += empData.signedPortion;
          deptContribution += empData.contribution || 0;
          deptContributionFixed += empData.contributionFixed || 0;
          deptSalaryBudget += empData.salaryBudget || 0;
          deptSalaryBrutto += empData.salaryBrutto || 0;
          deptTotalSalaryCost += empData.totalSalaryCost || 0;
          deptMaxIncentives += empData.maxIncentives ?? 0;
          deptDue += empData.due;
          deptDuePortion += empData.duePortion;
          deptTotal += empData.total;
          deptTotalPortionDue += empData.totalPortionDue;
        });

        const deptPercentOfIncome = globalTotal > 0 ? (deptTotal / globalTotal) * 100 : 0;
        const deptNormalized = deptTotal;

        finalDepartmentData.set(deptName, {
          departmentName: deptName,
          employees: employees.sort((a, b) => a.employeeName.localeCompare(b.employeeName)), // Sort by name alphabetically
          totals: {
            signed: deptSigned,
            signedNormalized: deptSignedNormalized,
            dueNormalized: deptDueNormalized,
            signedPortion: deptSignedPortion,
            contribution: deptContribution,
            contributionFixed: deptContributionFixed,
            salaryBudget: deptSalaryBudget,
            salaryBrutto: deptSalaryBrutto,
            totalSalaryCost: deptTotalSalaryCost,
            maxIncentives: deptMaxIncentives,
            due: deptDue,
            duePortion: deptDuePortion,
            total: deptTotal,
            totalPortionDue: deptTotalPortionDue,
            percentOfIncome: deptPercentOfIncome,
            normalized: deptNormalized,
          },
        });
      });

      // Don't set department data yet - wait until all calculations are complete
      // This prevents the "popcorn effect" where numbers appear incrementally
      console.log('✅ Sales Contribution Report - Processed initial data for', finalDepartmentData.size, 'departments');

      // Fetch role data for all employees to populate signed totals
      const allEmployeeIds: number[] = [];
      const employeeNamesMap = new Map<number, string>();

      finalDepartmentData.forEach(deptData => {
        deptData.employees.forEach(emp => {
          if (!allEmployeeIds.includes(emp.employeeId)) {
            allEmployeeIds.push(emp.employeeId);
            employeeNamesMap.set(emp.employeeId, emp.employeeName);
          }
        });
      });

      const dateRangeKey = `${filters.fromDate || ''}_${filters.toDate || ''}`;
      const incomeKey = totalIncome || 0;
      const dueNormalizedPercentageKey = dueNormalizedPercentage || 0;
      const rolePercentagesHash = getRolePercentagesHash(rolePercentages);
      // Always refetch all employees for Search. `setRoleDataCache(new Map())` at the start of this handler
      // is applied on the *next* render; `roleDataCache` in this closure is still the previous map, so
      // `!roleDataCache.has(cacheKey)` can wrongly skip the full batch and alternate with the "cached" path.
      const employeesToFetch: Array<{ id: number; name: string }> = [...allEmployeeIds]
        .sort((a, b) => a - b)
        .map((employeeId) => ({
          id: employeeId,
          name: employeeNamesMap.get(employeeId) || '',
        }));

      // Batch calculate all employees at once to prevent "popcorn" rendering
      // This ensures all calculations are done before any state updates
      if (employeesToFetch.length > 0) {
        setIsCalculating(true);

        // Fetch all data first, then calculate everything, then update state once
        try {
          // Use explicit UTC timestamps to include full day: from 00:00:00.000 to 23:59:59.999
          const { startIso: fromDateTime, endIso: toDateTime } = computeDateBounds(filters.fromDate, filters.toDate);

          // Step 1: Fetch all signed leads (stage 60) - ONCE for all employees
          let stageHistoryQuery = supabase
            .from('leads_leadstage')
            .select('id, stage, date, cdate, lead_id, newlead_id')
            .eq('stage', 60);

          if (fromDateTime) {
            stageHistoryQuery = stageHistoryQuery.gte('date', fromDateTime);
          }
          if (toDateTime) {
            stageHistoryQuery = stageHistoryQuery.lte('date', toDateTime);
          }

          const { data: stageHistoryData, error: stageHistoryError } = await stageHistoryQuery;
          if (stageHistoryError) throw stageHistoryError;

          // Separate new and legacy lead IDs
          const allNewLeadIds = new Set<string>();
          const allLegacyLeadIds = new Set<number>();

          stageHistoryData?.forEach((entry: any) => {
            if (entry.newlead_id) {
              allNewLeadIds.add(entry.newlead_id.toString());
            }
            if (entry.lead_id !== null && entry.lead_id !== undefined) {
              allLegacyLeadIds.add(Number(entry.lead_id));
            }
          });

          // Step 2: Fetch all new leads - ONCE
          const newLeadsMap = new Map();
          if (allNewLeadIds.size > 0) {
            const newLeadIdsArray = Array.from(allNewLeadIds);

            // Chunked and paged: a bare `.in()` select is capped at 1000 rows, and without an
            // ORDER BY the page that comes back is arbitrary, so leads vanish silently.
            const newLeads = await fetchAllRowsForLeadIds<any>(newLeadIdsArray, (chunk) =>
              supabase
                .from('leads')
                .select(`
                    id,
                    lead_number,
                    name,
                    balance,
                    balance_currency,
                    proposal_total,
                    proposal_currency,
                    currency_id,
                    closer,
                    scheduler,
                    handler,
                    helper,
                    meeting_lawyer_id,
                    lawyer,
                    expert,
                    expert_id,
                    case_handler_id,
                    manager,
                    meeting_manager_id,
                    subcontractor_fee,
                    category_id,
                    category,
                    accounting_currencies!leads_currency_id_fkey(name, iso_code),
                    misc_category!category_id(
                      id,
                      name,
                      parent_id,
                      misc_maincategory!parent_id(
                        id,
                        name
                      )
                    )
                  `)
                .in('id', chunk),
            );

            if (newLeads.length > 0) {
              // Use joined data directly (misc_category, misc_maincategory from select) - no preprocess map
              newLeads.forEach((lead: any) => {
                newLeadsMap.set(lead.id, lead);
              });
              // DEBUG L210620: Is lead in fetched new leads and what are helper fields?
              const leadL210620 = newLeads.find((l: any) => (l.lead_number || '').toString().includes('210620'));
              if (leadL210620) {
                console.log('🔍 DEBUG L210620 (batch): Lead in newLeads fetch:', {
                  id: leadL210620.id,
                  lead_number: leadL210620.lead_number,
                  helper: leadL210620.helper,
                  helperType: typeof leadL210620.helper,
                  meeting_lawyer_id: leadL210620.meeting_lawyer_id,
                  lawyer: leadL210620.lawyer,
                  inAllNewLeadIds: allNewLeadIds.has(String(leadL210620.id)),
                });
              } else {
                console.log('🔍 DEBUG L210620 (batch): Lead NOT in newLeads fetch. allNewLeadIds.size=', allNewLeadIds.size, 'lead_numbers=', newLeads.map((l: any) => l.lead_number).slice(0, 15));
              }
            }
          }

          // Step 3: Fetch all legacy leads - ONCE
          const legacyLeadsMap = new Map();
          if (allLegacyLeadIds.size > 0) {
            const legacyLeadIdsArray = Array.from(allLegacyLeadIds);
            // Chunked and paged: a bare `.in()` select is capped at 1000 rows, and without an
            // ORDER BY the page that comes back is arbitrary, so leads vanish silently.
            const legacyLeads = await fetchAllRowsForLeadIds<any>(legacyLeadIdsArray, (chunk) =>
              supabase
                .from('leads_lead')
                .select(`
              id,
              total,
              total_base,
              currency_id,
              subcontractor_fee,
              meeting_total_currency_id,
              closer_id,
              meeting_scheduler_id,
              meeting_lawyer_id,
              case_handler_id,
              meeting_manager_id,
              expert_id,
              category_id,
              category,
              accounting_currencies!leads_lead_currency_id_fkey(name, iso_code),
              misc_category!category_id(
                id,
                name,
                parent_id,
                misc_maincategory!parent_id(
                  id,
                  name
                )
              )
            `)
                .in('id', chunk),
            );

            if (legacyLeads.length > 0) {
              // Use joined data directly (misc_category, misc_maincategory from select) - no preprocess map
              legacyLeads.forEach((lead: any) => {
                legacyLeadsMap.set(Number(lead.id), lead);
              });
            }
          }

          const signDates = buildSignDateMapsFromStageHistory(stageHistoryData);
          const boiConverter = await createBoiDateRateConverter();
          await enrichLeadsMapsWithSignedNis(newLeadsMap, legacyLeadsMap, signDates, boiConverter);

          // Step 4: Fetch all payment plans - ONCE
          const newPaymentsMap = new Map<string, number>();
          const legacyPaymentsMap = new Map<number, number>();
          let allNewPaymentRows: any[] = [];
          let allLegacyPaymentRows: any[] = [];

          if (allNewLeadIds.size > 0) {
            const newLeadIdsArray = Array.from(allNewLeadIds);
            const newPayments = await fetchAllRowsForLeadIds<any>(newLeadIdsArray, (chunk) => {
              let q = scopeDueInvoicedQuery(
                supabase
                  .from('payment_plans')
                  .select(`lead_id, value, currency, due_date, ${DUE_INVOICED_EXTRA_COLUMNS}, ${DUE_INVOICED_PAID_COLUMNS}`)
                  .not('due_date', 'is', null)
                  .is('cancel_date', null)
                  .in('lead_id', chunk),
              );
              if (fromDateTime) q = q.gte('due_date', fromDateTime);
              if (toDateTime) q = q.lte('due_date', toDateTime);
              return q;
            });
            allNewPaymentRows = newPayments;

            const processedPayments = await processNewPaymentsAsync(newPayments, boiConverter, dueInvoicedReadyToPayFilter);
            processedPayments.forEach((amount, leadId) => {
              const current = newPaymentsMap.get(leadId) || 0;
              newPaymentsMap.set(leadId, current + amount);
            });
          }

          if (allLegacyLeadIds.size > 0) {
            const legacyLeadIdsArray = Array.from(allLegacyLeadIds);
            const legacySelect = `lead_id, value, value_base, currency_id, due_date, accounting_currencies!finances_paymentplanrow_currency_id_fkey(name, iso_code), ${DUE_INVOICED_LEGACY_EXTRA_COLUMNS}`;

            const legacyPayments = await fetchAllRowsForLeadIds<any>(legacyLeadIdsArray, (chunk) => {
              let q = scopeDueInvoicedQuery(
                supabase
                  .from('finances_paymentplanrow')
                  .select(legacySelect)
                  .not('due_date', 'is', null)
                  .in('lead_id', chunk),
              );
              if (fromDateTime) q = q.gte('due_date', fromDateTime);
              if (toDateTime) q = q.lte('due_date', toDateTime);
              return q;
            });

            // Plus rows invoiced in the window that never reached finance, so carry no due date.
            const legacyInvoicedNoDueDate = await fetchAllRowsForLeadIds<any>(legacyLeadIdsArray, (chunk) =>
              scopeLegacyInvoicedWithoutDueDate(
                supabase
                  .from('finances_paymentplanrow')
                  .select(legacySelect)
                  .in('lead_id', chunk),
                fromDateTime,
                toDateTime,
              ),
            );
            allLegacyPaymentRows = [...legacyPayments, ...legacyInvoicedNoDueDate];

            const processedPayments = await processLegacyPaymentsAsync(allLegacyPaymentRows, boiConverter, legacyLeadsMap, dueInvoicedReadyToPayFilter);
            processedPayments.forEach((amount, leadId) => {
              const current = legacyPaymentsMap.get(leadId) || 0;
              legacyPaymentsMap.set(leadId, current + amount);
            });
          }

          // Daily graph points: individual daily totals (not cumulative), so rises and falls remain visible.
          const salesSignedByDay = new Map<string, number>();
          const countedNewLeadIds = new Set<string>();
          const countedLegacyLeadIds = new Set<number>();
          (stageHistoryData || []).forEach((entry: any) => {
            const day = String(entry.date || entry.cdate || '').slice(0, 10);
            if (!day) return;
            if (entry.newlead_id) {
              const id = String(entry.newlead_id);
              if (countedNewLeadIds.has(id)) return;
              countedNewLeadIds.add(id);
              const lead = newLeadsMap.get(id);
              if (lead) salesSignedByDay.set(day, (salesSignedByDay.get(day) || 0) + calculateNewLeadFullAmount(lead));
            } else if (entry.lead_id !== null && entry.lead_id !== undefined) {
              const id = Number(entry.lead_id);
              if (countedLegacyLeadIds.has(id)) return;
              countedLegacyLeadIds.add(id);
              const lead = legacyLeadsMap.get(id);
              if (lead) salesSignedByDay.set(day, (salesSignedByDay.get(day) || 0) + calculateLegacyLeadFullAmount(lead));
            }
          });

          const groupPaymentsByDay = (rows: any[], legacy = false) => {
            const grouped = new Map<string, any[]>();
            rows.forEach((row) => {
              const rawDate = row.due_date || row.invoice_sent_at || row.invoice_send_automation_sent_at || (legacy ? row.date : null);
              const day = String(rawDate || '').slice(0, 10);
              if (!day) return;
              grouped.set(day, [...(grouped.get(day) || []), row]);
            });
            return grouped;
          };

          const handlersDueByDay = new Map<string, number>();
          const [newDailyTotals, legacyDailyTotals] = await Promise.all([
            Promise.all(
              Array.from(groupPaymentsByDay(allNewPaymentRows), async ([day, rows]) => {
                const amounts = await processNewPaymentsAsync(rows, boiConverter, dueInvoicedReadyToPayFilter);
                return [day, Array.from(amounts.values()).reduce((sum, amount) => sum + amount, 0)] as const;
              })
            ),
            Promise.all(
              Array.from(groupPaymentsByDay(allLegacyPaymentRows, true), async ([day, rows]) => {
                const amounts = await processLegacyPaymentsAsync(rows, boiConverter, legacyLeadsMap, dueInvoicedReadyToPayFilter);
                return [day, Array.from(amounts.values()).reduce((sum, amount) => sum + amount, 0)] as const;
              })
            ),
          ]);
          newDailyTotals.forEach(([day, total]) => handlersDueByDay.set(day, total));
          legacyDailyTotals.forEach(([day, total]) => {
            handlersDueByDay.set(day, (handlersDueByDay.get(day) || 0) + total);
          });

          const buildDailySeries = (totals: Map<string, number>) => {
            if (!filters.fromDate || !filters.toDate) {
              return Array.from(totals, ([date, total]) => ({ date, total })).sort((a, b) => a.date.localeCompare(b.date));
            }
            const points: Array<{ date: string; total: number }> = [];
            const cursor = new Date(`${filters.fromDate}T00:00:00Z`);
            const end = new Date(`${filters.toDate}T00:00:00Z`);
            while (cursor <= end && points.length < 400) {
              const date = cursor.toISOString().slice(0, 10);
              points.push({ date, total: totals.get(date) || 0 });
              cursor.setUTCDate(cursor.getUTCDate() + 1);
            }
            return points;
          };

          setMainProgressDailyData({
            salesSigned: buildDailySeries(salesSignedByDay),
            handlersDue: buildDailySeries(handlersDueByDay),
          });

          // Step 6: Fetch due amounts for all handlers in parallel
          const dueAmountsMap = new Map<number, number>();
          await Promise.all(
            employeesToFetch.map(async ({ id, name }) => {
              const dueAmount = await fetchDueAmounts(id, name);
              if (dueAmount > 0) {
                dueAmountsMap.set(id, dueAmount);
              }
            })
          );

          // Step 6.5: Fetch salary data for ALL employees (averaged over preset months or single month in custom mode)
          let salaryDataMap = new Map<number, { salaryBrutto: number; totalSalaryCost: number }>();
          const canFetchSalaryMain =
            allEmployeeIds.length > 0 &&
            (periodPreset !== 'custom'
              ? !!(filters.fromDate && filters.toDate)
              : !!(salaryFilter?.month && salaryFilter?.year));
          if (canFetchSalaryMain) {
            try {
              salaryDataMap = await fetchSalaryDataMapForSalesReport(
                allEmployeeIds,
                periodPreset,
                filters,
                salaryFilter
              );
              console.log('✅ Salary data map ready:', { employees: salaryDataMap.size, periodPreset });
            } catch (error) {
              console.error('Error in salary data fetch:', error);
            }
          } else {
            console.log('ℹ️ Skipping salary fetch:', {
              periodPreset,
              hasDates: !!(filters.fromDate && filters.toDate),
              hasMonth: !!salaryFilter?.month,
              hasYear: !!salaryFilter?.year,
              employeesCount: allEmployeeIds.length
            });
          }

          // Step 7: Filter leads for each employee and prepare calculation inputs
          const calculationInputs: EmployeeCalculationInput[] = [];
          const totalSignedOverall = totalSignedForRun;

          // Map employeeId -> department name (for department % from sales_contribution_settings)
          const employeeIdToDepartment = new Map<number, string>();
          finalDepartmentData.forEach((data, deptName) => {
            data.employees.forEach(emp => employeeIdToDepartment.set(emp.employeeId, deptName));
          });

          // DEBUG: Check if "Adi" is in the employees list and what their ID is
          const adiEmployee = employeesToFetch.find(e =>
            e.name?.toLowerCase().includes('adi') ||
            e.name?.toLowerCase() === 'adi'
          );
          if (adiEmployee) {
            console.log('🔍 DEBUG: Found "Adi" employee:', {
              id: adiEmployee.id,
              name: adiEmployee.name,
              isHava: adiEmployee.id === 108
            });
          }

          employeesToFetch.forEach(({ id: employeeId, name: employeeName }) => {
            // DEBUG: Check for Hava specifically
            const isHava = employeeName?.toLowerCase().includes('hava') ||
              employeeName?.toLowerCase().includes('חוה') ||
              employeeId === 108;

            // Helper to check if employee is in a role for a new lead
            const checkEmployeeInRole = (lead: any, roleField: string): boolean => {
              if (roleField === 'closer' && lead.closer) {
                return newLeadFieldMatchesEmployee(lead.closer, employeeId, employeeName);
              } else if (roleField === 'scheduler' && lead.scheduler) {
                return newLeadFieldMatchesEmployee(lead.scheduler, employeeId, employeeName);
              } else if (roleField === 'handler') {
                if (lead.handler) {
                  const handlerValue = lead.handler;
                  if (typeof handlerValue === 'string' && handlerValue.toLowerCase() === employeeName.toLowerCase()) {
                    return true;
                  }
                  if (Number(handlerValue) === employeeId) {
                    return true;
                  }
                }
                if (lead.case_handler_id && Number(lead.case_handler_id) === employeeId) {
                  return true;
                }
                return false;
              } else if (roleField === 'helper') {
                // Helper Closer: check helper, meeting_lawyer_id, and lawyer (same as fetchRoleData)
                if (lead.helper != null && lead.helper !== '') {
                  const helperValue = lead.helper;
                  const matchName = typeof helperValue === 'string' && helperValue.toLowerCase() === employeeName.toLowerCase();
                  const matchId = Number(helperValue) === employeeId;
                  if (matchName || matchId) return true;
                }
                if (lead.meeting_lawyer_id != null && Number(lead.meeting_lawyer_id) === employeeId) return true;
                if (lead.lawyer != null && lead.lawyer !== '') {
                  const lawyerValue = lead.lawyer;
                  const matchName = typeof lawyerValue === 'string' && lawyerValue.toLowerCase() === employeeName.toLowerCase();
                  const matchId = Number(lawyerValue) === employeeId;
                  if (matchName || matchId) return true;
                }
                return false;
              } else if (roleField === 'expert') {
                return newLeadMatchesExpert(lead, employeeId, employeeName);
              } else if (roleField === 'manager' || roleField === 'meeting_manager_id') {
                if (lead.manager) {
                  const managerValue = lead.manager;
                  // Check if it's a numeric string (ID) or a number
                  if (typeof managerValue === 'string') {
                    const numericValue = Number(managerValue);
                    // If it's a valid number, treat it as an ID
                    if (!isNaN(numericValue) && numericValue.toString() === managerValue.trim()) {
                      return numericValue === employeeId;
                    }
                    // Otherwise, treat it as a name
                    return managerValue.toLowerCase() === employeeName.toLowerCase();
                  }
                  // If it's already a number, compare directly
                  return Number(managerValue) === employeeId;
                }
                if (lead.meeting_manager_id) {
                  return Number(lead.meeting_manager_id) === employeeId;
                }
                return false;
              }
              return false;
            };

            // Filter new leads for this employee
            const DEBUG_EMP_129 = employeeId === 129;
            const employeeNewLeads = Array.from(newLeadsMap.values()).filter(lead => {
              const isL210620 = (lead.lead_number || '').toString().includes('210620');
              const isL210675 = lead.lead_number?.toString().includes('210675') ||
                lead.id?.toString().includes('210675');

              const matchesCloser = checkEmployeeInRole(lead, 'closer');
              const matchesScheduler = checkEmployeeInRole(lead, 'scheduler');
              const matchesHandler = checkEmployeeInRole(lead, 'handler');
              const matchesHelper = checkEmployeeInRole(lead, 'helper');
              const matchesExpert = checkEmployeeInRole(lead, 'expert');
              const matchesManager = checkEmployeeInRole(lead, 'meeting_manager_id');

              const matches = matchesCloser || matchesScheduler || matchesHandler ||
                matchesHelper || matchesExpert || matchesManager;

              // DEBUG L210620: when processing employee 129, log for lead L210620
              if (DEBUG_EMP_129 && isL210620) {
                console.log('🔍 DEBUG L210620 (batch): Employee 129 role check for lead:', {
                  lead_number: lead.lead_number,
                  leadId: lead.id,
                  helper: lead.helper,
                  helperType: typeof lead.helper,
                  meeting_lawyer_id: lead.meeting_lawyer_id,
                  lawyer: lead.lawyer,
                  matchesHelper,
                  matchesCloser,
                  matchesScheduler,
                  matchesManager,
                  matchesExpert,
                  matches,
                });
              }

              // DEBUG: Log details for L210675 when processing Hava
              if (isHava && isL210675) {
                // Check if "Adi" might be Hava by checking employee names
                const allEmployeeNames = employeesToFetch.map(e => e.name?.toLowerCase() || '');
                const adiInEmployees = allEmployeeNames.some(name => name.includes('adi'));
                const havaNameVariations = ['hava', 'חוה', 'חבה'];
                const adiIsHava = lead.closer?.toLowerCase() === 'adi' &&
                  (employeeName?.toLowerCase().includes('adi') ||
                    havaNameVariations.some(v => employeeName?.toLowerCase().includes(v)));

                // Check manager matching details
                const managerValue = lead.manager;
                const managerNumeric = typeof managerValue === 'string' ? Number(managerValue) : managerValue;
                const managerIsNumericString = typeof managerValue === 'string' && !isNaN(managerNumeric) && managerNumeric.toString() === managerValue.trim();
                const managerMatchesById = managerIsNumericString ? managerNumeric === employeeId : false;
                const managerMatchesByName = typeof managerValue === 'string' && !managerIsNumericString ? managerValue.toLowerCase() === employeeName.toLowerCase() : false;

                console.log('🔍 DEBUG L210675 for Hava: Role matching check:', {
                  employeeId,
                  employeeName,
                  leadId: lead.id,
                  leadNumber: lead.lead_number,
                  leadName: lead.name,
                  closer: lead.closer,
                  scheduler: lead.scheduler,
                  handler: lead.handler,
                  helper: lead.helper,
                  expert: lead.expert,
                  case_handler_id: lead.case_handler_id,
                  manager: lead.manager,
                  meeting_manager_id: lead.meeting_manager_id,
                  matchesCloser,
                  matchesScheduler,
                  matchesHandler,
                  matchesHelper,
                  matchesExpert,
                  matchesManager,
                  overallMatch: matches,
                  balance: lead.balance,
                  proposal_total: lead.proposal_total,
                  // Manager matching details
                  managerValue,
                  managerType: typeof managerValue,
                  managerIsNumericString,
                  managerNumeric,
                  managerMatchesById,
                  managerMatchesByName,
                  // Check ID comparisons
                  expertMatchesHavaId: Number(lead.expert) === employeeId,
                  caseHandlerMatchesHavaId: Number(lead.case_handler_id) === employeeId,
                  meetingManagerIdMatchesHavaId: Number(lead.meeting_manager_id) === employeeId
                });
              }

              return matches;
            });

            // Filter legacy leads for this employee
            const employeeLegacyLeads = Array.from(legacyLeadsMap.values()).filter(lead => {
              const isL210675 = lead.lead_number?.toString().includes('210675') ||
                lead.id?.toString().includes('210675');

              const matchesCloser = lead.closer_id && Number(lead.closer_id) === employeeId;
              const matchesScheduler = lead.meeting_scheduler_id && Number(lead.meeting_scheduler_id) === employeeId;
              const matchesLawyer = lead.meeting_lawyer_id && Number(lead.meeting_lawyer_id) === employeeId;
              const matchesHandler = lead.case_handler_id && Number(lead.case_handler_id) === employeeId;
              const matchesExpert = legacyLeadMatchesExpert(lead, employeeId, employeeName);
              const matchesManager = lead.meeting_manager_id && Number(lead.meeting_manager_id) === employeeId;

              const matches = matchesCloser || matchesScheduler || matchesLawyer ||
                matchesHandler || matchesExpert || matchesManager;

              // DEBUG: Log details for L210675 when processing Hava
              if (isHava && isL210675) {
                console.log('🔍 DEBUG L210675 for Hava (Legacy): Role matching check:', {
                  employeeId,
                  employeeName,
                  leadId: lead.id,
                  leadNumber: lead.lead_number,
                  leadName: lead.name,
                  closer_id: lead.closer_id,
                  meeting_scheduler_id: lead.meeting_scheduler_id,
                  meeting_lawyer_id: lead.meeting_lawyer_id,
                  case_handler_id: lead.case_handler_id,
                  expert_id: lead.expert_id,
                  meeting_manager_id: lead.meeting_manager_id,
                  matchesCloser,
                  matchesScheduler,
                  matchesLawyer,
                  matchesHandler,
                  matchesExpert,
                  matchesManager,
                  overallMatch: matches,
                  total: lead.total,
                  total_base: lead.total_base
                });
              }

              return matches;
            });

            // DEBUG L210620: Summary for employee 129
            if (DEBUG_EMP_129) {
              const hasL210620InNew = employeeNewLeads.some(l => (l.lead_number || '').toString().includes('210620'));
              const l210620Lead = employeeNewLeads.find(l => (l.lead_number || '').toString().includes('210620'));
              console.log('🔍 DEBUG L210620 (batch): Employee 129 summary after filter:', {
                employeeId,
                employeeName,
                newLeadsCount: employeeNewLeads.length,
                legacyLeadsCount: employeeLegacyLeads.length,
                hasL210620InNew,
                l210620InList: !!l210620Lead,
                l210620Lead: l210620Lead ? { id: l210620Lead.id, lead_number: l210620Lead.lead_number, helper: l210620Lead.helper } : null,
                newLeadNumbers: employeeNewLeads.map(l => l.lead_number).slice(0, 20),
              });
            }

            // DEBUG: Summary for Hava
            if (isHava) {
              console.log('🔍 DEBUG Hava Summary:', {
                employeeId,
                employeeName,
                newLeadsCount: employeeNewLeads.length,
                legacyLeadsCount: employeeLegacyLeads.length,
                hasL210675InNew: employeeNewLeads.some(l =>
                  l.lead_number?.toString().includes('210675') ||
                  l.id?.toString().includes('210675')
                ),
                hasL210675InLegacy: employeeLegacyLeads.some(l =>
                  l.lead_number?.toString().includes('210675') ||
                  l.id?.toString().includes('210675')
                ),
                newLeadsSample: employeeNewLeads.slice(0, 5).map(l => ({
                  id: l.id,
                  lead_number: l.lead_number,
                  name: l.name
                }))
              });
            }

            // DEBUG: Log Hava's leads before calculation
            if (isHava) {
              console.log('🔍 DEBUG Hava: Leads before calculation:', {
                employeeId,
                employeeName,
                newLeadsCount: employeeNewLeads.length,
                legacyLeadsCount: employeeLegacyLeads.length,
                newLeads: employeeNewLeads.map(l => ({
                  id: l.id,
                  lead_number: l.lead_number,
                  name: l.name,
                  balance: l.balance,
                  proposal_total: l.proposal_total,
                  manager: l.manager
                })),
                legacyLeads: employeeLegacyLeads.map(l => ({
                  id: l.id,
                  lead_number: l.lead_number,
                  name: l.name,
                  total: l.total,
                  total_base: l.total_base
                }))
              });
            }

            const deptName = employeeIdToDepartment.get(employeeId) ?? 'Sales';
            // Use Sales % for Partners, Marketing, Finance; own department % for Sales and Handlers (from sales_contribution_settings)
            const departmentPercentage = (['Partners', 'Marketing', 'Finance'].includes(deptName) ? departmentPercentages.get('Sales') : departmentPercentages.get(deptName)) ?? 35;
            calculationInputs.push({
              employeeId,
              employeeName,
              leads: {
                newLeads: employeeNewLeads,
                legacyLeads: employeeLegacyLeads,
              },
              payments: {
                newPayments: newPaymentsMap,
                legacyPayments: legacyPaymentsMap,
              },
              totalDueAmount: dueAmountsMap.get(employeeId) || 0,
              totalSignedOverall,
              totalIncome,
              dueNormalizedPercentage,
              rolePercentages,
              departmentPercentage,
              departmentName: deptName,
            });
          });

          // Step 7.5: Removed - All departments now calculate contribution the same way from leads

          // Step 8: Calculate ALL employee metrics in one batch (PURE calculation, no async)
          console.log('🔍 Starting batch calculation:', {
            inputCount: calculationInputs.length,
            employeesToFetch: employeesToFetch.length,
            totalSignedOverall,
            totalIncome,
            dueNormalizedPercentage,
            salaryFilter: salaryFilter
          });

          const calculationResults = calculateSimpleEmployeeMetrics(calculationInputs);

          // DEBUG L210620: Log employee 129 calculation result (Helper Closer / L210620)
          const emp129Result = calculationResults.get(129);
          if (emp129Result) {
            console.log('🔍 DEBUG L210620 (batch): Employee 129 calculation result:', {
              employeeId: 129,
              signed: emp129Result.signed,
              roleBreakdown: emp129Result.roleBreakdown?.map(r => ({ role: r.role, signedTotal: r.signedTotal, dueTotal: r.dueTotal })) || [],
              hasHelperCloserInBreakdown: emp129Result.roleBreakdown?.some(r => r.role && r.role.includes('Helper Closer')) ?? false,
            });
          } else {
            console.log('🔍 DEBUG L210620 (batch): No calculation result for employee 129');
          }

          // DEBUG: Log Hava's calculation result
          const havaResult = calculationResults.get(108);
          if (havaResult) {
            console.log('🔍 DEBUG Hava: Calculation result:', {
              employeeId: 108,
              signed: havaResult.signed,
              due: havaResult.due,
              signedNormalized: havaResult.signedNormalized,
              dueNormalized: havaResult.dueNormalized,
              contribution: havaResult.contribution,
              roleBreakdown: havaResult.roleBreakdown.map(r => ({
                role: r.role,
                signedTotal: r.signedTotal,
                dueTotal: r.dueTotal
              }))
            });
          }

          // Debug: Log calculation results to identify why contribution might be 0
          console.log('🔍 Calculation Results Debug:', {
            totalInputs: calculationInputs.length,
            totalResults: calculationResults.size,
            sampleResult: calculationResults.size > 0 ? Array.from(calculationResults.values())[0] : null,
            rolePercentagesSize: rolePercentages?.size || 0,
            rolePercentagesEntries: rolePercentages ? Array.from(rolePercentages.entries()) : [],
            totalSignedOverall,
            totalIncome,
            dueNormalizedPercentage,
            hasSalaryData: salaryDataMap.size > 0
          });

          if (calculationResults.size === 0 && calculationInputs.length > 0) {
            console.error('❌ Calculation returned empty results but had inputs!', {
              inputCount: calculationInputs.length,
              sampleInput: calculationInputs[0]
            });
          }

          if (salesContributionSearchSeqRef.current !== searchSeq) {
            return;
          }

          // Step 9: Update state ONCE with all results
          const dateRangeKey = `${filters.fromDate || ''}_${filters.toDate || ''}`;
          const incomeKey = totalIncome || 0;
          const dueNormalizedPercentageKey = dueNormalizedPercentage || 0;
          const rolePercentagesHash = getRolePercentagesHash(rolePercentages);

          // Update role data cache
          setRoleDataCache(prev => {
            const newCache = new Map(prev);
            calculationResults.forEach((result, employeeId) => {
              const cacheKey = `${employeeId}_${dateRangeKey}_${incomeKey}_${dueNormalizedPercentageKey}_${rolePercentagesHash}`;
              newCache.set(cacheKey, result.roleBreakdown.map(r => ({
                role: r.role,
                signedTotal: r.signedTotal,
                dueTotal: r.dueTotal,
                roles: r.roles,
                action: '',
              })));
            });
            return newCache;
          });

          // Fetch "use fixed contribution from DB" toggle (when true, use employee_fixed_contribution table instead of hardcoded logic)
          let useFixedFromDb = false;
          const fixedContributionFromDbMap = new Map<number, number>();
          try {
            const { data: toggleRow } = await supabase
              .from('sales_contribution_use_fixed_from_db')
              .select('use_fixed_contribution_from_db')
              .eq('id', 1)
              .maybeSingle();
            useFixedFromDb = !!toggleRow?.use_fixed_contribution_from_db;
            if (useFixedFromDb && allEmployeeIds.length > 0) {
              const { data: fixedRows } = await supabase
                .from('employee_fixed_contribution')
                .select('employee_id, fixed_contribution_amount')
                .in('employee_id', allEmployeeIds);
              (fixedRows || []).forEach((r: any) => {
                const eid = Number(r.employee_id);
                const amount = Number(r.fixed_contribution_amount) || 0;
                fixedContributionFromDbMap.set(eid, (fixedContributionFromDbMap.get(eid) || 0) + amount);
              });
            }
          } catch (e) {
            console.warn('Error fetching fixed contribution toggle/map:', e);
          }

          // Fetch employee_field_assignments to identify employees with Marketing/Finance/Partners roles (100% of Salary B)
          const employeesWithFixedContribution = new Set<number>();
          try {
            const { data: fieldAssignments, error: fieldAssignmentsError } = await supabase
              .from('employee_field_assignments')
              .select('employee_id, department_role')
              .in('department_role', ['Marketing', 'Finance', 'Partners'])
              .eq('is_active', true);

            if (!fieldAssignmentsError && fieldAssignments) {
              fieldAssignments.forEach((assignment: any) => {
                employeesWithFixedContribution.add(Number(assignment.employee_id));
              });
              console.log('✅ Fetched employee_field_assignments for Contribution Fixed (100%):', {
                assignmentsCount: fieldAssignments.length,
                uniqueEmployees: employeesWithFixedContribution.size
              });
            } else if (fieldAssignmentsError) {
              console.error('Error fetching employee_field_assignments:', fieldAssignmentsError);
            }
          } catch (error) {
            console.error('Error fetching employee_field_assignments:', error);
          }

          // Update department data ONCE - start with finalDepartmentData since we didn't set it initially
          setDepartmentData(() => {
            const updated = new Map(finalDepartmentData);

            updated.forEach((deptData, deptName) => {
              const updatedEmployees = deptData.employees.map(emp => {
                const result = calculationResults.get(emp.employeeId);
                const salaryData = salaryDataMap.get(emp.employeeId);

                // Always update salary data if available
                const updatedEmp: EmployeeData = {
                  ...emp,
                  salaryBrutto: salaryData?.salaryBrutto || emp.salaryBrutto || 0,
                  totalSalaryCost: salaryData?.totalSalaryCost || emp.totalSalaryCost || 0,
                };


                updatedEmp.contributionFixed = includeFixedContributionRef.current
                  ? resolveContributionFixed({
                      departmentName: deptName,
                      salaryBrutto: updatedEmp.salaryBrutto || 0,
                      useFixedFromDb: useFixedFromDb,
                      fixedFromDb: fixedContributionFromDbMap.get(emp.employeeId),
                      hasFixedContributionAssignment: employeesWithFixedContribution.has(emp.employeeId),
                    })
                  : 0;

                // Update calculation results if available
                if (result) {
                  updatedEmp.signed = result.signed;
                  updatedEmp.due = result.due;
                  updatedEmp.signedNormalized = result.signedNormalized;
                  updatedEmp.dueNormalized = result.dueNormalized;
                  // All departments calculate contribution the same way from leads
                  updatedEmp.signedPortion = result.signedPortion || 0;
                  updatedEmp.duePortion = result.duePortion || 0;
                  updatedEmp.contribution = result.contribution || 0;
                  // Total is calculated from signedPortion + duePortion
                  updatedEmp.total = updatedEmp.signedPortion + (result.duePortion || 0);
                  // Salary Budget = 40% of (Contribution + Contribution Fixed)
                  updatedEmp.salaryBudget = computeSalaryBudget(
                    updatedEmp.contribution || 0,
                    updatedEmp.contributionFixed || 0
                  );

                  // DEBUG: Log Hava's state update
                  if (emp.employeeId === 108) {
                    console.log('🔍 DEBUG Hava: State update:', {
                      employeeId: emp.employeeId,
                      employeeName: emp.employeeName,
                      resultSigned: result.signed,
                      updatedEmpSigned: updatedEmp.signed,
                      resultRoleBreakdown: result.roleBreakdown.map(r => ({
                        role: r.role,
                        signedTotal: r.signedTotal
                      }))
                    });
                  }
                  // Calculate maxIncentives: salaryBudget - totalSalaryCost
                  // If either value is null/undefined, set to 0
                  const salaryBudget = updatedEmp.salaryBudget ?? 0;
                  const totalSalaryCost = updatedEmp.totalSalaryCost ?? 0;
                  updatedEmp.maxIncentives = salaryBudget - totalSalaryCost;

                  // Debug log if contribution is 0 but there should be data
                  if (result.contribution === 0 && (result.signed > 0 || result.due > 0)) {
                    console.warn(`⚠️ Zero contribution for employee ${emp.employeeId} (${emp.employeeName}):`, {
                      signed: result.signed,
                      due: result.due,
                      signedNormalized: result.signedNormalized,
                      dueNormalized: result.dueNormalized,
                      signedPortion: result.signedPortion,
                      duePortion: result.duePortion,
                      contribution: result.contribution,
                      baseContribution: (result.signedPortion || 0) + (result.duePortion || 0)
                    });
                  }
                } else {
                  console.warn(`⚠️ No calculation result found for employee ${emp.employeeId} (${emp.employeeName})`);
                  // Even without calculation result, calculate salaryBudget from contribution + contributionFixed
                  updatedEmp.salaryBudget = computeSalaryBudget(
                    updatedEmp.contribution || 0,
                    updatedEmp.contributionFixed || 0
                  );
                }


                return updatedEmp;
              });

              // Recalculate department totals
              const deptSigned = updatedEmployees.reduce((sum, emp) => sum + (emp.signed || 0), 0);
              const deptDue = updatedEmployees.reduce((sum, emp) => sum + (emp.due || 0), 0);
              const deptSignedNormalized = updatedEmployees.reduce((sum, emp) => sum + (emp.signedNormalized || 0), 0);
              const deptDueNormalized = updatedEmployees.reduce((sum, emp) => sum + (emp.dueNormalized || 0), 0);
              const deptSignedPortion = updatedEmployees.reduce((sum, emp) => sum + (emp.signedPortion || 0), 0);
              const deptContribution = updatedEmployees.reduce((sum, emp) => sum + (emp.contribution || 0), 0);
              const deptContributionFixed = updatedEmployees.reduce((sum, emp) => sum + (emp.contributionFixed || 0), 0);
              const deptTotalSalaryCost = updatedEmployees.reduce((sum, emp) => sum + (emp.totalSalaryCost || 0), 0);
              // Salary Budget = 40% of (Contribution + Contribution Fixed) - sum of all employees
              const deptSalaryBudget = updatedEmployees.reduce((sum, emp) => sum + (emp.salaryBudget || 0), 0);
              const deptSalaryBrutto = updatedEmployees.reduce((sum, emp) => sum + (emp.salaryBrutto || 0), 0);
              const deptMaxIncentives = updatedEmployees.reduce((sum, emp) => sum + (emp.maxIncentives ?? 0), 0);

              updated.set(deptName, {
                ...deptData,
                employees: updatedEmployees,
                totals: {
                  ...deptData.totals,
                  signed: deptSigned,
                  due: deptDue,
                  signedNormalized: deptSignedNormalized,
                  dueNormalized: deptDueNormalized,
                  signedPortion: deptSignedPortion,
                  contribution: deptContribution,
                  contributionFixed: deptContributionFixed,
                  salaryBudget: deptSalaryBudget,
                  salaryBrutto: deptSalaryBrutto,
                  totalSalaryCost: deptTotalSalaryCost,
                  maxIncentives: deptMaxIncentives,
                },
              });
            });

            return scaleDepartmentsToInvoicedIncome(updated, totalIncome || 0, departmentPercentages, {
              disableFixedContribution: !includeFixedContributionRef.current,
            });
          });

          // Set loading to false ONLY after all calculations are complete
          if (salesContributionSearchSeqRef.current === searchSeq) {
            setLoading(false);
            setIsCalculating(false);
          }
        } catch (error) {
          console.error('Error in batch calculation:', error);
          toast.error('Failed to calculate employee metrics');
          if (salesContributionSearchSeqRef.current === searchSeq) {
            setLoading(false);
            setIsCalculating(false);
          }
        }
      } else {
        // No employees to fetch (all cached), but we still need to fetch and apply salary data
        // Fetch salary data for all employees based on salary filter
        if (salesContributionSearchSeqRef.current !== searchSeq) {
          return;
        }
        let salaryDataMap = new Map<number, { salaryBrutto: number; totalSalaryCost: number }>();
        const canFetchSalaryCached =
          allEmployeeIds.length > 0 &&
          (periodPreset !== 'custom'
            ? !!(filters.fromDate && filters.toDate)
            : !!(salaryFilter?.month && salaryFilter?.year));
        if (canFetchSalaryCached) {
          try {
            salaryDataMap = await fetchSalaryDataMapForSalesReport(
              allEmployeeIds,
              periodPreset,
              filters,
              salaryFilter
            );
          } catch (error) {
            console.error('Error fetching salary data for cached employees:', error);
          }
        }

        // Fetch "use fixed contribution from DB" toggle and map for cached path
        let useFixedFromDbCached = false;
        const fixedContributionFromDbMapCached = new Map<number, number>();
        try {
          const { data: toggleRow } = await supabase
            .from('sales_contribution_use_fixed_from_db')
            .select('use_fixed_contribution_from_db')
            .eq('id', 1)
            .maybeSingle();
          useFixedFromDbCached = !!toggleRow?.use_fixed_contribution_from_db;
          if (useFixedFromDbCached && allEmployeeIds.length > 0) {
            const { data: fixedRows } = await supabase
              .from('employee_fixed_contribution')
              .select('employee_id, fixed_contribution_amount')
              .in('employee_id', allEmployeeIds);
            (fixedRows || []).forEach((r: any) => {
              const eid = Number(r.employee_id);
              const amount = Number(r.fixed_contribution_amount) || 0;
              fixedContributionFromDbMapCached.set(eid, (fixedContributionFromDbMapCached.get(eid) || 0) + amount);
            });
          }
        } catch (e) {
          console.warn('Error fetching fixed contribution toggle/map (cached):', e);
        }

        // Fetch employee_field_assignments to identify employees with Marketing/Finance/Partners roles (100% of Salary B)
        const employeesWithFixedContribution = new Set<number>();
        try {
          const { data: fieldAssignments, error: fieldAssignmentsError } = await supabase
            .from('employee_field_assignments')
            .select('employee_id, department_role')
            .in('department_role', ['Marketing', 'Finance', 'Partners'])
            .eq('is_active', true);

          if (!fieldAssignmentsError && fieldAssignments) {
            fieldAssignments.forEach((assignment: any) => {
              employeesWithFixedContribution.add(Number(assignment.employee_id));
            });
            console.log('✅ Fetched employee_field_assignments for Contribution Fixed (100%, cached):', {
              assignmentsCount: fieldAssignments.length,
              uniqueEmployees: employeesWithFixedContribution.size
            });
          } else if (fieldAssignmentsError) {
            console.error('Error fetching employee_field_assignments:', fieldAssignmentsError);
          }
        } catch (error) {
          console.error('Error fetching employee_field_assignments:', error);
        }

        if (salesContributionSearchSeqRef.current !== searchSeq) {
          return;
        }

        // Apply salary data to cached employees
        // IMPORTANT: Use prev (existing data) to preserve all calculated values (signed, due, contribution, etc.)
        // Only update salary-related fields
        if (salaryDataMap.size > 0) {
          setDepartmentData(prev => {
            const updated = new Map(prev); // Use prev to preserve existing calculations
            updated.forEach((deptData, deptName) => {
              const updatedEmployees = deptData.employees.map(emp => {
                const salaryData = salaryDataMap.get(emp.employeeId);
                if (salaryData) {
                  const updatedEmp = {
                    ...emp, // Preserve all existing fields (signed, due, contribution, etc.)
                    salaryBrutto: salaryData.salaryBrutto,
                    totalSalaryCost: salaryData.totalSalaryCost,
                    // Recalculate maxIncentives with new salary data
                    maxIncentives: (emp.salaryBudget ?? 0) - salaryData.totalSalaryCost,
                  };


                  updatedEmp.contributionFixed = includeFixedContributionRef.current
                    ? resolveContributionFixed({
                        departmentName: deptName,
                        salaryBrutto: updatedEmp.salaryBrutto || 0,
                        useFixedFromDb: useFixedFromDbCached,
                        fixedFromDb: fixedContributionFromDbMapCached.get(emp.employeeId),
                        hasFixedContributionAssignment: employeesWithFixedContribution.has(emp.employeeId),
                      })
                    : 0;

                  // Salary Budget = 40% of (Contribution + Contribution Fixed)
                  updatedEmp.salaryBudget = computeSalaryBudget(
                    updatedEmp.contribution || 0,
                    updatedEmp.contributionFixed || 0
                  );


                  // Recalculate maxIncentives with updated salaryBudget
                  updatedEmp.maxIncentives = computeMaxIncentives(updatedEmp.salaryBudget ?? 0, updatedEmp.totalSalaryCost ?? 0);
                  return updatedEmp;
                }
                // Apply the same Fixed Contribution setting even when salary data is unavailable.
                const updatedEmp = { ...emp };


                updatedEmp.contributionFixed = includeFixedContributionRef.current
                  ? resolveContributionFixed({
                      departmentName: deptName,
                      salaryBrutto: updatedEmp.salaryBrutto || 0,
                      useFixedFromDb: useFixedFromDbCached,
                      fixedFromDb: fixedContributionFromDbMapCached.get(emp.employeeId),
                      hasFixedContributionAssignment: employeesWithFixedContribution.has(emp.employeeId),
                    })
                  : 0;

                // Salary Budget = 40% of (Contribution + Contribution Fixed)
                updatedEmp.salaryBudget = computeSalaryBudget(
                  updatedEmp.contribution || 0,
                  updatedEmp.contributionFixed || 0
                );

                return updatedEmp;
              });

              // Recalculate department totals (preserve existing totals, only update salary-related)
              const deptSalaryBrutto = updatedEmployees.reduce((sum, emp) => sum + (emp.salaryBrutto || 0), 0);
              const deptTotalSalaryCost = updatedEmployees.reduce((sum, emp) => sum + (emp.totalSalaryCost || 0), 0);
              const deptContributionFixed = updatedEmployees.reduce((sum, emp) => sum + (emp.contributionFixed || 0), 0);
              const deptSalaryBudget = updatedEmployees.reduce((sum, emp) => sum + (emp.salaryBudget || 0), 0);
              const deptMaxIncentives = updatedEmployees.reduce((sum, emp) => sum + (emp.maxIncentives ?? 0), 0);

              updated.set(deptName, {
                ...deptData,
                employees: updatedEmployees,
                totals: {
                  ...deptData.totals, // Preserve all existing totals (signed, due, contribution, etc.)
                  contributionFixed: deptContributionFixed,
                  salaryBrutto: deptSalaryBrutto,
                  totalSalaryCost: deptTotalSalaryCost,
                  salaryBudget: deptSalaryBudget,
                  maxIncentives: deptMaxIncentives,
                },
              });
            });
            return scaleDepartmentsToInvoicedIncome(updated, totalIncome || 0, departmentPercentages, {
              disableFixedContribution: !includeFixedContributionRef.current,
            });
          });
        }
        // If no salary data, don't update - keep existing data with all calculations intact
        if (salesContributionSearchSeqRef.current === searchSeq) {
          setLoading(false);
        }
      }
    } catch (error) {
      console.error('❌ Sales Contribution Report - Error:', error);
      toast.error('Failed to fetch sales contribution data');
      if (salesContributionSearchSeqRef.current === searchSeq) {
        setLoading(false);
      }
    }
  };

  // Helper function to normalize category text for matching - now uses utility
  const normalizeCategoryText = useCallback((text: string): string => {
    return normalizeCategoryTextUtil(text);
  }, []);

  // Helper function to find best matching category from map - now uses utility
  const findBestCategoryMatch = useCallback((categoryValue: string): any => {
    return findBestCategoryMatchUtil(categoryValue, categoryNameToDataMap);
  }, [categoryNameToDataMap]);

  // Helper function to resolve main category from lead - now uses utility
  const resolveMainCategory = (
    categoryValue?: string | null,
    categoryId?: string | number | null,
    miscCategory?: any,
    allCategoriesParam?: any[],
    categoryNameToDataMapParam?: Map<string, any>
  ): string => {
    // Use provided params or fall back to component state
    const categoriesToUse = allCategoriesParam || allCategories;
    const mapToUse = categoryNameToDataMapParam || categoryNameToDataMap;

    return resolveMainCategoryUtil(
      categoryValue,
      categoryId,
      miscCategory,
      categoriesToUse,
      mapToUse
    );
  };

  // Pre-process leads to ensure all categories are correctly mapped - now uses utility
  const preprocessLeadsCategories = useCallback((leads: any[], isLegacy: boolean = false): any[] => {
    return preprocessLeadsCategoriesUtil(leads, isLegacy, allCategories, categoryNameToDataMap, categoriesLoaded);
  }, [allCategories, categoryNameToDataMap, categoriesLoaded]);

  // Process data for field view (grouped by main category)

  // Restore last report from module memory when returning to this route (no refetch) if session filters match the snapshot.
  useLayoutEffect(() => {
    if (!searchPerformed) return;
    if (loading) return;
    if (departmentData.size > 0) return;
    if (scMemoryRestoreAttemptedRef.current) return;
    scMemoryRestoreAttemptedRef.current = true;

    const m = simpleContributionMemoryCache;
    const key = buildSimpleContributionCacheKey(
      filters,
      periodPreset,
      salaryFilter,
      dueNormalizedPercentage,
      includeFixedContribution
    );
    if (!m || m.key !== key) {
      setSearchPerformed(false);
      return;
    }
    setDepartmentData(new Map(m.departmentData));
    setTotalIncome(m.totalIncome);
    setTotalSignedValue(m.totalSignedValue);
    totalIncomeRef.current = m.totalIncome;
    totalSignedValueRef.current = m.totalSignedValue;
    setEmployeeMap(new Map(m.employeeMap));
  }, [
    searchPerformed,
    loading,
    departmentData,
    setSearchPerformed,
    filters,
    periodPreset,
    salaryFilter,
    dueNormalizedPercentage,
    includeFixedContribution,
  ]);

  // When a report search finishes, snapshot it for route remounts in this tab.
  useEffect(() => {
    if (scPrevLoadingForScCacheRef.current && !loading) {
      if (searchPerformed) {
        simpleContributionMemoryCache = {
          key: buildSimpleContributionCacheKey(
            filters,
            periodPreset,
            salaryFilter,
            dueNormalizedPercentage,
            includeFixedContribution
          ),
          departmentData: new Map(departmentData),
          totalIncome,
          totalSignedValue,
          employeeMap: new Map(employeeMap),
        };
      }
    }
    scPrevLoadingForScCacheRef.current = loading;
  }, [
    loading,
    searchPerformed,
    departmentData,
    totalIncome,
    totalSignedValue,
    employeeMap,
    filters,
    periodPreset,
    salaryFilter,
    dueNormalizedPercentage,
    includeFixedContribution,
  ]);

  // Handler for starting to edit percentage
  const handleStartEditPercentage = (departmentName: string) => {
    const currentPercentage = departmentPercentages.get(departmentName) || 0;
    setEditingPercentage(departmentName);
    setTempPercentage(currentPercentage.toString());
  };

  // Handler for canceling edit
  const handleCancelEditPercentage = () => {
    setEditingPercentage(null);
    setTempPercentage('');
  };

  // Handler for saving percentage (individual)
  const handleSavePercentage = async (departmentName: string) => {
    const numValue = Number(tempPercentage);
    if (isNaN(numValue) || numValue < 0 || numValue > 100) {
      toast.error('Please enter a valid percentage between 0 and 100');
      return;
    }

    try {
      // Get current user for tracking
      const { data: { user } } = await supabase.auth.getUser();
      const userId = user?.id || null;

      // Save to database immediately
      const { error } = await supabase
        .from('sales_contribution_settings')
        .upsert({
          department_name: departmentName,
          percentage: numValue,
          updated_at: new Date().toISOString(),
          updated_by: userId,
        }, {
          onConflict: 'department_name'
        });

      if (error) {
        console.error(`Error saving percentage for ${departmentName}:`, error);
        console.error('Error details:', JSON.stringify(error, null, 2));
        toast.error(`Failed to save percentage: ${error.message || 'Unknown error'}`);
        return;
      }

      // Update local state only after successful database save
      const newPercentages = new Map(departmentPercentages);
      newPercentages.set(departmentName, numValue);
      setDepartmentPercentages(newPercentages);
      setEditingPercentage(null);
      setTempPercentage('');
      toast.success(`Percentage for ${departmentName} saved`);
    } catch (error: any) {
      console.error('Error saving percentage:', error);
      toast.error(`Failed to save percentage: ${error.message || 'Unknown error'}`);
    }
  };

  const scrollToDepartmentTable = (departmentName: string) => {
    document
      .getElementById(`contribution-table-${departmentName.toLowerCase()}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Render summary box with percentage and edit functionality; includes total salary budget (from total row) and total cost from table
  const renderSummaryBox = (departmentName: string, icon: React.ReactNode, accentClasses: string) => {
    const deptData = departmentData.get(departmentName);
    const deptTotal = deptData?.totals?.total || 0;
    const percentage = departmentPercentages.get(departmentName) || 0;
    const isEditing = editingPercentage === departmentName;
    // Summary cards always show full-department totals, even when employee rows are filtered.
    const totalCost =
      deptData?.employees
        .reduce((s, emp) => s + (emp.totalSalaryCost ?? 0), 0) ?? 0;

    const monthlyIncome = (totalIncome || 0) / summaryMonthlyDivisor;
    const baseAmount = monthlyIncome * 0.4;
    const summaryAmount = baseAmount * (percentage / 100);

    const directAmountFromIncome = totalIncome && totalIncome > 0 ? (percentage / 100) * monthlyIncome : 0;

    return (
      <div
        className={`${accentClasses} min-w-0 cursor-pointer rounded-2xl p-5 text-white shadow-xl transition-all duration-300 hover:scale-[1.02] hover:shadow-2xl`}
        role="link"
        tabIndex={0}
        aria-label={`Scroll to ${departmentName} table`}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('button, input')) return;
          scrollToDepartmentTable(departmentName);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            scrollToDepartmentTable(departmentName);
          }
        }}
      >
        <div className="flex min-h-9 items-start justify-between gap-2">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-base font-semibold text-white/90">{departmentName}</span>
            <span className="shrink-0 text-sm font-bold tabular-nums text-white">
              {formatCurrency(directAmountFromIncome)}
            </span>
          </div>
          {isEditing ? (
            <div className="flex shrink-0 items-center gap-1">
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={tempPercentage}
                onChange={(e) => setTempPercentage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSavePercentage(departmentName);
                  if (e.key === 'Escape') handleCancelEditPercentage();
                }}
                className="h-7 w-16 rounded-lg border border-white/50 bg-white/20 px-2 text-xs font-semibold text-white outline-none placeholder:text-white/60 focus:ring-2 focus:ring-white/50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                autoFocus
              />
              <button onClick={() => handleSavePercentage(departmentName)} className="rounded-md p-1 hover:bg-white/20" title="Save percentage">
                <CheckIcon className="h-4 w-4" />
              </button>
              <button onClick={handleCancelEditPercentage} className="rounded-md p-1 hover:bg-white/20" title="Cancel">
                <XMarkIcon className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="flex shrink-0 items-center overflow-hidden rounded-md bg-white/20">
              <span className="px-2.5 py-1.5 text-sm font-semibold tabular-nums">
                {percentage % 1 === 0 ? percentage.toFixed(0) : percentage.toFixed(2)}%
              </span>
              <button onClick={() => handleStartEditPercentage(departmentName)} className="self-stretch border-l border-white/20 px-2 hover:bg-white/20" title="Edit percentage">
                <PencilIcon className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>

        <div className="relative mt-3 flex min-h-14 items-center justify-center">
          <div className="min-w-0 max-w-[calc(100%-4.5rem)] text-center">
            <div className="truncate text-3xl font-bold tabular-nums" title={formatCurrency(summaryAmount)}>
              {formatCurrency(summaryAmount)}
            </div>
          </div>
          <div className="absolute right-0 shrink-0 rounded-full bg-white/20 p-3.5">
            {icon}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-white/20 pt-3">
          <div className="min-w-0">
            <div className="text-[11px] text-white/70">Salary budget</div>
            <div className="truncate text-sm font-semibold tabular-nums" title={formatCurrency(summaryAmount)}>
              {formatCurrency(summaryAmount)}
            </div>
          </div>
          <div className="min-w-0 border-l border-white/20 pl-3">
            <div className="text-[11px] text-white/70">Total cost</div>
            <div className="truncate text-sm font-semibold tabular-nums" title={formatCurrency(totalCost)}>
              {formatCurrency(totalCost)}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Helper function to wrap icon in white circle with 3D shadow effect
  const wrapIconInCircle = (icon: React.ReactNode): React.ReactNode => {
    return (
      <div className="flex items-center justify-center w-12 h-12 rounded-full bg-white shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1),0_2px_4px_-1px_rgba(0,0,0,0.06),0_0_0_1px_rgba(0,0,0,0.05),inset_0_1px_0_0_rgba(255,255,255,0.1)]">
        {icon}
      </div>
    );
  };

  // Get icon for main category
  // Function to get a unique icon for each field/category
  const getCategoryIcon = (categoryName: string): React.ReactNode => {
    const name = categoryName.toLowerCase().trim();

    // Exact field name matching - each field gets its own unique icon
    if (name === 'immigration israel') {
      return wrapIconInCircle(<HomeIcon className="w-6 h-6 text-blue-500" />);
    }
    if (name === 'germany & austria') {
      return wrapIconInCircle(<GlobeAltIcon className="w-6 h-6 text-blue-500" />);
    }
    if (name === 'small without meetin') {
      return wrapIconInCircle(<DocumentTextIcon className="w-6 h-6 text-green-500" />);
    }
    if (name === 'usa') {
      return wrapIconInCircle(<ShieldCheckIcon className="w-6 h-6 text-blue-500" />);
    }
    if (name === 'damages') {
      return wrapIconInCircle(<ExclamationTriangleIcon className="w-6 h-6 text-red-500" />);
    }
    if (name === 'commer/civil/adm/fam' || name === 'commer\\civil\\adm\\fam') {
      return wrapIconInCircle(<ScaleIcon className="w-6 h-6 text-purple-500" />);
    }
    if (name === 'other citizenships') {
      return wrapIconInCircle(<RocketLaunchIcon className="w-6 h-6 text-indigo-500" />);
    }
    if (name === 'poland') {
      return wrapIconInCircle(<MapPinIcon className="w-6 h-6 text-red-500" />);
    }
    if (name === 'german\\austrian' || name === 'german/austrian') {
      return wrapIconInCircle(<GlobeAltIcon className="w-6 h-6 text-green-500" />);
    }
    if (name === 'referral commission') {
      return wrapIconInCircle(<CurrencyDollarIcon className="w-6 h-6 text-yellow-500" />);
    }

    // Fallback for other categories (using pattern matching)
    // General category - grid icon
    if (name === 'general') {
      return wrapIconInCircle(<Squares2X2Icon className="w-6 h-6 text-gray-500" />);
    }

    // Staff Meeting gets a special icon
    if (name.includes('staff')) {
      return wrapIconInCircle(<UsersIcon className="w-6 h-6 text-blue-500" />);
    }

    // Legal-related categories
    if (name.includes('legal') || name.includes('law') || name.includes('attorney')) {
      return wrapIconInCircle(<ScaleIcon className="w-6 h-6 text-blue-500" />);
    }

    // Business/Corporate categories
    if (name.includes('business') || name.includes('corporate') || name.includes('commercial')) {
      return wrapIconInCircle(<BriefcaseIcon className="w-6 h-6 text-purple-500" />);
    }

    // HR/Personnel categories
    if (name.includes('hr') || name.includes('human') || name.includes('personnel')) {
      return wrapIconInCircle(<UserGroupIcon className="w-6 h-6 text-blue-500" />);
    }

    // Finance/Accounting categories
    if (name.includes('finance') || name.includes('accounting') || name.includes('financial') || name.includes('money')) {
      return wrapIconInCircle(<BanknotesIcon className="w-6 h-6 text-green-500" />);
    }

    // Marketing categories
    if (name.includes('marketing') || name.includes('sales') || name.includes('advertising')) {
      return wrapIconInCircle(<ChartBarIcon className="w-6 h-6 text-blue-500" />);
    }

    // IT/Technology categories
    if (name.includes('it') || name.includes('technology') || name.includes('tech') || name.includes('computer')) {
      return wrapIconInCircle(<CogIcon className="w-6 h-6 text-gray-500" />);
    }

    // Education/Training categories
    if (name.includes('education') || name.includes('training') || name.includes('learning') || name.includes('academy')) {
      return wrapIconInCircle(<AcademicCapIcon className="w-6 h-6 text-blue-500" />);
    }

    // Healthcare/Medical categories
    if (name.includes('health') || name.includes('medical') || name.includes('healthcare') || name.includes('clinic')) {
      return wrapIconInCircle(<HeartIcon className="w-6 h-6 text-red-500" />);
    }

    // Real Estate categories
    if (name.includes('real estate') || name.includes('property') || name.includes('housing')) {
      return wrapIconInCircle(<HomeIcon className="w-6 h-6 text-blue-500" />);
    }

    // Security categories
    if (name.includes('security') || name.includes('safety') || name.includes('protection')) {
      return wrapIconInCircle(<ShieldCheckIcon className="w-6 h-6 text-blue-500" />);
    }

    // Operations categories
    if (name.includes('operations') || name.includes('operational') || name.includes('management')) {
      return wrapIconInCircle(<WrenchScrewdriverIcon className="w-6 h-6 text-gray-500" />);
    }

    // Documentation/Administration categories
    if (name.includes('admin') || name.includes('administration') || name.includes('document') || name.includes('paperwork')) {
      return wrapIconInCircle(<ClipboardDocumentListIcon className="w-6 h-6 text-gray-500" />);
    }

    // Unassigned/Uncategorized
    if (name.includes('unassigned') || name.includes('unknown') || name.includes('uncategorized') || name.includes('other')) {
      return wrapIconInCircle(<ExclamationTriangleIcon className="w-6 h-6 text-gray-500" />);
    }

    // Default icon for any other category
    return wrapIconInCircle(<BuildingOfficeIcon className="w-6 h-6 text-purple-500" />);
  };

  const getDepartmentTableIcon = (departmentName: string) => {
    const iconClass = 'h-6 w-6 text-white';
    switch (departmentName) {
      case 'Sales':
        return <ChartBarIcon className={iconClass} />;
      case 'Handlers':
        return <UserGroupIcon className={iconClass} />;
      case 'Partners':
        return <BuildingOfficeIcon className={iconClass} />;
      case 'Marketing':
        return <SpeakerWaveIcon className={iconClass} />;
      case 'Finance':
        return <CurrencyDollarIcon className={iconClass} />;
      default:
        return <BuildingOfficeIcon className={iconClass} />;
    }
  };

  const getDepartmentTableIconGradient = (departmentName: string) => {
    switch (departmentName) {
      case 'Sales':
        return 'bg-gradient-to-tr from-pink-500 via-rose-500 to-orange-500';
      case 'Handlers':
        return 'bg-gradient-to-tr from-purple-600 via-indigo-600 to-blue-500';
      case 'Partners':
        return 'bg-gradient-to-tr from-sky-600 via-cyan-500 to-blue-500';
      case 'Marketing':
        return 'bg-gradient-to-tr from-teal-600 via-emerald-500 to-green-500';
      case 'Finance':
        return 'bg-gradient-to-tr from-amber-500 via-orange-500 to-yellow-500';
      default:
        return 'bg-gradient-to-tr from-purple-600 via-indigo-600 to-blue-500';
    }
  };

  const renderTable = (deptData: DepartmentData) => {
    const colSpanValue = 10;

    const renderSignedWithNormTooltip = (signed: number, signedNormalized: number) => (
      <span
        className="tooltip tooltip-top cursor-help"
        data-tip={`Signed norm: ${formatCurrency(scalePeriodSum(signedNormalized || 0))}`}
      >
        {formatCurrency(scalePeriodSum(signed))}
      </span>
    );

    const renderDueWithNormTooltip = (due: number, dueNormalized: number) => (
      <span
        className="tooltip tooltip-top cursor-help"
        data-tip={`Due norm: ${formatCurrency(scalePeriodSum(dueNormalized || 0))}`}
      >
        {formatCurrency(scalePeriodSum(due || 0))}
      </span>
    );

    const getEmployeeMaxIncentivesDisplay = (emp: EmployeeData) =>
      scalePeriodSum(emp.salaryBudget ?? 0) - (emp.totalSalaryCost ?? 0);

    const getPositiveMaxIncentiveBadgeProps = (emp: EmployeeData) => {
      const maxIncentives = getEmployeeMaxIncentivesDisplay(emp);
      if (maxIncentives <= 0) {
        return { showPositiveMaxIncentiveBadge: false as const, maxIncentivesTooltip: undefined };
      }
      return {
        showPositiveMaxIncentiveBadge: true as const,
        maxIncentivesTooltip: `Max incentives: ${formatCurrency(maxIncentives)}`,
      };
    };

    const salaryColumnCaption =
      periodPreset !== 'custom' ? (
        <div className="text-xs font-normal text-gray-500 mt-1">
          Avg. last {getPresetMonthCount(periodPreset)} mo
        </div>
      ) : salaryFilter?.month && salaryFilter?.year ? (
        <div className="text-xs font-normal text-gray-500 mt-1">
          {new Date(2000, (salaryFilter.month || 1) - 1, 1).toLocaleString('default', { month: 'short' })} {salaryFilter.year}
        </div>
      ) : null;

    const departmentPercentage = departmentPercentages.get(deptData.departmentName) || 0;
    /** Multi-month presets: period totals (signed, contribution, etc.) ÷ months; salary B / total cost stay monthly from DB. */
    const periodScale = periodPreset === 'custom' ? 1 : summaryMonthlyDivisor;
    const scalePeriodSum = (n: number) => (Number(n) || 0) / periodScale;

    const filteredEmployeesForCorrection = deptData.employees.filter(employeeMatchesRowFilters);

    // Plain sums of the displayed rows. This report has no cross-department reallocation, so an
    // employee's contribution is counted once, in their own department table.
    const totalRowContribution = filteredEmployeesForCorrection.reduce(
      (s, emp) => s + (emp.contribution ?? 0),
      0
    );
    const totalRowContributionFixed = filteredEmployeesForCorrection.reduce(
      (s, emp) => s + (emp.contributionFixed ?? 0),
      0
    );
    const contributionAmountBase =
      totalIncome && totalIncome > 0 ? (departmentPercentage / 100) * totalIncome : 0;
    const contributionAmount = scalePeriodSum(contributionAmountBase);
    // Sum of row salary budgets (matches the department summary hero).
    const totalRowSalaryBudget = roundContributionMoney(
      filteredEmployeesForCorrection.reduce((s, emp) => s + (emp.salaryBudget ?? 0), 0)
    );
    const totalSalaryCostDisplayed = filteredEmployeesForCorrection.reduce(
      (s, emp) => s + (emp.totalSalaryCost ?? 0),
      0
    );
    const totalMaxIncentivesDisplayed =
      scalePeriodSum(totalRowSalaryBudget) - totalSalaryCostDisplayed;
    const totalSalaryBruttoDisplayed = filteredEmployeesForCorrection.reduce(
      (s, emp) => s + (emp.salaryBrutto ?? 0),
      0
    );
    // Denominator for the Salary (B) / Total Cost percentages.
    const contributionTotalScaledForRow = scalePeriodSum(
      totalRowContribution + totalRowContributionFixed
    );

    return (
      <div
        id={`contribution-table-${deptData.departmentName.toLowerCase()}`}
        key={deptData.departmentName}
        className="mb-8 scroll-mt-20"
      >
        <div className="mb-3 flex flex-wrap items-center gap-3 px-1 text-2xl font-bold">
          <span className={`flex h-11 w-11 items-center justify-center rounded-full shadow-sm ${getDepartmentTableIconGradient(deptData.departmentName)}`}>
            {getDepartmentTableIcon(deptData.departmentName)}
          </span>
          <span>{deptData.departmentName}</span>
          {contributionAmount > 0 && (
            <span className="text-lg font-semibold text-green-800 dark:text-green-600 tabular-nums">
              {formatCurrency(contributionAmount)}
            </span>
          )}
        </div>
        {/* Mobile gets horizontal table scrolling; desktop keeps `.app-main-scroll` as the sticky
            header's scroll container. */}
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm md:overflow-visible">
        <table className="sc-contribution-table table w-full min-w-[800px] md:min-w-0 md:table-fixed [&_tbody_tr:last-child_td:first-child]:rounded-bl-2xl [&_tbody_tr:last-child_td:last-child]:rounded-br-2xl [&_thead_th:first-child]:rounded-tl-2xl [&_thead_th:last-child]:rounded-tr-2xl">
            <thead className={SC_TABLE_THEAD_STICKY}>
              <tr>
                {(
                  <>
                    <th className="w-[20%] text-xs md:text-sm whitespace-nowrap">Employee</th>
                    <th className="w-[12%] min-w-[100px] text-xs md:text-sm px-2">
                      <div className="whitespace-normal leading-tight">Department</div>
                    </th>
                    <th className="text-right w-[10%] text-xs md:text-sm whitespace-nowrap">Signed</th>
                    <th className="text-right w-[10%] text-xs md:text-sm whitespace-nowrap">Due</th>
                    <th className="text-right w-[10%] text-xs md:text-sm whitespace-nowrap">Contribution</th>
                    <th className="text-right w-[10%] text-xs md:text-sm whitespace-nowrap">C. Fixed</th>
                    <th className="text-right w-[10%] text-xs md:text-sm whitespace-nowrap">Salary Budget</th>
                    <th className="text-right w-[10%] text-xs md:text-sm whitespace-nowrap">
                      Salary (B)
                      {salaryColumnCaption}
                    </th>
                    <th className="text-right w-[10%] bg-gray-100 text-xs md:text-sm whitespace-nowrap">
                      Total Cost
                      {salaryColumnCaption}
                    </th>
                    <th className="text-right w-[10%] text-xs md:text-sm whitespace-nowrap">Incentives</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {deptData.employees
                .filter(employeeMatchesRowFilters)
                .map((emp) => {
                  const employeeKey = `${emp.employeeId}`;

                  return (
                    <React.Fragment key={emp.employeeId}>
                      <tr
                        className="cursor-pointer hover:bg-base-200"
                        onClick={() => {
                          setModalEmployeeId(emp.employeeId);
                          setModalEmployeeName(emp.employeeName);
                          setModalRole('ALL');
                          setModalOpen(true);
                        }}
                      >
                        {(
                          <>
                            <td className="w-[20%] text-xs md:text-sm align-top text-left whitespace-normal">
                              {(() => {
                                const maxIncentiveBadgeProps = getPositiveMaxIncentiveBadgeProps(emp);
                                return (
                                  <div className="flex items-center gap-1 md:gap-2 whitespace-nowrap min-w-0">
                                    <div className="flex-shrink-0">
                                      <EmployeeAvatar employeeId={emp.employeeId} size="lg" {...maxIncentiveBadgeProps} />
                                    </div>
                                    <span className="truncate max-w-[80px] md:max-w-none text-xs md:text-sm">{emp.employeeName}</span>
                                  </div>
                                );
                              })()}
                            </td>
                            <td className="w-[12%] min-w-[100px] text-xs md:text-sm px-2 align-top py-2">
                              <div className="break-words leading-tight" style={{
                                wordBreak: 'break-word',
                                overflowWrap: 'break-word',
                                maxWidth: '100px',
                                lineHeight: '1.2',
                                hyphens: 'auto'
                              }}>
                                {emp.department}
                              </div>
                            </td>
                            <td className="text-right w-[10%] text-xs md:text-sm whitespace-nowrap">
                              {renderSignedWithNormTooltip(emp.signed, emp.signedNormalized || 0)}
                            </td>
                            <td className="text-right w-[10%] text-xs md:text-sm whitespace-nowrap">
                              {renderDueWithNormTooltip(emp.due || 0, emp.dueNormalized || 0)}
                            </td>
                            <td className="text-right w-[10%] text-xs md:text-sm whitespace-nowrap">
                              {formatCurrency(scalePeriodSum(emp.contribution ?? 0))}
                            </td>
                            <td className="text-right w-[10%] text-xs md:text-sm whitespace-nowrap">
                              {formatCurrency(scalePeriodSum(emp.contributionFixed ?? 0))}
                            </td>
                            <td className="text-right w-[10%] text-xs md:text-sm whitespace-nowrap">
                              <div className="flex flex-col items-end">
                                <span>{formatCurrency(scalePeriodSum(emp.salaryBudget || 0))}</span>
                                <span className="text-xs text-gray-500">40%</span>
                              </div>
                            </td>
                            <td className="text-right w-[10%] text-xs md:text-sm whitespace-nowrap">
                              <div className="flex flex-col items-end">
                                <span>{formatCurrency(emp.salaryBrutto || 0)}</span>
                                {(() => {
                                  // % = Salary (B) / (full variable + fixed). Full contribution is emp.contribution (headline
                                  // in the table); relocated is informational — do not shrink the denominator by relocation.
                                  const contributionTotalRaw = (emp.contribution || 0) + (emp.contributionFixed || 0);
                                  const contributionTotalDisplay = scalePeriodSum(contributionTotalRaw);
                                  return contributionTotalDisplay > 0 ? (
                                    <span className={`text-xs ${((emp.salaryBrutto || 0) / contributionTotalDisplay * 100) >= 100 ? 'text-red-500' : 'text-green-500'}`}>
                                      {((emp.salaryBrutto || 0) / contributionTotalDisplay * 100).toFixed(1)}%
                                    </span>
                                  ) : (
                                    <span className="text-xs text-gray-500">-</span>
                                  );
                                })()}
                              </div>
                            </td>
                            <td className="text-right w-[10%] bg-gray-100 text-xs md:text-sm whitespace-nowrap">
                              <div className="flex flex-col items-end">
                                <span>{formatCurrency(emp.totalSalaryCost || 0)}</span>
                                {(() => {
                                  const contributionTotalRaw = (emp.contribution || 0) + (emp.contributionFixed || 0);
                                  const contributionTotalDisplay = scalePeriodSum(contributionTotalRaw);
                                  return contributionTotalDisplay > 0 ? (
                                    <span className={`text-xs ${((emp.totalSalaryCost || 0) / contributionTotalDisplay * 100) >= 100 ? 'text-red-500' : 'text-green-500'}`}>
                                      {((emp.totalSalaryCost || 0) / contributionTotalDisplay * 100).toFixed(1)}%
                                    </span>
                                  ) : (
                                    <span className="text-xs text-gray-500">-</span>
                                  );
                                })()}
                              </div>
                            </td>
                            <td className="text-right w-[10%] text-xs md:text-sm whitespace-nowrap">
                              {(() => {
                                const maxIncentives = getEmployeeMaxIncentivesDisplay(emp);
                                return (
                                  <span className={maxIncentives >= 0 ? 'text-green-500' : 'text-red-500'}>
                                    {formatCurrency(maxIncentives)}
                                  </span>
                                );
                              })()}
                            </td>
                          </>
                        )}
                      </tr>
                    </React.Fragment>
                  );
                })}
              {deptData.employees.filter(employeeMatchesRowFilters).length === 0 && (
                  <tr>
                    <td colSpan={colSpanValue} className="text-center text-gray-500">
                      {employeeSearchTerm.trim() || filterTrophyBadgeEmployeesOnly
                        ? 'No employees found matching your filters'
                        : 'No employees found'}
                    </td>
                  </tr>
                )}
              {/* Totals row */}
              <tr className="font-bold bg-base-200">
                {(
                  <>
                    <td className="w-[25%] text-xs md:text-sm">Total</td>
                    <td className="w-[15%] text-xs md:text-sm"></td>
                    <td className="text-right w-[10%] text-xs md:text-sm"></td>
                    <td className="text-right w-[10%] text-xs md:text-sm"></td>
                    <td className="text-right w-[10%] text-xs md:text-sm">
                      {formatCurrency(scalePeriodSum(totalRowContribution))}
                    </td>
                    <td className="text-right w-[10%] text-xs md:text-sm">
                      {formatCurrency(scalePeriodSum(totalRowContributionFixed))}
                    </td>
                    <td className="text-right w-[10%] text-xs md:text-sm">
                      <div className="flex flex-col items-end">
                        <span>{formatCurrency(scalePeriodSum(totalRowSalaryBudget))}</span>
                        <span className="text-xs text-gray-500">40%</span>
                      </div>
                    </td>
                    <td className="text-right w-[10%] text-xs md:text-sm">
                      <div className="flex flex-col items-end">
                        <span>{formatCurrency(totalSalaryBruttoDisplayed)}</span>
                        {contributionTotalScaledForRow > 0 ? (
                          <span className={`text-xs ${(totalSalaryBruttoDisplayed / contributionTotalScaledForRow * 100) >= 100 ? 'text-red-500' : 'text-green-500'}`}>
                            {(totalSalaryBruttoDisplayed / contributionTotalScaledForRow * 100).toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-xs text-gray-500">-</span>
                        )}
                      </div>
                    </td>
                    <td className="text-right w-[10%] bg-gray-100 text-xs md:text-sm">
                      <div className="flex flex-col items-end">
                        <span>{formatCurrency(totalSalaryCostDisplayed)}</span>
                        {contributionTotalScaledForRow > 0 ? (
                          <span className={`text-xs ${(totalSalaryCostDisplayed / contributionTotalScaledForRow * 100) >= 100 ? 'text-red-500' : 'text-green-500'}`}>
                            {(totalSalaryCostDisplayed / contributionTotalScaledForRow * 100).toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-xs text-gray-500">-</span>
                        )}
                      </div>
                    </td>
                    <td className="text-right w-[10%] text-xs md:text-sm">
                      <span className={totalMaxIncentivesDisplayed >= 0 ? 'text-green-500' : 'text-red-500'}>
                        {formatCurrency(totalMaxIncentivesDisplayed)}
                      </span>
                    </td>
                  </>
                )}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="w-full min-h-[calc(100dvh-3.5rem)] bg-[#ececec] px-1 py-4 sm:px-2 md:px-4">
      <style>
        {CONTRIBUTION_TABLE_COLUMNS.map((column, index) =>
          visibleContributionColumns.includes(column.key)
            ? ''
            : `.sc-contribution-table th:nth-child(${index + 1}), .sc-contribution-table td:nth-child(${index + 1}) { display: none; }`
        ).join('\n')}
        {`
          @keyframes modalChartFlip {
            from { opacity: 0; transform: perspective(1200px) rotateY(8deg) scale(0.985); }
            to { opacity: 1; transform: perspective(1200px) rotateY(0deg) scale(1); }
          }
        `}
      </style>
      <div className="mb-2">
        {/* Row 1: Title top left, toggle + 3 buttons on the same line */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl md:text-3xl font-bold">Contribution profitability</h1>
            <button
              type="button"
              onClick={() => setIsCorrectionInfoModalOpen(true)}
              className="btn btn-ghost btn-sm btn-circle"
              title="Contribution correction amounts explained"
              aria-label="Contribution correction amounts explained"
            >
              <InformationCircleIcon className="w-6 h-6 text-primary" />
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-4 md:gap-6">
            <div className="flex items-center gap-2">
              <button
                onClick={() => navigate('/reports')}
                className="btn btn-ghost btn-sm gap-1.5"
              >
                <ArrowLeftIcon className="h-4 w-4" />
                Back
              </button>
              <button
                type="button"
                onClick={() => setIsFiltersOpen((open) => !open)}
                className={`btn btn-md gap-2 rounded-full ${isFiltersOpen ? 'btn-primary' : 'btn-ghost'}`}
                aria-expanded={isFiltersOpen}
                aria-controls="contribution-report-filters"
              >
                <FunnelIcon className="h-5 w-5" />
                Filters
              </button>
              <button
                type="button"
                className={`btn btn-md gap-2 rounded-full ${mainProgressGraphsVisible.salesSigned ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setMainProgressGraphsVisible((current) => ({ ...current, salesSigned: !current.salesSigned }))}
                title="Toggle Sales signed graph"
              >
                <ChartBarIcon className="h-5 w-5" />
                Sales
              </button>
              <button
                type="button"
                className={`btn btn-md gap-2 rounded-full ${mainProgressGraphsVisible.handlersDue ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setMainProgressGraphsVisible((current) => ({ ...current, handlersDue: !current.handlersDue }))}
                title="Toggle Handlers due/invoiced graph"
              >
                <UserGroupIcon className="h-5 w-5" />
                Handlers
              </button>
              {isFiltersOpen && (
                <>
                  <button
                    onClick={async () => {
                      await fetchRolePercentages();
                      setIsDynamicIslandOpen(true);
                    }}
                    className="btn btn-ghost btn-md btn-circle"
                    title="Open Dynamic Island"
                  >
                    <Squares2X2Icon className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => setIsFixedContributionModalOpen(true)}
                    className="btn btn-ghost btn-md btn-circle"
                    title="Fixed contribution per employee by department role"
                  >
                    <CurrencyDollarIcon className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => setIsDepartmentRolesModalOpen(true)}
                    className="btn btn-ghost btn-md btn-circle"
                    title="Assign or move employees between department roles"
                  >
                    <UserGroupIcon className="w-5 h-5" />
                  </button>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <div ref={columnSettingsRef} className="relative">
                <button
                  type="button"
                  onClick={() => setIsColumnSettingsOpen((open) => !open)}
                  className={`btn btn-md btn-circle ${isColumnSettingsOpen ? 'btn-primary' : 'btn-ghost'}`}
                  title="Choose visible columns"
                  aria-label="Choose visible columns"
                  aria-expanded={isColumnSettingsOpen}
                >
                  <CogIcon className="h-7 w-7" />
                </button>
                {isColumnSettingsOpen && (
                  <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-2xl border border-base-300 bg-white p-3 text-base-content shadow-xl">
                    <div className="mb-2 flex items-center justify-between px-1">
                      <span className="text-sm font-semibold">Table columns</span>
                      <button
                        type="button"
                        className="text-xs font-medium text-primary hover:underline"
                        onClick={() => setVisibleContributionColumns(CONTRIBUTION_TABLE_COLUMNS.map((column) => column.key))}
                      >
                        Show all
                      </button>
                    </div>
                    <label className="mb-3 flex cursor-pointer items-center justify-between gap-3 rounded-xl bg-base-200 px-3 py-2.5">
                      <div>
                        <div className="text-sm font-medium">Fixed contribution</div>
                        <div className="text-[11px] text-base-content/55">
                          {includeFixedContribution ? 'Included in calculations' : 'Excluded from calculations'}
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        className="toggle toggle-primary toggle-sm"
                        checked={includeFixedContribution}
                        onChange={(event) => {
                          const enabled = event.target.checked;
                          includeFixedContributionRef.current = enabled;
                          setIncludeFixedContribution(enabled);
                          if (searchPerformed) {
                            void handleSearch();
                          }
                        }}
                      />
                    </label>
                    <div className="space-y-1">
                      {CONTRIBUTION_TABLE_COLUMNS.map((column) => {
                        const checked = visibleContributionColumns.includes(column.key);
                        return (
                          <label key={column.key} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-base-200">
                            <input
                              type="checkbox"
                              className="checkbox checkbox-primary checkbox-sm"
                              checked={checked}
                              onChange={() => {
                                setVisibleContributionColumns((current) =>
                                  checked
                                    ? current.filter((key) => key !== column.key)
                                    : [...current, column.key]
                                );
                              }}
                            />
                            <span>{column.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Row 2: KPI badges — only after user runs Search (same data as report) */}
        {searchPerformed && !loading && !isCalculating && (
        <div className="relative my-5 flex flex-col items-start gap-3 lg:block">
          {isFiltersOpen && (
            <div className="flex items-end gap-3 lg:absolute lg:left-0 lg:top-1/2 lg:-translate-y-1/2">
              <div className="relative w-40 pt-2 focus-within:z-10">
                <span className="pointer-events-none absolute left-3 top-2 z-20 -translate-y-1/2 bg-[#ececec] px-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                  Report period
                </span>
                <select
                  className="select select-bordered select-sm w-full rounded-xl border-gray-300 bg-[#ececec] shadow-sm transition-shadow focus:shadow-md"
                  value={periodPreset}
                  onChange={(e) => handlePeriodPresetChange(e.target.value as SalesContributionPeriodPreset)}
                >
                  <option value="custom">Custom</option>
                  <option value="last3months">Last 3 months</option>
                  <option value="last6months">Last 6 months</option>
                  <option value="last12months">One year</option>
                </select>
              </div>
              <label className="flex cursor-pointer items-center gap-2 pb-1" title="Show employees with positive max incentives only">
                <TrophyIcon className="h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
                <input
                  type="checkbox"
                  className="toggle toggle-sm toggle-warning"
                  checked={filterTrophyBadgeEmployeesOnly}
                  onChange={(e) => setFilterTrophyBadgeEmployeesOnly(e.target.checked)}
                  aria-label="Show employees with positive max incentives only"
                />
              </label>
            </div>
          )}
        <div className="mx-auto grid w-full max-w-full grid-cols-2 overflow-hidden rounded-[2rem] bg-white shadow-sm md:flex md:w-fit">
          <div className="flex min-w-0 flex-col items-center gap-0.5 px-3 py-3 md:min-w-[170px] md:px-5">
            <div className="flex flex-col items-center">
              <span className="text-sm font-medium text-gray-500">Total signed</span>
              {periodPreset !== 'custom' && (
                <span className="text-xs text-gray-400">avg. per month</span>
              )}
            </div>
            <div className="text-center">
              {loadingSignedValue ? (
                <span className="loading loading-spinner loading-sm text-primary"></span>
              ) : (
                <span className="font-semibold text-gray-900 text-lg">{formatCurrency(displaySummaryTotalSigned)}</span>
              )}
            </div>
          </div>
          <div className="flex min-w-0 flex-col items-center gap-0.5 border-l border-gray-200 px-3 py-3 md:min-w-[170px] md:px-5">
            <div className="flex flex-col items-center">
              <span className="text-sm font-medium text-gray-500">Total income</span>
              {periodPreset !== 'custom' && (
                <span className="text-xs text-gray-400">avg. per month</span>
              )}
            </div>
            <div className="text-center">
              {loadingInvoicedIncome ? (
                <span className="loading loading-spinner loading-sm text-primary"></span>
              ) : (
                <span className="font-semibold text-gray-900 text-lg">{formatCurrency(displaySummaryTotalIncome)}</span>
              )}
            </div>
          </div>
          <div className="flex min-w-0 flex-col items-center gap-0.5 border-t border-gray-200 px-3 py-3 md:min-w-[190px] md:border-l md:border-t-0 md:px-5">
            <div className="flex items-center gap-1.5">
              <div className="flex flex-col items-center">
                <span className="text-sm font-medium text-gray-500">Total salary budget</span>
                {periodPreset !== 'custom' && (
                  <span className="text-xs text-gray-400">avg. per month</span>
                )}
              </div>
              {displaySummaryTotalIncome > 0 && (
                <span className="badge badge-sm bg-sky-500/90 text-white border-0">
                  {((displaySummarySalaryBudget / displaySummaryTotalIncome) * 100).toFixed(1)}%
                </span>
              )}
            </div>
            <div className="text-center">
              <span className="font-semibold text-gray-900 text-lg">{formatCurrency(displaySummarySalaryBudget)}</span>
            </div>
          </div>
          <div className="flex min-w-0 flex-col items-center gap-0.5 border-l border-t border-gray-200 px-3 py-3 md:min-w-[170px] md:border-t-0 md:px-5">
            <div className="flex items-center gap-1.5">
              <div className="flex flex-col items-center">
                <span className="text-sm font-medium text-gray-500">Total cost</span>
                {periodPreset !== 'custom' && (
                  <span className="text-xs text-gray-400">avg. per month</span>
                )}
              </div>
              {displaySummaryTotalIncome > 0 && (
                <span className="badge badge-sm bg-amber-500/90 text-white border-0">
                  {((displaySummaryTotalCost / displaySummaryTotalIncome) * 100).toFixed(1)}%
                </span>
              )}
            </div>
            <div className="text-center">
              <span className="font-semibold text-gray-900 text-lg">{formatCurrency(displaySummaryTotalCost)}</span>
            </div>
          </div>
        </div>
        </div>
        )}
      </div>

      {/* Fixed contribution modal */}
      <FixedContributionModal
        isOpen={isFixedContributionModalOpen}
        onClose={() => setIsFixedContributionModalOpen(false)}
        formatCurrency={formatCurrency}
        useFixedContributionFromDb={useFixedContributionFromDb}
        onSettingChange={async () => {
          const { data: row } = await supabase
            .from('sales_contribution_use_fixed_from_db')
            .select('use_fixed_contribution_from_db')
            .eq('id', 1)
            .maybeSingle();
          setUseFixedContributionFromDb(!!row?.use_fixed_contribution_from_db);
        }}
      />

      <EmployeeDepartmentRolesModal
        isOpen={isDepartmentRolesModalOpen}
        onClose={() => setIsDepartmentRolesModalOpen(false)}
      />

      {/* Correction amounts explanation modal */}
      <dialog open={isCorrectionInfoModalOpen} className="modal">
        <div className="modal-box max-w-lg">
          <div className="flex items-start gap-3">
            <InformationCircleIcon className="w-6 h-6 text-primary flex-shrink-0 mt-0.5" aria-hidden />
            <div className="text-sm text-base-content/90">
              <h3 className="font-semibold text-base-content mb-2">Contribution column — correction amounts</h3>
              <ul className="list-disc list-inside space-y-1">
                <li><span className="text-green-600 dark:text-green-400 font-medium">Green (+amount)</span> — added so the table total matches the department target when the sum of rows is below target.</li>
                <li><span className="text-red-600 dark:text-red-400 font-medium">Red (−amount)</span> — deducted so the total matches the target when the sum of rows is above target.</li>
                <li>Hover the contribution amount when a relocation applies — part of this employee’s contribution was reallocated to the Sales or Handlers link modal; the total row already reflects this.</li>
                <li>Hover the contribution fixed amount when a reallocation applies — fixed contribution moved to or from Marketing / Sales link modals (employee rows show deductions; Marketing total shows amounts added from the link).</li>
              </ul>
              <p className="mt-3 text-base-content/70">The main number in each row is the original contribution; the total row shows the actual total after corrections and reallocations.</p>
            </div>
          </div>
          <div className="modal-action">
            <button type="button" className="btn btn-primary" onClick={() => setIsCorrectionInfoModalOpen(false)}>Close</button>
          </div>
        </div>
        <form method="dialog" className="modal-backdrop" onClick={() => setIsCorrectionInfoModalOpen(false)}>
          <button type="submit">close</button>
        </form>
      </dialog>

      {/* Dynamic Island Modal */}
      <DynamicIsland
        isOpen={isDynamicIslandOpen}
        onClose={() => setIsDynamicIslandOpen(false)}
        incomeReadOnly
        totalIncome={totalIncome}
        setTotalIncome={setTotalIncome}
        dueNormalizedPercentage={dueNormalizedPercentage}
        setDueNormalizedPercentage={setDueNormalizedPercentage}
        totalSignedValue={totalSignedValue}
        loadingSignedValue={loadingSignedValue}
        formatCurrency={formatCurrency}
        rolePercentages={rolePercentages}
        setRolePercentages={setRolePercentages}
        tempRolePercentages={tempRolePercentages}
        setTempRolePercentages={setTempRolePercentages}
        onSaveSettings={saveSettings}
        onSaveRolePercentages={saveRolePercentages}
        savingSettings={savingSettings}
        savingRolePercentages={savingRolePercentages}
        loadingRolePercentages={loadingRolePercentages}
        fetchRolePercentages={fetchRolePercentages}
      />

      {/* Filters are collapsed by default to keep the report header compact. */}
      {isFiltersOpen && (
      <div
        id="contribution-report-filters"
        className={(isReportScrolled || forceBottomFilters)
          ? 'fixed inset-x-0 bottom-0 z-[120] border-t border-base-300 bg-[#ececec] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-12px_35px_rgba(0,0,0,0.14)]'
          : 'mb-5'}
        data-filters-section
      >
        {(isReportScrolled || forceBottomFilters) && (
          <button
            type="button"
            className="btn btn-ghost btn-circle btn-sm absolute right-3 top-2"
            onClick={() => {
              setIsFiltersOpen(false);
              setForceBottomFilters(false);
            }}
            aria-label="Close report filters"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        )}
        {/* No card-body padding, so the filter labels line up with the page title above. */}
        <div className="flex flex-col gap-2 pb-2">
          {(!searchPerformed || isReportScrolled || forceBottomFilters) && (
          <div className="mb-3 mr-auto flex w-full max-w-[700px] flex-col items-start gap-1 md:mb-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="relative w-40 pt-2 focus-within:z-10">
                <span className="pointer-events-none absolute left-3 top-2 z-20 -translate-y-1/2 bg-[#ececec] px-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                  Report period
                </span>
                <select
                  className="select select-bordered select-sm w-full rounded-xl border-gray-300 bg-[#ececec] shadow-sm transition-shadow focus:shadow-md md:select-md md:text-base"
                  value={periodPreset}
                  onChange={(e) => handlePeriodPresetChange(e.target.value as SalesContributionPeriodPreset)}
                >
                  <option value="custom">Custom</option>
                  <option value="last3months">Last 3 months</option>
                  <option value="last6months">Last 6 months</option>
                  <option value="last12months">One year</option>
                </select>
              </div>
              {(
                <label
                  className="flex items-center gap-2 cursor-pointer pb-0.5"
                  title="Show employees with positive max incentives only"
                >
                  <TrophyIcon className="h-4 w-4 text-amber-500 shrink-0" aria-hidden="true" />
                  <input
                    type="checkbox"
                    className="toggle toggle-sm toggle-warning"
                    checked={filterTrophyBadgeEmployeesOnly}
                    onChange={(e) => setFilterTrophyBadgeEmployeesOnly(e.target.checked)}
                    aria-label="Show employees with positive max incentives only"
                  />
                </label>
              )}
            </div>
            {periodFiltersLocked && (
              <p className="text-xs text-base-content/60 mt-1">
                From / To dates and salary month/year follow this preset. Switch to Custom to edit them.
              </p>
            )}
          </div>
          )}
          <div className="flex flex-wrap items-end gap-3 md:gap-4">
            {/* From Date - Mobile: 2 cols, Desktop: 1 col */}
            <div className="relative w-[calc(50%-0.375rem)] pt-2 focus-within:z-10 sm:w-40">
              <span className="pointer-events-none absolute left-3 top-2 z-20 -translate-y-1/2 bg-[#ececec] px-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                From Date
              </span>
              <input
                type="date"
                className={`input input-bordered input-sm w-full rounded-xl border-gray-300 bg-[#ececec] shadow-sm transition-shadow focus:shadow-md md:input-md md:text-base ${periodFiltersLocked ? 'opacity-60 cursor-not-allowed' : ''}`}
                value={filters.fromDate}
                onChange={(e) => handleFilterChange('fromDate', e.target.value)}
                disabled={periodFiltersLocked}
              />
            </div>
            {/* To Date - Mobile: 2 cols, Desktop: 1 col */}
            <div className="relative w-[calc(50%-0.375rem)] pt-2 focus-within:z-10 sm:w-40">
              <span className="pointer-events-none absolute left-3 top-2 z-20 -translate-y-1/2 bg-[#ececec] px-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                To Date
              </span>
              <input
                type="date"
                className={`input input-bordered input-sm w-full rounded-xl border-gray-300 bg-[#ececec] shadow-sm transition-shadow focus:shadow-md md:input-md md:text-base ${periodFiltersLocked ? 'opacity-60 cursor-not-allowed' : ''}`}
                value={filters.toDate}
                onChange={(e) => handleFilterChange('toDate', e.target.value)}
                disabled={periodFiltersLocked}
              />
            </div>
            {/* Salary Month - Mobile: 2 cols, Desktop: 1 col */}
            <div className="relative w-[calc(50%-0.375rem)] pt-2 focus-within:z-10 sm:w-36">
              <span className="pointer-events-none absolute left-3 top-2 z-20 -translate-y-1/2 bg-[#ececec] px-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                Salary Month
              </span>
              <select
                className={`select select-bordered select-sm w-full rounded-xl border-gray-300 bg-[#ececec] shadow-sm transition-shadow focus:shadow-md md:select-md md:text-base ${periodFiltersLocked ? 'opacity-60 cursor-not-allowed' : ''}`}
                value={salaryFilter?.month || previousMonth}
                onChange={(e) => setSalaryFilter({
                  ...salaryFilter,
                  month: parseInt(e.target.value, 10)
                })}
                disabled={periodFiltersLocked}
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
                  <option key={month} value={month}>
                    {new Date(2000, month - 1, 1).toLocaleString('default', { month: 'short' })}
                  </option>
                ))}
              </select>
            </div>
            {/* Salary Year - Mobile: 2 cols, Desktop: 1 col */}
            <div className="relative w-[calc(50%-0.375rem)] pt-2 focus-within:z-10 sm:w-36">
              <span className="pointer-events-none absolute left-3 top-2 z-20 -translate-y-1/2 bg-[#ececec] px-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                Salary Year
              </span>
              <select
                className={`select select-bordered select-sm w-full rounded-xl border-gray-300 bg-[#ececec] shadow-sm transition-shadow focus:shadow-md md:select-md md:text-base ${periodFiltersLocked ? 'opacity-60 cursor-not-allowed' : ''}`}
                value={salaryFilter?.year || previousYear}
                onChange={(e) => setSalaryFilter({
                  ...salaryFilter,
                  year: parseInt(e.target.value, 10)
                })}
                disabled={periodFiltersLocked}
              >
                {Array.from({ length: 10 }, (_, i) => today.getFullYear() - 5 + i).map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>
            {/* Employee search and action stay together at every screen size. */}
            <div className="ml-auto flex w-full items-end justify-end gap-2 sm:w-auto">
              <div className="relative w-full max-w-[240px] pt-2 focus-within:z-10">
                <span className="pointer-events-none absolute left-4 top-2 z-20 -translate-y-1/2 bg-[#ececec] px-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                  Search Employee
                </span>
                <input
                  type="text"
                  className="input input-bordered input-sm w-full rounded-full border-gray-300 bg-[#ececec] py-2 pl-5 pr-10 shadow-sm transition-shadow focus:shadow-md md:input-md md:text-base"
                  placeholder="Search..."
                  value={employeeSearchTerm}
                  onChange={(e) => setEmployeeSearchTerm(e.target.value)}
                />
                {employeeSearchTerm && (
                  <button
                    type="button"
                    className="absolute right-3 top-[calc(50%+0.25rem)] flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-gray-400 hover:bg-black/5 hover:text-gray-700"
                    onClick={() => setEmployeeSearchTerm('')}
                    aria-label="Clear employee search"
                  >
                    <XMarkIcon className="h-4 w-4" />
                  </button>
                )}
              </div>
              <button
                className="btn btn-primary btn-circle btn-sm shrink-0 md:btn-md"
                onClick={() => {
                  setIsFiltersOpen(false);
                  setForceBottomFilters(false);
                  void handleSearch();
                }}
                disabled={loading}
                title="Search"
              >
                {loading ? (
                  <span className="loading loading-spinner loading-xs"></span>
                ) : (
                  <MagnifyingGlassIcon className="w-4 h-4 md:w-5 md:h-5" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
      )}

      {!isFiltersOpen && (
        <div className="fixed bottom-4 right-4 z-[110] flex max-w-[calc(100vw-2rem)] items-center gap-2">
          <div className="relative min-w-0">
            <input
              type="text"
              className="h-12 min-w-0 w-52 rounded-full border border-base-300 bg-white py-2 pl-5 pr-11 text-sm shadow-xl outline-none placeholder:text-gray-400 focus:border-primary sm:w-64"
              placeholder="Search employee…"
              value={employeeSearchTerm}
              onChange={(event) => setEmployeeSearchTerm(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !loading) void handleSearch();
              }}
              aria-label="Search employee"
            />
            {employeeSearchTerm ? (
              <button
                type="button"
                className="absolute right-3 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                onClick={() => setEmployeeSearchTerm('')}
                aria-label="Clear employee search"
              >
                <XMarkIcon className="h-4 w-4" />
              </button>
            ) : (
              <MagnifyingGlassIcon className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" aria-hidden="true" />
            )}
          </div>
          <button
            type="button"
            className="btn btn-circle btn-md shrink-0 bg-white shadow-xl"
            onClick={() => {
              setForceBottomFilters(true);
              setIsFiltersOpen(true);
            }}
            aria-label="Open report filters"
            title="Filters"
          >
            <FunnelIcon className="h-5 w-5" />
          </button>
        </div>
      )}

      {searchPerformed && ((loading || isCalculating) ? (
        <div className="flex min-h-[55vh] flex-col gap-8" role="status" aria-label="Loading report">
          <div className="flex flex-col items-center justify-center gap-4 pt-8">
            <div className="relative flex h-20 w-20 items-center justify-center" aria-hidden="true">
              <div className="absolute inset-1 animate-pulse rounded-full bg-primary/20 blur-xl" />
              <div className="absolute inset-0 animate-spin rounded-full border-[4px] border-primary/15 border-r-violet-500 border-t-primary shadow-[0_0_20px_rgba(79,70,229,0.18)]" />
              <div
                className="absolute inset-2 animate-spin rounded-full border-2 border-cyan-400/20 border-b-cyan-500 border-l-transparent"
                style={{ animationDirection: 'reverse', animationDuration: '1.35s' }}
              />
              <ChartBarIcon className="relative h-8 w-8 text-primary drop-shadow-sm" />
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold text-base-content">Building contribution report</p>
              <p className="mt-1 text-sm text-base-content/55">Calculating totals, graphs, and employee data…</p>
            </div>
          </div>

          <div className="animate-pulse space-y-5" aria-hidden="true">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="h-40 rounded-2xl bg-white/65 shadow-sm" />
              ))}
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="h-72 rounded-2xl bg-white/65 shadow-sm" />
              <div className="h-72 rounded-2xl bg-white/65 shadow-sm" />
            </div>
            <div className="h-64 rounded-2xl bg-white/65 shadow-sm" />
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Summary Boxes - Rendered immediately, independent of table loading (employee view only) */}
          {(
            <div className="mb-8 grid w-full grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
              {/* Sales */}
              {renderSummaryBox(
                'Sales',
                <ChartBarIcon className="h-8 w-8" />,
                'bg-gradient-to-tr from-pink-500 via-rose-500 to-orange-500'
              )}

              {/* Handlers */}
              {renderSummaryBox(
                'Handlers',
                <UserGroupIcon className="h-8 w-8" />,
                'bg-gradient-to-tr from-purple-600 via-indigo-600 to-blue-500'
              )}

              {/* Partners */}
              {renderSummaryBox(
                'Partners',
                <BuildingOfficeIcon className="h-8 w-8" />,
                'bg-gradient-to-tr from-sky-600 via-cyan-500 to-blue-500'
              )}

              {/* Marketing */}
              {renderSummaryBox(
                'Marketing',
                <SpeakerWaveIcon className="h-8 w-8" />,
                'bg-gradient-to-tr from-teal-600 via-emerald-500 to-green-500'
              )}

              {/* Finance */}
              {renderSummaryBox(
                'Finance',
                <CurrencyDollarIcon className="h-8 w-8" />,
                'bg-gradient-to-tr from-amber-500 via-orange-500 to-yellow-500'
              )}
            </div>
          )}

          {(mainProgressGraphsVisible.salesSigned || mainProgressGraphsVisible.handlersDue) && (
            <div className="grid w-full gap-4 lg:grid-cols-2">
              {([
                { key: 'salesSigned' as const, title: 'Sales — signed progress', color: '#e11d48' },
                { key: 'handlersDue' as const, title: 'Handlers — due/invoiced progress', color: '#4f46e5' },
              ]).map((graph) => mainProgressGraphsVisible[graph.key] && (
                <section key={graph.key} className="w-full animate-[modalChartFlip_450ms_ease-out] overflow-hidden rounded-2xl bg-white py-5 shadow-sm [transform-style:preserve-3d]">
                  <div className="mb-3 flex items-start justify-between gap-3 px-5">
                    <div>
                      <h2 className="text-lg font-semibold text-base-content">{graph.title}</h2>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm btn-circle shrink-0"
                      aria-label={`Close ${graph.title}`}
                      onClick={() => setMainProgressGraphsVisible((current) => ({ ...current, [graph.key]: false }))}
                    >
                      <XMarkIcon className="h-5 w-5" />
                    </button>
                  </div>
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={mainProgressDailyData[graph.key]} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id={`main-progress-fill-${graph.key}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={graph.color} stopOpacity={0.32} />
                            <stop offset="95%" stopColor={graph.color} stopOpacity={0.03} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                        <XAxis
                          dataKey="date"
                          tick={({ x, y, payload }: any) => (
                            <text x={x} y={y + 12} textAnchor="middle" fontSize={11}>
                              <tspan fill="#374151">{formatContributionGraphDate(payload.value)}</tspan>
                              <tspan fill={graph.color}>{` ${formatContributionGraphWeekday(payload.value)}`}</tspan>
                            </text>
                          )}
                        />
                        <YAxis tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} tick={{ fontSize: 11 }} width={45} />
                        <Tooltip
                          labelFormatter={(value) =>
                            `${formatContributionGraphDate(String(value))} · ${formatContributionGraphWeekday(String(value))}`
                          }
                          formatter={(value: number) => [formatCurrency(value), 'Daily total']}
                        />
                        <Area
                          type="monotone"
                          dataKey="total"
                          stroke={graph.color}
                          strokeWidth={3}
                          fill={`url(#main-progress-fill-${graph.key})`}
                          dot={{ r: 3, strokeWidth: 2, fill: '#fff' }}
                          activeDot={{ r: 5 }}
                          animationDuration={700}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </section>
              ))}
            </div>
          )}

          {/* Department tables */}
          <>
            {departmentNames
              .filter(deptName => {
                const deptData = departmentData.get(deptName);
                if (!deptData) return false;

                // If filters are active, only show departments with matching employees
                if (employeeSearchTerm.trim() || filterTrophyBadgeEmployeesOnly) {
                  return deptData.employees.some(employeeMatchesRowFilters);
                }
                // If no filters, show all departments
                return true;
              })
              .map(deptName => {
                const deptData = departmentData.get(deptName);
                if (deptData) {
                  return renderTable(deptData);
                }
                return null;
              })}
            <div className="mt-2 rounded-2xl border border-gray-200 bg-white shadow-sm p-4 md:p-5 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-base-content">Total — all departments</p>
                <p className="text-xs text-base-content/70 mt-0.5">Σ Contribution + Contribution fixed</p>
                {periodPreset !== 'custom' && (
                  <p className="text-xs text-base-content/50 mt-1.5">Period total ÷ {summaryMonthlyDivisor} (avg. per month)</p>
                )}
              </div>
              <p className="text-2xl font-bold text-primary tabular-nums sm:text-right">
                {formatCurrency(
                  totalStoredContributionAndFixed /
                    (periodPreset === 'custom' ? 1 : summaryMonthlyDivisor)
                )}
              </p>
            </div>
          </>
        </div>
      ))}

      {!searchPerformed && (
        <p className="text-center text-base-content/70 py-4">
          Please select date range and click Search to view the report
        </p>
      )}

      {/* Employee Role Leads Modal */}
      {modalEmployeeId && (
        <EmployeeRoleLeadsModal
          isOpen={modalOpen}
          onClose={() => {
            setModalOpen(false);
            setModalEmployeeId(null);
            setModalEmployeeName('');
            setModalRole('');
          }}
          employeeId={modalEmployeeId}
          employeeName={modalEmployeeName}
          role={modalRole}
          fromDate={filters.fromDate}
          toDate={filters.toDate}
        />
      )}

      {/* Employee Field Assignments Modal */}
      {selectedEmployeeForModal && (
        <EmployeeFieldAssignmentsModal
          isOpen={fieldAssignmentsModalOpen}
          onClose={() => {
            setFieldAssignmentsModalOpen(false);
            setSelectedEmployeeForModal(null);
          }}
          employeeId={selectedEmployeeForModal.id}
          employeeName={selectedEmployeeForModal.name}
          employeePhotoUrl={selectedEmployeeForModal.photoUrl}
          onSave={() => {
            // Field assignments only affect the field report, which this page does not render.
          }}
        />
      )}

      {/* Dynamic Tab - Fixed when scrolled */}
      <DynamicTab
        incomeReadOnly
        totalIncome={totalIncome}
        setTotalIncome={setTotalIncome}
        dueNormalizedPercentage={dueNormalizedPercentage}
        setDueNormalizedPercentage={setDueNormalizedPercentage}
        rolePercentages={rolePercentages}
        setRolePercentages={setRolePercentages}
        tempRolePercentages={tempRolePercentages}
        setTempRolePercentages={setTempRolePercentages}
        onSaveSettings={saveSettings}
        onSaveRolePercentages={saveRolePercentages}
        savingSettings={savingSettings}
        savingRolePercentages={savingRolePercentages}
        loadingRolePercentages={loadingRolePercentages}
        fetchRolePercentages={fetchRolePercentages}
        isDynamicIslandOpen={isDynamicIslandOpen}
      />
    </div>
  );
};

export default SimpleContributionReportPage;
