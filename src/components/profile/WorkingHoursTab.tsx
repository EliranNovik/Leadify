import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CalendarDaysIcon,
  CheckIcon,
  ClockIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PencilSquareIcon,
  PlusIcon,
  SquaresPlusIcon,
  EllipsisVerticalIcon,
  TrashIcon,
  XMarkIcon,
  ArrowUturnLeftIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import { FaFileExcel } from 'react-icons/fa';
import { supabase } from '../../lib/supabase';
import CompactAvailabilityCalendar, {
  AvailabilityViewTabs,
  type AvailabilityCalendarView,
  type CompactAvailabilityCalendarRef,
} from '../CompactAvailabilityCalendar';
import {
  aggregateClockInRecordsByDay,
  buildMergedTimeAndUnavailabilityExportRows,
  clockSessionsForDisplay,
  exportMergedTimeAndUnavailabilitiesToExcel,
  sumCountedClockDurationsMs,
  type ClockInExportRecord,
  type DailyClockInSummary,
  type ClockSessionSummary,
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
  eachDayInRange,
  isIsraeliWorkdayIso,
  monthRange,
  toDateInputValue,
  filterClockInRecordsToLocalMonth,
} from '../../lib/employeeClockInFormat';
import { normalizeEmployeeMinHours } from '../../lib/employeeLeadReporting';
import {
  preloadHolidayYears,
} from '../../lib/israeliJewishHolidays';
import {
  buildHolidayMapForRange,
  calculateEmployeeExtraHours,
  generalAbsenceOverlapMs,
  isDeficitTrackingWorkday,
} from '../../lib/employeeExtraHours';
import {
  isAutoFilledClockInRecord,
  isAutoFilledOnlyDay,
  withAutoFilledClockInRecords,
} from '../../lib/autoFilledWorkingHours';
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
  countUnavailabilityApprovalBlockersInMonth,
  getUnavailabilityApprovalStatus,
  isGeneralUnavailability,
  buildGeneralAbsenceWindowsByDate,
  buildUnavailabilityDayEffects,
  timedGeneralAbsenceBadgeDetails,
  unavailabilityApprovalWatermarkLabel,
  type EmployeeUnavailabilityEntry,
  type EmployeeUnavailabilityDayRow,
  type GeneralAbsenceWindow,
} from '../../lib/employeeUnavailabilities';
import UnavailabilityTypeBadge from '../UnavailabilityTypeBadge';
import DocumentViewerModal from '../DocumentViewerModal';
import { DocumentFileGlyph } from '../../lib/documentFileGlyphs';
import { CLOCK_IN_OVERTIME_APPROVAL_BUCKET } from '../../lib/employeeClockInOvertimeApproval';
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
  countClockInApprovalBlockersInMonth,
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
  overtime_approval_storage_path?: string | null;
  overtime_approval_file_name?: string | null;
  overtime_approval_mime_type?: string | null;
  /** Set on synthetic standard-hours rows, which have no id to edit or delete. */
  auto_filled?: boolean;
};

function collectDayOvertimeDocuments(dayRecords: ClockInRow[]) {
  const seen = new Set<string>();
  const docs: { path: string; name: string; uploadedAt: string }[] = [];
  for (const record of dayRecords) {
    const path = record.overtime_approval_storage_path?.trim();
    if (!path || seen.has(path)) continue;
    seen.add(path);
    docs.push({
      path,
      name:
        record.overtime_approval_file_name?.trim()
        || documentNameFromUrl(path)
        || 'Overtime approval screenshot',
      uploadedAt: record.clock_in_time,
    });
  }
  return docs;
}

interface WorkingHoursTabProps {
  employeeId: number;
  employeeName?: string;
  /** When opening from HR board, land on the selected month/year. */
  initialYear?: number;
  initialMonth?: number;
  /** HR Management employee file: flat table (no grey card gutter), matches Leave/Employees. */
  embedded?: boolean;
  /**
   * Show the payable 125% / 150% breakdown inside the Balance card. HR only: employees see
   * whether their month is covered, not what it will pay out at.
   */
  showOvertimePremiumSplit?: boolean;
  /**
   * Optional host node for the month picker / Submit month / Calendar row. My Profile passes the
   * right-hand end of its tab bar so those controls sit on the tab line; without it they render
   * in their own row above the stat cards.
   */
  headerActionsSlot?: HTMLElement | null;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const SHORT_MONTH_NAMES = MONTH_NAMES.map((name) => name.slice(0, 3));

const MERGED_COL_SPAN = 8;
const WH_PLACEHOLDER_HINT_COL_SPAN = MERGED_COL_SPAN - 3;

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

function WorkingHoursWeekHeading({ weekNum }: { weekNum: number }) {
  const accent = getWeekAccentColor(weekNum);
  return (
    <div
      className="wh-week-between-label px-0.5 pb-2"
      style={{ '--wh-week-accent': accent } as React.CSSProperties}
    >
      Week {weekNum}
    </div>
  );
}

function WorkingHoursColGroup({ bulkSelectMode }: { bulkSelectMode: boolean }) {
  return (
    <colgroup>
      {bulkSelectMode ? <col className="wh-col-select" /> : null}
      <col className="wh-col-date" />
      <col className="wh-col-status" />
      <col className="wh-col-unavailability" />
      <col className="wh-col-clock-in" />
      <col className="wh-col-clock-out" />
      <col className="wh-col-total" />
      <col className="wh-col-notes" />
      <col className="wh-col-document" />
    </colgroup>
  );
}

function WorkingHoursColumnHead({ bulkSelectMode }: { bulkSelectMode: boolean }) {
  return (
    <thead className="sticky top-0 z-10 bg-transparent text-sm uppercase tracking-wide text-gray-400">
      <tr>
        {bulkSelectMode && (
          <th
            className="w-10 py-3 px-2 text-left"
            aria-label="Select"
          />
        )}
        <th className="py-3 px-2 text-left">
          Date
        </th>
        <th className="py-3 px-2 text-left">
          Status
        </th>
        <th className="py-3 px-2 text-left">
          Unavailability
        </th>
        <th className="py-3 px-2 text-left">
          Clock in
        </th>
        <th className="py-3 px-2 text-left">
          Clock out
        </th>
        <th className="py-3 px-2 text-left">
          Total
        </th>
        <th className="py-3 px-2 text-left">
          Notes
        </th>
        <th className="py-3 px-2 text-left">
          Document
        </th>
      </tr>
    </thead>
  );
}

const WH_DATA_CELL =
  'wh-data-cell px-2 py-3.5 border-b border-gray-100 text-[0.875rem] md:text-[1rem] leading-snug';
const WH_DATE_CELL =
  'wh-data-date-cell px-2 py-3.5 border-b border-gray-100 text-sm md:text-[0.875rem]';

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
    <span className={`flex flex-col items-start leading-snug ${muted ? 'text-gray-400' : 'text-gray-800'}`}>
      <span className="wh-weekday font-semibold" style={{ color: 'var(--wh-week-accent)' }}>
        {formatWorkingHoursWeekday(dateKey)}
      </span>
      <span>{formatWorkingHoursDateLabel(dateKey)}</span>
    </span>
  );
}

function workingHoursDateCellStyle(weekNum?: number): React.CSSProperties | undefined {
  if (!weekNum) return undefined;
  return { '--wh-week-accent': getWeekAccentColor(weekNum) } as React.CSSProperties;
}

type DayApprovalDisplayStatus = 'approved' | 'pending' | 'declined' | 'auto-approved';

const DAY_APPROVAL_ORDER: DayApprovalDisplayStatus[] = ['declined', 'pending', 'approved', 'auto-approved'];

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
        : status === 'auto-approved'
          ? 'Auto approved'
          : 'Approved';
  const colorClass =
    status === 'pending'
      ? 'text-sky-700'
      : status === 'declined'
        ? 'text-red-700'
        : status === 'auto-approved'
          ? 'text-gray-500'
          : 'text-emerald-700';

  return (
    <span className={`whitespace-nowrap ${colorClass}`}>
      {label}
    </span>
  );
}

function collectDayApprovalStatuses(params: {
  hasClock: boolean;
  hasManualClock: boolean;
  clockApprovalStatus: ReturnType<typeof getDayClockInApprovalStatus>;
  unavailabilities: EmployeeUnavailabilityDayRow[];
}): DayApprovalDisplayStatus[] {
  const found = new Set<DayApprovalDisplayStatus>();

  if (params.hasManualClock) {
    if (clockInApprovalWatermarkLabel(params.clockApprovalStatus)) {
      found.add(params.clockApprovalStatus);
    }
  } else if (params.hasClock) {
    if (params.clockApprovalStatus === 'declined') found.add('declined');
    else found.add('auto-approved');
  }

  for (const unavail of params.unavailabilities) {
    if (isGeneralUnavailability(unavail)) continue;
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
  'inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold border-0 text-white shadow-md transition-all duration-200 bg-gradient-to-tr from-amber-500 via-orange-500 to-yellow-500 hover:shadow-lg active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none disabled:shadow-none';

type WorkingHoursRowFilter = 'approved' | 'declined' | 'pending' | 'unavailability' | 'clock' | 'no-entry';

const ROW_FILTER_OPTIONS: {
  id: WorkingHoursRowFilter;
  label: string;
}[] = [
  { id: 'approved', label: 'Approved' },
  { id: 'declined', label: 'Declined' },
  { id: 'pending', label: 'Waiting for approval' },
  { id: 'unavailability', label: 'Unavailabilities' },
  { id: 'clock', label: 'Clock in & out' },
  { id: 'no-entry', label: 'No entry' },
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
  /** Future calendar day with no entry — shown without counting it as missing. */
  isFuturePlaceholder?: boolean;
  /** One of the statutory paid holidays (or its eve), with no required hours. */
  isHolidayOffPlaceholder?: boolean;
  /** Fri/Sat day (with or without entries). */
  isWeekend?: boolean;
  holidayNames?: string[];
};

/**
 * Milliseconds of a timed general absence that actually fell inside the clocked sessions.
 *
 * Shares `generalAbsenceOverlapMs` with the overtime helper so the Total column and the 125% /
 * 150% split can never disagree about how much of an absence the employee was on the clock for.
 */
function overlappingGeneralAbsenceMs(
  dateKey: string,
  dayRecords: ClockInRow[],
  windowsByDate: Map<string, GeneralAbsenceWindow[]>,
  nowMs: number,
): number {
  let overlapMs = 0;

  for (const record of dayRecords) {
    const inMs = Date.parse(record.clock_in_time);
    if (!Number.isFinite(inMs)) continue;
    const outMs = record.clock_out_time ? Date.parse(record.clock_out_time) : nowMs;
    if (!Number.isFinite(outMs) || outMs <= inMs) continue;
    overlapMs += generalAbsenceOverlapMs(inMs, outMs, dateKey, windowsByDate);
  }

  return overlapMs;
}

function workingHoursDurationLabel(totalMs: number): string {
  const safeMs = Math.max(0, totalMs);
  const hours = Math.floor(safeMs / 3_600_000);
  const minutes = Math.floor((safeMs % 3_600_000) / 60_000);
  return `${hours}h ${minutes}m`;
}

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
    } else if (day.status === 'future') {
      rows.push({
        dateKey: day.dateKey,
        date: formatWorkingHoursDateLabel(day.dateKey),
        clock: null,
        unavailabilities: [],
        isFuturePlaceholder: true,
      });
    } else if (day.status === 'holiday_off') {
      rows.push({
        dateKey: day.dateKey,
        date: formatWorkingHoursDateLabel(day.dateKey),
        clock: null,
        unavailabilities: [],
        isHolidayOffPlaceholder: true,
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
  if (activeFilters.size === 0) return true;

  const isNoEntryRow =
    row.isMissingPlaceholder === true
    || row.isHolidayPlaceholder === true;
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
      (hasClock && row.clock?.hasManual !== true && approvalStatus === 'approved') ||
      row.unavailabilities.some(
        (u) => !isGeneralUnavailability(u) && getUnavailabilityApprovalStatus(u) === 'approved',
      ),
    declined:
      (hasClock && approvalStatus === 'declined') ||
      row.unavailabilities.some(
        (u) => !isGeneralUnavailability(u) && getUnavailabilityApprovalStatus(u) === 'declined',
      ),
    pending:
      (hasClock && approvalStatus === 'pending') ||
      row.unavailabilities.some(
        (u) => !isGeneralUnavailability(u) && getUnavailabilityApprovalStatus(u) === 'pending',
      ),
    unavailability: hasUnavail,
    clock: hasClock,
    'no-entry': isNoEntryRow,
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

function sessionWorkplaceName(session: ClockSessionSummary): string {
  if (session.workplaceIn && session.workplaceIn !== '—') return session.workplaceIn;
  if (session.workplaceOut && session.workplaceOut !== '—') return session.workplaceOut;
  return '';
}

function TimeListCell({
  sessions,
  field,
}: {
  sessions?: ClockSessionSummary[] | null;
  field: 'clockIn' | 'clockOut';
}) {
  const list = sessions ?? [];
  if (list.length === 0) return <span className="text-gray-400">—</span>;
  const showIndex = list.length > 1;
  return (
    <div className="flex flex-col gap-0.5">
      {list.map((session, i) => {
        const time = field === 'clockIn' ? session.clockIn : session.clockOut;
        const workplace = sessionWorkplaceName(session);
        return (
          <span key={`${field}-${time}-${i}`} className="inline-flex items-center gap-1.5 whitespace-nowrap">
            {showIndex ? (
              <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-gray-100 px-1.5 text-[11px] font-semibold tabular-nums text-gray-600">
                {i + 1}
              </span>
            ) : null}
            {time}
            {workplace ? <span className="text-gray-400 font-normal">{workplace}</span> : null}
          </span>
        );
      })}
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
  /** Hours shown but not stored yet, so the only action is to record real ones. */
  autoFilledClock?: boolean;
  loading: boolean;
  deletingRowKey: string | null;
  deletingClockInDay: string | null;
  readOnly?: boolean;
  onEditUnavailability: (row: EmployeeUnavailabilityDayRow) => void;
  onDeleteUnavailability: (row: EmployeeUnavailabilityDayRow) => void;
  onEditClockIn: (dateKey: string) => void;
  onDeleteClockIn: (dateKey: string) => void;
  onAddClockIn: (dateKey: string) => void;
};

const WORKING_HOURS_ACTIONS_MENU_EST_HEIGHT_PX = 120;
const WORKING_HOURS_ACTIONS_MENU_WIDTH_PX = 192;

function WorkingHoursRowActionsMenu({
  dateKey,
  unavailabilities,
  hasClock,
  autoFilledClock = false,
  loading,
  deletingRowKey,
  deletingClockInDay,
  readOnly = false,
  onEditUnavailability,
  onDeleteUnavailability,
  onEditClockIn,
  onDeleteClockIn,
  onAddClockIn,
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
      {hasClock && autoFilledClock && (
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
            Edit auto-added hours
          </button>
        </li>
      )}
      {hasClock && !autoFilledClock && (
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

function capturePageScroll(fromEl?: HTMLElement | null): { el: HTMLElement | Window; top: number } {
  let node: HTMLElement | null = fromEl?.parentElement ?? null;
  while (node) {
    const style = window.getComputedStyle(node);
    const canScroll = style.overflowY === 'auto' || style.overflowY === 'scroll';
    if (canScroll && node.scrollHeight > node.clientHeight + 1) {
      return { el: node, top: node.scrollTop };
    }
    node = node.parentElement;
  }
  const main = document.querySelector('main');
  if (main instanceof HTMLElement && main.scrollHeight > main.clientHeight + 1) {
    return { el: main, top: main.scrollTop };
  }
  return { el: window, top: window.scrollY };
}

function restorePageScroll(saved: { el: HTMLElement | Window; top: number }) {
  const apply = () => {
    if (saved.el === window) window.scrollTo(0, saved.top);
    else (saved.el as HTMLElement).scrollTop = saved.top;
  };
  apply();
  requestAnimationFrame(() => {
    apply();
    requestAnimationFrame(apply);
  });
}

const WorkingHoursTab: React.FC<WorkingHoursTabProps> = ({
  employeeId,
  employeeName = '',
  initialYear,
  initialMonth,
  embedded = false,
  showOvertimePremiumSplit = false,
  headerActionsSlot = null,
}) => {
  const { user } = useAuthContext();
  const calendarRef = useRef<CompactAvailabilityCalendarRef>(null);
  const hoursShellRef = useRef<HTMLDivElement>(null);
  const headerMonthFilterRef = useRef<HTMLDetailsElement>(null);
  const toolbarMonthFilterRef = useRef<HTMLDetailsElement>(null);
  const addEntryMenuRef = useRef<HTMLDetailsElement>(null);
  const hasLoadedOnceRef = useRef(false);
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
  const [exporting, setExporting] = useState(false);
  const [submitModalOpen, setSubmitModalOpen] = useState(false);
  const [monthSubmission, setMonthSubmission] = useState<EmployeeWorkingHoursSubmission | null>(null);
  const [loadingMonthSubmission, setLoadingMonthSubmission] = useState(false);
  const [cancellingSubmission, setCancellingSubmission] = useState(false);
  const [calendarModalOpen, setCalendarModalOpen] = useState(false);
  const [calendarView, setCalendarView] = useState<AvailabilityCalendarView>('day');
  const [calendarRangeLabel, setCalendarRangeLabel] = useState('');
  const [calendarViewYear, setCalendarViewYear] = useState(now.getFullYear());
  const [calendarViewMonth, setCalendarViewMonth] = useState(now.getMonth() + 1);
  const [calendarMonthRecords, setCalendarMonthRecords] = useState<ClockInRow[]>([]);
  const [calendarMonthUnavailabilities, setCalendarMonthUnavailabilities] = useState<
    EmployeeUnavailabilityEntry[]
  >([]);
  const [editingRow, setEditingRow] = useState<EmployeeUnavailabilityDayRow | null>(null);
  const [deletingRowKey, setDeletingRowKey] = useState<string | null>(null);
  const [manualClockInOpen, setManualClockInOpen] = useState(false);
  const [overtimeDatePickerOpen, setOvertimeDatePickerOpen] = useState(false);
  const [overtimeDateKey, setOvertimeDateKey] = useState(() => toDateInputValue(new Date()));
  const [addEntryOpenUpward, setAddEntryOpenUpward] = useState(false);
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
    bucketName?: string;
  } | null>(null);
  const [holidayMapVersion, setHolidayMapVersion] = useState(0);
  const [rowFilters, setRowFilters] = useState<Set<WorkingHoursRowFilter>>(() => new Set());
  const [scrollToTodayRequested, setScrollToTodayRequested] = useState(false);
  const [selectedWeekNum, setSelectedWeekNum] = useState(1);
  const [manualClockInInitialDateKey, setManualClockInInitialDateKey] = useState<string | null>(null);
  const [pendingCalendarDateKey, setPendingCalendarDateKey] = useState<string | null>(null);

  useEffect(() => {
    const closeDropdownsOnOutsideClick = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      [headerMonthFilterRef, toolbarMonthFilterRef, addEntryMenuRef].forEach((dropdownRef) => {
        const details = dropdownRef.current;
        if (details?.open && !details.contains(target)) details.open = false;
      });
    };
    document.addEventListener('pointerdown', closeDropdownsOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeDropdownsOnOutsideClick);
  }, []);

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

  const toggleRowFilter = useCallback(
    (filter: WorkingHoursRowFilter) => {
      const next = new Set(rowFilters);
      if (next.has(filter)) next.delete(filter);
      else next.add(filter);
      setRowFilters(next);
      // Matches are spread across the whole month, so a single-week view hides most of what the
      // filter selected. Widen to the All pill so the result is visible in one go. Review days
      // sets its own target week and deliberately does not go through here.
      if (next.size > 0) setSelectedWeekNum(0);
    },
    [rowFilters],
  );

  const fetchRecords = useCallback(async () => {
    if (!employeeId) {
      setRecords([]);
      setUnavailabilities([]);
      setLoading(false);
      return;
    }
    const keepPlace = hasLoadedOnceRef.current;
    const savedScroll = keepPlace ? capturePageScroll(hoursShellRef.current) : null;
    if (!keepPlace) setLoading(true);
    const range = monthRange(year, month);
    try {
      const { start, end } = dateRangeToIsoBounds(range.from, range.to);
      const clockSelectWithOvertime = `id, employee_id, clock_in_time, clock_out_time, is_active, manually,
             approved, declined, decline_note,
             clock_in_location_id, clock_out_location_id,
             clock_in_place:clock_in_locations!clock_in_location_id ( name ),
             clock_out_place:clock_in_locations!clock_out_location_id ( name ),
             notes,
             overtime_approval_storage_path, overtime_approval_file_name, overtime_approval_mime_type`;
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
        .select(clockSelectWithOvertime)
        .eq('employee_id', employeeId)
        .gte('clock_in_time', start)
        .lte('clock_in_time', end)
        .order('clock_in_time', { ascending: false });

      if (clockResult.error) {
        const msg = clockResult.error.message?.toLowerCase() ?? '';
        if (msg.includes('overtime_approval')) {
          clockResult = await supabase
            .from('employee_clock_in')
            .select(clockSelectWithApproval)
            .eq('employee_id', employeeId)
            .gte('clock_in_time', start)
            .lte('clock_in_time', end)
            .order('clock_in_time', { ascending: false });
        }
      }

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
      const normalizedRows = filterClockInRecordsToLocalMonth(
        ((resolvedClockResult.data as ClockInRow[]) || []).map((row) =>
          normalizeClockInApprovalFields(row),
        ),
        year,
        month,
      );
      setRecords(normalizedRows);
      setUnavailabilities(unavailRows);
    } catch (err) {
      console.error('WorkingHoursTab fetch:', err);
      setRecords([]);
      setUnavailabilities([]);
    } finally {
      setLoading(false);
      hasLoadedOnceRef.current = true;
      if (savedScroll) restorePageScroll(savedScroll);
    }
  }, [employeeId, year, month]);

  useEffect(() => {
    hasLoadedOnceRef.current = false;
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

  /**
   * Real rows plus the standard hours auto-filled on untouched working days.
   *
   * Only the hour totals and the day list read this. `recordsByDay` deliberately stays on
   * `records`, because an auto-filled day has no row in the database and so nothing for the
   * edit or delete actions to act on.
   */
  const filledRecords = useMemo(
    () =>
      withAutoFilledClockInRecords({
        employeeId: employeeId ?? 0,
        minHours: employeeMinHours,
        dateFrom,
        dateTo,
        holidayMap: buildHolidayMapForRange(dateFrom, dateTo),
        existingRecords: records,
        unavailabilities,
      }) as ClockInRow[],
    // holidayMapVersion: the holiday map fills in asynchronously after the first render.
    [employeeId, employeeMinHours, dateFrom, dateTo, records, unavailabilities, holidayMapVersion],
  );

  const dailyRows = useMemo(() => aggregateClockInRecordsByDay(filledRecords), [filledRecords]);

  const monthSubmitApprovalBlockers = useMemo(() => {
    const clockBlockers = countClockInApprovalBlockersInMonth(records, year, month);
    const leaveBlockers = countUnavailabilityApprovalBlockersInMonth(unavailabilities, year, month);
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
    for (const record of filledRecords) {
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
  }, [filledRecords]);

  const generalAbsenceWindowsByDate = useMemo(
    () => buildGeneralAbsenceWindowsByDate(unavailabilities, dateFrom, dateTo),
    [unavailabilities, dateFrom, dateTo],
  );

  const effectiveWorkedMsForDay = useCallback(
    (dateKey: string, dayRecords: ClockInRow[]) => {
      const counted = filterCountedClockInRecords(dayRecords);
      const workedMs = sumCountedClockDurationsMs(counted);
      // Synthetic standard hours already have timed general unavailability deducted.
      if (isAutoFilledOnlyDay(dayRecords)) return workedMs;
      const absenceMs = overlappingGeneralAbsenceMs(
        dateKey,
        counted as ClockInRow[],
        generalAbsenceWindowsByDate,
        Date.now(),
      );
      return Math.max(0, workedMs - absenceMs);
    },
    [generalAbsenceWindowsByDate],
  );

  const periodTotalMs = useMemo(
    () =>
      [...recordsByDay.entries()].reduce(
          (total, [dateKey, dayRecords]) =>
            total + effectiveWorkedMsForDay(dateKey, dayRecords),
          0,
        ),
    [recordsByDay, effectiveWorkedMsForDay],
  );
  const periodTotal = workingHoursDurationLabel(periodTotalMs);

  /**
   * Auto-filled days show their hours but have no row to edit, delete or annotate — the
   * employee replaces them by adding a real clock-in, which takes the day over.
   */
  const isAutoFilledDay = useCallback(
    (dateKey: string) => {
      const dayRecords = recordsByDay.get(dateKey);
      return Boolean(dayRecords?.length) && isAutoFilledOnlyDay(dayRecords!);
    },
    [recordsByDay],
  );

  /** Sessions a modal may act on: the real rows only. */
  const editableRecordsForDay = useCallback(
    (dateKey: string) =>
      (recordsByDay.get(dateKey) ?? []).filter((record) => !isAutoFilledClockInRecord(record)),
    [recordsByDay],
  );

  const editingAutoFilledDay = editingClockInDay
    ? isAutoFilledDay(editingClockInDay)
    : false;
  const editingClockInSessions = editingClockInDay
    ? editingAutoFilledDay
      ? (recordsByDay.get(editingClockInDay) ?? []).map((record, index) => ({
          ...record,
          id: -(index + 1),
        }))
      : editableRecordsForDay(editingClockInDay)
    : [];
  const editingNotesSessions = editingNotesDay
    ? editableRecordsForDay(editingNotesDay)
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
      if (isGeneralUnavailability(row)) continue;
      if (getUnavailabilityApprovalStatus(row) === 'pending') {
        pendingApprovalDates.add(row.date);
      }
    }
    return buildWorkingHoursMonthCoverage(
      year,
      month,
      filterCountedClockInRecords(filledRecords),
      filterCountedUnavailability(unavailabilities),
      { pendingApprovalDates },
    );
  }, [year, month, filledRecords, unavailabilities, unavailabilityDayRows, recordsByDay, holidayMapVersion]);

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
  const availableWeekNumbers = useMemo(
    () => [...new Set(monthWeekLookup.values())].sort((a, b) => a - b),
    [monthWeekLookup],
  );
  /**
   * monthWeekLookup is keyed by Sunday week-start only (one entry per week), so a raw date key
   * misses on every day except Sunday. Always normalise through getSundayWeekStartKey first.
   */
  const weekNumForDateKey = useCallback(
    (dateKey: string) => monthWeekLookup.get(getSundayWeekStartKey(dateKey)),
    [monthWeekLookup],
  );
  const weeksWithUnavailability = useMemo(() => {
    const weeks = new Set<number>();
    unavailabilityDayRows.forEach((row) => {
      const weekNum = weekNumForDateKey(row.date);
      if (weekNum != null) weeks.add(weekNum);
    });
    return weeks;
  }, [unavailabilityDayRows, weekNumForDateKey]);

  useEffect(() => {
    const today = new Date();
    const todayKey = toDateInputValue(today);
    const defaultWeek =
      today.getFullYear() === year && today.getMonth() + 1 === month
        ? weekNumForDateKey(todayKey)
        : availableWeekNumbers[0];
    setSelectedWeekNum(defaultWeek ?? 1);
  }, [year, month, weekNumForDateKey, availableWeekNumbers]);

  const weekRowMeta = useMemo(
    () => buildWorkingHoursWeekRowMeta(filteredMergedDayRows, monthWeekLookup),
    [filteredMergedDayRows, monthWeekLookup],
  );

  const tableColSpan = useMemo(
    () => MERGED_COL_SPAN + (bulkSelectMode ? 1 : 0),
    [bulkSelectMode],
  );

  const weekSections = useMemo(() => {
    const sections: Array<{ weekNum: number; rows: typeof filteredMergedDayRows }> = [];
    filteredMergedDayRows.forEach((row) => {
      const weekNum = weekRowMeta.get(row.dateKey)?.weekNum ?? 1;
      const last = sections[sections.length - 1];
      if (!last || last.weekNum !== weekNum) {
        sections.push({ weekNum, rows: [row] });
      } else {
        last.rows.push(row);
      }
    });
    return sections;
  }, [filteredMergedDayRows, weekRowMeta]);
  const displayedDayRows = useMemo(
    () => selectedWeekNum === 0
      ? filteredMergedDayRows
      : filteredMergedDayRows.filter(
          (row) => (weekNumForDateKey(row.dateKey) ?? 1) === selectedWeekNum,
        ),
    [filteredMergedDayRows, weekNumForDateKey, selectedWeekNum],
  );
  const displayedWeekSections = useMemo(
    () => selectedWeekNum === 0
      ? weekSections
      : weekSections.filter((section) => section.weekNum === selectedWeekNum),
    [weekSections, selectedWeekNum],
  );

  const handleCalendarMonthChange = useCallback((viewYear: number, viewMonth: number) => {
    setCalendarViewYear(viewYear);
    setCalendarViewMonth(viewMonth);
  }, []);

  const periodMissingDays = useMemo(
    () => countMissingEntryPlaceholderRows(tableDayRows),
    [tableDayRows],
  );

  /**
   * Premium overtime for the visible month, from the same helper the HR report and the Excel
   * export use, so the Balance card and HR cannot disagree. Values are post-offset — missing
   * hours are already eaten out of the 150% bucket first, then 125% — i.e. what is payable.
   * Only surfaced under `showOvertimePremiumSplit`, so employees do not see their own payout.
   */
  const periodOvertime = useMemo(
    () =>
      calculateEmployeeExtraHours(
        filledRecords as unknown as ClockInExportRecord[],
        employeeMinHours,
        buildHolidayMapForRange(dateFrom, dateTo),
        dateFrom,
        dateTo,
        unavailabilities,
      ),
    // holidayMapVersion: the holiday map fills in asynchronously after the first render.
    [filledRecords, employeeMinHours, dateFrom, dateTo, unavailabilities, holidayMapVersion],
  );

  const workingHoursSummary = useMemo(() => {
    // The target covers the complete selected month, using this employee's min_hours.
    // Non-working Fridays/Saturdays and statutory paid holidays are excluded.
    const summaryTo = dateTo;
    const holidayMap = buildHolidayMapForRange(dateFrom, dateTo);
    const expectedDays =
      summaryTo < dateFrom
        ? 0
        : eachDayInRange(dateFrom, summaryTo).filter((dateKey) =>
            isDeficitTrackingWorkday(dateKey, holidayMap),
          ).length;
    const expectedMs = expectedDays * employeeMinHours * 3_600_000;

    let unavailableMs = 0;
    const absenceEffects = buildUnavailabilityDayEffects(
      unavailabilities,
      dateFrom,
      summaryTo,
    );
    for (const [dateKey, effect] of absenceEffects) {
      if (!isDeficitTrackingWorkday(dateKey, holidayMap)) continue;
      // Only full-day sick / vacation lowers the target. A timed general absence is already
      // removed from worked hours (see effectiveWorkedMsForDay), so discounting the target for
      // it as well would forgive the same hours twice and turn short days into a surplus.
      if (effect.fullDay) unavailableMs += employeeMinHours * 3_600_000;
    }
    unavailableMs = Math.min(expectedMs, unavailableMs);
    const adjustedExpectedMs = Math.max(0, expectedMs - unavailableMs);
    const balanceMs = periodTotalMs - adjustedExpectedMs;
    const unavailabilityDayCount = new Set(
      unavailabilityDayRows
        .filter((row) => row.date >= dateFrom && row.date <= summaryTo)
        .map((row) => row.date),
    ).size;
    const completion = adjustedExpectedMs > 0
      ? Math.min(999, Math.round((periodTotalMs / adjustedExpectedMs) * 1000) / 10)
      : 100;

    return {
      expectedMs,
      unavailableMs,
      adjustedExpectedMs,
      balanceMs,
      completion,
      unavailabilityDayCount,
    };
  }, [
    dateFrom,
    dateTo,
    employeeMinHours,
    periodTotalMs,
    unavailabilities,
    unavailabilityDayRows,
    holidayMapVersion,
  ]);

  const shiftWorkingHoursMonth = useCallback((direction: -1 | 1) => {
    const next = new Date(year, month - 1 + direction, 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth() + 1);
  }, [year, month]);

  const reviewMissingDays = useCallback(() => {
    setRowFilters(new Set<WorkingHoursRowFilter>(['no-entry']));
    const firstMissingDate = tableDayRows.find(
      (row) => row.isMissingPlaceholder || row.isHolidayPlaceholder,
    )?.dateKey;
    if (firstMissingDate) {
      setSelectedWeekNum(weekNumForDateKey(firstMissingDate) ?? 1);
    }
    window.requestAnimationFrame(() => {
      if (firstMissingDate) {
        [...document.querySelectorAll<HTMLElement>(`[id="wh-row-${firstMissingDate}"]`)]
          .find((element) => element.getClientRects().length > 0)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  }, [tableDayRows, weekNumForDateKey]);

  const goToTodayRow = useCallback(() => {
    const today = new Date();
    setYear(today.getFullYear());
    setMonth(today.getMonth() + 1);
    setRowFilters(new Set());
    setSelectedWeekNum(weekNumForDateKey(toDateInputValue(today)) ?? 1);
    setScrollToTodayRequested(true);
  }, [weekNumForDateKey]);

  useEffect(() => {
    if (!scrollToTodayRequested || loading) return;
    const todayKey = toDateInputValue(new Date());
    const row = [...document.querySelectorAll<HTMLElement>(`[id="wh-row-${todayKey}"]`)]
      .find((element) => element.getClientRects().length > 0);
    if (!row) return;
    window.requestAnimationFrame(() => {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setScrollToTodayRequested(false);
    });
  }, [scrollToTodayRequested, loading, filteredMergedDayRows]);

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

  /**
   * Hours per day for the month the calendar is showing, auto-filled days included.
   * The filtered month already has its records loaded; other months come from the
   * calendar's own fetch below.
   */
  const calendarWorkedMsByDate = useMemo(() => {
    const viewRange = monthRange(calendarViewYear, calendarViewMonth);
    const sameMonth = viewRange.from === monthRange(year, month).from;
    const source = sameMonth
      ? filledRecords
      : withAutoFilledClockInRecords({
          employeeId: employeeId ?? 0,
          minHours: employeeMinHours,
          dateFrom: viewRange.from,
          dateTo: viewRange.to,
          holidayMap: buildHolidayMapForRange(viewRange.from, viewRange.to),
          existingRecords: calendarMonthRecords,
          unavailabilities: calendarMonthUnavailabilities,
        });

    const byDate = new Map<string, number>();
    for (const summary of aggregateClockInRecordsByDay(source)) {
      if (summary.totalDurationMs > 0) byDate.set(summary.dateKey, summary.totalDurationMs);
    }
    return byDate;
  }, [
    calendarViewYear,
    calendarViewMonth,
    year,
    month,
    filledRecords,
    calendarMonthRecords,
    calendarMonthUnavailabilities,
    employeeId,
    employeeMinHours,
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
            // clock_out_time and the approval flags are what make the per-day hours in the
            // calendar boxes add up; coverage counting alone only needs clock_in_time.
            .select('clock_in_time, clock_out_time, manually, approved, declined')
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
          (row.isMissingPlaceholder || row.isHolidayPlaceholder || row.isFuturePlaceholder)
          && !isMonthSubmitted,
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
    const countedRecords = filterCountedClockInRecords(filledRecords);
    const mergedRows = buildMergedTimeAndUnavailabilityExportRows(
      countedRecords,
      unavailabilities,
      dateFrom,
      dateTo,
    ).map((row) => {
      const dayRecords = recordsByDay.get(row.dateKey) ?? [];
      const effectiveMs = effectiveWorkedMsForDay(row.dateKey, dayRecords);
      return {
        ...row,
        totalDurationMs: effectiveMs,
        totalDuration: effectiveMs > 0 ? workingHoursDurationLabel(effectiveMs) : '—',
      };
    });
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
        periodTotalMs: [...recordsByDay.entries()].reduce(
          (total, [dateKey, dayRecords]) =>
            total + effectiveWorkedMsForDay(dateKey, dayRecords),
          0,
        ),
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

    const daySessions = editableRecordsForDay(dateKey);
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
    } catch (err) {
      console.error('WorkingHoursTab delete clock-in:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to remove clock-in entries');
    } finally {
      setDeletingClockInDay(null);
    }
  };

  const headerActions = (
      <div
        className={
          headerActionsSlot
            ? 'flex items-center'
            : 'flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-end'
        }
      >
        <div className="flex flex-col items-start gap-2 lg:items-end">
          <div className="flex flex-wrap items-center gap-2">
            {periodMissingDays > 0 && (
              <MissingDaysBadge count={periodMissingDays} loading={loading} />
            )}
            {!embedded && (
              <button
                type="button"
                className="btn btn-outline relative h-12 min-h-12 gap-2 overflow-visible rounded-full border-gray-200 bg-white px-5 text-gray-700 shadow-sm"
                onClick={() => {
                  setCalendarViewYear(year);
                  setCalendarViewMonth(month);
                  setCalendarModalOpen(true);
                }}
              >
                <CalendarDaysIcon className="h-5 w-5" />
                Calendar
                <span className="badge badge-xs absolute -right-1.5 -top-1.5 border-0 bg-red-500 px-1.5 text-[9px] text-white shadow-sm">
                  New
                </span>
              </button>
            )}
            <div className="flex h-12 items-center rounded-full border border-gray-200 bg-white p-1 shadow-sm">
              <button type="button" className="btn btn-ghost btn-circle btn-sm" onClick={() => shiftWorkingHoursMonth(-1)} aria-label="Previous month">
                <ChevronLeftIcon className="h-5 w-5" />
              </button>
              <details ref={headerMonthFilterRef} className="dropdown dropdown-end">
                <summary className="btn btn-ghost h-10 min-h-10 min-w-[9rem] gap-2 rounded-full px-3 text-base font-semibold">
                  <CalendarDaysIcon className="h-5 w-5 text-gray-400" />
                  {SHORT_MONTH_NAMES[month - 1]} {year}
                </summary>
                <div className="dropdown-content z-50 mt-2 w-72 rounded-2xl border border-gray-100 bg-white p-4 shadow-xl">
                  <div className="space-y-3 text-left">
                    <YearWheelPicker
                      label="Year"
                      labelClassName="label-text text-sm text-gray-400 mb-1.5 font-medium"
                      value={year}
                      onChange={setYear}
                    />
                    <label className="form-control w-full">
                      <span className="label-text mb-1.5 text-sm font-medium text-gray-400">Month</span>
                      <select
                        className="select select-bordered h-12 w-full text-base"
                        value={month}
                        onChange={(event) => setMonth(Number(event.target.value))}
                      >
                        {MONTH_NAMES.map((name, index) => (
                          <option key={name} value={index + 1}>{name}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>
              </details>
              <button type="button" className="btn btn-ghost btn-circle btn-sm" onClick={() => shiftWorkingHoursMonth(1)} aria-label="Next month">
                <ChevronRightIcon className="h-5 w-5" />
              </button>
            </div>
            {!isMonthSubmitted ? (
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
              Submit month
            </button>
            ) : (
              <>
                <span
                  className="btn btn-sm btn-outline h-11 min-h-11 gap-2 rounded-full border-gray-200 px-5 text-gray-700"
                  title={`Submitted on ${new Date(monthSubmission.submitted_at).toLocaleString('en-GB')}`}
                >
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-700 text-white">
                    <CheckIcon className="h-5 w-5 stroke-[3]" />
                  </span>
                  Submitted
                </span>
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
              </>
            )}
          </div>
          {submitBlockedByApproval && !isMonthSubmitted && monthSubmitBlockMessage && (
            <span className="max-w-md text-xs text-red-700">{monthSubmitBlockMessage}</span>
          )}
        </div>
      </div>
  );

  return (
    <div ref={hoursShellRef} className="my-profile-hours-shell w-full max-w-full min-w-0 space-y-5 px-1">
      <section>
      {headerActionsSlot ? createPortal(headerActions, headerActionsSlot) : headerActions}

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="flex items-center justify-between gap-3 rounded-2xl bg-gradient-to-tr from-purple-600 via-indigo-600 to-blue-500 p-5 text-white shadow-xl">
          <div>
            <p className="text-4xl font-bold">{periodTotal}</p>
            <p className="mt-1 text-lg font-semibold text-white/95">Worked</p>
            <div className="mt-2 h-2 w-full min-w-36 overflow-hidden rounded-full bg-white/20">
              <div
                className="h-full rounded-full bg-white shadow-sm transition-[width] duration-500"
                style={{ width: `${Math.min(100, workingHoursSummary.completion)}%` }}
              />
            </div>
            <p className="mt-1 text-sm font-semibold text-white/90">
              {workingHoursSummary.completion}% of expected
            </p>
          </div>
          <div className="rounded-full bg-white/20 p-4"><ClockIcon className="h-9 w-9" /></div>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-2xl bg-gradient-to-tr from-sky-600 via-cyan-500 to-blue-500 p-5 text-white shadow-xl">
          <div>
            <p className="text-4xl font-bold">{workingHoursDurationLabel(workingHoursSummary.adjustedExpectedMs)}</p>
            <p className="mt-1 text-lg font-semibold text-white/95">Expected</p>
            <p className="mt-1 text-sm text-white/80">
              {MONTH_NAMES[month - 1]} target after sick / vacation
            </p>
          </div>
          <div className="rounded-full bg-white/20 p-4"><CalendarDaysIcon className="h-9 w-9" /></div>
        </div>
        <div className={`flex items-center justify-between gap-3 rounded-2xl bg-gradient-to-tr p-5 text-white shadow-xl ${
          workingHoursSummary.balanceMs >= 0
            ? 'from-teal-600 via-emerald-500 to-green-500'
            : 'from-pink-500 via-rose-500 to-orange-500'
        }`}>
          <div className="min-w-0">
            <p className="text-4xl font-bold">
              {workingHoursSummary.balanceMs >= 0 ? '+' : '-'}
              {workingHoursDurationLabel(Math.abs(workingHoursSummary.balanceMs))}
            </p>
            <p className="mt-1 text-lg font-semibold text-white/95">Balance</p>
            {showOvertimePremiumSplit && (
              <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-white/25 pt-2">
                <span className="text-sm font-semibold text-white/95">
                  <span className="text-white/75">125%</span>{' '}
                  {workingHoursDurationLabel(periodOvertime.extraHours125Ms)}
                </span>
                <span className="text-sm font-semibold text-white/95">
                  <span className="text-white/75">150%</span>{' '}
                  {workingHoursDurationLabel(periodOvertime.extraHours150Ms)}
                </span>
              </div>
            )}
          </div>
          <div className="rounded-full bg-white/20 p-4 self-start"><CheckIcon className="h-9 w-9" /></div>
        </div>
        <button
          type="button"
          onClick={reviewMissingDays}
          className="flex items-center justify-between gap-3 rounded-2xl bg-gradient-to-tr from-amber-500 via-orange-500 to-yellow-500 p-5 text-left text-white shadow-xl transition-transform hover:scale-[1.02]"
        >
          <div>
            <p className="text-4xl font-bold">{periodMissingDays} {periodMissingDays === 1 ? 'day' : 'days'}</p>
            <p className="mt-1 text-lg font-semibold text-white/95">Missing entries</p>
            <p className="mt-1 text-sm text-white/80">Review days →</p>
          </div>
          <div className="rounded-full bg-white/20 p-4"><XMarkIcon className="h-9 w-9" /></div>
        </button>
      </div>

      <div className="mt-5 flex flex-col gap-3 border-t border-gray-100 pt-5 xl:flex-row xl:items-end xl:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex h-12 items-center rounded-full border border-gray-200 bg-white p-1 shadow-sm">
            <button type="button" className="btn btn-ghost btn-circle btn-sm" onClick={() => shiftWorkingHoursMonth(-1)} aria-label="Previous month">
              <ChevronLeftIcon className="h-5 w-5" />
            </button>
            <details ref={toolbarMonthFilterRef} className="dropdown">
              <summary className="btn btn-ghost h-10 min-h-10 min-w-[9rem] gap-2 rounded-full px-3 text-base font-semibold">
                <CalendarDaysIcon className="h-5 w-5 text-gray-400" />
                {SHORT_MONTH_NAMES[month - 1]} {year}
              </summary>
              <div className="dropdown-content z-40 mt-2 w-72 rounded-2xl border border-gray-100 bg-white p-4 shadow-xl">
                <div className="space-y-3">
                  <div className="form-control w-full">
              <YearWheelPicker
                label="Year"
                labelClassName="label-text text-sm text-gray-400 mb-1.5 font-medium"
                value={year}
                onChange={setYear}
              />
                  </div>
                  <label className="form-control w-full">
                    <span className="label-text mb-1.5 text-sm font-medium text-gray-400">Month</span>
                    <select className="select select-bordered h-12 w-full text-base" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                      {MONTH_NAMES.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}
                    </select>
                  </label>
                </div>
              </div>
            </details>
            <button type="button" className="btn btn-ghost btn-circle btn-sm" onClick={() => shiftWorkingHoursMonth(1)} aria-label="Next month">
              <ChevronRightIcon className="h-5 w-5" />
            </button>
          </div>
          <div className="min-w-0 w-full sm:w-44">
            <div className="dropdown w-full">
              <button
                type="button"
                tabIndex={0}
                className="btn btn-outline h-12 min-h-12 w-full justify-between rounded-full border-gray-200 bg-white px-4 text-base font-normal text-gray-800 hover:bg-gray-50"
              >
                <span className="truncate">{rowFilterSummary === 'All' ? 'All entries' : rowFilterSummary}</span>
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
          <button
            type="button"
            className="btn btn-outline h-12 min-h-12 rounded-full border-gray-200 bg-white px-5 text-gray-700 hover:bg-gray-50"
            onClick={goToTodayRow}
          >
            Today
          </button>
          <div className="inline-flex h-12 items-center gap-1 rounded-full bg-gray-200 p-1">
            {availableWeekNumbers.map((weekNum) => (
              <button
                key={weekNum}
                type="button"
                className={`h-10 rounded-full px-4 text-sm font-semibold transition-colors ${
                  selectedWeekNum === weekNum
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-800'
                }`}
                onClick={() => setSelectedWeekNum(weekNum)}
              >
                <span className="relative inline-block">
                  Week {weekNum}
                  {weeksWithUnavailability.has(weekNum) && (
                    <span
                      className="tooltip tooltip-error absolute -right-2 -top-1"
                      data-tip="This week contains unavailability"
                      title="This week contains unavailability"
                      aria-label="Contains unavailability"
                    >
                      <span className="block h-2 w-2 rounded-full bg-red-500" />
                    </span>
                  )}
                </span>
              </button>
            ))}
            <button
              type="button"
              className={`h-10 rounded-full px-4 text-sm font-semibold transition-colors ${
                selectedWeekNum === 0
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-800'
              }`}
              onClick={() => setSelectedWeekNum(0)}
            >
              All
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                className="btn btn-sm btn-outline h-11 min-h-11 gap-2 rounded-full border-gray-200 px-5"
                onClick={handleExportExcel}
                disabled={exporting || loading || mergedDayRows.length === 0}
                title="Download this employee's working hours as Excel"
              >
                {exporting ? (
                  <span className="loading loading-spinner loading-sm" />
                ) : (
                  <FaFileExcel className="w-6 h-6" />
                )}
                Export
              </button>
              <details
                ref={addEntryMenuRef}
                className={`dropdown dropdown-end ${addEntryOpenUpward ? 'dropdown-top' : ''}`}
              >
                <summary
                  className="btn btn-primary h-11 min-h-11 gap-2 rounded-full px-6"
                  onClick={() => {
                    const rect = addEntryMenuRef.current?.getBoundingClientRect();
                    if (!rect) return;
                    const estimatedMenuHeight = 230;
                    setAddEntryOpenUpward(
                      window.innerHeight - rect.bottom < estimatedMenuHeight
                      && rect.top > estimatedMenuHeight,
                    );
                  }}
                >
                  <PlusIcon className="h-5 w-5" />
                  Add entry
                  <span className="ml-1 inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/15">
                    <ChevronDownIcon className="h-5 w-5" />
                  </span>
                </summary>
                <ul className={`menu dropdown-content z-40 w-64 rounded-2xl border border-gray-100 bg-white p-2 shadow-xl ${
                  addEntryOpenUpward ? 'mb-2' : 'mt-2'
                }`}>
                  <li>
                    <button className="gap-3" type="button" disabled={!user?.id || isMonthSubmitted} onClick={() => { setManualClockInInitialDateKey(null); setManualClockInOpen(true); }}>
                      <ClockIcon className="h-5 w-5 shrink-0 text-gray-400" />
                      Add working hours
                    </button>
                  </li>
                  <li>
                    <button className="gap-3" type="button" disabled={!user?.id || isMonthSubmitted} onClick={handleBulkSelectModeToggle}>
                      <SquaresPlusIcon className="h-5 w-5 shrink-0 text-gray-400" />
                      Add multiple working days
                    </button>
                  </li>
                  <li>
                    <button
                      className="gap-3"
                      type="button"
                      disabled={isMonthSubmitted}
                      onClick={(event) => {
                        const today = new Date();
                        const isCurrentMonth =
                          today.getFullYear() === year && today.getMonth() + 1 === month;
                        const targetDate = isCurrentMonth
                          ? toDateInputValue(today)
                          : `${year}-${String(month).padStart(2, '0')}-01`;
                        setPendingCalendarDateKey(targetDate);
                        openCalendarModal();
                        const details = event.currentTarget.closest('details');
                        if (details) details.open = false;
                      }}
                    >
                      <CalendarDaysIcon className="h-5 w-5 shrink-0 text-gray-400" />
                      Add unavailability
                    </button>
                  </li>
                  <li>
                    <button
                      className="gap-3"
                      type="button"
                      disabled={!user?.id || isMonthSubmitted}
                      onClick={(event) => {
                        setOvertimeDateKey(toDateInputValue(new Date()));
                        setOvertimeDatePickerOpen(true);
                        const details = event.currentTarget.closest('details');
                        if (details) details.open = false;
                      }}
                    >
                      <PlusIcon className="h-5 w-5 shrink-0 text-gray-400" />
                      Add overtime
                    </button>
                  </li>
                </ul>
              </details>
        </div>
        </div>
      </section>

      {/* Working hours & unavailabilities */}
      <div className="w-full">
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
          rows={displayedDayRows}
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
          effectiveWorkedMsForDay={effectiveWorkedMsForDay}
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
          onAddClockIn={handlePlaceholderAddClockIn}
          isAutoFilledDay={isAutoFilledDay}
          onViewDocument={setSelectedDocument}
        />
        <div
          className={[
            'hidden md:block w-full',
            // The thead is transparent (see the style block below), so the column titles take
            // the colour of whatever sits behind them. In the HR employee file that is the grey
            // page background, so the table gets its own panel to keep headers and rows on one
            // white surface.
            embedded ? 'rounded-2xl border border-gray-200 bg-white p-4 shadow-sm' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {loading ? (
            <div className="overflow-x-auto rounded-2xl">
              <table className="pipeline-flat-table my-profile-hours-table w-full min-w-[64rem] table-fixed border-separate border-spacing-0 text-base">
                <WorkingHoursColGroup bulkSelectMode={bulkSelectMode} />
                <WorkingHoursColumnHead bulkSelectMode={bulkSelectMode} />
                <tbody>
                  <tr>
                    <td colSpan={tableColSpan} className="bg-white text-center py-12">
                      <span className="loading loading-spinner loading-md text-primary" />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : displayedDayRows.length === 0 ? (
            <div className="overflow-x-auto rounded-2xl">
              <table className="pipeline-flat-table my-profile-hours-table w-full min-w-[64rem] table-fixed border-separate border-spacing-0 text-base">
                <WorkingHoursColGroup bulkSelectMode={bulkSelectMode} />
                <WorkingHoursColumnHead bulkSelectMode={bulkSelectMode} />
                <tbody>
                  <tr>
                    <td colSpan={tableColSpan} className="bg-white text-center py-12 text-gray-400">
                      {hasActiveRowFilters
                        ? 'No entries match the selected filters.'
                        : 'No working hours or unavailabilities for this period.'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[64rem] flex flex-col gap-12">
              {displayedWeekSections.map((section) => (
                <div key={`wh-week-${section.weekNum}`}>
                  <WorkingHoursWeekHeading weekNum={section.weekNum} />
                  <div className="rounded-2xl">
                    <table
                      className="pipeline-flat-table my-profile-hours-table w-full table-fixed border-separate border-spacing-0 text-base"
                      style={
                        {
                          '--wh-week-accent': getWeekAccentColor(section.weekNum),
                        } as React.CSSProperties
                      }
                    >
                      <WorkingHoursColGroup bulkSelectMode={bulkSelectMode} />
                      <WorkingHoursColumnHead bulkSelectMode={bulkSelectMode} />
                      <tbody>
                        {section.rows.map((row) => {
                  const isPlaceholder =
                    row.isMissingPlaceholder ||
                    row.isHolidayPlaceholder ||
                    row.isWeekendPlaceholder ||
                    row.isFuturePlaceholder ||
                    row.isHolidayOffPlaceholder;
                  const isBulkSelectable =
                    bulkSelectMode &&
                    (row.isMissingPlaceholder ||
                      row.isHolidayPlaceholder ||
                      row.isWeekendPlaceholder ||
                      row.isFuturePlaceholder) &&
                    !isMonthSubmitted;
                  const isBulkSelected = bulkSelectedDateKeys.has(row.dateKey);
                  const weekMeta = weekRowMeta.get(row.dateKey);

                  if (isPlaceholder) {
                    const isWeekend = row.isWeekendPlaceholder === true;
                    const placeholderInteractive = !isMonthSubmitted;
                    const isHoliday = row.isHolidayPlaceholder;
                    const isHolidayOff = row.isHolidayOffPlaceholder === true;
                    const holidayLabel = row.holidayNames?.[0];
                    const rowClass = isWeekend
                      ? 'wh-weekend-placeholder'
                      : isHoliday || isHolidayOff
                        ? 'wh-holiday-placeholder'
                        : 'wh-missing-placeholder';
                    return (
                      <tr
                        key={row.dateKey}
                        id={`wh-row-${row.dateKey}`}
                        className={[
                          'pipeline-flat-row [&>td]:border-b [&>td]:border-gray-100',
                          rowClass,
                          placeholderInteractive && !bulkSelectMode ? 'wh-placeholder-interactive' : '',
                          isBulkSelected ? 'wh-bulk-selected pipeline-flat-row-selected' : '',
                        ].filter(Boolean).join(' ')}
                        onClick={
                          isBulkSelectable
                            ? () => toggleBulkDateSelection(row.dateKey)
                            : undefined
                        }
                      >
                        {bulkSelectMode && (
                          <td className="w-10 px-2 py-3 align-middle">
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
                          className={`relative font-medium wh-data-date-cell wh-date-week-accent ${WH_DATE_CELL}`}
                          style={workingHoursDateCellStyle(weekMeta?.weekNum)}
                        >
                          <div className="relative z-10 flex flex-col items-start gap-1.5 min-w-0">
                            <WorkingHoursDateLabel dateKey={row.dateKey} muted />
                          </div>
                        </td>
                        <td className={WH_DATA_CELL}>
                          <span className="text-gray-400">{isHolidayOff ? 'Free day' : 'No entry'}</span>
                        </td>
                        <td
                          colSpan={WH_PLACEHOLDER_HINT_COL_SPAN}
                          className={`${WH_DATA_CELL} wh-placeholder-hint ${isWeekend || isHoliday ? '' : 'italic'}`}
                        >
                          {isWeekend ? (
                            'Weekend'
                          ) : isHolidayOff ? (
                            <span className="flex flex-col items-start leading-snug">
                              <span>{holidayLabel || 'Holiday'}</span>
                              <span className="italic">Paid day off</span>
                            </span>
                          ) : isHoliday ? (
                            <span className="flex flex-col items-start leading-snug">
                              <span>{holidayLabel || 'Holiday'}</span>
                              <span className="italic">no entry yet</span>
                            </span>
                          ) : (
                            'No entry yet'
                          )}
                        </td>
                        <td className="relative px-2 py-3.5 border-b border-gray-100 whitespace-nowrap align-middle">
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
                      </tr>
                    );
                  }

                  const hasClock = row.clock != null;
                  const dayRecords = recordsByDay.get(row.dateKey) ?? [];
                  const autoFilledClock = hasClock && isAutoFilledDay(row.dateKey);
                  const approvalStatus = getDayClockInApprovalStatus(dayRecords, {
                    hasManualClockSummary: row.clock?.hasManual === true,
                  });
                  const declineNotes = formatDayDeclineNotes(dayRecords);
                  const overtimeDocs = collectDayOvertimeDocuments(dayRecords);
                  const approvalStatuses = collectDayApprovalStatuses({
                    hasClock,
                    hasManualClock: row.clock?.hasManual === true,
                    clockApprovalStatus: approvalStatus,
                    unavailabilities: row.unavailabilities,
                  });
                  return (
                    <tr
                      key={row.dateKey}
                      id={`wh-row-${row.dateKey}`}
                      className={`pipeline-flat-row wh-data-row [&>td]:border-b [&>td]:border-gray-100 ${clockInApprovalRowClass(approvalStatus)}`}
                    >
                      {bulkSelectMode && <td className="w-10 px-2" aria-hidden />}
                      <td
                        className={`relative font-medium wh-data-date-cell wh-date-week-accent ${WH_DATE_CELL}`}
                        style={workingHoursDateCellStyle(weekMeta?.weekNum)}
                      >
                        <div className="relative z-10 flex flex-col items-start gap-1.5 min-w-0">
                          <WorkingHoursDateLabel dateKey={row.dateKey} />
                        </div>
                      </td>
                      <td className={WH_DATA_CELL}>
                        {approvalStatuses.length === 0 && !declineNotes ? (
                          <span className="text-gray-400">—</span>
                        ) : (
                          <div className="flex flex-col items-start gap-1.5 min-w-0">
                            {approvalStatuses.map((status) => (
                              <WorkingHoursApprovalStatusLabel key={status} status={status} />
                            ))}
                            {declineNotes && (
                              <p
                                className="text-xs font-medium leading-snug text-red-700 max-w-[14rem]"
                                title={declineNotes}
                              >
                                {declineNotes}
                              </p>
                            )}
                          </div>
                        )}
                      </td>
                      <td className={WH_DATA_CELL}>
                        {row.unavailabilities.length > 0 ? (
                          <div className="flex flex-col gap-2">
                            {row.unavailabilities.map((unavail) => {
                              const details = timedGeneralAbsenceBadgeDetails(unavail);
                              return (
                                <div
                                  key={`${unavail.id}-${unavail.date}`}
                                  className="flex flex-col items-start gap-0.5"
                                >
                                  <UnavailabilityTypeBadge
                                    type={unavail.unavailability_type}
                                    size="md"
                                    borderless
                                    deductedHoursLabel={details?.deductedLabel}
                                    tooltip={details?.tooltip}
                                    displayLabel={details?.periodLabel}
                                    subtitle={details ? unavail.general_reason?.trim() || 'No details' : undefined}
                                  />
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className={WH_DATA_CELL}>
                        {hasClock ? (
                          <TimeListCell sessions={clockSessionsForDisplay(row.clock)} field="clockIn" />
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className={WH_DATA_CELL}>
                        {hasClock ? (
                          <TimeListCell sessions={clockSessionsForDisplay(row.clock)} field="clockOut" />
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className={`whitespace-nowrap ${WH_DATA_CELL}`}>
                        {hasClock ? (
                          <TotalDurationBadge
                            workedMs={effectiveWorkedMsForDay(row.dateKey, dayRecords)}
                            label={workingHoursDurationLabel(
                              effectiveWorkedMsForDay(row.dateKey, dayRecords),
                            )}
                            minHours={employeeMinHours}
                          />
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className={WH_DATA_CELL}>
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
                            {overtimeDocs.length === 0
                            && !row.unavailabilities.some((u) => u.document_url) ? (
                              <span className="text-gray-400">—</span>
                            ) : (
                              <>
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
                                {overtimeDocs.map((doc) => (
                                  <button
                                    key={`ot-doc-${doc.path}`}
                                    type="button"
                                    className="btn btn-ghost btn-sm btn-circle min-h-10 min-w-10 h-10 w-10 hover:bg-base-200"
                                    title={`${doc.name} (overtime approval)`}
                                    aria-label={`View overtime approval ${doc.name}`}
                                    onClick={() =>
                                      setSelectedDocument({
                                        url: doc.path,
                                        name: doc.name,
                                        reason: 'Overtime approval screenshot',
                                        uploadedAt: doc.uploadedAt,
                                        bucketName: CLOCK_IN_OVERTIME_APPROVAL_BUCKET,
                                      })
                                    }
                                  >
                                    <DocumentFileGlyph fileName={doc.name} className="h-7 w-7" />
                                  </button>
                                ))}
                              </>
                            )}
                          </div>
                          <div className="shrink-0">
                            <WorkingHoursRowActionsMenu
                              dateKey={row.dateKey}
                              unavailabilities={row.unavailabilities}
                              hasClock={hasClock}
                              autoFilledClock={autoFilledClock}
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
                              onAddClockIn={handlePlaceholderAddClockIn}
                            />
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                        }) }
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`
        .my-profile-hours-shell table.my-profile-hours-table {
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
          border-collapse: separate !important;
          border-spacing: 0 !important;
          table-layout: fixed !important;
          width: 100% !important;
        }

        .my-profile-hours-shell table.my-profile-hours-table col.wh-col-select { width: 2.5rem; }
        .my-profile-hours-shell table.my-profile-hours-table col.wh-col-date { width: 8%; }
        .my-profile-hours-shell table.my-profile-hours-table col.wh-col-status { width: 12%; }
        .my-profile-hours-shell table.my-profile-hours-table col.wh-col-unavailability { width: 11%; }
        .my-profile-hours-shell table.my-profile-hours-table col.wh-col-clock-in { width: 17%; }
        .my-profile-hours-shell table.my-profile-hours-table col.wh-col-clock-out { width: 17%; }
        .my-profile-hours-shell table.my-profile-hours-table col.wh-col-total { width: 7%; }
        .my-profile-hours-shell table.my-profile-hours-table col.wh-col-notes { width: 12%; }
        .my-profile-hours-shell table.my-profile-hours-table col.wh-col-document { width: 16%; }

        .my-profile-hours-shell table.my-profile-hours-table thead,
        .my-profile-hours-shell table.my-profile-hours-table thead tr,
        .my-profile-hours-shell table.my-profile-hours-table thead th {
          background-color: transparent !important;
          background-image: none !important;
          border-bottom: none !important;
          color: #9ca3af !important;
        }

        .my-profile-hours-shell table.my-profile-hours-table thead th:first-child {
          border-top-left-radius: 1rem !important;
        }

        .my-profile-hours-shell table.my-profile-hours-table thead th:last-child {
          border-top-right-radius: 1rem !important;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody tr:first-child > td:first-child {
          border-top-left-radius: 1rem !important;
          overflow: hidden !important;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody tr:first-child > td:last-child {
          border-top-right-radius: 1rem !important;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody tr:last-child > td:first-child {
          border-bottom-left-radius: 1rem !important;
          overflow: hidden !important;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody tr:last-child > td:last-child {
          border-bottom-right-radius: 1rem !important;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody tr {
          background: transparent !important;
          box-shadow: none !important;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody td {
          box-shadow: none !important;
          vertical-align: middle;
          overflow: hidden;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody tr.pipeline-flat-row:hover > td,
        .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-data-row:hover td {
          background-color: #ffffff !important;
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
          background: #f9fafb !important;
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
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-holiday-placeholder td.wh-placeholder-hint {
          color: #6b7280 !important;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-holiday-placeholder.wh-placeholder-interactive {
          cursor: pointer;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-weekend-placeholder td,
        .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-weekend-placeholder:hover td,
        .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-weekend-placeholder.wh-placeholder-interactive:hover td {
          background: #f8fafc !important;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-weekend-placeholder td.wh-placeholder-hint {
          color: #64748b !important;
          font-style: normal !important;
          font-weight: 600 !important;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-weekend-placeholder.wh-placeholder-interactive {
          cursor: pointer;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-bulk-selected td,
        .my-profile-hours-shell table.my-profile-hours-table tbody tr.pipeline-flat-row-selected td,
        .my-profile-hours-shell table.my-profile-hours-table tbody tr.pipeline-flat-row-selected:hover td {
          background: rgb(239 246 255) !important;
        }

        @media (min-width: 1024px) {
          .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-missing-placeholder.wh-placeholder-interactive .wh-placeholder-row-actions,
          .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-holiday-placeholder.wh-placeholder-interactive .wh-placeholder-row-actions,
          .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-weekend-placeholder.wh-placeholder-interactive .wh-placeholder-row-actions {
            opacity: 0;
            visibility: hidden;
            pointer-events: none;
            transition: opacity 0.15s ease, visibility 0.15s ease;
          }

          .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-missing-placeholder.wh-placeholder-interactive:hover .wh-placeholder-row-actions,
          .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-missing-placeholder.wh-placeholder-interactive:focus-within .wh-placeholder-row-actions,
          .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-holiday-placeholder.wh-placeholder-interactive:hover .wh-placeholder-row-actions,
          .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-holiday-placeholder.wh-placeholder-interactive:focus-within .wh-placeholder-row-actions,
          .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-weekend-placeholder.wh-placeholder-interactive:hover .wh-placeholder-row-actions,
          .my-profile-hours-shell table.my-profile-hours-table tbody tr.wh-weekend-placeholder.wh-placeholder-interactive:focus-within .wh-placeholder-row-actions {
            opacity: 1;
            visibility: visible;
            pointer-events: auto;
          }
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody td.wh-data-date-cell {
          vertical-align: top !important;
          position: relative;
          padding-left: 0.85rem !important;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody td:first-child {
          position: relative;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody td:first-child::before {
          content: '';
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: 3px;
          background: var(--wh-week-accent, #94a3b8);
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody tr:first-child td:first-child::before {
          border-top-left-radius: 1rem;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody tr:last-child td:first-child::before {
          border-bottom-left-radius: 1rem;
        }

        .my-profile-hours-shell table.my-profile-hours-table tbody td:last-child {
          overflow: visible !important;
        }

        .my-profile-hours-shell .wh-week-between-label {
          display: block;
          font-size: 15px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: var(--wh-week-accent, #64748b);
          white-space: nowrap;
        }
      `}</style>

      <ProfileBottomSheetModal
        open={calendarModalOpen}
        onClose={() => setCalendarModalOpen(false)}
        title={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            My Availability
            {calendarMissingDays > 0 && (
              <MissingDaysBadge count={calendarMissingDays} loading={loading} />
            )}
          </span>
        }
        hideFooter
        mobileFullHeight
        desktopFullScreen
        // Grey page backdrop on desktop; the calendar supplies its own padding there.
        contentClassName="px-5 py-5 md:p-0 md:bg-gray-50 md:flex md:flex-col"
        headerClassName="md:relative md:bg-gray-50 md:border-b-0"
        headerRight={
          <div className="flex items-center gap-3">
            <div className="hidden md:absolute md:left-1/2 md:top-1/2 md:flex md:-translate-x-1/2 md:-translate-y-1/2 md:items-center md:gap-2">
              <button
                type="button"
                onClick={() => calendarRef.current?.goToToday()}
                className="btn btn-ghost mr-2 h-10 min-h-10 rounded-full border border-gray-200 bg-white px-5 text-base font-semibold"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => calendarRef.current?.goToPrevious()}
                className="btn btn-ghost btn-circle h-10 min-h-10 w-10"
                aria-label="Previous"
              >
                <ChevronLeftIcon className="h-6 w-6" />
              </button>
              <span className="min-w-[13rem] text-center text-base font-semibold text-gray-800">
                {calendarRangeLabel}
              </span>
              <button
                type="button"
                onClick={() => calendarRef.current?.goToNext()}
                className="btn btn-ghost btn-circle h-10 min-h-10 w-10"
                aria-label="Next"
              >
                <ChevronRightIcon className="h-6 w-6" />
              </button>
            </div>
            <AvailabilityViewTabs
              view={calendarView}
              onChange={setCalendarView}
              className="hidden md:inline-flex"
            />
            <button
              type="button"
              onClick={() => setCalendarModalOpen(false)}
              className="btn btn-sm btn-ghost btn-circle h-9 min-h-9 w-9"
              aria-label="Close availability calendar"
              title="Close"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>
        }
      >
        <CompactAvailabilityCalendar
          key={`cal-${year}-${month}`}
          ref={calendarRef}
          employeeId={employeeId}
          initialYear={year}
          initialMonth={month}
          onMonthChange={handleCalendarMonthChange}
          workedMsByDate={calendarWorkedMsByDate}
          desktopPageLayout
          view={calendarView}
          onViewChange={setCalendarView}
          onRangeLabelChange={setCalendarRangeLabel}
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
        }}
      />

      <ClockInDayEditModal
        isOpen={!!editingClockInDay}
        employeeId={employeeId}
        userId={user?.id ?? ''}
        dateKey={editingClockInDay ?? ''}
        sessions={editingClockInSessions}
        createFromAutoFill={editingAutoFilledDay}
        onClose={() => setEditingClockInDay(null)}
        onSaved={() => {
          void fetchRecords();
        }}
      />

      {overtimeDatePickerOpen && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[10070] flex items-stretch justify-end bg-black/20 backdrop-blur-[1px]"
          onClick={(event) => {
            if (event.target === event.currentTarget) setOvertimeDatePickerOpen(false);
          }}
        >
          <aside className="h-full w-full max-w-sm border-l border-gray-200 bg-white shadow-2xl sm:rounded-l-3xl">
            <div className="flex items-center justify-between px-6 py-5">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Choose overtime date</h3>
                <p className="mt-1 text-sm text-gray-500">Select the day before entering the hours.</p>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-circle btn-sm"
                onClick={() => setOvertimeDatePickerOpen(false)}
                aria-label="Close"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="px-6 py-5">
              <label className="form-control w-full">
                <span className="label-text mb-1.5 text-sm font-medium text-gray-500">Date</span>
                <input
                  type="date"
                  className="input input-bordered w-full"
                  value={overtimeDateKey}
                  onChange={(event) => setOvertimeDateKey(event.target.value)}
                />
              </label>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {[
                  { label: 'Today', offset: 0 },
                  { label: 'Yesterday', offset: -1 },
                  { label: 'Tomorrow', offset: 1 },
                ].map((option) => {
                  const date = new Date();
                  date.setDate(date.getDate() + option.offset);
                  const dateKey = toDateInputValue(date);
                  const selected = overtimeDateKey === dateKey;
                  return (
                    <button
                      key={option.label}
                      type="button"
                      className={`btn btn-sm rounded-full ${
                        selected ? 'btn-primary' : 'btn-outline border-gray-200'
                      }`}
                      onClick={() => setOvertimeDateKey(dateKey)}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="absolute bottom-0 right-0 flex w-full max-w-sm justify-end gap-2 bg-white px-6 py-5 sm:rounded-bl-3xl">
              <button
                type="button"
                className="btn btn-ghost h-10 min-h-10 rounded-full px-5"
                onClick={() => setOvertimeDatePickerOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary h-10 min-h-10 rounded-full px-7"
                disabled={!overtimeDateKey}
                onClick={() => {
                  setOvertimeDatePickerOpen(false);
                  setManualClockInInitialDateKey(overtimeDateKey);
                  setManualClockInOpen(true);
                }}
              >
                Continue
              </button>
            </div>
          </aside>
        </div>,
        document.body,
      )}

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
          bucketName={selectedDocument.bucketName}
        />
      )}
    </div>
  );
};

export default WorkingHoursTab;
