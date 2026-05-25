import React from 'react';

export type PaymentPlanRowLike = {
  id: string | number;
  dueDate?: string;
  value: number;
  valueVat: number;
  paid?: boolean;
  ready_to_pay?: boolean;
  currency?: string;
  order?: string;
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
  nextDuePayment: PaymentPlanRowLike | null;
}

export function computePlanSummary(payments: PaymentPlanRowLike[]): PlanSummaryStats {
  const scheduledCount = payments.length;
  const paidCount = payments.filter((p) => p.paid).length;
  const unpaidCount = scheduledCount - paidCount;
  const progressPct = scheduledCount > 0 ? Math.round((paidCount / scheduledCount) * 100) : 0;

  const unpaidPayments = payments.filter((p) => !p.paid);
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
    totalByCurrency: sumByCurrency(payments),
    paidByCurrency: sumByCurrency(payments, (p) => !!p.paid),
    outstandingByCurrency: sumByCurrency(payments, (p) => !p.paid),
    nextDuePayment,
  };
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

export function PaymentStatusPill({
  paid,
  readyToPay,
}: {
  paid: boolean;
  readyToPay?: boolean;
}) {
  if (paid) {
    return (
      <span className="inline-flex rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
        Paid
      </span>
    );
  }
  if (readyToPay) {
    return (
      <span className="inline-flex rounded-full border border-sky-100 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">
        Sent to finance
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-full border border-amber-100 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
      Unpaid
    </span>
  );
}

type SummaryCardsProps = {
  summary: PlanSummaryStats;
  getCurrencySymbol: (currency: string | undefined) => string;
};

export function PaymentPlanSummaryCards({ summary, getCurrencySymbol }: SummaryCardsProps) {
  const total = formatMultiCurrencyAmounts(summary.totalByCurrency, getCurrencySymbol, {
    includeVatLine: true,
  });
  const outstanding = formatMultiCurrencyAmounts(summary.outstandingByCurrency, getCurrencySymbol, {
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
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-medium text-slate-500">Total contract value</p>
        <p className="mt-1 text-xl font-bold text-slate-900">{total.primary}</p>
        {total.secondary ? <p className="mt-0.5 text-xs text-slate-400">{total.secondary}</p> : null}
      </div>

      <div className="rounded-2xl border border-orange-100 bg-orange-50 p-4 shadow-sm">
        <p className="text-xs font-medium text-orange-600">Outstanding</p>
        <p className="mt-1 text-xl font-bold text-orange-700">{outstanding.primary}</p>
        <p className="mt-0.5 text-xs text-orange-500">
          {summary.unpaidCount} unpaid payment{summary.unpaidCount === 1 ? '' : 's'}
        </p>
      </div>

      <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 shadow-sm">
        <p className="text-xs font-medium text-emerald-600">Paid</p>
        <p className="mt-1 text-xl font-bold text-emerald-700">{paid.primary}</p>
        <p className="mt-0.5 text-xs text-emerald-500">
          {summary.paidCount} payment{summary.paidCount === 1 ? '' : 's'} completed
        </p>
      </div>

      <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4 shadow-sm">
        <p className="text-xs font-medium text-indigo-600">Next due</p>
        <p className="mt-1 text-xl font-bold text-indigo-700">{nextDueDate}</p>
        <p className="mt-0.5 truncate text-xs text-indigo-500">
          {nextDueLabel} · {nextDueAmount}
        </p>
      </div>
    </div>
  );
}

export function ContactPlanHeader({
  contactName,
  payments,
  collapsed,
  onToggle,
}: {
  contactName: string;
  payments: PaymentPlanRowLike[];
  collapsed: boolean;
  onToggle: () => void;
}) {
  const stats = computePlanSummary(payments);
  return (
    <div className="mb-4 flex flex-col gap-4 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        onClick={onToggle}
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white">
          <span className="text-sm font-bold">{contactName.charAt(0).toUpperCase()}</span>
        </div>
        <div className="min-w-0">
          <h3 className="truncate text-lg font-bold text-slate-900">{contactName}</h3>
          <p className="text-sm text-slate-500">
            {stats.scheduledCount} scheduled · {stats.paidCount} paid · {stats.unpaidCount} outstanding
          </p>
        </div>
      </button>
      <div className="w-full sm:w-64">
        <div className="mb-1 flex justify-between text-xs text-slate-500">
          <span>Payment progress</span>
          <span>{stats.progressPct}%</span>
        </div>
        <div className="h-2 rounded-full bg-slate-100">
          <div
            className="h-2 rounded-full bg-emerald-500 transition-all"
            style={{ width: `${stats.progressPct}%` }}
          />
        </div>
        <p className="mt-2 text-right text-xs text-slate-400">{collapsed ? 'Expand' : 'Collapse'}</p>
      </div>
    </div>
  );
}
