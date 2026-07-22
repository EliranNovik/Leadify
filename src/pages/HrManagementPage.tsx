import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  AcademicCapIcon,
  ArrowLeftIcon,
  BanknotesIcon,
  BriefcaseIcon,
  CalendarDaysIcon,
  CameraIcon,
  ChatBubbleLeftRightIcon,
  ChevronRightIcon,
  ClipboardDocumentCheckIcon,
  ClockIcon,
  DevicePhoneMobileIcon,
  DocumentTextIcon,
  EnvelopeIcon,
  ExclamationTriangleIcon,
  HomeIcon,
  IdentificationIcon,
  MagnifyingGlassIcon,
  EllipsisHorizontalIcon,
  PencilSquareIcon,
  PhoneIcon,
  PlusIcon,
  SignalIcon,
  UserGroupIcon,
  UserPlusIcon,
  UsersIcon,
} from '@heroicons/react/24/outline';
import {
  CheckBadgeIcon,
  ClockIcon as ClockSolidIcon,
  HomeIcon as HomeSolidIcon,
  ShieldCheckIcon as ShieldCheckSolidIcon,
} from '@heroicons/react/24/solid';
import { toast } from 'react-hot-toast';
import { FaFileExcel, FaWhatsapp } from 'react-icons/fa';
import * as XLSX from 'xlsx';
import { useAdminRole } from '../hooks/useAdminRole';
import { supabase } from '../lib/supabase';
import {
  fetchOrganizationData,
  getBonusesRoleDisplayName,
  getEmployeeDisplayLabel,
  type OrganizationEmployee,
} from '../lib/organizationEmployees';
import {
  fetchActiveStaffEmployeesWithDepartment,
  fetchActiveStaffSalaryRows,
  fetchAverageGrossSalaryLastMonths,
} from '../lib/employeeSalaries';
import {
  formatAllocationCostNis,
  salaryToHourlyRateNis,
} from '../lib/employeeLeadReporting';
import { fetchPendingManualClockInsForApproval } from '../lib/employeeClockInApproval';
import { fetchPendingUnavailabilitiesForApproval } from '../lib/employeeUnavailabilityApproval';
import { fetchCombinedPendingHrApprovalCount } from '../lib/hrApprovals';
import {
  documentNameFromUrl,
  fetchAllUnavailabilitiesInRange,
  filterCountedUnavailability,
  getUnavailabilityApprovalStatus,
  unavailabilityDateRangeLabel,
  unavailabilityReasonText,
  unavailabilityTypeLabel,
  type EmployeeUnavailabilityEntry,
  type UnavailabilityApprovalStatus,
  type UnavailabilityType,
} from '../lib/employeeUnavailabilities';
import { unavailabilityNeedsDocument } from '../lib/employeeUnavailabilityApproval';
import { fetchWorkingHoursSubmissionsForMonth } from '../lib/employeeWorkingHoursSubmissions';
import { monthRange, toDateInputValue } from '../lib/employeeClockInFormat';
import { filterCountedClockInRecords } from '../lib/employeeClockInApproval';
import {
  buildHolidayMapForRange,
  calculateExtraHoursByEmployee,
  countPaidUnavailabilityWorkdays,
  formatExtraHoursDuration,
  preloadHolidayMapsForRange,
} from '../lib/employeeExtraHours';
import {
  buildEmployeeMergedTimeAndUnavailabilityExportRows,
  exportAllEmployeesMergedTimeAndUnavailabilitiesToExcel,
  fetchClockInRecordsInRangeForReport,
  groupClockInTotalsByEmployee,
  sumCountedClockDurationsMs,
  type ClockInExportRecord,
} from '../lib/workingHoursExport';
import HrApprovalsPanel from '../components/hr/HrApprovalsPanel';
import HrEmployeeAboutEditModal from '../components/hr/HrEmployeeAboutEditModal';
import HrManagementSideRail from '../components/hr/HrManagementSideRail';
import HrRecruitmentTab from '../components/hr/HrRecruitmentTab';
import EmployeesManager from '../components/admin/EmployeesManager';
import UsersManager from '../components/admin/UsersManager';
import HrEmployeeAvatar from '../components/hr/HrEmployeeAvatar';
import HrBonusesRoleBadge from '../components/hr/HrBonusesRoleBadge';
import UnavailabilityTypeBadge from '../components/UnavailabilityTypeBadge';
import DocumentViewerModal from '../components/DocumentViewerModal';
import TeamStatusModal from '../components/TeamStatusModal';
import WorkingHoursTab from '../components/profile/WorkingHoursTab';
import MyDocumentsTab from '../components/profile/MyDocumentsTab';
import MyContribution from '../components/MyContribution';
import EmployeeSalariesManager from '../components/admin/EmployeeSalariesManager';
import HrEntryKioskPanel from '../components/hr/HrEntryKioskPanel';
import RMQMessagesPage from './RMQMessagesPage';

type HubTab =
  | 'overview'
  | 'approvals'
  | 'employees'
  | 'recruitment'
  | 'hours'
  | 'leave'
  | 'status'
  | 'salaries'
  | 'entry-kiosk';
type FileTab = 'about' | 'working-hours' | 'documents' | 'contribution';

type HoursBoardEmployee = {
  employeeId: number;
  employeeName: string;
  photoUrl: string | null;
  departmentName: string;
  minHours: number;
  sickDays: number;
  vacationDays: number;
  generalDays: number;
  totalHours: string;
  extraHours125: string;
  extraHours150: string;
  hoursSubmitted: boolean;
  submittedAt: string | null;
};

function formatDateRangeLabel(from: string, to: string): string {
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  };
  if (from === to) return fmt(from);
  return `${fmt(from)} – ${fmt(to)}`;
}

function HrContactLink({
  value,
  href,
}: {
  value: string | null | undefined;
  href: 'mailto' | 'tel';
}) {
  const trimmed = value?.trim();
  if (!trimmed) return <span className="text-gray-400">—</span>;
  return (
    <a
      href={`${href}:${trimmed}`}
      className="text-gray-900 hover:underline"
      onClick={(e) => e.stopPropagation()}
    >
      {trimmed}
    </a>
  );
}

function buildWhatsAppUrl(mobile: string): string | null {
  const digits = mobile.replace(/\D/g, '');
  if (!digits) return null;
  return `https://wa.me/${digits}`;
}

function HrEmployeeMobileCell({ value }: { value: string | null | undefined }) {
  const trimmed = value?.trim();
  if (!trimmed) return <span className="text-gray-400">—</span>;
  const whatsAppUrl = buildWhatsAppUrl(trimmed);
  return (
    <span className="inline-flex items-center gap-1.5">
      {whatsAppUrl ? (
        <a
          href={whatsAppUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[#25D366] hover:bg-gray-200"
          title="WhatsApp"
          aria-label="Open WhatsApp"
          onClick={(e) => e.stopPropagation()}
        >
          <FaWhatsapp className="h-4 w-4" aria-hidden />
        </a>
      ) : null}
      <a
        href={`tel:${trimmed}`}
        className="text-gray-900 hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        {trimmed}
      </a>
    </span>
  );
}

function DateRangeFilters({
  from,
  to,
  onFromChange,
  onToChange,
}: {
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
}) {
  const inputClass =
    'rounded-full border border-gray-200 bg-white px-3.5 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/30';

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-gray-600">From</span>
        <input
          type="date"
          className={inputClass}
          value={from}
          max={to || undefined}
          onChange={(e) => {
            const next = e.target.value;
            if (!next) return;
            onFromChange(next);
            if (to && next > to) onToChange(next);
          }}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-gray-600">To</span>
        <input
          type="date"
          className={inputClass}
          value={to}
          min={from || undefined}
          onChange={(e) => {
            const next = e.target.value;
            if (!next) return;
            onToChange(next);
            if (from && next < from) onFromChange(next);
          }}
        />
      </label>
    </div>
  );
}

const HUB_TABS: Array<{ id: HubTab; label: string; icon: React.ElementType }> = [
  { id: 'overview', label: 'Overview', icon: HomeIcon },
  { id: 'approvals', label: 'Approvals', icon: ClipboardDocumentCheckIcon },
  { id: 'employees', label: 'Employees', icon: UsersIcon },
  { id: 'recruitment', label: 'Recruitment', icon: IdentificationIcon },
  { id: 'hours', label: 'Working hours', icon: ClockIcon },
  { id: 'leave', label: 'Leave', icon: CalendarDaysIcon },
  { id: 'status', label: 'Status', icon: SignalIcon },
  { id: 'salaries', label: 'Salaries', icon: BanknotesIcon },
  { id: 'entry-kiosk', label: 'Entry kiosk', icon: DevicePhoneMobileIcon },
];

const FILE_TABS: Array<{ id: FileTab; label: string }> = [
  { id: 'about', label: 'About' },
  { id: 'working-hours', label: 'Working Hours' },
  { id: 'documents', label: 'Documents' },
  { id: 'contribution', label: 'Contribution' },
];

/** Same default banner as My Profile page. */
const PROFILE_DEFAULT_BANNER =
  'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?ixlib=rb-4.0.3&auto=format&fit=crop&w=2070&q=80';

function todayIso(): string {
  return toDateInputValue(new Date());
}

/** Calendar month before today (1–12) and its year. */
function previousCalendarMonth(): { month: number; year: number } {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return { month: d.getMonth() + 1, year: d.getFullYear() };
}

function parseHubTab(raw: string | null): HubTab {
  if (
    raw === 'approvals' ||
    raw === 'employees' ||
    raw === 'recruitment' ||
    raw === 'hours' ||
    raw === 'leave' ||
    raw === 'status' ||
    raw === 'salaries' ||
    raw === 'entry-kiosk' ||
    raw === 'overview'
  ) {
    return raw;
  }
  return 'overview';
}

export default function HrManagementPage() {
  const navigate = useNavigate();
  const { employeeId: employeeIdParam } = useParams<{ employeeId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isSuperUser, isLoading: roleLoading } = useAdminRole();

  const selectedEmployeeId = employeeIdParam ? Number(employeeIdParam) : null;
  const hubTab = parseHubTab(searchParams.get('tab'));
  const fileTab = (searchParams.get('fileTab') as FileTab) || 'about';

  const [employees, setEmployees] = useState<OrganizationEmployee[]>([]);
  const [avgMonthlySalaryByEmployeeId, setAvgMonthlySalaryByEmployeeId] = useState<
    Map<number, number>
  >(() => new Map());
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [superuserFilter, setSuperuserFilter] = useState<'all' | 'yes' | 'no'>('all');
  const [wfhFilter, setWfhFilter] = useState<'all' | 'yes' | 'no'>('all');
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingApprovalEmployees, setPendingApprovalEmployees] = useState<
    Array<{ id: number; name: string; photoUrl: string | null }>
  >([]);
  const [clockedInToday, setClockedInToday] = useState(0);
  const [onLeaveToday, setOnLeaveToday] = useState(0);
  const [missingSickDocs, setMissingSickDocs] = useState(0);
  const [outTodayRows, setOutTodayRows] = useState<EmployeeUnavailabilityEntry[]>([]);
  const [prevMonthMissingSubmissions, setPrevMonthMissingSubmissions] = useState(() => {
    const prev = previousCalendarMonth();
    return { count: 0, names: [] as string[], month: prev.month, year: prev.year };
  });
  const [prevMonthMissingSalaries, setPrevMonthMissingSalaries] = useState(() => {
    const prev = previousCalendarMonth();
    return { count: 0, names: [] as string[], month: prev.month, year: prev.year };
  });
  const [leaveRows, setLeaveRows] = useState<EmployeeUnavailabilityEntry[]>([]);
  const [leaveTypeFilter, setLeaveTypeFilter] = useState<'all' | UnavailabilityType>('all');
  const [leaveStatusFilter, setLeaveStatusFilter] = useState<'all' | UnavailabilityApprovalStatus>('all');
  const [leaveDocFilter, setLeaveDocFilter] = useState<'all' | 'missing' | 'uploaded'>('all');
  const [leaveSearch, setLeaveSearch] = useState('');
  const [leaveFrom, setLeaveFrom] = useState(() => todayIso());
  const [leaveTo, setLeaveTo] = useState(() => todayIso());
  const [hoursYear, setHoursYear] = useState(() => new Date().getFullYear());
  const [hoursMonth, setHoursMonth] = useState(() => new Date().getMonth() + 1);
  const [hoursSearch, setHoursSearch] = useState('');
  const [hoursStatusFilter, setHoursStatusFilter] = useState<'all' | 'submitted' | 'not_submitted'>(
    'all',
  );
  const [hoursBoardEmployees, setHoursBoardEmployees] = useState<HoursBoardEmployee[]>([]);
  const [hoursBoardLoading, setHoursBoardLoading] = useState(false);
  const [hoursExporting, setHoursExporting] = useState(false);
  const [leaveExporting, setLeaveExporting] = useState(false);
  const [loadingHub, setLoadingHub] = useState(true);
  const [editEmployee, setEditEmployee] = useState<OrganizationEmployee | null>(null);
  const [addEmployeeDrawerOpen, setAddEmployeeDrawerOpen] = useState(false);
  const [addUserDrawerOpen, setAddUserDrawerOpen] = useState(false);
  const [recruitmentRefreshKey, setRecruitmentRefreshKey] = useState(0);
  const [rmqOpen, setRmqOpen] = useState(false);
  const [rmqChatUserId, setRmqChatUserId] = useState<string | null>(null);
  const [leaveDocument, setLeaveDocument] = useState<{
    url: string;
    name: string;
    employeeName: string;
    uploadedAt?: string;
    reason?: string;
  } | null>(null);

  const setHubTab = (tab: HubTab) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    setSearchParams(next, { replace: true });
  };

  const goHubTab = useCallback(
    (tab: HubTab) => {
      if (selectedEmployeeId != null) {
        navigate(`/reports/hr-management?tab=${tab}`);
        return;
      }
      setHubTab(tab);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setHubTab closes over searchParams
    [navigate, selectedEmployeeId, searchParams, setSearchParams],
  );

  const setFileTab = (tab: FileTab) => {
    const next = new URLSearchParams(searchParams);
    next.set('fileTab', tab);
    setSearchParams(next, { replace: true });
  };

  const openEmployeeFile = (
    id: number,
    opts?: { year?: number; month?: number; fileTab?: FileTab },
  ) => {
    const params = new URLSearchParams();
    params.set('fileTab', opts?.fileTab ?? 'working-hours');
    const year = opts?.year ?? hoursYear;
    const month = opts?.month ?? hoursMonth;
    params.set('year', String(year));
    params.set('month', String(month));
    navigate(`/reports/hr-management/employees/${id}?${params.toString()}`);
  };

  const loadHubData = useCallback(async () => {
    setLoadingHub(true);
    try {
      const today = todayIso();
      const leaveRangeFrom = leaveFrom <= leaveTo ? leaveFrom : leaveTo;
      const leaveRangeTo = leaveFrom <= leaveTo ? leaveTo : leaveFrom;
      const missingDocsFrom = (() => {
        const d = new Date();
        d.setDate(d.getDate() - 180);
        return toDateInputValue(d);
      })();

      const [org, pending, pendingClock, pendingLeave, leave, leaveToday, leaveForMissingDocs, activeClocks] =
        await Promise.all([
          fetchOrganizationData(),
          fetchCombinedPendingHrApprovalCount().catch(() => 0),
          fetchPendingManualClockInsForApproval('all').catch(() => []),
          fetchPendingUnavailabilitiesForApproval().catch(() => []),
          fetchAllUnavailabilitiesInRange(leaveRangeFrom, leaveRangeTo).catch(
            () => [] as EmployeeUnavailabilityEntry[],
          ),
          fetchAllUnavailabilitiesInRange(today, today).catch(
            () => [] as EmployeeUnavailabilityEntry[],
          ),
          fetchAllUnavailabilitiesInRange(missingDocsFrom, today).catch(
            () => [] as EmployeeUnavailabilityEntry[],
          ),
          supabase
            .from('employee_clock_in')
            .select('id, employee_id')
            .eq('is_active', true)
            .then(({ data }) => data || []),
        ]);

      setEmployees(org.allEmployees);
      setPendingCount(pending);

      const pendingEmpMap = new Map<number, { id: number; name: string; photoUrl: string | null }>();
      for (const record of [...pendingClock, ...pendingLeave]) {
        const id = record.employee_id;
        if (!Number.isFinite(id) || pendingEmpMap.has(id)) continue;
        pendingEmpMap.set(id, {
          id,
          name: record.employee_name?.trim() || `Employee #${id}`,
          photoUrl: record.employee_photo_url ?? null,
        });
      }
      setPendingApprovalEmployees(
        Array.from(pendingEmpMap.values()).sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
        ),
      );

      setLeaveRows(leave);
      setClockedInToday(new Set(activeClocks.map((r: { employee_id: number }) => r.employee_id)).size);

      const employeeIds = org.allEmployees.map((e) => e.id);
      if (employeeIds.length > 0) {
        const salaryMap = await fetchAverageGrossSalaryLastMonths(employeeIds, 6).catch(
          () => new Map<number, number>(),
        );
        setAvgMonthlySalaryByEmployeeId(salaryMap);
      } else {
        setAvgMonthlySalaryByEmployeeId(new Map());
      }

      const approvedToday = filterCountedUnavailability(leaveToday).filter((row) => {
        const end = row.end_date || row.start_date;
        return row.start_date <= today && end >= today;
      });
      setOutTodayRows(approvedToday);
      setOnLeaveToday(new Set(approvedToday.map((r) => r.employee_id)).size);
      setMissingSickDocs(
        leaveForMissingDocs.filter(
          (r) =>
            unavailabilityNeedsDocument(r) && getUnavailabilityApprovalStatus(r) !== 'declined',
        ).length,
      );

      const prev = previousCalendarMonth();
      const [prevSalaryRows, prevActiveStaff, prevSubmissions] = await Promise.all([
        fetchActiveStaffSalaryRows(prev.month, prev.year).catch(() => []),
        fetchActiveStaffEmployeesWithDepartment().catch(() => []),
        fetchWorkingHoursSubmissionsForMonth(prev.year, prev.month).catch(() => []),
      ]);

      const submittedPrev = new Set(
        prevSubmissions.map((s) => Number(s.employee_id)).filter((id) => Number.isFinite(id)),
      );
      const missingSubNames = prevActiveStaff
        .filter((emp) => !submittedPrev.has(Number(emp.id)))
        .map((emp) => emp.display_name)
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
      setPrevMonthMissingSubmissions({
        count: missingSubNames.length,
        names: missingSubNames,
        month: prev.month,
        year: prev.year,
      });

      const missingSalNames = prevSalaryRows
        .filter(
          (row) =>
            !(row.gross_salary > 0) &&
            !(row.net_salary != null && row.net_salary !== 0),
        )
        .map((row) => row.employee_name)
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
      setPrevMonthMissingSalaries({
        count: missingSalNames.length,
        names: missingSalNames,
        month: prev.month,
        year: prev.year,
      });
    } catch (err) {
      console.error('HrManagementPage load:', err);
      toast.error('Failed to load HR data');
    } finally {
      setLoadingHub(false);
    }
  }, [leaveFrom, leaveTo]);

  /** Same submission + hours summary logic as EmployeeUnavailabilitiesReport. */
  const loadHoursBoard = useCallback(async () => {
    setHoursBoardLoading(true);
    try {
      const { from: fromDate, to: toDate } = monthRange(hoursYear, hoursMonth);
      const [activeEmployees, submissions, clockRecords, unavailabilities] = await Promise.all([
        fetchActiveStaffEmployeesWithDepartment(),
        fetchWorkingHoursSubmissionsForMonth(hoursYear, hoursMonth),
        fetchClockInRecordsInRangeForReport(fromDate, toDate),
        fetchAllUnavailabilitiesInRange(fromDate, toDate),
        preloadHolidayMapsForRange(fromDate, toDate),
      ]);

      const holidayMap = buildHolidayMapForRange(fromDate, toDate);
      const submissionByEmployee = new Map(
        submissions.map((submission) => [Number(submission.employee_id), submission]),
      );

      const unavailByEmployee = new Map<number, EmployeeUnavailabilityEntry[]>();
      for (const entry of unavailabilities) {
        const list = unavailByEmployee.get(entry.employee_id);
        if (list) list.push(entry);
        else unavailByEmployee.set(entry.employee_id, [entry]);
      }

      const clockByEmployee = new Map<number, ClockInExportRecord[]>();
      for (const record of clockRecords) {
        const empId = record.employee_id;
        if (empId == null) continue;
        const list = clockByEmployee.get(empId);
        if (list) list.push(record);
        else clockByEmployee.set(empId, [record]);
      }

      const minHoursByEmployee = new Map(
        activeEmployees.map((emp) => [Number(emp.id), emp.minHours]),
      );
      const clockTotalsByEmployee = groupClockInTotalsByEmployee(clockRecords);
      const extraHoursByEmployee = calculateExtraHoursByEmployee(
        clockByEmployee,
        minHoursByEmployee,
        holidayMap,
        fromDate,
        toDate,
        unavailByEmployee,
      );

      const rows: HoursBoardEmployee[] = activeEmployees
        .map((emp) => {
          const employeeId = Number(emp.id);
          const submission = submissionByEmployee.get(employeeId);
          const unavailForEmp = unavailByEmployee.get(employeeId) ?? [];
          const extra = extraHoursByEmployee.get(employeeId);
          const totals = clockTotalsByEmployee.get(employeeId)?.totals;

          let generalDays = 0;
          for (const reason of unavailForEmp) {
            if (reason.unavailability_type !== 'general') continue;
            const startDate = new Date(reason.start_date);
            const endDate = reason.end_date ? new Date(reason.end_date) : startDate;
            const filterFromDate = new Date(fromDate);
            const filterToDate = new Date(toDate);
            const overlapStart = startDate > filterFromDate ? startDate : filterFromDate;
            const overlapEnd = endDate < filterToDate ? endDate : filterToDate;
            const daysDiff =
              Math.ceil((overlapEnd.getTime() - overlapStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
            generalDays += Math.max(0, daysDiff);
          }

          return {
            employeeId,
            employeeName: emp.display_name,
            photoUrl: emp.photo_url,
            departmentName: emp.departmentName || '—',
            minHours: emp.minHours,
            sickDays: countPaidUnavailabilityWorkdays(
              unavailForEmp,
              'sick_days',
              fromDate,
              toDate,
              holidayMap,
            ),
            vacationDays: countPaidUnavailabilityWorkdays(
              unavailForEmp,
              'vacation',
              fromDate,
              toDate,
              holidayMap,
            ),
            generalDays,
            totalHours: totals?.totalDuration ?? '0h 0m',
            extraHours125: formatExtraHoursDuration(extra?.extraHours125Ms ?? 0),
            extraHours150: formatExtraHoursDuration(extra?.extraHours150Ms ?? 0),
            hoursSubmitted: Boolean(submission),
            submittedAt: submission?.submitted_at ?? null,
          };
        })
        .sort((a, b) => a.employeeName.localeCompare(b.employeeName));

      setHoursBoardEmployees(rows);
    } catch (err) {
      console.error('HrManagementPage hours board:', err);
      toast.error('Failed to load working hours submissions');
      setHoursBoardEmployees([]);
    } finally {
      setHoursBoardLoading(false);
    }
  }, [hoursYear, hoursMonth]);

  useEffect(() => {
    if (!roleLoading && isSuperUser) void loadHubData();
  }, [roleLoading, isSuperUser, loadHubData]);

  useEffect(() => {
    if (!roleLoading && isSuperUser) void loadHoursBoard();
  }, [roleLoading, isSuperUser, loadHoursBoard]);

  const departments = useMemo(() => {
    const names = new Set<string>();
    for (const e of employees) {
      if (e.department) names.add(e.department);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [employees]);

  const filteredEmployees = useMemo(() => {
    const q = employeeSearch.trim().toLowerCase();
    const qDigits = employeeSearch.replace(/\D/g, '');
    return employees.filter((e) => {
      if (deptFilter && e.department !== deptFilter) return false;
      if (superuserFilter === 'yes' && !e.is_superuser) return false;
      if (superuserFilter === 'no' && e.is_superuser) return false;
      if (wfhFilter === 'yes' && !e.works_from_home) return false;
      if (wfhFilter === 'no' && e.works_from_home) return false;
      if (!q) return true;
      const label = getEmployeeDisplayLabel(e).toLowerCase();
      const phones = [e.phone, e.mobile, e.employee_mobile].filter(Boolean).join(' ');
      const role = getBonusesRoleDisplayName(e.bonuses_role).toLowerCase();
      return (
        label.includes(q) ||
        role.includes(q) ||
        (e.email || '').toLowerCase().includes(q) ||
        (e.department || '').toLowerCase().includes(q) ||
        phones.toLowerCase().includes(q) ||
        (qDigits.length > 0 && phones.replace(/\D/g, '').includes(qDigits))
      );
    });
  }, [employees, employeeSearch, deptFilter, superuserFilter, wfhFilter]);

  const selectedEmployee = useMemo(
    () => employees.find((e) => e.id === selectedEmployeeId) ?? null,
    [employees, selectedEmployeeId],
  );

  const hoursSubmittedCount = useMemo(
    () => hoursBoardEmployees.filter((e) => e.hoursSubmitted).length,
    [hoursBoardEmployees],
  );

  const overviewAttentionItems = useMemo(() => {
    const items: Array<{
      id: string;
      title: string;
      detail: string;
      icon: React.ElementType;
      onClick: () => void;
    }> = [];

    const prevMonthLabel = (month: number, year: number) =>
      new Date(year, month - 1, 1).toLocaleString('en', { month: 'long', year: 'numeric' });

    if (pendingCount > 0) {
      items.push({
        id: 'pending-approvals',
        title: `${pendingCount} pending approval${pendingCount === 1 ? '' : 's'}`,
        detail: 'Clock-in or leave requests waiting for review',
        icon: ClipboardDocumentCheckIcon,
        onClick: () => setHubTab('approvals'),
      });
    }

    if (missingSickDocs > 0) {
      items.push({
        id: 'missing-sick-docs',
        title: `${missingSickDocs} missing sick document${missingSickDocs === 1 ? '' : 's'}`,
        detail: 'Sick leave in the last 6 months still needs a supporting document',
        icon: DocumentTextIcon,
        onClick: () => {
          const from = new Date();
          from.setDate(from.getDate() - 180);
          setLeaveFrom(toDateInputValue(from));
          setLeaveTo(todayIso());
          setLeaveDocFilter('missing');
          setLeaveTypeFilter('sick_days');
          setLeaveStatusFilter('all');
          setHubTab('leave');
        },
      });
    }

    if (prevMonthMissingSubmissions.count > 0) {
      const preview = prevMonthMissingSubmissions.names.slice(0, 3).join(', ');
      const more =
        prevMonthMissingSubmissions.names.length > 3
          ? ` +${prevMonthMissingSubmissions.names.length - 3} more`
          : '';
      items.push({
        id: 'hours-not-submitted',
        title: `${prevMonthMissingSubmissions.count} missing hours submission${
          prevMonthMissingSubmissions.count === 1 ? '' : 's'
        }`,
        detail: `${prevMonthLabel(
          prevMonthMissingSubmissions.month,
          prevMonthMissingSubmissions.year,
        )} · ${preview}${more}`,
        icon: ClockIcon,
        onClick: () => {
          setHoursYear(prevMonthMissingSubmissions.year);
          setHoursMonth(prevMonthMissingSubmissions.month);
          setHoursStatusFilter('not_submitted');
          setHubTab('hours');
        },
      });
    }

    if (prevMonthMissingSalaries.count > 0) {
      const preview = prevMonthMissingSalaries.names.slice(0, 3).join(', ');
      const more =
        prevMonthMissingSalaries.names.length > 3
          ? ` +${prevMonthMissingSalaries.names.length - 3} more`
          : '';
      items.push({
        id: 'missing-salaries',
        title: `${prevMonthMissingSalaries.count} missing salar${
          prevMonthMissingSalaries.count === 1 ? 'y' : 'ies'
        }`,
        detail: `${prevMonthLabel(
          prevMonthMissingSalaries.month,
          prevMonthMissingSalaries.year,
        )} · ${preview}${more}`,
        icon: BanknotesIcon,
        onClick: () => {
          setHoursYear(prevMonthMissingSalaries.year);
          setHoursMonth(prevMonthMissingSalaries.month);
          setHubTab('salaries');
        },
      });
    }

    return items;
  }, [
    pendingCount,
    missingSickDocs,
    prevMonthMissingSubmissions,
    prevMonthMissingSalaries,
  ]);

  const outTodayDisplay = useMemo(() => {
    return [...outTodayRows]
      .map((row) => {
        const emp = employees.find((e) => e.id === row.employee_id);
        return {
          row,
          name: emp ? getEmployeeDisplayLabel(emp) : `Employee #${row.employee_id}`,
          photoUrl: emp?.photo_url ?? null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }, [outTodayRows, employees]);

  const filteredHoursBoard = useMemo(() => {
    const q = hoursSearch.trim().toLowerCase();
    return hoursBoardEmployees.filter((emp) => {
      if (hoursStatusFilter === 'submitted' && !emp.hoursSubmitted) return false;
      if (hoursStatusFilter === 'not_submitted' && emp.hoursSubmitted) return false;
      if (!q) return true;
      return (
        emp.employeeName.toLowerCase().includes(q) ||
        emp.departmentName.toLowerCase().includes(q)
      );
    });
  }, [hoursBoardEmployees, hoursSearch, hoursStatusFilter]);

  const exportHoursBoard = useCallback(async () => {
    if (filteredHoursBoard.length === 0) {
      toast.error('No employees to export');
      return;
    }

    setHoursExporting(true);
    try {
      const { from: fromDate, to: toDate } = monthRange(hoursYear, hoursMonth);
      const [clockRecords, allUnavailabilities] = await Promise.all([
        fetchClockInRecordsInRangeForReport(fromDate, toDate),
        fetchAllUnavailabilitiesInRange(fromDate, toDate),
        preloadHolidayMapsForRange(fromDate, toDate),
      ]);

      const holidayMap = buildHolidayMapForRange(fromDate, toDate);

      const clockByEmployee = new Map<number, ClockInExportRecord[]>();
      for (const record of clockRecords) {
        const empId = record.employee_id;
        if (empId == null) continue;
        const list = clockByEmployee.get(empId);
        if (list) list.push(record);
        else clockByEmployee.set(empId, [record]);
      }

      const unavailByEmployee = new Map<number, EmployeeUnavailabilityEntry[]>();
      for (const entry of allUnavailabilities) {
        const list = unavailByEmployee.get(entry.employee_id);
        if (list) list.push(entry);
        else unavailByEmployee.set(entry.employee_id, [entry]);
      }

      const minHoursByEmployee = new Map(
        filteredHoursBoard.map((emp) => [emp.employeeId, emp.minHours]),
      );
      const clockTotalsByEmployee = groupClockInTotalsByEmployee(clockRecords);
      const extraHoursByEmployee = calculateExtraHoursByEmployee(
        clockByEmployee,
        minHoursByEmployee,
        holidayMap,
        fromDate,
        toDate,
        unavailByEmployee,
      );

      const employeeExports = filteredHoursBoard.map((emp) => {
        const clockRecordsForEmp = clockByEmployee.get(emp.employeeId) ?? [];
        const countedRecords = filterCountedClockInRecords(clockRecordsForEmp);
        const unavailForEmp = unavailByEmployee.get(emp.employeeId) ?? [];
        const extraHours = extraHoursByEmployee.get(emp.employeeId);
        const mergedRows = buildEmployeeMergedTimeAndUnavailabilityExportRows(
          clockRecordsForEmp,
          unavailForEmp,
          fromDate,
          toDate,
          emp.employeeName,
          emp.departmentName || '—',
        );

        return {
          employeeName: emp.employeeName,
          department: emp.departmentName || '—',
          rows: mergedRows.map(({ employeeName, department, ...row }) => row),
          periodTotalMs: sumCountedClockDurationsMs(countedRecords),
          baseHoursMs: extraHours?.baseHoursMs ?? 0,
          extraHours125Ms: extraHours?.extraHours125Ms ?? 0,
          extraHours150Ms: extraHours?.extraHours150Ms ?? 0,
          deficitHoursMs: extraHours?.deficitHoursMs ?? 0,
          sickDays: countPaidUnavailabilityWorkdays(
            unavailForEmp,
            'sick_days',
            fromDate,
            toDate,
            holidayMap,
          ),
          vacationDays: countPaidUnavailabilityWorkdays(
            unavailForEmp,
            'vacation',
            fromDate,
            toDate,
            holidayMap,
          ),
          daysWorked: clockTotalsByEmployee.get(emp.employeeId)?.totals.daysWorked ?? 0,
        };
      });

      exportAllEmployeesMergedTimeAndUnavailabilitiesToExcel(employeeExports, {
        dateFrom: fromDate,
        dateTo: toDate,
      });
      toast.success('Employee time and unavailabilities exported successfully');
    } catch (error) {
      console.error('HR hours export error:', error);
      toast.error('Failed to export');
    } finally {
      setHoursExporting(false);
    }
  }, [filteredHoursBoard, hoursYear, hoursMonth]);

  const formatSubmissionTime = (dateString: string) =>
    new Date(dateString).toLocaleString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  const leaveForList = useMemo(() => {
    const q = leaveSearch.trim().toLowerCase();
    return [...leaveRows]
      .filter((row) => {
        if (leaveTypeFilter !== 'all' && row.unavailability_type !== leaveTypeFilter) return false;
        if (
          leaveStatusFilter !== 'all' &&
          getUnavailabilityApprovalStatus(row) !== leaveStatusFilter
        ) {
          return false;
        }
        if (leaveDocFilter === 'missing' && !unavailabilityNeedsDocument(row)) return false;
        if (leaveDocFilter === 'uploaded' && !row.document_url?.trim()) return false;
        if (q) {
          const emp = employees.find((e) => e.id === row.employee_id);
          const name = emp
            ? getEmployeeDisplayLabel(emp).toLowerCase()
            : `employee #${row.employee_id}`;
          const dept = (emp?.department || '').toLowerCase();
          if (!name.includes(q) && !dept.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => b.start_date.localeCompare(a.start_date));
  }, [leaveRows, leaveTypeFilter, leaveStatusFilter, leaveDocFilter, leaveSearch, employees]);

  const exportLeaveToExcel = useCallback(() => {
    if (leaveForList.length === 0) {
      toast.error('No leave records to export');
      return;
    }

    setLeaveExporting(true);
    try {
      const rows = leaveForList.map((row) => {
        const emp = employees.find((e) => e.id === row.employee_id);
        const status = getUnavailabilityApprovalStatus(row);
        const statusLabel =
          status === 'pending'
            ? 'Waiting for approval'
            : status === 'declined'
              ? 'Declined'
              : 'Approved';
        const documentLabel = unavailabilityNeedsDocument(row)
          ? 'Missing doc'
          : row.document_url?.trim()
            ? 'Uploaded'
            : '—';

        return {
          Employee: emp ? getEmployeeDisplayLabel(emp) : `Employee #${row.employee_id}`,
          Department: emp?.department || '—',
          Type: unavailabilityTypeLabel(row.unavailability_type),
          'Start date': row.start_date,
          'End date': row.end_date || row.start_date,
          Dates: unavailabilityDateRangeLabel(row.start_date, row.end_date),
          Status: statusLabel,
          Document: documentLabel,
          Reason: unavailabilityReasonText(row) || '—',
        };
      });

      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Leave');
      const filename = `leave_${leaveFrom}_to_${leaveTo}.xlsx`.replace(/[\\/:*?"<>|]/g, '-');
      XLSX.writeFile(workbook, filename);
      toast.success('Leave exported successfully');
    } catch (error) {
      console.error('HR leave export error:', error);
      toast.error('Failed to export leave');
    } finally {
      setLeaveExporting(false);
    }
  }, [leaveForList, employees, leaveFrom, leaveTo]);

  const leaveTypeFilterPills: Array<{ id: 'all' | UnavailabilityType; label: string }> = [
    { id: 'all', label: 'All types' },
    { id: 'sick_days', label: 'Sick day/s' },
    { id: 'vacation', label: 'Vacation' },
    { id: 'general', label: 'General' },
  ];

  const leaveStatusFilterPills: Array<{ id: 'all' | UnavailabilityApprovalStatus; label: string }> = [
    { id: 'all', label: 'All statuses' },
    { id: 'pending', label: 'Waiting for approval' },
    { id: 'approved', label: 'Approved' },
    { id: 'declined', label: 'Declined' },
  ];

  const hrSideRail = (
    <HrManagementSideRail
      tabs={HUB_TABS}
      activeTab={hubTab}
      pendingApprovals={pendingCount}
      hoursExporting={hoursExporting}
      onSelectTab={(id) => goHubTab(id as HubTab)}
      onAddEmployee={() => setAddEmployeeDrawerOpen(true)}
      onAddUser={() => setAddUserDrawerOpen(true)}
      onRefresh={() => {
        void loadHubData();
        toast.success('Refreshing…');
      }}
      onExportHours={() => {
        void exportHoursBoard();
      }}
      onOpenOrganization={() => navigate('/organization')}
      onOpenAdmin={() => navigate('/admin')}
    />
  );

  const hrCreateDrawers = (
    <>
      <EmployeesManager
        embed={{
          addDrawerOpen: addEmployeeDrawerOpen,
          onAddDrawerOpenChange: setAddEmployeeDrawerOpen,
          onRecordCreated: () => {
            void loadHubData();
          },
        }}
      />
      <UsersManager
        embed={{
          addDrawerOpen: addUserDrawerOpen,
          onAddDrawerOpenChange: setAddUserDrawerOpen,
          simplifiedHrAdd: true,
          onRecordCreated: () => {
            void loadHubData();
            setRecruitmentRefreshKey((k) => k + 1);
          },
        }}
      />
    </>
  );

  if (roleLoading) {
    return (
      <div className="min-h-[calc(100dvh-3.5rem)] bg-[#ececec] lg:pl-8 flex items-center justify-center text-gray-500">
        Loading…
      </div>
    );
  }

  if (!isSuperUser) {
    return (
      <div className="min-h-[calc(100dvh-3.5rem)] bg-[#ececec] lg:pl-8 flex items-center justify-center">
        <div className="rounded-2xl bg-white px-8 py-10 text-center shadow-sm">
          <p className="font-semibold text-gray-800">Superuser access required</p>
          <p className="text-sm text-gray-500 mt-1">HR Management is limited to superusers.</p>
        </div>
      </div>
    );
  }

  // ─── Employee file ─────────────────────────────────────────────────────────
  if (selectedEmployeeId != null) {
    const emp = selectedEmployee;
    const name = emp ? getEmployeeDisplayLabel(emp) : `Employee #${selectedEmployeeId}`;
    const fileYearRaw = Number(searchParams.get('year'));
    const fileMonthRaw = Number(searchParams.get('month'));
    const fileInitialYear = Number.isFinite(fileYearRaw) ? fileYearRaw : undefined;
    const fileInitialMonth =
      fileMonthRaw >= 1 && fileMonthRaw <= 12 ? fileMonthRaw : undefined;
    const aboutSalaryRaw = emp ? avgMonthlySalaryByEmployeeId.get(emp.id) : undefined;
    const aboutAvgMonthlySalaryNis =
      aboutSalaryRaw != null && Number.isFinite(aboutSalaryRaw) && aboutSalaryRaw > 0
        ? Math.round(aboutSalaryRaw * 100) / 100
        : null;
    const aboutHourRateNis = emp
      ? salaryToHourlyRateNis(aboutAvgMonthlySalaryNis, emp.min_hours)
      : null;
    return (
      <div className="hr-management-page-shell min-h-[calc(100dvh-3.5rem)] bg-[#ececec] lg:pl-56">
        {hrSideRail}
        {hrCreateDrawers}
        <div className="px-4 md:px-8 py-6 space-y-5 mx-auto w-full max-w-none">
          <button
            type="button"
            className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900"
            onClick={() => navigate('/reports/hr-management?tab=employees')}
          >
            <ArrowLeftIcon className="w-4 h-4" />
            Back to Employees
          </button>

          <div className="rounded-2xl bg-white border border-gray-200 overflow-hidden shadow-sm">
            <div className="relative h-40 md:h-52 w-full">
              <div
                className="absolute inset-0 bg-cover bg-center"
                style={{
                  backgroundImage: `url(${
                    emp?.chat_background_image_url?.trim() || PROFILE_DEFAULT_BANNER
                  })`,
                }}
              >
                <div className="absolute inset-0 bg-black/20" />
              </div>
            </div>
            <div className="px-6 pb-5 -mt-14 md:-mt-16 flex flex-col sm:flex-row sm:items-end gap-4 relative z-10">
              <button
                type="button"
                className="relative group shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-emerald-600"
                onClick={() => emp && setEditEmployee(emp)}
                title="Change profile photo"
                aria-label="Edit profile photo"
              >
                <HrEmployeeAvatar
                  employeeId={selectedEmployeeId}
                  name={name}
                  photoUrl={emp?.photo_url}
                  size="2xl"
                  shape="circle"
                  className="border-4 border-white shadow-xl"
                />
                <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                  <CameraIcon className="h-8 w-8 text-white" />
                </span>
              </button>
              <div className="flex-1 min-w-0 pb-1">
                <h1 className="text-2xl md:text-3xl font-bold text-gray-900 truncate">{name}</h1>
                <p className="text-sm text-gray-500">
                  {emp?.department || '—'}
                  {emp?.bonuses_role
                    ? ` · ${getBonusesRoleDisplayName(emp.bonuses_role)}`
                    : ''}
                  {emp?.email ? ` · ${emp.email}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 pb-1">
                {(() => {
                  const whatsAppNumber =
                    emp?.employee_mobile?.trim() || emp?.mobile?.trim() || '';
                  const whatsAppUrl = whatsAppNumber
                    ? buildWhatsAppUrl(whatsAppNumber)
                    : null;
                  const phone = emp?.phone?.trim() || '';
                  const mobile = emp?.mobile?.trim() || '';
                  const email = emp?.email?.trim() || '';
                  const canRmq = Boolean(emp?.chatUserId);
                  const iconBtn =
                    'inline-flex h-9 w-9 items-center justify-center rounded-full border transition disabled:opacity-40 disabled:pointer-events-none';
                  return (
                    <>
                      <a
                        href={whatsAppUrl || undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`${iconBtn} border-gray-200 bg-gray-100 text-[#25D366] hover:bg-gray-200 ${
                          !whatsAppUrl ? 'pointer-events-none opacity-40' : ''
                        }`}
                        title={whatsAppUrl ? 'WhatsApp' : 'No WhatsApp number'}
                        aria-label="WhatsApp"
                        aria-disabled={!whatsAppUrl}
                        onClick={(e) => {
                          if (!whatsAppUrl) e.preventDefault();
                        }}
                      >
                        <FaWhatsapp className="h-4 w-4" aria-hidden />
                      </a>
                      <a
                        href={email ? `mailto:${email}` : undefined}
                        className={`${iconBtn} border-[#C7E0F4] bg-[#EAF3FC] text-[#0078D4] hover:bg-[#d9ebf8] ${
                          !email ? 'pointer-events-none opacity-40' : ''
                        }`}
                        title={email || 'No email'}
                        aria-label="Email"
                        aria-disabled={!email}
                        onClick={(e) => {
                          if (!email) e.preventDefault();
                        }}
                      >
                        <EnvelopeIcon className="h-4 w-4" aria-hidden />
                      </a>
                      <button
                        type="button"
                        className={`${iconBtn} border-[#4829CC]/25 bg-[#4829CC]/8 text-[#4829CC] hover:bg-[#4829CC]/14`}
                        disabled={!canRmq}
                        title={canRmq ? 'RMQ message' : 'No RMQ account linked'}
                        aria-label="RMQ message"
                        onClick={() => {
                          if (!emp?.chatUserId) {
                            toast.error('No RMQ account linked for this employee');
                            return;
                          }
                          setRmqChatUserId(emp.chatUserId);
                          setRmqOpen(true);
                        }}
                      >
                        <ChatBubbleLeftRightIcon className="h-4 w-4" aria-hidden />
                      </button>
                      <a
                        href={phone ? `tel:${phone}` : undefined}
                        className={`${iconBtn} border-gray-200 bg-white text-gray-700 hover:bg-gray-50 ${
                          !phone ? 'pointer-events-none opacity-40' : ''
                        }`}
                        title={phone ? `Call ${phone}` : 'No phone'}
                        aria-label="Phone"
                        aria-disabled={!phone}
                        onClick={(e) => {
                          if (!phone) e.preventDefault();
                        }}
                      >
                        <PhoneIcon className="h-4 w-4" aria-hidden />
                      </a>
                      <a
                        href={mobile ? `tel:${mobile}` : undefined}
                        className={`${iconBtn} border-gray-200 bg-white text-gray-700 hover:bg-gray-50 ${
                          !mobile ? 'pointer-events-none opacity-40' : ''
                        }`}
                        title={mobile ? `Mobile ${mobile}` : 'No mobile'}
                        aria-label="Mobile"
                        aria-disabled={!mobile}
                        onClick={(e) => {
                          if (!mobile) e.preventDefault();
                        }}
                      >
                        <DevicePhoneMobileIcon className="h-4 w-4" aria-hidden />
                      </a>
                    </>
                  );
                })()}
                <button
                  type="button"
                  className="btn btn-sm rounded-full"
                  onClick={() => navigate(`/my-profile/${selectedEmployeeId}`)}
                >
                  Open profile
                </button>
              </div>
            </div>
            <div className="px-4 md:px-6 border-t border-gray-100 flex gap-1 overflow-x-auto">
              {FILE_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFileTab(tab.id)}
                  className={`px-4 py-3 text-sm font-semibold whitespace-nowrap border-b-2 transition ${
                    fileTab === tab.id
                      ? 'border-emerald-600 text-emerald-800'
                      : 'border-transparent text-gray-500 hover:text-gray-800'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl bg-white border border-gray-200 p-4 md:p-6 shadow-sm">
            {fileTab === 'about' && emp && (
              <div className="space-y-4">
                <div className="flex justify-end">
                  <button
                    type="button"
                    className="btn btn-sm gap-2 rounded-full"
                    onClick={() => setEditEmployee(emp)}
                  >
                    <PencilSquareIcon className="h-4 w-4" />
                    Edit
                  </button>
                </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-5">
                <section className="rounded-xl bg-gray-50 p-5 md:p-6">
                  <h3 className="mb-5">
                    <span className="inline-flex items-center gap-2 rounded-full bg-white px-3.5 py-2 text-base md:text-lg font-semibold text-gray-800">
                      <IdentificationIcon className="h-5 w-5 md:h-6 md:w-6 text-gray-500 shrink-0" />
                      General
                    </span>
                  </h3>
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-5">
                    <div>
                      <dt className="text-sm md:text-base text-gray-500 mb-0.5">Display name</dt>
                      <dd className="text-base md:text-lg font-medium text-gray-900">{emp.display_name || '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-sm md:text-base text-gray-500 mb-0.5">Official name</dt>
                      <dd className="text-base md:text-lg font-medium text-gray-900">{emp.official_name || '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-sm md:text-base text-gray-500 mb-0.5">Department</dt>
                      <dd className="text-base md:text-lg font-medium text-gray-900">{emp.department || '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-sm md:text-base text-gray-500 mb-0.5">Role</dt>
                      <dd className="text-base md:text-lg font-medium text-gray-900">
                        {getBonusesRoleDisplayName(emp.bonuses_role) || '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm md:text-base text-gray-500 mb-0.5">Date of birth</dt>
                      <dd className="text-base md:text-lg font-medium text-gray-900">
                        {emp.date_of_birth
                          ? new Date(`${emp.date_of_birth}T12:00:00`).toLocaleDateString('en-GB', {
                              day: 'numeric',
                              month: 'long',
                              year: 'numeric',
                            })
                          : '—'}
                      </dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-sm md:text-base text-gray-500 mb-0.5">LinkedIn</dt>
                      <dd className="text-base md:text-lg font-medium text-gray-900">
                        {emp.linkedin_url?.trim() ? (
                          <a
                            href={
                              /^https?:\/\//i.test(emp.linkedin_url.trim())
                                ? emp.linkedin_url.trim()
                                : `https://${emp.linkedin_url.trim()}`
                            }
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline break-all"
                          >
                            {emp.linkedin_url.trim()}
                          </a>
                        ) : (
                          '—'
                        )}
                      </dd>
                    </div>
                  </dl>
                </section>

                <section className="rounded-xl bg-gray-50 p-5 md:p-6">
                  <h3 className="mb-5">
                    <span className="inline-flex items-center gap-2 rounded-full bg-white px-3.5 py-2 text-base md:text-lg font-semibold text-gray-800">
                      <PhoneIcon className="h-5 w-5 md:h-6 md:w-6 text-gray-500 shrink-0" />
                      Contact
                    </span>
                  </h3>
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-5">
                    <div>
                      <dt className="text-sm md:text-base text-gray-500 mb-0.5">Email</dt>
                      <dd className="text-base md:text-lg font-medium text-gray-900">
                        <HrContactLink value={emp.email} href="mailto" />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm md:text-base text-gray-500 mb-0.5">Phone</dt>
                      <dd className="text-base md:text-lg font-medium text-gray-900">
                        <HrContactLink value={emp.phone} href="tel" />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm md:text-base text-gray-500 mb-0.5">Mobile</dt>
                      <dd className="text-base md:text-lg font-medium text-gray-900">
                        <HrContactLink value={emp.mobile} href="tel" />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm md:text-base text-gray-500 mb-0.5">Employee mobile</dt>
                      <dd className="text-base md:text-lg font-medium text-gray-900">
                        <HrEmployeeMobileCell value={emp.employee_mobile} />
                      </dd>
                    </div>
                  </dl>
                </section>

                <section className="rounded-xl bg-gray-50 p-5 md:p-6">
                  <h3 className="mb-5">
                    <span className="inline-flex items-center gap-2 rounded-full bg-white px-3.5 py-2 text-base md:text-lg font-semibold text-gray-800">
                      <BriefcaseIcon className="h-5 w-5 md:h-6 md:w-6 text-gray-500 shrink-0" />
                      Employment
                    </span>
                  </h3>
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-5">
                    <div>
                      <dt className="text-sm md:text-base text-gray-500 mb-0.5">Superuser</dt>
                      <dd className="mt-1 flex items-center gap-2">
                        <input
                          type="checkbox"
                          className="toggle toggle-primary"
                          checked={emp.is_superuser}
                          aria-label="Superuser"
                          onChange={(e) => {
                            const next = e.target.checked;
                            if (!emp.chatUserId) {
                              toast.error('No linked user account');
                              return;
                            }
                            void (async () => {
                              const { error } = await supabase
                                .from('users')
                                .update({ is_superuser: next })
                                .eq('id', emp.chatUserId);
                              if (error) {
                                toast.error('Failed to update superuser');
                                return;
                              }
                              toast.success(next ? 'Marked as superuser' : 'Superuser removed');
                              void loadHubData();
                            })();
                          }}
                        />
                        {emp.is_superuser ? (
                          <ShieldCheckSolidIcon className="w-5 h-5 text-indigo-600" title="Superuser" />
                        ) : null}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm md:text-base text-gray-500 mb-0.5">Works from home</dt>
                      <dd className="mt-1 flex items-center gap-2">
                        <input
                          type="checkbox"
                          className="toggle toggle-success"
                          checked={emp.works_from_home}
                          aria-label="Works from home"
                          onChange={(e) => {
                            const next = e.target.checked;
                            void (async () => {
                              const { error } = await supabase
                                .from('tenants_employee')
                                .update({ works_from_home: next })
                                .eq('id', emp.id);
                              if (error) {
                                toast.error('Failed to update works from home');
                                return;
                              }
                              toast.success(next ? 'Works from home enabled' : 'Works from home disabled');
                              void loadHubData();
                            })();
                          }}
                        />
                        {emp.works_from_home ? (
                          <HomeSolidIcon className="w-5 h-5 text-emerald-600" title="Works from home" />
                        ) : null}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm md:text-base text-gray-500 mb-0.5">Min hours</dt>
                      <dd className="text-base md:text-lg font-medium text-gray-900">{emp.min_hours}</dd>
                    </div>
                    <div>
                      <dt className="text-sm md:text-base text-gray-500 mb-0.5">Hour rate</dt>
                      <dd className="text-base md:text-lg font-medium text-gray-900">
                        {aboutHourRateNis != null
                          ? `${formatAllocationCostNis(aboutHourRateNis)}/h`
                          : '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm md:text-base text-gray-500 mb-0.5">Total cost</dt>
                      <dd className="text-base md:text-lg font-medium text-gray-900">
                        {formatAllocationCostNis(aboutAvgMonthlySalaryNis)}
                      </dd>
                    </div>
                  </dl>
                </section>

                <section className="rounded-xl bg-gray-50 p-5 md:p-6">
                  <h3 className="mb-5">
                    <span className="inline-flex items-center gap-2 rounded-full bg-white px-3.5 py-2 text-base md:text-lg font-semibold text-gray-800">
                      <AcademicCapIcon className="h-5 w-5 md:h-6 md:w-6 text-gray-500 shrink-0" />
                      Education
                    </span>
                  </h3>
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-5">
                    <div>
                      <dt className="text-sm md:text-base text-gray-500 mb-0.5">School</dt>
                      <dd className="text-base md:text-lg font-medium text-gray-900">{emp.school || '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-sm md:text-base text-gray-500 mb-0.5">Diploma</dt>
                      <dd className="text-base md:text-lg font-medium text-gray-900">{emp.diplom || '—'}</dd>
                    </div>
                  </dl>
                </section>
              </div>
              </div>
            )}
            {editEmployee && (
              <HrEmployeeAboutEditModal
                open
                employee={editEmployee}
                onClose={() => setEditEmployee(null)}
                onSaved={() => {
                  void loadHubData();
                }}
              />
            )}
            {fileTab === 'working-hours' && (
              <WorkingHoursTab
                employeeId={selectedEmployeeId}
                employeeName={name}
                initialYear={fileInitialYear}
                initialMonth={fileInitialMonth}
                embedded
              />
            )}
            {fileTab === 'documents' && (
              <MyDocumentsTab employeeId={selectedEmployeeId} employeeName={name} />
            )}
            {fileTab === 'contribution' && (
              <MyContribution employeeId={selectedEmployeeId} employeeName={name} embedded />
            )}
          </div>
        </div>
        <RMQMessagesPage
          isOpen={rmqOpen}
          initialUserId={rmqChatUserId || undefined}
          onClose={() => {
            setRmqOpen(false);
            setRmqChatUserId(null);
          }}
        />
      </div>
    );
  }

  // ─── Hub ───────────────────────────────────────────────────────────────────
  return (
    <div className="hr-management-page-shell min-h-[calc(100dvh-3.5rem)] bg-[#ececec] lg:pl-56">
      {hrSideRail}
      {hrCreateDrawers}
      <div className="px-4 md:px-8 py-6 space-y-5 mx-auto w-full max-w-none">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900">HR Management</h1>
          <p className="text-sm text-gray-500">
            Working hours, clock-ins, leave requests, and employee files in one place.
          </p>
        </div>

        <div
          role="tablist"
          className="flex flex-wrap gap-2 rounded-2xl bg-white border border-gray-200 p-2 shadow-sm lg:hidden"
        >
          {HUB_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = hubTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setHubTab(tab.id)}
                className={`inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition ${
                  active
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <Icon className="w-6 h-6 shrink-0" />
                {tab.label}
                {tab.id === 'approvals' && pendingCount > 0 && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      active ? 'bg-white/20' : 'bg-emerald-100 text-emerald-800'
                    }`}
                  >
                    {pendingCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {hubTab === 'overview' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                {
                  id: 'pending' as const,
                  label: 'Pending approvals',
                  value: pendingCount,
                  icon: ClipboardDocumentCheckIcon,
                  onClick: () => setHubTab('approvals'),
                },
                {
                  id: 'clocked' as const,
                  label: 'Clocked in now',
                  value: clockedInToday,
                  icon: ClockIcon,
                },
                {
                  id: 'leave' as const,
                  label: 'On leave today',
                  value: onLeaveToday,
                  icon: CalendarDaysIcon,
                  onClick: () => setHubTab('leave'),
                },
                {
                  id: 'sick' as const,
                  label: 'Missing sick docs',
                  value: missingSickDocs,
                  icon: ExclamationTriangleIcon,
                  onClick: () => {
                    const from = new Date();
                    from.setDate(from.getDate() - 180);
                    setLeaveFrom(toDateInputValue(from));
                    setLeaveTo(todayIso());
                    setLeaveDocFilter('missing');
                    setLeaveTypeFilter('sick_days');
                    setLeaveStatusFilter('all');
                    setHubTab('leave');
                  },
                },
              ].map((card) => {
                const showPendingAvatars =
                  card.id === 'pending' && !loadingHub && pendingApprovalEmployees.length > 0;
                const pendingAvatarCap = 5;
                const pendingAvatarsShown = pendingApprovalEmployees.slice(0, pendingAvatarCap);
                const pendingAvatarsExtra =
                  pendingApprovalEmployees.length - pendingAvatarsShown.length;

                return (
                  <button
                    key={card.label}
                    type="button"
                    onClick={card.onClick}
                    className="rounded-2xl bg-white border border-gray-200 p-5 md:p-6 text-left shadow-sm hover:border-emerald-300 transition disabled:pointer-events-none min-h-[7.5rem]"
                    disabled={!card.onClick}
                  >
                    {showPendingAvatars ? (
                      <div className="flex items-center justify-between gap-3 h-full">
                        <div className="min-w-0 flex flex-col gap-3">
                          <div className="flex items-center -space-x-2">
                            {pendingAvatarsShown.map((emp) => (
                              <span
                                key={emp.id}
                                className="relative inline-flex rounded-full ring-2 ring-white"
                                title={emp.name}
                              >
                                <HrEmployeeAvatar
                                  employeeId={emp.id}
                                  name={emp.name}
                                  photoUrl={emp.photoUrl}
                                  size="sm"
                                />
                              </span>
                            ))}
                            {pendingAvatarsExtra > 0 && (
                              <span className="relative inline-flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-800 ring-2 ring-white">
                                +{pendingAvatarsExtra}
                              </span>
                            )}
                          </div>
                          <div>
                            <div className="text-3xl md:text-4xl font-bold text-gray-900 leading-none tracking-tight">
                              {card.value}
                            </div>
                            <div className="text-sm md:text-base font-semibold text-gray-600 mt-2.5 leading-snug">
                              {card.label}
                            </div>
                          </div>
                        </div>
                        <card.icon className="w-10 h-10 md:w-12 md:h-12 text-emerald-600/80 shrink-0" />
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-3 h-full">
                        <div className="min-w-0">
                          <div className="text-3xl md:text-4xl font-bold text-gray-900 leading-none tracking-tight">
                            {loadingHub ? '—' : card.value}
                          </div>
                          <div className="text-sm md:text-base font-semibold text-gray-600 mt-2.5 leading-snug">
                            {card.label}
                          </div>
                        </div>
                        <card.icon className="w-10 h-10 md:w-12 md:h-12 text-emerald-600/80 shrink-0" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-2xl bg-white border border-gray-200 p-5 shadow-sm">
                <div className="flex items-center justify-between gap-3 mb-4">
                  <h2 className="font-semibold text-gray-900">Needs attention</h2>
                  {overviewAttentionItems.length > 0 && (
                    <span className="rounded-full bg-emerald-100 text-emerald-800 text-xs font-semibold px-2.5 py-1">
                      {overviewAttentionItems.length}
                    </span>
                  )}
                </div>
                {loadingHub ? (
                  <p className="text-sm text-gray-500">Loading…</p>
                ) : overviewAttentionItems.length === 0 ? (
                  <p className="text-sm text-gray-500">Nothing urgent right now.</p>
                ) : (
                  <ul className="space-y-2">
                    {overviewAttentionItems.map((item) => {
                      const Icon = item.icon;
                      return (
                        <li key={item.id}>
                          <button
                            type="button"
                            onClick={item.onClick}
                            className="w-full flex items-center gap-3 rounded-xl px-4 py-3 transition bg-emerald-50/80 hover:bg-emerald-100/70"
                          >
                            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-100/90">
                              <Icon className="h-6 w-6 text-emerald-700" aria-hidden />
                            </span>
                            <div className="min-w-0 flex-1 text-left">
                              <div className="font-semibold text-gray-900 text-sm md:text-base">
                                {item.title}
                              </div>
                              <div className="text-sm text-gray-600 mt-0.5 truncate">{item.detail}</div>
                            </div>
                            <ChevronRightIcon className="h-5 w-5 shrink-0 text-emerald-600/50" aria-hidden />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <div className="rounded-2xl bg-white border border-gray-200 p-5 shadow-sm">
                <div className="flex items-center justify-between gap-3 mb-4">
                  <h2 className="font-semibold text-gray-900">Who’s out today</h2>
                  <button
                    type="button"
                    className="btn btn-xs rounded-full bg-emerald-50 text-emerald-800 border-0"
                    onClick={() => setHubTab('leave')}
                  >
                    Open leave
                  </button>
                </div>
                {loadingHub ? (
                  <p className="text-sm text-gray-500">Loading…</p>
                ) : outTodayDisplay.length === 0 ? (
                  <p className="text-sm text-gray-500">No one on leave today.</p>
                ) : (
                  <ul className="space-y-2 max-h-[22rem] overflow-y-auto pr-1">
                    {outTodayDisplay.map(({ row, name, photoUrl }) => (
                      <li key={row.id}>
                        <button
                          type="button"
                          onClick={() => openEmployeeFile(row.employee_id)}
                          className="w-full flex items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-gray-50 transition"
                          title="Open employee file"
                        >
                          <HrEmployeeAvatar
                            employeeId={row.employee_id}
                            name={name}
                            photoUrl={photoUrl}
                            size="lg"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-medium text-gray-900 truncate">{name}</span>
                              <UnavailabilityTypeBadge
                                type={row.unavailability_type}
                                size="xs"
                                borderless
                                className="shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold"
                              />
                            </div>
                            <div className="text-sm text-gray-500 truncate">
                              {unavailabilityDateRangeLabel(row.start_date, row.end_date)}
                            </div>
                          </div>
                          <span className="shrink-0 max-w-[10rem] truncate text-sm text-gray-600">
                            {unavailabilityReasonText(row)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="rounded-2xl bg-white border border-gray-200 p-5 shadow-sm">
              <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
                <h2 className="font-semibold text-gray-900">Hours submissions</h2>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-sm font-medium text-gray-600">Month</span>
                    <select
                      className="rounded-full border border-gray-200 bg-white px-3.5 py-2 text-sm text-gray-800 min-w-[10rem] focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                      value={String(hoursMonth)}
                      onChange={(e) => setHoursMonth(Number(e.target.value))}
                    >
                      {[
                        'January',
                        'February',
                        'March',
                        'April',
                        'May',
                        'June',
                        'July',
                        'August',
                        'September',
                        'October',
                        'November',
                        'December',
                      ].map((label, index) => (
                        <option key={label} value={String(index + 1)}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-sm font-medium text-gray-600">Year</span>
                    <select
                      className="rounded-full border border-gray-200 bg-white px-3.5 py-2 text-sm text-gray-800 min-w-[7rem] focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                      value={String(hoursYear)}
                      onChange={(e) => setHoursYear(Number(e.target.value))}
                    >
                      {Array.from({ length: 8 }, (_, i) => new Date().getFullYear() - 3 + i).map(
                        (year) => (
                          <option key={year} value={String(year)}>
                            {year}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                </div>
              </div>
              <p className="text-sm text-gray-500 mb-4">
                {hoursBoardLoading
                  ? 'Loading…'
                  : `${hoursSubmittedCount} of ${hoursBoardEmployees.length} employees submitted hours for ${new Date(
                      hoursYear,
                      hoursMonth - 1,
                    ).toLocaleString('en', {
                      month: 'long',
                      year: 'numeric',
                    })}.`}
              </p>
              <button
                type="button"
                className="btn btn-sm rounded-full bg-emerald-50 text-emerald-800 border-0"
                onClick={() => setHubTab('hours')}
              >
                Open working hours board
              </button>
            </div>
          </div>
        )}

        {hubTab === 'approvals' && (
          <div className="rounded-2xl bg-white border border-gray-200 p-4 md:p-6 shadow-sm">
            <HrApprovalsPanel
              onUpdated={() => {
                void loadHubData();
              }}
            />
          </div>
        )}

        {hubTab === 'employees' && (
          <div className="rounded-2xl bg-white border border-gray-200 p-4 md:p-6 shadow-sm space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="flex flex-wrap items-end gap-3 flex-1 min-w-0">
              <div className="relative min-w-[14rem] flex-1 max-w-sm">
                <span className="text-sm font-medium text-gray-600 mb-1 block">Search</span>
                <div className="relative">
                  <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="search"
                    value={employeeSearch}
                    onChange={(e) => setEmployeeSearch(e.target.value)}
                    placeholder="Search employees…"
                    className="w-full rounded-full border border-gray-200 bg-white py-2 pl-9 pr-4 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                  />
                </div>
              </div>
              <label className="flex flex-col gap-1">
                <span className="text-sm font-medium text-gray-600">Department</span>
                <select
                  className="rounded-full border border-gray-200 bg-white px-3.5 py-2 text-sm text-gray-800 min-w-[10rem] focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                  value={deptFilter}
                  onChange={(e) => setDeptFilter(e.target.value)}
                >
                  <option value="">All departments</option>
                  {departments.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-sm font-medium text-gray-600">Superuser</span>
                <select
                  className="rounded-full border border-gray-200 bg-white px-3.5 py-2 text-sm text-gray-800 min-w-[10rem] focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                  value={superuserFilter}
                  onChange={(e) => setSuperuserFilter(e.target.value as 'all' | 'yes' | 'no')}
                >
                  <option value="all">All</option>
                  <option value="yes">Superuser</option>
                  <option value="no">Not superuser</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-sm font-medium text-gray-600">Works from home</span>
                <select
                  className="rounded-full border border-gray-200 bg-white px-3.5 py-2 text-sm text-gray-800 min-w-[10rem] focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                  value={wfhFilter}
                  onChange={(e) => setWfhFilter(e.target.value as 'all' | 'yes' | 'no')}
                >
                  <option value="all">All</option>
                  <option value="yes">Works from home</option>
                  <option value="no">Not WFH</option>
                </select>
              </label>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                  onClick={() => setAddEmployeeDrawerOpen(true)}
                >
                  <PlusIcon className="h-4 w-4" />
                  Add employee
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-800 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                  onClick={() => setAddUserDrawerOpen(true)}
                >
                  <UserPlusIcon className="h-4 w-4" />
                  Add user
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="table w-full text-base">
                <thead>
                  <tr className="text-sm uppercase tracking-wider text-gray-500">
                    <th className="bg-transparent font-semibold">Employee</th>
                    <th className="bg-transparent font-semibold">Role</th>
                    <th className="bg-transparent font-semibold">Email</th>
                    <th className="bg-transparent font-semibold">Phone</th>
                    <th className="bg-transparent font-semibold">Mobile</th>
                    <th className="bg-transparent font-semibold">Employee mobile</th>
                    <th className="bg-transparent font-semibold text-center">Superuser</th>
                    <th className="bg-transparent font-semibold text-center">WFH</th>
                    <th className="bg-transparent font-semibold w-12" />
                  </tr>
                </thead>
                <tbody>
                  {filteredEmployees.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="text-center text-gray-500 py-8">
                        No employees match filters
                      </td>
                    </tr>
                  ) : (
                    filteredEmployees.map((emp) => (
                      <tr
                        key={emp.id}
                        className="hover:bg-base-200 cursor-pointer"
                        onClick={() => openEmployeeFile(emp.id)}
                        title="Open employee file"
                      >
                        <td className="font-medium text-base text-gray-900 whitespace-nowrap">
                          <div className="flex items-center gap-3 min-w-0">
                            <HrEmployeeAvatar
                              employeeId={emp.id}
                              name={getEmployeeDisplayLabel(emp)}
                              photoUrl={emp.photo_url}
                              size="lg"
                            />
                            <div className="min-w-0">
                              <div className="truncate">{getEmployeeDisplayLabel(emp)}</div>
                              <div className="text-sm font-bold text-gray-500 truncate">
                                {emp.department || '—'}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="text-base text-gray-700 whitespace-nowrap">
                          <HrBonusesRoleBadge roleCode={emp.bonuses_role} />
                        </td>
                        <td className="text-base text-gray-700 whitespace-nowrap">
                          <HrContactLink value={emp.email} href="mailto" />
                        </td>
                        <td className="text-base text-gray-700 whitespace-nowrap">
                          <HrContactLink value={emp.phone} href="tel" />
                        </td>
                        <td className="text-base text-gray-700 whitespace-nowrap">
                          <HrContactLink value={emp.mobile} href="tel" />
                        </td>
                        <td className="text-base text-gray-700 whitespace-nowrap">
                          <HrEmployeeMobileCell value={emp.employee_mobile} />
                        </td>
                        <td className="text-center">
                          {emp.is_superuser ? (
                            <ShieldCheckSolidIcon
                              className="w-5 h-5 text-indigo-600 inline-block"
                              title="Superuser"
                            />
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                        <td className="text-center">
                          {emp.works_from_home ? (
                            <HomeSolidIcon
                              className="w-5 h-5 text-emerald-600 inline-block"
                              title="Works from home"
                            />
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                        <td className="align-middle whitespace-nowrap">
                          <div className="flex items-center justify-end">
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm btn-square rounded-full h-10 w-10 min-h-0"
                              title="Edit employee"
                              aria-label={`Edit ${getEmployeeDisplayLabel(emp)}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditEmployee(emp);
                              }}
                            >
                              <EllipsisHorizontalIcon className="h-7 w-7 text-gray-600" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {editEmployee && hubTab === 'employees' && (
              <HrEmployeeAboutEditModal
                open
                employee={editEmployee}
                onClose={() => setEditEmployee(null)}
                onSaved={() => {
                  void loadHubData();
                }}
              />
            )}
          </div>
        )}

        {hubTab === 'recruitment' && (
          <HrRecruitmentTab
            isSuperUser={isSuperUser}
            onAddUser={() => setAddUserDrawerOpen(true)}
            refreshKey={recruitmentRefreshKey}
          />
        )}

        {hubTab === 'hours' && (
          <div className="rounded-2xl bg-white border border-gray-200 p-4 md:p-6 shadow-sm space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="flex flex-wrap items-end gap-3 flex-1">
                <div className="relative min-w-[14rem] flex-1 max-w-sm">
                  <span className="text-sm font-medium text-gray-600 mb-1 block">Search</span>
                  <div className="relative">
                    <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="search"
                      value={hoursSearch}
                      onChange={(e) => setHoursSearch(e.target.value)}
                      placeholder="Search employees…"
                      className="w-full rounded-full border border-gray-200 bg-white py-2 pl-9 pr-4 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                    />
                  </div>
                </div>
                <label className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-gray-600">Month</span>
                  <select
                    className="rounded-full border border-gray-200 bg-white px-3.5 py-2 text-sm text-gray-800 min-w-[10rem] focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                    value={String(hoursMonth)}
                    onChange={(e) => setHoursMonth(Number(e.target.value))}
                  >
                    {[
                      'January',
                      'February',
                      'March',
                      'April',
                      'May',
                      'June',
                      'July',
                      'August',
                      'September',
                      'October',
                      'November',
                      'December',
                    ].map((label, index) => (
                      <option key={label} value={String(index + 1)}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-gray-600">Year</span>
                  <select
                    className="rounded-full border border-gray-200 bg-white px-3.5 py-2 text-sm text-gray-800 min-w-[7rem] focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                    value={String(hoursYear)}
                    onChange={(e) => setHoursYear(Number(e.target.value))}
                  >
                    {Array.from({ length: 8 }, (_, i) => new Date().getFullYear() - 3 + i).map(
                      (year) => (
                        <option key={year} value={String(year)}>
                          {year}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-gray-600">Status</span>
                  <select
                    className="rounded-full border border-gray-200 bg-white px-3.5 py-2 text-sm text-gray-800 min-w-[10rem] focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                    value={hoursStatusFilter}
                    onChange={(e) =>
                      setHoursStatusFilter(
                        e.target.value as 'all' | 'submitted' | 'not_submitted',
                      )
                    }
                  >
                    <option value="all">All statuses</option>
                    <option value="submitted">Submitted</option>
                    <option value="not_submitted">Not submitted</option>
                  </select>
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="btn btn-sm rounded-full border-0 bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-600/50"
                  onClick={() => void exportHoursBoard()}
                  disabled={hoursBoardLoading || hoursExporting || filteredHoursBoard.length === 0}
                  title="Download as Excel"
                >
                  {hoursExporting ? (
                    <span className="loading loading-spinner loading-sm mr-2" />
                  ) : (
                    <FaFileExcel className="w-4 h-4 mr-1.5" />
                  )}
                  Export to Excel
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="table w-full text-base">
                <thead>
                  <tr className="text-sm uppercase tracking-wider text-gray-500">
                    <th className="bg-transparent font-semibold">Employee</th>
                    <th className="bg-transparent font-semibold text-right">Sick days</th>
                    <th className="bg-transparent font-semibold text-right">Vacation</th>
                    <th className="bg-transparent font-semibold text-right">General</th>
                    <th className="bg-transparent font-semibold text-right">Total hours</th>
                    <th className="bg-transparent font-semibold text-right">Extra 125%</th>
                    <th className="bg-transparent font-semibold text-right">Extra 150%</th>
                    <th className="bg-transparent font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {hoursBoardLoading ? (
                    <tr>
                      <td colSpan={8} className="text-center text-gray-500 py-8">
                        Loading…
                      </td>
                    </tr>
                  ) : hoursBoardEmployees.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center text-gray-500 py-8">
                        No active staff employees found
                      </td>
                    </tr>
                  ) : filteredHoursBoard.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center text-gray-500 py-8">
                        No employees match filters
                      </td>
                    </tr>
                  ) : (
                    filteredHoursBoard.map((emp) => (
                      <tr
                        key={emp.employeeId}
                        className="hover:bg-base-200 cursor-pointer"
                        onClick={() =>
                          openEmployeeFile(emp.employeeId, {
                            year: hoursYear,
                            month: hoursMonth,
                          })
                        }
                        title="View working hours"
                      >
                        <td className="font-medium text-base text-gray-900 whitespace-nowrap">
                          <div className="flex items-center gap-3 min-w-0">
                            <HrEmployeeAvatar
                              employeeId={emp.employeeId}
                              name={emp.employeeName}
                              photoUrl={emp.photoUrl}
                              size="lg"
                            />
                            <div className="min-w-0">
                              <div className="truncate">{emp.employeeName}</div>
                              <div className="text-sm font-bold text-gray-500 truncate">
                                {emp.departmentName}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="text-right text-base text-gray-700">{emp.sickDays}</td>
                        <td className="text-right text-base text-gray-700">{emp.vacationDays}</td>
                        <td className="text-right text-base text-gray-700">{emp.generalDays}</td>
                        <td className="text-right text-base text-gray-700 whitespace-nowrap">
                          {emp.totalHours}
                        </td>
                        <td className="text-right text-base text-gray-700 whitespace-nowrap">
                          {emp.extraHours125}
                        </td>
                        <td className="text-right text-base text-gray-700 whitespace-nowrap">
                          {emp.extraHours150}
                        </td>
                        <td>
                          {emp.hoursSubmitted ? (
                            <span
                              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600"
                              title={
                                emp.submittedAt
                                  ? `Submitted ${formatSubmissionTime(emp.submittedAt)}`
                                  : 'Submitted'
                              }
                              aria-label="Submitted"
                            >
                              <CheckBadgeIcon className="h-5 w-5" aria-hidden />
                            </span>
                          ) : (
                            <span
                              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-amber-500/10 text-amber-600"
                              title="Hours not submitted for this month"
                              aria-label="Not submitted"
                            >
                              <ClockSolidIcon className="h-5 w-5" aria-hidden />
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {hubTab === 'leave' && (
          <div className="rounded-2xl bg-white border border-gray-200 p-4 md:p-6 shadow-sm space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap items-end gap-3 flex-1 min-w-0">
              <div className="relative min-w-[14rem] flex-1 max-w-sm">
                <span className="text-sm font-medium text-gray-600 mb-1 block">Search</span>
                <div className="relative">
                  <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="search"
                    value={leaveSearch}
                    onChange={(e) => setLeaveSearch(e.target.value)}
                    placeholder="Search employees…"
                    className="w-full rounded-full border border-gray-200 bg-white py-2 pl-9 pr-4 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <DocumentTextIcon className="w-4 h-4" />
                  Leave overlapping {formatDateRangeLabel(leaveFrom, leaveTo)}
                </div>
                <DateRangeFilters
                  from={leaveFrom}
                  to={leaveTo}
                  onFromChange={setLeaveFrom}
                  onToChange={setLeaveTo}
                />
              </div>
              <label className="flex flex-col gap-1">
                <span className="text-sm font-medium text-gray-600">Type</span>
                <select
                  className="rounded-full border border-gray-200 bg-white px-3.5 py-2 text-sm text-gray-800 min-w-[10rem] focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                  value={leaveTypeFilter}
                  onChange={(e) =>
                    setLeaveTypeFilter(e.target.value as 'all' | UnavailabilityType)
                  }
                >
                  {leaveTypeFilterPills.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-sm font-medium text-gray-600">Status</span>
                <select
                  className="rounded-full border border-gray-200 bg-white px-3.5 py-2 text-sm text-gray-800 min-w-[12rem] focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                  value={leaveStatusFilter}
                  onChange={(e) =>
                    setLeaveStatusFilter(e.target.value as 'all' | UnavailabilityApprovalStatus)
                  }
                >
                  {leaveStatusFilterPills.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-sm font-medium text-gray-600">Document</span>
                <select
                  className="rounded-full border border-gray-200 bg-white px-3.5 py-2 text-sm text-gray-800 min-w-[10rem] focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                  value={leaveDocFilter}
                  onChange={(e) =>
                    setLeaveDocFilter(e.target.value as 'all' | 'missing' | 'uploaded')
                  }
                >
                  <option value="all">All documents</option>
                  <option value="missing">Missing</option>
                  <option value="uploaded">Uploaded</option>
                </select>
              </label>
            </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  className="btn btn-sm rounded-full border-0 bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-600/50"
                  onClick={exportLeaveToExcel}
                  disabled={leaveExporting || leaveForList.length === 0}
                  title="Download as Excel"
                >
                  {leaveExporting ? (
                    <span className="loading loading-spinner loading-sm mr-2" />
                  ) : (
                    <FaFileExcel className="w-4 h-4 mr-1.5" />
                  )}
                  Export to Excel
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="table w-full text-base">
                <thead>
                  <tr className="text-sm uppercase tracking-wider text-gray-500">
                    <th className="bg-transparent font-semibold">Employee</th>
                    <th className="bg-transparent font-semibold">Type</th>
                    <th className="bg-transparent font-semibold">Dates</th>
                    <th className="bg-transparent font-semibold">Status</th>
                    <th className="bg-transparent font-semibold">Document</th>
                  </tr>
                </thead>
                <tbody>
                  {leaveForList.map((row) => {
                    const status = getUnavailabilityApprovalStatus(row);
                    const emp = employees.find((e) => e.id === row.employee_id);
                    const statusLabel =
                      status === 'pending'
                        ? 'Waiting for approval'
                        : status === 'declined'
                          ? 'Declined'
                          : 'Approved';
                    const statusClass =
                      status === 'pending'
                        ? 'text-sky-700'
                        : status === 'declined'
                          ? 'text-red-700'
                          : 'text-emerald-700';
                    return (
                      <tr
                        key={row.id}
                        className="hover:bg-base-200 cursor-pointer"
                        onClick={() => openEmployeeFile(row.employee_id, { fileTab: 'working-hours' })}
                        title="Open employee working hours"
                      >
                        <td className="font-medium text-base text-gray-900 whitespace-nowrap">
                          <div className="flex items-center gap-3 min-w-0">
                            <HrEmployeeAvatar
                              employeeId={row.employee_id}
                              name={
                                emp ? getEmployeeDisplayLabel(emp) : `Employee #${row.employee_id}`
                              }
                              photoUrl={emp?.photo_url}
                              size="lg"
                            />
                            <div className="min-w-0">
                              <div className="truncate">
                                {emp ? getEmployeeDisplayLabel(emp) : `Employee #${row.employee_id}`}
                              </div>
                              <div className="text-sm font-bold text-gray-500 truncate">
                                {emp?.department || '—'}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <UnavailabilityTypeBadge
                            type={row.unavailability_type}
                            size="md"
                            borderless
                            className="rounded-full px-3 py-1 text-sm font-semibold whitespace-nowrap"
                          />
                        </td>
                        <td className="text-base text-gray-700 whitespace-nowrap">
                          {unavailabilityDateRangeLabel(row.start_date, row.end_date)}
                        </td>
                        <td>
                          <span className={`text-sm font-semibold whitespace-nowrap ${statusClass}`}>
                            {statusLabel}
                          </span>
                        </td>
                        <td>
                          {unavailabilityNeedsDocument(row) ? (
                            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-700 whitespace-nowrap">
                              <ExclamationTriangleIcon className="w-4 h-4 shrink-0" />
                              Missing doc
                            </span>
                          ) : row.document_url?.trim() ? (
                            <button
                              type="button"
                              className="text-sm font-medium text-emerald-700 underline-offset-2 hover:underline"
                              title="View document"
                              onClick={(e) => {
                                e.stopPropagation();
                                const url = row.document_url!.trim();
                                setLeaveDocument({
                                  url,
                                  name: documentNameFromUrl(url),
                                  employeeName: emp
                                    ? getEmployeeDisplayLabel(emp)
                                    : `Employee #${row.employee_id}`,
                                  uploadedAt: row.created_at || undefined,
                                  reason: unavailabilityReasonText(row) || undefined,
                                });
                              }}
                            >
                              Uploaded
                            </button>
                          ) : (
                            <span className="text-sm text-gray-400">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {leaveForList.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-gray-400 text-base">
                        {leaveRows.length === 0
                          ? 'No leave in this date range'
                          : 'No leave matches the selected filters'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {hubTab === 'status' && (
          <div className="rounded-2xl bg-white border border-gray-200 shadow-sm">
            <TeamStatusModal embedded />
          </div>
        )}

        {hubTab === 'salaries' && (
          <div className="rounded-2xl bg-white border border-gray-200 p-4 md:p-6 shadow-sm">
            <EmployeeSalariesManager
              embedded
              initialYear={hoursYear}
              initialMonth={hoursMonth}
              onEmployeeClick={(id) => navigate(`/reports/hr-management/employees/${id}?fileTab=about`)}
              onSaved={() => {
                void loadHubData();
              }}
            />
          </div>
        )}

        {hubTab === 'entry-kiosk' && (
          <div className="rounded-2xl bg-white border border-gray-200 p-4 md:p-6 shadow-sm">
            <HrEntryKioskPanel />
          </div>
        )}
      </div>
      {leaveDocument && (
        <DocumentViewerModal
          isOpen
          onClose={() => setLeaveDocument(null)}
          documentUrl={leaveDocument.url}
          documentName={leaveDocument.name}
          employeeName={leaveDocument.employeeName}
          uploadedAt={leaveDocument.uploadedAt}
          sickDaysReason={leaveDocument.reason}
        />
      )}
    </div>
  );
}
