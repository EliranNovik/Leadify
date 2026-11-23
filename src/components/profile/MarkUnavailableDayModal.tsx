import React, { useEffect, useState } from 'react';
import { DocumentArrowUpIcon, TrashIcon } from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import {
  createFullDayUnavailability,
  unavailabilityDateLabel,
} from '../../lib/employeeUnavailabilities';
import { getHolidayWarningsForDates } from '../../lib/israeliJewishHolidays';
import type { HolidayDateWarning } from '../../lib/israeliJewishHolidays';
import HolidayEntryWarningModal from './HolidayEntryWarningModal';
import ProfileBottomSheetModal from './ProfileBottomSheetModal';

interface MarkUnavailableDayModalProps {
  isOpen: boolean;
  employeeId: number;
  dateKey: string | null;
  type: 'sick_days' | 'vacation' | null;
  onClose: () => void;
  onSaved: () => void;
}

const MarkUnavailableDayModal: React.FC<MarkUnavailableDayModalProps> = ({
  isOpen,
  employeeId,
  dateKey,
  type,
  onClose,
  onSaved,
}) => {
  const [reason, setReason] = useState('');
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [holidayWarnings, setHolidayWarnings] = useState<HolidayDateWarning[]>([]);
  const [showHolidayWarning, setShowHolidayWarning] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setReason('');
    setDocumentFile(null);
    setHolidayWarnings([]);
    setShowHolidayWarning(false);
  }, [isOpen, dateKey, type]);

  if (!isOpen || !dateKey || !type) return null;

  const title = type === 'sick_days' ? 'Mark as sick' : 'Mark as vacation';

  const performSave = async () => {
    setSaving(true);
    try {
      await createFullDayUnavailability({
        employeeId,
        date: dateKey,
        type,
        reason: reason.trim(),
        documentFile,
      });
      toast.success(type === 'sick_days' ? 'Marked as sick' : 'Marked as vacation');
      onSaved();
      onClose();
    } catch (err) {
      console.error('MarkUnavailableDayModal save:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to save unavailability');
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (!reason.trim()) {
      toast.error('Please enter a reason');
      return;
    }
    const warnings = await getHolidayWarningsForDates([dateKey]);
    if (warnings.length > 0) {
      setHolidayWarnings(warnings);
      setShowHolidayWarning(true);
      return;
    }
    await performSave();
  };

  return (
    <>
      <ProfileBottomSheetModal
        open={isOpen}
        onClose={onClose}
        title={title}
        desktopLayout="drawer-right"
        headerClassName="!border-b-0"
        footerClassName="!border-t-0"
        closeOnOverlayClick={!saving}
        footer={
          <div className="flex w-full items-center justify-end gap-2">
            <button
              type="button"
              className="btn btn-ghost h-10 min-h-10 rounded-full px-5"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary h-10 min-h-10 rounded-full px-8"
              onClick={() => void handleSave()}
              disabled={saving}
            >
              {saving ? <span className="loading loading-spinner loading-sm" /> : 'Save'}
            </button>
          </div>
        }
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
          <label className="form-control w-full">
            <span className="label-text font-medium mb-1">Reason</span>
            <textarea
              className="textarea textarea-bordered w-full min-h-[88px]"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={saving}
              placeholder={type === 'sick_days' ? 'e.g. Flu, doctor appointment' : 'e.g. Family vacation'}
            />
          </label>
          {type === 'sick_days' && (
            <div className="form-control w-full">
              <span className="label-text font-medium mb-2">Document</span>
              <div className="rounded-lg border border-base-200 p-3 space-y-3">
                {documentFile && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-gray-700 truncate">{documentFile.name}</span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs text-error gap-1 shrink-0"
                      onClick={() => setDocumentFile(null)}
                      disabled={saving}
                    >
                      <TrashIcon className="w-4 h-4" />
                      Clear
                    </button>
                  </div>
                )}
                <label className="btn btn-outline btn-sm gap-2 w-fit">
                  <DocumentArrowUpIcon className="w-4 h-4" />
                  {documentFile ? 'Replace document' : 'Upload document'}
                  <input
                    type="file"
                    className="hidden"
                    accept="image/*,.pdf,.doc,.docx"
                    disabled={saving}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) setDocumentFile(file);
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
            </div>
          )}
        </div>
      </ProfileBottomSheetModal>
      <HolidayEntryWarningModal
        isOpen={showHolidayWarning}
        warnings={holidayWarnings}
        continuing={saving}
        onCancel={() => setShowHolidayWarning(false)}
        onContinue={() => void performSave()}
      />
    </>
  );
};

export default MarkUnavailableDayModal;
