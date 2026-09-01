import React from 'react';
import { CalendarDaysIcon, MapPinIcon } from '@heroicons/react/24/outline';
import { ChatLeadNumberText } from './ChatLeadNumberText';

export type ChatMeetingFact = {
  date?: string | null;
  time?: string | null;
  location?: string | null;
  status?: string | null;
  summary?: string | null;
  brief?: string | null;
  missing?: boolean;
};

export type ChatMeetingCardData = {
  leadNumber?: string;
  displayName?: string;
  caseBrief?: string | null;
  nextMeeting?: ChatMeetingFact | null;
  askedMeeting?: ChatMeetingFact | null;
  otherUpcoming?: Array<ChatMeetingFact | null>;
  recentPast?: Array<ChatMeetingFact | null>;
};

export function parseClientMeetingCard(raw: string): ChatMeetingCardData | null {
  try {
    const parsed = JSON.parse(raw) as ChatMeetingCardData;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.leadNumber && !parsed.nextMeeting && !parsed.askedMeeting && !parsed.recentPast) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function formatMeetingDate(raw?: string | null): string {
  const value = String(raw || '').trim();
  if (!value) return '—';
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!iso) return value;
  const date = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Jerusalem',
  });
}

function formatStatus(raw?: string | null): string {
  const value = String(raw || '').trim();
  if (!value) return '—';
  return value.replace(/_/g, ' ');
}

function textIsMostlyHebrew(text: string): boolean {
  const hebrew = (text.match(/[\u0590-\u05FF]/g) || []).length;
  if (!hebrew) return false;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  return hebrew >= latin;
}

function Field({
  label,
  value,
  rtl,
}: {
  label: string;
  value?: string | null;
  rtl?: boolean;
}) {
  const text = String(value ?? '').trim();
  if (!text || text === '—') return null;
  const useRtl = rtl ?? textIsMostlyHebrew(text);
  return (
    <div className={`ai-meeting-field ${useRtl ? 'ai-meeting-field-rtl' : ''}`} dir={useRtl ? 'rtl' : 'ltr'}>
      <div className="ai-meeting-field-label">{label}</div>
      <div className={`ai-meeting-field-value ${useRtl ? 'text-right' : 'text-left'}`}>{text}</div>
    </div>
  );
}

function MeetingCardBlock({
  title,
  meeting,
  caseBrief,
  leadNumber,
  displayName,
  emptyText,
}: {
  title: string;
  meeting?: ChatMeetingFact | null;
  caseBrief?: string | null;
  leadNumber?: string;
  displayName?: string;
  emptyText?: string;
}) {
  const missing = Boolean(meeting?.missing) || !meeting;
  const when = meeting && !meeting.missing
    ? [formatMeetingDate(meeting.date), meeting.time && meeting.time !== '—' ? meeting.time : '']
        .filter(Boolean)
        .join(' · ')
    : '';

  return (
    <div className="ai-meeting-card">
      <div className="ai-meeting-card-head">
        <span className="ai-meeting-card-title">{title}</span>
        {leadNumber ? (
          <span className="ai-meeting-card-lead">
            <ChatLeadNumberText text={leadNumber} />
            {displayName ? <span className="ai-meeting-card-name">{displayName}</span> : null}
          </span>
        ) : null}
      </div>
      {missing ? (
        <p className="ai-meeting-empty">{emptyText || 'No meeting on file.'}</p>
      ) : (
        <div className="ai-meeting-body">
          <div className="ai-meeting-when">
            <CalendarDaysIcon className="h-5 w-5 shrink-0" />
            <span>{when || '—'}</span>
          </div>
          {meeting?.location ? (
            <div className="ai-meeting-when">
              <MapPinIcon className="h-5 w-5 shrink-0" />
              <span>{meeting.location}</span>
            </div>
          ) : null}
          <Field label="Status" value={formatStatus(meeting?.status)} rtl={false} />
          <Field label="Brief" value={meeting?.brief} />
          <Field label="Summary" value={meeting?.summary} />
          <Field label="Case brief" value={caseBrief} />
        </div>
      )}
    </div>
  );
}

export function ChatMeetingCards({
  data,
}: {
  data: ChatMeetingCardData;
}) {
  const asked = data.askedMeeting;
  const next = data.nextMeeting;
  const last = (data.recentPast || []).find(Boolean) || null;
  const extras = (data.otherUpcoming || []).filter((row): row is ChatMeetingFact => Boolean(row));

  const cards: React.ReactNode[] = [];
  if (asked) {
    cards.push(
      <MeetingCardBlock
        key="asked"
        title={asked.missing ? 'Meeting on that date' : 'Asked meeting'}
        meeting={asked}
        caseBrief={data.caseBrief}
        leadNumber={data.leadNumber}
        displayName={data.displayName}
        emptyText={`No meeting on ${formatMeetingDate(asked.date)}.`}
      />,
    );
  }
  cards.push(
    <MeetingCardBlock
      key="next"
      title="Next meeting"
      meeting={next}
      caseBrief={asked ? null : data.caseBrief}
      leadNumber={data.leadNumber}
      displayName={data.displayName}
      emptyText="No upcoming meeting."
    />,
  );
  if (!next && last) {
    cards.push(
      <MeetingCardBlock
        key="last"
        title="Last meeting"
        meeting={last}
        leadNumber={data.leadNumber}
        displayName={data.displayName}
      />,
    );
  }
  extras.slice(0, 2).forEach((row, index) => {
    cards.push(
      <MeetingCardBlock
        key={`extra-${index}`}
        title="Also upcoming"
        meeting={row}
        leadNumber={data.leadNumber}
        displayName={data.displayName}
      />,
    );
  });

  return <div className="ai-meeting-stack">{cards}</div>;
}
