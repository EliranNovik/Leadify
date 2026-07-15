import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import {
  ArrowLeftIcon,
  BanknotesIcon,
  ClipboardDocumentListIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
  UsersIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import {
  allocationPercentToWorkedMs,
  buildClientRouteFromAllocationRow,
  compareWorkedHoursToMin,
  buildDailyClockInMsByEmployee,
  collectClockedOutEmployeesForDay,
  listMissingLeadReportingEmployees,
  fetchAllocationReport,
  fetchDepartmentsForFilter,
  fetchSubmittedAllocationEmployeeIds,
  formatAllocationCostNis,
  formatAllocationPercent,
  formatAllocationWorkedDuration,
  getJerusalemTodayIsoDate,
  minHoursToMs,
  salaryToHourlyRateNis,
  workedMsAtHourlyRateToCostNis,
  type AllocationReportRow,
  type ClockedOutEmployeeRef,
  type MissingLeadReportingEmployee,
} from '../lib/employeeLeadReporting';
import { fetchClockInRecordsInRange } from '../lib/workingHoursExport';
import {
  fetchAverageGrossSalaryLastMonths,
  getSalaryEmployeeInitials,
  salaryAvatarGradientStyle,
} from '../lib/employeeSalaries';

function formatSubmittedAt(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso));
}

type EmployeeAllocationGroup = {
  employeeId: number;
  employeeName: string;
  employeePhotoUrl: string | null;
  departmentName: string | null;
  minHours: number;
  /** Average monthly gross salary (last 6 months). Total cost = this salary. */
  avgMonthlySalaryNis: number | null;
  /** Salary ÷ (min hours × 22 workdays). */
  salaryHourRateNis: number | null;
  totalWorkedMs: number;
  rows: AllocationReportRow[];
};

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
        className={`${dim} shrink-0 rounded-full object-cover ring-4 ring-white shadow-md`}
        onError={() => setImageFailed(true)}
      />
    );
  }

  return (
    <span
      className={`flex ${dim} shrink-0 items-center justify-center rounded-full font-bold text-white ring-4 ring-white shadow-md`}
      style={salaryAvatarGradientStyle(employeeId, employeeName)}
      aria-hidden
    >
      {getSalaryEmployeeInitials(employeeName)}
    </span>
  );
}

type StatTileProps = {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'danger' | 'success' | 'primary';
  outlined?: boolean;
  variant?: 'muted' | 'card';
  icon?: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  onClick?: () => void;
};

function StatTile({
  label,
  value,
  hint,
  tone = 'default',
  outlined = true,
  variant = 'muted',
  icon: Icon,
  onClick,
}: StatTileProps) {
  const toneClass =
    variant === 'card'
      ? 'bg-white shadow-sm ring-1 ring-gray-100'
      : tone === 'danger'
        ? 'bg-red-50/80'
        : tone === 'success'
          ? 'bg-emerald-50/80'
          : tone === 'primary'
            ? 'bg-primary/5'
            : 'bg-gray-50/90';

  const valueClass =
    tone === 'danger'
      ? 'text-red-700'
      : tone === 'success'
        ? 'text-emerald-700'
        : tone === 'primary'
          ? 'text-primary'
          : 'text-gray-900';

  const iconClass =
    tone === 'danger'
      ? 'bg-red-100 text-red-600'
      : tone === 'success'
        ? 'bg-emerald-100 text-emerald-600'
        : tone === 'primary'
          ? 'bg-primary/10 text-primary'
          : 'bg-gray-100 text-gray-600';

  const outlineClass = variant === 'card' || !outlined ? '' : 'ring-1 ring-gray-100';
  const interactiveClass = onClick
    ? 'cursor-pointer text-left transition hover:ring-2 hover:ring-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30'
    : '';

  const isCard = variant === 'card';
  const labelClass = 'text-[10px] font-semibold uppercase tracking-wider text-gray-500';
  const valueSizeClass = isCard ? 'text-2xl' : 'text-lg';
  const iconBoxClass = isCard ? 'h-12 w-12 rounded-2xl' : 'h-10 w-10 rounded-xl';
  const iconSizeClass = isCard ? 'h-6 w-6' : 'h-5 w-5';
  const paddingClass = isCard ? 'px-5 py-4 md:px-6 md:py-5' : 'px-4 py-3';

  const content = (
    <div className={`flex items-start justify-between ${isCard ? 'gap-4' : 'gap-3'}`}>
      <div className="min-w-0 flex-1">
        <p className={labelClass}>{label}</p>
        <p className={`mt-1.5 font-bold leading-tight ${valueSizeClass} ${valueClass}`}>{value}</p>
        {hint ? <p className="mt-0.5 text-xs text-gray-500">{hint}</p> : null}
      </div>
      {Icon ? (
        <span
          className={`flex shrink-0 items-center justify-center ${iconBoxClass} ${iconClass}`}
          aria-hidden
        >
          <Icon className={iconSizeClass} />
        </span>
      ) : null}
    </div>
  );

  const className = `w-full rounded-[18px] ${paddingClass} ${outlineClass} ${toneClass} ${interactiveClass}`;

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {content}
      </button>
    );
  }

  return <div className={className}>{content}</div>;
}

type ReportGrandTotals = {
  employeeCount: number;
  missingReportingCount: number;
  totalWorkedMs: number;
  totalCostNis: number | null;
};

function ReportTotalsBar({
  totals,
  onMissingReportingClick,
}: {
  totals: ReportGrandTotals;
  onMissingReportingClick: () => void;
}) {
  return (
    <section>
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
        All employees total
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
        <StatTile
          label="Employees"
          value={String(totals.employeeCount)}
          variant="card"
          icon={UsersIcon}
        />
        <StatTile
          label="Missing reporting"
          value={String(totals.missingReportingCount)}
          tone={totals.missingReportingCount > 0 ? 'danger' : 'success'}
          variant="card"
          icon={ExclamationTriangleIcon}
          onClick={onMissingReportingClick}
        />
        <StatTile
          label="Total worked"
          value={formatAllocationWorkedDuration(totals.totalWorkedMs)}
          tone="primary"
          variant="card"
          icon={ClockIcon}
        />
        <StatTile
          label="Total cost"
          value={formatAllocationCostNis(totals.totalCostNis)}
          variant="card"
          icon={BanknotesIcon}
        />
      </div>
    </section>
  );
}

function formatReportWorkDateLabel(workDate: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${workDate}T12:00:00`));
}

function MissingReportingModal({
  open,
  workDate,
  employees,
  onClose,
}: {
  open: boolean;
  workDate: string;
  employees: MissingLeadReportingEmployee[];
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div className="modal modal-open z-[110]">
      <div className="modal-box max-w-3xl max-h-[85vh] flex flex-col p-0 overflow-hidden">
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-4">
          <div>
            <h3 className="text-lg font-bold text-gray-900">Missing lead reporting</h3>
            <p className="mt-1 text-sm text-gray-500">
              {employees.length} employee{employees.length === 1 ? '' : 's'} clocked out on{' '}
              {formatReportWorkDateLabel(workDate)} without a submitted allocation
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
          {employees.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-500">
              No employees are missing reporting for the current filters.
            </p>
          ) : (
            <table className="table w-full">
              <thead>
                <tr className="text-xs uppercase tracking-wider text-gray-400">
                  <th className="bg-transparent">Employee</th>
                  <th className="bg-transparent">Department</th>
                  <th className="bg-transparent text-right">Worked</th>
                  <th className="bg-transparent text-right">Cost</th>
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
                    <td className="text-right text-sm font-medium text-gray-900">
                      {formatAllocationWorkedDuration(employee.workedMs)}
                    </td>
                    <td className="text-right text-sm font-medium text-gray-900">
                      {formatAllocationCostNis(employee.costNis)}
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

function EmployeeAllocationHeader({ group }: { group: EmployeeAllocationGroup }) {
  const comparison = compareWorkedHoursToMin(group.totalWorkedMs, group.minHours);
  const totalCostNis = sumEmployeeAllocationRowCostsNis(group);
  const minMs = minHoursToMs(group.minHours);
  const progressPercent =
    minMs > 0 ? Math.min(100, Math.round((group.totalWorkedMs / minMs) * 100)) : 0;

  const progressBarClass =
    comparison.status === 'below'
      ? 'bg-gradient-to-r from-red-500 to-red-400'
      : comparison.status === 'above'
        ? 'bg-gradient-to-r from-emerald-500 to-teal-500'
        : 'bg-gradient-to-r from-emerald-500 to-teal-500';

  return (
    <div className="overflow-hidden rounded-[18px] bg-white shadow-sm ring-1 ring-gray-100">
      <div className="bg-gradient-to-r from-gray-50/80 via-white to-white px-5 py-4 md:px-6 md:py-5">
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
              <p className="mt-0.5 text-sm text-gray-500">
                {group.departmentName || 'No department'}
              </p>
            </div>
          </div>

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
              <div className="h-2.5 overflow-hidden rounded-full bg-gray-100">
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
            <div className="flex flex-col justify-center rounded-2xl bg-gray-50/40 px-4 py-3 ring-1 ring-gray-100/70">
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
        </div>
      </div>
    </div>
  );
}

function groupRowsByEmployee(
  rows: AllocationReportRow[],
  clockInMsByEmployee: Map<number, number>,
  avgMonthlySalaryByEmployee: Map<number, number>,
): EmployeeAllocationGroup[] {
  const map = new Map<number, EmployeeAllocationGroup>();

  for (const row of rows) {
    let group = map.get(row.employee_id);
    if (!group) {
      const avgSalaryRaw = avgMonthlySalaryByEmployee.get(row.employee_id);
      const avgMonthlySalaryNis =
        avgSalaryRaw != null && Number.isFinite(avgSalaryRaw) && avgSalaryRaw > 0
          ? Math.round(avgSalaryRaw * 100) / 100
          : null;
      const minHours = row.employee_min_hours;
      group = {
        employeeId: row.employee_id,
        employeeName: row.employee_name,
        employeePhotoUrl: row.employee_photo_url,
        departmentName: row.department_name,
        minHours,
        avgMonthlySalaryNis,
        salaryHourRateNis: salaryToHourlyRateNis(avgMonthlySalaryNis, minHours),
        totalWorkedMs: clockInMsByEmployee.get(row.employee_id) ?? 0,
        rows: [],
      };
      map.set(row.employee_id, group);
    }
    group.rows.push(row);
  }

  return Array.from(map.values())
    .map((group) => ({
      ...group,
      rows: [...group.rows].sort((a, b) => {
        if (a.is_other_work !== b.is_other_work) return a.is_other_work ? 1 : -1;
        return a.lead_number.localeCompare(b.lead_number);
      }),
    }))
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName));
}

function allocationRowKey(row: AllocationReportRow): string {
  return `${row.allocation_id}-${row.is_other_work ? 'other' : row.lead_number}-${row.percent}`;
}

/** Sum of lead-row costs: each row’s allocated hours × salary hourly rate. */
function sumEmployeeAllocationRowCostsNis(group: EmployeeAllocationGroup): number | null {
  if (group.salaryHourRateNis == null) return null;
  let total = 0;
  for (const row of group.rows) {
    const workedMs = allocationPercentToWorkedMs(group.totalWorkedMs, row.percent);
    const rowCost = workedMsAtHourlyRateToCostNis(workedMs, group.salaryHourRateNis);
    if (rowCost != null) total += rowCost;
  }
  return Math.round(total * 100) / 100;
}

type AllocationReportRowCardProps = {
  row: AllocationReportRow;
  totalWorkedMs: number;
  salaryHourRateNis: number | null;
};

function AllocationReportRowCard({
  row,
  totalWorkedMs,
  salaryHourRateNis,
}: AllocationReportRowCardProps) {
  const workedMs = allocationPercentToWorkedMs(totalWorkedMs, row.percent);
  const rowCostNis = workedMsAtHourlyRateToCostNis(workedMs, salaryHourRateNis);

  return (
    <div className="rounded-[18px] bg-white px-5 py-4 shadow-sm">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6 lg:items-center lg:gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-600 lg:hidden">
            Lead
          </p>
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
        </div>

        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-600 lg:hidden">
            Client
          </p>
          <p className="text-sm text-gray-800">{row.client_name}</p>
        </div>

        <div className="min-w-0 lg:text-right">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-600 lg:hidden">
            %
          </p>
          <span className="inline-flex min-w-[3rem] justify-center rounded-md bg-primary/8 px-2 py-0.5 text-sm font-semibold text-primary lg:justify-end">
            {formatAllocationPercent(row.percent)}%
          </span>
        </div>

        <div className="min-w-0 lg:text-right">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-600 lg:hidden">
            Time
          </p>
          <span className="text-sm font-medium text-gray-800">
            {formatAllocationWorkedDuration(workedMs)}
          </span>
        </div>

        <div className="min-w-0 lg:text-right">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-600 lg:hidden">
            Cost
          </p>
          <span className="text-sm font-semibold text-gray-900">
            {formatAllocationCostNis(rowCostNis)}
          </span>
        </div>

        <div className="min-w-0 text-right">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-600 lg:hidden">
            Submitted
          </p>
          <p className="text-sm text-gray-500">{formatSubmittedAt(row.submitted_at)}</p>
        </div>
      </div>
    </div>
  );
}

type EmployeeAllocationSectionProps = {
  group: EmployeeAllocationGroup;
};

function EmployeeAllocationSection({ group }: EmployeeAllocationSectionProps) {
  return (
    <section className="space-y-2.5">
      <EmployeeAllocationHeader group={group} />

      <div className="hidden lg:grid lg:grid-cols-6 lg:gap-4 px-5 text-xs font-semibold uppercase tracking-wider text-gray-600">
        <span>Lead</span>
        <span>Client</span>
        <span className="text-right">%</span>
        <span className="text-right">Time</span>
        <span className="text-right">Cost</span>
        <span className="text-right">Submitted</span>
      </div>

      <div className="space-y-2.5">
        {group.rows.map((row) => (
          <AllocationReportRowCard
            key={allocationRowKey(row)}
            row={row}
            totalWorkedMs={group.totalWorkedMs}
            salaryHourRateNis={group.salaryHourRateNis}
          />
        ))}
      </div>
    </section>
  );
}

const EmployeeLeadAllocationsReportPage: React.FC = () => {
  const navigate = useNavigate();
  const [isSuperUser, setIsSuperUser] = useState(false);
  const [permissionsLoaded, setPermissionsLoaded] = useState(false);
  const [workDate, setWorkDate] = useState(() => getJerusalemTodayIsoDate());
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [departmentId, setDepartmentId] = useState<string>('');
  const [departments, setDepartments] = useState<{ id: number; name: string }[]>([]);
  const [rows, setRows] = useState<AllocationReportRow[]>([]);
  const [clockInMsByEmployee, setClockInMsByEmployee] = useState<Map<number, number>>(
    () => new Map(),
  );
  const [clockedOutEmployees, setClockedOutEmployees] = useState<
    Map<number, ClockedOutEmployeeRef>
  >(() => new Map());
  const [reportedEmployeeIds, setReportedEmployeeIds] = useState<Set<number>>(() => new Set());
  const [avgMonthlySalaryByEmployee, setAvgMonthlySalaryByEmployee] = useState<Map<number, number>>(
    () => new Map(),
  );
  const [missingReportingModalOpen, setMissingReportingModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);

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
      const [data, clockRecords, submittedEmployeeIds] = await Promise.all([
        fetchAllocationReport({
          fromDate: workDate,
          toDate: workDate,
          departmentId: departmentId ? Number(departmentId) : null,
          employeeSearch,
        }),
        fetchClockInRecordsInRange(workDate, workDate),
        fetchSubmittedAllocationEmployeeIds(workDate),
      ]);
      const clockInMs = buildDailyClockInMsByEmployee(clockRecords);
      const clockedOut = collectClockedOutEmployeesForDay(clockRecords);
      const employeeIds = Array.from(
        new Set([
          ...data.map((row) => row.employee_id),
          ...Array.from(clockedOut.keys()),
        ]),
      );
      const salaryMap = await fetchAverageGrossSalaryLastMonths(employeeIds, 6);

      setRows(data);
      setClockInMsByEmployee(clockInMs);
      setClockedOutEmployees(clockedOut);
      setReportedEmployeeIds(submittedEmployeeIds);
      setAvgMonthlySalaryByEmployee(salaryMap);
    } catch (error) {
      console.error('[EmployeeLeadAllocationsReport] load failed:', error);
      toast.error('Failed to load allocation report.');
      setRows([]);
      setClockInMsByEmployee(new Map());
      setClockedOutEmployees(new Map());
      setReportedEmployeeIds(new Set());
      setAvgMonthlySalaryByEmployee(new Map());
    } finally {
      setLoading(false);
    }
  }, [isSuperUser, workDate, departmentId, employeeSearch]);

  useEffect(() => {
    if (!permissionsLoaded || !isSuperUser) return;
    void loadReport();
  }, [permissionsLoaded, isSuperUser, loadReport]);

  const employeeGroups = useMemo(
    () => groupRowsByEmployee(rows, clockInMsByEmployee, avgMonthlySalaryByEmployee),
    [rows, clockInMsByEmployee, avgMonthlySalaryByEmployee],
  );

  const missingReportingEmployees = useMemo(
    () =>
      listMissingLeadReportingEmployees({
        clockedOutEmployees,
        reportedEmployeeIds,
        clockInMsByEmployee,
        departmentId: departmentId ? Number(departmentId) : null,
        employeeSearch,
        avgMonthlySalaryByEmployee,
      }),
    [
      clockedOutEmployees,
      reportedEmployeeIds,
      clockInMsByEmployee,
      departmentId,
      employeeSearch,
      avgMonthlySalaryByEmployee,
    ],
  );

  const reportTotals = useMemo(() => {
    let totalWorkedMs = 0;
    let totalCostNis = 0;
    let hasAnyCost = false;

    for (const group of employeeGroups) {
      totalWorkedMs += group.totalWorkedMs;
      const employeeCost = sumEmployeeAllocationRowCostsNis(group);
      if (employeeCost != null) {
        totalCostNis += employeeCost;
        hasAnyCost = true;
      }
    }

    return {
      employeeCount: employeeGroups.length,
      missingReportingCount: missingReportingEmployees.length,
      totalWorkedMs,
      totalCostNis: hasAnyCost ? Math.round(totalCostNis * 100) / 100 : null,
    };
  }, [employeeGroups, missingReportingEmployees.length]);

  if (!permissionsLoaded || !isSuperUser) {
    return (
      <div className="flex min-h-[calc(100dvh-3.5rem)] items-center justify-center bg-[#ececec]">
        <span className="loading loading-spinner loading-lg text-primary" />
      </div>
    );
  }

  return (
    <div className="employee-lead-allocations-report-shell min-h-[calc(100dvh-3.5rem)] bg-[#ececec]">
      <div className="mx-auto flex min-w-0 max-w-7xl flex-col px-4 pb-[max(2.5rem,env(safe-area-inset-bottom,0px))] pt-2 md:px-10 md:pb-12 md:pt-4">
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
            <button
              type="button"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
              onClick={() => navigate('/reports')}
            >
              <ArrowLeftIcon className="h-4 w-4" />
              Back
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-gray-600">Work date</span>
              <input
                type="date"
                className="input h-10 min-h-10 w-full rounded-[14px] border-0 bg-transparent px-3 ring-1 ring-gray-300/80 focus:outline-none focus:ring-2 focus:ring-primary/15"
                value={workDate}
                onChange={(e) => setWorkDate(e.target.value)}
              />
            </label>

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
            />
          )}

          <MissingReportingModal
            open={missingReportingModalOpen}
            workDate={workDate}
            employees={missingReportingEmployees}
            onClose={() => setMissingReportingModalOpen(false)}
          />

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <span className="loading loading-spinner loading-lg text-primary" />
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded-[18px] bg-white px-5 py-16 text-center text-sm text-gray-500 shadow-sm">
              No allocations found for these filters.
            </div>
          ) : (
            <div className="space-y-6">
              {employeeGroups.map((group) => (
                <EmployeeAllocationSection key={group.employeeId} group={group} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default EmployeeLeadAllocationsReportPage;
