import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import { convertToNIS } from '../lib/currencyConversion';
import { usePersistedFilters, usePersistedState } from '../hooks/usePersistedState';
import { EnvelopeIcon, PhoneIcon, ChatBubbleLeftRightIcon, XMarkIcon, PencilIcon, MagnifyingGlassIcon, ChartBarIcon } from '@heroicons/react/24/outline';
import { FaWhatsapp } from 'react-icons/fa';
import * as Slider from '@radix-ui/react-slider';
import LeadInteractionsModal from '../components/LeadInteractionsModal';

const CloserSuperPipelinePage = () => {
  const navigate = useNavigate();
  const [filters, setFilters] = usePersistedFilters<{
    fromDate: string;
    toDate: string;
    createdFromDate: string;
    createdToDate: string;
    categories: string[];
    employee: string;
    languages: string[];
    stages: string[];
    tags: string[];
    minProbability: number;
    maxProbability: number;
    eligibilityDeterminedOnly: boolean;
  }>('closerSuperPipeline_filters', {
    fromDate: '',
    toDate: '',
    createdFromDate: '',
    createdToDate: '',
    categories: [], // Changed to array for multi-select
    employee: '',
    languages: [], // Changed to array for multi-select
    stages: ['40', '50'], // Default stages: 40 and 50
    tags: [], // Changed to array for multi-select
    minProbability: 80,
    maxProbability: 100,
    eligibilityDeterminedOnly: false,
  }, {
    storage: 'sessionStorage',
  });
  const [results, setResults] = usePersistedState<any[]>('closerSuperPipeline_results', [], {
    storage: 'sessionStorage',
  });
  const [isSearching, setIsSearching] = useState(false);
  const [searchPerformed, setSearchPerformed] = usePersistedState('closerSuperPipeline_performed', false, {
    storage: 'sessionStorage',
  });
  const [sortColumn, setSortColumn] = usePersistedState<string | null>('closerSuperPipeline_sortColumn', null, {
    storage: 'sessionStorage',
  });
  const [sortDirection, setSortDirection] = usePersistedState<'asc' | 'desc'>('closerSuperPipeline_sortDirection', 'desc', {
    storage: 'sessionStorage',
  });
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [employees, setEmployees] = useState<{ id: number; name: string }[]>([]);
  const [languages, setLanguages] = useState<{ id: string; name: string }[]>([]);
  const [stages, setStages] = useState<{ id: string; name: string }[]>([]);
  const [editingManagerNotes, setEditingManagerNotes] = useState<{ leadId: string; lead: any } | null>(null);
  const [managerNotesValue, setManagerNotesValue] = useState<string>('');
  const [savingManagerNotes, setSavingManagerNotes] = useState(false);
  const [categorySearch, setCategorySearch] = useState<string>('');
  const [employeeSearch, setEmployeeSearch] = useState<string>('');
  const [languageSearch, setLanguageSearch] = useState<string>('');
  const [stageSearch, setStageSearch] = useState<string>('');
  const [tagsSearch, setTagsSearch] = useState<string>('');
  const [showCategoryDropdown, setShowCategoryDropdown] = useState<boolean>(false);
  const [showEmployeeDropdown, setShowEmployeeDropdown] = useState<boolean>(false);
  const [showLanguageDropdown, setShowLanguageDropdown] = useState<boolean>(false);
  const [showStageDropdown, setShowStageDropdown] = useState<boolean>(false);
  const [showTagsDropdown, setShowTagsDropdown] = useState<boolean>(false);
  const [probabilityExpanded, setProbabilityExpanded] = useState<boolean>(false);

  const employeeNameById = useMemo(() => {
    const map = new Map<string, string>();
    employees.forEach((emp) => {
      map.set(String(emp.id), emp.name);
    });
    return map;
  }, [employees]);

  const resolveEmployeeDisplay = useCallback((value: any): string => {
    if (value === null || value === undefined) return '---';
    const raw = String(value).trim();
    if (!raw) return '---';

    // If stored value is numeric employee id (e.g. "108"), map to employee display_name.
    if (/^\d+$/.test(raw)) {
      return employeeNameById.get(raw) || `Employee #${raw}`;
    }

    // Some records can contain extra spaces around names.
    return raw;
  }, [employeeNameById]);

  // Helper function to toggle stage selection
  const toggleStageSelection = (stageId: string) => {
    const currentStages = filters.stages || [];
    if (currentStages.includes(stageId)) {
      // Remove stage if already selected
      setFilters(prev => ({
        ...prev,
        stages: currentStages.filter(id => id !== stageId)
      }));
    } else {
      // Add stage if not selected
      setFilters(prev => ({
        ...prev,
        stages: [...currentStages, stageId]
      }));
    }
  };

  // Helper function to toggle category selection
  const toggleCategorySelection = (categoryId: string) => {
    const currentCategories = filters.categories || [];
    if (currentCategories.includes(categoryId)) {
      setFilters(prev => ({
        ...prev,
        categories: currentCategories.filter(id => id !== categoryId)
      }));
    } else {
      setFilters(prev => ({
        ...prev,
        categories: [...currentCategories, categoryId]
      }));
    }
  };

  // Helper function to toggle language selection
  const toggleLanguageSelection = (languageId: string) => {
    const currentLanguages = filters.languages || [];
    if (currentLanguages.includes(languageId)) {
      setFilters(prev => ({
        ...prev,
        languages: currentLanguages.filter(id => id !== languageId)
      }));
    } else {
      setFilters(prev => ({
        ...prev,
        languages: [...currentLanguages, languageId]
      }));
    }
  };

  // Helper function to toggle tag selection
  const toggleTagSelection = (tag: string) => {
    const currentTags = filters.tags || [];
    if (currentTags.includes(tag)) {
      setFilters(prev => ({
        ...prev,
        tags: currentTags.filter(t => t !== tag)
      }));
    } else {
      setFilters(prev => ({
        ...prev,
        tags: [...currentTags, tag]
      }));
    }
  };
  const [currentUserId, setCurrentUserId] = useState<string | number | null>(null);
  const [interactionsCache, setInteractionsCache] = useState<Map<string, any[]>>(new Map());
  const [loadingInteractions, setLoadingInteractions] = useState<Set<string>>(new Set());
  const [selectedLeadForInteractions, setSelectedLeadForInteractions] = useState<any | null>(null);
  const [editingFollowUpDate, setEditingFollowUpDate] = useState<{ leadId: string; leadType: 'new' | 'legacy' } | null>(null);
  const [editingFollowUpNotes, setEditingFollowUpNotes] = useState<{ leadId: string; leadType: 'new' | 'legacy' } | null>(null);
  const [followUpDate, setFollowUpDate] = useState<string>('');
  const [followUpNotes, setFollowUpNotes] = useState<string>('');
  const [savingFollowUp, setSavingFollowUp] = useState(false);

  const resolveCurrentUserId = async (): Promise<string | number | null> => {
    if (currentUserId) return currentUserId;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const byAuth = await supabase
        .from('users')
        .select('id')
        .eq('auth_id', user.id)
        .maybeSingle();
      if (byAuth.data?.id != null) {
        setCurrentUserId(byAuth.data.id);
        return byAuth.data.id;
      }

      if (user.email) {
        const byEmail = await supabase
          .from('users')
          .select('id')
          .eq('email', user.email)
          .maybeSingle();
        if (byEmail.data?.id != null) {
          setCurrentUserId(byEmail.data.id);
          return byEmail.data.id;
        }
      }
    } catch (error) {
      console.error('Error resolving current user ID:', error);
    }
    return null;
  };

  // Fetch current user ID once on mount
  useEffect(() => {
    void resolveCurrentUserId();
  }, []);

  useEffect(() => {
    const fetchOptions = async () => {
      // Fetch categories
      const { data: catData } = await supabase
        .from('misc_maincategory')
        .select('id, name')
        .order('name');
      if (catData) {
        setCategories(catData.map(cat => ({ id: cat.id.toString(), name: cat.name })));
      }

      // No need to fetch all categories - we only use main categories

      // Fetch employees
      const { data: empData } = await supabase
        .from('tenants_employee')
        .select('id, display_name')
        .order('display_name');
      if (empData) {
        setEmployees(empData.map(emp => ({ id: emp.id, name: emp.display_name || `Employee #${emp.id}` })));
      }

      // Fetch languages
      const { data: langData } = await supabase
        .from('misc_language')
        .select('id, name')
        .order('name');
      if (langData) {
        setLanguages(langData.map(lang => ({ id: lang.id.toString(), name: lang.name })));
      }

      // Fetch all stages from lead_stages table
      const { data: stagesData } = await supabase
        .from('lead_stages')
        .select('id, name')
        .order('id', { ascending: true });
      if (stagesData) {
        setStages(stagesData.map(stage => ({ id: stage.id.toString(), name: stage.name })));
      }
    };
    fetchOptions();
  }, []);

  const handleFilterChange = (field: string, value: any) => {
    setFilters(prev => ({ ...prev, [field]: value }));
  };

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      // Toggle direction if clicking the same column
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // Set new column and default to descending
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  const sortResults = useCallback((leads: any[]) => {
    if (!sortColumn) {
      // Default sort: by probability (highest first), then by created_at (newest first)
      return [...leads].sort((a, b) => {
        const probA = a.probability || 0;
        const probB = b.probability || 0;
        if (probB !== probA) {
          return probB - probA;
        }
        const dateA = new Date(a.created_at || 0).getTime();
        const dateB = new Date(b.created_at || 0).getTime();
        return dateB - dateA;
      });
    }

    return [...leads].sort((a, b) => {
      let comparison = 0;

      switch (sortColumn) {
        case 'probability':
          const probA = Number(a.probability) || 0;
          const probB = Number(b.probability) || 0;
          comparison = probA - probB;
          break;

        case 'closer':
          // NULL on top
          const closerA = a.closer || '';
          const closerB = b.closer || '';
          if (!closerA && closerB) comparison = -1;
          else if (closerA && !closerB) comparison = 1;
          else comparison = closerA.localeCompare(closerB);
          break;

        case 'scheduler':
          // NULL on top
          const schedulerA = a.scheduler || '';
          const schedulerB = b.scheduler || '';
          if (!schedulerA && schedulerB) comparison = -1;
          else if (schedulerA && !schedulerB) comparison = 1;
          else comparison = schedulerA.localeCompare(schedulerB);
          break;

        case 'meeting_date':
          const meetingDateA = a.meeting_date ? new Date(a.meeting_date).getTime() : 0;
          const meetingDateB = b.meeting_date ? new Date(b.meeting_date).getTime() : 0;
          comparison = meetingDateA - meetingDateB;
          break;

        case 'follow_up_date':
          const followUpDateA = a.follow_up_date ? new Date(a.follow_up_date).getTime() : 0;
          const followUpDateB = b.follow_up_date ? new Date(b.follow_up_date).getTime() : 0;
          comparison = followUpDateA - followUpDateB;
          break;

        case 'latest_interaction':
          const latestInteractionA = a.latest_interaction ? new Date(a.latest_interaction).getTime() : 0;
          const latestInteractionB = b.latest_interaction ? new Date(b.latest_interaction).getTime() : 0;
          comparison = latestInteractionA - latestInteractionB;
          break;

        case 'total_applicants':
          const totalAppA = Number(a.number_of_applicants_meeting) || 0;
          const totalAppB = Number(b.number_of_applicants_meeting) || 0;
          comparison = totalAppA - totalAppB;
          break;

        case 'potential_applicants':
          const potentialAppA = Number(a.potential_applicants_meeting) || 0;
          const potentialAppB = Number(b.potential_applicants_meeting) || 0;
          comparison = potentialAppA - potentialAppB;
          break;

        case 'total':
          // Convert both to NIS for comparison
          const isLegacyA = a.lead_type === 'legacy' || a.id?.toString().startsWith('legacy_');
          const isLegacyB = b.lead_type === 'legacy' || b.id?.toString().startsWith('legacy_');

          let balanceValueA: any;
          let currencyIdA: number | null = null;
          if (isLegacyA) {
            currencyIdA = a.currency_id ?? (a as any).currency_id;
            let numericCurrencyIdA = typeof currencyIdA === 'string' ? parseInt(currencyIdA, 10) : Number(currencyIdA);
            if (!numericCurrencyIdA || isNaN(numericCurrencyIdA)) {
              numericCurrencyIdA = 1;
            }
            currencyIdA = numericCurrencyIdA;
            if (numericCurrencyIdA === 1) {
              balanceValueA = a.total_base ?? (a as any).total_base ?? null;
            } else {
              balanceValueA = a.total ?? null;
            }
          } else {
            balanceValueA = a.total || (a.balance as any) || (a as any).proposal_total || null;
            currencyIdA = (a as any).currency_id ?? null;
          }

          let balanceValueB: any;
          let currencyIdB: number | null = null;
          if (isLegacyB) {
            currencyIdB = b.currency_id ?? (b as any).currency_id;
            let numericCurrencyIdB = typeof currencyIdB === 'string' ? parseInt(currencyIdB, 10) : Number(currencyIdB);
            if (!numericCurrencyIdB || isNaN(numericCurrencyIdB)) {
              numericCurrencyIdB = 1;
            }
            currencyIdB = numericCurrencyIdB;
            if (numericCurrencyIdB === 1) {
              balanceValueB = b.total_base ?? (b as any).total_base ?? null;
            } else {
              balanceValueB = b.total ?? null;
            }
          } else {
            balanceValueB = b.total || (b.balance as any) || (b as any).proposal_total || null;
            currencyIdB = (b as any).currency_id ?? null;
          }

          const numValueA = typeof balanceValueA === 'number' ? balanceValueA : parseFloat(balanceValueA) || 0;
          const numValueB = typeof balanceValueB === 'number' ? balanceValueB : parseFloat(balanceValueB) || 0;

          // Helper function to map currency symbol to currency ID or code
          const getCurrencyForConversion = (currencyId: number | null, currencySymbol: string | null | undefined): string | number => {
            // If we have currency_id, use it directly (convertToNIS handles IDs: 1=NIS, 2=EUR, 3=USD, 4=GBP)
            if (currencyId !== null && currencyId !== undefined) {
              return currencyId;
            }
            // Otherwise, map symbol to currency code
            const symbol = currencySymbol || '₪';
            const symbolToCode: Record<string, string> = {
              '₪': 'NIS',
              '$': 'USD',
              '€': 'EUR',
              '£': 'GBP'
            };
            return symbolToCode[symbol] || 'NIS';
          };

          // Use currency_id if available (more reliable), otherwise map symbol to code
          const currencyForA = getCurrencyForConversion(currencyIdA, a.balance_currency);
          const currencyForB = getCurrencyForConversion(currencyIdB, b.balance_currency);

          // Convert to NIS for comparison - convertToNIS can handle both currency IDs and codes
          const nisValueA = convertToNIS(numValueA, currencyForA);
          const nisValueB = convertToNIS(numValueB, currencyForB);
          comparison = nisValueA - nisValueB;
          break;

        default:
          return 0;
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [sortColumn, sortDirection]);

  // Helper function to detect Hebrew text and apply RTL
  const isHebrewText = (text: string): boolean => {
    if (!text) return false;
    // Hebrew Unicode range: \u0590-\u05FF
    const hebrewRegex = /[\u0590-\u05FF]/;
    return hebrewRegex.test(text);
  };

  // Function to fetch interactions for a lead
  const fetchInteractions = useCallback(async (lead: any) => {
    const leadKey = lead.id?.toString() || lead.lead_number || '';
    if (!leadKey || loadingInteractions.has(leadKey)) return;

    setLoadingInteractions(prev => new Set(prev).add(leadKey));

    try {
      const isLegacy = lead.lead_type === 'legacy' || lead.id?.toString().startsWith('legacy_');
      const leadId = isLegacy ? lead.id?.toString().replace('legacy_', '') : lead.id;
      const allInteractions: any[] = [];
      const employeeIdsToFetch = new Set<number>();

      if (isLegacy) {
        const legacyId = Number(leadId);
        if (!isNaN(legacyId)) {
          // Fetch from leads_leadinteractions
          const { data: legacyInteractions } = await supabase
            .from('leads_leadinteractions')
            .select('id, cdate, kind, content, direction, creator_id, date, time')
            .eq('lead_id', legacyId)
            .order('cdate', { ascending: false })
            .limit(10);

          if (legacyInteractions) {
            legacyInteractions.forEach((interaction: any) => {
              // Collect employee IDs for later fetching
              if (interaction.creator_id && interaction.creator_id !== '\\N' && interaction.creator_id !== 'EMPTY') {
                const empId = Number(interaction.creator_id);
                if (!isNaN(empId)) employeeIdsToFetch.add(empId);
              }
              if (interaction.employee_id && interaction.employee_id !== '\\N' && interaction.employee_id !== 'EMPTY') {
                const empId = Number(interaction.employee_id);
                if (!isNaN(empId)) employeeIdsToFetch.add(empId);
              }

              allInteractions.push({
                id: interaction.id,
                type: interaction.kind === 'w' ? 'whatsapp' : interaction.kind === 'e' ? 'email' : interaction.kind === 'call' ? 'call' : 'other',
                date: interaction.cdate || interaction.date,
                content: interaction.content || '',
                direction: interaction.direction || 'out',
                source: 'lead_leadinteractions',
                creator_id: interaction.creator_id,
                employee_id: interaction.employee_id
              });
            });
          }

          // Fetch emails
          const { data: emails } = await supabase
            .from('emails')
            .select('id, subject, body_html, sent_at, direction, sender_name, sender_email, recipient_list')
            .eq('legacy_id', legacyId)
            .order('sent_at', { ascending: false })
            .limit(5);

          if (emails) {
            emails.forEach((email: any) => {
              allInteractions.push({
                id: email.id,
                type: 'email',
                date: email.sent_at,
                content: email.subject || '',
                body: email.body_html || '',
                direction: email.direction || 'out',
                sender: email.sender_name || '',
                sender_email: email.sender_email || '',
                recipient_list: email.recipient_list || '',
                source: 'emails'
              });
            });
          }

          // Fetch WhatsApp messages
          const { data: whatsappMessages } = await supabase
            .from('whatsapp_messages')
            .select('id, message, sent_at, direction, sender_name, contact_id')
            .eq('legacy_id', legacyId)
            .order('sent_at', { ascending: false })
            .limit(5);

          if (whatsappMessages) {
            whatsappMessages.forEach((msg: any) => {
              allInteractions.push({
                id: msg.id,
                type: 'whatsapp',
                date: msg.sent_at,
                content: msg.message || '',
                direction: msg.direction || 'out',
                sender: msg.sender_name || '',
                contact_id: msg.contact_id,
                source: 'whatsapp_messages'
              });
            });
          }
        }
      } else {
        // For new leads
        // Fetch emails
        const { data: emails } = await supabase
          .from('emails')
          .select('id, subject, body_html, sent_at, direction, sender_name, sender_email, recipient_list')
          .eq('client_id', leadId)
          .order('sent_at', { ascending: false })
          .limit(5);

        if (emails) {
          emails.forEach((email: any) => {
            allInteractions.push({
              id: email.id,
              type: 'email',
              date: email.sent_at,
              content: email.subject || '',
              body: email.body_html || '',
              direction: email.direction || 'out',
              sender: email.sender_name || '',
              sender_email: email.sender_email || '',
              recipient_list: email.recipient_list || '',
              source: 'emails'
            });
          });
        }

        // Fetch WhatsApp messages
        const { data: whatsappMessages } = await supabase
          .from('whatsapp_messages')
          .select('id, message, sent_at, direction, sender_name, contact_id')
          .eq('lead_id', leadId)
          .order('sent_at', { ascending: false })
          .limit(5);

        if (whatsappMessages) {
          whatsappMessages.forEach((msg: any) => {
            allInteractions.push({
              id: msg.id,
              type: 'whatsapp',
              date: msg.sent_at,
              content: msg.message || '',
              direction: msg.direction || 'out',
              sender: msg.sender_name || '',
              contact_id: msg.contact_id,
              source: 'whatsapp_messages'
            });
          });
        }

        // Fetch manual interactions from leads table
        const { data: leadData } = await supabase
          .from('leads')
          .select('manual_interactions')
          .eq('id', leadId)
          .maybeSingle();

        if (leadData?.manual_interactions && Array.isArray(leadData.manual_interactions)) {
          // Get the most recent manual interaction
          const manualInteractions = leadData.manual_interactions
            .map((interaction: any) => ({
              ...interaction,
              date: interaction.raw_date || interaction.date || new Date().toISOString()
            }))
            .sort((a: any, b: any) => {
              const dateA = new Date(a.date || 0).getTime();
              const dateB = new Date(b.date || 0).getTime();
              return dateB - dateA;
            });

          if (manualInteractions.length > 0) {
            const mostRecentManual = manualInteractions[0];
            allInteractions.push({
              id: mostRecentManual.id || `manual_${Date.now()}`,
              type: 'manual',
              date: mostRecentManual.date,
              content: mostRecentManual.content || '',
              direction: mostRecentManual.direction || 'out',
              source: 'manual_interactions',
              kind: mostRecentManual.kind || 'other',
              employee: mostRecentManual.employee || null
            });
          }
        }
      }

      // Helper function to check if email is from office
      const isOfficeEmail = (email: string): boolean => {
        if (!email) return false;
        return email.toLowerCase().endsWith('@lawoffice.org.il');
      };

      // Build employee email to name mapping
      const employeeEmailMap = new Map<string, string>();
      try {
        const [employeesResult, usersResult] = await Promise.all([
          supabase
            .from('tenants_employee')
            .select('id, display_name, official_name')
            .not('display_name', 'is', null),
          supabase
            .from('users')
            .select('employee_id, email')
            .not('email', 'is', null)
        ]);

        if (!employeesResult.error && employeesResult.data) {
          // Create employee_id to email mapping from users table
          const employeeIdToEmail = new Map<number, string>();
          if (usersResult.data) {
            usersResult.data.forEach((user: any) => {
              if (user.employee_id && user.email) {
                employeeIdToEmail.set(user.employee_id, user.email.toLowerCase());
              }
            });
          }

          // Map emails to display names
          employeesResult.data.forEach((emp: any) => {
            if (!emp.display_name) return;
            const displayName = emp.display_name || emp.official_name || `Employee ${emp.id}`;

            // Method 1: Use email from users table (employee_id match)
            const emailFromUsers = employeeIdToEmail.get(emp.id);
            if (emailFromUsers) {
              employeeEmailMap.set(emailFromUsers, displayName);
            }

            // Method 2: Use pattern matching (display_name.toLowerCase().replace(/\s+/g, '.') + '@lawoffice.org.il')
            const patternEmail = `${emp.display_name.toLowerCase().replace(/\s+/g, '.')}@lawoffice.org.il`;
            employeeEmailMap.set(patternEmail, displayName);
          });
        }
      } catch (error) {
        console.error('Error building employee email map:', error);
      }

      // Fetch employee names for all interactions
      let employeeMap: Record<number, string> = {};
      if (employeeIdsToFetch.size > 0) {
        const { data: employees } = await supabase
          .from('tenants_employee')
          .select('id, display_name, official_name')
          .in('id', Array.from(employeeIdsToFetch));

        if (employees) {
          employees.forEach((emp: any) => {
            employeeMap[emp.id] = emp.display_name || emp.official_name || `Employee ${emp.id}`;
          });
        }
      }

      // Helper function to get employee name for an interaction
      const getEmployeeNameForInteraction = (interaction: any): string | null => {
        // For legacy interactions, use creator_id or employee_id
        if (interaction.creator_id && interaction.creator_id !== '\\N' && interaction.creator_id !== 'EMPTY') {
          const empId = Number(interaction.creator_id);
          if (!isNaN(empId) && employeeMap[empId]) {
            return employeeMap[empId];
          }
        }
        if (interaction.employee_id && interaction.employee_id !== '\\N' && interaction.employee_id !== 'EMPTY') {
          const empId = Number(interaction.employee_id);
          if (!isNaN(empId) && employeeMap[empId]) {
            return employeeMap[empId];
          }
        }

        // For manual interactions, use employee field
        if (interaction.employee) {
          return interaction.employee;
        }

        // For emails, check if sender_email is an office email
        if (interaction.sender_email && isOfficeEmail(interaction.sender_email)) {
          const employeeName = employeeEmailMap.get(interaction.sender_email.toLowerCase());
          if (employeeName) {
            return employeeName;
          }
        }

        // For incoming emails, check recipient_list for office emails
        if (interaction.direction === 'in' && interaction.recipient_list) {
          const recipients = interaction.recipient_list.toLowerCase().split(/[,;]/).map((r: string) => r.trim());
          for (const recipientEmail of recipients) {
            if (isOfficeEmail(recipientEmail)) {
              const employeeName = employeeEmailMap.get(recipientEmail);
              if (employeeName) {
                return employeeName;
              }
            }
          }
        }

        // Fallback: try sender name if it's not generic
        if (interaction.sender && interaction.sender !== 'Client' && interaction.sender !== 'Team' && interaction.sender !== 'Unknown') {
          return interaction.sender;
        }

        return null;
      };

      // Add employee names to interactions
      allInteractions.forEach(interaction => {
        interaction.employee_name = getEmployeeNameForInteraction(interaction);
      });

      // Group by type and keep only the most recent one from each category
      const interactionsByType = new Map<string, any>();

      allInteractions.forEach((interaction) => {
        const type = interaction.type || 'other';
        const existing = interactionsByType.get(type);

        if (!existing) {
          interactionsByType.set(type, interaction);
        } else {
          // Compare dates - keep the more recent one
          const existingDate = new Date(existing.date || 0).getTime();
          const currentDate = new Date(interaction.date || 0).getTime();
          if (currentDate > existingDate) {
            interactionsByType.set(type, interaction);
          }
        }
      });

      // Convert map to array and sort by date (most recent first)
      const limitedInteractions = Array.from(interactionsByType.values()).sort((a, b) => {
        const dateA = new Date(a.date || 0).getTime();
        const dateB = new Date(b.date || 0).getTime();
        return dateB - dateA;
      });

      setInteractionsCache(prev => {
        const newCache = new Map(prev);
        newCache.set(leadKey, limitedInteractions);
        return newCache;
      });
    } catch (error) {
      console.error('Error fetching interactions:', error);
      toast.error('Failed to load interactions');
    } finally {
      setLoadingInteractions(prev => {
        const newSet = new Set(prev);
        newSet.delete(leadKey);
        return newSet;
      });
    }
  }, [loadingInteractions]);

  const handleOpenInteractions = useCallback((lead: any) => {
    const leadKey = lead.id?.toString() || lead.lead_number || '';
    if (!leadKey) return;
    setSelectedLeadForInteractions(lead);
    if (!interactionsCache.has(leadKey)) {
      void fetchInteractions(lead);
    }
  }, [interactionsCache, fetchInteractions]);

  const handleCancelFilters = () => {
    // Reset all filters to default - set dates to empty (null)
    setFilters({
      fromDate: '',
      toDate: '',
      createdFromDate: '',
      createdToDate: '',
      categories: [], // Reset to empty array
      employee: '',
      languages: [], // Reset to empty array
      stages: [], // Reset to empty array (no default stages)
      tags: [], // Reset to empty array
      minProbability: 80,
      maxProbability: 100,
      eligibilityDeterminedOnly: false,
    });
    // Clear search inputs
    setCategorySearch('');
    setEmployeeSearch('');
    setLanguageSearch('');
    setStageSearch('');
    setTagsSearch('');
    // Keep results, totals, and table visibility - don't clear them
  };

  // Format stage name from joined lead_stages (same pattern as CalendarPage / SchedulerToolPage)
  const getStageNameFromJoin = (lead: any): string | null => {
    const stage = lead?.lead_stages;
    if (!stage) return null;
    const record = Array.isArray(stage) ? stage[0] : stage;
    return record?.name && typeof record.name === 'string' ? record.name.trim() || null : null;
  };
  // Format category from joined misc_category + misc_maincategory
  const getCategoryDisplayFromJoin = (lead: any): string | null => {
    const cat = lead?.misc_category;
    if (!cat || !cat.name) return null;
    const main = Array.isArray(cat.misc_maincategory) ? cat.misc_maincategory[0] : cat.misc_maincategory;
    return main?.name ? `${cat.name} (${main.name})` : (cat.name || null);
  };
  // Format language from joined misc_language
  const getLanguageDisplayFromJoin = (lead: any): string | null => {
    const lang = lead?.misc_language;
    if (!lang) return null;
    const record = Array.isArray(lang) ? lang[0] : lang;
    return record?.name && typeof record.name === 'string' ? record.name.trim() || null : null;
  };
  // Fallback when join data is missing
  const getStageName = (stageId: string | number | null | undefined) => {
    if (!stageId) return '---';
    // Stage names mapping - you may need to fetch from lead_stages table
    const stageMap: Record<string, string> = {
      '0': 'Created',
      '10': 'Scheduler assigned',
      '11': 'Precommunication',
      '15': 'Communication started',
      '20': 'Meeting scheduled',
      '21': 'Meeting rescheduling',
      '30': 'Meeting complete',
      '35': 'Meeting Irrelevant',
      '40': 'Waiting for Mtng sum',
      '50': 'Mtng sum+Agreement sent',
      '51': 'Client declined price offer',
      '55': 'Another meeting',
      '60': 'Client signed agreement',
      '70': 'Payment request sent',
      '91': 'Dropped (Spam/Irrelevant)',
      '100': 'Success',
      '105': 'Handler Set',
      '110': 'Handler Started',
      '150': 'Application submitted',
      '200': 'Case Closed'
    };
    return stageMap[String(stageId)] || String(stageId);
  };

  const formatCurrency = (amount: string, currency: string, lead?: any) => {
    // Same logic as CalendarPage.tsx balance badge
    if (lead) {
      const isLegacy = lead.lead_type === 'legacy' || lead.id?.toString().startsWith('legacy_');
      let balanceValue: any;

      if (isLegacy) {
        // For legacy leads: if currency_id is 1 (NIS/ILS), use total_base; otherwise use total
        const currencyId = lead.currency_id ?? (lead as any).currency_id;
        let numericCurrencyId = typeof currencyId === 'string' ? parseInt(currencyId, 10) : Number(currencyId);
        if (!numericCurrencyId || isNaN(numericCurrencyId)) {
          numericCurrencyId = 1; // Default to NIS
        }
        if (numericCurrencyId === 1) {
          balanceValue = lead.total_base ?? (lead as any).total_base ?? null;
        } else {
          balanceValue = lead.total ?? null;
        }
      } else {
        balanceValue = amount || (lead as any).proposal_total;
      }

      // Get currency symbol - SIMPLE: use balance_currency directly (it's already the symbol from accounting_currencies.name)
      // balance_currency is set from accounting_currencies.name which contains the symbol (₪, $, €, £)
      let currencySymbol = lead.balance_currency || '₪';

      // If balance_currency is not set or empty, fall back to currency_id mapping
      if (!currencySymbol || currencySymbol.trim() === '') {
        const currencyId = (lead as any).currency_id;
        if (currencyId !== null && currencyId !== undefined && currencyId !== '') {
          const numericCurrencyId = typeof currencyId === 'string' ? parseInt(currencyId, 10) : Number(currencyId);
          if (!isNaN(numericCurrencyId) && numericCurrencyId > 0) {
            // Mapping: 1=₪, 2=€, 3=$, 4=£ (matches accounting_currencies table)
            switch (numericCurrencyId) {
              case 1: currencySymbol = '₪'; break;
              case 2: currencySymbol = '€'; break;
              case 3: currencySymbol = '$'; break;
              case 4: currencySymbol = '£'; break;
              default: currencySymbol = '₪';
            }
          }
        }
      }

      if (balanceValue === '--') {
        return '--';
      }

      // Handle 0 values - show currency symbol
      if (balanceValue === 0 || balanceValue === '0' || Number(balanceValue) === 0) {
        return `${currencySymbol}0`;
      }

      if (balanceValue && (Number(balanceValue) > 0 || balanceValue !== '0')) {
        const formattedValue = typeof balanceValue === 'number'
          ? balanceValue.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
          : Number(balanceValue).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
        return `${currencySymbol}${formattedValue}`;
      }

      // Default: show 0 with currency symbol
      return `${currencySymbol}0`;
    }

    // Fallback to old logic if no lead provided
    if (!amount || amount === '0') return '₪0';
    try {
      const numAmount = parseFloat(amount);
      if (isNaN(numAmount)) return `${currency}0`;
      return `${currency}${numAmount.toLocaleString()}`;
    } catch {
      return `${currency}0`;
    }
  };

  const formatNoteText = (text: string): string => {
    if (!text) return '';
    return text.replace(/\n/g, '<br>');
  };

  // Convert HTML <br> tags back to newlines for textarea editing
  const unformatNoteText = (text: string): string => {
    if (!text) return '';
    // Convert <br> and <br /> back to newlines
    return text.replace(/<br\s*\/?>/gi, '\n');
  };

  const fetchCurrentUserName = async (): Promise<string> => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: userRow } = await supabase
          .from('users')
          .select('full_name')
          .eq('auth_id', user.id)
          .maybeSingle();
        if (userRow?.full_name) {
          return userRow.full_name;
        }
        if (user.user_metadata?.full_name) {
          return user.user_metadata.full_name;
        }
        if (user.email) {
          return user.email;
        }
      }
      return 'Unknown User';
    } catch (error) {
      console.error('Error fetching current user name:', error);
      return 'Unknown User';
    }
  };

  const handleEditFollowUpDate = (lead: any) => {
    const leadId = lead.id;
    const leadType = lead.lead_type || (leadId.toString().startsWith('legacy_') ? 'legacy' : 'new');
    setEditingFollowUpDate({ leadId, leadType });
    setFollowUpDate(lead.follow_up_date || '');
  };

  const handleEditFollowUpNotes = (lead: any) => {
    const leadId = lead.id;
    const leadType = lead.lead_type || (leadId.toString().startsWith('legacy_') ? 'legacy' : 'new');
    setEditingFollowUpNotes({ leadId, leadType });
    setFollowUpNotes(lead.follow_up_notes && lead.follow_up_notes !== '---' ? lead.follow_up_notes : '');
  };

  const getExistingFollowUp = async (
    leadId: string,
    leadType: 'new' | 'legacy',
    userId: string | number
  ) => {
    const isLegacyLead = leadType === 'legacy';
    const actualLeadId = isLegacyLead ? leadId.toString().replace('legacy_', '') : leadId;

    if (isLegacyLead) {
      const { data } = await supabase
        .from('follow_ups')
        .select('id')
        .eq('user_id', userId)
        .eq('lead_id', Number(actualLeadId))
        .is('new_lead_id', null)
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle();
      return { existingFollowUp: data, isLegacyLead, actualLeadId };
    }

    const { data } = await supabase
      .from('follow_ups')
      .select('id')
      .eq('user_id', userId)
      .eq('new_lead_id', actualLeadId)
      .is('lead_id', null)
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle();
    return { existingFollowUp: data, isLegacyLead, actualLeadId };
  };

  const handleSaveFollowUpDate = async () => {
    if (!editingFollowUpDate) return;

    setSavingFollowUp(true);
    try {
      const userId = await resolveCurrentUserId();
      if (!userId) {
        toast.error('User not authenticated');
        return;
      }
      const { leadId, leadType } = editingFollowUpDate;
      const { existingFollowUp, isLegacyLead, actualLeadId } = await getExistingFollowUp(leadId, leadType, userId);
      const hasDate = !!(followUpDate && followUpDate.trim() !== '');
      const dateValue = hasDate ? `${followUpDate}T00:00:00Z` : null;

      if (hasDate) {
        if (existingFollowUp) {
          const { error } = await supabase
            .from('follow_ups')
            .update({ date: dateValue })
            .eq('id', existingFollowUp.id);

          if (error) {
            console.error('Error updating follow-up:', error);
            toast.error('Failed to update follow-up date');
          } else {
            toast.success('Follow-up date updated');
            setEditingFollowUpDate(null);
            setFollowUpDate('');
            handleSearch(false);
          }
        } else {
          const insertData: any = {
            user_id: userId,
            date: dateValue,
            created_at: new Date().toISOString()
          };

          if (isLegacyLead) {
            insertData.lead_id = Number(actualLeadId);
            insertData.new_lead_id = null;
          } else {
            insertData.new_lead_id = actualLeadId;
            insertData.lead_id = null;
          }

          const { error } = await supabase
            .from('follow_ups')
            .insert(insertData);

          if (error) {
            console.error('Error creating follow-up:', error);
            toast.error('Failed to save follow-up date');
          } else {
            toast.success('Follow-up date saved');
            setEditingFollowUpDate(null);
            setFollowUpDate('');
            handleSearch(false);
          }
        }
      } else {
        if (existingFollowUp) {
          const { error } = await supabase
            .from('follow_ups')
            .delete()
            .eq('id', existingFollowUp.id);

          if (error) {
            console.error('Error deleting follow-up:', error);
            toast.error('Failed to delete follow-up');
          } else {
            toast.success('Follow-up removed');
            setEditingFollowUpDate(null);
            setFollowUpDate('');
            handleSearch(false);
          }
        } else {
          setEditingFollowUpDate(null);
          setFollowUpDate('');
        }
      }
    } catch (error) {
      console.error('Error saving follow-up:', error);
      toast.error('Failed to save follow-up');
    } finally {
      setSavingFollowUp(false);
    }
  };

  const handleSaveFollowUpNotes = async () => {
    if (!editingFollowUpNotes) return;

    setSavingFollowUp(true);
    try {
      const userId = await resolveCurrentUserId();
      if (!userId) {
        toast.error('User not authenticated');
        return;
      }
      const { leadId, leadType } = editingFollowUpNotes;
      const { existingFollowUp, isLegacyLead, actualLeadId } = await getExistingFollowUp(leadId, leadType, userId);
      const hasNotes = !!(followUpNotes && followUpNotes.trim() !== '');
      const noteValue = hasNotes ? followUpNotes.trim() : null;

      if (hasNotes) {
        if (isLegacyLead) {
          const { error } = await supabase
            .from('leads_lead')
            .update({ followup_log: noteValue })
            .eq('id', Number(actualLeadId));
          if (error) {
            console.error('Error updating legacy follow-up notes:', error);
            toast.error('Failed to update follow-up notes');
          } else {
            toast.success('Follow-up notes updated');
            setEditingFollowUpNotes(null);
            setFollowUpNotes('');
            handleSearch(false);
          }
        } else {
          const { error } = await supabase
            .from('leads')
            .update({ followup_log: noteValue })
            .eq('id', actualLeadId);
          if (error) {
            console.error('Error updating new lead follow-up notes:', error);
            toast.error('Failed to update follow-up notes');
          } else {
            toast.success('Follow-up notes updated');
            setEditingFollowUpNotes(null);
            setFollowUpNotes('');
            handleSearch(false);
          }
        }
      } else {
        if (isLegacyLead) {
          const { error } = await supabase
            .from('leads_lead')
            .update({ followup_log: null })
            .eq('id', Number(actualLeadId));
          if (error) {
            console.error('Error clearing legacy follow-up notes:', error);
            toast.error('Failed to clear follow-up notes');
          } else {
            toast.success('Follow-up notes cleared');
            setEditingFollowUpNotes(null);
            setFollowUpNotes('');
            handleSearch(false);
          }
        } else {
          const { error } = await supabase
            .from('leads')
            .update({ followup_log: null })
            .eq('id', actualLeadId);
          if (error) {
            console.error('Error clearing new lead follow-up notes:', error);
            toast.error('Failed to clear follow-up notes');
          } else {
            toast.success('Follow-up notes cleared');
            setEditingFollowUpNotes(null);
            setFollowUpNotes('');
            handleSearch(false);
          }
        }
      }
    } catch (error) {
      console.error('Error saving follow-up notes:', error);
      toast.error('Failed to save follow-up notes');
    } finally {
      setSavingFollowUp(false);
    }
  };

  const handleEditManagerNotes = (lead: any) => {
    setEditingManagerNotes({ leadId: lead.id || lead.lead_number || '', lead });
    // Remove "---" if it's the only content, otherwise use the actual value
    // Convert HTML <br> tags back to newlines for textarea editing
    let notesValue = lead.manager_notes && lead.manager_notes !== '---' ? lead.manager_notes : '';
    notesValue = unformatNoteText(notesValue);
    setManagerNotesValue(notesValue);
  };

  const handleSaveManagerNotes = async () => {
    if (!editingManagerNotes) return;

    const lead = editingManagerNotes.lead;
    const leadId = lead.id || lead.lead_number;
    if (!leadId) return;

    setSavingManagerNotes(true);
    try {
      const userName = await fetchCurrentUserName();
      const tableName = lead.lead_type === 'legacy' ? 'leads_lead' : 'leads';
      const clientId = lead.lead_type === 'legacy'
        ? (typeof leadId === 'string' ? parseInt(leadId.replace('legacy_', '')) : leadId)
        : leadId;

      const notesText = managerNotesValue || '';
      // Save raw text with newlines - formatNoteText is only for display in table
      const updateData: any = {
        management_notes: notesText, // Save raw text with \n characters
        management_notes_last_edited_by: userName,
        management_notes_last_edited_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from(tableName)
        .update(updateData)
        .eq('id', clientId);

      if (error) throw error;

      // Update local state - use raw text, formatNoteText is only for display
      setResults(prev => prev.map(l =>
        l.id === lead.id
          ? { ...l, manager_notes: notesText }
          : l
      ));

      // Close modal
      setEditingManagerNotes(null);
      setManagerNotesValue('');

      toast.success('Manager notes saved successfully');
    } catch (error: any) {
      console.error('Error saving manager notes:', error);
      toast.error(`Failed to save manager notes: ${error?.message || 'Unknown error'}`);
    } finally {
      setSavingManagerNotes(false);
    }
  };

  const handleCancelManagerNotes = () => {
    setEditingManagerNotes(null);
    setManagerNotesValue('');
  };

  const handleSearch = async (applyDateFilters: boolean = true) => {
    setIsSearching(true);
    if (applyDateFilters) {
      setSearchPerformed(true);
    }
    try {
      const allLeads: any[] = [];
      const effectiveCurrentUserId = currentUserId ?? await resolveCurrentUserId();

      // Get selected stages from filters (only filter if stages are selected)
      const selectedStageIds = (filters.stages && filters.stages.length > 0)
        ? filters.stages.map(id => id.toString())
        : [];

      // Convert stage IDs to numbers for database query (stage column is numeric)
      const selectedStageIdsNumeric = selectedStageIds.map(id => {
        const numId = Number(id);
        if (isNaN(numId)) {
          console.warn(`⚠️ WARNING: Invalid stage ID "${id}" cannot be converted to number`);
        }
        return numId;
      }).filter(id => !isNaN(id));

      console.log('🔍 DEBUG: Starting handleSearch', {
        applyDateFilters,
        filters,
        filtersStages: filters.stages,
        selectedStageIds,
        selectedStageIdsNumeric,
        selectedStageIdsNumericTypes: selectedStageIdsNumeric.map(id => typeof id),
        minProbability: filters.minProbability,
        maxProbability: filters.maxProbability
      });

      // Fetch new leads with joins for stage and category (same pattern as SchedulerToolPage / CalendarPage)
      let newLeadsQuery = supabase
        .from('leads')
        .select(`
          id,
          lead_number,
          manual_id,
          name,
          created_at,
          latest_interaction,
          closer,
          scheduler,
          expert,
          manager,
          category,
          category_id,
          stage,
          eligible,
          probability,
          language,
          number_of_applicants_meeting,
          potential_applicants_meeting,
          balance,
          balance_currency,
          currency_id,
          proposal_total,
          master_id,
          accounting_currencies!leads_currency_id_fkey (
            id,
            name,
            iso_code
          ),
          lead_stages!fk_leads_stage (
            id,
            name,
            colour
          ),
          misc_category!fk_leads_category_id (
            id,
            name,
            parent_id,
            misc_maincategory!parent_id (
              id,
              name
            )
          ),
          leads_lead_tags (
            misc_leadtag (
              name
            )
          ),
          expert_notes,
          management_notes,
          followup_log,
          unactivated_at,
          eligibility_status,
          eligibility_status_timestamp,
          eligibility_status_last_edited_at
        `)
        .gte('probability', Number(filters.minProbability)) // Probability >= minProbability (ensure it's a number)
        .lte('probability', Number(filters.maxProbability)) // Probability <= maxProbability (ensure it's a number)
        .not('probability', 'is', null) // Exclude null probabilities
        .not('closer', 'is', null) // Only leads with closer assigned
        .is('unactivated_at', null); // Only active leads (closer pipeline doesn't check eligible)

      // Apply stage filter - use selected stages from filters (convert to numbers for database query)
      // Only apply filter if stages are selected (no hardcoded default)
      if (selectedStageIdsNumeric.length > 0) {
        console.log('🔍 DEBUG: Applying stage filter to new leads query', {
          selectedStageIds,
          selectedStageIdsNumeric,
          stageFilterWillBe: `stage.in(${selectedStageIdsNumeric.join(',')})`
        });
        newLeadsQuery = newLeadsQuery.in('stage', selectedStageIdsNumeric);
      } else {
        console.log('🔍 DEBUG: No stage filter applied - showing all stages (user has not selected any stages)');
      }

      // Apply category filter (main category - need to filter by all subcategories)
      if (filters.categories && filters.categories.length > 0) {
        // Collect all subcategory IDs for all selected main categories
        const allSubCategoryIds: string[] = [];
        for (const categoryId of filters.categories) {
          const { data: subCategories } = await supabase
            .from('misc_category')
            .select('id')
            .eq('parent_id', categoryId);

          if (subCategories && subCategories.length > 0) {
            allSubCategoryIds.push(...subCategories.map(sc => sc.id.toString()));
          }
        }
        if (allSubCategoryIds.length > 0) {
          newLeadsQuery = newLeadsQuery.in('category_id', allSubCategoryIds);
        } else {
          // If no subcategories found, return no results
          newLeadsQuery = newLeadsQuery.eq('category_id', -1); // Non-existent ID
        }
      }

      // Apply language filter
      if (filters.languages && filters.languages.length > 0) {
        newLeadsQuery = newLeadsQuery.in('language', filters.languages);
      }

      // Apply created date filter for new leads (created_at)
      if (filters.createdFromDate) {
        newLeadsQuery = newLeadsQuery.gte('created_at', filters.createdFromDate);
      }
      if (filters.createdToDate) {
        newLeadsQuery = newLeadsQuery.lte('created_at', filters.createdToDate + 'T23:59:59');
      }

      // Match LeadSearchPage behavior exactly.
      if (filters.eligibilityDeterminedOnly) {
        newLeadsQuery = newLeadsQuery.eq('eligible', true);
      }

      // Apply employee filter (closer)
      // Note: The closer field can contain either employee ID (as string) OR employee name
      // Since PostgREST's or() might not work well with other filters, we'll fetch leads
      // matching other criteria and filter by employee client-side
      let needsClientSideEmployeeFilter = false;
      let employeeFilterId: string | null = null;
      let employeeFilterName: string | null = null;
      
      if (filters.employee) {
        if (filters.employee === '--') {
          // Show NULL closer or NULL scheduler entries
          newLeadsQuery = newLeadsQuery.or('closer.is.null,scheduler.is.null');
        } else {
          const employee = employees.find(emp => emp.id.toString() === filters.employee);
          if (employee) {
            console.log('🔍 DEBUG: Will filter by employee client-side', {
              employeeId: filters.employee,
              employeeName: employee.name,
              reason: 'PostgREST or() may not work correctly with other filters'
            });
            // Store filter criteria for client-side filtering
            needsClientSideEmployeeFilter = true;
            employeeFilterId = filters.employee;
            employeeFilterName = employee.name.trim();
          } else {
            console.warn('🔍 DEBUG: Employee filter set but employee not found', {
              employeeId: filters.employee,
              availableEmployees: employees.map(e => ({ id: e.id, name: e.name }))
            });
          }
        }
      }

      console.log('🔍 DEBUG: Executing new leads query...', {
        activeFilters: {
          stages: selectedStageIds,
          stagesNumeric: selectedStageIdsNumeric,
          probability: `${filters.minProbability}-${filters.maxProbability}`,
          closer: 'not null',
          unactivated_at: 'null',
          categories: filters.categories?.length > 0 ? filters.categories.join(', ') : 'any',
          languages: filters.languages?.length > 0 ? filters.languages.join(', ') : 'any',
          employee: filters.employee ? (employees.find(emp => emp.id.toString() === filters.employee)?.name || 'NOT FOUND') : 'any'
        }
      });
      
      // Test query: Check if there are any leads with the selected stages (without other filters)
      if (selectedStageIdsNumeric.length > 0) {
        const { data: testStageLeads, error: testStageError } = await supabase
          .from('leads')
          .select('id, lead_number, stage')
          .in('stage', selectedStageIdsNumeric)
          .limit(5);
        console.log('🔍 DEBUG: Test query - leads with selected stages (no other filters)', {
          testStageLeads,
          testStageError,
          count: testStageLeads?.length || 0,
          sampleStages: testStageLeads?.map(l => ({ lead: l.lead_number, stage: l.stage })) || []
        });
      }

      // Test query: Check employee filter syntax
      if (filters.employee && filters.employee !== '--') {
        const employee = employees.find(emp => emp.id.toString() === filters.employee);
        if (employee) {
          const employeeIdStr = filters.employee;
          const employeeNameTrimmed = employee.name.trim();
          
          // Test 1: Filter by ID only
          const { data: testById, error: testByIdError } = await supabase
            .from('leads')
            .select('id, lead_number, closer')
            .eq('closer', employeeIdStr)
            .limit(3);
          
          // Test 2: Filter by name only (case-insensitive)
          const { data: testByName, error: testByNameError } = await supabase
            .from('leads')
            .select('id, lead_number, closer')
            .ilike('closer', `%${employeeNameTrimmed}%`)
            .limit(3);
          
          // Test 3: Filter using or() with both conditions
          const { data: testByOr, error: testByOrError } = await supabase
            .from('leads')
            .select('id, lead_number, closer')
            .or(`closer.eq.${employeeIdStr},closer.ilike.%${employeeNameTrimmed}%`)
            .limit(3);
          
          console.log('🔍 DEBUG: Employee filter test queries', {
            employeeId: employeeIdStr,
            employeeName: employeeNameTrimmed,
            testById: { count: testById?.length || 0, results: testById, error: testByIdError },
            testByName: { count: testByName?.length || 0, results: testByName, error: testByNameError },
            testByOr: { count: testByOr?.length || 0, results: testByOr, error: testByOrError }
          });
        }
      }
      
      const { data: newLeads, error: newLeadsError } = await newLeadsQuery.order('created_at', { ascending: false });

      console.log('🔍 DEBUG: New leads query result', {
        newLeadsCount: newLeads?.length || 0,
        newLeadsError: newLeadsError,
        hasError: !!newLeadsError,
        errorMessage: newLeadsError?.message
      });

      if (newLeadsError) {
        console.error('❌ ERROR: Error fetching new leads:', newLeadsError);
        // Continue with empty array - will still try to fetch legacy leads
      }

      // Fetch meeting dates for new leads from meetings table
      const newLeadIds = (newLeads || []).map((l: any) => l.id).filter(Boolean);
      const meetingDatesMap: Record<string, string> = {};

      if (newLeadIds.length > 0) {
        // Query in chunks to avoid oversized IN() lists that can drop matches.
        const CHUNK_SIZE = 500;
        for (let i = 0; i < newLeadIds.length; i += CHUNK_SIZE) {
          const chunk = newLeadIds.slice(i, i + CHUNK_SIZE);
          const { data: meetingsData, error: meetingsError } = await supabase
            .from('meetings')
            .select('client_id, meeting_date')
            .in('client_id', chunk)
            .or('status.is.null,status.neq.canceled')
            .order('meeting_date', { ascending: false });

          if (meetingsError) {
            console.error('❌ ERROR: Failed fetching new lead meetings chunk', {
              chunkStart: i,
              chunkSize: chunk.length,
              meetingsError,
            });
            continue;
          }

          if (meetingsData) {
            meetingsData.forEach((meeting: any) => {
              if (meeting.meeting_date && meeting.client_id) {
                const dateStr = typeof meeting.meeting_date === 'string'
                  ? meeting.meeting_date.split('T')[0]
                  : new Date(meeting.meeting_date).toISOString().split('T')[0];
                const key = String(meeting.client_id);
                // Keep the most recent meeting date for each lead
                if (!meetingDatesMap[key] || dateStr > meetingDatesMap[key]) {
                  meetingDatesMap[key] = dateStr;
                }
              }
            });
          }
        }
      }

      // Fetch follow-up dates for new leads (only current user's follow-ups)
      const followUpDatesMap: Record<string, string> = {};
      const followUpNotesMap: Record<string, string> = {};

      if (newLeadIds.length > 0 && effectiveCurrentUserId) {
        const { data: followUpsData } = await supabase
          .from('follow_ups')
          .select('new_lead_id, date')
          .eq('user_id', effectiveCurrentUserId)
          .in('new_lead_id', newLeadIds)
          .is('lead_id', null)
          .order('date', { ascending: false });

        if (followUpsData) {
          followUpsData.forEach((fu: any) => {
            if (fu.date && fu.new_lead_id) {
              const dateStr = typeof fu.date === 'string'
                ? fu.date.split('T')[0]
                : new Date(fu.date).toISOString().split('T')[0];
              const key = String(fu.new_lead_id);
              if (!followUpDatesMap[key]) {
                followUpDatesMap[key] = dateStr;
              }
            }
          });
        }
      }

      // Fetch tags for new leads
      const newTagsMap = new Map<string, string[]>();
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
          newTagsData.forEach((item: any) => {
            if (item.misc_leadtag) {
              const leadId = item.newlead_id;
              const tagName = (item.misc_leadtag as any).name;
              if (!newTagsMap.has(leadId)) {
                newTagsMap.set(leadId, []);
              }
              newTagsMap.get(leadId)!.push(tagName);
            }
          });
        }
      }

      // Filter new leads by meeting date if date filters are applied
      let filteredNewLeads = newLeads || [];
      if (applyDateFilters && (filters.fromDate || filters.toDate)) {
        filteredNewLeads = filteredNewLeads.filter((lead: any) => {
          const meetingDate = meetingDatesMap[String(lead.id)];
          if (!meetingDate) return false; // Exclude leads without meeting dates when filtering
          if (filters.fromDate && meetingDate < filters.fromDate) return false;
          if (filters.toDate && meetingDate > filters.toDate) return false;
          return true;
        });
      }


      // Apply employee filter client-side (closer field can contain either ID or name)
      // Use the same logic as SalesContributionPage.tsx: check type first, then match accordingly
      if (needsClientSideEmployeeFilter && employeeFilterId && employeeFilterName) {
        const beforeEmployeeFilter = filteredNewLeads.length;
        const employeeFilterIdNum = Number(employeeFilterId);
        const employeeFilterNameLower = employeeFilterName.toLowerCase().trim();
        
        // Sample a few leads to debug what closer values we're seeing
        const sampleLeads = filteredNewLeads.slice(0, 10).map((lead: any) => ({
          lead_number: lead.lead_number,
          closer: lead.closer,
          closerType: typeof lead.closer,
          closerString: String(lead.closer || '').trim(),
          closerAsNumber: Number(lead.closer),
          matchesById: Number(lead.closer) === employeeFilterIdNum,
          matchesByName: typeof lead.closer === 'string' && lead.closer.trim().toLowerCase() === employeeFilterNameLower
        }));
        console.log('🔍 DEBUG: Sample closer values before filtering', {
          employeeFilterId: employeeFilterId,
          employeeFilterIdNum,
          employeeFilterName: employeeFilterName,
          employeeFilterNameLower,
          sampleLeads
        });
        
        // Helper function to check if a value matches the employee (by ID or name)
        const matchesEmployee = (value: any): boolean => {
          if (!value) return false;
          
          // Try to match by ID first (works for both string "84" and number 84)
          const valueAsNumber = Number(value);
          if (!isNaN(valueAsNumber) && isFinite(valueAsNumber)) {
            if (valueAsNumber === employeeFilterIdNum) {
              return true;
            }
          }
          
          // Also try to match by name (works for string "Einat")
          if (typeof value === 'string') {
            const trimmed = value.trim().toLowerCase();
            if (trimmed === employeeFilterNameLower) {
              return true;
            }
          }
          
          return false;
        };
        
        // Count matches for debugging
        let matchedByCloser = 0;
        let matchedByScheduler = 0;
        let noRoles = 0;
        
        filteredNewLeads = filteredNewLeads.filter((lead: any) => {
          // Check both closer and scheduler fields (employee can be in either role)
          const matchesCloser = matchesEmployee(lead.closer);
          const matchesScheduler = matchesEmployee(lead.scheduler);
          
          if (matchesCloser) matchedByCloser++;
          if (matchesScheduler) matchedByScheduler++;
          if (!lead.closer && !lead.scheduler) noRoles++;
          
          return matchesCloser || matchesScheduler;
        });
        
        console.log('🔍 DEBUG: Employee filter match breakdown', {
          matchedByCloser,
          matchedByScheduler,
          noRoles,
          totalFiltered: filteredNewLeads.length
        });
        
        console.log('🔍 DEBUG: Applied client-side employee filter', {
          employeeId: employeeFilterId,
          employeeIdNum: employeeFilterIdNum,
          employeeName: employeeFilterName,
          employeeNameLower: employeeFilterNameLower,
          beforeFilter: beforeEmployeeFilter,
          afterFilter: filteredNewLeads.length,
          sampleLeads
        });
      }

      if (filteredNewLeads) {
        filteredNewLeads.forEach((lead: any) => {
          // Convert expert_notes array to string
          let expertOpinionText = '---';
          if (lead.expert_notes) {
            if (Array.isArray(lead.expert_notes)) {
              expertOpinionText = lead.expert_notes
                .map((note: any) => note?.content || note)
                .filter(Boolean)
                .join('; ') || '---';
            } else if (typeof lead.expert_notes === 'string') {
              expertOpinionText = lead.expert_notes;
            } else if (lead.expert_notes?.content) {
              expertOpinionText = lead.expert_notes.content;
            }
          }

          // Convert management_notes to string
          let managerNotesText = '---';
          if (lead.management_notes) {
            if (Array.isArray(lead.management_notes)) {
              managerNotesText = lead.management_notes
                .map((note: any) => note?.content || note)
                .filter(Boolean)
                .join('; ') || '---';
            } else if (typeof lead.management_notes === 'string') {
              managerNotesText = lead.management_notes;
            } else if (lead.management_notes?.content) {
              managerNotesText = lead.management_notes.content;
            }
          }

          // Process currency data from joined table (same as CalendarPage.tsx)
          // Always prioritize joined currency data over database balance_currency field
          let balanceCurrency = '₪'; // Default
          const currencyRecord = (lead as any).accounting_currencies
            ? (Array.isArray((lead as any).accounting_currencies) ? (lead as any).accounting_currencies[0] : (lead as any).accounting_currencies)
            : null;

          if (currencyRecord && currencyRecord.name) {
            // Use name directly - it contains the symbol (₪, $, €, £)
            balanceCurrency = currencyRecord.name;
          } else if ((lead as any).currency_id) {
            // If no joined currency data but we have currency_id, use fallback mapping
            const currencyId = Number((lead as any).currency_id);
            switch (currencyId) {
              case 1: balanceCurrency = '₪'; break;
              case 2: balanceCurrency = '€'; break;
              case 3: balanceCurrency = '$'; break;
              case 4: balanceCurrency = '£'; break;
              default: balanceCurrency = '₪';
            }
          } else if (lead.balance_currency) {
            // Last resort: use balance_currency from database if it exists
            // But convert codes to symbols if needed
            const dbCurrency = lead.balance_currency;
            if (dbCurrency === 'NIS' || dbCurrency === 'ILS') balanceCurrency = '₪';
            else if (dbCurrency === 'USD') balanceCurrency = '$';
            else if (dbCurrency === 'EUR') balanceCurrency = '€';
            else if (dbCurrency === 'GBP') balanceCurrency = '£';
            else if (dbCurrency === 'CAD') balanceCurrency = 'C$';
            else if (dbCurrency === 'AUD') balanceCurrency = 'A$';
            else if (dbCurrency === 'JPY') balanceCurrency = '¥';
            // If it's already a symbol, use it as is
            else if (['₪', '$', '€', '£', 'C$', 'A$', '¥'].includes(dbCurrency)) balanceCurrency = dbCurrency;
            else balanceCurrency = '₪'; // Unknown format, default to NIS
          }

          // Determine if this is a master lead or sublead
          // Sublead: has master_id set OR lead_number contains "/" (pattern like "L209667/1")
          const hasMasterId = lead.master_id !== null && lead.master_id !== undefined && String(lead.master_id).trim() !== '';
          const hasSlashInNumber = lead.lead_number?.includes('/') || false;
          const isSubLead = hasMasterId || hasSlashInNumber;
          // Master lead: no master_id and lead_number doesn't contain "/"
          // (Note: To fully confirm it's a master lead, we'd need to check if it has subleads, but this is a good indicator)
          const isMasterLead = !isSubLead;

          const newTagsFromJoin = (lead.leads_lead_tags || [])
            .map((t: any) => (t.misc_leadtag?.name ?? (Array.isArray(t.misc_leadtag) ? t.misc_leadtag[0]?.name : null)))
            .filter(Boolean)
            .join(', ');
          allLeads.push({
            ...lead,
            lead_type: 'new',
            eligibility_raw: lead.eligible,
            eligibility_status: lead.eligibility_status ?? null,
            eligibility_status_timestamp: lead.eligibility_status_timestamp ?? null,
            eligibility_status_last_edited_at: lead.eligibility_status_last_edited_at ?? null,
            stage: getStageNameFromJoin(lead) || getStageName(lead.stage),
            category: getCategoryDisplayFromJoin(lead) || '---',
            expert_opinion: expertOpinionText,
            manager_notes: managerNotesText,
            closer: resolveEmployeeDisplay(lead.closer),
            scheduler: resolveEmployeeDisplay(lead.scheduler),
            meeting_date: meetingDatesMap[lead.id] || null,
            follow_up_date: followUpDatesMap[String(lead.id)] || null,
            follow_up_notes: lead.followup_log || followUpNotesMap[String(lead.id)] || null,
            latest_interaction: lead.latest_interaction || null,
            balance_currency: balanceCurrency,
            currency_id: (lead as any).currency_id,
            total: lead.balance || '',
            tags: newTagsFromJoin || newTagsMap.get(lead.id)?.join(', ') || '',
            master_id: lead.master_id || null,
            is_master_lead: isMasterLead,
            is_sub_lead: isSubLead,
          });
        });
      }

      // Fetch legacy leads
      // Get selected stages for legacy (convert to numbers) - only if stages are selected
      const selectedLegacyStageIds = selectedStageIds.length > 0
        ? selectedStageIds.map(id => Number(id)).filter(id => !isNaN(id))
        : [];

      console.log('🔍 DEBUG: Starting legacy leads query', {
        minProbability: filters.minProbability,
        maxProbability: filters.maxProbability,
        minProbabilityType: typeof filters.minProbability,
        maxProbabilityType: typeof filters.maxProbability,
        minProbabilityNumber: Number(filters.minProbability),
        maxProbabilityNumber: Number(filters.maxProbability),
        selectedLegacyStageIds,
        applyDateFilters,
        filters
      });

      let legacyLeadsQuery = supabase
        .from('leads_lead')
        .select(`
          id,
          name,
          cdate,
          latest_interaction,
          closer_id,
          meeting_scheduler_id,
          expert_id,
          meeting_manager_id,
          category_id,
          stage,
          eligibile,
          probability,
          language_id,
          no_of_applicants,
          potential_applicants,
          total,
          total_base,
          currency_id,
          master_id,
          accounting_currencies!leads_lead_currency_id_fkey (
            id,
            name,
            iso_code
          ),
          lead_stages!fk_leads_lead_stage (
            id,
            name,
            colour
          ),
          misc_category!leads_lead_category_id_fkey (
            id,
            name,
            parent_id,
            misc_maincategory!parent_id (
              id,
              name
            )
          ),
          misc_language!leads_lead_language_id_fkey (
            id,
            name
          ),
          closer_emp:tenants_employee!fk_leads_lead_closer_id (
            id,
            display_name
          ),
          scheduler_emp:tenants_employee!fk_leads_lead_meeting_scheduler_id (
            id,
            display_name
          ),
          expert_emp:tenants_employee!fk_leads_lead_expert_id (
            id,
            display_name
          ),
          manager_emp:tenants_employee!fk_leads_lead_meeting_manager_id (
            id,
            display_name
          ),
          leads_lead_tags (
            misc_leadtag (
              name
            )
          ),
          expert_notes,
          management_notes,
          meeting_date,
          followup_log,
          eligibility_status,
          eligibility_status_timestamp,
          eligibility_status_last_edited_at
        `)
        .not('probability', 'is', null) // Exclude null probabilities
        .neq('probability', '') // Exclude empty strings
        .eq('status', 0); // Only active leads

      // Apply stage filter for legacy leads - use selected stages
      // Only apply filter if stages are selected (no hardcoded default)
      if (selectedLegacyStageIds.length > 0) {
        console.log('🔍 DEBUG: Applying stage filter to legacy leads query', {
          selectedStageIds,
          selectedLegacyStageIds,
          stageFilterWillBe: `stage.in(${selectedLegacyStageIds.join(',')})`
        });
        legacyLeadsQuery = legacyLeadsQuery.in('stage', selectedLegacyStageIds);
      } else {
        console.log('🔍 DEBUG: No stage filter applied to legacy leads - showing all stages (user has not selected any stages)');
      }

      // Apply closer_id filter (only if not filtering for NULL)
      if (filters.employee !== '--') {
        legacyLeadsQuery = legacyLeadsQuery.not('closer_id', 'is', null); // Only leads with closer assigned
      }

      // Do not filter legacy meeting dates at query level.
      // We apply date range client-side using the latest meeting from `meetings` per lead.

      // Apply category filter (main category - need to filter by all subcategories)
      if (filters.categories && filters.categories.length > 0) {
        // Collect all subcategory IDs for all selected main categories
        const allSubCategoryIds: number[] = [];
        for (const categoryId of filters.categories) {
          const { data: subCategories } = await supabase
            .from('misc_category')
            .select('id')
            .eq('parent_id', categoryId);

          if (subCategories && subCategories.length > 0) {
            allSubCategoryIds.push(...subCategories.map(sc => sc.id));
          }
        }
        if (allSubCategoryIds.length > 0) {
          legacyLeadsQuery = legacyLeadsQuery.in('category_id', allSubCategoryIds);
        } else {
          // If no subcategories found, return no results
          legacyLeadsQuery = legacyLeadsQuery.eq('category_id', -1); // Non-existent ID
        }
      }

      // Apply language filter
      if (filters.languages && filters.languages.length > 0) {
        const languageIds = filters.languages.map(lang => Number(lang));
        legacyLeadsQuery = legacyLeadsQuery.in('language_id', languageIds);
      }

      // Apply created date filter for legacy leads (cdate)
      if (filters.createdFromDate) {
        legacyLeadsQuery = legacyLeadsQuery.gte('cdate', filters.createdFromDate);
      }
      if (filters.createdToDate) {
        legacyLeadsQuery = legacyLeadsQuery.lte('cdate', filters.createdToDate + 'T23:59:59');
      }

      // Match LeadSearchPage behavior exactly.
      if (filters.eligibilityDeterminedOnly) {
        legacyLeadsQuery = legacyLeadsQuery.eq('eligibile', 'true');
      }

      // Apply employee filter (closer)
      if (filters.employee) {
        if (filters.employee === '--') {
          // Show NULL closer_id or NULL meeting_scheduler_id entries
          legacyLeadsQuery = legacyLeadsQuery.or('closer_id.is.null,meeting_scheduler_id.is.null');
        } else {
          console.log('🔍 DEBUG: Applying employee filter to legacy leads', { employee: filters.employee });
          legacyLeadsQuery = legacyLeadsQuery.eq('closer_id', Number(filters.employee));
        }
      }

      console.log('🔍 DEBUG: Executing legacy leads query...');

      // Test query first to see if it returns any results (limit 1)
      const { data: testQueryResults, error: testQueryError } = await legacyLeadsQuery
        .order('cdate', { ascending: false })
        .limit(1);
      
      console.log('🔍 DEBUG: Test query (limit 1) before pagination', {
        foundResults: testQueryResults?.length || 0,
        error: testQueryError,
        sampleResult: testQueryResults?.[0] || null
      });

      // Fetch all results using pagination to avoid 1000 limit
      let allLegacyLeads: any[] = [];
      let hasMore = true;
      let page = 0;
      const pageSize = 1000;

      while (hasMore) {
        const { data: pageResults, error: pageError } = await legacyLeadsQuery
          .order('cdate', { ascending: false })
          .range(page * pageSize, (page + 1) * pageSize - 1);

        if (pageError) {
          console.error('🔍 DEBUG: Error fetching legacy leads page', { page, error: pageError });
          break;
        }

        if (pageResults && pageResults.length > 0) {
          allLegacyLeads = [...allLegacyLeads, ...pageResults];
          hasMore = pageResults.length === pageSize;
          page++;

        } else {
          hasMore = false;
        }

        // Safety limit to prevent infinite loops
        if (page > 10) {
          console.warn('🔍 DEBUG: Stopping pagination at 10 pages (10,000 leads)');
          break;
        }
      }

      const legacyLeads = allLegacyLeads;
      const legacyLeadsError = null;

      console.log('🔍 DEBUG: Paginated query complete', {
        totalLeadsFetched: legacyLeads.length,
        pagesFetched: page
      });

      console.log('🔍 DEBUG: Legacy leads query result (before probability filter)', {
        legacyLeadsCount: legacyLeads?.length || 0,
        legacyLeadsError: legacyLeadsError,
        hasError: !!legacyLeadsError,
        errorMessage: legacyLeadsError ? (legacyLeadsError as any).message : null,
        sampleProbabilities: legacyLeads?.slice(0, 5).map((l: any) => ({ id: l.id, probability: l.probability, probabilityType: typeof l.probability, probabilityNumber: Number(l.probability) })) || []
      });

      // Filter by probability client-side since probability is stored as text in leads_lead
      let filteredLegacyLeads = legacyLeads || [];
      if (legacyLeads && legacyLeads.length > 0) {
        filteredLegacyLeads = legacyLeads.filter((lead: any) => {
          const probValue = Number(lead.probability);
          const isValidNumber = !isNaN(probValue) && lead.probability !== null && lead.probability !== '';

          if (!isValidNumber) return false;
          return probValue >= Number(filters.minProbability) && probValue <= Number(filters.maxProbability);
        });

        console.log('🔍 DEBUG: After probability filter', {
          beforeFilter: legacyLeads.length,
          afterFilter: filteredLegacyLeads.length,
          minProbability: filters.minProbability,
          maxProbability: filters.maxProbability
        });
      }


      // Start with probability-filtered legacy leads. Date range is applied below after
      // resolving latest meeting date from meetings table per lead.
      let legacyLeadsToProcess = filteredLegacyLeads;

      if (legacyLeadsError) {
        console.error('❌ ERROR: Error fetching legacy leads:', legacyLeadsError);
        // Don't return early - continue with empty array for legacy leads but still show new leads
        // setResults([]);
        // setIsSearching(false);
        // return;
      }

      // For legacy leads, also check meetings table for meeting dates (in case meeting_date in leads_lead is null)
      const legacyLeadIds = (legacyLeadsToProcess || []).map((l: any) => l.id).filter(Boolean);
      console.log('🔍 DEBUG: Legacy lead IDs extracted', { legacyLeadIdsCount: legacyLeadIds.length, legacyLeadIds: legacyLeadIds.slice(0, 5) });
      const legacyMeetingDatesMap: Record<number, string> = {};

      if (legacyLeadIds.length > 0) {
        const { data: legacyMeetingsData } = await supabase
          .from('meetings')
          .select('legacy_lead_id, meeting_date')
          .in('legacy_lead_id', legacyLeadIds)
          .or('status.is.null,status.neq.canceled')
          .order('meeting_date', { ascending: false });

        if (legacyMeetingsData) {
          legacyMeetingsData.forEach((meeting: any) => {
            if (meeting.meeting_date && meeting.legacy_lead_id) {
              const dateStr = typeof meeting.meeting_date === 'string'
                ? meeting.meeting_date.split('T')[0]
                : new Date(meeting.meeting_date).toISOString().split('T')[0];
              // Keep the most recent meeting date for each lead
              if (!legacyMeetingDatesMap[meeting.legacy_lead_id] || dateStr > legacyMeetingDatesMap[meeting.legacy_lead_id]) {
                legacyMeetingDatesMap[meeting.legacy_lead_id] = dateStr;
              }
            }
          });
        }
      }

      // Filter legacy leads by date using latest meeting date from `meetings` table.
      if (applyDateFilters && (filters.fromDate || filters.toDate)) {
        legacyLeadsToProcess = legacyLeadsToProcess.filter((lead: any) => {
          const meetingDate = legacyMeetingDatesMap[lead.id]
            || (lead.meeting_date
              ? (typeof lead.meeting_date === 'string'
                ? lead.meeting_date.split('T')[0]
                : new Date(lead.meeting_date).toISOString().split('T')[0])
              : null);
          if (!meetingDate) return false;
          if (filters.fromDate && meetingDate < filters.fromDate) return false;
          if (filters.toDate && meetingDate > filters.toDate) return false;
          return true;
        });
      }

      const legacyLeadIdsForFollowUps = (legacyLeadsToProcess || []).map((l: any) => l.id).filter(Boolean);

      // Fetch follow-up dates for legacy leads (only current user's follow-ups)
      const legacyFollowUpDatesMap: Record<number, string> = {};
      const legacyFollowUpNotesMap: Record<number, string> = {};

      if (legacyLeadIdsForFollowUps.length > 0 && effectiveCurrentUserId) {
        const { data: legacyFollowUpsData } = await supabase
          .from('follow_ups')
          .select('lead_id, date')
          .eq('user_id', effectiveCurrentUserId)
          .in('lead_id', legacyLeadIdsForFollowUps)
          .is('new_lead_id', null)
          .order('date', { ascending: false });

        if (legacyFollowUpsData) {
          legacyFollowUpsData.forEach((fu: any) => {
            if (fu.date && fu.lead_id) {
              const dateStr = typeof fu.date === 'string'
                ? fu.date.split('T')[0]
                : new Date(fu.date).toISOString().split('T')[0];
              if (!legacyFollowUpDatesMap[fu.lead_id]) {
                legacyFollowUpDatesMap[fu.lead_id] = dateStr;
              }
            }
          });
        }
      }

      // Tags for legacy leads come from join leads_lead_tags (misc_leadtag) in the main query

      if (legacyLeadsToProcess && legacyLeadsToProcess.length > 0) {
        // Stage, category, language, employees and currency come from joins (no separate fetches)
        console.log('🔍 DEBUG: Processing legacy leads', { legacyLeadsCount: legacyLeadsToProcess?.length || 0 });

        legacyLeadsToProcess.forEach((lead: any) => {
          // Convert expert_notes array to string
          let expertOpinionText = '---';
          if (lead.expert_notes) {
            if (Array.isArray(lead.expert_notes)) {
              expertOpinionText = lead.expert_notes
                .map((note: any) => note?.content || note)
                .filter(Boolean)
                .join('; ') || '---';
            } else if (typeof lead.expert_notes === 'string') {
              expertOpinionText = lead.expert_notes;
            } else if (lead.expert_notes?.content) {
              expertOpinionText = lead.expert_notes.content;
            }
          }

          // Convert management_notes to string
          let managerNotesText = '---';
          if (lead.management_notes) {
            if (Array.isArray(lead.management_notes)) {
              managerNotesText = lead.management_notes
                .map((note: any) => note?.content || note)
                .filter(Boolean)
                .join('; ') || '---';
            } else if (typeof lead.management_notes === 'string') {
              managerNotesText = lead.management_notes;
            } else if (lead.management_notes?.content) {
              managerNotesText = lead.management_notes.content;
            }
          }

          // Get meeting date - prefer from meetings table, fallback to leads_lead.meeting_date
          let meetingDate: string | null = null;
          if (legacyMeetingDatesMap[lead.id]) {
            meetingDate = legacyMeetingDatesMap[lead.id];
          } else if (lead.meeting_date) {
            meetingDate = typeof lead.meeting_date === 'string'
              ? lead.meeting_date.split('T')[0]
              : new Date(lead.meeting_date).toISOString().split('T')[0];
          }

          // Extract currency data from joined table - USE NAME DIRECTLY (like edit drawer does)
          // The accounting_currencies.name column contains the symbol (₪, $, €, £)
          let balanceCurrency = '₪';
          const currencyRecord = lead.accounting_currencies
            ? (Array.isArray(lead.accounting_currencies) ? lead.accounting_currencies[0] : lead.accounting_currencies)
            : null;

          if (currencyRecord && currencyRecord.name) {
            // Use name directly - it contains the symbol (₪, $, €, £)
            balanceCurrency = currencyRecord.name;
          } else if (lead.currency_id) {
            // Fallback: if no joined data, use currency_id mapping
            const currencyId = Number(lead.currency_id);
            switch (currencyId) {
              case 1: balanceCurrency = '₪'; break;
              case 2: balanceCurrency = '€'; break;
              case 3: balanceCurrency = '$'; break;
              case 4: balanceCurrency = '£'; break;
              default: balanceCurrency = '₪';
            }
          }

          // Determine if this is a master lead or sublead for legacy leads
          // Sublead: has master_id set
          const isLegacySubLead = lead.master_id !== null && lead.master_id !== undefined && String(lead.master_id).trim() !== '';
          // Master lead: no master_id
          // (Note: To fully confirm it's a master lead, we'd need to check if it has subleads, but this is a good indicator)
          const isLegacyMasterLead = !isLegacySubLead;

          const closerDisplay = lead.closer_emp ? (Array.isArray(lead.closer_emp) ? lead.closer_emp[0]?.display_name : lead.closer_emp?.display_name) : null;
          const schedulerDisplay = lead.scheduler_emp ? (Array.isArray(lead.scheduler_emp) ? lead.scheduler_emp[0]?.display_name : lead.scheduler_emp?.display_name) : null;
          const expertDisplay = lead.expert_emp ? (Array.isArray(lead.expert_emp) ? lead.expert_emp[0]?.display_name : lead.expert_emp?.display_name) : null;
          const managerDisplay = lead.manager_emp ? (Array.isArray(lead.manager_emp) ? lead.manager_emp[0]?.display_name : lead.manager_emp?.display_name) : null;
          const legacyTagsFromJoin = (lead.leads_lead_tags || [])
            .map((t: any) => (t.misc_leadtag?.name ?? (Array.isArray(t.misc_leadtag) ? t.misc_leadtag[0]?.name : null)))
            .filter(Boolean)
            .join(', ');

          allLeads.push({
            id: `legacy_${lead.id}`,
            lead_number: lead.id?.toString() || '',
            name: lead.name || '',
            created_at: lead.cdate || new Date().toISOString(),
            closer: closerDisplay || '---',
            scheduler: schedulerDisplay || '---',
            expert: expertDisplay || '---',
            manager: managerDisplay || '---',
            category: getCategoryDisplayFromJoin(lead) || '---',
            category_id: lead.category_id,
            stage: getStageNameFromJoin(lead) || getStageName(lead.stage),
            probability: lead.probability || 0,
            language: getLanguageDisplayFromJoin(lead) || (lead.language_id ? `Language #${lead.language_id}` : null),
            number_of_applicants_meeting: lead.no_of_applicants || 0,
            potential_applicants_meeting: lead.potential_applicants || 0,
            total: lead.total || '',
            balance_currency: balanceCurrency,
            currency_id: lead.currency_id,
            total_base: lead.total_base,
            expert_opinion: expertOpinionText,
            master_id: lead.master_id || null,
            is_master_lead: isLegacyMasterLead,
            is_sub_lead: isLegacySubLead,
            manager_notes: managerNotesText,
            lead_type: 'legacy',
            eligibility_raw: lead.eligibile,
            eligibility_status: lead.eligibility_status ?? null,
            eligibility_status_timestamp: lead.eligibility_status_timestamp ?? null,
            eligibility_status_last_edited_at: lead.eligibility_status_last_edited_at ?? null,
            meeting_date: meetingDate,
            follow_up_date: legacyFollowUpDatesMap[lead.id] || null,
            follow_up_notes: legacyFollowUpNotesMap[lead.id] || lead.followup_log || null,
            latest_interaction: lead.latest_interaction || null,
            tags: legacyTagsFromJoin || '',
          });
        });
      } else {
        console.log('🔍 DEBUG: No legacy leads to process (legacyLeadsToProcess is null or empty)');
      }

      console.log('🔍 DEBUG: Before sorting', {
        allLeadsCount: allLeads.length,
        newLeadsCount: allLeads.filter((l: any) => l.lead_type === 'new').length,
        legacyLeadsCount: allLeads.filter((l: any) => l.lead_type === 'legacy').length
      });

      // Apply tags filter client-side (if filter is set)
      let filteredAllLeads = allLeads;
      if (filters.tags && filters.tags.length > 0) {
        filteredAllLeads = filteredAllLeads.filter((lead: any) => {
          const leadTags = lead.tags || '';
          if (!leadTags || leadTags.trim() === '') return false;
          // Check if any of the selected tags are in the lead's tags
          return filters.tags.some(tag =>
            leadTags.toLowerCase().includes(tag.toLowerCase())
          );
        });
      }

      // Sort by probability (highest first), then by created_at (newest first)
      const sortedLeads = filteredAllLeads.sort((a, b) => {
        const probA = a.probability || 0;
        const probB = b.probability || 0;
        if (probB !== probA) {
          return probB - probA; // Higher probability first
        }
        // If probabilities are equal, sort by created_at (newest first)
        const dateA = new Date(a.created_at || 0).getTime();
        const dateB = new Date(b.created_at || 0).getTime();
        return dateB - dateA;
      });

      console.log('🔍 DEBUG: Final results', {
        sortedLeadsCount: sortedLeads.length,
        newLeadsCount: sortedLeads.filter((l: any) => l.lead_type === 'new').length,
        legacyLeadsCount: sortedLeads.filter((l: any) => l.lead_type === 'legacy').length
      });

      // Set results - sorting will be applied via useEffect if sortColumn is set
      setResults(sortedLeads);
    } catch (error: any) {
      console.error('Error in CloserSuperPipelinePage:', error);
      toast.error(`Error fetching leads: ${error?.message || 'Unknown error'}`);
      setResults([]); // Set empty results on error
    } finally {
      setIsSearching(false);
    }
  };

  // Automatically load leads on first visit only. When returning to the page (e.g. back from a lead),
  // keep persisted results and filters — do not run search or we overwrite saved state with default table.
  useEffect(() => {
    if (results.length > 0 && searchPerformed) {
      return; // Restored from sessionStorage — don't run search
    }
    handleSearch(false); // Pass false to skip date filters on initial load
    setSearchPerformed(true); // Show the table with initial results
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty dependency array means this runs once on mount

  // Sync search inputs with selected filters - categories now handled by chips display
  // Search input is only for filtering dropdown options

  useEffect(() => {
    if (filters.employee) {
      if (filters.employee === '--') {
        setEmployeeSearch('--');
      } else {
        const selectedEmployee = employees.find(emp => emp.id.toString() === filters.employee);
        setEmployeeSearch(selectedEmployee ? selectedEmployee.name : '');
      }
    } else {
      setEmployeeSearch('');
    }
  }, [filters.employee, employees]);

  // Languages now handled by chips display - search input is only for filtering dropdown options

  // Apply sorting when sortColumn or sortDirection changes
  useEffect(() => {
    if (results.length > 0) {
      const sorted = sortResults([...results]);
      setResults(sorted);
    }
  }, [sortColumn, sortDirection, sortResults]);

  // Filter options based on search
  const filteredCategories = categories.filter((cat: any) => {
    const searchTerm = categorySearch.toLowerCase();
    const catName = cat.name?.toLowerCase() || '';
    return catName.includes(searchTerm);
  });

  const filteredEmployees = employees.filter((emp: any) =>
    emp.name.toLowerCase().includes(employeeSearch.toLowerCase())
  );

  const filteredLanguages = languages.filter((lang: any) =>
    lang.name.toLowerCase().includes(languageSearch.toLowerCase())
  );

  const filteredStages = stages.filter((stage: any) =>
    stage.name.toLowerCase().includes(stageSearch.toLowerCase())
  );

  // Get unique tags from results for tags filter dropdown
  const getUniqueTags = () => {
    const allTags = new Set<string>();
    results.forEach((lead: any) => {
      if (lead.tags) {
        lead.tags.split(', ').forEach((tag: string) => {
          if (tag.trim()) {
            allTags.add(tag.trim());
          }
        });
      }
    });
    return Array.from(allTags).sort();
  };

  const uniqueTags = getUniqueTags();
  const filteredTags = uniqueTags.filter((tag: string) =>
    tag.toLowerCase().includes(tagsSearch.toLowerCase())
  );

  // Helper function to format lead number display (same logic as Clients.tsx)
  // Calculate legacy sublead suffixes based on results
  const calculateLegacySubleadSuffixes = useCallback(() => {
    const suffixMap = new Map<number, Map<number, number>>(); // master_id -> (lead_id -> suffix)

    // Group legacy leads by master_id
    const legacyLeadsByMaster = new Map<number, any[]>();
    results.forEach((lead: any) => {
      const isLegacy = lead.lead_type === 'legacy' || lead.id?.toString().startsWith('legacy_');
      if (isLegacy && lead.master_id) {
        const masterId = Number(lead.master_id);
        if (!isNaN(masterId)) {
          if (!legacyLeadsByMaster.has(masterId)) {
            legacyLeadsByMaster.set(masterId, []);
          }
          legacyLeadsByMaster.get(masterId)!.push(lead);
        }
      }
    });

    // For each master_id, assign suffixes starting from 2
    legacyLeadsByMaster.forEach((subleads, masterId) => {
      // Sort by lead ID to ensure consistent ordering
      subleads.sort((a, b) => {
        const idA = Number(a.id?.toString().replace('legacy_', '') || a.lead_number || 0);
        const idB = Number(b.id?.toString().replace('legacy_', '') || b.lead_number || 0);
        return idA - idB;
      });

      const masterSuffixMap = new Map<number, number>();
      subleads.forEach((sublead, index) => {
        const leadId = Number(sublead.id?.toString().replace('legacy_', '') || sublead.lead_number || 0);
        const suffix = index + 2; // First sublead is /2, second is /3, etc.
        masterSuffixMap.set(leadId, suffix);
      });
      suffixMap.set(masterId, masterSuffixMap);
    });

    return suffixMap;
  }, [results]);

  const legacySubleadSuffixMap = calculateLegacySubleadSuffixes();

  // New leads: sublead suffixes by master_id (same pattern as legacy and CalendarPage)
  // master_id -> (lead_id -> suffix 2, 3, 4...); master leads get no suffix
  const calculateNewLeadSubleadSuffixes = useCallback(() => {
    const suffixMap = new Map<number | string, Map<number | string, number>>();
    const newLeadsByMaster = new Map<number | string, any[]>();
    results.forEach((lead: any) => {
      const isLegacy = lead.lead_type === 'legacy' || lead.id?.toString().startsWith('legacy_');
      if (isLegacy || !lead.master_id || String(lead.master_id).trim() === '') return;
      const masterId = lead.master_id;
      if (!newLeadsByMaster.has(masterId)) {
        newLeadsByMaster.set(masterId, []);
      }
      newLeadsByMaster.get(masterId)!.push(lead);
    });
    newLeadsByMaster.forEach((subleads, masterId) => {
      subleads.sort((a: any, b: any) => {
        const idA = a.id != null ? Number(a.id) : NaN;
        const idB = b.id != null ? Number(b.id) : NaN;
        if (!isNaN(idA) && !isNaN(idB)) return idA - idB;
        return String(a.id ?? '').localeCompare(String(b.id ?? ''));
      });
      const masterSuffixMap = new Map<number | string, number>();
      subleads.forEach((sublead: any, index: number) => {
        const leadId = sublead.id;
        masterSuffixMap.set(leadId, index + 2); // First sublead /2, second /3, etc.
      });
      suffixMap.set(masterId, masterSuffixMap);
    });
    return suffixMap;
  }, [results]);

  const newLeadSubleadSuffixMap = calculateNewLeadSubleadSuffixes();

  const getDisplayLeadNumber = (lead: any): string => {
    if (!lead) return '---';

    const isLegacy = lead.lead_type === 'legacy' || lead.id?.toString().startsWith('legacy_');

    if (isLegacy) {
      // For legacy leads
      const leadId = lead.lead_number || lead.id?.toString().replace('legacy_', '') || '---';
      const masterId = lead.master_id;

      // If master_id is null/empty, it's a master lead - return just the ID (no /1)
      if (!masterId || String(masterId).trim() === '') {
        return leadId;
      }

      // If master_id exists, it's a sub-lead - get suffix from map
      const masterIdNum = Number(masterId);
      if (!isNaN(masterIdNum)) {
        const masterSuffixMap = legacySubleadSuffixMap.get(masterIdNum);
        if (masterSuffixMap) {
          const leadIdNum = Number(leadId);
          if (!isNaN(leadIdNum)) {
            const suffix = masterSuffixMap.get(leadIdNum);
            if (suffix !== undefined) {
              return `${masterIdNum}/${suffix}`;
            }
          }
        }
      }

      // Fallback: show master_id/? if suffix not found
      return `${masterId}/?`;
    } else {
      // For new leads (align with CalendarPage: master = no suffix, sublead = masterBase/suffix)
      let baseNumber = (lead.manual_id || lead.lead_number || lead.id || '---').toString();
      const hasExistingSuffix = baseNumber.includes('/');
      if (hasExistingSuffix) baseNumber = baseNumber.split('/')[0];

      const stageName = typeof lead.stage === 'string' ? lead.stage : String(lead.stage || '');
      const isSuccessStage = stageName.toLowerCase().includes('success') ||
        stageName === '100' ||
        (typeof lead.stage === 'number' && lead.stage === 100);
      if (isSuccessStage && baseNumber && !baseNumber.toString().startsWith('C')) {
        baseNumber = baseNumber.toString().replace(/^L/, 'C');
      }

      const hasNoMasterId = !lead.master_id || String(lead.master_id).trim() === '';
      const isSubLead = !hasNoMasterId;

      if (isSubLead) {
        // Sublead: show masterBase/suffix (e.g. L209667/2, /3...) like CalendarPage
        const masterId = lead.master_id;
        const master = results.find((l: any) => !l.id?.toString().startsWith('legacy_') && (l.id === masterId || String(l.id) === String(masterId)));
        const masterBase = master
          ? (master.manual_id || master.lead_number || master.id || '').toString().split('/')[0]
          : String(masterId);
        const suffixMap = newLeadSubleadSuffixMap.get(masterId);
        const suffix = suffixMap?.get(lead.id);
        if (suffix !== undefined) {
          const displayBase = isSuccessStage && masterBase && !masterBase.startsWith('C')
            ? masterBase.replace(/^L/, 'C')
            : masterBase;
          return `${displayBase}/${suffix}`;
        }
        // Fallback: if lead_number already has / use it, else masterBase/2
        const raw = (lead.lead_number || '').toString();
        if (raw.includes('/')) return isSuccessStage && !raw.startsWith('C') ? raw.replace(/^L/, 'C') : raw;
        return `${baseNumber}/2`;
      }

      // Master lead: show number as-is (no /1), same as CalendarPage
      return baseNumber;
    }
  };

  // Update stage search for filtering dropdown options
  // Note: Selected stages are now displayed as chips in the input field
  // This search is only for filtering the dropdown options

  // Tags now handled by chips display - search input is only for filtering dropdown options

  return (
    <div className="px-2 py-6">
      <h2 className="text-2xl font-bold mb-6 px-4">Sales Pipeline</h2>

      {/* Filters */}
      <div className="mb-6 px-4">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-10 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">From Date (Meeting Date)</label>
            <input
              type="date"
              value={filters.fromDate}
              onChange={(e) => handleFilterChange('fromDate', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">To Date (Meeting Date)</label>
            <input
              type="date"
              value={filters.toDate}
              onChange={(e) => handleFilterChange('toDate', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">From Date (Created Date)</label>
            <input
              type="date"
              value={filters.createdFromDate}
              onChange={(e) => handleFilterChange('createdFromDate', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">To Date (Created Date)</label>
            <input
              type="date"
              value={filters.createdToDate}
              onChange={(e) => handleFilterChange('createdToDate', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="relative">
            <label className="block text-sm font-medium text-gray-700 mb-1">Category (Multi-select)</label>
            <input
              type="text"
              className="w-full mb-2 px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Search categories..."
              value={categorySearch}
              onChange={(e) => {
                setCategorySearch(e.target.value);
                if (!showCategoryDropdown) {
                  setShowCategoryDropdown(true);
                }
              }}
              onFocus={() => setShowCategoryDropdown(true)}
            />
            <div
              className="w-full min-h-[42px] px-3 py-2 border border-gray-300 rounded-md focus-within:outline-none focus-within:ring-2 focus-within:ring-blue-500 cursor-text flex flex-wrap gap-2 items-center"
              onClick={() => setShowCategoryDropdown(true)}
            >
              {filters.categories && filters.categories.length > 0 ? (
                filters.categories.map((categoryId) => {
                  const category = categories.find(c => c.id.toString() === categoryId.toString());
                  if (!category) return null;
                  return (
                    <div
                      key={categoryId}
                      className="badge badge-primary badge-sm flex items-center gap-1"
                    >
                      <span>{category.name}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleCategorySelection(categoryId.toString());
                        }}
                        className="ml-1 hover:bg-primary-focus rounded-full p-0.5"
                      >
                        <XMarkIcon className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })
              ) : (
                <span className="text-gray-400 text-sm">Click to select categories...</span>
              )}
            </div>
            {showCategoryDropdown && (
              <>
                <div
                  className="fixed inset-0 z-[5]"
                  onClick={() => setShowCategoryDropdown(false)}
                />
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                  <div
                    className="px-4 py-2 cursor-pointer hover:bg-gray-100 text-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setFilters(prev => ({ ...prev, categories: [] }));
                      setCategorySearch('');
                    }}
                  >
                    Clear All
                  </div>
                  <div className="border-t border-gray-200 my-1"></div>
                  {filteredCategories.map((cat) => {
                    const isSelected = filters.categories?.includes(cat.id.toString()) || false;
                    return (
                      <div
                        key={cat.id}
                        className="px-4 py-2 cursor-pointer hover:bg-gray-100 text-sm flex items-center gap-2"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleCategorySelection(cat.id.toString());
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleCategorySelection(cat.id.toString())}
                          onClick={(e) => e.stopPropagation()}
                          className="checkbox checkbox-sm checkbox-primary"
                        />
                        <span className={isSelected ? 'font-semibold' : ''}>{cat.name}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          <div className="relative">
            <label className="block text-sm font-medium text-gray-700 mb-1">Employee</label>
            <input
              type="text"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Search employee..."
              value={employeeSearch}
              onChange={(e) => {
                setEmployeeSearch(e.target.value);
                setShowEmployeeDropdown(true);
                if (!e.target.value) {
                  handleFilterChange('employee', '');
                }
              }}
              onFocus={() => setShowEmployeeDropdown(true)}
              onBlur={() => setTimeout(() => setShowEmployeeDropdown(false), 200)}
            />
            {showEmployeeDropdown && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                <div
                  className="px-4 py-2 cursor-pointer hover:bg-gray-100 text-sm"
                  onClick={() => {
                    handleFilterChange('employee', '');
                    setEmployeeSearch('');
                    setShowEmployeeDropdown(false);
                  }}
                >
                  All Employees
                </div>
                <div
                  className="px-4 py-2 cursor-pointer hover:bg-gray-100 text-sm font-semibold text-gray-600"
                  onClick={() => {
                    handleFilterChange('employee', '--');
                    setEmployeeSearch('--');
                    setShowEmployeeDropdown(false);
                  }}
                >
                  -- (NULL Closer/Scheduler)
                </div>
                {filteredEmployees.map((emp) => (
                  <div
                    key={emp.id}
                    className="px-4 py-2 cursor-pointer hover:bg-gray-100 text-sm"
                    onClick={() => {
                      handleFilterChange('employee', emp.id.toString());
                      setEmployeeSearch(emp.name);
                      setShowEmployeeDropdown(false);
                    }}
                  >
                    {emp.name}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="relative">
            <label className="block text-sm font-medium text-gray-700 mb-1">Language (Multi-select)</label>
            <input
              type="text"
              className="w-full mb-2 px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Search languages..."
              value={languageSearch}
              onChange={(e) => {
                setLanguageSearch(e.target.value);
                if (!showLanguageDropdown) {
                  setShowLanguageDropdown(true);
                }
              }}
              onFocus={() => setShowLanguageDropdown(true)}
            />
            <div
              className="w-full min-h-[42px] px-3 py-2 border border-gray-300 rounded-md focus-within:outline-none focus-within:ring-2 focus-within:ring-blue-500 cursor-text flex flex-wrap gap-2 items-center"
              onClick={() => setShowLanguageDropdown(true)}
            >
              {filters.languages && filters.languages.length > 0 ? (
                filters.languages.map((languageId) => {
                  const language = languages.find(l => l.id.toString() === languageId.toString());
                  if (!language) return null;
                  return (
                    <div
                      key={languageId}
                      className="badge badge-primary badge-sm flex items-center gap-1"
                    >
                      <span>{language.name}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleLanguageSelection(languageId.toString());
                        }}
                        className="ml-1 hover:bg-primary-focus rounded-full p-0.5"
                      >
                        <XMarkIcon className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })
              ) : (
                <span className="text-gray-400 text-sm">Click to select languages...</span>
              )}
            </div>
            {showLanguageDropdown && (
              <>
                <div
                  className="fixed inset-0 z-[5]"
                  onClick={() => setShowLanguageDropdown(false)}
                />
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                  <div
                    className="px-4 py-2 cursor-pointer hover:bg-gray-100 text-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setFilters(prev => ({ ...prev, languages: [] }));
                      setLanguageSearch('');
                    }}
                  >
                    Clear All
                  </div>
                  <div className="border-t border-gray-200 my-1"></div>
                  {filteredLanguages.map((lang) => {
                    const isSelected = filters.languages?.includes(lang.id.toString()) || false;
                    return (
                      <div
                        key={lang.id}
                        className="px-4 py-2 cursor-pointer hover:bg-gray-100 text-sm flex items-center gap-2"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleLanguageSelection(lang.id.toString());
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleLanguageSelection(lang.id.toString())}
                          onClick={(e) => e.stopPropagation()}
                          className="checkbox checkbox-sm checkbox-primary"
                        />
                        <span className={isSelected ? 'font-semibold' : ''}>{lang.name}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          <div className="relative">
            <label className="block text-sm font-medium text-gray-700 mb-1">Stage (Multi-select)</label>
            <input
              type="text"
              className="w-full mb-2 px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Search stages..."
              value={stageSearch}
              onChange={(e) => {
                setStageSearch(e.target.value);
                if (!showStageDropdown) {
                  setShowStageDropdown(true);
                }
              }}
              onFocus={() => setShowStageDropdown(true)}
            />
            <div
              className="w-full min-h-[42px] px-3 py-2 border border-gray-300 rounded-md focus-within:outline-none focus-within:ring-2 focus-within:ring-blue-500 cursor-text flex flex-wrap gap-2 items-center"
              onClick={() => setShowStageDropdown(true)}
            >
              {filters.stages && filters.stages.length > 0 ? (
                filters.stages.map((stageId) => {
                  const stage = stages.find(s => s.id.toString() === stageId.toString());
                  if (!stage) return null;
                  return (
                    <div
                      key={stageId}
                      className="badge badge-primary badge-sm flex items-center gap-1 max-w-full"
                    >
                      <span className="truncate text-xs">{stage.name}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleStageSelection(stageId.toString());
                        }}
                        className="ml-1 hover:bg-primary-focus rounded-full p-0.5 flex-shrink-0"
                      >
                        <XMarkIcon className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })
              ) : (
                <span className="text-gray-400 text-sm">Click to select stages...</span>
              )}
            </div>
            {showStageDropdown && (
              <>
                <div
                  className="fixed inset-0 z-[5]"
                  onClick={() => setShowStageDropdown(false)}
                />
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                  <div
                    className="px-4 py-2 cursor-pointer hover:bg-gray-100 text-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setFilters(prev => ({ ...prev, stages: [] }));
                      setStageSearch('');
                    }}
                  >
                    Clear All
                  </div>
                  <div className="border-t border-gray-200 my-1"></div>
                  {filteredStages.map((stage) => {
                    const isSelected = filters.stages?.includes(stage.id.toString()) || false;
                    return (
                      <div
                        key={stage.id}
                        className="px-4 py-2 cursor-pointer hover:bg-gray-100 text-sm flex items-center gap-2"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleStageSelection(stage.id.toString());
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleStageSelection(stage.id.toString())}
                          onClick={(e) => e.stopPropagation()}
                          className="checkbox checkbox-sm checkbox-primary"
                        />
                        <span className={isSelected ? 'font-semibold' : ''}>{stage.name}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          <div className="relative">
            <label className="block text-sm font-medium text-gray-700 mb-1">Tags (Multi-select)</label>
            <input
              type="text"
              className="w-full mb-2 px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Search tags..."
              value={tagsSearch}
              onChange={(e) => {
                setTagsSearch(e.target.value);
                if (!showTagsDropdown) {
                  setShowTagsDropdown(true);
                }
              }}
              onFocus={() => setShowTagsDropdown(true)}
            />
            <div
              className="w-full min-h-[42px] px-3 py-2 border border-gray-300 rounded-md focus-within:outline-none focus-within:ring-2 focus-within:ring-blue-500 cursor-text flex flex-wrap gap-2 items-center"
              onClick={() => setShowTagsDropdown(true)}
            >
              {filters.tags && filters.tags.length > 0 ? (
                filters.tags.map((tag) => (
                  <div
                    key={tag}
                    className="badge badge-primary badge-sm flex items-center gap-1"
                  >
                    <span>{tag}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleTagSelection(tag);
                      }}
                      className="ml-1 hover:bg-primary-focus rounded-full p-0.5"
                    >
                      <XMarkIcon className="w-3 h-3" />
                    </button>
                  </div>
                ))
              ) : (
                <span className="text-gray-400 text-sm">Click to select tags...</span>
              )}
            </div>
            {showTagsDropdown && (
              <>
                <div
                  className="fixed inset-0 z-[5]"
                  onClick={() => setShowTagsDropdown(false)}
                />
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                  <div
                    className="px-4 py-2 cursor-pointer hover:bg-gray-100 text-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setFilters(prev => ({ ...prev, tags: [] }));
                      setTagsSearch('');
                    }}
                  >
                    Clear All
                  </div>
                  <div className="border-t border-gray-200 my-1"></div>
                  {filteredTags.map((tag, index) => {
                    const isSelected = filters.tags?.includes(tag) || false;
                    return (
                      <div
                        key={`${tag}-${index}`}
                        className="px-4 py-2 cursor-pointer hover:bg-gray-100 text-sm flex items-center gap-2"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleTagSelection(tag);
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleTagSelection(tag)}
                          onClick={(e) => e.stopPropagation()}
                          className="checkbox checkbox-sm checkbox-primary"
                        />
                        <span className={isSelected ? 'font-semibold' : ''}>{tag}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Eligibility</label>
            <div className="w-full min-h-[42px] px-3 py-2 border border-gray-300 rounded-md flex items-center gap-3">
              <input
                type="checkbox"
                className="toggle toggle-primary toggle-sm"
                checked={filters.eligibilityDeterminedOnly}
                onChange={(e) => handleFilterChange('eligibilityDeterminedOnly', e.target.checked)}
              />
              <span className="text-xs text-gray-600">
                Show only eligible leads
              </span>
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-row items-center justify-between gap-4 w-full flex-wrap">
          {/* Left: Probability - collapsed as icon, expands on click */}
          <div className="relative">
            {!probabilityExpanded ? (
              <button
                type="button"
                onClick={() => setProbabilityExpanded(true)}
                className="flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200 bg-white shadow-sm hover:bg-gray-50 hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#411CCF] focus:ring-offset-2 transition-colors"
                title="Probability range"
              >
                <ChartBarIcon className="w-5 h-5 text-gray-600 flex-shrink-0" />
                <span className="text-sm font-medium text-gray-700 whitespace-nowrap">Probability</span>
              </button>
            ) : (
              <div className="flex flex-col md:flex-row gap-4 md:gap-6 items-end bg-white p-4 md:p-5 rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <button
                  type="button"
                  onClick={() => setProbabilityExpanded(false)}
                  className="absolute top-2 right-2 p-1 rounded hover:bg-gray-100 text-gray-500"
                  title="Close"
                  aria-label="Close probability panel"
                >
                  <XMarkIcon className="w-5 h-5" />
                </button>
                <div className="flex flex-col gap-3 w-full md:min-w-[200px] md:w-auto">
                  <label className="block text-sm font-semibold text-gray-800">Min Probability</label>
                  <div className="flex items-center gap-3">
                    <div className="relative flex-shrink-0">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={filters.minProbability}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => {
                          const newMin = Math.max(0, Math.min(100, parseInt(e.target.value) || 0));
                          handleFilterChange('minProbability', newMin);
                        }}
                        className="w-24 md:w-28 px-3 md:px-4 py-2 md:py-2.5 text-sm md:text-base font-semibold border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#411CCF] focus:border-[#411CCF] bg-white shadow-sm transition-all text-center"
                        style={{ appearance: 'textfield' }}
                      />
                      <span className="absolute right-2 md:right-3 top-1/2 -translate-y-1/2 text-xs md:text-sm font-semibold text-gray-500 pointer-events-none">%</span>
                    </div>
                  </div>
                  <Slider.Root
                    className="relative flex items-center select-none touch-none w-full h-7"
                    value={[filters.minProbability]}
                    min={0}
                    max={100}
                    step={1}
                    onValueChange={(value) => setFilters(prev => ({ ...prev, minProbability: value[0] }))}
                  >
                    <Slider.Track className="bg-gray-300 relative flex-1 rounded-full h-3.5 shadow-inner">
                      <Slider.Range className="absolute bg-gradient-to-r from-[#411CCF] via-[#5B21B6] to-[#6B46C1] rounded-full h-full shadow-sm" />
                    </Slider.Track>
                    <Slider.Thumb className="block w-7 h-7 bg-white border-3 border-[#411CCF] rounded-full shadow-lg hover:shadow-xl focus:outline-none focus:ring-4 focus:ring-[#411CCF]/30 focus:ring-offset-2 cursor-grab active:cursor-grabbing" style={{ transition: 'box-shadow 0.15s ease-out' }} />
                  </Slider.Root>
                </div>
                <div className="flex flex-col gap-3 w-full md:min-w-[200px] md:w-auto">
                  <label className="block text-sm font-semibold text-gray-800">Max Probability</label>
                  <div className="flex items-center gap-3">
                    <div className="relative flex-shrink-0">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={filters.maxProbability}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => {
                          const newMax = Math.max(0, Math.min(100, parseInt(e.target.value) || 0));
                          handleFilterChange('maxProbability', newMax);
                        }}
                        className="w-24 md:w-28 px-3 md:px-4 py-2 md:py-2.5 text-sm md:text-base font-semibold border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#411CCF] focus:border-[#411CCF] bg-white shadow-sm transition-all text-center"
                        style={{ appearance: 'textfield' }}
                      />
                      <span className="absolute right-2 md:right-3 top-1/2 -translate-y-1/2 text-xs md:text-sm font-semibold text-gray-500 pointer-events-none">%</span>
                    </div>
                  </div>
                  <Slider.Root
                    className="relative flex items-center select-none touch-none w-full h-7"
                    value={[filters.maxProbability]}
                    min={0}
                    max={100}
                    step={1}
                    onValueChange={(value) => setFilters(prev => ({ ...prev, maxProbability: value[0] }))}
                  >
                    <Slider.Track className="bg-gray-300 relative flex-1 rounded-full h-3.5 shadow-inner">
                      <Slider.Range className="absolute bg-gradient-to-r from-[#411CCF] via-[#5B21B6] to-[#6B46C1] rounded-full h-full shadow-sm" />
                    </Slider.Track>
                    <Slider.Thumb className="block w-7 h-7 bg-white border-3 border-[#411CCF] rounded-full shadow-lg hover:shadow-xl focus:outline-none focus:ring-4 focus:ring-[#411CCF]/30 focus:ring-offset-2 cursor-grab active:cursor-grabbing" style={{ transition: 'box-shadow 0.15s ease-out' }} />
                  </Slider.Root>
                </div>
              </div>
            )}
          </div>
          {/* Right: Cancel + Search icon */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleCancelFilters}
              className="flex items-center justify-center w-11 h-11 rounded-lg border border-gray-300 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors text-gray-600 font-semibold text-3xl leading-none"
              title="Clear filters"
              aria-label="Clear filters"
            >
              ×
            </button>
            <button
              onClick={() => handleSearch(true)}
              disabled={isSearching}
              className="flex items-center justify-center w-11 h-11 rounded-lg text-white hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors active:opacity-100 active:bg-[#411CCF]"
              style={{ backgroundColor: '#411CCF' }}
              title="Search"
              aria-label="Search"
            >
              {isSearching ? (
                <span className="loading loading-spinner loading-sm text-white" />
              ) : (
                <MagnifyingGlassIcon className="w-6 h-6" />
              )}
            </button>
          </div>
          <style>{`
            input[type="number"]::-webkit-inner-spin-button,
            input[type="number"]::-webkit-outer-spin-button {
              -webkit-appearance: none;
              margin: 0;
            }
            input[type="number"] {
              -moz-appearance: textfield;
            }
            [data-radix-slider-thumb] {
              border-width: 3px !important;
            }
            [data-radix-slider-thumb]:hover {
              transform: scale(1.1);
            }
            [data-radix-slider-thumb]:active {
              transform: scale(0.95);
            }
          `}</style>
        </div>
      </div>

      {/* Results Summary - Always show when search is performed */}
      {searchPerformed && (
        <div className="border-t border-gray-200 pt-6 -mx-2">
          <div className="mb-4 px-4 flex items-center gap-4 flex-wrap">
            <h3 className="text-lg font-semibold">Total leads: {results.length}</h3>
            {(() => {
              // Calculate total using convertToNIS to convert all currencies to NIS
              const totalAmount = results.reduce((sum, lead) => {
                const isLegacy = lead.lead_type === 'legacy' || lead.id?.toString().startsWith('legacy_');
                let balanceValue: any;

                if (isLegacy) {
                  // For legacy leads: if currency_id is 1 (NIS/ILS), use total_base; otherwise use total
                  const currencyId = lead.currency_id ?? (lead as any).currency_id;
                  let numericCurrencyId = typeof currencyId === 'string' ? parseInt(currencyId, 10) : Number(currencyId);
                  if (!numericCurrencyId || isNaN(numericCurrencyId)) {
                    numericCurrencyId = 1; // Default to NIS
                  }
                  if (numericCurrencyId === 1) {
                    balanceValue = lead.total_base ?? (lead as any).total_base ?? null;
                  } else {
                    balanceValue = lead.total ?? null;
                  }
                } else {
                  balanceValue = lead.total || (lead.balance as any) || (lead as any).proposal_total || null;
                }

                const numValue = typeof balanceValue === 'number' ? balanceValue : parseFloat(balanceValue) || 0;
                const currency = lead.balance_currency || '₪';
                // Convert to NIS for proper summation across currencies
                return sum + convertToNIS(numValue, currency);
              }, 0);

              // Since we're converting everything to NIS, display in NIS
              const symbol = '₪';
              return (
                <div className="badge badge-lg text-white border-none bg-green-900">
                  Total: {symbol} {totalAmount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </div>
              );
            })()}
          </div>
          {results.length === 0 ? (
            <div className="p-6 text-center text-gray-500">No leads found</div>
          ) : (
            <div className="overflow-x-auto px-4">
              <table className="min-w-full divide-y divide-gray-200">
                <thead>
                  <tr>
                    <th className="px-2 py-2 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider" style={{ maxWidth: '200px' }}>
                      <div className="line-clamp-2 break-words">Lead</div>
                    </th>
                    <th className="px-1 py-2 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">
                      <div className="line-clamp-2 break-words">Stage</div>
                    </th>
                    <th
                      className="px-2 py-2 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort('probability')}
                    >
                      <div className="line-clamp-2 break-words">
                        Probability {sortColumn === 'probability' && (
                          <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </div>
                    </th>
                    <th
                      className="px-2 py-2 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort('closer')}
                    >
                      <div className="line-clamp-2 break-words">
                        Closer {sortColumn === 'closer' && (
                          <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </div>
                    </th>
                    <th
                      className="px-2 py-2 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort('scheduler')}
                    >
                      <div className="line-clamp-2 break-words">
                        Scheduler {sortColumn === 'scheduler' && (
                          <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </div>
                    </th>
                    <th
                      className="px-2 py-2 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort('meeting_date')}
                    >
                      <div className="line-clamp-2 break-words">
                        Meeting<br />Date {sortColumn === 'meeting_date' && (
                          <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </div>
                    </th>
                    <th
                      className="px-2 py-2 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort('follow_up_date')}
                    >
                      <div className="line-clamp-2 break-words">
                        Follow Up<br />Date {sortColumn === 'follow_up_date' && (
                          <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </div>
                    </th>
                    <th
                      className="px-2 py-2 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort('latest_interaction')}
                    >
                      <div className="line-clamp-2 break-words">
                        Latest<br />Interaction {sortColumn === 'latest_interaction' && (
                          <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </div>
                    </th>
                    <th className="px-2 py-2 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider" style={{ maxWidth: '200px' }}>
                      <div className="line-clamp-2 break-words">Follow Up Notes</div>
                    </th>
                    <th className="px-2 py-2 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider" style={{ maxWidth: '200px' }}>
                      <div className="line-clamp-2 break-words">Expert Opinion</div>
                    </th>
                    <th
                      className="px-2 py-2 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort('total_applicants')}
                    >
                      <div className="line-clamp-2 break-words">
                        Total<br />Applicants {sortColumn === 'total_applicants' && (
                          <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </div>
                    </th>
                    <th
                      className="px-2 py-2 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort('potential_applicants')}
                    >
                      <div className="line-clamp-2 break-words">
                        Potential<br />Applicants {sortColumn === 'potential_applicants' && (
                          <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </div>
                    </th>
                    <th className="px-2 py-2 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider" style={{ maxWidth: '200px' }}>
                      <div className="line-clamp-2 break-words">Manager Notes</div>
                    </th>
                    <th
                      className="px-2 py-2 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort('total')}
                    >
                      <div className="line-clamp-2 break-words">
                        Total {sortColumn === 'total' && (
                          <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {results.map((lead, index) => {
                    const leadKey = lead.id?.toString() || lead.lead_number || '';
                    const interactions = interactionsCache.get(leadKey) || [];
                    const isLoading = loadingInteractions.has(leadKey);
                    const isExpanded = false;
                    return (
                      <React.Fragment key={lead.id || index}>
                        <tr
                          className="hover:bg-gray-50 cursor-pointer"
                          onClick={() => handleOpenInteractions(lead)}
                        >
                          <td className="px-2 py-2" style={{ maxWidth: '200px' }}>
                            <div className="flex items-center gap-2">
                              <div
                                className="text-sm font-medium cursor-pointer hover:underline break-words"
                                style={{ color: '#411CCF' }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  // Check if CTRL (Windows/Linux) or Command (Mac) key is pressed
                                  if (e.ctrlKey || e.metaKey) {
                                    // Open in new tab
                                    window.open(`/clients/${lead.lead_number}`, '_blank');
                                  } else {
                                    // Normal navigation in same tab
                                    navigate(`/clients/${lead.lead_number}`);
                                  }
                                }}
                              >
                                #{getDisplayLeadNumber(lead)}
                              </div>
                            </div>
                            <div className="text-sm text-gray-900 break-words" style={{
                              display: '-webkit-box',
                              WebkitLineClamp: 3,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                              wordBreak: 'break-word'
                            }}>{lead.name || '---'}</div>
                          </td>
                          <td className="px-1 py-2 text-sm text-gray-900">
                            <div className="break-words whitespace-normal line-clamp-2" style={{ maxWidth: '150px' }}>
                              {lead.stage || '---'}
                            </div>
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap text-sm text-gray-900">
                            {lead.probability ? `${lead.probability}%` : '---'}
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap text-sm text-gray-900">
                            {lead.closer || '---'}
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap text-sm text-gray-900">
                            {lead.scheduler || '---'}
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap text-sm text-gray-900">
                            {lead.meeting_date ? new Date(lead.meeting_date).toLocaleDateString() : '---'}
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap text-sm text-gray-900">
                            <div className="flex items-center gap-2 group">
                              <span>{lead.follow_up_date ? new Date(lead.follow_up_date).toLocaleDateString() : '---'}</span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleEditFollowUpDate(lead);
                                }}
                                className="btn btn-xs btn-ghost opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                                title="Edit follow-up date"
                              >
                                <PencilIcon className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap text-sm text-gray-900">
                            {lead.latest_interaction ? new Date(lead.latest_interaction).toLocaleDateString() : '---'}
                          </td>
                          <td className="px-2 py-2 text-sm text-gray-900 max-w-[200px]">
                            <div className="flex items-start gap-2 group">
                              <div
                                className="line-clamp-3 break-words flex-1 cursor-help"
                                title={lead.follow_up_notes || undefined}
                              >
                                {lead.follow_up_notes || '---'}
                              </div>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleEditFollowUpNotes(lead);
                                }}
                                className="btn btn-xs btn-ghost opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                                title="Edit follow-up notes"
                              >
                                <PencilIcon className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                          <td className="px-2 py-2 text-sm text-gray-900 max-w-[200px]">
                            <div
                              className="line-clamp-3 break-words cursor-help"
                              title={lead.expert_opinion && lead.expert_opinion !== '---' ? lead.expert_opinion : undefined}
                            >
                              {lead.expert_opinion || '---'}
                            </div>
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap text-sm text-gray-900">
                            {lead.number_of_applicants_meeting ?? '---'}
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap text-sm text-gray-900">
                            {lead.potential_applicants_meeting ?? '---'}
                          </td>
                          <td className="px-2 py-2 text-sm text-gray-900 max-w-[200px]">
                            <div className="flex items-start gap-2 group">
                              <div
                                className="line-clamp-3 break-words flex-1 cursor-help"
                                title={lead.manager_notes && lead.manager_notes !== '---' ? lead.manager_notes : undefined}
                              >
                                {lead.manager_notes || '---'}
                              </div>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleEditManagerNotes(lead);
                                }}
                                className="btn btn-xs btn-ghost opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                                title="Edit manager notes"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                              </button>
                            </div>
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap text-sm text-gray-900">
                            {formatCurrency(lead.total || '', lead.balance_currency || '', lead)}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={14} className="px-2 py-2 bg-gray-50 border-t border-gray-200">
                              <div className="space-y-3">
                                <div className="text-sm font-semibold text-gray-700 mb-2">Latest Interactions</div>
                                {isLoading ? (
                                  <div className="flex justify-center py-4">
                                    <span className="loading loading-spinner loading-sm"></span>
                                  </div>
                                ) : interactions.length > 0 ? (
                                  <div className="flex flex-wrap gap-3">
                                    {interactions.map((interaction, idx) => {
                                      const interactionDate = interaction.date ? new Date(interaction.date) : null;
                                      const dateStr = interactionDate ? interactionDate.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
                                      const timeStr = interactionDate ? interactionDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';

                                      let icon;
                                      let iconColor = 'text-gray-600';
                                      let typeLabel = interaction.type?.toUpperCase() || 'OTHER';
                                      if (interaction.type === 'email') {
                                        icon = <EnvelopeIcon className="w-4 h-4" />;
                                        iconColor = 'text-blue-600';
                                        typeLabel = 'EMAIL';
                                      } else if (interaction.type === 'whatsapp') {
                                        icon = <FaWhatsapp className="w-4 h-4" />;
                                        iconColor = 'text-green-600';
                                        typeLabel = 'WHATSAPP';
                                      } else if (interaction.type === 'call') {
                                        icon = <PhoneIcon className="w-4 h-4" />;
                                        iconColor = 'text-purple-600';
                                        typeLabel = 'CALL';
                                      } else if (interaction.type === 'manual') {
                                        icon = <ChatBubbleLeftRightIcon className="w-4 h-4" />;
                                        iconColor = 'text-orange-600';
                                        typeLabel = 'MANUAL';
                                      } else {
                                        icon = <ChatBubbleLeftRightIcon className="w-4 h-4" />;
                                        typeLabel = 'OTHER';
                                      }

                                      const directionText = interaction.direction === 'in' ? 'Incoming' : 'Outgoing';

                                      // Extract text from HTML if needed
                                      let contentText = interaction.content || '';
                                      if (interaction.body && typeof interaction.body === 'string') {
                                        // For emails, prefer body_html if available, otherwise use content
                                        contentText = interaction.body;
                                      }

                                      // Strip HTML tags for preview
                                      if (contentText && typeof contentText === 'string') {
                                        contentText = contentText.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
                                      }

                                      const contentPreview = contentText
                                        ? (contentText.length > 150
                                          ? contentText.substring(0, 150) + '...'
                                          : contentText)
                                        : 'No content';

                                      return (
                                        <div key={interaction.id || idx} className="flex items-start gap-3 p-2 bg-white rounded border border-gray-200 hover:bg-gray-50 flex-1 min-w-[300px] max-w-full sm:max-w-[400px]">
                                          <div className={`flex-shrink-0 ${iconColor}`}>
                                            {icon}
                                          </div>
                                          <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
                                              <span className="font-medium">{typeLabel}</span>
                                              <span>•</span>
                                              <span>{directionText}</span>
                                              {dateStr && (
                                                <>
                                                  <span>•</span>
                                                  <span>{dateStr} {timeStr}</span>
                                                </>
                                              )}
                                              {interaction.employee_name && (
                                                <>
                                                  <span>•</span>
                                                  <span className="font-medium">{interaction.direction === 'in' ? 'Received by' : 'Sent by'}: {interaction.employee_name}</span>
                                                </>
                                              )}
                                            </div>
                                            <div
                                              className={`text-sm text-gray-900 break-words ${isHebrewText(contentPreview) ? 'text-right' : ''}`}
                                              dir={isHebrewText(contentPreview) ? 'rtl' : 'ltr'}
                                            >
                                              {contentPreview}
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <div className="text-sm text-gray-500 py-2">No interactions found</div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <LeadInteractionsModal
        isOpen={!!selectedLeadForInteractions}
        onClose={() => setSelectedLeadForInteractions(null)}
        leadName={selectedLeadForInteractions?.name || selectedLeadForInteractions?.lead_number || 'Lead'}
        interactions={
          selectedLeadForInteractions
            ? (interactionsCache.get(selectedLeadForInteractions.id?.toString() || selectedLeadForInteractions.lead_number || '') || [])
            : []
        }
        isLoading={
          selectedLeadForInteractions
            ? loadingInteractions.has(selectedLeadForInteractions.id?.toString() || selectedLeadForInteractions.lead_number || '')
            : false
        }
      />

      {/* Follow-up Date Edit Modal */}
      {editingFollowUpDate && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">Edit Follow-Up Date</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Follow-Up Date
                </label>
                <input
                  type="date"
                  className="input input-bordered w-full"
                  value={followUpDate}
                  onChange={(e) => setFollowUpDate(e.target.value)}
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    setEditingFollowUpDate(null);
                    setFollowUpDate('');
                  }}
                  disabled={savingFollowUp}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleSaveFollowUpDate}
                  disabled={savingFollowUp}
                >
                  {savingFollowUp ? (
                    <>
                      <span className="loading loading-spinner loading-sm"></span>
                      Saving...
                    </>
                  ) : (
                    'Save'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Follow-up Notes Edit Modal */}
      {editingFollowUpNotes && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">Edit Follow-Up Notes</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Follow-Up Notes
                </label>
                <textarea
                  className="textarea textarea-bordered w-full min-h-[120px]"
                  placeholder="Add follow-up notes..."
                  value={followUpNotes}
                  onChange={(e) => setFollowUpNotes(e.target.value)}
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    setEditingFollowUpNotes(null);
                    setFollowUpNotes('');
                  }}
                  disabled={savingFollowUp}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleSaveFollowUpNotes}
                  disabled={savingFollowUp}
                >
                  {savingFollowUp ? (
                    <>
                      <span className="loading loading-spinner loading-sm"></span>
                      Saving...
                    </>
                  ) : (
                    'Save'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Manager Notes Edit Modal */}
      {editingManagerNotes && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={handleCancelManagerNotes}>
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-2xl mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">
              Edit Manager Notes
              {editingManagerNotes.lead && (
                <span className="text-sm font-normal text-gray-500 ml-2">
                  - {editingManagerNotes.lead.name || editingManagerNotes.lead.lead_number || 'Lead'}
                </span>
              )}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Manager Notes
                </label>
                <textarea
                  className={`textarea textarea-bordered w-full min-h-[200px] text-base ${isHebrewText(managerNotesValue) ? 'text-right' : 'text-left'}`}
                  placeholder="Enter manager notes..."
                  value={managerNotesValue}
                  onChange={(e) => setManagerNotesValue(e.target.value)}
                  dir={isHebrewText(managerNotesValue) ? 'rtl' : 'ltr'}
                  style={{ whiteSpace: 'pre-wrap' }}
                  autoFocus
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  className="btn btn-ghost"
                  onClick={handleCancelManagerNotes}
                  disabled={savingManagerNotes}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleSaveManagerNotes}
                  disabled={savingManagerNotes}
                >
                  {savingManagerNotes ? (
                    <>
                      <span className="loading loading-spinner loading-sm"></span>
                      Saving...
                    </>
                  ) : (
                    'Save'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CloserSuperPipelinePage;
