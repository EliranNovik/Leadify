import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeftIcon, ClockIcon, UserIcon, CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import { Client } from '../types/client';
import { getStageName, getStageColour, fetchStageNames } from '../lib/stageUtils';

interface TimelineEntry {
  id: string;
  stage: number | string; // Stage ID (bigint) or stage name
  stage_name?: string; // Resolved stage name
  changed_by: string;
  changed_at: string;
  user_full_name?: string;
  creator_display_name?: string;
}

const TimelinePage: React.FC = () => {
  const { lead_number: leadNumberParam } = useParams<{ lead_number: string }>();
  const navigate = useNavigate();
  const [client, setClient] = useState<Client | null>(null);
  const [timelineData, setTimelineData] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [isLegacy, setIsLegacy] = useState(false);

  // Decode the lead_number parameter (React Router should auto-decode, but be explicit)
  const lead_number = leadNumberParam ? decodeURIComponent(leadNumberParam) : null;

  useEffect(() => {
    if (lead_number) {
      fetchClientAndTimeline();
    }
  }, [lead_number]);

  const fetchClientAndTimeline = async () => {
    try {
      setLoading(true);
      
      if (!lead_number) {
        throw new Error('No lead number provided');
      }
      
      // Initialize stage names cache
      await fetchStageNames();
      
      let clientData: any = null;
      let isLegacy = false;
      let leadId: string | number | null = null;
      
      // Check if the parameter is numeric (it's an ID from leads_lead table)
      const isNumericId = /^\d+$/.test(lead_number);
      
      if (isNumericId) {
        // It's a numeric ID - should be a legacy lead (leads_lead table uses numeric IDs)
        const numericId = parseInt(lead_number, 10);
        
        // Query legacy lead by ID
        // Note: id column is int8 (bigint), try both number and string formats
        console.log('TimelinePage: Querying legacy lead by ID:', numericId, 'type:', typeof numericId, 'lead_number param:', lead_number);
        
        let legacyLeadData: any = null;
        let legacyLeadError: any = null;
        
        try {
          // Try with number first (as used in other parts of codebase)
          let result = await supabase
            .from('leads_lead')
            .select('id, name, manual_id, stage, cdate')
            .eq('id', numericId)
            .maybeSingle();
          
          // If that fails, try with string format (as used in ContractPage and MeetingTab)
          if (result.error) {
            console.log('TimelinePage: Number query failed, trying with string ID:', lead_number, 'error:', result.error);
            result = await supabase
              .from('leads_lead')
              .select('id, name, manual_id, stage, cdate')
              .eq('id', lead_number) // Try as string
              .maybeSingle();
          }
          
          legacyLeadData = result.data;
          legacyLeadError = result.error;
        } catch (err: any) {
          console.error('TimelinePage: Exception during legacy lead query:', err);
          legacyLeadError = err;
        }

        if (legacyLeadError) {
          console.error('TimelinePage: Legacy lead query ERROR:', {
            message: legacyLeadError.message,
            code: legacyLeadError.code,
            details: legacyLeadError.details,
            hint: legacyLeadError.hint,
            fullError: JSON.stringify(legacyLeadError, null, 2)
          });
        }
        
        console.log('TimelinePage: Legacy lead query result:', {
          found: !!legacyLeadData,
          error: legacyLeadError ? {
            message: legacyLeadError.message,
            code: legacyLeadError.code,
            details: legacyLeadError.details,
            hint: legacyLeadError.hint
          } : null,
          data: legacyLeadData
        });

        if (!legacyLeadError && legacyLeadData) {
          // It's a legacy lead
          clientData = legacyLeadData;
          leadId = legacyLeadData.id;
          isLegacy = true;
          setIsLegacy(true);
        } else {
          // If not found by ID, try querying by manual_id as fallback (in case ID was wrong)
          console.log('TimelinePage: Not found by ID, trying manual_id as fallback:', lead_number);
          const { data: legacyByManualId, error: legacyManualIdError } = await supabase
            .from('leads_lead')
            .select('id, name, manual_id, stage, cdate')
            .eq('manual_id', lead_number)
            .maybeSingle();
          
          if (!legacyManualIdError && legacyByManualId) {
            console.log('TimelinePage: Found legacy lead by manual_id:', legacyByManualId);
            clientData = legacyByManualId;
            leadId = legacyByManualId.id;
            isLegacy = true;
            setIsLegacy(true);
          } else {
            // If not found by manual_id either, try querying by lead_number for new leads
            const { data: newLeadData, error: newLeadError } = await supabase
              .from('leads')
              .select('id, name, lead_number, stage, created_at, created_by, created_by_full_name')
              .eq('lead_number', lead_number)
              .maybeSingle();

            if (!newLeadError && newLeadData) {
              // It's a new lead with numeric lead_number
              clientData = newLeadData;
              leadId = newLeadData.id;
              isLegacy = false;
              setIsLegacy(false);
            } else {
              console.error('Lead not found by ID, manual_id, or lead_number:', {
                numericId,
                lead_number,
                legacyError: legacyLeadError,
                legacyManualIdError: legacyManualIdError,
                newLeadError: newLeadError
              });
              throw new Error('Lead not found');
            }
          }
        }
      } else {
        // It's not numeric - try by lead_number or manual_id
        // First, try to fetch as a new lead by lead_number
        const { data: newLeadData, error: newLeadError } = await supabase
          .from('leads')
          .select('id, name, lead_number, stage, created_at, created_by, created_by_full_name')
          .eq('lead_number', lead_number)
          .single();

        if (!newLeadError && newLeadData) {
          // It's a new lead
          clientData = newLeadData;
          leadId = newLeadData.id;
          isLegacy = false;
          setIsLegacy(false);
        } else {
          // Try as legacy lead by manual_id
          const { data: legacyLeadData, error: legacyLeadError } = await supabase
            .from('leads_lead')
            .select('id, name, manual_id, stage, cdate')
            .eq('manual_id', lead_number)
            .single();

          if (!legacyLeadError && legacyLeadData) {
            // It's a legacy lead
            clientData = legacyLeadData;
            leadId = legacyLeadData.id;
            isLegacy = true;
            setIsLegacy(true);
          } else {
            throw new Error('Lead not found');
          }
        }
      }

      setClient(clientData);

      // Fetch timeline data from leads_leadstage table
      let timelineQuery = supabase
        .from('leads_leadstage')
        .select(`
          id,
          stage,
          date,
          cdate,
          creator_id,
          tenants_employee!creator_id (
            id,
            display_name
          )
        `)
        .order('date', { ascending: true, nullsFirst: false });

      if (isLegacy) {
        timelineQuery = timelineQuery.eq('lead_id', leadId);
      } else {
        timelineQuery = timelineQuery.eq('newlead_id', leadId);
      }

      const { data: timelineData, error: timelineError } = await timelineQuery;

      if (timelineError) {
        console.error('Error fetching timeline:', timelineError);
        setTimelineData([]);
        return;
      }

      // Transform timeline data
      const timeline: TimelineEntry[] = (timelineData || []).map((entry: any) => {
        const stageId = entry.stage != null ? String(entry.stage) : '';
        const stageName = getStageName(stageId);
        
        return {
          id: String(entry.id),
          stage: entry.stage,
          stage_name: stageName,
          changed_by: entry.creator_id ? String(entry.creator_id) : 'System',
          changed_at: entry.date || entry.cdate || new Date().toISOString(),
          creator_display_name: entry.tenants_employee?.display_name || 'Unknown',
          user_full_name: entry.tenants_employee?.display_name || 'Unknown'
        };
      });

      // Add initial "Created" stage entry
      if (clientData) {
        // Get the exact creation date from the database
        // For legacy leads: use cdate
        // For new leads: use created_at
        const createdDate = isLegacy 
          ? (clientData.cdate || new Date().toISOString())
          : (clientData.created_at || new Date().toISOString());
        
        // Determine if created by webhook or user
        let createdBy: string;
        let creatorName: string;
        
        if (isLegacy) {
          // Legacy leads don't have created_by field, show as System
          createdBy = 'System';
          creatorName = 'System';
        } else {
          // New leads have created_by field
          createdBy = clientData.created_by || 'System';
          const isWebhook = createdBy === 'webhook@system' || 
                           createdBy?.toLowerCase().includes('webhook');
          
          if (isWebhook) {
            creatorName = 'Webhook';
          } else {
            // Created by user - use full name if available
            creatorName = clientData.created_by_full_name || createdBy || 'System';
          }
        }
        
        const createdEntry: TimelineEntry = {
          id: 'created_initial',
          stage: 0, // Created stage
          stage_name: 'Created',
          changed_by: createdBy,
          changed_at: createdDate,
          creator_display_name: creatorName,
          user_full_name: creatorName
        };
        
        // Add created entry to timeline
        timeline.push(createdEntry);
      }

      // Sort by date - all entries including "Created" sorted chronologically
      timeline.sort((a, b) => {
        return new Date(a.changed_at).getTime() - new Date(b.changed_at).getTime();
      });

      setTimelineData(timeline);
    } catch (error) {
      console.error('Error fetching timeline:', error);
      setTimelineData([]);
    } finally {
      setLoading(false);
    }
  };

  const getStageDisplayName = (entry: TimelineEntry): string => {
    // Use resolved stage_name if available, otherwise resolve from stage ID
    if (entry.stage_name) {
      return entry.stage_name;
    }
    const stageId = entry.stage != null ? String(entry.stage) : '';
    return getStageName(stageId);
  };

  const getStageColor = (entry: TimelineEntry): string => {
    const stageId = entry.stage != null ? String(entry.stage) : '';
    const hexColor = getStageColour(stageId);
    
    if (hexColor) {
      // Use inline style for custom colors
      return '';
    }
    
    // Fallback to default gray
    return 'bg-gray-100 text-gray-800';
  };

  const getStageColorStyle = (entry: TimelineEntry): React.CSSProperties => {
    const stageId = entry.stage != null ? String(entry.stage) : '';
    const hexColor = getStageColour(stageId);
    
    if (hexColor) {
      // Calculate contrasting text color using relative luminance
      const r = parseInt(hexColor.slice(1, 3), 16) / 255;
      const g = parseInt(hexColor.slice(3, 5), 16) / 255;
      const b = parseInt(hexColor.slice(5, 7), 16) / 255;
      
      // Convert to linear RGB
      const rLinear = r <= 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
      const gLinear = g <= 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
      const bLinear = b <= 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);
      
      // Calculate relative luminance
      const luminance = 0.2126 * rLinear + 0.7152 * gLinear + 0.0722 * bLinear;
      
      // Use white text for dark backgrounds (luminance < 0.6), black for light backgrounds
      // Lower threshold ensures better visibility on dark colors like dark purple
      const textColor = luminance > 0.6 ? '#111827' : '#ffffff';
      
      return {
        backgroundColor: hexColor,
        color: textColor
      };
    }
    
    return {};
  };

  const getStageIcon = (entry: TimelineEntry) => {
    const stageName = getStageDisplayName(entry).toLowerCase();
    
    if (stageName.includes('declined') || stageName.includes('failed') || stageName.includes('dropped') || stageName.includes('irrelevant')) {
      return <XCircleIcon className="w-5 h-5 text-red-500" />;
    }
    if (stageName.includes('signed') || stageName.includes('paid') || stageName.includes('completed') || stageName.includes('success') || stageName.includes('case closed')) {
      return <CheckCircleIcon className="w-5 h-5 text-green-500" />;
    }
    return <ClockIcon className="w-5 h-5 text-blue-500" />;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <span className="loading loading-spinner loading-lg"></span>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-600">Client Not Found</h2>
          <p className="text-gray-500 mt-2">The client with lead number {lead_number} could not be found.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <button
                onClick={() => {
                  // Use manual_id for legacy leads, lead_number for new leads (not the ID)
                  const clientIdentifier = isLegacy 
                    ? (client as any).manual_id || lead_number
                    : client.lead_number || lead_number;
                  navigate(`/clients/${encodeURIComponent(clientIdentifier || '')}`);
                }}
                className="btn btn-ghost btn-sm"
              >
                <ArrowLeftIcon className="w-4 h-4" />
                Back to Client
              </button>
              <div className="h-6 w-px bg-gray-300"></div>
              <div>
                <h1 className="text-xl font-semibold text-gray-900">Timeline</h1>
                <p className="text-sm text-gray-500">
                  {client.name} ({client.lead_number || (client as any).manual_id || lead_number})
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Timeline Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center gap-3 mb-6">
          <ClockIcon className="w-6 h-6 text-primary" />
          <h2 className="text-2xl font-bold text-gray-900">Stage Timeline</h2>
        </div>

            {timelineData.length === 0 ? (
              <div className="text-center py-12">
                <ClockIcon className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-500">No timeline data available</p>
              </div>
            ) : (
              <div className="space-y-6">
                {timelineData.map((entry, index) => (
                  <div key={entry.id} className="relative">
                    {/* Timeline line */}
                    {index < timelineData.length - 1 && (
                      <div className="absolute left-6 top-12 w-0.5 h-16 bg-gray-200"></div>
                    )}
                    
                    {/* Timeline entry */}
                    <div className="flex items-start gap-4">
                      <div className="flex-shrink-0 w-12 h-12 bg-white border-2 border-gray-200 rounded-full flex items-center justify-center">
                        {getStageIcon(entry)}
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-2">
                          <span 
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStageColor(entry)}`}
                            style={getStageColorStyle(entry)}
                          >
                            {getStageDisplayName(entry)}
                          </span>
                          <span className="text-sm text-gray-500">{formatDate(entry.changed_at)}</span>
                        </div>
                        
                        <div className="flex items-center gap-2 text-sm text-gray-600">
                          <UserIcon className="w-4 h-4" />
                          <span>Changed by: {entry.creator_display_name || entry.user_full_name || 'Unknown'}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
      </div>
    </div>
  );
};

export default TimelinePage;