import { supabase } from './supabase';

export interface ContactInfo {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  country_id: number | null;
  isMain: boolean;
}

/**
 * Fetches all contacts for a lead from leads_contact and lead_leadcontact tables
 * @param leadId - The lead ID (UUID for new leads, numeric string for legacy)
 * @param isLegacyLead - Whether this is a legacy lead
 * @returns Array of contact information
 */
export async function fetchLeadContacts(
  leadId: string | number,
  isLegacyLead: boolean
): Promise<ContactInfo[]> {
  try {
    const contacts: ContactInfo[] = [];

    if (isLegacyLead) {
      // For legacy leads, use lead_id in lead_leadcontact
      const legacyId = typeof leadId === 'string' ? leadId.replace('legacy_', '') : String(leadId);
      
      // Get contact relationships
      const { data: leadContacts, error: leadContactsError } = await supabase
        .from('lead_leadcontact')
        .select('id, main, contact_id, lead_id')
        .eq('lead_id', legacyId);

      if (leadContactsError) {
        console.error('Error fetching legacy lead contacts:', leadContactsError);
        return [];
      }

      if (leadContacts && leadContacts.length > 0) {
        const contactIds = leadContacts.map((lc: any) => lc.contact_id).filter(Boolean);
        
        if (contactIds.length > 0) {
          // Fetch contact details
          const { data: contactsData, error: contactsError } = await supabase
            .from('leads_contact')
            .select('id, name, mobile, phone, email, country_id')
            .in('id', contactIds);

          if (contactsError) {
            console.error('Error fetching legacy contact details:', contactsError);
            return [];
          }

          if (contactsData) {
            // Map contacts with their main status
            leadContacts.forEach((leadContact: any) => {
              const contact = contactsData.find((c: any) => c.id === leadContact.contact_id);
              if (contact) {
                const isMain = leadContact.main === 'true' || leadContact.main === true || leadContact.main === 't';
                contacts.push({
                  id: contact.id,
                  name: contact.name || '---',
                  email: contact.email || null,
                  phone: contact.phone || null,
                  mobile: contact.mobile || null,
                  country_id: contact.country_id || null,
                  isMain: isMain,
                });
              }
            });
          }
        }
      }
    } else {
      // For new leads, use newlead_id in lead_leadcontact
      const newLeadId = typeof leadId === 'string' ? leadId : String(leadId);
      
      // Get contact relationships
      const { data: leadContacts, error: leadContactsError } = await supabase
        .from('lead_leadcontact')
        .select('id, main, contact_id, newlead_id')
        .eq('newlead_id', newLeadId);

      if (leadContactsError) {
        console.error('Error fetching new lead contacts:', leadContactsError);
        return [];
      }

      if (leadContacts && leadContacts.length > 0) {
        const contactIds = leadContacts.map((lc: any) => lc.contact_id).filter(Boolean);
        
        if (contactIds.length > 0) {
          // Fetch contact details
          const { data: contactsData, error: contactsError } = await supabase
            .from('leads_contact')
            .select('id, name, mobile, phone, email, country_id')
            .in('id', contactIds);

          if (contactsError) {
            console.error('Error fetching new lead contact details:', contactsError);
            return [];
          }

          if (contactsData) {
            // Map contacts with their main status
            leadContacts.forEach((leadContact: any) => {
              const contact = contactsData.find((c: any) => c.id === leadContact.contact_id);
              if (contact) {
                const isMain = leadContact.main === 'true' || leadContact.main === true || leadContact.main === 't';
                contacts.push({
                  id: contact.id,
                  name: contact.name || '---',
                  email: contact.email || null,
                  phone: contact.phone || null,
                  mobile: contact.mobile || null,
                  country_id: contact.country_id || null,
                  isMain: isMain,
                });
              }
            });
          }
        }
      }
    }

    // Sort: main contact first, then others by name
    contacts.sort((a, b) => {
      if (a.isMain && !b.isMain) return -1;
      if (!a.isMain && b.isMain) return 1;
      return (a.name || '').localeCompare(b.name || '');
    });

    return contacts;
  } catch (error) {
    console.error('Error fetching lead contacts:', error);
    return [];
  }
}

