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
  EllipsisVerticalIcon
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

interface RequiredDocument {
  id: string;
  lead_id: string;
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
    const [currentUser, setCurrentUser] = useState<{id: string, full_name: string} | null>(null);
    const [flippedCards, setFlippedCards] = useState<Set<string>>(new Set());
    
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
      };

      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [openDropdown]);

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
        // First fetch the documents
        const { data: documents, error: documentsError } = await supabase
          .from('lead_required_documents')
          .select('*')
          .in('lead_id', leads.length > 0 ? leads.map((lead: HandlerLead) => lead.id) : [])
          .order('created_at', { ascending: false });
        
        if (documentsError) {
          toast.error('Error fetching documents: ' + documentsError.message);
          return;
        }

        if (documents) {
          // Since we're now storing full names directly, we don't need to do user lookup
          setRequiredDocuments(documents);
        }
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
  
    // Fetch contacts for this Documents tab
    const fetchContacts = async () => {
      if (leads.length === 0) return;
      
      try {
        // Only fetch for new leads (legacy leads don't have contacts in the new system)
        const newLeads = leads.filter(lead => !lead.id.startsWith('legacy_'));
        
        if (newLeads.length === 0) {
          setContacts([]);
          return;
        }
        
        const { data, error } = await supabase
          .from('contacts')
          .select('*')
          .in('lead_id', newLeads.map(lead => lead.id))
          .order('is_main_applicant', { ascending: false })
          .order('created_at', { ascending: true });
        
        if (error) {
          console.error('Error fetching contacts:', error.message);
        } else if (data) {
          setContacts(data);
        }
      } catch (err) {
        console.error('Failed to fetch contacts:', err);
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
      fetchCurrentUser();
      if (leads.length > 0) {
        fetchRequiredDocuments();
        fetchDocumentTemplates();
        fetchContacts();
      }
    }, [leads]);
  
    // Add new required document
    const addRequiredDocument = async () => {
      if (!newDocument.document_name.trim() || !selectedLead) {
        toast.error('Document name and lead are required');
        return;
      }
  
      try {
        const documentData = {
          ...newDocument,
          lead_id: selectedLead.id,
          contact_id: selectedContact?.id || null,
          requested_by: 'current_user', // Replace with actual user
          due_date: newDocument.due_date || null
        };
  
        const { error } = await supabase
          .from('lead_required_documents')
          .insert(documentData);
        
        if (error) {
          toast.error('Error adding document: ' + error.message);
        } else {
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
          await fetchRequiredDocuments();
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
  
        // Use the stored procedure for tracking
        const { error } = await supabase.rpc('update_document_status_with_tracking', {
          p_document_id: documentId,
          p_new_status: status,
          p_changed_by: currentUser.id,
          p_change_reason: changeReason || null,
          p_notes: notes || null
        });
        
        if (error) {
          toast.error('Error updating document: ' + error.message);
        } else {
          toast.success(`Document status updated to ${status}`);
          await fetchRequiredDocuments();
        }
      } catch (err) {
        toast.error('Failed to update document');
        console.error('Error updating document status:', err);
      }
    };

    // Update document requested_from with tracking
    const updateDocumentRequestedFrom = async (documentId: string, requestedFrom: string) => {
      try {
        if (!currentUser) {
          toast.error('User not authenticated');
          return;
        }
  
        const { error } = await supabase.rpc('update_document_requested_from_with_name_tracking', {
          p_document_id: documentId,
          p_requested_from: requestedFrom,
          p_changed_by_name: currentUser.full_name
        });
        
        if (error) {
          toast.error('Error updating requested from: ' + error.message);
        } else {
          toast.success(`Requested from updated to ${requestedFrom}`);
          await fetchRequiredDocuments();
        }
      } catch (err) {
        toast.error('Failed to update requested from');
        console.error('Error updating requested from:', err);
      }
    };

    // Update document received_from with tracking
    const updateDocumentReceivedFrom = async (documentId: string, receivedFrom: string) => {
      try {
        if (!currentUser) {
          toast.error('User not authenticated');
          return;
        }
  
        const { error } = await supabase.rpc('update_document_received_from_with_name_tracking', {
          p_document_id: documentId,
          p_received_from: receivedFrom,
          p_changed_by_name: currentUser.full_name
        });
        
        if (error) {
          toast.error('Error updating received from: ' + error.message);
        } else {
          toast.success(`Received from updated to ${receivedFrom}`);
          await fetchRequiredDocuments();
        }
      } catch (err) {
        toast.error('Failed to update received from');
        console.error('Error updating received from:', err);
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
    const addTemplateDocument = async (leadId: string, template: DocumentTemplate) => {
      try {
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + template.typical_due_days);
  
        const documentData = {
          lead_id: leadId,
          document_name: template.name,
          document_type: template.category,
          due_date: dueDate.toISOString(),
          notes: template.instructions,
          requested_by: 'current_user'
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
      return requiredDocuments.filter(doc => doc.lead_id === leadId);
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
            <button 
              className="btn btn-primary gap-2 text-sm sm:text-base"
              onClick={() => setShowAddDocModal(true)}
            >
              <PlusIcon className="w-4 h-4" />
              Add Document Requirement
            </button>
          </div>
        </div>

        {/* Content Container with Background */}
        <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-3 sm:p-6">
          {leads.length === 0 ? (
            <div className="text-center py-16 px-8 text-gray-500">
              <DocumentTextIcon className="w-16 h-16 mx-auto mb-4 text-gray-300" />
              <p className="text-lg font-medium mb-1">No cases to manage documents</p>
            </div>
          ) : (
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
                            className={`relative bg-white rounded-xl shadow-lg border border-gray-200 transition-all duration-300 hover:shadow-xl cursor-pointer ${
                              dragOverContact === contact.id 
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
                                    style={{"--value": completionPercentage, "--size": "3rem"} as React.CSSProperties}
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
                                  <div className={`mb-3 sm:mb-4 p-2 sm:p-3 border-2 border-dashed rounded-lg text-center transition-all duration-300 cursor-pointer ${
                                    dragOverContact === contact.id 
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
        )}
  
        {/* Add Document Modal */}
        {showAddDocModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30">
            <div className="bg-white rounded-2xl p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold">Add Document Requirement</h3>
                <button 
                  onClick={() => {
                    setShowAddDocModal(false);
                    setSelectedLead(null);
                  }}
                  className="btn btn-ghost btn-circle btn-sm"
                >
                  <XMarkIcon className="w-5 h-5" />
                </button>
              </div>
  
              <div className="space-y-4">
                {!selectedLead && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Lead *</label>
                    <select
                      className="select select-bordered w-full"
                      value={selectedLead ? (selectedLead as HandlerLead).id : ''}
                      onChange={(e) => {
                        const lead = leads.find((l: HandlerLead) => l.id === e.target.value);
                        setSelectedLead(lead || null);
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
      </div>
        </div>
    );
  };
  
export default DocumentsTab; 