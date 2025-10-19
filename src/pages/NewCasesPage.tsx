import React, { useEffect, useState, useRef, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { ChevronDownIcon, MagnifyingGlassIcon, CalendarIcon, UserIcon, ChartBarIcon } from '@heroicons/react/24/outline';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { useMsal } from '@azure/msal-react';

// This will be replaced with dynamic scheduler list based on preferred categories
const defaultSchedulers = ['Anna Zh', 'Mindi', 'Sarah L', 'David K', 'Yael', 'Michael R'];

const categories = [
  'German Citizenship',
  'Austrian Citizenship', 
  'General Inquiry',
  'Proposal Discussion',
  'New Business Opportunity'
];

// Portal dropdown component
const DropdownPortal: React.FC<{
  anchorRef: React.RefObject<HTMLButtonElement>;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}> = ({ anchorRef, open, onClose, children }) => {
  const [style, setStyle] = useState<React.CSSProperties>({});
  useEffect(() => {
    if (open && anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      setStyle({
        position: 'fixed',
        top: rect.bottom + 4, // 4px gap
        left: rect.left,
        minWidth: rect.width,
        zIndex: 9999999,
      });
    }
  }, [open, anchorRef]);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (anchorRef.current && !anchorRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open, anchorRef, onClose]);

  if (!open) return null;
  return createPortal(
    <div style={style} className="bg-base-100 shadow-xl rounded-lg border border-base-300 min-w-[240px]">
      {children}
    </div>,
    document.body
  );
};

const NewCasesPage: React.FC = () => {
  const navigate = useNavigate();
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [stageFilter, setStageFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  
  // New state for enhanced features
  const [employees, setEmployees] = useState<any[]>([]);
  const [employeeStats, setEmployeeStats] = useState<any[]>([]);
  const [allCategories, setAllCategories] = useState<any[]>([]);
  const [employeePreferredCategories, setEmployeePreferredCategories] = useState<any[]>([]);
  const [displayedMainCategoryIds, setDisplayedMainCategoryIds] = useState<number[]>([]);
  const [statsDateFilter, setStatsDateFilter] = useState({
    fromDate: new Date().toISOString().split('T')[0], // Current day
    toDate: new Date().toISOString().split('T')[0] // Current day
  });
  const [loadingStats, setLoadingStats] = useState(false);
  const [stages, setStages] = useState<any[]>([]);
  const [stageMapping, setStageMapping] = useState<Map<string | number, string>>(new Map());
  const [categoryGroupedLeads, setCategoryGroupedLeads] = useState<Map<string, any[]>>(new Map());
  const [categorySelectedEmployees, setCategorySelectedEmployees] = useState<Map<string, Set<string>>>(new Map());
  const [categoryAssigning, setCategoryAssigning] = useState<Map<string, boolean>>(new Map());
  const [categoryEmployeeStats, setCategoryEmployeeStats] = useState<Map<string, any[]>>(new Map());
  const [categoryLoadingStats, setCategoryLoadingStats] = useState<Map<string, boolean>>(new Map());
  const [expandedCategoryBreakdowns, setExpandedCategoryBreakdowns] = useState<Map<string, boolean>>(new Map());
  const [categorySelectedLeads, setCategorySelectedLeads] = useState<Map<string, Set<string>>>(new Map());
  const [selectedLeadBoxes, setSelectedLeadBoxes] = useState<Set<string>>(new Set());
  const [showActionButtons, setShowActionButtons] = useState(false);
  const [showSchedulerDropdown, setShowSchedulerDropdown] = useState(false);
  const [selectedScheduler, setSelectedScheduler] = useState<string>('');
  const [schedulerSearchTerm, setSchedulerSearchTerm] = useState<string>('');
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [categorySearchTerm, setCategorySearchTerm] = useState<string>('');
  const [mainCategories, setMainCategories] = useState<string[]>([]);
  const [showInactiveDropdown, setShowInactiveDropdown] = useState(false);
  const [selectedInactiveReason, setSelectedInactiveReason] = useState<string>('');
  const [customInactiveReason, setCustomInactiveReason] = useState<string>('');
  
  // Re-assign leads modal state
  const [showReassignModal, setShowReassignModal] = useState(false);
  const [reassignFilters, setReassignFilters] = useState({
    fromDate: '',
    toDate: '',
    category: '',
    source: '',
    status: '',
    language: '',
    stage: '',
    meetingScheduler: ''
  });
  const [reassignResults, setReassignResults] = useState<any[]>([]);
  const [reassignLoading, setReassignLoading] = useState(false);
  const [selectedEmployeeForReassign, setSelectedEmployeeForReassign] = useState<string>('');
  const [reassigning, setReassigning] = useState(false);
  const [showMeetingSchedulerDropdown, setShowMeetingSchedulerDropdown] = useState(false);
  const [meetingSchedulerSearchTerm, setMeetingSchedulerSearchTerm] = useState<string>('');
  const [selectedMeetingScheduler, setSelectedMeetingScheduler] = useState<string>('');
  const [showAssignEmployeeDropdown, setShowAssignEmployeeDropdown] = useState(false);
  const [assignEmployeeSearchTerm, setAssignEmployeeSearchTerm] = useState<string>('');
  const [showReassignCategoryDropdown, setShowReassignCategoryDropdown] = useState(false);
  const [reassignCategorySearchTerm, setReassignCategorySearchTerm] = useState<string>('');
  const [selectedReassignCategoryFilter, setSelectedReassignCategoryFilter] = useState<string>('');
  const [showReassignSourceDropdown, setShowReassignSourceDropdown] = useState(false);
  const [reassignSourceSearchTerm, setReassignSourceSearchTerm] = useState<string>('');
  const [selectedReassignSourceFilter, setSelectedReassignSourceFilter] = useState<string>('');
  const [showReassignStageDropdown, setShowReassignStageDropdown] = useState(false);
  const [reassignStageSearchTerm, setReassignStageSearchTerm] = useState<string>('');
  const [selectedReassignStageFilter, setSelectedReassignStageFilter] = useState<string>('');
  const [showLanguageDropdown, setShowLanguageDropdown] = useState(false);
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [reassignLanguageOptions, setReassignLanguageOptions] = useState<string[]>([]);
  const [reassignSourceOptions, setReassignSourceOptions] = useState<string[]>([]);

  // Unactivation reasons list
  const unactivationReasons = [
    'test',
    'spam',
    'double - same source',
    'double -diff. source',
    'no intent',
    'non active category',
    'IrrelevantBackground',
    'incorrect contact',
    'no legal eligibility',
    'no profitability',
    'can\'t be reached',
    'expired'
  ];

  // Get MSAL instance at component level
  const { instance } = useMsal();

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (showSchedulerDropdown && !target.closest('.scheduler-dropdown-container')) {
        setShowSchedulerDropdown(false);
        if (!selectedScheduler) {
          setSchedulerSearchTerm('');
        }
      }
      if (showCategoryDropdown && !target.closest('.category-dropdown-container')) {
        setShowCategoryDropdown(false);
        if (!selectedCategory) {
          setCategorySearchTerm('');
        }
      }
      if (showInactiveDropdown && !target.closest('.inactive-dropdown-container')) {
        setShowInactiveDropdown(false);
      }
      if (showMeetingSchedulerDropdown && !target.closest('.meeting-scheduler-dropdown-container')) {
        setShowMeetingSchedulerDropdown(false);
        if (!selectedMeetingScheduler) {
          setMeetingSchedulerSearchTerm('');
        }
      }
      if (showAssignEmployeeDropdown && !target.closest('.assign-employee-dropdown-container')) {
        setShowAssignEmployeeDropdown(false);
        if (!selectedEmployeeForReassign) {
          setAssignEmployeeSearchTerm('');
        }
      }
      if (showReassignCategoryDropdown && !target.closest('.category-filter-dropdown-container')) {
        setShowReassignCategoryDropdown(false);
        if (!selectedReassignCategoryFilter) {
          setReassignCategorySearchTerm('');
        }
      }
      if (showReassignSourceDropdown && !target.closest('.source-filter-dropdown-container')) {
        setShowReassignSourceDropdown(false);
        if (!selectedReassignSourceFilter) {
          setReassignSourceSearchTerm('');
        }
      }
      if (showReassignStageDropdown && !target.closest('.stage-filter-dropdown-container')) {
        setShowReassignStageDropdown(false);
        if (!selectedReassignStageFilter) {
          setReassignStageSearchTerm('');
        }
      }
      if (showLanguageDropdown && !target.closest('.language-filter-dropdown-container')) {
        setShowLanguageDropdown(false);
      }
      if (showStatusDropdown && !target.closest('.status-filter-dropdown-container')) {
        setShowStatusDropdown(false);
      }
    };

    if (showSchedulerDropdown || showCategoryDropdown || showInactiveDropdown || showMeetingSchedulerDropdown || showAssignEmployeeDropdown || showReassignCategoryDropdown || showReassignSourceDropdown || showReassignStageDropdown || showLanguageDropdown || showStatusDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showSchedulerDropdown, selectedScheduler, showCategoryDropdown, selectedCategory, showInactiveDropdown, showMeetingSchedulerDropdown, selectedMeetingScheduler, showAssignEmployeeDropdown, selectedEmployeeForReassign, showReassignCategoryDropdown, selectedReassignCategoryFilter, showReassignSourceDropdown, selectedReassignSourceFilter, showReassignStageDropdown, selectedReassignStageFilter, showLanguageDropdown, showStatusDropdown]);

  // Fetch language options for re-assign modal
  useEffect(() => {
    const fetchReassignLanguageOptions = async () => {
      try {
        const { data, error } = await supabase
          .from('misc_language')
          .select('name')
          .order('name');
        
        if (error) throw error;
        
        const languages = data?.map(language => language.name) || [];
        setReassignLanguageOptions(languages);
      } catch (error) {
        console.error('Error fetching language options for re-assign modal:', error);
        // Fallback to hardcoded options if database fetch fails
        setReassignLanguageOptions([
          'English', 'Hebrew', 'German', 'French', 'Spanish', 'Italian', 'Portuguese', 'Russian', 'Arabic', 'Chinese', 'Japanese', 'Korean'
        ]);
      }
    };

    fetchReassignLanguageOptions();
  }, []);

  // Fetch source options for re-assign modal
  useEffect(() => {
    const fetchReassignSourceOptions = async () => {
      try {
        const { data, error } = await supabase
          .from('misc_leadsource')
          .select('id, name')
          .eq('active', true)
          .order('name');
        
        if (error) throw error;
        
        const sources = data?.map(source => source.name) || [];
        setReassignSourceOptions(sources);
      } catch (error) {
        console.error('Error fetching source options for re-assign modal:', error);
        // Fallback to hardcoded options if database fetch fails
        setReassignSourceOptions([
          'Website', 'Phone', 'Email', 'Referral', 'Other'
        ]);
      }
    };

    fetchReassignSourceOptions();
  }, []);

  // Stage badge function with proper stage mapping
  const getStageBadge = (stage: string | null | undefined) => {
    if (!stage) return <span className="badge badge-outline">No Stage</span>;
    
    // Use stage mapping to get the correct stage name
    const mappedStage = stageMapping.get(stage) || stageMapping.get(stage.toString()) || stageMapping.get(parseInt(stage)) || stage;
    const stageText = mappedStage.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    
    
    // Use custom purple color #3f28cd for all stage badges with proper text wrapping
    return <span 
      className="badge text-white hover:opacity-90 transition-opacity duration-200 text-xs px-3 py-1 max-w-full"
      style={{
        backgroundColor: '#3f28cd',
        borderColor: '#3f28cd',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        display: 'inline-block'
      }}
      title={stageText}
    >
      {stageText}
    </span>;
  };

  // Card rendering function with selection functionality
  const renderResultCard = (lead: any) => (
    <div 
      key={lead.id} 
      className={`card shadow-lg hover:shadow-2xl transition-all duration-300 ease-in-out transform hover:-translate-y-1 cursor-pointer group ${
        selectedLeadBoxes.has(lead.id) ? 'bg-gray-300' : 'bg-base-100'
      }`}
      onClick={(e) => {
        e.stopPropagation();
        setSelectedLeadBoxes(prev => {
          const newSet = new Set(prev);
          if (newSet.has(lead.id)) {
            newSet.delete(lead.id);
          } else {
            newSet.add(lead.id);
          }
          setShowActionButtons(newSet.size > 0);
          return newSet;
        });
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        navigate(`/clients/${lead.lead_number || lead.id}`);
      }}
    >
      <div className="card-body p-5">
        <div className="flex justify-between items-start mb-2">
            <div className="flex items-center gap-2">
            <h2 className="card-title text-xl font-bold group-hover:text-primary transition-colors">
              {lead.name}
            </h2>
            </div>
            {getStageBadge(lead.stage)}
        </div>
        
        <p className="text-sm text-base-content/60 font-mono mb-4">#{lead.lead_number}</p>

        <div className="divider my-0"></div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm mt-4">
          <div className="flex items-center gap-2" title="Date Created">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            <span className="font-medium">{new Date(lead.created_at).toLocaleDateString()}</span>
          </div>
          <div className="flex items-center gap-2" title="Category">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
            <span>{lead.category || 'N/A'}</span>
          </div>
          <div className="flex items-center gap-2" title="Source">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            <span>{lead.source || 'N/A'}</span>
          </div>
          <div className="flex items-center gap-2" title="Language">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" /></svg>
            <span>{lead.language || 'N/A'}</span>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-base-200/50">
          <p className="text-sm font-semibold text-base-content/80">{lead.topic || 'No topic specified'}</p>
        </div>

      </div>
    </div>
  );

  useEffect(() => {
    const fetchLeads = async () => {
      setLoading(true);
      
      // Fetch leads with stage = 'created' (text-based)
      const { data: textBasedLeads, error: textError } = await supabase
        .from('leads')
        .select(`
          *,
          misc_category!category_id(
            id,
            name,
            parent_id,
            misc_maincategory!parent_id(
              id,
              name
            )
          )
        `)
        .eq('stage', 'created')
        .order('created_at', { ascending: false });

      // Fetch leads with stage = 11 (ID-based)
      const { data: idBasedLeads, error: idError } = await supabase
        .from('leads')
        .select(`
          *,
          misc_category!category_id(
            id,
            name,
            parent_id,
            misc_maincategory!parent_id(
              id,
              name
            )
          )
        `)
        .eq('stage', 11)
        .order('created_at', { ascending: false });

      // Fetch leads with stage = 'scheduler_assigned' but no scheduler assigned
      const { data: schedulerAssignedNoSchedulerLeads, error: schedulerError } = await supabase
        .from('leads')
        .select(`
          *,
          misc_category!category_id(
            id,
            name,
            parent_id,
            misc_maincategory!parent_id(
              id,
              name
            )
          )
        `)
        .eq('stage', 'scheduler_assigned')
        .or('scheduler.is.null,scheduler.eq.')
        .order('created_at', { ascending: false });

      // Fetch leads with stage = 10 (ID-based) but no scheduler assigned
      const { data: schedulerAssignedNoSchedulerIdLeads, error: schedulerIdError } = await supabase
        .from('leads')
        .select(`
          *,
          misc_category!category_id(
            id,
            name,
            parent_id,
            misc_maincategory!parent_id(
              id,
              name
            )
          )
        `)
        .eq('stage', 10)
        .or('scheduler.is.null,scheduler.eq.')
        .order('created_at', { ascending: false });

      // Combine all results and remove duplicates
      const allLeads = [
        ...(textBasedLeads || []), 
        ...(idBasedLeads || []),
        ...(schedulerAssignedNoSchedulerLeads || []),
        ...(schedulerAssignedNoSchedulerIdLeads || [])
      ];
      const uniqueLeads = allLeads.filter((lead, index, self) => 
        index === self.findIndex(l => l.id === lead.id)
      );
      
      // Apply stage mapping to convert stage IDs to stage names
      const mappedLeads = uniqueLeads.map(lead => ({
        ...lead,
        stage: stageMapping.get(lead.stage) || stageMapping.get(lead.stage.toString()) || stageMapping.get(parseInt(lead.stage)) || lead.stage
      }));
      
      setLeads(mappedLeads);
      
      // Extract main category IDs from displayed leads
      if (uniqueLeads && uniqueLeads.length > 0) {
        const mainCategoryIds = new Set<number>();
        
        uniqueLeads.forEach(lead => {
          // Try to get main category ID from misc_category join
          if (lead.misc_category?.misc_maincategory?.id) {
            mainCategoryIds.add(lead.misc_category.misc_maincategory.id);
          } else if (lead.category_id) {
            // If no join data, try to find the main category from allCategories
            const category = allCategories.find(cat => cat.id.toString() === lead.category_id.toString());
            if (category?.misc_maincategory?.id) {
              mainCategoryIds.add(category.misc_maincategory.id);
            }
          } else if (lead.category) {
            // If using fallback category name, find the main category
            const category = allCategories.find(cat => cat.name === lead.category);
            if (category?.misc_maincategory?.id) {
              mainCategoryIds.add(category.misc_maincategory.id);
            }
          }
        });
        
        setDisplayedMainCategoryIds(Array.from(mainCategoryIds));
        
        
      }
      
      setLoading(false);
    };
    fetchLeads();
  }, [allCategories, stages]); // Re-fetch when categories and stages are loaded

  // Fetch employees
  useEffect(() => {
    const fetchEmployees = async () => {
      try {
        const { data, error } = await supabase
          .from('tenants_employee')
          .select('id, display_name')
          .not('display_name', 'is', null)
          .order('display_name');
        
        if (error) throw error;
        setEmployees(data || []);
      } catch (error) {
        console.error('Error fetching employees:', error);
      }
    };
    fetchEmployees();
  }, []);

  // Fetch stages and create mapping
  useEffect(() => {
    const fetchStages = async () => {
      try {
        const { data, error } = await supabase
          .from('lead_stages')
          .select('id, name')
          .order('id');
        
        if (error) {
          console.error('Error fetching stages:', error);
          return;
        }
        
        setStages(data || []);
        
        // Create stage mapping
        const mapping = new Map<string | number, string>();
        
        // Add common stage name mappings first (these take precedence)
        const commonStageMappings = {
          'created': 'Created',
          'scheduler_assigned': 'Scheduler Assigned',
          'meeting_scheduled': 'Meeting Scheduled',
          'meeting_completed': 'Meeting Completed',
          'proposal_sent': 'Proposal Sent',
          'contract_signed': 'Contract Signed',
          'case_closed': 'Case Closed',
          'dropped': 'Dropped',
          'unactivated': 'Unactivated',
          'unactivate_spam': 'Unactivate/Spam',
          'dropped_spam_irrelevant': 'Dropped/Spam/Irrelevant'
        };
        
        Object.entries(commonStageMappings).forEach(([key, value]) => {
          mapping.set(key, value);
          mapping.set(key.toLowerCase(), value);
          mapping.set(value, value); // Map display name to itself
        });
        
        // Ensure stage ID 10 maps to Scheduler Assigned
        mapping.set(10, 'Scheduler Assigned');
        mapping.set('10', 'Scheduler Assigned');
        mapping.set('scheduler_assigned', 'Scheduler Assigned');
        mapping.set('Scheduler Assigned', 'Scheduler Assigned');
        
        // Then add database mappings (only if not already set)
        if (data) {
          data.forEach(stage => {
            // Only set if not already mapped
            if (!mapping.has(stage.id)) {
              mapping.set(stage.id, stage.name);
            }
            if (!mapping.has(stage.id.toString())) {
              mapping.set(stage.id.toString(), stage.name);
            }
            if (!mapping.has(parseInt(stage.id))) {
              mapping.set(parseInt(stage.id), stage.name);
            }
            
            // Only set name mappings if not already set
            if (!mapping.has(stage.name)) {
              mapping.set(stage.name, stage.name);
            }
            if (!mapping.has(stage.name.toLowerCase())) {
              mapping.set(stage.name.toLowerCase(), stage.name);
            }
          });
        }
        setStageMapping(mapping);
        
        console.log('✅ Loaded stages:', data?.length || 0);
        console.log('🔍 Stage mapping:', Array.from(mapping.entries()));
      } catch (error) {
        console.error('Error fetching stages:', error);
      }
    };
    
    fetchStages();
  }, []);

  // Fetch categories with main categories
  useEffect(() => {
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
        
        if (error) throw error;
        setAllCategories(data || []);
        
        // Create formatted category names with parent main category (same as clients page)
        if (data) {
          const formattedNames = data.map((category: any) => {
            if (category.misc_maincategory) {
              return `${category.name} (${category.misc_maincategory.name})`;
            } else {
              return category.name; // Fallback if no parent main category
            }
          }).filter(Boolean);
          setMainCategories(formattedNames);
        }
      } catch (error) {
        console.error('Error fetching categories:', error);
      }
    };
    fetchCategories();
  }, []);

  // Fetch employee preferred categories
  useEffect(() => {
    const fetchEmployeePreferredCategories = async () => {
      try {
        // First, let's check if the table exists and what its structure looks like
        console.log('🔍 Checking tenant_employee_prefered_category table...');
        
        // Try to fetch all data first to see the structure
        const { data: allData, error: allError } = await supabase
          .from('tenant_employee_prefered_category')
          .select('*')
          .limit(5);
        
        if (allError) {
          console.error('❌ Error fetching all data from tenant_employee_prefered_category:', allError);
          
          // Let's try alternative table names
          const alternativeNames = [
            'tenant_employee_preferred_category',
            'employee_preferred_category',
            'employee_prefered_category'
          ];
          
          for (const altName of alternativeNames) {
            try {
              const { data: altData, error: altError } = await supabase
                .from(altName)
                .select('*')
                .limit(1);
              
              if (!altError && altData) {
                console.log(`✅ Found alternative table: ${altName}`, altData);
                break;
              }
            } catch (e) {
              console.log(`❌ Alternative table ${altName} not found`);
            }
          }
          return;
        }
        
        console.log('🔍 Raw table data structure:', {
          count: allData?.length || 0,
          sampleRecord: allData?.[0],
          allFields: allData?.[0] ? Object.keys(allData[0]) : []
        });
        
        // Now try the specific query
        const { data, error } = await supabase
          .from('tenant_employee_prefered_category')
          .select('empoyee_id, maincategory_id');
        
        if (error) {
          console.error('❌ Error with specific query:', error);
          // Try with corrected column name
          const { data: correctedData, error: correctedError } = await supabase
            .from('tenant_employee_prefered_category')
            .select('employee_id, maincategory_id');
          
          if (!correctedError) {
            console.log('✅ Found data with corrected column name:', correctedData);
            setEmployeePreferredCategories(correctedData || []);
          } else {
            console.error('❌ Corrected query also failed:', correctedError);
          }
        } else {
          setEmployeePreferredCategories(data || []);
          console.log('🔍 Employee preferred categories loaded:', {
            count: data?.length || 0,
            sampleData: data?.slice(0, 5)
          });
        }
      } catch (error) {
        console.error('Error fetching employee preferred categories:', error);
      }
    };
    fetchEmployeePreferredCategories();
  }, []);

  // Helper function to format category display like calendar page
  const formatCategoryDisplay = (categoryId: any, fallbackCategoryName?: any) => {
    if (!categoryId || categoryId === '---') {
      // If no category_id, try to use the fallback category name
      if (fallbackCategoryName && fallbackCategoryName !== '---' && allCategories && allCategories.length > 0) {
        console.log('🔍 No category_id, trying fallback category name:', fallbackCategoryName);
        const categoryByName = allCategories.find((cat: any) => cat.name === fallbackCategoryName);
        if (categoryByName) {
          console.log('🔍 Found category by fallback name:', {
            categoryName: categoryByName.name,
            mainCategory: categoryByName.misc_maincategory?.name
          });
          
          if (categoryByName.misc_maincategory?.name) {
            return `${categoryByName.name} (${categoryByName.misc_maincategory.name})`;
          } else {
            return categoryByName.name;
          }
        }
      }
      return 'No Category';
    }
    
    if (!allCategories || allCategories.length === 0) {
      console.log('⚠️ Categories not loaded yet, returning category ID:', categoryId);
      return String(categoryId);
    }
    
    // First try to find by ID
    const categoryById = allCategories.find((cat: any) => cat.id.toString() === categoryId.toString());
    if (categoryById) {
      console.log('🔍 Found category by ID:', {
        categoryId,
        categoryName: categoryById.name,
        mainCategory: categoryById.misc_maincategory?.name
      });
      
      // Return category name with main category in parentheses (like calendar page)
      if (categoryById.misc_maincategory?.name) {
        return `${categoryById.name} (${categoryById.misc_maincategory.name})`;
      } else {
        return categoryById.name; // Fallback if no main category
      }
    }
    
    // If not found by ID, try to find by name (in case it's already a name)
    const categoryByName = allCategories.find((cat: any) => cat.name === categoryId);
    if (categoryByName) {
      console.log('🔍 Found category by name:', {
        categoryName: categoryByName.name,
        mainCategory: categoryByName.misc_maincategory?.name
      });
      
      // Return category name with main category in parentheses
      if (categoryByName.misc_maincategory?.name) {
        return `${categoryByName.name} (${categoryByName.misc_maincategory.name})`;
      } else {
        return categoryByName.name; // Fallback if no main category
      }
    }
    
    console.log('⚠️ Category not found:', { categoryId, fallbackCategoryName, allCategories: allCategories.slice(0, 3) });
    return String(categoryId); // Fallback to original value if not found
  };

  // Function to get employees who have preferred categories matching the displayed leads
  const getRelevantEmployees = () => {
    if (displayedMainCategoryIds.length === 0) {
      return employees; // If no main categories found, show all employees
    }

    // Get employee IDs who have any of the displayed main categories as preferred
    const relevantEmployeeIds = new Set<number>();
    
    employeePreferredCategories.forEach(pref => {
      if (displayedMainCategoryIds.includes(pref.maincategory_id)) {
        relevantEmployeeIds.add(pref.empoyee_id);
      }
    });

    // Filter employees to only include those with relevant preferred categories
    const filteredEmployees = employees.filter(emp => 
      relevantEmployeeIds.has(emp.id)
    );

    console.log('🔍 Employee filtering:', {
      totalEmployees: employees.length,
      displayedMainCategoryIds,
      relevantEmployeeIds: Array.from(relevantEmployeeIds),
      filteredEmployeesCount: filteredEmployees.length,
      filteredEmployeeNames: filteredEmployees.map(emp => emp.display_name)
    });

    return filteredEmployees;
  };

  // Fetch employee stats
  const fetchEmployeeStats = async () => {
    setLoadingStats(true);
    try {
      // First, let's debug what's in the leads_leadstage table
      console.log('🔍 Debug: Checking leads_leadstage table structure...');
      
      // Get sample data to understand the structure
      const { data: sampleData, error: sampleError } = await supabase
        .from('leads_leadstage')
        .select('*')
        .limit(5)
        .order('cdate', { ascending: false });

      if (sampleError) {
        console.error('❌ Error fetching sample data:', sampleError);
      } else {
        console.log('🔍 Sample leads_leadstage data:', {
          count: sampleData?.length || 0,
          sampleRecords: sampleData,
          dateRange: `${statsDateFilter.fromDate} to ${statsDateFilter.toDate}`
        });
      }

      // Check what stages exist
      const { data: stagesData, error: stagesError } = await supabase
        .from('leads_leadstage')
        .select('stage')
        .not('stage', 'is', null)
        .order('stage');

      if (!stagesError && stagesData) {
        const uniqueStages = [...new Set(stagesData.map(s => s.stage))];
        console.log('🔍 Available stages in leads_leadstage:', uniqueStages);
        
        // Check if stage 10 specifically exists
        const stage10Count = stagesData.filter(s => s.stage === 10).length;
        console.log('🔍 Stage 10 (Scheduler assigned) count:', stage10Count);
        
        // If stage 10 doesn't exist, let's see what stages might be scheduler-related
        const potentialSchedulerStages = stagesData.filter(s => 
          s.stage && (s.stage.toString().includes('10') || s.stage.toString().includes('1'))
        );
        console.log('🔍 Potential scheduler-related stages:', potentialSchedulerStages.slice(0, 10));
      }

      // Check date range of available data
      const { data: dateRangeData, error: dateRangeError } = await supabase
        .from('leads_leadstage')
        .select('cdate')
        .not('cdate', 'is', null)
        .order('cdate', { ascending: true })
        .limit(1);

      const { data: dateRangeDataMax, error: dateRangeMaxError } = await supabase
        .from('leads_leadstage')
        .select('cdate')
        .not('cdate', 'is', null)
        .order('cdate', { ascending: false })
        .limit(1);

      if (!dateRangeError && !dateRangeMaxError) {
        console.log('🔍 Date range in leads_leadstage:', {
          earliest: dateRangeData?.[0]?.cdate,
          latest: dateRangeDataMax?.[0]?.cdate,
          requestedRange: `${statsDateFilter.fromDate} to ${statsDateFilter.toDate}`
        });
      }

      // Step 1: Fetch scheduler assignments from leads_leadstage table (stage 10 = Scheduler assigned)
      const { data: schedulerAssignments, error: schedulerError } = await supabase
        .from('leads_leadstage')
        .select('lead_id, cdate')
        .eq('stage', 10) // Stage 10 = Scheduler assigned
        .gte('cdate', `${statsDateFilter.fromDate}T00:00:00`)
        .lte('cdate', `${statsDateFilter.toDate}T23:59:59`);

      if (schedulerError) throw schedulerError;

      console.log('🔍 Scheduler assignments found:', {
        count: schedulerAssignments?.length || 0,
        sampleAssignment: schedulerAssignments?.[0],
        dateRange: `${statsDateFilter.fromDate} to ${statsDateFilter.toDate}`
      });

      if (!schedulerAssignments || schedulerAssignments.length === 0) {
        // No assignments found, return empty stats for relevant employees only
        const relevantEmployees = getRelevantEmployees();
        const statsArray = relevantEmployees.map(emp => ({
          employee: emp.display_name,
          totalLeadsAssigned: 0,
          categoryBreakdown: []
        }));
        setEmployeeStats(statsArray);
        return;
      }

      // Step 2: Get lead IDs and fetch the corresponding leads with category info
      // Note: leads_leadstage.lead_id refers to legacy leads_lead table, not the new leads table
      const leadIds = schedulerAssignments.map(a => a.lead_id);
      const { data: leads, error: leadsError } = await supabase
        .from('leads_lead')
        .select(`
          id,
          meeting_scheduler_id,
          category,
          misc_category!category_id(
            name,
            misc_maincategory!parent_id(name)
          )
        `)
        .in('id', leadIds);

      if (leadsError) throw leadsError;

      console.log('🔍 Leads with scheduler info:', {
        count: leads?.length || 0,
        sampleLead: leads?.[0],
        availableEmployees: employees.slice(0, 3).map(emp => ({ id: emp.id, name: emp.display_name }))
      });

      // Process stats for each employee
      const statsMap = new Map();
      
      // Initialize stats for relevant employees only
      const relevantEmployees = getRelevantEmployees();
      relevantEmployees.forEach(emp => {
        statsMap.set(emp.display_name, {
          employee: emp.display_name,
          totalLeadsAssigned: 0,
          categoryBreakdown: new Map()
        });
      });

      // Count leads for each scheduler
      leads?.forEach(lead => {
        const schedulerId = lead.meeting_scheduler_id;
        
        // Skip invalid scheduler IDs
        if (!schedulerId || schedulerId === '---' || schedulerId === '' || schedulerId === 0) {
          return;
        }
        
        // We need to map scheduler ID to scheduler name
        const schedulerEmployee = employees.find(emp => emp.id.toString() === schedulerId.toString());
        const schedulerName = schedulerEmployee?.display_name;
        
        if (schedulerName && statsMap.has(schedulerName)) {
          const stats = statsMap.get(schedulerName);
          stats.totalLeadsAssigned++;
          
          // Category breakdown - use same format as calendar page
          const categoryName = (lead.misc_category as any)?.name || lead.category || 'Unknown';
          const mainCategory = (lead.misc_category as any)?.misc_maincategory?.name;
          const fullCategory = mainCategory ? `${categoryName} (${mainCategory})` : categoryName;
          
          const currentCount = stats.categoryBreakdown.get(fullCategory) || 0;
          stats.categoryBreakdown.set(fullCategory, currentCount + 1);
        }
      });

      // Convert to array format
      const statsArray = Array.from(statsMap.values()).map(stats => ({
        ...stats,
        categoryBreakdown: Array.from(stats.categoryBreakdown.entries()).map((entry) => ({
          category: (entry as [string, number])[0],
          count: (entry as [string, number])[1]
        }))
      }));

      setEmployeeStats(statsArray);
    } catch (error) {
      console.error('Error fetching employee stats:', error);
    } finally {
      setLoadingStats(false);
    }
  };

  // Fetch stats when date filter changes, employees are loaded, or displayed categories change
  useEffect(() => {
    if (employees.length > 0 && employeePreferredCategories.length > 0) {
      fetchEmployeeStats();
    }
  }, [statsDateFilter, employees, employeePreferredCategories, displayedMainCategoryIds]);


  // Get unique stages from current leads for the filter dropdown
  const availableStages = useMemo(() => {
    const stageSet = new Set<string>();
    leads.forEach(lead => {
      if (lead.stage) {
        // Use the mapped stage name for display
        const mappedStage = stageMapping.get(lead.stage) || stageMapping.get(lead.stage.toString()) || stageMapping.get(parseInt(lead.stage)) || lead.stage;
        stageSet.add(mappedStage);
      }
    });
    return Array.from(stageSet).sort();
  }, [leads, stageMapping]);

  // Filter leads based on stage
  const filteredLeads = useMemo(() => {
    return leads.filter(lead => {
      let matchesStage = true;
      if (stageFilter) {
        // Get the mapped stage name for comparison
        const mappedStage = stageMapping.get(lead.stage) || stageMapping.get(lead.stage.toString()) || stageMapping.get(parseInt(lead.stage)) || lead.stage;
        matchesStage = mappedStage === stageFilter;
      }
      return matchesStage;
    });
  }, [leads, stageFilter, stageMapping]);

  // Group leads by main category and initialize category selections
  useEffect(() => {
    if (filteredLeads.length === 0) {
      setCategoryGroupedLeads(new Map());
      return;
    }

    console.log('🔍 Grouping leads by category...');
    console.log('📊 Total filtered leads:', filteredLeads.length);
    console.log('📋 All categories loaded:', allCategories.length);

    const grouped = new Map<string, any[]>();
    const categorySelections = new Map<string, Set<string>>();
    const categoryAssigningStates = new Map<string, boolean>();

    filteredLeads.forEach((lead, index) => {
      console.log(`🔍 Lead ${index + 1}:`, {
        lead_number: lead.lead_number,
        category: lead.category,
        category_id: lead.category_id,
        misc_category: lead.misc_category,
        topic: lead.topic
      });

      let mainCategoryName = 'No Category';
      
      // Try to get main category from misc_category join
      if (lead.misc_category?.misc_maincategory?.name) {
        mainCategoryName = lead.misc_category.misc_maincategory.name;
        console.log(`✅ Found main category from join: ${mainCategoryName}`);
      } else if (lead.category_id) {
        // If no join data, try to find the main category from allCategories
        const category = allCategories.find(cat => cat.id.toString() === lead.category_id.toString());
        if (category?.misc_maincategory?.name) {
          mainCategoryName = category.misc_maincategory.name;
          console.log(`✅ Found main category from lookup: ${mainCategoryName}`);
        } else {
          console.log(`❌ No category found for category_id: ${lead.category_id}`);
        }
      } else if (lead.category) {
        // If using fallback category name, find the main category
        const category = allCategories.find(cat => cat.name === lead.category);
        if (category?.misc_maincategory?.name) {
          mainCategoryName = category.misc_maincategory.name;
          console.log(`✅ Found main category from fallback: ${mainCategoryName}`);
        } else {
          console.log(`❌ No main category found for category: ${lead.category}`);
        }
      }

      // Fallback: Extract main category from category name in parentheses
      if (mainCategoryName === 'No Category' && lead.category) {
        const match = lead.category.match(/\(([^)]+)\)/);
        if (match) {
          mainCategoryName = match[1];
          console.log(`✅ Extracted main category from parentheses: ${mainCategoryName}`);
        }
      }

      console.log(`📂 Assigning lead ${lead.lead_number} to category: ${mainCategoryName}`);

      // Add lead to the appropriate category group
      if (!grouped.has(mainCategoryName)) {
        grouped.set(mainCategoryName, []);
        categorySelections.set(mainCategoryName, new Set());
        categoryAssigningStates.set(mainCategoryName, false);
      }
      grouped.get(mainCategoryName)!.push(lead);
    });

    console.log('📊 Final grouped results:');
    grouped.forEach((leads, categoryName) => {
      console.log(`  ${categoryName}: ${leads.length} leads`);
    });

    // Initialize employee selections and lead selections for each category
    const leadSelections = new Map<string, Set<string>>();
    grouped.forEach((leads, categoryName) => {
      const categoryEmployees = getEmployeesForCategory(categoryName);
      const employeeNames = new Set(categoryEmployees.map(emp => emp.display_name));
      categorySelections.set(categoryName, employeeNames);
      
      // Initialize all leads as selected by default
      const allLeadIds = new Set(leads.map(lead => lead.id));
      leadSelections.set(categoryName, allLeadIds);
      
      console.log(`👥 Category ${categoryName} has ${categoryEmployees.length} relevant employees and ${leads.length} leads`);
    });

    setCategoryGroupedLeads(grouped);
    setCategorySelectedEmployees(categorySelections);
    setCategoryAssigning(categoryAssigningStates);
    setCategorySelectedLeads(leadSelections);
    
  }, [filteredLeads, allCategories, employees, employeePreferredCategories]);

  // Function to get employees for a specific main category
  const getEmployeesForCategory = (mainCategoryName: string) => {
    if (!employees.length || !employeePreferredCategories.length) {
      return employees;
    }

    // Find the main category ID
    const mainCategory = allCategories.find(cat => 
      cat.misc_maincategory?.name === mainCategoryName
    );
    
    if (!mainCategory?.misc_maincategory?.id) {
      return employees; // Return all employees if category not found
    }

    const mainCategoryId = mainCategory.misc_maincategory.id;
    
    // Get employee IDs who have this main category as preferred
    const relevantEmployeeIds = employeePreferredCategories
      .filter(pref => pref.maincategory_id === mainCategoryId)
      .map(pref => pref.empoyee_id);

    // Filter employees to only include those with this preferred category
    return employees.filter(emp => relevantEmployeeIds.includes(emp.id));
  };

  // Function to fetch employee stats for a specific category (using original working logic)
  const fetchCategoryEmployeeStats = async (categoryName: string) => {
    console.log(`🔍 Fetching stats for category: ${categoryName}`);
    console.log(`📅 Date filter: ${statsDateFilter.fromDate} to ${statsDateFilter.toDate}`);

    setCategoryLoadingStats(prev => {
      const newMap = new Map(prev);
      newMap.set(categoryName, true);
      return newMap;
    });

    try {
      // Get the main category ID
      const mainCategory = allCategories.find(cat => 
        cat.misc_maincategory?.name === categoryName
      );
      
      if (!mainCategory?.misc_maincategory?.id) {
        setCategoryEmployeeStats(prev => {
          const newMap = new Map(prev);
          newMap.set(categoryName, []);
          return newMap;
        });
        return;
      }

      const mainCategoryId = mainCategory.misc_maincategory.id;
      
      // Get employee IDs who have this main category as preferred
      const relevantEmployeeIds = employeePreferredCategories
        .filter(pref => pref.maincategory_id === mainCategoryId)
        .map(pref => pref.empoyee_id);

      // Step 1: Find stage changes to ID 10 (scheduler assigned) within date range
      const { data: schedulerAssignments, error: schedulerError } = await supabase
        .from('leads_leadstage')
        .select('lead_id, cdate')
        .eq('stage', 10) // Stage 10 = Scheduler assigned
        .gte('cdate', `${statsDateFilter.fromDate}T00:00:00`)
        .lte('cdate', `${statsDateFilter.toDate}T23:59:59`);

      if (schedulerError) throw schedulerError;

      console.log(`🔍 Scheduler assignments found for ${categoryName}:`, {
        count: schedulerAssignments?.length || 0,
        sampleAssignment: schedulerAssignments?.[0]
      });

      if (!schedulerAssignments || schedulerAssignments.length === 0) {
        setCategoryEmployeeStats(prev => {
          const newMap = new Map(prev);
          newMap.set(categoryName, []);
          return newMap;
        });
        return;
      }

      // Step 2: Get lead IDs and fetch the corresponding leads with category info
      const leadIds = schedulerAssignments.map(a => a.lead_id);
      const { data: leads, error: leadsError } = await supabase
        .from('leads_lead')
        .select(`
          id,
          meeting_scheduler_id,
          category,
          misc_category!category_id(
            name,
            misc_maincategory!parent_id(name)
          )
        `)
        .in('id', leadIds);

      if (leadsError) throw leadsError;

      console.log(`🔍 Leads with scheduler info for ${categoryName}:`, {
        count: leads?.length || 0,
        sampleLead: leads?.[0]
      });

      // Process stats for each employee
      const statsMap = new Map();
      
      // Initialize stats for relevant employees only
      const relevantEmployees = employees.filter(emp => relevantEmployeeIds.includes(emp.id));
      relevantEmployees.forEach(emp => {
        statsMap.set(emp.display_name, {
          employee: emp.display_name,
          totalLeadsAssigned: 0,
          categoryBreakdown: new Map()
        });
      });

      // Count leads for each scheduler
      leads?.forEach(lead => {
        const schedulerId = lead.meeting_scheduler_id;
        
        // Skip invalid scheduler IDs
        if (!schedulerId || schedulerId === '---' || schedulerId === '' || schedulerId === 0) {
          return;
        }
        
        // We need to map scheduler ID to scheduler name
        const schedulerEmployee = employees.find(emp => emp.id.toString() === schedulerId.toString());
        const schedulerName = schedulerEmployee?.display_name;
        
        if (schedulerName && statsMap.has(schedulerName)) {
          const stats = statsMap.get(schedulerName);
          stats.totalLeadsAssigned++;
          
          // Category breakdown - use same format as calendar page
          const categoryName = (lead.misc_category as any)?.name || lead.category || 'Unknown';
          const mainCategory = (lead.misc_category as any)?.misc_maincategory?.name;
          const fullCategory = mainCategory ? `${categoryName} (${mainCategory})` : categoryName;
          
          const currentCount = stats.categoryBreakdown.get(fullCategory) || 0;
          stats.categoryBreakdown.set(fullCategory, currentCount + 1);
        }
      });

      // Convert to array format
      const statsArray = Array.from(statsMap.values()).map(stats => ({
        ...stats,
        categoryBreakdown: Array.from(stats.categoryBreakdown.entries()).map((entry) => ({
          category: (entry as [string, number])[0],
          count: (entry as [string, number])[1]
        }))
      }));

      console.log(`✅ Final stats for ${categoryName}:`, {
        employeeCount: statsArray.length,
        stats: statsArray,
        totalProcessed: leads?.length || 0
      });
      
      setCategoryEmployeeStats(prev => {
        const newMap = new Map(prev);
        newMap.set(categoryName, statsArray);
        return newMap;
      });

    } catch (error) {
      console.error('Error fetching category employee stats:', error);
    } finally {
      setCategoryLoadingStats(prev => {
        const newMap = new Map(prev);
        newMap.set(categoryName, false);
        return newMap;
      });
    }
  };

  // Get unique topics from leads for dynamic category options
  const availableTopics = [...new Set(leads.map(lead => lead.topic).filter(Boolean))];
  const dynamicCategories = availableTopics.length > 0 ? availableTopics : categories;



  const handleCategoryAssignLeads = async (categoryName: string) => {
    const categoryLeads = categoryGroupedLeads.get(categoryName) || [];
    const selectedEmployees = categorySelectedEmployees.get(categoryName) || new Set();
    const selectedLeadIds = categorySelectedLeads.get(categoryName) || new Set();
    
    // Filter to only include selected leads
    const leadsToAssign = categoryLeads.filter(lead => selectedLeadIds.has(lead.id));
    
    if (selectedEmployees.size === 0 || leadsToAssign.length === 0) return;
    
    // Set assigning state for this category
    setCategoryAssigning(prev => {
      const newMap = new Map(prev);
      newMap.set(categoryName, true);
      return newMap;
    });
    
    try {
      // Get current user info from MSAL
      const account = instance?.getAllAccounts()[0];
      let currentUserFullName = account?.name || 'Unknown User';
      
      // Try to get full_name from database
      if (account?.username) {
        try {
          const { data: userData } = await supabase
            .from('users')
            .select('full_name')
            .eq('email', account.username)
            .single();
          
          if (userData?.full_name) {
            currentUserFullName = userData.full_name;
          }
        } catch (error) {
          console.log('Could not fetch user full_name, using account.name as fallback');
        }
      }

      const selectedEmployeeArray = Array.from(selectedEmployees);
      const leadsPerEmployee = Math.ceil(leadsToAssign.length / selectedEmployees.size);
      
      // Distribute leads evenly among selected employees
      for (let i = 0; i < selectedEmployeeArray.length; i++) {
        const employee = selectedEmployeeArray[i];
        const startIndex = i * leadsPerEmployee;
        const endIndex = Math.min(startIndex + leadsPerEmployee, leadsToAssign.length);
        const employeeLeads = leadsToAssign.slice(startIndex, endIndex);
        
        if (employeeLeads.length > 0) {
          const leadIds = employeeLeads.map(lead => lead.id);
          
          // Get the employee ID for the scheduler (creator_id in leads_leadstage)
          const { data: employeeData } = await supabase
            .from('tenants_employee')
            .select('id')
            .eq('display_name', employee)
            .single();
          
          const creatorId = employeeData?.id || null;
          
          // Update leads table
          const { error: leadsError } = await supabase
        .from('leads')
        .update({ 
              scheduler: employee, 
          stage: 'scheduler_assigned',
          stage_changed_by: currentUserFullName,
          stage_changed_at: new Date().toISOString()
        })
            .in('id', leadIds);

          if (leadsError) {
            throw leadsError;
          }
          
          // Insert records into leads_leadstage table for stage history
          const stageRecords = employeeLeads.map(lead => ({
            cdate: new Date().toISOString(),
            udate: new Date().toISOString(),
            stage: 10, // Stage 10 = Scheduler assigned
            date: new Date().toISOString(),
            creator_id: creatorId,
            lead_id: parseInt(lead.lead_number.replace('L', '')) // Convert L36 to 36, etc.
          }));
          
          const { error: stageError } = await supabase
            .from('leads_leadstage')
            .insert(stageRecords);

          if (stageError) {
            console.error('Error inserting stage records:', stageError);
            // Don't throw here as the main assignment succeeded
          }
        }
      }

      // Remove assigned leads from the current leads list
      const allLeadIds = leadsToAssign.map(lead => lead.id);
      setLeads(leads.filter(l => !allLeadIds.includes(l.id)));
      
      // Clear selections for this category
      setCategorySelectedEmployees(prev => {
        const newMap = new Map(prev);
        newMap.set(categoryName, new Set());
        return newMap;
      });
      
      setCategorySelectedLeads(prev => {
        const newMap = new Map(prev);
        newMap.set(categoryName, new Set());
        return newMap;
      });
      
      // Show success message
      const employeeNames = selectedEmployeeArray.join(', ');
      alert(`Successfully assigned ${leadsToAssign.length} lead(s) from ${categoryName} to: ${employeeNames}!`);
      
    } catch (error) {
      console.error('Error assigning leads:', error);
      alert('Failed to assign leads. Please try again.');
    } finally {
      // Clear assigning state for this category
      setCategoryAssigning(prev => {
        const newMap = new Map(prev);
        newMap.set(categoryName, false);
        return newMap;
      });
    }
  };

  const handleCardClick = (lead: any) => {
    navigate(`/clients/${lead.lead_number}`);
  };

  // Handler functions for lead box actions
  const handleAssignToScheduler = async (schedulerName?: string) => {
    if (selectedLeadBoxes.size === 0) return;
    
    // Get current user info from MSAL
    const account = instance?.getAllAccounts()[0];
    let currentUserFullName = account?.name || 'Unknown User';
    
    // Try to get full_name from database
    if (account?.username) {
      try {
        const { data: userData } = await supabase
          .from('users')
          .select('full_name')
          .eq('email', account.username)
          .single();
        
        if (userData?.full_name) {
          currentUserFullName = userData.full_name;
        }
      } catch (error) {
        console.log('Could not fetch user full_name, using account.name as fallback');
      }
    }

    try {
      const selectedLeadIds = Array.from(selectedLeadBoxes);
      const selectedLeads = leads.filter(lead => selectedLeadIds.includes(lead.id));
      
      // Update leads table
      const { error: leadsError } = await supabase
        .from('leads')
        .update({ 
          scheduler: schedulerName || null,
          stage: 'scheduler_assigned',
          stage_changed_by: currentUserFullName,
          stage_changed_at: new Date().toISOString()
        })
        .in('id', selectedLeadIds);

      if (leadsError) throw leadsError;
      
      // Get the employee ID for the selected scheduler
      let schedulerEmployeeId = null;
      if (schedulerName) {
        const schedulerEmployee = employees.find(emp => emp.display_name === schedulerName);
        schedulerEmployeeId = schedulerEmployee?.id || null;
      }

      // Insert records into leads_leadstage table for stage history
      const stageRecords = selectedLeads.map(lead => ({
        cdate: new Date().toISOString(),
        udate: new Date().toISOString(),
        stage: 10, // Stage 10 = Scheduler assigned
        date: new Date().toISOString(),
        creator_id: schedulerEmployeeId,
        lead_id: parseInt(lead.lead_number.replace('L', '')) // Convert L36 to 36, etc.
      }));
      
      const { error: stageError } = await supabase
        .from('leads_leadstage')
        .insert(stageRecords);

      if (stageError) {
        console.error('Error inserting stage records:', stageError);
      }

      // Remove assigned leads from the current leads list
      setLeads(leads.filter(l => !selectedLeadIds.includes(l.id)));
      
      // Clear selection
      setSelectedLeadBoxes(new Set());
      setShowActionButtons(false);
      setSchedulerSearchTerm('');
      setSelectedScheduler('');
      setShowSchedulerDropdown(false);
      
      const schedulerText = schedulerName ? ` to ${schedulerName}` : '';
      alert(`Successfully assigned ${selectedLeadIds.length} lead(s) to scheduler stage${schedulerText}!`);
      
    } catch (error) {
      console.error('Error assigning leads to scheduler:', error);
      alert('Failed to assign leads to scheduler. Please try again.');
    }
  };

  const handleSetCategory = async (categoryName: string) => {
    if (selectedLeadBoxes.size === 0) return;
    
    try {
      const selectedLeadIds = Array.from(selectedLeadBoxes);
      
      // Extract just the category name (remove the parent category part)
      const cleanCategoryName = categoryName.includes(' (') ? categoryName.split(' (')[0] : categoryName;
      
      // Find the category ID from the formatted name
      const category = allCategories.find(cat => {
        const formattedName = cat.misc_maincategory 
          ? `${cat.name} (${cat.misc_maincategory.name})`
          : cat.name;
        return formattedName === categoryName;
      });
      
      if (!category) {
        alert('Category not found. Please try again.');
        return;
      }
      
      // Update leads table with category_id
      const { error: leadsError } = await supabase
        .from('leads')
        .update({ 
          category_id: category.id,
          category: cleanCategoryName
        })
        .in('id', selectedLeadIds);

      if (leadsError) throw leadsError;
      
      // Remove updated leads from the current leads list
      setLeads(leads.filter(l => !selectedLeadIds.includes(l.id)));
      
      // Clear selection
      setSelectedLeadBoxes(new Set());
      setShowActionButtons(false);
      setCategorySearchTerm('');
      setSelectedCategory('');
      setShowCategoryDropdown(false);
      
      alert(`Successfully updated category to "${cleanCategoryName}" for ${selectedLeadIds.length} lead(s)!`);
      
    } catch (error) {
      console.error('Error updating category:', error);
      alert('Failed to update category. Please try again.');
    }
  };

  const handleDropLeads = async () => {
    if (selectedLeadBoxes.size === 0) return;
    
    const confirmDrop = confirm(`Are you sure you want to drop ${selectedLeadBoxes.size} lead(s)? This will change their stage to "Dropped".`);
    if (!confirmDrop) return;

    try {
      const selectedLeadIds = Array.from(selectedLeadBoxes);
      
      // Update leads table - change stage to 91 (Dropped)
      const { error: leadsError } = await supabase
        .from('leads')
        .update({ 
          stage: 91, // Stage 91 = Dropped
          stage_changed_at: new Date().toISOString()
        })
        .in('id', selectedLeadIds);

      if (leadsError) throw leadsError;
      
      // Insert records into leads_leadstage table for stage history
      const selectedLeads = leads.filter(lead => selectedLeadIds.includes(lead.id));
      const stageRecords = selectedLeads.map(lead => ({
        cdate: new Date().toISOString(),
        udate: new Date().toISOString(),
        stage: 91, // Stage 91 = Dropped
        date: new Date().toISOString(),
        creator_id: null,
        lead_id: parseInt(lead.lead_number.replace('L', '')) // Convert L36 to 36, etc.
      }));
      
      const { error: stageError } = await supabase
        .from('leads_leadstage')
        .insert(stageRecords);

      if (stageError) {
        console.error('Error inserting stage records:', stageError);
      }

      // Remove dropped leads from the current leads list
      setLeads(leads.filter(l => !selectedLeadIds.includes(l.id)));
      
      // Clear selection
      setSelectedLeadBoxes(new Set());
      setShowActionButtons(false);
      
      alert(`Successfully dropped ${selectedLeadIds.length} lead(s)!`);
      
    } catch (error) {
      console.error('Error dropping leads:', error);
      alert('Failed to drop leads. Please try again.');
    }
  };

  // Re-assign leads search function
  const handleReassignSearch = async () => {
    setReassignLoading(true);
    try {
      // Search in both leads and leads_lead tables
      const searchPromises = [];

      // Search in leads table (new leads)
      let leadsQuery = supabase
        .from('leads')
        .select(`
          id,
          lead_number,
          name,
          created_at,
          scheduler,
          category,
          source,
          language,
          stage
        `);

      // Apply filters to leads table
      if (reassignFilters.fromDate) {
        leadsQuery = leadsQuery.gte('created_at', `${reassignFilters.fromDate}T00:00:00`);
      }
      if (reassignFilters.toDate) {
        leadsQuery = leadsQuery.lte('created_at', `${reassignFilters.toDate}T23:59:59`);
      }
      if (reassignFilters.category) {
        leadsQuery = leadsQuery.ilike('category', `%${reassignFilters.category}%`);
      }
      if (reassignFilters.source) {
        // For new leads, we need to convert source name to match the source field
        // The source field in leads table stores the source name directly
        leadsQuery = leadsQuery.eq('source', reassignFilters.source);
      }
      if (reassignFilters.status) {
        // For new leads, stage can be either string or numeric
        leadsQuery = leadsQuery.eq('stage', reassignFilters.status);
      }
      if (reassignFilters.language) {
        // For new leads, we need to convert language name to match the language field
        // The language field in leads table stores the language name directly
        leadsQuery = leadsQuery.eq('language', reassignFilters.language);
      }
      if (reassignFilters.stage) {
        // For new leads, we need to convert stage name to ID
        const stage = stages.find(s => s.name === reassignFilters.stage);
        if (stage) {
          leadsQuery = leadsQuery.eq('stage', stage.id);
        }
      }
      if (reassignFilters.meetingScheduler) {
        leadsQuery = leadsQuery.ilike('scheduler', `%${reassignFilters.meetingScheduler}%`);
      }

      searchPromises.push(leadsQuery.order('created_at', { ascending: false }));

      // Search in leads_lead table (legacy leads)
      let legacyLeadsQuery = supabase
        .from('leads_lead')
        .select(`
          id,
          lead_number,
          name,
          cdate,
          meeting_scheduler_id,
          category,
          source_id,
          language_id,
          stage
        `);

      // Apply filters to leads_lead table (use cdate instead of created_at)
      if (reassignFilters.fromDate) {
        legacyLeadsQuery = legacyLeadsQuery.gte('cdate', `${reassignFilters.fromDate}T00:00:00`);
      }
      if (reassignFilters.toDate) {
        legacyLeadsQuery = legacyLeadsQuery.lte('cdate', `${reassignFilters.toDate}T23:59:59`);
      }
      if (reassignFilters.category) {
        legacyLeadsQuery = legacyLeadsQuery.ilike('category', `%${reassignFilters.category}%`);
      }
      if (reassignFilters.source) {
        // For legacy leads, we need to convert source name to ID
        // We'll do a lookup to find the source ID
        try {
          const { data: sourceData } = await supabase
            .from('misc_leadsource')
            .select('id')
            .eq('name', reassignFilters.source)
            .single();
          
          if (sourceData) {
            legacyLeadsQuery = legacyLeadsQuery.eq('source_id', sourceData.id);
          }
        } catch (error) {
          console.log('Could not find source ID for:', reassignFilters.source);
        }
      }
      if (reassignFilters.status) {
        // For legacy leads, stage is always numeric ID, so we need to convert string to number
        const stageId = parseInt(reassignFilters.status);
        if (!isNaN(stageId)) {
          legacyLeadsQuery = legacyLeadsQuery.eq('stage', stageId);
        }
      }
      if (reassignFilters.language) {
        // For legacy leads, we need to convert language name to ID
        try {
          const { data: languageData } = await supabase
            .from('misc_language')
            .select('id')
            .eq('name', reassignFilters.language)
            .single();
          
          if (languageData) {
            legacyLeadsQuery = legacyLeadsQuery.eq('language_id', languageData.id);
          }
        } catch (error) {
          console.log('Could not find language ID for:', reassignFilters.language);
        }
      }
      if (reassignFilters.stage) {
        // For legacy leads, we need to convert stage name to ID
        const stage = stages.find(s => s.name === reassignFilters.stage);
        if (stage) {
          legacyLeadsQuery = legacyLeadsQuery.eq('stage', stage.id);
        }
      }
      if (reassignFilters.meetingScheduler) {
        // For legacy leads, we need to join with employees to get the scheduler name
        // First get employee ID from name, then filter by meeting_scheduler_id
        const employee = employees.find(emp => emp.display_name === reassignFilters.meetingScheduler);
        if (employee) {
          legacyLeadsQuery = legacyLeadsQuery.eq('meeting_scheduler_id', employee.id);
        }
      }

      searchPromises.push(legacyLeadsQuery.order('cdate', { ascending: false }));

      // Execute both queries
      const [leadsResult, legacyLeadsResult] = await Promise.all(searchPromises);

      if (leadsResult.error) throw leadsResult.error;
      if (legacyLeadsResult.error) throw legacyLeadsResult.error;

      // Debug logging
      console.log('🔍 New leads result:', leadsResult.data);
      console.log('🔍 Legacy leads result:', legacyLeadsResult.data);
      console.log('🔍 Employees for scheduler mapping:', employees.slice(0, 3));

      // Combine results and normalize the data structure
      let allResults = [
        ...(leadsResult.data || []).map(lead => ({
          ...lead,
          lead_type: 'new',
          scheduler: lead.scheduler || 'Unassigned', // New leads have scheduler field directly
          created_at: lead.created_at, // New leads use created_at
          source: lead.source || 'Unknown', // New leads have source field directly
          language: lead.language || 'Unknown', // New leads have language field directly
        })),
        ...(legacyLeadsResult.data || []).map(lead => ({
          ...lead,
          lead_type: 'legacy',
          scheduler: lead.meeting_scheduler_id ? 
            employees.find(emp => emp.id === lead.meeting_scheduler_id)?.display_name || 'Unknown' : 
            'Unassigned',
          created_at: lead.cdate, // Legacy leads use cdate, map to created_at for consistency
          source: lead.source_id ? `Source ID: ${lead.source_id}` : 'Unknown', // Legacy leads have source_id
          language: lead.language_id ? `Language ID: ${lead.language_id}` : 'Unknown', // Legacy leads have language_id
        }))
      ];

      console.log('🔍 Combined results:', allResults);

      // Post-process filtering for legacy leads (since they use IDs instead of names)
      if (reassignFilters.source || reassignFilters.language) {
        allResults = allResults.filter(lead => {
          if (lead.lead_type === 'new') {
            // For new leads, apply the filters normally
            const sourceMatch = !reassignFilters.source || 
              (lead.source && lead.source.toLowerCase().includes(reassignFilters.source.toLowerCase()));
            const languageMatch = !reassignFilters.language || 
              (lead.language && lead.language.toLowerCase().includes(reassignFilters.language.toLowerCase()));
            return sourceMatch && languageMatch;
          } else {
            // For legacy leads, we can't filter by source/language names since they're IDs
            // For now, we'll include all legacy leads and let the user see them
            // In a full implementation, you'd need to join with source/language lookup tables
            return true;
          }
        });
      }

      setReassignResults(allResults);
    } catch (error) {
      console.error('Error searching leads for re-assignment:', error);
      alert('Failed to search leads. Please try again.');
    } finally {
      setReassignLoading(false);
    }
  };

  // Re-assign leads function
  const handleReassignLeads = async () => {
    if (reassignResults.length === 0 || !selectedEmployeeForReassign) {
      alert('Please search for leads first and select an employee to assign them to.');
      return;
    }

    const confirmReassign = confirm(`Are you sure you want to re-assign ${reassignResults.length} lead(s) to ${selectedEmployeeForReassign}?`);
    if (!confirmReassign) return;

    setReassigning(true);
    try {
      // Get current user info from MSAL
      const account = instance?.getAllAccounts()[0];
      let currentUserFullName = account?.name || 'Unknown User';
      
      // Try to get full_name from database
      if (account?.username) {
        try {
          const { data: userData } = await supabase
            .from('users')
            .select('full_name')
            .eq('email', account.username)
            .single();
          
          if (userData?.full_name) {
            currentUserFullName = userData.full_name;
          }
        } catch (error) {
          console.log('Could not fetch user full_name, using account.name as fallback');
        }
      }

      // Get the employee ID for the selected scheduler
      const selectedEmployee = employees.find(emp => emp.display_name === selectedEmployeeForReassign);
      if (!selectedEmployee) {
        throw new Error('Selected employee not found');
      }

      // Separate new leads and legacy leads
      const newLeads = reassignResults.filter(lead => lead.lead_type === 'new');
      const legacyLeads = reassignResults.filter(lead => lead.lead_type === 'legacy');

      // Update new leads (leads table)
      if (newLeads.length > 0) {
        const newLeadIds = newLeads.map(lead => lead.id);
        const { error: newLeadsError } = await supabase
          .from('leads')
          .update({ 
            scheduler: selectedEmployeeForReassign,
            stage_changed_by: currentUserFullName,
            stage_changed_at: new Date().toISOString()
          })
          .in('id', newLeadIds);

        if (newLeadsError) throw newLeadsError;
      }

      // Update legacy leads (leads_lead table)
      if (legacyLeads.length > 0) {
        const legacyLeadIds = legacyLeads.map(lead => lead.id);
        const { error: legacyLeadsError } = await supabase
          .from('leads_lead')
          .update({ 
            meeting_scheduler_id: selectedEmployee.id,
            stage_changed_by: currentUserFullName,
            stage_changed_at: new Date().toISOString()
          })
          .in('id', legacyLeadIds);

        if (legacyLeadsError) throw legacyLeadsError;
      }

      // Insert records into leads_leadstage table for stage history
      const stageRecords = reassignResults.map(lead => ({
        cdate: new Date().toISOString(),
        udate: new Date().toISOString(),
        stage: lead.stage,
        date: new Date().toISOString(),
        creator_id: selectedEmployee.id,
        lead_id: lead.lead_number ? parseInt(lead.lead_number.replace('L', '')) : lead.id // Convert L36 to 36, etc., fallback to lead.id
      }));
      
      const { error: stageError } = await supabase
        .from('leads_leadstage')
        .insert(stageRecords);

      if (stageError) {
        console.error('Error inserting stage records:', stageError);
      }

      alert(`Successfully re-assigned ${reassignResults.length} lead(s) to ${selectedEmployeeForReassign}!`);
      
      // Clear results and close modal
      setReassignResults([]);
      setSelectedEmployeeForReassign('');
      setShowReassignModal(false);
      
    } catch (error) {
      console.error('Error re-assigning leads:', error);
      alert('Failed to re-assign leads. Please try again.');
    } finally {
      setReassigning(false);
    }
  };

  const handleInactiveLeads = async () => {
    if (selectedLeadBoxes.size === 0) return;
    
    // Use custom reason if provided, otherwise use selected reason
    const inactiveReason = customInactiveReason.trim() || selectedInactiveReason;
    if (!inactiveReason) {
      alert('Please select an unactivation reason or enter a custom reason first.');
      return;
    }
    
    const confirmInactive = confirm(`Are you sure you want to mark ${selectedLeadBoxes.size} lead(s) as inactive with reason: "${inactiveReason}"?`);
    if (!confirmInactive) return;

    try {
      const selectedLeadIds = Array.from(selectedLeadBoxes);
      
      // Get current user info from MSAL
      const account = instance?.getAllAccounts()[0];
      let currentUserFullName = account?.name || 'Unknown User';
      
      // Try to get full_name from database
      if (account?.username) {
        try {
          const { data: userData } = await supabase
            .from('users')
            .select('full_name')
            .eq('email', account.username)
            .single();
          
          if (userData?.full_name) {
            currentUserFullName = userData.full_name;
          }
        } catch (error) {
          console.log('Could not fetch user full_name, using account.name as fallback');
        }
      }
      
      // Update leads table - mark as inactive and change stage to 91 (Dropped/Spam/Irrelevant)
      const { error: leadsError } = await supabase
        .from('leads')
        .update({ 
          unactivated_by: currentUserFullName,
          unactivated_at: new Date().toISOString(),
          unactivation_reason: inactiveReason, // Save the selected reason
          stage: 91, // Change stage to 91 (Dropped/Spam/Irrelevant) so it shows up as inactive in clients page
          stage_changed_at: new Date().toISOString()
        })
        .in('id', selectedLeadIds);

      if (leadsError) throw leadsError;
      
      // Insert records into leads_leadstage table for stage history
      const selectedLeads = leads.filter(lead => selectedLeadIds.includes(lead.id));
      const stageRecords = selectedLeads.map(lead => ({
        cdate: new Date().toISOString(),
        udate: new Date().toISOString(),
        stage: 91, // Stage 91 = Dropped/Spam/Irrelevant (inactive)
        date: new Date().toISOString(),
        creator_id: null,
        lead_id: parseInt(lead.lead_number.replace('L', '')) // Convert L36 to 36, etc.
      }));
      
      const { error: stageError } = await supabase
        .from('leads_leadstage')
        .insert(stageRecords);

      if (stageError) {
        console.error('Error inserting stage records:', stageError);
      }

      // Remove inactive leads from the current leads list
      setLeads(leads.filter(l => !selectedLeadIds.includes(l.id)));
      
      // Clear selection
      setSelectedLeadBoxes(new Set());
      setShowActionButtons(false);
      setCustomInactiveReason('');
      setSelectedInactiveReason('');
      setShowInactiveDropdown(false);
      
      alert(`Successfully marked ${selectedLeadIds.length} lead(s) as inactive with reason: "${inactiveReason}"!`);
      
    } catch (error) {
      console.error('Error marking leads as inactive:', error);
      alert('Failed to mark leads as inactive. Please try again.');
    }
  };


  return (
    <div className="p-8">
      {/* Re-assign Leads Button */}
      <div className="mb-6">
        <button 
          className="btn btn-primary"
          onClick={() => setShowReassignModal(true)}
        >
          Re-assign Leads
        </button>
      </div>

      {/* Filters Section */}
      <div className="mb-8 p-6 bg-base-100 border border-base-200 rounded-lg shadow-sm">
        <h3 className="text-lg font-semibold mb-4">Filters</h3>
        
        {/* Stage Filter and Employee Stats Date Range */}
        <div className="flex gap-4 items-end">
          <div className="flex-1">
            <label className="block text-sm font-medium mb-2">Filter by Stage</label>
            <select 
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value)}
              className="select select-bordered w-full"
            >
              <option value="">All Stages</option>
              {availableStages.map((stage) => (
                <option key={stage} value={stage}>
                  {stage}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium mb-2">Employee Stats Date Range</label>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="block text-sm font-medium mb-2">From Date</label>
                <input 
                  type="date" 
                  value={statsDateFilter.fromDate}
                  onChange={(e) => setStatsDateFilter(prev => ({ ...prev, fromDate: e.target.value }))}
                  className="input input-bordered w-full"
                  defaultValue={new Date().toISOString().split('T')[0]}
                />
              </div>
              <div className="flex-1">
                <label className="block text-sm font-medium mb-2">To Date</label>
                <input 
                  type="date" 
                  value={statsDateFilter.toDate}
                  onChange={(e) => setStatsDateFilter(prev => ({ ...prev, toDate: e.target.value }))}
                  className="input input-bordered w-full"
                  defaultValue={new Date().toISOString().split('T')[0]}
                />
              </div>
            </div>
          </div>
        </div>
        <div className="mt-4 flex gap-3">
          <button 
            className="btn btn-primary btn-sm"
            onClick={() => {
              // Trigger stats refresh for all categories
              Array.from(categoryGroupedLeads.keys()).forEach(categoryName => {
                fetchCategoryEmployeeStats(categoryName);
              });
            }}
          >
            Update All Stats
          </button>
          <button 
            className="btn btn-outline btn-sm"
            onClick={() => {
              setStageFilter('');
              setStatsDateFilter({
                fromDate: new Date().toISOString().split('T')[0],
                toDate: new Date().toISOString().split('T')[0]
              });
            }}
          >
            Clear Filters
          </button>
        </div>
        </div>


      {/* Category Grouped Tables */}
      {categoryGroupedLeads.size > 0 && (
        <div className="mt-12">
          <h2 className="text-2xl font-bold mb-8">
            Assign Leads to Employees ({Array.from(categoryGroupedLeads.values()).reduce((sum, leads) => sum + leads.length, 0)} total leads)
          </h2>
          <div className="space-y-12">
            {Array.from(categoryGroupedLeads.entries()).map(([categoryName, categoryLeads]) => (
              <div key={categoryName} className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Category Table */}
                <div className="lg:col-span-1">
                  <div className="card bg-base-100 shadow-lg">
                    <div className="card-header p-6 border-b border-base-200">
                      <h3 className="text-xl font-semibold flex items-center gap-2">
                        <CalendarIcon className="w-5 h-5" />
                        {categoryName} ({categoryLeads.length} leads)
                      </h3>
      </div>
                    <div className="card-body p-6">
                      {categoryLeads.length === 0 ? (
        <div className="text-center py-12 text-base-content/60">
                          No leads in this category.
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="table table-zebra w-full">
                            <thead>
                              <tr>
                                <th className="font-semibold">
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="checkbox"
                                      className="checkbox checkbox-sm"
                                      checked={categorySelectedLeads.get(categoryName)?.size === categoryLeads.length && categoryLeads.length > 0}
                                      onChange={(e) => {
                                        const newSelected = new Set<string>();
                                        if (e.target.checked) {
                                          categoryLeads.forEach(lead => newSelected.add(lead.id));
                                        }
                                        setCategorySelectedLeads(prev => {
                                          const newMap = new Map(prev);
                                          newMap.set(categoryName, newSelected);
                                          return newMap;
                                        });
                                      }}
                                    />
                                    <span>Select All</span>
                                  </div>
                                </th>
                                <th className="font-semibold">Lead Number</th>
                                <th className="font-semibold">Stage</th>
                                <th className="font-semibold">Category</th>
                                <th className="font-semibold">Source</th>
                              </tr>
                            </thead>
                            <tbody>
                              {categoryLeads.map(lead => (
                                <tr key={lead.id} className="hover">
                                  <td>
                                    <div className="flex items-center gap-2">
                                      <input
                                        type="checkbox"
                                        className="checkbox checkbox-sm"
                                        checked={categorySelectedLeads.get(categoryName)?.has(lead.id) || false}
                                        onChange={(e) => {
                                          e.stopPropagation();
                                          setCategorySelectedLeads(prev => {
                                            const newMap = new Map(prev);
                                            const currentSelection = newMap.get(categoryName) || new Set();
                                            const newSelection = new Set(currentSelection);
                                            
                                            if (e.target.checked) {
                                              newSelection.add(lead.id);
                                            } else {
                                              newSelection.delete(lead.id);
                                            }
                                            
                                            newMap.set(categoryName, newSelection);
                                            return newMap;
                                          });
                                        }}
                                      />
                                      {categorySelectedLeads.get(categoryName)?.has(lead.id) && (
                                        <svg className="w-5 h-5 text-green-600 font-bold" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="3">
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                        </svg>
                                      )}
                                    </div>
                                  </td>
                                  <td className="font-medium cursor-pointer" onClick={() => handleCardClick(lead)}>{lead.lead_number}</td>
                                  <td className="cursor-pointer" onClick={() => handleCardClick(lead)}>
                                    {stageMapping.get(lead.stage) || lead.stage || 'Created'}
                                  </td>
                                  <td className="cursor-pointer" onClick={() => handleCardClick(lead)}>
                                    {formatCategoryDisplay(lead.category_id, lead.category || lead.topic)}
                                  </td>
                                  <td className="cursor-pointer" onClick={() => handleCardClick(lead)}>
                                    {lead.source || 'Unknown'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
          </div>
        </div>
      </div>

                {/* Category Employee Selection */}
                <div className="lg:col-span-1">
                  <div className="card bg-base-100 shadow-lg">
                    <div className="card-header p-6 border-b border-base-200">
                      <h3 className="text-xl font-semibold flex items-center gap-2">
                        <UserIcon className="w-5 h-5" />
                        {categoryName} - Employee Selection
                      </h3>
                    </div>
                    <div className="card-body p-6">

                      {categoryLoadingStats.get(categoryName) ? (
                        <div className="text-center py-8">
                          <span className="loading loading-spinner loading-md"></span>
                          <p className="mt-2 text-sm">Loading stats...</p>
        </div>
      ) : (
                        <div className="space-y-4 max-h-96 overflow-y-auto">
                          {getEmployeesForCategory(categoryName).map((emp, index) => {
                            const empStats = categoryEmployeeStats.get(categoryName)?.find(stat => stat.employee === emp.display_name);
                            return (
                              <div 
                                key={index} 
                                className={`border rounded-lg p-4 cursor-pointer transition-all duration-300 border-base-200 hover:border-primary/50 bg-base-100 shadow-lg hover:shadow-xl hover:-translate-y-1 transform`}
                                onClick={() => {
                                  const currentSelection = categorySelectedEmployees.get(categoryName) || new Set();
                                  const newSelected = new Set(currentSelection);
                                  if (currentSelection.has(emp.display_name)) {
                                    newSelected.delete(emp.display_name);
                                  } else {
                                    newSelected.add(emp.display_name);
                                  }
                                  setCategorySelectedEmployees(prev => {
                                    const newMap = new Map(prev);
                                    newMap.set(categoryName, newSelected);
                                    return newMap;
                                  });
                                }}
                              >
                                <div className="flex items-center justify-between mb-3">
                                  <div className="flex items-center gap-2">
                                    {categorySelectedEmployees.get(categoryName)?.has(emp.display_name) && (
                                      <svg className="w-6 h-6 text-green-600 font-bold" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="3">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                      </svg>
                                    )}
                                    <h4 className="font-semibold text-base">{emp.display_name}</h4>
                                  </div>
                                  <div className="flex items-center gap-2">
                <span className="badge badge-primary">
                                      {empStats?.totalLeadsAssigned || 0} leads
                </span>
              </div>
                                </div>
                                
                                {empStats?.categoryBreakdown && empStats.categoryBreakdown.length > 0 ? (
                                  <div className="bg-base-200/50 rounded-lg border border-base-300">
                                    {/* Collapsible Header */}
                                    <button
                                      className="w-full p-3 flex items-center justify-between hover:bg-base-200/70 transition-colors rounded-t-lg"
                                      onClick={() => {
                                        const key = `${categoryName}-${emp.display_name}`;
                                        setExpandedCategoryBreakdowns(prev => {
                                          const newMap = new Map(prev);
                                          newMap.set(key, !prev.get(key));
                                          return newMap;
                                        });
                                      }}
                                    >
                                      <span className="text-sm font-medium text-base-content/80">
                                        Category Breakdown ({empStats.categoryBreakdown.length})
                                      </span>
                                      <svg 
                                        className={`w-4 h-4 transition-transform duration-200 ${expandedCategoryBreakdowns.get(`${categoryName}-${emp.display_name}`) ? 'rotate-180' : ''}`}
                                        fill="none" 
                                        stroke="currentColor" 
                                        viewBox="0 0 24 24"
                                      >
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                                      </svg>
                                    </button>
                                    
                                    {/* Collapsible Content */}
                                    {expandedCategoryBreakdowns.get(`${categoryName}-${emp.display_name}`) && (
                                      <div className="p-3 pt-0 space-y-2">
                                        {empStats.categoryBreakdown.map((cat: any, catIndex: number) => (
                                          <div key={catIndex} className="flex justify-between items-center bg-base-100 rounded-md px-3 py-2 border border-base-300">
                                            <span className="text-sm font-medium text-base-content truncate flex-1 mr-3">{cat.category}</span>
                                            <span className="badge badge-secondary badge-sm font-semibold min-w-[2rem] justify-center">{cat.count}</span>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <div className="bg-base-200/30 rounded-lg p-3 border border-base-300">
                                    <p className="text-sm text-base-content/60 italic text-center">
                                      No assignments in this period
                                    </p>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                      
                      {/* Category Assign Button */}
                      {categorySelectedEmployees.get(categoryName) && categorySelectedEmployees.get(categoryName)!.size > 0 && (categorySelectedLeads.get(categoryName)?.size || 0) > 0 && (
                        <div className="mt-6 p-4 border-t border-base-200">
                          <div className="text-center">
                            <p className="text-sm text-base-content/70 mb-3">
                              {categorySelectedEmployees.get(categoryName)?.size === 1 ? (
                                <>Assign {categorySelectedLeads.get(categoryName)?.size || 0} selected {categoryName} leads to <span className="font-semibold text-primary">{Array.from(categorySelectedEmployees.get(categoryName) || [])[0]}</span> as scheduler?</>
                              ) : (
                                <>Assign {categorySelectedLeads.get(categoryName)?.size || 0} selected {categoryName} leads to <span className="font-semibold text-primary">{categorySelectedEmployees.get(categoryName)?.size} selected employees</span> as scheduler?</>
                              )}
                            </p>
                <button 
                              className={`btn btn-primary w-full ${categoryAssigning.get(categoryName) ? 'loading' : ''}`}
                              onClick={() => handleCategoryAssignLeads(categoryName)}
                              disabled={categoryAssigning.get(categoryName) || (categorySelectedLeads.get(categoryName)?.size || 0) === 0}
                            >
                              {categoryAssigning.get(categoryName) ? (
                                <>
                                  <span className="loading loading-spinner loading-sm"></span>
                                  Assigning...
                                </>
                              ) : (
                                `Assign ${categorySelectedLeads.get(categoryName)?.size || 0} Lead${(categorySelectedLeads.get(categoryName)?.size || 0) !== 1 ? 's' : ''}`
                              )}
                            </button>
                            {categoryLeads.length === 0 && (
                              <p className="text-xs text-base-content/50 mt-2">No leads available to assign</p>
                            )}
                            <div className="mt-2">
                              <button 
                                className="btn btn-sm btn-outline"
                                onClick={() => {
                                  setCategorySelectedEmployees(prev => {
                                    const newMap = new Map(prev);
                                    newMap.set(categoryName, new Set());
                                    return newMap;
                                  });
                                }}
                              >
                                Clear Selection
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
            </div>
        </div>
      )}

      {/* All Leads Cards Section */}
      {leads.length > 0 && (
        <div className="mt-12">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold">
              All Leads ({leads.length} total)
            </h2>
            {selectedLeadBoxes.size > 0 && (
              <div className="text-sm text-base-content/70">
                {selectedLeadBoxes.size} selected
              </div>
            )}
          </div>

          {/* Action Buttons */}
          {showActionButtons && selectedLeadBoxes.size > 0 && (
            <div className="mb-6 p-4 bg-base-100 border border-base-200 rounded-lg shadow-sm">
              <h3 className="text-lg font-semibold mb-4">Actions for {selectedLeadBoxes.size} selected lead(s)</h3>
              <div className="flex gap-3 flex-wrap">
                <div className="relative scheduler-dropdown-container">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Search employee..."
                      className="input input-bordered input-sm w-64"
                      value={schedulerSearchTerm}
                      onChange={(e) => {
                        setSchedulerSearchTerm(e.target.value);
                        setShowSchedulerDropdown(e.target.value.length > 0);
                      }}
                      onFocus={() => {
                        if (schedulerSearchTerm.length > 0) {
                          setShowSchedulerDropdown(true);
                        }
                      }}
                    />
                    <button 
                      className="btn btn-primary btn-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (schedulerSearchTerm.trim() && selectedScheduler) {
                          handleAssignToScheduler(selectedScheduler);
                        }
                      }}
                      disabled={!selectedScheduler || !schedulerSearchTerm.trim()}
                    >
                      Assign
                    </button>
                  </div>
                  {showSchedulerDropdown && (
                    <div className="absolute top-full left-0 mt-1 z-50 bg-base-100 border border-base-200 rounded-lg shadow-lg w-64 max-h-80 overflow-y-auto">
                      <div className="p-2">
                        {employees
                          .filter(emp => 
                            emp.display_name.toLowerCase().includes(schedulerSearchTerm.toLowerCase())
                          )
                          .map((emp) => (
                            <button 
                              key={emp.id}
                              className="w-full text-left px-3 py-2 hover:bg-base-200 rounded-md transition-colors"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedScheduler(emp.display_name);
                                setSchedulerSearchTerm(emp.display_name);
                                setShowSchedulerDropdown(false);
                              }}
                            >
                              {emp.display_name}
                            </button>
                          ))}
                        {employees.filter(emp => 
                          emp.display_name.toLowerCase().includes(schedulerSearchTerm.toLowerCase())
                        ).length === 0 && (
                          <div className="px-3 py-2 text-sm text-base-content/60">
                            No employees found
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                <div className="relative category-dropdown-container">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Search category..."
                      className="input input-bordered input-sm w-64"
                      value={categorySearchTerm}
                      onChange={(e) => {
                        setCategorySearchTerm(e.target.value);
                        setShowCategoryDropdown(e.target.value.length > 0);
                      }}
                      onFocus={() => {
                        if (categorySearchTerm.length > 0) {
                          setShowCategoryDropdown(true);
                        }
                      }}
                    />
                    <button 
                      className="btn btn-primary btn-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (categorySearchTerm.trim() && selectedCategory) {
                          handleSetCategory(selectedCategory);
                        }
                      }}
                      disabled={!selectedCategory || !categorySearchTerm.trim()}
                    >
                      Set Category
                    </button>
                  </div>
                  {showCategoryDropdown && (
                    <div className="absolute top-full left-0 mt-1 z-50 bg-base-100 border border-base-200 rounded-lg shadow-lg w-64 max-h-80 overflow-y-auto">
                      <div className="p-2">
                        {mainCategories
                          .filter(category => 
                            category.toLowerCase().includes(categorySearchTerm.toLowerCase())
                          )
                          .map((category, index) => (
                            <button 
                              key={`${category}-${index}`}
                              className="w-full text-left px-3 py-2 hover:bg-base-200 rounded-md transition-colors"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedCategory(category);
                                setCategorySearchTerm(category);
                                setShowCategoryDropdown(false);
                              }}
                            >
                              {category}
                            </button>
                          ))}
                        {mainCategories.filter(category => 
                          category.toLowerCase().includes(categorySearchTerm.toLowerCase())
                        ).length === 0 && (
                          <div className="px-3 py-2 text-sm text-base-content/60">
                            No categories found
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                <button 
                  className="btn btn-primary btn-sm"
                  onClick={() => handleDropLeads()}
                >
                  Drop
                </button>
                <div className="relative inactive-dropdown-container">
                  <div className="flex gap-2">
                    <button
                      className="btn btn-outline btn-sm w-48"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowInactiveDropdown(!showInactiveDropdown);
                      }}
                    >
                      {selectedInactiveReason || 'Select Reason'}
                      <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    <input
                      type="text"
                      placeholder="Or enter custom reason..."
                      className="input input-bordered input-sm w-48"
                      value={customInactiveReason}
                      onChange={(e) => setCustomInactiveReason(e.target.value)}
                    />
                    <button 
                      className="btn btn-primary btn-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleInactiveLeads();
                      }}
                      disabled={!selectedInactiveReason && !customInactiveReason.trim()}
                    >
                      Inactive
                    </button>
                  </div>
                  {showInactiveDropdown && (
                    <div className="absolute top-full left-0 mt-1 z-50 bg-base-100 border border-base-200 rounded-lg shadow-lg w-48 max-h-80 overflow-y-auto">
                      <div className="p-2">
                        {unactivationReasons.map((reason, index) => (
                          <button 
                            key={`${reason}-${index}`}
                            className="w-full text-left px-3 py-2 hover:bg-base-200 rounded-md transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedInactiveReason(reason);
                              setShowInactiveDropdown(false);
                            }}
                          >
                            {reason}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <button 
                  className="btn btn-outline btn-sm"
                  onClick={() => {
                    setSelectedLeadBoxes(new Set());
                    setShowActionButtons(false);
                  }}
                >
                  Clear Selection
                </button>
              </div>
            </div>
          )}
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {leads.map(renderResultCard)}
          </div>
        </div>
      )}

      {/* Re-assign Leads Modal */}
      {showReassignModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-base-100 rounded-lg shadow-xl w-full h-full max-h-[100vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">Re-assign Leads</h2>
                <button 
                  className="btn btn-sm btn-circle btn-outline"
                  onClick={() => {
                    setShowReassignModal(false);
                    setReassignResults([]);
                    setSelectedEmployeeForReassign('');
                    setAssignEmployeeSearchTerm('');
                    setMeetingSchedulerSearchTerm('');
                    setSelectedMeetingScheduler('');
                    setShowMeetingSchedulerDropdown(false);
                    setShowAssignEmployeeDropdown(false);
                    setReassignCategorySearchTerm('');
                    setSelectedReassignCategoryFilter('');
                    setShowReassignCategoryDropdown(false);
                    setReassignSourceSearchTerm('');
                    setSelectedReassignSourceFilter('');
                    setShowReassignSourceDropdown(false);
                    setReassignStageSearchTerm('');
                    setSelectedReassignStageFilter('');
                    setShowReassignStageDropdown(false);
                    setShowLanguageDropdown(false);
                    setShowStatusDropdown(false);
                    setReassignFilters({
                      fromDate: '',
                      toDate: '',
                      category: '',
                      source: '',
                      status: '',
                      language: '',
                      stage: '',
                      meetingScheduler: ''
                    });
                  }}
                >
                  ✕
                </button>
              </div>

              {/* Filters Section */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                {/* Column 1 */}
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">From date:</label>
                    <input
                      type="date"
                      className="input input-bordered w-full"
                      value={reassignFilters.fromDate}
                      onChange={(e) => setReassignFilters(prev => ({ ...prev, fromDate: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Category:</label>
                    <div className="relative category-filter-dropdown-container">
                      <input
                        type="text"
                        placeholder="Search category..."
                        className="input input-bordered w-full"
                        value={reassignCategorySearchTerm}
                    onChange={(e) => {
                      setReassignCategorySearchTerm(e.target.value);
                      setReassignFilters(prev => ({ ...prev, category: e.target.value }));
                    }}
                    onFocus={() => {
                      setShowReassignCategoryDropdown(true);
                    }}
                      />
                      {showReassignCategoryDropdown && (
                        <div className="absolute top-full left-0 mt-1 z-50 bg-base-100 border border-base-200 rounded-lg shadow-lg w-full max-h-80 overflow-y-auto">
                          <div className="p-2">
                            <button
                              className="w-full text-left px-3 py-2 hover:bg-base-200 rounded-md transition-colors"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedReassignCategoryFilter('');
                                setReassignCategorySearchTerm('');
                                setReassignFilters(prev => ({ ...prev, category: '' }));
                                setShowReassignCategoryDropdown(false);
                              }}
                            >
                              Please choose
                            </button>
                            {mainCategories
                              .filter(category => 
                                category.toLowerCase().includes(reassignCategorySearchTerm.toLowerCase())
                              )
                              .map((category, index) => (
                                <button 
                                  key={index}
                                  className="w-full text-left px-3 py-2 hover:bg-base-200 rounded-md transition-colors"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedReassignCategoryFilter(category);
                                    setReassignCategorySearchTerm(category);
                                    setReassignFilters(prev => ({ ...prev, category: category }));
                                    setShowReassignCategoryDropdown(false);
                                  }}
                                >
                                  {category}
                                </button>
                              ))}
                            {mainCategories.filter(category => 
                              category.toLowerCase().includes(reassignCategorySearchTerm.toLowerCase())
                            ).length === 0 && (
                              <div className="px-3 py-2 text-sm text-base-content/60">
                                No categories found
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Meeting scheduler:</label>
                    <div className="relative meeting-scheduler-dropdown-container">
                      <input
                        type="text"
                        placeholder="Search employee..."
                        className="input input-bordered w-full"
                        value={meetingSchedulerSearchTerm}
                    onChange={(e) => {
                      setMeetingSchedulerSearchTerm(e.target.value);
                      setReassignFilters(prev => ({ ...prev, meetingScheduler: e.target.value }));
                    }}
                    onFocus={() => {
                      setShowMeetingSchedulerDropdown(true);
                    }}
                      />
                      {showMeetingSchedulerDropdown && (
                        <div className="absolute top-full left-0 mt-1 z-50 bg-base-100 border border-base-200 rounded-lg shadow-lg w-full max-h-80 overflow-y-auto">
                          <div className="p-2">
                            <button
                              className="w-full text-left px-3 py-2 hover:bg-base-200 rounded-md transition-colors"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedMeetingScheduler('');
                                setMeetingSchedulerSearchTerm('- ALL -');
                                setReassignFilters(prev => ({ ...prev, meetingScheduler: '' }));
                                setShowMeetingSchedulerDropdown(false);
                              }}
                            >
                              - ALL -
                            </button>
                            {employees
                              .filter(emp => 
                                emp.display_name.toLowerCase().includes(meetingSchedulerSearchTerm.toLowerCase())
                              )
                              .map((emp) => (
                                <button 
                                  key={emp.id}
                                  className="w-full text-left px-3 py-2 hover:bg-base-200 rounded-md transition-colors"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedMeetingScheduler(emp.display_name);
                                    setMeetingSchedulerSearchTerm(emp.display_name);
                                    setReassignFilters(prev => ({ ...prev, meetingScheduler: emp.display_name }));
                                    setShowMeetingSchedulerDropdown(false);
                                  }}
                                >
                                  {emp.display_name}
                                </button>
                              ))}
                            {employees.filter(emp => 
                              emp.display_name.toLowerCase().includes(meetingSchedulerSearchTerm.toLowerCase())
                            ).length === 0 && meetingSchedulerSearchTerm !== '- ALL -' && (
                              <div className="px-3 py-2 text-sm text-base-content/60">
                                No employees found
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Column 2 */}
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">To date:</label>
                    <input
                      type="date"
                      className="input input-bordered w-full"
                      value={reassignFilters.toDate}
                      onChange={(e) => setReassignFilters(prev => ({ ...prev, toDate: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Language:</label>
                    <div className="relative language-filter-dropdown-container">
                      <input
                        type="text"
                        placeholder="Search language..."
                        className="input input-bordered w-full"
                        value={reassignFilters.language}
                        onChange={(e) => {
                          setReassignFilters(prev => ({ ...prev, language: e.target.value }));
                        }}
                        onFocus={() => {
                          setShowLanguageDropdown(true);
                        }}
                      />
                      {showLanguageDropdown && (
                        <div className="absolute top-full left-0 mt-1 z-50 bg-base-100 border border-base-200 rounded-lg shadow-lg w-full max-h-80 overflow-y-auto">
                          <div className="p-2">
                            {reassignLanguageOptions
                              .filter(language => 
                                language.toLowerCase().includes(reassignFilters.language.toLowerCase())
                              )
                              .map((language, index) => (
                                <button 
                                  key={index}
                                  className="w-full text-left px-3 py-2 hover:bg-base-200 rounded-md transition-colors"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setReassignFilters(prev => ({ ...prev, language: language }));
                                    setShowLanguageDropdown(false);
                                  }}
                                >
                                  {language}
                                </button>
                              ))}
                            {reassignLanguageOptions.filter(language => 
                              language.toLowerCase().includes(reassignFilters.language.toLowerCase())
                            ).length === 0 && (
                              <div className="px-3 py-2 text-sm text-base-content/60">
                                No languages found
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Column 3 */}
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Status:</label>
                    <div className="relative status-filter-dropdown-container">
                      <input
                        type="text"
                        placeholder="Search status..."
                        className="input input-bordered w-full"
                        value={reassignFilters.status}
                        onChange={(e) => {
                          setReassignFilters(prev => ({ ...prev, status: e.target.value }));
                        }}
                        onFocus={() => {
                          setShowStatusDropdown(true);
                        }}
                      />
                      {showStatusDropdown && (
                        <div className="absolute top-full left-0 mt-1 z-50 bg-base-100 border border-base-200 rounded-lg shadow-lg w-full max-h-80 overflow-y-auto">
                          <div className="p-2">
                            {['Active', 'Inactive', 'Pending', 'Completed', 'Cancelled', 'On Hold', 'In Progress']
                              .filter(status => 
                                status.toLowerCase().includes(reassignFilters.status.toLowerCase())
                              )
                              .map((status, index) => (
                                <button 
                                  key={index}
                                  className="w-full text-left px-3 py-2 hover:bg-base-200 rounded-md transition-colors"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setReassignFilters(prev => ({ ...prev, status: status }));
                                    setShowStatusDropdown(false);
                                  }}
                                >
                                  {status}
                                </button>
                              ))}
                            {['Active', 'Inactive', 'Pending', 'Completed', 'Cancelled', 'On Hold', 'In Progress'].filter(status => 
                              status.toLowerCase().includes(reassignFilters.status.toLowerCase())
                            ).length === 0 && (
                              <div className="px-3 py-2 text-sm text-base-content/60">
                                No statuses found
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Source:</label>
                    <div className="relative source-filter-dropdown-container">
                      <input
                        type="text"
                        placeholder="Search source..."
                        className="input input-bordered w-full"
                        value={reassignSourceSearchTerm}
                        onChange={(e) => {
                          setReassignSourceSearchTerm(e.target.value);
                          setReassignFilters(prev => ({ ...prev, source: e.target.value }));
                        }}
                        onFocus={() => {
                          setShowReassignSourceDropdown(true);
                        }}
                      />
                      {showReassignSourceDropdown && (
                        <div className="absolute top-full left-0 mt-1 z-50 bg-base-100 border border-base-200 rounded-lg shadow-lg w-full max-h-80 overflow-y-auto">
                          <div className="p-2">
                            <button
                              className="w-full text-left px-3 py-2 hover:bg-base-200 rounded-md transition-colors"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedReassignSourceFilter('');
                                setReassignSourceSearchTerm('');
                                setReassignFilters(prev => ({ ...prev, source: '' }));
                                setShowReassignSourceDropdown(false);
                              }}
                            >
                              Please choose
                            </button>
                            {reassignSourceOptions
                              .filter(source => 
                                source.toLowerCase().includes(reassignSourceSearchTerm.toLowerCase())
                              )
                              .map((source, index) => (
                                <button 
                                  key={index}
                                  className="w-full text-left px-3 py-2 hover:bg-base-200 rounded-md transition-colors"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedReassignSourceFilter(source);
                                    setReassignSourceSearchTerm(source);
                                    setReassignFilters(prev => ({ ...prev, source: source }));
                                    setShowReassignSourceDropdown(false);
                                  }}
                                >
                                  {source}
                                </button>
                              ))}
                            {reassignSourceOptions.filter(source => 
                              source.toLowerCase().includes(reassignSourceSearchTerm.toLowerCase())
                            ).length === 0 && (
                              <div className="px-3 py-2 text-sm text-base-content/60">
                                No sources found
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Column 4 */}
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Stage:</label>
                    <div className="relative stage-filter-dropdown-container">
                      <input
                        type="text"
                        placeholder="Search stage..."
                        className="input input-bordered w-full"
                        value={reassignStageSearchTerm}
                        onChange={(e) => {
                          setReassignStageSearchTerm(e.target.value);
                          setReassignFilters(prev => ({ ...prev, stage: e.target.value }));
                        }}
                        onFocus={() => {
                          setShowReassignStageDropdown(true);
                        }}
                      />
                      {showReassignStageDropdown && (
                        <div className="absolute top-full left-0 mt-1 z-50 bg-base-100 border border-base-200 rounded-lg shadow-lg w-full max-h-80 overflow-y-auto">
                          <div className="p-2">
                            <button
                              className="w-full text-left px-3 py-2 hover:bg-base-200 rounded-md transition-colors"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedReassignStageFilter('');
                                setReassignStageSearchTerm('');
                                setReassignFilters(prev => ({ ...prev, stage: '' }));
                                setShowReassignStageDropdown(false);
                              }}
                            >
                              Please choose
                            </button>
                            {stages
                              .map(stage => stage.name)
                              .filter(stage => 
                                stage.toLowerCase().includes(reassignStageSearchTerm.toLowerCase())
                              )
                              .map((stage, index) => (
                                <button 
                                  key={index}
                                  className="w-full text-left px-3 py-2 hover:bg-base-200 rounded-md transition-colors"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedReassignStageFilter(stage);
                                    setReassignStageSearchTerm(stage);
                                    setReassignFilters(prev => ({ ...prev, stage: stage }));
                                    setShowReassignStageDropdown(false);
                                  }}
                                >
                                  {stage}
                                </button>
                              ))}
                            {stages
                              .map(stage => stage.name)
                              .filter(stage => 
                                stage.toLowerCase().includes(reassignStageSearchTerm.toLowerCase())
                            ).length === 0 && (
                              <div className="px-3 py-2 text-sm text-base-content/60">
                                No stages found
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center">
                    <input type="checkbox" className="checkbox mr-2" />
                    <label className="text-sm">Eligibility Determined only</label>
                  </div>
                </div>
              </div>

              {/* Search Button */}
              <div className="flex justify-end mb-6">
                <button 
                  className="btn btn-primary"
                  onClick={handleReassignSearch}
                  disabled={reassignLoading}
                >
                  {reassignLoading ? (
                    <>
                      <span className="loading loading-spinner loading-sm"></span>
                      Searching...
                    </>
                  ) : (
                    'Search'
                  )}
                </button>
              </div>

              {/* Results Section */}
              {reassignResults.length > 0 && (
                <div className="mb-6">
                  <div className="bg-white p-4 rounded-lg mb-4 shadow-lg">
                    <h3 className="text-lg font-semibold">
                      Found {reassignResults.length} lead(s)
                    </h3>
                    <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-4">
                      {reassignResults.map((lead) => (
                        <div key={lead.id} className="bg-white p-3 rounded-lg border shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1">
                          <div className="flex flex-col gap-1">
                            <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-1">
                              <span className="text-sm font-medium text-base-content">
                                #{lead.lead_number || lead.id || 'Unknown Lead'}
                              </span>
                              <span 
                                className="badge text-white text-xs px-2 py-1 w-fit"
                                style={{
                                  backgroundColor: '#3f28cd',
                                  borderColor: '#3f28cd',
                                  whiteSpace: 'nowrap',
                                  display: 'inline-block'
                                }}
                                title={stageMapping.get(lead.stage) || stageMapping.get(lead.stage.toString()) || stageMapping.get(parseInt(lead.stage)) || lead.stage || 'No Stage'}
                              >
                                {stageMapping.get(lead.stage) || stageMapping.get(lead.stage.toString()) || stageMapping.get(parseInt(lead.stage)) || lead.stage || 'No Stage'}
                              </span>
                            </div>
                            <span className="text-sm text-base-content/70">
                              {lead.name || 'No Name'}
                            </span>
                            <div className="flex items-center gap-1 text-xs text-base-content/50">
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                              <span>
                                {lead.created_at ? new Date(lead.created_at).toLocaleDateString('en-GB') : 'Unknown'}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Employee Selection */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium mb-2">Assign to Employee:</label>
                    <div className="relative assign-employee-dropdown-container">
                      <input
                        type="text"
                        placeholder="Search employee..."
                        className="input input-bordered w-full max-w-xs"
                        value={assignEmployeeSearchTerm}
                    onChange={(e) => {
                      setAssignEmployeeSearchTerm(e.target.value);
                    }}
                    onFocus={() => {
                      setShowAssignEmployeeDropdown(true);
                    }}
                      />
                      {showAssignEmployeeDropdown && (
                        <div className="absolute top-full left-0 mt-1 z-50 bg-base-100 border border-base-200 rounded-lg shadow-lg w-full max-w-xs max-h-80 overflow-y-auto">
                          <div className="p-2">
                            {employees
                              .filter(emp => 
                                emp.display_name.toLowerCase().includes(assignEmployeeSearchTerm.toLowerCase())
                              )
                              .map((emp) => (
                                <button 
                                  key={emp.id}
                                  className="w-full text-left px-3 py-2 hover:bg-base-200 rounded-md transition-colors"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedEmployeeForReassign(emp.display_name);
                                    setAssignEmployeeSearchTerm(emp.display_name);
                                    setShowAssignEmployeeDropdown(false);
                                  }}
                                >
                                  {emp.display_name}
                                </button>
                              ))}
                            {employees.filter(emp => 
                              emp.display_name.toLowerCase().includes(assignEmployeeSearchTerm.toLowerCase())
                            ).length === 0 && (
                              <div className="px-3 py-2 text-sm text-base-content/60">
                                No employees found
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Re-assign Button */}
                  <button 
                    className="btn btn-primary"
                    onClick={handleReassignLeads}
                    disabled={reassigning || !selectedEmployeeForReassign}
                  >
                    {reassigning ? (
                      <>
                        <span className="loading loading-spinner loading-sm"></span>
                        Re-assigning...
                      </>
                    ) : (
                      `Re-assign ${reassignResults.length} Lead(s)`
                    )}
                  </button>
                </div>
              )}

              {reassignResults.length === 0 && !reassignLoading && (
                <div className="text-center py-8 text-base-content/60">
                  No results found. Try adjusting your filters and search again.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default NewCasesPage; 