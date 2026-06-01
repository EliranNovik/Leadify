import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { XMarkIcon, UserGroupIcon } from '@heroicons/react/24/outline';
import type { MarketingLeadBreakdownRow } from '../lib/marketingDashboardBreakdown';

export interface MarketingDashboardLeadBreakdownModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  rows: MarketingLeadBreakdownRow[];
  formatMoney: (n: number) => string;
}

const MarketingDashboardLeadBreakdownModal: React.FC<MarketingDashboardLeadBreakdownModalProps> = ({
  isOpen,
  onClose,
  title,
  rows,
  formatMoney,
}) => {
  const navigate = useNavigate();
  const totalValue = rows.reduce((sum, r) => sum + r.totalValueNis, 0);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const clientPath = (leadNumber: string) => `/clients/${encodeURIComponent(leadNumber)}`;

  const openLead = (row: MarketingLeadBreakdownRow, e: React.MouseEvent) => {
    const path = clientPath(row.leadNumber);
    if (e.ctrlKey || e.metaKey) {
      window.open(path, '_blank', 'noopener,noreferrer');
      return;
    }
    navigate(path);
    onClose();
  };

  return (
    <dialog open className="modal modal-open z-[10050]">
      <div className="modal-box w-[min(92vw,48rem)] max-w-none max-h-[88vh] flex flex-col p-0">
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-base-300 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <UserGroupIcon className="w-7 h-7 text-primary shrink-0" />
            <h2 className="text-xl font-bold truncate">{title}</h2>
          </div>
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm btn-circle shrink-0">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-3 text-base text-base-content/70 border-b border-base-200 shrink-0 flex flex-wrap gap-x-5 gap-y-1">
          <span>
            <strong className="text-base-content">{rows.length}</strong> lead{rows.length === 1 ? '' : 's'}
          </span>
          <span>
            Total value: <strong className="text-base-content">{formatMoney(totalValue)}</strong>
          </span>
        </div>

        <div className="overflow-auto flex-1 min-h-0 px-6 py-5">
          {rows.length === 0 ? (
            <p className="text-center text-base text-base-content/60 py-10">No leads in this breakdown.</p>
          ) : (
            <table className="table table-zebra w-full text-base [&_td]:py-3">
              <thead className="sticky top-0 bg-base-100 z-10 [&_th]:font-semibold">
                <tr>
                  <th className="whitespace-nowrap">Lead number</th>
                  <th>Client name</th>
                  <th>Category</th>
                  <th className="text-right whitespace-nowrap">Total value</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.leadId}>
                    <td className="whitespace-nowrap">
                      <button
                        type="button"
                        className="inline border-0 bg-transparent p-0 text-purple-600 dark:text-purple-400 text-base font-semibold leading-normal cursor-pointer rounded-sm hover:text-purple-700 dark:hover:text-purple-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-purple-500/50"
                        onClick={(e) => openLead(row, e)}
                      >
                        {row.leadNumber}
                      </button>
                    </td>
                    <td className="max-w-[16rem]" title={row.clientName}>
                      {row.clientName}
                    </td>
                    <td className="max-w-[20rem]" title={row.category}>
                      {row.category}
                    </td>
                    <td className="text-right font-medium whitespace-nowrap tabular-nums">
                      {row.totalValueNis > 0 ? formatMoney(row.totalValueNis) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="[&_td]:font-semibold">
                <tr>
                  <td colSpan={3} className="text-right">
                    Total
                  </td>
                  <td className="text-right tabular-nums">{formatMoney(totalValue)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        <div className="modal-action px-6 py-4 border-t border-base-300 shrink-0 mt-0">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button type="button" onClick={onClose}>
          close
        </button>
      </form>
    </dialog>
  );
};

export default MarketingDashboardLeadBreakdownModal;
