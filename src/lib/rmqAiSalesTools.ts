import { supabase } from './supabase';
import { fetchLeadCaseFileForAi } from './leadFollowupAiApi';
import { getStageName } from './stageUtils';
import { upsertUserFollowUp } from './upsertUserFollowUp';
import {
  generateManualInteractionId,
  insertLeadManualInteraction,
} from './leadManualInteractions';
import { fetchMeetingSummaryNotes, polishMeetingSummaryNotes } from './meetingSummaryNotesApi';
import {
  getRmqAiCurrentLead,
  rememberRmqAiDraftMeta,
} from './rmqAiChatContext';
import { requireResolvedLead } from './rmqAiLeadResolver';
import { fetchLeadContacts } from './contactHelpers';
import { leadChatLabel, lookupLeadsByIds, resolveMeetingLead } from './rmqAiLeadDisplay';

type LeadArgs = { query?: string; lead_id?: string; is_legacy?: boolean };

function jerusalemTodayIso(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addIsoDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

function clip(value: unknown, max = 280): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function formatLeadHit(row: { lead_number?: unknown; name?: unknown; id?: unknown; manual_id?: unknown }): string {
  return leadChatLabel(row, String(row.id || ''));
}

async function resolveLead(args: LeadArgs): Promise<{ leadId: string; isLegacy: boolean; label: string }> {
  const lead = await requireResolvedLead(args);
  return {
    leadId: lead.leadId,
    isLegacy: lead.isLegacy,
    label: `${lead.leadNumber} ${lead.displayName}`.trim(),
  };
}

async function resolveLoggedInEmployee(): Promise<{
  employeeId: number | null;
  displayName: string | null;
  userId: string | null;
}> {
  const { data: sessionData } = await supabase.auth.getUser();
  const authId = sessionData.user?.id;
  const email = sessionData.user?.email || '';
  if (!authId && !email) return { employeeId: null, displayName: null, userId: null };
  let data: { id?: string; employee_id?: unknown; tenants_employee?: unknown } | null = null;
  if (authId) {
    const byAuth = await supabase
      .from('users')
      .select('id, employee_id, tenants_employee!employee_id(id, display_name)')
      .eq('auth_id', authId)
      .maybeSingle();
    data = byAuth.data;
  }
  if (!data?.employee_id && email) {
    const byEmail = await supabase
      .from('users')
      .select('id, employee_id, tenants_employee!employee_id(id, display_name)')
      .eq('email', email)
      .maybeSingle();
    data = byEmail.data;
  }
  const employee = Array.isArray(data?.tenants_employee) ? data?.tenants_employee[0] : data?.tenants_employee;
  return {
    employeeId: data?.employee_id != null ? Number(data.employee_id) : null,
    displayName: (employee as { display_name?: string } | null)?.display_name
      ? String((employee as { display_name?: string }).display_name).trim()
      : null,
    userId: data?.id ? String(data.id) : authId || null,
  };
}

function leadNumberLine(row: { lead_number?: unknown; name?: unknown; id?: unknown; manual_id?: unknown } | null | undefined): string {
  return leadChatLabel(row, 'Lead');
}

async function resolveLeadEmail(
  leadId: string,
  isLegacy: boolean,
  fallback?: string | null,
): Promise<string | undefined> {
  const openEmail = String(fallback || '').trim();
  if (openEmail.includes('@')) return openEmail;
  const rawId = leadId.replace(/^legacy_/i, '');
  try {
    const contacts = await fetchLeadContacts(rawId, isLegacy);
    const withEmail =
      contacts.find((c) => c.isMain && c.email) || contacts.find((c) => Boolean(c.email));
    if (withEmail?.email) return String(withEmail.email).trim();
  } catch {
    /* ignore */
  }
  const table = isLegacy ? 'leads_lead' : 'leads';
  const { data } = await supabase.from(table).select('email').eq('id', rawId).maybeSingle();
  const email = String(data?.email || '').trim();
  return email.includes('@') ? email : undefined;
}

export async function executeListMySalesDay(): Promise<string> {
  const today = jerusalemTodayIso();
  const tomorrow = addIsoDays(today, 1);
  const me = await resolveLoggedInEmployee();
  if (!me.userId && !me.employeeId) {
    return 'Could not resolve the logged-in user. Sign in again and retry.';
  }

  const firstName = (me.displayName || '').split(/\s+/)[0] || '';
  const nameNeedle = firstName.replace(/[%_,]/g, '');

  const [meetingsRes, followRes, newQueue, legacyQueue] = await Promise.all([
    (async () => {
      const withFk = await supabase
        .from('meetings')
        .select(
          'id, meeting_date, meeting_time, status, meeting_brief, client_id, legacy_lead_id, meeting_manager, helper, lead:leads!meetings_client_id_fkey(id, name, lead_number, manual_id), legacy_lead:leads_lead!meetings_legacy_lead_id_fkey(id, name, lead_number, manual_id)',
        )
        .gte('meeting_date', today)
        .lt('meeting_date', addIsoDays(tomorrow, 1))
        .order('meeting_date', { ascending: true })
        .order('meeting_time', { ascending: true })
        .limit(80);
      if (!withFk.error) return withFk;
      return supabase
        .from('meetings')
        .select(
          'id, meeting_date, meeting_time, status, meeting_brief, client_id, legacy_lead_id, meeting_manager, helper',
        )
        .gte('meeting_date', today)
        .lt('meeting_date', addIsoDays(tomorrow, 1))
        .order('meeting_date', { ascending: true })
        .order('meeting_time', { ascending: true })
        .limit(80);
    })(),
    me.userId
      ? supabase
          .from('follow_ups')
          .select('id, date, lead_id, new_lead_id')
          .eq('user_id', me.userId)
          .not('date', 'is', null)
          .lte('date', `${today}T23:59:59Z`)
          .order('date', { ascending: true })
          .limit(80)
      : Promise.resolve({ data: [] as any[], error: null }),
    supabase
      .from('leads')
      .select('id, lead_number, manual_id, name, stage, closer, scheduler, latest_interaction')
      .in('stage', [21, 40, 50])
      .limit(80),
    me.employeeId != null
      ? supabase
          .from('leads_lead')
          .select('id, lead_number, manual_id, name, stage, closer_id, meeting_scheduler_id')
          .in('stage', [21, 40, 50])
          .or(`closer_id.eq.${me.employeeId},meeting_scheduler_id.eq.${me.employeeId}`)
          .limit(80)
      : Promise.resolve({ data: [] as any[], error: null }),
  ]);

  const mineName = (value: unknown) => {
    const text = String(value ?? '').trim().toLowerCase();
    if (!text) return false;
    if (me.displayName && text === me.displayName.toLowerCase()) return true;
    if (nameNeedle && text.includes(nameNeedle.toLowerCase())) return true;
    if (me.employeeId != null && String(value) === String(me.employeeId)) return true;
    return false;
  };

  const meetingRows = meetingsRes.data || [];
  const meetingLeadMaps = await lookupLeadsByIds(
    meetingRows.map((row: any) => row.client_id),
    meetingRows.map((row: any) => row.legacy_lead_id),
  );
  const meetingLines: string[] = [];
  for (const row of meetingRows) {
    const status = String(row.status || '').toLowerCase();
    if (status === 'canceled' || status === 'cancelled') continue;
    const isMine =
      mineName(row.meeting_manager) ||
      mineName(row.helper) ||
      (me.displayName &&
        `${row.meeting_manager || ''} ${row.helper || ''}`.toLowerCase().includes(me.displayName.toLowerCase()));
    if (!isMine) continue;
    const { lead } = resolveMeetingLead({ ...row, maps: meetingLeadMaps });
    const day = String(row.meeting_date || '').slice(0, 10);
    const when = day === today ? 'today' : day === tomorrow ? 'tomorrow' : day;
    const label =
      leadNumberLine(lead) ||
      String(row.meeting_brief || '').trim() ||
      (row.client_id || row.legacy_lead_id ? 'Lead' : 'Internal meeting');
    meetingLines.push(
      `- ${when} ${String(row.meeting_time || '').slice(0, 5) || '—'} · ${label} · Prep meeting`,
    );
  }

  const followRows = (followRes.data || []) as Array<{
    date: string;
    lead_id: number | null;
    new_lead_id: string | null;
  }>;
  const newFollowIds = followRows.map((r) => r.new_lead_id).filter((id): id is string => Boolean(id));
  const legacyFollowIds = followRows.map((r) => r.lead_id).filter((id): id is number => id != null);
  const [newFollowLeads, legacyFollowLeads] = await Promise.all([
    newFollowIds.length
      ? supabase.from('leads').select('id, lead_number, manual_id, name').in('id', newFollowIds)
      : Promise.resolve({ data: [] as any[] }),
    legacyFollowIds.length
      ? supabase.from('leads_lead').select('id, lead_number, manual_id, name').in('id', legacyFollowIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const newById = new Map((newFollowLeads.data || []).map((r: any) => [String(r.id), r]));
  const legacyById = new Map((legacyFollowLeads.data || []).map((r: any) => [String(r.id), r]));
  const overdue: string[] = [];
  const todayFollow: string[] = [];
  for (const row of followRows) {
    const date = String(row.date || '').slice(0, 10);
    const lead = row.new_lead_id ? newById.get(String(row.new_lead_id)) : legacyById.get(String(row.lead_id));
    const line = `- ${date} · ${leadNumberLine(lead)} · Call / follow up`;
    if (date < today) overdue.push(line);
    else todayFollow.push(line);
  }

  const waiting: string[] = [];
  const actionForStage = (stage: number) => {
    if (stage === 21) return 'Rebook meeting';
    if (stage === 40) return 'Send offer';
    if (stage === 50) return 'Chase signature';
    return 'Follow up';
  };
  for (const row of newQueue.data || []) {
    if (!mineName(row.closer) && !mineName(row.scheduler)) continue;
    const stage = Number(row.stage);
    waiting.push(
      `- ${getStageName(stage)} · ${leadNumberLine(row)} · ${actionForStage(stage)}`,
    );
  }
  for (const row of legacyQueue.data || []) {
    const stage = Number(row.stage);
    waiting.push(
      `- ${getStageName(stage)} · ${leadNumberLine(row)} · ${actionForStage(stage)}`,
    );
  }

  return [
    `MY SALES DAY ${today} (Asia/Jerusalem)`,
    me.displayName ? `User: ${me.displayName}` : '',
    '',
    `MEETINGS TODAY / TOMORROW (${meetingLines.length}):`,
    meetingLines.length ? meetingLines.slice(0, 20).join('\n') : 'None.',
    '',
    `OVERDUE FOLLOW-UPS (${overdue.length}):`,
    overdue.length ? overdue.slice(0, 20).join('\n') : 'None.',
    '',
    `FOLLOW-UPS TODAY (${todayFollow.length}):`,
    todayFollow.length ? todayFollow.slice(0, 20).join('\n') : 'None.',
    '',
    `WAITING ON YOU — reschedule / price offer / unsigned (${waiting.length}):`,
    waiting.length ? waiting.slice(0, 25).join('\n') : 'None.',
    '',
    'Reply as a short numbered list. Each item MUST start with the exact lead number as a bare token (L214188 or 209994/9), then the name, then the next action. Never omit the lead number. Never write Unnamed.',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

export async function executeDraftClientMessage(args: {
  query?: string;
  lead_id?: string;
  is_legacy?: boolean;
  channel?: string;
  intent?: string;
}): Promise<string> {
  const resolved = await resolveLead(args);
  const channelRaw = String(args.channel || 'email').toLowerCase();
  const channel: 'email' | 'whatsapp' | 'sms' =
    channelRaw.includes('whats') ? 'whatsapp' : channelRaw.includes('sms') ? 'sms' : 'email';
  const intent = String(args.intent || 'follow_up').trim() || 'follow_up';
  const open = getRmqAiCurrentLead();
  const [caseFile, email] = await Promise.all([
    fetchLeadCaseFileForAi({ leadId: resolved.leadId, isLegacy: resolved.isLegacy }),
    resolveLeadEmail(resolved.leadId, resolved.isLegacy, open?.email),
  ]);
  rememberRmqAiDraftMeta({
    channel,
    leadNumber: String(open?.lead_number || resolved.label || '').trim() || undefined,
    leadId: resolved.leadId,
    email,
  });
  return [
    `DRAFT CONTEXT for ${resolved.label}`,
    `Channel: ${channel}`,
    `Intent: ${intent}`,
    `Language: prefer the client language from the case file (Hebrew if the case is Hebrew).`,
    '',
    caseFile.slice(0, 6000),
    '',
    'Write ONLY the ready-to-send message in the client language. No English preamble, no “here is a draft”. If email, you may start with Subject: on the first line. Keep facts from the case file. Do not invent portal URLs, amounts, or dates. Stop after Best regards / בברכה. Do not add a name, title, phone, or email signature — the CRM adds that when sending.',
  ].join('\n');
}

export async function executePrepMeeting(args: LeadArgs & { date?: string }): Promise<string> {
  const today = jerusalemTodayIso();
  let resolved: { leadId: string; isLegacy: boolean; label: string } | null = null;
  try {
    resolved = await resolveLead(args);
  } catch {
    resolved = null;
  }

  if (!resolved) {
    const me = await resolveLoggedInEmployee();
    const { data } = await supabase
      .from('meetings')
      .select(
        'id, meeting_date, meeting_time, meeting_location, meeting_brief, client_id, legacy_lead_id, meeting_manager, helper',
      )
      .gte('meeting_date', today)
      .order('meeting_date', { ascending: true })
      .order('meeting_time', { ascending: true })
      .limit(20);
    const maps = await lookupLeadsByIds(
      (data || []).map((row: any) => row.client_id),
      (data || []).map((row: any) => row.legacy_lead_id),
    );
    const mine = (data || []).find((row: any) => {
      const blob = `${row.meeting_manager || ''} ${row.helper || ''}`.toLowerCase();
      return (
        (me.displayName && blob.includes(me.displayName.toLowerCase())) ||
        (me.employeeId != null && blob.includes(String(me.employeeId)))
      );
    });
    if (!mine) return 'No upcoming meeting found for you. Name a lead number to prep.';
    const { lead, isLegacy } = resolveMeetingLead({ ...mine, maps });
    if (lead?.id) {
      resolved = {
        leadId: isLegacy ? `legacy_${String(lead.id).replace(/^legacy_/i, '')}` : String(lead.id),
        isLegacy,
        label: formatLeadHit(lead),
      };
    } else if (mine.legacy_lead_id) {
      resolved = {
        leadId: `legacy_${mine.legacy_lead_id}`,
        isLegacy: true,
        label: formatLeadHit({ id: mine.legacy_lead_id }),
      };
    } else if (mine.client_id) {
      resolved = { leadId: String(mine.client_id), isLegacy: false, label: formatLeadHit({ id: mine.client_id }) };
    }
    if (!resolved) return 'Found a meeting but could not resolve the lead.';
    const caseFile = await fetchLeadCaseFileForAi({ leadId: resolved.leadId, isLegacy: resolved.isLegacy });
    return [
      `MEETING PREP — next meeting`,
      `${String(mine.meeting_date || '').slice(0, 10)} ${String(mine.meeting_time || '').slice(0, 5)}`,
      `Location: ${mine.meeting_location || '—'}`,
      `Brief: ${clip(mine.meeting_brief, 400) || '—'}`,
      `Attendees: manager ${mine.meeting_manager || '—'} · helper ${mine.helper || '—'}`,
      `Lead: ${resolved.label}`,
      '',
      caseFile.slice(0, 5500),
      '',
      'Write a short prep pack: time, who they are, stage/proposal, last 3 comms, 3 questions in the client language. No long essay.',
    ].join('\n');
  }

  const rawId = resolved.leadId.replace(/^legacy_/i, '');
  const meetingQuery = resolved.isLegacy
    ? supabase
        .from('meetings')
        .select('id, meeting_date, meeting_time, meeting_location, meeting_brief, meeting_summary_notes, meeting_manager, helper')
        .eq('legacy_lead_id', rawId)
        .gte('meeting_date', today)
        .order('meeting_date', { ascending: true })
        .limit(1)
    : supabase
        .from('meetings')
        .select('id, meeting_date, meeting_time, meeting_location, meeting_brief, meeting_summary_notes, meeting_manager, helper')
        .eq('client_id', resolved.leadId)
        .gte('meeting_date', today)
        .order('meeting_date', { ascending: true })
        .limit(1);
  const [{ data: meetings }, caseFile] = await Promise.all([
    meetingQuery,
    fetchLeadCaseFileForAi({ leadId: resolved.leadId, isLegacy: resolved.isLegacy }),
  ]);
  const meeting = meetings?.[0];
  return [
    `MEETING PREP — ${resolved.label}`,
    meeting
      ? `${String(meeting.meeting_date || '').slice(0, 10)} ${String(meeting.meeting_time || '').slice(0, 5)} · ${meeting.meeting_location || '—'}`
      : 'No upcoming meetings row; use the case file meeting fields.',
    meeting ? `Summary: ${clip(meeting.meeting_summary_notes, 800) || '—'}` : '',
    meeting ? `Brief: ${clip(meeting.meeting_brief, 400) || '—'}` : '',
    meeting ? `Attendees: manager ${meeting.meeting_manager || '—'} · helper ${meeting.helper || '—'}` : '',
    '',
    caseFile.slice(0, 5500),
    '',
    'Write a short prep pack: time, who they are, stage/proposal, last 3 comms, 3 questions in the client language.',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function executeWrapUpMeeting(args: LeadArgs & { notes?: string }): Promise<string> {
  const resolved = await resolveLead(args);
  const rawId = resolved.leadId.replace(/^legacy_/i, '');
  const meetingQuery = resolved.isLegacy
    ? supabase
        .from('meetings')
        .select('id, meeting_date, meeting_time, meeting_summary_notes, meeting_brief')
        .eq('legacy_lead_id', rawId)
        .order('meeting_date', { ascending: false })
        .limit(1)
    : supabase
        .from('meetings')
        .select('id, meeting_date, meeting_time, meeting_summary_notes, meeting_brief')
        .eq('client_id', resolved.leadId)
        .order('meeting_date', { ascending: false })
        .limit(1);
  const [{ data: meetings }, caseFile] = await Promise.all([
    meetingQuery,
    fetchLeadCaseFileForAi({ leadId: resolved.leadId, isLegacy: resolved.isLegacy }),
  ]);
  const meeting = meetings?.[0];
  let existing = String(meeting?.meeting_summary_notes || '').trim();
  if (meeting?.id && !existing) {
    try {
      existing = await fetchMeetingSummaryNotes(Number(meeting.id));
    } catch {
      /* ignore */
    }
  }
  let polished = '';
  const rawNotes = String(args.notes || existing || '').trim();
  if (rawNotes) {
    try {
      const result = await polishMeetingSummaryNotes({
        draft: rawNotes,
        leadNumber: resolved.label,
        meetingDate: meeting ? String(meeting.meeting_date || '').slice(0, 10) : null,
      });
      polished = result.summary || '';
      if (polished && meeting?.id) {
        await supabase
          .from('meetings')
          .update({ meeting_summary_notes: polished })
          .eq('id', meeting.id);
      }
    } catch {
      polished = '';
    }
  }
  return [
    `WRAP UP MEETING — ${resolved.label}`,
    meeting
      ? `Last meeting: ${String(meeting.meeting_date || '').slice(0, 10)} ${String(meeting.meeting_time || '').slice(0, 5)} id=${meeting.id}`
      : 'No meetings row found.',
    existing ? `Existing summary:\n${clip(existing, 800)}` : 'No existing summary notes.',
    polished ? `Polished summary:\n${polished}` : '',
    '',
    caseFile.slice(0, 4500),
    '',
    polished && meeting?.id ? 'Polished summary was saved on the meeting row.' : '',
    'Write: 1) a short meeting summary, 2) suggested follow-up date YYYY-MM-DD and why, 3) if they likely need an offer, say so. To save the follow-up you MUST call set_follow_up after (or ask to confirm). For an offer email call draft_client_message intent=price_offer.',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function executeSetFollowUp(args: LeadArgs & { date?: string; note?: string }): Promise<string> {
  const date = String(args.date || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return 'set_follow_up needs date as YYYY-MM-DD.';
  }
  const resolved = await resolveLead(args);
  const me = await resolveLoggedInEmployee();
  if (!me.userId) return 'Could not resolve the logged-in user to save a follow-up.';
  const rawId = resolved.leadId.replace(/^legacy_/i, '');
  await upsertUserFollowUp({
    userId: me.userId,
    isLegacy: resolved.isLegacy,
    leadId: rawId,
    dateYmd: date,
  });
  if (!resolved.isLegacy) {
    await supabase.from('leads').update({ next_followup: date, follow_up_date: date }).eq('id', resolved.leadId);
  } else {
    try {
      await supabase.from('leads_lead').update({ next_followup: date }).eq('id', rawId);
    } catch {
      /* column may not exist on legacy */
    }
  }
  const note = String(args.note || '').trim();
  return `Saved follow-up ${date} on ${resolved.label}${note ? ` (${note})` : ''}.`;
}

export async function executeLogManualNote(args: LeadArgs & { content?: string; kind?: string }): Promise<string> {
  const content = String(args.content || '').trim();
  if (!content) return 'log_manual_note needs content.';
  const resolved = await resolveLead(args);
  if (resolved.isLegacy) {
    return 'Manual notes from chat are saved on new leads only. Copy this into the lead timeline, or convert the lead.';
  }
  const me = await resolveLoggedInEmployee();
  const now = new Date();
  const jerusalem = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const part = (type: string) => jerusalem.find((p) => p.type === type)?.value || '';
  await insertLeadManualInteraction(resolved.leadId, {
    id: generateManualInteractionId(),
    date: `${part('year')}-${part('month')}-${part('day')}`,
    time: `${part('hour')}:${part('minute')}`,
    raw_date: now.toISOString(),
    employee: me.displayName || 'RMQ AI',
    kind: String(args.kind || 'note'),
    direction: 'out',
    content,
    editable: true,
  });
  return `Logged a ${args.kind || 'note'} on ${resolved.label}.`;
}

export async function executeListStaleSalesLeads(args: { days?: number }): Promise<string> {
  const days = Math.min(30, Math.max(2, Number(args.days) || 5));
  const today = jerusalemTodayIso();
  const cutoff = addIsoDays(today, -days);
  const me = await resolveLoggedInEmployee();
  if (!me.employeeId && !me.displayName) {
    return 'Could not resolve the logged-in employee.';
  }
  const firstName = (me.displayName || '').split(/\s+/)[0] || '';
  const mineName = (value: unknown) => {
    const text = String(value ?? '').trim().toLowerCase();
    if (!text) return false;
    if (me.displayName && text === me.displayName.toLowerCase()) return true;
    if (firstName && text.includes(firstName.toLowerCase())) return true;
    if (me.employeeId != null && String(value) === String(me.employeeId)) return true;
    return false;
  };

  const [newLeads, legacyLeads] = await Promise.all([
    supabase
      .from('leads')
      .select('id, lead_number, manual_id, name, stage, closer, scheduler, latest_interaction')
      .gte('stage', 20)
      .lte('stage', 60)
      .limit(200),
    me.employeeId != null
      ? supabase
          .from('leads_lead')
          .select('id, lead_number, manual_id, name, stage, closer_id, meeting_scheduler_id, latest_interaction')
          .or(`closer_id.eq.${me.employeeId},meeting_scheduler_id.eq.${me.employeeId}`)
          .gte('stage', 20)
          .lte('stage', 60)
          .limit(200)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  type StaleRow = { line: string; stale: boolean };
  const rows: StaleRow[] = [];
  for (const row of newLeads.data || []) {
    if (!mineName(row.closer) && !mineName(row.scheduler)) continue;
    const last = String(row.latest_interaction || '').slice(0, 10);
    const stage = Number(row.stage);
    const hotStage = stage === 21 || stage === 40 || stage === 50;
    const stale = !last || last <= cutoff;
    if (!stale && !hotStage) continue;
    rows.push({
      stale,
      line: `- ${leadNumberLine(row)} · ${getStageName(stage)} · last touch ${last || 'unknown'} · ${
        stage === 50 ? 'Chase signature' : stage === 40 ? 'Send offer' : stage === 21 ? 'Rebook' : 'Chase'
      }`,
    });
  }
  for (const row of legacyLeads.data || []) {
    const last = String(row.latest_interaction || '').slice(0, 10);
    const stage = Number(row.stage);
    const hotStage = stage === 21 || stage === 40 || stage === 50;
    const stale = !last || last <= cutoff;
    if (!stale && !hotStage) continue;
    rows.push({
      stale,
      line: `- ${leadNumberLine(row)} · ${getStageName(stage)} · last touch ${last || 'unknown'} · Chase`,
    });
  }

  const staleFirst = [...rows.filter((r) => r.stale), ...rows.filter((r) => !r.stale)].slice(0, 25);
  return [
    `STALE / CHASE LEADS (${days}+ days quiet, or stage 21/40/50)`,
    `As of ${today} Asia/Jerusalem`,
    staleFirst.length ? staleFirst.map((r) => r.line).join('\n') : 'None found.',
    '',
    'List each lead with the exact lead number first as a bare token, last touch, and one chase action. Never omit the lead number. Do not invent last-touch dates.',
  ].join('\n');
}
