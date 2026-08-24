import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/solid';
import { supabase } from '../../lib/supabase';
import { resolvePipelineIdentity } from '../../lib/resolvePipelineIdentity';
import type { PipelineViewAs } from '../../lib/resolvePipelineIdentity';
import { convertToNIS } from '../../lib/currencyConversion';
import { localTodayYmd } from '../../lib/meetingRescheduleCancel';
import { fetchPipelineLeadMetrics, type PipelineLeadMetrics } from '../../lib/pipelineLeadMetrics';
import { upsertUserFollowUp } from '../../lib/upsertUserFollowUp';
import { fetchHandlerAssignmentHistory } from '../../lib/handlerAssignmentHistory';
import {
  isHighValue,
  isLostInteraction,
  isMissedFollowUp,
  isMissedInteraction,
  isTodayFollowUp,
  lostInteractionCutoffMs,
  startOfTodayMs,
  type PipelineSummaryRow,
} from '../../lib/pipelineSummary';
import {
  getSoftStageBadgeStyle,
  getStageColour,
  getStageName,
  initializeStageNames,
} from '../../lib/stageUtils';
import { openLeadFromRowClick } from '../../lib/leadNavigation';
import {
  createSnapshotStore,
  pipelineViewIdentityKey,
  useRevalidateOnVisible,
  useScrollRestoration,
} from '../../lib/pipelineLiveCache';
import HandlerSummaryCards, {
  type HandlerQuickFilter,
  type HandlerSummaryCounts,
} from './HandlerSummaryCards';
import {
  HandlerActionsColumn,
  HandlerCaseOverlays,
  HandlerCountryHoursDot,
  markHandlerReadyToPay,
  openHandlerRmqForCloser,
  toggleHandlerRetention,
} from './HandlerCaseActions';
import { type HandlerBucket, type HandlerPipelineRow } from './handlerTypes';
import PipelineFollowUpButton from './PipelineFollowUpButton';
import HandlerAssignedDateBadge from './HandlerAssignedDateBadge';
import {
  handlePipelineRowPick,
  isPipelineLeadPicked,
  toPipelineActionLead,
  type PipelineLeadSelectProps,
} from './pipelineActions';
import {
  PipelineRowPickCell,
  PipelineRowPickHeader,
} from './PipelineRowPickCell';
import HandlerPipelineFilterBar, {
  EMPTY_HANDLER_TABLE_FILTERS,
  matchesHandlerTableFilters,
  uniqueSorted,
  type HandlerTableFilters,
} from './HandlerPipelineFilterBar';
import {
  PIPELINE_CELL_FIRST,
  PIPELINE_CELL_LAST,
  PIPELINE_CELL_MID,
  PIPELINE_CELL_STYLE,
  PIPELINE_TABLE_CLASS,
  PIPELINE_THEAD_CLASS,
  formatPipelineCategory,
  formatPipelineMoney,
  pipelineMainCategory,
  pipelineRowClassName,
} from './pipelineUi';
import toast from 'react-hot-toast';
import { loadPipelineFilters, savePipelineFilters } from './pipelineFilterPersist';

type Props = {
  onCountChange?: (count: number) => void;
  viewAs?: PipelineViewAs | null;
} & PipelineLeadSelectProps;

const BUCKETS: Array<{ id: HandlerBucket; label: string }> = [
  { id: 'new', label: 'New' },
  { id: 'active', label: 'Active' },
  { id: 'non_active', label: 'Non-active' },
  { id: 'closed', label: 'Closed' },
];

type HandlerFilterState = {
  search: string;
  tableFilters: HandlerTableFilters;
  bucket: HandlerBucket;
  quickFilter: HandlerQuickFilter;
};

const DEFAULT_HANDLER_FILTERS: HandlerFilterState = {
  search: '',
  tableFilters: { ...EMPTY_HANDLER_TABLE_FILTERS },
  bucket: 'new',
  quickFilter: null,
};

function loadHandlerFilters(key: 'handler' | 'retention'): HandlerFilterState {
  const loaded = loadPipelineFilters(key, DEFAULT_HANDLER_FILTERS);
  return {
    ...loaded,
    tableFilters: { ...EMPTY_HANDLER_TABLE_FILTERS, ...loaded.tableFilters },
    bucket: BUCKETS.some((item) => item.id === loaded.bucket) ? loaded.bucket : 'new',
  };
}

type HandlerCountry = { id: number; name: string; timezone?: string | null };

type HandlerSnapshot = {
  identityKey: string;
  rows: HandlerPipelineRow[];
  metrics: Map<string, PipelineLeadMetrics>;
  countries: HandlerCountry[];
  currentUserId: string | null;
};

const HANDLER_CACHE_VERSION = 1;
const HANDLER_STALE_MS = 5 * 60 * 1000;
const snapshotStore = createSnapshotStore<HandlerSnapshot>(HANDLER_CACHE_VERSION);

function matchingHandlerSnapshot(viewAs: PipelineViewAs | null): HandlerSnapshot | null {
  const snapshot = snapshotStore.get();
  if (!snapshot || snapshot.identityKey !== pipelineViewIdentityKey(viewAs)) return null;
  return snapshot;
}

function classifyBucket(
  stageId: number | null,
  activeHandlerType: number,
  isInactive: boolean,
): HandlerBucket | null {
  if (stageId == null || Number.isNaN(stageId)) return null;
  if (stageId === 200) return 'closed';
  if (Number(activeHandlerType) === 1) return 'non_active';
  if (isInactive) return null;
  if (Number(activeHandlerType) === 2 && stageId <= 105) return 'new';
  if (Number(activeHandlerType) === 2 && stageId >= 110) return 'active';
  return null;
}

function currencyFromLegacy(currencyId: number | null | undefined, currencyData: unknown): string {
  const currency = Array.isArray(currencyData) ? currencyData[0] : currencyData;
  const rec = currency && typeof currency === 'object' ? (currency as { iso_code?: string }) : null;
  if (rec?.iso_code) {
    if (rec.iso_code === 'ILS') return '₪';
    if (rec.iso_code === 'USD') return '$';
    if (rec.iso_code === 'EUR') return '€';
    if (rec.iso_code === 'GBP') return '£';
    return rec.iso_code;
  }
  if (currencyId === 2) return '€';
  if (currencyId === 3) return '$';
  if (currencyId === 4) return '£';
  return '₪';
}

function valueToNis(amount: number | null | undefined, currency: string | null | undefined): number {
  const symbolMap: Record<string, string> = { '₪': 'NIS', '€': 'EUR', '$': 'USD', '£': 'GBP' };
  const code = currency ? symbolMap[currency] || currency : 'NIS';
  return convertToNIS(Number(amount) || 0, code);
}

const HandlerPipelineView: React.FC<Props> = ({
  onCountChange,
  viewAs = null,
  selectedLeadId = null,
  selectedLeadIds,
  picking = false,
  multiSelect = false,
  onSelectLead,
  refreshToken = 0,
}) => {
  const navigate = useNavigate();
  const initialSnapshot = matchingHandlerSnapshot(viewAs);
  const [loading, setLoading] = useState(() => initialSnapshot == null);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<HandlerPipelineRow[]>(() => initialSnapshot?.rows || []);
  const [search, setSearch] = useState(() => loadHandlerFilters('handler').search);
  const [tableFilters, setTableFilters] = useState<HandlerTableFilters>(
    () => loadHandlerFilters('handler').tableFilters,
  );
  const [bucket, setBucket] = useState<HandlerBucket>(() => loadHandlerFilters('handler').bucket);
  const [quickFilter, setQuickFilter] = useState<HandlerQuickFilter>(
    () => loadHandlerFilters('handler').quickFilter,
  );
  const [metrics, setMetrics] = useState<Map<string, PipelineLeadMetrics>>(
    () => (initialSnapshot?.metrics ? new Map(initialSnapshot.metrics) : new Map()),
  );
  const [countries, setCountries] = useState<HandlerCountry[]>(() => initialSnapshot?.countries || []);
  const [rmqTarget, setRmqTarget] = useState<{ row: HandlerPipelineRow; userId: string } | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(() => initialSnapshot?.currentUserId || null);
  const [editingFollowUp, setEditingFollowUp] = useState<HandlerPipelineRow | null>(null);
  const [followUpDraft, setFollowUpDraft] = useState('');
  const [savingFollowUp, setSavingFollowUp] = useState(false);

  useEffect(() => {
    savePipelineFilters('handler', {
      search,
      tableFilters,
      bucket,
      quickFilter,
    } satisfies HandlerFilterState);
  }, [search, tableFilters, bucket, quickFilter]);

  const load = useCallback(async (options: { silent?: boolean } = {}) => {
    const { silent = false } = options;
    if (!silent) setLoading(true);
    setError(null);
    try {
      await initializeStageNames();
      const identity = await resolvePipelineIdentity(viewAs);
      const employeeId = identity.employeeId;
      const userFullName = identity.fullName;
      const currentUserId = identity.userId;
      setCurrentUserId(currentUserId);

      const handlerOr = userFullName
        ? `handler.eq.${userFullName},handler.eq.${employeeId},case_handler_id.eq.${employeeId}`
        : `handler.eq.${employeeId},case_handler_id.eq.${employeeId}`;

      const [newResult, legacyResult, languagesResult, employeesResult, countriesResult] = await Promise.all([
        supabase
          .from('leads')
          .select(`
            id, lead_number, name, stage, category_id, category, created_at,
            balance, balance_currency, handler, case_handler_id, retainer_handler_id,
            active_handler_type, language, country_id, unactivated_at, phone, mobile, email,
            misc_country!country_id ( id, name, timezone ),
            misc_category!category_id (
              id, name, parent_id,
              misc_maincategory!parent_id ( id, name )
            )
          `)
          .or(handlerOr)
          .order('created_at', { ascending: false })
          .limit(1000),
        supabase
          .from('leads_lead')
          .select(`
            id, name, stage, category_id, cdate, no_of_applicants, total, currency_id,
            language_id, active_handler_type, retainer_handler_id, status, phone,
            accounting_currencies!leads_lead_currency_id_fkey ( name, iso_code ),
            misc_category!category_id (
              id, name, parent_id,
              misc_maincategory!parent_id ( id, name )
            )
          `)
          .eq('case_handler_id', employeeId)
          .order('cdate', { ascending: false })
          .limit(1000),
        supabase.from('misc_language').select('id, name'),
        supabase.from('tenants_employee').select('id, display_name'),
        supabase.from('misc_country').select('id, name, timezone'),
      ]);

      if (newResult.error) throw newResult.error;
      if (legacyResult.error) throw legacyResult.error;
      const nextCountries = (countriesResult.data || []) as HandlerCountry[];
      setCountries(nextCountries);

      const languageMap = new Map<string, string>();
      (languagesResult.data || []).forEach((lang) => {
        if (lang.id != null) languageMap.set(String(lang.id), lang.name || '');
      });
      const employeeName = (id: unknown) => {
        if (id == null || id === '') return null;
        const emp = (employeesResult.data || []).find((row) => String(row.id) === String(id));
        return emp?.display_name || null;
      };

      const newLeadIds = (newResult.data || []).map((lead) => lead.id);
      const legacyLeadIds = (legacyResult.data || []).map((lead) => lead.id);

      const [newFollowupsResult, legacyFollowupsResult, legacyCountryResult, newPaymentsResult, legacyPaymentsResult, assignmentHistory] = await Promise.all([
        newLeadIds.length > 0 && currentUserId
          ? supabase
              .from('follow_ups')
              .select('new_lead_id, date')
              .eq('user_id', currentUserId)
              .in('new_lead_id', newLeadIds)
              .is('lead_id', null)
          : Promise.resolve({ data: [] as Array<{ new_lead_id?: string; date?: string }>, error: null }),
        legacyLeadIds.length > 0 && currentUserId
          ? supabase
              .from('follow_ups')
              .select('lead_id, date')
              .eq('user_id', currentUserId)
              .in('lead_id', legacyLeadIds)
              .is('new_lead_id', null)
          : Promise.resolve({ data: [] as Array<{ lead_id?: string | number; date?: string }>, error: null }),
        legacyLeadIds.length > 0
          ? supabase
              .from('lead_leadcontact')
              .select(`
                lead_id,
                leads_contact (
                  country_id,
                  misc_country ( id, name, timezone )
                )
              `)
              .in('lead_id', legacyLeadIds)
              .eq('main', 'true')
          : Promise.resolve({ data: [] as any[], error: null }),
        newLeadIds.length > 0
          ? supabase
              .from('payment_plans')
              .select('lead_id, paid, ready_to_pay, cancel_date')
              .in('lead_id', newLeadIds)
              .is('cancel_date', null)
          : Promise.resolve({ data: [] as any[], error: null }),
        legacyLeadIds.length > 0
          ? supabase
              .from('finances_paymentplanrow')
              .select('lead_id, actual_date, ready_to_pay, cancel_date')
              .in('lead_id', legacyLeadIds)
              .is('cancel_date', null)
          : Promise.resolve({ data: [] as any[], error: null }),
        fetchHandlerAssignmentHistory({
          employeeId,
          userFullName,
          newLeadIds,
          legacyLeadIds,
          employees: employeesResult.data || [],
        }),
      ]);

      const followUpsMap = new Map<string, string>();
      (newFollowupsResult.data || []).forEach((row) => {
        if (row.new_lead_id && row.date) followUpsMap.set(String(row.new_lead_id), row.date);
      });
      (legacyFollowupsResult.data || []).forEach((row) => {
        if (row.lead_id != null && row.date) followUpsMap.set(String(row.lead_id), row.date);
      });

      const legacyCountryMap = new Map<string, { name: string; timezone: string | null; country_id: number | null }>();
      (legacyCountryResult.data || []).forEach((row: any) => {
        const contact = Array.isArray(row.leads_contact) ? row.leads_contact[0] : row.leads_contact;
        const country = Array.isArray(contact?.misc_country) ? contact?.misc_country[0] : contact?.misc_country;
        if (row.lead_id != null && country?.name) {
          legacyCountryMap.set(String(row.lead_id), {
            name: country.name,
            timezone: country.timezone || null,
            country_id: country.id ?? contact?.country_id ?? null,
          });
        }
      });

      const newPaymentsByLead = new Map<string, any[]>();
      (newPaymentsResult.data || []).forEach((payment: any) => {
        const list = newPaymentsByLead.get(payment.lead_id) || [];
        list.push(payment);
        newPaymentsByLead.set(payment.lead_id, list);
      });
      const legacyPaymentsByLead = new Map<string, any[]>();
      (legacyPaymentsResult.data || []).forEach((payment: any) => {
        const leadId = String(payment.lead_id);
        const list = legacyPaymentsByLead.get(leadId) || [];
        list.push(payment);
        legacyPaymentsByLead.set(leadId, list);
      });

      const newPaymentFlags = (leadId: string) => {
        const payments = newPaymentsByLead.get(leadId) || [];
        return {
          hasPaymentPlan: payments.length > 0,
          isFirstPaymentPaid: payments.some((p) => p.paid === true),
          hasReadyToPay: payments.some((p) => p.ready_to_pay === true),
          hasUnpaidPayment: payments.some((p) => p.paid !== true),
        };
      };
      const legacyPaymentFlags = (leadId: string) => {
        const payments = legacyPaymentsByLead.get(leadId) || [];
        return {
          hasPaymentPlan: payments.length > 0,
          isFirstPaymentPaid: payments.some((p) => p.actual_date != null && p.actual_date !== ''),
          hasReadyToPay: payments.some((p) => p.ready_to_pay === true),
          hasUnpaidPayment: payments.some((p) => p.actual_date == null || p.actual_date === ''),
        };
      };

      const processed: HandlerPipelineRow[] = [];

      for (const lead of newResult.data || []) {
        const stageId = lead.stage != null ? Number(lead.stage) : null;
        const activeHandlerType = Number(lead.active_handler_type) === 1 ? 1 : 2;
        const isInactive = lead.unactivated_at != null;
        const bucketId = classifyBucket(stageId, activeHandlerType, isInactive);
        if (!bucketId) continue;
        const countryJoin = Array.isArray(lead.misc_country) ? lead.misc_country[0] : lead.misc_country;
        const pay = newPaymentFlags(String(lead.id));
        const assignment = assignmentHistory.byNewId.get(String(lead.id));
        processed.push({
          id: String(lead.id),
          navId: String(lead.lead_number || lead.id),
          lead_number: String(lead.lead_number || lead.id),
          name: lead.name || 'Unknown',
          assigned_date: lead.created_at || null,
          next_followup: followUpsMap.get(String(lead.id)) || null,
          category: formatPipelineCategory(lead.misc_category, lead.category),
          mainCategory: pipelineMainCategory(lead.misc_category),
          language: lead.language || null,
          country: countryJoin?.name || null,
          country_id: countryJoin?.id ?? lead.country_id ?? null,
          timezone: countryJoin?.timezone || null,
          phone: lead.phone || null,
          mobile: lead.mobile || null,
          email: lead.email || null,
          applicants: null,
          value: lead.balance ?? null,
          currency: lead.balance_currency || '₪',
          valueNis: valueToNis(lead.balance ?? null, lead.balance_currency || '₪'),
          stage: String(lead.stage ?? ''),
          stageId,
          retentionHandlerName: employeeName(lead.retainer_handler_id),
          bucket: bucketId,
          isInactive,
          isNewLead: true,
          active_handler_type: activeHandlerType as 1 | 2,
          handlerAssignedDate: assignment?.handlerAssignedDate || null,
          firstHandlerAssignedDate: assignment?.firstHandlerAssignedDate || null,
          previousHandlerName: assignment?.previousHandlerName || null,
          previousHandlerAssignedDate: assignment?.previousHandlerAssignedDate || null,
          stage105Date: assignment?.stage105Date || null,
          stage110Date: assignment?.stage110Date || null,
          ...pay,
        });
      }

      for (const lead of legacyResult.data || []) {
        const stageId = lead.stage != null ? Number(lead.stage) : null;
        const activeHandlerType = Number(lead.active_handler_type) === 1 ? 1 : 2;
        const isInactive = Number(lead.status) === 10;
        const bucketId = classifyBucket(stageId, activeHandlerType, isInactive);
        if (!bucketId) continue;
        const countryInfo = legacyCountryMap.get(String(lead.id));
        const pay = legacyPaymentFlags(String(lead.id));
        const assignment = assignmentHistory.byLegacyId.get(String(lead.id));
        processed.push({
          id: `legacy_${lead.id}`,
          navId: String(lead.id),
          lead_number: String(lead.id),
          name: lead.name || 'Unknown',
          assigned_date: lead.cdate || null,
          next_followup: followUpsMap.get(String(lead.id)) || null,
          category: formatPipelineCategory(lead.misc_category, null),
          mainCategory: pipelineMainCategory(lead.misc_category),
          language: lead.language_id != null ? languageMap.get(String(lead.language_id)) || null : null,
          country: countryInfo?.name || null,
          country_id: countryInfo?.country_id ?? null,
          timezone: countryInfo?.timezone || null,
          phone: lead.phone || null,
          mobile: null,
          email: null,
          applicants: lead.no_of_applicants ?? null,
          value: lead.total ?? null,
          currency: currencyFromLegacy(lead.currency_id, lead.accounting_currencies),
          valueNis: valueToNis(lead.total ?? null, currencyFromLegacy(lead.currency_id, lead.accounting_currencies)),
          stage: String(lead.stage ?? ''),
          stageId,
          retentionHandlerName: employeeName(lead.retainer_handler_id),
          bucket: bucketId,
          isInactive,
          isNewLead: false,
          active_handler_type: activeHandlerType as 1 | 2,
          handlerAssignedDate: assignment?.handlerAssignedDate || null,
          firstHandlerAssignedDate: assignment?.firstHandlerAssignedDate || null,
          previousHandlerName: assignment?.previousHandlerName || null,
          previousHandlerAssignedDate: assignment?.previousHandlerAssignedDate || null,
          stage105Date: assignment?.stage105Date || null,
          stage110Date: assignment?.stage110Date || null,
          ...pay,
        });
      }

      processed.sort((a, b) => {
        const da = a.assigned_date ? Date.parse(a.assigned_date) : 0;
        const db = b.assigned_date ? Date.parse(b.assigned_date) : 0;
        return db - da;
      });
      setRows(processed);
      snapshotStore.set({
        identityKey: pipelineViewIdentityKey(viewAs),
        rows: processed,
        metrics: snapshotStore.get()?.metrics || new Map(),
        countries: nextCountries,
        currentUserId,
      });
    } catch (err) {
      console.error('Handler pipeline load:', err);
      if (silent) return;
      snapshotStore.clear();
      setError(err instanceof Error ? err.message : 'Failed to load handler pipeline');
      setRows([]);
      setMetrics(new Map());
    } finally {
      setLoading(false);
    }
  }, [viewAs]);

  useEffect(() => {
    if (matchingHandlerSnapshot(viewAs)) {
      void load({ silent: true });
      return;
    }
    void load();
  }, [load, viewAs]);

  useEffect(() => {
    if (!refreshToken) return;
    void load({ silent: true });
  }, [refreshToken, load]);

  useRevalidateOnVisible({
    isStale: () => snapshotStore.isStale(HANDLER_STALE_MS),
    onRevalidate: () => void load({ silent: true }),
  });
  useScrollRestoration(snapshotStore, loading);

  const actionHandlers = useMemo(
    () => ({
      onReload: () => {
        void load({ silent: true });
      },
      onOpenRmq: (row: HandlerPipelineRow) => {
        void openHandlerRmqForCloser(row)
          .then((target) => setRmqTarget(target))
          .catch((err) => {
            console.error(err);
            toast.error(err instanceof Error ? err.message : 'Failed to open message window');
          });
      },
      onToggleRetention: (row: HandlerPipelineRow, nextType: 1 | 2, e: React.MouseEvent) => {
        e.stopPropagation();
        void toggleHandlerRetention(row, nextType)
          .then(() => {
            toast.success(nextType === 1 ? 'Transferred to Retention' : 'Case marked as active for you');
            return load({ silent: true });
          })
          .catch((err) => {
            console.error(err);
            toast.error('Failed to update case. Please try again.');
          });
      },
      onMarkReadyToPay: (row: HandlerPipelineRow, e: React.MouseEvent) => {
        e.stopPropagation();
        void markHandlerReadyToPay(row)
          .then(() => {
            toast.success('Payment marked as ready to pay! Due date set to today. It will now appear in the collection page.');
            return load({ silent: true });
          })
          .catch((err) => {
            console.error(err);
            toast.error(err instanceof Error ? err.message : 'Failed to mark payment as ready to pay');
          });
      },
    }),
    [load],
  );

  const openFollowUpModal = (row: HandlerPipelineRow, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingFollowUp(row);
    setFollowUpDraft(row.next_followup ? String(row.next_followup).slice(0, 10) : '');
  };

  const closeFollowUpModal = () => {
    if (savingFollowUp) return;
    setEditingFollowUp(null);
    setFollowUpDraft('');
  };

  const saveFollowUpDate = async () => {
    if (!editingFollowUp) return;
    if (!currentUserId) {
      toast.error('User not authenticated');
      return;
    }
    setSavingFollowUp(true);
    try {
      const hasDate = Boolean(followUpDraft.trim());
      await upsertUserFollowUp({
        userId: currentUserId,
        isLegacy: !editingFollowUp.isNewLead,
        leadId: editingFollowUp.isNewLead ? editingFollowUp.id : editingFollowUp.id.replace(/^legacy_/, ''),
        dateYmd: hasDate ? followUpDraft : null,
      });
      setRows((prev) => {
        const next = prev.map((row) =>
          row.id === editingFollowUp.id ? { ...row, next_followup: hasDate ? followUpDraft : null } : row,
        );
        snapshotStore.update((snap) => ({ ...snap, rows: next }));
        return next;
      });
      toast.success(hasDate ? 'Follow-up date saved' : 'Follow-up date cleared');
      setEditingFollowUp(null);
      setFollowUpDraft('');
    } catch (error) {
      console.error('Failed to save follow-up date:', error);
      toast.error('Failed to save follow-up date');
    } finally {
      setSavingFollowUp(false);
    }
  };

  useEffect(() => {
    if (rows.length === 0) {
      setMetrics(new Map());
      return;
    }
    const newIds: string[] = [];
    const legacyIds: string[] = [];
    rows.forEach((row) => {
      if (row.id.startsWith('legacy_')) legacyIds.push(row.id.replace(/^legacy_/, ''));
      else newIds.push(row.id);
    });
    let cancelled = false;
    void fetchPipelineLeadMetrics(newIds, legacyIds)
      .then((next) => {
        if (!cancelled) {
          setMetrics(next);
          snapshotStore.update((snap) => ({ ...snap, metrics: next }));
        }
      })
      .catch((err) => console.warn('Handler pipeline metrics failed', err));
    return () => {
      cancelled = true;
    };
  }, [rows]);

  const toSummaryRow = useCallback(
    (row: HandlerPipelineRow): PipelineSummaryRow => {
      const rowMetrics = metrics.get(row.id);
      return {
        follow_up: row.next_followup,
        value_nis: row.valueNis,
        last_interaction: rowMetrics?.last_interaction ?? null,
        awaiting_reply: rowMetrics?.awaiting_reply ?? false,
        next_meeting: rowMetrics?.next_meeting ?? null,
        is_inactive: row.isInactive || row.bucket === 'closed',
        created_at: row.assigned_date,
      };
    },
    [metrics],
  );

  const openRows = useMemo(() => rows.filter((row) => row.bucket !== 'closed'), [rows]);

  const counts = useMemo(() => {
    const next = { new: 0, active: 0, non_active: 0, closed: 0 };
    rows.forEach((row) => {
      if (!matchesHandlerTableFilters(row, tableFilters)) return;
      next[row.bucket] += 1;
    });
    return next;
  }, [rows, tableFilters]);

  useEffect(() => {
    onCountChange?.(rows.length);
  }, [onCountChange, rows.length]);

  const summaryCounts: HandlerSummaryCounts = useMemo(() => {
    const todayKey = localTodayYmd();
    const todayMs = startOfTodayMs();
    const cutoff = lostInteractionCutoffMs();
    const counts: HandlerSummaryCounts = {
      todayFollowUp: 0,
      highValue: 0,
      lostInteraction: 0,
      missedInteraction: 0,
      missedFollowUp: 0,
    };
    openRows.forEach((row) => {
      const summary = toSummaryRow(row);
      if (isTodayFollowUp(summary, todayKey)) counts.todayFollowUp += 1;
      if (isHighValue(summary)) counts.highValue += 1;
      if (isLostInteraction(summary, cutoff)) counts.lostInteraction += 1;
      if (isMissedInteraction(summary)) counts.missedInteraction += 1;
      if (isMissedFollowUp(summary, todayMs)) counts.missedFollowUp += 1;
    });
    return counts;
  }, [openRows, toSummaryRow]);

  const filterOptions = useMemo(
    () => ({
      categories: uniqueSorted(rows.map((row) => row.mainCategory)),
      languages: uniqueSorted(rows.map((row) => row.language)),
      countries: uniqueSorted(rows.map((row) => row.country)),
    }),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const todayKey = localTodayYmd();
    const todayMs = startOfTodayMs();
    const cutoff = lostInteractionCutoffMs();
    return rows.filter((row) => {
      if (quickFilter) {
        if (row.bucket === 'closed') return false;
        const summary = toSummaryRow(row);
        if (quickFilter === 'today_followup' && !isTodayFollowUp(summary, todayKey)) return false;
        if (quickFilter === 'high_value' && !isHighValue(summary)) return false;
        if (quickFilter === 'lost_interaction' && !isLostInteraction(summary, cutoff)) return false;
        if (quickFilter === 'missed_interaction' && !isMissedInteraction(summary)) return false;
        if (quickFilter === 'missed_followup' && !isMissedFollowUp(summary, todayMs)) return false;
      } else if (row.bucket !== bucket) {
        return false;
      }
      if (!matchesHandlerTableFilters(row, tableFilters)) return false;
      if (!q) return true;
      return [row.lead_number, row.name, row.category, getStageName(row.stage), row.country, row.language]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [rows, bucket, search, tableFilters, quickFilter, toSummaryRow]);

  return (
    <div className="w-full space-y-5">
      <HandlerSummaryCards
        counts={summaryCounts}
        quickFilter={quickFilter}
        onToggle={setQuickFilter}
      />

      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-wrap items-end gap-3">
          <div className="relative w-full min-w-0 sm:w-56">
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Search
            </label>
            <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-[2.15rem] z-10 h-4 w-4 text-gray-400" />
            <input
              type="text"
              className="input input-bordered w-full rounded-xl border-gray-200 bg-white !pl-9 text-sm"
              placeholder="search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <HandlerPipelineFilterBar
            filters={tableFilters}
            onChange={setTableFilters}
            categories={filterOptions.categories}
            languages={filterOptions.languages}
            countries={filterOptions.countries}
            showAssignmentFilter
          />
        </div>
        <div className="inline-flex shrink-0 items-center gap-1 rounded-full bg-gray-200/70 p-1">
          {BUCKETS.map((item) => {
            const active = bucket === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
                  active ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'
                }`}
                onClick={() => setBucket(item.id)}
              >
                {item.label}
                <span className="ml-1.5 text-xs font-medium text-gray-400">{counts[item.id]}</span>
              </button>
            );
          })}
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-white px-4 py-6 text-center text-sm text-red-600">
          {error}
        </div>
      ) : (
        <div className="w-full overflow-x-auto">
          <table className={PIPELINE_TABLE_CLASS}>
            <thead className={PIPELINE_THEAD_CLASS}>
              <tr>
                <PipelineRowPickHeader visible={picking} />
                <th className="px-4 py-3 text-left font-semibold">Lead</th>
                <th className="px-4 py-3 text-left font-semibold">Assigned date</th>
                <th className="px-4 py-3 text-left font-semibold">Follow up</th>
                <th className="px-4 py-3 text-left font-semibold">Category</th>
                <th className="px-4 py-3 text-left font-semibold">Language</th>
                <th className="px-4 py-3 text-left font-semibold">Country</th>
                <th className="px-4 py-3 text-left font-semibold">Applicants</th>
                <th className="px-4 py-3 text-left font-semibold">Value</th>
                <th className="px-4 py-3 text-left font-semibold">Stage</th>
                <th className="px-4 py-3 text-left font-semibold">Retention</th>
                <th className="px-4 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={11 + (picking ? 1 : 0)} className="bg-white py-16 text-center">
                    <span className="loading loading-spinner loading-lg text-primary" />
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={11 + (picking ? 1 : 0)}
                    className="bg-white px-4 py-12 text-center text-sm text-gray-500"
                    style={PIPELINE_CELL_STYLE}
                  >
                    No handler cases match your filters.
                  </td>
                </tr>
              ) : (
                filtered.map((row) => {
                  const soft = getSoftStageBadgeStyle(getStageColour(row.stage), row.stage);
                  return (
                    <tr
                      key={row.id}
                      className={pipelineRowClassName(isPipelineLeadPicked(row.id, selectedLeadId, selectedLeadIds))}
                      onClick={(e) =>
                        handlePipelineRowPick(
                          e,
                          toPipelineActionLead(row),
                          navigate,
                          { multiSelect, onSelectLead },
                        )
                      }
                      onAuxClick={(e) => {
                        if (e.button === 1) openLeadFromRowClick(e, row.navId, navigate);
                      }}
                    >
                      <PipelineRowPickCell
                        visible={picking}
                        selected={isPipelineLeadPicked(row.id, selectedLeadId, selectedLeadIds)}
                        name={row.name}
                        onPick={(e) => onSelectLead?.(toPipelineActionLead(row), e)}
                      />
                      <td className={PIPELINE_CELL_FIRST} style={PIPELINE_CELL_STYLE}>
                        <p className="flex items-center gap-1.5 font-mono text-xs font-bold text-gray-500">
                          #{row.lead_number}
                          {row.bucket === 'new' ? (
                            row.isFirstPaymentPaid ? (
                              <CheckCircleIcon className="h-6 w-6 shrink-0 text-green-500" title="Paid" />
                            ) : (
                              <XCircleIcon className="h-6 w-6 shrink-0 text-red-500" title="Not paid" />
                            )
                          ) : null}
                        </p>
                        <button
                          type="button"
                          className="block max-w-[14rem] text-left font-semibold leading-snug text-gray-900 hover:underline line-clamp-2 break-words"
                          title={row.name}
                          dir="auto"
                          onClick={(e) => {
                            e.stopPropagation();
                            openLeadFromRowClick(e, row.navId, navigate);
                          }}
                        >
                          {row.name}
                        </button>
                      </td>
                      <td className={`${PIPELINE_CELL_MID} text-gray-700`} style={PIPELINE_CELL_STYLE}>
                        <HandlerAssignedDateBadge
                          bucket={row.bucket}
                          assignedDate={row.assigned_date}
                          handlerAssignedDate={row.handlerAssignedDate}
                          stage105Date={row.stage105Date}
                          stage110Date={row.stage110Date}
                          previousHandlerName={row.previousHandlerName}
                        />
                      </td>
                      <td className={PIPELINE_CELL_MID} style={PIPELINE_CELL_STYLE}>
                        <PipelineFollowUpButton date={row.next_followup} onClick={(e) => openFollowUpModal(row, e)} />
                      </td>
                      <td className={`${PIPELINE_CELL_MID} max-w-[12rem] text-gray-700`} style={PIPELINE_CELL_STYLE}>
                        {row.category}
                      </td>
                      <td className={`${PIPELINE_CELL_MID} text-gray-700`} style={PIPELINE_CELL_STYLE}>
                        {row.language || '—'}
                      </td>
                      <td className={`${PIPELINE_CELL_MID} text-gray-700`} style={PIPELINE_CELL_STYLE}>
                        <HandlerCountryHoursDot row={row} countries={countries} />
                      </td>
                      <td className={`${PIPELINE_CELL_MID} text-gray-700`} style={PIPELINE_CELL_STYLE}>
                        {row.applicants ?? '—'}
                      </td>
                      <td className={`${PIPELINE_CELL_MID} font-semibold text-gray-800`} style={PIPELINE_CELL_STYLE}>
                        {formatPipelineMoney(row.value, row.currency)}
                      </td>
                      <td className={PIPELINE_CELL_MID} style={PIPELINE_CELL_STYLE}>
                        {row.stage ? (
                          <span
                            className="inline-flex max-w-[11rem] truncate rounded-full px-2.5 py-1 text-xs font-semibold"
                            style={{ backgroundColor: soft.backgroundColor, color: soft.color }}
                          >
                            {getStageName(row.stage)}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className={`${PIPELINE_CELL_MID} text-gray-700`} style={PIPELINE_CELL_STYLE}>
                        {row.retentionHandlerName || '—'}
                      </td>
                      <td className={PIPELINE_CELL_LAST} style={PIPELINE_CELL_STYLE}>
                        <HandlerActionsColumn row={row} handlers={actionHandlers} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      <HandlerCaseOverlays
        rmqTarget={rmqTarget}
        onCloseRmq={() => setRmqTarget(null)}
      />

      {editingFollowUp && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          onClick={closeFollowUpModal}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Follow-up date</h3>
                <p className="mt-1 text-sm text-gray-500">
                  {editingFollowUp.lead_number} · {editingFollowUp.name}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-circle"
                onClick={closeFollowUpModal}
                disabled={savingFollowUp}
                aria-label="Close"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <label className="mt-5 block text-sm font-medium text-gray-700" htmlFor="handler-follow-up-date">
              Your follow-up date
            </label>
            <input
              id="handler-follow-up-date"
              type="date"
              className="input input-bordered mt-2 w-full"
              value={followUpDraft}
              onChange={(e) => setFollowUpDraft(e.target.value)}
              disabled={savingFollowUp}
            />
            <p className="mt-2 text-xs text-gray-400">
              Leave empty and save to clear the date. Only you see this follow-up.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                className="btn btn-ghost rounded-full"
                onClick={closeFollowUpModal}
                disabled={savingFollowUp}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary rounded-full"
                onClick={() => void saveFollowUpDate()}
                disabled={savingFollowUp}
              >
                {savingFollowUp ? <span className="loading loading-spinner loading-sm" /> : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HandlerPipelineView;
