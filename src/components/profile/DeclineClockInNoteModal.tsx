import React, { useEffect, useState } from 'react';
import ProfileBottomSheetModal, { PROFILE_STACKED_MODAL_Z_INDEX } from './ProfileBottomSheetModal';
import { EDIT_FIELD_LABEL, EDIT_FIELD_TEXTAREA, ModalActionFooter } from '../EditFieldModal';

export type DeclineClockInNoteModalProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: (note: string | null) => void;
  saving?: boolean;
  entryLabel?: string;
  entryCount?: number;
};

export default function DeclineClockInNoteModal({
  open,
  onClose,
  onConfirm,
  saving = false,
  entryLabel,
  entryCount = 1,
}: DeclineClockInNoteModalProps) {
  const [note, setNote] = useState('');
  const trimmedNote = note.trim();
  const isBulk = entryCount > 1;

  useEffect(() => {
    if (!open) return;
    setNote('');
  }, [open]);

  const subtitle = isBulk
    ? `${entryCount} entries selected`
    : entryLabel ?? undefined;

  return (
    <ProfileBottomSheetModal
      open={open}
      onClose={onClose}
      title="Decline entry"
      subtitle={subtitle}
      zIndex={PROFILE_STACKED_MODAL_Z_INDEX}
      closeOnOverlayClick={!saving}
      hideFooter
    >
      <div className="space-y-4">
        <p className="text-sm text-base-content/70 leading-relaxed">
          {isBulk
            ? 'Optionally add a note for the employee about why these entries were declined.'
            : 'Optionally add a note for the employee about why this entry was declined.'}
        </p>
        <label className="block">
          <span className={EDIT_FIELD_LABEL}>Message to employee</span>
          <textarea
            className={`${EDIT_FIELD_TEXTAREA} min-h-[7rem] resize-y`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Please add clock-out time and workplace, then resubmit."
            disabled={saving}
            maxLength={2000}
          />
        </label>
        <ModalActionFooter
          onCancel={onClose}
          onConfirm={() => onConfirm(trimmedNote || null)}
          cancelLabel="Cancel"
          confirmLabel="Decline with note"
          confirmVariant="error"
          loading={saving}
          disabled={!trimmedNote}
          cancelDisabled={saving}
        />
        <div className="flex w-full">
          <button
            type="button"
            className="btn btn-outline flex-1 max-md:min-h-12"
            onClick={() => onConfirm(null)}
            disabled={saving}
          >
            Skip — decline without note
          </button>
        </div>
      </div>
    </ProfileBottomSheetModal>
  );
}
