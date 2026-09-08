import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowPathIcon,
  BanknotesIcon,
  BoltIcon,
  CalendarDaysIcon,
  ChevronDownIcon,
  ClipboardDocumentCheckIcon,
  ClockIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
  PaperAirplaneIcon,
  CheckCircleIcon,
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
import { Link } from 'react-router-dom';
import {
  fetchFinanceFailedPaymentsToday,
  fetchFinanceInvoiceInstructions,
  fetchFinanceLastPaymentsToday,
  fetchFinanceManagementOverview,
  fetchFinancePaymentTrend,
  resolveFinanceDateRange,
  type FinanceDateRange,
  type FinanceFailedPaymentRow,
  type FinanceInvoiceInstructionRow,
  type FinanceLastPaymentRow,
  type FinanceOverviewSnapshot,
  type FinancePaymentTrendPoint,
} from '../../lib/financeManagementOverview';
import { last7DaysRange } from '../../lib/paymentRequestEmail';
import { buildPaymentLinkPublicUrl } from '../../lib/proformaPaymentLink';
import { getJerusalemDateFromTimestamp, getJerusalemTodayIsoDate } from '../../lib/boiCurrencyConversion';
import { isPelecardApprovedCode } from '../../lib/pelecardErrors';
import toast from 'react-hot-toast';
import {
  financeFocusDefaultTab,
  type FinanceCollectionFocusId,
} from '../../lib/financeCollectionFocus';
import { useAuthContext } from '../../contexts/AuthContext';
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

function sameDateRange(a: FinanceDateRange, b: FinanceDateRange): boolean {
  return a.from === b.from && a.to === b.to;
}

function formatCompactDay(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) return iso;
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatRangeLabel(range: FinanceDateRange): string {
  if (range.from === range.to) return formatCompactDay(range.from);
  const from = formatCompactDay(range.from).replace(/, \d{4}$/, '');
  return `${from} – ${formatCompactDay(range.to)}`;
}

function formatNisTotal(rows: Array<{ amountNis?: number }>): string {
  const total = rows.reduce((sum, row) => {
    const value = Number(row.amountNis);
    return Number.isFinite(value) && value > 0 ? sum + value : sum;
  }, 0);
  if (total <= 0) return '';
  return `₪${Math.round(total).toLocaleString('en-US')}`;
}

function formatAttemptTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    const day = String(iso).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(day) ? formatCompactDay(day) : '—';
  }
  const day = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem',
    day: '2-digit',
    month: 'short',
  }).format(date);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
  const today = getJerusalemTodayIsoDate();
  const key = getJerusalemDateFromTimestamp(iso);
  return key === today ? time : `${day}, ${time}`;
}

function CompactDateRange({
  value,
  onChange,
}: {
  value: FinanceDateRange;
  onChange: (next: FinanceDateRange) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        className="inline-flex h-8 items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
        onClick={() => setOpen((prev) => !prev)}
      >
        {formatRangeLabel(value)}
        <ChevronDownIcon className="h-3.5 w-3.5 text-gray-400" />
      </button>
      {open ? (
        <div className="absolute right-0 z-30 mt-1 w-[17.5rem] rounded-xl border border-gray-100 bg-white p-3 shadow-lg">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">From</span>
              <input
                type="date"
                className="input input-bordered input-xs h-8 bg-white text-xs"
                value={value.from}
                max={value.to}
                onChange={(event) =>
                  onChange(resolveFinanceDateRange({ from: event.target.value, to: value.to }, value))
                }
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">To</span>
              <input
                type="date"
                className="input input-bordered input-xs h-8 bg-white text-xs"
                value={value.to}
                min={value.from}
                onChange={(event) =>
                  onChange(resolveFinanceDateRange({ from: value.from, to: event.target.value }, value))
                }
              />
            </label>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function rangeEmptyText(range: FinanceDateRange, todayText: string, rangeText: string): string {
  const today = getJerusalemTodayIsoDate();
  return range.from === today && range.to === today ? todayText : rangeText;
}

function FinanceAmountText({
  currencySign,
  amountNumber,
  amountLabel,
}: {
  currencySign?: string;
  amountNumber?: string;
  amountLabel?: string;
}) {
  const text =
    amountNumber && amountNumber !== '—'
      ? `${currencySign || ''}${amountNumber}`
      : amountLabel || '—';
  return <span className="whitespace-nowrap text-gray-900">{text}</span>;
}

function failureKind(row: FinanceFailedPaymentRow): 'card' | 'bank' | 'other' {
  const text = `${row.errorTitle || row.errorReason} ${row.paymentMethod || ''}`.toLowerCase();
  if (text.includes('bank') || text.includes('transfer')) return 'bank';
  if (text.includes('card') || text.includes('declined') || text.includes('pelecard')) return 'card';
  return 'other';
}

function failureChipClass(kind: 'card' | 'bank' | 'other'): string {
  if (kind === 'bank') return 'bg-amber-50 text-amber-800';
  if (kind === 'card') return 'bg-rose-50 text-rose-700';
  return 'bg-gray-100 text-gray-700';
}

type FailedPaymentGroup = {
  key: string;
  clientName: string;
  leadNumber: string;
  href: string;
  currencySign: string;
  amountNumber: string;
  amountLabel: string;
  amountValue: number;
  amountNis: number;
  title: string;
  detail: string;
  code: string | null;
  method: string;
  kind: 'card' | 'bank' | 'other';
  secureToken: string | null;
  lastAt: string;
  attempts: FinanceFailedPaymentRow[];
};

function groupFailedPayments(rows: FinanceFailedPaymentRow[]): FailedPaymentGroup[] {
  const groups = new Map<string, FailedPaymentGroup>();
  for (const row of rows) {
    const key = [
      row.leadNumber || row.href,
      row.clientName,
      row.currencySign,
      Math.round(row.amountValue || 0) || row.amountNumber,
    ].join('|');
    const existing = groups.get(key);
    if (existing) {
      existing.attempts.push(row);
      if (String(row.failedAt) > String(existing.lastAt)) {
        existing.lastAt = row.failedAt;
        existing.amountNis = row.amountNis || existing.amountNis;
        existing.title = row.errorTitle || existing.title;
        existing.detail = row.errorDetail || existing.detail;
        existing.code = row.errorCode || existing.code;
        existing.secureToken = row.secureToken || existing.secureToken;
      }
      continue;
    }
    groups.set(key, {
      key,
      clientName: row.clientName,
      leadNumber: row.leadNumber,
      href: row.href,
      currencySign: row.currencySign,
      amountNumber: row.amountNumber,
      amountLabel: row.amountLabel,
      amountValue: row.amountValue || 0,
      amountNis: row.amountNis || 0,
      title: row.errorTitle || row.errorReason || 'Payment failed',
      detail: row.errorDetail || '',
      code: row.errorCode,
      method: row.paymentMethod || '',
      kind: failureKind(row),
      secureToken: row.secureToken,
      lastAt: row.failedAt,
      attempts: [row],
    });
  }
  return [...groups.values()];
}

async function copyPaymentLink(token: string) {
  const url = buildPaymentLinkPublicUrl(token);
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    toast.success('Payment link copied');
  } catch {
    toast.error('Could not copy payment link');
  }
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
}

function parseDisplayedAmount(row: { amountValue?: number; amountNumber?: string }): number {
  if (typeof row.amountValue === 'number' && Number.isFinite(row.amountValue)) return row.amountValue;
  const parsed = Number(String(row.amountNumber || '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function DashboardBoxHeader({
  title,
  money,
  summary,
  range,
  onRangeChange,
  moneyTone = 'neutral',
  extra,
}: {
  title: string;
  money: string;
  summary: string;
  range: FinanceDateRange;
  onRangeChange: (next: FinanceDateRange) => void;
  moneyTone?: 'neutral' | 'success' | 'danger';
  extra?: React.ReactNode;
}) {
  const moneyClass =
    moneyTone === 'success' ? 'text-emerald-700' : moneyTone === 'danger' ? 'text-rose-800' : 'text-gray-900';
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          {extra}
        </div>
        <p className={`mt-1.5 text-lg font-semibold tabular-nums leading-tight ${money ? moneyClass : 'text-gray-300'}`}>
          {money || '—'}
        </p>
        <p className="mt-0.5 text-xs text-gray-500">{summary}</p>
      </div>
      <CompactDateRange value={range} onChange={onRangeChange} />
    </div>
  );
}

function BoxToolbar({ children }: { children: React.ReactNode }) {
  return <div className="mt-3 flex flex-wrap items-center gap-2">{children}</div>;
}

function BoxSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="flex h-8 w-44 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2">
      <MagnifyingGlassIcon className="h-4 w-4 shrink-0 text-gray-400" />
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-xs text-gray-800 outline-none placeholder:text-gray-400 focus:outline-none focus:ring-0"
      />
    </label>
  );
}

function BoxSelect({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="select select-bordered select-xs h-8 min-h-8 rounded-lg border-gray-200 bg-white text-xs font-medium"
    >
      {children}
    </select>
  );
}

function CardFooter({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 border-t border-gray-50 pt-3 text-xs text-gray-500">{children}</p>;
}

function ClientLeadCell({
  name,
  leadNumber,
  href,
  extra,
}: {
  name: string;
  leadNumber: string;
  href: string;
  extra?: React.ReactNode;
}) {
  const body = (
    <>
      <p className="truncate font-medium text-gray-900" title={name}>
        {name || '—'}
      </p>
      {leadNumber ? <p className="mt-0.5 text-[11px] text-gray-400">Lead {leadNumber}</p> : null}
      {extra}
    </>
  );
  if (href && href !== '/clients') {
    return (
      <Link
        to={href}
        className="block min-w-0 hover:opacity-80"
        title={`Open ${leadNumber || name}`}
        onClick={(event) => event.stopPropagation()}
      >
        {body}
      </Link>
    );
  }
  return <div className="min-w-0">{body}</div>;
}

function TableEmpty({ loading, text }: { loading: boolean; text: string }) {
  if (loading) {
    return (
      <div className="flex h-24 items-center justify-center">
        <span className="loading loading-spinner loading-md text-blue-600" />
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
      <CheckCircleIcon className="h-7 w-7 text-emerald-500" />
      <p className="mt-2 text-sm text-gray-500">{text}</p>
    </div>
  );
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
    return <TableEmpty loading text={emptyText} />;
  }
  if (rows.length === 0) {
    return <TableEmpty loading={false} text={emptyText} />;
  }
  return (
    <div className="mt-3">
      <table className="min-w-full divide-y divide-gray-100 text-sm">
        <thead className="bg-white text-xs uppercase tracking-wide">
          <tr>
            <th className="px-1 py-2 text-left font-semibold text-gray-400">Client</th>
            <th className="px-2 py-2 text-left font-semibold text-gray-400">Due</th>
            <th className="px-2 py-2 text-right font-semibold text-gray-400">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50 bg-white">
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-slate-50/80">
              <td className="max-w-[14rem] px-1 py-2.5 align-top">
                <ClientLeadCell
                  name={row.clientName}
                  leadNumber={row.leadNumber}
                  href={row.href}
                  extra={
                    row.orderLabel ? (
                      <p className="mt-0.5 text-[11px] uppercase tracking-wide text-gray-400">{row.orderLabel}</p>
                    ) : null
                  }
                />
              </td>
              <td className="px-2 py-2.5 align-top">
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
                    row.daysAgo >= 3
                      ? 'bg-rose-50 text-rose-600'
                      : row.daysAgo >= 1
                        ? 'bg-amber-50 text-amber-700'
                        : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {row.dueLabel}
                </span>
              </td>
              <td className="whitespace-nowrap px-2 py-2.5 text-right align-top">
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

function PaidPaymentsTable({
  rows,
  loading,
  emptyText,
}: {
  rows: FinanceLastPaymentRow[];
  loading: boolean;
  emptyText: string;
}) {
  if (loading && rows.length === 0) {
    return <TableEmpty loading text={emptyText} />;
  }
  if (rows.length === 0) {
    return <TableEmpty loading={false} text={emptyText} />;
  }
  return (
    <div className="mt-3">
      <table className="min-w-full divide-y divide-gray-100 text-sm">
        <thead className="text-xs uppercase tracking-wide">
          <tr>
            <th className="px-1 py-2 text-left font-semibold text-gray-400">Client</th>
            <th className="px-2 py-2 text-left font-semibold text-gray-400">Method</th>
            <th className="px-2 py-2 text-left font-semibold text-gray-400">Time</th>
            <th className="px-0 py-2 text-right font-semibold text-gray-400">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50 bg-white">
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-slate-50/80">
              <td className="max-w-[14rem] px-1 py-2.5 align-top">
                <ClientLeadCell name={row.clientName} leadNumber={row.leadNumber} href={row.href} />
              </td>
              <td className="px-2 py-2.5 align-top text-gray-600">
                <p>{row.paidBy || '—'}</p>
                {row.paidBy === 'Manual payment' && row.markedPaidBy ? (
                  <p className="mt-0.5 text-[11px] text-gray-400">by {row.markedPaidBy}</p>
                ) : null}
              </td>
              <td className="whitespace-nowrap px-2 py-2.5 align-top text-gray-500">
                {formatAttemptTime(row.paidAt)}
              </td>
              <td className="whitespace-nowrap px-0 py-2.5 text-right align-top">
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

function FailedPaymentsTable({
  groups,
  loading,
  emptyText,
  expandedKey,
  onToggle,
}: {
  groups: FailedPaymentGroup[];
  loading: boolean;
  emptyText: string;
  expandedKey: string | null;
  onToggle: (key: string) => void;
}) {
  if (loading && groups.length === 0) {
    return <TableEmpty loading text={emptyText} />;
  }
  if (groups.length === 0) {
    return <TableEmpty loading={false} text={emptyText} />;
  }
  return (
    <div className="mt-3">
      <table className="min-w-full divide-y divide-gray-100 text-sm">
        <thead className="text-xs uppercase tracking-wide">
          <tr>
            <th className="px-1 py-2 text-left font-semibold text-gray-400">Client</th>
            <th className="px-2 py-2 text-left font-semibold text-gray-400">Issue</th>
            <th className="px-2 py-2 text-center font-semibold text-gray-400">Attempts</th>
            <th className="px-0 py-2 text-right font-semibold text-gray-400">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50 bg-white">
          {groups.map((group) => {
            const expanded = expandedKey === group.key;
            return (
              <React.Fragment key={group.key}>
                <tr
                  className="cursor-pointer hover:bg-slate-50/80"
                  onClick={() => onToggle(group.key)}
                >
                  <td className="max-w-[13rem] px-1 py-2.5 align-top">
                    <ClientLeadCell name={group.clientName} leadNumber={group.leadNumber} href={group.href} />
                    <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] font-medium">
                      {group.href && group.href !== '/clients' ? (
                        <Link
                          to={group.href}
                          className="text-sky-700 hover:underline"
                          onClick={(event) => event.stopPropagation()}
                        >
                          Open
                        </Link>
                      ) : null}
                      {group.secureToken ? (
                        <button
                          type="button"
                          className="text-gray-500 hover:text-gray-800 hover:underline"
                          onClick={(event) => {
                            event.stopPropagation();
                            void copyPaymentLink(group.secureToken as string);
                          }}
                        >
                          Copy link
                        </button>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-2 py-2.5 align-top">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${failureChipClass(group.kind)}`}
                      title={group.code ? `${group.code}${group.detail ? ` · ${group.detail}` : ''}` : group.detail}
                    >
                      {group.title}
                    </span>
                    {group.detail ? (
                      <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-gray-500">{group.detail}</p>
                    ) : group.code ? (
                      <p className="mt-1 text-[11px] text-gray-400" title={group.code}>
                        Code {group.code}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-2 py-2.5 text-center align-top">
                    <p className="text-sm font-semibold tabular-nums text-gray-900">{group.attempts.length}</p>
                    <p className="mt-0.5 text-[11px] text-gray-400">{formatAttemptTime(group.lastAt)}</p>
                  </td>
                  <td className="whitespace-nowrap px-0 py-2.5 text-right align-top">
                    <FinanceAmountText
                      currencySign={group.currencySign}
                      amountNumber={group.amountNumber}
                      amountLabel={group.amountLabel}
                    />
                  </td>
                </tr>
                {expanded ? (
                  <tr className="bg-slate-50/70">
                    <td colSpan={4} className="px-2 py-2">
                      <div className="space-y-1.5">
                        {group.attempts
                          .slice()
                          .sort((a, b) => String(b.failedAt).localeCompare(String(a.failedAt)))
                          .map((attempt) => (
                            <div
                              key={attempt.id}
                              className="flex flex-wrap items-baseline justify-between gap-2 text-[11px] text-gray-600"
                            >
                              <span className="font-medium text-gray-700">{formatAttemptTime(attempt.failedAt)}</span>
                              <span className="min-w-0 flex-1 truncate" title={attempt.errorReason}>
                                {attempt.errorTitle || attempt.errorReason}
                                {attempt.errorCode ? ` · ${attempt.errorCode}` : ''}
                              </span>
                            </div>
                          ))}
                      </div>
                    </td>
                  </tr>
                ) : null}
              </React.Fragment>
            );
          })}
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
  const todayIso = getJerusalemTodayIsoDate();
  const [paidRange, setPaidRange] = usePersistedState<FinanceDateRange>(
    'financeDashboard_paidRange',
    { from: todayIso, to: todayIso },
    { storage: 'sessionStorage', retainOnPageRefresh: true },
  );
  const [failedRange, setFailedRange] = usePersistedState<FinanceDateRange>(
    'financeDashboard_failedRange',
    { from: todayIso, to: todayIso },
    { storage: 'sessionStorage', retainOnPageRefresh: true },
  );
  const [createRange, setCreateRange] = usePersistedState<FinanceDateRange>(
    'financeDashboard_createRange',
    last7DaysRange(),
    { storage: 'sessionStorage', retainOnPageRefresh: true },
  );
  const [sendRange, setSendRange] = usePersistedState<FinanceDateRange>(
    'financeDashboard_sendRange',
    last7DaysRange(),
    { storage: 'sessionStorage', retainOnPageRefresh: true },
  );
  const [lastPayments, setLastPayments] = usePersistedState<FinanceLastPaymentRow[]>(
    'financeDashboard_lastPayments',
    [],
    { storage: 'sessionStorage', retainOnPageRefresh: true },
  );
  const [failedPayments, setFailedPayments] = usePersistedState<FinanceFailedPaymentRow[]>(
    'financeDashboard_failedPayments',
    [],
    { storage: 'sessionStorage', retainOnPageRefresh: true },
  );
  const [createProformaRows, setCreateProformaRows] = usePersistedState<FinanceInvoiceInstructionRow[]>(
    'financeDashboard_createInstructions',
    [],
    { storage: 'sessionStorage', retainOnPageRefresh: true },
  );
  const [sendInvoiceRows, setSendInvoiceRows] = usePersistedState<FinanceInvoiceInstructionRow[]>(
    'financeDashboard_sendInstructions',
    [],
    { storage: 'sessionStorage', retainOnPageRefresh: true },
  );
  const hadCachedSnapshotRef = useRef(Boolean(snapshot.asOf));
  const [loading, setLoading] = useState(!hadCachedSnapshotRef.current);
  const [trendLoading, setTrendLoading] = useState(!trend.length);
  const [paidLoading, setPaidLoading] = useState(!lastPayments.length);
  const [failedLoading, setFailedLoading] = useState(!failedPayments.length);
  const [createLoading, setCreateLoading] = useState(!createProformaRows.length);
  const [sendLoading, setSendLoading] = useState(!sendInvoiceRows.length);
  const [paidSearch, setPaidSearch] = useState('');
  const [paidMethod, setPaidMethod] = useState('all');
  const [paidCurrency, setPaidCurrency] = useState('all');
  const [paidSort, setPaidSort] = useState<'recent' | 'amount' | 'client'>('recent');
  const [failedSearch, setFailedSearch] = useState('');
  const [failedKind, setFailedKind] = useState<'all' | 'card' | 'bank'>('all');
  const [failedSort, setFailedSort] = useState<'amount' | 'recent' | 'attempts' | 'client'>('amount');
  const [expandedFailedKey, setExpandedFailedKey] = useState<string | null>(null);
  const [createSearch, setCreateSearch] = useState('');
  const [createSort, setCreateSort] = useState<'due' | 'amount' | 'client'>('due');
  const [sendSearch, setSendSearch] = useState('');
  const [sendSort, setSendSort] = useState<'due' | 'amount' | 'client'>('due');

  const loadInvoiceBoxes = useCallback(
    async (create: FinanceDateRange, send: FinanceDateRange) => {
      const split = (rows: FinanceInvoiceInstructionRow[]) => ({
        create: rows.filter((row) => row.kind === 'create_proforma'),
        send: rows.filter((row) => row.kind === 'send_invoice'),
      });
      if (sameDateRange(create, send)) {
        const rows = await fetchFinanceInvoiceInstructions(create);
        return split(rows);
      }
      const [createRows, sendRows] = await Promise.all([
        fetchFinanceInvoiceInstructions(create),
        fetchFinanceInvoiceInstructions(send),
      ]);
      return {
        create: split(createRows).create,
        send: split(sendRows).send,
      };
    },
    [],
  );

  const load = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!silent) {
      setLoading(true);
      setTrendLoading(true);
      setPaidLoading(true);
      setFailedLoading(true);
      setCreateLoading(true);
      setSendLoading(true);
    }
    try {
      const [data, trendData, lastPaymentsData, failedPaymentsData, invoiceBoxes] = await Promise.all([
        fetchFinanceManagementOverview(),
        fetchFinancePaymentTrend(30).catch((err) => {
          console.error('FinanceManagementDashboard trend:', err);
          return [] as FinancePaymentTrendPoint[];
        }),
        fetchFinanceLastPaymentsToday(paidRange).catch((err) => {
          console.error('FinanceManagementDashboard last payments:', err);
          return [] as FinanceLastPaymentRow[];
        }),
        fetchFinanceFailedPaymentsToday(failedRange).catch((err) => {
          console.error('FinanceManagementDashboard failed payments:', err);
          return [] as FinanceFailedPaymentRow[];
        }),
        loadInvoiceBoxes(createRange, sendRange).catch((err) => {
          console.error('FinanceManagementDashboard invoice instructions:', err);
          return { create: [] as FinanceInvoiceInstructionRow[], send: [] as FinanceInvoiceInstructionRow[] };
        }),
      ]);
      const next = !canViewExpenses
        ? { ...data, expensesThisMonthNis: 0, expensesMarketingNis: 0, expensesSalariesNis: 0 }
        : data;
      setSnapshot(next);
      setTrend(trendData);
      setLastPayments(lastPaymentsData);
      setFailedPayments(failedPaymentsData);
      setCreateProformaRows(invoiceBoxes.create);
      setSendInvoiceRows(invoiceBoxes.send);
    } catch (err) {
      console.error('FinanceManagementDashboard:', err);
      if (!silent) {
        setSnapshot(EMPTY);
        setTrend([]);
        setLastPayments([]);
        setFailedPayments([]);
        setCreateProformaRows([]);
        setSendInvoiceRows([]);
      }
    } finally {
      setLoading(false);
      setTrendLoading(false);
      setPaidLoading(false);
      setFailedLoading(false);
      setCreateLoading(false);
      setSendLoading(false);
    }
  }, [
    canViewExpenses,
    paidRange,
    failedRange,
    createRange,
    sendRange,
    loadInvoiceBoxes,
    setSnapshot,
    setTrend,
    setLastPayments,
    setFailedPayments,
    setCreateProformaRows,
    setSendInvoiceRows,
  ]);

  const loadRef = useRef(load);
  loadRef.current = load;
  const paidRangeRef = useRef(paidRange);
  const failedRangeRef = useRef(failedRange);
  const createRangeRef = useRef(createRange);
  const sendRangeRef = useRef(sendRange);

  useEffect(() => {
    if (sameDateRange(paidRangeRef.current, paidRange)) return;
    paidRangeRef.current = paidRange;
    let cancelled = false;
    setPaidLoading(true);
    void fetchFinanceLastPaymentsToday(paidRange)
      .then((rows) => {
        if (!cancelled) setLastPayments(rows);
      })
      .catch((err) => {
        console.error('FinanceManagementDashboard last payments:', err);
        if (!cancelled) setLastPayments([]);
      })
      .finally(() => {
        if (!cancelled) setPaidLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [paidRange, setLastPayments]);

  useEffect(() => {
    if (sameDateRange(failedRangeRef.current, failedRange)) return;
    failedRangeRef.current = failedRange;
    let cancelled = false;
    setFailedLoading(true);
    void fetchFinanceFailedPaymentsToday(failedRange)
      .then((rows) => {
        if (!cancelled) setFailedPayments(rows);
      })
      .catch((err) => {
        console.error('FinanceManagementDashboard failed payments:', err);
        if (!cancelled) setFailedPayments([]);
      })
      .finally(() => {
        if (!cancelled) setFailedLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [failedRange, setFailedPayments]);

  useEffect(() => {
    if (sameDateRange(createRangeRef.current, createRange)) return;
    createRangeRef.current = createRange;
    let cancelled = false;
    setCreateLoading(true);
    void fetchFinanceInvoiceInstructions(createRange)
      .then((rows) => {
        if (!cancelled) setCreateProformaRows(rows.filter((row) => row.kind === 'create_proforma'));
      })
      .catch((err) => {
        console.error('FinanceManagementDashboard create proforma:', err);
        if (!cancelled) setCreateProformaRows([]);
      })
      .finally(() => {
        if (!cancelled) setCreateLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [createRange, setCreateProformaRows]);

  useEffect(() => {
    if (sameDateRange(sendRangeRef.current, sendRange)) return;
    sendRangeRef.current = sendRange;
    let cancelled = false;
    setSendLoading(true);
    void fetchFinanceInvoiceInstructions(sendRange)
      .then((rows) => {
        if (!cancelled) setSendInvoiceRows(rows.filter((row) => row.kind === 'send_invoice'));
      })
      .catch((err) => {
        console.error('FinanceManagementDashboard send invoice:', err);
        if (!cancelled) setSendInvoiceRows([]);
      })
      .finally(() => {
        if (!cancelled) setSendLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sendRange, setSendInvoiceRows]);

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

  const paidMethods = useMemo(() => uniqueSorted(lastPayments.map((row) => row.paidBy)), [lastPayments]);
  const paidCurrencies = useMemo(
    () => uniqueSorted(lastPayments.map((row) => row.currencySign)),
    [lastPayments],
  );
  const visiblePaidRows = useMemo(() => {
    const query = paidSearch.trim().toLowerCase();
    const filtered = lastPayments.filter((row) => {
      if (paidMethod !== 'all' && row.paidBy !== paidMethod) return false;
      if (paidCurrency !== 'all' && row.currencySign !== paidCurrency) return false;
      if (!query) return true;
      return `${row.clientName} ${row.leadNumber} ${row.paidBy}`.toLowerCase().includes(query);
    });
    return filtered.slice().sort((a, b) => {
      if (paidSort === 'amount') return parseDisplayedAmount(b) - parseDisplayedAmount(a);
      if (paidSort === 'client') return a.clientName.localeCompare(b.clientName);
      return String(b.paidAt).localeCompare(String(a.paidAt));
    });
  }, [lastPayments, paidSearch, paidMethod, paidCurrency, paidSort]);

  const failedGroups = useMemo(
    () =>
      groupFailedPayments(
        failedPayments.filter(
          (row) =>
            !isPelecardApprovedCode(row.errorCode) &&
            !/payment approved/i.test(row.errorTitle || row.errorReason || ''),
        ),
      ),
    [failedPayments],
  );
  const visibleFailedGroups = useMemo(() => {
    const query = failedSearch.trim().toLowerCase();
    const filtered = failedGroups.filter((group) => {
      if (failedKind !== 'all' && group.kind !== failedKind) return false;
      if (!query) return true;
      return `${group.clientName} ${group.leadNumber} ${group.title} ${group.detail}`.toLowerCase().includes(query);
    });
    return filtered.slice().sort((a, b) => {
      if (failedSort === 'attempts') return b.attempts.length - a.attempts.length;
      if (failedSort === 'client') return a.clientName.localeCompare(b.clientName);
      if (failedSort === 'recent') return String(b.lastAt).localeCompare(String(a.lastAt));
      return b.amountValue - a.amountValue;
    });
  }, [failedGroups, failedSearch, failedKind, failedSort]);

  const filterInvoiceRows = useCallback(
    (
      rows: FinanceInvoiceInstructionRow[],
      search: string,
      sort: 'due' | 'amount' | 'client',
    ) => {
      const query = search.trim().toLowerCase();
      const filtered = rows.filter((row) => {
        if (!query) return true;
        return `${row.clientName} ${row.leadNumber} ${row.orderLabel}`.toLowerCase().includes(query);
      });
      return filtered.slice().sort((a, b) => {
        if (sort === 'amount') return parseDisplayedAmount(b) - parseDisplayedAmount(a);
        if (sort === 'client') return a.clientName.localeCompare(b.clientName);
        return b.daysAgo - a.daysAgo || String(a.dueDate).localeCompare(String(b.dueDate));
      });
    },
    [],
  );
  const visibleCreateRows = useMemo(
    () => filterInvoiceRows(createProformaRows, createSearch, createSort),
    [createProformaRows, createSearch, createSort, filterInvoiceRows],
  );
  const visibleSendRows = useMemo(
    () => filterInvoiceRows(sendInvoiceRows, sendSearch, sendSort),
    [sendInvoiceRows, sendSearch, sendSort, filterInvoiceRows],
  );

  const paidMoney = formatNisTotal(lastPayments);
  const failedMoney = formatNisTotal(failedGroups);
  const createMoney = formatNisTotal(createProformaRows);
  const sendMoney = formatNisTotal(sendInvoiceRows);
  const failedAttemptCount = failedGroups.reduce((sum, group) => sum + group.attempts.length, 0);
  const visibleFailedAttempts = visibleFailedGroups.reduce((sum, group) => sum + group.attempts.length, 0);

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
          disabled={loading || trendLoading || paidLoading || failedLoading || createLoading || sendLoading}
        >
          {loading || trendLoading || paidLoading || failedLoading || createLoading || sendLoading ? (
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
          <DashboardBoxHeader
            title="Successful payments"
            money={paidLoading && lastPayments.length === 0 ? '' : paidMoney}
            moneyTone="success"
            summary={
              paidLoading && lastPayments.length === 0
                ? 'Loading payments…'
                : `${lastPayments.length} ${lastPayments.length === 1 ? 'payment' : 'payments'}`
            }
            range={paidRange}
            onRangeChange={setPaidRange}
          />
          <BoxToolbar>
            <BoxSearch value={paidSearch} onChange={setPaidSearch} placeholder="Search client…" />
            <BoxSelect value={paidMethod} onChange={setPaidMethod}>
              <option value="all">All methods</option>
              {paidMethods.map((method) => (
                <option key={method} value={method}>
                  {method}
                </option>
              ))}
            </BoxSelect>
            <BoxSelect value={paidCurrency} onChange={setPaidCurrency}>
              <option value="all">Currency</option>
              {paidCurrencies.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </BoxSelect>
            <BoxSelect value={paidSort} onChange={(value) => setPaidSort(value as typeof paidSort)}>
              <option value="recent">Most recent</option>
              <option value="amount">Highest amount</option>
              <option value="client">Client</option>
            </BoxSelect>
          </BoxToolbar>
          <PaidPaymentsTable
            rows={visiblePaidRows}
            loading={paidLoading}
            emptyText={
              lastPayments.length > 0
                ? 'No payments match these filters.'
                : rangeEmptyText(paidRange, 'No payments collected today.', 'No payments collected in this range.')
            }
          />
          {lastPayments.length > 0 ? (
            <CardFooter>
              {visiblePaidRows.length === lastPayments.length
                ? `Showing ${lastPayments.length} successful ${lastPayments.length === 1 ? 'payment' : 'payments'}`
                : `Showing ${visiblePaidRows.length} of ${lastPayments.length} payments`}
            </CardFooter>
          ) : null}
        </div>

        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <DashboardBoxHeader
            title="Failed payments"
            money={
              failedLoading && failedPayments.length === 0
                ? ''
                : failedMoney
                  ? `${failedMoney} unresolved`
                  : ''
            }
            moneyTone="danger"
            summary={
              failedLoading && failedPayments.length === 0
                ? 'Loading failed payments…'
                : failedGroups.length === 0
                  ? 'No clients require attention'
                  : `${failedGroups.length} ${failedGroups.length === 1 ? 'client requires' : 'clients require'} attention · ${failedAttemptCount} ${failedAttemptCount === 1 ? 'attempt' : 'attempts'}`
            }
            range={failedRange}
            onRangeChange={setFailedRange}
          />
          <BoxToolbar>
            <BoxSearch value={failedSearch} onChange={setFailedSearch} placeholder="Search client…" />
            <div className="inline-flex h-8 items-center rounded-lg bg-gray-100 p-0.5">
              {(
                [
                  { id: 'all', label: 'All failures' },
                  { id: 'card', label: 'Card' },
                  { id: 'bank', label: 'Bank transfer' },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setFailedKind(item.id)}
                  className={`h-7 rounded-md px-2.5 text-xs font-medium ${
                    failedKind === item.id
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'bg-transparent text-gray-500 hover:text-gray-800'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <BoxSelect value={failedSort} onChange={(value) => setFailedSort(value as typeof failedSort)}>
              <option value="amount">Highest amount</option>
              <option value="recent">Most recent</option>
              <option value="attempts">Most attempts</option>
              <option value="client">Client</option>
            </BoxSelect>
          </BoxToolbar>
          <FailedPaymentsTable
            groups={visibleFailedGroups}
            loading={failedLoading}
            emptyText={
              failedPayments.length > 0
                ? 'No failed payments match these filters.'
                : rangeEmptyText(failedRange, 'No failed payments today.', 'No failed payments in this range.')
            }
            expandedKey={expandedFailedKey}
            onToggle={(key) => setExpandedFailedKey((current) => (current === key ? null : key))}
          />
          {failedPayments.length > 0 ? (
            <CardFooter>
              {visibleFailedGroups.length === failedGroups.length
                ? `Showing ${failedAttemptCount} ${failedAttemptCount === 1 ? 'attempt' : 'attempts'} from ${failedGroups.length} ${failedGroups.length === 1 ? 'client' : 'clients'}`
                : `Showing ${visibleFailedAttempts} attempts from ${visibleFailedGroups.length} of ${failedGroups.length} clients`}
            </CardFooter>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <DashboardBoxHeader
            title="Create proforma"
            money={createLoading && createProformaRows.length === 0 ? '' : createMoney}
            summary={
              createLoading && createProformaRows.length === 0
                ? 'Loading invoice instructions…'
                : `${createProformaRows.length} ${createProformaRows.length === 1 ? 'proforma' : 'proformas'} · Sent to finance · no proforma yet`
            }
            range={createRange}
            onRangeChange={setCreateRange}
          />
          <BoxToolbar>
            <BoxSearch value={createSearch} onChange={setCreateSearch} placeholder="Search client…" />
            <BoxSelect value={createSort} onChange={(value) => setCreateSort(value as typeof createSort)}>
              <option value="due">Oldest due</option>
              <option value="amount">Highest amount</option>
              <option value="client">Client</option>
            </BoxSelect>
          </BoxToolbar>
          <InvoiceInstructionTable
            rows={visibleCreateRows}
            loading={createLoading}
            emptyText={
              createProformaRows.length > 0
                ? 'No proformas match these filters.'
                : 'No proformas to create in this range.'
            }
          />
          {createProformaRows.length > 0 ? (
            <CardFooter>
              {visibleCreateRows.length === createProformaRows.length
                ? `Showing ${createProformaRows.length} ${createProformaRows.length === 1 ? 'proforma' : 'proformas'}`
                : `Showing ${visibleCreateRows.length} of ${createProformaRows.length} proformas`}
            </CardFooter>
          ) : null}
        </div>

        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <DashboardBoxHeader
            title="Send invoice"
            money={sendLoading && sendInvoiceRows.length === 0 ? '' : sendMoney}
            summary={
              sendLoading && sendInvoiceRows.length === 0
                ? 'Loading invoice instructions…'
                : `${sendInvoiceRows.length} ${sendInvoiceRows.length === 1 ? 'invoice' : 'invoices'} · Sent to finance · proforma not sent`
            }
            range={sendRange}
            onRangeChange={setSendRange}
            extra={
              <button
                type="button"
                className="btn btn-xs btn-outline rounded-lg"
                onClick={() => onOpenTab('collection', 'due-invoice-instructions')}
              >
                Collection
              </button>
            }
          />
          <BoxToolbar>
            <BoxSearch value={sendSearch} onChange={setSendSearch} placeholder="Search client…" />
            <BoxSelect value={sendSort} onChange={(value) => setSendSort(value as typeof sendSort)}>
              <option value="due">Oldest due</option>
              <option value="amount">Highest amount</option>
              <option value="client">Client</option>
            </BoxSelect>
          </BoxToolbar>
          <InvoiceInstructionTable
            rows={visibleSendRows}
            loading={sendLoading}
            emptyText={
              sendInvoiceRows.length > 0
                ? 'No invoices match these filters.'
                : 'No invoices waiting to be sent in this range.'
            }
          />
          {sendInvoiceRows.length > 0 ? (
            <CardFooter>
              {visibleSendRows.length === sendInvoiceRows.length
                ? `Showing ${sendInvoiceRows.length} ${sendInvoiceRows.length === 1 ? 'invoice' : 'invoices'}`
                : `Showing ${visibleSendRows.length} of ${sendInvoiceRows.length} invoices`}
            </CardFooter>
          ) : null}
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
