import { supabase } from './supabase';
import { formatClockTime } from './employeeClockInFormat';
import { fetchActiveClockInLocations, resolveWorkplaceName } from './clockInLocations';

export type ClockInRevisionSource = 'automatic' | 'manual';

export type ClockInRevisionRow = {
  id: number;
  created_at: string;
  clock_in_id: number;
  employee_id: number;
  revision_source: ClockInRevisionSource;
  clock_in_time: string;
  clock_out_time: string | null;
  notes: string | null;
  manually?: boolean | null;
  approved?: boolean | null;
  declined?: boolean | null;
  clock_in_location_id?: number | null;
  clock_out_location_id?: number | null;
  location_latitude?: number | null;
  location_longitude?: number | null;
  location_address?: string | null;
  location_city?: string | null;
  location_country?: string | null;
  location_source?: string | null;
  clock_out_location_latitude?: number | null;
  clock_out_location_longitude?: number | null;
  clock_out_location_address?: string | null;
  clock_out_location_city?: string | null;
  clock_out_location_country?: string | null;
  clock_out_location_source?: string | null;
  clock_in_place?: { name: string } | { name: string }[] | null;
  clock_out_place?: { name: string } | { name: string }[] | null;
};

export type ClockInRevisionSnapshot = {
  id: number;
  clockInId: number;
  createdAt: string;
  source: ClockInRevisionSource;
  clockInTime: string;
  clockOutTime: string | null;
  clockInPlace: string;
  clockOutPlace: string;
  notes: string | null;
  locationSource: string | null;
  gpsCity: string | null;
  gpsAddress: string | null;
  gpsOutCity: string | null;
  gpsOutAddress: string | null;
};

type ExistingClockInRow = {
  employee_id: number;
  clock_in_time: string;
  clock_out_time: string | null;
  notes: string | null;
  manually?: boolean | null;
  approved?: boolean | null;
  declined?: boolean | null;
  clock_in_location_id?: number | null;
  clock_out_location_id?: number | null;
  location_latitude?: number | null;
  location_longitude?: number | null;
  location_address?: string | null;
  location_city?: string | null;
  location_country?: string | null;
  location_source?: string | null;
  clock_out_location_latitude?: number | null;
  clock_out_location_longitude?: number | null;
  clock_out_location_address?: string | null;
  clock_out_location_city?: string | null;
  clock_out_location_country?: string | null;
  clock_out_location_source?: string | null;
};

function mapRevisionRow(row: ClockInRevisionRow): ClockInRevisionSnapshot {
  return {
    id: row.id,
    clockInId: row.clock_in_id,
    createdAt: row.created_at,
    source: row.revision_source,
    clockInTime: row.clock_in_time,
    clockOutTime: row.clock_out_time,
    clockInPlace: resolveWorkplaceName(row, 'in'),
    clockOutPlace: resolveWorkplaceName(row, 'out'),
    notes: row.notes?.trim() || null,
    locationSource: row.location_source?.trim() || null,
    gpsCity: row.location_city?.trim() || null,
    gpsAddress: row.location_address?.trim() || null,
    gpsOutCity: row.clock_out_location_city?.trim() || null,
    gpsOutAddress: row.clock_out_location_address?.trim() || null,
  };
}

export async function insertClockInRevision(
  clockInId: number,
  existing: ExistingClockInRow,
  source: ClockInRevisionSource,
): Promise<void> {
  const row = {
    clock_in_id: clockInId,
    employee_id: existing.employee_id,
    revision_source: source,
    clock_in_time: existing.clock_in_time,
    clock_out_time: existing.clock_out_time,
    notes: existing.notes?.trim() || null,
    manually: existing.manually === true,
    approved: existing.approved === true,
    declined: existing.declined === true,
    clock_in_location_id: existing.clock_in_location_id ?? null,
    clock_out_location_id: existing.clock_out_location_id ?? null,
    location_latitude: existing.location_latitude ?? null,
    location_longitude: existing.location_longitude ?? null,
    location_address: existing.location_address ?? null,
    location_city: existing.location_city ?? null,
    location_country: existing.location_country ?? null,
    location_source: existing.location_source ?? null,
    clock_out_location_latitude: existing.clock_out_location_latitude ?? null,
    clock_out_location_longitude: existing.clock_out_location_longitude ?? null,
    clock_out_location_address: existing.clock_out_location_address ?? null,
    clock_out_location_city: existing.clock_out_location_city ?? null,
    clock_out_location_country: existing.clock_out_location_country ?? null,
    clock_out_location_source: existing.clock_out_location_source ?? null,
  };

  const { error } = await supabase.from('employee_clock_in_revisions').insert(row);
  if (error) {
    // Table may not be migrated yet — log and continue so edits still work.
    console.warn('[insertClockInRevision]', error.message);
  }
}

const REVISION_SELECT_MINIMAL = `
  id, created_at, clock_in_id, employee_id, revision_source,
  clock_in_time, clock_out_time, notes, manually, approved, declined,
  clock_in_location_id, clock_out_location_id,
  location_latitude, location_longitude, location_address, location_city, location_country, location_source,
  clock_out_location_latitude, clock_out_location_longitude,
  clock_out_location_address, clock_out_location_city, clock_out_location_country, clock_out_location_source
`;

const REVISION_SELECT_WITH_PLACES = `
  ${REVISION_SELECT_MINIMAL},
  clock_in_place:clock_in_locations!clock_in_location_id ( name ),
  clock_out_place:clock_in_locations!clock_out_location_id ( name )
`;

/** Latest revision per clock-in id (for approval UI). */
export async function fetchLatestClockInRevisionsByRecordIds(
  recordIds: number[],
): Promise<Map<number, ClockInRevisionSnapshot>> {
  const map = new Map<number, ClockInRevisionSnapshot>();
  if (recordIds.length === 0) return map;

  await fetchActiveClockInLocations();

  let data: ClockInRevisionRow[] | null = null;

  const withPlaces = await supabase
    .from('employee_clock_in_revisions')
    .select(REVISION_SELECT_WITH_PLACES)
    .in('clock_in_id', recordIds)
    .order('created_at', { ascending: false });

  if (!withPlaces.error) {
    data = (withPlaces.data || []) as ClockInRevisionRow[];
  } else {
    console.warn('[fetchLatestClockInRevisionsByRecordIds] join select failed, retrying:', withPlaces.error.message);
    const minimal = await supabase
      .from('employee_clock_in_revisions')
      .select(REVISION_SELECT_MINIMAL)
      .in('clock_in_id', recordIds)
      .order('created_at', { ascending: false });
    if (minimal.error) {
      console.warn('[fetchLatestClockInRevisionsByRecordIds]', minimal.error.message);
      return map;
    }
    data = (minimal.data || []) as ClockInRevisionRow[];
  }

  for (const row of data) {
    if (map.has(row.clock_in_id)) continue;
    map.set(row.clock_in_id, mapRevisionRow(row));
  }
  return map;
}

export function formatRevisionSourceLabel(source: ClockInRevisionSource): string {
  return source === 'automatic' ? 'Original automatic clock-in' : 'Previous manual entry';
}

export function formatRevisionCompact(snapshot: ClockInRevisionSnapshot): string {
  const inTime = formatClockTime(snapshot.clockInTime);
  const outTime = snapshot.clockOutTime ? formatClockTime(snapshot.clockOutTime) : '—';
  return `${inTime}–${outTime}, ${snapshot.clockInPlace}`;
}

export function gpsLocationSummary(
  city: string | null,
  address: string | null,
): string | null {
  const parts = [city, address].filter((part) => part && part.trim());
  if (parts.length === 0) return null;
  return parts.join(' · ');
}
