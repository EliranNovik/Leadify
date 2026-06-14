import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon } from '@heroicons/react/24/outline';
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

  if (!isOpen || typeof window === 'undefined') return null;

  const updateRow = (id: number, patch: Partial<SessionFormRow>) => {
    setFormRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
  };

  const performSave = async () => {
    if (formRows.length === 0) return;

    setSaving(true);
    try {
      await updateClockInSessions(formRows);
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
    {createPortal(
    <div
      className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-base-200">
          <h3 className="text-lg font-semibold text-gray-900">Edit clock-in / out</h3>
          <button type="button" className="btn btn-ghost btn-sm btn-circle" onClick={onClose}>
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="form-control w-full">
                      <span className="label-text font-medium mb-1">Workplace (in)</span>
                      <select
                        className="select select-bordered w-full"
                        value={row.clockInLocationId ?? ''}
                        onChange={(e) =>
                          updateRow(row.id, {
                            clockInLocationId: e.target.value ? Number(e.target.value) : null,
                          })
                        }
                        disabled={saving}
                      >
                        <option value="">—</option>
                        {workplaces.map((wp) => (
                          <option key={wp.id} value={wp.id}>{wp.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="form-control w-full">
                      <span className="label-text font-medium mb-1">Workplace (out)</span>
                      <select
                        className="select select-bordered w-full"
                        value={row.clockOutLocationId ?? ''}
                        onChange={(e) =>
                          updateRow(row.id, {
                            clockOutLocationId: e.target.value ? Number(e.target.value) : null,
                          })
                        }
                        disabled={saving}
                      >
                        <option value="">—</option>
                        {workplaces.map((wp) => (
                          <option key={wp.id} value={wp.id}>{wp.name}</option>
                        ))}
                      </select>
                    </label>
                  </div>
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

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-base-200">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleSave()}
            disabled={saving || formRows.length === 0}
          >
            {saving ? <span className="loading loading-spinner loading-sm" /> : 'Save'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
    )}
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
