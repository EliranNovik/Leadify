import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ChevronDownIcon,
  ClipboardDocumentListIcon,
  FunnelIcon,
  CurrencyDollarIcon,
  FireIcon,
  InboxArrowDownIcon,
  WalletIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import {
  GradientSummaryCard,
  REPORT_SUMMARY_GRADIENTS,
} from '../components/reports/GradientSummaryCard';
import LeadCostInsights from '../components/reports/LeadCostInsights';
import ReportLoadingScreen from '../components/reports/ReportLoadingScreen';
import DepartmentHourTotals from '../components/reports/DepartmentHourTotals';
import EmployeeCostCarousel from '../components/reports/EmployeeCostCarousel';
import {
  ReportSortableTh,
  compareNullableNumbers,
  toggleReportSort,
  type ReportSortDir,
} from '../components/reports/ReportSortableTh';
import {
  buildLeadManagementDetailPath,
  fetchLeadsManagementReport,
  peekLeadsManagementReport,
  peekLeadsManagementSuperUser,
  rememberLeadsManagementSuperUser,
  subscribeLeadsManagementReport,
  formatAllocationCostNis,
  formatAllocationWorkedDuration,
  leadMatchesEmployeeQuery,
  leadMatchesSearchQuery,
  leadRowForDateRange,
  type LeadManagementLeadRow,
} from '../lib/leadsManagementReport';
import {
  getSalaryEmployeeInitials,
  salaryAvatarGradientStyle,
} from '../lib/employeeSalaries';
import { supabase } from '../lib/supabase';
import { getJerusalemTodayIsoDate } from '../lib/employeeLeadReporting';
import {
  agreementDepartmentOptions,
  combinedGermanAustrian,
  displayAgreementDepartment,
} from '../lib/employeeDepartmentTotals';
import { fetchAgreementScoreboardDepartments } from '../lib/scoreboardDepartments';
import {
  buildCategoryNameToDataMap,
  canonicalizeScoreboardDepartment,
  fetchCategoriesWithDepartments,
  resolveCategoryAndDepartment,
} from '../lib/resolveCategoryDepartment';
import {
  confirmBudgetRequestReview,
  LeadBudgetRequestReviewModal,
  LeadBudgetRequestsHistoryModal,
  latestPendingReason,
  type LeadBudgetRequestReviewResult,
} from '../components/LeadBudgetRequestsHistoryModal';
import type { LeadBudgetExtensionRequest } from '../lib/leadBudgetExtensionRequests';
import {
  fetchEmployeeRolesOnLead,
  getLeadRoleIcon,
  type LeadEmployeeRole,
} from '../lib/leadEmployeeRoles';

function BudgetBar({
  utilizationPercent,
  exceedsCap,
  requestCount,
  onOpenRequests,
}: {
  utilizationPercent: number;
  exceedsCap: boolean;
  requestCount: number;
  onOpenRequests: () => void;
}) {
  const width = Math.min(100, Math.max(0, utilizationPercent));
  return (
    <button
      type="button"
      className="min-w-[8rem] text-left"
      onClick={(e) => {
        e.stopPropagation();
        onOpenRequests();
      }}
      title="View budget requests"
    >
      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
        <span className={exceedsCap ? 'font-semibold text-amber-700' : 'text-gray-500'}>
          {utilizationPercent.toFixed(utilizationPercent % 1 === 0 ? 0 : 1)}% of max
        </span>
        {requestCount > 0 ? (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold leading-none text-white">
            {requestCount}
          </span>
        ) : null}
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-gray-100">
        <div
          className={`h-full rounded-full transition-all ${
            exceedsCap ? 'bg-amber-500' : width >= 85 ? 'bg-amber-400' : 'bg-emerald-500'
          }`}
          style={{ width: `${width}%` }}
        />
      </div>
    </button>
  );
}

function EmployeeStack({
  employees,
  onEmployeeClick,
}: {
  employees: LeadManagementLeadRow['employees'];
  onEmployeeClick: (employee: LeadManagementLeadRow['employees'][number]) => void;
}) {
  if (employees.length === 0) return <span className="text-sm text-gray-400">—</span>;
  const shown = employees.slice(0, 4);
  const rest = employees.length - shown.length;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex -space-x-2">
        {shown.map((emp) =>
          emp.photoUrl ? (
            <button
              key={emp.employeeId}
              type="button"
              title={`${emp.employeeName} — view roles`}
              className="relative h-8 w-8 overflow-hidden rounded-full transition hover:z-10 hover:ring-2 hover:ring-primary/40"
              onClick={(e) => {
                e.stopPropagation();
                onEmployeeClick(emp);
              }}
            >
              <img src={emp.photoUrl} alt="" className="h-full w-full object-cover" />
            </button>
          ) : (
            <button
              key={emp.employeeId}
              type="button"
              title={`${emp.employeeName} — view roles`}
              className="relative flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-bold text-white transition hover:z-10 hover:ring-2 hover:ring-primary/40"
              style={salaryAvatarGradientStyle(emp.employeeId, emp.employeeName)}
              onClick={(e) => {
                e.stopPropagation();
                onEmployeeClick(emp);
              }}
            >
              {getSalaryEmployeeInitials(emp.employeeName)}
            </button>
          ),
        )}
        {rest > 0 ? (
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 text-[10px] font-semibold text-gray-600">
            +{rest}
          </span>
        ) : null}
      </div>
      <p className="flex max-w-[16rem] flex-wrap gap-x-2 gap-y-1 text-xs text-gray-500">
        {employees.map((emp) => (
          <span key={emp.employeeId} className="inline-flex items-center gap-1">
            <span className="truncate">{emp.employeeName}</span>
            {emp.missingSalary ? (
              <span className="shrink-0 rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">
                No salary
              </span>
            ) : null}
          </span>
        ))}
      </p>
    </div>
  );
}

type BudgetBand = '' | 'under50' | 'mid' | 'near' | 'over' | 'nocap';

type AgreementCatalog = {
  targets: { id: number; name: string }[];
  categories: any[];
  nameMap: Map<string, any>;
};

function agreementDepartmentForLead(row: LeadManagementLeadRow, catalog: AgreementCatalog | null): string {
  const combined = combinedGermanAustrian(catalog?.targets || []);
  const lookup =
    row.mainCategory && row.subcategory
      ? `${row.mainCategory} > ${row.subcategory}`
      : row.subcategory || row.mainCategory || row.category || '';
  if (!catalog || !lookup) return combined;
  const resolved = canonicalizeScoreboardDepartment(
    resolveCategoryAndDepartment(lookup, null, null, catalog.categories, catalog.nameMap),
    catalog.targets,
  );
  const name = displayAgreementDepartment(resolved.departmentName, catalog.targets);
  if (!name || resolved.departmentName === 'Other') return combined;
  return name;
}

function shiftIsoDate(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(y, (m || 1) - 1, (d || 1) + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function defaultLeadDateRange(): { from: string; to: string } {
  const to = getJerusalemTodayIsoDate();
  return { from: shiftIsoDate(to, -29), to };
}

type LeadDateMode = 'period' | 'all' | 'today';

function dateButtonClass(active: boolean): string {
  return active
    ? 'inline-flex h-10 items-center rounded-[14px] bg-primary px-3.5 text-sm font-semibold text-white shadow-sm'
    : 'inline-flex h-10 items-center rounded-[14px] bg-white px-3.5 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-gray-200 transition-colors hover:bg-gray-50';
}

function matchesBudgetBand(row: LeadManagementLeadRow, band: BudgetBand): boolean {
  if (!band) return true;
  const hasCap = row.maxAllowedCostNis > 0;
  if (band === 'nocap') return !hasCap;
  if (band === 'over') return hasCap && row.exceedsCap;
  if (!hasCap || row.exceedsCap) return false;
  if (band === 'under50') return row.utilizationPercent < 50;
  if (band === 'mid') return row.utilizationPercent >= 50 && row.utilizationPercent < 80;
  return row.utilizationPercent >= 80;
}

const LeadsManagementReportPage: React.FC = () => {
  const navigate = useNavigate();
  const knownSuperUser = peekLeadsManagementSuperUser();
  const [isSuperUser, setIsSuperUser] = useState(knownSuperUser === true);
  const [permissionsLoaded, setPermissionsLoaded] = useState(knownSuperUser != null);
  const [leadSearch, setLeadSearch] = useState('');
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [dateMode, setDateMode] = useState<LeadDateMode>('period');
  const [dateToolsOpen, setDateToolsOpen] = useState(false);
  const [rangeFrom, setRangeFrom] = useState(() => defaultLeadDateRange().from);
  const [rangeTo, setRangeTo] = useState(() => defaultLeadDateRange().to);
  const [department, setDepartment] = useState('');
  const [budgetBand, setBudgetBand] = useState<BudgetBand>('');
  const [overBudgetOnly, setOverBudgetOnly] = useState(false);
  const [pendingRequestsOnly, setPendingRequestsOnly] = useState(false);
  const [missingBalanceOnly, setMissingBalanceOnly] = useState(false);
  const [missingSalaryOnly, setMissingSalaryOnly] = useState(false);
  const [sortKey, setSortKey] = useState<'time' | 'cost' | 'max' | null>(null);
  const [sortDir, setSortDir] = useState<ReportSortDir>('desc');
  const cachedRows = peekLeadsManagementReport();
  const [loading, setLoading] = useState(cachedRows == null);
  const [rows, setRows] = useState<LeadManagementLeadRow[]>(cachedRows ?? []);
  const [historyRow, setHistoryRow] = useState<LeadManagementLeadRow | null>(null);
  const [reasonPreview, setReasonPreview] = useState<{
    reason: string;
    employeeName?: string;
    leadLabel?: string;
  } | null>(null);
  const [reviewRequest, setReviewRequest] = useState<LeadBudgetExtensionRequest | null>(null);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [agreementCatalog, setAgreementCatalog] = useState<AgreementCatalog | null>(null);
  const [employeeRoleModal, setEmployeeRoleModal] = useState<{
    employee: LeadManagementLeadRow['employees'][number];
    lead: LeadManagementLeadRow;
    roles: LeadEmployeeRole[];
    loading: boolean;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user?.id) {
          if (!cancelled) {
            setIsSuperUser(false);
            setPermissionsLoaded(true);
          }
          return;
        }

        let { data: userData } = await supabase
          .from('users')
          .select('is_superuser')
          .eq('auth_id', user.id)
          .maybeSingle();

        if (!userData) {
          const { data: userByEmail } = await supabase
            .from('users')
            .select('is_superuser')
            .eq('email', user.email || '')
            .maybeSingle();
          userData = userByEmail;
        }

        const isSuper =
          userData?.is_superuser === true ||
          userData?.is_superuser === 'true' ||
          userData?.is_superuser === 1;

        rememberLeadsManagementSuperUser(Boolean(isSuper));
        if (!cancelled) {
          setIsSuperUser(Boolean(isSuper));
          setPermissionsLoaded(true);
          if (!isSuper) {
            toast.error('Access denied. This report is only available to superusers.');
            navigate('/reports');
          }
        }
      } catch (error) {
        console.error('[LeadsManagementReport] permission check failed:', error);
        if (!cancelled) {
          setIsSuperUser(false);
          setPermissionsLoaded(true);
          toast.error('Access denied. This report is only available to superusers.');
          navigate('/reports');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const load = useCallback(async (fresh = false) => {
    if (!isSuperUser) return;
    const cached = fresh ? null : peekLeadsManagementReport();
    const cacheMissingDays = (cached || []).some((row) => row.daySlices == null);
    if (cached) {
      setRows(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    try {
      const data = await fetchLeadsManagementReport({ fresh: fresh || cacheMissingDays });
      setRows(data);
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Failed to load leads management report');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [isSuperUser]);

  useEffect(() => {
    if (!permissionsLoaded || !isSuperUser) return;
    void load();
  }, [load, permissionsLoaded, isSuperUser]);

  useEffect(() => {
    if (!permissionsLoaded || !isSuperUser) return;
    return subscribeLeadsManagementReport((next) => {
      setRows(next);
    });
  }, [permissionsLoaded, isSuperUser]);

  const handleEmployeeClick = useCallback(
    async (
      employee: LeadManagementLeadRow['employees'][number],
      lead: LeadManagementLeadRow,
    ) => {
      setEmployeeRoleModal({ employee, lead, roles: [], loading: true });
      try {
        const roles = await fetchEmployeeRolesOnLead({
          employeeId: employee.employeeId,
          employeeName: employee.employeeName,
          leadType: lead.leadType,
          newLeadId: lead.newLeadId,
          legacyLeadId: lead.legacyLeadId,
          leadNumber: lead.leadNumber,
        });
        setEmployeeRoleModal({ employee, lead, roles, loading: false });
      } catch (error) {
        console.error(error);
        toast.error(error instanceof Error ? error.message : 'Failed to load employee roles');
        setEmployeeRoleModal({ employee, lead, roles: [], loading: false });
      }
    },
    [],
  );

  const handleReviewConfirm = useCallback(
    async (result: LeadBudgetRequestReviewResult) => {
      if (!reviewRequest) return;
      setReviewSubmitting(true);
      try {
        await confirmBudgetRequestReview({
          requestId: reviewRequest.id,
          decision: result.decision,
          reviewNote: result.reviewNote,
          approvedExtraCostNis: result.approvedExtraCostNis,
        });
        setReviewRequest(null);
        await load(true);
      } catch (error) {
        console.error(error);
        toast.error(error instanceof Error ? error.message : 'Failed to review request');
      } finally {
        setReviewSubmitting(false);
      }
    },
    [reviewRequest, load],
  );

  const departments = useMemo(() => {
    const preferred = agreementDepartmentOptions(agreementCatalog?.targets || []);
    const names = new Set(preferred);
    for (const row of rows) names.add(agreementDepartmentForLead(row, agreementCatalog));
    return [...names].sort((a, b) => {
      const ai = preferred.indexOf(a);
      const bi = preferred.indexOf(b);
      return (ai < 0 ? 1000 : ai) - (bi < 0 ? 1000 : bi) || a.localeCompare(b);
    });
  }, [rows, agreementCatalog]);

  const rangedRows = useMemo(() => {
    const ranged: LeadManagementLeadRow[] = [];
    for (const row of rows) {
      const next = leadRowForDateRange(row, rangeFrom, rangeTo);
      if (next) ranged.push(next);
    }
    return ranged;
  }, [rows, rangeFrom, rangeTo]);

  const filteredRows = useMemo(() => {
    const filtered = rangedRows.filter((row) => {
      if (department && agreementDepartmentForLead(row, agreementCatalog) !== department) return false;
      if (!matchesBudgetBand(row, budgetBand)) return false;
      if (!leadMatchesSearchQuery(row, leadSearch)) return false;
      if (!leadMatchesEmployeeQuery(row, employeeSearch)) return false;
      if (overBudgetOnly && !row.exceedsCap) return false;
      if (pendingRequestsOnly && row.pendingRequestCount <= 0) return false;
      if (missingBalanceOnly && !row.missingBalance) return false;
      if (missingSalaryOnly && !row.employees.some((emp) => emp.missingSalary)) return false;
      return true;
    });

    if (!sortKey) return filtered;

    return [...filtered].sort((a, b) => {
      if (sortKey === 'time') return compareNullableNumbers(a.workedMs, b.workedMs, sortDir);
      if (sortKey === 'cost') return compareNullableNumbers(a.costNis, b.costNis, sortDir);
      return compareNullableNumbers(a.maxAllowedCostNis, b.maxAllowedCostNis, sortDir);
    });
  }, [rangedRows, agreementCatalog, department, budgetBand, leadSearch, employeeSearch, overBudgetOnly, pendingRequestsOnly, missingBalanceOnly, missingSalaryOnly, sortKey, sortDir]);

  const handleSort = useCallback((key: string) => {
    const next = toggleReportSort(sortKey, sortDir, key);
    setSortKey(next.key as 'time' | 'cost' | 'max');
    setSortDir(next.dir);
  }, [sortKey, sortDir]);

  const totals = useMemo(() => {
    const scoped = rangedRows.filter((row) => {
      if (department && agreementDepartmentForLead(row, agreementCatalog) !== department) return false;
      if (!matchesBudgetBand(row, budgetBand)) return false;
      if (!leadMatchesSearchQuery(row, leadSearch)) return false;
      if (!leadMatchesEmployeeQuery(row, employeeSearch)) return false;
      return true;
    });
    const workedMs = filteredRows.reduce((sum, row) => sum + row.workedMs, 0);
    const costNis = Math.round(filteredRows.reduce((sum, row) => sum + row.costNis, 0) * 100) / 100;
    const overBudget = scoped.filter((row) => row.exceedsCap).length;
    const pendingRequests = scoped.reduce((sum, row) => sum + row.pendingRequestCount, 0);
    const missingBalance = scoped.filter((row) => row.missingBalance).length;
    const missingSalaryIds = new Set<number>();
    for (const row of scoped) {
      for (const emp of row.employees) {
        if (emp.missingSalary) missingSalaryIds.add(emp.employeeId);
      }
    }
    return {
      leadCount: filteredRows.length,
      workedMs,
      costNis,
      overBudget,
      pendingRequests,
      missingBalance,
      missingSalary: missingSalaryIds.size,
    };
  }, [filteredRows, rangedRows, agreementCatalog, department, budgetBand, leadSearch, employeeSearch]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetchAgreementScoreboardDepartments(),
      fetchCategoriesWithDepartments(supabase),
    ])
      .then(([targets, categories]) => {
        if (cancelled) return;
        setAgreementCatalog({
          targets,
          categories,
          nameMap: buildCategoryNameToDataMap(categories),
        });
      })
      .catch((error) => {
        console.error('[LeadsManagement] scoreboard departments failed:', error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const departmentTotals = useMemo(() => {
    const byName = new Map<string, { workedMs: number; costNis: number }>();
    for (const row of filteredRows) {
      const name = agreementDepartmentForLead(row, agreementCatalog);
      const current = byName.get(name) || { workedMs: 0, costNis: 0 };
      current.workedMs += row.workedMs;
      current.costNis += row.costNis;
      byName.set(name, current);
    }
    const order = agreementDepartmentOptions(agreementCatalog?.targets || []);
    return [...byName.entries()]
      .filter(([, value]) => value.workedMs > 0 || value.costNis > 0)
      .sort((a, b) => {
        const ai = order.indexOf(a[0]);
        const bi = order.indexOf(b[0]);
        return (ai < 0 ? 1000 : ai) - (bi < 0 ? 1000 : bi) || a[0].localeCompare(b[0]);
      })
      .map(([name, value]) => ({ name, workedMs: value.workedMs, costNis: value.costNis }));
  }, [filteredRows, agreementCatalog]);

  if (!permissionsLoaded || !isSuperUser) {
    return (
      <div className="flex min-h-[calc(100dvh-3.5rem)] items-center justify-center bg-[#ececec]">
        <ReportLoadingScreen title="Leads management" subtitle="Opening the report…" icon={ClipboardDocumentListIcon} />
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-[#ececec]">
      <div className="w-full px-4 py-6 md:px-8 md:py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-800"
              onClick={() => navigate('/reports')}
            >
              <ArrowLeftIcon className="h-4 w-4" />
              Reports
            </button>
            <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
              <ClipboardDocumentListIcon className="h-7 w-7 text-primary" />
              Leads management
            </h1>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            {(
              [
                ['Leads', String(totals.leadCount)],
                ['Time', formatAllocationWorkedDuration(totals.workedMs)],
                ['Cost', formatAllocationCostNis(totals.costNis)],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <p className="mb-1 px-1 text-xs font-semibold uppercase tracking-wider text-gray-500">{label}</p>
                <div className="min-w-[7.5rem] rounded-2xl bg-white px-4 py-2.5 shadow-sm ring-1 ring-gray-100">
                  <p className="text-lg font-bold tabular-nums text-gray-900">{value}</p>
                </div>
              </div>
            ))}
            <button
              type="button"
              className="mb-1 inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-gray-200 transition-colors hover:bg-gray-50"
              onClick={() => navigate('/reports/employee-lead-allocations')}
            >
              <ClipboardDocumentListIcon className="h-5 w-5 text-primary" />
              Hours allocation
              <ArrowRightIcon className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mb-4 flex flex-col gap-2">
          <span className="block text-xs font-semibold uppercase tracking-wider text-gray-500">Date</span>
          <div className="flex items-end gap-2">
            <div>
              {dateMode === 'today' ? (
                <input
                  type="date"
                  aria-label="Today"
                  className="report-date-input input h-10 min-h-10 rounded-[14px] border-0 bg-white px-3 ring-1 ring-gray-200"
                  value={rangeFrom}
                  max={getJerusalemTodayIsoDate()}
                  onChange={(event) => {
                    setRangeFrom(event.target.value);
                    setRangeTo(event.target.value);
                  }}
                />
              ) : dateMode === 'period' ? (
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    aria-label="From"
                    className="report-date-input input h-10 min-h-10 rounded-[14px] border-0 bg-white px-3 ring-1 ring-gray-200"
                    value={rangeFrom}
                    max={rangeTo || undefined}
                    onChange={(event) => setRangeFrom(event.target.value)}
                  />
                  <input
                    type="date"
                    aria-label="To"
                    className="report-date-input input h-10 min-h-10 rounded-[14px] border-0 bg-white px-3 ring-1 ring-gray-200"
                    value={rangeTo}
                    min={rangeFrom || undefined}
                    onChange={(event) => setRangeTo(event.target.value)}
                  />
                </div>
              ) : (
                <div className="flex h-10 min-w-[11rem] items-center rounded-[14px] bg-white px-3 text-sm text-gray-600 ring-1 ring-gray-200">
                  All reporting
                </div>
              )}
            </div>
            <button
              type="button"
              aria-expanded={dateToolsOpen}
              aria-label={dateToolsOpen ? 'Hide date filters' : 'Show date filters'}
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full shadow-sm ring-1 ring-gray-200 transition-colors ${
                dateToolsOpen ? 'bg-primary text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
              onClick={() => setDateToolsOpen((open) => !open)}
            >
              <FunnelIcon className="h-5 w-5" aria-hidden />
            </button>
          </div>
          {dateToolsOpen ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={dateButtonClass(dateMode === 'period')}
                onClick={() => {
                  const range = defaultLeadDateRange();
                  setDateMode('period');
                  setRangeFrom(range.from);
                  setRangeTo(range.to);
                }}
              >
                Period
              </button>
              <button
                type="button"
                className={dateButtonClass(dateMode === 'all')}
                onClick={() => {
                  setDateMode('all');
                  setRangeFrom('');
                  setRangeTo('');
                }}
              >
                Show all
              </button>
              <button
                type="button"
                className={dateButtonClass(dateMode === 'today')}
                onClick={() => {
                  const today = getJerusalemTodayIsoDate();
                  setDateMode('today');
                  setRangeFrom(today);
                  setRangeTo(today);
                }}
              >
                Today
              </button>
            </div>
          ) : null}
        </div>

        <div className="mb-5 flex items-end gap-3">
          <label className="block min-w-0 flex-1">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500">
              Lead / name
            </span>
            <div className="flex h-10 min-h-10 w-full items-center gap-2 rounded-lg border border-base-content/20 bg-base-100 px-3 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-base-content/20">
              <MagnifyingGlassIcon className="h-4 w-4 shrink-0 text-black" aria-hidden />
              <input
                type="search"
                className="h-full min-w-0 grow bg-transparent text-sm outline-none placeholder:text-gray-400"
                placeholder="Lead #, client, or contact…"
                value={leadSearch}
                onChange={(e) => setLeadSearch(e.target.value)}
              />
            </div>
          </label>
          <label className="block min-w-0 flex-1">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500">
              Employee
            </span>
            <div className="flex h-10 min-h-10 w-full items-center gap-2 rounded-lg border border-base-content/20 bg-base-100 px-3 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-base-content/20">
              <MagnifyingGlassIcon className="h-4 w-4 shrink-0 text-black" aria-hidden />
              <input
                type="search"
                className="h-full min-w-0 grow bg-transparent text-sm outline-none placeholder:text-gray-400"
                placeholder="Employee name…"
                value={employeeSearch}
                onChange={(e) => setEmployeeSearch(e.target.value)}
              />
            </div>
          </label>
          <label className="block min-w-0 flex-1">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500">
              Department
            </span>
            <span className="relative block">
              <select
                className="report-select select select-bordered select-sm h-10 min-h-10 w-full appearance-none bg-white pr-9"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
              >
                <option value="">All departments</option>
                {departments.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <ChevronDownIcon className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" aria-hidden />
            </span>
          </label>
          <label className="block min-w-0 flex-1">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500">
              Budget
            </span>
            <span className="relative block">
            <select
              className="report-select select select-bordered select-sm h-10 min-h-10 w-full appearance-none bg-white pr-9"
              value={budgetBand}
              onChange={(e) => setBudgetBand(e.target.value as BudgetBand)}
            >
              <option value="">Any budget</option>
              <option value="over">Over the cap</option>
              <option value="near">80–100% of the cap</option>
              <option value="mid">50–80% of the cap</option>
              <option value="under50">Under 50% of the cap</option>
              <option value="nocap">No cap</option>
            </select>
            <ChevronDownIcon className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" aria-hidden />
            </span>
          </label>
          {leadSearch || employeeSearch || rangeFrom !== defaultLeadDateRange().from || rangeTo !== defaultLeadDateRange().to || department || budgetBand || overBudgetOnly || pendingRequestsOnly || missingBalanceOnly || missingSalaryOnly ? (
            <button
                type="button"
                className="mb-2 shrink-0 text-sm font-medium text-gray-500 hover:text-gray-800"
                onClick={() => {
                  const range = defaultLeadDateRange();
                  setLeadSearch('');
                  setEmployeeSearch('');
                  setDateMode('period');
                  setRangeFrom(range.from);
                  setRangeTo(range.to);
                  setDepartment('');
                  setBudgetBand('');
                  setOverBudgetOnly(false);
                  setPendingRequestsOnly(false);
                  setMissingBalanceOnly(false);
                  setMissingSalaryOnly(false);
                }}
              >
                Clear filters
            </button>
          ) : null}
        </div>

        <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <GradientSummaryCard
            label={overBudgetOnly ? 'Over budget · on' : 'Over budget'}
            value={totals.overBudget}
            icon={FireIcon}
            iconClassName="h-9 w-9"
            gradientClassName={REPORT_SUMMARY_GRADIENTS[2]}
            active={overBudgetOnly}
            onClick={() => setOverBudgetOnly((prev) => !prev)}
          />
          <GradientSummaryCard
            label={pendingRequestsOnly ? 'Requests · on' : 'Requests'}
            value={totals.pendingRequests}
            icon={InboxArrowDownIcon}
            iconClassName="h-9 w-9"
            gradientClassName={REPORT_SUMMARY_GRADIENTS[0]}
            active={pendingRequestsOnly}
            onClick={() => setPendingRequestsOnly((prev) => !prev)}
          />
          <GradientSummaryCard
            label={missingBalanceOnly ? 'No balance · on' : 'No balance'}
            value={totals.missingBalance}
            icon={WalletIcon}
            iconClassName="h-9 w-9"
            gradientClassName={REPORT_SUMMARY_GRADIENTS[3]}
            active={missingBalanceOnly}
            onClick={() => setMissingBalanceOnly((prev) => !prev)}
          />
          <GradientSummaryCard
            label={missingSalaryOnly ? 'No salary · on' : 'No salary'}
            value={totals.missingSalary}
            icon={CurrencyDollarIcon}
            iconClassName="h-9 w-9"
            gradientClassName={REPORT_SUMMARY_GRADIENTS[4]}
            active={missingSalaryOnly}
            onClick={() => setMissingSalaryOnly((prev) => !prev)}
          />
        </div>

        {loading ? (
          <ReportLoadingScreen title="Loading leads" subtitle="Gathering costs and hours…" icon={ClipboardDocumentListIcon} />
        ) : (
          <>
        {departmentTotals.length > 0 ? (
          <section className="mb-5">
            <h2 className="mb-2 text-sm font-semibold text-gray-900">Department totals</h2>
            <DepartmentHourTotals totals={departmentTotals} carousel />
          </section>
        ) : null}

        <EmployeeCostCarousel
          rows={filteredRows}
          onOpen={(employeeId) => navigate(`/reports/leads-management/employees/${employeeId}`)}
        />

        <LeadCostInsights rows={filteredRows} />

        <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-100">
          {filteredRows.length === 0 ? (
            <div className="px-6 py-16 text-center text-sm text-gray-500">
              No leads with allocation data match these filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr className="border-b border-gray-100 text-xs uppercase tracking-wider text-gray-500">
                    <th>Lead</th>
                    <th>Main / subcategory</th>
                    <th>Employees</th>
                    <ReportSortableTh
                      label="Time"
                      sortKey="time"
                      activeKey={sortKey}
                      direction={sortDir}
                      onSort={handleSort}
                    />
                    <ReportSortableTh
                      label="Cost"
                      sortKey="cost"
                      activeKey={sortKey}
                      direction={sortDir}
                      onSort={handleSort}
                    />
                    <ReportSortableTh
                      label="Max"
                      sortKey="max"
                      activeKey={sortKey}
                      direction={sortDir}
                      onSort={handleSort}
                    />
                    <th>Budget</th>
                    <th>Request reason</th>
                    <th className="text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => {
                    const pending = row.budgetRequests.filter((r) => r.status === 'pending');
                    const pendingReason = latestPendingReason(row.budgetRequests);
                    return (
                      <tr
                        key={row.key}
                        className="cursor-pointer hover:bg-gray-50/90"
                        onClick={() => navigate(buildLeadManagementDetailPath(row))}
                      >
                        <td>
                          <div className="min-w-[12rem]">
                            <p className="font-semibold text-gray-900">{row.clientName}</p>
                            <p className="text-xs text-gray-500">#{row.leadNumber}</p>
                            {row.missingBalance ? (
                              <span className="mt-1 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                                No balance
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="text-sm text-gray-600">
                          {row.mainCategory || row.subcategory ? (
                            <div className="min-w-[10rem]">
                              <p className="font-medium text-gray-900">
                                {row.mainCategory || '—'}
                              </p>
                              <p className="text-xs text-gray-500">{row.subcategory || '—'}</p>
                            </div>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>
                          <EmployeeStack
                            employees={row.employees}
                            onEmployeeClick={(emp) => void handleEmployeeClick(emp, row)}
                          />
                        </td>
                        <td className="text-right text-sm font-medium text-gray-900">
                          {formatAllocationWorkedDuration(row.workedMs)}
                        </td>
                        <td className="text-right text-sm font-semibold text-gray-900">
                          {formatAllocationCostNis(row.costNis)}
                        </td>
                        <td className="text-right text-sm text-gray-500">
                          {formatAllocationCostNis(row.maxAllowedCostNis)}
                          {row.approvedExtensionCostNis > 0 ? (
                            <p className="text-[10px] text-emerald-600">
                              +{formatAllocationCostNis(row.approvedExtensionCostNis)} ext
                            </p>
                          ) : null}
                        </td>
                        <td>
                          <BudgetBar
                            utilizationPercent={row.utilizationPercent}
                            exceedsCap={row.exceedsCap}
                            requestCount={row.requestCount}
                            onOpenRequests={() => setHistoryRow(row)}
                          />
                        </td>
                        <td className="max-w-[11rem]" onClick={(e) => e.stopPropagation()}>
                          {pendingReason ? (
                            <button
                              type="button"
                              className="block w-full truncate text-left text-sm text-gray-700 underline decoration-gray-300 underline-offset-2 hover:text-gray-900 hover:decoration-gray-500"
                              title="View full reason"
                              onClick={() => {
                                const pendingReq = pending[0];
                                setReasonPreview({
                                  reason: pendingReason,
                                  employeeName: pendingReq?.employeeName,
                                  leadLabel: `${row.clientName} · #${row.leadNumber}`,
                                });
                              }}
                            >
                              {pendingReason}
                            </button>
                          ) : (
                            <span className="text-sm text-gray-400">—</span>
                          )}
                        </td>
                        <td className="text-right" onClick={(e) => e.stopPropagation()}>
                          {pending.length > 0 ? (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1.5 rounded-full bg-red-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-red-600"
                              onClick={() => setReviewRequest(pending[0])}
                            >
                              {pending.length === 1
                                ? 'Received request'
                                : `${pending.length} received requests`}
                            </button>
                          ) : (
                            <span className="text-sm text-gray-400">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
          </>
        )}

      </div>

      <LeadBudgetRequestsHistoryModal
        open={Boolean(historyRow)}
        leadLabel={
          historyRow ? `${historyRow.clientName} · #${historyRow.leadNumber}` : ''
        }
        requests={historyRow?.budgetRequests || []}
        onClose={() => setHistoryRow(null)}
      />
      {reasonPreview ? (
        <div className="modal modal-open z-[135]">
          <div className="modal-box max-w-md">
            <h3 className="text-lg font-bold text-gray-900">Request reason</h3>
            {reasonPreview.leadLabel || reasonPreview.employeeName ? (
              <p className="mt-1 text-sm text-gray-500">
                {[reasonPreview.employeeName, reasonPreview.leadLabel]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            ) : null}
            <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-gray-800">
              {reasonPreview.reason}
            </p>
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                className="inline-flex items-center rounded-full bg-gray-900 px-5 py-2 text-sm font-semibold text-white hover:bg-gray-800"
                onClick={() => setReasonPreview(null)}
              >
                Close
              </button>
            </div>
          </div>
          <div className="modal-backdrop bg-black/40" onClick={() => setReasonPreview(null)} />
        </div>
      ) : null}
      <LeadBudgetRequestReviewModal
        open={Boolean(reviewRequest)}
        request={reviewRequest}
        submitting={reviewSubmitting}
        onClose={() => setReviewRequest(null)}
        onConfirm={handleReviewConfirm}
      />
      {employeeRoleModal ? (
        <div className="modal modal-open z-[135]">
          <div className="modal-box max-w-sm">
            <div className="flex items-center gap-3">
              {employeeRoleModal.employee.photoUrl ? (
                <img
                  src={employeeRoleModal.employee.photoUrl}
                  alt=""
                  className="h-12 w-12 rounded-full object-cover"
                />
              ) : (
                <span
                  className="flex h-12 w-12 items-center justify-center rounded-full text-sm font-bold text-white"
                  style={salaryAvatarGradientStyle(
                    employeeRoleModal.employee.employeeId,
                    employeeRoleModal.employee.employeeName,
                  )}
                >
                  {getSalaryEmployeeInitials(employeeRoleModal.employee.employeeName)}
                </span>
              )}
              <div className="min-w-0">
                <h3 className="truncate text-lg font-bold text-gray-900">
                  {employeeRoleModal.employee.employeeName}
                </h3>
                <p className="truncate text-sm text-gray-500">
                  {employeeRoleModal.lead.clientName} · #{employeeRoleModal.lead.leadNumber}
                </p>
              </div>
            </div>

            <div className="mt-5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                Role on this lead
              </p>
              {employeeRoleModal.loading ? (
                <div className="mt-3 flex items-center gap-2 text-sm text-gray-500">
                  <span className="loading loading-spinner loading-sm" />
                  Loading…
                </div>
              ) : employeeRoleModal.roles.length > 0 ? (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {employeeRoleModal.roles.map((role) => {
                    const RoleIcon = getLeadRoleIcon(role.id);
                    return (
                      <li
                        key={role.id}
                        className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary"
                      >
                        <RoleIcon className="h-4 w-4 shrink-0 text-primary/80" />
                        {role.title}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-gray-500">
                  No assigned role on this lead (time was allocated without a Roles-tab
                  assignment).
                </p>
              )}
            </div>

            {employeeRoleModal.employee.departmentName ? (
              <p className="mt-4 text-xs text-gray-500">
                Department: {employeeRoleModal.employee.departmentName}
              </p>
            ) : null}

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                className="inline-flex items-center rounded-full bg-gray-900 px-5 py-2 text-sm font-semibold text-white hover:bg-gray-800"
                onClick={() => setEmployeeRoleModal(null)}
              >
                Close
              </button>
            </div>
          </div>
          <div
            className="modal-backdrop bg-black/40"
            onClick={() => setEmployeeRoleModal(null)}
          />
        </div>
      ) : null}
    </div>
  );
};

export default LeadsManagementReportPage;
