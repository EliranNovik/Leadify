import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import {
  expandUnavailabilitiesToDailyRows,
  fetchEmployeeUnavailabilitiesInRange,
} from '../../lib/employeeUnavailabilities';
import {
  countMissingMonthEntryDays,
  monthRange,
  sumClockDurations,
  toDateInputValue,
} from '../../lib/employeeClockInFormat';
import { getHolidayDatesInMonth } from '../../lib/israeliJewishHolidays';
import {
  fetchEmployeeClockInRecords,
  type ClockInExportRecord,
} from '../../lib/workingHoursExport';
import {
  countClockInApprovalBlockers,
  clockInApprovalSubmitBlockMessage,
  hasClockInApprovalBlockers,
  normalizeClockInApprovalFields,
} from '../../lib/employeeClockInApproval';
import {
  fetchWorkingHoursSubmission,
  submitWorkingHoursMonth,
  WorkingHoursAlreadySubmittedError,
  type EmployeeWorkingHoursSubmission,
} from '../../lib/employeeWorkingHoursSubmissions';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function countMissingDaysForMonth(
  targetYear: number,
  targetMonth: number,
  records: ClockInExportRecord[],
  unavailabilities: Awaited<ReturnType<typeof fetchEmployeeUnavailabilitiesInRange>>,
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
  return countMissingMonthEntryDays(
    targetYear,
    targetMonth,
    covered,
    undefined,
    getHolidayDatesInMonth(targetYear, targetMonth),
  );
}

interface SubmitWorkingHoursModalProps {
  isOpen: boolean;
  onClose: () => void;
  employeeId: number;
  userId: string;
  initialYear: number;
  initialMonth: number;
  yearOptions: number[];
  onSubmitted: (submission: EmployeeWorkingHoursSubmission) => void;
}

const SubmitWorkingHoursModal: React.FC<SubmitWorkingHoursModalProps> = ({
  isOpen,
  onClose,
  employeeId,
  userId,
  initialYear,
  initialMonth,
  yearOptions,
  onSubmitted,
}) => {
  const [submitYear, setSubmitYear] = useState(initialYear);
  const [submitMonth, setSubmitMonth] = useState(initialMonth);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [existingSubmission, setExistingSubmission] = useState<EmployeeWorkingHoursSubmission | null>(null);
  const [periodTotal, setPeriodTotal] = useState('—');
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
      const [existing, monthRecords, monthUnavail] = await Promise.all([
        fetchWorkingHoursSubmission(employeeId, submitYear, submitMonth),
        fetchEmployeeClockInRecords(employeeId, range.from, range.to),
        fetchEmployeeUnavailabilitiesInRange(employeeId, range.from, range.to),
      ]);
      setExistingSubmission(existing);
      const normalizedRecords = monthRecords.map((row) => normalizeClockInApprovalFields(row));
      setApprovalBlockers(countClockInApprovalBlockers(normalizedRecords));
      setPeriodTotal(sumClockDurations(monthRecords));
      setMissingDays(countMissingDaysForMonth(submitYear, submitMonth, monthRecords, monthUnavail));
      setUnavailabilityDays(
        expandUnavailabilitiesToDailyRows(monthUnavail, range.from, range.to).length,
      );
    } catch (err) {
      console.error('SubmitWorkingHoursModal preview:', err);
      setExistingSubmission(null);
      setPeriodTotal('—');
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
      const range = monthRange(submitYear, submitMonth);
      const [monthRecords, monthUnavail] = await Promise.all([
        fetchEmployeeClockInRecords(employeeId, range.from, range.to),
        fetchEmployeeUnavailabilitiesInRange(employeeId, range.from, range.to),
      ]);
      const normalizedRecords = monthRecords.map((row) => normalizeClockInApprovalFields(row));
      if (hasClockInApprovalBlockers(normalizedRecords)) {
        const message = clockInApprovalSubmitBlockMessage(
          countClockInApprovalBlockers(normalizedRecords),
        );
        toast.error(message ?? 'Cannot submit while manual entries need approval.');
        return;
      }
      const submission = await submitWorkingHoursMonth({
        employeeId,
        userId,
        year: submitYear,
        month: submitMonth,
        periodTotal: sumClockDurations(monthRecords),
        missingDays: countMissingDaysForMonth(submitYear, submitMonth, monthRecords, monthUnavail),
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
        toast.error('Failed to submit working hours.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="submit-working-hours-title"
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-base-200">
          <h3 id="submit-working-hours-title" className="text-lg font-semibold text-gray-900">
            Submit working hours
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-sm btn-circle"
            aria-label="Close"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-600">
            Choose the month and year to submit. You can only submit once per month.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="form-control w-full">
              <span className="label-text text-sm text-gray-600 mb-1.5 font-medium">Year</span>
              <select
                className="select select-bordered w-full"
                value={submitYear}
                onChange={(e) => setSubmitYear(Number(e.target.value))}
                disabled={submitting}
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </label>
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
              {missingDays > 0 && (
                <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
                  <p className="font-medium">Note</p>
                  <p className="mt-1 text-amber-800">
                    This month has {missingDays} required workday{missingDays === 1 ? '' : 's'} without
                    a clock-in or unavailability. You can still submit, but please review your entries first.
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

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-base-200 bg-base-50/50">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-success gap-2"
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
              <CheckIcon className="w-4 h-4" />
            )}
            Submit {monthLabel} {submitYear}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default SubmitWorkingHoursModal;
