import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { formatCategoryDisplayName } from '../lib/waitingForPriceOffer';
import {
  fetchStageNames,
  getSoftStageBadgeStyle,
  getStageColour,
  getStageName,
} from '../lib/stageUtils';
import {
  getEmployeeRolesFromLeadRow,
  NEW_LEAD_ROLE_SELECT_COLUMNS,
  LEGACY_LEAD_ROLE_SELECT_COLUMNS,
  SIGNED_DEAL_ATTRIBUTION_ROLE_IDS,
} from '../lib/leadEmployeeRoles';
import { DocumentTextIcon } from '@heroicons/react/24/outline';

interface Props {
  maxItems?: number;
  className?: string;
}

interface ClosedDealRow {
  id: string;
  /** Raw DB id for legacy leads (used for signed-date lookup / navigation). */
  legacy_db_id?: number;
  lead_number: string;
  client_name: string;
  category: string;
  signed_date: string | null;
  lead_type: 'new' | 'legacy';
  applicants: number | null;
  valueAmount: number | null;
  valueCurrency: string;
  hasPaymentPlan: boolean;
  stage: string | number | null;
  roles: string[];
}

const toCurrencyIcon = (raw?: string | null): string => {
  if (!raw) return '₪';
  const s = String(raw).trim();
  if (!s) return '₪';
  if (['₪', '$', '€', '£'].includes(s)) return s;
  const upper = s.toUpperCase();
  if (upper === 'NIS' || upper === 'ILS' || upper.includes('SHEKEL')) return '₪';
  if (upper === 'USD' || upper === 'US$' || upper.includes('DOLLAR')) return '$';
  if (upper === 'EUR' || upper.includes('EURO')) return '€';
  if (upper === 'GBP' || upper.includes('POUND')) return '£';
  if (s.length <= 2) return s;
  return '₪';
};

/**
 * Same as Clients.tsx formatLegacyLeadNumber:
 * master leads → id; subleads → `${master_id}/${suffix}` with suffix starting at 2
 * among siblings ordered by id.
 */
function formatLegacyLeadNumbersLikeClients(
  rows: any[],
  siblingsByMaster: Map<number, number[]>,
): Map<number, string> {
  const numbers = new Map<number, string>();
  rows.forEach((row) => {
    const id = Number(row.id);
    if (!Number.isFinite(id)) return;
    const masterRaw = row.master_id;
    const hasMaster = masterRaw != null && String(masterRaw).trim() !== '';
    if (!hasMaster) {
      numbers.set(id, String(id));
      return;
    }
    const masterId = Number(masterRaw);
    if (!Number.isFinite(masterId)) {
      numbers.set(id, String(id));
      return;
    }
    const siblings = siblingsByMaster.get(masterId) || [];
    const idx = siblings.findIndex((sid) => sid === id);
    const suffix = idx >= 0 ? idx + 2 : siblings.length + 2;
    numbers.set(id, `${masterId}/${suffix}`);
  });
  return numbers;
}

const ClosedDealsWithoutPaymentPlanWidget: React.FC<Props> = ({ maxItems = 6, className }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [leads, setLeads] = useState<ClosedDealRow[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  const [userEmployeeId, setUserEmployeeId] = useState<number | null>(null);
  const [userDisplayName, setUserDisplayName] = useState<string>('');
  const [allCategories, setAllCategories] = useState<any[]>([]);
  const [currencyMap, setCurrencyMap] = useState<Map<number, string>>(new Map());

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
          if (userData.employee_id) setUserEmployeeId(Number(userData.employee_id));
          const displayName = (userData.tenants_employee as any)?.display_name;
          if (displayName) setUserDisplayName(String(displayName).trim());
        }
      } catch (err) {
        console.error('Error fetching user data:', err);
      }
    };

    fetchUserData();
  }, []);

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
          const id = typeof curr.id === 'string' ? parseInt(curr.id, 10) || Number(curr.id) : Number(curr.id);
          if (!Number.isFinite(id)) return;
          // Prefer symbol-like fields; always normalize to icon
          const symbol = toCurrencyIcon(curr.name || curr.front_name || curr.iso_code);
          map.set(id, symbol);
        });

        if (map.size === 0) {
          map.set(1, '₪');
          map.set(2, '€');
          map.set(3, '$');
          map.set(4, '£');
        }

        setCurrencyMap(map);
      } catch (err) {
        console.error('Error fetching currencies:', err);
        const fallback = new Map<number, string>();
        fallback.set(1, '₪');
        fallback.set(2, '€');
        fallback.set(3, '$');
        fallback.set(4, '£');
        setCurrencyMap(fallback);
      }
    };

    fetchCurrencies();
  }, []);

  useEffect(() => {
    const shouldFetch =
      userEmployeeId != null &&
      allCategories.length > 0 &&
      currencyMap.size > 0;

    if (!shouldFetch) return;

    const fetchLeads = async () => {
      setLoading(true);
      setError(null);
      try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const thirtyDaysAgoISO = thirtyDaysAgo.toISOString().split('T')[0];

        const { data: recentStageData, error: stageError } = await supabase
          .from('leads_leadstage')
          .select('newlead_id, date, cdate')
          .eq('stage', 60)
          .not('newlead_id', 'is', null)
          .gte('date', thirtyDaysAgoISO)
          .order('date', { ascending: false })
          .limit(1000);

        if (stageError) {
          console.error('[ClosedDeals] Error fetching recent stage data:', stageError);
        }

        const recentNewLeadIds = new Set<string>();
        if (recentStageData) {
          recentStageData.forEach((stage: any) => {
            if (stage.newlead_id) recentNewLeadIds.add(stage.newlead_id.toString());
          });
        }

        let newLeadsData: any[] | null = null;
        if (recentNewLeadIds.size > 0) {
          const { data, error: newLeadsError } = await supabase
            .from('leads')
            .select(`
              id,
              lead_number,
              name,
              category_id,
              category,
              stage,
              balance,
              balance_currency,
              created_at,
              ${NEW_LEAD_ROLE_SELECT_COLUMNS},
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
            .in('id', Array.from(recentNewLeadIds))
            .limit(500);

          if (newLeadsError) {
            console.error('[ClosedDeals] Error fetching new leads:', newLeadsError);
            throw newLeadsError;
          }

          newLeadsData = data;
        }

        const leadIds = (newLeadsData || []).map((lead: any) => lead.id).filter(Boolean);
        let paymentPlanLeadIds = new Set<string>();

        if (leadIds.length > 0) {
          const { data: paymentPlansData, error: paymentPlansError } = await supabase
            .from('payment_plans')
            .select('lead_id')
            .in('lead_id', leadIds)
            .is('cancel_date', null);

          if (paymentPlansError) {
            console.error('[ClosedDeals] Error fetching payment plans:', paymentPlansError);
          } else if (paymentPlansData) {
            paymentPlanLeadIds = new Set(
              paymentPlansData.map((plan: any) => plan.lead_id?.toString()).filter(Boolean),
            );
          }
        }

        const closedDeals: ClosedDealRow[] = [];

        newLeadsData?.forEach((lead: any) => {
          const roles = getEmployeeRolesFromLeadRow(
            'new',
            lead as Record<string, unknown>,
            userEmployeeId,
            userDisplayName,
          ).filter((r) => SIGNED_DEAL_ATTRIBUTION_ROLE_IDS.has(r.id));

          if (roles.length === 0) return;

          const leadIdStr = lead.id?.toString();
          const hasPaymentPlan = !!(leadIdStr && paymentPlanLeadIds.has(leadIdStr));

          const balance = lead.balance != null ? parseFloat(String(lead.balance)) : null;
          const valueAmount = balance !== null && !isNaN(balance) ? balance : null;
          const valueCurrency = toCurrencyIcon(
            lead.balance_currency || currencyMap.get(1) || '₪',
          );

          closedDeals.push({
            id: lead.id,
            lead_number: lead.lead_number || '',
            client_name: lead.name || '',
            category: formatCategoryDisplayName(allCategories, lead.category_id, lead.category),
            signed_date: lead.created_at,
            lead_type: 'new',
            applicants: null,
            valueAmount,
            valueCurrency,
            hasPaymentPlan,
            stage: lead.stage ?? null,
            roles: roles.map((r) => r.title),
          });
        });

        let recentLegacyStageData: any[] | null = null;
        const { data: legacyStageDataResult, error: legacyStageError } = await supabase
          .from('leads_leadstage')
          .select('lead_id, date, cdate')
          .eq('stage', 60)
          .not('lead_id', 'is', null)
          .gte('date', thirtyDaysAgoISO)
          .order('date', { ascending: false })
          .limit(1000);

        if (legacyStageError) {
          console.error('[ClosedDeals] Error fetching recent legacy stage data:', legacyStageError);
        } else {
          recentLegacyStageData = legacyStageDataResult;
        }

        const recentLegacyLeadIds = new Set<number>();
        if (recentLegacyStageData) {
          recentLegacyStageData.forEach((stage: any) => {
            if (stage.lead_id) recentLegacyLeadIds.add(Number(stage.lead_id));
          });
        }

        if (recentLegacyLeadIds.size > 0) {
          // Include status IS NULL (legacy subleads often have null status).
          const { data: legacyData, error: legacyError } = await supabase
            .from('leads_lead')
            .select(`
              id,
              lead_number,
              master_id,
              name,
              category_id,
              category,
              stage,
              status,
              no_of_applicants,
              total,
              currency_id,
              cdate,
              ${LEGACY_LEAD_ROLE_SELECT_COLUMNS},
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
            .or('status.is.null,status.neq.10')
            .in('id', Array.from(recentLegacyLeadIds))
            .limit(500);

          if (legacyError) {
            console.error('[ClosedDeals] Error fetching legacy leads:', legacyError);
            throw legacyError;
          }

          const masterIdsToFetch = [
            ...new Set(
              (legacyData || [])
                .map((lead: any) =>
                  lead.master_id != null && String(lead.master_id).trim() !== ''
                    ? Number(lead.master_id)
                    : null,
                )
                .filter((id: number | null): id is number => id != null && Number.isFinite(id)),
            ),
          ];

          // Fetch ALL siblings per master (Clients.tsx) so /2, /3 suffixes are correct
          const siblingsByMaster = new Map<number, number[]>();
          if (masterIdsToFetch.length > 0) {
            const { data: allSubs } = await supabase
              .from('leads_lead')
              .select('id, master_id')
              .in('master_id', masterIdsToFetch)
              .order('id', { ascending: true });

            (allSubs || []).forEach((sub: any) => {
              const masterId = Number(sub.master_id);
              const subId = Number(sub.id);
              if (!Number.isFinite(masterId) || !Number.isFinite(subId)) return;
              const list = siblingsByMaster.get(masterId) || [];
              list.push(subId);
              siblingsByMaster.set(masterId, list);
            });
          }

          const legacyDisplayNumbers = formatLegacyLeadNumbersLikeClients(
            legacyData || [],
            siblingsByMaster,
          );

          const legacyLeadIds = (legacyData || []).map((lead: any) => lead.id).filter(Boolean);
          const legacyLeadIdsAsStrings = legacyLeadIds.map((id) => String(id));
          let legacyPaymentPlanLeadIds = new Set<string>();

          if (legacyLeadIdsAsStrings.length > 0) {
            const { data: legacyPaymentPlansData, error: legacyPaymentPlansError } = await supabase
              .from('finances_paymentplanrow')
              .select('lead_id')
              .in('lead_id', legacyLeadIdsAsStrings)
              .is('cancel_date', null);

            if (legacyPaymentPlansError) {
              console.error('[ClosedDeals] Error fetching legacy payment plans:', legacyPaymentPlansError);
            } else if (legacyPaymentPlansData) {
              legacyPaymentPlansData.forEach((plan: any) => {
                if (plan.lead_id != null) {
                  legacyPaymentPlanLeadIds.add(String(plan.lead_id));
                  const numericId = Number(plan.lead_id);
                  if (!isNaN(numericId)) legacyPaymentPlanLeadIds.add(numericId.toString());
                }
              });
            }
          }

          legacyData?.forEach((lead: any) => {
            const roles = getEmployeeRolesFromLeadRow(
              'legacy',
              lead as Record<string, unknown>,
              userEmployeeId,
              userDisplayName,
            ).filter((r) => SIGNED_DEAL_ATTRIBUTION_ROLE_IDS.has(r.id));

            if (roles.length === 0) return;

            const leadIdStr = String(lead.id);
            const hasPaymentPlan = legacyPaymentPlanLeadIds.has(leadIdStr);

            const total = lead.total != null ? parseFloat(String(lead.total)) : null;
            const valueAmount = total !== null && !isNaN(total) ? total : null;
            const valueCurrency = toCurrencyIcon(
              currencyMap.get(Number(lead.currency_id)) || '₪',
            );

            closedDeals.push({
              id: `legacy_${lead.id}`,
              legacy_db_id: Number(lead.id),
              lead_number:
                legacyDisplayNumbers.get(Number(lead.id)) || String(lead.id),
              client_name: lead.name || '',
              category: formatCategoryDisplayName(allCategories, lead.category_id, lead.category),
              signed_date: lead.cdate,
              lead_type: 'legacy',
              applicants: lead.no_of_applicants || null,
              valueAmount,
              valueCurrency,
              hasPaymentPlan,
              stage: lead.stage ?? null,
              roles: roles.map((r) => r.title),
            });
          });
        }

        if (recentStageData) {
          const signedDateMap = new Map<string, string>();
          recentStageData.forEach((stage: any) => {
            const leadId = stage.newlead_id?.toString();
            if (leadId && !signedDateMap.has(leadId)) {
              signedDateMap.set(leadId, stage.date || stage.cdate);
            }
          });

          closedDeals.forEach((deal) => {
            if (deal.lead_type === 'new') {
              const signedDate = signedDateMap.get(deal.id);
              if (signedDate) deal.signed_date = signedDate;
            }
          });
        }

        if (recentLegacyStageData) {
          const signedDateMap = new Map<number, string>();
          recentLegacyStageData.forEach((stage: any) => {
            const leadId = Number(stage.lead_id);
            if (leadId && !isNaN(leadId) && !signedDateMap.has(leadId)) {
              signedDateMap.set(leadId, stage.date || stage.cdate);
            }
          });

          closedDeals.forEach((deal) => {
            if (deal.lead_type === 'legacy') {
              const leadIdNum =
                deal.legacy_db_id ??
                Number(String(deal.id).replace(/^legacy_/, ''));
              if (!isNaN(leadIdNum)) {
                const signedDate = signedDateMap.get(leadIdNum);
                if (signedDate) deal.signed_date = signedDate;
              }
            }
          });
        }

        closedDeals.sort((a, b) => {
          const dateA = a.signed_date ? new Date(a.signed_date).getTime() : 0;
          const dateB = b.signed_date ? new Date(b.signed_date).getTime() : 0;
          return dateB - dateA;
        });

        await fetchStageNames();
        setLeads(closedDeals);
      } catch (err) {
        console.error('[ClosedDeals] Error fetching closed deals:', err);
        setError('Failed to load closed deals');
      } finally {
        setLoading(false);
      }
    };

    fetchLeads();
  }, [userEmployeeId, userDisplayName, allCategories, currencyMap]);

  const filteredLeads = useMemo(() => {
    if (!searchTerm.trim()) return leads;
    const lower = searchTerm.toLowerCase();
    return leads.filter(
      (lead) =>
        lead.lead_number.toLowerCase().includes(lower) ||
        lead.client_name.toLowerCase().includes(lower) ||
        lead.category.toLowerCase().includes(lower) ||
        lead.roles.some((r) => r.toLowerCase().includes(lower)) ||
        (lead.stage != null && getStageName(String(lead.stage)).toLowerCase().includes(lower)),
    );
  }, [leads, searchTerm]);

  const topLeads = useMemo(() => filteredLeads.slice(0, maxItems), [filteredLeads, maxItems]);

  const formatDate = (date: string | null) => {
    if (!date) return 'Not set';
    try {
      return new Date(date).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    } catch {
      return 'Invalid date';
    }
  };

  const handleRowClick = (lead: ClosedDealRow, e?: React.MouseEvent) => {
    const isCtrlOrCmd = e?.ctrlKey || e?.metaKey;
    let url = '';

    if (lead.lead_type === 'legacy') {
      const displayNum = String(lead.lead_number || '').trim();
      const dbId = lead.legacy_db_id ?? Number(String(lead.id).replace(/^legacy_/, ''));
      if (displayNum.includes('/')) {
        // Clients.tsx: legacy subleads use query param on master id
        const base = displayNum.split('/')[0];
        url = `/clients/${encodeURIComponent(base)}?lead=${encodeURIComponent(displayNum)}`;
      } else if (Number.isFinite(dbId)) {
        url = `/clients/${encodeURIComponent(String(dbId))}`;
      } else {
        url = `/clients/${encodeURIComponent(displayNum)}`;
      }
    } else {
      const displayNum = String(lead.lead_number || '').trim();
      if (displayNum.includes('/')) {
        url = `/clients/${encodeURIComponent(displayNum)}`;
      } else {
        url = `/clients/${encodeURIComponent(displayNum)}`;
      }
    }

    if (isCtrlOrCmd) {
      window.open(url, '_blank');
    } else {
      navigate(url);
    }
  };

  return (
    <div className={`bg-white rounded-2xl shadow-lg border border-gray-200 ${className || ''}`}>
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 px-6 py-4 border-b border-gray-200">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-tr from-purple-500 to-blue-600 rounded-lg flex items-center justify-center">
            <DocumentTextIcon className="w-6 h-6 text-white" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-gray-900">Closed Deals (Last 30 Days)</h3>
            <p className="text-sm text-gray-500">
              Signed agreements from the last 30 days where you are closer, expert, manager, scheduler, or helper
            </p>
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
          You have no closed deals in the last 30 days.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="table w-full">
            <thead className="bg-white border-b border-gray-200">
              <tr>
                <th className="text-gray-700 font-medium">Lead</th>
                <th className="text-gray-700 font-medium">Category</th>
                <th className="text-gray-700 font-medium">Role</th>
                <th className="text-gray-700 font-medium">Signed Date</th>
                <th className="text-gray-700 font-medium">Value</th>
                <th className="text-gray-700 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {topLeads.map((lead) => {
                const stageStr = lead.stage != null ? String(lead.stage) : '';
                const stageLabel = stageStr ? getStageName(stageStr) : 'No Stage';
                const softBadgeStyle = stageStr
                  ? getSoftStageBadgeStyle(getStageColour(stageStr), stageStr)
                  : null;
                return (
                  <tr
                    key={lead.id}
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={(e) => handleRowClick(lead, e)}
                  >
                    <td>
                      <div className="flex flex-col">
                        <span className="font-semibold text-gray-900">
                          {lead.client_name || 'No name'}
                        </span>
                        <span className="text-sm text-gray-500">#{lead.lead_number}</span>
                      </div>
                    </td>
                    <td>{lead.category}</td>
                    <td className="text-sm text-gray-700">
                      {lead.roles.length > 0 ? lead.roles.join(', ') : '—'}
                    </td>
                    <td>{formatDate(lead.signed_date)}</td>
                    <td className="font-semibold text-green-600">
                      {lead.valueAmount != null
                        ? `${lead.valueCurrency}${lead.valueAmount.toLocaleString()}`
                        : '---'}
                    </td>
                    <td>
                      <div className="flex flex-col gap-1 items-start">
                        {softBadgeStyle ? (
                          <span
                            className="badge stage-badge rounded-full shrink-0 border-0 hover:opacity-90 transition-opacity duration-200 text-xs px-2.5 py-0.5 max-w-full"
                            style={{
                              backgroundColor: softBadgeStyle.backgroundColor,
                              color: softBadgeStyle.color,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              display: 'inline-block',
                            }}
                            title={stageLabel}
                          >
                            {stageLabel}
                          </span>
                        ) : (
                          <span className="badge stage-badge rounded-full shrink-0 border-0 text-xs px-2.5 py-0.5 max-w-full bg-gray-100 text-gray-600">
                            No Stage
                          </span>
                        )}
                        {!lead.hasPaymentPlan && (
                          <span className="badge badge-warning badge-sm text-white">
                            Missing Payments Plan
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
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
