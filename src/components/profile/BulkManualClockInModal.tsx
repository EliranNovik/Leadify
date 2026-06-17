import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import {
  fetchActiveClockInLocations,
  fetchEmployeeWorksFromHome,
  isHomeClockInLocation,
  type ClockInLocationOption,
} from '../../lib/clockInLocations';
import { insertManualClockInRecords } from '../../lib/employeeClockInManual';
import { formatWorkingHoursDateLabel, formatWorkingHoursWeekday } from '../../lib/employeeClockInFormat';
import { getHolidayWarningsForDates } from '../../lib/israeliJewishHolidays';
import type { HolidayDateWarning } from '../../lib/israeliJewishHolidays';
import HolidayEntryWarningModal from './HolidayEntryWarningModal';

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
  const [clockInLocationId, setClockInLocationId] = useState<number | ''>('');
  const [clockOutLocationId, setClockOutLocationId] = useState<number | ''>('');
  const [saving, setSaving] = useState(false);
  const [holidayWarnings, setHolidayWarnings] = useState<HolidayDateWarning[]>([]);
  const [showHolidayWarning, setShowHolidayWarning] = useState(false);

  const datesToSave = useMemo(() => sortDates(selectedDateKeys), [selectedDateKeys]);

  useEffect(() => {
    if (!isOpen) return;
    setClockInTime('09:00');
    setClockOutTime('17:00');
    setClockInLocationId('');
    setClockOutLocationId('');
    void Promise.all([fetchActiveClockInLocations(), fetchEmployeeWorksFromHome(employeeId)]).then(
      ([locations, wfh]) => {
        setWorkplaces(locations);
        setWorksFromHome(wfh);
      },
    );
  }, [isOpen, employeeId]);

  const selectedIn = useMemo(
    () => workplaces.find((wp) => wp.id === (clockInLocationId === '' ? null : clockInLocationId)) ?? null,
    [workplaces, clockInLocationId],
  );
  const selectedOut = useMemo(
    () => workplaces.find((wp) => wp.id === (clockOutLocationId === '' ? null : clockOutLocationId)) ?? null,
    [workplaces, clockOutLocationId],
  );
  const homeNeedsApproval =
    (selectedIn != null && isHomeClockInLocation(selectedIn) && !worksFromHome)
    || (selectedOut != null && isHomeClockInLocation(selectedOut) && !worksFromHome);

  const performSave = async () => {
    setSaving(true);
    try {
      const wfhNote = homeNeedsApproval
        ? 'Clock-in from Home — waiting for admin approval (auto-enables Works From Home when approved)'
        : '';

      const count = await insertManualClockInRecords({
        employeeId,
        userId,
        dates: datesToSave,
        clockInTime,
        clockOutTime,
        notes: wfhNote,
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

    const warnings = await getHolidayWarningsForDates(datesToSave);
    if (warnings.length > 0) {
      setHolidayWarnings(warnings);
      setShowHolidayWarning(true);
      return;
    }

    await performSave();
  };

  if (!isOpen || typeof window === 'undefined') return null;

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
              <h3 className="text-lg font-semibold text-gray-900">Add multiple clock-in / out</h3>
              <button type="button" className="btn btn-ghost btn-sm btn-circle" onClick={onClose}>
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
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

              {homeNeedsApproval && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  Home needs approval before you can use it.
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 px-5 py-4 border-t border-base-200">
              <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleSave()}
                disabled={saving || datesToSave.length === 0}
              >
                {saving ? (
                  <span className="loading loading-spinner loading-sm" />
                ) : (
                  `Save${datesToSave.length > 0 ? ` (${datesToSave.length})` : ''}`
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

export default BulkManualClockInModal;
