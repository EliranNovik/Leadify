import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  ClockIcon,
  PlayIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DocumentIcon,
  EllipsisVerticalIcon,
  EyeIcon,
  FolderIcon,
  FolderPlusIcon,
  PlusIcon,
  QuestionMarkCircleIcon,
  LockClosedIcon,
  PencilSquareIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import MobileBottomSheet from './MobileBottomSheet';
import { supabase } from '../lib/supabase';
import { CLIENT_HEADER_ONEDRIVE_SUBFOLDER } from '../lib/leadOneDrivePaths';
import { resolveCaseDocumentUploadContentType } from '../lib/caseDocumentsStorage';
import { fetchStageActorInfo } from '../lib/leadStageManager';
import { getSoftStageBadgeStyle, getStageColour, getStageName } from '../lib/stageUtils';
import { compareSubEffortDisplayOrder, dedupeLeadSubEffortRows, defaultClientVisibleFromTemplate, hasLeadSubEffortSavedUpdate, leadSubEffortInternalFromTemplate, leadSubEffortSavedUpdatedAt, leadSubEffortSavedUpdatedBy } from '../lib/leadSubEfforts';
import { DocumentPreviewModal, type DocumentPreviewItem } from './DocumentModal';
import { SequenceOfEventsDocumentsModal } from './SequenceOfEventsDocumentsModal';
import { ClientUploadsDocumentsModal } from './ClientUploadsDocumentsModal';
import {
  CASE_DOCUMENT_CATEGORY_META,
  fetchCaseCategoryDocumentCount,
  fetchClientPortalUploadCount,
  type CaseDocumentCategoryKey,
} from '../lib/sequenceOfEventsDocuments';
import { DocumentFileGlyph } from '../lib/documentFileGlyphs';
import { createPortal } from 'react-dom';
import { normalizeStorageKey } from '../lib/subEffortDocumentAttach';
import { downloadFilesAsZip } from '../lib/downloadDocumentsZip';
import { resolveUploaderDisplayByKey } from '../lib/uploaderDisplay';
import { DocumentUploaderCell } from './caseDocumentsModalUi';

type LeadSubEffortRow = any;

const SUB_EFFORT_DOC_CATEGORIES: CaseDocumentCategoryKey[] = [
  'sequence_of_events',
  'legal_claims',
  'expert',
  'contract',
];

const emptyCategoryCounts = (): Record<CaseDocumentCategoryKey, number> => ({
  sequence_of_events: 0,
  legal_claims: 0,
  expert: 0,
  contract: 0,
});

const SUB_EFFORTS_DOCS_BUCKET = 'lead-sub-efforts-documents';

type CaseDocPick = {
  id: string;
  file_name: string;
  storage_path: string;
  mime_type: string | null;
  created_at: string;
  signedUrl?: string;
};

type ResolvedDoc = {
  raw: string;
  url: string;
  name: string;
  mimeType?: string;
  isImage: boolean;
  isPdf: boolean;
  path?: string;
  folder_id?: string | null;
  documentTypeName?: string | null;
  uploadedByName?: string | null;
  uploadedByPhotoUrl?: string | null;
  isClientPortalUpload?: boolean;
};

function formatDateTime(value: any): string {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(value);
  }
}

function asArray(value: any): any[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

type DocItem = {
  url?: string;
  path?: string;
  name?: string;
  mimeType?: string;
  /** Optional folder id from lead_sub_effort_folders; null/missing = unfiled. */
  folder_id?: string | null;
};

type SubEffortFolder = {
  id: string;
  lead_sub_effort_id: number;
  title: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
  sort_order: number;
};

function normalizeDocItems(documentUrl: any): DocItem[] {
  if (!documentUrl) return [];

  // Common cases: string URL/path, array, or JSON object with { urls: [...] } / { files: [...] } / { documents: [...] }.
  if (typeof documentUrl === 'string') {
    const s = documentUrl.trim();
    if (!s) return [];
    if (/^https?:\/\//i.test(s)) return [{ url: s }];
    return [{ path: s }];
  }
  if (Array.isArray(documentUrl)) {
    const out: DocItem[] = [];
    for (const u of documentUrl) {
      out.push(...normalizeDocItems(u));
    }
    return out;
  }
  if (typeof documentUrl === 'object') {
    const candidates = [
      ...(asArray((documentUrl as any).urls) ?? []),
      ...(asArray((documentUrl as any).files) ?? []),
      ...(asArray((documentUrl as any).documents) ?? []),
    ];
    // If this object itself looks like a doc record, keep it.
    if (
      (documentUrl as any).path ||
      (documentUrl as any).url ||
      (documentUrl as any).publicUrl ||
      (documentUrl as any).signedUrl
    ) {
      const path = typeof (documentUrl as any).path === 'string' ? (documentUrl as any).path.trim() : undefined;
      const url =
        typeof (documentUrl as any).url === 'string'
          ? (documentUrl as any).url.trim()
          : typeof (documentUrl as any).publicUrl === 'string'
            ? (documentUrl as any).publicUrl.trim()
            : typeof (documentUrl as any).signedUrl === 'string'
              ? (documentUrl as any).signedUrl.trim()
              : undefined;
      const name = typeof (documentUrl as any).name === 'string' ? (documentUrl as any).name : undefined;
      const mimeType =
        typeof (documentUrl as any).mimeType === 'string'
          ? (documentUrl as any).mimeType
          : typeof (documentUrl as any).contentType === 'string'
            ? (documentUrl as any).contentType
            : undefined;
      const folderRaw = (documentUrl as any).folder_id;
      const folder_id =
        typeof folderRaw === 'string' && folderRaw.trim()
          ? folderRaw.trim()
          : folderRaw === null
            ? null
            : undefined;
      const item: DocItem = {};
      if (url) item.url = url;
      if (path) item.path = path;
      if (name) item.name = name;
      if (mimeType) item.mimeType = mimeType;
      if (folder_id !== undefined) item.folder_id = folder_id;
      return [item].filter((i) => i.url || i.path);
    }
    const out: DocItem[] = [];
    for (const c of candidates) out.push(...normalizeDocItems(c));
    return out;
  }

  return [];
}

function isImageUrl(url: string): boolean {
  const raw = String(url || '').trim();
  if (!raw) return false;
  // Signed URLs include query params; evaluate only the path part.
  const withoutQuery = raw.split('?')[0].split('#')[0].toLowerCase();
  return (
    withoutQuery.endsWith('.png') ||
    withoutQuery.endsWith('.jpg') ||
    withoutQuery.endsWith('.jpeg') ||
    withoutQuery.endsWith('.gif') ||
    withoutQuery.endsWith('.webp')
  );
}

function isPdfUrl(url: string): boolean {
  const raw = String(url || '').trim();
  if (!raw) return false;
  const withoutQuery = raw.split('?')[0].split('#')[0].toLowerCase();
  return withoutQuery.endsWith('.pdf');
}

function isImageMime(mime: string | null | undefined): boolean {
  const m = String(mime || '').toLowerCase();
  return m.startsWith('image/');
}

function inferMimeFromName(name: string): string {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  return 'application/octet-stream';
}

function guessPathList(documentUrl: any): string[] {
  return normalizeDocItems(documentUrl)
    .map((d) => (typeof d.path === 'string' ? d.path.trim() : ''))
    .filter(Boolean);
}

function containsHebrew(text: string): boolean {
  return /[\u0590-\u05FF]/.test(text);
}

function getEmployeePhoto(employee?: any): string | null {
  if (!employee) return null;
  const emp = Array.isArray(employee) ? employee[0] : employee;
  if (!emp) return null;
  const url =
    (emp.photo_url as string | null | undefined) ?? (emp.photo as string | null | undefined) ?? null;
  return typeof url === 'string' && url.trim() ? url.trim() : null;
}

function resolveEmployeeJoin(row: any): any | null {
  const emp = row?.tenants_employee;
  if (!emp) return null;
  return Array.isArray(emp) ? emp[0] ?? null : emp;
}

function readSubEffortJoin(row: any): {
  name?: string;
  description?: string;
  default_client_visible?: boolean;
} | null {
  const se = Array.isArray(row?.sub_efforts) ? row.sub_efforts[0] : row?.sub_efforts;
  if (!se) return null;
  return {
    name: typeof se.name === 'string' ? se.name : undefined,
    description: typeof se.description === 'string' ? se.description : undefined,
    default_client_visible: defaultClientVisibleFromTemplate(se.default_client_visible),
  };
}

function readSubEffortName(row: any): string {
  return readSubEffortJoin(row)?.name ?? 'Sub effort';
}

function readSubEffortDescription(row: any): string | null {
  const description = readSubEffortJoin(row)?.description?.trim();
  return description || null;
}

/**
 * Soft stage tints assume a white page. Flatten them over white so the badge keeps the
 * Lead Search look while staying legible on the dark hero image.
 */
function flattenSoftStageBackground(rgba: string): string {
  const match = rgba.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)/i);
  if (!match) return rgba;
  const [r, g, b] = [match[1], match[2], match[3]].map(Number);
  const alpha = match[4] == null ? 1 : Number(match[4]);
  const blend = (channel: number) => Math.round(255 + (channel - 255) * alpha);
  return `rgb(${blend(r)}, ${blend(g)}, ${blend(b)})`;
}

/** Professional stock heroes — stable pick per sub-effort id (not random each render). */
const SUB_EFFORT_HERO_IMAGES = [
  'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1600&q=80',
  'https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=1600&q=80',
  'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1600&q=80',
  'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?auto=format&fit=crop&w=1600&q=80',
  'https://images.unsplash.com/photo-1521737604893-d14cc237f11d?auto=format&fit=crop&w=1600&q=80',
  'https://images.unsplash.com/photo-1568992687947-868a62a9f521?auto=format&fit=crop&w=1600&q=80',
  'https://images.unsplash.com/photo-1556761175-5973dc0f32e7?auto=format&fit=crop&w=1600&q=80',
  'https://images.unsplash.com/photo-1497215728101-856f4ea42174?auto=format&fit=crop&w=1600&q=80',
  'https://images.unsplash.com/photo-1431540015161-0bf868a2d407?auto=format&fit=crop&w=1600&q=80',
  'https://images.unsplash.com/photo-1600880292203-757bb62b4baf?auto=format&fit=crop&w=1600&q=80',
  'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?auto=format&fit=crop&w=1600&q=80',
] as const;

/** Documents / authority filing — used for Submission and similar sub efforts. */
const SUB_EFFORT_SUBMISSION_HERO_IMAGE =
  'https://images.unsplash.com/photo-1589829545856-d10d557cf95f?auto=format&fit=crop&w=1600&q=80';

const SUBMISSION_HERO_KEYWORDS = [
  'submission',
  'submit',
  'filing',
  'authority',
  'authorities',
  'completion of documents',
  'document completion',
] as const;

function isSubmissionHeroTopic(...parts: Array<string | null | undefined>): boolean {
  const haystack = parts
    .map((p) => String(p ?? '').trim().toLowerCase())
    .filter(Boolean)
    .join(' ');
  if (!haystack) return false;
  return SUBMISSION_HERO_KEYWORDS.some((kw) => haystack.includes(kw));
}

function subEffortHeroImageUrl(params: {
  rowId?: string | number | null;
  name?: string | null;
  subtitle?: string | null;
}): string {
  if (isSubmissionHeroTopic(params.name, params.subtitle)) {
    return SUB_EFFORT_SUBMISSION_HERO_IMAGE;
  }

  const key = String(params.rowId ?? '0');
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return SUB_EFFORT_HERO_IMAGES[hash % SUB_EFFORT_HERO_IMAGES.length];
}

function truncateToMaxWords(text: string, maxWords = 16): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(' ');
  return `${words.slice(0, maxWords).join(' ')}…`;
}

type SubCategoryEffortItem = {
  id: number;
  name: string;
  sort_order: number;
};

function readSubCategoryEfforts(row: any): SubCategoryEffortItem[] {
  const se = Array.isArray(row?.sub_efforts) ? row.sub_efforts[0] : row?.sub_efforts;
  const raw = se?.sub_category_efforts;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];

  return list
    .map((item: any) => ({
      id: Number(item?.id),
      name: String(item?.name ?? '').trim(),
      sort_order: Number(item?.sort_order ?? 0),
    }))
    .filter((item) => Number.isFinite(item.id) && item.id > 0 && item.name)
    .sort(
      (a, b) =>
        a.sort_order - b.sort_order ||
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    );
}

function readDefaultClientVisible(row: any): boolean {
  return readSubEffortJoin(row)?.default_client_visible !== false;
}

function isLeadVisibilityOverridden(row: any): boolean {
  const templateInternal = leadSubEffortInternalFromTemplate(readDefaultClientVisible(row));
  return (row?.internal === true) !== templateInternal;
}

function updaterDisplayName(row: any): string {
  return leadSubEffortSavedUpdatedBy(row) ?? '—';
}

function workflowUpdatedBy(row: any): string {
  return leadSubEffortSavedUpdatedBy(row) ?? '—';
}

function workflowUpdatedAt(row: any): string {
  const at = leadSubEffortSavedUpdatedAt(row);
  if (!at) return '—';
  return formatDateTime(at);
}

function normalizePersonName(name: unknown): string {
  return String(name ?? '').trim().toLowerCase();
}

function resolveUpdaterPhoto(row: any, photoByUpdaterName?: Map<string, string>): string | null {
  if (!hasLeadSubEffortSavedUpdate(row)) return null;

  const updater = normalizePersonName(row?.updated_by);
  if (updater && photoByUpdaterName?.has(updater)) {
    return photoByUpdaterName.get(updater) ?? null;
  }

  // Only trust the joined employee photo when it is the same person as updated_by.
  const emp = resolveEmployeeJoin(row);
  const joinName = normalizePersonName(emp?.display_name);
  if (updater && joinName && updater === joinName) {
    return getEmployeePhoto(emp);
  }

  return null;
}

function buildUpdaterPhotoByName(rows: any[], employees: any[] = []): Map<string, string> {
  const map = new Map<string, string>();

  const addEmployee = (emp: any) => {
    const photo = getEmployeePhoto(emp);
    if (!photo) return;
    const displayName = normalizePersonName(emp?.display_name);
    if (displayName) map.set(displayName, photo);
  };

  for (const emp of employees ?? []) addEmployee(emp);
  for (const row of rows ?? []) {
    const emp = resolveEmployeeJoin(row);
    if (!emp) continue;
    // Index join photos by employee display name only — never by row.updated_by,
    // which can differ when employee_id is stale after a later edit.
    addEmployee(emp);
  }
  return map;
}

function leadSubEffortActorFields(actor: { fullName: string; employeeId: number | null }) {
  return {
    updated_by: actor.fullName,
    ...(actor.employeeId != null && Number.isFinite(actor.employeeId)
      ? { employee_id: actor.employeeId }
      : {}),
  };
}

function EmployeeAvatar({
  name,
  photoUrl,
  size = 'sm',
}: {
  name: string;
  photoUrl?: string | null;
  size?: 'xs' | 'sm' | 'md';
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('');
  const dim = size === 'xs' ? 'h-7 w-7' : size === 'sm' ? 'h-9 w-9' : 'h-10 w-10';
  const text = size === 'xs' ? 'text-[10px]' : size === 'sm' ? 'text-[11px]' : 'text-xs';
  const showPhoto = !!photoUrl && !imgFailed;

  useEffect(() => {
    setImgFailed(false);
  }, [photoUrl]);

  return (
    <div className="avatar shrink-0">
      <div className={`${dim} flex items-center justify-center overflow-hidden rounded-full bg-gray-200`}>
        {showPhoto ? (
          <img
            src={photoUrl}
            alt={name}
            className="h-full w-full object-cover"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <span className={`${text} font-semibold text-gray-600`}>{initials || '—'}</span>
        )}
      </div>
    </div>
  );
}

function VisibilityPill({ internal, size = 'md' }: { internal: boolean; size?: 'compact' | 'sm' | 'md' | 'lg' }) {
  const isInternal = internal === true;
  const Icon = isInternal ? LockClosedIcon : EyeIcon;
  const label = isInternal ? 'Internal' : size === 'compact' ? 'Client' : 'Visible to client';
  const cls = isInternal
    ? 'bg-amber-50/90 text-amber-800'
    : 'bg-blue-50/90 text-blue-800';
  const sizeCls =
    size === 'compact'
      ? 'w-fit max-w-full px-2.5 py-1 text-xs gap-1.5 rounded-md font-medium'
      : size === 'sm'
        ? 'px-2 py-0.5 text-[11px] gap-1 rounded-full font-semibold'
        : size === 'lg'
          ? 'px-3.5 py-2 text-sm gap-2 rounded-full font-semibold'
          : 'px-2.5 py-1 text-xs gap-1.5 rounded-full font-semibold';
  const outlineCls = size === 'compact' || size === 'lg' ? '' : 'ring-1 ring-inset ring-slate-200/60';
  const iconCls =
    size === 'lg'
      ? 'w-5 h-5'
      : size === 'compact'
        ? 'w-4 h-4'
        : size === 'sm'
          ? 'w-3 h-3'
          : 'w-3.5 h-3.5';
  return (
    <span className={`inline-flex shrink-0 items-center ${outlineCls} ${sizeCls} ${cls}`}>
      <Icon className={iconCls} />
      <span className="truncate">{label}</span>
    </span>
  );
}

type SubEffortProgress = 'completed' | 'in_progress' | 'pending';

function findCurrentSubEffortRowId(rows: any[]): string | null {
  const current = rows.find((row) => row?.active !== false);
  return current?.id != null ? String(current.id) : null;
}

function getSubEffortProgress(row: any, currentRowId: string | null): SubEffortProgress {
  if (row?.active === false) return 'completed';
  if (currentRowId != null && String(row?.id) === currentRowId) return 'in_progress';
  return 'pending';
}

function ProgressBadge({ progress, compact = false }: { progress: SubEffortProgress; compact?: boolean }) {
  const iconClass = compact ? 'h-4 w-4 shrink-0' : 'h-3.5 w-3.5 shrink-0';
  const iconOnly = compact
    ? 'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md'
    : 'inline-flex h-6 w-6 items-center justify-center rounded-full';

  if (progress === 'completed') {
    return null;
  }

  if (progress === 'in_progress') {
    return (
      <span
        className={`${iconOnly} border border-sky-100 bg-sky-50 text-sky-600`}
        title={compact ? 'Active' : 'In progress'}
        aria-label={compact ? 'Active' : 'In progress'}
      >
        <PlayIcon className={iconClass} aria-hidden />
      </span>
    );
  }

  return (
    <span
      className={`${iconOnly} border border-gray-100 bg-gray-50 text-gray-400`}
      title="Pending"
      aria-label="Pending"
    >
      <ClockIcon className={iconClass} aria-hidden />
    </span>
  );
}

function sortTimelineRows(rows: LeadSubEffortRow[]): LeadSubEffortRow[] {
  return [...(rows ?? [])].sort(compareSubEffortDisplayOrder);
}

const TIMELINE_HOLD_MS = 220;

function TimelineStepButton({
  rowId,
  row,
  stepNumber,
  progress,
  isSelected,
  isLast,
  connectsDoneToDone,
  isDragOver,
  isDragging,
  isHolding,
  photoByUpdaterName,
  onSelect,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  onOpenDescription,
}: {
  rowId: string;
  row: any;
  stepNumber: number;
  progress: SubEffortProgress;
  isSelected: boolean;
  isLast: boolean;
  connectsDoneToDone?: boolean;
  isDragOver?: boolean;
  isDragging?: boolean;
  isHolding?: boolean;
  photoByUpdaterName?: Map<string, string>;
  onSelect: () => void;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
  onOpenDescription: () => void;
}) {
  const name = readSubEffortName(row);
  const who = workflowUpdatedBy(row);
  const when = workflowUpdatedAt(row);
  const isPending = progress === 'pending' && !isSelected;
  const hasDescription = !!readSubEffortDescription(row);

  return (
    <div
      data-timeline-row-id={rowId}
      className={[
        isLast ? '' : 'pb-1',
        isDragging ? 'opacity-60' : '',
        isDragOver ? 'rounded-2xl ring-2 ring-primary/30' : '',
      ].join(' ')}
    >
      <div className="relative flex items-stretch gap-3">
        <div className="relative flex w-8 shrink-0 flex-col items-center">
          <span
            className={[
              'relative z-[1] flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold tabular-nums',
              progress === 'in_progress'
                ? 'bg-sky-100 text-sky-700'
                : progress === 'completed'
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-gray-100 text-gray-500',
            ].join(' ')}
            aria-hidden
          >
            {stepNumber}
          </span>
          {!isLast ? (
            <span
              className={[
                'absolute top-8 bottom-[-4px] left-1/2 w-0.5 -translate-x-1/2 rounded-full',
                connectsDoneToDone
                  ? 'bg-gradient-to-b from-emerald-200 via-emerald-100 to-emerald-50'
                  : 'bg-gradient-to-b from-gray-200 via-gray-100 to-gray-50',
              ].join(' ')}
              aria-hidden
            />
          ) : null}
        </div>

        <div className="group mb-1 min-w-0 flex-1">
          <div
            className={[
              'flex min-w-0 items-start gap-1 rounded-2xl transition-all duration-200',
              isDragging ? 'scale-[0.98] shadow-md' : '',
              isHolding ? 'ring-2 ring-gray-400/40' : '',
              isSelected
                ? 'border-0 bg-primary/10 px-2 py-2 shadow-sm ring-1 ring-primary/15 sm:px-3 sm:py-2.5'
                : progress === 'completed'
                  ? 'border-0 bg-emerald-50/35 px-2 py-2 sm:px-3 sm:py-2.5'
                  : isPending
                    ? 'px-2 py-2 opacity-80 hover:bg-gray-50/80 sm:px-3 sm:py-2.5'
                    : 'px-2 py-2 hover:bg-gray-50/80 sm:px-3 sm:py-2.5',
            ].join(' ')}
          >
            <div
              role="button"
              tabIndex={0}
              onPointerDown={onPointerDown}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerCancel}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect();
                }
              }}
              className={[
                'min-w-0 flex-1 rounded-xl text-left select-none touch-none',
                isDragging ? 'cursor-grabbing' : 'cursor-pointer',
              ].join(' ')}
            >
              <div className="min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div
                    className={[
                      'min-w-0 flex-1 font-semibold leading-snug line-clamp-2 break-words [overflow-wrap:anywhere]',
                      isSelected
                        ? 'text-[15px] text-primary'
                        : isPending
                          ? 'text-[14px] text-gray-600'
                          : progress === 'completed'
                            ? 'text-[15px] text-gray-800'
                            : 'text-[15px] text-gray-900',
                    ].join(' ')}
                    title={name}
                  >
                    {name}
                  </div>
                  <ChevronRightIcon
                    className={`h-4 w-4 shrink-0 transition md:hidden ${
                      isSelected
                        ? 'text-primary/45 group-hover:text-primary/65'
                        : 'text-gray-300 group-hover:text-gray-400'
                    }`}
                    aria-hidden
                  />
                </div>
                <div
                  className={`mt-1.5 flex items-center gap-1.5 text-[12px] truncate ${
                    isSelected
                      ? 'text-primary/65'
                      : progress === 'completed'
                        ? 'text-gray-500'
                        : 'text-gray-500'
                  }`}
                >
                  {who !== '—' || when !== '—' ? (
                    <>
                      {!isSelected && who !== '—' ? (
                        <EmployeeAvatar
                          name={who}
                          photoUrl={resolveUpdaterPhoto(row, photoByUpdaterName)}
                          size="sm"
                        />
                      ) : null}
                      <span className="truncate">
                        {who !== '—' ? (
                          <>
                            <span
                              className={`font-medium ${
                                isSelected ? 'text-primary' : 'text-gray-600'
                              }`}
                            >
                              {who}
                            </span>
                            <span
                              className={`mx-1 ${isSelected ? 'text-primary/35' : 'text-gray-300'}`}
                            >
                              ·
                            </span>
                          </>
                        ) : null}
                        {when !== '—' ? <span className="tabular-nums">{when}</span> : null}
                      </span>
                    </>
                  ) : null}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <ProgressBadge progress={progress} compact />
                  <VisibilityPill internal={row?.internal === true} size="compact" />
                </div>
              </div>
            </div>
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onOpenDescription();
              }}
              className={`btn btn-ghost btn-xs btn-square mt-0.5 h-8 w-8 shrink-0 rounded-full ${
                hasDescription
                  ? isSelected
                    ? 'text-primary/70 hover:bg-primary/10 hover:text-primary'
                    : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                  : isSelected
                    ? 'text-primary/30'
                    : 'text-gray-300'
              }`}
              title={hasDescription ? 'What is this sub effort?' : 'No description available'}
              aria-label={hasDescription ? `About ${name}` : `No description for ${name}`}
            >
              <QuestionMarkCircleIcon className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function resolvedDocsToPreviewItems(docs: ResolvedDoc[]): DocumentPreviewItem[] {
  return docs
    .filter((d) => !!d.url)
    .map((d, i) => ({
      id: d.path || d.raw || String(i),
      name: d.name,
      downloadUrl: d.url,
      fileType: d.mimeType || inferMimeFromName(d.name),
      storagePath: d.path || null,
    }));
}

function resolveSubEffortDocs(documentUrl: unknown, signedUrls: Map<string, string>): ResolvedDoc[] {
  return normalizeDocItems(documentUrl)
    .map((d) => {
      const raw = (d.url || d.path || '').trim();
      if (!raw) return null;
      const url = d.url ? d.url : d.path ? (signedUrls.get(d.path) ?? '') : '';
      const name = d.name || (d.path ? d.path.split('/').slice(-1)[0] : undefined) || 'Document';
      const mimeType = d.mimeType;
      const isImage =
        (typeof mimeType === 'string' && mimeType.startsWith('image/')) ||
        (url ? isImageUrl(url) : false) ||
        (name ? isImageUrl(name) : false);
      const isPdf =
        mimeType === 'application/pdf' ||
        (url ? isPdfUrl(url) : false) ||
        (name ? isPdfUrl(name) : false);
      return {
        raw,
        url,
        name,
        mimeType,
        isImage,
        isPdf,
        path: d.path,
        folder_id: d.folder_id ?? null,
      };
    })
    .filter(Boolean) as ResolvedDoc[];
}

export function SubEffortsLogModal({
  open,
  onClose,
  rows,
  leadNumber,
  clientName = null,
  leadStage = null,
  clientId = null,
  caseDocumentsSubfolder = CLIENT_HEADER_ONEDRIVE_SUBFOLDER,
  initialSelectedRowId,
  onRefresh,
  subEffortOptions = [],
  isLoadingSubEffortOptions = false,
  isAddingSubEffort = false,
  onAddSubEffort,
  isRemovingSubEffort = false,
  onRemoveSubEffort,
  categoryLinkedCount,
  hasLeadCaseType,
}: {
  open: boolean;
  onClose: () => void;
  rows: LeadSubEffortRow[];
  leadNumber?: string | null;
  clientName?: string | null;
  leadStage?: string | number | null;
  /** Stable client id for resolving sub-effort Sequence of Events attachments. */
  clientId?: string | null;
  caseDocumentsSubfolder?: string | null;
  initialSelectedRowId?: string | number | null;
  onRefresh?: () => void;
  subEffortOptions?: Array<{ id: number; name: string }>;
  isLoadingSubEffortOptions?: boolean;
  isAddingSubEffort?: boolean;
  onAddSubEffort?: (opt: { id: number; name: string }) => Promise<string | number | null | void>;
  isRemovingSubEffort?: boolean;
  onRemoveSubEffort?: (rowId: string | number) => Promise<void>;
  /** Templates linked to the lead case type (auto-provisioned). */
  categoryLinkedCount?: number;
  hasLeadCaseType?: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | number | null>(initialSelectedRowId ?? null);
  const [mobileStep, setMobileStep] = useState<'list' | 'details'>('list');
  const [isUploading, setIsUploading] = useState(false);
  const [signedUrls, setSignedUrls] = useState<Map<string, string>>(() => new Map());
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDraggingDocs, setIsDraggingDocs] = useState(false);
  const [isNotesModalOpen, setIsNotesModalOpen] = useState(false);
  const [notesKind, setNotesKind] = useState<'internal' | 'client'>('internal');
  const [notesDraft, setNotesDraft] = useState('');
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [isTogglingInternal, setIsTogglingInternal] = useState(false);
  const [isMarkingComplete, setIsMarkingComplete] = useState(false);
  const [isAttachModalOpen, setIsAttachModalOpen] = useState(false);
  const [caseDocs, setCaseDocs] = useState<CaseDocPick[]>([]);
  const [caseDocsLoading, setCaseDocsLoading] = useState(false);
  const [selectedCaseDocIds, setSelectedCaseDocIds] = useState<Set<string>>(() => new Set());
  const [isAttaching, setIsAttaching] = useState(false);
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewItems, setPreviewItems] = useState<DocumentPreviewItem[]>([]);
  const [previewInitialIndex, setPreviewInitialIndex] = useState(0);
  const [previewFromCaseDocs, setPreviewFromCaseDocs] = useState(false);
  const [renamingDocKey, setRenamingDocKey] = useState<string | null>(null);
  const [renameDocValue, setRenameDocValue] = useState('');
  const [renameDocSaving, setRenameDocSaving] = useState(false);
  const [folders, setFolders] = useState<SubEffortFolder[]>([]);
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [folderModalOpen, setFolderModalOpen] = useState(false);
  const [folderModalMode, setFolderModalMode] = useState<'create' | 'edit'>('create');
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [folderTitleDraft, setFolderTitleDraft] = useState('');
  const [folderNoteDraft, setFolderNoteDraft] = useState('');
  const [folderSaving, setFolderSaving] = useState(false);
  const [dragDocKey, setDragDocKey] = useState<string | null>(null);
  const [dropTargetFolderId, setDropTargetFolderId] = useState<string | null | undefined>(undefined);
  const [moveMenuDocKey, setMoveMenuDocKey] = useState<string | null>(null);
  const [moveMenuPos, setMoveMenuPos] = useState<{
    top?: number;
    bottom?: number;
    right: number;
    maxHeight: number;
  } | null>(null);
  const [docMetaByPath, setDocMetaByPath] = useState<
    Map<
      string,
      {
        documentTypeName: string | null;
        uploadedByName: string | null;
        uploadedByPhotoUrl: string | null;
        isClientPortalUpload: boolean;
      }
    >
  >(() => new Map());
  const [folderMenuId, setFolderMenuId] = useState<string | null>(null);
  const [descriptionRow, setDescriptionRow] = useState<any | null>(null);
  const [categoryModalOpen, setCategoryModalOpen] = useState<CaseDocumentCategoryKey | null>(null);
  const [clientUploadsOpen, setClientUploadsOpen] = useState(false);
  const [categoryCounts, setCategoryCounts] = useState(emptyCategoryCounts);
  const [clientUploadsCount, setClientUploadsCount] = useState(0);
  const [categoryCountsLoading, setCategoryCountsLoading] = useState(false);
  const [docCategoryBoxesOpen, setDocCategoryBoxesOpen] = useState(false);
  const [orderedTimelineRows, setOrderedTimelineRows] = useState<LeadSubEffortRow[]>([]);
  const [draggingRowId, setDraggingRowId] = useState<string | null>(null);
  const [dragOverRowId, setDragOverRowId] = useState<string | null>(null);
  const [holdingRowId, setHoldingRowId] = useState<string | null>(null);
  const [isSavingTimelineOrder, setIsSavingTimelineOrder] = useState(false);
  const [employeePhotoDirectory, setEmployeePhotoDirectory] = useState<any[]>([]);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRowIdRef = useRef<string | null>(null);
  const didHoldDragRef = useRef(false);
  const dragOverRowIdRef = useRef<string | null>(null);
  const wasOpenRef = useRef(false);

  React.useEffect(() => {
    dragOverRowIdRef.current = dragOverRowId;
  }, [dragOverRowId]);

  const timelineRowsFromProps = useMemo(
    () => sortTimelineRows(dedupeLeadSubEffortRows(rows ?? [])),
    [rows],
  );

  React.useEffect(() => {
    setOrderedTimelineRows(timelineRowsFromProps);
  }, [timelineRowsFromProps]);

  React.useEffect(() => {
    if (!moveMenuDocKey && !folderMenuId) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('[data-sub-effort-menu]')) return;
      if (target.closest('[data-sub-effort-doc-menu]')) return;
      setMoveMenuDocKey(null);
      setMoveMenuPos(null);
      setFolderMenuId(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMoveMenuDocKey(null);
        setMoveMenuPos(null);
        setFolderMenuId(null);
      }
    };
    const onReposition = () => {
      if (!moveMenuDocKey) return;
      const btn = document.querySelector(
        `[data-sub-effort-doc-trigger="${CSS.escape(moveMenuDocKey)}"]`,
      ) as HTMLElement | null;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const gap = 4;
      const margin = 8;
      const estimated = 320;
      const spaceBelow = window.innerHeight - rect.bottom - gap - margin;
      const spaceAbove = rect.top - gap - margin;
      const openUp = spaceBelow < Math.min(estimated, 240) && spaceAbove > spaceBelow;
      const available = Math.max(140, openUp ? spaceAbove : spaceBelow);
      const maxHeight = Math.min(320, available);
      const right = Math.max(8, window.innerWidth - rect.right);
      if (openUp) {
        setMoveMenuPos({
          bottom: Math.max(margin, window.innerHeight - rect.top + gap),
          right,
          maxHeight,
        });
      } else {
        setMoveMenuPos({
          top: rect.bottom + gap,
          right,
          maxHeight,
        });
      }
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [moveMenuDocKey, folderMenuId]);

  React.useEffect(() => {
    if (!open) return;
    const lead = leadNumber?.trim();
    if (!lead) {
      setCategoryCounts(emptyCategoryCounts());
      setClientUploadsCount(0);
      return;
    }
    let cancelled = false;
    setCategoryCountsLoading(true);
    void (async () => {
      try {
        const [entries, portalCount] = await Promise.all([
          Promise.all(
            SUB_EFFORT_DOC_CATEGORIES.map(async (key) => {
              const count = await fetchCaseCategoryDocumentCount(key, lead, clientId);
              return [key, count] as const;
            }),
          ),
          fetchClientPortalUploadCount(lead, clientId),
        ]);
        if (!cancelled) {
          const next = emptyCategoryCounts();
          for (const [key, count] of entries) next[key] = count;
          setCategoryCounts(next);
          setClientUploadsCount(portalCount);
        }
      } catch {
        if (!cancelled) {
          setCategoryCounts(emptyCategoryCounts());
          setClientUploadsCount(0);
        }
      } finally {
        if (!cancelled) setCategoryCountsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, leadNumber, clientId, categoryModalOpen, clientUploadsOpen]);

  const timelineRows = orderedTimelineRows;
  const currentSubEffortRowId = useMemo(() => findCurrentSubEffortRowId(timelineRows), [timelineRows]);
  const photoByUpdaterName = useMemo(
    () => buildUpdaterPhotoByName(timelineRows, employeePhotoDirectory),
    [timelineRows, employeePhotoDirectory],
  );

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('tenants_employee')
        .select('id, display_name, photo_url, photo')
        .order('display_name', { ascending: true });
      if (cancelled || error) return;
      setEmployeePhotoDirectory((data as any[]) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const emptySubEffortsMessage = useMemo(() => {
    if (hasLeadCaseType === false) {
      return 'Set a case type on this lead to load sub efforts.';
    }
    if (categoryLinkedCount === 0) {
      return 'No sub efforts are linked to this case type in Admin.';
    }
    return 'No sub efforts yet.';
  }, [categoryLinkedCount, hasLeadCaseType]);

  const availableSubEffortOptions = useMemo(() => {
    if (!onAddSubEffort) return [];
    const usedIds = new Set(
      (rows ?? [])
        .map((r: any) => Number(r?.sub_effort_id ?? r?.sub_efforts?.id))
        .filter((n: number) => Number.isFinite(n)),
    );
    const catalog =
      subEffortOptions.length > 0
        ? subEffortOptions
        : [
            { id: 1, name: 'Aplication submitted' },
            { id: 2, name: 'Communication with client' },
          ];
    return catalog.filter((opt) => !usedIds.has(Number(opt.id)));
  }, [onAddSubEffort, rows, subEffortOptions]);

  const handleAddSubEffort = useCallback(
    async (opt: { id: number; name: string }) => {
      if (!onAddSubEffort || isAddingSubEffort) return;
      const newId = await onAddSubEffort(opt);
      if (newId != null) {
        setSelectedId(newId);
        setMobileStep('details');
      }
    },
    [isAddingSubEffort, onAddSubEffort],
  );

  const selectedRow = useMemo(() => {
    if (!timelineRows.length) return null;
    if (selectedId == null) return timelineRows[0] ?? null;
    return timelineRows.find((r: any) => String(r?.id) === String(selectedId)) ?? timelineRows[0] ?? null;
  }, [timelineRows, selectedId]);

  const selectedSubCategoryEfforts = useMemo(
    () => (selectedRow ? readSubCategoryEfforts(selectedRow) : []),
    [selectedRow],
  );

  const reorderTimelineRows = useCallback((fromId: string, toId: string) => {
    if (!fromId || !toId || fromId === toId) return null;
    const fromIdx = orderedTimelineRows.findIndex((r) => String(r?.id) === fromId);
    const toIdx = orderedTimelineRows.findIndex((r) => String(r?.id) === toId);
    if (fromIdx < 0 || toIdx < 0) return null;
    const next = [...orderedTimelineRows];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    return next;
  }, [orderedTimelineRows]);

  const persistTimelineOrder = useCallback(
    async (ordered: LeadSubEffortRow[]) => {
      setIsSavingTimelineOrder(true);
      try {
        const actor = await fetchStageActorInfo();
        const results = await Promise.all(
          ordered.map((row, index) =>
            supabase
              .from('lead_sub_efforts')
              .update({ sort_order: index, ...leadSubEffortActorFields(actor) })
              .eq('id', row.id),
          ),
        );
        const err = results.find((r) => r.error)?.error;
        if (err) throw err;
        onRefresh?.();
      } catch (e: any) {
        console.error('Error saving sub effort timeline order:', e);
        toast.error(`Failed to save order: ${e?.message || 'Unknown error'}`);
        setOrderedTimelineRows(timelineRowsFromProps);
      } finally {
        setIsSavingTimelineOrder(false);
      }
    },
    [onRefresh, timelineRowsFromProps],
  );

  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  const resetTimelinePointerState = useCallback(() => {
    clearHoldTimer();
    pendingRowIdRef.current = null;
    didHoldDragRef.current = false;
    setHoldingRowId(null);
    setDraggingRowId(null);
    setDragOverRowId(null);
  }, [clearHoldTimer]);

  const handleRowPointerDown = useCallback(
    (rowId: string) => (e: React.PointerEvent) => {
      if (e.button !== 0 || isSavingTimelineOrder) return;
      pendingRowIdRef.current = rowId;
      didHoldDragRef.current = false;
      setHoldingRowId(rowId);
      clearHoldTimer();
      holdTimerRef.current = setTimeout(() => {
        didHoldDragRef.current = true;
        setDraggingRowId(rowId);
      }, TIMELINE_HOLD_MS);
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    },
    [clearHoldTimer, isSavingTimelineOrder],
  );

  const handleRowPointerUp = useCallback(
    (rowId: string, onSelect: () => void) => (e: React.PointerEvent) => {
      if (didHoldDragRef.current || draggingRowId) {
        try {
          (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        } catch {
          // ignore
        }
        return;
      }
      clearHoldTimer();
      setHoldingRowId(null);
      if (pendingRowIdRef.current === rowId) onSelect();
      pendingRowIdRef.current = null;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    },
    [clearHoldTimer, draggingRowId],
  );

  const handleRowPointerCancel = useCallback(
    (_e: React.PointerEvent) => {
      if (!didHoldDragRef.current && !draggingRowId) {
        resetTimelinePointerState();
      }
    },
    [draggingRowId, resetTimelinePointerState],
  );

  React.useEffect(() => {
    if (!draggingRowId) return;

    const onPointerMove = (e: PointerEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const id = el?.closest('[data-timeline-row-id]')?.getAttribute('data-timeline-row-id');
      if (id && id !== draggingRowId) {
        setDragOverRowId(id);
      }
    };

    const onPointerUp = () => {
      const fromId = draggingRowId;
      const toId = dragOverRowIdRef.current;
      if (fromId && toId && fromId !== toId) {
        const next = reorderTimelineRows(fromId, toId);
        if (next) {
          setOrderedTimelineRows(next);
          void persistTimelineOrder(next);
        }
      }
      resetTimelinePointerState();
    };

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerUp);
    return () => {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointercancel', onPointerUp);
    };
  }, [draggingRowId, persistTimelineOrder, reorderTimelineRows, resetTimelinePointerState]);

  const selectedIsActive = selectedRow?.active !== false;

  const resolvedDocs = useMemo(
    () => (selectedRow ? resolveSubEffortDocs(selectedRow.document_url, signedUrls) : []),
    [selectedRow, signedUrls],
  );

  const resolvedDocsWithMeta = useMemo(() => {
    if (docMetaByPath.size === 0) return resolvedDocs;
    return resolvedDocs.map((d) => {
      const key = normalizeStorageKey(d.path);
      if (!key) return d;
      const meta = docMetaByPath.get(key);
      if (!meta) return d;
      return {
        ...d,
        documentTypeName: meta.documentTypeName ?? d.documentTypeName ?? null,
        uploadedByName: meta.uploadedByName ?? d.uploadedByName ?? null,
        uploadedByPhotoUrl: meta.uploadedByPhotoUrl ?? d.uploadedByPhotoUrl ?? null,
        isClientPortalUpload: meta.isClientPortalUpload,
      };
    });
  }, [resolvedDocs, docMetaByPath]);

  React.useEffect(() => {
    if (!open) {
      setDocMetaByPath(new Map());
      return;
    }
    const lead = leadNumber?.trim();
    const paths = [
      ...new Set(
        resolvedDocs
          .map((d) => normalizeStorageKey(d.path))
          .filter(Boolean),
      ),
    ];
    if (!lead || paths.length === 0) {
      setDocMetaByPath(new Map());
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const { data: rows, error } = await supabase
          .from('lead_case_documents')
          .select('storage_path, document_type_id, contact_id, uploaded_by')
          .eq('lead_number', lead)
          .in('storage_path', paths);
        if (error || cancelled) return;
        const typed = (rows ?? []) as {
          storage_path: string;
          document_type_id: string | null;
          contact_id: number | null;
          uploaded_by: string | null;
        }[];

        const typeIds = [
          ...new Set(
            typed
              .map((r) => (typeof r.document_type_id === 'string' ? r.document_type_id.trim() : ''))
              .filter(Boolean),
          ),
        ];
        const nameById = new Map<string, string>();
        if (typeIds.length > 0) {
          const { data: types } = await supabase
            .from('lead_case_document_types')
            .select('id, name')
            .in('id', typeIds);
          for (const t of (types ?? []) as { id: string; name: string | null }[]) {
            const n = t.name?.trim();
            if (n) nameById.set(String(t.id), n);
          }
        }

        const contactIds = [
          ...new Set(
            typed
              .map((r) => r.contact_id)
              .filter((id): id is number => id != null && Number.isFinite(Number(id))),
          ),
        ];
        const contactNameById = new Map<number, string>();
        if (contactIds.length > 0) {
          const { data: contacts } = await supabase
            .from('leads_contact')
            .select('id, name')
            .in('id', contactIds);
          for (const c of (contacts ?? []) as { id: number; name: string | null }[]) {
            const n = c.name?.trim();
            if (n) contactNameById.set(Number(c.id), n);
          }
        }

        const uploaderKeys = [
          ...new Set(
            typed
              .filter((r) => r.contact_id == null)
              .map((r) => r.uploaded_by?.trim())
              .filter(Boolean) as string[],
          ),
        ];
        const uploaderMap = await resolveUploaderDisplayByKey(uploaderKeys);
        if (cancelled) return;

        const next = new Map<
          string,
          {
            documentTypeName: string | null;
            uploadedByName: string | null;
            uploadedByPhotoUrl: string | null;
            isClientPortalUpload: boolean;
          }
        >();
        for (const r of typed) {
          const key = normalizeStorageKey(r.storage_path);
          if (!key) continue;
          const typeId = typeof r.document_type_id === 'string' ? r.document_type_id.trim() : '';
          const fromContact =
            r.contact_id != null ? contactNameById.get(Number(r.contact_id)) ?? null : null;
          const rawUploader = r.uploaded_by?.trim() || null;
          const resolved = rawUploader ? uploaderMap.get(rawUploader) : undefined;
          const isClientPortalUpload =
            Boolean(fromContact) || Boolean(rawUploader && !resolved?.matched);
          next.set(key, {
            documentTypeName: typeId ? nameById.get(typeId) ?? null : null,
            uploadedByName: fromContact || resolved?.name || rawUploader || null,
            uploadedByPhotoUrl:
              !isClientPortalUpload && resolved?.photoUrl ? resolved.photoUrl : null,
            isClientPortalUpload,
          });
        }
        setDocMetaByPath(next);
      } catch (e) {
        console.warn('sub-effort document meta lookup:', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, leadNumber, resolvedDocs]);

  React.useEffect(() => {
    setRenamingDocKey(null);
    setRenameDocValue('');
    setRenameDocSaving(false);
    setActiveFolderId(null);
    setMoveMenuDocKey(null);
    setMoveMenuPos(null);
    setFolderMenuId(null);
    setDragDocKey(null);
    setDropTargetFolderId(undefined);
  }, [selectedRow?.id]);

  const loadFolders = useCallback(async (subEffortId: number | string) => {
    setFoldersLoading(true);
    try {
      const { data, error } = await supabase
        .from('lead_sub_effort_folders')
        .select('id, lead_sub_effort_id, title, note, created_by, created_at, sort_order')
        .eq('lead_sub_effort_id', subEffortId)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw error;
      setFolders((data as SubEffortFolder[]) ?? []);
    } catch (e) {
      console.error('Error loading sub-effort folders:', e);
      setFolders([]);
    } finally {
      setFoldersLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (!open || !selectedRow?.id) {
      setFolders([]);
      return;
    }
    void loadFolders(selectedRow.id);
  }, [open, selectedRow?.id, loadFolders]);

  const activeFolder = useMemo(
    () => (activeFolderId ? folders.find((f) => f.id === activeFolderId) ?? null : null),
    [activeFolderId, folders],
  );

  React.useEffect(() => {
    if (activeFolderId && folders.length > 0 && !folders.some((f) => f.id === activeFolderId)) {
      setActiveFolderId(null);
    }
  }, [activeFolderId, folders]);

  const visibleDocs = useMemo(() => {
    if (activeFolderId) {
      return resolvedDocsWithMeta.filter((d) => d.folder_id === activeFolderId);
    }
    return resolvedDocsWithMeta.filter((d) => !d.folder_id);
  }, [resolvedDocsWithMeta, activeFolderId]);

  const downloadAllDocuments = useCallback(async () => {
    if (isDownloadingAll) return;
    // Always zip every document on this sub effort (not only the active folder).
    const ready = resolvedDocs.filter((d) => !!(d.url || d.raw));
    if (!ready.length) {
      toast.error('No documents to download');
      return;
    }

    setIsDownloadingAll(true);
    const toastId = 'se-download-all';
    toast.loading(`Preparing zip (${ready.length} file${ready.length === 1 ? '' : 's'})…`, {
      id: toastId,
    });

    try {
      const effortName = readSubEffortName(selectedRow).trim() || 'documents';
      const leadPart = leadNumber?.trim() ? `${leadNumber.trim()} ` : '';
      const { successCount, errorCount } = await downloadFilesAsZip({
        files: ready.map((doc) => ({
          url: String(doc.url || doc.raw),
          name: doc.name || 'document',
        })),
        zipFileName: `${leadPart}${effortName}`,
        onProgress: (done, total) => {
          toast.loading(`Zipping ${done}/${total}…`, { id: toastId });
        },
      });

      if (successCount > 0 && errorCount === 0) {
        toast.success(`Downloaded zip with ${successCount} document${successCount === 1 ? '' : 's'}`, {
          id: toastId,
        });
      } else if (successCount > 0) {
        toast.success(`Zip ready (${successCount} files, ${errorCount} failed)`, { id: toastId });
      } else {
        toast.error('Failed to download documents', { id: toastId });
      }
    } catch (err) {
      console.error('downloadAllDocuments zip:', err);
      toast.error('Failed to create zip', { id: toastId });
    } finally {
      setIsDownloadingAll(false);
    }
  }, [isDownloadingAll, leadNumber, resolvedDocs, selectedRow]);

  const openDocPreview = useCallback(
    (doc: ResolvedDoc) => {
      if (!doc.url) return;
      const items = resolvedDocsToPreviewItems(visibleDocs);
      const docId = doc.path || doc.raw || doc.url;
      const idx = items.findIndex((item) => item.id === docId);
      setPreviewItems(items);
      setPreviewInitialIndex(idx >= 0 ? idx : 0);
      setPreviewFromCaseDocs(false);
      setPreviewOpen(true);
    },
    [visibleDocs],
  );

  const openCaseDocPreview = useCallback((doc: CaseDocPick) => {
    const url = String(doc.signedUrl || '').trim();
    if (!url) {
      toast.error('No preview link is available for this file yet.');
      return;
    }
    const items: DocumentPreviewItem[] = caseDocs
      .filter((d) => Boolean(String(d.signedUrl || '').trim()))
      .map((d) => ({
        id: d.id,
        name: d.file_name || 'Document',
        downloadUrl: String(d.signedUrl),
        fileType: d.mime_type || inferMimeFromName(d.file_name),
        lastModified: d.created_at,
        storagePath: d.storage_path || null,
      }));
    const idx = items.findIndex((item) => item.id === doc.id);
    setPreviewItems(items);
    setPreviewInitialIndex(idx >= 0 ? idx : 0);
    setPreviewFromCaseDocs(true);
    setPreviewOpen(true);
  }, [caseDocs]);

  const renameSubEffortDocument = useCallback(
    async (docKey: string, newName: string) => {
      if (!selectedRow?.id) throw new Error('No sub-effort selected');
      const trimmed = newName.trim();
      if (!trimmed) throw new Error('Name is required');

      const existingItems = normalizeDocItems(selectedRow.document_url);
      let found = false;
      const next = existingItems.map((it) => {
        const key = String(it.path || it.url || '').trim();
        if (key && key === docKey) {
          found = true;
          return { ...it, name: trimmed };
        }
        return it;
      });
      if (!found) throw new Error('Document not found');

      const actor = await fetchStageActorInfo();
      const { error } = await supabase
        .from('lead_sub_efforts')
        .update({ document_url: next, ...leadSubEffortActorFields(actor) })
        .eq('id', selectedRow.id);
      if (error) throw error;

      setPreviewItems((prev) => prev.map((p) => (p.id === docKey ? { ...p, name: trimmed } : p)));
      onRefresh?.();
    },
    [selectedRow, onRefresh],
  );

  const deleteSubEffortDocument = useCallback(
    async (doc: ResolvedDoc) => {
      if (!selectedRow?.id) {
        toast.error('No sub-effort selected');
        return;
      }
      const docKey = String(doc.path || doc.raw || '').trim();
      if (!docKey) {
        toast.error('Missing document path');
        return;
      }
      if (!window.confirm(`Remove “${doc.name}” from this sub effort?`)) return;

      try {
        const existingItems = normalizeDocItems(selectedRow.document_url);
        const next = existingItems.filter((it) => {
          const key = String(it.path || it.url || '').trim();
          return key !== docKey;
        });
        if (next.length === existingItems.length) {
          toast.error('Document not found');
          return;
        }
        const actor = await fetchStageActorInfo();
        const { error } = await supabase
          .from('lead_sub_efforts')
          .update({ document_url: next, ...leadSubEffortActorFields(actor) })
          .eq('id', selectedRow.id);
        if (error) throw error;
        toast.success('Document removed');
        onRefresh?.();
      } catch (e: unknown) {
        console.error('deleteSubEffortDocument:', e);
        toast.error(e instanceof Error ? e.message : 'Failed to delete document');
      }
    },
    [selectedRow, onRefresh],
  );

  const moveDocToFolder = useCallback(
    async (docKey: string, targetFolderId: string | null) => {
      if (!selectedRow?.id) return;
      const existingItems = normalizeDocItems(selectedRow.document_url);
      let found = false;
      const next = existingItems.map((it) => {
        const key = String(it.path || it.url || '').trim();
        if (key && key === docKey) {
          found = true;
          const current = it.folder_id ?? null;
          if (current === targetFolderId) return it;
          return { ...it, folder_id: targetFolderId };
        }
        return it;
      });
      if (!found) {
        toast.error('Document not found');
        return;
      }

      try {
        const actor = await fetchStageActorInfo();
        const { error } = await supabase
          .from('lead_sub_efforts')
          .update({ document_url: next, ...leadSubEffortActorFields(actor) })
          .eq('id', selectedRow.id);
        if (error) throw error;
        toast.success(targetFolderId ? 'Moved to folder' : 'Moved to Unfiled');
        setMoveMenuDocKey(null);
        onRefresh?.();
      } catch (e: any) {
        console.error('moveDocToFolder:', e);
        toast.error(e?.message || 'Failed to move document');
      }
    },
    [selectedRow, onRefresh],
  );

  const openCreateFolderModal = () => {
    setFolderModalMode('create');
    setEditingFolderId(null);
    setFolderTitleDraft('');
    setFolderNoteDraft('');
    setFolderModalOpen(true);
  };

  const openEditFolderModal = (folder: SubEffortFolder) => {
    setFolderModalMode('edit');
    setEditingFolderId(folder.id);
    setFolderTitleDraft(folder.title || '');
    setFolderNoteDraft(folder.note || '');
    setFolderModalOpen(true);
    setFolderMenuId(null);
  };

  const saveFolderModal = async () => {
    if (!selectedRow?.id || folderSaving) return;
    const title = folderTitleDraft.trim();
    if (!title) {
      toast.error('Folder title is required');
      return;
    }
    const note = folderNoteDraft.trim() || null;
    setFolderSaving(true);
    try {
      if (folderModalMode === 'create') {
        const actor = await fetchStageActorInfo();
        const maxSort = folders.reduce((m, f) => Math.max(m, Number(f.sort_order) || 0), -1);
        const { error } = await supabase.from('lead_sub_effort_folders').insert({
          lead_sub_effort_id: selectedRow.id,
          title,
          note,
          created_by: actor.fullName,
          sort_order: maxSort + 1,
        });
        if (error) throw error;
        toast.success('Folder created');
      } else if (editingFolderId) {
        const { error } = await supabase
          .from('lead_sub_effort_folders')
          .update({ title, note })
          .eq('id', editingFolderId);
        if (error) throw error;
        toast.success('Folder updated');
      }
      setFolderModalOpen(false);
      await loadFolders(selectedRow.id);
    } catch (e: any) {
      console.error('saveFolderModal:', e);
      toast.error(e?.message || 'Failed to save folder');
    } finally {
      setFolderSaving(false);
    }
  };

  const deleteFolder = async (folder: SubEffortFolder) => {
    if (!selectedRow?.id) return;
    const ok = window.confirm(
      `Delete folder “${folder.title}”? Documents inside will move to Unfiled.`,
    );
    if (!ok) return;
    setFolderMenuId(null);
    try {
      const existingItems = normalizeDocItems(selectedRow.document_url);
      const next = existingItems.map((it) =>
        it.folder_id === folder.id ? { ...it, folder_id: null } : it,
      );
      const actor = await fetchStageActorInfo();
      const { error: docsError } = await supabase
        .from('lead_sub_efforts')
        .update({ document_url: next, ...leadSubEffortActorFields(actor) })
        .eq('id', selectedRow.id);
      if (docsError) throw docsError;

      const { error } = await supabase.from('lead_sub_effort_folders').delete().eq('id', folder.id);
      if (error) throw error;

      if (activeFolderId === folder.id) setActiveFolderId(null);
      toast.success('Folder deleted');
      await loadFolders(selectedRow.id);
      onRefresh?.();
    } catch (e: any) {
      console.error('deleteFolder:', e);
      toast.error(e?.message || 'Failed to delete folder');
    }
  };

  const startInlineRename = (doc: ResolvedDoc) => {
    const key = String(doc.path || doc.raw || '').trim();
    if (!key) {
      toast.error('This document cannot be renamed');
      return;
    }
    setRenamingDocKey(key);
    setRenameDocValue(doc.name);
  };

  const cancelInlineRename = () => {
    setRenamingDocKey(null);
    setRenameDocValue('');
    setRenameDocSaving(false);
  };

  const saveInlineRename = async () => {
    if (!renamingDocKey || renameDocSaving) return;
    const trimmed = renameDocValue.trim();
    if (!trimmed) {
      toast.error('Name is required');
      return;
    }
    setRenameDocSaving(true);
    try {
      await renameSubEffortDocument(renamingDocKey, trimmed);
      toast.success('Name updated');
      cancelInlineRename();
    } catch (e: any) {
      console.error('Rename sub-effort document:', e);
      toast.error(e?.message || 'Failed to rename');
      setRenameDocSaving(false);
    }
  };

  // Sync selection only when the modal opens — not when rows refresh after save.
  React.useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      setClientUploadsOpen(false);
      setCategoryModalOpen(null);
      return;
    }

    const justOpened = !wasOpenRef.current;
    wasOpenRef.current = true;

    if (!justOpened) return;

    setMobileStep('list');
    setDocCategoryBoxesOpen(false);
    if (initialSelectedRowId != null) {
      setSelectedId(initialSelectedRowId);
    }
  }, [open, initialSelectedRowId]);

  React.useEffect(() => {
    if (!open) return;
    if (selectedId != null) return;
    const firstId = timelineRowsFromProps[0]?.id;
    if (firstId != null) setSelectedId(firstId);
  }, [open, selectedId, timelineRowsFromProps]);

  // Resolve storage paths (private bucket) to signed URLs for previews.
  React.useEffect(() => {
    if (!open) return;
    if (!selectedRow) return;
    const paths = guessPathList(selectedRow?.document_url);
    if (!paths.length) return;
    let cancelled = false;
    void (async () => {
      try {
        const missing = paths.filter((p) => !signedUrls.has(p));
        if (!missing.length) return;
        // Prefer bulk API (faster), but fall back for older/limited environments.
        const storageBucket: any = supabase.storage.from(SUB_EFFORTS_DOCS_BUCKET) as any;
        let data: any[] = [];
        if (typeof storageBucket.createSignedUrls === 'function') {
          const res = await storageBucket.createSignedUrls(missing, 60 * 60);
          if (res?.error) throw res.error;
          data = res?.data ?? [];
        } else {
          const results = await Promise.all(
            missing.map(async (p) => {
              const res = await storageBucket.createSignedUrl(p, 60 * 60);
              if (res?.error) throw res.error;
              return { path: p, signedUrl: res?.data?.signedUrl };
            })
          );
          data = results;
        }
        if (cancelled) return;
        setSignedUrls((prev) => {
          const next = new Map(prev);
          for (const item of data ?? []) {
            if (item?.path && item?.signedUrl) next.set(item.path, item.signedUrl);
          }
          return next;
        });
      } catch (e) {
        console.error('Error creating signed URLs for sub effort documents:', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, selectedRow?.document_url, selectedRow?.id, signedUrls]);

  const toggleInternal = async () => {
    if (!selectedRow?.id) return;
    if (isTogglingInternal) return;
    setIsTogglingInternal(true);
    try {
      const actor = await fetchStageActorInfo();
      const nextVal = !(selectedRow?.internal === true);
      const { error } = await supabase
        .from('lead_sub_efforts')
        .update({ internal: nextVal, ...leadSubEffortActorFields(actor) })
        .eq('id', selectedRow.id);
      if (error) throw error;
      toast.success(nextVal ? 'Marked as internal' : 'Marked as visible to client');
      onRefresh?.();
    } catch (e: any) {
      console.error('Error toggling internal:', e);
      toast.error(`Failed to update: ${e?.message || 'Unknown error'}`);
    } finally {
      setIsTogglingInternal(false);
    }
  };

  const resetVisibilityToDefault = async () => {
    if (!selectedRow?.id) return;
    if (isTogglingInternal) return;
    const templateInternal = leadSubEffortInternalFromTemplate(readDefaultClientVisible(selectedRow));
    if ((selectedRow?.internal === true) === templateInternal) return;

    setIsTogglingInternal(true);
    try {
      const actor = await fetchStageActorInfo();
      const { error } = await supabase
        .from('lead_sub_efforts')
        .update({ internal: templateInternal, ...leadSubEffortActorFields(actor) })
        .eq('id', selectedRow.id);
      if (error) throw error;
      toast.success('Visibility reset to template default');
      onRefresh?.();
    } catch (e: any) {
      console.error('Error resetting sub effort visibility:', e);
      toast.error(`Failed to update: ${e?.message || 'Unknown error'}`);
    } finally {
      setIsTogglingInternal(false);
    }
  };

  const openNotesEditor = (kind: 'internal' | 'client') => {
    setNotesKind(kind);
    const current =
      kind === 'internal' ? (selectedRow?.internal_notes ?? '') : (selectedRow?.client_notes ?? '');
    setNotesDraft(String(current ?? ''));
    setIsNotesModalOpen(true);
  };

  const saveNotes = async () => {
    if (!selectedRow?.id) return;
    if (isSavingNotes) return;
    setIsSavingNotes(true);
    try {
      const actor = await fetchStageActorInfo();
      const patch: any = notesKind === 'internal'
        ? { internal_notes: notesDraft, ...leadSubEffortActorFields(actor) }
        : { client_notes: notesDraft, ...leadSubEffortActorFields(actor) };
      const { error } = await supabase
        .from('lead_sub_efforts')
        .update(patch)
        .eq('id', selectedRow.id);
      if (error) throw error;
      toast.success('Notes saved');
      setIsNotesModalOpen(false);
      onRefresh?.();
    } catch (e: any) {
      console.error('Error saving sub effort notes:', e);
      toast.error(`Failed to save notes: ${e?.message || 'Unknown error'}`);
    } finally {
      setIsSavingNotes(false);
    }
  };

  const handleUploadFiles = async (files: FileList | null) => {
    if (!selectedRow?.id) return;
    if (!files || files.length === 0) return;
    if (isUploading) return;

    setIsUploading(true);
    try {
      const id = selectedRow.id;
      const leadKey = selectedRow?.new_lead_id || selectedRow?.legacy_lead_id || 'unknown-lead';
      const uploadedPaths: string[] = [];
      const uploadedMimeTypes: string[] = [];

      for (const file of Array.from(files)) {
        const safeName = file.name.replace(/[^\w.\-()+\s]/g, '_');
        // Storage object path is *inside* the bucket (do not prefix bucket name).
        const path = `sub-efforts/${String(leadKey)}/${String(id)}/${Date.now()}_${safeName}`;
        const contentType = resolveCaseDocumentUploadContentType(file);
        const { error } = await supabase.storage.from(SUB_EFFORTS_DOCS_BUCKET).upload(path, file, {
          upsert: false,
          contentType,
        });
        if (error) throw error;
        uploadedPaths.push(path);
        uploadedMimeTypes.push(contentType);
      }

      // Merge into existing document_url (store paths; modal will sign them for display)
      const existingItems = normalizeDocItems(selectedRow?.document_url);
      const existingKeySet = new Set(existingItems.map((d) => d.path || d.url).filter(Boolean) as string[]);
      const addedItems: DocItem[] = Array.from(files).map((file, idx) => {
        const item: DocItem = {
          path: uploadedPaths[idx],
          name: file.name,
          mimeType: uploadedMimeTypes[idx],
        };
        if (activeFolderId) item.folder_id = activeFolderId;
        return item;
      });
      const mergedItems = [
        ...existingItems,
        ...addedItems.filter((d) => {
          const k = d.path || d.url;
          return k ? !existingKeySet.has(k) : false;
        }),
      ];
      const nextDocumentUrl = mergedItems;

      const actor = await fetchStageActorInfo();
      const { error: updateError } = await supabase
        .from('lead_sub_efforts')
        .update({ document_url: nextDocumentUrl, ...leadSubEffortActorFields(actor) })
        .eq('id', selectedRow.id);
      if (updateError) throw updateError;

      toast.success('Documents uploaded');
      onRefresh?.();
    } catch (e: any) {
      console.error('Error uploading sub effort documents:', e);
      toast.error(`Upload failed: ${e?.message || 'Unknown error'}`);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const openAttachFromCaseDocs = async () => {
    if (!leadNumber?.trim()) {
      toast.error('Lead number is missing, cannot load case documents.');
      return;
    }
    setIsAttachModalOpen(true);
    setSelectedCaseDocIds(new Set());
    setCaseDocsLoading(true);
    try {
      const sub = caseDocumentsSubfolder?.trim() ? caseDocumentsSubfolder.trim() : null;
      let q = supabase
        .from('lead_case_documents')
        .select('id, file_name, storage_path, mime_type, created_at')
        .eq('lead_number', leadNumber.trim())
        .not('storage_path', 'is', null)
        .order('created_at', { ascending: false })
        .limit(100);
      if (sub) q = q.eq('onedrive_subfolder', sub);
      else q = q.is('onedrive_subfolder', null);

      const { data, error } = await q;
      if (error) throw error;
      const base = ((data as any[]) || []).map((r) => ({
        id: String(r.id),
        file_name: String(r.file_name || ''),
        storage_path: String(r.storage_path || ''),
        mime_type: typeof r.mime_type === 'string' ? (r.mime_type as string) : null,
        created_at: String(r.created_at || new Date().toISOString()),
      })) as CaseDocPick[];

      // Sign URLs for preview/open (images + docs)
      const storage = supabase.storage.from(SUB_EFFORTS_DOCS_BUCKET) as any;
      const signSeconds = 60 * 60;

      const withUrls: CaseDocPick[] = await Promise.all(
        base.map(async (d) => {
          if (!d.storage_path) return d;
          try {
            const { data: signed } = await storage.createSignedUrl(d.storage_path, signSeconds);
            const u = signed?.signedUrl ? String(signed.signedUrl) : '';
            return u ? { ...d, signedUrl: u } : d;
          } catch {
            return d;
          }
        }),
      );

      setCaseDocs(withUrls);
    } catch (e: any) {
      console.error('openAttachFromCaseDocs:', e);
      toast.error(String(e?.message || 'Failed to load case documents'));
      setCaseDocs([]);
    } finally {
      setCaseDocsLoading(false);
    }
  };

  const attachSelectedCaseDocs = async () => {
    if (!selectedRow?.id) return;
    if (isAttaching) return;
    const ids = [...selectedCaseDocIds];
    if (ids.length === 0) {
      toast.error('Select at least one file to attach.');
      return;
    }
    setIsAttaching(true);
    try {
      const existingItems = normalizeDocItems(selectedRow?.document_url);
      const existingKeySet = new Set(existingItems.map((d) => (d.path || d.url || '').trim()).filter(Boolean));

      const picked = caseDocs.filter((d) => selectedCaseDocIds.has(d.id));
      const addedItems: DocItem[] = picked
        .filter((d) => d.storage_path?.trim())
        .map((d) => {
          const item: DocItem = {
            path: d.storage_path.trim(),
            name: d.file_name || undefined,
            mimeType: d.mime_type || inferMimeFromName(d.file_name),
          };
          if (activeFolderId) item.folder_id = activeFolderId;
          return item;
        })
        .filter((d) => d.path && !existingKeySet.has(String(d.path)));

      const merged = [...existingItems, ...addedItems];

      const actor = await fetchStageActorInfo();
      const { error } = await supabase
        .from('lead_sub_efforts')
        .update({ document_url: merged, ...leadSubEffortActorFields(actor) })
        .eq('id', selectedRow.id);
      if (error) throw error;

      toast.success('Attached to sub effort');
      setIsAttachModalOpen(false);
      onRefresh?.();
    } catch (e: any) {
      console.error('attachSelectedCaseDocs:', e);
      toast.error(String(e?.message || 'Failed to attach'));
    } finally {
      setIsAttaching(false);
    }
  };

  const toggleComplete = async () => {
    if (!selectedRow?.id) return;
    if (isMarkingComplete) return;
    setIsMarkingComplete(true);
    try {
      const nextActive = selectedRow?.active === false;
      const actor = await fetchStageActorInfo();
      const { error } = await supabase
        .from('lead_sub_efforts')
        .update({ active: nextActive, ...leadSubEffortActorFields(actor) })
        .eq('id', selectedRow.id);
      if (error) throw error;
      toast.success(nextActive ? 'Sub effort reopened' : 'Marked as complete');
      onRefresh?.();
    } catch (e: any) {
      console.error('Error toggling sub effort complete:', e);
      toast.error(`Failed to update: ${e?.message || 'Unknown error'}`);
    } finally {
      setIsMarkingComplete(false);
    }
  };

  if (!open) return null;

  return (
    <>
    <MobileBottomSheet
      open={open}
      onClose={onClose}
      hideDefaultHeader
      hideDragHandle
      mobileFullPage
      mobileFullHeight
      desktopFullScreen
      zIndex={50}
      contentClassName="!p-0 flex flex-col min-h-0 !overflow-hidden"
    >
        <div className="flex flex-col min-h-0 h-full flex-1 overflow-hidden bg-[#f5f5f5]">
        <div className="flex shrink-0 items-start justify-between gap-3 px-4 py-3 md:px-6 md:py-4">
          <div className="min-w-0 flex-1 flex items-start gap-3">
            {mobileStep === 'details' ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-square mt-0.5 md:hidden"
                onClick={() => setMobileStep('list')}
                aria-label="Back to list"
                title="Back"
              >
                <ChevronLeftIcon className="w-5 h-5" />
              </button>
            ) : null}
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-col gap-2 md:flex-row md:flex-wrap md:items-center md:gap-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <div className="text-xl font-bold tracking-tight text-base-content/95">Sub efforts</div>
                  <button
                    type="button"
                    className="inline-flex h-8 items-center gap-1 rounded-full bg-white px-2.5 text-xs font-semibold text-gray-600 shadow-sm transition-colors hover:bg-gray-50 md:hidden"
                    onClick={() => setDocCategoryBoxesOpen((v) => !v)}
                    aria-expanded={docCategoryBoxesOpen}
                    aria-controls="sub-effort-doc-category-boxes"
                    title={docCategoryBoxesOpen ? 'Hide document boxes' : 'Show document boxes'}
                  >
                    {docCategoryBoxesOpen ? (
                      <ChevronDownIcon className="h-4 w-4" />
                    ) : (
                      <ChevronRightIcon className="h-4 w-4" />
                    )}
                    <span>{docCategoryBoxesOpen ? 'Hide docs' : 'Docs'}</span>
                  </button>
                </div>
                <div
                  id="sub-effort-doc-category-boxes"
                  className={`w-full min-w-0 flex-col gap-2 md:flex md:w-auto md:flex-1 md:flex-row md:flex-wrap md:items-center md:gap-2 ${
                    docCategoryBoxesOpen ? 'flex' : 'hidden'
                  }`}
                >
                  {SUB_EFFORT_DOC_CATEGORIES.map((key) => {
                    const meta = CASE_DOCUMENT_CATEGORY_META[key];
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setCategoryModalOpen(key)}
                        disabled={!leadNumber?.trim()}
                        className="inline-flex h-auto min-h-0 w-full touch-manipulation select-none items-center justify-between gap-2 whitespace-nowrap rounded-lg border-0 bg-gray-100 px-3 py-2.5 text-sm font-bold text-gray-700 shadow-none transition-colors hover:bg-gray-200 disabled:opacity-50 md:h-8 md:w-auto md:justify-start md:py-1.5 md:px-2.5 md:text-xs"
                        title={`${meta.title} documents`}
                      >
                        <span className="min-w-0 truncate">{meta.title}</span>
                        <span className="inline-flex min-w-[22px] shrink-0 items-center justify-center rounded-full bg-white px-2 py-0.5 text-xs font-semibold tabular-nums text-gray-600">
                          {categoryCountsLoading ? '…' : categoryCounts[key]}
                        </span>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => setClientUploadsOpen(true)}
                    disabled={!leadNumber?.trim()}
                    className="inline-flex h-auto min-h-0 w-full touch-manipulation select-none items-center justify-between gap-2 whitespace-nowrap rounded-lg border-0 bg-gray-100 px-3 py-2.5 text-sm font-bold text-gray-700 shadow-none transition-colors hover:bg-gray-200 disabled:opacity-50 md:h-8 md:w-auto md:justify-start md:py-1.5 md:px-2.5 md:text-xs"
                    title="Client portal uploads"
                  >
                    <span className="min-w-0 truncate">Client uploads</span>
                    <span className="inline-flex min-w-[22px] shrink-0 items-center justify-center rounded-full bg-white px-2 py-0.5 text-xs font-semibold tabular-nums text-gray-600">
                      {categoryCountsLoading ? '…' : clientUploadsCount}
                    </span>
                  </button>
                </div>
              </div>
              <div className="mt-0.5 text-xs text-base-content/50 truncate">
                {rows?.length ? `${rows.length} step${rows.length === 1 ? '' : 's'} in this case` : 'No steps yet'}
              </div>
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

        <div className="min-h-0 flex-1 overflow-auto scrollbar-hide px-4 pb-4 md:overflow-hidden md:px-6 md:pb-6">
          <div className="grid grid-cols-1 gap-4 md:h-full md:min-h-0 md:grid-cols-[minmax(280px,340px)_1fr] lg:grid-cols-[minmax(300px,360px)_1fr]">
            {/* Workflow — independent scroll on desktop */}
            <div
              className={
                mobileStep === 'details'
                  ? 'hidden md:flex md:h-full md:min-h-0 md:flex-col'
                  : 'block md:flex md:h-full md:min-h-0 md:flex-col'
              }
            >
              <div className="flex flex-col overflow-visible rounded-[18px] border border-gray-200 bg-white/85 p-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)] md:h-full md:min-h-0 md:p-5">
                <div className="mb-3 flex shrink-0 items-center justify-between gap-2 px-0.5">
                  <div>
                    <span className="text-base font-semibold text-base-content/80 md:text-lg">Workflow</span>
                  </div>
                  {isSavingTimelineOrder ? (
                    <span className="loading loading-spinner loading-xs text-base-content/40" />
                  ) : null}
                </div>
                {timelineRows.length ? (
                  <div className="min-h-0 scrollbar-hide md:flex-1 md:overflow-y-auto md:overscroll-y-contain">
                    {timelineRows.map((r: any, index: number) => {
                      const rowId = String(r?.id);
                      const isSelected = selectedRow?.id != null && String(selectedRow.id) === rowId;
                      const progress = getSubEffortProgress(r, currentSubEffortRowId);
                      const nextProgress =
                        index < timelineRows.length - 1
                          ? getSubEffortProgress(timelineRows[index + 1], currentSubEffortRowId)
                          : null;
                      const connectsDoneToDone =
                        progress === 'completed' && nextProgress === 'completed';
                      return (
                        <TimelineStepButton
                          key={r?.id ?? index}
                          rowId={rowId}
                          row={r}
                          stepNumber={index + 1}
                          progress={progress}
                          isSelected={isSelected}
                          isLast={index === timelineRows.length - 1}
                          connectsDoneToDone={connectsDoneToDone}
                          photoByUpdaterName={photoByUpdaterName}
                          isDragging={draggingRowId === rowId}
                          isHolding={holdingRowId === rowId && draggingRowId !== rowId}
                          isDragOver={dragOverRowId === rowId && draggingRowId !== rowId}
                          onSelect={() => {
                            setSelectedId(r?.id ?? null);
                            setMobileStep('details');
                          }}
                          onPointerDown={handleRowPointerDown(rowId)}
                          onPointerUp={handleRowPointerUp(rowId, () => {
                            setSelectedId(r?.id ?? null);
                            setMobileStep('details');
                          })}
                          onPointerCancel={handleRowPointerCancel}
                          onOpenDescription={() => setDescriptionRow(r)}
                        />
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-base-content/50 md:flex-1">
                    {emptySubEffortsMessage}
                  </div>
                )}

                {onAddSubEffort || onRemoveSubEffort ? (
                  <div className="relative z-20 mt-4 flex shrink-0 flex-row items-stretch gap-2 overflow-visible border-t border-gray-200/80 pt-4">
                    {onAddSubEffort ? (
                      <div className="dropdown dropdown-top min-w-0 flex-1">
                        <button
                          type="button"
                          tabIndex={0}
                          disabled={isLoadingSubEffortOptions || isAddingSubEffort || isRemovingSubEffort}
                          className="btn btn-sm h-10 w-full justify-between rounded-xl border border-gray-200 bg-white px-3 font-medium text-gray-700 shadow-sm hover:bg-gray-50"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            {isAddingSubEffort ? (
                              <span className="loading loading-spinner loading-xs" />
                            ) : (
                              <PlusIcon className="h-4 w-4 shrink-0" />
                            )}
                            <span className="truncate">Add</span>
                          </span>
                          <ChevronDownIcon className="h-4 w-4 shrink-0 text-gray-400" />
                        </button>
                        <ul
                          tabIndex={0}
                          className="dropdown-content menu z-[80] mb-2 flex max-h-64 w-[min(22rem,calc(100vw-2rem))] min-w-[15rem] flex-col flex-nowrap overflow-y-auto overscroll-y-contain rounded-xl border border-gray-200 bg-white p-2 shadow-lg"
                        >
                          {isLoadingSubEffortOptions ? (
                            <li>
                              <span className="px-3 py-2 text-sm text-gray-500">Loading options…</span>
                            </li>
                          ) : availableSubEffortOptions.length === 0 ? (
                            <li>
                              <span className="px-3 py-2 text-sm text-gray-500">No more sub efforts</span>
                            </li>
                          ) : (
                            availableSubEffortOptions.map((opt) => (
                              <li key={opt.id} className="w-full">
                                <button
                                  type="button"
                                  className="flex w-full items-start gap-2 rounded-lg text-left text-sm whitespace-normal break-words"
                                  onClick={() => void handleAddSubEffort(opt)}
                                >
                                  <PlusIcon className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                                  <span className="min-w-0 flex-1">{opt.name}</span>
                                </button>
                              </li>
                            ))
                          )}
                        </ul>
                      </div>
                    ) : null}
                    {onRemoveSubEffort && selectedRow?.id != null ? (
                      <button
                        type="button"
                        className="btn btn-sm h-10 min-w-0 flex-1 gap-2 rounded-xl border border-red-200 bg-white font-medium text-red-600 shadow-sm hover:bg-red-50"
                        disabled={isRemovingSubEffort || isAddingSubEffort}
                        onClick={() => void onRemoveSubEffort(selectedRow.id)}
                      >
                        {isRemovingSubEffort ? (
                          <span className="loading loading-spinner loading-xs" />
                        ) : (
                          <TrashIcon className="h-4 w-4 shrink-0" />
                        )}
                        <span className="truncate">Remove</span>
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>

            {/* Detail panels — scrolls independently on desktop */}
            <div
              className={
                mobileStep === 'details'
                  ? 'block scrollbar-hide md:h-full md:min-h-0 md:overflow-y-auto md:overscroll-y-contain'
                  : 'hidden scrollbar-hide md:block md:h-full md:min-h-0 md:overflow-y-auto md:overscroll-y-contain'
              }
            >
              <div className="flex min-h-full flex-col space-y-4">                {selectedRow ? (
                  <>
                    <div className="overflow-hidden rounded-[18px] bg-white shadow-sm">
                      <div className="relative min-h-[168px] overflow-hidden sm:min-h-[190px]">
                        {(() => {
                          const heroName = readSubEffortName(selectedRow);
                          const heroSubtitle =
                            selectedSubCategoryEfforts.length > 0
                              ? selectedSubCategoryEfforts.map((item) => item.name).join(' · ')
                              : readSubEffortDescription(selectedRow);
                          const heroUrl = subEffortHeroImageUrl({
                            rowId: selectedRow?.id,
                            name: heroName,
                            subtitle: heroSubtitle,
                          });
                          return (
                            <img
                              key={heroUrl}
                              src={heroUrl}
                              alt=""
                              className="absolute inset-0 h-full w-full object-cover"
                              loading="eager"
                              decoding="async"
                            />
                          );
                        })()}
                        <div
                          className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/40 to-black/25"
                          aria-hidden
                        />
                        <div className="relative z-10 flex h-full min-h-[168px] flex-col justify-between gap-4 p-5 sm:min-h-[190px] sm:p-6">
                          <div className="flex items-start justify-between gap-2">
                            {leadNumber?.trim() || clientName?.trim() || leadStage != null ? (
                              <div className="flex min-w-0 flex-wrap items-center gap-2">
                                {leadNumber?.trim() || clientName?.trim() ? (
                                  <span
                                    className="inline-flex min-w-0 max-w-[16rem] items-center gap-1.5 rounded-full bg-black/45 px-3 py-1.5 text-sm font-semibold text-white shadow-sm backdrop-blur-md sm:max-w-[22rem]"
                                    title={[leadNumber?.trim(), clientName?.trim()]
                                      .filter(Boolean)
                                      .join(' · ')}
                                  >
                                    {leadNumber?.trim() ? (
                                      <span className="shrink-0 text-white/85">
                                        #{leadNumber.trim()}
                                      </span>
                                    ) : null}
                                    {leadNumber?.trim() && clientName?.trim() ? (
                                      <span className="shrink-0 text-white/40" aria-hidden>
                                        ·
                                      </span>
                                    ) : null}
                                    {clientName?.trim() ? (
                                      <span className="min-w-0 truncate">{clientName.trim()}</span>
                                    ) : null}
                                  </span>
                                ) : null}
                                {(() => {
                                  if (leadStage == null || String(leadStage).trim() === '') return null;
                                  const stageStr = String(leadStage).trim();
                                  const stageName = /^\d+$/.test(stageStr)
                                    ? getStageName(stageStr)
                                    : stageStr;
                                  if (!stageName) return null;
                                  const soft = getSoftStageBadgeStyle(
                                    /^\d+$/.test(stageStr) ? getStageColour(stageStr) : '',
                                    stageStr,
                                  );
                                  return (
                                    <span
                                      className="inline-flex min-w-0 max-w-[16rem] items-center rounded-full px-3 py-1.5 text-sm font-semibold shadow-sm"
                                      style={{
                                        backgroundColor: flattenSoftStageBackground(
                                          soft.backgroundColor,
                                        ),
                                        color: soft.color,
                                      }}
                                      title={stageName}
                                    >
                                      <span className="truncate">{stageName}</span>
                                    </span>
                                  );
                                })()}
                              </div>
                            ) : (
                              <span />
                            )}
                            <div className="flex min-w-0 flex-wrap items-start justify-end gap-2">
                            <button
                              type="button"
                              className={`inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-semibold shadow-sm backdrop-blur-sm transition-colors disabled:opacity-60 ${
                                selectedRow?.internal === true
                                  ? 'bg-amber-50/95 text-amber-900 hover:bg-amber-100'
                                  : 'bg-white/90 text-blue-900 hover:bg-white'
                              }`}
                              onClick={() => void toggleInternal()}
                              disabled={isTogglingInternal}
                              title={
                                selectedRow?.internal === true
                                  ? 'Internal — click to make visible to client'
                                  : 'Client can see — click to make internal'
                              }
                              aria-label={
                                selectedRow?.internal === true
                                  ? 'Internal. Click to show to client'
                                  : 'Client can see. Click to mark internal'
                              }
                            >
                              {isTogglingInternal ? (
                                <span className="loading loading-spinner loading-xs" />
                              ) : selectedRow?.internal === true ? (
                                <LockClosedIcon className="h-4 w-4 shrink-0" />
                              ) : (
                                <EyeIcon className="h-4 w-4 shrink-0" />
                              )}
                              <span>
                                {selectedRow?.internal === true ? 'Internal' : 'Client'}
                              </span>
                            </button>
                            {isLeadVisibilityOverridden(selectedRow) ? (
                              <button
                                type="button"
                                className="btn btn-ghost btn-xs h-9 rounded-full border-0 bg-white/20 px-2.5 text-white hover:bg-white/30"
                                onClick={() => void resetVisibilityToDefault()}
                                disabled={isTogglingInternal}
                              >
                                Use template default
                              </button>
                            ) : null}
                            </div>
                          </div>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
                              <h2
                                className="min-w-0 max-w-full text-2xl font-bold leading-tight tracking-tight text-white line-clamp-2 break-words [overflow-wrap:anywhere] drop-shadow-sm md:text-[28px]"
                                title={readSubEffortName(selectedRow)}
                              >
                                {readSubEffortName(selectedRow)}
                              </h2>
                              <button
                                type="button"
                                onClick={() => setDescriptionRow(selectedRow)}
                                className="btn btn-ghost btn-xs btn-square h-9 w-9 shrink-0 rounded-full text-white/80 hover:bg-white/15 hover:text-white"
                                title="What is this sub effort?"
                                aria-label={`About ${readSubEffortName(selectedRow)}`}
                              >
                                <QuestionMarkCircleIcon className="h-5 w-5" />
                              </button>
                            </div>
                            {(() => {
                              const subtitleFull =
                                selectedSubCategoryEfforts.length > 0
                                  ? selectedSubCategoryEfforts.map((item) => item.name).join(' · ')
                                  : readSubEffortDescription(selectedRow);
                              if (!subtitleFull?.trim()) return null;
                              const subtitleShort = truncateToMaxWords(subtitleFull, 16);
                              return (
                                <p
                                  className="mt-2 inline-block max-w-full truncate rounded-full bg-white/15 px-3 py-1 text-sm leading-snug text-white shadow-sm ring-1 ring-white/20 backdrop-blur-md"
                                  title={subtitleFull}
                                >
                                  {subtitleShort}
                                </p>
                              );
                            })()}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 px-5 py-4">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm h-10 gap-2 rounded-full border-none px-4 text-sm font-medium text-gray-700 shadow-none hover:bg-gray-100"
                          onClick={() => openNotesEditor('internal')}
                        >
                          <PencilSquareIcon className="h-5 w-5" />
                          Add note
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm h-10 gap-2 rounded-full border-none px-4 text-sm font-medium text-gray-700 shadow-none hover:bg-gray-100"
                          disabled={isUploading || !selectedRow?.id}
                          onClick={() => fileInputRef.current?.click()}
                        >
                          {isUploading ? (
                            <span className="loading loading-spinner loading-sm" />
                          ) : (
                            <ArrowUpTrayIcon className="h-5 w-5" />
                          )}
                          Upload document
                        </button>
                        <button
                          type="button"
                          className={`btn btn-sm h-10 gap-1.5 rounded-full px-4 text-sm font-semibold ${
                            selectedIsActive ? 'btn-primary' : 'bg-white text-gray-700 shadow-sm hover:bg-gray-50'
                          }`}
                          onClick={() => void toggleComplete()}
                          disabled={isMarkingComplete}
                        >
                          {isMarkingComplete ? (
                            <span className="loading loading-spinner loading-sm" />
                          ) : null}
                          {selectedIsActive ? 'Mark complete' : 'Reopen'}
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4">
                      <div>
                        <div className="mb-2 px-0.5">
                          <span className="text-base font-semibold text-gray-500">Internal notes</span>
                        </div>
                        <div className="rounded-[18px] bg-white shadow-sm px-5 py-4">
                          <div className="flex items-start gap-3">
                            <div className="min-w-0 flex-1">
                              {selectedRow?.internal_notes ? (
                                <div className="text-sm leading-relaxed whitespace-pre-wrap break-words text-base-content/80">
                                  {selectedRow.internal_notes}
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  className="w-full rounded-xl border border-dashed border-gray-200 bg-gray-50/60 px-4 py-3 text-left text-sm text-base-content/40 transition hover:border-gray-300 hover:bg-gray-50"
                                  onClick={() => openNotesEditor('internal')}
                                >
                                  No internal notes yet. Add one…
                                </button>
                              )}
                            </div>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm btn-square h-9 w-9 shrink-0"
                              onClick={() => openNotesEditor('internal')}
                              aria-label="Edit internal notes"
                            >
                              <PencilSquareIcon className="h-5 w-5" />
                            </button>
                          </div>
                        </div>
                      </div>

                      <div>
                        <div className="mb-2 px-0.5">
                          <span className="text-base font-semibold text-gray-500">Client notes</span>
                        </div>
                        <div className="rounded-[18px] bg-white shadow-sm px-5 py-4">
                          <div className="flex items-start gap-3">
                            <div className="min-w-0 flex-1">
                              {selectedRow?.client_notes ? (
                                <div className="text-sm leading-relaxed whitespace-pre-wrap break-words text-base-content/80">
                                  {selectedRow.client_notes}
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  className="w-full rounded-xl border border-dashed border-gray-200 bg-gray-50/60 px-4 py-3 text-left text-sm text-base-content/40 transition hover:border-gray-300 hover:bg-gray-50"
                                  onClick={() => openNotesEditor('client')}
                                >
                                  No client notes yet. Add one…
                                </button>
                              )}
                            </div>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm btn-square h-9 w-9 shrink-0"
                              onClick={() => openNotesEditor('client')}
                              aria-label="Edit client notes"
                            >
                              <PencilSquareIcon className="h-5 w-5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div>
                      <div className="mb-2 flex items-center justify-between gap-3 px-0.5">
                        <div className="flex min-w-0 items-center gap-2.5">
                          {activeFolder ? (
                            <>
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm btn-square h-10 w-10 shrink-0"
                                onClick={() => setActiveFolderId(null)}
                                aria-label="Back to folders"
                                title="Back"
                              >
                                <ChevronLeftIcon className="h-6 w-6" />
                              </button>
                              <FolderIcon className="h-6 w-6 shrink-0 text-amber-500/90" />
                              <span className="truncate text-base font-semibold text-base-content/85 md:text-lg">
                                {activeFolder.title}
                              </span>
                              {activeFolder.note ? (
                                <span
                                  className="badge badge-ghost badge-sm max-w-[9rem] truncate font-normal"
                                  title={activeFolder.note}
                                >
                                  {activeFolder.note}
                                </span>
                              ) : null}
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm btn-square shrink-0"
                                onClick={() => openEditFolderModal(activeFolder)}
                                aria-label="Edit folder"
                                title="Edit folder"
                              >
                                <PencilSquareIcon className="h-5 w-5" />
                              </button>
                            </>
                          ) : (
                            <span className="text-base font-semibold text-gray-500">Documents</span>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {!activeFolderId ? (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm h-10 gap-1.5 rounded-full px-3.5 text-sm font-medium text-base-content/70 hover:bg-white hover:shadow-sm"
                              onClick={openCreateFolderModal}
                              disabled={!selectedRow?.id}
                            >
                              <FolderPlusIcon className="h-5 w-5" />
                              New folder
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm h-10 gap-1.5 rounded-full px-3.5 text-sm font-medium text-base-content/70 hover:bg-white hover:shadow-sm"
                            onClick={() => void openAttachFromCaseDocs()}
                            disabled={!selectedRow?.id}
                          >
                            <PlusIcon className="h-5 w-5" />
                            Attach from case
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm h-10 gap-1.5 rounded-full px-3.5 text-sm font-medium text-base-content/70 hover:bg-white hover:shadow-sm"
                            onClick={() => void downloadAllDocuments()}
                            disabled={isDownloadingAll || resolvedDocs.length === 0}
                            title="Download all sub-effort documents as a zip"
                          >
                            {isDownloadingAll ? (
                              <span className="loading loading-spinner loading-sm" />
                            ) : (
                              <ArrowDownTrayIcon className="h-5 w-5" />
                            )}
                            Download all
                          </button>
                        </div>
                      </div>
                      <div className="rounded-[18px] bg-white shadow-sm px-5 py-4">
                    {(() => {
                      const savedUpdate = hasLeadSubEffortSavedUpdate(selectedRow);
                      const uploadedAt = savedUpdate
                        ? formatDateTime(leadSubEffortSavedUpdatedAt(selectedRow))
                        : null;
                      const fallbackUploaderName = savedUpdate
                        ? updaterDisplayName(selectedRow)
                        : null;
                      const fallbackUploaderPhoto = savedUpdate
                        ? resolveUpdaterPhoto(selectedRow, photoByUpdaterName)
                        : null;
                      const hasVisibleDocs = visibleDocs.length > 0;
                      const hasReadyVisible = visibleDocs.some((d) => d.url);
                      const showFolders = !activeFolderId;
                      const hasFolders = folders.length > 0;
                      const isEmptyRoot = showFolders && !hasFolders && !hasVisibleDocs && !foldersLoading;
                      const isEmptyFolder = !!activeFolderId && !hasVisibleDocs;

                      const renderDocRow = (doc: ResolvedDoc, idx: number) => {
                        const href = doc.url || doc.raw;
                        const canPreview = !!doc.url;
                        const docKey = String(doc.path || doc.raw || '').trim();
                        const moveOpen = moveMenuDocKey === docKey;
                        const canMove = Boolean(docKey && (folders.length > 0 || activeFolderId));
                        return (
                          <tr
                            key={`${doc.raw}-${idx}`}
                            className={`${
                              dragDocKey === docKey ? 'opacity-60' : ''
                            }`}
                            draggable={!!docKey}
                            onDragStart={(e) => {
                              if (!docKey) return;
                              e.dataTransfer.setData('application/x-sub-effort-doc', docKey);
                              e.dataTransfer.effectAllowed = 'move';
                              setDragDocKey(docKey);
                              setMoveMenuDocKey(null);
                              setMoveMenuPos(null);
                            }}
                            onDragEnd={() => {
                              setDragDocKey(null);
                              setDropTargetFolderId(undefined);
                            }}
                          >
                            <td className="px-3 py-3 align-middle">
                              <button
                                type="button"
                                disabled={!canPreview}
                                onClick={() => openDocPreview(doc)}
                                className={`inline-flex min-w-0 max-w-full items-center gap-2.5 text-left ${
                                  canPreview ? 'hover:opacity-80' : 'cursor-default'
                                }`}
                              >
                                <span className="relative inline-flex h-12 w-10 shrink-0 overflow-hidden rounded-md bg-transparent">
                                  {doc.isImage && canPreview ? (
                                    <img
                                      src={doc.url}
                                      alt=""
                                      className="h-full w-full object-cover"
                                      loading="lazy"
                                    />
                                  ) : (
                                    <span className="flex h-full w-full items-center justify-center">
                                      <DocumentFileGlyph
                                        fileType={doc.mimeType}
                                        fileName={doc.name}
                                        className="h-10 w-10 shrink-0"
                                      />
                                    </span>
                                  )}
                                </span>
                                <span className="min-w-0 truncate text-sm font-semibold text-base-content">
                                  {doc.name}
                                </span>
                              </button>
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
                            <td className="px-3 py-3 text-center align-middle text-sm">
                              <DocumentUploaderCell
                                name={doc.uploadedByName || fallbackUploaderName}
                                photoUrl={
                                  doc.isClientPortalUpload
                                    ? null
                                    : doc.uploadedByPhotoUrl || fallbackUploaderPhoto
                                }
                                isClientPortalUpload={Boolean(doc.isClientPortalUpload)}
                              />
                            </td>
                            <td className="px-3 py-3 text-center align-middle whitespace-nowrap text-sm tabular-nums text-gray-500">
                              {uploadedAt || '—'}
                            </td>
                            <td className="px-2 py-3 text-center align-middle">
                              <div className="inline-flex justify-end" data-sub-effort-menu>
                                <button
                                  type="button"
                                  data-sub-effort-doc-trigger={docKey || undefined}
                                  className={`inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
                                    moveOpen
                                      ? 'bg-gray-900 text-white shadow-sm'
                                      : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'
                                  }`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setFolderMenuId(null);
                                    if (moveOpen) {
                                      setMoveMenuDocKey(null);
                                      setMoveMenuPos(null);
                                      return;
                                    }
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const gap = 4;
                                    const margin = 8;
                                    const estimated = 320;
                                    const spaceBelow = window.innerHeight - rect.bottom - gap - margin;
                                    const spaceAbove = rect.top - gap - margin;
                                    const openUp =
                                      spaceBelow < Math.min(estimated, 240) && spaceAbove > spaceBelow;
                                    const available = Math.max(140, openUp ? spaceAbove : spaceBelow);
                                    const maxHeight = Math.min(320, available);
                                    const right = Math.max(8, window.innerWidth - rect.right);
                                    setMoveMenuPos(
                                      openUp
                                        ? {
                                            bottom: Math.max(margin, window.innerHeight - rect.top + gap),
                                            right,
                                            maxHeight,
                                          }
                                        : {
                                            top: rect.bottom + gap,
                                            right,
                                            maxHeight,
                                          },
                                    );
                                    setMoveMenuDocKey(docKey || `row-${idx}`);
                                  }}
                                  aria-label="Document options"
                                  aria-expanded={moveOpen}
                                  aria-haspopup="menu"
                                  title="More options"
                                >
                                  <EllipsisVerticalIcon className="h-5 w-5" />
                                </button>
                                {moveOpen && moveMenuPos
                                  ? createPortal(
                                      <div
                                        data-sub-effort-doc-menu
                                        role="menu"
                                        className="fixed z-[80] w-56 overflow-y-auto overscroll-contain rounded-xl border border-base-200 bg-white py-1 shadow-lg"
                                        style={{
                                          top: moveMenuPos.top,
                                          bottom: moveMenuPos.bottom,
                                          right: moveMenuPos.right,
                                          maxHeight: moveMenuPos.maxHeight,
                                        }}
                                      >
                                        {canPreview ? (
                                          <button
                                            type="button"
                                            role="menuitem"
                                            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-base-content hover:bg-base-200/70"
                                            onClick={() => {
                                              setMoveMenuDocKey(null);
                                              setMoveMenuPos(null);
                                              openDocPreview(doc);
                                            }}
                                          >
                                            <EyeIcon className="h-4 w-4 opacity-70" />
                                            Preview
                                          </button>
                                        ) : null}
                                        <a
                                          href={href}
                                          target="_blank"
                                          rel="noreferrer"
                                          download={doc.name}
                                          role="menuitem"
                                          className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-base-content hover:bg-base-200/70"
                                          onClick={() => {
                                            setMoveMenuDocKey(null);
                                            setMoveMenuPos(null);
                                          }}
                                        >
                                          <ArrowDownTrayIcon className="h-4 w-4 opacity-70" />
                                          Download
                                        </a>
                                        <button
                                          type="button"
                                          role="menuitem"
                                          className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-base-content hover:bg-base-200/70"
                                          onClick={() => {
                                            setMoveMenuDocKey(null);
                                            setMoveMenuPos(null);
                                            startInlineRename(doc);
                                          }}
                                        >
                                          <PencilSquareIcon className="h-4 w-4 opacity-70" />
                                          Edit file name
                                        </button>
                                        <button
                                          type="button"
                                          role="menuitem"
                                          className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-red-600 hover:bg-red-50"
                                          onClick={() => {
                                            setMoveMenuDocKey(null);
                                            setMoveMenuPos(null);
                                            void deleteSubEffortDocument(doc);
                                          }}
                                        >
                                          <TrashIcon className="h-4 w-4" />
                                          Delete
                                        </button>
                                        {canMove ? (
                                          <>
                                            <div className="my-1 border-t border-gray-100" />
                                            <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-base-content/45">
                                              Move to
                                            </div>
                                            {activeFolderId ? (
                                              <button
                                                type="button"
                                                role="menuitem"
                                                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-base-content hover:bg-base-200/70"
                                                onClick={() => {
                                                  setMoveMenuDocKey(null);
                                                  setMoveMenuPos(null);
                                                  void moveDocToFolder(docKey, null);
                                                }}
                                              >
                                                <DocumentIcon className="h-4 w-4 shrink-0 text-gray-400" />
                                                Unfiled
                                              </button>
                                            ) : null}
                                            {folders
                                              .filter((f) => f.id !== (doc.folder_id ?? null))
                                              .map((f) => (
                                                <button
                                                  key={f.id}
                                                  type="button"
                                                  role="menuitem"
                                                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-base-content hover:bg-base-200/70"
                                                  onClick={() => {
                                                    setMoveMenuDocKey(null);
                                                    setMoveMenuPos(null);
                                                    void moveDocToFolder(docKey, f.id);
                                                  }}
                                                >
                                                  <FolderIcon className="h-4 w-4 shrink-0 text-amber-500" />
                                                  <span className="min-w-0 truncate">{f.title}</span>
                                                </button>
                                              ))}
                                          </>
                                        ) : null}
                                      </div>,
                                      document.body,
                                    )
                                  : null}
                              </div>
                            </td>
                          </tr>
                        );
                      };

                      const fileDropHandlers = {
                        onDragEnter: (e: React.DragEvent) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (e.dataTransfer.types.includes('Files')) setIsDraggingDocs(true);
                        },
                        onDragOver: (e: React.DragEvent) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (e.dataTransfer.types.includes('Files')) setIsDraggingDocs(true);
                        },
                        onDragLeave: (e: React.DragEvent) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setIsDraggingDocs(false);
                        },
                        onDrop: (e: React.DragEvent) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setIsDraggingDocs(false);
                          const movedKey = e.dataTransfer.getData('application/x-sub-effort-doc');
                          if (movedKey) return;
                          if (e.dataTransfer.files?.length) {
                            void handleUploadFiles(e.dataTransfer.files);
                          }
                        },
                      };

                      if (isEmptyRoot) {
                        return (
                          <div className="space-y-3">
                            <div
                              className={`flex min-h-[160px] flex-col items-center justify-center rounded-xl border border-dashed px-5 py-10 text-center transition ${
                                isDraggingDocs
                                  ? 'border-primary/40 bg-primary/5'
                                  : 'border-gray-200 bg-gray-50/50 hover:border-gray-300'
                              }`}
                              {...fileDropHandlers}
                              role="button"
                              tabIndex={0}
                              onClick={() => fileInputRef.current?.click()}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
                              }}
                            >
                              <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm">
                                <ArrowUpTrayIcon className="h-5 w-5 text-base-content/40" />
                              </div>
                              <p className="text-sm font-medium text-base-content/70">No documents uploaded yet</p>
                              <p className="mt-1 text-xs text-base-content/45">
                                Upload a file, attach from the case, or create a folder
                              </p>
                            </div>
                          </div>
                        );
                      }

                      if (hasVisibleDocs && !hasReadyVisible) {
                        return (
                          <div className="flex items-center gap-3 py-6 text-sm text-base-content/50">
                            <span className="loading loading-spinner loading-sm" />
                            Loading documents…
                          </div>
                        );
                      }

                      return (
                        <div className="space-y-3">
                          {showFolders ? (
                            <div className="space-y-2">
                              {foldersLoading ? (
                                <div className="flex items-center gap-2 py-2 text-xs text-base-content/45">
                                  <span className="loading loading-spinner loading-xs" />
                                  Loading folders…
                                </div>
                              ) : null}
                              {folders.map((folder) => {
                                const count = resolvedDocs.filter((d) => d.folder_id === folder.id).length;
                                const isDropTarget = dropTargetFolderId === folder.id;
                                const menuOpen = folderMenuId === folder.id;
                                return (
                                  <div
                                    key={folder.id}
                                    className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 transition ${
                                      isDropTarget
                                        ? 'bg-primary/5 ring-1 ring-primary/30'
                                        : 'bg-gray-50/60 hover:bg-gray-50'
                                    }`}
                                    onDragEnter={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      if (dragDocKey || e.dataTransfer.types.includes('application/x-sub-effort-doc')) {
                                        setDropTargetFolderId(folder.id);
                                      }
                                    }}
                                    onDragOver={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      e.dataTransfer.dropEffect = 'move';
                                      setDropTargetFolderId(folder.id);
                                    }}
                                    onDragLeave={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      setDropTargetFolderId((prev) => (prev === folder.id ? undefined : prev));
                                    }}
                                    onDrop={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      setDropTargetFolderId(undefined);
                                      const key =
                                        e.dataTransfer.getData('application/x-sub-effort-doc') || dragDocKey;
                                      if (key) void moveDocToFolder(key, folder.id);
                                    }}
                                  >
                                    <button
                                      type="button"
                                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                                      onClick={() => {
                                        setActiveFolderId(folder.id);
                                        setFolderMenuId(null);
                                        setMoveMenuDocKey(null);
                                      }}
                                    >
                                      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                                        <FolderIcon className="h-7 w-7" />
                                      </span>
                                      <span className="min-w-0 flex-1">
                                        <span className="flex items-center gap-2">
                                          <span className="truncate text-base font-semibold text-base-content/85">
                                            {folder.title}
                                          </span>
                                          {folder.note ? (
                                            <span
                                              className="badge badge-ghost badge-sm max-w-[8rem] truncate font-normal"
                                              title={folder.note}
                                            >
                                              {folder.note}
                                            </span>
                                          ) : null}
                                        </span>
                                        <span className="mt-0.5 block text-sm text-gray-500">
                                          {folder.created_by ? folder.created_by : 'Unknown'}
                                          <span className="mx-1.5 text-gray-300">·</span>
                                          {formatDateTime(folder.created_at)}
                                        </span>
                                      </span>
                                    </button>
                                    <div className="relative flex shrink-0 items-center gap-2" data-sub-effort-menu>
                                      <span className="badge badge-sm tabular-nums border-0 bg-gray-600 font-medium text-white">
                                        {count}
                                      </span>
                                      <button
                                        type="button"
                                        className={`inline-flex h-10 w-10 items-center justify-center rounded-full transition-colors ${
                                          menuOpen
                                            ? 'bg-gray-900 text-white shadow-sm'
                                            : 'text-gray-500 opacity-80 hover:bg-white hover:text-gray-800 hover:opacity-100 group-hover:opacity-100'
                                        }`}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setMoveMenuDocKey(null);
                                          setFolderMenuId((prev) => (prev === folder.id ? null : folder.id));
                                        }}
                                        aria-label="Folder options"
                                        aria-expanded={menuOpen}
                                        aria-haspopup="menu"
                                      >
                                        <EllipsisVerticalIcon className="h-5 w-5" />
                                      </button>
                                      {menuOpen ? (
                                        <div
                                          role="menu"
                                          className="absolute right-0 top-full z-30 mt-2 w-44 overflow-hidden rounded-2xl border border-gray-200/80 bg-white/95 p-1.5 shadow-[0_12px_40px_rgba(15,23,42,0.12)] ring-1 ring-black/5 backdrop-blur-sm"
                                        >
                                          <button
                                            type="button"
                                            role="menuitem"
                                            className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100"
                                            onClick={() => openEditFolderModal(folder)}
                                          >
                                            <PencilSquareIcon className="h-4 w-4 shrink-0 text-gray-400" />
                                            Edit
                                          </button>
                                          <button
                                            type="button"
                                            role="menuitem"
                                            className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
                                            onClick={() => void deleteFolder(folder)}
                                          >
                                            <TrashIcon className="h-4 w-4 shrink-0" />
                                            Delete
                                          </button>
                                        </div>
                                      ) : null}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : null}

                          {activeFolderId ? (
                            <div
                              className={`mb-1 rounded-lg border border-dashed px-3 py-2 text-center text-xs transition ${
                                dropTargetFolderId === null
                                  ? 'border-primary/50 bg-primary/5 text-primary'
                                  : 'border-transparent text-base-content/40'
                              }`}
                              onDragEnter={(e) => {
                                e.preventDefault();
                                if (dragDocKey || e.dataTransfer.types.includes('application/x-sub-effort-doc')) {
                                  setDropTargetFolderId(null);
                                }
                              }}
                              onDragOver={(e) => {
                                e.preventDefault();
                                e.dataTransfer.dropEffect = 'move';
                                setDropTargetFolderId(null);
                              }}
                              onDragLeave={() => setDropTargetFolderId(undefined)}
                              onDrop={(e) => {
                                e.preventDefault();
                                setDropTargetFolderId(undefined);
                                const key =
                                  e.dataTransfer.getData('application/x-sub-effort-doc') || dragDocKey;
                                if (key) void moveDocToFolder(key, null);
                              }}
                            >
                              {dragDocKey ? 'Drop here to move to Unfiled' : null}
                            </div>
                          ) : null}

                          {isEmptyFolder ? (
                            <div className="py-4 text-center text-sm text-base-content/45">
                              This folder is empty
                            </div>
                          ) : hasVisibleDocs ? (
                            <div className="min-w-0 overflow-x-auto">
                              <div className="min-w-[780px]">
                                <table className="mb-2 w-full table-fixed border-collapse">
                                  <colgroup>
                                    <col />
                                    <col className="w-[20%]" />
                                    <col className="w-[22%]" />
                                    <col className="w-36" />
                                    <col className="w-12" />
                                  </colgroup>
                                  <thead>
                                    <tr className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                      <th className="bg-transparent px-3 py-2 text-left font-semibold">
                                        Document name
                                      </th>
                                      <th className="bg-transparent px-3 py-2 text-center font-semibold">
                                        Document type
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
                                      <col />
                                      <col className="w-[20%]" />
                                      <col className="w-[22%]" />
                                      <col className="w-36" />
                                      <col className="w-12" />
                                    </colgroup>
                                    <tbody>
                                      {visibleDocs.map((doc, idx) => renderDocRow(doc, idx))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            </div>
                          ) : showFolders && hasFolders ? (
                            <div className="py-1 text-center text-xs text-base-content/40">
                              Unfiled documents will appear here
                            </div>
                          ) : null}

                          <div
                            className={`flex min-h-[100px] flex-col items-center justify-center rounded-xl border border-dashed px-4 py-8 text-center transition ${
                              isDraggingDocs
                                ? 'border-primary/40 bg-primary/5'
                                : 'border-gray-200 bg-gray-50/40 hover:border-gray-300'
                            }`}
                            {...fileDropHandlers}
                            role="button"
                            tabIndex={0}
                            onClick={() => fileInputRef.current?.click()}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
                            }}
                          >
                            <span className="text-sm font-medium text-gray-500">
                              {activeFolder
                                ? `Drop files into “${activeFolder.title}” or click to upload`
                                : 'Drop more files here or click to upload'}
                            </span>
                          </div>
                        </div>
                      );
                    })()}
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="hidden"
                      multiple
                      onChange={(e) => void handleUploadFiles(e.target.files)}
                    />
                      </div>
                    </div>

                    {hasLeadSubEffortSavedUpdate(selectedRow) ? (
                      <div className="flex justify-end pt-1">
                        <div className="inline-flex max-w-full flex-wrap items-center justify-end gap-2 text-xs text-gray-500">
                          <span>Last updated by</span>
                          <EmployeeAvatar
                            name={updaterDisplayName(selectedRow)}
                            photoUrl={resolveUpdaterPhoto(selectedRow, photoByUpdaterName)}
                            size="md"
                          />
                          <span className="font-medium text-gray-500">{updaterDisplayName(selectedRow)}</span>
                          <span className="text-gray-400">·</span>
                          <span className="tabular-nums text-gray-500">
                            {formatDateTime(leadSubEffortSavedUpdatedAt(selectedRow))}
                          </span>
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="rounded-[18px] bg-white px-5 py-10 text-center text-sm text-base-content/50 shadow-sm">
                    Select a sub effort to view details.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Removed: floating expand/summary side control to declutter mobile modal */}
        </div>
    </MobileBottomSheet>

      {isNotesModalOpen ? (
        <div className="modal modal-open">
          <div className="modal-box max-w-2xl">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold">
                {notesKind === 'internal' ? 'Edit internal notes' : 'Edit client notes'}
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setIsNotesModalOpen(false)}>
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="mt-4">
              <textarea
                className={`textarea textarea-bordered w-full min-h-[200px] ${
                  containsHebrew(notesDraft) ? 'text-right' : ''
                }`}
                dir="auto"
                placeholder={notesKind === 'internal' ? 'Write internal notes…' : 'Write client notes…'}
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
              />
            </div>

            <div className="modal-action">
              <button type="button" className="btn" onClick={() => setIsNotesModalOpen(false)} disabled={isSavingNotes}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void saveNotes()} disabled={isSavingNotes}>
                {isSavingNotes ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
          <div className="modal-backdrop" onClick={() => setIsNotesModalOpen(false)} />
        </div>
      ) : null}

      {folderModalOpen ? (
        <div className="modal modal-open z-[310]">
          <div className="modal-box max-w-md">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold">
                {folderModalMode === 'create' ? 'New folder' : 'Edit folder'}
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => (folderSaving ? null : setFolderModalOpen(false))}
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="mt-4 space-y-3">
              <label className="form-control w-full">
                <span className="label-text text-xs font-medium">Title</span>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={folderTitleDraft}
                  onChange={(e) => setFolderTitleDraft(e.target.value)}
                  placeholder="Folder name"
                  autoFocus
                  disabled={folderSaving}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void saveFolderModal();
                    }
                  }}
                />
              </label>
              <label className="form-control w-full">
                <span className="label-text text-xs font-medium">Note (optional)</span>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={folderNoteDraft}
                  onChange={(e) => setFolderNoteDraft(e.target.value)}
                  placeholder="Tip text on the folder badge"
                  disabled={folderSaving}
                />
              </label>
            </div>
            <div className="modal-action">
              <button
                type="button"
                className="btn"
                onClick={() => setFolderModalOpen(false)}
                disabled={folderSaving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void saveFolderModal()}
                disabled={folderSaving || !folderTitleDraft.trim()}
              >
                {folderSaving ? 'Saving…' : folderModalMode === 'create' ? 'Create' : 'Save'}
              </button>
            </div>
          </div>
          <div
            className="modal-backdrop"
            onClick={() => (folderSaving ? null : setFolderModalOpen(false))}
          />
        </div>
      ) : null}

      {renamingDocKey ? (
        <div className="modal modal-open z-[310]">
          <div className="modal-box max-w-md">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold">Rename document</div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => (renameDocSaving ? null : cancelInlineRename())}
                aria-label="Close"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="mt-4">
              <label className="form-control w-full">
                <span className="label-text text-xs font-medium">File name</span>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={renameDocValue}
                  onChange={(e) => setRenameDocValue(e.target.value)}
                  placeholder="Document name"
                  autoFocus
                  disabled={renameDocSaving}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void saveInlineRename();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      if (!renameDocSaving) cancelInlineRename();
                    }
                  }}
                />
              </label>
            </div>
            <div className="modal-action">
              <button
                type="button"
                className="btn"
                onClick={cancelInlineRename}
                disabled={renameDocSaving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void saveInlineRename()}
                disabled={renameDocSaving || !renameDocValue.trim()}
              >
                {renameDocSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
          <div
            className="modal-backdrop"
            onClick={() => (renameDocSaving ? null : cancelInlineRename())}
          />
        </div>
      ) : null}

      {isAttachModalOpen ? (
        <div className="modal modal-open">
          <div className="modal-box w-full max-w-4xl">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold">Attach from case documents</div>
                <div className="text-xs opacity-70">Select files to show in this sub effort row.</div>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => (isAttaching ? null : setIsAttachModalOpen(false))}
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="mt-4">
              {caseDocsLoading ? (
                <div className="flex items-center justify-center py-10">
                  <span className="loading loading-spinner loading-md" />
                  <span className="ml-3 text-sm opacity-70">Loading…</span>
                </div>
              ) : caseDocs.length === 0 ? (
                <div className="text-sm opacity-70">No case documents found.</div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {caseDocs.map((d) => {
                    const checked = selectedCaseDocIds.has(d.id);
                    const mime = d.mime_type || inferMimeFromName(d.file_name);
                    const isImg = isImageMime(mime);
                    return (
                      <button
                        key={d.id}
                        type="button"
                        className={`text-left rounded-xl border p-3 transition ${
                          checked ? 'border-primary bg-primary/5' : 'border-base-200 hover:bg-base-200/40'
                        }`}
                        onClick={() => {
                          setSelectedCaseDocIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(d.id)) next.delete(d.id);
                            else next.add(d.id);
                            return next;
                          });
                        }}
                      >
                        <div className="flex items-start gap-3">
                          <div
                            className="h-14 w-14 shrink-0 rounded-lg bg-base-200 overflow-hidden flex items-center justify-center cursor-pointer hover:ring-2 hover:ring-primary/20"
                            title="Preview file"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              openCaseDocPreview(d);
                            }}
                          >
                            {isImg && d.signedUrl ? (
                              <img src={d.signedUrl} alt="" className="h-full w-full object-cover" />
                            ) : (
                              <span className="flex h-full w-full items-center justify-center">
                                <DocumentFileGlyph
                                  fileType={mime}
                                  fileName={d.file_name}
                                  className="h-8 w-8 shrink-0"
                                />
                              </span>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div
                              className="text-sm font-semibold truncate hover:underline cursor-pointer"
                              title="Preview file"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                openCaseDocPreview(d);
                              }}
                            >
                              {d.file_name}
                            </div>
                            <div className="text-xs opacity-70 tabular-nums">{formatDateTime(d.created_at)}</div>
                          </div>
                          <input type="checkbox" className="checkbox checkbox-sm mt-1" checked={checked} readOnly />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setIsAttachModalOpen(false)}
                disabled={isAttaching}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void attachSelectedCaseDocs()}
                disabled={isAttaching}
              >
                {isAttaching ? <span className="loading loading-spinner loading-sm" /> : 'Attach'}
              </button>
            </div>
          </div>
          <div className="modal-backdrop" onClick={() => (isAttaching ? null : setIsAttachModalOpen(false))} />
        </div>
      ) : null}

      <DocumentPreviewModal
        isOpen={previewOpen}
        onClose={() => {
          setPreviewOpen(false);
          setPreviewItems([]);
          setPreviewFromCaseDocs(false);
        }}
        documents={previewItems}
        initialIndex={previewInitialIndex}
        onRename={
          previewFromCaseDocs
            ? undefined
            : async (item, newName) => {
                await renameSubEffortDocument(item.id, newName);
              }
        }
      />

      {descriptionRow ? (
        <div className="modal modal-open z-[320]">
          <div className="modal-box max-w-lg">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-gray-900">{readSubEffortName(descriptionRow)}</h3>
                <p className="mt-1 text-xs text-gray-500">About this sub effort</p>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-square"
                onClick={() => setDescriptionRow(null)}
                aria-label="Close"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-4 rounded-xl bg-gray-50 px-4 py-3 text-sm leading-relaxed text-gray-700 whitespace-pre-wrap">
              {readSubEffortDescription(descriptionRow) || 'No description is available for this sub effort yet.'}
            </div>
            <div className="modal-action mt-4">
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setDescriptionRow(null)}>
                Close
              </button>
            </div>
          </div>
          <button
            type="button"
            className="modal-backdrop"
            aria-label="Close description"
            onClick={() => setDescriptionRow(null)}
          />
        </div>
      ) : null}

      {SUB_EFFORT_DOC_CATEGORIES.map((key) => (
        <SequenceOfEventsDocumentsModal
          key={key}
          open={categoryModalOpen === key}
          onClose={() => setCategoryModalOpen(null)}
          leadNumber={leadNumber}
          clientId={clientId}
          subEffortRows={timelineRows}
          targetSubEffortId={selectedRow?.id ?? null}
          activeFolderId={activeFolderId}
          onAttached={() => onRefresh?.()}
          category={key}
          title={CASE_DOCUMENT_CATEGORY_META[key].title}
        />
      ))}

      <ClientUploadsDocumentsModal
        open={clientUploadsOpen}
        onClose={() => setClientUploadsOpen(false)}
        leadNumber={leadNumber}
        clientId={clientId}
        subEffortRows={timelineRows}
        targetSubEffortId={selectedRow?.id ?? null}
        activeFolderId={activeFolderId}
        onAttached={() => onRefresh?.()}
      />
    </>
  );
}

