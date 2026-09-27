import React, { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { fetchActiveClockInLocations, isRamatGanClockInLocation, type ClockInLocationOption } from '../../lib/clockInLocations';
import {
  clockInSessionToFormValues,
  insertManualClockInRecord,
  updateClockInSessions,
  type ClockInSessionUpdate,
} from '../../lib/employeeClockInManual';
import { unavailabilityDateLabel } from '../../lib/employeeUnavailabilities';
import { getHolidayWarningsForDates } from '../../lib/israeliJewishHolidays';
import type { HolidayDateWarning } from '../../lib/israeliJewishHolidays';
import {
  overtimeApprovalRequiredError,
  uploadClockInOvertimeApprovalDocument,
} from '../../lib/employeeClockInOvertimeApproval';
import HolidayEntryWarningModal from './HolidayEntryWarningModal';
import HolidayDateNote from './HolidayDateNote';
import ProfileBottomSheetModal from './ProfileBottomSheetModal';
import ClockInOvertimeApprovalBox, {
  clockInOutTimesExceedOvertimeBase,
} from './ClockInOvertimeApprovalBox';

export type ClockInDaySession = {
  id: number;
  clock_in_time: string;
  clock_out_time: string | null;
  notes: string | null;
  clock_in_location_id?: number | null;
  clock_out_location_id?: number | null;
  manually?: boolean;
  overtime_approval_storage_path?: string | null;
  overtime_approval_file_name?: string | null;
  overtime_approval_mime_type?: string | null;
};

interface ClockInDayEditModalProps {
  isOpen: boolean;
  employeeId: number;
  userId: string;
  dateKey: string;
  sessions: ClockInDaySession[];
  createFromAutoFill?: boolean;
  onClose: () => void;
  onSaved: () => void;
}

type SessionFormRow = ClockInSessionUpdate;

const ClockInDayEditModal: React.FC<ClockInDayEditModalProps> = ({
  isOpen,
  employeeId,
  userId,
  dateKey,
  sessions,
  createFromAutoFill = false,
  onClose,
  onSaved,
}) => {
  const [formRows, setFormRows] = useState<SessionFormRow[]>([]);
  const [workplaces, setWorkplaces] = useState<ClockInLocationOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [holidayWarnings, setHolidayWarnings] = useState<HolidayDateWarning[]>([]);
  const [showHolidayWarning, setShowHolidayWarning] = useState(false);
  const [overtimeFiles, setOvertimeFiles] = useState<Record<number, File | null>>({});

  useEffect(() => {
    if (!isOpen) return;
    setFormRows(sessions.map((s) => clockInSessionToFormValues(s)));
    setOvertimeFiles({});
    void fetchActiveClockInLocations().then(setWorkplaces);
  }, [isOpen, sessions, employeeId]);

  const updateRow = (id: number, patch: Partial<SessionFormRow>) => {
    setFormRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
  };

  const existingOvertimeById = Object.fromEntries(
    sessions.map((session) => [
      session.id,
      {
        path: session.overtime_approval_storage_path?.trim() || '',
        fileName: session.overtime_approval_file_name || '',
      },
    ]),
  );

  const rowMissingOvertimeDoc = (row: SessionFormRow): boolean => {
    if (!clockInOutTimesExceedOvertimeBase(row.clockInTime, row.clockOutTime)) {
      return false;
    }
    return !overtimeFiles[row.id] && !existingOvertimeById[row.id]?.path;
  };

  const performSave = async () => {
    if (formRows.length === 0) return;

    setSaving(true);
    try {
      const rowsToSave: ClockInSessionUpdate[] = [];
      for (const row of formRows) {
        const locationId = row.clockInLocationId ?? row.clockOutLocationId ?? null;
        const exceeds = clockInOutTimesExceedOvertimeBase(row.clockInTime, row.clockOutTime);
        const file = overtimeFiles[row.id] ?? null;
        let overtimeApproval = row.overtimeApproval ?? null;
        if (exceeds && file) {
          overtimeApproval = await uploadClockInOvertimeApprovalDocument(employeeId, file);
        } else if (exceeds && !existingOvertimeById[row.id]?.path) {
          throw overtimeApprovalRequiredError();
        }
        rowsToSave.push({
          ...row,
          clockInLocationId: locationId,
          clockOutLocationId: locationId,
          overtimeApproval,
        });
      }
      if (createFromAutoFill) {
        const row = rowsToSave[0];
        if (!row) return;
        await insertManualClockInRecord({
          employeeId,
          userId,
          date: dateKey,
          clockInTime: row.clockInTime,
          clockOutTime: row.clockOutTime,
          notes: row.notes,
          clockInLocationId: row.clockInLocationId,
          clockOutLocationId: row.clockOutLocationId,
          overtimeApproval: row.overtimeApproval,
          approveAutomatically: !clockInOutTimesExceedOvertimeBase(
            row.clockInTime,
            row.clockOutTime,
          ),
        });
      } else {
        await updateClockInSessions(rowsToSave);
      }
      toast.success(
        createFromAutoFill
          ? 'Auto-added hours replaced with your edited hours'
          : 'Clock-in entries updated',
      );
      onSaved();
      onClose();
    } catch (err) {
      console.error('ClockInDayEditModal save:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to update entries');
    } finally {
      setSaving(false);
    }
  };

  const rowWorkplace = (row: SessionFormRow): ClockInLocationOption | null => {
    const locationId = row.clockInLocationId ?? row.clockOutLocationId ?? null;
    return workplaces.find((wp) => wp.id === locationId) ?? null;
  };

  const rowMissingRamatGanNotes = (row: SessionFormRow): boolean => {
    const workplace = rowWorkplace(row);
    if (!workplace || !isRamatGanClockInLocation(workplace)) return false;
    return !row.notes?.trim();
  };

  const handleSave = async () => {
    if (formRows.length === 0) return;

    if (formRows.some(rowMissingRamatGanNotes)) {
      toast.error('Please add notes for Ramat Gan');
      return;
    }

    const missing = formRows.find(rowMissingOvertimeDoc);
    if (missing) {
      toast.error(overtimeApprovalRequiredError().message);
      return;
    }

    const warnings = await getHolidayWarningsForDates([dateKey]);
    if (warnings.length > 0) {
      setHolidayWarnings(warnings);
      setShowHolidayWarning(true);
      return;
    }

    await performSave();
  };

  const hadAutomatic = sessions.some((s) => !s.manually);
  const submitMissingOvertimeDocument = formRows.some(rowMissingOvertimeDoc);

  return (
    <>
      <ProfileBottomSheetModal
        open={isOpen}
        onClose={onClose}
        title="Edit clock-in / out"
        headerClassName="border-b-0"
        footerClassName="border-t-0"
        footer={
          <div className="flex w-full items-center justify-end gap-2">
            <button
              type="button"
              className="btn btn-ghost h-10 min-h-10 rounded-full px-5"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <span
              className={submitMissingOvertimeDocument ? 'tooltip tooltip-top' : ''}
              data-tip={
                submitMissingOvertimeDocument
                  ? 'Upload the overtime approval document before submitting.'
                  : undefined
              }
            >
              <button
                type="button"
                className="btn btn-primary h-10 min-h-10 rounded-full px-8"
                onClick={() => void handleSave()}
                disabled={
                  saving ||
                  formRows.length === 0 ||
                  formRows.some(rowMissingRamatGanNotes) ||
                  submitMissingOvertimeDocument
                }
              >
                {saving ? (
                  <span className="loading loading-spinner loading-sm" />
                ) : (
                  'Submit for approval'
                )}
              </button>
            </span>
          </div>
        }
        mobileFullHeight
      >
        <div className="space-y-4">
          <label className="form-control w-full">
            <span className="label-text font-medium text-gray-600 mb-1">Date</span>
            <input
              type="text"
              className="input input-bordered w-full"
              value={unavailabilityDateLabel(dateKey)}
              readOnly
              disabled
            />
          </label>

          <HolidayDateNote date={dateKey} />

          {hadAutomatic && (
            <p className="text-sm text-gray-500 bg-base-200/60 rounded-lg px-3 py-2">
              {createFromAutoFill
                ? <>Saving will replace the auto-added hours with a <strong>manual entry</strong>.</>
                : <>Saving will mark edited entries as <strong>Manual</strong>.</>}
            </p>
          )}

          <div className="space-y-4">
            {formRows.map((row, index) => {
              const exceeds = clockInOutTimesExceedOvertimeBase(
                row.clockInTime,
                row.clockOutTime,
              );
              const ramatGanRow = (() => {
                const wp = rowWorkplace(row);
                return wp != null && isRamatGanClockInLocation(wp);
              })();
              return (
                <div
                  key={row.id}
                  className="rounded-lg border border-base-200 p-4 space-y-3"
                >
                  {formRows.length > 1 && (
                    <p className="text-sm font-medium text-gray-700">Session {index + 1}</p>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <label className="form-control w-full">
                      <span className="label-text font-medium text-gray-600 mb-1">Clock in</span>
                      <input
                        type="time"
                        className="input input-bordered w-full"
                        value={row.clockInTime}
                        onChange={(e) => updateRow(row.id, { clockInTime: e.target.value })}
                        disabled={saving}
                      />
                    </label>
                    <label className="form-control w-full">
                      <span className="label-text font-medium text-gray-600 mb-1">Clock out</span>
                      <input
                        type="time"
                        className="input input-bordered w-full"
                        value={row.clockOutTime}
                        onChange={(e) => updateRow(row.id, { clockOutTime: e.target.value })}
                        disabled={saving}
                      />
                    </label>
                  </div>

                  {workplaces.length > 0 && (
                    <label className="form-control w-full">
                      <span className="label-text font-medium text-gray-600 mb-1">Workplace</span>
                      <select
                        className="select select-bordered w-full"
                        value={row.clockInLocationId ?? row.clockOutLocationId ?? ''}
                        onChange={(e) => {
                          const id = e.target.value ? Number(e.target.value) : null;
                          updateRow(row.id, {
                            clockInLocationId: id,
                            clockOutLocationId: id,
                          });
                        }}
                        disabled={saving}
                      >
                        <option value="">—</option>
                        {workplaces.map((wp) => (
                          <option key={wp.id} value={wp.id}>{wp.name}</option>
                        ))}
                      </select>
                    </label>
                  )}

                  {exceeds && (
                    <ClockInOvertimeApprovalBox
                      clockInTime={row.clockInTime}
                      clockOutTime={row.clockOutTime}
                      dateKeys={[dateKey]}
                      notes={row.notes}
                      file={overtimeFiles[row.id] ?? null}
                      onFileChange={(file) =>
                        setOvertimeFiles((prev) => ({ ...prev, [row.id]: file }))
                      }
                      existingFileName={
                        existingOvertimeById[row.id]?.path
                          ? existingOvertimeById[row.id].fileName || 'Overtime approval screenshot'
                          : null
                      }
                      disabled={saving}
                    />
                  )}

                  <label className="form-control w-full">
                    <span className="label-text font-medium text-gray-600 mb-1">
                      Notes{ramatGanRow ? ' *' : ''}
                    </span>
                    <textarea
                      className="textarea textarea-bordered w-full min-h-[64px]"
                      value={row.notes ?? ''}
                      onChange={(e) => updateRow(row.id, { notes: e.target.value })}
                      placeholder={
                        ramatGanRow
                          ? 'Explain why you did not use the QR scanner at the office to clock in and out'
                          : undefined
                      }
                      disabled={saving}
                    />
                  </label>
                </div>
              );
            })}
          </div>
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

export default ClockInDayEditModal;
