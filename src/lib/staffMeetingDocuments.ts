export type StaffMeetingDocumentsContext =
  | { mode: 'lead'; leadNumber: string; clientName: string; clientId?: string | null }
  | { mode: 'meeting'; staffMeetingId: number; meetingTitle: string };

const SEQUENCE_SLUGS = new Set(['sequence_of_events', 'sequence-of-events']);

export function isSequenceOfEventsSlug(slug: string | null | undefined): boolean {
  return !!slug && SEQUENCE_SLUGS.has(slug.trim());
}

export function isPlaceholderStaffLead(lead: any): boolean {
  if (!lead) return true;
  const id = String(lead.id ?? '');
  if (id.startsWith('staff-')) return true;
  if (String(lead.lead_number ?? '').toUpperCase() === 'STAFF') return true;
  if (lead.email === '--') return true;
  return false;
}

/** Resolve whether docs go to lead (sequence of events) or staff_meeting_documents. */
export function resolveStaffMeetingDocumentsContext(
  meeting: any,
  dbMeetingId: number | null,
): StaffMeetingDocumentsContext | null {
  if (!dbMeetingId || !Number.isFinite(dbMeetingId)) return null;

  const title = String(
    meeting?.meeting_subject || meeting?.subject || meeting?.lead?.name || 'Internal meeting',
  ).trim();

  const lead = meeting?.lead;
  const legacyLead = meeting?.legacy_lead;

  if (!isPlaceholderStaffLead(lead) && lead?.lead_number) {
    return {
      mode: 'lead',
      leadNumber: String(lead.lead_number),
      clientName: String(lead.name || title),
      clientId: lead.id != null ? String(lead.id) : null,
    };
  }

  if (meeting?.client_id && lead?.lead_number && !isPlaceholderStaffLead(lead)) {
    return {
      mode: 'lead',
      leadNumber: String(lead.lead_number),
      clientName: String(lead.name || title),
      clientId: String(meeting.client_id),
    };
  }

  if (meeting?.legacy_lead_id != null || legacyLead?.id != null) {
    const legacyId = legacyLead?.id ?? meeting.legacy_lead_id;
    const leadNumber = legacyLead?.lead_number ?? String(legacyId);
    return {
      mode: 'lead',
      leadNumber: String(leadNumber),
      clientName: String(legacyLead?.name || title),
      clientId: legacyId != null ? `legacy_${legacyId}` : null,
    };
  }

  return { mode: 'meeting', staffMeetingId: dbMeetingId, meetingTitle: title };
}

/** Lead record for client navigation when an internal meeting is tied to a lead. */
export function resolveStaffMeetingLinkedLead(meeting: any): Record<string, any> | null {
  if (!meeting) return null;

  const lead = meeting.lead;
  const legacyLead = meeting.legacy_lead;

  const asLegacy = (legacyId: string | number, row?: Record<string, any> | null) => {
    const idStr = String(legacyId).replace(/^legacy_/, '');
    return {
      ...(row || {}),
      id: row?.id != null && String(row.id).startsWith('legacy_') ? row.id : `legacy_${idStr}`,
      lead_type: 'legacy',
      lead_number: row?.lead_number ?? idStr,
      name: row?.name ?? lead?.name,
      manual_id: row?.manual_id,
    };
  };

  const asNew = (row: Record<string, any>, clientId?: string | null) => ({
    ...row,
    id: clientId ?? row.id,
    lead_type: row.lead_type || 'new',
    lead_number: row.lead_number,
    name: row.name,
    manual_id: row.manual_id,
  });

  if (!isPlaceholderStaffLead(lead) && lead?.lead_number) {
    if (lead.lead_type === 'legacy' || String(lead.id ?? '').startsWith('legacy_')) {
      const legacyId = String(lead.id ?? '').replace(/^legacy_/, '') || lead.lead_number;
      return asLegacy(legacyId, lead);
    }
    return asNew(lead, meeting.client_id ?? lead.id);
  }

  if (meeting?.legacy_lead_id != null || legacyLead?.id != null) {
    const legacyId = legacyLead?.id ?? meeting.legacy_lead_id;
    return asLegacy(legacyId, legacyLead);
  }

  const subject = String(meeting.meeting_subject || lead?.name || meeting.name || '').trim();
  const hashMatch = subject.match(/\[#([^\]]+)\]/);
  if (hashMatch) {
    const leadNumber = hashMatch[1].trim();
    if (/^\d+$/.test(leadNumber)) {
      return asLegacy(leadNumber, { lead_number: leadNumber, name: lead?.name });
    }
    return asNew(
      { lead_number: leadNumber, name: lead?.name, manual_id: lead?.manual_id },
      meeting.client_id ?? leadNumber,
    );
  }

  if (meeting?.client_id && lead?.lead_number && lead.lead_number !== 'STAFF') {
    return asNew(lead, meeting.client_id);
  }

  return null;
}
