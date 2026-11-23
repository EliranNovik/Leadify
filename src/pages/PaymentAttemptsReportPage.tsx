import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeftIcon,
  ArrowTopRightOnSquareIcon,
  BanknotesIcon,
  BuildingLibraryIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ClockIcon,
  CreditCardIcon,
  MagnifyingGlassIcon,
  NoSymbolIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import { FaApple, FaGoogle } from 'react-icons/fa';
import { useAdminRole } from '../hooks/useAdminRole';
import {
  fetchPaymentAttemptsReport,
  PAYMENT_CHANNEL_LABEL,
  type PaymentAttemptOutcome,
  type PaymentAttemptRow,
  type PaymentChannel,
} from '../lib/paymentAttemptsReport';

type OutcomeFilter = 'all' | PaymentAttemptOutcome | 'invoice';
type RangeDays = 7 | 30 | 90;

const OUTCOME_FILTERS: { id: OutcomeFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'went_through', label: 'Went through' },
  { id: 'failed', label: 'Failed' },
  { id: 'cancelled', label: 'Cancelled' },
  { id: 'pending', label: 'Pending' },
  { id: 'invoice', label: 'Invoice issues' },
];

const RANGES: RangeDays[] = [7, 30, 90];

function ChannelMark({ channel, className = 'h-3.5 w-3.5' }: { channel: PaymentChannel | 'all'; className?: string }) {
  if (channel === 'credit_card') return <CreditCardIcon className={className} aria-hidden />;
  if (channel === 'bank') return <BuildingLibraryIcon className={className} aria-hidden />;
  if (channel === 'apple_pay') return <FaApple className={className} aria-hidden />;
  if (channel === 'google_pay') return <FaGoogle className={className} aria-hidden />;
  return null;
}

const CHANNEL_FILTERS: { id: PaymentChannel | 'all'; label: string }[] = [
  { id: 'all', label: 'All types' },
  { id: 'credit_card', label: 'Credit card' },
  { id: 'bank', label: 'Bank' },
  { id: 'apple_pay', label: 'Apple Pay' },
  { id: 'google_pay', label: 'Google Pay' },
];

const SUMMARY_CARDS: {
  id: OutcomeFilter;
  label: string;
  hint: string;
  gradient: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  countKey: 'went_through' | 'failed' | 'cancelled' | 'pending' | 'invoice';
}[] = [
  {
    id: 'went_through',
    label: 'Went through',
    hint: 'Approved charges',
    gradient: 'bg-gradient-to-tr from-teal-600 via-emerald-500 to-green-500',
    icon: CheckCircleIcon,
    countKey: 'went_through',
  },
  {
    id: 'failed',
    label: 'Failed',
    hint: 'Declined or not completed',
    gradient: 'bg-gradient-to-tr from-pink-500 via-rose-500 to-orange-500',
    icon: XCircleIcon,
    countKey: 'failed',
  },
  {
    id: 'cancelled',
    label: 'Cancelled',
    hint: 'Left before paying',
    gradient: 'bg-gradient-to-tr from-amber-500 via-orange-500 to-yellow-500',
    icon: NoSymbolIcon,
    countKey: 'cancelled',
  },
  {
    id: 'pending',
    label: 'Pending',
    hint: 'Checkout started',
    gradient: 'bg-gradient-to-tr from-sky-600 via-cyan-500 to-blue-500',
    icon: ClockIcon,
    countKey: 'pending',
  },
  {
    id: 'invoice',
    label: 'Invoice issues',
    hint: 'Charge saved, invoice missing',
    gradient: 'bg-gradient-to-tr from-purple-600 via-indigo-600 to-blue-500',
    icon: BanknotesIcon,
    countKey: 'invoice',
  },
];

function localYmd(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function daysAgoYmd(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - (days - 1));
  return localYmd(date);
}

function formatWhen(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function formatAmount(amount: number | null, currency: string): string {
  if (amount == null || Number.isNaN(amount)) return '—';
  const symbol = currency?.trim() || '₪';
  return `${symbol}${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function outcomeLabel(outcome: PaymentAttemptOutcome): string {
  if (outcome === 'went_through') return 'Went through';
  if (outcome === 'failed') return 'Failed';
  if (outcome === 'cancelled') return 'Cancelled';
  return 'Pending';
}

function outcomeClass(outcome: PaymentAttemptOutcome): string {
  if (outcome === 'went_through') return 'bg-emerald-50 text-emerald-800';
  if (outcome === 'failed') return 'bg-red-50 text-red-700';
  if (outcome === 'cancelled') return 'bg-gray-100 text-gray-600';
  return 'bg-amber-50 text-amber-800';
}

const PaymentAttemptsReportPage: React.FC = () => {
  const { isAdmin } = useAdminRole();
  const navigate = useNavigate();
  const [fromDate, setFromDate] = useState(() => daysAgoYmd(30));
  const [toDate, setToDate] = useState(() => localYmd(new Date()));
  const [filter, setFilter] = useState<OutcomeFilter>('all');
  const [cardFilter, setCardFilter] = useState<string>('all');
  const [channelFilter, setChannelFilter] = useState<PaymentChannel | 'all'>('all');
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const typeMenuRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<PaymentAttemptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!typeMenuOpen) return;
    const close = (event: MouseEvent) => {
      if (!typeMenuRef.current?.contains(event.target as Node)) setTypeMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [typeMenuOpen]);

  useEffect(() => {
    if (!isAdmin) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchPaymentAttemptsReport({ from: fromDate, to: toDate })
      .then((next) => {
        if (!cancelled) setRows(next);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load payment attempts.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fromDate, toDate, isAdmin]);

  const stats = useMemo(() => {
    const counts = { went_through: 0, failed: 0, cancelled: 0, pending: 0, invoice: 0 };
    const codes = new Map<string, { count: number; explanation: string }>();
    for (const row of rows) {
      counts[row.outcome] += 1;
      if (row.invoiceProblem) counts.invoice += 1;
      if (row.outcome === 'failed' || row.outcome === 'cancelled' || row.invoiceProblem) {
        const key = row.code || 'none';
        const current = codes.get(key) || { count: 0, explanation: row.explanation || row.title || 'No explanation stored' };
        current.count += 1;
        codes.set(key, current);
      }
    }
    return { counts, codes: [...codes.entries()].sort((a, b) => b[1].count - a[1].count) };
  }, [rows]);

  const cardBrands = useMemo(() => {
    const brands = new Set<string>();
    for (const row of rows) {
      if (row.cardBrand) brands.add(row.cardBrand);
    }
    return [...brands].sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (filter === 'invoice' && !row.invoiceProblem) return false;
      if (filter !== 'all' && filter !== 'invoice' && row.outcome !== filter) return false;
      if (cardFilter !== 'all' && row.cardBrand !== cardFilter) return false;
      if (channelFilter !== 'all' && row.paymentChannel !== channelFilter) return false;
      if (!needle) return true;
      const haystack = [
        row.clientName,
        row.leadLabel,
        row.code,
        row.title,
        row.explanation,
        row.errorMessage,
        row.transactionRef,
        row.pelecardTransactionId,
        row.linkId,
        row.invoiceNumber,
        row.invoiceStatus,
        row.cardBrand,
        row.cardLastFour,
        row.authNumber,
        row.billingEmail,
        row.paymentChannel ? PAYMENT_CHANNEL_LABEL[row.paymentChannel] : '',
        row.method,
        row.status,
        row.amount != null ? String(row.amount) : '',
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [rows, filter, cardFilter, channelFilter, query]);

  const copyText = async (key: string, value: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      window.setTimeout(() => {
        setCopiedKey((current) => (current === key ? null : current));
      }, 1500);
    } catch {
      setCopiedKey(null);
    }
  };

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-sm text-gray-600">This report is for admins only.</p>
        <Link to="/reports" className="mt-4 inline-flex text-sm font-medium text-blue-900">
          Back to reports
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f7f7fb] px-4 py-6 md:px-8">
      <div className="w-full">
        <Link to="/reports" className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-800">
          <ArrowLeftIcon className="h-4 w-4" />
          Reports
        </Link>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-[#16161d]">Payment attempts</h1>
        <p className="mt-1 max-w-3xl text-sm text-gray-500">
          Charges from the payment page and the Pelecard callback: what went through, what failed, the status code, and what that code means.
        </p>

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {SUMMARY_CARDS.map((card) => {
            const Icon = card.icon;
            const active = filter === card.id;
            return (
              <button
                key={card.id}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(active ? 'all' : card.id)}
                className={`${card.gradient} flex items-center justify-between gap-3 rounded-2xl p-5 text-left text-white shadow-xl transition-all duration-300 hover:shadow-2xl ${
                  active ? 'scale-[1.02] ring-4 ring-white/70' : 'hover:scale-105'
                }`}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white/90">{card.label}</p>
                  <p className="text-3xl font-bold">{stats.counts[card.countKey]}</p>
                  <p className="mt-1 truncate text-xs text-white/80" title={card.hint}>
                    {card.hint}
                  </p>
                </div>
                <div className="shrink-0 rounded-full bg-white/20 p-3">
                  <Icon className="h-7 w-7" />
                </div>
              </button>
            );
          })}
        </div>

        {stats.codes.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {stats.codes.slice(0, 8).map(([code, info]) => (
              <button
                key={code}
                type="button"
                onClick={() => setQuery(code === 'none' ? '' : code)}
                className="rounded-full bg-white px-3 py-1.5 text-left text-xs text-gray-700 shadow-sm hover:bg-gray-50"
              >
                <span className="font-semibold">{code === 'none' ? 'No code' : code}</span>
                <span className="text-gray-400"> · {info.count}</span>
                <span className="mt-0.5 block max-w-xs text-[11px] text-gray-500">{info.explanation}</span>
              </button>
            ))}
          </div>
        ) : null}

        <div className="mt-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="relative min-w-0 flex-1 md:max-w-md">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, lead, card, code, email, auth"
              className="w-full rounded-full border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-gray-400"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-gray-600">
              From
              <input
                type="date"
                value={fromDate}
                max={toDate}
                onChange={(event) => setFromDate(event.target.value)}
                className="bg-transparent text-xs text-gray-800 outline-none"
              />
            </label>
            <label className="flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-gray-600">
              To
              <input
                type="date"
                value={toDate}
                min={fromDate}
                onChange={(event) => setToDate(event.target.value)}
                className="bg-transparent text-xs text-gray-800 outline-none"
              />
            </label>
            <button
              type="button"
              onClick={() => {
                const today = localYmd(new Date());
                setFromDate(today);
                setToDate(today);
              }}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                fromDate === localYmd(new Date()) && toDate === localYmd(new Date())
                  ? 'bg-[#1c1c22] text-white'
                  : 'bg-white text-gray-600'
              }`}
            >
              Today
            </button>
            {RANGES.map((range) => {
              const active = fromDate === daysAgoYmd(range) && toDate === localYmd(new Date());
              return (
                <button
                  key={range}
                  type="button"
                  onClick={() => {
                    setFromDate(daysAgoYmd(range));
                    setToDate(localYmd(new Date()));
                  }}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                    active ? 'bg-[#1c1c22] text-white' : 'bg-white text-gray-600'
                  }`}
                >
                  {range} days
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <label className="relative flex items-center gap-2 rounded-full bg-white py-1.5 pl-3 pr-8 text-xs font-semibold text-gray-500">
            Result
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value as OutcomeFilter)}
              className="appearance-none bg-transparent pr-1 text-xs font-semibold text-[#16161d] outline-none"
            >
              {OUTCOME_FILTERS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            <ChevronDownIcon className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 text-gray-400" />
          </label>
          <label className="relative flex items-center gap-2 rounded-full bg-white py-1.5 pl-3 pr-8 text-xs font-semibold text-gray-500">
            Card
            <select
              value={cardFilter}
              onChange={(event) => setCardFilter(event.target.value)}
              className="appearance-none bg-transparent pr-1 text-xs font-semibold text-[#16161d] outline-none"
            >
              <option value="all">All cards</option>
              {cardBrands.map((brand) => (
                <option key={brand} value={brand}>
                  {brand}
                </option>
              ))}
            </select>
            <ChevronDownIcon className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 text-gray-400" />
          </label>
          <div ref={typeMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setTypeMenuOpen((open) => !open)}
              className="flex items-center gap-2 rounded-full bg-white py-1.5 pl-3 pr-3 text-xs font-semibold text-gray-500"
              aria-expanded={typeMenuOpen}
            >
              Type
              <span className="inline-flex items-center gap-1.5 font-semibold text-[#16161d]">
                <ChannelMark channel={channelFilter} />
                {CHANNEL_FILTERS.find((item) => item.id === channelFilter)?.label}
              </span>
              <ChevronDownIcon className="h-3.5 w-3.5 text-gray-400" />
            </button>
            {typeMenuOpen ? (
              <div className="absolute left-0 z-20 mt-2 min-w-[11rem] rounded-2xl bg-white p-1 shadow-xl">
                {CHANNEL_FILTERS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setChannelFilter(item.id);
                      setTypeMenuOpen(false);
                    }}
                    className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-semibold ${
                      channelFilter === item.id ? 'bg-[#1c1c22] text-white' : 'text-[#16161d] hover:bg-gray-50'
                    }`}
                  >
                    <ChannelMark channel={item.id} />
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl bg-white shadow-[0_10px_30px_rgba(22,22,29,0.05)]">
          {error ? <p className="px-4 py-8 text-sm text-red-700">{error}</p> : null}
          {loading ? <p className="px-4 py-8 text-sm text-gray-500">Loading payment attempts…</p> : null}
          {!loading && !error && visible.length === 0 ? (
            <p className="px-4 py-8 text-sm text-gray-500">No payment attempts match this view.</p>
          ) : null}
          {!loading && !error && visible.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-[1100px] w-full text-left text-sm">
                <thead className="border-b border-gray-100 text-[11px] uppercase tracking-wide text-gray-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">When</th>
                    <th className="px-4 py-3 font-medium">Result</th>
                    <th className="px-4 py-3 font-medium">Client</th>
                    <th className="px-4 py-3 font-medium">Amount</th>
                    <th className="px-4 py-3 font-medium">Card</th>
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 font-medium">Code</th>
                    <th className="px-4 py-3 font-medium">What it means</th>
                    <th className="px-4 py-3 font-medium">Backend</th>
                    <th className="px-4 py-3 text-right font-medium">Payment</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => (
                    <tr
                      key={row.id}
                      onClick={() => {
                        if (row.clientPath) navigate(row.clientPath);
                      }}
                      onKeyDown={(event) => {
                        if (!row.clientPath) return;
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          navigate(row.clientPath);
                        }
                      }}
                      tabIndex={row.clientPath ? 0 : undefined}
                      title={row.clientPath ? 'Open client' : undefined}
                      className={`border-b border-gray-50 align-top last:border-0 ${
                        row.clientPath ? 'cursor-pointer hover:bg-gray-50' : ''
                      }`}
                    >
                      <td className="whitespace-nowrap px-4 py-3 text-gray-600">{formatWhen(row.at)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${outcomeClass(row.outcome)}`}>
                          {outcomeLabel(row.outcome)}
                        </span>
                        <p className="mt-1 text-[11px] text-gray-400">{row.method || 'pelecard'} · link {row.linkStatus || '—'}</p>
                        {row.copies > 1 ? (
                          <p className="mt-1 text-[11px] text-gray-400">Saved {row.copies} times</p>
                        ) : null}
                        {row.paidLater ? (
                          <p className="mt-1 text-[11px] font-semibold text-emerald-700">Paid later</p>
                        ) : null}
                        {row.outcome === 'failed' && row.declineCount > 1 ? (
                          <p className="mt-1 text-[11px] text-red-700">{row.declineCount} declines on this lead</p>
                        ) : null}
                        {row.declineCardNote ? (
                          <p className="mt-1 text-[11px] text-red-700">{row.declineCardNote}</p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-[#16161d]">{row.clientName || '—'}</p>
                        <p className="text-[11px] text-gray-400">{row.leadLabel || `Link ${row.linkId || '—'}`}</p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <p>{formatAmount(row.amount, row.currency)}</p>
                        {row.chargedNis != null ? (
                          <p className="text-[11px] text-gray-400">
                            Bank saw ₪{row.chargedNis.toLocaleString()}
                          </p>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <p>{row.cardBrand || '—'}</p>
                        {row.cardLastFour ? <p className="text-[11px] text-gray-400">··{row.cardLastFour}</p> : null}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {row.paymentChannel ? (
                          <span className="inline-flex items-center gap-1.5">
                            <ChannelMark channel={row.paymentChannel} />
                            {PAYMENT_CHANNEL_LABEL[row.paymentChannel]}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-semibold text-[#16161d]">{row.code || '—'}</td>
                      <td className="max-w-sm px-4 py-3">
                        <p className="font-medium text-[#16161d]">{row.title || '—'}</p>
                        <p className="mt-1 text-xs leading-relaxed text-gray-500">{row.explanation || '—'}</p>
                        {row.nextStep ? (
                          <p className={`mt-1 text-xs leading-relaxed ${row.paidLater ? 'font-medium text-emerald-800' : 'text-[#16161d]'}`}>
                            {row.nextStep}
                          </p>
                        ) : null}
                        {row.invoiceProblem && row.outcome === 'went_through' ? (
                          <p className="mt-1 text-xs text-amber-800">
                            Charge went through, but the invoice was not created ({row.invoiceStatus || 'unknown'}).
                          </p>
                        ) : null}
                        {row.errorMessage ? (
                          <p className="mt-1 text-[11px] text-gray-400">{row.errorMessage}</p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600">
                        <p>Invoice: {row.invoiceStatus || '—'}</p>
                        {row.invoiceNumber ? <p>No. {row.invoiceNumber}</p> : null}
                        {row.pelecardTransactionId ? <p className="mt-1 break-all">Tx {row.pelecardTransactionId}</p> : null}
                        {row.authNumber ? <p>Auth {row.authNumber}</p> : null}
                        {row.invoiceProblem ? (
                          <p className="mt-1">{row.billingEmail || 'No billing email'}</p>
                        ) : null}
                        {row.billingEmail ? (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void copyText(`${row.id}:email`, row.billingEmail || '');
                            }}
                            className="mt-1 text-[11px] font-semibold text-gray-500 hover:text-gray-800"
                          >
                            {copiedKey === `${row.id}:email` ? 'Copied' : 'Copy email'}
                          </button>
                        ) : null}
                        {row.transactionRef ? <p className="break-all">Ref {row.transactionRef}</p> : null}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {row.paymentPath ? (
                          <Link
                            to={row.paymentPath}
                            onClick={(event) => event.stopPropagation()}
                            className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-[#1c1c22] px-3 py-1.5 text-xs font-semibold text-white hover:bg-black"
                          >
                            Payment page
                            <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
                          </Link>
                        ) : null}
                        {row.paymentPath ? (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void copyText(`${row.id}:link`, `${window.location.origin}${row.paymentPath}`);
                            }}
                            className="mt-2 block w-full text-right text-[11px] font-semibold text-gray-500 hover:text-gray-800"
                          >
                            {copiedKey === `${row.id}:link` ? 'Copied' : 'Copy link'}
                          </button>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default PaymentAttemptsReportPage;
