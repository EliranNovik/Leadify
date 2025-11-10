import React from 'react';
import { Link } from 'react-router-dom';
import { XMarkIcon } from '@heroicons/react/24/outline';

export type LeadBaseDetail = {
  leadKey: string;
  leadId: string;
  leadNumber: string;
  clientName: string;
  categoryMain: string;
  categorySub: string;
  leadType: 'new' | 'legacy';
};

export type EmployeeLeadDrawerItem = LeadBaseDetail & {
  stageLabel: string;
};

interface EmployeeLeadDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  leads: EmployeeLeadDrawerItem[];
}

const EmployeeLeadDrawer: React.FC<EmployeeLeadDrawerProps> = ({
  isOpen,
  onClose,
  title,
  leads,
}) => {
  if (!isOpen) return null;

  const sortedLeads = [...leads].sort((a, b) => {
    const stageCompare = a.stageLabel.localeCompare(b.stageLabel);
    if (stageCompare !== 0) return stageCompare;
    return a.leadNumber.localeCompare(b.leadNumber, undefined, { numeric: true, sensitivity: 'base' });
  });

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-[105]" onClick={onClose} />
      <aside
        className="fixed inset-y-0 right-0 w-full max-w-3xl bg-white shadow-2xl z-[110] flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="flex items-center justify-between px-6 py-4 border-b border-base-200">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
            <p className="text-sm text-gray-500">
              {sortedLeads.length} {sortedLeads.length === 1 ? 'lead' : 'leads'}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            aria-label="Close drawer"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {sortedLeads.length === 0 ? (
            <div className="h-full flex items-center justify-center px-6 py-12 text-gray-500">
              No leads found for this selection.
            </div>
          ) : (
            <table className="table w-full text-sm">
              <thead>
                <tr>
                  <th className="text-xs text-gray-500 uppercase">Lead</th>
                  <th className="text-xs text-gray-500 uppercase">Stage</th>
                  <th className="text-xs text-gray-500 uppercase">Category</th>
                </tr>
              </thead>
              <tbody>
                {sortedLeads.map(lead => (
                  <tr key={`${lead.stageLabel}-${lead.leadKey}`}>
                    <td className="align-top">
                      <Link
                        to={`/clients/${encodeURIComponent(lead.leadId)}`}
                        className="text-primary font-semibold hover:underline"
                      >
                        #{lead.leadNumber}
                      </Link>
                      <span className="text-sm text-gray-600 ml-2">{lead.clientName}</span>
                    </td>
                    <td className="align-top text-xs font-semibold text-gray-700">
                      {lead.stageLabel}
                    </td>
                    <td className="align-top text-sm text-gray-600">
                      {lead.categoryMain} › {lead.categorySub}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <footer className="border-t border-base-200 px-6 py-4 flex justify-end">
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Close
          </button>
        </footer>
      </aside>
    </>
  );
};

export default EmployeeLeadDrawer;

