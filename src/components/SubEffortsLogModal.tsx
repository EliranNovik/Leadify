import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ArrowUpTrayIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DocumentIcon,
  EyeIcon,
  PlusIcon,
  LockClosedIcon,
  PencilSquareIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { CheckCircleIcon as CheckCircleSolidIcon } from '@heroicons/react/24/solid';
import toast from 'react-hot-toast';
import MobileBottomSheet from './MobileBottomSheet';
import { supabase } from '../lib/supabase';
import { CLIENT_HEADER_ONEDRIVE_SUBFOLDER } from '../lib/leadOneDrivePaths';
import { resolveCaseDocumentUploadContentType } from '../lib/caseDocumentsStorage';
import { fetchStageActorInfo } from '../lib/leadStageManager';
import { DocumentPreviewModal, type DocumentPreviewItem } from './DocumentModal';

type LeadSubEffortRow = any;

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
      const item: DocItem = {};
      if (url) item.url = url;
      if (path) item.path = path;
      if (name) item.name = name;
      if (mimeType) item.mimeType = mimeType;
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

function formatFileTypeLabel(mimeType?: string, name?: string): string {
  const mime = String(mimeType || '').toLowerCase();
  if (mime.includes('pdf')) return 'PDF document';
  if (mime.startsWith('image/')) {
    const sub = mime.split('/')[1]?.toUpperCase();
    return sub ? `${sub} image` : 'Image';
  }
  const ext = (name?.split('.').pop() || '').toLowerCase();
  if (ext === 'pdf') return 'PDF document';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return `${ext.toUpperCase()} image`;
  if (ext === 'docx' || ext === 'doc') return 'Word document';
  if (ext) return ext.toUpperCase();
  return 'Document';
}

function containsHebrew(text: string): boolean {
  return /[\u0590-\u05FF]/.test(text);
}

function getEmployeePhoto(employee?: any): string | null {
  if (!employee) return null;
  return (employee.photo_url as string | null | undefined) ?? (employee.photo as string | null | undefined) ?? null;
}

function employeeDisplayName(row: any): string {
  return String(row?.tenants_employee?.display_name ?? row?.created_by ?? '—');
}

function updaterDisplayName(row: any): string {
  const updated = String(row?.updated_by ?? '').trim();
  return updated || employeeDisplayName(row);
}

function resolveUpdaterPhoto(row: any): string | null {
  const emp = row?.tenants_employee;
  const updater = String(row?.updated_by ?? '').trim().toLowerCase();
  const creator = employeeDisplayName(row).trim().toLowerCase();
  if (updater && creator && updater === creator) {
    return getEmployeePhoto(emp);
  }
  return null;
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
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('');
  const dim = size === 'xs' ? 'h-7 w-7' : size === 'sm' ? 'h-9 w-9' : 'h-10 w-10';
  const text = size === 'xs' ? 'text-[10px]' : size === 'sm' ? 'text-[11px]' : 'text-xs';

  return (
    <div className="avatar shrink-0">
      <div className={`${dim} flex items-center justify-center overflow-hidden rounded-full bg-gray-200`}>
        {photoUrl ? (
          <img src={photoUrl} alt={name} className="h-full w-full object-cover" />
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

function getSubEffortProgress(row: any, isSelected: boolean): SubEffortProgress {
  if (row?.active === false) return 'completed';
  if (isSelected) return 'in_progress';
  return 'pending';
}

function ProgressBadge({ progress, compact = false }: { progress: SubEffortProgress; compact?: boolean }) {
  const base = compact
    ? 'inline-flex w-fit shrink-0 items-center rounded-md px-2.5 py-1 text-xs font-medium leading-tight'
    : 'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset';
  if (progress === 'completed') {
    return (
      <span className={`${base} bg-emerald-50 text-emerald-700${compact ? '' : ' ring-emerald-200/70'}`}>
        {compact ? 'Done' : 'Complete'}
      </span>
    );
  }
  if (progress === 'in_progress') {
    return (
      <span className={`${base} bg-blue-50 text-blue-700${compact ? '' : ' ring-blue-200/70'}`}>
        {compact ? 'Active' : 'In progress'}
      </span>
    );
  }
  return (
    <span className={`${base} bg-slate-100 text-slate-500${compact ? '' : ' ring-slate-200/80'}`}>
      Pending
    </span>
  );
}

function sortTimelineRows(rows: LeadSubEffortRow[]): LeadSubEffortRow[] {
  return [...(rows ?? [])].sort((a, b) => {
    const ao = Number((a as any)?.sort_order);
    const bo = Number((b as any)?.sort_order);
    const aSort = Number.isFinite(ao) ? ao : Number.MAX_SAFE_INTEGER;
    const bSort = Number.isFinite(bo) ? bo : Number.MAX_SAFE_INTEGER;
    if (aSort !== bSort) return aSort - bSort;
    return new Date((a as any)?.created_at ?? 0).getTime() - new Date((b as any)?.created_at ?? 0).getTime();
  });
}

const TIMELINE_HOLD_MS = 220;

function TimelineStepButton({
  rowId,
  row,
  isSelected,
  isLast,
  isDragOver,
  isDragging,
  isHolding,
  onSelect,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
}: {
  rowId: string;
  row: any;
  isSelected: boolean;
  isLast: boolean;
  isDragOver?: boolean;
  isDragging?: boolean;
  isHolding?: boolean;
  onSelect: () => void;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
}) {
  const name = row?.sub_efforts?.name ?? '—';
  const who = row?.tenants_employee?.display_name ?? row?.created_by ?? '—';
  const when = formatDateTime(row?.created_at);
  const progress = getSubEffortProgress(row, isSelected);
  const isPending = progress === 'pending' && !isSelected;

  return (
    <div
      data-timeline-row-id={rowId}
      className={[
        isLast ? '' : 'pb-1',
        isDragging ? 'opacity-60' : '',
        isDragOver ? 'rounded-2xl ring-2 ring-primary/30' : '',
      ].join(' ')}
    >
      <div className="relative flex gap-3">
        <div className="flex flex-col items-center pt-1">
          <ProgressIcon progress={progress} />
          {!isLast ? (
            <div className="mt-2 w-px flex-1 min-h-[20px] bg-gradient-to-b from-slate-200 to-transparent" aria-hidden />
          ) : null}
        </div>
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
            'group mb-1 flex-1 rounded-2xl text-left transition-all duration-200 select-none touch-none',
            isDragging ? 'cursor-grabbing scale-[0.98] shadow-md' : 'cursor-pointer',
            isHolding ? 'ring-2 ring-primary/25' : '',
            isSelected
              ? "relative border border-blue-100 bg-blue-50/70 px-3 py-2.5 shadow-sm before:content-[''] before:absolute before:left-0 before:top-2.5 before:bottom-2.5 before:w-1 before:rounded-full before:bg-blue-600"
              : isPending
                ? 'px-3 py-2.5 opacity-80 hover:bg-gray-50/80'
                : 'px-3 py-2.5 hover:bg-gray-50/80',
          ].join(' ')}
        >
          <div className="min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div
                className={[
                  'font-semibold leading-snug text-gray-900 truncate',
                  isSelected ? 'text-[15px]' : isPending ? 'text-[14px] text-gray-600' : 'text-[15px]',
                ].join(' ')}
              >
                {name}
              </div>
              <ChevronRightIcon
                className="h-4 w-4 shrink-0 text-gray-300 transition group-hover:text-gray-400 md:hidden"
                aria-hidden
              />
            </div>
            <div className="mt-1.5 flex items-center gap-1.5 text-[12px] text-gray-500 truncate">
              {!isSelected ? (
                <EmployeeAvatar
                  name={String(who)}
                  photoUrl={getEmployeePhoto(row?.tenants_employee)}
                  size="sm"
                />
              ) : null}
              <span className="truncate">
                {String(who)} · {when}
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <ProgressBadge progress={progress} compact />
              <VisibilityPill internal={row?.internal === true} size="compact" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProgressIcon({ progress }: { progress: SubEffortProgress }) {
  if (progress === 'completed') {
    return <CheckCircleSolidIcon className="h-[22px] w-[22px] shrink-0 text-emerald-500" aria-hidden />;
  }
  if (progress === 'in_progress') {
    return (
      <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center" aria-hidden>
        <span className="h-3.5 w-3.5 rounded-full bg-blue-600 shadow-[0_0_0_5px_rgba(37,99,235,0.15)]" />
      </span>
    );
  }
  return (
    <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center" aria-hidden>
      <span className="h-3.5 w-3.5 rounded-full border-2 border-slate-300 bg-white" />
    </span>
  );
}

function resolvedDocsToPreviewItems(docs: ResolvedDoc[]): DocumentPreviewItem[] {
  return docs
    .filter((d) => !!d.url)
    .map((d, i) => ({
      id: d.raw || String(i),
      name: d.name,
      downloadUrl: d.url,
      fileType: d.mimeType || inferMimeFromName(d.name),
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
      return { raw, url, name, mimeType, isImage, isPdf, path: d.path };
    })
    .filter(Boolean) as ResolvedDoc[];
}

export function SubEffortsLogModal({
  open,
  onClose,
  rows,
  leadNumber,
  caseDocumentsSubfolder = CLIENT_HEADER_ONEDRIVE_SUBFOLDER,
  initialSelectedRowId,
  onRefresh,
  subEffortOptions = [],
  isLoadingSubEffortOptions = false,
  isAddingSubEffort = false,
  onAddSubEffort,
}: {
  open: boolean;
  onClose: () => void;
  rows: LeadSubEffortRow[];
  leadNumber?: string | null;
  caseDocumentsSubfolder?: string | null;
  initialSelectedRowId?: string | number | null;
  onRefresh?: () => void;
  subEffortOptions?: Array<{ id: number; name: string }>;
  isLoadingSubEffortOptions?: boolean;
  isAddingSubEffort?: boolean;
  onAddSubEffort?: (opt: { id: number; name: string }) => Promise<string | number | null | void>;
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
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewItems, setPreviewItems] = useState<DocumentPreviewItem[]>([]);
  const [previewInitialIndex, setPreviewInitialIndex] = useState(0);
  const [orderedTimelineRows, setOrderedTimelineRows] = useState<LeadSubEffortRow[]>([]);
  const [draggingRowId, setDraggingRowId] = useState<string | null>(null);
  const [dragOverRowId, setDragOverRowId] = useState<string | null>(null);
  const [holdingRowId, setHoldingRowId] = useState<string | null>(null);
  const [isSavingTimelineOrder, setIsSavingTimelineOrder] = useState(false);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRowIdRef = useRef<string | null>(null);
  const didHoldDragRef = useRef(false);
  const dragOverRowIdRef = useRef<string | null>(null);
  const wasOpenRef = useRef(false);

  React.useEffect(() => {
    dragOverRowIdRef.current = dragOverRowId;
  }, [dragOverRowId]);

  const timelineRowsFromProps = useMemo(() => sortTimelineRows(rows ?? []), [rows]);

  React.useEffect(() => {
    setOrderedTimelineRows(timelineRowsFromProps);
  }, [timelineRowsFromProps]);

  const timelineRows = orderedTimelineRows;

  const availableSubEffortOptions = useMemo(() => {
    if (!onAddSubEffort) return [];
    const usedActive = new Set(
      (rows ?? [])
        .filter((r: any) => r?.active !== false)
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
    return catalog.filter((opt) => !usedActive.has(Number(opt.id)));
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
              .update({ sort_order: index, updated_by: actor.fullName })
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

  const openDocPreview = useCallback(
    (doc: ResolvedDoc) => {
      if (!doc.url) return;
      const items = resolvedDocsToPreviewItems(resolvedDocs);
      const docId = doc.raw || doc.url;
      const idx = items.findIndex((item) => item.id === docId);
      setPreviewItems(items);
      setPreviewInitialIndex(idx >= 0 ? idx : 0);
      setPreviewOpen(true);
    },
    [resolvedDocs],
  );

  // Sync selection only when the modal opens — not when rows refresh after save.
  React.useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }

    const justOpened = !wasOpenRef.current;
    wasOpenRef.current = true;

    if (!justOpened) return;

    setMobileStep('list');
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
        .update({ internal: nextVal, updated_by: actor.fullName })
        .eq('id', selectedRow.id);
      if (error) throw error;
      toast.success(nextVal ? 'Marked as Internal' : 'Marked as viewable by client');
      onRefresh?.();
    } catch (e: any) {
      console.error('Error toggling internal:', e);
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
        ? { internal_notes: notesDraft, updated_by: actor.fullName }
        : { client_notes: notesDraft, updated_by: actor.fullName };
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
      const addedItems: DocItem[] = Array.from(files).map((file, idx) => ({
        path: uploadedPaths[idx],
        name: file.name,
        mimeType: uploadedMimeTypes[idx],
      }));
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
        .update({ document_url: nextDocumentUrl, updated_by: actor.fullName })
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
        .map((d) => ({
          path: d.storage_path.trim(),
          name: d.file_name || undefined,
          mimeType: d.mime_type || inferMimeFromName(d.file_name),
        }))
        .filter((d) => d.path && !existingKeySet.has(String(d.path)));

      const merged = [...existingItems, ...addedItems];

      const actor = await fetchStageActorInfo();
      const { error } = await supabase
        .from('lead_sub_efforts')
        .update({ document_url: merged, updated_by: actor.fullName })
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
        .update({ active: nextActive, updated_by: actor.fullName })
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
      mobileFullHeight
      desktopFullScreen
      zIndex={50}
      contentClassName="!p-0 flex flex-col min-h-0 !overflow-hidden"
    >
        <div className="flex flex-col min-h-0 h-full flex-1 overflow-hidden bg-[#f5f5f5]">
        <div className="flex shrink-0 items-center justify-between px-4 py-3 md:px-6 md:py-4">
          <div className="min-w-0 flex items-center gap-3">
            {mobileStep === 'details' ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-square md:hidden"
                onClick={() => setMobileStep('list')}
                aria-label="Back to list"
                title="Back"
              >
                <ChevronLeftIcon className="w-5 h-5" />
              </button>
            ) : null}
            <div className="min-w-0">
              <div className="text-xl font-bold tracking-tight text-base-content/95">Sub efforts</div>
              <div className="text-xs text-base-content/50 truncate">
                {rows?.length ? `${rows.length} step${rows.length === 1 ? '' : 's'} in this case` : 'No steps yet'}
              </div>
            </div>
          </div>
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white text-gray-600 shadow-sm transition-colors hover:bg-gray-50"
            onClick={onClose}
            aria-label="Close"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-4 pb-4 md:px-6 md:pb-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[300px_1fr] lg:grid-cols-[320px_1fr]">
            {/* Workflow — separate white box */}
            <div className={mobileStep === 'details' ? 'hidden md:block' : 'block md:overflow-visible'}>
              <div className="overflow-visible rounded-[18px] border border-gray-200 bg-white/85 p-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)] md:p-5">
                <div className="mb-3 flex items-center justify-between gap-2 px-0.5">
                  <div>
                    <span className="text-base font-semibold text-base-content/80 md:text-lg">Workflow</span>
                  </div>
                  {isSavingTimelineOrder ? (
                    <span className="loading loading-spinner loading-xs text-base-content/40" />
                  ) : null}
                </div>
                {timelineRows.length ? (
                  <div>
                    {timelineRows.map((r: any, index: number) => {
                      const rowId = String(r?.id);
                      const isSelected = selectedRow?.id != null && String(selectedRow.id) === rowId;
                      return (
                        <TimelineStepButton
                          key={r?.id ?? index}
                          rowId={rowId}
                          row={r}
                          isSelected={isSelected}
                          isLast={index === timelineRows.length - 1}
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
                        />
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-base-content/50">
                    No sub efforts yet.
                  </div>
                )}

                {onAddSubEffort ? (
                  <div className="mt-4 border-t border-gray-200/80 pt-4">
                    <div className="dropdown dropdown-top dropdown-end w-full">
                      <button
                        type="button"
                        tabIndex={0}
                        disabled={isLoadingSubEffortOptions || isAddingSubEffort}
                        className="btn btn-sm h-10 w-full justify-between rounded-xl border border-gray-200 bg-white px-3 font-medium text-gray-700 shadow-sm hover:bg-gray-50"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          {isAddingSubEffort ? (
                            <span className="loading loading-spinner loading-xs" />
                          ) : (
                            <PlusIcon className="h-4 w-4 shrink-0" />
                          )}
                          <span className="truncate">Add sub effort</span>
                        </span>
                        <ChevronDownIcon className="h-4 w-4 shrink-0 text-gray-400" />
                      </button>
                      <ul
                        tabIndex={0}
                        className="dropdown-content menu z-[70] mb-2 flex max-h-56 w-72 min-w-[18rem] flex-col flex-nowrap overflow-x-hidden overflow-y-auto overscroll-y-contain rounded-xl border border-gray-200 bg-white p-2 shadow-lg"
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
                            <li key={opt.id}>
                              <button
                                type="button"
                                className="rounded-lg text-left text-sm whitespace-normal"
                                onClick={() => void handleAddSubEffort(opt)}
                              >
                                {opt.name}
                              </button>
                            </li>
                          ))
                        )}
                      </ul>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            {/* Detail panels — each section its own white box */}
            <div className={mobileStep === 'details' ? 'block' : 'hidden md:block'}>
              <div className="flex min-h-full flex-col space-y-4">
                {selectedRow ? (
                  <>
                    <div className="rounded-[18px] bg-white shadow-sm px-5 py-4">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                            <h2 className="text-2xl font-bold tracking-tight text-base-content/95 md:text-[28px]">
                              {selectedRow?.sub_efforts?.name ?? 'Sub effort'}
                            </h2>
                            <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-base-content/55">
                              <EmployeeAvatar
                                name={employeeDisplayName(selectedRow)}
                                photoUrl={getEmployeePhoto(selectedRow?.tenants_employee)}
                                size="md"
                              />
                              <span className="font-medium text-base-content/75">
                                {employeeDisplayName(selectedRow)}
                              </span>
                              <span className="text-base-content/25">·</span>
                              <span className="tabular-nums">{formatDateTime(selectedRow?.created_at)}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-2">
                          <VisibilityPill internal={selectedRow?.internal === true} size="lg" />
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm btn-square h-9 w-9 rounded-full bg-gray-50"
                            onClick={() => void toggleInternal()}
                            disabled={isTogglingInternal}
                            title="Toggle visibility"
                            aria-label="Toggle visibility"
                          >
                            {isTogglingInternal ? (
                              <span className="loading loading-spinner loading-xs" />
                            ) : (
                              <EyeIcon className="w-4 h-4" />
                            )}
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm btn-square h-9 w-9 rounded-full bg-gray-50"
                            onClick={() => onRefresh?.()}
                            title="Refresh"
                            aria-label="Refresh"
                          >
                            <ArrowPathIcon className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm h-9 gap-1.5 rounded-full border-none px-4 font-medium text-gray-700 shadow-none hover:bg-gray-100"
                          onClick={() => openNotesEditor('internal')}
                        >
                          <PencilSquareIcon className="w-4 h-4" />
                          Add note
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm h-9 gap-1.5 rounded-full border-none px-4 font-medium text-gray-700 shadow-none hover:bg-gray-100"
                          disabled={isUploading || !selectedRow?.id}
                          onClick={() => fileInputRef.current?.click()}
                        >
                          {isUploading ? (
                            <span className="loading loading-spinner loading-xs" />
                          ) : (
                            <ArrowUpTrayIcon className="w-4 h-4" />
                          )}
                          Upload document
                        </button>
                        <button
                          type="button"
                          className={`btn btn-sm h-9 gap-1.5 rounded-full px-4 font-semibold ${
                            selectedIsActive ? 'btn-primary' : 'bg-white text-gray-700 shadow-sm hover:bg-gray-50'
                          }`}
                          onClick={() => void toggleComplete()}
                          disabled={isMarkingComplete}
                        >
                          {isMarkingComplete ? (
                            <span className="loading loading-spinner loading-xs" />
                          ) : null}
                          {selectedIsActive ? 'Mark complete' : 'Reopen'}
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                      <div>
                        <div className="mb-2 flex items-center justify-between gap-2 px-0.5">
                          <div className="flex items-center gap-2">
                            <LockClosedIcon className="h-4 w-4 text-base-content/40" />
                            <span className="text-sm font-semibold text-base-content/75">Internal notes</span>
                          </div>
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs btn-square shrink-0"
                            onClick={() => openNotesEditor('internal')}
                            aria-label="Edit internal notes"
                          >
                            <PencilSquareIcon className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="rounded-[18px] bg-white shadow-sm px-5 py-4">
                          <div>
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
                        </div>
                      </div>

                      <div>
                        <div className="mb-2 flex items-center justify-between gap-2 px-0.5">
                          <div className="flex items-center gap-2">
                            <EyeIcon className="h-4 w-4 text-base-content/40" />
                            <span className="text-sm font-semibold text-base-content/75">Client notes</span>
                          </div>
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs btn-square shrink-0"
                            onClick={() => openNotesEditor('client')}
                            aria-label="Edit client notes"
                          >
                            <PencilSquareIcon className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="rounded-[18px] bg-white shadow-sm px-5 py-4">
                          <div>
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
                        </div>
                      </div>
                    </div>

                    <div>
                      <div className="mb-2 flex items-center justify-between gap-3 px-0.5">
                        <div className="flex items-center gap-2">
                          <DocumentIcon className="h-4 w-4 text-base-content/40" />
                          <span className="text-sm font-semibold text-base-content/75">Documents</span>
                        </div>
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs gap-1 rounded-full px-2.5 text-base-content/60 hover:bg-white hover:shadow-sm"
                          onClick={() => void openAttachFromCaseDocs()}
                          disabled={!selectedRow?.id}
                        >
                          <PlusIcon className="w-3.5 h-3.5" />
                          Attach from case
                        </button>
                      </div>
                      <div className="rounded-[18px] bg-white shadow-sm px-5 py-4">
                    {(() => {
                      const uploader = String(
                        selectedRow?.tenants_employee?.display_name ?? selectedRow?.created_by ?? '—',
                      );
                      const uploadedAt = formatDateTime(selectedRow?.created_at);
                      const hasAny = resolvedDocs.length > 0;
                      const hasReady = resolvedDocs.some((d) => d.url);

                      if (!hasAny) {
                        return (
                          <div
                            className={`flex min-h-[200px] flex-col items-center justify-center rounded-xl border border-dashed px-5 py-12 text-center transition ${
                              isDraggingDocs
                                ? 'border-primary/40 bg-primary/5'
                                : 'border-gray-200 bg-gray-50/50 hover:border-gray-300'
                            }`}
                            onDragEnter={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setIsDraggingDocs(true);
                            }}
                            onDragOver={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setIsDraggingDocs(true);
                            }}
                            onDragLeave={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setIsDraggingDocs(false);
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setIsDraggingDocs(false);
                              void handleUploadFiles(e.dataTransfer?.files ?? null);
                            }}
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
                              Upload a file or attach from the case
                            </p>
                          </div>
                        );
                      }

                      if (!hasReady) {
                        return (
                          <div className="flex items-center gap-3 py-6 text-sm text-base-content/50">
                            <span className="loading loading-spinner loading-sm" />
                            Loading documents…
                          </div>
                        );
                      }

                      return (
                        <div className="space-y-3">
                          <div className="divide-y divide-gray-100">
                            {resolvedDocs.map((doc, idx) => {
                              const href = doc.url || doc.raw;
                              const canPreview = !!doc.url;
                              const typeLabel = formatFileTypeLabel(doc.mimeType, doc.name);
                              return (
                                <div
                                  key={`${doc.raw}-${idx}`}
                                  className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center"
                                >
                                  <div className="flex min-w-0 flex-1 items-center gap-3">
                                    <button
                                      type="button"
                                      disabled={!canPreview}
                                      onClick={() => openDocPreview(doc)}
                                      className={`flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-100 ${
                                        canPreview ? 'cursor-pointer hover:ring-2 hover:ring-primary/20' : 'cursor-default'
                                      }`}
                                      aria-label={canPreview ? `Preview ${doc.name}` : undefined}
                                    >
                                      {doc.isImage && canPreview ? (
                                        <img
                                          src={doc.url}
                                          alt=""
                                          className="h-full w-full object-cover"
                                          loading="lazy"
                                        />
                                      ) : doc.isPdf ? (
                                        <DocumentIcon className="h-6 w-6 text-red-500/80" />
                                      ) : (
                                        <DocumentIcon className="h-6 w-6 text-slate-400" />
                                      )}
                                    </button>
                                    <div className="min-w-0">
                                      <div className="truncate text-sm font-semibold text-base-content/85">{doc.name}</div>
                                      <div className="mt-0.5 text-xs text-base-content/45">
                                        {typeLabel}
                                        <span className="mx-1.5 text-base-content/20">·</span>
                                        {uploadedAt}
                                        <span className="mx-1.5 text-base-content/20">·</span>
                                        {uploader}
                                      </div>
                                    </div>
                                  </div>
                                  <div className="flex shrink-0 items-center gap-1.5 sm:pl-2">
                                    {canPreview ? (
                                      <button
                                        type="button"
                                        onClick={() => openDocPreview(doc)}
                                        className="btn btn-ghost btn-xs h-8 rounded-full px-3"
                                      >
                                        Preview
                                      </button>
                                    ) : null}
                                    <a
                                      href={href}
                                      target="_blank"
                                      rel="noreferrer"
                                      download={doc.name}
                                      className="btn btn-ghost btn-xs h-8 gap-1 rounded-full px-3"
                                    >
                                      <ArrowDownTrayIcon className="h-3.5 w-3.5" />
                                      Download
                                    </a>
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          <div
                            className={`flex min-h-[100px] flex-col items-center justify-center rounded-xl border border-dashed px-4 py-8 text-center transition ${
                              isDraggingDocs
                                ? 'border-primary/40 bg-primary/5'
                                : 'border-gray-200 bg-gray-50/40 hover:border-gray-300'
                            }`}
                            onDragEnter={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setIsDraggingDocs(true);
                            }}
                            onDragOver={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setIsDraggingDocs(true);
                            }}
                            onDragLeave={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setIsDraggingDocs(false);
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setIsDraggingDocs(false);
                              void handleUploadFiles(e.dataTransfer?.files ?? null);
                            }}
                            role="button"
                            tabIndex={0}
                            onClick={() => fileInputRef.current?.click()}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
                            }}
                          >
                            <span className="text-xs font-medium text-base-content/45">
                              Drop more files here or click to upload
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

                    <div className="flex justify-end pt-1">
                      <div className="inline-flex max-w-full flex-wrap items-center justify-end gap-2 text-xs text-base-content/45">
                        <span>Last updated by</span>
                        <EmployeeAvatar
                          name={updaterDisplayName(selectedRow)}
                          photoUrl={resolveUpdaterPhoto(selectedRow)}
                          size="md"
                        />
                        <span className="font-medium text-base-content/70">{updaterDisplayName(selectedRow)}</span>
                        <span className="text-base-content/25">·</span>
                        <span className="tabular-nums">
                          {formatDateTime(selectedRow?.updated_at ?? selectedRow?.created_at)}
                        </span>
                      </div>
                    </div>
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
                            className="h-14 w-14 shrink-0 rounded-lg bg-base-200 overflow-hidden flex items-center justify-center cursor-pointer"
                            title="Open file"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              const url = String(d.signedUrl || '').trim();
                              if (!url) {
                                toast.error('No preview link is available for this file yet.');
                                return;
                              }
                              window.open(url, '_blank', 'noopener,noreferrer');
                            }}
                          >
                            {isImg && d.signedUrl ? (
                              <img src={d.signedUrl} alt="" className="h-full w-full object-cover" />
                            ) : (
                              <span className="text-[10px] opacity-70">{isImg ? 'IMG' : 'DOC'}</span>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div
                              className="text-sm font-semibold truncate hover:underline"
                              title="Open file"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                const url = String(d.signedUrl || '').trim();
                                if (!url) {
                                  toast.error('No preview link is available for this file yet.');
                                  return;
                                }
                                window.open(url, '_blank', 'noopener,noreferrer');
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
        }}
        documents={previewItems}
        initialIndex={previewInitialIndex}
      />
    </>
  );
}

