import React, { useState, useCallback, useEffect } from 'react';
import { XMarkIcon, LinkIcon } from '@heroicons/react/24/outline';

function getInitials(name: string): string {
  if (!name || !name.trim()) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export interface SalesLinkedContributionRow {
  employeeId: number;
  employeeName: string;
  departmentName: string;
  signedFromThreeRoles: number;
  contributionFromThreeRoles: number;
  contributionFixedFromModal: number;
  photoUrl?: string | null;
}

interface SalesLinkedContributionModalProps {
  isOpen: boolean;
  onClose: () => void;
  rows: SalesLinkedContributionRow[];
  formatCurrency: (n: number) => string;
}

const SalesLinkedContributionModal: React.FC<SalesLinkedContributionModalProps> = ({
  isOpen,
  onClose,
  rows,
  formatCurrency,
}) => {
  const [imageErrors, setImageErrors] = useState<Set<number>>(new Set());
  const totalLinked = rows.reduce((sum, r) => sum + r.contributionFromThreeRoles, 0);
  const totalSigned = rows.reduce((sum, r) => sum + r.signedFromThreeRoles, 0);
  const totalFixed = rows.reduce((sum, r) => sum + r.contributionFixedFromModal, 0);

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
      <div className="modal-box max-w-5xl w-full max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <LinkIcon className="w-6 h-6 text-primary" />
            <h2 className="text-xl font-bold">Link contribution to Sales</h2>
          </div>
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm btn-circle">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>
        <p className="text-sm text-base-content/70 mb-4">
          Employees from Handlers, Partners, and Finance with contribution from <strong>Closer</strong>, <strong>Helper Closer</strong>, or <strong>Meeting Manager</strong> roles in this period. Signed = amount from those roles; contribution is applied automatically to Sales to reduce the adjustment. Contribution fixed stays on each employee&apos;s department (no split to Sales).
        </p>
        <div className="overflow-auto flex-1 min-h-0">
          <table className="table table-pin-rows w-full">
            <thead>
              <tr>
                <th className="w-[26%]">Employee</th>
                <th className="w-[18%]">Department role</th>
                <th className="text-right w-[18%]">Signed</th>
                <th className="text-right w-[18%]">Contribution fixed</th>
                <th className="text-right w-[20%]">Contribution</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center text-base-content/60 py-6">
                    No employees with Closer / Helper Closer / Meeting Manager roles in this period.
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
                      {formatCurrency(row.signedFromThreeRoles)}
                    </td>
                    <td className="text-right tabular-nums">
                      {formatCurrency(row.contributionFixedFromModal)}
                    </td>
                    <td className="text-right tabular-nums font-medium">
                      {formatCurrency(row.contributionFromThreeRoles)}
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
              <span><span className="font-semibold">Signed: </span><span className="tabular-nums">{formatCurrency(totalSigned)}</span></span>
              <span><span className="font-semibold">Contribution fixed: </span><span className="tabular-nums">{formatCurrency(totalFixed)}</span></span>
              <span><span className="font-semibold">Total (applied to Sales): </span><span className="tabular-nums">{formatCurrency(totalLinked)}</span></span>
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

export default SalesLinkedContributionModal;
