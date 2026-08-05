import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import {
  CalendarDaysIcon,
  ClockIcon,
  ClipboardDocumentListIcon,
  MapPinIcon,
} from '@heroicons/react/24/outline';
import LeadAllocationSliders, {
  type LeadAllocationChangeState,
  type LeadAllocationRow,
} from '../components/employeeLeadReporting/LeadAllocationSliders';
import AddLeadToAllocationModal from '../components/employeeLeadReporting/AddLeadToAllocationModal';
import LeadAllocationBudgetAssistModal from '../components/employeeLeadReporting/LeadAllocationBudgetAssistModal';
import {
  addLeadToAllocationBuckets,
  allocationRowFromCombinedLead,
  buildAllocationDayWorkedMs,
  canAccessLeadTimeReport,
  dailyAllocationGrandTotal,
  fetchCurrentEmployeeContext,
  fetchDailyActivity,
  fetchDailyAllocation,
  formatAllocationPercent,
  formatAllocationWorkedDuration,
  getJerusalemTodayIsoDate,
  isDailyAllocationValid,
  isLeadAllocationHoursNote,
  leadActivityKey,
  minHoursToMs,
  otherWorkPercentCap,
  rebalanceFlexAllocationBuckets,
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
): LeadAllocationRow {
  return {
    key: leadActivityKey({
      lead_type: activity.lead_type,
      new_lead_id: activity.new_lead_id,
      legacy_lead_id: activity.legacy_lead_id,
      lead_number: activity.lead_number,
      client_name: activity.client_name,
    }),
    lead_type: activity.lead_type,
    new_lead_id: activity.new_lead_id,
    legacy_lead_id: activity.legacy_lead_id,
    lead_number: activity.lead_number,
    client_name: activity.client_name,
    percent,
    included,
    pinned,
    view_count: activity.view_count,
    last_viewed_at: activity.last_viewed_at,
  };
}

function allocationItemToRow(item: AllocationItemInput): LeadAllocationRow {
  return {
    key: leadActivityKey({
      lead_type: item.lead_type,
      new_lead_id: item.new_lead_id,
      legacy_lead_id: item.legacy_lead_id,
      lead_number: item.lead_number,
      client_name: item.client_name,
    }),
    lead_type: item.lead_type,
    new_lead_id: item.new_lead_id,
    legacy_lead_id: item.legacy_lead_id,
    lead_number: item.lead_number,
    client_name: item.client_name,
    percent: item.percent,
    included: true,
    pinned: true,
  };
}

function isoToTimeInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
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
  const [permissionsLoaded, setPermissionsLoaded] = useState(false);
  const [hasAccess, setHasAccess] = useState(false);
  const [workDate, setWorkDate] = useState(() => getJerusalemTodayIsoDate());
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
          toast.error('Access denied. Daily lead allocation is only available to handlers and superusers.');
          navigate('/');
        }
      } catch (error) {
        console.error('[EmployeeLeadReportingPage] permission check failed:', error);
        if (!cancelled) {
          setHasAccess(false);
          setPermissionsLoaded(true);
          toast.error('Access denied. Daily lead allocation is only available to handlers and superusers.');
          navigate('/');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

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
        toast.error('Access denied. Daily lead allocation is only available to handlers and superusers.');
        navigate('/');
        return;
      }

      const [activity, allocation, clockRecords, locationOptions] = await Promise.all([
        fetchDailyActivity(ctx.employeeId, workDate),
        fetchDailyAllocation(ctx.employeeId, workDate),
        fetchClockInRecordsInRange(workDate, workDate),
        fetchActiveClockInLocations(),
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
      for (const item of allocation?.items || []) {
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

      const mergedRows: LeadAllocationRow[] = activity.map((act) => {
        const key = leadActivityKey({
          lead_type: act.lead_type,
          new_lead_id: act.new_lead_id,
          legacy_lead_id: act.legacy_lead_id,
          lead_number: act.lead_number,
          client_name: act.client_name,
        });
        const saved = savedByKey.get(key);
        if (saved) {
          savedByKey.delete(key);
          return activityToRow(act, true, saved.percent, true);
        }
        return activityToRow(act, false, 0, false);
      });

      for (const saved of savedByKey.values()) {
        mergedRows.push(allocationItemToRow(saved));
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
    } catch (error) {
      console.error('[EmployeeLeadReportingPage] load failed:', error);
      toast.error('Failed to load lead activity.');
    } finally {
      setLoading(false);
    }
  }, [hasAccess, workDate, navigate]);

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

  const handleAddLead = (lead: CombinedLead) => {
    if (isAllocationLocked) return;
    const newRow = allocationRowFromCombinedLead(lead);
    if (!newRow) {
      toast.error('Could not add this lead.');
      return;
    }
    if (existingLeadKeys.has(newRow.key)) {
      toast.error('This lead is already in the list.');
      return;
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
      toast.success(
        showHoursForm
          ? 'Daily allocation saved. Working hours are waiting for approval.'
          : 'Daily allocation saved.',
      );
    } catch (error) {
      console.error('[EmployeeLeadReportingPage] save failed:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to save allocation.');
    } finally {
      setCheckingBudget(false);
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
        <div className="mx-auto max-w-4xl rounded-[18px] bg-white px-5 py-6 shadow-sm">
          <div className="alert alert-warning border-0 bg-amber-50 text-amber-900">
            <span>Your user account is not linked to an employee profile. Contact an administrator.</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="lead-allocation-page-shell min-h-[calc(100dvh-3.5rem)] bg-[#ececec]">
      <div className="mx-auto flex min-w-0 max-w-4xl flex-col px-4 pb-[max(2.5rem,env(safe-area-inset-bottom,0px))] pt-2 md:px-6 md:pb-12 md:pt-4">
        <div className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="mb-1 flex items-center gap-2 text-primary">
                <ClipboardDocumentListIcon className="h-6 w-6" />
                <span className="text-sm font-semibold uppercase tracking-wide">Lead time report</span>
              </div>
              <h1 className="text-2xl font-bold text-gray-900">Daily lead allocation</h1>
            </div>

            <label className="w-full max-w-xs shrink-0">
              <span className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-600">
                <CalendarDaysIcon className="h-4 w-4" />
                Work date
              </span>
              <input
                type="date"
                className="input h-10 min-h-10 w-full rounded-[14px] border-0 bg-transparent px-3 ring-1 ring-gray-300/80 focus:outline-none focus:ring-2 focus:ring-primary/15"
                value={workDate}
                max={getJerusalemTodayIsoDate()}
                onChange={(e) => setWorkDate(e.target.value)}
              />
            </label>
          </div>

          {showHoursForm ? (
            <div className="rounded-[18px] bg-white px-5 py-4 shadow-sm">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">Worked hours</h2>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {isEditingSavedAllocation && recordedDayWorkedMs >= minMs ? (
                      <>
                        Adjust from/to or workplace for this day. Saving replaces the day&apos;s
                        working hours with a pending approval entry
                        {recordedDayWorkedMs > 0
                          ? ` (currently ${formatAllocationWorkedDuration(recordedDayWorkedMs)})`
                          : ''}
                        .
                      </>
                    ) : (
                      <>
                        Recorded time is below your base {minHours}h
                        {recordedDayWorkedMs > 0
                          ? ` (${formatAllocationWorkedDuration(recordedDayWorkedMs)} so far)`
                          : ''}
                        . Enter from/to so allocation uses your actual day — this is saved to Working
                        Hours awaiting approval.
                      </>
                    )}
                  </p>
                </div>
                {manualIntervalMs > 0 ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                    <ClockIcon className="h-3.5 w-3.5" />
                    {formatAllocationWorkedDuration(manualIntervalMs)}
                  </span>
                ) : null}
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

          <div className="sticky bottom-[max(0.75rem,env(safe-area-inset-bottom,0px))] z-20 flex flex-wrap items-center justify-between gap-3 rounded-[18px] bg-white/95 px-5 py-4 shadow-lg ring-1 ring-black/5 backdrop-blur supports-[backdrop-filter]:bg-white/80">
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
