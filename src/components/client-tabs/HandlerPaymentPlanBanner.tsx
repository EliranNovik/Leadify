import React from 'react';
import { ExclamationTriangleIcon, PaperAirplaneIcon } from '@heroicons/react/24/outline';

/** Stage 105 banner: hide while loading (null); show missing only when explicitly false. */
export function shouldShowHandlerPaymentBanner(
  hasPaymentPlan: boolean | null | undefined,
  nextDuePayment: unknown,
): boolean {
  if (hasPaymentPlan === null || hasPaymentPlan === undefined) return false;
  if (hasPaymentPlan === false) return true;
  return Boolean(nextDuePayment);
}

export function isMissingPaymentPlanBanner(hasPaymentPlan: boolean | null | undefined): boolean {
  return hasPaymentPlan === false;
}

type HandlerPaymentPlanBannerProps = {
  hasPaymentPlan: boolean | null | undefined;
  nextDuePayment: any;
  /** Compact chip for use next to tab page titles. */
  variant?: 'card' | 'inline';
  className?: string;
};

export function HandlerPaymentPlanBanner({
  hasPaymentPlan,
  nextDuePayment,
  variant = 'inline',
  className = '',
}: HandlerPaymentPlanBannerProps) {
  if (!shouldShowHandlerPaymentBanner(hasPaymentPlan, nextDuePayment)) return null;

  if (isMissingPaymentPlanBanner(hasPaymentPlan)) {
    const missingClass =
      variant === 'inline'
        ? 'inline-flex max-w-full flex-wrap items-center gap-2 rounded-full border-0 bg-gray-50 px-3 py-1.5 text-slate-800'
        : 'w-full max-w-xl rounded-2xl border-0 bg-gray-50 px-4 py-3 text-slate-800';
    return (
      <div className={`${missingClass} ${className}`.trim()}>
        <div className="flex items-center gap-2 text-sm font-semibold">
          <ExclamationTriangleIcon className="h-4 w-4 shrink-0 sm:h-5 sm:w-5" />
          Missing payment plan
        </div>
        <div className="text-xs text-slate-500 whitespace-nowrap">Finances → payment plan</div>
      </div>
    );
  }

  const isLegacy = !!nextDuePayment?.isLegacy;
  const base = Number(nextDuePayment?.value ?? 0);
  const vat = Number(isLegacy ? nextDuePayment?.vat_value ?? 0 : nextDuePayment?.value_vat ?? 0);
  const gross = (Number.isFinite(base) ? base : 0) + (Number.isFinite(vat) ? vat : 0);
  const currency =
    nextDuePayment?.currency ??
    nextDuePayment?.accounting_currencies?.iso_code ??
    nextDuePayment?.accounting_currencies?.name ??
    '';
  const dateRaw = nextDuePayment?.due_date ?? nextDuePayment?.date ?? null;
  const dateLabel = dateRaw ? new Date(dateRaw).toLocaleDateString() : '—';
  const amountLabel = Number.isFinite(gross)
    ? gross.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })
    : '0';
  const ready =
    nextDuePayment?.ready_to_pay === true || (isLegacy && !!nextDuePayment?.due_date ? true : false);
  const by =
    nextDuePayment?.ready_to_pay_by_display_name ??
    nextDuePayment?.tenants_employee?.display_name ??
    nextDuePayment?.updated_by ??
    nextDuePayment?.paid_by ??
    '—';

  const shellClass =
    variant === 'inline'
      ? 'inline-flex max-w-full flex-wrap items-center gap-x-2.5 gap-y-1 rounded-full border-0 bg-gray-50 px-3 py-1.5 text-slate-800'
      : 'w-full max-w-xl rounded-2xl border-0 bg-gray-50 px-4 py-3 text-slate-800';

  return (
    <div className={`${shellClass} ${className}`.trim()}>
      <span className="text-sm font-semibold whitespace-nowrap">Next payment due</span>
      <span className="text-sm tabular-nums whitespace-nowrap">
        <span className="font-semibold">
          {currency ? `${currency} ` : ''}
          {amountLabel}
        </span>
        {' · '}
        <span className="text-slate-500">{dateLabel}</span>
      </span>
      {ready ? (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span
            className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-sky-50 text-sky-700"
            title={`Sent to finance${by && by !== '—' ? ` by ${String(by)}` : ''}`}
            aria-label={`Sent to finance${by && by !== '—' ? ` by ${String(by)}` : ''}`}
          >
            <PaperAirplaneIcon className="h-4 w-4" />
          </span>
          {by && by !== '—' ? (
            <span className="text-xs text-slate-500">
              by <span className="font-semibold text-slate-700">{String(by)}</span>
            </span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
