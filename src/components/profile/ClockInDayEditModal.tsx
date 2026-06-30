import React, { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { fetchActiveClockInLocations, type ClockInLocationOption } from '../../lib/clockInLocations';
import {
  clockInSessionToFormValues,
  updateClockInSessions,
  type ClockInSessionUpdate,
} from '../../lib/employeeClockInManual';
import { unavailabilityDateLabel } from '../../lib/employeeUnavailabilities';
import { getHolidayWarningsForDates } from '../../lib/israeliJewishHolidays';
import type { HolidayDateWarning } from '../../lib/israeliJewishHolidays';
import HolidayEntryWarningModal from './HolidayEntryWarningModal';
import HolidayDateNote from './HolidayDateNote';
import ProfileBottomSheetModal from './ProfileBottomSheetModal';

export type ClockInDaySession = {
  id: number;
  clock_in_time: string;
  clock_out_time: string | null;
  notes: string | null;
  clock_in_location_id?: number | null;
  clock_out_location_id?: number | null;
  manually?: boolean;
};

interface ClockInDayEditModalProps {
  isOpen: boolean;
  dateKey: string;
  sessions: ClockInDaySession[];
  onClose: () => void;
  onSaved: () => void;
}

type SessionFormRow = ClockInSessionUpdate;

const ClockInDayEditModal: React.FC<ClockInDayEditModalProps> = ({
  isOpen,
  dateKey,
  sessions,
  onClose,
  onSaved,
}) => {
  const [formRows, setFormRows] = useState<SessionFormRow[]>([]);
  const [workplaces, setWorkplaces] = useState<ClockInLocationOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [holidayWarnings, setHolidayWarnings] = useState<HolidayDateWarning[]>([]);
  const [showHolidayWarning, setShowHolidayWarning] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setFormRows(sessions.map((s) => clockInSessionToFormValues(s)));
    void fetchActiveClockInLocations().then(setWorkplaces);
  }, [isOpen, sessions]);

  const updateRow = (id: number, patch: Partial<SessionFormRow>) => {
    setFormRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
  };

  const performSave = async () => {
    if (formRows.length === 0) return;

    setSaving(true);
    try {
      const rowsToSave = formRows.map((row) => {
        const locationId = row.clockInLocationId ?? row.clockOutLocationId ?? null;
        return {
          ...row,
          clockInLocationId: locationId,
          clockOutLocationId: locationId,
        };
      });
      await updateClockInSessions(rowsToSave);
      toast.success('Clock-in entries updated');
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

    const warnings = await getHolidayWarningsForDates([dateKey]);
    if (warnings.length > 0) {
      setHolidayWarnings(warnings);
      setShowHolidayWarning(true);
      return;
    }

    await performSave();
  };

  const hadAutomatic = sessions.some((s) => !s.manually);

  return (
    <>
      <ProfileBottomSheetModal
        open={isOpen}
        onClose={onClose}
        title="Edit clock-in / out"
        onSave={() => void handleSave()}
        saving={saving}
        saveDisabled={formRows.length === 0}
        mobileFullHeight
      >
        <div className="space-y-4">
          <label className="form-control w-full">
            <span className="label-text font-medium mb-1">Date</span>
            <input
              type="text"
              className="input input-bordered w-full"
              value={unavailabilityDateLabel(dateKey)}
              readOnly
            />
          </label>

          <HolidayDateNote date={dateKey} />

          {hadAutomatic && (
            <p className="text-sm text-gray-500 bg-base-200/60 rounded-lg px-3 py-2">
              Saving will mark edited entries as <strong>Manual</strong>.
            </p>
          )}

          <div className="space-y-4">
            {formRows.map((row, index) => (
              <div
                key={row.id}
                className="rounded-lg border border-base-200 p-4 space-y-3"
              >
                {formRows.length > 1 && (
                  <p className="text-sm font-medium text-gray-700">Session {index + 1}</p>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <label className="form-control w-full">
                    <span className="label-text font-medium mb-1">Clock in</span>
                    <input
                      type="time"
                      className="input input-bordered w-full"
                      value={row.clockInTime}
                      onChange={(e) => updateRow(row.id, { clockInTime: e.target.value })}
                      disabled={saving}
                    />
                  </label>
                  <label className="form-control w-full">
                    <span className="label-text font-medium mb-1">Clock out</span>
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
                    <span className="label-text font-medium mb-1">Workplace</span>
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
                  <span className="label-text font-medium mb-1">Notes</span>
                  <textarea
                    className="textarea textarea-bordered w-full min-h-[64px]"
                    value={row.notes ?? ''}
                    onChange={(e) => updateRow(row.id, { notes: e.target.value })}
                    disabled={saving}
                  />
                </label>
              </div>
            ))}
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
