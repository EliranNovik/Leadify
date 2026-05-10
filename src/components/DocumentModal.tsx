import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { 
  XMarkIcon, 
  EyeIcon, 
  ArrowDownTrayIcon, 
  DocumentIcon,
  PhotoIcon,
  DocumentTextIcon,
  ArchiveBoxIcon,
  ExclamationTriangleIcon,
  DocumentArrowUpIcon,
  PaperClipIcon,
  CheckCircleIcon,
  XCircleIcon,
  FilmIcon,
  MusicalNoteIcon,
  TableCellsIcon,
  PresentationChartBarIcon,
  CodeBracketIcon,
  EllipsisVerticalIcon,
  ShareIcon,
  SparklesIcon,
  TrashIcon,
  PencilSquareIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import {
  CASE_DOCUMENTS_STORAGE_BUCKET,
  CASE_DOCUMENTS_SIGNED_URL_SECONDS,
  buildCaseDocumentStoragePath,
} from '../lib/caseDocumentsStorage';
import { createPortal } from 'react-dom';
import { toast } from 'react-hot-toast';

type CaseDocumentAiSummaryStatus = 'pending' | 'ready' | 'failed' | 'skipped';

interface Document {
  id: string;
  name: string;
  size: number;
  lastModified: string;
  downloadUrl: string;
  webUrl: string;
  fileType: string;
  /** Where the document comes from. */
  source?: 'case' | 'subeffort';
  /** Storage object path inside `CASE_DOCUMENTS_STORAGE_BUCKET` when available. */
  storagePath?: string | null;
  /** DB id in `lead_case_documents` for case documents only. */
  caseDocDbId?: string | null;
  /** Row id in `lead_sub_efforts` for sub-efforts documents only. */
  subEffortRowId?: number | null;
  caseClassificationId?: string | null;
  caseClassificationLabel?: string | null;
  /** Resolved from `lead_case_documents.uploaded_by` + `users` / employee photo. */
  uploadedByName?: string | null;
  uploadedByPhotoUrl?: string | null;
  /** AI summary from `lead_case_documents.ai_summary` (edge function `case-document-summarize`). */
  aiSummary?: string | null;
  aiSummaryStatus?: CaseDocumentAiSummaryStatus | null;
  aiSummaryError?: string | null;
}

interface CaseClassificationRow {
  id: string;
  slug: string;
  label: string;
  sort_order?: number;
}

interface DocumentModalProps {
  isOpen: boolean;
  onClose: () => void;
  leadNumber: string;
  clientName: string;
  /** Optional: stable client id (`leads.id` for new; `legacy_123` for legacy). Enables attaching sub-efforts documents. */
  clientId?: string | null;
  onDocumentCountChange?: (count: number) => void;
  /** Logical folder key stored in `lead_case_documents.onedrive_subfolder` (e.g. ClientHeader bucket); omit for lead-root expert documents. */
  onedriveSubFolder?: string | null;
  modalTitle?: string;
  /** Shown under the lead line (optional UI hint). */
  folderPathHint?: string | null;
  /** When true, uploads use the active category tab; mapping is stored in `lead_case_documents`. */
  requireCaseDocumentClassification?: boolean;
  /** After opening, select the classification tab matching this slug (e.g. `contract`). Requires `requireCaseDocumentClassification`. */
  initialClassificationSlug?: string | null;
}

function copyTextToClipboardFallback(text: string): boolean {
  if (typeof document === 'undefined') return false;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(ta);
  }
}

/** Uses Web Share API (system share on mobile + many desktop browsers); otherwise copies link. */
async function shareDocumentFile(doc: Document): Promise<void> {
  const url = (doc.webUrl || doc.downloadUrl || '').trim();
  if (!url) {
    toast.error('No link is available to share for this file.');
    return;
  }

  const shareData: ShareData = {
    title: doc.name,
    text: doc.name,
    url,
  };

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    const canTry =
      typeof navigator.canShare !== 'function' || navigator.canShare(shareData);
    if (canTry) {
      try {
        await navigator.share(shareData);
        return;
      } catch (err: unknown) {
        const aborted =
          err instanceof DOMException
            ? err.name === 'AbortError'
            : (err as { name?: string })?.name === 'AbortError';
        if (aborted) return;
      }
    }
  }

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied to clipboard');
      return;
    } catch {
      /* fall through */
    }
  }

  if (copyTextToClipboardFallback(url)) {
    toast.success('Link copied to clipboard');
    return;
  }

  toast.error('Sharing is not available in this browser.');
}

async function shareDocumentSummary(doc: Document): Promise<void> {
  const title = doc.name?.trim() || 'Document';
  const summary = doc.aiSummary?.trim() || '';
  if (!summary) {
    toast.error('No AI summary is available to share.');
    return;
  }

  const text = `${title}\n\n${summary}`;

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    const shareData: ShareData = { title, text };
    const canTry = typeof navigator.canShare !== 'function' || navigator.canShare(shareData);
    if (canTry) {
      try {
        await navigator.share(shareData);
        return;
      } catch (err: unknown) {
        const aborted =
          err instanceof DOMException
            ? err.name === 'AbortError'
            : (err as { name?: string })?.name === 'AbortError';
        if (aborted) return;
      }
    }
  }

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Summary copied to clipboard');
      return;
    } catch {
      /* fall through */
    }
  }

  if (copyTextToClipboardFallback(text)) {
    toast.success('Summary copied to clipboard');
    return;
  }

  toast.error('Sharing is not available in this browser.');
}

/** Same stack as other AI features (`ai-lead-summary`, `chat`): OpenAI via Supabase Edge + `OPENAI_API_KEY`. */
async function requestCaseDocumentSummarize(documentId: string, opts?: { force?: boolean }) {
  try {
    const { error } = await supabase.functions.invoke('case-document-summarize', {
      body: { documentId, ...(opts?.force ? { force: true } : {}) },
    });
    if (error) console.warn('case-document-summarize:', error.message);
  } catch (e) {
    console.warn('case-document-summarize:', e);
  }
}

type DocumentRowActionMenuProps = {
  doc: Document;
  isDownloading: boolean;
  isDeleting: boolean;
  onPreview: (d: Document) => void;
  onDownload: (d: Document) => void;
  onDelete: (d: Document) => void;
};

function DocumentRowActionMenu({
  doc,
  isDownloading,
  isDeleting,
  onPreview,
  onDownload,
  onDelete,
}: DocumentRowActionMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onPointerDown = (e: PointerEvent) => {
      const el = rootRef.current;
      if (!el || el.contains(e.target as Node)) return;
      close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const iconBtnClassMobile =
    'flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-md text-base-content/55 transition-colors hover:bg-base-300/45 hover:text-base-content focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50';

  const iconBtnClassDesktop =
    'flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md text-white transition-colors hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-45';

  return (
    <div
      ref={rootRef}
      className="relative shrink-0 self-center md:self-stretch md:flex md:items-center"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Desktop: dark action strip — view / share / download / delete */}
      <div
        className="hidden h-full min-h-[2.75rem] shrink-0 items-center rounded-lg bg-gray-700 px-1 shadow-inner md:flex dark:bg-gray-900"
        role="group"
        aria-label={`Actions for ${doc.name}`}
      >
        <button
          type="button"
          className={iconBtnClassDesktop}
          title="View"
          aria-label={`View ${doc.name}`}
          onClick={() => onPreview(doc)}
        >
          <EyeIcon className="h-5 w-5 text-white" aria-hidden />
        </button>
        <div className="mx-px w-px shrink-0 self-stretch bg-white/20" aria-hidden />
        <button
          type="button"
          className={iconBtnClassDesktop}
          title="Share"
          aria-label={`Share ${doc.name}`}
          onClick={() => void shareDocumentFile(doc)}
        >
          <ShareIcon className="h-5 w-5 text-white" aria-hidden />
        </button>
        <div className="mx-px w-px shrink-0 self-stretch bg-white/20" aria-hidden />
        <button
          type="button"
          className={iconBtnClassDesktop}
          title="Download"
          aria-label={`Download ${doc.name}`}
          disabled={isDownloading}
          onClick={() => void onDownload(doc)}
        >
          {isDownloading ? (
            <span className="loading loading-spinner loading-sm text-white" />
          ) : (
            <ArrowDownTrayIcon className="h-5 w-5 text-white" aria-hidden />
          )}
        </button>
        <div className="mx-px w-px shrink-0 self-stretch bg-white/20" aria-hidden />
        <button
          type="button"
          className={iconBtnClassDesktop}
          title="Delete"
          aria-label={`Delete ${doc.name}`}
          disabled={isDeleting}
          onClick={() => void onDelete(doc)}
        >
          {isDeleting ? (
            <span className="loading loading-spinner loading-sm text-white" />
          ) : (
            <TrashIcon className="h-5 w-5 text-white" aria-hidden />
          )}
        </button>
      </div>

      {/* Mobile: kebab + dropdown */}
      <div className="md:hidden">
        <button
          type="button"
          className={iconBtnClassMobile}
          aria-label={`Actions for ${doc.name}`}
          title="Actions"
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={() => setOpen((o) => !o)}
        >
          <EllipsisVerticalIcon className="h-6 w-6" aria-hidden />
        </button>
        {open ? (
          <ul
            className="menu absolute right-0 top-full z-[1100] mt-1.5 min-w-[10.5rem] rounded-box border border-base-300 bg-base-100 p-2 shadow-lg"
            role="menu"
          >
            <li>
              <button
                type="button"
                className="flex w-full items-center gap-2 text-sm"
                role="menuitem"
                onClick={(e) => {
                  e.preventDefault();
                  setOpen(false);
                  onPreview(doc);
                }}
              >
                <EyeIcon className="h-4 w-4 shrink-0" />
                View
              </button>
            </li>
            <li>
              <button
                type="button"
                className="flex w-full items-center gap-2 text-sm"
                role="menuitem"
                onClick={(e) => {
                  e.preventDefault();
                  setOpen(false);
                  void shareDocumentFile(doc);
                }}
              >
                <ShareIcon className="h-4 w-4 shrink-0" />
                Share
              </button>
            </li>
            <li>
              <button
                type="button"
                className="flex w-full items-center gap-2 text-sm"
                role="menuitem"
                disabled={isDownloading}
                onClick={(e) => {
                  e.preventDefault();
                  setOpen(false);
                  void onDownload(doc);
                }}
              >
                {isDownloading ? (
                  <span className="loading loading-spinner loading-xs" />
                ) : (
                  <ArrowDownTrayIcon className="h-4 w-4 shrink-0" />
                )}
                Download
              </button>
            </li>
            <li>
              <button
                type="button"
                className="flex w-full items-center gap-2 text-sm text-error"
                role="menuitem"
                disabled={isDeleting}
                onClick={(e) => {
                  e.preventDefault();
                  setOpen(false);
                  void onDelete(doc);
                }}
              >
                {isDeleting ? (
                  <span className="loading loading-spinner loading-xs" />
                ) : (
                  <TrashIcon className="h-4 w-4 shrink-0" />
                )}
                {isDeleting ? 'Deleting…' : 'Delete'}
              </button>
            </li>
          </ul>
        ) : null}
      </div>
    </div>
  );
}

interface UploadedFile {
  name: string;
  status: 'uploading' | 'success' | 'error';
  progress?: number;
  error?: string;
}

type DocumentFileKind =
  | 'pdf'
  | 'word'
  | 'excel'
  | 'powerpoint'
  | 'image'
  | 'video'
  | 'audio'
  | 'archive'
  | 'text'
  | 'code'
  | 'generic';

function inferDocumentFileKind(fileType: string, fileName: string): DocumentFileKind {
  const mime = (fileType || '').toLowerCase();
  const lowerName = fileName.toLowerCase();
  const ext = lowerName.includes('.') ? lowerName.slice(lowerName.lastIndexOf('.')) : '';

  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.includes('pdf') || ext === '.pdf') return 'pdf';
  if (
    mime.includes('wordprocessingml') ||
    mime.includes('msword') ||
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ['.doc', '.docx', '.docm', '.odt'].includes(ext)
  ) {
    return 'word';
  }
  if (
    mime.includes('spreadsheetml') ||
    mime.includes('ms-excel') ||
    mime.includes('csv') ||
    ['.xls', '.xlsx', '.xlsm', '.csv', '.ods'].includes(ext)
  ) {
    return 'excel';
  }
  if (
    mime.includes('presentationml') ||
    mime.includes('powerpoint') ||
    ['.ppt', '.pptx', '.pptm', '.odp'].includes(ext)
  ) {
    return 'powerpoint';
  }
  if (
    mime.includes('zip') ||
    mime.includes('rar') ||
    mime.includes('x-7z') ||
    mime.includes('compressed') ||
    ['.zip', '.rar', '.7z', '.tar', '.gz', '.tgz'].includes(ext)
  ) {
    return 'archive';
  }
  if (mime.startsWith('text/') || ['.txt', '.md', '.rtf', '.log'].includes(ext)) return 'text';
  if (
    [
      '.js',
      '.ts',
      '.tsx',
      '.jsx',
      '.json',
      '.html',
      '.htm',
      '.css',
      '.xml',
      '.py',
      '.java',
      '.c',
      '.cpp',
      '.go',
      '.rb',
      '.php',
      '.sql',
      '.yml',
      '.yaml',
    ].includes(ext)
  ) {
    return 'code';
  }
  if (mime.includes('json')) return 'code';
  return 'generic';
}

function employeePhotoFromUserRow(row: {
  tenants_employee?: { photo_url?: string | null } | { photo_url?: string | null }[] | null;
}): string | null {
  const emp = row.tenants_employee;
  const e = Array.isArray(emp) ? emp[0] : emp;
  const url = e?.photo_url;
  return typeof url === 'string' && url.trim() ? url.trim() : null;
}

function displayNameFromUserRow(row: {
  full_name?: string | null;
  email?: string | null;
}): string {
  const fn = row.full_name?.trim();
  if (fn) return fn;
  const em = row.email?.trim();
  if (em) return em;
  return 'Unknown';
}

/** Map `lead_case_documents.uploaded_by` text → display name + photo (matches full_name or email). */
async function resolveUploaderDisplayByKey(
  keys: string[],
): Promise<Map<string, { name: string; photoUrl: string | null }>> {
  const out = new Map<string, { name: string; photoUrl: string | null }>();
  const unique = [...new Set(keys.map((k) => k.trim()).filter(Boolean))];
  if (unique.length === 0) return out;

  const userSelect = 'full_name, email, tenants_employee!users_employee_id_fkey(photo_url)';

  const { data: byFullName, error: errName } = await supabase
    .from('users')
    .select(userSelect)
    .in('full_name', unique);
  if (errName) console.warn('resolveUploaderDisplayByName:', errName);

  for (const row of (byFullName || []) as {
    full_name?: string | null;
    email?: string | null;
    tenants_employee?: { photo_url?: string | null } | { photo_url?: string | null }[] | null;
  }[]) {
    const fn = row.full_name?.trim();
    if (fn && unique.includes(fn)) {
      out.set(fn, { name: displayNameFromUserRow(row), photoUrl: employeePhotoFromUserRow(row) });
    }
  }

  const needEmail = unique.filter((k) => !out.has(k));
  if (needEmail.length === 0) return out;

  const { data: byEmail, error: errEmail } = await supabase
    .from('users')
    .select(userSelect)
    .in('email', needEmail);
  if (errEmail) console.warn('resolveUploaderDisplayByEmail:', errEmail);

  for (const row of (byEmail || []) as {
    full_name?: string | null;
    email?: string | null;
    tenants_employee?: { photo_url?: string | null } | { photo_url?: string | null }[] | null;
  }[]) {
    const em = row.email?.trim();
    if (!em) continue;
    for (const key of needEmail) {
      if (key === em) {
        out.set(key, { name: displayNameFromUserRow(row), photoUrl: employeePhotoFromUserRow(row) });
      }
    }
  }

  for (const k of unique) {
    if (!out.has(k)) {
      out.set(k, { name: k, photoUrl: null });
    }
  }
  return out;
}

/** Same idea as Assigned Team / ClientHeader — first + last initial, or first two letters. */
function initialsFromUploaderName(name: string): string {
  const t = name.trim();
  if (!t) return '?';
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const a = parts[0][0];
    const b = parts[parts.length - 1][0];
    if (a && b) return (a + b).toUpperCase();
  }
  return t.slice(0, 2).toUpperCase();
}

function DocumentUploaderAttribution({ doc }: { doc: Document }) {
  const name = doc.uploadedByName?.trim();
  const [photoFailed, setPhotoFailed] = useState(false);
  const photoUrl = typeof doc.uploadedByPhotoUrl === 'string' ? doc.uploadedByPhotoUrl.trim() : '';

  useEffect(() => {
    setPhotoFailed(false);
  }, [doc.id, photoUrl]);

  if (!name) return null;

  const initials = initialsFromUploaderName(name);
  const showPhoto = photoUrl.length > 0 && !photoFailed;

  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-1.5 text-sm text-base-content/65">
      {showPhoto ? (
        <img
          src={photoUrl}
          alt=""
          className="h-6 w-6 shrink-0 rounded-full object-cover outline-none"
          loading="lazy"
          onError={() => setPhotoFailed(true)}
        />
      ) : (
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-200 text-[10px] font-semibold leading-none text-gray-700 outline-none dark:bg-gray-600 dark:text-gray-100"
          aria-hidden
        >
          {initials}
        </span>
      )}
      <span className="min-w-0 truncate sm:max-w-[12rem]">
        by <span className="font-semibold text-base-content/85">{name}</span>
      </span>
    </span>
  );
}

function DocumentFileGlyph({ fileType, fileName }: { fileType: string; fileName: string }) {
  const kind = inferDocumentFileKind(fileType, fileName);
  const cn = 'h-11 w-11 shrink-0 sm:h-12 sm:w-12';

  switch (kind) {
    case 'pdf':
      return <DocumentTextIcon className={`${cn} text-red-600 dark:text-red-400`} aria-hidden />;
    case 'word':
      return <DocumentIcon className={`${cn} text-blue-700 dark:text-blue-400`} aria-hidden />;
    case 'excel':
      return <TableCellsIcon className={`${cn} text-emerald-700 dark:text-emerald-400`} aria-hidden />;
    case 'powerpoint':
      return <PresentationChartBarIcon className={`${cn} text-orange-600 dark:text-orange-400`} aria-hidden />;
    case 'image':
      return <DocumentIcon className={`${cn} text-violet-600 dark:text-violet-400`} aria-hidden />;
    case 'video':
      return <FilmIcon className={`${cn} text-fuchsia-700 dark:text-fuchsia-400`} aria-hidden />;
    case 'audio':
      return <MusicalNoteIcon className={`${cn} text-indigo-600 dark:text-indigo-400`} aria-hidden />;
    case 'archive':
      return <ArchiveBoxIcon className={`${cn} text-amber-800 dark:text-amber-500`} aria-hidden />;
    case 'text':
      return <DocumentTextIcon className={`${cn} text-slate-600 dark:text-slate-400`} aria-hidden />;
    case 'code':
      return <CodeBracketIcon className={`${cn} text-cyan-700 dark:text-cyan-400`} aria-hidden />;
    default:
      return <DocumentIcon className={`${cn} text-gray-500 dark:text-gray-400`} aria-hidden />;
  }
}

const DocumentModal: React.FC<DocumentModalProps> = ({
  isOpen,
  onClose,
  leadNumber,
  clientName,
  clientId = null,
  onDocumentCountChange,
  onedriveSubFolder = null,
  modalTitle,
  folderPathHint = null,
  requireCaseDocumentClassification = false,
  initialClassificationSlug = null,
}) => {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Gallery index when lightbox open; all uploaded rows in `documents` are in the filmstrip. */
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [summaryModalDoc, setSummaryModalDoc] = useState<Document | null>(null);
  const [isEditingSummary, setIsEditingSummary] = useState(false);
  const [editedSummaryText, setEditedSummaryText] = useState('');
  const [isSavingSummary, setIsSavingSummary] = useState(false);

  useEffect(() => {
    if (!summaryModalDoc) {
      setIsEditingSummary(false);
      setEditedSummaryText('');
      setIsSavingSummary(false);
      return;
    }
    setIsEditingSummary(false);
    setEditedSummaryText(summaryModalDoc.aiSummary ?? '');
    setIsSavingSummary(false);
  }, [summaryModalDoc]);

  const canEditSummary = !!summaryModalDoc?.caseDocDbId;

  const saveEditedSummary = async (opts?: { clear?: boolean }) => {
    if (!summaryModalDoc?.caseDocDbId) return;
    if (isSavingSummary) return;
    setIsSavingSummary(true);
    try {
      const next = opts?.clear ? '' : editedSummaryText;
      const { error } = await supabase
        .from('lead_case_documents')
        .update({
          ai_summary: next,
          ai_summary_status: next.trim() ? 'ready' : 'skipped',
          ai_summary_error: null,
          ai_summary_at: new Date().toISOString(),
        })
        .eq('id', summaryModalDoc.caseDocDbId);

      if (error) throw error;

      setSummaryModalDoc((prev) =>
        prev
          ? {
              ...prev,
              aiSummary: next,
              aiSummaryStatus: next.trim() ? 'ready' : 'skipped',
              aiSummaryError: null,
            }
          : prev,
      );
      setDocuments((prev) =>
        prev.map((d) =>
          d.id === summaryModalDoc.id
            ? {
                ...d,
                aiSummary: next,
                aiSummaryStatus: next.trim() ? 'ready' : 'skipped',
                aiSummaryError: null,
              }
            : d,
        ),
      );

      setIsEditingSummary(false);
      toast.success(opts?.clear ? 'Summary deleted' : 'Summary saved');
    } catch (e: any) {
      toast.error(e?.message ? String(e.message) : 'Failed to save summary');
    } finally {
      setIsSavingSummary(false);
    }
  };
  const documentsRef = useRef<Document[]>([]);
  const [downloading, setDownloading] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<string[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [classifications, setClassifications] = useState<CaseClassificationRow[]>([]);
  const [classificationsLoading, setClassificationsLoading] = useState(false);
  const [classificationsError, setClassificationsError] = useState<string | null>(null);
  /** Latest classifications for classification labels in fetch (avoids extra DB round-trip when already loaded). */
  const classificationsRef = useRef<CaseClassificationRow[]>([]);
  /** Which category tab is selected when browsing the document list (case documents only). */
  const [activeBrowseCategoryId, setActiveBrowseCategoryId] = useState<string | null>(null);
  const lastBrowseLeadRef = useRef<string | null>(null);
  /** Avoid re-running browse sync when `classifications` is only a new array instance with the same ids. */
  const lastClassificationIdsKeyRef = useRef<string>('');
  /** Set when the modal opens; consumed once after classifications resolve to pick a tab (`initialClassificationSlug`). */
  const initialClassificationSlugToApplyRef = useRef<string | null>(null);

  // Fetch documents when modal opens
  useEffect(() => {
    if (isOpen && leadNumber) {
      fetchDocuments();
    }
  }, [isOpen, leadNumber, onedriveSubFolder]);

  useEffect(() => {
    if (!isOpen) {
      setSummaryModalDoc(null);
      setPreviewIndex(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !requireCaseDocumentClassification) {
      return;
    }
    let cancelled = false;
    setClassificationsLoading(true);
    setClassificationsError(null);
    void (async () => {
      const { data, error: qErr } = await supabase
        .from('case_document_classifications')
        .select('id, slug, label, sort_order')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });
      if (cancelled) return;
      setClassificationsLoading(false);
      if (qErr) {
        console.error('case_document_classifications:', qErr);
        setClassificationsError(qErr.message);
        setClassifications([]);
        return;
      }
      setClassifications((data as CaseClassificationRow[]) || []);
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, requireCaseDocumentClassification]);

  useEffect(() => {
    classificationsRef.current = classifications;
  }, [classifications]);

  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);

  const previewDocument =
    previewIndex !== null && documents[previewIndex] != null ? documents[previewIndex] : null;

  useEffect(() => {
    if (previewIndex === null) return;
    if (documents.length === 0) {
      setPreviewIndex(null);
      return;
    }
    if (previewIndex >= documents.length) {
      setPreviewIndex(documents.length - 1);
    }
  }, [documents.length, previewIndex]);

  const previewGoPrev = useCallback(() => {
    setPreviewIndex((i) => {
      if (i === null) return null;
      const len = documentsRef.current.length;
      if (len === 0) return null;
      return (i - 1 + len) % len;
    });
  }, []);

  const previewGoNext = useCallback(() => {
    setPreviewIndex((i) => {
      if (i === null) return null;
      const len = documentsRef.current.length;
      if (len === 0) return null;
      return (i + 1) % len;
    });
  }, []);

  /** Avoid re-running when `documents` is refreshed (poll) but the same file is still selected. */
  const previewActiveId =
    previewIndex !== null && documents[previewIndex] != null ? String(documents[previewIndex].id) : null;

  useEffect(() => {
    if (previewIndex === null || !previewActiveId) return;
    const id = `doc-preview-thumb-${previewActiveId}`;
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    });
  }, [previewIndex, previewActiveId]);

  /** Horizontal swipe / trackpad only; cooldown prevents rapid cycling. Vertical wheel scrolls the image area. */
  const lastPreviewWheelNavRef = useRef(0);
  const handlePreviewStageWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      if (!previewDocument?.fileType.includes('image/')) return;
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      if (Math.abs(e.deltaX) < 12) return;
      const now = Date.now();
      if (now - lastPreviewWheelNavRef.current < 400) return;
      lastPreviewWheelNavRef.current = now;
      e.preventDefault();
      e.stopPropagation();
      if (e.deltaX > 0) previewGoNext();
      else previewGoPrev();
    },
    [previewDocument, previewGoNext, previewGoPrev],
  );

  useEffect(() => {
    if (previewIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPreviewIndex(null);
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        previewGoPrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        previewGoNext();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previewIndex, previewGoPrev, previewGoNext]);

  /** Refresh AI summary fields for pending rows while the documents tray is open (not only when the summary dialog is open). */
  useEffect(() => {
    if (!isOpen) return;

    const validAi: CaseDocumentAiSummaryStatus[] = ['pending', 'ready', 'failed', 'skipped'];

    const tick = async () => {
      const pendingIds = documentsRef.current
        .filter((d) => d.aiSummaryStatus === 'pending')
        .map((d) => d.id);
      if (pendingIds.length === 0) return;

      const { data, error: qErr } = await supabase
        .from('lead_case_documents')
        .select('id, ai_summary, ai_summary_status, ai_summary_error')
        .in('id', pendingIds);

      if (qErr) {
        console.warn('AI summary poll:', qErr.message);
        return;
      }
      const rows = (data ?? []) as {
        id: string;
        ai_summary: string | null;
        ai_summary_status: string | null;
        ai_summary_error: string | null;
      }[];

      const updates = new Map<
        string,
        { aiSummary: string | null; aiSummaryStatus: CaseDocumentAiSummaryStatus; aiSummaryError: string | null }
      >();

      for (const row of rows) {
        const stRaw =
          typeof row.ai_summary_status === 'string' ? row.ai_summary_status.trim().toLowerCase() : '';
        const st = (stRaw as CaseDocumentAiSummaryStatus) || null;
        if (!st || !validAi.includes(st) || st === 'pending') continue;
        updates.set(row.id, {
          aiSummary: row.ai_summary ?? null,
          aiSummaryStatus: st,
          aiSummaryError: row.ai_summary_error ?? null,
        });
      }

      if (updates.size === 0) return;

      setDocuments((prev) =>
        prev.map((d) => {
          const u = updates.get(d.id);
          return u ? { ...d, ...u } : d;
        }),
      );

      setSummaryModalDoc((prev) => {
        if (!prev) return prev;
        const u = updates.get(prev.id);
        return u ? { ...prev, ...u } : prev;
      });
    };

    void tick();
    const interval = window.setInterval(() => void tick(), 2500);
    return () => window.clearInterval(interval);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !initialClassificationSlug?.trim()) {
      initialClassificationSlugToApplyRef.current = null;
      return;
    }
    initialClassificationSlugToApplyRef.current = initialClassificationSlug.trim();
  }, [isOpen, initialClassificationSlug]);

  useEffect(() => {
    if (!requireCaseDocumentClassification || !isOpen) return;
    if (classifications.length === 0) return;

    const tryApplyInitialSlug = (): boolean => {
      const slug = initialClassificationSlugToApplyRef.current?.trim();
      if (!slug) return false;
      const match = classifications.find((c) => c.slug === slug);
      if (match) {
        setActiveBrowseCategoryId(match.id);
        initialClassificationSlugToApplyRef.current = null;
        return true;
      }
      return false;
    };

    const idsKey = [...classifications.map((c) => c.id)].sort().join('|');

    if (lastBrowseLeadRef.current !== leadNumber) {
      lastBrowseLeadRef.current = leadNumber;
      lastClassificationIdsKeyRef.current = idsKey;
      if (!tryApplyInitialSlug()) {
        setActiveBrowseCategoryId(classifications[0].id);
      }
      return;
    }

    if (tryApplyInitialSlug()) return;

    if (lastClassificationIdsKeyRef.current === idsKey) return;
    lastClassificationIdsKeyRef.current = idsKey;

    setActiveBrowseCategoryId((prev) => {
      if (prev && classifications.some((c) => c.id === prev)) return prev;
      return classifications[0].id;
    });
  }, [isOpen, leadNumber, classifications, requireCaseDocumentClassification]);

  useEffect(() => {
    // Only update count when modal is open and documents have been loaded
    // This prevents resetting the count to 0 when modal is closed or during initial state
    if (onDocumentCountChange && isOpen && !loading) {
      onDocumentCountChange(documents.length);
    }
  }, [documents, onDocumentCountChange, loading, isOpen]);

  const documentsInActiveCategory = useMemo(() => {
    if (!requireCaseDocumentClassification || activeBrowseCategoryId === null) {
      return documents;
    }
    return documents.filter((d) => d.caseClassificationId === activeBrowseCategoryId);
  }, [documents, requireCaseDocumentClassification, activeBrowseCategoryId]);

  const caseUploadBlocked = useMemo(
    () =>
      requireCaseDocumentClassification &&
      (classificationsLoading || !!classificationsError || classifications.length === 0),
    [
      requireCaseDocumentClassification,
      classificationsLoading,
      classificationsError,
      classifications.length,
    ],
  );

  /** Active tab’s classification for uploads (not available on Uncategorized). */
  const uploadClassificationId = useMemo(() => {
    if (
      !requireCaseDocumentClassification ||
      !activeBrowseCategoryId
    ) {
      return null;
    }
    return activeBrowseCategoryId;
  }, [requireCaseDocumentClassification, activeBrowseCategoryId]);

  const fetchDocuments = async () => {
    setLoading(true);
    setError(null);
    try {
      const subKey = onedriveSubFolder?.trim() ? onedriveSubFolder.trim() : null;

      let query = supabase
        .from('lead_case_documents')
        .select(
          'id, storage_path, file_name, file_size, mime_type, classification_id, uploaded_by, created_at, ai_summary, ai_summary_status, ai_summary_error',
        )
        .eq('lead_number', leadNumber)
        .not('storage_path', 'is', null);

      if (subKey) query = query.eq('onedrive_subfolder', subKey);
      else query = query.is('onedrive_subfolder', null);

      const { data: rows, error: qErr } = await query.order('created_at', { ascending: false });

      if (qErr) {
        console.error('lead_case_documents fetch:', qErr);
        setError(`Failed to fetch documents: ${qErr.message}`);
        return;
      }

      const list = (rows ?? []) as {
        id: string;
        storage_path: string;
        file_name: string;
        file_size: number | null;
        mime_type: string | null;
        classification_id: string | null;
        uploaded_by: string | null;
        created_at: string;
        ai_summary: string | null;
        ai_summary_status: string | null;
        ai_summary_error: string | null;
      }[];

      let idToLabel = new Map<string, string>(classificationsRef.current.map((c) => [c.id, c.label]));
      if (idToLabel.size === 0) {
        const { data: catRows } = await supabase.from('case_document_classifications').select('id, label');
        idToLabel = new Map<string, string>(
          (catRows || []).map((c: { id: string; label: string }) => [c.id, c.label]),
        );
      }

      const uploaderKeys = [...new Set(list.map((r) => r.uploaded_by?.trim()).filter(Boolean))] as string[];
      const uploaderMap = await resolveUploaderDisplayByKey(uploaderKeys);

      const mappedDocuments: Document[] = await Promise.all(
        list.map(async (r) => {
          const { data: signed, error: signErr } = await supabase.storage
            .from(CASE_DOCUMENTS_STORAGE_BUCKET)
            .createSignedUrl(r.storage_path, CASE_DOCUMENTS_SIGNED_URL_SECONDS);

          if (signErr) {
            console.warn('createSignedUrl:', signErr.message, r.storage_path);
          }

          const url = signed?.signedUrl?.trim() || '';
          const cid = r.classification_id;
          const rawUploader = r.uploaded_by?.trim() || null;
          const resolved = rawUploader ? uploaderMap.get(rawUploader) : undefined;
          const mime =
            r.mime_type?.trim() ||
            (r.file_name.match(/\.([^.]+)$/)?.[1]?.toLowerCase() === 'pdf'
              ? 'application/pdf'
              : 'application/octet-stream');

          const validAi: CaseDocumentAiSummaryStatus[] = ['pending', 'ready', 'failed', 'skipped'];
          const aiStRaw = typeof r.ai_summary_status === 'string' ? r.ai_summary_status.trim().toLowerCase() : '';
          const aiSt = (aiStRaw as CaseDocumentAiSummaryStatus) || null;
          return {
            id: r.id,
            name: r.file_name,
            size: typeof r.file_size === 'number' && Number.isFinite(r.file_size) ? Number(r.file_size) : 0,
            lastModified: r.created_at || new Date().toISOString(),
            downloadUrl: url,
            webUrl: url,
            fileType: mime,
            source: 'case',
            storagePath: r.storage_path,
            caseDocDbId: r.id,
            subEffortRowId: null,
            caseClassificationId: cid ?? null,
            caseClassificationLabel: cid ? idToLabel.get(cid) ?? null : null,
            uploadedByName: resolved?.name ?? rawUploader ?? null,
            uploadedByPhotoUrl: resolved?.photoUrl ?? null,
            aiSummary: r.ai_summary ?? null,
            aiSummaryStatus: aiSt && validAi.includes(aiSt) ? aiSt : null,
            aiSummaryError: r.ai_summary_error ?? null,
          };
        }),
      );

      // Also include sub-efforts uploaded documents under the mapped category tab (when enabled + configured).
      const subEffortDocuments: Document[] = [];
      if (requireCaseDocumentClassification) {
        // Resolve lead id (needed for lead_sub_efforts). Prefer caller-provided clientId.
        let newLeadId: string | null = null;
        let legacyLeadId: number | null = null;
        const rawClientId = String(clientId ?? '').trim();
        if (rawClientId) {
          if (rawClientId.startsWith('legacy_')) {
            const n = Number.parseInt(rawClientId.replace('legacy_', ''), 10);
            legacyLeadId = Number.isFinite(n) ? n : null;
          } else {
            newLeadId = rawClientId;
          }
        } else if (leadNumber?.trim()) {
          const { data: leadRow } = await supabase
            .from('leads')
            .select('id')
            .eq('lead_number', leadNumber.trim())
            .maybeSingle();
          const id = (leadRow as { id?: string } | null)?.id;
          if (typeof id === 'string' && id.trim()) newLeadId = id.trim();
        }

        if (newLeadId || legacyLeadId) {
          let q = supabase
            .from('lead_sub_efforts')
            .select(
              `id, created_at, created_by, document_url,
               sub_efforts ( id, name, case_document_classification_id ),
               tenants_employee ( id, display_name, photo_url )`,
            )
            .order('created_at', { ascending: false })
            .limit(50);

          if (legacyLeadId) q = q.eq('legacy_lead_id', legacyLeadId);
          else if (newLeadId) q = q.eq('new_lead_id', newLeadId);

          const { data: seRows, error: seErr } = await q;
          if (seErr) {
            console.warn('lead_sub_efforts fetch:', seErr.message);
          } else {
            const normalizeDocItems = (
              raw: unknown,
            ): { path?: string; url?: string; name?: string; mimeType?: string }[] => {
              if (!raw) return [];
              if (Array.isArray(raw)) return raw as any[];
              if (typeof raw === 'string') {
                try {
                  const parsed = JSON.parse(raw);
                  if (Array.isArray(parsed)) return parsed as any[];
                } catch {
                  /* ignore */
                }
                return [{ url: raw }];
              }
              if (typeof raw === 'object') return [raw as any];
              return [];
            };

            const inferMime = (name: string, fallback?: string | null) => {
              const t = (fallback || '').trim();
              if (t) return t;
              const ext = name.split('.').pop()?.toLowerCase() || '';
              if (ext === 'pdf') return 'application/pdf';
              if (ext === 'png') return 'image/png';
              if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
              if (ext === 'gif') return 'image/gif';
              if (ext === 'webp') return 'image/webp';
              return 'application/octet-stream';
            };

            for (const r of (seRows || []) as any[]) {
              const categoryId = r?.sub_efforts?.case_document_classification_id ?? null;
              if (!categoryId) continue; // only show when mapped to a category
              const who = r?.tenants_employee?.display_name ?? r?.created_by ?? null;
              const photo = r?.tenants_employee?.photo_url ?? null;
              const createdAt = r?.created_at ?? new Date().toISOString();
              const items = normalizeDocItems(r?.document_url);
              for (const it of items) {
                const path = (it as any)?.path as string | undefined;
                const url = (it as any)?.url as string | undefined;
                const name =
                  ((it as any)?.name as string | undefined)?.trim() ||
                  (path ? path.split('/').pop() : url ? url.split('/').pop() : '') ||
                  'Document';
                const mime = inferMime(name, (it as any)?.mimeType as string | null | undefined);

                let signedUrl = '';
                if (path && typeof path === 'string') {
                  const { data: signed } = await supabase.storage
                    .from(CASE_DOCUMENTS_STORAGE_BUCKET)
                    .createSignedUrl(path, CASE_DOCUMENTS_SIGNED_URL_SECONDS);
                  signedUrl = signed?.signedUrl?.trim() || '';
                } else if (url && typeof url === 'string') {
                  signedUrl = url.trim();
                }
                if (!signedUrl) continue;

                subEffortDocuments.push({
                  id: `subeffort:${String(r?.id ?? '')}:${path || signedUrl}`,
                  name,
                  size: 0,
                  lastModified: createdAt,
                  downloadUrl: signedUrl,
                  webUrl: signedUrl,
                  fileType: mime,
                  source: 'subeffort',
                  storagePath: path || null,
                  caseDocDbId: null,
                  subEffortRowId: Number.isFinite(Number(r?.id)) ? Number(r?.id) : null,
                  caseClassificationId: categoryId,
                  caseClassificationLabel: idToLabel.get(categoryId) ?? null,
                  uploadedByName: who ? String(who) : null,
                  uploadedByPhotoUrl: photo ? String(photo) : null,
                  aiSummary: null,
                  aiSummaryStatus: null,
                  aiSummaryError: null,
                });
              }
            }
          }
        }
      }

      setDocuments([...subEffortDocuments, ...mappedDocuments]);
    } catch (err) {
      console.error('Error fetching documents:', err);
      setError(`Failed to fetch documents: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (document: Document) => {
    if (downloading.includes(document.id)) return;
    
    setDownloading(prev => [...prev, document.id]);
    try {
      const response = await fetch(document.downloadUrl);
      if (!response.ok) throw new Error('Download failed');
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = window.document.createElement('a');
      link.href = url;
      link.download = document.name;
      window.document.body.appendChild(link);
      link.click();
      window.document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download error:', err);
      alert('Download failed. Please try again.');
    } finally {
      setDownloading(prev => prev.filter(id => id !== document.id));
    }
  };

  const handleDownloadAll = async () => {
    const toDownload = requireCaseDocumentClassification ? documentsInActiveCategory : documents;
    if (toDownload.length === 0) return;

    setDownloading(prev => [...prev, 'all']);
    try {
      for (const doc of toDownload) {
        await handleDownload(doc);
        // Small delay between downloads to avoid overwhelming the browser
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch (err) {
      console.error('Bulk download error:', err);
    } finally {
      setDownloading(prev => prev.filter(id => id !== 'all'));
    }
  };

  const handlePreview = (document: Document) => {
    const idx = documents.findIndex((d) => d.id === document.id);
    if (idx < 0) return;
    setPreviewIndex(idx);
  };

  const handleDeleteDocument = async (doc: Document) => {
    if (deleting.includes(doc.id)) return;
    const ok = window.confirm(`Delete "${doc.name}"? This cannot be undone.`);
    if (!ok) return;

    setDeleting((prev) => [...prev, doc.id]);
    try {
      setSummaryModalDoc((prev) => (prev?.id === doc.id ? null : prev));
      setPreviewIndex((prevIdx) => {
        if (prevIdx === null) return null;
        return documents[prevIdx]?.id === doc.id ? null : prevIdx;
      });

      if (doc.source === 'subeffort') {
        const rowId = doc.subEffortRowId;
        const path = doc.storagePath?.trim() || '';
        if (!rowId || !path) {
          throw new Error('This sub-effort document cannot be deleted (missing storage path).');
        }

        const { error: rmErr } = await supabase.storage.from(CASE_DOCUMENTS_STORAGE_BUCKET).remove([path]);
        if (rmErr) throw rmErr;

        const { data: seRow, error: seFetchErr } = await supabase
          .from('lead_sub_efforts')
          .select('document_url')
          .eq('id', rowId)
          .maybeSingle();
        if (seFetchErr) throw seFetchErr;

        const normalizeDocItems = (raw: unknown): any[] => {
          if (!raw) return [];
          if (Array.isArray(raw)) return raw as any[];
          if (typeof raw === 'string') {
            try {
              const parsed = JSON.parse(raw);
              if (Array.isArray(parsed)) return parsed as any[];
            } catch {
              /* ignore */
            }
            return [{ url: raw }];
          }
          if (typeof raw === 'object') return [raw as any];
          return [];
        };

        const items = normalizeDocItems((seRow as any)?.document_url);
        const next = items.filter((it) => String((it as any)?.path || '') !== path);

        const { error: seUpdErr } = await supabase.from('lead_sub_efforts').update({ document_url: next }).eq('id', rowId);
        if (seUpdErr) throw seUpdErr;
      } else {
        const dbId = doc.caseDocDbId || doc.id;
        const path = doc.storagePath?.trim() || '';
        if (!path) throw new Error('Missing storage path for this document.');

        const { error: rmErr } = await supabase.storage.from(CASE_DOCUMENTS_STORAGE_BUCKET).remove([path]);
        if (rmErr) throw rmErr;

        const { error: delErr } = await supabase.from('lead_case_documents').delete().eq('id', dbId);
        if (delErr) throw delErr;
      }

      setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
      toast.success('Deleted');
    } catch (e: any) {
      console.error('Delete document:', e);
      toast.error(String(e?.message || 'Failed to delete'));
    } finally {
      setDeleting((prev) => prev.filter((id) => id !== doc.id));
    }
  };

  const handleRetryDocumentSummary = async () => {
    if (!summaryModalDoc) return;
    const id = summaryModalDoc.id;
    setSummaryModalDoc((d) =>
      d && d.id === id ? { ...d, aiSummaryStatus: 'pending', aiSummaryError: null } : d,
    );
    setDocuments((prev) =>
      prev.map((x) => (x.id === id ? { ...x, aiSummaryStatus: 'pending', aiSummaryError: null } : x)),
    );
    await supabase
      .from('lead_case_documents')
      .update({ ai_summary_status: 'pending', ai_summary_error: null })
      .eq('id', id);
    void requestCaseDocumentSummarize(id, { force: true });
  };

  const formatDate = (dateString: string) => {
    const d = new Date(dateString);
    if (Number.isNaN(d.getTime())) return dateString;
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(-2);
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${dd}.${mm}.${yy}, ${hh}:${min}`;
  };

  // Helper function to get current user's full name
  const getCurrentUserName = async (): Promise<string> => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) return 'Unknown';
      
      const { data: userData, error } = await supabase
        .from('users')
        .select('full_name')
        .eq('auth_id', user.id)
        .single();
      
      if (error || !userData?.full_name) {
        return user?.email || 'Unknown';
      }
      
      return userData.full_name;
    } catch (error) {
      console.error('Error getting user name:', error);
      return 'Unknown';
    }
  };

  // Handle file drop
  const handleFileDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (requireCaseDocumentClassification && !uploadClassificationId) {
      toast.error('Select a document category below to upload.');
      return;
    }
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      await uploadFiles(Array.from(files));
    }
  };

  // Handle file input change
  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (requireCaseDocumentClassification && !uploadClassificationId) {
      toast.error('Select a document category below to upload.');
      e.target.value = '';
      return;
    }
    const files = e.target.files;
    if (files) {
      await uploadFiles(Array.from(files));
    }
  };

  // The main upload function
  const uploadFiles = async (files: File[]) => {
    const classificationIdForBatch = uploadClassificationId;
    if (requireCaseDocumentClassification && !classificationIdForBatch) {
      toast.error('Select a document category below to upload.');
      return;
    }
    setIsUploading(true);
    const newUploads = files.map(file => ({ name: file.name, status: 'uploading' as const, progress: 5 }));
    setUploadedFiles(prev => [...prev, ...newUploads]);

    const progressIntervals: Map<string, NodeJS.Timeout> = new Map();

    const startProgressSimulation = (fileName: string, fileSize: number) => {
      const initialProgress = 5;
      let currentProgress = initialProgress;
      const targetProgress = 90;
      const progressRange = targetProgress - initialProgress;
      const startTime = Date.now();
      const estimatedDuration = Math.max(2000, Math.min(10000, fileSize / 1024));
      const updateInterval = 100;
      
      const interval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const progressRatio = Math.min(elapsed / estimatedDuration, 0.95);
        const easedProgress = 1 - Math.pow(1 - progressRatio, 3);
        currentProgress = Math.min(
          Math.floor(initialProgress + (easedProgress * progressRange)), 
          targetProgress
        );
        
        if (currentProgress >= targetProgress) {
          clearInterval(interval);
          progressIntervals.delete(fileName);
        }
        
        setUploadedFiles(prev => prev.map(f => 
          f.name === fileName && f.status === 'uploading'
            ? { ...f, progress: currentProgress }
            : f
        ));
      }, updateInterval);
      
      progressIntervals.set(fileName, interval);
      return interval;
    };

    const stopProgressSimulation = (fileName: string) => {
      const interval = progressIntervals.get(fileName);
      if (interval) {
        clearInterval(interval);
        progressIntervals.delete(fileName);
      }
    };

    const subKey = onedriveSubFolder?.trim() ? onedriveSubFolder.trim() : null;

    for (const file of files) {
      startProgressSimulation(file.name, file.size);
      
      try {
        const storagePath = buildCaseDocumentStoragePath(leadNumber, subKey ?? undefined, file.name);

        const { error: storageErr } = await supabase.storage
          .from(CASE_DOCUMENTS_STORAGE_BUCKET)
          .upload(storagePath, file, {
            contentType: file.type?.trim() || undefined,
            upsert: false,
          });

        stopProgressSimulation(file.name);

        if (storageErr) throw storageErr;

        const uploadedBy = await getCurrentUserName();
        const mimeType = file.type?.trim() || 'application/octet-stream';

        const { data: insertedRow, error: insErr } = await supabase
          .from('lead_case_documents')
          .insert({
            lead_number: leadNumber,
            onedrive_subfolder: subKey,
            onedrive_item_id: null,
            storage_path: storagePath,
            file_name: file.name,
            file_size: file.size,
            mime_type: mimeType,
            classification_id:
              requireCaseDocumentClassification && classificationIdForBatch ? classificationIdForBatch : null,
            uploaded_by: uploadedBy,
            ai_summary_status: 'pending',
          })
          .select('id')
          .single();

        if (insErr) {
          console.error('lead_case_documents insert:', insErr);
          await supabase.storage.from(CASE_DOCUMENTS_STORAGE_BUCKET).remove([storagePath]);
          throw new Error(insErr.message);
        }

        if (insertedRow?.id) {
          void requestCaseDocumentSummarize(insertedRow.id as string);
        }

        setUploadedFiles(prev => prev.map(f => 
          f.name === file.name 
            ? { ...f, status: 'success' as const, progress: 100 } 
            : f
        ));
        
        // Refresh documents list after successful upload
        await fetchDocuments();

      } catch (err) {
        stopProgressSimulation(file.name);
        const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred';
        setUploadedFiles(prev => prev.map(f => 
          f.name === file.name 
            ? { ...f, status: 'error' as const, error: errorMessage, progress: 0 } 
            : f
        ));
        console.error(`Error uploading ${file.name}:`, err);
      }
    }
    
    progressIntervals.forEach((interval) => clearInterval(interval));
    progressIntervals.clear();
    setIsUploading(false);
    
    // Clear uploaded files after a delay
    setTimeout(() => {
      setUploadedFiles([]);
    }, 3000);
  };

  if (typeof window === 'undefined') return null;

  return createPortal(
    <>
    <div className={`fixed inset-0 z-[1000] flex items-end justify-end bg-black bg-opacity-40 transition-opacity duration-300 ${isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`} style={{ top: 0, left: 0 }}>
      <div
        className={`fixed top-0 flex h-full max-h-full min-h-[350px] min-w-0 flex-col overflow-hidden bg-white shadow-2xl transition-transform duration-500 max-md:inset-x-0 max-md:w-full max-md:max-w-none max-md:rounded-none md:right-0 md:w-full md:max-w-2xl md:rounded-l-2xl px-3 py-5 sm:px-4 md:p-8 lg:p-10 ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
        style={{ boxShadow: '0 0 40px 0 rgba(0,0,0,0.2)' }}
      >
        {/* Modal Header */}
        <header className="relative mb-4 shrink-0 md:mb-6">
          {/* Mobile: close badge in top-most right corner */}
          <button
            type="button"
            className="btn btn-circle btn-sm absolute right-0 top-0 z-10 h-11 w-11 border-0 bg-white text-black shadow-md ring-1 ring-base-300 hover:bg-base-200 hover:text-black md:hidden"
            onClick={onClose}
            aria-label="Close"
          >
            <XMarkIcon className="h-6 w-6 text-black" strokeWidth={2} aria-hidden />
          </button>

          <div className="flex min-w-0 flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-6">
            <div className="min-w-0 flex-1 max-md:pr-14 md:pr-2">
              <h2 className="mb-1 text-xl font-bold sm:text-2xl">{modalTitle ?? 'Documents'}</h2>
              <p className="text-sm text-base-content/70">Lead: {clientName} ({leadNumber})</p>
              {folderPathHint ? (
                <p className="mt-1 text-xs text-base-content/60">{folderPathHint}</p>
              ) : null}
              <button
                type="button"
                className="btn btn-primary btn-sm mt-3 gap-1.5 shadow-sm md:hidden"
                onClick={handleDownloadAll}
                disabled={
                  loading ||
                  (requireCaseDocumentClassification ? documentsInActiveCategory.length === 0 : documents.length === 0)
                }
                title="Download all"
              >
                <ArrowDownTrayIcon className="h-5 w-5 shrink-0" />
                All
              </button>
            </div>

            {/* Desktop: plain action + close (no grey pill toolbar) */}
            <div className="hidden shrink-0 items-center gap-2 md:flex">
              <button
                type="button"
                className="btn btn-ghost btn-sm h-auto min-h-0 gap-1.5 border-0 bg-transparent px-2 py-1 font-medium text-base-content shadow-none hover:bg-base-200/60 hover:text-base-content disabled:bg-transparent disabled:opacity-40"
                onClick={handleDownloadAll}
                disabled={
                  loading ||
                  (requireCaseDocumentClassification ? documentsInActiveCategory.length === 0 : documents.length === 0)
                }
                title="Download all"
              >
                <ArrowDownTrayIcon className="h-5 w-5 shrink-0" aria-hidden />
                Download All
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-circle h-11 w-11 min-h-11 min-w-11 border-0 bg-transparent p-0 text-base-content shadow-none hover:bg-base-200/60"
                onClick={onClose}
                aria-label="Close"
              >
                <XMarkIcon className="h-7 w-7" strokeWidth={2} aria-hidden />
              </button>
            </div>
          </div>
        </header>
        {/* Modal body: vertical scroll only; horizontal overflow clipped (tab row scrolls inside its own strip). */}
        <div className="min-h-0 w-full min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain [-webkit-overflow-scrolling:touch]">
          {requireCaseDocumentClassification && classificationsError ? (
            <p className="mb-4 text-sm text-error">{classificationsError}</p>
          ) : null}

          {requireCaseDocumentClassification && !uploadClassificationId && !caseUploadBlocked ? (
            <p className="mb-4 text-xs text-base-content/60">
              Select a document category below to upload new files.
            </p>
          ) : null}

          {/* Case docs: upload when a real category tab is active. Expert: always. */}
          {(() => {
            const showUploadZone = !requireCaseDocumentClassification || !!uploadClassificationId;
            if (!showUploadZone) return null;
            const uploadLabel = uploadClassificationId
              ? classifications.find((c) => c.id === uploadClassificationId)?.label
              : undefined;
            return (
              <>
                {requireCaseDocumentClassification && uploadLabel ? (
                  <p className="mb-2 text-xs text-base-content/65">
                    Uploads are added to <span className="font-medium text-base-content/90">{uploadLabel}</span>.
                  </p>
                ) : null}
                <input
                  type="file"
                  className="hidden"
                  id="file-upload-modal"
                  multiple
                  onChange={handleFileInput}
                  disabled={isUploading || caseUploadBlocked}
                />
                {/* Mobile: one control → native file picker (no drag-and-drop UI) */}
                <div
                  className={`mb-6 md:hidden ${caseUploadBlocked || isUploading ? 'pointer-events-none opacity-50' : ''}`}
                >
                  <label
                    htmlFor="file-upload-modal"
                    className={`btn btn-outline btn-primary btn-block min-h-12 gap-2 border-2 bg-white text-primary shadow-none hover:bg-primary/5 active:bg-primary/10 dark:bg-base-100 dark:hover:bg-primary/10 ${isUploading || caseUploadBlocked ? 'btn-disabled' : ''}`}
                  >
                    <DocumentArrowUpIcon className="h-5 w-5 shrink-0" />
                    {isUploading ? 'Processing…' : 'Upload document'}
                  </label>
                  {isUploading ? (
                    <p className="mt-2 text-center text-xs text-base-content/60">Processing files…</p>
                  ) : null}
                </div>
                {/* md+: drag-and-drop zone + choose files */}
                <div
                  className={`mb-6 hidden max-w-full min-w-0 md:block rounded-lg border-2 border-dashed p-6 text-center transition-colors duration-200 sm:p-8 ${
                    isUploading
                      ? 'border-primary bg-gray-50'
                      : 'border-gray-300 bg-gray-50 hover:border-primary hover:bg-purple-50'
                  } ${caseUploadBlocked ? 'pointer-events-none opacity-50' : ''}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onDragEnter={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onDrop={handleFileDrop}
                >
                  <DocumentArrowUpIcon className="mx-auto mb-4 h-12 w-12 text-gray-400" />
                  <div className="mb-4 text-base text-gray-600">
                    {isUploading
                      ? 'Processing files...'
                      : caseUploadBlocked
                        ? 'Unable to upload while classifications are loading.'
                        : 'Drag and drop files here, or click to select files'}
                  </div>
                  <label
                    htmlFor="file-upload-modal"
                    className={`btn btn-outline btn-primary ${isUploading || caseUploadBlocked ? 'btn-disabled' : ''}`}
                  >
                    <PaperClipIcon className="h-5 w-5" />
                    Upload Files
                  </label>
                </div>
              </>
            );
          })()}

          {/* Uploaded Files List */}
          {uploadedFiles.length > 0 && (
            <div className="space-y-2 mb-6">
              {uploadedFiles.map((file, index) => (
                <div key={index} className="flex min-w-0 items-center justify-between gap-2 rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <PaperClipIcon className="w-5 h-5 shrink-0 text-primary" />
                    <span className="min-w-0 truncate text-base font-medium text-gray-900">{file.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {file.status === 'uploading' && (
                      <div className="flex items-center gap-2">
                        <div className="radial-progress text-xs" style={{ "--value": file.progress || 0, "--size": "2.5rem", color: '#3b28c7' } as any}>
                          <span className="text-xs font-semibold">{Math.round(file.progress || 0)}%</span>
                        </div>
                        <div className="text-xs text-gray-500 font-medium">Uploading...</div>
                      </div>
                    )}
                    {file.status === 'success' && (
                      <div className="flex items-center gap-2">
                        <CheckCircleIcon className="w-6 h-6 text-green-500" />
                        <span className="text-xs text-green-600 font-medium">Complete</span>
                      </div>
                    )}
                    {file.status === 'error' && (
                      <div className="tooltip tooltip-error" data-tip={file.error}>
                        <div className="flex items-center gap-2">
                          <XCircleIcon className="w-6 h-6 text-red-500" />
                          <span className="text-xs text-red-600 font-medium">Failed</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Documents list: case mode — tabs show as soon as classifications load; storage-backed list loads below */}
          {requireCaseDocumentClassification && classifications.length > 0 ? (
                <div className="mb-4 flex w-full min-w-0 max-w-full flex-col gap-4">
                  <nav
                    className="flex w-full min-w-0 max-w-full touch-pan-x flex-nowrap items-stretch gap-2 overflow-x-auto overflow-y-hidden overscroll-x-contain border-b border-base-200 pb-2 [-webkit-overflow-scrolling:touch]"
                    aria-label="Document categories"
                  >
                    {classifications.map((c) => {
                      const count = documents.filter((d) => d.caseClassificationId === c.id).length;
                      const active = activeBrowseCategoryId === c.id;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setActiveBrowseCategoryId(c.id);
                          }}
                          className={`btn btn-sm inline-flex h-auto min-h-0 shrink-0 touch-manipulation select-none items-center gap-2 whitespace-nowrap rounded-lg border-0 px-3 py-2.5 text-sm font-bold shadow-none ${
                            active
                              ? 'btn-primary text-white'
                              : 'bg-base-200/90 text-base-content hover:bg-base-300/80'
                          }`}
                        >
                          <span className="max-w-[12rem] truncate sm:max-w-[14rem]">{c.label}</span>
                          <span
                            className={
                              active
                                ? 'ml-0 inline-flex min-w-[22px] items-center justify-center rounded-full bg-white px-2 py-0.5 text-xs font-semibold tabular-nums text-[#3b28c7]'
                                : 'ml-0 text-xs font-semibold tabular-nums text-black dark:text-gray-100'
                            }
                          >
                            {count}
                          </span>
                        </button>
                      );
                    })}
                  </nav>
                  <div className="min-w-0 w-full">
                    {loading ? (
                      <div className="flex items-center justify-center py-10">
                        <div className="loading loading-spinner loading-lg" />
                        <span className="ml-3 text-base-content/70">Loading documents…</span>
                      </div>
                    ) : error ? (
                      <div className="flex items-center justify-center py-10 text-error">
                        <ExclamationTriangleIcon className="mr-3 h-8 w-8 shrink-0" />
                        <span>{error}</span>
                      </div>
                    ) : documents.length === 0 ? (
                      <div className="py-12 text-center text-base-content/70">
                        <DocumentIcon className="mx-auto mb-4 h-16 w-16 opacity-50" />
                        <p>No documents found for this lead.</p>
                      </div>
                    ) : documentsInActiveCategory.length === 0 ? (
                      <div className="py-10 text-center text-base-content/70">
                        <p>No documents in this category.</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {documentsInActiveCategory.map((doc) => {
                          const isDownloading = downloading.includes(doc.id);

                          return (
                            <div
                              key={doc.id}
                              className="flex min-w-0 max-w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-base-200 bg-transparent px-3 py-4 transition-colors hover:bg-base-200/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 sm:gap-3 sm:p-5 md:items-stretch"
                              role="button"
                              tabIndex={0}
                              aria-label={`Open AI summary for ${doc.name}`}
                              onClick={() => setSummaryModalDoc(doc)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  setSummaryModalDoc(doc);
                                }
                              }}
                            >
                              <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-4">
                                <span className="shrink-0">
                                  <DocumentFileGlyph fileType={doc.fileType} fileName={doc.name} />
                                </span>
                                <div className="min-w-0 flex-1 overflow-hidden">
                                  <p className="min-w-0 break-words text-base font-semibold leading-snug text-base-content [overflow-wrap:anywhere]">
                                    {doc.name}
                                  </p>
                                  <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                                    <span className="shrink-0 text-sm tabular-nums text-base-content/70">
                                      {formatDate(doc.lastModified)}
                                    </span>
                                    <DocumentUploaderAttribution doc={doc} />
                                    {doc.aiSummaryStatus === 'ready' && doc.aiSummary?.trim() ? (
                                      <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                                        <SparklesIcon className="h-3 w-3 shrink-0" aria-hidden />
                                        Summary
                                      </span>
                                    ) : doc.aiSummaryStatus === 'pending' ? (
                                      <span className="inline-flex items-center gap-1 text-xs text-base-content/55">
                                        <span className="loading loading-spinner loading-xs" aria-hidden />
                                        Summarizing…
                                      </span>
                                    ) : null}
                                  </div>
                                </div>
                              </div>

                              <DocumentRowActionMenu
                                doc={doc}
                                isDownloading={isDownloading}
                                isDeleting={deleting.includes(doc.id)}
                                onPreview={handlePreview}
                                onDownload={handleDownload}
                                onDelete={handleDeleteDocument}
                              />
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
          ) : requireCaseDocumentClassification && classificationsLoading ? (
            <div className="mb-4 flex w-full min-w-0 flex-col gap-3">
              <div
                className="flex w-full min-w-0 max-w-full gap-2 overflow-x-auto border-b border-base-200 pb-2"
                aria-hidden
              >
                {[1, 2, 3, 4, 5, 6, 7].map((i) => (
                  <div key={i} className="h-10 w-24 shrink-0 animate-pulse rounded-lg bg-base-300/40 sm:w-28" />
                ))}
              </div>
              <p className="text-sm text-base-content/60">Loading categories…</p>
            </div>
          ) : requireCaseDocumentClassification ? null : loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="loading loading-spinner loading-lg" />
              <span className="ml-3">Loading documents...</span>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-12 text-error">
              <ExclamationTriangleIcon className="w-8 h-8 mr-3" />
              <span>{error}</span>
            </div>
          ) : documents.length === 0 ? (
            <div className="text-center py-12 text-base-content/70">
              <DocumentIcon className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <p>No documents found for this lead.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {documents.map((doc) => {
                const isDownloading = downloading.includes(doc.id);

                return (
                  <div
                    key={doc.id}
                              className="flex min-w-0 max-w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-base-200 bg-transparent px-3 py-4 transition-colors hover:bg-base-200/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 sm:gap-3 sm:p-5 md:items-stretch"
                    role="button"
                    tabIndex={0}
                    aria-label={`Open AI summary for ${doc.name}`}
                    onClick={() => setSummaryModalDoc(doc)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSummaryModalDoc(doc);
                      }
                    }}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-4">
                      <span className="shrink-0">
                        <DocumentFileGlyph fileType={doc.fileType} fileName={doc.name} />
                      </span>
                      <div className="min-w-0 flex-1 overflow-hidden">
                        <p className="min-w-0 break-words text-base font-semibold leading-snug text-base-content [overflow-wrap:anywhere]">
                          {doc.name}
                        </p>
                        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="shrink-0 text-sm tabular-nums text-base-content/70">
                            {formatDate(doc.lastModified)}
                          </span>
                          <DocumentUploaderAttribution doc={doc} />
                          {doc.aiSummaryStatus === 'ready' && doc.aiSummary?.trim() ? (
                            <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                              <SparklesIcon className="h-3 w-3 shrink-0" aria-hidden />
                              Summary
                            </span>
                          ) : doc.aiSummaryStatus === 'pending' ? (
                            <span className="inline-flex items-center gap-1 text-xs text-base-content/55">
                              <span className="loading loading-spinner loading-xs" aria-hidden />
                              Summarizing…
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <DocumentRowActionMenu
                      doc={doc}
                      isDownloading={isDownloading}
                      isDeleting={deleting.includes(doc.id)}
                      onPreview={handlePreview}
                      onDownload={handleDownload}
                      onDelete={handleDeleteDocument}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* AI summary (row click) */}
      {summaryModalDoc && (
        <div className="fixed inset-0 z-[1060] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/60"
            aria-label="Close summary"
            onClick={() => setSummaryModalDoc(null)}
          />
          <div
            className="relative z-[1] flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-base-100 shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="case-doc-summary-title"
          >
            <div className="flex items-start justify-between gap-3 border-b border-base-300 p-4 md:p-5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-base-content/55">
                    Document
                  </p>
                  {requireCaseDocumentClassification ? (
                    <span className="inline-flex items-center rounded-full bg-base-200 px-2 py-0.5 text-xs font-medium text-base-content/70">
                      {summaryModalDoc.caseClassificationLabel?.trim() || 'Uncategorized'}
                    </span>
                  ) : null}
                </div>
                <h3
                  id="case-doc-summary-title"
                  className="mt-0.5 break-words text-lg font-semibold leading-snug text-base-content [overflow-wrap:anywhere]"
                >
                  {summaryModalDoc.name}
                </h3>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {canEditSummary ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      if (isEditingSummary) {
                        setIsEditingSummary(false);
                        setEditedSummaryText(summaryModalDoc.aiSummary ?? '');
                        return;
                      }
                      setIsEditingSummary(true);
                    }}
                    disabled={isSavingSummary}
                    title={isEditingSummary ? 'Cancel edit' : 'Edit summary'}
                  >
                    <PencilSquareIcon className="h-4 w-4" aria-hidden />
                    {isEditingSummary ? 'Cancel' : 'Edit'}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => void shareDocumentSummary(summaryModalDoc)}
                  disabled={!summaryModalDoc.aiSummary?.trim()}
                  title="Share summary"
                >
                  <ShareIcon className="h-4 w-4" aria-hidden />
                  Share
                </button>
                <button
                  type="button"
                  className="btn btn-circle btn-ghost btn-sm"
                  aria-label="Close"
                  onClick={() => setSummaryModalDoc(null)}
                >
                  <XMarkIcon className="h-6 w-6" />
                </button>
              </div>
            </div>
            <div className="min-h-[12rem] flex-1 overflow-y-auto p-4 md:p-5">
              {isEditingSummary ? (
                <div className="space-y-3">
                  <textarea
                    className="textarea textarea-bordered w-full min-h-[220px] text-sm leading-relaxed"
                    value={editedSummaryText}
                    onChange={(e) => setEditedSummaryText(e.target.value)}
                    placeholder="Write a summary…"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm text-error"
                      disabled={isSavingSummary}
                      onClick={() => void saveEditedSummary({ clear: true })}
                      title="Delete summary"
                    >
                      <TrashIcon className="h-4 w-4" aria-hidden />
                      Delete
                    </button>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={isSavingSummary}
                        onClick={() => {
                          setIsEditingSummary(false);
                          setEditedSummaryText(summaryModalDoc.aiSummary ?? '');
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={isSavingSummary}
                        onClick={() => void saveEditedSummary()}
                      >
                        {isSavingSummary ? (
                          <span className="loading loading-spinner loading-xs" />
                        ) : null}
                        Save
                      </button>
                    </div>
                  </div>
                </div>
              ) : summaryModalDoc.aiSummaryStatus === 'pending' ? (
                <div className="flex flex-col items-center justify-center gap-3 py-12 text-base-content/70">
                  <span className="loading loading-spinner loading-lg" />
                  <p className="text-center text-sm">Generating AI summary…</p>
                </div>
              ) : summaryModalDoc.aiSummaryStatus === 'ready' && summaryModalDoc.aiSummary?.trim() ? (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-base-content/90">
                  {summaryModalDoc.aiSummary.trim()}
                </p>
              ) : summaryModalDoc.aiSummaryStatus === 'skipped' ? (
                <p className="text-sm text-base-content/70">
                  {summaryModalDoc.aiSummaryError?.trim() ||
                    'This file type is not supported for automatic summary.'}
                </p>
              ) : summaryModalDoc.aiSummaryStatus === 'failed' ? (
                <div className="space-y-3">
                  <p className="text-sm text-error">
                    {summaryModalDoc.aiSummaryError?.trim() || 'Could not generate summary.'}
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => void handleRetryDocumentSummary()}
                  >
                    Try again
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-base-content/70">
                    No summary is stored for this file yet.
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => void handleRetryDocumentSummary()}
                  >
                    Generate summary
                  </button>
                </div>
              )}
            </div>
            <div className="border-t border-base-200 px-4 py-3 text-xs text-base-content/55 md:px-5">
              <div className="flex items-center justify-end">
                <span className="tabular-nums">{formatDate(summaryModalDoc.lastModified)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>

      {/* Full-screen preview + bottom carousel (above documents drawer & summary dialog) */}
      {previewDocument && previewIndex !== null && (
        <div
          className="fixed inset-0 z-[1200] flex flex-col bg-base-100"
          role="dialog"
          aria-modal="true"
          aria-label="Document preview"
        >
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-base-300 bg-base-100 px-4 py-3 md:px-6">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-base-content/55 tabular-nums">
                Uploaded {formatDate(previewDocument.lastModified)}
              </p>
              <h2 className="mt-0.5 truncate text-lg font-semibold md:text-xl">{previewDocument.name}</h2>
              <p className="mt-0.5 text-xs text-base-content/60 tabular-nums">
                {previewIndex + 1} / {documents.length}
              </p>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-circle shrink-0"
              onClick={() => setPreviewIndex(null)}
              aria-label="Close preview"
            >
              <XMarkIcon className="h-6 w-6" />
            </button>
          </header>

          <div className="flex min-h-0 flex-1 items-stretch">
            <button
              type="button"
              className="hidden w-12 shrink-0 items-center justify-center border-r border-base-300 bg-base-200/70 text-base-content hover:bg-base-300/80 md:flex lg:w-16"
              aria-label="Previous file"
              onClick={previewGoPrev}
            >
              <ChevronLeftIcon className="h-9 w-9 lg:h-10 lg:w-10" />
            </button>

            <div
              className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-neutral-900"
              onWheel={handlePreviewStageWheel}
            >
              <div
                className={`flex min-h-0 w-full flex-1 p-3 md:p-6 ${
                  previewDocument.fileType.includes('pdf')
                    ? 'min-h-0 flex-col overflow-hidden'
                    : 'items-center justify-center overflow-auto'
                }`}
              >
                {previewDocument.fileType.includes('image/') ? (
                  <img
                    src={previewDocument.downloadUrl}
                    alt={previewDocument.name}
                    className="max-h-full max-w-full object-contain"
                  />
                ) : previewDocument.fileType.includes('pdf') ? (
                  <iframe
                    src={previewDocument.downloadUrl}
                    className="min-h-0 w-full flex-1 border-0"
                    title={previewDocument.name}
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center gap-3 px-4 text-center text-neutral-200">
                    <DocumentIcon className="h-16 w-16 shrink-0 opacity-80" />
                    <p className="text-sm">Preview not available for this file type.</p>
                  </div>
                )}
              </div>
              <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center gap-3 md:hidden">
                <button
                  type="button"
                  className="pointer-events-auto btn btn-circle btn-neutral btn-sm shadow-lg"
                  aria-label="Previous file"
                  onClick={previewGoPrev}
                >
                  <ChevronLeftIcon className="h-6 w-6" />
                </button>
                <button
                  type="button"
                  className="pointer-events-auto btn btn-circle btn-neutral btn-sm shadow-lg"
                  aria-label="Next file"
                  onClick={previewGoNext}
                >
                  <ChevronRightIcon className="h-6 w-6" />
                </button>
              </div>
            </div>

            <button
              type="button"
              className="hidden w-12 shrink-0 items-center justify-center border-l border-base-300 bg-base-200/70 text-base-content hover:bg-base-300/80 md:flex lg:w-16"
              aria-label="Next file"
              onClick={previewGoNext}
            >
              <ChevronRightIcon className="h-9 w-9 lg:h-10 lg:w-10" />
            </button>
          </div>

          <footer className="shrink-0 border-t border-base-300 bg-base-200/50 px-2 py-3 dark:bg-base-300/30">
            <div
              className="mx-auto flex max-w-[100vw] gap-2 overflow-x-auto overflow-y-hidden pb-1 [-webkit-overflow-scrolling:touch]"
              onWheel={(e) => {
                if (!e.shiftKey) return;
                e.currentTarget.scrollLeft += e.deltaY;
                e.preventDefault();
              }}
            >
              {documents.map((d, i) => {
                const isActive = i === previewIndex;
                const isImg = d.fileType.includes('image/');
                return (
                  <button
                    key={d.id}
                    id={`doc-preview-thumb-${d.id}`}
                    type="button"
                    onClick={() => setPreviewIndex(i)}
                    title={d.name}
                    className={`shrink-0 rounded-lg border-2 p-0.5 transition ${
                      isActive
                        ? 'border-primary shadow-md ring-2 ring-primary/40'
                        : 'border-transparent opacity-75 hover:opacity-100'
                    }`}
                  >
                    {isImg ? (
                      <img
                        src={d.downloadUrl}
                        alt=""
                        className="h-16 w-16 rounded-md object-cover md:h-20 md:w-20"
                        loading="lazy"
                        draggable={false}
                      />
                    ) : (
                      <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-md bg-base-300 md:h-20 md:w-20">
                        <div className="flex origin-center scale-[0.42] items-center justify-center">
                          <DocumentFileGlyph fileType={d.fileType} fileName={d.name} />
                        </div>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </footer>
        </div>
      )}
    </>,
    window.document.body
  );
};

export default DocumentModal; 