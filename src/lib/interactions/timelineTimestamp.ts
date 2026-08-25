const UNKNOWN = /^(unknown|--|—|-)$/i;

function normalizeTimePart(timeStr: string): { hours: number; minutes: number; seconds: number } | null {
  const cleaned = timeStr.replace('.', ':').trim();
  const match = cleaned.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] || 0);
  if (!Number.isFinite(hours) || hours > 23 || !Number.isFinite(minutes) || minutes > 59) return null;
  if (!Number.isFinite(seconds) || seconds > 59) return null;
  return { hours, minutes, seconds };
}

/**
 * Parse a timeline date + time as a local wall-clock instant.
 * Handles DD/MM/YYYY, DD.MM.YY, YYYY-MM-DD and HH:MM[:SS].
 */
export function parseLocalDateAndTime(
  dateStr?: string | null,
  timeStr?: string | null,
): number | null {
  if (!dateStr || !timeStr) return null;
  const d = String(dateStr).trim();
  const t = String(timeStr).trim();
  if (!d || !t || UNKNOWN.test(d) || UNKNOWN.test(t)) return null;

  const timePart = normalizeTimePart(t);
  if (!timePart) return null;

  let year: number;
  let month: number;
  let day: number;

  if (/^\d{4}-\d{2}-\d{2}/.test(d)) {
    year = Number(d.slice(0, 4));
    month = Number(d.slice(5, 7));
    day = Number(d.slice(8, 10));
  } else if (d.includes('/') || d.includes('.')) {
    const sep = d.includes('/') ? '/' : '.';
    const parts = d.split(sep);
    if (parts.length !== 3) return null;
    day = Number(parts[0]);
    month = Number(parts[1]);
    const yearRaw = parts[2];
    year = yearRaw.length === 2 ? 2000 + Number(yearRaw) : Number(yearRaw);
  } else {
    return null;
  }

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const ms = new Date(year, month - 1, day, timePart.hours, timePart.minutes, timePart.seconds, 0).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function isManualOrLegacyRow(row: {
  kind?: string;
  id?: unknown;
  editable?: boolean;
}): boolean {
  const id = String(row.id ?? '');
  const kind = String(row.kind || '');
  return (
    id.startsWith('manual_') ||
    id.startsWith('legacy_') ||
    row.editable === true ||
    kind === 'email_manual' ||
    kind === 'whatsapp_manual'
  );
}

/**
 * Single clock for timeline sort and display.
 *
 * Synced emails/WhatsApp keep the ISO `raw_date` from the provider.
 * Calls, manuals, and legacy rows use the visible date+time fields so order
 * matches what is shown (call `cdate` is often date-only / midnight).
 */
export function interactionTimestampMs(row: {
  kind?: string;
  id?: unknown;
  editable?: boolean;
  date?: string | null;
  time?: string | null;
  raw_date?: string | null;
}): number {
  const kind = String(row.kind || '');
  const syncedIso = !isManualOrLegacyRow(row) && (kind === 'email' || kind === 'whatsapp');

  if (!syncedIso) {
    const fromFields = parseLocalDateAndTime(row.date, row.time);
    if (fromFields != null) return fromFields;
  }

  if (row.raw_date) {
    const fromRaw = Date.parse(row.raw_date);
    if (Number.isFinite(fromRaw)) return fromRaw;
  }

  return parseLocalDateAndTime(row.date, row.time) ?? 0;
}

export function interactionTimestampIso(row: {
  kind?: string;
  id?: unknown;
  editable?: boolean;
  date?: string | null;
  time?: string | null;
  raw_date?: string | null;
}): string {
  const ms = interactionTimestampMs(row);
  if (!ms) return row.raw_date || new Date().toISOString();
  return new Date(ms).toISOString();
}
