/** Clock-in flash events for entry kiosk tablets (memory + Supabase). */

const supabase = require('../config/supabase');

const RECENT_MS = 12_000;
const byLocation = new Map();

function normalizeLocationId(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

function normalizeEmployeeId(raw) {
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

function todayIsoLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isVirtualLocation(location) {
  const s = String(location || '').toLowerCase();
  return /teams|zoom|video|online|virtual|phone|call|google meet|meet\b/.test(s);
}

function nameMatches(field, names) {
  if (!field || !names.length) return false;
  const normalized = String(field).trim().toLowerCase();
  if (!normalized) return false;
  return names.some((n) => n === normalized || normalized.includes(n) || n.includes(normalized));
}

/**
 * Today's scheduled meetings where the employee appears in a role field.
 */
async function loadEmployeeMeetingsToday(employeeId) {
  if (!employeeId) return [];

  try {
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

    if (names.length === 0) return [];

    const today = todayIsoLocal();
    const { data: meetings, error: meetingsError } = await supabase
      .from('meetings')
      .select(
        'id, meeting_time, meeting_location, meeting_manager, expert, helper, scheduler, meeting_brief, client_id, status, calendar_type',
      )
      .eq('meeting_date', today)
      .or('status.is.null,status.neq.canceled,status.neq.cancelled')
      .order('meeting_time', { ascending: true });

    if (meetingsError) throw meetingsError;

    const mine = (meetings || []).filter((m) =>
      [m.meeting_manager, m.expert, m.helper, m.scheduler, m.lawyer].some((field) =>
        nameMatches(field, names),
      ),
    );

    const clientIds = [...new Set(mine.map((m) => m.client_id).filter(Boolean))];
    const clientNameById = new Map();

    if (clientIds.length > 0) {
      const { data: leads, error: leadsError } = await supabase
        .from('leads')
        .select('id, name, lead_number')
        .in('id', clientIds);

      if (!leadsError) {
        for (const lead of leads || []) {
          clientNameById.set(String(lead.id), lead.name || lead.lead_number || 'Client');
        }
      }
    }

    return mine.slice(0, 8).map((m, index) => {
      const time = m.meeting_time ? String(m.meeting_time).slice(0, 5) : null;
      const location = m.meeting_location || null;
      const clientName = clientNameById.get(String(m.client_id)) || null;
      const title = clientName || m.meeting_brief || 'Meeting';
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
    console.warn('[clockInKioskEvents] loadEmployeeMeetingsToday failed:', err?.message || err);
    return [];
  }
}

function normalizeAction(raw) {
  return String(raw || '').trim().toLowerCase() === 'out' ? 'out' : 'in';
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

  let id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    const row = {
      location_id: locationId,
      employee_name: employeeNameSafe,
      photo_url: photoUrlSafe,
      created_at: at,
    };
    if (employeeId != null) row.employee_id = employeeId;

    const { data, error } = await supabase
      .from('clock_in_kiosk_flash')
      .insert(row)
      .select('id, location_id, employee_name, photo_url, employee_id, created_at')
      .single();

    if (error) {
      // Table may not be migrated yet — still use memory for same-process tablets.
      console.warn('[clockInKioskEvents] supabase flash insert failed:', error.message);
      if (employeeId != null && /employee_id/i.test(error.message || '')) {
        const retry = await supabase
          .from('clock_in_kiosk_flash')
          .insert({
            location_id: locationId,
            employee_name: employeeNameSafe,
            photo_url: photoUrlSafe,
            created_at: at,
          })
          .select('id, location_id, employee_name, photo_url, created_at')
          .single();
        if (!retry.error && retry.data?.id) {
          id = String(retry.data.id);
        }
      }
    } else if (data?.id) {
      id = String(data.id);
    }
  } catch (err) {
    console.warn('[clockInKioskEvents] supabase flash insert error:', err?.message || err);
  }

  // Meetings list is only useful on clock-in welcome.
  const meetings = action === 'in' ? await loadEmployeeMeetingsToday(employeeId) : [];

  const event = {
    id,
    locationId,
    employeeName: employeeNameSafe,
    photoUrl: photoUrlSafe,
    employeeId,
    action,
    meetings,
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
      .select('id, location_id, employee_name, photo_url, employee_id, created_at')
      .eq('location_id', locationId)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && data) {
      const employeeId = normalizeEmployeeId(data.employee_id);
      const cached = memoryGet(locationId);
      const action =
        cached && String(cached.id) === String(data.id) && cached.action === 'out' ? 'out' : 'in';
      let meetings = [];
      if (action === 'in') {
        if (cached && String(cached.id) === String(data.id) && Array.isArray(cached.meetings)) {
          meetings = cached.meetings;
        } else {
          meetings = await loadEmployeeMeetingsToday(employeeId);
        }
      }

      const event = {
        id: String(data.id),
        locationId: Number(data.location_id),
        employeeName: data.employee_name,
        photoUrl: data.photo_url || null,
        employeeId,
        action,
        meetings,
        at: data.created_at,
      };
      memoryPut(event);
      return event;
    }
    if (error) {
      // Older schemas without employee_id column
      if (/employee_id/i.test(error.message || '')) {
        const fallback = await supabase
          .from('clock_in_kiosk_flash')
          .select('id, location_id, employee_name, photo_url, created_at')
          .eq('location_id', locationId)
          .gte('created_at', sinceIso)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

                        if (!fallback.error && fallback.data) {
          const cached = memoryGet(locationId);
          const event = {
            id: String(fallback.data.id),
            locationId: Number(fallback.data.location_id),
            employeeName: fallback.data.employee_name,
            photoUrl: fallback.data.photo_url || null,
            employeeId: cached?.employeeId || null,
            action: cached?.action === 'out' ? 'out' : 'in',
            meetings: cached?.action === 'out' ? [] : cached?.meetings || [],
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
