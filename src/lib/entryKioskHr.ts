import { supabase } from './supabase';
import { ENTRY_KIOSK_DEFAULT_LOCATION_ID } from './clockInKioskApi';

export type EntryKioskSettings = {
  location_id: number;
  office_label: string;
  show_clock_date: boolean;
  show_weather: boolean;
  show_meetings_today: boolean;
  show_birthdays: boolean;
  show_announcements: boolean;
  show_gadgets: boolean;
  weather_city: string;
};

export type EntryKioskAnnouncement = {
  id: number;
  location_id: number;
  title: string | null;
  body: string;
  sort_order: number;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
  created_at?: string;
};

export type EntryKioskGadget = {
  id: number;
  location_id: number;
  label: string;
  body: string | null;
  icon_key: string | null;
  sort_order: number;
  is_active: boolean;
  created_at?: string;
};

export const DEFAULT_ENTRY_KIOSK_SETTINGS: EntryKioskSettings = {
  location_id: ENTRY_KIOSK_DEFAULT_LOCATION_ID,
  office_label: 'RAMAT GAN',
  show_clock_date: true,
  show_weather: false,
  show_meetings_today: true,
  show_birthdays: true,
  show_announcements: true,
  show_gadgets: true,
  weather_city: 'Tel Aviv',
};

export async function fetchEntryKioskSettings(
  locationId = ENTRY_KIOSK_DEFAULT_LOCATION_ID,
): Promise<EntryKioskSettings> {
  const { data, error } = await supabase
    .from('entry_kiosk_settings')
    .select(
      'location_id, office_label, show_clock_date, show_weather, show_meetings_today, show_birthdays, show_announcements, show_gadgets, weather_city',
    )
    .eq('location_id', locationId)
    .maybeSingle();

  if (error) throw error;
  return { ...DEFAULT_ENTRY_KIOSK_SETTINGS, ...(data || {}) };
}

export async function saveEntryKioskSettings(
  patch: Partial<EntryKioskSettings>,
  locationId = ENTRY_KIOSK_DEFAULT_LOCATION_ID,
): Promise<void> {
  const payload = {
    id: 1,
    location_id: locationId,
    ...patch,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from('entry_kiosk_settings').upsert(payload, {
    onConflict: 'location_id',
  });
  if (error) throw error;
}

export async function fetchEntryKioskAnnouncements(
  locationId = ENTRY_KIOSK_DEFAULT_LOCATION_ID,
): Promise<EntryKioskAnnouncement[]> {
  const { data, error } = await supabase
    .from('entry_kiosk_announcements')
    .select('*')
    .eq('location_id', locationId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []) as EntryKioskAnnouncement[];
}

export async function createEntryKioskAnnouncement(
  input: Pick<EntryKioskAnnouncement, 'title' | 'body' | 'sort_order' | 'start_date' | 'end_date' | 'is_active'>,
  locationId = ENTRY_KIOSK_DEFAULT_LOCATION_ID,
): Promise<void> {
  const { error } = await supabase.from('entry_kiosk_announcements').insert({
    location_id: locationId,
    title: input.title?.trim() || null,
    body: input.body.trim(),
    sort_order: input.sort_order ?? 0,
    start_date: input.start_date || null,
    end_date: input.end_date || null,
    is_active: input.is_active ?? true,
  });
  if (error) throw error;
}

export async function updateEntryKioskAnnouncement(
  id: number,
  input: Partial<
    Pick<EntryKioskAnnouncement, 'title' | 'body' | 'sort_order' | 'start_date' | 'end_date' | 'is_active'>
  >,
): Promise<void> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.title !== undefined) patch.title = input.title?.trim() || null;
  if (input.body !== undefined) patch.body = input.body.trim();
  if (input.sort_order !== undefined) patch.sort_order = input.sort_order;
  if (input.start_date !== undefined) patch.start_date = input.start_date || null;
  if (input.end_date !== undefined) patch.end_date = input.end_date || null;
  if (input.is_active !== undefined) patch.is_active = input.is_active;

  const { error } = await supabase.from('entry_kiosk_announcements').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteEntryKioskAnnouncement(id: number): Promise<void> {
  const { error } = await supabase.from('entry_kiosk_announcements').delete().eq('id', id);
  if (error) throw error;
}

export async function fetchEntryKioskGadgets(
  locationId = ENTRY_KIOSK_DEFAULT_LOCATION_ID,
): Promise<EntryKioskGadget[]> {
  const { data, error } = await supabase
    .from('entry_kiosk_gadgets')
    .select('*')
    .eq('location_id', locationId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data || []) as EntryKioskGadget[];
}

export async function createEntryKioskGadget(
  input: Pick<EntryKioskGadget, 'label' | 'body' | 'icon_key' | 'sort_order' | 'is_active'>,
  locationId = ENTRY_KIOSK_DEFAULT_LOCATION_ID,
): Promise<void> {
  const { error } = await supabase.from('entry_kiosk_gadgets').insert({
    location_id: locationId,
    label: input.label.trim(),
    body: input.body?.trim() || null,
    icon_key: input.icon_key?.trim() || null,
    sort_order: input.sort_order ?? 0,
    is_active: input.is_active ?? true,
  });
  if (error) throw error;
}

export async function updateEntryKioskGadget(
  id: number,
  input: Partial<Pick<EntryKioskGadget, 'label' | 'body' | 'icon_key' | 'sort_order' | 'is_active'>>,
): Promise<void> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.label !== undefined) patch.label = input.label.trim();
  if (input.body !== undefined) patch.body = input.body?.trim() || null;
  if (input.icon_key !== undefined) patch.icon_key = input.icon_key?.trim() || null;
  if (input.sort_order !== undefined) patch.sort_order = input.sort_order;
  if (input.is_active !== undefined) patch.is_active = input.is_active;

  const { error } = await supabase.from('entry_kiosk_gadgets').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteEntryKioskGadget(id: number): Promise<void> {
  const { error } = await supabase.from('entry_kiosk_gadgets').delete().eq('id', id);
  if (error) throw error;
}
