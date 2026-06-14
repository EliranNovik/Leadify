import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BanknotesIcon,
  ChartBarIcon,
  ChevronDownIcon,
  HomeModernIcon,
  MegaphoneIcon,
  ReceiptPercentIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  EXPENSE_CATEGORY_LABELS,
  EXPENSE_CATEGORY_ORDER,
  type ExpenseCategoryKey,
  buildFirmManagementSingleMonthChart,
  buildFirmManagementYearStackedChart,
  buildSourceMediaSingleMonthChart,
  buildSourceMediaYearStackedChart,
  type EntityBreakdownBarPoint,
  type EntityBreakdownStackedMonthPoint,
  fetchAllExpensesBreakdown,
  fetchFirmManagementCostsByFirm,
  fetchOfficeExpensesByFirm,
  fetchSourceMediaCostsBySource,
  formatNis,
  monthKeysForYearMonth,
  sumCategoryTotals,
  marketingExpenseTotal,
} from '../../lib/allExpensesReport';
import { usePersistedFilters } from '../../hooks/usePersistedState';
import AllExpensesTotalDetailModal from './expenses/AllExpensesTotalDetailModal';
import EmployeeSalariesDetailModal from './expenses/EmployeeSalariesDetailModal';
import MarketingExpensesDetailModal from './expenses/MarketingExpensesDetailModal';
import OfficeExpensesDetailModal from './expenses/OfficeExpensesDetailModal';
import OfficeRentExpensesDetailModal from './expenses/OfficeRentExpensesDetailModal';
import PartnerDrawsDetailModal from './expenses/PartnerDrawsDetailModal';

type SummaryDisplayKey = 'marketing' | ExpenseCategoryKey;

type OpenExpenseDetailModal = SummaryDisplayKey | 'total' | null;

const MARKETING_SUMMARY_COLOR = '#8b5cf6';

const SUMMARY_DISPLAY_ORDER: SummaryDisplayKey[] = [
  'marketing',
  'rent',
  'partner_draws',
  'salaries',
  'office',
];

const MONTH_OPTIONS = [
  { value: '', label: 'All months' },
  { value: '01', label: 'January' },
  { value: '02', label: 'February' },
  { value: '03', label: 'March' },
  { value: '04', label: 'April' },
  { value: '05', label: 'May' },
  { value: '06', label: 'June' },
  { value: '07', label: 'July' },
  { value: '08', label: 'August' },
  { value: '09', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' },
];

const CHART_COLORS: Record<ExpenseCategoryKey, string> = {
  source_media: '#8b5cf6',
  firm_management: '#6366f1',
  rent: '#0ea5e9',
  partner_draws: '#14b8a6',
  salaries: '#f59e0b',
  office: '#94a3b8',
};

const buildYearOptions = (currentYear: number): string[] => {
  const years: string[] = [];
  for (let y = currentYear + 1; y >= currentYear - 6; y -= 1) {
    years.push(String(y));
  }
  return years;
};

const Y_AXIS_WIDTH = 108;

const formatChartYAxisTick = (value: number): string => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return `₪${n.toLocaleString('he-IL', { maximumFractionDigits: 0 })}`;
};

type SummaryBoxTheme = {
  bg: string;
  border: string;
  title: string;
  subtitle: string;
  icon: string;
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
};

const SUMMARY_BOX_THEMES: Record<SummaryDisplayKey | 'total', SummaryBoxTheme> = {
  total: {
    bg: 'bg-[#f4ecff]',
    border: 'border-[#eadbff]',
    title: 'text-[#342b56]',
    subtitle: 'text-[#6d6791]',
    icon: 'text-[#8a63d2]',
    Icon: BanknotesIcon,
  },
  marketing: {
    bg: 'bg-[#f4ecff]',
    border: 'border-[#eadbff]',
    title: 'text-[#342b56]',
    subtitle: 'text-[#6d6791]',
    icon: 'text-[#8a63d2]',
    Icon: MegaphoneIcon,
  },
  rent: {
    bg: 'bg-[#eaf0ff]',
    border: 'border-[#d6e2ff]',
    title: 'text-[#2f3f7a]',
    subtitle: 'text-[#5f73a8]',
    icon: 'text-[#4b63c9]',
    Icon: HomeModernIcon,
  },
  partner_draws: {
    bg: 'bg-[#e8f8f2]',
    border: 'border-[#cfeede]',
    title: 'text-[#2a5f50]',
    subtitle: 'text-[#578874]',
    icon: 'text-[#2d947b]',
    Icon: UserGroupIcon,
  },
  salaries: {
    bg: 'bg-[#fff4e6]',
    border: 'border-[#fde4c3]',
    title: 'text-[#7a4a12]',
    subtitle: 'text-[#a67c3d]',
    icon: 'text-[#d97706]',
    Icon: BanknotesIcon,
  },
  office: {
    bg: 'bg-[#f1f5f9]',
    border: 'border-[#e2e8f0]',
    title: 'text-[#334155]',
    subtitle: 'text-[#64748b]',
    icon: 'text-[#64748b]',
    Icon: ReceiptPercentIcon,
  },
};

const PerEntityBreakdownChart: React.FC<{
  title: string;
  description: string;
  hasMonth: boolean;
  singleMonthChart: EntityBreakdownBarPoint[];
  yearChart: {
    chartData: EntityBreakdownStackedMonthPoint[];
    series: { key: string; fill: string }[];
  };
  showYearChart: boolean;
  emptyMonthMessage: string;
  emptyYearMessage: string;
  stackId: string;
}> = ({
  title,
  description,
  hasMonth,
  singleMonthChart,
  yearChart,
  showYearChart,
  emptyMonthMessage,
  emptyYearMessage,
  stackId,
}) => (
  <div className="overflow-visible rounded-xl border border-base-300 bg-base-100 p-4 pl-2 shadow-sm sm:pl-4">
    <h3 className="mb-1 text-lg font-semibold">{title}</h3>
    <p className="mb-4 text-sm text-base-content/50">{description}</p>
    {hasMonth ? (
      singleMonthChart.length === 0 ? (
        <p className="py-8 text-center text-sm text-base-content/50">{emptyMonthMessage}</p>
      ) : (
        <ResponsiveContainer width="100%" height={360}>
          <BarChart data={singleMonthChart} margin={{ top: 8, right: 16, left: 4, bottom: 72 }}>
            <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-28} textAnchor="end" height={88} />
            <YAxis
              width={Y_AXIS_WIDTH}
              tickMargin={6}
              tick={{ fontSize: 12 }}
              tickFormatter={formatChartYAxisTick}
            />
            <Tooltip formatter={(v: number) => formatNis(v)} />
            <Bar dataKey="amount" name="Amount" radius={[4, 4, 0, 0]}>
              {singleMonthChart.map(entry => (
                <Cell key={entry.name} fill={entry.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )
    ) : showYearChart ? (
      <ResponsiveContainer width="100%" height={400}>
        <BarChart data={yearChart.chartData} margin={{ top: 8, right: 16, left: 4, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} />
          <YAxis
            width={Y_AXIS_WIDTH}
            tickMargin={6}
            tick={{ fontSize: 12 }}
            tickFormatter={formatChartYAxisTick}
          />
          <Tooltip formatter={(v: number) => formatNis(v)} />
          <Legend />
          {yearChart.series.map(series => (
            <Bar key={series.key} dataKey={series.key} stackId={stackId} fill={series.fill} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    ) : (
      <p className="py-8 text-center text-sm text-base-content/50">{emptyYearMessage}</p>
    )}
  </div>
);

const ExpenseSummaryBox: React.FC<{
  label: string;
  amount: number;
  share?: number;
  note?: string;
  theme: SummaryBoxTheme;
  onClick?: () => void;
}> = ({ label, amount, share, note, theme, onClick }) => {
  const { Icon } = theme;
  const interactive = Boolean(onClick);
  const Tag = interactive ? 'button' : 'div';

  return (
    <Tag
      type={interactive ? 'button' : undefined}
      onClick={onClick}
      className={`relative h-32 w-full overflow-hidden rounded-2xl border p-5 text-left shadow-sm transition-all duration-300 ${theme.bg} ${theme.border} ${
        interactive ? 'cursor-pointer hover:scale-[1.02] hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40' : ''
      }`}
    >
      <div className="absolute -right-10 -top-10 h-28 w-28 rounded-full bg-white/40 blur-2xl" />
      <div className="relative flex h-full items-center gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-white bg-white/70 shadow-sm">
          <Icon className={`h-6 w-6 opacity-90 ${theme.icon}`} strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <div className={`truncate text-base font-extrabold leading-tight ${theme.title}`}>{label}</div>
          <div className={`mt-1 text-lg font-bold tabular-nums ${theme.title}`}>{formatNis(amount)}</div>
          <div className={`mt-0.5 text-xs font-medium ${theme.subtitle}`}>
            {share != null && share > 0 ? `${share.toFixed(1)}% of total` : note || '—'}
          </div>
        </div>
      </div>
      <ChartBarIcon
        className={`absolute bottom-2 right-2 h-7 w-10 opacity-20 ${theme.icon}`}
        strokeWidth={2}
      />
    </Tag>
  );
};

const AllExpensesReport: React.FC = () => {
  const now = new Date();
  const defaultYear = String(now.getFullYear());
  const defaultMonth = String(now.getMonth() + 1).padStart(2, '0');

  const [filters, setFilters] = usePersistedFilters('reports_allExpenses_filters', {
    year: defaultYear,
    month: defaultMonth,
  });

  const [loading, setLoading] = useState(false);
  const [monthlyRows, setMonthlyRows] = useState<Awaited<ReturnType<typeof fetchAllExpensesBreakdown>>>([]);
  const [firmManagementRows, setFirmManagementRows] = useState<
    Awaited<ReturnType<typeof fetchFirmManagementCostsByFirm>>
  >([]);
  const [sourceMediaRows, setSourceMediaRows] = useState<
    Awaited<ReturnType<typeof fetchSourceMediaCostsBySource>>
  >([]);
  const [officeExpenseRows, setOfficeExpenseRows] = useState<
    Awaited<ReturnType<typeof fetchOfficeExpensesByFirm>>
  >([]);
  const [summaryTableOpen, setSummaryTableOpen] = useState(false);
  const [openDetailModal, setOpenDetailModal] = useState<OpenExpenseDetailModal>(null);

  const yearOptions = useMemo(() => buildYearOptions(now.getFullYear()), [now]);

  const monthKeys = useMemo(
    () => monthKeysForYearMonth(filters.year, filters.month),
    [filters.year, filters.month],
  );

  const periodLabel = useMemo(() => {
    if (!filters.month) return filters.year;
    const opt = MONTH_OPTIONS.find(o => o.value === filters.month);
    return `${opt?.label ?? filters.month} ${filters.year}`;
  }, [filters.year, filters.month]);

  const load = useCallback(async () => {
    if (!filters.year) return;
    setLoading(true);
    try {
      const [rows, firmRows, sourceRows, officeRows] = await Promise.all([
        fetchAllExpensesBreakdown(monthKeys),
        fetchFirmManagementCostsByFirm(monthKeys),
        fetchSourceMediaCostsBySource(monthKeys),
        fetchOfficeExpensesByFirm(monthKeys),
      ]);
      setMonthlyRows(rows);
      setFirmManagementRows(firmRows);
      setSourceMediaRows(sourceRows);
      setOfficeExpenseRows(officeRows);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load expenses');
      setMonthlyRows([]);
      setFirmManagementRows([]);
      setSourceMediaRows([]);
      setOfficeExpenseRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.year, monthKeys]);

  useEffect(() => {
    load();
  }, [load]);

  const categoryTotals = useMemo(() => sumCategoryTotals(monthlyRows), [monthlyRows]);
  const grandTotal = useMemo(
    () =>
      EXPENSE_CATEGORY_ORDER.reduce((sum, key) => sum + categoryTotals[key], 0) +
      categoryTotals.firm_management_marketing,
    [categoryTotals],
  );

  const marketingAmount = useMemo(
    () => marketingExpenseTotal(categoryTotals),
    [categoryTotals],
  );

  const summaryDisplayRows = useMemo(() => {
    const rows: {
      key: SummaryDisplayKey;
      label: string;
      amount: number;
      share: number;
      color: string;
    }[] = [
      {
        key: 'marketing',
        label: 'Marketing',
        amount: marketingAmount,
        share: grandTotal > 0 ? (marketingAmount / grandTotal) * 100 : 0,
        color: MARKETING_SUMMARY_COLOR,
      },
      ...SUMMARY_DISPLAY_ORDER.filter(k => k !== 'marketing').map(key => ({
        key,
        label: EXPENSE_CATEGORY_LABELS[key],
        amount: categoryTotals[key],
        share: grandTotal > 0 ? (categoryTotals[key] / grandTotal) * 100 : 0,
        color: CHART_COLORS[key],
      })),
    ];
    return rows;
  }, [categoryTotals, grandTotal, marketingAmount]);

  const categoryBarData = useMemo(
    () =>
      summaryDisplayRows
        .filter(r => r.amount > 0)
        .map(r => ({
          name: r.label,
          amount: r.amount,
          fill: r.color,
        })),
    [summaryDisplayRows],
  );

  const monthlyTrendData = useMemo(
    () =>
      monthlyRows.map(row => ({
        name: row.label,
        total: row.totalNis,
        ...Object.fromEntries(
          EXPENSE_CATEGORY_ORDER.map(key => [EXPENSE_CATEGORY_LABELS[key], row.totals[key]]),
        ),
      })),
    [monthlyRows],
  );

  const showStackedMonthly = !filters.month && monthlyTrendData.length > 1;

  const firmManagementSingleMonthChart = useMemo(() => {
    if (!filters.month || monthKeys.length !== 1) return [];
    return buildFirmManagementSingleMonthChart(firmManagementRows, monthKeys[0]);
  }, [firmManagementRows, filters.month, monthKeys]);

  const firmManagementYearChart = useMemo(() => {
    if (filters.month) return { chartData: [], firmSeries: [] as { key: string; fill: string }[] };
    return buildFirmManagementYearStackedChart(firmManagementRows, monthKeys);
  }, [firmManagementRows, filters.month, monthKeys]);

  const hasFirmManagementData = firmManagementRows.some(r => r.amountNis > 0);
  const showFirmManagementYearChart = !filters.month && hasFirmManagementData;

  const sourceMediaSingleMonthChart = useMemo(() => {
    if (!filters.month || monthKeys.length !== 1) return [];
    return buildSourceMediaSingleMonthChart(sourceMediaRows, monthKeys[0]);
  }, [sourceMediaRows, filters.month, monthKeys]);

  const sourceMediaYearChart = useMemo(() => {
    if (filters.month) return { chartData: [], series: [] as { key: string; fill: string }[] };
    return buildSourceMediaYearStackedChart(sourceMediaRows, monthKeys);
  }, [sourceMediaRows, filters.month, monthKeys]);

  const hasSourceMediaData = sourceMediaRows.some(r => r.amountNis > 0);
  const showSourceMediaYearChart = !filters.month && hasSourceMediaData;

  const officeExpensesSingleMonthChart = useMemo(() => {
    if (!filters.month || monthKeys.length !== 1) return [];
    return buildFirmManagementSingleMonthChart(officeExpenseRows, monthKeys[0]);
  }, [officeExpenseRows, filters.month, monthKeys]);

  const officeExpensesYearChart = useMemo(() => {
    if (filters.month) return { chartData: [], firmSeries: [] as { key: string; fill: string }[] };
    return buildFirmManagementYearStackedChart(officeExpenseRows, monthKeys);
  }, [officeExpenseRows, filters.month, monthKeys]);

  const hasOfficeExpensesData = officeExpenseRows.some(r => r.amountNis > 0);
  const showOfficeExpensesYearChart = !filters.month && hasOfficeExpensesData;

  const officeYearChartForView = useMemo(
    () => ({
      chartData: officeExpensesYearChart.chartData,
      series: officeExpensesYearChart.firmSeries,
    }),
    [officeExpensesYearChart],
  );

  const firmYearChartForView = useMemo(
    () => ({
      chartData: firmManagementYearChart.chartData,
      series: firmManagementYearChart.firmSeries,
    }),
    [firmManagementYearChart],
  );

  return (
    <div className="space-y-8 pb-8">
      <div>
        <div className="mb-4 flex flex-wrap items-end gap-x-3 gap-y-2">
          <h3 className="text-lg font-semibold">Summary — {periodLabel}</h3>
          <div className="flex flex-wrap items-end gap-2 sm:gap-3">
            <label className="form-control min-w-[7rem] w-[7rem] sm:w-32">
              <span className="label-text text-xs font-medium">Year</span>
              <select
                className="select select-bordered select-sm w-full"
                value={filters.year}
                onChange={e => setFilters({ ...filters, year: e.target.value })}
              >
                {yearOptions.map(y => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-control min-w-[9rem] w-[9rem] sm:w-40">
              <span className="label-text text-xs font-medium">Month</span>
              <select
                className="select select-bordered select-sm w-full"
                value={filters.month}
                onChange={e => setFilters({ ...filters, month: e.target.value })}
              >
                {MONTH_OPTIONS.map(opt => (
                  <option key={opt.value || 'all'} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn btn-sm btn-primary" onClick={load} disabled={loading}>
              {loading ? <span className="loading loading-spinner loading-xs" /> : 'Refresh'}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm gap-2"
              onClick={() => setSummaryTableOpen(open => !open)}
              aria-expanded={summaryTableOpen}
            >
              {summaryTableOpen ? 'Hide breakdown table' : 'Show breakdown table'}
              <ChevronDownIcon
                className={`h-4 w-4 transition-transform ${summaryTableOpen ? 'rotate-180' : ''}`}
              />
            </button>
          </div>
        </div>

        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
          <ExpenseSummaryBox
            label="Total"
            amount={grandTotal}
            note={grandTotal > 0 ? 'All categories' : undefined}
            theme={SUMMARY_BOX_THEMES.total}
            onClick={() => setOpenDetailModal('total')}
          />
          {summaryDisplayRows.map(row => (
            <ExpenseSummaryBox
              key={row.key}
              label={row.label}
              amount={row.amount}
              share={grandTotal > 0 ? row.share : undefined}
              theme={SUMMARY_BOX_THEMES[row.key]}
              onClick={() => setOpenDetailModal(row.key)}
            />
          ))}
        </div>

        {summaryTableOpen ? (
          <div className="overflow-x-auto rounded-xl border border-base-300/60 bg-base-100/50 p-2">
            <table className="table w-full border-0 text-base [&_td]:border-0 [&_th]:border-0">
              <thead>
                <tr className="text-base">
                  <th className="text-base">Category</th>
                  <th className="text-right text-base">Amount (₪)</th>
                  <th className="text-right text-base">Share</th>
                </tr>
              </thead>
              <tbody>
                {summaryDisplayRows.map(row => (
                  <tr key={row.key} className="text-base">
                    <td>
                      <span
                        className="mr-2 inline-block h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: row.color }}
                      />
                      {row.label}
                    </td>
                    <td className="text-right">{formatNis(row.amount)}</td>
                    <td className="text-right">
                      {grandTotal > 0 ? `${row.share.toFixed(1)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="text-base font-semibold">
                  <td>Total</td>
                  <td className="text-right">{formatNis(grandTotal)}</td>
                  <td className="text-right">100%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : null}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <span className="loading loading-spinner loading-lg text-primary" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-8">
          <div className="overflow-visible rounded-xl border border-base-300 bg-base-100 p-4 pl-2 shadow-sm sm:pl-4">
            <h3 className="mb-4 text-lg font-semibold">By category</h3>
            {categoryBarData.length === 0 ? (
              <p className="py-8 text-center text-sm text-base-content/50">No expense data for this period.</p>
            ) : (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={categoryBarData} margin={{ top: 8, right: 16, left: 4, bottom: 64 }}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-28} textAnchor="end" height={72} />
                  <YAxis
                    width={Y_AXIS_WIDTH}
                    tickMargin={6}
                    tick={{ fontSize: 12 }}
                    tickFormatter={formatChartYAxisTick}
                  />
                  <Tooltip formatter={(v: number) => formatNis(v)} />
                  <Bar dataKey="amount" name="Amount" radius={[4, 4, 0, 0]}>
                    {categoryBarData.map(entry => (
                      <Cell key={entry.name} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="overflow-visible rounded-xl border border-base-300 bg-base-100 p-4 pl-2 shadow-sm sm:pl-4">
            <h3 className="mb-4 text-lg font-semibold">
              {showStackedMonthly ? 'Monthly trend (stacked)' : 'Monthly total'}
            </h3>
            {monthlyTrendData.length === 0 ? (
              <p className="py-8 text-center text-sm text-base-content/50">No expense data for this period.</p>
            ) : showStackedMonthly ? (
              <ResponsiveContainer width="100%" height={360}>
                <BarChart data={monthlyTrendData} margin={{ top: 8, right: 16, left: 4, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis
                    width={Y_AXIS_WIDTH}
                    tickMargin={6}
                    tick={{ fontSize: 12 }}
                    tickFormatter={formatChartYAxisTick}
                  />
                  <Tooltip formatter={(v: number) => formatNis(v)} />
                  <Legend />
                  {EXPENSE_CATEGORY_ORDER.map(key => (
                    <Bar
                      key={key}
                      dataKey={EXPENSE_CATEGORY_LABELS[key]}
                      stackId="expenses"
                      fill={CHART_COLORS[key]}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={monthlyTrendData} margin={{ top: 8, right: 16, left: 4, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis
                    width={Y_AXIS_WIDTH}
                    tickMargin={6}
                    tick={{ fontSize: 12 }}
                    tickFormatter={formatChartYAxisTick}
                  />
                  <Tooltip formatter={(v: number) => formatNis(v)} />
                  <Line
                    type="monotone"
                    dataKey="total"
                    name="Total"
                    stroke="#8b5cf6"
                    strokeWidth={2}
                    dot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          <PerEntityBreakdownChart
            title="Firm management costs by firm"
            description={
              filters.month
                ? `Per supplier for ${periodLabel}`
                : `Monthly breakdown by supplier for ${periodLabel}`
            }
            hasMonth={Boolean(filters.month)}
            singleMonthChart={firmManagementSingleMonthChart}
            yearChart={firmYearChartForView}
            showYearChart={showFirmManagementYearChart}
            emptyMonthMessage="No firm management costs for this month."
            emptyYearMessage="No firm management costs for this year."
            stackId="firms"
          />

          <PerEntityBreakdownChart
            title="Source media costs by source"
            description={
              filters.month
                ? `Per lead source for ${periodLabel}`
                : `Monthly breakdown by lead source for ${periodLabel}`
            }
            hasMonth={Boolean(filters.month)}
            singleMonthChart={sourceMediaSingleMonthChart}
            yearChart={sourceMediaYearChart}
            showYearChart={showSourceMediaYearChart}
            emptyMonthMessage="No source media costs for this month."
            emptyYearMessage="No source media costs for this year."
            stackId="sources"
          />

          <PerEntityBreakdownChart
            title="Office expenses by firm"
            description={
              filters.month
                ? `Per firm for ${periodLabel} (by created date)`
                : `Monthly breakdown by firm for ${periodLabel} (by created date)`
            }
            hasMonth={Boolean(filters.month)}
            singleMonthChart={officeExpensesSingleMonthChart}
            yearChart={officeYearChartForView}
            showYearChart={showOfficeExpensesYearChart}
            emptyMonthMessage="No office expenses for this month."
            emptyYearMessage="No office expenses for this year."
            stackId="office-firms"
          />
        </div>
      )}

      <AllExpensesTotalDetailModal
        open={openDetailModal === 'total'}
        onClose={() => setOpenDetailModal(null)}
        year={filters.year}
        month={filters.month}
        grandTotal={grandTotal}
        rows={summaryDisplayRows}
      />
      <MarketingExpensesDetailModal
        open={openDetailModal === 'marketing'}
        onClose={() => setOpenDetailModal(null)}
        year={filters.year}
        month={filters.month}
      />
      <OfficeRentExpensesDetailModal
        open={openDetailModal === 'rent'}
        onClose={() => setOpenDetailModal(null)}
        year={filters.year}
        month={filters.month}
      />
      <PartnerDrawsDetailModal
        open={openDetailModal === 'partner_draws'}
        onClose={() => setOpenDetailModal(null)}
        year={filters.year}
        month={filters.month}
      />
      <EmployeeSalariesDetailModal
        open={openDetailModal === 'salaries'}
        onClose={() => setOpenDetailModal(null)}
        year={filters.year}
        month={filters.month}
      />
      <OfficeExpensesDetailModal
        open={openDetailModal === 'office'}
        onClose={() => {
          setOpenDetailModal(null);
          void load();
        }}
        year={filters.year}
        month={filters.month}
      />
    </div>
  );
};

export default AllExpensesReport;
