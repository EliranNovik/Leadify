import { DateTime } from 'luxon';

export const BUSINESS_TZ = 'Asia/Jerusalem';
export const LOCAL_STORAGE_KEY = 'rmq_booking_client_tz';

export type JerusalemWallTime = { date: string; time: string };
export type ClientLocalWallTime = { date: string; time: string };

function normalizeTime(time: string): string {
  const parts = String(time || '').trim().split(':');
  const h = Number(parts[0]);
  const m = Number(parts[1] ?? 0);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return '';
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function normalizeDate(date: string): string {
  const trimmed = String(date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return '';
  return trimmed;
}

export function isValidIanaTimezone(tz: string | null | undefined): boolean {
  if (!tz || !String(tz).trim()) return false;
  try {
    return DateTime.now().setZone(tz).isValid;
  } catch {
    return false;
  }
}

export function detectClientTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (isValidIanaTimezone(tz)) return tz;
  } catch {
    /* ignore */
  }
  return 'UTC';
}

export function getStoredClientTimezone(): string {
  if (typeof window === 'undefined') return BUSINESS_TZ;
  try {
    const stored = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (isValidIanaTimezone(stored)) return stored!;
  } catch {
    /* ignore */
  }
  return detectClientTimezone();
}

export function persistClientTimezone(tz: string): string {
  const resolved = isValidIanaTimezone(tz) ? tz : detectClientTimezone();
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(LOCAL_STORAGE_KEY, resolved);
    } catch {
      /* ignore */
    }
  }
  return resolved;
}

export function jerusalemDateTimeFromWall(date: string, time: string): DateTime | null {
  const d = normalizeDate(date);
  const t = normalizeTime(time);
  if (!d || !t) return null;
  const dt = DateTime.fromISO(`${d}T${t}:00`, { zone: BUSINESS_TZ });
  return dt.isValid ? dt : null;
}

export function clientLocalToJerusalem(
  date: string,
  time: string,
  clientTz: string,
): JerusalemWallTime | null {
  const d = normalizeDate(date);
  const t = normalizeTime(time);
  if (!d || !t) return null;

  if (!clientTz || clientTz === BUSINESS_TZ) {
    return { date: d, time: t };
  }

  const clientDt = DateTime.fromISO(`${d}T${t}:00`, { zone: clientTz });
  if (!clientDt.isValid) return null;

  const jerusalem = clientDt.setZone(BUSINESS_TZ);
  return {
    date: jerusalem.toFormat('yyyy-MM-dd'),
    time: jerusalem.toFormat('HH:mm'),
  };
}

export function jerusalemToClientLocal(
  date: string,
  time: string,
  clientTz: string,
): ClientLocalWallTime | null {
  const jerusalemDt = jerusalemDateTimeFromWall(date, time);
  if (!jerusalemDt) return null;

  if (!clientTz || clientTz === BUSINESS_TZ) {
    return {
      date: jerusalemDt.toFormat('yyyy-MM-dd'),
      time: jerusalemDt.toFormat('HH:mm'),
    };
  }

  const client = jerusalemDt.setZone(clientTz);
  return {
    date: client.toFormat('yyyy-MM-dd'),
    time: client.toFormat('HH:mm'),
  };
}

const TIMEZONE_PLACE_OVERRIDES: Record<string, string> = {
  [BUSINESS_TZ]: 'Israel',
};

export function formatTimezonePlaceName(tz: string): string {
  if (!isValidIanaTimezone(tz)) return tz;
  if (TIMEZONE_PLACE_OVERRIDES[tz]) return TIMEZONE_PLACE_OVERRIDES[tz];
  const segment = tz.split('/').pop() || tz;
  return segment.replace(/_/g, ' ');
}

export function formatTimezoneAbbreviation(tz: string, referenceDate?: string): string {
  if (!isValidIanaTimezone(tz)) return '';
  const ref = referenceDate
    ? DateTime.fromISO(`${normalizeDate(referenceDate)}T12:00:00`, { zone: tz })
    : DateTime.now().setZone(tz);
  if (!ref.isValid) return tz;
  return ref.offsetNameShort || ref.toFormat('ZZ');
}

export function formatTimezoneBadge(tz: string, referenceDate?: string): string {
  const place = formatTimezonePlaceName(tz);
  const abbr = formatTimezoneAbbreviation(tz, referenceDate);
  if (!abbr) return place;
  return `${place} (${abbr})`;
}

export function formatTimezoneLabel(tz: string, referenceDate?: string): string {
  if (!isValidIanaTimezone(tz)) return tz;
  const place = formatTimezonePlaceName(tz);
  if (tz === BUSINESS_TZ) return `${place} · Israel Time`;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'long',
    }).formatToParts(new Date());
    const name = parts.find((p) => p.type === 'timeZoneName')?.value;
    return name ? `${place} · ${name}` : formatTimezoneBadge(tz, referenceDate);
  } catch {
    return formatTimezoneBadge(tz, referenceDate);
  }
}

export function formatBookingTime12h(time: string): string {
  const t = normalizeTime(time);
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'pm' : 'am';
  const hour12 = h % 12 || 12;
  return m ? `${hour12}:${String(m).padStart(2, '0')}${period}` : `${hour12}${period}`;
}

export function formatBookingTimeWithZone(
  time: string,
  clientTz: string,
  referenceDate?: string,
): string {
  const formatted = formatBookingTime12h(time);
  if (!formatted) return '';
  const badge = formatTimezoneBadge(clientTz, referenceDate);
  return badge ? `${formatted} ${badge}` : formatted;
}

export function formatJerusalemTimeWithZone(date: string, time: string): string {
  return formatBookingTimeWithZone(time, BUSINESS_TZ, date);
}

export function formatMeetingForClientDisplay(
  jerusalemDate: string,
  jerusalemTime: string,
  clientTz: string,
): {
  clientDate: string;
  clientTime: string;
  clientTimeWithZone: string;
  israelTimeWithZone: string;
} | null {
  const local = jerusalemToClientLocal(jerusalemDate, jerusalemTime, clientTz);
  if (!local) return null;
  return {
    clientDate: local.date,
    clientTime: local.time,
    clientTimeWithZone: formatBookingTimeWithZone(local.time, clientTz, local.date),
    israelTimeWithZone: formatJerusalemTimeWithZone(jerusalemDate, jerusalemTime),
  };
}

export function resolveCategoryAvailabilityForLead(
  settings: {
    business_hours_start: string;
    business_hours_end: string;
    days_of_week: number[];
    category_availability_rules?: Array<{
      main_category_ids: number[];
      business_hours_start: string;
      business_hours_end: string;
      days_of_week: number[];
      max_meetings_per_hour?: number | null;
    }>;
  },
  mainCategoryId?: number | null,
): {
  business_hours_start: string;
  business_hours_end: string;
  days_of_week: number[];
} {
  const rules = settings.category_availability_rules || [];
  if (mainCategoryId != null && Number.isFinite(mainCategoryId)) {
    for (const rule of rules) {
      const ids = (rule.main_category_ids || []).map(Number).filter(Number.isFinite);
      if (!ids.includes(mainCategoryId)) continue;
      return {
        business_hours_start: rule.business_hours_start || settings.business_hours_start,
        business_hours_end: rule.business_hours_end || settings.business_hours_end,
        days_of_week: rule.days_of_week?.length ? rule.days_of_week : settings.days_of_week,
      };
    }
  }
  return {
    business_hours_start: settings.business_hours_start,
    business_hours_end: settings.business_hours_end,
    days_of_week: settings.days_of_week,
  };
}

/** True when a client-local calendar day maps to a Jerusalem closed date. */
export function isClientBookingDateBlocked(
  clientDate: string,
  unavailableJerusalemDates: string[],
  clientTz: string,
): boolean {
  if (!unavailableJerusalemDates.length) return false;
  const blocked = new Set(unavailableJerusalemDates);
  const noon = clientLocalToJerusalem(clientDate, '12:00', clientTz);
  if (noon && blocked.has(noon.date)) return true;
  const morning = clientLocalToJerusalem(clientDate, '08:00', clientTz);
  if (morning && blocked.has(morning.date)) return true;
  const evening = clientLocalToJerusalem(clientDate, '20:00', clientTz);
  if (evening && blocked.has(evening.date)) return true;
  return blocked.has(clientDate);
}
