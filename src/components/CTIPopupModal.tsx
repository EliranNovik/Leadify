import React, { useState, useEffect } from 'react';
import { XMarkIcon, PhoneIcon, UserIcon, BuildingOfficeIcon, LinkIcon, ArrowDownIcon, ArrowUpIcon, ClockIcon } from '@heroicons/react/24/outline';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { getStageName, getStageColour, fetchStageNames } from '../lib/stageUtils';

interface LeadData {
  id: number | string;
  name: string;
  lead_number?: string;
  phone?: string;
  mobile?: string;
  email?: string;
  stage?: string | number;
  stage_name?: string;
  status?: string;
  topic?: string;
  created_at?: string;
  cdate?: string;
  scheduler?: string;
  scheduler_name?: string;
  closer?: string;
  handler?: string;
  source?: string;
  source_name?: string;
  category_display?: string;
  category?: string;
  category_id?: number;
  meeting_manager_id?: number;
  expert_id?: number;
  meeting_lawyer_id?: number;
  case_handler_id?: number;
  meeting_scheduler_id?: number;
  closer_id?: number;
  leadType: 'new' | 'legacy';
}

interface ContactData {
  id: number;
  name: string;
  phone?: string;
  mobile?: string;
  email?: string;
}

interface CallLog {
  id: number;
  cdate: string;
  date?: string;
  time?: string;
  source?: string;
  destination?: string;
  direction?: string;
  status?: string;
  duration?: number;
  url?: string;
  call_id?: string;
  lead_id?: number;
  employee_id?: number;
  employee?: {
    display_name: string;
  };
}

interface CTILookupResponse {
  success: boolean;
  found: boolean;
  phone: string;
  leads?: LeadData[];
  lead?: LeadData; // Legacy single lead support
  leadType?: 'new' | 'legacy'; // Legacy single lead support
  contact?: ContactData;
  recentCalls?: CallLog[];
  message?: string;
}

const CTIPopupModal: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const phone = searchParams.get('phone');
  
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<CTILookupResponse | null>(null);
  const [testPhone, setTestPhone] = useState('');

  // Initialize stage names cache
  useEffect(() => {
    fetchStageNames().catch(error => {
      console.error('Error initializing stage names:', error);
    });
  }, []);

  const fetchLeadData = async (phoneNumber: string) => {
    if (!phoneNumber || phoneNumber.trim() === '') {
      setData({
        success: false,
        found: false,
        phone: phoneNumber,
        message: 'No phone number provided'
      });
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'https://leadify-crm-backend.onrender.com';
      console.log('🔍 Fetching lead data for phone:', phoneNumber, 'from:', backendUrl);
      
      const response = await fetch(`${backendUrl}/api/onecom/lookup?phone=${encodeURIComponent(phoneNumber)}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      console.log('📡 Response status:', response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Response error:', errorText);
        throw new Error(`Failed to fetch lead data: ${response.status} ${response.statusText}`);
      }
      
      const result: CTILookupResponse = await response.json();
      console.log('✅ Lead data received:', result);
      setData(result);
    } catch (error: any) {
      console.error('❌ Error fetching lead data:', error);
      toast.error('Failed to load lead information: ' + (error.message || 'Unknown error'));
      setData({
        success: false,
        found: false,
        phone: phoneNumber,
        message: error.message || 'Failed to load lead information'
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (phone) {
      fetchLeadData(phone);
    } else {
      setLoading(false);
      setData(null);
    }
  }, [phone]);

  const handleClose = () => {
    // Remove phone parameter and close modal
    setSearchParams({});
    // If on CTI pop route, navigate to home instead of just closing
    if (isOnCTIPopRoute) {
      navigate('/');
    } else {
      window.history.replaceState({}, '', window.location.pathname);
    }
  };

  const handleTestLookup = () => {
    if (!testPhone.trim()) {
      toast.error('Please enter a phone number');
      return;
    }
    fetchLeadData(testPhone.trim());
  };

  // Show modal if there's a phone parameter OR if we have data (for testing)
  // Always render the modal if we're on the /cti/pop route OR if there's a phone parameter
  const isOnCTIPopRoute = typeof window !== 'undefined' && window.location.pathname === '/cti/pop';
  
  if (!phone && !data && !isOnCTIPopRoute) {
    return null; // Don't show on other pages without phone parameter
  }

  // Get leads array (support both new format with leads array and old format with single lead)
  const leads = data?.leads || (data?.lead ? [data.lead] : []);
  
  return (
    <div className={`${isOnCTIPopRoute ? 'fixed' : 'fixed'} inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4`}>
      <div className="bg-white rounded-lg shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <PhoneIcon className="w-6 h-6" />
            <div>
              <h2 className="text-xl font-bold">Incoming Call</h2>
              {phone && (
                <p className="text-blue-100 text-sm mt-1">{phone}</p>
              )}
            </div>
          </div>
          <button
            onClick={handleClose}
            className="text-white hover:bg-white/20 rounded-full p-2 transition-colors"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="loading loading-spinner loading-lg text-blue-600"></div>
            </div>
          ) : !data?.found || leads.length === 0 ? (
            <div className="text-center py-12">
              <PhoneIcon className="w-16 h-16 mx-auto text-gray-400 mb-4" />
              <h3 className="text-lg font-semibold text-gray-700 mb-2">No Lead Found</h3>
              <p className="text-gray-500">
                No matching lead or contact found for phone number: <strong>{data?.phone || phone}</strong>
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Contact Information */}
              {data.contact && (
                <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                  <div className="flex items-center gap-2 mb-3">
                    <UserIcon className="w-5 h-5 text-blue-600" />
                    <h3 className="font-semibold text-gray-800">Contact Information</h3>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div>
                      <span className="font-medium text-gray-600">Name:</span>{' '}
                      <span className="text-gray-800">{data.contact.name || 'N/A'}</span>
                    </div>
                    {data.contact.phone && (
                      <div>
                        <span className="font-medium text-gray-600">Phone:</span>{' '}
                        <span className="text-gray-800">{data.contact.phone}</span>
                      </div>
                    )}
                    {data.contact.mobile && (
                      <div>
                        <span className="font-medium text-gray-600">Mobile:</span>{' '}
                        <span className="text-gray-800">{data.contact.mobile}</span>
                      </div>
                    )}
                    {data.contact.email && (
                      <div>
                        <span className="font-medium text-gray-600">Email:</span>{' '}
                        <span className="text-gray-800">{data.contact.email}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Leads List - Horizontal Scrollable */}
              <div>
                <h3 className="text-lg font-semibold text-gray-800 mb-4">
                  Matching Leads ({leads.length})
                </h3>
                <div className="overflow-x-auto pb-4 -mx-2 px-2" style={{ scrollbarWidth: 'thin' }}>
                  <div className="flex gap-4" style={{ minWidth: 'max-content', width: `calc(${leads.length} * 496px)` }}>
                    {leads.map((lead, index) => {
                      // Helper function for contrasting text color
                      const getContrastingTextColor = (hexColor?: string | null) => {
                        if (!hexColor) return '#111827';
                        let sanitized = hexColor.trim();
                        if (sanitized.startsWith('#')) sanitized = sanitized.slice(1);
                        if (sanitized.length === 3) {
                          sanitized = sanitized.split('').map(char => char + char).join('');
                        }
                        if (!/^[0-9a-fA-F]{6}$/.test(sanitized)) {
                          return '#111827';
                        }
                        const r = parseInt(sanitized.slice(0, 2), 16) / 255;
                        const g = parseInt(sanitized.slice(2, 4), 16) / 255;
                        const b = parseInt(sanitized.slice(4, 6), 16) / 255;
                        const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                        return luminance > 0.6 ? '#111827' : '#ffffff';
                      };

                      // Get stage badge
                      const getStageBadge = (stage: string | number | null | undefined) => {
                        if (!stage && stage !== 0) return <span className="badge badge-outline">No Stage</span>;
                        const stageStr = String(stage);
                        const stageName = lead.stage_name || getStageName(stageStr);
                        const stageColour = getStageColour(stageStr);
                        const badgeTextColour = getContrastingTextColor(stageColour);
                        const backgroundColor = stageColour || '#3f28cd';
                        const textColor = stageColour ? badgeTextColour : '#ffffff';
                        
                        return (
                          <span 
                            className="badge text-xs px-2 py-1"
                            style={{
                              backgroundColor: backgroundColor,
                              borderColor: backgroundColor,
                              color: textColor,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              display: 'inline-block'
                            }}
                            title={stageName}
                          >
                            {stageName}
                          </span>
                        );
                      };

                      const handleLeadClick = (e: React.MouseEvent) => {
                        e.preventDefault();
                        e.stopPropagation();
                        
                        // Legacy leads: use id column only (no prefix)
                        // New leads: use lead_number column only (no prefix)
                        if (lead.leadType === 'legacy') {
                          const legacyId = lead.id?.toString();
                          if (legacyId) {
                            console.log('CTI Modal: Navigating to legacy lead:', legacyId);
                            // Navigate directly - don't call handleClose() as it navigates to / on /cti/pop route
                            navigate(`/clients/${legacyId}`, { replace: true });
                          } else {
                            console.error('CTI Modal: No ID found for legacy lead', lead);
                          }
                        } else {
                          // New leads use lead_number
                          const leadNumber = lead.lead_number;
                          if (leadNumber) {
                            console.log('CTI Modal: Navigating to new lead:', leadNumber);
                            // Navigate directly - don't call handleClose() as it navigates to / on /cti/pop route
                            navigate(`/clients/${leadNumber}`, { replace: true });
                          } else {
                            console.error('CTI Modal: No lead_number found for new lead', lead);
                          }
                        }
                      };

                      return (
                        <div 
                          key={lead.id || index} 
                          className="card shadow-lg border border-base-200 bg-base-100 flex-shrink-0 cursor-pointer hover:shadow-xl transition-shadow"
                          style={{ width: '480px', minWidth: '480px' }}
                          onClick={handleLeadClick}
                        >
                          <div className="card-body p-5">
                            <div className="flex justify-between items-start mb-2">
                              <div className="flex items-center gap-2">
                                <BuildingOfficeIcon className="w-5 h-5 text-gray-600" />
                                <h2 className="card-title text-xl font-bold text-gray-900">
                                  {lead.name || 'N/A'}
                                </h2>
                              </div>
                              <div className="flex flex-col gap-1 items-end">
                                {getStageBadge(lead.stage)}
                              </div>
                            </div>
                            
                            <p className="text-sm text-base-content/60 font-mono mb-4">
                              #{lead.lead_number || lead.id}
                            </p>

                            <div className="divider my-0"></div>

                            <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm mt-4">
                              {lead.phone && (
                                <div className="flex items-center gap-2" title="Phone">
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                                  </svg>
                                  <span className="font-medium">{lead.phone}</span>
                                </div>
                              )}
                              {lead.mobile && (
                                <div className="flex items-center gap-2" title="Mobile">
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                                  </svg>
                                  <span className="font-medium">{lead.mobile}</span>
                                </div>
                              )}
                              {lead.email && (
                                <div className="flex items-center gap-2" title="Email">
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                  </svg>
                                  <span className="font-medium">{lead.email}</span>
                                </div>
                              )}
                              {lead.category_display && (
                                <div className="flex items-center gap-2" title="Category">
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                                  </svg>
                                  <span>{lead.category_display}</span>
                                </div>
                              )}
                              {lead.source_name && (
                                <div className="flex items-center gap-2" title="Source">
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                                  </svg>
                                  <span>{lead.source_name}</span>
                                </div>
                              )}
                              {lead.scheduler_name && (
                                <div className="flex items-center gap-2" title="Scheduler">
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                  </svg>
                                  <span className="font-medium">{lead.scheduler_name}</span>
                                </div>
                              )}
                              {lead.status && (
                                <div className="flex items-center gap-2" title="Status">
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                                  </svg>
                                  <span className="font-medium">{lead.status}</span>
                                </div>
                              )}
                            </div>

                            {(lead.topic || lead.scheduler || lead.closer || lead.handler) && (
                              <div className="mt-4 pt-4 border-t border-base-200/50">
                                {lead.topic && (
                                  <p className="text-sm font-semibold text-base-content/80 mb-2">{lead.topic}</p>
                                )}
                                {(lead.scheduler || lead.closer || lead.handler) && (
                                  <div className="flex flex-wrap gap-2 mt-2">
                                    {lead.scheduler && (
                                      <span className="badge badge-sm badge-outline">
                                        Scheduler: {lead.scheduler}
                                      </span>
                                    )}
                                    {lead.closer && (
                                      <span className="badge badge-sm badge-outline">
                                        Closer: {lead.closer}
                                      </span>
                                    )}
                                    {lead.handler && (
                                      <span className="badge badge-sm badge-outline">
                                        Handler: {lead.handler}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Recent Calls */}
              {data?.recentCalls && data.recentCalls.length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold text-gray-800 mb-4">
                    Recent Calls ({data.recentCalls.length})
                  </h3>
                  <div className="space-y-3">
                    {data.recentCalls.map((call) => {
                      const isIncoming = call.direction === 'inbound' || call.direction === 'incoming';

                      return (
                        <div
                          key={call.id}
                          className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3 flex-1">
                              <div className="flex-shrink-0">
                                {isIncoming ? (
                                  <ArrowDownIcon className="w-5 h-5 text-blue-600" />
                                ) : (
                                  <ArrowUpIcon className="w-5 h-5 text-blue-600" />
                                )}
                              </div>
                              <div className="flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  {call.status && (
                                    <span 
                                      className="badge badge-xs text-white border-0"
                                      style={{ 
                                        backgroundColor: '#2563eb', // blue-600 to match header
                                        backgroundImage: 'linear-gradient(to right, #2563eb, #1d4ed8)' // blue-600 to blue-700 gradient
                                      }}
                                    >
                                      {call.status}
                                    </span>
                                  )}
                                </div>
                                <div className="text-sm text-gray-600 mt-1">
                                  {call.cdate ? new Date(call.cdate).toLocaleString() : 
                                   call.date && call.time ? `${call.date} ${call.time}` : 
                                   'No date'}
                                  {call.duration && (
                                    <span className="ml-2 flex items-center gap-1">
                                      <ClockIcon className="w-4 h-4 text-gray-500" />
                                      {Math.floor(call.duration / 60)}m {call.duration % 60}s
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs text-gray-500 mt-1">
                                  {call.source && <span>From: {call.source}</span>}
                                  {call.destination && (
                                    <span className={call.source ? ' ml-2' : ''}>
                                      To: {call.destination}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                            {call.employee?.display_name && (
                              <div className="flex-shrink-0 text-right">
                                <div className="text-sm font-medium text-gray-900">
                                  {call.employee.display_name}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Test Section (only show if no phone in URL) */}
          {!phone && (
            <div className="mt-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
              <h3 className="font-semibold text-gray-800 mb-3">Test CTI Popup</h3>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  placeholder="Enter phone number (e.g., 0501234567)"
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <button
                  onClick={handleTestLookup}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Lookup
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        {data?.found && leads.length > 0 && (
          <div className="border-t border-gray-200 px-6 py-4 flex gap-3 justify-end">
            <button
              onClick={handleClose}
              className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              Close
            </button>
            {leads.length === 1 && (
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const lead = leads[0];
                  // Legacy leads: use id column only (no prefix)
                  // New leads: use lead_number column only (no prefix)
                  if (lead.leadType === 'legacy') {
                    const legacyId = lead.id?.toString();
                    if (legacyId) {
                      console.log('CTI Modal Footer: Navigating to legacy lead:', legacyId);
                      // Navigate directly - don't call handleClose() as it navigates to / on /cti/pop route
                      navigate(`/clients/${legacyId}`, { replace: true });
                    }
                  } else {
                    const leadNumber = lead.lead_number;
                    if (leadNumber) {
                      console.log('CTI Modal Footer: Navigating to new lead:', leadNumber);
                      // Navigate directly - don't call handleClose() as it navigates to / on /cti/pop route
                      navigate(`/clients/${leadNumber}`, { replace: true });
                    }
                  }
                }}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
              >
                <LinkIcon className="w-4 h-4" />
                Open Lead
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default CTIPopupModal;

