import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDownIcon,
  DocumentIcon,
  ExclamationTriangleIcon,
  PaperClipIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import MobileBottomSheet from './MobileBottomSheet';
import DocumentViewerModal, { type DocumentViewerItem } from './DocumentViewerModal';
import { DocumentFileGlyph } from '../lib/documentFileGlyphs';
import {
  CASE_DOCUMENT_CATEGORY_META,
  fetchCaseCategoryDocuments,
  type CaseCategoryDocument,
  type CaseDocumentCategoryKey,
} from '../lib/sequenceOfEventsDocuments';
import {
  attachStoragePathsToSubEffort,
  buildSubEffortAttachmentsByPath,
  listSubEffortAttachOptions,
  normalizeStorageKey,
  type SubEffortAttachOption,
  type SubEffortAttachmentRef,
} from '../lib/subEffortDocumentAttach';

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

export function SequenceOfEventsDocumentsModal({
  open,
  onClose,
  leadNumber,
  clientId = null,
  subEffortRows = [],
  targetSubEffortId = null,
  activeFolderId = null,
  onAttached,
  category = 'sequence_of_events',
  title,
}: {
  open: boolean;
  onClose: () => void;
  leadNumber?: string | null;
  clientId?: string | null;
  subEffortRows?: Array<{ id?: unknown; document_url?: unknown; sub_efforts?: unknown }> | null;
  /** Currently selected workflow sub effort — used for “Attached” highlight only. */
  targetSubEffortId?: string | number | null;
  activeFolderId?: string | null;
  onAttached?: () => void;
  category?: CaseDocumentCategoryKey;
  title?: string;
}) {
  const meta = CASE_DOCUMENT_CATEGORY_META[category] ?? CASE_DOCUMENT_CATEGORY_META.sequence_of_events;
  const modalTitle = title?.trim() || meta.title;
  const emptyLabel = meta.emptyLabel;

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
        const list = await fetchCaseCategoryDocuments(category, lead, clientId);
        if (!cancelled) setDocs(list);
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
  }, [open, leadNumber, clientId, category]);

  useEffect(() => {
    if (!attachMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const el = attachMenuRef.current;
      if (el && !el.contains(e.target as Node)) setAttachMenuOpen(false);
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

  const attachableDocs = useMemo(
    () => docs.filter((d) => Boolean(d.storagePath?.trim())),
    [docs],
  );

  const allAttachableSelected =
    attachableDocs.length > 0 && attachableDocs.every((d) => selectedIds.has(d.id));

  const viewerDocs: DocumentViewerItem[] = docs.map((d) => ({
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

  const toggleSelectAll = () => {
    if (allAttachableSelected) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(attachableDocs.map((d) => d.id)));
  };

  const markPendingAttached = (paths: string[], targetId: string, targetName: string) => {
    setPendingAttachments((prev) => {
      const next = new Map(prev);
      for (const raw of paths) {
        const path = normalizeStorageKey(raw);
        if (!path) continue;
        const list = [...(next.get(path) ?? [])];
        if (!list.some((x) => x.id === targetId)) list.push({ id: targetId, name: targetName });
        next.set(path, list);
      }
      return next;
    });
  };

  const attachSelectedTo = async (option: SubEffortAttachOption) => {
    if (isAttaching) return;
    const picked = docs.filter((d) => selectedIds.has(d.id) && d.storagePath?.trim());
    if (picked.length === 0) {
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
      console.error('attachSequenceOfEventsDocs:', e);
      toast.error(e instanceof Error ? e.message : 'Failed to attach');
    } finally {
      setIsAttaching(false);
    }
  };

  const canOpenAttachMenu = selectedIds.size > 0 && !isAttaching && attachOptions.length > 0;

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
          <div className="flex shrink-0 items-start justify-between gap-3 px-4 py-3 md:px-6 md:py-4">
            <div className="min-w-0">
              <div className="text-xl font-bold tracking-tight text-base-content/95">
                {modalTitle}
              </div>
              <div className="text-xs text-base-content/50">
                {loading
                  ? 'Loading…'
                  : docs.length
                    ? `${docs.length} document${docs.length === 1 ? '' : 's'}`
                    : 'No documents yet'}
                <span className="ml-1">· Select files, then Attach to a sub effort</span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {docs.length > 0 ? (
                <>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm h-9 rounded-full px-3 text-sm font-medium"
                    onClick={toggleSelectAll}
                    disabled={attachableDocs.length === 0}
                  >
                    {allAttachableSelected ? 'Clear' : 'Select all'}
                  </button>
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
                      disabled={isAttaching || selectedIds.size === 0}
                      aria-expanded={attachMenuOpen}
                      aria-haspopup="menu"
                      title={
                        selectedIds.size === 0
                          ? 'Select documents to attach'
                          : 'Choose a sub effort to attach to'
                      }
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
                        className="absolute right-0 z-50 mt-1.5 max-h-72 w-64 overflow-y-auto rounded-xl border border-base-200 bg-white py-1 shadow-lg"
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
                                ? 'font-semibold text-primary'
                                : 'text-base-content'
                            }`}
                            onClick={() => void attachSelectedTo(opt)}
                          >
                            <span className="min-w-0 truncate">{opt.name}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </>
              ) : null}
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white text-gray-600 shadow-sm transition-colors hover:bg-gray-50"
                onClick={onClose}
                aria-label="Close"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto px-4 pb-6 md:px-6">
            <div className="mx-auto w-full max-w-4xl">
              {loading ? (
                <div className="flex items-center justify-center py-16">
                  <span className="loading loading-spinner loading-lg" />
                  <span className="ml-3 text-base-content/70">Loading documents…</span>
                </div>
              ) : error ? (
                <div className="flex items-center justify-center gap-2 py-16 text-error">
                  <ExclamationTriangleIcon className="h-6 w-6 shrink-0" />
                  <span>{error}</span>
                </div>
              ) : docs.length === 0 ? (
                <div className="py-16 text-center text-base-content/70">
                  <DocumentIcon className="mx-auto mb-4 h-16 w-16 opacity-50" />
                  <p>{emptyLabel}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {docs.map((doc, index) => {
                    const canAttachDoc = Boolean(doc.storagePath?.trim());
                    const checked = selectedIds.has(doc.id);
                    const pathKey = normalizeStorageKey(doc.storagePath);
                    const attachedTo = pathKey ? attachmentsByPath.get(pathKey) ?? [] : [];
                    const attachedToCurrent =
                      targetSubEffortId != null &&
                      attachedTo.some((a) => String(a.id) === String(targetSubEffortId));
                    return (
                      <div
                        key={doc.id}
                        className={`flex w-full min-w-0 items-center gap-2 rounded-[14px] border bg-white px-3 py-3 shadow-[0_4px_16px_rgba(15,23,42,0.04)] transition-colors sm:gap-3 sm:px-4 sm:py-4 ${
                          checked
                            ? 'border-primary bg-primary/[0.03]'
                            : attachedTo.length
                              ? 'border-emerald-200/90 bg-emerald-50/40'
                              : 'border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <label
                          className={`flex shrink-0 items-center justify-center ${
                            canAttachDoc ? 'cursor-pointer' : 'cursor-not-allowed opacity-40'
                          }`}
                          onClick={(e) => e.stopPropagation()}
                        >
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
                        </label>
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 sm:gap-4"
                          onClick={() => setViewerIndex(index)}
                          aria-label={`Open ${doc.name}`}
                        >
                          <span className="shrink-0">
                            <DocumentFileGlyph fileType={doc.fileType} fileName={doc.name} />
                          </span>
                          <div className="min-w-0 flex-1 overflow-hidden">
                            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                              <p className="min-w-0 break-words text-base font-semibold leading-snug text-base-content [overflow-wrap:anywhere]">
                                {doc.name}
                              </p>
                              {attachedToCurrent ? (
                                <span className="inline-flex shrink-0 items-center rounded-md bg-emerald-600/10 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-800">
                                  Attached
                                </span>
                              ) : null}
                              {attachedTo.map((a) => (
                                <span
                                  key={a.id}
                                  className={`inline-flex max-w-[12rem] items-center truncate rounded-md px-2 py-0.5 text-[11px] font-medium ${
                                    String(a.id) === String(targetSubEffortId ?? '')
                                      ? 'bg-emerald-600 text-white'
                                      : 'bg-emerald-100 text-emerald-900'
                                  }`}
                                  title={`Attached to ${a.name}`}
                                >
                                  {a.name}
                                </span>
                              ))}
                            </div>
                            <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-base-content/65">
                              <span className="shrink-0 tabular-nums">
                                {formatDocDate(doc.lastModified)}
                              </span>
                              {doc.uploadedByName ? (
                                <>
                                  <span className="text-base-content/35" aria-hidden>
                                    ·
                                  </span>
                                  <span className="min-w-0 truncate">
                                    {doc.isClientPortalUpload ? (
                                      <>
                                        Uploaded by{' '}
                                        <span className="font-semibold text-base-content/85">
                                          {doc.uploadedByName}
                                        </span>
                                        <span className="ml-1.5 inline-flex items-center rounded-md bg-base-200 px-1.5 py-0.5 text-[11px] font-medium text-base-content/70">
                                          Client portal
                                        </span>
                                      </>
                                    ) : (
                                      <>
                                        by{' '}
                                        <span className="font-semibold text-base-content/85">
                                          {doc.uploadedByName}
                                        </span>
                                      </>
                                    )}
                                  </span>
                                </>
                              ) : null}
                            </div>
                          </div>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
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
      />
    </>
  );
}

export default SequenceOfEventsDocumentsModal;
