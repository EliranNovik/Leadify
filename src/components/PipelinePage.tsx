import React, { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { Link, useNavigate } from 'react-router-dom';
import { AcademicCapIcon, MagnifyingGlassIcon, CalendarIcon, ChevronUpIcon, ChevronDownIcon, XMarkIcon, UserIcon, ChatBubbleLeftRightIcon, FolderIcon, ChartBarIcon, QuestionMarkCircleIcon, PhoneIcon, EnvelopeIcon, PaperClipIcon, PaperAirplaneIcon, FaceSmileIcon, CurrencyDollarIcon, EyeIcon, Squares2X2Icon, Bars3Icon, ArrowLeftIcon, ClockIcon, PencilSquareIcon } from '@heroicons/react/24/outline';
import { FolderIcon as FolderIconSolid } from '@heroicons/react/24/solid';
import { FaWhatsapp } from 'react-icons/fa';
import { FileText, PencilLine } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import DocumentModal from './DocumentModal';
import SchedulerWhatsAppModal from './SchedulerWhatsAppModal';
import SchedulerEmailThreadModal from './SchedulerEmailThreadModal';
import { createPortal } from 'react-dom';
import { useMsal } from '@azure/msal-react';
import { loginRequest } from '../msalConfig';
import { InteractionRequiredAuthError, IPublicClientApplication, AccountInfo } from '@azure/msal-browser';
import { toast } from 'react-hot-toast';
import { getStageName, initializeStageNames } from '../lib/stageUtils';

interface LeadForPipeline {
  id: number | string;
  lead_number: string;
  name: string;
  created_at: string;
  expert?: string;
  manager?: string;
  scheduler?: string;
  closer?: string;
  topic?: string | null;
  category?: string | null;
  handler_notes?: { content: string }[];
  expert_notes?: { content: string }[];
  meetings: { meeting_date: string }[];
  onedrive_folder_link?: string | null;
  stage?: string;
  number_of_applicants_meeting?: number | null;
  potential_applicants_meeting?: number | null;
  balance?: number | null;
  balance_currency?: string | null;
  probability?: number | null;
  eligibility_status?: string | null;
  next_followup?: string | null;
  manual_interactions?: any[];
  email?: string | null;
  mobile?: string | null;
  phone?: string | null;
  comments?: { text: string; timestamp: string; user: string }[];
  label?: string | null;
  highlighted_by?: string[];
  // Legacy lead support
  lead_type?: 'legacy' | 'new';
  // Legacy lead specific fields
  meeting_manager_id?: string | null;
  meeting_lawyer_id?: string | null;
  category_id?: number | null;
  total?: number | null;
  meeting_total_currency_id?: number | null;
  expert_id?: string | null;
  language_id?: number | null;
  language?: string | null;
  latest_interaction?: string;
  country?: string | number | null;
  country_id?: number | null;
  source?: string | null;
  eligible?: boolean | null;
  tags?: string | null;
}

const getCurrencySymbol = (currencyCode?: string | null) => {
  // Handle currency codes
  switch (currencyCode) {
    case 'USD':
      return '$';
    case 'EUR':
      return '€';
    case 'ILS':
      return '₪';
    case 'NIS':
      return '₪';
    case 'GBP':
      return '£';
  }
  
  // Handle currency symbols (if the database stores symbols instead of codes)
  switch (currencyCode) {
    case '$':
      return '$';
    case '€':
      return '€';
    case '₪':
      return '₪';
    case '£':
      return '£';
  }
  
  return '$';
};

const LABEL_OPTIONS = [
  'High Value',
  'Low Value',
  'Potential Clients',
  'High Risk',
  'Low Risk',
];

const PipelinePage: React.FC = () => {
  const [leads, setLeads] = useState<LeadForPipeline[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCreatedDateFrom, setFilterCreatedDateFrom] = useState('');
  const [filterCreatedDateTo, setFilterCreatedDateTo] = useState('');
  const [filterBy, setFilterBy] = useState('all');
  const [filterCountry, setFilterCountry] = useState('');
  const [filterLanguage, setFilterLanguage] = useState('');
  const [sortColumn, setSortColumn] = useState<'created_at' | 'meeting_date' | 'stage' | 'offer' | 'probability' | 'total_applicants' | 'potential_applicants' | 'follow_up' | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [selectedLead, setSelectedLead] = useState<LeadForPipeline | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isDocumentModalOpen, setIsDocumentModalOpen] = useState(false);
  const [contactDrawerOpen, setContactDrawerOpen] = useState(false);
  const [documentCount, setDocumentCount] = useState<number>(0);
  const [conversations, setConversations] = useState<any[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(false);
  const [contacts, setContacts] = useState<any[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  
  // State to store all categories for name lookup (same as Clients.tsx)
  const [allCategories, setAllCategories] = useState<any[]>([]);
  
  // State for countries (for Country column with business hours indicator)
  const [allCountries, setAllCountries] = useState<any[]>([]);
  
  // State for languages (for Language column and filter)
  const [allLanguages, setAllLanguages] = useState<any[]>([]);
  
  // State for contact dropdown
  const [openContactDropdown, setOpenContactDropdown] = useState<string | number | null>(null);
  
  // State for WhatsApp and Email modals (from contact dropdown)
  const [isContactWhatsAppModalOpen, setIsContactWhatsAppModalOpen] = useState(false);
  const [isContactEmailModalOpen, setIsContactEmailModalOpen] = useState(false);
  
  // Edit lead drawer state
  const [showEditLeadDrawer, setShowEditLeadDrawer] = useState(false);
  const [editLeadData, setEditLeadData] = useState({
    tags: '',
    source: '',
    name: '',
    language: '',
    category: '',
    topic: '',
    probability: 0,
    number_of_applicants_meeting: '',
    potential_applicants_meeting: '',
    balance: '',
    next_followup: '',
    balance_currency: '₪',
    eligible: true,
  });
  const [currentLeadTags, setCurrentLeadTags] = useState('');
  const [mainCategories, setMainCategories] = useState<string[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [tagsList, setTagsList] = useState<string[]>([]);
  const [currencies, setCurrencies] = useState<Array<{id: string, front_name: string, iso_code: string, name: string}>>([]);
  
  const navigate = useNavigate();

  // Fetch countries (for Country column with business hours indicator)
  const fetchCountries = async () => {
    try {
      const { data: countriesData, error: countriesError } = await supabase
        .from('misc_country')
        .select('id, name, iso_code, name_he, timezone')
        .order('name', { ascending: true });
      
      if (!countriesError && countriesData) {
        setAllCountries(countriesData);
        return countriesData;
      } else {
        console.error('❌ Error fetching countries:', countriesError);
        return [];
      }
    } catch (error) {
      console.error('❌ Error fetching countries:', error);
      return [];
    }
  };

  // Fetch languages (for Language column and filter)
  const fetchLanguages = async () => {
    try {
      const { data: languagesData, error: languagesError } = await supabase
        .from('misc_language')
        .select('id, name')
        .order('name', { ascending: true });
      
      if (!languagesError && languagesData) {
        setAllLanguages(languagesData);
        return languagesData;
      } else {
        console.error('❌ Error fetching languages:', languagesError);
        return [];
      }
    } catch (error) {
      console.error('❌ Error fetching languages:', error);
      return [];
    }
  };

  // Get language name
  const getLanguageName = (languageId: string | number | null | undefined, languageText?: string | null) => {
    // If we have language text directly (for new leads), return it
    // Check for null, undefined, empty string, or whitespace-only strings
    if (languageText !== null && languageText !== undefined && String(languageText).trim() !== '') {
      return String(languageText).trim();
    }
    
    // If we have language_id, look it up (for legacy leads)
    if (languageId && allLanguages && allLanguages.length > 0) {
      // Try to find by ID - handle both string and number comparisons
      const language = allLanguages.find((lang: any) => {
        const langId = lang.id;
        const searchId = languageId;
        
        // Handle UUID comparison (string to string)
        if (typeof langId === 'string' && typeof searchId === 'string') {
          return langId === searchId;
        }
        
        // Handle number comparison
        if (typeof langId === 'number' && typeof searchId === 'number') {
          return langId === searchId;
        }
        
        // Handle mixed types (convert to string for comparison)
        return String(langId) === String(searchId);
      });
      
      if (language && language.name) {
        return language.name;
      }
    }
    
    return 'N/A';
  };

  // Get country timezone
  const getCountryTimezone = (countryId: string | number | null | undefined) => {
    if (!countryId || countryId === '---' || countryId === '--' || !allCountries || allCountries.length === 0) {
      return null;
    }
    
    // Try to find by ID
    const countryById = allCountries.find((country: any) => country.id.toString() === countryId.toString());
    if (countryById && countryById.timezone) {
      return countryById.timezone;
    }
    
    // If not found by ID, try to find by name
    const countryByName = allCountries.find((country: any) => 
      country.name.toLowerCase().trim() === String(countryId).toLowerCase().trim()
    );
    if (countryByName && countryByName.timezone) {
      return countryByName.timezone;
    }
    
    return null;
  };

  // Get business hours info
  const getBusinessHoursInfo = (timezone: string | null) => {
    if (!timezone) return { isBusinessHours: false, localTime: null };
    
    try {
      const now = new Date();
      const localTime = new Date(now.toLocaleString("en-US", { timeZone: timezone }));
      const hour = localTime.getHours();
      
      // Business hours: 8 AM to 7 PM (8:00 - 19:00)
      const isBusinessHours = hour >= 8 && hour < 19;
      
      // Format the local time
      const formattedTime = localTime.toLocaleString("en-US", {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
      
      return { isBusinessHours, localTime: formattedTime };
    } catch (error) {
      console.error('Error checking business hours for timezone:', timezone, error);
      return { isBusinessHours: false, localTime: null };
    }
  };

  // Get country name
  const getCountryName = (countryId: string | number | null | undefined) => {
    if (!countryId || countryId === '---' || countryId === '--' || !allCountries || allCountries.length === 0) {
      return 'N/A';
    }
    
    // Try to find by ID
    const countryById = allCountries.find((country: any) => country.id.toString() === countryId.toString());
    if (countryById && countryById.name) {
      return countryById.name;
    }
    
    // If not found by ID, try to find by name
    const countryByName = allCountries.find((country: any) => 
      country.name.toLowerCase().trim() === String(countryId).toLowerCase().trim()
    );
    if (countryByName && countryByName.name) {
      return countryByName.name;
    }
    
    return String(countryId);
  };

  // Helper function to get category name from ID with main category (copied from Clients.tsx)
  const getCategoryName = (categoryId: string | number | null | undefined, fallbackCategory?: string) => {
    console.log('🔍 PipelinePage getCategoryName called with:', { 
      categoryId, 
      fallbackCategory, 
      allCategoriesLength: allCategories.length,
      sampleCategories: allCategories.slice(0, 3).map(cat => ({ id: cat.id, name: cat.name }))
    });
    
    if (!categoryId || categoryId === '---') {
      // If no category_id but we have a fallback category, try to find it in the loaded categories
      if (fallbackCategory && fallbackCategory.trim() !== '') {
        console.log('🔍 Looking for fallback category:', fallbackCategory);
        // Try to find the fallback category in the loaded categories
        const foundCategory = allCategories.find((cat: any) => 
          cat.name.toLowerCase().trim() === fallbackCategory.toLowerCase().trim()
        );
        
        if (foundCategory) {
          console.log('🔍 Found fallback category:', foundCategory);
          // Return category name with main category in parentheses
          if (foundCategory.misc_maincategory?.name) {
            return `${foundCategory.name} (${foundCategory.misc_maincategory.name})`;
          } else {
            return foundCategory.name; // Fallback if no main category
          }
        } else {
          console.log('🔍 Fallback category not found, using as-is:', fallbackCategory);
          return fallbackCategory; // Use as-is if not found in loaded categories
        }
      }
      console.log('🔍 No category_id and no fallback, returning empty string');
      return '';
    }
    
    // Find category in loaded categories
    const category = allCategories.find((cat: any) => cat.id.toString() === categoryId.toString());
    console.log('🔍 Category lookup result:', { categoryId, found: !!category, category });
    
    if (category) {
      // Return category name with main category in parentheses
      if (category.misc_maincategory?.name) {
        const result = `${category.name} (${category.misc_maincategory.name})`;
        console.log('🔍 Returning category with main category:', result);
        return result;
      } else {
        console.log('🔍 Returning category without main category:', category.name);
        return category.name; // Fallback if no main category
      }
    }
    
    console.log('🔍 Category not found, returning empty string for categoryId:', categoryId);
    return ''; // Return empty string instead of ID to show "Not specified"
  };

  const [newContact, setNewContact] = useState({
    method: 'email',
    date: '',
    time: '',
    length: '',
    content: '',
    observation: '',
  });
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [composeAttachments, setComposeAttachments] = useState<{ name: string; contentType: string; contentBytes: string }[]>([]);
  const [emails, setEmails] = useState<any[]>([]);
  const [emailsLoading, setEmailsLoading] = useState(false);
  const [downloadingAttachments, setDownloadingAttachments] = useState<Record<string, boolean>>({});
  const [activeEmailId, setActiveEmailId] = useState<string | null>(null);
  const [isWhatsAppOpen, setIsWhatsAppOpen] = useState(false);
  const [whatsAppInput, setWhatsAppInput] = useState('');
  // WhatsApp chat messages for the chat box (from selectedLead.manual_interactions)
  const whatsAppChatMessages = (selectedLead?.manual_interactions || [])
    .filter((i: any) => i.kind === 'whatsapp')
    .sort((a: any, b: any) => new Date(a.raw_date).getTime() - new Date(b.raw_date).getTime());
  const emailTemplates = [
    {
      name: 'Document Reminder',
      subject: 'Reminder: Required Documents for Your Application',
      body: `Dear {client_name},\n\nAs part of your application process, we kindly remind you to upload the required documents to your client portal.\n\nThis will help us proceed without delays. If you need assistance or are unsure which documents are still needed, please contact us.\n\nYou can upload documents here: {upload_link}\n\nThank you for your cooperation.`,
    },
    {
      name: 'Application Submission Confirmation',
      subject: 'Confirmation: Your Application Has Been Submitted',
      body: `Dear {client_name},\n\nWe're pleased to inform you that your application has been successfully submitted to the relevant authorities.\n\nYou will be notified once there are any updates or additional requirements. Please note that processing times may vary depending on the case.\n\nIf you have any questions or wish to discuss the next steps, feel free to contact your case manager.`,
    },
  ];
  const [sending, setSending] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [labelFilter, setLabelFilter] = useState('');
  const [labelDropdownOpen, setLabelDropdownOpen] = useState<number | null>(null);
  const [labelSubmitting, setLabelSubmitting] = useState(false);
  const [highlightedLeads, setHighlightedLeads] = useState<LeadForPipeline[]>([]);
  const [highlightPanelOpen, setHighlightPanelOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'cards' | 'list'>('cards');
  const [showSignedAgreements, setShowSignedAgreements] = useState(false);
  const [pipelineMode, setPipelineMode] = useState<'closer' | 'scheduler'>('closer');
  const [currentUserFullName, setCurrentUserFullName] = useState<string>('');
  const [currentUserEmployeeId, setCurrentUserEmployeeId] = useState<number | null>(null);
  
  // Assignment modal state
  const [assignmentModalOpen, setAssignmentModalOpen] = useState(false);
  const [assignmentLeads, setAssignmentLeads] = useState<LeadForPipeline[]>([]);
  const [assignmentLoading, setAssignmentLoading] = useState(false);
  const [assigningLead, setAssigningLead] = useState<string | null>(null);
  
  // Assignment modal search and sort state
  const [assignmentSearchQuery, setAssignmentSearchQuery] = useState('');
  const [assignmentSortColumn, setAssignmentSortColumn] = useState<'created_at' | 'offer' | 'probability' | null>(null);
  const [assignmentSortDirection, setAssignmentSortDirection] = useState<'asc' | 'desc'>('desc');
  const [assignmentStageFilter, setAssignmentStageFilter] = useState<string>('');

  // Status filter state
  const [showUnassignedOnly, setShowUnassignedOnly] = useState(false);
  const [showLostInteractionsOnly, setShowLostInteractionsOnly] = useState(false);

  // Fetch categories on component mount (same as Clients.tsx)
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
        
        if (error) {
          console.error('PipelinePage: Error fetching categories:', error);
        } else if (data) {
          setAllCategories(data);
        }
      } catch (err) {
        console.error('PipelinePage: Exception while fetching categories:', err);
      }
    };

    fetchCategories();
  }, []);

  // Dynamically collect all unique stages from leads with proper stage names
  const stageOptions = useMemo(() => {
    const stages = new Set<string>();
    leads.forEach(lead => { 
      if (lead.stage) {
        const stageName = getStageName(lead.stage);
        stages.add(stageName);
      }
    });
    return Array.from(stages);
  }, [leads]);

  // Get stage options for assignment modal
  const assignmentStageOptions = useMemo(() => {
    const stages = new Set<string>();
    assignmentLeads.forEach(lead => { 
      if (lead.stage) {
        const stageName = getStageName(lead.stage);
        stages.add(stageName);
      }
    });
    return Array.from(stages).sort();
  }, [assignmentLeads]);

  // Helper function to check if a lead is a signed agreement or past that stage
  const isSignedAgreementLead = (lead: LeadForPipeline) => {
    const stage = lead.stage || '';
    const stageLower = stage.toLowerCase();
    
    // Check for signed agreement stages
    const isSignedAgreement = 
      stageLower.includes('client signed agreement') ||
      stageLower.includes('client signed') ||
      stage === 'Client signed agreement' ||
      stage === 'Client Signed Agreement' ||
      stage === 'client signed agreement' ||
      stage === 'client signed' ||
      stageLower.includes('signed agreement');
    
    // Check for stages that come after signed agreement (like success, completed, etc.)
    const isPastSignedAgreement = 
      stageLower.includes('success') ||
      stageLower.includes('completed') ||
      stageLower.includes('finished') ||
      stageLower.includes('done') ||
      stageLower.includes('closed') ||
      stageLower.includes('finalized') ||
      stage === 'Success' ||
      stage === 'Completed' ||
      stage === 'Finished' ||
      stage === 'Done' ||
      stage === 'Closed' ||
      stage === 'Finalized';
    
    return isSignedAgreement || isPastSignedAgreement;
  };

  // Helper function to check if a lead is unassigned
  const isUnassignedLead = (lead: LeadForPipeline) => {
    if (lead.lead_type === 'legacy') {
      // For legacy leads, check the ID fields
      if (pipelineMode === 'closer') {
        return !lead.expert_id || lead.expert_id === '';
      } else {
        return !lead.meeting_manager_id || lead.meeting_manager_id === '';
      }
    } else {
      // For new leads, check the name fields
      if (pipelineMode === 'closer') {
        return !lead.closer || lead.closer === '';
      } else {
        return !lead.scheduler || lead.scheduler === '';
      }
    }
  };

  // Helper function to check if a lead has lost interactions
  const hasLostInteractions = (lead: LeadForPipeline) => {
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    
    // If latest_interaction is available, use it for both new and legacy leads
    if (lead.latest_interaction) {
      const latestInteractionDate = new Date(lead.latest_interaction);
      const isRecent = latestInteractionDate >= twoWeeksAgo;
      return !isRecent;
    }
    
    // Fallback to manual_interactions for legacy leads
    if (lead.lead_type === 'legacy') {
      const hasRecentInteractions = lead.manual_interactions && lead.manual_interactions.some((interaction: any) => {
        if (!interaction.raw_date) return false;
        const interactionDate = new Date(interaction.raw_date);
        const isRecent = interactionDate >= twoWeeksAgo;
        return isRecent;
      });
      return !hasRecentInteractions;
    } else {
      // For new leads with no latest_interaction, assume lost interactions
      return true;
    }
  };

  // Define fetchLeads function outside useEffect so it can be reused
  const fetchLeads = async () => {
    setIsLoading(true);
    
    // Add timeout to prevent hanging
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Fetch timeout after 30 seconds')), 30000);
    });
    
    try {
      await Promise.race([
        (async () => {
          // Initialize stage names cache first
          await initializeStageNames();
          
          // Fetch new leads using JOINs for efficient filtering
          let newLeadsQuery;
          
          // Define allowed stage IDs based on pipeline mode
          const allowedStageIds = pipelineMode === 'closer' 
            ? ['20', '21', '30', '40', '50', '55', '60', '70']
            : ['10', '15', '20', '21', '30', '40', '50'];
          
          console.log('🔍 Pipeline Debug - Fetching leads', {
            pipelineMode,
            currentUserFullName,
            currentUserEmployeeId,
            allowedStageIds
          });
          
          if (currentUserEmployeeId) {
            if (pipelineMode === 'closer') {
              // Use direct employee name filtering (more reliable than complex JOINs)
              newLeadsQuery = supabase
                .from('leads')
                .select(`
                  id,
                  lead_number,
                  name,
                  created_at,
                  expert,
                  manager,
                  scheduler,
                  closer,
                  topic,
                  category,
                  category_id,
                  stage,
                  eligible,
                  number_of_applicants_meeting,
                  potential_applicants_meeting,
                  balance,
                  balance_currency,
                  probability,
                  next_followup,
                  email,
                  phone,
                  comments,
                  label,
                  latest_interaction,
                  country_id,
                  language,
                  source,
                  meetings (
                    meeting_date
                  )
                `)
                .eq('closer', currentUserFullName);
              
              console.log('🔍 Pipeline Debug - Before filters, checking lead counts...');
              
              // First, check sample lead data to see actual values
              const { data: sampleLeads } = await supabase
                .from('leads')
                .select('id, lead_number, name, stage, eligible, closer')
                .eq('closer', currentUserFullName)
                .limit(10);
              
              console.log('🔍 Pipeline Debug - Sample new leads (first 10):', sampleLeads);
              
              // Debug: Check counts without filters
              const { count: countWithoutFilters } = await supabase
                .from('leads')
                .select('*', { count: 'exact', head: true })
                .eq('closer', currentUserFullName);
              
              const { count: countWithEligible } = await supabase
                .from('leads')
                .select('*', { count: 'exact', head: true })
                .eq('closer', currentUserFullName)
                .eq('eligible', true);
              
              // Check if eligible is null or false
              const { count: countWithEligibleNull } = await supabase
                .from('leads')
                .select('*', { count: 'exact', head: true })
                .eq('closer', currentUserFullName)
                .is('eligible', null);
              
              const { count: countWithStage } = await supabase
                .from('leads')
                .select('*', { count: 'exact', head: true })
                .eq('closer', currentUserFullName)
                .in('stage', allowedStageIds);
              
              const { count: countWithBoth } = await supabase
                .from('leads')
                .select('*', { count: 'exact', head: true })
                .eq('closer', currentUserFullName)
                .eq('eligible', true)
                .in('stage', allowedStageIds);
              
              console.log('🔍 Pipeline Debug - New leads counts:', {
                totalWithCloser: countWithoutFilters,
                withEligibleTrue: countWithEligible,
                withEligibleNull: countWithEligibleNull,
                withStageFilter: countWithStage,
                withBothFilters: countWithBoth
              });
              
              // Get all unique stage values
              const { data: allStageValues } = await supabase
                .from('leads')
                .select('stage')
                .eq('closer', currentUserFullName)
                .not('stage', 'is', null);
              
              const uniqueStages = [...new Set(allStageValues?.map(l => l.stage))];
              console.log('🔍 Pipeline Debug - All unique stage values in new leads:', uniqueStages);
              
              // For closer pipeline, only filter by stage (no eligible filter)
              newLeadsQuery = newLeadsQuery.in('stage', allowedStageIds);
            } else {
              // Use direct employee name filtering (more reliable than complex JOINs)
              newLeadsQuery = supabase
                .from('leads')
                .select(`
                  id,
                  lead_number,
                  name,
                  created_at,
                  expert,
                  manager,
                  scheduler,
                  closer,
                  topic,
                  category,
                  category_id,
                  stage,
                  eligible,
                  number_of_applicants_meeting,
                  potential_applicants_meeting,
                  balance,
                  balance_currency,
                  probability,
                  next_followup,
                  email,
                  phone,
                  comments,
                  label,
                  latest_interaction,
                  country_id,
                  language,
                  source,
                  meetings (
                    meeting_date
                  )
                `)
                .eq('scheduler', currentUserFullName);
              
              console.log('🔍 Pipeline Debug - Scheduler mode, checking lead counts...');
              
              // First, check sample lead data to see actual values
              const { data: schedulerSampleLeads } = await supabase
                .from('leads')
                .select('id, lead_number, name, stage, eligible, scheduler')
                .eq('scheduler', currentUserFullName)
                .limit(10);
              
              console.log('🔍 Pipeline Debug - Sample scheduler leads (first 10):', schedulerSampleLeads);
              
              // Debug: Check counts without filters
              const { count: schedulerCountWithoutFilters } = await supabase
                .from('leads')
                .select('*', { count: 'exact', head: true })
                .eq('scheduler', currentUserFullName);
              
              const { count: schedulerCountWithEligible } = await supabase
                .from('leads')
                .select('*', { count: 'exact', head: true })
                .eq('scheduler', currentUserFullName)
                .eq('eligible', true);
              
              const { count: schedulerCountWithEligibleNull } = await supabase
                .from('leads')
                .select('*', { count: 'exact', head: true })
                .eq('scheduler', currentUserFullName)
                .is('eligible', null);
              
              const { count: schedulerCountWithStage } = await supabase
                .from('leads')
                .select('*', { count: 'exact', head: true })
                .eq('scheduler', currentUserFullName)
                .in('stage', allowedStageIds);
              
              const { count: schedulerCountWithBoth } = await supabase
                .from('leads')
                .select('*', { count: 'exact', head: true })
                .eq('scheduler', currentUserFullName)
                .eq('eligible', true)
                .in('stage', allowedStageIds);
              
              console.log('🔍 Pipeline Debug - Scheduler leads counts:', {
                totalWithScheduler: schedulerCountWithoutFilters,
                withEligibleTrue: schedulerCountWithEligible,
                withEligibleNull: schedulerCountWithEligibleNull,
                withStageFilter: schedulerCountWithStage,
                withBothFilters: schedulerCountWithBoth
              });
              
              // Get all unique stage values
              const { data: schedulerStageValues } = await supabase
                .from('leads')
                .select('stage')
                .eq('scheduler', currentUserFullName)
                .not('stage', 'is', null);
              
              const uniqueSchedulerStages = [...new Set(schedulerStageValues?.map(l => l.stage))];
              console.log('🔍 Pipeline Debug - All unique stage values in scheduler leads:', uniqueSchedulerStages);
              
              newLeadsQuery = newLeadsQuery
                .eq('eligible', true)
                .in('stage', allowedStageIds);
            }
          } else {
            newLeadsQuery = supabase
              .from('leads')
              .select(`
                id,
                lead_number,
                name,
                created_at,
                expert,
                manager,
                scheduler,
                closer,
                topic,
                category,
                category_id,
                stage,
                eligible,
                number_of_applicants_meeting,
                potential_applicants_meeting,
                balance,
                balance_currency,
                probability,
                next_followup,
                email,
                phone,
                comments,
                label,
                latest_interaction,
                country_id,
                language,
                meetings (
                  meeting_date
                )
              `);
            
            // For scheduler pipeline, filter by eligible; for closer, no eligible filter
            if (pipelineMode !== 'closer') {
              newLeadsQuery = newLeadsQuery.eq('eligible', true);
            }
            
            newLeadsQuery = newLeadsQuery.in('stage', allowedStageIds);
            
            // Apply filter if user is logged in
            if (currentUserFullName) {
              if (pipelineMode === 'closer') {
                newLeadsQuery = newLeadsQuery.eq('closer', currentUserFullName);
              } else if (pipelineMode === 'scheduler') {
                newLeadsQuery = newLeadsQuery.eq('scheduler', currentUserFullName);
              }
            }
          }
          
          const { data: newLeadsData, error: newLeadsError } = await newLeadsQuery.order('created_at', { ascending: false });

          if (newLeadsError) {
            console.error('❌ Pipeline Error - Error fetching new leads:', newLeadsError);
            throw newLeadsError;
          }
          
          console.log('🔍 Pipeline Debug - New leads fetched:', {
            count: newLeadsData?.length || 0,
            sampleStages: newLeadsData?.slice(0, 5).map(l => ({ id: l.id, name: l.name, stage: l.stage, eligible: l.eligible }))
          });
          

          // Fetch legacy leads - optimized for performance
          // Define allowed stage IDs based on pipeline mode
          const allowedLegacyStageIds = pipelineMode === 'closer'
            ? [20, 21, 30, 40, 50, 55, 60, 70]
            : [10, 15, 20, 21, 30, 40, 50];
          
          let legacyLeadsQuery = supabase
            .from('leads_lead')
            .select(`
              id,
              name,
              cdate,
              stage,
              closer_id,
              meeting_scheduler_id,
              total,
              currency_id,
              probability,
              phone,
              email,
              next_followup,
              no_of_applicants,
              potential_applicants,
              comments,
              label,
              status,
              latest_interaction,
              category_id,
              topic,
              eligibile,
              language_id
            `)
            .limit(1000)
            .eq('status', 0); // Only fetch leads where status is 0
          
          // Apply filter using employee ID (columns are now bigint)
          if (currentUserEmployeeId) {
            if (pipelineMode === 'closer') {
              legacyLeadsQuery = legacyLeadsQuery.eq('closer_id', currentUserEmployeeId);
            } else if (pipelineMode === 'scheduler') {
              legacyLeadsQuery = legacyLeadsQuery.eq('meeting_scheduler_id', currentUserEmployeeId);
            }
          }
          
          // Debug: Check counts without filters - build query step by step
          let baseQuery = supabase
            .from('leads_lead')
            .select('id, name, stage, eligibile, closer_id, meeting_scheduler_id, status')
            .eq('status', 0);
          
          // Apply employee filter
          if (currentUserEmployeeId) {
            if (pipelineMode === 'closer') {
              baseQuery = baseQuery.eq('closer_id', currentUserEmployeeId);
            } else if (pipelineMode === 'scheduler') {
              baseQuery = baseQuery.eq('meeting_scheduler_id', currentUserEmployeeId);
            }
          }
          
          // First, get sample data to see actual values
          const { data: sampleLegacyLeads } = await baseQuery.limit(10);
          
          console.log('🔍 Pipeline Debug - Sample legacy leads (first 10):', sampleLegacyLeads);
          
          // Now check counts
          const countBaseQuery = supabase
            .from('leads_lead')
            .select('*', { count: 'exact', head: true })
            .eq('status', 0);
          
          let countQueryWithEmployee = countBaseQuery;
          if (currentUserEmployeeId) {
            if (pipelineMode === 'closer') {
              countQueryWithEmployee = countQueryWithEmployee.eq('closer_id', currentUserEmployeeId);
            } else if (pipelineMode === 'scheduler') {
              countQueryWithEmployee = countQueryWithEmployee.eq('meeting_scheduler_id', currentUserEmployeeId);
            }
          }
          
          const { count: legacyCountWithoutFilters } = await countQueryWithEmployee;
          
          const { count: legacyCountWithEligibile } = await countQueryWithEmployee
            .eq('eligibile', 'yes');
          
          // Check for null eligibile
          const { count: legacyCountWithEligibileNull } = await countQueryWithEmployee
            .is('eligibile', null);
          
          const { count: legacyCountWithStage } = await countQueryWithEmployee
            .in('stage', allowedLegacyStageIds);
          
          const { count: legacyCountWithBoth } = await countQueryWithEmployee
            .eq('eligibile', 'yes')
            .in('stage', allowedLegacyStageIds);
          
          console.log('🔍 Pipeline Debug - Legacy leads counts:', {
            totalWithoutFilters: legacyCountWithoutFilters,
            withEligibileYes: legacyCountWithEligibile,
            withEligibileNull: legacyCountWithEligibileNull,
            withStageFilter: legacyCountWithStage,
            withBothFilters: legacyCountWithBoth
          });
          
          // Get all unique stage values from sample data
          const uniqueLegacyStages = [...new Set(sampleLegacyLeads?.map(l => l.stage).filter(s => s != null))];
          console.log('🔍 Pipeline Debug - All unique stage values in legacy leads:', uniqueLegacyStages);
          
          // Get all unique eligibile values from sample data
          const uniqueEligibileValues = [...new Set(sampleLegacyLeads?.map(l => l.eligibile).filter(e => e != null))];
          console.log('🔍 Pipeline Debug - All unique eligibile values in legacy leads:', uniqueEligibileValues);
          
          // Now apply the filters
          // For closer pipeline, only filter by stage (no eligible filter)
          // For scheduler pipeline, filter by both eligible and stage
          if (pipelineMode === 'closer') {
            legacyLeadsQuery = legacyLeadsQuery.in('stage', allowedLegacyStageIds);
          } else {
            legacyLeadsQuery = legacyLeadsQuery
              .eq('eligibile', 'yes') // Only fetch eligible legacy leads for scheduler
              .in('stage', allowedLegacyStageIds);
          }
          
          const { data: legacyLeadsData, error: legacyLeadsError } = await legacyLeadsQuery.order('cdate', { ascending: false });
          
          console.log('🔍 Pipeline Debug - Legacy leads fetched:', {
            count: legacyLeadsData?.length || 0,
            sampleStages: legacyLeadsData?.slice(0, 5).map(l => ({ id: l.id, name: l.name, stage: l.stage, eligibile: l.eligibile }))
          });


          if (legacyLeadsError) {
            console.error('Error fetching legacy leads:', legacyLeadsError);
            throw legacyLeadsError;
          }
          
          // Fetch currency data separately - optimized
          const currencyIds = legacyLeadsData?.map(lead => lead.currency_id).filter(id => id !== null) || [];
          let currencyMap: Record<number, string> = {};
          
          if (currencyIds.length > 0) {
            const { data: currencyData, error: currencyError } = await supabase
              .from('accounting_currencies')
              .select('id, iso_code')
              .in('id', currencyIds);
            
            if (currencyError) {
              console.error('Error fetching currencies:', currencyError);
            } else {
              currencyMap = currencyData?.reduce((acc, curr) => {
                acc[curr.id] = curr.iso_code;
                return acc;
              }, {} as Record<number, string>) || {};
            }
          }
          
          // Note: Category handling is now done via getCategoryName function using allCategories state
          

          // Process new leads with proper category handling
          const processedNewLeads = (newLeadsData || []).map((lead: any) => {
            // Debug: Log language data for new leads
            if (lead.id === 'L34' || lead.lead_number === 'L34') {
              console.log('🔍 Debug Lead L34 language:', {
                id: lead.id,
                lead_number: lead.lead_number,
                language: lead.language,
                languageType: typeof lead.language,
                languageNull: lead.language === null,
                languageUndefined: lead.language === undefined
              });
            }
            
            return {
              ...lead,
              category: getCategoryName(lead.category_id, lead.category), // Use proper category handling
              meetings: lead.meetings || [], // Ensure meetings is always an array
              lead_type: 'new' as const,
              // New leads use language text column directly - preserve even if null/empty
              language: lead.language || null,
              language_id: null // New leads don't use language_id
            };
          });

          // Process legacy leads
          const processedLegacyLeads = (legacyLeadsData || []).map(lead => {
            const currencyCode = currencyMap[lead.currency_id] || null;
            
            return {
              id: `legacy_${lead.id}`,
              lead_number: lead.id?.toString() || '',
              name: lead.name || '',
              created_at: lead.cdate || new Date().toISOString(),
              expert: lead.closer_id, // Use closer_id as expert for legacy leads
              topic: null, // Legacy leads don't have topic field
              category: getCategoryName(lead.category_id), // Use proper category handling
              handler_notes: [],
              expert_notes: [],
              meetings: [], // Legacy leads don't have meetings relationship
              onedrive_folder_link: null,
              stage: lead.stage?.toString() || '',
              number_of_applicants_meeting: lead.no_of_applicants,
              potential_applicants_meeting: lead.potential_applicants,
              balance: lead.total,
              balance_currency: currencyCode,
              probability: typeof lead.probability === 'string' ? parseFloat(lead.probability) : lead.probability,
              eligibility_status: null,
              next_followup: lead.next_followup,
              manual_interactions: [],
              email: lead.email,
              mobile: null,
              phone: lead.phone,
              comments: lead.comments || [],
              label: lead.label || null,
              highlighted_by: [],
              latest_interaction: lead.latest_interaction,
              lead_type: 'legacy' as const,
              // Legacy specific fields
              meeting_manager_id: lead.meeting_scheduler_id, // Use meeting_scheduler_id as manager
              meeting_lawyer_id: null,
              category_id: lead.category_id, // Preserve the original category_id
              total: lead.total,
              meeting_total_currency_id: null,
              expert_id: lead.closer_id,
              language_id: lead.language_id || null,
              language: null, // Legacy leads use language_id
              country_id: null, // Legacy leads don't have country_id directly, would need to fetch via contacts
              country: null
            };
          });

          // Combine and sort all leads by creation date
          const allLeads = [...processedNewLeads, ...processedLegacyLeads].sort((a, b) => 
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          );


          setLeads(allLeads as LeadForPipeline[]);
        })(),
        timeoutPromise
      ]);
    } catch (error) {
      console.error('Error fetching leads for pipeline page:', error);
      setLeads([]);
    }
    setIsLoading(false);
  };

  // Fetch countries and languages on mount
  useEffect(() => {
    fetchCountries();
    fetchLanguages();
  }, []);

  // Fetch additional data for edit lead drawer
  useEffect(() => {
    const fetchEditLeadData = async () => {
      try {
        // Fetch currencies - try both new and legacy tables
        const [newCurrencies, legacyCurrencies] = await Promise.all([
          supabase.from('misc_currency').select('id, front_name, iso_code, name').order('name', { ascending: true }),
          supabase.from('accounting_currencies').select('id, iso_code, name').order('name', { ascending: true })
        ]);
        
        // Process currencies
        if (!newCurrencies.error && newCurrencies.data && newCurrencies.data.length > 0) {
          setCurrencies(newCurrencies.data);
        } else if (!legacyCurrencies.error && legacyCurrencies.data && legacyCurrencies.data.length > 0) {
          const transformedCurrencies = legacyCurrencies.data.map((currency: any) => ({
            id: currency.id.toString(),
            front_name: currency.iso_code === 'NIS' ? '₪' : currency.iso_code === 'EUR' ? '€' : currency.iso_code === 'USD' ? '$' : currency.iso_code === 'GBP' ? '£' : currency.iso_code,
            iso_code: currency.iso_code,
            name: currency.name
          }));
          setCurrencies(transformedCurrencies);
        } else {
          // Fallback to hardcoded currencies
          const fallbackCurrencies = [
            { id: '1', front_name: '₪', iso_code: 'NIS', name: '₪' },
            { id: '2', front_name: '€', iso_code: 'EUR', name: '€' },
            { id: '3', front_name: '$', iso_code: 'USD', name: '$' },
            { id: '4', front_name: '£', iso_code: 'GBP', name: '£' }
          ];
          setCurrencies(fallbackCurrencies);
        }

        // Fetch sources for dropdown
        const { data: sourcesData, error: sourcesError } = await supabase
          .from('misc_leadsource')
          .select('name')
          .order('name', { ascending: true });
        
        if (sourcesError) {
          console.error('Error fetching sources:', sourcesError);
        } else if (sourcesData) {
          setSources(sourcesData.map(s => s.name));
        }

        // Fetch tags for dropdown
        const { data: tagsData, error: tagsError } = await supabase
          .from('misc_leadtag')
          .select('name')
          .eq('active', true)
          .order('name', { ascending: true });
        
        if (tagsError) {
          console.error('Error fetching tags:', tagsError);
        } else if (tagsData) {
          setTagsList(tagsData.map(t => t.name));
        }

        // Extract main categories from allCategories
        if (allCategories && allCategories.length > 0) {
          const mainCatSet = new Set<string>();
          allCategories.forEach((cat: any) => {
            const mainCatName = cat.misc_maincategory?.name || '';
            if (mainCatName) {
              mainCatSet.add(mainCatName);
            }
            // Also add the category name itself
            const fullCategoryName = mainCatName 
              ? `${cat.name} (${mainCatName})`
              : cat.name;
            mainCatSet.add(fullCategoryName);
          });
          setMainCategories(Array.from(mainCatSet).sort());
        }
      } catch (error) {
        console.error('Error fetching edit lead data:', error);
      }
    };

    fetchEditLeadData();
  }, [allCategories]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (openContactDropdown) {
        const target = event.target as HTMLElement;
        // Check if click is on the dropdown menu itself or the contact button
        const dropdownMenu = document.getElementById('contact-dropdown-menu');
        const isDropdownMenu = dropdownMenu && (dropdownMenu.contains(target) || dropdownMenu === target);
        const isContactButton = target.closest('.contact-dropdown');
        
        if (!isDropdownMenu && !isContactButton) {
          console.log('🖱️ Click outside dropdown, closing');
          setOpenContactDropdown(null);
          setDropdownPosition(null);
        }
      }
    };

    if (openContactDropdown) {
      // Use a small delay to avoid immediate closure and use click instead of mousedown
      setTimeout(() => {
        document.addEventListener('click', handleClickOutside, true);
      }, 100);
    }

    return () => {
      document.removeEventListener('click', handleClickOutside, true);
    };
  }, [openContactDropdown]);

  // Only fetch leads when we have a valid employee ID
  useEffect(() => {
    if (!currentUserEmployeeId) {
      return;
    }
    fetchLeads();
  }, [pipelineMode, currentUserEmployeeId]);

  // Get signed agreement leads
  const signedAgreementLeads = useMemo(() => {
    return leads.filter(isSignedAgreementLead);
  }, [leads]);

  const filteredLeads = useMemo(() => {

    // If showing signed agreements, return all signed agreement leads
    if (showSignedAgreements) {
      return signedAgreementLeads;
    }
    
    // Start with all leads, excluding signed agreements
    let filtered = leads.filter(lead => !isSignedAgreementLead(lead));
    
    // Apply search filter
    if (searchQuery) {
      filtered = filtered.filter(lead => {
        const leadNameLower = lead.name.toLowerCase();
        const leadNumberLower = lead.lead_number.toLowerCase();
        const searchLower = searchQuery.toLowerCase();
        return leadNameLower.includes(searchLower) || leadNumberLower.includes(searchLower);
      });
    }
    
    // Apply date filters
    if (filterCreatedDateFrom || filterCreatedDateTo) {
      filtered = filtered.filter(lead => {
        const createdDate = format(parseISO(lead.created_at), 'yyyy-MM-dd');
        const matchesFrom = filterCreatedDateFrom ? createdDate >= filterCreatedDateFrom : true;
        const matchesTo = filterCreatedDateTo ? createdDate <= filterCreatedDateTo : true;
        return matchesFrom && matchesTo;
      });
    }
    
    // Apply label filter
    if (labelFilter) {
      filtered = filtered.filter(lead => lead.label === labelFilter);
    }
    
    // Apply status filters
    if (showUnassignedOnly) {
      filtered = filtered.filter(lead => isUnassignedLead(lead));
    }
    
    if (showLostInteractionsOnly) {
      filtered = filtered.filter(lead => hasLostInteractions(lead));
    }
    
    // Apply stage filter
    if (filterBy.startsWith('stage:')) {
      const selectedStageName = filterBy.replace('stage:', '');
      filtered = filtered.filter(lead => {
        if (!lead.stage) return false;
        const leadStageName = getStageName(lead.stage);
        return leadStageName === selectedStageName;
      });
    }
    
    // Apply other specific filters
    const today = new Date();
    today.setHours(0,0,0,0);
    
    if (filterBy === 'followup_missed') {
      // Only leads with a past follow up date, sorted by oldest first, then leads with no date
      const past = filtered.filter(lead => lead.next_followup && parseISO(lead.next_followup) < today)
        .sort((a, b) => parseISO(a.next_followup!).getTime() - parseISO(b.next_followup!).getTime());
      const noDate = filtered.filter(lead => !lead.next_followup);
      return [...past, ...noDate];
    } else if (filterBy === 'followup_upcoming') {
      // Only leads with a today/future follow up date, sorted by soonest first, then leads with no date
      const future = filtered.filter(lead => lead.next_followup && parseISO(lead.next_followup) >= today)
        .sort((a, b) => parseISO(a.next_followup!).getTime() - parseISO(b.next_followup!).getTime());
      const noDate = filtered.filter(lead => !lead.next_followup);
      
      return [...future, ...noDate];
    } else if (filterBy === 'commented') {
      // Only leads with at least one comment
      return filtered.filter(lead => lead.comments && lead.comments.length > 0);
    } else if (filterBy === 'top10_offer') {
      // Top 10 highest offer
      return [...filtered]
        .filter(lead => typeof lead.balance === 'number')
        .sort((a, b) => (b.balance || 0) - (a.balance || 0))
        .slice(0, 10);
    } else if (filterBy === 'top10_probability') {
      // Top 10 highest probability
      return [...filtered]
        .filter(lead => typeof lead.probability === 'number')
        .sort((a, b) => (b.probability || 0) - (a.probability || 0))
        .slice(0, 10);
    }

    // Filter by country
    if (filterCountry) {
      filtered = filtered.filter(lead => {
        const countryId = lead.country_id || lead.country;
        if (!countryId) return false;
        const country = allCountries.find((c: any) => c.id.toString() === countryId.toString() || c.name === countryId);
        return country && country.name === filterCountry;
      });
    }

    // Filter by language
    if (filterLanguage) {
      filtered = filtered.filter(lead => {
        const languageName = getLanguageName(lead.language_id, lead.language);
        return languageName === filterLanguage;
      });
    }
    
    return filtered;
  }, [leads, showSignedAgreements, searchQuery, filterCreatedDateFrom, filterCreatedDateTo, filterBy, labelFilter, showUnassignedOnly, showLostInteractionsOnly, filterCountry, filterLanguage, allCountries, allLanguages]);

  // Extract unique values from leads for filter dropdowns
  const availableCountries = useMemo(() => {
    const countrySet = new Set<string>();
    leads.forEach(lead => {
      const countryName = getCountryName(lead.country_id || lead.country);
      if (countryName && countryName !== 'N/A') {
        countrySet.add(countryName);
      }
    });
    return Array.from(countrySet).sort();
  }, [leads, allCountries]);

  const availableLanguages = useMemo(() => {
    const languageSet = new Set<string>();
    leads.forEach(lead => {
      const languageName = getLanguageName(lead.language_id, lead.language);
      if (languageName && languageName !== 'N/A') {
        languageSet.add(languageName);
      }
    });
    return Array.from(languageSet).sort();
  }, [leads, allLanguages]);

  const availableLabels = useMemo(() => {
    const labelSet = new Set<string>();
    leads.forEach(lead => {
      if (lead.label && lead.label.trim() !== '') {
        labelSet.add(lead.label);
      }
    });
    return Array.from(labelSet).sort();
  }, [leads]);

  const handleSort = (column: 'created_at' | 'meeting_date' | 'stage' | 'offer' | 'probability' | 'total_applicants' | 'potential_applicants' | 'follow_up') => {
    if (sortColumn === column) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  const sortedLeads = useMemo(() => {
    let leadsToSort = [...filteredLeads];
    if (sortColumn) {
      leadsToSort.sort((a, b) => {
        let aValue, bValue;
        switch (sortColumn) {
          case 'created_at':
            aValue = a.created_at;
            bValue = b.created_at;
            break;
          case 'meeting_date':
            aValue = a.meetings[0]?.meeting_date || '';
            bValue = b.meetings[0]?.meeting_date || '';
            break;
          case 'stage':
            aValue = a.stage || '';
            bValue = b.stage || '';
            break;
          case 'offer':
            aValue = a.balance ?? 0;
            bValue = b.balance ?? 0;
            break;
          case 'probability':
            aValue = a.probability ?? 0;
            bValue = b.probability ?? 0;
            break;
          case 'total_applicants':
            aValue = a.number_of_applicants_meeting ?? 0;
            bValue = b.number_of_applicants_meeting ?? 0;
            break;
          case 'potential_applicants':
            aValue = a.potential_applicants_meeting ?? 0;
            bValue = b.potential_applicants_meeting ?? 0;
            break;
          case 'follow_up':
            aValue = a.next_followup ? new Date(a.next_followup).getTime() : 0;
            bValue = b.next_followup ? new Date(b.next_followup).getTime() : 0;
            break;
          default:
            aValue = '';
            bValue = '';
        }
        if (sortColumn === 'created_at') {
          aValue = a.created_at;
          bValue = b.created_at;
        } else if (sortColumn === 'meeting_date') {
          aValue = a.meetings[0]?.meeting_date || '';
          bValue = b.meetings[0]?.meeting_date || '';
        }
        if (!aValue && !bValue) return 0;
        if (!aValue) return sortDirection === 'asc' ? -1 : 1;
        if (!bValue) return sortDirection === 'asc' ? 1 : -1;
        if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return leadsToSort;
  }, [filteredLeads, sortColumn, sortDirection]);

  // Calculate summary statistics from the actual filtered leads being displayed
  const summaryStats = useMemo(() => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Use the filtered leads that are actually being displayed
    const displayedLeads = filteredLeads;
    
    // Contracts signed in last 30 days (stage includes 'Client signed agreement')
    const contractsSignedLeads = displayedLeads.filter(lead => 
      isSignedAgreementLead(lead) && new Date(lead.created_at) >= thirtyDaysAgo
    );
    const contractsSigned = contractsSignedLeads.length;

    // Count total leads in pipeline (excluding signed agreements)
    const pipelineLeads = displayedLeads.filter(lead => !isSignedAgreementLead(lead));
    const totalLeads = pipelineLeads.length;
    

    // Calculate top worker based on pipeline mode
    const roleCounts: Record<string, number> = {};
    contractsSignedLeads.forEach(lead => {
      let roleValue = 'Unknown';
      if (pipelineMode === 'closer') {
        roleValue = lead.closer || 'Unknown';
      } else if (pipelineMode === 'scheduler') {
        roleValue = lead.scheduler || 'Unknown';
      }
      roleCounts[roleValue] = (roleCounts[roleValue] || 0) + 1;
    });
    let topWorker = 'N/A';
    let topWorkerCount = 0;
    Object.entries(roleCounts).forEach(([role, count]) => {
      if (count > topWorkerCount) {
        topWorker = role;
        topWorkerCount = count;
      }
    });

    return {
      contractsSigned,
      totalLeads,
      topWorker,
      topWorkerCount
    };
  }, [filteredLeads, pipelineMode]);

  const handleRowClick = (lead: LeadForPipeline) => {
    setSelectedLead(lead);
    setDrawerOpen(true);
    setNewComment('');
    fetchConversationsForLead(lead);
    fetchContactsForLead(lead);
  };

  // Fetch contacts for a lead
  const fetchContactsForLead = async (lead: LeadForPipeline) => {
    setContactsLoading(true);
    try {
      const isLegacyLead = lead.lead_type === 'legacy' || lead.id.toString().startsWith('legacy_');
      const leadId = isLegacyLead ? lead.id.toString().replace('legacy_', '') : lead.id;
      
      let fetchedContacts: any[] = [];
      
      if (isLegacyLead) {
        // For legacy leads, fetch from lead_leadcontact and leads_contact tables
        const { data: leadContactsData, error: leadContactsError } = await supabase
          .from('lead_leadcontact')
          .select(`
            id,
            main,
            contact_id,
            lead_id
          `)
          .eq('lead_id', leadId);
        
        if (!leadContactsError && leadContactsData && leadContactsData.length > 0) {
          const contactIds = leadContactsData.map((lc: any) => lc.contact_id).filter(Boolean);
          
          if (contactIds.length > 0) {
            const { data: contactsData, error: contactsError } = await supabase
              .from('leads_contact')
              .select('id, name, phone, mobile, email')
              .in('id', contactIds);
            
            if (!contactsError && contactsData) {
              // Map contacts to their lead-contact relationships
              leadContactsData.forEach((leadContact: any) => {
                const contact = contactsData.find((c: any) => c.id === leadContact.contact_id);
                if (contact) {
                  fetchedContacts.push({
                    id: contact.id,
                    name: contact.name,
                    phone: contact.phone,
                    mobile: contact.mobile,
                    email: contact.email,
                    isMain: leadContact.main === 'true' || leadContact.main === true || leadContact.main === 't'
                  });
                }
              });
            }
          }
        }
      } else {
        // For new leads, fetch from contacts table
        const { data: contactsData, error: contactsError } = await supabase
          .from('contacts')
          .select('id, name, phone, mobile, email, is_main_applicant')
          .eq('lead_id', leadId)
          .order('is_main_applicant', { ascending: false })
          .order('created_at', { ascending: true });
        
        if (!contactsError && contactsData) {
          fetchedContacts = contactsData.map((contact: any) => ({
            id: contact.id,
            name: contact.name,
            phone: contact.phone,
            mobile: contact.mobile,
            email: contact.email,
            isMain: contact.is_main_applicant || false
          }));
        }
      }
      
      // Add main lead contact if available
      if (lead.email || lead.phone || lead.mobile) {
        fetchedContacts.unshift({
          id: 'main',
          name: lead.name,
          phone: lead.phone,
          mobile: lead.mobile,
          email: lead.email,
          isMain: true
        });
      }
      
      setContacts(fetchedContacts);
    } catch (error) {
      console.error('Error fetching contacts:', error);
      setContacts([]);
    } finally {
      setContactsLoading(false);
    }
  };

  // Fetch conversations for a lead (emails, whatsapp, manual interactions)
  const fetchConversationsForLead = async (lead: LeadForPipeline) => {
    setConversationsLoading(true);
    try {
      const isLegacyLead = lead.lead_type === 'legacy' || lead.id.toString().startsWith('legacy_');
      const leadId = isLegacyLead ? lead.id.toString().replace('legacy_', '') : lead.id;
      
      // Fetch emails
      let emails: any[] = [];
      if (isLegacyLead) {
        const { data: emailData } = await supabase
          .from('emails')
          .select('id, message_id, sender_name, sender_email, recipient_list, subject, body_html, sent_at, direction')
          .eq('legacy_id', leadId)
          .order('sent_at', { ascending: false })
          .limit(10);
        emails = emailData || [];
      } else {
        const { data: emailData } = await supabase
          .from('emails')
          .select('id, message_id, sender_name, sender_email, recipient_list, subject, body_html, sent_at, direction')
          .eq('client_id', leadId)
          .order('sent_at', { ascending: false })
          .limit(10);
        emails = emailData || [];
      }
      
      // Fetch WhatsApp messages
      let whatsappMessages: any[] = [];
      if (!isLegacyLead) {
        const { data: whatsappData } = await supabase
          .from('whatsapp_messages')
          .select('id, message, sent_at, direction, sender_name, phone_number')
          .eq('lead_id', leadId)
          .order('sent_at', { ascending: false })
          .limit(10);
        whatsappMessages = whatsappData || [];
      }
      
      // Format conversations
      const formattedConversations: any[] = [];
      
      // Add emails
      emails.forEach((email: any) => {
        const bodyPreview = email.body_html 
          ? email.body_html.replace(/<[^>]*>/g, '').substring(0, 150)
          : email.subject || '';
        formattedConversations.push({
          id: email.message_id || email.id,
          type: 'email',
          content: bodyPreview,
          subject: email.subject,
          sender: email.sender_name || email.sender_email,
          timestamp: email.sent_at,
          direction: email.direction === 'outgoing' ? 'out' : 'in',
        });
      });
      
      // Add WhatsApp messages
      whatsappMessages.forEach((msg: any) => {
        formattedConversations.push({
          id: msg.id,
          type: 'whatsapp',
          content: msg.message,
          sender: msg.sender_name || 'Client',
          timestamp: msg.sent_at,
          direction: msg.direction,
        });
      });
      
      // Add manual interactions
      (lead.manual_interactions || []).forEach((interaction: any) => {
        formattedConversations.push({
          id: interaction.id || `manual_${interaction.raw_date}`,
          type: interaction.kind || 'contact',
          content: interaction.content,
          sender: interaction.employee || 'Employee',
          timestamp: interaction.raw_date,
          direction: interaction.direction || 'out',
        });
      });
      
      // Sort by timestamp descending
      formattedConversations.sort((a, b) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
      
      setConversations(formattedConversations.slice(0, 10)); // Show latest 10
    } catch (error) {
      console.error('Error fetching conversations:', error);
      setConversations([]);
    } finally {
      setConversationsLoading(false);
    }
  };

  // Action handlers (from SchedulerToolPage)
  const handleCall = (lead: LeadForPipeline) => {
    const phoneNumber = lead.phone || lead.mobile;
    if (phoneNumber) {
      window.open(`tel:${phoneNumber}`, '_self');
    } else {
      toast.error('No phone number available for this lead');
    }
  };

  const handleEmail = (lead: LeadForPipeline) => {
    console.log('📧 Email clicked for lead:', lead);
    setSelectedLead(lead);
    setIsContactEmailModalOpen(true);
    setOpenContactDropdown(null);
    setDropdownPosition(null);
  };

  const handleWhatsApp = (lead: LeadForPipeline) => {
    console.log('💬 WhatsApp clicked for lead:', lead);
    setSelectedLead(lead);
    setIsContactWhatsAppModalOpen(true);
    setOpenContactDropdown(null);
    setDropdownPosition(null);
  };

  const handleTimeline = (lead: LeadForPipeline) => {
    navigate(`/clients/${lead.lead_number}?tab=interactions`);
  };

  const handleViewClient = (lead: LeadForPipeline) => {
    navigate(`/clients/${lead.lead_number}`);
  };

  const handleEditLead = async (lead: LeadForPipeline) => {
    // Set selected lead for editing
    setSelectedLead(lead);
    
    // Get the correct currency for this lead
    const currentCurrency = getCurrencySymbol(lead.balance_currency) || '₪';
    
    // Get language name
    const languageName = getLanguageName(lead.language_id, lead.language);
    
    // Reset the edit form data with current lead data
    setEditLeadData({
      tags: '',
      source: lead.source || '',
      name: lead.name || '',
      language: languageName !== 'N/A' ? languageName : '',
      category: lead.category || '',
      topic: lead.topic || '',
      probability: lead.probability || 0,
      number_of_applicants_meeting: lead.number_of_applicants_meeting?.toString() || '',
      potential_applicants_meeting: lead.potential_applicants_meeting?.toString() || '',
      balance: lead.balance?.toString() || '',
      next_followup: lead.next_followup || '',
      balance_currency: currentCurrency,
      eligible: lead.eligible !== false,
    });
    
    // Fetch current lead's tags
    await fetchCurrentLeadTags(lead.id.toString());
    
    setShowEditLeadDrawer(true);
  };

  const handleEditLeadChange = (field: string, value: any) => {
    setEditLeadData(prev => ({ ...prev, [field]: value }));
  };

  const fetchCurrentLeadTags = async (leadId: string) => {
    try {
      // Check if it's a legacy lead
      const isLegacyLead = leadId.toString().startsWith('legacy_');
      
      if (isLegacyLead) {
        const legacyId = parseInt(leadId.replace('legacy_', ''));
        const { data, error } = await supabase
          .from('leads_lead_tags')
          .select(`
            id,
            leadtag_id,
            misc_leadtag (
              id,
              name
            )
          `)
          .eq('lead_id', legacyId);
        
        if (!error && data) {
          const tags = data
            .filter(item => item.misc_leadtag && typeof item.misc_leadtag === 'object')
            .map(item => (item.misc_leadtag as any).name);
          
          // Join tags with comma and space
          const tagsString = tags.join(', ');
          setCurrentLeadTags(tagsString);
        } else {
          console.error('❌ Error fetching current lead tags (legacy):', error);
          setCurrentLeadTags('');
        }
      } else {
        // For new leads, fetch from leads_lead_tags table using newlead_id
        const { data, error } = await supabase
          .from('leads_lead_tags')
          .select(`
            id,
            leadtag_id,
            misc_leadtag (
              id,
              name
            )
          `)
          .eq('newlead_id', leadId);
        
        if (!error && data) {
          const tags = data
            .filter(item => item.misc_leadtag && typeof item.misc_leadtag === 'object')
            .map(item => (item.misc_leadtag as any).name);
          
          // Join tags with comma and space
          const tagsString = tags.join(', ');
          setCurrentLeadTags(tagsString);
        } else {
          console.error('❌ Error fetching current lead tags (new):', error);
          setCurrentLeadTags('');
        }
      }
    } catch (error) {
      console.error('❌ Error fetching current lead tags:', error);
      setCurrentLeadTags('');
    }
  };

  const saveLeadTags = async (leadId: string, tagsString: string) => {
    try {
      const isLegacyLead = leadId.toString().startsWith('legacy_');
      
      if (isLegacyLead) {
        const legacyId = parseInt(leadId.replace('legacy_', ''));
        
        // First, remove all existing tags for this legacy lead
        const { error: deleteError } = await supabase
          .from('leads_lead_tags')
          .delete()
          .eq('lead_id', legacyId);
        
        if (deleteError) {
          console.error('❌ Error deleting existing tags (legacy):', deleteError);
          return;
        }
        
        // Parse the tags string and find matching tag IDs
        if (tagsString.trim()) {
          const tagNames = tagsString.split(',').map(tag => tag.trim()).filter(tag => tag);
          
          // Fetch tags to get IDs
          const { data: allTagsData } = await supabase
            .from('misc_leadtag')
            .select('id, name')
            .eq('active', true);
          
          // Find tag IDs for the provided tag names
          const tagIds = tagNames
            .map(tagName => allTagsData?.find(tag => tag.name === tagName)?.id)
            .filter(id => id !== undefined);
          
          // Insert new tags for legacy lead
          if (tagIds.length > 0) {
            const tagInserts = tagIds.map(tagId => ({
              lead_id: legacyId,
              leadtag_id: tagId
            }));
            
            const { error: insertError } = await supabase
              .from('leads_lead_tags')
              .insert(tagInserts);
            
            if (insertError) {
              console.error('❌ Error inserting tags (legacy):', insertError);
            }
          }
        }
      } else {
        // For new leads, remove all existing tags
        const { error: deleteError } = await supabase
          .from('leads_lead_tags')
          .delete()
          .eq('newlead_id', leadId);
        
        if (deleteError) {
          console.error('❌ Error deleting existing tags (new):', deleteError);
          return;
        }
        
        // Parse the tags string and find matching tag IDs
        if (tagsString.trim()) {
          const tagNames = tagsString.split(',').map(tag => tag.trim()).filter(tag => tag);
          
          // Fetch tags to get IDs
          const { data: allTagsData } = await supabase
            .from('misc_leadtag')
            .select('id, name')
            .eq('active', true);
          
          // Find tag IDs for the provided tag names
          const tagIds = tagNames
            .map(tagName => allTagsData?.find(tag => tag.name === tagName)?.id)
            .filter(id => id !== undefined);
          
          // Insert new tags for new lead
          if (tagIds.length > 0) {
            const tagInserts = tagIds.map(tagId => ({
              newlead_id: leadId,
              leadtag_id: tagId
            }));
            
            const { error: insertError } = await supabase
              .from('leads_lead_tags')
              .insert(tagInserts);
            
            if (insertError) {
              console.error('❌ Error inserting tags (new):', insertError);
            }
          }
        }
      }
    } catch (error) {
      console.error('❌ Error saving lead tags:', error);
    }
  };

  const fetchCurrentUserFullName = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) {
        const { data: userData, error } = await supabase
          .from('users')
          .select('full_name')
          .eq('email', user.email)
          .single();
        
        if (error) {
          console.error('Error fetching user full name:', error);
          return user.email;
        }
        
        return userData?.full_name || user.email;
      }
      return 'Unknown User';
    } catch (error) {
      console.error('Error in fetchCurrentUserFullName:', error);
      return 'Unknown User';
    }
  };

  const handleSaveEditLead = async () => {
    if (!selectedLead) return;
    
    // Check if this is a legacy lead
    const isLegacyLead = selectedLead.lead_type === 'legacy' || selectedLead.id.toString().startsWith('legacy_');
    
    try {
      // Get current user name from Supabase users table
      const currentUserName = await fetchCurrentUserFullName();
      
      // Create update data based on whether it's a legacy lead or not
      let updateData: any = {};
      
      if (isLegacyLead) {
        // For legacy leads, only include fields that exist in leads_lead table
        const currencyNameToId = (currencyName: string): number | null => {
          switch (currencyName) {
            case '₪': return 1; // NIS
            case '€': return 2; // EUR  
            case '$': return 3; // USD
            case '£': return 4; // GBP
            default: return 1; // Default to NIS
          }
        };
        
        // Check each field and only include if it has changed
        if (editLeadData.name !== selectedLead.name) {
          updateData.name = editLeadData.name;
        }
        if (editLeadData.topic !== selectedLead.topic) {
          updateData.topic = editLeadData.topic;
        }
        if (editLeadData.probability !== selectedLead.probability) {
          let probabilityValue = null;
          if (editLeadData.probability !== null && editLeadData.probability !== undefined) {
            const parsed = Number(editLeadData.probability);
            probabilityValue = isNaN(parsed) ? null : parsed;
          }
          updateData.probability = probabilityValue;
        }
        if (editLeadData.next_followup !== selectedLead.next_followup) {
          const followupValue = editLeadData.next_followup === '' || editLeadData.next_followup === null ? 
            null : editLeadData.next_followup;
          updateData.next_followup = followupValue;
        }
        if (editLeadData.balance !== selectedLead.balance?.toString()) {
          const balanceValue = editLeadData.balance === '' || editLeadData.balance === null ? null : String(editLeadData.balance);
          updateData.total = balanceValue;
        }
        if (editLeadData.balance_currency !== selectedLead.balance_currency) {
          updateData.currency_id = currencyNameToId(editLeadData.balance_currency);
        }
        if (editLeadData.category !== selectedLead.category) {
          const fullCategoryString = editLeadData.category;
          const foundCategory = allCategories.find((cat: any) => {
            const expectedFormat = cat.misc_maincategory?.name 
              ? `${cat.name} (${cat.misc_maincategory.name})`
              : cat.name;
            return expectedFormat === fullCategoryString;
          });
          
          if (foundCategory) {
            updateData.category_id = foundCategory.id;
          } else {
            const categoryName = editLeadData.category.includes(' (') ? editLeadData.category.split(' (')[0] : editLeadData.category;
            const fallbackCategory = allCategories.find((cat: any) => 
              cat.name.toLowerCase().trim() === categoryName.toLowerCase().trim()
            );
            
            if (fallbackCategory) {
              updateData.category_id = fallbackCategory.id;
            } else {
              updateData.category = editLeadData.category;
            }
          }
        }
        if (editLeadData.eligible !== selectedLead.eligible) {
          updateData.eligibile = editLeadData.eligible ? 'yes' : 'no';
        }
        
        // Handle number_of_applicants_meeting and potential_applicants_meeting for legacy
        if (editLeadData.number_of_applicants_meeting !== selectedLead.number_of_applicants_meeting?.toString()) {
          const applicantsValue = editLeadData.number_of_applicants_meeting === '' ? null : Number(editLeadData.number_of_applicants_meeting);
          updateData.no_of_applicants = isNaN(applicantsValue as number) ? null : applicantsValue;
        }
        if (editLeadData.potential_applicants_meeting !== selectedLead.potential_applicants_meeting?.toString()) {
          const potentialValue = editLeadData.potential_applicants_meeting === '' ? null : Number(editLeadData.potential_applicants_meeting);
          updateData.potential_applicants = isNaN(potentialValue as number) ? null : potentialValue;
        }

        // Only update if there are changes
        if (Object.keys(updateData).length > 0) {
          const legacyId = selectedLead.id.toString().replace('legacy_', '');
          const { error } = await supabase
            .from('leads_lead')
            .update(updateData)
            .eq('id', legacyId);
          
          if (error) throw error;
        }
      } else {
        // For regular leads, check each field and only include if it has changed
        if (editLeadData.source !== selectedLead.source) {
          updateData.source = editLeadData.source;
        }
        if (editLeadData.name !== selectedLead.name) {
          updateData.name = editLeadData.name;
        }
        if (editLeadData.language !== getLanguageName(selectedLead.language_id, selectedLead.language)) {
          updateData.language = editLeadData.language;
        }
        if (editLeadData.category !== selectedLead.category) {
          const fullCategoryString = editLeadData.category;
          const foundCategory = allCategories.find((cat: any) => {
            const expectedFormat = cat.misc_maincategory?.name 
              ? `${cat.name} (${cat.misc_maincategory.name})`
              : cat.name;
            return expectedFormat === fullCategoryString;
          });
          
          if (foundCategory) {
            updateData.category_id = foundCategory.id;
            updateData.category = foundCategory.name;
          } else {
            const categoryName = editLeadData.category.includes(' (') ? editLeadData.category.split(' (')[0] : editLeadData.category;
            const fallbackCategory = allCategories.find((cat: any) => 
              cat.name.toLowerCase().trim() === categoryName.toLowerCase().trim()
            );
            
            if (fallbackCategory) {
              updateData.category_id = fallbackCategory.id;
              updateData.category = fallbackCategory.name;
            } else {
              updateData.category = editLeadData.category;
            }
          }
        }
        if (editLeadData.topic !== selectedLead.topic) {
          updateData.topic = editLeadData.topic;
        }
        if (editLeadData.probability !== selectedLead.probability) {
          let probabilityValue = null;
          if (editLeadData.probability !== null && editLeadData.probability !== undefined) {
            const parsed = Number(editLeadData.probability);
            probabilityValue = isNaN(parsed) ? null : parsed;
          }
          updateData.probability = probabilityValue;
        }
        if (editLeadData.number_of_applicants_meeting !== selectedLead.number_of_applicants_meeting?.toString()) {
          let applicantsValue = null;
          if (editLeadData.number_of_applicants_meeting !== '' && editLeadData.number_of_applicants_meeting !== null && editLeadData.number_of_applicants_meeting !== undefined) {
            const parsed = Number(editLeadData.number_of_applicants_meeting);
            applicantsValue = isNaN(parsed) ? null : parsed;
          }
          updateData.number_of_applicants_meeting = applicantsValue;
        }
        if (editLeadData.potential_applicants_meeting !== selectedLead.potential_applicants_meeting?.toString()) {
          let potentialValue = null;
          if (editLeadData.potential_applicants_meeting !== '' && editLeadData.potential_applicants_meeting !== null && editLeadData.potential_applicants_meeting !== undefined) {
            const parsed = Number(editLeadData.potential_applicants_meeting);
            potentialValue = isNaN(parsed) ? null : parsed;
          }
          updateData.potential_applicants_meeting = potentialValue;
        }
        if (editLeadData.balance !== selectedLead.balance?.toString()) {
          if (editLeadData.balance !== '' && editLeadData.balance !== null && editLeadData.balance !== undefined) {
            const parsed = Number(editLeadData.balance);
            updateData.balance = isNaN(parsed) ? null : parsed;
          } else {
            updateData.balance = null;
          }
        }
        if (editLeadData.next_followup !== selectedLead.next_followup) {
          const followupValue = editLeadData.next_followup === '' || editLeadData.next_followup === null ? 
            null : editLeadData.next_followup;
          updateData.next_followup = followupValue;
        }
        if (editLeadData.balance_currency !== selectedLead.balance_currency) {
          updateData.balance_currency = editLeadData.balance_currency;
        }
        if (editLeadData.eligible !== selectedLead.eligible) {
          updateData.eligible = editLeadData.eligible;
        }

        // Only update if there are changes
        if (Object.keys(updateData).length > 0) {
          const { error } = await supabase
            .from('leads')
            .update(updateData)
            .eq('id', selectedLead.id);
          
          if (error) throw error;
        }
      }

      // Save tags if they changed
      if (currentLeadTags !== (selectedLead?.tags || '')) {
        await saveLeadTags(selectedLead.id.toString(), currentLeadTags);
      }
      
      // Refresh leads
      await fetchLeads();
      
      setShowEditLeadDrawer(false);
      setSelectedLead(null);
    } catch (error) {
      console.error('Error in handleSaveEditLead:', error);
    }
  };

  const toggleContactDropdown = (leadId: string | number) => {
    console.log('🔽 Toggle dropdown for lead:', leadId);
    if (openContactDropdown === leadId) {
      setOpenContactDropdown(null);
      setDropdownPosition(null);
    } else {
      setOpenContactDropdown(leadId);
      // Calculate position for dropdown
      const button = contactButtonRefs.current[leadId];
      if (button) {
        const rect = button.getBoundingClientRect();
        setDropdownPosition({
          top: rect.top - 120, // Position above the button
          left: rect.right - 140 // Align right edge
        });
        console.log('📍 Dropdown position:', { top: rect.top - 120, left: rect.right - 140 });
      } else {
        console.error('❌ Button ref not found for lead:', leadId);
      }
    }
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setTimeout(() => setSelectedLead(null), 400);
  };

  const openContactDrawer = () => {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const date = `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear().toString().slice(-2)}`;
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    setNewContact({
      method: 'email',
      date,
      time,
      length: '',
      content: '',
      observation: '',
    });
    setContactDrawerOpen(true);
    setDrawerOpen(false);
  };

  const closeContactDrawer = () => {
    setContactDrawerOpen(false);
  };

  const handleNewContactChange = (field: string, value: string) => {
    setNewContact((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveContact = async () => {
    if (!selectedLead) return;

    const now = new Date();
    // Get current user's full name
    let currentUserFullName = 'Current User';
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) {
        const { data: userData } = await supabase
          .from('users')
          .select('full_name, name')
          .eq('email', user.email)
          .single();
        if (userData?.full_name) {
          currentUserFullName = userData.full_name;
        } else if (userData?.name) {
          currentUserFullName = userData.name;
        }
      }
    } catch (error) {
      console.error('Error fetching user info:', error);
    }

    const newInteraction = {
      id: `manual_${now.getTime()}`,
      date: newContact.date || now.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }),
      time: newContact.time || now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      raw_date: now.toISOString(),
      employee: currentUserFullName,
      direction: 'out',
      kind: newContact.method,
      length: newContact.length ? `${newContact.length}m` : '',
      content: newContact.content,
      observation: newContact.observation,
      editable: true,
    };

    try {
      const existingInteractions = selectedLead.manual_interactions || [];
      const updatedInteractions = [...existingInteractions, newInteraction];

      const { error: updateError } = await supabase
        .from('leads')
        .update({ manual_interactions: updatedInteractions })
        .eq('id', selectedLead.id);

      if (updateError) throw updateError;
      
      // Update local state
      setSelectedLead({ ...selectedLead, manual_interactions: updatedInteractions });
      closeContactDrawer();
      
      // Refresh leads data
      const fetchLeads = async () => {
        setIsLoading(true);
        const { data, error } = await supabase
          .from('leads')
          .select(`
            id,
            lead_number,
            name,
            created_at,
            expert,
            topic,
            handler_notes,
            expert_notes,
            meetings (
              meeting_date
            ),
            onedrive_folder_link,
            stage,
            number_of_applicants_meeting,
            potential_applicants_meeting,
            balance,
            balance_currency,
            probability,
            eligibility_status,
            next_followup,
            manual_interactions,
            email,
            mobile,
            phone,
            comments,
            label
          `)
          .order('created_at', { ascending: false });

        if (error) {
          console.error('Error fetching leads for pipeline page:', error);
          setLeads([]);
        } else {
          setLeads(data as LeadForPipeline[]);
        }
        setIsLoading(false);
      };
      
      await fetchLeads();
    } catch (error) {
      console.error('Error saving contact:', error);
    }
  };

  const handleAttachmentUpload = async (files: FileList) => {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      if (file.size > 4 * 1024 * 1024) continue;
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const content = e.target?.result as string;
          const base64Content = content.split(',')[1];
          if (!base64Content) return;
          setComposeAttachments(prev => [...prev, {
            name: file.name,
            contentType: file.type,
            contentBytes: base64Content
          }]);
        } catch (err) {}
      };
      reader.readAsDataURL(file);
    }
  };

  // MSAL hooks
  const { instance, accounts } = useMsal();

  // Fetch emails from Outlook/Graph when opening email modal
  const handleOpenEmailModal = async () => {
    setIsEmailModalOpen(true);
    if (!selectedLead || !instance || !accounts[0]) return;
    setEmailsLoading(true);
    try {
      const tokenResponse = await acquireToken(instance, accounts[0]);
      await syncClientEmails(tokenResponse.accessToken, selectedLead);
      // Fetch emails from DB for this lead
      const { data } = await supabase.from('emails').select('*').eq('client_id', selectedLead.id).order('sent_at', { ascending: false });
      setEmails(data || []);
    } catch (e) {
      // Optionally show error
    }
    setEmailsLoading(false);
  };

  // Helper to acquire token, falling back to popup if needed
  const acquireToken = async (instance: IPublicClientApplication, account: AccountInfo) => {
    try {
      return await instance.acquireTokenSilent({ ...loginRequest, account });
    } catch (error) {
      if (error instanceof InteractionRequiredAuthError) {
        return await instance.acquireTokenPopup({ ...loginRequest, account });
      }
      throw error;
    }
  };

  // Microsoft Graph API: Fetch emails for a client and sync to DB
  async function syncClientEmails(token: string, lead: LeadForPipeline) {
    if (!lead.email || !lead.lead_number) return;
    const searchQuery = `"${lead.lead_number}" OR "${lead.email}"`;
    const url = `https://graph.microsoft.com/v1.0/me/messages?$search=${encodeURIComponent(searchQuery)}&$top=50&$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,body,conversationId,hasAttachments`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        ConsistencyLevel: 'eventual'
      }
    });
    if (!res.ok) return;
    const json = await res.json();
    const messages: any[] = json.value || [];
    const clientMessages = messages.filter((msg: any) =>
      (msg.subject && msg.subject.includes(lead.lead_number)) ||
      (msg.from?.emailAddress?.address.toLowerCase() === lead.email!.toLowerCase()) ||
      (msg.toRecipients || []).some((r: any) => r.emailAddress.address.toLowerCase() === lead.email!.toLowerCase()) ||
      (msg.ccRecipients || []).some((r: any) => r.emailAddress.address.toLowerCase() === lead.email!.toLowerCase())
    );
    if (clientMessages.length === 0) return;
    clientMessages.sort((a: any, b: any) => new Date(b.receivedDateTime).getTime() - new Date(a.receivedDateTime).getTime());
    // No attachments for now
    const emailsToUpsert = clientMessages.map((msg: any) => ({
      message_id: msg.id,
      client_id: lead.id,
      thread_id: msg.conversationId,
      sender_name: msg.from?.emailAddress?.name,
      sender_email: msg.from?.emailAddress?.address,
      recipient_list: (msg.toRecipients || []).map((r: any) => r.emailAddress.address).join(', '),
      subject: msg.subject,
      body_preview: msg.body?.content || '',
      sent_at: msg.receivedDateTime,
      direction: msg.from?.emailAddress?.address.toLowerCase().includes('lawoffice.org.il') ? 'outgoing' : 'incoming',
      attachments: null,
    }));
    await supabase.from('emails').upsert(emailsToUpsert, { onConflict: 'message_id' });
  };

  // Set default subject when opening compose drawer
  useEffect(() => {
    if (showCompose && selectedLead) {
      const defaultSubject = `[${selectedLead.lead_number}] - ${selectedLead.name} - ${selectedLead.topic || ''}`;
      setComposeSubject(defaultSubject);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCompose, selectedLead]);

  // Send email via Microsoft Graph (copied from InteractionsTab)
  async function sendClientEmail(token: string, subject: string, body: string, lead: LeadForPipeline, senderName: string, attachments: { name: string; contentType: string; contentBytes: string }[]) {
    const signature = `<br><br>Best regards,<br>${senderName}<br>Decker Pex Levi Law Offices`;
    const fullBody = body + signature;
    const messageAttachments = attachments.map(att => ({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: att.name,
      contentType: att.contentType,
      contentBytes: att.contentBytes
    }));
    const draftMessage = {
      subject,
      body: { contentType: 'HTML', content: fullBody },
      toRecipients: [{ emailAddress: { address: lead.email! } }],
      attachments: messageAttachments.length > 0 ? messageAttachments : undefined,
    };
    // 1. Create a draft message to get its ID
    const createDraftUrl = `https://graph.microsoft.com/v1.0/me/messages`;
    const draftRes = await fetch(createDraftUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(draftMessage),
    });
    if (!draftRes.ok) {
      throw new Error('Failed to create email draft.');
    }
    const createdDraft = await draftRes.json();
    const messageId = createdDraft.id;
    if (!messageId) {
      throw new Error('Could not get message ID from draft.');
    }
    // 2. Send the draft message
    const sendUrl = `https://graph.microsoft.com/v1.0/me/messages/${messageId}/send`;
    const sendRes = await fetch(sendUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!sendRes.ok) {
      throw new Error('Failed to send email.');
    }
    return createdDraft;
  }

  // Helper to get current user's name
  async function fetchCurrentUserName() {
    const { data: { user } } = await supabase.auth.getUser();
    if (user && user.email) {
      const { data, error } = await supabase
        .from('users')
        .select('full_name')
        .eq('email', user.email)
        .single();
      if (!error && data?.full_name) {
        return data.full_name;
      }
      return user.email;
    }
    return 'Unknown';
  }

  // Add comment to lead
  const handleAddComment = async () => {
    if (!selectedLead || !newComment.trim()) return;
    setCommentSubmitting(true);
    const now = new Date().toISOString();
    const userName = await fetchCurrentUserName();
    const newCommentObj = { text: newComment.trim(), timestamp: now, user: userName };
    const updatedComments = [...(selectedLead.comments || []), newCommentObj];
    try {
      if (selectedLead.lead_type === 'legacy') {
        // For legacy leads, extract numeric ID and update leads_lead table
        const numericId = typeof selectedLead.id === 'string' ? parseInt(selectedLead.id.replace('legacy_', '')) : selectedLead.id;
        const { error } = await supabase
          .from('leads_lead')
          .update({ comments: updatedComments })
          .eq('id', numericId);
        if (error) throw error;
      } else {
        // For new leads
        const { error } = await supabase
          .from('leads')
          .update({ comments: updatedComments })
          .eq('id', selectedLead.id);
        if (error) throw error;
      }
      
      setSelectedLead({ ...selectedLead, comments: updatedComments });
      setNewComment('');
      // Optionally refresh leads
      setLeads(leads => leads.map(l => l.id === selectedLead.id ? { ...l, comments: updatedComments } : l));
    } catch (err) {
      console.error('Error adding comment:', err);
      // Optionally show error
    }
    setCommentSubmitting(false);
  };

  const handleLabelChange = async (leadId: number | string, label: string) => {
    setLabelSubmitting(true);
    try {
      // Determine which table to update based on lead type
      const lead = leads.find(l => l.id === leadId);
      if (!lead) return;

      if (lead.lead_type === 'legacy') {
        // For legacy leads, we need to extract the numeric ID
        const numericId = typeof leadId === 'string' ? parseInt(leadId.replace('legacy_', '')) : leadId;
        const { error } = await supabase
          .from('leads_lead')
          .update({ label })
          .eq('id', numericId);
        if (error) throw error;
      } else {
        // For new leads
        const { error } = await supabase
          .from('leads')
          .update({ label })
          .eq('id', leadId);
        if (error) throw error;
      }
      
      setLeads(leads => leads.map(l => l.id === leadId ? { ...l, label } : l));
      setLabelDropdownOpen(null);
    } catch (err) {
      console.error('Error updating label:', err);
      // Optionally show error
    }
    setLabelSubmitting(false);
  };

  // Fetch user id and full name on mount
  useEffect(() => {
    (async () => {
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        
        if (authError) {
          console.error('🔍 Authentication error:', authError);
          // Set a fallback name to allow the page to function
          setCurrentUserFullName('Eliran');
          return;
        }
        
        setUserId(user?.id || null);
        
        // Fetch current user's data with employee relationship using JOIN
        if (user?.id) {
          const { data: userData, error: userError } = await supabase
            .from('users')
            .select(`
              id,
              full_name,
              email,
              employee_id,
              tenants_employee!employee_id(
                id,
                display_name
              )
            `)
            .eq('auth_id', user.id)
            .single();
          
          if (userError) {
            console.error('🔍 User data fetch error details:', userError);
            setCurrentUserFullName('Eliran');
            return;
          }
          
          if (userData?.full_name) {
            setCurrentUserFullName(userData.full_name);
          } else if (userData?.tenants_employee && Array.isArray(userData.tenants_employee) && userData.tenants_employee.length > 0) {
            setCurrentUserFullName(userData.tenants_employee[0].display_name);
          } else {
            setCurrentUserFullName('Eliran');
          }
          
          // Store employee ID for efficient filtering
          if (userData?.employee_id && typeof userData.employee_id === 'number') {
            setCurrentUserEmployeeId(userData.employee_id);
          } else {
            setCurrentUserEmployeeId(null);
          }
        } else {
          setCurrentUserFullName('Eliran');
        }
      } catch (error) {
        console.error('�� Error in user data fetching:', error);
        // Set fallback name to ensure page functionality
        setCurrentUserFullName('Eliran');
      }
    })();
  }, []);

  // Set highlightedLeads based on leads.highlighted_by
  useEffect(() => {
    if (!userId || leads.length === 0) return;
    setHighlightedLeads(
      leads.filter(l => Array.isArray(l.highlighted_by) && l.highlighted_by.includes(userId))
    );
  }, [userId, leads]);

  const handleHighlight = async (lead: LeadForPipeline) => {
    if (!userId || highlightedLeads.find(l => String(l.id) === String(lead.id))) return;
    // Add userId to highlighted_by array
    const highlightedBy = Array.isArray(lead.highlighted_by) ? [...lead.highlighted_by] : [];
    if (!highlightedBy.includes(userId)) {
      highlightedBy.push(userId);
      await supabase.from('leads').update({ highlighted_by: highlightedBy }).eq('id', lead.id);
      setHighlightedLeads(prev => [...prev, { ...lead, highlighted_by: highlightedBy }]);
      setHighlightPanelOpen(true);
    }
  };
  const handleRemoveHighlight = async (leadId: string) => {
    if (!userId) return;
    const lead = leads.find(l => String(l.id) === String(leadId));
    if (!lead) return;
    let highlightedBy = Array.isArray(lead.highlighted_by) ? [...lead.highlighted_by] : [];
    highlightedBy = highlightedBy.filter((id: string) => id !== userId);
    await supabase.from('leads').update({ highlighted_by: highlightedBy }).eq('id', leadId);
    setHighlightedLeads(prev => prev.filter(l => String(l.id) !== String(leadId)));
  };

  // For scrolling/animating to a main card
  const mainCardRefs = useRef<{ [id: number]: HTMLDivElement | null }>({});
  const contactButtonRefs = useRef<{ [id: string | number]: HTMLButtonElement | null }>({});
  const [dropdownPosition, setDropdownPosition] = useState<{ top: number; left: number } | null>(null);
  const handleHighlightCardClick = (leadId: number) => {
    const ref = mainCardRefs.current[leadId];
    if (ref) {
      ref.scrollIntoView({ behavior: 'smooth', block: 'center' });
      ref.classList.add('ring-4', 'ring-primary', 'animate-pulse');
      setTimeout(() => {
        ref.classList.remove('animate-pulse');
        setTimeout(() => ref.classList.remove('ring-4', 'ring-primary'), 600);
      }, 1200);
    }
    setHighlightPanelOpen(false);
  };

  // Fetch leads for assignment modal
  const fetchAssignmentLeads = async () => {
    setAssignmentLoading(true);
    try {
      const twoWeeksAgo = new Date();
      twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
      const twoWeeksAgoISO = twoWeeksAgo.toISOString();

      // Define allowed stage IDs based on pipeline mode (same as main pipeline)
      const allowedAssignmentStageIds = pipelineMode === 'closer'
        ? ['20', '21', '30', '40', '50', '55', '60', '70']
        : ['10', '15', '20', '21', '30', '40', '50'];
      
      // Fetch new leads for assignment
      let newLeadsQuery = supabase
        .from('leads')
        .select(`
          id,
          lead_number,
          name,
          created_at,
          expert,
          manager,
          scheduler,
          closer,
          topic,
          category,
          category_id,
          stage,
          number_of_applicants_meeting,
          potential_applicants_meeting,
          balance,
          balance_currency,
          probability,
          next_followup,
          email,
          phone,
          comments,
          label,
          unactivated_at,
          latest_interaction,
          language,
          meetings (
            meeting_date
          )
        `)
        .is('unactivated_at', null) // Only fetch leads where unactivated_at is NULL
        .in('stage', allowedAssignmentStageIds); // Only fetch specific stages (same as main pipeline)
      
      // For scheduler pipeline, also filter by eligible (same as main pipeline)
      // For closer pipeline, no eligible filter (same as main pipeline)
      if (pipelineMode !== 'closer') {
        newLeadsQuery = newLeadsQuery.eq('eligible', true);
      }

      // Assignment-specific filters: Show all leads that are unassigned OR have lost interactions
      // We'll filter out current user's leads in-memory after fetching
      newLeadsQuery = newLeadsQuery.or(`closer.is.null,closer.eq."",scheduler.is.null,scheduler.eq."",latest_interaction.is.null,latest_interaction.lt.${twoWeeksAgoISO}`);
      
      const { data: newLeadsDataRaw, error: newLeadsError } = await newLeadsQuery.order('created_at', { ascending: false });

      if (newLeadsError) {
        console.error('Error fetching new leads for assignment:', newLeadsError);
        throw newLeadsError;
      }
      
      // Filter out leads already assigned to the current user
      const newLeadsData = (newLeadsDataRaw || []).filter(lead => {
        if (pipelineMode === 'closer') {
          // Exclude if already assigned to current user as closer
          if (lead.closer === currentUserFullName) {
            return false; // Exclude this lead
          }
        } else {
          // Exclude if already assigned to current user as scheduler
          if (lead.scheduler === currentUserFullName) {
            return false; // Exclude this lead
          }
        }
        return true; // Include this lead
      });
      
      console.log('🔍 Assignment Debug - New leads after filtering:', {
        beforeFilter: newLeadsDataRaw?.length || 0,
        afterFilter: newLeadsData.length,
        currentUser: currentUserFullName,
        pipelineMode
      });

      // Define allowed stage IDs for legacy assignment based on pipeline mode (same as main pipeline)
      const allowedLegacyAssignmentStageIds = pipelineMode === 'closer'
        ? [20, 21, 30, 40, 50, 55, 60, 70]
        : [10, 15, 20, 21, 30, 40, 50];
      
      // Fetch legacy leads for assignment
      // Use smaller limit and simpler query to avoid timeout
      let legacyLeadsQuery = supabase
        .from('leads_lead')
            .select(`
              id,
              name,
              cdate,
              stage,
              closer_id,
              meeting_scheduler_id,
              total,
              currency_id,
              probability,
              phone,
              email,
              next_followup,
              no_of_applicants,
              potential_applicants,
              comments,
              label,
              status,
              latest_interaction,
              category_id,
              topic,
              eligibile,
              language_id
            `)
        .limit(200) // Reduced limit for assignment to improve performance
        .eq('status', 0); // Only fetch leads where status is 0
      
      // Apply stage filter
      legacyLeadsQuery = legacyLeadsQuery.in('stage', allowedLegacyAssignmentStageIds); // Only fetch specific stages (same as main pipeline)
      
      // For assignment leads, don't filter by eligible - show all assignable leads
      // (The eligible filter is only for the main pipeline view, not for assignment)
      
      console.log('🔍 Assignment Debug - Building legacy query:', {
        pipelineMode,
        stages: allowedLegacyAssignmentStageIds,
        hasEligibleFilter: false, // No eligible filter for assignment
        queryChain: 'status=0, stage IN (...), no eligible filter'
      });

      // Apply assignment filters with timeout protection
      // Don't filter by current user - show all assignable leads
      // Remove all OR conditions from database query to avoid timeout, filter in-memory instead
      const legacyLeadsPromise = (async () => {
        console.log('🔍 Assignment Debug - Legacy query filters:', {
          pipelineMode,
          allowedStages: allowedLegacyAssignmentStageIds,
          eligibleFilter: 'none (showing all assignable leads)'
        });
        
        // Just fetch with basic filters (no OR conditions) to avoid timeout
        const { data, error } = await legacyLeadsQuery.order('cdate', { ascending: false });
        
        if (error) {
          console.error('🔍 Assignment Debug - Legacy query error:', error);
          throw error;
        }
        
        console.log('🔍 Assignment Debug - Legacy leads fetched from DB:', {
          count: data?.length || 0,
          sampleData: data?.slice(0, 3).map(l => ({
            id: l.id,
            name: l.name,
            stage: l.stage,
            eligibile: l.eligibile,
            closer_id: l.closer_id,
            meeting_scheduler_id: l.meeting_scheduler_id,
            latest_interaction: l.latest_interaction
          }))
        });
        
        if (!data || data.length === 0) {
          console.log('🔍 Assignment Debug - No legacy leads returned from query');
          return [];
        }
        
        // Filter in-memory: unassigned OR lost interactions
        // Exclude leads already assigned to the current user
        const twoWeeksAgoMs = twoWeeksAgo.getTime();
        const filtered = data.filter(lead => {
          // Exclude if assigned to current user
          if (pipelineMode === 'closer') {
            if (lead.closer_id === currentUserEmployeeId || lead.closer_id === Number(currentUserEmployeeId)) {
              return false; // Exclude - already assigned to current user as closer
            }
          } else {
            if (lead.meeting_scheduler_id === currentUserEmployeeId || lead.meeting_scheduler_id === Number(currentUserEmployeeId)) {
              return false; // Exclude - already assigned to current user as scheduler
            }
          }
          
          // Include if unassigned (no closer or scheduler)
          const isUnassigned = !lead.closer_id && !lead.meeting_scheduler_id;
          if (isUnassigned) return true;
          
          // Include if no interaction or interaction is older than 2 weeks
          if (!lead.latest_interaction) return true;
          const interactionDate = new Date(lead.latest_interaction).getTime();
          return interactionDate < twoWeeksAgoMs;
        });
        
        console.log('🔍 Assignment Debug - Legacy leads after in-memory filtering:', {
          beforeFilter: data.length,
          afterFilter: filtered.length,
          currentUserEmployeeId,
          pipelineMode,
          sampleFiltered: filtered.slice(0, 3).map(l => ({
            id: l.id,
            name: l.name,
            isUnassigned: !l.closer_id && !l.meeting_scheduler_id,
            closer_id: l.closer_id,
            meeting_scheduler_id: l.meeting_scheduler_id,
            hasOldInteraction: l.latest_interaction ? new Date(l.latest_interaction).getTime() < twoWeeksAgoMs : true
          }))
        });
        
        return filtered;
      })();

      // Add timeout wrapper - fail gracefully after 5 seconds
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Query timeout')), 5000);
      });

      let legacyLeadsData;
      try {
        legacyLeadsData = await Promise.race([legacyLeadsPromise, timeoutPromise]) as any[];
      } catch (legacyLeadsError: any) {
        if (legacyLeadsError.message === 'Query timeout') {
          console.warn('⚠️ Legacy leads assignment query timed out, returning empty results');
          legacyLeadsData = [];
        } else {
          console.error('Error fetching legacy leads for assignment:', legacyLeadsError);
          legacyLeadsData = []; // Return empty array instead of throwing to allow new leads to display
        }
      }

      // Fetch currency data for legacy leads
      const currencyIds = legacyLeadsData?.map(lead => lead.currency_id).filter(id => id !== null) || [];
      let currencyMap: Record<number, string> = {};
      
      if (currencyIds.length > 0) {
        const { data: currencyData, error: currencyError } = await supabase
          .from('accounting_currencies')
          .select('id, iso_code')
          .in('id', currencyIds);
        
        if (!currencyError && currencyData) {
          currencyMap = currencyData.reduce((acc, curr) => {
            acc[curr.id] = curr.iso_code;
            return acc;
          }, {} as Record<number, string>);
        }
      }

      // Note: Category handling is now done via getCategoryName function using allCategories state

      // Process new leads with proper category handling
      const processedNewLeads = (newLeadsData || []).map((lead: any) => ({
        ...lead,
        category: getCategoryName(lead.category_id, lead.category), // Use proper category handling
        meetings: lead.meetings || [],
        lead_type: 'new' as const,
        // New leads use language text column directly
        language: lead.language || null,
        language_id: null // New leads don't use language_id
      }));


      // Process legacy leads
      const processedLegacyLeads = (legacyLeadsData || []).map(lead => {
        const currencyCode = currencyMap[lead.currency_id] || null;
        
        return {
          id: `legacy_${lead.id}`,
          lead_number: lead.id?.toString() || '',
          name: lead.name || '',
          created_at: lead.cdate || new Date().toISOString(),
          expert: lead.closer_id,
          topic: lead.topic,
          category: getCategoryName(lead.category_id), // Use proper category handling
          handler_notes: [],
          expert_notes: [],
          meetings: [],
          onedrive_folder_link: null,
          stage: lead.stage?.toString() || '',
          number_of_applicants_meeting: lead.no_of_applicants,
          potential_applicants_meeting: lead.potential_applicants,
          balance: lead.total,
          balance_currency: currencyCode,
          probability: typeof lead.probability === 'string' ? parseFloat(lead.probability) : lead.probability,
          eligibility_status: null,
          next_followup: lead.next_followup,
          manual_interactions: [],
          email: lead.email,
          mobile: null,
          phone: lead.phone,
          comments: lead.comments || [],
          label: lead.label || null,
          highlighted_by: [],
          latest_interaction: lead.latest_interaction,
          lead_type: 'legacy' as const,
          meeting_manager_id: lead.meeting_scheduler_id,
          meeting_lawyer_id: null,
          category_id: lead.category_id, // Preserve the original category_id
          total: lead.total,
          meeting_total_currency_id: null,
          expert_id: lead.closer_id,
          language_id: lead.language_id || null,
          language: null // Legacy leads use language_id, not language text
        };
      });

      

      // Combine and sort all leads
      const allAssignmentLeads = [...processedNewLeads, ...processedLegacyLeads].sort((a, b) => 
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      setAssignmentLeads(allAssignmentLeads as LeadForPipeline[]);
    } catch (error) {
      console.error('Error fetching assignment leads:', error);
      setAssignmentLeads([]);
    }
    setAssignmentLoading(false);
  };

  // Sort assignment leads
  const sortedAssignmentLeads = useMemo(() => {
    let leadsToSort = [...assignmentLeads];
    
    // Apply search filter
    if (assignmentSearchQuery) {
      leadsToSort = leadsToSort.filter(lead => {
        const leadNameLower = lead.name.toLowerCase();
        const leadNumberLower = lead.lead_number.toLowerCase();
        const searchLower = assignmentSearchQuery.toLowerCase();
        return leadNameLower.includes(searchLower) || leadNumberLower.includes(searchLower);
      });
    }
    
    // Apply stage filter
    if (assignmentStageFilter) {
      leadsToSort = leadsToSort.filter(lead => {
        if (!lead.stage) return false;
        const leadStageName = getStageName(lead.stage);
        return leadStageName === assignmentStageFilter;
      });
    }
    
    // Apply status filters
    if (showUnassignedOnly) {
      leadsToSort = leadsToSort.filter(lead => isUnassignedLead(lead));
    }
    
    if (showLostInteractionsOnly) {
      leadsToSort = leadsToSort.filter(lead => hasLostInteractions(lead));
    }
    
    // Apply sorting
    if (assignmentSortColumn) {
      leadsToSort.sort((a, b) => {
        let aValue, bValue;
        if (assignmentSortColumn === 'created_at') {
          aValue = a.created_at;
          bValue = b.created_at;
        } else if (assignmentSortColumn === 'offer') {
          aValue = typeof a.balance === 'number' ? a.balance : (typeof a.balance === 'string' ? parseFloat(a.balance) || 0 : 0);
          bValue = typeof b.balance === 'number' ? b.balance : (typeof b.balance === 'string' ? parseFloat(b.balance) || 0 : 0);
        } else if (assignmentSortColumn === 'probability') {
          aValue = a.probability || 0;
          bValue = b.probability || 0;
        }
        
        if (!aValue && !bValue) return 0;
        if (!aValue) return assignmentSortDirection === 'asc' ? -1 : 1;
        if (!bValue) return assignmentSortDirection === 'asc' ? 1 : -1;
        if (aValue < bValue) return assignmentSortDirection === 'asc' ? -1 : 1;
        if (aValue > bValue) return assignmentSortDirection === 'asc' ? 1 : -1;
        return 0;
      });
    }
    
    return leadsToSort;
  }, [assignmentLeads, assignmentSearchQuery, assignmentStageFilter, assignmentSortColumn, assignmentSortDirection, showUnassignedOnly, showLostInteractionsOnly]);

  // Handle assignment sort
  const handleAssignmentSort = (column: 'created_at' | 'offer' | 'probability') => {
    if (assignmentSortColumn === column) {
      setAssignmentSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setAssignmentSortColumn(column);
      setAssignmentSortDirection('desc');
    }
  };

  // Assign current user to a lead
  const handleAssignToLead = async (lead: LeadForPipeline) => {
    setAssigningLead(lead.id.toString());
    try {
      if (lead.lead_type === 'legacy') {
        // For legacy leads, use the employee display_name directly (no need for additional query)
        const numericId = typeof lead.id === 'string' ? parseInt(lead.id.replace('legacy_', '')) : lead.id;
        
        if (pipelineMode === 'closer') {
          // Assign as closer using employee ID
          const { error } = await supabase
            .from('leads_lead')
            .update({ closer_id: currentUserEmployeeId })
            .eq('id', numericId);
          
          if (error) throw error;
        } else {
          // Assign as scheduler using employee ID
          const { error } = await supabase
            .from('leads_lead')
            .update({ meeting_scheduler_id: currentUserEmployeeId })
            .eq('id', numericId);
          
          if (error) throw error;
        }
      } else {
        // For new leads, assign directly using full name
        if (pipelineMode === 'closer') {
          // Assign as closer
          const { error } = await supabase
            .from('leads')
            .update({ closer: currentUserFullName })
            .eq('id', lead.id);
          
          if (error) throw error;
        } else {
          // Assign as scheduler
          const { error } = await supabase
            .from('leads')
            .update({ scheduler: currentUserFullName })
            .eq('id', lead.id);
          
          if (error) throw error;
        }
      }

      // Remove the assigned lead from the assignment list
      setAssignmentLeads(prev => prev.filter(l => l.id !== lead.id));
      
      // Refresh the main leads list
      await fetchLeads();
      
    } catch (error) {
      console.error('Error assigning lead:', error);
      // You might want to show a toast notification here
    } finally {
      setAssigningLead(null);
    }
  };

  return (
    <div className="p-4 md:p-6 lg:p-8">
      <div className="mb-6 flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-4">
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <ChartBarIcon className="w-8 h-8 text-primary" />
            {showSignedAgreements ? 'Signed Agreements' : 'Pipeline'}
          </h1>
          
          {/* Pipeline Mode Switch */}
          <div className="flex items-center gap-2 bg-base-200 rounded-lg p-1">
            <button
              className={`px-4 py-2 rounded-md font-medium transition-all ${
                pipelineMode === 'closer' 
                  ? 'bg-primary text-primary-content shadow-md' 
                  : 'text-base-content/70 hover:text-base-content'
              }`}
              onClick={() => setPipelineMode('closer')}
            >
              Closer
            </button>
            <button
              className={`px-4 py-2 rounded-md font-medium transition-all ${
                pipelineMode === 'scheduler' 
                  ? 'bg-primary text-primary-content shadow-md' 
                  : 'text-base-content/70 hover:text-base-content'
              }`}
              onClick={() => setPipelineMode('scheduler')}
            >
              Scheduler
            </button>
          </div>
        </div>
        
        {/* Current User Info */}
        {currentUserFullName && (
          <div className="text-sm text-base-content/70">
            Viewing {pipelineMode} pipeline for: <span className="font-semibold">{currentUserFullName}</span>
          </div>
        )}
        
        {/* Assignment Button */}
        <button
          onClick={() => {
            setAssignmentModalOpen(true);
            fetchAssignmentLeads();
          }}
          className="btn btn-primary btn-sm flex items-center gap-2"
        >
          <UserIcon className="w-4 h-4" />
          Assign Leads
        </button>
      </div>
      {/* Filters and Search */}
      <div className="mb-6 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        {/* Search Bar */}
        <div className="relative flex items-center h-full w-full max-w-md mb-2 md:mb-0">
          <MagnifyingGlassIcon className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-base-content/50" />
          <input
            type="text"
            placeholder="Search by name or lead..."
            className="input input-bordered w-full pl-10 max-w-xs"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
        {/* Filters row: right-aligned on md+ */}
        <div className="flex flex-col gap-2 md:flex-row md:gap-4 md:justify-end w-full md:w-auto">
          {/* Filter by Country */}
          <div className="flex flex-col items-start gap-1 min-w-[180px]">
            <label className="text-xs font-semibold text-base-content/70 mb-1">Country</label>
            <select
              className="select select-bordered w-full"
              value={filterCountry}
              onChange={e => setFilterCountry(e.target.value)}
            >
              <option value="">All</option>
              {availableCountries.map(country => (
                <option key={country} value={country}>{country}</option>
              ))}
            </select>
          </div>
          {/* Filter by Language */}
          <div className="flex flex-col items-start gap-1 min-w-[180px]">
            <label className="text-xs font-semibold text-base-content/70 mb-1">Language</label>
            <select
              className="select select-bordered w-full"
              value={filterLanguage}
              onChange={e => setFilterLanguage(e.target.value)}
            >
              <option value="">All</option>
              {availableLanguages.map(language => (
                <option key={language} value={language}>{language}</option>
              ))}
            </select>
          </div>
          {/* Filter by Label */}
          <div className="flex flex-col items-start gap-1 min-w-[180px]">
            <label className="text-xs font-semibold text-base-content/70 mb-1">Label</label>
            <select
              className="select select-bordered w-full"
              value={labelFilter}
              onChange={e => setLabelFilter(e.target.value)}
            >
              <option value="">All</option>
              {availableLabels.map(label => (
                <option key={label} value={label}>{label}</option>
              ))}
            </select>
          </div>
          {/* Filter by Created Date Range */}
          <div className="flex flex-col items-start gap-1 min-w-[180px]">
            <label className="text-xs font-semibold text-base-content/70 mb-1">Created Date</label>
            <div className="flex items-center gap-2 w-full">
              <input
                type="date"
                className="input input-bordered w-full max-w-[160px]"
                value={filterCreatedDateFrom}
                onChange={e => setFilterCreatedDateFrom(e.target.value)}
                placeholder="From"
              />
              <input
                type="date"
                className="input input-bordered w-full max-w-[160px]"
                value={filterCreatedDateTo}
                onChange={e => setFilterCreatedDateTo(e.target.value)}
                placeholder="To"
              />
            </div>
          </div>
          {/* Filter By Dropdown */}
          <div className="flex flex-col items-start gap-1 min-w-[180px]">
            <label className="text-xs font-semibold text-base-content/70 mb-1">Filter by</label>
            <select
              className="select select-bordered w-full"
              value={filterBy}
              onChange={e => setFilterBy(e.target.value)}
            >
              <option value="all">View all</option>
              <option value="followup_upcoming">Follow Up Date: Upcoming</option>
              <option value="followup_missed">Follow Up Date: Missed</option>
              <option value="commented">Commented</option>
              {stageOptions.map(stage => (
                <option key={stage} value={`stage:${stage}`}>Stage: {stage.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>
              ))}
              <option value="top10_offer">Top 10 Highest Offer</option>
              <option value="top10_probability">Top 10 Highest Probability</option>
            </select>
          </div>
        </div>
      </div>
      
      {/* Status Filter Buttons */}
      <div className="mb-6 flex flex-wrap gap-3">
        <button
          onClick={() => setShowUnassignedOnly(!showUnassignedOnly)}
          className={`btn btn-sm font-medium transition-all duration-200 ${
            showUnassignedOnly 
              ? 'bg-gradient-to-r from-red-500 to-red-600 text-white shadow-lg border border-red-400' 
              : 'btn-outline border-red-300 text-red-600 hover:bg-red-50'
          }`}
        >
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${showUnassignedOnly ? 'bg-white animate-pulse' : 'bg-red-500'}`}></div>
            No {pipelineMode === 'closer' ? 'Closer' : 'Scheduler'} Assigned
            {showUnassignedOnly && (
              <span className="badge badge-sm bg-white/20 text-white border-white/30">
                {filteredLeads.filter(lead => isUnassignedLead(lead)).length}
              </span>
            )}
          </div>
        </button>
        
        <button
          onClick={() => setShowLostInteractionsOnly(!showLostInteractionsOnly)}
          className={`btn btn-sm font-medium transition-all duration-200 ${
            showLostInteractionsOnly 
              ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg border border-amber-400' 
              : 'btn-outline border-amber-300 text-amber-600 hover:bg-amber-50'
          }`}
        >
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${showLostInteractionsOnly ? 'bg-white animate-pulse' : 'bg-amber-500'}`}></div>
            Lost Interactions
            {showLostInteractionsOnly && (
              <span className="badge badge-sm bg-white/20 text-white border-white/30">
                {filteredLeads.filter(lead => hasLostInteractions(lead)).length}
              </span>
            )}
          </div>
        </button>
        
        {/* Clear All Filters Button */}
        {(showUnassignedOnly || showLostInteractionsOnly || assignmentStageFilter) && (
          <button
            onClick={() => {
              setShowUnassignedOnly(false);
              setShowLostInteractionsOnly(false);
              setAssignmentStageFilter('');
            }}
            className="btn btn-sm btn-ghost text-gray-500 hover:text-gray-700"
          >
            Clear Filters
          </button>
        )}
      </div>
      
      {/* Summary Statistics Cards */}
      <div className="mb-8 grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Contracts Signed / Meetings Created */}
        <div 
          className="bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 rounded-2xl p-6 text-white shadow-xl hover:shadow-2xl transition-all duration-300 transform hover:scale-105 cursor-pointer"
          onClick={() => {
            setShowSignedAgreements(!showSignedAgreements);
          }}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white/90 text-sm font-medium">
                {pipelineMode === 'closer' ? 'Contracts Signed' : 'Meetings Created'}
              </p>
              <p className="text-3xl font-bold">{summaryStats.contractsSigned}</p>
              <p className="text-white/90 text-xs mt-1">
                {pipelineMode === 'closer' ? 'Last 30 days' : 'Last 30 days'}
              </p>
            </div>
            <div className="flex items-center gap-2 bg-white/20 rounded-full p-3">
              <FileText className="w-7 h-7 text-white/90" />
              <PencilLine className="w-6 h-6 text-white/80 -ml-2" />
            </div>
          </div>
        </div>

        {/* Top Worker */}
        <div className="bg-gradient-to-tr from-purple-600 via-blue-600 to-blue-500 rounded-2xl p-6 text-white shadow-xl hover:shadow-2xl transition-all duration-300 transform hover:scale-105">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white/90 text-sm font-medium">Top {pipelineMode === 'closer' ? 'Closer' : 'Scheduler'}</p>
              <p className="text-xl font-bold truncate">{summaryStats.topWorker}</p>
              <p className="text-white/90 text-xs mt-1">
                {pipelineMode === 'closer' 
                  ? `${summaryStats.topWorkerCount} contract${summaryStats.topWorkerCount === 1 ? '' : 's'} signed (last 30 days)`
                  : `${summaryStats.topWorkerCount} meeting${summaryStats.topWorkerCount === 1 ? '' : 's'} created (last 30 days)`
                }
              </p>
            </div>
            <div className="bg-white/20 rounded-full p-3">
              <UserIcon className="w-8 h-8" />
            </div>
          </div>
        </div>

        {/* Total Leads */}
        <div className="bg-gradient-to-tr from-teal-400 via-green-400 to-green-600 rounded-2xl p-6 text-white shadow-xl hover:shadow-2xl transition-all duration-300 transform hover:scale-105">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white/90 text-sm font-medium">Total Leads</p>
              <p className="text-3xl font-bold">{summaryStats.totalLeads}</p>
              <p className="text-white/90 text-xs mt-1">In pipeline</p>
            </div>
            <div className="bg-white/20 rounded-full p-3">
              <ChartBarIcon className="w-8 h-8" />
            </div>
          </div>
        </div>
      </div>

      {/* Leads Cards/List Grid Toggle */}
      <div className="flex justify-end mb-2">
        <button
          className="btn btn-outline btn-primary btn-sm flex items-center gap-2"
          onClick={() => setViewMode(viewMode === 'cards' ? 'list' : 'cards')}
          title={viewMode === 'cards' ? 'Switch to List View' : 'Switch to Card View'}
        >
          {viewMode === 'cards' ? (
            <Bars3Icon className="w-5 h-5" />
          ) : (
            <Squares2X2Icon className="w-5 h-5" />
          )}
          <span className="hidden md:inline">{viewMode === 'cards' ? 'List View' : 'Card View'}</span>
        </button>
      </div>
      {/* Leads Cards Grid or List */}
      {viewMode === 'cards' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-6">
          {isLoading ? (
            <div className="col-span-full text-center p-8">
              <div className="loading loading-spinner loading-lg"></div>
              <p className="mt-4 text-base-content/60">Loading leads...</p>
            </div>
          ) : sortedLeads.length > 0 ? (
            sortedLeads.map((lead) => (
              <div
                key={lead.id}
                ref={el => (mainCardRefs.current[Number(lead.id)] = el)}
                className="bg-white rounded-2xl p-5 shadow-md hover:shadow-xl transition-all duration-200 transform hover:-translate-y-1 border border-gray-100 group flex flex-col justify-between h-full min-h-[340px] relative pb-16"
              >
                <div onClick={() => handleRowClick(lead)} className="flex-1 cursor-pointer flex flex-col">
                  {/* Status Badges - Above Lead Number */}
                  <div className="mb-2 flex flex-wrap gap-1">
                    {/* No Scheduler/Closer Assigned Badge */}
                    {isUnassignedLead(lead) && (
                      <div className="bg-gradient-to-r from-red-500 to-red-600 text-white px-3 py-1 rounded-full text-xs font-bold shadow-lg border border-red-400 transform hover:scale-105 transition-all duration-200">
                        <div className="flex items-center gap-1">
                          <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
                          No {pipelineMode === 'closer' ? 'Closer' : 'Scheduler'}
                        </div>
                      </div>
                    )}
                    
                    {/* Lost Interactions Badge */}
                    {hasLostInteractions(lead) && (
                      <div className="bg-gradient-to-r from-amber-500 to-orange-500 text-white px-3 py-1 rounded-full text-xs font-bold shadow-lg border border-amber-400 transform hover:scale-105 transition-all duration-200">
                        <div className="flex items-center gap-1">
                          <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
                          Lost Interactions
                        </div>
                      </div>
                    )}
                  </div>
                  
                  {/* Lead Number and Name */}
                  <div className="mb-3 flex items-center gap-2 pr-20">
                    <span className="text-sm font-semibold text-gray-400 tracking-widest">{lead.lead_number}</span>
                    <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                    <h3 className="text-xl font-extrabold text-gray-900 group-hover:text-primary transition-colors truncate flex-1">{lead.name}</h3>
                    {lead.label && (
                      <span className="ml-2 px-2 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary border-2 border-primary">{lead.label}</span>
                    )}
                    {/* Label display */}
                    {lead.eligibility_status && lead.eligibility_status !== '' ? (
                      <AcademicCapIcon className="w-6 h-6 text-green-400 ml-4" title="Feasibility chosen" />
                    ) : (
                      <QuestionMarkCircleIcon className="w-6 h-6 text-yellow-400 ml-2" title="Feasibility not chosen" />
                    )}
                  </div>
                  {/* Stage */}
                  <div className="flex justify-between items-center py-1">
                    <span className="text-sm font-semibold text-gray-500">Stage</span>
                    <span className={
                      'text-xs font-bold ml-2 px-2 py-1 rounded bg-[#3b28c7] text-white'
                    }>
                      {lead.stage ? getStageName(lead.stage) : 'N/A'}
                    </span>
                  </div>
                  <div className="space-y-2 divide-y divide-gray-100">
                    {/* Category */}
                    <div className="flex justify-between items-center py-1">
                      <span className="text-sm font-semibold text-gray-500">Category</span>
                      <span className="text-sm font-bold text-gray-800 ml-2">{lead.category || 'N/A'}</span>
                    </div>
                    {/* Offer (Balance) */}
                    <div className="flex justify-between items-center py-1">
                      <span className="text-sm font-semibold text-gray-500">Offer</span>
                      <span className="text-sm font-bold text-gray-800 ml-2">
                        {lead.balance !== undefined && lead.balance !== null 
                          ? (() => {
                              // Removed excessive logging for performance
                              return `${getCurrencySymbol(lead.balance_currency)}${lead.balance}`;
                            })()
                          : 'N/A'}
                      </span>
                    </div>
                    {/* Probability */}
                    <div className="flex justify-between items-center py-1">
                      <span className="text-sm font-semibold text-gray-500">Probability</span>
                      <span className={`text-sm font-bold ml-2 ${
                        (lead.probability || 0) >= 80 ? 'text-green-600' :
                        (lead.probability || 0) >= 60 ? 'text-yellow-600' :
                        (lead.probability || 0) >= 40 ? 'text-orange-600' :
                        'text-red-600'
                      }`}>
                        {lead.probability !== undefined && lead.probability !== null ? `${lead.probability}%` : 'N/A'}
                      </span>
                    </div>
                    {/* Total Applicants */}
                    <div className="flex justify-between items-center py-1">
                      <span className="text-sm font-semibold text-gray-500">Total Applicants</span>
                      <span className="text-sm font-bold text-gray-800 ml-2">
                        {lead.number_of_applicants_meeting ?? 'N/A'}
                      </span>
                    </div>
                    {/* Potential Applicants */}
                    <div className="flex justify-between items-center py-1">
                      <span className="text-sm font-semibold text-gray-500">Potential Applicants</span>
                      <span className="text-sm font-bold text-gray-800 ml-2">
                        {lead.potential_applicants_meeting ?? 'N/A'}
                      </span>
                    </div>
                    {/* Follow Up Date */}
                    <div className="flex justify-between items-center py-1">
                      <span className="text-sm font-semibold text-gray-500">Follow Up Date</span>
                      {lead.next_followup ? (() => {
                        const followupDate = parseISO(lead.next_followup);
                        const today = new Date();
                        today.setHours(0,0,0,0);
                        const isPast = followupDate < today;
                        const badgeClass = isPast ? 'bg-purple-600 text-white' : 'bg-green-500 text-white';
                        return (
                          <span className={`text-xs font-bold ml-2 px-2 py-1 rounded ${badgeClass}`}>
                            {format(followupDate, 'dd/MM/yyyy')}
                          </span>
                        );
                      })() : (
                        <span className="text-sm font-bold text-gray-800 ml-2">N/A</span>
                      )}
                    </div>
                    {/* Country */}
                    <div className="flex justify-between items-center py-1">
                      <span className="text-sm font-semibold text-gray-500">Country</span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-bold text-gray-800 ml-2">{getCountryName(lead.country_id || lead.country)}</span>
                        {(lead.country_id || lead.country) && (() => {
                          const timezone = getCountryTimezone(lead.country_id || lead.country);
                          const businessInfo = getBusinessHoursInfo(timezone);
                          return timezone ? (
                            <div 
                              className={`w-3 h-3 rounded-full ${businessInfo.isBusinessHours ? 'bg-green-500' : 'bg-red-500'}`} 
                              title={`${businessInfo.localTime ? `Local time: ${businessInfo.localTime}` : 'Time unavailable'} - ${businessInfo.isBusinessHours ? 'Business hours' : 'Outside business hours'} (${timezone})`} 
                            />
                          ) : null;
                        })()}
                      </div>
                    </div>
                    {/* Language */}
                    <div className="flex justify-between items-center py-1">
                      <span className="text-sm font-semibold text-gray-500">Language</span>
                      <span className="text-sm font-bold text-gray-800 ml-2">{getLanguageName(lead.language_id, lead.language)}</span>
                    </div>
                  </div>

                  {/* Meeting Date (if available) */}
                  {lead.meetings && lead.meetings.length > 0 && (
                    <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
                      <CalendarIcon className="w-4 h-4" />
                      <span>Meeting: {lead.meetings[0].meeting_date}</span>
                    </div>
                  )}
                </div>
                {/* Action Buttons */}
                <div className="mt-4 flex gap-2 items-center justify-end flex-wrap" onClick={e => e.stopPropagation()}>
                  {/* Contact Dropdown */}
                  <div className="relative contact-dropdown">
                    <button
                      ref={el => { contactButtonRefs.current[lead.id] = el; }}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleContactDropdown(lead.id);
                      }}
                      className="btn btn-outline btn-sm btn-primary rounded-full hover:scale-105 transition-transform"
                      title="Contact"
                    >
                      <ChatBubbleLeftRightIcon className="w-5 h-5" />
                    </button>
                  </div>
                  
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleTimeline(lead);
                    }}
                    className="btn btn-outline btn-sm btn-primary rounded-full hover:scale-105 transition-transform"
                    title="Timeline"
                  >
                    <ClockIcon className="w-5 h-5" />
                  </button>
                  
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleEditLead(lead);
                    }}
                    className="btn btn-outline btn-sm btn-primary rounded-full hover:scale-105 transition-transform"
                    title="Edit Lead"
                  >
                    <PencilSquareIcon className="w-5 h-5" />
                  </button>
                  
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleViewClient(lead);
                    }}
                    className="btn btn-outline btn-sm btn-primary rounded-full hover:scale-105 transition-transform"
                    title="View Client"
                  >
                    <EyeIcon className="w-5 h-5" />
                  </button>
                  
                  <button
                    className="btn btn-outline btn-sm btn-info flex items-center justify-center rounded-full hover:scale-105 transition-transform group"
                    title={highlightedLeads.find(l => l.id === lead.id) ? 'Highlighted' : 'Highlight'}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleHighlight(lead);
                    }}
                    disabled={!!highlightedLeads.find(l => l.id === lead.id)}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 text-blue-500 group-hover:text-white transition-colors"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2m0 14v2m9-9h-2M5 12H3m15.364-6.364l-1.414 1.414M6.05 17.95l-1.414 1.414m12.728 0l-1.414-1.414M6.05 6.05L4.636 4.636" /></svg>
                  </button>
                </div>
                {/* Most recent comment at the bottom left */}
                {lead.comments && lead.comments.length > 0 ? (
                  <div className="absolute left-5 bottom-5 max-w-[85%] flex items-end">
                    <div className="flex items-start gap-2">
                      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary flex items-center justify-center shadow text-white text-sm font-bold">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4-4.03 7-9 7a9.77 9.77 0 01-4-.8l-4.28 1.07a1 1 0 01-1.21-1.21l1.07-4.28A7.94 7.94 0 013 12c0-4 4.03-7 9-7s9 3 9 7z"/></svg>
                      </div>
                      <div className="relative bg-white border border-base-200 rounded-2xl px-4 py-2 shadow-md text-sm text-base-content/90" style={{minWidth: '120px'}}>
                        <div className="font-medium leading-snug max-w-xs truncate" title={lead.comments[lead.comments.length - 1].text}>{lead.comments[lead.comments.length - 1].text}</div>
                        <div className="text-[11px] text-base-content/50 text-right mt-1">
                          {lead.comments[lead.comments.length - 1].user} · {format(new Date(lead.comments[lead.comments.length - 1].timestamp), 'dd/MM/yyyy HH:mm')}
                        </div>
                        {/* Chat bubble pointer */}
                        <div className="absolute left-[-10px] bottom-2 w-0 h-0 border-t-8 border-t-transparent border-b-8 border-b-transparent border-r-8 border-r-white border-l-0"></div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="" style={{ minHeight: 0, paddingBottom: 0 }} />
                )}
              </div>
            ))
          ) : (
            <div className="col-span-full text-center p-8">
              <div className="text-base-content/60">
                <ChartBarIcon className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <p className="text-lg font-medium">No leads found</p>
                <p className="text-sm">Try adjusting your search or filters</p>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto w-full mt-6 bg-base-100 rounded-2xl shadow-lg border border-base-200 p-0" style={{ overflowY: 'visible' }}>
          <table className="table-auto divide-y divide-base-200 text-base w-full" style={{ position: 'relative' }}>
            <thead className="sticky top-0 z-10 bg-base-200 font-semibold text-base-content shadow-sm">
              <tr>
                <th className="py-3 px-2 text-left rounded-l-xl">Lead</th>
                <th className="cursor-pointer select-none py-3 px-2 text-center" onClick={() => handleSort('stage')}>
                  Stage {sortColumn === 'stage' && <span className="ml-1">{sortDirection === 'asc' ? '▲' : '▼'}</span>}
                </th>
                <th className="py-3 px-2 text-center">Category</th>
                <th className="cursor-pointer select-none py-3 px-2 text-center" onClick={() => handleSort('offer')}>
                  Offer {sortColumn === 'offer' && <span className="ml-1">{sortDirection === 'asc' ? '▲' : '▼'}</span>}
                </th>
                <th className="cursor-pointer select-none py-3 px-2 text-center" onClick={() => handleSort('probability')}>
                  Probability {sortColumn === 'probability' && <span className="ml-1">{sortDirection === 'asc' ? '▲' : '▼'}</span>}
                </th>
                <th className="py-3 px-2 text-center">Label</th>
                <th className="cursor-pointer select-none py-3 px-2 text-center" onClick={() => handleSort('total_applicants')}>
                  Total Applicants {sortColumn === 'total_applicants' && <span className="ml-1">{sortDirection === 'asc' ? '▲' : '▼'}</span>}
                </th>
                <th className="cursor-pointer select-none py-3 px-2 text-center" onClick={() => handleSort('potential_applicants')}>
                  Potential Applicants {sortColumn === 'potential_applicants' && <span className="ml-1">{sortDirection === 'asc' ? '▲' : '▼'}</span>}
                </th>
                <th className="cursor-pointer select-none py-3 px-2 text-center" onClick={() => handleSort('follow_up')}>
                  Follow Up {sortColumn === 'follow_up' && <span className="ml-1">{sortDirection === 'asc' ? '▲' : '▼'}</span>}
                </th>
                <th className="py-3 px-2 text-center">Country</th>
                <th className="py-3 px-2 text-center">Language</th>
                <th className="py-3 px-2 text-center rounded-r-xl">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedLeads.length === 0 ? (
                <tr><td colSpan={12} className="text-center py-8 text-base-content/60">No leads found</td></tr>
              ) : (
                sortedLeads.map((lead, idx) => (
                  <tr
                    key={lead.id}
                    className="transition group bg-base-100 hover:bg-primary/5 border-b-2 border-base-300 relative"
                    onClick={() => handleRowClick(lead)}
                    style={{ overflow: 'visible' }}
                  >
                    {/* Lead column: lead number + name (left-aligned) */}
                    <td className="px-2 py-3 md:py-4 rounded-l-xl truncate max-w-[180px] text-left">
                      <div className="flex flex-col">
                        <span className="font-mono font-bold text-xs text-gray-500 truncate">{lead.lead_number}</span>
                        <span className="font-semibold text-base-content truncate">{lead.name}</span>
                      </div>
                    </td>
                    {/* Stage */}
                    <td className="px-2 py-3 md:py-4 text-center truncate">
                      <span className="text-xs sm:text-sm text-gray-700">
                        {lead.stage ? getStageName(lead.stage) : 'N/A'}
                      </span>
                    </td>
                    {/* Category */}
                    <td className="px-2 py-3 md:py-4 text-center truncate">
                      <span className="text-xs sm:text-sm text-gray-700">
                        {lead.category ? lead.category : (lead.category_id ? getCategoryName(lead.category_id) : 'N/A')}
                      </span>
                    </td>
                    {/* Offer */}
                    <td className="px-2 py-3 md:py-4 text-center truncate">
                      {lead.balance !== undefined && lead.balance !== null ? `${getCurrencySymbol(lead.balance_currency)}${lead.balance}` : 'N/A'}
                    </td>
                    {/* Probability */}
                    <td className="px-2 py-3 md:py-4 text-center truncate">
                      <span className={`font-bold ${(lead.probability ?? 0) >= 80 ? 'text-green-600' : (lead.probability ?? 0) >= 60 ? 'text-yellow-600' : (lead.probability ?? 0) >= 40 ? 'text-orange-600' : 'text-red-600'}`}>{lead.probability !== undefined && lead.probability !== null ? `${lead.probability}%` : 'N/A'}</span>
                    </td>
                    {/* Label */}
                    <td className="px-2 py-3 md:py-4 text-center truncate">
                      {lead.label ? <span className="badge badge-outline badge-primary font-semibold">{lead.label}</span> : ''}
                    </td>
                    {/* Total Applicants */}
                    <td className="px-2 py-3 md:py-4 text-center truncate">{lead.number_of_applicants_meeting ?? 'N/A'}</td>
                    {/* Potential Applicants */}
                    <td className="px-2 py-3 md:py-4 text-center truncate">{lead.potential_applicants_meeting ?? 'N/A'}</td>
                    {/* Follow Up */}
                    <td className="px-2 py-3 md:py-4 text-center truncate">
                      {lead.next_followup ? format(parseISO(lead.next_followup), 'dd/MM/yyyy') : 'N/A'}
                    </td>
                    {/* Country */}
                    <td className="px-2 py-3 md:py-4 text-center truncate">
                      <div className="flex items-center justify-center gap-1">
                        <span className="text-xs sm:text-sm text-gray-700">{getCountryName(lead.country_id || lead.country)}</span>
                        {(lead.country_id || lead.country) && (() => {
                          const timezone = getCountryTimezone(lead.country_id || lead.country);
                          const businessInfo = getBusinessHoursInfo(timezone);
                          return timezone ? (
                            <div 
                              className={`w-3 h-3 rounded-full ${businessInfo.isBusinessHours ? 'bg-green-500' : 'bg-red-500'}`} 
                              title={`${businessInfo.localTime ? `Local time: ${businessInfo.localTime}` : 'Time unavailable'} - ${businessInfo.isBusinessHours ? 'Business hours' : 'Outside business hours'} (${timezone})`} 
                            />
                          ) : null;
                        })()}
                      </div>
                    </td>
                    {/* Language */}
                    <td className="px-2 py-3 md:py-4 text-center truncate">
                      <span className="text-xs sm:text-sm text-gray-700">
                        {(() => {
                          const langName = getLanguageName(lead.language_id, lead.language);
                          // Debug for L34
                          if (lead.lead_number === 'L34') {
                            console.log('🔍 Display Language for L34:', {
                              lead_number: lead.lead_number,
                              language_id: lead.language_id,
                              language: lead.language,
                              languageType: typeof lead.language,
                              result: langName
                            });
                          }
                          return langName;
                        })()}
                      </span>
                    </td>
                    {/* Actions */}
                    <td className="px-2 py-3 md:py-4 flex gap-1 items-center justify-center rounded-r-xl relative" onClick={e => e.stopPropagation()}>
                      {/* Contact Dropdown */}
                      <div className="relative contact-dropdown">
                        <button
                          ref={el => { contactButtonRefs.current[lead.id] = el; }}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleContactDropdown(lead.id);
                          }}
                          className="btn btn-outline btn-sm btn-primary rounded-full hover:scale-105 transition-transform"
                          title="Contact"
                        >
                          <ChatBubbleLeftRightIcon className="w-5 h-5" />
                        </button>
                      </div>
                      
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleTimeline(lead);
                        }}
                        className="btn btn-outline btn-sm btn-primary rounded-full hover:scale-105 transition-transform"
                        title="Timeline"
                      >
                        <ClockIcon className="w-5 h-5" />
                      </button>
                      
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEditLead(lead);
                        }}
                        className="btn btn-outline btn-sm btn-primary rounded-full hover:scale-105 transition-transform"
                        title="Edit Lead"
                      >
                        <PencilSquareIcon className="w-5 h-5" />
                      </button>
                      
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleViewClient(lead);
                        }}
                        className="btn btn-outline btn-sm btn-primary rounded-full hover:scale-105 transition-transform"
                        title="View Client"
                      >
                        <EyeIcon className="w-5 h-5" />
                      </button>
                      
                      <button
                        className="btn btn-outline btn-sm btn-info flex items-center justify-center rounded-full hover:scale-105 transition-transform group"
                        title={highlightedLeads.find(l => l.id === lead.id) ? 'Highlighted' : 'Highlight'}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleHighlight(lead);
                        }}
                        disabled={!!highlightedLeads.find(l => l.id === lead.id)}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 text-blue-500 group-hover:text-white transition-colors"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2m0 14v2m9-9h-2M5 12H3m15.364-6.364l-1.414 1.414M6.05 17.95l-1.414 1.414m12.728 0l-1.414-1.414M6.05 6.05L4.636 4.636" /></svg>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
      
      {/* Contact Dropdown Portal - renders outside table to avoid overflow issues */}
      {openContactDropdown && dropdownPosition && (
        <div 
          className="fixed bg-white border border-gray-200 rounded-lg shadow-xl min-w-[140px] py-2 overflow-hidden z-[9999]"
          style={{ 
            top: `${dropdownPosition.top}px`,
            left: `${dropdownPosition.left}px`
          }}
          onClick={e => e.stopPropagation()}
          onMouseDown={e => e.stopPropagation()}
          id="contact-dropdown-menu"
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              console.log('📞 Call button clicked, leadId:', openContactDropdown);
              const leadId = openContactDropdown;
              const lead = filteredLeads.find(l => String(l.id) === String(leadId));
              console.log('📞 Found lead:', lead);
              if (lead) {
                handleCall(lead);
              } else {
                console.error('❌ Lead not found for ID:', leadId);
                toast.error('Lead not found');
              }
              setOpenContactDropdown(null);
              setDropdownPosition(null);
            }}
            className="w-full px-4 py-2.5 text-left hover:bg-blue-50 text-sm font-medium flex items-center gap-3 transition-colors duration-150"
            title="Call"
          >
            <PhoneIcon className="w-5 h-5 text-blue-600" />
            <span>Call</span>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              console.log('📧 Email button clicked, leadId:', openContactDropdown);
              const leadId = openContactDropdown;
              const lead = filteredLeads.find(l => String(l.id) === String(leadId));
              console.log('📧 Found lead:', lead);
              if (lead) {
                handleEmail(lead);
              } else {
                console.error('❌ Lead not found for ID:', leadId);
                toast.error('Lead not found');
              }
              setOpenContactDropdown(null);
              setDropdownPosition(null);
            }}
            className="w-full px-4 py-2.5 text-left hover:bg-gray-50 text-sm font-medium flex items-center gap-3 transition-colors duration-150"
            title="Email"
          >
            <EnvelopeIcon className="w-5 h-5 text-gray-600" />
            <span>Email</span>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              console.log('💬 WhatsApp button clicked, leadId:', openContactDropdown);
              const leadId = openContactDropdown;
              const lead = filteredLeads.find(l => String(l.id) === String(leadId));
              console.log('💬 Found lead:', lead);
              if (lead) {
                handleWhatsApp(lead);
              } else {
                console.error('❌ Lead not found for ID:', leadId);
                toast.error('Lead not found');
              }
              setOpenContactDropdown(null);
              setDropdownPosition(null);
            }}
            className="w-full px-4 py-2.5 text-left hover:bg-green-50 text-sm font-medium flex items-center gap-3 transition-colors duration-150"
            title="WhatsApp"
          >
            <FaWhatsapp className="w-5 h-5 text-green-600" />
            <span>WhatsApp</span>
          </button>
        </div>
      )}
      
      {/* WhatsApp Modal (from contact dropdown) */}
      {isContactWhatsAppModalOpen && selectedLead && (
        <SchedulerWhatsAppModal
          isOpen={isContactWhatsAppModalOpen}
          onClose={() => setIsContactWhatsAppModalOpen(false)}
          client={{
            id: String(selectedLead.id),
            name: selectedLead.name,
            lead_number: selectedLead.lead_number,
            phone: selectedLead.phone || undefined,
            mobile: selectedLead.mobile || undefined,
            lead_type: selectedLead.lead_type || 'new'
          }}
          onClientUpdate={async () => {
            await fetchLeads();
          }}
        />
      )}
      
      {/* Email Modal (from contact dropdown) */}
      {isContactEmailModalOpen && selectedLead && (
        <SchedulerEmailThreadModal
          isOpen={isContactEmailModalOpen}
          onClose={() => setIsContactEmailModalOpen(false)}
          client={{
            id: String(selectedLead.id),
            name: selectedLead.name,
            lead_number: selectedLead.lead_number,
            email: selectedLead.email || undefined,
            lead_type: selectedLead.lead_type || 'new',
            topic: selectedLead.topic || undefined
          }}
          onClientUpdate={async () => {
            await fetchLeads();
          }}
        />
      )}
      
      {/* Drawer for lead summary */}
      {drawerOpen && selectedLead && !isDocumentModalOpen && (
        <div className="fixed inset-0 z-50 flex">
          {/* Overlay */}
          <div className="fixed inset-0 bg-black/30 transition-opacity duration-300" onClick={closeDrawer} />
          {/* Lead Summary Drawer */}
          <div className={`ml-auto w-full max-w-xl bg-white h-full shadow-2xl flex flex-col animate-slideInRight z-50 rounded-l-2xl relative`} style={{ boxShadow: '0 0 40px 0 rgba(0,0,0,0.2)' }}>
            {/* Header */}
            <div className="bg-white border-b border-gray-200 p-6 rounded-tl-2xl">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">Lead Details</h2>
                  <p className="text-gray-500 text-sm mt-1">{selectedLead.lead_number}</p>
                </div>
                <button
                  onClick={closeDrawer}
                  className="btn btn-ghost btn-sm btn-circle hover:bg-gray-100 text-gray-700"
                  aria-label="Close drawer"
                >
                  <XMarkIcon className="w-5 h-5" />
                </button>
              </div>
              {/* Label */}
              {selectedLead.label && (
                <span className="px-3 py-1 rounded-full text-xs font-semibold bg-purple-100 text-purple-700 border border-purple-200">
                  {selectedLead.label}
                </span>
              )}
            </div>
            
            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Client Name */}
              <div className="flex items-center gap-3 pb-4 border-b border-gray-200">
                <div className="p-2 bg-purple-100 rounded-lg">
                  <UserIcon className="w-6 h-6 text-purple-600" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-xl text-gray-900">{selectedLead.name}</h3>
                    <span className="text-xs font-bold px-2 py-1 rounded bg-[#3b28c7] text-white">
                      {selectedLead.stage ? getStageName(selectedLead.stage) : 'N/A'}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500">{selectedLead.lead_number}</p>
                </div>
              </div>
              
              {/* Key Info Grid */}
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4">
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Expert</div>
                  <div className="text-sm font-bold text-gray-900">{selectedLead.expert || 'Not assigned'}</div>
                </div>
                <div className="p-4">
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Category</div>
                  <div className="text-sm font-bold text-gray-900">{selectedLead.category || 'N/A'}</div>
                </div>
                <div className="p-4">
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Handler</div>
                  <div className="text-sm font-bold text-gray-900">{selectedLead.manager || 'Not assigned'}</div>
                </div>
                <div className="p-4">
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Scheduler</div>
                  <div className="text-sm font-bold text-gray-900">{selectedLead.scheduler || 'Not assigned'}</div>
                </div>
                <div className="p-4">
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Source</div>
                  <div className="text-sm font-bold text-gray-900">{selectedLead.source || 'N/A'}</div>
                </div>
              </div>
              
              {/* Contacts Section */}
              <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
                <div className="flex items-center gap-2 mb-4">
                  <UserIcon className="w-5 h-5 text-purple-600" />
                  <h4 className="font-bold text-lg text-gray-900">Contacts</h4>
                </div>
                {contactsLoading ? (
                  <div className="text-center py-4 text-gray-500">
                    <div className="loading loading-spinner loading-sm"></div>
                    <p className="mt-2 text-xs">Loading contacts...</p>
                  </div>
                ) : contacts.length > 0 ? (
                  <div className="space-y-3">
                    {contacts.map((contact, idx) => (
                      <div
                        key={contact.id || idx}
                        className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200"
                      >
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm">
                              {contact.name?.charAt(0)?.toUpperCase() || '?'}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-sm text-gray-900">{contact.name}</span>
                              {contact.isMain && (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 font-medium">
                                  Main
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        {(contact.phone || contact.mobile || contact.email) && (
                          <div className="flex items-center gap-2">
                            {contact.phone && (
                              <button
                                onClick={() => window.open(`tel:${contact.phone}`, '_self')}
                                className="btn btn-circle btn-sm bg-blue-50 hover:bg-blue-100 border-blue-200 text-blue-600 hover:text-blue-700 transition-colors"
                                title={`Call ${contact.phone}`}
                              >
                                <PhoneIcon className="w-4 h-4" />
                              </button>
                            )}
                            {contact.mobile && !contact.phone && (
                              <button
                                onClick={() => window.open(`tel:${contact.mobile}`, '_self')}
                                className="btn btn-circle btn-sm bg-blue-50 hover:bg-blue-100 border-blue-200 text-blue-600 hover:text-blue-700 transition-colors"
                                title={`Call ${contact.mobile}`}
                              >
                                <PhoneIcon className="w-4 h-4" />
                              </button>
                            )}
                            {contact.email && (
                              <button
                                onClick={() => {
                                  setSelectedLead({ ...selectedLead, email: contact.email });
                                  setIsContactEmailModalOpen(true);
                                }}
                                className="btn btn-circle btn-sm bg-purple-50 hover:bg-purple-100 border-purple-200 text-purple-600 hover:text-purple-700 transition-colors"
                                title={`Email ${contact.email}`}
                              >
                                <EnvelopeIcon className="w-4 h-4" />
                              </button>
                            )}
                            {(contact.phone || contact.mobile) && (
                              <button
                                onClick={() => {
                                  const phoneNumber = contact.phone || contact.mobile;
                                  setSelectedLead({ ...selectedLead, phone: phoneNumber });
                                  setIsContactWhatsAppModalOpen(true);
                                }}
                                className="btn btn-circle btn-sm bg-green-50 hover:bg-green-100 border-green-200 text-green-600 hover:text-green-700 transition-colors"
                                title={`WhatsApp ${contact.phone || contact.mobile}`}
                              >
                                <FaWhatsapp className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        )}
                        {(contact.phone || contact.mobile || contact.email) && (
                          <div className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-600 space-y-1">
                            {contact.phone && <div className="flex items-center gap-2"><PhoneIcon className="w-3 h-3" /> {contact.phone}</div>}
                            {contact.mobile && <div className="flex items-center gap-2"><PhoneIcon className="w-3 h-3" /> {contact.mobile}</div>}
                            {contact.email && <div className="flex items-center gap-2"><EnvelopeIcon className="w-3 h-3" /> {contact.email}</div>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <UserIcon className="w-12 h-12 mx-auto text-gray-300 mb-2" />
                    <p className="text-sm">No contacts available</p>
                  </div>
                )}
              </div>
              
              {/* Documents Button */}
              <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-gray-900 mb-1">Documents</div>
                    <div className="text-xs text-gray-500">
                      {selectedLead.onedrive_folder_link ? 'View client documents' : 'No documents available'}
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setDrawerOpen(false);
                      setIsDocumentModalOpen(true);
                    }}
                    className={`btn btn-outline ${selectedLead.onedrive_folder_link ? '' : 'btn-disabled'}`}
                    style={{ borderColor: '#3b28c7', color: '#3b28c7' }}
                    disabled={!selectedLead.onedrive_folder_link}
                    onMouseEnter={(e) => {
                      if (!e.currentTarget.disabled) {
                        e.currentTarget.style.backgroundColor = '#f3f0ff';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!e.currentTarget.disabled) {
                        e.currentTarget.style.backgroundColor = 'white';
                      }
                    }}
                  >
                    <FolderIconSolid className="w-5 h-5" />
                    Documents
                    {documentCount > 0 && (
                      <span className="badge text-white ml-2" style={{ backgroundColor: '#3b28c7' }}>{documentCount}</span>
                    )}
                  </button>
                </div>
              </div>
              
              {/* Latest Conversations */}
              <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
                <div className="flex items-center gap-2 mb-4">
                  <ChatBubbleLeftRightIcon className="w-5 h-5 text-purple-600" />
                  <h4 className="font-bold text-lg text-gray-900">Latest Conversations</h4>
                </div>
                {conversationsLoading ? (
                  <div className="text-center py-8 text-gray-500">
                    <div className="loading loading-spinner loading-md"></div>
                    <p className="mt-2">Loading conversations...</p>
                  </div>
                ) : conversations.length > 0 ? (
                  <div className="space-y-3 max-h-[400px] overflow-y-auto">
                    {conversations.map((conv, idx) => (
                      <div
                        key={conv.id || idx}
                        onClick={() => {
                          closeDrawer();
                          navigate(`/clients/${selectedLead.lead_number}?tab=interactions`);
                        }}
                        className={`p-3 rounded-lg border shadow-sm cursor-pointer transition-all hover:shadow-md hover:scale-[1.02] ${
                          conv.direction === 'out' 
                            ? 'bg-white border-purple-200 hover:border-purple-300' 
                            : 'bg-white border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className={`badge badge-sm ${
                              conv.type === 'email' ? 'badge-info' :
                              conv.type === 'whatsapp' ? 'badge-success' :
                              'badge-ghost'
                            }`}>
                              {conv.type === 'email' ? 'Email' :
                               conv.type === 'whatsapp' ? 'WhatsApp' :
                               'Contact'}
                            </span>
                            <span className="text-xs font-medium text-gray-600">{conv.sender}</span>
                          </div>
                          <span className="text-xs text-gray-500">
                            {format(new Date(conv.timestamp), 'dd/MM/yyyy HH:mm')}
                          </span>
                        </div>
                        {conv.subject && (
                          <div className="text-sm font-semibold text-gray-900 mb-1">{conv.subject}</div>
                        )}
                        <div className="text-sm text-gray-700 line-clamp-2">{conv.content}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <p className="text-sm">No conversations yet</p>
                  </div>
                )}
              </div>
              
              {/* Comments Section */}
              <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
                <div className="flex items-center gap-2 mb-4">
                  <ChatBubbleLeftRightIcon className="w-5 h-5 text-purple-600" />
                  <h4 className="font-bold text-lg text-gray-900">Comments</h4>
                </div>
                <div className="space-y-3 mb-4 max-h-[200px] overflow-y-auto">
                  {(selectedLead.comments && selectedLead.comments.length > 0) ? (
                    selectedLead.comments.slice().reverse().map((c, idx) => (
                      <div key={idx} className="p-3 flex flex-col">
                        <span className="text-base-content/90">{c.text}</span>
                        <span className="text-xs text-base-content/50 mt-1">{c.user} · {format(new Date(c.timestamp), 'dd/MM/yyyy HH:mm')}</span>
                      </div>
                    ))
                  ) : (
                    <span className="text-base-content/40 text-sm">No comments yet.</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    className="input input-bordered flex-1 text-sm"
                    placeholder="Add a comment..."
                    value={newComment}
                    onChange={e => setNewComment(e.target.value)}
                    disabled={commentSubmitting}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter' && !commentSubmitting && newComment.trim()) {
                        handleAddComment();
                      }
                    }}
                  />
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={handleAddComment}
                    disabled={commentSubmitting || !newComment.trim()}
                  >
                    {commentSubmitting ? 'Adding...' : 'Add'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Contact Drawer */}
      {contactDrawerOpen && selectedLead && (
        <div className="fixed inset-0 flex">
          {/* Overlay */}
          <div className="fixed inset-0 bg-black/30 transition-opacity duration-300 z-[9998]" onClick={closeContactDrawer} />
          <div className="ml-auto w-full max-w-md bg-base-100 h-full shadow-2xl p-8 flex flex-col z-[9999]">
            <div className="animate-slideInRight h-full flex flex-col">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-2xl font-bold">Contact Client</h3>
                <button className="btn btn-ghost btn-sm" onClick={closeContactDrawer}>
                  <XMarkIcon className="w-6 h-6" />
                </button>
              </div>
              <div className="flex flex-col gap-4 flex-1">
                <div>
                  <label className="block font-semibold mb-1">How to contact</label>
                  <select
                    className="select select-bordered w-full"
                    value={newContact.method}
                    onChange={e => handleNewContactChange('method', e.target.value)}
                  >
                    <option value="email">Email</option>
                    <option value="phone">Phone</option>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="meeting">Meeting</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold mb-1">Date</label>
                  <input
                    type="text"
                    className="input input-bordered w-full"
                    value={newContact.date}
                    onChange={e => handleNewContactChange('date', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Time</label>
                  <input
                    type="text"
                    className="input input-bordered w-full"
                    value={newContact.time}
                    onChange={e => handleNewContactChange('time', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Minutes</label>
                  <input
                    type="number"
                    min="0"
                    className="input input-bordered w-full"
                    value={newContact.length}
                    onChange={e => handleNewContactChange('length', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Content</label>
                  <textarea
                    className="textarea textarea-bordered w-full min-h-[80px]"
                    value={newContact.content}
                    onChange={e => handleNewContactChange('content', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Observation</label>
                  <textarea
                    className="textarea textarea-bordered w-full min-h-[60px]"
                    value={newContact.observation}
                    onChange={e => handleNewContactChange('observation', e.target.value)}
                  />
                </div>
              </div>
              <div className="mt-6 flex justify-end">
                <button className="btn btn-primary px-8" onClick={handleSaveContact}>
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Document Modal Drawer (right) */}
      {isDocumentModalOpen && selectedLead && (
        <div className="fixed inset-0 z-[9999] flex">
          <div className="fixed inset-0 bg-black/30 transition-opacity duration-300" onClick={() => { setIsDocumentModalOpen(false); }} />
          <div className="ml-auto w-full max-w-2xl bg-white h-full shadow-2xl p-0 flex flex-col animate-slideInRight z-[10000] rounded-l-2xl border-l-4 border-primary relative" style={{ boxShadow: '0 0 40px 0 rgba(0,0,0,0.2)' }}>
            <DocumentModal
              isOpen={isDocumentModalOpen}
              onClose={() => { setIsDocumentModalOpen(false); }}
              leadNumber={selectedLead.lead_number || ''}
              clientName={selectedLead.name || ''}
              onDocumentCountChange={setDocumentCount}
            />
          </div>
        </div>
      )}
      {/* Email Thread Modal (copied from InteractionsTab) */}
      {isEmailModalOpen && selectedLead && createPortal(
        <div className="fixed inset-0 bg-black/50 z-[999] flex items-start justify-center p-4">
          <div className="bg-base-100 rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden mt-12">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-base-300">
              <h3 className="text-xl font-bold">Email Thread with {selectedLead.name}</h3>
              <div className="flex items-center gap-2">
                <button className="btn btn-primary btn-sm" onClick={() => setShowCompose(true)}>
                  Compose New Email
                </button>
                <button className="btn btn-ghost btn-sm btn-circle" onClick={() => setIsEmailModalOpen(false)}>
                  <XMarkIcon className="w-6 h-6" />
                </button>
              </div>
            </div>
            {/* Conversation Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {emailsLoading ? (
                <div className="text-center p-8">Loading email history...</div>
              ) : emails.length === 0 ? (
                <div className="text-center p-8 text-base-content/70">No emails found for this client.</div>
              ) : (
                [...emails].reverse().map(email => {
                  // Use sent_at or receivedDateTime for date
                  const sentDate = email.sent_at || email.date || email.receivedDateTime;
                  let formattedDate = 'Unknown date';
                  if (sentDate) {
                    try {
                      formattedDate = new Date(sentDate).toLocaleString();
                    } catch {}
                  }
                  return (
                    <div 
                      key={email.id} 
                      data-email-id={email.id}
                      className={`flex items-end gap-3 ${email.direction === 'outgoing' ? 'flex-row-reverse' : ''}`}
                    >
                      <div className={`avatar placeholder ${email.direction === 'outgoing' ? 'hidden' : ''}`}>
                        <div className="bg-neutral-focus text-neutral-content rounded-full w-10 h-10">
                          <span>{selectedLead.name.charAt(0)}</span>
                        </div>
                      </div>
                      <div className={`chat-bubble max-w-2xl break-words ${email.direction === 'outgoing' ? 'chat-bubble-primary' : 'bg-base-200'}`}> 
                        <div className="flex justify-between items-center text-xs opacity-70 mb-2">
                          <span className="font-bold">{email.from || email.sender_email}</span>
                          <span>{formattedDate}</span>
                        </div>
                        <div className="font-bold mb-2">{email.subject}</div>
                        <div className="prose" dangerouslySetInnerHTML={{ __html: email.bodyPreview || email.body_preview || email.body || '' }} />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
      {/* Compose Email Modal (Drawer style, copied from InteractionsTab) */}
      {showCompose && selectedLead && createPortal(
        <div className="fixed inset-0 z-[999]">
          <div className="fixed inset-0 bg-black/30" onClick={() => setShowCompose(false)} />
          <div className="fixed inset-y-0 right-0 h-screen w-full max-w-md bg-base-100 shadow-2xl p-8 flex flex-col animate-slideInRight z-[999]">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-bold">Compose Email</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowCompose(false)}>
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
            <div className="flex flex-col gap-4 flex-1">
              <div>
                <label className="block font-semibold mb-1">To</label>
                <input type="text" className="input input-bordered w-full" value={selectedLead.email || ''} disabled />
              </div>
              <div>
                <label className="block font-semibold mb-1">Subject</label>
                <input type="text" className="input input-bordered w-full" value={composeSubject} onChange={e => setComposeSubject(e.target.value)} />
              </div>
              <div>
                <label className="block font-semibold mb-2">Templates</label>
                <div className="flex flex-wrap gap-2">
                  {emailTemplates.map(template => (
                    <button
                      key={template.name}
                      className="btn btn-outline btn-xs"
                      onClick={() => {
                        const uploadLink = 'https://portal.example.com/upload';
                        const processedBody = template.body
                            .replace(/{client_name}/g, selectedLead.name)
                            .replace(/{upload_link}/g, uploadLink);
                        const newSubject = `[${selectedLead.lead_number}] - ${selectedLead.name} - ${selectedLead.topic || ''}`;
                        setComposeBody(processedBody);
                        setComposeSubject(newSubject);
                      }}
                    >
                      {template.name}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block font-semibold mb-1">Body</label>
                <textarea className="textarea textarea-bordered w-full min-h-[120px]" value={composeBody} onChange={e => setComposeBody(e.target.value)} />
              </div>
              {/* Attachments Section */}
              <div>
                <label className="block font-semibold mb-1">Attachments</label>
                <div className="p-4 bg-base-200 rounded-lg">
                  <div className="flex flex-col gap-2 mb-2">
                    {composeAttachments.map((att, index) => (
                      <div key={index} className="flex items-center justify-between text-sm">
                        <span>{att.name}</span>
                        <button 
                          className="btn btn-ghost btn-xs"
                          onClick={() => setComposeAttachments(prev => prev.filter(a => a.name !== att.name))}
                        >
                          <XMarkIcon className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <label htmlFor="file-upload" className="btn btn-outline btn-sm w-full">
                    <PaperClipIcon className="w-4 h-4" /> Add Attachment
                  </label>
                  <input id="file-upload" type="file" className="hidden" onChange={(e) => e.target.files && handleAttachmentUpload(e.target.files)} />
                </div>
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <button
                className="btn btn-primary px-8"
                disabled={sending}
                onClick={async () => {
                  if (!selectedLead || !instance || !accounts[0]) return;
                  setSending(true);
                  try {
                    const tokenResponse = await acquireToken(instance, accounts[0]);
                    const senderName = accounts[0]?.name || 'Your Team';
                    await sendClientEmail(
                      tokenResponse.accessToken,
                      composeSubject,
                      composeBody,
                      selectedLead,
                      senderName,
                      composeAttachments
                    );
                    toast.success('Email sent and saved!');
                    // Refresh emails after sending
                    setEmailsLoading(true);
                    await syncClientEmails(tokenResponse.accessToken, selectedLead);
                    const { data } = await supabase.from('emails').select('*').eq('client_id', selectedLead.id).order('sent_at', { ascending: false });
                    setEmails(data || []);
                    setIsEmailModalOpen(false); // Close the email thread modal after sending
                  } catch (e: any) {
                    toast.error(e?.message || 'Failed to send email.');
                  }
                  setSending(false);
                }}
              >
                {sending ? 'Sending...' : 'Send'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      {/* WhatsApp Modal (copied from InteractionsTab) */}
      {isWhatsAppOpen && selectedLead && createPortal(
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/50">
          <div className="bg-base-100 rounded-2xl shadow-2xl w-full max-w-4xl h-[90vh] flex flex-col overflow-hidden relative animate-fadeInUp">
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3 bg-primary text-white">
              <div className="avatar placeholder">
                <div className="bg-primary text-white rounded-full w-10 h-10 flex items-center justify-center font-bold">
                  {selectedLead.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                </div>
              </div>
              <div className="flex-1">
                <div className="font-semibold text-lg">{selectedLead.name}</div>
                <div className="text-xs text-primary-content/80">online</div>
              </div>
              <button className="btn btn-ghost btn-sm text-white" onClick={() => setIsWhatsAppOpen(false)}>
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
            {/* Chat Area */}
            <div className="flex-1 overflow-y-auto px-4 py-6 bg-green-50" style={{ background: 'url(https://www.transparenttextures.com/patterns/cubes.png)', backgroundSize: 'auto' }}>
              <div className="flex flex-col gap-2">
                <div className="flex flex-col gap-5">
                  {whatsAppChatMessages.map((msg: any, idx: number) => (
                    <div key={msg.id || idx} className={`flex ${msg.direction === 'out' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[75%] px-4 py-2 rounded-2xl shadow text-sm relative ${msg.direction === 'out' ? 'bg-primary text-white rounded-br-md' : 'bg-white text-gray-900 rounded-bl-md border border-base-200'}`} style={{ wordBreak: 'break-word' }}>
                        {msg.content}
                        <div className="flex items-center gap-1 mt-1 text-[10px] opacity-70 justify-end">
                          <span>{msg.time}</span>
                          {msg.direction === 'out' && (
                            <span className="inline-block align-middle">
                              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-blue-400" style={{ display: 'inline' }}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {/* Input Area */}
            <form className="flex items-center gap-2 px-4 py-3 bg-base-200" onSubmit={async e => {
              e.preventDefault();
              if (whatsAppInput.trim()) {
                const now = new Date();
                const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                // Save WhatsApp message to DB (Supabase)
                let senderId = null;
                let senderName = 'You';
                try {
                  const { data: { user } } = await supabase.auth.getUser();
                  if (user?.id) {
                    // Look up the internal user id by auth_id
                    const { data: userRow, error: userLookupError } = await supabase
                      .from('users')
                      .select('id, full_name, email')
                      .eq('auth_id', user.id)
                      .single();
                    if (userLookupError || !userRow) {
                      toast.error('Could not find your user profile in the database.');
                      return;
                    }
                    senderId = userRow.id;
                    if (userRow.full_name) senderName = userRow.full_name;
                    else if (userRow.email) senderName = userRow.email;
                  }
                  // Insert into whatsapp_messages table
                  const { error: insertError } = await supabase
                    .from('whatsapp_messages')
                    .insert([
                      {
                        lead_id: selectedLead.id,
                        sender_id: senderId,
                        sender_name: senderName,
                        direction: 'out',
                        message: whatsAppInput,
                        sent_at: now.toISOString(),
                        status: 'sent',
                      }
                    ]);
                  if (insertError) {
                    console.error('[WhatsApp Insert Error]', insertError);
                    toast.error('Failed to save WhatsApp message: ' + insertError.message);
                    return;
                  }
                  // Fetch latest WhatsApp messages for this lead
                  const { data: whatsappData, error: fetchError } = await supabase
                    .from('whatsapp_messages')
                    .select('*')
                    .eq('lead_id', selectedLead.id)
                    .order('sent_at', { ascending: false });
                  let whatsappInteractions: any[] = [];
                  if (!fetchError && whatsappData) {
                    whatsappInteractions = whatsappData.map((msg: any) => ({
                      id: `whatsapp_${msg.id}`,
                      date: msg.sent_at ? new Date(msg.sent_at).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '',
                      time: msg.sent_at ? new Date(msg.sent_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '',
                      raw_date: msg.sent_at,
                      employee: msg.sender_name,
                      direction: msg.direction,
                      kind: 'whatsapp',
                      length: '',
                      content: msg.message,
                      observation: '',
                      editable: false,
                    }));
                  }
                  // Merge WhatsApp interactions into manual_interactions for timeline
                  const manualInteractions = selectedLead.manual_interactions || [];
                  const filteredManual = manualInteractions.filter(i => i.kind !== 'whatsapp');
                  const updatedInteractions = [...filteredManual, ...whatsappInteractions];
                  await supabase
                    .from('leads')
                    .update({ manual_interactions: updatedInteractions })
                    .eq('id', selectedLead.id);
                  // Fetch the updated lead from Supabase
                  const { data: updatedLeadArr, error: fetchLeadError } = await supabase
                    .from('leads')
                    .select('*')
                    .eq('id', selectedLead.id)
                    .single();
                  if (!fetchLeadError && updatedLeadArr) {
                    setSelectedLead(updatedLeadArr);
                    setLeads(prevLeads => prevLeads.map(l => l.id === selectedLead.id ? updatedLeadArr : l));
                  } else {
                    // fallback: update selectedLead locally
                    setSelectedLead({ ...selectedLead, manual_interactions: updatedInteractions });
                  }
                  setWhatsAppInput("");
                  toast.success('WhatsApp message sent!');
                } catch (err) {
                  console.error('Failed to save WhatsApp message to DB', err);
                  toast.error('Unexpected error saving WhatsApp message.');
                }
              }
            }}>
              <button type="button" className="btn btn-ghost btn-circle">
                <FaceSmileIcon className="w-6 h-6 text-gray-500" />
              </button>
              <button type="button" className="btn btn-ghost btn-circle">
                <PaperClipIcon className="w-6 h-6 text-gray-500" />
              </button>
              <input
                type="text"
                className="input input-bordered flex-1 rounded-full"
                placeholder="Type a message"
                value={whatsAppInput}
                onChange={e => setWhatsAppInput(e.target.value)}
              />
              <button type="submit" className="btn btn-success btn-circle">
                <PaperAirplaneIcon className="w-6 h-6" />
              </button>
            </form>
          </div>
        </div>,
        document.body
      )}
      {/* Highlighted Cards Panel */}
      <div className={`fixed top-0 right-0 h-full z-40 flex items-start transition-transform duration-300 ${highlightPanelOpen ? 'translate-x-0' : 'translate-x-full'}`}
        style={{ width: 420 }}>
        <div className="relative h-full bg-white shadow-2xl border-l border-base-200 flex flex-col w-full">
          <div className="p-4 border-b border-base-200 flex items-center gap-2">
            <span className="font-bold text-lg">Highlights</span>
            <span className="badge badge-primary">{highlightedLeads.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {highlightedLeads.length === 0 ? (
              <div className="text-base-content/50 text-center mt-12">No highlighted leads yet.</div>
            ) : (
              highlightedLeads.map(lead => (
                <div key={lead.id} className="flex items-start gap-2">
                  {/* Card */}
                  <div
                    className="bg-white rounded-2xl shadow-lg border-2 border-primary/30 hover:shadow-2xl hover:border-primary/60 transition-all duration-200 cursor-pointer flex flex-col gap-2 relative p-4 group"
                    style={{ minHeight: 120, flex: 1 }}
                    onClick={() => handleHighlightCardClick(Number(lead.id))}
                  >
                    {/* Label on top */}
                    {lead.label && (
                      <div className="mb-1 flex justify-start">
                        <span className="px-2 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary border-2 border-primary">{lead.label}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-semibold text-gray-400 tracking-widest">{lead.lead_number}</span>
                      <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                      <span className="font-bold text-base-content truncate text-base">{lead.name}</span>
                    </div>
                    {/* Two rows of content */}
                    <div className="flex flex-row gap-4 text-xs mb-1">
                      <div className="flex items-center gap-1">
                        <span className="font-semibold">Stage:</span>
                        <span>{lead.stage ? getStageName(lead.stage) : 'N/A'}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="font-semibold">Offer:</span>
                        <span>{lead.balance !== undefined && lead.balance !== null ? `${getCurrencySymbol(lead.balance_currency)}${lead.balance}` : 'N/A'}</span>
                      </div>
                    </div>
                    <div className="flex flex-row gap-4 text-xs">
                      <div className="flex items-center gap-1">
                        <span className="font-semibold">Probability:</span>
                        <span>{lead.probability !== undefined && lead.probability !== null ? `${lead.probability}%` : 'N/A'}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="font-semibold">Follow Up:</span>
                        <span>{lead.next_followup ? format(parseISO(lead.next_followup), 'dd/MM/yyyy') : 'N/A'}</span>
                      </div>
                    </div>
                  </div>
                  {/* Remove button OUTSIDE the card */}
                  <button
                    className="btn btn-xs btn-error mt-2"
                    title="Remove from highlights"
                    onClick={e => { e.stopPropagation(); handleRemoveHighlight(lead.id.toString()); }}
                  >
                    <XMarkIcon className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      {/* Highlight Panel Arrow Toggle (moves to left of panel when open) */}
      <button
        className={`fixed z-50 btn btn-circle btn-primary btn-sm transition-transform duration-300`}
        style={{
          top: 100,
          right: highlightPanelOpen ? 420 : 0,
          boxShadow: '0 2px 8px 0 rgba(0,0,0,0.10)',
          position: 'fixed',
        }}
        onClick={() => setHighlightPanelOpen(!highlightPanelOpen)}
        title={highlightPanelOpen ? 'Close Highlights' : 'Open Highlights'}
      >
        <svg className={`w-6 h-6 transition-transform ${highlightPanelOpen ? '' : 'rotate-180'}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
      </button>

      {/* Assignment Modal */}
      {assignmentModalOpen && createPortal(
        <div className="fixed inset-0 bg-black/50 z-[999] flex items-center justify-center p-4">
          <div className="bg-base-100 rounded-2xl shadow-xl w-full h-full max-w-none max-h-none flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-base-300">
              <div>
                <h3 className="text-2xl font-bold">Assign {pipelineMode === 'closer' ? 'Closer' : 'Scheduler'} to Leads</h3>
                <p className="text-base-content/70 mt-1">
                  {pipelineMode === 'closer' 
                    ? 'Unassigned leads and leads with old closer interactions' 
                    : 'Unassigned leads and leads with old scheduler interactions'
                  }
                </p>
              </div>
              <button 
                className="btn btn-ghost btn-circle" 
                onClick={() => setAssignmentModalOpen(false)}
              >
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>

            {/* Search and Sort Controls */}
            <div className="p-6 border-b border-base-300">
              <div className="flex flex-col gap-4">
                {/* Search and Sort Row */}
                <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
                  {/* Search Bar */}
                  <div className="relative flex items-center w-full md:w-80">
                    <MagnifyingGlassIcon className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-base-content/50" />
                    <input
                      type="text"
                      placeholder="Search by name or lead number..."
                      className="input input-bordered w-full pl-10"
                      value={assignmentSearchQuery}
                      onChange={e => setAssignmentSearchQuery(e.target.value)}
                    />
                  </div>
                  
                  {/* Stage Filter Dropdown */}
                  <div className="flex items-center gap-2">
                    <select
                      className="select select-bordered select-sm"
                      value={assignmentStageFilter}
                      onChange={e => setAssignmentStageFilter(e.target.value)}
                    >
                      <option value="">All Stages</option>
                      {assignmentStageOptions.map(stage => (
                        <option key={stage} value={stage}>{stage}</option>
                      ))}
                    </select>
                  </div>
                  
                  {/* Sort Controls */}
                  <div className="flex gap-2">
                    <button
                      className={`btn btn-sm ${assignmentSortColumn === 'created_at' ? 'btn-primary' : 'btn-outline'}`}
                      onClick={() => handleAssignmentSort('created_at')}
                    >
                      Date Created
                      {assignmentSortColumn === 'created_at' && (
                        <span className="ml-1">{assignmentSortDirection === 'asc' ? '▲' : '▼'}</span>
                      )}
                    </button>
                    <button
                      className={`btn btn-sm ${assignmentSortColumn === 'offer' ? 'btn-primary' : 'btn-outline'}`}
                      onClick={() => handleAssignmentSort('offer')}
                    >
                      Offer Amount
                      {assignmentSortColumn === 'offer' && (
                        <span className="ml-1">{assignmentSortDirection === 'asc' ? '▲' : '▼'}</span>
                      )}
                    </button>
                    <button
                      className={`btn btn-sm ${assignmentSortColumn === 'probability' ? 'btn-primary' : 'btn-outline'}`}
                      onClick={() => handleAssignmentSort('probability')}
                    >
                      Probability
                      {assignmentSortColumn === 'probability' && (
                        <span className="ml-1">{assignmentSortDirection === 'asc' ? '▲' : '▼'}</span>
                      )}
                    </button>
                  </div>
                </div>
                
                {/* Status Filter Buttons */}
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={() => setShowUnassignedOnly(!showUnassignedOnly)}
                    className={`btn btn-sm font-medium transition-all duration-200 ${
                      showUnassignedOnly 
                        ? 'bg-gradient-to-r from-red-500 to-red-600 text-white shadow-lg border border-red-400' 
                        : 'btn-outline border-red-300 text-red-600 hover:bg-red-50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${showUnassignedOnly ? 'bg-white animate-pulse' : 'bg-red-500'}`}></div>
                      No {pipelineMode === 'closer' ? 'Closer' : 'Scheduler'} Assigned
                      {showUnassignedOnly && (
                        <span className="badge badge-sm bg-white/20 text-white border-white/30">
                          {sortedAssignmentLeads.filter(lead => isUnassignedLead(lead)).length}
                        </span>
                      )}
                    </div>
                  </button>
                  
                  <button
                    onClick={() => setShowLostInteractionsOnly(!showLostInteractionsOnly)}
                    className={`btn btn-sm font-medium transition-all duration-200 ${
                      showLostInteractionsOnly 
                        ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg border border-amber-400' 
                        : 'btn-outline border-amber-300 text-amber-600 hover:bg-amber-50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${showLostInteractionsOnly ? 'bg-white animate-pulse' : 'bg-amber-500'}`}></div>
                      Lost Interactions
                      {showLostInteractionsOnly && (
                        <span className="badge badge-sm bg-white/20 text-white border-white/30">
                          {sortedAssignmentLeads.filter(lead => hasLostInteractions(lead)).length}
                        </span>
                      )}
                    </div>
                  </button>
                  
                  {/* Clear All Filters Button */}
                  {(showUnassignedOnly || showLostInteractionsOnly) && (
                    <button
                      onClick={() => {
                        setShowUnassignedOnly(false);
                        setShowLostInteractionsOnly(false);
                      }}
                      className="btn btn-sm btn-ghost text-gray-500 hover:text-gray-700"
                    >
                      Clear Filters
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {assignmentLoading ? (
                <div className="text-center p-8">
                  <div className="loading loading-spinner loading-lg"></div>
                  <p className="mt-4 text-base-content/60">Loading leads for assignment...</p>
                </div>
              ) : sortedAssignmentLeads.length === 0 ? (
                <div className="text-center p-8">
                  <UserIcon className="w-16 h-16 mx-auto mb-4 opacity-50" />
                  <p className="text-lg font-medium">
                    {assignmentSearchQuery ? 'No leads match your search' : 'No leads available for assignment'}
                  </p>
                  <p className="text-sm text-base-content/60">
                    {assignmentSearchQuery 
                      ? 'Try adjusting your search terms'
                      : 'All leads are properly assigned or have recent interactions'
                    }
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {sortedAssignmentLeads.map((lead) => (
                    <div
                      key={lead.id}
                      className="bg-white rounded-xl p-4 pt-12 shadow-md border border-gray-100 hover:shadow-lg transition-all duration-200 cursor-pointer relative min-h-[280px]"
                      onClick={() => window.open(`/clients/${lead.lead_number}`, '_blank')}
                    >
                      {/* Status Badges - Top Right */}
                      <div className="absolute top-3 right-3 flex flex-row gap-1 z-10">
                        {/* No Scheduler/Closer Assigned Badge */}
                        {isUnassignedLead(lead) && (
                          <div className="bg-gradient-to-r from-red-500 to-red-600 text-white px-2 py-1 rounded-full text-xs font-bold shadow-lg border border-red-400 transform hover:scale-105 transition-all duration-200">
                            <div className="flex items-center gap-1">
                              <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse"></div>
                              No {pipelineMode === 'closer' ? 'Closer' : 'Scheduler'}
                            </div>
                          </div>
                        )}
                        
                        {/* Lost Interactions Badge */}
                        {hasLostInteractions(lead) && (
                          <div className="bg-gradient-to-r from-amber-500 to-orange-500 text-white px-2 py-1 rounded-full text-xs font-bold shadow-lg border border-amber-400 transform hover:scale-105 transition-all duration-200">
                            <div className="flex items-center gap-1">
                              <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse"></div>
                              Lost Interactions
                            </div>
                          </div>
                        )}
                      </div>
                      {/* Lead Header */}
                      <div className="flex items-center justify-between mb-3 pr-32">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <span className="text-xs font-semibold text-gray-400 tracking-widest flex-shrink-0">{lead.lead_number}</span>
                          <span className="w-1 h-1 bg-gray-300 rounded-full flex-shrink-0"></span>
                          <span className="text-sm font-bold text-gray-900 truncate">{lead.name}</span>
                        </div>
                        {lead.label && (
                          <span className="px-2 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary border border-primary/20 flex-shrink-0 ml-2">
                            {lead.label}
                          </span>
                        )}
                      </div>

                      {/* Lead Details */}
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-500">Stage:</span>
                          <span className="font-semibold">{lead.stage ? getStageName(lead.stage) : 'N/A'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Probability:</span>
                          <span className={`font-semibold ${
                            (lead.probability || 0) >= 80 ? 'text-green-600' :
                            (lead.probability || 0) >= 60 ? 'text-yellow-600' :
                            (lead.probability || 0) >= 40 ? 'text-orange-600' :
                            'text-red-600'
                          }`}>
                            {lead.probability !== undefined && lead.probability !== null ? `${lead.probability}%` : 'N/A'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Offer:</span>
                          <span className="font-semibold">
                            {lead.balance !== undefined && lead.balance !== null 
                              ? `${getCurrencySymbol(lead.balance_currency)}${lead.balance}` 
                              : 'N/A'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Created:</span>
                          <span className="font-semibold">{format(parseISO(lead.created_at), 'dd/MM/yyyy')}</span>
                        </div>
                        {/* Debug: Always show topic and category to see what's happening */}
                        <div className="flex justify-between">
                          <span className="text-gray-500">Topic:</span>
                          <span className="font-semibold truncate max-w-[120px]" title={lead.topic || 'null'}>{lead.topic || 'N/A'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Category:</span>
                          <span className="font-semibold truncate max-w-[120px]" title={lead.category || 'null'}>{lead.category || 'N/A'}</span>
                        </div>
                        {lead.meetings && lead.meetings.length > 0 && (
                          <div className="flex justify-between">
                            <span className="text-gray-500">Meeting:</span>
                            <span className="font-semibold">{lead.meetings[0].meeting_date}</span>
                          </div>
                        )}
                      </div>

                      {/* Assignment Button */}
                      <div className="mt-4 pt-3 border-t border-gray-100">
                        <button
                          onClick={(e) => {
                            e.stopPropagation(); // Prevent card click when clicking button
                            handleAssignToLead(lead);
                          }}
                          disabled={assigningLead === lead.id.toString()}
                          className="btn btn-primary btn-sm w-full flex items-center justify-center gap-2"
                        >
                          {assigningLead === lead.id.toString() ? (
                            <>
                              <div className="loading loading-spinner loading-xs"></div>
                              Assigning...
                            </>
                          ) : (
                            <>
                              <UserIcon className="w-4 h-4" />
                              Assign as {pipelineMode === 'closer' ? 'Closer' : 'Scheduler'}
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
      
      {/* Edit Lead Drawer */}
      {showEditLeadDrawer && (
        <div className="fixed inset-0 z-50 flex">
          {/* Overlay */}
          <div className="fixed inset-0 bg-black/30" onClick={() => setShowEditLeadDrawer(false)} />
          {/* Drawer */}
          <div className="ml-auto w-full max-w-md bg-base-100 h-full shadow-2xl p-8 flex flex-col animate-slideInRight z-50">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-bold">Edit Lead</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowEditLeadDrawer(false)}>
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
            <div className="flex flex-col gap-4 flex-1 overflow-y-auto">
              <div>
                <label className="block font-semibold mb-1">Tags</label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  placeholder="Search or select tags..."
                  value={currentLeadTags}
                  onChange={e => setCurrentLeadTags(e.target.value)}
                  list="tags-options"
                />
                <datalist id="tags-options">
                  {tagsList.map((name, index) => (
                    <option key={`${name}-${index}`} value={name} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="block font-semibold mb-1">Source</label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  placeholder="Search or select a source..."
                  value={editLeadData.source}
                  onChange={e => handleEditLeadChange('source', e.target.value)}
                  list="source-options"
                />
                <datalist id="source-options">
                  {sources.map((name, index) => (
                    <option key={`${name}-${index}`} value={name} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="block font-semibold mb-1">Client Name</label>
                <input type="text" className="input input-bordered w-full" value={editLeadData.name} onChange={e => handleEditLeadChange('name', e.target.value)} />
              </div>
              <div>
                <label className="block font-semibold mb-1">Language</label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  placeholder="Search or select a language..."
                  value={editLeadData.language}
                  onChange={e => handleEditLeadChange('language', e.target.value)}
                  list="language-options"
                />
                <datalist id="language-options">
                  {allLanguages.map((lang: any, index: number) => (
                    <option key={`${lang.name}-${index}`} value={lang.name} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="block font-semibold mb-1">Category</label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  placeholder="Search or select a category..."
                  value={editLeadData.category}
                  onChange={e => handleEditLeadChange('category', e.target.value)}
                  list="category-options"
                />
                <datalist id="category-options">
                  {mainCategories.map((name, index) => (
                    <option key={`${name}-${index}`} value={name} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="block font-semibold mb-1">Topic</label>
                <input type="text" className="input input-bordered w-full" value={editLeadData.topic} onChange={e => handleEditLeadChange('topic', e.target.value)} />
              </div>
              <div>
                <label className="block font-semibold mb-1">Probability</label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    className="range range-primary flex-1"
                    value={editLeadData.probability || 0}
                    onChange={e => handleEditLeadChange('probability', parseInt(e.target.value))}
                  />
                  <span className="text-sm font-medium text-gray-700 min-w-[50px] text-right">
                    {editLeadData.probability || 0}%
                  </span>
                </div>
              </div>
              <div>
                <label className="block font-semibold mb-1">Number of Applicants</label>
                <input type="number" min="0" className="input input-bordered w-full" value={editLeadData.number_of_applicants_meeting} onChange={e => handleEditLeadChange('number_of_applicants_meeting', e.target.value)} />
              </div>
              <div>
                <label className="block font-semibold mb-1">Potential Applicants</label>
                <input type="number" min="0" className="input input-bordered w-full" value={editLeadData.potential_applicants_meeting} onChange={e => handleEditLeadChange('potential_applicants_meeting', e.target.value)} />
              </div>
              <div>
                <label className="block font-semibold mb-1">Value (Amount)</label>
                <input type="number" min="0" className="input input-bordered w-full" value={editLeadData.balance} onChange={e => handleEditLeadChange('balance', e.target.value)} />
              </div>
              <div>
                <label className="block font-semibold mb-1">Follow Up Date</label>
                <input type="date" className="input input-bordered w-full" value={editLeadData.next_followup} onChange={e => handleEditLeadChange('next_followup', e.target.value)} />
              </div>
              <div>
                <label className="block font-semibold mb-1">Currency</label>
                <div className="dropdown w-full">
                  <div tabIndex={0} role="button" className="btn btn-outline w-full justify-between">
                    {editLeadData.balance_currency || 'Select Currency'}
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                  <ul tabIndex={0} className="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-full max-h-60 overflow-y-auto">
                    {currencies.length > 0 ? (
                      <>
                        {/* Show current currency first */}
                        {currencies
                          .filter(currency => currency.name === editLeadData.balance_currency)
                          .map((currency) => (
                            <li key={`current-${currency.id}`}>
                              <a onClick={() => handleEditLeadChange('balance_currency', currency.name)}>
                                {currency.name} ({currency.iso_code})
                              </a>
                            </li>
                          ))
                        }
                        {/* Show other currencies */}
                        {currencies
                          .filter(currency => currency.name !== editLeadData.balance_currency)
                          .map((currency) => (
                            <li key={currency.id}>
                              <a onClick={() => handleEditLeadChange('balance_currency', currency.name)}>
                                {currency.name} ({currency.iso_code})
                              </a>
                            </li>
                          ))
                        }
                      </>
                    ) : (
                      <li><a>Loading currencies...</a></li>
                    )}
                  </ul>
                </div>
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <button className="btn btn-primary px-8" onClick={handleSaveEditLead}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PipelinePage; 