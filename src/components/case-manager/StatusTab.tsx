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

interface HandlerStageHistory {
  id: string;
  lead_number: string;
  lead_name: string;
  old_handler_stage?: string;
  new_handler_stage: string;
  changed_by_name: string;
  created_at: string;
}

type ActivityHistory = DocumentStatusHistory | HandlerStageHistory;

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
      const [activityHistory, setActivityHistory] = useState<ActivityHistory[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [missingDocumentsCount, setMissingDocumentsCount] = useState<number>(0);
  const [applicantsCount, setApplicantsCount] = useState<number>(0);
  const [openTasksCount, setOpenTasksCount] = useState<number>(0);
  const [paymentsPaidCount, setPaymentsPaidCount] = useState<string>('0');
  
    // Fetch activity history (document status + handler stage changes) for all leads
    const fetchActivityHistory = async () => {
      if (leads.length === 0) return;
      
      setLoadingHistory(true);
      try {
        const allHistory: ActivityHistory[] = [];
        
        for (const lead of leads) {
          // Fetch document status history
          const { data: docData, error: docError } = await supabase.rpc('get_document_status_history', {
            p_lead_id: lead.id
          });
          
          if (docError) {
            console.error('Error fetching document history for lead:', lead.id, docError);
          } else if (docData) {
            allHistory.push(...docData);
          }
          
          // Fetch handler stage history
          const { data: stageData, error: stageError } = await supabase
            .from('lead_handler_stage_history')
            .select('*')
            .eq('lead_id', lead.id)
            .order('created_at', { ascending: false });
          
          console.log(`Fetching handler stage history for lead ${lead.id}:`, { stageData, stageError });
          
          if (stageError) {
            console.error('Error fetching handler stage history for lead:', lead.id, stageError);
          } else if (stageData) {
            console.log(`Found ${stageData.length} handler stage history records for lead ${lead.id}:`, stageData);
            const stageHistory: HandlerStageHistory[] = stageData.map((item: any) => ({
              id: item.id,
              lead_number: lead.lead_number,
              lead_name: lead.name,
              old_handler_stage: item.old_handler_stage,
              new_handler_stage: item.new_handler_stage,
              changed_by_name: item.changed_by_name || 'Unknown User',
              created_at: item.created_at
            }));
            allHistory.push(...stageHistory);
          }
        }
        
        // Sort by created_at descending
        allHistory.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        console.log('Final activity history:', allHistory);
        setActivityHistory(allHistory);
      } catch (err) {
        console.error('Failed to fetch activity history:', err);
      } finally {
        setLoadingHistory(false);
      }
    };
  
    // Fetch missing documents count
    const fetchMissingDocumentsCount = async () => {
      if (leads.length === 0) return;
      
      try {
        const { data, error } = await supabase
          .from('lead_required_documents')
          .select('status')
          .in('lead_id', leads.map(lead => lead.id))
          .eq('status', 'missing');
        
        if (error) {
          console.error('Error fetching missing documents:', error);
        } else {
          setMissingDocumentsCount(data?.length || 0);
        }
      } catch (err) {
        console.error('Failed to fetch missing documents count:', err);
      }
    };

    // Fetch applicants count (family members excluding persecuted persons)
    const fetchApplicantsCount = async () => {
      if (leads.length === 0) return;
      
      try {
        const { data, error } = await supabase
          .from('contacts')
          .select('is_persecuted')
          .in('lead_id', leads.map(lead => lead.id))
          .eq('is_persecuted', false);
        
        if (error) {
          console.error('Error fetching applicants count:', error);
        } else {
          setApplicantsCount(data?.length || 0);
        }
      } catch (err) {
        console.error('Failed to fetch applicants count:', err);
      }
    };

    // Fetch open tasks count (tasks with pending and in_progress status)
    const fetchOpenTasksCount = async () => {
      if (leads.length === 0) return;
      
      try {
        const { data: allTasks, error: allTasksError } = await supabase
          .from('handler_tasks')
          .select('id, status, lead_id')
          .in('lead_id', leads.map(lead => lead.id));
        
        if (allTasksError) {
          console.error('Error fetching all tasks:', allTasksError);
          return;
        }
        
        // Filter for pending and in_progress tasks
        const openTasks = allTasks?.filter(task => 
          task.status === 'pending' || task.status === 'in_progress'
        ) || [];
        
        setOpenTasksCount(openTasks.length);
        
      } catch (err) {
        console.error('Failed to fetch open tasks count:', err);
      }
    };

    // Fetch payments paid count and total count
    const fetchPaymentsPaidCount = async () => {
      if (leads.length === 0) return;
      
      try {
        // Get total payments count
        const { data: totalData, error: totalError } = await supabase
          .from('payment_plans')
          .select('paid')
          .in('lead_id', leads.map(lead => lead.id));
        
        if (totalError) {
          console.error('Error fetching total payments count:', totalError);
          return;
        }

        // Get paid payments count
        const { data: paidData, error: paidError } = await supabase
          .from('payment_plans')
          .select('paid')
          .in('lead_id', leads.map(lead => lead.id))
          .eq('paid', true);
        
        if (paidError) {
          console.error('Error fetching paid payments count:', paidError);
          return;
        }

        const totalCount = totalData?.length || 0;
        const paidCount = paidData?.length || 0;
        
        setPaymentsPaidCount(`${paidCount} of ${totalCount}`);
      } catch (err) {
        console.error('Failed to fetch payments count:', err);
      }
    };

    React.useEffect(() => {
      fetchActivityHistory();
      fetchMissingDocumentsCount();
      fetchApplicantsCount();
      fetchOpenTasksCount();
      fetchPaymentsPaidCount();
    }, [leads]);
  
    const updateLeadHandlerStage = async (leadId: string, newHandlerStage: string) => {
      setUpdating(leadId);
      try {
        // Get current user
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          toast.error('User not authenticated');
          return;
        }

        // Get current handler stage
        const { data: currentLead } = await supabase
          .from('leads')
          .select('handler_stage')
          .eq('id', leadId)
          .single();

        const oldHandlerStage = currentLead?.handler_stage;

        // Update the handler stage
        const { error: updateError } = await supabase
          .from('leads')
          .update({ handler_stage: newHandlerStage })
          .eq('id', leadId);
        
        if (updateError) {
          toast.error('Error updating handler stage: ' + updateError.message);
          return;
        }

        // Get user's full name - try multiple sources
        let changedByName = 'Unknown User';
        
        console.log('Current user:', user);
        
        try {
          // Get all user data from users table
          const { data: allUsers, error: allUsersError } = await supabase
            .from('users')
            .select('id, full_name, email')
            .eq('id', user.id);
          
          console.log('All users with this ID:', { allUsers, allUsersError });
          
          if (allUsers && allUsers.length > 0) {
            const userRecord = allUsers[0];
            console.log('Found user record:', userRecord);
            
            if (userRecord.full_name && userRecord.full_name.trim() !== '') {
              changedByName = userRecord.full_name;
              console.log('Using full_name from users table:', userRecord.full_name);
            } else {
              // Update the user's full_name if it's empty
              console.log('Full name is empty, updating with email prefix...');
              const emailPrefix = user.email?.split('@')[0] || 'Unknown';
              const { data: updatedUser, error: updateError } = await supabase
                .from('users')
                .update({ full_name: emailPrefix })
                .eq('id', user.id)
                .select()
                .single();
              
              console.log('Updated user with full_name:', { updatedUser, updateError });
              
              if (updatedUser?.full_name) {
                changedByName = updatedUser.full_name;
              } else {
                changedByName = emailPrefix;
              }
            }
          } else {
            // User doesn't exist in users table, create them
            console.log('User not found in users table, creating...');
            const emailPrefix = user.email?.split('@')[0] || 'Unknown';
            const { data: newUser, error: createError } = await supabase
              .from('users')
              .insert({
                id: user.id,
                full_name: emailPrefix,
                email: user.email
              })
              .select()
              .single();
            
            console.log('Created user in users table:', { newUser, createError });
            
            if (newUser?.full_name) {
              changedByName = newUser.full_name;
            } else {
              changedByName = emailPrefix;
            }
          }
        } catch (err) {
          console.log('Could not fetch user data, using email prefix:', user.email?.split('@')[0]);
          changedByName = user.email?.split('@')[0] || 'Unknown User';
        }
        
        console.log('Final changedByName:', changedByName);

        // Record the change in history
        console.log('Recording handler stage change:', {
          lead_id: leadId,
          old_handler_stage: oldHandlerStage,
          new_handler_stage: newHandlerStage,
          changed_by: user.id,
          changed_by_name: changedByName
        });
        
        const { data: historyData, error: historyError } = await supabase
          .from('lead_handler_stage_history')
          .insert({
            lead_id: leadId,
            old_handler_stage: oldHandlerStage,
            new_handler_stage: newHandlerStage,
            changed_by: user.id,
            changed_by_name: changedByName
          })
          .select();

        if (historyError) {
          console.error('Error recording handler stage history:', historyError);
          // Try a simpler approach without the trigger
          const { error: simpleError } = await supabase
            .from('lead_handler_stage_history')
            .insert({
              lead_id: leadId,
              old_handler_stage: oldHandlerStage,
              new_handler_stage: newHandlerStage,
              changed_by: user.id,
              changed_by_name: changedByName
            });
          
          if (simpleError) {
            console.error('Error with simple insert:', simpleError);
          } else {
            console.log('Successfully recorded handler stage history with simple insert');
          }
        } else {
          console.log('Successfully recorded handler stage history:', historyData);
        }

        toast.success('Handler stage updated successfully');
        await refreshLeads();
        await fetchActivityHistory(); // Refresh the activity list
      } catch (err) {
        toast.error('Failed to update handler stage');
        console.error('Error updating handler stage:', err);
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
        <h3 className="text-xl sm:text-2xl font-bold text-gray-900 mb-6">Case Status Management</h3>
        
        {leads.length === 0 ? (
          <div className="text-center py-8 sm:py-12 text-gray-500 bg-gray-50 rounded-2xl">
            <CheckIcon className="w-12 h-12 sm:w-16 sm:h-16 mx-auto mb-4 text-gray-300" />
            <p className="text-base sm:text-lg font-medium mb-1">No cases to manage</p>
            <p className="text-sm text-gray-400">Cases will appear here when assigned</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:gap-6">
            {leads.map((lead) => (
              <div key={lead.id} className="bg-white rounded-2xl p-4 sm:p-6 shadow-lg border border-gray-200">
              <div className="flex flex-col gap-4">
                {/* Case Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-gray-100">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-purple-700 rounded-full flex items-center justify-center">
                      <span className="text-white font-bold text-sm">
                        {lead.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <h4 className="font-bold text-gray-900 text-lg">{lead.name}</h4>
                      <p className="text-sm text-gray-600">#{lead.lead_number}</p>
                    </div>
                  </div>
                  
                  <div className="w-full sm:w-auto">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Handler Stage</label>
                    <select 
                      className="select select-bordered w-full sm:w-auto"
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
                </div>
                
                {/* Stats Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 w-full">
                      <div className="bg-gradient-to-br from-purple-500 to-purple-700 rounded-lg p-3 text-white shadow-lg">
                        <div className="text-xs mb-1">Assigned at</div>
                        <div className="text-sm lg:text-lg font-bold mb-1">
                          {new Date(lead.created_at).toLocaleDateString()}
                        </div>
                      </div>
                      
                      <div className="bg-gradient-to-br from-purple-500 to-purple-700 rounded-lg p-3 text-white shadow-lg">
                        <div className="text-xs mb-1">Days in Process</div>
                        <div className="text-lg lg:text-2xl font-bold mb-1">
                          {Math.floor((new Date().getTime() - new Date(lead.created_at).getTime()) / (1000 * 60 * 60 * 24))}
                        </div>
                      </div>
                      
                      <div className="bg-gradient-to-br from-purple-500 to-purple-700 rounded-lg p-3 text-white shadow-lg">
                        <div className="text-xs mb-1">Missing Documents</div>
                        <div className="text-lg lg:text-2xl font-bold mb-1">{missingDocumentsCount}</div>
                      </div>
                      
                      <div className="bg-gradient-to-br from-purple-500 to-purple-700 rounded-lg p-3 text-white shadow-lg">
                        <div className="text-xs mb-1">Applicants</div>
                        <div className="text-lg lg:text-2xl font-bold mb-1">{applicantsCount}</div>
                      </div>
                      
                      <div className="bg-gradient-to-br from-purple-500 to-purple-700 rounded-lg p-3 text-white shadow-lg">
                        <div className="text-xs mb-1">Open Tasks</div>
                        <div className="text-lg lg:text-2xl font-bold mb-1">{openTasksCount}</div>
                      </div>
                      
                      <div className="bg-gradient-to-br from-purple-500 to-purple-700 rounded-lg p-3 text-white shadow-lg">
                        <div className="text-xs mb-1">Payments Paid</div>
                        <div className="text-lg lg:text-2xl font-bold mb-1">{paymentsPaidCount}</div>
                      </div>
                    </div>
                    
                    {updating === lead.id && (
                      <div className="loading loading-spinner loading-md text-purple-600"></div>
                    )}
                  </div>
                
                {/* Team Assignment */}
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-4 border-t border-gray-200">
                  <div className="bg-gray-50 rounded-lg p-3">
                    <span className="text-xs text-gray-600 font-medium">Handler</span>
                    <div className="font-medium text-gray-900">{lead.handler || 'Not assigned'}</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <span className="text-xs text-gray-600 font-medium">Expert</span>
                    <div className="font-medium text-gray-900">{lead.expert || 'Not assigned'}</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <span className="text-xs text-gray-600 font-medium">Manager</span>
                    <div className="font-medium text-gray-900">{lead.manager || 'Not assigned'}</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <span className="text-xs text-gray-600 font-medium">Balance</span>
                    <div className="font-medium text-gray-900">
                      {lead.balance ? `${lead.balance} ${lead.balance_currency || '₪'}` : 'N/A'}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
  
        {/* Document Status History */}
        <div className="mt-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
            <h3 className="text-xl sm:text-2xl font-bold text-gray-900">Recent Document Activities</h3>
            <button
              className="btn btn-outline btn-sm hover:bg-purple-50 border-purple-200 text-purple-700 w-full sm:w-auto"
              onClick={fetchActivityHistory}
              disabled={loadingHistory}
            >
              <ArrowPathIcon className="w-4 h-4" />
              Refresh
            </button>
          </div>
  
          {loadingHistory ? (
            <div className="text-center py-12 bg-gradient-to-br from-gray-50 to-gray-100 rounded-2xl">
              <div className="loading loading-spinner loading-lg text-purple-600 mb-4"></div>
              <p className="text-gray-600 font-medium">Loading document activities...</p>
            </div>
          ) : activityHistory.length === 0 ? (
            <div className="text-center py-12 bg-gradient-to-br from-gray-50 to-gray-100 rounded-2xl">
              <DocumentTextIcon className="w-16 h-16 mx-auto mb-4 text-gray-300" />
              <p className="text-gray-500 font-medium">No recent activities</p>
              <p className="text-gray-400 text-sm mt-1">Document changes will appear here</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
              <div className="max-h-96 overflow-y-auto">
                {activityHistory.map((activity: ActivityHistory, index: number) => (
                  <div key={activity.id} className={`p-4 sm:p-6 ${index !== activityHistory.length - 1 ? 'border-b border-gray-100' : ''} hover:bg-gray-50 transition-colors duration-200`}>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        {/* Check if it's a document status change or handler stage change */}
                        {'document_name' in activity ? (
                          // Document status change
                          <>
                            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 mb-3">
                              <div className="flex items-center gap-2 sm:gap-4">
                                <div className={`w-4 h-4 rounded-full shadow-sm ${
                                  activity.new_status === 'approved' ? 'bg-green-500' :
                                  activity.new_status === 'received' ? 'bg-blue-500' :
                                  activity.new_status === 'pending' ? 'bg-yellow-500' :
                                  activity.new_status === 'rejected' ? 'bg-red-500' : 'bg-gray-400'
                                }`}></div>
                                <h4 className="font-bold text-gray-900 text-base sm:text-lg">{activity.document_name}</h4>
                              </div>
                              {activity.contact_name && (
                                <span className="text-sm text-gray-500 bg-gray-100 px-2 py-1 rounded-full self-start">• {activity.contact_name}</span>
                              )}
                            </div>
                            
                            <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-3">
                              {activity.old_status && (
                                <>
                                  <span className="badge badge-outline badge-sm sm:badge-md border-gray-300 text-gray-600">{activity.old_status}</span>
                                  <span className="text-gray-400 font-medium">→</span>
                                </>
                              )}
                              <span className={`badge badge-sm sm:badge-md ${
                                activity.new_status === 'approved' ? 'badge-success' :
                                activity.new_status === 'received' ? 'badge-info' :
                                activity.new_status === 'pending' ? 'badge-warning' :
                                activity.new_status === 'rejected' ? 'badge-error' : 'badge-primary'
                              }`}>{activity.new_status}</span>
                            </div>
                            
                            {activity.change_reason && (
                              <div className="bg-blue-50 border-l-4 border-blue-400 p-3 rounded-r-lg mb-3">
                                <p className="text-sm text-blue-800">
                                  <strong>Reason:</strong> {activity.change_reason}
                                </p>
                              </div>
                            )}
                            
                            {activity.notes && (
                              <div className="bg-gray-50 border-l-4 border-gray-400 p-3 rounded-r-lg mb-3">
                                <p className="text-sm text-gray-700">
                                  <strong>Notes:</strong> {activity.notes}
                                </p>
                              </div>
                            )}
                          </>
                        ) : (
                          // Handler stage change
                          <>
                            <div className="flex items-center gap-2 sm:gap-4 mb-3">
                              <div className="w-4 h-4 rounded-full bg-purple-500 shadow-sm"></div>
                              <h4 className="font-bold text-gray-900 text-base sm:text-lg">Handler Stage Change</h4>
                            </div>
                            
                            <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-3">
                              {activity.old_handler_stage && (
                                <>
                                  <span className="badge badge-outline badge-sm sm:badge-md border-gray-300 text-gray-600">
                                    {activity.old_handler_stage.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())}
                                  </span>
                                  <span className="text-gray-400 font-medium">→</span>
                                </>
                              )}
                              <span className="badge badge-primary badge-sm sm:badge-md">
                                {activity.new_handler_stage.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())}
                              </span>
                            </div>
                          </>
                        )}
                        
                        <div className="mt-4 pt-4 border-t border-gray-200">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                              <div className="w-6 h-6 bg-gradient-to-br from-purple-500 to-purple-700 rounded-full flex items-center justify-center">
                                <span className="text-white text-xs font-bold">
                                  {activity.changed_by_name.charAt(0).toUpperCase()}
                                </span>
                              </div>
                              <div>
                                <span className="text-sm font-medium text-gray-600">Changed by</span>
                                <div className="text-purple-700 font-semibold">{activity.changed_by_name}</div>
                              </div>
                            </div>
                            <div className="text-left sm:text-right">
                              <div className="text-sm font-medium text-gray-600">Updated</div>
                              <div className="text-sm text-gray-700">
                                {new Date(activity.created_at).toLocaleDateString()} at {new Date(activity.created_at).toLocaleTimeString()}
                              </div>
                            </div>
                          </div>
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