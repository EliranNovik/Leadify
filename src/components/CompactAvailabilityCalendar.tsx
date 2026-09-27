import React, { useState, useEffect, useImperativeHandle, forwardRef, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useMsal } from '@azure/msal-react';
import {
  CalendarIcon,
  PlusIcon,
  TrashIcon,
  ClockIcon,
  CheckIcon,
  XMarkIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DocumentArrowUpIcon
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import UnavailabilityTypeBadge from './UnavailabilityTypeBadge';
import { UnavailabilityTypeIcon } from './UnavailabilityTypeBadge';
import HolidayEntryWarningModal from './profile/HolidayEntryWarningModal';
import {
  unavailabilityTypeCompactLabelClass,
  unavailabilityTypeShortLabel,
  approvalFieldsForUnavailabilityType,
  type UnavailabilityType,
} from '../lib/employeeUnavailabilities';
import {
  getHolidayNamesForDate,
  getHolidayWarningsForDates,
  getHolidaysForYearMap,
  preloadHolidayYears,
} from '../lib/israeliJewishHolidays';
import { eachDayInRange } from '../lib/employeeClockInFormat';
import type { HolidayDateWarning } from '../lib/israeliJewishHolidays';

interface UnavailableTime {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  reason: string;
  outlookEventId?: string;
}

interface UnavailableRange {
  id: string;
  startDate: string;
  endDate: string;
  reason: string;
  outlookEventId?: string;
}

interface CalendarDay {
  date: Date;
  isCurrentMonth: boolean;
  isToday: boolean;
  unavailableTimes: UnavailableTime[];
  isInUnavailableRange: boolean;
  unavailableRangeReason?: string;
  unavailabilityTypes: UnavailabilityType[];
  holidays: string[];
  hasMeeting: boolean;
}

export interface CompactAvailabilityCalendarRef {
  openAddRangeModal: () => void;
  openAddUnavailabilityModal: () => void;
  openAddSickDayForDate: (dateKey: string) => void;
  openDayForDate: (dateKey: string) => void;
  /** Step back / forward by one day, week or month, whichever the view shows. */
  goToPrevious: () => void;
  goToNext: () => void;
  goToToday: () => void;
}

interface CompactAvailabilityCalendarProps {
  onAvailabilityChange?: () => void;
  /** When set (e.g. My Profile), skips auth lookup for employee id. */
  employeeId?: number;
  /** Sync calendar to this month when opened or filter changes (1–12). */
  initialYear?: number;
  initialMonth?: number;
  onMonthChange?: (year: number, month1to12: number) => void;
  /**
   * Hours worked per YYYY-MM-DD, shown inside each day box on desktop. Days without an
   * entry stay out of the map. Only the caller knows which clock-ins count, so it does
   * the summing.
   */
  workedMsByDate?: Map<string, number>;
  /**
   * Desktop only: lay the calendar out as a page — grey backdrop, month picker in a left
   * sidebar, the month grid in a white card. Mobile keeps the single-column layout.
   */
  desktopPageLayout?: boolean;
  /**
   * Which view to render. The switch lives in the host's header, so the host owns this.
   * Left out, the calendar stays on the month grid.
   */
  view?: AvailabilityCalendarView;
  onViewChange?: (view: AvailabilityCalendarView) => void;
  /**
   * Reports the label for the range on screen ("Sep 2026", "Sunday 27 September 2026"),
   * so a host that puts the navigation in its own header can show it.
   */
  onRangeLabelChange?: (label: string) => void;
  /** Dashboard card: dots instead of holiday names and no boxes outside the month. */
  simplified?: boolean;
  /** Optional action shown in the full calendar's Create menu. */
  onUploadSickDays?: () => void;
}

const MINI_WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const monthNames = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export type AvailabilityCalendarView = 'day' | 'week' | 'month';

const CALENDAR_VIEWS: { id: AvailabilityCalendarView; label: string }[] = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
];

/** Segmented control for the view switch. Lives in the modal header, not the calendar card. */
export function AvailabilityViewTabs({
  view,
  onChange,
  className = '',
}: {
  view: AvailabilityCalendarView;
  onChange: (view: AvailabilityCalendarView) => void;
  className?: string;
}) {
  return (
    <div className={`inline-flex items-center gap-1 rounded-lg bg-gray-200/70 p-1 ${className}`}>
      {CALENDAR_VIEWS.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          aria-pressed={view === option.id}
          className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
            view === option.id
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Row height of one hour in the day and week grids. */
const HOUR_ROW_PX = 48;
/** Where the grid is scrolled when it opens, so the working day is in view. */
const TIME_GRID_INITIAL_HOUR = 7;

type TimedCalendarItem = {
  key: string;
  /** Hours since midnight, fractional. */
  startHour: number;
  endHour: number;
  label: string;
  className: string;
  unavailabilityType?: UnavailabilityType | string;
};

type AllDayCalendarItem = {
  key: string;
  label: string;
  className: string;
  unavailabilityType?: UnavailabilityType | string;
};

function hoursFromTimeString(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value).trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours + minutes / 60;
}

function formatHourLabel(hour: number): string {
  if (hour === 0 || hour === 24) return '';
  const suffix = hour < 12 ? 'AM' : 'PM';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display} ${suffix}`;
}

function hourValueToTime(hourValue: number): string {
  const totalMinutes = Math.round(Math.max(0, Math.min(24, hourValue)) * 60);
  const hours = Math.min(23, Math.floor(totalMinutes / 60));
  const minutes = totalMinutes >= 24 * 60 ? 59 : totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function startOfWeek(date: Date): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - start.getDay());
  return start;
}

/**
 * Day and week views: an all-day strip over a scrollable 24-hour grid, the way a calendar
 * app lays them out. Only entries with both a start and an end time get a positioned
 * block; everything else belongs in the all-day strip.
 */
function AvailabilityTimeGrid({
  days,
  timedByDate,
  allDayByDate,
  scrollToNowRequest,
  unavailabilityModalOpen,
  onSelectDate,
  onSelectTimeRange,
}: {
  days: Date[];
  timedByDate: Map<string, TimedCalendarItem[]>;
  allDayByDate: Map<string, AllDayCalendarItem[]>;
  scrollToNowRequest: number;
  unavailabilityModalOpen: boolean;
  onSelectDate: (date: Date) => void;
  onSelectTimeRange: (date: Date, startHour: number, endHour: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [nowMinutes, setNowMinutes] = useState(() => {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  });
  const [dragSelection, setDragSelection] = useState<{
    dateKey: string;
    anchorHour: number;
    startHour: number;
    endHour: number;
    pointerId: number;
    moved: boolean;
  } | null>(null);

  const hourAtPointer = (element: HTMLElement, clientY: number): number => {
    const rect = element.getBoundingClientRect();
    const rawHour = (clientY - rect.top) / HOUR_ROW_PX;
    return Math.max(0, Math.min(23.5, Math.floor(rawHour * 2) / 2));
  };

  useEffect(() => {
    const body = scrollRef.current;
    if (body) body.scrollTop = TIME_GRID_INITIAL_HOUR * HOUR_ROW_PX;
  }, []);

  useEffect(() => {
    if (scrollToNowRequest === 0) return;
    const body = scrollRef.current;
    if (!body) return;
    const now = new Date();
    const currentHour = now.getHours() + now.getMinutes() / 60;
    body.scrollTo({
      top: Math.max(0, currentHour - 1) * HOUR_ROW_PX,
      behavior: 'smooth',
    });
  }, [scrollToNowRequest]);

  useEffect(() => {
    if (!unavailabilityModalOpen) setDragSelection(null);
  }, [unavailabilityModalOpen]);

  useEffect(() => {
    const tick = window.setInterval(() => {
      const now = new Date();
      setNowMinutes(now.getHours() * 60 + now.getMinutes());
    }, 60_000);
    return () => window.clearInterval(tick);
  }, []);

  const todayKey = toLocalDateKey(new Date());
  const gridTemplate = `4rem repeat(${days.length}, minmax(0, 1fr))`;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Day headers + all-day strip */}
      {/* The time body has a vertical scrollbar. Reserve the same width here so every
          header column stays directly above its time-grid column. */}
      <div className="shrink-0 border-b border-gray-200 bg-white pr-3">
        <div className="grid" style={{ gridTemplateColumns: gridTemplate }}>
          <div className="border-r border-gray-200 px-2 py-1 text-[10px] font-medium text-gray-400">
            GMT+03
          </div>
          {days.map((day) => {
            const dateKey = toLocalDateKey(day);
            const isToday = dateKey === todayKey;
            const isWeekend = day.getDay() === 5 || day.getDay() === 6;
            const isPastDay = days.length > 1 && dateKey < todayKey;
            return (
              <button
                key={dateKey}
                type="button"
                onClick={() => onSelectDate(day)}
                className={`border-r border-gray-200 px-2 py-1 last:border-r-0 hover:bg-gray-50 ${
                  days.length === 1 ? 'text-left' : 'text-center'
                } ${
                  isWeekend ? 'bg-gray-100/80' : ''
                } ${isPastDay ? 'bg-gray-50 opacity-60 grayscale-[35%]' : ''}`}
              >
                <div className={`${days.length > 1 ? 'text-sm' : 'text-base'} font-medium uppercase tracking-wide ${
                  isWeekend ? 'text-red-500' : 'text-gray-500'
                }`}>
                  {day.toLocaleDateString('en-US', { weekday: 'short' })}
                </div>
                <div
                  className={`flex items-center justify-center rounded-full font-semibold ${
                    days.length > 1 ? 'mx-auto h-9 w-9 text-lg' : 'h-10 w-10 text-xl'
                  } ${
                    isToday ? 'bg-violet-600 text-white' : 'text-gray-800'
                  }`}
                >
                  {day.getDate()}
                </div>
              </button>
            );
          })}
        </div>
        <div className="grid border-t border-gray-100" style={{ gridTemplateColumns: gridTemplate }}>
          <div className="border-r border-gray-200 px-2 py-1 text-[11px] text-gray-400">
            All day
          </div>
          {days.map((day) => {
            const dateKey = toLocalDateKey(day);
            const items = allDayByDate.get(dateKey) ?? [];
            const isWeekend = day.getDay() === 5 || day.getDay() === 6;
            const isPastDay = days.length > 1 && dateKey < todayKey;
            return (
              <div
                key={dateKey}
                className={`min-h-[1.75rem] space-y-0.5 border-r border-gray-200 px-1 py-1 last:border-r-0 ${
                  isWeekend ? 'bg-gray-100/80' : ''
                } ${isPastDay ? 'bg-gray-50 opacity-60 grayscale-[35%]' : ''}`}
              >
                {items.map((item) => (
                  <div
                    key={item.key}
                    title={item.label}
                    className={`flex items-center gap-1.5 truncate rounded px-2 py-1 text-xs font-semibold md:text-sm ${item.className}`}
                  >
                    {item.unavailabilityType && (
                      <UnavailabilityTypeIcon
                        type={item.unavailabilityType}
                        className="h-4 w-4 shrink-0"
                      />
                    )}
                    <span className="truncate">{item.label}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* Scrollable hour grid */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-scroll bg-white"
        style={{ scrollbarGutter: 'stable' }}
      >
        <div className="grid" style={{ gridTemplateColumns: gridTemplate }}>
          <div className="border-r border-gray-200">
            {Array.from({ length: 24 }, (_, hour) => (
              <div
                key={hour}
                className="relative border-b border-gray-100"
                style={{ height: HOUR_ROW_PX }}
              >
                <span className="absolute -top-2 right-1.5 bg-white px-0.5 text-[11px] text-gray-400">
                  {formatHourLabel(hour)}
                </span>
              </div>
            ))}
          </div>
          {days.map((day) => {
            const dateKey = toLocalDateKey(day);
            const items = timedByDate.get(dateKey) ?? [];
            const isToday = dateKey === todayKey;
            const isWeekend = day.getDay() === 5 || day.getDay() === 6;
            const isPastDay = days.length > 1 && dateKey < todayKey;
            return (
              <div
                key={dateKey}
                className={`relative border-r border-gray-200 last:border-r-0 ${
                  isWeekend ? 'bg-gray-100/80' : ''
                } ${isPastDay ? 'bg-gray-50 opacity-60 grayscale-[35%]' : ''}`}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  const startHour = hourAtPointer(event.currentTarget, event.clientY);
                  setDragSelection({
                    dateKey,
                    anchorHour: startHour,
                    startHour,
                    endHour: Math.min(24, startHour + 0.5),
                    pointerId: event.pointerId,
                    moved: false,
                  });
                }}
                onPointerMove={(event) => {
                  if (!dragSelection || dragSelection.pointerId !== event.pointerId) return;
                  const pointedHour = hourAtPointer(event.currentTarget, event.clientY);
                  const rangeStart = Math.min(dragSelection.anchorHour, pointedHour);
                  const rangeEnd = Math.min(
                    24,
                    Math.max(dragSelection.anchorHour, pointedHour) + 0.5,
                  );
                  setDragSelection({
                    ...dragSelection,
                    startHour: rangeStart,
                    endHour: rangeEnd,
                    moved:
                      dragSelection.moved
                      || Math.abs(pointedHour - dragSelection.anchorHour) >= 0.5,
                  });
                }}
                onPointerUp={(event) => {
                  if (!dragSelection || dragSelection.pointerId !== event.pointerId) return;
                  event.currentTarget.releasePointerCapture(event.pointerId);
                  const startHour = dragSelection.startHour;
                  const endHour = dragSelection.moved
                    ? dragSelection.endHour
                    : Math.min(24, startHour + 1);
                  // Keep the finalized purple selection visible behind the modal. It is
                  // cleared when the modal closes.
                  setDragSelection({
                    ...dragSelection,
                    startHour,
                    endHour,
                    pointerId: -1,
                    moved: true,
                  });
                  onSelectTimeRange(day, startHour, endHour);
                }}
                onPointerCancel={() => setDragSelection(null)}
              >
                {Array.from({ length: 24 }, (_, hour) => (
                  <div
                    key={hour}
                    className="border-b border-gray-100"
                    style={{ height: HOUR_ROW_PX }}
                  />
                ))}
                {items.map((item) => {
                  const top = item.startHour * HOUR_ROW_PX;
                  const height = Math.max(
                    (item.endHour - item.startHour) * HOUR_ROW_PX,
                    HOUR_ROW_PX / 2,
                  );
                  const [itemTypeLabel, itemTimeLabel] = item.label.split(' · ');
                  return (
                    <div
                      key={item.key}
                      title={item.label}
                      className={`absolute left-1 right-1 overflow-hidden rounded-md px-2 py-1 text-xs font-semibold shadow-sm md:text-sm ${item.className}`}
                      style={{ top, height }}
                    >
                      <span className="flex items-start gap-1">
                        {item.unavailabilityType && (
                          <UnavailabilityTypeIcon
                            type={item.unavailabilityType}
                            className="h-4 w-4 shrink-0"
                          />
                        )}
                        {days.length > 1 && itemTimeLabel ? (
                          <span className="flex min-w-0 flex-col leading-tight">
                            <span className="truncate">{itemTypeLabel}</span>
                            <span className="truncate font-medium opacity-75">{itemTimeLabel}</span>
                          </span>
                        ) : (
                          <span className="truncate">{item.label}</span>
                        )}
                      </span>
                    </div>
                  );
                })}
                {dragSelection?.dateKey === dateKey && (
                  <div
                    className="pointer-events-none absolute left-1 right-1 z-20 flex items-start justify-center overflow-hidden rounded-md bg-violet-200/80 px-1 py-1"
                    style={{
                      top: dragSelection.startHour * HOUR_ROW_PX,
                      height: Math.max(
                        (dragSelection.endHour - dragSelection.startHour) * HOUR_ROW_PX,
                        HOUR_ROW_PX / 2,
                      ),
                    }}
                  >
                    <span className="rounded bg-white/80 px-1.5 py-0.5 text-[11px] font-semibold text-violet-800 shadow-sm">
                      {hourValueToTime(dragSelection.startHour)}–{hourValueToTime(dragSelection.endHour)}
                    </span>
                  </div>
                )}
                {isToday && (
                  <div
                    className="pointer-events-none absolute left-0 right-0 z-10 border-t-2 border-red-500"
                    style={{ top: (nowMinutes / 60) * HOUR_ROW_PX }}
                  >
                    <span className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-red-500" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * Month picker for the sidebar. Deliberately plain: no unavailability, holiday or meeting
 * markers, so it stays readable next to the full grid.
 */
function MiniMonthCalendar({
  year,
  month,
  monthLabel,
  unavailableDateKeys,
  onPrevMonth,
  onNextMonth,
  onSelectDate,
}: {
  year: number;
  /** 0-based, matching Date. */
  month: number;
  monthLabel: string;
  unavailableDateKeys: Set<string>;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onSelectDate: (date: Date) => void;
}) {
  const todayKey = toLocalDateKey(new Date());
  const leadingBlanks = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  return (
    <div className="p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-700">{monthLabel}</span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={onPrevMonth}
            className="btn btn-xs btn-circle border-0 bg-white shadow-sm hover:bg-gray-100"
            aria-label="Previous month"
          >
            <ChevronLeftIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onNextMonth}
            className="btn btn-xs btn-circle border-0 bg-white shadow-sm hover:bg-gray-100"
            aria-label="Next month"
          >
            <ChevronRightIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {MINI_WEEKDAY_INITIALS.map((initial, idx) => (
          <div
            key={idx}
            className={`text-center text-[11px] font-medium ${
              idx === 5 || idx === 6 ? 'text-red-500' : 'text-gray-400'
            }`}
          >
            {initial}
          </div>
        ))}
        {Array.from({ length: leadingBlanks }, (_, idx) => (
          <div key={`blank-${idx}`} />
        ))}
        {Array.from({ length: daysInMonth }, (_, idx) => {
          const dayNum = idx + 1;
          const date = new Date(year, month, dayNum);
          const isToday = toLocalDateKey(date) === todayKey;
          const isUnavailable = unavailableDateKeys.has(toLocalDateKey(date));
          const isWeekend = date.getDay() === 5 || date.getDay() === 6;
          return (
            <button
              key={dayNum}
              type="button"
              onClick={() => onSelectDate(date)}
              className={`relative mx-auto flex h-7 w-7 items-center justify-center rounded-full text-xs transition-colors ${
                isToday
                  ? 'bg-violet-600 font-semibold text-white'
                  : isWeekend
                    ? 'bg-gray-200/80 text-gray-700 hover:bg-gray-300/80'
                    : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              {dayNum}
              {isUnavailable && (
                <span
                  className="absolute right-0 top-0 h-1.5 w-1.5 rounded-full bg-red-500 ring-1 ring-gray-50"
                  aria-label="Unavailable"
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Compact enough for a calendar box: "8h", "7h 30m". */
function compactHoursLabel(totalMs: number): string {
  const minutes = Math.round(totalMs / 60_000);
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours <= 0) return `${mins}m`;
  return mins === 0 ? `${hours}h` : `${hours}h ${mins}m`;
}

type ReasonUnavailabilityRow = {
  start_date: string;
  end_date: string | null;
  start_time?: string | null;
  end_time?: string | null;
  unavailability_type: UnavailabilityType;
};

const CompactAvailabilityCalendar = forwardRef<CompactAvailabilityCalendarRef, CompactAvailabilityCalendarProps>((props, ref) => {
  const {
    onAvailabilityChange,
    employeeId: employeeIdProp,
    initialYear,
    initialMonth,
    onMonthChange,
    workedMsByDate,
    desktopPageLayout = false,
    view = 'month',
    onViewChange,
    onRangeLabelChange,
    simplified = false,
    onUploadSickDays,
  } = props;
  const { instance } = useMsal();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [unavailableTimes, setUnavailableTimes] = useState<UnavailableTime[]>([]);
  const [unavailableRanges, setUnavailableRanges] = useState<UnavailableRange[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showAddRangeModal, setShowAddRangeModal] = useState(false);
  const [newUnavailableTime, setNewUnavailableTime] = useState({
    startTime: '09:00',
    endTime: '17:00',
    reason: '',
    unavailabilityType: 'general' as 'sick_days' | 'vacation' | 'general',
    documentFile: null as File | null
  });
  const [newUnavailableRange, setNewUnavailableRange] = useState({
    startDate: '',
    endDate: '',
    reason: '',
    unavailabilityType: 'general' as 'sick_days' | 'vacation' | 'general',
    documentFile: null as File | null
  });
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const [currentEmployeeId, setCurrentEmployeeId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [outlookSyncEnabled, setOutlookSyncEnabled] = useState(false);
  const [meetingDates, setMeetingDates] = useState<Set<string>>(new Set());
  const [selectedDateMeetings, setSelectedDateMeetings] = useState<any[]>([]);
  const [rangeMeetings, setRangeMeetings] = useState<Map<string, any[]>>(new Map());
  const [existingUnavailabilities, setExistingUnavailabilities] = useState<any[]>([]);
  const [editingUnavailability, setEditingUnavailability] = useState<any | null>(null);
  const [reasonUnavailabilities, setReasonUnavailabilities] = useState<ReasonUnavailabilityRow[]>([]);
  const [selectedDateHolidays, setSelectedDateHolidays] = useState<string[]>([]);
  const [holidayWarningOpen, setHolidayWarningOpen] = useState(false);
  const [holidayWarnings, setHolidayWarnings] = useState<HolidayDateWarning[]>([]);
  const [scrollToNowRequest, setScrollToNowRequest] = useState(0);
  const pendingHolidaySaveRef = useRef<(() => Promise<void>) | null>(null);

  // Get current month and year
  const currentMonth = currentDate.getMonth();
  const currentYear = currentDate.getFullYear();

  const [holidayMapVersion, setHolidayMapVersion] = useState(0);

  const yearHolidayMap = useMemo(
    () => getHolidaysForYearMap(currentYear),
    [currentYear, holidayMapVersion],
  );

  useEffect(() => {
    let cancelled = false;
    void preloadHolidayYears([currentYear - 1, currentYear, currentYear + 1]).then(() => {
      if (!cancelled) setHolidayMapVersion((v) => v + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [currentYear]);

  const runWithHolidayCheck = async (dates: string[], saveFn: () => Promise<void>) => {
    const warnings = await getHolidayWarningsForDates(dates);
    if (warnings.length === 0) {
      await saveFn();
      return;
    }
    pendingHolidaySaveRef.current = saveFn;
    setHolidayWarnings(warnings);
    setHolidayWarningOpen(true);
  };

  const handleHolidayContinue = async () => {
    const saveFn = pendingHolidaySaveRef.current;
    pendingHolidaySaveRef.current = null;
    setHolidayWarningOpen(false);
    setHolidayWarnings([]);
    if (saveFn) await saveFn();
  };

  const goToMonth = (next: Date) => {
    setCurrentDate(next);
    onMonthChange?.(next.getFullYear(), next.getMonth() + 1);
  };

  useEffect(() => {
    if (initialYear == null || initialMonth == null) return;
    // Land on today when that is the requested month, so the day view opens on today
    // rather than the 1st. The month view only reads the month and year either way.
    const today = new Date();
    const isCurrentMonth =
      today.getFullYear() === initialYear && today.getMonth() + 1 === initialMonth;
    setCurrentDate(
      new Date(initialYear, initialMonth - 1, isCurrentMonth ? today.getDate() : 1),
    );
    onMonthChange?.(initialYear, initialMonth);
  }, [initialYear, initialMonth, onMonthChange]);

  // Generate calendar days
  const generateCalendarDays = (): CalendarDay[] => {
    const firstDayOfMonth = new Date(currentYear, currentMonth, 1);
    const lastDayOfMonth = new Date(currentYear, currentMonth + 1, 0);
    const firstDayOfWeek = firstDayOfMonth.getDay();
    const daysInMonth = lastDayOfMonth.getDate();

    const days: CalendarDay[] = [];

    // Add previous month's trailing days
    for (let i = firstDayOfWeek - 1; i >= 0; i--) {
      const date = new Date(currentYear, currentMonth, -i);
      days.push({
        date,
        isCurrentMonth: false,
        isToday: false,
        unavailableTimes: [],
        isInUnavailableRange: false,
        unavailabilityTypes: [],
        holidays: [],
        hasMeeting: false
      });
    }

    // Add current month's days
    for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
      const date = new Date(currentYear, currentMonth, dayNum);
      const dateString = toLocalDateKey(date);
      const dayUnavailableTimes = unavailableTimes.filter(ut => ut.date === dateString);

      // Check if this date is in any unavailable range
      const rangeInfo = unavailableRanges.find(range => {
        const isInRange = dateString >= range.startDate && dateString <= range.endDate;
        return isInRange;
      });

      const matchingReasons = reasonUnavailabilities.filter((reason) => {
        const end = reason.end_date || reason.start_date;
        return dateString >= reason.start_date && dateString <= end;
      });
      const isInReasonRange = matchingReasons.length > 0;
      const unavailabilityTypes = [
        ...new Set(matchingReasons.map((reason) => reason.unavailability_type)),
      ];

      // Check if this date has a meeting
      const hasMeeting = meetingDates.has(dateString);
      const holidays = [...(yearHolidayMap.get(dateString) ?? [])];

      days.push({
        date,
        isCurrentMonth: true,
        isToday: date.toDateString() === new Date().toDateString(),
        unavailableTimes: dayUnavailableTimes,
        isInUnavailableRange: !!rangeInfo || isInReasonRange,
        unavailableRangeReason: rangeInfo?.reason,
        unavailabilityTypes,
        holidays,
        hasMeeting
      });
    }

    // Add next month's leading days
    const remainingDays = 42 - days.length;
    for (let dayNum = 1; dayNum <= remainingDays; dayNum++) {
      const date = new Date(currentYear, currentMonth + 1, dayNum);
      days.push({
        date,
        isCurrentMonth: false,
        isToday: false,
        unavailableTimes: [],
        isInUnavailableRange: false,
        unavailabilityTypes: [],
        holidays: [],
        hasMeeting: false
      });
    }

    return days;
  };

  // Fetch user's unavailable times
  const fetchUnavailableTimes = async () => {
    try {
      let userEmployeeId: number | null = employeeIdProp ?? null;
      let userDisplayName: string | null = null;

      if (!userEmployeeId) {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user?.id) return;

        const { data: userData, error: userError } = await supabase
          .from('users')
          .select(`
            full_name,
            employee_id,
            tenants_employee!employee_id(
              id,
              display_name
            )
          `)
          .eq('auth_id', user.id)
          .single();

        if (userError || !userData) {
          console.error('Error getting user data:', userError);
          return;
        }

        if (userData?.employee_id) {
          userEmployeeId = userData.employee_id;
        }

        if (userData?.tenants_employee) {
          const empData = Array.isArray(userData.tenants_employee)
            ? userData.tenants_employee[0]
            : userData.tenants_employee;
          if (empData?.display_name) {
            userDisplayName = empData.display_name;
          }
        }

        if (!userDisplayName && userData?.full_name) {
          userDisplayName = userData.full_name;
        }
      } else {
        const { data: empData } = await supabase
          .from('tenants_employee')
          .select('display_name')
          .eq('id', userEmployeeId)
          .maybeSingle();
        userDisplayName = empData?.display_name ?? null;
      }

      if (userEmployeeId) {
        const { data: employeeData, error } = await supabase
          .from('tenants_employee')
          .select('unavailable_times, outlook_calendar_sync, id, unavailable_ranges')
          .eq('id', userEmployeeId)
          .single();

        if (error) {
          console.error('Error fetching unavailable times:', error);
          return;
        }

        if (employeeData) {
          setUnavailableTimes(employeeData.unavailable_times || []);
          setOutlookSyncEnabled(employeeData.outlook_calendar_sync || false);
          setCurrentEmployeeId(employeeData.id);

          if (employeeData.unavailable_ranges) {
            setUnavailableRanges(employeeData.unavailable_ranges);
          } else {
            setUnavailableRanges([]);
          }
        }

        const lastDay = new Date(currentYear, currentMonth + 1, 0).getDate();
        const monthStart = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-01`;
        const monthEnd = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

        const { data: reasonsData, error: reasonsError } = await supabase
          .from('employee_unavailability_reasons')
          .select('start_date, end_date, start_time, end_time, unavailability_type')
          .eq('employee_id', userEmployeeId);

        if (reasonsError) {
          console.error('Error fetching unavailability reasons for calendar:', reasonsError);
          setReasonUnavailabilities([]);
        } else {
          const filtered = (reasonsData || []).filter((reason: ReasonUnavailabilityRow) => {
            const end = reason.end_date || reason.start_date;
            return reason.start_date <= monthEnd && end >= monthStart;
          });
          setReasonUnavailabilities(filtered as ReasonUnavailabilityRow[]);
        }
      } else {
        console.error('No employee_id found for calendar');
        setReasonUnavailabilities([]);
      }

      await fetchUserMeetings(userDisplayName || '', userEmployeeId || undefined);
    } catch (error) {
      console.error('Error fetching unavailable times:', error);
    }
  };

  // Fetch meetings where user is manager or helper (same logic as Dashboard)
  const fetchUserMeetings = async (userDisplayName: string, employeeId?: number) => {
    try {
      const meetingDatesSet = new Set<string>();

      if (!employeeId && !userDisplayName) {
        setMeetingDates(meetingDatesSet);
        return;
      }

      // Calculate date range for current month (first day to last day)
      const firstDayOfMonth = new Date(currentYear, currentMonth, 1);
      const lastDayOfMonth = new Date(currentYear, currentMonth + 1, 0);
      const startDateStr = firstDayOfMonth.toISOString().split('T')[0];
      const endDateStr = lastDayOfMonth.toISOString().split('T')[0];

      // Fetch all meetings with proper joins to both leads and leads_lead tables (same as Dashboard)
      const { data: meetings, error } = await supabase
        .from('meetings')
        .select(`
          meeting_date,
          meeting_time,
          meeting_manager,
          expert,
          helper,
          lead:leads!client_id(
            id, name, lead_number, manager, topic, expert, stage, scheduler, helper, closer, handler
          ),
          legacy_lead:leads_lead!legacy_lead_id(
            id, name, meeting_manager_id, meeting_lawyer_id, meeting_scheduler_id, expert_id, closer_id, case_handler_id
          )
        `)
        .gte('meeting_date', startDateStr)
        .lte('meeting_date', endDateStr)
        .or('status.is.null,status.neq.canceled');

      if (error) {
        console.error('Error fetching meetings:', error);
        setMeetingDates(meetingDatesSet);
        return;
      }

      if (!meetings || meetings.length === 0) {
        setMeetingDates(meetingDatesSet);
        return;
      }

      // Helper function to check if user matches any role (same logic as Dashboard)
      const userMatchesRole = (meeting: any): boolean => {
        // Check legacy lead roles
        if (meeting.legacy_lead) {
          const legacyLead = meeting.legacy_lead;
          if (employeeId) {
            return (
              legacyLead.meeting_scheduler_id?.toString() === employeeId.toString() ||
              legacyLead.meeting_manager_id?.toString() === employeeId.toString() ||
              legacyLead.meeting_lawyer_id?.toString() === employeeId.toString() ||
              legacyLead.expert_id?.toString() === employeeId.toString() ||
              legacyLead.closer_id?.toString() === employeeId.toString() ||
              legacyLead.case_handler_id?.toString() === employeeId.toString()
            );
          }
        }

        // Check new lead roles
        if (meeting.lead) {
          const newLead = meeting.lead;
          // For new leads, fields might be IDs or display names
          const checkField = (field: any): boolean => {
            if (!field) return false;
            // If it's a number/ID, compare directly with employee_id
            if (!isNaN(Number(field))) {
              return employeeId ? field.toString() === employeeId.toString() : false;
            }
            // If it's a string (display name), compare with user's display name
            if (typeof field === 'string' && userDisplayName) {
              return field.trim() === userDisplayName.trim();
            }
            return false;
          };

          return (
            checkField(newLead.scheduler) ||
            checkField(newLead.manager) ||
            checkField(newLead.helper) ||
            checkField(newLead.expert) ||
            checkField(newLead.closer) ||
            checkField(newLead.handler) ||
            checkField(meeting.meeting_manager) ||
            checkField(meeting.expert) ||
            checkField(meeting.helper)
          );
        }

        // Fallback: check meeting-level fields
        if (employeeId) {
          return (
            meeting.meeting_manager?.toString() === employeeId.toString() ||
            meeting.expert?.toString() === employeeId.toString() ||
            meeting.helper?.toString() === employeeId.toString()
          );
        }

        // Fallback: check by display name
        if (userDisplayName) {
          return (
            meeting.meeting_manager?.trim() === userDisplayName.trim() ||
            meeting.expert?.trim() === userDisplayName.trim() ||
            meeting.helper?.trim() === userDisplayName.trim()
          );
        }

        return false;
      };

      // Filter meetings and collect dates
      meetings.forEach((meeting: any) => {
        if (userMatchesRole(meeting) && meeting.meeting_date) {
          meetingDatesSet.add(meeting.meeting_date);
        }
      });

      setMeetingDates(meetingDatesSet);
    } catch (error) {
      console.error('Error fetching user meetings:', error);
    }
  };

  // Fetch meetings for a specific date
  const fetchMeetingsForDate = async (date: Date, userDisplayName: string, employeeId?: number) => {
    try {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const dateString = `${year}-${month}-${day}`;

      // Fetch all meetings for this date
      const { data: meetings, error } = await supabase
        .from('meetings')
        .select(`
          id,
          meeting_date,
          meeting_time,
          meeting_manager,
          helper,
          lead:leads!client_id(
            id, name, lead_number
          ),
          legacy_lead:leads_lead!legacy_lead_id(
            id, name
          )
        `)
        .eq('meeting_date', dateString)
        .or('status.is.null,status.neq.canceled')
        .order('meeting_time', { ascending: true });

      if (error) {
        console.error('Error fetching meetings for date:', error);
        return [];
      }

      if (!meetings || meetings.length === 0) {
        return [];
      }

      // Helper function to get user's role for a meeting
      const getUserRole = (meeting: any): string => {
        if (!employeeId && !userDisplayName) return '';

        const checkField = (field: any): boolean => {
          if (!field) return false;
          if (!isNaN(Number(field))) {
            return Number(field) === employeeId;
          }
          if (typeof field === 'string' && userDisplayName) {
            return field.trim() === userDisplayName.trim();
          }
          return false;
        };

        // Check legacy lead roles
        if (meeting.legacy_lead) {
          const legacyLead = meeting.legacy_lead;
          if (legacyLead.meeting_scheduler_id && Number(legacyLead.meeting_scheduler_id) === employeeId) return 'Scheduler';
          if (legacyLead.meeting_manager_id && Number(legacyLead.meeting_manager_id) === employeeId) return 'Manager';
          if (legacyLead.meeting_lawyer_id && Number(legacyLead.meeting_lawyer_id) === employeeId) return 'Lawyer';
          if (legacyLead.expert_id && Number(legacyLead.expert_id) === employeeId) return 'Expert';
          if (legacyLead.closer_id && Number(legacyLead.closer_id) === employeeId) return 'Closer';
          if (legacyLead.case_handler_id && Number(legacyLead.case_handler_id) === employeeId) return 'Handler';
        }

        // Check new lead roles and meeting-level roles
        if (meeting.lead || meeting.meeting_manager || meeting.helper) {
          const newLead = meeting.lead;
          if (checkField(newLead?.scheduler)) return 'Scheduler';
          if (checkField(newLead?.manager)) return 'Manager';
          if (checkField(newLead?.helper)) return 'Helper';
          if (checkField(newLead?.expert)) return 'Expert';
          if (checkField(newLead?.closer)) return 'Closer';
          if (checkField(newLead?.handler)) return 'Handler';
          if (checkField(meeting.meeting_manager)) return 'Meeting Manager';
          if (checkField(meeting.helper)) return 'Meeting Helper';
        }
        return '';
      };

      // Helper function to check if user matches any role
      const userMatchesRole = (meeting: any): boolean => {
        return getUserRole(meeting) !== '';
      };

      // Helper function to format time (remove seconds)
      const formatTime = (time: string): string => {
        if (!time) return '';
        // If time includes seconds (HH:MM:SS), remove them
        if (time.length === 8 && time.includes(':')) {
          return time.substring(0, 5); // Return HH:MM
        }
        return time; // Already in HH:MM format or invalid
      };

      // Filter meetings by user role and format for display
      const userMeetings = meetings
        .filter(userMatchesRole)
        .map((meeting: any) => ({
          id: meeting.id,
          time: formatTime(meeting.meeting_time || ''),
          leadNumber: meeting.lead?.lead_number || meeting.legacy_lead?.id?.toString() || '',
          clientName: meeting.lead?.name || meeting.legacy_lead?.name || 'Unknown',
          role: getUserRole(meeting)
        }));

      return userMeetings;
    } catch (error) {
      console.error('Error fetching meetings for date:', error);
      return [];
    }
  };

  // Upload document to storage
  const uploadDocument = async (file: File): Promise<string | null> => {
    if (!currentEmployeeId) {
      toast.error('Employee ID not found');
      return null;
    }

    setUploadingDocument(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `employee_${currentEmployeeId}_${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;

      const { data, error } = await supabase.storage
        .from('employee-unavailability-documents')
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: false,
          contentType: file.type
        });

      if (error) {
        console.error('Error uploading document:', error);
        toast.error('Failed to upload document');
        return null;
      }

      // Return the file path (not public URL since bucket is private)
      // We'll generate signed URLs when viewing
      return fileName;
    } catch (error) {
      console.error('Error uploading document:', error);
      toast.error('Failed to upload document');
      return null;
    } finally {
      setUploadingDocument(false);
    }
  };

  // Helper function to convert time string to minutes
  const timeToMinutes = (timeStr: string): number => {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
  };

  // Helper function to check if two time ranges overlap
  const timeRangesOverlap = (start1: string, end1: string, start2: string, end2: string): boolean => {
    const start1Min = timeToMinutes(start1);
    const end1Min = timeToMinutes(end1);
    const start2Min = timeToMinutes(start2);
    const end2Min = timeToMinutes(end2);

    // Check if ranges overlap (not just touching)
    return (start1Min < end2Min && end1Min > start2Min);
  };

  // Helper to normalize time (remove seconds if present)
  const normalizeTime = (timeStr: string): string => {
    if (!timeStr) return '';
    // If time has seconds (HH:MM:SS), remove them
    if (timeStr.includes(':') && timeStr.split(':').length === 3) {
      return timeStr.substring(0, 5); // Keep only HH:MM
    }
    return timeStr;
  };

  // Fetch existing unavailabilities for a specific date
  const fetchExistingUnavailabilitiesForDate = async (date: Date) => {
    if (!currentEmployeeId) return [];

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const dateString = `${year}-${month}-${day}`;

    try {
      // Fetch from employee_unavailability_reasons table
      // Get all records for this employee, we'll filter by date in code
      const { data: reasonsData, error: reasonsError } = await supabase
        .from('employee_unavailability_reasons')
        .select('*')
        .eq('employee_id', currentEmployeeId);

      if (reasonsError) {
        console.error('Error fetching existing unavailabilities:', reasonsError);
        return [];
      }

      const existing: any[] = [];

      // Process reasons data
      if (reasonsData) {
        reasonsData.forEach((reason: any) => {
          const reasonStartDate = reason.start_date;
          const reasonEndDate = reason.end_date || reasonStartDate;

          // Check if the selected date falls within this unavailability
          if (dateString >= reasonStartDate && dateString <= reasonEndDate) {
            let reasonText = '';
            if (reason.unavailability_type === 'sick_days') {
              reasonText = reason.sick_days_reason || '';
            } else if (reason.unavailability_type === 'vacation') {
              reasonText = reason.vacation_reason || '';
            } else {
              reasonText = reason.general_reason || '';
            }

            if (reason.start_time && reason.end_time) {
              existing.push({
                id: `reason-${reason.id}`,
                date: dateString,
                startDate: reasonStartDate,
                endDate: reasonEndDate,
                startTime: reason.start_time,
                endTime: reason.end_time,
                reason: reasonText,
                type: reason.unavailability_type,
                source: 'reasons_table',
                documentUrl: reason.document_url,
              });
            } else {
              // All day range
              existing.push({
                id: `reason-${reason.id}`,
                date: dateString,
                startDate: reasonStartDate,
                endDate: reasonEndDate,
                startTime: null,
                endTime: null,
                reason: reasonText,
                type: reason.unavailability_type,
                source: 'reasons_table',
                isAllDay: true,
                documentUrl: reason.document_url,
              });
            }
          }
        });
      }

      // Also fetch from legacy unavailable_times, but only if not already in the new table
      // Create a set of keys from the new table to check for duplicates
      const existingKeys = new Set<string>();
      existing.forEach((ex: any) => {
        if (ex.isAllDay) {
          existingKeys.add(`all-day-${ex.date}`);
        } else {
          const normalizedStart = normalizeTime(ex.startTime || '');
          const normalizedEnd = normalizeTime(ex.endTime || '');
          existingKeys.add(`${ex.date}-${normalizedStart}-${normalizedEnd}`);
        }
      });

      // Only add legacy entries that don't match existing entries
      const dayUnavailableTimes = unavailableTimes.filter(ut => ut.date === dateString);
      dayUnavailableTimes.forEach((time: UnavailableTime) => {
        const normalizedStart = normalizeTime(time.startTime);
        const normalizedEnd = normalizeTime(time.endTime);
        const key = `${time.date}-${normalizedStart}-${normalizedEnd}`;
        // Only add if not already in the new table
        if (!existingKeys.has(key)) {
          existing.push({
            id: `time-${time.id}`,
            date: time.date,
            startTime: time.startTime,
            endTime: time.endTime,
            reason: time.reason,
            type: 'general',
            source: 'legacy_times'
          });
        }
      });

      return existing;
    } catch (error) {
      console.error('Error fetching existing unavailabilities:', error);
      return [];
    }
  };

  // Save unavailable time
  const saveUnavailableTime = async () => {
    if (!selectedDate || !newUnavailableTime.reason.trim()) {
      toast.error('Please select a date and provide a reason');
      return;
    }

    if (!currentEmployeeId) {
      toast.error('Employee ID not found');
      return;
    }

    const year = selectedDate.getFullYear();
    const month = String(selectedDate.getMonth() + 1).padStart(2, '0');
    const day = String(selectedDate.getDate()).padStart(2, '0');
    const dateString = `${year}-${month}-${day}`;

    // Validate start time is before end time
    if (newUnavailableTime.startTime >= newUnavailableTime.endTime) {
      toast.error('Start time must be before end time');
      return;
    }

    await runWithHolidayCheck([dateString], async () => {
    setLoading(true);
    try {
      // Fetch existing unavailabilities for this date
      const existing = await fetchExistingUnavailabilitiesForDate(selectedDate);

      // Check for exact duplicates (same date, same time)
      const exactDuplicate = existing.find((ex: any) => {
        if (ex.id === editingUnavailability?.id) return false;
        if (ex.isAllDay) return false; // All day entries don't conflict with time-based entries
        return ex.startTime === newUnavailableTime.startTime &&
          ex.endTime === newUnavailableTime.endTime;
      });

      if (exactDuplicate) {
        toast.error('You already have an unavailability with the same time on this date');
        setLoading(false);
        return;
      }

      // Check for overlapping times (excluding all-day entries)
      const overlapping = existing.find((ex: any) => {
        if (ex.id === editingUnavailability?.id) return false;
        if (ex.isAllDay) return true; // All day entries conflict with any time-based entry
        if (!ex.startTime || !ex.endTime) return false;
        return timeRangesOverlap(
          newUnavailableTime.startTime,
          newUnavailableTime.endTime,
          ex.startTime,
          ex.endTime
        );
      });

      if (overlapping) {
        const overlapTime = overlapping.isAllDay
          ? 'All Day'
          : `${overlapping.startTime} - ${overlapping.endTime}`;
        toast.error(`This time overlaps with an existing unavailability (${overlapTime})`);
        setLoading(false);
        return;
      }

      // For sick_days and vacation, check if there's already an entry for this date and type
      // For general, allow multiple entries on the same day (but not duplicates/overlaps)
      if (newUnavailableTime.unavailabilityType !== 'general') {
        const typeConflict = existing.find((ex: any) =>
          ex.id !== editingUnavailability?.id &&
          ex.type === newUnavailableTime.unavailabilityType && ex.isAllDay
        );

        if (typeConflict) {
          toast.error(`You already have a ${newUnavailableTime.unavailabilityType === 'sick_days' ? 'sick day' : 'vacation'} entry for this date`);
          setLoading(false);
          return;
        }
      }

      // Upload document if it's a sick day and document is provided
      let documentUrl: string | null = null;
      if (newUnavailableTime.unavailabilityType === 'sick_days' && newUnavailableTime.documentFile) {
        documentUrl = await uploadDocument(newUnavailableTime.documentFile);
        if (!documentUrl) {
          setLoading(false);
          return;
        }
      }

      // Prepare reason data based on type (pending management approval)
      const reasonData: any = {
        employee_id: currentEmployeeId,
        unavailability_type: newUnavailableTime.unavailabilityType,
        start_date: dateString,
        end_date: editingUnavailability?.endDate || null,
        start_time: editingUnavailability?.isAllDay ? null : newUnavailableTime.startTime,
        end_time: editingUnavailability?.isAllDay ? null : newUnavailableTime.endTime,
        sick_days_reason: null,
        vacation_reason: null,
        general_reason: null,
        ...approvalFieldsForUnavailabilityType(newUnavailableTime.unavailabilityType),
      };

      if (newUnavailableTime.unavailabilityType === 'sick_days') {
        reasonData.sick_days_reason = newUnavailableTime.reason;
        if (documentUrl) {
          reasonData.document_url = documentUrl;
        }
      } else if (newUnavailableTime.unavailabilityType === 'vacation') {
        reasonData.vacation_reason = newUnavailableTime.reason;
      } else {
        reasonData.general_reason = newUnavailableTime.reason;
      }

      // Save to new table, or update the selected existing record.
      const reasonId = editingUnavailability?.id?.replace('reason-', '');
      const reasonQuery = supabase.from('employee_unavailability_reasons');
      const { error: reasonError } = reasonId
        ? await reasonQuery.update(reasonData).eq('id', reasonId)
        : await reasonQuery.insert(reasonData);

      if (reasonError) {
        console.error('Error saving unavailability reason:', reasonError);
        toast.error('Failed to save unavailability reason');
        setLoading(false);
        return;
      }

      // Create Outlook event if enabled (using the new data structure)
      if (outlookSyncEnabled && !editingUnavailability) {
        try {
          const newTime: UnavailableTime = {
            id: Date.now().toString(),
            date: dateString,
            startTime: newUnavailableTime.startTime,
            endTime: newUnavailableTime.endTime,
            reason: newUnavailableTime.reason
          };
          const outlookEventId = await createOutlookEvent(newTime);
          // Note: Outlook event ID is not stored in the new table structure
        } catch (error) {
          console.error('Error creating Outlook event:', error);
        }
      }

      toast.success(
        editingUnavailability
          ? 'Unavailability updated successfully'
          : 'Request saved — waiting for management approval',
      );
      setShowAddModal(false);
      setEditingUnavailability(null);
      setNewUnavailableTime({ startTime: '09:00', endTime: '17:00', reason: '', unavailabilityType: 'general', documentFile: null });
      setExistingUnavailabilities([]);

      // Refresh unavailable times
      await fetchUnavailableTimes();

      // Trigger refresh of team availability
      if (onAvailabilityChange) {
        onAvailabilityChange();
      }
    } catch (error) {
      console.error('Error saving unavailable time:', error);
      toast.error('Failed to save unavailable time');
    } finally {
      setLoading(false);
    }
    });
  };

  // Create Outlook event
  const createOutlookEvent = async (unavailableTime: UnavailableTime): Promise<string> => {
    const account = instance.getActiveAccount();
    if (!account) {
      throw new Error('No active account');
    }

    const accessToken = await instance.acquireTokenSilent({
      scopes: ['https://graph.microsoft.com/calendars.readwrite'],
      account: account
    });

    const [year, month, day] = unavailableTime.date.split('-').map(Number);
    const startDateTime = new Date(year, month - 1, day,
      parseInt(unavailableTime.startTime.split(':')[0]),
      parseInt(unavailableTime.startTime.split(':')[1]), 0);
    const endDateTime = new Date(year, month - 1, day,
      parseInt(unavailableTime.endTime.split(':')[0]),
      parseInt(unavailableTime.endTime.split(':')[1]), 0);

    const event = {
      subject: `Unavailable - ${unavailableTime.reason}`,
      body: {
        contentType: 'text',
        content: `Marked as unavailable: ${unavailableTime.reason}`
      },
      start: {
        dateTime: startDateTime.toISOString(),
        timeZone: 'UTC'
      },
      end: {
        dateTime: endDateTime.toISOString(),
        timeZone: 'UTC'
      },
      isAllDay: false,
      showAs: 'busy'
    };

    const response = await fetch('https://graph.microsoft.com/v1.0/me/events', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(event)
    });

    if (!response.ok) {
      throw new Error('Failed to create Outlook event');
    }

    const eventData = await response.json();
    return eventData.id;
  };

  // Delete unavailable time (from new table only)
  const deleteUnavailableTime = async (timeId: string) => {
    // Check if it's from the new table (starts with "reason-")
    if (timeId.startsWith('reason-')) {
      const reasonId = timeId.replace('reason-', '');
      setLoading(true);
      try {
        const { error } = await supabase
          .from('employee_unavailability_reasons')
          .delete()
          .eq('id', reasonId);

        if (error) {
          console.error('Error deleting unavailability reason:', error);
          toast.error('Failed to delete unavailability');
          return;
        }

        toast.success('Unavailable time deleted successfully');

        await fetchUnavailableTimes();
        if (selectedDate) {
          const refreshed = await fetchExistingUnavailabilitiesForDate(selectedDate);
          setExistingUnavailabilities(refreshed);
        }

        // Trigger refresh of team availability
        if (onAvailabilityChange) {
          onAvailabilityChange();
        }
      } catch (error) {
        console.error('Error deleting unavailable time:', error);
        toast.error('Failed to delete unavailable time');
      } finally {
        setLoading(false);
      }
    } else {
      // Legacy entry - just show a message that it can't be deleted from here
      toast.error('Legacy unavailability entries cannot be deleted from this interface');
    }
  };

  // Delete Outlook event
  const deleteOutlookEvent = async (eventId: string) => {
    const account = instance.getActiveAccount();
    if (!account) return;

    const accessToken = await instance.acquireTokenSilent({
      scopes: ['https://graph.microsoft.com/calendars.readwrite'],
      account: account
    });

    const response = await fetch(`https://graph.microsoft.com/v1.0/me/events/${eventId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${accessToken.accessToken}`
      }
    });

    if (!response.ok) {
      throw new Error('Failed to delete Outlook event');
    }
  };

  // Save unavailable range
  const saveUnavailableRange = async () => {
    if (!newUnavailableRange.startDate || !newUnavailableRange.endDate || !newUnavailableRange.reason.trim()) {
      toast.error('Please fill in all fields');
      return;
    }

    if (!currentEmployeeId) {
      toast.error('Employee ID not found');
      return;
    }

    if (new Date(newUnavailableRange.startDate) > new Date(newUnavailableRange.endDate)) {
      toast.error('Start date must be before end date');
      return;
    }

    await runWithHolidayCheck(
      eachDayInRange(newUnavailableRange.startDate, newUnavailableRange.endDate),
      async () => {
    setLoading(true);
    try {
      // Upload document if it's a sick day and document is provided
      let documentUrl: string | null = null;
      if (newUnavailableRange.unavailabilityType === 'sick_days' && newUnavailableRange.documentFile) {
        documentUrl = await uploadDocument(newUnavailableRange.documentFile);
        if (!documentUrl) {
          setLoading(false);
          return;
        }
      }

      // Prepare reason data based on type (pending management approval)
      const reasonData: any = {
        employee_id: currentEmployeeId,
        unavailability_type: newUnavailableRange.unavailabilityType,
        start_date: newUnavailableRange.startDate,
        end_date: newUnavailableRange.endDate,
        ...approvalFieldsForUnavailabilityType(newUnavailableRange.unavailabilityType),
      };

      if (newUnavailableRange.unavailabilityType === 'sick_days') {
        reasonData.sick_days_reason = newUnavailableRange.reason;
        if (documentUrl) {
          reasonData.document_url = documentUrl;
        }
      } else if (newUnavailableRange.unavailabilityType === 'vacation') {
        reasonData.vacation_reason = newUnavailableRange.reason;
      } else {
        reasonData.general_reason = newUnavailableRange.reason;
      }

      // Save to new table
      const { error: reasonError } = await supabase
        .from('employee_unavailability_reasons')
        .insert(reasonData);

      if (reasonError) {
        console.error('Error saving unavailability reason:', reasonError);
        toast.error('Failed to save unavailability reason');
        setLoading(false);
        return;
      }

      // Create Outlook event if enabled
      if (outlookSyncEnabled) {
        try {
          const newRange: UnavailableRange = {
            id: Date.now().toString(),
            startDate: newUnavailableRange.startDate,
            endDate: newUnavailableRange.endDate,
            reason: newUnavailableRange.reason
          };
          await createOutlookRangeEvent(newRange);
        } catch (error) {
          console.error('Error creating Outlook event:', error);
        }
      }

      toast.success('Request saved — waiting for management approval');
      setShowAddRangeModal(false);
      setNewUnavailableRange({ startDate: '', endDate: '', reason: '', unavailabilityType: 'general', documentFile: null });
      setRangeMeetings(new Map());

      await fetchUnavailableTimes();

      // Trigger refresh of team availability
      if (onAvailabilityChange) {
        onAvailabilityChange();
      }
    } catch (error) {
      console.error('Error saving unavailable range:', error);
      toast.error('Failed to save unavailable range');
    } finally {
      setLoading(false);
    }
    });
  };

  // Create Outlook event for range
  const createOutlookRangeEvent = async (range: UnavailableRange): Promise<string> => {
    const account = instance.getActiveAccount();
    if (!account) {
      throw new Error('No active account');
    }

    const accessToken = await instance.acquireTokenSilent({
      scopes: ['https://graph.microsoft.com/calendars.readwrite'],
      account: account
    });

    const [startYear, startMonth, startDay] = range.startDate.split('-').map(Number);
    const [endYear, endMonth, endDay] = range.endDate.split('-').map(Number);

    const startDateTime = new Date(startYear, startMonth - 1, startDay, 0, 0, 0, 0);
    const endDateTime = new Date(endYear, endMonth - 1, endDay, 23, 59, 59, 999);

    const event = {
      subject: `Unavailable - ${range.reason}`,
      body: {
        contentType: 'text',
        content: `Marked as unavailable: ${range.reason}`
      },
      start: {
        dateTime: startDateTime.toISOString(),
        timeZone: 'UTC'
      },
      end: {
        dateTime: endDateTime.toISOString(),
        timeZone: 'UTC'
      },
      isAllDay: false,
      showAs: 'busy'
    };

    const response = await fetch('https://graph.microsoft.com/v1.0/me/events', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(event)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Outlook API error:', response.status, errorText);
      throw new Error(`Failed to create Outlook event: ${response.status} - ${errorText}`);
    }

    const eventData = await response.json();
    return eventData.id;
  };

  // Delete unavailable range (from new table only)
  const deleteUnavailableRange = async (rangeId: string) => {
    // Check if it's from the new table (starts with "reason-")
    if (rangeId.startsWith('reason-')) {
      const reasonId = rangeId.replace('reason-', '');
      setLoading(true);
      try {
        const { error } = await supabase
          .from('employee_unavailability_reasons')
          .delete()
          .eq('id', reasonId);

        if (error) {
          console.error('Error deleting unavailability reason:', error);
          toast.error('Failed to delete unavailability');
          return;
        }

        toast.success('Unavailable range deleted successfully');

        // Refresh unavailable times
        await fetchUnavailableTimes();

        // Trigger refresh of team availability
        if (onAvailabilityChange) {
          onAvailabilityChange();
        }
      } catch (error) {
        console.error('Error deleting unavailable range:', error);
        toast.error('Failed to delete unavailable range');
      } finally {
        setLoading(false);
      }
    } else {
      // Legacy entry - just show a message that it can't be deleted from here
      toast.error('Legacy unavailability entries cannot be deleted from this interface');
    }
  };

  useImperativeHandle(ref, () => ({
    openAddRangeModal: () => {
      setShowAddRangeModal(true);
    },
    openAddUnavailabilityModal: () => {
      void openDayModal(currentDate);
    },
    openAddSickDayForDate: (dateKey: string) => {
      const [year, month, day] = dateKey.split('-').map(Number);
      if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return;
      setNewUnavailableTime((current) => ({
        ...current,
        unavailabilityType: 'sick_days',
      }));
      void openDayModal(new Date(year, month - 1, day));
    },
    openDayForDate: (dateKey: string) => {
      const [y, m, d] = dateKey.split('-').map(Number);
      if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return;
      void openDayModal(new Date(y, m - 1, d));
    },
    goToPrevious: () => shiftView(-1),
    goToNext: () => shiftView(1),
    goToToday: () => {
      const today = new Date();
      goToMonth(today);
      setScrollToNowRequest((request) => request + 1);
    },
  }));

  useEffect(() => {
    void fetchUnavailableTimes();
  }, [currentMonth, currentYear, employeeIdProp]);

  const calendarDays = generateCalendarDays();
  const miniUnavailableDateKeys = new Set(
    calendarDays
      .filter(
        (day) =>
          day.isCurrentMonth
          && (day.unavailableTimes.length > 0 || day.isInUnavailableRange),
      )
      .map((day) => toLocalDateKey(day.date)),
  );

  /** Days the day and week views cover. Month view keeps using calendarDays. */
  const timeGridDays = useMemo(() => {
    const anchor = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());
    if (view === 'day') return [anchor];
    const weekStart = startOfWeek(anchor);
    return Array.from({ length: 7 }, (_, idx) => {
      const day = new Date(weekStart);
      day.setDate(weekStart.getDate() + idx);
      return day;
    });
  }, [currentDate, view]);

  const { timedByDate, allDayByDate } = useMemo(() => {
    const timed = new Map<string, TimedCalendarItem[]>();
    const allDay = new Map<string, AllDayCalendarItem[]>();
    const pushTimed = (dateKey: string, item: TimedCalendarItem) => {
      const list = timed.get(dateKey);
      if (list) list.push(item);
      else timed.set(dateKey, [item]);
    };
    const pushAllDay = (dateKey: string, item: AllDayCalendarItem) => {
      const list = allDay.get(dateKey);
      if (list) list.push(item);
      else allDay.set(dateKey, [item]);
    };

    for (const day of timeGridDays) {
      const dateKey = toLocalDateKey(day);

      for (const holiday of yearHolidayMap.get(dateKey) ?? []) {
        pushAllDay(dateKey, {
          key: `holiday-${holiday}`,
          label: holiday,
          className: 'bg-violet-100 text-violet-800',
        });
      }

      const workedMs = workedMsByDate?.get(dateKey) ?? 0;
      if (workedMs > 0) {
        pushAllDay(dateKey, {
          key: 'worked',
          label: `${compactHoursLabel(workedMs)} worked`,
          className: 'bg-emerald-100 text-emerald-800',
        });
      }

      reasonUnavailabilities.forEach((reason, idx) => {
        const end = reason.end_date || reason.start_date;
        if (dateKey < reason.start_date || dateKey > end) return;

        const label = unavailabilityTypeShortLabel(reason.unavailability_type);
        const tone = unavailabilityTypeCompactLabelClass(reason.unavailability_type);
        const startHour = hoursFromTimeString(reason.start_time);
        const endHour = hoursFromTimeString(reason.end_time);

        // A single-day entry with both times gets a positioned block; a multi-day range or
        // one without times is an all-day entry.
        if (startHour != null && endHour != null && endHour > startHour && reason.start_date === end) {
          pushTimed(dateKey, {
            key: `reason-${idx}`,
            startHour,
            endHour,
            label: `${label} · ${normalizeTime(reason.start_time || '')}–${normalizeTime(reason.end_time || '')}`,
            className: tone,
            unavailabilityType: reason.unavailability_type,
          });
        } else {
          pushAllDay(dateKey, {
            key: `reason-${idx}`,
            label,
            className: tone,
            unavailabilityType: reason.unavailability_type,
          });
        }
      });

      for (const entry of unavailableTimes) {
        if (entry.date !== dateKey) continue;
        const startHour = hoursFromTimeString(entry.startTime);
        const endHour = hoursFromTimeString(entry.endTime);
        if (startHour == null || endHour == null || endHour <= startHour) continue;
        pushTimed(dateKey, {
          key: `time-${entry.id}`,
          startHour,
          endHour,
          label: entry.reason?.trim() || 'Unavailable',
          className: 'bg-red-100 text-red-700',
        });
      }
    }

    for (const list of timed.values()) list.sort((a, b) => a.startHour - b.startHour);
    return { timedByDate: timed, allDayByDate: allDay };
  }, [timeGridDays, yearHolidayMap, workedMsByDate, reasonUnavailabilities, unavailableTimes]);

  /** Day and week views step by day or week; month view still steps by month. */
  const shiftView = (direction: 1 | -1) => {
    if (view === 'month') {
      goToMonth(new Date(currentYear, currentMonth + direction, 1));
      return;
    }
    const next = new Date(currentDate);
    next.setDate(next.getDate() + direction * (view === 'day' ? 1 : 7));
    goToMonth(next);
  };

  const viewRangeLabel = (() => {
    if (view === 'month') return `${monthNames[currentMonth]} ${currentYear}`;
    if (view === 'day') {
      return currentDate.toLocaleDateString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
    }
    const first = timeGridDays[0];
    const last = timeGridDays[timeGridDays.length - 1];
    const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
    return `${first.toLocaleDateString('en-GB', opts)} – ${last.toLocaleDateString('en-GB', opts)}, ${last.getFullYear()}`;
  })();

  useEffect(() => {
    onRangeLabelChange?.(viewRangeLabel);
  }, [viewRangeLabel, onRangeLabelChange]);
  const openDayModal = async (date: Date) => {
    setSelectedDate(date);
    setShowAddModal(true);

    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const holidays = await getHolidayNamesForDate(`${y}-${m}-${d}`);
    setSelectedDateHolidays(holidays);

    if (currentEmployeeId) {
      const existing = await fetchExistingUnavailabilitiesForDate(date);
      setExistingUnavailabilities(existing);
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (user?.id) {
      const { data: userData } = await supabase
        .from('users')
        .select('full_name')
        .eq('auth_id', user.id)
        .maybeSingle();

      const { data: employeeData } = await supabase
        .from('tenants_employee')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();

      const meetings = await fetchMeetingsForDate(
        date,
        userData?.full_name || '',
        employeeData?.id,
      );
      setSelectedDateMeetings(meetings);
    }
  };

  return (
    <div
      className={
        desktopPageLayout
          ? 'w-full md:flex md:h-full md:items-stretch md:gap-4 md:bg-gray-50 md:p-4'
          : 'w-full'
      }
    >
      <style>{`
        @keyframes availability-drawer-in {
          from { transform: translateX(100%); opacity: 0.75; }
          to { transform: translateX(0); opacity: 1; }
        }
        .availability-drawer {
          animation: availability-drawer-in 220ms ease-out;
        }
        @media (prefers-reduced-motion: reduce) {
          .availability-drawer { animation: none; }
        }
      `}</style>
      {desktopPageLayout && (
        <aside className="hidden md:block md:w-60 md:shrink-0 md:self-start">
          <details className="dropdown mb-3 w-full">
            <summary className="btn btn-primary h-11 min-h-11 rounded-full px-6 gap-2 text-base">
              <PlusIcon className="h-5 w-5" />
              Create
            </summary>
            <ul className="menu dropdown-content z-30 mt-2 w-52 rounded-xl bg-white p-2 shadow-xl ring-1 ring-black/5">
              <li>
                <button
                  type="button"
                  onClick={(event) => {
                    setShowAddRangeModal(true);
                    const details = event.currentTarget.closest('details');
                    if (details) details.open = false;
                  }}
                >
                  Add range
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={(event) => {
                    void openDayModal(currentDate);
                    const details = event.currentTarget.closest('details');
                    if (details) details.open = false;
                  }}
                >
                  Add unavailability
                </button>
              </li>
              {onUploadSickDays && (
                <li>
                  <button
                    type="button"
                    onClick={(event) => {
                      onUploadSickDays();
                      const details = event.currentTarget.closest('details');
                      if (details) details.open = false;
                    }}
                  >
                    Upload sick-day document
                  </button>
                </li>
              )}
            </ul>
          </details>
          <MiniMonthCalendar
            year={currentYear}
            month={currentMonth}
            monthLabel={`${monthNames[currentMonth]} ${currentYear}`}
            unavailableDateKeys={miniUnavailableDateKeys}
            onPrevMonth={() => goToMonth(new Date(currentYear, currentMonth - 1, 1))}
            onNextMonth={() => goToMonth(new Date(currentYear, currentMonth + 1, 1))}
            onSelectDate={(date) => {
              // The mini calendar navigates the main calendar and always opens that date
              // in Day view. Only the main calendar opens the unavailability popup.
              goToMonth(date);
              onViewChange?.('day');
            }}
          />
        </aside>
      )}

      <div
        className={
          desktopPageLayout
            ? 'md:flex md:min-h-0 md:min-w-0 md:flex-1 md:flex-col md:rounded-2xl md:bg-white md:p-4 md:shadow-sm'
            : undefined
        }
      >
      {/* Month Navigation — hidden on desktop page layout, where the host header owns it */}
      <div
        className={`flex items-center justify-between mb-3 ${
          desktopPageLayout ? 'md:hidden' : ''
        }`}
      >
        <button
          onClick={() => shiftView(-1)}
          className="btn btn-xs btn-ghost btn-circle"
          aria-label="Previous"
        >
          <ChevronLeftIcon className="w-4 h-4" />
        </button>
        <span className="text-sm font-semibold text-gray-700">
          <span className={desktopPageLayout ? 'hidden md:inline' : undefined}>
            {viewRangeLabel}
          </span>
          <span className={desktopPageLayout ? 'md:hidden' : 'hidden'}>
            {monthNames[currentMonth]} {currentYear}
          </span>
        </span>
        <button
          onClick={() => shiftView(1)}
          className="btn btn-xs btn-ghost btn-circle"
          aria-label="Next"
        >
          <ChevronRightIcon className="w-4 h-4" />
        </button>
      </div>

      {desktopPageLayout && view !== 'month' && (
        <div className="hidden md:flex md:min-h-0 md:flex-1 md:flex-col">
          <AvailabilityTimeGrid
            days={timeGridDays}
            timedByDate={timedByDate}
            allDayByDate={allDayByDate}
            scrollToNowRequest={scrollToNowRequest}
            unavailabilityModalOpen={showAddModal}
            onSelectDate={(date) => void openDayModal(date)}
            onSelectTimeRange={(date, startHour, endHour) => {
              setNewUnavailableTime((current) => ({
                ...current,
                startTime: hourValueToTime(startHour),
                endTime: hourValueToTime(endHour),
              }));
              void openDayModal(date);
            }}
          />
        </div>
      )}

      <div
        className={
          desktopPageLayout
            ? view === 'month'
              ? 'md:flex md:min-h-0 md:flex-1 md:flex-col md:overflow-hidden'
              : 'md:hidden'
            : undefined
        }
      >
      <div className={desktopPageLayout ? 'md:flex md:min-h-0 md:flex-1 md:flex-col' : undefined}>
      <div className={desktopPageLayout ? 'md:flex md:min-h-0 md:min-w-0 md:flex-1 md:flex-col' : undefined}>

      {/* Day Headers */}
      <div className="grid grid-cols-7 gap-1 md:gap-1.5 mb-1">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, idx) => (
          <div
            key={idx}
            className={`text-center text-xs md:text-sm font-medium py-1 ${
              idx === 5 || idx === 6 ? 'text-red-500' : 'text-gray-500'
            }`}
          >
            <span className="md:hidden">{day.charAt(0)}</span>
            <span className="hidden md:inline">{day}</span>
          </div>
        ))}
      </div>

      {/* Calendar Grid */}
      <div
        className={`grid grid-cols-7 gap-1 md:gap-1.5 ${
          desktopPageLayout ? 'md:min-h-0 md:flex-1 md:grid-rows-6' : ''
        }`}
      >
        {calendarDays.map((day, idx) => {
          if (!day.isCurrentMonth) {
            return (
              <div
                key={idx}
                className={`aspect-square ${
                  simplified ? '' : 'border border-gray-100'
                } ${desktopPageLayout ? 'md:aspect-auto' : ''}`}
              />
            );
          }

          const isUnavailable = day.unavailableTimes.length > 0 || day.isInUnavailableRange;
          const isWeekend = day.date.getDay() === 5 || day.date.getDay() === 6;
          const typeLabels = day.unavailabilityTypes.map((type) => unavailabilityTypeShortLabel(type));

          // Only show green if not unavailable (red takes precedence)
          const showGreen = day.hasMeeting && !isUnavailable;

          const dateKey = toLocalDateKey(day.date);
          const isPastDay = dateKey < toLocalDateKey(new Date());
          const workedMs = workedMsByDate?.get(dateKey) ?? 0;

          const titleParts: string[] = [];
          if (day.holidays.length > 0) titleParts.push(day.holidays.join(', '));
          if (typeLabels.length > 0) titleParts.push(typeLabels.join(', '));
          else if (isUnavailable) titleParts.push('Unavailable');
          if (showGreen) titleParts.push('Meeting');
          if (workedMs > 0) titleParts.push(`${compactHoursLabel(workedMs)} worked`);

          return (
            <button
              key={idx}
              onClick={() => void openDayModal(day.date)}
              className={`
                relative text-xs md:text-sm font-medium rounded md:rounded-lg border border-gray-100
                ${
                  simplified
                    ? 'aspect-square min-h-0'
                    : `min-h-[3.25rem] ${desktopPageLayout ? 'md:h-full md:min-h-0' : 'md:min-h-[5.5rem]'}`
                }
                transition-all cursor-pointer
                flex flex-col items-center justify-start overflow-hidden
                ${simplified ? 'gap-0 p-0.5 md:p-0.5' : 'gap-0.5 p-0.5 md:p-1.5'}
                ${isPastDay ? 'after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:bg-gray-300/25' : isWeekend ? 'bg-gray-100/80' : ''}
                ${day.isToday ? 'ring-2 ring-inset ring-primary bg-primary/10' : ''}
                ${showGreen && !isPastDay ? 'bg-green-100 text-green-700' : ''}
                ${isUnavailable ? 'text-gray-700' : ''}
                ${!isUnavailable && !showGreen ? 'text-gray-700 hover:bg-gray-200' : 'hover:opacity-90'}
              `}
              title={titleParts.join(' · ') || undefined}
            >
              <span
                className={`relative z-[1] flex items-center justify-center font-semibold leading-none md:text-base ${
                  day.isToday
                    ? simplified
                      ? 'h-7 min-w-7 rounded-full bg-violet-600 px-1.5 text-white'
                      : 'h-8 min-w-8 rounded-full bg-violet-600 px-2 text-white'
                    : isUnavailable
                      ? 'text-red-600'
                      : ''
                }`}
              >
                {day.date.getDate()}
              </span>
              {day.isToday && !simplified && (
                <span className="text-[10px] font-semibold uppercase tracking-wide text-violet-700">
                  Today
                </span>
              )}
              {workedMs > 0 && (
                <span className={`hidden md:inline-flex items-center gap-1.5 rounded-full bg-white/70 px-2 py-1 text-sm font-semibold leading-none text-gray-700 ${
                  isPastDay ? 'opacity-60 grayscale-[35%]' : ''
                }`}>
                  <ClockIcon className="h-3.5 w-3.5" />
                  {compactHoursLabel(workedMs)}
                </span>
              )}
              {(day.holidays.length > 0 || day.unavailabilityTypes.length > 0) && (
                <div
                  className={
                    simplified
                      ? `flex w-full min-h-4 items-center justify-center gap-1 px-0.5 ${
                          isPastDay ? 'opacity-60 grayscale-[35%]' : ''
                        }`
                      : `flex flex-col gap-px md:gap-0.5 w-full px-0.5 ${
                          isPastDay ? 'opacity-60 grayscale-[35%]' : ''
                        }`
                  }
                >
                  {day.holidays.slice(0, 1).map((holiday) => (
                    simplified ? (
                      <span
                        key={holiday}
                        className="mx-auto h-2 w-2 rounded-full bg-violet-500"
                        title={holiday}
                        aria-label={holiday}
                      />
                    ) : (
                      <span
                        key={holiday}
                        className="self-center inline-flex w-fit max-w-full items-center gap-1.5 text-[10px] md:text-[13px] leading-tight font-medium rounded px-2 py-1 bg-violet-100/90 text-violet-800"
                      >
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500" />
                        <span className="whitespace-normal break-words text-center">{holiday}</span>
                      </span>
                    )
                  ))}
                  {day.unavailabilityTypes.slice(0, 2).map((type) =>
                    simplified && (type === 'vacation' || type === 'sick_days') ? (
                      <span
                        key={type}
                        className="mx-auto inline-flex items-center gap-1"
                        title={unavailabilityTypeShortLabel(type)}
                        aria-label={unavailabilityTypeShortLabel(type)}
                      >
                        <UnavailabilityTypeIcon
                          type={type}
                          className={`h-5 w-5 ${
                            type === 'vacation' ? 'text-green-700' : 'text-orange-700'
                          }`}
                        />
                      </span>
                    ) : (
                      <span
                        key={type}
                        className={`inline-flex items-center justify-center gap-1.5 text-[10px] md:text-[13px] leading-tight font-medium rounded px-2 py-1 ${unavailabilityTypeCompactLabelClass(type)}`}
                      >
                        <UnavailabilityTypeIcon
                          type={type}
                          className={`h-5 w-5 shrink-0 ${
                            type === 'vacation'
                              ? 'text-green-700'
                              : type === 'sick_days'
                                ? 'text-orange-700'
                                : 'text-red-700'
                          }`}
                        />
                        <span className="truncate">{unavailabilityTypeShortLabel(type)}</span>
                      </span>
                    ),
                  )}
                  {day.unavailabilityTypes.length > 2 && (
                    <span className="text-[9px] md:text-xs leading-tight text-gray-600">+{day.unavailabilityTypes.length - 2}</span>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 mt-3 text-xs text-gray-600 flex-wrap">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-red-100"></div>
          <span>Unavailable</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-green-100"></div>
          <span>Meeting</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-violet-100 border border-violet-200"></div>
          <span>Holiday</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded ring-2 ring-primary bg-primary/10"></div>
          <span>Today</span>
        </div>
      </div>
      </div>
      </div>
      </div>

      {/* Add Unavailable Time Modal */}
      {showAddModal && selectedDate && (
        <div
          className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/20 backdrop-blur-[1px]"
          onClick={(event) => {
            if (event.target !== event.currentTarget) return;
            setShowAddModal(false);
            setSelectedDate(null);
            setEditingUnavailability(null);
            setNewUnavailableTime({
              startTime: '09:00',
              endTime: '17:00',
              reason: '',
              unavailabilityType: 'general',
              documentFile: null,
            });
            setSelectedDateMeetings([]);
            setExistingUnavailabilities([]);
          }}
        >
          <aside className="availability-drawer h-full w-full max-w-md overflow-y-auto border-l border-gray-200 bg-white shadow-2xl sm:rounded-l-3xl">
            <div className="sticky top-0 z-10 flex items-center justify-between bg-white/95 px-6 py-5 backdrop-blur">
              <h3 className="text-lg font-semibold">
                {editingUnavailability ? 'Edit Unavailability' : 'Add Unavailable Time'}
              </h3>
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setSelectedDate(null);
                  setEditingUnavailability(null);
                  setNewUnavailableTime({ startTime: '09:00', endTime: '17:00', reason: '', unavailabilityType: 'general', documentFile: null });
                  setSelectedDateMeetings([]);
                  setExistingUnavailabilities([]);
                }}
                className="btn btn-ghost btn-sm btn-circle"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 px-6 py-5 pb-8">
              {selectedDateHolidays.length > 0 && (
                <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-800">
                  <p className="font-medium">Jewish / Israeli holiday</p>
                  <p>{selectedDateHolidays.join(', ')}</p>
                </div>
              )}
              <div>
                <label className="label">
                  <span className="label-text">Date</span>
                </label>
                <input
                  type="date"
                  className="input input-bordered w-full"
                  value={toLocalDateKey(selectedDate)}
                  onChange={(event) => {
                    const [year, month, day] = event.target.value.split('-').map(Number);
                    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
                      return;
                    }
                    void openDayModal(new Date(year, month - 1, day));
                  }}
                />
              </div>

              {/* Existing Unavailabilities on this date */}
              {existingUnavailabilities.length > 0 && (
                <div className="overflow-hidden rounded-xl bg-gray-100">
                  <div className="px-4 pt-3 text-sm font-semibold text-gray-700">
                    Existing Unavailabilities on this day:
                  </div>
                  <div className="divide-y divide-gray-200">
                    {existingUnavailabilities.map((unav: any, idx: number) => (
                      <div
                        key={idx}
                        className={`flex w-full items-start justify-between gap-2 px-4 py-3 text-left transition-colors hover:bg-gray-200/70 ${
                          editingUnavailability?.id === unav.id ? 'bg-gray-200' : ''
                        }`}
                        role={unav.source === 'reasons_table' ? 'button' : undefined}
                        tabIndex={unav.source === 'reasons_table' ? 0 : undefined}
                        onClick={() => {
                          if (unav.source !== 'reasons_table') return;
                          setEditingUnavailability(unav);
                          setNewUnavailableTime({
                            startTime: normalizeTime(unav.startTime || '09:00'),
                            endTime: normalizeTime(unav.endTime || '17:00'),
                            reason: unav.reason || '',
                            unavailabilityType: unav.type || 'general',
                            documentFile: null,
                          });
                        }}
                        onKeyDown={(event) => {
                          if (unav.source !== 'reasons_table' || (event.key !== 'Enter' && event.key !== ' ')) return;
                          event.preventDefault();
                          event.currentTarget.click();
                        }}
                      >
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-gray-900">
                              {unav.isAllDay ? (
                                <span>All Day</span>
                              ) : (
                                <span>{normalizeTime(unav.startTime)} - {normalizeTime(unav.endTime)}</span>
                              )}
                            </div>
                            <div className="mt-1 text-xs text-gray-600">
                              {unav.reason}
                            </div>
                            <div className="mt-1">
                              <UnavailabilityTypeBadge type={unav.type} size="xs" />
                            </div>
                          </div>
                          {unav.source === 'reasons_table' && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs btn-circle text-error shrink-0"
                              title="Remove unavailability"
                              disabled={loading}
                              onClick={(event) => {
                                event.stopPropagation();
                                void deleteUnavailableTime(unav.id);
                              }}
                            >
                              <TrashIcon className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Meetings on this date */}
              {selectedDateMeetings.length > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                  <div className="text-sm font-semibold text-yellow-800 mb-2">
                    Meetings on this day:
                  </div>
                  <div className="space-y-2">
                    {selectedDateMeetings.map((meeting, idx) => (
                      <div key={idx} className="text-sm text-yellow-700">
                        <div className="font-medium">
                          {meeting.time && (
                            <span className="text-yellow-900">{meeting.time}</span>
                          )} {meeting.time && meeting.leadNumber && ' - '}
                          {meeting.leadNumber && (
                            <span className="text-yellow-900">Lead #{meeting.leadNumber}</span>
                          )} {meeting.leadNumber && meeting.clientName && ' - '}
                          {meeting.clientName && (
                            <span className="text-yellow-900">{meeting.clientName}</span>
                          )} {meeting.clientName && meeting.role && ' - '}
                          {meeting.role && (
                            <span className="text-yellow-800 italic">({meeting.role})</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!editingUnavailability?.isAllDay && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">
                    <span className="label-text">Start Time</span>
                  </label>
                  <input
                    type="time"
                    className="input input-bordered w-full"
                    value={newUnavailableTime.startTime}
                    onChange={(e) => setNewUnavailableTime({ ...newUnavailableTime, startTime: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">
                    <span className="label-text">End Time</span>
                  </label>
                  <input
                    type="time"
                    className="input input-bordered w-full"
                    value={newUnavailableTime.endTime}
                    onChange={(e) => setNewUnavailableTime({ ...newUnavailableTime, endTime: e.target.value })}
                  />
                </div>
              </div>
              )}

              <div>
                <label className="label">
                  <span className="label-text">Type</span>
                </label>
                <select
                  className="select select-bordered w-full"
                  value={newUnavailableTime.unavailabilityType}
                  onChange={(e) => setNewUnavailableTime({
                    ...newUnavailableTime,
                    unavailabilityType: e.target.value as 'sick_days' | 'vacation' | 'general',
                    documentFile: e.target.value !== 'sick_days' ? null : newUnavailableTime.documentFile
                  })}
                >
                  <option value="general">General</option>
                  <option value="sick_days">Sick day/s</option>
                  <option value="vacation">Vacation</option>
                </select>
              </div>

              <div>
                <label className="label">
                  <span className="label-text">Reason</span>
                </label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={newUnavailableTime.reason}
                  onChange={(e) => setNewUnavailableTime({ ...newUnavailableTime, reason: e.target.value })}
                  placeholder={newUnavailableTime.unavailabilityType === 'sick_days' ? 'e.g., Flu, Doctor appointment' : newUnavailableTime.unavailabilityType === 'vacation' ? 'e.g., Family vacation' : 'e.g., Personal appointment'}
                />
              </div>

              {/* Document Upload for Sick Days */}
              {newUnavailableTime.unavailabilityType === 'sick_days' && (
                <div>
                  <label className="label">
                    <span className="label-text">Doctors Documents</span>
                  </label>
                  <div
                    className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${newUnavailableTime.documentFile
                      ? 'border-primary bg-primary/5'
                      : 'border-gray-300 hover:border-primary/50'
                      }`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const file = e.dataTransfer.files[0];
                      if (file) {
                        const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
                        if (allowedTypes.includes(file.type)) {
                          if (file.size <= 10 * 1024 * 1024) { // 10MB
                            setNewUnavailableTime({ ...newUnavailableTime, documentFile: file });
                          } else {
                            toast.error('File size must be less than 10MB');
                          }
                        } else {
                          toast.error('Invalid file type. Please upload images or documents (PDF, Word)');
                        }
                      }
                    }}
                  >
                    {newUnavailableTime.documentFile ? (
                      <div className="space-y-2">
                        <DocumentArrowUpIcon className="w-8 h-8 mx-auto text-primary" />
                        <p className="text-sm font-medium text-gray-700">{newUnavailableTime.documentFile.name}</p>
                        <button
                          type="button"
                          className="btn btn-xs btn-ghost"
                          onClick={() => setNewUnavailableTime({ ...newUnavailableTime, documentFile: null })}
                        >
                          Remove
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <DocumentArrowUpIcon className="w-8 h-8 mx-auto text-gray-400" />
                        <p className="text-sm text-gray-600">
                          Drag and drop a document here, or{' '}
                          <label className="text-primary cursor-pointer hover:underline">
                            click to browse
                            <input
                              type="file"
                              className="hidden"
                              accept="image/*,.pdf,.doc,.docx"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
                                  if (allowedTypes.includes(file.type)) {
                                    if (file.size <= 10 * 1024 * 1024) { // 10MB
                                      setNewUnavailableTime({ ...newUnavailableTime, documentFile: file });
                                    } else {
                                      toast.error('File size must be less than 10MB');
                                    }
                                  } else {
                                    toast.error('Invalid file type. Please upload images or documents (PDF, Word)');
                                  }
                                }
                              }}
                            />
                          </label>
                        </p>
                        <p className="text-xs text-gray-500">PDF, Word, or Images (max 10MB)</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="sticky bottom-0 z-10 -mx-6 -mb-8 mt-6 flex justify-end gap-2 border-t border-gray-100 bg-white/95 px-6 pt-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))] backdrop-blur">
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    setShowAddModal(false);
                    setSelectedDate(null);
                    setEditingUnavailability(null);
                    setNewUnavailableTime({ startTime: '09:00', endTime: '17:00', reason: '', unavailabilityType: 'general', documentFile: null });
                    setSelectedDateMeetings([]);
                    setExistingUnavailabilities([]);
                  }}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary rounded-full px-6"
                  onClick={saveUnavailableTime}
                  disabled={loading || uploadingDocument}
                >
                  {loading || uploadingDocument
                    ? 'Saving...'
                    : editingUnavailability
                      ? 'Update'
                      : 'Save'}
                </button>
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* Add Unavailable Range Modal */}
      {showAddRangeModal && (
        <div
          className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/20 backdrop-blur-[1px]"
          onClick={(event) => {
            if (event.target !== event.currentTarget) return;
            setShowAddRangeModal(false);
            setNewUnavailableRange({
              startDate: '',
              endDate: '',
              reason: '',
              unavailabilityType: 'general',
              documentFile: null,
            });
            setRangeMeetings(new Map());
          }}
        >
          <aside className="availability-drawer h-full w-full max-w-md overflow-y-auto border-l border-gray-200 bg-white shadow-2xl sm:rounded-l-3xl">
            <div className="sticky top-0 z-10 flex items-center justify-between bg-white/95 px-6 py-5 backdrop-blur">
              <h3 className="text-lg font-semibold">Add Unavailable Range</h3>
              <button
                onClick={() => {
                  setShowAddRangeModal(false);
                  setNewUnavailableRange({ startDate: '', endDate: '', reason: '', unavailabilityType: 'general', documentFile: null });
                  setRangeMeetings(new Map());
                }}
                className="btn btn-ghost btn-sm btn-circle"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 px-6 py-5 pb-8">
              <div>
                <label className="label">
                  <span className="label-text">Start Date</span>
                </label>
                <input
                  type="date"
                  className="input input-bordered w-full"
                  value={newUnavailableRange.startDate}
                  onChange={async (e) => {
                    setNewUnavailableRange({ ...newUnavailableRange, startDate: e.target.value });

                    // Fetch meetings for the range when dates change
                    if (e.target.value && newUnavailableRange.endDate) {
                      const { data: { user } } = await supabase.auth.getUser();
                      if (user?.id) {
                        const { data: userData } = await supabase
                          .from('users')
                          .select('full_name')
                          .eq('auth_id', user.id)
                          .maybeSingle();

                        const { data: employeeData } = await supabase
                          .from('tenants_employee')
                          .select('id')
                          .eq('user_id', user.id)
                          .maybeSingle();

                        const meetingsMap = new Map<string, any[]>();
                        const startDate = new Date(e.target.value);
                        const endDate = new Date(newUnavailableRange.endDate);
                        const currentDate = new Date(startDate);

                        while (currentDate <= endDate) {
                          const meetings = await fetchMeetingsForDate(
                            new Date(currentDate),
                            userData?.full_name || '',
                            employeeData?.id
                          );
                          if (meetings.length > 0) {
                            const dateString = currentDate.toISOString().split('T')[0];
                            meetingsMap.set(dateString, meetings);
                          }
                          currentDate.setDate(currentDate.getDate() + 1);
                        }

                        setRangeMeetings(meetingsMap);
                      }
                    }
                  }}
                />
              </div>

              <div>
                <label className="label">
                  <span className="label-text">End Date</span>
                </label>
                <input
                  type="date"
                  className="input input-bordered w-full"
                  value={newUnavailableRange.endDate}
                  onChange={async (e) => {
                    setNewUnavailableRange({ ...newUnavailableRange, endDate: e.target.value });

                    // Fetch meetings for the range when dates change
                    if (newUnavailableRange.startDate && e.target.value) {
                      const { data: { user } } = await supabase.auth.getUser();
                      if (user?.id) {
                        const { data: userData } = await supabase
                          .from('users')
                          .select('full_name')
                          .eq('auth_id', user.id)
                          .maybeSingle();

                        const { data: employeeData } = await supabase
                          .from('tenants_employee')
                          .select('id')
                          .eq('user_id', user.id)
                          .maybeSingle();

                        const meetingsMap = new Map<string, any[]>();
                        const startDate = new Date(newUnavailableRange.startDate);
                        const endDate = new Date(e.target.value);
                        const currentDate = new Date(startDate);

                        while (currentDate <= endDate) {
                          const meetings = await fetchMeetingsForDate(
                            new Date(currentDate),
                            userData?.full_name || '',
                            employeeData?.id
                          );
                          if (meetings.length > 0) {
                            const dateString = currentDate.toISOString().split('T')[0];
                            meetingsMap.set(dateString, meetings);
                          }
                          currentDate.setDate(currentDate.getDate() + 1);
                        }

                        setRangeMeetings(meetingsMap);
                      }
                    }
                  }}
                />
              </div>

              {/* Meetings in this date range */}
              {rangeMeetings.size > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 max-h-48 overflow-y-auto">
                  <div className="text-sm font-semibold text-yellow-800 mb-2">
                    Meetings in this date range:
                  </div>
                  <div className="space-y-3">
                    {Array.from(rangeMeetings.entries()).map(([date, meetings]) => (
                      <div key={date}>
                        <div className="text-xs font-semibold text-yellow-700 mb-1">
                          {new Date(date).toLocaleDateString()}
                        </div>
                        <div className="space-y-1 ml-2">
                          {meetings.map((meeting, idx) => (
                            <div key={idx} className="text-sm text-yellow-700">
                              <div className="font-medium">
                                {meeting.time && (
                                  <span className="text-yellow-900">{meeting.time}</span>
                                )} {meeting.time && meeting.leadNumber && ' - '}
                                {meeting.leadNumber && (
                                  <span className="text-yellow-900">Lead #{meeting.leadNumber}</span>
                                )} {meeting.leadNumber && meeting.clientName && ' - '}
                                {meeting.clientName && (
                                  <span className="text-yellow-900">{meeting.clientName}</span>
                                )} {meeting.clientName && meeting.role && ' - '}
                                {meeting.role && (
                                  <span className="text-yellow-800 italic">({meeting.role})</span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="label">
                  <span className="label-text">Type</span>
                </label>
                <select
                  className="select select-bordered w-full"
                  value={newUnavailableRange.unavailabilityType}
                  onChange={(e) => setNewUnavailableRange({
                    ...newUnavailableRange,
                    unavailabilityType: e.target.value as 'sick_days' | 'vacation' | 'general',
                    documentFile: e.target.value !== 'sick_days' ? null : newUnavailableRange.documentFile
                  })}
                >
                  <option value="general">General</option>
                  <option value="sick_days">Sick day/s</option>
                  <option value="vacation">Vacation</option>
                </select>
              </div>

              <div>
                <label className="label">
                  <span className="label-text">Reason</span>
                </label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={newUnavailableRange.reason}
                  onChange={(e) => setNewUnavailableRange({ ...newUnavailableRange, reason: e.target.value })}
                  placeholder={newUnavailableRange.unavailabilityType === 'sick_days' ? 'e.g., Flu, Doctor appointment' : newUnavailableRange.unavailabilityType === 'vacation' ? 'e.g., Family vacation' : 'e.g., Personal appointment'}
                />
              </div>

              {/* Document Upload for Sick Days */}
              {newUnavailableRange.unavailabilityType === 'sick_days' && (
                <div>
                  <label className="label">
                    <span className="label-text">Doctors Documents</span>
                  </label>
                  <div
                    className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${newUnavailableRange.documentFile
                      ? 'border-primary bg-primary/5'
                      : 'border-gray-300 hover:border-primary/50'
                      }`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const file = e.dataTransfer.files[0];
                      if (file) {
                        const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
                        if (allowedTypes.includes(file.type)) {
                          if (file.size <= 10 * 1024 * 1024) { // 10MB
                            setNewUnavailableRange({ ...newUnavailableRange, documentFile: file });
                          } else {
                            toast.error('File size must be less than 10MB');
                          }
                        } else {
                          toast.error('Invalid file type. Please upload images or documents (PDF, Word)');
                        }
                      }
                    }}
                  >
                    {newUnavailableRange.documentFile ? (
                      <div className="space-y-2">
                        <DocumentArrowUpIcon className="w-8 h-8 mx-auto text-primary" />
                        <p className="text-sm font-medium text-gray-700">{newUnavailableRange.documentFile.name}</p>
                        <button
                          type="button"
                          className="btn btn-xs btn-ghost"
                          onClick={() => setNewUnavailableRange({ ...newUnavailableRange, documentFile: null })}
                        >
                          Remove
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <DocumentArrowUpIcon className="w-8 h-8 mx-auto text-gray-400" />
                        <p className="text-sm text-gray-600">
                          Drag and drop a document here, or{' '}
                          <label className="text-primary cursor-pointer hover:underline">
                            click to browse
                            <input
                              type="file"
                              className="hidden"
                              accept="image/*,.pdf,.doc,.docx"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
                                  if (allowedTypes.includes(file.type)) {
                                    if (file.size <= 10 * 1024 * 1024) { // 10MB
                                      setNewUnavailableRange({ ...newUnavailableRange, documentFile: file });
                                    } else {
                                      toast.error('File size must be less than 10MB');
                                    }
                                  } else {
                                    toast.error('Invalid file type. Please upload images or documents (PDF, Word)');
                                  }
                                }
                              }}
                            />
                          </label>
                        </p>
                        <p className="text-xs text-gray-500">PDF, Word, or Images (max 10MB)</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="sticky bottom-0 z-10 -mx-6 -mb-8 mt-6 flex justify-end gap-2 border-t border-gray-100 bg-white/95 px-6 pt-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))] backdrop-blur">
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    setShowAddRangeModal(false);
                    setNewUnavailableRange({ startDate: '', endDate: '', reason: '', unavailabilityType: 'general', documentFile: null });
                    setRangeMeetings(new Map());
                  }}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary rounded-full px-6"
                  onClick={saveUnavailableRange}
                  disabled={loading || uploadingDocument}
                >
                  {loading || uploadingDocument ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </aside>
        </div>
      )}

      <HolidayEntryWarningModal
        isOpen={holidayWarningOpen}
        warnings={holidayWarnings}
        onCancel={() => {
          pendingHolidaySaveRef.current = null;
          setHolidayWarningOpen(false);
          setHolidayWarnings([]);
        }}
        onContinue={() => void handleHolidayContinue()}
        continuing={loading || uploadingDocument}
      />
    </div>
  );
});

CompactAvailabilityCalendar.displayName = 'CompactAvailabilityCalendar';

export default CompactAvailabilityCalendar;

