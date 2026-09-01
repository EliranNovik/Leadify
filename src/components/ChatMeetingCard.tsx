import React from 'react';
import { BuildingOffice2Icon, CalendarDaysIcon, EnvelopeIcon, MapPinIcon, PhoneIcon, VideoCameraIcon } from '@heroicons/react/24/outline';
import { getValidTeamsLink } from '../lib/meetingJoinLink';
import { getSoftStageBadgeStyle, getStageColour, getStageName } from '../lib/stageUtils';
import { ChatLeadNumberText } from './ChatLeadNumberText';
import { ChatEmployeeNameText, type ChatEmployeeHit } from './ChatEmployeeNameText';

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
    const parsed = JSON.parse(raw) as ChatMeetingCardData & { kind?: string };
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.kind === 'calendar_day') return null;
    if (!parsed.leadNumber && !parsed.nextMeeting && !parsed.askedMeeting && !parsed.recentPast) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export type ChatCalendarMeetingItem = {
  time?: string | null;
  leadNumber?: string | null;
  name?: string | null;
  location?: string | null;
  joinUrl?: string | null;
  manager?: string | null;
  helper?: string | null;
  category?: string | null;
  topic?: string | null;
  totalValue?: string | null;
  scheduler?: string | null;
  stage?: string | null;
  internal?: boolean;
  participants?: string[] | null;
};

export type ChatCalendarDayData = {
  kind: 'calendar_day';
  date?: string;
  count?: number;
  meetings: ChatCalendarMeetingItem[];
};

function cleanCardText(value?: string | null): string {
  const text = String(value || '').trim();
  return !text || text === '—' ? '' : text;
}

function CalendarStageBadge({ stage }: { stage: string }) {
  const stageStr = stage.trim();
  if (!stageStr) return null;
  const stageName = getStageName(stageStr) || stageStr;
  const stageColour = getStageColour(stageStr);
  const softBadgeStyle = getSoftStageBadgeStyle(stageColour, stageStr);

  return (
    <span
      className="badge stage-badge ai-cal-meeting-stage-badge rounded-full shrink-0 border-0 text-xs px-2.5 py-0.5"
      style={{
        backgroundColor: softBadgeStyle.backgroundColor,
        color: softBadgeStyle.color,
      }}
      title={stageName}
    >
      {stageName}
    </span>
  );
}

function uniqueCardPeople(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const value of values) {
    for (const part of String(value || '').split(/,|\band\b/i)) {
      const name = part.replace(/\+\d+\s+more/i, '').replace(/[.,;]+$/g, '').trim();
      if (!name || name === '—') continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      names.push(name);
    }
  }
  return names;
}

function isOnlineMeetingLocation(location?: string | null): boolean {
  const value = String(location || '').trim().toLowerCase();
  return value === 'online' || value === 'teams' || value === 'zoom';
}

function isPhoneCallLocation(location?: string | null): boolean {
  const value = String(location || '').trim().toLowerCase();
  return (
    value === '11' ||
    value === 'phone' ||
    value === 'phonecall' ||
    value === 'phone call' ||
    value.includes('phone call')
  );
}

function isEmailMeetingLocation(location?: string | null): boolean {
  const value = String(location || '').trim().toLowerCase();
  return (
    value === '18' ||
    value === 'e-mail' ||
    value === 'email' ||
    value === 'e-mail meeting' ||
    value === 'email meeting' ||
    value.includes('e-mail meeting') ||
    value.includes('email meeting')
  );
}

function meetingLocationIcon(location?: string | null) {
  if (isPhoneCallLocation(location)) return PhoneIcon;
  if (isEmailMeetingLocation(location)) return EnvelopeIcon;
  if (isOnlineMeetingLocation(location)) return VideoCameraIcon;
  return BuildingOffice2Icon;
}

export function parseCalendarDayCards(raw: string): ChatCalendarDayData | null {
  try {
    const parsed = JSON.parse(raw) as ChatCalendarDayData;
    if (!parsed || typeof parsed !== 'object' || parsed.kind !== 'calendar_day') return null;
    if (!Array.isArray(parsed.meetings) || parsed.meetings.length === 0) return null;
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

function CalendarMeetingCard({
  meeting,
  employees,
}: {
  meeting: ChatCalendarMeetingItem;
  employees: ChatEmployeeHit[];
}) {
  const time = cleanCardText(meeting.time);
  const name = cleanCardText(meeting.name);
  const stage = cleanCardText(meeting.stage);
  const leadNumber = cleanCardText(meeting.leadNumber);
  const location = cleanCardText(meeting.location);
  const manager = cleanCardText(meeting.manager);
  const helper = cleanCardText(meeting.helper);
  const joinUrl = getValidTeamsLink(meeting.joinUrl);
  const online = isOnlineMeetingLocation(location);
  const internal = Boolean(meeting.internal) || (!leadNumber && /^internal meeting$/i.test(name));
  const participants = uniqueCardPeople(meeting.participants || []);
  const people = internal
    ? []
    : [
        manager ? { role: 'Manager', name: manager } : null,
        helper && helper.toLowerCase() !== manager.toLowerCase()
          ? { role: 'Helper', name: helper }
          : null,
      ].filter((row): row is { role: string; name: string } => Boolean(row));
  const LocationIcon = meetingLocationIcon(location);
  const details = [
    { label: 'Category', value: cleanCardText(meeting.category) },
    { label: 'Total value', value: cleanCardText(meeting.totalValue) },
    { label: 'Topic', value: cleanCardText(meeting.topic) },
    { label: 'Scheduler', value: cleanCardText(meeting.scheduler), employee: true },
  ];

  const showFooter = Boolean(people.length || participants.length || (online && joinUrl));

  return (
    <div className="ai-cal-meeting-row">
      <div className="ai-meeting-card ai-cal-meeting-card">
        <div className="ai-cal-meeting-top">
          <div className="ai-cal-meeting-when">
            <span className="ai-cal-meeting-time">{time || '—'}</span>
            {location ? (
              <span className="ai-cal-meeting-loc">
                <LocationIcon className="ai-cal-meeting-loc-icon" />
                {location}
              </span>
            ) : null}
          </div>
          {leadNumber ? (
            <span className="ai-cal-meeting-lead">
              <ChatLeadNumberText text={leadNumber} />
            </span>
          ) : null}
        </div>
        {name ? <div className="ai-cal-meeting-name">{name}</div> : null}
        {!internal && stage ? (
          <div className="ai-cal-meeting-stage">
            <CalendarStageBadge stage={stage} />
          </div>
        ) : null}
        {showFooter ? (
          <div className="ai-cal-meeting-footer">
            {internal && participants.length ? (
              <div className="ai-cal-meeting-crew">
                <div className="ai-cal-meeting-participants">
                  {participants.map((person, index) => (
                    <div key={`${person}-${index}`} className="ai-cal-meeting-participant">
                      <ChatEmployeeNameText text={person} employees={employees} compact />
                    </div>
                  ))}
                </div>
              </div>
            ) : people.length ? (
              <div className="ai-cal-meeting-crew">
                <div className="ai-cal-meeting-people">
                  {people.map((person) => (
                    <div key={`${person.role}-${person.name}`} className="ai-cal-meeting-person">
                      <span className="ai-cal-meeting-role">{person.role}</span>
                      <ChatEmployeeNameText text={person.name} employees={employees} compact />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <span />
            )}
            {online && joinUrl ? (
              <a
                href={joinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ai-cal-meeting-join ai-send-btn"
              >
                <VideoCameraIcon className="h-5 w-5 shrink-0" />
                Join
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="ai-meeting-card ai-cal-meeting-details">
        {details.map((row) => (
          <div key={row.label} className="ai-cal-meeting-detail">
            <span className="ai-cal-meeting-detail-label">{row.label}</span>
            <span className="ai-cal-meeting-detail-value">
              {row.employee && row.value ? (
                <ChatEmployeeNameText text={row.value} employees={employees} compact />
              ) : (
                row.value || '—'
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ChatCalendarMeetingCards({
  data,
  employees = [],
}: {
  data: ChatCalendarDayData;
  employees?: ChatEmployeeHit[];
}) {
  return (
    <div className="ai-meeting-stack ai-cal-meeting-stack">
      {data.meetings.map((meeting, index) => (
        <CalendarMeetingCard
          key={`${meeting.leadNumber || meeting.name || 'meeting'}-${meeting.time || index}-${index}`}
          meeting={meeting}
          employees={employees}
        />
      ))}
    </div>
  );
}
