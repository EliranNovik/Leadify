import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { toast } from 'react-hot-toast';
import { fetchStageNames, getStageName, getStageColour } from '../lib/stageUtils';
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
  source_id?: number | null;
  category_id?: number | null;
}

const getContrastingTextColor = (hexColor?: string | null) => {
  if (!hexColor) return '#111827';
  const color = hexColor.replace('#', '');
  const r = parseInt(color.substring(0, 2), 16);
  const g = parseInt(color.substring(2, 4), 16);
  const b = parseInt(color.substring(4, 6), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness > 128 ? '#0f172a' : '#ffffff';
};

const stageColourFallbacks: Record<string, string> = {
  '0': '#9CA3AF',
  '10': '#0EA5E9',
  '11': '#F59E0B',
  '15': '#6366F1',
  '20': '#14B8A6',
  '21': '#0F766E',
  '30': '#4ADE80',
  '35': '#F97316',
  '40': '#FB7185',
  '50': '#E879F9',
  '55': '#FCD34D',
  '60': '#22D3EE',
  '70': '#A855F7',
  '91': '#52525B',
  '100': '#34D399',
  '105': '#818CF8',
  '110': '#2563EB',
  '150': '#9333EA',
  '200': '#38BDF8',
};

const renderStageBadge = (stageValue: string | number | null | undefined) => {
  if (stageValue === null || stageValue === undefined || stageValue === '') {
    return <span className="text-sm text-gray-900 font-medium">---</span>;
  }

  const stageId = String(stageValue);
  const stageName = getStageName(stageId);
  const stageColour = getStageColour(stageId) || stageColourFallbacks[stageId] || '#1f2937';
  const badgeTextColour = getContrastingTextColor(stageColour);

  return (
    <span
      className="inline-flex items-center px-3 py-1 rounded-lg text-xs font-semibold shadow-sm"
      style={{ backgroundColor: stageColour, color: badgeTextColour }}
    >
      {stageName}
    </span>
  );
};

const DoubleLeadsPage: React.FC = () => {
  const [doubleLeads, setDoubleLeads] = useState<DoubleLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<number | null>(null);
  const [allCategories, setAllCategories] = useState<any[]>([]);
  const [allSources, setAllSources] = useState<any[]>([]);

  // Fetch categories from database
  const fetchCategories = async () => {
    try {
      const { data, error } = await supabase
        .from('misc_category')
        .select(`
          id,
          name,
          parent_id,
          misc_maincategory!parent_id (
            id,
            name
          )
        `)
        .order('name', { ascending: true });

      if (error) {
        console.error('Error fetching categories:', error);
        return;
      }

      if (data) {
        setAllCategories(data);
      }
    } catch (error) {
      console.error('Exception while fetching categories:', error);
    }
  };

  // Fetch sources from database
  const fetchSources = async () => {
    try {
      const { data, error } = await supabase
        .from('misc_leadsource')
        .select(`
          id,
          code,
          name,
          default_category_id,
          active
        `)
        .eq('active', true)
        .order('name', { ascending: true });

      if (error) {
        console.error('Error fetching sources:', error);
        return;
      }

      if (data) {
        setAllSources(data);
      }
    } catch (error) {
      console.error('Exception while fetching sources:', error);
    }
  };

  // Get source info from source_code
  const getSourceInfo = (sourceCode: string | number | null | undefined) => {
    if (!sourceCode) return null;

    const source = allSources.find((src: any) => src.code.toString() === sourceCode.toString());
    return source;
  };

  // Get category name from ID
  const getCategoryName = (categoryId: string | number | null | undefined, fallbackCategory?: string) => {
    if (!categoryId || categoryId === '---') {
      if (fallbackCategory && fallbackCategory.trim() !== '') {
        return fallbackCategory;
      }
      return '';
    }

    const category = allCategories.find((cat: any) => cat.id.toString() === categoryId.toString());
    if (category) {
      // Return category name with main category in parentheses if available
      if (category.misc_maincategory?.name) {
        return `${category.name} (${category.misc_maincategory.name})`;
      } else {
        return category.name;
      }
    }

    // Fallback to category ID if not found
    return fallbackCategory || String(categoryId);
  };

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
    const initializeData = async () => {
      await fetchStageNames();
      await fetchCategories();
      await fetchSources();
    };
    initializeData();
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

      // Create the new lead using the same function as webhook
      const newLeadData = doubleLead.new_lead_data;
      
      // Extract source_code from newLeadData if available (for backward compatibility)
      let sourceCode = null;
      if (newLeadData.source_code) {
        sourceCode = parseInt(newLeadData.source_code);
        if (isNaN(sourceCode)) sourceCode = null;
      }
      
      const { data: newLead, error: createError } = await supabase.rpc('create_lead_with_source_validation', {
        p_lead_name: newLeadData.name,
        p_lead_email: newLeadData.email || null,
        p_lead_phone: newLeadData.phone || null,
        p_lead_topic: newLeadData.topic || null,
        p_lead_language: newLeadData.language || 'English',
        p_lead_source: newLeadData.source || 'Manual Review',
        p_created_by: user.email,
        p_source_code: sourceCode,
        p_balance_currency: 'NIS',
        p_proposal_currency: 'NIS'
      });

      if (createError) {
        console.error('Error creating lead:', createError);
        throw createError;
      }

      if (!newLead || newLead.length === 0) {
        throw new Error('No lead data returned from function');
      }

      const createdLead = newLead[0];
      
      // Update the lead with facts, source_id, and category_id if provided
      const updateData: any = {};
      if (newLeadData.facts) {
        updateData.facts = newLeadData.facts;
      }
      
      // If source_id or category_id are available in double_leads, use them (they take precedence over function defaults)
      if (doubleLead.source_id !== null && doubleLead.source_id !== undefined) {
        updateData.source_id = doubleLead.source_id;
      }
      if (doubleLead.category_id !== null && doubleLead.category_id !== undefined) {
        updateData.category_id = doubleLead.category_id;
      }
      
      if (Object.keys(updateData).length > 0) {
        const { error: updateLeadError } = await supabase
          .from('leads')
          .update(updateData)
          .eq('id', createdLead.id);
        
        if (updateLeadError) {
          console.error('Error updating lead with facts/source_id/category_id:', updateLeadError);
          // Don't throw - lead was created successfully, just log the error
        }
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
      'category', 'category_id', 'comments', 'facts'
    ];
    
    // For new leads, add potential_source and potential_category if source_code exists
    const fieldsToProcess = [...fieldOrder];
    if (isNewLead && data?.source_code) {
      const sourceInfo = getSourceInfo(data.source_code);
      if (sourceInfo) {
        // Insert potential_source and potential_category after source
        const sourceIndex = fieldsToProcess.indexOf('source');
        if (sourceIndex !== -1) {
          fieldsToProcess.splice(sourceIndex + 1, 0, 'potential_source', 'potential_category');
        } else {
          fieldsToProcess.push('potential_source', 'potential_category');
        }
      }
    }
    
    // Create entries for all fields, even if they don't exist in the data
    return fieldsToProcess.map(field => {
      let value = data?.[field];
      
      // Handle stage - 0 is a valid stage value, so check for null/undefined specifically
      if (field === 'stage') {
        value = (value === null || value === undefined) ? null : value;
      } else {
        value = value || null;
      }
      
      // For new leads, show "---" for lead_number since it's not yet assigned
      if (isNewLead && field === 'lead_number') {
        value = '---';
      }
      
      // Handle category - use getCategoryName to display category name from ID
      if (field === 'category') {
        // If we have category_id, get the category name
        if (data?.category_id) {
          value = getCategoryName(data.category_id, data?.category);
        } else if (value) {
          // If we have category name but no ID, use it as is
          value = value;
        } else {
          value = null;
        }
      }
      
      // Skip category_id field - we'll show category name instead
      if (field === 'category_id') {
        return null;
      }
      
      // Handle potential_source and potential_category for new leads
      if (isNewLead && field === 'potential_source' && data?.source_code) {
        const sourceInfo = getSourceInfo(data.source_code);
        value = sourceInfo ? sourceInfo.name : null;
      }
      
      if (isNewLead && field === 'potential_category' && data?.source_code) {
        const sourceInfo = getSourceInfo(data.source_code);
        if (sourceInfo?.default_category_id) {
          value = getCategoryName(sourceInfo.default_category_id);
        } else {
          value = null;
        }
      }
      
      return [field, value];
    }).filter((item): item is [string, any] => item !== null);
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
                    <div className="grid grid-cols-2 gap-4">
                      {getRelevantFields(doubleLead.new_lead_data, true).map(([key, value]) => {
                        // Check if this field is a duplicate (handle field name variations)
                        const isDuplicate = doubleLead.duplicate_fields.some(field => {
                          // Direct match
                          if (field === key) return true;
                          // Handle category_id vs category
                          if ((field === 'category' && key === 'category_id') || 
                              (field === 'category_id' && key === 'category')) return true;
                          return false;
                        });
                        
                        // Check if this is a potential field (derived from source_code)
                        const isPotentialField = key === 'potential_source' || key === 'potential_category';
                        
                        // Fields that should span full width
                        const fullWidthFields = ['facts', 'comments', 'stage'];
                        const shouldSpanFullWidth = fullWidthFields.includes(key);
                        
                        return (
                          <div 
                            key={key} 
                            className={`py-2 border-b border-gray-100 ${
                              shouldSpanFullWidth ? 'col-span-2' : ''
                            } ${
                              isDuplicate ? 'bg-yellow-50 border-yellow-200 rounded-lg px-3 -mx-3' : ''
                            } ${
                              isPotentialField ? 'bg-blue-50 border-blue-200 rounded-lg px-3 -mx-3' : ''
                            }`}
                          >
                            <span className={`text-sm font-medium capitalize block mb-1 ${
                              isDuplicate ? 'text-yellow-800 font-semibold' : 
                              isPotentialField ? 'text-blue-800 font-semibold' : 
                              'text-gray-600'
                            }`}>
                              {key.replace(/_/g, ' ')}:
                              {isDuplicate && (
                                <span className="ml-2 text-xs bg-yellow-200 text-yellow-800 px-2 py-0.5 rounded-full">
                                  Duplicate
                                </span>
                              )}
                              {isPotentialField && (
                                <span className="ml-2 text-xs bg-blue-200 text-blue-800 px-2 py-0.5 rounded-full">
                                  Potential
                                </span>
                              )}
                            </span>
                            {key === 'facts' ? (
                              <div className={`text-sm text-gray-900 p-3 rounded border max-h-32 overflow-y-auto ${
                                isDuplicate ? 'bg-yellow-100 border-yellow-300' : 'bg-gray-50'
                              }`}>
                                <div className="whitespace-pre-line">
                                  {formatFacts(value)}
                                </div>
                              </div>
                            ) : key === 'stage' ? (
                              renderStageBadge(value)
                            ) : (
                              <span className={`text-sm font-medium ${
                                isDuplicate ? 'text-yellow-900 font-semibold' : 
                                isPotentialField ? 'text-blue-900 font-semibold' : 
                                'text-gray-900'
                              }`}>
                                {value === null || value === undefined || value === '' ? '---' : String(value)}
                              </span>
                            )}
                          </div>
                        );
                      })}
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
                    <div className="grid grid-cols-2 gap-4">
                      {getRelevantFields(doubleLead.existing_lead, false).map(([key, value]) => {
                        // Check if this field is a duplicate (handle field name variations)
                        const isDuplicate = doubleLead.duplicate_fields.some(field => {
                          // Direct match
                          if (field === key) return true;
                          // Handle category_id vs category
                          if ((field === 'category' && key === 'category_id') || 
                              (field === 'category_id' && key === 'category')) return true;
                          return false;
                        });
                        
                        // Fields that should span full width
                        const fullWidthFields = ['facts', 'comments', 'stage'];
                        const shouldSpanFullWidth = fullWidthFields.includes(key);
                        
                        return (
                          <div 
                            key={key} 
                            className={`py-2 border-b border-gray-100 ${
                              shouldSpanFullWidth ? 'col-span-2' : ''
                            } ${
                              isDuplicate ? 'bg-yellow-50 border-yellow-200 rounded-lg px-3 -mx-3' : ''
                            }`}
                          >
                            <span className={`text-sm font-medium capitalize block mb-1 ${
                              isDuplicate ? 'text-yellow-800 font-semibold' : 'text-gray-600'
                            }`}>
                              {key.replace(/_/g, ' ')}:
                              {isDuplicate && (
                                <span className="ml-2 text-xs bg-yellow-200 text-yellow-800 px-2 py-0.5 rounded-full">
                                  Duplicate
                                </span>
                              )}
                            </span>
                            {key === 'facts' ? (
                              <div className={`text-sm text-gray-900 p-3 rounded border max-h-32 overflow-y-auto ${
                                isDuplicate ? 'bg-yellow-100 border-yellow-300' : 'bg-gray-50'
                              }`}>
                                <div className="whitespace-pre-line">
                                  {formatFacts(value)}
                                </div>
                              </div>
                            ) : key === 'stage' ? (
                              renderStageBadge(value)
                            ) : (
                              <span className={`text-sm font-medium ${
                                isDuplicate ? 'text-yellow-900 font-semibold' : 'text-gray-900'
                              }`}>
                                {value === null || value === undefined || value === '' ? '---' : String(value)}
                              </span>
                            )}
                          </div>
                        );
                      })}
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

