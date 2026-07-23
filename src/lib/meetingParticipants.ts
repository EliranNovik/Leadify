import { supabase } from './supabase';

export type FreeMeetingParticipant = {
  name: string;
  email?: string;
  phone?: string;
  notes?: string;
};

export type MeetingParticipantsSelection = {
  employeeIds: number[];
  firmContactIds: string[];
  freeParticipants: FreeMeetingParticipant[];
};

export type LoadedMeetingParticipant = {
  employee_id: number | null;
  firm_contact_id: string | null;
  free_name: string | null;
  free_email: string | null;
  free_phone: string | null;
  notes: string | null;
};

export function buildMeetingParticipantRows(
  meetingId: number,
  selection: MeetingParticipantsSelection,
  freeDraft?: FreeMeetingParticipant | null,
): Array<Record<string, unknown>> {
  const freeDraftName = String(freeDraft?.name || '').trim();
  const freeDraftToSave =
    freeDraftName
      ? {
          name: freeDraftName,
          email: String(freeDraft?.email || '').trim() || undefined,
          phone: String(freeDraft?.phone || '').trim() || undefined,
          notes: String(freeDraft?.notes || '').trim() || undefined,
        }
      : null;

  const effectiveFree = [
    ...(selection.freeParticipants || []),
    ...(freeDraftToSave ? [freeDraftToSave] : []),
  ].filter((p) => p && typeof p.name === 'string' && p.name.trim() !== '');

  const rows: Array<Record<string, unknown>> = [];
  selection.employeeIds.forEach((employeeId) =>
    rows.push({ meeting_id: meetingId, employee_id: employeeId }),
  );
  selection.firmContactIds.forEach((firmContactId) =>
    rows.push({ meeting_id: meetingId, firm_contact_id: firmContactId }),
  );
  effectiveFree.forEach((p) =>
    rows.push({
      meeting_id: meetingId,
      free_name: String(p.name).trim(),
      free_email: p.email ? String(p.email).trim() : null,
      free_phone: p.phone ? String(p.phone).trim() : null,
      notes: p.notes ? String(p.notes).trim() : null,
    }),
  );
  return rows;
}

export async function replaceMeetingParticipants(
  meetingId: number,
  selection: MeetingParticipantsSelection,
  freeDraft?: FreeMeetingParticipant | null,
): Promise<void> {
  const { error: delErr } = await supabase
    .from('meeting_participants')
    .delete()
    .eq('meeting_id', meetingId);
  if (delErr) throw delErr;

  const rows = buildMeetingParticipantRows(meetingId, selection, freeDraft);
  if (rows.length === 0) return;

  const { error: insErr } = await supabase.from('meeting_participants').insert(rows);
  if (insErr) throw insErr;
}

export async function fetchMeetingParticipants(
  meetingId: number,
): Promise<LoadedMeetingParticipant[]> {
  const { data, error } = await supabase
    .from('meeting_participants')
    .select('employee_id, firm_contact_id, free_name, free_email, free_phone, notes')
    .eq('meeting_id', meetingId);
  if (error) throw error;
  return (data || []).map((r: any) => ({
    employee_id: r.employee_id != null ? Number(r.employee_id) : null,
    firm_contact_id: r.firm_contact_id ? String(r.firm_contact_id) : null,
    free_name: r.free_name ?? null,
    free_email: r.free_email ?? null,
    free_phone: r.free_phone ?? null,
    notes: r.notes ?? null,
  }));
}

export function selectionFromLoadedParticipants(
  rows: LoadedMeetingParticipant[],
): MeetingParticipantsSelection {
  return {
    employeeIds: rows
      .map((r) => r.employee_id)
      .filter((id): id is number => id != null && Number.isFinite(id)),
    firmContactIds: rows
      .map((r) => r.firm_contact_id)
      .filter((id): id is string => !!id),
    freeParticipants: rows
      .filter((r) => r.free_name)
      .map((r) => ({
        name: String(r.free_name),
        email: r.free_email || undefined,
        phone: r.free_phone || undefined,
        notes: r.notes || undefined,
      })),
  };
}
