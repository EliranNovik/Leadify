import React from 'react';
import { ClockIcon, XMarkIcon } from '@heroicons/react/24/outline';
import ClockInOvertimeApprovalBox from '../profile/ClockInOvertimeApprovalBox';

type LeadAllocationOvertimeApprovalModalProps = {
  open: boolean;
  clockInTime: string;
  clockOutTime: string;
  dateKey: string;
  baseHours: number;
  busy?: boolean;
  reason: string;
  onReasonChange: (value: string) => void;
  onSend: () => void;
  onClose: () => void;
  /** Who the extra hours belong to. The daily page leaves this empty and speaks to the employee. */
  employeeName?: string | null;
};

/**
 * Same reason + WhatsApp send as the working-hours overtime box.
 * Lead allocation and the allocations report both open this, so the request UI stays one component.
 */
export default function LeadAllocationOvertimeApprovalModal({
  open,
  clockInTime,
  clockOutTime,
  dateKey,
  baseHours,
  busy = false,
  reason,
  onReasonChange,
  onSend,
  onClose,
  employeeName = null,
}: LeadAllocationOvertimeApprovalModalProps) {
  if (!open) return null;

  const who = employeeName?.trim();
  const intro = who
    ? `${who}'s ${clockInTime}–${clockOutTime} is past the ${baseHours}h day. Write the reason and send it to Michael.`
    : `${clockInTime}–${clockOutTime} is past your ${baseHours}h day. Write the reason and send it to Michael.`;

  return (
    <div className="modal modal-open z-[120]">
      <div className="modal-box flex max-h-[85vh] max-w-lg flex-col overflow-hidden p-0">
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <ClockIcon className="h-6 w-6 shrink-0 text-amber-600" />
              <h3 className="text-lg font-bold text-gray-900">Overtime approval</h3>
            </div>
            <p className="mt-1 text-sm text-gray-500">{intro}</p>
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
            reason={reason}
            onReasonChange={onReasonChange}
            onSend={onSend}
            sending={busy}
            disabled={busy}
          />
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
