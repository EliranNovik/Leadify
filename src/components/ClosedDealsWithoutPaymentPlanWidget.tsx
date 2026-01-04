import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  formatCategoryDisplayName,
  getCurrencySymbol,
} from '../lib/waitingForPriceOffer';
import { DocumentTextIcon, ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';

interface Props {
  maxItems?: number;
  className?: string;
}

interface ClosedDealRow {
  id: string;
  lead_number: string;
  client_name: string;
  category: string;
  topic: string;
  closer: string;
  signed_date: string | null;
  lead_type: 'new' | 'legacy';
  applicants: number | null;
  value: string | null;
}

const ClosedDealsWithoutPaymentPlanWidget: React.FC<Props> = ({ maxItems = 6, className }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [leads, setLeads] = useState<ClosedDealRow[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  const [userEmployeeId, setUserEmployeeId] = useState<number | null>(null);
  const [userDisplayName, setUserDisplayName] = useState<string | null>(null);
  const [allCategories, setAllCategories] = useState<any[]>([]);
  const [employeeNameMap, setEmployeeNameMap] = useState<Map<string | number, string>>(new Map());
  const [currencyMap, setCurrencyMap] = useState<Map<number, string>>(new Map());

  // Fetch user info
  useEffect(() => {
    const fetchUserData = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data: userData } = await supabase
          .from('users')
          .select(`
            employee_id,
            tenants_employee!employee_id(
              id,
              display_name
            )
          `)
          .eq('auth_id', user.id)
          .single();

        if (userData) {
          if (userData.employee_id) setUserEmployeeId(userData.employee_id);
          const displayName = (userData.tenants_employee as any)?.display_name;
          if (displayName) setUserDisplayName(displayName);
        }
      } catch (err) {
        console.error('Error fetching user data:', err);
      }
    };

    fetchUserData();
  }, []);

  // Fetch categories
  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const { data, error } = await supabase
          .from('misc_category')
          .select(`
            id,
            name,
            parent_id,
            misc_maincategory!parent_id(
              id,
              name
            )
          `);
        if (error) throw error;
        setAllCategories(data || []);
      } catch (err) {
        console.error('Error fetching categories:', err);
      }
    };

    fetchCategories();
  }, []);

  // Fetch employees
  useEffect(() => {
    const fetchEmployees = async () => {
      try {
        const { data, error } = await supabase
          .from('tenants_employee')
          .select('id, display_name');
        if (error) throw error;
        const map = new Map<string | number, string>();
        data?.forEach(emp => {
          map.set(emp.id, emp.display_name);
        });
        setEmployeeNameMap(map);
      } catch (err) {
        console.error('Error fetching employees:', err);
      }
    };

    fetchEmployees();
  }, []);

  // Fetch currencies
  useEffect(() => {
    const fetchCurrencies = async () => {
      try {
        const [currenciesResult, accountingCurrenciesResult] = await Promise.all([
          supabase.from('currencies').select('id, name, iso_code, front_name'),
          supabase.from('accounting_currencies').select('id, name, iso_code'),
        ]);

        let currencyData: any[] = [];
        if (!currenciesResult.error && currenciesResult.data?.length) {
          currencyData = currenciesResult.data;
        } else if (!accountingCurrenciesResult.error && accountingCurrenciesResult.data?.length) {
          currencyData = accountingCurrenciesResult.data;
        }

        const map = new Map<number, string>();
        currencyData.forEach((curr: any) => {
          const symbol = curr.front_name || curr.name || curr.iso_code || '₪';
          const id = typeof curr.id === 'string' ? parseInt(curr.id, 10) || curr.id : curr.id;
          map.set(id, symbol);
        });

        if (map.size === 0) {
          map.set(1, '₪');
          map.set(2, '$');
          map.set(3, '€');
          map.set(4, '£');
        }

        setCurrencyMap(map);
      } catch (err) {
        console.error('Error fetching currencies:', err);
        const fallback = new Map<number, string>();
        fallback.set(1, '₪');
        fallback.set(2, '$');
        fallback.set(3, '€');
        fallback.set(4, '£');
        setCurrencyMap(fallback);
      }
    };

    fetchCurrencies();
  }, []);

  // Fetch closed deals without payment plans
  useEffect(() => {
    const shouldFetch =
      !!userDisplayName &&
      (userEmployeeId !== null || userDisplayName !== null) &&
      allCategories.length > 0 &&
      employeeNameMap.size > 0 &&
      currencyMap.size > 0;

    if (!shouldFetch) return;

    const fetchLeads = async () => {
      setLoading(true);
      setError(null);
      try {
        console.log('[ClosedDealsWithoutPaymentPlan] Starting fetch...', {
          userEmployeeId,
          userDisplayName,
          allCategoriesCount: allCategories.length,
          employeeMapSize: employeeNameMap.size,
          currencyMapSize: currencyMap.size
        });

        // Fetch new leads with stage 60 or higher (passed signed agreement stage)
        // For new leads, closer can be either a string (name) or closer_id (number)
        console.log('[ClosedDealsWithoutPaymentPlan] Fetching new leads with stage >= 60...');
        const { data: newLeadsData, error: newLeadsError } = await supabase
          .from('leads')
          .select(`
            id,
            lead_number,
            name,
            category_id,
            category,
            topic,
            closer,
            closer_id,
            stage,
            balance,
            balance_currency,
            created_at,
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
          .gte('stage', 60)
          .limit(500);

        if (newLeadsError) {
          console.error('[ClosedDealsWithoutPaymentPlan] Error fetching new leads:', newLeadsError);
          throw newLeadsError;
        }
        
        console.log('[ClosedDealsWithoutPaymentPlan] New leads fetched:', newLeadsData?.length || 0);

        // Fetch all payment plans for new leads to check which ones don't have payment plans
        const leadIds = (newLeadsData || []).map((lead: any) => lead.id).filter(Boolean);
        console.log('[ClosedDealsWithoutPaymentPlan] Checking payment plans for', leadIds.length, 'new leads');
        let paymentPlanLeadIds = new Set<string>();
        
        if (leadIds.length > 0) {
          const { data: paymentPlansData, error: paymentPlansError } = await supabase
            .from('payment_plans')
            .select('lead_id')
            .in('lead_id', leadIds)
            .is('cancel_date', null);
          
          if (paymentPlansError) {
            console.error('[ClosedDealsWithoutPaymentPlan] Error fetching payment plans:', paymentPlansError);
          } else {
            console.log('[ClosedDealsWithoutPaymentPlan] Payment plans found:', paymentPlansData?.length || 0);
            if (paymentPlansData) {
              paymentPlanLeadIds = new Set(paymentPlansData.map((plan: any) => plan.lead_id?.toString()).filter(Boolean));
            }
          }
        }

        const closedDeals: ClosedDealRow[] = [];

        let newLeadsProcessed = 0;
        let newLeadsMatchedCloser = 0;
        let newLeadsWithoutPaymentPlan = 0;

        newLeadsData?.forEach((lead: any) => {
          newLeadsProcessed++;
          // Check if user is the closer
          // For new leads, closer can be a string (name) or closer_id (number)
          const isCloserById = userEmployeeId && lead.closer_id && String(lead.closer_id) === String(userEmployeeId);
          const isCloserByName = userDisplayName && lead.closer && 
            typeof lead.closer === 'string' && lead.closer.trim() === userDisplayName.trim();
          const isCloser = isCloserById || isCloserByName;
          
          if (!isCloser) {
            return;
          }
          
          newLeadsMatchedCloser++;

          // Check if lead has payment plans
          const leadIdStr = lead.id?.toString();
          if (leadIdStr && paymentPlanLeadIds.has(leadIdStr)) {
            return; // Skip leads that have payment plans
          }
          
          newLeadsWithoutPaymentPlan++;

          // Find signed date from leads_leadstage table
          // We'll fetch this separately or use created_at as fallback
          const balance = lead.balance ? parseFloat(String(lead.balance)) : null;
          const currency = getCurrencySymbol(currencyMap, null, lead.balance_currency);
          const valueStr = balance !== null && !isNaN(balance) ? `${balance.toLocaleString()} ${currency}` : null;

          // Get closer name - can be from closer field (string) or closer_id (number)
          const closerName = typeof lead.closer === 'string' && lead.closer.trim()
            ? lead.closer.trim()
            : lead.tenants_employee?.display_name || 
              (lead.closer_id ? employeeNameMap.get(lead.closer_id) || 'Unknown' : 'Unassigned');

          closedDeals.push({
            id: lead.id,
            lead_number: lead.lead_number || '',
            client_name: lead.name || '',
            category: formatCategoryDisplayName(allCategories, lead.category_id, lead.category),
            topic: lead.topic || 'Not specified',
            closer: closerName,
            signed_date: lead.created_at, // Will update with actual signed date from leads_leadstage
            lead_type: 'new',
            applicants: null,
            value: valueStr,
          });
        });

        console.log('[ClosedDealsWithoutPaymentPlan] New leads summary:', {
          total: newLeadsProcessed,
          matchedCloser: newLeadsMatchedCloser,
          withoutPaymentPlan: newLeadsWithoutPaymentPlan,
          closedDealsSoFar: closedDeals.length
        });

        // Fetch legacy leads with stage 60 or higher (passed signed agreement stage)
        console.log('[ClosedDealsWithoutPaymentPlan] Fetching legacy leads with stage >= 60...');
        const { data: legacyData, error: legacyError } = await supabase
          .from('leads_lead')
          .select(`
            id,
            name,
            category_id,
            category,
            topic,
            closer_id,
            stage,
            no_of_applicants,
            total,
            currency_id,
            cdate,
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
          .gte('stage', 60)
          .neq('status', 10)
          .limit(500);

        if (legacyError) {
          console.error('[ClosedDealsWithoutPaymentPlan] Error fetching legacy leads:', legacyError);
          throw legacyError;
        }
        
        console.log('[ClosedDealsWithoutPaymentPlan] Legacy leads fetched:', legacyData?.length || 0);

        // Fetch all payment plans for legacy leads
        const legacyLeadIds = (legacyData || []).map((lead: any) => lead.id).filter(Boolean);
        // Convert to strings for querying (lead_id in finances_paymentplanrow is text/varchar)
        const legacyLeadIdsAsStrings = legacyLeadIds.map(id => String(id));
        console.log('[ClosedDealsWithoutPaymentPlan] Checking payment plans for', legacyLeadIds.length, 'legacy leads');
        let legacyPaymentPlanLeadIds = new Set<string>();
        
        if (legacyLeadIdsAsStrings.length > 0) {
          const { data: legacyPaymentPlansData, error: legacyPaymentPlansError } = await supabase
            .from('finances_paymentplanrow')
            .select('lead_id')
            .in('lead_id', legacyLeadIdsAsStrings)
            .is('cancel_date', null);
          
          if (legacyPaymentPlansError) {
            console.error('[ClosedDealsWithoutPaymentPlan] Error fetching legacy payment plans:', legacyPaymentPlansError);
          } else {
            console.log('[ClosedDealsWithoutPaymentPlan] Legacy payment plans found:', legacyPaymentPlansData?.length || 0);
            if (legacyPaymentPlansData) {
              // Convert lead_id to string and add to Set (handle both string and number types)
              legacyPaymentPlansData.forEach((plan: any) => {
                if (plan.lead_id != null) {
                  legacyPaymentPlanLeadIds.add(String(plan.lead_id));
                  // Also add numeric version for safety (in case lead.id is compared as number)
                  const numericId = Number(plan.lead_id);
                  if (!isNaN(numericId)) {
                    legacyPaymentPlanLeadIds.add(numericId.toString());
                  }
                }
              });
            }
          }
        }

        let legacyLeadsProcessed = 0;
        let legacyLeadsMatchedCloser = 0;
        let legacyLeadsWithoutPaymentPlan = 0;

        legacyData?.forEach((lead: any) => {
          legacyLeadsProcessed++;
          // Check if user is the closer
          const isCloser = userEmployeeId && lead.closer_id && String(lead.closer_id) === String(userEmployeeId);
          if (!isCloser) {
            return;
          }
          
          legacyLeadsMatchedCloser++;

          // Check if lead has payment plans (convert lead.id to string for comparison)
          const leadIdStr = String(lead.id);
          if (legacyPaymentPlanLeadIds.has(leadIdStr)) {
            return; // Skip leads that have payment plans
          }
          
          legacyLeadsWithoutPaymentPlan++;

          const total = lead.total ? parseFloat(String(lead.total)) : null;
          const currency = getCurrencySymbol(currencyMap, lead.currency_id);
          const valueStr = total !== null && !isNaN(total) ? `${total.toLocaleString()} ${currency}` : null;

          const closerName = lead.closer_id
            ? (employeeNameMap.get(lead.closer_id) || 'Unknown')
            : 'Unassigned';

          closedDeals.push({
            id: `legacy_${lead.id}`,
            lead_number: lead.id?.toString() || '',
            client_name: lead.name || '',
            category: formatCategoryDisplayName(allCategories, lead.category_id, lead.category),
            topic: lead.topic || 'Not specified',
            closer: closerName,
            signed_date: lead.cdate, // Will update with actual signed date from leads_leadstage
            lead_type: 'legacy',
            applicants: lead.no_of_applicants || null,
            value: valueStr,
          });
        });

        console.log('[ClosedDealsWithoutPaymentPlan] Legacy leads summary:', {
          total: legacyLeadsProcessed,
          matchedCloser: legacyLeadsMatchedCloser,
          withoutPaymentPlan: legacyLeadsWithoutPaymentPlan,
          closedDealsSoFar: closedDeals.length
        });

        // Fetch actual signed dates from leads_leadstage for stage 60
        console.log('[ClosedDealsWithoutPaymentPlan] Fetching signed dates from leads_leadstage...');
        const allLeadIds = closedDeals.map(deal => {
          if (deal.lead_type === 'legacy') {
            return parseInt(deal.lead_number, 10);
          }
          return null;
        }).filter((id): id is number => id !== null);

        const newLeadIds = closedDeals
          .filter(deal => deal.lead_type === 'new')
          .map(deal => deal.id)
          .filter(Boolean);

        // Fetch signed dates for new leads (use newlead_id for new leads)
        if (newLeadIds.length > 0) {
          const { data: newStageData } = await supabase
            .from('leads_leadstage')
            .select('newlead_id, cdate, date')
            .eq('stage', 60)
            .not('newlead_id', 'is', null)
            .in('newlead_id', newLeadIds)
            .order('cdate', { ascending: false });

          if (newStageData) {
            const signedDateMap = new Map<string, string>();
            newStageData.forEach((stage: any) => {
              const leadId = stage.newlead_id?.toString();
              if (leadId && !signedDateMap.has(leadId)) {
                signedDateMap.set(leadId, stage.date || stage.cdate);
              }
            });

            closedDeals.forEach(deal => {
              if (deal.lead_type === 'new') {
                const signedDate = signedDateMap.get(deal.id);
                if (signedDate) {
                  deal.signed_date = signedDate;
                }
              }
            });
          }
        }

        // Fetch signed dates for legacy leads (use lead_id for legacy leads)
        if (allLeadIds.length > 0) {
          const { data: legacyStageData } = await supabase
            .from('leads_leadstage')
            .select('lead_id, cdate, date')
            .eq('stage', 60)
            .not('lead_id', 'is', null)
            .in('lead_id', allLeadIds)
            .order('cdate', { ascending: false });

          if (legacyStageData) {
            const signedDateMap = new Map<number, string>();
            legacyStageData.forEach((stage: any) => {
              const leadId = stage.lead_id;
              if (leadId && !signedDateMap.has(leadId)) {
                signedDateMap.set(leadId, stage.date || stage.cdate);
              }
            });

            closedDeals.forEach(deal => {
              if (deal.lead_type === 'legacy') {
                const leadIdNum = parseInt(deal.lead_number, 10);
                if (!isNaN(leadIdNum)) {
                  const signedDate = signedDateMap.get(leadIdNum);
                  if (signedDate) {
                    deal.signed_date = signedDate;
                  }
                }
              }
            });
          }
        }

        // Sort by signed date (most recent first)
        closedDeals.sort((a, b) => {
          const dateA = a.signed_date ? new Date(a.signed_date).getTime() : 0;
          const dateB = b.signed_date ? new Date(b.signed_date).getTime() : 0;
          return dateB - dateA;
        });

        console.log('[ClosedDealsWithoutPaymentPlan] Final closed deals count:', closedDeals.length);
        console.log('[ClosedDealsWithoutPaymentPlan] Sample closed deal:', closedDeals[0] || 'none');

        setLeads(closedDeals);
      } catch (err) {
        console.error('[ClosedDealsWithoutPaymentPlan] Error fetching closed deals:', err);
        console.error('[ClosedDealsWithoutPaymentPlan] Error details:', {
          message: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
          error: err
        });
        setError('Failed to load closed deals');
      } finally {
        setLoading(false);
      }
    };

    fetchLeads();
  }, [
    userEmployeeId,
    userDisplayName,
    allCategories,
    employeeNameMap,
    currencyMap,
  ]);

  const filteredLeads = useMemo(() => {
    if (!searchTerm.trim()) return leads;
    const lower = searchTerm.toLowerCase();
    return leads.filter((lead) =>
      lead.lead_number.toLowerCase().includes(lower) ||
      lead.client_name.toLowerCase().includes(lower) ||
      lead.category.toLowerCase().includes(lower) ||
      (lead.topic || '').toLowerCase().includes(lower)
    );
  }, [leads, searchTerm]);

  const topLeads = useMemo(() => filteredLeads.slice(0, maxItems), [filteredLeads, maxItems]);

  const formatDate = (date: string | null) => {
    if (!date) return 'Not set';
    try {
      return new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch {
      return 'Invalid date';
    }
  };

  const handleRowClick = (lead: ClosedDealRow) => {
    navigate(`/clients/${lead.lead_number}`);
  };

  return (
    <div className={`bg-white rounded-2xl shadow-lg border border-gray-200 ${className || ''}`}>
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 px-6 py-4 border-b border-gray-200">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-tr from-purple-500 to-blue-600 rounded-lg flex items-center justify-center">
            <DocumentTextIcon className="w-6 h-6 text-white" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-gray-900">Closed deals without Payments plan</h3>
            <p className="text-sm text-gray-500">Signed agreements where you are the closer, missing payment plans</p>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 w-full lg:w-auto">
          <div className="w-full sm:w-64">
            <input
              type="text"
              className="input input-bordered w-full"
              placeholder="Search leads..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-10 gap-3 text-gray-500">
          <span className="loading loading-spinner loading-lg text-purple-600" />
          <p>Loading closed deals...</p>
        </div>
      ) : error ? (
        <div className="text-center py-10 text-red-500">{error}</div>
      ) : topLeads.length === 0 ? (
        <div className="text-center py-10 text-gray-500">
          You have no closed deals without payment plans.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="table w-full">
            <thead className="bg-white border-b border-gray-200">
              <tr>
                <th className="text-gray-700 font-medium">Lead</th>
                <th className="text-gray-700 font-medium">Category</th>
                <th className="text-gray-700 font-medium">Topic</th>
                <th className="text-gray-700 font-medium">Signed Date</th>
                <th className="text-gray-700 font-medium">Value</th>
              </tr>
            </thead>
            <tbody>
              {topLeads.map((lead) => (
                <tr
                  key={lead.id}
                  className="hover:bg-gray-50 cursor-pointer transition-colors"
                  onClick={() => handleRowClick(lead)}
                >
                  <td>
                    <div className="flex flex-col">
                      <span className="font-semibold text-gray-900">{lead.client_name || 'No name'}</span>
                      <span className="text-sm text-gray-500">#{lead.lead_number}</span>
                    </div>
                  </td>
                  <td>{lead.category}</td>
                  <td>{lead.topic}</td>
                  <td>{formatDate(lead.signed_date)}</td>
                  <td className="font-semibold">{lead.value || '---'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredLeads.length > maxItems && (
            <div className="px-6 py-4 text-sm text-gray-500">
              Showing {topLeads.length} of {filteredLeads.length} filtered leads
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ClosedDealsWithoutPaymentPlanWidget;

