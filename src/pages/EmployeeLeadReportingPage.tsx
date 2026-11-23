import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import {
  ClipboardDocumentListIcon,
  MapPinIcon,
} from '@heroicons/react/24/outline';
import LeadAllocationSliders, {
  type LeadAllocationChangeState,
  type LeadAllocationRow,
} from '../components/employeeLeadReporting/LeadAllocationSliders';
import AddLeadToAllocationModal from '../components/employeeLeadReporting/AddLeadToAllocationModal';
import LeadAllocationBudgetAssistModal from '../components/employeeLeadReporting/LeadAllocationBudgetAssistModal';
import LeadAllocationSavedModal from '../components/employeeLeadReporting/LeadAllocationSavedModal';
import LeadAllocationOvertimeApprovalModal from '../components/employeeLeadReporting/LeadAllocationOvertimeApprovalModal';
import WorkEffortAllocator from '../components/employeeLeadReporting/WorkEffortAllocator';
import AllocationAreaSidebar from '../components/employeeLeadReporting/AllocationAreaSidebar';
import {
  addLeadToAllocationBuckets,
  allocationOverflowPercent,
  allocationRowFromCombinedLead,
  allocationPercentToWorkedMs,
  buildAllocationDayWorkedMs,
  canAccessLeadTimeReport,
  dailyAllocationGrandTotal,
  deleteDailyAllocation,
  fetchCurrentEmployeeContext,
  fetchDailyActivity,
  fetchDailyAllocation,
  fetchDailyEffortAllocations,
  fetchMissingLeadAllocationDates,
  filterIdentitiesByMinAllocationStage,
  enrichAllocationLeadDisplayMeta,
  formatAllocationPercent,
  formatAllocationWorkedDuration,
  formatLeadAllocationMissingDayMenuLabel,
  formatLeadAllocationMissingDayTabLabel,
  getJerusalemTodayIsoDate,
  isDailyAllocationValid,
  isMissingEffortAllocationsTable,
  isLeadAllocationEligibleStage,
  isLeadAllocationHoursNote,
  leadActivityKey,
  minHoursToMs,
  normalizeAllocationForSave,
  notifyLeadAllocationSaved,
  otherWorkPercentCap,
  rebalanceFlexAllocationBuckets,
  resolveLegacyLeadDisplayNumbers,
  replaceDailyEffortAllocations,
  saveDailyAllocation,
  scaleSharesTo100,
  setLeadAllocationPercentDraft,
  splitMissingAllocationDatesByWeek,
  setOtherWorkAllocationPercent,
  setOtherWorkAllocationPercentDraft,
  syncAllocationTo100,
  workIntervalDurationMs,
  type AllocationItemInput,
  type EmployeeDailyAllocation,
} from '../lib/employeeLeadReporting';
import {
  evaluateDailyLeadAllocationBudgets,
  type LeadAllocationBudgetHint,
  type LeadAllocationBudgetViolation,
} from '../lib/leadAllocationBudget';
import type { CombinedLead } from '../lib/legacyLeadsApi';
import {
  effortInputsFromDrafts,
  effortsForArea,
  WORK_AREAS,
  isEffortArea,
  type EffortTimeDraft,
  type WorkEffort,
} from '../lib/workAreaEfforts';
import { fetchCustomWorkEfforts } from '../lib/customWorkEfforts';
import {
  fetchDayMeetingsForEmployee,
  fetchMeetingChoices,
  saveMeetingChoice,
  type DayMeeting,
  type DayMeetingChoice,
} from '../lib/dayMeetings';
import DayMeetingsStrip from '../components/employeeLeadReporting/DayMeetingsStrip';
import { fetchClockInRecordsInRange } from '../lib/workingHoursExport';
import { replaceDayWithPendingManualSession } from '../lib/employeeClockInManual';
import {
  clockSessionExceedsOvertimeBase,
  fetchDayOvertimeApprovals,
  type StoredOvertimeApproval,
} from '../lib/employeeClockInOvertimeApproval';
import {
  fetchLatestOvertimeRequestStatus,
  formatOvertimeDatePlaceholder,
  formatOvertimeHoursPlaceholder,
  overtimeMinutesBeyondBase,
  requestMichaelOvertimeApproval,
  type OvertimeApprovalRequestStatus,
} from '../lib/employeeClockInOvertimeWhatsApp';
import {
  fetchActiveClockInLocations,
  filterClockInLocationsForEmployee,
  persistLastSelectedWorkplaceId,
  readLastSelectedWorkplaceId,
  type ClockInLocationOption,
} from '../lib/clockInLocations';

function activityToRow(
  activity: Awaited<ReturnType<typeof fetchDailyActivity>>[number],
  included: boolean,
  percent: number,
  pinned = false,
  extras?: {
    lead_number?: string;
    stage_id?: string | null;
    active_sub_effort_title?: string | null;
    category_id?: number | null;
    category_main?: string | null;
    category_sub?: string | null;
    subEffortIds?: number[];
  },
): LeadAllocationRow {
  return {
    key: leadActivityKey({
      lead_type: activity.lead_type,
      new_lead_id: activity.new_lead_id,
      legacy_lead_id: activity.legacy_lead_id,
      lead_number: extras?.lead_number || activity.lead_number,
      client_name: activity.client_name,
    }),
    lead_type: activity.lead_type,
    new_lead_id: activity.new_lead_id,
    legacy_lead_id: activity.legacy_lead_id,
    lead_number: extras?.lead_number || activity.lead_number,
    client_name: activity.client_name,
    percent,
    included,
    pinned,
    view_count: activity.view_count,
    last_viewed_at: activity.last_viewed_at,
    stage_id: extras?.stage_id ?? null,
    active_sub_effort_title: extras?.active_sub_effort_title ?? null,
    category_id: extras?.category_id ?? null,
    category_main: extras?.category_main ?? null,
    category_sub: extras?.category_sub ?? null,
    subEffortIds: extras?.subEffortIds ?? [],
  };
}

function allocationItemToRow(
  item: AllocationItemInput,
  extras?: {
    lead_number?: string;
    stage_id?: string | null;
    active_sub_effort_title?: string | null;
    category_id?: number | null;
    category_main?: string | null;
    category_sub?: string | null;
  },
): LeadAllocationRow {
  return {
    key: leadActivityKey({
      lead_type: item.lead_type,
      new_lead_id: item.new_lead_id,
      legacy_lead_id: item.legacy_lead_id,
      lead_number: extras?.lead_number || item.lead_number,
      client_name: item.client_name,
    }),
    lead_type: item.lead_type,
    new_lead_id: item.new_lead_id,
    legacy_lead_id: item.legacy_lead_id,
    lead_number: extras?.lead_number || item.lead_number,
    client_name: item.client_name,
    percent: item.percent,
    included: true,
    pinned: true,
    stage_id: extras?.stage_id ?? null,
    active_sub_effort_title: extras?.active_sub_effort_title ?? null,
    category_id: extras?.category_id ?? null,
    category_main: extras?.category_main ?? null,
    category_sub: extras?.category_sub ?? null,
    subEffortIds: item.subEffortIds ?? [],
  };
}

function isoToTimeInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  const hour = read('hour') === '24' ? '00' : read('hour');
  return `${hour}:${read('minute')}`;
}

/** An open clock-in has no end time. On today, the end is now so From/To match the hours already counted. */
function sessionEndIso(
  row: { clock_in_time: string; clock_out_time: string | null },
  workDate: string,
  now: Date,
): string {
  if (row.clock_out_time) return row.clock_out_time;
  if (workDate === getJerusalemTodayIsoDate(now)) return now.toISOString();
  return row.clock_in_time;
}

const DEFAULT_BASE_HOURS_FROM = '09:00';

/** Build a same-day HH:MM end time `hours` after `fromTime`. */
function timeInputPlusHours(fromTime: string, hours: number): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(fromTime.trim());
  if (!match) return '';
  const startMinutes = Number(match[1]) * 60 + Number(match[2]);
  if (!Number.isFinite(startMinutes)) return '';
  const addMinutes = Math.max(0, Math.round(hours * 60));
  const endMinutes = Math.min(23 * 60 + 59, startMinutes + addMinutes);
  const hh = String(Math.floor(endMinutes / 60)).padStart(2, '0');
  const mm = String(endMinutes % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

type HoursEditSnapshot = {
  fromTime: string;
  toTime: string;
  locationId: number | '';
};

type AllocationEditSnapshot = LeadAllocationChangeState &
  HoursEditSnapshot & {
    effortDrafts: Record<string, EffortTimeDraft>;
  };

/** Prefill From/To from a pending allocation session, else the earliest in / latest out that day. */
function deriveHoursFormDefaults(
  employeeRecords: Awaited<ReturnType<typeof fetchClockInRecordsInRange>>,
  selectableLocationIds: Set<number>,
  fallbackLocationId: number | '',
  workDate: string,
  now = new Date(),
): HoursEditSnapshot {
  const allocationSession = employeeRecords.find(
    (row) =>
      row.manually === true &&
      row.declined !== true &&
      isLeadAllocationHoursNote(row.notes),
  );
  if (allocationSession) {
    const loc =
      allocationSession.clock_in_location_id ??
      allocationSession.clock_out_location_id ??
      '';
    return {
      fromTime: isoToTimeInput(allocationSession.clock_in_time),
      toTime: isoToTimeInput(sessionEndIso(allocationSession, workDate, now)),
      locationId:
        typeof loc === 'number' && selectableLocationIds.has(loc) ? loc : fallbackLocationId,
    };
  }

  let earliestIn: string | null = null;
  let latestOut: string | null = null;
  let locationId: number | '' = fallbackLocationId;
  for (const row of employeeRecords) {
    if (row.declined === true) continue;
    if (!earliestIn || row.clock_in_time < earliestIn) {
      earliestIn = row.clock_in_time;
      const loc = row.clock_in_location_id ?? row.clock_out_location_id;
      if (typeof loc === 'number' && selectableLocationIds.has(loc)) locationId = loc;
    }
    const out = sessionEndIso(row, workDate, now);
    if (!latestOut || out > latestOut) latestOut = out;
  }

  return {
    fromTime: isoToTimeInput(earliestIn),
    toTime: isoToTimeInput(latestOut),
    locationId,
  };
}

/**
 * One tab inside the grey oval, shared by the week's days and the "more" trigger.
 *
 * The open day is the white one, the way a segmented control marks its selection.
 */
function missingDayTabClass(active: boolean): string {
  return `rounded-full px-4 py-2 text-sm font-semibold leading-none transition ${
    active
      ? 'bg-white text-gray-900 shadow-sm'
      : 'text-gray-600 hover:bg-white/60 hover:text-gray-900'
  }`;
}

const EmployeeLeadReportingPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const dateFromUrl = searchParams.get('date');
  const initialWorkDate = (() => {
    const today = getJerusalemTodayIsoDate();
    if (dateFromUrl && /^\d{4}-\d{2}-\d{2}$/.test(dateFromUrl) && dateFromUrl <= today) {
      return dateFromUrl;
    }
    return today;
  })();

  const [permissionsLoaded, setPermissionsLoaded] = useState(false);
  const [hasAccess, setHasAccess] = useState(false);
  const [workDate, setWorkDate] = useState(initialWorkDate);
  const [missingDates, setMissingDates] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [employeeContext, setEmployeeContext] = useState<
    Awaited<ReturnType<typeof fetchCurrentEmployeeContext>>
  >(null);
  const [rows, setRows] = useState<LeadAllocationRow[]>([]);
  const [otherWorkPercent, setOtherWorkPercent] = useState(0);
  const [effortDrafts, setEffortDrafts] = useState<Record<string, EffortTimeDraft>>({});
  const [customEfforts, setCustomEfforts] = useState<WorkEffort[]>([]);
  const [dayMeetings, setDayMeetings] = useState<DayMeeting[]>([]);
  const [meetingChoices, setMeetingChoices] = useState<Record<number, DayMeetingChoice>>({});
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editSnapshot, setEditSnapshot] = useState<AllocationEditSnapshot | null>(null);
  const [addLeadModalOpen, setAddLeadModalOpen] = useState(false);
  const [savedThanksOpen, setSavedThanksOpen] = useState(false);
  const [recordedDayWorkedMs, setRecordedDayWorkedMs] = useState(0);
  const [budgetHints, setBudgetHints] = useState<LeadAllocationBudgetHint[]>([]);
  const [budgetViolations, setBudgetViolations] = useState<LeadAllocationBudgetViolation[]>([]);
  const [budgetAssistOpen, setBudgetAssistOpen] = useState(false);
  const [checkingBudget, setCheckingBudget] = useState(false);

  const [fromTime, setFromTime] = useState('');
  const [toTime, setToTime] = useState('');
  const [hoursAdjusted, setHoursAdjusted] = useState(false);
  const [locationId, setLocationId] = useState<number | ''>('');
  /** The day's stored overtime session, including whether Michael already approved it. */
  const [storedOvertime, setStoredOvertime] = useState<StoredOvertimeApproval | null>(null);
  const [overtimeRequestStatus, setOvertimeRequestStatus] = useState<OvertimeApprovalRequestStatus | null>(null);
  const [overtimePrompt, setOvertimePrompt] = useState<'before-save' | 'send' | null>(null);
  const [overtimeReason, setOvertimeReason] = useState('');
  const [locations, setLocations] = useState<ClockInLocationOption[]>([]);
  const loadRequestIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ctx = await fetchCurrentEmployeeContext();
        if (cancelled) return;
        const allowed = canAccessLeadTimeReport({
          leadTimeReportingEnabled: ctx?.leadTimeReportingEnabled,
        });
        setHasAccess(allowed);
        setPermissionsLoaded(true);
        if (!allowed) {
          toast.error('Access denied. Daily lead allocation is not enabled for your account.');
          navigate('/');
        }
      } catch (error) {
        console.error('[EmployeeLeadReportingPage] permission check failed:', error);
        if (!cancelled) {
          setHasAccess(false);
          setPermissionsLoaded(true);
          toast.error('Access denied. Daily lead allocation is not enabled for your account.');
          navigate('/');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const selectWorkDate = useCallback(
    (nextDate: string) => {
      const today = getJerusalemTodayIsoDate();
      const safe = nextDate && nextDate <= today ? nextDate : today;
      setWorkDate(safe);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (safe === today) next.delete('date');
          else next.set('date', safe);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // Keep local date in sync when arriving via header badge / shared link.
  useEffect(() => {
    const today = getJerusalemTodayIsoDate();
    const fromUrl = searchParams.get('date');
    if (fromUrl && /^\d{4}-\d{2}-\d{2}$/.test(fromUrl) && fromUrl <= today && fromUrl !== workDate) {
      setWorkDate(fromUrl);
    }
  }, [searchParams, workDate]);

  const refreshMissingDates = useCallback(
    async (
      employeeId: number,
      schedule?: {
        weekdays?: number[] | null;
        excludedDates?: string[] | null;
      },
    ) => {
      try {
        const missing = await fetchMissingLeadAllocationDates(employeeId, {
          weekdays: schedule?.weekdays ?? undefined,
          excludedDates: schedule?.excludedDates ?? undefined,
        });
        setMissingDates(missing);
      } catch (error) {
        console.error('[EmployeeLeadReportingPage] missing dates failed:', error);
      }
    },
    [],
  );

  const loadData = useCallback(async () => {
    if (!hasAccess) return;
    const requestId = ++loadRequestIdRef.current;
    setLoading(true);
    try {
      const ctx = await fetchCurrentEmployeeContext();
      if (requestId !== loadRequestIdRef.current) return;
      setEmployeeContext(ctx);
      if (!ctx) {
        setRows([]);
        setOtherWorkPercent(0);
        setEffortDrafts({});
        setLastSavedAt(null);
        setIsEditing(true);
        setEditSnapshot(null);
        setRecordedDayWorkedMs(0);
        setFromTime('');
        setToTime('');
        setLocationId('');
        setLocations([]);
        setStoredOvertime(null);
        setOvertimeRequestStatus(null);
        return;
      }

      if (
        !canAccessLeadTimeReport({
          leadTimeReportingEnabled: ctx.leadTimeReportingEnabled,
        })
      ) {
        setHasAccess(false);
        toast.error('Access denied. Daily lead allocation is not enabled for your account.');
        navigate('/');
        return;
      }

      const [activityRaw, allocation, clockRecords, locationOptions, dayApprovals] =
        await Promise.all([
          fetchDailyActivity(ctx.employeeId, workDate),
          fetchDailyAllocation(ctx.employeeId, workDate),
          fetchClockInRecordsInRange(workDate, workDate),
          fetchActiveClockInLocations(),
          // Whether the stored hours already carry Michael's approval, which the hours alone
          // cannot say — and which decides whether saving has to ask for it again.
          fetchDayOvertimeApprovals(ctx.employeeId, workDate).catch(() => []),
        ]);
      if (requestId !== loadRequestIdRef.current) return;

      const overtimeSession =
        dayApprovals.find((session) =>
          clockSessionExceedsOvertimeBase(session.clockInTime, session.clockOutTime, ctx.minHours),
        ) ?? null;
      setStoredOvertime(overtimeSession);
      setOvertimeRequestStatus(
        overtimeSession ? await fetchLatestOvertimeRequestStatus(overtimeSession.sessionId) : null,
      );

      // Only Handler Nominated (105) and later stages appear on the allocation list.
      const [activity, eligibleSavedItems] = await Promise.all([
        filterIdentitiesByMinAllocationStage(activityRaw),
        filterIdentitiesByMinAllocationStage(allocation?.items || []),
      ]);
      if (requestId !== loadRequestIdRef.current) return;

      const employeeRecords = clockRecords.filter(
        (row) => row.employee_id === ctx.employeeId,
      );
      const allocationMs = buildAllocationDayWorkedMs(employeeRecords, ctx.employeeId);
      setRecordedDayWorkedMs(allocationMs);

      // Unlike the clock-in modal, this dropdown keeps the QR-only Ramat Gan office: the
      // employee is correcting hours after the fact, so the office is a legitimate answer.
      const selectable = filterClockInLocationsForEmployee(
        locationOptions,
        ctx.worksFromHome,
      );
      setLocations(selectable);

      const allocationSession = employeeRecords.find(
        (row) =>
          row.manually === true &&
          row.declined !== true &&
          isLeadAllocationHoursNote(row.notes),
      );
      const lastId = readLastSelectedWorkplaceId();
      const fallbackLocationId =
        lastId != null && selectable.some((loc) => loc.id === lastId)
          ? lastId
          : selectable[0]?.id ?? '';
      const hoursDefaults = deriveHoursFormDefaults(
        employeeRecords,
        new Set(selectable.map((loc) => loc.id)),
        fallbackLocationId,
        workDate,
      );
      if (allocationMs > 0 && (allocationSession || hoursDefaults.fromTime)) {
        setFromTime(hoursDefaults.fromTime);
        setToTime(hoursDefaults.toTime);
        setLocationId(hoursDefaults.locationId);
      } else {
        const start = DEFAULT_BASE_HOURS_FROM;
        const end = timeInputPlusHours(start, ctx.minHours);
        setFromTime(end ? start : '');
        setToTime(end);
        setLocationId(hoursDefaults.locationId || fallbackLocationId);
      }
      setHoursAdjusted(false);

      const savedByKey = new Map<string, AllocationItemInput>();
      for (const item of eligibleSavedItems) {
        savedByKey.set(
          leadActivityKey({
            lead_type: item.lead_type,
            new_lead_id: item.new_lead_id,
            legacy_lead_id: item.legacy_lead_id,
            lead_number: item.lead_number,
            client_name: item.client_name,
          }),
          item,
        );
      }

      const displayMeta = await enrichAllocationLeadDisplayMeta([
        ...activity,
        ...eligibleSavedItems,
      ]);

      const mergedRows: LeadAllocationRow[] = activity.map((act) => {
        const key = leadActivityKey({
          lead_type: act.lead_type,
          new_lead_id: act.new_lead_id,
          legacy_lead_id: act.legacy_lead_id,
          lead_number: act.lead_number,
          client_name: act.client_name,
        });
        const meta = displayMeta.get(key);
        const saved = savedByKey.get(key);
        const extras = {
          lead_number: meta?.lead_number || act.lead_number,
          stage_id: meta?.stageId ?? null,
          active_sub_effort_title: meta?.active_sub_effort_title ?? null,
          category_id: meta?.category_id ?? null,
          category_main: meta?.category_main ?? null,
          category_sub: meta?.category_sub ?? null,
          subEffortIds: saved?.subEffortIds ?? [],
        };
        if (saved) {
          savedByKey.delete(key);
          return activityToRow(act, true, saved.percent, true, extras);
        }
        return activityToRow(act, false, 0, false, extras);
      });

      for (const saved of savedByKey.values()) {
        const key = leadActivityKey({
          lead_type: saved.lead_type,
          new_lead_id: saved.new_lead_id,
          legacy_lead_id: saved.legacy_lead_id,
          lead_number: saved.lead_number,
          client_name: saved.client_name,
        });
        const meta = displayMeta.get(key);
        mergedRows.push(
          allocationItemToRow(saved, {
            lead_number: meta?.lead_number || saved.lead_number,
            stage_id: meta?.stageId ?? null,
            active_sub_effort_title: meta?.active_sub_effort_title ?? null,
            category_id: meta?.category_id ?? null,
            category_main: meta?.category_main ?? null,
            category_sub: meta?.category_sub ?? null,
          }),
        );
      }

      const hasSavedAllocation = Boolean(allocation);
      const cap = otherWorkPercentCap(allocationMs, ctx.minHours);
      const synced = hasSavedAllocation
        ? syncAllocationTo100(mergedRows, cap)
        : rebalanceFlexAllocationBuckets(0, false, mergedRows, cap);

      const cappedOther = Math.min(synced.otherWorkPercent, cap);
      const finalState =
        cappedOther === synced.otherWorkPercent
          ? synced
          : setOtherWorkAllocationPercent(synced.rows, cappedOther, cap);

      setRows(finalState.rows);
      setOtherWorkPercent(finalState.otherWorkPercent);
      setLastSavedAt(allocation?.updated_at || allocation?.submitted_at || null);

      let loadedEfforts: Awaited<ReturnType<typeof fetchDailyEffortAllocations>> = [];
      if (allocation?.id) {
        try {
          loadedEfforts = await fetchDailyEffortAllocations(allocation.id);
        } catch (effortError) {
          if (!isMissingEffortAllocationsTable(effortError)) throw effortError;
        }
      }
      if (requestId !== loadRequestIdRef.current) return;
      setEffortDrafts(
        Object.fromEntries(
          loadedEfforts.map((item) => [
            item.effortId,
            { percent: item.percent, departmentIds: item.departmentIds ?? [], firms: item.firms ?? [], leads: item.leads ?? [] },
          ]),
        ),
      );
      setIsEditing(!hasSavedAllocation);
      setEditSnapshot(null);
      void refreshMissingDates(ctx.employeeId, {
        weekdays: ctx.leadTimeReportingWeekdays,
        excludedDates: ctx.leadTimeReportingExcludedDates,
      });
    } catch (error) {
      if (requestId !== loadRequestIdRef.current) return;
      console.error('[EmployeeLeadReportingPage] load failed:', error);
      toast.error('Failed to load lead activity.');
    } finally {
      if (requestId === loadRequestIdRef.current) {
        setLoading(false);
      }
    }
  }, [hasAccess, workDate, navigate, refreshMissingDates]);

  useEffect(() => {
    if (!permissionsLoaded || !hasAccess) return;
    void loadData();
  }, [permissionsLoaded, hasAccess, loadData]);

  useEffect(() => {
    if (!permissionsLoaded || !hasAccess) return;
    let cancelled = false;
    void fetchCustomWorkEfforts()
      .then((efforts) => {
        if (cancelled) return;
        setCustomEfforts((current) => {
          const ids = new Set(efforts.map((effort) => effort.id));
          return [...efforts, ...current.filter((effort) => !ids.has(effort.id))];
        });
      })
      .catch((error) => {
        console.error('[EmployeeLeadReportingPage] custom efforts failed:', error);
      });
    return () => {
      cancelled = true;
    };
  }, [permissionsLoaded, hasAccess]);

  useEffect(() => {
    const employeeId = employeeContext?.employeeId;
    if (!employeeId || !workDate) {
      setDayMeetings([]);
      setMeetingChoices({});
      return;
    }
    let cancelled = false;
    void Promise.all([
      fetchDayMeetingsForEmployee({
        employeeId,
        employeeName: employeeContext.employeeName,
        workDate,
      }),
      fetchMeetingChoices(employeeId, workDate).catch((error) => {
        console.error('[EmployeeLeadReportingPage] meeting choices failed:', error);
        return {} as Record<number, DayMeetingChoice>;
      }),
    ])
      .then(([meetings, choices]) => {
        if (cancelled) return;
        setDayMeetings(meetings);
        setMeetingChoices(choices);
      })
      .catch((error) => {
        console.error('[EmployeeLeadReportingPage] day meetings failed:', error);
        if (!cancelled) setDayMeetings([]);
      });
    return () => {
      cancelled = true;
    };
  }, [employeeContext, workDate]);

  const meetingsByEffort = useMemo(() => {
    const byEffort: Record<string, DayMeeting[]> = {};
    for (const meeting of dayMeetings) {
      const choice = meetingChoices[meeting.id];
      if (!choice || choice.kind !== 'area') continue;
      const effortId = `${choice.area}.meetings`;
      (byEffort[effortId] ??= []).push(meeting);
    }
    return byEffort;
  }, [dayMeetings, meetingChoices]);

  const meetingMarkByKey = useMemo(() => {
    const marks: Record<string, 'meeting' | 'no_show' | 'away'> = {};
    for (const meeting of dayMeetings) {
      if (!meeting.leadKey) continue;
      const choice = meetingChoices[meeting.id];
      const next =
        !choice || choice.kind === 'area'
          ? 'meeting'
          : choice.reason === 'client_no_show'
            ? 'no_show'
            : 'away';
      const current = marks[meeting.leadKey];
      if (current === 'meeting' || next === 'meeting') marks[meeting.leadKey] = 'meeting';
      else if (!current) marks[meeting.leadKey] = next;
    }
    return marks;
  }, [dayMeetings, meetingChoices]);

  const chooseMeeting = async (meetingId: number, choice: DayMeetingChoice | null) => {
    const employeeId = employeeContext?.employeeId;
    if (!employeeId) return;
    const previous = meetingChoices[meetingId];
    setMeetingChoices((current) => {
      const next = { ...current };
      if (choice) next[meetingId] = choice;
      else delete next[meetingId];
      return next;
    });
    try {
      await saveMeetingChoice({ employeeId, workDate, meetingId, choice });
    } catch (error) {
      console.error('[EmployeeLeadReportingPage] save meeting choice failed:', error);
      setMeetingChoices((current) => {
        const next = { ...current };
        if (previous) next[meetingId] = previous;
        else delete next[meetingId];
        return next;
      });
      const message = String((error as { message?: string })?.message || '');
      toast.error(
        /does not exist|schema cache/i.test(message)
          ? 'Run sql/2026-11-18_employee_effort_allocations.sql in Supabase, then file the meeting again.'
          : 'Could not save that meeting.',
      );
    }
  };

  const minHours = employeeContext?.minHours ?? 8;
  const minMs = minHoursToMs(minHours);
  const isAllocationLocked = Boolean(lastSavedAt) && !isEditing;
  const isEditingSavedAllocation = Boolean(lastSavedAt) && isEditing;
  // Below base always; also while editing a saved allocation so hours can be corrected.
  const showHoursForm = recordedDayWorkedMs < minMs || isEditingSavedAllocation;

  const manualIntervalMs = workIntervalDurationMs(workDate, fromTime, toTime);
  const writingHours = showHoursForm || hoursAdjusted;
  const dayWorkedMs =
    writingHours && manualIntervalMs > 0 ? manualIntervalMs : recordedDayWorkedMs;

  const otherWorkMax = otherWorkPercentCap(dayWorkedMs, minHours);
  const rowsRef = useRef(rows);
  const otherWorkPercentRef = useRef(otherWorkPercent);
  rowsRef.current = rows;
  otherWorkPercentRef.current = otherWorkPercent;

  useEffect(() => {
    if (otherWorkPercentRef.current <= otherWorkMax) return;
    // Cap shrinks (e.g. into overtime) — clamp other work only; leads stay free until save.
    const next = setOtherWorkAllocationPercentDraft(
      rowsRef.current,
      otherWorkPercentRef.current,
      otherWorkMax,
    );
    setRows(next.rows);
    setOtherWorkPercent(next.otherWorkPercent);
  }, [otherWorkMax]);

  /*
   * Only the current week is shown beside the date box; an older backlog goes behind "more" so the
   * strip cannot grow until it shoves the heading around.
   */
  const { thisWeek: thisWeekMissingDates, earlier: earlierMissingDates } = useMemo(
    () => splitMissingAllocationDatesByWeek(missingDates),
    [missingDates],
  );

  const includedRows = useMemo(() => rows.filter((row) => row.included), [rows]);
  const handlingSelected = true;
  const effortItems = useMemo(
    () => effortInputsFromDrafts(WORK_AREAS.map((area) => area.id), effortDrafts, customEfforts),
    [customEfforts, effortDrafts],
  );
  const effortTotal = effortItems.reduce((sum, item) => sum + item.percent, 0);
  const handlingTotal = dailyAllocationGrandTotal(includedRows, otherWorkPercent);
  const shareByArea = useMemo(() => {
    const totals: Record<string, { ms: number; percent: number }> = {
      handling: {
        ms: allocationPercentToWorkedMs(dayWorkedMs, handlingTotal),
        percent: handlingTotal,
      },
    };
    for (const area of WORK_AREAS) {
      if (!isEffortArea(area.id)) continue;
      const percent = [...effortsForArea(area.id), ...customEfforts.filter((effort) => effort.area === area.id)].reduce(
        (sum, effort) => sum + Number(effortDrafts[effort.id]?.percent || 0),
        0,
      );
      totals[area.id] = {
        ms: allocationPercentToWorkedMs(dayWorkedMs, percent),
        percent,
      };
    }
    return totals;
  }, [customEfforts, dayWorkedMs, effortDrafts, handlingTotal]);
  const areaShareLabel = (areaId: string) => {
    const share = shareByArea[areaId];
    if (dayWorkedMs > 0) return formatAllocationWorkedDuration(share?.ms || 0);
    return `${formatAllocationPercent(share?.percent || 0)}%`;
  };
  const grandTotal = handlingSelected ? handlingTotal + effortTotal : effortTotal;
  const sidebarAreas = useMemo(
    () => [
      WORK_AREAS.find((area) => area.id === 'handling'),
      ...WORK_AREAS.filter((area) => area.id !== 'handling'),
    ].filter((area): area is (typeof WORK_AREAS)[number] => Boolean(area)),
    [],
  );
  const [activeAreaId, setActiveAreaId] = useState('handling');

  useEffect(() => {
    const elements = sidebarAreas
      .map((area) => document.getElementById(`allocation-${area.id}`))
      .filter((element): element is HTMLElement => Boolean(element));
    if (elements.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const next = visible[0]?.target.id.replace('allocation-', '');
        if (next) setActiveAreaId(next);
      },
      { rootMargin: '-12% 0px -55% 0px', threshold: [0.1, 0.25, 0.5] },
    );
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [sidebarAreas, employeeContext, loading]);
  /*
   * Over 100% is blocked rather than rescaled: a day that adds up to 160% cannot be saved as what
   * the person meant, and quietly scaling it down submits numbers they never chose. Under 100% is
   * still balanced up on save, which takes nothing away from them.
   * Handling on its own still uses the lead total, so a lead-only day reads the same as before.
   */
  const overAllocatedBy =
    handlingSelected && effortItems.length === 0
      ? allocationOverflowPercent(includedRows, otherWorkPercent)
      : Math.max(0, Math.round(grandTotal) - 100);
  const isOverAllocated = overAllocatedBy > 0;
  const dayTotalLabel = formatAllocationPercent(grandTotal);
  const allocationStatus = isAllocationLocked
    ? null
    : isOverAllocated
      ? `This day is ${dayTotalLabel}%. Take off ${formatAllocationPercent(overAllocatedBy)}% to save.`
      : Math.abs(grandTotal - 100) <= 0.01
        ? 'This day is 100%. Ready to save.'
        : grandTotal > 0.01
          ? `This day is ${dayTotalLabel}%. Saving will fill it to 100%.`
          : 'Nothing allocated yet.';
  // Save is allowed whenever something is allocated; save itself normalizes to 100% + 10/30 other-work cap.
  const canSave = handlingSelected
    ? includedRows.length > 0 || Number(otherWorkPercent) > 0 || effortItems.length > 0
    : effortItems.length > 0;
  const existingLeadKeys = useMemo(() => new Set(rows.map((row) => row.key)), [rows]);

  const handleStartEdit = () => {
    setEditSnapshot({
      rows: rows.map((row) => ({ ...row })),
      otherWorkPercent,
      fromTime,
      toTime,
      locationId,
      effortDrafts: { ...effortDrafts },
    });
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    if (editSnapshot) {
      setRows(editSnapshot.rows);
      setOtherWorkPercent(editSnapshot.otherWorkPercent);
      setFromTime(editSnapshot.fromTime);
      setToTime(editSnapshot.toTime);
      setLocationId(editSnapshot.locationId);
      setEffortDrafts(editSnapshot.effortDrafts);
    }
    setEditSnapshot(null);
    setIsEditing(false);
  };

  const handleAllocationChange = (state: LeadAllocationChangeState) => {
    if (isAllocationLocked) return;
    setRows(state.rows);
    setOtherWorkPercent(state.otherWorkPercent);
  };

  const handleAddLead = async (lead: CombinedLead) => {
    if (isAllocationLocked) return;
    if (!isLeadAllocationEligibleStage(lead.stage)) {
      toast.error('Only leads from Handler Nominated (stage 105) and up can be added.');
      return;
    }
    const newRow = allocationRowFromCombinedLead(lead);
    if (!newRow) {
      toast.error('Could not add this lead.');
      return;
    }
    if (existingLeadKeys.has(newRow.key)) {
      toast.error('This lead is already in the list.');
      return;
    }

    if (
      newRow.lead_type === 'legacy' &&
      newRow.legacy_lead_id != null &&
      (!newRow.lead_number.includes('/') || newRow.lead_number.includes('/?'))
    ) {
      try {
        const resolved = await resolveLegacyLeadDisplayNumbers([newRow.legacy_lead_id]);
        const nextNumber = resolved.get(newRow.legacy_lead_id);
        if (nextNumber) newRow.lead_number = nextNumber;
      } catch (error) {
        console.warn('[EmployeeLeadReportingPage] resolve add-lead number failed:', error);
      }
    }

    try {
      const meta = await enrichAllocationLeadDisplayMeta([newRow]);
      const display = meta.get(newRow.key);
      if (display?.lead_number) newRow.lead_number = display.lead_number;
      if (display?.stageId) newRow.stage_id = display.stageId;
      newRow.active_sub_effort_title = display?.active_sub_effort_title ?? null;
      newRow.category_id = display?.category_id ?? null;
      newRow.category_main = display?.category_main ?? null;
      newRow.category_sub = display?.category_sub ?? null;
      newRow.subEffortIds = [];
    } catch (error) {
      console.warn('[EmployeeLeadReportingPage] enrich add-lead meta failed:', error);
    }

    const rebalanced = addLeadToAllocationBuckets(rows, newRow, otherWorkMax);
    setOtherWorkPercent(rebalanced.otherWorkPercent);
    setRows(rebalanced.rows);
    toast.success(`Added #${newRow.lead_number}`);
  };

  const refreshBudgetHints = useCallback(
    async (nextRows: LeadAllocationRow[], workedMs: number) => {
      if (!employeeContext) {
        setBudgetHints([]);
        return;
      }
      const leads = nextRows
        .filter((row) => row.included && row.percent > 0)
        .map((row) => ({
          key: row.key,
          lead_type: row.lead_type,
          new_lead_id: row.new_lead_id,
          legacy_lead_id: row.legacy_lead_id,
          lead_number: row.lead_number,
          client_name: row.client_name,
          percent: row.percent,
        }));
      if (leads.length === 0 || !(workedMs > 0)) {
        setBudgetHints([]);
        return;
      }
      try {
        const result = await evaluateDailyLeadAllocationBudgets({
          employeeId: employeeContext.employeeId,
          workDate,
          dayWorkedMs: workedMs,
          leads,
        });
        setBudgetHints(result.hints);
      } catch (error) {
        console.warn('[EmployeeLeadReportingPage] budget hint refresh failed:', error);
      }
    },
    [employeeContext, workDate],
  );

  useEffect(() => {
    if (loading || isAllocationLocked) return;
    const timer = window.setTimeout(() => {
      void refreshBudgetHints(rows, dayWorkedMs);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [loading, isAllocationLocked, rows, dayWorkedMs, refreshBudgetHints]);

  /**
   * These exact hours are already stored. An approved day, or one already sent to Michael,
   * can be re-allocated without writing the clock row or the WhatsApp again.
   */
  const storedHoursMatch =
    storedOvertime != null &&
    storedOvertime.clockInTime === fromTime &&
    storedOvertime.clockOutTime === toTime &&
    (storedOvertime.locationId ?? '') === locationId;
  const storedHoursApproved = storedHoursMatch && storedOvertime?.approved === true;
  const storedHoursAwaitingReply = storedHoursMatch && overtimeRequestStatus === 'pending';
  /** Saved overtime that still needs a reason sent to Michael. */
  const overtimeAwaitingSend =
    storedOvertime && !storedOvertime.approved && overtimeRequestStatus !== 'pending'
      ? storedOvertime
      : null;

  const commitWorkHours = (nextFrom: string, nextTo: string) => {
    setHoursAdjusted(true);
    setFromTime(nextFrom);
    setToTime(nextTo);
  };

  const handleSave = async (options: { overtimeReason?: string } = {}) => {
    if (!employeeContext) return;
    if (!canSave) {
      toast.error('Allocate time on a lead, other work, or an effort before saving.');
      return;
    }
    if (isOverAllocated) {
      toast.error(
        `Your day adds up to ${formatAllocationPercent(grandTotal)}%. You can allocate at most 100% — take off ${formatAllocationPercent(overAllocatedBy)}% and save again.`,
      );
      return;
    }

    if (writingHours) {
      if (!fromTime || !toTime) {
        toast.error('Enter from and to times for your work day.');
        return;
      }
      if (manualIntervalMs <= 0) {
        toast.error('To time must be after from time.');
        return;
      }
      if (!locationId) {
        toast.error('Select where you worked.');
        return;
      }
    }

    setSaving(true);
    setCheckingBudget(true);
    try {
      let effectiveWorkedMs = dayWorkedMs;

      if (writingHours && fromTime && toTime && locationId) {
        const needsApproval = clockSessionExceedsOvertimeBase(fromTime, toTime, minHours);
        const reason = options.overtimeReason?.trim() || '';

        if (needsApproval && (storedHoursApproved || storedHoursAwaitingReply)) {
          effectiveWorkedMs = workIntervalDurationMs(workDate, fromTime, toTime);
        } else if (needsApproval && !reason) {
          setOvertimePrompt('before-save');
          return;
        } else if (needsApproval) {
          let sessionId = storedHoursMatch && storedOvertime ? storedOvertime.sessionId : 0;
          if (!sessionId) {
            sessionId = await replaceDayWithPendingManualSession({
              employeeId: employeeContext.employeeId,
              userId: employeeContext.userId,
              date: workDate,
              clockInTime: fromTime,
              clockOutTime: toTime,
              locationId: Number(locationId),
              approvalDeferred: true,
            });
            setStoredOvertime({
              sessionId,
              clockInTime: fromTime,
              clockOutTime: toTime,
              notes: null,
              locationId: Number(locationId),
              clockOutLocationId: Number(locationId),
              approved: false,
              storagePath: null,
              fileName: null,
              mimeType: null,
            });
          }
          const totalMinutes = Math.round(workIntervalDurationMs(workDate, fromTime, toTime) / 60000);
          const workplace = locations.find((item) => item.id === Number(locationId))?.name || 'Not set';
          await requestMichaelOvertimeApproval({
            employeeId: employeeContext.employeeId,
            reason,
            hours: formatOvertimeHoursPlaceholder({
              minutes: overtimeMinutesBeyondBase(totalMinutes, minHours),
              dateKey: workDate,
              from: fromTime,
              to: toTime,
            }),
            workplace,
            date: formatOvertimeDatePlaceholder([workDate]),
            clockInIds: [sessionId],
          });
          setOvertimeRequestStatus('pending');
          persistLastSelectedWorkplaceId(Number(locationId));
          effectiveWorkedMs = workIntervalDurationMs(workDate, fromTime, toTime);
          setRecordedDayWorkedMs(effectiveWorkedMs);
          toast.success('Message sent to Michael Decker. Your extra hours are waiting for his approval.');
        } else {
          await replaceDayWithPendingManualSession({
            employeeId: employeeContext.employeeId,
            userId: employeeContext.userId,
            date: workDate,
            clockInTime: fromTime,
            clockOutTime: toTime,
            locationId: Number(locationId),
          });
          persistLastSelectedWorkplaceId(Number(locationId));
          effectiveWorkedMs = workIntervalDurationMs(workDate, fromTime, toTime);
          setRecordedDayWorkedMs(effectiveWorkedMs);
          setStoredOvertime(null);
          setOvertimeRequestStatus(null);
        }
        setOvertimePrompt(null);
        setOvertimeReason('');
        setHoursAdjusted(false);
      }

      const effectiveOtherMax = otherWorkPercentCap(effectiveWorkedMs, minHours);
      const handlingOnly = handlingSelected && effortItems.length === 0;

      let saved: EmployeeDailyAllocation;
      if (handlingOnly) {
        const normalized = normalizeAllocationForSave(rows, otherWorkPercent, effectiveOtherMax);
        setRows(normalized.rows);
        setOtherWorkPercent(normalized.otherWorkPercent);

        const normalizedIncluded = normalized.rows.filter((row) => row.included);
        if (!isDailyAllocationValid(normalizedIncluded, normalized.otherWorkPercent, effectiveOtherMax)) {
          toast.error(
            `Could not balance to 100% with other work capped at ${effectiveOtherMax}%. Adjust leads and try again.`,
          );
          return;
        }

        const leadsForBudget = normalizedIncluded.map((row) => ({
          key: row.key,
          lead_type: row.lead_type,
          new_lead_id: row.new_lead_id,
          legacy_lead_id: row.legacy_lead_id,
          lead_number: row.lead_number,
          client_name: row.client_name,
          percent: row.percent,
        }));

        const budget = await evaluateDailyLeadAllocationBudgets({
          employeeId: employeeContext.employeeId,
          workDate,
          dayWorkedMs: effectiveWorkedMs,
          leads: leadsForBudget,
        });
        setBudgetHints(budget.hints);

        if (budget.violations.length > 0) {
          setBudgetViolations(budget.violations);
          setBudgetAssistOpen(true);
          toast.error(
            budget.violations.length === 1
              ? `Lead #${budget.violations[0].lead_number} is over the employee cost budget.`
              : `${budget.violations.length} leads are over the employee cost budget.`,
          );
          return;
        }

        const items: AllocationItemInput[] = normalizedIncluded.map((row) => ({
          lead_type: row.lead_type,
          new_lead_id: row.new_lead_id,
          legacy_lead_id: row.legacy_lead_id,
          lead_number: row.lead_number,
          client_name: row.client_name,
          percent: row.percent,
          subEffortIds: row.subEffortIds ?? [],
        }));

        saved = await saveDailyAllocation({
          employeeId: employeeContext.employeeId,
          userId: employeeContext.userId,
          workDate,
          items,
          otherWorkPercent: normalized.otherWorkPercent,
        });
        try {
          await replaceDailyEffortAllocations(saved.id, []);
        } catch (effortError) {
          if (!isMissingEffortAllocationsTable(effortError)) throw effortError;
        }
        setEffortDrafts({});
      } else {
        const leadRows = handlingSelected ? rows.filter((row) => row.included) : [];
        const otherShare = handlingSelected ? Number(otherWorkPercent) || 0 : 0;
        const scaled = scaleSharesTo100([
          ...leadRows.map((row) => row.percent),
          otherShare,
          ...effortItems.map((item) => item.percent),
        ]);
        const scaledOther = scaled[leadRows.length] ?? 0;
        if (handlingSelected && scaledOther > effectiveOtherMax + 0.01) {
          toast.error(
            `Could not balance to 100% with other work capped at ${effectiveOtherMax}%. Adjust the split and try again.`,
          );
          return;
        }
        const scaledLeadPercents = scaled.slice(0, leadRows.length);
        const scaledEffortPercents = scaled.slice(leadRows.length + 1);
        const leadPercentByKey = new Map(
          leadRows.map((row, index) => [row.key, scaledLeadPercents[index] ?? row.percent]),
        );
        const nextRows = handlingSelected
          ? rows.map((row) =>
              row.included ? { ...row, percent: leadPercentByKey.get(row.key) ?? row.percent } : row,
            )
          : rows.map((row) => ({ ...row, included: false, percent: 0, pinned: false }));
        const nextEffortDrafts = { ...effortDrafts };
        const savedEfforts = effortItems.map((item, index) => {
          const percent = scaledEffortPercents[index] ?? item.percent;
          nextEffortDrafts[item.effortId] = {
            percent,
            departmentIds: item.departmentIds ?? [],
            firms: item.firms ?? [],
            leads: item.leads ?? [],
          };
          return { ...item, percent };
        });
        setRows(nextRows);
        setOtherWorkPercent(handlingSelected ? scaledOther : 0);
        setEffortDrafts(nextEffortDrafts);

        const items: AllocationItemInput[] = handlingSelected
          ? leadRows.map((row) => ({
              lead_type: row.lead_type,
              new_lead_id: row.new_lead_id,
              legacy_lead_id: row.legacy_lead_id,
              lead_number: row.lead_number,
              client_name: row.client_name,
              percent: leadPercentByKey.get(row.key) ?? row.percent,
              subEffortIds: row.subEffortIds ?? [],
            }))
          : [];

        if (items.length > 0) {
          const budget = await evaluateDailyLeadAllocationBudgets({
            employeeId: employeeContext.employeeId,
            workDate,
            dayWorkedMs: effectiveWorkedMs,
            leads: items.map((row) => ({
              key: leadActivityKey({
                lead_type: row.lead_type,
                new_lead_id: row.new_lead_id,
                legacy_lead_id: row.legacy_lead_id,
                lead_number: row.lead_number,
                client_name: row.client_name,
              }),
              ...row,
            })),
          });
          setBudgetHints(budget.hints);
          if (budget.violations.length > 0) {
            setBudgetViolations(budget.violations);
            setBudgetAssistOpen(true);
            toast.error(
              budget.violations.length === 1
                ? `Lead #${budget.violations[0].lead_number} is over the employee cost budget.`
                : `${budget.violations.length} leads are over the employee cost budget.`,
            );
            return;
          }
        }

        saved = await saveDailyAllocation({
          employeeId: employeeContext.employeeId,
          userId: employeeContext.userId,
          workDate,
          items,
          otherWorkPercent: handlingSelected ? scaledOther : 0,
          effortItems: savedEfforts,
          maxOtherWorkPercent: effectiveOtherMax,
        });
      }

      setLastSavedAt(saved.updated_at || saved.submitted_at);
      if (handlingOnly) setOtherWorkPercent(saved.other_work_percent);
      setIsEditing(false);
      setEditSnapshot(null);
      setBudgetViolations([]);
      setBudgetAssistOpen(false);
      void refreshMissingDates(employeeContext.employeeId, {
        weekdays: employeeContext.leadTimeReportingWeekdays,
        excludedDates: employeeContext.leadTimeReportingExcludedDates,
      });
      notifyLeadAllocationSaved(workDate);
      setSavedThanksOpen(true);
    } catch (error) {
      console.error('[EmployeeLeadReportingPage] save failed:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to save allocation.');
    } finally {
      setCheckingBudget(false);
      setSaving(false);
    }
  };

  /** Send Michael the reason for overtime that is already saved on this day. */
  const handleSendExistingOvertime = async () => {
    if (!employeeContext || !overtimeAwaitingSend) return;
    const reason = overtimeReason.trim();
    if (!reason) {
      toast.error('Write the reason for the extra hours');
      return;
    }
    setSaving(true);
    try {
      const totalMinutes = Math.round(
        workIntervalDurationMs(workDate, overtimeAwaitingSend.clockInTime, overtimeAwaitingSend.clockOutTime) / 60000,
      );
      const workplace =
        locations.find((item) => item.id === overtimeAwaitingSend.locationId)?.name || 'Not set';
      await requestMichaelOvertimeApproval({
        employeeId: employeeContext.employeeId,
        reason,
        hours: formatOvertimeHoursPlaceholder({
          minutes: overtimeMinutesBeyondBase(totalMinutes, minHours),
          dateKey: workDate,
          from: overtimeAwaitingSend.clockInTime,
          to: overtimeAwaitingSend.clockOutTime,
        }),
        workplace,
        date: formatOvertimeDatePlaceholder([workDate]),
        clockInIds: [overtimeAwaitingSend.sessionId],
      });
      setOvertimeRequestStatus('pending');
      setOvertimePrompt(null);
      setOvertimeReason('');
      toast.success('Message sent to Michael Decker. Your extra hours are waiting for his approval.');
    } catch (error) {
      console.error('[EmployeeLeadReportingPage] overtime send failed:', error);
      toast.error(error instanceof Error ? error.message : 'Could not send the overtime request');
    } finally {
      setSaving(false);
    }
  };

  const handleResetAllocation = async () => {
    if (!employeeContext) return;
    const confirmed = window.confirm(
      'Reset this day’s allocation to the default (unsaved) state? Your saved report for this date will be cleared.',
    );
    if (!confirmed) return;

    setSaving(true);
    try {
      if (lastSavedAt) {
        await deleteDailyAllocation(employeeContext.employeeId, workDate);
      }

      const clearedRows = rows.map((row) => ({
        ...row,
        included: false,
        percent: 0,
        pinned: false,
      }));
      const resetState = rebalanceFlexAllocationBuckets(0, false, clearedRows, otherWorkMax);

      setRows(resetState.rows);
      setOtherWorkPercent(resetState.otherWorkPercent);
      setEffortDrafts({});
      setLastSavedAt(null);
      setIsEditing(true);
      setEditSnapshot(null);
      setBudgetHints([]);
      setBudgetViolations([]);
      setBudgetAssistOpen(false);
      void refreshMissingDates(employeeContext.employeeId, {
        weekdays: employeeContext.leadTimeReportingWeekdays,
        excludedDates: employeeContext.leadTimeReportingExcludedDates,
      });
      notifyLeadAllocationSaved(workDate);
      toast.success('Allocation reset.');
    } catch (error) {
      console.error('[EmployeeLeadReportingPage] reset failed:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to reset allocation.');
    } finally {
      setSaving(false);
    }
  };

  const handleApplyMaxBudget = () => {
    if (budgetViolations.length === 0) {
      setBudgetAssistOpen(false);
      return;
    }

    let nextRows = rows;
    let nextOther = otherWorkPercent;
    for (const violation of budgetViolations) {
      const result = setLeadAllocationPercentDraft(
        nextRows,
        nextOther,
        violation.key,
        violation.maxAllowedPercent,
      );
      nextRows = result.rows;
      nextOther = result.otherWorkPercent;
    }

    setRows(nextRows);
    setOtherWorkPercent(nextOther);
    setBudgetAssistOpen(false);
    setBudgetViolations([]);
    toast.success('Sliders set to the max available on budget. Review and save again.');
    void refreshBudgetHints(nextRows, dayWorkedMs);
  };

  if (!permissionsLoaded || !hasAccess || (loading && !employeeContext)) {
    return (
      <div className="lead-allocation-page-shell flex min-h-[calc(100dvh-3.5rem)] items-center justify-center bg-[#ececec]">
        <span className="loading loading-spinner loading-lg text-primary" />
      </div>
    );
  }

  if (!employeeContext) {
    return (
      <div className="lead-allocation-page-shell min-h-[calc(100dvh-3.5rem)] bg-[#ececec] px-4 py-10 md:px-10">
        <div className="w-full rounded-[18px] bg-white px-5 py-6 shadow-sm">
          <div className="alert alert-warning border-0 bg-amber-50 text-amber-900">
            <span>Your user account is not linked to an employee profile. Contact an administrator.</span>
          </div>
        </div>
      </div>
    );
  }

  const saveActions = () => (
    <div className="flex w-full flex-col gap-2 rounded-[18px] bg-white p-3 shadow-sm">
      <p
        className={`text-xs leading-snug ${
          isOverAllocated && !isAllocationLocked ? 'font-semibold text-rose-600' : 'text-gray-500'
        }`}
      >
        {isAllocationLocked && lastSavedAt
          ? `Saved ${new Intl.DateTimeFormat(undefined, {
              dateStyle: 'medium',
              timeStyle: 'short',
            }).format(new Date(lastSavedAt))}`
          : allocationStatus}
      </p>
      <button
        type="button"
        className="btn btn-primary btn-sm h-9 min-h-9 w-full rounded-xl"
        disabled={
          isAllocationLocked ? saving : !canSave || isOverAllocated || saving || checkingBudget
        }
        title={
          isOverAllocated && !isAllocationLocked
            ? `Take off ${formatAllocationPercent(overAllocatedBy)}% to save`
            : undefined
        }
        onClick={() => {
          if (isAllocationLocked) {
            handleStartEdit();
            return;
          }
          void handleSave();
        }}
      >
        {saving || checkingBudget ? (
          <span className="loading loading-spinner loading-sm" />
        ) : isAllocationLocked ? (
          'Edit'
        ) : (
          'Save allocation'
        )}
      </button>
      {isEditingSavedAllocation ? (
        <button
          type="button"
          className="btn btn-ghost btn-sm h-9 min-h-9 w-full rounded-xl"
          disabled={saving}
          onClick={handleCancelEdit}
        >
          Cancel
        </button>
      ) : null}
      <button
        type="button"
        className="btn btn-ghost btn-sm h-9 min-h-9 w-full rounded-xl"
        disabled={saving || checkingBudget}
        onClick={() => {
          void handleResetAllocation();
        }}
      >
        Reset
      </button>
    </div>
  );

  return (
    <div className="lead-allocation-page-shell min-h-[calc(100dvh-3.5rem)] bg-[#ececec]">
      <div className="flex min-w-0 w-full items-start gap-5 px-4 pb-[max(2.5rem,env(safe-area-inset-bottom,0px))] pt-2 md:px-6 md:pb-12 md:pt-4">
        <aside className="sticky top-[4.75rem] hidden w-56 shrink-0 flex-col gap-3 md:flex">
        <p className="px-1 text-base font-medium leading-snug text-gray-700">
          Welcome, {employeeContext.employeeName}
        </p>
        <AllocationAreaSidebar
          className="flex flex-col"
          activeId={activeAreaId}
          overAllocated={isOverAllocated && !isAllocationLocked}
          dayTotal={
            dayWorkedMs > 0
              ? formatAllocationWorkedDuration(allocationPercentToWorkedMs(dayWorkedMs, grandTotal))
              : `${formatAllocationPercent(grandTotal)}%`
          }
          items={sidebarAreas.map((area) => ({
            id: area.id,
            label: area.label,
            total: areaShareLabel(area.id),
            hasTime: (shareByArea[area.id]?.percent || 0) > 0,
          }))}
          onSelect={(areaId) => {
            setActiveAreaId(areaId);
            document.getElementById(`allocation-${areaId}`)?.scrollIntoView({
              behavior: 'smooth',
              block: 'start',
            });
          }}
        />
        {saveActions()}
        </aside>
        <div className="min-w-0 flex-1 space-y-5">
          <div className="w-full space-y-5">
          <div className="min-w-0">
            <p className="mb-1.5 text-lg font-medium text-gray-700 md:hidden">
              Welcome, {employeeContext.employeeName}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="flex items-center gap-2.5 text-2xl font-bold text-gray-900">
                <ClipboardDocumentListIcon className="h-7 w-7 shrink-0 text-primary" aria-hidden />
                Daily time allocation
              </h1>
              <label className="inline-flex items-center gap-2">
                <span className="sr-only">Work date</span>
                <input
                  type="date"
                  className="input h-10 min-h-10 w-auto min-w-[10.5rem] rounded-[14px] border-0 bg-white px-3 ring-1 ring-gray-300/80 focus:outline-none focus:ring-2 focus:ring-primary/15"
                  value={workDate}
                  max={getJerusalemTodayIsoDate()}
                  onChange={(e) => selectWorkDate(e.target.value)}
                  title="Work date"
                />
              </label>

              {missingDates.length > 0 ? (
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span
                    className="inline-flex items-center rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-bold tabular-nums text-white"
                    aria-label={`${missingDates.length} missing days`}
                  >
                    {missingDates.length}
                  </span>

                  <div className="flex min-w-0 flex-wrap items-center gap-1 rounded-full bg-gray-200/80 p-1">
                    {thisWeekMissingDates.map((day) => (
                      <button
                        key={day}
                        type="button"
                        onClick={() => selectWorkDate(day)}
                        className={missingDayTabClass(day === workDate)}
                        title={`Open allocation for ${day}`}
                      >
                        {formatLeadAllocationMissingDayTabLabel(day)}
                      </button>
                    ))}

                    {earlierMissingDates.length > 0 ? (
                      <div className="dropdown dropdown-end">
                        <div
                          tabIndex={0}
                          role="button"
                          className={missingDayTabClass(
                            earlierMissingDates.includes(workDate),
                          )}
                          title="Earlier days still missing a report"
                        >
                          {earlierMissingDates.length} more
                        </div>
                        <ul className="dropdown-content menu z-[60] mt-2 max-h-80 w-60 flex-nowrap overflow-y-auto rounded-2xl bg-white p-2 shadow-xl ring-1 ring-black/5">
                          {earlierMissingDates.map((day) => (
                            <li key={day}>
                              <button
                                type="button"
                                className={`justify-start whitespace-nowrap text-xs font-semibold ${
                                  day === workDate ? 'text-gray-900' : 'text-gray-600'
                                }`}
                                onClick={(event) => {
                                  selectWorkDate(day);
                                  // Focus is what holds a DaisyUI dropdown open; dropping it closes the menu.
                                  event.currentTarget.blur();
                                }}
                              >
                                {formatLeadAllocationMissingDayMenuLabel(day)}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <nav
            className="sticky top-0 z-30 -mx-1 flex gap-2 overflow-x-auto bg-[#ececec]/95 py-2 backdrop-blur md:hidden"
            aria-label="Allocation areas"
          >
            {sidebarAreas.map((area) => (
              <button
                key={area.id}
                type="button"
                className="inline-flex shrink-0 items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-gray-200 hover:bg-gray-50"
                onClick={() => {
                  setActiveAreaId(area.id);
                  document.getElementById(`allocation-${area.id}`)?.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start',
                  });
                }}
              >
                {area.label}
                <span className="text-xs font-semibold tabular-nums text-emerald-700">
                  {areaShareLabel(area.id)}
                </span>
              </button>
            ))}
          </nav>

          <div className="md:hidden">{saveActions()}</div>

          <DayMeetingsStrip
            meetings={dayMeetings}
            choices={meetingChoices}
            onChoose={(meetingId, choice) => {
              void chooseMeeting(meetingId, choice);
            }}
          />

          <div className="flex flex-wrap items-end gap-3">
                {/* Each time box keeps its own width. A shared shrinking row was collapsing From until it disappeared. */}
                <label className="block w-[9.75rem] shrink-0">
                  <span className="mb-1.5 block text-sm font-medium text-gray-600">From</span>
                  <input
                    type="time"
                    className="input h-10 min-h-10 w-full min-w-[9.75rem] rounded-[14px] border-0 bg-white px-3 ring-1 ring-gray-300/80 focus:outline-none focus:ring-2 focus:ring-primary/15"
                    value={fromTime}
                    disabled={isAllocationLocked}
                    onChange={(e) => commitWorkHours(e.target.value, toTime)}
                  />
                </label>
                <label className="block w-[9.75rem] shrink-0">
                  <span className="mb-1.5 block text-sm font-medium text-gray-600">To</span>
                  <input
                    type="time"
                    className="input h-10 min-h-10 w-full min-w-[9.75rem] rounded-[14px] border-0 bg-white px-3 ring-1 ring-gray-300/80 focus:outline-none focus:ring-2 focus:ring-primary/15"
                    value={toTime}
                    disabled={isAllocationLocked}
                    onChange={(e) => commitWorkHours(fromTime, e.target.value)}
                  />
                </label>
                <label className="block w-full min-w-[12rem] max-w-xs shrink-0 sm:w-56">
                  <span className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-600">
                    <MapPinIcon className="h-4 w-4" />
                    Worked in
                  </span>
                  <select
                    className="select h-10 min-h-10 w-full rounded-[14px] border-0 bg-white px-3 ring-1 ring-gray-300/80 focus:outline-none focus:ring-2 focus:ring-primary/15"
                    value={locationId === '' ? '' : String(locationId)}
                    disabled={isAllocationLocked}
                    onChange={(e) => {
                      const next = e.target.value ? Number(e.target.value) : '';
                      setLocationId(next);
                      if (typeof next === 'number') persistLastSelectedWorkplaceId(next);
                    }}
                  >
                    <option value="">Select workplace…</option>
                    {locations.map((loc) => (
                      <option key={loc.id} value={String(loc.id)}>
                        {loc.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="btn btn-ghost h-10 min-h-10 shrink-0 whitespace-nowrap rounded-[14px] border-0 bg-white px-3 text-xs font-semibold text-primary ring-1 ring-gray-300/80 hover:bg-primary/5"
                  disabled={isAllocationLocked}
                  title={`Fill From/To with your ${minHours}h base day`}
                  onClick={() => {
                    const start = fromTime || DEFAULT_BASE_HOURS_FROM;
                    const end = timeInputPlusHours(start, minHours);
                    if (!end) {
                      toast.error('Could not fill base hours.');
                      return;
                    }
                    commitWorkHours(start, end);
                    toast.success(`Filled ${minHours}h base hours (${start}–${end}).`);
                  }}
                >
                  Base hours
                </button>
              </div>

          {storedOvertime && !storedOvertime.approved && overtimeRequestStatus === 'pending' ? (
            <div className="rounded-[18px] bg-amber-50 px-5 py-4 text-sm text-amber-900 shadow-sm">
              Your {storedOvertime.clockInTime}–{storedOvertime.clockOutTime} day is past your {minHours}h.
              Michael has the request and it is waiting for his reply.
            </div>
          ) : overtimeAwaitingSend ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] bg-amber-50 px-5 py-4 text-sm text-amber-900 shadow-sm">
              <span>
                Your {overtimeAwaitingSend.clockInTime}–{overtimeAwaitingSend.clockOutTime} day is past
                your {minHours}h and still needs Michael&apos;s approval.
              </span>
              <button
                type="button"
                className="btn btn-sm rounded-full border-0 bg-amber-600 px-4 text-white hover:bg-amber-700"
                disabled={saving}
                onClick={() => setOvertimePrompt('send')}
              >
                Send to Michael
              </button>
            </div>
          ) : null}
          </div>

          <section id="allocation-handling" className="w-full scroll-mt-16">
            <div className="mb-3 flex items-center gap-3">
              <h2 className="text-lg font-bold text-gray-900">Handling</h2>
              <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-sm font-semibold tabular-nums text-gray-500">
                {areaShareLabel('handling')}
              </span>
            </div>
            <div className="overflow-hidden rounded-[18px] bg-white shadow-sm">
          <LeadAllocationSliders
            rows={rows}
            otherWorkPercent={otherWorkPercent}
            onChange={handleAllocationChange}
            onAddLead={() => setAddLeadModalOpen(true)}
            readOnly={isAllocationLocked}
            dayWorkedMs={dayWorkedMs}
            dayTotalPercent={grandTotal}
            meetingMarkByKey={meetingMarkByKey}
            onSubEffortsChange={(key, ids) => {
              setRows((current) =>
                current.map((row) => (row.key === key ? { ...row, subEffortIds: ids } : row)),
              );
            }}
            otherWorkMaxPercent={otherWorkMax}
            budgetHintsByKey={Object.fromEntries(budgetHints.map((h) => [h.key, h]))}
            onApplyLeadMaxBudget={(leadKey, maxAllowedPercent) => {
              const result = setLeadAllocationPercentDraft(
                rows,
                otherWorkPercent,
                leadKey,
                maxAllowedPercent,
              );
              setRows(result.rows);
              setOtherWorkPercent(result.otherWorkPercent);
              toast.success('Slider set to max available for this lead.');
              void refreshBudgetHints(result.rows, dayWorkedMs);
            }}
          />
            </div>
          </section>

          <WorkEffortAllocator
            drafts={effortDrafts}
            customEfforts={customEfforts}
            onEffortCreated={(effort) => setCustomEfforts((current) => [...current, effort])}
            readOnly={isAllocationLocked}
            dayWorkedMs={dayWorkedMs}
            dayTotalPercent={grandTotal}
            meetingsByEffort={meetingsByEffort}
            onDraftChange={(effortId, patch) => {
              if (isAllocationLocked) return;
              setEffortDrafts((current) => ({
                ...current,
                [effortId]: {
                  percent: current[effortId]?.percent ?? 0,
                  departmentIds: current[effortId]?.departmentIds ?? [],
                  firms: current[effortId]?.firms ?? [],
                  leads: current[effortId]?.leads ?? [],
                  ...patch,
                },
              }));
            }}
          />

          <AddLeadToAllocationModal
            open={addLeadModalOpen}
            onClose={() => setAddLeadModalOpen(false)}
            existingKeys={existingLeadKeys}
            onAdd={handleAddLead}
          />

          <LeadAllocationSavedModal
            open={savedThanksOpen}
            employeeName={employeeContext.employeeName}
            onClose={() => setSavedThanksOpen(false)}
          />

          <LeadAllocationOvertimeApprovalModal
            open={overtimePrompt !== null}
            clockInTime={overtimePrompt === 'send' && overtimeAwaitingSend
              ? overtimeAwaitingSend.clockInTime
              : fromTime}
            clockOutTime={overtimePrompt === 'send' && overtimeAwaitingSend
              ? overtimeAwaitingSend.clockOutTime
              : toTime}
            dateKey={workDate}
            baseHours={minHours}
            busy={saving}
            reason={overtimeReason}
            onReasonChange={setOvertimeReason}
            onSend={() => {
              if (overtimePrompt === 'send') {
                void handleSendExistingOvertime();
                return;
              }
              void handleSave({ overtimeReason });
            }}
            onClose={() => {
              if (saving) return;
              setOvertimePrompt(null);
            }}
          />

          <LeadAllocationBudgetAssistModal
            open={budgetAssistOpen}
            violations={budgetViolations}
            onClose={() => setBudgetAssistOpen(false)}
            onApplyMaxAllowed={handleApplyMaxBudget}
          />

          {handlingSelected && rows.length === 0 && (
            <div className="text-center">
              <Link
                to="/clients"
                className="btn btn-ghost btn-sm rounded-full bg-white px-4 shadow-sm hover:bg-gray-50"
              >
                Open Clients to add leads
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default EmployeeLeadReportingPage;
