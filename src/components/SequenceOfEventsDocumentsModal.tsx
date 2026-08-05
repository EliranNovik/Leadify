import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckIcon,
  ChevronDownIcon,
  DocumentIcon,
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
  CASE_DOCUMENT_CATEGORY_META,
  deleteCaseCategoryDocument,
  fetchCaseCategoryDocuments,
  type CaseCategoryDocument,
  type CaseDocumentCategoryKey,
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
  normalizeSubEffortDocItems,
  removeStoragePathsFromSubEffort,
  type SubEffortAttachOption,
  type SubEffortAttachmentRef,
} from '../lib/subEffortDocumentAttach';
import { supabase } from '../lib/supabase';
import {
  CaseDocumentsModalFilterBar,
  DocumentUploaderCell,
  DocRowActionsMenu,
  EMPTY_CASE_DOCS_FILTERS,
  SubEffortAttachBadge,
  TableSelectAllHeader,
  filterCaseCategoryDocuments,
  useEdgeAwareMenuAlign,
  type CaseDocsFilterState,
} from './caseDocumentsModalUi';

const SUB_EFFORT_MENU_WIDTH = 384;

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

function isImageDocument(fileType: string | null | undefined, fileName: string): boolean {
  const ft = String(fileType ?? '').toLowerCase();
  if (ft.includes('image/')) return true;
  return /\.(jpe?g|png|gif|webp|bmp|svg|heic|avif)$/i.test(fileName);
}

function isPdfDocument(fileType: string | null | undefined, fileName: string): boolean {
  const ft = String(fileType ?? '').toLowerCase();
  if (ft.includes('pdf')) return true;
  return /\.pdf$/i.test(fileName);
}

function attachmentSortRank(
  attachedTo: SubEffortAttachmentRef[],
  attachOptions: SubEffortAttachOption[],
): number {
  if (attachedTo.length === 0) return Number.MAX_SAFE_INTEGER;
  let best = Number.MAX_SAFE_INTEGER;
  for (const a of attachedTo) {
    const idx = attachOptions.findIndex((o) => o.id === a.id);
    if (idx >= 0 && idx < best) best = idx;
  }
  return best === Number.MAX_SAFE_INTEGER ? attachOptions.length : best;
}

const UNATTACHED_GROUP_KEY = '__unattached__';
const UNATTACHED_GROUP_TITLE = 'Not attached yet';

function orderedAttachments(
  attachedTo: SubEffortAttachmentRef[],
  attachOptions: SubEffortAttachOption[],
): SubEffortAttachmentRef[] {
  return [...attachedTo].sort((a, b) => {
    const ai = attachOptions.findIndex((o) => o.id === a.id);
    const bi = attachOptions.findIndex((o) => o.id === b.id);
    const aRank = ai < 0 ? 9999 : ai;
    const bRank = bi < 0 ? 9999 : bi;
    if (aRank !== bRank) return aRank - bRank;
    return a.name.localeCompare(b.name);
  });
}

function attachmentGroupMeta(
  attachedTo: SubEffortAttachmentRef[],
  attachOptions: SubEffortAttachOption[],
): { key: string; title: string; sortRank: number } {
  if (attachedTo.length === 0) {
    return {
      key: UNATTACHED_GROUP_KEY,
      title: UNATTACHED_GROUP_TITLE,
      sortRank: Number.MAX_SAFE_INTEGER,
    };
  }
  const ordered = orderedAttachments(attachedTo, attachOptions);
  return {
    key: ordered.map((a) => a.id).join('|'),
    title: ordered.map((a) => a.name).join(' · '),
    sortRank: attachmentSortRank(ordered, attachOptions),
  };
}

function DocPreviewThumb({
  doc,
}: {
  doc: Pick<CaseCategoryDocument, 'url' | 'fileType' | 'name'>;
}) {
  const showImage = isImageDocument(doc.fileType, doc.name) && /^https?:\/\//i.test(doc.url);
  const showPdf = isPdfDocument(doc.fileType, doc.name);
  return (
    <span className="relative inline-flex h-[4.5rem] w-14 shrink-0 overflow-hidden rounded-md bg-transparent">
      {showImage ? (
        <img
          src={doc.url}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          draggable={false}
        />
      ) : showPdf ? (
        <span className="flex h-full w-full flex-col justify-between rounded-md bg-white px-1.5 pb-1.5 pt-2 shadow-none">
          <span>
            <span className="mb-1.5 block h-0.5 w-2/3 rounded-full bg-red-500/80" />
            <span className="space-y-1">
              <span className="block h-0.5 w-full rounded-full bg-slate-200" />
              <span className="block h-0.5 w-[85%] rounded-full bg-slate-200" />
              <span className="block h-0.5 w-[70%] rounded-full bg-slate-200" />
            </span>
          </span>
          <span className="text-[8px] font-bold uppercase tracking-wide text-red-600">PDF</span>
        </span>
      ) : (
        <span className="flex h-full w-full items-center justify-center">
          <DocumentFileGlyph
            fileType={doc.fileType}
            fileName={doc.name}
            className="h-14 w-14 shrink-0"
          />
        </span>
      )}
    </span>
  );
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
  const [renamingDocId, setRenamingDocId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);
  const [filters, setFilters] = useState<CaseDocsFilterState>(EMPTY_CASE_DOCS_FILTERS);
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null);
  const [documentTypes, setDocumentTypes] = useState<LeadCaseDocumentType[]>([]);
  const [savingTypeDocId, setSavingTypeDocId] = useState<string | null>(null);

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
      setRenamingDocId(null);
      setRenameValue('');
      setRenameSaving(false);
      setFilters(EMPTY_CASE_DOCS_FILTERS);
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
          fetchCaseCategoryDocuments(category, lead, clientId),
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
  }, [open, leadNumber, clientId, category]);

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

  const sortedDocs = useMemo(() => {
    const filtered = filterCaseCategoryDocuments(docs, filters, {
      attachmentsByPath,
      applySubEffortFilter: true,
    });
    return [...filtered].sort((a, b) => {
      const aPath = normalizeStorageKey(a.storagePath);
      const bPath = normalizeStorageKey(b.storagePath);
      const aAttached = aPath ? attachmentsByPath.get(aPath) ?? [] : [];
      const bAttached = bPath ? attachmentsByPath.get(bPath) ?? [] : [];
      const rankDiff =
        attachmentSortRank(aAttached, attachOptions) -
        attachmentSortRank(bAttached, attachOptions);
      if (rankDiff !== 0) return rankDiff;
      const aName = (aAttached[0]?.name ?? '').localeCompare(bAttached[0]?.name ?? '');
      if (aName !== 0) return aName;
      const byDate = new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime();
      if (byDate !== 0) return byDate;
      return a.name.localeCompare(b.name);
    });
  }, [docs, filters, attachmentsByPath, attachOptions]);

  const displayedDocGroups = useMemo(() => {
    type Group = {
      key: string;
      title: string;
      sortRank: number;
      docs: CaseCategoryDocument[];
    };
    const map = new Map<string, Group>();
    for (const doc of sortedDocs) {
      const path = normalizeStorageKey(doc.storagePath);
      const attachedTo = path ? attachmentsByPath.get(path) ?? [] : [];
      const meta = attachmentGroupMeta(attachedTo, attachOptions);
      const existing = map.get(meta.key);
      if (existing) existing.docs.push(doc);
      else {
        map.set(meta.key, {
          key: meta.key,
          title: meta.title,
          sortRank: meta.sortRank,
          docs: [doc],
        });
      }
    }
    return [...map.values()].sort((a, b) => {
      if (a.sortRank !== b.sortRank) return a.sortRank - b.sortRank;
      if (a.key === UNATTACHED_GROUP_KEY) return 1;
      if (b.key === UNATTACHED_GROUP_KEY) return -1;
      return a.title.localeCompare(b.title);
    });
  }, [sortedDocs, attachmentsByPath, attachOptions]);

  const viewerIndexByDocId = useMemo(() => {
    const map = new Map<string, number>();
    sortedDocs.forEach((d, i) => map.set(d.id, i));
    return map;
  }, [sortedDocs]);

  const selectedDocs = useMemo(
    () => sortedDocs.filter((d) => selectedIds.has(d.id)),
    [sortedDocs, selectedIds],
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

  const viewerDocs: DocumentViewerItem[] = sortedDocs.map((d) => ({
    id: d.id,
    name: d.name,
    url: d.url,
    fileType: d.fileType,
    lastModified: d.lastModified,
    storagePath: d.storagePath,
  }));

  const renameDocument = useCallback(
    async (doc: { id: string; name: string; storagePath?: string | null }, newName: string) => {
      const trimmed = newName.trim();
      if (!trimmed) throw new Error('Name is required');
      if (trimmed === doc.name) return;

      const path = normalizeStorageKey(doc.storagePath);
      const id = String(doc.id);

      if (id.startsWith('subeffort:')) {
        const rowId = id.split(':')[1];
        if (!rowId) throw new Error('Document not found');
        const { data: row, error: fetchError } = await supabase
          .from('lead_sub_efforts')
          .select('document_url')
          .eq('id', rowId)
          .maybeSingle();
        if (fetchError) throw fetchError;
        const items = normalizeSubEffortDocItems(
          (row as { document_url?: unknown } | null)?.document_url,
        );
        let found = false;
        const next = items.map((it) => {
          const key = normalizeStorageKey(it.path) || String(it.url ?? '').trim();
          if (key && (key === path || id.endsWith(`:${key}`))) {
            found = true;
            return { ...it, name: trimmed };
          }
          return it;
        });
        if (!found) throw new Error('Document not found');
        const { error } = await supabase
          .from('lead_sub_efforts')
          .update({ document_url: next })
          .eq('id', rowId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('lead_case_documents')
          .update({ file_name: trimmed })
          .eq('id', id);
        if (error) throw error;

        if (path) {
          for (const row of subEffortRows ?? []) {
            const rowId = row?.id != null ? String(row.id) : '';
            if (!rowId) continue;
            const items = normalizeSubEffortDocItems(row.document_url);
            let changed = false;
            const next = items.map((it) => {
              if (normalizeStorageKey(it.path) === path) {
                changed = true;
                return { ...it, name: trimmed };
              }
              return it;
            });
            if (!changed) continue;
            const { error: seError } = await supabase
              .from('lead_sub_efforts')
              .update({ document_url: next })
              .eq('id', rowId);
            if (seError) console.warn('sync rename to sub effort:', seError.message);
          }
        }
      }

      setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, name: trimmed } : d)));
      onAttached?.();
    },
    [onAttached, subEffortRows],
  );

  const startInlineRename = (doc: CaseCategoryDocument) => {
    setRenamingDocId(doc.id);
    setRenameValue(doc.name);
  };

  const cancelInlineRename = () => {
    setRenamingDocId(null);
    setRenameValue('');
    setRenameSaving(false);
  };

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
      console.error('renameCategoryDoc:', e);
      toast.error(e instanceof Error ? e.message : 'Failed to rename');
      setRenameSaving(false);
    }
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const setGroupSelection = (groupDocs: CaseCategoryDocument[], select: boolean) => {
    const attachableIds = groupDocs
      .filter((d) => Boolean(d.storagePath?.trim()))
      .map((d) => d.id);
    if (attachableIds.length === 0) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (select) {
        for (const id of attachableIds) next.add(id);
      } else {
        for (const id of attachableIds) next.delete(id);
      }
      return next;
    });
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
      setDocs((prev) => prev.filter((d) => d.id !== doc.id && d.storagePath !== doc.storagePath));
      setSelectedIds((prev) => {
        if (!prev.has(doc.id)) return prev;
        const next = new Set(prev);
        next.delete(doc.id);
        return next;
      });
      toast.success('Deleted');
      onAttached?.();
    } catch (e: unknown) {
      console.error('deleteCategoryDoc:', e);
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
      console.error('assignDocumentType:', e);
      toast.error(e instanceof Error ? e.message : 'Failed to update document type');
    } finally {
      setSavingTypeDocId(null);
    }
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

  const attachSelectedTo = async (option: SubEffortAttachOption) => {
    if (isAttaching || isRemoving) return;
    const picked = selectedDocs.filter((d) => d.storagePath?.trim());
    if (picked.length === 0) {
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
      console.error('attachSequenceOfEventsDocs:', e);
      toast.error(e instanceof Error ? e.message : 'Failed to attach');
    } finally {
      setIsAttaching(false);
    }
  };

  const removeFromSubEffort = async (ref: SubEffortAttachmentRef) => {
    if (isAttaching || isRemoving) return;
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
      console.error('removeSequenceOfEventsDocs:', e);
      toast.error(e instanceof Error ? e.message : 'Failed to remove');
    } finally {
      setIsRemoving(false);
    }
  };

  const busy = isAttaching || isRemoving;
  const canOpenAttachMenu = selectedIds.size > 0 && !busy && attachOptions.length > 0;
  const canOpenRemoveMenu = selectedIds.size > 0 && !busy && removeOptions.length > 0;
  const attachMenuAlign = useEdgeAwareMenuAlign(attachMenuOpen, attachMenuRef, SUB_EFFORT_MENU_WIDTH);
  const removeMenuAlign = useEdgeAwareMenuAlign(removeMenuOpen, removeMenuRef, SUB_EFFORT_MENU_WIDTH);

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
                  {modalTitle}
                </div>
                <div className="mt-1 text-xs leading-snug text-base-content/50 whitespace-normal">
                  {loading
                    ? 'Loading…'
                    : sortedDocs.length
                      ? `${sortedDocs.length} document${sortedDocs.length === 1 ? '' : 's'}${
                          docs.length !== sortedDocs.length ? ` of ${docs.length}` : ''
                        }`
                      : docs.length
                        ? 'No documents match filters'
                        : 'No documents yet'}
                  <span className="hidden sm:inline">
                    {' '}
                    · Select files to attach or remove from a sub effort
                  </span>
                </div>
                <div className="mt-0.5 text-xs leading-snug text-base-content/45 sm:hidden">
                  Select files to attach or remove from a sub effort
                </div>
              </div>
              <button
                type="button"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-gray-600 shadow-sm transition-colors hover:bg-gray-50"
                onClick={onClose}
                aria-label="Close"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
          </div>

          <CaseDocumentsModalFilterBar
            filters={filters}
            onChange={setFilters}
            attachOptions={attachOptions}
            documentTypes={documentTypes}
            showSubEffortFilter
            showDocumentTypeFilter
            trailingActions={
              sortedDocs.length > 0 ? (
                <>
                  <div className="relative" ref={attachMenuRef}>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm h-8 min-h-8 gap-1.5 rounded-full px-3.5"
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
                        className={`absolute z-50 mt-1.5 max-h-72 w-96 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-base-200 bg-white py-1 shadow-lg ${
                          attachMenuAlign === 'right' ? 'right-0' : 'left-0'
                        }`}
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
                  <div className="relative" ref={removeMenuRef}>
                    <button
                      type="button"
                      className="btn btn-sm h-8 min-h-8 gap-1.5 rounded-full border-0 bg-white px-3.5 font-medium text-red-600 shadow-sm hover:bg-red-50"
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
                        className={`absolute z-50 mt-1.5 max-h-72 w-96 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-base-200 bg-white py-1 shadow-lg ${
                          removeMenuAlign === 'right' ? 'right-0' : 'left-0'
                        }`}
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
                            <span className="min-w-0 truncate">{opt.name}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </>
              ) : null
            }
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
            ) : sortedDocs.length === 0 ? (
              <div className="mx-auto mt-16 max-w-md rounded-2xl border border-dashed border-gray-200 bg-white/70 px-6 py-10 text-center">
                <DocumentIcon className="mx-auto mb-3 h-10 w-10 text-base-content/30" />
                <p className="text-sm font-medium text-base-content/70">
                  {docs.length ? 'No documents match your filters' : emptyLabel}
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {displayedDocGroups.map((group) => (
                  <section key={group.key} className="space-y-2.5">
                    <div className="flex items-center gap-2.5 px-0.5">
                      <h3
                        className={`min-w-0 truncate text-base font-semibold tracking-tight sm:text-lg ${
                          group.key === UNATTACHED_GROUP_KEY
                            ? 'text-base-content/55'
                            : 'text-base-content/90'
                        }`}
                        title={group.title}
                      >
                        {group.title}
                      </h3>
                      <span className="badge badge-md h-7 min-h-7 shrink-0 border-0 bg-gray-200 px-2.5 text-sm font-semibold tabular-nums text-gray-700">
                        {group.docs.length}
                      </span>
                    </div>

                    <div className="min-w-0 overflow-x-auto">
                      <div className="min-w-[1080px]">
                        <table className="mb-2 w-full table-fixed border-collapse">
                          <colgroup>
                            <col className="w-12" />
                            <col className="w-[24%]" />
                            <col className="w-[14%]" />
                            <col className="w-[24%]" />
                            <col />
                            <col className="w-36" />
                            <col className="w-12" />
                          </colgroup>
                          <thead>
                            <tr className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                              <th className="bg-transparent px-3 py-2 text-center font-semibold align-middle">
                                {(() => {
                                  const attachableInGroup = group.docs.filter((d) =>
                                    Boolean(d.storagePath?.trim()),
                                  );
                                  const selectedInGroup = attachableInGroup.filter((d) =>
                                    selectedIds.has(d.id),
                                  );
                                  const allSelected =
                                    attachableInGroup.length > 0 &&
                                    selectedInGroup.length === attachableInGroup.length;
                                  const someSelected =
                                    selectedInGroup.length > 0 && !allSelected;
                                  return (
                                    <TableSelectAllHeader
                                      checked={allSelected}
                                      indeterminate={someSelected}
                                      disabled={attachableInGroup.length === 0 || busy}
                                      onChange={(next) => setGroupSelection(group.docs, next)}
                                    />
                                  );
                                })()}
                              </th>
                              <th className="bg-transparent px-3 py-2 text-left font-semibold">
                                Document name
                              </th>
                              <th className="bg-transparent px-3 py-2 text-center font-semibold">
                                Document type
                              </th>
                              <th className="bg-transparent px-3 py-2 text-center font-semibold">
                                Attached to
                              </th>
                              <th className="bg-transparent px-3 py-2 text-center font-semibold">
                                Uploaded by
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
                              <col className="w-[24%]" />
                              <col className="w-[14%]" />
                              <col className="w-[24%]" />
                              <col />
                              <col className="w-36" />
                              <col className="w-12" />
                            </colgroup>
                            <tbody>
                              {group.docs.map((doc) => {
                                const pathKey = normalizeStorageKey(doc.storagePath);
                                const attachedTo = pathKey
                                  ? orderedAttachments(
                                      attachmentsByPath.get(pathKey) ?? [],
                                      attachOptions,
                                    )
                                  : [];
                                const canAttachDoc = Boolean(doc.storagePath?.trim());
                                const checked = selectedIds.has(doc.id);
                                const isRenaming = renamingDocId === doc.id;
                                const viewerIdx = viewerIndexByDocId.get(doc.id) ?? 0;
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
                                          className="inline-flex min-w-0 max-w-full items-center gap-2 text-left hover:opacity-80"
                                          onClick={() => setViewerIndex(viewerIdx)}
                                        >
                                          <DocPreviewThumb doc={doc} />
                                          <span className="min-w-0 truncate text-sm font-semibold text-base-content">
                                            {doc.name}
                                          </span>
                                        </button>
                                      )}
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
                                    <td className="px-3 py-3 text-center align-middle">
                                      {attachedTo.length > 0 ? (
                                        <div className="flex min-w-0 flex-wrap items-center justify-center gap-1.5">
                                          {attachedTo.map((a) => (
                                            <SubEffortAttachBadge
                                              key={a.id}
                                              name={a.name}
                                              highlight={
                                                String(a.id) === String(targetSubEffortId ?? '')
                                              }
                                            />
                                          ))}
                                        </div>
                                      ) : (
                                        <span className="text-sm text-gray-400">—</span>
                                      )}
                                    </td>
                                    <td className="px-3 py-3 text-center align-middle text-sm">
                                      <DocumentUploaderCell
                                        name={doc.uploadedByName}
                                        photoUrl={doc.uploadedByPhotoUrl}
                                        isClientPortalUpload={doc.isClientPortalUpload}
                                      />
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
                  </section>
                ))}
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
        onRename={async (item, newName) => {
          await renameDocument(item, newName);
        }}
        onAttached={(paths, meta) => {
          if (meta) markPendingAttached(paths, meta.id, meta.name);
          onAttached?.();
        }}
        onDetached={(paths, meta) => {
          if (meta) clearPendingAttached(paths, meta.id);
          onAttached?.();
        }}
      />
    </>
  );
}

export default SequenceOfEventsDocumentsModal;
