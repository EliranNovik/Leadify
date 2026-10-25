/**
 * The log of meeting reminders that were actually delivered (public.meeting_reminder_sends).
 * Written by the bulk reminder drawer and by the single-meeting reminder buttons; read by the
 * Calendar so a meeting that has already been reminded shows its hook.
 *
 * Writes are best effort: a reminder that reached the client must never be reported as failed
 * just because this log could not be written.
 */

import { supabase } from './supabase';

export type MeetingReminderChannel = 'whatsapp' | 'email';

export type MeetingReminderSendInput = {
  /** Calendar row key: the numeric meetings.id as a string, or `legacy_<id>`. */
  rowKey: string;
  channel: MeetingReminderChannel;
  language?: string | null;
  recipientCount?: number;
};

export type MeetingReminderMark = {
  rowKey: string;
  /** Most recent send across all channels. */
  lastSentAt: string;
  channels: MeetingReminderChannel[];
  sentBy: string | null;
};

const LEGACY_PREFIX = 'legacy_';

/** Splits a calendar row key into the two id columns the log keeps alongside row_key. */
export function resolveReminderRowIds(rowKey: string): {
  meetingId: number | null;
  legacyLeadId: number | null;
} {
  const key = String(rowKey ?? '').trim();
  if (!key) return { meetingId: null, legacyLeadId: null };

  if (key.startsWith(LEGACY_PREFIX)) {
    const numeric = parseInt(key.slice(LEGACY_PREFIX.length), 10);
    return { meetingId: null, legacyLeadId: Number.isFinite(numeric) && numeric > 0 ? numeric : null };
  }

  const numeric = Number(key);
  if (Number.isFinite(numeric) && numeric > 0 && Number.isInteger(numeric)) {
    return { meetingId: numeric, legacyLeadId: null };
  }
  return { meetingId: null, legacyLeadId: null };
}

async function resolveSender(): Promise<{ sentBy: string | null; employeeId: number | null }> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.id) return { sentBy: null, employeeId: null };

    const { data: userRow } = await supabase
      .from('users')
      .select('full_name, employee_id, tenants_employee!employee_id(display_name)')
      .eq('auth_id', user.id)
      .maybeSingle();

    const employee = Array.isArray(userRow?.tenants_employee)
      ? userRow?.tenants_employee[0]
      : userRow?.tenants_employee;
    const employeeId = Number(userRow?.employee_id);

    return {
      sentBy: (employee as any)?.display_name || userRow?.full_name || user.email || null,
      employeeId: Number.isFinite(employeeId) && employeeId > 0 ? employeeId : null,
    };
  } catch {
    return { sentBy: null, employeeId: null };
  }
}

/** Records one or more delivered reminders. Never throws. */
export async function recordMeetingReminderSends(
  sends: MeetingReminderSendInput[],
): Promise<void> {
  const usable = (sends || []).filter((send) => String(send.rowKey ?? '').trim() !== '');
  if (usable.length === 0) return;

  try {
    const { sentBy, employeeId } = await resolveSender();
    const rows = usable.map((send) => {
      const { meetingId, legacyLeadId } = resolveReminderRowIds(send.rowKey);
      return {
        row_key: String(send.rowKey),
        meeting_id: meetingId,
        legacy_lead_id: legacyLeadId,
        channel: send.channel,
        language: send.language ?? null,
        recipient_count: send.recipientCount ?? 0,
        sent_by: sentBy,
        sent_by_employee_id: employeeId,
      };
    });

    const { error } = await supabase.from('meeting_reminder_sends').insert(rows);
    if (error) {
      console.warn('recordMeetingReminderSends: reminder was sent but the log row failed', error);
    }
  } catch (error) {
    console.warn('recordMeetingReminderSends: reminder was sent but the log row failed', error);
  }
}

export async function recordMeetingReminderSend(send: MeetingReminderSendInput): Promise<void> {
  await recordMeetingReminderSends([send]);
}

/**
 * Latest reminder per calendar row, for the rows currently on screen.
 * Returns an empty map rather than throwing, so a missing table only costs the hook.
 */
export async function fetchMeetingReminderMarks(
  rowKeys: string[],
): Promise<Map<string, MeetingReminderMark>> {
  const marks = new Map<string, MeetingReminderMark>();
  const keys = Array.from(new Set((rowKeys || []).map((k) => String(k ?? '').trim()).filter(Boolean)));
  if (keys.length === 0) return marks;

  const { data, error } = await supabase
    .from('meeting_reminder_sends')
    .select('row_key, channel, sent_at, sent_by')
    .in('row_key', keys)
    .order('sent_at', { ascending: false });

  if (error) {
    console.warn('fetchMeetingReminderMarks failed', error);
    return marks;
  }

  for (const row of data || []) {
    const rowKey = String((row as any).row_key);
    const channel = (row as any).channel as MeetingReminderChannel;
    const existing = marks.get(rowKey);

    if (!existing) {
      // Rows arrive newest first, so the first one seen carries the latest timestamp.
      marks.set(rowKey, {
        rowKey,
        lastSentAt: String((row as any).sent_at),
        channels: [channel],
        sentBy: (row as any).sent_by ?? null,
      });
      continue;
    }
    if (!existing.channels.includes(channel)) existing.channels.push(channel);
  }

  return marks;
}

export function describeMeetingReminderMark(mark: MeetingReminderMark): string {
  const channelLabels = mark.channels
    .map((channel) => (channel === 'whatsapp' ? 'WhatsApp' : 'Email'))
    .join(' + ');
  const when = new Date(mark.lastSentAt);
  const formattedWhen = Number.isNaN(when.getTime())
    ? mark.lastSentAt
    : when.toLocaleString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });

  return `${channelLabels || 'Reminder'} reminder sent ${formattedWhen}${mark.sentBy ? ` by ${mark.sentBy}` : ''}`;
}
