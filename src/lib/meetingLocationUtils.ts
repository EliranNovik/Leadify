/** sessionStorage keys — open drawer after lazy MeetingTab mounts */
export const MEETING_TAB_PENDING_SCHEDULE_KEY = 'meeting-tab:pending-schedule-drawer';
export const MEETING_TAB_PENDING_RESCHEDULE_KEY = 'meeting-tab:pending-reschedule-drawer';

export const CUSTOM_LINK_LOCATION_ID = 31;
export const CUSTOM_ADDRESS_LOCATION_ID = 32;

type MeetingLocationPhysicalFlag = {
  id?: unknown;
  is_physical_location?: unknown;
  is_phisical_location?: unknown;
};

/** Row fields from tenants_meetinglocation used in template address resolution. */
export type MeetingLocationAddressFields = MeetingLocationPhysicalFlag & {
  address?: string | null;
  address_en?: string | null;
  name?: string | null;
};

/** True when template content is English (en, en_US, english, etc.). */
export function preferEnglishMeetingTemplateLanguage(lang: string | null | undefined): boolean {
  if (lang == null || String(lang).trim() === '') return false;
  const norm = String(lang).trim().toLowerCase().split(/[-_]/)[0];
  return norm === 'en' || norm === 'english';
}

/**
 * Physical/catalog address for templates: address_en when English template and address_en is set; else address.
 */
export function pickTenantMeetingLocationAddress(
  row: MeetingLocationAddressFields,
  preferEnglish: boolean,
): string {
  const addressHe = row.address != null ? String(row.address).trim() : '';
  const addressEn = row.address_en != null ? String(row.address_en).trim() : '';
  if (preferEnglish && addressEn) return addressEn;
  return addressHe;
}

/** Resolved meeting_location text from catalog row (physical → address, virtual → name). */
export function resolveCatalogMeetingLocationText(
  locRow: MeetingLocationAddressFields,
  rawLocFallback: string,
  preferEnglish: boolean,
): string {
  const name = locRow.name != null ? String(locRow.name).trim() : '';
  const addr = pickTenantMeetingLocationAddress(locRow, preferEnglish);
  if (isPhysicalMeetingLocation(locRow)) {
    if (addr) return addr;
    return name || rawLocFallback || '-';
  }
  return name || rawLocFallback;
}

/** Physical offices / custom address — no Teams or Zoom link in calendar invites. */
export function isPhysicalMeetingLocation(
  loc: MeetingLocationPhysicalFlag | null | undefined
): boolean {
  if (!loc) return false;
  const id = Number(loc.id);
  if (Number.isFinite(id) && id === CUSTOM_ADDRESS_LOCATION_ID) return true;
  if (Number.isFinite(id) && id === CUSTOM_LINK_LOCATION_ID) return false;

  const flag = loc.is_physical_location ?? loc.is_phisical_location;
  if (flag === true || flag === 1) return true;
  if (flag === false || flag === 0) return false;
  return false;
}

/** Client-booking location labels → office address when catalog has no match. */
export const CLIENT_BOOKING_LOCATION_ADDRESSES: Readonly<Record<string, string>> = {
  'ramat gan office': 'Menachem Begin Rd. 11, Ramat Gan, Israel',
};

export function isTeamsMeetingLocationName(location?: string | null): boolean {
  return (location?.trim().toLowerCase() ?? '') === 'teams';
}

export function resolveKnownClientBookingAddress(location?: string | null): string | null {
  const label = location?.trim();
  if (!label || isTeamsMeetingLocationName(label)) return null;

  const key = label.toLowerCase();
  const exact = CLIENT_BOOKING_LOCATION_ADDRESSES[key];
  if (exact) return exact;

  if (key.includes('ramat gan')) {
    return CLIENT_BOOKING_LOCATION_ADDRESSES['ramat gan office'] ?? null;
  }

  return null;
}

/** Portal / public booking cards — physical flag + address with catalog and known-location fallbacks. */
export function resolvePortalMeetingLocationDisplay(
  location?: string | null,
  options?: {
    isPhysicalMeeting?: boolean;
    meetingAddress?: string | null;
    manualAddress?: string | null;
  },
): { location: string; isPhysicalMeeting: boolean; meetingAddress: string | null } {
  const label = location?.trim() ?? '';
  if (!label) {
    return { location: '', isPhysicalMeeting: false, meetingAddress: null };
  }

  const isTeams = isTeamsMeetingLocationName(label);
  const manual = options?.manualAddress?.trim();
  const apiAddress = options?.meetingAddress?.trim();
  const meetingAddress = apiAddress || manual || resolveKnownClientBookingAddress(label);

  let isPhysicalMeeting = options?.isPhysicalMeeting === true;
  if (!isTeams && (isPhysicalMeeting || meetingAddress)) {
    isPhysicalMeeting = true;
  }

  if (isTeams) {
    return { location: label, isPhysicalMeeting: false, meetingAddress: null };
  }

  return { location: label, isPhysicalMeeting, meetingAddress: meetingAddress || null };
}

/** Whether calendar/email should include an online join link for this location. */
export function shouldIncludeMeetingJoinLink(
  loc: MeetingLocationPhysicalFlag | null | undefined,
  locationName?: string | null
): boolean {
  if (isPhysicalMeetingLocation(loc)) return false;
  if (loc) return true;
  return locationName?.trim().toLowerCase() === 'teams';
}

/** DB may return boolean, or strings like TRUE/FALSE/t/f (any case). */
export function normalizeMeetingLocationIsActive(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const s = String(value).trim().toLowerCase();
  if (s === 'false' || s === 'f' || s === '0' || s === 'no') return false;
  if (s === 'true' || s === 't' || s === '1' || s === 'yes') return true;
  return true;
}

export function isMeetingLocationActive(loc: { is_active?: unknown }): boolean {
  return normalizeMeetingLocationIsActive(loc.is_active);
}

export function normalizeMeetingLocationRow<T extends Record<string, unknown>>(loc: T): T & { is_active: boolean } {
  return {
    ...loc,
    is_active: normalizeMeetingLocationIsActive(loc.is_active),
  };
}

export function markPendingMeetingScheduleDrawer(): void {
  try {
    sessionStorage.setItem(MEETING_TAB_PENDING_SCHEDULE_KEY, '1');
  } catch {
    /* ignore */
  }
}

export function markPendingMeetingRescheduleDrawer(): void {
  try {
    sessionStorage.setItem(MEETING_TAB_PENDING_RESCHEDULE_KEY, '1');
  } catch {
    /* ignore */
  }
}

export function consumePendingMeetingDrawers(): { schedule: boolean; reschedule: boolean } {
  let schedule = false;
  let reschedule = false;
  try {
    if (sessionStorage.getItem(MEETING_TAB_PENDING_SCHEDULE_KEY) === '1') {
      sessionStorage.removeItem(MEETING_TAB_PENDING_SCHEDULE_KEY);
      schedule = true;
    }
    if (sessionStorage.getItem(MEETING_TAB_PENDING_RESCHEDULE_KEY) === '1') {
      sessionStorage.removeItem(MEETING_TAB_PENDING_RESCHEDULE_KEY);
      reschedule = true;
    }
  } catch {
    /* ignore */
  }
  return { schedule, reschedule };
}

export function clearPendingMeetingScheduleDrawer(): void {
  try {
    sessionStorage.removeItem(MEETING_TAB_PENDING_SCHEDULE_KEY);
  } catch {
    /* ignore */
  }
}

export function clearPendingMeetingRescheduleDrawer(): void {
  try {
    sessionStorage.removeItem(MEETING_TAB_PENDING_RESCHEDULE_KEY);
  } catch {
    /* ignore */
  }
}
