import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckIcon,
  ChevronDownIcon,
  ExclamationTriangleIcon,
  PaperClipIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import MobileBottomSheet from './MobileBottomSheet';
import DocumentViewerModal, { type DocumentViewerItem } from './DocumentViewerModal';
import { DocumentFileGlyph } from '../lib/documentFileGlyphs';
import {
  deleteCaseCategoryDocument,
  fetchClientPortalUploadDocuments,
  type CaseCategoryDocument,
} from '../lib/sequenceOfEventsDocuments';
import {
  fetchLeadCaseDocumentTypes,
  updateCaseDocumentType,
  type LeadCaseDocumentType,
} from '../lib/leadCaseDocumentsApi';
import {
  attachStoragePathsToSubEffort,
  buildSubEffortAttachmentsByPath,
  listSubEffortAttachOptions,
  normalizeStorageKey,
  type SubEffortAttachOption,
  type SubEffortAttachmentRef,
} from '../lib/subEffortDocumentAttach';
import { supabase } from '../lib/supabase';
import {
  CaseDocumentsModalFilterBar,
  ClientUploadBadge,
  DocRowActionsMenu,
  EMPTY_CASE_DOCS_FILTERS,
  filterCaseCategoryDocuments,
  TableSelectAllHeader,
  type CaseDocsFilterState,
} from './caseDocumentsModalUi';

function formatDocDate(dateString: string): string {
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return dateString;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dd}.${mm}.${yy}, ${hh}:${min}`;
}

export function ClientUploadsDocumentsModal({
  open,
  onClose,
  leadNumber,
  clientId = null,
  subEffortRows = [],
  targetSubEffortId = null,
  activeFolderId = null,
  onAttached,
}: {
  open: boolean;
  onClose: () => void;
  leadNumber?: string | null;
  clientId?: string | null;
  subEffortRows?: Array<{ id?: unknown; document_url?: unknown; sub_efforts?: unknown }> | null;
  targetSubEffortId?: string | number | null;
  activeFolderId?: string | null;
  onAttached?: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [docs, setDocs] = useState<CaseCategoryDocument[]>([]);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [isAttaching, setIsAttaching] = useState(false);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const attachMenuRef = useRef<HTMLDivElement | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<Map<string, SubEffortAttachmentRef[]>>(
    () => new Map(),
  );
  const [filters, setFilters] = useState<CaseDocsFilterState>(EMPTY_CASE_DOCS_FILTERS);
  const [renamingDocId, setRenamingDocId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null);
  const [documentTypes, setDocumentTypes] = useState<LeadCaseDocumentType[]>([]);
  const [savingTypeDocId, setSavingTypeDocId] = useState<string | null>(null);

  const attachOptions = useMemo(() => listSubEffortAttachOptions(subEffortRows), [subEffortRows]);

  const attachmentsByPath = useMemo(() => {
    const fromRows = buildSubEffortAttachmentsByPath(subEffortRows);
    if (pendingAttachments.size === 0) return fromRows;
    const merged = new Map(fromRows);
    for (const [path, refs] of pendingAttachments) {
      const list = [...(merged.get(path) ?? [])];
      for (const ref of refs) {
        if (!list.some((x) => x.id === ref.id)) list.push(ref);
      }
      merged.set(path, list);
    }
    return merged;
  }, [subEffortRows, pendingAttachments]);

  useEffect(() => {
    setPendingAttachments((prev) => {
      if (prev.size === 0) return prev;
      const fromRows = buildSubEffortAttachmentsByPath(subEffortRows);
      let changed = false;
      const next = new Map(prev);
      for (const [path, refs] of prev) {
        const rowRefs = fromRows.get(path) ?? [];
        const stillPending = refs.filter((r) => !rowRefs.some((x) => x.id === r.id));
        if (stillPending.length === 0) {
          next.delete(path);
          changed = true;
        } else if (stillPending.length !== refs.length) {
          next.set(path, stillPending);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [subEffortRows]);

  useEffect(() => {
    if (!open) {
      setViewerIndex(null);
      setSelectedIds(new Set());
      setPendingAttachments(new Map());
      setAttachMenuOpen(false);
      setFilters(EMPTY_CASE_DOCS_FILTERS);
      setRenamingDocId(null);
      setRenameValue('');
      setRenameSaving(false);
      setDeletingDocId(null);
      setSavingTypeDocId(null);
      return;
    }
    const lead = leadNumber?.trim();
    if (!lead) {
      setDocs([]);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const [list, types] = await Promise.all([
          fetchClientPortalUploadDocuments(lead),
          fetchLeadCaseDocumentTypes().catch(() => [] as LeadCaseDocumentType[]),
        ]);
        if (!cancelled) {
          setDocs(list);
          setDocumentTypes(types);
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setDocs([]);
          setError(e instanceof Error ? e.message : 'Failed to load documents');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, leadNumber]);

  useEffect(() => {
    if (!attachMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (attachMenuRef.current?.contains(target)) return;
      setAttachMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAttachMenuOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [attachMenuOpen]);

  const visibleDocs = useMemo(() => {
    const unattached = docs.filter((d) => {
      const path = normalizeStorageKey(d.storagePath);
      if (!path) return true;
      return (attachmentsByPath.get(path) ?? []).length === 0;
    });
    return filterCaseCategoryDocuments(unattached, filters, {
      attachmentsByPath,
      // List is already unattached-only; still allow sub-effort filter for consistency.
      applySubEffortFilter: true,
    });
  }, [docs, attachmentsByPath, filters]);

  // Drop selection for docs that are now hidden (e.g. just attached).
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(visibleDocs.map((d) => d.id));
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (visible.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [visibleDocs]);

  const attachableDocs = useMemo(
    () => visibleDocs.filter((d) => Boolean(d.storagePath?.trim())),
    [visibleDocs],
  );

  const selectedDocs = useMemo(
    () => visibleDocs.filter((d) => selectedIds.has(d.id)),
    [visibleDocs, selectedIds],
  );

  const viewerDocs: DocumentViewerItem[] = visibleDocs.map((d) => ({
    id: d.id,
    name: d.name,
    url: d.url,
    fileType: d.fileType,
    lastModified: d.lastModified,
    storagePath: d.storagePath,
  }));

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const setTableSelection = (select: boolean) => {
    const ids = attachableDocs.map((d) => d.id);
    if (ids.length === 0) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (select) {
        for (const id of ids) next.add(id);
      } else {
        for (const id of ids) next.delete(id);
      }
      return next;
    });
  };

  const startInlineRename = (doc: CaseCategoryDocument) => {
    setRenamingDocId(doc.id);
    setRenameValue(doc.name);
  };

  const cancelInlineRename = () => {
    setRenamingDocId(null);
    setRenameValue('');
    setRenameSaving(false);
  };

  const renameDocument = useCallback(
    async (doc: CaseCategoryDocument, newName: string) => {
      const trimmed = newName.trim();
      if (!trimmed) throw new Error('Name is required');
      if (trimmed === doc.name) return;
      const { error } = await supabase
        .from('lead_case_documents')
        .update({ file_name: trimmed })
        .eq('id', doc.id);
      if (error) throw error;
      setDocs((prev) => prev.map((d) => (d.id === doc.id ? { ...d, name: trimmed } : d)));
      onAttached?.();
    },
    [onAttached],
  );

  const saveInlineRename = async () => {
    if (!renamingDocId || renameSaving) return;
    const doc = docs.find((d) => d.id === renamingDocId);
    if (!doc) {
      cancelInlineRename();
      return;
    }
    const trimmed = renameValue.trim();
    if (!trimmed) {
      toast.error('Name is required');
      return;
    }
    setRenameSaving(true);
    try {
      await renameDocument(doc, trimmed);
      toast.success('Name updated');
      cancelInlineRename();
    } catch (e: unknown) {
      console.error('renameClientUploadDoc:', e);
      toast.error(e instanceof Error ? e.message : 'Failed to rename');
      setRenameSaving(false);
    }
  };

  const deleteDocument = async (doc: CaseCategoryDocument) => {
    if (!leadNumber?.trim()) {
      toast.error('Missing lead number');
      return;
    }
    if (!doc.storagePath?.trim()) {
      toast.error('Missing storage path for this document');
      return;
    }
    if (!window.confirm(`Delete "${doc.name}"? This cannot be undone.`)) return;
    setDeletingDocId(doc.id);
    try {
      await deleteCaseCategoryDocument({
        leadNumber,
        clientId,
        storagePath: doc.storagePath,
        documentId: doc.id,
      });
      setDocs((prev) => prev.filter((d) => d.id !== doc.id));
      setSelectedIds((prev) => {
        if (!prev.has(doc.id)) return prev;
        const next = new Set(prev);
        next.delete(doc.id);
        return next;
      });
      toast.success('Deleted');
      onAttached?.();
    } catch (e: unknown) {
      console.error('deleteClientUploadDoc:', e);
      toast.error(e instanceof Error ? e.message : 'Failed to delete');
    } finally {
      setDeletingDocId(null);
    }
  };

  const assignDocumentType = async (
    doc: CaseCategoryDocument,
    type: LeadCaseDocumentType | null,
  ) => {
    if (!leadNumber?.trim()) {
      toast.error('Missing lead number');
      return;
    }
    const nextId = type?.id ?? null;
    if (String(doc.documentTypeId ?? '') === String(nextId ?? '')) return;
    setSavingTypeDocId(doc.id);
    try {
      await updateCaseDocumentType({
        leadNumber,
        documentId: doc.id,
        storagePath: doc.storagePath,
        documentTypeId: nextId,
        fileName: doc.name,
        mimeType: doc.fileType,
      });
      setDocs((prev) =>
        prev.map((d) =>
          d.id === doc.id
            ? {
                ...d,
                documentTypeId: nextId,
                documentTypeName: type?.name ?? null,
              }
            : d,
        ),
      );
      toast.success(type ? `Document type set to ${type.name}` : 'Document type cleared');
      onAttached?.();
    } catch (e: unknown) {
      console.error('assignClientUploadDocumentType:', e);
      toast.error(e instanceof Error ? e.message : 'Failed to update document type');
    } finally {
      setSavingTypeDocId(null);
    }
  };

  const markPendingAttached = (paths: string[], subEffortId: string, subEffortName: string) => {
    setPendingAttachments((prev) => {
      const next = new Map(prev);
      for (const path of paths) {
        const key = normalizeStorageKey(path);
        if (!key) continue;
        const list = [...(next.get(key) ?? [])];
        if (!list.some((x) => x.id === subEffortId)) {
          list.push({ id: subEffortId, name: subEffortName });
        }
        next.set(key, list);
      }
      return next;
    });
  };

  const attachToSubEffort = async (option: SubEffortAttachOption) => {
    const picked = selectedDocs.filter((d) => d.storagePath?.trim());
    if (!picked.length) {
      toast.error('Select at least one file to attach.');
      return;
    }
    setAttachMenuOpen(false);
    setIsAttaching(true);
    try {
      const { addedCount } = await attachStoragePathsToSubEffort({
        targetSubEffortId: option.id,
        targetDocumentUrl: option.documentUrl,
        activeFolderId,
        items: picked.map((d) => ({
          path: d.storagePath!.trim(),
          name: d.name,
          mimeType: d.fileType,
        })),
      });
      if (addedCount === 0) {
        toast.error('Selected files are already attached to this sub effort.');
        return;
      }
      toast.success(
        addedCount === 1
          ? `Attached to ${option.name}`
          : `Attached ${addedCount} files to ${option.name}`,
      );
      const paths = picked.map((d) => d.storagePath!);
      markPendingAttached(paths, option.id, option.name);
      setSelectedIds(new Set());
      onAttached?.();
    } catch (e: unknown) {
      console.error('attachClientUploadDocs:', e);
      toast.error(e instanceof Error ? e.message : 'Failed to attach');
    } finally {
      setIsAttaching(false);
    }
  };

  const busy = isAttaching;
  const canOpenAttachMenu = selectedIds.size > 0 && !busy && attachOptions.length > 0;

  return (
    <>
      <MobileBottomSheet
        open={open}
        onClose={onClose}
        hideDefaultHeader
        mobileFullHeight
        desktopFullScreen
        zIndex={60}
        contentClassName="!p-0 flex flex-col min-h-0 !overflow-hidden"
      >
        <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[#f5f5f5]">
          <div className="flex shrink-0 flex-col gap-3 px-4 py-3 md:px-6 md:py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-xl font-bold leading-snug tracking-tight text-base-content/95">
                  Client uploads
                </div>
                <div className="mt-1 text-xs leading-snug text-base-content/50 whitespace-normal">
                  {loading
                    ? 'Loading…'
                    : visibleDocs.length
                      ? `${visibleDocs.length} document${visibleDocs.length === 1 ? '' : 's'} from the client portal`
                      : 'No unattached client portal uploads'}
                  <span className="hidden sm:inline">
                    {' '}
                    · Select files to attach to a sub effort
                  </span>
                </div>
                <div className="mt-0.5 text-xs leading-snug text-base-content/45 sm:hidden">
                  Select files to attach to a sub effort
                </div>
              </div>
              <button
                type="button"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-gray-600 shadow-sm transition-colors hover:bg-gray-50"
                onClick={onClose}
                aria-label="Close"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            {visibleDocs.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative" ref={attachMenuRef}>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm h-9 gap-1.5 rounded-full px-3.5"
                    onClick={() => {
                      if (selectedIds.size === 0) {
                        toast.error('Select at least one file to attach.');
                        return;
                      }
                      if (attachOptions.length === 0) {
                        toast.error('No sub efforts available to attach to.');
                        return;
                      }
                      setAttachMenuOpen((v) => !v);
                    }}
                    disabled={busy || selectedIds.size === 0}
                    aria-expanded={attachMenuOpen}
                    aria-haspopup="menu"
                  >
                    {isAttaching ? (
                      <span className="loading loading-spinner loading-xs" />
                    ) : (
                      <PaperClipIcon className="h-4 w-4" />
                    )}
                    Attach{selectedIds.size ? ` (${selectedIds.size})` : ''}
                    <ChevronDownIcon className="h-4 w-4 opacity-80" />
                  </button>
                  {attachMenuOpen && canOpenAttachMenu ? (
                    <div
                      role="menu"
                      className="absolute left-0 z-50 mt-1.5 max-h-72 w-64 overflow-y-auto rounded-xl border border-base-200 bg-white py-1 shadow-lg md:left-auto md:right-0"
                    >
                      <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-base-content/45">
                        Attach to sub effort
                      </div>
                      {attachOptions.map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          role="menuitem"
                          className={`flex w-full items-center px-3 py-2.5 text-left text-sm hover:bg-base-200/70 ${
                            String(opt.id) === String(targetSubEffortId ?? '')
                              ? 'bg-primary/5 font-semibold text-primary'
                              : 'text-base-content'
                          }`}
                          onClick={() => void attachToSubEffort(opt)}
                        >
                          {opt.name}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          <CaseDocumentsModalFilterBar
            filters={filters}
            onChange={setFilters}
            attachOptions={attachOptions}
            documentTypes={documentTypes}
            showSubEffortFilter
            showDocumentTypeFilter
          />

          <div className="min-h-0 flex-1 overflow-auto px-4 pb-6 md:px-6">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <span className="loading loading-spinner loading-md text-base-content/40" />
              </div>
            ) : error ? (
              <div className="mx-auto mt-8 flex max-w-lg items-start gap-3 rounded-xl border border-error/20 bg-error/5 px-4 py-3 text-sm text-error">
                <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" />
                <span>{error}</span>
              </div>
            ) : visibleDocs.length === 0 ? (
              <div className="mx-auto mt-16 max-w-md rounded-2xl border border-dashed border-gray-200 bg-white/70 px-6 py-10 text-center">
                <p className="text-sm font-medium text-base-content/70">
                  {docs.length ? 'No documents match your filters' : 'No unattached client uploads'}
                </p>
                {!docs.length ? (
                  <p className="mt-1 text-xs text-base-content/45">
                    Portal uploads that are not yet attached to a sub effort will appear here.
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="min-w-0 overflow-x-auto">
                <div className="min-w-[920px]">
                  <table className="mb-2 w-full table-fixed border-collapse">
                    <colgroup>
                      <col className="w-12" />
                      <col />
                      <col />
                      <col className="w-[28%]" />
                      <col className="w-36" />
                      <col className="w-12" />
                    </colgroup>
                    <thead>
                      <tr className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                        <th className="bg-transparent px-3 py-2 text-center font-semibold align-middle">
                          <TableSelectAllHeader
                            checked={
                              attachableDocs.length > 0 &&
                              attachableDocs.every((d) => selectedIds.has(d.id))
                            }
                            indeterminate={
                              attachableDocs.some((d) => selectedIds.has(d.id)) &&
                              !attachableDocs.every((d) => selectedIds.has(d.id))
                            }
                            disabled={attachableDocs.length === 0 || busy}
                            onChange={setTableSelection}
                          />
                        </th>
                        <th className="bg-transparent px-3 py-2 text-center font-semibold">
                          Contact name
                        </th>
                        <th className="bg-transparent px-3 py-2 text-center font-semibold">
                          Document type
                        </th>
                        <th className="bg-transparent px-3 py-2 text-left font-semibold">
                          Document name
                        </th>
                        <th className="bg-transparent px-3 py-2 text-center font-semibold whitespace-nowrap">
                          Uploaded at
                        </th>
                        <th className="bg-transparent px-3 py-2 text-center font-semibold">
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                  </table>
                  <div className="overflow-x-auto rounded-2xl bg-white">
                    <table className="w-full table-fixed border-collapse">
                      <colgroup>
                        <col className="w-12" />
                        <col />
                        <col />
                        <col className="w-[28%]" />
                        <col className="w-36" />
                        <col className="w-12" />
                      </colgroup>
                      <tbody>
                        {visibleDocs.map((doc, index) => {
                          const canAttachDoc = Boolean(doc.storagePath?.trim());
                          const checked = selectedIds.has(doc.id);
                          const isRenaming = renamingDocId === doc.id;
                          return (
                            <tr
                              key={doc.id}
                              className={`${
                                checked ? 'bg-primary/[0.03]' : 'bg-white'
                              }`}
                            >
                              <td className="px-3 py-3 text-center align-middle">
                                <input
                                  type="checkbox"
                                  className="checkbox checkbox-sm"
                                  checked={checked}
                                  disabled={!canAttachDoc}
                                  onChange={() => {
                                    if (canAttachDoc) toggleSelected(doc.id);
                                  }}
                                  aria-label={`Select ${doc.name}`}
                                />
                              </td>
                              <td className="px-3 py-3 text-center align-middle text-sm">
                                <span className="inline-flex max-w-full min-w-0 items-center justify-center gap-1.5">
                                  {doc.uploadedByName ? (
                                    <span className="min-w-0 truncate font-medium text-base-content/80">
                                      {doc.uploadedByName}
                                    </span>
                                  ) : (
                                    <span className="text-base-content/50">—</span>
                                  )}
                                  <ClientUploadBadge />
                                </span>
                              </td>
                              <td className="px-3 py-3 text-center align-middle">
                                {doc.documentTypeName ? (
                                  <span
                                    className="inline-block max-w-[14rem] truncate text-sm text-base-content/80"
                                    title={doc.documentTypeName}
                                  >
                                    {doc.documentTypeName}
                                  </span>
                                ) : (
                                  <span className="text-sm text-gray-400">—</span>
                                )}
                              </td>
                              <td className="px-3 py-3 align-middle">
                                {isRenaming ? (
                                  <div className="flex min-w-0 items-center gap-1">
                                    <input
                                      type="text"
                                      className="input input-bordered input-sm min-w-0 flex-1"
                                      value={renameValue}
                                      onChange={(e) => setRenameValue(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          e.preventDefault();
                                          void saveInlineRename();
                                        }
                                        if (e.key === 'Escape') {
                                          e.preventDefault();
                                          cancelInlineRename();
                                        }
                                      }}
                                      autoFocus
                                      disabled={renameSaving}
                                    />
                                    <button
                                      type="button"
                                      className="btn btn-ghost btn-circle btn-sm"
                                      onClick={() => void saveInlineRename()}
                                      disabled={renameSaving || !renameValue.trim()}
                                      aria-label="Save name"
                                    >
                                      {renameSaving ? (
                                        <span className="loading loading-spinner loading-xs" />
                                      ) : (
                                        <CheckIcon className="h-4 w-4 text-emerald-600" />
                                      )}
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-ghost btn-circle btn-sm"
                                      onClick={cancelInlineRename}
                                      disabled={renameSaving}
                                      aria-label="Cancel rename"
                                    >
                                      <XMarkIcon className="h-4 w-4" />
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    className="inline-flex max-w-full items-center gap-2 text-left hover:opacity-80"
                                    onClick={() => setViewerIndex(index)}
                                  >
                                    <DocumentFileGlyph
                                      fileType={doc.fileType}
                                      fileName={doc.name}
                                      className="h-12 w-12 shrink-0"
                                    />
                                    <span className="min-w-0 truncate text-sm font-semibold text-base-content">
                                      {doc.name}
                                    </span>
                                  </button>
                                )}
                              </td>
                              <td className="px-3 py-3 text-center align-middle whitespace-nowrap text-sm tabular-nums text-gray-500">
                                {formatDocDate(doc.lastModified)}
                              </td>
                              <td className="px-2 py-3 text-center align-middle">
                                <DocRowActionsMenu
                                  disabled={busy || isRenaming}
                                  deleting={deletingDocId === doc.id}
                                  savingDocumentType={savingTypeDocId === doc.id}
                                  documentTypes={documentTypes}
                                  currentDocumentTypeId={doc.documentTypeId}
                                  onEditFileName={() => startInlineRename(doc)}
                                  onDelete={() => void deleteDocument(doc)}
                                  onSelectDocumentType={(type) =>
                                    void assignDocumentType(doc, type)
                                  }
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </MobileBottomSheet>

      <DocumentViewerModal
        isOpen={open && viewerIndex !== null && viewerDocs.length > 0}
        onClose={() => setViewerIndex(null)}
        documents={viewerDocs}
        initialIndex={viewerIndex ?? 0}
        subEffortRows={subEffortRows}
        targetSubEffortId={targetSubEffortId}
        activeFolderId={activeFolderId}
        onAttached={(paths, meta) => {
          if (meta) markPendingAttached(paths, meta.id, meta.name);
          onAttached?.();
        }}
        onDetached={(paths, meta) => {
          if (meta) {
            setPendingAttachments((prev) => {
              const next = new Map(prev);
              for (const path of paths) {
                const key = normalizeStorageKey(path);
                if (!key) continue;
                const list = (next.get(key) ?? []).filter((x) => x.id !== meta.id);
                if (list.length === 0) next.delete(key);
                else next.set(key, list);
              }
              return next;
            });
          }
          onAttached?.();
        }}
      />
    </>
  );
}

export default ClientUploadsDocumentsModal;
