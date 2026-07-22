import { supabase } from './supabase';

function normalizeSearchText(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function digitsOnly(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

function escapeIlikePattern(value: string): string {
  return value.replace(/[%_,\\]/g, '\\$&');
}

function isNumericLeadQuery(query: string): boolean {
  const trimmed = query.trim().replace(/^[#LC]/i, '');
  return /^[\d/]+$/.test(trimmed) && trimmed.length > 0;
}

function collectMeetingSearchParts(meeting: any): unknown[] {
  const lead = meeting?.lead || {};
  const legacyLead = meeting?.legacy_lead || {};

  return [
    lead.name,
    legacyLead.name,
    meeting?.client_name,
    lead.lead_number,
    legacyLead.lead_number,
    lead.manual_id,
    legacyLead.manual_id,
    lead.email,
    lead.phone,
    lead.mobile,
    legacyLead.email,
    legacyLead.phone,
    legacyLead.mobile,
    meeting?.meeting_subject,
    meeting?.subject,
    meeting?.meeting_manager,
    lead.manager,
    lead.helper,
    lead.expert,
    lead.scheduler,
    ...(Array.isArray(meeting?.attendees) ? meeting.attendees : []),
  ];
}

/** Client-side filter for calendar meetings by lead/client name, number, contact details, or subject. */
export function meetingMatchesCalendarLeadFilter(meeting: any, query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) return true;

  const q = trimmed.toLowerCase();
  const qDigits = digitsOnly(trimmed);
  const parts = collectMeetingSearchParts(meeting);

  const haystack = parts.map(normalizeSearchText).filter(Boolean).join(' ');
  if (haystack.includes(q)) return true;

  if (qDigits.length >= 3) {
    const digitHaystack = parts.map(digitsOnly).filter(Boolean).join('');
    if (digitHaystack.includes(qDigits)) return true;
  }

  return false;
}

const GLOBAL_MEETINGS_SELECT = `
  id, meeting_date, meeting_time,
  meeting_subject, meeting_brief, meeting_manager, helper,
  meeting_location, manual_address, teams_id, teams_meeting_url,
  custom_link, custom_address, meeting_amount, meeting_currency,
  status, client_id, legacy_lead_id, calendar_type,
  scheduler, client_booking_timezone,
  leads!meetings_client_id_fkey (
    id, name, lead_number, manual_id, master_id, stage, manager, helper, scheduler,
    expert, phone, email, mobile, status, unactivated_at, category, category_id
  ),
  leads_lead!meetings_legacy_lead_id_fkey (
    id, name, lead_number, manual_id, master_id, stage, status,
    phone, email, mobile, meeting_manager_id, meeting_lawyer_id, meeting_scheduler_id,
    expert_id, case_handler_id, category, category_id
  )
`;

function attachLeadToMeetingRow(row: any): any {
  const newLead = Array.isArray(row.leads) ? row.leads[0] : row.leads;
  const legacyLead = Array.isArray(row.leads_lead) ? row.leads_lead[0] : row.leads_lead;

  if (legacyLead) {
    return {
      ...row,
      legacy_lead: legacyLead,
      lead: {
        ...legacyLead,
        lead_type: 'legacy',
        id: legacyLead.id,
      },
    };
  }

  if (newLead) {
    return {
      ...row,
      legacy_lead: null,
      lead: {
        ...newLead,
        lead_type: 'new',
      },
    };
  }

  return {
    ...row,
    legacy_lead: legacyLead || null,
    lead: null,
  };
}

async function searchLegacyLeadIds(query: string, pattern: string): Promise<number[]> {
  const ids = new Set<number>();

  // Text columns only — lead_number/phone/mobile are bigint in legacy and cannot use ilike.
  const textRes = await supabase
    .from('leads_lead')
    .select('id')
    .or(`name.ilike.${pattern},email.ilike.${pattern}`)
    .limit(60);

  if (textRes.error) throw textRes.error;
  (textRes.data || []).forEach((row) => ids.add(Number(row.id)));

  const trimmed = query.trim();
  const digits = digitsOnly(trimmed);

  if (isNumericLeadQuery(trimmed)) {
    const base = trimmed.replace(/^[#LC]/i, '').split('/')[0];
    const leadId = Number(base);
    if (!Number.isNaN(leadId)) {
      const idRes = await supabase.from('leads_lead').select('id').eq('id', leadId).limit(1);
      if (idRes.error) throw idRes.error;
      (idRes.data || []).forEach((row) => ids.add(Number(row.id)));
    }

    const manualRes = await supabase
      .from('leads_lead')
      .select('id')
      .ilike('manual_id', `${base}%`)
      .limit(20);
    if (!manualRes.error) {
      (manualRes.data || []).forEach((row) => ids.add(Number(row.id)));
    }
  }

  if (digits.length >= 3) {
    const numeric = Number(digits);
    if (!Number.isNaN(numeric)) {
      const phoneRes = await supabase
        .from('leads_lead')
        .select('id')
        .or(`phone.eq.${numeric},mobile.eq.${numeric}`)
        .limit(20);
      if (phoneRes.error) throw phoneRes.error;
      (phoneRes.data || []).forEach((row) => ids.add(Number(row.id)));
    }
  }

  return Array.from(ids);
}

async function searchNewLeadIds(query: string, pattern: string): Promise<string[]> {
  const ids = new Set<string>();
  const trimmed = query.trim();

  const textOrParts = [`name.ilike.${pattern}`, `email.ilike.${pattern}`];
  if (isNumericLeadQuery(trimmed)) {
    const digitPattern = `%${escapeIlikePattern(trimmed.replace(/^[#LC]/i, ''))}%`;
    textOrParts.push(`lead_number.ilike.${digitPattern}`);
    textOrParts.push(`manual_id.ilike.${digitPattern}`);
  }

  const textRes = await supabase.from('leads').select('id').or(textOrParts.join(',')).limit(60);
  if (textRes.error) throw textRes.error;
  (textRes.data || []).forEach((row) => ids.add(String(row.id)));

  const digits = digitsOnly(trimmed);
  if (digits.length >= 5) {
    const phoneTextRes = await supabase
      .from('leads')
      .select('id')
      .or(`phone.ilike.%${digits},mobile.ilike.%${digits}`)
      .limit(20);
    if (!phoneTextRes.error) {
      (phoneTextRes.data || []).forEach((row) => ids.add(String(row.id)));
    }
  }

  return Array.from(ids);
}

/** Fetch meetings across all dates for matching leads/clients — ignores calendar date/staff/type filters. */
export async function fetchGlobalCalendarMeetings(query: string): Promise<any[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const pattern = `%${escapeIlikePattern(trimmed)}%`;

  const [newIds, legacyIds] = await Promise.all([
    searchNewLeadIds(trimmed, pattern),
    searchLegacyLeadIds(trimmed, pattern),
  ]);

  const meetingOrParts: string[] = [`meeting_subject.ilike.${pattern}`];
  if (newIds.length) {
    meetingOrParts.push(`client_id.in.(${newIds.map((id) => `"${id}"`).join(',')})`);
  }
  if (legacyIds.length) {
    meetingOrParts.push(`legacy_lead_id.in.(${legacyIds.join(',')})`);
  }

  const { data, error } = await supabase
    .from('meetings')
    .select(GLOBAL_MEETINGS_SELECT)
    .or('status.is.null,status.neq.canceled')
    .or(meetingOrParts.join(','))
    .order('meeting_date', { ascending: false })
    .limit(400);

  if (error) throw error;

  const deduped = new Map<string | number, any>();
  (data || []).forEach((row) => {
    const meeting = attachLeadToMeetingRow(row);
    if (!meeting.meeting_date) return;
    if (!meetingMatchesCalendarLeadFilter(meeting, trimmed)) return;
    deduped.set(meeting.id, meeting);
  });

  return Array.from(deduped.values()).sort((a, b) => {
    const dateCmp = String(b.meeting_date || '').localeCompare(String(a.meeting_date || ''));
    if (dateCmp !== 0) return dateCmp;
    return String(a.meeting_time || '').localeCompare(String(b.meeting_time || ''));
  });
}

export function isCalendarGlobalLeadSearchActive(query: string): boolean {
  return query.trim().length >= 2;
}
