import React from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';

interface Lead {
  id: string | number;
  name: string;
  lead_number: string;
  created_at: string;
  source?: string;
  language?: string;
  topic?: string;
}

interface CategoryLeadsModalProps {
  isOpen: boolean;
  onClose: () => void;
  categoryName: string;
  employeeName: string;
  leads: Lead[];
  totalCount: number;
}

const CategoryLeadsModal: React.FC<CategoryLeadsModalProps> = ({
  isOpen,
  onClose,
  categoryName,
  employeeName,
  leads,
  totalCount
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-screen items-center justify-center p-4">
        {/* Backdrop */}
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
          onClick={onClose}
        />
        
        {/* Modal */}
        <div className="relative bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">
                {categoryName} Leads
              </h2>
              <p className="text-sm text-gray-600 mt-1">
                Assigned to {employeeName} • {totalCount} lead{totalCount !== 1 ? 's' : ''}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 overflow-y-auto max-h-[calc(90vh-120px)]">
            {leads.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="table table-zebra w-full">
                  <thead>
                    <tr>
                      <th className="font-semibold">Lead Number</th>
                      <th className="font-semibold">Name</th>
                      <th className="font-semibold">Created Date</th>
                      <th className="font-semibold">Source</th>
                      <th className="font-semibold">Language</th>
                      <th className="font-semibold">Topic</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leads.map((lead, index) => (
                      <tr key={lead.id || index} className="hover:bg-gray-50">
                        <td className="font-mono text-sm">
                          #{lead.lead_number}
                        </td>
                        <td className="font-medium">
                          {lead.name}
                        </td>
                        <td className="text-sm">
                          {new Date(lead.created_at).toLocaleDateString()}
                        </td>
                        <td className="text-sm">
                          {lead.source || 'N/A'}
                        </td>
                        <td className="text-sm">
                          {lead.language || 'N/A'}
                        </td>
                        <td className="text-sm">
                          {lead.topic || 'N/A'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-12">
                <div className="text-gray-400 mb-4">
                  <svg className="mx-auto h-12 w-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">No leads found</h3>
                <p className="text-gray-500">
                  No leads found for {categoryName} assigned to {employeeName} in the selected date range.
                </p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-end p-6 border-t border-gray-200 bg-gray-50">
            <button
              onClick={onClose}
              className="btn btn-primary"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CategoryLeadsModal;

