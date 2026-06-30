import React from 'react';
import {
  BanknotesIcon,
  ClockIcon,
  CurrencyDollarIcon,
  PaperAirplaneIcon,
} from '@heroicons/react/24/outline';
import { isExpenseNoVatPayment } from '../../lib/proformaVat';
import ContactProfileAvatar from '../ContactProfileAvatar';

function contactInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return `${parts[0].charAt(0)}${parts[1].charAt(0)}`.toUpperCase();
}

const CONTACT_ACCENT_PALETTE = [
  { accent: '#6366f1', softBg: '#e0e7ff', softFg: '#4f46e5' },
  { accent: '#8b5cf6', softBg: '#ede9fe', softFg: '#7c3aed' },
  { accent: '#0ea5e9', softBg: '#e0f2fe', softFg: '#0284c7' },
  { accent: '#14b8a6', softBg: '#ccfbf1', softFg: '#0d9488' },
  { accent: '#22c55e', softBg: '#d1fae5', softFg: '#059669' },
  { accent: '#84cc16', softBg: '#ecfccb', softFg: '#65a30d' },
  { accent: '#f59e0b', softBg: '#fef3c7', softFg: '#d97706' },
  { accent: '#f97316', softBg: '#ffedd5', softFg: '#ea580c' },
  { accent: '#f43f5e', softBg: '#ffe4e6', softFg: '#e11d48' },
  { accent: '#ec4899', softBg: '#fce7f3', softFg: '#db2777' },
  { accent: '#06b6d4', softBg: '#cffafe', softFg: '#0891b2' },
  { accent: '#7c3aed', softBg: '#f3e8ff', softFg: '#9333ea' },
] as const;

function contactAccentIndex(contactName: string): number {
  let hash = 0;
  for (let i = 0; i < contactName.length; i++) {
    hash = (Math.imul(31, hash) + contactName.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % CONTACT_ACCENT_PALETTE.length;
}

/** Stable accent per contact — shared by header box border and payment rows. */
export function getContactAccentColor(contactName: string): string {
  return CONTACT_ACCENT_PALETTE[contactAccentIndex(contactName)].accent;
}

/** Washed-out avatar colours matching the contact accent. */
export function getContactAccentSoftStyle(contactName: string): { backgroundColor: string; color: string } {
  const { softBg, softFg } = CONTACT_ACCENT_PALETTE[contactAccentIndex(contactName)];
  return { backgroundColor: softBg, color: softFg };
}

export type PaymentPlanRowLike = {
  id: string | number;
  dueDate?: string;
  value: number;
  valueVat: number;
  paid?: boolean;
  paid_at?: string | null;
  ready_to_pay?: boolean;
  currency?: string;
  currency_id?: number | string | null;
  isLegacy?: boolean;
  order?: string;
  invoice_send_automation_active?: boolean;
};

export type CurrencyAmountMap = Record<string, { base: number; vat: number }>;

export function sumByCurrency(
  payments: PaymentPlanRowLike[],
  filter?: (p: PaymentPlanRowLike) => boolean
): CurrencyAmountMap {
  return payments.reduce<CurrencyAmountMap>((acc, p) => {
    if (filter && !filter(p)) return acc;
    const currency = p.currency || '₪';
    if (!acc[currency]) acc[currency] = { base: 0, vat: 0 };
    acc[currency].base += Number(p.value) || 0;
    acc[currency].vat += Number(p.valueVat) || 0;
    return acc;
  }, {});
}

export function formatMultiCurrencyAmounts(
  map: CurrencyAmountMap,
  getCurrencySymbol: (currency: string | undefined) => string,
  options?: { includeVatLine?: boolean; emphasizeGross?: boolean }
): { primary: string; secondary?: string } {
  const entries = Object.entries(map).filter(([, t]) => t.base + t.vat > 0);
  if (entries.length === 0) return { primary: '—' };

  const parts = entries.map(([currency, t]) => {
    const sym = getCurrencySymbol(currency);
    const base = t.base.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    const gross = (t.base + t.vat).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    if (options?.emphasizeGross) {
      return `${sym}${gross}`;
    }
    return `${sym}${base}`;
  });

  const vatParts = options?.includeVatLine
    ? entries
        .filter(([, t]) => t.vat > 0)
        .map(([currency, t]) => {
          const sym = getCurrencySymbol(currency);
          return `${sym}${t.vat.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
        })
    : [];

  return {
    primary: parts.join(' | '),
    secondary:
      vatParts && vatParts.length > 0 ? `+ ${vatParts.join(' | ')} VAT` : undefined,
  };
}

export interface PlanSummaryStats {
  scheduledCount: number;
  paidCount: number;
  unpaidCount: number;
  progressPct: number;
  totalByCurrency: CurrencyAmountMap;
  paidByCurrency: CurrencyAmountMap;
  outstandingByCurrency: CurrencyAmountMap;
  expenseNoVatByCurrency: CurrencyAmountMap;
  expenseNoVatCount: number;
  nextDuePayment: PaymentPlanRowLike | null;
}

export function computePlanSummary(payments: PaymentPlanRowLike[]): PlanSummaryStats {
  const contractPayments = payments.filter((p) => !isExpenseNoVatPayment(p.order));
  const expensePayments = payments.filter((p) => isExpenseNoVatPayment(p.order));
  const scheduledCount = contractPayments.length;
  const paidCount = contractPayments.filter((p) => p.paid).length;
  const unpaidCount = scheduledCount - paidCount;
  const progressPct = scheduledCount > 0 ? Math.round((paidCount / scheduledCount) * 100) : 0;

  const unpaidPayments = contractPayments.filter((p) => !p.paid);
  const nextDuePayment = [...unpaidPayments].sort((a, b) => {
    const aTime = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
    const bTime = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
    return aTime - bTime;
  })[0] ?? null;

  return {
    scheduledCount,
    paidCount,
    unpaidCount,
    progressPct,
    totalByCurrency: sumByCurrency(contractPayments),
    paidByCurrency: sumByCurrency(contractPayments, (p) => !!p.paid),
    outstandingByCurrency: sumByCurrency(contractPayments, (p) => !p.paid),
    expenseNoVatByCurrency: sumByCurrency(expensePayments),
    expenseNoVatCount: expensePayments.length,
    nextDuePayment,
  };
}

export type PaymentPlanSummaryFilter = 'outstanding' | 'paid' | 'nextDue';

export const PAYMENT_PLAN_SUMMARY_FILTER_LABELS: Record<PaymentPlanSummaryFilter, string> = {
  outstanding: 'Outstanding',
  paid: 'Paid',
  nextDue: 'Next due',
};

export function paymentMatchesSummaryFilter(
  payment: PaymentPlanRowLike,
  filter: PaymentPlanSummaryFilter,
  nextDuePaymentId?: string | number | null,
): boolean {
  if (filter === 'outstanding') return !payment.paid;
  if (filter === 'paid') return !!payment.paid;
  if (filter === 'nextDue') {
    return nextDuePaymentId != null && String(payment.id) === String(nextDuePaymentId);
  }
  return true;
}

export function formatDateDDMMYYYY(dateString: string | null | undefined): string {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (date.toString() === 'Invalid Date') return '';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

/** Due date pill — violet by default; use matchStatus for payment-row status colours. */
export function DueDateBadge({
  date,
  className = '',
  paid = false,
  readyToPay = false,
  matchStatus = false,
}: {
  date: string | null | undefined;
  className?: string;
  paid?: boolean;
  readyToPay?: boolean;
  matchStatus?: boolean;
}) {
  const formatted = formatDateDDMMYYYY(date);
  if (!formatted) {
    return <span className={`text-sm text-slate-400 ${className}`.trim()}>—</span>;
  }
  const badgeClass = matchStatus
    ? readyToPay
      ? 'bg-sky-50 text-sky-700'
      : paid
        ? 'bg-emerald-50 text-emerald-700'
        : 'bg-amber-50 text-amber-700'
    : 'bg-violet-50 text-violet-700';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-sm font-semibold ${badgeClass} ${className}`.trim()}
    >
      {formatted}
    </span>
  );
}

/** Payment date on paid rows — plain text, no pill. */
export function PaidPaymentDateBadge({
  date,
  className = '',
}: {
  date: string | null | undefined;
  className?: string;
}) {
  const formatted = formatDateDDMMYYYY(date);
  if (!formatted) {
    return <span className={`text-sm text-slate-400 ${className}`.trim()}>—</span>;
  }
  return (
    <span className={`text-sm font-bold text-emerald-700 ${className}`.trim()}>
      {formatted}
    </span>
  );
}

export function PaymentStatusPill({
  paid,
  readyToPay,
}: {
  paid: boolean;
  readyToPay?: boolean;
}) {
  if (paid) {
    return (
      <span className="inline-flex rounded-full bg-emerald-700 px-3.5 py-1.5 text-sm font-semibold text-white">
        Paid
      </span>
    );
  }
  if (readyToPay) {
    return (
      <span className="inline-flex rounded-full bg-sky-50 px-3.5 py-1.5 text-sm font-semibold text-sky-700">
        Sent to finance
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-full bg-amber-50 px-3.5 py-1.5 text-sm font-semibold text-amber-700">
      Unpaid
    </span>
  );
}

type SummaryCardsProps = {
  summary: PlanSummaryStats;
  getCurrencySymbol: (currency: string | undefined) => string;
  contractTotalNis?: { primary: string; secondary?: string; loading?: boolean };
  expenseNoVatNis?: { primary?: string; loading?: boolean };
  outstandingNis?: { primary: string; loading?: boolean };
  activeFilter?: PaymentPlanSummaryFilter | null;
  onFilterToggle?: (filter: PaymentPlanSummaryFilter) => void;
};

type SummaryCardTone = 'neutral' | 'amber' | 'emerald' | 'violet';

const SUMMARY_CARD_TONES: Record<
  SummaryCardTone,
  { icon: string; activeRing: string; activeBadge: string }
> = {
  neutral: {
    icon: 'text-slate-300',
    activeRing: 'ring-2 ring-slate-400 ring-offset-2',
    activeBadge: 'bg-slate-200 text-slate-800',
  },
  amber: {
    icon: 'text-amber-300',
    activeRing: 'ring-2 ring-amber-400 ring-offset-2',
    activeBadge: 'bg-amber-200 text-amber-900',
  },
  emerald: {
    icon: 'text-emerald-300',
    activeRing: 'ring-2 ring-emerald-400 ring-offset-2',
    activeBadge: 'bg-emerald-200 text-emerald-900',
  },
  violet: {
    icon: 'text-violet-300',
    activeRing: 'ring-2 ring-violet-400 ring-offset-2',
    activeBadge: 'bg-violet-200 text-violet-900',
  },
};

const unpaidBadgeClass =
  'inline-flex rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-700';

const paidBadgeClass =
  'inline-flex rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-700';

function SummaryMetricCard({
  label,
  primary,
  primaryDate,
  secondary,
  tertiary,
  icon: Icon,
  tone = 'neutral',
  primaryBadge,
  secondaryBadge,
  filterKey,
  active = false,
  onFilterToggle,
  filterDisabled = false,
}: {
  label: string;
  primary: string;
  primaryDate?: string | null;
  secondary?: string;
  tertiary?: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: SummaryCardTone;
  primaryBadge?: 'dueDate';
  secondaryBadge?: 'unpaid' | 'paid';
  filterKey?: PaymentPlanSummaryFilter;
  active?: boolean;
  onFilterToggle?: (filter: PaymentPlanSummaryFilter) => void;
  filterDisabled?: boolean;
}) {
  const colors = SUMMARY_CARD_TONES[tone];
  const isFilterable = Boolean(filterKey && onFilterToggle && !filterDisabled);
  const cardClassName = [
    'relative rounded-2xl border border-slate-200 bg-white p-4 shadow-sm text-left w-full',
    isFilterable ? 'cursor-pointer transition-all hover:shadow-md' : '',
    active ? colors.activeRing : '',
  ]
    .filter(Boolean)
    .join(' ');

  const content = (
    <>
      <Icon className={`absolute right-4 top-4 h-12 w-12 ${colors.icon}`} aria-hidden />
      <p className="pr-14 text-sm font-bold text-slate-500 flex flex-wrap items-center gap-2">
        <span>{label}</span>
        {active ? (
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${colors.activeBadge}`}
          >
            Filtering
          </span>
        ) : isFilterable ? (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Click to filter</span>
        ) : null}
      </p>
      {primaryBadge === 'dueDate' ? (
        <div className="mt-1.5">
          <DueDateBadge date={primaryDate} className="!text-lg px-3.5 py-2" />
        </div>
      ) : (
        <p className="mt-1 text-2xl font-bold text-slate-900">{primary}</p>
      )}
      {secondary ? (
        secondaryBadge === 'unpaid' ? (
          <p className="mt-1.5">
            <span className={unpaidBadgeClass}>{secondary}</span>
          </p>
        ) : secondaryBadge === 'paid' ? (
          <p className="mt-1.5">
            <span className={paidBadgeClass}>{secondary}</span>
          </p>
        ) : (
          <p className="mt-1 truncate text-sm text-slate-400">{secondary}</p>
        )
      ) : null}
      {tertiary ? <p className="mt-1 truncate text-sm text-slate-400">{tertiary}</p> : null}
    </>
  );

  if (isFilterable && filterKey && onFilterToggle) {
    return (
      <button
        type="button"
        className={cardClassName}
        aria-pressed={active}
        title={active ? `Clear ${label.toLowerCase()} filter` : `Show only ${label.toLowerCase()} payments`}
        onClick={() => onFilterToggle(filterKey)}
      >
        {content}
      </button>
    );
  }

  return <div className={cardClassName}>{content}</div>;
}

export function PaymentPlanSummaryCards({
  summary,
  getCurrencySymbol,
  contractTotalNis,
  expenseNoVatNis,
  outstandingNis,
  activeFilter = null,
  onFilterToggle,
}: SummaryCardsProps) {
  const total =
    contractTotalNis?.loading
      ? { primary: '…' }
      : contractTotalNis ?? formatMultiCurrencyAmounts(summary.totalByCurrency, getCurrencySymbol, {
          includeVatLine: true,
        });
  const expenseNoVatAmounts = formatMultiCurrencyAmounts(
    summary.expenseNoVatByCurrency,
    getCurrencySymbol,
    { emphasizeGross: true },
  );
  const expenseNoVatLine =
    expenseNoVatNis?.loading
      ? '…'
      : expenseNoVatNis?.primary
        ? `+ ${expenseNoVatNis.primary} expenses (no VAT)`
        : expenseNoVatAmounts.primary !== '—'
          ? `+ ${expenseNoVatAmounts.primary} expenses (no VAT)`
          : undefined;
  const outstanding =
    outstandingNis?.loading
      ? { primary: '…' }
      : outstandingNis ?? formatMultiCurrencyAmounts(summary.outstandingByCurrency, getCurrencySymbol, {
          emphasizeGross: true,
        });
  const paid = formatMultiCurrencyAmounts(summary.paidByCurrency, getCurrencySymbol, {
    emphasizeGross: true,
  });

  const nextDue = summary.nextDuePayment;
  const nextDueDate = nextDue?.dueDate ? formatDateDDMMYYYY(nextDue.dueDate) : '—';
  const nextDueLabel = nextDue?.order || '—';
  const nextDueAmount = nextDue
    ? `${getCurrencySymbol(nextDue.currency)}${(Number(nextDue.value) + Number(nextDue.valueVat)).toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      })}`
    : '—';

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <SummaryMetricCard
        label="Total contract value"
        primary={total.primary}
        secondary={total.secondary}
        tertiary={expenseNoVatLine}
        icon={BanknotesIcon}
        tone="neutral"
      />

      <SummaryMetricCard
        label="Outstanding"
        primary={outstanding.primary}
        secondary={`${summary.unpaidCount} unpaid payment${summary.unpaidCount === 1 ? '' : 's'}`}
        icon={PaperAirplaneIcon}
        tone="amber"
        secondaryBadge="unpaid"
        filterKey="outstanding"
        active={activeFilter === 'outstanding'}
        onFilterToggle={onFilterToggle}
        filterDisabled={summary.unpaidCount === 0}
      />

      <SummaryMetricCard
        label="Paid"
        primary={paid.primary}
        secondary={`${summary.paidCount} payment${summary.paidCount === 1 ? '' : 's'} completed`}
        icon={CurrencyDollarIcon}
        tone="emerald"
        secondaryBadge="paid"
        filterKey="paid"
        active={activeFilter === 'paid'}
        onFilterToggle={onFilterToggle}
        filterDisabled={summary.paidCount === 0}
      />

      <SummaryMetricCard
        label="Next due"
        primary={nextDueDate}
        primaryDate={nextDue?.dueDate}
        primaryBadge="dueDate"
        secondary={`${nextDueLabel} · ${nextDueAmount}`}
        icon={ClockIcon}
        tone="violet"
        filterKey="nextDue"
        active={activeFilter === 'nextDue'}
        onFilterToggle={onFilterToggle}
        filterDisabled={!nextDue}
      />
    </div>
  );
}

export function ContactPlanHeader({
  contactName,
  payments,
  collapsed,
  onToggle,
  totalNis,
  profileImageUrl,
  automationActiveCount = 0,
  onPaymentHistoryClick,
  paymentHistoryActive = false,
}: {
  contactName: string;
  payments: PaymentPlanRowLike[];
  collapsed: boolean;
  onToggle: () => void;
  /** Sum of row totals (value + VAT) in NIS — BOI rate per row at payment/due date. */
  totalNis?: { primary: string; loading?: boolean };
  profileImageUrl?: string | null;
  automationActiveCount?: number;
  onPaymentHistoryClick?: () => void;
  paymentHistoryActive?: boolean;
}) {
  const stats = computePlanSummary(payments);
  const initials = contactInitials(contactName);
  const avatarStyle = getContactAccentSoftStyle(contactName);
  const hasProfileImage = Boolean(profileImageUrl?.trim());

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-1 items-start gap-4">
        <button
          type="button"
          className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-full font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 ${
            hasProfileImage ? 'p-1' : 'text-lg'
          }`}
          style={avatarStyle}
          onClick={onToggle}
          aria-label={collapsed ? 'Expand payment plan' : 'Collapse payment plan'}
        >
          {hasProfileImage ? (
            <ContactProfileAvatar
              name={contactName}
              imageUrl={profileImageUrl}
              className="h-full w-full text-base"
            />
          ) : (
            initials
          )}
        </button>
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
            <button
              type="button"
              className="truncate text-left text-lg font-bold leading-tight text-slate-900 hover:text-slate-700"
              onClick={onToggle}
            >
              {contactName}
            </button>
            {totalNis ? (
              <>
                <span className="text-slate-300" aria-hidden>
                  |
                </span>
                <span className="text-sm font-semibold leading-snug text-slate-600">
                  Total{' '}
                  <span className="tabular-nums">
                    {totalNis.loading ? '…' : totalNis.primary}
                  </span>
                </span>
              </>
            ) : null}
          </div>
          <button type="button" className="mt-0.5 block w-full text-left" onClick={onToggle}>
            <p className="text-sm leading-snug text-slate-500">
              {stats.scheduledCount} scheduled · {stats.paidCount} paid · {stats.unpaidCount} outstanding
            </p>
          </button>
        </div>
      </div>
      <div className="w-full sm:w-auto sm:min-w-[16rem] sm:pt-0.5">
        <div className="flex flex-wrap items-center justify-end gap-2 mb-1.5">
          {automationActiveCount > 0 && (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700"
              title="Scheduled invoice send on due date"
            >
              Auto invoice · {automationActiveCount}
            </span>
          )}
          <span className="text-sm font-medium text-slate-500">Payment progress</span>
          <span className="text-sm font-semibold text-slate-600">{stats.progressPct}%</span>
        </div>
        <div className="h-2 rounded-full bg-slate-100">
          <div
            className="h-2 rounded-full bg-emerald-500 transition-all"
            style={{ width: `${stats.progressPct}%` }}
          />
        </div>
        {onPaymentHistoryClick ? (
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              className={`btn btn-xs btn-ghost h-7 min-h-7 rounded-lg px-2 normal-case ${
                paymentHistoryActive
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-indigo-700 hover:bg-indigo-50'
              }`}
              onClick={onPaymentHistoryClick}
            >
              Payment history
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
