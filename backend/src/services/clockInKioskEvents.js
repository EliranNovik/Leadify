/** Clock-in flash events for entry kiosk tablets (memory + Supabase). */

const supabase = require('../config/supabase');
const kioskMeetingClockService = require('./kioskMeetingClockService');

const RECENT_MS = 12_000;
const byLocation = new Map();

function normalizeLocationId(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

function normalizeEmployeeId(raw) {
  return kioskMeetingClockService.normalizeEmployeeId(raw);
}

function sanitizeName(raw) {
  const name = String(raw || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return name || 'Employee';
}

function sanitizePhotoUrl(raw) {
  const url = String(raw || '').trim().slice(0, 500);
  if (!url) return null;
  if (/^https?:\/\//i.test(url) || url.startsWith('//') || url.startsWith('/')) {
    return url;
  }
  return null;
}

function sanitizeRemark(raw) {
  const text = String(raw || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
  return text || null;
}

async function loadEmployeeMeetingsToday(employeeId) {
  return kioskMeetingClockService.loadEmployeeMeetingsTodayForWelcome(employeeId);
}

function normalizeAction(raw) {
  return kioskMeetingClockService.normalizeAction(raw);
}

function memoryPut(event) {
  byLocation.set(event.locationId, {
    ...event,
    expiresAt: Date.now() + RECENT_MS,
  });
}

function memoryGet(locationId) {
  const event = byLocation.get(locationId);
  if (!event) return null;
  if (Date.now() > event.expiresAt) {
    byLocation.delete(locationId);
    return null;
  }
  return {
    id: event.id,
    locationId: event.locationId,
    employeeName: event.employeeName,
    photoUrl: event.photoUrl || null,
    employeeId: event.employeeId || null,
    action: event.action === 'out' ? 'out' : 'in',
    meetings: event.meetings || [],
    remark: event.remark || null,
    adjustedAt: event.adjustedAt || null,
    at: event.at,
  };
}

/**
 * Prefer flash.adjusted_at; otherwise read the real clock in/out from employee_clock_in
 * so the kiosk modal matches CRM even when adjusted_at was not persisted (older backends).
 */
async function resolveDisplayClockAt(event) {
  if (!event) return null;
  if (event.adjustedAt && !Number.isNaN(Date.parse(String(event.adjustedAt)))) {
    return new Date(event.adjustedAt).toISOString();
  }

  const employeeId = normalizeEmployeeId(event.employeeId);
  if (!employeeId) return event.at || null;

  try {
    if (event.action === 'out') {
      const { data, error } = await supabase
        .from('employee_clock_in')
        .select('clock_out_time')
        .eq('employee_id', employeeId)
        .not('clock_out_time', 'is', null)
        .order('clock_out_time', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!error && data?.clock_out_time) {
        return new Date(data.clock_out_time).toISOString();
      }
    } else {
      const { data, error } = await supabase
        .from('employee_clock_in')
        .select('clock_in_time')
        .eq('employee_id', employeeId)
        .order('clock_in_time', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!error && data?.clock_in_time) {
        return new Date(data.clock_in_time).toISOString();
      }
    }
  } catch (err) {
    console.warn('[clockInKioskEvents] resolveDisplayClockAt failed:', err?.message || err);
  }

  return event.at || null;
}

async function withResolvedDisplayTime(event) {
  if (!event) return null;
  const adjustedAt = await resolveDisplayClockAt(event);
  return {
    ...event,
    adjustedAt: adjustedAt || event.adjustedAt || null,
  };
}

/**
 * Publish a clock-in flash for tablets.
 * Writes memory (same-process) and Supabase (cross-host / multi-instance).
 */
async function announce({
  locationId: locationIdInput,
  employeeName,
  photoUrl,
  employeeId: employeeIdInput,
  action: actionInput,
  remark: remarkInput,
  adjustedAt: adjustedAtInput,
}) {
  const locationId = normalizeLocationId(locationIdInput);
  if (locationId == null) {
    const err = new Error('Missing or invalid locationId');
    err.statusCode = 400;
    throw err;
  }

  const at = new Date().toISOString();
  const employeeNameSafe = sanitizeName(employeeName);
  const photoUrlSafe = sanitizePhotoUrl(photoUrl);
  const employeeId = normalizeEmployeeId(employeeIdInput);
  const action = normalizeAction(actionInput);
  const remark = sanitizeRemark(remarkInput);
  const adjustedAt =
    adjustedAtInput && !Number.isNaN(Date.parse(String(adjustedAtInput)))
      ? new Date(adjustedAtInput).toISOString()
      : null;

  let id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    const row = {
      location_id: locationId,
      employee_name: employeeNameSafe,
      photo_url: photoUrlSafe,
      created_at: at,
      action,
    };
    if (employeeId != null) row.employee_id = employeeId;
    if (remark) row.remark = remark;
    if (adjustedAt) row.adjusted_at = adjustedAt;

    const { data, error } = await supabase
      .from('clock_in_kiosk_flash')
      .insert(row)
      .select(
        'id, location_id, employee_name, photo_url, employee_id, action, remark, adjusted_at, created_at',
      )
      .single();

    if (error) {
      console.warn('[clockInKioskEvents] supabase flash insert failed:', error.message);
      const baseRow = {
        location_id: locationId,
        employee_name: employeeNameSafe,
        photo_url: photoUrlSafe,
        created_at: at,
      };
      if (employeeId != null && !/employee_id|adjusted_at/i.test(error.message || '')) {
        baseRow.employee_id = employeeId;
      }
      if (remark && !/remark|adjusted_at/i.test(error.message || '')) {
        baseRow.remark = remark;
      }
      if (action && !/action|adjusted_at/i.test(error.message || '')) {
        baseRow.action = action;
      }
      // Retry without adjusted_at when the column is not applied yet.
      const retry = await supabase
        .from('clock_in_kiosk_flash')
        .insert(baseRow)
        .select('id, location_id, employee_name, photo_url, created_at')
        .single();
      if (!retry.error && retry.data?.id) {
        id = String(retry.data.id);
      }
    } else if (data?.id) {
      id = String(data.id);
    }
  } catch (err) {
    console.warn('[clockInKioskEvents] supabase flash insert error:', err?.message || err);
  }

  const meetings = action === 'in' ? await loadEmployeeMeetingsToday(employeeId) : [];

  const event = {
    id,
    locationId,
    employeeName: employeeNameSafe,
    photoUrl: photoUrlSafe,
    employeeId,
    action,
    meetings,
    remark,
    adjustedAt,
    at,
  };
  memoryPut(event);
  return event;
}

async function getRecent(locationIdInput) {
  const locationId = normalizeLocationId(locationIdInput);
  if (locationId == null) return null;

  const sinceIso = new Date(Date.now() - RECENT_MS).toISOString();

  try {
    const { data, error } = await supabase
      .from('clock_in_kiosk_flash')
      .select(
        'id, location_id, employee_name, photo_url, employee_id, action, remark, adjusted_at, created_at',
      )
      .eq('location_id', locationId)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && data) {
      const employeeId = normalizeEmployeeId(data.employee_id);
      const cached = memoryGet(locationId);
      const actionFromDb =
        String(data.action || '').toLowerCase() === 'out'
          ? 'out'
          : String(data.action || '').toLowerCase() === 'in'
            ? 'in'
            : null;
      const action =
        actionFromDb ||
        (cached && String(cached.id) === String(data.id) && cached.action === 'out' ? 'out' : 'in');

      let meetings = [];
      if (action === 'in') {
        if (cached && String(cached.id) === String(data.id) && Array.isArray(cached.meetings)) {
          meetings = cached.meetings;
        } else {
          meetings = await loadEmployeeMeetingsToday(employeeId);
        }
      }

      const remark =
        (data.remark && String(data.remark).trim()) ||
        (cached && String(cached.id) === String(data.id) ? cached.remark : null) ||
        null;

      const adjustedFromDb =
        data.adjusted_at && !Number.isNaN(Date.parse(String(data.adjusted_at)))
          ? new Date(data.adjusted_at).toISOString()
          : null;
      const adjustedAt =
        adjustedFromDb ||
        (cached && String(cached.id) === String(data.id) ? cached.adjustedAt || null : null);

      const event = {
        id: String(data.id),
        locationId: Number(data.location_id),
        employeeName: data.employee_name,
        photoUrl: data.photo_url || null,
        employeeId,
        action,
        meetings,
        remark,
        adjustedAt,
        at: data.created_at,
      };
      const resolved = await withResolvedDisplayTime(event);
      memoryPut(resolved);
      return resolved;
    }
    if (error) {
      if (/action|remark|employee_id|adjusted_at/i.test(error.message || '')) {
        const fallback = await supabase
          .from('clock_in_kiosk_flash')
          .select('id, location_id, employee_name, photo_url, employee_id, created_at')
          .eq('location_id', locationId)
          .gte('created_at', sinceIso)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!fallback.error && fallback.data) {
          const cached = memoryGet(locationId);
          const employeeId = normalizeEmployeeId(fallback.data.employee_id);
          const action =
            cached && String(cached.id) === String(fallback.data.id) && cached.action === 'out'
              ? 'out'
              : 'in';
          let meetings = [];
          if (action === 'in') {
            if (
              cached &&
              String(cached.id) === String(fallback.data.id) &&
              Array.isArray(cached.meetings)
            ) {
              meetings = cached.meetings;
            } else {
              meetings = await loadEmployeeMeetingsToday(employeeId);
            }
          }
          const event = {
            id: String(fallback.data.id),
            locationId: Number(fallback.data.location_id),
            employeeName: fallback.data.employee_name,
            photoUrl: fallback.data.photo_url || null,
            employeeId,
            action,
            meetings,
            remark:
              cached && String(cached.id) === String(fallback.data.id)
                ? cached.remark || null
                : null,
            adjustedAt:
              cached && String(cached.id) === String(fallback.data.id)
                ? cached.adjustedAt || null
                : null,
            at: fallback.data.created_at,
          };
          const resolved = await withResolvedDisplayTime(event);
          memoryPut(resolved);
          return resolved;
        }
      }
      console.warn('[clockInKioskEvents] supabase flash read failed:', error.message);
    }
  } catch (err) {
    console.warn('[clockInKioskEvents] supabase flash read error:', err?.message || err);
  }

  return withResolvedDisplayTime(memoryGet(locationId));
}

module.exports = {
  RECENT_MS,
  announce,
  getRecent,
  loadEmployeeMeetingsToday,
};
