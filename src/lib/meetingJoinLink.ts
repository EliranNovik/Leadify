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

export function isTeamsJoinUrl(link: string | null | undefined): boolean {
  if (!link || !/^https?:\/\//i.test(link)) return false;
  if (isOutlookCalendarItemLink(link)) return false;
  const linkLower = link.toLowerCase();
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
    onlineMeeting?.joinUrl,
    onlineMeeting?.joinWebUrl,
    obj.joinUrl,
    obj.joinWebUrl,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && isTeamsJoinUrl(candidate)) {
      return candidate;
    }
  }
  return '';
}

export function getValidTeamsLink(link: string | null | undefined): string {
  if (!link || link.trim() === '') return '';
  try {
    if (link.startsWith('http')) {
      // Reject Outlook calendar item links that were incorrectly saved as "Teams" URLs
      if (isOutlookCalendarItemLink(link)) return '';
      return link;
    }
    const obj = JSON.parse(link);
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
    if (typeof link === 'string' && link.startsWith('http') && !isOutlookCalendarItemLink(link)) {
      return link;
    }
  }
  return '';
}

export function getLinkType(link: string | null | undefined): 'teams' | 'zoom' | 'other' {
  if (!link) return 'other';
  if (isOutlookCalendarItemLink(link)) return 'other';
  const linkLower = link.toLowerCase();

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
