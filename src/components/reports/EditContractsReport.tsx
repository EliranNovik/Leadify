import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/solid';
import { supabase } from '../../lib/supabase';

const EditContractsReport = () => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [stageMap, setStageMap] = useState<{ [key: string]: string }>({});
  const [employeeMap, setEmployeeMap] = useState<{ [key: string]: string }>({});
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const navigate = useNavigate();

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

  const performSearch = async (query: string) => {
    const trimmed = query.trim();
    
    console.log('🔍 [EditContractsReport] performSearch called:', {
      query: trimmed,
      dateFrom,
      dateTo,
      hasDateFilter: !!(dateFrom || dateTo)
    });
    
    setIsSearching(true);

    try {
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
      const legacyLeadConditions: string[] = [];

      const searchVariants = generateSearchVariants(trimmed);

      // Only add search conditions if there's a query
      if (trimmed.length >= 2) {
        // Always search name
        searchVariants.forEach(variant => {
          newLeadConditions.push(`name.ilike.%${variant}%`);
          legacyLeadConditions.push(`name.ilike.%${variant}%`);
        });

        // Email search
        if (isEmail || trimmed.length >= 3) {
          searchVariants.forEach(variant => {
            newLeadConditions.push(`email.ilike.%${variant}%`);
            legacyLeadConditions.push(`email.ilike.%${variant}%`);
          });
        }

        // Phone number search
        if (isPhone && digits.length >= 3) {
          newLeadConditions.push(`phone.ilike.%${digits}%`);
          newLeadConditions.push(`mobile.ilike.%${digits}%`);
          legacyLeadConditions.push(`phone.ilike.%${digits}%`);
          legacyLeadConditions.push(`mobile.ilike.%${digits}%`);
        } else if (isLeadNumber) {
          // Lead number search
          newLeadConditions.push(`lead_number.ilike.%${trimmed}%`);
          newLeadConditions.push(`lead_number.ilike.L%${trimmed}%`);
          newLeadConditions.push(`lead_number.ilike.C%${trimmed}%`);
          
          if (isNumericQuery && digits.length <= 6 && !startsWithZero) {
            const numId = parseInt(noPrefix, 10);
            if (!isNaN(numId) && numId > 0) {
              legacyLeadConditions.push(`id.eq.${numId}`);
            }
          }
        }
      }

      const results: any[] = [];

      // Search new leads (stage 60 and above)
      // If no search query, fetch all leads (when date filtering only)
      if (newLeadConditions.length > 0 || trimmed.length === 0) {
        let newLeadsQuery = supabase
          .from('leads')
          .select('id, lead_number, name, email, phone, mobile, topic, stage, created_at, closer_id')
          .gt('stage', 60);
        
        if (newLeadConditions.length > 0) {
          newLeadsQuery = newLeadsQuery.or(newLeadConditions.join(','));
        }
        
        const { data: newLeads, error: newError } = await newLeadsQuery.limit(50);

        if (newError) {
          console.error('Error fetching new leads:', newError);
        }

        if (newLeads) {
          for (const lead of newLeads) {
            // Fetch the signed agreement date and creator_id from leads_leadstage
            const { data: stageData } = await supabase
              .from('leads_leadstage')
              .select('date, creator_id')
              .eq('newlead_id', lead.id)
              .eq('stage', 60)
              .order('date', { ascending: false })
              .limit(1)
              .single();

            // Only add leads that have a signed date
            if (stageData?.date) {
              // Apply date filter if set
              const signedDate = new Date(stageData.date);
              if (dateFrom && signedDate < new Date(dateFrom)) continue;
              if (dateTo && signedDate > new Date(dateTo)) continue;

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
                signed_date: stageData.date,
                creator_id: stageData.creator_id || null,
                closer: lead.closer_id || null,
              });
            }
          }
        }
      }

      // Search legacy leads (stage 60 and above)
      // If no search query, fetch all leads (when date filtering only)
      if (legacyLeadConditions.length > 0 || trimmed.length === 0) {
        let legacyLeadsQuery = supabase
          .from('leads_lead')
          .select('id, lead_number, name, email, phone, mobile, topic, stage, cdate, closer_id')
          .gt('stage', 60);
        
        if (legacyLeadConditions.length > 0) {
          legacyLeadsQuery = legacyLeadsQuery.or(legacyLeadConditions.join(','));
        }
        
        const { data: legacyLeads, error: legacyError } = await legacyLeadsQuery.limit(20);

        if (legacyError) {
          console.error('Error fetching legacy leads:', legacyError);
        }

        if (legacyLeads) {
          for (const lead of legacyLeads) {
            const leadNumber = lead.lead_number ? String(lead.lead_number) : String(lead.id);
            
            // Fetch the signed agreement date and creator_id from leads_leadstage
            const { data: stageData } = await supabase
              .from('leads_leadstage')
              .select('date, creator_id')
              .eq('lead_id', lead.id)
              .eq('stage', 60)
              .order('date', { ascending: false })
              .limit(1)
              .single();

            // Only add leads that have a signed date
            if (stageData?.date) {
              // Apply date filter if set
              const signedDate = new Date(stageData.date);
              if (dateFrom && signedDate < new Date(dateFrom)) continue;
              if (dateTo && signedDate > new Date(dateTo)) continue;

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
                signed_date: stageData.date,
                legacy_id: lead.id,
                creator_id: stageData.creator_id || null,
                closer: lead.closer_id || null,
              });
            }
          }
        }
      }

      console.log('✅ [EditContractsReport] Search completed:', {
        resultsCount: results.length,
        newLeads: results.filter(r => r.lead_type === 'new').length,
        legacyLeads: results.filter(r => r.lead_type === 'legacy').length
      });

      setSearchResults(results);
    } catch (error) {
      console.error('❌ [EditContractsReport] Error performing search:', error);
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
    console.log('🔍 [EditContractsReport] handleSaveSignedDate called:', {
      lead: lead ? { id: lead.id, lead_type: lead.lead_type, legacy_id: lead.legacy_id } : null,
      newDate,
      dateFrom,
      dateTo
    });

    if (!lead || !newDate) {
      console.warn('⚠️ [EditContractsReport] Missing lead or newDate:', { lead: !!lead, newDate: !!newDate });
      return;
    }

    try {
      const isLegacy = lead.lead_type === 'legacy';
      const leadId = isLegacy ? lead.legacy_id : lead.id;

      console.log('🔍 [EditContractsReport] Lead details:', {
        isLegacy,
        leadId,
        originalId: lead.id
      });

      // Check if the new date still matches the date filter criteria
      const signedDate = new Date(newDate);
      const fromDate = dateFrom ? new Date(dateFrom) : null;
      const toDate = dateTo ? new Date(dateTo) : null;

      console.log('🔍 [EditContractsReport] Date validation:', {
        signedDate: signedDate.toISOString(),
        fromDate: fromDate?.toISOString() || null,
        toDate: toDate?.toISOString() || null,
        isBeforeFrom: fromDate ? signedDate < fromDate : false,
        isAfterTo: toDate ? signedDate > toDate : false
      });

      if (fromDate && signedDate < fromDate) {
        console.log('⚠️ [EditContractsReport] New date is before dateFrom, removing lead from results');
        // New date is before the "from" date - remove from results
        setSearchResults(prevResults =>
          prevResults.filter(l => l.id !== lead.id)
        );
        alert('Signed date updated successfully! However, this lead no longer matches the date filter and has been removed from the results.');
        return;
      }
      if (toDate && signedDate > toDate) {
        console.log('⚠️ [EditContractsReport] New date is after dateTo, removing lead from results');
        // New date is after the "to" date - remove from results
        setSearchResults(prevResults =>
          prevResults.filter(l => l.id !== lead.id)
        );
        alert('Signed date updated successfully! However, this lead no longer matches the date filter and has been removed from the results.');
        return;
      }

      // Update the leads_leadstage record
      const updateQuery = supabase
        .from('leads_leadstage')
        .update({ date: newDate })
        .eq(isLegacy ? 'lead_id' : 'newlead_id', leadId)
        .eq('stage', 60);

      console.log('🔍 [EditContractsReport] Updating leads_leadstage:', {
        table: 'leads_leadstage',
        updateField: 'date',
        newDate,
        filterField: isLegacy ? 'lead_id' : 'newlead_id',
        filterValue: leadId,
        stage: 60
      });

      const { data: updateData, error: updateError } = await updateQuery;

      if (updateError) {
        console.error('❌ [EditContractsReport] Error updating signed date:', updateError);
        alert('Failed to update signed date. Please try again.');
        return;
      }

      console.log('✅ [EditContractsReport] Update successful:', {
        updateData: updateData ? (Array.isArray(updateData) ? updateData.length : 1) : 0
      });

      // Update the local state only if the date still matches the filter
      setSearchResults(prevResults => {
        const updated = prevResults.map(l =>
          l.id === lead.id
            ? { ...l, signed_date: newDate }
            : l
        );
        console.log('✅ [EditContractsReport] Updated local state, results count:', updated.length);
        return updated;
      });

      alert('Signed date updated successfully!');
    } catch (error) {
      console.error('❌ [EditContractsReport] Exception saving signed date:', error);
      alert('An error occurred while saving. Please try again.');
    }
  };

  const handleNavigateToLead = (lead: any) => {
    const isLegacy = lead.lead_type === 'legacy';
    const leadId = isLegacy ? lead.legacy_id : lead.id;
    navigate(`/clients/${leadId}`);
  };

  return (
    <div className="p-6">
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
  );
};

export default EditContractsReport;

