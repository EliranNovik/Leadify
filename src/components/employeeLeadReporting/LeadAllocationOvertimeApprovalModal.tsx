import React, { useEffect, useState } from 'react';
import { ClockIcon, XMarkIcon } from '@heroicons/react/24/outline';
import ClockInOvertimeApprovalBox from '../profile/ClockInOvertimeApprovalBox';

type LeadAllocationOvertimeApprovalModalProps = {
  open: boolean;
  clockInTime: string;
  clockOutTime: string;
  dateKey: string;
  baseHours: number;
  busy?: boolean;
  existingFileName?: string | null;
  onUpload: (file: File) => void;
  /** Absent when the hours are already saved and only the screenshot is still missing. */
  onSkip?: () => void;
  onClose: () => void;
};

/**
 * Asks for the WhatsApp approval screenshot of a day that ran past the employee's base hours.
 *
 * The allocation page is the one place this can be postponed: the hours are only there so the day
 * can be reported, and refusing the save over a missing screenshot costs the report as well. So
 * "Skip for now" saves the day as overtime awaiting approval and leaves the upload for later.
 */
export default function LeadAllocationOvertimeApprovalModal({
  open,
  clockInTime,
  clockOutTime,
  dateKey,
  baseHours,
  busy = false,
  existingFileName = null,
  onUpload,
  onSkip,
  onClose,
}: LeadAllocationOvertimeApprovalModalProps) {
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    if (!open) setFile(null);
  }, [open]);

  if (!open) return null;

  return (
    <div className="modal modal-open z-[120]">
      <div className="modal-box flex max-h-[85vh] max-w-lg flex-col overflow-hidden p-0">
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <ClockIcon className="h-6 w-6 shrink-0 text-amber-600" />
              <h3 className="text-lg font-bold text-gray-900">Overtime approval</h3>
            </div>
            <p className="mt-1 text-sm text-gray-500">
              {clockInTime}–{clockOutTime} is past your {baseHours}h day. Upload Michael&apos;s
              approval, or skip it and save your allocation now.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-circle"
            onClick={onClose}
            aria-label="Close"
            disabled={busy}
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-4">
          <ClockInOvertimeApprovalBox
            clockInTime={clockInTime}
            clockOutTime={clockOutTime}
            dateKeys={[dateKey]}
            baseHours={baseHours}
            file={file}
            onFileChange={setFile}
            existingFileName={existingFileName}
            disabled={busy}
          />
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-gray-200 px-6 py-4">
          {onSkip ? (
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={onSkip}>
              Skip for now
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !file}
            onClick={() => {
              if (file) onUpload(file);
            }}
          >
            {busy ? <span className="loading loading-spinner loading-sm" /> : 'Upload and save'}
          </button>
        </div>
      </div>
      <button
        type="button"
        className="modal-backdrop bg-black/40"
        aria-label="Close"
        onClick={onClose}
      />
    </div>
  );
}
