import React from 'react';
import type { HandlerBucket, HandlerPipelineRow } from './handlerTypes';

function safeParseDate(value: string | null | undefined): Date | null {
  if (!value || value.trim() === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  if (year < 1900 || year > 2100) return null;
  return date;
}

function formatDateDDMMYY(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yy = String(date.getFullYear()).slice(-2);
  return `${dd}.${mm}.${yy}`;
}

function daysSince(date: Date): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const base = new Date(date);
  base.setHours(0, 0, 0, 0);
  return Math.floor((today.getTime() - base.getTime()) / (1000 * 60 * 60 * 24));
}

export type HandlerAssignmentFlags = {
  isNew: boolean;
  isReassigned: boolean;
};

type AssignmentInput = {
  bucket: HandlerBucket;
  assignedDate: string | null;
  handlerAssignedDate?: string | null;
  stage105Date?: string | null;
  stage110Date?: string | null;
  previousHandlerName?: string | null;
};

/** Same New / Re-assigned rules as My Cases. Re-assigned wins when both apply. */
export function getHandlerAssignmentFlags(input: AssignmentInput): HandlerAssignmentFlags {
  let isNew = false;
  if (input.bucket === 'new') {
    const newCasesBase = safeParseDate(input.handlerAssignedDate || input.stage105Date || input.assignedDate);
    if (newCasesBase) {
      const days = daysSince(newCasesBase);
      isNew = days >= 0 && days <= 7;
    }
  } else if (input.bucket === 'active' || input.bucket === 'non_active') {
    const s110 = safeParseDate(input.stage110Date);
    if (s110) {
      const days = daysSince(s110);
      isNew = days >= 0 && days <= 7;
    }
  }

  const prevHandlerName = (input.previousHandlerName || '').trim();
  const myHandler = safeParseDate(input.handlerAssignedDate);
  const isReassigned = (() => {
    if (!myHandler || !prevHandlerName) return false;
    const days = daysSince(myHandler);
    return days >= 0 && days <= 7;
  })();

  return { isNew, isReassigned };
}

export function rowAssignmentFlags(row: HandlerPipelineRow): HandlerAssignmentFlags {
  return getHandlerAssignmentFlags({
    bucket: row.bucket,
    assignedDate: row.assigned_date,
    handlerAssignedDate: row.handlerAssignedDate,
    stage105Date: row.stage105Date,
    stage110Date: row.stage110Date,
    previousHandlerName: row.previousHandlerName,
  });
}

type Props = AssignmentInput;

/** Assigned date plus New / Re-assigned overlays — same rules as My Cases. */
const HandlerAssignedDateBadge: React.FC<Props> = ({
  bucket,
  assignedDate,
  handlerAssignedDate,
  stage105Date,
  stage110Date,
  previousHandlerName,
}) => {
  const displayDateStr = handlerAssignedDate || stage105Date || assignedDate || null;
  if (!displayDateStr) return <span className="text-gray-400">—</span>;
  const d = safeParseDate(displayDateStr);
  if (!d) return <span>{displayDateStr}</span>;

  const { isNew, isReassigned } = getHandlerAssignmentFlags({
    bucket,
    assignedDate,
    handlerAssignedDate,
    stage105Date,
    stage110Date,
    previousHandlerName,
  });

  const handlerStartedDateForTip = safeParseDate(stage110Date);
  const showHandlerStartedTooltip =
    (bucket === 'active' || bucket === 'non_active') && !!handlerStartedDateForTip && !isNew && !isReassigned;
  const handlerStartedTipText = handlerStartedDateForTip
    ? `Handler Started: ${formatDateDDMMYY(handlerStartedDateForTip)}`
    : '';
  const reassignedTipText = isReassigned ? `Re-assigned from ${(previousHandlerName || '').trim()} to you` : '';
  const newTipText = isNew && !isReassigned
    ? bucket === 'new'
      ? 'New: assigned to you in the last 7 days'
      : handlerStartedDateForTip
        ? `New: handler started in the last 7 days (${formatDateDDMMYY(handlerStartedDateForTip)})`
        : 'New: handler started in the last 7 days'
    : '';
  const tipText = reassignedTipText || newTipText || (showHandlerStartedTooltip ? handlerStartedTipText : '');
  const showOverlay = isNew || isReassigned;

  return (
    <div
      className={`inline-flex flex-col items-center justify-center gap-0.5 ${
        tipText ? 'tooltip tooltip-top' : ''
      }`}
      {...(tipText ? { 'data-tip': tipText } : {})}
    >
      {showOverlay ? (
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-gray-500">
          {isReassigned ? 'Re-assigned' : 'New'}
        </span>
      ) : null}
      <span className="text-sm font-semibold text-gray-800">{formatDateDDMMYY(d)}</span>
    </div>
  );
};

export default HandlerAssignedDateBadge;
