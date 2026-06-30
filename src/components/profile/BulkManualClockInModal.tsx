import React, { useEffect, useMemo, useState } from 'react';
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
import ProfileBottomSheetModal from './ProfileBottomSheetModal';

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

  const datesToSave = useMemo(() => sortDates(selectedDateKeys), [selectedDateKeys]);

  useEffect(() => {
    if (!isOpen) return;
    setClockInTime('09:00');
    setClockOutTime('17:00');
    setWorkplaceLocationId('');
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

  const performSave = async () => {
    setSaving(true);
    try {
      const wfhNote = homeNeedsApproval
        ? 'Clock-in from Home — waiting for admin approval (auto-enables Works From Home when approved)'
        : '';

      const locationId = workplaceLocationId === '' ? null : workplaceLocationId;
      const count = await insertManualClockInRecords({
        employeeId,
        userId,
        dates: datesToSave,
        clockInTime,
        clockOutTime,
        notes: wfhNote,
        clockInLocationId: locationId,
        clockOutLocationId: locationId,
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

  if (!isOpen) return null;

  return (
    <>
      <ProfileBottomSheetModal
        open={isOpen}
        onClose={onClose}
        title="Add multiple clock-in / out"
        onSave={() => void handleSave()}
        saving={saving}
        saveDisabled={datesToSave.length === 0}
        saveLabel={`Save${datesToSave.length > 0 ? ` (${datesToSave.length})` : ''}`}
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
            <label className="form-control w-full">
              <span className="label-text font-medium mb-1">Workplace</span>
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

          {homeNeedsApproval && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Home needs approval before you can use it.
            </div>
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

export default BulkManualClockInModal;
