import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { MagnifyingGlassIcon, XMarkIcon, DocumentTextIcon, ArrowLeftIcon } from '@heroicons/react/24/solid';
import { supabase } from '../lib/supabase';
import { usePersistedState } from '../hooks/usePersistedState';
import { toast } from 'react-hot-toast';
import { getStageName, getStageColour } from '../lib/stageUtils';

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

  // Auto-load data for current date on mount
  useEffect(() => {
    if (dateFrom || dateTo) {
      performSearch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount

  // Helper function to get contrasting text color based on background
  const getContrastingTextColor = (hexColor?: string | null) => {
    if (!hexColor) return '#111827';
    let sanitized = hexColor.trim();
    if (sanitized.startsWith('#')) sanitized = sanitized.slice(1);
    if (sanitized.length === 3) {
      sanitized = sanitized.split('').map(char => char + char).join('');
    }
    if (!/^[0-9a-fA-F]{6}$/.test(sanitized)) {
      return '#111827';
    }
    const r = parseInt(sanitized.slice(0, 2), 16) / 255;
    const g = parseInt(sanitized.slice(2, 4), 16) / 255;
    const b = parseInt(sanitized.slice(4, 6), 16) / 255;

    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return luminance > 0.55 ? '#111827' : '#ffffff';
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

  const performSearch = async () => {
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
        const { data: newLeads, error: newError } = await supabase
          .from('leads')
          .select('id, lead_number, name, email, phone, mobile, topic, stage, created_at, closer_id, master_id')
          .in('id', allNewLeadIds)
          .limit(50);

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
                master_id: lead.master_id || null,
              });
            }
          }
        }
      }

      // Fetch legacy leads data
      const allLegacyLeadIds = Array.from(legacyLeadIdsSet);
      if (allLegacyLeadIds.length > 0) {
        const { data: legacyLeads, error: legacyError } = await supabase
          .from('leads_lead')
          .select('id, lead_number, name, email, phone, mobile, topic, stage, cdate, closer_id, master_id')
          .in('id', allLegacyLeadIds)
          .limit(50);

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
                master_id: lead.master_id || null,
              });
            }
          }
        }
      }

      // Calculate sublead suffixes for all results
      // Group leads by master_id to calculate suffixes
      const subleadSuffixMap = new Map<string, number>(); // lead.id -> suffix
      const masterIdsWithSubLeads = new Set<string | number>();

      // Group subleads by master_id
      const subleadsByMaster = new Map<string | number, any[]>();
      results.forEach((lead) => {
        if (lead.master_id) {
          const masterId = lead.master_id;
          if (!subleadsByMaster.has(masterId)) {
            subleadsByMaster.set(masterId, []);
          }
          subleadsByMaster.get(masterId)!.push(lead);
          masterIdsWithSubLeads.add(masterId);
        }
      });

      // Calculate suffixes for each group of subleads
      subleadsByMaster.forEach((subleads, masterId) => {
        // Sort subleads by ID to ensure consistent ordering
        subleads.sort((a, b) => {
          const idA = a.lead_type === 'legacy'
            ? Number(a.legacy_id || a.id?.toString().replace('legacy_', '') || 0)
            : Number(a.id || 0);
          const idB = b.lead_type === 'legacy'
            ? Number(b.legacy_id || b.id?.toString().replace('legacy_', '') || 0)
            : Number(b.id || 0);
          return idA - idB;
        });

        // Assign suffixes starting from 2
        subleads.forEach((sublead, index) => {
          const leadKey = sublead.id?.toString() || '';
          subleadSuffixMap.set(leadKey, index + 2); // First sublead is /2, second is /3, etc.
        });
      });

      // Compute display lead numbers for all results
      const resultsWithDisplayNumbers = results.map((lead) => {
        const hasNoMasterId = !lead.master_id || String(lead.master_id).trim() === '';
        const leadKey = lead.id?.toString() || '';

        // Check if this master lead has subleads
        let hasSubLeads = false;
        if (hasNoMasterId) {
          // Check if this lead's ID is in the set of master IDs that have subleads
          const leadIdForCheck = lead.lead_type === 'legacy'
            ? (lead.legacy_id || lead.id?.toString().replace('legacy_', ''))
            : lead.id;
          hasSubLeads = masterIdsWithSubLeads.has(leadIdForCheck);
        }

        // Get suffix for subleads
        const suffix = subleadSuffixMap.get(leadKey);

        // Format lead number
        let displayNumber = lead.lead_number || lead.manual_id || lead.id || '---';
        const displayStr = displayNumber.toString();
        const hasExistingSuffix = displayStr.includes('/');
        let baseNumber = hasExistingSuffix ? displayStr.split('/')[0] : displayStr;

        // Show "C" prefix for Success stage
        const isSuccessStage = lead.stage === '100' || lead.stage === 100;
        if (isSuccessStage && baseNumber && !baseNumber.toString().startsWith('C')) {
          baseNumber = baseNumber.toString().replace(/^L/, 'C');
        }

        // Format final display number
        if (lead.master_id && suffix) {
          // It's a sublead - use calculated suffix
          displayNumber = `${baseNumber}/${suffix}`;
        } else if (hasNoMasterId && hasSubLeads && !hasExistingSuffix) {
          // It's a master lead with subleads - add /1
          displayNumber = `${baseNumber}/1`;
        } else if (hasExistingSuffix) {
          // Keep existing suffix
          displayNumber = displayStr;
        } else {
          displayNumber = baseNumber;
        }

        return {
          ...lead,
          display_lead_number: displayNumber
        };
      });

      setSearchResults(resultsWithDisplayNumbers);
    } catch (error) {
      console.error('Error performing search:', error);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleManualSearch = () => {
    performSearch();
  };

  const handleSaveSignedDate = async (lead: any, newDate: string) => {
    if (!lead || !newDate) return;

    try {
      const isLegacy = lead.lead_type === 'legacy';
      const leadId = isLegacy ? lead.legacy_id : lead.id;

      if (!leadId) {
        toast.error('Invalid lead ID.');
        return;
      }

      // Update the stage 60 entry for this specific lead only
      const { error: updateError } = await supabase
        .from('leads_leadstage')
        .update({ date: newDate })
        .eq('stage', 60)
        .eq(isLegacy ? 'lead_id' : 'newlead_id', leadId);

      if (updateError) {
        console.error('Error updating signed date:', updateError);
        toast.error('Failed to update signed date. Please try again.');
        return;
      }

      // Update the local state for this specific lead
      setSearchResults(prevResults =>
        prevResults.map(l => {
          const resultId = isLegacy ? l.legacy_id : l.id;
          if (String(resultId) === String(leadId)) {
            return { ...l, signed_date: newDate };
          }
          return l;
        })
      );

      toast.success('Signed date updated successfully!');
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
                    className={`w-full text-left px-4 py-2 rounded-md hover:bg-primary hover:text-white transition-colors flex items-center gap-3 ${item.route === '/reports/edit-contracts' ? 'bg-primary text-white' : 'bg-gray-50'
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
          {/* Date Filters and Search Button */}
          <div className="flex gap-3 items-end">
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
                          {lead.display_lead_number || lead.lead_number || '---'}
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
                        {(() => {
                          const stageId = String(lead.stage || '');
                          const stageName = getStageName(stageId);
                          const stageColour = getStageColour(stageId);
                          const textColor = getContrastingTextColor(stageColour);
                          const backgroundColor = stageColour || '#3b28c7';

                          return (
                            <span
                              className="badge badge-sm font-semibold"
                              style={{
                                backgroundColor: backgroundColor,
                                color: backgroundColor ? textColor : undefined,
                                borderColor: backgroundColor,
                              }}
                            >
                              {stageName}
                            </span>
                          );
                        })()}
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

        {!isSearching && searchResults.length === 0 && (dateFrom || dateTo) && (
          <div className="text-center py-12">
            <p className="text-gray-500 text-lg">
              Change filter and search for leads.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default EditContractsPage;
