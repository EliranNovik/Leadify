export type ClockInLocationData = {
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  city: string | null;
  country: string | null;
  source: 'browser' | 'ip' | 'manual';
};

export const EMPTY_CLOCK_IN_LOCATION: ClockInLocationData = {
  latitude: null,
  longitude: null,
  address: null,
  city: null,
  country: null,
  source: 'manual',
};

/** Browser GPS → reverse geocode, with IP fallback. Shared by Dashboard clock-in and profile working hours. */
export async function detectClockInLocation(): Promise<ClockInLocationData> {
  const fallbackIp = async (): Promise<ClockInLocationData> => {
    try {
      const response = await fetch('https://ipapi.co/json/');
      const data = await response.json();
      return {
        latitude: data.latitude ?? null,
        longitude: data.longitude ?? null,
        address: data.city ? `${data.city}, ${data.region}` : null,
        city: data.city ?? null,
        country: data.country_name ?? null,
        source: 'ip',
      };
    } catch {
      return {
        ...EMPTY_CLOCK_IN_LOCATION,
        address: 'Location unavailable',
      };
    }
  };

  if (!navigator.geolocation) {
    return fallbackIp();
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        try {
          const response = await fetch(
            `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`,
          );
          const data = await response.json();
          resolve({
            latitude: lat,
            longitude: lng,
            address: data.locality || data.principalSubdivision || null,
            city: data.city || data.locality || null,
            country: data.countryName || null,
            source: 'browser',
          });
        } catch {
          resolve({
            latitude: lat,
            longitude: lng,
            address: null,
            city: null,
            country: null,
            source: 'browser',
          });
        }
      },
      () => {
        void fallbackIp().then(resolve);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  });
}

export function formatClockInLocationDisplay(record: {
  location_address?: string | null;
  location_city?: string | null;
  location_country?: string | null;
  clock_out_location_address?: string | null;
  clock_out_location_city?: string | null;
  clock_out_location_country?: string | null;
  clock_out_location_latitude?: number | null;
  clock_out_location_longitude?: number | null;
  location_latitude?: number | null;
  location_longitude?: number | null;
} | null | undefined, which: 'in' | 'out' = 'in'): string {
  if (!record) return '—';
  const address =
    which === 'out'
      ? record.clock_out_location_address
      : record.location_address;
  const city = which === 'out' ? record.clock_out_location_city : record.location_city;
  const country = which === 'out' ? record.clock_out_location_country : record.location_country;
  const parts = [address, city, country].filter((p) => p && String(p).trim());
  if (parts.length) return parts.join(', ');
  const lat =
    which === 'out' ? record.clock_out_location_latitude : record.location_latitude;
  const lng =
    which === 'out' ? record.clock_out_location_longitude : record.location_longitude;
  if (lat != null && lng != null) {
    return `${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}`;
  }
  return '—';
}

export function locationToDbFields(
  loc: ClockInLocationData,
  prefix: '' | 'clock_out_' = '',
): Record<string, string | number | null> {
  const p = prefix;
  return {
    [`${p}location_latitude`]: loc.latitude,
    [`${p}location_longitude`]: loc.longitude,
    [`${p}location_address`]: loc.address,
    [`${p}location_city`]: loc.city,
    [`${p}location_country`]: loc.country,
    [`${p}location_source`]: loc.source,
  };
}
