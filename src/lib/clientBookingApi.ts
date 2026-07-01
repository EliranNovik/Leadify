const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001').replace(/\/+$/, '');

function buildUrl(path: string) {
  return `${BACKEND_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

async function parseJson(response: Response): Promise<{ success?: boolean; data?: unknown; error?: string }> {
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  if (!response.ok) {
    const message =
      payload &&
      typeof payload === 'object' &&
      'error' in payload &&
      typeof (payload as { error: unknown }).error === 'string'
        ? (payload as { error: string }).error
        : response.statusText || 'Request failed';
    throw new Error(message);
  }
  return payload as { success?: boolean; data?: unknown; error?: string };
}

/** Locations the client picks when booking (not configured by staff). */
export const CLIENT_BOOKING_LOCATION_OPTIONS = [
  {
    value: 'Teams',
    label: 'Teams',
    description: 'Online video meeting — link sent after booking',
  },
  {
    value: 'Ramat Gan Office',
    label: 'Ramat Gan Office',
    description: 'In person at our Ramat Gan office',
  },
] as const;

export type ClientBookingLocation = (typeof CLIENT_BOOKING_LOCATION_OPTIONS)[number]['value'];

export type BookingContact = {
  id: number;
  name: string;
  email?: string | null;
  mobile?: string | null;
  phone?: string | null;
  is_main?: boolean;
};

export type CategoryAvailabilityRule = {
  id?: string;
  main_category_ids: number[];
  business_hours_start: string;
  business_hours_end: string;
  days_of_week: number[];
  /** Combined cap for selected categories per clock hour per day; null = unlimited */
  max_meetings_per_hour?: number | null;
};

export type PublicBookingConfig = {
  settings: {
    title: string;
    description?: string | null;
    duration_minutes: number;
    location_options?: ClientBookingLocation[];
    timezone: string;
    min_notice_hours: number;
    max_days_ahead: number;
    business_hours_start: string;
    business_hours_end: string;
    days_of_week: number[];
    send_email: boolean;
    send_whatsapp: boolean;
    category_availability_rules?: CategoryAvailabilityRule[];
    unavailable_dates?: string[];
  };
  lead: {
    lead_number: string;
    lead_ref?: string;
    display_name: string;
    category?: string | null;
    main_category_id?: number | null;
    main_category_name?: string | null;
    language_id?: number | null;
    is_legacy: boolean;
  };
  host: {
    name?: string | null;
    photo_url?: string | null;
  };
  contacts: BookingContact[];
};

export type LeadBookingSettings = {
  id: number;
  booking_token: string;
  enabled: boolean;
  title: string;
  description?: string | null;
  duration_minutes: number;
  meeting_location?: string | null;
  meeting_location_id?: number | null;
  host_employee_id?: number | null;
  meeting_manager?: string | null;
  calendar_type: 'potential_client' | 'active_client';
  buffer_minutes: number;
  min_notice_hours: number;
  max_days_ahead: number;
  slot_interval_minutes: number;
  business_hours_start: string;
  business_hours_end: string;
  days_of_week: number[];
  send_email: boolean;
  send_whatsapp: boolean;
  send_calendar_invite: boolean;
  timezone: string;
  category_availability_rules?: CategoryAvailabilityRule[];
  unavailable_dates?: string[];
};

export async function fetchPublicBookingConfig(token: string): Promise<PublicBookingConfig> {
  const response = await fetch(buildUrl('/api/client-booking/config'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  const payload = await parseJson(response);
  if (!payload?.data) throw new Error('Invalid booking link');
  return payload.data as PublicBookingConfig;
}

export async function fetchPublicBookingSlots(
  token: string,
  date: string,
  clientTimezone?: string,
): Promise<{ slots: string[]; timezone: string; business_timezone?: string }> {
  const response = await fetch(buildUrl('/api/client-booking/slots'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, date, client_timezone: clientTimezone }),
  });
  const payload = await parseJson(response);
  return (payload?.data as { slots: string[]; timezone: string; business_timezone?: string }) || {
    slots: [],
    timezone: 'Asia/Jerusalem',
    business_timezone: 'Asia/Jerusalem',
  };
}

export type PublicBookingMeeting = {
  id: number;
  meeting_date: string;
  meeting_time?: string | null;
  meeting_location?: string | null;
  is_physical_meeting?: boolean;
  meeting_address?: string | null;
  meeting_subject?: string | null;
  join_url?: string | null;
  status?: string;
  booked_via_client_link?: boolean;
  client_booking_timezone?: string | null;
};

export async function fetchPublicBookingMeetings(token: string): Promise<PublicBookingMeeting[]> {
  const response = await fetch(buildUrl('/api/client-booking/meetings'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  const payload = await parseJson(response);
  return (payload?.data as { meetings?: PublicBookingMeeting[] })?.meetings ?? [];
}

export async function bookPublicMeeting(
  token: string,
  params: {
    date: string;
    time: string;
    contact_id: number;
    meeting_location: ClientBookingLocation;
    notes?: string;
    client_timezone?: string;
  },
) {
  const response = await fetch(buildUrl('/api/client-booking/book'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, ...params }),
  });
  const payload = await parseJson(response);
  if (!payload?.data) throw new Error('Booking failed');
  return payload.data as {
    ok: boolean;
    meeting: {
      id: number;
      date: string;
      time: string;
      location: string;
      teams_meeting_url?: string;
      subject?: string;
    };
    scheduled_meetings?: PublicBookingMeeting[];
    warnings?: string[];
  };
}

export async function staffGetLeadBookingSettings(leadId: string, leadType: 'new' | 'legacy') {
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase.rpc('staff_get_lead_booking_settings', {
    p_lead_id: leadId,
    p_lead_type: leadType,
  });
  if (error) throw error;
  return data as {
    ok: boolean;
    settings: LeadBookingSettings | null;
    booking_url_path?: string;
  };
}

export type MeetingBookingGlobalSettings = Omit<
  LeadBookingSettings,
  'id' | 'booking_token' | 'enabled'
> & {
  id?: number;
  updated_at?: string;
};

export type MeetingBookingLinkRow = {
  id: number;
  booking_token: string;
  enabled: boolean;
  lead_number?: string | null;
  lead_name?: string | null;
  lead_type: 'new' | 'legacy';
  lead_id?: string | null;
  created_at?: string;
  updated_at?: string;
  booking_url_path?: string;
};

export async function staffGetMeetingBookingGlobalSettings() {
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase.rpc('staff_get_meeting_booking_global_settings');
  if (error) throw error;
  return data as { ok: boolean; settings: MeetingBookingGlobalSettings };
}

export async function staffUpsertMeetingBookingGlobalSettings(
  payload: Partial<MeetingBookingGlobalSettings>,
) {
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase.rpc('staff_upsert_meeting_booking_global_settings', {
    p_payload: payload,
  });
  if (error) throw error;
  return data as { ok: boolean; settings: MeetingBookingGlobalSettings };
}

export async function staffListMeetingBookingLinks() {
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase.rpc('staff_list_meeting_booking_links');
  if (error) throw error;
  return data as { ok: boolean; links: MeetingBookingLinkRow[] };
}

export async function staffUpsertLeadBookingSettings(
  leadId: string,
  leadType: 'new' | 'legacy',
  payload: { enabled?: boolean; generate_link?: boolean },
) {
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase.rpc('staff_upsert_lead_booking_settings', {
    p_lead_id: leadId,
    p_lead_type: leadType,
    p_payload: payload,
  });
  if (error) throw error;
  return data as {
    ok: boolean;
    settings: LeadBookingSettings;
    booking_url_path?: string;
  };
}

export function buildPublicBookingUrl(bookingToken: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/book/${bookingToken}`;
}
