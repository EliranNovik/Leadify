import React, { useMemo, useState } from 'react';
import { DocumentTextIcon } from '@heroicons/react/24/outline';
import { buildPaymentPagePath } from '../../../lib/proformaPaymentLink';
import { buildPublicProformaUrl } from '../../../lib/proformaPublicLink';
import type { PortalPaymentRow, PortalProformaRow } from '../../../lib/portalApi';
import {
  getPortalTabHeaderCoverImage,
  PortalCard,
  PortalDueDateBadge,
  PortalOriginallyDueText,
  PortalOverdueBadge,
  PortalPaidBadge,
  PortalPaidDateBadge,
  PortalSectionLabel,
  PortalTabFrame,
  isPaymentOverdue,
} from '../components/portalTheme';

function formatMoney(amount: number, currency: string | null): string {
  const sym = currency?.trim() || '₪';
  return `${sym}${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(d: string | null | undefined): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString();
  } catch {
    return d;
  }
}

function isPaidPayment(p: PortalPaymentRow): boolean {
  return p.paid === true || !!p.paid_at;
}

type FinanceFilter = 'outstanding' | 'paid';

function paymentOrderTitle(order: string | number | null | undefined): string {
  if (order == null || order === '') return 'Payment';
  if (typeof order === 'string') {
    const lower = order.toLowerCase();
    if (
      lower.includes('first') ||
      lower.includes('intermediate') ||
      lower.includes('final') ||
      lower.includes('single') ||
      lower.includes('expense')
    ) {
      return order;
    }
    const num = parseInt(order, 10);
    if (!Number.isNaN(num)) order = num;
    else return order;
  }
  if (typeof order === 'number') {
    switch (order) {
      case 1:
        return 'First Payment';
      case 5:
        return 'Intermediate Payment';
      case 9:
        return 'Final Payment';
      case 90:
        return 'Single Payment';
      case 99:
        return 'Expense (no VAT)';
      default:
        return 'Payment';
    }
  }
  return 'Payment';
}

type PaidInvoiceItem = {
  key: string;
  label: string;
  amount: number;
  currency: string | null;
  paidAt: string | null;
  url: string;
};

type Props = {
  payments: PortalPaymentRow[];
  proformas: PortalProformaRow[];
  isLegacy: boolean;
};

const PortalFinanceTab: React.FC<Props> = ({ payments, proformas, isLegacy }) => {
  const outstanding = useMemo(
    () =>
      payments
        .filter((p) => !isPaidPayment(p))
        .sort((a, b) => {
          const da = a.due_date ? new Date(a.due_date).getTime() : 0;
          const db = b.due_date ? new Date(b.due_date).getTime() : 0;
          return da - db;
        }),
    [payments],
  );

  const paid = useMemo(
    () =>
      payments
        .filter(isPaidPayment)
        .sort((a, b) => {
          const pa = a.paid_at ? new Date(a.paid_at).getTime() : 0;
          const pb = b.paid_at ? new Date(b.paid_at).getTime() : 0;
          return pb - pa;
        }),
    [payments],
  );

  const [activeFilter, setActiveFilter] = useState<FinanceFilter>(() =>
    outstanding.length > 0 ? 'outstanding' : 'paid',
  );

  const filteredPayments = useMemo(() => {
    if (activeFilter === 'outstanding') return outstanding;
    return paid;
  }, [activeFilter, outstanding, paid]);

  const filterOptions: Array<{ id: FinanceFilter; label: string; count: number }> = [
    { id: 'outstanding', label: 'Outstanding', count: outstanding.length },
    { id: 'paid', label: 'Paid', count: paid.length },
  ];

  const tabBase =
    'inline-flex shrink-0 items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium transition-colors whitespace-nowrap';
  const tabActive = `${tabBase} bg-primary text-primary-content shadow-sm`;
  const tabIdle = `${tabBase} border border-gray-200 bg-white text-base-content/70 hover:bg-gray-50`;

  const emptyFilterMessage: Record<FinanceFilter, string> = {
    outstanding: 'No outstanding payments.',
    paid: 'No completed payments yet.',
  };

  const buildInvoicePath = (p: PortalPaymentRow): string | null => {
    if (!p.public_token?.trim()) return null;
    const leadType = p.is_legacy ? 'legacy' : 'new';
    const docId = p.is_legacy ? (p.proforma_id ?? p.id) : p.id;
    return buildPublicProformaUrl(leadType, docId, p.public_token).replace(window.location.origin, '');
  };

  const paidInvoices = useMemo((): PaidInvoiceItem[] => {
    const items: PaidInvoiceItem[] = [];

    for (const p of paid) {
      const invoicePath = buildInvoicePath(p);
      if (!invoicePath) continue;
      const amount = Number(p.value || 0) + Number(p.value_vat || 0);
      items.push({
        key: `payment-${p.id}`,
        label: `Invoice — ${formatMoney(amount, p.currency)}`,
        amount,
        currency: p.currency,
        paidAt: p.paid_at,
        url: buildPublicProformaUrl(
          p.is_legacy ? 'legacy' : 'new',
          p.is_legacy ? (p.proforma_id ?? p.id) : p.id,
          p.public_token!,
        ),
      });
    }

    for (const pf of proformas) {
      if (!pf.public_token) continue;
      const amount = Number(pf.value || 0) + Number(pf.value_vat || 0);
      items.push({
        key: `proforma-${pf.id}`,
        label: amount > 0 ? `Invoice #${pf.id} — ${formatMoney(amount, pf.currency ?? null)}` : `Invoice #${pf.id}`,
        amount,
        currency: pf.currency ?? null,
        paidAt: pf.paid_at ?? pf.created_at ?? null,
        url: buildPublicProformaUrl('legacy', pf.id, pf.public_token),
      });
    }

    return items.sort((a, b) => {
      const ta = a.paidAt ? new Date(a.paidAt).getTime() : 0;
      const tb = b.paidAt ? new Date(b.paidAt).getTime() : 0;
      return tb - ta;
    });
  }, [paid, proformas, isLegacy]);

  const renderOutstandingRow = (p: PortalPaymentRow) => {
    const total = Number(p.value || 0) + Number(p.value_vat || 0);
    const payPath = p.secure_token ? buildPaymentPagePath(p.secure_token) : null;
    const proformaPath = buildInvoicePath(p);
    const overdue = isPaymentOverdue(p.due_date);

    return (
      <PortalCard key={p.id}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="font-semibold text-base-content/90">{paymentOrderTitle(p.order)}</p>
          {overdue ? <PortalOverdueBadge /> : null}
        </div>
        <div className="mt-2">
          <p className="font-bold text-base-content/90">{formatMoney(total, p.currency)}</p>
          <div className="mt-2">
            <PortalDueDateBadge date={p.due_date} overdue={overdue} />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {payPath && (
            <a href={payPath} className="btn btn-sm btn-primary" target="_blank" rel="noopener noreferrer">
              Pay online
            </a>
          )}
          {proformaPath && (
            <a href={proformaPath} className="btn btn-sm btn-outline" target="_blank" rel="noopener noreferrer">
              View invoice
            </a>
          )}
        </div>
      </PortalCard>
    );
  };

  const renderPaidRow = (p: PortalPaymentRow) => {
    const total = Number(p.value || 0) + Number(p.value_vat || 0);
    const invoicePath = buildInvoicePath(p);
    const taxReceiptLink = p.payper_invoice_link?.trim() || null;

    return (
      <PortalCard key={p.id}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="font-semibold text-base-content/90">{paymentOrderTitle(p.order)}</p>
          <PortalPaidBadge />
        </div>
        <div className="mt-2">
          <p className="font-bold text-base-content/90">{formatMoney(total, p.currency)}</p>
          <div className="mt-2">
            <PortalPaidDateBadge date={p.paid_at} />
          </div>
          <PortalOriginallyDueText date={p.due_date} />
        </div>
        {(invoicePath || taxReceiptLink) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {invoicePath && (
              <a href={invoicePath} className="btn btn-sm btn-outline" target="_blank" rel="noopener noreferrer">
                View invoice
              </a>
            )}
            {taxReceiptLink && (
              <a
                href={taxReceiptLink}
                className="btn btn-sm btn-outline"
                target="_blank"
                rel="noopener noreferrer"
                title={
                  p.payper_invoice_number
                    ? `Tax receipt #${p.payper_invoice_number}`
                    : 'View tax receipt'
                }
              >
                {p.payper_invoice_number ? `Tax receipt #${p.payper_invoice_number}` : 'Tax receipt'}
              </a>
            )}
          </div>
        )}
      </PortalCard>
    );
  };

  return (
    <PortalTabFrame
      title="Finance"
      subtitle="Outstanding payments, invoices, and payment history."
      headerCoverImage={getPortalTabHeaderCoverImage('finance')}
    >
      <nav className="-mx-1 overflow-x-auto px-1 pb-1" aria-label="Finance filters">
        <div className="flex min-w-max items-center gap-2">
          {filterOptions.map((option) => {
            const isActive = activeFilter === option.id;
            return (
              <button
                key={option.id}
                type="button"
                className={isActive ? tabActive : tabIdle}
                onClick={() => setActiveFilter(option.id)}
                aria-current={isActive ? 'true' : undefined}
              >
                <span>{option.label}</span>
                <span
                  className={`badge badge-sm border-none ${
                    isActive ? 'bg-white/20 text-primary-content' : 'bg-primary/10 text-primary'
                  }`}
                >
                  {option.count}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      <section className="space-y-5">
        <PortalSectionLabel>
          {activeFilter === 'outstanding' ? 'Outstanding' : 'Payment history'}
        </PortalSectionLabel>
        {filteredPayments.length > 0 ? (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {filteredPayments.map((p) =>
              isPaidPayment(p) ? renderPaidRow(p) : renderOutstandingRow(p),
            )}
          </div>
        ) : (
          <PortalCard>
            <p className="text-sm text-base-content/45">{emptyFilterMessage[activeFilter]}</p>
          </PortalCard>
        )}
      </section>

      <section className="space-y-5">
        <PortalSectionLabel>Paid invoices</PortalSectionLabel>
        {paidInvoices.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {paidInvoices.map((inv) => (
              <a
                key={inv.key}
                href={inv.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 rounded-[18px] bg-white px-4 py-4 transition-colors hover:bg-base-200/30 md:px-5"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <DocumentTextIcon className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-base-content/90">{inv.label}</span>
                  <span className="mt-0.5 block text-xs text-base-content/45">Paid {formatDate(inv.paidAt)}</span>
                </span>
                <span className="shrink-0 text-sm font-medium text-primary">View →</span>
              </a>
            ))}
          </div>
        ) : (
          <PortalCard>
            <p className="text-sm text-base-content/45">Invoices will appear here after payments are completed.</p>
          </PortalCard>
        )}
      </section>
    </PortalTabFrame>
  );
};

export default PortalFinanceTab;
