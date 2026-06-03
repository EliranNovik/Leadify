import { supabase } from './supabase';

export async function fetchArchivedWhatsAppLeadPhones(): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('whatsapp_leads_archive')
    .select('phone_number');

  if (error) {
    console.error('Error fetching archived WhatsApp leads:', error);
    throw error;
  }

  return new Set(
    (data ?? [])
      .map((row) => row.phone_number)
      .filter((phone): phone is string => !!phone),
  );
}

export async function archiveWhatsAppLeadPhone(phoneNumber: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from('whatsapp_leads_archive').upsert(
    {
      phone_number: phoneNumber,
      archived_at: new Date().toISOString(),
      archived_by: user?.id ?? null,
    },
    { onConflict: 'phone_number' },
  );

  if (error) {
    console.error('Error archiving WhatsApp lead:', error);
    throw error;
  }
}

export async function unarchiveWhatsAppLeadPhone(phoneNumber: string): Promise<void> {
  const { error } = await supabase
    .from('whatsapp_leads_archive')
    .delete()
    .eq('phone_number', phoneNumber);

  if (error) {
    console.error('Error restoring WhatsApp lead from archive:', error);
    throw error;
  }
}
