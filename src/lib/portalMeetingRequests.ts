import { supabase } from './supabase';
import { CLIENT_PORTAL_BOOKING_SCHEDULER } from './clientBookingApi';

export type PortalMeetingRequestContact = {
  name: string;
  portal_profile_image_path: string | null;
};

export type PortalMeetingRequest = {
  id: number;
  preferred_date: string;
  preferred_time_range: string | null;
  notes: string | null;
  status: string;
  created_at: string;
  contact_id: number;
  new_lead_id: string | null;
  legacy_lead_id: number | null;
  leads_contact?: PortalMeetingRequestContact | PortalMeetingRequestContact[];
  leads?: { lead_number: string; manual_id: string | null } | null;
  leads_lead?: {
    id: number;
    lead_number: string | null;
    master_id: string | null;
    stage: number | null;
  } | null;
};

const PORTAL_MEETING_REQUESTS_SELECT = `
  id,
  preferred_date,
  preferred_time_range,
  notes,
  status,
  created_at,
  contact_id,
  new_lead_id,
  legacy_lead_id,
  leads_contact (name, portal_profile_image_path),
  leads (lead_number, manual_id),
  leads_lead (id, lead_number, master_id, stage)
`;

export async function fetchPendingPortalMeetingRequests(): Promise<PortalMeetingRequest[]> {
  const { data, error } = await supabase
    .from('client_portal_meeting_requests')
    .select(PORTAL_MEETING_REQUESTS_SELECT)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as PortalMeetingRequest[];
}

export function resolvePortalRequestContact(
  req: PortalMeetingRequest,
): PortalMeetingRequestContact | null {
  const raw = req.leads_contact;
  if (!raw) return null;
  return Array.isArray(raw) ? raw[0] ?? null : raw;
}

export function getPortalRequestLeadNumber(req: PortalMeetingRequest): string {
  if (req.new_lead_id && req.leads?.lead_number) {
    return req.leads.lead_number;
  }

  if (req.legacy_lead_id && req.leads_lead) {
    const ll = req.leads_lead;
    const raw = (ll.lead_number ?? '').toString().trim();
    if (raw) {
      const isSuccess = ll.stage === 100;
      if (isSuccess && !raw.startsWith('C')) return `C${raw}`;
      return raw;
    }
    const id = String(ll.id);
    const masterId = ll.master_id?.toString().trim();
    if (!masterId) {
      return ll.stage === 100 ? `C${id}` : id;
    }
    return `${masterId}/?`;
  }

  if (req.new_lead_id) return 'Unknown lead';
  if (req.legacy_lead_id) return String(req.legacy_lead_id);
  return 'Unknown lead';
}

/** Build a /clients/... route for a portal meeting request (same rules as CalendarPage.buildClientRoute). */
export function buildPortalRequestClientRoute(req: PortalMeetingRequest): string {
  if (req.new_lead_id && req.leads) {
    const lead = {
      lead_type: 'new' as const,
      lead_number: req.leads.lead_number,
      manual_id: req.leads.manual_id,
    };
    return buildClientRouteFromLead(lead);
  }

  if (req.legacy_lead_id && req.leads_lead) {
    const lead = {
      lead_type: 'legacy' as const,
      id: `legacy_${req.leads_lead.id}`,
      lead_number: getPortalRequestLeadNumber(req),
    };
    return buildClientRouteFromLead(lead);
  }

  return '/clients';
}

export function buildPortalRequestMeetingTabRoute(req: PortalMeetingRequest): string {
  const base = buildPortalRequestClientRoute(req);
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}tab=meeting`;
}

function buildClientRouteFromLead(lead: {
  lead_type?: 'new' | 'legacy' | string;
  lead_number?: string;
  manual_id?: string | null;
  id?: string | number;
}): string {
  if (lead.lead_type === 'new' && lead.lead_number) {
    const isSubLead = lead.lead_number.includes('/');
    if (isSubLead) {
      const manualId = lead.manual_id || null;
      if (manualId) {
        return `/clients/${encodeURIComponent(manualId)}?lead=${encodeURIComponent(lead.lead_number)}`;
      }
      const baseLeadNumber = lead.lead_number.split('/')[0];
      return `/clients/${encodeURIComponent(baseLeadNumber)}?lead=${encodeURIComponent(lead.lead_number)}`;
    }
    const identifier = lead.manual_id || lead.lead_number || '';
    return `/clients/${encodeURIComponent(identifier)}`;
  }

  if (lead.lead_type === 'legacy' || lead.id?.toString().startsWith('legacy_')) {
    const legacyId = lead.id?.toString().replace('legacy_', '') || lead.id;
    const isSubLead = lead.lead_number && lead.lead_number.includes('/');

    if (isSubLead) {
      return `/clients/${encodeURIComponent(String(legacyId))}?lead=${encodeURIComponent(lead.lead_number!)}`;
    }
    return `/clients/${encodeURIComponent(String(legacyId))}`;
  }

  if (lead.lead_number) {
    const isSubLead = lead.lead_number.includes('/');
    if (isSubLead) {
      const baseLeadNumber = lead.lead_number.split('/')[0];
      return `/clients/${encodeURIComponent(baseLeadNumber)}?lead=${encodeURIComponent(lead.lead_number)}`;
    }
    return `/clients/${encodeURIComponent(lead.lead_number)}`;
  }

  return '/clients';
}

export function formatPortalPreferredDate(value: string): string {
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return value;
  }
}

export function formatPortalRequestedAt(value: string): string {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export async function updatePortalMeetingRequestStatus(
  id: number,
  status: 'confirmed' | 'cancelled',
): Promise<void> {
  const { error } = await supabase
    .from('client_portal_meeting_requests')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) throw error;
}

export type ClientPortalBookedMeetingLead = {
  id: string | number;
  name: string | null;
  lead_number: string | null;
  manual_id?: string | null;
  master_id?: string | null;
  stage?: number | null;
};

export type ClientPortalBookedMeeting = {
  id: number;
  meeting_date: string;
  meeting_time: string | null;
  meeting_location: string | null;
  meeting_subject: string | null;
  status: string | null;
  scheduler: string | null;
  client_booking_timezone: string | null;
  client_id: string | null;
  legacy_lead_id: number | null;
  teams_meeting_url: string | null;
  custom_link: string | null;
  leads?: ClientPortalBookedMeetingLead | ClientPortalBookedMeetingLead[] | null;
  leads_lead?: ClientPortalBookedMeetingLead | ClientPortalBookedMeetingLead[] | null;
};

function todayLocalDateKey(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function firstJoinedLead<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

/** Upcoming (today+) meetings booked by clients via portal / public booking link. */
export async function fetchUpcomingClientPortalBookings(): Promise<ClientPortalBookedMeeting[]> {
  const today = todayLocalDateKey();
  const { data, error } = await supabase
    .from('meetings')
    .select(
      `
      id,
      meeting_date,
      meeting_time,
      meeting_location,
      meeting_subject,
      status,
      scheduler,
      client_booking_timezone,
      client_id,
      legacy_lead_id,
      teams_meeting_url,
      custom_link,
      leads!meetings_client_id_fkey (id, name, lead_number, manual_id),
      leads_lead!meetings_legacy_lead_id_fkey (id, name, lead_number, master_id, stage)
    `,
    )
    .eq('scheduler', CLIENT_PORTAL_BOOKING_SCHEDULER)
    .gte('meeting_date', today)
    .or('status.is.null,status.neq.canceled')
    .order('meeting_date', { ascending: true })
    .order('meeting_time', { ascending: true });

  if (error) throw error;
  return (data ?? []) as ClientPortalBookedMeeting[];
}

export function resolveClientPortalBookedMeetingLead(
  meeting: ClientPortalBookedMeeting,
): { lead: ClientPortalBookedMeetingLead; leadType: 'new' | 'legacy' } | null {
  const newLead = firstJoinedLead(meeting.leads);
  if (meeting.client_id && newLead) {
    return { lead: newLead, leadType: 'new' };
  }
  const legacyLead = firstJoinedLead(meeting.leads_lead);
  if (meeting.legacy_lead_id && legacyLead) {
    return { lead: legacyLead, leadType: 'legacy' };
  }
  return null;
}

export function getClientPortalBookedMeetingLeadNumber(meeting: ClientPortalBookedMeeting): string {
  const resolved = resolveClientPortalBookedMeetingLead(meeting);
  if (!resolved) {
    if (meeting.client_id) return 'Unknown lead';
    if (meeting.legacy_lead_id) return String(meeting.legacy_lead_id);
    return 'Unknown lead';
  }

  const { lead, leadType } = resolved;
  const raw = (lead.lead_number ?? '').toString().trim();
  if (leadType === 'legacy') {
    if (raw) {
      const isSuccess = lead.stage === 100;
      if (isSuccess && !raw.startsWith('C')) return `C${raw}`;
      return raw;
    }
    const id = String(lead.id);
    const masterId = lead.master_id?.toString().trim();
    if (!masterId) {
      return lead.stage === 100 ? `C${id}` : id;
    }
    return `${masterId}/?`;
  }
  return raw || String(lead.id);
}

export function buildClientPortalBookedMeetingRoute(meeting: ClientPortalBookedMeeting): string {
  const resolved = resolveClientPortalBookedMeetingLead(meeting);
  if (!resolved) return '/clients';

  const { lead, leadType } = resolved;
  if (leadType === 'new') {
    return buildClientRouteFromLead({
      lead_type: 'new',
      lead_number: lead.lead_number || undefined,
      manual_id: lead.manual_id,
    });
  }

  return buildClientRouteFromLead({
    lead_type: 'legacy',
    id: `legacy_${lead.id}`,
    lead_number: getClientPortalBookedMeetingLeadNumber(meeting),
  });
}

export function buildClientPortalBookedMeetingTabRoute(meeting: ClientPortalBookedMeeting): string {
  const base = buildClientPortalBookedMeetingRoute(meeting);
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}tab=meeting`;
}
