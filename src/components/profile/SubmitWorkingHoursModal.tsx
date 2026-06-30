import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckIcon } from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import {
  expandUnavailabilitiesToDailyRows,
  fetchEmployeeUnavailabilitiesInRange,
} from '../../lib/employeeUnavailabilities';
import {
  monthRange,
  sumClockDurations,
} from '../../lib/employeeClockInFormat';
import { buildWorkingHoursMonthCoverage } from '../../lib/workingHoursMonthCoverage';
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
import YearWheelPicker from '../YearWheelPicker';
import ProfileBottomSheetModal from './ProfileBottomSheetModal';

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
  return buildWorkingHoursMonthCoverage(
    targetYear,
    targetMonth,
    records,
    unavailabilities,
  ).missingCount;
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

  if (!isOpen) return null;

  return (
    <ProfileBottomSheetModal
      open={isOpen}
      onClose={onClose}
      title="Submit working hours"
      closeOnOverlayClick={!submitting}
      footer={
        <div className="flex w-full flex-col-reverse gap-2 md:flex-row md:justify-end md:gap-3">
          <button
            type="button"
            className="btn btn-outline flex-1 md:min-w-[6.5rem] md:flex-none max-md:min-h-12"
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
        <p className="text-sm text-gray-600">
          Choose the month and year to submit. You can only submit once per month.
        </p>

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
