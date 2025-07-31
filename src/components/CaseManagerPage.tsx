import React, { useState, useEffect } from 'react';
import {
  UserIcon,
  HashtagIcon,
  EnvelopeIcon,
  PhoneIcon,
  DocumentTextIcon,
  ChevronDownIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ClockIcon,
  XCircleIcon,
  MagnifyingGlassIcon,
  FunnelIcon,
  PlusIcon,
  ChartBarIcon,
  CalendarIcon,
  BellIcon,
  ChatBubbleLeftRightIcon,
  PaperAirplaneIcon,
  ArrowPathIcon,
  InboxArrowDownIcon,
  FolderIcon,
  DocumentArrowUpIcon,
  EyeIcon,
  PencilIcon,
  TrashIcon,
  UserPlusIcon,
  ArrowLeftIcon,
  MapPinIcon,
  UserGroupIcon,
  CalendarDaysIcon,
  IdentificationIcon,
  HeartIcon,
  PaperClipIcon,
  CheckIcon,
  XMarkIcon,
  ChevronRightIcon,
  ChevronLeftIcon,
  ExclamationCircleIcon,
  DocumentIcon,
  ArrowTrendingUpIcon,
  Squares2X2Icon,
  ListBulletIcon,
  CurrencyDollarIcon,
} from '@heroicons/react/24/outline';
import Tree from 'react-d3-tree';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabase';
import DocumentModal from './DocumentModal';
import { toast } from 'react-hot-toast';

// Interfaces for real data
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

interface UploadedFile {
  name: string;
  status: 'uploading' | 'success' | 'error';
  progress?: number;
  error?: string;
}

interface HandlerTask {
  id: string;
  lead_id: string;
  title: string;
  description?: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  assigned_to?: string;
  created_by: string;
  due_date?: string;
  completed_at?: string;
  created_at: string;
  updated_at: string;
  tags?: string[];
  estimated_hours?: number;
  actual_hours?: number;
  lead?: {
    name: string;
    lead_number: string;
  };
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
  relationship: 'persecuted_person' | 'spouse' | 'child' | 'parent' | 'sibling' | 'grandchild' | 'grandparent' | 'great_grandchild' | 'great_grandparent' | 'grandson' | 'granddaughter' | 'great_grandson' | 'great_granddaughter' | 'nephew' | 'niece' | 'cousin' | 'uncle' | 'aunt' | 'in_law' | 'other';
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

interface DocumentStatusHistory {
  id: string;
  document_name: string;
  contact_name?: string;
  old_status?: string;
  new_status: string;
  changed_by_name: string;
  change_reason?: string;
  notes?: string;
  created_at: string;
}

// Tab component interfaces
interface HandlerTabProps {
  leads: HandlerLead[];
  uploadFiles: (lead: HandlerLead, files: File[]) => Promise<void>;
  uploadingLeadId: string | null;
  uploadedFiles: { [leadId: string]: UploadedFile[] };
  isUploading: boolean;
  handleFileInput: (lead: HandlerLead, e: React.ChangeEvent<HTMLInputElement>) => void;
  refreshLeads: () => Promise<void>;
}

interface TabItem {
  id: string;
  label: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  badge?: number;
}

const tabs: TabItem[] = [
  { id: 'cases', label: 'My Cases', icon: FolderIcon },
  { id: 'contacts', label: 'Applicants', icon: UserGroupIcon },
  { id: 'documents', label: 'Documents', icon: DocumentTextIcon },
  { id: 'tasks', label: 'Tasks', icon: ClockIcon },
  { id: 'finance', label: 'Finance', icon: ChartBarIcon },
  { id: 'status', label: 'Status', icon: CheckCircleIcon },
  { id: 'notes', label: 'Notes', icon: PencilIcon },
  { id: 'communications', label: 'Messages', icon: ChatBubbleLeftRightIcon },
] as const;

type TabId = typeof tabs[number]['id'];

// Dashboard Component
interface DashboardTabProps extends HandlerTabProps {
  onCaseSelect: (lead: HandlerLead) => void;
  showCaseCards: boolean;
  setShowCaseCards: (show: boolean) => void;
}

const DashboardTab: React.FC<DashboardTabProps> = ({ leads, refreshLeads, onCaseSelect, showCaseCards, setShowCaseCards }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [viewMode, setViewMode] = useState<'cards' | 'list'>('cards');

  // Filter leads based on search and date filters
  const filteredLeads = leads.filter(lead => {
    const matchesSearch = !searchTerm || 
      lead.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lead.lead_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lead.email?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const leadDate = new Date(lead.created_at);
    const fromDate = dateFrom ? new Date(dateFrom) : null;
    const toDate = dateTo ? new Date(dateTo) : null;
    
    const matchesDateRange = (!fromDate || leadDate >= fromDate) && 
                           (!toDate || leadDate <= toDate);
    
    return matchesSearch && matchesDateRange;
  });

  // Check if a case is new (assigned less than a week ago)
  const isNewCase = (lead: HandlerLead) => {
    const assignedDate = new Date(lead.created_at);
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    return assignedDate > oneWeekAgo;
  };

  // Get status color
  const getStatusColor = (stage: string) => {
    switch (stage) {
      case 'pending_review': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'documents_requested': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'documents_received': return 'bg-green-100 text-green-800 border-green-200';
      case 'under_review': return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'completed': return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      case 'on_hold': return 'bg-red-100 text-red-800 border-red-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  // Handle case click
  const handleCaseClick = (lead: HandlerLead) => {
    onCaseSelect(lead);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h3 className="text-2xl font-bold text-gray-900">Case Handler Dashboard</h3>
          <p className="text-gray-600">Manage and monitor all your assigned cases</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600"></span>
          <button
            className="btn btn-sm btn-outline"
            onClick={() => setViewMode(viewMode === 'cards' ? 'list' : 'cards')}
          >
            {viewMode === 'cards' ? (
              <>
                <ListBulletIcon className="w-4 h-4" />
                List
              </>
            ) : (
              <>
                <Squares2X2Icon className="w-4 h-4" />
                Cards
              </>
            )}
          </button>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-200">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Search Cases</label>
            <div className="relative">
              <MagnifyingGlassIcon className="w-5 h-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                className="input input-bordered w-full pl-10"
                placeholder="Search by name, lead #, or email..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">From Date</label>
            <input
              type="date"
              className="input input-bordered w-full"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">To Date</label>
            <input
              type="date"
              className="input input-bordered w-full"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
        </div>
        
        {(searchTerm || dateFrom || dateTo) && (
          <div className="mt-4 flex items-center gap-2">
            <button
              onClick={() => {
                setSearchTerm('');
                setDateFrom('');
                setDateTo('');
              }}
              className="btn btn-outline btn-sm"
            >
              Clear Filters
            </button>
            <span className="text-sm text-gray-600">
              Showing {filteredLeads.length} of {leads.length} cases
            </span>
          </div>
        )}
      </div>

      {/* Cases Grid/List - Show when showCaseCards is true OR when there are active search filters */}
      {(showCaseCards || searchTerm || dateFrom || dateTo) && (
        filteredLeads.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-2xl shadow-lg border border-gray-200">
            <FolderIcon className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <h4 className="text-lg font-medium text-gray-900 mb-2">No Cases Found</h4>
            <p className="text-gray-600">
              {leads.length === 0 ? 'No cases assigned to you yet.' : 'Try adjusting your search or date filters.'}
            </p>
          </div>
        ) : viewMode === 'cards' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredLeads.map((lead) => (
              <div
                key={lead.id}
                className="card bg-base-100 shadow-lg hover:shadow-2xl transition-all duration-300 ease-in-out transform hover:-translate-y-1 cursor-pointer group"
                onClick={() => handleCaseClick(lead)}
              >
                <div className="card-body p-5">
                  <div className="flex justify-between items-start mb-2">
                    <h2 className="card-title text-xl font-bold group-hover:text-primary transition-colors text-gray-700">
                      {lead.name}
                    </h2>
                    <div className="flex flex-col items-end gap-1">
                      {isNewCase(lead) && (
                        <span className="badge bg-gradient-to-r from-green-500 to-emerald-500 text-white border-none text-xs">
                          NEW
                        </span>
                      )}
                      <span className="badge bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none">
                        {(lead.handler_stage || lead.stage).replace(/_/g, ' ')}
                      </span>
                    </div>
                  </div>
                  
                  <p className="text-sm text-base-content/60 font-mono mb-4">#{lead.lead_number}</p>

                  <div className="divider my-0"></div>

                  <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-base mt-4">
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Manager</span>
                      <span className="font-medium text-base">{lead.manager || 'N/A'}</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Expert</span>
                      <span className="font-medium text-base">{lead.expert || 'N/A'}</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Closer</span>
                      <span className="font-medium text-base">{lead.closer || 'N/A'}</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Scheduler</span>
                      <span className="font-medium text-base">{lead.scheduler || 'N/A'}</span>
                    </div>
                  </div>
                  

                  <div className="divider my-0"></div>

                  <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-base mt-4">
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Date Assigned</span>
                      <span className="font-medium text-base">{new Date(lead.created_at).toLocaleDateString()}</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Category</span>
                      <span className="font-medium text-base">{lead.category || 'N/A'}</span>
                    </div>
                  </div>

                  {/* Contact Info - Removed email and phone */}

                  {/* Balance Info */}
                  {lead.balance && (
                    <div className="mt-4 pt-4 border-t border-base-200/50">
                      <div className="flex flex-col gap-1">
                        <span className="text-xs font-semibold text-base-content/50 uppercase tracking-wide">Balance</span>
                        <span className="text-lg font-bold text-purple-600">
                          {lead.balance_currency || '$'} {lead.balance}
                        </span>
                      </div>
                    </div>
                  )}


                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            {/* Table Header */}
            <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
              <div className="grid grid-cols-7 gap-4 text-sm font-semibold text-gray-700 uppercase tracking-wide">
                <div>Case Name</div>
                <div>Lead #</div>
                <div>Handler</div>
                <div>Expert</div>
                <div>Category</div>
                <div>Date Assigned</div>
                <div>Status</div>
              </div>
            </div>
            
            {/* Table Body */}
            <div className="divide-y divide-gray-200">
              {filteredLeads.map((lead) => (
                <div
                  key={lead.id}
                  className="px-6 py-4 hover:bg-gray-50 transition-colors duration-200 cursor-pointer"
                  onClick={() => handleCaseClick(lead)}
                >
                  <div className="grid grid-cols-7 gap-4 items-center">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">{lead.name}</span>
                      {isNewCase(lead) && (
                        <span className="badge bg-gradient-to-r from-green-500 to-emerald-500 text-white border-none text-xs">
                          NEW
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-gray-500 font-mono">#{lead.lead_number}</div>
                    <div className="text-sm text-gray-700">{lead.handler || 'N/A'}</div>
                    <div className="text-sm text-gray-700">{lead.expert || 'N/A'}</div>
                    <div className="text-sm text-gray-700">{lead.category || 'N/A'}</div>
                    <div className="text-sm text-gray-700">{new Date(lead.created_at).toLocaleDateString()}</div>
                    <div>
                      <span className="badge bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none text-xs">
                        {(lead.handler_stage || lead.stage).replace(/_/g, ' ')}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      )}
    </div>
  );
};

// Single Lead View Component (for when a case is clicked)
const SingleLeadView: React.FC<{ lead: HandlerLead; onBack: () => void }> = ({ lead, onBack }) => {
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');

  // Filter tabs to exclude dashboard
  const detailTabs = tabs.filter(tab => tab.id !== 'dashboard');

  const renderTabContent = () => {
    const singleLeadData = [lead];
    const mockRefresh = async () => {};
    const mockUpload = async () => {};
    const mockFileInput = () => {};

    const tabProps = {
      leads: singleLeadData,
      uploadFiles: mockUpload,
      uploadingLeadId: null,
      uploadedFiles: {},
      isUploading: false,
      handleFileInput: mockFileInput,
      refreshLeads: mockRefresh
    };

    switch (activeTab) {
      case 'cases':
        return <CasesTab {...tabProps} />;
      case 'contacts':
        return <ContactsTab {...tabProps} />;
      case 'documents':
        return <DocumentsTab {...tabProps} />;
      case 'tasks':
        return <TasksTab {...tabProps} />;
      case 'status':
        return <StatusTab {...tabProps} />;
      case 'notes':
        return <NotesTab {...tabProps} />;
      case 'communications':
        return <CommunicationsTab {...tabProps} />;
      default:
        return <div>Tab not found</div>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="bg-white rounded-2xl shadow-lg border border-gray-200">
        <div className="flex overflow-x-auto">
          {detailTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-6 py-4 text-sm font-medium transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
              {tab.badge && (
                <span className="badge badge-primary badge-sm">{tab.badge}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="min-h-[600px]">
        {renderTabContent()}
      </div>
    </div>
  );
};

// Cases Tab Component
const CasesTab: React.FC<HandlerTabProps> = ({ 
  leads, 
  uploadFiles, 
  uploadingLeadId, 
  uploadedFiles, 
  isUploading, 
  handleFileInput 
}) => {
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
      <h3 className="text-xl font-bold text-gray-900">Handler Assigned Cases ({leads.length})</h3>
      
      <div className="overflow-x-auto">
        <table className="table w-full">
          <thead>
            <tr className="bg-gray-50">
              <th className="text-left font-semibold text-gray-700">Lead #</th>
              <th className="text-left font-semibold text-gray-700">Client Name</th>
              <th className="text-left font-semibold text-gray-700">Category</th>
              <th className="text-left font-semibold text-gray-700">Handler</th>
              <th className="text-left font-semibold text-gray-700">Expert</th>
              <th className="text-left font-semibold text-gray-700">Created</th>
              <th className="text-left font-semibold text-gray-700">Documents</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => (
              <tr key={lead.id} className="hover:bg-gray-50 border-b border-gray-100">
                <td className="font-semibold text-blue-600">{lead.lead_number}</td>
                <td>
                  <div>
                    <div className="font-medium text-gray-900">{lead.name}</div>
                    {lead.email && (
                      <div className="text-sm text-gray-500">{lead.email}</div>
                    )}
                  </div>
                </td>
                <td>
                  <span className="badge bg-blue-100 text-blue-700 px-3 py-1 rounded-full">
                    {lead.category || 'N/A'}
                  </span>
                </td>
                <td className="text-gray-700">{lead.handler || 'Not assigned'}</td>
                <td className="text-gray-700">{lead.expert || 'Not assigned'}</td>
                <td className="text-gray-500 text-sm">
                  {new Date(lead.created_at).toLocaleDateString()}
                </td>
                <td>
                  <div className="flex flex-col gap-2">
                    {/* Upload Button */}
                    <label 
                      className={`btn btn-outline btn-sm flex gap-2 items-center cursor-pointer ${
                        isUploading && uploadingLeadId === lead.id ? 'btn-disabled' : ''
                      }`}
                      style={{ borderColor: '#3b28c7', color: '#3b28c7' }}
                    >
                      <DocumentArrowUpIcon className="w-4 h-4" />
                      {isUploading && uploadingLeadId === lead.id ? 'Uploading...' : 'Upload'}
                      <input 
                        type="file" 
                        className="hidden" 
                        multiple 
                        onChange={(e) => handleFileInput(lead, e)}
                        disabled={isUploading && uploadingLeadId === lead.id}
                      />
                    </label>
                    
                    {/* OneDrive Folder Link */}
                    {lead.onedrive_folder_link && (
                      <a 
                        href={lead.onedrive_folder_link} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="text-blue-600 hover:text-blue-800 underline text-xs flex items-center gap-1"
                      >
                        <FolderIcon className="w-4 h-4" /> 
                        View Folder
                      </a>
                    )}
                    
                    {/* Uploaded Files List */}
                    {uploadedFiles[lead.id] && uploadedFiles[lead.id].length > 0 && (
                      <div className="space-y-1 mt-2">
                        {uploadedFiles[lead.id].map((file, idx) => (
                          <div key={idx} className="flex items-center gap-2 text-xs bg-gray-50 rounded p-1">
                            <PaperClipIcon className="w-3 h-3 text-purple-600" />
                            <span className="truncate">{file.name}</span>
                            {file.status === 'uploading' && (
                              <span className="loading loading-spinner loading-xs text-purple-600"></span>
                            )}
                            {file.status === 'success' && (
                              <CheckCircleIcon className="w-3 h-3 text-green-500" />
                            )}
                            {file.status === 'error' && (
                              <XCircleIcon className="w-3 h-3 text-red-500" title={file.error} />
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// Contacts Tab Component with full CRUD functionality
const ContactsTab: React.FC<HandlerTabProps> = ({ leads, refreshLeads }) => {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddContactModal, setShowAddContactModal] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [selectedLead, setSelectedLead] = useState<HandlerLead | null>(null);

  // New contact form state
  const [newContact, setNewContact] = useState({
    name: '',
    email: '',
    phone: '',
    relationship: 'other' as Contact['relationship'],
    birth_date: '',
    birth_place: '',
    current_address: '',
    citizenship: '',
    passport_number: '',
    id_number: '',
    is_persecuted: false,
    contact_notes: ''
  });

  // Fetch contacts from database
  const fetchContacts = async () => {
    if (leads.length === 0) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('contacts')
        .select('*')
        .in('lead_id', leads.length > 0 ? leads.map((lead: HandlerLead) => lead.id) : [])
        .order('is_main_applicant', { ascending: false })
        .order('created_at', { ascending: true });
      
      if (error) {
        toast.error('Error fetching contacts: ' + error.message);
      } else if (data) {
        // Calculate document completion for each contact
        const contactsWithStats = await Promise.all(
          data.map(async (contact) => {
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
              completion_percentage: completionPercentage
            };
          })
        );
        
        setContacts(contactsWithStats);
      }
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
    if (!newContact.name.trim() || !selectedLead) {
      toast.error('Contact name and lead are required');
      return;
    }

    try {
      const contactData = {
        ...newContact,
        lead_id: selectedLead.id,
        is_main_applicant: newContact.relationship === 'persecuted_person'
      };

      const { data: insertedContact, error } = await supabase
        .from('contacts')
        .insert(contactData)
        .select()
        .single();
      
      if (error) {
        toast.error('Error adding contact: ' + error.message);
      } else {
        toast.success('Contact added successfully');
        
        // Create default documents for this contact
        if (insertedContact) {
          await supabase.rpc('create_default_documents_for_contact', {
            p_lead_id: selectedLead.id,
            p_contact_id: insertedContact.id,
            p_relationship: newContact.relationship
          });
        }
        
        setShowAddContactModal(false);
        setNewContact({
          name: '',
          email: '',
          phone: '',
          relationship: 'other',
          birth_date: '',
          birth_place: '',
          current_address: '',
          citizenship: '',
          passport_number: '',
          id_number: '',
          is_persecuted: false,
          contact_notes: ''
        });
        setSelectedLead(null);
        await fetchContacts();
      }
    } catch (err) {
      toast.error('Failed to add contact');
      console.error('Error adding contact:', err);
    }
  };

  // Update contact
  const updateContact = async () => {
    if (!editingContact) return;

    try {
      const { error } = await supabase
        .from('contacts')
        .update({
          name: editingContact.name,
          email: editingContact.email,
          phone: editingContact.phone,
          relationship: editingContact.relationship,
          birth_date: editingContact.birth_date,
          birth_place: editingContact.birth_place,
          current_address: editingContact.current_address,
          citizenship: editingContact.citizenship,
          passport_number: editingContact.passport_number,
          id_number: editingContact.id_number,
          is_persecuted: editingContact.is_persecuted,
          contact_notes: editingContact.contact_notes,
          is_main_applicant: editingContact.relationship === 'persecuted_person'
        })
        .eq('id', editingContact.id);
      
      if (error) {
        toast.error('Error updating contact: ' + error.message);
      } else {
        toast.success('Contact updated successfully');
        setEditingContact(null);
        await fetchContacts();
      }
    } catch (err) {
      toast.error('Failed to update contact');
    }
  };

  // Delete contact
  const deleteContact = async (contactId: string) => {
    if (!confirm('Are you sure you want to delete this contact? This will also delete all associated documents and history.')) return;

    try {
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
    } catch (err) {
      toast.error('Failed to delete contact');
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
    if (percentage >= 90) return 'text-green-600 bg-green-100';
    if (percentage >= 70) return 'text-blue-600 bg-blue-100';
    if (percentage >= 50) return 'text-yellow-600 bg-yellow-100';
    return 'text-red-600 bg-red-100';
  };

  // Group contacts by lead
  const contactsByLead = contacts.reduce((acc, contact) => {
    if (!acc[contact.lead_id]) {
      acc[contact.lead_id] = [];
    }
    acc[contact.lead_id].push(contact);
    return acc;
  }, {} as Record<string, Contact[]>);

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="loading loading-spinner loading-lg text-blue-600 mb-4"></div>
        <p className="text-lg text-gray-600">Loading contacts...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
        {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold text-gray-900">Applicants & Family Management</h3>
          <p className="text-gray-600">Manage persecuted persons and their family members for all cases</p>
        </div>
        <button 
          className="btn btn-primary gap-2"
          onClick={() => setShowAddContactModal(true)}
        >
          <UserPlusIcon className="w-4 h-4" />
          Add Applicant
        </button>
        </div>

      {leads.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <UserGroupIcon className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <p className="text-lg font-medium mb-1">No cases to manage contacts</p>
        </div>
      ) : (
        <div className="space-y-8">
          {leads.map((lead) => {
            const leadContacts = contactsByLead[lead.id] || [];
            
            return (
              <div key={lead.id} className="bg-white rounded-2xl p-6 shadow-lg border border-gray-200">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h4 className="text-lg font-bold text-gray-900">{lead.name}</h4>
                    <p className="text-blue-600 font-medium">Lead #{lead.lead_number}</p>
                    <p className="text-sm text-gray-500">{leadContacts.length} family member(s)</p>
                  </div>
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={() => {
                      setSelectedLead(lead);
                      setShowAddContactModal(true);
                    }}
                  >
                    <UserPlusIcon className="w-4 h-4" />
                    Add Family Member
                  </button>
                </div>

                {/* Contacts Grid */}
                {leadContacts.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <UserGroupIcon className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                    <p className="text-sm">No family members added yet</p>
                    <p className="text-xs text-gray-400">Click "Add Family Member" to get started</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {leadContacts.map((contact) => (
                      <div key={contact.id} className="card bg-base-100 shadow-lg hover:shadow-2xl transition-all duration-300 ease-in-out transform hover:-translate-y-1 group">
                        <div className="card-body p-5">
                          <div className="flex justify-between items-start mb-2">
                            <h2 className="card-title text-xl font-bold group-hover:text-primary transition-colors">
                              {contact.name}
                            </h2>
                            <div className="flex gap-2">
                              <button 
                                className="btn btn-ghost text-purple-600 hover:bg-purple-600 hover:text-white"
                                onClick={() => setEditingContact(contact)}
                              >
                                <PencilIcon className="w-5 h-5" />
                              </button>
                              <button 
                                className="btn btn-ghost text-purple-600 hover:bg-purple-600 hover:text-white"
                                onClick={() => deleteContact(contact.id)}
                              >
                                <TrashIcon className="w-5 h-5" />
                              </button>
                            </div>
                          </div>
                          
                          <div className="flex flex-wrap gap-1 mb-4">
                            <span className="badge bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none">
                              {contact.relationship.replace('_', ' ')}
                            </span>
                            {contact.is_main_applicant && (
                              <span className="badge bg-gradient-to-r from-blue-500 to-blue-600 text-white border-none">
                                Main
                              </span>
                            )}
                            {contact.is_persecuted && (
                              <span className="badge bg-gradient-to-r from-red-500 to-red-600 text-white border-none">
                                Persecuted
                              </span>
                            )}
                          </div>

                          <div className="divider my-0"></div>

                          {/* Contact Info Grid */}
                          <div className="grid grid-cols-2 gap-x-4 gap-y-3 mt-4">
                            {contact.email && (
                              <div className="flex flex-col gap-1">
                                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Email</span>
                                <span className="text-sm font-medium truncate" title={contact.email}>
                                  {contact.email}
                                </span>
                              </div>
                            )}
                            {contact.phone && (
                              <div className="flex flex-col gap-1">
                                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Phone</span>
                                <span className="text-sm font-medium">{contact.phone}</span>
                              </div>
                            )}
                            {contact.birth_date && (
                              <div className="flex flex-col gap-1">
                                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Birth Date</span>
                                <span className="text-sm font-medium">{new Date(contact.birth_date).toLocaleDateString()}</span>
                              </div>
                            )}
                            {contact.citizenship && (
                              <div className="flex flex-col gap-1">
                                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Citizenship</span>
                                <span className="text-sm font-medium">{contact.citizenship}</span>
                              </div>
                            )}
                            {contact.birth_place && (
                              <div className="flex flex-col gap-1">
                                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Birth Place</span>
                                <span className="text-sm font-medium">{contact.birth_place}</span>
                              </div>
                            )}
                            {contact.current_address && (
                              <div className="flex flex-col gap-1">
                                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Address</span>
                                <span className="text-sm font-medium">{contact.current_address}</span>
                              </div>
                            )}
                            {contact.passport_number && (
                              <div className="flex flex-col gap-1">
                                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Passport</span>
                                <span className="text-sm font-medium">{contact.passport_number}</span>
                              </div>
                            )}
                            {contact.id_number && (
                              <div className="flex flex-col gap-1">
                                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">ID Number</span>
                                <span className="text-sm font-medium">{contact.id_number}</span>
                              </div>
                            )}
                          </div>

                          {/* Document Status */}
                          <div className="mt-4 pt-4 border-t border-base-200/50">
                            <div className="flex flex-col gap-2">
                              <div className="flex justify-between items-center">
                                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Documents</span>
                                <span className="text-sm font-bold">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30">
          <div className="bg-white rounded-2xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold">Add Applicant</h3>
              <button 
                onClick={() => {
                  setShowAddContactModal(false);
                  setSelectedLead(null);
                }}
                className="btn btn-ghost btn-circle btn-sm"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {!selectedLead && (
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Case *</label>
                  <select
                    className="select select-bordered w-full"
                    value={selectedLead ? (selectedLead as HandlerLead).id : ''}
                    onChange={(e) => {
                      const lead = leads.find((l: HandlerLead) => l.id === e.target.value);
                      setSelectedLead(lead || null);
                    }}
                  >
                    <option value="">Select a case...</option>
                    {leads.map(lead => (
                      <option key={lead.id} value={lead.id}>
                        {lead.name} - #{lead.lead_number}
                      </option>
                    ))}
                  </select>
                </div>
              )}

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
                <label className="block text-sm font-medium text-gray-700 mb-1">Birth Date</label>
                <input
                  type="date"
                  className="input input-bordered w-full"
                  value={newContact.birth_date}
                  onChange={(e) => setNewContact(prev => ({ ...prev, birth_date: e.target.value }))}
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

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Current Address</label>
                <textarea
                  className="textarea textarea-bordered w-full h-20 resize-none"
                  value={newContact.current_address}
                  onChange={(e) => setNewContact(prev => ({ ...prev, current_address: e.target.value }))}
                  placeholder="Current address..."
                />
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
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  className="textarea textarea-bordered w-full h-20 resize-none"
                  value={newContact.contact_notes}
                  onChange={(e) => setNewContact(prev => ({ ...prev, contact_notes: e.target.value }))}
                  placeholder="Additional notes about this family member..."
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button 
                className="btn btn-outline flex-1"
                onClick={() => {
                  setShowAddContactModal(false);
                  setSelectedLead(null);
                }}
              >
                Cancel
              </button>
              <button 
                className="btn btn-primary flex-1"
                onClick={addContact}
              >
                Add Family Member
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Contact Modal */}
      {editingContact && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30">
          <div className="bg-white rounded-2xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold">Edit Family Member</h3>
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
                  value={editingContact.relationship}
                  onChange={(e) => setEditingContact(prev => prev ? ({ ...prev, relationship: e.target.value as Contact['relationship'] }) : null)}
                >
                  <option value="main_applicant">Main Applicant</option>
                  <option value="spouse">Spouse</option>
                  <option value="child">Child</option>
                  <option value="parent">Parent</option>
                  <option value="sibling">Sibling</option>
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
                <label className="block text-sm font-medium text-gray-700 mb-1">Birth Date</label>
                <input
                  type="date"
                  className="input input-bordered w-full"
                  value={editingContact.birth_date ? editingContact.birth_date.split('T')[0] : ''}
                  onChange={(e) => setEditingContact(prev => prev ? ({ ...prev, birth_date: e.target.value }) : null)}
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
                    checked={editingContact.is_persecuted}
                    onChange={(e) => setEditingContact(prev => prev ? ({ ...prev, is_persecuted: e.target.checked }) : null)}
                  />
                  <label className="text-sm font-medium text-gray-700">Subject to persecution</label>
                </div>
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  className="textarea textarea-bordered w-full h-20 resize-none"
                  value={editingContact.contact_notes || ''}
                  onChange={(e) => setEditingContact(prev => prev ? ({ ...prev, contact_notes: e.target.value }) : null)}
                />
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
                Update Family Member
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};


// Tasks Tab Component with full CRUD functionality
const TasksTab: React.FC<HandlerTabProps> = ({ leads, refreshLeads }) => {
  const [tasks, setTasks] = useState<HandlerTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingTask, setEditingTask] = useState<HandlerTask | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');

  // New task form state
  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    priority: 'medium' as const,
    lead_id: '',
    due_date: '',
    estimated_hours: '',
    tags: ''
  });

  // Fetch tasks from database
  const fetchTasks = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('handler_tasks')
        .select(`
          *,
          lead:leads(name, lead_number)
        `)
        .order('created_at', { ascending: false });
      
      if (error) {
        toast.error('Error fetching tasks: ' + error.message);
      } else if (data) {
        setTasks(data);
      }
    } catch (err) {
      toast.error('Failed to fetch tasks');
      console.error('Error fetching tasks:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  // Create new task
  const createTask = async () => {
    if (!newTask.title.trim() || !newTask.lead_id) {
      toast.error('Title and Lead are required');
      return;
    }

    try {
      const taskData = {
        ...newTask,
        created_by: 'current_user', // Replace with actual user
        assigned_to: 'current_user', // Replace with actual user
        tags: newTask.tags ? newTask.tags.split(',').map(t => t.trim()) : [],
        estimated_hours: newTask.estimated_hours ? parseInt(newTask.estimated_hours) : null,
        due_date: newTask.due_date || null
      };

      const { error } = await supabase
        .from('handler_tasks')
        .insert(taskData);
      
      if (error) {
        toast.error('Error creating task: ' + error.message);
      } else {
        toast.success('Task created successfully');
        setShowCreateModal(false);
        setNewTask({
          title: '',
          description: '',
          priority: 'medium',
          lead_id: '',
          due_date: '',
          estimated_hours: '',
          tags: ''
        });
        await fetchTasks();
      }
    } catch (err) {
      toast.error('Failed to create task');
      console.error('Error creating task:', err);
    }
  };

  // Update task status
  const updateTaskStatus = async (taskId: string, status: string) => {
    try {
      const updateData: any = { status };
      if (status === 'completed') {
        updateData.completed_at = new Date().toISOString();
      }

      const { error } = await supabase
        .from('handler_tasks')
        .update(updateData)
        .eq('id', taskId);
      
      if (error) {
        toast.error('Error updating task: ' + error.message);
      } else {
        toast.success('Task updated successfully');
        await fetchTasks();
      }
    } catch (err) {
      toast.error('Failed to update task');
    }
  };

  // Update task
  const updateTask = async () => {
    if (!editingTask) return;

    try {
      const { error } = await supabase
        .from('handler_tasks')
        .update({
          title: editingTask.title,
          description: editingTask.description,
          priority: editingTask.priority,
          due_date: editingTask.due_date,
          estimated_hours: editingTask.estimated_hours
        })
        .eq('id', editingTask.id);
      
      if (error) {
        toast.error('Error updating task: ' + error.message);
      } else {
        toast.success('Task updated successfully');
        setEditingTask(null);
        await fetchTasks();
      }
    } catch (err) {
      toast.error('Failed to update task');
    }
  };

  // Delete task
  const deleteTask = async (taskId: string) => {
    if (!confirm('Are you sure you want to delete this task?')) return;

    try {
      const { error } = await supabase
        .from('handler_tasks')
        .delete()
        .eq('id', taskId);
      
      if (error) {
        toast.error('Error deleting task: ' + error.message);
      } else {
        toast.success('Task deleted successfully');
        await fetchTasks();
      }
    } catch (err) {
      toast.error('Failed to delete task');
    }
  };

  // Filter tasks
  const filteredTasks = tasks.filter(task => {
    const matchesStatus = filterStatus === 'all' || task.status === filterStatus;
    const matchesPriority = filterPriority === 'all' || task.priority === filterPriority;
    const matchesSearch = task.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         task.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         task.lead?.name.toLowerCase().includes(searchTerm.toLowerCase());
    
    return matchesStatus && matchesPriority && matchesSearch;
  });

  // Get priority badge color
  const getPriorityBadgeColor = (priority: string) => {
    switch (priority) {
      case 'low': return 'badge-neutral';
      case 'medium': return 'badge-warning';
      case 'high': return 'badge-error';
      case 'urgent': return 'badge-error badge-outline';
      default: return 'badge-neutral';
    }
  };

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="loading loading-spinner loading-lg text-blue-600 mb-4"></div>
        <p className="text-lg text-gray-600">Loading tasks...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with filters and create button */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold text-gray-900">Task Management</h3>
          <p className="text-gray-600">Manage tasks for all handler-assigned cases</p>
        </div>
        <button 
          className="btn btn-primary gap-2"
          onClick={() => setShowCreateModal(true)}
        >
          <PlusIcon className="w-4 h-4" />
          Create Task
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-4 p-4 bg-gray-50 rounded-lg">
        <div className="relative flex-1">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search tasks..."
            className="input input-bordered w-full pl-10"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <select 
          className="select select-bordered"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        >
          <option value="all">All Status</option>
          <option value="pending">Pending</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select 
          className="select select-bordered"
          value={filterPriority}
          onChange={(e) => setFilterPriority(e.target.value)}
        >
          <option value="all">All Priority</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </select>
      </div>

      {/* Tasks Grid */}
      {filteredTasks.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <ClockIcon className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <p className="text-lg font-medium mb-1">No tasks found</p>
          <p className="text-base">Create your first task to get started</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredTasks.map((task) => (
            <div key={task.id} className="card bg-base-100 shadow-lg hover:shadow-2xl transition-all duration-300 ease-in-out transform hover:-translate-y-1 group">
              <div className="card-body p-5">
                {/* Top Row: Status and Priority */}
                <div className="flex justify-between items-start mb-4">
                  <div className="flex gap-2">
                    <span className={`badge bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none`}>
                      {task.status.replace('_', ' ')}
                    </span>
                    <span className={`badge border-none text-white ${getPriorityBadgeColor(task.priority)}`}>
                      {task.priority}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button 
                      className="btn btn-ghost text-purple-600 hover:bg-purple-600 hover:text-white"
                      onClick={() => setEditingTask(task)}
                    >
                      <PencilIcon className="w-5 h-5" />
                    </button>
                    <button 
                      className="btn btn-ghost text-purple-600 hover:bg-purple-600 hover:text-white"
                      onClick={() => deleteTask(task.id)}
                    >
                      <TrashIcon className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                {/* Title */}
                <h2 className="card-title text-xl font-bold group-hover:text-purple-600 transition-colors mb-3">
                  {task.title}
                </h2>

                {/* Due Date */}
                {task.due_date && (
                  <div className="mb-4">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Due Date</span>
                    <p className="text-sm font-medium">{task.due_date ? new Date(task.due_date).toLocaleDateString() : 'No due date'}</p>
                  </div>
                )}

                {/* Description in Gray Box */}
                {task.description && (
                  <div className="bg-gray-100 rounded-lg p-3 mb-4">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 block">Description</span>
                    <p className="text-sm text-gray-700 line-clamp-3">{task.description}</p>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="mt-auto pt-4 border-t border-base-200/50">
                  <div className="flex gap-2">
                    {task.status !== 'completed' && (
                      <>
                        {task.status === 'pending' && (
                          <button 
                            className="btn btn-sm btn-info flex-1"
                            onClick={() => updateTaskStatus(task.id, 'in_progress')}
                          >
                            Start
                          </button>
                        )}
                        {task.status === 'in_progress' && (
                          <button 
                            className="btn btn-sm bg-purple-600 hover:bg-purple-700 text-white border-none flex-1"
                            onClick={() => updateTaskStatus(task.id, 'completed')}
                          >
                            Complete
                          </button>
                        )}
                      </>
                    )}
                    {task.status === 'completed' && (
                      <button 
                        className="btn btn-sm btn-outline flex-1"
                        onClick={() => updateTaskStatus(task.id, 'in_progress')}
                      >
                        Reopen
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Task Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold">Create New Task</h3>
              <button 
                onClick={() => setShowCreateModal(false)}
                className="btn btn-ghost btn-circle btn-sm"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={newTask.title}
                  onChange={(e) => setNewTask(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="Enter task title..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Lead *</label>
                <select
                  className="select select-bordered w-full"
                  value={newTask.lead_id}
                  onChange={(e) => setNewTask(prev => ({ ...prev, lead_id: e.target.value }))}
                >
                  <option value="">Select a lead...</option>
                  {leads.map(lead => (
                    <option key={lead.id} value={lead.id}>
                      {lead.name} - #{lead.lead_number}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  className="textarea textarea-bordered w-full h-24 resize-none"
                  value={newTask.description}
                  onChange={(e) => setNewTask(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Enter task description..."
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                  <select
                    className="select select-bordered w-full"
                    value={newTask.priority}
                    onChange={(e) => setNewTask(prev => ({ ...prev, priority: e.target.value as any }))}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Est. Hours</label>
                  <input
                    type="number"
                    className="input input-bordered w-full"
                    value={newTask.estimated_hours}
                    onChange={(e) => setNewTask(prev => ({ ...prev, estimated_hours: e.target.value }))}
                    placeholder="0"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
                <input
                  type="date"
                  className="input input-bordered w-full"
                  value={newTask.due_date}
                  onChange={(e) => setNewTask(prev => ({ ...prev, due_date: e.target.value }))}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tags</label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={newTask.tags}
                  onChange={(e) => setNewTask(prev => ({ ...prev, tags: e.target.value }))}
                  placeholder="documents, urgent, review (comma separated)"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button 
                className="btn btn-outline flex-1"
                onClick={() => setShowCreateModal(false)}
              >
                Cancel
              </button>
              <button 
                className="btn btn-primary flex-1"
                onClick={createTask}
              >
                Create Task
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Task Modal */}
      {editingTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold">Edit Task</h3>
              <button 
                onClick={() => setEditingTask(null)}
                className="btn btn-ghost btn-circle btn-sm"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={editingTask.title}
                  onChange={(e) => setEditingTask(prev => prev ? ({ ...prev, title: e.target.value }) : null)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  className="textarea textarea-bordered w-full h-24 resize-none"
                  value={editingTask.description || ''}
                  onChange={(e) => setEditingTask(prev => prev ? ({ ...prev, description: e.target.value }) : null)}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                  <select
                    className="select select-bordered w-full"
                    value={editingTask.priority}
                    onChange={(e) => setEditingTask(prev => prev ? ({ ...prev, priority: e.target.value as any }) : null)}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Est. Hours</label>
                  <input
                    type="number"
                    className="input input-bordered w-full"
                    value={editingTask.estimated_hours || ''}
                    onChange={(e) => setEditingTask(prev => prev ? ({ ...prev, estimated_hours: parseInt(e.target.value) || undefined }) : null)}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
                <input
                  type="date"
                  className="input input-bordered w-full"
                  value={editingTask.due_date ? editingTask.due_date.split('T')[0] : ''}
                  onChange={(e) => setEditingTask(prev => prev ? ({ ...prev, due_date: e.target.value }) : null)}
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button 
                className="btn btn-outline flex-1"
                onClick={() => setEditingTask(null)}
              >
                Cancel
              </button>
              <button 
                className="btn btn-primary flex-1"
                onClick={updateTask}
              >
                Update Task
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Status Tab Component
const StatusTab: React.FC<HandlerTabProps> = ({ leads, refreshLeads }) => {
  const [updating, setUpdating] = useState<string | null>(null);
  const [documentHistory, setDocumentHistory] = useState<DocumentStatusHistory[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Fetch document status history for all leads
  const fetchDocumentHistory = async () => {
    if (leads.length === 0) return;
    
    setLoadingHistory(true);
    try {
      const allHistory: DocumentStatusHistory[] = [];
      
      for (const lead of leads) {
        const { data, error } = await supabase.rpc('get_document_status_history', {
          p_lead_id: lead.id
        });
        
        if (error) {
          console.error('Error fetching document history for lead:', lead.id, error);
        } else if (data) {
          allHistory.push(...data);
        }
      }
      
      // Sort by created_at descending
      allHistory.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setDocumentHistory(allHistory);
    } catch (err) {
      console.error('Failed to fetch document history:', err);
    } finally {
      setLoadingHistory(false);
    }
  };

  React.useEffect(() => {
    fetchDocumentHistory();
  }, [leads]);

  const updateLeadHandlerStage = async (leadId: string, newHandlerStage: string) => {
    setUpdating(leadId);
    try {
      const { error } = await supabase
        .from('leads')
        .update({ handler_stage: newHandlerStage })
        .eq('id', leadId);
      
      if (error) {
        toast.error('Error updating handler stage: ' + error.message);
      } else {
        toast.success('Handler stage updated successfully');
        await refreshLeads();
      }
    } catch (err) {
      toast.error('Failed to update handler stage');
    } finally {
      setUpdating(null);
    }
  };

  const handlerStageOptions = [
    'pending_payment',
    'documents_requested',
    'documents_pending',
    'all_documents_received',
    'application_form_processing',
    'application_submitted',
    'application_approved',
    'application_rejected',
  ];

  return (
    <div className="space-y-6">
      <h3 className="text-xl font-bold text-gray-900">Case Status Management</h3>
      
      {leads.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <CheckCircleIcon className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <p className="text-lg font-medium mb-1">No cases to manage</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {leads.map((lead) => (
            <div key={lead.id} className="bg-white rounded-2xl p-6 shadow-lg border border-gray-200">
            <div className="flex items-center justify-between">
                <div className="flex-1">
                  <h4 className="text-lg font-bold text-gray-900">{lead.name}</h4>
                  <p className="text-blue-600 font-medium">Lead #{lead.lead_number}</p>
                  <p className="text-gray-600 text-sm">Category: {lead.category || 'N/A'}</p>
                </div>
                
                <div className="flex items-center gap-4">
              <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Handler Stage</label>
                    <select 
                      className="select select-bordered"
                      value={lead.handler_stage || 'pending_review'}
                      onChange={(e) => updateLeadHandlerStage(lead.id, e.target.value)}
                      disabled={updating === lead.id}
                    >
                      {handlerStageOptions.map((stage: string) => (
                        <option key={stage} value={stage}>
                          {stage.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())}
                        </option>
                      ))}
                    </select>
              </div>
                  
                  <div className="text-center">
                    <div className="text-sm text-gray-600">Created</div>
                    <div className="text-sm font-medium">
                      {new Date(lead.created_at).toLocaleDateString()}
            </div>
          </div>

                  {updating === lead.id && (
                    <div className="loading loading-spinner loading-md text-purple-600"></div>
                  )}
                </div>
              </div>
              
              {/* Team Assignment */}
              <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-gray-200">
                <div>
                  <span className="text-xs text-gray-600">Handler</span>
                  <div className="font-medium">{lead.handler || 'Not assigned'}</div>
                </div>
                <div>
                  <span className="text-xs text-gray-600">Expert</span>
                  <div className="font-medium">{lead.expert || 'Not assigned'}</div>
                </div>
                <div>
                  <span className="text-xs text-gray-600">Manager</span>
                  <div className="font-medium">{lead.manager || 'Not assigned'}</div>
                </div>
                <div>
                  <span className="text-xs text-gray-600">Balance</span>
                  <div className="font-medium">
                    {lead.balance ? `${lead.balance} ${lead.balance_currency || 'USD'}` : 'N/A'}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Document Status History */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-bold text-gray-900">Recent Document Activities</h3>
          <button
            className="btn btn-ghost btn-sm"
            onClick={fetchDocumentHistory}
            disabled={loadingHistory}
          >
            <ArrowPathIcon className="w-4 h-4" />
            Refresh
          </button>
        </div>

        {loadingHistory ? (
          <div className="text-center py-8">
            <div className="loading loading-spinner loading-lg text-purple-600 mb-4"></div>
            <p className="text-gray-600">Loading document activities...</p>
          </div>
        ) : documentHistory.length === 0 ? (
          <div className="text-center py-8 bg-gray-50 rounded-xl">
            <DocumentTextIcon className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p className="text-gray-500">No recent document activities</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-lg border border-gray-200">
            <div className="max-h-96 overflow-y-auto">
              {documentHistory.map((activity, index) => (
                <div key={activity.id} className={`p-4 ${index !== documentHistory.length - 1 ? 'border-b border-gray-100' : ''}`}>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <div className={`w-3 h-3 rounded-full ${
                          activity.new_status === 'approved' ? 'bg-green-500' :
                          activity.new_status === 'received' ? 'bg-blue-500' :
                          activity.new_status === 'pending' ? 'bg-yellow-500' :
                          activity.new_status === 'rejected' ? 'bg-red-500' : 'bg-gray-400'
                        }`}></div>
                        <h4 className="font-semibold text-gray-900">{activity.document_name}</h4>
                        {activity.contact_name && (
                          <span className="text-sm text-gray-500">• {activity.contact_name}</span>
                        )}
                      </div>
                      
                      <div className="flex items-center gap-2 mb-2">
                        {activity.old_status && (
                          <>
                            <span className="badge badge-outline badge-sm">{activity.old_status}</span>
                            <span className="text-gray-400">→</span>
                          </>
                        )}
                        <span className="badge badge-primary badge-sm">{activity.new_status}</span>
                      </div>

                      {activity.change_reason && (
                        <p className="text-sm text-gray-600 mb-1">
                          <strong>Reason:</strong> {activity.change_reason}
                        </p>
                      )}
                      
                      {activity.notes && (
                        <p className="text-sm text-gray-600 mb-2">
                          <strong>Notes:</strong> {activity.notes}
                        </p>
                      )}
                      
                      <div className="flex items-center gap-4 text-xs text-gray-500">
                        <span>Changed by: {activity.changed_by_name}</span>
                        <span>{new Date(activity.created_at).toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Notes Tab Component
const NotesTab: React.FC<HandlerTabProps> = ({ leads }) => {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const saveNote = async (leadId: string, noteText: string) => {
    setSaving(leadId);
    try {
      // In a real implementation, you'd save to a notes table
      // For now, we'll just update local state
      setNotes(prev => ({ ...prev, [leadId]: noteText }));
      toast.success('Note saved');
    } catch (err) {
      toast.error('Failed to save note');
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-6">
      <h3 className="text-xl font-bold text-gray-900">Case Notes</h3>
      
      {leads.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <PencilIcon className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <p className="text-lg font-medium mb-1">No cases to add notes</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6">
          {leads.map((lead) => (
            <div key={lead.id} className="bg-white rounded-2xl p-6 shadow-lg border border-gray-200">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h4 className="text-lg font-bold text-gray-900">{lead.name}</h4>
                  <p className="text-blue-600 font-medium">Lead #{lead.lead_number}</p>
                </div>
                {saving === lead.id && (
                  <div className="loading loading-spinner loading-md text-purple-600"></div>
                )}
              </div>
              
              <textarea 
                className="textarea textarea-bordered w-full h-32 resize-none"
                placeholder="Add your notes about this case here..."
                value={notes[lead.id] || ''}
                onChange={(e) => setNotes(prev => ({ ...prev, [lead.id]: e.target.value }))}
              />
              
              <div className="flex justify-end mt-3">
                <button 
                  className="btn btn-primary btn-sm"
                  onClick={() => saveNote(lead.id, notes[lead.id] || '')}
                  disabled={saving === lead.id}
                >
                  Save Note
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// Communications Tab Component
const CommunicationsTab: React.FC<HandlerTabProps> = ({ leads }) => {
  const [selectedLead, setSelectedLead] = useState<string | null>(null);
  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);

  const sendMessage = async (leadId: string) => {
    if (!messageText.trim()) return;
    
    setSending(true);
    try {
      // In a real implementation, you'd send email/SMS
      toast.success('Message sent successfully');
      setMessageText('');
    } catch (err) {
      toast.error('Failed to send message');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6">
      <h3 className="text-xl font-bold text-gray-900">Client Communications</h3>
      
      {leads.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <ChatBubbleLeftRightIcon className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <p className="text-lg font-medium mb-1">No cases to communicate with</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Client List */}
          <div className="space-y-4">
            <h4 className="font-semibold text-gray-800">Select Client</h4>
            {leads.map((lead) => (
              <div 
                key={lead.id} 
                className={`p-4 rounded-lg border cursor-pointer transition-colors ${
                  selectedLead === lead.id 
                    ? 'border-purple-500 bg-purple-50' 
                    : 'border-gray-200 hover:bg-gray-50'
                }`}
                onClick={() => setSelectedLead(lead.id)}
              >
                <div className="font-medium text-gray-900">{lead.name}</div>
                <div className="text-sm text-blue-600">Lead #{lead.lead_number}</div>
                {lead.email && (
                  <div className="text-xs text-gray-500">{lead.email}</div>
                )}
              </div>
            ))}
          </div>
          
          {/* Message Composer */}
              <div>
            <h4 className="font-semibold text-gray-800 mb-4">Send Message</h4>
            {selectedLead ? (
              <div className="space-y-4">
                <div className="p-4 bg-blue-50 rounded-lg">
                  <div className="font-medium text-blue-900">
                    To: {leads.find(l => l.id === selectedLead)?.name}
              </div>
                  <div className="text-sm text-blue-700">
                    {leads.find(l => l.id === selectedLead)?.email}
            </div>
          </div>

                <textarea 
                  className="textarea textarea-bordered w-full h-32 resize-none"
                  placeholder="Type your message here..."
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                />
                
                <div className="flex justify-end gap-2">
                  <button 
                    className="btn btn-outline"
                    onClick={() => {
                      setSelectedLead(null);
                      setMessageText('');
                    }}
                  >
                    Cancel
                  </button>
                  <button 
                    className="btn btn-primary"
                    onClick={() => sendMessage(selectedLead)}
                    disabled={sending || !messageText.trim()}
                  >
                    {sending ? 'Sending...' : 'Send Message'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-center py-12 text-gray-500">
                <div className="text-sm">Select a client to send a message</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// Finance Tab Component
const DocumentsTab: React.FC<HandlerTabProps> = ({ leads }) => {
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-200">
        <h3 className="text-xl font-bold text-gray-900 mb-4">Documents</h3>
        <DocumentsContent />
      </div>
    </div>
  );
};

const FinanceTab: React.FC<HandlerTabProps> = ({ leads }) => {
  const [financePlan, setFinancePlan] = useState<any>(null);
  const [contracts, setContracts] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'table' | 'boxes'>('table');
  const [collapsedContacts, setCollapsedContacts] = useState<{ [key: string]: boolean }>({});
  const [editingPaymentId, setEditingPaymentId] = useState<string | number | null>(null);
  const [editPaymentData, setEditPaymentData] = useState<any>({});
  const [isSavingPaymentRow, setIsSavingPaymentRow] = useState(false);
  const [paidMap, setPaidMap] = useState<{ [id: string]: boolean }>({});
  const [editingValueVatId, setEditingValueVatId] = useState<string | number | null>(null);
  const [addingPaymentContact, setAddingPaymentContact] = useState<string | null>(null);
  const [newPaymentData, setNewPaymentData] = useState<any>({});
  const [showStagesDrawer, setShowStagesDrawer] = useState(false);
  const [autoPlanData, setAutoPlanData] = useState({
    totalAmount: '',
    currency: '₪',
    numberOfPayments: 3,
    firstPaymentPercent: 50,
    includeVat: true
  });

  // Get the current case from the leads array (assuming we're in a case context)
  const currentCase = leads.length > 0 ? leads[0] : null;

  // Fetch finance data for current case
  const fetchFinanceData = async (leadId: string) => {
    setLoading(true);
    try {
      // Fetch payment plans
      const { data: paymentPlans, error: paymentError } = await supabase
        .from('payment_plans')
        .select('*')
        .eq('lead_id', leadId)
        .order('due_date', { ascending: true });

      if (paymentError) throw paymentError;

      if (paymentPlans && paymentPlans.length > 0) {
        const total = paymentPlans.reduce((sum, plan) => sum + Number(plan.value) + Number(plan.value_vat), 0);
        const vat = paymentPlans.reduce((sum, plan) => sum + Number(plan.value_vat), 0);
        
        const payments = paymentPlans.map(plan => {
          const value = Number(plan.value);
          let valueVat = 0;
          const currency = plan.currency || '₪';
          if (currency === '₪' || currency === 'NIS' || currency === 'ILS') {
            valueVat = Math.round(value * 0.18 * 100) / 100;
          }
          return {
            id: plan.id,
            duePercent: String(plan.due_percent || plan.percent || 0),
            dueDate: plan.due_date,
            value,
            valueVat,
            client: plan.client_name,
            order: plan.payment_order,
            proforma: plan.proforma || null,
            notes: plan.notes || '',
            paid: plan.paid || false,
            paid_at: plan.paid_at || null,
            paid_by: plan.paid_by || null,
            currency,
          };
        });

        // Update paidMap to reflect the paid status from database
        const newPaidMap: { [id: string]: boolean } = {};
        payments.forEach(payment => {
          newPaidMap[payment.id.toString()] = payment.paid || false;
        });
        setPaidMap(newPaidMap);

        setFinancePlan({
          total: Math.round(total * 100) / 100,
          vat: Math.round(vat * 100) / 100,
          payments: payments,
        });

        // Initialize collapse state for contacts
        if (Object.keys(collapsedContacts).length === 0) {
          const contacts = [...new Set(payments.map(p => p.client))];
          const initialCollapsedState = contacts.reduce((acc, contactName) => {
            acc[contactName] = true; // true means collapsed
            return acc;
          }, {} as { [key: string]: boolean });
          setCollapsedContacts(initialCollapsedState);
        }
      } else {
        setFinancePlan(null);
        setPaidMap({});
      }

      // Fetch contracts
      const { data: contractData, error: contractError } = await supabase
        .from('contracts')
        .select(`
          *,
          contract_templates (*)
        `)
        .eq('lead_id', leadId);

      if (!contractError && contractData) {
        setContracts(contractData);
      }

      // Fetch contacts
      const { data: leadData, error: leadError } = await supabase
        .from('leads')
        .select('additional_contacts')
        .eq('id', leadId)
        .single();
      
      if (!leadError && leadData?.additional_contacts) {
        const contactsWithIds = leadData.additional_contacts.map((contact: any, index: number) => ({
          id: index + 1,
          ...contact
        }));
        setContacts(contactsWithIds);
      } else {
        setContacts([]);
      }

    } catch (error) {
      console.error('Error fetching finance data:', error);
      toast.error('Failed to fetch finance data');
    } finally {
      setLoading(false);
    }
  };

  // Auto-load finance data when component mounts or current case changes
  useEffect(() => {
    if (currentCase) {
      fetchFinanceData(currentCase.id);
    }
  }, [currentCase]);



  const getCurrencySymbol = (currency: string | undefined) => {
    if (!currency) return '₪';
    if (currency === 'USD' || currency === '$') return '$';
    if (currency === 'ILS' || currency === 'NIS' || currency === '₪') return '₪';
    return currency;
  };

  // Helper function to get current user's full name from Supabase users table
  const getCurrentUserName = async (): Promise<string> => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user?.email) {
        return 'System User';
      }
      
      const { data: userData, error } = await supabase
        .from('users')
        .select('full_name, first_name, last_name, email')
        .eq('email', user.email)
        .single();
      
      if (error) {
        return user.email;
      }
      
      if (userData) {
        if (userData.full_name) {
          return userData.full_name;
        } else if (userData.first_name && userData.last_name) {
          return `${userData.first_name} ${userData.last_name}`;
        } else if (userData.first_name) {
          return userData.first_name;
        } else if (userData.last_name) {
          return userData.last_name;
        } else {
          return userData.email;
        }
      }
      
      return user.email;
    } catch (error) {
      console.error('Error getting current user name:', error);
      return 'System User';
    }
  };

  // Handler to mark a payment as paid
  const handleMarkAsPaid = async (id: string | number) => {
    setPaidMap((prev: { [id: string]: boolean }) => ({ ...prev, [id]: true }));
    
    setFinancePlan((prev: any) => {
      if (!prev) return prev;
      return {
        ...prev,
        payments: prev.payments.map((payment: any) => 
          payment.id === id 
            ? { ...payment, paid: true, paid_at: new Date().toISOString() }
            : payment
        )
      };
    });
    
    try {
      const currentUserName = await getCurrentUserName();
      
      const { error: historyError } = await supabase
        .from('finance_changes_history')
        .insert({
          lead_id: currentCase?.id,
          change_type: 'payment_marked_paid',
          table_name: 'payment_plans',
          record_id: id,
          old_values: { paid: false },
          new_values: { paid: true, paid_at: new Date().toISOString(), paid_by: currentUserName },
          changed_by: currentUserName,
          notes: `Payment marked as paid by ${currentUserName}`
        });
      
      if (historyError) console.error('Error logging payment marked as paid:', historyError);
      
      const { error } = await supabase
        .from('payment_plans')
        .update({
          paid: true,
          paid_at: new Date().toISOString(),
          paid_by: currentUserName,
        })
        .eq('id', id);
        
      if (!error) {
        toast.success('Payment marked as paid!');
      } else {
        setPaidMap((prev: { [id: string]: boolean }) => ({ ...prev, [id]: false }));
        setFinancePlan((prev: any) => {
          if (!prev) return prev;
          return {
            ...prev,
            payments: prev.payments.map((payment: any) => 
              payment.id === id 
                ? { ...payment, paid: false, paid_at: undefined }
                : payment
            )
          };
        });
        toast.error('Failed to mark as paid.');
      }
    } catch (error) {
      console.error('Error marking payment as paid:', error);
      setPaidMap((prev: { [id: string]: boolean }) => ({ ...prev, [id]: false }));
      setFinancePlan((prev: any) => {
        if (!prev) return prev;
        return {
          ...prev,
          payments: prev.payments.map((payment: any) => 
            payment.id === id 
              ? { ...payment, paid: false, paid_at: undefined }
              : payment
          )
        };
      });
      toast.error('Failed to mark as paid.');
    }
  };

  const handleEditPayment = (row: any) => {
    setEditingPaymentId(row.id);
    setEditPaymentData({ ...row });
  };

  const handleCancelEditPayment = () => {
    setEditingPaymentId(null);
    setEditPaymentData({});
  };

  const handleSaveEditPayment = async () => {
    setIsSavingPaymentRow(true);
    try {
      const currentUserName = await getCurrentUserName();
      
      const { error } = await supabase
        .from('payment_plans')
        .update({
          due_percent: editPaymentData.duePercent,
          due_date: editPaymentData.dueDate,
          value: editPaymentData.value,
          value_vat: editPaymentData.valueVat,
          client_name: editPaymentData.client,
          payment_order: editPaymentData.order,
          notes: editPaymentData.notes,
        })
        .eq('id', editPaymentData.id);
      if (error) throw error;
      
      toast.success('Payment row updated!');
      setEditingPaymentId(null);
      setEditPaymentData({});
      await fetchFinanceData(currentCase!.id);
    } catch (error) {
      console.error('Error updating payment:', error);
      toast.error('Failed to update payment row.');
    } finally {
      setIsSavingPaymentRow(false);
    }
  };

  const handleDeletePayment = async (row: any) => {
    if (!window.confirm('Are you sure you want to delete this payment row?')) return;
    try {
      const currentUserName = await getCurrentUserName();
      
      const { error: historyError } = await supabase
        .from('payment_plan_changes')
        .insert({
          payment_plan_id: null,
          lead_id: currentCase?.id,
          field_name: 'payment_deleted',
          old_value: JSON.stringify({
            id: row.id,
            due_percent: row.duePercent,
            due_date: row.dueDate,
            value: row.value,
            value_vat: row.valueVat,
            client_name: row.client,
            payment_order: row.order,
            notes: row.notes
          }),
          new_value: '',
          changed_by: currentUserName,
          changed_at: new Date().toISOString()
        });
      
      if (historyError) {
        console.error('Error logging deletion:', historyError);
        toast.error('Failed to log deletion history.');
        return;
      }
      
      const { error } = await supabase
        .from('payment_plans')
        .delete()
        .eq('id', row.id);
      if (error) throw error;
      
      toast.success('Payment row deleted!');
      await fetchFinanceData(currentCase!.id);
    } catch (error) {
      console.error('Error deleting payment:', error);
      toast.error('Failed to delete payment row.');
    }
  };

  const handleAddNewPayment = (contactName: string) => {
    setAddingPaymentContact(contactName);
    setNewPaymentData({
      dueDate: '',
      value: '',
      client: contactName,
      notes: '',
      paid: false,
      paid_at: null,
      paid_by: null,
    });
  };

  const handleCancelNewPayment = () => {
    setAddingPaymentContact(null);
    setNewPaymentData({});
  };

  const handleSaveNewPayment = async () => {
    if (!newPaymentData.dueDate || !newPaymentData.value || !newPaymentData.client) {
      toast.error('Please fill in all required fields');
      return;
    }

    setIsSavingPaymentRow(true);
    try {
      const currentUserName = await getCurrentUserName();
      
      const paymentData = {
        lead_id: currentCase?.id,
        due_percent: Number(100),
        percent: Number(100),
        due_date: newPaymentData.dueDate,
        value: Number(newPaymentData.value),
        value_vat: 0,
        client_name: newPaymentData.client,
        payment_order: 'One-time Payment',
        notes: newPaymentData.notes || '',
        currency: newPaymentData.currency || '₪',
        created_by: currentUserName,
      };
      
      const { data, error } = await supabase
        .from('payment_plans')
        .insert(paymentData)
        .select();

      if (error) throw error;

      toast.success('Payment plan created successfully');
      handleCancelNewPayment();
      await fetchFinanceData(currentCase!.id);
    } catch (error) {
      console.error('Error creating payment plan:', error);
      toast.error('Failed to create payment plan');
    } finally {
      setIsSavingPaymentRow(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-200">
        <h3 className="text-2xl font-bold text-gray-900 mb-4">Finance Management</h3>
        <p className="text-gray-600 mb-6">View and manage finance plans for your cases.</p>
        


        {loading && (
          <div className="flex items-center justify-center py-8">
            <div className="loading loading-spinner loading-lg"></div>
            <span className="ml-3">Loading finance data...</span>
          </div>
        )}

        {currentCase && !loading && (
          <div className="space-y-6">
            {/* Contract Information */}
            {contracts.length > 0 && (
              <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-xl p-6 border border-purple-200">
                <h4 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <DocumentTextIcon className="w-5 h-5 text-purple-600" />
                  Contract Information
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {contracts.map((contract) => (
                    <div key={contract.id} className="bg-white rounded-lg p-4 border border-gray-200">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-semibold text-gray-700">
                          {contract.contract_templates?.name || 'Contract'}
                        </span>
                        <span className={`badge ${
                          contract.status === 'signed' 
                            ? 'badge-success' 
                            : 'badge-warning'
                        }`}>
                          {contract.status === 'signed' ? 'Signed' : 'Draft'}
                        </span>
                      </div>
                      {contract.total_amount && (
                        <div className="text-lg font-bold text-purple-700">
                          {getCurrencySymbol(contract.currency)}{contract.total_amount.toLocaleString()}
                        </div>
                      )}
                      {contract.signed_at && (
                        <div className="text-sm text-gray-600">
                          Signed: {new Date(contract.signed_at).toLocaleDateString()}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Finance Plan */}
            {financePlan ? (
              <div className="bg-white rounded-xl p-6 border border-gray-200">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                    <ChartBarIcon className="w-5 h-5 text-gray-600" />
                    Payment Plan
                  </h4>
                  <div className="flex items-center gap-2">
                    <button
                      className="btn btn-sm btn-outline"
                      onClick={() => setViewMode(viewMode === 'table' ? 'boxes' : 'table')}
                    >
                      {viewMode === 'table' ? 'Box View' : 'Table View'}
                    </button>
                  </div>
                </div>
                
                {/* Summary */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  <div className="bg-white rounded-lg p-4 border border-gray-200">
                    <div className="text-sm text-gray-600">Total Amount</div>
                    <div className="text-xl font-bold text-gray-900">
                      {getCurrencySymbol(financePlan.payments[0]?.currency)}{financePlan.total.toLocaleString()}
                    </div>
                  </div>
                  <div className="bg-white rounded-lg p-4 border border-gray-200">
                    <div className="text-sm text-gray-600">VAT</div>
                    <div className="text-xl font-bold text-gray-900">
                      {getCurrencySymbol(financePlan.payments[0]?.currency)}{financePlan.vat.toLocaleString()}
                    </div>
                  </div>
                  <div className="bg-white rounded-lg p-4 border border-gray-200">
                    <div className="text-sm text-gray-600">Payments</div>
                    <div className="text-xl font-bold text-gray-900">
                      {financePlan.payments.length}
                    </div>
                  </div>
                </div>

                {/* Group payments by contact */}
                {(() => {
                  const paymentsByContact = financePlan.payments.reduce((acc: { [key: string]: any[] }, payment: any) => {
                    const contactName = payment.client;
                    if (!acc[contactName]) {
                      acc[contactName] = [];
                    }
                    acc[contactName].push(payment);
                    return acc;
                  }, {});

                  return Object.entries(paymentsByContact).map(([contactName, payments], contactIndex) => {
                    const sortedContactPayments = [...(payments as any[])].sort((a: any, b: any) => {
                      const aTime = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
                      const bTime = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
                      return aTime - bTime;
                    });

                    return (
                      <div key={contactName} className="mb-8">
                        {/* Contact Header */}
                        <div className="mb-4">
                          <div 
                            className="flex items-center gap-3 bg-white rounded-lg p-4 border border-purple-200 cursor-pointer hover:from-purple-100 hover:to-blue-100 transition-all duration-200"
                            onClick={() => setCollapsedContacts(prev => ({ ...prev, [contactName]: !prev[contactName] }))}
                          >
                            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-blue-600 rounded-full flex items-center justify-center">
                              <UserIcon className="w-5 h-5 text-white" />
                            </div>
                            <div className="flex-1">
                              <h3 className="text-lg font-bold text-gray-900">{contactName}</h3>
                              <p className="text-sm text-gray-600">Finance Plan</p>
                            </div>
                            <div className="text-right mr-4">
                              <div className="text-lg font-bold text-gray-900">
                                {getCurrencySymbol((payments as any[])[0]?.currency)}{(payments as any[]).reduce((sum: number, p: any) => sum + p.value + p.valueVat, 0).toLocaleString()}
                              </div>
                              <div className="text-xs text-gray-500">Total for {contactName}</div>
                            </div>
                            <div className="flex items-center justify-center w-8 h-8">
                              {collapsedContacts[contactName] ? (
                                <svg className="w-5 h-5 text-purple-600 transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                              ) : (
                                <svg className="w-5 h-5 text-purple-600 transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                                </svg>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Table or Box view for this contact */}
                        {!collapsedContacts[contactName] && (
                          <>
                            {viewMode === 'table' ? (
                              <div className="bg-white rounded-xl p-4 border border-gray-200 overflow-x-auto">
                                <table className="min-w-full rounded-xl overflow-hidden">
                                  <thead className="bg-base-200 sticky top-0 z-10">
                                    <tr>
                                      <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">Due %</th>
                                      <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">Due Date</th>
                                      <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">Value</th>
                                      <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">VAT</th>
                                      <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">Contact</th>
                                      <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">Payment Date</th>
                                      <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">Order</th>
                                      <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">Notes</th>
                                      <th className="px-4 py-3 text-center"></th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {sortedContactPayments.map((p: any, idx: number) => {
                                      const isPaid = p.paid;
                                      return (
                                        <tr
                                          key={p.id || idx}
                                          className={`transition-all duration-200 ${
                                            isPaid
                                              ? 'bg-green-50 border-l-4 border-green-400'
                                              : idx % 2 === 0
                                                ? 'bg-white border-l-4 border-transparent'
                                                : 'bg-base-100 border-l-4 border-transparent'
                                          } hover:bg-blue-50 rounded-xl shadow-sm`}
                                          style={{ 
                                            verticalAlign: 'middle', 
                                            position: 'relative',
                                            ...(isPaid && {
                                              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='100' viewBox='0 0 200 100'%3E%3Ctext x='100' y='50' font-family='Arial, sans-serif' font-size='24' font-weight='bold' fill='rgba(34,197,94,0.13)' text-anchor='middle' dominant-baseline='middle' transform='rotate(-20 100 50)'%3EPAID%3C/text%3E%3C/svg%3E")`,
                                              backgroundRepeat: 'no-repeat',
                                              backgroundPosition: 'center',
                                              backgroundSize: 'contain'
                                            })
                                          }}
                                        >
                                          <td className="font-bold text-lg align-middle text-center px-4 py-3 whitespace-nowrap">
                                            {editingPaymentId === p.id ? (
                                              <input
                                                type="number"
                                                min={0}
                                                max={100}
                                                className="input input-bordered input-lg w-20 text-center font-bold rounded-xl border-2 border-blue-300 focus:border-blue-500 no-arrows"
                                                value={editPaymentData.duePercent}
                                                onChange={e => {
                                                  const newDuePercent = Number(e.target.value);
                                                  setEditPaymentData((d: any) => ({ ...d, duePercent: newDuePercent }));
                                                }}
                                              />
                                            ) : (
                                              p.duePercent
                                            )}
                                          </td>
                                          <td className="align-middle text-center px-4 py-3 whitespace-nowrap">
                                            {editingPaymentId === p.id ? (
                                              <input
                                                type="date"
                                                className="input input-bordered w-48 text-right"
                                                value={editPaymentData.dueDate ? editPaymentData.dueDate.slice(0, 10) : ''}
                                                onChange={e => setEditPaymentData((d: any) => ({ ...d, dueDate: e.target.value }))}
                                                required
                                              />
                                            ) : (
                                              <span className="text-sm font-bold text-gray-900">{p.dueDate && new Date(p.dueDate).toString() !== 'Invalid Date' ? new Date(p.dueDate).toLocaleDateString() : ''}</span>
                                            )}
                                          </td>
                                          <td className="font-bold align-middle text-center px-4 py-3 whitespace-nowrap">
                                            {editingPaymentId === p.id ? (
                                              <div className="flex items-center gap-2">
                                                <input
                                                  type="number"
                                                  className={`input input-bordered input-lg w-32 text-right font-bold rounded-xl border-2 border-blue-300 no-arrows ${editingValueVatId === p.id ? '' : 'bg-gray-100 text-gray-500 cursor-not-allowed'}`}
                                                  value={editPaymentData.value}
                                                  readOnly={editingValueVatId !== p.id}
                                                  onChange={editingValueVatId === p.id ? (e) => setEditPaymentData((d: any) => ({ ...d, value: e.target.value })) : undefined}
                                                />
                                                <span className='text-gray-500 font-bold'>+
                                                  <input
                                                    type="number"
                                                    className={`input input-bordered input-lg w-20 text-right font-bold rounded-xl border-2 border-blue-300 no-arrows ${editingValueVatId === p.id ? '' : 'bg-gray-100 text-gray-500 cursor-not-allowed'}`}
                                                    value={editPaymentData.valueVat}
                                                    readOnly={editingValueVatId !== p.id}
                                                    onChange={editingValueVatId === p.id ? (e) => setEditPaymentData((d: any) => ({ ...d, valueVat: e.target.value })) : undefined}
                                                  />
                                                </span>
                                                {editingValueVatId === p.id ? (
                                                  <button className="btn btn-xs btn-ghost ml-1" onClick={() => setEditingValueVatId(null)} title="Done editing Value/VAT">
                                                    <CheckIcon className="w-4 h-4 text-green-600" />
                                                  </button>
                                                ) : (
                                                  <button className="btn btn-xs btn-ghost ml-1" onClick={() => setEditingValueVatId(p.id)} title="Edit Value/VAT">
                                                    <PencilIcon className="w-4 h-4 text-blue-600" />
                                                  </button>
                                                )}
                                              </div>
                                            ) : (
                                              <span className="text-sm font-bold text-gray-900">
                                                {getCurrencySymbol(p.currency)}
                                                {p.value.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                                + {p.valueVat.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                              </span>
                                            )}
                                          </td>
                                          <td className="font-bold align-middle text-center px-4 py-3 whitespace-nowrap">
                                            <span className="text-sm font-bold text-gray-900">{getCurrencySymbol(p.currency)}{p.valueVat.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                          </td>
                                          <td className="align-middle text-center px-4 py-3 whitespace-nowrap">
                                            <div className="flex items-center justify-center gap-2">
                                              <div className="w-6 h-6 bg-gradient-to-br from-purple-500 to-blue-600 rounded-full flex items-center justify-center">
                                                <UserIcon className="w-3 h-3 text-white" />
                                              </div>
                                              <div className="text-left">
                                                <div className="text-sm font-semibold text-gray-900">
                                                  {p.client}
                                                </div>
                                              </div>
                                            </div>
                                          </td>
                                          <td className="align-middle text-center px-4 py-3 whitespace-nowrap">
                                            {p.paid_at ? new Date(p.paid_at).toLocaleDateString() : '---'}
                                          </td>
                                          <td className="align-middle text-center px-4 py-3 whitespace-nowrap">{p.order}</td>
                                          <td className="align-middle text-center px-4 py-3 whitespace-nowrap">{p.notes}</td>
                                          <td className="flex gap-2 justify-end align-middle min-w-[80px] px-4 py-3">
                                            {p.id ? (
                                              editingPaymentId === p.id ? (
                                                <>
                                                  <button
                                                    className="btn btn-xs btn-success"
                                                    onClick={handleSaveEditPayment}
                                                    disabled={isSavingPaymentRow}
                                                  >
                                                    <CheckIcon className="w-4 h-4" />
                                                  </button>
                                                  <button
                                                    className="btn btn-xs btn-ghost"
                                                    onClick={handleCancelEditPayment}
                                                    title="Cancel"
                                                  >
                                                    <XMarkIcon className="w-4 h-4 text-red-500" />
                                                  </button>
                                                </>
                                              ) : (
                                                <>
                                                  {!isPaid && (
                                                    <button
                                                      className="btn btn-xs btn-circle bg-green-100 hover:bg-green-200 text-green-700 border-green-300 border-2 shadow-sm flex items-center justify-center"
                                                      title="Mark as Paid"
                                                      onClick={() => handleMarkAsPaid(p.id)}
                                                      style={{ padding: 0 }}
                                                    >
                                                      <CurrencyDollarIcon className="w-4 h-4" />
                                                    </button>
                                                  )}
                                                  <button
                                                    className="btn btn-xs btn-circle bg-gray-100 hover:bg-gray-200 text-primary border-none shadow-sm flex items-center justify-center"
                                                    title="Edit"
                                                    onClick={() => handleEditPayment(p)}
                                                    style={{ padding: 0 }}
                                                  >
                                                    <PencilIcon className="w-4 h-4" />
                                                  </button>
                                                  <button
                                                    className="btn btn-xs btn-circle bg-red-100 hover:bg-red-200 text-red-500 border-none shadow-sm flex items-center justify-center"
                                                    title="Delete"
                                                    onClick={() => handleDeletePayment(p)}
                                                    style={{ padding: 0 }}
                                                  >
                                                    <TrashIcon className="w-4 h-4" />
                                                  </button>
                                                </>
                                              )
                                            ) : (
                                              <span className="text-gray-400">—</span>
                                            )}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            ) : (
                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {sortedContactPayments.map((p: any, idx: number) => {
                                  const isPaid = p.paid;
                                  return (
                                    <div
                                      key={p.id || idx}
                                      className={`bg-white rounded-2xl p-6 shadow-2xl hover:shadow-3xl transition-all duration-200 border flex flex-col gap-0 relative group min-h-[480px] ${isPaid ? 'border-green-500 ring-2 ring-green-400' : 'border-base-200'}`}
                                      style={{ position: 'relative', overflow: 'hidden' }}
                                    >
                                      {isPaid && (
                                        <div style={{
                                          position: 'absolute',
                                          top: '50%',
                                          left: '50%',
                                          transform: 'translate(-50%, -50%) rotate(-20deg)',
                                          fontSize: '3rem',
                                          color: 'rgba(34,197,94,0.15)',
                                          fontWeight: 900,
                                          letterSpacing: 2,
                                          pointerEvents: 'none',
                                          zIndex: 10,
                                          textShadow: '0 2px 8px rgba(34,197,94,0.2)'
                                        }}>PAID</div>
                                      )}
                                      <div className="flex flex-col gap-0 divide-y divide-base-200">
                                        <div className="flex items-center justify-between py-3">
                                          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Due %</span>
                                          <span>{p.duePercent}%</span>
                                        </div>
                                        <div className="flex items-center justify-between py-3">
                                          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Due Date</span>
                                          <span className="text-sm font-bold text-gray-900">{p.dueDate && new Date(p.dueDate).toString() !== 'Invalid Date' ? new Date(p.dueDate).toLocaleDateString() : ''}</span>
                                        </div>
                                        <div className="flex items-center justify-between py-3">
                                          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Value</span>
                                          <span className="text-sm font-bold text-gray-900">
                                            {getCurrencySymbol(p.currency)}{p.value.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                            + {p.valueVat.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                          </span>
                                        </div>
                                        <div className="flex items-center justify-between py-3">
                                          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">VAT</span>
                                          <span className="text-sm font-bold text-gray-900">{getCurrencySymbol(p.currency)}{p.valueVat.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                        </div>
                                        <div className="flex items-center justify-between py-3">
                                          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Client</span>
                                          <span className="text-sm">{p.client}</span>
                                        </div>
                                        <div className="flex items-center justify-between py-3">
                                          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Order</span>
                                          <span className="text-sm">{p.order}</span>
                                        </div>
                                        <div className="flex items-center justify-between py-3">
                                          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Notes</span>
                                          <span className="text-sm">{p.notes}</span>
                                        </div>
                                        <div className="flex gap-2 justify-end pt-4">
                                          {!isPaid && (
                                            <button
                                              className="btn btn-xs btn-success"
                                              onClick={() => handleMarkAsPaid(p.id)}
                                            >
                                              Mark Paid
                                            </button>
                                          )}
                                          <button
                                            className="btn btn-xs btn-outline"
                                            onClick={() => handleEditPayment(p)}
                                          >
                                            Edit
                                          </button>
                                          <button
                                            className="btn btn-xs btn-error"
                                            onClick={() => handleDeletePayment(p)}
                                          >
                                            Delete
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  });
                })()}
              </div>
            ) : (
              <div className="text-center py-12 bg-gray-50 rounded-xl">
                <ChartBarIcon className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <h4 className="text-lg font-bold text-gray-800 mb-2">No Finance Plan</h4>
                <p className="text-gray-600">This case doesn't have a finance plan yet.</p>
              </div>
            )}
          </div>
        )}

        {!currentCase && !loading && (
          <div className="text-center py-12 bg-gray-50 rounded-xl">
            <ChartBarIcon className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h4 className="text-lg font-bold text-gray-800 mb-2">Select a Case</h4>
            <p className="text-gray-600">Choose a case from the dropdown above to view its finance details.</p>
          </div>
        )}
      </div>
    </div>
  );
};



// Mock family data for a case
const mockFamilyData = {
  'C-2024-001': {
    caseInfo: {
      id: 'C-2024-001',
      client: 'Sarah Müller',
      country: 'Germany',
      stage: 'Document Review',
      priority: 'High',
      created: '2024-03-15',
      lastUpdate: '2 hours ago',
      progress: 65,
      caseManager: 'Anna Weber',
      targetCountry: 'Germany',
      applicationPath: 'Section 116 - Persecuted Ancestors'
    },
    familyMembers: [
      {
        id: 1,
        name: 'Friedrich Müller',
        relationship: 'Great-grandfather (Persecuted Ancestor)',
        dob: '1895-03-12',
        dod: '1943-11-20',
        birthPlace: 'Berlin, Germany',
        idNumber: 'GER-1895-001',
        isPersecuted: true,
        isMainApplicant: false,
        persecutionDetails: {
          reason: 'Jewish faith and political opposition',
          evidence: 'Deportation records, Yad Vashem testimony, police records',
          dateOfPersecution: '1942-09-15',
          location: 'Berlin, then Auschwitz'
        },
        contactInfo: {
          email: null,
          phone: null,
          address: 'Deceased'
        },
        maritalStatus: 'Married to Rosa Müller (deceased)',
        parentId: null,
        docs: { 
          birth: true, 
          death: true, 
          marriage: true, 
          persecution: true,
          police: false,
          passport: false 
        },
        avatar: 'FM'
      },
      {
        id: 2,
        name: 'Heinrich Müller',
        relationship: 'Grandfather',
        dob: '1920-07-22',
        dod: '1995-12-10',
        birthPlace: 'Berlin, Germany',
        idNumber: 'GER-1920-002',
        isPersecuted: false,
        isMainApplicant: false,
        contactInfo: {
          email: null,
          phone: null,
          address: 'Deceased'
        },
        maritalStatus: 'Married to Ingrid Müller (deceased)',
        parentId: 1,
        docs: { 
          birth: true, 
          death: true, 
          marriage: true, 
          persecution: false,
          police: false,
          passport: false 
        },
        avatar: 'HM'
      },
      {
        id: 3,
        name: 'Klaus Müller',
        relationship: 'Father',
        dob: '1955-04-15',
        dod: null,
        birthPlace: 'Munich, Germany',
        idNumber: 'GER-1955-003',
        isPersecuted: false,
        isMainApplicant: false,
        contactInfo: {
          email: 'klaus.mueller@email.com',
          phone: '+49 89 123 4567',
          address: 'Münchener Str. 45, 80331 Munich, Germany'
        },
        maritalStatus: 'Married to Elisabeth Müller',
        parentId: 2,
        docs: { 
          birth: true, 
          death: false, 
          marriage: true, 
          persecution: false,
          police: true,
          passport: true 
        },
        avatar: 'KM'
      },
      {
        id: 4,
        name: 'Sarah Müller',
        relationship: 'Main Applicant',
        dob: '1985-09-12',
        dod: null,
        birthPlace: 'New York, USA',
        idNumber: 'USA-1985-004',
        isPersecuted: false,
        isMainApplicant: true,
        contactInfo: {
          email: 'sarah.mueller@email.com',
          phone: '+1 212 555 0123',
          address: '123 Manhattan Ave, New York, NY 10001, USA'
        },
        maritalStatus: 'Single',
        parentId: 3,
        docs: { 
          birth: true, 
          death: false, 
          marriage: false, 
          persecution: false,
          police: true,
          passport: true 
        },
        avatar: 'SM'
      },
      {
        id: 5,
        name: 'Michael Müller',
        relationship: 'Brother',
        dob: '1988-02-28',
        dod: null,
        birthPlace: 'New York, USA',
        idNumber: 'USA-1988-005',
        isPersecuted: false,
        isMainApplicant: false,
        contactInfo: {
          email: 'michael.mueller@email.com',
          phone: '+1 212 555 0456',
          address: '456 Brooklyn Ave, New York, NY 10002, USA'
        },
        maritalStatus: 'Married to Lisa Müller',
        parentId: 3,
        docs: { 
          birth: true, 
          death: false, 
          marriage: true, 
          persecution: false,
          police: false,
          passport: true 
        },
        avatar: 'MM'
      }
    ]
  }
};

// Helper to build family tree for visualization
function buildFamilyTree(familyMembers: any[]) {
  const memberMap: Record<number, any> = {};
  familyMembers.forEach(member => {
    memberMap[member.id] = { ...member, children: [] };
  });
  
  const roots: any[] = [];
  familyMembers.forEach(member => {
    if (member.parentId && memberMap[member.parentId]) {
      memberMap[member.parentId].children.push(memberMap[member.id]);
    } else if (!member.parentId) {
      roots.push(memberMap[member.id]);
    }
  });
  
  return roots.length === 1 ? roots[0] : roots;
}

// Custom tree node renderer for family members
const renderFamilyNode = ({ nodeDatum }: any, onNodeClick: (node: any) => void) => (
  <g
    style={{ cursor: 'pointer' }}
    onClick={() => onNodeClick(nodeDatum)}
  >
    {/* Main card background */}
    <rect
      width="280"
      height="160"
      x="-140"
      y="-80"
      rx="20"
      fill="#fff"
      stroke={nodeDatum.isPersecuted ? '#ef4444' : nodeDatum.isMainApplicant ? '#3b82f6' : '#e5e7eb'}
      strokeWidth={nodeDatum.isPersecuted || nodeDatum.isMainApplicant ? "3" : "2"}
      style={{ 
        filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.15))',
        fillOpacity: 0.95
      }}
    />
    
    {/* Content */}
    <foreignObject x="-130" y="-70" width="260" height="140">
      <div style={{
        fontFamily: 'Inter, system-ui, sans-serif',
        padding: '12px',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center'
      }}>
        {/* Name */}
        <div style={{ 
          fontWeight: 700, 
          fontSize: 16, 
          color: '#111', 
          marginBottom: 4,
          textAlign: 'center',
          lineHeight: 1.2
        }}>
          {nodeDatum.name}
        </div>
        
        {/* Relationship */}
        <div style={{ 
          fontWeight: 500, 
          fontSize: 12, 
          color: nodeDatum.isPersecuted ? '#ef4444' : '#6366f1',
          marginBottom: 6,
          textAlign: 'center'
        }}>
          {nodeDatum.relationship}
        </div>
        
        {/* Birth/Death dates */}
        <div style={{ 
          fontSize: 11, 
          color: '#6b7280', 
          marginBottom: 8,
          textAlign: 'center'
        }}>
          {nodeDatum.dob} {nodeDatum.dod && `- ${nodeDatum.dod}`}
        </div>
        
        {/* Badges */}
        <div style={{ 
          display: 'flex', 
          gap: 4, 
          justifyContent: 'center',
          flexWrap: 'wrap'
        }}>
          {nodeDatum.isPersecuted && (
            <span style={{
              background: '#ef4444',
              color: '#fff',
              fontWeight: 600,
              fontSize: 10,
              borderRadius: 12,
              padding: '2px 8px'
            }}>Persecuted</span>
          )}
          {nodeDatum.isMainApplicant && (
            <span style={{
              background: '#3b82f6',
              color: '#fff',
              fontWeight: 600,
              fontSize: 10,
              borderRadius: 12,
              padding: '2px 8px'
            }}>Main Applicant</span>
          )}
          {nodeDatum.dod && (
            <span style={{
              background: '#6b7280',
              color: '#fff',
              fontWeight: 500,
              fontSize: 10,
              borderRadius: 12,
              padding: '2px 8px'
            }}>Deceased</span>
          )}
        </div>
      </div>
    </foreignObject>
  </g>
);

// Comprehensive Case Details Component
const CaseDetailsView = ({ 
  caseData, 
  onBack 
}: { 
  caseData: any; 
  onBack: () => void;
}) => {
  const [activeDetailTab, setActiveDetailTab] = useState('overview');
  const [selectedFamilyMember, setSelectedFamilyMember] = useState<any | null>(null);
  const [dragActive, setDragActive] = useState<Record<number, boolean>>({});
  const [uploadedFiles, setUploadedFiles] = useState<Record<number, any[]>>({});
  
  const familyTree = buildFamilyTree(caseData.familyMembers);
  const persecutedAncestor = caseData.familyMembers.find((m: any) => m.isPersecuted);
  
  const handleNodeClick = (node: any) => {
    setSelectedFamilyMember(node);
  };
  
  const handleDrop = (e: React.DragEvent, memberId: number) => {
    e.preventDefault();
    setDragActive(prev => ({ ...prev, [memberId]: false }));
    const files = Array.from(e.dataTransfer.files);
    setUploadedFiles(prev => ({
      ...prev,
      [memberId]: [...(prev[memberId] || []), ...files]
    }));
  };
  
  const handleDragOver = (e: React.DragEvent, memberId: number) => {
    e.preventDefault();
    setDragActive(prev => ({ ...prev, [memberId]: true }));
  };
  
  const handleDragLeave = (e: React.DragEvent, memberId: number) => {
    e.preventDefault();
    setDragActive(prev => ({ ...prev, [memberId]: false }));
  };

  const detailTabs = [
    { id: 'overview', label: 'Overview', icon: ChartBarIcon },
    { id: 'family', label: 'Family Tree', icon: UserIcon },
    { id: 'contacts', label: 'Contacts', icon: PhoneIcon },
    { id: 'documents', label: 'Documents', icon: DocumentTextIcon },
    { id: 'tasks', label: 'Tasks', icon: ClockIcon },
    { id: 'timeline', label: 'Timeline', icon: CalendarIcon },
  ];
  
  return (
    <div className="space-y-6">
      {/* Header with Back Button */}
      <div className="bg-white rounded-3xl p-6 shadow-lg border border-gray-200">
        <div>
            <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button 
                onClick={onBack}
                className="btn btn-outline btn-sm gap-2"
              >
                <ArrowLeftIcon className="w-4 h-4" />
                Back to Cases
              </button>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">{caseData.caseInfo.id} - {caseData.caseInfo.client}</h1>
                <p className="text-gray-600">{caseData.caseInfo.applicationPath}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className={`badge ${
                caseData.caseInfo.priority === 'High' ? 'badge-error' : 
                caseData.caseInfo.priority === 'Medium' ? 'badge-warning' : 'badge-info'
              } badge-lg`}>
                {caseData.caseInfo.priority} Priority
              </span>
              <span className="badge badge-primary badge-lg">{caseData.caseInfo.stage}</span>
          </div>
        </div>

          {/* Quick Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">{caseData.familyMembers.length}</div>
              <div className="text-sm text-gray-600">Family Members</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-600">
                {caseData.familyMembers.filter((m: any) => m.isPersecuted).length}
              </div>
              <div className="text-sm text-gray-600">Persecuted Ancestors</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">{caseData.caseInfo.progress}%</div>
              <div className="text-sm text-gray-600">Progress</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600">
                {caseData.familyMembers.reduce((acc: number, m: any) => 
                  acc + Object.values(m.docs).filter(Boolean).length, 0
                )}
              </div>
              <div className="text-sm text-gray-600">Documents Collected</div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Detail Tabs */}
      <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-200">
        <div className="p-2">
          <div className="flex gap-2 overflow-x-auto">
            {detailTabs.map((tab) => (
              <button
                key={tab.id}
                className={`flex items-center gap-2 px-4 py-3 rounded-xl font-semibold transition-all duration-300 whitespace-nowrap ${
                  activeDetailTab === tab.id 
                    ? 'bg-blue-600 text-white shadow-lg' 
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
                onClick={() => setActiveDetailTab(tab.id)}
              >
                <tab.icon className="w-5 h-5" />
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      
      {/* Tab Content */}
      <div className="animate-fade-in">
        {activeDetailTab === 'overview' && (
          <div className="space-y-6">
            {/* Case Information */}
            <div className="bg-white rounded-3xl p-6 shadow-lg border border-gray-200">
              <div>
                <h3 className="text-xl font-bold mb-4">Case Information</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div>
                    <span className="text-sm text-gray-600">Target Country:</span>
                    <div className="font-semibold">{caseData.caseInfo.targetCountry}</div>
                  </div>
                  <div>
                    <span className="text-sm text-gray-600">Application Path:</span>
                    <div className="font-semibold">{caseData.caseInfo.applicationPath}</div>
                  </div>
                  <div>
                    <span className="text-sm text-gray-600">Case Manager:</span>
                    <div className="font-semibold">{caseData.caseInfo.caseManager}</div>
                  </div>
                  <div>
                    <span className="text-sm text-gray-600">Created:</span>
                    <div className="font-semibold">{caseData.caseInfo.created}</div>
                  </div>
                  <div>
                    <span className="text-sm text-gray-600">Last Update:</span>
                    <div className="font-semibold">{caseData.caseInfo.lastUpdate}</div>
                  </div>
                  <div>
                    <span className="text-sm text-gray-600">Current Stage:</span>
                    <div className="font-semibold text-blue-600">{caseData.caseInfo.stage}</div>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Persecuted Ancestor Details */}
            {persecutedAncestor && (
              <div className="bg-white rounded-3xl p-6 shadow-lg border border-gray-200">
                <div>
                  <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                    <HeartIcon className="w-6 h-6 text-red-500" />
                    Persecuted Ancestor: {persecutedAncestor.name}
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-3">
                      <div>
                        <span className="text-sm text-gray-600">Birth - Death:</span>
                        <div className="font-semibold">{persecutedAncestor.dob} - {persecutedAncestor.dod}</div>
                      </div>
                      <div>
                        <span className="text-sm text-gray-600">Birth Place:</span>
                        <div className="font-semibold">{persecutedAncestor.birthPlace}</div>
                      </div>
                      <div>
                        <span className="text-sm text-gray-600">Reason for Persecution:</span>
                        <div className="font-semibold text-red-600">{persecutedAncestor.persecutionDetails.reason}</div>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <div>
                        <span className="text-sm text-gray-600">Date of Persecution:</span>
                        <div className="font-semibold">{persecutedAncestor.persecutionDetails.dateOfPersecution}</div>
                      </div>
                      <div>
                        <span className="text-sm text-gray-600">Location:</span>
                        <div className="font-semibold">{persecutedAncestor.persecutionDetails.location}</div>
                      </div>
                      <div>
                        <span className="text-sm text-gray-600">Evidence Available:</span>
                        <div className="font-semibold text-green-600">{persecutedAncestor.persecutionDetails.evidence}</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        
        {activeDetailTab === 'family' && (
          <div className="space-y-6">
            {/* Family Tree Visualization */}
            <div className="bg-white rounded-3xl p-6 shadow-lg border border-gray-200">
              <div>
                <h3 className="text-xl font-bold mb-6">Family Tree - Lineage from Persecuted Ancestor</h3>
                <div style={{ width: '100%', height: '600px' }}>
                  <Tree
                    data={familyTree}
                    orientation="vertical"
                    translate={{ x: 400, y: 100 }}
                    renderCustomNodeElement={(rd) => renderFamilyNode(rd, handleNodeClick)}
                    pathFunc="elbow"
                    zoomable={true}
                    collapsible={false}
                    separation={{ siblings: 1.5, nonSiblings: 2 }}
                    nodeSize={{ x: 300, y: 200 }}
                  />
                </div>
                <div className="mt-4 flex gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 bg-red-500 rounded"></div>
                    <span>Persecuted Ancestor</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 bg-blue-500 rounded"></div>
                    <span>Main Applicant</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 bg-gray-400 rounded"></div>
                    <span>Deceased</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeDetailTab === 'contacts' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {caseData.familyMembers.map((member: any) => (
                <div key={member.id} className="bg-white rounded-3xl p-6 shadow-lg border border-gray-200">
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-bold">{member.name}</h3>
                      <div className="flex gap-2">
                        {member.isPersecuted && <span className="badge badge-error badge-sm">Persecuted</span>}
                        {member.isMainApplicant && <span className="badge badge-primary badge-sm">Main</span>}
                        {member.dod && <span className="badge badge-neutral badge-sm">Deceased</span>}
                      </div>
                    </div>
                    <p className="text-sm text-gray-600 mb-4">{member.relationship}</p>
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <EnvelopeIcon className="w-4 h-4 text-gray-500" />
                        <span className="text-sm">{member.contactInfo.email || 'N/A'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <PhoneIcon className="w-4 h-4 text-gray-500" />
                        <span className="text-sm">{member.contactInfo.phone || 'N/A'}</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <MapPinIcon className="w-4 h-4 text-gray-500 mt-0.5" />
                        <span className="text-sm">{member.contactInfo.address || 'N/A'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <CalendarDaysIcon className="w-4 h-4 text-gray-500" />
                        <span className="text-sm">{member.dob} - {member.birthPlace}</span>
                      </div>
                    </div>
                    <div className="mt-4 flex gap-2">
                      <button className="btn btn-sm btn-outline">Edit</button>
                      {member.contactInfo.email && member.contactInfo.email !== 'N/A' && (
                        <button className="btn btn-sm btn-primary">Email</button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeDetailTab === 'documents' && (
          <div className="space-y-6">
            {caseData.familyMembers.map((member: any) => (
              <div key={member.id} className="bg-white rounded-3xl p-6 shadow-lg border border-gray-200">
                <div>
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-lg font-bold">{member.name} - Documents</h3>
                    <div className="flex gap-2">
                      {member.isPersecuted && <span className="badge badge-error">Persecuted</span>}
                      {member.isMainApplicant && <span className="badge badge-primary">Main Applicant</span>}
                    </div>
                  </div>
                  
                  {/* Document Status Grid */}
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
                    {Object.entries(member.docs).map(([docType, hasDoc]: [string, any]) => (
                      <div key={docType} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <span className="capitalize text-sm font-medium">{docType}</span>
                        <span className={`badge badge-sm ${hasDoc ? 'badge-success' : 'badge-error'}`}>
                          {hasDoc ? '✓' : '✗'}
                        </span>
                      </div>
                    ))}
                  </div>
                  
                  {/* Drag and Drop Upload */}
                  <div
                    className={`border-2 border-dashed rounded-lg p-6 text-center transition-all duration-200 ${
                      dragActive[member.id] ? 'border-blue-500 bg-blue-50' : 'border-gray-300'
                    }`}
                    onDragOver={(e) => handleDragOver(e, member.id)}
                    onDragLeave={(e) => handleDragLeave(e, member.id)}
                    onDrop={(e) => handleDrop(e, member.id)}
                  >
                    <DocumentArrowUpIcon className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                    <p className="text-sm text-gray-600 mb-2">Drag and drop documents for {member.name}</p>
                    <p className="text-xs text-gray-500">or click to browse</p>
                    <input type="file" multiple className="hidden" />
                    <button className="btn btn-outline btn-sm mt-3">Choose Files</button>
                  </div>
                  
                  {/* Uploaded Files */}
                  {uploadedFiles[member.id] && uploadedFiles[member.id].length > 0 && (
                    <div className="mt-4">
                      <h4 className="font-semibold mb-2">Uploaded Files:</h4>
                      <div className="space-y-2">
                        {uploadedFiles[member.id].map((file: any, idx: number) => (
                          <div key={idx} className="flex items-center justify-between p-2 bg-green-50 rounded">
                            <span className="text-sm font-medium">{file.name}</span>
                            <span className="badge badge-success badge-sm">New</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {activeDetailTab === 'tasks' && (
          <div className="space-y-6">
            {/* Task Summary */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {[
                { label: 'Total Tasks', count: 12, color: 'bg-blue-500' },
                { label: 'In Progress', count: 5, color: 'bg-yellow-500' },
                { label: 'Completed', count: 6, color: 'bg-green-500' },
                { label: 'Overdue', count: 1, color: 'bg-red-500' },
              ].map((stat, idx) => (
                <div key={idx} className="text-center p-4 bg-white rounded-2xl shadow border">
                  <div className={`w-12 h-12 ${stat.color} rounded-full flex items-center justify-center mx-auto mb-2`}>
                    <span className="text-xl font-bold text-white">{stat.count}</span>
                  </div>
                  <div className="text-sm font-semibold text-gray-700">{stat.label}</div>
                </div>
              ))}
            </div>

            {/* Case Tasks */}
            <div className="bg-white rounded-3xl p-6 shadow-lg border border-gray-200">
              <div>
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-xl font-bold">Case Tasks</h3>
                  <button className="btn btn-primary gap-2">
                    <PlusIcon className="w-4 h-4" />
                    Add Task
              </button>
                </div>
                <div className="space-y-4">
                  {[
                    { id: 1, title: 'Request birth certificate from Friedrich Müller archives', assignee: 'Sarah Müller', dueDate: '2024-07-15', priority: 'High', status: 'In Progress', familyMember: 'Friedrich Müller' },
                    { id: 2, title: 'Translate Heinrich Müller death certificate', assignee: 'Case Manager', dueDate: '2024-07-18', priority: 'Medium', status: 'Pending', familyMember: 'Heinrich Müller' },
                    { id: 3, title: 'Obtain police certificate for Klaus Müller', assignee: 'Klaus Müller', dueDate: '2024-07-20', priority: 'High', status: 'In Progress', familyMember: 'Klaus Müller' },
                    { id: 4, title: 'Schedule consultation with persecution expert', assignee: 'Case Manager', dueDate: '2024-07-12', priority: 'High', status: 'Overdue', familyMember: 'All' },
                    { id: 5, title: 'Review Sarah\'s educational documents', assignee: 'Case Manager', dueDate: '2024-07-25', priority: 'Low', status: 'Pending', familyMember: 'Sarah Müller' },
                    { id: 6, title: 'Submit preliminary application to German consulate', assignee: 'Case Manager', dueDate: '2024-08-01', priority: 'High', status: 'Pending', familyMember: 'All' },
                  ].map((task) => (
                    <div key={task.id} className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <input type="checkbox" className="checkbox checkbox-primary" />
                            <h4 className="font-semibold text-gray-900">{task.title}</h4>
                            <span className={`badge badge-sm ${
                              task.priority === 'High' ? 'badge-error' :
                              task.priority === 'Medium' ? 'badge-warning' : 'badge-info'
                            }`}>
                              {task.priority}
                            </span>
                          </div>
                          <div className="flex items-center gap-4 text-sm text-gray-600">
                            <span>Assignee: {task.assignee}</span>
                            <span>Due: {task.dueDate}</span>
                            <span>Family: {task.familyMember}</span>
                          </div>
                          <div className="mt-2">
                            <span className={`badge ${
                              task.status === 'Completed' ? 'badge-success' :
                              task.status === 'In Progress' ? 'badge-warning' :
                              task.status === 'Overdue' ? 'badge-error' : 'badge-info'
                            }`}>
                              {task.status}
                            </span>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button className="btn btn-xs btn-outline">Edit</button>
                          <button className="btn btn-xs btn-primary">View</button>
                        </div>
                      </div>
                    </div>
            ))}
          </div>
        </div>
            </div>
          </div>
        )}

        {activeDetailTab === 'timeline' && (
          <div className="space-y-6">
            <div className="bg-white rounded-3xl p-6 shadow-lg border border-gray-200">
              <div>
                <h3 className="text-xl font-bold mb-6">Case Timeline</h3>
                <div className="relative">
                  {/* Timeline line */}
                  <div className="absolute left-8 top-0 bottom-0 w-0.5 bg-gray-300"></div>
                  
                  <div className="space-y-8">
                    {[
                      { date: '2024-07-10', time: '14:30', title: 'Friedrich Müller persecution evidence verified', description: 'Historical documents confirmed with Yad Vashem database', type: 'success', icon: '✓' },
                      { date: '2024-07-09', time: '10:15', title: 'Sarah Müller police certificate uploaded', description: 'Clean criminal record certificate from NYC authorities', type: 'success', icon: '📄' },
                      { date: '2024-07-08', time: '16:45', title: 'Family tree structure confirmed', description: 'All family relationships verified and documented', type: 'info', icon: '👥' },
                      { date: '2024-07-05', time: '09:00', title: 'Initial consultation completed', description: 'Case eligibility confirmed under Section 116', type: 'info', icon: '💬' },
                      { date: '2024-07-01', time: '11:30', title: 'Heinrich Müller death certificate received', description: 'Official document obtained from Berlin civil registry', type: 'success', icon: '📋' },
                      { date: '2024-06-28', time: '15:20', title: 'Klaus Müller contact information updated', description: 'Current address and phone number verified', type: 'info', icon: '📞' },
                      { date: '2024-06-15', time: '13:00', title: 'Case opened', description: 'Initial application for German citizenship by descent', type: 'info', icon: '🏁' },
                    ].map((event, idx) => (
                      <div key={idx} className="relative flex items-start gap-4">
                        {/* Timeline dot */}
                        <div className={`flex items-center justify-center w-16 h-16 rounded-full border-4 border-white shadow-lg ${
                          event.type === 'success' ? 'bg-green-500' :
                          event.type === 'warning' ? 'bg-yellow-500' :
                          event.type === 'error' ? 'bg-red-500' : 'bg-blue-500'
                        }`}>
                          <span className="text-2xl">{event.icon}</span>
                        </div>
                        
                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="bg-gray-50 rounded-lg p-4">
                            <div className="flex items-center justify-between mb-2">
                              <h4 className="font-semibold text-gray-900">{event.title}</h4>
                              <div className="text-sm text-gray-500">
                                {event.date} at {event.time}
                              </div>
                            </div>
                            <p className="text-gray-700">{event.description}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      
      {/* Family Member Details Modal */}
      {selectedFamilyMember && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/30" onClick={() => setSelectedFamilyMember(null)} />
          <div className="bg-white rounded-2xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto z-50 shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-bold">{selectedFamilyMember.name}</h3>
              <button 
                onClick={() => setSelectedFamilyMember(null)}
                className="btn btn-ghost btn-circle"
              >
                <XCircleIcon className="w-6 h-6" />
              </button>
            </div>
            
            <div className="space-y-6">
              {/* Basic Info */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-sm text-gray-600">Relationship:</span>
                  <div className="font-semibold">{selectedFamilyMember.relationship}</div>
                </div>
                <div>
                  <span className="text-sm text-gray-600">Birth Date:</span>
                  <div className="font-semibold">{selectedFamilyMember.dob}</div>
                </div>
                <div>
                  <span className="text-sm text-gray-600">Birth Place:</span>
                  <div className="font-semibold">{selectedFamilyMember.birthPlace}</div>
                </div>
                <div>
                  <span className="text-sm text-gray-600">ID Number:</span>
                  <div className="font-semibold">{selectedFamilyMember.idNumber}</div>
                </div>
              </div>
              
              {/* Contact Info */}
              <div>
                <h4 className="font-semibold mb-3">Contact Information</h4>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <EnvelopeIcon className="w-4 h-4 text-gray-500" />
                    <span>{selectedFamilyMember.contactInfo.email || 'N/A'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <PhoneIcon className="w-4 h-4 text-gray-500" />
                    <span>{selectedFamilyMember.contactInfo.phone || 'N/A'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <MapPinIcon className="w-4 h-4 text-gray-500" />
                    <span>{selectedFamilyMember.contactInfo.address || 'N/A'}</span>
                  </div>
                </div>
              </div>
              
              {/* Persecution Details */}
              {selectedFamilyMember.isPersecuted && selectedFamilyMember.persecutionDetails && (
                <div>
                  <h4 className="font-semibold mb-3 text-red-600">Persecution Details</h4>
                  <div className="space-y-2 p-4 bg-red-50 rounded-lg">
                    <div>
                      <span className="text-sm text-gray-600">Reason:</span>
                      <div className="font-semibold">{selectedFamilyMember.persecutionDetails.reason}</div>
                    </div>
                    <div>
                      <span className="text-sm text-gray-600">Date:</span>
                      <div className="font-semibold">{selectedFamilyMember.persecutionDetails.dateOfPersecution}</div>
                    </div>
                    <div>
                      <span className="text-sm text-gray-600">Location:</span>
                      <div className="font-semibold">{selectedFamilyMember.persecutionDetails.location}</div>
                    </div>
                    <div>
                      <span className="text-sm text-gray-600">Evidence:</span>
                      <div className="font-semibold">{selectedFamilyMember.persecutionDetails.evidence}</div>
                    </div>
                  </div>
                </div>
              )}
              
              {/* Documents */}
              <div>
                <h4 className="font-semibold mb-3">Documents Status</h4>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(selectedFamilyMember.docs).map(([docType, hasDoc]: [string, any]) => (
                    <div key={docType} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                      <span className="capitalize">{docType}</span>
                      <span className={`badge badge-sm ${hasDoc ? 'badge-success' : 'badge-error'}`}>
                        {hasDoc ? 'Available' : 'Missing'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

// Case Manager Dashboard with gradient boxes
const DashboardContent = () => {
  return (
    <div className="space-y-8">
      {/* Summary Cards with Gradients */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
        {/* Active Cases */}
        <div className="rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl shadow-xl bg-blue-600 text-white relative overflow-hidden p-4 md:p-6">
          <div className="flex items-center gap-2 md:gap-4">
            <div className="flex items-center justify-center w-10 h-10 md:w-14 md:h-14 rounded-full bg-white/20 shadow">
              <FolderIcon className="w-5 h-5 md:w-7 md:h-7 text-white opacity-90" />
            </div>
            <div>
              <div className="text-2xl md:text-4xl font-extrabold text-white leading-tight">24</div>
              <div className="text-white/80 text-xs md:text-sm font-medium mt-1">Active Cases</div>
            </div>
          </div>
        </div>

        {/* Pending Documents */}
        <div className="rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl shadow-xl bg-blue-600 text-white relative overflow-hidden p-4 md:p-6">
          <div className="flex items-center gap-2 md:gap-4">
            <div className="flex items-center justify-center w-10 h-10 md:w-14 md:h-14 rounded-full bg-white/20 shadow">
              <InboxArrowDownIcon className="w-5 h-5 md:w-7 md:h-7 text-white opacity-90" />
            </div>
            <div>
              <div className="text-2xl md:text-4xl font-extrabold text-white leading-tight">12</div>
              <div className="text-white/80 text-xs md:text-sm font-medium mt-1">Pending Docs</div>
            </div>
          </div>
        </div>

        {/* Urgent Tasks */}
        <div className="rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl shadow-xl bg-blue-600 text-white relative overflow-hidden p-4 md:p-6">
          <div className="flex items-center gap-2 md:gap-4">
            <div className="flex items-center justify-center w-10 h-10 md:w-14 md:h-14 rounded-full bg-white/20 shadow">
              <ExclamationTriangleIcon className="w-5 h-5 md:w-7 md:h-7 text-white opacity-90" />
            </div>
            <div>
              <div className="text-2xl md:text-4xl font-extrabold text-white leading-tight">7</div>
              <div className="text-white/80 text-xs md:text-sm font-medium mt-1">Urgent Tasks</div>
            </div>
          </div>
        </div>

        {/* Ready to Submit */}
        <div className="rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl shadow-xl bg-blue-600 text-white relative overflow-hidden p-4 md:p-6">
          <div className="flex items-center gap-2 md:gap-4">
            <div className="flex items-center justify-center w-10 h-10 md:w-14 md:h-14 rounded-full bg-white/20 shadow">
              <DocumentArrowUpIcon className="w-5 h-5 md:w-7 md:h-7 text-white opacity-90" />
            </div>
            <div>
              <div className="text-2xl md:text-4xl font-extrabold text-white leading-tight">5</div>
              <div className="text-white/80 text-xs md:text-sm font-medium mt-1">Ready to Submit</div>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Search Bar */}
      <div className="w-full">
        <div className="relative max-w-2xl mx-auto">
          <MagnifyingGlassIcon className="absolute left-4 top-1/2 transform -translate-y-1/2 w-6 h-6 text-gray-400" />
          <input
            type="text"
            placeholder="Search cases, clients, or documents..."
            className="input input-bordered w-full pl-12 pr-4 py-4 text-lg rounded-2xl shadow-lg border-2 border-gray-200 focus:border-primary focus:shadow-xl transition-all"
          />
          <button className="absolute right-2 top-1/2 transform -translate-y-1/2 btn btn-primary btn-sm rounded-xl">
            Search
          </button>
        </div>
      </div>

      {/* Recent Activity & Urgent Items */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Recent Activity */}
        <div className="bg-white rounded-3xl p-6 shadow-lg border border-gray-200">
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-blue-600 shadow">
                <ClockIcon className="w-6 h-6 text-white" />
              </div>
              <span className="text-xl font-bold text-gray-900">Recent Activity</span>
            </div>
            <div className="space-y-4">
              {[
                { client: 'Maria Schmidt', action: 'Documents received', time: '10 min ago', type: 'success' },
                { client: 'Hans Weber', action: 'Application submitted to Germany', time: '1 hour ago', type: 'info' },
                { client: 'Anna Müller', action: 'Missing birth certificate', time: '2 hours ago', type: 'warning' },
                { client: 'Klaus Fischer', action: 'Meeting scheduled', time: '3 hours ago', type: 'info' },
              ].map((activity, idx) => (
                <div key={idx} className="flex items-center gap-4 p-3 hover:bg-gray-50 rounded-lg transition-colors">
                  <div className={`w-3 h-3 rounded-full ${
                    activity.type === 'success' ? 'bg-green-500' :
                    activity.type === 'warning' ? 'bg-yellow-500' : 'bg-blue-500'
                  }`}></div>
                  <div className="flex-1">
                    <div className="font-semibold text-gray-900">{activity.client}</div>
                    <div className="text-sm text-gray-600">{activity.action}</div>
                  </div>
                  <div className="text-xs text-gray-500">{activity.time}</div>
                </div>
              ))}
            </div>
            <div className="text-center mt-6">
              <button className="btn btn-outline btn-primary">View All Activity</button>
            </div>
          </div>
        </div>

        {/* Urgent Items */}
        <div className="bg-white rounded-3xl p-6 shadow-lg border border-gray-200">
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-blue-600 shadow">
                <ExclamationTriangleIcon className="w-6 h-6 text-white" />
              </div>
              <span className="text-xl font-bold text-gray-900">Urgent Items</span>
            </div>
            <div className="space-y-4">
              {[
                { title: 'Birth Certificate Due', client: 'Sarah Müller', due: 'Today', priority: 'high' },
                { title: 'Police Certificate Expiring', client: 'Michael Weber', due: 'Tomorrow', priority: 'high' },
                { title: 'Application Review', client: 'Lisa Schmidt', due: '2 days', priority: 'medium' },
                { title: 'Client Meeting Prep', client: 'Thomas Koch', due: '3 days', priority: 'medium' },
              ].map((item, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                  <div className="flex-1">
                    <div className="font-semibold text-gray-900">{item.title}</div>
                    <div className="text-sm text-gray-600">{item.client}</div>
                  </div>
                  <div className="text-right">
                    <div className={`text-sm font-bold ${item.priority === 'high' ? 'text-red-600' : 'text-orange-600'}`}>
                      Due: {item.due}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="text-center mt-6">
              <button className="btn btn-error">Manage Urgent Items</button>
            </div>
          </div>
        </div>
      </div>

      {/* Application Status Overview */}
      <div className="bg-white rounded-3xl p-6 shadow-lg border border-gray-200">
        <div>
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-blue-600 shadow">
                <ChartBarIcon className="w-6 h-6 text-white" />
              </div>
              <span className="text-xl font-bold text-gray-900">Application Status Overview</span>
            </div>
            <button className="btn btn-outline btn-sm">View Details</button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {[
              { stage: 'Documents Gathering', count: 8, color: 'bg-blue-500' },
              { stage: 'Documents Review', count: 5, color: 'bg-yellow-500' },
              { stage: 'Application Prep', count: 3, color: 'bg-orange-500' },
              { stage: 'Submitted', count: 6, color: 'bg-green-500' },
              { stage: 'Approved', count: 2, color: 'bg-purple-500' },
            ].map((stage, idx) => (
              <div key={idx} className="text-center p-4 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors">
                <div className={`w-16 h-16 ${stage.color} rounded-full flex items-center justify-center mx-auto mb-3`}>
                  <span className="text-2xl font-bold text-white">{stage.count}</span>
                </div>
                <div className="text-sm font-semibold text-gray-700">{stage.stage}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// Cases Management Tab
const CasesContent = ({ onViewCase }: { onViewCase: (caseId: string) => void }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  
  const mockCases = [
    { id: 'C-2024-001', client: 'Sarah Müller', country: 'Germany', stage: 'Document Review', priority: 'High', lastUpdate: '2 hours ago', progress: 65 },
    { id: 'C-2024-002', client: 'Michael Weber', country: 'Austria', stage: 'Application Prep', priority: 'Medium', lastUpdate: '1 day ago', progress: 80 },
    { id: 'C-2024-003', client: 'Anna Schmidt', country: 'Germany', stage: 'Documents Gathering', priority: 'Low', lastUpdate: '3 days ago', progress: 30 },
    { id: 'C-2024-004', client: 'Klaus Fischer', country: 'Austria', stage: 'Submitted', priority: 'High', lastUpdate: '5 days ago', progress: 90 },
  ];

  return (
    <div className="space-y-6">
      {/* Search and Filters */}
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search cases..."
            className="input input-bordered w-full pl-10"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <select className="select select-bordered" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="all">All Cases</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="urgent">Urgent</option>
          </select>
          <button className="btn btn-primary gap-2">
            <PlusIcon className="w-4 h-4" />
            New Case
          </button>
        </div>
      </div>

      {/* Cases Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        {mockCases.map((case_) => (
          <div key={case_.id} className="bg-white rounded-2xl p-6 shadow-lg border border-gray-200">
            <div className="h-full">
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-bold text-primary">{case_.id}</span>
                <span className={`badge ${case_.priority === 'High' ? 'badge-error' : case_.priority === 'Medium' ? 'badge-warning' : 'badge-info'}`}>
                  {case_.priority}
                </span>
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">{case_.client}</h3>
              <div className="space-y-2 mb-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">Country:</span>
                  <span className="text-sm font-semibold">{case_.country}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">Stage:</span>
                  <span className="text-sm font-semibold text-blue-600">{case_.stage}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">Last Update:</span>
                  <span className="text-sm">{case_.lastUpdate}</span>
                </div>
              </div>
              <div className="mb-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-600">Progress</span>
                  <span className="text-xs font-bold">{case_.progress}%</span>
                </div>
                <progress className="progress progress-primary w-full" value={case_.progress} max="100"></progress>
              </div>
              <div className="flex gap-2">
                <button 
                  className="btn btn-sm btn-primary flex-1"
                  onClick={() => onViewCase(case_.id)}
                >
                  View
                </button>
                <button className="btn btn-sm btn-outline">Edit</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// Documents Management Tab
const DocumentsContent = () => {
  const [selectedCategory, setSelectedCategory] = useState('all');
  
  const mockDocuments = [
    { id: 1, name: 'Birth Certificate - Sarah Müller', type: 'Birth Certificate', client: 'Sarah Müller', status: 'Received', uploadDate: '2024-07-10', expiry: '2025-07-10' },
    { id: 2, name: 'Police Certificate - Michael Weber', type: 'Police Certificate', client: 'Michael Weber', status: 'Pending', uploadDate: '2024-07-08', expiry: '2024-12-08' },
    { id: 3, name: 'Marriage Certificate - Anna Schmidt', type: 'Marriage Certificate', client: 'Anna Schmidt', status: 'Missing', uploadDate: null, expiry: null },
    { id: 4, name: 'Passport Copy - Klaus Fischer', type: 'Identity Document', client: 'Klaus Fischer', status: 'Received', uploadDate: '2024-07-05', expiry: '2026-03-15' },
  ];

  return (
    <div className="space-y-6">
      {/* Document Categories and Upload */}
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="flex gap-2 flex-wrap">
          {['all', 'Birth Certificate', 'Police Certificate', 'Marriage Certificate', 'Identity Document'].map((category) => (
            <button
              key={category}
              className={`btn btn-sm ${selectedCategory === category ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setSelectedCategory(category)}
            >
              {category.charAt(0).toUpperCase() + category.slice(1)}
            </button>
          ))}
        </div>
        <button className="btn btn-primary gap-2">
          <DocumentArrowUpIcon className="w-4 h-4" />
          Upload Document
        </button>
      </div>

      {/* Documents Table */}
      <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-200">
        <div>
          <div className="overflow-x-auto">
            <table className="table w-full">
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Client</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Upload Date</th>
                  <th>Expiry</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {mockDocuments.map((doc) => (
                  <tr key={doc.id} className="hover:bg-gray-50">
                    <td className="font-semibold">{doc.name}</td>
                    <td>{doc.client}</td>
                    <td>
                      <span className="badge badge-outline">{doc.type}</span>
                    </td>
                    <td>
                      <span className={`badge ${
                        doc.status === 'Received' ? 'badge-success' :
                        doc.status === 'Pending' ? 'badge-warning' : 'badge-error'
                      }`}>
                        {doc.status}
                      </span>
                    </td>
                    <td>{doc.uploadDate || 'N/A'}</td>
                    <td>{doc.expiry || 'N/A'}</td>
                    <td>
                      <div className="flex gap-1">
                        <button className="btn btn-xs btn-outline">
                          <EyeIcon className="w-3 h-3" />
                        </button>
                        <button className="btn btn-xs btn-outline">
                          <PencilIcon className="w-3 h-3" />
                        </button>
                        <button className="btn btn-xs btn-outline btn-error">
                          <TrashIcon className="w-3 h-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

// Tasks Management Tab
const TasksContent = () => {
  const mockTasks = [
    { id: 1, title: 'Review birth certificate for Sarah Müller', client: 'Sarah Müller', dueDate: '2024-07-12', priority: 'High', status: 'In Progress' },
    { id: 2, title: 'Request police certificate from Michael Weber', client: 'Michael Weber', dueDate: '2024-07-15', priority: 'Medium', status: 'Pending' },
    { id: 3, title: 'Schedule consultation with Anna Schmidt', client: 'Anna Schmidt', dueDate: '2024-07-18', priority: 'Low', status: 'Completed' },
    { id: 4, title: 'Submit application for Klaus Fischer', client: 'Klaus Fischer', dueDate: '2024-07-20', priority: 'High', status: 'Pending' },
  ];

  return (
    <div className="space-y-6">
      {/* Task Controls */}
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="flex gap-2">
          <button className="btn btn-primary gap-2">
            <PlusIcon className="w-4 h-4" />
            New Task
          </button>
          <button className="btn btn-outline gap-2">
            <CalendarIcon className="w-4 h-4" />
            Calendar View
          </button>
        </div>
        <div className="flex gap-2">
          <select className="select select-bordered">
            <option>All Tasks</option>
            <option>High Priority</option>
            <option>Due Today</option>
            <option>Overdue</option>
          </select>
        </div>
      </div>

      {/* Tasks List */}
      <div className="space-y-4">
        {mockTasks.map((task) => (
          <div key={task.id} className="bg-white rounded-2xl p-6 shadow-lg border border-gray-200">
            <div>
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <input type="checkbox" className="checkbox checkbox-primary" />
                    <h3 className="text-lg font-semibold text-gray-900">{task.title}</h3>
                    <span className={`badge ${
                      task.priority === 'High' ? 'badge-error' :
                      task.priority === 'Medium' ? 'badge-warning' : 'badge-info'
                    }`}>
                      {task.priority}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-gray-600">
                    <span>Client: {task.client}</span>
                    <span>Due: {task.dueDate}</span>
                    <span className={`font-semibold ${
                      task.status === 'Completed' ? 'text-green-600' :
                      task.status === 'In Progress' ? 'text-blue-600' : 'text-gray-600'
                    }`}>
                      {task.status}
                    </span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button className="btn btn-sm btn-outline">Edit</button>
                  <button className="btn btn-sm btn-primary">View</button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// Communications Tab
const CommunicationsContent = () => {
  const [selectedTab, setSelectedTab] = useState('messages');
  
  const mockMessages = [
    { id: 1, from: 'Sarah Müller', subject: 'Documents uploaded', time: '2 hours ago', status: 'unread' },
    { id: 2, from: 'Michael Weber', subject: 'Question about application', time: '1 day ago', status: 'read' },
    { id: 3, from: 'Anna Schmidt', subject: 'Meeting confirmation', time: '2 days ago', status: 'replied' },
  ];

  return (
    <div className="space-y-6">
      {/* Communication Tabs */}
      <div className="tabs tabs-lifted">
        <button 
          className={`tab ${selectedTab === 'messages' ? 'tab-active' : ''}`}
          onClick={() => setSelectedTab('messages')}
        >
          Messages
        </button>
        <button 
          className={`tab ${selectedTab === 'emails' ? 'tab-active' : ''}`}
          onClick={() => setSelectedTab('emails')}
        >
          Email Templates
        </button>
        <button 
          className={`tab ${selectedTab === 'reminders' ? 'tab-active' : ''}`}
          onClick={() => setSelectedTab('reminders')}
        >
          Reminders
        </button>
      </div>

      {selectedTab === 'messages' && (
        <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-200">
          <div>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold">Client Messages</h3>
              <button className="btn btn-primary gap-2">
                <PaperAirplaneIcon className="w-4 h-4" />
                Compose
              </button>
            </div>
            <div className="space-y-4">
              {mockMessages.map((message) => (
                <div key={message.id} className="flex items-center gap-4 p-4 border border-gray-200 rounded-lg hover:bg-gray-50">
                  <div className={`w-3 h-3 rounded-full ${
                    message.status === 'unread' ? 'bg-blue-500' :
                    message.status === 'replied' ? 'bg-green-500' : 'bg-gray-300'
                  }`}></div>
                  <div className="flex-1">
                    <div className="font-semibold text-gray-900">{message.from}</div>
                    <div className="text-sm text-gray-600">{message.subject}</div>
                  </div>
                  <div className="text-sm text-gray-500">{message.time}</div>
                  <button className="btn btn-sm btn-outline">Reply</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {selectedTab === 'emails' && (
        <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-200">
          <div>
            <h3 className="text-xl font-bold mb-6">Email Templates</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                'Document Request',
                'Application Status Update',
                'Meeting Confirmation',
                'Missing Document Reminder',
                'Application Approved',
                'Next Steps Instruction'
              ].map((template, idx) => (
                <div key={idx} className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 cursor-pointer">
                  <h4 className="font-semibold text-gray-900 mb-2">{template}</h4>
                  <p className="text-sm text-gray-600 mb-4">Template for {template.toLowerCase()}</p>
                  <div className="flex gap-2">
                    <button className="btn btn-xs btn-outline">Edit</button>
                    <button className="btn btn-xs btn-primary">Use</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {selectedTab === 'reminders' && (
        <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-200">
          <div>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold">Automated Reminders</h3>
              <button className="btn btn-primary gap-2">
                <BellIcon className="w-4 h-4" />
                New Reminder
              </button>
            </div>
            <div className="space-y-4">
              {[
                { client: 'Sarah Müller', type: 'Document deadline', date: '2024-07-15', active: true },
                { client: 'Michael Weber', type: 'Meeting reminder', date: '2024-07-18', active: true },
                { client: 'Anna Schmidt', type: 'Follow-up call', date: '2024-07-20', active: false },
              ].map((reminder, idx) => (
                <div key={idx} className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
                  <div>
                    <div className="font-semibold text-gray-900">{reminder.client}</div>
                    <div className="text-sm text-gray-600">{reminder.type} - {reminder.date}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input 
                      type="checkbox" 
                      className="toggle toggle-primary" 
                      checked={reminder.active}
                      readOnly
                    />
                    <button className="btn btn-sm btn-outline">Edit</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Applications Status Tab
const ApplicationsContent = () => {
  const mockApplications = [
    { id: 'APP-2024-001', client: 'Sarah Müller', country: 'Germany', stage: 'Under Review', submittedDate: '2024-06-15', estimatedCompletion: '2024-09-15' },
    { id: 'APP-2024-002', client: 'Michael Weber', country: 'Austria', stage: 'Approved', submittedDate: '2024-05-20', estimatedCompletion: '2024-07-20' },
    { id: 'APP-2024-003', client: 'Anna Schmidt', country: 'Germany', stage: 'Documents Required', submittedDate: '2024-07-01', estimatedCompletion: '2024-10-01' },
  ];

  return (
    <div className="space-y-6">
      {/* Application Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Applications', count: 15, color: 'bg-blue-500' },
          { label: 'Under Review', count: 6, color: 'bg-yellow-500' },
          { label: 'Approved', count: 7, color: 'bg-green-500' },
          { label: 'Rejected', count: 2, color: 'bg-red-500' },
        ].map((stat, idx) => (
          <div key={idx} className="text-center p-6 bg-white rounded-2xl shadow-lg border">
            <div className={`w-16 h-16 ${stat.color} rounded-full flex items-center justify-center mx-auto mb-3`}>
              <span className="text-2xl font-bold text-white">{stat.count}</span>
            </div>
            <div className="text-sm font-semibold text-gray-700">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Applications Table */}
      <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-200">
        <div>
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xl font-bold">Applications Status</h3>
            <button className="btn btn-primary gap-2">
              <ArrowPathIcon className="w-4 h-4" />
              Refresh Status
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="table w-full">
              <thead>
                <tr>
                  <th>Application ID</th>
                  <th>Client</th>
                  <th>Country</th>
                  <th>Stage</th>
                  <th>Submitted</th>
                  <th>Est. Completion</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {mockApplications.map((app) => (
                  <tr key={app.id} className="hover:bg-gray-50">
                    <td className="font-semibold text-primary">{app.id}</td>
                    <td>{app.client}</td>
                    <td>
                      <span className="badge badge-outline">{app.country}</span>
                    </td>
                    <td>
                      <span className={`badge ${
                        app.stage === 'Approved' ? 'badge-success' :
                        app.stage === 'Under Review' ? 'badge-warning' : 'badge-error'
                      }`}>
                        {app.stage}
                      </span>
                    </td>
                    <td>{app.submittedDate}</td>
                    <td>{app.estimatedCompletion}</td>
                    <td>
                      <div className="flex gap-1">
                        <button className="btn btn-xs btn-outline">Track</button>
                        <button className="btn btn-xs btn-primary">Details</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

// Clients Management Tab
const ClientsContent = () => {
  const mockClients = [
    { id: 1, name: 'Sarah Müller', email: 'sarah.mueller@email.com', phone: '+49 123 456789', country: 'Germany', status: 'Active', lastContact: '2 days ago' },
    { id: 2, name: 'Michael Weber', email: 'michael.weber@email.com', phone: '+43 987 654321', country: 'Austria', status: 'Active', lastContact: '1 week ago' },
    { id: 3, name: 'Anna Schmidt', email: 'anna.schmidt@email.com', phone: '+49 555 666777', country: 'Germany', status: 'Inactive', lastContact: '2 weeks ago' },
  ];

  return (
    <div className="space-y-6">
      {/* Client Controls */}
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search clients..."
            className="input input-bordered w-full pl-10"
          />
        </div>
        <div className="flex gap-2">
          <button className="btn btn-outline gap-2">
            <FunnelIcon className="w-4 h-4" />
            Filter
          </button>
          <button className="btn btn-primary gap-2">
            <UserPlusIcon className="w-4 h-4" />
            Add Client
          </button>
        </div>
      </div>

      {/* Clients Table */}
      <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-200">
        <div>
          <div className="overflow-x-auto">
            <table className="table w-full">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Contact</th>
                  <th>Country</th>
                  <th>Status</th>
                  <th>Last Contact</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {mockClients.map((client) => (
                  <tr key={client.id} className="hover:bg-gray-50">
                    <td>
                      <div className="flex items-center gap-3">
                        <div className="avatar placeholder">
                          <div className="bg-primary text-primary-content rounded-full w-12 h-12">
                            <span className="text-lg">{client.name.charAt(0)}</span>
                          </div>
                        </div>
                        <div>
                          <div className="font-bold">{client.name}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="text-sm">
                        <div>{client.email}</div>
                        <div className="text-gray-600">{client.phone}</div>
                      </div>
                    </td>
                    <td>
                      <span className="badge badge-outline">{client.country}</span>
                    </td>
                    <td>
                      <span className={`badge ${client.status === 'Active' ? 'badge-success' : 'badge-warning'}`}>
                        {client.status}
                      </span>
                    </td>
                    <td>{client.lastContact}</td>
                    <td>
                      <div className="flex gap-1">
                        <button className="btn btn-xs btn-outline">View</button>
                        <button className="btn btn-xs btn-primary">Edit</button>
                        <button className="btn btn-xs btn-outline">Message</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

const CaseManagerPage: React.FC = () => {
  const [leads, setLeads] = useState<HandlerLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadingLeadId, setUploadingLeadId] = useState<string | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<{ [leadId: string]: UploadedFile[] }>({});
  const [isUploading, setIsUploading] = useState(false);
  const [selectedLead, setSelectedLead] = useState<HandlerLead | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('cases');
  const [taskCount, setTaskCount] = useState(0);
  const [handlerStageStats, setHandlerStageStats] = useState<{stage: string, count: number}[]>([]);
  
  // Dashboard box states
  const [expanded, setExpanded] = useState<'cases' | 'messages' | 'tasks' | 'documents' | null>(null);
  const [newMessages, setNewMessages] = useState<any[]>([]);
  const [tasksDue, setTasksDue] = useState<HandlerTask[]>([]);
  const [documentsPending, setDocumentsPending] = useState<RequiredDocument[]>([]);
  const [showCaseCards, setShowCaseCards] = useState(false);

  // Get priority badge color
  const getPriorityBadgeColor = (priority: string) => {
    switch (priority) {
      case 'low': return 'badge-neutral';
      case 'medium': return 'badge-warning';
      case 'high': return 'badge-error';
      case 'urgent': return 'badge-error badge-outline';
      default: return 'badge-neutral';
    }
  };

  // Fetch real leads from database
  // Fetch task count for badge
  const fetchTaskCount = async () => {
    try {
      const { count, error } = await supabase
        .from('handler_tasks')
        .select('*', { count: 'exact', head: true })
        .neq('status', 'completed');
      
      if (!error && count !== null) {
        setTaskCount(count);
      }
    } catch (err) {
      console.error('Error fetching task count:', err);
    }
  };

  // Fetch handler stage statistics
  const fetchHandlerStageStats = async () => {
    try {
      const { data, error } = await supabase.rpc('get_handler_stage_stats');
      
      if (error) {
        console.error('Error fetching handler stage stats:', error);
      } else if (data) {
        setHandlerStageStats(data);
      }
    } catch (err) {
      console.error('Failed to fetch handler stage stats:', err);
    }
  };

  // Fetch new messages
  const fetchNewMessages = async () => {
    try {
      const { data, error } = await supabase
        .from('communications')
        .select('*')
        .eq('status', 'new')
        .order('created_at', { ascending: false })
        .limit(10);
      
      if (error) {
        console.error('Error fetching new messages:', error);
      } else if (data) {
        setNewMessages(data);
      }
    } catch (err) {
      console.error('Failed to fetch new messages:', err);
    }
  };

  // Fetch tasks due today and tomorrow
  const fetchTasksDue = async () => {
    try {
      const today = new Date();
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const todayStr = today.toISOString().split('T')[0];
      const tomorrowStr = tomorrow.toISOString().split('T')[0];
      
      const { data, error } = await supabase
        .from('handler_tasks')
        .select(`
          *,
          lead:leads(name, lead_number)
        `)
        .in('due_date', [todayStr, tomorrowStr])
        .neq('status', 'completed')
        .order('priority', { ascending: false });
      
      if (error) {
        console.error('Error fetching tasks due:', error);
      } else if (data) {
        console.log('Tasks due fetched:', data);
        setTasksDue(data);
      }
    } catch (err) {
      console.error('Failed to fetch tasks due:', err);
    }
  };

  // Fetch documents pending
  const fetchDocumentsPending = async () => {
    try {
      const today = new Date();
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const todayStr = today.toISOString().split('T')[0];
      const tomorrowStr = tomorrow.toISOString().split('T')[0];
      
      const { data, error } = await supabase
        .from('required_documents')
        .select(`
          *,
          lead:leads(name, lead_number)
        `)
        .in('due_date', [todayStr, tomorrowStr])
        .in('status', ['missing', 'pending'])
        .order('due_date', { ascending: true });
      
      if (error) {
        console.error('Error fetching documents pending:', error);
      } else if (data) {
        setDocumentsPending(data);
      }
    } catch (err) {
      console.error('Failed to fetch documents pending:', err);
    }
  };

  useEffect(() => {
    const fetchLeads = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('leads')
          .select('*')
          .eq('stage', 'handler_assigned')
          .order('created_at', { ascending: false });
        
        if (error) {
          toast.error('Error fetching leads: ' + error.message);
        } else if (data) {
          setLeads(data);
        }
      } catch (err) {
        toast.error('Failed to fetch leads');
        console.error('Error fetching leads:', err);
      } finally {
        setLoading(false);
      }
    };
    
    fetchLeads();
    fetchTaskCount();
    fetchHandlerStageStats();
    fetchNewMessages();
    fetchTasksDue();
    fetchDocumentsPending();
  }, []);

  // Upload files to OneDrive for a specific lead
  const uploadFiles = async (lead: HandlerLead, files: File[]) => {
    setUploadingLeadId(lead.id);
    setIsUploading(true);
    const newUploads = files.map(file => ({ 
      name: file.name, 
      status: 'uploading' as const, 
      progress: 0 
    }));
    
    setUploadedFiles(prev => ({ 
      ...prev, 
      [lead.id]: [...(prev[lead.id] || []), ...newUploads] 
    }));

    for (const file of files) {
      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('leadNumber', lead.lead_number);
        
        const { data, error } = await supabase.functions.invoke('upload-to-onedrive', { 
          body: formData 
        });
        
        if (error) throw new Error(error.message);
        if (!data || !data.success) {
          throw new Error(data.error || 'Upload function returned an error.');
        }
        
        const folderUrl = data.folderUrl;
        if (folderUrl && folderUrl !== lead.onedrive_folder_link) {
          await supabase
            .from('leads')
            .update({ onedrive_folder_link: folderUrl })
            .eq('id', lead.id);
          
          // Update local state
          setLeads(prev => prev.map(l => 
            l.id === lead.id ? { ...l, onedrive_folder_link: folderUrl } : l
          ));
        }
        
        setUploadedFiles(prev => ({
          ...prev,
          [lead.id]: prev[lead.id].map(f => 
            f.name === file.name ? { ...f, status: 'success', progress: 100 } : f
          )
        }));
        
        toast.success(`${file.name} uploaded successfully`);
        
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred';
        setUploadedFiles(prev => ({
          ...prev,
          [lead.id]: prev[lead.id].map(f => 
            f.name === file.name ? { ...f, status: 'error', error: errorMessage } : f
          )
        }));
        toast.error(`Error uploading ${file.name}: ${errorMessage}`);
      }
    }
    
    setIsUploading(false);
    setUploadingLeadId(null);
  };

  const handleFileInput = (lead: HandlerLead, e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      uploadFiles(lead, Array.from(files));
    }
  };

  const refreshLeads = async () => {
    try {
      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .eq('stage', 'handler_assigned')
        .order('created_at', { ascending: false });
      
      if (error) {
        toast.error('Error refreshing leads: ' + error.message);
      } else if (data) {
        setLeads(data);
      }
      
      // Also refresh task count
      await fetchTaskCount();
    } catch (err) {
      toast.error('Failed to refresh leads');
      console.error('Error refreshing leads:', err);
    }
  };

  const renderTabContent = () => {
    // If no case is selected, show dashboard
    if (!selectedLead) {
      return <DashboardTab 
        leads={leads}
        onCaseSelect={setSelectedLead}
        uploadFiles={uploadFiles}
        uploadingLeadId={uploadingLeadId}
        uploadedFiles={uploadedFiles}
        isUploading={isUploading}
        handleFileInput={handleFileInput}
        refreshLeads={refreshLeads}
        showCaseCards={showCaseCards}
        setShowCaseCards={setShowCaseCards}
      />;
    }

    // If a case is selected, show tabs with filtered data
    const singleLeadData = [selectedLead];
    const tabProps = {
      leads: singleLeadData,
      uploadFiles,
      uploadingLeadId,
      uploadedFiles,
      isUploading,
      handleFileInput,
      refreshLeads
    };

    switch (activeTab) {
      case 'cases':
        return <CasesTab {...tabProps} />;
      case 'contacts':
        return <ContactsTab {...tabProps} />;
      case 'documents':
        return <DocumentsTab {...tabProps} />;
      case 'tasks':
        return <TasksTab {...tabProps} />;
      case 'finance':
        return <FinanceTab {...tabProps} />;
      case 'status':
        return <StatusTab {...tabProps} />;
      case 'notes':
        return <NotesTab {...tabProps} />;
      case 'communications':
        return <CommunicationsTab {...tabProps} />;
      default:
        return <CasesTab {...tabProps} />;
    }
  };

  if (loading) {
    return (
      <div className="flex-1 min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="loading loading-spinner loading-lg text-blue-600 mb-4"></div>
          <p className="text-lg text-gray-600">Loading handler-assigned cases...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-screen bg-white">


      {/* Dashboard Boxes */}
      <div className="w-full px-4 md:px-6 pb-4 mt-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Handler Cases Box */}
          <div 
            className="rounded-2xl p-6 shadow-lg cursor-pointer relative overflow-hidden bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white hover:shadow-xl transition-all duration-300 transform hover:scale-105 border border-white/20"
            onClick={() => {
              if (expanded === 'cases') {
                setExpanded(null);
                setShowCaseCards(false);
              } else {
                setExpanded('cases');
                setShowCaseCards(true);
              }
            }}
          >
            <div className="flex items-center justify-between mb-3 relative z-10">
              <div className="p-3 bg-white/20 rounded-full backdrop-blur-sm">
                <UserGroupIcon className="w-6 h-6 text-white" />
              </div>
              <span className="text-3xl font-bold text-white">{leads.length}</span>
            </div>
            <div className="text-lg font-semibold text-white mb-1">Handler Cases</div>
            <div className="text-sm text-white/80">Total cases assigned</div>
            <div className="absolute bottom-2 right-2 w-16 h-16 opacity-10">
              <div className="w-full h-full bg-white/20 rounded-full"></div>
            </div>
          </div>
          
          {/* New Messages Box */}
          <div 
            className="rounded-2xl p-6 shadow-lg cursor-pointer relative overflow-hidden bg-gradient-to-tr from-purple-600 via-blue-600 to-blue-500 text-white hover:shadow-xl transition-all duration-300 transform hover:scale-105 border border-white/20"
            onClick={() => {
              if (expanded === 'messages') {
                setExpanded(null);
              } else {
                setExpanded('messages');
                setShowCaseCards(false);
              }
            }}
          >
            <div className="flex items-center justify-between mb-3 relative z-10">
              <div className="p-3 bg-white/20 rounded-full backdrop-blur-sm">
                <ExclamationTriangleIcon className="w-6 h-6 text-white" />
              </div>
              <span className="text-3xl font-bold text-white">{newMessages.length}</span>
            </div>
            <div className="text-lg font-semibold text-white mb-1">New Messages</div>
            <div className="text-sm text-white/80">Latest client messages</div>
            <div className="absolute bottom-2 right-2 w-16 h-16 opacity-10">
              <div className="w-4 h-4 bg-white/20 rounded-full absolute top-2 left-2"></div>
              <div className="w-3 h-3 bg-white/20 rounded-full absolute top-4 left-6"></div>
              <div className="w-2 h-2 bg-white/20 rounded-full absolute top-6 left-3"></div>
            </div>
          </div>
          
          {/* Tasks Due Box */}
          <div 
            className="rounded-2xl p-6 shadow-lg cursor-pointer relative overflow-hidden bg-gradient-to-tr from-blue-500 via-cyan-500 to-teal-400 text-white hover:shadow-xl transition-all duration-300 transform hover:scale-105 border border-white/20"
            onClick={() => {
              console.log('Tasks due box clicked');
              if (expanded === 'tasks') {
                setExpanded(null);
              } else {
                setExpanded('tasks');
                setShowCaseCards(false);
              }
            }}
          >
            <div className="flex items-center justify-between mb-3 relative z-10">
              <div className="p-3 bg-white/20 rounded-full backdrop-blur-sm">
                <ChatBubbleLeftRightIcon className="w-6 h-6 text-white" />
              </div>
              <span className="text-3xl font-bold text-white">{tasksDue.length}</span>
            </div>
            <div className="text-lg font-semibold text-white mb-1">Tasks Due</div>
            <div className="text-sm text-white/80">Due today & tomorrow</div>
            <div className="absolute bottom-2 right-2 w-16 h-16 opacity-10">
              <div className="w-3 h-3 bg-white/20 rounded-full absolute top-2 left-2"></div>
              <div className="w-2 h-2 bg-white/20 rounded-full absolute top-2 left-6"></div>
              <div className="w-3 h-3 bg-white/20 rounded-full absolute top-6 left-2"></div>
              <div className="w-2 h-2 bg-white/20 rounded-full absolute top-6 left-6"></div>
            </div>
          </div>
          
          {/* Documents Pending Box */}
          <div 
            className="rounded-2xl p-6 shadow-lg cursor-pointer relative overflow-hidden bg-gradient-to-tr from-[#4b2996] via-[#6c4edb] to-[#3b28c7] text-white hover:shadow-xl transition-all duration-300 transform hover:scale-105 border border-white/20"
            onClick={() => {
              if (expanded === 'documents') {
                setExpanded(null);
              } else {
                setExpanded('documents');
                setShowCaseCards(false);
              }
            }}
          >
            <div className="flex items-center justify-between mb-3 relative z-10">
              <div className="p-3 bg-white/20 rounded-full backdrop-blur-sm">
                <ArrowTrendingUpIcon className="w-6 h-6 text-white" />
              </div>
              <span className="text-3xl font-bold text-white">{documentsPending.length}</span>
            </div>
            <div className="text-lg font-semibold text-white mb-1">Documents Pending</div>
            <div className="text-sm text-white/80">Due today & tomorrow</div>
            <div className="absolute bottom-2 right-2 w-16 h-16 opacity-10">
              <div className="w-full h-full bg-white/20 rounded-full"></div>
            </div>
          </div>
        </div>
      </div>



      {expanded === 'messages' && (
        <div className="w-full px-4 md:px-6 pb-4">
          <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-200">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Latest Messages</h3>
            <div className="space-y-3">
              {newMessages.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No new messages
                </div>
              ) : (
                newMessages.map((message, index) => (
                  <div key={index} className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-900">{message.client_name || 'Unknown Client'}</span>
                        {message.lead_number && (
                          <span className="text-sm text-blue-600 font-medium">({message.lead_number})</span>
                        )}
                      </div>
                      <span className="text-sm text-gray-500">
                        {new Date(message.created_at).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </span>
                    </div>
                    <p className="text-gray-700 text-sm">{message.content || 'No content'}</p>
                    <div className="flex gap-2 mt-3">
                      <button className="btn btn-sm btn-primary">Reply</button>
                      <button className="btn btn-sm btn-outline">View Details</button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

            {expanded === 'tasks' && (
        <div className="w-full px-4 md:px-6 pb-4">
          <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-200">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Tasks Due Today & Tomorrow</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {tasksDue.length === 0 ? (
                <div className="col-span-full text-center py-12 text-gray-500">
                  <ClockIcon className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                  <p className="text-lg font-medium mb-1">No tasks due today or tomorrow</p>
                  <p className="text-base">All caught up!</p>
                </div>
              ) : (
                tasksDue.map((task) => (
                  <div 
                    key={task.id} 
                    className="card bg-base-100 shadow-lg hover:shadow-2xl transition-all duration-300 ease-in-out transform hover:-translate-y-1 group cursor-pointer"
                    onClick={() => {
                      // Find the lead for this task
                      const lead = leads.find(l => l.id === task.lead_id);
                      if (lead) {
                        // Set the selected lead and switch to Tasks tab
                        setSelectedLead(lead);
                        setActiveTab('tasks');
                      }
                    }}
                  >
                    <div className="card-body p-5">
                      <div className="flex justify-between items-start mb-2">
                        <h2 className="card-title text-xl font-bold group-hover:text-purple-600 transition-colors">
                          {task.title}
                        </h2>
                      </div>
                      
                      {task.lead && (
                        <p className="text-sm text-base-content/60 font-mono mb-4">
                          {task.lead.name} - #{task.lead.lead_number}
                        </p>
                      )}

                      <div className="divider my-0"></div>

                      {/* First Row: Description and Est. Hours */}
                      <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm mt-4">
                        {task.description && (
                          <div className="flex flex-col gap-1">
                            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Description</span>
                            <p className="text-sm font-medium line-clamp-3">{task.description}</p>
                          </div>
                        )}
                        {task.estimated_hours && (
                          <div className="flex flex-col gap-1">
                            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Est. Hours</span>
                            <span className="text-sm font-medium">{task.estimated_hours}h</span>
                          </div>
                        )}
                      </div>

                      {/* Second Row: Status, Priority, Due Date */}
                      <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm mt-4">
                        <div className="flex flex-col gap-1">
                          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</span>
                          <span className={`badge bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none`}>
                            {task.status.replace('_', ' ')}
                          </span>
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Priority</span>
                          <span className={`badge border-none text-white ${getPriorityBadgeColor(task.priority)}`}>
                            {task.priority}
                          </span>
                        </div>
                        {task.due_date && (
                          <div className="flex flex-col gap-1 col-span-2">
                            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Due Date</span>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">{task.due_date ? new Date(task.due_date).toLocaleDateString() : 'No due date'}</span>
                              {task.due_date && (() => {
                                const today = new Date().toISOString().split('T')[0];
                                const tomorrow = new Date();
                                tomorrow.setDate(tomorrow.getDate() + 1);
                                const tomorrowStr = tomorrow.toISOString().split('T')[0];
                                
                                if (task.due_date === today) {
                                  return <span className="badge badge-sm badge-error text-white">Today</span>;
                                } else if (task.due_date === tomorrowStr) {
                                  return <span className="badge badge-sm badge-warning text-white">Tomorrow</span>;
                                }
                                return null;
                              })()}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {expanded === 'documents' && (
        <div className="w-full px-4 md:px-6 pb-4">
          <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-200">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Documents Due Today & Tomorrow</h3>
            <div className="space-y-3">
              {documentsPending.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No documents due today or tomorrow
                </div>
              ) : (
                documentsPending.map((document) => (
                  <div key={document.id} className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-semibold text-gray-900">{document.document_name}</h4>
                      <span className={`badge ${document.status === 'missing' ? 'badge-error' : 'badge-warning'}`}>
                        {document.status}
                      </span>
                    </div>
                                         <div className="flex items-center justify-between text-sm text-gray-600">
                       <span>Lead: {document.lead?.name || 'Unknown'}</span>
                       <span>Due: {document.due_date ? new Date(document.due_date).toLocaleDateString() : 'No due date'}</span>
                     </div>
                    {document.notes && (
                      <p className="text-gray-700 text-sm mt-2">{document.notes}</p>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Case Details Header (only show when case is selected) */}
      {selectedLead && (
        <div className="px-6 py-4">
          <div className="flex items-center gap-4 bg-white rounded-2xl shadow-lg border border-gray-200 p-4">
            <button
              onClick={() => setSelectedLead(null)}
              className="btn btn-ghost btn-sm"
            >
              <ArrowLeftIcon className="w-4 h-4" />
              Back to Dashboard
            </button>
            <div>
              <h3 className="text-xl font-bold text-gray-900">{selectedLead.name}</h3>
              <p className="text-blue-600 font-medium">Lead #{selectedLead.lead_number}</p>
            </div>
          </div>
        </div>
      )}

      {/* Tabs Navigation - styled like Clients page (only show when case is selected) */}
      {selectedLead && (
        <div className="px-6 py-4">
          <div className="overflow-x-auto scrollbar-hide bg-white rounded-2xl shadow-lg border border-gray-200 p-3 w-full">
            <div className="flex gap-2 pb-1">
              {tabs.map((tab) => {
                const isActive = activeTab === tab.id;
                const badge = tab.id === 'tasks' ? taskCount : tab.badge;
                return (
                  <button
                    key={tab.id}
                    className={`relative flex flex-col items-center justify-center p-3 rounded-xl transition-all duration-300 min-w-[80px] ${
                      isActive
                        ? 'bg-gradient-to-br from-purple-600 to-blue-600 text-white shadow-lg transform scale-105'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                    }`}
                    onClick={() => setActiveTab(tab.id)}
                  >
                    <div className="relative">
                      <tab.icon className={`w-6 h-6 mb-1 ${isActive ? 'text-white' : 'text-gray-500'}`} />
                      {badge && badge > 0 && (
                        <div className={`absolute -top-2 -right-2 w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center ${
                          isActive 
                            ? 'bg-white/20 text-white' 
                            : 'bg-purple-100 text-purple-700'
                        }`}>
                          {badge}
                        </div>
                      )}
                    </div>
                    <span className={`text-xs font-semibold truncate max-w-[70px] ${
                      isActive ? 'text-white' : 'text-gray-600'
                    }`}>
                      {tab.label}
                    </span>
                    {isActive && (
                      <div className="absolute -bottom-1 left-1/2 transform -translate-x-1/2 w-1.5 h-1.5 bg-white rounded-full"></div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

        {/* Tab Content */}
      <div className="w-full bg-white min-h-screen">
        <div className="p-2 sm:p-4 md:p-6 pb-6 md:pb-6 mb-4 md:mb-0">
          {renderTabContent()}
        </div>
      </div>
    </div>
  );
};

export default CaseManagerPage;

// Add custom styles for animations and scrollbar hiding
const styles = `
  .scrollbar-hide {
    -ms-overflow-style: none;
    scrollbar-width: none;
  }
  
  .scrollbar-hide::-webkit-scrollbar {
    display: none;
  }
`;

// Add styles to document head
if (typeof document !== 'undefined') {
  const styleSheet = document.createElement('style');
  styleSheet.textContent = styles;
  document.head.appendChild(styleSheet);
} 