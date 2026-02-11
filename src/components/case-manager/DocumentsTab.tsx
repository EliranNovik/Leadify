import React, { useState, useEffect } from 'react';
import { 
  DocumentPlusIcon, 
  PencilIcon, 
  TrashIcon, 
  XMarkIcon,
  CloudArrowUpIcon,
  DocumentTextIcon,
  PlusIcon,
  DocumentArrowUpIcon,
  EyeIcon,
  UserGroupIcon,
  FolderIcon,
  ChevronDownIcon,
  EllipsisVerticalIcon,
  TableCellsIcon,
  Squares2X2Icon,
  CheckCircleIcon
} from '@heroicons/react/24/outline';
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
}

interface RequiredDocument {
  id: string;
  lead_id?: string | null;
  legacy_lead_id?: string | null;
  contact_id?: string;
  document_name: string;
  document_type: string;
  is_required: boolean;
  status: 'missing' | 'pending' | 'received' | 'approved' | 'rejected';
  notes?: string;
  due_date?: string;
  requested_date: string;
  received_date?: string;
  approved_date?: string;
  requested_by?: string;
  requested_from?: string;
  received_from?: string;
  requested_from_changed_at?: string;
  received_from_changed_at?: string;
  requested_from_changed_by?: string;
  received_from_changed_by?: string;
  created_at: string;
  updated_at: string;
  lead?: {
    name: string;
    lead_number: string;
  };
  requested_by_user?: {
    first_name?: string;
    full_name?: string;
  } | null;
  requested_from_changed_by_user?: {
    first_name?: string;
    full_name?: string;
  } | null;
}

interface DocumentTemplate {
  id: string;
  name: string;
  category: string;
  description?: string;
  is_active: boolean;
  typical_due_days: number;
  instructions?: string;
  created_at: string;
}

interface Contact {
  id: string;
  lead_id: string;
  name: string;
  email?: string;
  phone?: string;
  relationship: string;
  birth_date?: string;
  death_date?: string;
  birth_place?: string;
  current_address?: string;
  citizenship?: string;
  passport_number?: string;
  id_number?: string;
  is_main_applicant: boolean;
  is_persecuted: boolean;
  persecution_details?: any;
  contact_notes?: string;
  document_status: 'pending' | 'complete' | 'incomplete';
  created_at: string;
  updated_at: string;
  document_count?: number;
  completed_documents?: number;
  completion_percentage?: number;
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

// Documents Tab Component with full CRUD functionality
const DocumentsTab: React.FC<HandlerTabProps> = ({ leads, uploadFiles, uploadingLeadId, uploadedFiles, isUploading, handleFileInput }) => {
  console.log('🚀 DocumentsTab - Component rendered/mounted');
  console.log('🚀 DocumentsTab - Props received:', {
    leadsCount: leads?.length || 0,
    leads: leads,
    hasUploadFiles: !!uploadFiles
  });

    const [requiredDocuments, setRequiredDocuments] = useState<RequiredDocument[]>([]);
    const [contacts, setContacts] = useState<Contact[]>([]);
    const [documentTemplates, setDocumentTemplates] = useState<DocumentTemplate[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAddDocModal, setShowAddDocModal] = useState(false);
    const [selectedLead, setSelectedLead] = useState<HandlerLead | null>(null);
    const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
    const [editingDocument, setEditingDocument] = useState<RequiredDocument | null>(null);
    const [showDocumentModal, setShowDocumentModal] = useState(false);
    const [selectedLeadForDocs, setSelectedLeadForDocs] = useState<HandlerLead | null>(null);
    const [oneDriveFiles, setOneDriveFiles] = useState<any[]>([]);
    const [loadingFiles, setLoadingFiles] = useState(false);
    const [draggedFile, setDraggedFile] = useState<File | null>(null);
    const [dragOverContact, setDragOverContact] = useState<string | null>(null);
    const [expandedContact, setExpandedContact] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<{ id: string, full_name: string } | null>(null);
    const [flippedCards, setFlippedCards] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'box' | 'table'>('table');
  const [expandedTableRows, setExpandedTableRows] = useState<Set<string>>(new Set());
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [selectedContactForUpload, setSelectedContactForUpload] = useState<Contact | null>(null);
  const [selectedLeadForUpload, setSelectedLeadForUpload] = useState<HandlerLead | null>(null);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [selectedContactForRequest, setSelectedContactForRequest] = useState<Contact | null>(null);
  const [selectedLeadForRequest, setSelectedLeadForRequest] = useState<HandlerLead | null>(null);
  const [selectedDocumentNameForRequest, setSelectedDocumentNameForRequest] = useState<string>('');
  const [requestedFromForRequest, setRequestedFromForRequest] = useState<string>('');
  const [plusDropdownOpen, setPlusDropdownOpen] = useState<string | null>(null);
  const [showRequestDetailsModal, setShowRequestDetailsModal] = useState(false);
  const [selectedDocumentForDetails, setSelectedDocumentForDetails] = useState<RequiredDocument | null>(null);
  const [showDocumentEditModal, setShowDocumentEditModal] = useState(false);
  const [selectedDocumentForEdit, setSelectedDocumentForEdit] = useState<RequiredDocument | null>(null);
  const [templateDueDates, setTemplateDueDates] = useState<Record<string, string>>({});
  const [templateStatuses, setTemplateStatuses] = useState<Record<string, 'pending' | 'received' | 'missing'>>({});
  const [isDocumentModalOpen, setIsDocumentModalOpen] = useState(false);
  const [selectedLeadForDocumentModal, setSelectedLeadForDocumentModal] = useState<HandlerLead | null>(null);
  const [showDocumentsDropdown, setShowDocumentsDropdown] = useState(false);
  const [showRemoveDocumentModal, setShowRemoveDocumentModal] = useState(false);
    
    // Mobile detection
    const [isMobile, setIsMobile] = useState(false);
    const [expandedDocuments, setExpandedDocuments] = useState<Set<string>>(new Set());
    
    // Dropdown menu state
    const [openDropdown, setOpenDropdown] = useState<string | null>(null);

    // Dropdown options
    const sourceOptions = [
      'Ministry of Interior',
      'Rabbinical Office', 
      'Foreign Ministry',
      'Client',
      'Police',
      'Embassy'
    ];

    // Handle dropdown menu toggle
    const toggleDropdown = (documentId: string) => {
      setOpenDropdown(openDropdown === documentId ? null : documentId);
    };

    // Close dropdown when clicking outside
    useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        if (openDropdown && !(event.target as Element).closest('.dropdown-menu')) {
          setOpenDropdown(null);
        }
      if (showDocumentsDropdown && !(event.target as Element).closest('.documents-dropdown')) {
        setShowDocumentsDropdown(false);
      }
      };

      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openDropdown, showDocumentsDropdown]);

    useEffect(() => {
      const checkMobile = () => {
        setIsMobile(window.innerWidth < 768);
      };
      checkMobile();
      window.addEventListener('resize', checkMobile);
      return () => window.removeEventListener('resize', checkMobile);
    }, []);
  
    // New document form state
    const [newDocument, setNewDocument] = useState({
      document_name: '',
      document_type: 'identity',
      due_date: '',
      notes: '',
      is_required: true
    });
  
    // Fetch current user information
    const fetchCurrentUser = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data, error } = await supabase
            .from('users')
            .select('id, full_name')
            .eq('email', user.email)
            .single();
          
          if (error) {
            console.error('Error fetching user info:', error);
            // Fallback to email if full_name not found
            setCurrentUser({ id: user.id, full_name: user.email || 'Unknown User' });
          } else if (data) {
            setCurrentUser({ id: data.id, full_name: data.full_name || user.email || 'Unknown User' });
          }
        }
      } catch (err) {
        console.error('Failed to fetch current user:', err);
        setCurrentUser({ id: '00000000-0000-0000-0000-000000000000', full_name: 'System User' });
      }
    };
  
    // Fetch required documents from database with user information
    const fetchRequiredDocuments = async () => {
      setLoading(true);
      try {
      // Separate new leads (UUID) from legacy leads (numeric ID with "legacy_" prefix)
      const newLeads = leads.filter(lead => !lead.id.startsWith('legacy_'));
      const legacyLeads = leads.filter(lead => lead.id.startsWith('legacy_'));
      const newLeadIds = newLeads.map(lead => lead.id);
      const legacyLeadIds = legacyLeads.map(lead => lead.id.replace('legacy_', ''));

      const allDocuments: RequiredDocument[] = [];

      // Fetch documents for new leads (UUIDs)
      if (newLeadIds.length > 0) {
        console.log('🔍 Fetching documents for new leads:', newLeadIds);
        const { data: newDocuments, error: newDocumentsError } = await supabase
          .from('lead_required_documents')
          .select('*')
          .in('lead_id', newLeadIds)
          .order('created_at', { ascending: false });
        
        console.log('📥 Fetched new lead documents:', { count: newDocuments?.length || 0, documents: newDocuments });

        if (newDocumentsError) {
          console.error('Error fetching new lead documents:', newDocumentsError);
        } else if (newDocuments) {
          allDocuments.push(...newDocuments);
        }
      }

      // Fetch documents for legacy leads
      if (legacyLeadIds.length > 0) {
        const { data: legacyDocuments, error: legacyDocumentsError } = await supabase
          .from('lead_required_documents')
          .select('*')
          .in('legacy_lead_id', legacyLeadIds)
          .order('created_at', { ascending: false });

        if (legacyDocumentsError) {
          console.error('Error fetching legacy lead documents:', legacyDocumentsError);
        } else if (legacyDocuments) {
          // Map legacy documents to include the full legacy lead ID
          const mappedLegacyDocuments = legacyDocuments.map(doc => ({
            ...doc,
            lead_id: `legacy_${doc.legacy_lead_id}` // Add for compatibility
          }));
          allDocuments.push(...mappedLegacyDocuments);
        }
      }

      // Fetch user information for requested_by and requested_from_changed_by
      const userIds = new Set<string>();
      allDocuments.forEach(doc => {
        if (doc.requested_by && typeof doc.requested_by === 'string' && doc.requested_by.length > 10) {
          // Check if it looks like a UUID
          if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(doc.requested_by)) {
            userIds.add(doc.requested_by);
          }
        }
        if (doc.requested_from_changed_by && typeof doc.requested_from_changed_by === 'string' && doc.requested_from_changed_by.length > 10) {
          if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(doc.requested_from_changed_by)) {
            userIds.add(doc.requested_from_changed_by);
          }
        }
      });

      // Fetch users by ID
      let usersMap: Record<string, { first_name?: string; full_name?: string }> = {};
      if (userIds.size > 0) {
        const { data: users, error: usersError } = await supabase
          .from('users')
          .select('id, first_name, full_name')
          .in('id', Array.from(userIds));

        if (!usersError && users) {
          users.forEach(user => {
            usersMap[user.id] = { first_name: user.first_name, full_name: user.full_name };
          });
        }
      }

      // Also try to fetch by full_name if requested_by or requested_from_changed_by is a name
      const userNames = new Set<string>();
      allDocuments.forEach(doc => {
        if (doc.requested_by && typeof doc.requested_by === 'string' && !userIds.has(doc.requested_by)) {
          userNames.add(doc.requested_by);
        }
        if (doc.requested_from_changed_by && typeof doc.requested_from_changed_by === 'string' && !userIds.has(doc.requested_from_changed_by)) {
          userNames.add(doc.requested_from_changed_by);
        }
      });

      if (userNames.size > 0) {
        const nameArray = Array.from(userNames);
        // Build OR conditions for Supabase
        const orConditions = nameArray.map(name => `full_name.eq.${name},email.eq.${name}`).join(',');
        const { data: usersByName, error: usersByNameError } = await supabase
          .from('users')
          .select('id, first_name, full_name, email')
          .or(orConditions);

        if (!usersByNameError && usersByName) {
          usersByName.forEach(user => {
            // Map by full_name or email
            if (user.full_name && userNames.has(user.full_name)) {
              usersMap[user.full_name] = { first_name: user.first_name, full_name: user.full_name };
            }
            if (user.email && userNames.has(user.email)) {
              usersMap[user.email] = { first_name: user.first_name, full_name: user.full_name };
            }
          });
        }
      }

      // Map user information to documents
      const documentsWithUsers = allDocuments.map(doc => ({
        ...doc,
        requested_by_user: doc.requested_by ? usersMap[doc.requested_by] || null : null,
        requested_from_changed_by_user: doc.requested_from_changed_by ? usersMap[doc.requested_from_changed_by] || null : null
      }));

      setRequiredDocuments(documentsWithUsers);
      const uniqueDocNames = [...new Set(documentsWithUsers.map(d => d.document_name).filter(Boolean))];
      console.log('📄 Fetched required documents:', {
        count: documentsWithUsers.length,
        documentNames: uniqueDocNames,
        allDocuments: documentsWithUsers.map(d => ({
          name: d.document_name,
          lead_id: d.lead_id,
          legacy_lead_id: d.legacy_lead_id,
          contact_id: d.contact_id
        }))
      });
      } catch (err) {
        toast.error('Failed to fetch documents');
        console.error('Error fetching documents:', err);
      } finally {
        setLoading(false);
      }
    };
  
    // Fetch document templates
    const fetchDocumentTemplates = async () => {
      try {
        const { data, error } = await supabase
          .from('document_templates')
          .select('*')
          .eq('is_active', true)
          .order('category', { ascending: true });
        
        if (error) {
          console.error('Error fetching templates:', error.message);
        } else if (data) {
          setDocumentTemplates(data);
        }
      } catch (err) {
        console.error('Failed to fetch templates:', err);
      }
    };
  
  // Fetch contacts for this Documents tab (using same logic as ContactsTab)
    const fetchContacts = async () => {
    console.log('🚀 DocumentsTab - fetchContacts called');
    console.log('🚀 DocumentsTab - leads.length:', leads.length);
    console.log('🚀 DocumentsTab - leads:', leads);

    if (leads.length === 0) {
      console.log('⚠️ DocumentsTab - No leads, returning early');
      return;
    }
      
      try {
      // Separate new leads (UUID) from legacy leads (numeric ID with "legacy_" prefix)
        const newLeads = leads.filter(lead => !lead.id.startsWith('legacy_'));
      const legacyLeads = leads.filter(lead => lead.id.startsWith('legacy_'));
      const newLeadIds = newLeads.map(lead => lead.id);
      const allContacts: Contact[] = [];

      console.log('🚀 DocumentsTab - newLeads.length:', newLeads.length);
      console.log('🚀 DocumentsTab - legacyLeads.length:', legacyLeads.length);
      console.log('🚀 DocumentsTab - newLeadIds:', newLeadIds);

      // Fetch contacts for new leads (contacts table)
      if (newLeadIds.length > 0) {
        console.log('🔍 DocumentsTab - Fetching contacts for lead IDs:', newLeadIds);
        console.log('🔍 DocumentsTab - Number of new leads:', newLeads.length);

        // Fetch all contacts that match any of the lead IDs
        const { data: newContactsData, error: newContactsError } = await supabase
          .from('contacts')
          .select('*')
          .in('lead_id', newLeadIds)
          .order('is_main_applicant', { ascending: false })
          .order('created_at', { ascending: true });

        if (newContactsError) {
          console.error('❌ DocumentsTab - Error fetching new contacts:', newContactsError);
          toast.error('Error fetching contacts: ' + newContactsError.message);
        } else {
          console.log('🔍 DocumentsTab - Fetched contacts from database:', newContactsData?.length || 0);
          if (newContactsData && newContactsData.length > 0) {
            console.log('🔍 DocumentsTab - Sample contact data:', newContactsData[0]);
          }

          if (newContactsData && newContactsData.length > 0) {
            // Filter to only include contacts that match our leads (in case of any data inconsistencies)
            const validContacts = newContactsData.filter(contact => {
              const isValid = contact.lead_id && newLeadIds.includes(contact.lead_id);
              if (!isValid) {
                console.warn('⚠️ DocumentsTab - Contact with invalid lead_id found:', {
                  contact_id: contact.id,
                  contact_name: contact.name,
                  lead_id: contact.lead_id,
                  expected_lead_ids: newLeadIds
                });
              }
              return isValid;
            });

            console.log('🔍 DocumentsTab - Valid contacts after filtering:', validContacts.length);
            allContacts.push(...validContacts);
            console.log('🔍 DocumentsTab - Total contacts after processing:', allContacts.length);
          } else {
            console.log('🔍 DocumentsTab - No contacts found in database for these lead IDs');
          }
        }
      }

      // Fetch contacts for legacy leads (same logic as ContactsTab)
      if (legacyLeads.length > 0) {
        console.log('🔍 DocumentsTab - Fetching contacts for legacy leads:', legacyLeads.length);
        for (const legacyLead of legacyLeads) {
          const legacyId = legacyLead.id.replace('legacy_', '');
          const legacyIdPattern = `[LEGACY_LEAD_ID:${legacyId}]`;

          console.log('🔍 DocumentsTab - Checking legacy lead:', legacyId, 'pattern:', legacyIdPattern);

          // First, try to fetch from unified contacts table (if migrated or newly added)
          const { data: migratedContacts, error: migratedError } = await supabase
          .from('contacts')
          .select('*')
            .like('contact_notes', `%${legacyIdPattern}%`)
          .order('is_main_applicant', { ascending: false })
          .order('created_at', { ascending: true });
        
          if (!migratedError && migratedContacts && migratedContacts.length > 0) {
            console.log('🔍 DocumentsTab - Found', migratedContacts.length, 'contacts for legacy lead in contacts table');
            // Map contacts with legacy lead_id
            const legacyContactsWithLeadId = migratedContacts.map(contact => ({
              ...contact,
              lead_id: legacyLead.id,
              is_legacy: true
            }));
            allContacts.push(...legacyContactsWithLeadId);
            console.log('🔍 DocumentsTab - Added legacy contacts, total now:', allContacts.length);
          } else {
            console.log('🔍 DocumentsTab - No contacts found in unified table for legacy lead:', legacyId);
          }
        }
      }

      console.log('🔍 DocumentsTab - Final total contacts:', allContacts.length);
      setContacts(allContacts);
      } catch (err) {
        console.error('Failed to fetch contacts:', err);
      toast.error('Failed to fetch contacts');
      }
    };
  
    // Fetch OneDrive files for a lead (using same approach as ExpertTab)
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
  
    // Handle drag and drop
    const handleDragOver = (e: React.DragEvent, contactId: string) => {
      e.preventDefault();
      setDragOverContact(contactId);
    };
  
    const handleDragLeave = (e: React.DragEvent) => {
      e.preventDefault();
      setDragOverContact(null);
    };
  
    const handleDrop = async (e: React.DragEvent, contact: Contact) => {
      e.preventDefault();
      setDragOverContact(null);
      
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        const lead = leads.find(l => l.id === contact.lead_id);
        if (lead) {
          await uploadFiles(lead, files);
        }
      }
    };
  
    useEffect(() => {
    console.log('🚀 DocumentsTab - useEffect triggered, leads.length:', leads.length);
      fetchCurrentUser();
      if (leads.length > 0) {
      console.log('🚀 DocumentsTab - Calling fetch functions...');
        fetchRequiredDocuments();
        fetchDocumentTemplates();
        fetchContacts();
    } else {
      console.log('⚠️ DocumentsTab - No leads, skipping fetch');
      }
    }, [leads]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (plusDropdownOpen) {
        setPlusDropdownOpen(null);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, [plusDropdownOpen]);
  
    // Add new required document
    const addRequiredDocument = async () => {
    // Auto-select lead if only one is available
    const leadToUse = selectedLead || (leads.length === 1 ? leads[0] : null);

    if (!newDocument.document_name.trim() || !leadToUse) {
        toast.error('Document name and lead are required');
        return;
      }
  
      try {
      const isLegacyLead = leadToUse.id.startsWith('legacy_');

      const documentData: any = {
        document_name: newDocument.document_name,
        document_type: newDocument.document_type,
          contact_id: selectedContact?.id || null,
        is_required: newDocument.is_required,
        notes: newDocument.notes || null,
        due_date: newDocument.due_date || null,
        status: 'pending',
        requested_by: currentUser?.id || currentUser?.full_name || 'System User',
        requested_date: new Date().toISOString()
      };

      // For legacy leads, use legacy_lead_id; for new leads, use lead_id
      if (isLegacyLead) {
        // Remove "legacy_" prefix when saving to legacy_lead_id column
        documentData.legacy_lead_id = leadToUse.id.replace('legacy_', '');
        documentData.lead_id = null;
      } else {
        documentData.lead_id = leadToUse.id;
        documentData.legacy_lead_id = null;
      }

      const { data: insertedDocument, error } = await supabase
          .from('lead_required_documents')
        .insert(documentData)
        .select();
        
        if (error) {
          toast.error('Error adding document: ' + error.message);
        console.error('Error adding document:', error);
        } else {
        console.log('✅ Document added successfully:', insertedDocument);
          toast.success('Document added successfully');
          setShowAddDocModal(false);
          setNewDocument({
            document_name: '',
            document_type: 'identity',
            due_date: '',
            notes: '',
            is_required: true
          });
          setSelectedLead(null);
        setSelectedContact(null);
        // Force a refresh of documents
          await fetchRequiredDocuments();
        console.log('✅ Documents refreshed after adding new document');
        }
      } catch (err) {
        toast.error('Failed to add document');
        console.error('Error adding document:', err);
      }
    };
  
    // Update document status with tracking
    const updateDocumentStatus = async (documentId: string, status: string, changeReason?: string, notes?: string) => {
      try {
        if (!currentUser) {
          toast.error('User not authenticated');
          return;
        }
  
      // Prepare update data
      const updateData: any = {
        status: status
      };

      // Set received_date if status is 'received'
      if (status === 'received') {
        updateData.received_date = new Date().toISOString();
      }

      // Try stored procedure first, fallback to direct update
      const { error: rpcError } = await supabase.rpc('update_document_status_with_tracking', {
          p_document_id: documentId,
          p_new_status: status,
        p_changed_by: currentUser.id || currentUser.full_name,
          p_change_reason: changeReason || null,
          p_notes: notes || null
        });
        
      if (rpcError) {
        // Fallback to direct update if stored procedure fails
        console.warn('Stored procedure failed, using direct update:', rpcError);
        const { error: updateError } = await supabase
          .from('lead_required_documents')
          .update(updateData)
          .eq('id', documentId);

        if (updateError) {
          toast.error('Error updating document: ' + updateError.message);
          console.error('Error updating document status:', updateError);
          return;
        }
      }

      toast.success(`Document status updated to ${status}`);
      await fetchRequiredDocuments();
    } catch (err) {
      // Final fallback: try direct update
      try {
        const updateData: any = {
          status: status
        };
        if (status === 'received') {
          updateData.received_date = new Date().toISOString();
        }
        const { error: updateError } = await supabase
          .from('lead_required_documents')
          .update(updateData)
          .eq('id', documentId);

        if (updateError) {
          toast.error('Failed to update document: ' + updateError.message);
          console.error('Error updating document status:', updateError);
        } else {
          toast.success(`Document status updated to ${status}`);
          await fetchRequiredDocuments();
        }
      } catch (fallbackErr) {
        toast.error('Failed to update document');
        console.error('Error updating document status:', fallbackErr);
      }
      }
    };

    // Update document requested_from with tracking
    const updateDocumentRequestedFrom = async (documentId: string, requestedFrom: string) => {
      try {
        if (!currentUser) {
          toast.error('User not authenticated');
          return;
        }
  
      // Try stored procedure first, fallback to direct update
      const { error: rpcError } = await supabase.rpc('update_document_requested_from_with_name_tracking', {
          p_document_id: documentId,
          p_requested_from: requestedFrom,
          p_changed_by_name: currentUser.full_name
        });
        
      if (rpcError) {
        // Fallback to direct update if stored procedure fails
        console.warn('Stored procedure failed, using direct update:', rpcError);
        const { error: updateError } = await supabase
          .from('lead_required_documents')
          .update({ requested_from: requestedFrom || null })
          .eq('id', documentId);

        if (updateError) {
          toast.error('Error updating requested from: ' + updateError.message);
          console.error('Error updating requested from:', updateError);
          return;
        }
      }

      toast.success(`Requested from updated to ${requestedFrom || 'none'}`);
      await fetchRequiredDocuments();
    } catch (err) {
      // Final fallback: try direct update
      try {
        const { error: updateError } = await supabase
          .from('lead_required_documents')
          .update({ requested_from: requestedFrom || null })
          .eq('id', documentId);

        if (updateError) {
          toast.error('Failed to update requested from: ' + updateError.message);
          console.error('Error updating requested from:', updateError);
        } else {
          toast.success(`Requested from updated to ${requestedFrom || 'none'}`);
          await fetchRequiredDocuments();
        }
      } catch (fallbackErr) {
        toast.error('Failed to update requested from');
        console.error('Error updating requested from:', fallbackErr);
      }
    }
  };

  // Request a document (create document requirement)
  const requestDocument = async (contact: Contact, lead: HandlerLead, documentName: string, requestedFrom: string) => {
    try {
      if (!currentUser) {
        toast.error('User not authenticated');
        return;
      }

      // Check if this is a legacy lead
      const isLegacyLead = lead.id.startsWith('legacy_');
      const legacyLeadId = isLegacyLead ? lead.id.replace('legacy_', '') : null;

      // Find the template for this document
      const template = documentTemplates.find(t => t.name === documentName);
      const defaultDueDate = template ? (() => {
        const date = new Date();
        date.setDate(date.getDate() + template.typical_due_days);
        return date.toISOString();
      })() : null;

      const documentData: any = {
        contact_id: contact.id,
        document_name: documentName,
        document_type: template?.category || 'identity',
        due_date: defaultDueDate,
        notes: template?.instructions || null,
        is_required: true,
        status: 'pending',
        requested_from: requestedFrom,
        requested_by: currentUser.id || currentUser.full_name || 'System User',
        requested_date: new Date().toISOString()
      };

      // Set lead_id or legacy_lead_id based on lead type
      if (isLegacyLead) {
        documentData.legacy_lead_id = legacyLeadId;
        documentData.lead_id = null;
      } else {
        documentData.lead_id = lead.id;
        documentData.legacy_lead_id = null;
      }

      const { error } = await supabase
        .from('lead_required_documents')
        .insert(documentData)
        .select()
        .single();

        if (error) {
        toast.error('Error requesting document: ' + error.message);
        console.error('Error requesting document:', error);
        } else {
        toast.success(`${documentName} requested successfully`);
          await fetchRequiredDocuments();
        setShowRequestModal(false);
        setSelectedContactForRequest(null);
        setSelectedLeadForRequest(null);
        setSelectedDocumentNameForRequest('');
        setRequestedFromForRequest('');
        }
      } catch (err) {
      toast.error('Failed to request document');
      console.error('Error requesting document:', err);
      }
    };

    // Update document received_from with tracking
  // Get custom document names (excluding default documents)
  const getCustomDocumentNames = (): string[] => {
    const defaultDocumentNames = ['Birth Certificate', 'Marriage Certificate', 'Passport Copy', 'Police Certificate'];
    const allDocumentNames = new Set<string>();

    requiredDocuments.forEach(doc => {
      if (doc.document_name && !defaultDocumentNames.includes(doc.document_name)) {
        allDocumentNames.add(doc.document_name);
      }
    });

    return Array.from(allDocumentNames).sort();
  };

  // Delete all documents with a specific document name
  const deleteRequiredDocument = async (documentName: string) => {
    try {
      // Get all documents with this name for all leads
      const documentsToDelete = requiredDocuments.filter(doc => doc.document_name === documentName);

      if (documentsToDelete.length === 0) {
        toast.error('No documents found to delete');
        return;
      }

      // Delete all documents with this name
      const documentIds = documentsToDelete.map(doc => doc.id);

      const { error } = await supabase
        .from('lead_required_documents')
        .delete()
        .in('id', documentIds);

      if (error) {
        toast.error('Error deleting documents: ' + error.message);
        console.error('Error deleting documents:', error);
        return;
      }

      toast.success(`Successfully removed "${documentName}" document requirement`);
      await fetchRequiredDocuments();
      setShowRemoveDocumentModal(false);
    } catch (err) {
      toast.error('Failed to delete documents');
      console.error('Error deleting documents:', err);
    }
  };

    const updateDocumentReceivedFrom = async (documentId: string, receivedFrom: string) => {
      try {
        if (!currentUser) {
          toast.error('User not authenticated');
          return;
        }
  
      // Try stored procedure first, fallback to direct update
      const { error: rpcError } = await supabase.rpc('update_document_received_from_with_name_tracking', {
          p_document_id: documentId,
          p_received_from: receivedFrom,
          p_changed_by_name: currentUser.full_name
        });
        
      if (rpcError) {
        // Fallback to direct update if stored procedure fails
        console.warn('Stored procedure failed, using direct update:', rpcError);
        const { error: updateError } = await supabase
          .from('lead_required_documents')
          .update({ received_from: receivedFrom || null })
          .eq('id', documentId);

        if (updateError) {
          toast.error('Error updating received from: ' + updateError.message);
          console.error('Error updating received from:', updateError);
          return;
        }
      }

      toast.success(`Received from updated to ${receivedFrom || 'none'}`);
      await fetchRequiredDocuments();
    } catch (err) {
      // Final fallback: try direct update
      try {
        const { error: updateError } = await supabase
          .from('lead_required_documents')
          .update({ received_from: receivedFrom || null })
          .eq('id', documentId);

        if (updateError) {
          toast.error('Failed to update received from: ' + updateError.message);
          console.error('Error updating received from:', updateError);
        } else {
          toast.success(`Received from updated to ${receivedFrom || 'none'}`);
          await fetchRequiredDocuments();
        }
      } catch (fallbackErr) {
        toast.error('Failed to update received from');
        console.error('Error updating received from:', fallbackErr);
      }
      }
    };
  
    // Update document details
    const updateDocument = async () => {
      if (!editingDocument) return;
  
      try {
        const { error } = await supabase
          .from('lead_required_documents')
          .update({
            document_name: editingDocument.document_name,
            document_type: editingDocument.document_type,
            due_date: editingDocument.due_date,
            notes: editingDocument.notes,
            is_required: editingDocument.is_required
          })
          .eq('id', editingDocument.id);
        
        if (error) {
          toast.error('Error updating document: ' + error.message);
        } else {
          toast.success('Document updated successfully');
          setEditingDocument(null);
          await fetchRequiredDocuments();
        }
      } catch (err) {
        toast.error('Failed to update document');
      }
    };
  
    // Delete document
    const deleteDocument = async (documentId: string) => {
      if (!confirm('Are you sure you want to delete this required document?')) return;
  
      try {
        const { error } = await supabase
          .from('lead_required_documents')
          .delete()
          .eq('id', documentId);
        
        if (error) {
          toast.error('Error deleting document: ' + error.message);
        } else {
          toast.success('Document deleted successfully');
          await fetchRequiredDocuments();
        }
      } catch (err) {
        toast.error('Failed to delete document');
      }
    };
  
    // Add template document to lead
  const addTemplateDocument = async (leadId: string, template: DocumentTemplate, contactId?: string) => {
    // Check if this is a legacy lead
    if (leadId.startsWith('legacy_')) {
      toast.error('Cannot add documents for legacy leads. Please use the legacy system.');
      return;
    }

      try {
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + template.typical_due_days);
  
        const documentData = {
          lead_id: leadId,
        contact_id: contactId || null,
          document_name: template.name,
          document_type: template.category,
          due_date: dueDate.toISOString(),
          notes: template.instructions,
        is_required: true,
        status: 'pending',
        requested_by: currentUser?.id || currentUser?.full_name || 'System User'
        };
  
        const { error } = await supabase
          .from('lead_required_documents')
          .insert(documentData);
        
        if (error) {
          toast.error('Error adding template document: ' + error.message);
        } else {
          toast.success(`${template.name} added to requirements`);
          await fetchRequiredDocuments();
        }
      } catch (err) {
        toast.error('Failed to add template document');
      }
    };
  
    // Get status badge color with gradients
    const getStatusBadgeColor = (status: string) => {
      switch (status) {
        case 'received':
          return 'badge-success bg-gradient-to-tr from-green-500 via-green-600 to-green-700 text-white border-transparent';
        case 'missing':
          return 'badge-primary bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-transparent';
        default:
          return 'badge-primary'; // Default purple for other statuses
      }
    };
  
    // Get documents for a specific lead
    const getLeadDocuments = (leadId: string) => {
    const isLegacyLead = leadId.startsWith('legacy_');
    if (isLegacyLead) {
      const legacyId = leadId.replace('legacy_', '');
      return requiredDocuments.filter(doc => doc.legacy_lead_id === legacyId);
    } else {
      return requiredDocuments.filter(doc => doc.lead_id === leadId);
    }
    };
  
    if (loading) {
      return (
        <div className="text-center py-12">
          <div className="loading loading-spinner loading-lg text-blue-600 mb-4"></div>
          <p className="text-lg text-gray-600">Loading documents...</p>
        </div>
      );
    }
  
    return (
      <div className="w-full px-2 sm:px-8">
        {/* Header */}
        <div className="mb-6 sm:mb-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h3 className="text-lg sm:text-xl font-bold text-gray-900">Document Management</h3>
              <p className="text-sm sm:text-base text-gray-600">Manage required documents for all cases</p>
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
            <div className="relative documents-dropdown">
              <button
                className="btn btn-primary btn-circle"
                onClick={() => setShowDocumentsDropdown(!showDocumentsDropdown)}
                title="Document Actions"
              >
                <EllipsisVerticalIcon className="w-5 h-5" />
              </button>
              {showDocumentsDropdown && (
                <div className="absolute right-0 top-full mt-2 bg-white border border-gray-200 rounded-lg shadow-lg z-50 min-w-[200px]">
                  <button
                    className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowAddDocModal(true);
                      setShowDocumentsDropdown(false);
                    }}
            >
              <PlusIcon className="w-4 h-4" />
              Add Document Requirement
            </button>
                  {leads.length > 0 && (
                    <button
                      className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        const firstLead = leads[0];
                        setSelectedLeadForDocumentModal(firstLead);
                        setIsDocumentModalOpen(true);
                        setShowDocumentsDropdown(false);
                      }}
                    >
                      <FolderIcon className="w-4 h-4" />
                      View All Documents
                    </button>
                  )}
                  <button
                    className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowRemoveDocumentModal(true);
                      setShowDocumentsDropdown(false);
                    }}
                  >
                    <TrashIcon className="w-4 h-4" />
                    Remove Required Document
                  </button>
                </div>
              )}
            </div>
          </div>
          </div>
        </div>

        {/* Content Container with Background */}
          {leads.length === 0 ? (
        <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-3 sm:p-6">
            <div className="text-center py-16 px-8 text-gray-500">
              <DocumentTextIcon className="w-16 h-16 mx-auto mb-4 text-gray-300" />
              <p className="text-lg font-medium mb-1">No cases to manage documents</p>
            </div>
        </div>
      ) : viewMode === 'table' ? (
        /* Table View - Show contacts with dynamic document columns */
        <div className="w-full overflow-x-auto">
          {(() => {
            // Default document names that should always be shown
            const defaultDocumentNames = ['Birth Certificate', 'Marriage Certificate', 'Passport Copy', 'Police Certificate'];

            // Get all unique document names from requiredDocuments across all leads
            const allDocumentNames = new Set<string>();

            // Always include default documents
            defaultDocumentNames.forEach(name => allDocumentNames.add(name));

            // Add all other documents from the database
            requiredDocuments.forEach(doc => {
              if (doc.document_name) {
                allDocumentNames.add(doc.document_name);
              }
            });

            // Convert to array: default documents first, then others sorted
            const defaultDocs = defaultDocumentNames.filter(name => allDocumentNames.has(name));
            const otherDocs = Array.from(allDocumentNames).filter(name => !defaultDocumentNames.includes(name)).sort();
            const documentNamesArray = [...defaultDocs, ...otherDocs];


            // Collect all contacts from all leads
            const allContactsList: Contact[] = [];
            leads.forEach((lead) => {
              const leadContacts = contacts.filter(contact => contact.lead_id === lead.id);
              allContactsList.push(...leadContacts);
            });

            // Calculate colspan: Contact Name + Relationship + all document columns
            const totalCols = 2 + documentNamesArray.length;

            return (
              <table className="table w-full">
                <thead>
                  <tr>
                    <th>Contact Name</th>
                    <th>Relationship</th>
                    {documentNamesArray.map(docName => (
                      <th key={docName}>{docName}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {allContactsList.length === 0 ? (
                    <tr>
                      <td colSpan={totalCols} className="text-center py-16 text-gray-500">
                        <UserGroupIcon className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                        <p className="text-lg font-medium mb-1">No applicants found</p>
                        <p className="text-sm text-gray-400">Add applicants in the Contacts tab first</p>
                      </td>
                    </tr>
                  ) : (
                    allContactsList.map((contact) => {
                      const lead = leads.find(l => l.id === contact.lead_id);
                      if (!lead) return null;

                      // Get documents for this specific contact OR documents for all applicants (contact_id is null) for this lead
                      const isLegacyLead = lead.id.startsWith('legacy_');
                      const contactDocs = requiredDocuments.filter(doc => {
                        // Document specific to this contact
                        if (doc.contact_id === contact.id) {
                          if (isLegacyLead) {
                            return doc.legacy_lead_id === lead.id.replace('legacy_', '');
                          } else {
                            return doc.lead_id === lead.id;
                          }
                        }
                        // Document for all applicants (contact_id is null)
                        if (doc.contact_id === null) {
                          if (isLegacyLead) {
                            return doc.legacy_lead_id === lead.id.replace('legacy_', '');
                          } else {
                            return doc.lead_id === lead.id;
                          }
                        }
                        return false;
                      });

                      // Helper function to get document for a specific name
                      const getDocumentForName = (docName: string) => {
                        // First try to find a document specific to this contact
                        const contactSpecificDoc = contactDocs.find(doc => doc.document_name === docName && doc.contact_id === contact.id);
                        if (contactSpecificDoc) return contactSpecificDoc;
                        // If not found, return a document for all applicants (contact_id is null)
                        return contactDocs.find(doc => doc.document_name === docName && doc.contact_id === null);
                      };

                      // Render document cell for a specific document name
                      const renderDocumentCell = (docName: string) => {
                        const doc = getDocumentForName(docName);

                        if (!doc) {
                          // Document doesn't exist - show dropdown with options
                          const dropdownId = `${contact.id}-${docName}`;
                          const isDropdownOpen = plusDropdownOpen === dropdownId;
                          return (
                            <td className="text-center" onClick={(e) => e.stopPropagation()}>
                              <div className="relative dropdown">
                                <button
                                  className="btn btn-ghost btn-xs text-green-600 hover:bg-green-600 hover:text-white"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setPlusDropdownOpen(isDropdownOpen ? null : dropdownId);
                                  }}
                                  title={`Add ${docName}`}
                                >
                                  <PlusIcon className="w-4 h-4" />
                                </button>
                                {isDropdownOpen && (
                                  <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 min-w-[180px]">
                                    <button
                                      className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (lead) {
                                          setSelectedContactForUpload(contact);
                                          setSelectedLeadForUpload(lead);
                                          setShowUploadModal(true);
                                          setPlusDropdownOpen(null);
                                        }
                                      }}
                                    >
                                      <CloudArrowUpIcon className="w-5 h-5" />
                                      Upload Document
                                    </button>
                                    <button
                                      className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (lead) {
                                          setSelectedContactForRequest(contact);
                                          setSelectedLeadForRequest(lead);
                                          setSelectedDocumentNameForRequest(docName);
                                          setShowRequestModal(true);
                                          setPlusDropdownOpen(null);
                                        }
                                      }}
                                    >
                                      <DocumentTextIcon className="w-4 h-4" />
                                      Request Document
                                    </button>
                                  </div>
                                )}
                              </div>
                            </td>
                          );
                        }

                        // Document exists - show status and controls
                        // If requested_from is set, show simplified view with date stamp (clickable to open modal)
                        // If requested_from is NOT set, show plus icon with dropdown (same as when document doesn't exist)
                        if (doc.requested_from) {
                          // Document is requested - show simplified view
                          return (
                            <td onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center gap-2 p-1 rounded text-xs">
                                <div
                                  className="cursor-pointer hover:bg-gray-100 flex-1 p-1 rounded text-gray-500 flex items-center gap-2"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedDocumentForEdit(doc);
                                    setShowDocumentEditModal(true);
                                  }}
                                  title="Click to edit document details"
                                >
                                  <span>
                                    {doc.requested_from_changed_at ? new Date(doc.requested_from_changed_at).toLocaleDateString() : doc.requested_date ? new Date(doc.requested_date).toLocaleDateString() : '-'} • {doc.requested_from_changed_by_user?.first_name || doc.requested_from_changed_by_user?.full_name || doc.requested_by_user?.first_name || doc.requested_by_user?.full_name || doc.requested_from_changed_by || doc.requested_by || 'Unknown'}
                                  </span>
                                  {doc.status !== 'received' && (
                                    <button
                                      className="btn btn-ghost btn-xs text-blue-600 hover:bg-blue-600 hover:text-white flex-shrink-0"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (lead) {
                                          setSelectedContactForUpload(contact);
                                          setSelectedLeadForUpload(lead);
                                          setShowUploadModal(true);
                                        }
                                      }}
                                      title="Upload Document"
                                    >
                                      <CloudArrowUpIcon className="w-6 h-6" />
                                    </button>
                                  )}
                                  {doc.status === 'received' && (
                                    <CheckCircleIcon className="w-6 h-6 text-green-600 flex-shrink-0" title="Received" />
                                  )}
                                </div>
                              </div>
                            </td>
                          );
                        }

                        // Document exists but not requested - show plus icon with dropdown (same as when document doesn't exist)
                        const dropdownId = `${contact.id}-${docName}-existing`;
                        const isDropdownOpen = plusDropdownOpen === dropdownId;
                        return (
                          <td className="text-center" onClick={(e) => e.stopPropagation()}>
                            <div className="relative dropdown">
                              <button
                                className="btn btn-ghost btn-xs text-green-600 hover:bg-green-600 hover:text-white"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPlusDropdownOpen(isDropdownOpen ? null : dropdownId);
                                }}
                                title={`Add ${docName}`}
                              >
                                <PlusIcon className="w-4 h-4" />
                              </button>
                              {isDropdownOpen && (
                                <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 min-w-[180px]">
                                  <button
                                    className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (lead) {
                                        setSelectedContactForUpload(contact);
                                        setSelectedLeadForUpload(lead);
                                        setShowUploadModal(true);
                                        setPlusDropdownOpen(null);
                                      }
                                    }}
                                  >
                                    <CloudArrowUpIcon className="w-5 h-5" />
                                    Upload Document
                                  </button>
                                  <button
                                    className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (lead) {
                                        setSelectedContactForRequest(contact);
                                        setSelectedLeadForRequest(lead);
                                        setSelectedDocumentNameForRequest(docName);
                                        setShowRequestModal(true);
                                        setPlusDropdownOpen(null);
                                      }
                                    }}
                                  >
                                    <DocumentTextIcon className="w-4 h-4" />
                                    Request Document
                                  </button>
                                </div>
                              )}
                            </div>
                          </td>
                        );
                      };

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
                          {documentNamesArray.map(docName => renderDocumentCell(docName))}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            );
          })()}
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-3 sm:p-6">
            <div className="w-full">
              {leads.map((lead) => {
                const leadContacts = contacts.filter(contact => contact.lead_id === lead.id);
                
                return (
                  <div key={lead.id} className="w-full p-2 sm:p-8 mb-4 sm:mb-8">
                    <div className="flex items-center justify-between mb-6">
                      <div>
                        <h4 className="text-lg font-bold text-gray-900 mb-2">Total Applicants</h4>
                        <p className="text-sm text-gray-500">{leadContacts.length} applicant(s)</p>
                      </div>
                      <div className="flex gap-2">
                        {lead.onedrive_folder_link && (
                          <>
                            <button
                              className="btn btn-outline btn-sm flex gap-2 items-center"
                              onClick={() => fetchOneDriveFiles(lead)}
                              disabled={loadingFiles}
                            >
                              <EyeIcon className="w-4 h-4" />
                              {loadingFiles ? 'Loading...' : 'View Documents'}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
  
                  {/* Applicants Grid - Enhanced Stylish Design */}
                  {leadContacts.length === 0 ? (
                    <div className="text-center py-16 px-8 text-gray-500">
                      <UserGroupIcon className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                      <p className="text-lg font-medium mb-1">No applicants found</p>
                      <p className="text-sm text-gray-400">Add applicants in the Applicants tab first</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-8">
                      {leadContacts.map((contact) => {
                        const contactDocuments = requiredDocuments.filter(doc => doc.contact_id === contact.id);
                        const completedDocs = contactDocuments.filter(doc => ['approved', 'received'].includes(doc.status)).length;
                        const totalDocs = contactDocuments.length;
                        const completionPercentage = totalDocs > 0 ? Math.round((completedDocs / totalDocs) * 100) : 0;
                        
                        const isExpanded = expandedContact === contact.id;
                        
                        return (
                          <div 
                            key={contact.id} 
                            className={`relative bg-white rounded-xl shadow-lg border border-gray-200 transition-all duration-300 hover:shadow-xl cursor-pointer ${dragOverContact === contact.id
                                ? 'border-blue-500 bg-blue-50 scale-105 shadow-xl' 
                                : 'hover:border-gray-300'
                            } ${isExpanded ? 'col-span-full' : ''} ${flippedCards.has(contact.id) ? 'min-h-[600px]' : ''}`}
                            onDragOver={(e) => handleDragOver(e, contact.id)}
                            onDragLeave={handleDragLeave}
                            onDrop={(e) => handleDrop(e, contact)}
              onClick={() => {
                              // Only flip cards on mobile
                              if (isMobile) {
                                const newFlippedCards = new Set(flippedCards);
                                if (newFlippedCards.has(contact.id)) {
                                  newFlippedCards.delete(contact.id);
                                } else {
                                  newFlippedCards.add(contact.id);
                                }
                                setFlippedCards(newFlippedCards);
                              }
                            }}
                          >
                            {/* Front of Card */}
                            {(!flippedCards.has(contact.id) || !isMobile) && (
                              <div className={`flex ${isExpanded ? 'gap-6' : ''}`}>
                                <div className={`${isExpanded ? 'w-1/2' : 'w-full'} p-3 sm:p-6 relative`}>
                                  {/* Completion Progress Ring */}
                                  <div className="absolute -top-4 -right-4">
                                    <div className="radial-progress text-white text-xs font-bold bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600" 
                                      style={{ "--value": completionPercentage, "--size": "3rem" } as React.CSSProperties}
                                    role="progressbar">
                                      {completionPercentage}%
                                    </div>
                                  </div>
  
                                  {/* Contact Header */}
                                  <div className="mb-4 sm:mb-6">
                                    <div className="flex items-start justify-between mb-3">
                                      <div className="flex-1">
                                        <div className="flex items-center gap-2 sm:gap-3 mb-2">
                                          <div className="w-10 h-10 sm:w-12 sm:h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold text-base sm:text-lg">
                                            {contact.name.charAt(0).toUpperCase()}
                                          </div>
                <div>
                                            <h5 className="text-base sm:text-lg font-bold text-gray-900">{contact.name}</h5>
                                            <div className="flex items-center gap-1 sm:gap-2 mt-1">
                                              <span className="badge badge-xs sm:badge-sm badge-primary bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-transparent">
                                                {contact.relationship?.replace('_', ' ')}
                                              </span>
                                              {contact.is_persecuted && (
                                                <span className="badge badge-xs sm:badge-sm badge-primary bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-transparent">⚠️ Persecuted</span>
                                              )}
                                            </div>
                </div>
                                        </div>
              </div>
            </div>
  
                                    {/* Document Status Summary */}
                                    <div className="p-2 sm:p-4">
                                      <div className="flex items-center justify-between mb-2">
                                        <span className="text-xs sm:text-sm font-medium text-gray-700">Document Progress</span>
                                        <span className="text-xs sm:text-sm font-bold text-gray-900">{completedDocs}/{totalDocs}</span>
                                      </div>
                                      <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
                                        <div 
                                          className="h-2 rounded-full transition-all duration-500 bg-gradient-to-r from-pink-500 via-purple-500 to-purple-600"
                                          style={{ width: `${completionPercentage}%` }}
                                        ></div>
                                      </div>
                                      <div className="flex justify-between text-xs text-gray-600">
                                        <span>Missing: {totalDocs - completedDocs}</span>
                                        <span>Complete: {completedDocs}</span>
                                      </div>
                                    </div>
                                  </div>
  
                                  {/* Drag & Drop Area - Compact */}
                                  <div className={`mb-3 sm:mb-4 p-2 sm:p-3 border-2 border-dashed rounded-lg text-center transition-all duration-300 cursor-pointer ${dragOverContact === contact.id
                                      ? 'border-purple-500 bg-purple-100' 
                                      : 'border-gray-300 bg-gray-50 hover:border-purple-400'
                                  }`}>
                                    <input 
                                      type="file" 
                                      className="hidden" 
                                      multiple 
                                      id={`file-upload-${contact.id}`}
                                      onChange={(e) => {
                                        const files = Array.from(e.target.files || []);
                                        if (files.length > 0) {
                                          const lead = leads.find(l => l.id === contact.lead_id);
                                          if (lead) {
                                            uploadFiles(lead, files);
                                          }
                                        }
                                      }}
                                    />
                                    <label htmlFor={`file-upload-${contact.id}`} className="cursor-pointer block w-full h-full">
                                      <DocumentArrowUpIcon className="w-5 h-5 sm:w-6 sm:h-6 mx-auto mb-1 text-purple-500" />
                                      <p className="text-xs text-gray-600">
                                        Drop files or browse
                                      </p>
                                    </label>
                                  </div>
                                  
                                  {/* Required Documents Section - Desktop Only */}
                                  {!isMobile && (
                                    <div className="mt-6">
                                      <div className="text-center mb-4">
                                        <h3 className="text-xl font-bold text-gray-900 mb-2">Required Documents</h3>
                                        <div className="border-b-2 border-gray-300 mb-4"></div>
                                        {contactDocuments.length > 0 && (
                                          <button
                                            className="btn btn-ghost text-purple-600 hover:text-purple-700 flex items-center gap-2 mx-auto"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              const newExpanded = new Set(expandedDocuments);
                                              if (newExpanded.has(contact.id)) {
                                                newExpanded.delete(contact.id);
                                              } else {
                                                newExpanded.add(contact.id);
                                              }
                                              setExpandedDocuments(newExpanded);
                                            }}
                                          >
                                            {expandedDocuments.has(contact.id) ? 'See Less' : 'See More'}
                                            <ChevronDownIcon className={`w-4 h-4 transition-transform duration-200 ${expandedDocuments.has(contact.id) ? 'rotate-180' : ''}`} />
                                          </button>
                                        )}
                                      </div>
                                      
                                      {expandedDocuments.has(contact.id) && (
                                        <div className="space-y-3">
                                          {contactDocuments.length === 0 ? (
                                            <div className="text-center py-8 px-4">
                                              <DocumentTextIcon className="w-12 h-12 mx-auto mb-2 text-gray-300" />
                                              <p className="text-sm text-gray-500 mb-1">No documents required</p>
                                              <p className="text-xs text-gray-400">Use the button below to add your first document</p>
                                            </div>
                                          ) : (
                                            contactDocuments.map((doc) => (
                                              <div key={doc.id} className="bg-white rounded-lg p-4 border border-gray-200 shadow-lg hover:shadow-xl transition-all duration-300">
                                                <div className="flex items-start justify-between mb-3">
                                                  <div className="flex-1">
                                                    <div className="mb-3">
                                                      <div className="flex items-center justify-between">
                                                        <h4 className="text-base font-bold text-gray-900">{doc.document_name}</h4>
                                                        {doc.due_date && (
                                                          <span className="text-sm text-gray-600">
                                                            <strong>Due:</strong> {doc.due_date ? new Date(doc.due_date).toLocaleDateString() : 'No due date'}
                                                          </span>
                                                        )}
                                                      </div>
                                                    </div>
                                                    <div className="flex items-center justify-between mb-2">
                                                      <span className="text-sm text-gray-600">Type: {doc.document_type}</span>
                                                    </div>
                                                    <div className="border-b border-gray-200 mb-3"></div>
                                                  </div>
                                                  <div className="relative dropdown-menu">
                                                    <button
                                                      className="btn btn-ghost btn-sm text-purple-600 hover:text-purple-700"
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        toggleDropdown(doc.id);
                                                      }}
                                                      title="More options"
                                                    >
                                                      <EllipsisVerticalIcon className="w-7 h-7" />
                                                    </button>
                                                    
                                                    {openDropdown === doc.id && (
                                                      <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 min-w-[120px]">
                                                        <button
                                                          className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                                                          onClick={(e) => {
                                                            e.stopPropagation();
                                                            setEditingDocument(doc);
                                                            setOpenDropdown(null);
                                                          }}
                                                        >
                                                          <PencilIcon className="w-4 h-4" />
                                                          Edit
                                                        </button>
                                                        <button
                                                          className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-gray-100 flex items-center gap-2"
                                                          onClick={(e) => {
                                                            e.stopPropagation();
                                                            deleteDocument(doc.id);
                                                            setOpenDropdown(null);
                                                          }}
                                                        >
                                                          <TrashIcon className="w-4 h-4" />
                                                          Delete
                                                        </button>
                                                      </div>
                                                    )}
                                                  </div>
                                                </div>
                                                
                                                <div className="flex items-center gap-3 mb-3">
                                                  <span className="text-sm font-medium text-gray-700">Status:</span>
                                                  <div className="relative">
                                                    <button
                                                      className={`badge badge-lg ${getStatusBadgeColor(doc.status)} cursor-pointer hover:opacity-80 transition-opacity`}
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        const newStatus = doc.status === 'received' ? 'missing' : 'received';
                                                        updateDocumentStatus(doc.id, newStatus);
                                                      }}
                                                      title="Click to change status"
                                                    >
                                                      {doc.status}
                                                    </button>
                                                  </div>
                                                </div>

                                                {/* Requested From and Received From Dropdowns */}
                                                <div className="flex items-center gap-3 mb-3">
                                                  <div className="flex items-center gap-2">
                                                    <span className="text-sm font-medium text-gray-700">Requested from:</span>
                                                    <select
                                                      className="select select-bordered select-sm bg-white border-gray-300 text-gray-700 focus:border-purple-500 focus:ring-purple-500"
                                                      value={doc.requested_from || ''}
                                                      onChange={(e) => {
                                                        e.stopPropagation();
                                                        updateDocumentRequestedFrom(doc.id, e.target.value);
                                                      }}
                                                      onClick={(e) => e.stopPropagation()}
                                                    >
                                                      <option value="">Select source...</option>
                                                      {sourceOptions.map((option) => (
                                                        <option key={option} value={option}>
                                                          {option}
                                                        </option>
                                                      ))}
                                                    </select>
                                                  </div>
                                                  {doc.requested_from && doc.requested_from_changed_at && (
                                                    <div className="flex items-center gap-1 text-xs text-gray-500">
                                                      <span>by {doc.requested_from_changed_by || 'Unknown'}</span>
                                                      <span>•</span>
                                                      <span>{new Date(doc.requested_from_changed_at).toLocaleDateString()}</span>
                                                    </div>
                                                  )}
                                                </div>

                                                <div className="flex items-center gap-3 mb-3">
                                                  <div className="flex items-center gap-2">
                                                    <span className="text-sm font-medium text-gray-700">Received from:</span>
                                                    <select
                                                      className="select select-bordered select-sm bg-white border-gray-300 text-gray-700 focus:border-purple-500 focus:ring-purple-500"
                                                      value={doc.received_from || ''}
                                                      onChange={(e) => {
                                                        e.stopPropagation();
                                                        updateDocumentReceivedFrom(doc.id, e.target.value);
                                                      }}
                                                      onClick={(e) => e.stopPropagation()}
                                                    >
                                                      <option value="">Select source...</option>
                                                      {sourceOptions.map((option) => (
                                                        <option key={option} value={option}>
                                                          {option}
                                                        </option>
                                                      ))}
                                                    </select>
                                                  </div>
                                                  {doc.received_from && doc.received_from_changed_at && (
                                                    <div className="flex items-center gap-1 text-xs text-gray-500">
                                                      <span>by {doc.received_from_changed_by || 'Unknown'}</span>
                                                      <span>•</span>
                                                      <span>{new Date(doc.received_from_changed_at).toLocaleDateString()}</span>
                                                    </div>
                                                  )}
                                                </div>
                                                
                                                <div className="border-b border-gray-200 mb-3"></div>
                                                
                                                {doc.notes && (
                                                  <div className="mt-3 p-3 bg-gray-50 rounded-lg">
                                                    <p className="text-sm text-gray-600">
                                                      <strong>Notes:</strong> {doc.notes}
                                                    </p>
                                                  </div>
                                                )}
                                              </div>
                                            ))
                                          )}
                                        </div>
                                      )}
                                      
                                      <div className="mt-4 pt-3 border-t border-gray-200">
                                        <button
                                          className="btn btn-primary w-full"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setSelectedLead(lead);
                                            setSelectedContact(contact);
                                            setShowAddDocModal(true);
                                          }}
                                        >
                                          <PlusIcon className="w-5 h-5" />
                                          Add New Document
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
  
                            {/* Back of Card - Only Required Documents (Mobile Only) */}
                            {isMobile && flippedCards.has(contact.id) && (
                              <div className="absolute inset-0 bg-white rounded-xl p-6 z-10">
                                <div className="flex items-center justify-between mb-4">
                                  <h3 className="text-xl font-bold text-gray-900">Required Documents</h3>
                                  <span className="text-sm text-gray-500">{contact.name}</span>
                                </div>
                                
                                <div className="space-y-3 max-h-[450px] overflow-y-auto">
                                  {contactDocuments.length === 0 ? (
                                    <div className="text-center py-16 px-8">
                                      <DocumentTextIcon className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                                      <p className="text-lg text-gray-500 mb-2">No documents required</p>
                                      <p className="text-sm text-gray-400">Use the button below to add your first document</p>
                                    </div>
                                  ) : (
                                    contactDocuments.map((doc) => (
                                      <div key={doc.id} className="bg-gray-50 rounded-lg p-4 border border-gray-100 hover:shadow-md transition-shadow">
                                        <div className="flex items-start justify-between mb-3">
                                          <div className="flex-1">
                                            <div className="flex items-center justify-between mb-2">
                                              <h4 className="text-lg font-bold text-gray-900">{doc.document_name}</h4>
                                              {doc.due_date && (
                                                <span className="text-sm text-gray-600">
                                                  <strong>Due:</strong> {doc.due_date ? new Date(doc.due_date).toLocaleDateString() : 'No due date'}
                                                </span>
                                              )}
                                            </div>
                                            <div className="flex items-center gap-3 mb-2">
                                              <span className="text-sm text-gray-600">Type: {doc.document_type}</span>
                                              <span className={`badge ${getStatusBadgeColor(doc.status)}`}>
                                                {doc.status}
                                              </span>
                                            </div>
                                            <div className="border-b border-gray-200 mb-3"></div>
                                          </div>
                                          <div className="relative dropdown-menu">
                                            <button
                                              className="btn btn-ghost btn-sm text-blue-600 hover:text-blue-700"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                toggleDropdown(doc.id);
                                              }}
                                              title="More options"
                                            >
                                              <EllipsisVerticalIcon className="w-7 h-7" />
                                            </button>
                                            
                                            {openDropdown === doc.id && (
                                              <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 min-w-[120px]">
                                                <button
                                                  className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    setEditingDocument(doc);
                                                    setOpenDropdown(null);
                                                  }}
                                                >
                                                  <PencilIcon className="w-4 h-4" />
                                                  Edit
                                                </button>
                                                <button
                                                  className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-gray-100 flex items-center gap-2"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    deleteDocument(doc.id);
                                                    setOpenDropdown(null);
                                                  }}
                                                >
                                                  <TrashIcon className="w-4 h-4" />
                                                  Delete
                                                </button>
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                        
                                        <div className="flex items-center gap-3 mb-3">
                                          <span className="text-sm font-medium text-gray-700">Status:</span>
                                          <select 
                                            className="select select-bordered select-sm flex-1"
                                            value={doc.status}
                                            onChange={(e) => {
                                              e.stopPropagation();
                                              updateDocumentStatus(doc.id, e.target.value);
                                            }}
                                          >
                                            <option value="missing">Missing</option>
                                            <option value="pending">Pending</option>
                                            <option value="received">Received</option>
                                            <option value="approved">Approved</option>
                                            <option value="rejected">Rejected</option>
                                          </select>
                                        </div>

                                        {/* Requested From and Received From Dropdowns - Mobile */}
                                        <div className="flex flex-col gap-2 mb-3">
                                          <div className="flex items-center gap-3">
                                            <span className="text-sm font-medium text-gray-700">Requested from:</span>
                                            <select
                                              className="select select-bordered select-sm flex-1"
                                              value={doc.requested_from || ''}
                                              onChange={(e) => {
                                                e.stopPropagation();
                                                updateDocumentRequestedFrom(doc.id, e.target.value);
                                              }}
                                            >
                                              <option value="">Select source...</option>
                                              {sourceOptions.map((option) => (
                                                <option key={option} value={option}>
                                                  {option}
                                                </option>
                                              ))}
                                            </select>
                                          </div>
                                          {doc.requested_from && doc.requested_from_changed_at && (
                                            <div className="flex items-center gap-1 text-xs text-gray-500 ml-4">
                                              <span>by {doc.requested_from_changed_by || 'Unknown'}</span>
                                              <span>•</span>
                                              <span>{new Date(doc.requested_from_changed_at).toLocaleDateString()}</span>
                                            </div>
                                          )}
                                        </div>

                                        <div className="flex flex-col gap-2 mb-3">
                                          <div className="flex items-center gap-3">
                                            <span className="text-sm font-medium text-gray-700">Received from:</span>
                                            <select
                                              className="select select-bordered select-sm flex-1"
                                              value={doc.received_from || ''}
                                              onChange={(e) => {
                                                e.stopPropagation();
                                                updateDocumentReceivedFrom(doc.id, e.target.value);
                                              }}
                                            >
                                              <option value="">Select source...</option>
                                              {sourceOptions.map((option) => (
                                                <option key={option} value={option}>
                                                  {option}
                                                </option>
                                              ))}
                                            </select>
                                          </div>
                                          {doc.received_from && doc.received_from_changed_at && (
                                            <div className="flex items-center gap-1 text-xs text-gray-500 ml-4">
                                              <span>by {doc.received_from_changed_by || 'Unknown'}</span>
                                              <span>•</span>
                                              <span>{new Date(doc.received_from_changed_at).toLocaleDateString()}</span>
                                            </div>
                                          )}
                                        </div>
                                        
                                        <div className="border-b border-gray-200 mb-3"></div>
                                        
                                        {doc.notes && (
                                          <div className="mt-3 p-3 bg-gray-50 rounded-lg">
                                            <p className="text-sm text-gray-600">
                                              <strong>Notes:</strong> {doc.notes}
                                            </p>
                                          </div>
                                        )}
                                      </div>
                                    ))
                                  )}
                                </div>
                                
                                <div className="mt-auto pt-4 border-t border-gray-200">
                                  <button
                                    className="btn btn-primary w-full"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedLead(lead);
                                      setSelectedContact(contact);
                                      setShowAddDocModal(true);
                                    }}
                                  >
                                    <PlusIcon className="w-5 h-5" />
                                    Add New Document
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          </div>
        )}
  
        {/* Add Document Modal */}
        {showAddDocModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/30">
            <div className="bg-white rounded-2xl p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold">Add Document Requirement</h3>
                <button 
                  onClick={() => {
                    setShowAddDocModal(false);
                    setSelectedLead(null);
                  setSelectedContact(null);
                  setNewDocument({
                    document_name: '',
                    document_type: 'identity',
                    due_date: '',
                    notes: '',
                    is_required: true
                  });
                  }}
                  className="btn btn-ghost btn-circle btn-sm"
                >
                  <XMarkIcon className="w-5 h-5" />
                </button>
              </div>
  
              <div className="space-y-4">
              {!selectedLead && leads.length > 1 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Lead *</label>
                    <select
                      className="select select-bordered w-full"
                      value={selectedLead ? (selectedLead as HandlerLead).id : ''}
                      onChange={(e) => {
                        const lead = leads.find((l: HandlerLead) => l.id === e.target.value);
                        setSelectedLead(lead || null);
                      setSelectedContact(null); // Reset contact when lead changes
                      }}
                    >
                      <option value="">Select a lead...</option>
                      {leads.map(lead => (
                        <option key={lead.id} value={lead.id}>
                          {lead.name} - #{lead.lead_number}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              {!selectedLead && leads.length === 1 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Lead *</label>
                  <input
                    type="text"
                    className="input input-bordered w-full"
                    value={`${leads[0].name} - #${leads[0].lead_number}`}
                    disabled
                  />
                </div>
              )}
  
                {selectedLead && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Applicant</label>
                    <select
                      className="select select-bordered w-full"
                      value={selectedContact?.id || ''}
                      onChange={(e) => {
                        const contact = contacts.find(c => c.id === e.target.value);
                        setSelectedContact(contact || null);
                      }}
                    >
                      <option value="">For all applicants</option>
                      {contacts.filter(c => c.lead_id === selectedLead.id).map(contact => (
                        <option key={contact.id} value={contact.id}>
                          {contact.name} ({contact.relationship?.replace('_', ' ')})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
  
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Document Name *</label>
                  <input
                    type="text"
                    className="input input-bordered w-full"
                    value={newDocument.document_name}
                    onChange={(e) => setNewDocument(prev => ({ ...prev, document_name: e.target.value }))}
                    placeholder="Enter document name..."
                  />
                </div>
  
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                  <select
                    className="select select-bordered w-full"
                    value={newDocument.document_type}
                    onChange={(e) => setNewDocument(prev => ({ ...prev, document_type: e.target.value }))}
                  >
                    <option value="identity">Identity</option>
                    <option value="civil_status">Civil Status</option>
                    <option value="legal">Legal</option>
                    <option value="financial">Financial</option>
                    <option value="professional">Professional</option>
                    <option value="health">Health</option>
                  </select>
                </div>
  
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
                  <input
                    type="date"
                    className="input input-bordered w-full"
                    value={newDocument.due_date}
                    onChange={(e) => setNewDocument(prev => ({ ...prev, due_date: e.target.value }))}
                  />
                </div>
  
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                  <textarea
                    className="textarea textarea-bordered w-full h-20 resize-none"
                    value={newDocument.notes}
                    onChange={(e) => setNewDocument(prev => ({ ...prev, notes: e.target.value }))}
                    placeholder="Instructions or notes for this document..."
                  />
                </div>
  
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-primary"
                    checked={newDocument.is_required}
                    onChange={(e) => setNewDocument(prev => ({ ...prev, is_required: e.target.checked }))}
                  />
                  <label className="text-sm font-medium text-gray-700">Required document</label>
                </div>
              </div>
  
              <div className="flex gap-3 mt-6">
                <button 
                  className="btn btn-outline flex-1"
                  onClick={() => {
                    setShowAddDocModal(false);
                    setSelectedLead(null);
                  setSelectedContact(null);
                  setNewDocument({
                    document_name: '',
                    document_type: 'identity',
                    due_date: '',
                    notes: '',
                    is_required: true
                  });
                  }}
                >
                  Cancel
                </button>
                <button 
                  className="btn btn-primary flex-1"
                  onClick={addRequiredDocument}
                >
                  Add Document
                </button>
              </div>
            </div>
          </div>
        )}
  
        {/* Edit Document Modal */}
        {editingDocument && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30">
            <div className="bg-white rounded-2xl p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold">Edit Document Requirement</h3>
                <button 
                  onClick={() => setEditingDocument(null)}
                  className="btn btn-ghost btn-circle btn-sm"
                >
                  <XMarkIcon className="w-5 h-5" />
                </button>
              </div>
  
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Document Name</label>
                  <input
                    type="text"
                    className="input input-bordered w-full"
                    value={editingDocument.document_name}
                    onChange={(e) => setEditingDocument(prev => prev ? ({ ...prev, document_name: e.target.value }) : null)}
                  />
                </div>
  
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                  <select
                    className="select select-bordered w-full"
                    value={editingDocument.document_type}
                    onChange={(e) => setEditingDocument(prev => prev ? ({ ...prev, document_type: e.target.value }) : null)}
                  >
                    <option value="identity">Identity</option>
                    <option value="civil_status">Civil Status</option>
                    <option value="legal">Legal</option>
                    <option value="financial">Financial</option>
                    <option value="professional">Professional</option>
                    <option value="health">Health</option>
                  </select>
                </div>
  
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
                  <input
                    type="date"
                    className="input input-bordered w-full"
                    value={editingDocument.due_date ? editingDocument.due_date.split('T')[0] : ''}
                    onChange={(e) => setEditingDocument(prev => prev ? ({ ...prev, due_date: e.target.value }) : null)}
                  />
                </div>
  
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                  <textarea
                    className="textarea textarea-bordered w-full h-20 resize-none"
                    value={editingDocument.notes || ''}
                    onChange={(e) => setEditingDocument(prev => prev ? ({ ...prev, notes: e.target.value }) : null)}
                  />
                </div>
  
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-primary"
                    checked={editingDocument.is_required}
                    onChange={(e) => setEditingDocument(prev => prev ? ({ ...prev, is_required: e.target.checked }) : null)}
                  />
                  <label className="text-sm font-medium text-gray-700">Required document</label>
                </div>
              </div>
  
              <div className="flex gap-3 mt-6">
                <button 
                  className="btn btn-outline flex-1"
                  onClick={() => setEditingDocument(null)}
                >
                  Cancel
                </button>
                <button 
                  className="btn btn-primary flex-1"
                  onClick={updateDocument}
                >
                  Update Document
                </button>
              </div>
            </div>
          </div>
        )}
  
        {/* Document Viewer Modal */}
        {showDocumentModal && selectedLeadForDocs && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
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

      {/* Upload Document Modal */}
      <UploadDocumentModal
        isOpen={showUploadModal}
        onClose={() => {
          setShowUploadModal(false);
          setSelectedContactForUpload(null);
          setSelectedLeadForUpload(null);
        }}
        contact={selectedContactForUpload}
        lead={selectedLeadForUpload as any}
        uploadFiles={uploadFiles as any}
        isUploading={isUploading && uploadingLeadId === selectedLeadForUpload?.id}
        onDocumentAdded={fetchRequiredDocuments}
        currentUser={currentUser}
      />

      {/* Document Request Details Modal */}
      {showRequestDetailsModal && selectedDocumentForDetails && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50" onClick={() => {
          setShowRequestDetailsModal(false);
          setSelectedDocumentForDetails(null);
        }}>
          <div className="bg-white rounded-2xl max-w-2xl w-full shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <h3 className="text-xl font-bold text-gray-900">Document Request Details</h3>
              <button
                onClick={() => {
                  setShowRequestDetailsModal(false);
                  setSelectedDocumentForDetails(null);
                }}
                className="btn btn-ghost btn-circle"
              >
                <XMarkIcon className="w-6 h-6" />
              </button>
      </div>

            <div className="p-6">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Document Name</label>
                  <div className="input input-bordered w-full bg-gray-50">
                    {selectedDocumentForDetails.document_name}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Document Type</label>
                  <div className="input input-bordered w-full bg-gray-50">
                    {selectedDocumentForDetails.document_type || 'N/A'}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Requested From</label>
                  <div className="input input-bordered w-full bg-gray-50">
                    {selectedDocumentForDetails.requested_from || 'Not specified'}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Requested By</label>
                  <div className="input input-bordered w-full bg-gray-50">
                    {selectedDocumentForDetails.requested_from_changed_by_user?.first_name ||
                      selectedDocumentForDetails.requested_from_changed_by_user?.full_name ||
                      selectedDocumentForDetails.requested_by_user?.first_name ||
                      selectedDocumentForDetails.requested_by_user?.full_name ||
                      selectedDocumentForDetails.requested_from_changed_by ||
                      selectedDocumentForDetails.requested_by ||
                      'Unknown'}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Request Date</label>
                  <div className="input input-bordered w-full bg-gray-50">
                    {selectedDocumentForDetails.requested_from_changed_at
                      ? new Date(selectedDocumentForDetails.requested_from_changed_at).toLocaleString()
                      : selectedDocumentForDetails.requested_date
                        ? new Date(selectedDocumentForDetails.requested_date).toLocaleString()
                        : 'Not specified'}
                  </div>
                </div>

                {selectedDocumentForDetails.due_date && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
                    <div className="input input-bordered w-full bg-gray-50">
                      {new Date(selectedDocumentForDetails.due_date).toLocaleDateString()}
                    </div>
                  </div>
                )}

                {selectedDocumentForDetails.status && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                    <div className="input input-bordered w-full bg-gray-50">
                      <span className={`badge ${selectedDocumentForDetails.status === 'received' ? 'badge-success' : selectedDocumentForDetails.status === 'missing' ? 'badge-error' : 'badge-warning'}`}>
                        {selectedDocumentForDetails.status}
                      </span>
                    </div>
                  </div>
                )}

                {selectedDocumentForDetails.notes && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                    <div className="textarea textarea-bordered w-full bg-gray-50 min-h-[100px]">
                      {selectedDocumentForDetails.notes}
                    </div>
                  </div>
                )}

                {selectedDocumentForDetails.received_from && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Received From</label>
                    <div className="input input-bordered w-full bg-gray-50">
                      {selectedDocumentForDetails.received_from}
                    </div>
                  </div>
                )}

                {selectedDocumentForDetails.received_date && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Received Date</label>
                    <div className="input input-bordered w-full bg-gray-50">
                      {new Date(selectedDocumentForDetails.received_date).toLocaleString()}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  className="btn btn-primary flex-1"
                  onClick={() => {
                    setShowRequestDetailsModal(false);
                    setSelectedDocumentForDetails(null);
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Request Document Modal */}
      {showRequestModal && selectedContactForRequest && selectedLeadForRequest && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50" onClick={() => {
          setShowRequestModal(false);
          setSelectedContactForRequest(null);
          setSelectedLeadForRequest(null);
          setSelectedDocumentNameForRequest('');
        }}>
          <div className="bg-white rounded-2xl max-w-md w-full shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <h3 className="text-xl font-bold text-gray-900">Request Document</h3>
              <button
                onClick={() => {
                  setShowRequestModal(false);
                  setSelectedContactForRequest(null);
                  setSelectedLeadForRequest(null);
                  setSelectedDocumentNameForRequest('');
                  setRequestedFromForRequest('');
                }}
                className="btn btn-ghost btn-circle"
              >
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>

            <div className="p-6">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Contact</label>
                  <input
                    type="text"
                    className="input input-bordered w-full"
                    value={selectedContactForRequest.name}
                    disabled
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Document Name</label>
                  {selectedDocumentNameForRequest ? (
                    <input
                      type="text"
                      className="input input-bordered w-full"
                      value={selectedDocumentNameForRequest}
                      disabled
                    />
                  ) : (
                    <select
                      className="select select-bordered w-full"
                      value={selectedDocumentNameForRequest}
                      onChange={(e) => setSelectedDocumentNameForRequest(e.target.value)}
                    >
                      <option value="">Select document...</option>
                      {['Birth Certificate', 'Marriage Certificate', 'Passport Copy', 'Police Certificate'].map((docName) => {
                        const existingDoc = requiredDocuments.find(
                          doc => doc.contact_id === selectedContactForRequest.id && doc.document_name === docName
                        );
                        if (existingDoc) return null;
                        return (
                          <option key={docName} value={docName}>
                            {docName}
                          </option>
                        );
                      })}
                    </select>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Requested From</label>
                  <select
                    className="select select-bordered w-full"
                    value={requestedFromForRequest}
                    onChange={(e) => setRequestedFromForRequest(e.target.value)}
                  >
                    <option value="">Select source...</option>
                    {sourceOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  className="btn btn-outline flex-1"
                  onClick={() => {
                    setShowRequestModal(false);
                    setSelectedContactForRequest(null);
                    setSelectedLeadForRequest(null);
                    setSelectedDocumentNameForRequest('');
                    setRequestedFromForRequest('');
                  }}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary flex-1"
                  onClick={() => {
                    if (!selectedDocumentNameForRequest) {
                      toast.error('Please select a document');
                      return;
                    }
                    if (!requestedFromForRequest) {
                      toast.error('Please select where the document is requested from');
                      return;
                    }

                    requestDocument(selectedContactForRequest, selectedLeadForRequest, selectedDocumentNameForRequest, requestedFromForRequest);
                  }}
                >
                  Request Document
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Document Edit Modal - Opens when clicking date stamp */}
      {showDocumentEditModal && selectedDocumentForEdit && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100]">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <h3 className="text-xl font-bold text-gray-900">Edit Document: {selectedDocumentForEdit.document_name}</h3>
              <button
                onClick={() => {
                  setShowDocumentEditModal(false);
                  setSelectedDocumentForEdit(null);
                }}
                className="btn btn-ghost btn-circle"
              >
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>

            <div className="p-6">
              <div className="space-y-4">
                {/* Status buttons */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
                  <div className="flex items-center gap-2">
                    <button
                      className={`btn flex-1 ${selectedDocumentForEdit.status === 'received' ? 'btn-success' : 'btn-outline'}`}
                      onClick={() => {
                        updateDocumentStatus(selectedDocumentForEdit.id, 'received');
                        setSelectedDocumentForEdit({ ...selectedDocumentForEdit, status: 'received' });
                      }}
                    >
                      ✓ Received
                    </button>
                    <button
                      className={`btn flex-1 ${selectedDocumentForEdit.status === 'missing' ? 'btn-error' : 'btn-outline'}`}
                      onClick={() => {
                        updateDocumentStatus(selectedDocumentForEdit.id, 'missing');
                        setSelectedDocumentForEdit({ ...selectedDocumentForEdit, status: 'missing' });
                      }}
                    >
                      ✗ Missing
                    </button>
                  </div>
                </div>

                {/* Due Date */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
                  <input
                    type="date"
                    className="input input-bordered w-full"
                    value={selectedDocumentForEdit.due_date ? new Date(selectedDocumentForEdit.due_date).toISOString().split('T')[0] : ''}
                    onChange={async (e) => {
                      const newDate = e.target.value ? new Date(e.target.value).toISOString() : null;
                      try {
                        const { error } = await supabase
                          .from('lead_required_documents')
                          .update({ due_date: newDate })
                          .eq('id', selectedDocumentForEdit.id);

                        if (error) {
                          toast.error('Error updating due date: ' + error.message);
                          console.error('Error updating due date:', error);
                        } else {
                          // Update local state
                          setSelectedDocumentForEdit({ ...selectedDocumentForEdit, due_date: newDate as any });
                          // Refresh documents to ensure consistency
                          await fetchRequiredDocuments();
                        }
                      } catch (err) {
                        toast.error('Failed to update due date');
                        console.error('Error updating due date:', err);
                      }
                    }}
                  />
                </div>

                {/* Requested From */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Requested From</label>
                  <select
                    className="select select-bordered w-full"
                    value={selectedDocumentForEdit.requested_from || ''}
                    onChange={(e) => {
                      updateDocumentRequestedFrom(selectedDocumentForEdit.id, e.target.value);
                      setSelectedDocumentForEdit({ ...selectedDocumentForEdit, requested_from: e.target.value });
                    }}
                  >
                    <option value="">Requested from...</option>
                    {sourceOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  className="btn btn-outline flex-1"
                  onClick={() => {
                    setShowDocumentEditModal(false);
                    setSelectedDocumentForEdit(null);
                    fetchRequiredDocuments();
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Remove Required Document Modal */}
      {showRemoveDocumentModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <h3 className="text-xl font-bold text-gray-900">Remove Required Document</h3>
              <button
                onClick={() => setShowRemoveDocumentModal(false)}
                className="btn btn-ghost btn-circle btn-sm"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6">
              {(() => {
                const customDocuments = getCustomDocumentNames();
                if (customDocuments.length === 0) {
                  return (
                    <div className="text-center py-8">
                      <p className="text-gray-500">No custom required documents to remove.</p>
                      <p className="text-sm text-gray-400 mt-2">Default documents cannot be removed.</p>
                    </div>
                  );
                }
                return (
                  <div className="space-y-3">
                    <p className="text-sm text-gray-600 mb-4">
                      Select a custom required document to remove. This will delete all instances of this document requirement for all contacts.
                    </p>
                    <div className="max-h-64 overflow-y-auto space-y-2">
                      {customDocuments.map((docName) => (
                        <button
                          key={docName}
                          className="w-full px-4 py-3 text-left border border-gray-200 rounded-lg hover:bg-red-50 hover:border-red-300 transition-colors flex items-center justify-between"
                          onClick={() => {
                            if (window.confirm(`Are you sure you want to remove "${docName}"? This will delete all instances of this document requirement.`)) {
                              deleteRequiredDocument(docName);
                            }
                          }}
                        >
                          <span className="font-medium text-gray-900">{docName}</span>
                          <TrashIcon className="w-5 h-5 text-red-600" />
                        </button>
                      ))}
                    </div>
                    <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                      <p className="text-xs text-yellow-800">
                        <strong>Note:</strong> Default documents (Birth Certificate, Marriage Certificate, Passport Copy, Police Certificate) cannot be removed.
                      </p>
                    </div>
                  </div>
                );
              })()}
            </div>
            <div className="flex justify-end gap-2 p-6 border-t border-gray-200">
              <button
                className="btn btn-outline"
                onClick={() => setShowRemoveDocumentModal(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Document Modal Side Drawer */}
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
  
export default DocumentsTab; 