import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CalendarDaysIcon,
  CheckIcon,
  ClockIcon,
  FunnelIcon,
  ChevronDownIcon,
  PencilSquareIcon,
  PlusIcon,
  SquaresPlusIcon,
  EllipsisVerticalIcon,
  TrashIcon,
  XMarkIcon,
  ArrowUturnLeftIcon,
} from '@heroicons/react/24/outline';
import {
  CheckBadgeIcon,
  ClockIcon as ClockSolidIcon,
  XCircleIcon,
} from '@heroicons/react/24/solid';
import { toast } from 'react-hot-toast';
import { FaFileExcel } from 'react-icons/fa';
import { supabase } from '../../lib/supabase';
import CompactAvailabilityCalendar, {
  type CompactAvailabilityCalendarRef,
} from '../CompactAvailabilityCalendar';
import {
  aggregateClockInRecordsByDay,
  buildMergedTimeAndUnavailabilityExportRows,
  exportMergedTimeAndUnavailabilitiesToExcel,
  sumCountedClockDurationsMs,
  type DailyClockInSummary,
} from '../../lib/workingHoursExport';
import {
  buildMonthWeekNumberLookup,
  dateRangeToIsoBounds,
  durationVsMinHoursBadgeClass,
  durationVsMinHoursTitle,
  durationVsMinHoursTone,
  formatWorkingHoursDateLabel,
  formatWorkingHoursWeekday,
  getSundayWeekStartKey,
  isIsraeliWorkdayIso,
  monthRange,
  sumClockDurations,
  toDateInputValue,
} from '../../lib/employeeClockInFormat';
import { normalizeEmployeeMinHours } from '../../lib/employeeLeadReporting';
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
  filterCountedUnavailability,
  countUnavailabilityApprovalBlockers,
  getUnavailabilityApprovalStatus,
  unavailabilityApprovalWatermarkLabel,
  type EmployeeUnavailabilityEntry,
  type EmployeeUnavailabilityDayRow,
} from '../../lib/employeeUnavailabilities';
import UnavailabilityTypeBadge from '../UnavailabilityTypeBadge';
import DocumentViewerModal from '../DocumentViewerModal';
import { DocumentFileGlyph } from '../../lib/documentFileGlyphs';
import UnavailabilityDayEditModal from './UnavailabilityDayEditModal';
import ManualClockInModal from './ManualClockInModal';
import BulkManualClockInModal from './BulkManualClockInModal';
import ClockInDayEditModal from './ClockInDayEditModal';
import ClockInDayNotesModal from './ClockInDayNotesModal';
import SubmitWorkingHoursModal from './SubmitWorkingHoursModal';
import WorkingHoursMobileList from './WorkingHoursMobileList';
import ProfileBottomSheetModal from './ProfileBottomSheetModal';
import YearWheelPicker from '../YearWheelPicker';
import { buildWorkingHoursMonthCoverage, type WorkingHoursDayCoverage } from '../../lib/workingHoursMonthCoverage';
import {
  cancelWorkingHoursSubmission,
  fetchWorkingHoursSubmission,
  type EmployeeWorkingHoursSubmission,
} from '../../lib/employeeWorkingHoursSubmissions';
import {
  clockInApprovalRowClass,
  countClockInApprovalBlockers,
  clockInApprovalSubmitBlockMessage,
  filterCountedClockInRecords,
  getClockInApprovalStatus,
  getDayClockInApprovalStatus,
  clockInApprovalWatermarkLabel,
  formatDayDeclineNotes,
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
  decline_note: string | null;
  manually: boolean;
  approved: boolean;
  declined: boolean;
};

interface WorkingHoursTabProps {
  employeeId: number;
  employeeName?: string;
  /** When opening from HR board, land on the selected month/year. */
  initialYear?: number;
  initialMonth?: number;
  /** HR Management employee file: flat table (no grey card gutter), matches Leave/Employees. */
  embedded?: boolean;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const MERGED_COL_SPAN = 8;
const WH_PLACEHOLDER_HINT_COL_SPAN = MERGED_COL_SPAN - 2;

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

function WorkingHoursWeekBetweenRow({
  weekNum,
  columnCount,
}: {
  weekNum: number;
  columnCount: number;
}) {
  const accent = getWeekAccentColor(weekNum);
  return (
    <tr className="wh-week-between-row">
      <td
        colSpan={columnCount}
        className="wh-week-between-cell"
        style={{ '--wh-week-accent': accent } as React.CSSProperties}
      >
        <span className="wh-week-between-label">Week {weekNum}</span>
      </td>
    </tr>
  );
}

const WH_DATA_CELL = 'wh-data-cell text-[0.875rem] md:text-[1rem] leading-snug';
const WH_DATE_CELL = 'wh-data-date-cell text-sm md:text-[0.875rem]';

function dayHasSavedNotes(dayRecords: ClockInRow[]): boolean {
  return dayRecords.some((record) => Boolean(record.notes?.trim()));
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

function workingHoursDateCellStyle(weekNum?: number): React.CSSProperties | undefined {
  if (!weekNum) return undefined;
  return { '--wh-week-accent': getWeekAccentColor(weekNum) } as React.CSSProperties;
}

function WorkingHoursClockEntryBadges({
  hasManual,
}: {
  hasManual: boolean;
}) {
  if (!hasManual) return null;

  return (
    <span
      className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-amber-100 text-amber-700 border border-amber-200 shrink-0"
      title="Manual entry"
    >
      <PencilSquareIcon className="w-4 h-4" />
    </span>
  );
}

type DayApprovalDisplayStatus = 'approved' | 'pending' | 'declined';

const DAY_APPROVAL_ORDER: DayApprovalDisplayStatus[] = ['declined', 'pending', 'approved'];

function WorkingHoursApprovalStatusLabel({
  status,
}: {
  status: DayApprovalDisplayStatus;
}) {
  const label =
    status === 'pending'
      ? 'Waiting for approval'
      : status === 'declined'
        ? 'Declined'
        : 'Approved';
  const colorClass =
    status === 'pending'
      ? 'text-sky-700'
      : status === 'declined'
        ? 'text-red-700'
        : 'text-emerald-700';
  const Icon =
    status === 'pending' ? ClockSolidIcon : status === 'declined' ? XCircleIcon : CheckBadgeIcon;

  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium leading-none whitespace-nowrap ${colorClass}`}
    >
      <Icon className="h-5 w-5 shrink-0" aria-hidden />
      {label}
    </span>
  );
}

function collectDayApprovalStatuses(params: {
  hasManualClock: boolean;
  clockApprovalStatus: ReturnType<typeof getDayClockInApprovalStatus>;
  unavailabilities: EmployeeUnavailabilityDayRow[];
}): DayApprovalDisplayStatus[] {
  const found = new Set<DayApprovalDisplayStatus>();

  if (params.hasManualClock) {
    if (clockInApprovalWatermarkLabel(params.clockApprovalStatus)) {
      found.add(params.clockApprovalStatus);
    }
  }

  for (const unavail of params.unavailabilities) {
    const leaveStatus = getUnavailabilityApprovalStatus(unavail);
    if (unavailabilityApprovalWatermarkLabel(leaveStatus)) {
      found.add(leaveStatus);
    }
  }

  return DAY_APPROVAL_ORDER.filter((status) => found.has(status));
}

const SUBMIT_HOURS_BTN_CLASS =
  'inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold border-0 shadow-sm transition-all duration-200 bg-gradient-to-r from-emerald-600 to-teal-600 text-white hover:from-emerald-700 hover:to-teal-700 hover:shadow-md active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none disabled:shadow-none';

const CANCEL_SUBMISSION_BTN_CLASS =
  'inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold border-0 shadow-sm transition-all duration-200 bg-amber-50 text-amber-900 hover:bg-amber-100 hover:shadow-md active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none disabled:shadow-none';

type WorkingHoursRowFilter = 'approved' | 'declined' | 'pending' | 'unavailability' | 'clock';

const ROW_FILTER_OPTIONS: {
  id: WorkingHoursRowFilter;
  label: string;
}[] = [
  { id: 'approved', label: 'Approved' },
  { id: 'declined', label: 'Declined' },
  { id: 'pending', label: 'Waiting for approval' },
  { id: 'unavailability', label: 'Unavailabilities' },
  { id: 'clock', label: 'Clock in & out' },
];

type MergedWorkingHoursDayRow = {
  dateKey: string;
  date: string;
  clock: DailyClockInSummary | null;
  unavailabilities: EmployeeUnavailabilityDayRow[];
  /** Workday with no entry — muted clickable row. */
  isMissingPlaceholder?: boolean;
  /** Holiday with no entry — muted clickable row (may still require hours). */
  isHolidayPlaceholder?: boolean;
  /** Fri/Sat with no entry — weekend marker row. */
  isWeekendPlaceholder?: boolean;
  /** Fri/Sat day (with or without entries). */
  isWeekend?: boolean;
  holidayNames?: string[];
};

function buildFullMonthTableRows(
  mergedRows: MergedWorkingHoursDayRow[],
  coverageDays: WorkingHoursDayCoverage[],
): MergedWorkingHoursDayRow[] {
  const byKey = new Map(mergedRows.map((row) => [row.dateKey, row]));
  const rows: MergedWorkingHoursDayRow[] = [];

  for (const day of coverageDays) {
    const isWeekendDay = day.status === 'weekend' || !isIsraeliWorkdayIso(day.dateKey);
    const existing = byKey.get(day.dateKey);
    if (existing) {
      rows.push({
        ...existing,
        isWeekend: isWeekendDay || existing.isWeekend,
      });
    } else if (day.status === 'weekend') {
      rows.push({
        dateKey: day.dateKey,
        date: formatWorkingHoursDateLabel(day.dateKey),
        clock: null,
        unavailabilities: [],
        isWeekendPlaceholder: true,
        isWeekend: true,
      });
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
  if (row.isMissingPlaceholder || row.isHolidayPlaceholder || row.isWeekendPlaceholder) return false;
  if (activeFilters.size === 0) return true;

  const hasClock = row.clock != null;
  const hasUnavail = row.unavailabilities.length > 0;
  const approvalStatus = getDayClockInApprovalStatus(dayRecords, {
    hasManualClockSummary: row.clock?.hasManual === true,
  });

  const matches: Record<WorkingHoursRowFilter, boolean> = {
    approved:
      dayRecords.some(
        (record) => isManualClockInRecord(record) && getClockInApprovalStatus(record) === 'approved',
      ) ||
      row.unavailabilities.some(
        (u) => getUnavailabilityApprovalStatus(u) === 'approved',
      ),
    declined:
      (hasClock && approvalStatus === 'declined') ||
      row.unavailabilities.some((u) => getUnavailabilityApprovalStatus(u) === 'declined'),
    pending:
      (hasClock && approvalStatus === 'pending') ||
      row.unavailabilities.some((u) => getUnavailabilityApprovalStatus(u) === 'pending'),
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
  const showIndex = parts.length > 1;
  return (
    <div className="flex flex-col gap-0.5">
      {parts.map((part, i) => (
        <span key={`${part}-${i}`} className="inline-flex items-center gap-1.5 whitespace-nowrap">
          {showIndex ? (
            <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-gray-100 px-1.5 text-[11px] font-semibold tabular-nums text-gray-600">
              {i + 1}
            </span>
          ) : null}
          {part}
        </span>
      ))}
    </div>
  );
}

function TotalDurationBadge({
  workedMs,
  label,
  minHours,
}: {
  workedMs: number;
  label: string;
  minHours: number;
}) {
  const tone = durationVsMinHoursTone(workedMs, minHours);
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${durationVsMinHoursBadgeClass(tone)}`}
      title={durationVsMinHoursTitle(tone, minHours)}
    >
      {label}
    </span>
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

const WorkingHoursTab: React.FC<WorkingHoursTabProps> = ({
  employeeId,
  employeeName = '',
  initialYear,
  initialMonth,
  embedded = false,
}) => {
  const { user } = useAuthContext();
  const calendarRef = useRef<CompactAvailabilityCalendarRef>(null);
  const now = useMemo(() => new Date(), []);
  const [year, setYear] = useState(() =>
    initialYear != null && Number.isFinite(initialYear) ? initialYear : now.getFullYear(),
  );
  const [month, setMonth] = useState(() =>
    initialMonth != null && initialMonth >= 1 && initialMonth <= 12
      ? initialMonth
      : now.getMonth() + 1,
  );

  useEffect(() => {
    if (initialYear != null && Number.isFinite(initialYear)) setYear(initialYear);
    if (initialMonth != null && initialMonth >= 1 && initialMonth <= 12) setMonth(initialMonth);
  }, [employeeId, initialYear, initialMonth]);

  const periodRange = useMemo(() => monthRange(year, month), [year, month]);
  const dateFrom = periodRange.from;
  const dateTo = periodRange.to;
  const [records, setRecords] = useState<ClockInRow[]>([]);
  const [unavailabilities, setUnavailabilities] = useState<EmployeeUnavailabilityEntry[]>([]);
  const [employeeMinHours, setEmployeeMinHours] = useState(8);
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
  const [editingNotesDay, setEditingNotesDay] = useState<string | null>(null);
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

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { data, error } = await supabase
          .from('tenants_employee')
          .select('min_hours')
          .eq('id', employeeId)
          .maybeSingle();
        if (error) throw error;
        if (!cancelled) {
          setEmployeeMinHours(normalizeEmployeeMinHours(data?.min_hours));
        }
      } catch (err) {
        console.error('WorkingHoursTab min_hours:', err);
        if (!cancelled) setEmployeeMinHours(8);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [employeeId]);

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
             approved, declined, decline_note,
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
        if (msg.includes('approved') || msg.includes('declined') || msg.includes('decline_note')) {
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
    const clockBlockers = countClockInApprovalBlockers(monthRecords);
    const leaveBlockers = countUnavailabilityApprovalBlockers(unavailabilities);
    return {
      pendingCount: clockBlockers.pendingCount + leaveBlockers.pendingCount,
      declinedCount: clockBlockers.declinedCount + leaveBlockers.declinedCount,
    };
  }, [records, unavailabilities, year, month]);

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
  const editingNotesSessions = editingNotesDay
    ? recordsByDay.get(editingNotesDay) ?? []
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
    for (const row of unavailabilityDayRows) {
      if (getUnavailabilityApprovalStatus(row) === 'pending') {
        pendingApprovalDates.add(row.date);
      }
    }
    return buildWorkingHoursMonthCoverage(
      year,
      month,
      filterCountedClockInRecords(records),
      filterCountedUnavailability(unavailabilities),
      { pendingApprovalDates },
    );
  }, [year, month, records, unavailabilities, unavailabilityDayRows, recordsByDay, holidayMapVersion]);

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
  const rowFilterSummary = useMemo(() => {
    if (rowFilters.size === 0) return 'All';
    if (rowFilters.size === 1) {
      const only = ROW_FILTER_OPTIONS.find((o) => rowFilters.has(o.id));
      return only?.label ?? '1 filter';
    }
    return `${rowFilters.size} filters`;
  }, [rowFilters]);

  const monthWeekLookup = useMemo(
    () => buildMonthWeekNumberLookup(year, month),
    [year, month],
  );

  const weekRowMeta = useMemo(
    () => buildWorkingHoursWeekRowMeta(filteredMergedDayRows, monthWeekLookup),
    [filteredMergedDayRows, monthWeekLookup],
  );

  const tableColSpan = useMemo(
    () => MERGED_COL_SPAN + (bulkSelectMode ? 1 : 0),
    [bulkSelectMode],
  );

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

  const handlePlaceholderAddUnavailability = useCallback((dateKey: string) => {
    if (isMonthSubmitted) {
      toast.error(monthLockedMessage);
      return;
    }
    const [y, m] = dateKey.split('-').map(Number);
    if (!Number.isFinite(y) || !Number.isFinite(m)) return;
    setCalendarViewYear(y);
    setCalendarViewMonth(m);
    setPendingCalendarDateKey(dateKey);
    setCalendarModalOpen(true);
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
    const countedRecords = filterCountedClockInRecords(records);
    const mergedRows = buildMergedTimeAndUnavailabilityExportRows(
      countedRecords,
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
        employeeName: employeeName || `Employee #${employeeId}`,
        dateFrom,
        dateTo,
        periodTotalMs: sumCountedClockDurationsMs(countedRecords),
        filenameSuffix: employeeName || String(employeeId),
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
    <div
      className={[
        'my-profile-hours-shell w-full max-w-full min-w-0 space-y-4',
        embedded ? 'my-profile-hours-shell--flat' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {!embedded && (
      <div className="flex flex-col gap-3 px-1 sm:flex-row sm:items-center sm:justify-between w-full min-w-0">
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
      )}

      {/* Filters */}
      <div
        className={
          embedded
            ? 'space-y-4'
            : 'rounded-[18px] bg-white px-4 py-4 md:px-5 shadow-sm space-y-4'
        }
      >
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
          <div className="min-w-0 flex-1 flex flex-col sm:flex-row sm:items-end gap-3">
            <div className="min-w-0 w-full sm:max-w-xs shrink-0">
              <span className="label-text text-sm text-gray-600 mb-1.5 font-medium block">Show</span>
              <div className="dropdown w-full">
                <button
                  type="button"
                  tabIndex={0}
                  className="btn btn-outline border-gray-200 bg-white hover:bg-gray-50 w-full h-12 min-h-12 justify-between font-normal text-base text-gray-800 rounded-full px-4"
                >
                  <span className="truncate">{rowFilterSummary}</span>
                  <ChevronDownIcon className="w-4 h-4 shrink-0 text-gray-400" aria-hidden />
                </button>
                <ul
                  tabIndex={0}
                  className="dropdown-content menu z-30 mt-2 w-full min-w-[16rem] rounded-xl border border-gray-200 bg-white p-2 shadow-lg"
                >
                  {ROW_FILTER_OPTIONS.map((option) => {
                    const active = rowFilters.has(option.id);
                    return (
                      <li key={option.id}>
                        <label className="flex items-center gap-3 cursor-pointer rounded-lg px-3 py-2.5">
                          <input
                            type="checkbox"
                            className="checkbox checkbox-sm checkbox-primary"
                            checked={active}
                            onChange={() => toggleRowFilter(option.id)}
                          />
                          <span className="text-sm text-gray-800">{option.label}</span>
                        </label>
                      </li>
                    );
                  })}
                  {hasActiveRowFilters && (
                    <>
                      <div className="border-t border-gray-100 my-1" />
                      <li>
                        <button
                          type="button"
                          className="text-sm text-gray-500 justify-center"
                          onClick={() => setRowFilters(new Set())}
                        >
                          Clear filters
                        </button>
                      </li>
                    </>
                  )}
                </ul>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 pb-0.5">
              <button
                type="button"
                className="btn btn-sm btn-outline btn-primary gap-2 h-10 min-h-10 rounded-full"
                onClick={openCalendarModal}
                disabled={isMonthSubmitted}
                title={isMonthSubmitted ? monthLockedMessage : undefined}
              >
                <CalendarDaysIcon className="w-4 h-4" />
                Add unavailability
              </button>
              <button
                type="button"
                className="btn btn-sm rounded-full gap-2 border-0 bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-600/50 h-10 min-h-10"
                onClick={handleExportExcel}
                disabled={exporting || loading || mergedDayRows.length === 0}
                title="Download this employee's working hours as Excel"
              >
                {exporting ? (
                  <span className="loading loading-spinner loading-sm" />
                ) : (
                  <FaFileExcel className="w-4 h-4" />
                )}
                Export to Excel
              </button>
              <button
                type="button"
                className={`btn btn-sm gap-2 h-10 min-h-10 rounded-full ${
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
                className="btn btn-sm btn-outline btn-primary gap-2 h-10 min-h-10 rounded-full"
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
        </div>
      </div>

      {/* Working hours & unavailabilities */}
      <div className="w-full">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-1">
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
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <span className="text-base font-semibold text-primary">
              Period total: {periodTotal}
            </span>
            <MissingDaysBadge count={periodMissingDays} loading={loading} />
          </div>
        </div>
        {bulkSelectMode && (
          <div className="rounded-xl border border-primary/25 bg-primary/5 px-4 py-3 mb-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-gray-800">
              <span className="font-semibold">Select days</span>
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
        <WorkingHoursMobileList
          rows={filteredMergedDayRows}
          weekMeta={weekRowMeta}
          loading={loading}
          hasActiveRowFilters={hasActiveRowFilters}
          bulkSelectMode={bulkSelectMode}
          bulkSelectedDateKeys={bulkSelectedDateKeys}
          isMonthSubmitted={isMonthSubmitted}
          loadingActions={loading}
          deletingRowKey={deletingRowKey}
          deletingClockInDay={deletingClockInDay}
          recordsByDay={recordsByDay}
          minHours={employeeMinHours}
          getWeekAccentColor={getWeekAccentColor}
          isRowLocked={isRowLockedForSubmission}
          onToggleBulkSelect={toggleBulkDateSelection}
          onPlaceholderAddUnavailability={handlePlaceholderAddUnavailability}
          onPlaceholderAddClockIn={handlePlaceholderAddClockIn}
          onEditNotes={setEditingNotesDay}
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
          onViewDocument={setSelectedDocument}
        />
        <div
          className={
            embedded
              ? 'hidden md:block w-full overflow-x-auto'
              : 'hidden md:block w-full overflow-x-auto rounded-[18px] bg-[#ececec] px-1 py-2 pb-4'
          }
        >
          <table
            className={
              embedded
                ? 'table my-profile-hours-table w-full min-w-[52rem] text-base'
                : 'table my-profile-hours-table w-full min-w-[52rem] table-fixed'
            }
          >
            <thead>
              <tr
                className={
                  embedded ? 'text-sm uppercase tracking-wider text-gray-500' : undefined
                }
              >
                {bulkSelectMode && (
                  <th
                    className={
                      embedded
                        ? 'w-10 min-w-[2.5rem] px-2 py-3.5 bg-transparent'
                        : 'w-10 min-w-[2.5rem] px-2 py-3.5 bg-[#ececec]'
                    }
                    aria-label="Select"
                  />
                )}
                <th
                  className={
                    embedded
                      ? 'bg-transparent font-semibold text-left min-w-[9.5rem]'
                      : 'px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-base-content/40 bg-[#ececec] min-w-[9.5rem]'
                  }
                >
                  Date
                </th>
                <th
                  className={
                    embedded
                      ? 'bg-transparent font-semibold text-left'
                      : 'px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-base-content/40 bg-[#ececec]'
                  }
                >
                  Unavailability
                </th>
                <th
                  className={
                    embedded
                      ? 'bg-transparent font-semibold text-left'
                      : 'px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-base-content/40 bg-[#ececec]'
                  }
                >
                  Clock in
                </th>
                <th
                  className={
                    embedded
                      ? 'bg-transparent font-semibold text-left'
                      : 'px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-base-content/40 bg-[#ececec]'
                  }
                >
                  Clock out
                </th>
                <th
                  className={
                    embedded
                      ? 'bg-transparent font-semibold text-left'
                      : 'px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-base-content/40 bg-[#ececec]'
                  }
                >
                  Total duration
                </th>
                <th
                  className={
                    embedded
                      ? 'bg-transparent font-semibold text-left'
                      : 'px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-base-content/40 bg-[#ececec]'
                  }
                >
                  Workplace
                </th>
                <th
                  className={
                    embedded
                      ? 'bg-transparent font-semibold text-left'
                      : 'px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-base-content/40 bg-[#ececec]'
                  }
                >
                  Notes
                </th>
                <th
                  className={
                    embedded
                      ? 'bg-transparent font-semibold text-left'
                      : 'px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-base-content/40 bg-[#ececec]'
                  }
                >
                  Document
                </th>
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
                  const isPlaceholder =
                    row.isMissingPlaceholder ||
                    row.isHolidayPlaceholder ||
                    row.isWeekendPlaceholder;
                  const isBulkSelectable =
                    bulkSelectMode &&
                    (row.isMissingPlaceholder || row.isHolidayPlaceholder) &&
                    !isMonthSubmitted;
                  const isBulkSelected = bulkSelectedDateKeys.has(row.dateKey);
                  const weekMeta = weekRowMeta.get(row.dateKey);
                  const weekBetweenRow =
                    weekMeta?.isFirstInWeek ? (
                      <WorkingHoursWeekBetweenRow
                        key={`wh-week-between-${weekMeta.weekNum}`}
                        weekNum={weekMeta.weekNum}
                        columnCount={tableColSpan}
                      />
                    ) : null;

                  if (isPlaceholder) {
                    const isWeekend = row.isWeekendPlaceholder === true;
                    const placeholderInteractive = !isMonthSubmitted && !isWeekend;
                    const isHoliday = row.isHolidayPlaceholder;
                    const holidayLabel = row.holidayNames?.[0];
                    const rowClass = isWeekend
                      ? 'wh-weekend-placeholder'
                      : isHoliday
                        ? 'wh-holiday-placeholder'
                        : 'wh-missing-placeholder';
                    const hintText = isWeekend
                      ? 'Weekend'
                      : isHoliday
                        ? holidayLabel
                          ? `${holidayLabel} — no entry yet`
                          : 'Holiday — no entry yet'
                        : 'No entry yet';
                    return [
                      weekBetweenRow,
                      <tr
                        key={row.dateKey}
                        id={`wh-row-${row.dateKey}`}
                        className={[
                          rowClass,
                          placeholderInteractive && !bulkSelectMode ? 'wh-placeholder-interactive' : '',
                          isBulkSelected ? 'wh-bulk-selected' : '',
                        ].filter(Boolean).join(' ')}
                        onClick={
                          isBulkSelectable
                            ? () => toggleBulkDateSelection(row.dateKey)
                            : undefined
                        }
                      >
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
                        <td
                          className={`relative whitespace-nowrap font-medium wh-data-date-cell wh-date-week-accent ${WH_DATE_CELL}`}
                          style={workingHoursDateCellStyle(weekMeta?.weekNum)}
                        >
                          <div className="relative z-10 flex flex-col items-start gap-1.5 min-w-0">
                            <WorkingHoursDateLabel dateKey={row.dateKey} muted />
                          </div>
                        </td>
                        {isWeekend ? (
                          <td
                            colSpan={WH_PLACEHOLDER_HINT_COL_SPAN + 1}
                            className={`${WH_DATA_CELL} wh-placeholder-hint text-center`}
                          >
                            Weekend
                          </td>
                        ) : (
                          <>
                            <td
                              colSpan={WH_PLACEHOLDER_HINT_COL_SPAN}
                              className={`${WH_DATA_CELL} wh-placeholder-hint italic`}
                            >
                              {hintText}
                            </td>
                            <td className="relative px-2 py-3 whitespace-nowrap align-middle min-w-[10.5rem] lg:min-w-[6rem]">
                              {placeholderInteractive && !bulkSelectMode ? (
                                <div className="wh-placeholder-row-actions flex flex-row flex-nowrap items-center justify-end gap-1.5 lg:absolute lg:right-2 lg:top-1/2 lg:z-10 lg:-translate-y-1/2">
                                  <button
                                    type="button"
                                    className="btn btn-xs btn-outline btn-primary gap-1 shrink-0 whitespace-nowrap"
                                    onClick={() => handlePlaceholderAddUnavailability(row.dateKey)}
                                    title="Add unavailability"
                                  >
                                    <CalendarDaysIcon className="w-3.5 h-3.5 shrink-0" />
                                    <span className="hidden lg:inline">Add unavailability</span>
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-xs btn-outline btn-primary gap-1 shrink-0 whitespace-nowrap"
                                    onClick={() => handlePlaceholderAddClockIn(row.dateKey)}
                                    title="Add manual clock-in and clock-out"
                                  >
                                    <PlusIcon className="w-3.5 h-3.5 shrink-0" />
                                    <span className="hidden lg:inline">Add clock-in</span>
                                  </button>
                                </div>
                              ) : (
                                <span className="text-gray-400 text-xs">—</span>
                              )}
                            </td>
                          </>
                        )}
                      </tr>,
                    ];
                  }

                  const hasClock = row.clock != null;
                  const dayRecords = recordsByDay.get(row.dateKey) ?? [];
                  const approvalStatus = getDayClockInApprovalStatus(dayRecords, {
                    hasManualClockSummary: row.clock?.hasManual === true,
                  });
                  const declineNotes = formatDayDeclineNotes(dayRecords);
                  return [
                    weekBetweenRow,
                    <tr
                      key={row.dateKey}
                      id={`wh-row-${row.dateKey}`}
                      className={`wh-data-row ${clockInApprovalRowClass(approvalStatus)}`}
                    >
                      {bulkSelectMode && <td className="w-10 min-w-[2.5rem] px-2" aria-hidden />}
                      <td
                        className={`relative font-medium min-w-[9.5rem] wh-data-date-cell wh-date-week-accent ${WH_DATE_CELL}`}
                        style={workingHoursDateCellStyle(weekMeta?.weekNum)}
                      >
                        <div className="relative z-10 flex flex-col items-start gap-1.5 min-w-0">
                          <WorkingHoursDateLabel dateKey={row.dateKey} />
                          <div className="flex flex-wrap items-center gap-1.5">
                            {row.clock?.hasManual ? (
                              <WorkingHoursClockEntryBadges hasManual={row.clock.hasManual} />
                            ) : null}
                            {collectDayApprovalStatuses({
                              hasManualClock: row.clock?.hasManual === true,
                              clockApprovalStatus: approvalStatus,
                              unavailabilities: row.unavailabilities,
                            }).map((status) => (
                              <WorkingHoursApprovalStatusLabel key={status} status={status} />
                            ))}
                          </div>
                          {declineNotes && (
                            <p
                              className="text-xs font-medium leading-snug text-red-700 max-w-[14rem]"
                              title={declineNotes}
                            >
                              {declineNotes}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className={`min-w-[160px] ${WH_DATA_CELL}`}>
                        {row.unavailabilities.length > 0 ? (
                          <div className="flex flex-col gap-2">
                            {row.unavailabilities.map((unavail) => (
                              <div
                                key={`${unavail.id}-${unavail.date}`}
                                className="flex flex-col items-start gap-0.5"
                              >
                                <UnavailabilityTypeBadge
                                  type={unavail.unavailability_type}
                                  size="md"
                                  borderless
                                />
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className={WH_DATA_CELL}>
                        {hasClock ? (
                          <TimeListCell value={row.clock!.clockIns} />
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className={WH_DATA_CELL}>
                        {hasClock ? (
                          <TimeListCell value={row.clock!.clockOuts} />
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className={`whitespace-nowrap ${WH_DATA_CELL}`}>
                        {hasClock ? (
                          <TotalDurationBadge
                            workedMs={sumCountedClockDurationsMs(
                              filterCountedClockInRecords(dayRecords),
                            )}
                            label={sumClockDurations(filterCountedClockInRecords(dayRecords))}
                            minHours={employeeMinHours}
                          />
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className={`max-w-[160px] ${WH_DATA_CELL}`}>
                        {hasClock ? row.clock!.workplacesIn : <span className="text-gray-400">—</span>}
                      </td>
                      <td className={`max-w-[180px] ${WH_DATA_CELL}`}>
                        {dayHasSavedNotes(dayRecords) ? (
                          <button
                            type="button"
                            className="max-w-full truncate text-left text-gray-600 hover:text-primary hover:underline underline-offset-2 cursor-pointer"
                            title={row.clock!.notes}
                            onClick={() => setEditingNotesDay(row.dateKey)}
                          >
                            {row.clock!.notes}
                          </button>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className={WH_DATA_CELL}>
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="flex flex-wrap items-center gap-1 min-w-0 flex-1">
                            {row.unavailabilities.some((u) => u.document_url) ? (
                              row.unavailabilities
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
                                })
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </div>
                          <div className="shrink-0">
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
                          </div>
                        </div>
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
          table-layout: fixed !important;
          width: 100% !important;
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
          box-shadow: none !important;
          vertical-align: middle;
          padding: 1rem 1.1rem !important;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-data-row td {
          background: #ffffff !important;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-data-row:hover td {
          background: #f1f5f9 !important;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-week-between-row td,
        .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-week-between-row:hover td {
          background: transparent !important;
          box-shadow: none !important;
          padding: 0.5rem 0.85rem 0.2rem !important;
          border: none !important;
          border-radius: 0 !important;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody tr.approval-row-declined td {
          background: #fee2e2 !important;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody tr.approval-row-declined:hover td {
          background: #fecaca !important;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-missing-placeholder td,
        .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-missing-placeholder:hover td,
        .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-missing-placeholder.wh-placeholder-interactive:hover td {
          background: #f3f4f6 !important;
          box-shadow: none !important;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-missing-placeholder td.wh-placeholder-hint {
          color: #6b7280 !important;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-missing-placeholder.wh-placeholder-interactive {
          cursor: pointer;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-holiday-placeholder td,
        .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-holiday-placeholder:hover td,
        .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-holiday-placeholder.wh-placeholder-interactive:hover td {
          background: #f5f3ff !important;
          box-shadow: none !important;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-holiday-placeholder td.wh-placeholder-hint {
          color: #6b7280 !important;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-holiday-placeholder.wh-placeholder-interactive {
          cursor: pointer;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-weekend-placeholder td,
        .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-weekend-placeholder:hover td {
          background: #f1f5f9 !important;
          box-shadow: none !important;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-weekend-placeholder td.wh-placeholder-hint {
          color: #64748b !important;
          font-style: normal !important;
          font-weight: 600 !important;
          text-align: center !important;
        }

        @media (min-width: 1024px) {
          .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-missing-placeholder.wh-placeholder-interactive .wh-placeholder-row-actions,
          .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-holiday-placeholder.wh-placeholder-interactive .wh-placeholder-row-actions {
            opacity: 0;
            visibility: hidden;
            pointer-events: none;
            transition: opacity 0.15s ease, visibility 0.15s ease;
          }

          .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-missing-placeholder.wh-placeholder-interactive:hover .wh-placeholder-row-actions,
          .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-missing-placeholder.wh-placeholder-interactive:focus-within .wh-placeholder-row-actions,
          .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-holiday-placeholder.wh-placeholder-interactive:hover .wh-placeholder-row-actions,
          .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-holiday-placeholder.wh-placeholder-interactive:focus-within .wh-placeholder-row-actions {
            opacity: 1;
            visibility: visible;
            pointer-events: auto;
          }
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody td.wh-data-date-cell {
          border-top-left-radius: 18px !important;
          border-bottom-left-radius: 18px !important;
          vertical-align: top !important;
          position: relative;
          padding-left: 1.1rem !important;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody td:last-child {
          border-top-right-radius: 18px !important;
          border-bottom-right-radius: 18px !important;
          overflow: visible !important;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-bulk-selected td {
          box-shadow: inset 0 0 0 2px rgba(59, 130, 246, 0.45) !important;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody td.wh-data-date-cell.wh-date-week-accent::before {
          content: '';
          position: absolute;
          left: 0.35rem;
          top: 0.45rem;
          bottom: 0.45rem;
          width: 3px;
          border-radius: 999px;
          background: var(--wh-week-accent, #94a3b8);
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody .wh-week-between-label {
          display: block;
          font-size: 12px;
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

        .my-profile-hours-shell--flat table.my-profile-hours-table {
          border-collapse: collapse !important;
          border-spacing: 0 !important;
          table-layout: auto !important;
        }

        .my-profile-hours-shell--flat table.my-profile-hours-table thead,
        .my-profile-hours-shell--flat table.my-profile-hours-table thead tr,
        .my-profile-hours-shell--flat table.my-profile-hours-table thead th {
          background-color: transparent !important;
          color: #6b7280 !important;
          font-size: 0.875rem !important;
          font-weight: 600 !important;
          letter-spacing: 0.05em !important;
          text-transform: uppercase !important;
        }

        .my-profile-hours-shell--flat table.my-profile-hours-table tbody tr {
          border-radius: 0 !important;
        }

        .my-profile-hours-shell--flat table.my-profile-hours-table tbody td {
          padding: 0.75rem 0.85rem !important;
        }

        .my-profile-hours-shell--flat table.my-profile-hours-table tbody tr.wh-data-row td {
          background: transparent !important;
        }

        .my-profile-hours-shell--flat table.my-profile-hours-table tbody tr.wh-data-row:hover td {
          background: #f3f4f6 !important;
        }

        .my-profile-hours-shell--flat table.my-profile-hours-table tbody tr.wh-missing-placeholder td,
        .my-profile-hours-shell--flat table.my-profile-hours-table tbody tr.wh-missing-placeholder:hover td,
        .my-profile-hours-shell--flat table.my-profile-hours-table tbody tr.wh-missing-placeholder.wh-placeholder-interactive:hover td {
          background: #f9fafb !important;
        }

        .my-profile-hours-shell--flat table.my-profile-hours-table tbody td.wh-data-date-cell,
        .my-profile-hours-shell--flat table.my-profile-hours-table tbody td:last-child {
          border-radius: 0 !important;
        }
      `}</style>

      <ProfileBottomSheetModal
        open={calendarModalOpen}
        onClose={() => setCalendarModalOpen(false)}
        title="My Availability"
        subtitle={<MissingDaysBadge count={calendarMissingDays} loading={loading} />}
        hideFooter
        mobileFullHeight
        sheetClassName="md:max-w-2xl"
        headerRight={
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
        }
      >
        <CompactAvailabilityCalendar
          key={`cal-${year}-${month}`}
          ref={calendarRef}
          employeeId={employeeId}
          initialYear={year}
          initialMonth={month}
          onMonthChange={handleCalendarMonthChange}
          onAvailabilityChange={() => void fetchRecords()}
        />
      </ProfileBottomSheetModal>

      <ClockInDayNotesModal
        isOpen={!!editingNotesDay}
        dateKey={editingNotesDay ?? ''}
        sessions={editingNotesSessions}
        readOnly={editingNotesDay ? isRowLockedForSubmission(editingNotesDay) : false}
        onClose={() => setEditingNotesDay(null)}
        onSaved={() => {
          void fetchRecords();
          void fetchClockInStatus();
        }}
      />

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
