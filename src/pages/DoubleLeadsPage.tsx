import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { toast } from 'react-hot-toast';
import {
  CheckCircleIcon,
  XCircleIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
  UserIcon,
  EnvelopeIcon,
  PhoneIcon,
  DevicePhoneMobileIcon,
  PlusIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';

interface DoubleLead {
  id: number;
  new_lead_data: any;
  existing_lead_id: string; // UUID
  duplicate_fields: string[];
  status: 'pending' | 'accepted' | 'rejected' | 'merged';
  created_at: string;
  existing_lead?: any;
}

const DoubleLeadsPage: React.FC = () => {
  const [doubleLeads, setDoubleLeads] = useState<DoubleLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<number | null>(null);

  const fetchDoubleLeads = async () => {
    try {
      setLoading(true);
      
      const { data, error } = await supabase
        .from('double_leads')
        .select(`
          *,
          existing_lead:leads(*)
        `)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      setDoubleLeads(data || []);
    } catch (error) {
      console.error('Error fetching double leads:', error);
      toast.error('Failed to fetch double leads');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDoubleLeads();
  }, []);

  const handleAccept = async (doubleLead: DoubleLead) => {
    try {
      setProcessing(doubleLead.id);
      
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error('User not authenticated');
        return;
      }

      // Create the new lead
      const { data: newLead, error: createError } = await supabase
        .from('leads')
        .insert(doubleLead.new_lead_data)
        .select()
        .single();

      if (createError) {
        console.error('Error creating lead:', createError);
        throw createError;
      }

      // Update double lead status
      const { error: updateError } = await supabase
        .from('double_leads')
        .update({
          status: 'accepted',
          resolved_at: new Date().toISOString()
          // Removed resolved_by to avoid foreign key constraint issue
        })
        .eq('id', doubleLead.id);

      if (updateError) {
        console.error('Error updating double lead:', updateError);
        throw updateError;
      }

      toast.success('New lead created successfully');
      fetchDoubleLeads();
    } catch (error) {
      console.error('Error accepting lead:', error);
      toast.error('Failed to accept lead');
    } finally {
      setProcessing(null);
    }
  };

  const handleReject = async (doubleLead: DoubleLead) => {
    try {
      setProcessing(doubleLead.id);
      
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error('User not authenticated');
        return;
      }

      const { error } = await supabase
        .from('double_leads')
        .update({
          status: 'rejected',
          resolved_at: new Date().toISOString()
          // Removed resolved_by to avoid foreign key constraint issue
        })
        .eq('id', doubleLead.id);

      if (error) {
        console.error('Supabase error:', error);
        throw error;
      }

      toast.success('Lead rejected');
      fetchDoubleLeads();
    } catch (error) {
      console.error('Error rejecting lead:', error);
      toast.error('Failed to reject lead');
    } finally {
      setProcessing(null);
    }
  };

  const handleMerge = async (doubleLead: DoubleLead) => {
    try {
      setProcessing(doubleLead.id);
      
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error('User not authenticated');
        return;
      }

      const newLeadData = doubleLead.new_lead_data;
      const existingLead = doubleLead.existing_lead;
      
      // Find fields in new lead that are not in existing lead
      const fieldsToUpdate: any = {};
      const fieldsToCheck = ['name', 'email', 'phone', 'mobile', 'address', 'notes', 'topic', 'category'];
      
      fieldsToCheck.forEach(field => {
        if (newLeadData[field] && !existingLead[field]) {
          fieldsToUpdate[field] = newLeadData[field];
        }
      });

      // Update existing lead with new data
      if (Object.keys(fieldsToUpdate).length > 0) {
        const { error: updateError } = await supabase
          .from('leads')
          .update(fieldsToUpdate)
          .eq('id', existingLead.id);

        if (updateError) {
          console.error('Error updating existing lead:', updateError);
          throw updateError;
        }
      }

      // Mark double lead as merged
      const { error: statusError } = await supabase
        .from('double_leads')
        .update({
          status: 'merged',
          resolved_at: new Date().toISOString(),
          resolution_notes: `Merged fields: ${Object.keys(fieldsToUpdate).join(', ')}`
          // Removed resolved_by to avoid foreign key constraint issue
        })
        .eq('id', doubleLead.id);

      if (statusError) {
        console.error('Error updating double lead status:', statusError);
        throw statusError;
      }

      toast.success('Leads merged successfully');
      fetchDoubleLeads();
    } catch (error) {
      console.error('Error merging leads:', error);
      toast.error('Failed to merge leads');
    } finally {
      setProcessing(null);
    }
  };

  const getFieldIcon = (field: string) => {
    switch (field) {
      case 'email': return <EnvelopeIcon className="w-4 h-4" />;
      case 'phone': return <PhoneIcon className="w-4 h-4" />;
      case 'mobile': return <DevicePhoneMobileIcon className="w-4 h-4" />;
      case 'name': return <UserIcon className="w-4 h-4" />;
      default: return <UserIcon className="w-4 h-4" />;
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="loading loading-spinner loading-lg"></div>
      </div>
    );
  }

  // Define the exact same fields that both cards should show
  const getRelevantFields = (data: any, isNewLead: boolean = false) => {
    const fieldOrder = [
      'lead_number', 'name', 'email', 'phone', 'mobile', 'topic', 'stage', 'source', 
      'category', 'comments', 'facts'
    ];
    
    // Create entries for all fields, even if they don't exist in the data
    return fieldOrder.map(field => {
      let value = data?.[field] || null;
      
      // For new leads, show "---" for lead_number since it's not yet assigned
      if (isNewLead && field === 'lead_number') {
        value = '---';
      }
      
      return [field, value];
    });
  };

  // Format facts field for user-friendly display
  const formatFacts = (facts: any) => {
    if (!facts) return '---';
    try {
      const parsed = typeof facts === 'string' ? JSON.parse(facts) : facts;
      
      // Convert JSON object to user-friendly text
      const lines: string[] = [];
      Object.entries(parsed).forEach(([key, value]) => {
        if (value !== null && value !== undefined && value !== '') {
          const formattedKey = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
          const formattedValue = String(value);
          lines.push(`${formattedKey}: ${formattedValue}`);
        }
      });
      
      return lines.length > 0 ? lines.join('\n') : 'No additional information';
    } catch {
      return String(facts);
    }
  };

  return (
    <div className="p-6 min-h-screen">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2 bg-white rounded-xl shadow-lg">
            <ExclamationTriangleIcon className="w-6 h-6 text-gray-600" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Double Leads</h1>
            <p className="text-gray-600">Review and manage potential duplicate leads</p>
          </div>
        </div>
        <button
          onClick={fetchDoubleLeads}
          className="btn btn-primary gap-2 shadow-lg hover:shadow-xl transition-all duration-200"
          disabled={loading}
        >
          <ArrowPathIcon className="w-5 h-5" />
          Refresh
        </button>
      </div>

      {doubleLeads.length === 0 ? (
        <div className="text-center py-16">
          <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md mx-auto">
            <ExclamationTriangleIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-gray-900 mb-2">No Double Leads Found</h3>
            <p className="text-gray-600">All potential duplicates have been resolved.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          {doubleLeads.map((doubleLead) => (
            <div key={doubleLead.id} className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
              {/* Header */}
              <div className="bg-gradient-to-r from-gray-50 to-gray-100 px-6 py-4 border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-white rounded-lg shadow-sm">
                      <ExclamationTriangleIcon className="w-5 h-5 text-gray-600" />
                    </div>
                    <div>
                      <span className="text-sm font-medium text-gray-700">
                        Duplicate detected on {formatDate(doubleLead.created_at)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {doubleLead.duplicate_fields.map((field) => (
                      <span
                        key={field}
                        className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium bg-gray-100 text-gray-700 rounded-full border border-gray-200"
                      >
                        {getFieldIcon(field)}
                        {field}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="p-6">
                {/* Comparison Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
                  {/* New Lead */}
                  <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="p-2 bg-blue-100 rounded-lg">
                        <PlusIcon className="w-5 h-5 text-blue-600" />
                      </div>
                      <h3 className="text-lg font-semibold text-gray-900">New Lead</h3>
                    </div>
                    <div className="space-y-3">
                      {getRelevantFields(doubleLead.new_lead_data, true).map(([key, value]) => (
                        <div key={key} className="py-2 border-b border-gray-100 last:border-b-0">
                          <span className="text-sm font-medium text-gray-600 capitalize block mb-1">
                            {key.replace(/_/g, ' ')}:
                          </span>
                          {key === 'facts' ? (
                            <div className="text-sm text-gray-900 bg-gray-50 p-3 rounded border max-h-32 overflow-y-auto">
                              <div className="whitespace-pre-line">
                                {formatFacts(value)}
                              </div>
                            </div>
                          ) : (
                            <span className="text-sm text-gray-900 font-medium">
                              {value === null || value === undefined || value === '' ? '---' : String(value)}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Existing Lead */}
                  <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="p-2 bg-gray-100 rounded-lg">
                        <UserGroupIcon className="w-5 h-5 text-gray-600" />
                      </div>
                      <h3 className="text-lg font-semibold text-gray-900">Existing Lead</h3>
                    </div>
                    <div className="space-y-3">
                      {getRelevantFields(doubleLead.existing_lead, false).map(([key, value]) => (
                        <div key={key} className="py-2 border-b border-gray-100 last:border-b-0">
                          <span className="text-sm font-medium text-gray-600 capitalize block mb-1">
                            {key.replace(/_/g, ' ')}:
                          </span>
                          {key === 'facts' ? (
                            <div className="text-sm text-gray-900 bg-gray-50 p-3 rounded border max-h-32 overflow-y-auto">
                              <div className="whitespace-pre-line">
                                {formatFacts(value)}
                              </div>
                            </div>
                          ) : (
                            <span className="text-sm text-gray-900 font-medium">
                              {value === null || value === undefined || value === '' ? '---' : String(value)}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-4 justify-center">
                  <button
                    onClick={() => handleAccept(doubleLead)}
                    disabled={processing === doubleLead.id}
                    className="btn btn-primary gap-2 shadow-lg hover:shadow-xl transition-all duration-200 px-6"
                  >
                    <CheckCircleIcon className="w-4 h-4" />
                    Accept New Lead
                  </button>
                  <button
                    onClick={() => handleMerge(doubleLead)}
                    disabled={processing === doubleLead.id}
                    className="btn btn-secondary gap-2 shadow-lg hover:shadow-xl transition-all duration-200 px-6"
                  >
                    <ArrowPathIcon className="w-4 h-4" />
                    Merge & Update
                  </button>
                  <button
                    onClick={() => handleReject(doubleLead)}
                    disabled={processing === doubleLead.id}
                    className="btn btn-outline gap-2 shadow-lg hover:shadow-xl transition-all duration-200 px-6"
                  >
                    <XCircleIcon className="w-4 h-4" />
                    Reject
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default DoubleLeadsPage;
