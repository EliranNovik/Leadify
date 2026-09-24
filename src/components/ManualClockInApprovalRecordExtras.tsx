import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CheckBadgeIcon,
  CheckIcon,
  FlagIcon,
  XMarkIcon,
} from '@heroicons/react/24/solid';
import { DocumentTextIcon } from '@heroicons/react/24/outline';
import type { ManualClockInApprovalRecord } from '../lib/employeeClockInApproval';
import {
  buildClockInApprovalReview,
  clockInInsightLevelLabel,
  clockInInsightTagClass,
  getApprovalInsightNotes,
  type ClockInInsightLevel,
} from '../lib/clockInApprovalInsights';
import type { ClockInRevisionSnapshot } from '../lib/employeeClockInRevisions';
import { CLOCK_IN_OVERTIME_APPROVAL_BUCKET } from '../lib/employeeClockInOvertimeApproval';
import DocumentViewerModal from './DocumentViewerModal';

export function ApprovalNotesButton({
  notes,
  title = 'Notes',
}: {
  notes: string | null | undefined;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const trimmed = notes?.trim() || '';

  if (!trimmed) {
    return <span className="text-base-content/40">—</span>;
  }

  return (
    <>
      <button
        type="button"
        className="block max-w-[10rem] truncate text-left text-sm text-primary/90 hover:text-primary sm:max-w-[16rem] lg:max-w-[28rem] xl:max-w-[36rem]"
        title="View notes"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        {trimmed}
      </button>
      {open && typeof document !== 'undefined'
        ? createPortal(
            <div className="fixed inset-0 z-[520] flex items-center justify-center p-4" role="presentation">
              <div
                className="absolute inset-0 bg-black/45 backdrop-blur-[1px]"
                onClick={() => setOpen(false)}
                aria-hidden
              />
              <div
                className="relative z-10 w-full max-w-md rounded-2xl bg-base-100 p-4 shadow-2xl"
                role="dialog"
                aria-modal="true"
                aria-labelledby="clock-in-notes-title"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mb-3 flex items-start justify-between gap-3">
                  <h3 id="clock-in-notes-title" className="text-base font-semibold text-base-content">
                    {title}
                  </h3>
                  <button
                    type="button"
                    className="btn btn-ghost btn-circle btn-sm"
                    onClick={() => setOpen(false)}
                    aria-label="Close"
                  >
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-base-content/85">{trimmed}</p>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

export function ApprovalChangedValue({
  value,
  previous,
}: {
  value: string;
  previous?: string | null;
}) {
  if (!previous || previous === value) {
    return <span>{value}</span>;
  }
  return (
    <span className="inline-flex flex-col items-start gap-1 leading-tight">
      <span className="font-semibold text-amber-900">{value}</span>
      <span className="inline-flex items-center rounded-md bg-base-200 px-1.5 py-0.5 text-[11px] font-medium text-base-content/50">
        {previous}
      </span>
    </span>
  );
}

export function ManualClockInApprovalRecordExtras({
  record,
  revision,
  colSpan,
}: {
  record: ManualClockInApprovalRecord;
  revision?: ClockInRevisionSnapshot | null;
  colSpan: number;
}) {
  const [viewerOpen, setViewerOpen] = useState(false);
  const review = buildClockInApprovalReview(record, revision);
  const notes = getApprovalInsightNotes(review.insights);
  const overtimePath = record.overtime_approval_storage_path?.trim() || '';
  const overtimeName = record.overtime_approval_file_name?.trim() || 'Overtime approval screenshot';

  if (notes.length === 0 && !overtimePath) return null;

  const hasFlag = notes.some((note) => note.level === 'flag');

  return (
    <>
      <tr className="manual-clock-approval-detail-row">
        <td colSpan={colSpan} className="!bg-[#f8fafc]/80 !px-5 !py-2.5 !border-t !border-base-200/70">
          <div className="space-y-2.5">
            {notes.length > 0 && (
              <div className="flex items-start gap-3 text-sm">
                <span className="min-w-[2.75rem] shrink-0 pt-0.5 text-[11px] font-semibold uppercase tracking-wide text-base-content/40">
                  Note
                </span>
                <div className="min-w-0 flex-1 space-y-2 leading-relaxed">
                  {notes.map((note) => (
                    <p
                      key={note.title}
                      className={
                        note.level === 'flag'
                          ? 'text-red-800'
                          : hasFlag
                            ? 'text-base-content/70'
                            : 'text-amber-900'
                      }
                    >
                      {note.detail}
                    </p>
                  ))}
                </div>
              </div>
            )}
            {overtimePath && (
              <div className="flex items-start gap-3 text-sm">
                <span className="min-w-[2.75rem] shrink-0 pt-0.5 text-[11px] font-semibold uppercase tracking-wide text-base-content/40">
                  OT
                </span>
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-950 hover:bg-amber-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      setViewerOpen(true);
                    }}
                  >
                    <DocumentTextIcon className="h-4 w-4 shrink-0" />
                    View overtime approval
                    <span className="max-w-[14rem] truncate font-normal text-amber-800/80">
                      {overtimeName}
                    </span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </td>
      </tr>
      {viewerOpen && (
        <DocumentViewerModal
          isOpen
          onClose={() => setViewerOpen(false)}
          documentUrl={overtimePath}
          documentName={overtimeName}
          employeeName={record.employee_name}
          bucketName={CLOCK_IN_OVERTIME_APPROVAL_BUCKET}
        />
      )}
    </>
  );
}

export function ClockInInsightTag({
  level,
  title,
  className = '',
  variant = 'outline',
}: {
  level: ClockInInsightLevel;
  title?: string;
  className?: string;
  variant?: 'outline' | 'pill';
}) {
  const label = title || clockInInsightLevelLabel(level);

  const InsightIcon = ({ className: iconClass }: { className?: string }) => {
    if (level === 'flag') {
      return <FlagIcon className={iconClass} aria-hidden />;
    }
    if (level === 'review') {
      return <CheckBadgeIcon className={iconClass} aria-hidden />;
    }
    return <CheckIcon className={iconClass} aria-hidden />;
  };

  if (variant === 'pill') {
    const pillClass =
      level === 'flag'
        ? 'bg-gradient-to-br from-red-50 via-rose-50 to-red-100/90 text-red-700 ring-1 ring-red-200/60 shadow-sm'
        : level === 'review'
          ? 'bg-gradient-to-br from-amber-50 via-yellow-50 to-amber-100/90 text-amber-800 ring-1 ring-amber-200/60 shadow-sm'
          : 'bg-gradient-to-br from-emerald-50 via-green-50 to-emerald-100/90 text-emerald-700 ring-1 ring-emerald-200/60 shadow-sm';

    return (
      <span
        className={`inline-flex shrink-0 aspect-square h-8 w-8 min-h-8 min-w-8 items-center justify-center rounded-[9999px] ${pillClass} ${className}`}
        title={label}
        aria-label={label}
      >
        <InsightIcon className="h-4 w-4" />
      </span>
    );
  }

  return (
    <span
      className={`inline-flex shrink-0 aspect-square h-7 w-7 min-h-7 min-w-7 items-center justify-center rounded-[9999px] border bg-base-100 ${clockInInsightTagClass(level)} ${className}`}
      title={label}
      aria-label={label}
    >
      <InsightIcon className="h-3.5 w-3.5" />
    </span>
  );
}
