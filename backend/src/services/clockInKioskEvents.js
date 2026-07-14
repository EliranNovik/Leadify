/** In-memory recent clock-in flash events for entry kiosk tablets. */

const RECENT_MS = 4_000;
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

function announce({ locationId: locationIdInput, employeeName }) {
  const locationId = normalizeLocationId(locationIdInput);
  if (locationId == null) {
    const err = new Error('Missing or invalid locationId');
    err.statusCode = 400;
    throw err;
  }

  const event = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    locationId,
    employeeName: sanitizeName(employeeName),
    at: new Date().toISOString(),
    expiresAt: Date.now() + RECENT_MS,
  };
  byLocation.set(locationId, event);
  return event;
}

function getRecent(locationIdInput) {
  const locationId = normalizeLocationId(locationIdInput);
  if (locationId == null) return null;

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
    at: event.at,
  };
}

module.exports = {
  RECENT_MS,
  announce,
  getRecent,
};
