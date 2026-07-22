import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckIcon,
  XMarkIcon,
  MagnifyingGlassIcon,
  ClipboardDocumentCheckIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import { useAuthContext } from '../../contexts/AuthContext';
import {
  approveClockInRecord,
  declineClockInRecord,
  fetchPendingManualClockInsForApproval,
  getClockInApprovalStatus,
  isHomeWfhApprovalRequest,
  manualClockInWorkplaceLabel,
  type ManualClockInApprovalRecord,
} from '../../lib/employeeClockInApproval';
import {
  approveWfhPeriodRequest,
  declineWfhPeriodRequest,
  fetchPendingWfhPeriodRequestsForApproval,
  formatWfhPeriodLabel,
  type WfhPeriodRequest,
} from '../../lib/employeeWfhPeriodRequests';
import { formatClockDuration, formatClockTime } from '../../lib/employeeClockInFormat';
import {
  approveUnavailabilityRecord,
  declineUnavailabilityRecord,
  fetchPendingUnavailabilitiesForApproval,
  unavailabilityApprovalSummary,
  unavailabilityNeedsDocument,
  type UnavailabilityApprovalRecord,
} from '../../lib/employeeUnavailabilityApproval';
import {
  unavailabilityDateLabel,
  unavailabilityDateRangeLabel,
} from '../../lib/employeeUnavailabilities';
import {
  buildClockInApprovalReview,
  formatClockInApprovalMissingRequiredDetail,
  getClockInApprovalMissingRequiredFields,
  getClockInRevisionFieldChanges,
  getPrimaryApprovalInsight,
} from '../../lib/clockInApprovalInsights';
import {
  fetchLatestClockInRevisionsByRecordIds,
  type ClockInRevisionSnapshot,
} from '../../lib/employeeClockInRevisions';
import { useManualClockInApprovalLiveRefresh } from '../../hooks/useManualClockInApprovalLiveRefresh';
import DeclineClockInNoteModal from '../profile/DeclineClockInNoteModal';
import {
  ApprovalChangedValue,
  ApprovalNotesButton,
  ClockInInsightTag,
  ManualClockInApprovalRecordExtras,
} from '../ManualClockInApprovalRecordExtras';
import UnavailabilityTypeBadge from '../UnavailabilityTypeBadge';
import HrEmployeeAvatar from './HrEmployeeAvatar';

export type HrApprovalKindFilter = 'all' | 'clock' | 'wfh' | 'leave';

type UnifiedItem =
  | { kind: 'clock'; record: ManualClockInApprovalRecord }
  | { kind: 'wfh'; record: WfhPeriodRequest }
  | { kind: 'leave'; record: UnavailabilityApprovalRecord };

type EmployeeGroup = {
  employeeId: number;
  employeeName: string;
  department: string;
  photoUrl: string | null;
  items: UnifiedItem[];
};

type DeclineTarget =
  | { mode: 'single'; kind: 'clock' | 'wfh' | 'leave'; id: number }
  | { mode: 'bulk'; items: Array<{ kind: 'clock' | 'wfh' | 'leave'; id: number }> };

const APPROVAL_TABLE_COL_SPAN = 10;
const CLOCK_IN_DATE_BADGE_CLASS =
  'inline-flex items-center px-2.5 py-1 rounded-md text-white text-sm font-medium whitespace-nowrap';
const CLOCK_IN_DATE_BADGE_BG = 'rgb(25, 49, 31)';
const HOME_WFH_DATE_BADGE_BG = 'rgb(217, 119, 6)';

function approvalClockOutTime(record: ManualClockInApprovalRecord): string {
  return record.clock_out_time ? formatClockTime(record.clock_out_time) : '—';
}

function approvalSessionDuration(record: ManualClockInApprovalRecord): string {
  if (!record.clock_out_time) return '—';
  return formatClockDuration(record.clock_in_time, record.clock_out_time);
}

function approvalPreviousSessionDuration(
  revision: ClockInRevisionSnapshot | null,
): string | null {
  if (!revision?.clockOutTime) return null;
  return formatClockDuration(revision.clockInTime, revision.clockOutTime);
}

interface HrApprovalsPanelProps {
  onUpdated?: () => void;
  /** Compact layout for embedding inside an existing modal. */
  embedded?: boolean;
}

const HrApprovalsPanel: React.FC<HrApprovalsPanelProps> = ({ onUpdated }) => {
  const { user } = useAuthContext();
  const [loading, setLoading] = useState(true);
  const [clockRecords, setClockRecords] = useState<ManualClockInApprovalRecord[]>([]);
  const [wfhPeriodRecords, setWfhPeriodRecords] = useState<WfhPeriodRequest[]>([]);
  const [leaveRecords, setLeaveRecords] = useState<UnavailabilityApprovalRecord[]>([]);
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<HrApprovalKindFilter>('all');
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [declineTarget, setDeclineTarget] = useState<DeclineTarget | null>(null);
  const [revisionsByRecordId, setRevisionsByRecordId] = useState<
    Map<number, ClockInRevisionSnapshot>
  >(() => new Map());

  const itemKey = (item: UnifiedItem) => `${item.kind}-${item.record.id}`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [clock, wfhPeriods, leave] = await Promise.all([
        fetchPendingManualClockInsForApproval('all'),
        fetchPendingWfhPeriodRequestsForApproval().catch(() => [] as WfhPeriodRequest[]),
        fetchPendingUnavailabilitiesForApproval().catch(() => [] as UnavailabilityApprovalRecord[]),
      ]);
      const pendingClock = clock.filter((r) => getClockInApprovalStatus(r) === 'pending');
      setClockRecords(pendingClock);
      setWfhPeriodRecords(wfhPeriods);
      setLeaveRecords(leave);

      const revisionIds = pendingClock
        .filter((r) => !isHomeWfhApprovalRequest(r))
        .map((r) => r.id);
      const revisions = await fetchLatestClockInRevisionsByRecordIds(revisionIds);
      setRevisionsByRecordId(revisions);
    } catch (err) {
      console.error('HrApprovalsPanel load:', err);
      toast.error('Failed to load pending approvals');
      setRevisionsByRecordId(new Map());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useManualClockInApprovalLiveRefresh({
    enabled: true,
    channelSuffix: 'hr-approvals-panel',
    onChange: load,
  });

  const groups = useMemo(() => {
    const items: UnifiedItem[] = [
      ...clockRecords.map((record) => ({ kind: 'clock' as const, record })),
      ...wfhPeriodRecords.map((record) => ({ kind: 'wfh' as const, record })),
      ...leaveRecords.map((record) => ({ kind: 'leave' as const, record })),
    ];

    const filtered = items.filter((item) => {
      if (kindFilter === 'clock') {
        return item.kind === 'clock' && !isHomeWfhApprovalRequest(item.record);
      }
      if (kindFilter === 'wfh') {
        return (
          item.kind === 'wfh'
          || (item.kind === 'clock' && isHomeWfhApprovalRequest(item.record))
        );
      }
      if (kindFilter === 'leave') return item.kind === 'leave';
      return true;
    });

    const q = search.trim().toLowerCase();
    const searched = q
      ? filtered.filter((item) => {
          const name = item.record.employee_name || '';
          const dept = item.record.employee_department || '';
          return name.toLowerCase().includes(q) || dept.toLowerCase().includes(q);
        })
      : filtered;

    const map = new Map<number, EmployeeGroup>();
    for (const item of searched) {
      const record = item.record;
      const employeeId = record.employee_id;
      const existing = map.get(employeeId);
      const photoUrl =
        item.kind === 'leave'
          ? (record as UnavailabilityApprovalRecord).employee_photo_url ?? null
          : item.kind === 'wfh'
            ? (record as WfhPeriodRequest).employee_photo_url ?? null
            : (record as ManualClockInApprovalRecord).employee_photo_url ?? null;
      if (existing) {
        existing.items.push(item);
      } else {
        map.set(employeeId, {
          employeeId,
          employeeName: record.employee_name || `Employee #${employeeId}`,
          department: record.employee_department || '—',
          photoUrl,
          items: [item],
        });
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      a.employeeName.localeCompare(b.employeeName),
    );
  }, [clockRecords, wfhPeriodRecords, leaveRecords, kindFilter, search]);

  const totals = useMemo(() => {
    const legacyWfh = clockRecords.filter(isHomeWfhApprovalRequest).length;
    const wfh = legacyWfh + wfhPeriodRecords.length;
    const clock = clockRecords.length - legacyWfh;
    return {
      clock,
      wfh,
      leave: leaveRecords.length,
      all: clockRecords.length + wfhPeriodRecords.length + leaveRecords.length,
    };
  }, [clockRecords, wfhPeriodRecords, leaveRecords]);

  const setBusy = (key: string, on: boolean) => {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const afterChange = async () => {
    await load();
    onUpdated?.();
  };

  const handleApprove = async (kind: 'clock' | 'wfh' | 'leave', id: number) => {
    if (!user?.id) {
      toast.error('Not signed in');
      return;
    }
    const key = `${kind}-${id}`;
    setBusy(key, true);
    try {
      if (kind === 'clock') await approveClockInRecord(id, user.id);
      else if (kind === 'wfh') await approveWfhPeriodRequest(id, user.id);
      else await approveUnavailabilityRecord(id, user.id);
      toast.success('Approved');
      await afterChange();
    } catch (err) {
      console.error(err);
      toast.error('Failed to approve');
    } finally {
      setBusy(key, false);
    }
  };

  const runDecline = async (target: DeclineTarget, note?: string) => {
    if (!user?.id) {
      toast.error('Not signed in');
      return;
    }
    try {
      if (target.mode === 'single') {
        const key = `${target.kind}-${target.id}`;
        setBusy(key, true);
        try {
          if (target.kind === 'clock') await declineClockInRecord(target.id, user.id, note);
          else if (target.kind === 'wfh') await declineWfhPeriodRequest(target.id, user.id, note);
          else await declineUnavailabilityRecord(target.id, user.id, note);
          toast.success('Declined');
        } finally {
          setBusy(key, false);
        }
      } else {
        for (const item of target.items) {
          if (item.kind === 'clock') await declineClockInRecord(item.id, user.id, note);
          else if (item.kind === 'wfh') await declineWfhPeriodRequest(item.id, user.id, note);
          else await declineUnavailabilityRecord(item.id, user.id, note);
        }
        toast.success(`Declined ${target.items.length}`);
        setSelected(new Set());
      }
      await afterChange();
    } catch (err) {
      console.error(err);
      toast.error('Failed to decline');
    } finally {
      setDeclineTarget(null);
    }
  };

  const handleBulkApprove = async () => {
    if (!user?.id || selected.size === 0) return;
    try {
      for (const key of selected) {
        const [kind, idStr] = key.split('-') as ['clock' | 'wfh' | 'leave', string];
        const id = Number(idStr);
        if (kind === 'clock') await approveClockInRecord(id, user.id);
        else if (kind === 'wfh') await approveWfhPeriodRequest(id, user.id);
        else await approveUnavailabilityRecord(id, user.id);
      }
      toast.success(`Approved ${selected.size}`);
      setSelected(new Set());
      await afterChange();
    } catch (err) {
      console.error(err);
      toast.error('Bulk approve failed');
    }
  };

  const toggleSelected = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const visibleKeys = useMemo(
    () => groups.flatMap((group) => group.items.map((item) => itemKey(item))),
    [groups],
  );
  const allVisibleSelected =
    visibleKeys.length > 0 && visibleKeys.every((key) => selected.has(key));
  const someVisibleSelected =
    visibleKeys.some((key) => selected.has(key)) && !allVisibleSelected;

  const toggleSelectAllVisible = () => {
    setSelected((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        for (const key of visibleKeys) next.delete(key);
        return next;
      }
      const next = new Set(prev);
      for (const key of visibleKeys) next.add(key);
      return next;
    });
  };

  const filterPills: Array<{ id: HrApprovalKindFilter; label: string; count: number }> = [
    { id: 'all', label: 'All', count: totals.all },
    { id: 'clock', label: 'Clock-in', count: totals.clock },
    { id: 'wfh', label: 'Home / WFH', count: totals.wfh },
    { id: 'leave', label: 'Leave', count: totals.leave },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="relative flex-1 max-w-md">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search employee or department…"
            className="w-full rounded-full border border-gray-200 bg-white py-2.5 pl-9 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {filterPills.map((pill) => (
            <button
              key={pill.id}
              type="button"
              onClick={() => setKindFilter(pill.id)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold border transition ${
                kindFilter === pill.id
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {pill.label}
              <span className="opacity-80">{pill.count}</span>
            </button>
          ))}
        </div>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-white border border-gray-200 px-4 py-3">
          <span className="text-sm text-gray-600">{selected.size} selected</span>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
            onClick={() => void handleBulkApprove()}
          >
            <CheckIcon className="w-4 h-4 stroke-[2.5]" />
            Approve
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold bg-red-50 text-red-700 hover:bg-red-100"
            onClick={() =>
              setDeclineTarget({
                mode: 'bulk',
                items: Array.from(selected).map((key) => {
                  const [kind, idStr] = key.split('-') as ['clock' | 'wfh' | 'leave', string];
                  return { kind, id: Number(idStr) };
                }),
              })
            }
          >
            <XMarkIcon className="w-4 h-4 stroke-[2.5]" />
            Decline
          </button>
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl bg-white border border-gray-200 py-16 text-center text-gray-400">
          Loading approvals…
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-2xl bg-white border border-gray-200 py-16 text-center text-gray-400">
          <ClipboardDocumentCheckIcon className="w-12 h-12 mx-auto mb-3 opacity-30" />
          No pending requests
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-white">
          <table className="table w-full text-base">
            <thead>
              <tr className="text-sm uppercase tracking-wider text-gray-500">
                <th className="bg-transparent font-semibold w-10">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm"
                    checked={allVisibleSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someVisibleSelected;
                    }}
                    onChange={toggleSelectAllVisible}
                    disabled={visibleKeys.length === 0}
                    aria-label="Select all rows"
                    title="Select all rows"
                  />
                </th>
                <th className="bg-transparent font-semibold">Employee</th>
                <th className="bg-transparent font-semibold">Type</th>
                <th className="bg-transparent font-semibold">Date</th>
                <th className="bg-transparent font-semibold">Clock in</th>
                <th className="bg-transparent font-semibold">Clock out</th>
                <th className="bg-transparent font-semibold">Total</th>
                <th className="bg-transparent font-semibold">Workplace</th>
                <th className="bg-transparent font-semibold">Notes</th>
                <th className="bg-transparent font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {groups.flatMap((group) =>
                group.items.flatMap((item) => {
                  const key = itemKey(item);
                  const busy = busyIds.has(key);

                  if (item.kind === 'clock') {
                    const r = item.record;
                    const isWfh = isHomeWfhApprovalRequest(r);
                    const dateKey = r.clock_in_time.split('T')[0];
                    const revision = revisionsByRecordId.get(r.id) ?? null;
                    const fieldChanges = getClockInRevisionFieldChanges(r, revision);
                    const missingRequired = isWfh
                      ? []
                      : getClockInApprovalMissingRequiredFields(r);
                    const review = buildClockInApprovalReview(r, revision);
                    const primaryInsight = getPrimaryApprovalInsight(review.insights);

                    return [
                      <tr key={key} className="hover">
                        <td>
                          <input
                            type="checkbox"
                            className="checkbox checkbox-sm"
                            checked={selected.has(key)}
                            onChange={() => toggleSelected(key)}
                            aria-label={`Select request for ${group.employeeName}`}
                          />
                        </td>
                        <td className="font-medium text-base text-gray-900 whitespace-nowrap">
                          <div className="flex items-center gap-3 min-w-0">
                            <HrEmployeeAvatar
                              employeeId={group.employeeId}
                              name={group.employeeName}
                              photoUrl={group.photoUrl}
                              size="lg"
                            />
                            <div className="min-w-0">
                              <div className="truncate">{group.employeeName}</div>
                              <div className="text-sm font-bold text-gray-500 truncate">
                                {group.department || '—'}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            <span
                              className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold border-0 whitespace-nowrap ${
                                isWfh
                                  ? 'bg-orange-100 text-orange-800'
                                  : 'bg-emerald-100 text-emerald-900'
                              }`}
                            >
                              {isWfh ? 'Home / WFH' : 'Manual clock'}
                            </span>
                            {primaryInsight && (
                              <ClockInInsightTag
                                level={primaryInsight.level}
                                variant="pill"
                                title={primaryInsight.detail || primaryInsight.title}
                              />
                            )}
                          </div>
                        </td>
                        <td className="whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span
                              className={CLOCK_IN_DATE_BADGE_CLASS}
                              style={{
                                backgroundColor: isWfh
                                  ? HOME_WFH_DATE_BADGE_BG
                                  : CLOCK_IN_DATE_BADGE_BG,
                              }}
                            >
                              {unavailabilityDateLabel(dateKey)}
                            </span>
                            {missingRequired.length > 0 && (
                              <ClockInInsightTag
                                level="flag"
                                variant="pill"
                                title={formatClockInApprovalMissingRequiredDetail(
                                  missingRequired,
                                )}
                              />
                            )}
                          </div>
                        </td>
                        {isWfh ? (
                          <td className="text-base text-gray-600" colSpan={5}>
                            <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-600 whitespace-nowrap">
                              Home access requested at {formatClockTime(r.clock_in_time)}.
                            </span>
                          </td>
                        ) : (
                          <>
                            <td className="whitespace-nowrap text-base text-gray-700">
                              <ApprovalChangedValue
                                value={formatClockTime(r.clock_in_time)}
                                previous={fieldChanges.clockIn?.previous}
                              />
                            </td>
                            <td className="whitespace-nowrap text-base text-gray-700">
                              <ApprovalChangedValue
                                value={approvalClockOutTime(r)}
                                previous={fieldChanges.clockOut?.previous}
                              />
                            </td>
                            <td className="whitespace-nowrap text-base text-gray-700 tabular-nums">
                              <ApprovalChangedValue
                                value={approvalSessionDuration(r)}
                                previous={
                                  fieldChanges.clockIn || fieldChanges.clockOut
                                    ? approvalPreviousSessionDuration(revision)
                                    : null
                                }
                              />
                            </td>
                            <td className="text-base text-gray-700 max-w-[140px] truncate">
                              <ApprovalChangedValue
                                value={manualClockInWorkplaceLabel(r, 'in')}
                                previous={fieldChanges.workplaceIn?.previous}
                              />
                            </td>
                            <td className="text-sm max-w-[10rem] sm:max-w-[16rem] lg:max-w-[28rem] xl:max-w-[36rem]">
                              <ApprovalNotesButton notes={r.notes} />
                            </td>
                          </>
                        )}
                        <td className="text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              disabled={busy}
                              className="btn btn-sm rounded-full bg-emerald-600 text-white border-0 hover:bg-emerald-700"
                              onClick={() => void handleApprove('clock', r.id)}
                            >
                              <CheckIcon className="w-4 h-4 stroke-[2.5]" />
                              Approve
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              className="btn btn-sm rounded-full bg-red-50 text-red-700 border-0 hover:bg-red-100"
                              onClick={() =>
                                setDeclineTarget({ mode: 'single', kind: 'clock', id: r.id })
                              }
                            >
                              <XMarkIcon className="w-4 h-4 stroke-[2.5]" />
                              Decline
                            </button>
                          </div>
                        </td>
                      </tr>,
                      !isWfh ? (
                        <ManualClockInApprovalRecordExtras
                          key={`${key}-extras`}
                          record={r}
                          revision={revision}
                          colSpan={APPROVAL_TABLE_COL_SPAN}
                        />
                      ) : null,
                    ].filter(Boolean);
                  }

                  if (item.kind === 'wfh') {
                    const r = item.record;
                    const periodLabel = formatWfhPeriodLabel(r.start_date, r.end_date);
                    return [
                      <tr key={key} className="hover">
                        <td>
                          <input
                            type="checkbox"
                            className="checkbox checkbox-sm"
                            checked={selected.has(key)}
                            onChange={() => toggleSelected(key)}
                            aria-label={`Select WFH request for ${group.employeeName}`}
                          />
                        </td>
                        <td className="font-medium text-base text-gray-900 whitespace-nowrap">
                          <div className="flex items-center gap-3 min-w-0">
                            <HrEmployeeAvatar
                              employeeId={group.employeeId}
                              name={group.employeeName}
                              photoUrl={group.photoUrl}
                              size="lg"
                            />
                            <div className="min-w-0">
                              <div className="truncate">{group.employeeName}</div>
                              <div className="text-sm font-bold text-gray-500 truncate">
                                {group.department || '—'}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className="inline-flex rounded-full px-3 py-1 text-sm font-semibold border-0 whitespace-nowrap bg-orange-100 text-orange-800">
                            Home / WFH period
                          </span>
                        </td>
                        <td className="whitespace-nowrap">
                          <span
                            className={CLOCK_IN_DATE_BADGE_CLASS}
                            style={{ backgroundColor: HOME_WFH_DATE_BADGE_BG }}
                          >
                            {periodLabel}
                          </span>
                        </td>
                        <td className="text-base text-gray-600" colSpan={4}>
                          <span className="inline-flex items-center rounded-full bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-900 whitespace-nowrap">
                            Work from home requested for {periodLabel}
                          </span>
                        </td>
                        <td className="text-sm max-w-[10rem] sm:max-w-[16rem] lg:max-w-[28rem] xl:max-w-[36rem]">
                          <ApprovalNotesButton notes={r.notes} title="WFH request notes" />
                        </td>
                        <td className="text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              disabled={busy}
                              className="btn btn-sm rounded-full bg-emerald-600 text-white border-0 hover:bg-emerald-700"
                              onClick={() => void handleApprove('wfh', r.id)}
                            >
                              <CheckIcon className="w-4 h-4 stroke-[2.5]" />
                              Approve
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              className="btn btn-sm rounded-full bg-red-50 text-red-700 border-0 hover:bg-red-100"
                              onClick={() =>
                                setDeclineTarget({ mode: 'single', kind: 'wfh', id: r.id })
                              }
                            >
                              <XMarkIcon className="w-4 h-4 stroke-[2.5]" />
                              Decline
                            </button>
                          </div>
                        </td>
                      </tr>,
                    ];
                  }

                  const r = item.record as UnavailabilityApprovalRecord;
                  const missingDoc = unavailabilityNeedsDocument(r);
                  return [
                    <tr key={key} className="hover">
                      <td>
                        <input
                          type="checkbox"
                          className="checkbox checkbox-sm"
                          checked={selected.has(key)}
                          onChange={() => toggleSelected(key)}
                          aria-label={`Select request for ${group.employeeName}`}
                        />
                      </td>
                      <td className="font-medium text-base text-gray-900 whitespace-nowrap">
                        <div className="flex items-center gap-3 min-w-0">
                          <HrEmployeeAvatar
                            employeeId={group.employeeId}
                            name={group.employeeName}
                            photoUrl={group.photoUrl}
                            size="lg"
                          />
                          <div className="min-w-0">
                            <div className="truncate">{group.employeeName}</div>
                            <div className="text-sm font-bold text-gray-500 truncate">
                              {group.department || '—'}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <UnavailabilityTypeBadge
                          type={r.unavailability_type}
                          size="md"
                          borderless
                          className="rounded-full px-3 py-1 text-sm font-semibold whitespace-nowrap"
                        />
                      </td>
                      <td className="text-base text-gray-700 whitespace-nowrap">
                        {unavailabilityDateRangeLabel(r.start_date, r.end_date)}
                      </td>
                      <td className="text-base text-gray-400" colSpan={3}>
                        —
                      </td>
                      <td className="text-base text-gray-400">—</td>
                      <td className="text-sm max-w-[10rem] sm:max-w-[16rem] lg:max-w-[28rem] xl:max-w-[36rem]">
                        <ApprovalNotesButton
                          notes={unavailabilityApprovalSummary(r)}
                          title="Leave notes"
                        />
                        {missingDoc && (
                          <div className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-amber-700">
                            <ExclamationTriangleIcon className="w-3.5 h-3.5 shrink-0" />
                            Missing document
                          </div>
                        )}
                      </td>
                      <td className="text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            className="btn btn-sm rounded-full bg-emerald-600 text-white border-0 hover:bg-emerald-700"
                            onClick={() => void handleApprove('leave', r.id)}
                          >
                            <CheckIcon className="w-4 h-4 stroke-[2.5]" />
                            Approve
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            className="btn btn-sm rounded-full bg-red-50 text-red-700 border-0 hover:bg-red-100"
                            onClick={() =>
                              setDeclineTarget({ mode: 'single', kind: 'leave', id: r.id })
                            }
                          >
                            <XMarkIcon className="w-4 h-4 stroke-[2.5]" />
                            Decline
                          </button>
                        </div>
                      </td>
                    </tr>,
                  ];
                }),
              )}
            </tbody>
          </table>
        </div>
      )}

      <DeclineClockInNoteModal
        open={declineTarget != null}
        onClose={() => setDeclineTarget(null)}
        onConfirm={(note) => {
          if (declineTarget) void runDecline(declineTarget, note);
        }}
      />
    </div>
  );
};

export default HrApprovalsPanel;
