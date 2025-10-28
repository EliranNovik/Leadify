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
  const [caseData, setCaseData] = useState<{[key: string]: any}>({});
  const [showDocumentModal, setShowDocumentModal] = useState(false);
  const [selectedLeadForDocs, setSelectedLeadForDocs] = useState<HandlerLead | null>(null);
  const [oneDriveFiles, setOneDriveFiles] = useState<any[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [applicantCounts, setApplicantCounts] = useState<{[key: string]: number}>({});
  const [contractLinks, setContractLinks] = useState<{[key: string]: Array<{link: string, contactName: string}>}>({});

  // Fetch additional case data from leads table
  useEffect(() => {
    const fetchCaseData = async () => {
      if (leads.length > 0) {
        try {
          // Separate new leads from legacy leads
          const newLeads = leads.filter(lead => !lead.id.startsWith('legacy_'));
          const legacyLeads = leads.filter(lead => lead.id.startsWith('legacy_'));
          
          const caseDataMap: {[key: string]: any} = {};
          
          // Fetch data for new leads from leads table
          if (newLeads.length > 0) {
            const { data, error } = await supabase
              .from('leads')
              .select('*')
              .in('id', newLeads.map(lead => lead.id));

            if (error) throw error;
            
            data?.forEach(lead => {
              caseDataMap[lead.id] = lead;
              console.log('New lead data for', lead.id, ':', lead); // Debug log
            });
          }
          
          // For legacy leads, we don't need to fetch additional data since they already have all the data
          // Just add them to the caseDataMap with their existing data
          legacyLeads.forEach(lead => {
            caseDataMap[lead.id] = lead;
            console.log('Legacy lead data for', lead.id, ':', lead); // Debug log
          });
          
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
          
          const countsMap: {[key: string]: number} = {};
          const linksMap: {[key: string]: Array<{link: string, contactName: string}>} = {};
          
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
    <div className="space-y-4 sm:space-y-6">
      <h3 className="text-lg sm:text-xl font-bold text-gray-900">Case Summary</h3>
      
      {/* Individual Information Boxes */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-6">
        {leads.map((lead) => {
          const leadData = caseData[lead.id] || {};
          return (
            <React.Fragment key={lead.id}>
              {/* Expert Opinion & Eligibility */}
              <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-3 sm:p-6">
                <div className="flex items-center gap-2 mb-4 sm:mb-6">
                  <div className="w-5 h-5 sm:w-6 sm:h-6 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 rounded-lg flex items-center justify-center">
                    <CheckBadgeIcon className="w-3 h-3 sm:w-4 sm:h-4 text-white" />
                  </div>
                  <h5 className="font-semibold text-gray-900 text-base sm:text-lg">Expert Opinion & Eligibility</h5>
                </div>
                <div className="border-b border-gray-200 mb-4 sm:mb-6"></div>
                <div className="space-y-3 sm:space-y-4">
                  <div className="flex justify-between items-start">
                    <span className="text-xs sm:text-sm font-medium text-gray-700">Expert:</span>
                    <p className="font-medium text-gray-900 text-right text-xs sm:text-sm">{lead.expert || 'Not assigned'}</p>
                  </div>
                  <div className="flex justify-between items-start">
                    <span className="text-xs sm:text-sm font-medium text-gray-700">Eligibility Status:</span>
                    <div className="text-right">
                      <span className="badge badge-xs sm:badge-sm badge-primary bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-transparent">
                        {typeof leadData.eligibility_status === 'string' ? leadData.eligibility_status.replace(/_/g, ' ') : 'Under Review'}
                      </span>
                    </div>
                  </div>
                  <div className="flex justify-between items-start">
                    <span className="text-xs sm:text-sm font-medium text-gray-700">Section Eligibility:</span>
                    <p className="font-medium text-gray-900 text-right text-xs sm:text-sm">
                      {typeof lead.section_eligibility === 'string' ? lead.section_eligibility :
                       typeof leadData.section_eligibility === 'string' ? leadData.section_eligibility : 'Not specified'}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs sm:text-sm font-medium text-gray-700">Expert Notes:</span>
                    <div className="text-gray-700 mt-1 space-y-2">
                      {Array.isArray(lead.expert_notes) && lead.expert_notes.length > 0 ? (
                        lead.expert_notes.map((note: any, index: number) => (
                          <div key={index} className="bg-gray-50 p-2 sm:p-3 rounded-lg">
                            <p className="text-xs sm:text-sm whitespace-pre-wrap">
                              {note.content || note.note || JSON.stringify(note)}
                            </p>
                            {note.timestamp && (
                              <p className="text-xs text-gray-500 mt-1">
                                {(() => {
                                  try {
                                    const date = new Date(note.timestamp);
                                    return isNaN(date.getTime()) ? note.timestamp : date.toLocaleDateString();
                                  } catch (error) {
                                    return note.timestamp;
                                  }
                                })()}
                              </p>
                            )}
                          </div>
                        ))
                      ) : Array.isArray(leadData.expert_notes) && leadData.expert_notes.length > 0 ? (
                        leadData.expert_notes.map((note: any, index: number) => (
                          <div key={index} className="bg-gray-50 p-3 rounded-lg">
                            <p className="text-sm whitespace-pre-wrap">
                              {note.content || note.note || JSON.stringify(note)}
                            </p>
                            {note.timestamp && (
                              <p className="text-xs text-gray-500 mt-1">
                                {(() => {
                                  try {
                                    const date = new Date(note.timestamp);
                                    return isNaN(date.getTime()) ? note.timestamp : date.toLocaleDateString();
                                  } catch (error) {
                                    return note.timestamp;
                                  }
                                })()}
                              </p>
                            )}
                          </div>
                        ))
                      ) : (
                        <p className="text-gray-500">No expert notes available</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Facts of Case */}
              <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-3 sm:p-6">
                <div className="flex items-center gap-2 mb-4 sm:mb-6">
                  <div className="w-5 h-5 sm:w-6 sm:h-6 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 rounded-lg flex items-center justify-center">
                    <ClipboardDocumentListIcon className="w-3 h-3 sm:w-4 sm:h-4 text-white" />
                  </div>
                  <h5 className="font-semibold text-gray-900 text-base sm:text-lg">Facts of Case</h5>
                </div>
                <div className="border-b border-gray-200 mb-4 sm:mb-6"></div>
                <div className="space-y-3 sm:space-y-4">
                  <div className="flex justify-between items-start">
                    <span className="text-xs sm:text-sm font-medium text-gray-700">Category:</span>
                    <p className="font-medium text-gray-900 text-right text-xs sm:text-sm">{lead.category || 'N/A'}</p>
                  </div>
                  <div className="flex justify-between items-start">
                    <span className="text-xs sm:text-sm font-medium text-gray-700">Stage:</span>
                    <div className="text-right">
                      <span className="badge badge-xs sm:badge-sm badge-primary bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-transparent">
                        {getStageDisplayName ? getStageDisplayName(lead.handler_stage || lead.stage) : (lead.stage ? String(lead.stage).replace(/_/g, ' ') : 'N/A')}
                      </span>
                    </div>
                  </div>
                  <div className="flex justify-between items-start">
                    <span className="text-xs sm:text-sm font-medium text-gray-700">Handler:</span>
                    <p className="font-medium text-gray-900 text-right text-xs sm:text-sm">{lead.handler || 'Not assigned'}</p>
                  </div>
                  <div>
                    <span className="text-xs sm:text-sm font-medium text-gray-700">Case Details:</span>
                    <div className="bg-gray-50 p-2 sm:p-4 rounded-lg mt-2">
                      <p className="text-gray-700 whitespace-pre-wrap text-xs sm:text-sm">
                        {typeof lead.facts === 'string' ? lead.facts :
                         typeof leadData.facts === 'string' ? leadData.facts : 'No case facts available'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Lead Summary */}
              <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-3 sm:p-6">
                <div className="flex items-center gap-2 mb-4 sm:mb-6">
                  <div className="w-5 h-5 sm:w-6 sm:h-6 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 rounded-lg flex items-center justify-center">
                    <DocumentTextIcon className="w-3 h-3 sm:w-4 sm:h-4 text-white" />
                  </div>
                  <h5 className="font-semibold text-gray-900 text-base sm:text-lg">Lead Summary</h5>
                </div>
                <div className="border-b border-gray-200 mb-4 sm:mb-6"></div>
                <div className="space-y-2 sm:space-y-3 text-xs sm:text-sm">
                  <div className="flex justify-between items-start">
                    <span className="text-gray-500">Manager:</span>
                    <p className="font-medium text-right">{lead.manager || 'Not assigned'}</p>
                  </div>
                  <div className="flex justify-between items-start">
                    <span className="text-gray-500">Closer:</span>
                    <p className="font-medium text-right">{lead.closer || 'Not assigned'}</p>
                  </div>
                  <div className="flex justify-between items-start">
                    <span className="text-gray-500">Scheduler:</span>
                    <p className="font-medium text-right">{lead.scheduler || 'Not assigned'}</p>
                  </div>
                  <div className="flex justify-between items-start">
                    <span className="text-gray-500">Applicants:</span>
                    <p className="font-medium text-right">
                      {applicantCounts[lead.id] ? `${applicantCounts[lead.id]} applicant${applicantCounts[lead.id] !== 1 ? 's' : ''}` : 'No contracts found'}
                    </p>
                  </div>
                  <div className="flex justify-between items-start">
                    <span className="text-gray-500">Contract:</span>
                    <div className="text-right">
                      {contractLinks[lead.id] && contractLinks[lead.id].length > 0 ? (
                        <div className="space-y-1">
                          {contractLinks[lead.id].map((contract, index) => (
                            <a 
                              key={index}
                              href={contract.link} 
                              target="_blank" 
                              rel="noopener noreferrer" 
                              className="text-blue-600 hover:text-blue-800 underline flex items-center gap-1 justify-end text-xs sm:text-sm"
                            >
                              <LinkIcon className="w-2 h-2 sm:w-3 sm:h-3" /> 
                              {contract.contactName}
                            </a>
                          ))}
                        </div>
                      ) : (
                        <p className="font-medium text-gray-400">No contract link</p>
                      )}
                    </div>
                  </div>
                  <div>
                    <span className="text-gray-500">Special Notes:</span>
                    <div className="bg-gray-50 p-2 sm:p-4 rounded-lg mt-2">
                      <p className="font-medium text-gray-700 whitespace-pre-wrap text-xs sm:text-sm">
                        {typeof leadData.special_notes === 'string' ? leadData.special_notes : 'No special notes'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Main Contact Details */}
              <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6">
                <div className="flex items-center gap-2 mb-6">
                  <div className="w-6 h-6 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 rounded-lg flex items-center justify-center">
                    <UserIcon className="w-4 h-4 text-white" />
                  </div>
                  <h5 className="font-semibold text-gray-900 text-lg">Main Contact Details</h5>
                </div>
                <div className="border-b border-gray-200 mb-6"></div>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between items-start">
                    <span className="text-gray-500">Name:</span>
                    <p className="font-medium text-right">{lead.name}</p>
                  </div>
                  <div className="flex justify-between items-start">
                    <span className="text-gray-500">Email:</span>
                    <p className="font-medium text-right">{lead.email || 'Not provided'}</p>
                  </div>
                  <div className="flex justify-between items-start">
                    <span className="text-gray-500">Phone:</span>
                    <p className="font-medium text-right">{lead.phone || 'Not provided'}</p>
                  </div>
                  <div className="flex justify-between items-start">
                   
                  </div>
                </div>
              </div>

              {/* Meeting Brief */}
              <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6">
                <div className="flex items-center gap-2 mb-6">
                  <div className="w-6 h-6 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 rounded-lg flex items-center justify-center">
                    <CalendarIcon className="w-4 h-4 text-white" />
                  </div>
                  <h5 className="font-semibold text-gray-900 text-lg">Meeting Brief</h5>
                </div>
                <div className="border-b border-gray-200 mb-6"></div>
                <div className="space-y-3 text-sm">
                  <div>
                    <span className="text-gray-500">Meeting Brief:</span>
                    <div className="bg-gray-50 p-4 rounded-lg mt-2">
                      <p className="font-medium text-gray-700 whitespace-pre-wrap">
                        {typeof lead.meeting_brief === 'string' ? lead.meeting_brief :
                         typeof leadData.meeting_brief === 'string' ? leadData.meeting_brief : 'No meeting brief available'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Documents Section */}
              <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6">
                <div className="flex items-center gap-2 mb-6">
                  <div className="w-6 h-6 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 rounded-lg flex items-center justify-center">
                    <FolderIcon className="w-4 h-4 text-white" />
                  </div>
                  <h5 className="font-semibold text-gray-900 text-lg">Documents</h5>
                </div>
                <div className="border-b border-gray-200 mb-6"></div>
                <div className="space-y-3">
                  {/* View Documents Button */}
                  <button 
                    onClick={() => fetchOneDriveFiles(lead)}
                    className="btn btn-outline btn-sm w-full flex gap-2 items-center"
                  >
                    <FolderIcon className="w-4 h-4" /> 
                    View Documents
                  </button>
                  
                  {/* Upload Button */}
                  <label 
                    className={`btn btn-outline btn-sm flex gap-2 items-center cursor-pointer w-full ${
                      isUploading && uploadingLeadId === lead.id ? 'btn-disabled' : ''
                    }`}
                    style={{ borderColor: '#3b28c7', color: '#3b28c7' }}
                  >
                    <DocumentArrowUpIcon className="w-4 h-4" />
                    {isUploading && uploadingLeadId === lead.id ? 'Uploading...' : 'Upload Documents'}
                    <input 
                      type="file" 
                      className="hidden" 
                      multiple 
                      onChange={(e) => handleFileInput(lead, e)}
                      disabled={isUploading && uploadingLeadId === lead.id}
                    />
                  </label>
                  
                  {/* Uploaded Files List */}
                  {uploadedFiles[lead.id] && uploadedFiles[lead.id].length > 0 && (
                    <div className="space-y-2 mt-3">
                      <p className="text-sm font-medium text-gray-700">Uploaded Files:</p>
                      {uploadedFiles[lead.id].map((file, idx) => (
                        <div key={idx} className="flex items-center gap-2 text-xs bg-gray-50 rounded p-2">
                          <PaperClipIcon className="w-3 h-3 text-purple-600" />
                          <span className="truncate flex-1">{file.name}</span>
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
              </div>
            </React.Fragment>
          );
        })}
      </div>

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
  );
};

export default CasesTab; 