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
