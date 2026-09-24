import React, { useEffect, useMemo, useState } from 'react';
import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import {
  fetchActiveClockInLocations,
  fetchEmployeeWorksFromHome,
  isHomeClockInLocation,
  isRamatGanClockInLocation,
  type ClockInLocationOption,
} from '../../lib/clockInLocations';
import { insertManualClockInRecords } from '../../lib/employeeClockInManual';
import { toDateInputValue } from '../../lib/employeeClockInFormat';
import { getHolidayWarningsForDates } from '../../lib/israeliJewishHolidays';
import type { HolidayDateWarning } from '../../lib/israeliJewishHolidays';
import HolidayEntryWarningModal from './HolidayEntryWarningModal';
import HolidayDateNote from './HolidayDateNote';
import ProfileBottomSheetModal from './ProfileBottomSheetModal';
import ClockInOvertimeApprovalBox, {
  clockInOutTimesExceedMinHours,
} from './ClockInOvertimeApprovalBox';
import {
  fetchEmployeeMinHours,
  overtimeApprovalRequiredError,
  uploadClockInOvertimeApprovalDocument,
} from '../../lib/employeeClockInOvertimeApproval';

interface ManualClockInModalProps {
  isOpen: boolean;
  employeeId: number;
  userId: string;
  /** Pre-select this YYYY-MM-DD when opening (e.g. from month coverage calendar). */
  initialDateKey?: string | null;
  onClose: () => void;
  onSaved: () => void;
}

type DatePickerRow = {
  id: string;
  value: string;
};

function newDateRow(value: string): DatePickerRow {
  return { id: crypto.randomUUID(), value };
}

function sortDates(dates: string[]): string[] {
  return [...new Set(dates)].sort();
}

const ManualClockInModal: React.FC<ManualClockInModalProps> = ({
  isOpen,
  employeeId,
  userId,
  initialDateKey = null,
  onClose,
  onSaved,
}) => {
  const [dateRows, setDateRows] = useState<DatePickerRow[]>([]);
  const [clockInTime, setClockInTime] = useState('09:00');
  const [clockOutTime, setClockOutTime] = useState('17:00');
  const [notes, setNotes] = useState('');
  const [workplaces, setWorkplaces] = useState<ClockInLocationOption[]>([]);
  const [worksFromHome, setWorksFromHome] = useState(false);
  const [workplaceLocationId, setWorkplaceLocationId] = useState<number | ''>('');
  const [saving, setSaving] = useState(false);
  const [holidayWarnings, setHolidayWarnings] = useState<HolidayDateWarning[]>([]);
  const [showHolidayWarning, setShowHolidayWarning] = useState(false);
  const [minHours, setMinHours] = useState(8);
  const [overtimeFile, setOvertimeFile] = useState<File | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const t = initialDateKey?.trim() || toDateInputValue(new Date());
    setDateRows([newDateRow(t)]);
    setClockInTime('09:00');
    setClockOutTime('17:00');
    setNotes('');
    setWorkplaceLocationId('');
    setOvertimeFile(null);
    void fetchEmployeeMinHours(employeeId).then(setMinHours);
    void Promise.all([fetchActiveClockInLocations(), fetchEmployeeWorksFromHome(employeeId)]).then(
      ([locations, wfh]) => {
        setWorkplaces(locations);
        setWorksFromHome(wfh);
      },
    );
  }, [isOpen, employeeId, initialDateKey]);

  const selectedWorkplace = useMemo(
    () => workplaces.find((wp) => wp.id === (workplaceLocationId === '' ? null : workplaceLocationId)) ?? null,
    [workplaces, workplaceLocationId],
  );
  const homeNeedsApproval =
    selectedWorkplace != null && isHomeClockInLocation(selectedWorkplace) && !worksFromHome;
  const ramatGanSelected =
    selectedWorkplace != null && isRamatGanClockInLocation(selectedWorkplace);

  const datesToSave = useMemo(() => {
    const filled = dateRows.map((row) => row.value).filter(Boolean);
    return sortDates(filled);
  }, [dateRows]);

  const exceedsMinHours = clockInOutTimesExceedMinHours(clockInTime, clockOutTime, minHours);

  if (!isOpen) return null;

  const addDateRow = () => {
    setDateRows((prev) => [...prev, newDateRow(toDateInputValue(new Date()))]);
  };

  const removeDateRow = (id: string) => {
    setDateRows((prev) => (prev.length > 1 ? prev.filter((row) => row.id !== id) : prev));
  };

  const updateDateRow = (id: string, value: string) => {
    setDateRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, value } : row)),
    );
  };

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
      console.error('ManualClockInModal save:', err);
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

    const filled = dateRows.map((row) => row.value).filter(Boolean);
    if (filled.length === 0) {
      toast.error('Select at least one date');
      return;
    }
    if (filled.length !== datesToSave.length) {
      toast.error('Remove duplicate dates before saving');
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

  const hasDuplicateDates =
    dateRows.map((row) => row.value).filter(Boolean).length !== datesToSave.length;
  const workplaceMissing = workplaces.length > 0 && workplaceLocationId === '';
  const notesMissing = ramatGanSelected && !notes.trim();
  const overtimeDocMissing = exceedsMinHours && !overtimeFile;
  const submitDisabled =
    saving || datesToSave.length === 0 || hasDuplicateDates || workplaceMissing || notesMissing || overtimeDocMissing;
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
        title="Add clock-in / out"
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
                    {`Submit for approval${datesToSave.length > 1 ? ` (${datesToSave.length})` : ''}`}
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
                  `Submit for approval${datesToSave.length > 1 ? ` (${datesToSave.length})` : ''}`
                )}
              </button>
            )}
          </div>
        }
        mobileFullHeight
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <span className="label-text font-medium text-gray-600">Dates</span>
            <div className="space-y-2">
              {dateRows.map((row, index) => (
                <div key={row.id} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      className="input input-bordered flex-1"
                      value={row.value}
                      onChange={(e) => updateDateRow(row.id, e.target.value)}
                      disabled={saving}
                      aria-label={`Date ${index + 1}`}
                    />
                    {dateRows.length > 1 && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm btn-square text-error shrink-0"
                        onClick={() => removeDateRow(row.id)}
                        disabled={saving}
                        title="Remove date"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  {row.value && <HolidayDateNote date={row.value} />}
                </div>
              ))}
            </div>
            <button
              type="button"
              className="btn btn-outline btn-sm gap-1"
              onClick={addDateRow}
              disabled={saving}
            >
              <PlusIcon className="w-4 h-4" />
              Add date
            </button>
            {hasDuplicateDates && (
              <p className="text-xs text-error">Each date can only be selected once.</p>
            )}
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

export default ManualClockInModal;
