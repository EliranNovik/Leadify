import { getRmqAiCurrentLead } from '../rmqAiChatContext';

export type AiSignal = {
  id: string;
  level: 'warn';
  title: string;
  reason: string;
  actions: Array<{ label: string; prompt: string }>;
};

export function buildLeadSignals(input: {
  contractUnsigned?: boolean;
  meetingTomorrow?: boolean;
  lastContactDays?: number | null;
  followUpOverdue?: boolean;
  meetingSummaryMissing?: boolean;
  unansweredClientReply?: boolean;
  noHandler?: boolean;
}): AiSignal[] {
  const open = getRmqAiCurrentLead();
  const name = open?.name || 'This client';
  const number = open?.lead_number ? String(open.lead_number) : '';
  const who = [name, number].filter(Boolean).join(' ');
  const signals: AiSignal[] = [];

  if (input.contractUnsigned && input.meetingTomorrow) {
    signals.push({
      id: 'unsigned-before-meeting',
      level: 'warn',
      title: 'Contract unsigned before tomorrow’s meeting',
      reason: `${who}: meeting is tomorrow and the contract is still unsigned.`,
      actions: [
        { label: 'Draft reminder', prompt: 'Draft a concise contract-signature reminder for this client.' },
        { label: 'Open client', prompt: 'Give me the contract and signing status for this client.' },
      ],
    });
  }
  if ((input.lastContactDays || 0) >= 7) {
    signals.push({
      id: 'stale-followup',
      level: 'warn',
      title: 'No follow-up for 7+ days',
      reason: `${who}: last recorded contact was ${input.lastContactDays} days ago.`,
      actions: [{ label: 'Draft follow-up', prompt: 'Draft a detailed professional follow-up for this client.' }],
    });
  }
  if (input.meetingSummaryMissing) {
    signals.push({
      id: 'missing-summary',
      level: 'warn',
      title: 'Meeting completed but summary missing',
      reason: `${who}: a meeting occurred and no summary is recorded.`,
      actions: [{ label: 'Wrap up meeting', prompt: 'Wrap up the latest meeting for this client.' }],
    });
  }
  if (input.unansweredClientReply) {
    signals.push({
      id: 'unanswered-reply',
      level: 'warn',
      title: 'Client replied with no employee response',
      reason: `${who}: there is a client message without a recorded reply.`,
      actions: [{ label: 'Draft reply', prompt: 'Draft a reply to the latest client message.' }],
    });
  }
  if (input.followUpOverdue) {
    signals.push({
      id: 'followup-passed',
      level: 'warn',
      title: 'Follow-up date passed',
      reason: `${who}: the saved follow-up date has passed.`,
      actions: [{ label: 'Set new follow-up', prompt: 'Suggest a follow-up date and next action for this client.' }],
    });
  }
  if (input.noHandler) {
    signals.push({
      id: 'no-handler',
      level: 'warn',
      title: 'No assigned case handler',
      reason: `${who}: handler is not assigned.`,
      actions: [{ label: 'Show roles', prompt: 'Who is the handler, expert, and closer on this client?' }],
    });
  }
  return signals;
}

export function nextBestActionFromSignals(signals: AiSignal[]): {
  recommendationId: string;
  actionType: string;
  reason: string;
  executable: boolean;
} | null {
  const first = signals[0];
  if (!first) return null;
  return {
    recommendationId: `nba-${first.id}`,
    actionType: first.actions[0]?.label || first.id,
    reason: first.reason,
    executable: false,
  };
}
