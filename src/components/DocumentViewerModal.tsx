import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownTrayIcon,
  ChatBubbleLeftRightIcon,
  CheckCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  CursorArrowRaysIcon,
  PaperAirplaneIcon,
  PaperClipIcon,
  PencilSquareIcon,
  RectangleGroupIcon,
  ShareIcon,
  TrashIcon,
  XCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import { DocumentFileGlyph } from '../lib/documentFileGlyphs';
import { fetchStageActorInfo } from '../lib/leadStageManager';
import { resolveUploaderDisplayByKey } from '../lib/uploaderDisplay';
import {
  attachStoragePathsToSubEffort,
  buildSubEffortAttachmentsByPath,
  listSubEffortAttachOptions,
  normalizeStorageKey,
  type SubEffortAttachOption,
  type SubEffortAttachmentRef,
} from '../lib/subEffortDocumentAttach';
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
}

function inferFileType(name: string, fileType?: string): string {
  const t = (fileType || '').trim();
  if (t) return t;
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (ext === 'pdf') return 'application/pdf';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return `image/${ext === 'jpg' ? 'jpeg' : ext}`;
  return 'application/octet-stream';
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

/** Short label for side-rail thumbnails (keeps extension when possible). */
function shortenFileName(name: string, maxLen = 18): string {
  const t = name.trim();
  if (!t) return 'File';
  if (t.length <= maxLen) return t;
  const dot = t.lastIndexOf('.');
  const hasExt = dot > 0 && dot < t.length - 1 && t.length - dot <= 8;
  if (!hasExt) return `${t.slice(0, Math.max(1, maxLen - 1))}…`;
  const ext = t.slice(dot);
  const baseBudget = Math.max(1, maxLen - ext.length - 1);
  return `${t.slice(0, baseBudget)}…${ext}`;
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

async function resolveSignedUrl(
  documentUrl: string,
  bucketName: string,
): Promise<string | null> {
  try {
    let filePath = documentUrl;

    if (documentUrl.includes('/storage/v1/object/')) {
      const urlParts = documentUrl.split('/storage/v1/object/');
      if (urlParts.length > 1) {
        const pathParts = urlParts[1].split('/');
        if (pathParts.length > 1) {
          filePath = pathParts.slice(2).join('/');
        }
      }
    } else if (documentUrl.startsWith('http://') || documentUrl.startsWith('https://')) {
      try {
        const url = new URL(documentUrl);
        let pathname = url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname;
        if (pathname.startsWith(bucketName + '/')) {
          pathname = pathname.substring(bucketName.length + 1);
        }
        filePath = pathname;
      } catch {
        filePath = documentUrl;
      }
    }

    const { data, error } = await supabase.storage.from(bucketName).createSignedUrl(filePath, 3600);
    if (error) {
      console.error('Error generating signed URL:', error);
      return null;
    }
    return data.signedUrl;
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
}) => {
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
  const needsBucketSign = !isGalleryMode;
  /** Attach controls when opened from Sequence of Events / sub-effort context. */
  const showAttachUi =
    isGalleryMode && (subEffortRows != null || targetSubEffortId != null || typeof onAttached === 'function');

  const [previewIndex, setPreviewIndex] = useState(0);
  const [imageError, setImageError] = useState(false);
  const [pdfError, setPdfError] = useState(false);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
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
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const attachMenuRef = useRef<HTMLDivElement | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<Map<string, SubEffortAttachmentRef[]>>(
    () => new Map(),
  );
  const commentsEndRef = useRef<HTMLDivElement | null>(null);
  const commentsListRef = useRef<HTMLDivElement | null>(null);

  const itemsRef = useRef(galleryItems);
  itemsRef.current = galleryItems;

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
    if (!isOpen) {
      setSelectedAttachIds(new Set());
      setPendingAttachments(new Map());
      setAttachMenuOpen(false);
    }
  }, [isOpen]);

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

  const toggleAttachSelected = useCallback((id: string) => {
    setSelectedAttachIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const attachSelectedTo = useCallback(
    async (option: SubEffortAttachOption) => {
      if (isAttaching) return;
      const picked = galleryItems.filter(
        (d) => selectedAttachIds.has(d.id) && d.storagePath?.trim(),
      );
      if (picked.length === 0) {
        toast.error('Select at least one file in the Files panel to attach.');
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
        setSelectedAttachIds(new Set());
        onAttached?.(paths, { id: option.id, name: option.name });
      } catch (e: unknown) {
        console.error('attach from document viewer:', e);
        toast.error(e instanceof Error ? e.message : 'Failed to attach');
      } finally {
        setIsAttaching(false);
      }
    },
    [activeFolderId, galleryItems, isAttaching, onAttached, selectedAttachIds],
  );

  useEffect(() => {
    if (!isOpen || galleryItems.length === 0) {
      setPreviewIndex(0);
      return;
    }
    setPreviewIndex(Math.min(Math.max(0, initialIndex), galleryItems.length - 1));
  }, [isOpen, galleryItems, initialIndex]);

  useEffect(() => {
    if (previewIndex >= galleryItems.length && galleryItems.length > 0) {
      setPreviewIndex(galleryItems.length - 1);
    }
  }, [galleryItems.length, previewIndex]);

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
    setCommentDraft('');
    setDraftHighlight(null);
    setHighlightMode(false);
    setFocusedCommentId(null);
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
    if (!isOpen || !activeUrl) {
      setSignedUrl(null);
      return;
    }

    if (!needsBucketSign) {
      setSignedUrl(activeUrl.startsWith('http') ? activeUrl : null);
      setLoadingUrl(false);
      return;
    }

    let cancelled = false;
    setLoadingUrl(true);
    setImageError(false);
    setPdfError(false);

    void (async () => {
      const url = await resolveSignedUrl(activeUrl, bucketName);
      if (cancelled) return;
      if (!url) {
        setImageError(true);
        setPdfError(true);
        setSignedUrl(null);
      } else {
        setSignedUrl(url);
      }
      setLoadingUrl(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, activeUrl, bucketName, needsBucketSign, activeDoc?.id]);

  const displayUrl =
    signedUrl ||
    (activeUrl.startsWith('http://') || activeUrl.startsWith('https://') ? activeUrl : null);

  const isImage =
    activeFileType.includes('image/') ||
    !!activeName.match(/\.(jpg|jpeg|png|gif|webp)$/i) ||
    !!activeUrl.match(/\.(jpg|jpeg|png|gif|webp)$/i);
  const isPdf =
    activeFileType.includes('pdf') ||
    !!activeName.match(/\.pdf$/i) ||
    !!activeUrl.match(/\.pdf$/i);

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
        onClose();
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

  return (
    <div
      className="fixed inset-0 z-[1200] flex flex-col overflow-hidden bg-base-100"
      role="dialog"
      aria-modal="true"
      aria-label="Document viewer"
    >
      <header className="z-10 flex shrink-0 items-center justify-between gap-2 bg-base-100 px-3 py-1.5 md:px-4">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <div className="flex min-w-0 items-center gap-2">
              <input
                type="text"
                className="input input-bordered input-sm h-10 min-w-0 flex-1 text-sm font-semibold md:text-base"
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
                <span className="shrink-0 text-[11px] text-base-content/55 tabular-nums">
                  Uploaded {uploadedLabel}
                </span>
              ) : null}
              {isGalleryMode && galleryItems.length > 1 ? (
                <span className="shrink-0 text-[11px] text-base-content/60 tabular-nums">
                  {previewIndex + 1}/{galleryItems.length}
                </span>
              ) : null}
            </div>
          )}
          {!isGalleryMode && (employeeName || sickDaysReason) ? (
            <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0 text-[11px] text-base-content/65">
              {employeeName ? <span className="truncate">From: {employeeName}</span> : null}
              {sickDaysReason ? <span className="truncate">Reason: {sickDaysReason}</span> : null}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {showAttachUi ? (
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
                  setAttachMenuOpen((v) => !v);
                }}
                disabled={isAttaching || selectedAttachIds.size === 0}
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
          ) : null}
          {showRail ? (
            <button
              type="button"
              className={`btn btn-ghost btn-sm h-9 gap-1.5 rounded-full px-2.5 ${
                railOpen ? 'bg-base-200 text-base-content' : ''
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
                  highlightMode ? 'bg-amber-100 text-amber-900' : ''
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
                  commentsOpen ? 'bg-base-200 text-base-content' : ''
                }`}
                onClick={() => setCommentsOpen((v) => !v)}
                title="Document comments"
                aria-label="Document comments"
                aria-pressed={commentsOpen}
              >
                <ChatBubbleLeftRightIcon className="h-5 w-5" />
                <span className="hidden text-sm font-medium sm:inline">Comments</span>
                {comments.length > 0 ? (
                  <span className="badge badge-sm h-5 min-w-[1.25rem] border-0 bg-gray-700 px-1.5 font-semibold text-white">
                    {comments.length}
                  </span>
                ) : null}
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="btn btn-ghost btn-circle btn-sm shrink-0"
            onClick={() => void handleShare()}
            disabled={sharing || !displayUrl}
            title="Share"
            aria-label={`Share ${activeName}`}
          >
            {sharing ? <span className="loading loading-spinner loading-xs" /> : <ShareIcon className="h-5 w-5" />}
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
            onClick={onClose}
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
            className={`flex shrink-0 flex-col border-r border-base-300/80 bg-base-200/80 ${
              showAttachUi ? 'w-[10.5rem] md:w-48 lg:w-52' : 'w-[8.5rem] md:w-40 lg:w-44'
            }`}
            aria-label="Document thumbnails"
          >
            <div className="flex shrink-0 items-center justify-between gap-1 border-b border-base-300/60 px-2 py-1.5">
              <span className="truncate px-0.5 text-[11px] font-semibold text-base-content/60">
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
                const thumbIsImg = ft.includes('image/');
                const shortName = shortenFileName(d.name, 28);
                const canAttachDoc = Boolean(d.storagePath?.trim());
                const checked = selectedAttachIds.has(d.id);
                const pathKey = normalizeStorageKey(d.storagePath);
                const attachedTo = pathKey ? attachmentsByPath.get(pathKey) ?? [] : [];
                const attachedToCurrent =
                  targetSubEffortId != null &&
                  attachedTo.some((a) => String(a.id) === String(targetSubEffortId));
                return (
                  <div
                    key={d.id}
                    className={`group flex w-full shrink-0 flex-col gap-1.5 rounded-xl p-1 text-left transition ${
                      isActive
                        ? 'bg-base-100 shadow-md ring-2 ring-primary/50'
                        : checked
                          ? 'bg-primary/5 ring-1 ring-primary/30'
                          : attachedTo.length
                            ? 'bg-emerald-50/70 ring-1 ring-emerald-200/80'
                            : 'hover:bg-base-100/70'
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
                      <div
                        className={`relative aspect-[3/4] w-full overflow-hidden rounded-lg border bg-base-300 ${
                          isActive ? 'border-primary/30' : 'border-base-300/80'
                        }`}
                      >
                        {thumbIsImg && d.url.startsWith('http') ? (
                          <img
                            src={d.url}
                            alt=""
                            className="h-full w-full object-cover"
                            loading="lazy"
                            draggable={false}
                          />
                        ) : ft.includes('pdf') ? (
                          <div className="flex h-full w-full flex-col bg-white px-2.5 pb-2 pt-3">
                            <div className="mb-2 h-1.5 w-2/3 rounded-full bg-red-500/80" />
                            <div className="space-y-1.5">
                              <div className="h-1 w-full rounded-full bg-slate-200" />
                              <div className="h-1 w-[92%] rounded-full bg-slate-200" />
                              <div className="h-1 w-[85%] rounded-full bg-slate-200" />
                              <div className="h-1 w-full rounded-full bg-slate-200" />
                              <div className="h-1 w-[70%] rounded-full bg-slate-200" />
                            </div>
                            <div className="mt-auto flex items-center justify-between pt-2">
                              <span className="text-[9px] font-bold uppercase tracking-wide text-red-600">
                                PDF
                              </span>
                              <div className="origin-center scale-[0.28]">
                                <DocumentFileGlyph fileType={ft} fileName={d.name} />
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-b from-base-100 to-base-300 px-2">
                            <div className="flex origin-center scale-[0.55] items-center justify-center">
                              <DocumentFileGlyph fileType={ft} fileName={d.name} />
                            </div>
                          </div>
                        )}
                        {isActive ? (
                          <span className="absolute right-1 top-1 rounded-md bg-primary px-1.5 py-0.5 text-[9px] font-semibold text-primary-content shadow">
                            {i + 1}/{galleryItems.length}
                          </span>
                        ) : null}
                      </div>
                      <span className="w-full px-0.5 text-center text-[11px] font-medium leading-snug text-base-content/85 line-clamp-2 break-words md:text-xs">
                        {shortName}
                      </span>
                      {showAttachUi && (attachedToCurrent || attachedTo.length > 0) ? (
                        <div className="flex w-full flex-wrap items-center justify-center gap-1 px-0.5">
                          {attachedToCurrent ? (
                            <span className="inline-flex items-center rounded bg-emerald-600/10 px-1 py-0.5 text-[9px] font-semibold text-emerald-800">
                              Attached
                            </span>
                          ) : null}
                          {attachedTo.map((a) => (
                            <span
                              key={a.id}
                              className={`inline-flex max-w-full truncate rounded px-1 py-0.5 text-[9px] font-medium ${
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
                      ) : null}
                    </button>
                  </div>
                );
              })}
            </div>
          </aside>
        ) : showRail && !railOpen ? (
          <div className="flex w-9 shrink-0 flex-col items-center border-r border-base-300/80 bg-base-200/60 py-2">
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

        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-neutral-900">
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
            className={`flex min-h-0 w-full flex-1 bg-neutral-900 ${
              isPdf && !(highlightMode || highlightMarkers.length > 0 || draftHighlight)
                ? 'flex-col overflow-hidden p-0'
                : isPdf || highlightMarkers.length > 0 || draftHighlight
                  ? 'min-h-0 flex-col overflow-auto p-0'
                  : 'items-center justify-center overflow-auto p-3 md:p-6'
            }`}
          >
            {loadingUrl ? (
              <div className="text-center text-neutral-200">
                <span className="loading loading-spinner loading-lg" />
                <p className="mt-4 text-sm opacity-80">Loading document…</p>
              </div>
            ) : !displayUrl ? (
              <div className="max-w-md text-center text-neutral-200">
                <p className="text-lg font-semibold">Failed to load document</p>
                <p className="mt-2 text-sm opacity-80">Unable to open this file in the viewer.</p>
                <button type="button" className="btn btn-primary btn-sm mt-4" onClick={() => void handleDownload()}>
                  Try download
                </button>
              </div>
            ) : isImage && !imageError ? (
              <div className="flex min-h-0 w-full flex-1 items-center justify-center">
                <DocumentAnnotatableView
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
                />
              </div>
            ) : isPdf && !pdfError ? (
              highlightMode || highlightMarkers.length > 0 || draftHighlight ? (
                <DocumentAnnotatableView
                  mode="pdf"
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
                  onPdfError={() => {
                    setHighlightMode(false);
                    setDraftHighlight(null);
                    toast.error('Could not prepare PDF for highlights. Showing standard preview.');
                  }}
                />
              ) : (
                <iframe
                  src={displayUrl}
                  className="min-h-0 w-full flex-1 border-0 bg-neutral-900"
                  title={activeName}
                  onError={() => setPdfError(true)}
                />
              )
            ) : imageError || pdfError ? (
              <div className="max-w-md text-center text-neutral-200">
                <p className="text-lg font-semibold">Failed to load document</p>
                <div className="mt-4 flex justify-center gap-3">
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => void handleDownload()}>
                    Download
                  </button>
                  <a
                    href={displayUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-outline btn-sm border-neutral-500 text-neutral-100"
                  >
                    Open in new tab
                  </a>
                </div>
              </div>
            ) : (
              <div className="max-w-md text-center text-neutral-200">
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
            className="absolute inset-y-0 right-0 z-30 flex w-full max-w-md flex-col border-l border-base-300 bg-base-100 shadow-2xl md:static md:inset-auto md:z-0 md:w-[22rem] md:max-w-none md:shrink-0 lg:w-[26rem]"
            aria-label="Document comments"
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-base-200 bg-gradient-to-b from-slate-50 to-base-100 px-4 py-3.5">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-800 text-white shadow-sm">
                    <ChatBubbleLeftRightIcon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold text-slate-900">Comments</h3>
                    <p className="truncate text-xs text-slate-500" title={activeName}>
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
              className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain bg-[linear-gradient(180deg,#f8fafc_0%,#ffffff_40%)] px-4 py-4"
            >
              {commentsLoading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
                  <span className="loading loading-spinner loading-sm" />
                  Loading comments…
                </div>
              ) : comments.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-white/80 px-4 py-10 text-center">
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                    <ChatBubbleLeftRightIcon className="h-6 w-6" />
                  </div>
                  <p className="text-sm font-medium text-slate-700">No comments yet</p>
                  <p className="mt-1 text-xs text-slate-500">
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
                            ? 'border-amber-400 bg-slate-900 text-white ring-2 ring-amber-300/60'
                            : 'border-amber-400 bg-white text-slate-800 ring-2 ring-amber-300/60'
                          : mine
                            ? 'border-slate-200 bg-slate-900 text-white'
                            : 'border-slate-200/80 bg-white text-slate-800'
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
                              ? 'bg-white/15 text-white'
                              : 'bg-slate-100 text-slate-700'
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
                                    mine ? 'text-white' : 'text-slate-900'
                                  }`}
                                >
                                  {c.created_by}
                                </div>
                                {sectionLabel != null ? (
                                  <span
                                    className={`badge badge-sm h-5 border-0 px-1.5 font-semibold ${
                                      mine
                                        ? 'bg-amber-400 text-amber-950'
                                        : 'bg-amber-500 text-white'
                                    }`}
                                  >
                                    §{sectionLabel}
                                    {c.highlight?.page != null ? ` · p.${c.highlight.page}` : ''}
                                  </span>
                                ) : null}
                              </div>
                              <div
                                className={`text-[11px] tabular-nums ${
                                  mine ? 'text-white/60' : 'text-slate-500'
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
                              mine ? 'text-white/90' : 'text-slate-700'
                            }`}
                          >
                            {c.body}
                          </p>
                          {sectionLabel != null ? (
                            <button
                              type="button"
                              className={`mt-2 text-xs font-medium underline-offset-2 hover:underline ${
                                mine ? 'text-amber-200' : 'text-amber-700'
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

            <div className="shrink-0 border-t border-base-200 bg-base-100 p-3">
              {draftHighlight ? (
                <div className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
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
              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-2 shadow-inner">
                <textarea
                  className="textarea textarea-ghost min-h-[4.5rem] w-full resize-none bg-transparent px-2 py-1.5 text-sm leading-relaxed focus:bg-white focus:outline-none"
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
                  <span className="text-[11px] text-slate-400">⌘/Ctrl + Enter to send</span>
                  <button
                    type="button"
                    className="btn btn-sm h-9 gap-1.5 rounded-full bg-slate-900 px-4 font-medium text-white hover:bg-slate-800"
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
};

export default DocumentViewerModal;
