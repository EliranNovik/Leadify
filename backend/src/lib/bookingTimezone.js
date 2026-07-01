const { DateTime } = require('luxon');

const BUSINESS_TZ = 'Asia/Jerusalem';

function normalizeTime(time) {
  const parts = String(time || '').trim().split(':');
  const h = Number(parts[0]);
  const m = Number(parts[1] ?? 0);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return '';
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function normalizeDate(date) {
  const trimmed = String(date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return '';
  return trimmed;
}

function isValidIanaTimezone(tz) {
  if (!tz || !String(tz).trim()) return false;
  try {
    return DateTime.now().setZone(tz).isValid;
  } catch {
    return false;
  }
}

function jerusalemDateTimeFromWall(date, time) {
  const d = normalizeDate(date);
  const t = normalizeTime(time);
  if (!d || !t) return null;
  const dt = DateTime.fromISO(`${d}T${t}:00`, { zone: BUSINESS_TZ });
  return dt.isValid ? dt : null;
}

function clientLocalToJerusalem(date, time, clientTz) {
  const d = normalizeDate(date);
  const t = normalizeTime(time);
  if (!d || !t) return null;

  const zone = isValidIanaTimezone(clientTz) ? clientTz : BUSINESS_TZ;
  if (zone === BUSINESS_TZ) {
    return { date: d, time: t };
  }

  const clientDt = DateTime.fromISO(`${d}T${t}:00`, { zone });
  if (!clientDt.isValid) return null;

  const jerusalem = clientDt.setZone(BUSINESS_TZ);
  return {
    date: jerusalem.toFormat('yyyy-MM-dd'),
    time: jerusalem.toFormat('HH:mm'),
  };
}

function jerusalemToClientLocal(date, time, clientTz) {
  const jerusalemDt = jerusalemDateTimeFromWall(date, time);
  if (!jerusalemDt) return null;

  const zone = isValidIanaTimezone(clientTz) ? clientTz : BUSINESS_TZ;
  if (zone === BUSINESS_TZ) {
    return {
      date: jerusalemDt.toFormat('yyyy-MM-dd'),
      time: jerusalemDt.toFormat('HH:mm'),
    };
  }

  const client = jerusalemDt.setZone(zone);
  return {
    date: client.toFormat('yyyy-MM-dd'),
    time: client.toFormat('HH:mm'),
  };
}

const TIMEZONE_PLACE_OVERRIDES = {
  [BUSINESS_TZ]: 'Israel',
};

function formatTimezonePlaceName(tz) {
  if (!isValidIanaTimezone(tz)) return tz;
  if (TIMEZONE_PLACE_OVERRIDES[tz]) return TIMEZONE_PLACE_OVERRIDES[tz];
  const segment = tz.split('/').pop() || tz;
  return segment.replace(/_/g, ' ');
}

function formatTimezoneAbbreviation(tz, referenceDate) {
  if (!isValidIanaTimezone(tz)) return '';
  const ref = referenceDate
    ? DateTime.fromISO(`${normalizeDate(referenceDate)}T12:00:00`, { zone: tz })
    : DateTime.now().setZone(tz);
  if (!ref.isValid) return tz;
  return ref.offsetNameShort || ref.toFormat('ZZ');
}

function formatTimezoneBadge(tz, referenceDate) {
  const place = formatTimezonePlaceName(tz);
  const abbr = formatTimezoneAbbreviation(tz, referenceDate);
  if (!abbr) return place;
  return `${place} (${abbr})`;
}

function formatBookingTime12h(time) {
  const t = normalizeTime(time);
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'pm' : 'am';
  const hour12 = h % 12 || 12;
  return m ? `${hour12}:${String(m).padStart(2, '0')}${period}` : `${hour12}${period}`;
}

function formatBookingTimeWithZone(time, clientTz, referenceDate) {
  const formatted = formatBookingTime12h(time);
  if (!formatted) return '';
  const badge = formatTimezoneBadge(clientTz, referenceDate);
  return badge ? `${formatted} ${badge}` : formatted;
}

function formatDualBookingTime(jerusalemDate, jerusalemTime, clientTz) {
  const local = jerusalemToClientLocal(jerusalemDate, jerusalemTime, clientTz);
  if (!local) {
    const israelOnly = formatBookingTimeWithZone(jerusalemTime, BUSINESS_TZ, jerusalemDate);
    return israelOnly;
  }

  const clientDisplay = formatBookingTimeWithZone(local.time, clientTz, local.date);
  const israelDisplay = formatBookingTimeWithZone(jerusalemTime, BUSINESS_TZ, jerusalemDate);

  if (!clientTz || clientTz === BUSINESS_TZ) {
    return israelDisplay;
  }

  return `${clientDisplay} (your time) / ${israelDisplay} (Israel time)`;
}

function addDaysToDateKey(dateStr, days) {
  const dt = DateTime.fromISO(`${normalizeDate(dateStr)}T12:00:00`, { zone: BUSINESS_TZ });
  if (!dt.isValid) return dateStr;
  return dt.plus({ days }).toFormat('yyyy-MM-dd');
}

module.exports = {
  BUSINESS_TZ,
  isValidIanaTimezone,
  jerusalemDateTimeFromWall,
  clientLocalToJerusalem,
  jerusalemToClientLocal,
  formatTimezonePlaceName,
  formatTimezoneAbbreviation,
  formatTimezoneBadge,
  formatBookingTime12h,
  formatBookingTimeWithZone,
  formatDualBookingTime,
  addDaysToDateKey,
  normalizeTime,
  normalizeDate,
};
