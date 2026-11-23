import React, { useEffect, useRef, useState } from 'react';
import { DocumentArrowUpIcon } from '@heroicons/react/24/outline';
import { FaWhatsapp } from 'react-icons/fa';
import { toast } from 'react-hot-toast';
import {
  CLOCK_IN_OVERTIME_DOC_MAX_BYTES,
  buildOvertimeApprovalWhatsAppMessage,
  clockSessionExceedsOvertimeBase,
  dayTotalExceedsOvertimeBase,
  fetchMichaelDeckerWhatsAppUrl,
  formatDurationMinutesLabel,
  isAllowedOvertimeApprovalFile,
  segmentsTotalMinutes,
  type ClockInOutSegment,
} from '../../lib/employeeClockInOvertimeApproval';

interface ClockInOvertimeApprovalBoxProps {
  clockInTime?: string;
  clockOutTime?: string;
  /** Multiple in/out pairs for the day — preferred over a single clockIn/Out. */
  segments?: ClockInOutSegment[];
  /** Minutes already logged on the day(s), counted into the overtime total. */
  existingMinutes?: number;
  dateKeys?: string[];
  notes?: string | null;
  /** The employee's contracted base hours, which is what this session has gone past. */
  baseHours: number;
  /** Screenshot upload, used where a WhatsApp request is not sent from this box. */
  file?: File | null;
  onFileChange?: (file: File | null) => void;
  existingFileName?: string | null;
  disabled?: boolean;
  /** When set, the employee writes a reason and this box sends the WhatsApp request. */
  reason?: string;
  onReasonChange?: (value: string) => void;
  onSend?: () => void;
  sending?: boolean;
}

const ClockInOvertimeApprovalBox: React.FC<ClockInOvertimeApprovalBoxProps> = ({
  clockInTime = '',
  clockOutTime = '',
  segments,
  existingMinutes = 0,
  dateKeys = [],
  notes = '',
  baseHours,
  file = null,
  onFileChange,
  existingFileName = null,
  disabled = false,
  reason = '',
  onReasonChange,
  onSend,
  sending = false,
}) => {
  const [whatsAppUrl, setWhatsAppUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resolvedSegments: ClockInOutSegment[] =
    segments && segments.length > 0
      ? segments
      : clockInTime && clockOutTime
        ? [{ clockInTime, clockOutTime }]
        : [];
  const newMinutes = segmentsTotalMinutes(resolvedSegments);
  const totalMinutes = Math.max(0, existingMinutes) + newMinutes;
  const durationLabel = formatDurationMinutesLabel(totalMinutes);
  const message = buildOvertimeApprovalWhatsAppMessage({
    segments: resolvedSegments,
    clockInTime: resolvedSegments[0]?.clockInTime,
    clockOutTime: resolvedSegments[0]?.clockOutTime,
    dateKeys,
    notes,
    existingMinutes,
    baseHours,
  });

  useEffect(() => {
    if (onSend) return;
    let cancelled = false;
    void fetchMichaelDeckerWhatsAppUrl(message).then((url) => {
      if (!cancelled) setWhatsAppUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [message, onSend]);

  const acceptFile = (next: File | undefined) => {
    if (!next) return;
    const err = isAllowedOvertimeApprovalFile(next);
    if (err) {
      toast.error(err);
      return;
    }
    onFileChange?.(next);
  };

  return (
    <div
      className={`space-y-3 rounded-xl px-3 py-3 text-sm ${
        onSend ? 'bg-gray-100 text-gray-700' : 'bg-red-50 text-red-950'
      }`}
    >
      <p className="flex items-center gap-2">
        <span className="badge border-0 bg-red-600 px-2.5 font-semibold text-white">
          {durationLabel}
        </span>
        <span>Over your {baseHours}h day</span>
      </p>
      {onSend ? (
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/[0.06]">
          <textarea
            className="min-h-[96px] w-full resize-none border-0 bg-transparent px-4 py-3 text-sm text-gray-800 outline-none placeholder:text-gray-400 focus:ring-0"
            value={reason}
            maxLength={500}
            onChange={(e) => onReasonChange?.(e.target.value)}
            placeholder="Why were the extra hours needed?"
            disabled={disabled || sending}
          />
          <div className="flex items-center justify-end px-3 pb-3">
            <button
              type="button"
              className="btn btn-sm btn-primary rounded-full px-4 text-white"
              onClick={onSend}
              disabled={disabled || sending || !reason.trim()}
            >
              {sending ? <span className="loading loading-spinner loading-xs" /> : null}
              Submit request
            </button>
          </div>
        </div>
      ) : (
        <>
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
                onFileChange?.(null);
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
        </>
      )}
    </div>
  );
};

export function clockInOutTimesExceedOvertimeBase(
  clockInTime: string,
  clockOutTime: string,
  baseHours: number,
): boolean {
  return clockSessionExceedsOvertimeBase(clockInTime, clockOutTime, baseHours);
}

export function clockInSegmentsExceedOvertimeBase(
  segments: ClockInOutSegment[],
  existingMinutes: number,
  baseHours: number,
): boolean {
  return dayTotalExceedsOvertimeBase(segments, existingMinutes, baseHours);
}

export default ClockInOvertimeApprovalBox;
