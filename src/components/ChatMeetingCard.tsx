import React from 'react';
import {
  BuildingOffice2Icon,
  CalendarDaysIcon,
  EnvelopeIcon,
  MapPinIcon,
  PhoneIcon,
  VideoCameraIcon,
} from '@heroicons/react/24/outline';
import { getValidTeamsLink } from '../lib/meetingJoinLink';
import { getLeadRoleIcon } from '../lib/leadEmployeeRoles';
import { getSoftStageBadgeStyle, getStageColour, getStageName } from '../lib/stageUtils';
import { formatChatCurrencyText } from '../lib/leadCurrencyDisplay';
import { ChatLeadNumberText } from './ChatLeadNumberText';
import { ChatEmployeeAvatar, ChatEmployeeNameText, type ChatEmployeeHit } from './ChatEmployeeNameText';
import UnavailabilityTypeBadge from './UnavailabilityTypeBadge';

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
    if (
      parsed.kind === 'calendar_day' ||
      parsed.kind === 'signed_contracts' ||
      parsed.kind === 'paid_payments' ||
      parsed.kind === 'missed_comms' ||
      parsed.kind === 'expenses' ||
      parsed.kind === 'lead_summary'
    ) {
      return null;
    }
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

function CalendarStageBadge({ stage, dark = false }: { stage: string; dark?: boolean }) {
  const stageStr = stage.trim();
  if (!stageStr) return null;
  const stageName = getStageName(stageStr) || stageStr;
  const stageColour = getStageColour(stageStr);
  const softBadgeStyle = getSoftStageBadgeStyle(stageColour, stageStr, { dark });

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

export type ChatSignedContractRow = {
  leadNumber?: string | null;
  name?: string | null;
  closer?: string | null;
  value?: string | null;
};

export type ChatSignedContractsData = {
  kind: 'signed_contracts';
  period?: string;
  count?: number;
  closer?: string | null;
  totals?: string | null;
  more?: number;
  rows: ChatSignedContractRow[];
};

export type ChatPaidPaymentRow = {
  leadNumber?: string | null;
  name?: string | null;
  value?: string | null;
  paidAt?: string | null;
};

export type ChatPaidPaymentsData = {
  kind: 'paid_payments';
  period?: string;
  count?: number;
  totals?: string | null;
  more?: number;
  rows: ChatPaidPaymentRow[];
};

export type ChatMissedCommsRow = {
  leadNumber?: string | null;
  name?: string | null;
  channel?: string | null;
  detail?: string | null;
  when?: string | null;
};

export type ChatMissedCommsData = {
  kind: 'missed_comms';
  period?: string;
  count?: number;
  whatsapp?: number;
  email?: number;
  calls?: number;
  more?: number;
  rows: ChatMissedCommsRow[];
};

export function parseMissedCommsCard(raw: string): ChatMissedCommsData | null {
  try {
    const parsed = JSON.parse(raw) as ChatMissedCommsData;
    if (!parsed || typeof parsed !== 'object' || parsed.kind !== 'missed_comms') return null;
    if (!Array.isArray(parsed.rows) || parsed.rows.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function parsePaidPaymentsCard(raw: string): ChatPaidPaymentsData | null {
  try {
    const parsed = JSON.parse(raw) as ChatPaidPaymentsData;
    if (!parsed || typeof parsed !== 'object' || parsed.kind !== 'paid_payments') return null;
    if (!Array.isArray(parsed.rows) || parsed.rows.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function parseSignedContractsCard(raw: string): ChatSignedContractsData | null {
  try {
    const parsed = JSON.parse(raw) as ChatSignedContractsData;
    if (!parsed || typeof parsed !== 'object' || parsed.kind !== 'signed_contracts') return null;
    if (!Array.isArray(parsed.rows) || parsed.rows.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

export type ChatExpenseRow = {
  leadNumber?: string | null;
  name?: string | null;
  category?: string | null;
  amount?: string | null;
  by?: string | null;
};

export type ChatExpensesData = {
  kind: 'expenses';
  period?: string;
  count?: number;
  totals?: string | null;
  more?: number;
  rows: ChatExpenseRow[];
};

export type ChatEmployeePresenceRow = {
  employeeId?: number | null;
  name?: string | null;
  photoUrl?: string | null;
  place?: string | null;
  clockIn?: string | null;
  clockOut?: string | null;
  absent?: string | null;
};

export type ChatEmployeePresenceData = {
  kind: 'employee_presence';
  period?: string | null;
  office?: string | null;
  employee?: string | null;
  count?: number;
  more?: number;
  rows: ChatEmployeePresenceRow[];
};

export function parseEmployeePresenceCard(raw: string): ChatEmployeePresenceData | null {
  try {
    const parsed = JSON.parse(raw) as ChatEmployeePresenceData;
    if (!parsed || typeof parsed !== 'object' || parsed.kind !== 'employee_presence') return null;
    if (!Array.isArray(parsed.rows) || parsed.rows.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function parseExpensesCard(raw: string): ChatExpensesData | null {
  try {
    const parsed = JSON.parse(raw) as ChatExpensesData;
    if (!parsed || typeof parsed !== 'object' || parsed.kind !== 'expenses') return null;
    if (!Array.isArray(parsed.rows) || parsed.rows.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

export type ChatLeadSummaryRole = {
  role?: string | null;
  name?: string | null;
};

export type ChatLeadSummaryData = {
  kind: 'lead_summary';
  leadNumber?: string | null;
  name?: string | null;
  category?: string | null;
  topic?: string | null;
  stage?: string | null;
  team?: ChatLeadSummaryRole[];
};

export const LEAD_SUMMARY_ROLES = ['Handler', 'Expert', 'Manager', 'Closer', 'Scheduler'] as const;

function teamFromAssignedLines(text: string): ChatLeadSummaryRole[] {
  return LEAD_SUMMARY_ROLES.map((role) => {
    const re = new RegExp(`(?:^|\\n)(?:ASSIGNED\\s+)?${role}\\s*:\\s*([^\\n]+)`, 'i');
    const name = String(text.match(re)?.[1] || '').trim();
    return { role, name: !name || name === '—' ? '' : name };
  });
}

function mergeLeadSummaryTeam(
  ...lists: Array<ChatLeadSummaryRole[] | null | undefined>
): ChatLeadSummaryRole[] {
  const names = new Map<string, string>();
  for (const list of lists) {
    for (const row of list || []) {
      const role = String(row.role || '').trim();
      const name = String(row.name || '').trim();
      if (!role || !name || name === '—') continue;
      names.set(role, name);
    }
  }
  return LEAD_SUMMARY_ROLES.map((role) => ({ role, name: names.get(role) || '' }));
}

export function parseLeadSummaryCard(raw: string): ChatLeadSummaryData | null {
  const text = String(raw || '');
  const marker = text.indexOf('LEAD_SUMMARY_UI_JSON');
  const slice = marker >= 0 ? text.slice(marker) : text;
  const start = slice.lastIndexOf('{"kind":"lead_summary"') >= 0
    ? slice.lastIndexOf('{"kind":"lead_summary"')
    : slice.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let parsed: ChatLeadSummaryData | null = null;
  for (let i = start; i < slice.length; i += 1) {
    if (slice[i] === '{') depth += 1;
    else if (slice[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          const value = JSON.parse(slice.slice(start, i + 1)) as ChatLeadSummaryData;
          if (value?.kind === 'lead_summary') parsed = value;
        } catch {
          parsed = null;
        }
        break;
      }
    }
  }
  const fromLines = teamFromAssignedLines(text);
  const team = mergeLeadSummaryTeam(fromLines, parsed?.team);
  if (!parsed && !team.some((row) => row.name)) return null;
  return {
    kind: 'lead_summary',
    leadNumber: parsed?.leadNumber || null,
    name: parsed?.name || null,
    category: parsed?.category || null,
    topic: parsed?.topic || null,
    stage: parsed?.stage || null,
    team,
  };
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
  dark = false,
}: {
  meeting: ChatCalendarMeetingItem;
  employees: ChatEmployeeHit[];
  dark?: boolean;
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
    { label: 'Total value', value: formatChatCurrencyText(cleanCardText(meeting.totalValue)) },
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
            <CalendarStageBadge stage={stage} dark={dark} />
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
  dark = false,
}: {
  data: ChatCalendarDayData;
  employees?: ChatEmployeeHit[];
  dark?: boolean;
}) {
  return (
    <div className="ai-meeting-stack ai-cal-meeting-stack">
      {data.meetings.map((meeting, index) => (
        <CalendarMeetingCard
          key={`${meeting.leadNumber || meeting.name || 'meeting'}-${meeting.time || index}-${index}`}
          meeting={meeting}
          employees={employees}
          dark={dark}
        />
      ))}
    </div>
  );
}

function paidDateOnly(paidAt: string): string {
  const raw = String(paidAt || '').trim();
  if (!raw) return '—';
  return raw.split(',')[0]?.trim() || raw;
}

export function ChatPaidPaymentsTable({ data }: { data: ChatPaidPaymentsData }) {
  return (
    <div className="ai-meeting-stack ai-fullwidth-card-stack">
      <div className="ai-meeting-card ai-signed-card">
        {data.period ? (
          <div className="ai-meeting-card-head">
            <span />
            <span className="ai-meeting-card-lead">{data.period}</span>
          </div>
        ) : null}
        <div className="ai-signed-table-wrap">
          <table className="ai-signed-table">
            <thead>
              <tr>
                <th>Lead</th>
                <th>Client</th>
                <th className="ai-signed-value">Amount</th>
                <th className="ai-signed-paid">Paid</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, index) => {
                const leadNumber = cleanCardText(row.leadNumber);
                const name = cleanCardText(row.name);
                const value = formatChatCurrencyText(cleanCardText(row.value));
                const paidAt = paidDateOnly(cleanCardText(row.paidAt));
                return (
                  <tr key={`${leadNumber || name || 'row'}-${index}`}>
                    <td>{leadNumber ? <ChatLeadNumberText text={leadNumber} /> : '—'}</td>
                    <td>{name || '—'}</td>
                    <td className="ai-signed-value">{value || '—'}</td>
                    <td className="ai-signed-paid">{paidAt}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {data.totals || data.more || data.count ? (
          <div className="ai-signed-footer">
            {data.count ? <span>{data.count} paid</span> : null}
            {data.totals ? <span>Total {formatChatCurrencyText(data.totals)}</span> : null}
            {data.more ? <span>…and {data.more} more</span> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ChatMissedCommsTable({ data }: { data: ChatMissedCommsData }) {
  const parts = [
    data.whatsapp ? `${data.whatsapp} WhatsApp` : '',
    data.email ? `${data.email} email` : '',
    data.calls ? `${data.calls} call${Number(data.calls) === 1 ? '' : 's'}` : '',
  ].filter(Boolean);

  return (
    <div className="ai-meeting-stack ai-fullwidth-card-stack">
      <div className="ai-meeting-card ai-signed-card">
        {data.period ? (
          <div className="ai-meeting-card-head">
            <span />
            <span className="ai-meeting-card-lead">{data.period}</span>
          </div>
        ) : null}
        <div className="ai-signed-table-wrap">
          <table className="ai-signed-table">
            <thead>
              <tr>
                <th>Lead</th>
                <th>Client</th>
                <th>Channel</th>
                <th>Detail</th>
                <th className="ai-signed-paid">When</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, index) => {
                const leadNumber = cleanCardText(row.leadNumber);
                const name = cleanCardText(row.name);
                const channel = cleanCardText(row.channel);
                const detail = cleanCardText(row.detail);
                const when = paidDateOnly(cleanCardText(row.when));
                return (
                  <tr key={`${leadNumber || name || channel || 'row'}-${index}`}>
                    <td>{leadNumber ? <ChatLeadNumberText text={leadNumber} /> : '—'}</td>
                    <td>{name || '—'}</td>
                    <td>{channel || '—'}</td>
                    <td>{detail || '—'}</td>
                    <td className="ai-signed-paid">{when}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {data.count || parts.length || data.more ? (
          <div className="ai-signed-footer">
            {data.count ? <span>{data.count} missed</span> : null}
            {parts.length ? <span>{parts.join(' · ')}</span> : null}
            {data.more ? <span>…and {data.more} more</span> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ChatSignedContractsTable({
  data,
  employees = [],
}: {
  data: ChatSignedContractsData;
  employees?: ChatEmployeeHit[];
}) {
  return (
    <div className="ai-meeting-stack ai-fullwidth-card-stack">
      <div className="ai-meeting-card ai-signed-card">
        {data.period ? (
          <div className="ai-meeting-card-head">
            <span />
            <span className="ai-meeting-card-lead">{data.period}</span>
          </div>
        ) : null}
        <div className="ai-signed-table-wrap">
          <table className="ai-signed-table">
            <thead>
              <tr>
                <th>Lead</th>
                <th>Client name</th>
                <th>Closer</th>
                <th className="ai-signed-value">Total value</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, index) => {
                const leadNumber = cleanCardText(row.leadNumber);
                const name = cleanCardText(row.name);
                const closer = cleanCardText(row.closer);
                const value = formatChatCurrencyText(cleanCardText(row.value));
                return (
                  <tr key={`${leadNumber || name || 'row'}-${index}`}>
                    <td>{leadNumber ? <ChatLeadNumberText text={leadNumber} /> : '—'}</td>
                    <td>{name || '—'}</td>
                    <td>
                      {closer ? (
                        <ChatEmployeeNameText text={closer} employees={employees} compact />
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="ai-signed-value">{value || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {data.totals || data.more ? (
          <div className="ai-signed-footer">
            {data.totals ? <span>Total {formatChatCurrencyText(data.totals)}</span> : null}
            {data.more ? <span>…and {data.more} more</span> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ChatEmployeePresenceTable({
  data,
  employees = [],
}: {
  data: ChatEmployeePresenceData;
  employees?: ChatEmployeeHit[];
}) {
  const peopleByName = new Map<string, ChatEmployeeHit>();
  for (const employee of employees) {
    peopleByName.set(employee.display_name.toLowerCase(), employee);
  }
  data.rows.forEach((row, index) => {
    const name = String(row.name || '').trim();
    if (name.length < 2) return;
    const key = name.toLowerCase();
    const existing = peopleByName.get(key);
    peopleByName.set(key, {
      id: Number(row.employeeId) || existing?.id || -(index + 1),
      display_name: existing?.display_name || name,
      photo_url: row.photoUrl ? String(row.photoUrl) : existing?.photo_url || null,
    });
  });
  const people = [...peopleByName.values()];
  const subtitle = [cleanCardText(data.office), cleanCardText(data.period)].filter(Boolean).join(' · ');

  return (
    <div className="ai-meeting-stack">
      <div className="ai-meeting-card ai-signed-card">
        {subtitle ? (
          <div className="ai-meeting-card-head">
            <span />
            <span className="ai-meeting-card-lead">{subtitle}</span>
          </div>
        ) : null}
        <div className="ai-signed-table-wrap">
          <table className="ai-signed-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Place</th>
                <th>Clocked in</th>
                <th>Out</th>
                <th>Absent</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, index) => {
                const name = cleanCardText(row.name);
                const place = cleanCardText(row.place);
                const clockIn = cleanCardText(row.clockIn);
                const clockOut = cleanCardText(row.clockOut);
                const absent = cleanCardText(row.absent);
                return (
                  <tr key={`${row.employeeId || name || 'row'}-${index}`}>
                    <td>
                      {name ? (
                        <span className="ai-presence-employee">
                          <ChatEmployeeAvatar name={name} employees={people} className="ai-presence-photo" size="2.15rem" />
                          <ChatEmployeeNameText text={name} employees={people} showPhoto={false} />
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{place || '—'}</td>
                    <td>{clockIn || '—'}</td>
                    <td>{clockOut || '—'}</td>
                    <td>
                      {absent ? <UnavailabilityTypeBadge type={absent} size="xs" borderless /> : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {data.more ? (
          <div className="ai-signed-footer">
            <span>…and {data.more} more</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ChatExpensesTable({
  data,
  employees = [],
}: {
  data: ChatExpensesData;
  employees?: ChatEmployeeHit[];
}) {
  return (
    <div className="ai-meeting-stack">
      <div className="ai-meeting-card ai-signed-card">
        {data.period ? (
          <div className="ai-meeting-card-head">
            <span />
            <span className="ai-meeting-card-lead">{data.period}</span>
          </div>
        ) : null}
        <div className="ai-signed-table-wrap">
          <table className="ai-signed-table">
            <thead>
              <tr>
                <th>Lead</th>
                <th>Category</th>
                <th className="ai-signed-value">Amount</th>
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, index) => {
                const leadNumber = cleanCardText(row.leadNumber);
                const name = cleanCardText(row.name);
                const category = cleanCardText(row.category);
                const amount = formatChatCurrencyText(cleanCardText(row.amount));
                const by = cleanCardText(row.by);
                return (
                  <tr key={`${leadNumber || name || category || 'row'}-${index}`}>
                    <td>
                      {leadNumber ? <ChatLeadNumberText text={leadNumber} /> : null}
                      {leadNumber && name ? ' ' : null}
                      {name || (!leadNumber ? '—' : null)}
                    </td>
                    <td>{category || '—'}</td>
                    <td className="ai-signed-value">{amount || '—'}</td>
                    <td>
                      {by ? (
                        <ChatEmployeeNameText text={by} employees={employees} compact />
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {data.totals || data.more ? (
          <div className="ai-signed-footer">
            {data.totals ? <span>Total {formatChatCurrencyText(data.totals)}</span> : null}
            {data.more ? <span>…and {data.more} more</span> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function lastMarkerSplit(text: string, pattern: RegExp): { before: string; after: string } | null {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const re = new RegExp(pattern.source, flags);
  let found: RegExpExecArray | null = null;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) found = match;
  if (!found || found.index == null) return null;
  return {
    before: text.slice(0, found.index).trim(),
    after: text.slice(found.index + found[0].length).replace(/^[-*•]\s*/, '').trim(),
  };
}

export function splitLeadSummaryParts(text: string): { body: string; risks: string; caseAbout: string } {
  let raw = String(text || '').trim();
  if (!raw) return { body: '', risks: '', caseAbout: '' };

  const about = lastMarkerSplit(
    raw,
    /(?:\n+|\s+)(?:[-*•]\s*)?(?:\*\*)?(?:case about|what (?:the )?case is about|about the case)(?:\*\*)?\s*[:—-]\s*/i,
  );
  let caseAbout = '';
  if (about) {
    raw = about.before;
    caseAbout = about.after;
  }

  const risk = lastMarkerSplit(
    raw,
    /(?:\n+|\s+)(?:[-*•]\s*)?(?:\*\*)?risks?(?:\*\*)?\s*[:—-]\s*/i,
  );
  if (risk) {
    return { body: risk.before, risks: risk.after, caseAbout };
  }
  const inline = raw.match(/^(?:[-*•]\s*)?(?:\*\*)?risks?(?:\*\*)?\s*[:—-]\s*([\s\S]+)$/i);
  if (inline) {
    return { body: '', risks: String(inline[1] || '').replace(/^[-*•]\s*/, '').trim(), caseAbout };
  }
  return { body: raw, risks: '', caseAbout };
}

export function ChatRisksBox({
  text,
  renderText,
}: {
  text?: string | null;
  renderText?: (text: string) => React.ReactNode;
}) {
  const risks = String(text || '').trim();
  if (!risks) return null;
  return (
    <div className="ai-lead-risks">
      <div className="ai-meeting-card-title">Risks</div>
      {renderText ? renderText(risks) : risks}
    </div>
  );
}

function asBulletPoints(text: string): string {
  const raw = String(text || '').trim();
  if (!raw) return '';
  if (/(^|\n)\s*(?:[-*•]|\d+[.)])\s/.test(raw)) return raw;
  const parts = raw
    .split(/(?<=[.!?])\s+(?=[A-Z\u0590-\u05FF])|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length <= 1) return `- ${raw}`;
  return parts.map((part) => `- ${part.replace(/^[-*•]\s*/, '')}`).join('\n');
}

export function ChatLeadSummaryCards({
  data,
  employees = [],
  summaryText = '',
  renderText,
  dark = false,
}: {
  data: ChatLeadSummaryData;
  employees?: ChatEmployeeHit[];
  summaryText?: string;
  renderText?: (text: string) => React.ReactNode;
  dark?: boolean;
}) {
  const leadNumber = cleanCardText(data.leadNumber);
  const name = cleanCardText(data.name);
  const category = cleanCardText(data.category);
  const topic = cleanCardText(data.topic);
  const stage = cleanCardText(data.stage);
  const teamByRole = new Map(
    (data.team || []).map((row) => [String(row.role || '').trim(), cleanCardText(row.name)]),
  );
  const { body, risks, caseAbout } = splitLeadSummaryParts(summaryText);

  return (
    <div className="ai-meeting-stack">
      {caseAbout ? (
        <div className="ai-lead-case-about">
          <div className="ai-meeting-card-title">General summary</div>
          {renderText ? renderText(caseAbout) : caseAbout}
        </div>
      ) : null}
      <div className="ai-meeting-card ai-signed-card">
        <div className="ai-signed-table-wrap">
          <table className="ai-signed-table">
            <thead>
              <tr>
                <th>Lead</th>
                <th>Stage</th>
                <th>Category</th>
                <th>Topic</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  {leadNumber ? <ChatLeadNumberText text={leadNumber} /> : null}
                  {leadNumber && name ? ' ' : null}
                  {name || (!leadNumber ? '—' : null)}
                </td>
                <td>{stage ? <CalendarStageBadge stage={stage} dark={dark} /> : '—'}</td>
                <td>{category || '—'}</td>
                <td>{topic || '—'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      {body ? (
        <div className="ai-lead-summary-text">
          {renderText ? renderText(asBulletPoints(body)) : asBulletPoints(body)}
        </div>
      ) : null}
      <div
        className="ai-lead-roles-grid"
        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.7rem', width: '100%' }}
      >
        {LEAD_SUMMARY_ROLES.map((role) => {
          const person = teamByRole.get(role) || '';
          const Icon = getLeadRoleIcon(role.toLowerCase());
          return (
            <div key={role} className="ai-meeting-card ai-lead-role-cell">
              <div className="ai-lead-role-main">
                <span className="ai-lead-role-title">
                  <Icon className="ai-lead-role-icon" />
                  {role}
                </span>
                <span className="ai-lead-role-name">
                  {person ? (
                    <ChatEmployeeNameText text={person} employees={employees} showPhoto={false} />
                  ) : (
                    '—'
                  )}
                </span>
              </div>
              {person ? <ChatEmployeeAvatar name={person} employees={employees} /> : null}
            </div>
          );
        })}
      </div>
      <ChatRisksBox text={risks} renderText={renderText} />
    </div>
  );
}
