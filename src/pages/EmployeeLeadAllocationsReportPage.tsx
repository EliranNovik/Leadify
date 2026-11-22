import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import {
  ArrowRightIcon,
  BanknotesIcon,
  ChartBarIcon,
  ClipboardDocumentListIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  UsersIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import {
  GradientSummaryCard,
  REPORT_SUMMARY_GRADIENTS,
} from '../components/reports/GradientSummaryCard';
import { supabase } from '../lib/supabase';
import { fetchClockedInEmployeeIds } from '../lib/employeeClockInStatus';
import {
  ReportSortableTh,
  compareNullableNumbers,
  toggleReportSort,
  type ReportSortDir,
} from '../components/reports/ReportSortableTh';
import {
  allocationEmployeeDateKey,
  allocationPercentToWorkedMs,
  buildClientRouteFromAllocationRow,
  compareWorkedHoursToMin,
  buildAllocationClockInMsByEmployeeDate,
  fetchMissingLeadReportingBacklog,
  fetchAllocationReport,
  fetchDepartmentsForFilter,
  fetchEffortAllocationReport,
  formatAllocationCostNis,
  formatAllocationPercent,
  formatAllocationWorkedDuration,
  formatLeadAllocationMissingDayLabel,
  getJerusalemTodayIsoDate,
  isMissingEffortAllocationsTable,
  minHoursToMs,
  salaryToHourlyRateNis,
  workedMsAtHourlyRateToCostNis,
  type AllocationReportRow,
  type EffortAllocationReportRow,
  type MissingLeadReportingBacklogRow,
} from '../lib/employeeLeadReporting';
import {
  fetchClockInRecordsForAllocationMs,
  type ClockInForAllocationMs,
} from '../lib/workingHoursExport';
import LeadAllocationOvertimeApprovalModal from '../components/employeeLeadReporting/LeadAllocationOvertimeApprovalModal';
import { fetchActiveClockInLocations, type ClockInLocationOption } from '../lib/clockInLocations';
import {
  formatOvertimeDatePlaceholder,
  formatOvertimeHoursPlaceholder,
  requestMichaelOvertimeApproval,
} from '../lib/employeeClockInOvertimeWhatsApp';
import {
  fetchAverageGrossSalaryLastMonths,
  getSalaryEmployeeInitials,
  salaryAvatarGradientStyle,
} from '../lib/employeeSalaries';
import {
  allocationLeadBudgetKey,
  fetchAllocationLeadBudgetStatuses,
  type AllocationLeadBudgetStatus,
} from '../lib/leadAllocationBudget';
import {
  confirmBudgetRequestReview,
  LeadBudgetRequestReviewModal,
  LeadBudgetRequestsHistoryModal,
  type LeadBudgetRequestReviewResult,
} from '../components/LeadBudgetRequestsHistoryModal';
import LeadRemainingTimeBar from '../components/LeadRemainingTimeBar';
import type { LeadBudgetExtensionRequest } from '../lib/leadBudgetExtensionRequests';
import {
  effortById,
  isEffortArea,
  WORK_AREAS,
  type EffortAreaId,
  type WorkAreaId,
  type WorkEffort,
} from '../lib/workAreaEfforts';
import { fetchCustomWorkEfforts } from '../lib/customWorkEfforts';
import AllocationAreaOverview from '../components/reports/AllocationAreaOverview';
import HoursAllocationNav from '../components/reports/HoursAllocationNav';
import DepartmentHourTotals from '../components/reports/DepartmentHourTotals';
import HoursAllocationCharts from '../components/reports/HoursAllocationCharts';
import ReportLoadingScreen from '../components/reports/ReportLoadingScreen';
import HoursEmployeeCarousel from '../components/reports/HoursEmployeeCarousel';
import { buildForDepartmentTotals, combinedGermanAustrian, displayAgreementDepartment, mergedEmployeeDepartmentName } from '../lib/employeeDepartmentTotals';
import {
  buildCategoryNameToDataMap,
  canonicalizeScoreboardDepartment,
  fetchCategoriesWithDepartments,
  resolveCategoryAndDepartment,
} from '../lib/resolveCategoryDepartment';
import {
  fetchAgreementScoreboardDepartments,
  GENERAL_EFFORT_DEPARTMENT_LABEL,
} from '../lib/scoreboardDepartments';

function categoryParts(row: { category?: unknown; misc_category?: any } | null): { lookup: string } {
  const categoryJoin = Array.isArray(row?.misc_category) ? row?.misc_category[0] : row?.misc_category;
  const subcategory = categoryJoin?.name ? String(categoryJoin.name).trim() : '';
  const mainRel = categoryJoin?.misc_maincategory;
  const mainName = Array.isArray(mainRel) ? mainRel[0]?.name : mainRel?.name;
  const main = mainName ? String(mainName).trim() : '';
  const fallback = row?.category != null ? String(row.category).trim() : '';
  const lookup = main && subcategory ? `${main} > ${subcategory}` : subcategory || main || fallback;
  return { lookup };
}

function leadAgreementDepartment(
  row: { category?: unknown; misc_category?: any } | null,
  catalog: { targets: { id: number; name: string }[]; categories: any[]; nameMap: Map<string, any> },
): string {
  const combined = combinedGermanAustrian(catalog.targets);
  const { lookup } = categoryParts(row);
  if (!lookup) return combined;
  const resolved = canonicalizeScoreboardDepartment(
    resolveCategoryAndDepartment(lookup, null, null, catalog.categories, catalog.nameMap),
    catalog.targets,
  );
  const name = displayAgreementDepartment(resolved.departmentName, catalog.targets);
  if (!name || resolved.departmentName === 'Other') return combined;
  return name;
}

async function fetchLeadRowsInChunks<T>(
  ids: Array<string | number>,
  load: (chunk: Array<string | number>) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let index = 0; index < ids.length; index += 80) {
    const { data, error } = await load(ids.slice(index, index + 80));
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
  }
  return rows;
}

function formatSubmittedAt(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso));
}

function LeadBudgetBar({
  status,
  onOpenRequests,
}: {
  status: AllocationLeadBudgetStatus;
  onOpenRequests: () => void;
}) {
  return (
    <button
      type="button"
      className="min-w-[11rem] max-w-[16rem] text-left"
      onClick={onOpenRequests}
      title="View budget requests"
    >
      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
        <span className={status.exceedsCap ? 'font-semibold text-amber-700' : 'text-gray-500'}>
          {status.utilizationPercent.toFixed(status.utilizationPercent % 1 === 0 ? 0 : 1)}% of max
        </span>
        {status.requestCount > 0 ? (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold leading-none text-white">
            {status.requestCount}
          </span>
        ) : null}
      </div>
      <LeadRemainingTimeBar
        summary={status.costSummary}
        align="start"
        fullWidth
        className="!self-stretch pointer-events-none"
      />
      {status.approvedExtensionCostNis > 0 ? (
        <p className="mt-0.5 text-[10px] text-emerald-600">
          +{formatAllocationCostNis(status.approvedExtensionCostNis)} ext
        </p>
      ) : null}
    </button>
  );
}

type EmployeeDaySlice = {
  workDate: string;
  totalWorkedMs: number;
  rows: AllocationReportRow[];
};

type PendingOvertimeDay = {
  employeeId: number;
  employeeName: string;
  dateKey: string;
  clockInIds: number[];
  clockInTime: string;
  clockOutTime: string;
  extraMinutes: number;
  baseHours: number;
  locationId: number | null;
};

function jerusalemClockTime(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const hour = parts.find((part) => part.type === 'hour')?.value ?? '00';
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';
  return `${hour}:${minute}`;
}

type EmployeeAllocationGroup = {
  employeeId: number;
  employeeName: string;
  employeePhotoUrl: string | null;
  departmentName: string | null;
  minHours: number;
  /** Average monthly gross salary (last 6 months). Total cost = this salary. */
  avgMonthlySalaryNis: number | null;
  /** Salary ÷ 127 monthly hours. */
  salaryHourRateNis: number | null;
  /** Newest work date first. */
  days: EmployeeDaySlice[];
  /** Sum of worked ms across all days in the group. */
  totalWorkedMs: number;
};

type AllocationNumericSortKey = 'time' | 'cost' | 'max';

function formatAllocationGroupDateLabel(workDate: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${workDate}T12:00:00`));
}

function shiftIsoDate(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(y, (m || 1) - 1, (d || 1) + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

type DateFilterMode = 'day' | 'period' | 'all';

function dateFilterButtonClass(active: boolean): string {
  return active
    ? 'inline-flex h-10 items-center rounded-[14px] bg-primary px-3.5 text-sm font-semibold text-white shadow-sm'
    : 'inline-flex h-10 items-center rounded-[14px] bg-white px-3.5 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-gray-200 transition-colors hover:bg-gray-50';
}

function rowSortMetrics(
  row: AllocationReportRow,
  dayWorkedMs: number,
  salaryHourRateNis: number | null,
  budgetStatus: AllocationLeadBudgetStatus | null,
): { time: number; cost: number | null; max: number | null } {
  const time = allocationPercentToWorkedMs(dayWorkedMs, row.percent);
  return {
    time,
    cost: workedMsAtHourlyRateToCostNis(time, salaryHourRateNis),
    max: row.is_other_work ? null : budgetStatus?.maxAllowedCostNis ?? null,
  };
}

function sortAllocationRows(
  rows: AllocationReportRow[],
  dayWorkedMs: number,
  salaryHourRateNis: number | null,
  budgetByLeadKey: Map<string, AllocationLeadBudgetStatus>,
  sortKey: AllocationNumericSortKey | null,
  sortDir: ReportSortDir,
): AllocationReportRow[] {
  if (!sortKey) {
    return [...rows].sort((a, b) => {
      if (a.is_other_work !== b.is_other_work) return a.is_other_work ? 1 : -1;
      return a.lead_number.localeCompare(b.lead_number);
    });
  }

  return [...rows].sort((a, b) => {
    const aKey = allocationLeadBudgetKey(a);
    const bKey = allocationLeadBudgetKey(b);
    const aMetrics = rowSortMetrics(
      a,
      dayWorkedMs,
      salaryHourRateNis,
      aKey ? budgetByLeadKey.get(aKey) ?? null : null,
    );
    const bMetrics = rowSortMetrics(
      b,
      dayWorkedMs,
      salaryHourRateNis,
      bKey ? budgetByLeadKey.get(bKey) ?? null : null,
    );
    return compareNullableNumbers(aMetrics[sortKey], bMetrics[sortKey], sortDir);
  });
}

function EmployeeReportAvatar({
  employeeId,
  employeeName,
  photoUrl,
  size = 'md',
  clockedIn = false,
}: {
  employeeId: number;
  employeeName: string;
  photoUrl: string | null;
  size?: 'md' | 'lg';
  clockedIn?: boolean;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const resolvedUrl = photoUrl?.trim() || '';
  const showImage = Boolean(resolvedUrl) && !imageFailed;
  const dim = size === 'lg' ? 'h-16 w-16 text-base' : 'h-12 w-12 text-sm';

  useEffect(() => {
    setImageFailed(false);
  }, [resolvedUrl]);

  return (
    <span className={`relative inline-flex shrink-0 ${size === 'lg' ? 'h-16 w-16' : 'h-12 w-12'}`}>
      {showImage ? (
        <img
          src={resolvedUrl}
          alt=""
          className={`${dim} rounded-full object-cover shadow-md`}
          onError={() => setImageFailed(true)}
        />
      ) : (
        <span
          className={`flex ${dim} items-center justify-center rounded-full font-bold text-white shadow-md`}
          style={salaryAvatarGradientStyle(employeeId, employeeName)}
          aria-hidden
        >
          {getSalaryEmployeeInitials(employeeName)}
        </span>
      )}
      {clockedIn ? (
        <span
          className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500"
          title="Clocked in"
        />
      ) : null}
    </span>
  );
}

type ReportGrandTotals = {
  employeeCount: number;
  missingReportingCount: number;
  totalWorkedMs: number;
  totalCostNis: number | null;
  overBudgetLeadCount: number;
};

function ReportTotalsBar({
  totals,
  onMissingReportingClick,
  overBudgetOnly,
  onToggleOverBudget,
}: {
  totals: ReportGrandTotals;
  onMissingReportingClick: () => void;
  overBudgetOnly: boolean;
  onToggleOverBudget: () => void;
}) {
  return (
    <section>
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
        All employees total
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <GradientSummaryCard
          label="Employees"
          value={totals.employeeCount}
          icon={UsersIcon}
          gradientClassName={REPORT_SUMMARY_GRADIENTS[4]}
        />
        <GradientSummaryCard
          label="Missing reporting"
          value={totals.missingReportingCount}
          hint="Handlers, DMs & admins · backlog by day"
          icon={ExclamationTriangleIcon}
          gradientClassName={REPORT_SUMMARY_GRADIENTS[0]}
          onClick={onMissingReportingClick}
        />
        <GradientSummaryCard
          label="Total worked"
          value={formatAllocationWorkedDuration(totals.totalWorkedMs)}
          icon={ClockIcon}
          gradientClassName={REPORT_SUMMARY_GRADIENTS[3]}
        />
        <GradientSummaryCard
          label="Total cost"
          value={formatAllocationCostNis(totals.totalCostNis)}
          icon={BanknotesIcon}
          gradientClassName={REPORT_SUMMARY_GRADIENTS[1]}
        />
        <GradientSummaryCard
          label={overBudgetOnly ? 'Over budget · on' : 'Over budget'}
          value={totals.overBudgetLeadCount}
          icon={ExclamationTriangleIcon}
          gradientClassName={REPORT_SUMMARY_GRADIENTS[2]}
          active={overBudgetOnly}
          onClick={onToggleOverBudget}
        />
      </div>
    </section>
  );
}

function MissingReportingModal({
  open,
  employees,
  loading,
  clockedInIds,
  onClose,
}: {
  open: boolean;
  employees: MissingLeadReportingBacklogRow[];
  loading: boolean;
  clockedInIds: Set<number>;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div className="modal modal-open z-[110]">
      <div className="modal-box max-w-4xl max-h-[85vh] flex flex-col p-0 overflow-hidden">
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-4">
          <div>
            <h3 className="text-lg font-bold text-gray-900">Missing lead reporting</h3>
            <p className="mt-1 text-sm text-gray-500">
              Handlers, DMs, and admins with unsubmitted allocations for yesterday and earlier
              (not limited to the selected report day)
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-circle shrink-0"
            aria-label="Close"
            onClick={onClose}
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-auto px-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <span className="loading loading-spinner loading-lg text-primary" />
            </div>
          ) : employees.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-500">
              No employees are missing reporting in the backlog.
            </p>
          ) : (
            <table className="table w-full">
              <thead>
                <tr className="text-xs uppercase tracking-wider text-gray-400">
                  <th className="bg-transparent">Employee</th>
                  <th className="bg-transparent">Department</th>
                  <th className="bg-transparent">Missing days</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((employee) => (
                  <tr key={employee.employeeId} className="hover:bg-gray-50/80">
                    <td>
                      <div className="flex items-center gap-3">
                        <EmployeeReportAvatar
                          employeeId={employee.employeeId}
                          employeeName={employee.employeeName}
                          photoUrl={employee.photoUrl}
                          size="md"
                          clockedIn={clockedInIds.has(employee.employeeId)}
                        />
                        <span className="font-medium text-gray-900">{employee.employeeName}</span>
                      </div>
                    </td>
                    <td className="text-sm text-gray-600">
                      {employee.departmentName || 'No department'}
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1.5">
                        {employee.missingDates.map((day) => (
                          <span
                            key={day}
                            className="inline-flex items-center rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-100"
                            title={day}
                          >
                            {formatLeadAllocationMissingDayLabel(day)}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="border-t border-gray-200 px-6 py-4">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      <button
        type="button"
        className="modal-backdrop bg-black/40"
        aria-label="Close"
        onClick={onClose}
      />
    </div>
  );
}

/** Soft washed-out header tint, stable per employee. */
function employeeHeaderWashStyle(
  employeeId: number,
  employeeName: string,
): { background: string } {
  let h = Math.abs(Number(employeeId) || 0) * 2654435761;
  const label = employeeName || '';
  for (let i = 0; i < label.length; i += 1) {
    h = (h * 31 + label.charCodeAt(i)) >>> 0;
  }
  const hue = h % 360;
  const hue2 = (hue + 28) % 360;
  return {
    background: `linear-gradient(105deg, hsl(${hue} 42% 94%) 0%, hsl(${hue2} 38% 97%) 55%, hsl(0 0% 100%) 100%)`,
  };
}

function EmployeeAllocationHeader({
  group,
  totalCostNis,
  multiDay,
  embedded = false,
  clockedIn = false,
  onSendOvertime,
}: {
  group: EmployeeAllocationGroup;
  totalCostNis: number | null;
  multiDay: boolean;
  embedded?: boolean;
  clockedIn?: boolean;
  onSendOvertime?: () => void;
}) {
  const comparison = compareWorkedHoursToMin(group.totalWorkedMs, group.minHours);
  const minMs = minHoursToMs(group.minHours);
  const progressPercent =
    minMs > 0 ? Math.min(100, Math.round((group.totalWorkedMs / minMs) * 100)) : 0;

  const progressBarClass =
    comparison.status === 'below'
      ? 'bg-gradient-to-r from-red-500 to-red-400'
      : comparison.status === 'above'
        ? 'bg-gradient-to-r from-emerald-500 to-teal-500'
        : 'bg-gradient-to-r from-emerald-500 to-teal-500';

  const headerTintStyle = employeeHeaderWashStyle(group.employeeId, group.employeeName);
  const dayCount = group.days.length;
  const subtitle = multiDay
    ? `${dayCount} day${dayCount === 1 ? '' : 's'}${
        group.departmentName ? ` · ${group.departmentName}` : ' · No department'
      }`
    : `${formatAllocationGroupDateLabel(group.days[0]?.workDate || '')}${
        group.departmentName ? ` · ${group.departmentName}` : ' · No department'
      }`;

  return (
    <div
      className={
        embedded
          ? 'px-5 py-4 md:px-6 md:py-5'
          : 'overflow-hidden rounded-[18px] bg-white shadow-sm ring-1 ring-gray-100'
      }
      style={embedded ? headerTintStyle : undefined}
    >
      <div
        className={embedded ? undefined : 'px-5 py-4 md:px-6 md:py-5'}
        style={embedded ? undefined : headerTintStyle}
      >
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <EmployeeReportAvatar
              employeeId={group.employeeId}
              employeeName={group.employeeName}
              photoUrl={group.employeePhotoUrl}
              size="lg"
              clockedIn={clockedIn}
            />
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-bold tracking-tight text-gray-900">
                {group.employeeName}
              </h2>
              <p className="mt-0.5 text-sm text-gray-500">{subtitle}</p>
            </div>
          </div>

          {multiDay ? (
            <div className="grid min-w-[min(100%,16rem)] grid-cols-2 gap-2.5 lg:shrink-0 lg:gap-3">
              <div className="flex flex-col justify-center rounded-2xl bg-white/55 px-4 py-3 ring-1 ring-white/60">
                <p className="text-xs font-medium text-gray-500">Total time</p>
                <p className="mt-0.5 text-lg font-bold leading-tight text-gray-900">
                  {formatAllocationWorkedDuration(group.totalWorkedMs)}
                </p>
              </div>
              <div className="flex flex-col justify-center rounded-2xl bg-white/55 px-4 py-3 ring-1 ring-white/60">
                <p className="text-xs font-medium text-gray-500">Total cost</p>
                <p className="mt-0.5 text-lg font-bold leading-tight text-gray-900">
                  {formatAllocationCostNis(totalCostNis)}
                </p>
              </div>
            </div>
          ) : (
            <div className="grid min-w-[min(100%,20rem)] grid-cols-2 gap-2.5 lg:shrink-0 lg:gap-3">
              <div className="rounded-2xl px-4 py-3">
                <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
                  <span className="flex items-center gap-1.5 font-medium text-gray-600">
                    <ClockIcon className="h-3.5 w-3.5" />
                    {formatAllocationWorkedDuration(group.totalWorkedMs)} of {group.minHours}h
                  </span>
                  <span
                    className={
                      comparison.status === 'below'
                        ? 'font-semibold text-red-600'
                        : comparison.status === 'above'
                          ? 'font-semibold text-emerald-600'
                          : 'font-semibold text-gray-500'
                    }
                  >
                    {progressPercent}%
                  </span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-white/70">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${progressBarClass}`}
                    style={{
                      width: `${Math.max(progressPercent, comparison.status === 'below' && progressPercent > 0 ? 4 : 0)}%`,
                    }}
                  />
                </div>
                {comparison.status === 'above' ? (
                  <p className="mt-1.5 text-xs font-medium text-emerald-600">
                    {formatAllocationWorkedDuration(comparison.differenceMs)} over minimum
                  </p>
                ) : null}
                {onSendOvertime ? (
                  <button
                    type="button"
                    className="mt-1.5 text-xs font-semibold text-primary hover:underline"
                    onClick={onSendOvertime}
                  >
                    Send to Michael
                  </button>
                ) : null}
              </div>
              <div className="flex flex-col justify-center rounded-2xl bg-white/55 px-4 py-3 ring-1 ring-white/60">
                <p className="text-lg font-bold leading-tight text-gray-900">
                  {formatAllocationCostNis(totalCostNis)}
                </p>
                {group.salaryHourRateNis != null ? (
                  <p className="mt-0.5 text-xs text-gray-500">
                    {formatAllocationCostNis(group.salaryHourRateNis)}/h
                  </p>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function groupRowsByEmployee(
  rows: AllocationReportRow[],
  clockInMsByEmployeeDate: Map<string, number>,
  avgMonthlySalaryByEmployee: Map<number, number>,
): EmployeeAllocationGroup[] {
  type Builder = {
    employeeId: number;
    employeeName: string;
    employeePhotoUrl: string | null;
    departmentName: string | null;
    minHours: number;
    avgMonthlySalaryNis: number | null;
    salaryHourRateNis: number | null;
    days: Map<string, EmployeeDaySlice>;
  };

  const byEmployee = new Map<number, Builder>();

  for (const row of rows) {
    const workDate = String(row.work_date || '').slice(0, 10);
    let builder = byEmployee.get(row.employee_id);
    if (!builder) {
      const avgSalaryRaw = avgMonthlySalaryByEmployee.get(row.employee_id);
      const avgMonthlySalaryNis =
        avgSalaryRaw != null && Number.isFinite(avgSalaryRaw) && avgSalaryRaw > 0
          ? Math.round(avgSalaryRaw * 100) / 100
          : null;
      const minHours = row.employee_min_hours;
      builder = {
        employeeId: row.employee_id,
        employeeName: row.employee_name,
        employeePhotoUrl: row.employee_photo_url,
        departmentName: row.department_name,
        minHours,
        avgMonthlySalaryNis,
        salaryHourRateNis: salaryToHourlyRateNis(avgMonthlySalaryNis, minHours),
        days: new Map(),
      };
      byEmployee.set(row.employee_id, builder);
    }

    let day = builder.days.get(workDate);
    if (!day) {
      const groupKey = allocationEmployeeDateKey(row.employee_id, workDate);
      day = {
        workDate,
        totalWorkedMs: clockInMsByEmployeeDate.get(groupKey) ?? 0,
        rows: [],
      };
      builder.days.set(workDate, day);
    }
    day.rows.push(row);
  }

  return Array.from(byEmployee.values())
    .map((builder) => {
      const days = Array.from(builder.days.values()).sort((a, b) =>
        b.workDate.localeCompare(a.workDate),
      );
      const totalWorkedMs = days.reduce((sum, day) => sum + day.totalWorkedMs, 0);
      return {
        employeeId: builder.employeeId,
        employeeName: builder.employeeName,
        employeePhotoUrl: builder.employeePhotoUrl,
        departmentName: builder.departmentName,
        minHours: builder.minHours,
        avgMonthlySalaryNis: builder.avgMonthlySalaryNis,
        salaryHourRateNis: builder.salaryHourRateNis,
        days,
        totalWorkedMs,
      };
    })
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName));
}

function allocationRowKey(row: AllocationReportRow): string {
  return `${row.allocation_id}-${row.work_date}-${row.is_other_work ? 'other' : row.lead_number}-${row.percent}`;
}

/** Sum of lead-row costs across all days: each row’s allocated hours × salary hourly rate. */
function sumEmployeeAllocationRowCostsNis(group: EmployeeAllocationGroup): number | null {
  if (group.salaryHourRateNis == null) return null;
  let total = 0;
  for (const day of group.days) {
    for (const row of day.rows) {
      const workedMs = allocationPercentToWorkedMs(day.totalWorkedMs, row.percent);
      const rowCost = workedMsAtHourlyRateToCostNis(workedMs, group.salaryHourRateNis);
      if (rowCost != null) total += rowCost;
    }
  }
  return Math.round(total * 100) / 100;
}

type AllocationReportRowCardProps = {
  row: AllocationReportRow;
  totalWorkedMs: number;
  salaryHourRateNis: number | null;
  budgetStatus: AllocationLeadBudgetStatus | null;
  effortsLabel: string;
  onOpenBudgetHistory: (status: AllocationLeadBudgetStatus, row: AllocationReportRow) => void;
  onReviewRequest: (request: LeadBudgetExtensionRequest) => void;
};

function AllocationReportTableRow({
  row,
  totalWorkedMs,
  salaryHourRateNis,
  budgetStatus,
  effortsLabel,
  onOpenBudgetHistory,
  onReviewRequest,
}: AllocationReportRowCardProps) {
  const workedMs = allocationPercentToWorkedMs(totalWorkedMs, row.percent);
  const rowCostNis = workedMsAtHourlyRateToCostNis(workedMs, salaryHourRateNis);
  const pending = budgetStatus?.budgetRequests.filter((r) => r.status === 'pending') ?? [];
  const overBudget = Boolean(budgetStatus?.exceedsCap);

  return (
    <tr className={overBudget ? 'bg-amber-50/40 hover:bg-amber-50/70' : 'hover:bg-gray-50/90'}>
      <td>
        {row.is_other_work ? (
          <span className="text-sm text-gray-400">—</span>
        ) : (
          <Link
            to={buildClientRouteFromAllocationRow(row) || '#'}
            className="text-sm font-semibold text-primary hover:underline"
          >
            #{row.lead_number}
          </Link>
        )}
      </td>
      <td className="text-sm text-gray-800">
        <div className="flex flex-wrap items-center gap-2">
          <span>{row.client_name}</span>
          {overBudget ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
              <ExclamationTriangleIcon className="h-3 w-3" />
              Over budget
            </span>
          ) : null}
        </div>
      </td>
      <td className="text-sm text-gray-700">
        {effortsLabel ? (
          <span className="block max-w-[16rem]" title={effortsLabel}>
            {effortsLabel}
          </span>
        ) : (
          <span className="text-gray-400">—</span>
        )}
      </td>
      <td className="text-right">
        <span className="inline-flex min-w-[3rem] justify-center rounded-md bg-primary/8 px-2 py-0.5 text-sm font-semibold text-primary">
          {formatAllocationPercent(row.percent)}%
        </span>
      </td>
      <td className="text-right text-sm font-medium text-gray-900">
        {formatAllocationWorkedDuration(workedMs)}
      </td>
      <td className="text-right text-sm font-semibold text-gray-900">
        {formatAllocationCostNis(rowCostNis)}
      </td>
      <td className="text-right text-sm text-gray-500">
        {row.is_other_work ? (
          '—'
        ) : (
          <>
            {formatAllocationCostNis(budgetStatus?.maxAllowedCostNis)}
            {(budgetStatus?.approvedExtensionCostNis ?? 0) > 0 ? (
              <p className="text-[10px] text-emerald-600">
                +{formatAllocationCostNis(budgetStatus?.approvedExtensionCostNis)} ext
              </p>
            ) : null}
          </>
        )}
      </td>
      <td>
        {budgetStatus ? (
          <LeadBudgetBar
            status={budgetStatus}
            onOpenRequests={() => onOpenBudgetHistory(budgetStatus, row)}
          />
        ) : row.is_other_work ? (
          <span className="text-sm text-gray-400">—</span>
        ) : (
          <span className="loading loading-spinner loading-xs text-gray-300" />
        )}
      </td>
      <td className="text-right">
        {pending.length > 0 ? (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-full bg-red-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-red-600"
            onClick={() => onReviewRequest(pending[0])}
          >
            {pending.length === 1 ? 'Accept request' : `${pending.length} requests`}
          </button>
        ) : (
          <span className="text-sm text-gray-400">—</span>
        )}
      </td>
      <td className="text-right text-sm text-gray-500">{formatSubmittedAt(row.submitted_at)}</td>
    </tr>
  );
}

type EmployeeAllocationSectionProps = {
  group: EmployeeAllocationGroup;
  multiDay: boolean;
  budgetByLeadKey: Map<string, AllocationLeadBudgetStatus>;
  sortKey: AllocationNumericSortKey | null;
  sortDir: ReportSortDir;
  onSort: (key: string) => void;
  onOpenBudgetHistory: (status: AllocationLeadBudgetStatus, row: AllocationReportRow) => void;
  onReviewRequest: (request: LeadBudgetExtensionRequest) => void;
  pendingOvertimeDates: Set<string>;
  onSendOvertime: (dateKey: string) => void;
  subEffortNames: Map<number, string>;
  clockedIn: boolean;
};

function EmployeeAllocationSection({
  group,
  multiDay,
  budgetByLeadKey,
  sortKey,
  sortDir,
  onSort,
  onOpenBudgetHistory,
  onReviewRequest,
  pendingOvertimeDates,
  onSendOvertime,
  subEffortNames,
  clockedIn,
}: EmployeeAllocationSectionProps) {
  const totalCostNis = sumEmployeeAllocationRowCostsNis(group);
  const showDayBreaks = multiDay && group.days.length > 1;

  return (
    <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-100">
      <EmployeeAllocationHeader
        group={group}
        totalCostNis={totalCostNis}
        multiDay={multiDay}
        clockedIn={clockedIn}
        embedded
        onSendOvertime={
          group.days.length === 1 && pendingOvertimeDates.has(group.days[0].workDate)
            ? () => onSendOvertime(group.days[0].workDate)
            : undefined
        }
      />

      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr className="border-b border-gray-100 text-xs uppercase tracking-wider text-gray-500">
              <th>Lead</th>
              <th>Client</th>
              <th>Efforts</th>
              <th className="text-right">%</th>
              <ReportSortableTh
                label="Time"
                sortKey="time"
                activeKey={sortKey}
                direction={sortDir}
                onSort={onSort}
              />
              <ReportSortableTh
                label="Cost"
                sortKey="cost"
                activeKey={sortKey}
                direction={sortDir}
                onSort={onSort}
              />
              <ReportSortableTh
                label="Max"
                sortKey="max"
                activeKey={sortKey}
                direction={sortDir}
                onSort={onSort}
              />
              <th>Budget</th>
              <th className="text-right">Action</th>
              <th className="text-right">Submitted</th>
            </tr>
          </thead>
          <tbody>
            {group.days.map((day) => {
              const sortedRows = sortAllocationRows(
                day.rows,
                day.totalWorkedMs,
                group.salaryHourRateNis,
                budgetByLeadKey,
                sortKey,
                sortDir,
              );
              return (
                <React.Fragment key={day.workDate}>
                  {showDayBreaks ? (
                    <tr className="bg-gray-50/90">
                      <td colSpan={10} className="!py-2.5">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold uppercase tracking-wider text-gray-500">
                          <span className="text-gray-800">
                            {formatAllocationGroupDateLabel(day.workDate)}
                          </span>
                          <span className="font-medium normal-case tracking-normal text-gray-500">
                            {formatAllocationWorkedDuration(day.totalWorkedMs)} worked
                          </span>
                          {pendingOvertimeDates.has(day.workDate) ? (
                            <button
                              type="button"
                              className="normal-case tracking-normal text-primary hover:underline"
                              onClick={() => onSendOvertime(day.workDate)}
                            >
                              Send to Michael
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                  {sortedRows.map((row) => {
                    const key = allocationLeadBudgetKey(row);
                    return (
                      <AllocationReportTableRow
                        key={allocationRowKey(row)}
                        row={row}
                        totalWorkedMs={day.totalWorkedMs}
                        salaryHourRateNis={group.salaryHourRateNis}
                        budgetStatus={key ? budgetByLeadKey.get(key) ?? null : null}
                        effortsLabel={
                          row.is_other_work
                            ? 'Other work'
                            : row.subEffortIds
                                .map((id) => subEffortNames.get(id) || `Sub effort #${id}`)
                                .join(', ')
                        }
                        onOpenBudgetHistory={onOpenBudgetHistory}
                        onReviewRequest={onReviewRequest}
                      />
                    );
                  })}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function effortDisplay(effortId: string, extraEfforts: WorkEffort[]): { category: string; name: string } {
  const catalog = effortById(effortId);
  if (catalog) return { category: catalog.category, name: catalog.name };
  const extra = extraEfforts.find((effort) => effort.id === effortId);
  if (extra) return { category: extra.category, name: extra.name };
  return { category: '—', name: effortId };
}

function EffortAreaSection({
  area,
  rows,
  extraEfforts,
  clockInMsByEmployeeDate,
  salaryByEmployee,
  tableMissing,
  loading,
  clockedInIds,
}: {
  area: EffortAreaId;
  rows: EffortAllocationReportRow[];
  extraEfforts: WorkEffort[];
  clockInMsByEmployeeDate: Map<string, number>;
  salaryByEmployee: Map<number, number>;
  tableMissing: boolean;
  loading: boolean;
  clockedInIds: Set<number>;
}) {
  const label = WORK_AREAS.find((item) => item.id === area)?.label ?? area;
  const [departmentNames, setDepartmentNames] = useState<Map<number, string>>(() => new Map());

  useEffect(() => {
    let cancelled = false;
    void fetchAgreementScoreboardDepartments()
      .then((list) => {
        if (cancelled) return;
        setDepartmentNames(new Map(list.map((department) => [department.id, department.name])));
      })
      .catch((error) => {
        console.error('[EmployeeLeadAllocationsReport] scoreboard departments failed:', error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const departmentLabel = (ids: number[]) => {
    if (ids.length === 0) return GENERAL_EFFORT_DEPARTMENT_LABEL;
    return ids.map((id) => departmentNames.get(id) || `Department #${id}`).join(', ');
  };
  const areaRows = rows
    .filter((row) => row.area === area)
    .slice()
    .sort((a, b) => {
      const byEmployee = a.employeeName.localeCompare(b.employeeName);
      if (byEmployee !== 0) return byEmployee;
      if (a.workDate !== b.workDate) return b.workDate.localeCompare(a.workDate);
      const categoryA = effortDisplay(a.effortId, extraEfforts).category;
      const categoryB = effortDisplay(b.effortId, extraEfforts).category;
      const byCategory = categoryA.localeCompare(categoryB);
      if (byCategory !== 0) return byCategory;
      const byEffort = effortDisplay(a.effortId, extraEfforts).name.localeCompare(
        effortDisplay(b.effortId, extraEfforts).name,
      );
      if (byEffort !== 0) return byEffort;
      return departmentLabel(a.targetDepartmentIds).localeCompare(departmentLabel(b.targetDepartmentIds));
    });

  let totalMs = 0;
  let totalCost = 0;
  let hasCost = false;
  for (const row of areaRows) {
    const dayMs = clockInMsByEmployeeDate.get(allocationEmployeeDateKey(row.employeeId, row.workDate)) ?? 0;
    const workedMs = allocationPercentToWorkedMs(dayMs, row.percent);
    totalMs += workedMs;
    const salary = salaryByEmployee.get(row.employeeId);
    const rate = salary != null ? salaryToHourlyRateNis(salary) : null;
    const cost = workedMsAtHourlyRateToCostNis(workedMs, rate);
    if (cost != null) {
      totalCost += cost;
      hasCost = true;
    }
  }

  return (
    <section className="rounded-2xl bg-white shadow-sm ring-1 ring-gray-100">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-gray-100 px-5 py-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900">{label}</h2>
          <p className="mt-0.5 text-sm text-gray-500">Time allocated to {label.toLowerCase()} efforts</p>
        </div>
        <div className="flex flex-wrap gap-4 text-sm text-gray-600">
          <span>{formatAllocationWorkedDuration(totalMs)} allocated</span>
          {hasCost ? <span>{formatAllocationCostNis(totalCost)}</span> : null}
        </div>
      </div>
      {tableMissing ? (
        <p className="px-5 py-8 text-sm text-gray-500">
          Effort allocations are not in the database yet. Run sql/2026-11-18_employee_effort_allocations.sql,
          then employees can save time against these efforts.
        </p>
      ) : loading ? (
        <div className="flex items-center justify-center py-16">
          <span className="loading loading-spinner loading-lg text-primary" />
        </div>
      ) : areaRows.length === 0 ? (
        <p className="px-5 py-8 text-sm text-gray-500">No {label.toLowerCase()} time allocated for these filters.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table w-full">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-gray-400">
                <th>Employee</th>
                <th>Date</th>
                <th>Category</th>
                <th>Effort</th>
                <th>Department</th>
                <th className="text-right">Share</th>
                <th className="text-right">Time</th>
                <th className="text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {areaRows.map((row) => {
                const effort = effortDisplay(row.effortId, extraEfforts);
                const dayMs =
                  clockInMsByEmployeeDate.get(allocationEmployeeDateKey(row.employeeId, row.workDate)) ?? 0;
                const workedMs = allocationPercentToWorkedMs(dayMs, row.percent);
                const salary = salaryByEmployee.get(row.employeeId);
                const cost = workedMsAtHourlyRateToCostNis(
                  workedMs,
                  salary != null ? salaryToHourlyRateNis(salary) : null,
                );
                return (
                  <tr key={`${row.allocationId}-${row.effortId}`}>
                    <td>
                      <div className="flex items-center gap-2 font-medium text-gray-900">
                        {clockedInIds.has(row.employeeId) ? (
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500"
                            title="Clocked in"
                          />
                        ) : null}
                        {row.employeeName}
                      </div>
                      {row.departmentName ? (
                        <div className="text-xs text-gray-500">{row.departmentName}</div>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap text-gray-600">
                      {formatAllocationGroupDateLabel(row.workDate)}
                    </td>
                    <td className="text-gray-600">{effort?.category ?? '—'}</td>
                    <td className="font-medium text-gray-900">{effort?.name ?? row.effortId}</td>
                    <td className="text-gray-700">{departmentLabel(row.targetDepartmentIds)}</td>
                    <td className="text-right tabular-nums">{formatAllocationPercent(row.percent)}%</td>
                    <td className="text-right tabular-nums text-gray-700">
                      {formatAllocationWorkedDuration(workedMs)}
                    </td>
                    <td className="text-right tabular-nums text-gray-700">
                      {cost != null ? formatAllocationCostNis(cost) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const EmployeeLeadAllocationsReportPage: React.FC = () => {
  const navigate = useNavigate();
  const [isSuperUser, setIsSuperUser] = useState(false);
  const [permissionsLoaded, setPermissionsLoaded] = useState(false);
  const [dateMode, setDateMode] = useState<DateFilterMode>('period');
  const [dateToolsOpen, setDateToolsOpen] = useState(false);
  const [workDate, setWorkDate] = useState(() => getJerusalemTodayIsoDate());
  const [rangeFrom, setRangeFrom] = useState(() =>
    shiftIsoDate(getJerusalemTodayIsoDate(), -29),
  );
  const [rangeTo, setRangeTo] = useState(() => getJerusalemTodayIsoDate());
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [debouncedEmployeeSearch, setDebouncedEmployeeSearch] = useState('');
  const [departmentName, setDepartmentName] = useState('');
  const [departments, setDepartments] = useState<{ id: number; name: string }[]>([]);
  const [scoreboardTargets, setScoreboardTargets] = useState<{ id: number; name: string }[]>([]);
  const [leadForDepartment, setLeadForDepartment] = useState<Map<string, string>>(() => new Map());
  const [leadForReady, setLeadForReady] = useState(false);
  const [rows, setRows] = useState<AllocationReportRow[]>([]);
  const [effortRows, setEffortRows] = useState<EffortAllocationReportRow[]>([]);
  const [customEfforts, setCustomEfforts] = useState<WorkEffort[]>([]);
  const [subEffortNames, setSubEffortNames] = useState<Map<number, string>>(() => new Map());
  const [effortTableMissing, setEffortTableMissing] = useState(false);
  const [clockInMsByEmployeeDate, setClockInMsByEmployeeDate] = useState<Map<string, number>>(
    () => new Map(),
  );
  const [clockRecords, setClockRecords] = useState<ClockInForAllocationMs[]>([]);
  const [workplaces, setWorkplaces] = useState<ClockInLocationOption[]>([]);
  const [overtimeTarget, setOvertimeTarget] = useState<PendingOvertimeDay | null>(null);
  const [overtimeReason, setOvertimeReason] = useState('');
  const [sendingOvertime, setSendingOvertime] = useState(false);
  const [missingReportingBacklog, setMissingReportingBacklog] = useState<
    MissingLeadReportingBacklogRow[]
  >([]);
  const [missingReportingLoading, setMissingReportingLoading] = useState(false);
  const [avgMonthlySalaryByEmployee, setAvgMonthlySalaryByEmployee] = useState<Map<number, number>>(
    () => new Map(),
  );
  const [missingReportingModalOpen, setMissingReportingModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [clockedInIds, setClockedInIds] = useState<Set<number>>(() => new Set());
  const [refreshing, setRefreshing] = useState(false);
  const hasLoadedOnceRef = useRef(false);
  const loadRequestIdRef = useRef(0);
  const backlogRequestIdRef = useRef(0);
  const budgetRequestIdRef = useRef(0);
  const [budgetByLeadKey, setBudgetByLeadKey] = useState<Map<string, AllocationLeadBudgetStatus>>(
    () => new Map(),
  );
  const [overBudgetOnly, setOverBudgetOnly] = useState(false);
  const [leadQuery, setLeadQuery] = useState('');
  const [noSalaryOnly, setNoSalaryOnly] = useState(false);
  const [sortKey, setSortKey] = useState<AllocationNumericSortKey | null>(null);
  const [sortDir, setSortDir] = useState<ReportSortDir>('desc');
  const [historyLead, setHistoryLead] = useState<{
    label: string;
    status: AllocationLeadBudgetStatus;
  } | null>(null);
  const [reviewRequest, setReviewRequest] = useState<LeadBudgetExtensionRequest | null>(null);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);

  const resolvedDateRange = useMemo(() => {
    const today = getJerusalemTodayIsoDate();
    if (dateMode === 'all') {
      // No lower bound — true “all reporting”, capped at today.
      return {
        fromDate: null as string | null,
        toDate: today,
      };
    }
    if (dateMode === 'period') {
      const from = rangeFrom <= rangeTo ? rangeFrom : rangeTo;
      const to = rangeFrom <= rangeTo ? rangeTo : rangeFrom;
      return { fromDate: from, toDate: to };
    }
    return { fromDate: workDate, toDate: workDate };
  }, [dateMode, workDate, rangeFrom, rangeTo]);

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

        if (!cancelled) {
          setIsSuperUser(Boolean(isSuper));
          setPermissionsLoaded(true);
          if (!isSuper) {
            toast.error('Access denied. This report is only available to superusers.');
            navigate('/reports');
          }
        }
      } catch (error) {
        console.error('[EmployeeLeadAllocationsReport] permission check failed:', error);
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

  useEffect(() => {
    let cancelled = false;
    const reload = () => {
      void fetchClockedInEmployeeIds()
        .then((ids) => {
          if (!cancelled) setClockedInIds(ids);
        })
        .catch((error) => {
          console.error('[EmployeeLeadAllocationsReport] clock-in status failed:', error);
        });
    };
    reload();
    const channel = supabase
      .channel('employee-lead-allocations-clock')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'employee_clock_in' },
        () => reload(),
      )
      .subscribe();
    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedEmployeeSearch(employeeSearch.trim());
    }, 350);
    return () => window.clearTimeout(timer);
  }, [employeeSearch]);

  useEffect(() => {
    if (!isSuperUser) return;
    void fetchDepartmentsForFilter()
      .then(setDepartments)
      .catch((error) => {
        console.error('[EmployeeLeadAllocationsReport] departments failed:', error);
      });
    void fetchAgreementScoreboardDepartments()
      .then(setScoreboardTargets)
      .catch((error) => {
        console.error('[EmployeeLeadAllocationsReport] scoreboard departments failed:', error);
      });
    void fetchActiveClockInLocations()
      .then(setWorkplaces)
      .catch((error) => {
        console.error('[EmployeeLeadAllocationsReport] workplaces failed:', error);
      });
  }, [isSuperUser]);

  const loadReport = useCallback(async () => {
    if (!isSuperUser) return;
    const requestId = ++loadRequestIdRef.current;
    const isInitial = !hasLoadedOnceRef.current;
    if (isInitial) setLoading(true);
    else setRefreshing(true);
    try {
      const { fromDate, toDate } = resolvedDateRange;
      const data = await fetchAllocationReport({
        fromDate,
        toDate,
        employeeSearch: debouncedEmployeeSearch,
      });
      if (requestId !== loadRequestIdRef.current) return;

      const workDates = data
        .map((row) => String(row.work_date || '').slice(0, 10))
        .filter(Boolean)
        .sort();
      let clockFrom = fromDate || workDates[0] || toDate || getJerusalemTodayIsoDate();
      let clockTo = toDate || workDates[workDates.length - 1] || getJerusalemTodayIsoDate();
      if (clockFrom > clockTo) {
        const swap = clockFrom;
        clockFrom = clockTo;
        clockTo = swap;
      }

      const loadedClockRecords = await fetchClockInRecordsForAllocationMs(clockFrom, clockTo);
      if (requestId !== loadRequestIdRef.current) return;
      const clockInMs = buildAllocationClockInMsByEmployeeDate(loadedClockRecords);
      const employeeIds = Array.from(
        new Set([
          ...data.map((row) => row.employee_id),
          ...Array.from(clockInMs.keys()).map((key) => Number(key.split('|')[0])),
        ]),
      ).filter((id) => Number.isFinite(id));
      const salaryMap = await fetchAverageGrossSalaryLastMonths(employeeIds, 6);
      if (requestId !== loadRequestIdRef.current) return;

      setRows(data);
      setClockRecords(loadedClockRecords);
      setClockInMsByEmployeeDate(clockInMs);
      setAvgMonthlySalaryByEmployee(salaryMap);
      hasLoadedOnceRef.current = true;

      try {
        const effortData = await fetchEffortAllocationReport({
          fromDate,
          toDate,
          employeeSearch: debouncedEmployeeSearch,
        });
        if (requestId !== loadRequestIdRef.current) return;
        setEffortRows(effortData);
        setEffortTableMissing(false);
      } catch (effortError) {
        if (requestId !== loadRequestIdRef.current) return;
        setEffortRows([]);
        setEffortTableMissing(isMissingEffortAllocationsTable(effortError));
        if (!isMissingEffortAllocationsTable(effortError)) {
          console.error('[EmployeeLeadAllocationsReport] effort allocations failed:', effortError);
        }
      }

      const budgetRequestId = ++budgetRequestIdRef.current;
      void fetchAllocationLeadBudgetStatuses(data)
        .then((statuses) => {
          if (budgetRequestId !== budgetRequestIdRef.current) return;
          if (requestId !== loadRequestIdRef.current) return;
          setBudgetByLeadKey(statuses);
        })
        .catch((budgetError) => {
          if (budgetRequestId !== budgetRequestIdRef.current) return;
          console.error('[EmployeeLeadAllocationsReport] budget status failed:', budgetError);
          setBudgetByLeadKey(new Map());
        });
    } catch (error) {
      if (requestId !== loadRequestIdRef.current) return;
      console.error('[EmployeeLeadAllocationsReport] load failed:', error);
      toast.error(
        error instanceof Error ? error.message : 'Failed to load allocation report.',
      );
      setRows([]);
      setClockRecords([]);
      setClockInMsByEmployeeDate(new Map());
      setAvgMonthlySalaryByEmployee(new Map());
      setBudgetByLeadKey(new Map());
      hasLoadedOnceRef.current = true;
    } finally {
      if (requestId === loadRequestIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [isSuperUser, resolvedDateRange, debouncedEmployeeSearch]);

  const loadMissingReportingBacklog = useCallback(async () => {
    if (!isSuperUser) return;
    const requestId = ++backlogRequestIdRef.current;
    setMissingReportingLoading(true);
    try {
      const backlog = await fetchMissingLeadReportingBacklog({
        employeeSearch: debouncedEmployeeSearch,
      });
      if (requestId !== backlogRequestIdRef.current) return;
      setMissingReportingBacklog(backlog);
    } catch (error) {
      if (requestId !== backlogRequestIdRef.current) return;
      console.error('[EmployeeLeadAllocationsReport] missing backlog failed:', error);
      toast.error('Failed to load missing reporting backlog.');
      setMissingReportingBacklog([]);
    } finally {
      if (requestId === backlogRequestIdRef.current) {
        setMissingReportingLoading(false);
      }
    }
  }, [isSuperUser, debouncedEmployeeSearch]);

  const reloadBudgetStatuses = useCallback(async () => {
    if (rows.length === 0) {
      setBudgetByLeadKey(new Map());
      return;
    }
    try {
      const statuses = await fetchAllocationLeadBudgetStatuses(rows);
      setBudgetByLeadKey(statuses);
    } catch (error) {
      console.error('[EmployeeLeadAllocationsReport] budget reload failed:', error);
    }
  }, [rows]);

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
        await reloadBudgetStatuses();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to review request');
      } finally {
        setReviewSubmitting(false);
      }
    },
    [reviewRequest, reloadBudgetStatuses],
  );

  useEffect(() => {
    if (!permissionsLoaded || !isSuperUser) return;
    void loadReport();
  }, [permissionsLoaded, isSuperUser, loadReport]);

  useEffect(() => {
    if (!permissionsLoaded || !isSuperUser) return;
    void loadMissingReportingBacklog();
  }, [permissionsLoaded, isSuperUser, loadMissingReportingBacklog]);

  const hasSalary = useCallback(
    (employeeId: number) => {
      const gross = avgMonthlySalaryByEmployee.get(employeeId);
      return gross != null && gross > 0;
    },
    [avgMonthlySalaryByEmployee],
  );

  const departmentOptions = useMemo(() => {
    const real = new Set(
      departments.map((dept) => mergedEmployeeDepartmentName(dept.name, scoreboardTargets).toLowerCase()),
    );
    return buildForDepartmentTotals(
      [],
      departments.map((dept) => ({ name: mergedEmployeeDepartmentName(dept.name, scoreboardTargets) })),
    )
      .map((item) => item.name)
      .filter((name) => real.has(name.toLowerCase()));
  }, [departments, scoreboardTargets]);

  const matchesDepartment = useCallback(
    (rawName: string | null) =>
      !departmentName || mergedEmployeeDepartmentName(rawName || '', scoreboardTargets) === departmentName,
    [departmentName, scoreboardTargets],
  );

  const scopedHandlingRows = useMemo(() => {
    const query = leadQuery.trim().toLowerCase();
    return rows.filter((row) => {
      if (!matchesDepartment(row.department_name)) return false;
      if (noSalaryOnly && hasSalary(row.employee_id)) return false;
      if (!query) return true;
      const haystack = `${row.client_name || ''} ${row.lead_number || ''} ${row.is_other_work ? 'other work' : ''}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [hasSalary, leadQuery, matchesDepartment, noSalaryOnly, rows]);

  const scopedEffortRows = useMemo(() => {
    return effortRows.filter((row) => {
      if (!matchesDepartment(row.departmentName)) return false;
      if (noSalaryOnly && hasSalary(row.employeeId)) return false;
      return true;
    });
  }, [effortRows, hasSalary, matchesDepartment, noSalaryOnly]);

  useEffect(() => {
    if (!isSuperUser) return;
    let cancelled = false;
    setLeadForReady(false);
    const newIds = Array.from(
      new Set(rows.filter((row) => !row.is_other_work && row.new_lead_id).map((row) => row.new_lead_id as string)),
    );
    const legacyIds = Array.from(
      new Set(rows.filter((row) => !row.is_other_work && row.legacy_lead_id != null).map((row) => row.legacy_lead_id as number)),
    );
    const categorySelect = 'id, category, misc_category!category_id ( id, name, misc_maincategory!parent_id ( id, name ) )';
    const legacyCategorySelect =
      'id, category, misc_category!leads_lead_category_id_fkey ( id, name, misc_maincategory!parent_id ( id, name ) )';
    void (async () => {
      const targets = scoreboardTargets.length > 0 ? scoreboardTargets : await fetchAgreementScoreboardDepartments();
      const categories = await fetchCategoriesWithDepartments(supabase);
      const catalog = { targets, categories, nameMap: buildCategoryNameToDataMap(categories) };
      const [newLeads, legacyLeads] = await Promise.all([
        newIds.length
          ? fetchLeadRowsInChunks(newIds, (chunk) => supabase.from('leads').select(categorySelect).in('id', chunk as string[]))
          : Promise.resolve([]),
        legacyIds.length
          ? fetchLeadRowsInChunks(legacyIds, (chunk) =>
              supabase.from('leads_lead').select(legacyCategorySelect).in('id', chunk as number[]),
            )
          : Promise.resolve([]),
      ]);
      if (cancelled) return;
      const next = new Map<string, string>();
      for (const row of newLeads as Array<{ id: string }>) next.set(`new:${row.id}`, leadAgreementDepartment(row, catalog));
      for (const row of legacyLeads as Array<{ id: number }>) next.set(`legacy:${row.id}`, leadAgreementDepartment(row, catalog));
      setLeadForDepartment(next);
      setLeadForReady(true);
    })().catch((error) => {
      console.error('[EmployeeLeadAllocationsReport] lead departments failed:', error);
      if (!cancelled) setLeadForReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [isSuperUser, rows, scoreboardTargets]);

  const allocationLines = useMemo(() => {
    const lines: {
      employeeId: number;
      employeeName: string;
      photoUrl: string | null;
      departmentName: string | null;
      forDepartments: string[];
      workDate: string;
      workedMs: number;
      costNis: number | null;
    }[] = [];
    const handlingFor = (row: AllocationReportRow): string[] => {
      if (row.is_other_work || !leadForReady) return [];
      const key = row.new_lead_id
        ? `new:${row.new_lead_id}`
        : row.legacy_lead_id != null
          ? `legacy:${row.legacy_lead_id}`
          : '';
      return [(key && leadForDepartment.get(key)) || combinedGermanAustrian(scoreboardTargets)];
    };
    for (const row of scopedHandlingRows) {
      const dayMs = clockInMsByEmployeeDate.get(allocationEmployeeDateKey(row.employee_id, row.work_date)) ?? 0;
      const workedMs = allocationPercentToWorkedMs(dayMs, row.percent);
      const rate = salaryToHourlyRateNis(avgMonthlySalaryByEmployee.get(row.employee_id));
      lines.push({
        employeeId: row.employee_id,
        employeeName: row.employee_name,
        photoUrl: row.employee_photo_url,
        departmentName: row.department_name,
        forDepartments: handlingFor(row),
        workDate: String(row.work_date || '').slice(0, 10),
        workedMs,
        costNis: workedMsAtHourlyRateToCostNis(workedMs, rate),
      });
    }
    for (const row of scopedEffortRows) {
      const dayMs = clockInMsByEmployeeDate.get(allocationEmployeeDateKey(row.employeeId, row.workDate)) ?? 0;
      const workedMs = allocationPercentToWorkedMs(dayMs, row.percent);
      const rate = salaryToHourlyRateNis(avgMonthlySalaryByEmployee.get(row.employeeId));
      const names = row.targetDepartmentIds
        .map((id) => departments.find((dept) => dept.id === id)?.name || '')
        .map((name) => name.trim())
        .filter(Boolean);
      lines.push({
        employeeId: row.employeeId,
        employeeName: row.employeeName,
        photoUrl: row.employeePhotoUrl,
        departmentName: row.departmentName,
        forDepartments: names.length > 0 ? names : [GENERAL_EFFORT_DEPARTMENT_LABEL],
        workDate: row.workDate,
        workedMs,
        costNis: workedMsAtHourlyRateToCostNis(workedMs, rate),
      });
    }
    return lines;
  }, [
    avgMonthlySalaryByEmployee,
    clockInMsByEmployeeDate,
    departments,
    leadForDepartment,
    leadForReady,
    scopedEffortRows,
    scopedHandlingRows,
    scoreboardTargets,
  ]);

  const departmentTotals = useMemo(
    () =>
      buildForDepartmentTotals(
        allocationLines.map((line) => ({
          forDepartments: line.forDepartments.map((name) => mergedEmployeeDepartmentName(name, scoreboardTargets)),
          workedMs: line.workedMs,
          costNis: line.costNis,
        })),
        departments.map((dept) => ({
          ...dept,
          name: mergedEmployeeDepartmentName(dept.name, scoreboardTargets),
        })),
      ),
    [allocationLines, departments, scoreboardTargets],
  );

  const employeeTotals = useMemo(() => {
    const byEmployee = new Map<
      number,
      {
        employeeId: number;
        employeeName: string;
        photoUrl: string | null;
        departmentName: string | null;
        workedMs: number;
        costNis: number;
        lastWorkDate: string | null;
      }
    >();
    for (const line of allocationLines) {
      const current = byEmployee.get(line.employeeId) || {
        employeeId: line.employeeId,
        employeeName: line.employeeName,
        photoUrl: line.photoUrl,
        departmentName: null,
        workedMs: 0,
        costNis: 0,
        lastWorkDate: null,
      };
      if (!current.photoUrl && line.photoUrl) current.photoUrl = line.photoUrl;
      const department = mergedEmployeeDepartmentName(line.departmentName || '', scoreboardTargets);
      if (department && department !== 'No department') current.departmentName = department;
      if (line.workDate && (!current.lastWorkDate || line.workDate > current.lastWorkDate)) {
        current.lastWorkDate = line.workDate;
      }
      current.workedMs += line.workedMs;
      current.costNis += line.costNis || 0;
      byEmployee.set(line.employeeId, current);
    }
    return [...byEmployee.values()];
  }, [allocationLines, scoreboardTargets]);

  const employeeGroups = useMemo(
    () => groupRowsByEmployee(scopedHandlingRows, clockInMsByEmployeeDate, avgMonthlySalaryByEmployee),
    [scopedHandlingRows, clockInMsByEmployeeDate, avgMonthlySalaryByEmployee],
  );

  const pendingOvertimeByKey = useMemo(() => {
    const minByEmployee = new Map<number, number>();
    const nameByEmployee = new Map<number, string>();
    for (const row of rows) {
      if (!minByEmployee.has(row.employee_id)) {
        minByEmployee.set(row.employee_id, row.employee_min_hours);
        nameByEmployee.set(row.employee_id, row.employee_name);
      }
    }

    const sessionsByKey = new Map<string, ClockInForAllocationMs[]>();
    for (const record of clockRecords) {
      const employeeId = record.employee_id;
      if (employeeId == null || record.declined === true || !record.clock_out_time) continue;
      const dateKey = getJerusalemTodayIsoDate(new Date(record.clock_in_time));
      const key = allocationEmployeeDateKey(employeeId, dateKey);
      const list = sessionsByKey.get(key);
      if (list) list.push(record);
      else sessionsByKey.set(key, [record]);
    }

    const pending = new Map<string, PendingOvertimeDay>();
    for (const [key, sessions] of sessionsByKey) {
      const employeeId = Number(key.split('|')[0]);
      const dateKey = key.slice(key.indexOf('|') + 1);
      const baseHours = minByEmployee.get(employeeId);
      if (baseHours == null) continue;
      const totalMs = clockInMsByEmployeeDate.get(key) ?? 0;
      if (totalMs <= minHoursToMs(baseHours)) continue;
      const unapproved = sessions.filter((session) => session.approved !== true && Number(session.id) > 0);
      if (unapproved.length === 0) continue;
      const earliest = sessions.reduce((best, session) =>
        session.clock_in_time < best.clock_in_time ? session : best,
      );
      const latest = sessions.reduce((best, session) =>
        (session.clock_out_time || '') > (best.clock_out_time || '') ? session : best,
      );
      pending.set(key, {
        employeeId,
        employeeName: nameByEmployee.get(employeeId) || 'Employee',
        dateKey,
        clockInIds: unapproved.map((session) => Number(session.id)).filter((id) => id > 0),
        clockInTime: jerusalemClockTime(earliest.clock_in_time),
        clockOutTime: jerusalemClockTime(latest.clock_out_time || earliest.clock_in_time),
        extraMinutes: Math.max(0, Math.round(totalMs / 60000) - Math.round(baseHours * 60)),
        baseHours,
        locationId: unapproved.find((session) => session.clock_in_location_id)?.clock_in_location_id ?? null,
      });
    }
    return pending;
  }, [rows, clockRecords, clockInMsByEmployeeDate]);

  const sendRecognizedOvertime = async () => {
    if (!overtimeTarget) return;
    const reason = overtimeReason.trim();
    if (!reason) {
      toast.error('Write the reason for the extra hours');
      return;
    }
    setSendingOvertime(true);
    try {
      const workplace = workplaces.find((item) => item.id === overtimeTarget.locationId)?.name || 'Not set';
      await requestMichaelOvertimeApproval({
        employeeId: overtimeTarget.employeeId,
        reason,
        hours: formatOvertimeHoursPlaceholder({
          minutes: overtimeTarget.extraMinutes,
          dateKey: overtimeTarget.dateKey,
          from: overtimeTarget.clockInTime,
          to: overtimeTarget.clockOutTime,
        }),
        workplace,
        date: formatOvertimeDatePlaceholder([overtimeTarget.dateKey]),
        clockInIds: overtimeTarget.clockInIds,
      });
      toast.success(`Message sent to Michael Decker for ${overtimeTarget.employeeName}.`);
      setOvertimeTarget(null);
      setOvertimeReason('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not send the overtime request');
    } finally {
      setSendingOvertime(false);
    }
  };

  const multiDayView = dateMode !== 'day';

  const handleSort = useCallback((key: string) => {
    const next = toggleReportSort(sortKey, sortDir, key);
    setSortKey(next.key as AllocationNumericSortKey);
    setSortDir(next.dir);
  }, [sortKey, sortDir]);

  const visibleEmployeeGroups = useMemo(() => {
    if (!overBudgetOnly) return employeeGroups;
    return employeeGroups
      .map((group) => {
        const days = group.days
          .map((day) => ({
            ...day,
            rows: day.rows.filter((row) => {
              const key = allocationLeadBudgetKey(row);
              if (!key) return false;
              return budgetByLeadKey.get(key)?.exceedsCap === true;
            }),
          }))
          .filter((day) => day.rows.length > 0);
        return {
          ...group,
          days,
          totalWorkedMs: days.reduce((sum, day) => sum + day.totalWorkedMs, 0),
        };
      })
      .filter((group) => group.days.length > 0);
  }, [employeeGroups, overBudgetOnly, budgetByLeadKey]);

  const visibleMissingReporting = useMemo(
    () => missingReportingBacklog.filter((row) => matchesDepartment(row.departmentName)),
    [matchesDepartment, missingReportingBacklog],
  );

  const reportTotals = useMemo(() => {
    let totalWorkedMs = 0;
    let totalCostNis = 0;
    let hasAnyCost = false;
    const uniqueEmployees = new Set<number>();

    for (const group of employeeGroups) {
      uniqueEmployees.add(group.employeeId);
      totalWorkedMs += group.totalWorkedMs;
      const employeeCost = sumEmployeeAllocationRowCostsNis(group);
      if (employeeCost != null) {
        totalCostNis += employeeCost;
        hasAnyCost = true;
      }
    }

    const visibleLeadKeys = new Set(
      scopedHandlingRows
        .map((row) => allocationLeadBudgetKey(row))
        .filter((key): key is string => Boolean(key)),
    );
    const overBudgetLeadCount = Array.from(budgetByLeadKey.entries()).filter(
      ([key, status]) => visibleLeadKeys.has(key) && status.exceedsCap,
    ).length;

    return {
      employeeCount: uniqueEmployees.size,
      missingReportingCount: visibleMissingReporting.length,
      totalWorkedMs,
      totalCostNis: hasAnyCost ? Math.round(totalCostNis * 100) / 100 : null,
      overBudgetLeadCount,
    };
  }, [employeeGroups, visibleMissingReporting.length, budgetByLeadKey, scopedHandlingRows]);

  useEffect(() => {
    let cancelled = false;
    void fetchCustomWorkEfforts()
      .then((list) => {
        if (!cancelled) setCustomEfforts(list);
      })
      .catch((error) => {
        console.error('[EmployeeLeadAllocationsReport] custom efforts failed:', error);
        if (!cancelled) setCustomEfforts([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const ids = [...new Set(rows.flatMap((row) => row.subEffortIds ?? []))];
    if (ids.length === 0) {
      setSubEffortNames(new Map());
      return;
    }
    let cancelled = false;
    void supabase
      .from('sub_efforts')
      .select('id, name')
      .in('id', ids)
      .then(({ data, error }) => {
        if (cancelled || error) return;
        setSubEffortNames(
          new Map(
            (data || []).map((row) => [
              Number(row.id),
              String(row.name || '').trim() || `Sub effort #${row.id}`,
            ]),
          ),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [rows]);

  const dateQuery = useMemo(() => {
    const params = new URLSearchParams();
    params.set('range', dateMode);
    if (dateMode === 'day') params.set('date', workDate);
    if (dateMode === 'period') {
      params.set('from', rangeFrom);
      params.set('to', rangeTo);
    }
    return params.toString();
  }, [dateMode, rangeFrom, rangeTo, workDate]);

  if (!permissionsLoaded || !isSuperUser) {
    return (
      <div className="flex min-h-[calc(100dvh-3.5rem)] items-center justify-center bg-[#ececec]">
        <ReportLoadingScreen title="Hours allocation" subtitle="Opening the report…" icon={ClipboardDocumentListIcon} />
      </div>
    );
  }

  return (
    <div className="employee-lead-allocations-report-shell min-h-[calc(100dvh-3.5rem)] bg-[#ececec]">
      <div className="flex min-h-[calc(100dvh-3.5rem)] w-full items-stretch">
          <HoursAllocationNav dateQuery={dateQuery} />
          <div className="hours-nav-page min-w-0 flex-1 space-y-5 px-4 pb-[max(2.5rem,env(safe-area-inset-bottom,0px))] pt-4 md:px-8 md:pb-12 md:pt-6">
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <ClipboardDocumentListIcon className="h-7 w-7" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-gray-900">Hours allocation</h1>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-gray-200 transition-colors hover:bg-gray-50"
                onClick={() => navigate('/reports/leads-management')}
              >
                <ChartBarIcon className="h-5 w-5 text-primary" />
                Leads management
                <ArrowRightIcon className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="block lg:col-span-1">
              <span className="mb-1.5 block text-sm font-medium text-gray-600">Date</span>
              <div className="flex flex-col gap-2">
                <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                {dateMode === 'day' ? (
                  <input
                    type="date"
                    className="input h-10 min-h-10 min-w-[11rem] rounded-[14px] border-0 bg-white px-3 ring-1 ring-gray-200 focus:outline-none focus:ring-2 focus:ring-primary/15"
                    value={workDate}
                    max={getJerusalemTodayIsoDate()}
                    onChange={(e) => {
                      const next = e.target.value;
                      if (!next) return;
                      setWorkDate(next);
                      setDateMode('day');
                    }}
                  />
                ) : dateMode === 'all' ? (
                  <div className="flex h-10 min-w-[11rem] items-center rounded-[14px] bg-white px-3 text-sm text-gray-600 ring-1 ring-gray-200">
                    All reporting
                  </div>
                ) : (
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="min-w-[9rem] flex-1">
                      <input
                        aria-label="From"
                        type="date"
                        className="input h-10 min-h-10 w-full rounded-[14px] border-0 bg-white px-3 ring-1 ring-gray-200 focus:outline-none focus:ring-2 focus:ring-primary/15"
                        value={rangeFrom}
                        max={rangeTo || getJerusalemTodayIsoDate()}
                        onChange={(e) => {
                          const next = e.target.value;
                          if (!next) return;
                          setRangeFrom(next);
                        }}
                      />
                    </label>
                    <label className="min-w-[9rem] flex-1">
                      <input
                        aria-label="To"
                        type="date"
                        className="input h-10 min-h-10 w-full rounded-[14px] border-0 bg-white px-3 ring-1 ring-gray-200 focus:outline-none focus:ring-2 focus:ring-primary/15"
                        value={rangeTo}
                        min={rangeFrom || undefined}
                        max={getJerusalemTodayIsoDate()}
                        onChange={(e) => {
                          const next = e.target.value;
                          if (!next) return;
                          setRangeTo(next);
                        }}
                      />
                    </label>
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
                    className={dateFilterButtonClass(dateMode === 'period')}
                    aria-pressed={dateMode === 'period'}
                    onClick={() => setDateMode('period')}
                  >
                    Period
                  </button>
                  <button
                    type="button"
                    className={dateFilterButtonClass(dateMode === 'all')}
                    aria-pressed={dateMode === 'all'}
                    onClick={() => setDateMode('all')}
                  >
                    Show all
                  </button>
                  {dateMode !== 'day' ? (
                    <button
                      type="button"
                      className="inline-flex h-10 items-center rounded-[14px] px-3 text-sm font-medium text-gray-500 transition-colors hover:bg-white hover:text-gray-700"
                      onClick={() => setDateMode('day')}
                    >
                      Day
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={dateFilterButtonClass(noSalaryOnly)}
                    aria-pressed={noSalaryOnly}
                    onClick={() => setNoSalaryOnly((prev) => !prev)}
                  >
                    No salary
                  </button>
                </div>
                ) : null}
              </div>
            </div>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-gray-600">Department</span>
              <select
                className="select h-10 min-h-10 w-full rounded-[14px] border-0 bg-white px-3 ring-1 ring-gray-200 focus:outline-none focus:ring-2 focus:ring-primary/15"
                value={departmentName}
                onChange={(e) => setDepartmentName(e.target.value)}
              >
                <option value="">All departments</option>
                {departmentOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-gray-600">Lead</span>
              <div className="flex min-h-[40px] items-center gap-2.5 rounded-[14px] bg-white px-3 ring-1 ring-gray-200 focus-within:ring-2 focus-within:ring-primary/15">
                <MagnifyingGlassIcon className="h-4 w-4 shrink-0 text-black" />
                <input
                  type="search"
                  className="grow bg-transparent text-sm outline-none placeholder:text-gray-400"
                  placeholder="Client or lead #"
                  value={leadQuery}
                  onChange={(e) => setLeadQuery(e.target.value)}
                />
              </div>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-gray-600">Employee search</span>
              <div className="flex min-h-[40px] items-center gap-2.5 rounded-[14px] bg-white px-3 ring-1 ring-gray-200 focus-within:ring-2 focus-within:ring-primary/15">
                <MagnifyingGlassIcon className="h-4 w-4 shrink-0 text-black" />
                <input
                  type="search"
                  className="grow bg-transparent text-sm outline-none placeholder:text-gray-400"
                  placeholder="Name…"
                  value={employeeSearch}
                  onChange={(e) => setEmployeeSearch(e.target.value)}
                />
              </div>
            </label>

          </div>

          {loading ? (
            <ReportLoadingScreen title="Loading hours" subtitle="Gathering reported time…" icon={ClockIcon} />
          ) : (
          <>
          <DepartmentHourTotals totals={departmentTotals} carousel />

          <HoursEmployeeCarousel
            employees={employeeTotals}
            clockedInIds={clockedInIds}
            to={(employeeId) => {
              const params = new URLSearchParams();
              params.set('range', dateMode);
              if (dateMode === 'day') params.set('date', workDate);
              if (dateMode === 'period') {
                params.set('from', rangeFrom);
                params.set('to', rangeTo);
              }
              return `/reports/hours-allocation/employees/${employeeId}?${params.toString()}`;
            }}
          />

          <HoursAllocationCharts departments={departmentTotals} employees={employeeTotals} />

          <AllocationAreaOverview
            handlingRows={scopedHandlingRows}
            effortRows={scopedEffortRows}
            clockInMsByEmployeeDate={clockInMsByEmployeeDate}
            salaryByEmployee={avgMonthlySalaryByEmployee}
            customEfforts={customEfforts}
            areaPath={(id) => `/reports/hours-allocation/${id}`}
            hint={
              leadQuery.trim()
                ? 'Lead search narrows handling. The other areas follow date, department, employee, and the salary filter.'
                : 'Open an area for the full hours table.'
            }
          />

          <ReportTotalsBar
            totals={reportTotals}
            onMissingReportingClick={() => setMissingReportingModalOpen(true)}
            overBudgetOnly={overBudgetOnly}
            onToggleOverBudget={() => setOverBudgetOnly((prev) => !prev)}
          />

          <MissingReportingModal
            open={missingReportingModalOpen}
            employees={visibleMissingReporting}
            loading={missingReportingLoading}
            clockedInIds={clockedInIds}
            onClose={() => setMissingReportingModalOpen(false)}
          />
          </>
          )}

          </div>
      </div>

      <LeadAllocationOvertimeApprovalModal
        open={overtimeTarget != null}
        clockInTime={overtimeTarget?.clockInTime || ''}
        clockOutTime={overtimeTarget?.clockOutTime || ''}
        dateKey={overtimeTarget?.dateKey || ''}
        baseHours={overtimeTarget?.baseHours || 8}
        employeeName={overtimeTarget?.employeeName}
        busy={sendingOvertime}
        reason={overtimeReason}
        onReasonChange={setOvertimeReason}
        onSend={() => void sendRecognizedOvertime()}
        onClose={() => {
          if (sendingOvertime) return;
          setOvertimeTarget(null);
        }}
      />

      <LeadBudgetRequestsHistoryModal
        open={Boolean(historyLead)}
        leadLabel={historyLead?.label || ''}
        requests={historyLead?.status.budgetRequests || []}
        onClose={() => setHistoryLead(null)}
      />
      <LeadBudgetRequestReviewModal
        open={Boolean(reviewRequest)}
        request={reviewRequest}
        submitting={reviewSubmitting}
        onClose={() => setReviewRequest(null)}
        onConfirm={handleReviewConfirm}
      />
    </div>
  );
};

export default EmployeeLeadAllocationsReportPage;
