export type MeetingJoinLinkMeeting = {
  link?: string | null;
  location?: string | number | null;
  custom_link?: string | null;
};

export type MeetingJoinLinkLocation = {
  id?: string | number | null;
  name?: string | null;
  default_link?: string | null;
};

/** Outlook web calendar item URLs (not Teams join links). */
export function isOutlookCalendarItemLink(link: string | null | undefined): boolean {
  if (!link) return false;
  const lower = link.toLowerCase();
  return (
    lower.includes('outlook.office365.com/owa/') ||
    lower.includes('outlook.office.com/owa/') ||
    lower.includes('outlook.live.com/owa/') ||
    (lower.includes('outlook.office') && lower.includes('path=/calendar/item')) ||
    (lower.includes('outlook.office') && lower.includes('itemid='))
  );
}

/**
 * Microsoft can replace a stable joinWebUrl with a /dl/launcher URL after it is
 * opened. Recover the embedded /l/meetup-join URL so subsequent clicks do not
 * repeat the launcher/sign-in redirect. Query parameters such as anon=true are
 * preserved.
 */
export function normalizeTeamsJoinUrl(link: string | null | undefined): string {
  if (!link) return '';
  const value = link.trim();
  if (!value) return '';

  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase();
    const isTeamsMicrosoftHost =
      hostname === 'teams.microsoft.com' || hostname.endsWith('.teams.microsoft.com');

    if (isTeamsMicrosoftHost && parsed.pathname.toLowerCase() === '/dl/launcher/launcher.html') {
      const embedded = parsed.searchParams.get('url')?.trim();
      if (embedded) {
        const directPath = embedded.replace(/^\/_#\//, '/');
        if (/^\/(?:l\/meetup-join|meet)\//i.test(directPath)) {
          return `https://teams.microsoft.com${directPath}`;
        }
      }
    }

    if (isTeamsMicrosoftHost && /^\/_#\/(?:l\/meetup-join|meet)\//i.test(parsed.pathname)) {
      return `https://teams.microsoft.com${parsed.pathname.replace(/^\/_#\//, '/')}${parsed.search}`;
    }
  } catch {
    // Return the original value; the caller performs final URL validation.
  }

  return value;
}

export function isTeamsJoinUrl(link: string | null | undefined): boolean {
  if (!link || !/^https?:\/\//i.test(link)) return false;
  if (isOutlookCalendarItemLink(link)) return false;
  const linkLower = normalizeTeamsJoinUrl(link).toLowerCase();
  return (
    linkLower.includes('teams.microsoft.com') ||
    linkLower.includes('teams.live.com') ||
    linkLower.includes('microsoft.com/teams') ||
    linkLower.includes('teams.office.com')
  );
}

/** Pull a real Teams join URL from a Graph event / onlineMeeting payload. Never returns Outlook webLink. */
export function extractTeamsJoinUrlFromGraphPayload(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const obj = data as Record<string, unknown>;
  const onlineMeeting =
    obj.onlineMeeting && typeof obj.onlineMeeting === 'object'
      ? (obj.onlineMeeting as Record<string, unknown>)
      : null;

  const candidates = [
    onlineMeeting?.joinWebUrl,
    onlineMeeting?.joinUrl,
    obj.joinWebUrl,
    obj.joinUrl,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && isTeamsJoinUrl(candidate)) {
      return normalizeTeamsJoinUrl(candidate);
    }
  }
  return '';
}

export function getValidTeamsLink(link: string | null | undefined): string {
  if (!link || link.trim() === '') return '';
  const value = normalizeTeamsJoinUrl(link);
  try {
    if (/^https?:\/\//i.test(value)) {
      // Reject Outlook calendar item links that were incorrectly saved as "Teams" URLs
      if (isOutlookCalendarItemLink(value)) return '';
      return value;
    }
    const obj = JSON.parse(value);
    if (obj && typeof obj === 'object') {
      const fromPayload = extractTeamsJoinUrlFromGraphPayload(obj);
      if (fromPayload) return fromPayload;
      if (typeof obj.joinUrl === 'string' && !isOutlookCalendarItemLink(obj.joinUrl)) {
        return obj.joinUrl;
      }
      if (typeof obj.joinWebUrl === 'string' && !isOutlookCalendarItemLink(obj.joinWebUrl)) {
        return obj.joinWebUrl;
      }
    }
  } catch {
    if (/^https?:\/\//i.test(value) && !isOutlookCalendarItemLink(value)) {
      return value;
    }
  }
  return '';
}

export function getLinkType(link: string | null | undefined): 'teams' | 'zoom' | 'other' {
  if (!link) return 'other';
  if (isOutlookCalendarItemLink(link)) return 'other';
  const linkLower = normalizeTeamsJoinUrl(link).toLowerCase();

  if (
    linkLower.includes('teams.microsoft.com') ||
    linkLower.includes('teams.live.com') ||
    linkLower.includes('microsoft.com/teams') ||
    linkLower.includes('teams.office.com')
  ) {
    return 'teams';
  }

  if (
    linkLower.includes('zoom.us') ||
    linkLower.includes('zoom.com') ||
    (linkLower.includes('zoom.') && linkLower.includes('/j/'))
  ) {
    return 'zoom';
  }

  return 'other';
}

export function resolveMeetingJoinLink(
  meeting: MeetingJoinLinkMeeting,
  allMeetingLocations: MeetingJoinLinkLocation[],
): string {
  const fromStored = getValidTeamsLink(meeting.link);
  if (fromStored) return fromStored;

  const custom = meeting.custom_link?.trim();
  if (custom && /^https?:\/\//i.test(custom) && !isOutlookCalendarItemLink(custom)) return custom;

  const locRaw = meeting.location;
  if (locRaw === null || locRaw === undefined || locRaw === '') return '';
  const locString = String(locRaw).trim();

  const location =
    allMeetingLocations.find((loc) => String(loc.id) === locString) ||
    allMeetingLocations.find(
      (loc) => loc.name != null && String(loc.name).trim().toLowerCase() === locString.toLowerCase(),
    );

  const defaultLink = location?.default_link?.trim();
  if (defaultLink && /^https?:\/\//i.test(defaultLink) && !isOutlookCalendarItemLink(defaultLink)) {
    return defaultLink;
  }
  if (defaultLink && !isOutlookCalendarItemLink(defaultLink)) return defaultLink;
  return '';
}
