import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import {
  CalendarDaysIcon,
  ClipboardDocumentListIcon,
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
  dailyAllocationGrandTotal,
  fetchCurrentEmployeeContext,
  fetchDailyActivity,
  fetchDailyAllocation,
  fetchDailyClockInMsByEmployee,
  formatAllocationPercent,
  getJerusalemTodayIsoDate,
  isDailyAllocationValid,
  leadActivityKey,
  rebalanceFlexAllocationBuckets,
  saveDailyAllocation,
  setLeadAllocationPercent,
  syncAllocationTo100,
  type AllocationItemInput,
} from '../lib/employeeLeadReporting';
import {
  evaluateDailyLeadAllocationBudgets,
  type LeadAllocationBudgetHint,
  type LeadAllocationBudgetViolation,
} from '../lib/leadAllocationBudget';
import type { CombinedLead } from '../lib/legacyLeadsApi';

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

const EmployeeLeadReportingPage: React.FC = () => {
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
  const [editSnapshot, setEditSnapshot] = useState<LeadAllocationChangeState | null>(null);
  const [addLeadModalOpen, setAddLeadModalOpen] = useState(false);
  const [dayWorkedMs, setDayWorkedMs] = useState(0);
  const [budgetHints, setBudgetHints] = useState<LeadAllocationBudgetHint[]>([]);
  const [budgetViolations, setBudgetViolations] = useState<LeadAllocationBudgetViolation[]>([]);
  const [budgetAssistOpen, setBudgetAssistOpen] = useState(false);
  const [checkingBudget, setCheckingBudget] = useState(false);

  const loadData = useCallback(async () => {
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
        setDayWorkedMs(0);
        return;
      }

      const [activity, allocation, clockInMsByEmployee] = await Promise.all([
        fetchDailyActivity(ctx.employeeId, workDate),
        fetchDailyAllocation(ctx.employeeId, workDate),
        fetchDailyClockInMsByEmployee(workDate),
      ]);

      setDayWorkedMs(clockInMsByEmployee.get(ctx.employeeId) ?? 0);

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
      const synced = hasSavedAllocation
        ? syncAllocationTo100(mergedRows)
        : rebalanceFlexAllocationBuckets(0, false, mergedRows);
      setRows(synced.rows);
      setOtherWorkPercent(synced.otherWorkPercent);
      setLastSavedAt(allocation?.updated_at || allocation?.submitted_at || null);
      setIsEditing(!hasSavedAllocation);
      setEditSnapshot(null);
    } catch (error) {
      console.error('[EmployeeLeadReportingPage] load failed:', error);
      toast.error('Failed to load lead activity.');
    } finally {
      setLoading(false);
    }
  }, [workDate]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const includedRows = useMemo(() => rows.filter((row) => row.included), [rows]);
  const grandTotal = dailyAllocationGrandTotal(includedRows, otherWorkPercent);
  const canSave = isDailyAllocationValid(includedRows, otherWorkPercent);
  const existingLeadKeys = useMemo(() => new Set(rows.map((row) => row.key)), [rows]);

  const isAllocationLocked = Boolean(lastSavedAt) && !isEditing;
  const isEditingSavedAllocation = Boolean(lastSavedAt) && isEditing;

  const handleStartEdit = () => {
    setEditSnapshot({
      rows: rows.map((row) => ({ ...row })),
      otherWorkPercent,
    });
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    if (editSnapshot) {
      setRows(editSnapshot.rows);
      setOtherWorkPercent(editSnapshot.otherWorkPercent);
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

    const rebalanced = addLeadToAllocationBuckets(rows, newRow);
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

    setSaving(true);
    setCheckingBudget(true);
    try {
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
        dayWorkedMs,
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
      toast.success('Daily allocation saved.');
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

  if (loading) {
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

          <LeadAllocationSliders
            rows={rows}
            otherWorkPercent={otherWorkPercent}
            onChange={handleAllocationChange}
            onAddLead={() => setAddLeadModalOpen(true)}
            readOnly={isAllocationLocked}
            dayWorkedMs={dayWorkedMs}
            budgetHintsByKey={Object.fromEntries(budgetHints.map((h) => [h.key, h]))}
            onApplyLeadMaxBudget={(leadKey, maxAllowedPercent) => {
              const result = setLeadAllocationPercent(rows, leadKey, maxAllowedPercent);
              setRows(result.rows);
              setOtherWorkPercent(result.otherWorkPercent);
              toast.success('Slider set to max available for this lead.');
              void refreshBudgetHints(result.rows, dayWorkedMs);
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

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] bg-white px-5 py-4 shadow-sm">
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
