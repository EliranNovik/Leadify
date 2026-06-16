import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CheckIcon,
  XMarkIcon,
  ClipboardDocumentCheckIcon,
  MagnifyingGlassIcon,
  UserIcon,
  ChevronDownIcon,
  EnvelopeIcon,
  PhoneIcon,
  DevicePhoneMobileIcon,
  ChatBubbleLeftRightIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import { useAuthContext } from '../contexts/AuthContext';
import { formatClockTime } from '../lib/employeeClockInFormat';
import { unavailabilityDateLabel } from '../lib/employeeUnavailabilities';
import RMQMessagesPage from '../pages/RMQMessagesPage';
import {
  approveClockInRecord,
  declineClockInRecord,
  fetchAllManualClockInsForApproval,
  fetchAllUnapprovedManualClockInsForApproval,
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
  email: string | null;
  phone: string | null;
  mobile: string | null;
  chatUserId: string | null;
  records: ManualClockInApprovalRecord[];
  pendingCount: number;
};

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const PENDING_BADGE_CLASS =
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium shrink-0 bg-amber-100/45 text-amber-800/55 border-0 shadow-none ring-0 outline-none';

const BULK_ACTION_BTN_BASE =
  'inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold border-0 shadow-sm transition-all duration-200 disabled:opacity-40 disabled:pointer-events-none disabled:shadow-none';

const BULK_APPROVE_TRIGGER_CLASS = `${BULK_ACTION_BTN_BASE} bg-emerald-50 text-emerald-800 hover:bg-emerald-100 hover:shadow-md active:scale-[0.98]`;
const BULK_DECLINE_TRIGGER_CLASS = `${BULK_ACTION_BTN_BASE} bg-red-50 text-red-700 hover:bg-red-100 hover:shadow-md active:scale-[0.98]`;
const BULK_APPROVE_CONFIRM_CLASS = `${BULK_ACTION_BTN_BASE} bg-emerald-600 text-white hover:bg-emerald-700 hover:shadow-md active:scale-[0.98]`;
const BULK_DECLINE_CONFIRM_CLASS = `${BULK_ACTION_BTN_BASE} bg-red-600 text-white hover:bg-red-700 hover:shadow-md active:scale-[0.98]`;
const BULK_CANCEL_CLASS =
  'inline-flex items-center rounded-full px-3.5 py-2.5 text-sm font-medium text-base-content/55 hover:text-base-content hover:bg-base-200/70 transition-colors disabled:opacity-40';

/** Matches CalendarPage table time badge (dark green pill). */
const CLOCK_IN_DATE_BADGE_CLASS =
  'inline-flex items-center px-2.5 py-1 rounded-md text-white text-sm font-medium whitespace-nowrap';
const CLOCK_IN_DATE_BADGE_BG = 'rgb(25, 49, 31)';

const MANUAL_CLOCK_APPROVAL_TABLE_STYLES = `
  .manual-clock-approval-table-shell table {
    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
    border-collapse: separate !important;
    border-spacing: 0 10px !important;
  }

  .manual-clock-approval-table-shell .table tbody tr:hover {
    background-color: transparent !important;
  }

  .manual-clock-approval-table-shell table tbody tr {
    background: transparent !important;
    border-radius: 18px !important;
    overflow: hidden !important;
    box-shadow: none !important;
  }

  .manual-clock-approval-table-shell table tbody td {
    border: none !important;
    border-bottom: none !important;
    background: #ffffff !important;
    box-shadow: none !important;
    vertical-align: middle;
  }

  .manual-clock-approval-table-shell table tbody tr.manual-clock-approval-row-declined td {
    background: #f3f4f6 !important;
  }

  .manual-clock-approval-table-shell table tbody td:first-child {
    border-top-left-radius: 18px !important;
    border-bottom-left-radius: 18px !important;
    padding-left: 1.1rem !important;
  }

  .manual-clock-approval-table-shell table tbody td:last-child {
    border-top-right-radius: 18px !important;
    border-bottom-right-radius: 18px !important;
    padding-right: 1.1rem !important;
  }

  .manual-clock-approval-table-shell table tbody tr:hover td {
    background: #f1f5f9 !important;
  }

  .manual-clock-approval-table-shell table tbody tr.manual-clock-approval-row-declined:hover td {
    background: #e5e7eb !important;
  }

  .manual-clock-approval-table-shell table thead,
  .manual-clock-approval-table-shell table thead tr,
  .manual-clock-approval-table-shell table thead th {
    background-color: transparent !important;
    background-image: none !important;
    border-bottom: none !important;
  }

  .manual-clock-approval-table-shell table.manual-clock-approval-results-table thead tr,
  .manual-clock-approval-table-shell table.manual-clock-approval-results-table thead th {
    background-color: #ececec !important;
  }
`;

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

function EmployeeContactBar({
  group,
  onMessage,
}: {
  group: EmployeeGroup;
  onMessage: () => void;
}) {
  const contactItems = [
    group.email
      ? { key: 'email', icon: EnvelopeIcon, label: group.email, href: `mailto:${group.email}` }
      : null,
    group.phone
      ? { key: 'phone', icon: PhoneIcon, label: group.phone, href: `tel:${group.phone}` }
      : null,
    group.mobile
      ? { key: 'mobile', icon: DevicePhoneMobileIcon, label: group.mobile, href: `tel:${group.mobile}` }
      : null,
  ].filter((item): item is { key: string; icon: typeof EnvelopeIcon; label: string; href: string } => item != null);

  return (
    <div
      className="flex flex-wrap items-center gap-2 pt-3 border-t border-base-200/80"
      onClick={(e) => e.stopPropagation()}
    >
      {contactItems.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 min-w-0 flex-1">
          {contactItems.map((item) => (
            <a
              key={item.key}
              href={item.href}
              className="inline-flex items-center gap-1.5 max-w-full rounded-full bg-base-200/55 px-2.5 py-1 text-xs text-base-content/70 hover:bg-base-200 hover:text-base-content transition-colors"
              title={item.label}
            >
              <item.icon className="w-3.5 h-3.5 shrink-0 text-base-content/45" aria-hidden />
              <span className="truncate">{item.label}</span>
            </a>
          ))}
        </div>
      ) : (
        <span className="text-xs text-base-content/40 flex-1">No contact details</span>
      )}
      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded-full border border-[#4829CC]/25 bg-[#4829CC]/8 px-3 py-1.5 text-xs font-medium text-[#4829CC] hover:bg-[#4829CC]/14 transition-colors disabled:opacity-40 disabled:pointer-events-none shrink-0"
        disabled={!group.chatUserId}
        title={group.chatUserId ? 'Open RMQ chat' : 'No RMQ account linked'}
        onClick={onMessage}
      >
        <ChatBubbleLeftRightIcon className="w-4 h-4" aria-hidden />
        Message
      </button>
    </div>
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
  const [periodScope, setPeriodScope] = useState<'month' | 'all'>('month');
  const [records, setRecords] = useState<ManualClockInApprovalRecord[]>([]);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [actingId, setActingId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(null);
  const [employeePickerOpen, setEmployeePickerOpen] = useState(false);
  const [expandedEmployeeIds, setExpandedEmployeeIds] = useState<Set<number>>(() => new Set());
  const [bulkActionMode, setBulkActionMode] = useState<'approve' | 'decline' | null>(null);
  const [selectedRecordIds, setSelectedRecordIds] = useState<Set<number>>(() => new Set());
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [rmqOpen, setRmqOpen] = useState(false);
  const [rmqChatUserId, setRmqChatUserId] = useState<string | null>(null);
  const searchWrapRef = useRef<HTMLDivElement>(null);

  const yearOptions = useMemo(() => {
    const y = now.getFullYear();
    return [y - 2, y - 1, y, y + 1];
  }, [now]);

  const loadRecords = useCallback(async () => {
    setLoadingRecords(true);
    try {
      const rows =
        periodScope === 'all'
          ? await fetchAllUnapprovedManualClockInsForApproval()
          : await fetchAllManualClockInsForApproval(year, month);
      setRecords(rows);
    } catch (err) {
      console.error('ManualClockInApprovalModal records:', err);
      toast.error('Failed to load manual clock-in entries');
      setRecords([]);
    } finally {
      setLoadingRecords(false);
    }
  }, [periodScope, year, month]);

  useEffect(() => {
    if (!isOpen) return;
    setSearchQuery('');
    setSelectedEmployeeId(null);
    setEmployeePickerOpen(false);
    setExpandedEmployeeIds(new Set());
    setPeriodScope('month');
    setBulkActionMode(null);
    setSelectedRecordIds(new Set());
    setRmqOpen(false);
    setRmqChatUserId(null);
    void loadRecords();
  }, [isOpen, loadRecords]);

  useEffect(() => {
    setExpandedEmployeeIds(new Set());
    setBulkActionMode(null);
    setSelectedRecordIds(new Set());
  }, [year, month, periodScope]);

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
          email: record.employee_email ?? null,
          phone: record.employee_phone ?? null,
          mobile: record.employee_mobile ?? null,
          chatUserId: record.employee_chat_user_id ?? null,
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

  const pendingSelectableRecords = useMemo(() => {
    const rows: ManualClockInApprovalRecord[] = [];
    for (const group of visibleGroups) {
      for (const record of group.records) {
        if (getClockInApprovalStatus(record) === 'pending') {
          rows.push(record);
        }
      }
    }
    return rows.sort(
      (a, b) => new Date(a.clock_in_time).getTime() - new Date(b.clock_in_time).getTime(),
    );
  }, [visibleGroups]);

  const allPendingSelected =
    pendingSelectableRecords.length > 0
    && pendingSelectableRecords.every((record) => selectedRecordIds.has(record.id));

  const somePendingSelected =
    pendingSelectableRecords.some((record) => selectedRecordIds.has(record.id))
    && !allPendingSelected;

  const enterBulkMode = (mode: 'approve' | 'decline') => {
    setExpandedEmployeeIds(new Set());
    setSelectedRecordIds(new Set());
    setBulkActionMode(mode);
  };

  const exitBulkMode = () => {
    setBulkActionMode(null);
    setSelectedRecordIds(new Set());
  };

  const toggleRecordSelected = (recordId: number) => {
    setSelectedRecordIds((prev) => {
      const next = new Set(prev);
      if (next.has(recordId)) next.delete(recordId);
      else next.add(recordId);
      return next;
    });
  };

  const toggleSelectAllPending = () => {
    if (allPendingSelected) {
      setSelectedRecordIds(new Set());
      return;
    }
    setSelectedRecordIds(new Set(pendingSelectableRecords.map((record) => record.id)));
  };

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

  const handleBulkApprove = async () => {
    if (!user?.id || selectedRecordIds.size === 0) return;
    setBulkProcessing(true);
    const ids = [...selectedRecordIds];
    let approvedCount = 0;
    let failedCount = 0;

    for (const recordId of ids) {
      try {
        await approveClockInRecord(recordId, user.id);
        approvedCount += 1;
        setRecords((prev) => prev.filter((r) => r.id !== recordId));
      } catch (err) {
        console.error('Bulk approve clock-in:', err);
        failedCount += 1;
      }
    }

    setSelectedRecordIds(new Set());
    setBulkActionMode(null);
    onUpdated?.();

    if (failedCount === 0) {
      toast.success(
        `Approved ${approvedCount} entr${approvedCount === 1 ? 'y' : 'ies'}.`,
      );
    } else if (approvedCount > 0) {
      toast.error(`Approved ${approvedCount}, failed ${failedCount}.`);
      await loadRecords();
    } else {
      toast.error('Failed to approve selected entries.');
      await loadRecords();
    }

    setBulkProcessing(false);
  };

  const handleBulkDecline = async () => {
    if (!user?.id || selectedRecordIds.size === 0) return;
    setBulkProcessing(true);
    const ids = [...selectedRecordIds];
    let declinedCount = 0;
    let failedCount = 0;

    for (const recordId of ids) {
      try {
        await declineClockInRecord(recordId, user.id);
        declinedCount += 1;
      } catch (err) {
        console.error('Bulk decline clock-in:', err);
        failedCount += 1;
      }
    }

    setSelectedRecordIds(new Set());
    setBulkActionMode(null);
    onUpdated?.();

    if (failedCount === 0) {
      toast.success(
        `Declined ${declinedCount} entr${declinedCount === 1 ? 'y' : 'ies'}.`,
      );
      await loadRecords();
    } else if (declinedCount > 0) {
      toast.error(`Declined ${declinedCount}, failed ${failedCount}.`);
      await loadRecords();
    } else {
      toast.error('Failed to decline selected entries.');
      await loadRecords();
    }

    setBulkProcessing(false);
  };

  const selectEmployee = (group: EmployeeGroup) => {
    setSelectedEmployeeId(group.employeeId);
    setSearchQuery(group.employeeName);
    setEmployeePickerOpen(false);
    setExpandedEmployeeIds(new Set([group.employeeId]));
  };

  const clearEmployeeFilter = () => {
    setSelectedEmployeeId(null);
    setSearchQuery('');
    setEmployeePickerOpen(false);
  };

  const toggleEmployeeExpanded = (employeeId: number) => {
    setExpandedEmployeeIds((prev) => {
      const next = new Set(prev);
      if (next.has(employeeId)) next.delete(employeeId);
      else next.add(employeeId);
      return next;
    });
  };

  const openEmployeeChat = (group: EmployeeGroup) => {
    if (!group.chatUserId) {
      toast.error('No RMQ account linked for this employee');
      return;
    }
    setRmqChatUserId(group.chatUserId);
    setRmqOpen(true);
  };

  if (!isOpen || typeof window === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex flex-col bg-base-100"
      role="dialog"
      aria-modal="true"
      aria-labelledby="manual-clock-approval-title"
    >
        <div className="flex items-start justify-between gap-4 px-5 py-4 shrink-0 bg-base-100">
          <div>
            <h2 id="manual-clock-approval-title" className="text-xl font-bold flex items-center gap-2">
              <ClipboardDocumentCheckIcon className="w-6 h-6 text-primary" />
              Manual clock-in approval
            </h2>
            <p className="text-sm text-base-content/60 mt-1">
              {periodScope === 'all' ? 'All periods' : `${MONTH_NAMES[month - 1]} ${year}`}
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
          <div className="form-control w-64 max-w-full shrink-0" ref={searchWrapRef}>
            <label className="label py-0 pb-1">
              <span className="label-text text-xs font-medium">Employee</span>
            </label>
            <div className="relative">
              <MagnifyingGlassIcon
                className="w-4 h-4 text-base-content/45 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none z-10"
                aria-hidden
              />
              <input
                type="text"
                className="input input-bordered input-sm w-full h-10 rounded-full pl-10 pr-9 bg-white"
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
                <ul className="absolute z-20 mt-1.5 w-full min-w-[16rem] max-h-56 overflow-auto rounded-2xl border border-base-200 bg-base-100 shadow-lg py-1">
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
              disabled={periodScope === 'all'}
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
              disabled={periodScope === 'all'}
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          <div className="form-control w-28">
            <label className="label py-0 pb-1">
              <span className="label-text text-xs font-medium">Period</span>
            </label>
            <select
              className="select select-bordered select-sm w-full"
              value={periodScope}
              onChange={(e) => setPeriodScope(e.target.value as 'month' | 'all')}
            >
              <option value="month">Month</option>
              <option value="all">All</option>
            </select>
          </div>
          <div className="flex flex-wrap items-end justify-end gap-2 ml-auto shrink-0 pb-0.5">
            {!bulkActionMode ? (
              <>
                <button
                  type="button"
                  className={BULK_APPROVE_TRIGGER_CLASS}
                  disabled={totalPending === 0 || loadingRecords}
                  onClick={() => enterBulkMode('approve')}
                >
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-600/12">
                    <CheckIcon className="w-4 h-4 stroke-[2.5]" aria-hidden />
                  </span>
                  Approve all
                </button>
                <button
                  type="button"
                  className={BULK_DECLINE_TRIGGER_CLASS}
                  disabled={totalPending === 0 || loadingRecords}
                  onClick={() => enterBulkMode('decline')}
                >
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-red-600/10">
                    <XMarkIcon className="w-4 h-4 stroke-[2.5]" aria-hidden />
                  </span>
                  Decline all
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className={BULK_CANCEL_CLASS}
                  disabled={bulkProcessing}
                  onClick={exitBulkMode}
                >
                  Cancel
                </button>
                {bulkActionMode === 'approve' ? (
                  <button
                    type="button"
                    className={BULK_APPROVE_CONFIRM_CLASS}
                    disabled={selectedRecordIds.size === 0 || bulkProcessing}
                    onClick={() => void handleBulkApprove()}
                  >
                    {bulkProcessing ? (
                      <span className="loading loading-spinner loading-xs" />
                    ) : (
                      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/20">
                        <CheckIcon className="w-4 h-4 stroke-[2.5]" aria-hidden />
                      </span>
                    )}
                    Approve selected ({selectedRecordIds.size})
                  </button>
                ) : (
                  <button
                    type="button"
                    className={BULK_DECLINE_CONFIRM_CLASS}
                    disabled={selectedRecordIds.size === 0 || bulkProcessing}
                    onClick={() => void handleBulkDecline()}
                  >
                    {bulkProcessing ? (
                      <span className="loading loading-spinner loading-xs" />
                    ) : (
                      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/20">
                        <XMarkIcon className="w-4 h-4 stroke-[2.5]" aria-hidden />
                      </span>
                    )}
                    Decline selected ({selectedRecordIds.size})
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4 space-y-5 min-h-0 bg-[#ececec]">
          {loadingRecords ? (
            <div className="flex justify-center py-16">
              <span className="loading loading-spinner loading-lg text-primary" />
            </div>
          ) : bulkActionMode ? (
            pendingSelectableRecords.length === 0 ? (
              <div className="text-center py-16 text-base-content/50">
                {bulkActionMode === 'approve'
                  ? 'No pending entries to approve.'
                  : 'No pending entries to decline.'}
              </div>
            ) : (
              <div className="manual-clock-approval-table-shell overflow-x-auto pb-1">
                <table className="table manual-clock-approval-results-table w-full min-w-[52rem] text-sm">
                  <thead>
                    <tr>
                      <th className="w-12 px-5 py-3.5 text-left">
                        <input
                          type="checkbox"
                          className="checkbox checkbox-sm checkbox-primary rounded"
                          checked={allPendingSelected}
                          ref={(input) => {
                            if (input) input.indeterminate = somePendingSelected;
                          }}
                          onChange={toggleSelectAllPending}
                          aria-label="Select all pending entries"
                        />
                      </th>
                      <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-base-content/40">
                        Employee
                      </th>
                      <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-base-content/40">
                        Date
                      </th>
                      <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-base-content/40">
                        Clock in
                      </th>
                      <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-base-content/40">
                        Clock out
                      </th>
                      <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-base-content/40">
                        Workplace in
                      </th>
                      <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-base-content/40">
                        Workplace out
                      </th>
                      <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-base-content/40">
                        Notes
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingSelectableRecords.map((record) => {
                      const dateKey = record.clock_in_time.split('T')[0];
                      const isSelected = selectedRecordIds.has(record.id);
                      return (
                        <tr
                          key={record.id}
                          className="cursor-pointer"
                          onClick={() => toggleRecordSelected(record.id)}
                        >
                          <td className="px-5 py-4" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              className="checkbox checkbox-sm checkbox-primary rounded"
                              checked={isSelected}
                              onChange={() => toggleRecordSelected(record.id)}
                              aria-label={`Select entry for ${record.employee_name}`}
                            />
                          </td>
                          <td className="px-5 py-4 font-medium whitespace-nowrap">
                            {record.employee_name}
                          </td>
                          <td className="whitespace-nowrap px-5 py-4">
                            <span
                              className={CLOCK_IN_DATE_BADGE_CLASS}
                              style={{ backgroundColor: CLOCK_IN_DATE_BADGE_BG }}
                            >
                              {unavailabilityDateLabel(dateKey)}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-5 py-4">
                            {formatClockTime(record.clock_in_time)}
                          </td>
                          <td className="whitespace-nowrap px-5 py-4">
                            {record.clock_out_time
                              ? formatClockTime(record.clock_out_time)
                              : '—'}
                          </td>
                          <td className="text-sm max-w-[120px] truncate px-5 py-4">
                            {manualClockInWorkplaceLabel(record, 'in')}
                          </td>
                          <td className="text-sm max-w-[120px] truncate px-5 py-4">
                            {record.clock_out_time
                              ? manualClockInWorkplaceLabel(record, 'out')
                              : '—'}
                          </td>
                          <td className="text-sm max-w-[140px] truncate text-base-content/70 px-5 py-4">
                            {record.notes?.trim() || '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          ) : visibleGroups.length === 0 ? (
            <div className="text-center py-16 text-base-content/50">
              {actionableRecords.length === 0
                ? periodScope === 'all'
                  ? 'No unapproved manual clock-in entries.'
                  : 'No pending manual clock-in entries for this period.'
                : 'No employees match your search.'}
            </div>
          ) : (
            visibleGroups.map((group) => {
              const isExpanded = expandedEmployeeIds.has(group.employeeId);
              return (
              <section key={group.employeeId} className="space-y-3">
                <div className="rounded-[18px] bg-white px-4 py-3 shadow-sm">
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 text-left"
                    onClick={() => toggleEmployeeExpanded(group.employeeId)}
                    aria-expanded={isExpanded}
                    aria-controls={`manual-clock-approval-table-${group.employeeId}`}
                  >
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
                    <ChevronDownIcon
                      className={`w-5 h-5 shrink-0 text-base-content/40 transition-transform duration-200 ${
                        isExpanded ? 'rotate-180' : ''
                      }`}
                      aria-hidden
                    />
                  </button>
                  <EmployeeContactBar
                    group={group}
                    onMessage={() => openEmployeeChat(group)}
                  />
                </div>

                {isExpanded && (
                <div
                  id={`manual-clock-approval-table-${group.employeeId}`}
                  className="manual-clock-approval-table-shell overflow-x-auto pb-1"
                >
                  <table className="table manual-clock-approval-results-table w-full min-w-[48rem] text-sm">
                    <thead>
                      <tr>
                        <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-base-content/40">
                          Date
                        </th>
                        <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-base-content/40">
                          Clock in
                        </th>
                        <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-base-content/40">
                          Clock out
                        </th>
                        <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-base-content/40">
                          Workplace in
                        </th>
                        <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-base-content/40">
                          Workplace out
                        </th>
                        <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-base-content/40">
                          Notes
                        </th>
                        <th
                          className="w-24 px-5 py-3.5 text-right text-xs font-semibold uppercase tracking-wider text-base-content/40"
                          aria-label="Actions"
                        />
                      </tr>
                    </thead>
                    <tbody>
                      {group.records.map((record) => {
                        const status = getClockInApprovalStatus(record);
                        const dateKey = record.clock_in_time.split('T')[0];
                        const isActing = actingId === record.id;
                        const isDeclined = status === 'declined';

                        return (
                          <tr
                            key={record.id}
                            className={isDeclined ? 'manual-clock-approval-row-declined' : undefined}
                          >
                            <td className="whitespace-nowrap px-5 py-4">
                              <span
                                className={CLOCK_IN_DATE_BADGE_CLASS}
                                style={{ backgroundColor: CLOCK_IN_DATE_BADGE_BG }}
                              >
                                {unavailabilityDateLabel(dateKey)}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-5 py-4">
                              {formatClockTime(record.clock_in_time)}
                            </td>
                            <td className="whitespace-nowrap px-5 py-4">
                              {record.clock_out_time
                                ? formatClockTime(record.clock_out_time)
                                : '—'}
                            </td>
                            <td className="text-sm max-w-[120px] truncate px-5 py-4">
                              {manualClockInWorkplaceLabel(record, 'in')}
                            </td>
                            <td className="text-sm max-w-[120px] truncate px-5 py-4">
                              {record.clock_out_time
                                ? manualClockInWorkplaceLabel(record, 'out')
                                : '—'}
                            </td>
                            <td className="text-sm max-w-[140px] truncate text-base-content/70 px-5 py-4">
                              {record.notes?.trim() || '—'}
                            </td>
                            <td className="text-right whitespace-nowrap px-5 py-4">
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
                )}
              </section>
            );
            })
          )}
        </div>

        <style>{MANUAL_CLOCK_APPROVAL_TABLE_STYLES}</style>

        <RMQMessagesPage
          isOpen={rmqOpen}
          initialUserId={rmqChatUserId || undefined}
          onClose={() => {
            setRmqOpen(false);
            setRmqChatUserId(null);
          }}
        />
    </div>,
    document.body,
  );
};

export default ManualClockInApprovalModal;
