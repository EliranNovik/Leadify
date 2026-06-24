const supabase = require('../config/supabase');
const graphAuthService = require('./graphAuthService');
const graphMailboxSyncService = require('./graphMailboxSyncService');
const mailboxTokenService = require('./mailboxTokenService');
const whatsappController = require('../controllers/whatsappController');
const {
  buildBookingWhatsAppTemplateParameters,
  fillWhatsAppTemplateContent,
} = require('./bookingWhatsAppParams');

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

/** Fixed booking window — not configurable per lead. */
const BOOKING_HOURS_START = '09:00';
const BOOKING_HOURS_END = '21:00';
const BOOKING_LAST_START = '20:59';

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
  return data.settings;
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

function isBookingTimeAvailable(settings, dateStr, timeStr, busyRanges, now = new Date()) {
  const normalized = String(timeStr || '').substring(0, 5);
  if (!/^\d{2}:\d{2}$/.test(normalized)) return false;

  const t = parseTimeToMinutes(normalized);
  const startMin = parseTimeToMinutes(BOOKING_HOURS_START);
  const lastStartMin = parseTimeToMinutes(BOOKING_LAST_START);
  const duration = settings.duration_minutes || 30;
  const buffer = settings.buffer_minutes || 0;
  const minNoticeMs = (settings.min_notice_hours || 24) * 60 * 60 * 1000;

  if (t < startMin || t > lastStartMin) return false;
  if (slotOverlaps(t, duration, buffer, busyRanges)) return false;

  const slotDateTime = new Date(`${dateStr}T${minutesToTime(t)}:00`);
  if (slotDateTime.getTime() < now.getTime() + minNoticeMs) return false;

  return true;
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

async function getAvailableSlots(token, dateStr) {
  const settings = await getBookingContext(token);
  const tz = settings.timezone || 'Asia/Jerusalem';
  const date = new Date(`${dateStr}T12:00:00`);
  const dayOfWeek = date.getDay();

  if (!settings.days_of_week?.includes(dayOfWeek)) {
    return { slots: [], timezone: tz };
  }

  const now = new Date();
  const minNoticeMs = (settings.min_notice_hours || 24) * 60 * 60 * 1000;
  const maxDate = new Date();
  maxDate.setDate(maxDate.getDate() + (settings.max_days_ahead || 60));
  const selectedDate = new Date(`${dateStr}T00:00:00`);

  if (selectedDate > maxDate) return { slots: [], timezone: tz };

  const startMin = parseTimeToMinutes(BOOKING_HOURS_START);
  const lastStartMin = parseTimeToMinutes(BOOKING_LAST_START);
  const interval = 1;
  const duration = settings.duration_minutes || 30;
  const buffer = settings.buffer_minutes || 0;

  const busyRanges = await fetchBusyRanges(settings, dateStr);
  const slots = [];

  for (let t = startMin; t <= lastStartMin; t += interval) {
    if (slotOverlaps(t, duration, buffer, busyRanges)) continue;

    const slotDateTime = new Date(`${dateStr}T${minutesToTime(t)}:00`);
    if (slotDateTime.getTime() < now.getTime() + minNoticeMs) continue;

    slots.push(minutesToTime(t));
  }

  return { slots, timezone: tz };
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

async function sendGraphEmail(accessToken, { to, subject, html, fromMailbox }) {
  const sendUrl = fromMailbox
    ? `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(fromMailbox)}/sendMail`
    : 'https://graph.microsoft.com/v1.0/me/sendMail';

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
      },
      saveToSentItems: true,
    }),
  });

  if (!response.ok && response.status !== 202) {
    const text = await response.text();
    throw new Error(`Failed to send email: ${text}`);
  }
}

function stripTemplateJson(raw) {
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.ops) {
      return parsed.ops.map((op) => op.insert || '').join('');
    }
  } catch {
    /* plain html/text */
  }
  return String(raw);
}

function fillSimpleTemplate(content, vars) {
  let out = content;
  Object.entries(vars).forEach(([key, value]) => {
    out = out.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'gi'), value || '');
    out = out.replace(new RegExp(`\\{${key}\\}`, 'gi'), value || '');
  });
  return out.replace(/\n/g, '<br>');
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
  const endTime = minutesToTime(
    parseTimeToMinutes(formattedTime) + (durationMinutes || settings.duration_minutes || 30),
  );
  const calendarType = settings.calendar_type === 'active_client' ? 'active_client' : 'potential_client';
  const fromMailbox =
    process.env.BOOKING_FROM_MAILBOX ||
    calendarMailbox(calendarType);

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
      const html = template?.content
        ? fillSimpleTemplate(stripTemplateJson(template.content), {
            client_name: contact.name || 'Valued Client',
            meeting_date: formattedDate,
            meeting_time: formattedTime,
            meeting_location: locationName,
            meeting_link: teamsUrl || '',
          })
        : `<p>Dear ${contact.name || 'Valued Client'},</p>
           <p>Your meeting is confirmed for ${formattedDate} at ${formattedTime}.</p>
           <p>Location: ${locationName}</p>
           ${teamsUrl ? `<p><a href="${teamsUrl}">Join meeting</a></p>` : ''}`;

      if (settings.send_calendar_invite && isMicrosoftEmail(contact.email)) {
        await createSharedCalendarEvent(graphToken, {
          calendarType,
          subject: 'Meeting with Decker, Pex, Levi Lawoffice',
          startDateTime: `${meeting.meeting_date}T${formattedTime}:00`,
          endDateTime: `${meeting.meeting_date}T${endTime}:00`,
          location: locationName,
          description: html,
          attendeeEmail: contact.email,
          attendeeName: contact.name,
          sendCalendarInvite: true,
          timeZone: settings.timezone,
          isTeams: isTeamsLocation(locationName),
        });
      } else if (mailboxUserId) {
        const recipient = String(contact.email || '').trim();
        if (!recipient) throw new Error('No email address on contact');
        await graphMailboxSyncService.sendEmail(mailboxUserId, {
          to: [recipient],
          subject,
          bodyHtml: html,
        });
      } else {
        await sendGraphEmail(graphToken, {
          to: contact.email,
          subject,
          html,
          fromMailbox,
        });
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
        formattedTime,
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
  const { date, time, contact_id: contactId, notes, meeting_location: meetingLocationRaw } = payload;

  if (!date || !time || !contactId) {
    throw new Error('Date, time, and contact are required');
  }

  const locationName = resolveClientBookingLocation(meetingLocationRaw);

  const normalizedTime = time.substring(0, 5);
  const busyRanges = await fetchBusyRanges(settings, date);
  if (!isBookingTimeAvailable(settings, date, normalizedTime, busyRanges)) {
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
  const startIso = `${date}T${normalizedTime}:00`;
  const durationMinutes = settings.duration_minutes || 30;
  const endMinutes = parseTimeToMinutes(normalizedTime) + durationMinutes;
  const endTime = minutesToTime(endMinutes);
  const endIso = `${date}T${endTime}:00`;
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
    meeting_date: date,
    meeting_time: `${normalizedTime}:00`,
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

module.exports = {
  getPublicConfig,
  getAvailableSlots,
  getScheduledMeetings,
  bookMeeting,
};
