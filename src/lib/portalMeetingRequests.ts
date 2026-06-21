import { supabase } from './supabase';

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
