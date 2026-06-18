import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowDownTrayIcon,
  CalendarDaysIcon,
  CheckIcon,
  ClockIcon,
  FunnelIcon,
  PencilSquareIcon,
  PlusIcon,
  SquaresPlusIcon,
  BoltIcon,
  EllipsisVerticalIcon,
  TrashIcon,
  XMarkIcon,
  ArrowUturnLeftIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import CompactAvailabilityCalendar, {
  type CompactAvailabilityCalendarRef,
} from '../CompactAvailabilityCalendar';
import {
  aggregateClockInRecordsByDay,
  buildMergedTimeAndUnavailabilityExportRows,
  exportMergedTimeAndUnavailabilitiesToExcel,
  type DailyClockInSummary,
} from '../../lib/workingHoursExport';
import {
  buildMonthWeekNumberLookup,
  dateRangeToIsoBounds,
  formatWorkingHoursDateLabel,
  formatWorkingHoursWeekday,
  getSundayWeekStartKey,
  monthRange,
  sumClockDurations,
  toDateInputValue,
} from '../../lib/employeeClockInFormat';
import {
  preloadHolidayYears,
} from '../../lib/israeliJewishHolidays';
import { deleteClockInSessions } from '../../lib/employeeClockInManual';
import { useAuthContext } from '../../contexts/AuthContext';
import {
  documentNameFromUrl,
  deleteUnavailabilityDay,
  expandUnavailabilitiesToDailyRows,
  fetchEmployeeUnavailabilitiesInRange,
  unavailabilityReasonText,
  unavailabilityTypeLabel,
  type EmployeeUnavailabilityDayRow,
  type EmployeeUnavailabilityEntry,
} from '../../lib/employeeUnavailabilities';
import UnavailabilityTypeBadge from '../UnavailabilityTypeBadge';
import DocumentViewerModal from '../DocumentViewerModal';
import { DocumentFileGlyph } from '../../lib/documentFileGlyphs';
import UnavailabilityDayEditModal from './UnavailabilityDayEditModal';
import ManualClockInModal from './ManualClockInModal';
import BulkManualClockInModal from './BulkManualClockInModal';
import ClockInDayEditModal from './ClockInDayEditModal';
import SubmitWorkingHoursModal from './SubmitWorkingHoursModal';
import YearWheelPicker from '../YearWheelPicker';
import { buildWorkingHoursMonthCoverage, type WorkingHoursDayCoverage } from '../../lib/workingHoursMonthCoverage';
import {
  cancelWorkingHoursSubmission,
  fetchWorkingHoursSubmission,
  type EmployeeWorkingHoursSubmission,
} from '../../lib/employeeWorkingHoursSubmissions';
import {
  clockInApprovalRowClass,
  clockInApprovalLabelClass,
  countClockInApprovalBlockers,
  clockInApprovalSubmitBlockMessage,
  filterCountedClockInRecords,
  getClockInApprovalStatus,
  getDayClockInApprovalStatus,
  clockInApprovalWatermarkLabel,
  isManualClockInRecord,
  normalizeClockInApprovalFields,
} from '../../lib/employeeClockInApproval';

type ClockInRow = {
  id: number;
  employee_id: number;
  clock_in_time: string;
  clock_out_time: string | null;
  is_active: boolean;
  clock_in_location_id: number | null;
  clock_out_location_id: number | null;
  clock_in_place?: { name: string } | { name: string }[] | null;
  clock_out_place?: { name: string } | { name: string }[] | null;
  notes: string | null;
  manually: boolean;
  approved: boolean;
  declined: boolean;
};

interface WorkingHoursTabProps {
  employeeId: number;
  employeeName?: string;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const MERGED_COL_SPAN = 10;
const WEEK_COL_SPAN = 1;

type WorkingHoursWeekRowMeta = {
  weekNum: number;
  isFirstInWeek: boolean;
  weekRowSpan: number;
};

function buildWorkingHoursWeekRowMeta<T extends { dateKey: string }>(
  rows: T[],
  weekLookup: Map<string, number>,
): Map<string, WorkingHoursWeekRowMeta> {
  const meta = new Map<string, WorkingHoursWeekRowMeta>();
  let currentWeek = -1;
  let weekStartIndex = 0;

  rows.forEach((row, index) => {
    const weekNum = weekLookup.get(getSundayWeekStartKey(row.dateKey)) ?? 1;
    if (weekNum !== currentWeek) {
      if (currentWeek !== -1) {
        const span = index - weekStartIndex;
        for (let i = weekStartIndex; i < index; i += 1) {
          const existing = meta.get(rows[i].dateKey);
          if (existing) {
            meta.set(rows[i].dateKey, {
              ...existing,
              isFirstInWeek: i === weekStartIndex,
              weekRowSpan: span,
            });
          }
        }
      }
      currentWeek = weekNum;
      weekStartIndex = index;
    }
    meta.set(row.dateKey, {
      weekNum,
      isFirstInWeek: false,
      weekRowSpan: 1,
    });
  });

  if (rows.length > 0 && currentWeek !== -1) {
    const span = rows.length - weekStartIndex;
    for (let i = weekStartIndex; i < rows.length; i += 1) {
      const existing = meta.get(rows[i].dateKey);
      if (existing) {
        meta.set(rows[i].dateKey, {
          ...existing,
          isFirstInWeek: i === weekStartIndex,
          weekRowSpan: span,
        });
      }
    }
  }

  return meta;
}

const WEEK_SIDE_COLORS = [
  '#3b82f6',
  '#10b981',
  '#8b5cf6',
  '#f59e0b',
  '#e11d48',
  '#0891b2',
] as const;

function getWeekAccentColor(weekNum: number): string {
  return WEEK_SIDE_COLORS[(weekNum - 1) % WEEK_SIDE_COLORS.length];
}

function WorkingHoursWeekDividerCell({
  weekNum,
  rowSpan,
}: {
  weekNum: number;
  rowSpan: number;
}) {
  const accent = getWeekAccentColor(weekNum);
  return (
    <td
      rowSpan={rowSpan}
      className="wh-week-divider-cell align-top"
      style={{ '--wh-week-accent': accent } as React.CSSProperties}
    >
      <div className="wh-week-divider-line" aria-hidden />
      <span className="wh-week-divider-label">Week {weekNum}</span>
    </td>
  );
}

function WorkingHoursWeekBetweenRow({
  weekNum,
  colSpan,
}: {
  weekNum: number;
  colSpan: number;
}) {
  const accent = getWeekAccentColor(weekNum);
  return (
    <tr className="wh-week-between-row">
      <td
        colSpan={colSpan}
        className="wh-week-between-cell"
        style={{ '--wh-week-accent': accent } as React.CSSProperties}
      >
        <div className="wh-week-between-inner">
          <span className="wh-week-between-line" aria-hidden />
          <span className="wh-week-between-label">Week {weekNum}</span>
          <span className="wh-week-between-line" aria-hidden />
        </div>
      </td>
    </tr>
  );
}

function WorkingHoursDateLabel({
  dateKey,
  muted = false,
}: {
  dateKey: string;
  muted?: boolean;
}) {
  return (
    <span className={`whitespace-nowrap ${muted ? 'text-base-content/45' : ''}`}>
      <span className="font-semibold text-base-content/50">{formatWorkingHoursWeekday(dateKey)}</span>
      <span className="mx-1.5 text-base-content/30" aria-hidden>·</span>
      {formatWorkingHoursDateLabel(dateKey)}
    </span>
  );
}

const SUBMIT_HOURS_BTN_CLASS =
  'inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold border-0 shadow-sm transition-all duration-200 bg-gradient-to-r from-emerald-600 to-teal-600 text-white hover:from-emerald-700 hover:to-teal-700 hover:shadow-md active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none disabled:shadow-none';

const CANCEL_SUBMISSION_BTN_CLASS =
  'inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold border-0 shadow-sm transition-all duration-200 bg-amber-50 text-amber-900 hover:bg-amber-100 hover:shadow-md active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none disabled:shadow-none';

type WorkingHoursRowFilter = 'approved' | 'declined' | 'pending' | 'unavailability' | 'clock';

const ROW_FILTER_OPTIONS: {
  id: WorkingHoursRowFilter;
  label: string;
  activeClass: string;
  idleClass: string;
}[] = [
  {
    id: 'approved',
    label: 'Approved',
    activeClass: 'bg-emerald-600 text-white border-emerald-600 shadow-sm',
    idleClass: 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100',
  },
  {
    id: 'declined',
    label: 'Declined',
    activeClass: 'bg-red-600 text-white border-red-600 shadow-sm',
    idleClass: 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100',
  },
  {
    id: 'pending',
    label: 'Waiting for approval',
    activeClass: 'bg-sky-600 text-white border-sky-600 shadow-sm',
    idleClass: 'bg-sky-50 text-sky-800 border-sky-200 hover:bg-sky-100',
  },
  {
    id: 'unavailability',
    label: 'Unavailabilities',
    activeClass: 'bg-violet-600 text-white border-violet-600 shadow-sm',
    idleClass: 'bg-violet-50 text-violet-800 border-violet-200 hover:bg-violet-100',
  },
  {
    id: 'clock',
    label: 'Clock in & out',
    activeClass: 'bg-primary text-primary-content border-primary shadow-sm',
    idleClass: 'bg-primary/8 text-primary border-primary/25 hover:bg-primary/12',
  },
];

const ROW_FILTER_PILL_BASE =
  'inline-flex items-center rounded-full px-3.5 py-2 text-sm font-medium border transition-all duration-200 active:scale-[0.98]';

type MergedWorkingHoursDayRow = {
  dateKey: string;
  date: string;
  clock: DailyClockInSummary | null;
  unavailabilities: EmployeeUnavailabilityDayRow[];
  /** Workday with no entry — muted clickable row. */
  isMissingPlaceholder?: boolean;
  /** Holiday with no entry — muted clickable row (may still require hours). */
  isHolidayPlaceholder?: boolean;
  holidayNames?: string[];
};

function buildFullMonthTableRows(
  mergedRows: MergedWorkingHoursDayRow[],
  coverageDays: WorkingHoursDayCoverage[],
): MergedWorkingHoursDayRow[] {
  const byKey = new Map(mergedRows.map((row) => [row.dateKey, row]));
  const rows: MergedWorkingHoursDayRow[] = [];

  for (const day of coverageDays) {
    const existing = byKey.get(day.dateKey);
    if (existing) {
      rows.push(existing);
    } else if (day.status === 'missing') {
      rows.push({
        dateKey: day.dateKey,
        date: formatWorkingHoursDateLabel(day.dateKey),
        clock: null,
        unavailabilities: [],
        isMissingPlaceholder: true,
      });
    } else if (day.status === 'holiday') {
      rows.push({
        dateKey: day.dateKey,
        date: formatWorkingHoursDateLabel(day.dateKey),
        clock: null,
        unavailabilities: [],
        isHolidayPlaceholder: true,
        holidayNames: day.holidayNames,
      });
    }
  }

  rows.sort((a, b) => parseDateKeyMs(a.dateKey) - parseDateKeyMs(b.dateKey));
  return rows;
}

function rowMatchesWorkingHoursFilters(
  row: MergedWorkingHoursDayRow,
  dayRecords: ClockInRow[],
  activeFilters: Set<WorkingHoursRowFilter>,
): boolean {
  if (row.isMissingPlaceholder || row.isHolidayPlaceholder) return false;
  if (activeFilters.size === 0) return true;

  const hasClock = row.clock != null;
  const hasUnavail = row.unavailabilities.length > 0;
  const approvalStatus = getDayClockInApprovalStatus(dayRecords, {
    hasManualClockSummary: row.clock?.hasManual === true,
  });

  const matches: Record<WorkingHoursRowFilter, boolean> = {
    approved: dayRecords.some(
      (record) => isManualClockInRecord(record) && getClockInApprovalStatus(record) === 'approved',
    ),
    declined: hasClock && approvalStatus === 'declined',
    pending: hasClock && approvalStatus === 'pending',
    unavailability: hasUnavail,
    clock: hasClock,
  };

  for (const filter of activeFilters) {
    if (matches[filter]) return true;
  }
  return false;
}

function parseDateKeyMs(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

function buildMergedWorkingHoursDayRows(
  dailyClock: DailyClockInSummary[],
  unavailabilityRows: EmployeeUnavailabilityDayRow[],
): MergedWorkingHoursDayRow[] {
  const clockByDate = new Map(dailyClock.map((row) => [row.dateKey, row]));
  const unavailByDate = new Map<string, EmployeeUnavailabilityDayRow[]>();

  for (const row of unavailabilityRows) {
    const bucket = unavailByDate.get(row.date);
    if (bucket) bucket.push(row);
    else unavailByDate.set(row.date, [row]);
  }

  const allDateKeys = new Set([...clockByDate.keys(), ...unavailByDate.keys()]);
  const rows: MergedWorkingHoursDayRow[] = [];

  for (const dateKey of allDateKeys) {
    const clock = clockByDate.get(dateKey) ?? null;
    rows.push({
      dateKey,
      date: clock?.date ?? formatWorkingHoursDateLabel(dateKey),
      clock,
      unavailabilities: unavailByDate.get(dateKey) ?? [],
    });
  }

  // Oldest date first (01/06, 02/06, …)
  rows.sort((a, b) => parseDateKeyMs(a.dateKey) - parseDateKeyMs(b.dateKey));
  return rows;
}

function countMissingEntryPlaceholderRows(rows: MergedWorkingHoursDayRow[]): number {
  return rows.filter((row) => row.isMissingPlaceholder || row.isHolidayPlaceholder).length;
}

function MissingDaysBadge({ count, loading }: { count: number; loading: boolean }) {
  if (loading) return null;
  if (count > 0) {
    return (
      <span
        className="badge badge-sm bg-amber-100 text-amber-800 border border-amber-200"
        title="Sun–Thu workdays and holidays (up to today) with no entry — matches gray and purple placeholder rows; Fri/Sat excluded"
      >
        {count} {count === 1 ? 'day' : 'days'} missing
      </span>
    );
  }
  return (
    <span
      className="badge badge-sm bg-green-100 text-green-700 border border-green-200"
      title="All required Sun–Thu workdays and holidays this month have an entry (Fri/Sat excluded)"
    >
      No missing days
    </span>
  );
}

function TimeListCell({ value }: { value: string }) {
  const parts = value.split(', ').filter(Boolean);
  if (parts.length === 0) return <span className="text-gray-400">—</span>;
  return (
    <div className="flex flex-col gap-0.5">
      {parts.map((part, i) => (
        <span key={`${part}-${i}`} className="text-sm whitespace-nowrap">
          {part}
        </span>
      ))}
    </div>
  );
}

type WorkingHoursRowActionsMenuProps = {
  dateKey: string;
  unavailabilities: EmployeeUnavailabilityDayRow[];
  hasClock: boolean;
  loading: boolean;
  deletingRowKey: string | null;
  deletingClockInDay: string | null;
  readOnly?: boolean;
  onEditUnavailability: (row: EmployeeUnavailabilityDayRow) => void;
  onDeleteUnavailability: (row: EmployeeUnavailabilityDayRow) => void;
  onEditClockIn: (dateKey: string) => void;
  onDeleteClockIn: (dateKey: string) => void;
};

const WORKING_HOURS_ACTIONS_MENU_EST_HEIGHT_PX = 120;
const WORKING_HOURS_ACTIONS_MENU_WIDTH_PX = 192;

function WorkingHoursRowActionsMenu({
  dateKey,
  unavailabilities,
  hasClock,
  loading,
  deletingRowKey,
  deletingClockInDay,
  readOnly = false,
  onEditUnavailability,
  onDeleteUnavailability,
  onEditClockIn,
  onDeleteClockIn,
}: WorkingHoursRowActionsMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({ visibility: 'hidden' });

  const isDeletingClock = deletingClockInDay === dateKey;
  const isDeletingAnyUnavail = unavailabilities.some(
    (u) => deletingRowKey === `${u.id}-${u.date}`,
  );
  const isBusy = loading || isDeletingClock || isDeletingAnyUnavail;
  const hasUnavail = unavailabilities.length > 0;
  const showMenu = hasUnavail || hasClock;

  const updatePosition = useCallback(() => {
    const btn = triggerRef.current;
    if (!btn) return;

    const rect = btn.getBoundingClientRect();
    const menuH = menuRef.current?.offsetHeight || WORKING_HOURS_ACTIONS_MENU_EST_HEIGHT_PX;
    const menuW = menuRef.current?.offsetWidth || WORKING_HOURS_ACTIONS_MENU_WIDTH_PX;
    const gap = 4;

    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const openUp = spaceBelow < menuH + gap + 8 && spaceAbove >= spaceBelow;

    const top = openUp ? rect.top - menuH - gap : rect.bottom + gap;
    const left = Math.max(8, Math.min(rect.right - menuW, window.innerWidth - menuW - 8));

    setMenuStyle({
      position: 'fixed',
      top,
      left,
      zIndex: 10050,
      width: WORKING_HOURS_ACTIONS_MENU_WIDTH_PX,
      visibility: 'visible',
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const raf = requestAnimationFrame(updatePosition);
    const onScrollOrResize = () => updatePosition();
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open, updatePosition, unavailabilities.length, hasClock]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (triggerRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  if (!showMenu || readOnly) {
    return <span className="text-gray-400">—</span>;
  }

  const multipleUnavail = unavailabilities.length > 1;

  const closeAnd = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  const menuContent = (
    <ul
      ref={menuRef}
      role="menu"
      style={menuStyle}
      className="menu rounded-xl border border-base-200 bg-white p-1.5 shadow-lg"
      onClick={(e) => e.stopPropagation()}
    >
      {unavailabilities.map((unavail) => {
        const rowKey = `${unavail.id}-${unavail.date}`;
        const typeLabel = unavailabilityTypeLabel(unavail.unavailability_type);
        const suffix = multipleUnavail ? ` (${typeLabel})` : hasClock ? ' unavailability' : '';
        return (
          <React.Fragment key={rowKey}>
            <li role="none">
              <button
                type="button"
                role="menuitem"
                className="gap-2 text-sm"
                disabled={isBusy}
                onClick={(e) => {
                  e.stopPropagation();
                  closeAnd(() => onEditUnavailability(unavail));
                }}
              >
                <PencilSquareIcon className="w-4 h-4" />
                Edit{suffix}
              </button>
            </li>
            <li role="none">
              <button
                type="button"
                role="menuitem"
                className="gap-2 text-sm text-error"
                disabled={isBusy}
                onClick={(e) => {
                  e.stopPropagation();
                  closeAnd(() => onDeleteUnavailability(unavail));
                }}
              >
                <TrashIcon className="w-4 h-4" />
                Delete{suffix}
              </button>
            </li>
          </React.Fragment>
        );
      })}
      {hasUnavail && hasClock && (
        <li aria-hidden className="my-0.5">
          <div className="border-t border-base-200" />
        </li>
      )}
      {hasClock && (
        <>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              className="gap-2 text-sm"
              disabled={isBusy}
              onClick={(e) => {
                e.stopPropagation();
                closeAnd(() => onEditClockIn(dateKey));
              }}
            >
              <PencilSquareIcon className="w-4 h-4" />
              Edit{hasUnavail ? ' clock-in' : ''}
            </button>
          </li>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              className="gap-2 text-sm text-error"
              disabled={isBusy}
              onClick={(e) => {
                e.stopPropagation();
                closeAnd(() => onDeleteClockIn(dateKey));
              }}
            >
              <TrashIcon className="w-4 h-4" />
              Delete{hasUnavail ? ' clock-in' : ''}
            </button>
          </li>
        </>
      )}
    </ul>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="btn btn-ghost btn-sm btn-circle min-h-10 min-w-10 h-10 w-10 hover:bg-base-200"
        aria-label="Row actions"
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={isBusy}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
      >
        {isBusy ? (
          <span className="loading loading-spinner loading-sm" />
        ) : (
          <EllipsisVerticalIcon className="w-6 h-6" />
        )}
      </button>
      {open && typeof document !== 'undefined' && createPortal(menuContent, document.body)}
    </>
  );
}

const WorkingHoursTab: React.FC<WorkingHoursTabProps> = ({ employeeId, employeeName = '' }) => {
  const { user } = useAuthContext();
  const calendarRef = useRef<CompactAvailabilityCalendarRef>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const [useSideWeekColumn, setUseSideWeekColumn] = useState(true);
  const now = useMemo(() => new Date(), []);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const periodRange = useMemo(() => monthRange(year, month), [year, month]);
  const dateFrom = periodRange.from;
  const dateTo = periodRange.to;
  const [records, setRecords] = useState<ClockInRow[]>([]);
  const [unavailabilities, setUnavailabilities] = useState<EmployeeUnavailabilityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [isClockedIn, setIsClockedIn] = useState(false);
  const [sessionDuration, setSessionDuration] = useState('');
  const [exporting, setExporting] = useState(false);
  const [submitModalOpen, setSubmitModalOpen] = useState(false);
  const [monthSubmission, setMonthSubmission] = useState<EmployeeWorkingHoursSubmission | null>(null);
  const [loadingMonthSubmission, setLoadingMonthSubmission] = useState(false);
  const [cancellingSubmission, setCancellingSubmission] = useState(false);
  const [calendarModalOpen, setCalendarModalOpen] = useState(false);
  const [calendarViewYear, setCalendarViewYear] = useState(now.getFullYear());
  const [calendarViewMonth, setCalendarViewMonth] = useState(now.getMonth() + 1);
  const [calendarMonthRecords, setCalendarMonthRecords] = useState<ClockInRow[]>([]);
  const [calendarMonthUnavailabilities, setCalendarMonthUnavailabilities] = useState<
    EmployeeUnavailabilityEntry[]
  >([]);
  const [editingRow, setEditingRow] = useState<EmployeeUnavailabilityDayRow | null>(null);
  const [deletingRowKey, setDeletingRowKey] = useState<string | null>(null);
  const [manualClockInOpen, setManualClockInOpen] = useState(false);
  const [bulkManualClockInOpen, setBulkManualClockInOpen] = useState(false);
  const [bulkSelectMode, setBulkSelectMode] = useState(false);
  const [bulkSelectedDateKeys, setBulkSelectedDateKeys] = useState<Set<string>>(() => new Set());
  const [editingClockInDay, setEditingClockInDay] = useState<string | null>(null);
  const [deletingClockInDay, setDeletingClockInDay] = useState<string | null>(null);
  const [selectedDocument, setSelectedDocument] = useState<{
    url: string;
    name: string;
    reason: string;
    uploadedAt: string;
  } | null>(null);
  const [holidayMapVersion, setHolidayMapVersion] = useState(0);
  const [rowFilters, setRowFilters] = useState<Set<WorkingHoursRowFilter>>(() => new Set());
  const [manualClockInInitialDateKey, setManualClockInInitialDateKey] = useState<string | null>(null);
  const [pendingCalendarDateKey, setPendingCalendarDateKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const years = [...new Set([year, calendarViewYear, year - 1, year + 1])];
    void preloadHolidayYears(years).then(() => {
      if (!cancelled) setHolidayMapVersion((v) => v + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [year, calendarViewYear]);

  useEffect(() => {
    setRowFilters(new Set());
    setBulkSelectMode(false);
    setBulkSelectedDateKeys(new Set());
  }, [year, month]);

  const toggleRowFilter = useCallback((filter: WorkingHoursRowFilter) => {
    setRowFilters((prev) => {
      const next = new Set(prev);
      if (next.has(filter)) next.delete(filter);
      else next.add(filter);
      return next;
    });
  }, []);

  const updateSessionDuration = useCallback((clockInTime: string) => {
    const diffMs = Math.max(0, Date.now() - new Date(clockInTime).getTime());
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    setSessionDuration(hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`);
  }, []);

  const fetchClockInStatus = useCallback(async () => {
    if (!employeeId) {
      setIsClockedIn(false);
      setSessionDuration('');
      return;
    }
    try {
      const { data, error } = await supabase
        .from('employee_clock_in')
        .select('clock_in_time, clock_out_time')
        .eq('employee_id', employeeId)
        .eq('is_active', true)
        .order('clock_in_time', { ascending: false })
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') throw error;

      if (data) {
        setIsClockedIn(true);
        updateSessionDuration(data.clock_in_time);
      } else {
        setIsClockedIn(false);
        setSessionDuration('');
      }
    } catch (err) {
      console.error('WorkingHoursTab status:', err);
      setIsClockedIn(false);
      setSessionDuration('');
    }
  }, [employeeId, updateSessionDuration]);

  const fetchRecords = useCallback(async () => {
    if (!employeeId) {
      setRecords([]);
      setUnavailabilities([]);
      setLoading(false);
      return;
    }
    const range = monthRange(year, month);
    setLoading(true);
    try {
      const { start, end } = dateRangeToIsoBounds(range.from, range.to);
      const clockSelectWithApproval = `id, employee_id, clock_in_time, clock_out_time, is_active, manually,
             approved, declined,
             clock_in_location_id, clock_out_location_id,
             clock_in_place:clock_in_locations!clock_in_location_id ( name ),
             clock_out_place:clock_in_locations!clock_out_location_id ( name ),
             notes`;
      const clockSelectLegacy = `id, employee_id, clock_in_time, clock_out_time, is_active, manually,
             clock_in_location_id, clock_out_location_id,
             clock_in_place:clock_in_locations!clock_in_location_id ( name ),
             clock_out_place:clock_in_locations!clock_out_location_id ( name ),
             notes`;

      let clockResult = await supabase
        .from('employee_clock_in')
        .select(clockSelectWithApproval)
        .eq('employee_id', employeeId)
        .gte('clock_in_time', start)
        .lte('clock_in_time', end)
        .order('clock_in_time', { ascending: false });

      if (clockResult.error) {
        const msg = clockResult.error.message?.toLowerCase() ?? '';
        if (msg.includes('approved') || msg.includes('declined')) {
          clockResult = await supabase
            .from('employee_clock_in')
            .select(clockSelectLegacy)
            .eq('employee_id', employeeId)
            .gte('clock_in_time', start)
            .lte('clock_in_time', end)
            .order('clock_in_time', { ascending: false });
        }
      }

      const [resolvedClockResult, unavailRows] = await Promise.all([
        Promise.resolve(clockResult),
        fetchEmployeeUnavailabilitiesInRange(employeeId, range.from, range.to),
      ]);

      if (resolvedClockResult.error) throw resolvedClockResult.error;
      const normalizedRows = ((resolvedClockResult.data as ClockInRow[]) || []).map((row) =>
        normalizeClockInApprovalFields(row),
      );
      setRecords(normalizedRows);
      setUnavailabilities(unavailRows);
    } catch (err) {
      console.error('WorkingHoursTab fetch:', err);
      setRecords([]);
      setUnavailabilities([]);
    } finally {
      setLoading(false);
    }
  }, [employeeId, year, month]);

  useEffect(() => {
    void fetchRecords();
  }, [fetchRecords]);

  const loadMonthSubmission = useCallback(async () => {
    if (!employeeId) {
      setMonthSubmission(null);
      return;
    }
    setLoadingMonthSubmission(true);
    try {
      const row = await fetchWorkingHoursSubmission(employeeId, year, month);
      setMonthSubmission(row);
    } catch (err) {
      console.error('WorkingHoursTab submission fetch:', err);
      setMonthSubmission(null);
    } finally {
      setLoadingMonthSubmission(false);
    }
  }, [employeeId, year, month]);

  useEffect(() => {
    void loadMonthSubmission();
  }, [loadMonthSubmission]);

  useEffect(() => {
    void fetchClockInStatus();
    const interval = window.setInterval(() => {
      void fetchClockInStatus();
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [fetchClockInStatus]);

  const dailyRows = useMemo(() => aggregateClockInRecordsByDay(records), [records]);
  const periodTotal = sumClockDurations(filterCountedClockInRecords(records));

  const monthSubmitApprovalBlockers = useMemo(() => {
    const range = monthRange(year, month);
    const monthRecords = records.filter((record) => {
      const dateKey = toDateInputValue(new Date(record.clock_in_time));
      return dateKey >= range.from && dateKey <= range.to;
    });
    return countClockInApprovalBlockers(monthRecords);
  }, [records, year, month]);

  const monthSubmitBlockMessage = useMemo(
    () => clockInApprovalSubmitBlockMessage(monthSubmitApprovalBlockers),
    [monthSubmitApprovalBlockers],
  );

  const submitBlockedByApproval = monthSubmitBlockMessage != null;

  const isMonthSubmitted = monthSubmission != null;
  const monthLockedMessage =
    'This month is submitted. Cancel submission to add or edit entries.';

  const isRowLockedForSubmission = useCallback(
    (dateKey: string) => {
      if (!monthSubmission) return false;
      const range = monthRange(year, month);
      return dateKey >= range.from && dateKey <= range.to;
    },
    [monthSubmission, year, month],
  );

  const recordsByDay = useMemo(() => {
    const map = new Map<string, ClockInRow[]>();
    for (const record of records) {
      const key = toDateInputValue(new Date(record.clock_in_time));
      const bucket = map.get(key);
      if (bucket) bucket.push(record);
      else map.set(key, [record]);
    }
    for (const bucket of map.values()) {
      bucket.sort(
        (a, b) =>
          new Date(a.clock_in_time).getTime() - new Date(b.clock_in_time).getTime(),
      );
    }
    return map;
  }, [records]);

  const editingClockInSessions = editingClockInDay
    ? recordsByDay.get(editingClockInDay) ?? []
    : [];

  const unavailabilityDayRows = useMemo(
    () => expandUnavailabilitiesToDailyRows(unavailabilities, dateFrom, dateTo),
    [unavailabilities, dateFrom, dateTo],
  );

  const mergedDayRows = useMemo(
    () => buildMergedWorkingHoursDayRows(dailyRows, unavailabilityDayRows),
    [dailyRows, unavailabilityDayRows],
  );

  const monthCoverage = useMemo(() => {
    const pendingApprovalDates = new Set<string>();
    for (const [dateKey, dayRecords] of recordsByDay) {
      const status = getDayClockInApprovalStatus(dayRecords, {
        hasManualClockSummary: dayRecords.some(isManualClockInRecord),
      });
      if (status === 'pending') pendingApprovalDates.add(dateKey);
    }
    return buildWorkingHoursMonthCoverage(year, month, records, unavailabilities, {
      pendingApprovalDates,
    });
  }, [year, month, records, unavailabilities, recordsByDay, holidayMapVersion]);

  const tableDayRows = useMemo(
    () => buildFullMonthTableRows(mergedDayRows, monthCoverage.days),
    [mergedDayRows, monthCoverage.days],
  );

  const filteredMergedDayRows = useMemo(
    () => {
      if (rowFilters.size === 0) return tableDayRows;
      return tableDayRows.filter((row) =>
        rowMatchesWorkingHoursFilters(row, recordsByDay.get(row.dateKey) ?? [], rowFilters),
      );
    },
    [tableDayRows, recordsByDay, rowFilters],
  );

  const hasActiveRowFilters = rowFilters.size > 0;

  const monthWeekLookup = useMemo(
    () => buildMonthWeekNumberLookup(year, month),
    [year, month],
  );

  const weekRowMeta = useMemo(
    () => buildWorkingHoursWeekRowMeta(filteredMergedDayRows, monthWeekLookup),
    [filteredMergedDayRows, monthWeekLookup],
  );

  const tableColSpan = useMemo(
    () =>
      MERGED_COL_SPAN
      + (useSideWeekColumn ? WEEK_COL_SPAN : 0)
      + (bulkSelectMode ? 1 : 0),
    [useSideWeekColumn, bulkSelectMode],
  );

  const updateWeekLayoutMode = useCallback(() => {
    const el = tableScrollRef.current;
    if (!el) return;
    const overflow = el.scrollWidth > el.clientWidth + 2;
    setUseSideWeekColumn((prev) => {
      if (overflow) return false;
      if (!prev) {
        return el.clientWidth >= el.scrollWidth + 28;
      }
      return true;
    });
  }, []);

  useLayoutEffect(() => {
    updateWeekLayoutMode();
  }, [updateWeekLayoutMode, loading, filteredMergedDayRows, bulkSelectMode, year, month]);

  useEffect(() => {
    const el = tableScrollRef.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(() => updateWeekLayoutMode());
    observer.observe(el);
    const table = el.querySelector('table');
    if (table) observer.observe(table);
    return () => observer.disconnect();
  }, [updateWeekLayoutMode]);

  const handleCalendarMonthChange = useCallback((viewYear: number, viewMonth: number) => {
    setCalendarViewYear(viewYear);
    setCalendarViewMonth(viewMonth);
  }, []);

  const periodMissingDays = useMemo(
    () => countMissingEntryPlaceholderRows(tableDayRows),
    [tableDayRows],
  );

  const calendarMissingDays = useMemo(() => {
    const viewRange = monthRange(calendarViewYear, calendarViewMonth);
    const filterRange = monthRange(year, month);
    const sameMonth = viewRange.from === filterRange.from;

    if (sameMonth) {
      return countMissingEntryPlaceholderRows(tableDayRows);
    }

    const monthRecords = calendarMonthRecords;
    const monthUnavail = calendarMonthUnavailabilities;

    return buildWorkingHoursMonthCoverage(
      calendarViewYear,
      calendarViewMonth,
      monthRecords,
      monthUnavail,
    ).missingCount;
  }, [
    calendarViewYear,
    calendarViewMonth,
    year,
    month,
    tableDayRows,
    calendarMonthRecords,
    calendarMonthUnavailabilities,
    holidayMapVersion,
  ]);

  useEffect(() => {
    if (!calendarModalOpen || !employeeId) return;

    const filterRange = monthRange(year, month);
    const viewRange = monthRange(calendarViewYear, calendarViewMonth);
    if (viewRange.from === filterRange.from) {
      setCalendarMonthRecords([]);
      setCalendarMonthUnavailabilities([]);
      return;
    }

    let cancelled = false;
    void (async () => {
      const { from, to } = viewRange;
      const { start, end } = dateRangeToIsoBounds(from, to);
      try {
        const [clockResult, unavailRows] = await Promise.all([
          supabase
            .from('employee_clock_in')
            .select('clock_in_time')
            .eq('employee_id', employeeId)
            .gte('clock_in_time', start)
            .lte('clock_in_time', end),
          fetchEmployeeUnavailabilitiesInRange(employeeId, from, to),
        ]);
        if (cancelled) return;
        setCalendarMonthRecords((clockResult.data as ClockInRow[]) || []);
        setCalendarMonthUnavailabilities(unavailRows);
      } catch (err) {
        console.error('WorkingHoursTab calendar month fetch:', err);
        if (!cancelled) {
          setCalendarMonthRecords([]);
          setCalendarMonthUnavailabilities([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [calendarModalOpen, calendarViewYear, calendarViewMonth, year, month, employeeId]);

  const openCalendarModal = () => {
    if (isMonthSubmitted) {
      toast.error(monthLockedMessage);
      return;
    }
    setCalendarViewYear(year);
    setCalendarViewMonth(month);
    setCalendarModalOpen(true);
  };

  const handlePlaceholderAddClockIn = useCallback((dateKey: string) => {
    if (isMonthSubmitted) {
      toast.error(monthLockedMessage);
      return;
    }
    setManualClockInInitialDateKey(dateKey);
    setManualClockInOpen(true);
  }, [isMonthSubmitted, monthLockedMessage]);

  const selectablePlaceholderRows = useMemo(
    () =>
      tableDayRows.filter(
        (row) =>
          (row.isMissingPlaceholder || row.isHolidayPlaceholder) && !isMonthSubmitted,
      ),
    [tableDayRows, isMonthSubmitted],
  );

  const exitBulkSelectMode = useCallback(() => {
    setBulkSelectMode(false);
    setBulkSelectedDateKeys(new Set());
  }, []);

  const toggleBulkDateSelection = useCallback((dateKey: string) => {
    setBulkSelectedDateKeys((prev) => {
      const next = new Set(prev);
      if (next.has(dateKey)) next.delete(dateKey);
      else next.add(dateKey);
      return next;
    });
  }, []);

  const selectAllBulkPlaceholders = useCallback(() => {
    setBulkSelectedDateKeys(new Set(selectablePlaceholderRows.map((row) => row.dateKey)));
  }, [selectablePlaceholderRows]);

  const handleBulkSelectModeToggle = useCallback(() => {
    if (isMonthSubmitted) {
      toast.error(monthLockedMessage);
      return;
    }
    if (bulkSelectMode) {
      exitBulkSelectMode();
      return;
    }
    setBulkSelectMode(true);
    toast('Select rows in the table, then apply clock-in', { icon: 'ℹ️' });
  }, [bulkSelectMode, exitBulkSelectMode, isMonthSubmitted, monthLockedMessage]);

  const handleBulkApplyClockIn = useCallback(() => {
    if (bulkSelectedDateKeys.size === 0) {
      toast.error('Select at least one day in the table');
      return;
    }
    setBulkManualClockInOpen(true);
  }, [bulkSelectedDateKeys.size]);

  const handleBulkSaved = useCallback(() => {
    void fetchRecords();
    exitBulkSelectMode();
  }, [exitBulkSelectMode, fetchRecords]);

  useEffect(() => {
    if (!calendarModalOpen || !pendingCalendarDateKey) return;
    const dateKey = pendingCalendarDateKey;
    const timer = window.setTimeout(() => {
      calendarRef.current?.openDayForDate(dateKey);
      setPendingCalendarDateKey(null);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [calendarModalOpen, pendingCalendarDateKey]);

  const handleCancelSubmission = async () => {
    const monthLabel = MONTH_NAMES[month - 1] ?? String(month);
    const confirmed = window.confirm(
      `Cancel submission for ${monthLabel} ${year}? You will be able to add and edit entries again.`,
    );
    if (!confirmed) return;

    setCancellingSubmission(true);
    try {
      await cancelWorkingHoursSubmission(employeeId, year, month);
      setMonthSubmission(null);
      toast.success('Submission cancelled. You can edit this month again.');
    } catch (err) {
      console.error('WorkingHoursTab cancel submission:', err);
      toast.error('Failed to cancel submission.');
    } finally {
      setCancellingSubmission(false);
    }
  };

  const handleSubmissionSaved = (submission: EmployeeWorkingHoursSubmission) => {
    if (submission.year === year && submission.month === month) {
      setMonthSubmission(submission);
    }
    void loadMonthSubmission();
  };

  const handleExportExcel = () => {
    const mergedRows = buildMergedTimeAndUnavailabilityExportRows(
      filterCountedClockInRecords(records),
      unavailabilities,
      dateFrom,
      dateTo,
    );
    if (mergedRows.length === 0) {
      toast('No records to export for this period.', { icon: '⚠️' });
      return;
    }
    setExporting(true);
    try {
      exportMergedTimeAndUnavailabilitiesToExcel(mergedRows, {
        employeeName,
        dateFrom,
        dateTo,
        periodTotal,
      });
      toast.success(`Exported ${mergedRows.length} day(s) to Excel.`);
    } catch (err) {
      console.error('Working hours export:', err);
      toast.error('Failed to export Excel file.');
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteUnavailability = async (row: EmployeeUnavailabilityDayRow) => {
    if (isRowLockedForSubmission(row.date)) {
      toast.error(monthLockedMessage);
      return;
    }

    const confirmed = window.confirm(
      `Remove unavailability for ${formatWorkingHoursDateLabel(row.date)}?`,
    );
    if (!confirmed) return;

    const rowKey = `${row.id}-${row.date}`;
    setDeletingRowKey(rowKey);
    try {
      const source = unavailabilities.find((u) => u.id === row.id);
      if (!source) {
        toast.error('Record not found. Refreshing…');
        await fetchRecords();
        return;
      }
      await deleteUnavailabilityDay(source, row.date);
      toast.success('Unavailability removed');
      await fetchRecords();
    } catch (err) {
      console.error('WorkingHoursTab delete unavailability:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to remove unavailability');
    } finally {
      setDeletingRowKey(null);
    }
  };

  const handleDeleteClockInDay = async (dateKey: string) => {
    if (isRowLockedForSubmission(dateKey)) {
      toast.error(monthLockedMessage);
      return;
    }

    const daySessions = recordsByDay.get(dateKey) ?? [];
    if (daySessions.length === 0) return;

    const label = formatWorkingHoursDateLabel(dateKey);
    const confirmed = window.confirm(
      daySessions.length === 1
        ? `Delete clock-in entry for ${label}?`
        : `Delete all ${daySessions.length} clock-in entries for ${label}?`,
    );
    if (!confirmed) return;

    setDeletingClockInDay(dateKey);
    try {
      await deleteClockInSessions(daySessions.map((s) => s.id));
      toast.success('Clock-in entries removed');
      await fetchRecords();
      void fetchClockInStatus();
    } catch (err) {
      console.error('WorkingHoursTab delete clock-in:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to remove clock-in entries');
    } finally {
      setDeletingClockInDay(null);
    }
  };

  return (
    <div className="my-profile-hours-shell w-full max-w-full min-w-0 overflow-x-hidden space-y-4">
      <div className="rounded-[18px] bg-white px-4 py-4 md:px-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between w-full min-w-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <ClockIcon className="w-5 h-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xl md:text-2xl font-bold text-gray-800">Working Hours</h2>
              <p className="text-sm text-gray-500">Unavailabilities and clock-in/out history</p>
            </div>
          </div>
          <div className="shrink-0 self-start sm:self-auto max-w-full">
            {isClockedIn ? (
              <span className="inline-flex flex-wrap items-center px-4 py-2 rounded-full text-sm md:text-base font-semibold bg-green-100/90 text-green-800 border border-green-200/70 max-w-full">
                {sessionDuration
                  ? `clocked in since ${sessionDuration}`
                  : 'clocked in'}
              </span>
            ) : (
              <span className="inline-flex items-center px-4 py-2 rounded-full text-sm md:text-base font-semibold bg-gray-100 text-gray-600 border border-gray-200/80">
                Clocked Out
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-[18px] bg-white px-4 py-4 md:px-5 shadow-sm space-y-4">
        <div className="flex items-center gap-2 text-base font-semibold text-gray-700">
          <FunnelIcon className="w-5 h-5" />
          Filters
        </div>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:gap-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl shrink-0">
            <div className="form-control w-full">
              <YearWheelPicker
                label="Year"
                value={year}
                onChange={setYear}
              />
            </div>
            <label className="form-control w-full">
              <span className="label-text text-sm text-gray-600 mb-1.5 font-medium">Month</span>
              <select
                className="select select-bordered w-full text-base h-12"
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
              >
                {MONTH_NAMES.map((name, i) => (
                  <option key={name} value={i + 1}>{name}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="min-w-0 flex-1">
            <span className="label-text text-sm text-gray-600 mb-1.5 font-medium block">Show</span>
            <div className="flex flex-wrap items-center gap-2">
              {ROW_FILTER_OPTIONS.map((option) => {
                const active = rowFilters.has(option.id);
                return (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={active}
                    className={`${ROW_FILTER_PILL_BASE} ${active ? option.activeClass : option.idleClass}`}
                    onClick={() => toggleRowFilter(option.id)}
                  >
                    {option.label}
                  </button>
                );
              })}
              {hasActiveRowFilters && (
                <button
                  type="button"
                  className="inline-flex items-center rounded-full px-3 py-2 text-sm font-medium text-base-content/50 hover:text-base-content hover:bg-base-200/70 transition-colors"
                  onClick={() => setRowFilters(new Set())}
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
          <span className="text-base font-semibold text-primary">
            Period total: {periodTotal}
          </span>
          <MissingDaysBadge count={periodMissingDays} loading={loading} />
        </div>
      </div>

      {/* Working hours & unavailabilities */}
      <div className="w-full">
        <div className="rounded-[18px] bg-white px-4 py-3 md:px-5 shadow-sm mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <ClockIcon className="w-5 h-5 text-primary shrink-0" />
            <h3 className="text-base font-semibold text-gray-800">Working hours</h3>
            {monthSubmission && (
              <span
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-green-100 text-green-800 border border-green-200"
                title={`Submitted on ${new Date(monthSubmission.submitted_at).toLocaleString('en-GB')}`}
              >
                <CheckIcon className="w-4 h-4 shrink-0" />
                Submitted
              </span>
            )}
            {submitBlockedByApproval && !isMonthSubmitted && monthSubmitBlockMessage && (
              <span className="text-xs text-red-700 max-w-md">{monthSubmitBlockMessage}</span>
            )}
            {!isMonthSubmitted && (
              <button
                type="button"
                className={SUBMIT_HOURS_BTN_CLASS}
                onClick={() => {
                  if (submitBlockedByApproval && monthSubmitBlockMessage) {
                    toast.error(monthSubmitBlockMessage);
                    return;
                  }
                  setSubmitModalOpen(true);
                }}
                disabled={!user?.id || loadingMonthSubmission || submitBlockedByApproval}
                title={monthSubmitBlockMessage ?? undefined}
              >
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/20">
                  <CheckIcon className="w-4 h-4 stroke-[2.5]" aria-hidden />
                </span>
                Submit {MONTH_NAMES[month - 1]} {year}
              </button>
            )}
            {isMonthSubmitted && (
              <button
                type="button"
                className={CANCEL_SUBMISSION_BTN_CLASS}
                onClick={() => void handleCancelSubmission()}
                disabled={!user?.id || cancellingSubmission || loadingMonthSubmission}
                title="Withdraw submission so you can add or edit entries again"
              >
                {cancellingSubmission ? (
                  <span className="loading loading-spinner loading-sm" />
                ) : (
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-amber-200/60">
                    <ArrowUturnLeftIcon className="w-4 h-4 stroke-[2.5]" aria-hidden />
                  </span>
                )}
                Cancel submission
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              className="btn btn-sm btn-outline btn-primary gap-2"
              onClick={openCalendarModal}
              disabled={isMonthSubmitted}
              title={isMonthSubmitted ? monthLockedMessage : undefined}
            >
              <CalendarDaysIcon className="w-4 h-4" />
              Add unavailability
            </button>
            <button
              type="button"
              className="btn btn-sm btn-outline btn-primary gap-2"
              onClick={handleExportExcel}
              disabled={
                exporting
                || loading
                || mergedDayRows.length === 0
              }
            >
              {exporting ? (
                <span className="loading loading-spinner loading-sm" />
              ) : (
                <ArrowDownTrayIcon className="w-4 h-4" />
              )}
              Export Excel
            </button>
            <button
              type="button"
              className={`btn btn-sm gap-2 ${
                bulkSelectMode ? 'btn-primary' : 'btn-outline btn-primary'
              }`}
              onClick={handleBulkSelectModeToggle}
              disabled={!user?.id || isMonthSubmitted}
              title={
                isMonthSubmitted
                  ? monthLockedMessage
                  : bulkSelectMode
                    ? 'Cancel row selection'
                    : 'Select table rows to add clock-in in bulk'
              }
            >
              <SquaresPlusIcon className="w-4 h-4" />
              {bulkSelectMode ? 'Cancel selection' : 'Add multiple clock-in'}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary gap-2"
              onClick={() => {
                if (isMonthSubmitted) {
                  toast.error(monthLockedMessage);
                  return;
                }
                setManualClockInInitialDateKey(null);
                setManualClockInOpen(true);
              }}
              disabled={!user?.id || isMonthSubmitted}
              title={isMonthSubmitted ? monthLockedMessage : undefined}
            >
              <PlusIcon className="w-4 h-4" />
              Add clock-in
            </button>
          </div>
        </div>
        {bulkSelectMode && (
          <div className="rounded-xl border border-primary/25 bg-primary/5 px-4 py-3 mb-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-gray-800">
              <span className="font-semibold">Select days in the table</span>
              <span className="text-base-content/55">
                {' '}
                — {bulkSelectedDateKeys.size} selected
              </span>
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn btn-xs btn-outline"
                onClick={selectAllBulkPlaceholders}
                disabled={selectablePlaceholderRows.length === 0}
              >
                Select all missing
              </button>
              <button
                type="button"
                className="btn btn-xs btn-ghost"
                onClick={() => setBulkSelectedDateKeys(new Set())}
                disabled={bulkSelectedDateKeys.size === 0}
              >
                Clear
              </button>
              <button
                type="button"
                className="btn btn-xs btn-primary"
                onClick={handleBulkApplyClockIn}
                disabled={bulkSelectedDateKeys.size === 0}
              >
                Apply clock-in{bulkSelectedDateKeys.size > 0 ? ` (${bulkSelectedDateKeys.size})` : ''}
              </button>
            </div>
          </div>
        )}
        <div ref={tableScrollRef} className="-mx-4 overflow-x-auto md:mx-0 py-2 pb-4">
          <table className="table my-profile-hours-table w-full min-w-[56rem] text-sm md:text-base">
            <thead>
              <tr>
                {useSideWeekColumn && (
                  <th
                    className="w-8 min-w-[2rem] px-1 py-3.5 bg-[#ececec]"
                    aria-label="Week"
                  />
                )}
                {bulkSelectMode && (
                  <th className="w-10 min-w-[2.5rem] px-2 py-3.5 bg-[#ececec]" aria-label="Select" />
                )}
                <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-base-content/40 bg-[#ececec] min-w-[9.5rem]">Date</th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-base-content/40 bg-[#ececec]">Unavailability</th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-base-content/40 bg-[#ececec]">Clock in</th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-base-content/40 bg-[#ececec]">Clock out</th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-base-content/40 bg-[#ececec]">Total duration</th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-base-content/40 bg-[#ececec]">Workplace (in)</th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-base-content/40 bg-[#ececec]">Workplace (out)</th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-base-content/40 bg-[#ececec]">Notes</th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-base-content/40 bg-[#ececec]">Document</th>
                <th className="w-12 min-w-[3rem] px-2 py-3.5 bg-[#ececec]" aria-hidden="true" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={tableColSpan} className="text-center py-12">
                    <span className="loading loading-spinner loading-md text-primary" />
                  </td>
                </tr>
              ) : filteredMergedDayRows.length === 0 ? (
                <tr>
                  <td colSpan={tableColSpan} className="text-center py-12 text-gray-400">
                    {hasActiveRowFilters
                      ? 'No entries match the selected filters.'
                      : 'No working hours or unavailabilities for this period.'}
                  </td>
                </tr>
              ) : (
                filteredMergedDayRows.flatMap((row) => {
                  const isPlaceholder = row.isMissingPlaceholder || row.isHolidayPlaceholder;
                  const isBulkSelectable =
                    bulkSelectMode && isPlaceholder && !isMonthSubmitted;
                  const isBulkSelected = bulkSelectedDateKeys.has(row.dateKey);
                  const weekMeta = weekRowMeta.get(row.dateKey);
                  const weekDividerCell =
                    useSideWeekColumn && weekMeta?.isFirstInWeek ? (
                      <WorkingHoursWeekDividerCell
                        weekNum={weekMeta.weekNum}
                        rowSpan={weekMeta.weekRowSpan}
                      />
                    ) : null;

                  const weekBetweenRow =
                    !useSideWeekColumn && weekMeta?.isFirstInWeek ? (
                      <WorkingHoursWeekBetweenRow
                        key={`wh-week-between-${weekMeta.weekNum}`}
                        weekNum={weekMeta.weekNum}
                        colSpan={tableColSpan}
                      />
                    ) : null;

                  if (isPlaceholder) {
                    const placeholderInteractive = !isMonthSubmitted;
                    const isHoliday = row.isHolidayPlaceholder;
                    const holidayLabel = row.holidayNames?.[0];
                    const rowClass = isHoliday
                      ? 'wh-holiday-placeholder'
                      : 'wh-missing-placeholder';
                    const hintText = isHoliday
                      ? holidayLabel
                        ? `${holidayLabel} — no entry yet`
                        : 'Holiday — no entry yet'
                      : 'No entry yet';
                    return [
                      weekBetweenRow,
                      <tr
                        key={row.dateKey}
                        id={`wh-row-${row.dateKey}`}
                        className={`${rowClass}${isBulkSelected ? ' wh-bulk-selected' : ''}`}
                        onClick={
                          isBulkSelectable
                            ? () => toggleBulkDateSelection(row.dateKey)
                            : undefined
                        }
                      >
                        {weekDividerCell}
                        {bulkSelectMode && (
                          <td className="w-10 min-w-[2.5rem] px-2 py-3 align-middle">
                            {isBulkSelectable ? (
                              <input
                                type="checkbox"
                                className="checkbox checkbox-sm checkbox-primary"
                                checked={isBulkSelected}
                                onChange={() => toggleBulkDateSelection(row.dateKey)}
                                onClick={(e) => e.stopPropagation()}
                                aria-label={`Select ${row.date}`}
                              />
                            ) : null}
                          </td>
                        )}
                        <td className="relative whitespace-nowrap font-medium wh-data-date-cell">
                          <WorkingHoursDateLabel dateKey={row.dateKey} muted />
                        </td>
                        <td colSpan={8} className="text-sm text-base-content/40 italic">
                          {hintText}
                        </td>
                        <td className="w-12 min-w-[3rem] px-2 py-3 text-right whitespace-nowrap align-middle">
                          {placeholderInteractive && !bulkSelectMode ? (
                            <button
                              type="button"
                              className="btn btn-xs btn-primary gap-1 whitespace-nowrap"
                              onClick={() => handlePlaceholderAddClockIn(row.dateKey)}
                              title="Add manual clock-in and clock-out"
                            >
                              <PlusIcon className="w-3.5 h-3.5 shrink-0" />
                              <span className="hidden sm:inline">Add clock-in</span>
                            </button>
                          ) : (
                            <span className="text-gray-400 text-xs">—</span>
                          )}
                        </td>
                      </tr>,
                    ];
                  }

                  const hasClock = row.clock != null;
                  const dayRecords = recordsByDay.get(row.dateKey) ?? [];
                  const approvalStatus = getDayClockInApprovalStatus(dayRecords, {
                    hasManualClockSummary: row.clock?.hasManual === true,
                  });
                  return [
                    weekBetweenRow,
                    <tr
                      key={row.dateKey}
                      id={`wh-row-${row.dateKey}`}
                      className={clockInApprovalRowClass(approvalStatus)}
                    >
                      {weekDividerCell}
                      {bulkSelectMode && <td className="w-10 min-w-[2.5rem] px-2" aria-hidden />}
                      <td className="relative font-medium wh-data-date-cell min-w-[9.5rem]">
                        <div className="relative z-10 flex flex-col gap-1.5 min-w-0">
                          <WorkingHoursDateLabel dateKey={row.dateKey} />
                          {hasClock && (
                            <div className="flex flex-wrap items-center gap-1.5">
                              {row.clock!.hasManual && (
                                <>
                                  <span
                                    className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-amber-100 text-amber-700 border border-amber-200 shrink-0"
                                    title="Manual entry"
                                  >
                                    <PencilSquareIcon className="w-4 h-4" />
                                  </span>
                                  {clockInApprovalWatermarkLabel(approvalStatus) && (
                                    <span
                                      className={`text-xs font-medium leading-none ${clockInApprovalLabelClass(approvalStatus)}`}
                                    >
                                      {clockInApprovalWatermarkLabel(approvalStatus)}
                                    </span>
                                  )}
                                </>
                              )}
                              {row.clock!.hasAutomatic && (
                                <span
                                  className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-gray-100 text-gray-600 border border-gray-200 shrink-0"
                                  title="Automatic entry"
                                >
                                  <BoltIcon className="w-4 h-4" />
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="min-w-[160px]">
                        {row.unavailabilities.length > 0 ? (
                          <div className="flex flex-col gap-2">
                            {row.unavailabilities.map((unavail) => (
                              <UnavailabilityTypeBadge
                                key={`${unavail.id}-${unavail.date}`}
                                type={unavail.unavailability_type}
                              />
                            ))}
                          </div>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td>
                        {hasClock ? (
                          <TimeListCell value={row.clock!.clockIns} />
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td>
                        {hasClock ? (
                          <TimeListCell value={row.clock!.clockOuts} />
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap font-semibold text-primary">
                        {hasClock ? (
                          sumClockDurations(filterCountedClockInRecords(dayRecords))
                        ) : (
                          <span className="text-gray-400 font-normal">—</span>
                        )}
                      </td>
                      <td className="text-sm max-w-[140px]">
                        {hasClock ? row.clock!.workplacesIn : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="text-sm max-w-[140px]">
                        {hasClock ? row.clock!.workplacesOut : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="max-w-[160px] truncate text-sm text-gray-500">
                        {hasClock ? row.clock!.notes : <span className="text-gray-400">—</span>}
                      </td>
                      <td>
                        {row.unavailabilities.some((u) => u.document_url) ? (
                          <div className="flex flex-wrap items-center gap-1">
                            {row.unavailabilities
                              .filter((u) => u.document_url)
                              .map((unavail) => {
                                const docName = documentNameFromUrl(unavail.document_url!);
                                return (
                                  <button
                                    key={`doc-${unavail.id}-${unavail.date}`}
                                    type="button"
                                    className="btn btn-ghost btn-sm btn-circle min-h-10 min-w-10 h-10 w-10 hover:bg-base-200"
                                    title={docName}
                                    aria-label={`View ${docName}`}
                                    onClick={() =>
                                      setSelectedDocument({
                                        url: unavail.document_url!,
                                        name: docName,
                                        reason: unavailabilityReasonText(unavail),
                                        uploadedAt: unavail.created_at,
                                      })
                                    }
                                  >
                                    <DocumentFileGlyph fileName={docName} className="h-7 w-7" />
                                  </button>
                                );
                              })}
                          </div>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="w-12 min-w-[3rem] px-2 py-3 text-right whitespace-nowrap align-middle">
                        <WorkingHoursRowActionsMenu
                            dateKey={row.dateKey}
                            unavailabilities={row.unavailabilities}
                            hasClock={hasClock}
                            loading={loading}
                            deletingRowKey={deletingRowKey}
                            deletingClockInDay={deletingClockInDay}
                            readOnly={isRowLockedForSubmission(row.dateKey)}
                            onEditUnavailability={(unavail) => {
                              if (isRowLockedForSubmission(unavail.date)) {
                                toast.error(monthLockedMessage);
                                return;
                              }
                              setEditingRow(unavail);
                            }}
                            onDeleteUnavailability={(unavail) => void handleDeleteUnavailability(unavail)}
                            onEditClockIn={(dateKey) => {
                              if (isRowLockedForSubmission(dateKey)) {
                                toast.error(monthLockedMessage);
                                return;
                              }
                              setEditingClockInDay(dateKey);
                            }}
                            onDeleteClockIn={(dateKey) => void handleDeleteClockInDay(dateKey)}
                        />
                      </td>
                    </tr>,
                  ];
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <style>{`
        .my-profile-hours-shell table.my-profile-hours-table {
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
          border-collapse: separate !important;
          border-spacing: 0 10px !important;
        }

        .my-profile-hours-shell .table tbody tr:hover {
          background-color: transparent !important;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody tr {
          background: transparent !important;
          border-radius: 18px !important;
          overflow: visible !important;
          box-shadow: none !important;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody td {
          border: none !important;
          background: #ffffff !important;
          box-shadow: none !important;
          vertical-align: middle;
          padding: 1rem 1.1rem !important;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody td.wh-data-date-cell {
          border-top-left-radius: 18px !important;
          border-bottom-left-radius: 18px !important;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody td:last-child {
          border-top-right-radius: 18px !important;
          border-bottom-right-radius: 18px !important;
          overflow: visible !important;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody tr:hover td {
          background: #f1f5f9 !important;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody tr.approval-row-declined td {
          background: #fee2e2 !important;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody tr.approval-row-declined:hover td {
          background: #fecaca !important;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-missing-placeholder td.wh-week-divider-cell,
        .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-holiday-placeholder td.wh-week-divider-cell {
          background: transparent !important;
          box-shadow: none !important;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-missing-placeholder td {
          background: #f3f4f6 !important;
          box-shadow: none !important;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-missing-placeholder td.wh-data-date-cell {
          border-top-left-radius: 18px !important;
          border-bottom-left-radius: 18px !important;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-missing-placeholder td:last-child {
          border-top-right-radius: 18px !important;
          border-bottom-right-radius: 18px !important;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-missing-placeholder-interactive {
          cursor: pointer;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-missing-placeholder-interactive:hover td {
          background: #e8eaed !important;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-holiday-placeholder td {
          background: #f5f3ff !important;
          box-shadow: none !important;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-holiday-placeholder td.wh-data-date-cell {
          border-top-left-radius: 18px !important;
          border-bottom-left-radius: 18px !important;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-holiday-placeholder td:last-child {
          border-top-right-radius: 18px !important;
          border-bottom-right-radius: 18px !important;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-holiday-placeholder-interactive {
          cursor: pointer;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-holiday-placeholder-interactive:hover td {
          background: #ede9fe !important;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-bulk-selected td {
          box-shadow: inset 0 0 0 2px rgba(59, 130, 246, 0.45) !important;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody td.wh-week-divider-cell {
          position: relative;
          width: 2rem;
          min-width: 2rem;
          max-width: 2rem;
          padding: 1rem 0.2rem 1rem 0.35rem !important;
          background: transparent !important;
          box-shadow: none !important;
          vertical-align: top;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody td.wh-week-divider-cell .wh-week-divider-line {
          position: absolute;
          left: 0;
          top: 0.5rem;
          bottom: 0.5rem;
          width: 2px;
          border-radius: 999px;
          background: var(--wh-week-accent, #94a3b8);
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody td.wh-week-divider-cell .wh-week-divider-label {
          display: block;
          margin-left: 0.45rem;
          padding-top: 0.35rem;
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--wh-week-accent, #64748b);
          line-height: 1;
          white-space: nowrap;
          writing-mode: vertical-rl;
          text-orientation: mixed;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody tr:hover td.wh-week-divider-cell {
          background: transparent !important;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-week-between-row td {
          background: transparent !important;
          box-shadow: none !important;
          padding: 0.35rem 0.75rem 0.15rem !important;
          border: none !important;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-week-between-row + tr td.wh-data-date-cell {
          border-top-left-radius: 18px !important;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody .wh-week-between-inner {
          display: flex;
          align-items: center;
          gap: 0.65rem;
          min-width: 0;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody .wh-week-between-line {
          flex: 1 1 auto;
          height: 2px;
          border-radius: 999px;
          background: var(--wh-week-accent, #94a3b8);
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody .wh-week-between-label {
          flex: 0 0 auto;
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--wh-week-accent, #64748b);
          white-space: nowrap;
        }

        .my-profile-hours-shell table.my-profile-hours-table thead,
        .my-profile-hours-shell table.my-profile-hours-table thead tr,
        .my-profile-hours-shell table.my-profile-hours-table thead th {
          background-color: #ececec !important;
          background-image: none !important;
          border-bottom: none !important;
        }
      `}</style>

      {calendarModalOpen && typeof window !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setCalendarModalOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-2xl flex flex-col overflow-hidden max-h-[92vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-base-200 shrink-0">
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <h3 className="text-base font-semibold text-gray-900">My Availability</h3>
                <MissingDaysBadge count={calendarMissingDays} loading={loading} />
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    if (isMonthSubmitted) {
                      toast.error(monthLockedMessage);
                      return;
                    }
                    calendarRef.current?.openAddRangeModal();
                  }}
                  className="btn btn-xs btn-primary gap-1"
                  disabled={isMonthSubmitted}
                  title={isMonthSubmitted ? monthLockedMessage : 'Add unavailability range'}
                >
                  <PlusIcon className="w-3.5 h-3.5" />
                  Add range
                </button>
                <button
                  type="button"
                  onClick={() => setCalendarModalOpen(false)}
                  className="btn btn-xs btn-ghost btn-circle"
                  title="Close calendar"
                >
                  <XMarkIcon className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="p-5 overflow-y-auto min-h-0">
              <CompactAvailabilityCalendar
                key={`cal-${year}-${month}`}
                ref={calendarRef}
                employeeId={employeeId}
                initialYear={year}
                initialMonth={month}
                onMonthChange={handleCalendarMonthChange}
                onAvailabilityChange={() => void fetchRecords()}
              />
            </div>
          </div>
        </div>,
        document.body,
      )}

      <ClockInDayEditModal
        isOpen={!!editingClockInDay}
        dateKey={editingClockInDay ?? ''}
        sessions={editingClockInSessions}
        onClose={() => setEditingClockInDay(null)}
        onSaved={() => {
          void fetchRecords();
          void fetchClockInStatus();
        }}
      />

      <ManualClockInModal
        isOpen={manualClockInOpen}
        employeeId={employeeId}
        userId={user?.id ?? ''}
        initialDateKey={manualClockInInitialDateKey}
        onClose={() => {
          setManualClockInOpen(false);
          setManualClockInInitialDateKey(null);
        }}
        onSaved={() => void fetchRecords()}
      />

      <BulkManualClockInModal
        isOpen={bulkManualClockInOpen}
        employeeId={employeeId}
        userId={user?.id ?? ''}
        selectedDateKeys={[...bulkSelectedDateKeys]}
        onClose={() => setBulkManualClockInOpen(false)}
        onSaved={handleBulkSaved}
      />

      <UnavailabilityDayEditModal
        isOpen={!!editingRow}
        row={editingRow}
        employeeId={employeeId}
        onClose={() => setEditingRow(null)}
        onSaved={() => void fetchRecords()}
      />

      {user?.id && (
        <SubmitWorkingHoursModal
          isOpen={submitModalOpen}
          onClose={() => setSubmitModalOpen(false)}
          employeeId={employeeId}
          userId={user.id}
          initialYear={year}
          initialMonth={month}
          onSubmitted={handleSubmissionSaved}
        />
      )}

      {selectedDocument && (
        <DocumentViewerModal
          isOpen
          onClose={() => setSelectedDocument(null)}
          documentUrl={selectedDocument.url}
          documentName={selectedDocument.name}
          employeeName={employeeName}
          uploadedAt={selectedDocument.uploadedAt}
          sickDaysReason={selectedDocument.reason}
        />
      )}
    </div>
  );
};

export default WorkingHoursTab;
