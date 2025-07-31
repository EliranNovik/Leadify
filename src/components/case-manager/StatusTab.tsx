import React, { useState, useEffect } from 'react';
import { 
  DocumentTextIcon,
  ClockIcon,
  CheckIcon,
  XMarkIcon,
  ArrowPathIcon
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

interface HandlerTabProps {
  leads: HandlerLead[];
  uploadFiles: (lead: HandlerLead, files: File[]) => Promise<void>;
  uploadingLeadId: string | null;
  uploadedFiles: { [leadId: string]: any[] };
  isUploading: boolean;
  handleFileInput: (lead: HandlerLead, e: React.ChangeEvent<HTMLInputElement>) => void;
  refreshLeads: () => Promise<void>;
}

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
            <CheckIcon className="w-16 h-16 mx-auto mb-4 text-gray-300" />
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

export default StatusTab; 