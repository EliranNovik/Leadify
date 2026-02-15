import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/solid';
import { supabase } from '../../lib/supabase';

const EditContractsReport = () => {
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

  // Helper function to get display lead number (same logic as Clients.tsx)
  // Simplified version that handles C prefix and existing suffixes
  // For master leads with /1, we'll compute that when processing results
  const getDisplayLeadNumber = (lead: any, hasSubLeads: boolean = false): string => {
    if (!lead) return '---';
    let displayNumber = lead.lead_number || lead.manual_id || lead.id || '---';

    // Remove any existing / suffix for processing (we'll add /1 if needed)
    const displayStr = displayNumber.toString();
    const hasExistingSuffix = displayStr.includes('/');

    // For master leads, we want to show /1, so strip any existing suffix first
    let baseNumber = hasExistingSuffix ? displayStr.split('/')[0] : displayStr;

    const isSuccessStage = lead.stage === '100' || lead.stage === 100;
    // Show "C" prefix in UI for both new and legacy leads when stage is Success (100)
    if (isSuccessStage && baseNumber && !baseNumber.toString().startsWith('C')) {
      // Replace "L" prefix with "C" for display only
      baseNumber = baseNumber.toString().replace(/^L/, 'C');
    }

    // Add /1 suffix to master leads (frontend only)
    // A lead is a master if: it has no master_id AND it has subleads
    const hasNoMasterId = !lead.master_id || String(lead.master_id).trim() === '';
    const isMasterWithSubLeads = hasNoMasterId && hasSubLeads;

    // Only add /1 to master leads that actually have subleads
    if (isMasterWithSubLeads && !hasExistingSuffix) {
      displayNumber = `${baseNumber}/1`;
    } else if (hasExistingSuffix) {
      // Keep existing suffix for subleads
      displayNumber = displayStr;
    } else {
      displayNumber = baseNumber;
    }

    return displayNumber.toString();
  };

  const performSearch = async () => {
    console.log('🔍 [EditContractsReport] performSearch called:', {
      dateFrom,
      dateTo,
      hasDateFilter: !!(dateFrom || dateTo)
    });

    setIsSearching(true);

    try {
      const results: any[] = [];

      // Fetch all new leads (stage 60 and above)
      {
        const { data: newLeads, error: newError } = await supabase
          .from('leads')
          .select('id, lead_number, name, email, phone, mobile, topic, stage, created_at, closer_id, master_id')
          .gt('stage', 60)
          .limit(50);

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
                master_id: lead.master_id || null,
              });
            }
          }
        }
      }

      // Fetch all legacy leads (stage 60 and above)
      {
        const { data: legacyLeads, error: legacyError } = await supabase
          .from('leads_lead')
          .select('id, lead_number, name, email, phone, mobile, topic, stage, cdate, closer_id, master_id')
          .gt('stage', 60)
          .limit(20);

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
                master_id: lead.master_id || null,
              });
            }
          }
        }
      }

      // Compute display lead numbers for all results
      const resultsWithDisplayNumbers = await Promise.all(
        results.map(async (lead) => {
          const hasNoMasterId = !lead.master_id || String(lead.master_id).trim() === '';
          let hasSubLeads = false;

          // Check if this lead has subleads (only for master leads)
          if (hasNoMasterId) {
            try {
              if (lead.lead_type === 'legacy') {
                const legacyId = lead.legacy_id || lead.id;
                const { data: subLeads } = await supabase
                  .from('leads_lead')
                  .select('id')
                  .eq('master_id', legacyId)
                  .not('master_id', 'is', null);
                hasSubLeads = (subLeads?.length || 0) > 0;
              } else {
                const { data: subLeads } = await supabase
                  .from('leads')
                  .select('id')
                  .eq('master_id', lead.id)
                  .not('master_id', 'is', null);
                hasSubLeads = (subLeads?.length || 0) > 0;
              }
            } catch (error) {
              console.error('Error fetching subleads:', error);
            }
          }

          return {
            ...lead,
            display_lead_number: getDisplayLeadNumber(lead, hasSubLeads)
          };
        })
      );

      console.log('✅ [EditContractsReport] Search completed:', {
        resultsCount: resultsWithDisplayNumbers.length,
        newLeads: resultsWithDisplayNumbers.filter(r => r.lead_type === 'new').length,
        legacyLeads: resultsWithDisplayNumbers.filter(r => r.lead_type === 'legacy').length
      });

      setSearchResults(resultsWithDisplayNumbers);
    } catch (error) {
      console.error('❌ [EditContractsReport] Error performing search:', error);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleManualSearch = () => {
    performSearch();
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

      {!isSearching && searchResults.length === 0 && (dateFrom || dateTo) && (
        <div className="text-center py-12">
          <p className="text-gray-500 text-lg">
            No leads found with stage 60 or above and a signed date matching the selected date range.
          </p>
        </div>
      )}

    </div>
  );
};

export default EditContractsReport;

