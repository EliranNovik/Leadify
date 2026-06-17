import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CheckIcon,
  XMarkIcon,
  ClipboardDocumentCheckIcon,
  MagnifyingGlassIcon,
  UserIcon,
  ChevronDownIcon,
  ChatBubbleLeftRightIcon,
  EnvelopeIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import { useAuthContext } from '../contexts/AuthContext';
import { formatClockTime } from '../lib/employeeClockInFormat';
import { unavailabilityDateLabel } from '../lib/employeeUnavailabilities';
import RMQMessagesPage from '../pages/RMQMessagesPage';
import {
  approveClockInRecord,
  countPendingApprovalBuckets,
  declineClockInRecord,
  fetchActiveClockInsByEmployeeIds,
  fetchAllManualClockInsForApproval,
  fetchAllUnapprovedManualClockInsForApproval,
  filterManualApprovalModalRecords,
  getClockInApprovalStatus,
  isHomeWfhApprovalRequest,
  manualClockInWorkplaceLabel,
  type ManualClockInApprovalRecord,
} from '../lib/employeeClockInApproval';
import { useManualClockInApprovalLiveRefresh } from '../hooks/useManualClockInApprovalLiveRefresh';

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

const WFH_PENDING_HEADER_BADGE_CLASS =
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold shrink-0 bg-orange-100 text-orange-800 border border-orange-200/80';

const CLOCK_PENDING_HEADER_BADGE_CLASS =
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold shrink-0 bg-emerald-200 text-emerald-950 border border-emerald-300/80';

const WFH_PENDING_FILTER_BTN_CLASS =
  'inline-flex items-center rounded-full px-3.5 py-1.5 text-sm font-semibold shrink-0 bg-orange-100 text-orange-800 border border-orange-200/80 cursor-pointer transition-all hover:bg-orange-200/90 hover:border-orange-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:ring-offset-1';

const CLOCK_PENDING_FILTER_BTN_CLASS =
  'inline-flex items-center rounded-full px-3.5 py-1.5 text-sm font-semibold shrink-0 text-white cursor-pointer transition-opacity hover:opacity-85 active:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1';

const CLOCK_IN_DATE_BADGE_COLOR = 'rgb(25, 49, 31)';

const WFH_PENDING_FILTER_BTN_ACTIVE_CLASS =
  'ring-2 ring-orange-400 ring-offset-1 bg-orange-200 border-orange-300';

const CLOCK_PENDING_FILTER_BTN_ACTIVE_CLASS =
  'ring-2 ring-offset-1 opacity-90';

type PendingApprovalFilter = 'all' | 'wfh' | 'clock';

function matchesPendingTypeFilter(
  record: ManualClockInApprovalRecord,
  filter: PendingApprovalFilter,
): boolean {
  if (filter === 'all') return true;
  const isWfh = isHomeWfhApprovalRequest(record);
  return filter === 'wfh' ? isWfh : !isWfh;
}

function applyPendingTypeFilterToGroups(
  groups: EmployeeGroup[],
  filter: PendingApprovalFilter,
): EmployeeGroup[] {
  if (filter === 'all') return groups;
  return groups
    .map((group) => {
      const records = group.records.filter((record) =>
        matchesPendingTypeFilter(record, filter),
      );
      const pendingCount = records.filter(
        (record) => getClockInApprovalStatus(record) === 'pending',
      ).length;
      return { ...group, records, pendingCount };
    })
    .filter((group) => group.pendingCount > 0);
}

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
const HOME_WFH_DATE_BADGE_BG = 'rgb(217, 119, 6)';

const HOME_WFH_SUMMARY_BADGE_CLASS =
  'inline-flex items-center rounded-full bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-600 whitespace-nowrap';

function approvalDateBadgeBg(record: ManualClockInApprovalRecord): string {
  return isHomeWfhApprovalRequest(record) ? HOME_WFH_DATE_BADGE_BG : CLOCK_IN_DATE_BADGE_BG;
}

function homeWfhApprovalSummary(record: ManualClockInApprovalRecord): string {
  return `Home access requested at ${formatClockTime(record.clock_in_time)}.`;
}

function HomeWfhApprovalSummaryBadge({ record }: { record: ManualClockInApprovalRecord }) {
  return (
    <span className={HOME_WFH_SUMMARY_BADGE_CLASS}>
      {homeWfhApprovalSummary(record)}
    </span>
  );
}

function approvalClockOutTime(record: ManualClockInApprovalRecord): string {
  return record.clock_out_time ? formatClockTime(record.clock_out_time) : '—';
}

function approvalWorkplaceOut(record: ManualClockInApprovalRecord): string {
  return record.clock_out_time ? manualClockInWorkplaceLabel(record, 'out') : '—';
}

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

function EmployeeClockStatusBadge({ clockInTime }: { clockInTime?: string | null }) {
  if (clockInTime) {
    return (
      <span className="inline-flex items-center rounded-full px-2.5 py-0.5 md:px-3 md:py-1 text-xs md:text-sm font-medium shrink-0 bg-green-100/90 text-green-800 whitespace-nowrap">
        Clocked in · since {formatClockTime(clockInTime)}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full px-2.5 py-0.5 md:px-3 md:py-1 text-xs md:text-sm font-medium shrink-0 bg-gray-100 text-gray-500 whitespace-nowrap">
      Clocked out
    </span>
  );
}

function EmployeeAvatar({
  name,
  photoUrl,
  size = 'md',
}: {
  name: string;
  photoUrl?: string | null;
  size?: 'sm' | 'md' | 'lg';
}) {
  const dim =
    size === 'sm' ? 'w-8 h-8 text-xs' : size === 'lg' ? 'w-16 h-16 text-lg' : 'w-12 h-12 text-base';
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


function EmployeeMessageButton({
  chatUserId,
  onMessage,
}: {
  chatUserId: string | null;
  onMessage: () => void;
}) {
  return (
    <button
      type="button"
      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#4829CC]/25 bg-[#4829CC]/8 text-[#4829CC] hover:bg-[#4829CC]/14 transition-colors disabled:opacity-40 disabled:pointer-events-none shrink-0"
      disabled={!chatUserId}
      title={chatUserId ? 'Open RMQ chat' : 'No RMQ account linked'}
      aria-label="Open RMQ chat"
      onClick={(e) => {
        e.stopPropagation();
        onMessage();
      }}
    >
      <ChatBubbleLeftRightIcon className="w-[18px] h-[18px]" aria-hidden />
    </button>
  );
}

function EmployeeEmailButton({ email }: { email: string | null }) {
  if (!email) return null;
  return (
    <a
      href={`mailto:${email}`}
      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-base-content/15 bg-base-200/60 text-base-content/50 hover:bg-base-200 hover:text-base-content transition-colors shrink-0"
      title={`Email ${email}`}
      aria-label={`Send email to ${email}`}
      onClick={(e) => e.stopPropagation()}
    >
      <EnvelopeIcon className="w-[18px] h-[18px]" aria-hidden />
    </a>
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
  const [pendingTypeFilter, setPendingTypeFilter] = useState<PendingApprovalFilter>('all');
  const [bulkActionMode, setBulkActionMode] = useState<'approve' | 'decline' | null>(null);
  const [selectedRecordIds, setSelectedRecordIds] = useState<Set<number>>(() => new Set());
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [rmqOpen, setRmqOpen] = useState(false);
  const [rmqChatUserId, setRmqChatUserId] = useState<string | null>(null);
  const [activeClockIns, setActiveClockIns] = useState<Map<number, string>>(() => new Map());
  const searchWrapRef = useRef<HTMLDivElement>(null);

  const yearOptions = useMemo(() => {
    const y = now.getFullYear();
    return [y - 2, y - 1, y, y + 1];
  }, [now]);

  const loadRecordsSilent = useCallback(async () => {
    try {
      const rows =
        periodScope === 'all'
          ? await fetchAllUnapprovedManualClockInsForApproval()
          : await fetchAllManualClockInsForApproval(year, month);
      setRecords(rows);
    } catch (err) {
      console.error('ManualClockInApprovalModal records:', err);
    }
  }, [periodScope, year, month]);

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

  useManualClockInApprovalLiveRefresh({
    enabled: isOpen,
    channelSuffix: 'modal',
    onChange: loadRecordsSilent,
  });

  useEffect(() => {
    if (!isOpen) return;
    setSearchQuery('');
    setSelectedEmployeeId(null);
    setEmployeePickerOpen(false);
    setExpandedEmployeeIds(new Set());
    setPendingTypeFilter('all');
    setPeriodScope('month');
    setBulkActionMode(null);
    setSelectedRecordIds(new Set());
    setRmqOpen(false);
    setRmqChatUserId(null);
    setActiveClockIns(new Map());
    void loadRecords();
  }, [isOpen, loadRecords]);

  useEffect(() => {
    setExpandedEmployeeIds(new Set());
    setPendingTypeFilter('all');
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
    () => filterManualApprovalModalRecords(records),
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
      .filter((group) => group.pendingCount > 0)
      .sort((a, b) => a.employeeName.localeCompare(b.employeeName));
  }, [actionableRecords]);

  const employeeIdsForClockStatus = useMemo(
    () => employeeGroups.map((group) => group.employeeId),
    [employeeGroups],
  );

  useEffect(() => {
    if (!isOpen || employeeIdsForClockStatus.length === 0) {
      setActiveClockIns(new Map());
      return;
    }
    let cancelled = false;
    void fetchActiveClockInsByEmployeeIds(employeeIdsForClockStatus)
      .then((map) => {
        if (!cancelled) setActiveClockIns(map);
      })
      .catch((err) => {
        console.error('ManualClockInApprovalModal active clock-ins:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, employeeIdsForClockStatus]);

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

  const baseVisibleGroups = useMemo(() => {
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

  const visibleGroups = useMemo(
    () => applyPendingTypeFilterToGroups(baseVisibleGroups, pendingTypeFilter),
    [baseVisibleGroups, pendingTypeFilter],
  );

  const { wfh: pendingWfhCount, clock: pendingClockCount } = useMemo(
    () => countPendingApprovalBuckets(actionableRecords),
    [actionableRecords],
  );

  const totalPending = pendingWfhCount + pendingClockCount;

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
    const isWfh = isHomeWfhApprovalRequest(
      records.find((r) => r.id === recordId) ?? { notes: null },
    );
    setRecords((prev) => prev.filter((r) => r.id !== recordId));
    try {
      await approveClockInRecord(recordId, user.id);
      toast.success(isWfh ? 'Home access granted' : 'Entry approved');
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
      const result = await declineClockInRecord(recordId, user.id);
      toast.success(result === 'removed' ? 'Home access request removed' : 'Entry declined');
      setRecords((prev) => prev.filter((r) => r.id !== recordId));
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
        const result = await declineClockInRecord(recordId, user.id);
        declinedCount += 1;
        if (result === 'removed') {
          setRecords((prev) => prev.filter((r) => r.id !== recordId));
        }
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
      const hasRegularDeclines = ids.some((id) => {
        const record = records.find((r) => r.id === id);
        return record && !isHomeWfhApprovalRequest(record);
      });
      if (hasRegularDeclines) {
        await loadRecords();
      }
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

  const togglePendingTypeFilter = (type: 'wfh' | 'clock') => {
    const nextFilter: PendingApprovalFilter = pendingTypeFilter === type ? 'all' : type;
    setPendingTypeFilter(nextFilter);
    setBulkActionMode(null);
    setSelectedRecordIds(new Set());

    if (nextFilter === 'all') {
      setExpandedEmployeeIds(new Set());
      return;
    }

    const matchingGroups = applyPendingTypeFilterToGroups(baseVisibleGroups, nextFilter);
    setExpandedEmployeeIds(new Set(matchingGroups.map((group) => group.employeeId)));
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
          <div className="form-control w-full sm:w-auto">
            <label className="label py-0 pb-1">
              <span className="label-text text-xs font-medium">Pending</span>
            </label>
            <div className="flex flex-wrap items-center gap-2 min-h-[2rem]">
              {pendingWfhCount > 0 && (
                <button
                  type="button"
                  className={`${WFH_PENDING_FILTER_BTN_CLASS} ${
                    pendingTypeFilter === 'wfh' ? WFH_PENDING_FILTER_BTN_ACTIVE_CLASS : ''
                  }`}
                  aria-pressed={pendingTypeFilter === 'wfh'}
                  onClick={() => togglePendingTypeFilter('wfh')}
                >
                  {pendingWfhCount} work from home
                </button>
              )}
              {pendingClockCount > 0 && (
                <button
                  type="button"
                  className={`${CLOCK_PENDING_FILTER_BTN_CLASS} ${
                    pendingTypeFilter === 'clock' ? CLOCK_PENDING_FILTER_BTN_ACTIVE_CLASS : ''
                  }`}
                  style={{ backgroundColor: CLOCK_IN_DATE_BADGE_COLOR }}
                  aria-pressed={pendingTypeFilter === 'clock'} 
                  onClick={() => togglePendingTypeFilter('clock')}
                >
                  {pendingClockCount} clock in/out
                </button>
              )}
              {pendingWfhCount === 0 && pendingClockCount === 0 && (
                <span className="text-xs text-base-content/45">No pending entries</span>
              )}
            </div>
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
                      const isHomeWfh = isHomeWfhApprovalRequest(record);
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
                              style={{ backgroundColor: approvalDateBadgeBg(record) }}
                            >
                              {unavailabilityDateLabel(dateKey)}
                            </span>
                          </td>
                          {isHomeWfh ? (
                            <td className="px-5 py-4" colSpan={5}>
                              <HomeWfhApprovalSummaryBadge record={record} />
                            </td>
                          ) : (
                            <>
                              <td className="whitespace-nowrap px-5 py-4">
                                {formatClockTime(record.clock_in_time)}
                              </td>
                              <td className="whitespace-nowrap px-5 py-4">
                                {approvalClockOutTime(record)}
                              </td>
                              <td className="text-sm max-w-[120px] truncate px-5 py-4">
                                {manualClockInWorkplaceLabel(record, 'in')}
                              </td>
                              <td className="text-sm max-w-[120px] truncate px-5 py-4">
                                {approvalWorkplaceOut(record)}
                              </td>
                              <td className="text-sm max-w-[140px] truncate text-base-content/70 px-5 py-4">
                                {record.notes?.trim() || '—'}
                              </td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          ) : visibleGroups.length === 0 ? (
            <div className="text-center py-16 text-base-content/50">
              {pendingTypeFilter === 'wfh'
                ? 'No pending work from home requests.'
                : pendingTypeFilter === 'clock'
                  ? 'No pending clock in/out entries.'
                  : actionableRecords.length === 0
                    ? periodScope === 'all'
                      ? 'No pending manual clock-in or work from home requests.'
                      : 'No pending manual clock-in entries for this period.'
                    : 'No employees match your search.'}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
            {visibleGroups.map((group) => {
              const isExpanded = expandedEmployeeIds.has(group.employeeId);
              const activeClockInTime = activeClockIns.get(group.employeeId) ?? null;
              const hasWfhPending = group.records.some(
                (r) => isHomeWfhApprovalRequest(r) && getClockInApprovalStatus(r) === 'pending',
              );
              return (
              <section key={group.employeeId} className="flex min-w-0 flex-col gap-3">
                <div
                  className="rounded-[18px] bg-white px-4 py-4 shadow-sm cursor-pointer"
                  onClick={() => toggleEmployeeExpanded(group.employeeId)}
                  role="button"
                  tabIndex={0}
                  aria-expanded={isExpanded}
                  aria-controls={`manual-clock-approval-table-${group.employeeId}`}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleEmployeeExpanded(group.employeeId);
                    }
                  }}
                >
                  <div className="flex w-full gap-3 text-left">
                    <EmployeeAvatar
                      name={group.employeeName}
                      photoUrl={group.photoUrl}
                      size="lg"
                    />
                    <div className="min-w-0 flex-1 flex flex-col gap-2">
                      {/* Name row */}
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="font-semibold text-base leading-snug min-w-0 truncate">
                          {group.employeeName}
                          <span className="font-medium text-base-content/50">{` - `}</span>
                          <span className="font-medium text-base-content/70">{group.department}</span>
                        </h3>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <EmployeeEmailButton email={group.email} />
                          <EmployeeMessageButton
                            chatUserId={group.chatUserId}
                            onMessage={() => openEmployeeChat(group)}
                          />
                          <ChevronDownIcon
                            className={`w-5 h-5 text-base-content/40 transition-transform duration-200 ${
                              isExpanded ? 'rotate-180' : ''
                            }`}
                            aria-hidden
                          />
                        </div>
                      </div>
                      {/* Status badges row */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        <EmployeeClockStatusBadge clockInTime={activeClockInTime} />
                        {hasWfhPending && (
                          <span className="inline-flex items-center rounded-full px-2.5 py-0.5 md:px-3 md:py-1 text-xs md:text-sm font-medium shrink-0 bg-orange-100 text-orange-800 whitespace-nowrap">
                            Waiting for home access
                          </span>
                        )}
                        {group.pendingCount > 0 ? (
                          <span className="inline-flex items-center rounded-full px-2.5 py-0.5 md:px-3 md:py-1 text-xs md:text-sm font-medium shrink-0 bg-amber-100/60 text-amber-800/70 whitespace-nowrap">
                            {group.pendingCount} pending
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full px-2.5 py-0.5 md:px-3 md:py-1 text-xs md:text-sm font-medium shrink-0 bg-base-200/50 text-base-content/40">
                            No pending
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {isExpanded && (
                <div
                  id={`manual-clock-approval-table-${group.employeeId}`}
                  className="manual-clock-approval-table-shell overflow-x-auto pb-1"
                >
                  <table className="table manual-clock-approval-results-table w-full min-w-[36rem] text-sm">
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
                        const isHomeWfh = isHomeWfhApprovalRequest(record);

                        return (
                          <tr
                            key={record.id}
                            className={isDeclined ? 'manual-clock-approval-row-declined' : undefined}
                          >
                            <td className="whitespace-nowrap px-5 py-4">
                              <span
                                className={CLOCK_IN_DATE_BADGE_CLASS}
                                style={{ backgroundColor: approvalDateBadgeBg(record) }}
                              >
                                {unavailabilityDateLabel(dateKey)}
                              </span>
                            </td>
                            {isHomeWfh ? (
                              <td className="px-5 py-4" colSpan={5}>
                                <HomeWfhApprovalSummaryBadge record={record} />
                              </td>
                            ) : (
                              <>
                                <td className="whitespace-nowrap px-5 py-4">
                                  {formatClockTime(record.clock_in_time)}
                                </td>
                                <td className="whitespace-nowrap px-5 py-4">
                                  {approvalClockOutTime(record)}
                                </td>
                                <td className="text-sm max-w-[120px] truncate px-5 py-4">
                                  {manualClockInWorkplaceLabel(record, 'in')}
                                </td>
                                <td className="text-sm max-w-[120px] truncate px-5 py-4">
                                  {approvalWorkplaceOut(record)}
                                </td>
                                <td className="text-sm max-w-[140px] truncate text-base-content/70 px-5 py-4">
                                  {record.notes?.trim() || '—'}
                                </td>
                              </>
                            )}
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
            })}
            </div>
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
