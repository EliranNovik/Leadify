const supabase = require('../config/supabase');
const graphAuthService = require('./graphAuthService');
const graphMailboxSyncService = require('./graphMailboxSyncService');
const mailboxTokenService = require('./mailboxTokenService');
const whatsappController = require('../controllers/whatsappController');
const {
  buildBookingWhatsAppTemplateParameters,
  fillWhatsAppTemplateContent,
  resolveBookingLocationDisplay,
} = require('./bookingWhatsAppParams');
const {
  generateICSFromDateTime,
  buildIcsEmailAttachment,
  stripHtmlForIcs,
} = require('../lib/icsGenerator');
const {
  parseEmailTemplateContent,
  formatPlainEmailHtml,
  fillEmailTemplateParams,
} = require('../lib/emailTemplateContent');
const {
  BUSINESS_TZ,
  isValidIanaTimezone,
  jerusalemDateTimeFromWall,
  clientLocalToJerusalem,
  jerusalemToClientLocal,
  formatDualBookingTime,
  addDaysToDateKey,
  normalizeTime,
} = require('../lib/bookingTimezone');
const { DateTime } = require('luxon');

/** Delegated scopes for shared-calendar Teams booking (not app-only). */
const BOOKING_GRAPH_SCOPES = [
  'offline_access',
  'Mail.Read',
  'Mail.Send',
  'Calendars.ReadWrite',
  'Calendars.ReadWrite.Shared',
  'OnlineMeetings.ReadWrite',
];

const SHARED_CALENDARS = {
  potential_client: 'shared-potentialclients@lawoffice.org.il',
  active_client: 'shared-newclients@lawoffice.org.il',
};

const INVITATION_TEMPLATE_IDS = {
  invitation: { en: 151, he: 152 },
  invitation_jlm: { en: 157, he: 158 },
  invitation_tlv: { en: 161, he: 162 },
  invitation_tlv_parking: { en: 159, he: 160 },
};

const CLIENT_BOOKING_LOCATIONS = ['Teams', 'Ramat Gan Office'];

function normalizeTimeHHmm(value) {
  const raw = String(value || '').trim().substring(0, 5);
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return '';
  return `${String(Number(match[1])).padStart(2, '0')}:${match[2]}`;
}

function normalizeMaxMeetingsPerHour(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.floor(n);
}

function meetingClockHourKey(meetingTime) {
  const raw = String(meetingTime || '').trim();
  const hh = raw.substring(0, 2);
  return /^\d{2}$/.test(hh) ? hh : null;
}

function slotClockHourKey(timeStr) {
  return meetingClockHourKey(`${normalizeTimeHHmm(timeStr)}:00`);
}

function resolveCategoryAvailability(settings) {
  const mainCategoryId = settings.main_category_id != null ? Number(settings.main_category_id) : null;
  const rules = Array.isArray(settings.category_availability_rules)
    ? settings.category_availability_rules
    : [];

  const base = {
    ...settings,
    business_hours_start: normalizeTimeHHmm(settings.business_hours_start) || '09:00',
    business_hours_end: normalizeTimeHHmm(settings.business_hours_end) || '21:00',
    active_category_rule: null,
  };

  if (mainCategoryId != null && Number.isFinite(mainCategoryId)) {
    for (const rule of rules) {
      const ids = Array.isArray(rule?.main_category_ids)
        ? rule.main_category_ids.map((id) => Number(id)).filter((id) => Number.isFinite(id))
        : [];
      if (!ids.includes(mainCategoryId)) continue;

      const businessHoursStart = normalizeTimeHHmm(rule.business_hours_start)
        || normalizeTimeHHmm(settings.business_hours_start)
        || '09:00';
      const businessHoursEnd = normalizeTimeHHmm(rule.business_hours_end)
        || normalizeTimeHHmm(settings.business_hours_end)
        || '21:00';
      const daysOfWeek = Array.isArray(rule.days_of_week) && rule.days_of_week.length > 0
        ? rule.days_of_week.map((d) => Number(d)).filter((d) => Number.isFinite(d))
        : settings.days_of_week;

      return {
        ...settings,
        business_hours_start: businessHoursStart,
        business_hours_end: businessHoursEnd,
        days_of_week: daysOfWeek,
        active_category_rule: {
          main_category_ids: ids,
          max_meetings_per_hour: normalizeMaxMeetingsPerHour(rule.max_meetings_per_hour),
        },
      };
    }
  }

  return base;
}

async function buildMainCategoryLookupForMeetings(meetings) {
  const lookup = new Map();
  const newLeadIds = [...new Set((meetings || []).map((m) => m.client_id).filter(Boolean))];
  const legacyIds = [
    ...new Set((meetings || []).map((m) => m.legacy_lead_id).filter((id) => id != null && Number.isFinite(Number(id)))),
  ];

  if (newLeadIds.length > 0) {
    const { data: leads } = await supabase.from('leads').select('id, category_id').in('id', newLeadIds);
    const categoryIds = [...new Set((leads || []).map((l) => l.category_id).filter(Boolean))];
    let parentByCategoryId = new Map();
    if (categoryIds.length > 0) {
      const { data: categories } = await supabase
        .from('misc_category')
        .select('id, parent_id')
        .in('id', categoryIds);
      parentByCategoryId = new Map((categories || []).map((c) => [c.id, c.parent_id]));
    }
    for (const lead of leads || []) {
      const mainId = lead.category_id != null ? parentByCategoryId.get(lead.category_id) : null;
      lookup.set(`new:${lead.id}`, mainId != null ? Number(mainId) : null);
    }
  }

  if (legacyIds.length > 0) {
    const { data: leads } = await supabase.from('leads_lead').select('id, category_id').in('id', legacyIds);
    const categoryIds = [...new Set((leads || []).map((l) => l.category_id).filter(Boolean))];
    let parentByCategoryId = new Map();
    if (categoryIds.length > 0) {
      const { data: categories } = await supabase
        .from('misc_category')
        .select('id, parent_id')
        .in('id', categoryIds);
      parentByCategoryId = new Map((categories || []).map((c) => [c.id, c.parent_id]));
    }
    for (const lead of leads || []) {
      const mainId = lead.category_id != null ? parentByCategoryId.get(lead.category_id) : null;
      lookup.set(`legacy:${lead.id}`, mainId != null ? Number(mainId) : null);
    }
  }

  return lookup;
}

async function fetchCategoryHourlyMeetingCounts(dateStr, mainCategoryIds) {
  const allowed = new Set(
    (mainCategoryIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id)),
  );
  if (allowed.size === 0) return {};

  const { data: meetings } = await supabase
    .from('meetings')
    .select('meeting_time, client_id, legacy_lead_id')
    .eq('meeting_date', dateStr)
    .or('status.is.null,status.neq.canceled');

  if (!meetings?.length) return {};

  const lookup = await buildMainCategoryLookupForMeetings(meetings);
  const counts = {};

  for (const meeting of meetings) {
    const leadKey =
      meeting.legacy_lead_id != null
        ? `legacy:${meeting.legacy_lead_id}`
        : meeting.client_id
          ? `new:${meeting.client_id}`
          : null;
    if (!leadKey) continue;

    const mainCategoryId = lookup.get(leadKey);
    if (!allowed.has(Number(mainCategoryId))) continue;

    const hour = meetingClockHourKey(meeting.meeting_time);
    if (!hour) continue;
    counts[hour] = (counts[hour] || 0) + 1;
  }

  return counts;
}

function isCategoryHourCapReached(maxPerHour, hourCounts, timeStr) {
  const max = normalizeMaxMeetingsPerHour(maxPerHour);
  if (max == null) return false;
  const hour = slotClockHourKey(timeStr);
  if (!hour) return false;
  return (hourCounts[hour] || 0) >= max;
}

async function assertCategoryHourlyCapacity(settings, dateStr, timeStr) {
  const rule = settings.active_category_rule;
  if (!rule?.max_meetings_per_hour || !rule.main_category_ids?.length) return;

  const counts = await fetchCategoryHourlyMeetingCounts(dateStr, rule.main_category_ids);
  if (isCategoryHourCapReached(rule.max_meetings_per_hour, counts, timeStr)) {
    throw new Error('This time slot is no longer available for your service category');
  }
}

function resolveBookingWindow(settings) {
  const start = normalizeTimeHHmm(settings.business_hours_start) || '09:00';
  const end = normalizeTimeHHmm(settings.business_hours_end) || '21:00';
  const startMin = parseTimeToMinutes(start);
  const endMin = parseTimeToMinutes(end);
  // business_hours_end is the last allowed meeting *start* time (not when the slot must end).
  const lastStartMin = Math.max(startMin, endMin);
  return {
    start,
    end,
    lastStart: minutesToTime(lastStartMin),
  };
}

function isJerusalemDateUnavailable(settings, jerusalemDateStr) {
  const blocked = Array.isArray(settings.unavailable_dates) ? settings.unavailable_dates : [];
  return blocked.includes(jerusalemDateStr);
}

function resolveClientBookingLocation(value) {
  const location = String(value || '').trim();
  if (!CLIENT_BOOKING_LOCATIONS.includes(location)) {
    throw new Error('Please select Teams or Ramat Gan Office');
  }
  return location;
}

function isTeamsLocation(locationName) {
  return locationName === 'Teams';
}

function parseTimeToMinutes(timeStr) {
  const [h, m] = String(timeStr || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function minutesToTime(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function inferInvitationType(locationName) {
  const location = String(locationName || '').toLowerCase();
  if (location.includes('ramat gan')) return 'invitation_tlv';
  if (location.includes('jrslm') || location.includes('jerusalem')) return 'invitation_jlm';
  if (location.includes('tlv') && location.includes('parking')) return 'invitation_tlv_parking';
  if (location.includes('tlv') || location.includes('tel aviv')) return 'invitation_tlv';
  return 'invitation';
}

function isMicrosoftEmail(email) {
  const domains = ['outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'onmicrosoft.com'];
  return domains.some((d) => String(email || '').toLowerCase().includes(`@${d}`));
}

async function getAppAccessToken() {
  const tenantId =
    process.env.GRAPH_TENANT_ID ||
    process.env.MSAL_TENANT_ID ||
    process.env.AZURE_TENANT_ID;
  const clientId =
    process.env.GRAPH_CLIENT_ID ||
    process.env.MSAL_CLIENT_ID ||
    process.env.AZURE_CLIENT_ID;
  const clientSecret =
    process.env.GRAPH_CLIENT_SECRET ||
    process.env.CLIENT_SECRET ||
    process.env.MSAL_CLIENT_SECRET ||
    process.env.AZURE_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('Microsoft Graph app credentials are not configured on the server');
  }

  const response = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
      }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to acquire Graph app token: ${text}`);
  }

  const data = await response.json();
  return data.access_token;
}

async function getDelegatedAccessTokenForUserId(userId) {
  if (!userId) return null;

  const tokenRecord = await mailboxTokenService.getTokenByUserId(userId).catch(() => null);
  if (!tokenRecord?.refresh_token) return null;

  try {
    const tokenResponse = await graphAuthService.acquireTokenByRefreshToken(
      tokenRecord.refresh_token,
      {
        homeAccountId: tokenRecord.home_account_id,
        environment: tokenRecord.environment || 'login.windows.net',
        tenantId: tokenRecord.tenant_id,
        username: tokenRecord.mailbox_address,
      },
      BOOKING_GRAPH_SCOPES,
    );
    return tokenResponse?.accessToken || null;
  } catch (err) {
    if (err?.code === 'EXPIRED_REFRESH_TOKEN') {
      console.warn(`Booking mailbox token expired for user ${userId}`);
      return null;
    }
    throw err;
  }
}

async function getUserIdForEmployee(employeeId) {
  if (!employeeId) return null;
  const { data: userRow } = await supabase
    .from('users')
    .select('id')
    .eq('employee_id', employeeId)
    .maybeSingle();
  return userRow?.id || null;
}

async function resolveBookingMailbox(hostEmployeeId) {
  const candidates = [
    (process.env.BOOKING_MAILBOX_USER_ID || '').trim(),
    await getUserIdForEmployee(hostEmployeeId),
    (process.env.PAYMENT_CONFIRMATION_MAILBOX_USER_ID || '').trim(),
  ].filter(Boolean);

  for (const userId of candidates) {
    const accessToken = await getDelegatedAccessTokenForUserId(userId);
    if (accessToken) {
      return { userId, accessToken, authMode: 'delegated' };
    }
  }
  return null;
}

async function getDelegatedAccessTokenForEmployee(employeeId) {
  const userId = await getUserIdForEmployee(employeeId);
  if (!userId) return null;
  return getDelegatedAccessTokenForUserId(userId);
}

function isRaopAppOnlyError(message) {
  const text = String(message || '');
  return (
    text.includes('AppOnly AccessPolicy') ||
    text.includes('Access to OData is disabled') ||
    text.includes('[RAOP]')
  );
}

async function getGraphAccessToken(hostEmployeeId) {
  const delegated = await resolveBookingMailbox(hostEmployeeId);
  if (delegated?.accessToken) {
    return delegated;
  }

  try {
    const accessToken = await getAppAccessToken();
    return { userId: null, accessToken, authMode: 'app' };
  } catch (appErr) {
    throw new Error(
      'Client booking needs a connected Microsoft mailbox (delegated auth). ' +
      'Set BOOKING_MAILBOX_USER_ID to a staff user with Graph mailbox connected, ' +
      'or connect the meeting manager mailbox. ' +
      (appErr.message || '')
    );
  }
}

function calendarMailbox(calendarType) {
  return SHARED_CALENDARS[calendarType] || SHARED_CALENDARS.potential_client;
}

async function invokeExpressHandler(handler, body) {
  return new Promise((resolve, reject) => {
    const req = { body };
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        if (this.statusCode >= 400) {
          reject(new Error(data?.error || data?.details || 'Request failed'));
          return;
        }
        resolve(data);
      },
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

async function fetchEventJoinUrl(accessToken, calendarType, eventId) {
  if (!eventId) return '';
  const calendarEmail = calendarMailbox(calendarType);
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(calendarEmail)}/calendar/events/${encodeURIComponent(eventId)}?$select=onlineMeeting,webLink`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) return '';
  const data = await response.json();
  return data.onlineMeeting?.joinUrl || data.webLink || '';
}

async function getBookingContext(token) {
  const { data, error } = await supabase.rpc('get_public_booking_context', {
    p_token: token,
  });
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.error || 'Invalid booking link');

  const merged = {
    ...data.settings,
    main_category_id: data.main_category_id ?? null,
    category_availability_rules: data.category_availability_rules || [],
    unavailable_dates: Array.isArray(data.unavailable_dates) ? data.unavailable_dates : [],
  };

  return resolveCategoryAvailability(merged);
}

async function getPublicConfig(token) {
  const { data, error } = await supabase.rpc('get_public_booking_config', {
    p_token: token,
  });
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.error || 'Invalid booking link');
  return data;
}

async function getScheduledMeetings(token) {
  const { data, error } = await supabase.rpc('get_public_booking_meetings', {
    p_token: token,
  });
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.error || 'Invalid booking link');
  return data.meetings || [];
}

function slotOverlaps(startMin, duration, buffer, busyRanges) {
  const endMin = startMin + duration;
  for (const range of busyRanges) {
    const blockedStart = range.start - buffer;
    const blockedEnd = range.end + buffer;
    if (startMin < blockedEnd && endMin > blockedStart) return true;
  }
  return false;
}

function isBookingTimeAvailable(settings, dateStr, timeStr, busyRanges) {
  const normalized = String(timeStr || '').substring(0, 5);
  if (!/^\d{2}:\d{2}$/.test(normalized)) return false;

  if (isJerusalemDateUnavailable(settings, dateStr)) return false;

  const window = resolveBookingWindow(settings);
  const t = parseTimeToMinutes(normalized);
  const startMin = parseTimeToMinutes(window.start);
  const lastStartMin = parseTimeToMinutes(window.lastStart);
  const duration = settings.duration_minutes || 30;
  const buffer = settings.buffer_minutes || 0;
  const minNoticeHours = settings.min_notice_hours || 24;

  if (t < startMin || t > lastStartMin) return false;
  if (slotOverlaps(t, duration, buffer, busyRanges)) return false;

  const slotDt = jerusalemDateTimeFromWall(dateStr, normalized);
  if (!slotDt) return false;
  const minNotice = DateTime.now().setZone(BUSINESS_TZ).plus({ hours: minNoticeHours });
  if (slotDt < minNotice) return false;

  return true;
}

function getJerusalemJsDayOfWeek(dateStr) {
  const dt = DateTime.fromISO(`${dateStr}T12:00:00`, { zone: BUSINESS_TZ });
  if (!dt.isValid) return 0;
  return dt.weekday === 7 ? 0 : dt.weekday;
}

async function generateJerusalemSlotsForDate(settings, jerusalemDateStr) {
  if (isJerusalemDateUnavailable(settings, jerusalemDateStr)) return [];

  const jsDow = getJerusalemJsDayOfWeek(jerusalemDateStr);
  if (!settings.days_of_week?.includes(jsDow)) return [];

  const maxDays = settings.max_days_ahead || 60;
  const maxDate = DateTime.now().setZone(BUSINESS_TZ).plus({ days: maxDays }).endOf('day');
  const selected = DateTime.fromISO(`${jerusalemDateStr}T00:00:00`, { zone: BUSINESS_TZ });
  if (!selected.isValid || selected > maxDate) return [];

  const busyRanges = await fetchBusyRanges(settings, jerusalemDateStr);
  const window = resolveBookingWindow(settings);
  const startMin = parseTimeToMinutes(window.start);
  const lastStartMin = parseTimeToMinutes(window.lastStart);
  const duration = settings.duration_minutes || 30;
  const buffer = settings.buffer_minutes || 0;
  const minNoticeHours = settings.min_notice_hours || 24;
  const slots = [];

  const rule = settings.active_category_rule;
  let categoryHourCounts = null;
  if (rule?.max_meetings_per_hour && rule.main_category_ids?.length) {
    categoryHourCounts = await fetchCategoryHourlyMeetingCounts(
      jerusalemDateStr,
      rule.main_category_ids,
    );
  }

  for (let t = startMin; t <= lastStartMin; t += 1) {
    if (slotOverlaps(t, duration, buffer, busyRanges)) continue;
    const timeStr = minutesToTime(t);
    if (
      categoryHourCounts &&
      isCategoryHourCapReached(rule.max_meetings_per_hour, categoryHourCounts, timeStr)
    ) {
      continue;
    }
    const slotDt = jerusalemDateTimeFromWall(jerusalemDateStr, timeStr);
    if (!slotDt) continue;
    const minNotice = DateTime.now().setZone(BUSINESS_TZ).plus({ hours: minNoticeHours });
    if (slotDt < minNotice) continue;
    slots.push({ date: jerusalemDateStr, time: timeStr });
  }

  return slots;
}

async function fetchBusyRanges(settings, dateStr) {
  const ranges = [];
  const hostName = settings.meeting_manager;
  const hostEmployeeId = settings.host_employee_id;

  const meetingQuery = supabase
    .from('meetings')
    .select('meeting_time, meeting_date, meeting_manager, helper, status')
    .eq('meeting_date', dateStr)
    .or('status.is.null,status.neq.canceled');

  const { data: meetings } = await meetingQuery;
  const duration = settings.duration_minutes || 30;

  for (const meeting of meetings || []) {
    const isHost =
      (hostName && (meeting.meeting_manager === hostName || meeting.helper === hostName)) ||
      false;
    if (!isHost && hostEmployeeId) continue;
    if (!isHost && !hostEmployeeId) continue;

    const startMin = parseTimeToMinutes(meeting.meeting_time);
    ranges.push({ start: startMin, end: startMin + duration });
  }

  if (hostEmployeeId) {
    const { data: employee } = await supabase
      .from('tenants_employee')
      .select('display_name, unavailable_times, unavailable_ranges')
      .eq('id', hostEmployeeId)
      .maybeSingle();

    if (employee?.unavailable_times) {
      for (const block of employee.unavailable_times) {
        if (block.date === dateStr && block.startTime && block.endTime) {
          ranges.push({
            start: parseTimeToMinutes(block.startTime),
            end: parseTimeToMinutes(block.endTime),
          });
        }
      }
    }

    if (employee?.unavailable_ranges) {
      for (const range of employee.unavailable_ranges) {
        if (dateStr >= range.startDate && dateStr <= range.endDate) {
          ranges.push({
            start: parseTimeToMinutes('00:00'),
            end: parseTimeToMinutes('23:59'),
          });
        }
      }
    }
  }

  return ranges;
}

async function getAvailableSlots(token, dateStr, clientTimezone) {
  const settings = await getBookingContext(token);
  const businessTz = settings.timezone || BUSINESS_TZ;
  const clientTz = isValidIanaTimezone(clientTimezone) ? clientTimezone : businessTz;

  if (!dateStr) {
    return { slots: [], timezone: clientTz, business_timezone: BUSINESS_TZ };
  }

  if (clientTz === BUSINESS_TZ || clientTz === businessTz) {
    const jerusalemSlots = await generateJerusalemSlotsForDate(settings, dateStr);
    return {
      slots: jerusalemSlots.map((s) => s.time),
      timezone: BUSINESS_TZ,
      business_timezone: BUSINESS_TZ,
    };
  }

  const clientDate = dateStr;
  const jerusalemDates = [
    addDaysToDateKey(clientDate, -1),
    clientDate,
    addDaysToDateKey(clientDate, 1),
  ];

  const clientSlotSet = new Set();
  for (const jDate of jerusalemDates) {
    const jerusalemSlots = await generateJerusalemSlotsForDate(settings, jDate);
    for (const slot of jerusalemSlots) {
      const local = jerusalemToClientLocal(slot.date, slot.time, clientTz);
      if (!local || local.date !== clientDate) continue;
      clientSlotSet.add(local.time);
    }
  }

  const slots = Array.from(clientSlotSet).sort();
  return {
    slots,
    timezone: clientTz,
    business_timezone: BUSINESS_TZ,
  };
}

async function createSharedCalendarEvent(accessToken, params) {
  const calendarEmail = calendarMailbox(params.calendarType);
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(calendarEmail)}/calendar/events`;
  const teamsMeeting = params.isTeams || params.location === 'Teams';
  const locationDisplay = teamsMeeting
    ? 'Microsoft Teams Meeting'
    : params.location || undefined;

  const body = {
    subject: params.subject,
    start: { dateTime: params.startDateTime, timeZone: params.timeZone || 'Asia/Jerusalem' },
    end: { dateTime: params.endDateTime, timeZone: params.timeZone || 'Asia/Jerusalem' },
    location: locationDisplay ? { displayName: locationDisplay } : undefined,
    body: {
      contentType: 'HTML',
      content: params.description || '',
    },
  };

  if (params.attendeeEmail && params.sendCalendarInvite) {
    body.attendees = [
      {
        emailAddress: {
          address: params.attendeeEmail,
          name: params.attendeeName || params.attendeeEmail,
        },
        type: 'required',
      },
    ];
  }

  if (teamsMeeting) {
    body.isOnlineMeeting = true;
    body.onlineMeetingProvider = 'teamsForBusiness';
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error?.error?.message || 'Failed to create calendar event');
  }

  const data = await response.json();
  let joinUrl = data.onlineMeeting?.joinUrl || data.webLink || '';
  if (teamsMeeting && !joinUrl && data.id) {
    joinUrl = await fetchEventJoinUrl(accessToken, params.calendarType, data.id);
  }

  return {
    id: data.id,
    joinUrl,
  };
}

async function addAttendeeToSharedCalendarEvent(accessToken, calendarType, eventId, params) {
  if (!eventId) {
    throw new Error('Calendar event id is required to send an Outlook invite');
  }

  const calendarEmail = calendarMailbox(calendarType);
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(calendarEmail)}/calendar/events/${encodeURIComponent(eventId)}`;

  const patch = {
    attendees: [
      {
        emailAddress: {
          address: params.attendeeEmail,
          name: params.attendeeName || params.attendeeEmail,
        },
        type: 'required',
      },
    ],
  };

  if (params.description) {
    patch.body = { contentType: 'HTML', content: params.description };
  }

  if (params.location) {
    patch.location = { displayName: params.location };
  }

  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(patch),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error?.error?.message || 'Failed to send Outlook calendar invite');
  }

  return response.json().catch(() => ({}));
}

async function sendGraphEmail(accessToken, { to, subject, html, fromMailbox, attachments = [] }) {
  const sendUrl = fromMailbox
    ? `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(fromMailbox)}/sendMail`
    : 'https://graph.microsoft.com/v1.0/me/sendMail';

  const graphAttachments = attachments
    .filter((item) => item && item.contentBytes)
    .map((item) => ({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: item.name || 'attachment',
      contentType: item.contentType || 'application/octet-stream',
      contentBytes: item.contentBytes,
    }));

  const response = await fetch(sendUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: 'HTML', content: html },
        toRecipients: [{ emailAddress: { address: to } }],
        ...(graphAttachments.length ? { attachments: graphAttachments } : {}),
      },
      saveToSentItems: true,
    }),
  });

  if (!response.ok && response.status !== 202) {
    const text = await response.text();
    throw new Error(`Failed to send email: ${text}`);
  }
}

async function buildBookingEmailTemplateVars({
  contact,
  formattedDate,
  formattedTimeIsrael,
  dualTimeDisplay,
  locationName,
  teamsUrl,
  preferEnglish,
}) {
  const locationDisplay = await resolveBookingLocationDisplay(locationName, preferEnglish);
  const name = contact?.name || 'Valued Client';
  const timeIsrael = formattedTimeIsrael || '';
  const link = String(teamsUrl || '').trim();

  return {
    name,
    client_name: name,
    contact_name: name,
    date: formattedDate,
    meeting_date: formattedDate,
    time: timeIsrael,
    meeting_time: dualTimeDisplay || timeIsrael,
    location: locationName || '',
    meeting_location: locationDisplay || locationName || '',
    address: locationDisplay || '',
    link,
    meeting_link: link,
  };
}

async function resolveLanguageIsHebrew(languageId) {
  if (!languageId) return false;
  const { data } = await supabase
    .from('misc_language')
    .select('name')
    .eq('id', languageId)
    .maybeSingle();
  const name = String(data?.name || '').toLowerCase();
  return name.includes('hebrew') || name.includes('עברית') || name === 'he';
}

async function sendBookingNotifications({
  settings,
  lead,
  contact,
  meeting,
  teamsUrl,
  graphAuth,
  durationMinutes,
  calendarEventId,
  calendarType,
}) {
  const warnings = [];
  const graphToken = graphAuth?.accessToken;
  const mailboxUserId = graphAuth?.userId || null;
  const locationName = meeting.meeting_location || settings.meeting_location || 'Office';
  const invitationType = inferInvitationType(locationName);
  const isHebrew = await resolveLanguageIsHebrew(lead.language_id);
  const templateId = INVITATION_TEMPLATE_IDS[invitationType][isHebrew ? 'he' : 'en'];

  const [year, month, day] = meeting.meeting_date.split('-');
  const formattedDate = `${day}/${month}/${year}`;
  const formattedTime = meeting.meeting_time?.substring(0, 5) || '';
  const clientTz = meeting.client_booking_timezone || BUSINESS_TZ;
  const dualTimeDisplay = formatDualBookingTime(
    meeting.meeting_date,
    formattedTime,
    clientTz,
  );
  const endTime = minutesToTime(
    parseTimeToMinutes(formattedTime) + (durationMinutes || settings.duration_minutes || 30),
  );
  const resolvedCalendarType =
    calendarType || (settings.calendar_type === 'active_client' ? 'active_client' : 'potential_client');
  const fromMailbox =
    process.env.BOOKING_FROM_MAILBOX ||
    calendarMailbox(resolvedCalendarType);

  if (settings.send_email && contact.email) {
    try {
      if (!graphToken) {
        throw new Error('No Microsoft Graph mailbox connected for sending email');
      }

      const { data: template } = await supabase
        .from('misc_emailtemplate')
        .select('name, content')
        .eq('id', templateId)
        .maybeSingle();

      const subject =
        template?.name || `Meeting with Decker, Pex, Levi Lawoffice - ${formattedDate}`;

      const templateVars = await buildBookingEmailTemplateVars({
        contact,
        formattedDate,
        formattedTimeIsrael: formattedTime,
        dualTimeDisplay,
        locationName,
        teamsUrl,
        preferEnglish: !isHebrew,
      });

      const html = template?.content
        ? formatPlainEmailHtml(
            fillEmailTemplateParams(parseEmailTemplateContent(template.content), templateVars),
          )
        : `<p>Dear ${contact.name || 'Valued Client'},</p>
           <p>Your meeting is confirmed for ${formattedDate} at ${dualTimeDisplay || formattedTime}.</p>
           <p>Location: ${locationName}</p>
           ${teamsUrl ? `<p><a href="${teamsUrl}">Join meeting</a></p>` : ''}`;

      const recipient = String(contact.email || '').trim();
      if (!recipient) throw new Error('No email address on contact');

      const sendCalendarInvite = settings.send_calendar_invite !== false;
      const useOutlookInvite = sendCalendarInvite && isMicrosoftEmail(recipient);
      const calendarSubject = 'Meeting with Decker, Pex, Levi Lawoffice';
      const calendarLocationDisplay = isTeamsLocation(locationName)
        ? 'Microsoft Teams Meeting'
        : templateVars.meeting_location || locationName;

      if (useOutlookInvite) {
        if (calendarEventId) {
          await addAttendeeToSharedCalendarEvent(graphToken, resolvedCalendarType, calendarEventId, {
            attendeeEmail: recipient,
            attendeeName: contact.name,
            description: html,
            location: calendarLocationDisplay,
          });
        } else {
          await createSharedCalendarEvent(graphToken, {
            calendarType: resolvedCalendarType,
            subject: calendarSubject,
            startDateTime: `${meeting.meeting_date}T${formattedTime}:00`,
            endDateTime: `${meeting.meeting_date}T${endTime}:00`,
            location: calendarLocationDisplay,
            description: html,
            attendeeEmail: recipient,
            attendeeName: contact.name,
            sendCalendarInvite: true,
            timeZone: settings.timezone || BUSINESS_TZ,
            isTeams: isTeamsLocation(locationName),
          });
        }
      } else {
        const attachments = [];
        if (sendCalendarInvite) {
          try {
            const icsContent = generateICSFromDateTime({
              subject: calendarSubject,
              date: meeting.meeting_date,
              time: formattedTime,
              durationMinutes: durationMinutes || settings.duration_minutes || 30,
              location: calendarLocationDisplay,
              description: stripHtmlForIcs(html),
              organizerEmail: fromMailbox,
              attendeeEmail: recipient,
              attendeeName: contact.name,
              teamsJoinUrl: teamsUrl || '',
              timeZone: settings.timezone || BUSINESS_TZ,
            });
            attachments.push(buildIcsEmailAttachment(icsContent));
          } catch (icsErr) {
            console.error('Booking ICS generation failed:', icsErr);
            warnings.push(`Calendar invite file: ${icsErr.message}`);
          }
        }

        if (mailboxUserId) {
          await graphMailboxSyncService.sendEmail(mailboxUserId, {
            to: [recipient],
            subject,
            bodyHtml: html,
            attachments,
          });
        } else {
          await sendGraphEmail(graphToken, {
            to: recipient,
            subject,
            html,
            fromMailbox,
            attachments,
          });
        }
      }
    } catch (err) {
      console.error('Booking email failed:', err);
      const hint = isRaopAppOnlyError(err.message)
        ? ' Connect a staff mailbox via BOOKING_MAILBOX_USER_ID (app-only Graph is blocked by your tenant).'
        : '';
      warnings.push(`Email: ${err.message}${hint}`);
    }
  }

  if (settings.send_whatsapp && (contact.mobile || contact.phone)) {
    try {
      const phone = (contact.mobile || contact.phone || '').trim();
      if (!phone) throw new Error('No phone number on contact');

      const { data: templates, error: templateError } = await supabase
        .from('whatsapp_templates_v2')
        .select('id, name, language, content, params')
        .in('name', ['reminder_of_a_meeting', 'reminder_of_external_meeting']);

      if (templateError) throw templateError;

      const lang = isHebrew ? 'he' : 'en';
      const template =
        templates?.find((t) => t.name === 'reminder_of_a_meeting' && String(t.language).startsWith(lang)) ||
        templates?.find((t) => String(t.language).startsWith(lang)) ||
        templates?.[0];

      if (!template) throw new Error(`WhatsApp template not found for language ${lang}`);

      const leadId = lead.is_legacy
        ? `legacy_${settings.legacy_lead_id}`
        : settings.new_lead_id;

      const templateParameters = await buildBookingWhatsAppTemplateParameters(template, {
        formattedDate,
        formattedTime: dualTimeDisplay || formattedTime,
        locationName,
        teamsUrl: teamsUrl || meeting.teams_meeting_url || '',
        hostEmployeeId: settings.host_employee_id,
        contactName: contact.name || '',
        preferEnglish: !isHebrew,
      });

      const filledContent = fillWhatsAppTemplateContent(template.content || '', templateParameters);

      await invokeExpressHandler(whatsappController.sendMessage, {
        leadId,
        phoneNumber: phone,
        sender_name: settings.meeting_manager || 'Law Office',
        isTemplate: true,
        templateId: template.id,
        templateName: template.name,
        templateLanguage: template.language || lang,
        contactId: contact.id,
        templateParameters,
        message: filledContent || template.content || 'Meeting confirmation',
      });
    } catch (err) {
      console.error('Booking WhatsApp failed:', err);
      warnings.push(`WhatsApp: ${err.message}`);
    }
  }

  return warnings;
}

async function bookMeeting(token, payload) {
  const settings = await getBookingContext(token);
  const {
    date,
    time,
    contact_id: contactId,
    notes,
    meeting_location: meetingLocationRaw,
    client_timezone: clientTimezone,
  } = payload;

  if (!date || !time || !contactId) {
    throw new Error('Date, time, and contact are required');
  }

  const locationName = resolveClientBookingLocation(meetingLocationRaw);
  const clientTz = isValidIanaTimezone(clientTimezone) ? clientTimezone : BUSINESS_TZ;

  let jerusalemDate = date;
  let jerusalemTime = normalizeTime(time);
  if (!jerusalemTime) {
    throw new Error('Invalid time');
  }

  if (clientTz !== BUSINESS_TZ) {
    const converted = clientLocalToJerusalem(date, time, clientTz);
    if (!converted) throw new Error('Invalid date or time');
    jerusalemDate = converted.date;
    jerusalemTime = converted.time;
  }

  const busyRanges = await fetchBusyRanges(settings, jerusalemDate);
  await assertCategoryHourlyCapacity(settings, jerusalemDate, jerusalemTime);
  if (!isBookingTimeAvailable(settings, jerusalemDate, jerusalemTime, busyRanges)) {
    throw new Error('Selected time is no longer available');
  }

  const config = await getPublicConfig(token);
  const contacts = config.contacts || [];
  const contact = contacts.find((c) => Number(c.id) === Number(contactId));
  if (!contact) throw new Error('Contact not found for this lead');

  const isLegacy = Boolean(settings.legacy_lead_id);
  const leadNumber = config.lead?.lead_number;
  const displayName = config.lead?.display_name || contact.name;
  const category = config.lead?.category || 'Meeting';

  let teamsMeetingUrl = '';
  let calendarEventId = null;
  const notificationWarnings = [];
  let graphAuth;
  try {
    graphAuth = await getGraphAccessToken(settings.host_employee_id);
  } catch (authErr) {
    console.error('Graph auth failed for client booking:', authErr.message);
    notificationWarnings.push(`Microsoft Graph: ${authErr.message}`);
    graphAuth = { accessToken: null, userId: null, authMode: null };
  }

  const graphToken = graphAuth.accessToken;

  const meetingSubject = `[#${leadNumber}] ${displayName} - ${category} - Meeting (Client booked)`;
  const startIso = `${jerusalemDate}T${jerusalemTime}:00`;
  const durationMinutes = settings.duration_minutes || 30;
  const endMinutes = parseTimeToMinutes(jerusalemTime) + durationMinutes;
  const endTime = minutesToTime(endMinutes);
  const endIso = `${jerusalemDate}T${endTime}:00`;
  const calendarType = settings.calendar_type === 'active_client' ? 'active_client' : 'potential_client';

  try {
    if (!graphToken) {
      throw new Error(
        'No connected mailbox for calendar sync. Set BOOKING_MAILBOX_USER_ID or connect the meeting manager mailbox.',
      );
    }
    const calendarResult = await createSharedCalendarEvent(graphToken, {
      calendarType,
      subject: meetingSubject,
      startDateTime: startIso,
      endDateTime: endIso,
      location: locationName,
      description: notes
        ? `<p>${notes}</p><p>Booked via client scheduling link</p>`
        : '<p>Booked via client scheduling link</p>',
      timeZone: settings.timezone,
      isTeams: isTeamsLocation(locationName),
      sendCalendarInvite: false,
    });
    calendarEventId = calendarResult.id;
    teamsMeetingUrl = isTeamsLocation(locationName) ? calendarResult.joinUrl || '' : '';
    if (isTeamsLocation(locationName) && !teamsMeetingUrl && calendarEventId) {
      teamsMeetingUrl = await fetchEventJoinUrl(graphToken, calendarType, calendarEventId);
    }
  } catch (err) {
    console.error('Calendar sync failed for client booking:', err.message);
    const hint = isRaopAppOnlyError(err.message)
      ? ' Your tenant blocks app-only Graph access — connect a staff mailbox (BOOKING_MAILBOX_USER_ID).'
      : '';
    notificationWarnings.push(`Teams calendar: ${err.message}${hint}`);
  }

  const meetingRow = {
    meeting_date: jerusalemDate,
    meeting_time: `${jerusalemTime}:00`,
    meeting_location: locationName,
    meeting_manager: settings.meeting_manager || '',
    meeting_subject: meetingSubject,
    meeting_brief: notes || 'Client self-scheduled via booking link',
    teams_meeting_url: teamsMeetingUrl,
    helper: '---',
    expert: '---',
    scheduler: 'Client booking',
    calendar_type: settings.calendar_type === 'active_client' ? 'active_client' : 'potential_client',
    status: 'scheduled',
  };

  if (isValidIanaTimezone(clientTimezone)) {
    meetingRow.client_booking_timezone = clientTimezone;
  }

  if (isLegacy) {
    meetingRow.legacy_lead_id = Number(settings.legacy_lead_id);
  } else {
    meetingRow.client_id = settings.new_lead_id;
  }

  const { data: inserted, error: insertError } = await supabase
    .from('meetings')
    .insert([meetingRow])
    .select('*')
    .single();

  if (insertError) throw insertError;

  try {
    const notifyWarnings = await sendBookingNotifications({
      settings,
      lead: { ...config.lead, is_legacy: isLegacy, language_id: config.lead?.language_id },
      contact,
      meeting: inserted,
      teamsUrl: teamsMeetingUrl,
      graphAuth,
      durationMinutes,
      calendarEventId,
      calendarType,
    });
    notificationWarnings.push(...notifyWarnings);
  } catch (notifyErr) {
    console.error('Booking notifications failed:', notifyErr);
    notificationWarnings.push(notifyErr.message);
  }

  return {
    ok: true,
    meeting: {
      id: inserted.id,
      date: inserted.meeting_date,
      time: inserted.meeting_time,
      location: inserted.meeting_location,
      teams_meeting_url: teamsMeetingUrl,
      subject: inserted.meeting_subject,
    },
    scheduled_meetings: await getScheduledMeetings(token),
    warnings: notificationWarnings.length > 0 ? notificationWarnings : undefined,
  };
}

function mergeLeadSettingsWithGlobal(leadRow, globalRow) {
  const defaults = {
    duration_minutes: 30,
    meeting_location: 'Teams',
    calendar_type: 'potential_client',
    buffer_minutes: 0,
    min_notice_hours: 24,
    max_days_ahead: 60,
    slot_interval_minutes: 30,
    business_hours_start: '09:00',
    business_hours_end: '21:00',
    days_of_week: [0, 1, 2, 3, 4],
    send_email: true,
    send_whatsapp: true,
    send_calendar_invite: true,
    timezone: BUSINESS_TZ,
  };

  const global = globalRow || defaults;
  const lead = leadRow || {};

  return {
    ...lead,
    new_lead_id: lead.new_lead_id ?? null,
    legacy_lead_id: lead.legacy_lead_id ?? null,
    title: global.title || defaults.title || 'Schedule a meeting',
    description: global.description ?? null,
    duration_minutes: global.duration_minutes ?? defaults.duration_minutes,
    meeting_location: global.meeting_location || defaults.meeting_location,
    meeting_location_id: global.meeting_location_id ?? null,
    host_employee_id: global.host_employee_id ?? null,
    meeting_manager: global.meeting_manager || '',
    calendar_type: global.calendar_type || defaults.calendar_type,
    buffer_minutes: global.buffer_minutes ?? defaults.buffer_minutes,
    min_notice_hours: global.min_notice_hours ?? defaults.min_notice_hours,
    max_days_ahead: global.max_days_ahead ?? defaults.max_days_ahead,
    slot_interval_minutes: global.slot_interval_minutes ?? defaults.slot_interval_minutes,
    business_hours_start: global.business_hours_start || defaults.business_hours_start,
    business_hours_end: global.business_hours_end || defaults.business_hours_end,
    days_of_week: global.days_of_week || defaults.days_of_week,
    send_email: global.send_email ?? defaults.send_email,
    send_whatsapp: global.send_whatsapp ?? defaults.send_whatsapp,
    send_calendar_invite: global.send_calendar_invite ?? defaults.send_calendar_invite,
    timezone: global.timezone || defaults.timezone,
  };
}

async function resolveLeadByRef(leadRef) {
  const ref = String(leadRef || '').trim();
  if (!ref) throw new Error('lead_ref is required');

  const { data, error } = await supabase.rpc('_portal_resolve_lead_ref', { p_lead_ref: ref });
  if (error) throw error;
  if (!data) throw new Error(`Lead not found for reference: ${ref}`);
  return data;
}

async function lookupTimezoneFromCountry(countryIsoCode) {
  const iso = String(countryIsoCode || '').trim().toUpperCase();
  if (!iso || iso.length !== 2) return null;

  const { data, error } = await supabase
    .from('misc_country')
    .select('timezone, iso_code, name')
    .eq('iso_code', iso)
    .maybeSingle();

  if (error) throw error;
  if (!data?.timezone) return null;
  return isValidIanaTimezone(data.timezone) ? data.timezone : null;
}

async function loadPartnerBookingSettings(leadInfo) {
  const isLegacy = Boolean(leadInfo.is_legacy);
  const newLeadId = leadInfo.new_lead_id || null;
  const legacyLeadId = leadInfo.legacy_lead_id || null;

  let leadQuery = supabase.from('lead_meeting_booking_settings').select('*');
  if (isLegacy) {
    leadQuery = leadQuery.eq('legacy_lead_id', legacyLeadId);
  } else {
    leadQuery = leadQuery.eq('new_lead_id', newLeadId);
  }

  const [{ data: leadRow }, { data: globalRow }] = await Promise.all([
    leadQuery.maybeSingle(),
    supabase.from('meeting_booking_global_settings').select('*').eq('id', 1).maybeSingle(),
  ]);

  const merged = mergeLeadSettingsWithGlobal(
    {
      ...(leadRow || {}),
      new_lead_id: newLeadId,
      legacy_lead_id: legacyLeadId,
    },
    globalRow,
  );

  let mainCategoryId = null;
  let categoryName = 'Meeting';
  if (isLegacy) {
    const { data: leadData } = await supabase
      .from('leads_lead')
      .select('category_id, language_id')
      .eq('id', legacyLeadId)
      .maybeSingle();
    merged.language_id = leadData?.language_id ?? null;
    if (leadData?.category_id) {
      const { data: cat } = await supabase
        .from('misc_category')
        .select('name, parent_id')
        .eq('id', leadData.category_id)
        .maybeSingle();
      categoryName = cat?.name || categoryName;
      mainCategoryId = cat?.parent_id ?? null;
    }
  } else {
    const { data: leadData } = await supabase
      .from('leads')
      .select('category_id, language_id')
      .eq('id', newLeadId)
      .maybeSingle();
    merged.language_id = leadData?.language_id ?? null;
    if (leadData?.category_id) {
      const { data: cat } = await supabase
        .from('misc_category')
        .select('name, parent_id')
        .eq('id', leadData.category_id)
        .maybeSingle();
      categoryName = cat?.name || categoryName;
      mainCategoryId = cat?.parent_id ?? null;
    }
  }

  const unavailableDates = Array.isArray(globalRow?.unavailable_dates)
    ? globalRow.unavailable_dates.map((d) => String(d).substring(0, 10))
    : [];

  const settings = resolveCategoryAvailability({
    ...merged,
    main_category_id: mainCategoryId,
    category_availability_rules: globalRow?.category_availability_rules || [],
    unavailable_dates: unavailableDates,
  });

  return { settings: { ...settings, category: categoryName }, isLegacy, newLeadId, legacyLeadId };
}

async function fetchLeadContactsForPartner(isLegacy, newLeadId, legacyLeadId) {
  if (isLegacy) {
    const { data: rows } = await supabase
      .from('lead_leadcontact')
      .select('contact_id, main, leads_contact(id, name, email, mobile, phone)')
      .eq('lead_id', legacyLeadId);

    return (rows || [])
      .map((row) => ({
        id: row.leads_contact?.id,
        name: row.leads_contact?.name,
        email: row.leads_contact?.email,
        mobile: row.leads_contact?.mobile,
        phone: row.leads_contact?.phone,
        is_main: String(row.main) === 'true' || row.main === true || row.main === 1,
      }))
      .filter((c) => c.id);
  }

  const { data: linked } = await supabase
    .from('lead_leadcontact')
    .select('contact_id, main, leads_contact(id, name, email, mobile, phone)')
    .eq('newlead_id', newLeadId);

  const linkedIds = new Set((linked || []).map((r) => String(r.contact_id)));
  const contacts = (linked || []).map((row) => ({
    id: row.leads_contact?.id,
    name: row.leads_contact?.name,
    email: row.leads_contact?.email,
    mobile: row.leads_contact?.mobile,
    phone: row.leads_contact?.phone,
    is_main: String(row.main) === 'true' || row.main === true || row.main === 1,
  })).filter((c) => c.id);

  const { data: direct } = await supabase
    .from('leads_contact')
    .select('id, name, email, mobile, phone')
    .eq('newlead_id', newLeadId);

  for (const row of direct || []) {
    if (linkedIds.has(String(row.id))) continue;
    contacts.push({
      id: row.id,
      name: row.name,
      email: row.email,
      mobile: row.mobile,
      phone: row.phone,
      is_main: false,
    });
  }

  return contacts;
}

function resolvePartnerContact(contacts, { contactId, contactEmail }) {
  if (contactId != null && contactId !== '') {
    const match = contacts.find((c) => Number(c.id) === Number(contactId));
    if (!match) throw new Error('contact_id not found for this lead');
    if (!match.email && !match.mobile && !match.phone) {
      throw new Error('Selected contact has no email or phone');
    }
    return match;
  }

  if (contactEmail) {
    const normalized = String(contactEmail).trim().toLowerCase();
    const match = contacts.find((c) => String(c.email || '').trim().toLowerCase() === normalized);
    if (!match) throw new Error('contact_email not found for this lead');
    return match;
  }

  const reachable = contacts.filter((c) => c.email || c.mobile || c.phone);
  const main = reachable.find((c) => c.is_main);
  if (main) return main;
  if (reachable.length === 1) return reachable[0];
  if (reachable.length > 1) {
    throw new Error('Multiple contacts found — provide contact_id or contact_email');
  }
  throw new Error('No contacts with email or phone on file for this lead');
}

async function updateLeadToMeetingScheduled(leadInfo, schedulerName) {
  const now = new Date().toISOString();
  const stageId = 20;
  const scheduler = schedulerName || 'Partner webhook';

  if (leadInfo.is_legacy) {
    const { error } = await supabase
      .from('leads_lead')
      .update({
        stage: stageId,
        scheduler,
        stage_changed_by: scheduler,
        stage_changed_at: now,
      })
      .eq('id', leadInfo.legacy_lead_id);
    if (error) throw error;

    await supabase.from('leads_leadstage').insert({
      stage: stageId,
      date: now,
      cdate: now,
      udate: now,
      lead_id: leadInfo.legacy_lead_id,
      creator_id: null,
    });
    return;
  }

  const { error } = await supabase
    .from('leads')
    .update({
      stage: stageId,
      scheduler,
      stage_changed_by: scheduler,
      stage_changed_at: now,
    })
    .eq('id', leadInfo.new_lead_id);
  if (error) throw error;

  await supabase.from('leads_leadstage').insert({
    stage: stageId,
    date: now,
    cdate: now,
    udate: now,
    newlead_id: leadInfo.new_lead_id,
    creator_id: null,
  });
}

async function createPartnerMeeting(payload) {
  const {
    lead_ref: leadRef,
    lead_number: leadNumber,
    date,
    time,
    country,
    client_timezone: clientTimezoneRaw,
    contact_id: contactId,
    contact_email: contactEmail,
    meeting_location: meetingLocationRaw,
    notes,
    partner_name: partnerName,
    skip_availability_check: skipAvailabilityCheck,
    send_notifications: sendNotifications = true,
  } = payload;

  const resolvedLeadRef = String(leadRef || leadNumber || '').trim();
  if (!resolvedLeadRef) throw new Error('lead_ref (or lead_number) is required');
  if (!date || !time) throw new Error('date and time are required');
  if (!country && !clientTimezoneRaw) {
    throw new Error('country (ISO code) or client_timezone is required for timezone conversion');
  }

  const leadInfo = await resolveLeadByRef(resolvedLeadRef);
  const { settings, isLegacy, newLeadId, legacyLeadId } = await loadPartnerBookingSettings(leadInfo);

  let clientTimezone = isValidIanaTimezone(clientTimezoneRaw) ? clientTimezoneRaw : null;
  if (!clientTimezone && country) {
    clientTimezone = await lookupTimezoneFromCountry(country);
  }
  if (!clientTimezone) {
    throw new Error(
      `Could not resolve timezone from country "${country}". Provide client_timezone (IANA, e.g. America/New_York).`,
    );
  }

  let jerusalemDate = date;
  let jerusalemTime = normalizeTime(time);
  if (!jerusalemTime) throw new Error('Invalid time format — use HH:MM (24-hour)');

  if (clientTimezone !== BUSINESS_TZ) {
    const converted = clientLocalToJerusalem(date, time, clientTimezone);
    if (!converted) throw new Error('Invalid date or time for the provided timezone');
    jerusalemDate = converted.date;
    jerusalemTime = converted.time;
  }

  if (!skipAvailabilityCheck) {
    const busyRanges = await fetchBusyRanges(settings, jerusalemDate);
    await assertCategoryHourlyCapacity(settings, jerusalemDate, jerusalemTime);
    if (!isBookingTimeAvailable(settings, jerusalemDate, jerusalemTime, busyRanges)) {
      throw new Error('Selected time is not available');
    }
  }

  const contacts = await fetchLeadContactsForPartner(isLegacy, newLeadId, legacyLeadId);
  const contact = resolvePartnerContact(contacts, { contactId, contactEmail });

  const locationName = meetingLocationRaw
    ? resolveClientBookingLocation(meetingLocationRaw)
    : resolveClientBookingLocation(settings.meeting_location || 'Teams');

  const leadNumberDisplay = leadInfo.lead_number || resolvedLeadRef;
  const displayName = leadInfo.display_name || contact.name || 'Client';
  const category = settings.category || 'Meeting';
  const schedulerLabel = partnerName ? `Partner webhook: ${partnerName}` : 'Partner webhook';

  let teamsMeetingUrl = '';
  let calendarEventId = null;
  const notificationWarnings = [];
  let graphAuth;
  try {
    graphAuth = await getGraphAccessToken(settings.host_employee_id);
  } catch (authErr) {
    console.error('Graph auth failed for partner meeting webhook:', authErr.message);
    notificationWarnings.push(`Microsoft Graph: ${authErr.message}`);
    graphAuth = { accessToken: null, userId: null, authMode: null };
  }

  const graphToken = graphAuth.accessToken;
  const meetingSubject = `[#${leadNumberDisplay}] ${displayName} - ${category} - Meeting (Partner booked)`;
  const startIso = `${jerusalemDate}T${jerusalemTime}:00`;
  const durationMinutes = settings.duration_minutes || 30;
  const endMinutes = parseTimeToMinutes(jerusalemTime) + durationMinutes;
  const endTime = minutesToTime(endMinutes);
  const endIso = `${jerusalemDate}T${endTime}:00`;
  const calendarType = settings.calendar_type === 'active_client' ? 'active_client' : 'potential_client';

  try {
    if (!graphToken) {
      throw new Error(
        'No connected mailbox for calendar sync. Set BOOKING_MAILBOX_USER_ID or connect the meeting manager mailbox.',
      );
    }
    const calendarResult = await createSharedCalendarEvent(graphToken, {
      calendarType,
      subject: meetingSubject,
      startDateTime: startIso,
      endDateTime: endIso,
      location: locationName,
      description: notes
        ? `<p>${notes}</p><p>Booked via partner webhook</p>`
        : '<p>Booked via partner webhook</p>',
      timeZone: settings.timezone,
      isTeams: isTeamsLocation(locationName),
      sendCalendarInvite: false,
    });
    calendarEventId = calendarResult.id;
    teamsMeetingUrl = isTeamsLocation(locationName) ? calendarResult.joinUrl || '' : '';
    if (isTeamsLocation(locationName) && !teamsMeetingUrl && calendarEventId) {
      teamsMeetingUrl = await fetchEventJoinUrl(graphToken, calendarType, calendarEventId);
    }
  } catch (err) {
    console.error('Calendar sync failed for partner meeting webhook:', err.message);
    const hint = isRaopAppOnlyError(err.message)
      ? ' Your tenant blocks app-only Graph access — connect a staff mailbox (BOOKING_MAILBOX_USER_ID).'
      : '';
    notificationWarnings.push(`Teams calendar: ${err.message}${hint}`);
  }

  const meetingRow = {
    meeting_date: jerusalemDate,
    meeting_time: `${jerusalemTime}:00`,
    meeting_location: locationName,
    meeting_manager: settings.meeting_manager || '',
    meeting_subject: meetingSubject,
    meeting_brief: notes || 'Scheduled via partner webhook',
    teams_meeting_url: teamsMeetingUrl,
    helper: '---',
    expert: '---',
    scheduler: schedulerLabel,
    calendar_type: calendarType,
    status: 'scheduled',
    client_booking_timezone: clientTimezone,
  };

  if (isLegacy) {
    meetingRow.legacy_lead_id = Number(legacyLeadId);
  } else {
    meetingRow.client_id = newLeadId;
  }

  const { data: inserted, error: insertError } = await supabase
    .from('meetings')
    .insert([meetingRow])
    .select('*')
    .single();

  if (insertError) throw insertError;

  try {
    await updateLeadToMeetingScheduled(leadInfo, schedulerLabel);
  } catch (stageErr) {
    console.error('Partner meeting stage update failed:', stageErr);
    notificationWarnings.push(`Lead stage: ${stageErr.message}`);
  }

  if (sendNotifications !== false) {
    try {
      const notifyWarnings = await sendBookingNotifications({
        settings,
        lead: {
          lead_number: leadNumberDisplay,
          display_name: displayName,
          is_legacy: isLegacy,
          language_id: settings.language_id,
        },
        contact,
        meeting: inserted,
        teamsUrl: teamsMeetingUrl,
        graphAuth,
        durationMinutes,
        calendarEventId,
        calendarType,
      });
      notificationWarnings.push(...notifyWarnings);
    } catch (notifyErr) {
      console.error('Partner meeting notifications failed:', notifyErr);
      notificationWarnings.push(notifyErr.message);
    }
  }

  return {
    ok: true,
    meeting: {
      id: inserted.id,
      date: inserted.meeting_date,
      time: inserted.meeting_time,
      location: inserted.meeting_location,
      teams_meeting_url: teamsMeetingUrl,
      subject: inserted.meeting_subject,
      client_timezone: clientTimezone,
      israel_date: jerusalemDate,
      israel_time: `${jerusalemTime}:00`,
    },
    lead: {
      lead_ref: leadNumberDisplay,
      display_name: displayName,
      is_legacy: isLegacy,
    },
    warnings: notificationWarnings.length > 0 ? notificationWarnings : undefined,
  };
}

module.exports = {
  getPublicConfig,
  getAvailableSlots,
  getScheduledMeetings,
  bookMeeting,
  createPartnerMeeting,
};
