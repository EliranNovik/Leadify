import React, { useState, useEffect } from 'react';
import {
  FolderIcon,
  DocumentArrowUpIcon,
  PaperClipIcon,
  CheckCircleIcon,
  XCircleIcon,
  UserIcon,
  CalendarIcon,
  DocumentTextIcon,
  ClipboardDocumentListIcon,
  UserGroupIcon,
  LinkIcon,
  ChatBubbleLeftRightIcon,
  ExclamationTriangleIcon,
  CheckBadgeIcon,
  XMarkIcon,
  EyeIcon
} from '@heroicons/react/24/outline';
import { StarIcon } from '@heroicons/react/24/solid';
import { supabase } from '../../lib/supabase';
import { toast } from 'react-hot-toast';
import UploadDocumentModal from './UploadDocumentModal';
import DocumentModal from '../DocumentModal';

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
  notes?: string;
  expert_notes?: any[];
  section_eligibility?: string;
  facts?: string;
  meeting_brief?: string;
  eligibility_status?: string;
}

interface UploadedFile {
  name: string;
  status: 'uploading' | 'success' | 'error';
  progress?: number;
  error?: string;
}

interface HandlerTabProps {
  leads: HandlerLead[];
  uploadFiles: (lead: HandlerLead, files: File[]) => Promise<void>;
  uploadingLeadId: string | null;
  uploadedFiles: { [leadId: string]: UploadedFile[] };
  isUploading: boolean;
  handleFileInput: (lead: HandlerLead, e: React.ChangeEvent<HTMLInputElement>) => void;
  refreshLeads: () => Promise<void>;
  getStageDisplayName?: (stage: string | number | null | undefined) => string;
}

const CasesTab: React.FC<HandlerTabProps> = ({
  leads,
  uploadFiles,
  uploadingLeadId,
  uploadedFiles,
  isUploading,
  handleFileInput,
  getStageDisplayName
}) => {
  const [selectedLead, setSelectedLead] = useState<HandlerLead | null>(null);
  const [caseData, setCaseData] = useState<{ [key: string]: any }>({});
  const [showDocumentModal, setShowDocumentModal] = useState(false);
  const [selectedLeadForDocs, setSelectedLeadForDocs] = useState<HandlerLead | null>(null);
  const [oneDriveFiles, setOneDriveFiles] = useState<any[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [applicantCounts, setApplicantCounts] = useState<{ [key: string]: number }>({});
  const [contractLinks, setContractLinks] = useState<{ [key: string]: Array<{ link: string, contactName: string }> }>({});
  const [allCategories, setAllCategories] = useState<any[]>([]);
  const [allEmployees, setAllEmployees] = useState<any[]>([]);
  const [contactsCounts, setContactsCounts] = useState<{ [key: string]: number }>({});
  const [contacts, setContacts] = useState<{ [leadId: string]: any[] }>({});
  const [groups, setGroups] = useState<{ [groupId: string]: { id: string; name: string } }>({});
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [selectedLeadForUpload, setSelectedLeadForUpload] = useState<HandlerLead | null>(null);
  const [currentUser, setCurrentUser] = useState<{ id: string, full_name: string } | null>(null);
  const [isDocumentModalOpen, setIsDocumentModalOpen] = useState(false);
  const [selectedLeadForDocumentModal, setSelectedLeadForDocumentModal] = useState<HandlerLead | null>(null);

  // Helper function to strip HTML tags from text while preserving line breaks
  const stripHtmlTags = (html: string | null | undefined): string => {
    if (!html) return '';

    // First, replace <br> and <br/> tags with newlines
    let text = html.replace(/<br\s*\/?>/gi, '\n');

    // Replace block-level elements with newlines before extracting text
    // Common block elements: p, div, h1-h6, li, tr, etc.
    text = text.replace(/<\/?(p|div|h[1-6]|li|tr|td|th|blockquote|pre|section|article|header|footer|nav|aside)\b[^>]*>/gi, '\n');

    // Create a temporary div element to parse HTML and extract text
    const tmp = document.createElement('div');
    tmp.innerHTML = text;
    const extractedText = tmp.textContent || tmp.innerText || '';

    // Normalize multiple consecutive newlines (collapse 3+ to 2)
    return extractedText.replace(/\n{3,}/g, '\n\n');
  };

  // Helper function to detect Hebrew text and return RTL direction
  const getTextDirection = (text: string | null | undefined): 'rtl' | 'ltr' => {
    if (!text) return 'ltr';
    // Check if text contains Hebrew characters (Unicode range 0590-05FF)
    const hebrewRegex = /[\u0590-\u05FF]/;
    return hebrewRegex.test(text) ? 'rtl' : 'ltr';
  };

  // Fetch current user
  useEffect(() => {
    const fetchCurrentUser = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: userData } = await supabase
            .from('users')
            .select('id, full_name')
            .eq('id', user.id)
            .single();

          if (userData) {
            setCurrentUser({ id: userData.id, full_name: userData.full_name || '' });
          }
        }
      } catch (error) {
        console.error('Error fetching current user:', error);
      }
    };

    fetchCurrentUser();
  }, []);

  // Fetch all categories for category display name resolution
  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const { data, error } = await supabase
          .from('misc_category')
          .select(`
            id,
            name,
            parent_id,
            misc_maincategory!parent_id(
              id,
              name
            )
          `)
          .order('name');

        if (error) throw error;
        if (data) setAllCategories(data);
      } catch (error) {
        console.error('Error fetching categories:', error);
      }
    };

    fetchCategories();
  }, []);

  // Fetch all employees for avatars
  useEffect(() => {
    const fetchEmployees = async () => {
      try {
        const { data, error } = await supabase
          .from('tenants_employee')
          .select('id, display_name, photo_url, photo')
          .order('display_name');

        if (error) throw error;
        if (data) setAllEmployees(data);
      } catch (error) {
        console.error('Error fetching employees:', error);
      }
    };

    fetchEmployees();
  }, []);

  // Fetch contacts count for applicants (matching ContactsTab logic)
  useEffect(() => {
    const fetchContactsCount = async () => {
      if (leads.length === 0) return;

      try {
        const newLeads = leads.filter(lead => !lead.id.startsWith('legacy_'));
        const legacyLeads = leads.filter(lead => lead.id.startsWith('legacy_'));

        const countsMap: { [key: string]: number } = {};

        // Fetch contacts for new leads
        if (newLeads.length > 0) {
          const newLeadIds = newLeads.map(lead => lead.id);
          console.log('🔍 CasesTab - Fetching contacts count for new leads:', newLeadIds);

          const { data: contactsData, error } = await supabase
            .from('contacts')
            .select('lead_id')
            .in('lead_id', newLeadIds);

          if (error) {
            console.error('❌ CasesTab - Error fetching contacts for new leads:', error);
          } else if (contactsData) {
            console.log('🔍 CasesTab - Found', contactsData.length, 'contacts for new leads');
            contactsData.forEach(contact => {
              if (contact.lead_id && newLeadIds.includes(contact.lead_id)) {
                countsMap[contact.lead_id] = (countsMap[contact.lead_id] || 0) + 1;
              }
            });
            console.log('🔍 CasesTab - Contacts counts for new leads:', countsMap);
          }
        }

        // Fetch contacts for legacy leads (using same pattern as ContactsTab)
        if (legacyLeads.length > 0) {
          console.log('🔍 CasesTab - Fetching contacts count for legacy leads:', legacyLeads.length);

          for (const legacyLead of legacyLeads) {
            const legacyId = legacyLead.id.replace('legacy_', '');
            const legacyIdPattern = `[LEGACY_LEAD_ID:${legacyId}]`;

            console.log('🔍 CasesTab - Checking legacy lead:', legacyId, 'pattern:', legacyIdPattern);

            // First, try to fetch from unified contacts table (if migrated)
            const { data: migratedContacts, error: migratedError } = await supabase
              .from('contacts')
              .select('id')
              .like('contact_notes', `%${legacyIdPattern}%`);

            if (!migratedError && migratedContacts) {
              countsMap[legacyLead.id] = migratedContacts.length;
              console.log('🔍 CasesTab - Found', migratedContacts.length, 'contacts for legacy lead', legacyId, 'in contacts table');
            } else {
              // Fallback: try without the pattern, just check if legacy ID is in contact_notes
              const { data: fallbackContacts, error: fallbackError } = await supabase
                .from('contacts')
                .select('id')
                .like('contact_notes', `%${legacyId}%`);

              if (!fallbackError && fallbackContacts) {
                countsMap[legacyLead.id] = fallbackContacts.length;
                console.log('🔍 CasesTab - Found', fallbackContacts.length, 'contacts for legacy lead', legacyId, 'using fallback pattern');
              } else {
                countsMap[legacyLead.id] = 0;
                console.log('🔍 CasesTab - No contacts found for legacy lead', legacyId);
              }
            }
          }

          console.log('🔍 CasesTab - Contacts counts for legacy leads:', countsMap);
        }

        console.log('🔍 CasesTab - Final contacts counts map:', countsMap);
        setContactsCounts(countsMap);
      } catch (error) {
        console.error('❌ CasesTab - Error fetching contacts count:', error);
      }
    };

    fetchContactsCount();
  }, [leads]);

  // Fetch contacts for applicants display (matching ContactsTab logic)
  useEffect(() => {
    const fetchContacts = async () => {
      console.log('🚀 CasesTab - fetchContacts called');
      console.log('🚀 CasesTab - leads.length:', leads.length);
      console.log('🚀 CasesTab - leads:', leads.map(l => ({ id: l.id, name: l.name })));

      if (leads.length === 0) {
        console.log('⚠️ CasesTab - No leads, returning early');
        return;
      }

      try {
        // Separate new leads (UUID) from legacy leads (numeric ID with "legacy_" prefix)
        const newLeads = leads.filter(lead => !lead.id.startsWith('legacy_'));
        const legacyLeads = leads.filter(lead => lead.id.startsWith('legacy_'));
        const newLeadIds = newLeads.map(lead => lead.id);
        const contactsMap: { [key: string]: any[] } = {};

        console.log('🔍 CasesTab - newLeads count:', newLeads.length);
        console.log('🔍 CasesTab - legacyLeads count:', legacyLeads.length);
        console.log('🔍 CasesTab - newLeadIds:', newLeadIds);

        // Initialize all leads with empty arrays
        leads.forEach(lead => {
          contactsMap[lead.id] = [];
          console.log(`🔍 CasesTab - Initialized contactsMap[${lead.id}] = []`);
        });

        // Fetch contacts for new leads (contacts table)
        if (newLeadIds.length > 0) {
          console.log('🔍 CasesTab - Fetching contacts for new leads:', newLeadIds);

          const { data: newContactsData, error: newContactsError } = await supabase
            .from('contacts')
            .select('id, name, email, phone, birth_date, relationship, group_id, lead_id')
            .in('lead_id', newLeadIds)
            .order('is_main_applicant', { ascending: false })
            .order('created_at', { ascending: true });

          console.log('🔍 CasesTab - Query result for new leads:', {
            dataLength: newContactsData?.length || 0,
            error: newContactsError,
            sampleData: newContactsData?.slice(0, 2)
          });

          if (newContactsError) {
            console.error('❌ CasesTab - Error fetching new contacts:', newContactsError);
          } else if (newContactsData) {
            console.log('🔍 CasesTab - Found', newContactsData.length, 'contacts for new leads');
            console.log('🔍 CasesTab - Raw contacts data:', newContactsData);
            newContactsData.forEach(contact => {
              console.log(`🔍 CasesTab - Processing contact:`, {
                contactId: contact.id,
                contactName: contact.name,
                contactLeadId: contact.lead_id,
                isInNewLeadIds: contact.lead_id && newLeadIds.includes(contact.lead_id)
              });
              if (contact.lead_id && newLeadIds.includes(contact.lead_id)) {
                if (!contactsMap[contact.lead_id]) {
                  contactsMap[contact.lead_id] = [];
                }
                contactsMap[contact.lead_id].push(contact);
                console.log(`✅ CasesTab - Added contact to contactsMap[${contact.lead_id}], now has ${contactsMap[contact.lead_id].length} contacts`);
              } else {
                console.warn(`⚠️ CasesTab - Contact ${contact.id} has lead_id ${contact.lead_id} which is not in newLeadIds`);
              }
            });
          } else {
            console.log('⚠️ CasesTab - No contacts data returned for new leads');
          }
        } else {
          console.log('⚠️ CasesTab - No new leads to fetch contacts for');
        }

        // Fetch contacts for legacy leads (same logic as ContactsTab)
        if (legacyLeads.length > 0) {
          console.log('🔍 CasesTab - Fetching contacts for legacy leads:', legacyLeads.length);
          console.log('🔍 CasesTab - Legacy leads:', legacyLeads.map(l => ({ id: l.id, name: l.name })));

          for (const legacyLead of legacyLeads) {
            const legacyId = legacyLead.id.replace('legacy_', '');
            const legacyIdPattern = `[LEGACY_LEAD_ID:${legacyId}]`;

            console.log('🔍 CasesTab - Processing legacy lead:', {
              originalId: legacyLead.id,
              legacyId: legacyId,
              pattern: legacyIdPattern
            });

            // First, try to fetch from unified contacts table (if migrated)
            // Use same pattern as count function - select id first, then fetch full data
            console.log('🔍 CasesTab - Attempting to fetch from contacts table with pattern:', legacyIdPattern);
            const { data: migratedContactIds, error: migratedError } = await supabase
              .from('contacts')
              .select('id')
              .like('contact_notes', `%${legacyIdPattern}%`);

            console.log('🔍 CasesTab - Migrated contact IDs query result:', {
              count: migratedContactIds?.length || 0,
              error: migratedError
            });

            let migratedContacts = null;
            if (!migratedError && migratedContactIds && migratedContactIds.length > 0) {
              // Fetch full contact data by IDs
              const contactIds = migratedContactIds.map(c => c.id);
              console.log('🔍 CasesTab - Fetching full data for migrated contact IDs:', contactIds);
              const { data: fullMigratedContacts, error: fullError } = await supabase
                .from('contacts')
                .select('id, name, email, phone, birth_date, relationship, group_id')
                .in('id', contactIds)
                .order('is_main_applicant', { ascending: false })
                .order('created_at', { ascending: true });

              if (!fullError && fullMigratedContacts) {
                migratedContacts = fullMigratedContacts;
              } else {
                console.error('❌ CasesTab - Error fetching full migrated contact data:', fullError);
              }
            }

            console.log('🔍 CasesTab - Migrated contacts final result:', {
              count: migratedContacts?.length || 0,
              error: migratedError,
              sample: migratedContacts?.slice(0, 2)
            });

            if (!migratedError && migratedContacts && migratedContacts.length > 0) {
              console.log('✅ CasesTab - Found', migratedContacts.length, 'contacts for legacy lead', legacyId, 'in contacts table');
              console.log('🔍 CasesTab - Migrated contacts:', migratedContacts);
              contactsMap[legacyLead.id] = migratedContacts;
              console.log(`✅ CasesTab - Set contactsMap[${legacyLead.id}] with ${migratedContacts.length} contacts`);
            } else {
              console.log('⚠️ CasesTab - No migrated contacts found, trying fallback pattern');
              // Fallback: try without the pattern, just check if legacy ID is in contact_notes
              // Use the same query pattern that works in fetchContactsCount - select id first
              const { data: fallbackContactIds, error: fallbackError } = await supabase
                .from('contacts')
                .select('id')
                .like('contact_notes', `%${legacyId}%`);

              console.log('🔍 CasesTab - Fallback contact IDs query result:', {
                count: fallbackContactIds?.length || 0,
                error: fallbackError,
                errorDetails: fallbackError ? {
                  message: fallbackError.message,
                  details: fallbackError.details,
                  hint: fallbackError.hint,
                  code: fallbackError.code
                } : null
              });

              let fallbackContacts = null;
              if (!fallbackError && fallbackContactIds && fallbackContactIds.length > 0) {
                // Fetch full contact data by IDs
                const contactIds = fallbackContactIds.map(c => c.id);
                console.log('🔍 CasesTab - Fetching full data for fallback contact IDs:', contactIds);
                const { data: fullFallbackContacts, error: fullError } = await supabase
                  .from('contacts')
                  .select('id, name, email, phone, birth_date, relationship, group_id')
                  .in('id', contactIds)
                  .order('created_at', { ascending: true });

                if (!fullError && fullFallbackContacts) {
                  fallbackContacts = fullFallbackContacts;
                } else {
                  console.error('❌ CasesTab - Error fetching full fallback contact data:', fullError);
                }
              }

              console.log('🔍 CasesTab - Fallback contacts query result:', {
                count: fallbackContacts?.length || 0,
                error: fallbackError,
                errorDetails: fallbackError ? {
                  message: fallbackError.message,
                  details: fallbackError.details,
                  hint: fallbackError.hint,
                  code: fallbackError.code
                } : null,
                sample: fallbackContacts?.slice(0, 2)
              });

              if (!fallbackError && fallbackContacts && fallbackContacts.length > 0) {
                console.log('✅ CasesTab - Found', fallbackContacts.length, 'contacts for legacy lead', legacyId, 'using fallback pattern');
                console.log('🔍 CasesTab - Fallback contacts:', fallbackContacts);
                contactsMap[legacyLead.id] = fallbackContacts;
                console.log(`✅ CasesTab - Set contactsMap[${legacyLead.id}] with ${fallbackContacts.length} contacts`);
              } else if (fallbackError) {
                console.error('❌ CasesTab - Error in fallback query:', fallbackError);
                // Try with just selecting id first to see if it's a field issue
                const { data: testContacts, error: testError } = await supabase
                  .from('contacts')
                  .select('id')
                  .like('contact_notes', `%${legacyId}%`);

                console.log('🔍 CasesTab - Test query (id only) result:', {
                  count: testContacts?.length || 0,
                  error: testError
                });

                if (!testError && testContacts && testContacts.length > 0) {
                  // If id-only query works, fetch full data by IDs
                  const contactIds = testContacts.map(c => c.id);
                  console.log('🔍 CasesTab - Fetching full contact data for IDs:', contactIds);
                  const { data: fullContacts, error: fullError } = await supabase
                    .from('contacts')
                    .select('id, name, email, phone, birth_date, relationship, group_id')
                    .in('id', contactIds);

                  if (!fullError && fullContacts) {
                    console.log('✅ CasesTab - Successfully fetched', fullContacts.length, 'contacts by ID');
                    contactsMap[legacyLead.id] = fullContacts;
                  } else {
                    console.error('❌ CasesTab - Error fetching full contact data:', fullError);
                    contactsMap[legacyLead.id] = [];
                  }
                } else {
                  contactsMap[legacyLead.id] = [];
                }
              } else {
                console.log('⚠️ CasesTab - No fallback contacts found, trying legacy tables');
                // Final fallback: fetch from legacy tables (lead_leadcontact + leads_contact)
                console.log('🔍 CasesTab - Trying legacy tables for lead', legacyId);
                const { data: leadContacts, error: leadContactsError } = await supabase
                  .from('lead_leadcontact')
                  .select('id, main, contact_id, lead_id')
                  .eq('lead_id', legacyId);

                console.log('🔍 CasesTab - lead_leadcontact query result:', {
                  count: leadContacts?.length || 0,
                  error: leadContactsError,
                  data: leadContacts
                });

                if (!leadContactsError && leadContacts && leadContacts.length > 0) {
                  const contactIds = leadContacts.map((lc: any) => lc.contact_id).filter(Boolean);
                  console.log('🔍 CasesTab - Extracted contact IDs:', contactIds);

                  if (contactIds.length > 0) {
                    // Fetch contact details from leads_contact
                    console.log('🔍 CasesTab - Fetching contact details from leads_contact for IDs:', contactIds);
                    console.log('🔍 CasesTab - Contact IDs type:', contactIds.map(id => ({ id, type: typeof id })));

                    // Ensure IDs are numbers (leads_contact uses numeric IDs)
                    const numericContactIds = contactIds.map(id => {
                      const numId = typeof id === 'string' ? parseInt(id, 10) : id;
                      if (isNaN(numId)) {
                        console.warn(`⚠️ CasesTab - Invalid contact ID: ${id}`);
                        return null;
                      }
                      return numId;
                    }).filter((id): id is number => id !== null);

                    console.log('🔍 CasesTab - Numeric contact IDs:', numericContactIds);

                    if (numericContactIds.length === 0) {
                      console.error('❌ CasesTab - No valid numeric contact IDs after conversion');
                      contactsMap[legacyLead.id] = [];
                    } else {
                      const { data: contactsData, error: contactsError } = await supabase
                        .from('leads_contact')
                        .select('id, name, mobile, phone, email, notes, address')
                        .in('id', numericContactIds);

                      console.log('🔍 CasesTab - leads_contact query result:', {
                        count: contactsData?.length || 0,
                        error: contactsError,
                        errorDetails: contactsError ? {
                          message: contactsError.message,
                          details: contactsError.details,
                          hint: contactsError.hint,
                          code: contactsError.code
                        } : null,
                        queryIds: numericContactIds,
                        sample: contactsData?.slice(0, 2)
                      });

                      if (contactsError) {
                        console.error('❌ CasesTab - leads_contact query error details:', {
                          message: contactsError.message,
                          details: contactsError.details,
                          hint: contactsError.hint,
                          code: contactsError.code,
                          query: `select id, name, mobile, phone, email, notes, address from leads_contact where id in (${numericContactIds.join(',')})`
                        });
                      }

                      if (!contactsError && contactsData && contactsData.length > 0) {
                        console.log('✅ CasesTab - Found', contactsData.length, 'contacts for legacy lead', legacyId, 'from legacy tables');
                        // Map contacts with their data (matching ContactsTab structure)
                        const mappedContacts = contactsData.map((contact: any) => ({
                          id: String(contact.id),
                          name: contact.name || '---',
                          email: contact.email || undefined,
                          phone: contact.phone || undefined,
                          mobile: contact.mobile || undefined,
                          birth_date: undefined, // Legacy contacts may not have birth_date
                          relationship: contact.relationship || undefined,
                          group_id: null, // Legacy contacts from old tables don't have groups
                        }));
                        console.log('🔍 CasesTab - Mapped contacts:', mappedContacts);
                        contactsMap[legacyLead.id] = mappedContacts;
                        console.log(`✅ CasesTab - Set contactsMap[${legacyLead.id}] with ${mappedContacts.length} contacts from legacy tables`);
                      } else {
                        console.log('⚠️ CasesTab - No contacts found for legacy lead', legacyId, 'from leads_contact');
                        contactsMap[legacyLead.id] = [];
                      }
                    }
                  } else {
                    console.log('⚠️ CasesTab - No contact IDs found for legacy lead', legacyId);
                    contactsMap[legacyLead.id] = [];
                  }
                } else {
                  console.log('⚠️ CasesTab - No contacts found for legacy lead', legacyId, 'from lead_leadcontact');
                  contactsMap[legacyLead.id] = [];
                }
              }
            }
          }
        } else {
          console.log('⚠️ CasesTab - No legacy leads to process');
        }

        console.log('🔍 CasesTab - Final contacts map:', contactsMap);
        console.log('🔍 CasesTab - Total leads:', leads.length);
        console.log('🔍 CasesTab - Contacts map keys:', Object.keys(contactsMap));
        console.log('🔍 CasesTab - Contacts map size:', Object.keys(contactsMap).length);

        leads.forEach(lead => {
          const contactCount = contactsMap[lead.id]?.length || 0;
          console.log(`🔍 CasesTab - Lead ${lead.id} (${lead.name}) has ${contactCount} contacts`);
          if (contactCount > 0) {
            console.log(`🔍 CasesTab - Contacts for ${lead.id}:`, contactsMap[lead.id]);
          }
        });

        console.log('🔍 CasesTab - About to set contacts state with map:', contactsMap);
        setContacts(contactsMap);
        console.log('✅ CasesTab - Contacts state set');
      } catch (error) {
        console.error('❌ CasesTab - Error fetching contacts:', error);
      }
    };

    fetchContacts();
  }, [leads]);

  // Fetch groups for displaying group names
  useEffect(() => {
    const fetchGroups = async () => {
      try {
        const { data, error } = await supabase
          .from('contact_groups')
          .select('id, name')
          .order('position', { ascending: true });

        if (error) {
          console.error('Error fetching groups:', error);
        } else if (data) {
          const groupsMap: { [groupId: string]: { id: string; name: string } } = {};
          data.forEach(group => {
            groupsMap[group.id] = { id: group.id, name: group.name };
          });
          setGroups(groupsMap);
        }
      } catch (error) {
        console.error('Error fetching groups:', error);
      }
    };

    fetchGroups();
  }, []);

  // Helper function to get category display name with main category (matching CaseDetailsPage)
  const getCategoryDisplayName = (categoryId: string | number | null | undefined, fallbackCategory?: string): string => {
    if (!categoryId || categoryId === '---' || categoryId === '--') {
      return fallbackCategory || '';
    }

    // Try to find category by ID
    const category = allCategories.find((cat: any) => {
      const catId = typeof cat.id === 'bigint' ? Number(cat.id) : cat.id;
      const searchId = typeof categoryId === 'string' ? parseInt(categoryId, 10) : categoryId;
      return catId === searchId || Number(catId) === Number(searchId);
    });

    if (category) {
      // Return category name with main category in parentheses if available
      if (category.misc_maincategory?.name) {
        return `${category.name} (${category.misc_maincategory.name})`;
      } else {
        return category.name;
      }
    }

    // Try to find by name if ID lookup failed
    const categoryByName = allCategories.find((cat: any) => cat.name === categoryId);
    if (categoryByName) {
      if (categoryByName.misc_maincategory?.name) {
        return `${categoryByName.name} (${categoryByName.misc_maincategory.name})`;
      } else {
        return categoryByName.name;
      }
    }

    return fallbackCategory || String(categoryId);
  };

  // Helper function to get employee by ID
  const getEmployeeById = (employeeId: string | number | null | undefined) => {
    if (!employeeId || employeeId === '---' || employeeId === '--' || employeeId === '') {
      return null;
    }

    const employee = allEmployees.find((emp: any) => {
      const empId = typeof emp.id === 'bigint' ? Number(emp.id) : emp.id;
      const searchId = typeof employeeId === 'string' ? parseInt(employeeId, 10) : employeeId;

      if (isNaN(Number(searchId))) return false;
      if (empId.toString() === searchId.toString()) return true;
      if (Number(empId) === Number(searchId)) return true;
      return false;
    });

    return employee || null;
  };

  // Helper function to get employee initials
  const getEmployeeInitials = (name: string | null | undefined): string => {
    if (!name || name === '---' || name === '--' || name === 'Not assigned') return '';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  // Employee Avatar Component
  const EmployeeAvatar: React.FC<{
    employeeId: string | number | null | undefined;
    size?: 'sm' | 'md' | 'lg';
  }> = ({ employeeId, size = 'sm' }) => {
    const [imageError, setImageError] = useState(false);
    const employee = getEmployeeById(employeeId);
    const sizeClasses = size === 'sm' ? 'w-8 h-8 text-xs' : size === 'md' ? 'w-12 h-12 text-sm' : 'w-16 h-16 text-base';

    if (!employee) {
      return null;
    }

    const photoUrl = employee.photo_url || employee.photo;
    const initials = getEmployeeInitials(employee.display_name);

    if (imageError || !photoUrl) {
      return (
        <div
          className={`${sizeClasses} rounded-full flex items-center justify-center bg-green-100 text-green-700 font-semibold flex-shrink-0`}
          title={employee.display_name}
        >
          {initials}
        </div>
      );
    }

    return (
      <img
        src={photoUrl}
        alt={employee.display_name}
        className={`${sizeClasses} rounded-full object-cover flex-shrink-0`}
        onError={() => setImageError(true)}
        title={employee.display_name}
      />
    );
  };

  // Fetch additional case data from leads table
  useEffect(() => {
    const fetchCaseData = async () => {
      if (leads.length > 0) {
        try {
          // Separate new leads from legacy leads
          const newLeads = leads.filter(lead => !lead.id.startsWith('legacy_'));
          const legacyLeads = leads.filter(lead => lead.id.startsWith('legacy_'));

          const caseDataMap: { [key: string]: any } = {};

          // Fetch data for new leads from leads table
          if (newLeads.length > 0) {
            const { data, error } = await supabase
              .from('leads')
              .select(`
                *,
                misc_category!category_id(
                  id,
                  name,
                  parent_id,
                  misc_maincategory!parent_id(
                    id,
                    name
                  )
                ),
                case_handler:tenants_employee!case_handler_id(
                  id,
                  display_name,
                  photo_url,
                  photo
                ),
                expert_employee:tenants_employee!expert(
                  id,
                  display_name,
                  photo_url,
                  photo
                ),
                manager_employee:tenants_employee!meeting_manager_id(
                  id,
                  display_name,
                  photo_url,
                  photo
                )
              `)
              .in('id', newLeads.map(lead => lead.id));

            if (error) throw error;

            data?.forEach(lead => {
              // Map new lead data to match the expected structure
              // For new leads:
              // - expert: stored as ID in 'expert' column (not expert_id)
              // - handler: stored as ID in 'case_handler_id' or text in 'handler'
              // - closer: stored as text in 'closer' (not ID)
              // - scheduler: stored as text in 'scheduler' (not ID)
              // - manager: stored as ID in 'meeting_manager_id' or text in 'manager'
              const mappedLead = {
                ...lead,
                // Map role IDs (for new leads, some are IDs, some are text)
                expert_id: typeof lead.expert === 'number' ? lead.expert : null,
                case_handler_id: lead.case_handler_id || null,
                closer_id: null, // New leads don't have closer_id, only closer text
                scheduler_id: null, // New leads don't have scheduler_id, only scheduler text
                meeting_manager_id: lead.meeting_manager_id || null,
                // Map employee names from joined data or text fields
                expert: lead.expert_employee?.display_name || (typeof lead.expert === 'number' ? null : lead.expert) || null,
                handler: lead.case_handler?.display_name || lead.handler || null,
                closer: lead.closer || null, // Text field only
                scheduler: lead.scheduler || null, // Text field only
                manager: lead.manager_employee?.display_name || lead.manager || null,
                // Map employee IDs for avatar display (use ID fields where available)
                manager_id: lead.meeting_manager_id || null,
                // Map employee data for avatars
                manager_employee: lead.manager_employee || null,
                expert_employee: lead.expert_employee || null,
                handler_employee: lead.case_handler || null,
                // Map stage
                handler_stage: String(lead.handler_stage || lead.stage || ''),
                stage: String(lead.stage || ''),
              };

              caseDataMap[lead.id] = mappedLead;
              console.log('New lead data for', lead.id, ':', mappedLead); // Debug log
            });
          }

          // Fetch detailed data for legacy leads from leads_lead table
          if (legacyLeads.length > 0) {
            const legacyIds = legacyLeads.map(lead => {
              // Extract numeric ID from "legacy_123" format
              return parseInt(lead.id.replace('legacy_', ''), 10);
            }).filter(id => !isNaN(id));

            if (legacyIds.length > 0) {
              const { data: legacyData, error: legacyError } = await supabase
                .from('leads_lead')
                .select(`
                  *,
                  misc_category!category_id(
                    id,
                    name,
                    parent_id,
                    misc_maincategory!parent_id(
                      id,
                      name
                    )
                  ),
                  case_handler:tenants_employee!case_handler_id(
                    id,
                    display_name
                  ),
                  expert:tenants_employee!expert_id(
                    id,
                    display_name
                  ),
                  closer:tenants_employee!closer_id(
                    id,
                    display_name,
                    photo_url,
                    photo
                  ),
                  scheduler:tenants_employee!meeting_scheduler_id(
                    id,
                    display_name
                  ),
                  manager:tenants_employee!meeting_manager_id(
                    id,
                    display_name,
                    photo_url,
                    photo
                  )
                `)
                .in('id', legacyIds);

              if (legacyError) {
                console.error('Error fetching legacy lead data:', legacyError);
              } else if (legacyData) {
                legacyData.forEach(legacyLead => {
                  const legacyLeadId = `legacy_${legacyLead.id}`;

                  // Map legacy lead data to match the expected structure
                  const mappedLead = {
                    ...legacyLead,
                    // Map category_id to category with proper display name
                    category: legacyLead.category_id,
                    category_id: legacyLead.category_id,
                    // Map stage to handler_stage
                    handler_stage: String(legacyLead.stage || ''),
                    stage: String(legacyLead.stage || ''),
                    // Map role IDs
                    expert_id: legacyLead.expert_id,
                    case_handler_id: legacyLead.case_handler_id,
                    closer_id: legacyLead.closer_id,
                    meeting_scheduler_id: legacyLead.meeting_scheduler_id,
                    // Map employee names from joined data
                    expert: legacyLead.expert?.display_name || null,
                    handler: legacyLead.case_handler?.display_name || null,
                    closer: legacyLead.closer?.display_name || null,
                    scheduler: legacyLead.scheduler?.display_name || null,
                    // Map employee IDs for avatar display
                    manager_id: legacyLead.meeting_manager_id || null,
                    closer_id: legacyLead.closer_id || null,
                    // Map employee data for avatars
                    manager_employee: legacyLead.manager || null,
                    closer_employee: legacyLead.closer || null,
                    expert_employee: legacyLead.expert || null,
                    // Map other fields
                    topic: legacyLead.topic || null,
                    created_at: legacyLead.cdate || legacyLead.created_at || '',
                    balance: legacyLead.total || legacyLead.total_base || 0,
                    balance_currency: '₪', // Default currency for legacy leads
                    facts: legacyLead.description || null,
                    notes: legacyLead.notes || null,
                    expert_notes: legacyLead.expert_notes || null,
                    handler_notes: legacyLead.handler_notes || null,
                    // Preserve misc_category join for category display
                    misc_category: legacyLead.misc_category
                  };

                  caseDataMap[legacyLeadId] = mappedLead;
                  console.log('Legacy lead data for', legacyLeadId, ':', mappedLead); // Debug log
                });
              }
            }
          }

          setCaseData(caseDataMap);
        } catch (error) {
          console.error('Error fetching case data:', error);
        }
      }
    };

    fetchCaseData();
  }, [leads]);

  // Fetch applicant counts and contract links from contracts table
  useEffect(() => {
    const fetchContractData = async () => {
      if (leads.length > 0) {
        try {
          // Only fetch contracts for new leads (legacy leads don't have contracts in the new system)
          const newLeads = leads.filter(lead => !lead.id.startsWith('legacy_'));

          if (newLeads.length === 0) {
            // No new leads, just set empty maps
            setApplicantCounts({});
            setContractLinks({});
            return;
          }

          const { data, error } = await supabase
            .from('contracts')
            .select('client_id, applicant_count, contact_name, id, public_token')
            .in('client_id', newLeads.map(lead => lead.id));

          if (error) throw error;

          const countsMap: { [key: string]: number } = {};
          const linksMap: { [key: string]: Array<{ link: string, contactName: string }> } = {};

          // Group by client_id and sum applicant_count, get all contract links with contact names
          data?.forEach(contract => {
            const clientId = contract.client_id;
            const applicantCount = contract.applicant_count || 0;
            const contractId = contract.id;
            const contactName = contract.contact_name || 'Unknown Contact';

            if (countsMap[clientId]) {
              countsMap[clientId] += applicantCount;
            } else {
              countsMap[clientId] = applicantCount;
            }

            // Store all contract links with contact names for each client
            if (contractId) {
              if (!linksMap[clientId]) {
                linksMap[clientId] = [];
              }

              // Find the lead that corresponds to this client_id to get the lead_number
              const lead = leads.find(l => l.id === clientId);
              const leadNumber = lead?.lead_number || clientId;

              // Construct the contract URL using the lead number and contract ID
              const contractUrl = `http://localhost:5173/clients/${leadNumber}/contract?contractId=${contractId}`;

              linksMap[clientId].push({
                link: contractUrl,
                contactName: contactName
              });
            }
          });

          setApplicantCounts(countsMap);
          setContractLinks(linksMap);
        } catch (error) {
          console.error('Error fetching contract data:', error);
        }
      }
    };

    fetchContractData();
  }, [leads]);

  const fetchOneDriveFiles = async (lead: HandlerLead) => {
    setLoadingFiles(true);
    setSelectedLeadForDocs(lead);
    setShowDocumentModal(true);

    try {
      console.log('Fetching documents for lead:', lead.lead_number);
      const { data, error } = await supabase.functions.invoke('list-onedrive-files', {
        body: { leadNumber: lead.lead_number }
      });

      console.log('OneDrive response:', { data, error });

      if (error) {
        console.error('OneDrive error details:', error);
        toast.error('Error fetching files: ' + (error.message || 'Unknown error'));
        setOneDriveFiles([]);
      } else if (data && data.success) {
        console.log('Documents fetched successfully:', data.files);
        setOneDriveFiles(data.files || []);
        if (data.files && data.files.length > 0) {
          toast.success(`Found ${data.files.length} document${data.files.length !== 1 ? 's' : ''}`);
        }
      } else {
        console.log('No files returned from OneDrive function');
        setOneDriveFiles([]);
        toast.success('OneDrive folder accessed - no documents found');
      }
    } catch (err: any) {
      console.error('Error fetching OneDrive files:', err);
      toast.error('Failed to fetch OneDrive files: ' + (err.message || 'Network error'));
      setOneDriveFiles([]);
    } finally {
      setLoadingFiles(false);
    }
  };

  if (leads.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <FolderIcon className="w-16 h-16 mx-auto mb-4 text-gray-300" />
        <p className="text-lg font-medium mb-1">No handler-assigned cases</p>
        <p className="text-base">Cases will appear here when assigned to handlers</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Case Study Cards - Two Boxes Layout with Applicants */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {leads.map((lead, index) => {
          const leadData = caseData[lead.id] || {};
          // Alternate between white and pink backgrounds
          const isPinkCard = index % 3 === 2;
          const cardBg = isPinkCard ? 'bg-pink-50' : 'bg-white';
          const leadContacts = contacts[lead.id] || [];

          // Debug logging for all leads
          console.log(`🔍 CasesTab - Rendering lead ${index + 1}/${leads.length}:`, {
            leadId: lead.id,
            leadName: lead.name,
            contactsStateKeys: Object.keys(contacts),
            contactsStateSize: Object.keys(contacts).length,
            leadContactsLength: leadContacts.length,
            leadContacts: leadContacts,
            contactsMapHasKey: lead.id in contacts,
            contactsMapValue: contacts[lead.id]
          });

          return (
            <React.Fragment key={lead.id}>
              <div className="lg:col-span-2 space-y-6">
                {/* First Box */}
                <div className={`${cardBg} rounded-2xl shadow-lg border border-gray-200 p-8 hover:shadow-xl transition-shadow`}>
                  {/* Header with Icon and Client Name */}
                  <div className="flex items-start gap-4 mb-8">
                    <div className="w-16 h-16 border-2 border-gray-800 rounded-xl flex items-center justify-center flex-shrink-0">
                      <CheckBadgeIcon className="w-8 h-8 text-gray-800" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-2xl font-bold text-gray-900 mb-2">{lead.name}</h3>
                    </div>
                  </div>

                  {/* Facts of Case and Expert Opinion - Side by Side */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                    {/* Facts of Case */}
                    <div className="lg:pr-6 lg:border-r lg:border-gray-200">
                      <h4 className="text-lg font-bold text-gray-900 mb-4">Facts of Case</h4>
                      <p
                        className="text-base leading-relaxed text-gray-700 whitespace-pre-wrap"
                        dir={getTextDirection(
                          typeof lead.facts === 'string' ? lead.facts : typeof leadData.facts === 'string' ? leadData.facts : null
                        )}
                      >
                        {(() => {
                          const facts = typeof lead.facts === 'string' ? lead.facts : typeof leadData.facts === 'string' ? leadData.facts : '';
                          const category = getCategoryDisplayName(lead.category || leadData.category_id);
                          if (facts) {
                            // Strip HTML tags from facts before displaying
                            return stripHtmlTags(facts);
                          }
                          return category ? `Case management for ${category}` : 'Case management and support';
                        })()}
                      </p>
                    </div>

                    {/* Expert Opinion and Eligibility */}
                    <div>
                      <h4 className="text-lg font-bold text-gray-900 mb-5">Expert Opinion and Eligibility</h4>
                      <div className="space-y-4">
                        <div className="flex items-center justify-between py-2">
                          <span className="text-base font-semibold text-gray-700">Expert:</span>
                          <div className="flex items-center gap-3">
                            {(() => {
                              const leadData = caseData[lead.id] || {};
                              // For new leads: expert_id is in expert field (number) or expert_employee
                              // For legacy leads: expert_id is in expert_id field
                              const expertId = leadData.expert_id ||
                                (typeof lead.expert === 'number' ? lead.expert : null) ||
                                (typeof leadData.expert === 'number' ? leadData.expert : null) ||
                                (leadData.expert_employee?.id) ||
                                (typeof lead.expert === 'object' && lead.expert?.id ? lead.expert.id : null);
                              return (
                                <>
                                  <EmployeeAvatar employeeId={expertId} size="md" />
                                  <span className="text-base font-medium text-gray-900">
                                    {(() => {
                                      // Handle both string and object cases
                                      if (leadData.expert) {
                                        return typeof leadData.expert === 'string'
                                          ? leadData.expert
                                          : (leadData.expert.display_name || leadData.expert.name || 'Not assigned');
                                      }
                                      if (lead.expert) {
                                        return typeof lead.expert === 'string'
                                          ? lead.expert
                                          : (lead.expert.display_name || lead.expert.name || 'Not assigned');
                                      }
                                      return 'Not assigned';
                                    })()}
                                  </span>
                                </>
                              );
                            })()}
                          </div>
                        </div>
                        <div className="flex items-center justify-between py-2">
                          <span className="text-base font-semibold text-gray-700">Eligibility:</span>
                          <span className="badge badge-lg bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-transparent px-4 py-2">
                            {typeof leadData.eligibility_status === 'string' ? leadData.eligibility_status.replace(/_/g, ' ') : 'Under Review'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between py-2">
                          <span className="text-base font-semibold text-gray-700">Section:</span>
                          <span className="text-base font-medium text-gray-900">
                            {typeof lead.section_eligibility === 'string' ? lead.section_eligibility :
                              typeof leadData.section_eligibility === 'string' ? leadData.section_eligibility : 'Not specified'}
                          </span>
                        </div>
                        {/* Expert Notes */}
                        {(() => {
                          const expertNotes = leadData.expert_notes || lead.expert_notes || [];
                          if (!Array.isArray(expertNotes) || expertNotes.length === 0) return null;
                          return (
                            <div className="mt-6 pt-6">
                              <h5 className="text-base font-semibold text-gray-700 mb-3">Expert Notes:</h5>
                              <div className="space-y-3">
                                {expertNotes.slice(0, 2).map((note: any, noteIndex: number) => (
                                  <div key={noteIndex}>
                                    <p className="text-base text-gray-700 leading-relaxed whitespace-pre-wrap">
                                      {(() => {
                                        const content = note.content || note.note || JSON.stringify(note);
                                        const strippedContent = stripHtmlTags(content);
                                        return strippedContent.length > 300 ? strippedContent.substring(0, 300) + '...' : strippedContent;
                                      })()}
                                    </p>
                                  </div>
                                ))}
                                {expertNotes.length > 2 && (
                                  <p className="text-sm text-gray-500 font-medium">+{expertNotes.length - 2} more note(s)</p>
                                )}
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Second Box */}
                <div className={`${cardBg} rounded-2xl shadow-lg border border-gray-200 p-8 hover:shadow-xl transition-shadow`}>
                  {/* Lead Summary and Main Contact Details - Side by Side */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                    {/* Main Contact Details */}
                    <div className="lg:pr-6 lg:border-r lg:border-gray-200">
                      <h4 className="text-lg font-bold text-gray-900 mb-5">Main Contact Details</h4>
                      <div className="space-y-4">
                        <div className="flex items-center justify-between py-2">
                          <span className="text-base font-semibold text-gray-700">Name:</span>
                          <span className="text-base font-medium text-gray-900">{lead.name}</span>
                        </div>
                        <div className="flex items-center justify-between py-2">
                          <span className="text-base font-semibold text-gray-700">Email:</span>
                          <span className="text-base font-medium text-gray-900">{lead.email || 'Not provided'}</span>
                        </div>
                        <div className="flex items-center justify-between py-2">
                          <span className="text-base font-semibold text-gray-700">Phone:</span>
                          <span className="text-base font-medium text-gray-900">{lead.phone || 'Not provided'}</span>
                        </div>
                      </div>
                    </div>

                    {/* Lead Summary */}
                    <div>
                      <h4 className="text-lg font-bold text-gray-900 mb-5">Lead Summary</h4>
                      <div className="space-y-4">
                        <div className="flex items-center justify-between py-2">
                          <span className="text-base font-semibold text-gray-700">Manager:</span>
                          <div className="flex items-center gap-3">
                            {(() => {
                              const leadData = caseData[lead.id] || {};
                              const managerId = leadData.manager_id || lead.manager_id || (typeof lead.manager === 'string' ? null : lead.manager);
                              return (
                                <>
                                  <EmployeeAvatar employeeId={managerId} size="md" />
                                  <span className="text-base font-medium text-gray-900">
                                    {(() => {
                                      // Handle both string and object cases
                                      if (leadData.manager) {
                                        return typeof leadData.manager === 'string'
                                          ? leadData.manager
                                          : (leadData.manager.display_name || leadData.manager.name || 'Not assigned');
                                      }
                                      if (lead.manager) {
                                        return typeof lead.manager === 'string'
                                          ? lead.manager
                                          : (lead.manager.display_name || lead.manager.name || 'Not assigned');
                                      }
                                      return 'Not assigned';
                                    })()}
                                  </span>
                                </>
                              );
                            })()}
                          </div>
                        </div>
                        <div className="flex items-center justify-between py-2">
                          <span className="text-base font-semibold text-gray-700">Closer:</span>
                          <div className="flex items-center gap-3">
                            {(() => {
                              const leadData = caseData[lead.id] || {};
                              const closerId = leadData.closer_id || lead.closer_id || (typeof lead.closer === 'string' ? null : lead.closer);
                              return (
                                <>
                                  <EmployeeAvatar employeeId={closerId} size="md" />
                                  <span className="text-base font-medium text-gray-900">
                                    {(() => {
                                      // Handle both string and object cases
                                      if (leadData.closer) {
                                        return typeof leadData.closer === 'string'
                                          ? leadData.closer
                                          : (leadData.closer.display_name || leadData.closer.name || 'Not assigned');
                                      }
                                      if (lead.closer) {
                                        return typeof lead.closer === 'string'
                                          ? lead.closer
                                          : (lead.closer.display_name || lead.closer.name || 'Not assigned');
                                      }
                                      return 'Not assigned';
                                    })()}
                                  </span>
                                </>
                              );
                            })()}
                          </div>
                        </div>
                        <div className="flex items-center justify-between py-2">
                          <span className="text-base font-semibold text-gray-700">Contract:</span>
                          <div className="text-right">
                            {contractLinks[lead.id] && contractLinks[lead.id].length > 0 ? (
                              <div className="space-y-2">
                                {contractLinks[lead.id].map((contract, index) => (
                                  <a
                                    key={index}
                                    href={contract.link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-600 hover:text-blue-800 underline flex items-center gap-2 justify-end text-base font-medium"
                                  >
                                    <LinkIcon className="w-4 h-4" />
                                    {contract.contactName}
                                  </a>
                                ))}
                              </div>
                            ) : (
                              <span className="text-gray-400 text-base">No contract link</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Special Notes */}
                  {(() => {
                    const specialNotes = typeof leadData.special_notes === 'string' ? leadData.special_notes : null;
                    if (!specialNotes || specialNotes === 'No special notes') return null;
                    return (
                      <div className="mb-8 pt-8">
                        <h4 className="text-lg font-bold text-gray-900 mb-4">Special Notes</h4>
                        <p
                          className="text-base leading-relaxed text-gray-700 whitespace-pre-wrap"
                          dir={getTextDirection(specialNotes)}
                        >
                          {stripHtmlTags(specialNotes)}
                        </p>
                      </div>
                    );
                  })()}

                  {/* General Notes */}
                  {(() => {
                    const generalNotes = typeof lead.notes === 'string' ? lead.notes :
                      typeof leadData.notes === 'string' ? leadData.notes : null;
                    if (!generalNotes || generalNotes === 'No notes available') return null;
                    return (
                      <div className="pt-8">
                        <h4 className="text-lg font-bold text-gray-900 mb-4">General Notes</h4>
                        <p
                          className="text-base leading-relaxed text-gray-700 whitespace-pre-wrap"
                          dir={getTextDirection(generalNotes)}
                        >
                          {stripHtmlTags(generalNotes)}
                        </p>
                      </div>
                    );
                  })()}

                  {/* Meeting Brief */}
                  {(() => {
                    const meetingBrief = typeof lead.meeting_brief === 'string' ? lead.meeting_brief :
                      typeof leadData.meeting_brief === 'string' ? leadData.meeting_brief : null;
                    if (!meetingBrief || meetingBrief === 'No meeting brief available') return null;
                    return (
                      <div className="pt-8">
                        <h4 className="text-lg font-bold text-gray-900 mb-4">Meeting Brief</h4>
                        <p
                          className="text-base leading-relaxed text-gray-700 whitespace-pre-wrap"
                          dir={getTextDirection(meetingBrief)}
                        >
                          {stripHtmlTags(meetingBrief)}
                        </p>
                      </div>
                    );
                  })()}

                  {/* Action Buttons */}
                  <div className="pt-6 border-t border-gray-200 flex gap-2">
                    <button
                      onClick={() => {
                        setSelectedLeadForDocumentModal(lead);
                        setIsDocumentModalOpen(true);
                      }}
                      className="btn btn-outline btn-sm flex-1"
                    >
                      <FolderIcon className="w-4 h-4" />
                      View Documents
                    </button>
                    <button
                      onClick={() => {
                        setSelectedLeadForUpload(lead);
                        setShowUploadModal(true);
                      }}
                      className="btn btn-outline btn-sm flex-1"
                      style={{ borderColor: '#3b28c7', color: '#3b28c7' }}
                    >
                      <DocumentArrowUpIcon className="w-4 h-4" />
                      Upload
                    </button>
                  </div>
                </div>
              </div>

              {/* Applicants Column - Right Side */}
              <div className="lg:col-span-1">
                <div className={`${cardBg} rounded-2xl shadow-lg border border-gray-200 p-6 hover:shadow-xl transition-shadow sticky top-6`}>
                  <h4 className="text-sm font-semibold text-gray-700 mb-4">Applicants ({leadContacts.length})</h4>
                  {leadContacts.length === 0 ? (
                    <p className="text-sm text-gray-500 text-center py-4">No applicants</p>
                  ) : (
                    <div className="space-y-3 max-h-[calc(100vh-200px)] overflow-y-auto">
                      {(() => {
                        // Sort contacts: main applicants first, then by group name, then by name
                        const sortedContacts = [...leadContacts].sort((a, b) => {
                          // First, sort by main applicant status (main applicants first)
                          const aIsMain = a.is_main_applicant || a.isMain || false;
                          const bIsMain = b.is_main_applicant || b.isMain || false;
                          if (aIsMain && !bIsMain) return -1;
                          if (!aIsMain && bIsMain) return 1;

                          // Then, sort by group name
                          const aGroupName = a.group_id && groups[a.group_id] ? groups[a.group_id].name : '';
                          const bGroupName = b.group_id && groups[b.group_id] ? groups[b.group_id].name : '';
                          if (aGroupName !== bGroupName) {
                            if (!aGroupName) return 1; // No group goes to end
                            if (!bGroupName) return -1;
                            return aGroupName.localeCompare(bGroupName);
                          }

                          // Finally, sort by name
                          return (a.name || '').localeCompare(b.name || '');
                        });

                        return sortedContacts.map((contact) => {
                          const isMain = contact.is_main_applicant || contact.isMain || false;
                          const groupName = contact.group_id && groups[contact.group_id] ? groups[contact.group_id].name : null;

                          return (
                            <div key={contact.id} className="bg-white rounded-lg border border-gray-200 p-3 shadow-md hover:shadow-lg transition-shadow">
                              <div className="grid grid-cols-3 gap-3 items-center">
                                {/* Name Column */}
                                <div className="flex items-center gap-2 pr-3 border-r border-gray-200">
                                  {isMain && (
                                    <StarIcon className="w-4 h-4 text-yellow-500 fill-yellow-500 flex-shrink-0" title="Main applicant" />
                                  )}
                                  <p className="text-gray-900 font-semibold text-sm truncate">{contact.name || '—'}</p>
                                </div>

                                {/* Relationship Column */}
                                <div className="px-3 border-r border-gray-200">
                                  <p className="text-xs text-gray-600 truncate">{contact.relationship || '—'}</p>
                                </div>

                                {/* Phone/Group Column */}
                                <div className="flex items-center justify-end gap-2 pl-3">
                                  {(contact.phone || contact.mobile) && (
                                    <span className="text-xs text-gray-500 truncate">
                                      {(contact.phone || contact.mobile)}
                                    </span>
                                  )}
                                  {groupName && (
                                    <span className="text-xs text-gray-600 bg-gray-50 px-2 py-1 rounded border border-gray-300 whitespace-nowrap">
                                      {groupName}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  )}
                </div>
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {/* Document Viewer Modal */}
      {showDocumentModal && selectedLeadForDocs && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <div>
                <h3 className="text-xl font-bold text-gray-900">Documents for {selectedLeadForDocs.name}</h3>
                <p className="text-gray-600">Lead #{selectedLeadForDocs.lead_number}</p>
              </div>
              <button
                onClick={() => {
                  setShowDocumentModal(false);
                  setSelectedLeadForDocs(null);
                  setOneDriveFiles([]);
                }}
                className="btn btn-ghost btn-circle"
              >
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto max-h-[70vh]">
              {loadingFiles ? (
                <div className="text-center py-12">
                  <div className="loading loading-spinner loading-lg text-blue-600 mb-4"></div>
                  <p className="text-gray-600">Loading documents from OneDrive...</p>
                </div>
              ) : oneDriveFiles.length === 0 ? (
                <div className="text-center py-12">
                  <DocumentTextIcon className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                  <h4 className="text-lg font-medium text-gray-900 mb-2">No Documents Found</h4>
                  <p className="text-gray-600 mb-4">No documents were found in the OneDrive folder for this lead.</p>
                  {selectedLeadForDocs.onedrive_folder_link && (
                    <a
                      href={selectedLeadForDocs.onedrive_folder_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-primary"
                    >
                      <FolderIcon className="w-4 h-4" />
                      Open OneDrive Folder
                    </a>
                  )}
                </div>
              ) : (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-lg font-semibold text-gray-900">
                      Found {oneDriveFiles.length} document{oneDriveFiles.length !== 1 ? 's' : ''}
                    </h4>
                    {selectedLeadForDocs.onedrive_folder_link && (
                      <a
                        href={selectedLeadForDocs.onedrive_folder_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-outline btn-sm"
                      >
                        <FolderIcon className="w-4 h-4" />
                        Open in OneDrive
                      </a>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {oneDriveFiles.map((file: any, index: number) => (
                      <div key={index} className="bg-gray-50 rounded-xl p-4 border border-gray-200 hover:shadow-md transition-shadow">
                        <div className="flex items-start gap-3">
                          <DocumentTextIcon className="w-8 h-8 text-blue-500 flex-shrink-0 mt-1" />
                          <div className="flex-1 min-w-0">
                            <h5 className="font-medium text-gray-900 truncate" title={file.name}>
                              {file.name}
                            </h5>
                            <div className="text-sm text-gray-600 mt-1">
                              {file.size && (
                                <div>Size: {(file.size / 1024 / 1024).toFixed(2)} MB</div>
                              )}
                              {file.lastModified && (
                                <div>Modified: {new Date(file.lastModified).toLocaleDateString()}</div>
                              )}
                            </div>
                            {file.downloadUrl && (
                              <div className="flex gap-2 mt-3">
                                <a
                                  href={file.downloadUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="btn btn-outline btn-xs"
                                >
                                  <EyeIcon className="w-3 h-3" />
                                  View
                                </a>
                                <a
                                  href={file.downloadUrl}
                                  download={file.name}
                                  className="btn btn-primary btn-xs"
                                >
                                  Download
                                </a>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Upload Document Modal - Only show if we have a lead */}
      {showUploadModal && selectedLeadForUpload && (
        <UploadDocumentModal
          isOpen={showUploadModal}
          onClose={() => {
            setShowUploadModal(false);
            setSelectedLeadForUpload(null);
          }}
          contact={null}
          lead={selectedLeadForUpload as any}
          uploadFiles={uploadFiles as any}
          isUploading={isUploading && uploadingLeadId === selectedLeadForUpload?.id}
          onDocumentAdded={() => {
            // Refresh documents if needed
            if (selectedLeadForUpload) {
              fetchOneDriveFiles(selectedLeadForUpload);
            }
          }}
          currentUser={currentUser}
        />
      )}

      {/* Document Modal - Same as DocumentsTab "View All Documents" */}
      {isDocumentModalOpen && selectedLeadForDocumentModal && (
        <div className="fixed inset-0 z-[100] flex">
          <div className="fixed inset-0 bg-black/30 transition-opacity duration-300" onClick={() => { setIsDocumentModalOpen(false); setSelectedLeadForDocumentModal(null); }} />
          <div className="ml-auto w-full max-w-2xl bg-white h-full shadow-2xl p-0 flex flex-col animate-slideInRight z-[100] rounded-l-2xl border-l-4 border-primary relative" style={{ boxShadow: '0 0 40px 0 rgba(0,0,0,0.2)' }}>
            <DocumentModal
              isOpen={isDocumentModalOpen}
              onClose={() => { setIsDocumentModalOpen(false); setSelectedLeadForDocumentModal(null); }}
              leadNumber={selectedLeadForDocumentModal.lead_number}
              clientName={selectedLeadForDocumentModal.name}
              onDocumentCountChange={() => { }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default CasesTab; 