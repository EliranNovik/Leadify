import React, { useEffect, useMemo, useState } from 'react';
import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import {
  fetchActiveClockInLocations,
  isRamatGanClockInLocation,
  type ClockInLocationOption,
} from '../../lib/clockInLocations';
import {
  clockInSessionToFormValues,
  deleteClockInSessions,
  insertManualClockInRecord,
  updateClockInSessions,
  type ClockInSessionUpdate,
  type ManualClockInSegment,
} from '../../lib/employeeClockInManual';
import { unavailabilityDateLabel } from '../../lib/employeeUnavailabilities';
import { getHolidayWarningsForDates } from '../../lib/israeliJewishHolidays';
import type { HolidayDateWarning } from '../../lib/israeliJewishHolidays';
import {
  DEFAULT_OVERTIME_APPROVAL_BASE_HOURS,
  assertManualDurationAllowed,
  fetchOvertimeApprovalBaseHours,
  formatDurationMinutesLabel,
  overtimeApprovalRequiredError,
  segmentsTotalMinutes,
  uploadClockInOvertimeApprovalDocument,
} from '../../lib/employeeClockInOvertimeApproval';
import HolidayEntryWarningModal from './HolidayEntryWarningModal';
import HolidayDateNote from './HolidayDateNote';
import ProfileBottomSheetModal from './ProfileBottomSheetModal';
import ClockInOvertimeApprovalBox, {
  clockInSegmentsExceedOvertimeBase,
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

let nextTempId = -1000;
function allocTempId(): number {
  nextTempId -= 1;
  return nextTempId;
}

function newFormRow(
  dateKey: string,
  clockInTime = '13:00',
  clockOutTime = '17:00',
  locationId: number | null = null,
): SessionFormRow {
  return {
    id: allocTempId(),
    date: dateKey,
    clockInTime,
    clockOutTime,
    notes: '',
    clockInLocationId: locationId,
    clockOutLocationId: locationId,
  };
}

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
  const [overtimeFile, setOvertimeFile] = useState<File | null>(null);
  /**
   * The employee's contracted base hours, past which a session needs Michael's approval.
   *
   * Seeded with the company default so the first render has a threshold rather than treating the
   * employee as having none, then replaced once the contract loads.
   */
  const [baseHours, setBaseHours] = useState(DEFAULT_OVERTIME_APPROVAL_BASE_HOURS);

  const originalSessionIds = useMemo(
    () => new Set(sessions.filter((s) => s.id > 0).map((s) => s.id)),
    [sessions],
  );

  useEffect(() => {
    if (!isOpen) return;
    const rows = sessions.map((s) => clockInSessionToFormValues(s));
    setFormRows(
      rows.length > 0
        ? rows
        : [newFormRow(dateKey, '09:00', '17:00')],
    );
    setOvertimeFile(null);
    void fetchActiveClockInLocations().then(setWorkplaces);
    void fetchOvertimeApprovalBaseHours(employeeId).then(setBaseHours);
  }, [isOpen, sessions, employeeId, dateKey]);

  const updateRow = (id: number, patch: Partial<SessionFormRow>) => {
    setFormRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
  };

  const addPeriod = () => {
    setFormRows((prev) => {
      const last = prev[prev.length - 1];
      const locationId = last?.clockInLocationId ?? last?.clockOutLocationId ?? null;
      return [...prev, newFormRow(dateKey, '13:00', '17:00', locationId)];
    });
  };

  const removePeriod = (id: number) => {
    setFormRows((prev) => (prev.length > 1 ? prev.filter((row) => row.id !== id) : prev));
  };

  const existingOvertime = useMemo(() => {
    const withPath = sessions.find((s) => s.overtime_approval_storage_path?.trim());
    if (!withPath?.overtime_approval_storage_path?.trim()) return null;
    return {
      path: withPath.overtime_approval_storage_path.trim(),
      fileName: withPath.overtime_approval_file_name || 'Overtime approval screenshot',
      mimeType: withPath.overtime_approval_mime_type || null,
    };
  }, [sessions]);

  const segments: ManualClockInSegment[] = useMemo(
    () =>
      formRows.map((row) => ({
        clockInTime: row.clockInTime,
        clockOutTime: row.clockOutTime,
        workplaceLocationId: row.clockInLocationId ?? row.clockOutLocationId ?? null,
      })),
    [formRows],
  );

  const dayMinutes = segmentsTotalMinutes(segments);
  const exceedsOvertimeBase = clockInSegmentsExceedOvertimeBase(segments, 0, baseHours);
  const overtimeDocMissing =
    exceedsOvertimeBase && !overtimeFile && !existingOvertime?.path;

  const rowWorkplace = (row: SessionFormRow): ClockInLocationOption | null => {
    const locationId = row.clockInLocationId ?? row.clockOutLocationId ?? null;
    return workplaces.find((wp) => wp.id === locationId) ?? null;
  };

  const rowMissingRamatGanNotes = (row: SessionFormRow): boolean => {
    const workplace = rowWorkplace(row);
    if (!workplace || !isRamatGanClockInLocation(workplace)) return false;
    return !row.notes?.trim();
  };

  const workplaceMissing =
    workplaces.length > 0
    && formRows.some((row) => (row.clockInLocationId ?? row.clockOutLocationId ?? null) == null);

  const resolveOvertimeApproval = async () => {
    if (!exceedsOvertimeBase) return null;
    if (overtimeFile) {
      return uploadClockInOvertimeApprovalDocument(employeeId, overtimeFile);
    }
    if (existingOvertime?.path) {
      return {
        storagePath: existingOvertime.path,
        fileName: existingOvertime.fileName,
        mimeType: existingOvertime.mimeType || 'image/jpeg',
      };
    }
    throw overtimeApprovalRequiredError(baseHours);
  };

  const performSave = async () => {
    if (formRows.length === 0) return;

    setSaving(true);
    try {
      const overtimeApproval = await resolveOvertimeApproval();

      await assertManualDurationAllowed({
        employeeId,
        totalDayMinutes: dayMinutes,
        overtimeApprovalStoragePath: overtimeApproval?.storagePath,
      });

      if (createFromAutoFill) {
        for (const row of formRows) {
          const locationId = row.clockInLocationId ?? row.clockOutLocationId ?? null;
          await insertManualClockInRecord({
            employeeId,
            userId,
            date: dateKey,
            clockInTime: row.clockInTime,
            clockOutTime: row.clockOutTime,
            notes: row.notes,
            clockInLocationId: locationId,
            clockOutLocationId: locationId,
            overtimeApproval,
            approveAutomatically: !exceedsOvertimeBase,
            skipDurationCheck: true,
          });
        }
      } else {
        const keptIds = new Set(formRows.filter((r) => r.id > 0).map((r) => r.id));
        const toDelete = [...originalSessionIds].filter((id) => !keptIds.has(id));
        if (toDelete.length > 0) {
          await deleteClockInSessions(toDelete);
        }

        const toUpdate: ClockInSessionUpdate[] = [];
        const toInsert: SessionFormRow[] = [];

        for (const row of formRows) {
          const locationId = row.clockInLocationId ?? row.clockOutLocationId ?? null;
          const payload: ClockInSessionUpdate = {
            ...row,
            date: dateKey,
            clockInLocationId: locationId,
            clockOutLocationId: locationId,
            overtimeApproval,
            skipDurationCheck: true,
            dayExceedsOvertimeBase: exceedsOvertimeBase,
          };
          if (row.id > 0 && originalSessionIds.has(row.id)) {
            toUpdate.push(payload);
          } else {
            toInsert.push(payload);
          }
        }

        if (toUpdate.length > 0) {
          await updateClockInSessions(toUpdate);
        }

        for (const row of toInsert) {
          await insertManualClockInRecord({
            employeeId,
            userId,
            date: dateKey,
            clockInTime: row.clockInTime,
            clockOutTime: row.clockOutTime,
            notes: row.notes,
            clockInLocationId: row.clockInLocationId,
            clockOutLocationId: row.clockOutLocationId,
            overtimeApproval,
            approveAutomatically: !exceedsOvertimeBase,
            skipDurationCheck: true,
          });
        }
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

  const handleSave = async () => {
    if (formRows.length === 0) return;

    if (formRows.some((row) => !row.clockInTime || !row.clockOutTime)) {
      toast.error('Please fill in every clock in and clock out');
      return;
    }
    if (workplaceMissing) {
      toast.error('Please choose a workplace for every clock-in / out');
      return;
    }
    if (formRows.some(rowMissingRamatGanNotes)) {
      toast.error('Please add notes for Ramat Gan');
      return;
    }
    if (overtimeDocMissing) {
      toast.error(overtimeApprovalRequiredError(baseHours).message);
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
  const submitBlocked =
    saving
    || formRows.length === 0
    || workplaceMissing
    || formRows.some(rowMissingRamatGanNotes)
    || overtimeDocMissing;

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
              className={overtimeDocMissing || workplaceMissing ? 'tooltip tooltip-top' : ''}
              data-tip={
                overtimeDocMissing
                  ? 'Upload the overtime approval screenshot before submitting.'
                  : workplaceMissing
                    ? 'Choose a workplace for every period first'
                    : undefined
              }
            >
              <button
                type="button"
                className="btn btn-primary h-10 min-h-10 rounded-full px-8"
                onClick={() => void handleSave()}
                disabled={submitBlocked}
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

          <div className="space-y-2">
            <span className="label-text font-medium text-gray-600">Clock-in / out periods</span>
            <div className="space-y-3">
              {formRows.map((row, index) => {
                const ramatGanRow = (() => {
                  const wp = rowWorkplace(row);
                  return wp != null && isRamatGanClockInLocation(wp);
                })();
                return (
                  <div
                    key={row.id}
                    className="rounded-xl border border-base-200 bg-base-50/60 p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-base-content/50">
                        Period{formRows.length > 1 ? ` ${index + 1}` : ''}
                      </span>
                      {formRows.length > 1 && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs btn-square text-error shrink-0"
                          onClick={() => removePeriod(row.id)}
                          disabled={saving}
                          title="Remove period"
                        >
                          <TrashIcon className="w-4 h-4" />
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <label className="form-control min-w-0">
                        <span className="label-text text-xs text-base-content/55 mb-1">Clock in</span>
                        <input
                          type="time"
                          className="input input-bordered w-full"
                          value={row.clockInTime}
                          onChange={(e) => updateRow(row.id, { clockInTime: e.target.value })}
                          disabled={saving}
                        />
                      </label>
                      <label className="form-control min-w-0">
                        <span className="label-text text-xs text-base-content/55 mb-1">Clock out</span>
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
                        <span className="label-text text-xs text-base-content/55 mb-1">Workplace</span>
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

                    <label className="form-control w-full">
                      <span className="label-text text-xs text-base-content/55 mb-1">
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

            <button
              type="button"
              className="btn btn-outline btn-sm gap-1"
              onClick={addPeriod}
              disabled={saving}
            >
              <PlusIcon className="w-4 h-4" />
              Add clock-in / out
            </button>

            {formRows.length > 1 && (
              <p className="text-xs text-base-content/55">
                Day total: {formatDurationMinutesLabel(dayMinutes)}
                {exceedsOvertimeBase ? ` · over your ${baseHours}h standard day` : ''}
              </p>
            )}
          </div>

          {exceedsOvertimeBase && (
            <ClockInOvertimeApprovalBox
              segments={segments}
              dateKeys={[dateKey]}
              notes={formRows.map((r) => r.notes?.trim()).filter(Boolean).join('\n')}
              baseHours={baseHours}
              file={overtimeFile}
              onFileChange={setOvertimeFile}
              existingFileName={existingOvertime?.path ? existingOvertime.fileName : null}
              disabled={saving}
            />
          )}
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
