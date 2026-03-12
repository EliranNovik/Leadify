import React, { useState, useCallback, useEffect } from 'react';
import { XMarkIcon, LinkIcon } from '@heroicons/react/24/outline';

function getInitials(name: string): string {
  if (!name || !name.trim()) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export interface HandlersLinkedContributionRow {
  employeeId: number;
  employeeName: string;
  departmentName: string;
  signedFromHandler: number;
  dueFromHandler: number;
  contributionFromHandler: number;
  photoUrl?: string | null;
}

interface HandlersLinkedContributionModalProps {
  isOpen: boolean;
  onClose: () => void;
  rows: HandlersLinkedContributionRow[];
  formatCurrency: (n: number) => string;
}

const HandlersLinkedContributionModal: React.FC<HandlersLinkedContributionModalProps> = ({
  isOpen,
  onClose,
  rows,
  formatCurrency,
}) => {
  const [imageErrors, setImageErrors] = useState<Set<number>>(new Set());
  const totalLinked = rows.reduce((sum, r) => sum + r.contributionFromHandler, 0);
  const totalDue = rows.reduce((sum, r) => sum + r.dueFromHandler, 0);

  const handleImageError = useCallback((employeeId: number) => {
    setImageErrors((prev) => {
      const next = new Set(prev);
      next.add(employeeId);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!isOpen) setImageErrors(new Set());
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <dialog open={isOpen} className="modal modal-open z-[10050]">
      <div className="modal-box max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <LinkIcon className="w-6 h-6 text-primary" />
            <h2 className="text-xl font-bold">Link contribution to Handlers</h2>
          </div>
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm btn-circle">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>
        <p className="text-sm text-base-content/70 mb-4">
          Employees from Sales, Partners, and Finance with the <strong>Handler</strong> role in this period. Due = amount from Handler role; contribution is applied automatically to Handlers to reduce the adjustment.
        </p>
        <div className="overflow-auto flex-1 min-h-0">
          <table className="table table-pin-rows w-full">
            <thead>
              <tr>
                <th className="w-[30%]">Employee</th>
                <th className="w-[22%]">Department role</th>
                <th className="text-right w-[24%]">Due</th>
                <th className="text-right w-[24%]">Contribution</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center text-base-content/60 py-6">
                    No employees with Handler role in this period.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.employeeId}>
                    <td>
                      <div className="flex items-center gap-3">
                        {row.photoUrl && !imageErrors.has(row.employeeId) ? (
                          <img
                            src={row.photoUrl}
                            alt=""
                            className="w-11 h-11 rounded-full object-cover flex-shrink-0"
                            onError={() => handleImageError(row.employeeId)}
                          />
                        ) : (
                          <div className="w-11 h-11 rounded-full bg-primary/10 text-primary flex items-center justify-center text-base font-semibold flex-shrink-0 ring-1 ring-primary/20">
                            {getInitials(row.employeeName || '')}
                          </div>
                        )}
                        <span className="font-medium">{row.employeeName}</span>
                      </div>
                    </td>
                    <td>{row.departmentName}</td>
                    <td className="text-right tabular-nums">
                      {formatCurrency(row.dueFromHandler)}
                    </td>
                    <td className="text-right tabular-nums font-medium">
                      {formatCurrency(row.contributionFromHandler)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {rows.length > 0 && (
          <div className="border-t border-base-300 pt-4 mt-4 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="text-sm flex flex-wrap items-center gap-x-4 gap-y-1">
              <span><span className="font-semibold">Due: </span><span className="tabular-nums">{formatCurrency(totalDue)}</span></span>
              <span><span className="font-semibold">Total (applied to Handlers): </span><span className="tabular-nums">{formatCurrency(totalLinked)}</span></span>
            </div>
            <button type="button" onClick={onClose} className="btn btn-ghost">
              Close
            </button>
          </div>
        )}
      </div>
      <form method="dialog" className="modal-backdrop" onClick={onClose}>
        <button type="button">close</button>
      </form>
    </dialog>
  );
};

export default HandlersLinkedContributionModal;
