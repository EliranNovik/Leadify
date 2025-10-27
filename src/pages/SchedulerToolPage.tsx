import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { toast } from 'react-hot-toast';
import SchedulerWhatsAppModal from '../components/SchedulerWhatsAppModal';
import SchedulerEmailThreadModal from '../components/SchedulerEmailThreadModal';
import { PhoneIcon, EnvelopeIcon, ChevronDownIcon, XMarkIcon, ChevronUpIcon, ChevronUpDownIcon, ChevronRightIcon, PencilSquareIcon, EyeIcon, ClockIcon, ChatBubbleLeftRightIcon, Squares2X2Icon, TableCellsIcon } from '@heroicons/react/24/outline';
import { FaWhatsapp } from 'react-icons/fa';

export interface SchedulerLead {
  id: string;
  lead_number: string;
  name: string;
  created_at: string;
  latest_interaction?: string;
  stage: string;
  language: string;
  source: string;
  category: string;
  topic: string;
  total: string;
  balance_currency: string;
  lead_type: 'new' | 'legacy';
  phone?: string;
  mobile?: string;
  email?: string;
  facts?: string;
  special_notes?: string;
  general_notes?: string;
  tags?: string;
  probability?: number;
  number_of_applicants_meeting?: string;
  potential_applicants_meeting?: string;
  next_followup?: string;
  eligible?: boolean;
  country?: string;
}

const SchedulerToolPage: React.FC = () => {
  const navigate = useNavigate();
  const [leads, setLeads] = useState<SchedulerLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [allCategories, setAllCategories] = useState<any[]>([]);
  const [allSources, setAllSources] = useState<any[]>([]);
  const [allStages, setAllStages] = useState<any[]>([]);
  const [allTags, setAllTags] = useState<any[]>([]);
  const [allCountries, setAllCountries] = useState<any[]>([]);
  const [currentLeadTags, setCurrentLeadTags] = useState<string>('');
  const [selectedLead, setSelectedLead] = useState<SchedulerLead | null>(null);
  const [isWhatsAppModalOpen, setIsWhatsAppModalOpen] = useState(false);
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  
  // Filter states
  const [filters, setFilters] = useState({
    stage: '',
    language: '',
    source: '',
    category: '',
    topic: '',
    tags: '',
    country: ''
  });
  const [filteredLeads, setFilteredLeads] = useState<SchedulerLead[]>([]);
  const [showDropdowns, setShowDropdowns] = useState({
    stage: false,
    language: false,
    source: false,
    category: false,
    topic: false,
    tags: false,
    country: false
  });
  
  // Sorting state
  const [sortConfig, setSortConfig] = useState<{
    key: string | null;
    direction: 'asc' | 'desc' | null;
  }>({ key: null, direction: null });
  
  // Search state
  const [searchTerm, setSearchTerm] = useState('');
  
  // Date filter state
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  
  // Collapsible rows state
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  
  // Contact dropdown state
  const [openContactDropdown, setOpenContactDropdown] = useState<string | null>(null);
  
  // View mode state (box view is default on mobile)
  const [viewMode, setViewMode] = useState<'table' | 'box'>('box');
  
  // Editing state
  const [editingField, setEditingField] = useState<{leadId: string, field: string} | null>(null);
  const [editValues, setEditValues] = useState<{[key: string]: string}>({});
  
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
  const [mainCategories, setMainCategories] = useState<string[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [languagesList, setLanguagesList] = useState<string[]>([]);
  const [tagsList, setTagsList] = useState<string[]>([]);
  const [currencies, setCurrencies] = useState<Array<{id: string, front_name: string, iso_code: string, name: string}>>([]);
  
  // Current user state
  const [currentUser, setCurrentUser] = useState<{id: string, email: string, employee_id: string | null} | null>(null);

  // Fetch current user information
  const fetchCurrentUser = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) {
        // Get user info from users table
        const { data: userData, error: userError } = await supabase
          .from('users')
          .select('id, email, employee_id')
          .eq('email', user.email)
          .single();
        
        if (userError) {
          console.error('Error fetching user data:', userError);
          return null;
        }
        
        if (userData) {
          setCurrentUser(userData);
          return userData;
        }
      }
      return null;
    } catch (error) {
      console.error('Error in fetchCurrentUser:', error);
      return null;
    }
  };

  useEffect(() => {
    const loadData = async () => {
      // First, get current user information
      const userData = await fetchCurrentUser();
      if (!userData || !userData.employee_id) {
        console.error('❌ No user or employee ID found');
        setError('User not found or not linked to an employee');
        setLoading(false);
        return;
      }
      
      // Load reference data first
      const categoriesData = await fetchCategories();
      const sourcesData = await fetchSources();
      const stagesData = await fetchStages();
      const tagsData = await fetchTags();
      const countriesData = await fetchCountries();
      
      
      // Then load leads after reference data is ready, passing user data
      await fetchSchedulerLeads(categoriesData, sourcesData, stagesData, userData, countriesData);
    };
    loadData();
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

        // Fetch languages for dropdown
        const { data: languagesData, error: languagesError } = await supabase
          .from('misc_language')
          .select('name')
          .order('name', { ascending: true });
        
        if (languagesError) {
          console.error('Error fetching languages:', languagesError);
        } else if (languagesData) {
          setLanguagesList(languagesData.map(l => l.name));
        }

        // Fetch categories for dropdown (formatted with main category)
        const { data: categoriesData, error: categoriesError } = await supabase
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
        
        if (categoriesError) {
          console.error('Error fetching categories:', categoriesError);
        } else if (categoriesData) {
          const formattedCategories = categoriesData.map((cat: any) => {
            return cat.misc_maincategory?.name 
              ? `${cat.name} (${cat.misc_maincategory.name})`
              : cat.name;
          });
          setMainCategories(formattedCategories);
        }
      } catch (error) {
        console.error('Error fetching edit lead data:', error);
      }
    };

    fetchEditLeadData();
  }, []);

  const fetchCategories = async () => {
    try {
      // Fetch all categories with their parent main category names using JOINs
      const { data: categoriesData, error: categoriesError } = await supabase
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
      
      if (!categoriesError && categoriesData) {
        setAllCategories(categoriesData);
        return categoriesData;
      } else {
        console.error('❌ Error fetching categories:', categoriesError);
        return [];
      }
    } catch (error) {
      console.error('❌ Error fetching categories:', error);
      return [];
    }
  };

  const fetchSources = async () => {
    try {
      // Fetch all sources
      const { data: sourcesData, error: sourcesError } = await supabase
        .from('misc_leadsource')
        .select('id, name')
        .order('name', { ascending: true });
      
      if (!sourcesError && sourcesData) {
        setAllSources(sourcesData);
        return sourcesData;
      } else {
        console.error('❌ Error fetching sources:', sourcesError);
        return [];
      }
    } catch (error) {
      console.error('❌ Error fetching sources:', error);
      return [];
    }
  };

  const fetchStages = async () => {
    try {
      // Fetch all stages
      const { data: stagesData, error: stagesError } = await supabase
        .from('lead_stages')
        .select('id, name')
        .order('name', { ascending: true });
      
      if (!stagesError && stagesData) {
        setAllStages(stagesData);
        return stagesData;
      } else {
        console.error('❌ Error fetching stages:', stagesError);
        return [];
      }
    } catch (error) {
      console.error('❌ Error fetching stages:', error);
      return [];
    }
  };

  const fetchTags = async () => {
    try {
      // Fetch all active tags
      const { data: tagsData, error: tagsError } = await supabase
        .from('misc_leadtag')
        .select('id, name, order')
        .eq('active', true)
        .order('order', { ascending: true });
      
      if (!tagsError && tagsData) {
        setAllTags(tagsData);
        // Also populate the tags list for the input field
        const tagNames = tagsData.map(tag => tag.name);
        setTagsList(tagNames);
        return tagsData;
      } else {
        console.error('❌ Error fetching tags:', tagsError);
        return [];
      }
    } catch (error) {
      console.error('❌ Error fetching tags:', error);
      return [];
    }
  };

  const fetchCountries = async () => {
    try {
      // Fetch all countries with timezone
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

  const getCategoryName = (categoryId: string | number | null | undefined, fallbackCategory?: string | number, categoriesData?: any[]) => {
    const categories = categoriesData || allCategories;
    if (!categoryId || categoryId === '---' || categoryId === '--') {
      // If no category_id but we have a fallback category, try to find it in the loaded categories
      if (fallbackCategory && String(fallbackCategory).trim() !== '') {
        // Try to find the fallback category in the loaded categories
        // First try by ID if fallbackCategory is a number
        let foundCategory = null;
        if (typeof fallbackCategory === 'number') {
          foundCategory = categories.find((cat: any) => 
            cat.id.toString() === fallbackCategory.toString()
          );
        }
        
        // If not found by ID, try by name
        if (!foundCategory) {
          foundCategory = categories.find((cat: any) => 
            cat.name.toLowerCase().trim() === String(fallbackCategory).toLowerCase().trim()
          );
        }
        
        if (foundCategory) {
          // Return category name with main category in parentheses
          if (foundCategory.misc_maincategory?.name) {
            return `${foundCategory.name} (${foundCategory.misc_maincategory.name})`;
          } else {
            return foundCategory.name; // Fallback if no main category
          }
        } else {
          return String(fallbackCategory); // Use as-is if not found in loaded categories
        }
      }
      return '--';
    }
    
    // If categories is not loaded yet, return the original value
    if (!categories || categories.length === 0) {
      return String(categoryId);
    }
    
    // First try to find by ID
    const categoryById = categories.find((cat: any) => cat.id.toString() === categoryId.toString());
    if (categoryById) {
      // Return category name with main category in parentheses
      if (categoryById.misc_maincategory?.name) {
        return `${categoryById.name} (${categoryById.misc_maincategory.name})`;
      } else {
        return categoryById.name; // Fallback if no main category
      }
    }
    
    // If not found by ID, try to find by name (in case it's already a name)
    const categoryByName = categories.find((cat: any) => 
      cat.name.toLowerCase().trim() === String(categoryId).toLowerCase().trim()
    );
    if (categoryByName) {
      if (categoryByName.misc_maincategory?.name) {
        return `${categoryByName.name} (${categoryByName.misc_maincategory.name})`;
      } else {
        return categoryByName.name;
      }
    }
    
    return String(categoryId); // Fallback to original value
  };

  const getSourceName = (sourceId: string | number | null | undefined, fallbackSource?: string | number, sourcesData?: any[]) => {
    const sources = sourcesData || allSources;
    if (!sourceId || sourceId === '---' || sourceId === '--') {
      // If no source_id but we have a fallback source, try to find it in the loaded sources
      if (fallbackSource && String(fallbackSource).trim() !== '') {
        // Try to find the fallback source in the loaded sources
        // First try by ID if fallbackSource is a number
        let foundSource = null;
        if (typeof fallbackSource === 'number') {
          foundSource = sources.find((source: any) => 
            source.id.toString() === fallbackSource.toString()
          );
        }
        
        // If not found by ID, try by name
        if (!foundSource) {
          foundSource = sources.find((source: any) => 
            source.name.toLowerCase().trim() === String(fallbackSource).toLowerCase().trim()
          );
        }
        
        if (foundSource) {
          return foundSource.name;
        } else {
          return String(fallbackSource); // Use as-is if not found in loaded sources
        }
      }
      return '--';
    }
    
    // If sources is not loaded yet, return the original value
    if (!sources || sources.length === 0) {
      return String(sourceId);
    }
    
    // First try to find by ID
    const sourceById = sources.find((source: any) => source.id.toString() === sourceId.toString());
    if (sourceById) {
      return sourceById.name;
    }
    
    // If not found by ID, try to find by name (in case it's already a name)
    const sourceByName = sources.find((source: any) => 
      source.name.toLowerCase().trim() === String(sourceId).toLowerCase().trim()
    );
    if (sourceByName) {
      return sourceByName.name;
    }
    
    return String(sourceId); // Fallback to original value
  };

  const getStageName = (stageId: string | number | null | undefined, stagesData?: any[]) => {
    const stages = stagesData || allStages;
    if (!stageId || stageId === '---' || stageId === '--') {
      return '--';
    }
    
    // For new leads, stage is already text-based, so return as-is
    if (typeof stageId === 'string' && !stageId.match(/^\d+$/)) {
      return stageId;
    }
    
    // If stages is not loaded yet, return the original value
    if (!stages || stages.length === 0) {
      return String(stageId);
    }
    
    // For legacy leads with numeric stage IDs, map them to names
    const stageById = stages.find((stage: any) => stage.id.toString() === stageId.toString());
    if (stageById) {
      return stageById.name;
    }
    
    // If not found by ID, try to find by name (in case it's already a name)
    const stageByName = stages.find((stage: any) => 
      stage.name.toLowerCase().trim() === String(stageId).toLowerCase().trim()
    );
    if (stageByName) {
      return stageByName.name;
    }
    
    return String(stageId); // Fallback to original value
  };

  const getCountryName = (countryId: string | number | null | undefined, countriesData?: any[]) => {
    const countries = countriesData || allCountries;
    if (!countryId || countryId === '---' || countryId === '--') {
      return '--';
    }
    
    // If countries is not loaded yet, return the original value
    if (!countries || countries.length === 0) {
      return String(countryId);
    }
    
    // Try to find by ID
    const countryById = countries.find((country: any) => country.id.toString() === countryId.toString());
    if (countryById) {
      return countryById.name;
    }
    
    // If not found by ID, try to find by name (in case it's already a name)
    const countryByName = countries.find((country: any) => 
      country.name.toLowerCase().trim() === String(countryId).toLowerCase().trim()
    );
    if (countryByName) {
      return countryByName.name;
    }
    
    return String(countryId); // Fallback to original value
  };

  const getCountryTimezone = (countryId: string | number | null | undefined, countriesData?: any[]) => {
    const countries = countriesData || allCountries;
    if (!countryId || countryId === '---' || countryId === '--') {
      return null;
    }
    
    if (!countries || countries.length === 0) {
      return null;
    }
    
    // Try to find by ID
    const countryById = countries.find((country: any) => country.id.toString() === countryId.toString());
    if (countryById && countryById.timezone) {
      return countryById.timezone;
    }
    
    // If not found by ID, try to find by name
    const countryByName = countries.find((country: any) => 
      country.name.toLowerCase().trim() === String(countryId).toLowerCase().trim()
    );
    if (countryByName && countryByName.timezone) {
      return countryByName.timezone;
    }
    
    return null;
  };

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

  const fetchSchedulerLeads = async (categoriesData?: any[], sourcesData?: any[], stagesData?: any[], userData?: any, countriesData?: any[]) => {
    try {
      setLoading(true);
      setError(null);

      // Validate that we have user data and employee_id
      if (!userData?.employee_id) {
        console.error('❌ No user data or employee_id available');
        setError('User data not available');
        setLoading(false);
        return;
      }

      // First, get the employee's display name for filtering new leads
      let employeeDisplayName = null;
      if (userData?.employee_id) {
        const { data: employeeData, error: employeeError } = await supabase
          .from('tenants_employee')
          .select('display_name')
          .eq('id', userData.employee_id)
          .single();
        
        if (!employeeError && employeeData) {
          employeeDisplayName = employeeData.display_name;
        } else {
          console.error('❌ Could not find employee display name for ID:', userData.employee_id);
        }
      }

      // Fetch new leads with scheduler assigned to current user (by name) and specific stages
      const { data: newLeads, error: newError } = await supabase
        .from('leads')
        .select(`
          id,
          lead_number,
          name,
          created_at,
          latest_interaction,
          stage,
          language,
          source,
          source_id,
          category,
          category_id,
          topic,
          balance,
          balance_currency,
          scheduler,
          phone,
          mobile,
          email,
          facts,
          special_notes,
          general_notes,
          probability,
          number_of_applicants_meeting,
          potential_applicants_meeting,
          next_followup,
          eligible,
          country_id,
          misc_country!country_id (
            id,
            name
          )
        `)
        .eq('scheduler', employeeDisplayName) // Filter by current user's display name
        .or('stage.in.(0,10,11,15),stage.in.(created,scheduler_assigned,handler_started,success)'); // Handle both numeric IDs and text values

      if (newError) {
        console.error('Error fetching new leads:', newError);
        throw newError;
      }


      // Fetch legacy leads with scheduler assigned to current user and specific stages

      const { data: legacyLeads, error: legacyError } = await supabase
        .from('leads_lead')
        .select(`
          id,
          name,
          cdate,
          latest_interaction,
          stage,
          language_id,
          source_id,
          category,
          category_id,
          topic,
          total,
          currency_id,
          meeting_scheduler_id,
          phone,
          email,
          description,
          special_notes,
          notes,
          probability,
          next_followup,
          eligibile
        `)
        .eq('meeting_scheduler_id', String(userData.employee_id)) // Filter by current user's employee ID (ensure string)
        .in('stage', [0, 10, 11, 15]); // Only show leads with stages 0, 10, 11, 15

      if (legacyError) {
        console.error('❌ Error fetching legacy leads:', legacyError);
        throw legacyError;
      }



      // Fetch language mappings for legacy leads
      const { data: languageMapping } = await supabase
        .from('misc_language')
        .select('id, name');

      const languageMap = new Map();
      if (languageMapping) {
        languageMapping.forEach(language => {
          languageMap.set(language.id, language.name);
        });
      }

      // Fetch tags for legacy leads
      const legacyLeadIds = legacyLeads?.map(lead => lead.id) || [];
      let legacyTagsMap = new Map();
      
      if (legacyLeadIds.length > 0) {
        const { data: legacyTagsData } = await supabase
          .from('leads_lead_tags')
          .select(`
            lead_id,
            misc_leadtag (
              name
            )
          `)
          .in('lead_id', legacyLeadIds);
        
        if (legacyTagsData) {
          legacyTagsData.forEach(item => {
            if (item.misc_leadtag) {
              const leadId = item.lead_id;
              const tagName = (item.misc_leadtag as any).name;
              
              if (!legacyTagsMap.has(leadId)) {
                legacyTagsMap.set(leadId, []);
              }
              legacyTagsMap.get(leadId).push(tagName);
            }
          });
        }
      }

      // Fetch tags for new leads
      const newLeadIds = newLeads?.map(lead => lead.id) || [];
      let newTagsMap = new Map();
      
      if (newLeadIds.length > 0) {
        const { data: newTagsData } = await supabase
          .from('leads_lead_tags')
          .select(`
            newlead_id,
            misc_leadtag (
              name
            )
          `)
          .in('newlead_id', newLeadIds);
        
        if (newTagsData) {
          newTagsData.forEach(item => {
            if (item.misc_leadtag) {
              const leadId = item.newlead_id;
              const tagName = (item.misc_leadtag as any).name;
              
              if (!newTagsMap.has(leadId)) {
                newTagsMap.set(leadId, []);
              }
              newTagsMap.get(leadId).push(tagName);
            }
          });
        }
      }

      // Country data for new leads is now fetched directly from the leads table with the JOIN
      // For legacy leads, we'll keep the existing contact-based approach since they don't have country_id directly
      let legacyCountryMap = new Map();
      
      if (legacyLeadIds.length > 0) {
        try {
          // Query for country data via lead_leadcontact -> leads_contact -> misc_country
          const { data: legacyCountryData, error: legacyCountryError } = await supabase
            .from('lead_leadcontact')
            .select(`
              lead_id,
              leads_contact (
                country_id,
                misc_country (
                  id,
                  name
                )
              )
            `)
            .in('lead_id', legacyLeadIds)
            .eq('main', 'true'); // Only get main contacts
          
          if (legacyCountryError) {
            console.error('Error fetching country data for legacy leads:', legacyCountryError);
          } else if (legacyCountryData && legacyCountryData.length > 0) {
            legacyCountryData.forEach((item) => {
              if (item.leads_contact && (item.leads_contact as any).misc_country) {
                const leadId = item.lead_id;
                const countryName = ((item.leads_contact as any).misc_country as any).name;
                legacyCountryMap.set(leadId, countryName);
              }
            });
          } else {
            // Try without the main filter to get all contacts
            const allContactsResult = await supabase
              .from('lead_leadcontact')
              .select(`
                lead_id,
                main,
                leads_contact (
                  country_id,
                  misc_country (
                    id,
                    name
                  )
                )
              `)
              .in('lead_id', legacyLeadIds);
            
            if (allContactsResult.data && allContactsResult.data.length > 0) {
              allContactsResult.data.forEach((item: any) => {
                if (item.leads_contact && (item.leads_contact as any).misc_country) {
                  const leadId = item.lead_id;
                  const countryName = ((item.leads_contact as any).misc_country as any).name;
                  legacyCountryMap.set(leadId, countryName);
                }
              });
            }
          }
        } catch (error) {
          console.error('Error fetching country data for legacy leads:', error);
        }
      }




      // Transform new leads - already filtered by user's employee ID
      const transformedNewLeads: SchedulerLead[] = (newLeads || [])
        .filter(lead => {
          // Show only leads that are NOT eligible (false, null, undefined)
          // Hide leads that are explicitly set to true (eligible)
          return lead.eligible !== true;
        })
        .map(lead => {
          const stageName = getStageName(lead.stage, stagesData);
          const sourceName = getSourceName(lead.source_id, lead.source, sourcesData);
          const categoryName = getCategoryName(lead.category_id, lead.category, categoriesData);
          
          
          return {
            id: lead.id,
            lead_number: lead.lead_number || '',
            name: lead.name || '',
            created_at: lead.created_at || '',
            latest_interaction: lead.latest_interaction || '',
            stage: stageName || '',
            language: lead.language || '',
            source: sourceName || '',
            category: categoryName || '',
            topic: lead.topic || '',
            total: lead.balance || '',
            balance_currency: lead.balance_currency || '₪',
            lead_type: 'new' as const,
            phone: lead.phone || '',
            mobile: lead.mobile || '',
            email: lead.email || '',
            facts: lead.facts || '',
            special_notes: lead.special_notes || '',
            general_notes: lead.general_notes || '',
            tags: newTagsMap.get(lead.id)?.join(', ') || '', // Get tags from newTagsMap
            probability: lead.probability || 0,
            number_of_applicants_meeting: lead.number_of_applicants_meeting || '',
            potential_applicants_meeting: lead.potential_applicants_meeting || '',
            next_followup: lead.next_followup || '',
            eligible: lead.eligible !== false, // Convert to boolean, default to true if null/undefined
            country: (lead as any).misc_country?.name || '' // Get country directly from the JOIN
          };
        });


      // Transform legacy leads - already filtered by user's employee ID
      const transformedLegacyLeads: SchedulerLead[] = (legacyLeads || [])
        .filter(lead => {
          // For legacy leads, eligible is text field - show only leads that are NOT eligible
          // Hide leads that are explicitly set to 'yes' or 'true'
          // Show leads that are 'no', 'false', null, undefined, or empty
          // Note: column name is 'eligibile' (with extra 'i')
          const eligibleValue = (lead as any).eligibile?.toLowerCase();
          return eligibleValue !== 'yes' && eligibleValue !== 'true';
        })
        .map(lead => {
          const stageName = getStageName(lead.stage, stagesData);
          const sourceName = getSourceName(lead.source_id, undefined, sourcesData);
          const categoryName = getCategoryName(lead.category_id, lead.category, categoriesData);
          
          
          return {
            id: `legacy_${lead.id}`,
            lead_number: String(lead.id),
            name: lead.name || '',
            created_at: lead.cdate || '',
            latest_interaction: lead.latest_interaction || '',
            stage: stageName || '',
            language: languageMap.get(lead.language_id) || '',
            source: sourceName || '',
            category: categoryName || '',
            topic: lead.topic || '',
            total: lead.total || '',
            balance_currency: (() => {
              // Fallback currency mapping based on currency_id
              switch (lead.currency_id) {
                case 1: return '₪';
                case 2: return '€';
                case 3: return '$';
                case 4: return '£';
                default: return '₪';
              }
            })(),
            lead_type: 'legacy' as const,
            phone: lead.phone || '',
            mobile: '', // Legacy leads don't have mobile field
            email: lead.email || '',
            facts: lead.description || '',
            special_notes: lead.special_notes || '',
            general_notes: lead.notes || '',
            tags: legacyTagsMap.get(lead.id)?.join(', ') || '', // Get tags from legacyTagsMap
            probability: lead.probability || 0,
            number_of_applicants_meeting: '', // Legacy leads don't have this field
            potential_applicants_meeting: '', // Legacy leads don't have this field
            next_followup: lead.next_followup || '',
            eligible: (lead as any).eligibile?.toLowerCase() === 'yes' || (lead as any).eligibile?.toLowerCase() === 'true', // Convert text to boolean
            country: legacyCountryMap.get(lead.id) || '' // Get country from legacyCountryMap
          };
        });


      // Combine and sort by created date (newest first)
      const allLeads = [...transformedNewLeads, ...transformedLegacyLeads]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      setLeads(allLeads);

    } catch (error) {
      console.error('Error fetching scheduler leads:', error);
      setError('Failed to load scheduler leads');
      toast.error('Failed to load scheduler leads');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return 'N/A';
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch {
      return 'Invalid Date';
    }
  };

  const formatCurrency = (amount: string, currency: string) => {
    if (!amount || amount === '0') return '₪0';
    try {
      const numAmount = parseFloat(amount);
      if (isNaN(numAmount)) return `${currency}0`;
      return `${currency}${numAmount.toLocaleString()}`;
    } catch {
      return `${currency}0`;
    }
  };

  const handleCall = (lead: SchedulerLead) => {
    const phoneNumber = lead.phone || lead.mobile;
    if (phoneNumber) {
      window.open(`tel:${phoneNumber}`, '_self');
    } else {
      toast.error('No phone number available for this lead');
    }
  };

  const handleViewClient = (lead: SchedulerLead) => {
    // Navigate to the client page using the lead number
    navigate(`/clients/${lead.lead_number}`);
  };

  const handleEmail = (lead: SchedulerLead) => {
    setSelectedLead(lead);
    setIsEmailModalOpen(true);
  };

  const handleWhatsApp = (lead: SchedulerLead) => {
    setSelectedLead(lead);
    setIsWhatsAppModalOpen(true);
  };

  const handleTimeline = (lead: SchedulerLead) => {
    // Navigate to the client page with the InteractionsTab
    navigate(`/clients/${lead.lead_number}?tab=interactions`);
  };

  const handleClientUpdate = async () => {
    // Refresh the leads data when a client is updated
    await fetchSchedulerLeads(allCategories, allSources, allStages, currentUser);
  };

  // Toggle eligible status
  const handleToggleEligible = async (lead: SchedulerLead) => {
    const newEligibleStatus = !lead.eligible;
    const actionText = newEligibleStatus ? 'make eligible' : 'make ineligible';
    
    // Show confirmation alert
    if (!window.confirm(`Are you sure you want to ${actionText} this lead? ${newEligibleStatus ? 'This lead will be removed from the scheduler view.' : 'This lead will be shown in the scheduler view.'}`)) {
      return;
    }

    try {
      const isLegacyLead = lead.lead_type === 'legacy';
      const tableName = isLegacyLead ? 'leads_lead' : 'leads';
      const idField = isLegacyLead ? lead.id.replace('legacy_', '') : lead.id;
      
      // For legacy leads, convert boolean to text and use correct column name
      const updateData = isLegacyLead 
        ? { eligibile: (newEligibleStatus ? 'yes' : 'no') } // Note: column name is 'eligibile'
        : { eligible: newEligibleStatus };

      const { error } = await supabase
        .from(tableName)
        .update(updateData)
        .eq('id', idField);

      if (error) {
        console.error('Error updating eligible status:', error);
        toast.error('Failed to update eligible status');
        return;
      }

      // Update local state
      setLeads(prev => prev.map(l => 
        l.id === lead.id 
          ? { ...l, eligible: newEligibleStatus }
          : l
      ));

      toast.success(`Lead ${actionText.replace('make ', 'made ')} successfully`);
      
      // If made eligible, the lead will be filtered out on next refresh
      if (newEligibleStatus) {
        // Remove from current view immediately
        setLeads(prev => prev.filter(l => l.id !== lead.id));
      }
    } catch (error) {
      console.error('Error in handleToggleEligible:', error);
      toast.error('Failed to update eligible status');
    }
  };

  // Toggle row expansion
  const toggleRowExpansion = (leadId: string) => {
    setExpandedRows(prev => {
      const newSet = new Set(prev);
      if (newSet.has(leadId)) {
        newSet.delete(leadId);
      } else {
        newSet.add(leadId);
      }
      return newSet;
    });
  };

  // Toggle contact dropdown
  const toggleContactDropdown = (leadId: string) => {
    setOpenContactDropdown(prev => prev === leadId ? null : leadId);
  };

  // Toggle view mode
  const toggleViewMode = () => {
    setViewMode(prev => prev === 'table' ? 'box' : 'table');
  };

  // Edit functions
  const startEditing = (leadId: string, field: string, currentValue: string) => {
    setEditingField({ leadId, field });
    setEditValues(prev => ({ ...prev, [`${leadId}_${field}`]: currentValue }));
  };

  const cancelEditing = () => {
    setEditingField(null);
    setEditValues({});
  };

  const saveEdit = async (leadId: string, field: string) => {
    const value = editValues[`${leadId}_${field}`];
    if (!value) return;

    try {
      const lead = leads.find(l => l.id === leadId);
      if (!lead) return;

      // Determine which table to update based on lead type
      const tableName = lead.lead_type === 'new' ? 'leads' : 'leads_lead';
      const idField = lead.lead_type === 'new' ? 'id' : 'id';
      const fieldMapping = lead.lead_type === 'new' 
        ? { facts: 'facts', special_notes: 'special_notes', general_notes: 'general_notes' }
        : { facts: 'description', special_notes: 'special_notes', general_notes: 'notes' };

      const dbField = fieldMapping[field as keyof typeof fieldMapping];
      if (!dbField) return;

      const { error } = await supabase
        .from(tableName)
        .update({ [dbField]: value })
        .eq(idField, lead.lead_type === 'new' ? leadId : leadId.replace('legacy_', ''));

      if (error) {
        console.error('Error updating field:', error);
        toast.error('Failed to update field');
        return;
      }

      // Update local state
      setLeads(prev => prev.map(l => 
        l.id === leadId 
          ? { ...l, [field]: value }
          : l
      ));

      setEditingField(null);
      setEditValues({});
      toast.success('Field updated successfully');
    } catch (error) {
      console.error('Error saving edit:', error);
      toast.error('Failed to save changes');
    }
  };

  // Edit lead functionality
  const getCurrencySymbol = (currencyId: string | number | null | undefined, fallbackCurrency?: string) => {
    if (currencyId && currencies.length > 0) {
      const currency = currencies.find(c => c.id === String(currencyId));
      return currency ? currency.name : fallbackCurrency || '₪';
    }
    return fallbackCurrency || '₪';
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
          
          // Find tag IDs for the provided tag names
          const tagIds = tagNames
            .map(tagName => allTags.find(tag => tag.name === tagName)?.id)
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
              console.error('❌ Error inserting new tags (legacy):', insertError);
              return;
            }
          }
        }
        
      } else {
        // For new leads, use the newlead_id column
        // First, remove all existing tags for this new lead
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
          
          // Find tag IDs for the provided tag names
          const tagIds = tagNames
            .map(tagName => allTags.find(tag => tag.name === tagName)?.id)
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
              console.error('❌ Error inserting new tags (new):', insertError);
              return;
            }
          }
        }
        
      }
    } catch (error) {
      console.error('❌ Error saving tags:', error);
    }
  };


  const openEditLeadDrawer = async (lead: SchedulerLead) => {
    // Get the correct currency for this lead
    const currentCurrency = getCurrencySymbol(
      lead.balance_currency,
      lead.balance_currency
    );
    
    // Reset the edit form data with current lead data
    setEditLeadData({
      tags: lead.tags || '',
      source: lead.source || '',
      name: lead.name || '',
      language: lead.language || '',
      category: lead.category || '',
      topic: lead.topic || '',
      probability: lead.probability || 0,
      number_of_applicants_meeting: lead.number_of_applicants_meeting || '',
      potential_applicants_meeting: lead.potential_applicants_meeting || '',
      balance: lead.total || '',
      next_followup: lead.next_followup || '',
      balance_currency: currentCurrency,
      eligible: lead.eligible !== false,
    });
    
    // Fetch current lead's tags
    await fetchCurrentLeadTags(lead.id);
    
    setShowEditLeadDrawer(true);
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
            new Date().toISOString().split('T')[0] : editLeadData.next_followup;
          updateData.next_followup = followupValue;
        }
        if (editLeadData.balance !== selectedLead.total) {
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
            updateData.category = foundCategory.name;
          } else {
            const categoryName = editLeadData.category.includes(' (') ? editLeadData.category.split(' (')[0] : editLeadData.category;
            const fallbackCategory = allCategories.find((cat: any) => 
              cat.name.toLowerCase().trim() === categoryName.toLowerCase().trim()
            );
            
            if (fallbackCategory) {
              updateData.category_id = fallbackCategory.id;
              updateData.category = categoryName;
            } else {
              updateData.category = editLeadData.category;
            }
          }
        }
        if (editLeadData.eligible !== selectedLead.eligible) {
          // For legacy leads, convert boolean to text and use correct column name
          updateData.eligibile = editLeadData.eligible ? 'yes' : 'no';
        }
      } else {
        // For regular leads, check each field and only include if it has changed
        if (editLeadData.tags !== selectedLead.tags) {
          updateData.tags = editLeadData.tags;
        }
        if (editLeadData.source !== selectedLead.source) {
          updateData.source = editLeadData.source;
        }
        if (editLeadData.name !== selectedLead.name) {
          updateData.name = editLeadData.name;
        }
        if (editLeadData.language !== selectedLead.language) {
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
              updateData.category = categoryName;
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
        if (editLeadData.number_of_applicants_meeting !== selectedLead.number_of_applicants_meeting) {
          let applicantsValue = null;
          if (editLeadData.number_of_applicants_meeting !== '' && editLeadData.number_of_applicants_meeting !== null && editLeadData.number_of_applicants_meeting !== undefined) {
            const parsed = Number(editLeadData.number_of_applicants_meeting);
            applicantsValue = isNaN(parsed) ? null : parsed;
          }
          updateData.number_of_applicants_meeting = applicantsValue;
        }
        if (editLeadData.potential_applicants_meeting !== selectedLead.potential_applicants_meeting) {
          let potentialValue = null;
          if (editLeadData.potential_applicants_meeting !== '' && editLeadData.potential_applicants_meeting !== null && editLeadData.potential_applicants_meeting !== undefined) {
            const parsed = Number(editLeadData.potential_applicants_meeting);
            potentialValue = isNaN(parsed) ? null : parsed;
          }
          updateData.potential_applicants_meeting = potentialValue;
        }
        if (editLeadData.balance !== selectedLead.total) {
          let balanceValue = null;
          if (editLeadData.balance !== '' && editLeadData.balance !== null && editLeadData.balance !== undefined) {
            const parsed = Number(editLeadData.balance);
            balanceValue = isNaN(parsed) ? null : parsed;
          }
          updateData.balance = balanceValue;
        }
        if (editLeadData.next_followup !== selectedLead.next_followup) {
          const followupValue = editLeadData.next_followup === '' || editLeadData.next_followup === null ? 
            new Date().toISOString().split('T')[0] : editLeadData.next_followup;
          updateData.next_followup = followupValue;
        }
        if (editLeadData.balance_currency !== selectedLead.balance_currency) {
          updateData.balance_currency = editLeadData.balance_currency;
        }
        if (editLeadData.eligible !== selectedLead.eligible) {
          updateData.eligible = editLeadData.eligible;
        }
      }
      
      // Save tags if they were changed (regardless of other field changes)
      if (currentLeadTags !== (selectedLead?.tags || '')) {
        await saveLeadTags(selectedLead.id, currentLeadTags);
      }
      
      // If no changes were detected in other fields, don't proceed with the update
      if (Object.keys(updateData).length === 0) {
        setShowEditLeadDrawer(false);
        await fetchSchedulerLeads(allCategories, allSources, allStages, currentUser);
        toast.success('Lead updated!');
        return;
      }
      
      let updateError;
      
      if (isLegacyLead) {
        // For legacy leads, update the leads_lead table
        const legacyId = selectedLead.id.toString().replace('legacy_', '');
        
        const { error } = await supabase
          .from('leads_lead')
          .update(updateData)
          .eq('id', legacyId);
        
        updateError = error;
      } else {
        // For regular leads, update the leads table
        
        const { error } = await supabase
          .from('leads')
          .update(updateData)
          .eq('id', selectedLead.id);
        
        updateError = error;
      }
        
      if (updateError) {
        console.error('Error updating lead:', updateError);
        toast.error('Failed to update lead.');
        return;
      }
      
      // Log the changes to lead_changes table (only for regular leads)
      if (!isLegacyLead) {
        const changesToInsert = [];
        const fieldsToTrack = Object.keys(updateData);
        
        for (const field of fieldsToTrack) {
          const oldValue = selectedLead[field as keyof typeof selectedLead] || '';
          const newValue = updateData[field as keyof typeof updateData] || '';
          
          changesToInsert.push({
            lead_id: selectedLead.id,
            field_name: field,
            old_value: String(oldValue),
            new_value: String(newValue),
            changed_by: currentUserName,
            changed_at: new Date().toISOString()
          });
        }
        
        if (changesToInsert.length > 0) {
          const { error: historyError } = await supabase
            .from('lead_changes')
            .insert(changesToInsert);
          
          if (historyError) {
            console.error('Error logging lead changes:', historyError);
          }
        }
      }
      
      setShowEditLeadDrawer(false);
      await fetchSchedulerLeads(allCategories, allSources, allStages, currentUser);
      toast.success('Lead updated!');
      
    } catch (error) {
      console.error('Error in handleSaveEditLead:', error);
      toast.error('Failed to update lead.');
    }
  };

  // Get unique values from current leads for filter dropdowns
  const getUniqueValues = (field: keyof SchedulerLead) => {
    const values = leads.map(lead => lead[field]).filter((value, index, self) => 
      value && value.toString().trim() !== '' && self.indexOf(value) === index
    );
    return values.map(v => v?.toString() || '').filter(v => v !== '').sort();
  };

  // Apply filters, search, and sorting to leads
  const applyFilters = () => {
    let filtered = leads;

    // Apply search filter
    if (searchTerm.trim()) {
      const searchLower = searchTerm.toLowerCase().trim();
      filtered = filtered.filter(lead => {
        return (
          lead.lead_number.toLowerCase().includes(searchLower) ||
          lead.name.toLowerCase().includes(searchLower) ||
          (lead.phone && lead.phone.toLowerCase().includes(searchLower)) ||
          (lead.mobile && lead.mobile.toLowerCase().includes(searchLower)) ||
          (lead.email && lead.email.toLowerCase().includes(searchLower))
        );
      });
    }

    // Apply date filter
    if (dateFrom || dateTo) {
      filtered = filtered.filter(lead => {
        const leadDate = new Date(lead.created_at);
        const fromDate = dateFrom ? new Date(dateFrom) : null;
        const toDate = dateTo ? new Date(dateTo) : null;
        
        if (fromDate && toDate) {
          return leadDate >= fromDate && leadDate <= toDate;
        } else if (fromDate) {
          return leadDate >= fromDate;
        } else if (toDate) {
          return leadDate <= toDate;
        }
        return true;
      });
    }

    // Apply other filters
    if (filters.stage) {
      filtered = filtered.filter(lead => 
        lead.stage.toLowerCase().includes(filters.stage.toLowerCase())
      );
    }
    if (filters.language) {
      filtered = filtered.filter(lead => 
        lead.language.toLowerCase().includes(filters.language.toLowerCase())
      );
    }
    if (filters.source) {
      filtered = filtered.filter(lead => 
        lead.source.toLowerCase().includes(filters.source.toLowerCase())
      );
    }
    if (filters.category) {
      filtered = filtered.filter(lead => 
        lead.category.toLowerCase().includes(filters.category.toLowerCase())
      );
    }
    if (filters.topic) {
      filtered = filtered.filter(lead => 
        lead.topic.toLowerCase().includes(filters.topic.toLowerCase())
      );
    }
    if (filters.tags) {
      filtered = filtered.filter(lead => 
        lead.tags && lead.tags.toLowerCase().includes(filters.tags.toLowerCase())
      );
    }
    if (filters.country) {
      filtered = filtered.filter(lead => 
        lead.country && lead.country.toLowerCase().includes(filters.country.toLowerCase())
      );
    }

    // Apply sorting
    if (sortConfig.key && sortConfig.direction) {
      filtered.sort((a, b) => {
        let aValue: any;
        let bValue: any;

        switch (sortConfig.key) {
          case 'created_at':
            aValue = new Date(a.created_at).getTime();
            bValue = new Date(b.created_at).getTime();
            break;
          case 'latest_interaction':
            aValue = a.latest_interaction ? new Date(a.latest_interaction).getTime() : 0;
            bValue = b.latest_interaction ? new Date(b.latest_interaction).getTime() : 0;
            break;
          case 'total':
            // Extract numeric value from total string
            const aTotalStr = String(a.total || '');
            const bTotalStr = String(b.total || '');
            aValue = parseFloat(aTotalStr.replace(/[^\d.-]/g, '')) || 0;
            bValue = parseFloat(bTotalStr.replace(/[^\d.-]/g, '')) || 0;
            break;
          case 'next_followup':
            aValue = a.next_followup ? new Date(a.next_followup).getTime() : 0;
            bValue = b.next_followup ? new Date(b.next_followup).getTime() : 0;
            break;
          default:
            return 0;
        }

        if (aValue < bValue) {
          return sortConfig.direction === 'asc' ? -1 : 1;
        }
        if (aValue > bValue) {
          return sortConfig.direction === 'asc' ? 1 : -1;
        }
        return 0;
      });
    }

    setFilteredLeads(filtered);
  };

  // Clear all filters and search
  const clearFilters = () => {
    setFilters({
      stage: '',
      language: '',
      source: '',
      category: '',
      topic: '',
      tags: '',
      country: ''
    });
    setSearchTerm('');
    setFilteredLeads(leads);
  };

  // Update filter and apply
  const updateFilter = (field: keyof typeof filters, value: string) => {
    setFilters(prev => ({ ...prev, [field]: value }));
  };

  // Sorting functions
  const handleSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const getSortIcon = (columnKey: string) => {
    if (sortConfig.key !== columnKey) {
      return <ChevronUpDownIcon className="w-4 h-4 text-gray-400" />;
    }
    return sortConfig.direction === 'asc' 
      ? <ChevronUpIcon className="w-4 h-4 text-gray-600" />
      : <ChevronDownIcon className="w-4 h-4 text-gray-600" />;
  };

  // Badge logic for follow up date
  const getFollowUpBadgeStyle = (followUpDate: string) => {
    if (!followUpDate) {
      return {
        className: "badge badge-neutral text-white text-xs",
        text: "No follow up"
      };
    }

    const followUp = new Date(followUpDate);
    const now = new Date();
    const diffInDays = Math.floor((followUp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (diffInDays < 0) { // Overdue
      return {
        className: "badge badge-error text-white text-xs",
        text: formatDate(followUpDate)
      };
    } else if (diffInDays <= 7) { // Due within 1 week
      return {
        className: "badge badge-info text-white text-xs",
        text: formatDate(followUpDate)
      };
    } else {
      return {
        className: "badge badge-success text-white text-xs",
        text: formatDate(followUpDate)
      };
    }
  };

  // Apply filters, search, and sorting when leads, filters, search term, date filters, or sort config change
  useEffect(() => {
    applyFilters();
  }, [leads, filters, searchTerm, dateFrom, dateTo, sortConfig]);

  // Set default view mode based on screen size
  useEffect(() => {
    const checkScreenSize = () => {
      if (window.innerWidth < 768) { // Mobile
        setViewMode('box');
      } else { // Desktop
        setViewMode('table');
      }
    };

    // Set initial view mode
    checkScreenSize();

    // Listen for window resize
    window.addEventListener('resize', checkScreenSize);
    return () => window.removeEventListener('resize', checkScreenSize);
  }, []);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.filter-dropdown')) {
        setShowDropdowns({
          stage: false,
          language: false,
          source: false,
          category: false,
          topic: false,
          tags: false,
          country: false
        });
      }
      if (!target.closest('.contact-dropdown')) {
        setOpenContactDropdown(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  if (loading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center h-64">
          <div className="loading loading-spinner loading-lg"></div>
          <span className="ml-4 text-lg">Loading scheduler leads...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="alert alert-error">
          <span>{error}</span>
          <button 
            className="btn btn-sm btn-outline"
            onClick={() => fetchSchedulerLeads(allCategories, allSources, allStages, currentUser)}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold text-gray-900">Hot Leads</h1>
            <div className="badge badge-primary badge-lg">
              {filteredLeads.length === leads.length && !searchTerm ? 
                leads.length : 
                filteredLeads.length
              }
            </div>
          </div>
          
          {/* View Toggle */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600 hidden sm:inline">View:</span>
            <div className="btn-group">
              <button
                onClick={() => setViewMode('box')}
                className={`btn btn-sm ${viewMode === 'box' ? 'btn-primary' : 'btn-outline'}`}
                title="Box View"
              >
                <Squares2X2Icon className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('table')}
                className={`btn btn-sm ${viewMode === 'table' ? 'btn-primary' : 'btn-outline'}`}
                title="Table View"
              >
                <TableCellsIcon className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Search Bar */}
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <div className="relative max-w-md flex-1">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <input
              type="text"
              placeholder="Search by lead number, name, phone, or email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="input input-bordered w-full pl-10 pr-4"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute inset-y-0 right-0 pr-3 flex items-center"
              >
                <XMarkIcon className="h-5 w-5 text-gray-400 hover:text-gray-600" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
          {/* Stage Filter */}
          <div className="relative filter-dropdown">
            <label className="block text-sm font-medium text-gray-700 mb-1">Stage</label>
            <div className="relative">
              <input
                type="text"
                placeholder="Filter by stage..."
                value={filters.stage}
                onChange={(e) => updateFilter('stage', e.target.value)}
                onFocus={() => setShowDropdowns(prev => ({ ...prev, stage: true }))}
                className="input input-bordered w-full pr-8"
              />
              <ChevronDownIcon className="absolute right-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              {showDropdowns.stage && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-48 overflow-y-auto">
                  {getUniqueValues('stage').map((stage) => (
                    <div
                      key={stage}
                      className="px-3 py-2 hover:bg-gray-100 cursor-pointer text-sm"
                      onClick={() => {
                        updateFilter('stage', stage);
                        setShowDropdowns(prev => ({ ...prev, stage: false }));
                      }}
                    >
                      {stage.replace(/_/g, ' ')}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Language Filter */}
          <div className="relative filter-dropdown">
            <label className="block text-sm font-medium text-gray-700 mb-1">Language</label>
            <div className="relative">
              <input
                type="text"
                placeholder="Filter by language..."
                value={filters.language}
                onChange={(e) => updateFilter('language', e.target.value)}
                onFocus={() => setShowDropdowns(prev => ({ ...prev, language: true }))}
                className="input input-bordered w-full pr-8"
              />
              <ChevronDownIcon className="absolute right-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              {showDropdowns.language && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-48 overflow-y-auto">
                  {getUniqueValues('language').map((language) => (
                    <div
                      key={language}
                      className="px-3 py-2 hover:bg-gray-100 cursor-pointer text-sm"
                      onClick={() => {
                        updateFilter('language', language);
                        setShowDropdowns(prev => ({ ...prev, language: false }));
                      }}
                    >
                      {language}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Source Filter */}
          <div className="relative filter-dropdown">
            <label className="block text-sm font-medium text-gray-700 mb-1">Source</label>
            <div className="relative">
              <input
                type="text"
                placeholder="Filter by source..."
                value={filters.source}
                onChange={(e) => updateFilter('source', e.target.value)}
                onFocus={() => setShowDropdowns(prev => ({ ...prev, source: true }))}
                className="input input-bordered w-full pr-8"
              />
              <ChevronDownIcon className="absolute right-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              {showDropdowns.source && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-48 overflow-y-auto">
                  {getUniqueValues('source').map((source) => (
                    <div
                      key={source}
                      className="px-3 py-2 hover:bg-gray-100 cursor-pointer text-sm"
                      onClick={() => {
                        updateFilter('source', source);
                        setShowDropdowns(prev => ({ ...prev, source: false }));
                      }}
                    >
                      {source}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Category Filter */}
          <div className="relative filter-dropdown">
            <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
            <div className="relative">
              <input
                type="text"
                placeholder="Filter by category..."
                value={filters.category}
                onChange={(e) => updateFilter('category', e.target.value)}
                onFocus={() => setShowDropdowns(prev => ({ ...prev, category: true }))}
                className="input input-bordered w-full pr-8"
              />
              <ChevronDownIcon className="absolute right-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              {showDropdowns.category && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-48 overflow-y-auto">
                  {getUniqueValues('category').map((category) => (
                    <div
                      key={category}
                      className="px-3 py-2 hover:bg-gray-100 cursor-pointer text-sm"
                      onClick={() => {
                        updateFilter('category', category);
                        setShowDropdowns(prev => ({ ...prev, category: false }));
                      }}
                    >
                      {category}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Topic Filter */}
          <div className="relative filter-dropdown">
            <label className="block text-sm font-medium text-gray-700 mb-1">Topic</label>
            <div className="relative">
              <input
                type="text"
                placeholder="Filter by topic..."
                value={filters.topic}
                onChange={(e) => updateFilter('topic', e.target.value)}
                onFocus={() => setShowDropdowns(prev => ({ ...prev, topic: true }))}
                className="input input-bordered w-full pr-8"
              />
              <ChevronDownIcon className="absolute right-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              {showDropdowns.topic && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-48 overflow-y-auto">
                  {getUniqueValues('topic').map((topic) => (
                    <div
                      key={topic}
                      className="px-3 py-2 hover:bg-gray-100 cursor-pointer text-sm"
                      onClick={() => {
                        updateFilter('topic', topic);
                        setShowDropdowns(prev => ({ ...prev, topic: false }));
                      }}
                    >
                      {topic}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Tags Filter */}
          <div className="relative filter-dropdown">
            <label className="block text-sm font-medium text-gray-700 mb-1">Tags</label>
            <div className="relative">
              <input
                type="text"
                placeholder="Filter by tags..."
                value={filters.tags}
                onChange={(e) => updateFilter('tags', e.target.value)}
                onFocus={() => setShowDropdowns(prev => ({ ...prev, tags: true }))}
                className="input input-bordered w-full pr-8"
              />
              <ChevronDownIcon className="absolute right-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              {showDropdowns.tags && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-48 overflow-y-auto">
                  {getUniqueValues('tags').map((tag) => (
                    <div
                      key={tag}
                      className="px-3 py-2 hover:bg-gray-100 cursor-pointer text-sm"
                      onClick={() => {
                        updateFilter('tags', tag);
                        setShowDropdowns(prev => ({ ...prev, tags: false }));
                      }}
                    >
                      {tag}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Country Filter */}
          <div className="relative filter-dropdown">
            <label className="block text-sm font-medium text-gray-700 mb-1">Country</label>
            <div className="relative">
              <input
                type="text"
                placeholder="Filter by country..."
                value={filters.country}
                onChange={(e) => updateFilter('country', e.target.value)}
                onFocus={() => setShowDropdowns(prev => ({ ...prev, country: true }))}
                className="input input-bordered w-full pr-8"
              />
              <ChevronDownIcon className="absolute right-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              {showDropdowns.country && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-48 overflow-y-auto">
                  {getUniqueValues('country').map((country) => (
                    <div
                      key={country}
                      className="px-3 py-2 hover:bg-gray-100 cursor-pointer text-sm"
                      onClick={() => {
                        updateFilter('country', country);
                        setShowDropdowns(prev => ({ ...prev, country: false }));
                      }}
                    >
                      {country}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Date Filters and Clear Button */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700 whitespace-nowrap">From:</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="input input-bordered input-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700 whitespace-nowrap">To:</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="input input-bordered input-sm"
              />
            </div>
            <button 
              className="btn btn-outline btn-sm"
              onClick={() => {
                clearFilters();
                setDateFrom('');
                setDateTo('');
              }}
              disabled={Object.values(filters).every(f => f === '') && !searchTerm && !dateFrom && !dateTo}
            >
              Clear Filters
            </button>
          </div>

        </div>
      </div>

      {leads.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-gray-500 text-lg">
            No leads found on page
          </div>
          <p className="text-gray-400 mt-2">
            All leads are either not assigned to a scheduler or have progressed beyond the scheduler stage
          </p>
        </div>
      ) : viewMode === 'box' ? (
        // Box View
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredLeads.map((lead) => (
            <div key={lead.id} className={`bg-white rounded-2xl shadow-md hover:shadow-xl transition-all duration-200 transform hover:-translate-y-1 border border-gray-100 group flex flex-col justify-between h-full min-h-[400px] relative pb-16 md:text-lg md:leading-relaxed p-5 ${openContactDropdown === lead.id ? 'z-[60] md:z-auto' : ''}`}>
              {/* Header */}
              <div onClick={() => toggleRowExpansion(lead.id)} className="flex-1 cursor-pointer flex flex-col">
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-xs md:text-base font-semibold text-gray-400 tracking-widest whitespace-nowrap">
                    #{lead.lead_number}
                  </span>
                  <span className="w-1 h-1 bg-gray-300 rounded-full flex-shrink-0"></span>
                  <h3 className="text-lg md:text-2xl font-extrabold text-gray-900 group-hover:text-primary transition-colors truncate flex-1 min-w-0">
                    {lead.name || 'No Name'}
                  </h3>
                  <span className={`badge badge-sm ${getFollowUpBadgeStyle(lead.next_followup || '').className} whitespace-nowrap flex-shrink-0`}>
                    {getFollowUpBadgeStyle(lead.next_followup || '').text}
                  </span>
                </div>

                {/* Stage */}
                <div className="flex justify-between items-center py-1">
                  <span className="text-xs md:text-base font-semibold text-gray-500">Stage</span>
                  <span className="text-sm md:text-lg font-bold text-gray-800 ml-2 whitespace-nowrap">
                    {lead.stage ? lead.stage.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) : 'Unknown'}
                  </span>
                </div>

                <div className="space-y-2 divide-y divide-gray-100">
                  {/* Created Date */}
                  <div className="flex justify-between items-center py-1">
                    <span className="text-xs md:text-base font-semibold text-gray-500">Created</span>
                    <span className="text-sm md:text-lg font-bold text-gray-800 ml-2 whitespace-nowrap">{formatDate(lead.created_at)}</span>
                  </div>

                  {/* Language */}
                  <div className="flex justify-between items-center py-1">
                    <span className="text-xs md:text-base font-semibold text-gray-500">Language</span>
                    <span className="text-sm md:text-lg font-bold text-gray-800 ml-2 whitespace-nowrap">{lead.language || 'N/A'}</span>
                  </div>

                  {/* Source */}
                  <div className="flex justify-between items-center py-1">
                    <span className="text-xs md:text-base font-semibold text-gray-500">Source</span>
                    <span className="text-sm md:text-lg font-bold text-gray-800 ml-2 text-right flex-1 min-w-0">
                      <span className="truncate block">{lead.source || 'N/A'}</span>
                    </span>
                  </div>

                  {/* Category */}
                  <div className="flex justify-between items-center py-1">
                    <span className="text-xs md:text-base font-semibold text-gray-500">Category</span>
                    <span className="text-sm md:text-lg font-bold text-gray-800 ml-2 text-right flex-1 min-w-0">
                      <span className="truncate block">{lead.category || 'N/A'}</span>
                    </span>
                  </div>

                  {/* Topic */}
                  <div className="flex justify-between items-center py-1">
                    <span className="text-xs md:text-base font-semibold text-gray-500">Topic</span>
                    <span className="text-sm md:text-lg font-bold text-gray-800 ml-2 text-right flex-1 min-w-0">
                      <span className="truncate block">{lead.topic || 'N/A'}</span>
                    </span>
                  </div>

                  {/* Country */}
                  <div className="flex justify-between items-center py-1">
                    <span className="text-xs md:text-base font-semibold text-gray-500">Country</span>
                    <div className="flex items-center gap-1 ml-2 text-right">
                      <span className="text-sm md:text-lg font-bold text-gray-800">{lead.country || 'N/A'}</span>
                      {lead.country && (() => {
                        const timezone = getCountryTimezone(lead.country, allCountries);
                        const businessInfo = getBusinessHoursInfo(timezone);
                        return timezone ? (
                          <div className={`w-3 h-3 rounded-full ${businessInfo.isBusinessHours ? 'bg-green-500' : 'bg-red-500'}`} 
                               title={`${businessInfo.localTime ? `Local time: ${businessInfo.localTime}` : 'Time unavailable'} - ${businessInfo.isBusinessHours ? 'Business hours' : 'Outside business hours'} (${timezone})`} />
                        ) : null;
                      })()}
                    </div>
                  </div>

                  {/* Total */}
                  <div className="flex justify-between items-center py-1">
                    <span className="text-xs md:text-base font-semibold text-gray-500">Value</span>
                    <span className="text-sm md:text-lg font-bold text-gray-800 ml-2 whitespace-nowrap">{formatCurrency(lead.total, lead.balance_currency)}</span>
                  </div>

                  {/* Tags */}
                  <div className="flex justify-between items-center py-1">
                    <span className="text-xs md:text-base font-semibold text-gray-500">Tags</span>
                    <span className="text-sm md:text-lg font-bold text-gray-800 ml-2 text-right flex-1 min-w-0">
                      <span className="truncate block">{lead.tags || 'N/A'}</span>
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="mt-4 flex flex-row gap-2 justify-between items-center">
                {/* Left side - Eligible Toggle and Contact */}
                <div className="flex items-center gap-2">
                  {/* Eligible Toggle */}
                  <input
                    type="checkbox"
                    className="toggle toggle-success toggle-sm"
                    checked={lead.eligible || false}
                    onChange={(e) => {
                      e.stopPropagation();
                      handleToggleEligible(lead);
                    }}
                    title="Eligible"
                  />
                  
                  {/* Contact Dropdown */}
                  <div className="relative contact-dropdown z-[60] md:z-auto">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleContactDropdown(lead.id);
                      }}
                      className="btn btn-outline btn-primary btn-sm"
                      title="Contact"
                    >
                      <ChatBubbleLeftRightIcon className="w-4 h-4" />
                    </button>
                    {openContactDropdown === lead.id && (
                      <div className="absolute z-[70] md:z-[10] mt-1 right-0 bg-white border border-gray-300 rounded-md shadow-lg min-w-32 md:min-w-32">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCall(lead);
                            setOpenContactDropdown(null);
                          }}
                          className="w-full px-3 md:px-2 py-2 md:py-1 text-left hover:bg-gray-100 text-sm md:text-xs flex items-center gap-2 md:gap-1"
                          title="Call"
                        >
                          <PhoneIcon className="w-4 h-4 md:w-3 md:h-3 text-blue-600" />
                          Call
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEmail(lead);
                            setOpenContactDropdown(null);
                          }}
                          className="w-full px-3 md:px-2 py-2 md:py-1 text-left hover:bg-gray-100 text-sm md:text-xs flex items-center gap-2 md:gap-1"
                          title="Email"
                        >
                          <EnvelopeIcon className="w-4 h-4 md:w-3 md:h-3 text-gray-600" />
                          Email
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleWhatsApp(lead);
                            setOpenContactDropdown(null);
                          }}
                          className="w-full px-3 md:px-2 py-2 md:py-1 text-left hover:bg-gray-100 text-sm md:text-xs flex items-center gap-2 md:gap-1"
                          title="WhatsApp"
                        >
                          <FaWhatsapp className="w-4 h-4 md:w-3 md:h-3 text-green-600" />
                          WhatsApp
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                
                {/* Right side - Other action buttons */}
                <div className="flex gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleTimeline(lead);
                    }}
                    className="btn btn-outline btn-primary btn-sm"
                    title="Timeline"
                  >
                    <ClockIcon className="w-4 h-4" />
                  </button>
                  
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedLead(lead);
                      openEditLeadDrawer(lead);
                    }}
                    className="btn btn-outline btn-primary btn-sm"
                    title="Edit Lead"
                  >
                    <PencilSquareIcon className="w-4 h-4" />
                  </button>
                  
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleViewClient(lead);
                    }}
                    className="btn btn-outline btn-primary btn-sm"
                    title="View Client"
                  >
                    <EyeIcon className="w-4 h-4" />
                  </button>
                  
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleRowExpansion(lead.id);
                    }}
                    className="btn btn-outline btn-primary btn-sm"
                  >
                    {expandedRows.has(lead.id) ? 'Show Less' : 'Show More'}
                    <ChevronDownIcon className={`w-4 h-4 ml-1 transition-transform ${expandedRows.has(lead.id) ? 'rotate-180' : ''}`} />
                  </button>
                </div>
              </div>

              {/* Expanded Notes Section */}
              {expandedRows.has(lead.id) && (
                <div className="mt-4 p-4 border-t border-gray-100">
                  <div className="space-y-4">
                    {/* Facts of Case */}
                    <div className="bg-white p-4 rounded-lg shadow-[0_4px_12px_rgba(0,0,0,0.15)] border border-gray-200">
                      <h6 className="font-semibold text-gray-800 mb-2">Facts of Case</h6>
                      <div className="space-y-2 max-h-32 overflow-y-auto">
                        {editingField?.leadId === lead.id && editingField?.field === 'facts' ? (
                          <div className="space-y-2">
                            <textarea
                              value={editValues[`${lead.id}_facts`] || ''}
                              onChange={(e) => setEditValues(prev => ({ ...prev, [`${lead.id}_facts`]: e.target.value }))}
                              className="textarea textarea-bordered w-full text-sm"
                              rows={4}
                              placeholder="Enter facts of case..."
                              dir="auto"
                            />
                            <div className="flex gap-2">
                              <button
                                onClick={() => saveEdit(lead.id, 'facts')}
                                className="btn btn-xs btn-primary"
                              >
                                Save
                              </button>
                              <button
                                onClick={cancelEditing}
                                className="btn btn-xs btn-outline"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-start justify-between">
                            <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed flex-1" dir="auto">
                              {lead.facts || <span className="text-gray-400 italic">No facts provided</span>}
                            </p>
                            <button
                              onClick={() => startEditing(lead.id, 'facts', lead.facts || '')}
                              className="btn btn-xs btn-outline btn-primary ml-2"
                              title="Edit facts"
                            >
                              <PencilSquareIcon className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Special Notes */}
                    <div className="bg-white p-4 rounded-lg shadow-[0_4px_12px_rgba(0,0,0,0.15)] border border-gray-200">
                      <h6 className="font-semibold text-gray-800 mb-2">Special Notes</h6>
                      <div className="space-y-2 max-h-32 overflow-y-auto">
                        {editingField?.leadId === lead.id && editingField?.field === 'special_notes' ? (
                          <div className="space-y-2">
                            <textarea
                              value={editValues[`${lead.id}_special_notes`] || ''}
                              onChange={(e) => setEditValues(prev => ({ ...prev, [`${lead.id}_special_notes`]: e.target.value }))}
                              className="textarea textarea-bordered w-full text-sm"
                              rows={4}
                              placeholder="Enter special notes..."
                              dir="auto"
                            />
                            <div className="flex gap-2">
                              <button
                                onClick={() => saveEdit(lead.id, 'special_notes')}
                                className="btn btn-xs btn-warning"
                              >
                                Save
                              </button>
                              <button
                                onClick={cancelEditing}
                                className="btn btn-xs btn-outline"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-start justify-between">
                            <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed flex-1" dir="auto">
                              {lead.special_notes || <span className="text-gray-400 italic">No special notes</span>}
                            </p>
                            <button
                              onClick={() => startEditing(lead.id, 'special_notes', lead.special_notes || '')}
                              className="btn btn-xs btn-outline btn-primary ml-2"
                              title="Edit special notes"
                            >
                              <PencilSquareIcon className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* General Notes */}
                    <div className="bg-white p-4 rounded-lg shadow-[0_4px_12px_rgba(0,0,0,0.15)] border border-gray-200">
                      <h6 className="font-semibold text-gray-800 mb-2">General Notes</h6>
                      <div className="space-y-2 max-h-32 overflow-y-auto">
                        {editingField?.leadId === lead.id && editingField?.field === 'general_notes' ? (
                          <div className="space-y-2">
                            <textarea
                              value={editValues[`${lead.id}_general_notes`] || ''}
                              onChange={(e) => setEditValues(prev => ({ ...prev, [`${lead.id}_general_notes`]: e.target.value }))}
                              className="textarea textarea-bordered w-full text-sm"
                              rows={4}
                              placeholder="Enter general notes..."
                              dir="auto"
                            />
                            <div className="flex gap-2">
                              <button
                                onClick={() => saveEdit(lead.id, 'general_notes')}
                                className="btn btn-xs btn-success"
                              >
                                Save
                              </button>
                              <button
                                onClick={cancelEditing}
                                className="btn btn-xs btn-outline"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-start justify-between">
                            <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed flex-1" dir="auto">
                              {lead.general_notes || <span className="text-gray-400 italic">No general notes</span>}
                            </p>
                            <button
                              onClick={() => startEditing(lead.id, 'general_notes', lead.general_notes || '')}
                              className="btn btn-xs btn-outline btn-primary ml-2"
                              title="Edit general notes"
                            >
                              <PencilSquareIcon className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table w-full text-xs sm:text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="font-semibold text-gray-900 pr-1 text-xs sm:text-sm">Lead</th>
                  <th 
                    className="font-semibold text-gray-900 pl-1 cursor-pointer hover:bg-gray-100 select-none text-xs sm:text-sm"
                    onClick={() => handleSort('created_at')}
                  >
                    <div className="flex items-center gap-1">
                      <span className="hidden sm:inline">Date Created</span>
                      <span className="sm:hidden">Date</span>
                      {getSortIcon('created_at')}
                    </div>
                  </th>
                  <th className="font-semibold text-gray-900 text-xs sm:text-sm">Stage</th>
                  <th className="font-semibold text-gray-900 text-xs sm:text-sm">Language</th>
                  <th className="font-semibold text-gray-900 text-xs sm:text-sm">Source</th>
                  <th className="font-semibold text-gray-900 text-xs sm:text-sm">Category</th>
                  <th className="font-semibold text-gray-900 text-xs sm:text-sm">Topic</th>
                  <th className="font-semibold text-gray-900 text-xs sm:text-sm">Country</th>
                  <th 
                    className="font-semibold text-gray-900 cursor-pointer hover:bg-gray-100 select-none text-xs sm:text-sm"
                    onClick={() => handleSort('total')}
                  >
                    <div className="flex items-center gap-1">
                      Value
                      {getSortIcon('total')}
                    </div>
                  </th>
                  <th className="font-semibold text-gray-900 text-xs sm:text-sm">Tags</th>
                  <th 
                    className="font-semibold text-gray-900 cursor-pointer hover:bg-gray-100 select-none text-xs sm:text-sm"
                    onClick={() => handleSort('next_followup')}
                  >
                    <div className="flex items-center gap-1">
                      Follow up date
                      {getSortIcon('next_followup')}
                    </div>
                  </th>
                  <th className="font-semibold text-gray-900 text-xs sm:text-sm">Eligible</th>
                  <th className="font-semibold text-gray-900 text-xs sm:text-sm">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredLeads.map((lead) => (
                  <React.Fragment key={lead.id}>
                    <tr 
                      className="hover:bg-gray-50 cursor-pointer"
                      onClick={() => toggleRowExpansion(lead.id)}
                    >
                      <td className="pr-1">
                        <div className="flex items-center gap-1">
                          <div className="flex-shrink-0">
                            {expandedRows.has(lead.id) ? (
                              <ChevronDownIcon className="w-3 h-3 sm:w-4 sm:h-4 text-gray-400" />
                            ) : (
                              <ChevronRightIcon className="w-3 h-3 sm:w-4 sm:h-4 text-gray-400" />
                            )}
                          </div>
                          <div className="flex flex-col">
                            <span className="font-mono text-xs sm:text-sm text-gray-600">
                              #{lead.lead_number}
                            </span>
                            <span className="font-medium text-gray-900 break-words leading-tight text-xs sm:text-sm">
                              {lead.name || 'No Name'}
                            </span>
                          </div>
                        </div>
                      </td>
                    <td className="text-xs sm:text-sm text-gray-600 pl-1">
                      {formatDate(lead.created_at)}
                    </td>
                    <td className="text-xs sm:text-sm text-gray-700">
                      {lead.stage ? lead.stage.replace(/_/g, ' ') : 'Unknown'}
                    </td>
                    <td className="text-xs sm:text-sm text-gray-600">
                      {lead.language || 'N/A'}
                    </td>
                    <td className="text-xs sm:text-sm text-gray-600 break-words">
                      {lead.source || 'N/A'}
                    </td>
                    <td className="text-xs sm:text-sm text-gray-600 break-words">
                      {lead.category || 'N/A'}
                    </td>
                    <td className="text-xs sm:text-sm text-gray-600 break-words">
                      {lead.topic || 'N/A'}
                    </td>
                    <td className="text-xs sm:text-sm text-gray-600 break-words">
                      <div className="flex items-center gap-1">
                        <span>{lead.country || 'N/A'}</span>
                        {lead.country && (() => {
                          const timezone = getCountryTimezone(lead.country, allCountries);
                          const businessInfo = getBusinessHoursInfo(timezone);
                          return timezone ? (
                            <div className={`w-3 h-3 rounded-full ${businessInfo.isBusinessHours ? 'bg-green-500' : 'bg-red-500'}`} 
                                 title={`${businessInfo.localTime ? `Local time: ${businessInfo.localTime}` : 'Time unavailable'} - ${businessInfo.isBusinessHours ? 'Business hours' : 'Outside business hours'} (${timezone})`} />
                          ) : null;
                        })()}
                      </div>
                    </td>
                    <td className="text-xs sm:text-sm font-medium text-gray-900">
                      {formatCurrency(lead.total, lead.balance_currency)}
                    </td>
                    <td className="text-xs sm:text-sm text-gray-600 break-words">
                      {lead.tags || 'N/A'}
                    </td>
                    <td>
                      <span className={`${getFollowUpBadgeStyle(lead.next_followup || '').className} text-xs`}>
                        {getFollowUpBadgeStyle(lead.next_followup || '').text}
                      </span>
                    </td>
                    <td>
                      <div className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          className="toggle toggle-success toggle-xs sm:toggle-sm"
                          checked={lead.eligible || false}
                          onChange={(e) => {
                            e.stopPropagation();
                            handleToggleEligible(lead);
                          }}
                        />
                        <span className="text-xs sm:text-sm font-medium text-gray-700">
                          {lead.eligible ? 'Yes' : 'No'}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="flex gap-1 sm:gap-2">
                        {/* Contact Dropdown */}
                        <div className="relative contact-dropdown z-[60] md:z-auto">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleContactDropdown(lead.id);
                            }}
                            className="btn btn-xs sm:btn-sm btn-outline btn-primary hover:btn-primary hover:text-white transition-colors"
                            title="Contact"
                          >
                            <ChatBubbleLeftRightIcon className="w-3 h-3 sm:w-4 sm:h-4" />
                          </button>
                          {openContactDropdown === lead.id && (
                            <div className="absolute z-[70] md:z-[10] mt-1 right-0 bg-white border border-gray-300 rounded-md shadow-lg min-w-36 sm:min-w-40">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCall(lead);
                                  setOpenContactDropdown(null);
                                }}
                                className="w-full px-4 sm:px-3 py-3 sm:py-2 text-left hover:bg-gray-100 text-sm flex items-center gap-2 sm:gap-2"
                                title="Call"
                              >
                                <PhoneIcon className="w-5 h-5 sm:w-4 sm:h-4 text-blue-600" />
                                Call
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleEmail(lead);
                                  setOpenContactDropdown(null);
                                }}
                                className="w-full px-4 sm:px-3 py-3 sm:py-2 text-left hover:bg-gray-100 text-sm flex items-center gap-2 sm:gap-2"
                                title="Email"
                              >
                                <EnvelopeIcon className="w-5 h-5 sm:w-4 sm:h-4 text-gray-600" />
                                Email
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleWhatsApp(lead);
                                  setOpenContactDropdown(null);
                                }}
                                className="w-full px-4 sm:px-3 py-3 sm:py-2 text-left hover:bg-gray-100 text-sm flex items-center gap-2 sm:gap-2"
                                title="WhatsApp"
                              >
                                <FaWhatsapp className="w-5 h-5 sm:w-4 sm:h-4 text-green-600" />
                                WhatsApp
                              </button>
                            </div>
                          )}
                        </div>
                        
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleTimeline(lead);
                          }}
                          className="btn btn-xs sm:btn-sm btn-outline btn-primary hover:btn-primary hover:text-white transition-colors"
                          title="Timeline"
                        >
                          <ClockIcon className="w-3 h-3 sm:w-4 sm:h-4" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedLead(lead);
                            openEditLeadDrawer(lead);
                          }}
                          className="btn btn-xs sm:btn-sm btn-outline btn-primary hover:btn-primary hover:text-white transition-colors"
                          title="Edit Lead"
                        >
                          <PencilSquareIcon className="w-3 h-3 sm:w-4 sm:h-4" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleViewClient(lead);
                          }}
                          className="btn btn-xs sm:btn-sm btn-outline btn-secondary hover:btn-secondary hover:text-white transition-colors"
                          title="View Client"
                        >
                          <EyeIcon className="w-3 h-3 sm:w-4 sm:h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  
                  {/* Collapsible content row */}
                  {expandedRows.has(lead.id) && (
                    <tr>
                      <td colSpan={12} className="p-6 border-t border-gray-200 pb-8">
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                          {/* Facts of Case */}
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <h4 className="font-semibold text-gray-800 text-sm uppercase tracking-wide">Facts of Case</h4>
                              <button
                                onClick={() => startEditing(lead.id, 'facts', lead.facts || '')}
                                className="btn btn-xs btn-outline btn-primary"
                                title="Edit facts"
                              >
                                <PencilSquareIcon className="w-3 h-3" />
                              </button>
                            </div>
                            <div className="bg-white p-4 rounded-lg shadow-lg border border-gray-200 hover:shadow-xl transition-shadow duration-200">
                              {editingField?.leadId === lead.id && editingField?.field === 'facts' ? (
                                <div className="space-y-2">
                                  <textarea
                                    value={editValues[`${lead.id}_facts`] || ''}
                                    onChange={(e) => setEditValues(prev => ({ ...prev, [`${lead.id}_facts`]: e.target.value }))}
                                    className="textarea textarea-bordered w-full text-sm"
                                    rows={4}
                                    placeholder="Enter facts of case..."
                                    dir="auto"
                                  />
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => saveEdit(lead.id, 'facts')}
                                      className="btn btn-xs btn-primary"
                                    >
                                      Save
                                    </button>
                                    <button
                                      onClick={cancelEditing}
                                      className="btn btn-xs btn-outline"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed" dir="auto">
                                  {lead.facts || <span className="text-gray-400 italic">No facts provided</span>}
                                </p>
                              )}
                            </div>
                          </div>
                          
                          {/* Special Notes */}
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <h4 className="font-semibold text-gray-800 text-sm uppercase tracking-wide">Special Notes</h4>
                              <button
                                onClick={() => startEditing(lead.id, 'special_notes', lead.special_notes || '')}
                                className="btn btn-xs btn-outline btn-primary"
                                title="Edit special notes"
                              >
                                <PencilSquareIcon className="w-3 h-3" />
                              </button>
                            </div>
                            <div className="bg-white p-4 rounded-lg shadow-lg border border-gray-200 hover:shadow-xl transition-shadow duration-200">
                              {editingField?.leadId === lead.id && editingField?.field === 'special_notes' ? (
                                <div className="space-y-2">
                                  <textarea
                                    value={editValues[`${lead.id}_special_notes`] || ''}
                                    onChange={(e) => setEditValues(prev => ({ ...prev, [`${lead.id}_special_notes`]: e.target.value }))}
                                    className="textarea textarea-bordered w-full text-sm"
                                    rows={4}
                                    placeholder="Enter special notes..."
                                    dir="auto"
                                  />
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => saveEdit(lead.id, 'special_notes')}
                                      className="btn btn-xs btn-warning"
                                    >
                                      Save
                                    </button>
                                    <button
                                      onClick={cancelEditing}
                                      className="btn btn-xs btn-outline"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed" dir="auto">
                                  {lead.special_notes || <span className="text-gray-400 italic">No special notes</span>}
                                </p>
                              )}
                            </div>
                          </div>
                          
                          {/* General Notes */}
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <h4 className="font-semibold text-gray-800 text-sm uppercase tracking-wide">General Notes</h4>
                              <button
                                onClick={() => startEditing(lead.id, 'general_notes', lead.general_notes || '')}
                                className="btn btn-xs btn-outline btn-primary"
                                title="Edit general notes"
                              >
                                <PencilSquareIcon className="w-3 h-3" />
                              </button>
                            </div>
                            <div className="bg-white p-4 rounded-lg shadow-lg border border-gray-200 hover:shadow-xl transition-shadow duration-200">
                              {editingField?.leadId === lead.id && editingField?.field === 'general_notes' ? (
                                <div className="space-y-2">
                                  <textarea
                                    value={editValues[`${lead.id}_general_notes`] || ''}
                                    onChange={(e) => setEditValues(prev => ({ ...prev, [`${lead.id}_general_notes`]: e.target.value }))}
                                    className="textarea textarea-bordered w-full text-sm"
                                    rows={4}
                                    placeholder="Enter general notes..."
                                    dir="auto"
                                  />
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => saveEdit(lead.id, 'general_notes')}
                                      className="btn btn-xs btn-success"
                                    >
                                      Save
                                    </button>
                                    <button
                                      onClick={cancelEditing}
                                      className="btn btn-xs btn-outline"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed" dir="auto">
                                  {lead.general_notes || <span className="text-gray-400 italic">No general notes</span>}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modals */}
      {selectedLead && (
        <>
          <SchedulerWhatsAppModal
            isOpen={isWhatsAppModalOpen}
            onClose={() => {
              setIsWhatsAppModalOpen(false);
              setSelectedLead(null);
            }}
            client={{
              id: selectedLead.id,
              name: selectedLead.name,
              lead_number: selectedLead.lead_number,
              phone: selectedLead.phone,
              mobile: selectedLead.mobile,
              lead_type: selectedLead.lead_type
            }}
            onClientUpdate={handleClientUpdate}
          />
          
          <SchedulerEmailThreadModal
            isOpen={isEmailModalOpen}
            onClose={() => {
              setIsEmailModalOpen(false);
              setSelectedLead(null);
            }}
            client={{
              id: selectedLead.id,
              name: selectedLead.name,
              lead_number: selectedLead.lead_number,
              email: selectedLead.email,
              lead_type: selectedLead.lead_type
            }}
            onClientUpdate={handleClientUpdate}
          />
        </>
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
                  {languagesList.map((name, index) => (
                    <option key={`${name}-${index}`} value={name} />
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
                <input type="number" min="0" max="100" className="input input-bordered w-full" value={editLeadData.probability} onChange={e => handleEditLeadChange('probability', e.target.value)} />
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
                <label className="block font-semibold mb-1">Balance (Amount)</label>
                <input type="number" min="0" className="input input-bordered w-full" value={editLeadData.balance} onChange={e => handleEditLeadChange('balance', e.target.value)} />
              </div>
              <div>
                <label className="block font-semibold mb-1">Follow Up Date</label>
                <input type="date" className="input input-bordered w-full" value={editLeadData.next_followup} onChange={e => handleEditLeadChange('next_followup', e.target.value)} />
              </div>
              <div>
                <label className="block font-semibold mb-1">Balance Currency</label>
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
              <div>
                <label className="block font-semibold mb-1">Eligible</label>
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    className="toggle toggle-success"
                    checked={editLeadData.eligible}
                    onChange={(e) => handleEditLeadChange('eligible', e.target.checked)}
                  />
                  <span className="text-sm font-medium text-gray-700">
                    {editLeadData.eligible ? 'Yes' : 'No'}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {editLeadData.eligible ? 'Eligible leads will be removed from the scheduler view' : 'Ineligible leads will be shown in the scheduler view'}
                </p>
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

export default SchedulerToolPage;
