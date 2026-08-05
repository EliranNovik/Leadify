import React from 'react';
import {
  PIPELINE_SUMMARY_CARDS,
  type PipelineQuickFilter,
  type PipelineSummaryCounts,
} from '../lib/pipelineSummary';

/** One gradient per box, shared by the closer/scheduler pipeline and the case pipeline. */
export const PIPELINE_SUMMARY_GRADIENTS: Record<Exclude<PipelineQuickFilter, null>, string> = {
  missed_followup: 'bg-gradient-to-tr from-pink-500 via-rose-500 to-orange-500',
  high_value: 'bg-gradient-to-tr from-teal-600 via-emerald-500 to-green-500',
  lost_interaction: 'bg-gradient-to-tr from-amber-500 via-orange-500 to-yellow-500',
  missed_interaction: 'bg-gradient-to-tr from-sky-600 via-cyan-500 to-blue-500',
  upcoming_meeting: 'bg-gradient-to-tr from-purple-600 via-indigo-600 to-blue-500',
};

type Props = {
  counts: PipelineSummaryCounts;
  quickFilter: PipelineQuickFilter;
  /** Called with the clicked box, or null when the active box is clicked again. */
  onToggle: (next: PipelineQuickFilter) => void;
  className?: string;
};

/** Clickable summary boxes that also act as quick filters for the table below them. */
const PipelineSummaryCards: React.FC<Props> = ({ counts, quickFilter, onToggle, className }) => (
  <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5 ${className || ''}`}>
    {PIPELINE_SUMMARY_CARDS.map((card) => {
      const Icon = card.icon;
      const active = quickFilter === card.id;
      return (
        <button
          key={card.id}
          type="button"
          aria-pressed={active}
          onClick={() => onToggle(active ? null : card.id)}
          className={`${PIPELINE_SUMMARY_GRADIENTS[card.id]} flex items-center justify-between gap-3 rounded-2xl p-5 text-left text-white shadow-xl transition-all duration-300 hover:shadow-2xl ${
            active ? 'ring-4 ring-white/70 scale-[1.02]' : 'hover:scale-105'
          }`}
        >
          <div className="min-w-0">
            <p className="text-sm font-medium text-white/90">{card.label}</p>
            <p className="text-3xl font-bold">{counts[card.key]}</p>
            <p className="mt-1 truncate text-xs text-white/80" title={card.hint}>
              {card.hint}
            </p>
          </div>
          <div className="shrink-0 rounded-full bg-white/20 p-3">
            <Icon className="h-7 w-7" />
          </div>
        </button>
      );
    })}
  </div>
);

export default PipelineSummaryCards;
