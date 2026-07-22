/**
 * Entry kiosk: resolve meeting-aware clock-in/out adjustments (Asia/Jerusalem).
 * Used by POST /api/clock-in-kiosk/meeting-clock-adjustment and welcome flash meetings.
 */

const supabase = require('../config/supabase');

const DEFAULT_DURATION_MINUTES = 60;
const JERUSALEM_TZ = 'Asia/Jerusalem';

function normalizeEmployeeId(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

function normalizeAction(raw) {
  return String(raw || '').trim().toLowerCase() === 'out' ? 'out' : 'in';
}

function todayIsoJerusalem(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: JERUSALEM_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function nowMinutesJerusalem(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: JERUSALEM_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return 0;
  return hour * 60 + minute;
}

function parseMeetingTimeMinutes(raw) {
  if (!raw) return null;
  const parts = String(raw).split(':');
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function meetingDurationMinutes(row) {
  const n = Number(row?.duration);
  if (Number.isFinite(n) && n > 0) return Math.round(n);
  return DEFAULT_DURATION_MINUTES;
}

function isCanceledStatus(status) {
  const s = String(status || '').trim().toLowerCase();
  return s === 'canceled' || s === 'cancelled';
}

function isVirtualLocation(location) {
  const s = String(location || '').toLowerCase();
  return /teams|zoom|video|online|virtual|phone|call|google meet|meet\b/.test(s);
}

function nameMatches(field, names) {
  if (!field || !names.length) return false;
  const normalized = String(field).trim().toLowerCase();
  if (!normalized) return false;
  if (names.some((n) => n === normalized)) return true;
  return names.some((n) => n.length >= 3 && (normalized.includes(n) || n.includes(normalized)));
}

function fieldMatchesEmployee(field, names, employeeId) {
  if (field == null || field === '') return false;
  const raw = String(field).trim();
  if (!raw) return false;
  if (String(employeeId) === raw) return true;
  return nameMatches(raw, names);
}

/**
 * Build an ISO timestamp for today (Jerusalem calendar date) at startMinutes + offsetMinutes.
 */
function jerusalemTodayAtMinutesToIso(startMinutes, offsetMinutes = 0) {
  const total = startMinutes + offsetMinutes;
  const dayOffset = Math.floor(total / (24 * 60));
  const minsInDay = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const hours = Math.floor(minsInDay / 60);
  const minutes = minsInDay % 60;

  const today = todayIsoJerusalem();
  const [y, m, d] = today.split('-').map(Number);

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: JERUSALEM_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  // Start from a UTC guess for that calendar day wall clock, then correct for TZ/DST.
  let candidate = new Date(Date.UTC(y, m - 1, d + dayOffset, hours, minutes, 0));
  for (let i = 0; i < 4; i += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(candidate).map((p) => [p.type, p.value]),
    );
    const localY = Number(parts.year);
    const localM = Number(parts.month);
    const localD = Number(parts.day);
    const localH = Number(parts.hour === '24' ? '0' : parts.hour);
    const localMin = Number(parts.minute);
    const localAsUtc = Date.UTC(localY, localM - 1, localD, localH, localMin, 0);
    const wantAsUtc = Date.UTC(y, m - 1, d + dayOffset, hours, minutes, 0);
    const delta = wantAsUtc - localAsUtc;
    if (delta === 0) break;
    candidate = new Date(candidate.getTime() + delta);
  }
  return candidate.toISOString();
}

function buildRemark(action, meeting) {
  const isStaff = meeting.calendar_type === 'staff';
  const location = String(meeting.meeting_location || '').trim() || 'the office';
  const clientName = String(meeting.clientName || '').trim() || 'your meeting';

  if (action === 'in') {
    if (isStaff) {
      return `Hope you had a great meeting at ${location}.`;
    }
    return `Hope you had a great meeting with ${clientName}.`;
  }

  if (isStaff) {
    return `Good luck in ${location}.`;
  }
  return `Good luck at meeting with ${clientName}.`;
}

/**
 * Load today's meetings for an employee (role fields + meeting_participants).
 */
async function loadEmployeeMeetingsTodayDetailed(employeeIdInput) {
  const employeeId = normalizeEmployeeId(employeeIdInput);
  if (!employeeId) return [];

  const { data: emp, error: empError } = await supabase
    .from('tenants_employee')
    .select('id, display_name, official_name')
    .eq('id', employeeId)
    .maybeSingle();

  if (empError) throw empError;
  if (!emp) return [];

  const names = [emp.display_name, emp.official_name]
    .map((n) => String(n || '').trim().toLowerCase())
    .filter(Boolean);

  const today = todayIsoJerusalem();

  const { data: meetings, error: meetingsError } = await supabase
    .from('meetings')
    .select(
      'id, meeting_date, meeting_time, duration, meeting_location, meeting_manager, expert, helper, scheduler, meeting_brief, client_id, legacy_lead_id, status, calendar_type',
    )
    .eq('meeting_date', today)
    .order('meeting_time', { ascending: true });

  if (meetingsError) throw meetingsError;

  const rows = (meetings || []).filter((m) => !isCanceledStatus(m.status));
  if (rows.length === 0) return [];

  const meetingIds = rows.map((m) => m.id).filter((id) => id != null);
  const participantMeetingIds = new Set();

  if (meetingIds.length > 0) {
    const { data: participants, error: partError } = await supabase
      .from('meeting_participants')
      .select('meeting_id')
      .eq('employee_id', employeeId)
      .in('meeting_id', meetingIds);

    if (!partError) {
      for (const p of participants || []) {
        if (p.meeting_id != null) participantMeetingIds.add(Number(p.meeting_id));
      }
    }
  }

  const mine = rows.filter((m) => {
    if (participantMeetingIds.has(Number(m.id))) return true;
    return [m.meeting_manager, m.expert, m.helper, m.scheduler].some((field) =>
      fieldMatchesEmployee(field, names, employeeId),
    );
  });

  if (mine.length === 0) return [];

  const clientIds = [...new Set(mine.map((m) => m.client_id).filter(Boolean))];
  const legacyIds = [
    ...new Set(
      mine
        .map((m) => m.legacy_lead_id)
        .filter((id) => id != null && Number.isFinite(Number(id)))
        .map((id) => Number(id)),
    ),
  ];

  const clientNameById = new Map();
  const legacyNameById = new Map();

  if (clientIds.length > 0) {
    const { data: leads } = await supabase
      .from('leads')
      .select('id, name, lead_number')
      .in('id', clientIds);
    for (const lead of leads || []) {
      clientNameById.set(String(lead.id), lead.name || lead.lead_number || 'Client');
    }
  }

  if (legacyIds.length > 0) {
    const { data: legacyLeads } = await supabase
      .from('leads_lead')
      .select('id, name, manual_id')
      .in('id', legacyIds);
    for (const lead of legacyLeads || []) {
      legacyNameById.set(String(lead.id), lead.name || lead.manual_id || 'Client');
    }
  }

  return mine
    .map((m) => {
      const startMinutes = parseMeetingTimeMinutes(m.meeting_time);
      if (startMinutes == null) return null;
      const durationMinutes = meetingDurationMinutes(m);
      let clientName = null;
      if (m.client_id) clientName = clientNameById.get(String(m.client_id)) || null;
      if (!clientName && m.legacy_lead_id != null) {
        clientName = legacyNameById.get(String(m.legacy_lead_id)) || null;
      }
      return {
        id: m.id,
        meeting_time: m.meeting_time,
        meeting_location: m.meeting_location || null,
        meeting_brief: m.meeting_brief || null,
        calendar_type: m.calendar_type || null,
        client_id: m.client_id || null,
        legacy_lead_id: m.legacy_lead_id ?? null,
        durationMinutes,
        startMinutes,
        endMinutes: startMinutes + durationMinutes,
        clientName,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.startMinutes - b.startMinutes);
}

async function loadEmployeeMeetingsTodayForWelcome(employeeId) {
  try {
    const detailed = await loadEmployeeMeetingsTodayDetailed(employeeId);
    return detailed.slice(0, 8).map((m, index) => {
      const time = m.meeting_time ? String(m.meeting_time).slice(0, 5) : null;
      const location = m.meeting_location || null;
      const title = m.clientName || m.meeting_brief || 'Meeting';
      return {
        id: m.id,
        time,
        title,
        location,
        isVirtual: isVirtualLocation(location),
        colorIndex: index % 4,
      };
    });
  } catch (err) {
    console.warn(
      '[kioskMeetingClockService] loadEmployeeMeetingsTodayForWelcome failed:',
      err?.message || err,
    );
    return [];
  }
}

function isClientSalesCalendarType(calendarType) {
  const ct = String(calendarType || '').trim();
  return ct === 'active_client' || ct === 'potential_client';
}

/**
 * @param {{ employeeId: number, action: 'in'|'out', sessionClockInAt?: string|null }} params
 */
async function resolveMeetingClockAdjustment({
  employeeId: employeeIdInput,
  action: actionInput,
  sessionClockInAt = null,
}) {
  const employeeId = normalizeEmployeeId(employeeIdInput);
  if (!employeeId) {
    const err = new Error('Missing or invalid employeeId');
    err.statusCode = 400;
    throw err;
  }

  const action = normalizeAction(actionInput);
  const nowMinutes = nowMinutesJerusalem();
  const detailed = await loadEmployeeMeetingsTodayDetailed(employeeId);

  let chosen = null;
  if (action === 'in') {
    const past = detailed.filter((m) => m.startMinutes < nowMinutes);
    chosen = past.length > 0 ? past[past.length - 1] : null;
  } else {
    chosen = detailed.find((m) => m.startMinutes >= nowMinutes) || null;
  }

  if (!chosen) {
    return { adjusted: false };
  }

  const remark = buildRemark(action, chosen);
  const meetingPayload = {
    id: chosen.id,
    calendarType: chosen.calendar_type,
    location: chosen.meeting_location,
    clientName: chosen.clientName,
    startMinutes: chosen.startMinutes,
    durationMinutes: chosen.durationMinutes,
    time: chosen.meeting_time ? String(chosen.meeting_time).slice(0, 5) : null,
  };

  // Clock-out end-time adjustment: internal/external (staff) only — not active/potential client meetings.
  if (action === 'out' && isClientSalesCalendarType(chosen.calendar_type)) {
    return {
      adjusted: false,
      remark,
      meeting: meetingPayload,
    };
  }

  let adjustedAt;
  if (action === 'in') {
    adjustedAt = jerusalemTodayAtMinutesToIso(chosen.startMinutes, 0);
  } else {
    // Clock-out at meeting end (start + duration) for internal/external meetings.
    adjustedAt = jerusalemTodayAtMinutesToIso(chosen.endMinutes, 0);
    if (sessionClockInAt) {
      const sessionInMs = new Date(sessionClockInAt).getTime();
      const outMs = new Date(adjustedAt).getTime();
      if (Number.isFinite(sessionInMs) && Number.isFinite(outMs) && outMs < sessionInMs) {
        return { adjusted: false, remark, meeting: meetingPayload };
      }
    }
  }

  return {
    adjusted: true,
    adjustedAt,
    remark,
    meeting: meetingPayload,
  };
}

module.exports = {
  DEFAULT_DURATION_MINUTES,
  normalizeEmployeeId,
  normalizeAction,
  todayIsoJerusalem,
  isClientSalesCalendarType,
  loadEmployeeMeetingsTodayDetailed,
  loadEmployeeMeetingsTodayForWelcome,
  resolveMeetingClockAdjustment,
  buildRemark,
};
