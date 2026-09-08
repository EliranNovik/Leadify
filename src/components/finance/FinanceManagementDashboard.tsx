import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowPathIcon,
  BanknotesIcon,
  BoltIcon,
  CalendarDaysIcon,
  ClipboardDocumentCheckIcon,
  ClockIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
  PaperAirplaneIcon,
  CheckCircleIcon,
  ReceiptPercentIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Link } from 'react-router-dom';
import {
  fetchFinanceFailedPaymentsToday,
  fetchFinanceInvoiceInstructions,
  fetchFinanceLastPaymentsToday,
  fetchFinanceManagementOverview,
  fetchFinancePaymentTrend,
  type FinanceFailedPaymentRow,
  type FinanceInvoiceInstructionRow,
  type FinanceLastPaymentRow,
  type FinanceOverviewSnapshot,
  type FinancePaymentTrendPoint,
} from '../../lib/financeManagementOverview';
import {
  financeFocusDefaultTab,
  type FinanceCollectionFocusId,
} from '../../lib/financeCollectionFocus';
import { useAuthContext } from '../../contexts/AuthContext';
import { getJerusalemTodayIsoDate } from '../../lib/boiCurrencyConversion';
import { getGreetingFirstName, getJerusalemTimeGreeting } from '../../lib/clockInGreeting';
import { usePersistedState } from '../../hooks/usePersistedState';
import { supabase } from '../../lib/supabase';

export type FinanceHubTabId =
  | 'dashboard'
  | 'collection'
  | 'collection-due'
  | 'signed'
  | 'expenses'
  | 'expense-entry';

type FinanceManagementDashboardProps = {
  onOpenTab: (tab: FinanceHubTabId, focus?: FinanceCollectionFocusId) => void;
  refreshKey?: number;
  /** All expenses KPIs / shortcuts — superuser only. */
  canViewExpenses?: boolean;
};

const EMPTY: FinanceOverviewSnapshot = {
  expensesThisMonthNis: 0,
  expensesMarketingNis: 0,
  expensesSalariesNis: 0,
  overdueUnpaidCount: 0,
  dueTodayCount: 0,
  signedMissingPaymentPlanCount: 0,
  dueUnsentProformaCount: 0,
  dueSentProformaCount: 0,
  dueNoProformaCount: 0,
  dueNext7DaysCount: 0,
  readyToPayUnpaidCount: 0,
  pendingWithProformaCount: 0,
  pendingWithoutProformaCount: 0,
  collectedTodayCount: 0,
  collectedThisMonthCount: 0,
  asOf: '',
};

const PAID_COLOR = '#059669';
const PENDING_WITH_PROFORMA_COLOR = '#0284c7';
const PENDING_WITHOUT_PROFORMA_COLOR = '#d97706';
const INVOICE_CREATED_COLOR = '#7c3aed';

type AttentionItem = {
  id: FinanceCollectionFocusId;
  label: string;
  hint: string;
  value: number;
  tone: 'danger' | 'warn' | 'info' | 'success' | 'neutral';
  icon: React.ElementType;
};

const ATTENTION_TONES: Record<
  AttentionItem['tone'],
  { card: string; icon: string; value: string; badge: string }
> = {
  danger: {
    card: 'bg-gradient-to-br from-rose-50 to-rose-50/40 hover:from-rose-100/80 hover:to-rose-50/60',
    icon: 'bg-rose-100 text-rose-700',
    value: 'text-rose-800',
    badge: 'bg-rose-100 text-rose-700',
  },
  warn: {
    card: 'bg-gradient-to-br from-amber-50 to-amber-50/40 hover:from-amber-100/80 hover:to-amber-50/60',
    icon: 'bg-amber-100 text-amber-700',
    value: 'text-amber-900',
    badge: 'bg-amber-100 text-amber-800',
  },
  info: {
    card: 'bg-gradient-to-br from-sky-50 to-sky-50/40 hover:from-sky-100/80 hover:to-sky-50/60',
    icon: 'bg-sky-100 text-sky-700',
    value: 'text-sky-900',
    badge: 'bg-sky-100 text-sky-800',
  },
  success: {
    card: 'bg-gradient-to-br from-emerald-50 to-emerald-50/40 hover:from-emerald-100/80 hover:to-emerald-50/60',
    icon: 'bg-emerald-100 text-emerald-700',
    value: 'text-emerald-900',
    badge: 'bg-emerald-100 text-emerald-800',
  },
  neutral: {
    card: 'bg-gradient-to-br from-gray-50 to-gray-50/40 hover:from-gray-100/80 hover:to-gray-50/60',
    icon: 'bg-gray-100 text-gray-600',
    value: 'text-gray-900',
    badge: 'bg-gray-100 text-gray-700',
  },
};

function BoxCount({
  value,
  loading,
  singular,
  plural,
}: {
  value: number;
  loading: boolean;
  singular: string;
  plural: string;
}) {
  const label = value === 1 ? singular : plural;
  return (
    <div className="flex shrink-0 items-baseline gap-2 self-start">
      <p className="text-4xl font-bold tabular-nums leading-none tracking-tight text-gray-900">
        {loading ? '—' : value}
      </p>
      <p className="text-sm font-medium text-gray-500">{label}</p>
    </div>
  );
}

function FinanceAmountText({
  currencySign,
  amountNumber,
  amountLabel,
  tone = 'default',
}: {
  currencySign?: string;
  amountNumber?: string;
  amountLabel?: string;
  tone?: 'default' | 'success' | 'danger';
}) {
  const color =
    tone === 'success' ? 'text-emerald-600' : tone === 'danger' ? 'text-rose-600' : 'text-gray-800';
  const text =
    amountNumber && amountNumber !== '—'
      ? `${currencySign || ''}${amountNumber}`
      : amountLabel || '—';
  return <span className={`whitespace-nowrap ${color}`}>{text}</span>;
}

function InvoiceInstructionTable({
  rows,
  loading,
  emptyText,
}: {
  rows: FinanceInvoiceInstructionRow[];
  loading: boolean;
  emptyText: string;
}) {
  if (loading && rows.length === 0) {
    return (
      <div className="flex h-24 items-center justify-center">
        <span className="loading loading-spinner loading-md text-blue-600" />
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
        <CheckCircleIcon className="h-7 w-7 text-emerald-500" />
        <p className="mt-2 text-sm text-gray-500">{emptyText}</p>
      </div>
    );
  }
  return (
    <div className="mt-3">
      <table className="min-w-full divide-y divide-gray-100 text-sm">
        <thead className="bg-white text-xs uppercase tracking-wide">
          <tr>
            <th className="px-1 py-2 text-left font-semibold text-gray-400">Lead</th>
            <th className="px-2 py-2 text-left font-semibold text-gray-400">Client</th>
            <th className="px-2 py-2 text-left font-semibold text-gray-400">Due</th>
            <th className="px-2 py-2 text-right font-semibold text-gray-400">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50 bg-white">
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-slate-50/80">
              <td className="px-1 py-2 align-top">
                <div className="min-w-0">
                  {row.leadNumber && row.href !== '/clients' ? (
                    <Link
                      to={row.href}
                      className="font-semibold text-sky-700 hover:text-sky-800 hover:underline"
                      title={`Open finances for ${row.leadNumber}`}
                    >
                      {row.leadNumber}
                    </Link>
                  ) : (
                    <span className="font-semibold text-gray-800">{row.leadNumber || '—'}</span>
                  )}
                  <p className="mt-0.5 text-[11px] uppercase tracking-wide text-gray-400">{row.orderLabel}</p>
                </div>
              </td>
              <td className="max-w-[12rem] px-2 py-2 align-top text-gray-800">
                <p className="truncate" title={row.clientName}>
                  {row.clientName || '—'}
                </p>
              </td>
              <td className="px-2 py-2 align-top">
                <p
                  className={`text-sm font-medium ${
                    row.daysAgo >= 3 ? 'text-rose-700' : row.daysAgo >= 1 ? 'text-amber-700' : 'text-gray-800'
                  }`}
                >
                  {row.dueLabel}
                </p>
              </td>
              <td className="whitespace-nowrap px-2 py-2 text-right align-top">
                <FinanceAmountText
                  currencySign={row.currencySign}
                  amountNumber={row.amountNumber}
                  amountLabel={row.amountLabel}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const FinanceManagementDashboard: React.FC<FinanceManagementDashboardProps> = ({
  onOpenTab,
  refreshKey = 0,
  canViewExpenses = false,
}) => {
  const { userFullName } = useAuthContext();
  const welcomeName = getGreetingFirstName(userFullName || '');
  const timeGreeting = getJerusalemTimeGreeting();
  const [snapshot, setSnapshot] = usePersistedState<FinanceOverviewSnapshot>(
    'financeDashboard_overview',
    EMPTY,
    { storage: 'sessionStorage', retainOnPageRefresh: true },
  );
  const [trend, setTrend] = usePersistedState<FinancePaymentTrendPoint[]>(
    'financeDashboard_trend',
    [],
    { storage: 'sessionStorage', retainOnPageRefresh: true },
  );
  const [lastPayments, setLastPayments] = usePersistedState<FinanceLastPaymentRow[]>(
    `financeDashboard_lastPayments_${getJerusalemTodayIsoDate()}`,
    [],
    { storage: 'sessionStorage', retainOnPageRefresh: true },
  );
  const [failedPayments, setFailedPayments] = usePersistedState<FinanceFailedPaymentRow[]>(
    `financeDashboard_failedPayments_${getJerusalemTodayIsoDate()}`,
    [],
    { storage: 'sessionStorage', retainOnPageRefresh: true },
  );
  const [invoiceInstructions, setInvoiceInstructions] = usePersistedState<FinanceInvoiceInstructionRow[]>(
    `financeDashboard_invoiceInstructions_${getJerusalemTodayIsoDate()}`,
    [],
    { storage: 'sessionStorage', retainOnPageRefresh: true },
  );
  const hadCachedSnapshotRef = useRef(Boolean(snapshot.asOf));
  const [loading, setLoading] = useState(!hadCachedSnapshotRef.current);
  const [trendLoading, setTrendLoading] = useState(!trend.length);
  const [lastPaymentsLoading, setLastPaymentsLoading] = useState(
    !lastPayments.length && !failedPayments.length,
  );
  const [instructionsLoading, setInstructionsLoading] = useState(!invoiceInstructions.length);

  const load = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!silent) {
      setLoading(true);
      setTrendLoading(true);
      setLastPaymentsLoading(true);
      setInstructionsLoading(true);
    }
    try {
      const [data, trendData, lastPaymentsData, failedPaymentsData, instructionsData] = await Promise.all([
        fetchFinanceManagementOverview(),
        fetchFinancePaymentTrend(30).catch((err) => {
          console.error('FinanceManagementDashboard trend:', err);
          return [] as FinancePaymentTrendPoint[];
        }),
        fetchFinanceLastPaymentsToday().catch((err) => {
          console.error('FinanceManagementDashboard last payments:', err);
          return [] as FinanceLastPaymentRow[];
        }),
        fetchFinanceFailedPaymentsToday().catch((err) => {
          console.error('FinanceManagementDashboard failed payments:', err);
          return [] as FinanceFailedPaymentRow[];
        }),
        fetchFinanceInvoiceInstructions().catch((err) => {
          console.error('FinanceManagementDashboard invoice instructions:', err);
          return [] as FinanceInvoiceInstructionRow[];
        }),
      ]);
      const next = !canViewExpenses
        ? { ...data, expensesThisMonthNis: 0, expensesMarketingNis: 0, expensesSalariesNis: 0 }
        : data;
      setSnapshot(next);
      setTrend(trendData);
      setLastPayments(lastPaymentsData);
      setFailedPayments(failedPaymentsData);
      setInvoiceInstructions(instructionsData);
    } catch (err) {
      console.error('FinanceManagementDashboard:', err);
      if (!silent) {
        setSnapshot(EMPTY);
        setTrend([]);
        setLastPayments([]);
        setFailedPayments([]);
        setInvoiceInstructions([]);
      }
    } finally {
      setLoading(false);
      setTrendLoading(false);
      setLastPaymentsLoading(false);
      setInstructionsLoading(false);
    }
  }, [canViewExpenses, setSnapshot, setTrend, setLastPayments, setFailedPayments, setInvoiceInstructions]);

  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    void loadRef.current({ silent: hadCachedSnapshotRef.current });
  }, [refreshKey]);

  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const triggerReload = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        void loadRef.current({ silent: true });
      }, 600);
    };

    const handleFocus = () => triggerReload();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') triggerReload();
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('paymentPlan:changed', triggerReload as EventListener);

    const channel = supabase
      .channel('finance-dashboard-kpis-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_plans' }, triggerReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'finances_paymentplanrow' }, triggerReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_links' }, triggerReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_transactions' }, triggerReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'proformainvoice' }, triggerReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads_leadstage' }, triggerReload)
      .subscribe();

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('paymentPlan:changed', triggerReload as EventListener);
      supabase.removeChannel(channel);
    };
  }, []);

  const attentionItems: AttentionItem[] = [
    {
      id: 'overdue',
      label: 'Overdue unpaid',
      hint: 'Past due in the last 30 days, still unpaid',
      value: snapshot.overdueUnpaidCount,
      tone: 'danger',
      icon: ExclamationTriangleIcon,
    },
    {
      id: 'due-today',
      label: 'Due today',
      hint: 'Unpaid rows due today',
      value: snapshot.dueTodayCount,
      tone: 'warn',
      icon: CalendarDaysIcon,
    },
    {
      id: 'due-7',
      label: 'Due next 7 days',
      hint: 'Unpaid due tomorrow through +7 days',
      value: snapshot.dueNext7DaysCount,
      tone: 'info',
      icon: ClockIcon,
    },
    {
      id: 'ready',
      label: 'Ready to pay',
      hint: 'Marked ready to pay, unpaid · last 30 days',
      value: snapshot.readyToPayUnpaidCount,
      tone: 'info',
      icon: BoltIcon,
    },
    {
      id: 'pending-proforma',
      label: 'Pending + proforma',
      hint: 'Unpaid with a proforma · last 30 days',
      value: snapshot.pendingWithProformaCount,
      tone: 'neutral',
      icon: DocumentTextIcon,
    },
    {
      id: 'pending-no-proforma',
      label: 'Pending, no proforma',
      hint: 'Unpaid without a proforma · last 30 days',
      value: snapshot.pendingWithoutProformaCount,
      tone: 'warn',
      icon: DocumentTextIcon,
    },
    {
      id: 'collected-today',
      label: 'Collected today',
      hint: 'Marked paid today',
      value: snapshot.collectedTodayCount,
      tone: 'success',
      icon: BanknotesIcon,
    },
  ];

  const attentionOpenCount = attentionItems.filter(
    (item) => item.id !== 'collected-today' && item.value > 0,
  ).length;

  const createProformaRows = useMemo(
    () => invoiceInstructions.filter((row) => row.kind === 'create_proforma'),
    [invoiceInstructions],
  );
  const sendInvoiceRows = useMemo(
    () => invoiceInstructions.filter((row) => row.kind === 'send_invoice'),
    [invoiceInstructions],
  );

  const kpiCards = [
    {
      id: 'signed-missing-plan',
      label: 'Signed, missing payment plan',
      value: loading ? '—' : String(snapshot.signedMissingPaymentPlanCount),
      icon: ClipboardDocumentCheckIcon,
      onClick: () => onOpenTab('signed', 'signed-missing-plan'),
      hint: 'No payment plan · last 30 days',
      gradient: 'bg-gradient-to-tr from-purple-600 via-indigo-600 to-blue-500',
    },
    {
      id: 'due-no-proforma',
      label: 'Due last 30 days, no proforma',
      value: loading ? '—' : String(snapshot.dueNoProformaCount),
      icon: DocumentTextIcon,
      onClick: () => onOpenTab('collection', 'due-no-proforma'),
      hint: 'Due date set, no proforma created',
      gradient: 'bg-gradient-to-tr from-pink-500 via-rose-500 to-orange-500',
    },
    {
      id: 'due-unsent-proforma',
      label: 'Due last 30 days, proforma not sent',
      value: loading ? '—' : String(snapshot.dueUnsentProformaCount),
      icon: PaperAirplaneIcon,
      onClick: () => onOpenTab('collection', 'due-unsent-proforma'),
      hint: 'Proforma on file, not sent by email or WhatsApp',
      gradient: 'bg-gradient-to-tr from-amber-500 via-orange-500 to-yellow-500',
    },
    {
      id: 'due-sent-proforma',
      label: 'Due last 30 days, pending (proforma sent)',
      value: loading ? '—' : String(snapshot.dueSentProformaCount),
      icon: CheckCircleIcon,
      onClick: () => onOpenTab('collection', 'due-sent-proforma'),
      hint: 'Proforma already sent · still unpaid',
      gradient: 'bg-gradient-to-tr from-teal-600 via-emerald-500 to-green-500',
    },
  ];

  const shortcuts: Array<{
    id: FinanceHubTabId;
    title: string;
    description: string;
    icon: React.ElementType;
  }> = [
    {
      id: 'collection',
      title: 'Collection',
      description: 'Track payment plan rows, invoices, and collection actions.',
      icon: BanknotesIcon,
    },
    {
      id: 'collection-due',
      title: 'Collection Due',
      description: 'Due amounts by employee and department for the selected period.',
      icon: ClockIcon,
    },
    {
      id: 'expense-entry' as const,
      title: 'Expenses',
      description: 'Add client, office, marketing, rent, firm, subcontractor, and partner-draw expenses.',
      icon: ReceiptPercentIcon,
    },
    ...(canViewExpenses
      ? [
          {
            id: 'expenses' as const,
            title: 'All expenses',
            description: 'Marketing, rent, salaries, office costs, and partner draws.',
            icon: ReceiptPercentIcon,
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-gray-900">
            {welcomeName ? `${timeGreeting}, ${welcomeName}` : timeGreeting}
          </h2>
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">
            Start with the boxes below first. Keep them at a low rate through the end of your shift.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-sm btn-outline gap-1.5"
          onClick={() => void load()}
          disabled={loading || trendLoading || lastPaymentsLoading || instructionsLoading}
        >
          {loading || trendLoading || lastPaymentsLoading || instructionsLoading ? (
            <span className="loading loading-spinner loading-xs" />
          ) : (
            <ArrowPathIcon className="h-4 w-4" />
          )}
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpiCards.map((card) => {
          const Icon = card.icon;
          return (
            <button
              key={card.id}
              type="button"
              onClick={card.onClick}
              className={`${card.gradient} flex min-h-[7rem] flex-col justify-between rounded-2xl p-4 text-left text-white shadow-xl transition-all duration-300 hover:scale-105 hover:shadow-2xl`}
              title={card.hint}
            >
              <div className="flex w-full items-start justify-between gap-3">
                <p className="text-4xl md:text-5xl font-bold leading-none tracking-tight">{card.value}</p>
                <div className="ml-auto shrink-0 rounded-full bg-white/20 p-3.5">
                  <Icon className="h-9 w-9 md:h-10 md:w-10" />
                </div>
              </div>
              <div className="min-w-0 mt-2">
                <p className="text-base md:text-lg font-semibold leading-snug">{card.label}</p>
                <p className="mt-0.5 truncate text-xs text-white/80" title={card.hint}>
                  {card.hint}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      <div className="rounded-2xl bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-2 mb-1">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-gray-400">Payment trend</p>
            <h3 className="text-base font-semibold text-gray-800 mt-1">Last 30 days</h3>
          </div>
          <p className="text-xs text-gray-500">Payment & invoice counts by day</p>
        </div>
        <div className="mt-3 h-[280px] w-full">
          {trendLoading ? (
            <div className="flex h-full items-center justify-center">
              <span className="loading loading-spinner loading-md text-blue-600" />
            </div>
          ) : trend.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-gray-400">
              No payment trend data available.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend} margin={{ top: 12, right: 16, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  tickLine={false}
                  interval="preserveStartEnd"
                  minTickGap={28}
                />
                <YAxis
                  allowDecimals={false}
                  width={40}
                  tick={{ fontSize: 12, fill: '#6b7280' }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  formatter={(value: number, name: string) => [value, name]}
                  labelFormatter={(label) => String(label)}
                  contentStyle={{
                    borderRadius: 12,
                    borderColor: '#e5e7eb',
                    fontSize: 13,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                <Line
                  type="monotone"
                  dataKey="paid"
                  name="Paid"
                  stroke={PAID_COLOR}
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: PAID_COLOR, strokeWidth: 0 }}
                  activeDot={{ r: 6 }}
                />
                <Line
                  type="monotone"
                  dataKey="pendingWithProforma"
                  name="Pending with proforma"
                  stroke={PENDING_WITH_PROFORMA_COLOR}
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: PENDING_WITH_PROFORMA_COLOR, strokeWidth: 0 }}
                  activeDot={{ r: 6 }}
                />
                <Line
                  type="monotone"
                  dataKey="pendingWithoutProforma"
                  name="Pending without proforma"
                  stroke={PENDING_WITHOUT_PROFORMA_COLOR}
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: PENDING_WITHOUT_PROFORMA_COLOR, strokeWidth: 0 }}
                  activeDot={{ r: 6 }}
                />
                <Line
                  type="monotone"
                  dataKey="invoiceCreated"
                  name="Invoice created"
                  stroke={INVOICE_CREATED_COLOR}
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: INVOICE_CREATED_COLOR, strokeWidth: 0 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="mb-1 flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-gray-400">Last payments</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <CheckCircleIcon className="h-8 w-8 text-emerald-600" />
                <h3 className="text-xl font-semibold text-gray-800">Paid</h3>
                <p className="text-xs text-gray-500">Today</p>
              </div>
            </div>
            <BoxCount
              value={lastPayments.length}
              loading={lastPaymentsLoading}
              singular="payment"
              plural="payments"
            />
          </div>
          <div className="mt-3">
            {lastPaymentsLoading && lastPayments.length === 0 ? (
              <div className="flex h-24 items-center justify-center">
                <span className="loading loading-spinner loading-md text-blue-600" />
              </div>
            ) : lastPayments.length === 0 ? (
              <div className="flex items-center justify-center py-10 text-sm text-gray-400">
                No payments collected today.
              </div>
            ) : (
              <table className="min-w-full divide-y divide-gray-100 text-sm">
                <thead className="text-xs uppercase tracking-wide">
                  <tr>
                    <th className="px-1 py-2 text-left font-semibold text-gray-400">Lead</th>
                    <th className="px-2 py-2 text-left font-semibold text-gray-400">Client</th>
                    <th className="px-2 py-2 text-left font-semibold text-gray-400">Paid by</th>
                    <th className="px-0 py-2 text-right font-semibold text-gray-400">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 bg-white">
                  {lastPayments.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50/80">
                      <td className="px-1 py-2 align-top">
                        {row.leadNumber && row.href !== '/clients' ? (
                          <Link
                            to={row.href}
                            className="font-semibold text-sky-700 hover:text-sky-800 hover:underline"
                            title={`Open client ${row.leadNumber}`}
                          >
                            {row.leadNumber}
                          </Link>
                        ) : (
                          <span className="font-semibold text-gray-800">{row.leadNumber || '—'}</span>
                        )}
                      </td>
                      <td className="max-w-[12rem] px-2 py-2 align-top text-gray-800">
                        <p className="truncate" title={row.clientName}>
                          {row.clientName || '—'}
                        </p>
                      </td>
                      <td className="px-2 py-2 align-top text-gray-700">{row.paidBy}</td>
                      <td className="whitespace-nowrap px-0 py-2 text-right align-top">
                        <FinanceAmountText
                          currencySign={row.currencySign}
                          amountNumber={row.amountNumber}
                          amountLabel={row.amountLabel}
                          tone="success"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="mb-1 flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-gray-400">Last payments</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <XCircleIcon className="h-8 w-8 text-rose-600" />
                <h3 className="text-xl font-semibold text-gray-800">Failed</h3>
                <p className="text-xs text-gray-500">Today</p>
              </div>
            </div>
            <BoxCount
              value={failedPayments.length}
              loading={lastPaymentsLoading}
              singular="failed payment"
              plural="failed payments"
            />
          </div>
          <div className="mt-3">
            {lastPaymentsLoading && failedPayments.length === 0 ? (
              <div className="flex h-24 items-center justify-center">
                <span className="loading loading-spinner loading-md text-blue-600" />
              </div>
            ) : failedPayments.length === 0 ? (
              <div className="flex items-center justify-center py-10 text-sm text-gray-400">
                No failed payments today.
              </div>
            ) : (
              <table className="min-w-full divide-y divide-gray-100 text-sm">
                <thead className="text-xs uppercase tracking-wide">
                  <tr>
                    <th className="px-1 py-2 text-left font-semibold text-gray-400">Lead</th>
                    <th className="px-2 py-2 text-left font-semibold text-gray-400">Client</th>
                    <th className="px-2 py-2 text-left font-semibold text-gray-400">Reason</th>
                    <th className="px-0 py-2 text-right font-semibold text-gray-400">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 bg-white">
                  {failedPayments.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50/80">
                      <td className="px-1 py-2 align-top">
                        {row.leadNumber && row.href !== '/clients' ? (
                          <Link
                            to={row.href}
                            className="font-semibold text-sky-700 hover:text-sky-800 hover:underline"
                            title={`Open client ${row.leadNumber}`}
                          >
                            {row.leadNumber}
                          </Link>
                        ) : (
                          <span className="font-semibold text-gray-800">{row.leadNumber || '—'}</span>
                        )}
                      </td>
                      <td className="max-w-[12rem] px-2 py-2 align-top text-gray-800">
                        <p className="truncate" title={row.clientName}>
                          {row.clientName || '—'}
                        </p>
                      </td>
                      <td className="px-2 py-2 align-top">
                        <p className="text-sm text-rose-700" title={row.errorReason}>
                          {row.errorReason}
                        </p>
                      </td>
                      <td className="whitespace-nowrap px-0 py-2 text-right align-top">
                        <FinanceAmountText
                          currencySign={row.currencySign}
                          amountNumber={row.amountNumber}
                          amountLabel={row.amountLabel}
                          tone="danger"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-gray-400">Invoice instructions</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <DocumentTextIcon className="h-8 w-8 text-amber-600" />
                <h3 className="text-xl font-semibold text-gray-800">Create proforma</h3>
                <p className="text-xs text-gray-500">Last 7 days · sent to finance · no proforma yet</p>
              </div>
            </div>
            <BoxCount
              value={createProformaRows.length}
              loading={instructionsLoading}
              singular="proforma"
              plural="proformas"
            />
          </div>
          <InvoiceInstructionTable
            rows={createProformaRows}
            loading={instructionsLoading}
            emptyText="No proformas to create for the last 7 days."
          />
        </div>

        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-gray-400">Invoice instructions</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <PaperAirplaneIcon className="h-8 w-8 text-sky-600" />
                <h3 className="text-xl font-semibold text-gray-800">Send invoice</h3>
                <p className="text-xs text-gray-500">Last 7 days · sent to finance · proforma not sent</p>
                <button
                  type="button"
                  className="btn btn-xs btn-outline rounded-lg"
                  onClick={() => onOpenTab('collection', 'due-invoice-instructions')}
                >
                  Collection
                </button>
              </div>
            </div>
            <BoxCount
              value={sendInvoiceRows.length}
              loading={instructionsLoading}
              singular="invoice"
              plural="invoices"
            />
          </div>
          <InvoiceInstructionTable
            rows={sendInvoiceRows}
            loading={instructionsLoading}
            emptyText="No invoices waiting to be sent for the last 7 days."
          />
        </div>
      </div>

      <div className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-gray-400">Attention</p>
              <h3 className="mt-1 text-base font-semibold text-gray-800">Collection focus</h3>
              <p className="mt-1 text-xs text-gray-500">
                {loading
                  ? 'Loading live counts…'
                  : attentionOpenCount === 0
                    ? 'No urgent unpaid items right now.'
                    : `${attentionOpenCount} area${attentionOpenCount === 1 ? '' : 's'} need follow-up.`}
              </p>
            </div>
            {!loading && attentionOpenCount > 0 ? (
              <span className="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-700">
                {attentionOpenCount} open
              </span>
            ) : null}
          </div>

          <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {attentionItems.map((item) => {
              const Icon = item.icon;
              const tone = ATTENTION_TONES[item.tone];
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onOpenTab(financeFocusDefaultTab(item.id), item.id)}
                  className={`rounded-xl p-3.5 text-left shadow-sm transition ${tone.card}`}
                  title={item.hint}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className={`inline-flex h-10 w-10 items-center justify-center rounded-lg ${tone.icon}`}
                    >
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${tone.badge}`}>
                      {financeFocusDefaultTab(item.id) === 'collection-due' ? 'Due' : 'Collection'}
                    </span>
                  </div>
                  <div className={`mt-2.5 text-2xl font-bold tabular-nums leading-none ${tone.value}`}>
                    {loading ? '—' : item.value.toLocaleString()}
                  </div>
                  <div className="mt-1.5 text-sm font-semibold text-gray-800">{item.label}</div>
                  <p className="mt-0.5 text-xs leading-snug text-gray-500">{item.hint}</p>
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              className="btn btn-sm flex-1 rounded-xl border-0 bg-gray-900 text-white hover:bg-gray-800 sm:flex-none"
              onClick={() => onOpenTab('collection-due')}
            >
              Open Collection Due
            </button>
            <button
              type="button"
              className="btn btn-sm btn-outline flex-1 rounded-xl sm:flex-none"
              onClick={() => onOpenTab('collection')}
            >
              Open Collection
            </button>
          </div>
        </div>

      <div>
        <h3 className="text-base font-semibold text-gray-800 mb-3">Reports</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {shortcuts.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onOpenTab(item.id)}
                className="rounded-2xl bg-white p-5 text-left shadow-sm transition"
              >
                <Icon className="h-8 w-8 text-blue-600 mb-3" />
                <div className="text-base font-semibold text-gray-900">{item.title}</div>
                <p className="text-sm text-gray-500 mt-1.5 leading-snug">{item.description}</p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default FinanceManagementDashboard;
