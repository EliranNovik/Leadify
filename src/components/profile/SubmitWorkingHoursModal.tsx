import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckIcon } from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import {
  monthRange,
  filterClockInRecordsToLocalMonth,
  toDateInputValue,
} from '../../lib/employeeClockInFormat';
import { buildWorkingHoursMonthCoverage } from '../../lib/workingHoursMonthCoverage';
import {
  fetchEmployeeClockInRecords,
  sumCountedClockDurationsMs,
  type ClockInExportRecord,
} from '../../lib/workingHoursExport';
import { supabase } from '../../lib/supabase';
import { normalizeEmployeeMinHours } from '../../lib/employeeLeadReporting';
import {
  buildHolidayMapForRange,
  generalAbsenceOverlapMs,
  preloadHolidayMapsForRange,
} from '../../lib/employeeExtraHours';
import {
  isAutoFilledClockInRecord,
  isAutoFilledOnlyDay,
  withAutoFilledClockInRecords,
} from '../../lib/autoFilledWorkingHours';
import { fetchAutoFillExcludedDates } from '../../lib/employeeAutoFillExclusions';
import { buildGeneralAbsenceWindowsByDate } from '../../lib/employeeUnavailabilities';
import {
  countClockInApprovalBlockersInMonth,
  clockInApprovalSubmitBlockMessage,
  filterCountedClockInRecords,
  normalizeClockInApprovalFields,
} from '../../lib/employeeClockInApproval';
import {
  expandUnavailabilitiesToDailyRows,
  fetchEmployeeUnavailabilitiesInRange,
  filterCountedUnavailability,
  countUnavailabilityApprovalBlockersInMonth,
} from '../../lib/employeeUnavailabilities';
import {
  fetchWorkingHoursSubmission,
  submitWorkingHoursMonth,
  WorkingHoursAlreadySubmittedError,
  type EmployeeWorkingHoursSubmission,
} from '../../lib/employeeWorkingHoursSubmissions';
import YearWheelPicker from '../YearWheelPicker';
import ProfileBottomSheetModal from './ProfileBottomSheetModal';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function formatWorkedDuration(totalMs: number): string {
  const safeMs = Math.max(0, totalMs);
  const hours = Math.floor(safeMs / 3_600_000);
  const minutes = Math.floor((safeMs % 3_600_000) / 60_000);
  return `${hours}h ${minutes}m`;
}

type MonthUnavailabilities = Awaited<ReturnType<typeof fetchEmployeeUnavailabilitiesInRange>>;

/**
 * Same hours the Worked card shows: stored clock-ins plus automatic base hours,
 * with holidays, deleted automatic days, and timed general absences already applied.
 */
function workedMsMatchingHoursCard(
  filled: ClockInExportRecord[],
  unavailabilities: MonthUnavailabilities,
  from: string,
  to: string,
): number {
  const windows = buildGeneralAbsenceWindowsByDate(unavailabilities, from, to);
  const byDay = new Map<string, ClockInExportRecord[]>();
  for (const record of filled) {
    const dateKey = toDateInputValue(new Date(record.clock_in_time));
    const bucket = byDay.get(dateKey);
    if (bucket) bucket.push(record);
    else byDay.set(dateKey, [record]);
  }

  const nowMs = Date.now();
  let totalMs = 0;
  for (const [dateKey, dayRecords] of byDay) {
    const counted = filterCountedClockInRecords(dayRecords);
    let workedMs = sumCountedClockDurationsMs(counted);
    if (!isAutoFilledOnlyDay(dayRecords)) {
      let absenceMs = 0;
      for (const record of counted) {
        const inMs = Date.parse(record.clock_in_time);
        if (!Number.isFinite(inMs)) continue;
        const outMs = record.clock_out_time ? Date.parse(record.clock_out_time) : nowMs;
        if (!Number.isFinite(outMs) || outMs <= inMs) continue;
        absenceMs += generalAbsenceOverlapMs(inMs, outMs, dateKey, windows);
      }
      workedMs = Math.max(0, workedMs - absenceMs);
    }
    totalMs += workedMs;
  }
  return totalMs;
}

async function loadMonthHoursSnapshot(
  employeeId: number,
  year: number,
  month: number,
): Promise<{
  records: ClockInExportRecord[];
  unavailabilities: MonthUnavailabilities;
  periodTotal: string;
  autoAddedBaseHours: string;
  autoAddedBaseMs: number;
  autoAddedDayCount: number;
  missingDays: number;
}> {
  const range = monthRange(year, month);
  const [monthRecordsRaw, monthUnavail, employeeRow, excludedDates] = await Promise.all([
    fetchEmployeeClockInRecords(employeeId, range.from, range.to),
    fetchEmployeeUnavailabilitiesInRange(employeeId, range.from, range.to),
    supabase.from('tenants_employee').select('min_hours').eq('id', employeeId).maybeSingle(),
    fetchAutoFillExcludedDates(employeeId),
    preloadHolidayMapsForRange(range.from, range.to),
  ]);
  if (employeeRow.error) throw employeeRow.error;

  const records = filterClockInRecordsToLocalMonth(monthRecordsRaw, year, month).map((row) =>
    normalizeClockInApprovalFields(row),
  );
  const filled = withAutoFilledClockInRecords({
    employeeId,
    minHours: normalizeEmployeeMinHours(employeeRow.data?.min_hours),
    dateFrom: range.from,
    dateTo: range.to,
    holidayMap: buildHolidayMapForRange(range.from, range.to),
    existingRecords: records,
    unavailabilities: monthUnavail,
    excludedDates,
  });

  const autoAddedRecords = filled.filter(isAutoFilledClockInRecord);
  const autoAddedBaseMs = sumCountedClockDurationsMs(autoAddedRecords);
  const autoAddedDayCount = new Set(
    autoAddedRecords.map((record) => toDateInputValue(new Date(record.clock_in_time))),
  ).size;

  return {
    records,
    unavailabilities: monthUnavail,
    periodTotal: formatWorkedDuration(
      workedMsMatchingHoursCard(filled, monthUnavail, range.from, range.to),
    ),
    autoAddedBaseHours: formatWorkedDuration(autoAddedBaseMs),
    autoAddedBaseMs,
    autoAddedDayCount,
    missingDays: buildWorkingHoursMonthCoverage(
      year,
      month,
      filterCountedClockInRecords(filled),
      filterCountedUnavailability(monthUnavail),
    ).missingCount,
  };
}

function combinedApprovalBlockers(
  records: ClockInExportRecord[],
  unavailabilities: Awaited<ReturnType<typeof fetchEmployeeUnavailabilitiesInRange>>,
  year: number,
  month: number,
) {
  const clock = countClockInApprovalBlockersInMonth(
    records.map((row) => normalizeClockInApprovalFields(row)),
    year,
    month,
  );
  const leave = countUnavailabilityApprovalBlockersInMonth(unavailabilities, year, month);
  return {
    pendingCount: clock.pendingCount + leave.pendingCount,
    declinedCount: clock.declinedCount + leave.declinedCount,
  };
}

interface SubmitWorkingHoursModalProps {
  isOpen: boolean;
  onClose: () => void;
  employeeId: number;
  userId: string;
  initialYear: number;
  initialMonth: number;
  onSubmitted: (submission: EmployeeWorkingHoursSubmission) => void;
}

const SUBMIT_MODAL_BTN_CLASS =
  'inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold border-0 shadow-sm transition-all duration-200 bg-gradient-to-r from-emerald-600 to-teal-600 text-white hover:from-emerald-700 hover:to-teal-700 hover:shadow-md active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none disabled:shadow-none flex-1 md:flex-none md:min-w-[12rem] max-md:min-h-12';

const SubmitWorkingHoursModal: React.FC<SubmitWorkingHoursModalProps> = ({
  isOpen,
  onClose,
  employeeId,
  userId,
  initialYear,
  initialMonth,
  onSubmitted,
}) => {
  const [submitYear, setSubmitYear] = useState(initialYear);
  const [submitMonth, setSubmitMonth] = useState(initialMonth);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [existingSubmission, setExistingSubmission] = useState<EmployeeWorkingHoursSubmission | null>(null);
  const [periodTotal, setPeriodTotal] = useState('—');
  const [autoAddedBaseHours, setAutoAddedBaseHours] = useState('—');
  const [autoAddedBaseMs, setAutoAddedBaseMs] = useState(0);
  const [autoAddedDayCount, setAutoAddedDayCount] = useState(0);
  const [missingDays, setMissingDays] = useState(0);
  const [unavailabilityDays, setUnavailabilityDays] = useState(0);
  const [approvalBlockers, setApprovalBlockers] = useState({ pendingCount: 0, declinedCount: 0 });

  useEffect(() => {
    if (!isOpen) return;
    setSubmitYear(initialYear);
    setSubmitMonth(initialMonth);
  }, [isOpen, initialYear, initialMonth]);

  const loadPreview = useCallback(async () => {
    if (!employeeId) return;
    setLoadingPreview(true);
    try {
      const range = monthRange(submitYear, submitMonth);
      const [existing, snapshot] = await Promise.all([
        fetchWorkingHoursSubmission(employeeId, submitYear, submitMonth),
        loadMonthHoursSnapshot(employeeId, submitYear, submitMonth),
      ]);
      setExistingSubmission(existing);
      setApprovalBlockers(
        combinedApprovalBlockers(snapshot.records, snapshot.unavailabilities, submitYear, submitMonth),
      );
      setPeriodTotal(snapshot.periodTotal);
      setAutoAddedBaseHours(snapshot.autoAddedBaseHours);
      setAutoAddedBaseMs(snapshot.autoAddedBaseMs);
      setAutoAddedDayCount(snapshot.autoAddedDayCount);
      setMissingDays(snapshot.missingDays);
      setUnavailabilityDays(
        expandUnavailabilitiesToDailyRows(
          filterCountedUnavailability(snapshot.unavailabilities),
          range.from,
          range.to,
        ).length,
      );
    } catch (err) {
      console.error('SubmitWorkingHoursModal preview:', err);
      setExistingSubmission(null);
      setPeriodTotal('—');
      setAutoAddedBaseHours('—');
      setAutoAddedBaseMs(0);
      setAutoAddedDayCount(0);
      setMissingDays(0);
      setUnavailabilityDays(0);
      setApprovalBlockers({ pendingCount: 0, declinedCount: 0 });
    } finally {
      setLoadingPreview(false);
    }
  }, [employeeId, submitYear, submitMonth]);

  useEffect(() => {
    if (!isOpen) return;
    void loadPreview();
  }, [isOpen, loadPreview]);

  const monthLabel = useMemo(() => MONTH_NAMES[submitMonth - 1] ?? '', [submitMonth]);
  const approvalBlockMessage = useMemo(
    () => clockInApprovalSubmitBlockMessage(approvalBlockers),
    [approvalBlockers],
  );
  const submitBlockedByApproval = approvalBlockMessage != null;

  const handleSubmit = async () => {
    if (!userId || existingSubmission) return;

    setSubmitting(true);
    try {
      const snapshot = await loadMonthHoursSnapshot(employeeId, submitYear, submitMonth);
      const blockers = combinedApprovalBlockers(
        snapshot.records,
        snapshot.unavailabilities,
        submitYear,
        submitMonth,
      );
      if (blockers.pendingCount > 0 || blockers.declinedCount > 0) {
        const message = clockInApprovalSubmitBlockMessage(blockers);
        toast.error(message ?? 'Cannot submit while entries need approval.');
        return;
      }
      const submission = await submitWorkingHoursMonth({
        employeeId,
        userId,
        year: submitYear,
        month: submitMonth,
        periodTotal: snapshot.periodTotal,
        missingDays: snapshot.missingDays,
      });
      toast.success(`Working hours for ${monthLabel} ${submitYear} submitted.`);
      onSubmitted(submission);
      onClose();
    } catch (err) {
      console.error('SubmitWorkingHoursModal submit:', err);
      if (err instanceof WorkingHoursAlreadySubmittedError) {
        toast.error('This month was already submitted.');
        await loadPreview();
      } else {
        const msg = err instanceof Error ? err.message : '';
        if (msg.includes('row-level security') || (err as { code?: string })?.code === '42501') {
          toast.error('Permission denied submitting hours. Ask an admin to apply the working-hours submissions RLS update.');
        } else {
          toast.error('Failed to submit working hours.');
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <ProfileBottomSheetModal
      open={isOpen}
      onClose={onClose}
      title="Submit working hours"
      closeOnOverlayClick={!submitting}
      headerClassName="md:!border-b-0"
      footerClassName="md:!border-t-0"
      footer={
        <div className="flex w-full flex-row items-center gap-2 md:justify-end md:gap-3">
          <button
            type="button"
            className="btn max-md:min-h-12 max-md:flex-1 max-md:border-0 max-md:bg-transparent max-md:shadow-none md:btn-outline md:min-w-[6.5rem] md:flex-none"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className={SUBMIT_MODAL_BTN_CLASS}
            onClick={() => void handleSubmit()}
            disabled={
              submitting
              || loadingPreview
              || Boolean(existingSubmission)
              || submitBlockedByApproval
            }
          >
            {submitting ? (
              <span className="loading loading-spinner loading-sm" />
            ) : (
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/20">
                <CheckIcon className="w-4 h-4 stroke-[2.5]" aria-hidden />
              </span>
            )}
            Submit {monthLabel} {submitYear}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="form-control w-full">
            <YearWheelPicker
              label="Year"
              value={submitYear}
              onChange={setSubmitYear}
              disabled={submitting}
            />
          </div>
          <label className="form-control w-full">
            <span className="label-text text-sm text-gray-600 mb-1.5 font-medium">Month</span>
            <select
              className="select select-bordered w-full"
              value={submitMonth}
              onChange={(e) => setSubmitMonth(Number(e.target.value))}
              disabled={submitting}
            >
              {MONTH_NAMES.map((name, i) => (
                <option key={name} value={i + 1}>{name}</option>
              ))}
            </select>
          </label>
        </div>

        {loadingPreview ? (
          <div className="flex items-center justify-center py-6">
            <span className="loading loading-spinner loading-md text-primary" />
          </div>
        ) : existingSubmission ? (
          <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">
            <div className="flex items-center gap-2 font-medium">
              <CheckIcon className="w-5 h-5 shrink-0" />
              Already submitted
            </div>
            <p className="mt-1 text-green-700">
              {monthLabel} {submitYear} was submitted on{' '}
              {new Date(existingSubmission.submitted_at).toLocaleString('en-GB')}.
            </p>
          </div>
        ) : (
          <>
            <div className="rounded-xl bg-base-200/60 px-4 py-3 text-sm space-y-1">
              <p>
                <span className="text-gray-600">Period total:</span>{' '}
                <span className="font-semibold text-gray-900">{periodTotal}</span>
              </p>
              <p>
                <span className="text-gray-600">Auto-added base hours:</span>{' '}
                <span className="font-semibold text-gray-900">{autoAddedBaseHours}</span>
              </p>
              <p>
                <span className="text-gray-600">Unavailability days:</span>{' '}
                <span className="font-semibold text-gray-900">{unavailabilityDays}</span>
              </p>
              <p>
                <span className="text-gray-600">Missing days:</span>{' '}
                <span className={`font-semibold ${missingDays > 0 ? 'text-amber-700' : 'text-green-700'}`}>
                  {missingDays}
                </span>
              </p>
            </div>
            {autoAddedBaseMs > 0 && (
              <div className="rounded-xl bg-sky-50 border border-sky-200 px-4 py-3 text-sm text-sky-950">
                <p className="font-medium">Please review before submitting</p>
                <p className="mt-1 text-sky-900">
                  {autoAddedBaseHours} of base hours were applied automatically across {autoAddedDayCount}{' '}
                  day{autoAddedDayCount === 1 ? '' : 's'}. Please verify that you were present and working
                  on each of these days, and that no sick leave or other unavailability applies.
                </p>
              </div>
            )}
            {missingDays > 0 && (
              <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
                <p className="font-medium">Note</p>
                <p className="mt-1 text-amber-800">
                  This month has {missingDays} required day{missingDays === 1 ? '' : 's'} (workdays
                  and holidays) without a clock-in or unavailability. You can still submit, but please
                  review your entries first.
                </p>
              </div>
            )}
            {submitBlockedByApproval && approvalBlockMessage && (
              <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-900">
                <p className="font-medium">Cannot submit yet</p>
                <p className="mt-1 text-red-800">{approvalBlockMessage}</p>
              </div>
            )}
          </>
        )}
      </div>
    </ProfileBottomSheetModal>
  );
};

export default SubmitWorkingHoursModal;
