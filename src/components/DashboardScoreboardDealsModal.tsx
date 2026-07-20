import React, { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { XMarkIcon } from '@heroicons/react/24/outline';

export type DashboardScoreboardDeal = {
  id: string;
  leadId: string;
  leadNumber: string;
  name: string;
  /** Invoiced only: contact the payment row belongs to. */
  contactName?: string | null;
  date: string;
  amountNis: number;
  subcontractorFeeNis?: number;
  departmentName: string;
  categoryLabel?: string;
  /** Closer (agreement) or Handler (invoiced). */
  roleName?: string;
  rolePhotoUrl?: string | null;
  roleEmployeeId?: string | null;
  source: 'agreement' | 'invoiced';
  isNewLead?: boolean;
};

export type DashboardScoreboardDealsModalProps = {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  deals: DashboardScoreboardDeal[];
  /** Which role column to show. Defaults from first deal source. */
  roleColumn?: 'closer' | 'handler';
  /** True while deal rows are still being fetched. */
  loading?: boolean;
};

function formatNis(amount: number): string {
  return `₪${Math.ceil(amount || 0).toLocaleString()}`;
}

function formatDate(value: string): string {
  if (!value) return '—';
  const day = value.includes('T') ? value.split('T')[0] : value;
  const [y, m, d] = day.split('-');
  if (!y || !m || !d) return value;
  return `${d}/${m}/${y}`;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase();
}

function RoleCell({ name, photoUrl }: { name?: string; photoUrl?: string | null }) {
  const label = (name || '').trim();
  const [imgFailed, setImgFailed] = React.useState(false);
  React.useEffect(() => {
    setImgFailed(false);
  }, [photoUrl]);

  if (!label && !photoUrl) {
    return <span className="text-slate-400">—</span>;
  }

  const showPhoto = Boolean(photoUrl) && !imgFailed;

  return (
    <div className="flex items-center gap-2 min-w-0">
      {showPhoto ? (
        <img
          src={photoUrl!}
          alt=""
          className="h-8 w-8 shrink-0 rounded-full object-cover bg-slate-100"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[11px] font-semibold text-slate-600">
          {getInitials(label || '?')}
        </span>
      )}
      <span className="truncate text-slate-800" title={label || undefined}>
        {label || '—'}
      </span>
    </div>
  );
}

const DashboardScoreboardDealsModal: React.FC<DashboardScoreboardDealsModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  deals,
  roleColumn,
  loading = false,
}) => {
  const navigate = useNavigate();

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, onClose]);

  const resolvedRoleColumn =
    roleColumn ?? (deals.some((d) => d.source === 'invoiced') ? 'handler' : 'closer');
  const roleHeader = resolvedRoleColumn === 'handler' ? 'Handler' : 'Closer';
  const showContactColumn = deals.some((d) => d.source === 'invoiced') || resolvedRoleColumn === 'handler';

  const sortedDeals = useMemo(() => {
    return [...deals].sort((a, b) => {
      const dateCmp = String(b.date || '').localeCompare(String(a.date || ''));
      if (dateCmp !== 0) return dateCmp;
      return String(a.leadNumber || '').localeCompare(String(b.leadNumber || ''));
    });
  }, [deals]);

  const totalAmount = useMemo(
    () => sortedDeals.reduce((sum, deal) => sum + (deal.amountNis || 0), 0),
    [sortedDeals],
  );
  const totalFee = useMemo(
    () => sortedDeals.reduce((sum, deal) => sum + (deal.subcontractorFeeNis || 0), 0),
    [sortedDeals],
  );

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-6" role="presentation">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <div
        className="relative z-10 flex w-full max-w-6xl max-h-[min(90vh,820px)] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dashboard-scoreboard-deals-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <h2 id="dashboard-scoreboard-deals-title" className="truncate text-lg font-bold text-slate-900">
              {title}
            </h2>
            {subtitle ? <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p> : null}
            {!loading ? (
              <p className="mt-1 text-sm font-medium text-slate-700">
                {sortedDeals.length} deal{sortedDeals.length === 1 ? '' : 's'} · {formatNis(totalAmount)}
                {totalFee > 0 ? (
                  <span className="font-normal text-slate-500"> ({formatNis(totalFee)})</span>
                ) : null}
              </p>
            ) : (
              <p className="mt-1 text-sm text-slate-500">Loading deals…</p>
            )}
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-circle btn-sm shrink-0"
            onClick={onClose}
            aria-label="Close"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-3 px-5 py-16 text-slate-500">
              <span className="loading loading-spinner loading-md text-slate-400" aria-hidden />
              <span className="text-sm">Loading deals…</span>
            </div>
          ) : sortedDeals.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-slate-500">No deals for this cell.</div>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Lead</th>
                  {showContactColumn ? <th className="px-4 py-3">Contact</th> : null}
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">{roleHeader}</th>
                  <th className="px-4 py-3">Department</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3 text-right">Amount (NIS)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedDeals.map((deal) => {
                  const fee = deal.subcontractorFeeNis || 0;
                  const leadLabel = deal.leadNumber || deal.leadId;
                  return (
                    <tr
                      key={deal.id}
                      className="cursor-pointer hover:bg-slate-50"
                      onClick={() => {
                        onClose();
                        const navKey = deal.leadNumber || deal.leadId;
                        navigate(`/clients/${encodeURIComponent(navKey)}`);
                      }}
                      title="Open lead"
                    >
                      <td className="px-4 py-3 max-w-[14rem]">
                        <div className="font-mono text-slate-700 whitespace-nowrap">{leadLabel || '—'}</div>
                        <div className="mt-0.5 truncate text-slate-800" title={deal.name || undefined}>
                          {deal.name || '—'}
                        </div>
                      </td>
                      {showContactColumn ? (
                        <td className="px-4 py-3 text-slate-700 max-w-[12rem] truncate" title={deal.contactName || undefined}>
                          {deal.contactName || '—'}
                        </td>
                      ) : null}
                      <td className="px-4 py-3 text-slate-600 max-w-[14rem] truncate" title={deal.categoryLabel || undefined}>
                        {deal.categoryLabel || '—'}
                      </td>
                      <td className="px-4 py-3 min-w-[10rem]">
                        <RoleCell name={deal.roleName} photoUrl={deal.rolePhotoUrl} />
                      </td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{deal.departmentName || '—'}</td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{formatDate(deal.date)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-800 whitespace-nowrap">
                        {formatNis(deal.amountNis)}
                        {fee > 0 ? (
                          <span className="ml-1 font-normal text-slate-500">({formatNis(fee)})</span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex justify-end border-t border-slate-200 px-5 py-3">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default DashboardScoreboardDealsModal;

/** Build lookup key for scoreboard cell deals. */
export function scoreboardDealsCellKey(period: string, departmentName: string): string {
  return `${period}::${departmentName}`;
}

export function appendScoreboardDeal(
  store: Map<string, DashboardScoreboardDeal[]>,
  period: string,
  departmentName: string,
  deal: DashboardScoreboardDeal,
): void {
  if (!period || !departmentName) return;
  const key = scoreboardDealsCellKey(period, departmentName);
  const list = store.get(key);
  if (list) {
    const baseId = scoreboardDealPaymentBaseId(deal.id);
    const contentKey = scoreboardDealContentKey(deal);
    if (
      list.some((existing) => {
        if (baseId && scoreboardDealPaymentBaseId(existing.id) === baseId) return true;
        // Same lead/date/amount/contact — e.g. legacy + new payment rows for one installment.
        if (contentKey && scoreboardDealContentKey(existing) === contentKey) return true;
        return false;
      })
    ) {
      return;
    }
    list.push(deal);
  } else {
    store.set(key, [deal]);
  }
}

/** Stable payment id from a deal id like `legpay-123::Last30d` or `legpay-123::Last30d::total`. */
export function scoreboardDealPaymentBaseId(dealId: string): string {
  if (!dealId) return '';
  const match = dealId.match(/^(?:legpay|newpay)-[^:]+/i);
  if (match) return match[0];
  return dealId.split('::')[0] || dealId;
}

function scoreboardDealContentKey(deal: DashboardScoreboardDeal): string {
  if (deal.source !== 'invoiced') return '';
  return [
    deal.leadNumber || deal.leadId || '',
    deal.date || '',
    String(Math.round(deal.amountNis || 0)),
  ].join('|');
}
