import { supabase } from './supabase';

export type ClockInLocationOption = {
  id: number;
  name: string;
  slug: string | null;
};

/** Fallback when DB table is not migrated yet — matches sql/create_clock_in_locations.sql seeds. */
export const DEFAULT_CLOCK_IN_LOCATIONS: ClockInLocationOption[] = [
  { id: 1, name: 'Ramat Gan - Office', slug: 'ramat-gan-office' },
  { id: 2, name: 'Jerusalem - Office', slug: 'jerusalem-office' },
  { id: 3, name: 'Home', slug: 'home' },
];

let cachedLocations: ClockInLocationOption[] | null = null;
let fetchPromise: Promise<ClockInLocationOption[]> | null = null;

const LAST_WORKPLACE_STORAGE_KEY = 'crm_clock_in_last_location_id';

export function readLastSelectedWorkplaceId(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LAST_WORKPLACE_STORAGE_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function persistLastSelectedWorkplaceId(id: number): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LAST_WORKPLACE_STORAGE_KEY, String(id));
  } catch {
    /* ignore */
  }
}

export function isHomeClockInLocation(loc: ClockInLocationOption): boolean {
  if (loc.slug?.toLowerCase() === 'home') return true;
  return loc.name.trim().toLowerCase() === 'home';
}

export function coerceEmployeeWorksFromHome(value: unknown): boolean {
  return value === true || value === 't' || value === 'true' || value === 1;
}

/** Hide Home unless the employee is flagged works_from_home in tenants_employee. */
export function filterClockInLocationsForEmployee(
  locations: ClockInLocationOption[],
  worksFromHome: boolean,
): ClockInLocationOption[] {
  if (worksFromHome) return locations;
  return locations.filter((loc) => !isHomeClockInLocation(loc));
}

export async function fetchEmployeeWorksFromHome(employeeId: number): Promise<boolean> {
  const { data, error } = await supabase
    .from('tenants_employee')
    .select('works_from_home')
    .eq('id', employeeId)
    .maybeSingle();
  if (error) {
    console.warn('[fetchEmployeeWorksFromHome]', error);
    return false;
  }
  return coerceEmployeeWorksFromHome(data?.works_from_home);
}

export function resolveWorkplaceName(
  row: {
    clock_in_location_id?: number | null;
    clock_out_location_id?: number | null;
    clock_in_place?: { name: string } | { name: string }[] | null;
    clock_out_place?: { name: string } | { name: string }[] | null;
  } | null | undefined,
  which: 'in' | 'out',
): string {
  if (!row) return '—';
  const join = which === 'in' ? row.clock_in_place : row.clock_out_place;
  if (join) {
    const rec = Array.isArray(join) ? join[0] : join;
    if (rec?.name?.trim()) return rec.name.trim();
  }
  const id = which === 'in' ? row.clock_in_location_id : row.clock_out_location_id;
  if (id == null) return '—';
  const fromCache = (cachedLocations ?? DEFAULT_CLOCK_IN_LOCATIONS).find((l) => l.id === id);
  return fromCache?.name ?? '—';
}

/** Active preset workplaces for the clock-in dropdown. */
export async function fetchActiveClockInLocations(): Promise<ClockInLocationOption[]> {
  if (cachedLocations) return cachedLocations;
  if (!fetchPromise) {
    fetchPromise = (async () => {
      try {
        const { data, error } = await supabase
          .from('clock_in_locations')
          .select('id, name, slug')
          .eq('active', true)
          .order('sort_order', { ascending: true })
          .order('name', { ascending: true });
        if (error) throw error;
        if (data?.length) {
          cachedLocations = data.map((r) => ({
            id: Number(r.id),
            name: String(r.name),
            slug: r.slug != null ? String(r.slug) : null,
          }));
          return cachedLocations;
        }
      } catch (err) {
        console.warn('[fetchActiveClockInLocations]', err);
      }
      cachedLocations = DEFAULT_CLOCK_IN_LOCATIONS;
      return cachedLocations;
    })();
  }
  return fetchPromise;
}
