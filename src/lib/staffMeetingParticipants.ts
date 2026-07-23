import { supabase } from './supabase';

export type EnrichedMeetingParticipant = {
  participantRowId: string | null;
  type: 'staff' | 'firm' | 'extern';
  badge: string;
  name: string;
  subtitle?: string | null;
  imageUrl?: string | null;
  details?: {
    email?: string | null;
    phone?: string | null;
    notes?: string | null;
  } | null;
};

/** Load meeting_participants with staff/firm enrichment (avatars, email, phone). */
export async function fetchEnrichedMeetingParticipants(
  meetingId: number,
): Promise<EnrichedMeetingParticipant[]> {
  const { data: partData, error: partErr } = await supabase
    .from('meeting_participants')
    .select('id, employee_id, firm_contact_id, free_name, free_email, free_phone, notes')
    .eq('meeting_id', meetingId);
  if (partErr) throw partErr;

  const employeeIds = Array.from(
    new Set(
      (partData || [])
        .map((r: any) => (r.employee_id != null ? Number(r.employee_id) : null))
        .filter((n: any) => Number.isFinite(n) && n > 0),
    ),
  ) as number[];
  const firmIds = Array.from(
    new Set(
      (partData || [])
        .map((r: any) => (r.firm_contact_id ? String(r.firm_contact_id) : null))
        .filter(Boolean),
    ),
  ) as string[];

  const fetchEmployeesWithPhones = async () => {
    if (!employeeIds.length) return { data: [] as any[], error: null as any };
    const res = await supabase
      .from('tenants_employee')
      .select('id, display_name, photo_url, photo, phone, mobile, phone_ext')
      .in('id', employeeIds);
    if (!res.error) return res;
    const err: any = res.error;
    if (err?.code === '42703') {
      return await supabase
        .from('tenants_employee')
        .select('id, display_name, photo_url, photo')
        .in('id', employeeIds);
    }
    return res;
  };

  const [empsRes, usersRes, firmsRes] = await Promise.all([
    fetchEmployeesWithPhones(),
    employeeIds.length
      ? supabase
          .from('users')
          .select('employee_id, email')
          .in('employee_id', employeeIds)
          .not('email', 'is', null)
      : Promise.resolve({ data: [] as any[] }),
    firmIds.length
      ? supabase
          .from('firm_contacts')
          .select(
            'id, name, profile_image_url, email, second_email, phone, notes, firm_id, firms!firm_contacts_firm_id_fkey(id, name)',
          )
          .in('id', firmIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const empById = new Map<number, any>();
  (empsRes as any).data?.forEach((e: any) => empById.set(Number(e.id), e));
  const emailByEmployeeId = new Map<number, string>();
  (usersRes as any).data?.forEach((u: any) => {
    const eid = Number(u.employee_id);
    if (Number.isFinite(eid) && eid > 0 && u.email) emailByEmployeeId.set(eid, String(u.email));
  });
  const firmById = new Map<string, any>();
  (firmsRes as any).data?.forEach((f: any) => firmById.set(String(f.id), f));

  return (partData || []).map((r: any) => {
    if (r.employee_id != null) {
      const e = empById.get(Number(r.employee_id));
      const phoneCandidate = e?.mobile || e?.phone || null;
      const phoneExt = e?.phone_ext ? String(e.phone_ext) : '';
      const phone = phoneCandidate
        ? `${String(phoneCandidate)}${phoneExt ? ` ext ${phoneExt}` : ''}`
        : null;
      return {
        participantRowId: r.id != null ? String(r.id) : null,
        type: 'staff' as const,
        badge: 'Staff',
        name: e?.display_name || `#${r.employee_id}`,
        imageUrl: e?.photo_url || e?.photo || null,
        details: {
          email: emailByEmployeeId.get(Number(r.employee_id)) || null,
          phone,
          notes: null,
        },
      };
    }
    if (r.firm_contact_id) {
      const f = firmById.get(String(r.firm_contact_id));
      const firmObj = Array.isArray(f?.firms) ? f.firms[0] : f?.firms;
      const firmName = firmObj?.name ? String(firmObj.name) : null;
      return {
        participantRowId: r.id != null ? String(r.id) : null,
        type: 'firm' as const,
        badge: 'Firm',
        name: f?.name || 'Firm contact',
        subtitle: firmName,
        imageUrl: f?.profile_image_url || null,
        details: {
          email: f?.email || f?.second_email || null,
          phone: f?.phone || null,
          notes: f?.notes || r.notes || null,
        },
      };
    }
    return {
      participantRowId: r.id != null ? String(r.id) : null,
      type: 'extern' as const,
      badge:
        String(r.notes || '').trim() === 'Candidate' ? 'Candidate' : 'Extern',
      name: r.free_name || 'Guest',
      imageUrl: null,
      details: {
        email: r.free_email || null,
        phone: r.free_phone || null,
        notes: r.notes || null,
      },
    };
  });
}

export async function fetchEnrichedParticipantsByMeetingIds(
  meetingIds: number[],
): Promise<Record<number, EnrichedMeetingParticipant[]>> {
  const unique = Array.from(new Set(meetingIds.filter((id) => Number.isFinite(id))));
  const entries = await Promise.all(
    unique.map(async (id) => {
      try {
        const rows = await fetchEnrichedMeetingParticipants(id);
        return [id, rows] as const;
      } catch {
        return [id, [] as EnrichedMeetingParticipant[]] as const;
      }
    }),
  );
  return Object.fromEntries(entries);
}

export async function removeMeetingParticipantRow(participantRowId: string): Promise<void> {
  const { error } = await supabase
    .from('meeting_participants')
    .delete()
    .eq('id', participantRowId);
  if (error) throw error;
}
