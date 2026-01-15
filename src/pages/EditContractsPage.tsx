import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { MagnifyingGlassIcon, XMarkIcon, DocumentTextIcon, ArrowLeftIcon } from '@heroicons/react/24/solid';
import { supabase } from '../lib/supabase';
import { usePersistedState } from '../hooks/usePersistedState';
import { toast } from 'react-hot-toast';

// Reports list for search functionality
type ReportItem = {
  label: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  route?: string;
};

type ReportSection = {
  category: string;
  items: ReportItem[];
};

const reports: ReportSection[] = [
  {
    category: 'Search',
    items: [
      { label: 'Full Search', icon: MagnifyingGlassIcon, route: '/reports' },
      { label: 'Stage Search', icon: MagnifyingGlassIcon, route: '/reports' },
      { label: 'Anchor Search', icon: MagnifyingGlassIcon, route: '/reports' },
      { label: 'Duplicate Search', icon: MagnifyingGlassIcon, route: '/reports' },
    ],
  },
  {
    category: 'Marketing',
    items: [
      { label: 'Sources pie', icon: MagnifyingGlassIcon, route: '/reports' },
      { label: 'Category & source', icon: MagnifyingGlassIcon, route: '/reports' },
      { label: 'Convertion', icon: MagnifyingGlassIcon, route: '/reports' },
      { label: 'Convertion Steps', icon: MagnifyingGlassIcon, route: '/reports' },
    ],
  },
  {
    category: 'Meetings',
    items: [
      { label: 'Scheduled', icon: MagnifyingGlassIcon, route: '/reports' },
      { label: 'Rescheduled', icon: MagnifyingGlassIcon, route: '/reports' },
      { label: 'Results', icon: MagnifyingGlassIcon, route: '/reports' },
      { label: 'Collection', icon: MagnifyingGlassIcon, route: '/reports' },
      { label: 'Convertion', icon: MagnifyingGlassIcon, route: '/reports' },
    ],
  },
  {
    category: 'Sales',
    items: [
      { label: 'Actual', icon: MagnifyingGlassIcon, route: '/reports' },
      { label: 'Target', icon: MagnifyingGlassIcon, route: '/reports' },
      { label: 'Signed', icon: MagnifyingGlassIcon, route: '/sales/signed' },
      { label: 'Scheduling Bonuses', icon: MagnifyingGlassIcon, route: '/reports' },
      { label: 'Bonuses (v4)', icon: MagnifyingGlassIcon, route: '/reports' },
    ],
  },
  {
    category: 'Pipelines',
    items: [
      { label: 'General Sales', icon: MagnifyingGlassIcon, route: '/reports' },
      { label: 'Employee', icon: MagnifyingGlassIcon, route: '/reports' },
      { label: 'Unhandled', icon: MagnifyingGlassIcon, route: '/reports' },
      { label: 'Expert', icon: MagnifyingGlassIcon, route: '/reports' },
    ],
  },
  {
    category: 'Schedulers',
    items: [
      { label: 'Super Pipeline', icon: MagnifyingGlassIcon, route: '/reports' },
      { label: 'Schedulers Quality', icon: MagnifyingGlassIcon, route: '/reports' },
      { label: 'Performance', icon: MagnifyingGlassIcon, route: '/reports' },
      { label: 'Performance by Cat.', icon: MagnifyingGlassIcon, route: '/reports' },
    ],
  },
  {
    category: 'Closers',
    items: [
      { label: 'Super Pipeline', icon: MagnifyingGlassIcon, route: '/reports' },
      { label: 'Closers Quality', icon: MagnifyingGlassIcon, route: '/reports' },
    ],
  },
  {
    category: 'Experts',
    items: [
      { label: 'Experts Assignment', icon: MagnifyingGlassIcon, route: '/reports' },
      { label: 'Experts Results', icon: MagnifyingGlassIcon, route: '/reports' },
    ],
  },
  {
    category: 'Contribution',
    items: [
      { label: 'All', icon: MagnifyingGlassIcon, route: '/reports' },
    ],
  },
  {
    category: 'Analysis',
    items: [
      { label: 'Employees Performance', icon: MagnifyingGlassIcon, route: '/reports' },
      { label: 'Statistics', icon: MagnifyingGlassIcon, route: '/reports' },
      { label: 'Pies', icon: MagnifyingGlassIcon, route: '/reports' },
      { label: 'Tasks', icon: MagnifyingGlassIcon, route: '/reports' },
    ],
  },
  {
    category: 'Finances',
    items: [
      { label: 'Profitability', icon: MagnifyingGlassIcon, route: '/reports' },
      { label: 'Collection', icon: MagnifyingGlassIcon, route: '/reports/collection-finances' },
      { label: 'Collection Due', icon: MagnifyingGlassIcon, route: '/reports/collection-due' },
    ],
  },
  {
    category: 'Cases',
    items: [
      { label: 'Sum Active', icon: MagnifyingGlassIcon, route: '/reports' },
    ],
  },
  {
    category: 'Tools',
    items: [
      { label: 'Edit Contracts', icon: DocumentTextIcon, route: '/reports/edit-contracts' },
    ],
  },
];

const EditContractsPage = () => {
  const navigate = useNavigate();
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [stageMap, setStageMap] = useState<{ [key: string]: string }>({});
  const [employeeMap, setEmployeeMap] = useState<{ [key: string]: string }>({});
  const [dateFrom, setDateFrom] = useState<string>(todayStr);
  const [dateTo, setDateTo] = useState<string>(todayStr);

  // Search for other reports functionality
  const [reportsSearchQuery, setReportsSearchQuery] = usePersistedState<string>('editContractsReport_searchQuery', '', {
    storage: 'sessionStorage',
  });

  // Filter reports based on search query
  const filteredReports = useMemo(() => {
    if (!reportsSearchQuery.trim()) {
      return reports;
    }

    const query = reportsSearchQuery.toLowerCase().trim();
    return reports
      .map((section) => {
        const filteredItems = section.items.filter((item) => {
          const labelMatch = item.label.toLowerCase().includes(query);
          const categoryMatch = section.category.toLowerCase().includes(query);
          return labelMatch || categoryMatch;
        });
        return { ...section, items: filteredItems };
      })
      .filter((section) => section.items.length > 0);
  }, [reportsSearchQuery]);

  // Fetch stage names from database
  useEffect(() => {
    const fetchStages = async () => {
      try {
        const { data, error } = await supabase
          .from('lead_stages')
          .select('id, name');

        if (error) {
          console.error('Error fetching stages:', error);
          return;
        }

        if (data) {
          const map: { [key: string]: string } = {};
          data.forEach((stage: any) => {
            map[stage.id] = stage.name;
          });
          setStageMap(map);
        }
      } catch (error) {
        console.error('Error fetching stages:', error);
      }
    };

    fetchStages();
  }, []);

  // Fetch employee names from database
  useEffect(() => {
    const fetchEmployees = async () => {
      try {
        const { data, error } = await supabase
          .from('tenants_employee')
          .select('id, display_name');

        if (error) {
          console.error('Error fetching employees:', error);
          return;
        }

        if (data) {
          const map: { [key: string]: string } = {};
          data.forEach((employee: any) => {
            map[employee.id] = employee.display_name;
          });
          setEmployeeMap(map);
        }
      } catch (error) {
        console.error('Error fetching employees:', error);
      }
    };

    fetchEmployees();
  }, []);

  // Generate search variants for multilingual matching (from Header.tsx)
  const generateSearchVariants = (query: string): string[] => {
    const variants: string[] = [query];
    
    // Hebrew to English transliteration mapping (common patterns)
    const hebrewToEnglish: { [key: string]: string } = {
      'א': 'a', 'ב': 'b', 'ג': 'g', 'ד': 'd', 'ה': 'h', 'ו': 'v', 'ז': 'z', 'ח': 'h',
      'ט': 't', 'י': 'i', 'כ': 'k', 'ך': 'k', 'ל': 'l', 'מ': 'm', 'ם': 'm', 'נ': 'n',
      'ן': 'n', 'ס': 's', 'ע': 'a', 'פ': 'p', 'ף': 'p', 'צ': 'ts', 'ץ': 'ts', 'ק': 'k',
      'ר': 'r', 'ש': 'sh', 'ת': 't'
    };
    
    // English to Hebrew transliteration mapping (reverse)
    const englishToHebrew: { [key: string]: string } = {
      'a': 'א', 'b': 'ב', 'g': 'ג', 'd': 'ד', 'h': 'ה', 'v': 'ו', 'z': 'ז',
      'i': 'י', 'k': 'כ', 'l': 'ל', 'm': 'מ', 'n': 'נ', 's': 'ס', 'p': 'פ',
      'r': 'ר', 't': 'ת'
    };
    
    // If query contains Hebrew, add English transliteration
    if (/[\u0590-\u05FF]/.test(query)) {
      const englishVariant = query.split('').map(char => hebrewToEnglish[char] || char).join('');
      if (englishVariant !== query) {
        variants.push(englishVariant);
      }
    }
    
    // If query is English, add Hebrew transliteration
    if (/^[a-zA-Z\s]+$/.test(query)) {
      const hebrewVariant = query.toLowerCase().split('').map(char => englishToHebrew[char] || char).join('');
      if (hebrewVariant !== query) {
        variants.push(hebrewVariant);
      }
    }
    
    return variants;
  };

  // Get stage name by ID
  const getStageName = (stageId: string | number): string => {
    const id = String(stageId);
    return stageMap[id] || `Stage ${id}`;
  };

  // Get employee name by ID
  const getEmployeeName = (employeeId: string | number | null | undefined): string => {
    if (!employeeId) return 'N/A';
    const id = String(employeeId);
    return employeeMap[id] || 'Unknown';
  };

  // Helper functions for date filtering (same as SignedSalesReportPage)
  const toStartOfDayIso = (dateStr: string) => {
    const date = new Date(`${dateStr}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  };

  const toNextDayIso = (dateStr: string) => {
    const date = new Date(`${dateStr}T00:00:00`);
    if (Number.isNaN(date.getTime())) return null;
    date.setDate(date.getDate() + 1);
    return date.toISOString();
  };

  const computeDateBounds = (fromDate?: string, toDate?: string) => {
    const startIso = fromDate ? toStartOfDayIso(fromDate) : null;
    const endIso = (() => {
      if (toDate) return toNextDayIso(toDate);
      if (fromDate) return toNextDayIso(fromDate);
      return null;
    })();
    return { startIso, endIso };
  };

  const performSearch = async (query: string) => {
    const trimmed = query.trim();
    
    setIsSearching(true);

    try {
      const { startIso, endIso } = computeDateBounds(dateFrom, dateTo);

      // First, fetch ALL stage 60 records from leads_leadstage filtered by date (same logic as SignedSalesReportPage)
      // This is the authoritative source for signed agreements
      let stage60Query = supabase
        .from('leads_leadstage')
        .select('id, lead_id, newlead_id, stage, cdate, date, creator_id')
        .eq('stage', 60); // Stage 60 = Client signed agreement

      // Filter by date column (not cdate)
      if (startIso) {
        stage60Query = stage60Query.gte('date', startIso);
      }
      if (endIso) {
        stage60Query = stage60Query.lt('date', endIso);
      }

      const { data: allStage60Records, error: stage60Error } = await stage60Query;
      
      if (stage60Error) {
        console.error('Failed to load stage 60 records:', stage60Error);
        throw stage60Error;
      }

      console.log(`✅ Fetched ${allStage60Records?.length || 0} stage 60 records with date filter`);

      // Separate legacy and new leads, and track sign dates (use date from stage 60 record)
      const legacyLeadIdsSet = new Set<number>();
      const newLeadIdsSet = new Set<string>();
      const legacyStageDates = new Map<number, string>(); // lead_id -> date from stage 60
      const newLeadStageDates = new Map<string, string>(); // newlead_id -> date from stage 60
      const legacyCreatorIds = new Map<number, number | null>(); // lead_id -> creator_id
      const newLeadCreatorIds = new Map<string, number | null>(); // newlead_id -> creator_id

      (allStage60Records || []).forEach(record => {
        // Legacy leads: use lead_id
        if (record.lead_id !== null && record.lead_id !== undefined) {
          const legacyId = Number(record.lead_id);
          if (Number.isFinite(legacyId)) {
            legacyLeadIdsSet.add(legacyId);
            // Use date as the sign date (preferred) or cdate as fallback
            const signDate = record.date || record.cdate || null;
            if (signDate) {
              const existing = legacyStageDates.get(legacyId);
              // Keep the most recent date if there are multiple stage 60 entries
              if (!existing || new Date(signDate).getTime() > new Date(existing).getTime()) {
                legacyStageDates.set(legacyId, signDate);
                legacyCreatorIds.set(legacyId, record.creator_id || null);
              }
            }
          }
        }

        // New leads: use newlead_id
        if (record.newlead_id !== null && record.newlead_id !== undefined) {
          const newLeadId = record.newlead_id.toString();
          newLeadIdsSet.add(newLeadId);
          // Use date as the sign date (preferred) or cdate as fallback
          const signDate = record.date || record.cdate || null;
          if (signDate) {
            const existing = newLeadStageDates.get(newLeadId);
            // Keep the most recent date if there are multiple stage 60 entries
            if (!existing || new Date(signDate).getTime() > new Date(existing).getTime()) {
              newLeadStageDates.set(newLeadId, signDate);
              newLeadCreatorIds.set(newLeadId, record.creator_id || null);
            }
          }
        }
      });

      console.log(`✅ Found ${legacyLeadIdsSet.size} legacy leads and ${newLeadIdsSet.size} new leads with stage 60`);

      const results: any[] = [];

      // Fetch new leads data
      const allNewLeadIds = Array.from(newLeadIdsSet).filter(Boolean);
      if (allNewLeadIds.length > 0) {
        let newLeadsQuery = supabase
          .from('leads')
          .select('id, lead_number, name, email, phone, mobile, topic, stage, created_at, closer_id')
          .in('id', allNewLeadIds);

        // Apply search filters if query provided
        if (trimmed.length >= 2) {
          const lower = trimmed.toLowerCase();
          const digits = trimmed.replace(/\D/g, '');
          const isEmail = trimmed.includes('@');
          const isPureNumeric = /^\d+$/.test(trimmed);
          const hasPrefix = /^[LC]/i.test(trimmed);
          const noPrefix = trimmed.replace(/^[LC]/i, '');
          const isNumericQuery = /^\d+$/.test(noPrefix) && noPrefix.length > 0;
          const startsWithZero = digits.startsWith('0') && digits.length >= 4;
          const isLeadNumber = hasPrefix || (isNumericQuery && isPureNumeric && digits.length <= 6 && !startsWithZero);
          const isPhone = startsWithZero || digits.length >= 7 || (digits.length >= 3 && digits.length <= 6 && !isNumericQuery && !hasPrefix);

          const newLeadConditions: string[] = [];
          const searchVariants = generateSearchVariants(trimmed);

          // Always search name
          searchVariants.forEach(variant => {
            newLeadConditions.push(`name.ilike.%${variant}%`);
          });

          // Email search
          if (isEmail || trimmed.length >= 3) {
            searchVariants.forEach(variant => {
              newLeadConditions.push(`email.ilike.%${variant}%`);
            });
          }

          // Phone number search
          if (isPhone && digits.length >= 3) {
            newLeadConditions.push(`phone.ilike.%${digits}%`);
            newLeadConditions.push(`mobile.ilike.%${digits}%`);
          } else if (isLeadNumber) {
            // Lead number search
            newLeadConditions.push(`lead_number.ilike.%${trimmed}%`);
            newLeadConditions.push(`lead_number.ilike.L%${trimmed}%`);
            newLeadConditions.push(`lead_number.ilike.C%${trimmed}%`);
          }

          if (newLeadConditions.length > 0) {
            newLeadsQuery = newLeadsQuery.or(newLeadConditions.join(','));
          }
        }

        const { data: newLeads, error: newError } = await newLeadsQuery.limit(50);

        if (newError) {
          console.error('Error fetching new leads:', newError);
        } else if (newLeads) {
          for (const lead of newLeads) {
            const signDate = newLeadStageDates.get(String(lead.id));
            const creatorId = newLeadCreatorIds.get(String(lead.id));

            if (signDate) {
              results.push({
                id: lead.id,
                lead_number: lead.lead_number || '',
                name: lead.name || '',
                email: lead.email || '',
                phone: lead.phone || '',
                mobile: lead.mobile || '',
                topic: lead.topic || '',
                stage: String(lead.stage ?? ''),
                lead_type: 'new',
                signed_date: signDate,
                creator_id: creatorId || null,
                closer: lead.closer_id || null,
              });
            }
          }
        }
      }

      // Fetch legacy leads data
      const allLegacyLeadIds = Array.from(legacyLeadIdsSet);
      if (allLegacyLeadIds.length > 0) {
        let legacyLeadsQuery = supabase
          .from('leads_lead')
          .select('id, lead_number, name, email, phone, mobile, topic, stage, cdate, closer_id')
          .in('id', allLegacyLeadIds);

        // Apply search filters if query provided
        if (trimmed.length >= 2) {
          const lower = trimmed.toLowerCase();
          const digits = trimmed.replace(/\D/g, '');
          const isEmail = trimmed.includes('@');
          const isPureNumeric = /^\d+$/.test(trimmed);
          const hasPrefix = /^[LC]/i.test(trimmed);
          const noPrefix = trimmed.replace(/^[LC]/i, '');
          const isNumericQuery = /^\d+$/.test(noPrefix) && noPrefix.length > 0;
          const startsWithZero = digits.startsWith('0') && digits.length >= 4;
          const isLeadNumber = hasPrefix || (isNumericQuery && isPureNumeric && digits.length <= 6 && !startsWithZero);
          const isPhone = startsWithZero || digits.length >= 7 || (digits.length >= 3 && digits.length <= 6 && !isNumericQuery && !hasPrefix);

          const legacyLeadConditions: string[] = [];
          const searchVariants = generateSearchVariants(trimmed);

          // Always search name
          searchVariants.forEach(variant => {
            legacyLeadConditions.push(`name.ilike.%${variant}%`);
          });

          // Email search
          if (isEmail || trimmed.length >= 3) {
            searchVariants.forEach(variant => {
              legacyLeadConditions.push(`email.ilike.%${variant}%`);
            });
          }

          // Phone number search
          if (isPhone && digits.length >= 3) {
            legacyLeadConditions.push(`phone.ilike.%${digits}%`);
            legacyLeadConditions.push(`mobile.ilike.%${digits}%`);
          } else if (isLeadNumber) {
            // Lead number search
            if (isNumericQuery && digits.length <= 6 && !startsWithZero) {
              const numId = parseInt(noPrefix, 10);
              if (!isNaN(numId) && numId > 0) {
                legacyLeadConditions.push(`id.eq.${numId}`);
              }
            }
          }

          if (legacyLeadConditions.length > 0) {
            legacyLeadsQuery = legacyLeadsQuery.or(legacyLeadConditions.join(','));
          }
        }

        const { data: legacyLeads, error: legacyError } = await legacyLeadsQuery.limit(50);

        if (legacyError) {
          console.error('Error fetching legacy leads:', legacyError);
        } else if (legacyLeads) {
          for (const lead of legacyLeads) {
            const leadNumber = lead.lead_number ? String(lead.lead_number) : String(lead.id);
            const signDate = legacyStageDates.get(Number(lead.id));
            const creatorId = legacyCreatorIds.get(Number(lead.id));

            if (signDate) {
              results.push({
                id: `legacy_${lead.id}`,
                lead_number: leadNumber,
                name: lead.name || '',
                email: lead.email || '',
                phone: lead.phone || '',
                mobile: lead.mobile || '',
                topic: lead.topic || '',
                stage: String(lead.stage ?? ''),
                lead_type: 'legacy',
                signed_date: signDate,
                legacy_id: lead.id,
                creator_id: creatorId || null,
                closer: lead.closer_id || null,
              });
            }
          }
        }
      }

      setSearchResults(results);
    } catch (error) {
      console.error('Error performing search:', error);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery.trim()) {
        performSearch(searchQuery);
      } else {
        setSearchResults([]);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]); // Removed dateFrom and dateTo - now manual search only

  const handleManualSearch = () => {
    performSearch(searchQuery);
  };

  const handleSaveSignedDate = async (lead: any, newDate: string) => {
    if (!lead || !newDate) return;

    try {
      const isLegacy = lead.lead_type === 'legacy';
      const leadId = isLegacy ? lead.legacy_id : lead.id;
      const leadNumber = lead.lead_number;

      // First, find all leads with the same lead_number (including subleads)
      let allLeadIds: number[] = [];

      if (isLegacy) {
        // For legacy leads, find all leads with the same lead_number
        const { data: matchingLeads, error: findError } = await supabase
          .from('leads_lead')
          .select('id')
          .eq('lead_number', leadNumber);

        if (findError) {
          console.error('Error finding matching legacy leads:', findError);
          toast.error('Failed to find matching leads. Please try again.');
          return;
        }

        if (matchingLeads) {
          allLeadIds = matchingLeads.map(l => l.id);
        }
      } else {
        // For new leads, find all leads with the same lead_number
        const { data: matchingLeads, error: findError } = await supabase
          .from('leads')
          .select('id')
          .eq('lead_number', leadNumber);

        if (findError) {
          console.error('Error finding matching new leads:', findError);
          toast.error('Failed to find matching leads. Please try again.');
          return;
        }

        if (matchingLeads) {
          allLeadIds = matchingLeads.map(l => l.id);
        }
      }

      if (allLeadIds.length === 0) {
        toast.error('No matching leads found.');
        return;
      }

      // Update ALL stage 60 entries for all leads with the same lead_number
      // Use the date column (not cdate or another column)
      const { error: updateError } = await supabase
        .from('leads_leadstage')
        .update({ date: newDate })
        .eq('stage', 60)
        .in(isLegacy ? 'lead_id' : 'newlead_id', allLeadIds);

      if (updateError) {
        console.error('Error updating signed date:', updateError);
        toast.error('Failed to update signed date. Please try again.');
        return;
      }

      // Update the local state for all matching results
      setSearchResults(prevResults =>
        prevResults.map(l => {
          // Check if this result has the same lead_number
          if (l.lead_number === leadNumber) {
            return { ...l, signed_date: newDate };
          }
          return l;
        })
      );

      toast.success(`Signed date updated successfully for ${allLeadIds.length} lead(s) with lead number ${leadNumber}!`);
    } catch (error) {
      console.error('Error saving signed date:', error);
      toast.error('An error occurred while saving. Please try again.');
    }
  };

  const handleNavigateToLead = (lead: any) => {
    const isLegacy = lead.lead_type === 'legacy';
    const leadId = isLegacy ? lead.legacy_id : lead.id;
    navigate(`/clients/${leadId}`);
  };

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <DocumentTextIcon className="w-10 h-10 text-primary" />
            Edit Contracts
          </h1>
          <p className="text-gray-500 mt-1">Edit signed contract dates for leads.</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Search Bar */}
          <div className="relative max-w-xs">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search other reports..."
              value={reportsSearchQuery}
              onChange={(e) => setReportsSearchQuery(e.target.value)}
              className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-sm"
            />
            {reportsSearchQuery && (
              <button
                onClick={() => setReportsSearchQuery('')}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <XMarkIcon className="w-4 h-4" />
              </button>
            )}
          </div>
          {/* Back to Reports Button */}
          <Link
            to="/reports"
            className="btn btn-outline btn-primary flex items-center gap-2"
          >
            <ArrowLeftIcon className="w-5 h-5" />
            Back to Reports
          </Link>
        </div>
      </div>

      {/* Search Results Dropdown */}
      {reportsSearchQuery && (
        <div className="border border-gray-200 rounded-lg bg-white shadow-lg max-h-96 overflow-y-auto">
          <div className="p-4">
            <p className="text-sm font-semibold text-gray-700 mb-3">Quick Switch to:</p>
            <div className="space-y-2">
              {filteredReports.map((section) =>
                section.items.map((item) => (
                  <button
                    key={item.label}
                    onClick={() => {
                      if (item.route) {
                        navigate(item.route);
                        setReportsSearchQuery('');
                      }
                    }}
                    className={`w-full text-left px-4 py-2 rounded-md hover:bg-primary hover:text-white transition-colors flex items-center gap-3 ${
                      item.route === '/reports/edit-contracts' ? 'bg-primary text-white' : 'bg-gray-50'
                    }`}
                  >
                    <item.icon className="w-5 h-5" />
                    <div className="flex-1">
                      <div className="font-medium">{item.label}</div>
                      <div className="text-xs opacity-75">{section.category}</div>
                    </div>
                  </button>
                ))
              )}
            </div>
            {filteredReports.length === 0 && (
              <div className="text-center py-4 text-gray-500 text-sm">
                No reports found matching "{reportsSearchQuery}"
              </div>
            )}
          </div>
        </div>
      )}

      <div className="card bg-base-100 shadow-lg p-6">
        <div className="mb-6">
          {/* Search Bar and Filters - All on one line */}
          <div className="flex gap-3 items-end">
            <div className="relative flex-1 max-w-md">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search by name, email, phone..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-10 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <XMarkIcon className="w-5 h-5" />
                </button>
              )}
            </div>

            <div className="flex flex-col">
              <span className="text-xs font-semibold mb-1">From Date</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="input input-bordered w-40"
              />
            </div>

            <div className="flex flex-col">
              <span className="text-xs font-semibold mb-1">To Date</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="input input-bordered w-40"
              />
            </div>

            {(dateFrom || dateTo) && (
              <button
                onClick={() => {
                  setDateFrom('');
                  setDateTo('');
                }}
                className="btn btn-ghost btn-square"
                title="Clear dates"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            )}

            <button
              onClick={handleManualSearch}
              className="btn btn-primary"
              disabled={isSearching}
            >
              {isSearching ? (
                <>
                  <span className="loading loading-spinner loading-sm"></span>
                  Searching...
                </>
              ) : (
                <>
                  <MagnifyingGlassIcon className="w-5 h-5" />
                  Search
                </>
              )}
            </button>
          </div>

          {isSearching && (
            <div className="mt-4 text-center">
              <span className="loading loading-spinner loading-md"></span>
              <p className="text-gray-600 mt-2">Searching...</p>
            </div>
          )}
        </div>

        {/* Search Results */}
        {searchResults.length > 0 && (
          <div className="mb-6">
            <h3 className="text-xl font-semibold mb-4">Search Results ({searchResults.length})</h3>
            <div className="overflow-x-auto">
              <table className="table w-full">
                <thead>
                  <tr>
                    <th>Lead Number</th>
                    <th>Name</th>
                    <th>Employee</th>
                    <th>Stage</th>
                    <th>Signed Date</th>
                  </tr>
                </thead>
                <tbody>
                  {searchResults.map((lead) => (
                    <tr key={lead.id} className="hover:bg-base-200">
                      <td>
                        <button
                          onClick={() => handleNavigateToLead(lead)}
                          className="font-semibold text-primary hover:underline cursor-pointer"
                        >
                          {lead.lead_number}
                        </button>
                      </td>
                      <td>{lead.name}</td>
                      <td>
                        {lead.creator_id 
                          ? getEmployeeName(lead.creator_id) 
                          : getEmployeeName(lead.closer)
                        }
                      </td>
                      <td>
                        <span className="badge badge-primary">{getStageName(lead.stage)}</span>
                      </td>
                      <td>
                        <input
                          type="date"
                          value={lead.signed_date ? new Date(lead.signed_date).toISOString().split('T')[0] : ''}
                          onChange={(e) => handleSaveSignedDate(lead, e.target.value)}
                          className="input input-bordered input-sm w-40"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {searchQuery && !isSearching && searchResults.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-500 text-lg">
              No leads found matching "{searchQuery}" with stage 60 or above and a signed date.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default EditContractsPage;
