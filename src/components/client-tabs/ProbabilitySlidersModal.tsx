import React, { useEffect, useState } from 'react';
import { XMarkIcon, FlagIcon } from '@heroicons/react/24/outline';

export interface ProbabilitySlidersValues {
  legal: number;
  seriousness: number;
  financial: number;
}

export interface ProbabilitySlidersModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (values: ProbabilitySlidersValues) => void | Promise<void>;
  initialLegal: number;
  initialSeriousness: number;
  initialFinancial: number;
  saving?: boolean;
  /** Opens chooser for what to flag (expert / handler / conversation) */
  onFlagClick?: () => void;
  readOnly?: boolean;
}

export function clampProbabilityPart(n: number): number {
  if (Number.isNaN(n) || !Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Power curve on normalized scores (0–1). γ < 1 lifts mid/high values so “High” on all
 * three dimensions scores strongly; γ > 1 was crushing highs (~66% for three ~80s).
 * Low triplets stay low because raw L/100 is small before the power.
 */
const FACTOR_CURVE_GAMMA = 0.72;

/**
 * Case probability from three independent 0–100 scores.
 * - 100% only when Legal, Seriousness and Financial are all 100.
 * - Strong alignment across high/very-high yields a much higher total than before.
 */
export function caseProbabilityFromFactors(
  legal: number,
  seriousness: number,
  financial: number
): number {
  const L = clampProbabilityPart(legal);
  const S = clampProbabilityPart(seriousness);
  const F = clampProbabilityPart(financial);
  const l = Math.pow(L / 100, FACTOR_CURVE_GAMMA);
  const s = Math.pow(S / 100, FACTOR_CURVE_GAMMA);
  const f = Math.pow(F / 100, FACTOR_CURVE_GAMMA);
  return Math.round(((l + s + f) / 3) * 100);
}

export function probabilityLevelLabel(value: number): 'Very low' | 'Low' | 'Medium' | 'High' | 'Very high' {
  const v = clampProbabilityPart(value);
  if (v <= 20) return 'Very low';
  if (v <= 40) return 'Low';
  if (v <= 60) return 'Medium';
  if (v <= 80) return 'High';
  return 'Very high';
}

/**
 * When DB has no factor values, pick equal L=S=F so the curve’s inverse yields ~`total` case probability.
 */
export function splitProbabilityEvenly(total: number): ProbabilitySlidersValues {
  const t = clampProbabilityPart(total);
  if (t <= 0) return { legal: 0, seriousness: 0, financial: 0 };
  const v = Math.round(Math.pow(t / 100, 1 / FACTOR_CURVE_GAMMA) * 100);
  const x = clampProbabilityPart(v);
  return { legal: x, seriousness: x, financial: x };
}

const ProbabilitySlidersModal: React.FC<ProbabilitySlidersModalProps> = ({
  open,
  onClose,
  onSave,
  initialLegal,
  initialSeriousness,
  initialFinancial,
  saving = false,
  onFlagClick,
  readOnly = false,
}) => {
  const [legal, setLegal] = useState(0);
  const [seriousness, setSeriousness] = useState(0);
  const [financial, setFinancial] = useState(0);

  useEffect(() => {
    if (!open) return;
    setLegal(clampProbabilityPart(initialLegal));
    setSeriousness(clampProbabilityPart(initialSeriousness));
    setFinancial(clampProbabilityPart(initialFinancial));
  }, [open, initialLegal, initialSeriousness, initialFinancial]);

  if (!open) return null;

  const probability = caseProbabilityFromFactors(legal, seriousness, financial);

  const handleSave = () => {
    void onSave({
      legal: clampProbabilityPart(legal),
      seriousness: clampProbabilityPart(seriousness),
      financial: clampProbabilityPart(financial),
    });
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-4"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))' }}
      data-probability-sliders-modal
    >
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div
        className="relative flex max-h-[min(92dvh,calc(100dvh-1.5rem))] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-base-300 bg-base-100 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="probability-sliders-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-base-300 px-5 py-4">
          <h3 id="probability-sliders-title" className="text-lg font-bold text-base-content">
            Case probability
          </h3>
          <button type="button" className="btn btn-sm btn-circle btn-ghost" onClick={onClose} aria-label="Close">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-4">
          <p className="text-sm text-base-content/70">
            Move each field independently. <strong>Case probability</strong> combines all three: 
          </p>

          <div className="rounded-xl bg-base-200/60 px-4 py-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-base-content">Case probability</span>
            <span className="text-2xl font-bold tabular-nums text-primary">{probability}%</span>
          </div>

          <div className="divider my-1 text-xs">Field levels</div>

          {[
            {
              label: 'Legal',
              value: legal,
              id: 'prob-legal',
              onChange: setLegal,
            },
            {
              label: 'Seriousness',
              value: seriousness,
              id: 'prob-seriousness',
              onChange: setSeriousness,
            },
            {
              label: 'Financial ability',
              value: financial,
              id: 'prob-financial',
              onChange: setFinancial,
            },
          ].map((row) => (
            <div key={row.id}>
              <div className="flex justify-between items-center mb-1">
                <label htmlFor={row.id} className="text-sm font-medium text-base-content">
                  {row.label}
                </label>
                <span className="text-sm font-semibold">
                  {probabilityLevelLabel(row.value)}
                </span>
              </div>
              <input
                id={row.id}
                type="range"
                min={0}
                max={100}
                step={1}
                value={row.value}
                onChange={(e) => row.onChange(clampProbabilityPart(Number(e.target.value)))}
                className="range range-sm range-primary w-full"
              />
            </div>
          ))}

          {!readOnly && onFlagClick && (
            <div className="pt-1">
              <button
                type="button"
                className="btn btn-outline border-amber-200 text-amber-800 hover:bg-amber-50 gap-2 w-full sm:w-auto"
                onClick={onFlagClick}
                disabled={saving}
              >
                <FlagIcon className="h-5 w-5" />
                Flag…
              </button>
              <p className="text-xs text-base-content/60 mt-1.5">
                Choose whether to flag expert opinion, handler opinion, or open Interactions to flag a message.
              </p>
            </div>
          )}
        </div>

        {/* Pinned above browser / home indicator: not in scroll area */}
        <div
          className="flex shrink-0 gap-2 border-t border-base-300 bg-base-100 px-5 pt-3 sm:pb-4 shadow-[0_-4px_24px_rgba(0,0,0,0.06)] dark:shadow-[0_-4px_24px_rgba(0,0,0,0.25)] max-sm:pb-[max(1rem,calc(env(safe-area-inset-bottom,0px)+52px))]"
        >
          <button type="button" className="btn btn-outline flex-1" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary flex-1" onClick={handleSave} disabled={saving || readOnly}>
            {saving ? <span className="loading loading-spinner loading-sm" /> : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProbabilitySlidersModal;
