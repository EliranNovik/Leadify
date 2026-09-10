import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeftIcon, ArrowPathIcon, ClockIcon, CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import { Client } from '../types/client';
import { getStageName, getStageColour, fetchStageNames, getSoftStageBadgeStyle } from '../lib/stageUtils';
import { getSourceDisplayFromJoin } from '../lib/leadSourceId';
import LeadSubpageQuickNav from './LeadSubpageQuickNav';

const LEGACY_LEAD_SELECT =
    'id, name, manual_id, stage, cdate, category_id, source_id, misc_leadsource!leads_lead_source_id_fkey ( id, name )';
const NEW_LEAD_SELECT =
    'id, name, lead_number, stage, created_at, created_by, created_by_full_name, category_id, source, source_id, misc_leadsource!fk_leads_source_id ( id, name )';

async function resolveCreatedByEmployee(lead: any, isLegacyLead: boolean): Promise<{
    name: string;
    photo_url: string | null;
    isAutomation: boolean;
}> {
    const createdBy = String(lead?.created_by ?? '').trim();
    const fullName = String(lead?.created_by_full_name ?? '').trim();
    const isSystemActor =
        !createdBy ||
        createdBy === 'System' ||
        createdBy.toLowerCase().includes('webhook') ||
        createdBy.toLowerCase() === 'system';

    if (isLegacyLead && isSystemActor && !fullName) {
        return { name: 'Automation', photo_url: null, isAutomation: true };
    }

    if (createdBy.includes('@')) {
        const { data } = await supabase
            .from('tenants_employee')
            .select('display_name, photo_url, photo, email')
            .eq('email', createdBy)
            .maybeSingle();
        if (data?.display_name) {
            return {
                name: String(data.display_name),
                photo_url: data.photo_url || data.photo || null,
                isAutomation: false,
            };
        }
    }

    if (/^\d+$/.test(createdBy)) {
        const { data } = await supabase
            .from('tenants_employee')
            .select('display_name, photo_url, photo')
            .eq('id', createdBy)
            .maybeSingle();
        if (data?.display_name) {
            return {
                name: String(data.display_name),
                photo_url: data.photo_url || data.photo || null,
                isAutomation: false,
            };
        }
    }

    if (fullName && !isSystemActor) {
        return { name: fullName, photo_url: null, isAutomation: false };
    }
    if (createdBy && !isSystemActor) {
        return { name: fullName || createdBy, photo_url: null, isAutomation: false };
    }

    return { name: 'Automation', photo_url: null, isAutomation: true };
}

async function resolveLeadSourceName(lead: any): Promise<string | null> {
    const fromJoin = getSourceDisplayFromJoin(lead);
    if (fromJoin) return fromJoin;
    const denormalized = typeof lead?.source === 'string' ? lead.source.trim() : '';
    if (denormalized && denormalized !== '---') return denormalized;
    const sourceId = lead?.source_id;
    if (sourceId == null || sourceId === '') return null;
    const { data } = await supabase
        .from('misc_leadsource')
        .select('name')
        .eq('id', sourceId)
        .maybeSingle();
    const lookedUp = typeof data?.name === 'string' ? data.name.trim() : '';
    return lookedUp || null;
}

interface TimelineEntry {
  id: string;
  stage: number | string; // Stage ID (bigint) or stage name
  stage_name?: string; // Resolved stage name
  changed_by: string;
  changed_at: string;
  user_full_name?: string;
  creator_display_name?: string;
  photo_url?: string | null;
  isAutomation?: boolean;
  source_name?: string | null;
}

const TimelinePage: React.FC = () => {
  const { lead_number: leadNumberParam } = useParams<{ lead_number: string }>();
  const navigate = useNavigate();
  const [client, setClient] = useState<Client | null>(null);
  const [timelineData, setTimelineData] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [isLegacy, setIsLegacy] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('oldest');
  const [stageFilter, setStageFilter] = useState('all');

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
            .select(LEGACY_LEAD_SELECT)
            .eq('id', numericId)
            .maybeSingle();
          
          // If that fails, try with string format (as used in ContractPage and MeetingTab)
          if (result.error) {
            console.log('TimelinePage: Number query failed, trying with string ID:', lead_number, 'error:', result.error);
            result = await supabase
              .from('leads_lead')
              .select(LEGACY_LEAD_SELECT)
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
            .select(LEGACY_LEAD_SELECT)
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
              .select(NEW_LEAD_SELECT)
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
          .select(NEW_LEAD_SELECT)
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
            .select(LEGACY_LEAD_SELECT)
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
            display_name,
            photo_url,
            photo
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
        const employee = Array.isArray(entry.tenants_employee)
          ? entry.tenants_employee[0]
          : entry.tenants_employee;
        const creatorId = entry.creator_id != null ? String(entry.creator_id) : '';
        const isAutomation = !creatorId || creatorId === '0' || Number(creatorId) <= 0 || !employee?.display_name;
        
        return {
          id: String(entry.id),
          stage: entry.stage,
          stage_name: stageName,
          changed_by: creatorId || 'System',
          changed_at: entry.date || entry.cdate || new Date().toISOString(),
          creator_display_name: isAutomation ? 'Automation' : employee.display_name,
          user_full_name: isAutomation ? 'Automation' : employee.display_name,
          photo_url: employee?.photo_url || employee?.photo || null,
          isAutomation,
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
        
        const createdByEmployee = await resolveCreatedByEmployee(clientData, isLegacy);
        
        const createdEntry: TimelineEntry = {
          id: 'created_initial',
          stage: 0, // Created stage
          stage_name: 'Created',
          changed_by: clientData.created_by || (createdByEmployee.isAutomation ? 'System' : createdByEmployee.name),
          changed_at: createdDate,
          creator_display_name: createdByEmployee.name,
          user_full_name: createdByEmployee.name,
          photo_url: createdByEmployee.photo_url,
          isAutomation: createdByEmployee.isAutomation,
          source_name: await resolveLeadSourceName(clientData),
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
    if (entry.stage_name) return entry.stage_name;
    const stageId = entry.stage != null ? String(entry.stage) : '';
    return getStageName(stageId);
  };

  const renderStageBadge = (stageId: string | number | null, stageName: string) => {
    if (stageId == null || stageId === '') {
      return (
        <span className="badge stage-badge rounded-full shrink-0 border-0 text-sm md:text-base px-3 py-1 bg-gray-100 text-gray-600">
          {stageName || 'No stage'}
        </span>
      );
    }
    const id = String(stageId);
    const soft = getSoftStageBadgeStyle(getStageColour(id), id);
    return (
      <span
        className="badge stage-badge rounded-full shrink-0 border-0 text-sm md:text-base px-3 py-1 max-w-full"
        style={{
          backgroundColor: soft.backgroundColor,
          color: soft.color,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          display: 'inline-block',
        }}
        title={stageName}
      >
        {stageName}
      </span>
    );
  };

  const getStageIcon = (entry: TimelineEntry, className: string) => {
    const stageName = getStageDisplayName(entry).toLowerCase();
    if (stageName.includes('declined') || stageName.includes('failed') || stageName.includes('dropped') || stageName.includes('irrelevant')) {
      return <XCircleIcon className={`${className} text-red-500`} />;
    }
    if (stageName.includes('signed') || stageName.includes('paid') || stageName.includes('completed') || stageName.includes('success') || stageName.includes('case closed')) {
      return <CheckCircleIcon className={`${className} text-emerald-500`} />;
    }
    if (entry.id === 'created_initial') {
      return <CheckCircleIcon className={`${className} text-slate-500`} />;
    }
    return <ClockIcon className={`${className} text-indigo-500`} />;
  };

  const getInitials = (name: string) =>
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || '?';

  const isAutomationName = (name: string) => {
    const n = name.trim().toLowerCase();
    return !n || n === 'system' || n === 'webhook' || n === 'automation' || n === 'unknown';
  };

  const formatStageDuration = (fromIso: string, toIso: string) => {
    const from = new Date(fromIso).getTime();
    const to = new Date(toIso).getTime();
    if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
    const minutes = Math.floor(Math.abs(to - from) / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (days > 0) {
      const remainHours = hours % 24;
      return remainHours ? `${days}d ${remainHours}h` : `${days}d`;
    }
    if (hours > 0) {
      const remainMinutes = minutes % 60;
      return remainMinutes ? `${hours}h ${remainMinutes}m` : `${hours}h`;
    }
    if (minutes > 0) return `${minutes}m`;
    return '< 1m';
  };

  const formatEntryDateParts = (dateString: string) => {
    const dateObj = new Date(dateString);
    return {
      day: dateObj.getDate().toString().padStart(2, '0'),
      month: dateObj.toLocaleString('en', { month: 'short' }),
      year: dateObj.getFullYear(),
      time: dateObj.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    };
  };

  const clientIdentifier = client
    ? (isLegacy ? (client as any).manual_id || lead_number : client.lead_number || lead_number)
    : lead_number;
  const displayLeadNumber = client
    ? (client.lead_number || (client as any).manual_id || lead_number)
    : lead_number;

  const visibleTimeline = useMemo(() => {
    const toDayKey = (value: string) => {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '';
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    const filtered = timelineData.filter((entry) => {
      const dayKey = toDayKey(entry.changed_at);
      if (dateFrom && dayKey && dayKey < dateFrom) return false;
      if (dateTo && dayKey && dayKey > dateTo) return false;
      if (stageFilter !== 'all') {
        const stageId = entry.stage != null ? String(entry.stage) : '';
        const stageName = entry.stage_name || getStageName(stageId);
        if (stageId !== stageFilter && stageName !== stageFilter) return false;
      }
      return true;
    });

    return [...filtered].sort((a, b) => {
      const diff = new Date(a.changed_at).getTime() - new Date(b.changed_at).getTime();
      return sortOrder === 'oldest' ? diff : -diff;
    });
  }, [timelineData, dateFrom, dateTo, sortOrder, stageFilter]);

  const existingStages = useMemo(() => {
    const seen = new Map<string, string>();
    for (const entry of timelineData) {
      const stageId = entry.stage != null ? String(entry.stage) : '';
      const stageName = entry.stage_name || getStageName(stageId) || 'Unknown';
      const key = stageId || stageName;
      if (!seen.has(key)) seen.set(key, stageName);
    }
    return Array.from(seen.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [timelineData]);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <span className="loading loading-spinner loading-lg"></span>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="p-2 md:p-8 w-full">
        <div className="text-center py-12 text-gray-500 bg-white rounded-xl border border-gray-100">
          <h2 className="text-xl md:text-2xl font-semibold text-gray-600">Client Not Found</h2>
          <p className="text-base text-gray-500 mt-2">The client with lead number {lead_number} could not be found.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-2 md:p-8 w-full">
      <div className="mx-auto w-full max-w-5xl">
      <div className="flex flex-wrap items-center gap-2 md:gap-4 mb-3">
        <button
          type="button"
          onClick={() => navigate(`/clients/${encodeURIComponent(clientIdentifier || '')}`)}
          aria-label="Back to Client"
          title="Back to Client"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-gray-700 shadow-sm hover:bg-gray-50"
        >
          <ArrowLeftIcon className="h-5 w-5" />
        </button>
        <h1 className="text-xl md:text-3xl font-semibold tracking-tight">Timeline</h1>
      </div>
      <LeadSubpageQuickNav
        leadPathId={String(clientIdentifier || lead_number || '')}
        clientName={client.name}
        clientId={client.id}
        leadNumber={displayLeadNumber}
        leadType={isLegacy ? 'legacy' : 'new'}
        leadStage={client.stage}
        categoryId={(client as any).category_id}
      />

      <div className="mb-3 md:mb-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 md:gap-4 mb-2">
          <h2 className="text-base md:text-xl font-semibold">
            {client.name}{' '}
            <span className="text-gray-600 font-normal">#{displayLeadNumber}</span>
          </h2>
          {client.stage != null && client.stage !== '' && (() => {
            const stageId = String(client.stage);
            return renderStageBadge(stageId, getStageName(stageId));
          })()}
        </div>
        {timelineData.length > 0 && (
          <p className="text-xs md:text-sm text-gray-500">
            <span className="font-medium">Stage changes:</span> {visibleTimeline.length} entries
          </p>
        )}
      </div>

      <div className="mb-6 md:mb-8 flex flex-wrap items-end gap-x-5 gap-y-3">
        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
          className="h-8 bg-transparent border-0 border-b border-gray-300 rounded-none px-0 pr-6 text-sm text-gray-700 shadow-none focus:outline-none focus:border-gray-500"
        >
          <option value="all">All stages</option>
          {existingStages.map((stage) => (
            <option key={stage.id} value={stage.id}>
              {stage.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-gray-500">
          <span>From</span>
          <input
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-8 min-w-[8.5rem] bg-transparent border-0 border-b border-gray-300 rounded-none px-0 text-sm text-gray-700 shadow-none focus:outline-none focus:border-gray-500"
          />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-gray-500">
          <span>To</span>
          <input
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-8 min-w-[8.5rem] bg-transparent border-0 border-b border-gray-300 rounded-none px-0 text-sm text-gray-700 shadow-none focus:outline-none focus:border-gray-500"
          />
        </label>
        <select
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value as 'newest' | 'oldest')}
          className="h-8 bg-transparent border-0 border-b border-gray-300 rounded-none px-0 pr-6 text-sm text-gray-700 shadow-none focus:outline-none focus:border-gray-500"
        >
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
        </select>
      </div>

      {visibleTimeline.length === 0 ? (
        <div className="rounded-2xl bg-white px-6 py-12 text-center shadow-sm">
          <ClockIcon className="w-14 h-14 mx-auto mb-4 text-gray-400" />
          <p className="text-lg font-medium text-slate-700">
            {timelineData.length === 0 ? 'No timeline entries found' : 'No timeline entries match this filter'}
          </p>
          <p className="mt-1 text-base text-slate-400">
            {timelineData.length === 0
              ? 'Stage changes will appear here once they are made.'
              : 'Try a different date range or sort order.'}
          </p>
        </div>
      ) : (
        <div className="relative w-full">
          <div className="hidden sm:block absolute left-8 sm:left-12 md:left-16 top-0 bottom-0 w-0.5 bg-base-300" style={{ zIndex: 0 }} />
          <div className="hidden sm:block absolute right-6 md:right-10 top-0 bottom-0 w-0.5 bg-base-300" style={{ zIndex: 0 }} />
          <div className="space-y-8 md:space-y-10 lg:space-y-12">
            {visibleTimeline.map((entry, index) => {
              const currentName = getStageDisplayName(entry);
              const rawActor = entry.creator_display_name || entry.user_full_name || 'Automation';
              const isAutomation = Boolean(entry.isAutomation) || isAutomationName(rawActor);
              const actor = isAutomation ? 'Automation' : rawActor;
              const { day, month, year, time } = formatEntryDateParts(entry.changed_at);
              const icon = getStageIcon(entry, 'w-5 h-5 sm:w-6 sm:h-6 md:w-8 md:h-8');
              const nextEntry = visibleTimeline[index + 1];
              const durationToNext = nextEntry
                ? formatStageDuration(entry.changed_at, nextEntry.changed_at)
                : null;

              return (
                <div key={entry.id} className="relative pl-0 pr-0 sm:pl-20 sm:pr-16 md:pl-24 md:pr-20 group">
                  <div className="hidden sm:block absolute -left-6 sm:-left-8 md:-left-10 top-0" style={{ zIndex: 2 }}>
                    <div className="w-10 h-10 sm:w-12 sm:h-12 md:w-14 md:h-14 rounded-full flex items-center justify-center bg-white shadow-xl ring-4 ring-white">
                      {icon}
                    </div>
                  </div>
                  {durationToNext ? (
                    <div className="hidden sm:flex absolute right-6 md:right-10 top-full z-[2] -translate-y-1/2 translate-x-1/2">
                      <span className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs md:text-sm font-semibold text-gray-600 shadow-sm whitespace-nowrap">
                        {durationToNext}
                      </span>
                    </div>
                  ) : null}

                  <div className="flex flex-col lg:flex-row lg:items-start gap-4 lg:gap-6">
                    <div className="flex-shrink-0 lg:w-32 flex items-center justify-between gap-2 sm:block">
                      <div>
                        <div className="text-sm md:text-base font-semibold text-gray-700 mb-1">
                          {day} {month} {year}
                        </div>
                        <div className="text-xs md:text-sm text-gray-500">{time}</div>
                      </div>
                      <div className="sm:hidden flex-shrink-0">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white ring-2 ring-white shadow-md">
                          {getStageIcon(entry, 'w-5 h-5')}
                        </div>
                      </div>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="relative overflow-hidden rounded-2xl border border-base-200 bg-white shadow-md transition-all duration-300 hover:shadow-lg group-hover:scale-[1.01]">
                        <div className={`relative p-4 sm:p-5 md:p-6 ${entry.id === 'created_initial' && entry.source_name ? 'pb-12 sm:pb-14' : ''}`}>
                          <div>
                            {renderStageBadge(entry.stage, currentName)}
                          </div>
                          <div className="mt-4 flex items-center gap-2.5">
                            {isAutomation ? (
                              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                                <ArrowPathIcon className="h-5 w-5" aria-hidden />
                              </span>
                            ) : entry.photo_url ? (
                              <img
                                src={entry.photo_url}
                                alt=""
                                className="h-9 w-9 shrink-0 rounded-full object-cover"
                              />
                            ) : (
                              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-green-100 text-sm font-semibold text-green-700">
                                {getInitials(actor)}
                              </span>
                            )}
                            <span className="text-base font-medium text-gray-700">
                              {isAutomation ? actor : `by ${actor}`}
                            </span>
                          </div>
                          {durationToNext ? (
                            <p className="mt-3 text-sm font-semibold text-gray-500 sm:hidden">
                              {durationToNext} to next stage
                            </p>
                          ) : null}
                          {entry.id === 'created_initial' && entry.source_name ? (
                            <p className="absolute bottom-4 right-4 text-sm text-gray-500 sm:bottom-5 sm:right-5 md:bottom-6 md:right-6">
                              <span className="font-medium">Source </span>
                              {entry.source_name}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      </div>
    </div>
  );
};

export default TimelinePage;