import React, { useMemo } from 'react';
import { ScaleIcon, ExclamationTriangleIcon, BanknotesIcon } from '@heroicons/react/24/outline';
import {
  caseProbabilityFromFactors,
  clampProbabilityPart,
  probabilityLevelLabel,
} from './client-tabs/ProbabilitySlidersModal';

export type ProbabilityFactors = {
  legal_potential: number;
  seriousness: number;
  financial_ability: number;
};

type Props = {
  value: ProbabilityFactors;
  onChange: (next: ProbabilityFactors) => void;
  /** Optional: show delta vs starting probability */
  baselineProbability?: number | null;
};

const ProbabilityFactorsSliders: React.FC<Props> = ({ value, onChange, baselineProbability = null }) => {
  const computed = useMemo(() => {
    return caseProbabilityFromFactors(value.legal_potential, value.seriousness, value.financial_ability);
  }, [value.financial_ability, value.legal_potential, value.seriousness]);

  const delta = baselineProbability == null ? null : computed - clampProbabilityPart(baselineProbability);

  const setField = (key: keyof ProbabilityFactors, nextValue: number) => {
    onChange({
      ...value,
      [key]: clampProbabilityPart(nextValue),
    });
  };

  const scoreTone =
    computed >= 85
      ? { valueClass: 'text-emerald-700', barClass: 'bg-emerald-500', label: 'Very high chance' }
      : computed >= 70
        ? { valueClass: 'text-emerald-700', barClass: 'bg-emerald-500', label: 'High chance' }
        : computed >= 40
          ? { valueClass: 'text-amber-700', barClass: 'bg-amber-500', label: 'Moderate chance' }
          : { valueClass: 'text-rose-700', barClass: 'bg-rose-500', label: 'Low chance' };

  return (
    <div className="rounded-2xl border border-black/5 bg-white shadow-[0_4px_12px_rgba(0,0,0,0.06)] p-4 space-y-4">
      <div className="text-center">
        <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Case probability</p>
        <div className="flex items-end justify-center gap-2">
          <span className={`text-4xl font-extrabold leading-none ${scoreTone.valueClass}`}>{computed}%</span>
          {delta != null && delta !== 0 && (
            <span className={`text-sm font-semibold ${delta > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
              {delta > 0 ? `+${delta}` : `${delta}`}
            </span>
          )}
        </div>
        <p className="mt-1 text-xs font-medium text-gray-600">{scoreTone.label}</p>
        <div className="mt-2 h-2 w-full rounded-full bg-gray-100 overflow-hidden">
          <div className={`h-full rounded-full ${scoreTone.barClass}`} style={{ width: `${computed}%` }} />
        </div>
      </div>

      <div className="space-y-3">
        {[
          {
            key: 'legal_potential' as const,
            label: 'Legal',
            icon: <ScaleIcon className="w-4 h-4 text-gray-400" />,
            v: value.legal_potential,
          },
          {
            key: 'seriousness' as const,
            label: 'Seriousness',
            icon: <ExclamationTriangleIcon className="w-4 h-4 text-gray-400" />,
            v: value.seriousness,
          },
          {
            key: 'financial_ability' as const,
            label: 'Financial ability',
            icon: <BanknotesIcon className="w-4 h-4 text-gray-400" />,
            v: value.financial_ability,
          },
        ].map((row) => (
          <div key={row.key} className="rounded-xl border border-gray-100 bg-gray-50/70 px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm text-gray-700">
                {row.icon}
                <span className="font-medium">{row.label}</span>
              </div>
              <span className="text-sm font-bold text-gray-900">{probabilityLevelLabel(row.v)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={row.v}
              onChange={(e) => setField(row.key, Number(e.target.value))}
              className="range range-primary w-full mt-2"
            />
          </div>
        ))}
      </div>
    </div>
  );
};

export default ProbabilityFactorsSliders;

