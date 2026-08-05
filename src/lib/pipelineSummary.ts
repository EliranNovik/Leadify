import type React from 'react';
import {
  ArrowTrendingDownIcon,
  BanknotesIcon,
  BellAlertIcon,
  CalendarDaysIcon,
  InboxArrowDownIcon,
} from '@heroicons/react/24/outline';
import { localTodayYmd } from './meetingRescheduleCancel';

/**
 * The five pipeline summary boxes, shared by the case pipeline and the closer/scheduler
 * pipeline. Each page renders them in its own visual style but counts and filters with these
 * definitions so the numbers always mean the same thing.
 */

/** Lead value considered high, in NIS, after converting from the lead's own currency. */
export const HIGH_VALUE_NIS_THRESHOLD = 20000;
/** A lead with no interaction for this long counts as a lost interaction. */
export const LOST_INTERACTION_DAYS = 30;

export type PipelineQuickFilter =
  | 'missed_followup'
  | 'high_value'
  | 'lost_interaction'
  | 'missed_interaction'
  | 'upcoming_meeting'
  | null;

/** Minimum row shape the boxes need; each pipeline maps its own rows onto it. */
export type PipelineSummaryRow = {
  /** Date only (yyyy-mm-dd) or any parseable date string. */
  follow_up: string | null;
  /** Lead value converted to NIS. */
  value_nis: number;
  last_interaction: string | null;
  /** Client's latest touch was inbound and we have not replied on any channel. */
  awaiting_reply: boolean;
  /** Earliest upcoming meeting date key, or the most recent past one. */
  next_meeting: string | null;
  is_inactive: boolean;
  created_at: string | null;
};

export function parseDateMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.getTime();
}

export function startOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function lostInteractionCutoffMs(): number {
  return startOfTodayMs() - LOST_INTERACTION_DAYS * 86400000;
}

export function isMissedFollowUp(row: PipelineSummaryRow, todayMs: number): boolean {
  const ms = parseDateMs(row.follow_up);
  if (ms == null) return false;
  const day = new Date(ms);
  day.setHours(0, 0, 0, 0);
  return day.getTime() < todayMs;
}

export function isHighValue(row: PipelineSummaryRow): boolean {
  return row.value_nis > HIGH_VALUE_NIS_THRESHOLD;
}

/**
 * Active lead whose last interaction of any kind is older than the cutoff. Leads that were
 * never contacted only count once they are older than the same window, so brand new leads
 * are not flagged on day one.
 */
export function isLostInteraction(row: PipelineSummaryRow, cutoffMs: number): boolean {
  if (row.is_inactive) return false;
  const lastMs = parseDateMs(row.last_interaction);
  if (lastMs != null) return lastMs < cutoffMs;
  const createdMs = parseDateMs(row.created_at);
  return createdMs != null && createdMs < cutoffMs;
}

export function isMissedInteraction(row: PipelineSummaryRow): boolean {
  return row.awaiting_reply;
}

/** True when the lead has a non-canceled meeting on today or later. */
export function hasUpcomingMeeting(row: PipelineSummaryRow, todayKey: string): boolean {
  return Boolean(row.next_meeting && row.next_meeting >= todayKey);
}

/** True when the shown meeting date is strictly before today. */
export function isPastMeetingDate(value: string | null | undefined, todayKey: string): boolean {
  return Boolean(value && value < todayKey);
}

export type PipelineSummaryCounts = {
  missedFollowUp: number;
  highValue: number;
  lostInteraction: number;
  missedInteraction: number;
  upcomingMeeting: number;
};

export function summarizePipelineRows(rows: PipelineSummaryRow[]): PipelineSummaryCounts {
  const todayMs = startOfTodayMs();
  const todayKey = localTodayYmd();
  const cutoff = lostInteractionCutoffMs();
  const counts: PipelineSummaryCounts = {
    missedFollowUp: 0,
    highValue: 0,
    lostInteraction: 0,
    missedInteraction: 0,
    upcomingMeeting: 0,
  };
  rows.forEach((row) => {
    if (isMissedFollowUp(row, todayMs)) counts.missedFollowUp += 1;
    if (isHighValue(row)) counts.highValue += 1;
    if (isLostInteraction(row, cutoff)) counts.lostInteraction += 1;
    if (isMissedInteraction(row)) counts.missedInteraction += 1;
    if (hasUpcomingMeeting(row, todayKey)) counts.upcomingMeeting += 1;
  });
  return counts;
}

export function matchesQuickFilter(
  row: PipelineSummaryRow,
  quickFilter: Exclude<PipelineQuickFilter, null>,
): boolean {
  switch (quickFilter) {
    case 'missed_followup':
      return isMissedFollowUp(row, startOfTodayMs());
    case 'high_value':
      return isHighValue(row);
    case 'lost_interaction':
      return isLostInteraction(row, lostInteractionCutoffMs());
    case 'missed_interaction':
      return isMissedInteraction(row);
    case 'upcoming_meeting':
      return hasUpcomingMeeting(row, localTodayYmd());
    default:
      return true;
  }
}

export type PipelineSummaryCardDef = {
  id: Exclude<PipelineQuickFilter, null>;
  key: keyof PipelineSummaryCounts;
  label: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
};

export const PIPELINE_SUMMARY_CARDS: PipelineSummaryCardDef[] = [
  {
    id: 'missed_followup',
    key: 'missedFollowUp',
    label: 'Missed follow up',
    hint: 'Follow-up date already passed',
    icon: BellAlertIcon,
  },
  {
    id: 'high_value',
    key: 'highValue',
    label: 'High value',
    hint: `Above ₪${HIGH_VALUE_NIS_THRESHOLD.toLocaleString('en-US')} converted to NIS`,
    icon: BanknotesIcon,
  },
  {
    id: 'lost_interaction',
    key: 'lostInteraction',
    label: 'Lost interaction',
    hint: `Active leads with no contact for ${LOST_INTERACTION_DAYS} days`,
    icon: ArrowTrendingDownIcon,
  },
  {
    id: 'missed_interaction',
    key: 'missedInteraction',
    label: 'Missed interaction',
    hint: 'Client contacted us and we have not replied',
    icon: InboxArrowDownIcon,
  },
  {
    id: 'upcoming_meeting',
    key: 'upcomingMeeting',
    label: 'Upcoming meetings',
    hint: 'Leads with a meeting on today or later',
    icon: CalendarDaysIcon,
  },
];
