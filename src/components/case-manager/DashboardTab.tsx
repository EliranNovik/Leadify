import React, { useState, useEffect } from 'react';
import { MagnifyingGlassIcon, CalendarIcon, Squares2X2Icon, ListBulletIcon, FolderIcon } from '@heroicons/react/24/outline';
import { supabase } from '../../lib/supabase';

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

interface HandlerTabProps {
  leads: HandlerLead[];
  uploadFiles: (lead: HandlerLead, files: File[]) => Promise<void>;
  uploadingLeadId: string | null;
  uploadedFiles: { [leadId: string]: any[] };
  isUploading: boolean;
  handleFileInput: (lead: HandlerLead, e: React.ChangeEvent<HTMLInputElement>) => void;
  refreshLeads: () => Promise<void>;
}

interface DashboardTabProps extends HandlerTabProps {
  onCaseSelect: (lead: HandlerLead) => void;
  showCaseCards: boolean;
  setShowCaseCards: (show: boolean) => void;
}

const DashboardTab: React.FC<DashboardTabProps> = ({ leads, refreshLeads, onCaseSelect, showCaseCards, setShowCaseCards }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [viewMode, setViewMode] = useState<'cards' | 'list'>(window.innerWidth >= 768 ? 'list' : 'cards');

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

  // Handle responsive view mode
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 768 && viewMode === 'cards') {
        setViewMode('list');
      } else if (window.innerWidth < 768 && viewMode === 'list') {
        setViewMode('cards');
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [viewMode]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        
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
      <div className="p-8 pt-0">
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
          <div className="text-center py-16 px-8">
            <FolderIcon className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <h4 className="text-lg font-medium text-gray-900 mb-2">No Cases Found</h4>
            <p className="text-gray-600">
              {leads.length === 0 ? 'No cases assigned to you yet.' : 'Try adjusting your search or date filters.'}
            </p>
          </div>
        ) : viewMode === 'cards' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 p-8">
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
          <div className="overflow-hidden p-8">
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

export default DashboardTab; 