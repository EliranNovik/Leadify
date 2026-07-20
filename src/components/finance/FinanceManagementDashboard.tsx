import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowPathIcon,
  BanknotesIcon,
  BoltIcon,
  CalendarDaysIcon,
  ClockIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
  ReceiptPercentIcon,
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
import {
  fetchFinanceManagementOverview,
  fetchFinancePaymentTrend,
  formatNis,
  type FinanceOverviewSnapshot,
  type FinancePaymentTrendPoint,
} from '../../lib/financeManagementOverview';
import {
  financeFocusDefaultTab,
  type FinanceCollectionFocusId,
} from '../../lib/financeCollectionFocus';

export type FinanceHubTabId = 'dashboard' | 'collection' | 'collection-due' | 'signed' | 'expenses';

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

const FinanceManagementDashboard: React.FC<FinanceManagementDashboardProps> = ({
  onOpenTab,
  refreshKey = 0,
  canViewExpenses = false,
}) => {
  const [loading, setLoading] = useState(true);
  const [trendLoading, setTrendLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<FinanceOverviewSnapshot>(EMPTY);
  const [trend, setTrend] = useState<FinancePaymentTrendPoint[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setTrendLoading(true);
    try {
      const [data, trendData] = await Promise.all([
        fetchFinanceManagementOverview(),
        fetchFinancePaymentTrend(30).catch((err) => {
          console.error('FinanceManagementDashboard trend:', err);
          return [] as FinancePaymentTrendPoint[];
        }),
      ]);
      if (!canViewExpenses) {
        setSnapshot({
          ...data,
          expensesThisMonthNis: 0,
          expensesMarketingNis: 0,
          expensesSalariesNis: 0,
        });
      } else {
        setSnapshot(data);
      }
      setTrend(trendData);
    } catch (err) {
      console.error('FinanceManagementDashboard:', err);
      setSnapshot(EMPTY);
      setTrend([]);
    } finally {
      setLoading(false);
      setTrendLoading(false);
    }
  }, [canViewExpenses]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const attentionItems: AttentionItem[] = [
    {
      id: 'overdue',
      label: 'Overdue unpaid',
      hint: 'Past due and still unpaid',
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
      hint: 'Marked ready to pay, unpaid',
      value: snapshot.readyToPayUnpaidCount,
      tone: 'info',
      icon: BoltIcon,
    },
    {
      id: 'pending-proforma',
      label: 'Pending + proforma',
      hint: 'Unpaid with a proforma on file',
      value: snapshot.pendingWithProformaCount,
      tone: 'neutral',
      icon: DocumentTextIcon,
    },
    {
      id: 'pending-no-proforma',
      label: 'Pending, no proforma',
      hint: 'Unpaid without a proforma',
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

  const kpiCards = [
    {
      id: 'overdue',
      label: 'Overdue unpaid rows',
      value: loading ? '—' : String(snapshot.overdueUnpaidCount),
      icon: ExclamationTriangleIcon,
      onClick: () => onOpenTab('collection-due'),
      hint: 'Open Collection Due',
    },
    {
      id: 'due-today',
      label: 'Due today',
      value: loading ? '—' : String(snapshot.dueTodayCount),
      icon: CalendarDaysIcon,
      onClick: () => onOpenTab('collection'),
      hint: 'Open Collection',
    },
    {
      id: 'collected',
      label: 'Collected this month',
      value: loading ? '—' : String(snapshot.collectedThisMonthCount),
      icon: BanknotesIcon,
      onClick: () => onOpenTab('collection'),
      hint: 'Payment rows marked paid',
    },
    ...(canViewExpenses
      ? [
          {
            id: 'expenses',
            label: 'Expenses this month',
            value: loading ? '—' : formatNis(snapshot.expensesThisMonthNis),
            icon: ReceiptPercentIcon,
            onClick: () => onOpenTab('expenses'),
            hint: 'All expense categories',
          },
        ]
      : []),
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
          <h2 className="text-xl md:text-2xl font-bold text-gray-900">Finance dashboard</h2>
          <p className="text-sm text-gray-500 mt-1">
            {canViewExpenses
              ? `Snapshot of collection pressure and company expenses${snapshot.asOf ? ` · as of ${snapshot.asOf}` : ''}.`
              : `Snapshot of collection pressure${snapshot.asOf ? ` · as of ${snapshot.asOf}` : ''}.`}
          </p>
        </div>
        <button
          type="button"
          className="btn btn-sm btn-outline gap-1.5"
          onClick={() => void load()}
          disabled={loading || trendLoading}
        >
          {loading || trendLoading ? (
            <span className="loading loading-spinner loading-xs" />
          ) : (
            <ArrowPathIcon className="h-4 w-4" />
          )}
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpiCards.map((card) => (
          <button
            key={card.id}
            type="button"
            onClick={card.onClick}
            className="rounded-2xl bg-white border border-gray-200 p-5 md:p-6 text-left shadow-sm hover:border-blue-300 transition min-h-[7.5rem]"
            title={card.hint}
          >
            <div className="flex items-center justify-between gap-3 h-full">
              <div className="min-w-0">
                <div className="text-2xl md:text-3xl font-bold text-gray-900 leading-none tracking-tight truncate">
                  {card.value}
                </div>
                <div className="text-sm md:text-base font-semibold text-gray-600 mt-2.5 leading-snug">
                  {card.label}
                </div>
              </div>
              <card.icon className="w-10 h-10 md:w-11 md:h-11 text-blue-600/80 shrink-0" />
            </div>
          </button>
        ))}
      </div>

      {canViewExpenses ? (
        <div className="rounded-2xl bg-white border border-gray-200 p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wider text-gray-400">This month · expenses</p>
          <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-start sm:justify-start">
              <dt className="text-sm text-gray-600">Total</dt>
              <dd className="text-base font-semibold text-gray-900">
                {loading ? '—' : formatNis(snapshot.expensesThisMonthNis)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-start sm:justify-start">
              <dt className="text-sm text-gray-600">Marketing</dt>
              <dd className="text-base font-semibold text-gray-900">
                {loading ? '—' : formatNis(snapshot.expensesMarketingNis)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-start sm:justify-start">
              <dt className="text-sm text-gray-600">Salaries</dt>
              <dd className="text-base font-semibold text-gray-900">
                {loading ? '—' : formatNis(snapshot.expensesSalariesNis)}
              </dd>
            </div>
          </dl>
          <button
            type="button"
            className="btn btn-sm btn-primary mt-5 w-full sm:w-auto"
            onClick={() => onOpenTab('expenses')}
          >
            Open all expenses
          </button>
        </div>
      ) : null}

      <div className="rounded-2xl bg-white border border-gray-200 p-5 shadow-sm">
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

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {shortcuts.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onOpenTab(item.id)}
                className="rounded-2xl bg-white border border-gray-200 p-5 text-left shadow-sm hover:border-blue-300 transition"
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
