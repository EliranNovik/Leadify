import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowDownTrayIcon,
  ArrowsPointingInIcon,
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  ChatBubbleLeftRightIcon,
  CheckCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  CursorArrowRaysIcon,
  MinusIcon,
  PaperAirplaneIcon,
  PaperClipIcon,
  PencilSquareIcon,
  PlusIcon,
  RectangleGroupIcon,
  ShareIcon,
  TrashIcon,
  XCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import { useMsal } from '@azure/msal-react';
import { supabase } from '../lib/supabase';
import { officeEditRequest } from '../msalConfig';
import { getAccessTokenWithFallback, isPopupUnreliable } from '../lib/graph';
import {
  blobsAreIdentical,
  downloadOfficeEditResult,
  endOfficeEditSession,
  fetchOfficeEditState,
  isOfficeEditableFile,
  OFFICE_EDIT_FOLDER,
  startOfficeEditSession,
  type OfficeEditSession,
} from '../lib/officeOnlineEdit';
import {
  fetchStoredObjectBytes,
  fetchStoredObjectSize,
  syncStoredDocumentSize,
} from '../lib/documentStoredSize';
import { fetchStageActorInfo } from '../lib/leadStageManager';
import { resolveUploaderDisplayByKey } from '../lib/uploaderDisplay';
import {
  attachStoragePathsToSubEffort,
  buildSubEffortAttachmentsByPath,
  listSubEffortAttachOptions,
  normalizeStorageKey,
  removeStoragePathsFromSubEffort,
  type SubEffortAttachOption,
  type SubEffortAttachmentRef,
} from '../lib/subEffortDocumentAttach';
import { SubEffortAttachBadge } from './caseDocumentsModalUi';
import { DocumentFileGlyph } from '../lib/documentFileGlyphs';
import DocumentSidebarThumb from './DocumentSidebarThumb';
import {
  DocumentAnnotatableView,
  parseRegionHighlight,
  type HighlightMarker,
  type RegionHighlight,
} from './DocumentAnnotatableView';

export type DocumentViewerItem = {
  id: string;
  name: string;
  /** Ready-to-display URL (signed or public), or a storage path when `bucketName` is set. */
  url: string;
  fileType?: string;
  lastModified?: string;
  /** Storage object path — enables the shared employee comment thread. */
  storagePath?: string | null;
  storageBucket?: string | null;
};

type DocumentFileComment = {
  id: string;
  storage_path: string;
  body: string;
  created_by: string;
  created_by_employee_id: number | null;
  created_at: string;
  highlight?: RegionHighlight | null;
  photoUrl?: string | null;
};

interface DocumentViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Legacy single-document API (HR / sick days / salaries). */
  documentUrl?: string;
  documentName?: string;
  employeeName?: string;
  uploadedAt?: string;
  sickDaysReason?: string;
  bucketName?: string;
  /** Multi-document gallery (case documents, etc.). */
  documents?: DocumentViewerItem[];
  initialIndex?: number;
  /** When provided, shows edit-name in the header. */
  onRename?: (doc: DocumentViewerItem, newName: string) => Promise<void> | void;
  /** Enable attach-to-sub-effort from the files side panel. */
  subEffortRows?: Array<{ id?: unknown; document_url?: unknown; sub_efforts?: unknown }> | null;
  targetSubEffortId?: string | number | null;
  targetSubEffortName?: string | null;
  targetDocumentUrl?: unknown;
  activeFolderId?: string | null;
  /** Called after a successful attach with storage paths that were added. */
  onAttached?: (attachedPaths: string[], target?: { id: string; name: string }) => void;
  /** Called after removing selected files from a sub effort. */
  onDetached?: (detachedPaths: string[], target?: { id: string; name: string }) => void;
  /**
   * Word / Excel editing in place. Needs the item's `storagePath` and `storageBucket` so the
   * edited file can go back exactly where it came from; pass false to keep a list read-only.
   */
  allowOfficeEditing?: boolean;
  /** Go straight into the editor on opening, for a document that was just created to be filled in. */
  autoStartOfficeEdit?: boolean;
  /** After a save, so the caller's list can show the new size and refresh previews. */
  onOfficeSaved?: (doc: DocumentViewerItem, info: { size: number }) => void | Promise<void>;
}

function isDirectPreviewUrl(url: string): boolean {
  const u = String(url || '');
  if (/^(https?:|blob:|data:)/i.test(u)) return true;
  // Vite-dev relative backend routes, e.g. /api/whatsapp/media/:id
  if (u.startsWith('/api/')) return true;
  return false;
}

function isFailedPreviewUrl(url: string): boolean {
  const u = String(url || '').trim().toLowerCase();
  return u === 'failed' || u === '__failed__';
}

function inferFileType(name: string, fileType?: string): string {
  const t = (fileType || '').trim();
  if (t) return t;
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (ext === 'pdf') return 'application/pdf';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return `image/${ext === 'jpg' ? 'jpeg' : ext}`;
  if (ext === 'doc') return 'application/msword';
  if (ext === 'docx') {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (ext === 'xls') return 'application/vnd.ms-excel';
  if (ext === 'xlsx') {
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
  if (ext === 'ppt') return 'application/vnd.ms-powerpoint';
  if (ext === 'pptx') {
    return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  }
  return 'application/octet-stream';
}

/** Word / Excel / PowerPoint — preview via Microsoft Office Online embed. */
function isOfficeDocument(name: string, fileType?: string, url?: string): boolean {
  const mime = (fileType || '').toLowerCase();
  const haystack = `${name} ${url || ''}`.toLowerCase();
  if (
    mime.includes('wordprocessingml') ||
    mime.includes('msword') ||
    mime.includes('spreadsheetml') ||
    mime.includes('ms-excel') ||
    mime.includes('presentationml') ||
    mime.includes('ms-powerpoint') ||
    mime.includes('officedocument')
  ) {
    return true;
  }
  return /\.(docx?|xlsx?|pptx?|docm|xlsm|pptm)(\?|#|$)/i.test(haystack);
}

/**
 * Microsoft Office Online can fetch the file if the URL is publicly reachable HTTPS
 * (signed Supabase URLs qualify for the signature lifetime).
 */
function buildOfficeOnlineEmbedUrl(fileUrl: string): string | null {
  try {
    const parsed = new URL(fileUrl);
    if (parsed.protocol !== 'https:') return null;
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') return null;
    return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(fileUrl)}`;
  } catch {
    return null;
  }
}

function formatUploadedAt(dateString?: string): string {
  if (!dateString) return '';
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return dateString;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dd}.${mm}.${yy}, ${hh}:${min}`;
}

function formatCommentTime(dateString?: string): string {
  if (!dateString) return '';
  try {
    return new Date(dateString).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(dateString);
  }
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ''}${parts[parts.length - 1][0] ?? ''}`.toUpperCase();
}

function formatDateTimeVerbose(dateString?: string): string {
  if (!dateString) return '';
  return new Date(dateString).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** The object key inside `bucketName`, whichever shape of URL or path a caller handed us. */
function extractStoragePath(documentUrl: string, bucketName: string): string {
  if (documentUrl.includes('/storage/v1/object/')) {
    const urlParts = documentUrl.split('/storage/v1/object/');
    if (urlParts.length > 1) {
      const pathParts = urlParts[1].split('/');
      if (pathParts.length > 1) return pathParts.slice(2).join('/');
    }
    return documentUrl;
  }

  if (documentUrl.startsWith('http://') || documentUrl.startsWith('https://')) {
    try {
      const url = new URL(documentUrl);
      let pathname = url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname;
      if (pathname.startsWith(bucketName + '/')) {
        pathname = pathname.substring(bucketName.length + 1);
      }
      return pathname;
    } catch {
      return documentUrl;
    }
  }

  return documentUrl;
}

async function resolveSignedUrl(
  documentUrl: string,
  bucketName: string,
): Promise<string | null> {
  try {
    const filePath = extractStoragePath(documentUrl, bucketName);

    const { data, error } = await supabase.storage.from(bucketName).createSignedUrl(filePath, 3600);
    if (error) {
      console.error('Error generating signed URL:', error);
      return null;
    }
    return data?.signedUrl ?? null;
  } catch (error) {
    console.error('Error generating signed URL:', error);
    return null;
  }
}

/** A brand new link to a known bucket and path, so nothing can serve what the file used to be. */
async function createFreshSignedUrl(bucket: string, path: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
    if (error) {
      console.error('Error generating signed URL:', error);
      return null;
    }
    return data?.signedUrl ?? null;
  } catch (error) {
    console.error('Error generating signed URL:', error);
    return null;
  }
}

const DocumentViewerModal: React.FC<DocumentViewerModalProps> = ({
  isOpen,
  onClose,
  documentUrl = '',
  documentName = '',
  employeeName,
  uploadedAt,
  sickDaysReason,
  bucketName = 'employee-unavailability-documents',
  documents: documentsProp,
  initialIndex = 0,
  onRename,
  subEffortRows = null,
  targetSubEffortId = null,
  targetSubEffortName = null,
  targetDocumentUrl = null,
  activeFolderId = null,
  onAttached,
  onDetached,
  allowOfficeEditing = true,
  autoStartOfficeEdit = false,
  onOfficeSaved,
}) => {
  const { instance, accounts } = useMsal();
  const galleryItems = useMemo<DocumentViewerItem[]>(() => {
    if (documentsProp && documentsProp.length > 0) return documentsProp;
    if (documentUrl || documentName) {
      return [
        {
          id: 'single',
          name: documentName || 'Document',
          url: documentUrl,
          lastModified: uploadedAt,
        },
      ];
    }
    return [];
  }, [documentsProp, documentUrl, documentName, uploadedAt]);

  const isGalleryMode = !!(documentsProp && documentsProp.length > 0);
  /** Attach controls when opened from Sequence of Events / sub-effort context. */
  const showAttachUi =
    isGalleryMode && (subEffortRows != null || targetSubEffortId != null || typeof onAttached === 'function');

  const [previewIndex, setPreviewIndex] = useState(0);
  const previewIndexRef = useRef(0);
  previewIndexRef.current = previewIndex;
  const selectedDocIdRef = useRef<string | null>(null);
  const wasOpenRef = useRef(false);
  const [imageError, setImageError] = useState(false);
  const [pdfError, setPdfError] = useState(false);
  const [officeError, setOfficeError] = useState(false);
  /** 1 = fit to viewer; >1 zooms in. */
  const [imageZoom, setImageZoom] = useState(1);
  /** Clockwise image rotation in degrees. */
  const [imageRotation, setImageRotation] = useState(0);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [signedDocId, setSignedDocId] = useState<string | null>(null);
  /** Bumped after a save so the preview is signed again and shows the edited file. */
  const [signNonce, setSignNonce] = useState(0);
  const [editSession, setEditSession] = useState<(OfficeEditSession & { docId: string }) | null>(
    null,
  );
  const [editStarting, setEditStarting] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  /** Read by the retry loop, which must not start a second save over the top of the first. */
  const editSavingRef = useRef(false);
  editSavingRef.current = editSaving;
  /** True once OneDrive reports the editor has saved something into the staging copy. */
  const [editChanged, setEditChanged] = useState(false);
  /** The editor's tab, so "Back to the editor" reuses it instead of opening another. */
  const editTabRef = useRef<Window | null>(null);
  /** Whether the editor tab ever opened, which decides what the panel asks for next. */
  const [editorOpened, setEditorOpened] = useState(false);
  /** Save was asked for, but the editor has not written its changes to OneDrive yet. */
  const [awaitingFlush, setAwaitingFlush] = useState(false);
  /** Escape and the close button both go through the latest close handler, editor open or not. */
  const requestCloseRef = useRef<() => void>(onClose);
  const [loadingUrl, setLoadingUrl] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(true);
  const [comments, setComments] = useState<DocumentFileComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentDraft, setCommentDraft] = useState('');
  const [commentSaving, setCommentSaving] = useState(false);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);
  const [actorName, setActorName] = useState<string | null>(null);
  const [actorPhotoUrl, setActorPhotoUrl] = useState<string | null>(null);
  const [highlightMode, setHighlightMode] = useState(false);
  const [draftHighlight, setDraftHighlight] = useState<RegionHighlight | null>(null);
  const [focusedCommentId, setFocusedCommentId] = useState<string | null>(null);
  const [selectedAttachIds, setSelectedAttachIds] = useState<Set<string>>(() => new Set());
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
  const commentsEndRef = useRef<HTMLDivElement | null>(null);
  const commentsListRef = useRef<HTMLDivElement | null>(null);
  const imageZoomPaneRef = useRef<HTMLDivElement | null>(null);

  const itemsRef = useRef(galleryItems);
  itemsRef.current = galleryItems;

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
    if (!isOpen) {
      setSelectedAttachIds(new Set());
      setPendingAttachments(new Map());
      setSuppressedAttachments(new Map());
      setAttachMenuOpen(false);
      setRemoveMenuOpen(false);
    }
  }, [isOpen]);

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

  const toggleAttachSelected = useCallback((id: string) => {
    setSelectedAttachIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectedAttachDocs = useMemo(
    () => galleryItems.filter((d) => selectedAttachIds.has(d.id)),
    [galleryItems, selectedAttachIds],
  );

  const removeOptions = useMemo(() => {
    const byId = new Map<string, SubEffortAttachmentRef>();
    for (const doc of selectedAttachDocs) {
      const pathKey = normalizeStorageKey(doc.storagePath);
      if (!pathKey) continue;
      for (const ref of attachmentsByPath.get(pathKey) ?? []) {
        byId.set(ref.id, ref);
      }
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [selectedAttachDocs, attachmentsByPath]);

  const attachBusy = isAttaching || isRemoving;

  const attachSelectedTo = useCallback(
    async (option: SubEffortAttachOption) => {
      if (isAttaching || isRemoving) return;
      const picked = galleryItems.filter(
        (d) => selectedAttachIds.has(d.id) && d.storagePath?.trim(),
      );
      if (picked.length === 0) {
        toast.error('Select at least one file in the Files panel to attach.');
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
            bucket: d.storageBucket?.trim() || undefined,
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
        const paths = picked.map((d) => d.storagePath!.trim());
        setPendingAttachments((prev) => {
          const next = new Map(prev);
          for (const raw of paths) {
            const path = normalizeStorageKey(raw);
            if (!path) continue;
            const list = [...(next.get(path) ?? [])];
            if (!list.some((x) => x.id === option.id)) {
              list.push({ id: option.id, name: option.name });
            }
            next.set(path, list);
          }
          return next;
        });
        setSuppressedAttachments((prev) => {
          if (prev.size === 0) return prev;
          const next = new Map(prev);
          for (const raw of paths) {
            const path = normalizeStorageKey(raw);
            if (!path) continue;
            const set = next.get(path);
            if (!set?.has(option.id)) continue;
            const updated = new Set(set);
            updated.delete(option.id);
            if (updated.size === 0) next.delete(path);
            else next.set(path, updated);
          }
          return next;
        });
        setSelectedAttachIds(new Set());
        onAttached?.(paths, { id: option.id, name: option.name });
      } catch (e: unknown) {
        console.error('attach from document viewer:', e);
        toast.error(e instanceof Error ? e.message : 'Failed to attach');
      } finally {
        setIsAttaching(false);
      }
    },
    [activeFolderId, galleryItems, isAttaching, isRemoving, onAttached, selectedAttachIds],
  );

  const removeSelectedFrom = useCallback(
    async (ref: SubEffortAttachmentRef) => {
      if (isAttaching || isRemoving) return;
      const option = attachOptions.find((o) => o.id === ref.id);
      if (!option) {
        toast.error('Sub effort not found.');
        return;
      }
      const paths = selectedAttachDocs
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
        setPendingAttachments((prev) => {
          const next = new Map(prev);
          for (const path of paths) {
            const key = normalizeStorageKey(path);
            if (!key) continue;
            const list = (next.get(key) ?? []).filter((x) => x.id !== option.id);
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
            set.add(option.id);
            next.set(key, set);
          }
          return next;
        });
        setSelectedAttachIds(new Set());
        onDetached?.(paths, { id: option.id, name: option.name });
      } catch (e: unknown) {
        console.error('remove from document viewer:', e);
        toast.error(e instanceof Error ? e.message : 'Failed to remove');
      } finally {
        setIsRemoving(false);
      }
    },
    [
      attachOptions,
      attachmentsByPath,
      isAttaching,
      isRemoving,
      onDetached,
      selectedAttachDocs,
    ],
  );

  useEffect(() => {
    if (!isOpen) {
      wasOpenRef.current = false;
      selectedDocIdRef.current = null;
      return;
    }

    const justOpened = !wasOpenRef.current;
    wasOpenRef.current = true;

    if (galleryItems.length === 0) {
      setPreviewIndex(0);
      return;
    }

    // Only apply initialIndex when the modal first opens — not when the parent
    // remaps `documents` (that was resetting selection to the first/opened doc).
    if (justOpened) {
      const start = Math.min(Math.max(0, initialIndex), galleryItems.length - 1);
      setPreviewIndex(start);
      selectedDocIdRef.current = galleryItems[start]?.id ?? null;
      return;
    }

    const wantId = selectedDocIdRef.current;
    if (wantId) {
      const idx = galleryItems.findIndex((d) => d.id === wantId);
      if (idx >= 0) {
        if (idx !== previewIndexRef.current) setPreviewIndex(idx);
        return;
      }
    }

    if (previewIndexRef.current >= galleryItems.length) {
      setPreviewIndex(galleryItems.length - 1);
    }
  }, [isOpen, galleryItems, initialIndex]);

  useEffect(() => {
    selectedDocIdRef.current = galleryItems[previewIndex]?.id ?? null;
  }, [galleryItems, previewIndex]);

  const activeDoc = galleryItems[previewIndex] ?? null;
  const activeName = activeDoc?.name || documentName || 'Document';
  const activeUrl = activeDoc?.url || documentUrl;
  const activeFileType = inferFileType(activeName, activeDoc?.fileType);
  const activeUploadedAt = activeDoc?.lastModified || uploadedAt;
  const activeStoragePath = (activeDoc?.storagePath || '').trim() || null;
  const canComment = !!activeStoragePath;

  useEffect(() => {
    setRenaming(false);
    setRenameValue(activeName);
    setImageError(false);
    setPdfError(false);
    setOfficeError(false);
    setImageZoom(1);
    setImageRotation(0);
    setCommentDraft('');
    setDraftHighlight(null);
    setHighlightMode(false);
    setFocusedCommentId(null);
    setSignedUrl(null);
    setSignedDocId(null);
    setLoadingUrl(true);
  }, [activeDoc?.id, activeName]);

  useEffect(() => {
    if (!isOpen) {
      setCommentsOpen(false);
      setComments([]);
      setCommentDraft('');
      setActorName(null);
      setActorPhotoUrl(null);
      setDraftHighlight(null);
      setHighlightMode(false);
      setFocusedCommentId(null);
    } else {
      setRailOpen(true);
    }
  }, [isOpen]);

  const enrichCommentsWithPhotos = useCallback(async (rows: DocumentFileComment[]) => {
    if (!rows.length) return rows;

    const byId = new Map<number, string>();
    const employeeIds = [
      ...new Set(
        rows
          .map((r) => r.created_by_employee_id)
          .filter((id): id is number => typeof id === 'number' && Number.isFinite(id)),
      ),
    ];
    if (employeeIds.length > 0) {
      const { data: emps, error } = await supabase
        .from('tenants_employee')
        .select('id, photo_url, photo')
        .in('id', employeeIds);
      if (error) console.warn('comment employee photos:', error.message);
      for (const emp of (emps || []) as {
        id: number;
        photo_url?: string | null;
        photo?: string | null;
      }[]) {
        const url = (emp.photo_url || emp.photo || '').trim();
        if (url) byId.set(Number(emp.id), url);
      }
    }

    const needNameKeys = [
      ...new Set(
        rows
          .filter((r) => {
            const id = r.created_by_employee_id;
            if (typeof id === 'number' && byId.has(id)) return false;
            return !!(r.created_by || '').trim();
          })
          .map((r) => r.created_by.trim()),
      ),
    ];
    const byName =
      needNameKeys.length > 0 ? await resolveUploaderDisplayByKey(needNameKeys) : new Map();

    return rows.map((r) => {
      const fromId =
        typeof r.created_by_employee_id === 'number'
          ? byId.get(r.created_by_employee_id) ?? null
          : null;
      const fromName = byName.get(r.created_by.trim())?.photoUrl ?? null;
      return { ...r, photoUrl: fromId || fromName || null };
    });
  }, []);

  const loadComments = useCallback(
    async (path: string) => {
      setCommentsLoading(true);
      try {
        const { data, error } = await supabase
          .from('document_file_comments')
          .select('id, storage_path, body, created_by, created_by_employee_id, created_at, highlight')
          .eq('storage_path', path)
          .order('created_at', { ascending: true });
        if (error) throw error;
        const rows = ((data as any[]) ?? []).map((row) => ({
          ...(row as DocumentFileComment),
          highlight: parseRegionHighlight(row.highlight),
        }));
        setComments(await enrichCommentsWithPhotos(rows));
      } catch (e) {
        console.error('Error loading document comments:', e);
        setComments([]);
        toast.error('Failed to load comments');
      } finally {
        setCommentsLoading(false);
      }
    },
    [enrichCommentsWithPhotos],
  );

  useEffect(() => {
    if (!isOpen || !activeStoragePath) {
      setComments([]);
      return;
    }
    void loadComments(activeStoragePath);
  }, [isOpen, activeStoragePath, loadComments]);

  useEffect(() => {
    if (!commentsOpen) return;
    commentsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [comments.length, commentsOpen]);

  useEffect(() => {
    if (!isOpen || actorName) return;
    const hasHighlights = comments.some((c) => !!c.highlight);
    if (!commentsOpen && !hasHighlights) return;
    void (async () => {
      try {
        const actor = await fetchStageActorInfo();
        setActorName(actor.fullName);
        const resolved = await resolveUploaderDisplayByKey([actor.fullName]);
        setActorPhotoUrl(resolved.get(actor.fullName)?.photoUrl ?? null);
        if (actor.employeeId != null && !resolved.get(actor.fullName)?.photoUrl) {
          const { data: emp } = await supabase
            .from('tenants_employee')
            .select('photo_url, photo')
            .eq('id', actor.employeeId)
            .maybeSingle();
          const url = String((emp as any)?.photo_url || (emp as any)?.photo || '').trim();
          if (url) setActorPhotoUrl(url);
        }
      } catch {
        /* ignore */
      }
    })();
  }, [isOpen, commentsOpen, actorName, comments]);

  const postComment = async () => {
    if (!activeStoragePath || commentSaving) return;
    const body = commentDraft.trim();
    if (!body) {
      toast.error('Write a comment first');
      return;
    }
    setCommentSaving(true);
    try {
      const actor = await fetchStageActorInfo();
      setActorName(actor.fullName);
      let photoUrl = actorPhotoUrl;
      if (!photoUrl) {
        if (actor.employeeId != null) {
          const { data: emp } = await supabase
            .from('tenants_employee')
            .select('photo_url, photo')
            .eq('id', actor.employeeId)
            .maybeSingle();
          photoUrl = String((emp as any)?.photo_url || (emp as any)?.photo || '').trim() || null;
        }
        if (!photoUrl) {
          const resolved = await resolveUploaderDisplayByKey([actor.fullName]);
          photoUrl = resolved.get(actor.fullName)?.photoUrl ?? null;
        }
        setActorPhotoUrl(photoUrl);
      }
      const insertPayload: Record<string, unknown> = {
        storage_path: activeStoragePath,
        body,
        created_by: actor.fullName,
        created_by_employee_id: actor.employeeId,
      };
      if (draftHighlight) insertPayload.highlight = draftHighlight;

      const { data, error } = await supabase
        .from('document_file_comments')
        .insert(insertPayload)
        .select('id, storage_path, body, created_by, created_by_employee_id, created_at, highlight')
        .single();
      if (error) throw error;
      const saved: DocumentFileComment = {
        ...(data as DocumentFileComment),
        highlight: parseRegionHighlight((data as any)?.highlight) || draftHighlight,
        photoUrl,
      };
      setComments((prev) => [...prev, saved]);
      setCommentDraft('');
      setDraftHighlight(null);
      setHighlightMode(false);
      setFocusedCommentId(saved.id);
      toast.success(saved.highlight ? 'Section comment added' : 'Comment added');
    } catch (e: any) {
      console.error('postComment:', e);
      toast.error(e?.message || 'Failed to add comment');
    } finally {
      setCommentSaving(false);
    }
  };

  const deleteComment = async (comment: DocumentFileComment) => {
    if (deletingCommentId) return;
    const ok = window.confirm(
      comment.highlight ? 'Delete this highlight and its comment?' : 'Delete this comment?',
    );
    if (!ok) return;
    setDeletingCommentId(comment.id);
    try {
      const { error } = await supabase.from('document_file_comments').delete().eq('id', comment.id);
      if (error) throw error;
      setComments((prev) => prev.filter((c) => c.id !== comment.id));
      setFocusedCommentId((prev) => (prev === comment.id ? null : prev));
      toast.success(comment.highlight ? 'Highlight deleted' : 'Comment deleted');
    } catch (e: any) {
      console.error('deleteComment:', e);
      toast.error(e?.message || 'Failed to delete comment');
    } finally {
      setDeletingCommentId(null);
    }
  };

  useEffect(() => {
    if (!isOpen) {
      setSignedUrl(null);
      setSignedDocId(null);
      setLoadingUrl(false);
      return;
    }

    const docId = activeDoc?.id ?? null;

    if (!activeUrl) {
      setSignedUrl(null);
      setSignedDocId(null);
      setLoadingUrl(true);
      setImageError(false);
      setPdfError(false);
      setOfficeError(false);
      return;
    }

    if (isFailedPreviewUrl(activeUrl)) {
      setSignedUrl(null);
      setSignedDocId(null);
      setLoadingUrl(false);
      setImageError(true);
      setPdfError(true);
      setOfficeError(true);
      return;
    }

    /**
     * After a save the URL this modal was handed still points at the bytes from before it, and
     * the Office viewer caches by URL, so the file has to be signed again from its own address
     * rather than reused. Only after a save: otherwise the caller's URL is the cheaper route.
     */
    const ownBucket = (activeDoc?.storageBucket || '').trim();
    const ownPath = (activeDoc?.storagePath || '').trim();
    const signAgain = signNonce > 0 && !!ownBucket && !!ownPath;

    if (!signAgain && isDirectPreviewUrl(activeUrl)) {
      setSignedUrl(activeUrl);
      setSignedDocId(docId);
      setLoadingUrl(false);
      setImageError(false);
      setPdfError(false);
      setOfficeError(false);
      return;
    }

    let cancelled = false;
    setLoadingUrl(true);
    setImageError(false);
    setPdfError(false);
    setOfficeError(false);

    void (async () => {
      const url = signAgain
        ? await createFreshSignedUrl(ownBucket, ownPath)
        : await resolveSignedUrl(activeUrl, bucketName);
      if (cancelled) return;
      if (!url) {
        setImageError(true);
        setPdfError(true);
        setSignedUrl(null);
        setSignedDocId(null);
      } else {
        setSignedUrl(url);
        setSignedDocId(docId);
      }
      setLoadingUrl(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    isOpen,
    activeUrl,
    bucketName,
    activeDoc?.id,
    activeDoc?.storageBucket,
    activeDoc?.storagePath,
    signNonce,
  ]);

  const displayUrl =
    signedDocId === (activeDoc?.id ?? null)
      ? signedUrl
      : isDirectPreviewUrl(activeUrl)
        ? activeUrl
        : null;

  /** Hides the built-in browser PDF toolbar so only the viewer's own chrome shows. */
  const pdfEmbedUrl = displayUrl ? `${displayUrl.split('#')[0]}#toolbar=0&navpanes=0` : null;

  const isImage =
    activeFileType.includes('image/') ||
    !!activeName.match(/\.(jpg|jpeg|png|gif|webp)$/i) ||
    !!activeUrl.match(/\.(jpg|jpeg|png|gif|webp)$/i);
  const isPdf =
    activeFileType.includes('pdf') ||
    !!activeName.match(/\.pdf$/i) ||
    !!activeUrl.match(/\.pdf$/i);
  const isOffice = !isImage && !isPdf && isOfficeDocument(activeName, activeFileType, activeUrl);
  const officeEmbedUrl =
    isOffice && displayUrl && !officeError ? buildOfficeOnlineEmbedUrl(displayUrl) : null;

  // Saving writes the edited file back over the original, so both halves of its address are
  // needed. Items that do not say where they live stay read-only.
  const activeEditBucket = (activeDoc?.storageBucket || '').trim() || null;
  const activeEditPath =
    activeStoragePath ||
    (activeEditBucket && activeUrl.includes('/storage/v1/object/')
      ? extractStoragePath(activeUrl, activeEditBucket)
      : null);
  const canEditOffice =
    allowOfficeEditing &&
    isOffice &&
    !!activeEditBucket &&
    !!activeEditPath &&
    isOfficeEditableFile(activeName);
  const editingThisDoc = !!editSession && editSession.docId === (activeDoc?.id ?? null);
  const editorAppName = (() => {
    const ext = activeName.toLowerCase().split('.').pop() || '';
    if (ext === 'xlsx') return 'Excel';
    if (ext === 'pptx') return 'PowerPoint';
    return 'Word';
  })();

  const goPrev = useCallback(() => {
    setPreviewIndex((i) => {
      const len = itemsRef.current.length;
      if (len === 0) return 0;
      return (i - 1 + len) % len;
    });
  }, []);

  const goNext = useCallback(() => {
    setPreviewIndex((i) => {
      const len = itemsRef.current.length;
      if (len === 0) return 0;
      return (i + 1) % len;
    });
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    // While drawing/viewing highlights, keep normal scroll inside the annotate view.
    if (highlightMode || draftHighlight) return;

    let accum = 0;
    let lockedUntil = 0;
    const THRESHOLD = 50;
    const COOLDOWN_MS = 380;

    const onWheel = (e: WheelEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // Let the Files sidebar and comment panels scroll normally.
      if (target.closest?.('aside[aria-label="Document thumbnails"]')) return;
      if (target.closest?.('[data-doc-comments-panel]')) return;
      if (target.closest?.('input, textarea, select, [contenteditable="true"]')) return;

      // Ignore horizontal-dominant gestures.
      if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;

      // Images: wheel / trackpad scroll zooms (pinch often sends ctrlKey).
      if (isImage && !imageError && displayUrl) {
        e.preventDefault();
        const direction = e.deltaY > 0 ? -1 : 1;
        const step = e.ctrlKey || e.metaKey ? 0.08 : 0.12;
        setImageZoom((z) => {
          const next = Math.round((z + direction * step) * 100) / 100;
          return Math.min(4, Math.max(0.5, next));
        });
        return;
      }

      // Other files: wheel goes to next/prev document.
      if (galleryItems.length <= 1) return;

      e.preventDefault();
      const now = Date.now();
      if (now < lockedUntil) return;

      accum += e.deltaY;
      if (Math.abs(accum) < THRESHOLD) return;

      if (accum > 0) goNext();
      else goPrev();
      accum = 0;
      lockedUntil = now + COOLDOWN_MS;
    };

    window.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => window.removeEventListener('wheel', onWheel, { capture: true } as EventListenerOptions);
  }, [
    isOpen,
    galleryItems.length,
    goNext,
    goPrev,
    highlightMode,
    draftHighlight,
    isImage,
    imageError,
    displayUrl,
  ]);

  const activeThumbId = activeDoc ? `doc-viewer-thumb-${activeDoc.id}` : null;
  useEffect(() => {
    if (!activeThumbId) return;
    requestAnimationFrame(() => {
      document.getElementById(activeThumbId)?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest',
      });
    });
  }, [activeThumbId, previewIndex]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (renaming) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setRenaming(false);
          setRenameValue(activeName);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        if (highlightMode) {
          setHighlightMode(false);
          return;
        }
        if (draftHighlight) {
          setDraftHighlight(null);
          return;
        }
        if (commentsOpen) {
          setCommentsOpen(false);
          return;
        }
        requestCloseRef.current();
        return;
      }
      if (galleryItems.length <= 1) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goPrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        goNext();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, renaming, activeName, galleryItems.length, onClose, goPrev, goNext, highlightMode, draftHighlight, commentsOpen]);

  const handleDownload = async () => {
    if (downloading) return;
    const urlToUse = displayUrl;
    if (!urlToUse) {
      toast.error('Document URL not available');
      return;
    }
    setDownloading(true);
    try {
      const response = await fetch(urlToUse);
      if (!response.ok) throw new Error('Failed to fetch document');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = activeName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading document:', error);
      toast.error('Failed to download document');
    } finally {
      setDownloading(false);
    }
  };

  /**
   * A Graph token that may write to the person's own files.
   *
   * Being signed in to the CRM says nothing about Microsoft: the mailbox connection is held by
   * the server, so the browser often has no MSAL account at all. In that case editing asks for
   * its own sign-in rather than refusing.
   */
  const acquireFilesToken = useCallback(async () => {
    const account = accounts[0] || instance.getActiveAccount();
    if (account) {
      const token = await getAccessTokenWithFallback(instance, officeEditRequest, account);
      // Null means a redirect is under way and this page is about to be replaced.
      if (!token) throw new Error('Microsoft sign-in is needed to edit this document');
      return token;
    }

    if (isPopupUnreliable()) {
      await instance.loginRedirect(officeEditRequest);
      throw new Error('Taking you to Microsoft sign-in…');
    }

    const result = await instance.loginPopup(officeEditRequest);
    if (result?.account) instance.setActiveAccount(result.account);
    if (!result?.accessToken) throw new Error('Microsoft sign-in did not complete');
    return result.accessToken;
  }, [accounts, instance]);

  /**
   * Open the real Word or Excel on the file: it is copied into the person's own OneDrive, edited
   * in its own tab, and copied back by handleSaveOfficeEdit.
   *
   * Nothing is opened before the Microsoft token is in hand: a browser allows one window per
   * click, and spending it here is what blocks the sign-in window. Opening the editor afterwards
   * may well be blocked for the same reason, which is why the panel offers a plain link too.
   */
  const handleStartOfficeEdit = async () => {
    if (editStarting || editSaving) return;
    // Say why rather than doing nothing: every one of these is invisible from the button.
    if (!activeDoc || !canEditOffice || !activeEditBucket || !activeEditPath) {
      console.warn('Office edit unavailable', {
        hasDoc: !!activeDoc,
        isOffice,
        allowOfficeEditing,
        editableName: isOfficeEditableFile(activeName),
        bucket: activeEditBucket,
        path: activeEditPath,
      });
      toast.error('This file cannot be edited here');
      return;
    }
    setEditStarting(true);
    try {
      const token = await acquireFilesToken();
      // Read storage directly rather than through the preview's URL: that one can still be
      // serving the bytes from before the last save, which would stage a stale copy to edit.
      const blob = await fetchStoredObjectBytes(activeEditBucket, activeEditPath);
      if (!blob) throw new Error('Could not read this file from storage');
      const session = await startOfficeEditSession(token, { fileName: activeName, blob });
      setEditChanged(false);
      setEditSession({ ...session, docId: activeDoc.id });
      openEditorTab(session);
    } catch (err: unknown) {
      console.error('Start Office edit:', err);
      toast.error(err instanceof Error ? err.message : 'Could not open the editor');
    } finally {
      setEditStarting(false);
    }
  };

  /** A name, so going back to the editor reuses its tab instead of opening a second one. */
  const editorTabName = editSession ? `rmq-office-edit-${editSession.itemId}` : '';

  /** Show the editor. Returns false when the browser refused to open the tab. */
  const openEditorTab = (session: OfficeEditSession) => {
    const tab = window.open(session.editUrl, `rmq-office-edit-${session.itemId}`);
    if (!tab) {
      setEditorOpened(false);
      return false;
    }
    editTabRef.current = tab;
    setEditorOpened(true);
    tab.focus();
    return true;
  };

  /**
   * Shut the editor. Closing is also what makes Office for the web write its changes back, so
   * this runs before reading them rather than only as cleanup.
   */
  const closeEditorTab = () => {
    let tab = editTabRef.current;
    // The panel's link hands back no window, but a named one can be reached again, and an empty
    // URL means it is not navigated anywhere on the way.
    if ((!tab || tab.closed) && editorOpened && editorTabName) {
      tab = window.open('', editorTabName);
    }
    editTabRef.current = null;
    setEditorOpened(false);
    if (tab && !tab.closed) tab.close();
  };

  /** Everything a finished or abandoned editing session leaves behind. */
  const clearEditSession = () => {
    closeEditorTab();
    setAwaitingFlush(false);
    setEditChanged(false);
    setEditSession(null);
  };

  /** Bring the edited file back into the CRM, over the original. */
  const handleSaveOfficeEdit = async (
    options: {
      /** Triggered by closing the viewer or changing file, not by pressing Save. */
      silent?: boolean;
      /** One of the repeated tries while waiting for the editor: stays quiet, keeps the session. */
      attempt?: boolean;
    } = {},
  ) => {
    if (!editSession || editSaving) return;
    const target = galleryItems.find((item) => item.id === editSession.docId) ?? activeDoc;
    const bucket = (target?.storageBucket || activeEditBucket || '').trim();
    const path = (target?.storagePath || activeEditPath || '').trim();
    if (!target || !bucket || !path) {
      toast.error('Could not work out where to save this file');
      return;
    }

    setEditSaving(true);
    const progress =
      options.silent || options.attempt ? null : toast.loading('Saving your changes…');
    try {
      const token = await acquireFilesToken();
      const blob = await downloadOfficeEditResult(token, editSession.itemId);
      const current = await fetchStoredObjectBytes(bucket, path);

      /**
       * Office for the web writes back when it sees fit, so the staged copy can still be the one
       * we uploaded even after someone has typed into it. Saving then would put the bytes the CRM
       * already has back on top of themselves, which is exactly what losing the changes looks
       * like, so an edit is only recognised once the two differ.
       */
      if (current && (await blobsAreIdentical(current, blob))) {
        // Nothing has arrived yet; the loop that asked for this will ask again shortly.
        if (options.attempt) return;
        if (options.silent) {
          // Either nothing was typed or the editor never wrote: indistinguishable from here, so
          // the OneDrive copy stays. Deleting it is the one move that could throw away work.
          console.warn(
            `${editSession.stagingPath} is unchanged — leaving the OneDrive copy in place`,
          );
          clearEditSession();
          toast(
            `${editorAppName} had not saved yet, so your copy is still in OneDrive under “${OFFICE_EDIT_FOLDER}”`,
          );
          return;
        }
        throw new Error(`${editorAppName} has not written your changes to OneDrive yet`);
      }

      const { error } = await supabase.storage.from(bucket).upload(path, blob, {
        upsert: true,
        contentType: blob.type || activeFileType,
        // Previews and downloads go through a CDN, which must not keep serving the old bytes.
        cacheControl: '0',
      });
      if (error) throw error;

      // Proof the overwrite landed: a refused write or a path nobody reads would otherwise look
      // exactly like a save, which is how an edit goes missing without a word.
      const stored = await fetchStoredObjectSize(bucket, path);
      console.info(
        `Saved an Office edit: ${path} was ${current?.size ?? '?'} bytes, wrote ${blob.size}, ` +
          `storage now reports ${stored ?? '?'}`,
      );
      if (stored !== null && stored !== blob.size) {
        throw new Error('Storage still holds the old file — your changes were not saved');
      }

      await syncStoredDocumentSize(bucket, path, blob.size);
      await endOfficeEditSession(token, editSession.itemId);
      clearEditSession();
      // The old preview URL still points at the old bytes, so sign it again.
      setSignNonce((n) => n + 1);
      await onOfficeSaved?.(target, { size: blob.size });
      if (progress) toast.success('Saved', { id: progress });
      else toast.success(`Saved “${target.name}”`);
    } catch (err: unknown) {
      console.error('Save Office edit:', err);
      const message = err instanceof Error ? err.message : 'Could not save your changes';
      if (progress) toast.error(message, { id: progress });
      // A failed try says nothing yet; the loop reports it if they all fail.
      else if (!options.attempt) toast.error(message);
    } finally {
      setEditSaving(false);
    }
  };

  /**
   * Pressing Save hands over to the loop below, which brings the file home as soon as the editor
   * has written it. The editor's tab is deliberately left alone: Office flushes what it is
   * holding as part of its own shutdown, and closing the tab out from under it can cut that
   * short. It is closed once the file is safely back instead.
   */
  const handleRequestOfficeSave = () => {
    if (!editSession || editSaving || awaitingFlush) return;
    setAwaitingFlush(true);
  };

  /** Throw the OneDrive copy away: whatever was typed since opening the editor goes with it. */
  const handleDiscardOfficeEdit = async () => {
    if (!editSession || editSaving) return;
    const session = editSession;
    clearEditSession();
    try {
      const token = await acquireFilesToken();
      await endOfficeEditSession(token, session.itemId);
    } catch (err) {
      console.warn('Discard Office edit:', err);
    }
  };

  /**
   * Leaving the viewer with the editor open keeps the changes: Word and Excel have already saved
   * them into the OneDrive copy, so the only thing left is to bring that copy home.
   */
  const handleRequestClose = () => {
    // One try only: the retry loop lives in this component, which is about to go away.
    if (editSession && !editSaving) void handleSaveOfficeEdit({ silent: true });
    onClose();
  };
  requestCloseRef.current = handleRequestClose;

  /**
   * Watch for the editor writing back, so the panel can say there is something to save.
   *
   * Office for the web announces nothing and writes when it sees fit, so asking OneDrive is the
   * only way to find out. Checking only when the window regains focus misses the common case of
   * coming back before the editor has got round to saving, hence the repeat while a session is
   * open. It stops as soon as something is seen, and never runs on a hidden tab.
   */
  useEffect(() => {
    if (!editSession || editChanged) return;
    let cancelled = false;
    const check = () => {
      if (document.visibilityState === 'hidden') return;
      void acquireFilesToken()
        .then((token) => fetchOfficeEditState(token, editSession.itemId))
        .then((state) => {
          if (cancelled) return;
          if (!editSession.lastModified || state.lastModified !== editSession.lastModified) {
            setEditChanged(true);
          }
        })
        .catch((err) => console.warn('Could not check the editing copy:', err));
    };

    check();
    // Closer attention while a save is waiting on it, since that is someone watching a spinner.
    const timer = window.setInterval(check, awaitingFlush ? 1500 : 5000);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [editSession, editChanged, awaitingFlush, acquireFilesToken]);

  /**
   * Bring the changes home, trying again until they show up.
   *
   * Office for the web offers nothing to wait on — no event, and a timestamp that says more about
   * the editor's mood than about whether anybody typed — so the only honest test is whether the
   * staged file differs from the one in the CRM. Each try is that test, and the first one that
   * passes saves. Excel in particular can sit on a change for a minute or more, hence the
   * patience, but it does give up rather than spin forever.
   */
  useEffect(() => {
    if (!awaitingFlush || !editSession) return;
    let tries = 0;
    const attempt = () => {
      if (editSavingRef.current) return;
      tries += 1;
      if (tries > 40) {
        setAwaitingFlush(false);
        toast.error(
          `${editorAppName} has not written your changes to OneDrive. Close its tab — that makes ` +
            'it save — then press Save again.',
          { duration: 8000 },
        );
        return;
      }
      void handleSaveOfficeEdit({ attempt: true });
    };

    attempt();
    const timer = window.setInterval(attempt, 3000);
    return () => window.clearInterval(timer);
    // The save handler is new on every render; keying off it would restart the loop each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awaitingFlush, editSession, editorAppName]);

  /**
   * A document created to be written in opens its editor by itself. Once only: after that it is
   * an ordinary file, and reopening the editor over a finished save would be a surprise.
   */
  const autoEditStartedRef = useRef(false);
  useEffect(() => {
    if (!isOpen) {
      autoEditStartedRef.current = false;
      return;
    }
    if (!autoStartOfficeEdit || autoEditStartedRef.current) return;
    if (!canEditOffice || editSession || editStarting) return;
    autoEditStartedRef.current = true;
    void handleStartOfficeEdit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, autoStartOfficeEdit, canEditOffice, editSession, editStarting]);

  // Moving to another file with the editor open saves first, for the same reason closing does.
  useEffect(() => {
    if (!editSession || editSaving) return;
    if (editSession.docId === (activeDoc?.id ?? null)) return;
    void handleSaveOfficeEdit({ silent: true });
    // handleSaveOfficeEdit reads the session it was given; re-running on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editSession, editSaving, activeDoc?.id]);

  const handleShare = async () => {
    if (sharing) return;
    const urlToUse = displayUrl;
    if (!urlToUse) {
      toast.error('Document URL not available');
      return;
    }
    setSharing(true);
    try {
      if (navigator.share) {
        try {
          await navigator.share({
            title: activeName,
            text: employeeName ? `Document from ${employeeName}` : activeName,
            url: urlToUse,
          });
          return;
        } catch (error) {
          if ((error as Error).name === 'AbortError') return;
        }
      }
      await navigator.clipboard.writeText(urlToUse);
      toast.success('Document URL copied to clipboard');
    } catch (error) {
      console.error('Error sharing document:', error);
      toast.error('Failed to share document');
    } finally {
      setSharing(false);
    }
  };

  const handleSaveRename = async () => {
    if (!onRename || !activeDoc || renameSaving) return;
    const next = renameValue.trim();
    if (!next || next === activeDoc.name) {
      setRenaming(false);
      setRenameValue(activeDoc.name);
      return;
    }
    setRenameSaving(true);
    try {
      await onRename(activeDoc, next);
      setRenaming(false);
      toast.success('Name updated');
    } catch (e: unknown) {
      console.error('Rename document:', e);
      toast.error(e instanceof Error ? e.message : 'Failed to rename');
    } finally {
      setRenameSaving(false);
    }
  };

  const canAnnotateMedia = canComment && ((isImage && !imageError) || (isPdf && !pdfError));

  const highlightMarkers = useMemo<HighlightMarker[]>(() => {
    const out: HighlightMarker[] = [];
    let label = 0;
    for (const c of comments) {
      if (!c.highlight) continue;
      label += 1;
      const mine =
        !!actorName &&
        c.created_by.trim().toLowerCase() === actorName.trim().toLowerCase();
      out.push({
        id: c.id,
        highlight: c.highlight,
        label,
        createdBy: c.created_by,
        canDelete: mine,
      });
    }
    return out;
  }, [comments, actorName]);

  const highlightLabelById = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of highlightMarkers) m.set(h.id, h.label);
    return m;
  }, [highlightMarkers]);

  const focusComment = useCallback(
    (id: string) => {
      setFocusedCommentId(id);
      setCommentsOpen(true);
      setHighlightMode(false);
      requestAnimationFrame(() => {
        document.getElementById(`doc-comment-${id}`)?.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
        });
        document.getElementById(`doc-highlight-${id}`)?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      });
    },
    [],
  );

  const deleteHighlightById = (id: string) => {
    const comment = comments.find((c) => c.id === id);
    if (!comment) return;
    void deleteComment(comment);
  };

  const handleDraftHighlight = useCallback((h: RegionHighlight | null) => {
    setDraftHighlight(h);
    if (h) {
      setCommentsOpen(true);
      setHighlightMode(false);
    }
  }, []);

  if (!isOpen || !activeDoc) return null;

  const showRail = isGalleryMode;
  const canRename = typeof onRename === 'function';
  const uploadedLabel = activeUploadedAt
    ? isGalleryMode
      ? formatUploadedAt(activeUploadedAt)
      : formatDateTimeVerbose(activeUploadedAt)
    : '';

  const modal = (
    <div
      className="doc-viewer-glass fixed inset-0 z-[11000] flex flex-col overflow-hidden bg-[rgba(11,12,15,0.93)] text-white [&_.btn-ghost:hover]:bg-white/15"
      role="dialog"
      aria-modal="true"
      aria-label="Document viewer"
    >
      <header className="z-10 flex shrink-0 items-center justify-between gap-2 px-3 py-1.5 md:px-4 [&_.btn-ghost]:text-white [&_.btn-ghost:hover]:bg-white/15 [&_.btn-ghost:hover]:text-white [&_.btn-ghost:active]:bg-white/25 [&_.btn]:transition-colors">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <div className="flex min-w-0 items-center gap-2">
              <input
                type="text"
                className="h-10 min-w-0 flex-1 rounded-xl border border-white/15 bg-white/10 px-3 text-sm font-semibold text-white outline-none transition-colors placeholder:text-white/40 focus:border-white/35 focus:bg-white/15 md:text-base"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleSaveRename();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setRenaming(false);
                    setRenameValue(activeName);
                  }
                }}
                autoFocus
                disabled={renameSaving}
                aria-label="Document name"
              />
              <button
                type="button"
                className="btn btn-ghost btn-circle btn-md h-10 w-10 min-h-0 shrink-0"
                onClick={() => void handleSaveRename()}
                disabled={renameSaving || !renameValue.trim()}
                aria-label="Save name"
                title="Save name"
              >
                {renameSaving ? (
                  <span className="loading loading-spinner loading-sm" />
                ) : (
                  <CheckCircleIcon className="h-7 w-7 text-success" />
                )}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-circle btn-md h-10 w-10 min-h-0 shrink-0"
                onClick={() => {
                  setRenaming(false);
                  setRenameValue(activeName);
                }}
                disabled={renameSaving}
                aria-label="Cancel rename"
                title="Cancel"
              >
                <XCircleIcon className="h-7 w-7" />
              </button>
            </div>
          ) : (
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
              <DocumentFileGlyph
                fileType={activeFileType}
                fileName={activeName}
                className="h-6 w-6 shrink-0"
              />
              <h2 className="min-w-0 max-w-full truncate text-sm font-semibold md:text-base">{activeName}</h2>
              {canRename ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-circle btn-md h-10 w-10 min-h-0 shrink-0"
                  onClick={() => {
                    setRenameValue(activeName);
                    setRenaming(true);
                  }}
                  aria-label="Edit document name"
                  title="Edit name"
                >
                  <PencilSquareIcon className="h-6 w-6" />
                </button>
              ) : null}
              {uploadedLabel ? (
                <span className="shrink-0 text-[11px] text-white/55 tabular-nums">
                  Uploaded {uploadedLabel}
                </span>
              ) : null}
              {isGalleryMode && galleryItems.length > 1 ? (
                <span className="shrink-0 text-[11px] text-white/60 tabular-nums">
                  {previewIndex + 1}/{galleryItems.length}
                </span>
              ) : null}
            </div>
          )}
          {!isGalleryMode && (employeeName || sickDaysReason) ? (
            <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0 text-[11px] text-white/65">
              {employeeName ? <span className="truncate">From: {employeeName}</span> : null}
              {sickDaysReason ? <span className="truncate">Reason: {sickDaysReason}</span> : null}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {showAttachUi ? (
            <>
              <div className="relative" ref={attachMenuRef}>
                <button
                  type="button"
                  className="btn btn-primary btn-sm h-9 gap-1.5 rounded-full px-3"
                  onClick={() => {
                    if (!railOpen) setRailOpen(true);
                    if (selectedAttachIds.size === 0) {
                      toast.error('Select at least one file in the Files panel to attach.');
                      return;
                    }
                    if (attachOptions.length === 0) {
                      toast.error('No sub efforts available to attach to.');
                      return;
                    }
                    setRemoveMenuOpen(false);
                    setAttachMenuOpen((v) => !v);
                  }}
                  disabled={attachBusy || selectedAttachIds.size === 0}
                  aria-expanded={attachMenuOpen}
                  aria-haspopup="menu"
                  title={
                    selectedAttachIds.size === 0
                      ? 'Select documents in the Files panel'
                      : 'Choose a sub effort to attach to'
                  }
                >
                  {isAttaching ? (
                    <span className="loading loading-spinner loading-xs" />
                  ) : (
                    <PaperClipIcon className="h-4 w-4" />
                  )}
                  <span className="hidden text-sm font-medium sm:inline">
                    Attach{selectedAttachIds.size ? ` (${selectedAttachIds.size})` : ''}
                  </span>
                  <ChevronDownIcon className="h-4 w-4 opacity-80" />
                </button>
                {attachMenuOpen && selectedAttachIds.size > 0 && attachOptions.length > 0 ? (
                  <div
                    role="menu"
                    className="absolute right-0 z-50 mt-1.5 max-h-72 w-64 overflow-y-auto rounded-xl border border-white/10 bg-[rgba(22,23,28,0.92)] py-1 text-white shadow-2xl backdrop-blur-xl"
                  >
                    <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-base-content/45">
                      Attach to sub effort
                    </div>
                    {attachOptions.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        role="menuitem"
                        className={`flex w-full items-center px-3 py-2.5 text-left text-sm hover:bg-white/10 ${
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
                  className="btn btn-sm h-9 gap-1.5 rounded-full border border-red-400/30 bg-red-500/15 px-3 font-medium text-red-300 hover:bg-red-500/25"
                  onClick={() => {
                    if (!railOpen) setRailOpen(true);
                    if (selectedAttachIds.size === 0) {
                      toast.error('Select at least one file in the Files panel to remove.');
                      return;
                    }
                    if (removeOptions.length === 0) {
                      toast.error('Selected files are not attached to any sub effort.');
                      return;
                    }
                    setAttachMenuOpen(false);
                    setRemoveMenuOpen((v) => !v);
                  }}
                  disabled={attachBusy || selectedAttachIds.size === 0}
                  aria-expanded={removeMenuOpen}
                  aria-haspopup="menu"
                  title={
                    selectedAttachIds.size === 0
                      ? 'Select documents in the Files panel'
                      : removeOptions.length === 0
                        ? 'Selected files are not attached to any sub effort'
                        : 'Choose a sub effort to remove from'
                  }
                >
                  {isRemoving ? (
                    <span className="loading loading-spinner loading-xs" />
                  ) : (
                    <TrashIcon className="h-4 w-4" />
                  )}
                  <span className="hidden text-sm font-medium sm:inline">Remove</span>
                  <ChevronDownIcon className="h-4 w-4 opacity-80" />
                </button>
                {removeMenuOpen && selectedAttachIds.size > 0 && removeOptions.length > 0 ? (
                  <div
                    role="menu"
                    className="absolute right-0 z-50 mt-1.5 max-h-72 w-64 overflow-y-auto rounded-xl border border-white/10 bg-[rgba(22,23,28,0.92)] py-1 text-white shadow-2xl backdrop-blur-xl"
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
                        onClick={() => void removeSelectedFrom(opt)}
                      >
                        <span className="min-w-0 truncate">{opt.name}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
          {showRail ? (
            <button
              type="button"
              className={`btn btn-ghost btn-sm h-9 gap-1.5 rounded-full px-2.5 ${
                railOpen ? 'bg-white/15 text-white' : ''
              }`}
              onClick={() => setRailOpen((v) => !v)}
              title={railOpen ? 'Hide documents panel' : 'Show documents panel'}
              aria-label={railOpen ? 'Hide documents panel' : 'Show documents panel'}
              aria-pressed={railOpen}
            >
              <RectangleGroupIcon className="h-5 w-5" />
              <span className="hidden text-sm font-medium sm:inline">Files</span>
            </button>
          ) : null}
          {canComment ? (
            <>
              <button
                type="button"
                className={`btn btn-ghost btn-sm h-9 gap-1.5 rounded-full px-2.5 ${
                  highlightMode ? 'bg-amber-400/25 text-amber-100 ring-1 ring-amber-300/40' : ''
                }`}
                onClick={() => {
                  if (!canAnnotateMedia || !displayUrl) {
                    toast.error('Highlights work on images and PDFs in the viewer');
                    return;
                  }
                  setHighlightMode((v) => !v);
                  setCommentsOpen(true);
                  if (!highlightMode) {
                    toast('Drag on the document to highlight a section', { id: 'highlight-hint' });
                  }
                }}
                title="Highlight a section"
                aria-label="Highlight a section"
                aria-pressed={highlightMode}
                disabled={!displayUrl}
              >
                <CursorArrowRaysIcon className="h-5 w-5" />
                <span className="hidden text-sm font-medium sm:inline">Highlight</span>
              </button>
              <button
                type="button"
                className={`btn btn-ghost btn-sm h-9 gap-1.5 rounded-full px-2.5 ${
                  commentsOpen ? 'bg-white/15 text-white' : ''
                }`}
                onClick={() => setCommentsOpen((v) => !v)}
                title="Document comments"
                aria-label="Document comments"
                aria-pressed={commentsOpen}
              >
                <ChatBubbleLeftRightIcon className="h-5 w-5" />
                <span className="hidden text-sm font-medium sm:inline">Comments</span>
                {comments.length > 0 ? (
                  <span className="badge badge-sm h-5 min-w-[1.25rem] border-0 bg-white/20 px-1.5 font-semibold text-white">
                    {comments.length}
                  </span>
                ) : null}
              </button>
            </>
          ) : null}
          {canEditOffice ? (
            editingThisDoc ? (
              <>
                <button
                  type="button"
                  className="btn btn-primary btn-sm h-9 shrink-0 gap-1.5 rounded-full px-3"
                  onClick={handleRequestOfficeSave}
                  disabled={editSaving || awaitingFlush}
                  title={`Save what you changed in ${editorAppName} back to the CRM`}
                >
                  {editSaving || awaitingFlush ? (
                    <span className="loading loading-spinner loading-xs" />
                  ) : (
                    <CheckCircleIcon className="h-5 w-5" />
                  )}
                  <span className="text-sm font-medium">Save</span>
                  {editChanged ? (
                    <span className="h-2 w-2 rounded-full bg-white/80" aria-hidden />
                  ) : null}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm h-9 shrink-0 gap-1.5 rounded-full px-2.5"
                  onClick={() => void handleDiscardOfficeEdit()}
                  disabled={editSaving}
                  title="Throw away the changes made since you clicked Edit"
                >
                  <XCircleIcon className="h-5 w-5" />
                  <span className="hidden text-sm font-medium sm:inline">Discard</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn btn-ghost btn-sm h-9 shrink-0 gap-1.5 rounded-full px-2.5"
                onClick={() => void handleStartOfficeEdit()}
                disabled={editStarting || editSaving}
                title={`Edit in ${editorAppName} and save back here`}
              >
                {editStarting ? (
                  <span className="loading loading-spinner loading-xs" />
                ) : (
                  <PencilSquareIcon className="h-5 w-5" />
                )}
                <span className="hidden text-sm font-medium sm:inline">Edit</span>
              </button>
            )
          ) : null}
          <button
            type="button"
            className="btn btn-sm h-9 shrink-0 gap-1.5 rounded-full border-0 bg-primary px-3.5 font-medium text-white hover:bg-[#2f1fa6]"
            onClick={() => void handleShare()}
            disabled={sharing || !displayUrl}
            title="Share"
            aria-label={`Share ${activeName}`}
          >
            {sharing ? <span className="loading loading-spinner loading-xs" /> : <ShareIcon className="h-5 w-5" />}
            <span className="text-sm">Share</span>
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-circle btn-sm shrink-0"
            onClick={() => void handleDownload()}
            disabled={downloading || !displayUrl}
            title="Download"
            aria-label={`Download ${activeName}`}
          >
            {downloading ? (
              <span className="loading loading-spinner loading-xs" />
            ) : (
              <ArrowDownTrayIcon className="h-5 w-5" />
            )}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-circle btn-sm shrink-0"
            onClick={handleRequestClose}
            title="Close"
            aria-label="Close"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 items-stretch">
        {showRail && railOpen ? (
          <aside
            className={`flex shrink-0 flex-col ${
              showAttachUi ? 'w-[10.5rem] md:w-48 lg:w-52' : 'w-[8.5rem] md:w-40 lg:w-44'
            }`}
            aria-label="Document thumbnails"
          >
            <div className="flex shrink-0 items-center justify-between gap-1 px-2 py-1.5">
              <span className="truncate px-0.5 text-[11px] font-semibold text-white/60">
                Files
                {showAttachUi && selectedAttachIds.size > 0
                  ? ` · ${selectedAttachIds.size}`
                  : ''}
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-xs btn-square h-7 w-7 min-h-0"
                onClick={() => setRailOpen(false)}
                title="Collapse panel"
                aria-label="Collapse documents panel"
              >
                <ChevronLeftIcon className="h-4 w-4" />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden px-2.5 py-3 [-webkit-overflow-scrolling:touch] [scrollbar-width:thin]">
              {galleryItems.map((d, i) => {
                const isActive = i === previewIndex;
                const ft = inferFileType(d.name, d.fileType);
                const canAttachDoc = Boolean(d.storagePath?.trim());
                const checked = selectedAttachIds.has(d.id);
                const pathKey = normalizeStorageKey(d.storagePath);
                const attachedTo = pathKey ? attachmentsByPath.get(pathKey) ?? [] : [];
                return (
                  <div
                    key={d.id}
                    className={`group flex w-full shrink-0 flex-col gap-1.5 rounded-xl p-1 text-left transition ${
                      isActive
                        ? 'bg-white/10 shadow-lg ring-2 ring-primary/60'
                        : checked
                          ? 'bg-primary/20 ring-1 ring-primary/40'
                          : attachedTo.length
                            ? 'bg-emerald-400/15 ring-1 ring-emerald-400/40'
                            : 'hover:bg-white/5'
                    }`}
                  >
                    {showAttachUi ? (
                      <label
                        className={`flex items-center gap-1.5 px-0.5 ${
                          canAttachDoc ? 'cursor-pointer' : 'cursor-not-allowed opacity-40'
                        }`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          className="checkbox checkbox-xs"
                          checked={checked}
                          disabled={!canAttachDoc}
                          onChange={() => {
                            if (canAttachDoc) toggleAttachSelected(d.id);
                          }}
                          aria-label={`Select ${d.name}`}
                        />
                        <span className="truncate text-[10px] font-medium text-base-content/55">
                          Select
                        </span>
                      </label>
                    ) : null}
                    <button
                      id={`doc-viewer-thumb-${d.id}`}
                      type="button"
                      onClick={() => setPreviewIndex(i)}
                      title={d.name}
                      className="flex w-full flex-col gap-1.5 text-left"
                    >
                      <div className="relative w-full">
                        <DocumentSidebarThumb
                          name={d.name}
                          url={isActive && displayUrl ? displayUrl : d.url}
                          fileType={ft}
                          storagePath={d.storagePath}
                          bucketName={bucketName}
                          isActive={isActive}
                        />
                        {isActive ? (
                          <span className="absolute right-1 top-1 rounded-md bg-primary px-1.5 py-0.5 text-[9px] font-semibold text-primary-content shadow">
                            {i + 1}/{galleryItems.length}
                          </span>
                        ) : null}
                      </div>
                      <span className="w-full px-0.5 text-center text-[11px] font-medium leading-snug text-base-content/85 line-clamp-3 break-all md:text-xs">
                        {d.name}
                      </span>
                      {showAttachUi && attachedTo.length > 0 ? (
                        <div className="flex w-full min-w-0 flex-wrap items-center justify-center gap-1 px-0.5">
                          {attachedTo.map((a) => (
                            <SubEffortAttachBadge
                              key={a.id}
                              name={a.name}
                              highlight={String(a.id) === String(targetSubEffortId ?? '')}
                              className="text-[11px] px-2 py-0.5"
                            />
                          ))}
                        </div>
                      ) : null}
                    </button>
                  </div>
                );
              })}
            </div>
          </aside>
        ) : showRail && !railOpen ? (
          <div className="flex w-9 shrink-0 flex-col items-center py-2">
            <button
              type="button"
              className="btn btn-ghost btn-xs btn-square h-8 w-8 min-h-0"
              onClick={() => setRailOpen(true)}
              title="Show documents panel"
              aria-label="Show documents panel"
            >
              <ChevronRightIcon className="h-4 w-4" />
            </button>
          </div>
        ) : null}

        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {showRail && galleryItems.length > 1 ? (
            <>
              <button
                type="button"
                className="absolute left-3 top-1/2 z-20 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white shadow-sm backdrop-blur-md transition hover:bg-black/65 hover:shadow-md md:flex"
                aria-label="Previous file"
                onClick={goPrev}
              >
                <ChevronLeftIcon className="h-6 w-6" />
              </button>
              <button
                type="button"
                className="absolute right-3 top-1/2 z-20 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white shadow-sm backdrop-blur-md transition hover:bg-black/65 hover:shadow-md md:flex"
                aria-label="Next file"
                onClick={goNext}
              >
                <ChevronRightIcon className="h-6 w-6" />
              </button>
            </>
          ) : null}
          {highlightMode ? (
            <div className="absolute inset-x-0 top-0 z-10 flex justify-center px-3 pt-3">
              <div className="rounded-full bg-amber-400/95 px-4 py-1.5 text-xs font-semibold text-amber-950 shadow-lg">
                Drag to highlight a section, then write your comment
              </div>
            </div>
          ) : null}
          <div
            className={`flex min-h-0 w-full flex-1 ${
              !loadingUrl && isImage && !imageError && displayUrl
                ? 'min-h-0 flex-col overflow-hidden p-0'
                : !loadingUrl &&
                    (isPdf || Boolean(officeEmbedUrl)) &&
                    !(highlightMode || highlightMarkers.length > 0 || draftHighlight)
                  ? 'flex-col overflow-hidden p-0'
                  : !loadingUrl && (isPdf || highlightMarkers.length > 0 || draftHighlight)
                    ? 'min-h-0 flex-col overflow-auto p-0'
                    : 'items-center justify-center overflow-auto p-3 md:p-6'
            }`}
          >
            {loadingUrl ? (
              <div className="text-center text-white/80">
                <span className="loading loading-spinner loading-lg" />
                <p className="mt-4 text-sm opacity-80">Loading document…</p>
              </div>
            ) : !displayUrl ? (
              !activeUrl ? (
                <div className="text-center text-white/80">
                  <span className="loading loading-spinner loading-lg" />
                  <p className="mt-4 text-sm opacity-80">Loading document…</p>
                </div>
              ) : (
                <div className="max-w-md text-center text-white/80">
                  <p className="text-lg font-semibold">Failed to load document</p>
                  <p className="mt-2 text-sm opacity-80">Unable to open this file in the viewer.</p>
                  <button type="button" className="btn btn-primary btn-sm mt-4" onClick={() => void handleDownload()}>
                    Try download
                  </button>
                </div>
              )
            ) : isImage && !imageError ? (
              <div className="relative flex min-h-0 h-full w-full flex-1 flex-col">
                <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/15 bg-black/55 px-1.5 py-1 shadow-lg backdrop-blur-md">
                  <button
                    type="button"
                    className="pointer-events-auto btn btn-ghost btn-xs btn-square h-8 w-8 min-h-0 border-0 text-white hover:bg-white/15"
                    aria-label="Zoom out"
                    title="Zoom out"
                    disabled={imageZoom <= 0.5}
                    onClick={() => setImageZoom((z) => Math.max(0.5, Math.round((z - 0.25) * 100) / 100))}
                  >
                    <MinusIcon className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className="pointer-events-auto btn btn-ghost btn-xs h-8 min-h-0 border-0 px-2 text-xs font-semibold tabular-nums text-white hover:bg-white/15"
                    aria-label="Fit to screen"
                    title="Fit full image"
                    onClick={() => setImageZoom(1)}
                  >
                    {Math.round(imageZoom * 100)}%
                  </button>
                  <button
                    type="button"
                    className="pointer-events-auto btn btn-ghost btn-xs btn-square h-8 w-8 min-h-0 border-0 text-white hover:bg-white/15"
                    aria-label="Zoom in"
                    title="Zoom in"
                    disabled={imageZoom >= 4}
                    onClick={() => setImageZoom((z) => Math.min(4, Math.round((z + 0.25) * 100) / 100))}
                  >
                    <PlusIcon className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className="pointer-events-auto btn btn-ghost btn-xs btn-square h-8 w-8 min-h-0 border-0 text-white hover:bg-white/15"
                    aria-label="Fit full image"
                    title="Fit full image"
                    onClick={() => setImageZoom(1)}
                  >
                    <ArrowsPointingInIcon className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className="pointer-events-auto btn btn-ghost btn-xs btn-square h-8 w-8 min-h-0 border-0 text-white hover:bg-white/15"
                    aria-label="Rotate image"
                    title="Rotate 90°"
                    onClick={() => setImageRotation((r) => (r + 90) % 360)}
                  >
                    <ArrowPathIcon className="h-4 w-4" />
                  </button>
                </div>
                <div
                  ref={imageZoomPaneRef}
                  className="min-h-0 h-full w-full flex-1 touch-none p-3 md:p-6"
                >
                  <DocumentAnnotatableView
                    key={`image-${activeDoc?.id || 'none'}`}
                    mode="image"
                    src={displayUrl}
                    storagePath={activeStoragePath}
                    alt={activeName}
                    highlights={highlightMarkers}
                    draft={draftHighlight}
                    focusedId={focusedCommentId}
                    drawEnabled={highlightMode}
                    onDraftChange={handleDraftHighlight}
                    onSelectHighlight={focusComment}
                    onDeleteHighlight={deleteHighlightById}
                    onImageError={() => setImageError(true)}
                    zoom={imageZoom}
                    rotation={imageRotation}
                  />
                </div>
              </div>
            ) : isPdf && !pdfError ? (
              highlightMode || highlightMarkers.length > 0 || draftHighlight ? (
                <DocumentAnnotatableView
                  key={`pdf-${activeDoc?.id || 'none'}`}
                  mode="pdf"
                  src={displayUrl || ''}
                  storagePath={activeStoragePath}
                  alt={activeName}
                  highlights={highlightMarkers}
                  draft={draftHighlight}
                  focusedId={focusedCommentId}
                  drawEnabled={highlightMode}
                  onDraftChange={handleDraftHighlight}
                  onSelectHighlight={focusComment}
                  onDeleteHighlight={deleteHighlightById}
                  onPdfError={() => {
                    setHighlightMode(false);
                    setDraftHighlight(null);
                    toast.error('Could not prepare PDF for highlights. Showing standard preview.');
                  }}
                />
              ) : (
                <iframe
                  src={pdfEmbedUrl ?? displayUrl}
                  className="min-h-0 w-full flex-1 border-0 bg-transparent"
                  title={activeName}
                  onError={() => setPdfError(true)}
                />
              )
            ) : editingThisDoc && editSession ? (
              <div className="flex min-h-0 w-full flex-1 items-center justify-center p-6">
                <div className="max-w-md rounded-2xl bg-white p-6 text-center shadow-2xl">
                  <PencilSquareIcon className="mx-auto h-10 w-10 text-primary" />
                  <p className="mt-3 text-lg font-semibold text-slate-900">
                    Editing in {editorAppName}
                  </p>
                  <p className="mt-2 text-sm text-slate-600">
                    {activeName} is open in another tab. Press Save when you are done.
                  </p>
                  {awaitingFlush ? (
                    <>
                      <p className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-slate-600">
                        <span className="loading loading-spinner loading-xs" />
                        Getting your changes from {editorAppName}…
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Close the {editorAppName} tab to speed this up.
                      </p>
                    </>
                  ) : editChanged ? (
                    <p className="mt-3 text-sm font-medium text-emerald-600">Ready to save.</p>
                  ) : null}
                  <div className="mt-5 flex flex-wrap justify-center gap-2">
                    {awaitingFlush ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm text-slate-700 hover:bg-slate-100"
                        onClick={() => setAwaitingFlush(false)}
                      >
                        Stop waiting
                      </button>
                    ) : (
                      <>
                        {/* A link: a tab opened from script can be blocked, this cannot. */}
                        <a
                          href={editSession.editUrl}
                          target={editorTabName}
                          rel="noopener noreferrer"
                          className={`btn btn-sm gap-1.5 ${
                            editorOpened
                              ? 'border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-100'
                              : 'btn-primary'
                          }`}
                          onClick={() => setEditorOpened(true)}
                        >
                          <ArrowTopRightOnSquareIcon className="h-4 w-4" />
                          {editorOpened ? `Back to ${editorAppName}` : `Open in ${editorAppName}`}
                        </a>
                        <button
                          type="button"
                          className={`btn btn-sm gap-1.5 ${
                            editorOpened
                              ? 'btn-primary'
                              : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-100'
                          }`}
                          onClick={handleRequestOfficeSave}
                          disabled={editSaving}
                        >
                          {editSaving ? (
                            <span className="loading loading-spinner loading-xs" />
                          ) : (
                            <CheckCircleIcon className="h-4 w-4" />
                          )}
                          Save to the CRM
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ) : officeEmbedUrl ? (
              <iframe
                key={officeEmbedUrl}
                src={officeEmbedUrl}
                className="min-h-0 w-full flex-1 border-0 bg-white"
                title={activeName}
                allow="fullscreen"
                onError={() => setOfficeError(true)}
              />
            ) : imageError || pdfError || (isOffice && (officeError || !officeEmbedUrl)) ? (
              <div className="max-w-md text-center text-white/80">
                <p className="text-lg font-semibold">
                  {isOffice ? 'Preview unavailable' : 'Failed to load document'}
                </p>
                <p className="mt-2 text-sm opacity-80">
                  {isOffice
                    ? 'Word and Excel previews need a public HTTPS link. You can still download the file.'
                    : null}
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-3">
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => void handleDownload()}>
                    Download
                  </button>
                  {canEditOffice ? (
                    <button
                      type="button"
                      className="btn btn-outline btn-sm border-white/25 text-white hover:border-white/40 hover:bg-white/10"
                      onClick={() => void handleStartOfficeEdit()}
                      disabled={editStarting || editSaving}
                    >
                      {editStarting ? 'Opening…' : 'Edit and save back'}
                    </button>
                  ) : null}
                  {displayUrl ? (
                    <a
                      href={displayUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-outline btn-sm border-white/25 text-white hover:border-white/40 hover:bg-white/10"
                    >
                      Open in new tab
                    </a>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="max-w-md text-center text-white/80">
                <p className="text-lg font-semibold">Preview not available</p>
                <p className="mt-2 text-sm opacity-80">This file type cannot be previewed in the browser.</p>
                <button type="button" className="btn btn-primary btn-sm mt-4" onClick={() => void handleDownload()}>
                  Download
                </button>
              </div>
            )}
          </div>

          {showRail && galleryItems.length > 1 ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center gap-3 md:hidden">
              <button
                type="button"
                className="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white shadow-sm backdrop-blur-md transition hover:bg-black/65"
                aria-label="Previous file"
                onClick={goPrev}
              >
                <ChevronLeftIcon className="h-6 w-6" />
              </button>
              <button
                type="button"
                className="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white shadow-sm backdrop-blur-md transition hover:bg-black/65"
                aria-label="Next file"
                onClick={goNext}
              >
                <ChevronRightIcon className="h-6 w-6" />
              </button>
            </div>
          ) : null}
        </div>

        {commentsOpen && canComment ? (
          <aside
            data-doc-comments-panel
            className="absolute inset-y-0 right-0 z-30 flex w-full max-w-md flex-col bg-[rgba(11,12,15,0.5)] shadow-2xl backdrop-blur-xl md:static md:inset-auto md:z-0 md:w-[22rem] md:max-w-none md:shrink-0 lg:w-[26rem]"
            aria-label="Document comments"
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-white/10 bg-white/[0.06] px-4 py-3.5">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/15 text-white shadow-sm">
                    <ChatBubbleLeftRightIcon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold text-white">Comments</h3>
                    <p className="truncate text-xs text-white/60" title={activeName}>
                      {activeName}
                    </p>
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-square shrink-0"
                onClick={() => setCommentsOpen(false)}
                aria-label="Close comments"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div
              ref={commentsListRef}
              className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4"
            >
              {commentsLoading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-white/60">
                  <span className="loading loading-spinner loading-sm" />
                  Loading comments…
                </div>
              ) : comments.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/15 bg-white/5 px-4 py-10 text-center text-white/60">
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white/70">
                    <ChatBubbleLeftRightIcon className="h-6 w-6" />
                  </div>
                  <p className="text-sm font-medium text-white/85">No comments yet</p>
                  <p className="mt-1 text-xs text-white/50">
                    Share notes, or use Highlight to mark a section on the file.
                  </p>
                </div>
              ) : (
                comments.map((c) => {
                  const mine =
                    !!actorName &&
                    c.created_by.trim().toLowerCase() === actorName.trim().toLowerCase();
                  const sectionLabel = highlightLabelById.get(c.id);
                  const focused = focusedCommentId === c.id;
                  return (
                    <article
                      key={c.id}
                      id={`doc-comment-${c.id}`}
                      className={`cursor-pointer rounded-2xl border px-3.5 py-3 shadow-sm transition ${
                        focused
                          ? mine
                            ? 'border-amber-300/60 bg-white/[0.16] text-white ring-2 ring-amber-300/50'
                            : 'border-amber-300/60 bg-white/[0.08] text-white ring-2 ring-amber-300/50'
                          : mine
                            ? 'border-white/10 bg-white/[0.14] text-white'
                            : 'border-white/10 bg-white/[0.07] text-white'
                      }`}
                      onClick={() => {
                        if (c.highlight) focusComment(c.id);
                        else setFocusedCommentId(c.id);
                      }}
                    >
                      <div className="flex items-start gap-2.5">
                        <span
                          className={`flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-bold ${
                            mine
                              ? 'bg-white/20 text-white'
                              : 'bg-white/15 text-white'
                          }`}
                          aria-hidden
                        >
                          {c.photoUrl ? (
                            <img
                              src={c.photoUrl}
                              alt=""
                              className="h-full w-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            initialsFromName(c.created_by)
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <div
                                  className={`truncate text-sm font-semibold ${
                                    mine ? 'text-white' : 'text-white'
                                  }`}
                                >
                                  {c.created_by}
                                </div>
                                {sectionLabel != null ? (
                                  <span
                                    className={`badge badge-sm h-5 border-0 px-1.5 font-semibold ${
                                      mine
                                        ? 'bg-amber-300 text-amber-950'
                                        : 'bg-amber-300 text-amber-950'
                                    }`}
                                  >
                                    §{sectionLabel}
                                    {c.highlight?.page != null ? ` · p.${c.highlight.page}` : ''}
                                  </span>
                                ) : null}
                              </div>
                              <div
                                className={`text-[11px] tabular-nums ${
                                  mine ? 'text-white/60' : 'text-white/55'
                                }`}
                              >
                                {formatCommentTime(c.created_at)}
                              </div>
                            </div>
                            {mine ? (
                              <button
                                type="button"
                                className="btn btn-ghost btn-xs btn-square text-white/70 hover:bg-white/10 hover:text-white"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void deleteComment(c);
                                }}
                                disabled={deletingCommentId === c.id}
                                aria-label="Delete comment"
                                title="Delete"
                              >
                                {deletingCommentId === c.id ? (
                                  <span className="loading loading-spinner loading-xs" />
                                ) : (
                                  <TrashIcon className="h-4 w-4" />
                                )}
                              </button>
                            ) : null}
                          </div>
                          <p
                            className={`mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed ${
                              mine ? 'text-white/90' : 'text-white/85'
                            }`}
                          >
                            {c.body}
                          </p>
                          {sectionLabel != null ? (
                            <button
                              type="button"
                              className={`mt-2 text-xs font-medium underline-offset-2 hover:underline ${
                                mine ? 'text-amber-200' : 'text-amber-200'
                              }`}
                              onClick={(e) => {
                                e.stopPropagation();
                                focusComment(c.id);
                              }}
                            >
                              Show on document
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  );
                })
              )}
              <div ref={commentsEndRef} />
            </div>

            <div className="shrink-0 border-t border-white/10 bg-white/[0.04] p-3">
              {draftHighlight ? (
                <div className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-sky-300/30 bg-sky-400/15 px-3 py-2 text-xs text-sky-100">
                  <span className="font-medium">
                    Commenting on highlighted section
                    {draftHighlight.page != null ? ` (page ${draftHighlight.page})` : ''}
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    onClick={() => setDraftHighlight(null)}
                  >
                    Clear
                  </button>
                </div>
              ) : null}
              <div className="rounded-2xl border border-white/15 bg-white/[0.07] p-2">
                <textarea
                  className="textarea textarea-ghost min-h-[4.5rem] w-full resize-none bg-transparent px-2 py-1.5 text-sm leading-relaxed text-white placeholder:text-white/40 focus:bg-white/10 focus:outline-none"
                  placeholder={
                    draftHighlight
                      ? 'Write a comment about this section…'
                      : 'Write a comment for the team…'
                  }
                  value={commentDraft}
                  onChange={(e) => setCommentDraft(e.target.value)}
                  disabled={commentSaving}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      void postComment();
                    }
                  }}
                />
                <div className="mt-1 flex items-center justify-between gap-2 px-1">
                  <span className="text-[11px] text-white/45">⌘/Ctrl + Enter to send</span>
                  <button
                    type="button"
                    className="btn btn-sm h-9 gap-1.5 rounded-full border-0 bg-white px-4 font-medium text-[#111318] hover:bg-white/85"
                    onClick={() => void postComment()}
                    disabled={commentSaving || !commentDraft.trim()}
                  >
                    {commentSaving ? (
                      <span className="loading loading-spinner loading-xs" />
                    ) : (
                      <PaperAirplaneIcon className="h-4 w-4" />
                    )}
                    Post
                  </button>
                </div>
              </div>
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );

  if (typeof document === 'undefined') return modal;
  return createPortal(modal, document.body);
};

export default DocumentViewerModal;
