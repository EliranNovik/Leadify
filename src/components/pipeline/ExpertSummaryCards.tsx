import React from 'react';
import {
  BanknotesIcon,
  CalendarDaysIcon,
  CheckBadgeIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { HIGH_VALUE_NIS_THRESHOLD } from '../../lib/pipelineSummary';
import { PIPELINE_SUMMARY_GRADIENTS } from '../PipelineSummaryCards';

export type ExpertQuickFilter = 'upcoming_meeting' | 'missing_today' | 'high_value' | null;

export type ExpertSummaryCounts = {
  upcomingMeeting: number;
  resultsThisMonth: number;
  missingToday: number;
  highValue: number;
};

type CardId = 'upcoming_meeting' | 'results_this_month' | 'missing_today' | 'high_value';

const CARDS: Array<{
  id: CardId;
  key: keyof ExpertSummaryCounts;
  label: string;
  hint: string;
  filter: ExpertQuickFilter;
  gradient: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    id: 'upcoming_meeting',
    key: 'upcomingMeeting',
    label: 'Upcoming meetings',
    hint: 'Meetings today or later',
    filter: 'upcoming_meeting',
    gradient: PIPELINE_SUMMARY_GRADIENTS.upcoming_meeting,
    icon: CalendarDaysIcon,
  },
  {
    id: 'results_this_month',
    key: 'resultsThisMonth',
    label: 'Expert results this month',
    hint: 'Your expert opinions this calendar month',
    filter: null,
    gradient: PIPELINE_SUMMARY_GRADIENTS.lost_interaction,
    icon: CheckBadgeIcon,
  },
  {
    id: 'missing_today',
    key: 'missingToday',
    label: "Today's meetings missing results",
    hint: 'Meetings today with no expert result yet',
    filter: 'missing_today',
    gradient: PIPELINE_SUMMARY_GRADIENTS.missed_followup,
    icon: ExclamationTriangleIcon,
  },
  {
    id: 'high_value',
    key: 'highValue',
    label: 'High value',
    hint: `Above ₪${HIGH_VALUE_NIS_THRESHOLD.toLocaleString('en-US')} converted to NIS`,
    filter: 'high_value',
    gradient: PIPELINE_SUMMARY_GRADIENTS.high_value,
    icon: BanknotesIcon,
  },
];

type Props = {
  counts: ExpertSummaryCounts;
  quickFilter: ExpertQuickFilter;
  onToggle: (next: ExpertQuickFilter) => void;
  className?: string;
};

const ExpertSummaryCards: React.FC<Props> = ({ counts, quickFilter, onToggle, className }) => (
  <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 ${className || ''}`}>
    {CARDS.map((card) => {
      const Icon = card.icon;
      const clickable = card.filter != null;
      const active = clickable && quickFilter === card.filter;
      const classNameCard = `${card.gradient} flex items-center justify-between gap-3 rounded-2xl p-5 text-left text-white shadow-xl transition-all duration-300 ${
        clickable ? 'hover:shadow-2xl' : ''
      } ${active ? 'ring-4 ring-white/70 scale-[1.02]' : clickable ? 'hover:scale-105' : ''}`;

      const inner = (
        <>
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
        </>
      );

      if (!clickable) {
        return (
          <div key={card.id} className={classNameCard}>
            {inner}
          </div>
        );
      }

      return (
        <button
          key={card.id}
          type="button"
          aria-pressed={active}
          onClick={() => onToggle(active ? null : card.filter)}
          className={classNameCard}
        >
          {inner}
        </button>
      );
    })}
  </div>
);

export default ExpertSummaryCards;
