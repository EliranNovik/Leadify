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

export function getValidTeamsLink(link: string | null | undefined): string {
  if (!link || link.trim() === '') return '';
  try {
    if (link.startsWith('http')) {
      return link;
    }
    const obj = JSON.parse(link);
    if (obj && typeof obj === 'object' && obj.joinUrl && typeof obj.joinUrl === 'string') {
      return obj.joinUrl;
    }
    if (obj && typeof obj === 'object' && obj.joinWebUrl && typeof obj.joinWebUrl === 'string') {
      return obj.joinWebUrl;
    }
  } catch {
    if (typeof link === 'string' && link.startsWith('http')) return link;
  }
  return '';
}

export function getLinkType(link: string | null | undefined): 'teams' | 'zoom' | 'other' {
  if (!link) return 'other';
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
  if (custom && /^https?:\/\//i.test(custom)) return custom;

  const locRaw = meeting.location;
  if (locRaw === null || locRaw === undefined || locRaw === '') return '';
  const locString = String(locRaw).trim();

  const location =
    allMeetingLocations.find((loc) => String(loc.id) === locString) ||
    allMeetingLocations.find(
      (loc) => loc.name != null && String(loc.name).trim().toLowerCase() === locString.toLowerCase(),
    );

  const defaultLink = location?.default_link?.trim();
  if (defaultLink && /^https?:\/\//i.test(defaultLink)) return defaultLink;
  if (defaultLink) return defaultLink;
  return '';
}
