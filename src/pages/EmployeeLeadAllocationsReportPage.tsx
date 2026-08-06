import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BanknotesIcon,
  ChartBarIcon,
  ClipboardDocumentListIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
  UsersIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import {
  GradientSummaryCard,
  REPORT_SUMMARY_GRADIENTS,
} from '../components/reports/GradientSummaryCard';
import { supabase } from '../lib/supabase';
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
  formatAllocationCostNis,
  formatAllocationPercent,
  formatAllocationWorkedDuration,
  formatLeadAllocationMissingDayLabel,
  getJerusalemTodayIsoDate,
  minHoursToMs,
  salaryToHourlyRateNis,
  workedMsAtHourlyRateToCostNis,
  type AllocationReportRow,
  type MissingLeadReportingBacklogRow,
} from '../lib/employeeLeadReporting';
import { fetchClockInRecordsForAllocationMs } from '../lib/workingHoursExport';
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
}: {
  employeeId: number;
  employeeName: string;
  photoUrl: string | null;
  size?: 'md' | 'lg';
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const resolvedUrl = photoUrl?.trim() || '';
  const showImage = Boolean(resolvedUrl) && !imageFailed;
  const dim = size === 'lg' ? 'h-16 w-16 text-base' : 'h-12 w-12 text-sm';

  useEffect(() => {
    setImageFailed(false);
  }, [resolvedUrl]);

  if (showImage) {
    return (
      <img
        src={resolvedUrl}
        alt=""
        className={`${dim} shrink-0 rounded-full object-cover shadow-md`}
        onError={() => setImageFailed(true)}
      />
    );
  }

  return (
    <span
      className={`flex ${dim} shrink-0 items-center justify-center rounded-full font-bold text-white shadow-md`}
      style={salaryAvatarGradientStyle(employeeId, employeeName)}
      aria-hidden
    >
      {getSalaryEmployeeInitials(employeeName)}
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
  onClose,
}: {
  open: boolean;
  employees: MissingLeadReportingBacklogRow[];
  loading: boolean;
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
}: {
  group: EmployeeAllocationGroup;
  totalCostNis: number | null;
  multiDay: boolean;
  embedded?: boolean;
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
  onOpenBudgetHistory: (status: AllocationLeadBudgetStatus, row: AllocationReportRow) => void;
  onReviewRequest: (request: LeadBudgetExtensionRequest) => void;
};

function AllocationReportTableRow({
  row,
  totalWorkedMs,
  salaryHourRateNis,
  budgetStatus,
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
}: EmployeeAllocationSectionProps) {
  const totalCostNis = sumEmployeeAllocationRowCostsNis(group);
  const showDayBreaks = multiDay && group.days.length > 1;

  return (
    <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-100">
      <EmployeeAllocationHeader
        group={group}
        totalCostNis={totalCostNis}
        multiDay={multiDay}
        embedded
      />

      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr className="border-b border-gray-100 text-xs uppercase tracking-wider text-gray-500">
              <th>Lead</th>
              <th>Client</th>
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
                      <td colSpan={9} className="!py-2.5">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold uppercase tracking-wider text-gray-500">
                          <span className="text-gray-800">
                            {formatAllocationGroupDateLabel(day.workDate)}
                          </span>
                          <span className="font-medium normal-case tracking-normal text-gray-500">
                            {formatAllocationWorkedDuration(day.totalWorkedMs)} worked
                          </span>
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

const EmployeeLeadAllocationsReportPage: React.FC = () => {
  const navigate = useNavigate();
  const [isSuperUser, setIsSuperUser] = useState(false);
  const [permissionsLoaded, setPermissionsLoaded] = useState(false);
  const [dateMode, setDateMode] = useState<DateFilterMode>('day');
  const [workDate, setWorkDate] = useState(() => getJerusalemTodayIsoDate());
  const [rangeFrom, setRangeFrom] = useState(() =>
    shiftIsoDate(getJerusalemTodayIsoDate(), -6),
  );
  const [rangeTo, setRangeTo] = useState(() => getJerusalemTodayIsoDate());
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [departmentId, setDepartmentId] = useState<string>('');
  const [departments, setDepartments] = useState<{ id: number; name: string }[]>([]);
  const [rows, setRows] = useState<AllocationReportRow[]>([]);
  const [clockInMsByEmployeeDate, setClockInMsByEmployeeDate] = useState<Map<string, number>>(
    () => new Map(),
  );
  const [missingReportingBacklog, setMissingReportingBacklog] = useState<
    MissingLeadReportingBacklogRow[]
  >([]);
  const [missingReportingLoading, setMissingReportingLoading] = useState(false);
  const [avgMonthlySalaryByEmployee, setAvgMonthlySalaryByEmployee] = useState<Map<number, number>>(
    () => new Map(),
  );
  const [missingReportingModalOpen, setMissingReportingModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [budgetByLeadKey, setBudgetByLeadKey] = useState<Map<string, AllocationLeadBudgetStatus>>(
    () => new Map(),
  );
  const [overBudgetOnly, setOverBudgetOnly] = useState(false);
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
    if (!isSuperUser) return;
    void fetchDepartmentsForFilter()
      .then(setDepartments)
      .catch((error) => {
        console.error('[EmployeeLeadAllocationsReport] departments failed:', error);
      });
  }, [isSuperUser]);

  const loadReport = useCallback(async () => {
    if (!isSuperUser) return;
    setLoading(true);
    try {
      const { fromDate, toDate } = resolvedDateRange;
      const data = await fetchAllocationReport({
        fromDate,
        toDate,
        departmentId: departmentId ? Number(departmentId) : null,
        employeeSearch,
      });

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

      const clockRecords = await fetchClockInRecordsForAllocationMs(clockFrom, clockTo);
      const clockInMs = buildAllocationClockInMsByEmployeeDate(clockRecords);
      const employeeIds = Array.from(
        new Set([
          ...data.map((row) => row.employee_id),
          ...Array.from(clockInMs.keys()).map((key) => Number(key.split('|')[0])),
        ]),
      ).filter((id) => Number.isFinite(id));
      const salaryMap = await fetchAverageGrossSalaryLastMonths(employeeIds, 6);

      setRows(data);
      setClockInMsByEmployeeDate(clockInMs);
      setAvgMonthlySalaryByEmployee(salaryMap);

      void fetchAllocationLeadBudgetStatuses(data)
        .then((statuses) => {
          setBudgetByLeadKey(statuses);
        })
        .catch((budgetError) => {
          console.error('[EmployeeLeadAllocationsReport] budget status failed:', budgetError);
          setBudgetByLeadKey(new Map());
        });
    } catch (error) {
      console.error('[EmployeeLeadAllocationsReport] load failed:', error);
      toast.error(
        error instanceof Error ? error.message : 'Failed to load allocation report.',
      );
      setRows([]);
      setClockInMsByEmployeeDate(new Map());
      setAvgMonthlySalaryByEmployee(new Map());
      setBudgetByLeadKey(new Map());
    } finally {
      setLoading(false);
    }
  }, [isSuperUser, resolvedDateRange, departmentId, employeeSearch]);

  const loadMissingReportingBacklog = useCallback(async () => {
    if (!isSuperUser) return;
    setMissingReportingLoading(true);
    try {
      const backlog = await fetchMissingLeadReportingBacklog({
        departmentId: departmentId ? Number(departmentId) : null,
        employeeSearch,
      });
      setMissingReportingBacklog(backlog);
    } catch (error) {
      console.error('[EmployeeLeadAllocationsReport] missing backlog failed:', error);
      toast.error('Failed to load missing reporting backlog.');
      setMissingReportingBacklog([]);
    } finally {
      setMissingReportingLoading(false);
    }
  }, [isSuperUser, departmentId, employeeSearch]);

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

  const employeeGroups = useMemo(
    () => groupRowsByEmployee(rows, clockInMsByEmployeeDate, avgMonthlySalaryByEmployee),
    [rows, clockInMsByEmployeeDate, avgMonthlySalaryByEmployee],
  );

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

    const overBudgetLeadCount = Array.from(budgetByLeadKey.values()).filter(
      (status) => status.exceedsCap,
    ).length;

    return {
      employeeCount: uniqueEmployees.size,
      missingReportingCount: missingReportingBacklog.length,
      totalWorkedMs,
      totalCostNis: hasAnyCost ? Math.round(totalCostNis * 100) / 100 : null,
      overBudgetLeadCount,
    };
  }, [employeeGroups, missingReportingBacklog.length, budgetByLeadKey]);

  if (!permissionsLoaded || !isSuperUser) {
    return (
      <div className="flex min-h-[calc(100dvh-3.5rem)] items-center justify-center bg-[#ececec]">
        <span className="loading loading-spinner loading-lg text-primary" />
      </div>
    );
  }

  return (
    <div className="employee-lead-allocations-report-shell min-h-[calc(100dvh-3.5rem)] bg-[#ececec]">
      <div className="flex min-w-0 w-full flex-col px-4 pb-[max(2.5rem,env(safe-area-inset-bottom,0px))] pt-2 md:px-8 md:pb-12 md:pt-4">
        <div className="space-y-5">
          <div className="flex w-full flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <ClipboardDocumentListIcon className="h-7 w-7" />
              </div>
              <div className="min-w-0 text-left">
                <h1 className="text-2xl font-bold tracking-tight text-gray-900">
                  Employee lead allocations
                </h1>
                <p className="mt-0.5 text-sm text-gray-500">
                  Daily time split per lead across all employees
                </p>
              </div>
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
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
                onClick={() => navigate('/reports')}
              >
                <ArrowLeftIcon className="h-4 w-4" />
                Back
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="block lg:col-span-1">
              <span className="mb-1.5 block text-sm font-medium text-gray-600">Date</span>
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  {dateMode === 'day' ? (
                    <input
                      type="date"
                      className="input h-10 min-h-10 min-w-[11rem] flex-1 rounded-[14px] border-0 bg-transparent px-3 ring-1 ring-gray-300/80 focus:outline-none focus:ring-2 focus:ring-primary/15"
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
                    <div className="flex h-10 min-w-[11rem] flex-1 items-center rounded-[14px] bg-white px-3 text-sm text-gray-600 ring-1 ring-gray-200">
                      All reporting
                    </div>
                  ) : null}
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
                </div>
                {dateMode === 'period' ? (
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="min-w-[9rem] flex-1">
                      <span className="mb-1 block text-xs font-medium text-gray-500">From</span>
                      <input
                        type="date"
                        className="input h-10 min-h-10 w-full rounded-[14px] border-0 bg-transparent px-3 ring-1 ring-gray-300/80 focus:outline-none focus:ring-2 focus:ring-primary/15"
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
                      <span className="mb-1 block text-xs font-medium text-gray-500">To</span>
                      <input
                        type="date"
                        className="input h-10 min-h-10 w-full rounded-[14px] border-0 bg-transparent px-3 ring-1 ring-gray-300/80 focus:outline-none focus:ring-2 focus:ring-primary/15"
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
                ) : null}
              </div>
            </div>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-gray-600">Department</span>
              <select
                className="select h-10 min-h-10 w-full rounded-[14px] border-0 bg-transparent px-3 ring-1 ring-gray-300/80 focus:outline-none focus:ring-2 focus:ring-primary/15"
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
              >
                <option value="">All departments</option>
                {departments.map((dept) => (
                  <option key={dept.id} value={String(dept.id)}>
                    {dept.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-gray-600">Employee search</span>
              <div className="flex min-h-[40px] items-center gap-2.5 rounded-[14px] bg-transparent ring-1 ring-gray-300/80 focus-within:ring-2 focus-within:ring-primary/15 px-3">
                <MagnifyingGlassIcon className="h-4 w-4 shrink-0 text-gray-400" />
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

          {!loading && (
            <ReportTotalsBar
              totals={reportTotals}
              onMissingReportingClick={() => setMissingReportingModalOpen(true)}
              overBudgetOnly={overBudgetOnly}
              onToggleOverBudget={() => setOverBudgetOnly((prev) => !prev)}
            />
          )}

          <MissingReportingModal
            open={missingReportingModalOpen}
            employees={missingReportingBacklog}
            loading={missingReportingLoading}
            onClose={() => setMissingReportingModalOpen(false)}
          />

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <span className="loading loading-spinner loading-lg text-primary" />
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded-2xl bg-white px-6 py-16 text-center text-sm text-gray-500 shadow-sm ring-1 ring-gray-100">
              No allocations found for these filters.
            </div>
          ) : visibleEmployeeGroups.length === 0 ? (
            <div className="rounded-2xl bg-white px-6 py-16 text-center text-sm text-gray-500 shadow-sm ring-1 ring-gray-100">
              No over-budget leads for these filters.
            </div>
          ) : (
            <div className="space-y-5">
              {visibleEmployeeGroups.map((group) => (
                <EmployeeAllocationSection
                  key={group.employeeId}
                  group={group}
                  multiDay={multiDayView}
                  budgetByLeadKey={budgetByLeadKey}
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                  onOpenBudgetHistory={(status, row) =>
                    setHistoryLead({
                      label: `${row.client_name} · #${row.lead_number}`,
                      status,
                    })
                  }
                  onReviewRequest={setReviewRequest}
                />
              ))}
            </div>
          )}
        </div>
      </div>

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
