import React, { useEffect, useState } from 'react';
import { DocumentArrowUpIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import {
  documentNameFromUrl,
  unavailabilityDateLabel,
  unavailabilityReasonText,
  updateUnavailabilityDayRow,
  type EmployeeUnavailabilityDayRow,
  type UnavailabilityType,
} from '../../lib/employeeUnavailabilities';
import { getHolidayWarningsForDates } from '../../lib/israeliJewishHolidays';
import type { HolidayDateWarning } from '../../lib/israeliJewishHolidays';
import HolidayEntryWarningModal from './HolidayEntryWarningModal';

interface UnavailabilityDayEditModalProps {
  isOpen: boolean;
  row: EmployeeUnavailabilityDayRow | null;
  employeeId: number;
  onClose: () => void;
  onSaved: () => void;
}

const UnavailabilityDayEditModal: React.FC<UnavailabilityDayEditModalProps> = ({
  isOpen,
  row,
  employeeId,
  onClose,
  onSaved,
}) => {
  const [type, setType] = useState<UnavailabilityType>('general');
  const [reason, setReason] = useState('');
  const [documentUrl, setDocumentUrl] = useState<string | null>(null);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [holidayWarnings, setHolidayWarnings] = useState<HolidayDateWarning[]>([]);
  const [showHolidayWarning, setShowHolidayWarning] = useState(false);

  useEffect(() => {
    if (!row) return;
    setType(row.unavailability_type);
    setReason(unavailabilityReasonText(row) === '—' ? '' : unavailabilityReasonText(row));
    setDocumentUrl(row.document_url);
    setDocumentFile(null);
  }, [row]);

  if (!isOpen || !row) return null;

  const performSave = async () => {
    if (!row) return;
    setSaving(true);
    try {
      await updateUnavailabilityDayRow(row, row.date, {
        unavailability_type: type,
        reason: reason.trim(),
        document_url: documentUrl,
        documentFile,
      }, employeeId);
      toast.success('Unavailability updated');
      onSaved();
      onClose();
    } catch (err) {
      console.error('UnavailabilityDayEditModal save:', err);
      toast.error('Failed to update unavailability');
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (!reason.trim()) {
      toast.error('Please enter a reason');
      return;
    }

    const warnings = await getHolidayWarningsForDates([row.date]);
    if (warnings.length > 0) {
      setHolidayWarnings(warnings);
      setShowHolidayWarning(true);
      return;
    }

    await performSave();
  };

  const recordEnd = row.end_date || row.start_date;
  const spansMultipleDays = row.start_date !== recordEnd;

  return (
    <>
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-base-200">
          <h3 className="text-lg font-semibold text-gray-900">Edit unavailability</h3>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-circle"
            onClick={onClose}
            disabled={saving}
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <label className="form-control w-full">
            <span className="label-text font-medium mb-1">Date</span>
            <input
              type="text"
              className="input input-bordered w-full"
              value={unavailabilityDateLabel(row.date)}
              readOnly
            />
          </label>

          {spansMultipleDays && (
            <p className="text-sm text-gray-500 bg-base-200/60 rounded-lg px-3 py-2">
              This day is part of a longer period ({unavailabilityDateLabel(row.start_date)}
              {' – '}
              {unavailabilityDateLabel(recordEnd)}). Saving will update this day only.
            </p>
          )}

          <label className="form-control w-full">
            <span className="label-text font-medium mb-1">Type</span>
            <select
              className="select select-bordered w-full"
              value={type}
              onChange={(e) => setType(e.target.value as UnavailabilityType)}
              disabled={saving}
            >
              <option value="general">General</option>
              <option value="vacation">Vacation</option>
              <option value="sick_days">Sick day/s</option>
            </select>
          </label>

          <label className="form-control w-full">
            <span className="label-text font-medium mb-1">Reason</span>
            <textarea
              className="textarea textarea-bordered w-full min-h-[88px]"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={saving}
              placeholder="Enter reason"
            />
          </label>

          <div className="form-control w-full">
            <span className="label-text font-medium mb-2">Document</span>
            <div className="rounded-lg border border-base-200 p-3 space-y-3">
              {documentUrl && !documentFile && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-gray-700 truncate">
                    {documentNameFromUrl(documentUrl)}
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs text-error gap-1 shrink-0"
                    onClick={() => setDocumentUrl(null)}
                    disabled={saving}
                  >
                    <TrashIcon className="w-4 h-4" />
                    Remove
                  </button>
                </div>
              )}

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
                {documentUrl || documentFile ? 'Replace document' : 'Upload document'}
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
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-base-200">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleSave()}
            disabled={saving}
          >
            {saving ? <span className="loading loading-spinner loading-sm" /> : 'Save'}
          </button>
        </div>
      </div>
    </div>
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

export default UnavailabilityDayEditModal;
