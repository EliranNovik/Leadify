import React, { useEffect, useRef, useState } from 'react';
import { DocumentArrowUpIcon } from '@heroicons/react/24/outline';
import { FaWhatsapp } from 'react-icons/fa';
import { toast } from 'react-hot-toast';
import {
  CLOCK_IN_OVERTIME_DOC_MAX_BYTES,
  buildOvertimeApprovalWhatsAppMessage,
  clockSessionExceedsMinHours,
  fetchMichaelDeckerWhatsAppUrl,
  formatClockSessionDurationLabel,
  isAllowedOvertimeApprovalFile,
} from '../../lib/employeeClockInOvertimeApproval';

interface ClockInOvertimeApprovalBoxProps {
  minHours: number;
  clockInTime: string;
  clockOutTime: string;
  dateKeys?: string[];
  notes?: string | null;
  file: File | null;
  onFileChange: (file: File | null) => void;
  existingFileName?: string | null;
  disabled?: boolean;
}

const ClockInOvertimeApprovalBox: React.FC<ClockInOvertimeApprovalBoxProps> = ({
  minHours,
  clockInTime,
  clockOutTime,
  dateKeys = [],
  notes = '',
  file,
  onFileChange,
  existingFileName = null,
  disabled = false,
}) => {
  const [whatsAppUrl, setWhatsAppUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const durationLabel = formatClockSessionDurationLabel(clockInTime, clockOutTime);
  const message = buildOvertimeApprovalWhatsAppMessage({
    minHours,
    clockInTime,
    clockOutTime,
    dateKeys,
    notes,
  });

  useEffect(() => {
    let cancelled = false;
    void fetchMichaelDeckerWhatsAppUrl(message).then((url) => {
      if (!cancelled) setWhatsAppUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [message]);

  const acceptFile = (next: File | undefined) => {
    if (!next) return;
    const err = isAllowedOvertimeApprovalFile(next);
    if (err) {
      toast.error(err);
      return;
    }
    onFileChange(next);
  };

  return (
    <div className="rounded-xl bg-red-50 px-3 py-3 space-y-3 text-sm text-red-950">
      <p className="font-medium">
        This session is {durationLabel}, which is more than your {minHours}h base hours.
      </p>
      <p>
        Get approval from <strong>Michael Decker</strong> on WhatsApp first. After he approves,
        upload a screenshot here, then click Submit for approval.
      </p>
      {whatsAppUrl ? (
        <a
          href={whatsAppUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-sm btn-success gap-2 rounded-full px-4 text-white"
        >
          <FaWhatsapp className="h-6 w-6" />
          WhatsApp Michael Decker
        </a>
      ) : (
        <p className="text-xs text-red-800/80">
          Open WhatsApp and message Michael Decker for overtime approval before uploading.
        </p>
      )}

      <div
        className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors ${
          file ? 'border-primary bg-white/70' : 'border-red-200 bg-red-100/40 hover:border-red-300 cursor-pointer'
        }`}
        role={file ? undefined : 'button'}
        tabIndex={file || disabled ? undefined : 0}
        onClick={() => {
          if (disabled || file) return;
          fileInputRef.current?.click();
        }}
        onKeyDown={(e) => {
          if (disabled || file) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (disabled) return;
          acceptFile(e.dataTransfer.files[0]);
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept="image/*,.pdf"
          disabled={disabled}
          onChange={(e) => {
            acceptFile(e.target.files?.[0]);
            e.currentTarget.value = '';
          }}
        />
        {file ? (
          <div className="space-y-1">
            <DocumentArrowUpIcon className="mx-auto h-7 w-7 text-primary" />
            <p className="text-sm font-medium text-gray-800">{file.name}</p>
            <p className="text-xs text-base-content/55">
              {(file.size / 1024).toFixed(0)} KB · max {CLOCK_IN_OVERTIME_DOC_MAX_BYTES / 1024 / 1024}MB
            </p>
            <button
              type="button"
              className="btn btn-xs btn-ghost"
              disabled={disabled}
              onClick={(e) => {
                e.stopPropagation();
                onFileChange(null);
              }}
            >
              Remove
            </button>
          </div>
        ) : existingFileName ? (
          <div className="space-y-1">
            <DocumentArrowUpIcon className="mx-auto h-7 w-7 text-primary" />
            <p className="text-sm font-medium text-gray-800">{existingFileName}</p>
            <p className="text-xs text-base-content/55">Already uploaded — click to replace with a new screenshot</p>
          </div>
        ) : (
          <div className="space-y-1 pointer-events-none">
            <DocumentArrowUpIcon className="mx-auto h-7 w-7 text-red-300" />
            <p className="text-sm text-gray-700">
              Drop the approval screenshot here, or{' '}
              <span className="text-primary hover:underline">browse</span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export function clockInOutTimesExceedMinHours(
  clockInTime: string,
  clockOutTime: string,
  minHours: number,
): boolean {
  return clockSessionExceedsMinHours(clockInTime, clockOutTime, minHours);
}

export default ClockInOvertimeApprovalBox;
