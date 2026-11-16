import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDownIcon, PlusIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import {
  fetchActiveClockInLocations,
  fetchEmployeeWorksFromHome,
  isHomeClockInLocation,
  isRamatGanClockInLocation,
  persistLastSelectedWorkplaceId,
  readLastSelectedWorkplaceId,
  type ClockInLocationOption,
} from '../../lib/clockInLocations';
import { AUTO_FILL_START_HOUR } from '../../lib/autoFilledWorkingHours';
import { deleteClockInSessions, insertManualClockInRecord, updateClockInSession } from '../../lib/employeeClockInManual';
import {
  formatWorkingHoursDateLabel,
  formatWorkingHoursWeekdayLong,
  toDateInputValue,
} from '../../lib/employeeClockInFormat';
import { getHolidayWarningsForDates } from '../../lib/israeliJewishHolidays';
import type { HolidayDateWarning } from '../../lib/israeliJewishHolidays';
import {
  clockSessionDurationMinutes,
  DEFAULT_OVERTIME_APPROVAL_BASE_HOURS,
  fetchDayOvertimeApprovals,
  fetchOvertimeApprovalBaseHours,
  formatDurationMinutesLabel,
  type StoredOvertimeApproval,
} from '../../lib/employeeClockInOvertimeApproval';
import {
  formatOvertimeDatePlaceholder,
  formatOvertimeHoursPlaceholder,
  requestMichaelOvertimeApproval,
} from '../../lib/employeeClockInOvertimeWhatsApp';
import HolidayEntryWarningModal from './HolidayEntryWarningModal';
import ProfileBottomSheetModal from './ProfileBottomSheetModal';

type EntryMode = 'total' | 'range';

type OvertimeDayDraft = {
  dateKey: string;
  mode: EntryMode;
  hours: string;
  minutes: string;
  clockInTime: string;
  clockOutTime: string;
  reason: string;
  /** The employee edited From or To, so those times are no longer filled in for them. */
  rangeEdited?: boolean;
};

type ResolvedWindow =
  | {
      ok: true;
      clockIn: string;
      clockOut: string;
      minutes: number;
      placedAfterExisting: boolean;
      /** Existing session whose clock-out is extended by the extra hours. */
      extendSessionId?: number;
    }
  | { ok: false; message: string };

interface AddOvertimeModalProps {
  isOpen: boolean;
  employeeId: number;
  userId: string;
  /** When set, the drawer opens on this day instead of today. */
  initialDateKey?: string | null;
  onClose: () => void;
  onSaved: () => void;
}

function AutoGrowReason({
  value,
  placeholder,
  disabled,
  onChange,
}: {
  value: string;
  placeholder: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const field = ref.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${field.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      rows={2}
      className="mt-0.5 min-h-[44px] w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-sm text-gray-900 outline-none placeholder:text-gray-400"
      value={value}
      maxLength={500}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function newDraft(dateKey: string): OvertimeDayDraft {
  return {
    dateKey,
    mode: 'total',
    hours: '1',
    minutes: '0',
    clockInTime: '09:00',
    clockOutTime: '18:00',
    reason: '',
  };
}

function shiftDateKey(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return toDateInputValue(date);
}

function alreadyAddedDateMessage(dateKey: string): string {
  const label = `${formatWorkingHoursWeekdayLong(dateKey)} ${formatWorkingHoursDateLabel(dateKey)}`;
  return `${label} is already added. Choose another date.`;
}

function hhmmFromMinutes(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function clockMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0;
  return hours * 60 + minutes;
}

function latestFinishedSession(existing: StoredOvertimeApproval[]): StoredOvertimeApproval | null {
  let best: StoredOvertimeApproval | null = null;
  let bestEnd = -1;
  for (const row of existing) {
    if (!row.clockInTime || !row.clockOutTime) continue;
    const end = clockMinutes(row.clockOutTime);
    if (end > bestEnd) {
      best = row;
      bestEnd = end;
    }
  }
  return best;
}

function extraMinutesOf(day: OvertimeDayDraft): number {
  const hours = Number(day.hours);
  const minutesPart = Number(day.minutes);
  if (!Number.isFinite(hours) || !Number.isFinite(minutesPart) || hours < 0 || minutesPart < 0) return 0;
  return Math.round(hours) * 60 + Math.round(minutesPart);
}

/** From–to for the extra hours: the day's real shift, or 09:00 plus the base hours, then the extra. */
function suggestShift(
  extraMinutes: number,
  existing: StoredOvertimeApproval[],
  baseHours: number,
): { clockIn: string; clockOut: string; placedAfterExisting: boolean; extendSessionId?: number } | null {
  if (extraMinutes <= 0 || extraMinutes > 16 * 60) return null;
  const dayStart = AUTO_FILL_START_HOUR * 60;
  const baseMinutes = Math.round(baseHours * 60);
  const already = latestFinishedSession(existing);
  const start = already ? clockMinutes(already.clockInTime) : dayStart;
  const end = already
    ? clockMinutes(already.clockOutTime) + extraMinutes
    : dayStart + baseMinutes + extraMinutes;
  if (end > 24 * 60) return null;
  return {
    clockIn: hhmmFromMinutes(start),
    clockOut: hhmmFromMinutes(end),
    placedAfterExisting: already != null,
    extendSessionId: already?.sessionId,
  };
}

function resolveDayWindow(
  day: OvertimeDayDraft,
  existing: StoredOvertimeApproval[],
  baseHours: number,
): ResolvedWindow {
  const already = latestFinishedSession(existing);
  if (day.mode === 'range') {
    if (!day.clockInTime || !day.clockOutTime) {
      return { ok: false, message: 'Choose a from and to time' };
    }
    const span = clockSessionDurationMinutes(day.clockInTime, day.clockOutTime);
    if (span <= 0) return { ok: false, message: 'Clock out must be after clock in' };
    const extendsExisting = already != null
      && day.clockInTime === already.clockInTime
      && clockMinutes(day.clockOutTime) > clockMinutes(already.clockOutTime);
    const automaticStart = hhmmFromMinutes(AUTO_FILL_START_HOUR * 60);
    const automaticEnd = AUTO_FILL_START_HOUR * 60 + Math.round(baseHours * 60);
    const beyondAutomaticDay = !already
      && day.clockInTime === automaticStart
      && clockMinutes(day.clockOutTime) > automaticEnd;
    const extra = extendsExisting
      ? clockMinutes(day.clockOutTime) - clockMinutes(already.clockOutTime)
      : beyondAutomaticDay
        ? clockMinutes(day.clockOutTime) - automaticEnd
        : span;
    if (extra <= 0) return { ok: false, message: 'Add time after the hours already on this day' };
    return {
      ok: true,
      clockIn: day.clockInTime,
      clockOut: day.clockOutTime,
      minutes: extra,
      placedAfterExisting: extendsExisting,
      extendSessionId: extendsExisting ? already.sessionId : undefined,
    };
  }

  const minutes = extraMinutesOf(day);
  if (minutes <= 0) return { ok: false, message: 'Enter how many extra hours' };
  if (minutes > 16 * 60) return { ok: false, message: 'Extra hours cannot be more than 16h' };
  const suggested = suggestShift(minutes, existing, baseHours);
  if (!suggested) {
    return { ok: false, message: 'That runs past midnight. Use from – to for this day.' };
  }
  return {
    ok: true,
    clockIn: suggested.clockIn,
    clockOut: suggested.clockOut,
    minutes,
    placedAfterExisting: suggested.placedAfterExisting,
    extendSessionId: suggested.extendSessionId,
  };
}

const AddOvertimeModal: React.FC<AddOvertimeModalProps> = ({
  isOpen,
  employeeId,
  userId,
  initialDateKey = null,
  onClose,
  onSaved,
}) => {
  const [days, setDays] = useState<OvertimeDayDraft[]>([]);
  const [dateToAdd, setDateToAdd] = useState('');
  const [workplaces, setWorkplaces] = useState<ClockInLocationOption[]>([]);
  const [workplaceId, setWorkplaceId] = useState<number | null>(null);
  const [worksFromHome, setWorksFromHome] = useState(false);
  const [baseHours, setBaseHours] = useState(DEFAULT_OVERTIME_APPROVAL_BASE_HOURS);
  const [existingByDate, setExistingByDate] = useState<Record<string, StoredOvertimeApproval[]>>({});
  const [saving, setSaving] = useState(false);
  const [holidayWarnings, setHolidayWarnings] = useState<HolidayDateWarning[]>([]);
  const [showHolidayWarning, setShowHolidayWarning] = useState(false);
  const [dateNotice, setDateNotice] = useState<string | null>(null);
  const [choosingAnotherDate, setChoosingAnotherDate] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const dateKey = initialDateKey || toDateInputValue(new Date());
    setDays([newDraft(dateKey)]);
    setDateToAdd(dateKey);
    setDateNotice(null);
    setChoosingAnotherDate(false);
    setExistingByDate({});
    void Promise.all([
      fetchActiveClockInLocations(),
      fetchEmployeeWorksFromHome(employeeId),
      fetchOvertimeApprovalBaseHours(employeeId),
    ]).then(([locations, wfh, hours]) => {
      setWorkplaces(locations);
      setWorksFromHome(wfh);
      setBaseHours(hours);
      const last = readLastSelectedWorkplaceId();
      const match = locations.find((location) => location.id === last);
      setWorkplaceId(match?.id ?? locations.find((location) => location.slug !== 'home')?.id ?? locations[0]?.id ?? null);
    });
  }, [isOpen, employeeId, initialDateKey]);

  const dateKeys = useMemo(() => days.map((day) => day.dateKey), [days]);

  useEffect(() => {
    if (!isOpen || dateKeys.length === 0) return;
    let cancelled = false;
    void Promise.all(
      dateKeys.map(async (dateKey) => [dateKey, await fetchDayOvertimeApprovals(employeeId, dateKey)] as const),
    )
      .then((entries) => {
        if (!cancelled) setExistingByDate(Object.fromEntries(entries));
      })
      .catch((err) => {
        console.error('AddOvertimeModal existing hours:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, employeeId, dateKeys]);

  const shiftSyncKey = days
    .map((day) => `${day.dateKey}|${day.hours}|${day.minutes}|${day.rangeEdited ? 1 : 0}`)
    .join(';');

  useEffect(() => {
    if (!isOpen) return;
    setDays((prev) => {
      let changed = false;
      const next = prev.map((day) => {
        if (day.rangeEdited) return day;
        const suggested = suggestShift(extraMinutesOf(day), existingByDate[day.dateKey] || [], baseHours);
        if (!suggested || (day.clockInTime === suggested.clockIn && day.clockOutTime === suggested.clockOut)) {
          return day;
        }
        changed = true;
        return { ...day, clockInTime: suggested.clockIn, clockOutTime: suggested.clockOut };
      });
      return changed ? next : prev;
    });
  }, [isOpen, shiftSyncKey, existingByDate, baseHours]);

  const workplace = workplaces.find((item) => item.id === workplaceId) ?? null;
  const homeNeedsApproval = workplace != null && isHomeClockInLocation(workplace) && !worksFromHome;

  const selectedDateKey = !choosingAnotherDate && days.length === 1 ? days[0].dateKey : dateToAdd;

  const addDate = (dateKey: string) => {
    const key = dateKey.trim();
    if (!key) return;
    if (days.some((day) => day.dateKey === key)) {
      setDateNotice(alreadyAddedDateMessage(key));
      setChoosingAnotherDate(true);
      return;
    }
    setDateNotice(null);
    setChoosingAnotherDate(false);
    setDateToAdd(key);
    setDays((prev) => [...prev, newDraft(key)].sort((a, b) => a.dateKey.localeCompare(b.dateKey)));
  };

  const changeListedDate = (currentKey: string, nextKey: string) => {
    const next = nextKey.trim();
    if (!next || next === currentKey) return;
    if (days.some((day) => day.dateKey === next)) {
      setDateNotice(alreadyAddedDateMessage(next));
      setChoosingAnotherDate(true);
      setDateToAdd(next);
      return;
    }
    setDateNotice(null);
    setDateToAdd(next);
    setDays((prev) =>
      prev
        .map((day) => (day.dateKey === currentKey ? { ...day, dateKey: next } : day))
        .sort((a, b) => a.dateKey.localeCompare(b.dateKey)),
    );
  };

  const updateDay = (dateKey: string, patch: Partial<OvertimeDayDraft>) => {
    setDays((prev) => prev.map((day) => (day.dateKey === dateKey ? { ...day, ...patch } : day)));
  };

  const removeDay = (dateKey: string) => {
    setDays((prev) => prev.filter((day) => day.dateKey !== dateKey));
  };

  const performSend = async () => {
    if (!employeeId || !userId) {
      toast.error('Missing employee or user information');
      return;
    }
    if (days.length === 0) {
      toast.error('Add at least one date');
      return;
    }
    if (workplaces.length > 0 && workplaceId == null) {
      toast.error('Choose a workplace');
      return;
    }

    const prepared: Array<{ day: OvertimeDayDraft; window: Extract<ResolvedWindow, { ok: true }> }> = [];
    for (const day of days) {
      const label = `${formatWorkingHoursWeekdayLong(day.dateKey)} ${formatWorkingHoursDateLabel(day.dateKey)}`;
      const resolved = resolveDayWindow(day, existingByDate[day.dateKey] || [], baseHours);
      if (!resolved.ok) {
        toast.error(`${label}: ${resolved.message}`);
        return;
      }
      if (!day.reason.trim()) {
        toast.error(`Write the reason for ${label}`);
        return;
      }
      prepared.push({ day, window: resolved });
    }

    setSaving(true);
    const sentDates = new Set<string>();
    try {
      for (const item of prepared) {
        const wfhNote = homeNeedsApproval
          ? 'Clock-in from Home — waiting for admin approval (auto-enables Works From Home when approved)'
          : '';
        const notes = [item.day.reason.trim(), wfhNote].filter(Boolean).join('\n');
        const existingSession = (existingByDate[item.day.dateKey] || []).find(
          (session) => session.sessionId === item.window.extendSessionId,
        );
        const extendedExisting = existingSession != null;
        let id: number;
        if (existingSession) {
          id = existingSession.sessionId;
          await updateClockInSession({
            id,
            date: item.day.dateKey,
            clockInTime: item.window.clockIn,
            clockOutTime: item.window.clockOut,
            notes: [existingSession.notes?.trim(), notes].filter(Boolean).join('\n'),
            clockInLocationId: existingSession.locationId ?? workplaceId,
            clockOutLocationId: existingSession.clockOutLocationId ?? existingSession.locationId ?? workplaceId,
            skipDurationCheck: true,
            dayExceedsOvertimeBase: true,
          });
        } else {
          id = await insertManualClockInRecord({
            employeeId,
            userId,
            date: item.day.dateKey,
            clockInTime: item.window.clockIn,
            clockOutTime: item.window.clockOut,
            notes,
            clockInLocationId: workplaceId,
            clockOutLocationId: workplaceId,
            approvalDeferred: true,
            approveAutomatically: false,
            skipDurationCheck: true,
          });
        }
        try {
          await requestMichaelOvertimeApproval({
            employeeId,
            reason: item.day.reason.trim(),
            hours: formatOvertimeHoursPlaceholder({
              minutes: item.window.minutes,
              dateKey: item.day.dateKey,
              from: item.window.clockIn,
              to: item.window.clockOut,
            }),
            workplace: workplace?.name || '',
            date: formatOvertimeDatePlaceholder([item.day.dateKey]),
            clockInIds: [id],
          });
        } catch (sendError) {
          if (extendedExisting && existingSession) {
            await updateClockInSession({
              id,
              date: item.day.dateKey,
              clockInTime: existingSession.clockInTime,
              clockOutTime: existingSession.clockOutTime,
              notes: existingSession.notes?.trim() || '',
              clockInLocationId: existingSession.locationId,
              clockOutLocationId: existingSession.clockOutLocationId ?? existingSession.locationId,
              skipDurationCheck: true,
            }).catch(() => undefined);
          } else {
            await deleteClockInSessions([id]).catch(() => undefined);
          }
          throw sendError;
        }
        sentDates.add(item.day.dateKey);
      }

      if (workplaceId != null) persistLastSelectedWorkplaceId(workplaceId);
      toast.success(
        prepared.length === 1
          ? 'Message sent to Michael Decker. Your extra hours are waiting for his approval.'
          : `${prepared.length} messages sent to Michael Decker, one for each day. They are waiting for his approval.`,
      );
      onSaved();
      onClose();
    } catch (err) {
      console.error('AddOvertimeModal send:', err);
      if (sentDates.size > 0) {
        setDays((prev) => prev.filter((day) => !sentDates.has(day.dateKey)));
        onSaved();
      }
      toast.error(err instanceof Error ? err.message : 'Could not send the overtime request');
    } finally {
      setSaving(false);
    }
  };

  const handleSend = async () => {
    const warnings = await getHolidayWarningsForDates(dateKeys);
    if (warnings.length > 0) {
      setHolidayWarnings(warnings);
      setShowHolidayWarning(true);
      return;
    }
    await performSend();
  };

  const missingReason = days.length === 0 || days.some((day) => !day.reason.trim());

  return (
    <>
      <style>{`
        @keyframes overtime-mode-in {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .overtime-mode-panel {
          animation: overtime-mode-in 220ms ease-out;
        }
      `}</style>
      <ProfileBottomSheetModal
        open={isOpen}
        onClose={onClose}
        title="Add overtime"
        desktopLayout="drawer-right"
        saving={saving}
        mobileFullHeight
        headerClassName="!border-b-0"
        footerClassName="!border-t-0"
        footer={
          <div className="flex w-full flex-row items-center gap-2 md:justify-end md:gap-3">
            <button
              type="button"
              className="btn btn-ghost flex-1 md:flex-none"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary rounded-full px-6 flex-1 md:flex-none"
              onClick={() => void handleSend()}
              disabled={saving || missingReason}
            >
              {saving ? (
                <span className="loading loading-spinner loading-sm" />
              ) : (
                `Send to Michael${days.length > 1 ? ` (${days.length})` : ''}`
              )}
            </button>
          </div>
        }
      >
        <div className="space-y-5">
          <div className="flex items-stretch gap-2">
            <div className="flex min-w-0 flex-1 flex-col rounded-2xl border border-base-300 bg-white px-3.5 pb-2 pt-2 transition-colors focus-within:border-primary">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Dates</span>
                <div className="flex gap-1.5">
                  <button type="button" className="btn btn-xs h-6 min-h-6 rounded-full border-base-300 bg-base-100 px-2.5 font-medium" disabled={saving} onClick={() => addDate(shiftDateKey(0))}>
                    Today
                  </button>
                  <button type="button" className="btn btn-xs h-6 min-h-6 rounded-full border-base-300 bg-base-100 px-2.5 font-medium" disabled={saving} onClick={() => addDate(shiftDateKey(-1))}>
                    Yesterday
                  </button>
                </div>
              </div>
              <input
                type="date"
                className="mt-0.5 h-8 w-full border-0 bg-transparent p-0 text-sm text-gray-900 outline-none"
                value={selectedDateKey}
                onChange={(event) => {
                  const next = event.target.value;
                  if (choosingAnotherDate || days.length !== 1) {
                    setDateToAdd(next);
                    setDateNotice(days.some((day) => day.dateKey === next) ? alreadyAddedDateMessage(next) : null);
                    return;
                  }
                  changeListedDate(days[0].dateKey, next);
                }}
                disabled={saving}
              />
            </div>
            <button
              type="button"
              className="btn btn-outline btn-circle h-11 min-h-11 w-11 shrink-0 self-center"
              disabled={saving}
              onClick={() => addDate(selectedDateKey || shiftDateKey(0))}
              aria-label="Add date"
            >
              <PlusIcon className="h-5 w-5" />
            </button>
          </div>

          {dateNotice && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {dateNotice}
            </p>
          )}

          {workplaces.length > 0 && (
            <label className="relative flex flex-col rounded-2xl border border-base-300 bg-white px-3.5 pb-1.5 pt-2 transition-colors focus-within:border-primary">
              <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: '#9ca3af' }}>Workplace</span>
              <select
                className="h-8 w-full appearance-none border-0 bg-transparent pr-6 text-sm text-gray-900 outline-none"
                value={workplaceId ?? ''}
                onChange={(event) => setWorkplaceId(event.target.value ? Number(event.target.value) : null)}
                disabled={saving}
              >
                {workplaces.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
              <ChevronDownIcon className="pointer-events-none absolute bottom-2.5 right-3 h-4 w-4 text-base-content/40" />
            </label>
          )}

          {homeNeedsApproval && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Home needs approval before you can use it. The extra hours still go to Michael.
            </div>
          )}

          {days.length === 0 ? (
            <p className="text-sm text-base-content/60">Add a date to enter the extra hours.</p>
          ) : (
            <div className="space-y-3">
              {days.map((day) => {
                const resolved = resolveDayWindow(day, existingByDate[day.dateKey] || [], baseHours);
                const ramatGan = workplace != null && isRamatGanClockInLocation(workplace);
                return (
                  <section key={day.dateKey} className="space-y-3 rounded-2xl border border-base-200 bg-white p-4 shadow-sm">
                    {days.length > 1 && (
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-gray-900">
                            {formatWorkingHoursWeekdayLong(day.dateKey)}
                          </p>
                          <p className="text-xs text-base-content/50">{formatWorkingHoursDateLabel(day.dateKey)}</p>
                        </div>
                        <button
                          type="button"
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-red-100 bg-red-50 text-red-500 transition-colors hover:border-red-200 hover:bg-red-100 disabled:opacity-40"
                          onClick={() => removeDay(day.dateKey)}
                          disabled={saving}
                          title="Remove this day"
                          aria-label="Remove this day"
                        >
                          <XMarkIcon className="h-4 w-4 stroke-2" />
                        </button>
                      </div>
                    )}

                    <div
                      className="relative grid grid-cols-2 gap-2"
                      role="tablist"
                      aria-label="How to enter the extra hours"
                    >
                      <span
                        aria-hidden
                        className="pointer-events-none absolute top-0 z-10 h-9 rounded-full bg-primary shadow-sm transition-transform duration-300 ease-out"
                        style={{
                          width: 'calc(50% - 4px)',
                          transform: day.mode === 'range' ? 'translateX(calc(100% + 8px))' : 'translateX(0)',
                        }}
                      />
                      <button
                        type="button"
                        role="tab"
                        aria-selected={day.mode === 'total'}
                        className="relative z-20 h-9 rounded-full text-sm font-medium transition-colors duration-300"
                        style={{
                          backgroundColor: day.mode === 'total' ? 'transparent' : '#f3f4f6',
                          color: day.mode === 'total' ? '#ffffff' : '#4b5563',
                        }}
                        disabled={saving}
                        onClick={() => updateDay(day.dateKey, { mode: 'total' })}
                      >
                        Total extra hours
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={day.mode === 'range'}
                        className="relative z-20 h-9 rounded-full text-sm font-medium transition-colors duration-300"
                        style={{
                          backgroundColor: day.mode === 'range' ? 'transparent' : '#f3f4f6',
                          color: day.mode === 'range' ? '#ffffff' : '#4b5563',
                        }}
                        disabled={saving}
                        onClick={() => updateDay(day.dateKey, { mode: 'range' })}
                      >
                        From – to
                      </button>
                    </div>

                    <div key={day.mode} className="overtime-mode-panel">
                    {day.mode === 'total' ? (
                      <div className="grid grid-cols-2 gap-2">
                        <label className="form-control">
                          <span className="mb-1 text-xs font-medium text-base-content/50">Hours</span>
                          <input
                            type="number"
                            min={0}
                            max={16}
                            className="input input-bordered h-11 min-h-11 w-full rounded-xl bg-base-100"
                            value={day.hours}
                            onChange={(event) => updateDay(day.dateKey, { hours: event.target.value })}
                            disabled={saving}
                          />
                        </label>
                        <label className="form-control">
                          <span className="mb-1 text-xs font-medium text-base-content/50">Minutes</span>
                          <input
                            type="number"
                            min={0}
                            max={59}
                            className="input input-bordered h-11 min-h-11 w-full rounded-xl bg-base-100"
                            value={day.minutes}
                            onChange={(event) => updateDay(day.dateKey, { minutes: event.target.value })}
                            disabled={saving}
                          />
                        </label>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        <label className="form-control">
                          <span className="mb-1 text-xs font-medium text-base-content/50">From</span>
                          <input
                            type="time"
                            className="input input-bordered h-11 min-h-11 w-full rounded-xl bg-base-100"
                            value={day.clockInTime}
                            onChange={(event) => updateDay(day.dateKey, { clockInTime: event.target.value, rangeEdited: true })}
                            disabled={saving}
                          />
                        </label>
                        <label className="form-control">
                          <span className="mb-1 text-xs font-medium text-base-content/50">To</span>
                          <input
                            type="time"
                            className="input input-bordered h-11 min-h-11 w-full rounded-xl bg-base-100"
                            value={day.clockOutTime}
                            onChange={(event) => updateDay(day.dateKey, { clockOutTime: event.target.value, rangeEdited: true })}
                            disabled={saving}
                          />
                        </label>
                      </div>
                    )}
                    </div>

                    {resolved.ok ? (
                      <p
                        className="rounded-xl border border-gray-200 px-3 py-2.5 text-xs leading-5 text-gray-600"
                        style={{ backgroundColor: '#f3f4f6' }}
                      >
                        {formatDurationMinutesLabel(resolved.minutes)} extra, saved as {resolved.clockIn}–{resolved.clockOut}
                        {resolved.placedAfterExisting
                          ? ', added onto the hours already clocked this day'
                          : resolved.clockIn === hhmmFromMinutes(AUTO_FILL_START_HOUR * 60)
                            ? `, your automatic ${baseHours}h day from ${hhmmFromMinutes(AUTO_FILL_START_HOUR * 60)} plus the extra hours`
                            : ''}
                        .
                      </p>
                    ) : (
                      <p className="text-xs text-error">{resolved.message}</p>
                    )}

                    <fieldset className="rounded-2xl border border-gray-300 bg-white px-3.5 pb-2 transition-colors focus-within:border-primary">
                      <legend className="px-1 text-[11px] font-semibold uppercase tracking-wide" style={{ color: '#9ca3af' }}>
                        Reason{ramatGan ? ' *' : ''}
                      </legend>
                      <AutoGrowReason
                        value={day.reason}
                        disabled={saving}
                        placeholder={
                          ramatGan
                            ? 'Why these extra hours, and why the office scanner was not used'
                            : 'Why these extra hours were needed'
                        }
                        onChange={(reason) => updateDay(day.dateKey, { reason })}
                      />
                    </fieldset>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </ProfileBottomSheetModal>
      <HolidayEntryWarningModal
        isOpen={showHolidayWarning}
        warnings={holidayWarnings}
        onCancel={() => setShowHolidayWarning(false)}
        onContinue={() => {
          setShowHolidayWarning(false);
          void performSend();
        }}
        continuing={saving}
      />
    </>
  );
};

export default AddOvertimeModal;
