const supabase = require('../config/supabase');

const DEFAULT_LOCATION_ID = 1;

function normalizeLocationId(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LOCATION_ID;
  return Math.trunc(n);
}

function todayIsoLocal() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function isWithinDateRange(startDate, endDate, today) {
  if (startDate && String(startDate) > today) return false;
  if (endDate && String(endDate) < today) return false;
  return true;
}

const DEFAULT_SETTINGS = {
  location_id: DEFAULT_LOCATION_ID,
  office_label: 'RAMAT GAN',
  show_clock_date: true,
  show_weather: false,
  show_meetings_today: true,
  show_birthdays: true,
  show_announcements: true,
  show_gadgets: true,
  weather_city: 'Tel Aviv',
};

async function loadSettings(locationId) {
  const { data, error } = await supabase
    .from('entry_kiosk_settings')
    .select(
      'location_id, office_label, show_clock_date, show_weather, show_meetings_today, show_birthdays, show_announcements, show_gadgets, weather_city',
    )
    .eq('location_id', locationId)
    .maybeSingle();

  if (error) throw error;
  return { ...DEFAULT_SETTINGS, ...(data || {}) };
}

async function loadAnnouncements(locationId, today) {
  const { data, error } = await supabase
    .from('entry_kiosk_announcements')
    .select('id, title, body, sort_order, start_date, end_date')
    .eq('location_id', locationId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data || [])
    .filter((row) => isWithinDateRange(row.start_date, row.end_date, today))
    .map((row) => ({
      id: row.id,
      title: row.title || null,
      body: row.body,
      sortOrder: row.sort_order ?? 0,
    }));
}

async function loadGadgets(locationId) {
  const { data, error } = await supabase
    .from('entry_kiosk_gadgets')
    .select('id, label, body, icon_key, sort_order')
    .eq('location_id', locationId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) throw error;

  return (data || []).map((row) => ({
    id: row.id,
    label: row.label,
    body: row.body || null,
    iconKey: row.icon_key || null,
    sortOrder: row.sort_order ?? 0,
  }));
}

async function loadBirthdaysToday(today) {
  const [, month, day] = today.split('-');
  const md = `${month}-${day}`;

  const { data, error } = await supabase
    .from('tenants_employee')
    .select('id, display_name, official_name, photo_url, photo, date_of_birth')
    .not('date_of_birth', 'is', null);

  if (error) throw error;

  return (data || [])
    .filter((row) => {
      if (!row.date_of_birth) return false;
      const dob = String(row.date_of_birth).slice(5, 10);
      return dob === md;
    })
    .map((row) => ({
      id: row.id,
      name: (row.official_name || row.display_name || 'Employee').trim(),
      photoUrl: row.photo_url || row.photo || null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function parseMeetingTimeMinutes(raw) {
  if (!raw) return null;
  const parts = String(raw).split(':');
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function nowMinutesJerusalem() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());

  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return 0;
  return hour * 60 + minute;
}

const CURRENT_MEETING_WINDOW_MINUTES = 30;

function isMeetingCurrentByStart(startMinutes, nowMinutes) {
  return (
    startMinutes <= nowMinutes &&
    startMinutes >= nowMinutes - CURRENT_MEETING_WINDOW_MINUTES
  );
}

function isMeetingUpcomingByStart(startMinutes, nowMinutes) {
  return (
    startMinutes > nowMinutes &&
    startMinutes <= nowMinutes + CURRENT_MEETING_WINDOW_MINUTES
  );
}

function isMeetingPastByStart(startMinutes, nowMinutes) {
  return startMinutes < nowMinutes - CURRENT_MEETING_WINDOW_MINUTES;
}

/**
 * Up to 5 meetings around now: 2 before, current (if any), 2 after.
 * Includes recently ended meetings; if the day is over, shows the last few of the day.
 */
function selectMeetingsWindow(rows, maxCount = 5) {
  const nowMinutes = nowMinutesJerusalem();
  const meetings = (rows || [])
    .map((row) => {
      const startMinutes = parseMeetingTimeMinutes(row.meeting_time);
      if (startMinutes == null) return null;
      const durationMinutes = meetingDurationMinutes(row);
      return {
        row,
        startMinutes,
        endMinutes: startMinutes + durationMinutes,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.startMinutes - b.startMinutes);

  if (meetings.length === 0) return [];

  let anchorIndex = meetings.findIndex((m) => isMeetingCurrentByStart(m.startMinutes, nowMinutes));
  if (anchorIndex < 0) {
    anchorIndex = meetings.findIndex((m) => isMeetingUpcomingByStart(m.startMinutes, nowMinutes));
  }
  if (anchorIndex < 0) {
    anchorIndex = meetings.findIndex((m) => m.startMinutes > nowMinutes);
  }
  if (anchorIndex < 0) {
    anchorIndex = meetings.length - 1;
  }

  const before = 2;
  const after = 2;
  let start = Math.max(0, anchorIndex - before);
  let end = Math.min(meetings.length, anchorIndex + after + 1);

  // Pad window up to maxCount when near start/end of day
  while (end - start < Math.min(maxCount, meetings.length)) {
    let grew = false;
    if (start > 0) {
      start -= 1;
      grew = true;
    }
    if (end < meetings.length && end - start < Math.min(maxCount, meetings.length)) {
      end += 1;
      grew = true;
    }
    if (!grew) break;
  }

  return meetings.slice(start, end).map((m) => ({
    row: m.row,
    isCurrent: isMeetingCurrentByStart(m.startMinutes, nowMinutes),
    isPast: isMeetingPastByStart(m.startMinutes, nowMinutes),
  }));
}

/** Single meeting for kiosk main screen: in ±30 min window now, else next upcoming today. */
function selectNextMeeting(rows) {
  const nowMinutes = nowMinutesJerusalem();
  const meetings = (rows || [])
    .map((row) => {
      const startMinutes = parseMeetingTimeMinutes(row.meeting_time);
      if (startMinutes == null) return null;
      const durationMinutes = meetingDurationMinutes(row);
      return {
        row,
        startMinutes,
        endMinutes: startMinutes + durationMinutes,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.startMinutes - b.startMinutes);

  if (meetings.length === 0) return [];

  const current = meetings.find((m) => isMeetingCurrentByStart(m.startMinutes, nowMinutes));
  if (current) {
    return [{ row: current.row, isCurrent: true, isPast: false }];
  }

  const soon = meetings.find((m) => isMeetingUpcomingByStart(m.startMinutes, nowMinutes));
  if (soon) {
    return [{ row: soon.row, isCurrent: false, isPast: false }];
  }

  const upcoming = meetings.find((m) => m.startMinutes > nowMinutes);
  if (upcoming) {
    return [{ row: upcoming.row, isCurrent: false, isPast: false }];
  }

  const last = meetings[meetings.length - 1];
  return [{ row: last.row, isCurrent: false, isPast: true }];
}

function meetingTypeLabel(calendarType, internalTypeLabel) {
  const ct = String(calendarType || '').trim();
  if (ct === 'staff') {
    return internalTypeLabel ? `IM · ${internalTypeLabel}` : 'IM';
  }
  if (ct === 'active_client') return 'Active';
  if (ct === 'potential_client') return 'Potential';
  if (ct) return ct.replace(/_/g, ' ');
  return 'Meeting';
}

function meetingTypeCode(calendarType) {
  const ct = String(calendarType || '').trim();
  if (ct === 'staff') return 'im';
  if (ct === 'active_client') return 'active';
  if (ct === 'potential_client') return 'potential';
  return 'other';
}

function resolveLocationName(raw, locationById) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const asNum = Number(text);
  if (Number.isFinite(asNum) && asNum > 0 && locationById.has(asNum)) {
    return locationById.get(asNum);
  }
  return text;
}

function uniqueStrings(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const v = String(value || '').trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

function isEmptyRoleValue(raw) {
  const text = String(raw ?? '').trim();
  return !text || text === '---' || text === '--' || text === 'N/A' || text === 'Not assigned';
}

function isNumericEmployeeId(raw) {
  if (raw == null || raw === '') return false;
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0;
  const text = String(raw).trim();
  return text !== '' && !Number.isNaN(Number(text)) && Number(text) > 0;
}

function collectRoleDisplayName(raw) {
  if (isEmptyRoleValue(raw) || isNumericEmployeeId(raw)) return null;
  return String(raw).trim();
}

function resolveEmployeeParticipant(raw, employeeLookup) {
  if (isEmptyRoleValue(raw)) return null;

  const byId = employeeLookup?.byId || employeeLookup;
  const byNameLower = employeeLookup?.byNameLower;

  const asNum = Number(raw);
  if (Number.isFinite(asNum) && asNum > 0) {
    if (byId?.has(asNum)) {
      const emp = byId.get(asNum);
      return { name: emp.name, photoUrl: emp.photoUrl || null, employeeId: asNum };
    }
    return { name: String(asNum), photoUrl: null, employeeId: asNum };
  }

  const text = String(raw).trim();
  const byName = byNameLower?.get(text.toLowerCase());
  if (byName) {
    return {
      name: byName.name,
      photoUrl: byName.photoUrl || null,
      employeeId: byName.employeeId,
    };
  }

  return { name: text, photoUrl: null, employeeId: null };
}

/** New leads: primary role column wins over mirrored *_id — matches CalendarPage / RolesTab. */
function resolveLeadRoleParticipant(primary, idFallback, employeeLookup) {
  const raw =
    primary != null && primary !== '' && primary !== '--' && primary !== '---'
      ? primary
      : idFallback;
  if (raw == null || raw === '' || raw === '--' || raw === '---') return null;
  return resolveEmployeeParticipant(raw, employeeLookup);
}

/** Meeting row field first, then resolved lead role — matches CalendarPage. */
function resolveMeetingRoleParticipant(meetingField, leadParticipant, employeeLookup) {
  if (!isEmptyRoleValue(meetingField)) {
    return resolveEmployeeParticipant(meetingField, employeeLookup);
  }
  return leadParticipant || null;
}

function dedupeParticipants(list) {
  const seen = new Set();
  const out = [];
  for (const participant of list) {
    if (!participant?.name) continue;
    const key = participant.employeeId
      ? `e:${participant.employeeId}`
      : `n:${String(participant.name).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(participant);
  }
  return out;
}

function formatLegacyDisplayLeadNumber(lead, masterById) {
  const actual =
    (lead.lead_number && String(lead.lead_number).trim()) ||
    (lead.id != null ? String(lead.id) : '');
  if (!lead.master_id) return actual || null;

  if (actual && actual.includes('/')) return actual;

  const master =
    masterById.get(String(lead.master_id)) || masterById.get(Number(lead.master_id));
  const masterNum = master?.lead_number || String(lead.master_id);
  return `${masterNum}/2`;
}

function buildClientLeadInfo(lead, isLegacy, masterById = null) {
  if (isLegacy) {
    return {
      name: lead.name || null,
      leadNumber: formatLegacyDisplayLeadNumber(lead, masterById || new Map()),
      isLegacy: true,
      caseHandlerId: lead.case_handler_id ?? null,
      managerIdFallback: lead.meeting_manager_id ?? null,
      helperIdFallback: lead.meeting_lawyer_id ?? null,
    };
  }

  return {
    name: lead.name || null,
    leadNumber: lead.lead_number || null,
    isLegacy: false,
    caseHandlerId: lead.case_handler_id ?? null,
    handler: lead.handler ?? null,
    managerPrimary: lead.manager ?? null,
    managerIdFallback: lead.meeting_manager_id ?? null,
    helperPrimary: lead.helper ?? null,
    helperIdFallback: lead.meeting_lawyer_id ?? null,
  };
}

function buildMeetingParticipants(row, leadInfo, employeeLookup, imParticipantsByMeetingId) {
  const calendarType = String(row.calendar_type || '').trim();
  const parts = [];

  if (calendarType === 'staff') {
    for (const field of [row.meeting_manager, row.expert, row.helper, row.scheduler]) {
      const participant = resolveEmployeeParticipant(field, employeeLookup);
      if (participant) parts.push(participant);
    }
    parts.push(...(imParticipantsByMeetingId.get(Number(row.id)) || []));
    return dedupeParticipants(parts);
  }

  if (calendarType === 'active_client') {
    const handlerParticipant = resolveEmployeeParticipant(
      leadInfo?.caseHandlerId ?? leadInfo?.handler,
      employeeLookup,
    );
    if (handlerParticipant) parts.push(handlerParticipant);
    for (const guestId of [row.extern1, row.extern2]) {
      const guest = resolveEmployeeParticipant(guestId, employeeLookup);
      if (guest) parts.push(guest);
    }
    return dedupeParticipants(parts);
  }

  if (calendarType === 'potential_client') {
    const leadManager = leadInfo?.isLegacy
      ? resolveEmployeeParticipant(leadInfo.managerIdFallback, employeeLookup)
      : resolveLeadRoleParticipant(
          leadInfo?.managerPrimary,
          leadInfo?.managerIdFallback,
          employeeLookup,
        );
    const leadHelper = leadInfo?.isLegacy
      ? resolveEmployeeParticipant(leadInfo.helperIdFallback, employeeLookup)
      : resolveLeadRoleParticipant(
          leadInfo?.helperPrimary,
          leadInfo?.helperIdFallback,
          employeeLookup,
        );

    const managerParticipant = resolveMeetingRoleParticipant(
      row.meeting_manager,
      leadManager,
      employeeLookup,
    );
    const helperParticipant = resolveMeetingRoleParticipant(row.helper, leadHelper, employeeLookup);
    if (managerParticipant) parts.push(managerParticipant);
    if (helperParticipant) parts.push(helperParticipant);
    for (const guestId of [row.extern1, row.extern2]) {
      const guest = resolveEmployeeParticipant(guestId, employeeLookup);
      if (guest) parts.push(guest);
    }
    return dedupeParticipants(parts);
  }

  for (const field of [row.meeting_manager, row.helper, row.extern1, row.extern2]) {
    const participant = resolveEmployeeParticipant(field, employeeLookup);
    if (participant) parts.push(participant);
  }
  return dedupeParticipants(parts);
}

function collectEmployeeRolesForMeetings(meetingRows, clientInfoById, legacyLeadInfoById) {
  const ids = new Set();
  const names = new Set();

  const addId = (raw) => {
    if (isNumericEmployeeId(raw)) ids.add(Number(raw));
  };
  const addName = (raw) => {
    const name = collectRoleDisplayName(raw);
    if (name) names.add(name);
  };
  const addRole = (raw) => {
    addId(raw);
    addName(raw);
  };

  for (const row of meetingRows) {
    const leadInfo =
      clientInfoById.get(String(row.client_id)) ||
      legacyLeadInfoById.get(String(row.legacy_lead_id)) ||
      null;
    const calendarType = String(row.calendar_type || '').trim();

    if (calendarType === 'staff') {
      for (const field of [row.meeting_manager, row.expert, row.helper, row.scheduler]) addRole(field);
    } else if (calendarType === 'active_client') {
      addRole(leadInfo?.caseHandlerId);
      addRole(leadInfo?.handler);
      addRole(row.extern1);
      addRole(row.extern2);
    } else if (calendarType === 'potential_client') {
      addRole(row.meeting_manager);
      addRole(row.helper);
      if (leadInfo?.isLegacy) {
        addId(leadInfo.managerIdFallback);
        addId(leadInfo.helperIdFallback);
      } else if (leadInfo) {
        addRole(leadInfo.managerPrimary);
        addId(leadInfo.managerIdFallback);
        addRole(leadInfo.helperPrimary);
        addId(leadInfo.helperIdFallback);
      }
      addRole(row.extern1);
      addRole(row.extern2);
    } else {
      addRole(row.meeting_manager);
      addRole(row.helper);
      addRole(row.extern1);
      addRole(row.extern2);
    }
  }

  return { ids: [...ids], names: [...names] };
}

async function loadMeetingLocationsMap() {
  const { data, error } = await supabase
    .from('tenants_meetinglocation')
    .select('id, name')
    .eq('is_active', true);

  if (error) {
    console.warn('entryKioskDisplayService meeting locations failed:', error.message);
    return new Map();
  }

  const map = new Map();
  for (const row of data || []) {
    const id = Number(row.id);
    if (Number.isFinite(id) && id > 0) {
      map.set(id, String(row.name || '').trim() || `Location ${id}`);
    }
  }
  return map;
}

async function loadEmployeesForMeetings(ids, displayNames) {
  const uniqueIds = [...new Set(ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
  const uniqueNames = [...new Set((displayNames || []).map((n) => String(n).trim()).filter(Boolean))];

  const byId = new Map();
  const byNameLower = new Map();

  const mergeRow = (row) => {
    const id = Number(row.id);
    const name = String(row.display_name || row.official_name || (Number.isFinite(id) && id > 0 ? `Staff #${id}` : '')).trim();
    if (!Number.isFinite(id) || id <= 0 || !name) return;
    const payload = { name, photoUrl: row.photo_url || row.photo || null };
    byId.set(id, payload);
    byNameLower.set(name.toLowerCase(), { ...payload, employeeId: id });
  };

  if (uniqueIds.length > 0) {
    const { data, error } = await supabase
      .from('tenants_employee')
      .select('id, display_name, official_name, photo_url, photo')
      .in('id', uniqueIds);

    if (error) throw error;
    for (const row of data || []) mergeRow(row);
  }

  const namesToFetch = uniqueNames.filter((name) => !byNameLower.has(name.toLowerCase()));
  if (namesToFetch.length > 0) {
    const { data, error } = await supabase
      .from('tenants_employee')
      .select('id, display_name, official_name, photo_url, photo')
      .in('display_name', namesToFetch);

    if (!error) {
      for (const row of data || []) mergeRow(row);
    }
  }

  return { byId, byNameLower };
}

async function loadParticipantEmployeeIds(meetingIds) {
  if (!meetingIds.length) return [];

  const { data, error } = await supabase
    .from('meeting_participants')
    .select('employee_id')
    .in('meeting_id', meetingIds)
    .not('employee_id', 'is', null);

  if (error) return [];

  return [
    ...new Set(
      (data || [])
        .map((row) => Number(row.employee_id))
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  ];
}

async function loadImParticipantsByMeetingId(meetingIds, employeeById) {
  if (!meetingIds.length) return new Map();

  const { data, error } = await supabase
    .from('meeting_participants')
    .select('meeting_id, employee_id, firm_contact_id, free_name')
    .in('meeting_id', meetingIds);

  if (error) throw error;

  const firmIds = [
    ...new Set(
      (data || [])
        .map((row) => row.firm_contact_id)
        .filter(Boolean)
        .map((id) => String(id)),
    ),
  ];
  const firmNameById = new Map();

  if (firmIds.length > 0) {
    const { data: firms, error: firmsError } = await supabase
      .from('firm_contacts')
      .select('id, name')
      .in('id', firmIds);

    if (!firmsError) {
      for (const firm of firms || []) {
        const name = String(firm.name || '').trim();
        if (name) firmNameById.set(String(firm.id), name);
      }
    }
  }

  const byMeetingId = new Map();
  for (const row of data || []) {
    const meetingId = Number(row.meeting_id);
    if (!Number.isFinite(meetingId) || meetingId <= 0) continue;

    let participant = null;
    if (row.employee_id != null) {
      const empId = Number(row.employee_id);
      const emp = employeeById.get(empId);
      participant = emp
        ? { name: emp.name, photoUrl: emp.photoUrl || null, employeeId: empId }
        : { name: `Staff #${empId}`, photoUrl: null, employeeId: empId };
    } else if (row.firm_contact_id) {
      const name = firmNameById.get(String(row.firm_contact_id)) || null;
      if (name) participant = { name, photoUrl: null, employeeId: null };
    } else {
      const name = String(row.free_name || '').trim() || null;
      if (name) participant = { name, photoUrl: null, employeeId: null };
    }
    if (!participant) continue;

    if (!byMeetingId.has(meetingId)) byMeetingId.set(meetingId, []);
    byMeetingId.get(meetingId).push(participant);
  }

  for (const [meetingId, participants] of byMeetingId) {
    byMeetingId.set(meetingId, dedupeParticipants(participants));
  }
  return byMeetingId;
}

/** Match CalendarPage: include null/non-canceled meetings for today. */
const MEETINGS_TODAY_STATUS_FILTER = 'status.is.null,status.neq.canceled,status.neq.cancelled';

const MEETINGS_TODAY_SELECT_FULL =
  'id, meeting_date, meeting_time, status, client_id, legacy_lead_id, calendar_type, meeting_location, manual_address, custom_address, meeting_brief, meeting_subject, meeting_manager, expert, helper, scheduler, extern1, extern2, internal_meeting_type_id';

const MEETINGS_TODAY_SELECT_MINIMAL =
  'id, meeting_date, meeting_time, status, client_id, legacy_lead_id, calendar_type, meeting_location, meeting_brief, meeting_manager, expert, helper, extern1, extern2';

const LEADS_SELECT_FULL =
  'id, name, lead_number, case_handler_id, handler, manager, helper, meeting_manager_id, meeting_lawyer_id';
const LEADS_SELECT_MINIMAL =
  'id, name, lead_number, case_handler_id, manager, helper, meeting_manager_id, meeting_lawyer_id';

const DEFAULT_MEETING_DURATION_MINUTES = 60;

function meetingDurationMinutes(row) {
  const duration = Number(row?.meeting_duration_minutes);
  return Number.isFinite(duration) && duration > 0 ? duration : DEFAULT_MEETING_DURATION_MINUTES;
}

async function loadInternalMeetingTypesMap() {
  const { data, error } = await supabase
    .from('internal_meeting_types')
    .select('id, code, label');

  if (error) {
    console.warn('entryKioskDisplayService internal meeting types failed:', error.message);
    return new Map();
  }

  const map = new Map();
  for (const row of data || []) {
    const id = Number(row.id);
    const label = String(row.label || '').trim();
    if (Number.isFinite(id) && id > 0 && label) {
      map.set(id, label);
    }
  }
  return map;
}

function isStaffMeetingRow(row) {
  return String(row?.calendar_type || '').trim() === 'staff';
}

function shouldIncludeMeetingRow(row, clientInfoById, legacyLeadInfoById) {
  if (isStaffMeetingRow(row)) return true;
  if (row.client_id && !clientInfoById.has(String(row.client_id))) return false;
  if (row.legacy_lead_id && !legacyLeadInfoById.has(String(row.legacy_lead_id))) return false;
  return true;
}

async function loadMeetingsTodayRows(today) {
  const baseQuery = () =>
    supabase
      .from('meetings')
      .select(MEETINGS_TODAY_SELECT_FULL)
      .eq('meeting_date', today)
      .or(MEETINGS_TODAY_STATUS_FILTER)
      .order('meeting_time', { ascending: true });

  let { data, error } = await baseQuery();

  if (error) {
    console.warn('entryKioskDisplayService meetings today full select failed:', error.message);
    const fallback = await supabase
      .from('meetings')
      .select(MEETINGS_TODAY_SELECT_MINIMAL)
      .eq('meeting_date', today)
      .or(MEETINGS_TODAY_STATUS_FILTER)
      .order('meeting_time', { ascending: true });
    if (fallback.error) throw fallback.error;
    data = fallback.data;
  }

  return data || [];
}

async function enrichMeetingsToday(rows, { maxCount, preview } = {}) {
  if (!rows.length) return [];

  const clientIds = [...new Set(rows.map((m) => m.client_id).filter(Boolean))];
  const legacyLeadIds = [...new Set(rows.map((m) => m.legacy_lead_id).filter(Boolean))];
  const clientInfoById = new Map();
  const legacyLeadInfoById = new Map();

  if (clientIds.length > 0) {
    let { data: leads, error: leadsError } = await supabase
      .from('leads')
      .select(LEADS_SELECT_FULL)
      .in('id', clientIds)
      .is('unactivated_at', null)
      .neq('stage', 91);

    if (leadsError) {
      console.warn('entryKioskDisplayService leads full select failed:', leadsError.message);
      const fallback = await supabase
        .from('leads')
        .select(LEADS_SELECT_MINIMAL)
        .in('id', clientIds)
        .is('unactivated_at', null)
        .neq('stage', 91);
      if (fallback.error) throw fallback.error;
      leads = fallback.data;
    }

    for (const lead of leads || []) {
      clientInfoById.set(String(lead.id), buildClientLeadInfo(lead, false));
    }
  }

  if (legacyLeadIds.length > 0) {
    const { data: legacyLeads, error: legacyError } = await supabase
      .from('leads_lead')
      .select('id, name, lead_number, master_id, case_handler_id, meeting_manager_id, meeting_lawyer_id')
      .in('id', legacyLeadIds)
      .or('status.eq.0,status.is.null')
      .neq('stage', 91);

    if (legacyError) throw legacyError;

    const masterById = new Map();
    for (const lead of legacyLeads || []) {
      masterById.set(String(lead.id), lead);
    }

    const masterIdsToFetch = [
      ...new Set(
        (legacyLeads || [])
          .map((lead) => lead.master_id)
          .filter((id) => id != null && !masterById.has(String(id))),
      ),
    ];

    if (masterIdsToFetch.length > 0) {
      const { data: masterLeads, error: masterError } = await supabase
        .from('leads_lead')
        .select('id, lead_number')
        .in('id', masterIdsToFetch);

      if (!masterError) {
        for (const master of masterLeads || []) {
          masterById.set(String(master.id), master);
        }
      }
    }

    for (const lead of legacyLeads || []) {
      legacyLeadInfoById.set(String(lead.id), buildClientLeadInfo(lead, true, masterById));
    }
  }

  const activeRows = rows.filter((row) =>
    shouldIncludeMeetingRow(row, clientInfoById, legacyLeadInfoById),
  );
  if (!activeRows.length) return [];

  const previewEntries = preview === 'next'
    ? selectNextMeeting(activeRows)
    : maxCount
      ? selectMeetingsWindow(activeRows, maxCount)
      : null;

  const meetingRows = previewEntries ? previewEntries.map((w) => w.row) : activeRows;
  const statusEntries = previewEntries
    ? previewEntries
    : activeRows
        .map((row) => {
          const startMinutes = parseMeetingTimeMinutes(row.meeting_time);
          const nowMinutes = nowMinutesJerusalem();
          if (startMinutes == null) {
            return { row, isCurrent: false, isPast: false, missingTime: true };
          }
          return {
            row,
            isCurrent: isMeetingCurrentByStart(startMinutes, nowMinutes),
            isPast: isMeetingPastByStart(startMinutes, nowMinutes),
            missingTime: false,
          };
        });

  const staffMeetingIds = meetingRows
    .filter((row) => String(row.calendar_type || '').trim() === 'staff')
    .map((row) => row.id);
  const { ids: employeeIds, names: employeeNames } = collectEmployeeRolesForMeetings(
    meetingRows,
    clientInfoById,
    legacyLeadInfoById,
  );
  let participantEmployeeIds = [];
  if (staffMeetingIds.length) {
    participantEmployeeIds = await loadParticipantEmployeeIds(staffMeetingIds);
  }

  const employeeLookup = await loadEmployeesForMeetings(
    [...new Set([...employeeIds, ...participantEmployeeIds])],
    employeeNames,
  );
  const [locationById, imParticipantsByMeetingId, internalMeetingTypes] = await Promise.all([
    loadMeetingLocationsMap(),
    staffMeetingIds.length
      ? loadImParticipantsByMeetingId(staffMeetingIds, employeeLookup.byId).catch((err) => {
          console.warn('entryKioskDisplayService meeting participants failed:', err?.message || err);
          return new Map();
        })
      : Promise.resolve(new Map()),
    loadInternalMeetingTypesMap(),
  ]);

  return statusEntries
    .map(({ row, isCurrent, isPast }) => {
    const clientInfo = clientInfoById.get(String(row.client_id)) || {};
    const legacyInfo = legacyLeadInfoById.get(String(row.legacy_lead_id)) || {};
    const leadInfo =
      (row.client_id && clientInfoById.get(String(row.client_id))) ||
      (row.legacy_lead_id && legacyLeadInfoById.get(String(row.legacy_lead_id))) ||
      {};
    const clientName = leadInfo.name || legacyInfo.name || clientInfo.name || null;
    const leadNumber = leadInfo.leadNumber || legacyInfo.leadNumber || clientInfo.leadNumber || null;
    const internalType = internalMeetingTypes.get(Number(row.internal_meeting_type_id)) || null;
    const time = row.meeting_time ? String(row.meeting_time).slice(0, 5) : null;
    const location =
      resolveLocationName(row.meeting_location, locationById) ||
      String(row.manual_address || row.custom_address || '').trim() ||
      null;
    const participants = buildMeetingParticipants(row, leadInfo, employeeLookup, imParticipantsByMeetingId);
    const isStaff = row.calendar_type === 'staff';
    const title =
      (isStaff ? row.meeting_subject || row.meeting_brief : null) ||
      clientName ||
      row.meeting_brief ||
      'Meeting';
    const durationMinutes = meetingDurationMinutes(row);

    return {
      id: row.id,
      time,
      type: meetingTypeLabel(row.calendar_type, internalType),
      typeCode: meetingTypeCode(row.calendar_type),
      clientName,
      leadNumber,
      title,
      participants,
      location,
      durationMinutes,
      isCurrent,
      isPast,
      isVirtual: /teams|zoom|video|online|virtual|phone|call|google meet|meet\b/i.test(
        String(location || ''),
      ),
    };
  })
    .sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
}

async function loadMeetingsToday(today) {
  const rows = await loadMeetingsTodayRows(today);
  return enrichMeetingsToday(rows, { preview: 'next' });
}

async function loadAllMeetingsToday(today) {
  const rows = await loadMeetingsTodayRows(today);
  return enrichMeetingsToday(rows);
}

/** Simple in-memory weather cache (city → { at, payload }). */
const weatherCache = new Map();
const WEATHER_CACHE_MS = 20 * 60_000;

async function fetchWeather(city) {
  const key = String(city || 'Tel Aviv').trim() || 'Tel Aviv';
  const cached = weatherCache.get(key);
  const now = Date.now();
  if (cached && now - cached.at < WEATHER_CACHE_MS) {
    return cached.payload;
  }

  try {
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(key)}&count=1&language=en&format=json`;
    const geoRes = await fetch(geoUrl);
    if (!geoRes.ok) return null;
    const geoJson = await geoRes.json();
    const place = geoJson?.results?.[0];
    if (!place) return null;

    const forecastUrl =
      `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
      '&current=temperature_2m,weather_code&timezone=Asia%2FJerusalem';
    const forecastRes = await fetch(forecastUrl);
    if (!forecastRes.ok) return null;
    const forecastJson = await forecastRes.json();
    const current = forecastJson?.current;
    if (!current) return null;

    const payload = {
      city: place.name || key,
      temperatureC: current.temperature_2m ?? null,
      weatherCode: current.weather_code ?? null,
      fetchedAt: new Date().toISOString(),
    };
    weatherCache.set(key, { at: now, payload });
    return payload;
  } catch (err) {
    console.warn('entryKioskDisplayService weather fetch failed:', err?.message || err);
    return null;
  }
}

async function loadInOfficeCount() {
  const { data, error } = await supabase
    .from('employee_clock_in')
    .select('employee_id')
    .eq('is_active', true);

  if (error) throw error;

  const ids = new Set(
    (data || [])
      .map((row) => Number(row.employee_id))
      .filter((id) => Number.isFinite(id) && id > 0),
  );
  return ids.size;
}

async function loadInOfficeCountAtLocation(locationId = DEFAULT_LOCATION_ID) {
  const { data, error } = await supabase
    .from('employee_clock_in')
    .select('employee_id')
    .eq('is_active', true)
    .eq('clock_in_location_id', locationId);

  if (error) throw error;

  const ids = new Set(
    (data || [])
      .map((row) => Number(row.employee_id))
      .filter((id) => Number.isFinite(id) && id > 0),
  );
  return ids.size;
}

/** Keep in sync with src/lib/clockInHelpContacts.ts */
const HELP_CONTACT_EMPLOYEE_IDS = [1, 3];
const HELP_CONTACT_PHONE_OVERRIDES = {
  3: '0547652074',
};

function resolveHelpContactPhone(emp) {
  const override = HELP_CONTACT_PHONE_OVERRIDES[emp.id];
  if (override) return override;
  const mobile = String(emp.mobile || '').trim();
  const phone = String(emp.phone || '').trim();
  return mobile || phone || null;
}

async function loadHelpContacts() {
  const { data: employees, error: empError } = await supabase
    .from('tenants_employee')
    .select('id, display_name, photo_url, photo, mobile, phone')
    .in('id', HELP_CONTACT_EMPLOYEE_IDS);
  if (empError) throw empError;

  const { data: users, error: userError } = await supabase
    .from('users')
    .select('employee_id, email')
    .in('employee_id', HELP_CONTACT_EMPLOYEE_IDS);
  if (userError) throw userError;

  const emailByEmployee = new Map();
  for (const row of users || []) {
    if (row.employee_id != null && row.email) {
      emailByEmployee.set(Number(row.employee_id), String(row.email).trim());
    }
  }

  return HELP_CONTACT_EMPLOYEE_IDS.map((id) => {
    const emp = (employees || []).find((e) => Number(e.id) === id);
    const displayName = String(emp?.display_name || '').trim() || `Employee #${id}`;
    const phone = resolveHelpContactPhone({
      id,
      mobile: emp?.mobile ?? null,
      phone: emp?.phone ?? null,
    });
    return {
      id,
      name: displayName,
      photoUrl: String(emp?.photo_url || emp?.photo || '').trim() || null,
      phone,
      email: emailByEmployee.get(id) || null,
    };
  });
}

function unavailabilityOverlapsDay(startDate, endDate, today) {
  const start = String(startDate || '').slice(0, 10);
  const end = String(endDate || start || '').slice(0, 10);
  if (!start) return false;
  if (start > today) return false;
  if (end && end < today) return false;
  return true;
}

async function loadUnavailableEmployeeCount(today) {
  const { data, error } = await supabase
    .from('employee_unavailability_reasons')
    .select('employee_id, start_date, end_date, approved, declined')
    .lte('start_date', today);

  if (error) throw error;

  const ids = new Set();
  for (const row of data || []) {
    if (row.declined === true) continue;
    if (row.approved !== true) continue;
    if (!unavailabilityOverlapsDay(row.start_date, row.end_date, today)) continue;
    const id = Number(row.employee_id);
    if (Number.isFinite(id) && id > 0) ids.add(id);
  }
  return ids.size;
}

async function loadHolidaysToday(today) {
  const names = [];
  const seen = new Set();

  const pushName = (raw) => {
    const name = String(raw || '').trim();
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    names.push(name);
  };

  try {
    const { data, error } = await supabase
      .from('holidays')
      .select('id, name, date, is_active')
      .eq('date', today)
      .eq('is_active', true);
    if (error) throw error;
    for (const row of data || []) pushName(row.name);
  } catch (err) {
    console.warn('entryKioskDisplayService holidays table failed:', err?.message || err);
  }

  try {
    const year = Number(String(today).slice(0, 4));
    if (Number.isFinite(year) && year > 2000) {
      const url = new URL('https://www.hebcal.com/hebcal/');
      url.searchParams.set('v', '1');
      url.searchParams.set('cfg', 'json');
      url.searchParams.set('year', String(year));
      url.searchParams.set('i', 'on');
      url.searchParams.set('maj', 'on');
      url.searchParams.set('min', 'on');
      url.searchParams.set('mod', 'on');
      url.searchParams.set('nx', 'on');
      url.searchParams.set('mf', 'on');
      url.searchParams.set('ss', 'on');
      const res = await fetch(url.toString());
      if (res.ok) {
        const json = await res.json();
        const relevant = new Set(['holiday', 'yomtov', 'fast', 'roshchodesh', 'modern']);
        for (const item of json?.items || []) {
          const iso = String(item?.date || '').slice(0, 10);
          if (iso !== today) continue;
          const category = String(item?.category || '').toLowerCase();
          if (!relevant.has(category)) continue;
          const title = String(item?.title || '').trim();
          const lower = title.toLowerCase();
          if (!title || lower.includes('parashat') || lower.includes('candle')) continue;
          pushName(title);
        }
      }
    }
  } catch (err) {
    console.warn('entryKioskDisplayService hebcal holidays failed:', err?.message || err);
  }

  return names.map((name, index) => ({ id: `holiday-${index}-${name}`, name }));
}

function parseEmployeeIdFromRole(raw) {
  if (isEmptyRoleValue(raw)) return null;
  const text = String(raw).trim();
  const asNum = Number(text);
  if (Number.isFinite(asNum) && asNum > 0) return Math.trunc(asNum);
  return null;
}

async function loadMeetingsCountByDepartment(today) {
  const rows = await loadMeetingsTodayRows(today);
  if (!rows.length) return [];

  const managerIds = [];
  for (const row of rows) {
    const id =
      parseEmployeeIdFromRole(row.meeting_manager) ||
      parseEmployeeIdFromRole(row.expert) ||
      parseEmployeeIdFromRole(row.helper);
    if (id) managerIds.push(id);
  }
  const uniqueManagerIds = [...new Set(managerIds)];
  const deptByEmployeeId = new Map();

  if (uniqueManagerIds.length > 0) {
    const { data, error } = await supabase
      .from('tenants_employee')
      .select('id, department_id, tenant_departement!department_id(id, name)')
      .in('id', uniqueManagerIds);
    if (error) {
      console.warn('entryKioskDisplayService department lookup failed:', error.message);
    } else {
      for (const emp of data || []) {
        const dept = Array.isArray(emp.tenant_departement)
          ? emp.tenant_departement[0]
          : emp.tenant_departement;
        const name = String(dept?.name || '').trim() || 'Unassigned';
        deptByEmployeeId.set(Number(emp.id), name);
      }
    }
  }

  const counts = new Map();
  for (const row of rows) {
    const managerId =
      parseEmployeeIdFromRole(row.meeting_manager) ||
      parseEmployeeIdFromRole(row.expert) ||
      parseEmployeeIdFromRole(row.helper);
    const deptName = (managerId && deptByEmployeeId.get(managerId)) || 'Unassigned';
    counts.set(deptName, (counts.get(deptName) || 0) + 1);
  }

  return [...counts.entries()]
    .map(([department, count]) => ({ department, count }))
    .sort((a, b) => b.count - a.count || a.department.localeCompare(b.department));
}

function weatherCodeLabel(code) {
  const map = {
    0: 'Clear',
    1: 'Mainly clear',
    2: 'Partly cloudy',
    3: 'Overcast',
    45: 'Fog',
    48: 'Fog',
    51: 'Drizzle',
    53: 'Drizzle',
    55: 'Drizzle',
    61: 'Rain',
    63: 'Rain',
    65: 'Heavy rain',
    71: 'Snow',
    80: 'Showers',
    95: 'Thunderstorm',
  };
  return map[code] || 'Weather';
}

async function safeLoad(label, loader, fallback) {
  try {
    return await loader();
  } catch (err) {
    console.warn(`entryKioskDisplayService ${label} failed:`, err?.message || err);
    return fallback;
  }
}

/**
 * Public bundle for the entry kiosk tablet display.
 */
async function getDisplayBundle(locationIdInput = DEFAULT_LOCATION_ID) {
  const locationId = normalizeLocationId(locationIdInput);
  const today = todayIsoLocal();
  const settings = await loadSettings(locationId);

  const [
    announcements,
    gadgets,
    birthdays,
    meetings,
    weather,
    inOfficeCount,
    localInOfficeCount,
    unavailableCount,
    holidays,
    meetingsByDepartment,
    helpContacts,
  ] = await Promise.all([
    settings.show_announcements
      ? safeLoad('announcements', () => loadAnnouncements(locationId, today), [])
      : Promise.resolve([]),
    settings.show_gadgets
      ? safeLoad('gadgets', () => loadGadgets(locationId), [])
      : Promise.resolve([]),
    settings.show_birthdays
      ? safeLoad('birthdays', () => loadBirthdaysToday(today), [])
      : Promise.resolve([]),
    settings.show_meetings_today
      ? safeLoad('meetings', () => loadMeetingsToday(today), [])
      : Promise.resolve([]),
    settings.show_weather
      ? safeLoad('weather', () => fetchWeather(settings.weather_city), null)
      : Promise.resolve(null),
    safeLoad('inOfficeCount', () => loadInOfficeCount(), 0),
    safeLoad('localInOfficeCount', () => loadInOfficeCountAtLocation(locationId), 0),
    safeLoad('unavailableCount', () => loadUnavailableEmployeeCount(today), 0),
    safeLoad('holidays', () => loadHolidaysToday(today), []),
    safeLoad('meetingsByDepartment', () => loadMeetingsCountByDepartment(today), []),
    safeLoad('helpContacts', () => loadHelpContacts(), []),
  ]);

  return {
    locationId,
    settings: {
      officeLabel: settings.office_label,
      showClockDate: Boolean(settings.show_clock_date),
      showWeather: Boolean(settings.show_weather),
      showMeetingsToday: Boolean(settings.show_meetings_today),
      showBirthdays: Boolean(settings.show_birthdays),
      showAnnouncements: Boolean(settings.show_announcements),
      showGadgets: Boolean(settings.show_gadgets),
      weatherCity: settings.weather_city,
    },
    announcements,
    gadgets,
    birthdays,
    meetings,
    holidays,
    meetingsByDepartment,
    helpContacts,
    inOfficeCount: Number(inOfficeCount) || 0,
    localInOfficeCount: Number(localInOfficeCount) || 0,
    unavailableCount: Number(unavailableCount) || 0,
    weather: weather
      ? {
          ...weather,
          label: weatherCodeLabel(weather.weatherCode),
        }
      : null,
  };
}

/**
 * Full list of today's scheduled meetings for the kiosk detail screen.
 */
async function getMeetingsTodayBundle(locationIdInput = DEFAULT_LOCATION_ID) {
  const locationId = normalizeLocationId(locationIdInput);
  const today = todayIsoLocal();
  const meetings = await safeLoad('meetingsToday', () => loadAllMeetingsToday(today), []);
  return { locationId, date: today, meetings };
}

module.exports = {
  getDisplayBundle,
  getMeetingsTodayBundle,
  DEFAULT_LOCATION_ID,
};
