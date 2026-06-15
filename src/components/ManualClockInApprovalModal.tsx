import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CheckIcon,
  XMarkIcon,
  ClipboardDocumentCheckIcon,
  MagnifyingGlassIcon,
  UserIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import { useAuthContext } from '../contexts/AuthContext';
import { formatClockTime } from '../lib/employeeClockInFormat';
import { unavailabilityDateLabel } from '../lib/employeeUnavailabilities';
import {
  approveClockInRecord,
  declineClockInRecord,
  fetchAllManualClockInsForApproval,
  getClockInApprovalStatus,
  manualClockInWorkplaceLabel,
  type ManualClockInApprovalRecord,
} from '../lib/employeeClockInApproval';

interface ManualClockInApprovalModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpdated?: () => void;
}

type EmployeeGroup = {
  employeeId: number;
  employeeName: string;
  department: string;
  photoUrl: string | null;
  records: ManualClockInApprovalRecord[];
  pendingCount: number;
};

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const PENDING_BADGE_CLASS =
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium shrink-0 bg-amber-100/45 text-amber-800/55 border-0 shadow-none ring-0 outline-none';

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function EmployeeAvatar({
  name,
  photoUrl,
  size = 'md',
}: {
  name: string;
  photoUrl?: string | null;
  size?: 'sm' | 'md';
}) {
  const dim = size === 'sm' ? 'w-8 h-8 text-xs' : 'w-10 h-10 text-sm';
  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt={name}
        className={`${dim} rounded-full object-cover ring-2 ring-base-200 shrink-0`}
      />
    );
  }
  return (
    <span
      className={`${dim} rounded-full bg-primary/10 text-primary font-semibold inline-flex items-center justify-center ring-2 ring-base-200 shrink-0`}
    >
      {getInitials(name) || <UserIcon className="w-4 h-4" />}
    </span>
  );
}

const ManualClockInApprovalModal: React.FC<ManualClockInApprovalModalProps> = ({
  isOpen,
  onClose,
  onUpdated,
}) => {
  const { user } = useAuthContext();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [records, setRecords] = useState<ManualClockInApprovalRecord[]>([]);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [actingId, setActingId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(null);
  const [employeePickerOpen, setEmployeePickerOpen] = useState(false);
  const searchWrapRef = useRef<HTMLDivElement>(null);

  const yearOptions = useMemo(() => {
    const y = now.getFullYear();
    return [y - 2, y - 1, y, y + 1];
  }, [now]);

  const loadRecords = useCallback(async () => {
    setLoadingRecords(true);
    try {
      const rows = await fetchAllManualClockInsForApproval(year, month);
      setRecords(rows);
    } catch (err) {
      console.error('ManualClockInApprovalModal records:', err);
      toast.error('Failed to load manual clock-in entries');
      setRecords([]);
    } finally {
      setLoadingRecords(false);
    }
  }, [year, month]);

  useEffect(() => {
    if (!isOpen) return;
    setSearchQuery('');
    setSelectedEmployeeId(null);
    setEmployeePickerOpen(false);
    void loadRecords();
  }, [isOpen, loadRecords]);

  useEffect(() => {
    if (!employeePickerOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (searchWrapRef.current?.contains(e.target as Node)) return;
      setEmployeePickerOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [employeePickerOpen]);

  const actionableRecords = useMemo(
    () => records.filter((r) => getClockInApprovalStatus(r) !== 'approved'),
    [records],
  );

  const employeeGroups = useMemo((): EmployeeGroup[] => {
    const map = new Map<number, EmployeeGroup>();
    for (const record of actionableRecords) {
      const existing = map.get(record.employee_id);
      if (existing) {
        existing.records.push(record);
        if (getClockInApprovalStatus(record) === 'pending') {
          existing.pendingCount += 1;
        }
      } else {
        map.set(record.employee_id, {
          employeeId: record.employee_id,
          employeeName: record.employee_name || `Employee #${record.employee_id}`,
          department: record.employee_department || '—',
          photoUrl: record.employee_photo_url ?? null,
          records: [record],
          pendingCount: getClockInApprovalStatus(record) === 'pending' ? 1 : 0,
        });
      }
    }
    return [...map.values()]
      .map((group) => ({
        ...group,
        records: [...group.records].sort(
          (a, b) =>
            new Date(a.clock_in_time).getTime() - new Date(b.clock_in_time).getTime(),
        ),
      }))
      .sort((a, b) => a.employeeName.localeCompare(b.employeeName));
  }, [actionableRecords]);

  const employeePickerOptions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return employeeGroups.filter((group) => {
      if (!q) return true;
      return (
        group.employeeName.toLowerCase().includes(q) ||
        group.department.toLowerCase().includes(q)
      );
    });
  }, [employeeGroups, searchQuery]);

  const visibleGroups = useMemo(() => {
    if (selectedEmployeeId != null) {
      return employeeGroups.filter((g) => g.employeeId === selectedEmployeeId);
    }
    const q = searchQuery.trim().toLowerCase();
    if (!q) return employeeGroups;
    return employeeGroups.filter(
      (group) =>
        group.employeeName.toLowerCase().includes(q) ||
        group.department.toLowerCase().includes(q),
    );
  }, [employeeGroups, selectedEmployeeId, searchQuery]);

  const totalPending = useMemo(
    () => actionableRecords.filter((r) => getClockInApprovalStatus(r) === 'pending').length,
    [actionableRecords],
  );

  const handleApprove = async (recordId: number) => {
    if (!user?.id) return;
    setActingId(recordId);
    setRecords((prev) => prev.filter((r) => r.id !== recordId));
    try {
      await approveClockInRecord(recordId, user.id);
      toast.success('Entry approved');
      onUpdated?.();
    } catch (err) {
      console.error('Approve clock-in:', err);
      toast.error('Failed to approve entry');
      await loadRecords();
    } finally {
      setActingId(null);
    }
  };

  const handleDecline = async (recordId: number) => {
    if (!user?.id) return;
    setActingId(recordId);
    try {
      await declineClockInRecord(recordId, user.id);
      toast.success('Entry declined');
      await loadRecords();
      onUpdated?.();
    } catch (err) {
      console.error('Decline clock-in:', err);
      toast.error('Failed to decline entry');
    } finally {
      setActingId(null);
    }
  };

  const selectEmployee = (group: EmployeeGroup) => {
    setSelectedEmployeeId(group.employeeId);
    setSearchQuery(group.employeeName);
    setEmployeePickerOpen(false);
  };

  const clearEmployeeFilter = () => {
    setSelectedEmployeeId(null);
    setSearchQuery('');
    setEmployeePickerOpen(false);
  };

  if (!isOpen || typeof window === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex flex-col bg-base-100"
      role="dialog"
      aria-modal="true"
      aria-labelledby="manual-clock-approval-title"
    >
        <div className="flex items-start justify-between gap-4 border-b border-base-200 px-5 py-4 shrink-0 bg-base-100">
          <div>
            <h2 id="manual-clock-approval-title" className="text-xl font-bold flex items-center gap-2">
              <ClipboardDocumentCheckIcon className="w-6 h-6 text-primary" />
              Manual clock-in approval
            </h2>
            <p className="text-sm text-base-content/60 mt-1">
              {MONTH_NAMES[month - 1]} {year}
              {' · '}
              {visibleGroups.length} employee{visibleGroups.length === 1 ? '' : 's'}
              {totalPending > 0 && (
                <span className={`ml-1.5 ${PENDING_BADGE_CLASS}`}>
                  {totalPending} pending
                </span>
              )}
            </p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm btn-circle" onClick={onClose}>
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="flex flex-wrap items-end gap-3 px-5 py-4 border-b border-base-200 bg-base-200/20 shrink-0">
          <div className="form-control min-w-[240px] flex-1" ref={searchWrapRef}>
            <label className="label py-0 pb-1">
              <span className="label-text text-xs font-medium">Employee</span>
            </label>
            <div className="relative">
              <MagnifyingGlassIcon className="w-4 h-4 text-base-content/40 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                className="input input-bordered input-sm w-full pl-9 pr-9"
                placeholder="Search employee…"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSelectedEmployeeId(null);
                  setEmployeePickerOpen(true);
                }}
                onFocus={() => setEmployeePickerOpen(true)}
              />
              {(searchQuery || selectedEmployeeId != null) && (
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 btn btn-ghost btn-xs btn-circle"
                  aria-label="Clear employee filter"
                  onClick={clearEmployeeFilter}
                >
                  <XMarkIcon className="w-4 h-4" />
                </button>
              )}
              {employeePickerOpen && employeePickerOptions.length > 0 && (
                <ul className="absolute z-20 mt-1 w-full max-h-56 overflow-auto rounded-xl border border-base-200 bg-base-100 shadow-lg py-1">
                  {employeePickerOptions.map((group) => (
                    <li key={group.employeeId}>
                      <button
                        type="button"
                        className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-base-200/70 transition-colors"
                        onClick={() => selectEmployee(group)}
                      >
                        <EmployeeAvatar
                          name={group.employeeName}
                          photoUrl={group.photoUrl}
                          size="sm"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-sm truncate">{group.employeeName}</div>
                          <div className="text-xs text-base-content/55 truncate">
                            {group.department}
                            {group.pendingCount > 0 && (
                              <span className={PENDING_BADGE_CLASS}>
                                {group.pendingCount} pending
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div className="form-control w-32">
            <label className="label py-0 pb-1">
              <span className="label-text text-xs font-medium">Month</span>
            </label>
            <select
              className="select select-bordered select-sm w-full"
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
            >
              {MONTH_NAMES.map((name, idx) => (
                <option key={name} value={idx + 1}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-control w-24">
            <label className="label py-0 pb-1">
              <span className="label-text text-xs font-medium">Year</span>
            </label>
            <select
              className="select select-bordered select-sm w-full"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4 space-y-5 min-h-0">
          {loadingRecords ? (
            <div className="flex justify-center py-16">
              <span className="loading loading-spinner loading-lg text-primary" />
            </div>
          ) : visibleGroups.length === 0 ? (
            <div className="text-center py-16 text-base-content/50">
              {actionableRecords.length === 0
                ? 'No pending manual clock-in entries for this period.'
                : 'No employees match your search.'}
            </div>
          ) : (
            visibleGroups.map((group) => (
              <section
                key={group.employeeId}
                className="rounded-2xl border border-base-200 overflow-hidden bg-base-100"
              >
                <div className="flex items-center gap-3 px-4 py-3 bg-base-200/40 border-b border-base-200">
                  <EmployeeAvatar
                    name={group.employeeName}
                    photoUrl={group.photoUrl}
                  />
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-base truncate">{group.employeeName}</h3>
                    <p className="text-xs text-base-content/55 truncate">{group.department}</p>
                  </div>
                  {group.pendingCount > 0 ? (
                    <span className={PENDING_BADGE_CLASS}>
                      {group.pendingCount} pending
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium shrink-0 bg-base-200/50 text-base-content/40 border-0 shadow-none">
                      No pending
                    </span>
                  )}
                </div>

                <div className="overflow-x-auto">
                  <table className="table table-sm">
                    <thead>
                      <tr className="bg-base-200/30 text-xs uppercase tracking-wide text-base-content/50">
                        <th>Date</th>
                        <th>Clock in</th>
                        <th>Clock out</th>
                        <th>Workplace in</th>
                        <th>Workplace out</th>
                        <th>Notes</th>
                        <th className="w-24" aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {group.records.map((record) => {
                        const status = getClockInApprovalStatus(record);
                        const dateKey = record.clock_in_time.split('T')[0];
                        const isActing = actingId === record.id;
                        const isDeclined = status === 'declined';

                        return (
                          <tr key={record.id} className="hover:bg-base-200/30 transition-colors">
                            <td className="whitespace-nowrap font-medium">
                              {unavailabilityDateLabel(dateKey)}
                            </td>
                            <td className="whitespace-nowrap">
                              {formatClockTime(record.clock_in_time)}
                            </td>
                            <td className="whitespace-nowrap">
                              {record.clock_out_time
                                ? formatClockTime(record.clock_out_time)
                                : '—'}
                            </td>
                            <td className="text-sm max-w-[120px] truncate">
                              {manualClockInWorkplaceLabel(record, 'in')}
                            </td>
                            <td className="text-sm max-w-[120px] truncate">
                              {record.clock_out_time
                                ? manualClockInWorkplaceLabel(record, 'out')
                                : '—'}
                            </td>
                            <td className="text-sm max-w-[140px] truncate text-base-content/70">
                              {record.notes?.trim() || '—'}
                            </td>
                            <td className="text-right whitespace-nowrap">
                              <div className="inline-flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  title="Approve"
                                  aria-label="Approve entry"
                                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-emerald-200/80 bg-emerald-50 text-emerald-600 shadow-sm transition-all hover:scale-105 hover:border-emerald-300 hover:bg-emerald-100 hover:shadow disabled:opacity-40 disabled:hover:scale-100"
                                  disabled={isActing}
                                  onClick={() => void handleApprove(record.id)}
                                >
                                  {isActing ? (
                                    <span className="loading loading-spinner loading-xs" />
                                  ) : (
                                    <CheckIcon className="h-4 w-4 stroke-[2.5]" />
                                  )}
                                </button>
                                <button
                                  type="button"
                                  title={isDeclined ? 'Already declined' : 'Decline'}
                                  aria-label="Decline entry"
                                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-base-200 bg-white text-base-content/45 shadow-sm transition-all hover:scale-105 hover:border-red-200 hover:bg-red-50 hover:text-red-600 hover:shadow disabled:opacity-40 disabled:hover:scale-100"
                                  disabled={isActing || isDeclined}
                                  onClick={() => void handleDecline(record.id)}
                                >
                                  <XMarkIcon className="h-4 w-4 stroke-[2.5]" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            ))
          )}
        </div>

        <div className="border-t border-base-200 px-5 py-3 flex justify-end shrink-0 bg-base-100">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
    </div>,
    document.body,
  );
};

export default ManualClockInApprovalModal;
