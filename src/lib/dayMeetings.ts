import { supabase } from './supabase';
import { resolveMeetingHeaderKind, type MeetingHeaderKind } from './meetingHeaderColors';
import type { EffortAreaId } from './workAreaEfforts';

export type MeetingDisregard = 'didnt_participate' | 'client_no_show';

export type DayMeetingChoice =
  | { kind: 'area'; area: EffortAreaId }
  | { kind: 'disregard'; reason: MeetingDisregard };

export type DayMeeting = {
  id: number;
  time: string;
  place: string;
  leadKey: string | null;
  leadNumber: string;
  clientName: string;
  kind: MeetingHeaderKind;
};

const MEETING_AREAS: EffortAreaId[] = ['marketing', 'sales', 'finances', 'development'];

function isEffortAreaId(value: string): value is EffortAreaId {
  return (MEETING_AREAS as string[]).includes(value);
}

function leadKeyFromMeeting(clientId: unknown, legacyLeadId: unknown): string | null {
  if (clientId) return `new:${String(clientId)}`;
  const legacy = Number(legacyLeadId);
  if (Number.isFinite(legacy) && legacy > 0) return `legacy:${legacy}`;
  return null;
}

export async function fetchDayMeetingsForEmployee(params: {
  employeeId: number;
  employeeName: string;
  workDate: string;
}): Promise<DayMeeting[]> {
  const fullSelect =
    'id, meeting_time, meeting_manager, meeting_location, meeting_brief, meeting_subject, status, client_id, legacy_lead_id, extern1, extern2, calendar_type';
  const safeSelect =
    'id, meeting_time, meeting_manager, meeting_location, meeting_brief, status, client_id, legacy_lead_id, calendar_type';
  let result = await supabase
    .from('meetings')
    .select(fullSelect)
    .eq('meeting_date', params.workDate)
    .or('status.is.null,status.neq.canceled')
    .order('meeting_time', { ascending: true })
    .limit(400);
  if (result.error) {
    result = await supabase
      .from('meetings')
      .select(safeSelect)
      .eq('meeting_date', params.workDate)
      .or('status.is.null,status.neq.canceled')
      .order('meeting_time', { ascending: true })
      .limit(400);
  }
  const { data, error } = result;
  if (error) throw error;

  const rows = data || [];
  const ids = rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id));
  const participantIds = new Set<number>();
  if (ids.length > 0) {
    const { data: participants, error: participantError } = await supabase
      .from('meeting_participants')
      .select('meeting_id, employee_id')
      .in('meeting_id', ids)
      .eq('employee_id', params.employeeId);
    if (!participantError) {
      for (const row of participants || []) {
        if (Number(row.employee_id) === params.employeeId) participantIds.add(Number(row.meeting_id));
      }
    }
  }

  const name = params.employeeName.trim().toLowerCase();
  const employeeToken = String(params.employeeId);
  const mine = rows.filter((row) => {
    const id = Number(row.id);
    if (participantIds.has(id)) return true;
    if (String(row.extern1 || '') === employeeToken || String(row.extern2 || '') === employeeToken) return true;
    const manager = String(row.meeting_manager || '').trim().toLowerCase();
    return Boolean(name) && manager === name;
  });

  const newIds = [...new Set(mine.map((row) => row.client_id).filter(Boolean).map(String))];
  const legacyIds = [...new Set(mine.map((row) => Number(row.legacy_lead_id)).filter((id) => Number.isFinite(id) && id > 0))];
  const newLeads = new Map<string, { name: string; number: string }>();
  const legacyLeads = new Map<number, { name: string; number: string }>();

  if (newIds.length > 0) {
    const { data: leads } = await supabase.from('leads').select('id, name, lead_number').in('id', newIds);
    for (const lead of leads || []) {
      newLeads.set(String(lead.id), {
        name: String(lead.name || '').trim(),
        number: String(lead.lead_number || '').trim(),
      });
    }
  }
  if (legacyIds.length > 0) {
    const { data: leads } = await supabase.from('leads_lead').select('id, name, lead_number').in('id', legacyIds);
    for (const lead of leads || []) {
      legacyLeads.set(Number(lead.id), {
        name: String(lead.name || '').trim(),
        number: String(lead.lead_number || '').trim(),
      });
    }
  }

  const staffIds = mine
    .filter((row) => {
      const calendarType = String(row.calendar_type || '');
      return calendarType === 'staff' || calendarType === 'recruitment';
    })
    .map((row) => Number(row.id))
    .filter((id) => Number.isFinite(id));
  const meetingsWithOutsiders = new Set<number>();
  if (staffIds.length > 0) {
    const { data: guests } = await supabase
      .from('meeting_participants')
      .select('meeting_id, firm_contact_id, free_name, free_email')
      .in('meeting_id', staffIds);
    for (const guest of guests || []) {
      const outside =
        Boolean(guest.firm_contact_id) ||
        Boolean(String(guest.free_name || '').trim()) ||
        Boolean(String(guest.free_email || '').trim());
      if (outside) meetingsWithOutsiders.add(Number(guest.meeting_id));
    }
  }

  return mine.map((row) => {
    const clientId = row.client_id ? String(row.client_id) : '';
    const legacyId = Number(row.legacy_lead_id);
    const lead = clientId ? newLeads.get(clientId) : legacyLeads.get(legacyId);
    const subject = String(row.meeting_subject || row.meeting_brief || '').trim();
    const id = Number(row.id);
    return {
      id,
      time: String(row.meeting_time || '').slice(0, 5),
      place: String(row.meeting_location || '').trim() || subject,
      leadKey: leadKeyFromMeeting(row.client_id, row.legacy_lead_id),
      leadNumber: lead?.number || '',
      clientName: lead?.name || subject || 'Meeting',
      kind: resolveMeetingHeaderKind(
        row.calendar_type,
        meetingsWithOutsiders.has(id) ? [{ type: 'firm' }] : [],
      ),
    };
  });
}

export async function fetchMeetingChoices(
  employeeId: number,
  workDate: string,
): Promise<Record<number, DayMeetingChoice>> {
  const { data, error } = await supabase
    .from('employee_daily_meeting_allocations')
    .select('meeting_id, area, disregard')
    .eq('employee_id', employeeId)
    .eq('work_date', workDate);
  if (error) throw error;
  const choices: Record<number, DayMeetingChoice> = {};
  for (const row of data || []) {
    const id = Number(row.meeting_id);
    const area = String(row.area || '');
    const disregard = String(row.disregard || '');
    if (isEffortAreaId(area)) choices[id] = { kind: 'area', area };
    else if (disregard === 'didnt_participate' || disregard === 'client_no_show') {
      choices[id] = { kind: 'disregard', reason: disregard };
    }
  }
  return choices;
}

export async function saveMeetingChoice(params: {
  employeeId: number;
  workDate: string;
  meetingId: number;
  choice: DayMeetingChoice | null;
}): Promise<void> {
  if (!params.choice) {
    const { error } = await supabase
      .from('employee_daily_meeting_allocations')
      .delete()
      .eq('employee_id', params.employeeId)
      .eq('work_date', params.workDate)
      .eq('meeting_id', params.meetingId);
    if (error) throw error;
    return;
  }
  const { error } = await supabase.from('employee_daily_meeting_allocations').upsert(
    {
      employee_id: params.employeeId,
      work_date: params.workDate,
      meeting_id: params.meetingId,
      area: params.choice.kind === 'area' ? params.choice.area : null,
      disregard: params.choice.kind === 'disregard' ? params.choice.reason : null,
    },
    { onConflict: 'employee_id,work_date,meeting_id' },
  );
  if (error) throw error;
}
