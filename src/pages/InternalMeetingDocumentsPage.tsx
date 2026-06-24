import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  CalendarDaysIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  DocumentArrowUpIcon,
  EyeIcon,
  FolderIcon,
  MagnifyingGlassIcon,
  MapPinIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import DocumentModal, { DocumentPreviewModal, type DocumentPreviewItem } from '../components/DocumentModal';
import { DocumentFileGlyph } from '../lib/documentFileGlyphs';
import { buildClientRoute } from '../lib/clientSessionCache';
import { InternalMeetingTypeBadge } from '../lib/internalMeetingTypeBadge';
import { UploaderAttribution } from '../components/UploaderAttribution';
import {
  type StaffMeetingDocumentsContext,
} from '../lib/staffMeetingDocuments';
import {
  deleteInternalMeetingDocument,
  fetchInternalMeetingDocumentGroups,
  fetchInternalMeetingTypes,
  filterInternalMeetingDocumentGroups,
  type InternalMeetingDocumentGroup,
  type InternalMeetingTypeOption,
} from '../lib/internalMeetingDocumentsPage';

const today = () => new Date().toISOString().slice(0, 10);

const daysAgo = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
};

function formatMeetingDate(dateStr: string) {
  if (!dateStr) return '—';
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDocDate(dateString: string) {
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return dateString;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dd}.${mm}.${yy}, ${hh}:${min}`;
}

function toPreviewItems(group: InternalMeetingDocumentGroup): DocumentPreviewItem[] {
  return group.documents.map((d) => ({
    id: d.id,
    name: d.name,
    downloadUrl: d.downloadUrl,
    fileType: d.fileType,
    lastModified: d.lastModified,
  }));
}

const InternalMeetingDocumentsPage: React.FC = () => {
  const [dateFrom, setDateFrom] = useState(daysAgo(90));
  const [dateTo, setDateTo] = useState(today());
  const [typeId, setTypeId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [onlyWithDocuments, setOnlyWithDocuments] = useState(false);
  const [meetingTypes, setMeetingTypes] = useState<InternalMeetingTypeOption[]>([]);
  const [groups, setGroups] = useState<InternalMeetingDocumentGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewDocs, setPreviewDocs] = useState<DocumentPreviewItem[]>([]);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [expandedMeetingIds, setExpandedMeetingIds] = useState<Set<number>>(() => new Set());
  const [isDocumentModalOpen, setIsDocumentModalOpen] = useState(false);
  const [staffMeetingDocsContext, setStaffMeetingDocsContext] =
    useState<StaffMeetingDocumentsContext | null>(null);
  const [documentModalMeetingId, setDocumentModalMeetingId] = useState<number | null>(null);
  const documentModalMeetingIdRef = useRef<number | null>(null);
  const lastDocumentCountRef = useRef<number | null>(null);
  const [deletingDocIds, setDeletingDocIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    void fetchInternalMeetingTypes()
      .then(setMeetingTypes)
      .catch((err) => {
        console.error(err);
        toast.error('Failed to load meeting types');
      });
  }, []);

  const loadGroups = useCallback(async (options?: { preserveExpanded?: boolean; silent?: boolean }) => {
    if (!options?.silent) setLoading(true);
    try {
      const data = await fetchInternalMeetingDocumentGroups({
        dateFrom,
        dateTo,
        internalMeetingTypeId: typeId ? Number(typeId) : null,
      });
      setGroups(data);
      if (!options?.preserveExpanded) {
        setExpandedMeetingIds(new Set());
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to load internal meeting documents');
      setGroups([]);
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, [dateFrom, dateTo, typeId]);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  const filteredGroups = useMemo(
    () => filterInternalMeetingDocumentGroups(groups, searchQuery, onlyWithDocuments),
    [groups, searchQuery, onlyWithDocuments],
  );

  const totalDocuments = useMemo(
    () => filteredGroups.reduce((sum, g) => sum + g.documents.length, 0),
    [filteredGroups],
  );

  const openPreview = (group: InternalMeetingDocumentGroup, index: number) => {
    const items = toPreviewItems(group).filter((d) => d.downloadUrl);
    if (items.length === 0) {
      toast.error('No preview link is available for this file.');
      return;
    }
    const safeIndex = Math.min(index, items.length - 1);
    setPreviewDocs(items);
    setPreviewIndex(safeIndex);
    setPreviewOpen(true);
  };

  const toggleMeetingExpanded = (meetingId: number) => {
    setExpandedMeetingIds((prev) => {
      const next = new Set(prev);
      if (next.has(meetingId)) next.delete(meetingId);
      else next.add(meetingId);
      return next;
    });
  };

  const refreshAfterDocumentChange = useCallback((meetingId?: number | null) => {
    if (meetingId != null) {
      setExpandedMeetingIds((prev) => new Set(prev).add(meetingId));
    }
    void loadGroups({ preserveExpanded: true, silent: true });
  }, [loadGroups]);

  const openUploadModal = (group: InternalMeetingDocumentGroup) => {
    if (!group.documentsContext) {
      toast.error('Unable to upload documents for this meeting.');
      return;
    }
    lastDocumentCountRef.current = null;
    documentModalMeetingIdRef.current = group.meetingId;
    setStaffMeetingDocsContext(group.documentsContext);
    setDocumentModalMeetingId(group.meetingId);
    setIsDocumentModalOpen(true);
  };

  const handleDocumentCountChange = useCallback(
    (count: number) => {
      if (lastDocumentCountRef.current === count) return;
      lastDocumentCountRef.current = count;
      refreshAfterDocumentChange(documentModalMeetingIdRef.current);
    },
    [refreshAfterDocumentChange],
  );

  const handleDeleteDocument = async (
    group: InternalMeetingDocumentGroup,
    doc: InternalMeetingDocumentGroup['documents'][number],
  ) => {
    if (deletingDocIds.has(doc.id)) return;
    const confirmed = window.confirm(`Delete "${doc.name}"? This cannot be undone.`);
    if (!confirmed) return;

    setDeletingDocIds((prev) => new Set(prev).add(doc.id));
    try {
      await deleteInternalMeetingDocument(doc);
      toast.success('Document deleted');
      refreshAfterDocumentChange(group.meetingId);
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Failed to delete document');
    } finally {
      setDeletingDocIds((prev) => {
        const next = new Set(prev);
        next.delete(doc.id);
        return next;
      });
    }
  };

  return (
    <div className="internal-meeting-docs-page-shell min-h-[calc(100dvh-3.5rem)] bg-[#ececec]">
      <div className="flex min-w-0 flex-1 flex-col px-4 pb-[max(2.5rem,env(safe-area-inset-bottom,0px))] pt-2 md:px-10 md:pb-12 md:pt-4 max-lg:[zoom:1] lg:[zoom:1.075]">
        <div className="w-full space-y-5">
          {/* Header */}
          <div className="scroll-mt-28 shrink-0 pt-3 md:pt-4 grid w-full grid-cols-[1fr_auto] items-start gap-2 md:grid-cols-[1fr_auto_1fr] md:gap-2">
            <div className="hidden md:block" aria-hidden />
            <div className="col-start-1 row-start-1 flex min-w-0 flex-col items-start text-left md:col-start-2 md:items-center md:text-center">
              <div className="flex items-center justify-start gap-2.5 md:justify-center">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <FolderIcon className="h-5 w-5" />
                </div>
                <h1 className="text-2xl font-bold tracking-tight text-base-content/95">
                  Internal meeting documents
                </h1>
              </div>
              <p className="mt-1 text-sm text-base-content/55 md:text-center">
                Review files uploaded during internal calendar meetings.
              </p>
            </div>
            <div className="col-start-2 row-start-1 flex shrink-0 items-start justify-end md:col-start-3">
              <Link
                to="/calendar"
                className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
              >
                <ArrowLeftIcon className="h-4 w-4" />
                Back
              </Link>
            </div>
          </div>

          {/* Toolbar */}
          <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
            <div className="flex flex-1 flex-wrap items-center gap-2.5">
              <label className="flex w-full min-h-[42px] cursor-text items-center gap-2.5 rounded-[18px] bg-white px-4 py-2 shadow-sm transition-all duration-150 focus-within:ring-2 focus-within:ring-primary/15 md:max-w-[20rem]">
                <MagnifyingGlassIcon className="h-5 w-5 shrink-0 text-base-content/40" />
                <input
                  type="search"
                  className="grow bg-transparent text-sm outline-none placeholder:text-base-content/35"
                  placeholder="Subject, lead, file name…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  spellCheck={false}
                />
                {searchQuery ? (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="text-base-content/35 transition-colors hover:text-base-content/70"
                    aria-label="Clear search"
                  >
                    ×
                  </button>
                ) : null}
              </label>

              <div className="rounded-[18px] bg-white px-3 py-1 shadow-sm">
                <input
                  type="date"
                  className="input input-ghost h-[42px] min-h-[42px] w-full min-w-[9.5rem] border-0 bg-transparent px-0 text-sm font-medium focus:outline-none"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  aria-label="Meeting date from"
                />
              </div>

              <div className="rounded-[18px] bg-white px-3 py-1 shadow-sm">
                <input
                  type="date"
                  className="input input-ghost h-[42px] min-h-[42px] w-full min-w-[9.5rem] border-0 bg-transparent px-0 text-sm font-medium focus:outline-none"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  aria-label="Meeting date to"
                />
              </div>

              <div className="rounded-[18px] bg-white px-3 py-1 shadow-sm">
                <select
                  className="select select-ghost h-[42px] min-h-[42px] w-full min-w-[9.5rem] border-0 bg-transparent px-0 text-sm font-medium focus:outline-none"
                  value={typeId}
                  onChange={(e) => setTypeId(e.target.value)}
                >
                  <option value="">All types</option>
                  {meetingTypes.map((t) => (
                    <option key={t.id} value={String(t.id)}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>

              <label className="flex min-h-[42px] cursor-pointer items-center gap-2 rounded-[18px] bg-white px-4 py-2 shadow-sm">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm checkbox-primary"
                  checked={onlyWithDocuments}
                  onChange={(e) => setOnlyWithDocuments(e.target.checked)}
                />
                <span className="text-sm font-medium text-base-content/75">Only with documents</span>
              </label>
            </div>

            <div className="flex shrink-0 items-center gap-2 rounded-[18px] bg-white px-3 py-2 shadow-sm">
              {!loading && (
                <div className="flex flex-wrap items-center gap-2 text-sm text-base-content/60">
                  <span className="flex items-center gap-1.5 rounded-md bg-base-200/80 px-3 py-1.5 font-semibold">
                    <CalendarDaysIcon className="h-4 w-4" />
                    {filteredGroups.length} meetings
                  </span>
                  <span className="flex items-center gap-1.5 rounded-md bg-base-200/80 px-3 py-1.5 font-semibold">
                    <FolderIcon className="h-4 w-4" />
                    {totalDocuments} documents
                  </span>
                </div>
              )}
              <button
                type="button"
                title="Refresh"
                onClick={() => void loadGroups()}
                disabled={loading}
                className="btn btn-ghost btn-sm btn-square text-base-content/50 hover:text-base-content/80"
              >
                <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="min-w-0 space-y-4 pb-6 md:pb-8">
            {loading ? (
              <div className="flex justify-center py-16">
                <span className="loading loading-spinner loading-lg text-primary" />
              </div>
            ) : filteredGroups.length === 0 ? (
              <div className="rounded-[18px] bg-white px-6 py-14 text-center shadow-sm">
                <FolderIcon className="mx-auto mb-3 h-10 w-10 text-base-content/30" />
                <p className="font-medium text-base-content/80">No meetings match your filters</p>
                <p className="mt-1 text-sm text-base-content/55">
                  Try widening the date range or clearing the search.
                </p>
              </div>
            ) : (
              filteredGroups.map((group) => {
                const isExpanded = expandedMeetingIds.has(group.meetingId);
                return (
                  <div
                    key={group.meetingId}
                    className="overflow-hidden rounded-[18px] bg-white shadow-sm"
                  >
                    <div
                      role="button"
                      tabIndex={0}
                      className="flex w-full cursor-pointer items-start gap-3 px-5 py-4 text-left transition-colors hover:bg-gray-50/80"
                      onClick={() => toggleMeetingExpanded(group.meetingId)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggleMeetingExpanded(group.meetingId);
                        }
                      }}
                      aria-expanded={isExpanded}
                    >
                      <span className="mt-0.5 shrink-0 text-base-content/45">
                        {isExpanded ? (
                          <ChevronDownIcon className="h-5 w-5" />
                        ) : (
                          <ChevronRightIcon className="h-5 w-5" />
                        )}
                      </span>
                      <div className="flex min-w-0 flex-1 items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-base font-semibold text-base-content md:text-lg">
                              {group.subject}
                            </h2>
                            <InternalMeetingTypeBadge
                              typeLabel={group.typeLabel}
                              typeCode={group.typeCode}
                              internalMeetingTypeId={group.internalMeetingTypeId}
                            />
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
                            <span className="inline-flex items-center gap-1.5">
                              <CalendarDaysIcon className="h-4 w-4 text-gray-400" />
                              {formatMeetingDate(group.meetingDate)}
                              {group.meetingTime ? ` · ${group.meetingTime}` : ''}
                            </span>
                            {group.location ? (
                              <span className="inline-flex items-center gap-1.5">
                                <MapPinIcon className="h-4 w-4 text-gray-400" />
                                {group.location}
                              </span>
                            ) : null}
                            {group.leadNumber ? (
                              <span className="text-base-content/65">
                                Lead:{' '}
                                <Link
                                  to={buildClientRoute(null, group.leadNumber)}
                                  className="font-medium text-primary hover:underline"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  [{group.leadNumber}]
                                </Link>
                                {group.leadName ? ` ${group.leadName}` : ''}
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <span className="shrink-0 self-center text-right text-base font-bold tabular-nums text-base-content/75 md:text-lg">
                          {group.documents.length}
                        </span>
                      </div>
                    </div>

                    {isExpanded ? (
                      <div className="border-t border-gray-100 px-2 pb-3 pt-1 md:px-3">
                        <div className="flex justify-end px-2 pb-2 pt-2">
                          <button
                            type="button"
                            className="btn btn-primary btn-sm gap-1.5"
                            onClick={(e) => {
                              e.stopPropagation();
                              openUploadModal(group);
                            }}
                          >
                            <DocumentArrowUpIcon className="h-4 w-4" />
                            Upload
                          </button>
                        </div>
                        <div className="-mx-2 overflow-x-auto md:mx-0">
                          <table className="table internal-meeting-docs-table w-full min-w-[32rem] text-sm">
                            <thead>
                              <tr className="text-xs uppercase tracking-wide text-base-content/50">
                                <th className="font-semibold">File</th>
                                <th className="hidden font-semibold sm:table-cell">Source</th>
                                <th className="hidden font-semibold md:table-cell">Uploaded</th>
                                <th className="hidden font-semibold lg:table-cell">Uploaded by</th>
                                <th className="w-32 text-right font-semibold">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {group.documents.length === 0 ? (
                                <tr>
                                  <td
                                    colSpan={5}
                                    className="py-6 text-center text-sm text-base-content/50"
                                  >
                                    No documents for this meeting
                                  </td>
                                </tr>
                              ) : (
                                group.documents.map((doc, index) => (
                                  <tr key={doc.id}>
                                    <td>
                                      <div className="flex min-w-0 items-center gap-2">
                                        <DocumentFileGlyph
                                          fileName={doc.name}
                                          fileType={doc.fileType}
                                          className="h-8 w-8 shrink-0"
                                        />
                                        <span className="truncate font-medium">{doc.name}</span>
                                      </div>
                                    </td>
                                    <td className="hidden sm:table-cell">
                                      <span className="rounded-full bg-base-200/70 px-2.5 py-0.5 text-xs font-medium text-base-content/70">
                                        {doc.source === 'lead_sequence'
                                          ? 'Sequence of Events'
                                          : 'Meeting file'}
                                      </span>
                                    </td>
                                    <td className="hidden text-base-content/70 md:table-cell">
                                      {formatDocDate(doc.lastModified)}
                                    </td>
                                    <td className="hidden lg:table-cell">
                                      <UploaderAttribution
                                        name={doc.uploadedByName}
                                        photoUrl={doc.uploadedByPhotoUrl}
                                        imageClassName="h-9 w-9"
                                      />
                                    </td>
                                    <td className="text-right">
                                      <div className="flex items-center justify-end gap-0.5">
                                        <button
                                          type="button"
                                          className="btn btn-ghost btn-xs gap-1 rounded-full"
                                          onClick={() => openPreview(group, index)}
                                          disabled={!doc.downloadUrl}
                                        >
                                          <EyeIcon className="h-4 w-4" />
                                          View
                                        </button>
                                        <button
                                          type="button"
                                          className="btn btn-ghost btn-xs btn-square rounded-full text-error hover:bg-error/10"
                                          onClick={() => void handleDeleteDocument(group, doc)}
                                          disabled={deletingDocIds.has(doc.id)}
                                          aria-label={`Delete ${doc.name}`}
                                          title="Delete"
                                        >
                                          {deletingDocIds.has(doc.id) ? (
                                            <span className="loading loading-spinner loading-xs" />
                                          ) : (
                                            <TrashIcon className="h-4 w-4" />
                                          )}
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      <DocumentPreviewModal
        isOpen={previewOpen}
        onClose={() => setPreviewOpen(false)}
        documents={previewDocs}
        initialIndex={previewIndex}
      />

      {staffMeetingDocsContext ? (
        <DocumentModal
          isOpen={isDocumentModalOpen}
          onClose={() => {
            const meetingId = documentModalMeetingId;
            setIsDocumentModalOpen(false);
            setStaffMeetingDocsContext(null);
            setDocumentModalMeetingId(null);
            documentModalMeetingIdRef.current = null;
            lastDocumentCountRef.current = null;
            refreshAfterDocumentChange(meetingId);
          }}
          onDocumentCountChange={handleDocumentCountChange}
          {...(staffMeetingDocsContext.mode === 'lead'
            ? {
                leadNumber: staffMeetingDocsContext.leadNumber,
                clientName: staffMeetingDocsContext.clientName,
                clientId: staffMeetingDocsContext.clientId,
                requireCaseDocumentClassification: true,
                restrictToClassificationSlug: 'sequence_of_events',
                initialClassificationSlug: 'sequence_of_events',
                modalTitle: 'Meeting documents',
              }
            : {
                staffMeetingId: staffMeetingDocsContext.staffMeetingId,
                staffMeetingTitle: staffMeetingDocsContext.meetingTitle,
                modalTitle: 'Meeting documents',
              })}
        />
      ) : null}

      <style>{`
        .internal-meeting-docs-page-shell table {
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
          border-collapse: separate !important;
          border-spacing: 0 10px !important;
        }

        .internal-meeting-docs-page-shell .table tbody tr:hover {
          background-color: transparent !important;
        }

        html.dark .internal-meeting-docs-page-shell .table tbody tr:hover {
          background-color: transparent !important;
        }

        .internal-meeting-docs-page-shell table tbody tr {
          background: transparent !important;
          border-radius: 18px !important;
          overflow: hidden !important;
          box-shadow: none !important;
        }

        .internal-meeting-docs-page-shell table tbody tr:hover {
          box-shadow: none !important;
        }

        .internal-meeting-docs-page-shell table tbody td {
          border: none !important;
          border-bottom: none !important;
          background: #ffffff !important;
          box-shadow: none !important;
          vertical-align: middle;
        }

        .internal-meeting-docs-page-shell table tbody td:first-child {
          border-top-left-radius: 18px !important;
          border-bottom-left-radius: 18px !important;
          padding-left: 1.1rem !important;
        }

        .internal-meeting-docs-page-shell table tbody td:last-child {
          border-top-right-radius: 18px !important;
          border-bottom-right-radius: 18px !important;
          padding-right: 1.1rem !important;
        }

        .internal-meeting-docs-page-shell table tbody tr:hover td {
          background: #f1f5f9 !important;
        }

        html.dark .internal-meeting-docs-page-shell table tbody td {
          background: rgba(255, 255, 255, 0.06) !important;
        }

        html.dark .internal-meeting-docs-page-shell table tbody tr:hover td {
          background: rgba(255, 255, 255, 0.10) !important;
        }

        .internal-meeting-docs-page-shell table thead,
        .internal-meeting-docs-page-shell table thead tr,
        .internal-meeting-docs-page-shell table thead th {
          background-color: transparent !important;
          background-image: none !important;
          border-bottom: none !important;
        }

        .internal-meeting-docs-page-shell table.internal-meeting-docs-table thead tr,
        .internal-meeting-docs-page-shell table.internal-meeting-docs-table thead th {
          background-color: #ececec !important;
        }
      `}</style>
    </div>
  );
};

export default InternalMeetingDocumentsPage;
