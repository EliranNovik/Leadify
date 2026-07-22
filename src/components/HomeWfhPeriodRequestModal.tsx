import React, { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { toDateInputValue } from '../lib/employeeClockInFormat';
import {
  insertWfhPeriodRequest,
} from '../lib/employeeWfhPeriodRequests';
import ProfileBottomSheetModal, {
  PROFILE_STACKED_MODAL_Z_INDEX,
} from './profile/ProfileBottomSheetModal';

type HomeWfhPeriodRequestModalProps = {
  isOpen: boolean;
  employeeId: number;
  userId: string;
  onClose: () => void;
  onSubmitted: () => void;
};

const HomeWfhPeriodRequestModal: React.FC<HomeWfhPeriodRequestModalProps> = ({
  isOpen,
  employeeId,
  userId,
  onClose,
  onSubmitted,
}) => {
  const today = toDateInputValue(new Date());
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const t = toDateInputValue(new Date());
    setStartDate(t);
    setEndDate(t);
    setNotes('');
  }, [isOpen]);

  const invalidRange = !startDate || !endDate || endDate < startDate;

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (invalidRange) {
      toast.error('Choose a valid date range');
      return;
    }
    setSaving(true);
    try {
      await insertWfhPeriodRequest({
        employeeId,
        userId,
        startDate,
        endDate,
        notes,
      });
      toast.success('Work-from-home request sent for approval');
      onSubmitted();
      onClose();
    } catch (err: unknown) {
      console.error('HomeWfhPeriodRequestModal:', err);
      const message = err instanceof Error ? err.message : 'Failed to send request';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ProfileBottomSheetModal
      open={isOpen}
      onClose={onClose}
      title="Request work from home"
      subtitle="Pick a day or a period. After approval you can clock in from Home for those dates only."
      onSave={() => void handleSubmit()}
      saving={saving}
      saveDisabled={invalidRange}
      saveLabel="Send for approval"
      zIndex={PROFILE_STACKED_MODAL_Z_INDEX}
      mobileFullHeight
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="form-control w-full">
            <span className="label-text text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">
              From
            </span>
            <input
              type="date"
              className="input input-bordered w-full"
              value={startDate}
              min={today}
              disabled={saving}
              onChange={(e) => {
                const next = e.target.value;
                setStartDate(next);
                if (endDate < next) setEndDate(next);
              }}
            />
          </label>
          <label className="form-control w-full">
            <span className="label-text text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">
              To
            </span>
            <input
              type="date"
              className="input input-bordered w-full"
              value={endDate}
              min={startDate || today}
              disabled={saving}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </label>
        </div>

        {invalidRange ? (
          <div className="rounded-xl px-3 py-2.5 text-sm bg-red-50 text-red-700">
            End date must be on or after start date.
          </div>
        ) : null}

        <label className="form-control w-full">
          <span className="label-text text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">
            Note (optional)
          </span>
          <textarea
            className="textarea textarea-bordered w-full min-h-[5rem] text-sm"
            placeholder="Reason or details for your manager…"
            value={notes}
            disabled={saving}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
      </div>
    </ProfileBottomSheetModal>
  );
};

export default HomeWfhPeriodRequestModal;
