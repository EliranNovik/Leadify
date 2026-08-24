import React from 'react';
import {
  ArrowTrendingDownIcon,
  BanknotesIcon,
  BellAlertIcon,
  CalendarDaysIcon,
  InboxArrowDownIcon,
} from '@heroicons/react/24/outline';
import {
  HIGH_VALUE_NIS_THRESHOLD,
  LOST_INTERACTION_DAYS,
} from '../../lib/pipelineSummary';
import { PIPELINE_SUMMARY_GRADIENTS } from '../PipelineSummaryCards';

export type HandlerQuickFilter =
  | 'today_followup'
  | 'high_value'
  | 'lost_interaction'
  | 'missed_interaction'
  | 'missed_followup'
  | null;

export type HandlerSummaryCounts = {
  todayFollowUp: number;
  highValue: number;
  lostInteraction: number;
  missedInteraction: number;
  missedFollowUp: number;
};

const CARDS: Array<{
  id: Exclude<HandlerQuickFilter, null>;
  key: keyof HandlerSummaryCounts;
  label: string;
  hint: string;
  gradient: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    id: 'today_followup',
    key: 'todayFollowUp',
    label: "Today's follow up",
    hint: 'Follow-up date is today',
    gradient: PIPELINE_SUMMARY_GRADIENTS.upcoming_meeting,
    icon: CalendarDaysIcon,
  },
  {
    id: 'high_value',
    key: 'highValue',
    label: 'High value',
    hint: `Above ₪${HIGH_VALUE_NIS_THRESHOLD.toLocaleString('en-US')} converted to NIS`,
    gradient: PIPELINE_SUMMARY_GRADIENTS.high_value,
    icon: BanknotesIcon,
  },
  {
    id: 'lost_interaction',
    key: 'lostInteraction',
    label: 'Lost interaction',
    hint: `Active cases with no contact for ${LOST_INTERACTION_DAYS} days`,
    gradient: PIPELINE_SUMMARY_GRADIENTS.lost_interaction,
    icon: ArrowTrendingDownIcon,
  },
  {
    id: 'missed_interaction',
    key: 'missedInteraction',
    label: 'Missed interaction',
    hint: 'Client contacted us and we have not replied',
    gradient: PIPELINE_SUMMARY_GRADIENTS.missed_interaction,
    icon: InboxArrowDownIcon,
  },
  {
    id: 'missed_followup',
    key: 'missedFollowUp',
    label: 'Missed follow up',
    hint: 'Follow-up date already passed',
    gradient: PIPELINE_SUMMARY_GRADIENTS.missed_followup,
    icon: BellAlertIcon,
  },
];

type Props = {
  counts: HandlerSummaryCounts;
  quickFilter: HandlerQuickFilter;
  onToggle: (next: HandlerQuickFilter) => void;
  className?: string;
};

const HandlerSummaryCards: React.FC<Props> = ({ counts, quickFilter, onToggle, className }) => (
  <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5 ${className || ''}`}>
    {CARDS.map((card) => {
      const Icon = card.icon;
      const active = quickFilter === card.id;
      return (
        <button
          key={card.id}
          type="button"
          aria-pressed={active}
          onClick={() => onToggle(active ? null : card.id)}
          className={`${card.gradient} flex items-center justify-between gap-3 rounded-2xl p-5 text-left text-white shadow-xl transition-all duration-300 hover:shadow-2xl ${
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

export default HandlerSummaryCards;
