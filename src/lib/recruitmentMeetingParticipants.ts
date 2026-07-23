import { supabase } from './supabase';
import {
  type FreeMeetingParticipant,
  type MeetingParticipantsSelection,
} from './meetingParticipants';

/** Stored on meeting_participants.notes to identify the recruitment candidate guest. */
export const RECRUITMENT_CANDIDATE_PARTICIPANT_NOTE = 'Candidate';

export type RecruitmentCandidateContact = {
  name: string;
  email: string | null;
  phone: string | null;
};

export async function fetchRecruitmentCandidateContact(
  userId: string,
  displayNameFallback?: string,
): Promise<RecruitmentCandidateContact> {
  const [{ data: userRow }, { data: candRow }] = await Promise.all([
    supabase
      .from('users')
      .select('email, full_name, first_name, last_name')
      .eq('id', userId)
      .maybeSingle(),
    supabase
      .from('recruitment_candidates')
      .select('phone')
      .eq('user_id', userId)
      .maybeSingle(),
  ]);

  const full = String(userRow?.full_name || '').trim();
  const parts = [userRow?.first_name, userRow?.last_name]
    .map((p) => String(p || '').trim())
    .filter(Boolean);
  const name =
    full ||
    parts.join(' ') ||
    String(displayNameFallback || '').trim() ||
    String(userRow?.email || '').trim() ||
    'Candidate';

  return {
    name,
    email: userRow?.email ? String(userRow.email).trim() : null,
    phone: candRow?.phone ? String(candRow.phone).trim() : null,
  };
}

function isCandidateFreeParticipant(p: {
  name?: string | null;
  email?: string | null;
  notes?: string | null;
}, contact: RecruitmentCandidateContact): boolean {
  const notes = String(p.notes || '').trim();
  if (notes === RECRUITMENT_CANDIDATE_PARTICIPANT_NOTE) return true;
  const email = String(contact.email || '').trim().toLowerCase();
  const pEmail = String(p.email || '').trim().toLowerCase();
  if (email && pEmail && email === pEmail) return true;
  const name = contact.name.trim().toLowerCase();
  const pName = String(p.name || '').trim().toLowerCase();
  return Boolean(name && pName && name === pName);
}

/** Prefill / merge candidate into a participants selection (picker + save). */
export function withRecruitmentCandidateParticipant(
  selection: MeetingParticipantsSelection,
  contact: RecruitmentCandidateContact,
): MeetingParticipantsSelection {
  const free = [...(selection.freeParticipants || [])];
  if (free.some((p) => isCandidateFreeParticipant(p, contact))) {
    return selection;
  }
  const candidateRow: FreeMeetingParticipant = {
    name: contact.name,
    email: contact.email || undefined,
    phone: contact.phone || undefined,
    notes: RECRUITMENT_CANDIDATE_PARTICIPANT_NOTE,
  };
  return {
    ...selection,
    freeParticipants: [candidateRow, ...free],
  };
}

/**
 * Ensure the CRM recruitment user is stored as a free meeting participant
 * so WhatsApp / email notify and participant modals can reach them.
 */
export async function ensureRecruitmentCandidateParticipant(
  meetingId: number,
  userId: string,
  displayNameFallback?: string,
): Promise<boolean> {
  if (!Number.isFinite(meetingId) || meetingId <= 0 || !userId) return false;

  const contact = await fetchRecruitmentCandidateContact(userId, displayNameFallback);

  const { data: existing, error: existingError } = await supabase
    .from('meeting_participants')
    .select('id, free_name, free_email, notes')
    .eq('meeting_id', meetingId)
    .is('employee_id', null)
    .is('firm_contact_id', null);

  if (existingError) throw existingError;

  const already = (existing || []).some((row) =>
    isCandidateFreeParticipant(
      {
        name: row.free_name,
        email: row.free_email,
        notes: row.notes,
      },
      contact,
    ),
  );
  if (already) return false;

  const { error: insertError } = await supabase.from('meeting_participants').insert({
    meeting_id: meetingId,
    free_name: contact.name,
    free_email: contact.email,
    free_phone: contact.phone,
    notes: RECRUITMENT_CANDIDATE_PARTICIPANT_NOTE,
  });
  if (insertError) throw insertError;
  return true;
}
