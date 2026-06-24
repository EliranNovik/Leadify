import { dateTimeToISO } from './icsGenerator';

export type MeetingCalendarDetails = {
  title: string;
  date: string;
  time: string;
  durationMinutes?: number;
  location?: string | null;
  joinUrl?: string | null;
  timeZone?: string;
};

function normalizeDate(date: string): string {
  return date.includes('T') ? date.split('T')[0] : date.split(' ')[0];
}

function normalizeTime(time: string): string {
  const match = time.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return '09:00';
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

function isoToGoogleLocal(iso: string): string {
  return iso.replace(/[-:]/g, '').slice(0, 15);
}

export function buildGoogleCalendarUrl(details: MeetingCalendarDetails): string | null {
  const date = normalizeDate(details.date);
  const time = normalizeTime(details.time);
  if (!date || !time) return null;

  const timeZone = details.timeZone || 'Asia/Jerusalem';
  const durationMinutes = details.durationMinutes ?? 60;
  const { start, end } = dateTimeToISO(date, time, durationMinutes, timeZone);

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: details.title,
    dates: `${isoToGoogleLocal(start)}/${isoToGoogleLocal(end)}`,
    ctz: timeZone,
  });

  const location = details.location?.trim();
  if (location) params.set('location', location);

  const descriptionParts: string[] = [];
  if (details.joinUrl?.trim()) {
    descriptionParts.push(`Join meeting: ${details.joinUrl.trim()}`);
  }
  if (descriptionParts.length > 0) {
    params.set('details', descriptionParts.join('\n'));
  }

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export async function shareMeetingLink(payload: {
  title: string;
  url: string;
  text?: string;
}): Promise<'shared' | 'copied' | 'cancelled' | 'failed'> {
  const shareText = payload.text?.trim() || payload.title;

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({
        title: payload.title,
        text: shareText,
        url: payload.url,
      });
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return 'cancelled';
      }
    }
  }

  const ok = await copyTextToClipboard(payload.url);
  return ok ? 'copied' : 'failed';
}

export function meetingShareText(
  title: string,
  date: string | null | undefined,
  time: string | null | undefined,
): string {
  const parts = [title];
  if (date) parts.push(normalizeDate(date));
  if (time) parts.push(normalizeTime(time));
  return parts.join(' · ');
}
