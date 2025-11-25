import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { fetchStageNames, areStagesEquivalent } from '../lib/stageUtils';
import {
  formatCategoryDisplayName,
  getCurrencySymbol,
  WAITING_STAGE_TARGET,
  WaitingLeadRow,
} from '../lib/waitingForPriceOffer';
import { DocumentTextIcon, ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';

interface Props {
  maxItems?: number;
  className?: string;
}

const WaitingForPriceOfferMyLeadsWidget: React.FC<Props> = ({ maxItems = 6, className }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [leads, setLeads] = useState<WaitingLeadRow[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  const [userEmployeeId, setUserEmployeeId] = useState<number | null>(null);
  const [userDisplayName, setUserDisplayName] = useState<string | null>(null);
  const [allCategories, setAllCategories] = useState<any[]>([]);
  const [employeeNameMap, setEmployeeNameMap] = useState<Map<string | number, string>>(new Map());
  const [currencyMap, setCurrencyMap] = useState<Map<number, string>>(new Map());
  const [waitingStageIds, setWaitingStageIds] = useState<number[]>([]);

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

  // Resolve waiting stage IDs
  useEffect(() => {
    const resolveWaitingStageIds = async () => {
      try {
        const stageMap = await fetchStageNames();
        const matchedIds = Object.entries(stageMap)
          .filter(([, name]) => areStagesEquivalent(name, WAITING_STAGE_TARGET))
          .map(([id]) => Number(id))
          .filter(id => !Number.isNaN(id));
        if (matchedIds.length > 0) {
          setWaitingStageIds(Array.from(new Set(matchedIds)));
        } else {
          setWaitingStageIds([40]);
        }
      } catch (err) {
        console.error('Error resolving stage IDs:', err);
        setWaitingStageIds([40]);
      }
    };

    resolveWaitingStageIds();
  }, []);

  // Fetch leads relevant to user
  useEffect(() => {
    const shouldFetch =
      !!userDisplayName &&
      (userEmployeeId !== null || userDisplayName !== null) &&
      allCategories.length > 0 &&
      employeeNameMap.size > 0 &&
      currencyMap.size > 0 &&
      waitingStageIds.length > 0;

    if (!shouldFetch) return;

    const fetchLeads = async () => {
      setLoading(true);
      setError(null);
      try {
        const stageIdsToUse = waitingStageIds.length > 0 ? waitingStageIds : [40];
        let newLeadsQuery = supabase
          .from('leads')
          .select(`
            id,
            lead_number,
            name,
            category_id,
            category,
            topic,
            manager,
            helper,
            stage,
            balance,
            balance_currency,
            meetings!client_id(
              meeting_date
            ),
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
          .limit(500);

        if (stageIdsToUse.length === 1) {
          newLeadsQuery = newLeadsQuery.eq('stage', stageIdsToUse[0]);
        } else {
          newLeadsQuery = newLeadsQuery.in('stage', stageIdsToUse);
        }

        const { data: newLeadsData, error: newLeadsError } = await newLeadsQuery;
        if (newLeadsError) throw newLeadsError;

        const assigned: WaitingLeadRow[] = [];

        const isNameMatch = (value: string | null | undefined) =>
          value && userDisplayName && value.trim() === userDisplayName.trim();

        newLeadsData?.forEach((lead: any) => {
          const isManager =
            isNameMatch(typeof lead.manager === 'string' ? lead.manager : employeeNameMap.get(lead.manager)) ||
            (lead.manager && String(lead.manager) === String(userEmployeeId));
          const isHelper =
            isNameMatch(typeof lead.helper === 'string' ? lead.helper : employeeNameMap.get(lead.helper)) ||
            (lead.helper && String(lead.helper) === String(userEmployeeId));

          if (!isManager && !isHelper) return;

          let meetingDate = null;
          if (lead.meetings && Array.isArray(lead.meetings) && lead.meetings.length > 0) {
            const sortedMeetings = [...lead.meetings].sort((a: any, b: any) => {
              const dateA = a.meeting_date ? new Date(a.meeting_date).getTime() : 0;
              const dateB = b.meeting_date ? new Date(b.meeting_date).getTime() : 0;
              return dateB - dateA;
            });
            meetingDate = sortedMeetings[0].meeting_date;
          }

          const balance = lead.balance ? parseFloat(String(lead.balance)) : null;
          const currency = getCurrencySymbol(currencyMap, null, lead.balance_currency);
          const valueStr = balance !== null && !isNaN(balance) ? `${balance.toLocaleString()} ${currency}` : null;

          assigned.push({
            id: lead.id,
            lead_number: lead.lead_number || '',
            client_name: lead.name || '',
            category: formatCategoryDisplayName(allCategories, lead.category_id, lead.category),
            topic: lead.topic || 'Not specified',
            manager: typeof lead.manager === 'string'
              ? lead.manager
              : (lead.manager ? employeeNameMap.get(lead.manager) || 'Unknown' : 'Unassigned'),
            helper: typeof lead.helper === 'string'
              ? lead.helper
              : (lead.helper ? employeeNameMap.get(lead.helper) || 'Unknown' : 'Unassigned'),
            meeting_date: meetingDate,
            lead_type: 'new',
            applicants: null,
            value: valueStr,
          });
        });

        const { data: legacyData, error: legacyError } = await supabase
          .from('leads_lead')
          .select(`
            id,
            name,
            category_id,
            category,
            topic,
            meeting_manager_id,
            meeting_lawyer_id,
            stage,
            meeting_date,
            no_of_applicants,
            total,
            currency_id,
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
          .eq('stage', 40)
          .neq('status', 10);

        if (legacyError) throw legacyError;

        legacyData?.forEach((lead: any) => {
          const isManager = userEmployeeId && lead.meeting_manager_id && String(lead.meeting_manager_id) === String(userEmployeeId);
          const isHelper = userEmployeeId && lead.meeting_lawyer_id && String(lead.meeting_lawyer_id) === String(userEmployeeId);
          if (!isManager && !isHelper) return;

          const total = lead.total ? parseFloat(String(lead.total)) : null;
          const currency = getCurrencySymbol(currencyMap, lead.currency_id);
          const valueStr = total !== null && !isNaN(total) ? `${total.toLocaleString()} ${currency}` : null;

          assigned.push({
            id: `legacy_${lead.id}`,
            lead_number: lead.id?.toString() || '',
            client_name: lead.name || '',
            category: formatCategoryDisplayName(allCategories, lead.category_id, lead.category),
            topic: lead.topic || 'Not specified',
            manager: lead.meeting_manager_id
              ? (employeeNameMap.get(lead.meeting_manager_id) || 'Unknown')
              : 'Unassigned',
            helper: lead.meeting_lawyer_id
              ? (employeeNameMap.get(lead.meeting_lawyer_id) || 'Unknown')
              : 'Unassigned',
            meeting_date: lead.meeting_date,
            lead_type: 'legacy',
            applicants: lead.no_of_applicants || null,
            value: valueStr,
          });
        });

        assigned.sort((a, b) => {
          const dateA = a.meeting_date ? new Date(a.meeting_date).getTime() : 0;
          const dateB = b.meeting_date ? new Date(b.meeting_date).getTime() : 0;
          return dateB - dateA;
        });

        setLeads(assigned);
      } catch (err) {
        console.error('Error fetching waiting leads:', err);
        setError('Failed to load waiting leads');
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
    waitingStageIds,
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

  const handleRowClick = (lead: WaitingLeadRow) => {
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
            <h3 className="text-lg font-bold text-gray-900">My Waiting Leads</h3>
            <p className="text-sm text-gray-500">Leads awaiting price offer where you are assigned</p>
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
          <button
            type="button"
            className="btn btn-ghost btn-sm gap-2 self-end sm:self-auto"
            onClick={() => navigate('/waiting-for-price-offer')}
          >
            View page
            <ArrowTopRightOnSquareIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-10 gap-3 text-gray-500">
          <span className="loading loading-spinner loading-lg text-purple-600" />
          <p>Loading your leads...</p>
        </div>
      ) : error ? (
        <div className="text-center py-10 text-red-500">{error}</div>
      ) : topLeads.length === 0 ? (
        <div className="text-center py-10 text-gray-500">
          You have no leads waiting for a price offer.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="table w-full">
            <thead className="bg-white border-b border-gray-200">
              <tr>
                <th className="text-gray-700 font-medium">Lead</th>
                <th className="text-gray-700 font-medium">Category</th>
                <th className="text-gray-700 font-medium">Topic</th>
                <th className="text-gray-700 font-medium">Meeting Date</th>
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
                  <td>{formatDate(lead.meeting_date)}</td>
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

export default WaitingForPriceOfferMyLeadsWidget;

