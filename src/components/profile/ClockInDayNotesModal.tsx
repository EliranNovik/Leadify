import React, { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import {
  clockInSessionToFormValues,
  updateClockInSessions,
  type ClockInSessionUpdate,
} from '../../lib/employeeClockInManual';
import { formatClockTime } from '../../lib/employeeClockInFormat';
import { unavailabilityDateLabel } from '../../lib/employeeUnavailabilities';
import type { ClockInDaySession } from './ClockInDayEditModal';
import ProfileBottomSheetModal from './ProfileBottomSheetModal';
import { ModalActionFooter } from '../EditFieldModal';

interface ClockInDayNotesModalProps {
  isOpen: boolean;
  dateKey: string;
  sessions: ClockInDaySession[];
  readOnly?: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const ClockInDayNotesModal: React.FC<ClockInDayNotesModalProps> = ({
  isOpen,
  dateKey,
  sessions,
  readOnly = false,
  onClose,
  onSaved,
}) => {
  const [formRows, setFormRows] = useState<ClockInSessionUpdate[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setFormRows(sessions.map((s) => clockInSessionToFormValues(s)));
  }, [isOpen, sessions]);

  const updateNotes = (id: number, notes: string) => {
    setFormRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, notes } : row)),
    );
  };

  const handleSave = async () => {
    if (formRows.length === 0) return;

    setSaving(true);
    try {
      await updateClockInSessions(formRows);
      toast.success('Notes updated');
      onSaved();
      onClose();
    } catch (err) {
      console.error('ClockInDayNotesModal save:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to update notes');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ProfileBottomSheetModal
      open={isOpen}
      onClose={onClose}
      title="Notes"
      subtitle={unavailabilityDateLabel(dateKey)}
      footer={
        readOnly ? (
          <div className="flex w-full">
            <button
              type="button"
              className="btn btn-primary flex-1 max-md:min-h-12"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        ) : (
          <ModalActionFooter
            onCancel={onClose}
            onConfirm={() => void handleSave()}
            saving={saving}
            disabled={formRows.length === 0}
            cancelLabel="Cancel"
            confirmLabel="Save notes"
          />
        )
      }
    >
      <div className="space-y-4">
        {formRows.map((row, index) => {
          const session = sessions.find((s) => s.id === row.id);
          const clockInLabel = session ? formatClockTime(session.clock_in_time) : '';
          const clockOutLabel = session?.clock_out_time
            ? formatClockTime(session.clock_out_time)
            : 'Active';

          return (
            <label key={row.id} className="form-control w-full">
              <span className="label-text font-medium mb-1.5">
                {formRows.length > 1
                  ? `Session ${index + 1} (${clockInLabel} – ${clockOutLabel})`
                  : 'Note'}
              </span>
              {readOnly ? (
                <div className="rounded-xl border border-base-200 bg-base-50 px-4 py-3 text-base text-gray-700 whitespace-pre-wrap min-h-[4.5rem]">
                  {row.notes?.trim() || '—'}
                </div>
              ) : (
                <textarea
                  className="textarea textarea-bordered w-full min-h-[6rem] text-base"
                  value={row.notes ?? ''}
                  onChange={(e) => updateNotes(row.id, e.target.value)}
                  placeholder="Add a note…"
                />
              )}
            </label>
          );
        })}
      </div>
    </ProfileBottomSheetModal>
  );
};

export default ClockInDayNotesModal;
