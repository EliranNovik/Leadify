import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { PlusIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import { fetchActiveClockInLocations, type ClockInLocationOption } from '../../lib/clockInLocations';
import { insertManualClockInRecords } from '../../lib/employeeClockInManual';
import { toDateInputValue } from '../../lib/employeeClockInFormat';
import { getHolidayWarningsForDates } from '../../lib/israeliJewishHolidays';
import type { HolidayDateWarning } from '../../lib/israeliJewishHolidays';
import HolidayEntryWarningModal from './HolidayEntryWarningModal';
import HolidayDateNote from './HolidayDateNote';

interface ManualClockInModalProps {
  isOpen: boolean;
  employeeId: number;
  userId: string;
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
  onClose,
  onSaved,
}) => {
  const [dateRows, setDateRows] = useState<DatePickerRow[]>([]);
  const [clockInTime, setClockInTime] = useState('09:00');
  const [clockOutTime, setClockOutTime] = useState('17:00');
  const [notes, setNotes] = useState('');
  const [workplaces, setWorkplaces] = useState<ClockInLocationOption[]>([]);
  const [clockInLocationId, setClockInLocationId] = useState<number | ''>('');
  const [clockOutLocationId, setClockOutLocationId] = useState<number | ''>('');
  const [saving, setSaving] = useState(false);
  const [holidayWarnings, setHolidayWarnings] = useState<HolidayDateWarning[]>([]);
  const [showHolidayWarning, setShowHolidayWarning] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const t = toDateInputValue(new Date());
    setDateRows([newDateRow(t)]);
    setClockInTime('09:00');
    setClockOutTime('17:00');
    setNotes('');
    setClockInLocationId('');
    setClockOutLocationId('');
    void fetchActiveClockInLocations().then(setWorkplaces);
  }, [isOpen]);

  const datesToSave = useMemo(() => {
    const filled = dateRows.map((row) => row.value).filter(Boolean);
    return sortDates(filled);
  }, [dateRows]);

  if (!isOpen || typeof window === 'undefined') return null;

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
      const count = await insertManualClockInRecords({
        employeeId,
        userId,
        dates: datesToSave,
        clockInTime,
        clockOutTime,
        notes,
        clockInLocationId: clockInLocationId === '' ? null : clockInLocationId,
        clockOutLocationId: clockOutLocationId === '' ? null : clockOutLocationId,
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

  return (
    <>
      {createPortal(
    <div
      className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-base-200">
          <h3 className="text-lg font-semibold text-gray-900">Add clock-in / out</h3>
          <button type="button" className="btn btn-ghost btn-sm btn-circle" onClick={onClose}>
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="space-y-2">
            <span className="label-text font-medium">Dates</span>
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
              <span className="label-text font-medium mb-1">Clock in</span>
              <input
                type="time"
                className="input input-bordered w-full"
                value={clockInTime}
                onChange={(e) => setClockInTime(e.target.value)}
                disabled={saving}
              />
            </label>
            <label className="form-control w-full">
              <span className="label-text font-medium mb-1">Clock out</span>
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="form-control w-full">
                <span className="label-text font-medium mb-1">Workplace (in)</span>
                <select
                  className="select select-bordered w-full"
                  value={clockInLocationId}
                  onChange={(e) =>
                    setClockInLocationId(e.target.value ? Number(e.target.value) : '')
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
                  value={clockOutLocationId}
                  onChange={(e) =>
                    setClockOutLocationId(e.target.value ? Number(e.target.value) : '')
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
              className="textarea textarea-bordered w-full min-h-[80px]"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes (applied to each selected date)"
              disabled={saving}
            />
          </label>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-base-200">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleSave()}
            disabled={saving || datesToSave.length === 0 || hasDuplicateDates}
          >
            {saving ? (
              <span className="loading loading-spinner loading-sm" />
            ) : (
              `Save${datesToSave.length > 1 ? ` (${datesToSave.length})` : ''}`
            )}
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

export default ManualClockInModal;
