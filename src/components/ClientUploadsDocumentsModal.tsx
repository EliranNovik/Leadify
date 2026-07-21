import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDownIcon,
  ExclamationTriangleIcon,
  PaperClipIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import MobileBottomSheet from './MobileBottomSheet';
import DocumentViewerModal, { type DocumentViewerItem } from './DocumentViewerModal';
import { DocumentFileGlyph } from '../lib/documentFileGlyphs';
import {
  fetchClientPortalUploadDocuments,
  type CaseCategoryDocument,
} from '../lib/sequenceOfEventsDocuments';
import {
  attachStoragePathsToSubEffort,
  buildSubEffortAttachmentsByPath,
  listSubEffortAttachOptions,
  normalizeStorageKey,
  removeStoragePathsFromSubEffort,
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

const DOCUMENT_TYPE_BADGE_COLORS = [
  'bg-sky-100 text-sky-800',
  'bg-violet-100 text-violet-800',
  'bg-emerald-100 text-emerald-800',
  'bg-amber-100 text-amber-900',
  'bg-rose-100 text-rose-800',
  'bg-teal-100 text-teal-800',
  'bg-indigo-100 text-indigo-800',
  'bg-orange-100 text-orange-900',
  'bg-fuchsia-100 text-fuchsia-800',
  'bg-lime-100 text-lime-900',
  'bg-cyan-100 text-cyan-800',
  'bg-pink-100 text-pink-800',
] as const;

function documentTypeBadgeClass(name: string): string {
  let hash = 0;
  const key = name.trim().toLowerCase();
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return DOCUMENT_TYPE_BADGE_COLORS[hash % DOCUMENT_TYPE_BADGE_COLORS.length];
}

export function ClientUploadsDocumentsModal({
  open,
  onClose,
  leadNumber,
  subEffortRows = [],
  targetSubEffortId = null,
  activeFolderId = null,
  onAttached,
}: {
  open: boolean;
  onClose: () => void;
  leadNumber?: string | null;
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
  const [isRemoving, setIsRemoving] = useState(false);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [removeMenuOpen, setRemoveMenuOpen] = useState(false);
  const attachMenuRef = useRef<HTMLDivElement | null>(null);
  const removeMenuRef = useRef<HTMLDivElement | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<Map<string, SubEffortAttachmentRef[]>>(
    () => new Map(),
  );
  const [suppressedAttachments, setSuppressedAttachments] = useState<Map<string, Set<string>>>(
    () => new Map(),
  );

  const attachOptions = useMemo(() => listSubEffortAttachOptions(subEffortRows), [subEffortRows]);

  const attachmentsByPath = useMemo(() => {
    const fromRows = buildSubEffortAttachmentsByPath(subEffortRows);
    const merged = new Map(fromRows);
    for (const [path, refs] of pendingAttachments) {
      const list = [...(merged.get(path) ?? [])];
      for (const ref of refs) {
        if (!list.some((x) => x.id === ref.id)) list.push(ref);
      }
      merged.set(path, list);
    }
    if (suppressedAttachments.size === 0) return merged;
    const filtered = new Map<string, SubEffortAttachmentRef[]>();
    for (const [path, refs] of merged) {
      const suppressed = suppressedAttachments.get(path);
      const nextRefs = suppressed ? refs.filter((r) => !suppressed.has(r.id)) : refs;
      if (nextRefs.length > 0) filtered.set(path, nextRefs);
    }
    return filtered;
  }, [subEffortRows, pendingAttachments, suppressedAttachments]);

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
    setSuppressedAttachments((prev) => {
      if (prev.size === 0) return prev;
      const fromRows = buildSubEffortAttachmentsByPath(subEffortRows);
      let changed = false;
      const next = new Map(prev);
      for (const [path, ids] of prev) {
        const rowRefs = fromRows.get(path) ?? [];
        const still = new Set([...ids].filter((id) => rowRefs.some((r) => r.id === id)));
        if (still.size === 0) {
          next.delete(path);
          changed = true;
        } else if (still.size !== ids.size) {
          next.set(path, still);
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
      setSuppressedAttachments(new Map());
      setAttachMenuOpen(false);
      setRemoveMenuOpen(false);
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
        const list = await fetchClientPortalUploadDocuments(lead);
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
  }, [open, leadNumber]);

  useEffect(() => {
    if (!attachMenuOpen && !removeMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (attachMenuRef.current?.contains(target)) return;
      if (removeMenuRef.current?.contains(target)) return;
      setAttachMenuOpen(false);
      setRemoveMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAttachMenuOpen(false);
        setRemoveMenuOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [attachMenuOpen, removeMenuOpen]);

  const attachableDocs = useMemo(
    () => docs.filter((d) => Boolean(d.storagePath?.trim())),
    [docs],
  );

  const allAttachableSelected =
    attachableDocs.length > 0 && attachableDocs.every((d) => selectedIds.has(d.id));

  const selectedDocs = useMemo(
    () => docs.filter((d) => selectedIds.has(d.id)),
    [docs, selectedIds],
  );

  const removeOptions = useMemo(() => {
    const byId = new Map<string, SubEffortAttachmentRef>();
    for (const doc of selectedDocs) {
      const pathKey = normalizeStorageKey(doc.storagePath);
      if (!pathKey) continue;
      for (const ref of attachmentsByPath.get(pathKey) ?? []) {
        byId.set(ref.id, ref);
      }
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [selectedDocs, attachmentsByPath]);

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

  const clearPendingAttached = (paths: string[], subEffortId: string) => {
    setPendingAttachments((prev) => {
      const next = new Map(prev);
      for (const path of paths) {
        const key = normalizeStorageKey(path);
        if (!key) continue;
        const list = (next.get(key) ?? []).filter((x) => x.id !== subEffortId);
        if (list.length === 0) next.delete(key);
        else next.set(key, list);
      }
      return next;
    });
    setSuppressedAttachments((prev) => {
      const next = new Map(prev);
      for (const path of paths) {
        const key = normalizeStorageKey(path);
        if (!key) continue;
        const set = new Set(next.get(key) ?? []);
        set.add(subEffortId);
        next.set(key, set);
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
    setRemoveMenuOpen(false);
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

  const removeFromSubEffort = async (ref: SubEffortAttachmentRef) => {
    const option = attachOptions.find((o) => o.id === ref.id);
    if (!option) {
      toast.error('Sub effort not found.');
      return;
    }
    const paths = selectedDocs
      .map((d) => normalizeStorageKey(d.storagePath))
      .filter((path) => {
        if (!path) return false;
        return (attachmentsByPath.get(path) ?? []).some((a) => a.id === ref.id);
      });
    if (!paths.length) {
      toast.error('Selected files are not attached to this sub effort.');
      return;
    }
    setRemoveMenuOpen(false);
    setAttachMenuOpen(false);
    setIsRemoving(true);
    try {
      const { removedCount } = await removeStoragePathsFromSubEffort({
        targetSubEffortId: option.id,
        targetDocumentUrl: option.documentUrl,
        paths,
      });
      if (removedCount === 0) {
        toast.error('Nothing to remove from this sub effort.');
        return;
      }
      toast.success(
        removedCount === 1
          ? `Removed from ${option.name}`
          : `Removed ${removedCount} files from ${option.name}`,
      );
      clearPendingAttached(paths, option.id);
      setSelectedIds(new Set());
      onAttached?.();
    } catch (e: unknown) {
      console.error('removeClientUploadDocs:', e);
      toast.error(e instanceof Error ? e.message : 'Failed to remove');
    } finally {
      setIsRemoving(false);
    }
  };

  const busy = isAttaching || isRemoving;
  const canOpenAttachMenu = selectedIds.size > 0 && !busy && attachOptions.length > 0;
  const canOpenRemoveMenu = selectedIds.size > 0 && !busy && removeOptions.length > 0;

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
              <div className="text-xl font-bold tracking-tight text-base-content/95">Client uploads</div>
              <div className="text-xs text-base-content/50">
                {loading
                  ? 'Loading…'
                  : docs.length
                    ? `${docs.length} document${docs.length === 1 ? '' : 's'} from the client portal`
                    : 'No client portal uploads yet'}
                <span className="ml-1">· Select files to attach or remove from a sub effort</span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {docs.length > 0 ? (
                <>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm h-9 rounded-full px-3 text-sm font-medium"
                    onClick={toggleSelectAll}
                    disabled={attachableDocs.length === 0 || busy}
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
                        setRemoveMenuOpen(false);
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
                  <div className="relative" ref={removeMenuRef}>
                    <button
                      type="button"
                      className="btn btn-sm h-9 gap-1.5 rounded-full border border-red-200 bg-white px-3.5 font-medium text-red-600 hover:bg-red-50"
                      onClick={() => {
                        if (selectedIds.size === 0) {
                          toast.error('Select at least one file to remove.');
                          return;
                        }
                        if (removeOptions.length === 0) {
                          toast.error('Selected files are not attached to any sub effort.');
                          return;
                        }
                        setAttachMenuOpen(false);
                        setRemoveMenuOpen((v) => !v);
                      }}
                      disabled={busy || selectedIds.size === 0}
                      aria-expanded={removeMenuOpen}
                      aria-haspopup="menu"
                    >
                      {isRemoving ? (
                        <span className="loading loading-spinner loading-xs" />
                      ) : (
                        <TrashIcon className="h-4 w-4" />
                      )}
                      Remove
                      <ChevronDownIcon className="h-4 w-4 opacity-80" />
                    </button>
                    {removeMenuOpen && canOpenRemoveMenu ? (
                      <div
                        role="menu"
                        className="absolute right-0 z-50 mt-1.5 max-h-72 w-64 overflow-y-auto rounded-xl border border-base-200 bg-white py-1 shadow-lg"
                      >
                        <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-base-content/45">
                          Remove from sub effort
                        </div>
                        {removeOptions.map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            role="menuitem"
                            className="flex w-full items-center px-3 py-2.5 text-left text-sm text-red-700 hover:bg-red-50"
                            onClick={() => void removeFromSubEffort(opt)}
                          >
                            {opt.name}
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
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
          </div>

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
            ) : docs.length === 0 ? (
              <div className="mx-auto mt-16 max-w-md rounded-2xl border border-dashed border-gray-200 bg-white/70 px-6 py-10 text-center">
                <p className="text-sm font-medium text-base-content/70">No client portal uploads</p>
                <p className="mt-1 text-xs text-base-content/45">
                  Documents uploaded by contacts via the client portal will appear here.
                </p>
              </div>
            ) : (
              <div className="min-w-0 overflow-x-auto">
                <div className="min-w-[860px]">
                  <table className="mb-2 w-full table-fixed border-collapse">
                    <colgroup>
                      <col className="w-12" />
                      <col />
                      <col />
                      <col />
                      <col />
                      <col className="w-36" />
                    </colgroup>
                    <thead>
                      <tr className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                        <th className="bg-transparent px-3 py-2 text-center font-semibold">
                          <span className="sr-only">Select</span>
                        </th>
                        <th className="bg-transparent px-3 py-2 text-center font-semibold">
                          Contact name
                        </th>
                        <th className="bg-transparent px-3 py-2 text-center font-semibold">
                          Document type
                        </th>
                        <th className="bg-transparent px-3 py-2 text-center font-semibold">
                          Document name
                        </th>
                        <th className="bg-transparent px-3 py-2 text-center font-semibold">
                          Attached to
                        </th>
                        <th className="bg-transparent px-3 py-2 text-center font-semibold whitespace-nowrap">
                          Uploaded at
                        </th>
                      </tr>
                    </thead>
                  </table>
                  <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-[0_4px_16px_rgba(15,23,42,0.04)]">
                    <table className="w-full table-fixed border-collapse">
                      <colgroup>
                        <col className="w-12" />
                        <col />
                        <col />
                        <col />
                        <col />
                        <col className="w-36" />
                      </colgroup>
                      <tbody>
                        {docs.map((doc, index) => {
                          const pathKey = normalizeStorageKey(doc.storagePath);
                          const attachedTo = pathKey ? attachmentsByPath.get(pathKey) ?? [] : [];
                          const canAttachDoc = Boolean(doc.storagePath?.trim());
                          const checked = selectedIds.has(doc.id);
                          return (
                            <tr
                              key={doc.id}
                              className={`border-b border-gray-100 last:border-0 ${
                                checked ? 'bg-primary/[0.03]' : ''
                              } ${index % 2 === 1 ? 'bg-gray-50/60' : 'bg-white'}`}
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
                              <td className="px-3 py-3 text-center align-middle text-sm font-medium text-gray-800">
                                {doc.uploadedByName || '—'}
                              </td>
                              <td className="px-3 py-3 text-center align-middle">
                                {doc.documentTypeName ? (
                                  <span
                                    className={`inline-flex max-w-[14rem] items-center truncate rounded-md px-2 py-0.5 text-sm font-semibold ${documentTypeBadgeClass(doc.documentTypeName)}`}
                                    title={doc.documentTypeName}
                                  >
                                    {doc.documentTypeName}
                                  </span>
                                ) : (
                                  <span className="text-sm text-gray-400">—</span>
                                )}
                              </td>
                              <td className="px-3 py-3 text-center align-middle">
                                <button
                                  type="button"
                                  className="inline-flex max-w-full items-center justify-center gap-2 hover:opacity-80"
                                  onClick={() => setViewerIndex(index)}
                                >
                                  <DocumentFileGlyph
                                    fileType={doc.fileType}
                                    fileName={doc.name}
                                    className="h-5 w-5 shrink-0"
                                  />
                                  <span className="min-w-0 truncate text-sm font-semibold text-base-content">
                                    {doc.name}
                                  </span>
                                </button>
                              </td>
                              <td className="px-3 py-3 text-center align-middle">
                                {attachedTo.length > 0 ? (
                                  <span
                                    className="text-sm text-gray-700"
                                    title={attachedTo.map((a) => a.name).join(', ')}
                                  >
                                    {attachedTo.map((a) => a.name).join(', ')}
                                  </span>
                                ) : (
                                  <span className="text-sm text-gray-400">—</span>
                                )}
                              </td>
                              <td className="px-3 py-3 text-center align-middle whitespace-nowrap text-sm tabular-nums text-gray-500">
                                {formatDocDate(doc.lastModified)}
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
      />
    </>
  );
}

export default ClientUploadsDocumentsModal;
