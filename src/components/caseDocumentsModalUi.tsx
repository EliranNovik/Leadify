import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CheckIcon,
  ChevronRightIcon,
  EllipsisHorizontalIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
  TagIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import type { CaseCategoryDocument } from '../lib/sequenceOfEventsDocuments';
import type { LeadCaseDocumentType } from '../lib/leadCaseDocumentsApi';
import {
  normalizeStorageKey,
  type SubEffortAttachOption,
  type SubEffortAttachmentRef,
} from '../lib/subEffortDocumentAttach';
import { UploaderAttribution } from './UploaderAttribution';

/** Soft / washed pastel badges for labels (document type, sub efforts, client). */
const WASHED_BADGE_COLORS = [
  'bg-sky-100/70 text-sky-700/80',
  'bg-violet-100/70 text-violet-700/80',
  'bg-emerald-100/70 text-emerald-700/80',
  'bg-amber-100/70 text-amber-800/75',
  'bg-rose-100/70 text-rose-700/80',
  'bg-teal-100/70 text-teal-700/80',
  'bg-indigo-100/70 text-indigo-700/80',
  'bg-orange-100/70 text-orange-800/75',
  'bg-fuchsia-100/70 text-fuchsia-700/80',
  'bg-lime-100/70 text-lime-800/75',
  'bg-cyan-100/70 text-cyan-700/80',
  'bg-pink-100/70 text-pink-700/80',
] as const;

export function washedBadgeClass(key: string): string {
  let hash = 0;
  const normalized = key.trim().toLowerCase();
  for (let i = 0; i < normalized.length; i++) {
    hash = (hash * 31 + normalized.charCodeAt(i)) >>> 0;
  }
  return WASHED_BADGE_COLORS[hash % WASHED_BADGE_COLORS.length];
}

export function ClientUploadBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-sky-100/70 text-sky-700/75 ${className}`}
    >
      Client
    </span>
  );
}

export function SubEffortAttachBadge({
  name,
  highlight = false,
  title,
  className = '',
}: {
  name: string;
  highlight?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex max-w-full min-w-0 items-center rounded-md px-2.5 py-1 text-left text-sm leading-snug break-words whitespace-normal [overflow-wrap:anywhere] ${
        highlight
          ? 'bg-emerald-200/60 font-medium text-emerald-800/85'
          : `${washedBadgeClass(name)} font-normal`
      } ${className}`}
      title={title ?? `Attached to ${name}`}
    >
      {name}
    </span>
  );
}

export function DocumentUploaderCell({
  name,
  photoUrl,
  isClientPortalUpload,
  className = '',
}: {
  name?: string | null;
  photoUrl?: string | null;
  isClientPortalUpload?: boolean;
  className?: string;
}) {
  const displayName = name?.trim() || null;

  if (isClientPortalUpload) {
    return (
      <span className={`inline-flex max-w-full min-w-0 items-center justify-center gap-1.5 ${className}`}>
        {displayName ? (
          <span className="min-w-0 truncate font-medium text-base-content/80">{displayName}</span>
        ) : (
          <span className="text-base-content/50">—</span>
        )}
        <ClientUploadBadge />
      </span>
    );
  }

  if (!displayName) {
    return <span className="text-base-content/50">—</span>;
  }

  return (
    <UploaderAttribution
      name={displayName}
      photoUrl={photoUrl}
      className={`justify-center ${className}`}
      imageClassName="h-9 w-9 text-[11px]"
    />
  );
}

export const UNATTACHED_FILTER_VALUE = '__unattached__';
export const NO_DOCUMENT_TYPE_FILTER_VALUE = '__no_type__';

export type CaseDocsFilterState = {
  search: string;
  dateFrom: string;
  dateTo: string;
  uploader: 'all' | 'client' | 'employee';
  subEffortId: string;
  documentTypeId: string;
};

export const EMPTY_CASE_DOCS_FILTERS: CaseDocsFilterState = {
  search: '',
  dateFrom: '',
  dateTo: '',
  uploader: 'all',
  subEffortId: '',
  documentTypeId: '',
};

function dayStartMs(yyyyMmDd: string): number | null {
  const s = yyyyMmDd.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

function dayEndMs(yyyyMmDd: string): number | null {
  const s = yyyyMmDd.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T23:59:59.999`);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

export function filterCaseCategoryDocuments(
  docs: CaseCategoryDocument[],
  filters: CaseDocsFilterState,
  options?: {
    attachmentsByPath?: Map<string, SubEffortAttachmentRef[]>;
    /** When false, skip sub-effort filter (e.g. client uploads list of unattached only). */
    applySubEffortFilter?: boolean;
  },
): CaseCategoryDocument[] {
  const search = filters.search.trim().toLowerCase();
  const fromMs = dayStartMs(filters.dateFrom);
  const toMs = dayEndMs(filters.dateTo);
  const applySub = options?.applySubEffortFilter !== false;
  const attachmentsByPath = options?.attachmentsByPath;

  return docs.filter((doc) => {
    if (search && !doc.name.toLowerCase().includes(search)) return false;

    const uploadedMs = new Date(doc.lastModified).getTime();
    if (!Number.isNaN(uploadedMs)) {
      if (fromMs != null && uploadedMs < fromMs) return false;
      if (toMs != null && uploadedMs > toMs) return false;
    }

    if (filters.uploader === 'client' && !doc.isClientPortalUpload) return false;
    if (filters.uploader === 'employee' && doc.isClientPortalUpload) return false;

    if (filters.documentTypeId) {
      const typeId = String(doc.documentTypeId ?? '').trim();
      if (filters.documentTypeId === NO_DOCUMENT_TYPE_FILTER_VALUE) {
        if (typeId) return false;
      } else if (typeId !== String(filters.documentTypeId)) {
        return false;
      }
    }

    if (applySub && filters.subEffortId) {
      const path = normalizeStorageKey(doc.storagePath);
      const attached = path && attachmentsByPath ? attachmentsByPath.get(path) ?? [] : [];
      if (filters.subEffortId === UNATTACHED_FILTER_VALUE) {
        if (attached.length > 0) return false;
      } else if (!attached.some((a) => String(a.id) === String(filters.subEffortId))) {
        return false;
      }
    }

    return true;
  });
}

export function CaseDocumentsModalFilterBar({
  filters,
  onChange,
  attachOptions = [],
  documentTypes = [],
  showSubEffortFilter = true,
  showDocumentTypeFilter = true,
}: {
  filters: CaseDocsFilterState;
  onChange: (next: CaseDocsFilterState) => void;
  attachOptions?: SubEffortAttachOption[];
  documentTypes?: LeadCaseDocumentType[];
  showSubEffortFilter?: boolean;
  showDocumentTypeFilter?: boolean;
}) {
  const set = <K extends keyof CaseDocsFilterState>(key: K, value: CaseDocsFilterState[K]) => {
    onChange({ ...filters, [key]: value });
  };

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 bg-[#f5f5f5] px-4 pb-3 md:px-6">
      <div className="relative w-44 shrink-0 sm:w-52">
        <MagnifyingGlassIcon
          className="pointer-events-none absolute left-2.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-base-content/45"
          aria-hidden
        />
        <input
          type="text"
          className="input input-bordered input-sm h-8 w-full rounded-lg bg-white !pl-8 text-sm"
          placeholder="Search by file…"
          value={filters.search}
          onChange={(e) => set('search', e.target.value)}
          aria-label="Search by file name"
        />
      </div>
      <label className="flex min-w-0 items-center gap-1.5 text-xs text-base-content/55">
        <span className="shrink-0 whitespace-nowrap">From</span>
        <input
          type="date"
          className="input input-bordered input-sm h-8 w-[9.5rem] rounded-lg bg-white text-sm"
          value={filters.dateFrom}
          onChange={(e) => set('dateFrom', e.target.value)}
          aria-label="Filter from date uploaded"
        />
      </label>
      <label className="flex min-w-0 items-center gap-1.5 text-xs text-base-content/55">
        <span className="shrink-0 whitespace-nowrap">To</span>
        <input
          type="date"
          className="input input-bordered input-sm h-8 w-[9.5rem] rounded-lg bg-white text-sm"
          value={filters.dateTo}
          onChange={(e) => set('dateTo', e.target.value)}
          aria-label="Filter to date uploaded"
        />
      </label>
      <select
        className="select select-bordered select-sm h-8 min-h-8 w-auto min-w-[9rem] rounded-lg bg-white text-sm"
        value={filters.uploader}
        onChange={(e) => set('uploader', e.target.value as CaseDocsFilterState['uploader'])}
        aria-label="Filter by uploader"
      >
        <option value="all">All uploaders</option>
        <option value="client">Client uploaded</option>
        <option value="employee">Employee uploaded</option>
      </select>
      {showDocumentTypeFilter ? (
        <select
          className="select select-bordered select-sm h-8 min-h-8 min-w-[10rem] max-w-[14rem] rounded-lg bg-white text-sm"
          value={filters.documentTypeId}
          onChange={(e) => set('documentTypeId', e.target.value)}
          aria-label="Filter by document type"
        >
          <option value="">All document types</option>
          <option value={NO_DOCUMENT_TYPE_FILTER_VALUE}>No type</option>
          {documentTypes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      ) : null}
      {showSubEffortFilter ? (
        <select
          className="select select-bordered select-sm h-8 min-h-8 min-w-[10rem] max-w-[14rem] rounded-lg bg-white text-sm"
          value={filters.subEffortId}
          onChange={(e) => set('subEffortId', e.target.value)}
          aria-label="Filter by sub effort"
        >
          <option value="">All sub efforts</option>
          <option value={UNATTACHED_FILTER_VALUE}>Not attached yet</option>
          {attachOptions.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.name}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}

export function TableSelectAllHeader({
  label = 'Document name',
  checked,
  indeterminate = false,
  disabled = false,
  onChange,
}: {
  label?: string;
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !checked;
  }, [indeterminate, checked]);

  return (
    <input
      ref={ref}
      type="checkbox"
      className="checkbox checkbox-sm"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      aria-label={`Select all in ${label}`}
    />
  );
}

export function DocRowActionsMenu({
  onEditFileName,
  onDelete,
  documentTypes = [],
  currentDocumentTypeId = null,
  onSelectDocumentType,
  disabled = false,
  deleting = false,
  savingDocumentType = false,
}: {
  onEditFileName: () => void;
  onDelete: () => void;
  documentTypes?: LeadCaseDocumentType[];
  currentDocumentTypeId?: string | null;
  onSelectDocumentType?: (type: LeadCaseDocumentType | null) => void;
  disabled?: boolean;
  deleting?: boolean;
  savingDocumentType?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [typePanelOpen, setTypePanelOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{
    top?: number;
    bottom?: number;
    right: number;
    maxHeight: number;
  } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const updateMenuPos = () => {
    const btn = buttonRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const gap = 4;
    const margin = 8;
    const estimated = typePanelOpen ? 340 : 220;
    const spaceBelow = window.innerHeight - rect.bottom - gap - margin;
    const spaceAbove = rect.top - gap - margin;
    const openUp = spaceBelow < Math.min(estimated, 240) && spaceAbove > spaceBelow;
    const available = Math.max(140, openUp ? spaceAbove : spaceBelow);
    const maxHeight = Math.min(280, available);
    const right = Math.max(8, window.innerWidth - rect.right);
    if (openUp) {
      setMenuPos({
        bottom: Math.max(margin, window.innerHeight - rect.top + gap),
        right,
        maxHeight,
      });
    } else {
      setMenuPos({
        top: rect.bottom + gap,
        right,
        maxHeight,
      });
    }
  };

  useEffect(() => {
    if (!open) {
      setTypePanelOpen(false);
      setMenuPos(null);
      return;
    }
    updateMenuPos();
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
      setTypePanelOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (typePanelOpen) setTypePanelOpen(false);
        else setOpen(false);
      }
    };
    const onReposition = () => updateMenuPos();
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [open, typePanelOpen]);

  const busy = disabled || deleting || savingDocumentType;

  const menu =
    open && menuPos
      ? createPortal(
          <div
            ref={menuRef}
            className="fixed z-[80] flex items-stretch"
            style={{
              top: menuPos.top,
              bottom: menuPos.bottom,
              right: menuPos.right,
              maxHeight: menuPos.maxHeight,
            }}
          >
            {typePanelOpen && onSelectDocumentType ? (
              <div
                role="menu"
                className="mr-1 flex w-56 min-h-0 flex-col overflow-hidden rounded-xl border border-base-200 bg-white py-1 shadow-lg"
                style={{ maxHeight: menuPos.maxHeight }}
              >
                <div className="shrink-0 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-base-content/45">
                  Document type
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                  <button
                    type="button"
                    role="menuitem"
                    className={`flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm hover:bg-base-200/70 ${
                      !currentDocumentTypeId ? 'font-semibold text-primary' : 'text-base-content'
                    }`}
                    onClick={() => {
                      onSelectDocumentType(null);
                      setOpen(false);
                      setTypePanelOpen(false);
                    }}
                  >
                    <span>None</span>
                    {!currentDocumentTypeId ? <CheckIcon className="h-4 w-4 shrink-0" /> : null}
                  </button>
                  {documentTypes.map((t) => {
                    const selected = String(currentDocumentTypeId ?? '') === String(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        role="menuitem"
                        className={`flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm hover:bg-base-200/70 ${
                          selected ? 'font-semibold text-primary' : 'text-base-content'
                        }`}
                        onClick={() => {
                          onSelectDocumentType(t);
                          setOpen(false);
                          setTypePanelOpen(false);
                        }}
                      >
                        <span className="min-w-0 truncate">{t.name}</span>
                        {selected ? <CheckIcon className="h-4 w-4 shrink-0" /> : null}
                      </button>
                    );
                  })}
                  {documentTypes.length === 0 ? (
                    <div className="px-3 py-2.5 text-sm text-base-content/50">No document types</div>
                  ) : null}
                </div>
              </div>
            ) : null}
            <div
              role="menu"
              className="flex w-48 shrink-0 flex-col overflow-y-auto overscroll-contain rounded-xl border border-base-200 bg-white py-1 shadow-lg"
              style={{ maxHeight: menuPos.maxHeight }}
            >
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-base-content hover:bg-base-200/70"
                onClick={() => {
                  setOpen(false);
                  setTypePanelOpen(false);
                  onEditFileName();
                }}
              >
                <PencilSquareIcon className="h-4 w-4 opacity-70" />
                Edit file name
              </button>
              {onSelectDocumentType ? (
                <button
                  type="button"
                  role="menuitem"
                  className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-base-200/70 ${
                    typePanelOpen ? 'bg-base-200/60 font-medium text-primary' : 'text-base-content'
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setTypePanelOpen((v) => !v);
                  }}
                >
                  <TagIcon className="h-4 w-4 opacity-70" />
                  <span className="min-w-0 flex-1">Document type</span>
                  <ChevronRightIcon className="h-4 w-4 opacity-60" />
                </button>
              ) : null}
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-red-600 hover:bg-red-50"
                onClick={() => {
                  setOpen(false);
                  setTypePanelOpen(false);
                  onDelete();
                }}
              >
                <TrashIcon className="h-4 w-4" />
                Delete
              </button>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="inline-flex justify-end">
      <button
        ref={buttonRef}
        type="button"
        className="btn btn-ghost btn-circle btn-sm"
        disabled={busy}
        aria-label="Document actions"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={(e) => {
          e.stopPropagation();
          const next = !open;
          if (next) {
            // Position is computed in effect via updateMenuPos after open.
            setMenuPos({
              top: e.currentTarget.getBoundingClientRect().bottom + 4,
              right: Math.max(8, window.innerWidth - e.currentTarget.getBoundingClientRect().right),
              maxHeight: 280,
            });
          }
          setOpen(next);
          setTypePanelOpen(false);
        }}
      >
        {deleting || savingDocumentType ? (
          <span className="loading loading-spinner loading-xs" />
        ) : (
          <EllipsisHorizontalIcon className="h-5 w-5" />
        )}
      </button>
      {menu}
    </div>
  );
}
