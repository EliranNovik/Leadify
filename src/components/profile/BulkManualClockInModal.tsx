import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import {
  fetchActiveClockInLocations,
  fetchEmployeeWorksFromHome,
  isHomeClockInLocation,
  isRamatGanClockInLocation,
  type ClockInLocationOption,
} from '../../lib/clockInLocations';
import { insertManualClockInRecords } from '../../lib/employeeClockInManual';
import { formatWorkingHoursDateLabel, formatWorkingHoursWeekday } from '../../lib/employeeClockInFormat';
import { getHolidayWarningsForDates } from '../../lib/israeliJewishHolidays';
import type { HolidayDateWarning } from '../../lib/israeliJewishHolidays';
import HolidayEntryWarningModal from './HolidayEntryWarningModal';
import ProfileBottomSheetModal from './ProfileBottomSheetModal';
import ClockInOvertimeApprovalBox, {
  clockInOutTimesExceedMinHours,
} from './ClockInOvertimeApprovalBox';
import {
  fetchEmployeeMinHours,
  overtimeApprovalRequiredError,
  uploadClockInOvertimeApprovalDocument,
} from '../../lib/employeeClockInOvertimeApproval';

function sortDates(dates: Iterable<string>): string[] {
  return [...new Set(dates)].sort();
}

interface BulkManualClockInModalProps {
  isOpen: boolean;
  employeeId: number;
  userId: string;
  selectedDateKeys: string[];
  onClose: () => void;
  onSaved: () => void;
}

const BulkManualClockInModal: React.FC<BulkManualClockInModalProps> = ({
  isOpen,
  employeeId,
  userId,
  selectedDateKeys,
  onClose,
  onSaved,
}) => {
  const [clockInTime, setClockInTime] = useState('09:00');
  const [clockOutTime, setClockOutTime] = useState('17:00');
  const [workplaces, setWorkplaces] = useState<ClockInLocationOption[]>([]);
  const [worksFromHome, setWorksFromHome] = useState(false);
  const [workplaceLocationId, setWorkplaceLocationId] = useState<number | ''>('');
  const [saving, setSaving] = useState(false);
  const [holidayWarnings, setHolidayWarnings] = useState<HolidayDateWarning[]>([]);
  const [showHolidayWarning, setShowHolidayWarning] = useState(false);
  const [minHours, setMinHours] = useState(8);
  const [overtimeFile, setOvertimeFile] = useState<File | null>(null);
  const [notes, setNotes] = useState('');

  const datesToSave = useMemo(() => sortDates(selectedDateKeys), [selectedDateKeys]);

  useEffect(() => {
    if (!isOpen) return;
    setClockInTime('09:00');
    setClockOutTime('17:00');
    setWorkplaceLocationId('');
    setOvertimeFile(null);
    setNotes('');
    void fetchEmployeeMinHours(employeeId).then(setMinHours);
    void Promise.all([fetchActiveClockInLocations(), fetchEmployeeWorksFromHome(employeeId)]).then(
      ([locations, wfh]) => {
        setWorkplaces(locations);
        setWorksFromHome(wfh);
      },
    );
  }, [isOpen, employeeId]);

  const selectedWorkplace = useMemo(
    () => workplaces.find((wp) => wp.id === (workplaceLocationId === '' ? null : workplaceLocationId)) ?? null,
    [workplaces, workplaceLocationId],
  );
  const homeNeedsApproval =
    selectedWorkplace != null && isHomeClockInLocation(selectedWorkplace) && !worksFromHome;
  const ramatGanSelected =
    selectedWorkplace != null && isRamatGanClockInLocation(selectedWorkplace);
  const exceedsMinHours = clockInOutTimesExceedMinHours(clockInTime, clockOutTime, minHours);

  const performSave = async () => {
    setSaving(true);
    try {
      const wfhNote = homeNeedsApproval
        ? 'Clock-in from Home — waiting for admin approval (auto-enables Works From Home when approved)'
        : '';
      const mergedNotes = [notes?.trim(), wfhNote].filter(Boolean).join('\n');

      const locationId = workplaceLocationId === '' ? null : workplaceLocationId;
      let overtimeApproval = null;
      if (exceedsMinHours) {
        if (!overtimeFile) throw overtimeApprovalRequiredError(minHours);
        overtimeApproval = await uploadClockInOvertimeApprovalDocument(employeeId, overtimeFile);
      }
      const count = await insertManualClockInRecords({
        employeeId,
        userId,
        dates: datesToSave,
        clockInTime,
        clockOutTime,
        notes: mergedNotes,
        clockInLocationId: locationId,
        clockOutLocationId: locationId,
        overtimeApproval,
      });
      toast.success(
        count === 1
          ? 'Clock-in entry added — waiting for admin approval'
          : `${count} clock-in entries added — waiting for admin approval`,
      );
      onSaved();
      onClose();
    } catch (err) {
      console.error('BulkManualClockInModal save:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to add entries');
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (!employeeId || !userId) {
      toast.error('Missing employee or user information');
      return;
    }
    if (datesToSave.length === 0) {
      toast.error('Select at least one day in the table');
      return;
    }
    if (!clockInTime || !clockOutTime) {
      toast.error('Please fill in clock in and clock out times');
      return;
    }
    if (workplaces.length > 0 && workplaceLocationId === '') {
      toast.error('Please choose a workplace');
      return;
    }
    if (ramatGanSelected && !notes.trim()) {
      toast.error('Please add notes for Ramat Gan');
      return;
    }
    if (exceedsMinHours && !overtimeFile) {
      toast.error(overtimeApprovalRequiredError(minHours).message);
      return;
    }

    const warnings = await getHolidayWarningsForDates(datesToSave);
    if (warnings.length > 0) {
      setHolidayWarnings(warnings);
      setShowHolidayWarning(true);
      return;
    }

    await performSave();
  };

  if (!isOpen) return null;

  const workplaceMissing = workplaces.length > 0 && workplaceLocationId === '';
  const notesMissing = ramatGanSelected && !notes.trim();
  const overtimeDocMissing = exceedsMinHours && !overtimeFile;
  const submitDisabled = saving || datesToSave.length === 0 || workplaceMissing || notesMissing || overtimeDocMissing;
  const submitBlockedReason = workplaceMissing
    ? 'Choose a workplace first'
    : notesMissing
      ? 'Add notes for Ramat Gan first'
      : overtimeDocMissing
        ? 'Upload the overtime approval screenshot first'
        : null;

  return (
    <>
      <ProfileBottomSheetModal
        open={isOpen}
        onClose={onClose}
        title="Add multiple clock-in / out"
        saving={saving}
        headerClassName="!border-b-0"
        footerClassName="!border-t-0"
        footer={
          <div className="flex w-full flex-col-reverse gap-2 md:flex-row md:justify-end md:gap-3">
            <button
              type="button"
              className="btn btn-ghost border-none shadow-none flex-1 md:min-w-[6.5rem] md:flex-none max-md:min-h-12 text-base-content/70 hover:bg-base-200 hover:text-base-content"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            {submitBlockedReason ? (
              <span
                className="tooltip tooltip-top flex-1 md:flex-none"
                data-tip={submitBlockedReason}
              >
                <span className="block w-full cursor-not-allowed">
                  <button
                    type="button"
                    className="btn btn-primary rounded-full px-8 w-full md:min-w-[6.5rem] md:flex-none max-md:min-h-12 pointer-events-none"
                    disabled
                  >
                    {`Submit for approval${datesToSave.length > 0 ? ` (${datesToSave.length})` : ''}`}
                  </button>
                </span>
              </span>
            ) : (
              <button
                type="button"
                className="btn btn-primary rounded-full px-8 flex-1 md:min-w-[6.5rem] md:flex-none max-md:min-h-12"
                onClick={() => void handleSave()}
                disabled={submitDisabled}
              >
                {saving ? (
                  <span className="loading loading-spinner loading-sm" />
                ) : (
                  `Submit for approval${datesToSave.length > 0 ? ` (${datesToSave.length})` : ''}`
                )}
              </button>
            )}
          </div>
        }
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-base-200 bg-base-50/80 px-3 py-2.5">
            <p className="text-sm font-medium text-gray-800">
              {datesToSave.length} {datesToSave.length === 1 ? 'day' : 'days'} selected
            </p>
            <p className="mt-1 text-xs text-base-content/55 line-clamp-3">
              {datesToSave
                .map((key) => `${formatWorkingHoursWeekday(key)} ${formatWorkingHoursDateLabel(key)}`)
                .join(' · ')}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="form-control w-full">
              <span className="label-text font-medium text-gray-600 mb-1">Clock in</span>
              <input
                type="time"
                className="input input-bordered w-full"
                value={clockInTime}
                onChange={(e) => setClockInTime(e.target.value)}
                disabled={saving}
              />
            </label>
            <label className="form-control w-full">
              <span className="label-text font-medium text-gray-600 mb-1">Clock out</span>
              <input
                type="time"
                className="input input-bordered w-full"
                value={clockOutTime}
                onChange={(e) => setClockOutTime(e.target.value)}
                disabled={saving}
              />
            </label>
          </div>

          {workplaces.length > 0 && (
            <label className="form-control w-full">
              <span className="label-text font-medium text-gray-600 mb-1">Workplace</span>
              <select
                className="select select-bordered w-full"
                value={workplaceLocationId}
                onChange={(e) =>
                  setWorkplaceLocationId(e.target.value ? Number(e.target.value) : '')
                }
                disabled={saving}
              >
                <option value="">—</option>
                {workplaces.map((wp) => (
                  <option key={wp.id} value={wp.id}>{wp.name}</option>
                ))}
              </select>
            </label>
          )}

          {exceedsMinHours && (
            <ClockInOvertimeApprovalBox
              minHours={minHours}
              clockInTime={clockInTime}
              clockOutTime={clockOutTime}
              dateKeys={datesToSave}
              notes={notes}
              file={overtimeFile}
              onFileChange={setOvertimeFile}
              disabled={saving}
            />
          )}

          {homeNeedsApproval && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Home needs approval before you can use it.
            </div>
          )}

          <label className="form-control w-full">
            <span className="label-text font-medium text-gray-600 mb-1">
              Notes{ramatGanSelected ? ' *' : ''}
            </span>
            <textarea
              className="textarea textarea-bordered w-full min-h-[80px]"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={
                ramatGanSelected
                  ? 'Explain why you did not use the QR scanner at the office to clock in and out'
                  : 'Optional notes (applied to each selected date)'
              }
              disabled={saving}
            />
          </label>
        </div>
      </ProfileBottomSheetModal>
      <HolidayEntryWarningModal
        isOpen={showHolidayWarning}
        warnings={holidayWarnings}
        onCancel={() => setShowHolidayWarning(false)}
        onContinue={() => {
          setShowHolidayWarning(false);
          void performSave();
        }}
        continuing={saving}
      />
    </>
  );
};

export default BulkManualClockInModal;
