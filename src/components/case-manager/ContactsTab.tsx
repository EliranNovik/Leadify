import React, { useState, useEffect } from 'react';
import {
  UserPlusIcon,
  PencilIcon,
  TrashIcon,
  XMarkIcon,
  CheckIcon,
  UserGroupIcon,
  Squares2X2Icon,
  TableCellsIcon,
  PlusIcon,
  TagIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  EllipsisVerticalIcon,
  AdjustmentsHorizontalIcon,
} from '@heroicons/react/24/outline';
import { supabase } from '../../lib/supabase';
import { toast } from 'react-hot-toast';

interface HandlerLead {
  id: string;
  lead_number: string;
  name: string;
  email?: string;
  phone?: string;
  category?: string;
  stage: string;
  handler_stage?: string;
  created_at: string;
  balance?: number;
  balance_currency?: string;
  onedrive_folder_link?: string;
  expert?: string;
  handler?: string;
  closer?: string;
  scheduler?: string;
  manager?: string;
}

interface ContactGroup {
  id: string;
  name: string;
  color: string;
  position?: number;
  created_at?: string;
}

interface Contact {
  id: string;
  lead_id: string;
  name: string;
  email?: string;
  phone?: string;
  mobile?: string;
  relationship?: 'persecuted_person' | 'spouse' | 'child' | 'parent' | 'sibling' | 'grandchild' | 'grandparent' | 'great_grandchild' | 'great_grandparent' | 'grandson' | 'granddaughter' | 'great_grandson' | 'great_granddaughter' | 'nephew' | 'niece' | 'cousin' | 'uncle' | 'aunt' | 'in_law' | 'other';
  birth_date?: string;
  death_date?: string;
  birth_place?: string;
  current_address?: string;
  citizenship?: string;
  passport_number?: string;
  id_number?: string;
  group_id?: string | null;
  is_main_applicant?: boolean;
  is_persecuted?: boolean;
  persecution_details?: any;
  contact_notes?: string;
  document_status?: 'pending' | 'complete' | 'incomplete';
  created_at?: string;
  updated_at?: string;
  document_count?: number;
  completed_documents?: number;
  completion_percentage?: number;
  isMain?: boolean; // For legacy contacts
  is_legacy?: boolean; // Flag to identify legacy contacts
}

interface HandlerTabProps {
  leads: HandlerLead[];
  uploadFiles: (lead: HandlerLead, files: File[]) => Promise<void>;
  uploadingLeadId: string | null;
  uploadedFiles: { [leadId: string]: any[] };
  isUploading: boolean;
  handleFileInput: (lead: HandlerLead, e: React.ChangeEvent<HTMLInputElement>) => void;
  refreshLeads: () => Promise<void>;
}

// Contacts Tab Component with full CRUD functionality
const ContactsTab: React.FC<HandlerTabProps> = ({ leads, refreshLeads }) => {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddContactModal, setShowAddContactModal] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [selectedLead, setSelectedLead] = useState<HandlerLead | null>(null);
  const [viewMode, setViewMode] = useState<'box' | 'table'>('table');

  // Groups state
  const [groups, setGroups] = useState<ContactGroup[]>([]);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ContactGroup | null>(null);
  const [newGroup, setNewGroup] = useState({ name: '' });
  const [showChangeGroupModal, setShowChangeGroupModal] = useState(false);
  const [selectedGroupForChange, setSelectedGroupForChange] = useState<string | null>(null);
  const [selectedContactsForChange, setSelectedContactsForChange] = useState<Set<string>>(new Set());
  const [targetGroupId, setTargetGroupId] = useState<string>('');

  // New contact form state
  const [newContact, setNewContact] = useState({
    name: '',
    email: '',
    phone: '',
    mobile: '',
    relationship: 'other' as Contact['relationship'],
    birth_date: '',
    death_date: '',
    birth_place: '',
    current_address: '',
    citizenship: '',
    passport_number: '',
    id_number: '',
    group_id: null as string | null,
    is_persecuted: false,
    persecution_details: null as any,
    contact_notes: ''
  });

  // Fetch groups from database
  const fetchGroups = async () => {
    try {
      const { data, error } = await supabase
        .from('contact_groups')
        .select('*')
        .order('position', { ascending: true });

      if (error) {
        console.error('Error fetching groups:', error);
        toast.error('Failed to load groups');
        return;
      }

      if (data) {
        // Ensure all groups have positions, assign if missing
        const groupsWithPositions = data.map((group: any, index: number) => ({
          ...group,
          position: group.position !== undefined ? group.position : index
        }));
        // Sort by position
        groupsWithPositions.sort((a: ContactGroup, b: ContactGroup) => (a.position || 0) - (b.position || 0));
        setGroups(groupsWithPositions);
      }
    } catch (error) {
      console.error('Error fetching groups:', error);
      toast.error('Failed to load groups');
    }
  };

  // Load groups from database on mount
  useEffect(() => {
    fetchGroups();
  }, []);

  // Initialize selected contacts when change group modal opens
  useEffect(() => {
    if (showChangeGroupModal && selectedGroupForChange) {
      const groupContacts = contacts.filter(c => c.group_id === selectedGroupForChange);
      setSelectedContactsForChange(new Set(groupContacts.map(c => c.id)));
    }
  }, [showChangeGroupModal, selectedGroupForChange, contacts]);

  // Group management functions
  const createGroup = async () => {
    if (!newGroup.name.trim()) {
      toast.error('Group name is required');
      return;
    }
    // Get the highest position and add 1
    const maxPosition = groups.length > 0
      ? Math.max(...groups.map(g => g.position || 0))
      : -1;

    try {
      const { data, error } = await supabase
        .from('contact_groups')
        .insert({
          name: newGroup.name,
          color: '#6b7280', // Default gray color (kept for backward compatibility)
          position: maxPosition + 1
        })
        .select()
        .single();

      if (error) {
        toast.error('Error creating group: ' + error.message);
        return;
      }

      if (data) {
        setGroups([...groups, data].sort((a, b) => (a.position || 0) - (b.position || 0)));
        setNewGroup({ name: '' });
        setShowGroupModal(false);
        toast.success('Group created successfully');
      }
    } catch (error) {
      console.error('Error creating group:', error);
      toast.error('Failed to create group');
    }
  };

  const updateGroup = async () => {
    if (!editingGroup || !editingGroup.name.trim()) {
      toast.error('Group name is required');
      return;
    }

    try {
      const { error } = await supabase
        .from('contact_groups')
        .update({
          name: editingGroup.name,
          position: editingGroup.position
        })
        .eq('id', editingGroup.id);

      if (error) {
        toast.error('Error updating group: ' + error.message);
        return;
      }

      setGroups(groups.map(g => g.id === editingGroup.id ? editingGroup : g));
      setEditingGroup(null);
      toast.success('Group updated successfully');
    } catch (error) {
      console.error('Error updating group:', error);
      toast.error('Failed to update group');
    }
  };

  const deleteGroup = async (groupId: string) => {
    try {
      // First, remove group from all contacts
      const { error: updateError } = await supabase
        .from('contacts')
        .update({ group_id: null })
        .eq('group_id', groupId);

      if (updateError) {
        console.error('Error removing group from contacts:', updateError);
        // Continue with deletion even if update fails
      }

      // Then delete the group
      const { error: deleteError } = await supabase
        .from('contact_groups')
        .delete()
        .eq('id', groupId);

      if (deleteError) {
        toast.error('Error deleting group: ' + deleteError.message);
        return;
      }

      // Update local state
      setContacts(contacts.map(c => c.group_id === groupId ? { ...c, group_id: null } : c));
      setGroups(groups.filter(g => g.id !== groupId));
      toast.success('Group deleted successfully');
    } catch (error) {
      console.error('Error deleting group:', error);
      toast.error('Failed to delete group');
    }
  };

  const getGroupById = (groupId: string | null | undefined): ContactGroup | null => {
    if (!groupId) return null;
    return groups.find(g => g.id === groupId) || null;
  };

  const updateContactGroup = async (contactId: string, groupId: string | null) => {
    try {
      const { error } = await supabase
        .from('contacts')
        .update({ group_id: groupId })
        .eq('id', contactId);

      if (error) {
        toast.error('Error updating contact group: ' + error.message);
        return;
      }

      setContacts(contacts.map(c => c.id === contactId ? { ...c, group_id: groupId } : c));
      toast.success('Contact group updated');
    } catch (error) {
      console.error('Error updating contact group:', error);
      toast.error('Failed to update contact group');
    }
  };

  // Toggle main applicant status for a contact within a group
  const toggleMainApplicant = async (contactId: string, groupId: string | null) => {
    const contact = contacts.find(c => c.id === contactId);
    if (!contact) return;

    const isCurrentlyMain = contact.is_main_applicant || contact.isMain;
    const newMainStatus = !isCurrentlyMain;

    // If setting as main, unset all other main applicants in the same group
    if (newMainStatus && groupId) {
      const otherContactsInGroup = contacts.filter(
        c => c.group_id === groupId && c.id !== contactId && (c.is_main_applicant || c.isMain)
      );

      // Unset other main applicants in the group
      for (const otherContact of otherContactsInGroup) {
        try {
          const updateData: any = {
            is_main_applicant: false
          };

          // Update in unified contacts table
          await supabase
            .from('contacts')
            .update(updateData)
            .eq('id', otherContact.id);

          // If it's a legacy contact, also update legacy tables
          if (otherContact.is_legacy) {
            const legacyId = otherContact.lead_id.replace('legacy_', '');
            await supabase
              .from('lead_leadcontact')
              .update({ main: 'false' })
              .eq('lead_id', legacyId)
              .eq('contact_id', otherContact.id);
          }
        } catch (error) {
          console.error('Error unsetting main applicant:', error);
        }
      }
    }

    try {
      const updateData: any = {
        is_main_applicant: newMainStatus
      };

      // Update in unified contacts table
      const { error } = await supabase
        .from('contacts')
        .update(updateData)
        .eq('id', contactId);

      if (error && error.code !== 'PGRST116') {
        toast.error('Error updating main applicant: ' + error.message);
        return;
      }

      // If it's a legacy contact, also update legacy tables
      if (contact.is_legacy) {
        const legacyId = contact.lead_id.replace('legacy_', '');
        await supabase
          .from('lead_leadcontact')
          .update({ main: newMainStatus ? 'true' : 'false' })
          .eq('lead_id', legacyId)
          .eq('contact_id', contactId);
      }

      // Update local state
      setContacts(contacts.map(c =>
        c.id === contactId
          ? { ...c, is_main_applicant: newMainStatus, isMain: newMainStatus }
          : (newMainStatus && groupId && c.group_id === groupId)
            ? { ...c, is_main_applicant: false, isMain: false }
            : c
      ));

      toast.success(newMainStatus ? 'Contact marked as main applicant' : 'Main applicant status removed');
      await fetchContacts();
    } catch (error) {
      console.error('Error toggling main applicant:', error);
      toast.error('Failed to update main applicant status');
    }
  };

  // Fetch contacts from database
  const fetchContacts = async () => {
    if (leads.length === 0) return;

    setLoading(true);
    try {
      // Separate new leads (UUID) from legacy leads (numeric ID with "legacy_" prefix)
      const newLeads = leads.filter(lead => !lead.id.startsWith('legacy_'));
      const legacyLeads = leads.filter(lead => lead.id.startsWith('legacy_'));
      const newLeadIds = newLeads.map(lead => lead.id);
      const allContacts: Contact[] = [];

      // Fetch contacts for new leads (contacts table)
      if (newLeadIds.length > 0) {
        console.log('🔍 Fetching contacts for lead IDs:', newLeadIds);
        console.log('🔍 Number of new leads:', newLeads.length);

        // Fetch all contacts that match any of the lead IDs
        const { data: newContactsData, error: newContactsError } = await supabase
          .from('contacts')
          .select('*')
          .in('lead_id', newLeadIds)
          .order('is_main_applicant', { ascending: false })
          .order('created_at', { ascending: true });

        if (newContactsError) {
          console.error('❌ Error fetching new contacts:', newContactsError);
          toast.error('Error fetching contacts: ' + newContactsError.message);
        } else {
          console.log('🔍 Fetched contacts from database:', newContactsData?.length || 0);
          if (newContactsData && newContactsData.length > 0) {
            console.log('🔍 Sample contact data:', newContactsData[0]);
          }

          // If no contacts found, try fetching ALL contacts to see what's in the database
          if (!newContactsData || newContactsData.length === 0) {
            console.log('⚠️ No contacts found with lead_id filter. Checking all contacts in database...');
            const { data: allContactsData, error: allContactsError } = await supabase
              .from('contacts')
              .select('id, name, lead_id, created_at')
              .limit(50)
              .order('created_at', { ascending: false });

            if (!allContactsError && allContactsData) {
              console.log('🔍 Found', allContactsData.length, 'total contacts in database');
              console.log('🔍 Sample contacts:', allContactsData.slice(0, 5));
              console.log('🔍 Looking for contacts with lead_id in:', newLeadIds);

              const matchingContacts = allContactsData.filter(c =>
                c.lead_id && newLeadIds.includes(c.lead_id)
              );
              console.log('🔍 Contacts matching our lead IDs:', matchingContacts.length);

              if (matchingContacts.length === 0) {
                console.warn('⚠️ No contacts found matching the lead IDs. Checking for null lead_id...');
                const nullLeadIdContacts = allContactsData.filter(c => !c.lead_id || c.lead_id === null);
                console.log('🔍 Contacts with null lead_id:', nullLeadIdContacts.length);
              }
            }
          }

          if (newContactsData && newContactsData.length > 0) {
            // Filter to only include contacts that match our leads (in case of any data inconsistencies)
            const validContacts = newContactsData.filter(contact => {
              const isValid = contact.lead_id && newLeadIds.includes(contact.lead_id);
              if (!isValid) {
                console.warn('⚠️ Contact with invalid lead_id found:', {
                  contact_id: contact.id,
                  contact_name: contact.name,
                  lead_id: contact.lead_id,
                  expected_lead_ids: newLeadIds
                });
              }
              return isValid;
            });

            console.log('🔍 Valid contacts after filtering:', validContacts.length);

            // Calculate document completion for each contact
            const contactsWithStats = await Promise.all(
              validContacts.map(async (contact) => {
                const { data: docStats } = await supabase
                  .from('lead_required_documents')
                  .select('status')
                  .eq('contact_id', contact.id);

                const totalDocs = docStats?.length || 0;
                const completedDocs = docStats?.filter(doc => ['approved', 'received'].includes(doc.status)).length || 0;
                const completionPercentage = totalDocs > 0 ? Math.round((completedDocs / totalDocs) * 100) : 0;

                return {
                  ...contact,
                  document_count: totalDocs,
                  completed_documents: completedDocs,
                  completion_percentage: completionPercentage,
                  is_legacy: false
                };
              })
            );

            allContacts.push(...contactsWithStats);
            console.log('🔍 Total contacts after processing:', allContacts.length);
          } else {
            console.log('🔍 No contacts found in database for these lead IDs');
          }
        }
      }

      // Fetch contacts for legacy leads
      // ALWAYS check both contacts table (unified) AND legacy tables (lead_leadcontact + leads_contact)
      // This ensures we get all contacts, whether they've been migrated or not
      if (legacyLeads.length > 0) {
        for (const legacyLead of legacyLeads) {
          const legacyId = legacyLead.id.replace('legacy_', '');
          const legacyIdPattern = `[LEGACY_LEAD_ID:${legacyId}]`;
          const legacyContactIds = new Set<string>(); // Track contact IDs to avoid duplicates

          // First, fetch from unified contacts table (if migrated)
          const { data: migratedContacts, error: migratedError } = await supabase
            .from('contacts')
            .select('*')
            .like('contact_notes', `%${legacyIdPattern}%`)
            .order('is_main_applicant', { ascending: false })
            .order('created_at', { ascending: true });

          if (!migratedError && migratedContacts && migratedContacts.length > 0) {
            console.log('🔍 ContactsTab - Found', migratedContacts.length, 'migrated contacts for legacy lead', legacyId);
            // Calculate document completion for migrated contacts
            const migratedWithStats = await Promise.all(
              migratedContacts.map(async (contact) => {
                const { data: docStats } = await supabase
                  .from('lead_required_documents')
                  .select('status')
                  .eq('contact_id', contact.id);

                const totalDocs = docStats?.length || 0;
                const completedDocs = docStats?.filter(doc => ['approved', 'received'].includes(doc.status)).length || 0;
                const completionPercentage = totalDocs > 0 ? Math.round((completedDocs / totalDocs) * 100) : 0;

                // Track this contact ID to avoid duplicates
                legacyContactIds.add(contact.id);

                return {
                  ...contact,
                  lead_id: legacyLead.id,
                  document_count: totalDocs,
                  completed_documents: completedDocs,
                  completion_percentage: completionPercentage,
                  is_legacy: true,
                  isMain: contact.is_main_applicant
                };
              })
            );

            allContacts.push(...migratedWithStats);
          } else {
            console.log('🔍 ContactsTab - No migrated contacts found for legacy lead', legacyId);
          }

          // ALWAYS also fetch from legacy tables (lead_leadcontact + leads_contact)
          // This ensures we get contacts that haven't been migrated yet
          const { data: leadContacts, error: leadContactsError } = await supabase
            .from('lead_leadcontact')
            .select('id, main, contact_id, lead_id')
            .eq('lead_id', legacyId);

          if (leadContactsError) {
            console.error('❌ ContactsTab - Error fetching legacy lead contacts:', leadContactsError);
            // Continue to next lead instead of skipping entirely
          } else if (leadContacts && leadContacts.length > 0) {
            console.log('🔍 ContactsTab - Found', leadContacts.length, 'contacts in lead_leadcontact for legacy lead', legacyId);
            const contactIds = leadContacts.map((lc: any) => lc.contact_id).filter(Boolean);

              if (contactIds.length > 0) {
                // Fetch contact details from leads_contact
                // Note: leads_contact table doesn't have a relationship column
                const { data: contactsData, error: contactsError } = await supabase
                  .from('leads_contact')
                  .select('id, name, mobile, phone, email, country_id, notes, address')
                  .in('id', contactIds);

              if (contactsError) {
                console.error('❌ ContactsTab - Error fetching legacy contact details:', contactsError);
              } else if (contactsData) {
                console.log('🔍 ContactsTab - Found', contactsData.length, 'contacts in leads_contact for legacy lead', legacyId);
                // Map contacts with their main status
                leadContacts.forEach((leadContact: any) => {
                  const contact = contactsData.find((c: any) => c.id === leadContact.contact_id);
                  if (contact) {
                    const contactIdStr = String(contact.id);
                    const contactName = (contact.name || '').trim().toLowerCase();
                    const contactPhone = (contact.phone || contact.mobile || '').trim();
                    
                    // Check if this contact was already added from migrated contacts
                    // Since migrated contacts have UUIDs and legacy have numeric IDs, we can't match by ID
                    // Instead, check by name and phone number
                    const isDuplicate = allContacts.some(existingContact => {
                      // Only check contacts for the same lead
                      if (existingContact.lead_id !== legacyLead.id) return false;
                      
                      const existingName = (existingContact.name || '').trim().toLowerCase();
                      const existingPhone = (existingContact.phone || existingContact.mobile || '').trim();
                      
                      // If names match exactly
                      if (existingName === contactName && existingName !== '') {
                        // If both have phone numbers, they must match
                        if (contactPhone && existingPhone) {
                          return contactPhone === existingPhone;
                        }
                        // If names match and at least one doesn't have a phone, 
                        // only consider it duplicate if the existing one is from migrated contacts (UUID)
                        // This prevents false duplicates when legacy contacts don't have phones
                        if (existingContact.id.length > 10) { // UUIDs are longer than numeric IDs
                          return true;
                        }
                      }
                      return false;
                    });
                    
                    if (isDuplicate) {
                      console.log('🔍 ContactsTab - Skipping duplicate contact:', {
                        name: contact.name,
                        id: contactIdStr,
                        phone: contactPhone || 'none',
                        reason: 'Similar contact already exists in migrated contacts'
                      });
                      return;
                    }

                    const isMain = leadContact.main === 'true' || leadContact.main === true || leadContact.main === 't';

                    console.log('✅ ContactsTab - Adding legacy contact from leads_contact:', {
                      id: contactIdStr,
                      name: contact.name,
                      phone: contactPhone || 'none',
                      lead_id: legacyLead.id,
                      isMain
                    });

                    allContacts.push({
                      id: contactIdStr,
                      lead_id: legacyLead.id,
                      name: contact.name || '---',
                      email: contact.email || undefined,
                      phone: contact.phone || undefined,
                      mobile: contact.mobile || undefined,
                      contact_notes: contact.notes || undefined,
                      current_address: contact.address || undefined,
                      relationship: undefined, // leads_contact table doesn't have relationship column
                      group_id: null, // Non-migrated legacy contacts don't have groups yet
                      isMain: isMain,
                      is_main_applicant: isMain,
                      is_legacy: true,
                      document_count: 0,
                      completed_documents: 0,
                      completion_percentage: 0
                    });
                  }
                });
              }
            }
          } else {
            console.log('🔍 ContactsTab - No contacts found in lead_leadcontact for legacy lead', legacyId);
          }
        }
      }

      console.log('🔍 ContactsTab - Total contacts fetched:', allContacts.length);
      console.log('🔍 ContactsTab - Contacts by lead_id:', allContacts.reduce((acc, c) => {
        acc[c.lead_id] = (acc[c.lead_id] || 0) + 1;
        return acc;
      }, {} as { [key: string]: number }));
      console.log('🔍 ContactsTab - Sample contacts:', allContacts.slice(0, 5).map(c => ({
        id: c.id,
        name: c.name,
        lead_id: c.lead_id,
        is_legacy: c.is_legacy
      })));
      
      setContacts(allContacts);
    } catch (err) {
      toast.error('Failed to fetch contacts');
      console.error('Error fetching contacts:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchContacts();
  }, [leads]);

  // Add new contact
  const addContact = async () => {
    if (!newContact.name.trim()) {
      toast.error('Contact name is required');
      return;
    }

    if (leads.length === 0) {
      toast.error('No cases available');
      return;
    }

    // Use the first lead
    const leadToUse = leads[0];
    const isLegacyLead = leadToUse.id.startsWith('legacy_');

    // Relationship is recommended but not strictly required for legacy leads
    if (!newContact.relationship) {
      newContact.relationship = 'other';
    }

    try {
      // For both new and legacy leads, save to the unified contacts table
      // For legacy leads, we'll store the legacy lead ID in a way we can reference it
      // Since contacts.lead_id expects UUID, we'll need to handle legacy leads differently
      // Option: Store legacy lead reference in contact_notes or create a mapping

      const isMain = !contacts.some(c => c.lead_id === leadToUse.id && (c.isMain || c.is_main_applicant));

      // Prepare contact data for contacts table
      const contactData: any = {
        name: newContact.name,
        email: newContact.email || null,
        phone: newContact.phone || null,
        relationship: newContact.relationship || 'other',
        birth_date: newContact.birth_date || null,
        death_date: newContact.death_date || null,
        birth_place: newContact.birth_place || null,
        current_address: newContact.current_address || null,
        citizenship: newContact.citizenship || null,
        passport_number: newContact.passport_number || null,
        id_number: newContact.id_number || null,
        group_id: newContact.group_id || null,
        is_main_applicant: isMain || newContact.relationship === 'persecuted_person',
        is_persecuted: newContact.is_persecuted || false,
        persecution_details: newContact.persecution_details || null,
        contact_notes: newContact.contact_notes || null
      };

      if (isLegacyLead) {
        // For legacy leads, we can't use lead_id (it's UUID), so we'll store the legacy ID in notes
        // Or we can create a separate mapping. For now, let's use a special format in contact_notes
        const legacyId = leadToUse.id.replace('legacy_', '');
        contactData.contact_notes = `[LEGACY_LEAD_ID:${legacyId}]${contactData.contact_notes || ''}`;

        // We still need to link it in the legacy tables for backward compatibility
        // First, create in leads_contact
        const { data: legacyContact, error: legacyContactError } = await supabase
          .from('leads_contact')
          .insert({
            name: newContact.name,
            email: newContact.email || null,
            phone: newContact.phone || null,
            mobile: newContact.mobile || newContact.phone || null,
            notes: newContact.contact_notes || null,
            address: newContact.current_address || null
          })
          .select()
          .single();

        if (legacyContactError) {
          console.error('Error creating legacy contact:', legacyContactError);
          // Continue anyway, we'll save to contacts table
        }

        // Link in lead_leadcontact
        if (legacyContact) {
          await supabase
            .from('lead_leadcontact')
            .insert({
              lead_id: legacyId,
              contact_id: legacyContact.id,
              main: isMain ? 'true' : 'false'
            });
        }
      } else {
        // For new leads, set the lead_id
        contactData.lead_id = leadToUse.id;
        console.log('✅ Setting lead_id for new lead:', leadToUse.id);
        console.log('✅ Lead details:', { id: leadToUse.id, name: leadToUse.name, lead_number: leadToUse.lead_number });
      }

      // Validate that lead_id is set before inserting
      if (!isLegacyLead && !contactData.lead_id) {
        toast.error('Error: lead_id is missing. Cannot add contact.');
        console.error('❌ lead_id is missing for new lead!', { leadToUse, contactData });
        return;
      }

      console.log('🔍 Inserting contact with data:', {
        name: contactData.name,
        lead_id: contactData.lead_id,
        is_legacy: isLegacyLead,
        group_id: contactData.group_id
      });

      // Save to unified contacts table
      const { data: insertedContact, error } = await supabase
        .from('contacts')
        .insert(contactData)
        .select()
        .single();

      if (error) {
        toast.error('Error adding contact: ' + error.message);
        console.error('Error adding contact:', error);
        console.error('Contact data that failed:', contactData);
        return;
      }

      if (!insertedContact) {
        toast.error('Contact was not created. Please try again.');
        console.error('No contact returned after insert');
        return;
      }

      console.log('✅ Contact added successfully:', insertedContact);
      console.log('✅ Contact lead_id after insert:', insertedContact.lead_id);
      console.log('✅ Contact ID:', insertedContact.id);
      toast.success('Contact added successfully');

      // Create default documents for this contact (only for new leads with relationship)
      if (!isLegacyLead && insertedContact && newContact.relationship) {
        await supabase.rpc('create_default_documents_for_contact', {
          p_lead_id: leadToUse.id,
          p_contact_id: insertedContact.id,
          p_relationship: newContact.relationship
        });
      }

      setShowAddContactModal(false);
      setNewContact({
        name: '',
        email: '',
        phone: '',
        mobile: '',
        relationship: 'other',
        birth_date: '',
        death_date: '',
        birth_place: '',
        current_address: '',
        citizenship: '',
        passport_number: '',
        id_number: '',
        group_id: null,
        is_persecuted: false,
        persecution_details: null,
        contact_notes: ''
      });
      await fetchContacts();
    } catch (err) {
      toast.error('Failed to add contact');
      console.error('Error adding contact:', err);
    }
  };

  // Update contact
  const updateContact = async () => {
    if (!editingContact) return;

    try {
      // Update in unified contacts table
      const updateData: any = {
        name: editingContact.name,
        email: editingContact.email || null,
        phone: editingContact.phone || null,
        relationship: editingContact.relationship || 'other',
        birth_date: editingContact.birth_date || null,
        death_date: editingContact.death_date || null,
        birth_place: editingContact.birth_place || null,
        current_address: editingContact.current_address || null,
        citizenship: editingContact.citizenship || null,
        passport_number: editingContact.passport_number || null,
        id_number: editingContact.id_number || null,
        group_id: editingContact.group_id || null,
        is_main_applicant: editingContact.is_main_applicant || editingContact.isMain || false,
        is_persecuted: editingContact.is_persecuted || false,
        persecution_details: editingContact.persecution_details || null,
        contact_notes: editingContact.contact_notes || null
      };

      // If it's a legacy contact, we also need to update the legacy tables
      if (editingContact.is_legacy) {
        const legacyId = editingContact.lead_id.replace('legacy_', '');

        // Update leads_contact table for backward compatibility
        const { error: legacyError } = await supabase
          .from('leads_contact')
          .update({
            name: editingContact.name,
            email: editingContact.email || null,
            phone: editingContact.phone || null,
            mobile: editingContact.mobile || null,
            notes: editingContact.contact_notes || null,
            address: editingContact.current_address || null
          })
          .eq('id', editingContact.id);

        if (legacyError) {
          console.error('Error updating legacy contact:', legacyError);
        }

        // Update the main status in lead_leadcontact if needed
        const isMain = editingContact.is_main_applicant || editingContact.isMain;
        await supabase
          .from('lead_leadcontact')
          .update({ main: isMain ? 'true' : 'false' })
          .eq('lead_id', legacyId)
          .eq('contact_id', editingContact.id);
      }

      // Update in unified contacts table
      // For legacy contacts, we need to find them by the legacy ID stored in notes
      // Or we can update by the contact ID if it exists in contacts table
      const { error } = await supabase
        .from('contacts')
        .update(updateData)
        .eq('id', editingContact.id);

      // If not found in contacts table (legacy contact not yet migrated), create it
      if (error && error.code === 'PGRST116') {
        // Contact doesn't exist in contacts table, create it
        if (editingContact.is_legacy) {
          const legacyId = editingContact.lead_id.replace('legacy_', '');
          updateData.contact_notes = `[LEGACY_LEAD_ID:${legacyId}]${updateData.contact_notes || ''}`;
        } else {
          updateData.lead_id = editingContact.lead_id;
        }

        const { error: insertError } = await supabase
          .from('contacts')
          .insert({ ...updateData, id: editingContact.id })
          .select()
          .single();

        if (insertError) {
          toast.error('Error updating contact: ' + insertError.message);
          return;
        }
      } else if (error) {
        toast.error('Error updating contact: ' + error.message);
        return;
      }

      toast.success('Contact updated successfully');
      setEditingContact(null);
      await fetchContacts();
    } catch (err) {
      toast.error('Failed to update contact');
      console.error('Error updating contact:', err);
    }
  };

  // Delete contact
  const deleteContact = async (contactId: string) => {
    const contact = contacts.find(c => c.id === contactId);
    const isLegacy = contact?.is_legacy;

    const confirmMessage = isLegacy
      ? 'Are you sure you want to delete this contact?'
      : 'Are you sure you want to delete this contact? This will also delete all associated documents and history.';

    if (!confirm(confirmMessage)) return;

    try {
      if (isLegacy) {
        // For legacy contacts, delete from lead_leadcontact first, then leads_contact
        // Find the lead_leadcontact relationship
        const lead = leads.find(l => {
          const leadContacts = contactsByLead[l.id] || [];
          return leadContacts.some(c => c.id === contactId);
        });

        if (lead) {
          const legacyId = lead.id.replace('legacy_', '');

          // Delete the relationship first
          const { error: linkError } = await supabase
            .from('lead_leadcontact')
            .delete()
            .eq('contact_id', contactId)
            .eq('lead_id', legacyId);

          if (linkError) {
            toast.error('Error deleting contact relationship: ' + linkError.message);
            return;
          }

          // Then delete the contact itself (only if not used by other leads)
          const { data: otherRelationships } = await supabase
            .from('lead_leadcontact')
            .select('id')
            .eq('contact_id', contactId)
            .limit(1);

          if (!otherRelationships || otherRelationships.length === 0) {
            const { error: contactError } = await supabase
              .from('leads_contact')
              .delete()
              .eq('id', contactId);

            if (contactError) {
              toast.error('Error deleting contact: ' + contactError.message);
              return;
            }
          }

          toast.success('Contact deleted successfully');
          await fetchContacts();
        }
      } else {
        // For new leads, delete from contacts table
        const { error } = await supabase
          .from('contacts')
          .delete()
          .eq('id', contactId);

        if (error) {
          toast.error('Error deleting contact: ' + error.message);
        } else {
          toast.success('Contact deleted successfully');
          await fetchContacts();
        }
      }
    } catch (err) {
      toast.error('Failed to delete contact');
      console.error('Error deleting contact:', err);
    }
  };

  // Get relationship badge color
  const getRelationshipBadgeColor = (relationship: string) => {
    switch (relationship) {
      case 'persecuted_person': return 'badge-primary';
      case 'spouse': return 'badge-secondary';
      case 'child': return 'badge-accent';
      case 'parent': return 'badge-info';
      case 'sibling': return 'badge-warning';
      case 'grandchild': case 'grandson': case 'granddaughter': return 'badge-success';
      case 'grandparent': return 'badge-info badge-outline';
      case 'great_grandchild': case 'great_grandson': case 'great_granddaughter': return 'badge-success badge-outline';
      case 'great_grandparent': return 'badge-ghost';
      case 'nephew': case 'niece': case 'cousin': return 'badge-warning badge-outline';
      case 'uncle': case 'aunt': case 'in_law': return 'badge-secondary badge-outline';
      default: return 'badge-neutral';
    }
  };

  // Get document status color
  const getDocumentStatusColor = (percentage: number) => {
    return 'text-white bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600';
  };

  // Group contacts by lead
  const contactsByLead = contacts.reduce((acc, contact) => {
    if (!contact.lead_id) {
      console.warn('⚠️ ContactsTab - Contact without lead_id:', {
        contactId: contact.id,
        contactName: contact.name
      });
      return acc;
    }
    if (!acc[contact.lead_id]) {
      acc[contact.lead_id] = [];
    }
    acc[contact.lead_id].push(contact);
    return acc;
  }, {} as Record<string, Contact[]>);
  
  // Debug: Log contacts by lead
  console.log('🔍 ContactsTab - contactsByLead summary:', Object.keys(contactsByLead).map(leadId => ({
    leadId,
    count: contactsByLead[leadId].length,
    contactNames: contactsByLead[leadId].slice(0, 3).map(c => c.name)
  })));

  // Helper function to sort contacts with persecuted_person first
  const sortContactsWithPersecutedFirst = (contactsList: Contact[]): Contact[] => {
    return [...contactsList].sort((a, b) => {
      // Always put persecuted_person first
      if (a.relationship === 'persecuted_person' && b.relationship !== 'persecuted_person') return -1;
      if (a.relationship !== 'persecuted_person' && b.relationship === 'persecuted_person') return 1;
      return 0;
    });
  };

  if (loading) {
    return (
      <div className="text-center py-16 px-8">
        <div className="loading loading-spinner loading-lg text-blue-600 mb-4"></div>
        <p className="text-lg text-gray-600">Loading contacts...</p>
      </div>
    );
  }

  return (
    <div className="w-full px-2 sm:px-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6 sm:mb-8">
        <div>
          <h3 className="text-lg sm:text-xl font-bold text-gray-900">Applicants & Family Management</h3>
          <p className="text-sm sm:text-base text-gray-600">Manage persecuted persons and their family members for all cases</p>
        </div>
        <div className="flex items-center gap-3">
          {/* View Toggle */}
          <div className="flex items-center gap-2 bg-gray-100 rounded-lg p-1">
            <button
              className={`btn btn-sm ${viewMode === 'box' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setViewMode('box')}
              title="Box View"
            >
              <Squares2X2Icon className="w-4 h-4" />
            </button>
            <button
              className={`btn btn-sm ${viewMode === 'table' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setViewMode('table')}
              title="Table View"
            >
              <TableCellsIcon className="w-4 h-4" />
            </button>
          </div>
          {/* Combined Dropdown for Add Applicant and Manage Groups */}
          <div className="dropdown dropdown-end">
            <label tabIndex={0} className="btn btn-primary gap-2 text-sm sm:text-base">
              <UserPlusIcon className="w-4 h-4" />
              <ChevronDownIcon className="w-4 h-4" />
            </label>
            <ul tabIndex={0} className="dropdown-content menu bg-base-100 rounded-box z-[100] w-52 p-2 shadow-lg border border-gray-200">
              <li>
                <button
                  onClick={() => {
                    setShowAddContactModal(true);
                    // Close dropdown
                    setTimeout(() => {
                      const label = document.querySelector('label[tabIndex="0"]') as HTMLElement;
                      if (label) label.blur();
                    }, 100);
                  }}
                  className="flex items-center gap-2 hover:bg-gray-100"
                >
                  <UserPlusIcon className="w-4 h-4" />
                  Add Applicant
                </button>
              </li>
              <li>
                <button
                  onClick={() => {
                    setShowGroupModal(true);
                    // Close dropdown
                    setTimeout(() => {
                      const label = document.querySelector('label[tabIndex="0"]') as HTMLElement;
                      if (label) label.blur();
                    }, 100);
                  }}
                  className="flex items-center gap-2 hover:bg-gray-100"
                >
                  <AdjustmentsHorizontalIcon className="w-4 h-4" />
                  Manage Groups
                </button>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {leads.length === 0 ? (
        <div className="text-center py-16 px-8 text-gray-500">
          <UserGroupIcon className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <p className="text-lg font-medium mb-1">No cases to manage contacts</p>
        </div>
      ) : viewMode === 'table' ? (
        /* Table View - Grouped by Groups */
        <div className="w-full space-y-6">
          <style>{`
            @keyframes slideIn {
              from {
                opacity: 0;
                transform: translateY(-10px);
              }
              to {
                opacity: 1;
                transform: translateY(0);
              }
            }
            @keyframes slideUp {
              from {
                opacity: 0;
                transform: translateY(20px);
              }
              to {
                opacity: 1;
                transform: translateY(0);
              }
            }
            .group-table-container {
              animation: slideIn 0.3s ease-out;
              transition: transform 0.3s ease-out, opacity 0.3s ease-out;
            }
            .group-table-container.moving {
              animation: slideUp 0.3s ease-out;
            }
          `}</style>
          {/* Render tables for each group */}
          {groups
            .sort((a, b) => (a.position || 0) - (b.position || 0))
            .map((group, groupIndex) => {
              const groupContacts = sortContactsWithPersecutedFirst(
                contacts.filter(c => c.group_id === group.id)
              );
              if (groupContacts.length === 0) return null;

              const canMoveUp = groupIndex > 0;
              const canMoveDown = groupIndex < groups.length - 1;

              const moveGroupUp = async () => {
                if (!canMoveUp) return;
                const sortedGroups = [...groups].sort((a, b) => (a.position || 0) - (b.position || 0));
                const currentGroup = sortedGroups[groupIndex];
                const previousGroup = sortedGroups[groupIndex - 1];

                const currentPosition = currentGroup.position || 0;
                const previousPosition = previousGroup.position || 0;

                try {
                  // Update both groups in the database
                  await supabase
                    .from('contact_groups')
                    .update({ position: previousPosition })
                    .eq('id', currentGroup.id);

                  await supabase
                    .from('contact_groups')
                    .update({ position: currentPosition })
                    .eq('id', previousGroup.id);

                  // Update local state
                  const newGroups = sortedGroups.map((g, idx) => {
                    if (idx === groupIndex) {
                      return { ...g, position: previousPosition };
                    } else if (idx === groupIndex - 1) {
                      return { ...g, position: currentPosition };
                    }
                    return g;
                  });

                  setGroups(newGroups);
                } catch (error) {
                  console.error('Error moving group up:', error);
                  toast.error('Failed to move group');
                }
              };

              const moveGroupDown = async () => {
                if (!canMoveDown) return;
                const sortedGroups = [...groups].sort((a, b) => (a.position || 0) - (b.position || 0));
                const currentGroup = sortedGroups[groupIndex];
                const nextGroup = sortedGroups[groupIndex + 1];

                const currentPosition = currentGroup.position || 0;
                const nextPosition = nextGroup.position || 0;

                try {
                  // Update both groups in the database
                  await supabase
                    .from('contact_groups')
                    .update({ position: nextPosition })
                    .eq('id', currentGroup.id);

                  await supabase
                    .from('contact_groups')
                    .update({ position: currentPosition })
                    .eq('id', nextGroup.id);

                  // Update local state
                  const newGroups = sortedGroups.map((g, idx) => {
                    if (idx === groupIndex) {
                      return { ...g, position: nextPosition };
                    } else if (idx === groupIndex + 1) {
                      return { ...g, position: currentPosition };
                    }
                    return g;
                  });

                  setGroups(newGroups);
                } catch (error) {
                  console.error('Error moving group down:', error);
                  toast.error('Failed to move group');
                }
              };

              return (
                <div
                  key={group.id}
                  className="bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden group-table-container"
                >
                  {/* Group Header */}
                  <div
                    className="px-6 py-4 border-b flex items-center justify-between bg-gray-50"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="text-lg font-bold text-gray-800">
                          {group.name}
                        </h4>
                      </div>
                      <p className="text-sm text-gray-600">{groupContacts.length} contact(s)</p>
                    </div>

                    {/* Dropdown with Up/Down arrows */}
                    <div className="dropdown dropdown-end">
                      <label tabIndex={0} className="btn btn-ghost btn-sm btn-circle" onClick={(e) => e.stopPropagation()}>
                        <EllipsisVerticalIcon className="w-5 h-5" />
                      </label>
                      <ul tabIndex={0} className="dropdown-content menu bg-base-100 rounded-box z-[100] w-40 p-2 shadow-lg border border-gray-200">
                        <li>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              moveGroupUp();
                              // Close dropdown by removing focus
                              setTimeout(() => {
                                const label = (e.currentTarget.closest('.dropdown')?.querySelector('label[tabIndex="0"]') as HTMLElement);
                                if (label) {
                                  label.blur();
                                }
                              }, 100);
                            }}
                            disabled={!canMoveUp}
                            className={`flex items-center gap-2 ${!canMoveUp ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-100'}`}
                          >
                            <ChevronUpIcon className="w-4 h-4" />
                            Move Up
                          </button>
                        </li>
                        <li>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              moveGroupDown();
                              // Close dropdown by removing focus
                              setTimeout(() => {
                                const label = (e.currentTarget.closest('.dropdown')?.querySelector('label[tabIndex="0"]') as HTMLElement);
                                if (label) {
                                  label.blur();
                                }
                              }, 100);
                            }}
                            disabled={!canMoveDown}
                            className={`flex items-center gap-2 ${!canMoveDown ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-100'}`}
                          >
                            <ChevronDownIcon className="w-4 h-4" />
                            Move Down
                          </button>
                        </li>
                        <li>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              setSelectedGroupForChange(group.id);
                              setShowChangeGroupModal(true);
                              // Close dropdown by removing focus
                              setTimeout(() => {
                                const label = (e.currentTarget.closest('.dropdown')?.querySelector('label[tabIndex="0"]') as HTMLElement);
                                if (label) {
                                  label.blur();
                                }
                              }, 100);
                            }}
                            className="flex items-center gap-2 hover:bg-gray-100"
                          >
                            <TagIcon className="w-4 h-4" />
                            Change Group
                          </button>
                        </li>
                      </ul>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="table w-full">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Relationship</th>
                          <th>Email</th>
                          <th>Phone</th>
                          <th>Mobile</th>
                          <th>Birth Date</th>
                          <th>Citizenship</th>
                          <th>Passport Number</th>
                          <th>ID Number</th>
                          <th>Address</th>
                          <th>Documents</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {groupContacts.map((contact) => {
                          const lead = leads.find(l => l.id === contact.lead_id);
                          return (
                            <tr key={contact.id} className="hover:bg-gray-50">
                              <td className="font-semibold">
                                <div className="flex items-center gap-2">
                                  <input
                                    type="checkbox"
                                    className="checkbox checkbox-primary checkbox-sm"
                                    checked={contact.is_main_applicant || contact.isMain || false}
                                    onChange={() => toggleMainApplicant(contact.id, contact.group_id || null)}
                                    title="Mark as main applicant"
                                  />
                                  <span>{contact.name}</span>
                                </div>
                              </td>
                              <td>
                                {contact.relationship ? (
                                  <span>{contact.relationship.replace('_', ' ')}</span>
                                ) : (
                                  <span className="text-gray-400">-</span>
                                )}
                              </td>
                              <td>{contact.email || <span className="text-gray-400">-</span>}</td>
                              <td>{contact.phone || <span className="text-gray-400">-</span>}</td>
                              <td>{contact.mobile || <span className="text-gray-400">-</span>}</td>
                              <td>
                                {contact.birth_date ? (
                                  new Date(contact.birth_date).toLocaleDateString()
                                ) : (
                                  <span className="text-gray-400">-</span>
                                )}
                              </td>
                              <td>{contact.citizenship || <span className="text-gray-400">-</span>}</td>
                              <td>{contact.passport_number || <span className="text-gray-400">-</span>}</td>
                              <td>{contact.id_number || <span className="text-gray-400">-</span>}</td>
                              <td>{contact.current_address || <span className="text-gray-400">-</span>}</td>
                              <td>
                                {!contact.is_legacy ? (
                                  <div className="flex flex-col gap-1">
                                    <span className="text-xs font-semibold">
                                      {contact.completed_documents || 0}/{contact.document_count || 0}
                                    </span>
                                    <progress
                                      className="progress progress-primary w-full h-1"
                                      value={contact.completion_percentage || 0}
                                      max="100"
                                    ></progress>
                                  </div>
                                ) : (
                                  <span className="text-gray-400">-</span>
                                )}
                              </td>
                              <td>
                                <div className="flex gap-1">
                                  <button
                                    className="btn btn-ghost btn-xs text-purple-600 hover:bg-purple-600 hover:text-white"
                                    onClick={() => setEditingContact(contact)}
                                    title="Edit"
                                  >
                                    <PencilIcon className="w-4 h-4" />
                                  </button>
                                  <button
                                    className="btn btn-ghost btn-xs text-red-600 hover:bg-red-600 hover:text-white"
                                    onClick={() => deleteContact(contact.id)}
                                    title="Delete"
                                  >
                                    <TrashIcon className="w-4 h-4" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}

          {/* Table for contacts without a group */}
          {(() => {
            const ungroupedContacts = sortContactsWithPersecutedFirst(
              contacts.filter(c => !c.group_id)
            );
            if (ungroupedContacts.length === 0 && groups.length > 0) return null;

            return (
              <div className="bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden">
                {/* Ungrouped Header */}
                <div className="px-6 py-4 border-b bg-gray-50">
                  <h4 className="text-lg font-bold text-gray-700">Ungrouped Contacts</h4>
                  <p className="text-sm text-gray-600">{ungroupedContacts.length} contact(s)</p>
                </div>

                <div className="overflow-x-auto">
                  <table className="table w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th>Name</th>
                        <th>Relationship</th>
                        <th>Email</th>
                        <th>Phone</th>
                        <th>Mobile</th>
                        <th>Birth Date</th>
                        <th>Citizenship</th>
                        <th>Passport Number</th>
                        <th>ID Number</th>
                        <th>Address</th>
                        <th>Documents</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ungroupedContacts.length === 0 ? (
                        <tr>
                          <td colSpan={12} className="text-center py-16 text-gray-500">
                            <UserGroupIcon className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                            <p className="text-sm">No contacts found</p>
                          </td>
                        </tr>
                      ) : (
                        ungroupedContacts.map((contact) => {
                          const lead = leads.find(l => l.id === contact.lead_id);
                          return (
                            <tr key={contact.id} className="hover:bg-gray-50">
                              <td className="font-semibold">{contact.name}</td>
                              <td>
                                {contact.relationship ? (
                                  <span>{contact.relationship.replace('_', ' ')}</span>
                                ) : (
                                  <span className="text-gray-400">-</span>
                                )}
                              </td>
                              <td>{contact.email || <span className="text-gray-400">-</span>}</td>
                              <td>{contact.phone || <span className="text-gray-400">-</span>}</td>
                              <td>{contact.mobile || <span className="text-gray-400">-</span>}</td>
                              <td>
                                {contact.birth_date ? (
                                  new Date(contact.birth_date).toLocaleDateString()
                                ) : (
                                  <span className="text-gray-400">-</span>
                                )}
                              </td>
                              <td>{contact.citizenship || <span className="text-gray-400">-</span>}</td>
                              <td>{contact.passport_number || <span className="text-gray-400">-</span>}</td>
                              <td>{contact.id_number || <span className="text-gray-400">-</span>}</td>
                              <td>{contact.current_address || <span className="text-gray-400">-</span>}</td>
                              <td>
                                {!contact.is_legacy ? (
                                  <div className="flex flex-col gap-1">
                                    <span className="text-xs font-semibold">
                                      {contact.completed_documents || 0}/{contact.document_count || 0}
                                    </span>
                                    <progress
                                      className="progress progress-primary w-full h-1"
                                      value={contact.completion_percentage || 0}
                                      max="100"
                                    ></progress>
                                  </div>
                                ) : (
                                  <span className="text-gray-400">-</span>
                                )}
                              </td>
                              <td>
                                <div className="flex gap-1">
                                  <button
                                    className="btn btn-ghost btn-xs text-purple-600 hover:bg-purple-600 hover:text-white"
                                    onClick={() => setEditingContact(contact)}
                                    title="Edit"
                                  >
                                    <PencilIcon className="w-4 h-4" />
                                  </button>
                                  <button
                                    className="btn btn-ghost btn-xs text-red-600 hover:bg-red-600 hover:text-white"
                                    onClick={() => deleteContact(contact.id)}
                                    title="Delete"
                                  >
                                    <TrashIcon className="w-4 h-4" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}
        </div>
      ) : (
        /* Box View */
        <div className="w-full">
          {leads.map((lead) => {
            const isLegacyLead = lead.id.startsWith('legacy_');
            const leadContacts = sortContactsWithPersecutedFirst(contactsByLead[lead.id] || []);

            return (
              <div key={lead.id} className="w-full bg-white rounded-2xl p-3 sm:p-8 shadow-lg border border-gray-200 mb-4 sm:mb-8">
                <div className="flex items-center justify-between mb-4 sm:mb-6">
                  <div>
                    <h4 className="text-base sm:text-lg font-bold text-gray-900">{lead.name}</h4>
                    <p className="text-blue-600 font-medium text-sm sm:text-base">Lead #{lead.lead_number}</p>
                    <p className="text-xs sm:text-sm text-gray-500">
                      {isLegacyLead ? `${leadContacts.length} contact(s)` : `${leadContacts.length} family member(s)`}
                    </p>
                  </div>
                </div>

                {/* Contacts Grid */}
                {leadContacts.length === 0 ? (
                  <div className="text-center py-16 px-8 text-gray-500">
                    <UserGroupIcon className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                    <p className="text-sm">No contacts found</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-6">
                    {leadContacts.map((contact) => (
                      <div key={contact.id} className="bg-white rounded-xl shadow-lg border border-gray-200 hover:shadow-xl transition-all duration-300 ease-in-out transform hover:-translate-y-1 group flex flex-col h-full">
                        <div className="card-body p-3 sm:p-5 flex flex-col h-full">
                          <div className="flex justify-between items-start mb-2">
                            <div className="flex items-center gap-2 flex-1">
                              <input
                                type="checkbox"
                                className="checkbox checkbox-primary checkbox-sm"
                                checked={contact.is_main_applicant || contact.isMain || false}
                                onChange={() => toggleMainApplicant(contact.id, contact.group_id || null)}
                                title="Mark as main applicant"
                                onClick={(e) => e.stopPropagation()}
                              />
                              <h2 className="card-title text-base sm:text-xl font-bold group-hover:text-primary transition-colors">
                                {contact.name}
                              </h2>
                            </div>
                            <div className="flex gap-1 sm:gap-2">
                              <button
                                className="btn btn-ghost text-purple-600 hover:bg-purple-600 hover:text-white btn-xs sm:btn-sm"
                                onClick={() => setEditingContact(contact)}
                              >
                                <PencilIcon className="w-4 h-4 sm:w-5 sm:h-5" />
                              </button>
                              <button
                                className="btn btn-ghost text-purple-600 hover:bg-purple-600 hover:text-white btn-xs sm:btn-sm"
                                onClick={() => deleteContact(contact.id)}
                              >
                                <TrashIcon className="w-4 h-4 sm:w-5 sm:h-5" />
                              </button>
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-1 mb-3 sm:mb-4">
                            {contact.relationship && (
                              <span className="badge badge-xs sm:badge-sm bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none">
                                {contact.relationship.replace('_', ' ')}
                              </span>
                            )}
                            {(contact.is_main_applicant || contact.isMain) && (
                              <span className="badge badge-xs sm:badge-sm bg-gradient-to-r from-blue-500 to-blue-600 text-white border-none">
                                Main
                              </span>
                            )}
                            {contact.is_persecuted && (
                              <span className="badge badge-xs sm:badge-sm bg-gradient-to-r from-red-500 to-red-600 text-white border-none">
                                Persecuted
                              </span>
                            )}
                            {contact.is_legacy && (
                              <span className="badge badge-xs sm:badge-sm bg-gray-500 text-white border-none">
                                Legacy
                              </span>
                            )}
                          </div>

                          <div className="divider my-0"></div>

                          {/* Contact Info Grid */}
                          <div className="grid grid-cols-2 gap-x-2 sm:gap-x-4 gap-y-2 sm:gap-y-3 mt-3 sm:mt-4 flex-grow">
                            {contact.email && (
                              <div className="flex flex-col gap-1">
                                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Email</span>
                                <span className="text-xs sm:text-sm font-medium truncate" title={contact.email}>
                                  {contact.email}
                                </span>
                              </div>
                            )}
                            {contact.phone && (
                              <div className="flex flex-col gap-1">
                                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Phone</span>
                                <span className="text-xs sm:text-sm font-medium">{contact.phone}</span>
                              </div>
                            )}
                            {contact.mobile && (
                              <div className="flex flex-col gap-1">
                                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Mobile</span>
                                <span className="text-xs sm:text-sm font-medium">{contact.mobile}</span>
                              </div>
                            )}
                            {contact.birth_date && (
                              <div className="flex flex-col gap-1">
                                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Birth Date</span>
                                <span className="text-xs sm:text-sm font-medium">{new Date(contact.birth_date).toLocaleDateString()}</span>
                              </div>
                            )}
                            {contact.citizenship && (
                              <div className="flex flex-col gap-1">
                                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Citizenship</span>
                                <span className="text-xs sm:text-sm font-medium">{contact.citizenship}</span>
                              </div>
                            )}
                            {contact.birth_place && (
                              <div className="flex flex-col gap-1">
                                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Birth Place</span>
                                <span className="text-xs sm:text-sm font-medium">{contact.birth_place}</span>
                              </div>
                            )}
                            {contact.current_address && (
                              <div className="flex flex-col gap-1">
                                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Address</span>
                                <span className="text-xs sm:text-sm font-medium">{contact.current_address}</span>
                              </div>
                            )}
                            {contact.passport_number && (
                              <div className="flex flex-col gap-1">
                                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Passport</span>
                                <span className="text-xs sm:text-sm font-medium">{contact.passport_number}</span>
                              </div>
                            )}
                            {contact.id_number && (
                              <div className="flex flex-col gap-1">
                                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">ID Number</span>
                                <span className="text-xs sm:text-sm font-medium">{contact.id_number}</span>
                              </div>
                            )}
                          </div>

                          {/* Document Status - Always at bottom (only for new leads) */}
                          {!contact.is_legacy && (
                            <div className="mt-auto pt-3 sm:pt-4 border-t border-base-200/50">
                              <div className="flex flex-col gap-2">
                                <div className="flex justify-between items-center">
                                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Documents</span>
                                  <span className="text-xs sm:text-sm font-bold">
                                    {contact.completed_documents || 0}/{contact.document_count || 0}
                                  </span>
                                </div>

                                <div className="flex items-center gap-3">
                                  <div className="flex-1">
                                    <progress
                                      className="progress progress-primary w-full h-2"
                                      value={contact.completion_percentage || 0}
                                      max="100"
                                    ></progress>
                                  </div>
                                  <span className={`badge border-none text-white ${getDocumentStatusColor(contact.completion_percentage || 0)}`}>
                                    {contact.completion_percentage || 0}%
                                  </span>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add Contact Modal */}
      {showAddContactModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/30">
          <div className="bg-white rounded-2xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold">Add Applicant</h3>
              <button
                onClick={() => {
                  setShowAddContactModal(false);
                }}
                className="btn btn-ghost btn-circle btn-sm"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={newContact.name}
                  onChange={(e) => setNewContact(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Enter full name..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Relationship to Persecuted Person *</label>
                <select
                  className="select select-bordered w-full"
                  value={newContact.relationship}
                  onChange={(e) => setNewContact(prev => ({ ...prev, relationship: e.target.value as Contact['relationship'] }))}
                >
                  <option value="persecuted_person">Persecuted Person</option>
                  <option value="spouse">Spouse</option>
                  <option value="child">Child</option>
                  <option value="parent">Parent</option>
                  <option value="sibling">Sibling</option>
                  <option value="grandchild">Grandchild</option>
                  <option value="grandson">Grandson</option>
                  <option value="granddaughter">Granddaughter</option>
                  <option value="grandparent">Grandparent</option>
                  <option value="great_grandchild">Great Grandchild</option>
                  <option value="great_grandson">Great Grandson</option>
                  <option value="great_granddaughter">Great Granddaughter</option>
                  <option value="great_grandparent">Great Grandparent</option>
                  <option value="nephew">Nephew</option>
                  <option value="niece">Niece</option>
                  <option value="cousin">Cousin</option>
                  <option value="uncle">Uncle</option>
                  <option value="aunt">Aunt</option>
                  <option value="in_law">In-Law</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  className="input input-bordered w-full"
                  value={newContact.email}
                  onChange={(e) => setNewContact(prev => ({ ...prev, email: e.target.value }))}
                  placeholder="email@example.com"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                <input
                  type="tel"
                  className="input input-bordered w-full"
                  value={newContact.phone}
                  onChange={(e) => setNewContact(prev => ({ ...prev, phone: e.target.value }))}
                  placeholder="+1234567890"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Mobile</label>
                <input
                  type="tel"
                  className="input input-bordered w-full"
                  value={newContact.mobile}
                  onChange={(e) => setNewContact(prev => ({ ...prev, mobile: e.target.value }))}
                  placeholder="+1234567890"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Birth Date</label>
                <input
                  type="date"
                  className="input input-bordered w-full"
                  value={newContact.birth_date}
                  onChange={(e) => setNewContact(prev => ({ ...prev, birth_date: e.target.value }))}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Death Date</label>
                <input
                  type="date"
                  className="input input-bordered w-full"
                  value={newContact.death_date}
                  onChange={(e) => setNewContact(prev => ({ ...prev, death_date: e.target.value }))}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Birth Place</label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={newContact.birth_place}
                  onChange={(e) => setNewContact(prev => ({ ...prev, birth_place: e.target.value }))}
                  placeholder="City, Country"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Citizenship</label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={newContact.citizenship}
                  onChange={(e) => setNewContact(prev => ({ ...prev, citizenship: e.target.value }))}
                  placeholder="Country"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Passport Number</label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={newContact.passport_number}
                  onChange={(e) => setNewContact(prev => ({ ...prev, passport_number: e.target.value }))}
                  placeholder="Passport number"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ID Number</label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={newContact.id_number}
                  onChange={(e) => setNewContact(prev => ({ ...prev, id_number: e.target.value }))}
                  placeholder="ID number"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Current Address</label>
                <textarea
                  className="textarea textarea-bordered w-full h-20 resize-none"
                  value={newContact.current_address}
                  onChange={(e) => setNewContact(prev => ({ ...prev, current_address: e.target.value }))}
                  placeholder="Current address..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Group</label>
                <select
                  className="select select-bordered w-full"
                  value={newContact.group_id || ''}
                  onChange={(e) => setNewContact(prev => ({ ...prev, group_id: e.target.value || null }))}
                >
                  <option value="">No Group</option>
                  {groups.map(group => (
                    <option key={group.id} value={group.id}>{group.name}</option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-primary"
                    checked={newContact.is_persecuted}
                    onChange={(e) => setNewContact(prev => ({ ...prev, is_persecuted: e.target.checked }))}
                  />
                  <label className="text-sm font-medium text-gray-700">Subject to persecution</label>
                </div>
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Persecution Details (JSON)</label>
                <textarea
                  className="textarea textarea-bordered w-full h-20 resize-none font-mono text-xs"
                  value={newContact.persecution_details ? JSON.stringify(newContact.persecution_details, null, 2) : ''}
                  onChange={(e) => {
                    try {
                      const parsed = e.target.value ? JSON.parse(e.target.value) : null;
                      setNewContact(prev => ({ ...prev, persecution_details: parsed }));
                    } catch (err) {
                      // Invalid JSON, don't update
                    }
                  }}
                  placeholder='{"details": "..."}'
                />
                <p className="text-xs text-gray-500 mt-1">Enter JSON format for persecution details</p>
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  className="textarea textarea-bordered w-full h-20 resize-none"
                  value={newContact.contact_notes}
                  onChange={(e) => setNewContact(prev => ({ ...prev, contact_notes: e.target.value }))}
                  placeholder="Additional notes about this contact..."
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                className="btn btn-outline flex-1"
                onClick={() => {
                  setShowAddContactModal(false);
                }}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary flex-1"
                onClick={addContact}
              >
                Add Applicant
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Contact Modal */}
      {editingContact && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/30">
          <div className="bg-white rounded-2xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold">{editingContact.is_legacy ? 'Edit Contact' : 'Edit Family Member'}</h3>
              <button
                onClick={() => setEditingContact(null)}
                className="btn btn-ghost btn-circle btn-sm"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={editingContact.name}
                  onChange={(e) => setEditingContact(prev => prev ? ({ ...prev, name: e.target.value }) : null)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Relationship</label>
                <select
                  className="select select-bordered w-full"
                  value={editingContact.relationship || 'other'}
                  onChange={(e) => setEditingContact(prev => prev ? ({ ...prev, relationship: e.target.value as Contact['relationship'] }) : null)}
                >
                  <option value="persecuted_person">Persecuted Person</option>
                  <option value="spouse">Spouse</option>
                  <option value="child">Child</option>
                  <option value="parent">Parent</option>
                  <option value="sibling">Sibling</option>
                  <option value="grandchild">Grandchild</option>
                  <option value="grandson">Grandson</option>
                  <option value="granddaughter">Granddaughter</option>
                  <option value="grandparent">Grandparent</option>
                  <option value="great_grandchild">Great Grandchild</option>
                  <option value="great_grandson">Great Grandson</option>
                  <option value="great_granddaughter">Great Granddaughter</option>
                  <option value="great_grandparent">Great Grandparent</option>
                  <option value="nephew">Nephew</option>
                  <option value="niece">Niece</option>
                  <option value="cousin">Cousin</option>
                  <option value="uncle">Uncle</option>
                  <option value="aunt">Aunt</option>
                  <option value="in_law">In-Law</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  className="input input-bordered w-full"
                  value={editingContact.email || ''}
                  onChange={(e) => setEditingContact(prev => prev ? ({ ...prev, email: e.target.value }) : null)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                <input
                  type="tel"
                  className="input input-bordered w-full"
                  value={editingContact.phone || ''}
                  onChange={(e) => setEditingContact(prev => prev ? ({ ...prev, phone: e.target.value }) : null)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Mobile</label>
                <input
                  type="tel"
                  className="input input-bordered w-full"
                  value={editingContact.mobile || ''}
                  onChange={(e) => setEditingContact(prev => prev ? ({ ...prev, mobile: e.target.value }) : null)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Birth Date</label>
                <input
                  type="date"
                  className="input input-bordered w-full"
                  value={editingContact.birth_date ? editingContact.birth_date.split('T')[0] : ''}
                  onChange={(e) => setEditingContact(prev => prev ? ({ ...prev, birth_date: e.target.value }) : null)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Death Date</label>
                <input
                  type="date"
                  className="input input-bordered w-full"
                  value={editingContact.death_date ? editingContact.death_date.split('T')[0] : ''}
                  onChange={(e) => setEditingContact(prev => prev ? ({ ...prev, death_date: e.target.value }) : null)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Birth Place</label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={editingContact.birth_place || ''}
                  onChange={(e) => setEditingContact(prev => prev ? ({ ...prev, birth_place: e.target.value }) : null)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Citizenship</label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={editingContact.citizenship || ''}
                  onChange={(e) => setEditingContact(prev => prev ? ({ ...prev, citizenship: e.target.value }) : null)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Passport Number</label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={editingContact.passport_number || ''}
                  onChange={(e) => setEditingContact(prev => prev ? ({ ...prev, passport_number: e.target.value }) : null)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ID Number</label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={editingContact.id_number || ''}
                  onChange={(e) => setEditingContact(prev => prev ? ({ ...prev, id_number: e.target.value }) : null)}
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Current Address</label>
                <textarea
                  className="textarea textarea-bordered w-full h-20 resize-none"
                  value={editingContact.current_address || ''}
                  onChange={(e) => setEditingContact(prev => prev ? ({ ...prev, current_address: e.target.value }) : null)}
                />
              </div>

              <div className="md:col-span-2">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-primary"
                    checked={editingContact.is_persecuted || false}
                    onChange={(e) => setEditingContact(prev => prev ? ({ ...prev, is_persecuted: e.target.checked }) : null)}
                  />
                  <label className="text-sm font-medium text-gray-700">Subject to persecution</label>
                </div>
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Persecution Details (JSON)</label>
                <textarea
                  className="textarea textarea-bordered w-full h-20 resize-none font-mono text-xs"
                  value={editingContact.persecution_details ? JSON.stringify(editingContact.persecution_details, null, 2) : ''}
                  onChange={(e) => {
                    try {
                      const parsed = e.target.value ? JSON.parse(e.target.value) : null;
                      setEditingContact(prev => prev ? ({ ...prev, persecution_details: parsed }) : null);
                    } catch (err) {
                      // Invalid JSON, don't update
                    }
                  }}
                  placeholder='{"details": "..."}'
                />
                <p className="text-xs text-gray-500 mt-1">Enter JSON format for persecution details</p>
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  className="textarea textarea-bordered w-full h-20 resize-none"
                  value={editingContact.contact_notes || ''}
                  onChange={(e) => setEditingContact(prev => prev ? ({ ...prev, contact_notes: e.target.value }) : null)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Group</label>
                <select
                  className="select select-bordered w-full"
                  value={editingContact.group_id || ''}
                  onChange={(e) => setEditingContact(prev => prev ? ({ ...prev, group_id: e.target.value || null }) : null)}
                >
                  <option value="">No Group</option>
                  {groups.map(group => (
                    <option key={group.id} value={group.id}>{group.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                className="btn btn-outline flex-1"
                onClick={() => setEditingContact(null)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary flex-1"
                onClick={updateContact}
              >
                {editingContact.is_legacy ? 'Update Contact' : 'Update Family Member'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Change Group Modal */}
      {showChangeGroupModal && selectedGroupForChange && (() => {
        const groupContacts = contacts.filter(c => c.group_id === selectedGroupForChange);
        const currentGroup = groups.find(g => g.id === selectedGroupForChange);

        const handleBulkChange = async () => {
          if (!targetGroupId && targetGroupId !== '') {
            toast.error('Please select a target group');
            return;
          }

          if (selectedContactsForChange.size === 0) {
            toast.error('Please select at least one contact');
            return;
          }

          try {
            const updatePromises = Array.from(selectedContactsForChange).map(contactId =>
              updateContactGroup(contactId, targetGroupId || null)
            );
            await Promise.all(updatePromises);

            const targetGroupName = targetGroupId ? groups.find(g => g.id === targetGroupId)?.name || 'new group' : 'No Group';
            toast.success(`Moved ${selectedContactsForChange.size} contact(s) to ${targetGroupName}`);
            await fetchContacts();
            setShowChangeGroupModal(false);
            setSelectedGroupForChange(null);
            setTargetGroupId('');
            setSelectedContactsForChange(new Set());
          } catch (error) {
            toast.error('Failed to change groups');
            console.error('Error changing groups:', error);
          }
        };

        return (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/30">
            <div className="bg-white rounded-2xl p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold">Change Group for Contacts</h3>
                <button
                  onClick={() => {
                    setShowChangeGroupModal(false);
                    setSelectedGroupForChange(null);
                  }}
                  className="btn btn-ghost btn-circle btn-sm"
                >
                  <XMarkIcon className="w-5 h-5" />
                </button>
              </div>

              <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-600">
                  Current group: <strong>{currentGroup?.name || 'Unknown'}</strong>
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {groupContacts.length} contact(s) in this group
                </p>
              </div>

              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">Select New Group</label>
                <select
                  className="select select-bordered w-full"
                  value={targetGroupId}
                  onChange={(e) => setTargetGroupId(e.target.value)}
                >
                  <option value="">Select a group...</option>
                  {groups.filter(g => g.id !== selectedGroupForChange).map(group => (
                    <option key={group.id} value={group.id}>{group.name}</option>
                  ))}
                  <option value="">Remove from group</option>
                </select>
              </div>

              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-700">Select Contacts to Move</label>
                  <button
                    className="btn btn-ghost btn-xs"
                    onClick={() => {
                      if (selectedContactsForChange.size === groupContacts.length) {
                        setSelectedContactsForChange(new Set());
                      } else {
                        setSelectedContactsForChange(new Set(groupContacts.map(c => c.id)));
                      }
                    }}
                  >
                    {selectedContactsForChange.size === groupContacts.length ? 'Deselect All' : 'Select All'}
                  </button>
                </div>
                <div className="max-h-96 overflow-y-auto border border-gray-200 rounded-lg">
                  <table className="table w-full">
                    <thead className="sticky top-0">
                      <tr>
                        <th className="w-12">
                          <input
                            type="checkbox"
                            className="checkbox checkbox-sm"
                            checked={selectedContactsForChange.size === groupContacts.length && groupContacts.length > 0}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedContactsForChange(new Set(groupContacts.map(c => c.id)));
                              } else {
                                setSelectedContactsForChange(new Set());
                              }
                            }}
                          />
                        </th>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Relationship</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupContacts.map((contact) => (
                        <tr key={contact.id} className="hover:bg-gray-50">
                          <td>
                            <input
                              type="checkbox"
                              className="checkbox checkbox-sm"
                              checked={selectedContactsForChange.has(contact.id)}
                              onChange={(e) => {
                                const newSelected = new Set(selectedContactsForChange);
                                if (e.target.checked) {
                                  newSelected.add(contact.id);
                                } else {
                                  newSelected.delete(contact.id);
                                }
                                setSelectedContactsForChange(newSelected);
                              }}
                            />
                          </td>
                          <td className="font-semibold">{contact.name}</td>
                          <td>{contact.email || <span className="text-gray-400">-</span>}</td>
                          <td>
                            {contact.relationship ? (
                              <span>{contact.relationship.replace('_', ' ')}</span>
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  className="btn btn-outline flex-1"
                  onClick={() => {
                    setShowChangeGroupModal(false);
                    setSelectedGroupForChange(null);
                    setTargetGroupId('');
                    setSelectedContactsForChange(new Set());
                  }}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary flex-1"
                  onClick={handleBulkChange}
                  disabled={(!targetGroupId && targetGroupId !== '') || selectedContactsForChange.size === 0}
                >
                  Move {selectedContactsForChange.size} Contact(s) to {targetGroupId ? groups.find(g => g.id === targetGroupId)?.name || 'Selected Group' : 'No Group'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Group Management Modal */}
      {showGroupModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/30">
          <div className="bg-white rounded-2xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold">Manage Groups</h3>
              <button
                onClick={() => {
                  setShowGroupModal(false);
                  setEditingGroup(null);
                  setNewGroup({ name: '' });
                }}
                className="btn btn-ghost btn-circle btn-sm"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            {/* Create/Edit Group Form */}
            <div className="mb-6 p-4">
              <h4 className="font-semibold mb-4">{editingGroup ? 'Edit Group' : 'Create New Group'}</h4>
              <div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Group Name *</label>
                  <input
                    type="text"
                    className="input input-bordered w-full"
                    value={editingGroup ? editingGroup.name : newGroup.name}
                    onChange={(e) => editingGroup
                      ? setEditingGroup({ ...editingGroup, name: e.target.value })
                      : setNewGroup({ ...newGroup, name: e.target.value })
                    }
                    placeholder="Enter group name..."
                  />
                </div>
              </div>
              <div className="flex gap-3 mt-4">
                {editingGroup ? (
                  <>
                    <button
                      className="btn btn-outline flex-1"
                      onClick={() => {
                        setEditingGroup(null);
                        setNewGroup({ name: '' });
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      className="btn btn-primary flex-1"
                      onClick={updateGroup}
                    >
                      Update Group
                    </button>
                  </>
                ) : (
                  <button
                    className="btn btn-primary w-full"
                    onClick={createGroup}
                  >
                    <PlusIcon className="w-4 h-4 mr-2" />
                    Create Group
                  </button>
                )}
              </div>
            </div>

            {/* Groups List */}
            <div>
              <h4 className="font-semibold mb-4">Existing Groups</h4>
              {groups.length === 0 ? (
                <p className="text-gray-500 text-center py-8">No groups created yet</p>
              ) : (
                <div className="space-y-2">
                  {groups.map((group) => (
                    <div
                      key={group.id}
                      className="flex items-center justify-between p-3"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{group.name}</span>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={() => setEditingGroup(group)}
                        >
                          <PencilIcon className="w-4 h-4" />
                        </button>
                        <button
                          className="btn btn-sm btn-ghost text-red-600"
                          onClick={() => {
                            if (confirm(`Delete group "${group.name}"? Contacts in this group will be unassigned.`)) {
                              deleteGroup(group.id);
                            }
                          }}
                        >
                          <TrashIcon className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};


export default ContactsTab; 