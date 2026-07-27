import React, { useEffect, useMemo, useState } from 'react';
import { CheckIcon, XMarkIcon } from '@heroicons/react/24/outline';
import {
  formatAllocationCostNis,
  formatAllocationWorkedDuration,
  type LeadBudgetExtensionRequest,
  reviewLeadBudgetExtensionRequest,
} from '../lib/leadBudgetExtensionRequests';
import { toast } from 'react-hot-toast';

const HOUR_MS = 60 * 60 * 1000;
const MIN_HOURS = 0.25;
const MAX_HOURS = 40;

function msToHours(ms: number): number {
  return Math.round((ms / HOUR_MS) * 100) / 100;
}

function clampHours(hours: number): number {
  return Math.min(MAX_HOURS, Math.max(MIN_HOURS, hours));
}

export function LeadBudgetRequestsHistoryModal({
  open,
  leadLabel,
  requests,
  onClose,
}: {
  open: boolean;
  leadLabel: string;
  requests: LeadBudgetExtensionRequest[];
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div className="modal modal-open z-[130]">
      <div className="modal-box max-w-2xl">
        <h3 className="text-lg font-bold text-gray-900">Budget requests</h3>
        <p className="mt-0.5 text-sm text-gray-500">{leadLabel}</p>

        {requests.length === 0 ? (
          <p className="py-10 text-center text-sm text-gray-500">No requests yet.</p>
        ) : (
          <ul className="mt-4 max-h-[60vh] space-y-3 overflow-y-auto">
            {requests.map((req) => (
              <li
                key={req.id}
                className="rounded-xl bg-gray-50 px-4 py-3 ring-1 ring-gray-100"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-gray-900">{req.employeeName}</p>
                    <p className="text-xs text-gray-500">
                      {new Date(req.createdAt).toLocaleString()} ·{' '}
                      {formatAllocationWorkedDuration(req.requestedExtraMs)} ·{' '}
                      {formatAllocationCostNis(req.requestedExtraCostNis)}
                    </p>
                  </div>
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize tracking-wide ${
                      req.status === 'approved'
                        ? 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200'
                        : req.status === 'declined'
                          ? 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200'
                          : 'bg-amber-100 text-amber-900'
                    }`}
                  >
                    {req.status === 'pending' ? (
                      <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
                    ) : null}
                    {req.status}
                  </span>
                </div>
                <p className="mt-2 text-sm text-gray-700">
                  <span className="font-medium text-gray-500">Request: </span>
                  {req.requestReason}
                </p>
                {req.status !== 'pending' ? (
                  <p className="mt-1.5 text-sm text-gray-600">
                    <span className="font-medium text-gray-500">
                      {req.status === 'approved' ? 'Accepted' : 'Declined'}
                      {req.reviewerName ? ` by ${req.reviewerName}` : ''}
                      {req.reviewedAt
                        ? ` · ${new Date(req.reviewedAt).toLocaleString()}`
                        : ''}
                      {req.approvedExtraCostNis != null && req.status === 'approved'
                        ? ` · +${formatAllocationCostNis(req.approvedExtraCostNis)}`
                        : ''}
                      :
                    </span>{' '}
                    {req.reviewNote || '—'}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-5 flex justify-end">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      <div className="modal-backdrop bg-black/40" onClick={onClose} />
    </div>
  );
}

export type LeadBudgetRequestReviewResult = {
  decision: 'approved' | 'declined';
  reviewNote: string;
  approvedExtraMs: number;
  approvedExtraCostNis: number;
};

export function LeadBudgetRequestReviewModal({
  open,
  request,
  submitting,
  onClose,
  onConfirm,
}: {
  open: boolean;
  request: LeadBudgetExtensionRequest | null;
  submitting: boolean;
  onClose: () => void;
  onConfirm: (result: LeadBudgetRequestReviewResult) => void;
}) {
  const [note, setNote] = useState('');
  const [hours, setHours] = useState(1);
  const [mode, setMode] = useState<'review' | 'decline'>('review');

  useEffect(() => {
    if (!open || !request) return;
    setNote('');
    setMode('review');
    setHours(clampHours(msToHours(request.requestedExtraMs) || 1));
  }, [open, request?.id]);

  const approvedExtraMs = Math.round(hours * HOUR_MS);
  const approvedExtraCostNis = useMemo(() => {
    if (!request || !(request.requestedExtraMs > 0)) return request?.requestedExtraCostNis ?? 0;
    const rate = request.requestedExtraCostNis / request.requestedExtraMs;
    return Math.round(rate * approvedExtraMs * 100) / 100;
  }, [request, approvedExtraMs]);

  if (!open || !request) return null;

  return (
    <div className="modal modal-open z-[140]">
      <div className="modal-box max-w-md">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-gray-900">Received request</h3>
            <p className="mt-0.5 text-sm text-gray-500">
              {request.employeeName} · {new Date(request.createdAt).toLocaleString()}
            </p>
          </div>
          <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-800">
            pending
          </span>
        </div>

        <div className="mt-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            Reason
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-gray-800">
            {request.requestReason}
          </p>
        </div>

        <div className="mt-4 rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-600">
          Originally asked:{' '}
          <span className="font-semibold text-gray-900">
            {formatAllocationWorkedDuration(request.requestedExtraMs)}
          </span>
          <span className="text-gray-500">
            {' '}
            · {formatAllocationCostNis(request.requestedExtraCostNis)}
          </span>
        </div>

        {mode === 'review' ? (
          <>
            <label className="mt-5 block">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-medium text-gray-700">Approve time</span>
                <span className="font-semibold text-gray-900">
                  {hours % 1 === 0 ? hours : hours.toFixed(2)}h
                  <span className="ml-2 text-xs font-normal text-gray-500">
                    ≈ {formatAllocationCostNis(approvedExtraCostNis)}
                  </span>
                </span>
              </div>
              <input
                type="range"
                min={MIN_HOURS}
                max={MAX_HOURS}
                step={0.25}
                value={hours}
                onChange={(e) => setHours(Number(e.target.value))}
                className="range range-warning range-sm"
                disabled={submitting}
              />
              <div className="mt-1 flex justify-between text-[10px] text-gray-400">
                <span>{MIN_HOURS}h</span>
                <span>{MAX_HOURS}h</span>
              </div>
            </label>

            <label className="mt-4 block">
              <span className="mb-1.5 block text-sm font-medium text-gray-700">
                Note (optional)
              </span>
              <textarea
                className="textarea textarea-bordered w-full text-sm"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional note for the employee…"
                disabled={submitting}
              />
            </label>

            <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse sm:items-center">
              <button
                type="button"
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60"
                disabled={submitting}
                onClick={() =>
                  onConfirm({
                    decision: 'approved',
                    reviewNote: note.trim(),
                    approvedExtraMs,
                    approvedExtraCostNis,
                  })
                }
              >
                {submitting ? (
                  <span className="loading loading-spinner loading-sm" />
                ) : (
                  <>
                    <CheckIcon className="h-4 w-4" strokeWidth={2.5} />
                    Accept
                  </>
                )}
              </button>
              <button
                type="button"
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-gradient-to-r from-rose-500 to-orange-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60"
                disabled={submitting}
                onClick={() => setMode('decline')}
              >
                <XMarkIcon className="h-4 w-4" strokeWidth={2.5} />
                Decline
              </button>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm mt-2 w-full rounded-full"
              disabled={submitting}
              onClick={onClose}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <label className="mt-5 block">
              <span className="mb-1.5 block text-sm font-medium text-gray-700">
                Decline reason
              </span>
              <textarea
                className="textarea textarea-bordered w-full text-sm"
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Why is this declined?"
                disabled={submitting}
              />
            </label>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse">
              <button
                type="button"
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-gradient-to-r from-rose-500 to-orange-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60"
                disabled={submitting || !note.trim()}
                onClick={() =>
                  onConfirm({
                    decision: 'declined',
                    reviewNote: note.trim(),
                    approvedExtraMs: request.requestedExtraMs,
                    approvedExtraCostNis: request.requestedExtraCostNis,
                  })
                }
              >
                {submitting ? (
                  <span className="loading loading-spinner loading-sm" />
                ) : (
                  <>
                    <XMarkIcon className="h-4 w-4" strokeWidth={2.5} />
                    Confirm decline
                  </>
                )}
              </button>
              <button
                type="button"
                className="btn btn-ghost flex-1 rounded-full"
                disabled={submitting}
                onClick={() => {
                  setMode('review');
                  setNote('');
                }}
              >
                Back
              </button>
            </div>
          </>
        )}
      </div>
      <div className="modal-backdrop bg-black/40" onClick={submitting ? undefined : onClose} />
    </div>
  );
}

export async function confirmBudgetRequestReview(params: {
  requestId: number;
  decision: 'approved' | 'declined';
  reviewNote: string;
  approvedExtraCostNis?: number | null;
}): Promise<void> {
  await reviewLeadBudgetExtensionRequest({
    requestId: params.requestId,
    decision: params.decision,
    reviewNote: params.reviewNote || null,
    approvedExtraCostNis:
      params.decision === 'approved' ? params.approvedExtraCostNis ?? null : null,
  });
  toast.success(params.decision === 'approved' ? 'Request accepted' : 'Request declined');
}

export function latestPendingReason(requests: LeadBudgetExtensionRequest[]): string | null {
  const pending = requests.find((r) => r.status === 'pending');
  return pending?.requestReason || null;
}
