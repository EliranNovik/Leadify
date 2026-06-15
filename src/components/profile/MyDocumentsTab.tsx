import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DocumentTextIcon, EyeIcon, FunnelIcon } from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import {
  documentNameFromUrl,
  fetchEmployeeUnavailabilityDocuments,
  unavailabilityDateRangeLabel,
  unavailabilityReasonText,
  type EmployeeUnavailabilityDocument,
  type UnavailabilityType,
} from '../../lib/employeeUnavailabilities';
import { DocumentFileGlyph } from '../../lib/documentFileGlyphs';
import UnavailabilityTypeBadge from '../UnavailabilityTypeBadge';
import DocumentViewerModal from '../DocumentViewerModal';

interface MyDocumentsTabProps {
  employeeId: number;
  employeeName?: string;
}

type TypeFilter = 'all' | UnavailabilityType;

function formatUploadedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const MyDocumentsTab: React.FC<MyDocumentsTabProps> = ({ employeeId, employeeName = '' }) => {
  const [loading, setLoading] = useState(true);
  const [documents, setDocuments] = useState<EmployeeUnavailabilityDocument[]>([]);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [selectedDocument, setSelectedDocument] = useState<EmployeeUnavailabilityDocument | null>(null);

  const loadDocuments = useCallback(async () => {
    try {
      setLoading(true);
      const rows = await fetchEmployeeUnavailabilityDocuments(employeeId);
      setDocuments(rows);
    } catch (error) {
      console.error('Error loading unavailability documents:', error);
      toast.error('Failed to load documents');
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  const filteredDocuments = useMemo(() => {
    if (typeFilter === 'all') return documents;
    return documents.filter((doc) => doc.unavailability_type === typeFilter);
  }, [documents, typeFilter]);

  const openDocument = (doc: EmployeeUnavailabilityDocument) => {
    setSelectedDocument(doc);
  };

  return (
    <div className="my-profile-documents-shell w-full max-w-full min-w-0 overflow-x-hidden space-y-4">
      <div className="rounded-[18px] bg-white px-4 py-4 md:px-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between w-full min-w-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <DocumentTextIcon className="w-5 h-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xl md:text-2xl font-bold text-gray-800">My Documents</h2>
              <p className="text-sm text-gray-500">
                Documents uploaded for sick days and other unavailabilities
              </p>
            </div>
          </div>
          {!loading && (
            <span className="inline-flex items-center px-4 py-2 rounded-full text-sm font-semibold bg-gray-100 text-gray-700 border border-gray-200/80 shrink-0">
              {filteredDocuments.length} document{filteredDocuments.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </div>

      <div className="rounded-[18px] bg-white px-4 py-4 md:px-5 shadow-sm space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-center gap-2 text-base font-semibold text-gray-700">
            <FunnelIcon className="w-5 h-5" />
            Filter
          </div>
          <label className="form-control w-full sm:max-w-xs">
            <span className="label-text text-sm text-gray-600 mb-1.5 font-medium">Type</span>
            <select
              className="select select-bordered w-full text-base h-12"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
            >
              <option value="all">All types</option>
              <option value="sick_days">Sick day/s</option>
              <option value="vacation">Vacation</option>
              <option value="general">General</option>
            </select>
          </label>
        </div>
      </div>

      <div className="rounded-[18px] bg-[#ececec] px-3 py-3 md:px-4 md:py-4 shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <span className="loading loading-spinner loading-md text-primary" />
          </div>
        ) : filteredDocuments.length === 0 ? (
          <div className="rounded-[18px] bg-white py-16 text-center text-gray-400">
            <DocumentTextIcon className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>No documents uploaded yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredDocuments.map((doc) => {
              const docName = documentNameFromUrl(doc.document_url);
              const reason = unavailabilityReasonText(doc);
              return (
                <div
                  key={doc.id}
                  className="flex min-w-0 max-w-full cursor-pointer items-center justify-between gap-2 rounded-[18px] border border-base-200 bg-white px-3 py-4 transition-colors hover:bg-base-200/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 sm:gap-3 sm:p-5"
                  role="button"
                  tabIndex={0}
                  aria-label={`View document for ${unavailabilityDateRangeLabel(doc.start_date, doc.end_date)}`}
                  onClick={() => openDocument(doc)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      openDocument(doc);
                    }
                  }}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
                    <span className="shrink-0">
                      <DocumentFileGlyph fileName={docName} className="h-10 w-10 sm:h-11 sm:w-11" />
                    </span>
                    <div className="min-w-0 flex-1 overflow-hidden">
                      <p className="min-w-0 break-words text-base font-semibold leading-snug text-gray-900 [overflow-wrap:anywhere]">
                        {docName}
                      </p>
                      <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <UnavailabilityTypeBadge type={doc.unavailability_type} size="xs" />
                        <span className="text-sm text-gray-600">
                          {unavailabilityDateRangeLabel(doc.start_date, doc.end_date)}
                        </span>
                        <span className="text-sm text-gray-400">·</span>
                        <span className="text-sm text-gray-500">
                          Uploaded {formatUploadedAt(doc.created_at)}
                        </span>
                      </div>
                      {reason !== '—' && (
                        <p className="mt-1 text-sm text-gray-500 truncate" title={reason}>
                          {reason}
                        </p>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    className="btn btn-ghost btn-sm btn-circle min-h-10 min-w-10 h-10 w-10 shrink-0 hover:bg-base-200"
                    title="View document"
                    aria-label={`View ${docName}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      openDocument(doc);
                    }}
                  >
                    <EyeIcon className="w-6 h-6" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {selectedDocument && (
        <DocumentViewerModal
          isOpen
          onClose={() => setSelectedDocument(null)}
          documentUrl={selectedDocument.document_url}
          documentName={documentNameFromUrl(selectedDocument.document_url)}
          employeeName={employeeName}
          uploadedAt={selectedDocument.created_at}
          sickDaysReason={unavailabilityReasonText(selectedDocument)}
        />
      )}
    </div>
  );
};

export default MyDocumentsTab;
