import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowDownTrayIcon,
  CalendarDaysIcon,
  ClockIcon,
  DocumentArrowUpIcon,
  FunnelIcon,
  PencilSquareIcon,
  PlusIcon,
  BoltIcon,
  TrashIcon,
  XMarkIcon,
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
} from '../../lib/workingHoursExport';
import {
  countMissingMonthEntryDays,
  dateRangeToIsoBounds,
  monthRange,
  sumClockDurations,
  toDateInputValue,
} from '../../lib/employeeClockInFormat';
import {
  getHolidayDatesInMonth,
  preloadHolidayYears,
} from '../../lib/israeliJewishHolidays';
import { deleteClockInSessions } from '../../lib/employeeClockInManual';
import { useAuthContext } from '../../contexts/AuthContext';
import {
  documentNameFromUrl,
  deleteUnavailabilityDay,
  expandUnavailabilitiesToDailyRows,
  fetchEmployeeUnavailabilitiesInRange,
  unavailabilityDateLabel,
  unavailabilityReasonText,
  type EmployeeUnavailabilityDayRow,
  type EmployeeUnavailabilityEntry,
} from '../../lib/employeeUnavailabilities';
import UnavailabilityTypeBadge from '../UnavailabilityTypeBadge';
import DocumentViewerModal from '../DocumentViewerModal';
import UnavailabilityDayEditModal from './UnavailabilityDayEditModal';
import ManualClockInModal from './ManualClockInModal';
import ClockInDayEditModal from './ClockInDayEditModal';

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
};

interface WorkingHoursTabProps {
  employeeId: number;
  employeeName?: string;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const UNAVAIL_COL_SPAN = 5;
const HOURS_COL_SPAN = 8;

function countMissingForMonth(
  targetYear: number,
  targetMonth: number,
  records: ClockInRow[],
  unavailabilities: EmployeeUnavailabilityEntry[],
  excludeDates: Iterable<string> = [],
): number {
  const range = monthRange(targetYear, targetMonth);
  const covered = new Set<string>();
  for (const record of records) {
    covered.add(toDateInputValue(new Date(record.clock_in_time)));
  }
  for (const row of expandUnavailabilitiesToDailyRows(
    unavailabilities,
    range.from,
    range.to,
  )) {
    covered.add(row.date);
  }
  return countMissingMonthEntryDays(targetYear, targetMonth, covered, undefined, excludeDates);
}

function MissingDaysBadge({ count, loading }: { count: number; loading: boolean }) {
  if (loading) return null;
  if (count > 0) {
    return (
      <span
        className="badge badge-sm bg-amber-100 text-amber-800 border border-amber-200"
        title="Sun–Thu workdays (up to today) with no clock-in or unavailability; Fri/Sat and holidays excluded"
      >
        {count} {count === 1 ? 'day' : 'days'} missing
      </span>
    );
  }
  return (
    <span
      className="badge badge-sm bg-green-100 text-green-700 border border-green-200"
      title="All required workdays this month are covered (Fri/Sat and holidays excluded)"
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

const WorkingHoursTab: React.FC<WorkingHoursTabProps> = ({ employeeId, employeeName = '' }) => {
  const { user } = useAuthContext();
  const calendarRef = useRef<CompactAvailabilityCalendarRef>(null);
  const now = useMemo(() => new Date(), []);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const defaultRange = monthRange(now.getFullYear(), now.getMonth() + 1);
  const [dateFrom, setDateFrom] = useState(defaultRange.from);
  const [dateTo, setDateTo] = useState(defaultRange.to);
  const [records, setRecords] = useState<ClockInRow[]>([]);
  const [unavailabilities, setUnavailabilities] = useState<EmployeeUnavailabilityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [isClockedIn, setIsClockedIn] = useState(false);
  const [sessionDuration, setSessionDuration] = useState('');
  const [exporting, setExporting] = useState(false);
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
  const [editingClockInDay, setEditingClockInDay] = useState<string | null>(null);
  const [deletingClockInDay, setDeletingClockInDay] = useState<string | null>(null);
  const [selectedDocument, setSelectedDocument] = useState<{
    url: string;
    name: string;
    reason: string;
    uploadedAt: string;
  } | null>(null);
  const [holidayMapVersion, setHolidayMapVersion] = useState(0);

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

  const yearOptions = useMemo(() => {
    const y = now.getFullYear();
    return [y - 2, y - 1, y, y + 1];
  }, [now]);

  useEffect(() => {
    const range = monthRange(year, month);
    setDateFrom(range.from);
    setDateTo(range.to);
  }, [year, month]);

  const fetchRecords = useCallback(async () => {
    if (!employeeId || !dateFrom || !dateTo) {
      setRecords([]);
      setUnavailabilities([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { start, end } = dateRangeToIsoBounds(dateFrom, dateTo);
      const [clockResult, unavailRows] = await Promise.all([
        supabase
          .from('employee_clock_in')
          .select(
            `id, employee_id, clock_in_time, clock_out_time, is_active, manually,
             clock_in_location_id, clock_out_location_id,
             clock_in_place:clock_in_locations!clock_in_location_id ( name ),
             clock_out_place:clock_in_locations!clock_out_location_id ( name ),
             notes`,
          )
          .eq('employee_id', employeeId)
          .gte('clock_in_time', start)
          .lte('clock_in_time', end)
          .order('clock_in_time', { ascending: false }),
        fetchEmployeeUnavailabilitiesInRange(employeeId, dateFrom, dateTo),
      ]);

      if (clockResult.error) throw clockResult.error;
      setRecords((clockResult.data as ClockInRow[]) || []);
      setUnavailabilities(unavailRows);
    } catch (err) {
      console.error('WorkingHoursTab fetch:', err);
      setRecords([]);
      setUnavailabilities([]);
    } finally {
      setLoading(false);
    }
  }, [employeeId, dateFrom, dateTo]);

  useEffect(() => {
    void fetchRecords();
  }, [fetchRecords]);

  useEffect(() => {
    void fetchClockInStatus();
    const interval = window.setInterval(() => {
      void fetchClockInStatus();
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [fetchClockInStatus]);

  const dailyRows = useMemo(() => aggregateClockInRecordsByDay(records), [records]);
  const periodTotal = sumClockDurations(records);

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

  const handleCalendarMonthChange = useCallback((viewYear: number, viewMonth: number) => {
    setCalendarViewYear(viewYear);
    setCalendarViewMonth(viewMonth);
  }, []);

  const periodMissingDays = useMemo(
    () => countMissingForMonth(
      year,
      month,
      records,
      unavailabilities,
      getHolidayDatesInMonth(year, month),
    ),
    [year, month, records, unavailabilities, holidayMapVersion],
  );

  const calendarMissingDays = useMemo(() => {
    const viewRange = monthRange(calendarViewYear, calendarViewMonth);
    const filterRange = monthRange(year, month);
    const sameMonth = viewRange.from === filterRange.from;

    const monthRecords = sameMonth ? records : calendarMonthRecords;
    const monthUnavail = sameMonth ? unavailabilities : calendarMonthUnavailabilities;

    return countMissingForMonth(
      calendarViewYear,
      calendarViewMonth,
      monthRecords,
      monthUnavail,
      getHolidayDatesInMonth(calendarViewYear, calendarViewMonth),
    );
  }, [
    calendarViewYear,
    calendarViewMonth,
    year,
    month,
    records,
    unavailabilities,
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
    setCalendarViewYear(year);
    setCalendarViewMonth(month);
    setCalendarModalOpen(true);
  };

  const handleExportExcel = () => {
    const mergedRows = buildMergedTimeAndUnavailabilityExportRows(
      records,
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
    const confirmed = window.confirm(
      `Remove unavailability for ${unavailabilityDateLabel(row.date)}?`,
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
      toast.error('Failed to remove unavailability');
    } finally {
      setDeletingRowKey(null);
    }
  };

  const handleDeleteClockInDay = async (dateKey: string) => {
    const daySessions = recordsByDay.get(dateKey) ?? [];
    if (daySessions.length === 0) return;

    const label = unavailabilityDateLabel(dateKey);
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
      toast.error('Failed to remove clock-in entries');
    } finally {
      setDeletingClockInDay(null);
    }
  };

  return (
    <div className="w-full max-w-full min-w-0 overflow-x-hidden space-y-6">
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

      {/* Filters */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-base font-semibold text-gray-700">
          <FunnelIcon className="w-5 h-5" />
          Filters
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="form-control w-full">
            <span className="label-text text-sm text-gray-600 mb-1.5 font-medium">Year</span>
            <select
              className="select select-bordered w-full text-base h-12"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </label>
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
          <label className="form-control w-full">
            <span className="label-text text-sm text-gray-600 mb-1.5 font-medium">From</span>
            <input
              type="date"
              className="input input-bordered w-full text-base h-12"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </label>
          <label className="form-control w-full">
            <span className="label-text text-sm text-gray-600 mb-1.5 font-medium">To</span>
            <input
              type="date"
              className="input input-bordered w-full text-base h-12"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <button
            type="button"
            className="btn btn-ghost text-base"
            onClick={() => {
              const t = new Date();
              setYear(t.getFullYear());
              setMonth(t.getMonth() + 1);
            }}
          >
            Current month
          </button>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-base font-semibold text-primary">
              Period total: {periodTotal}
            </span>
            <MissingDaysBadge count={periodMissingDays} loading={loading} />
            <button
              type="button"
              className="btn btn-outline btn-primary gap-2"
              onClick={handleExportExcel}
              disabled={
                exporting
                || loading
                || (records.length === 0 && unavailabilityDayRows.length === 0)
              }
            >
              {exporting ? (
                <span className="loading loading-spinner loading-sm" />
              ) : (
                <ArrowDownTrayIcon className="w-5 h-5" />
              )}
              Export Excel
            </button>
          </div>
        </div>
      </div>

      {/* Unavailabilities */}
      <div className="w-full rounded-2xl border border-base-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-base-200 bg-base-200/40">
          <div className="flex items-center gap-2 min-w-0">
            <CalendarDaysIcon className="w-5 h-5 text-primary shrink-0" />
            <h3 className="text-base font-semibold text-gray-800">Unavailabilities</h3>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-primary gap-2 shrink-0"
            onClick={openCalendarModal}
          >
            <CalendarDaysIcon className="w-4 h-4" />
            Calendar
          </button>
        </div>
        <div className="w-full overflow-x-auto">
          <table className="table table-sm md:table-md w-full">
            <thead>
              <tr className="bg-base-200/50">
                <th className="text-left">Date</th>
                <th className="text-left">Type</th>
                <th className="text-left">Reason</th>
                <th className="text-left">Document</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={UNAVAIL_COL_SPAN} className="text-center py-8">
                    <span className="loading loading-spinner loading-md text-primary" />
                  </td>
                </tr>
              ) : unavailabilityDayRows.length === 0 ? (
                <tr>
                  <td colSpan={UNAVAIL_COL_SPAN} className="text-center py-8 text-gray-400">
                    No unavailabilities for this period.
                  </td>
                </tr>
              ) : (
                unavailabilityDayRows.map((row) => {
                  const rowKey = `${row.id}-${row.date}`;
                  const isDeleting = deletingRowKey === rowKey;
                  return (
                  <tr key={rowKey} className="hover:bg-base-200/30">
                    <td className="whitespace-nowrap text-sm font-medium">
                      {unavailabilityDateLabel(row.date)}
                    </td>
                    <td className="whitespace-nowrap">
                      <UnavailabilityTypeBadge type={row.unavailability_type} />
                    </td>
                    <td className="max-w-[240px] text-sm">
                      {unavailabilityReasonText(row)}
                    </td>
                    <td>
                      {row.document_url ? (
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs gap-1 text-primary"
                          onClick={() =>
                            setSelectedDocument({
                              url: row.document_url!,
                              name: documentNameFromUrl(row.document_url!),
                              reason: unavailabilityReasonText(row),
                              uploadedAt: row.created_at,
                            })
                          }
                        >
                          <DocumentArrowUpIcon className="w-4 h-4" />
                          View
                        </button>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs btn-square"
                          title="Edit"
                          disabled={loading || isDeleting}
                          onClick={() => setEditingRow(row)}
                        >
                          <PencilSquareIcon className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs btn-square text-error"
                          title="Delete"
                          disabled={loading || isDeleting}
                          onClick={() => void handleDeleteUnavailability(row)}
                        >
                          {isDeleting ? (
                            <span className="loading loading-spinner loading-xs" />
                          ) : (
                            <TrashIcon className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Working hours — one row per day */}
      <div className="w-full rounded-2xl border border-base-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-base-200 bg-base-200/40">
          <div className="flex items-center gap-2 min-w-0">
            <ClockIcon className="w-5 h-5 text-primary shrink-0" />
            <h3 className="text-base font-semibold text-gray-800">Clock-in / Clock-out</h3>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-primary gap-2 shrink-0"
            onClick={() => setManualClockInOpen(true)}
            disabled={!user?.id}
          >
            <PlusIcon className="w-4 h-4" />
            Add entry
          </button>
        </div>
        <div className="w-full overflow-x-auto">
          <table className="table table-sm md:table-md w-full">
            <thead>
              <tr className="bg-base-200/50">
                <th className="text-left">Date</th>
                <th className="text-left">Clock in</th>
                <th className="text-left">Clock out</th>
                <th className="text-left">Total duration</th>
                <th className="text-left">Workplace (in)</th>
                <th className="text-left">Workplace (out)</th>
                <th className="text-left">Notes</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={HOURS_COL_SPAN} className="text-center py-12">
                    <span className="loading loading-spinner loading-md text-primary" />
                  </td>
                </tr>
              ) : dailyRows.length === 0 ? (
                <tr>
                  <td colSpan={HOURS_COL_SPAN} className="text-center py-12 text-gray-400">
                    No clock-in records for this period.
                  </td>
                </tr>
              ) : (
                dailyRows.map((row) => {
                  const isDeleting = deletingClockInDay === row.dateKey;
                  return (
                  <tr key={row.dateKey} className="hover:bg-base-200/30">
                    <td className="whitespace-nowrap font-medium">
                      <div className="flex items-center gap-1.5">
                        <span>{row.date}</span>
                        <div className="flex items-center gap-0.5 shrink-0">
                          {row.hasManual && (
                            <span
                              className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-amber-100 text-amber-700 border border-amber-200"
                              title="Manual entry"
                            >
                              <PencilSquareIcon className="w-4 h-4" />
                            </span>
                          )}
                          {row.hasAutomatic && (
                            <span
                              className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-gray-100 text-gray-600 border border-gray-200"
                              title="Automatic entry"
                            >
                              <BoltIcon className="w-4 h-4" />
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td>
                      <TimeListCell value={row.clockIns} />
                    </td>
                    <td>
                      <TimeListCell value={row.clockOuts} />
                    </td>
                    <td className="whitespace-nowrap font-semibold text-primary">
                      {row.totalDuration}
                    </td>
                    <td className="text-sm max-w-[140px]">{row.workplacesIn}</td>
                    <td className="text-sm max-w-[140px]">{row.workplacesOut}</td>
                    <td className="max-w-[160px] truncate text-sm text-gray-500">
                      {row.notes}
                    </td>
                    <td className="text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs btn-square"
                          title="Edit"
                          disabled={loading || isDeleting}
                          onClick={() => setEditingClockInDay(row.dateKey)}
                        >
                          <PencilSquareIcon className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs btn-square text-error"
                          title="Delete"
                          disabled={loading || isDeleting}
                          onClick={() => void handleDeleteClockInDay(row.dateKey)}
                        >
                          {isDeleting ? (
                            <span className="loading loading-spinner loading-xs" />
                          ) : (
                            <TrashIcon className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

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
                  onClick={() => calendarRef.current?.openAddRangeModal()}
                  className="btn btn-xs btn-primary gap-1"
                  title="Add unavailability range"
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
        onClose={() => setManualClockInOpen(false)}
        onSaved={() => void fetchRecords()}
      />

      <UnavailabilityDayEditModal
        isOpen={!!editingRow}
        row={editingRow}
        employeeId={employeeId}
        onClose={() => setEditingRow(null)}
        onSaved={() => void fetchRecords()}
      />

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
