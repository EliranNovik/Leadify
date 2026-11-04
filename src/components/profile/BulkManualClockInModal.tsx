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
import {
  insertManualClockInRecords,
  type ManualClockInSegment,
} from '../../lib/employeeClockInManual';
import { formatWorkingHoursDateLabel, formatWorkingHoursWeekday } from '../../lib/employeeClockInFormat';
import { getHolidayWarningsForDates } from '../../lib/israeliJewishHolidays';
import type { HolidayDateWarning } from '../../lib/israeliJewishHolidays';
import {
  DEFAULT_OVERTIME_APPROVAL_BASE_HOURS,
  fetchDayOvertimeApprovals,
  fetchOvertimeApprovalBaseHours,
  formatDurationMinutesLabel,
  overtimeApprovalRequiredError,
  segmentsTotalMinutes,
  totalExistingDayMinutes,
  uploadClockInOvertimeApprovalDocument,
} from '../../lib/employeeClockInOvertimeApproval';
import HolidayEntryWarningModal from './HolidayEntryWarningModal';
import ProfileBottomSheetModal from './ProfileBottomSheetModal';
import ClockInOvertimeApprovalBox, {
  clockInSegmentsExceedOvertimeBase,
} from './ClockInOvertimeApprovalBox';

function sortDates(dates: Iterable<string>): string[] {
  return [...new Set(dates)].sort();
}

type SegmentRow = ManualClockInSegment & { id: string };

function newSegmentRow(
  clockInTime = '09:00',
  clockOutTime = '17:00',
  workplaceLocationId: number | null = null,
): SegmentRow {
  return { id: crypto.randomUUID(), clockInTime, clockOutTime, workplaceLocationId };
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
  const [segmentRows, setSegmentRows] = useState<SegmentRow[]>([newSegmentRow()]);
  const [workplaces, setWorkplaces] = useState<ClockInLocationOption[]>([]);
  const [worksFromHome, setWorksFromHome] = useState(false);
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
  const [notes, setNotes] = useState('');
  const [existingMinutesByDate, setExistingMinutesByDate] = useState<Record<string, number>>({});

  const datesToSave = useMemo(() => sortDates(selectedDateKeys), [selectedDateKeys]);

  const segments: ManualClockInSegment[] = useMemo(
    () =>
      segmentRows.map(({ clockInTime, clockOutTime, workplaceLocationId }) => ({
        clockInTime,
        clockOutTime,
        workplaceLocationId: workplaceLocationId ?? null,
      })),
    [segmentRows],
  );

  useEffect(() => {
    if (!isOpen) return;
    setSegmentRows([newSegmentRow()]);
    setOvertimeFile(null);
    setNotes('');
    setExistingMinutesByDate({});
    void Promise.all([
      fetchActiveClockInLocations(),
      fetchEmployeeWorksFromHome(employeeId),
      fetchOvertimeApprovalBaseHours(employeeId),
    ]).then(([locations, wfh, hours]) => {
      setWorkplaces(locations);
      setWorksFromHome(wfh);
      setBaseHours(hours);
    });
  }, [isOpen, employeeId]);

  useEffect(() => {
    if (!isOpen || datesToSave.length === 0) {
      setExistingMinutesByDate({});
      return;
    }
    let cancelled = false;
    void Promise.all(
      datesToSave.map(async (date) => {
        const rows = await fetchDayOvertimeApprovals(employeeId, date);
        return [date, totalExistingDayMinutes(rows)] as const;
      }),
    )
      .then((entries) => {
        if (!cancelled) setExistingMinutesByDate(Object.fromEntries(entries));
      })
      .catch((err) => {
        console.error('BulkManualClockInModal existing hours:', err);
        if (!cancelled) setExistingMinutesByDate({});
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, employeeId, datesToSave.join(',')]);

  const selectedWorkplaces = useMemo(
    () =>
      segments
        .map((seg) =>
          workplaces.find((wp) => wp.id === (seg.workplaceLocationId ?? null)) ?? null,
        )
        .filter((wp): wp is ClockInLocationOption => wp != null),
    [segments, workplaces],
  );
  const homeNeedsApproval = selectedWorkplaces.some(
    (wp) => isHomeClockInLocation(wp) && !worksFromHome,
  );
  const ramatGanSelected = selectedWorkplaces.some((wp) => isRamatGanClockInLocation(wp));

  const maxExistingMinutes = useMemo(
    () =>
      datesToSave.reduce((max, date) => Math.max(max, existingMinutesByDate[date] || 0), 0),
    [datesToSave, existingMinutesByDate],
  );

  const exceedsOvertimeBase = useMemo(
    () =>
      datesToSave.some((date) =>
        clockInSegmentsExceedOvertimeBase(segments, existingMinutesByDate[date] || 0, baseHours),
      ),
    [datesToSave, segments, existingMinutesByDate, baseHours],
  );

  const newMinutes = segmentsTotalMinutes(segments);

  const performSave = async () => {
    setSaving(true);
    try {
      const wfhNote = homeNeedsApproval
        ? 'Clock-in from Home — waiting for admin approval (auto-enables Works From Home when approved)'
        : '';
      const mergedNotes = [notes?.trim(), wfhNote].filter(Boolean).join('\n');

      let overtimeApproval = null;
      if (exceedsOvertimeBase) {
        if (!overtimeFile) throw overtimeApprovalRequiredError(baseHours);
        overtimeApproval = await uploadClockInOvertimeApprovalDocument(employeeId, overtimeFile);
      }
      const count = await insertManualClockInRecords({
        employeeId,
        userId,
        dates: datesToSave,
        segments,
        notes: mergedNotes,
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
    if (segments.some((seg) => !seg.clockInTime || !seg.clockOutTime)) {
      toast.error('Please fill in every clock in and clock out');
      return;
    }
    if (workplaces.length > 0 && segments.some((seg) => seg.workplaceLocationId == null)) {
      toast.error('Please choose a workplace for every clock-in / out');
      return;
    }
    if (ramatGanSelected && !notes.trim()) {
      toast.error('Please add notes for Ramat Gan');
      return;
    }
    if (exceedsOvertimeBase && !overtimeFile) {
      toast.error(overtimeApprovalRequiredError(baseHours).message);
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

  const workplaceMissing =
    workplaces.length > 0 && segments.some((seg) => seg.workplaceLocationId == null);
  const notesMissing = ramatGanSelected && !notes.trim();
  const overtimeDocMissing = exceedsOvertimeBase && !overtimeFile;
  const submitDisabled = saving || datesToSave.length === 0 || workplaceMissing || notesMissing || overtimeDocMissing;
  const submitBlockedReason = workplaceMissing
    ? 'Choose a workplace for every period first'
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
        desktopLayout="drawer-right"
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

          <div className="space-y-2">
            <span className="label-text font-medium text-gray-600">Clock-in / out periods</span>
            <div className="space-y-3">
              {segmentRows.map((row, index) => (
                <div
                  key={row.id}
                  className="rounded-xl border border-base-200 bg-base-50/60 p-3 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-base-content/50">
                      Period{segmentRows.length > 1 ? ` ${index + 1}` : ''}
                    </span>
                    {segmentRows.length > 1 && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs btn-square text-error shrink-0"
                        onClick={() =>
                          setSegmentRows((prev) =>
                            prev.length > 1 ? prev.filter((s) => s.id !== row.id) : prev,
                          )
                        }
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
                        onChange={(e) =>
                          setSegmentRows((prev) =>
                            prev.map((s) =>
                              s.id === row.id ? { ...s, clockInTime: e.target.value } : s,
                            ),
                          )
                        }
                        disabled={saving}
                      />
                    </label>
                    <label className="form-control min-w-0">
                      <span className="label-text text-xs text-base-content/55 mb-1">Clock out</span>
                      <input
                        type="time"
                        className="input input-bordered w-full"
                        value={row.clockOutTime}
                        onChange={(e) =>
                          setSegmentRows((prev) =>
                            prev.map((s) =>
                              s.id === row.id ? { ...s, clockOutTime: e.target.value } : s,
                            ),
                          )
                        }
                        disabled={saving}
                      />
                    </label>
                  </div>
                  {workplaces.length > 0 && (
                    <label className="form-control w-full">
                      <span className="label-text text-xs text-base-content/55 mb-1">Workplace</span>
                      <select
                        className="select select-bordered w-full"
                        value={row.workplaceLocationId ?? ''}
                        onChange={(e) =>
                          setSegmentRows((prev) =>
                            prev.map((s) =>
                              s.id === row.id
                                ? {
                                    ...s,
                                    workplaceLocationId: e.target.value
                                      ? Number(e.target.value)
                                      : null,
                                  }
                                : s,
                            ),
                          )
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
                </div>
              ))}
            </div>
            <button
              type="button"
              className="btn btn-outline btn-sm gap-1"
              onClick={() =>
                setSegmentRows((prev) => {
                  const lastWorkplace = prev[prev.length - 1]?.workplaceLocationId ?? null;
                  return [...prev, newSegmentRow('13:00', '17:00', lastWorkplace)];
                })
              }
              disabled={saving}
            >
              <PlusIcon className="w-4 h-4" />
              Add clock-in / out
            </button>
            {(maxExistingMinutes > 0 || segmentRows.length > 1) && (
              <p className="text-xs text-base-content/55">
                New periods: {formatDurationMinutesLabel(newMinutes)}
                {maxExistingMinutes > 0
                  ? ` · Already on day: ${formatDurationMinutesLabel(maxExistingMinutes)} · Combined: ${formatDurationMinutesLabel(maxExistingMinutes + newMinutes)}`
                  : ''}
              </p>
            )}
          </div>

          {exceedsOvertimeBase && (
            <ClockInOvertimeApprovalBox
              segments={segments}
              existingMinutes={maxExistingMinutes}
              dateKeys={datesToSave}
              notes={notes}
              baseHours={baseHours}
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
