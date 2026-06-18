import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import {
  clockInSessionToFormValues,
  updateClockInSessions,
  type ClockInSessionUpdate,
} from '../../lib/employeeClockInManual';
import { formatClockTime } from '../../lib/employeeClockInFormat';
import { unavailabilityDateLabel } from '../../lib/employeeUnavailabilities';
import type { ClockInDaySession } from './ClockInDayEditModal';

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

  if (!isOpen || typeof window === 'undefined') return null;

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

  return createPortal(
    <div
      className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-base-200">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Notes</h3>
            <p className="text-sm text-gray-500 mt-0.5">{unavailabilityDateLabel(dateKey)}</p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm btn-circle" onClick={onClose}>
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
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

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-base-200">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            {readOnly ? 'Close' : 'Cancel'}
          </button>
          {!readOnly && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handleSave()}
              disabled={saving || formRows.length === 0}
            >
              {saving ? 'Saving…' : 'Save notes'}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default ClockInDayNotesModal;
