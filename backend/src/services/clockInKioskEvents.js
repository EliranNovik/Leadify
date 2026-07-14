/** Clock-in flash events for entry kiosk tablets (memory + Supabase). */

const supabase = require('../config/supabase');

const RECENT_MS = 8_000;
const byLocation = new Map();

function normalizeLocationId(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
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
    at: event.at,
  };
}

/**
 * Publish a clock-in flash for tablets.
 * Writes memory (same-process) and Supabase (cross-host / multi-instance).
 */
async function announce({ locationId: locationIdInput, employeeName, photoUrl }) {
  const locationId = normalizeLocationId(locationIdInput);
  if (locationId == null) {
    const err = new Error('Missing or invalid locationId');
    err.statusCode = 400;
    throw err;
  }

  const at = new Date().toISOString();
  const employeeNameSafe = sanitizeName(employeeName);
  const photoUrlSafe = sanitizePhotoUrl(photoUrl);

  let id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    const { data, error } = await supabase
      .from('clock_in_kiosk_flash')
      .insert({
        location_id: locationId,
        employee_name: employeeNameSafe,
        photo_url: photoUrlSafe,
        created_at: at,
      })
      .select('id, location_id, employee_name, photo_url, created_at')
      .single();

    if (error) {
      // Table may not be migrated yet — still use memory for same-process tablets.
      console.warn('[clockInKioskEvents] supabase flash insert failed:', error.message);
    } else if (data?.id) {
      id = String(data.id);
    }
  } catch (err) {
    console.warn('[clockInKioskEvents] supabase flash insert error:', err?.message || err);
  }

  const event = {
    id,
    locationId,
    employeeName: employeeNameSafe,
    photoUrl: photoUrlSafe,
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
      .select('id, location_id, employee_name, photo_url, created_at')
      .eq('location_id', locationId)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && data) {
      const event = {
        id: String(data.id),
        locationId: Number(data.location_id),
        employeeName: data.employee_name,
        photoUrl: data.photo_url || null,
        at: data.created_at,
      };
      memoryPut(event);
      return event;
    }
    if (error) {
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
};
