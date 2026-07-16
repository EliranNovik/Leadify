import { buildApiUrl, getFrontendBaseUrl } from './api';
import { buildBackendApiUrl } from './backendApiBase';

export const ENTRY_KIOSK_DEFAULT_LOCATION_ID = 1;

/**
 * Phone-facing QR links must always open the public production site —
 * never localhost — even if the kiosk tablet itself is running locally.
 */
export function toPublicClockInQrUrl(qrUrl: string): string {
  try {
    const parsed = new URL(qrUrl, 'https://rainmakerqueen.org');
    const token = (parsed.searchParams.get('token') || '').trim();
    const locationId = (parsed.searchParams.get('locationId') || String(ENTRY_KIOSK_DEFAULT_LOCATION_ID)).trim();
    if (!token) return `${getFrontendBaseUrl()}/clock-in/entry`;
    const params = new URLSearchParams({
      locationId,
      token,
    });
    return `${getFrontendBaseUrl()}/clock-in/entry?${params.toString()}`;
  } catch {
    return qrUrl;
  }
}

export type ClockInKioskCurrentResponse = {
  success: boolean;
  token?: string;
  locationId?: number;
  expiresAt?: string;
  rotateInMs?: number;
  qrUrl?: string;
  error?: string;
};

export type ClockInKioskValidateResponse = {
  success: boolean;
  valid?: boolean;
  locationId?: number;
  error?: string;
};

export type ClockInKioskFlashAction = 'in' | 'out';

export type ClockInKioskWelcomeMeeting = {
  id: number;
  time: string | null;
  title: string;
  location: string | null;
  isVirtual?: boolean;
  colorIndex?: number;
};

export type ClockInKioskRecentEvent = {
  id: string;
  locationId: number;
  employeeName: string;
  photoUrl?: string | null;
  employeeId?: number | null;
  action?: ClockInKioskFlashAction;
  meetings?: ClockInKioskWelcomeMeeting[];
  at: string;
};

export type ClockInKioskRecentEventResponse = {
  success: boolean;
  event?: ClockInKioskRecentEvent | null;
  error?: string;
};

export async function fetchClockInKioskCurrent(
  locationId: number = ENTRY_KIOSK_DEFAULT_LOCATION_ID,
): Promise<ClockInKioskCurrentResponse> {
  const url = buildApiUrl(`/api/clock-in-kiosk/current?locationId=${encodeURIComponent(String(locationId))}`);
  const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
  const body = (await res.json().catch(() => ({}))) as ClockInKioskCurrentResponse;
  if (!res.ok) {
    return {
      success: false,
      error: body.error || `Failed to load QR (${res.status})`,
    };
  }
  return body;
}

export async function validateClockInKioskToken(
  token: string,
  locationId: number,
): Promise<ClockInKioskValidateResponse> {
  const url = buildApiUrl('/api/clock-in-kiosk/validate');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ token, locationId }),
  });
  const body = (await res.json().catch(() => ({}))) as ClockInKioskValidateResponse;
  if (!res.ok) {
    return {
      success: false,
      valid: false,
      error: body.error || `QR validation failed (${res.status})`,
    };
  }
  return body;
}

export async function announceClockInKioskSuccess(
  locationId: number,
  employeeName: string,
  photoUrl?: string | null,
  employeeId?: number | null,
  action: ClockInKioskFlashAction = 'in',
): Promise<{ success: boolean; error?: string }> {
  const payload = JSON.stringify({
    locationId,
    employeeName,
    photoUrl: photoUrl || null,
    employeeId: employeeId ?? null,
    action,
  });
  const urls = [buildApiUrl('/api/clock-in-kiosk/announce')];

  // Prefer localhost only in DEV — do not fan-out to production unless explicitly needed.
  // (Prod announce remains available for dual-host phone/tablet setups via Vite proxy target.)

  let anyOk = false;
  let lastError: string | undefined;

  await Promise.all(
    urls.map(async (url) => {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: payload,
        });
        const body = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
        if (!res.ok) {
          lastError = body.error || `Announce failed (${res.status})`;
          return;
        }
        anyOk = true;
      } catch (err) {
        lastError = err instanceof Error ? err.message : 'Announce failed';
      }
    }),
  );

  if (!anyOk) {
    return { success: false, error: lastError || 'Announce failed' };
  }
  return { success: true };
}

export async function fetchClockInKioskRecentEvent(
  locationId: number = ENTRY_KIOSK_DEFAULT_LOCATION_ID,
): Promise<ClockInKioskRecentEventResponse> {
  const query = `locationId=${encodeURIComponent(String(locationId))}`;
  const urls = [buildApiUrl(`/api/clock-in-kiosk/recent-event?${query}`)];

  // Local tablet often polls localhost while the phone (scanning a prod QR)
  // announces on the production backend. Always also check production in DEV.
  if (import.meta.env.DEV) {
    urls.push(`https://leadify-crm-backend.onrender.com/api/clock-in-kiosk/recent-event?${query}`);
  }

  let latest: ClockInKioskRecentEvent | null = null;
  let anyOk = false;
  let lastError: string | undefined;

  await Promise.all(
    urls.map(async (url) => {
      try {
        const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
        const body = (await res.json().catch(() => ({}))) as ClockInKioskRecentEventResponse;
        if (!res.ok) {
          lastError = body.error || `Failed to load recent event (${res.status})`;
          return;
        }
        anyOk = true;
        const event = body.event ?? null;
        if (!event?.id) return;
        if (!latest || String(event.at) > String(latest.at)) {
          latest = event;
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : 'Recent event fetch failed';
      }
    }),
  );

  if (!anyOk) {
    return { success: false, error: lastError || 'Failed to load recent event' };
  }
  return { success: true, event: latest };
}

export function buildClockInEntryPath(locationId: number, token: string): string {
  const params = new URLSearchParams({
    locationId: String(locationId),
    token,
  });
  return `/clock-in/entry?${params.toString()}`;
}

export type EntryKioskDisplaySettings = {
  officeLabel: string;
  showClockDate: boolean;
  showWeather: boolean;
  showMeetingsToday: boolean;
  showBirthdays: boolean;
  showAnnouncements: boolean;
  showGadgets: boolean;
  weatherCity: string;
};

export type EntryKioskDisplayAnnouncement = {
  id: number;
  title: string | null;
  body: string;
  sortOrder: number;
};

export type EntryKioskDisplayGadget = {
  id: number;
  label: string;
  body: string | null;
  iconKey: string | null;
  sortOrder: number;
};

export type EntryKioskDisplayBirthday = {
  id: number;
  name: string;
  photoUrl: string | null;
};

export type EntryKioskDisplayMeeting = {
  id: number;
  time: string | null;
  clientName: string | null;
  leadNumber: string | null;
  title?: string;
  typeCode?: 'im' | 'active' | 'potential' | 'other';
  isCurrent?: boolean;
  isPast?: boolean;
};

export type EntryKioskMeetingParticipant = {
  name: string;
  photoUrl: string | null;
  employeeId?: number | null;
};

export type EntryKioskMeetingDetail = EntryKioskDisplayMeeting & {
  type: string;
  typeCode: 'im' | 'active' | 'potential' | 'other';
  title: string;
  participants: EntryKioskMeetingParticipant[];
  location: string | null;
  isVirtual?: boolean;
};

export type EntryKioskMeetingsTodayResponse = {
  success: boolean;
  locationId?: number;
  date?: string;
  meetings?: EntryKioskMeetingDetail[];
  error?: string;
};

export type EntryKioskDisplayWeather = {
  city: string;
  temperatureC: number | null;
  weatherCode: number | null;
  label: string;
  fetchedAt: string;
};

export type EntryKioskDisplayResponse = {
  success: boolean;
  locationId?: number;
  settings?: EntryKioskDisplaySettings;
  announcements?: EntryKioskDisplayAnnouncement[];
  gadgets?: EntryKioskDisplayGadget[];
  birthdays?: EntryKioskDisplayBirthday[];
  meetings?: EntryKioskDisplayMeeting[];
  weather?: EntryKioskDisplayWeather | null;
  inOfficeCount?: number;
  error?: string;
};

export async function fetchEntryKioskDisplay(
  locationId: number = ENTRY_KIOSK_DEFAULT_LOCATION_ID,
): Promise<EntryKioskDisplayResponse> {
  const query = `locationId=${encodeURIComponent(String(locationId))}`;
  const url = buildBackendApiUrl(`/api/clock-in-kiosk/display?${query}`);

  try {
    const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
    const body = (await res.json().catch(() => ({}))) as EntryKioskDisplayResponse;
    if (!res.ok || !body.success) {
      return {
        success: false,
        error: body.error || `Failed to load kiosk display (${res.status})`,
      };
    }
    return body;
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Kiosk display fetch failed',
    };
  }
}

export async function fetchEntryKioskMeetingsToday(
  locationId: number = ENTRY_KIOSK_DEFAULT_LOCATION_ID,
): Promise<EntryKioskMeetingsTodayResponse> {
  const query = `locationId=${encodeURIComponent(String(locationId))}`;
  const url = buildBackendApiUrl(`/api/clock-in-kiosk/meetings-today?${query}`);

  try {
    const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
    const body = (await res.json().catch(() => ({}))) as EntryKioskMeetingsTodayResponse;
    if (!res.ok || !body.success) {
      return {
        success: false,
        error: body.error || `Failed to load meetings today (${res.status})`,
      };
    }
    return body;
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Meetings today fetch failed',
    };
  }
}
