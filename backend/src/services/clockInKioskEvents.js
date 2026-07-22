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

    const { data, error } = await supabase
      .from('clock_in_kiosk_flash')
      .insert(row)
      .select('id, location_id, employee_name, photo_url, employee_id, action, remark, created_at')
      .single();

    if (error) {
      console.warn('[clockInKioskEvents] supabase flash insert failed:', error.message);
      const baseRow = {
        location_id: locationId,
        employee_name: employeeNameSafe,
        photo_url: photoUrlSafe,
        created_at: at,
      };
      if (employeeId != null && !/employee_id/i.test(error.message || '')) {
        baseRow.employee_id = employeeId;
      }
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
      .select('id, location_id, employee_name, photo_url, employee_id, action, remark, created_at')
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

      const event = {
        id: String(data.id),
        locationId: Number(data.location_id),
        employeeName: data.employee_name,
        photoUrl: data.photo_url || null,
        employeeId,
        action,
        meetings,
        remark,
        adjustedAt:
          cached && String(cached.id) === String(data.id) ? cached.adjustedAt || null : null,
        at: data.created_at,
      };
      memoryPut(event);
      return event;
    }
    if (error) {
      if (/action|remark|employee_id/i.test(error.message || '')) {
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
          memoryPut(event);
          return event;
        }
      }
      console.warn('[clockInKioskEvents] supabase flash read failed:', error.message);
    }
  } catch (err) {
    console.warn('[clockInKioskEvents] supabase flash read error:', err?.message || err);
  }

  return memoryGet(locationId);
}

module.exports = {
  RECENT_MS,
  announce,
  getRecent,
  loadEmployeeMeetingsToday,
};
