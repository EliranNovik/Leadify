const supabase = require('../config/supabase');

const DEFAULT_LOCATION_ID = 1;

function normalizeLocationId(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LOCATION_ID;
  return Math.trunc(n);
}

function todayIsoLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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

function selectUpcomingMeetings(rows, maxCount = 4) {
  const nowMinutes = nowMinutesJerusalem();
  const meetings = (rows || [])
    .map((row) => {
      const startMinutes = parseMeetingTimeMinutes(row.meeting_time);
      if (startMinutes == null) return null;
      const duration = Number(row.meeting_duration_minutes);
      const durationMinutes = Number.isFinite(duration) && duration > 0 ? duration : 60;
      return {
        row,
        startMinutes,
        endMinutes: startMinutes + durationMinutes,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.startMinutes - b.startMinutes);

  // Current (still in progress) + not-yet-started. Exclude meetings that already ended.
  const upcoming = meetings.filter((m) => m.endMinutes > nowMinutes);
  if (upcoming.length === 0) return [];

  return upcoming.slice(0, maxCount).map((m) => ({
    entry: m,
    isCurrent: nowMinutes >= m.startMinutes && nowMinutes < m.endMinutes,
  }));
}

async function loadMeetingsToday(today) {
  const { data, error } = await supabase
    .from('meetings')
    .select(
      'id, meeting_date, meeting_time, meeting_duration_minutes, status, client_id',
    )
    .eq('meeting_date', today)
    .eq('status', 'scheduled')
    .order('meeting_time', { ascending: true });

  if (error) throw error;

  const windowEntries = selectUpcomingMeetings(data, 4);
  if (windowEntries.length === 0) return [];

  const clientIds = [
    ...new Set(windowEntries.map((w) => w.entry.row.client_id).filter(Boolean)),
  ];
  const clientInfoById = new Map();

  if (clientIds.length > 0) {
    const { data: leads, error: leadsError } = await supabase
      .from('leads')
      .select('id, name, lead_number')
      .in('id', clientIds);

    if (leadsError) throw leadsError;

    for (const lead of leads || []) {
      clientInfoById.set(String(lead.id), {
        name: lead.name || null,
        leadNumber: lead.lead_number || null,
      });
    }
  }

  return windowEntries.map(({ entry, isCurrent }) => {
    const info = clientInfoById.get(String(entry.row.client_id)) || {};
    const time = entry.row.meeting_time ? String(entry.row.meeting_time).slice(0, 5) : null;
    return {
      id: entry.row.id,
      time,
      clientName: info.name || null,
      leadNumber: info.leadNumber || null,
      isCurrent,
    };
  });
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

  const [announcements, gadgets, birthdays, meetings, weather, inOfficeCount] = await Promise.all([
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
    inOfficeCount: Number(inOfficeCount) || 0,
    weather: weather
      ? {
          ...weather,
          label: weatherCodeLabel(weather.weatherCode),
        }
      : null,
  };
}

module.exports = {
  getDisplayBundle,
  DEFAULT_LOCATION_ID,
};
