import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import { convertToNIS } from '../lib/currencyConversion';
import { usePersistedFilters, usePersistedState } from '../hooks/usePersistedState';
import { EnvelopeIcon, PhoneIcon, ChatBubbleLeftRightIcon, ChevronDownIcon, ChevronUpIcon, XMarkIcon, PencilIcon } from '@heroicons/react/24/outline';
import { FaWhatsapp } from 'react-icons/fa';

const CloserSuperPipelinePage = () => {
  const navigate = useNavigate();
  const [filters, setFilters] = usePersistedFilters<{
    fromDate: string;
    toDate: string;
    categories: string[];
    employee: string;
    languages: string[];
    stages: string[];
    tags: string[];
    minProbability: number;
    maxProbability: number;
  }>('closerSuperPipeline_filters', {
    fromDate: '',
    toDate: '',
    categories: [], // Changed to array for multi-select
    employee: '',
    languages: [], // Changed to array for multi-select
    stages: ['40', '50'], // Changed to array, default to stages 40 and 50
    tags: [], // Changed to array for multi-select
    minProbability: 80,
    maxProbability: 100,
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
  const [editingManagerNotes, setEditingManagerNotes] = useState<Record<string, boolean>>({});
  const [managerNotesValues, setManagerNotesValues] = useState<Record<string, string>>({});
  const [savingManagerNotes, setSavingManagerNotes] = useState<Record<string, boolean>>({});
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
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [interactionsCache, setInteractionsCache] = useState<Map<string, any[]>>(new Map());
  const [loadingInteractions, setLoadingInteractions] = useState<Set<string>>(new Set());
  const [editingFollowUp, setEditingFollowUp] = useState<{ leadId: string; leadType: 'new' | 'legacy' } | null>(null);
  const [followUpDate, setFollowUpDate] = useState<string>('');
  const [savingFollowUp, setSavingFollowUp] = useState(false);

  // Fetch current user ID
  useEffect(() => {
    const fetchCurrentUserId = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: userData } = await supabase
            .from('users')
            .select('id')
            .eq('auth_id', user.id)
            .maybeSingle();
          if (userData?.id) {
            setCurrentUserId(userData.id);
          }
        }
      } catch (error) {
        console.error('Error fetching current user ID:', error);
      }
    };
    fetchCurrentUserId();
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
        .order('name');
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

  // Function to toggle row expansion
  const toggleRowExpansion = useCallback((lead: any) => {
    const leadKey = lead.id?.toString() || lead.lead_number || '';
    if (!leadKey) return;

    setExpandedRows(prev => {
      const newSet = new Set(prev);
      if (newSet.has(leadKey)) {
        newSet.delete(leadKey);
      } else {
        newSet.add(leadKey);
        // Fetch interactions if not cached
        if (!interactionsCache.has(leadKey)) {
          fetchInteractions(lead);
        }
      }
      return newSet;
    });
  }, [interactionsCache, fetchInteractions]);

  const handleCancelFilters = () => {
    // Reset all filters to default - set dates to empty (null)
    setFilters({
      fromDate: '',
      toDate: '',
      categories: [], // Reset to empty array
      employee: '',
      languages: [], // Reset to empty array
      stages: ['40', '50'], // Reset to default stages
      tags: [], // Reset to empty array
      minProbability: 80,
      maxProbability: 100,
    });
    // Clear search inputs
    setCategorySearch('');
    setEmployeeSearch('');
    setLanguageSearch('');
    setStageSearch('');
    setTagsSearch('');
    // Keep results, totals, and table visibility - don't clear them
  };

  const getCategoryName = (categoryId: string | number | null | undefined, fallbackCategory?: string | number) => {
    // For display purposes, we'll show a simple category name
    // This function is used for displaying category names in the results
    if (!categoryId || categoryId === '---' || categoryId === '--') {
      return '---';
    }

    // Try to find the main category by looking up subcategories
    // For now, return a simple display - this can be enhanced if needed
    return fallbackCategory ? String(fallbackCategory) : '---';
  };

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

  const handleEditFollowUp = (lead: any) => {
    const leadId = lead.id;
    const leadType = lead.lead_type || (leadId.toString().startsWith('legacy_') ? 'legacy' : 'new');
    setEditingFollowUp({ leadId, leadType });
    setFollowUpDate(lead.follow_up_date || '');
  };

  const handleSaveFollowUp = async () => {
    if (!editingFollowUp || !currentUserId) return;

    setSavingFollowUp(true);
    try {
      const { leadId, leadType } = editingFollowUp;
      const isLegacyLead = leadType === 'legacy';
      const actualLeadId = isLegacyLead ? leadId.toString().replace('legacy_', '') : leadId;

      // Check if follow-up already exists for this user and lead
      let existingFollowUp = null;
      if (isLegacyLead) {
        const { data } = await supabase
          .from('follow_ups')
          .select('id')
          .eq('user_id', currentUserId)
          .eq('lead_id', Number(actualLeadId))
          .is('new_lead_id', null)
          .maybeSingle();
        existingFollowUp = data;
      } else {
        const { data } = await supabase
          .from('follow_ups')
          .select('id')
          .eq('user_id', currentUserId)
          .eq('new_lead_id', actualLeadId)
          .is('lead_id', null)
          .maybeSingle();
        existingFollowUp = data;
      }

      if (followUpDate && followUpDate.trim() !== '') {
        const dateValue = followUpDate + 'T00:00:00Z';

        if (existingFollowUp) {
          // Update existing follow-up
          const { error } = await supabase
            .from('follow_ups')
            .update({ date: dateValue })
            .eq('id', existingFollowUp.id);

          if (error) {
            console.error('Error updating follow-up:', error);
            toast.error('Failed to update follow-up date');
          } else {
            toast.success('Follow-up date updated');
            setEditingFollowUp(null);
            setFollowUpDate('');
            // Refresh the search to show updated follow-up date
            handleSearch(false);
          }
        } else {
          // Create new follow-up
          const insertData: any = {
            user_id: currentUserId,
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
            setEditingFollowUp(null);
            setFollowUpDate('');
            // Refresh the search to show updated follow-up date
            handleSearch(false);
          }
        }
      } else {
        // Delete follow-up if date is empty
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
            setEditingFollowUp(null);
            setFollowUpDate('');
            // Refresh the search to show updated follow-up date
            handleSearch(false);
          }
        } else {
          setEditingFollowUp(null);
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

  const handleSaveManagerNotes = async (lead: any) => {
    const leadId = lead.id || lead.lead_number;
    if (!leadId) return;

    setSavingManagerNotes(prev => ({ ...prev, [lead.id || lead.lead_number]: true }));
    try {
      const userName = await fetchCurrentUserName();
      const tableName = lead.lead_type === 'legacy' ? 'leads_lead' : 'leads';
      const clientId = lead.lead_type === 'legacy'
        ? (typeof leadId === 'string' ? parseInt(leadId.replace('legacy_', '')) : leadId)
        : leadId;

      const notesText = managerNotesValues[lead.id || lead.lead_number] || '';
      const updateData: any = {
        management_notes: formatNoteText(notesText),
        management_notes_last_edited_by: userName,
        management_notes_last_edited_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from(tableName)
        .update(updateData)
        .eq('id', clientId);

      if (error) throw error;

      // Update local state
      setResults(prev => prev.map(l =>
        l.id === lead.id
          ? { ...l, manager_notes: formatNoteText(notesText) }
          : l
      ));

      // Clear editing state
      setEditingManagerNotes(prev => {
        const newState = { ...prev };
        delete newState[lead.id || lead.lead_number];
        return newState;
      });
      setManagerNotesValues(prev => {
        const newState = { ...prev };
        delete newState[lead.id || lead.lead_number];
        return newState;
      });

      toast.success('Manager notes saved successfully');
    } catch (error: any) {
      console.error('Error saving manager notes:', error);
      toast.error(`Failed to save manager notes: ${error?.message || 'Unknown error'}`);
    } finally {
      setSavingManagerNotes(prev => {
        const newState = { ...prev };
        delete newState[lead.id || lead.lead_number];
        return newState;
      });
    }
  };

  const handleSearch = async (applyDateFilters: boolean = true) => {
    setIsSearching(true);
    if (applyDateFilters) {
      setSearchPerformed(true);
    }
    try {
      const allLeads: any[] = [];

      // Get selected stages from filters (default to [40, 50] if empty)
      const selectedStageIds = (filters.stages && filters.stages.length > 0)
        ? filters.stages.map(id => id.toString())
        : ['40', '50'];

      console.log('🔍 DEBUG: Starting handleSearch', {
        applyDateFilters,
        filters,
        selectedStageIds,
        minProbability: filters.minProbability,
        maxProbability: filters.maxProbability
      });

      // Fetch new leads - we'll filter by meeting date later
      let newLeadsQuery = supabase
        .from('leads')
        .select(`
          id,
          lead_number,
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
          expert_notes,
          management_notes,
          unactivated_at
        `)
        .gte('probability', Number(filters.minProbability)) // Probability >= minProbability (ensure it's a number)
        .lte('probability', Number(filters.maxProbability)) // Probability <= maxProbability (ensure it's a number)
        .not('probability', 'is', null) // Exclude null probabilities
        .not('closer', 'is', null) // Only leads with closer assigned
        .is('unactivated_at', null); // Only active leads (closer pipeline doesn't check eligible)

      // Apply stage filter - use selected stages from filters
      if (selectedStageIds.length > 0) {
        newLeadsQuery = newLeadsQuery.in('stage', selectedStageIds);
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

      // Apply employee filter (closer)
      if (filters.employee) {
        if (filters.employee === '--') {
          // Show NULL closer or NULL scheduler entries
          newLeadsQuery = newLeadsQuery.or('closer.is.null,scheduler.is.null');
        } else {
          const employee = employees.find(emp => emp.id.toString() === filters.employee);
          if (employee) {
            console.log('🔍 DEBUG: Applying employee filter to new leads', {
              employeeId: filters.employee,
              employeeName: employee.name,
              queryWillFilterBy: `closer = "${employee.name}"`
            });
            newLeadsQuery = newLeadsQuery.eq('closer', employee.name);
          } else {
            console.warn('🔍 DEBUG: Employee filter set but employee not found', {
              employeeId: filters.employee,
              availableEmployees: employees.map(e => ({ id: e.id, name: e.name }))
            });
          }
        }
      }

      // First, directly query lead L210471 to see its actual values
      const targetNewLeadNumber = 'L210471';
      const { data: directNewLeadData, error: directNewLeadError } = await supabase
        .from('leads')
        .select('id, lead_number, name, probability, closer, stage, unactivated_at, category_id, language, created_at')
        .eq('lead_number', targetNewLeadNumber)
        .single();

      const newLeadFilterChecks = directNewLeadData ? {
        hasProbability: {
          passes: directNewLeadData.probability !== null && Number(directNewLeadData.probability) >= filters.minProbability && Number(directNewLeadData.probability) <= filters.maxProbability,
          required: `Not null and between ${filters.minProbability}-${filters.maxProbability}`,
          actual: directNewLeadData.probability,
          type: typeof directNewLeadData.probability
        },
        hasCloser: {
          passes: directNewLeadData.closer !== null,
          required: 'Not null',
          actual: directNewLeadData.closer
        },
        correctStage: {
          passes: selectedStageIds.includes(directNewLeadData.stage?.toString()),
          required: selectedStageIds.join(' or '),
          actual: directNewLeadData.stage
        },
        isActive: {
          passes: directNewLeadData.unactivated_at === null,
          required: 'null (unactivated_at)',
          actual: directNewLeadData.unactivated_at
        },
        categoryMatch: {
          passes: !filters.categories || filters.categories.length === 0 || (() => {
            // Check if category_id matches any selected main category's subcategories
            // This is a simplified check - actual filtering happens in query
            return true; // Will be filtered by query
          })(),
          required: filters.categories?.length > 0 ? filters.categories.join(', ') : 'Any',
          actual: directNewLeadData.category_id
        },
        languageMatch: {
          passes: !filters.languages || filters.languages.length === 0 || filters.languages.includes(directNewLeadData.language),
          required: filters.languages?.length > 0 ? filters.languages.join(', ') : 'Any',
          actual: directNewLeadData.language
        },
        employeeMatch: {
          passes: !filters.employee || (() => {
            const employee = employees.find(emp => emp.id.toString() === filters.employee);
            return employee ? directNewLeadData.closer === employee.name : false;
          })(),
          required: filters.employee || 'Any',
          actual: directNewLeadData.closer
        }
      } : {};

      const newLeadFailingFilters = Object.entries(newLeadFilterChecks)
        .filter(([, check]: any) => !check.passes)
        .map(([name]) => name);

      const newLeadPassesAllFilters = newLeadFailingFilters.length === 0;

      console.log('🔍 DEBUG: Direct query for lead L210471 - FULL DETAILS', {
        found: !!directNewLeadData,
        error: directNewLeadError,
        leadData: directNewLeadData,
        filterChecks: newLeadFilterChecks,
        passesAllFilters: newLeadPassesAllFilters,
        failingFilters: newLeadFailingFilters,
        failingFilterDetails: newLeadFailingFilters.map((filterName: string) => ({
          filterName,
          check: newLeadFilterChecks[filterName as keyof typeof newLeadFilterChecks]
        }))
      });

      // Log each filter check individually for clarity
      if (directNewLeadData) {
        console.log('🔍 DEBUG: Lead L210471 - Individual Filter Checks:', {
          hasProbability: {
            passes: newLeadFilterChecks.hasProbability?.passes,
            required: newLeadFilterChecks.hasProbability?.required,
            actual: newLeadFilterChecks.hasProbability?.actual
          },
          hasCloser: {
            passes: newLeadFilterChecks.hasCloser?.passes,
            required: newLeadFilterChecks.hasCloser?.required,
            actual: newLeadFilterChecks.hasCloser?.actual
          },
          correctStage: {
            passes: newLeadFilterChecks.correctStage?.passes,
            required: newLeadFilterChecks.correctStage?.required,
            actual: newLeadFilterChecks.correctStage?.actual,
            allowedStages: selectedStageIds
          },
          isActive: {
            passes: newLeadFilterChecks.isActive?.passes,
            required: newLeadFilterChecks.isActive?.required,
            actual: newLeadFilterChecks.isActive?.actual
          },
          categoryMatch: {
            passes: newLeadFilterChecks.categoryMatch?.passes,
            required: newLeadFilterChecks.categoryMatch?.required,
            actual: newLeadFilterChecks.categoryMatch?.actual,
            filterCategories: filters.categories?.length > 0 ? filters.categories.join(', ') : 'Any'
          },
          languageMatch: {
            passes: newLeadFilterChecks.languageMatch?.passes,
            required: newLeadFilterChecks.languageMatch?.required,
            actual: newLeadFilterChecks.languageMatch?.actual,
            filterLanguages: filters.languages?.length > 0 ? filters.languages.join(', ') : 'Any'
          },
          employeeMatch: {
            passes: newLeadFilterChecks.employeeMatch?.passes,
            required: newLeadFilterChecks.employeeMatch?.required,
            actual: newLeadFilterChecks.employeeMatch?.actual,
            filterEmployee: filters.employee,
            employeeName: filters.employee ? employees.find(emp => emp.id.toString() === filters.employee)?.name : null
          }
        });

        // Explicitly log which filters are failing
        if (newLeadFailingFilters.length > 0) {
          console.error('❌ DEBUG: Lead L210471 FAILING FILTERS:', newLeadFailingFilters);
          newLeadFailingFilters.forEach((filterName: string) => {
            const check = newLeadFilterChecks[filterName as keyof typeof newLeadFilterChecks];
            console.error(`❌ Filter "${filterName}" FAILED:`, {
              required: check?.required,
              actual: check?.actual,
              passes: check?.passes
            });
          });
        } else {
          console.log('✅ DEBUG: Lead L210471 passes all filter checks');
        }
      }

      console.log('🔍 DEBUG: Executing new leads query...', {
        activeFilters: {
          stages: selectedStageIds,
          probability: `${filters.minProbability}-${filters.maxProbability}`,
          closer: 'not null',
          unactivated_at: 'null',
          categories: filters.categories?.length > 0 ? filters.categories.join(', ') : 'any',
          languages: filters.languages?.length > 0 ? filters.languages.join(', ') : 'any',
          employee: filters.employee ? (employees.find(emp => emp.id.toString() === filters.employee)?.name || 'NOT FOUND') : 'any'
        }
      });
      const { data: newLeads, error: newLeadsError } = await newLeadsQuery.order('created_at', { ascending: false });

      // Check if lead L210471 is in the query results
      const targetNewLeadInQuery = newLeads?.find((l: any) => l.lead_number === targetNewLeadNumber);
      console.log('🔍 DEBUG: Checking for lead L210471 in query results', {
        found: !!targetNewLeadInQuery,
        leadData: targetNewLeadInQuery,
        totalLeadsInQuery: newLeads?.length || 0
      });

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
        const { data: meetingsData } = await supabase
          .from('meetings')
          .select('client_id, meeting_date')
          .in('client_id', newLeadIds)
          .or('status.is.null,status.neq.canceled')
          .order('meeting_date', { ascending: false });

        if (meetingsData) {
          meetingsData.forEach((meeting: any) => {
            if (meeting.meeting_date && meeting.client_id) {
              const dateStr = typeof meeting.meeting_date === 'string'
                ? meeting.meeting_date.split('T')[0]
                : new Date(meeting.meeting_date).toISOString().split('T')[0];
              // Keep the most recent meeting date for each lead
              if (!meetingDatesMap[meeting.client_id] || dateStr > meetingDatesMap[meeting.client_id]) {
                meetingDatesMap[meeting.client_id] = dateStr;
              }
            }
          });
        }
      }

      // Fetch follow-up dates for new leads (only current user's follow-ups)
      const followUpDatesMap: Record<string, string> = {};

      if (newLeadIds.length > 0 && currentUserId) {
        const { data: followUpsData } = await supabase
          .from('follow_ups')
          .select('new_lead_id, date')
          .eq('user_id', currentUserId)
          .in('new_lead_id', newLeadIds)
          .is('lead_id', null);

        if (followUpsData) {
          followUpsData.forEach((fu: any) => {
            if (fu.date && fu.new_lead_id) {
              const dateStr = typeof fu.date === 'string'
                ? fu.date.split('T')[0]
                : new Date(fu.date).toISOString().split('T')[0];
              followUpDatesMap[fu.new_lead_id] = dateStr;
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
        // Debug check for L210471 before date filter
        const targetNewLeadBeforeDateFilter = filteredNewLeads.find((l: any) => l.lead_number === targetNewLeadNumber);
        if (targetNewLeadBeforeDateFilter) {
          const meetingDate = meetingDatesMap[targetNewLeadBeforeDateFilter.id];
          console.log('🔍 DEBUG: Lead L210471 before date filter', {
            found: true,
            meetingDate: meetingDate || 'NO MEETING DATE',
            fromDate: filters.fromDate,
            toDate: filters.toDate,
            willPassDateFilter: meetingDate &&
              (!filters.fromDate || meetingDate >= filters.fromDate) &&
              (!filters.toDate || meetingDate <= filters.toDate)
          });
        }

        filteredNewLeads = filteredNewLeads.filter((lead: any) => {
          const meetingDate = meetingDatesMap[lead.id];
          if (!meetingDate) return false; // Exclude leads without meeting dates when filtering
          if (filters.fromDate && meetingDate < filters.fromDate) return false;
          if (filters.toDate && meetingDate > filters.toDate) return false;
          return true;
        });

        // Debug check for L210471 after date filter
        const targetNewLeadAfterDateFilter = filteredNewLeads.find((l: any) => l.lead_number === targetNewLeadNumber);
        console.log('🔍 DEBUG: Lead L210471 after date filter', {
          found: !!targetNewLeadAfterDateFilter,
          passedDateFilter: !!targetNewLeadAfterDateFilter,
          totalBeforeFilter: (newLeads || []).length,
          totalAfterFilter: filteredNewLeads.length
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

          // Debug check for L210471
          if (lead.lead_number === targetNewLeadNumber) {
            console.log('🔍 DEBUG: Processing lead L210471 in new leads', {
              lead,
              meetingDate: meetingDatesMap[lead.id] || null,
              followUpDate: followUpDatesMap[lead.id] || null
            });
          }

          // Determine if this is a master lead or sublead
          // Sublead: has master_id set OR lead_number contains "/" (pattern like "L209667/1")
          const hasMasterId = lead.master_id !== null && lead.master_id !== undefined && String(lead.master_id).trim() !== '';
          const hasSlashInNumber = lead.lead_number?.includes('/') || false;
          const isSubLead = hasMasterId || hasSlashInNumber;
          // Master lead: no master_id and lead_number doesn't contain "/"
          // (Note: To fully confirm it's a master lead, we'd need to check if it has subleads, but this is a good indicator)
          const isMasterLead = !isSubLead;

          allLeads.push({
            ...lead,
            lead_type: 'new',
            stage: getStageName(lead.stage), // Convert stage ID to name
            expert_opinion: expertOpinionText,
            manager_notes: managerNotesText,
            closer: lead.closer || '---', // Show --- if NULL
            scheduler: lead.scheduler || '---', // Show --- if NULL
            meeting_date: meetingDatesMap[lead.id] || null,
            follow_up_date: followUpDatesMap[lead.id] || null,
            follow_up_notes: null, // New leads don't have follow-up notes in leads table
            latest_interaction: lead.latest_interaction || null, // Add latest_interaction
            balance_currency: balanceCurrency,
            currency_id: (lead as any).currency_id,
            total: lead.balance || '',
            tags: newTagsMap.get(lead.id)?.join(', ') || '', // Add tags
            master_id: lead.master_id || null,
            is_master_lead: isMasterLead,
            is_sub_lead: isSubLead,
          });
        });
      }

      // Fetch legacy leads
      // Get selected stages for legacy (convert to numbers)
      const selectedLegacyStageIds = selectedStageIds.map(id => Number(id));

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
          expert_notes,
          management_notes,
          meeting_date,
          followup_log
        `)
        .not('probability', 'is', null) // Exclude null probabilities
        .neq('probability', '') // Exclude empty strings
        .eq('status', 0); // Only active leads

      // Apply stage filter for legacy leads - use selected stages
      if (selectedLegacyStageIds.length > 0) {
        legacyLeadsQuery = legacyLeadsQuery.in('stage', selectedLegacyStageIds);
      }

      // Apply closer_id filter (only if not filtering for NULL)
      if (filters.employee !== '--') {
        legacyLeadsQuery = legacyLeadsQuery.not('closer_id', 'is', null); // Only leads with closer assigned
      }

      // Apply date filter based on meeting_date when explicitly requested (when Show is clicked)
      if (applyDateFilters) {
        if (filters.fromDate) {
          legacyLeadsQuery = legacyLeadsQuery.gte('meeting_date', filters.fromDate);
        }
        if (filters.toDate) {
          legacyLeadsQuery = legacyLeadsQuery.lte('meeting_date', filters.toDate);
        }
      }

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

      // Debug: Log all active filters for lead 76792 debugging
      const targetLeadId = 76792;
      console.log('🔍 DEBUG: Active filters for legacy leads query', {
        minProbability: filters.minProbability,
        maxProbability: filters.maxProbability,
        categories: filters.categories?.length > 0 ? filters.categories.join(', ') : 'any',
        employee: filters.employee,
        languages: filters.languages?.length > 0 ? filters.languages.join(', ') : 'any',
        fromDate: filters.fromDate,
        toDate: filters.toDate,
        applyDateFilters,
        selectedLegacyStageIds,
        stageFilter: `stages ${selectedLegacyStageIds.join(' or ')}`,
        statusFilter: 'status = 0',
        closerFilter: 'closer_id IS NOT NULL',
        probabilityFilter: 'probability IS NOT NULL AND probability != ""'
      });

      console.log('🔍 DEBUG: Executing legacy leads query...');

      // First, directly query lead 76792 to see its actual values
      const { data: directLeadData, error: directLeadError } = await supabase
        .from('leads_lead')
        .select('id, name, probability, closer_id, stage, status, category_id, language_id, meeting_date, cdate')
        .eq('id', targetLeadId)
        .single();

      if (directLeadData) {
        const hasProbability = directLeadData.probability !== null && directLeadData.probability !== '';
        const hasCloser = directLeadData.closer_id !== null;
        const correctStatus = directLeadData.status === 0;
        const correctStage = selectedLegacyStageIds.includes(Number(directLeadData.stage));
        const passesAll = hasProbability && hasCloser && correctStatus && correctStage;

        console.log('🔍 DEBUG: Direct query for lead 76792 - FULL DETAILS', {
          found: true,
          error: directLeadError,
          leadData: {
            id: directLeadData.id,
            name: directLeadData.name,
            probability: directLeadData.probability,
            probabilityType: typeof directLeadData.probability,
            closer_id: directLeadData.closer_id,
            stage: directLeadData.stage,
            stageNumber: Number(directLeadData.stage),
            status: directLeadData.status,
            category_id: directLeadData.category_id,
            language_id: directLeadData.language_id,
            meeting_date: directLeadData.meeting_date
          },
          filterChecks: {
            hasProbability: { result: hasProbability, required: 'probability IS NOT NULL AND != ""', actual: directLeadData.probability },
            hasCloser: { result: hasCloser, required: 'closer_id IS NOT NULL', actual: directLeadData.closer_id },
            correctStatus: { result: correctStatus, required: 'status = 0', actual: directLeadData.status },
            correctStage: { result: correctStage, required: `stage IN (${selectedLegacyStageIds.join(', ')})`, actual: directLeadData.stage, stageNumber: Number(directLeadData.stage) }
          },
          passesAllFilters: passesAll,
          failingFilters: [
            !hasProbability && 'probability filter',
            !hasCloser && 'closer_id filter',
            !correctStatus && 'status filter',
            !correctStage && 'stage filter'
          ].filter(Boolean)
        });
      } else {
        console.log('🔍 DEBUG: Direct query for lead 76792 - NOT FOUND', {
          found: false,
          error: directLeadError
        });
      }

      // Check if lead 76792's probability is in the range
      if (directLeadData) {
        const probValue = Number(directLeadData.probability);
        console.log('🔍 DEBUG: Lead 76792 probability check', {
          probability: directLeadData.probability,
          probValue,
          minProbability: filters.minProbability,
          maxProbability: filters.maxProbability,
          inRange: probValue >= filters.minProbability && probValue <= filters.maxProbability,
          willBeIncluded: probValue >= filters.minProbability && probValue <= filters.maxProbability,
          cdate: directLeadData.cdate || directLeadData.meeting_date
        });
      }

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

          // Check if we found lead 76792
          const foundTarget = pageResults.find((l: any) => l.id === targetLeadId);
          if (foundTarget) {
            console.log('🔍 DEBUG: Found lead 76792 in page', { page, totalFetched: allLegacyLeads.length });
          }
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
        pagesFetched: page,
        foundTargetLead: legacyLeads.some((l: any) => l.id === targetLeadId)
      });

      // Debug specific lead 76792
      const targetLead = legacyLeads?.find((l: any) => l.id === targetLeadId);
      console.log('🔍 DEBUG: Checking for lead 76792 in query results', {
        found: !!targetLead,
        leadData: targetLead ? {
          id: targetLead.id,
          name: targetLead.name,
          probability: targetLead.probability,
          probabilityType: typeof targetLead.probability,
          probabilityNumber: Number(targetLead.probability),
          closer_id: targetLead.closer_id,
          stage: targetLead.stage,
          category_id: targetLead.category_id,
          language_id: targetLead.language_id
        } : null,
        totalLeadsInQuery: legacyLeads?.length || 0
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

          // Debug lead 76792 specifically
          if (lead.id === targetLeadId) {
            console.log('🔍 DEBUG: Lead 76792 probability filter check', {
              probability: lead.probability,
              probValue,
              isValidNumber,
              minProbability: filters.minProbability,
              maxProbability: filters.maxProbability,
              passesMin: probValue >= Number(filters.minProbability),
              passesMax: probValue <= Number(filters.maxProbability),
              willPass: isValidNumber && probValue >= Number(filters.minProbability) && probValue <= Number(filters.maxProbability)
            });
          }

          if (!isValidNumber) return false;
          return probValue >= Number(filters.minProbability) && probValue <= Number(filters.maxProbability);
        });

        // Check if lead 76792 passed probability filter
        const targetLeadAfterProb = filteredLegacyLeads.find((l: any) => l.id === targetLeadId);
        console.log('🔍 DEBUG: Lead 76792 after probability filter', {
          found: !!targetLeadAfterProb,
          passedProbabilityFilter: !!targetLeadAfterProb
        });

        console.log('🔍 DEBUG: After probability filter', {
          beforeFilter: legacyLeads.length,
          afterFilter: filteredLegacyLeads.length,
          minProbability: filters.minProbability,
          maxProbability: filters.maxProbability
        });
      }

      // Use filtered results
      const legacyLeadsToProcess = filteredLegacyLeads;

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

      // Fetch follow-up dates for legacy leads (only current user's follow-ups)
      const legacyFollowUpDatesMap: Record<number, string> = {};

      if (legacyLeadIds.length > 0 && currentUserId) {
        const { data: legacyFollowUpsData } = await supabase
          .from('follow_ups')
          .select('lead_id, date')
          .eq('user_id', currentUserId)
          .in('lead_id', legacyLeadIds)
          .is('new_lead_id', null);

        if (legacyFollowUpsData) {
          legacyFollowUpsData.forEach((fu: any) => {
            if (fu.date && fu.lead_id) {
              const dateStr = typeof fu.date === 'string'
                ? fu.date.split('T')[0]
                : new Date(fu.date).toISOString().split('T')[0];
              legacyFollowUpDatesMap[fu.lead_id] = dateStr;
            }
          });
        }
      }

      // Fetch tags for legacy leads
      const legacyTagsMap = new Map<number, string[]>();
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
          legacyTagsData.forEach((item: any) => {
            if (item.misc_leadtag) {
              const leadId = item.lead_id;
              const tagName = (item.misc_leadtag as any).name;
              if (!legacyTagsMap.has(leadId)) {
                legacyTagsMap.set(leadId, []);
              }
              legacyTagsMap.get(leadId)!.push(tagName);
            }
          });
        }
      }

      if (legacyLeadsToProcess && legacyLeadsToProcess.length > 0) {
        // Fetch closer names for legacy leads
        const closerIds = [...new Set(legacyLeadsToProcess.map((l: any) => l.closer_id).filter(Boolean))];
        const closerMap: Record<number, string> = {};

        if (closerIds.length > 0) {
          const { data: closerData } = await supabase
            .from('tenants_employee')
            .select('id, display_name')
            .in('id', closerIds);

          if (closerData) {
            closerData.forEach((emp: any) => {
              closerMap[emp.id] = emp.display_name || `Employee #${emp.id}`;
            });
          }
        }

        // Fetch scheduler names for legacy leads
        const schedulerIds = [...new Set(legacyLeadsToProcess.map((l: any) => l.meeting_scheduler_id).filter(Boolean))];
        const schedulerMap: Record<number, string> = {};

        if (schedulerIds.length > 0) {
          const { data: schedulerData } = await supabase
            .from('tenants_employee')
            .select('id, display_name')
            .in('id', schedulerIds);

          if (schedulerData) {
            schedulerData.forEach((emp: any) => {
              schedulerMap[emp.id] = emp.display_name || `Employee #${emp.id}`;
            });
          }
        }

        // Fetch currency codes
        const currencyIds = [...new Set(legacyLeadsToProcess.map((l: any) => l.currency_id).filter(Boolean))];
        const currencyMap: Record<number, string> = {};

        if (currencyIds.length > 0) {
          const { data: currencyData } = await supabase
            .from('accounting_currencies')
            .select('id, iso_code')
            .in('id', currencyIds);

          if (currencyData) {
            currencyData.forEach((curr: any) => {
              currencyMap[curr.id] = curr.iso_code || '';
            });
          }
        }

        // Fetch language names for legacy leads
        const languageIds = [...new Set(legacyLeadsToProcess.map((l: any) => l.language_id).filter(Boolean))];
        const languageMap: Record<number, string> = {};

        if (languageIds.length > 0) {
          const { data: languageData } = await supabase
            .from('misc_language')
            .select('id, name')
            .in('id', languageIds);

          if (languageData) {
            languageData.forEach((lang: any) => {
              languageMap[lang.id] = lang.name || '';
            });
          }
        }

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

          allLeads.push({
            id: `legacy_${lead.id}`,
            lead_number: lead.id?.toString() || '',
            name: lead.name || '',
            created_at: lead.cdate || new Date().toISOString(),
            closer: (lead.closer_id && closerMap[lead.closer_id]) ? closerMap[lead.closer_id] : '---',
            scheduler: (lead.meeting_scheduler_id && schedulerMap[lead.meeting_scheduler_id]) ? schedulerMap[lead.meeting_scheduler_id] : '---',
            expert: lead.expert_id ? '---' : '---', // Expert field - show --- for now (can be enhanced if needed)
            manager: lead.meeting_manager_id ? '---' : '---', // Manager field - show --- for now (can be enhanced if needed)
            category: getCategoryName(lead.category_id),
            category_id: lead.category_id,
            stage: getStageName(lead.stage),
            probability: lead.probability || 0,
            language: lead.language_id ? (languageMap[lead.language_id] || `Language #${lead.language_id}`) : null,
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
            meeting_date: meetingDate,
            follow_up_date: legacyFollowUpDatesMap[lead.id] || null,
            follow_up_notes: lead.followup_log || null,
            latest_interaction: lead.latest_interaction || null, // Add latest_interaction
            tags: legacyTagsMap.get(lead.id)?.join(', ') || '', // Add tags
          });
        });
      } else {
        console.log('🔍 DEBUG: No legacy leads to process (legacyLeadsToProcess is null or empty)');
      }

      // Check if lead 76792 is in allLeads
      const targetLeadInAllLeads = allLeads.find((l: any) => l.id === `legacy_${targetLeadId}` || l.lead_number === targetLeadId.toString());
      console.log('🔍 DEBUG: Lead 76792 in allLeads before sorting', {
        found: !!targetLeadInAllLeads,
        leadData: targetLeadInAllLeads ? {
          id: targetLeadInAllLeads.id,
          lead_number: targetLeadInAllLeads.lead_number,
          name: targetLeadInAllLeads.name,
          probability: targetLeadInAllLeads.probability,
          stage: targetLeadInAllLeads.stage,
          closer: targetLeadInAllLeads.closer,
          category: targetLeadInAllLeads.category,
          language: targetLeadInAllLeads.language
        } : null
      });

      // Check if lead L210471 is in allLeads
      const targetNewLeadInAllLeads = allLeads.find((l: any) => l.lead_number === targetNewLeadNumber);
      console.log('🔍 DEBUG: Lead L210471 in allLeads before sorting', {
        found: !!targetNewLeadInAllLeads,
        leadData: targetNewLeadInAllLeads ? {
          id: targetNewLeadInAllLeads.id,
          lead_number: targetNewLeadInAllLeads.lead_number,
          name: targetNewLeadInAllLeads.name,
          probability: targetNewLeadInAllLeads.probability,
          stage: targetNewLeadInAllLeads.stage,
          closer: targetNewLeadInAllLeads.closer,
          category: targetNewLeadInAllLeads.category,
          language: targetNewLeadInAllLeads.language
        } : null
      });

      console.log('🔍 DEBUG: Before sorting', {
        allLeadsCount: allLeads.length,
        newLeadsCount: allLeads.filter((l: any) => l.lead_type === 'new').length,
        legacyLeadsCount: allLeads.filter((l: any) => l.lead_type === 'legacy').length
      });

      // Apply tags filter client-side (if filter is set)
      let filteredAllLeads = allLeads;
      if (filters.tags && filters.tags.length > 0) {
        filteredAllLeads = allLeads.filter((lead: any) => {
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

      // Check if lead 76792 is in final sorted results
      const targetLeadInFinal = sortedLeads.find((l: any) => l.id === `legacy_${targetLeadId}` || l.lead_number === targetLeadId.toString());
      console.log('🔍 DEBUG: Lead 76792 in final sorted results', {
        found: !!targetLeadInFinal,
        leadData: targetLeadInFinal ? {
          id: targetLeadInFinal.id,
          lead_number: targetLeadInFinal.lead_number,
          name: targetLeadInFinal.name,
          probability: targetLeadInFinal.probability
        } : null
      });

      // Check if lead L210471 is in final sorted results
      const targetNewLeadInFinal = sortedLeads.find((l: any) => l.lead_number === targetNewLeadNumber);
      console.log('🔍 DEBUG: Lead L210471 in final sorted results', {
        found: !!targetNewLeadInFinal,
        leadData: targetNewLeadInFinal ? {
          id: targetNewLeadInFinal.id,
          lead_number: targetNewLeadInFinal.lead_number,
          name: targetNewLeadInFinal.name,
          probability: targetNewLeadInFinal.probability,
          stage: targetNewLeadInFinal.stage,
          closer: targetNewLeadInFinal.closer
        } : null
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

  // Automatically load all leads on component mount (without date filters)
  useEffect(() => {
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

  const getDisplayLeadNumber = (lead: any): string => {
    if (!lead) return '---';

    const isLegacy = lead.lead_type === 'legacy' || lead.id?.toString().startsWith('legacy_');

    if (isLegacy) {
      // For legacy leads
      const leadId = lead.lead_number || lead.id?.toString().replace('legacy_', '') || '---';
      const masterId = lead.master_id;

      // If master_id is null/empty, it's a master lead - return just the ID
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
      // For new leads
      let displayNumber = lead.lead_number || lead.id || '---';
      const displayStr = displayNumber.toString();
      const hasExistingSuffix = displayStr.includes('/');

      // Strip any existing suffix for processing
      let baseNumber = hasExistingSuffix ? displayStr.split('/')[0] : displayStr;

      // Show "C" prefix in UI when stage is Success (100)
      // Since we convert stage ID to name, check the stage name for "Success"
      const stageName = typeof lead.stage === 'string' ? lead.stage : String(lead.stage || '');
      const isSuccessStage = stageName.toLowerCase().includes('success') ||
        stageName === '100' ||
        (typeof lead.stage === 'number' && lead.stage === 100);
      if (isSuccessStage && baseNumber && !baseNumber.toString().startsWith('C')) {
        baseNumber = baseNumber.toString().replace(/^L/, 'C');
      }

      // Add /1 suffix to master leads (frontend only)
      const hasNoMasterId = !lead.master_id || String(lead.master_id).trim() === '';
      const isSubLead = !hasNoMasterId || hasExistingSuffix;

      if (!isSubLead) {
        // Master lead - add /1
        displayNumber = `${baseNumber}/1`;
      } else {
        // Sublead - show as is (with existing suffix)
        displayNumber = displayStr;
        // But still apply C prefix if needed
        if (isSuccessStage && displayNumber && !displayNumber.toString().startsWith('C')) {
          displayNumber = displayNumber.toString().replace(/^L/, 'C');
        }
      }

      return displayNumber.toString();
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
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-4">
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
          <div className="relative">
            <label className="block text-sm font-medium text-gray-700 mb-1">Category (Multi-select)</label>
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
                  <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-2">
                    <input
                      type="text"
                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="Search categories..."
                      value={categorySearch}
                      onChange={(e) => setCategorySearch(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onFocus={(e) => e.stopPropagation()}
                    />
                  </div>
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
                  <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-2">
                    <input
                      type="text"
                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="Search languages..."
                      value={languageSearch}
                      onChange={(e) => setLanguageSearch(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onFocus={(e) => e.stopPropagation()}
                    />
                  </div>
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
                      className="badge badge-primary badge-sm flex items-center gap-1"
                    >
                      <span>{stage.name}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleStageSelection(stageId.toString());
                        }}
                        className="ml-1 hover:bg-primary-focus rounded-full p-0.5"
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
                  <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-2">
                    <input
                      type="text"
                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="Search stages..."
                      value={stageSearch}
                      onChange={(e) => setStageSearch(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onFocus={(e) => e.stopPropagation()}
                    />
                  </div>
                  <div
                    className="px-4 py-2 cursor-pointer hover:bg-gray-100 text-sm font-semibold"
                    onClick={(e) => {
                      e.stopPropagation();
                      setFilters(prev => ({ ...prev, stages: ['40', '50'] }));
                      setStageSearch('');
                    }}
                  >
                    Reset to Default (40, 50)
                  </div>
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
                  <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-2">
                    <input
                      type="text"
                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="Search tags..."
                      value={tagsSearch}
                      onChange={(e) => setTagsSearch(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onFocus={(e) => e.stopPropagation()}
                    />
                  </div>
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
        </div>
        <div className="mt-4 flex gap-4 items-center flex-wrap">
          <button
            onClick={() => handleSearch(true)} // Pass true to apply date filters when Show is clicked
            disabled={isSearching}
            className="px-6 py-2 text-white rounded-md hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            style={{ backgroundColor: '#411CCF' }}
          >
            {isSearching ? 'Searching...' : 'Show'}
          </button>
          {/* Probability Filter Sliders */}
          <div className="flex gap-3 items-center">
            <div className="w-48">
              <label className="block text-xs font-medium text-gray-700 mb-0.5">
                Min: {filters.minProbability}%
              </label>
              <input
                type="range"
                min="0"
                max="100"
                value={filters.minProbability}
                onChange={(e) => {
                  const newMin = parseInt(e.target.value);
                  // Ensure min doesn't exceed max
                  if (newMin <= filters.maxProbability) {
                    handleFilterChange('minProbability', newMin);
                  } else {
                    // If min exceeds max, set both to the same value
                    handleFilterChange('minProbability', filters.maxProbability);
                  }
                }}
                className="w-full range range-primary range-sm"
              />
            </div>
            <div className="w-48">
              <label className="block text-xs font-medium text-gray-700 mb-0.5">
                Max: {filters.maxProbability}%
              </label>
              <input
                type="range"
                min="0"
                max="100"
                value={filters.maxProbability}
                onChange={(e) => {
                  const newMax = parseInt(e.target.value);
                  // Ensure max doesn't go below min
                  if (newMax >= filters.minProbability) {
                    handleFilterChange('maxProbability', newMax);
                  } else {
                    // If max goes below min, set both to the same value
                    handleFilterChange('maxProbability', filters.minProbability);
                  }
                }}
                className="w-full range range-primary range-sm"
              />
            </div>
          </div>
          <button
            onClick={handleCancelFilters}
            className="px-6 py-2 border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors"
          >
            Cancel
          </button>
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
                <div className="badge badge-primary badge-lg">
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
                    <th className="px-4 py-3 text-left text-xs font-medium text-black uppercase tracking-wider" style={{ maxWidth: '200px' }}>Lead</th>
                    <th className="px-2 py-3 text-left text-xs font-medium text-black uppercase tracking-wider">Stage</th>
                    <th
                      className="px-6 py-3 text-left text-xs font-medium text-black uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort('probability')}
                    >
                      <div className="flex items-center gap-1">
                        Probability
                        {sortColumn === 'probability' && (
                          <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </div>
                    </th>
                    <th
                      className="px-6 py-3 text-left text-xs font-medium text-black uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort('closer')}
                    >
                      <div className="flex items-center gap-1">
                        Closer
                        {sortColumn === 'closer' && (
                          <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </div>
                    </th>
                    <th
                      className="px-6 py-3 text-left text-xs font-medium text-black uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort('scheduler')}
                    >
                      <div className="flex items-center gap-1">
                        Scheduler
                        {sortColumn === 'scheduler' && (
                          <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </div>
                    </th>
                    <th
                      className="px-6 py-3 text-left text-xs font-medium text-black uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort('meeting_date')}
                    >
                      <div className="flex items-center gap-1">
                        Meeting Date
                        {sortColumn === 'meeting_date' && (
                          <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </div>
                    </th>
                    <th
                      className="px-6 py-3 text-left text-xs font-medium text-black uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort('follow_up_date')}
                    >
                      <div className="flex items-center gap-1">
                        Follow Up Date
                        {sortColumn === 'follow_up_date' && (
                          <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </div>
                    </th>
                    <th
                      className="px-6 py-3 text-left text-xs font-medium text-black uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort('latest_interaction')}
                    >
                      <div className="flex items-center gap-1">
                        Latest Interaction
                        {sortColumn === 'latest_interaction' && (
                          <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </div>
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-black uppercase tracking-wider" style={{ maxWidth: '200px' }}>Follow Up Notes</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-black uppercase tracking-wider" style={{ maxWidth: '200px' }}>Expert Opinion</th>
                    <th
                      className="px-6 py-3 text-left text-xs font-medium text-black uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort('total_applicants')}
                    >
                      <div className="flex items-center gap-1">
                        Total Applicants
                        {sortColumn === 'total_applicants' && (
                          <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </div>
                    </th>
                    <th
                      className="px-6 py-3 text-left text-xs font-medium text-black uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort('potential_applicants')}
                    >
                      <div className="flex items-center gap-1">
                        Potential Applicants
                        {sortColumn === 'potential_applicants' && (
                          <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </div>
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-black uppercase tracking-wider" style={{ maxWidth: '200px' }}>Manager Notes</th>
                    <th
                      className="px-6 py-3 text-left text-xs font-medium text-black uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort('total')}
                    >
                      <div className="flex items-center gap-1">
                        Total
                        {sortColumn === 'total' && (
                          <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {results.map((lead, index) => {
                    const leadKey = lead.id?.toString() || lead.lead_number || '';
                    const isExpanded = expandedRows.has(leadKey);
                    const interactions = interactionsCache.get(leadKey) || [];
                    const isLoading = loadingInteractions.has(leadKey);

                    return (
                      <React.Fragment key={lead.id || index}>
                        <tr
                          className="hover:bg-gray-50 cursor-pointer"
                          onClick={() => toggleRowExpansion(lead)}
                        >
                          <td className="px-4 py-4" style={{ maxWidth: '200px' }}>
                            <div className="flex items-center gap-2">
                              {isExpanded ? (
                                <ChevronUpIcon className="w-4 h-4 text-gray-500 flex-shrink-0" />
                              ) : (
                                <ChevronDownIcon className="w-4 h-4 text-gray-500 flex-shrink-0" />
                              )}
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
                          <td className="px-2 py-4 text-sm text-gray-900">
                            <div className="break-words max-w-[120px] sm:max-w-none sm:whitespace-nowrap line-clamp-2 sm:line-clamp-none">
                              {lead.stage || '---'}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {lead.probability ? `${lead.probability}%` : '---'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {lead.closer || '---'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {lead.scheduler || '---'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {lead.meeting_date ? new Date(lead.meeting_date).toLocaleDateString() : '---'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            <div className="flex items-center gap-2 group">
                              <span>{lead.follow_up_date ? new Date(lead.follow_up_date).toLocaleDateString() : '---'}</span>
                              <button
                                onClick={() => handleEditFollowUp(lead)}
                                className="btn btn-xs btn-ghost opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                                title="Edit follow-up date"
                              >
                                <PencilIcon className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {lead.latest_interaction ? new Date(lead.latest_interaction).toLocaleDateString() : '---'}
                          </td>
                          <td className="px-3 py-4 text-sm text-gray-900 max-w-[200px]">
                            <div
                              className="line-clamp-3 break-words cursor-help"
                              title={lead.follow_up_notes || undefined}
                            >
                              {lead.follow_up_notes || '---'}
                            </div>
                          </td>
                          <td className="px-3 py-4 text-sm text-gray-900 max-w-[200px]">
                            <div
                              className="line-clamp-3 break-words cursor-help"
                              title={lead.expert_opinion && lead.expert_opinion !== '---' ? lead.expert_opinion : undefined}
                            >
                              {lead.expert_opinion || '---'}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {lead.number_of_applicants_meeting ?? '---'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {lead.potential_applicants_meeting ?? '---'}
                          </td>
                          <td className="px-3 py-4 text-sm text-gray-900 max-w-[200px]">
                            {editingManagerNotes[lead.id || index] ? (
                              <div className="flex flex-col gap-2">
                                <textarea
                                  value={managerNotesValues[lead.id || index] || lead.manager_notes || ''}
                                  onChange={(e) => setManagerNotesValues(prev => ({ ...prev, [lead.id || index]: e.target.value }))}
                                  className="textarea textarea-bordered textarea-sm w-full min-h-[60px]"
                                  placeholder="Enter manager notes..."
                                />
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => handleSaveManagerNotes(lead)}
                                    disabled={savingManagerNotes[lead.id || index]}
                                    className="btn btn-xs btn-primary"
                                  >
                                    {savingManagerNotes[lead.id || index] ? 'Saving...' : 'Save'}
                                  </button>
                                  <button
                                    onClick={() => {
                                      setEditingManagerNotes(prev => {
                                        const newState = { ...prev };
                                        delete newState[lead.id || index];
                                        return newState;
                                      });
                                      setManagerNotesValues(prev => {
                                        const newState = { ...prev };
                                        delete newState[lead.id || index];
                                        return newState;
                                      });
                                    }}
                                    className="btn btn-xs btn-ghost"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-start gap-2 group">
                                <div
                                  className="line-clamp-3 break-words flex-1 cursor-help"
                                  title={lead.manager_notes && lead.manager_notes !== '---' ? lead.manager_notes : undefined}
                                >
                                  {lead.manager_notes || '---'}
                                </div>
                                <button
                                  onClick={() => {
                                    setEditingManagerNotes(prev => ({ ...prev, [lead.id || index]: true }));
                                    setManagerNotesValues(prev => ({ ...prev, [lead.id || index]: lead.manager_notes || '' }));
                                  }}
                                  className="btn btn-xs btn-ghost opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                                  title="Edit manager notes"
                                >
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                  </svg>
                                </button>
                              </div>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {formatCurrency(lead.total || '', lead.balance_currency || '', lead)}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={14} className="px-4 py-4 bg-gray-50 border-t border-gray-200">
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

      {/* Follow-up Edit Modal */}
      {editingFollowUp && (
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
                    setEditingFollowUp(null);
                    setFollowUpDate('');
                  }}
                  disabled={savingFollowUp}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleSaveFollowUp}
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
    </div>
  );
};

export default CloserSuperPipelinePage;
