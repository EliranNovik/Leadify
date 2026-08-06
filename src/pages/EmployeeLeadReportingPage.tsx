import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import {
  ClipboardDocumentListIcon,
  ClockIcon,
  MapPinIcon,
} from '@heroicons/react/24/outline';
import LeadAllocationSliders, {
  type LeadAllocationChangeState,
  type LeadAllocationRow,
} from '../components/employeeLeadReporting/LeadAllocationSliders';
import AddLeadToAllocationModal from '../components/employeeLeadReporting/AddLeadToAllocationModal';
import LeadAllocationBudgetAssistModal from '../components/employeeLeadReporting/LeadAllocationBudgetAssistModal';
import LeadAllocationSavedModal from '../components/employeeLeadReporting/LeadAllocationSavedModal';
import {
  addLeadToAllocationBuckets,
  allocationRowFromCombinedLead,
  buildAllocationDayWorkedMs,
  canAccessLeadTimeReport,
  dailyAllocationGrandTotal,
  deleteDailyAllocation,
  fetchCurrentEmployeeContext,
  fetchDailyActivity,
  fetchDailyAllocation,
  fetchMissingLeadAllocationDates,
  filterIdentitiesByMinAllocationStage,
  enrichAllocationLeadDisplayMeta,
  formatAllocationPercent,
  formatAllocationWorkedDuration,
  formatLeadAllocationMissingDayLabel,
  getJerusalemTodayIsoDate,
  isDailyAllocationValid,
  isLeadAllocationEligibleStage,
  isLeadAllocationHoursNote,
  leadActivityKey,
  minHoursToMs,
  notifyLeadAllocationSaved,
  otherWorkPercentCap,
  rebalanceFlexAllocationBuckets,
  resolveLegacyLeadDisplayNumbers,
  saveDailyAllocation,
  setLeadAllocationPercent,
  setOtherWorkAllocationPercent,
  syncAllocationTo100,
  workIntervalDurationMs,
  type AllocationItemInput,
} from '../lib/employeeLeadReporting';
import {
  evaluateDailyLeadAllocationBudgets,
  type LeadAllocationBudgetHint,
  type LeadAllocationBudgetViolation,
} from '../lib/leadAllocationBudget';
import type { CombinedLead } from '../lib/legacyLeadsApi';
import { fetchClockInRecordsInRange } from '../lib/workingHoursExport';
import { replaceDayWithPendingManualSession } from '../lib/employeeClockInManual';
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
    category_main?: string | null;
    category_sub?: string | null;
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
    category_main: extras?.category_main ?? null,
    category_sub: extras?.category_sub ?? null,
  };
}

function allocationItemToRow(
  item: AllocationItemInput,
  extras?: {
    lead_number?: string;
    stage_id?: string | null;
    active_sub_effort_title?: string | null;
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
    category_main: extras?.category_main ?? null,
    category_sub: extras?.category_sub ?? null,
  };
}

function isoToTimeInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
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

type AllocationEditSnapshot = LeadAllocationChangeState & HoursEditSnapshot;

/** Prefill From/To from a pending allocation session, else the earliest in / latest out that day. */
function deriveHoursFormDefaults(
  employeeRecords: Awaited<ReturnType<typeof fetchClockInRecordsInRange>>,
  selectableLocationIds: Set<number>,
  fallbackLocationId: number | '',
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
      toTime: isoToTimeInput(allocationSession.clock_out_time),
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
    const out = row.clock_out_time || row.clock_in_time;
    if (!latestOut || out > latestOut) latestOut = out;
  }

  return {
    fromTime: isoToTimeInput(earliestIn),
    toTime: isoToTimeInput(latestOut),
    locationId,
  };
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
  const [locationId, setLocationId] = useState<number | ''>('');
  const [locations, setLocations] = useState<ClockInLocationOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ctx = await fetchCurrentEmployeeContext();
        if (cancelled) return;
        const allowed = canAccessLeadTimeReport({
          isSuperUser: ctx?.isSuperUser,
          bonusesRole: ctx?.bonusesRole,
        });
        setHasAccess(allowed);
        setPermissionsLoaded(true);
        if (!allowed) {
          toast.error('Access denied. Daily lead allocation is only available to handlers, department managers, and superusers.');
          navigate('/');
        }
      } catch (error) {
        console.error('[EmployeeLeadReportingPage] permission check failed:', error);
        if (!cancelled) {
          setHasAccess(false);
          setPermissionsLoaded(true);
          toast.error('Access denied. Daily lead allocation is only available to handlers, department managers, and superusers.');
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

  const refreshMissingDates = useCallback(async (employeeId: number) => {
    try {
      const missing = await fetchMissingLeadAllocationDates(employeeId);
      setMissingDates(missing);
    } catch (error) {
      console.error('[EmployeeLeadReportingPage] missing dates failed:', error);
    }
  }, []);

  const loadData = useCallback(async () => {
    if (!hasAccess) return;
    setLoading(true);
    try {
      const ctx = await fetchCurrentEmployeeContext();
      setEmployeeContext(ctx);
      if (!ctx) {
        setRows([]);
        setOtherWorkPercent(0);
        setLastSavedAt(null);
        setIsEditing(true);
        setEditSnapshot(null);
        setRecordedDayWorkedMs(0);
        setFromTime('');
        setToTime('');
        setLocationId('');
        setLocations([]);
        return;
      }

      if (
        !canAccessLeadTimeReport({
          isSuperUser: ctx.isSuperUser,
          bonusesRole: ctx.bonusesRole,
        })
      ) {
        setHasAccess(false);
        toast.error('Access denied. Daily lead allocation is only available to handlers, department managers, and superusers.');
        navigate('/');
        return;
      }

      const [activityRaw, allocation, clockRecords, locationOptions] = await Promise.all([
        fetchDailyActivity(ctx.employeeId, workDate),
        fetchDailyAllocation(ctx.employeeId, workDate),
        fetchClockInRecordsInRange(workDate, workDate),
        fetchActiveClockInLocations(),
      ]);

      // Only Handler Nominated (105) and later stages appear on the allocation list.
      const [activity, eligibleSavedItems] = await Promise.all([
        filterIdentitiesByMinAllocationStage(activityRaw),
        filterIdentitiesByMinAllocationStage(allocation?.items || []),
      ]);

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
      );
      if (allocationSession || hoursDefaults.fromTime) {
        setFromTime(hoursDefaults.fromTime);
        setToTime(hoursDefaults.toTime);
        setLocationId(hoursDefaults.locationId);
      } else {
        setFromTime('');
        setToTime('');
        setLocationId(fallbackLocationId);
      }

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
        const extras = {
          lead_number: meta?.lead_number || act.lead_number,
          stage_id: meta?.stageId ?? null,
          active_sub_effort_title: meta?.active_sub_effort_title ?? null,
          category_main: meta?.category_main ?? null,
          category_sub: meta?.category_sub ?? null,
        };
        const saved = savedByKey.get(key);
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
      setIsEditing(!hasSavedAllocation);
      setEditSnapshot(null);
      void refreshMissingDates(ctx.employeeId);
    } catch (error) {
      console.error('[EmployeeLeadReportingPage] load failed:', error);
      toast.error('Failed to load lead activity.');
    } finally {
      setLoading(false);
    }
  }, [hasAccess, workDate, navigate, refreshMissingDates]);

  useEffect(() => {
    if (!permissionsLoaded || !hasAccess) return;
    void loadData();
  }, [permissionsLoaded, hasAccess, loadData]);

  const minHours = employeeContext?.minHours ?? 8;
  const minMs = minHoursToMs(minHours);
  const isAllocationLocked = Boolean(lastSavedAt) && !isEditing;
  const isEditingSavedAllocation = Boolean(lastSavedAt) && isEditing;
  // Below base always; also while editing a saved allocation so hours can be corrected.
  const showHoursForm = recordedDayWorkedMs < minMs || isEditingSavedAllocation;

  const manualIntervalMs = workIntervalDurationMs(workDate, fromTime, toTime);
  const dayWorkedMs =
    showHoursForm && manualIntervalMs > 0 ? manualIntervalMs : recordedDayWorkedMs;

  const otherWorkMax = otherWorkPercentCap(dayWorkedMs, minHours);
  const rowsRef = useRef(rows);
  const otherWorkPercentRef = useRef(otherWorkPercent);
  rowsRef.current = rows;
  otherWorkPercentRef.current = otherWorkPercent;

  useEffect(() => {
    if (otherWorkPercentRef.current <= otherWorkMax) return;
    // A shrinking cap (e.g. hours moved into overtime) pushes the excess back onto the leads
    // so the day still totals 100% without breaching the new cap.
    const next = syncAllocationTo100(rowsRef.current, otherWorkMax);
    setRows(next.rows);
    setOtherWorkPercent(next.otherWorkPercent);
  }, [otherWorkMax]);

  const includedRows = useMemo(() => rows.filter((row) => row.included), [rows]);
  const grandTotal = dailyAllocationGrandTotal(includedRows, otherWorkPercent);
  const canSave = isDailyAllocationValid(includedRows, otherWorkPercent, otherWorkMax);
  const existingLeadKeys = useMemo(() => new Set(rows.map((row) => row.key)), [rows]);

  const handleStartEdit = () => {
    setEditSnapshot({
      rows: rows.map((row) => ({ ...row })),
      otherWorkPercent,
      fromTime,
      toTime,
      locationId,
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
      newRow.category_main = display?.category_main ?? null;
      newRow.category_sub = display?.category_sub ?? null;
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

  const handleSave = async () => {
    if (!employeeContext) return;
    if (!canSave) {
      toast.error('Allocate exactly 100% across other work and selected leads.');
      return;
    }

    if (showHoursForm) {
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

      if (showHoursForm && fromTime && toTime && locationId) {
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
      }

      const leadsForBudget = includedRows.map((row) => ({
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

      const items: AllocationItemInput[] = includedRows.map((row) => ({
        lead_type: row.lead_type,
        new_lead_id: row.new_lead_id,
        legacy_lead_id: row.legacy_lead_id,
        lead_number: row.lead_number,
        client_name: row.client_name,
        percent: row.percent,
      }));

      const saved = await saveDailyAllocation({
        employeeId: employeeContext.employeeId,
        userId: employeeContext.userId,
        workDate,
        items,
        otherWorkPercent,
      });

      setLastSavedAt(saved.updated_at || saved.submitted_at);
      setOtherWorkPercent(saved.other_work_percent);
      setIsEditing(false);
      setEditSnapshot(null);
      setBudgetViolations([]);
      setBudgetAssistOpen(false);
      void refreshMissingDates(employeeContext.employeeId);
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
      setLastSavedAt(null);
      setIsEditing(true);
      setEditSnapshot(null);
      setBudgetHints([]);
      setBudgetViolations([]);
      setBudgetAssistOpen(false);
      void refreshMissingDates(employeeContext.employeeId);
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
      const result = setLeadAllocationPercent(
        nextRows,
        violation.key,
        violation.maxAllowedPercent,
        otherWorkMax,
      );
      nextRows = result.rows;
      nextOther = result.otherWorkPercent;
    }

    const capped = setOtherWorkAllocationPercent(nextRows, nextOther, otherWorkMax);
    setRows(capped.rows);
    setOtherWorkPercent(capped.otherWorkPercent);
    setBudgetAssistOpen(false);
    setBudgetViolations([]);
    toast.success('Sliders set to the max available on budget. Review and save again.');
    void refreshBudgetHints(capped.rows, dayWorkedMs);
  };

  if (!permissionsLoaded || !hasAccess || loading) {
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

  return (
    <div className="lead-allocation-page-shell min-h-[calc(100dvh-3.5rem)] bg-[#ececec]">
      <div className="flex min-w-0 w-full flex-col px-4 pb-[max(2.5rem,env(safe-area-inset-bottom,0px))] pt-2 md:px-6 md:pb-12 md:pt-4">
        <div className="space-y-5">
          <div className="mx-auto w-full max-w-6xl space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="mb-1.5 text-lg font-medium text-gray-700">
                Welcome, {employeeContext.employeeName}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="flex items-center gap-2.5 text-2xl font-bold text-gray-900">
                  <ClipboardDocumentListIcon className="h-7 w-7 shrink-0 text-primary" aria-hidden />
                  Daily lead allocation
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
              </div>
            </div>

            {missingDates.length > 0 ? (
              <div className="w-full max-w-xl sm:w-auto sm:min-w-[16rem]">
                <div className="mb-1.5 flex items-center justify-between gap-2 sm:justify-end">
                  <span className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                    Missing reports
                  </span>
                  <span className="rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-bold tabular-nums text-white">
                    {missingDates.length}
                  </span>
                </div>
                <div className="flex flex-wrap justify-start gap-1.5 sm:justify-end">
                  {missingDates.map((day) => {
                    const active = day === workDate;
                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => selectWorkDate(day)}
                        className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                          active
                            ? 'bg-amber-500 text-white shadow-sm'
                            : 'bg-white text-amber-800 ring-1 ring-amber-200 hover:bg-amber-50'
                        }`}
                        title={`Open allocation for ${day}`}
                      >
                        {formatLeadAllocationMissingDayLabel(day)}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>

          {showHoursForm ? (
            <div className="rounded-[18px] bg-white px-5 py-4 shadow-sm">
              <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
                {manualIntervalMs > 0 ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                    <ClockIcon className="h-5 w-5" />
                    {formatAllocationWorkedDuration(manualIntervalMs)}
                  </span>
                ) : null}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm h-8 min-h-8 rounded-full px-3 text-primary"
                  disabled={isAllocationLocked}
                  title={`Fill From/To with your ${minHours}h base day`}
                  onClick={() => {
                    const start = fromTime || DEFAULT_BASE_HOURS_FROM;
                    const end = timeInputPlusHours(start, minHours);
                    if (!end) {
                      toast.error('Could not fill base hours.');
                      return;
                    }
                    setFromTime(start);
                    setToTime(end);
                    toast.success(`Filled ${minHours}h base hours (${start}–${end}).`);
                  }}
                >
                  Base hours
                </button>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-gray-600">From</span>
                  <input
                    type="time"
                    className="input h-10 min-h-10 w-full rounded-[14px] border-0 bg-transparent px-3 ring-1 ring-gray-300/80 focus:outline-none focus:ring-2 focus:ring-primary/15"
                    value={fromTime}
                    disabled={isAllocationLocked}
                    onChange={(e) => setFromTime(e.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-gray-600">To</span>
                  <input
                    type="time"
                    className="input h-10 min-h-10 w-full rounded-[14px] border-0 bg-transparent px-3 ring-1 ring-gray-300/80 focus:outline-none focus:ring-2 focus:ring-primary/15"
                    value={toTime}
                    disabled={isAllocationLocked}
                    onChange={(e) => setToTime(e.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-600">
                    <MapPinIcon className="h-4 w-4" />
                    Worked in
                  </span>
                  <select
                    className="select h-10 min-h-10 w-full rounded-[14px] border-0 bg-transparent px-3 ring-1 ring-gray-300/80 focus:outline-none focus:ring-2 focus:ring-primary/15"
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
              </div>
            </div>
          ) : null}
          </div>

          <LeadAllocationSliders
            rows={rows}
            otherWorkPercent={otherWorkPercent}
            onChange={handleAllocationChange}
            onAddLead={() => setAddLeadModalOpen(true)}
            readOnly={isAllocationLocked}
            dayWorkedMs={dayWorkedMs}
            otherWorkMaxPercent={otherWorkMax}
            budgetHintsByKey={Object.fromEntries(budgetHints.map((h) => [h.key, h]))}
            onApplyLeadMaxBudget={(leadKey, maxAllowedPercent) => {
              const result = setLeadAllocationPercent(
                rows,
                leadKey,
                maxAllowedPercent,
                otherWorkMax,
              );
              const capped = setOtherWorkAllocationPercent(
                result.rows,
                result.otherWorkPercent,
                otherWorkMax,
              );
              setRows(capped.rows);
              setOtherWorkPercent(capped.otherWorkPercent);
              toast.success('Slider set to max available for this lead.');
              void refreshBudgetHints(capped.rows, dayWorkedMs);
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

          <LeadAllocationBudgetAssistModal
            open={budgetAssistOpen}
            violations={budgetViolations}
            onClose={() => setBudgetAssistOpen(false)}
            onApplyMaxAllowed={handleApplyMaxBudget}
          />

          {rows.length === 0 && (
            <div className="text-center">
              <Link
                to="/clients"
                className="btn btn-ghost btn-sm rounded-full bg-white px-4 shadow-sm hover:bg-gray-50"
              >
                Open Clients to add leads
              </Link>
            </div>
          )}

          <div className="sticky bottom-[max(0.75rem,env(safe-area-inset-bottom,0px))] z-20 mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 rounded-[18px] bg-white/95 px-5 py-4 shadow-lg ring-1 ring-black/5 backdrop-blur supports-[backdrop-filter]:bg-white/80">
            <div className="text-sm text-gray-500">
              {lastSavedAt
                ? `Last saved: ${new Intl.DateTimeFormat(undefined, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }).format(new Date(lastSavedAt))}`
                : 'Not saved yet for this date'}
              <span className="ml-2 text-gray-400">
                · Other {formatAllocationPercent(otherWorkPercent)}%
                {includedRows.length > 0 ? ` · ${includedRows.length} lead(s)` : ''}
                · {formatAllocationPercent(grandTotal)}% total
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {isEditingSavedAllocation && (
                <button
                  type="button"
                  className="btn btn-ghost rounded-full px-6 shadow-sm"
                  disabled={saving}
                  onClick={handleCancelEdit}
                >
                  Cancel
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost rounded-full px-6 shadow-sm"
                disabled={saving || checkingBudget}
                onClick={() => {
                  void handleResetAllocation();
                }}
              >
                Reset
              </button>
              <button
                type="button"
                className="btn btn-primary rounded-full px-6 shadow-sm"
                disabled={isAllocationLocked ? saving : !canSave || saving || checkingBudget}
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
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EmployeeLeadReportingPage;
