import React, { useEffect, useMemo, useState } from 'react';
import { PencilSquareIcon } from '@heroicons/react/24/outline';
import { formatAllocationCostNis } from '../lib/leadsManagementReport';
import { applyBudgetExtensions } from '../lib/leadBudgetExtensionRequests';
import { maxLeadEmployeeCostNis } from '../lib/leadEmployeeCost';

export function LeadValuePaymentPlanBlockedModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div className="modal modal-open z-[130]">
      <div className="modal-box max-w-md">
        <h3 className="text-lg font-bold text-gray-900">Cannot edit lead value</h3>
        <p className="mt-3 text-sm text-gray-600">
          This lead has a payment plan. Lead value cannot be edited from here — change it from the
          payment plan / finances on the client page.
        </p>
        <div className="mt-6 flex justify-end">
          <button
            type="button"
            className="inline-flex items-center rounded-full bg-gray-900 px-5 py-2 text-sm font-semibold text-white hover:bg-gray-800"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
      <div className="modal-backdrop bg-black/40" onClick={onClose} />
    </div>
  );
}

export function EditLeadValueModal({
  open,
  currentValueNis,
  submitting,
  onClose,
  onSave,
}: {
  open: boolean;
  currentValueNis: number;
  submitting: boolean;
  onClose: () => void;
  onSave: (valueNis: number) => void;
}) {
  const [value, setValue] = useState(String(Math.round(currentValueNis * 100) / 100));

  useEffect(() => {
    if (open) setValue(String(Math.round(currentValueNis * 100) / 100));
  }, [open, currentValueNis]);

  if (!open) return null;

  const parsed = Number(value);
  const valid = Number.isFinite(parsed) && parsed >= 0;

  return (
    <div className="modal modal-open z-[130]">
      <div className="modal-box max-w-md">
        <h3 className="text-lg font-bold text-gray-900">Edit lead value</h3>
        <p className="mt-1 text-sm text-gray-500">
          Updates the lead balance / proposal total used for employee cost budget.
        </p>
        <label className="mt-4 block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500">
            Lead value (₪)
          </span>
          <input
            type="number"
            min={0}
            step={0.01}
            className="input input-bordered w-full"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={submitting}
          />
        </label>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            className="btn btn-ghost btn-sm rounded-full"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="inline-flex items-center rounded-full bg-gray-900 px-5 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-60"
            disabled={!valid || submitting}
            onClick={() => onSave(Math.round(parsed * 100) / 100)}
          >
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
      <div className="modal-backdrop bg-black/40" onClick={submitting ? undefined : onClose} />
    </div>
  );
}

export function EditMaxAllowedModal({
  open,
  currentMaxNis,
  baseMaxNis,
  approvedExtensionCostNis,
  leadTotalValueNis,
  costNis,
  hasOverride,
  submitting,
  onClose,
  onSave,
  onResetToCalculated,
}: {
  open: boolean;
  currentMaxNis: number;
  baseMaxNis: number;
  approvedExtensionCostNis: number;
  leadTotalValueNis: number;
  costNis: number;
  hasOverride: boolean;
  submitting: boolean;
  onClose: () => void;
  onSave: (maxAllowedCostNis: number) => void;
  onResetToCalculated: () => void;
}) {
  const calculatedMax = useMemo(
    () => applyBudgetExtensions(baseMaxNis, approvedExtensionCostNis),
    [baseMaxNis, approvedExtensionCostNis],
  );

  const sliderMax = useMemo(() => {
    const candidates = [
      currentMaxNis * 3,
      calculatedMax * 3,
      leadTotalValueNis * 0.3,
      costNis * 2,
      5000,
      100,
    ];
    return Math.ceil(Math.max(...candidates.filter((n) => Number.isFinite(n))) / 10) * 10;
  }, [currentMaxNis, calculatedMax, leadTotalValueNis, costNis]);

  const [value, setValue] = useState(Math.round(currentMaxNis));

  useEffect(() => {
    if (open) setValue(Math.round(Math.max(0, currentMaxNis)));
  }, [open, currentMaxNis]);

  if (!open) return null;

  const clamped = Math.min(sliderMax, Math.max(0, value));

  return (
    <div className="modal modal-open z-[130]">
      <div className="modal-box max-w-md">
        <h3 className="text-lg font-bold text-gray-900">Edit max allowed</h3>
        <p className="mt-1 text-sm text-gray-500">
          Set the employee cost budget for this lead. This overrides the calculated max.
        </p>

        <div className="mt-4 rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-600">
          <p>
            Calculated max:{' '}
            <span className="font-semibold text-gray-900">
              {formatAllocationCostNis(calculatedMax)}
            </span>
            <span className="text-gray-400">
              {' '}
              ({formatAllocationCostNis(baseMaxNis)}
              {approvedExtensionCostNis > 0
                ? ` + ${formatAllocationCostNis(approvedExtensionCostNis)} ext.`
                : ''}
              )
            </span>
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Formula: 14% of 87% of lead value
            {leadTotalValueNis > 0
              ? ` (${formatAllocationCostNis(leadTotalValueNis)} → ${formatAllocationCostNis(maxLeadEmployeeCostNis(leadTotalValueNis))})`
              : ''}
          </p>
        </div>

        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
              Max allowed
            </span>
            <span className="text-lg font-bold text-gray-900">
              {formatAllocationCostNis(clamped)}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={sliderMax}
            step={10}
            value={clamped}
            disabled={submitting}
            onChange={(e) => setValue(Number(e.target.value))}
            className="range range-primary range-sm"
          />
          <div className="mt-1 flex justify-between text-[11px] text-gray-400">
            <span>{formatAllocationCostNis(0)}</span>
            <span>{formatAllocationCostNis(sliderMax)}</span>
          </div>
          <label className="mt-3 block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-500">
              Or enter amount (₪)
            </span>
            <input
              type="number"
              min={0}
              step={1}
              className="input input-bordered input-sm w-full"
              value={value}
              disabled={submitting}
              onChange={(e) => setValue(Math.max(0, Number(e.target.value) || 0))}
            />
          </label>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
          {hasOverride ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm rounded-full text-gray-600"
              disabled={submitting}
              onClick={onResetToCalculated}
            >
              Use calculated max
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-ghost btn-sm rounded-full"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="inline-flex items-center rounded-full bg-gray-900 px-5 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-60"
              disabled={submitting}
              onClick={() => onSave(Math.round(clamped * 100) / 100)}
            >
              {submitting ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
      <div className="modal-backdrop bg-black/40" onClick={submitting ? undefined : onClose} />
    </div>
  );
}

export function SummaryEditButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="ml-1 inline-flex items-center justify-center rounded-full p-1 text-gray-400 transition-colors hover:bg-white hover:text-primary"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <PencilSquareIcon className="h-4 w-4 md:h-5 md:w-5" />
    </button>
  );
}
