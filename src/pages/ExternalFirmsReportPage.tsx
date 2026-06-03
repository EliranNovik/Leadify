import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeftIcon,
  BuildingOffice2Icon,
  MagnifyingGlassIcon,
  UserIcon,
  UsersIcon,
  ChevronRightIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  XCircleIcon,
  StarIcon,
  LinkIcon,
  EnvelopeIcon,
  PhoneIcon,
  GlobeAltIcon,
  IdentificationIcon,
  DocumentTextIcon,
  SignalIcon,
  FunnelIcon,
  EllipsisVerticalIcon,
  ExclamationTriangleIcon,
  ChevronUpDownIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  XMarkIcon,
  PlusIcon,
  BanknotesIcon,
  PencilIcon,
  TrashIcon,
  CameraIcon,
} from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import {
  FIRM_INVOICE_DOCUMENTS_BUCKET,
  buildFirmInvoiceStoragePath,
} from '../lib/firmInvoiceDocuments';
import {
  DocumentPreviewModal,
  type DocumentPreviewItem,
} from '../components/DocumentModal';
import {
  bucketForManagementCostDocColumn,
  fileNameFromStoragePath,
  guessMimeTypeFromFileName,
  uploadFirmManagementCostDocument,
  type FirmManagementCostDocColumn,
} from '../lib/firmManagementCostDocuments';
import {
  defaultMarketingExpenseTypeId,
  expenseTypeLabel,
  fetchActiveExpenseTypes,
  type ExpenseTypeRow,
} from '../lib/expenseTypes';
import FirmTypeBadge from '../components/FirmTypeBadge';
import { ChannelLabel } from '../components/ChannelLabel';
import {
  extractFirmProfileImageObjectPath,
  removeFirmProfileImageFromStorage,
  uploadContactProfileImage,
  uploadFirmCoverImage,
  uploadFirmProfileImage,
} from '../lib/firmProfileImages';

// ─── Types ────────────────────────────────────────────────────────────────────

type FirmTypeRow = { id: string; code: string | null; label: string | null };

type ChannelRow = { id: string; code: string; label: string; is_active?: boolean };

/** Lightweight source meta kept in state after fetch */
type SourceMeta = { id: string; name: string; channel_id: string | null };

type UserRow = Record<string, any> & {
  id?: string | number;
  email?: string | null;
  auth_id?: string | null;
  extern_firm_id?: string | null;
  extern_source_id?: string | number | null;
  created_at?: string | null;
};

type FirmContactRow = {
  id: string;
  firm_id: string;
  name: string | null;
  email: string | null;
  second_email: string | null;
  phone: string | null;
  user_email: string | null;
  user_id: string | null;
  firm_owner: boolean | null;
  is_active: boolean | null;
  notes: string | null;
  profile_image_url: string | null;
  created_at: string | null;
  updated_at: string | null;
  users?: UserRow | null;
};

type FirmManagementCostRow = {
  id: string;
  firm_id: string;
  billing_month: string;
  amount: number | string | null;
  currency: string | null;
  notes: string | null;
  payment_confirmation: string | null;
  tax_receipt: string | null;
  expense_type_id: string | null;
  expense_types?: { label: string } | { label: string }[] | null;
  created_at: string | null;
  updated_at: string | null;
};

function resolveExpenseTypeDisplayName(cost: FirmManagementCostRow | null | undefined): string {
  if (!cost) return '—';
  const nested = cost.expense_types;
  if (Array.isArray(nested)) return nested[0]?.label?.trim() || '—';
  if (nested && typeof nested === 'object' && 'label' in nested) {
    const label = (nested as { label?: string }).label;
    if (label?.trim()) return label.trim();
  }
  return '—';
}

/** One table row per month: management cost + optional invoice for that month */
type MergedManagementCostRow = {
  monthAnchor: string;
  cost: FirmManagementCostRow | null;
  invoice: FirmInvoiceRow | null;
};

type FirmInvoiceRow = {
  id: string;
  firm_id: string;
  invoice_month: string;
  amount: number | string | null;
  currency: string | null;
  notes: string | null;
  storage_path: string | null;
  file_name: string | null;
  mime_type: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type SavedView = {
  id: string;
  user_id: string;
  view_name: string;
  filters: {
    query: string;
    status: string;
    type: string;
  };
  sort_config: {
    key: string;
    dir: string;
  };
  is_default: boolean;
};

type ActivityLog = {
  id: string;
  firm_id: string | null;
  contact_id: string | null;
  action_type: string;
  description: string;
  performed_by_name?: string;
  created_at: string;
};

type FirmRow = {
  id: string;
  name: string;
  firm_type_id: string | null;
  legal_name: string | null;
  vat_number: string | null;
  website: string | null;
  address: string | null;
  contract: string | null;
  invoices: string | null;
  other_docs: string | null;
  notes: string | null;
  profile_image_url: string | null;
  cover_image_url: string | null;
  is_active: boolean | null;
  created_at: string | null;
  updated_at: string | null;
  firm_types?: FirmTypeRow | null;
  firm_contacts?: FirmContactRow[] | null;
  firm_management_costs?: FirmManagementCostRow[] | null;
  firm_invoices?: FirmInvoiceRow[] | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(v?: string | null) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

type MissingDataRow = {
  id: string;
  entity: 'Firm' | 'Contact';
  firmId: string;
  firmName: string;
  contactId?: string;
  contactName?: string;
  missingFields: string[];
};

function collectMissingDataRows(firms: FirmRow[]): MissingDataRow[] {
  const rows: MissingDataRow[] = [];
  for (const firm of firms) {
    const firmMissing: string[] = [];
    if (!firm.firm_types?.id) firmMissing.push('Firm type');
    if (!firm.vat_number?.trim()) firmMissing.push('VAT');
    if (!firm.website?.trim()) firmMissing.push('Website');

    if (firmMissing.length > 0) {
      rows.push({
        id: `firm-${firm.id}`,
        entity: 'Firm',
        firmId: firm.id,
        firmName: firm.name,
        missingFields: firmMissing,
      });
    }

    for (const contact of firm.firm_contacts || []) {
      const contactMissing: string[] = [];
      if (!contact.name?.trim()) contactMissing.push('Name');
      if (!contact.email?.trim()) contactMissing.push('Email');
      if (!contact.phone?.trim()) contactMissing.push('Phone');

      if (contactMissing.length > 0) {
        rows.push({
          id: `contact-${contact.id}`,
          entity: 'Contact',
          firmId: firm.id,
          firmName: firm.name,
          contactId: contact.id,
          contactName: contact.name?.trim() || '—',
          missingFields: contactMissing,
        });
      }
    }
  }

  return rows.sort(
    (a, b) =>
      a.firmName.localeCompare(b.firmName) ||
      a.entity.localeCompare(b.entity) ||
      (a.contactName || '').localeCompare(b.contactName || ''),
  );
}

/** Display YYYY-MM-DD (month anchor) as e.g. Apr 2026 */
function formatMonthAnchor(isoDate?: string | null) {
  if (!isoDate) return '—';
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short' });
}

function parseAmount(n: unknown): number | null {
  if (n == null || n === '') return null;
  const x = typeof n === 'number' ? n : Number.parseFloat(String(n));
  return Number.isFinite(x) ? x : null;
}

/** Israeli new shekel (NIS); ISO 4217 for DB and Intl.NumberFormat */
const FIRM_MONEY_CURRENCY = 'ILS' as const;

function moneyStr(amount: unknown, currency?: string | null) {
  const a = parseAmount(amount);
  if (a == null) return '—';
  const cur = (currency || FIRM_MONEY_CURRENCY).trim();
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(a);
  } catch {
    return `${a.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
  }
}

/** `<input type="month" />` uses YYYY-MM; store as first day of month in DB */
function monthInputToIsoFirstDay(ym: string): string {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`;
  return `${ym}-01`;
}

function isoFirstDayToMonthInput(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthAnchorKey(isoDate?: string | null): string {
  if (!isoDate) return '';
  const s = String(isoDate).trim().slice(0, 10);
  const match = s.match(/^(\d{4})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-01` : s;
}

function buildMergedManagementRows(
  costs: FirmManagementCostRow[],
  invoices: FirmInvoiceRow[],
): MergedManagementCostRow[] {
  const byMonth = new Map<string, MergedManagementCostRow>();

  costs.forEach((cost) => {
    const key = monthAnchorKey(cost.billing_month);
    if (!key) return;
    const existing = byMonth.get(key);
    byMonth.set(key, { monthAnchor: key, cost, invoice: existing?.invoice ?? null });
  });

  invoices.forEach((invoice) => {
    const key = monthAnchorKey(invoice.invoice_month);
    if (!key) return;
    const existing = byMonth.get(key);
    if (existing) {
      existing.invoice = invoice;
    } else {
      byMonth.set(key, { monthAnchor: key, cost: null, invoice });
    }
  });

  return [...byMonth.values()].sort((a, b) => b.monthAnchor.localeCompare(a.monthAnchor));
}

function ManagementCostDocLink({
  storagePath,
  onOpen,
}: {
  storagePath?: string | null;
  onOpen: (storagePath: string, fileName: string) => void;
}) {
  const path = storagePath?.trim();
  if (!path) {
    return <span className="text-base-content/35">—</span>;
  }
  const label = fileNameFromStoragePath(path) || 'Document';
  return (
    <button
      type="button"
      className="link link-primary text-sm max-w-[10rem] truncate inline-block align-top"
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(path, label);
      }}
    >
      <DocumentTextIcon className="inline h-4 w-4 mr-1 align-text-bottom shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}

const FIRM_TABLE_ACTIONS_MENU_EST_HEIGHT_PX = 108;
const FIRM_TABLE_ACTIONS_MENU_WIDTH_PX = 176;

/** Portaled row actions menu (avoids overflow clipping inside scrollable tables). */
function FirmTableActionsDropdown({
  ariaLabel,
  onEdit,
  onDelete,
}: {
  ariaLabel: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({ visibility: 'hidden' });

  const updatePosition = useCallback(() => {
    const btn = triggerRef.current;
    if (!btn) return;

    const rect = btn.getBoundingClientRect();
    const menuH = menuRef.current?.offsetHeight || FIRM_TABLE_ACTIONS_MENU_EST_HEIGHT_PX;
    const menuW = menuRef.current?.offsetWidth || FIRM_TABLE_ACTIONS_MENU_WIDTH_PX;
    const gap = 4;

    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const openUp = spaceBelow < menuH + gap + 8 && spaceAbove >= spaceBelow;

    const top = openUp ? rect.top - menuH - gap : rect.bottom + gap;
    const left = Math.max(8, Math.min(rect.right - menuW, window.innerWidth - menuW - 8));

    setMenuStyle({
      position: 'fixed',
      top,
      left,
      zIndex: 10000,
      width: FIRM_TABLE_ACTIONS_MENU_WIDTH_PX,
      visibility: 'visible',
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const raf = requestAnimationFrame(updatePosition);
    const onScrollOrResize = () => updatePosition();
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (triggerRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="btn btn-ghost btn-xs btn-square min-h-8 min-w-8"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
      >
        <EllipsisVerticalIcon className="h-5 w-5" />
      </button>
      {open &&
        createPortal(
          <ul
            ref={menuRef}
            role="menu"
            style={menuStyle}
            className="menu rounded-box border border-base-300 bg-base-100 p-2.5 shadow-lg gap-0.5 min-w-[11rem]"
            data-firm-table-actions-menu
            onClick={(e) => e.stopPropagation()}
          >
            <li role="none">
              <button
                type="button"
                role="menuitem"
                className="flex items-center gap-2.5 w-full text-left text-sm font-medium px-3 py-2.5 rounded-lg hover:bg-base-200"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setOpen(false);
                  onEdit();
                }}
              >
                <PencilIcon className="h-4 w-4 shrink-0 text-base-content/70" />
                Edit
              </button>
            </li>
            <li role="none">
              <button
                type="button"
                role="menuitem"
                className="flex items-center gap-2.5 w-full text-left text-sm font-medium px-3 py-2.5 rounded-lg hover:bg-error/10 text-error"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setOpen(false);
                  onDelete();
                }}
              >
                <TrashIcon className="h-4 w-4 shrink-0" />
                Delete
              </button>
            </li>
          </ul>,
          document.body,
        )}
    </>
  );
}

function parseExternSourceIds(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.flatMap((v) => parseExternSourceIds(v)).map((v) => v.trim()).filter(Boolean);
  }
  if (typeof value === 'number') return [String(value)];
  if (typeof value === 'string') {
    if (value.includes(',')) return value.split(',').map((v) => v.trim()).filter(Boolean);
    return [value.trim()].filter(Boolean);
  }
  try {
    const s = String(value).trim();
    return s ? [s] : [];
  } catch {
    return [];
  }
}

function initialsFromName(name?: string | null) {
  const s = (name || '').trim();
  if (!s) return 'U';
  return s.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || 'U';
}

/** High-contrast palette (inline styles — not dependent on Tailwind purge) */
const INITIALS_AVATAR_PALETTE: ReadonlyArray<{ bg: string; fg: string }> = [
  { bg: '#3730a3', fg: '#ffffff' },
  { bg: '#5b21b6', fg: '#ffffff' },
  { bg: '#1d4ed8', fg: '#ffffff' },
  { bg: '#0f766e', fg: '#ffffff' },
  { bg: '#047857', fg: '#ffffff' },
  { bg: '#b45309', fg: '#ffffff' },
  { bg: '#c2410c', fg: '#ffffff' },
  { bg: '#be123c', fg: '#ffffff' },
  { bg: '#a21caf', fg: '#ffffff' },
  { bg: '#0e7490', fg: '#ffffff' },
  { bg: '#4338ca', fg: '#ffffff' },
  { bg: '#7c3aed', fg: '#ffffff' },
];

function hashStringForInitialsAvatar(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (Math.imul(31, h) + key.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function getInitialsAvatarStyle(stableKey: string): CSSProperties {
  const idx = hashStringForInitialsAvatar(stableKey) % INITIALS_AVATAR_PALETTE.length;
  const { bg, fg } = INITIALS_AVATAR_PALETTE[idx];
  return { backgroundColor: bg, color: fg };
}

function InitialsAvatar({
  initials,
  stableKey,
  className = '',
  roundedFull = false,
  roundedClass = 'rounded-xl',
}: {
  initials: string;
  stableKey: string;
  className?: string;
  roundedFull?: boolean;
  roundedClass?: string;
}) {
  const style = useMemo(() => getInitialsAvatarStyle(stableKey), [stableKey]);
  return (
    <div
      className={[
        'relative z-10 flex shrink-0 items-center justify-center overflow-hidden font-bold tracking-tight shadow-sm',
        roundedFull ? 'rounded-full' : roundedClass,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      style={style}
    >
      {initials}
    </div>
  );
}

/** Image when URL is set, otherwise colored initials (list rows, etc.) */
function EntityAvatar({
  name,
  imageUrl,
  stableKey,
  className = 'h-9 w-9 text-xs rounded-lg',
  roundedFull = false,
}: {
  name?: string | null;
  imageUrl?: string | null;
  stableKey: string;
  className?: string;
  roundedFull?: boolean;
}) {
  const [imgBroken, setImgBroken] = useState(false);
  const resolvedUrl = imageUrl?.trim() || '';
  const showImage = Boolean(resolvedUrl) && !imgBroken;
  const radiusClass = roundedFull ? 'rounded-full' : 'rounded-lg';

  useEffect(() => {
    setImgBroken(false);
  }, [resolvedUrl]);

  if (showImage) {
    return (
      <div
        className={[
          'relative z-10 shrink-0 overflow-hidden border border-base-content/10 shadow-sm',
          radiusClass,
          className,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <img
          src={resolvedUrl}
          alt=""
          className="h-full w-full object-cover"
          draggable={false}
          onError={() => setImgBroken(true)}
        />
      </div>
    );
  }

  return (
    <InitialsAvatar
      initials={initialsFromName(name)}
      stableKey={stableKey}
      roundedFull={roundedFull}
      roundedClass={roundedFull ? 'rounded-full' : 'rounded-lg'}
      className={className}
    />
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ProfileAvatar({
  name,
  imageUrl,
  size = 'md',
  borderless = false,
  roundedFull = false,
  colorKey,
}: {
  name?: string | null;
  imageUrl?: string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'report';
  /** Omit grey ring (e.g. firm contacts table) */
  borderless?: boolean;
  /** Circular crop (e.g. contact photos) */
  roundedFull?: boolean;
  /** Stable key for initials colour (defaults to name) */
  colorKey?: string;
}) {
  const initials = initialsFromName(name);
  const stableKey = (colorKey || name || '').trim() || 'unknown';
  const sizeClass =
    size === 'sm'
      ? 'h-8 w-8 text-xs'
      : size === 'lg'
        ? 'h-16 w-16 text-lg'
        : size === 'xl'
          ? 'h-24 w-24 text-2xl'
          : size === 'report'
            ? 'h-12 w-12 text-sm'
            : 'h-11 w-11 text-sm';
  const radiusClass = roundedFull ? 'rounded-full' : 'rounded-xl';
  const borderClass = borderless
    ? 'ring-2 ring-white'
    : 'border-2 border-white shadow-md';

  if (!imageUrl) {
    return (
      <InitialsAvatar
        initials={initials}
        stableKey={stableKey}
        roundedFull={roundedFull}
        className={[sizeClass, borderClass].filter(Boolean).join(' ')}
      />
    );
  }

  return (
    <div
      className={['relative z-10 shrink-0 overflow-hidden bg-base-200', sizeClass, radiusClass, borderClass]
        .filter(Boolean)
        .join(' ')}
    >
      <img
        src={imageUrl}
        alt=""
        className="h-full w-full object-cover border-0 outline-none ring-0"
        draggable={false}
      />
    </div>
  );
}

function avatarSizeClasses(size: 'sm' | 'md' | 'lg' | 'xl' | 'report') {
  if (size === 'sm') return 'h-8 w-8 text-xs';
  if (size === 'lg') return 'h-16 w-16 text-lg';
  if (size === 'xl') return 'h-24 w-24 text-2xl';
  if (size === 'report') return 'h-12 w-12 text-sm';
  return 'h-11 w-11 text-sm';
}

/** Hover overlay to upload / change / remove profile image */
function EditableProfileAvatar({
  name,
  imageUrl,
  stableKey,
  size = 'xl',
  roundedFull = true,
  wrapperClassName = '',
  className = '',
  editable = false,
  uploading = false,
  onUpload,
  onRemove,
}: {
  name?: string | null;
  imageUrl?: string | null;
  stableKey: string;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'report';
  roundedFull?: boolean;
  /** Positioning (e.g. negative margin over cover) */
  wrapperClassName?: string;
  /** Extra classes on the avatar circle (size overrides) */
  className?: string;
  editable?: boolean;
  uploading?: boolean;
  onUpload?: (file: File) => void | Promise<void>;
  onRemove?: () => void | Promise<void>;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imgBroken, setImgBroken] = useState(false);
  const initials = initialsFromName(name);
  const resolvedUrl = imageUrl?.trim() || '';
  const showImage = Boolean(resolvedUrl) && !imgBroken;

  useEffect(() => {
    setImgBroken(false);
  }, [resolvedUrl]);

  const sizeClass = avatarSizeClasses(size);
  const radiusClass = roundedFull ? 'rounded-full' : 'rounded-xl';

  return (
    <div className={['group/avatar relative shrink-0', wrapperClassName].filter(Boolean).join(' ')}>
      <div
        className={[
          'relative z-10 overflow-hidden font-bold tracking-tight shadow-md ring-4 ring-white',
          sizeClass,
          radiusClass,
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        style={showImage ? undefined : getInitialsAvatarStyle(stableKey)}
      >
        {showImage ? (
          <img
            src={resolvedUrl}
            alt=""
            className="h-full w-full object-cover"
            draggable={false}
            onError={() => setImgBroken(true)}
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center">{initials}</span>
        )}

        {editable && (
          <>
            <button
              type="button"
              className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-1 rounded-[inherit] bg-black/55 opacity-0 transition-opacity group-hover/avatar:opacity-100 focus-visible:opacity-100"
              onClick={() => !uploading && fileInputRef.current?.click()}
              disabled={uploading}
              title={showImage ? 'Change profile image' : 'Upload profile image'}
            >
              {uploading ? (
                <span className="loading loading-spinner loading-sm text-white" />
              ) : (
                <>
                  <CameraIcon className="h-5 w-5 text-white md:h-6 md:w-6" />
                  <span className="px-1 text-center text-[10px] font-semibold leading-tight text-white md:text-[11px]">
                    {showImage ? 'Change' : 'Add photo'}
                  </span>
                </>
              )}
            </button>
            {showImage && !uploading && onRemove && (
              <button
                type="button"
                className="absolute right-0.5 top-0.5 z-30 flex h-6 w-6 items-center justify-center rounded-full border border-white/40 bg-base-100/95 text-error opacity-0 shadow-sm transition-opacity group-hover/avatar:opacity-100 hover:bg-error/10 focus-visible:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  void onRemove();
                }}
                title="Remove profile image"
              >
                <TrashIcon className="h-3.5 w-3.5" />
              </button>
            )}
          </>
        )}
      </div>

      {editable && (
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file || !onUpload) return;
            void onUpload(file);
          }}
        />
      )}
    </div>
  );
}

/** Skeleton loading rows for the firms table (card rows on grey shell) */
function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="-mx-4 overflow-x-auto md:mx-0 py-2 space-y-2.5">
      <div className="grid grid-cols-5 gap-4 px-5 py-2">
        {['Firm', 'Type', 'VAT', 'Website', 'Contacts'].map((h) => (
          <div key={h} className="h-3 w-20 animate-pulse rounded-full bg-gray-300/80" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="grid grid-cols-5 gap-4 rounded-[18px] bg-white px-5 py-3.5 shadow-sm"
        >
          <div className="flex items-center gap-2.5">
            <div className="h-7 w-7 animate-pulse rounded-lg bg-gray-200" />
            <div className="h-3 w-28 animate-pulse rounded-full bg-gray-200" />
          </div>
          <div className="h-3 w-20 animate-pulse rounded-full bg-gray-200 self-center" />
          <div className="h-3 w-16 animate-pulse rounded-full bg-gray-200 self-center" />
          <div className="h-3 w-24 animate-pulse rounded-full bg-gray-200 self-center" />
          <div className="h-5 w-10 animate-pulse rounded-full bg-gray-200 self-center ml-auto" />
        </div>
      ))}
    </div>
  );
}

const STATUS_BADGE_ACTIVE = 'shrink-0 rounded-md bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800';
const STATUS_BADGE_INACTIVE = 'shrink-0 rounded-md bg-red-100 px-2.5 py-1 text-xs font-medium text-red-800';
const STATUS_BADGE_OWNER = 'shrink-0 rounded-md bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-900';
const STATUS_BADGE_OWNER_OFF =
  'shrink-0 rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500';
const STATUS_BADGE_LINKED = 'shrink-0 rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700';

function contactIsActive(contact: { is_active?: boolean | null }): boolean {
  return contact.is_active !== false;
}

/** Curated professional business covers (Unsplash) — stable pick per entity */
const PROFESSIONAL_BUSINESS_COVER_IMAGES = [
  'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1280&h=288&q=80',
  'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1280&h=288&q=80',
  'https://images.unsplash.com/photo-1497366819453-4cb645cadcb8?auto=format&fit=crop&w=1280&h=288&q=80',
  'https://images.unsplash.com/photo-1521737716868-75817dad165a?auto=format&fit=crop&w=1280&h=288&q=80',
  'https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=1280&h=288&q=80',
  'https://images.unsplash.com/photo-1556761175-5973dc0f32e8?auto=format&fit=crop&w=1280&h=288&q=80',
  'https://images.unsplash.com/photo-1560179707-f14e90ef1873?auto=format&fit=crop&w=1280&h=288&q=80',
  'https://images.unsplash.com/photo-1574621103361-9039a948d4cc?auto=format&fit=crop&w=1280&h=288&q=80',
  'https://images.unsplash.com/photo-1600880292203-757bb62b4baf?auto=format&fit=crop&w=1280&h=288&q=80',
  'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?auto=format&fit=crop&w=1280&h=288&q=80',
  'https://images.unsplash.com/photo-1507679799987-c73bd070dc85?auto=format&fit=crop&w=1280&h=288&q=80',
  'https://images.unsplash.com/photo-1542744173-8e7e53409bb9?auto=format&fit=crop&w=1280&h=288&q=80',
  'https://images.unsplash.com/photo-1497215728419-15627b4c46ea?auto=format&fit=crop&w=1280&h=288&q=80',
  'https://images.unsplash.com/photo-1460925895917-afeafcdc6d6d?auto=format&fit=crop&w=1280&h=288&q=80',
  'https://images.unsplash.com/photo-1553877522-43269d4ea984?auto=format&fit=crop&w=1280&h=288&q=80',
  'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=1280&h=288&q=80',
] as const;

const PROFILE_COVER_GRADIENTS = [
  'from-slate-600 via-slate-700 to-slate-800',
  'from-sky-700 via-blue-800 to-indigo-900',
  'from-teal-700 via-cyan-800 to-blue-900',
  'from-indigo-700 via-blue-800 to-slate-900',
  'from-zinc-600 via-slate-700 to-gray-800',
  'from-blue-700 via-indigo-800 to-violet-900',
] as const;

function hashStringForProfileCover(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (Math.imul(31, h) + key.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function getProfileCoverMeta(coverKey: string) {
  const idx = hashStringForProfileCover(coverKey);
  return {
    imageUrl: PROFESSIONAL_BUSINESS_COVER_IMAGES[idx % PROFESSIONAL_BUSINESS_COVER_IMAGES.length],
    gradient: PROFILE_COVER_GRADIENTS[idx % PROFILE_COVER_GRADIENTS.length],
  };
}

/** LinkedIn-style cover strip — custom URL or stable default per cover key */
function EditableProfileCover({
  coverKey,
  customImageUrl,
  editable = false,
  uploading = false,
  onUpload,
  onRemove,
}: {
  coverKey: string;
  customImageUrl?: string | null;
  editable?: boolean;
  uploading?: boolean;
  onUpload?: (file: File) => void | Promise<void>;
  onRemove?: () => void | Promise<void>;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fallback = useMemo(() => getProfileCoverMeta(coverKey), [coverKey]);
  const [customBroken, setCustomBroken] = useState(false);
  const [fallbackBroken, setFallbackBroken] = useState(false);
  const customUrl = customImageUrl?.trim() || '';
  const useCustom = Boolean(customUrl) && !customBroken;
  const displayUrl = useCustom ? customUrl : fallbackBroken ? '' : fallback.imageUrl;

  useEffect(() => {
    setCustomBroken(false);
  }, [customUrl]);

  useEffect(() => {
    setFallbackBroken(false);
  }, [fallback.imageUrl]);

  const hasCustomCover = Boolean(customUrl) && !customBroken;

  return (
    <div className={`group/cover relative h-28 md:h-36 w-full bg-gradient-to-r ${fallback.gradient}`}>
      {displayUrl ? (
        <img
          src={displayUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
          decoding="async"
          onError={() => {
            if (useCustom) setCustomBroken(true);
            else setFallbackBroken(true);
          }}
        />
      ) : null}
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-slate-900/25 via-transparent to-slate-900/35"
        aria-hidden
      />

      {editable && (
        <>
          <button
            type="button"
            className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-1.5 bg-black/45 opacity-0 transition-opacity group-hover/cover:opacity-100 focus-visible:opacity-100"
            onClick={() => !uploading && fileInputRef.current?.click()}
            disabled={uploading}
            title={hasCustomCover ? 'Change cover image' : 'Upload cover image'}
          >
            {uploading ? (
              <span className="loading loading-spinner loading-md text-white" />
            ) : (
              <>
                <CameraIcon className="h-7 w-7 text-white" />
                <span className="text-xs font-semibold text-white">
                  {hasCustomCover ? 'Change cover' : 'Add cover photo'}
                </span>
              </>
            )}
          </button>
          {hasCustomCover && !uploading && onRemove && (
            <button
              type="button"
              className="absolute right-3 top-3 z-30 flex items-center gap-1 rounded-lg border border-white/30 bg-black/50 px-2.5 py-1 text-xs font-semibold text-white opacity-0 transition-opacity group-hover/cover:opacity-100 hover:bg-black/65 focus-visible:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                void onRemove();
              }}
              title="Remove custom cover (use default)"
            >
              <TrashIcon className="h-3.5 w-3.5" />
              Remove
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file || !onUpload) return;
              void onUpload(file);
            }}
          />
        </>
      )}
    </div>
  );
}

/** Contact header uses the parent firm's cover (custom URL or firm default stock image). */
function ContactProfileCover({
  firmId,
  firmName,
  firmCoverImageUrl,
}: {
  firmId: string;
  firmName?: string | null;
  firmCoverImageUrl?: string | null;
}) {
  const coverKey = useMemo(
    () => `firm::${firmId}::${(firmName || '').trim()}`,
    [firmId, firmName],
  );
  return (
    <EditableProfileCover coverKey={coverKey} customImageUrl={firmCoverImageUrl} editable={false} />
  );
}

function ContactStatusToggleRow({
  label,
  pressed,
  pressedClass,
  unpressedClass,
  toggleClass,
  disabled,
  onToggle,
}: {
  label: string;
  pressed: boolean;
  pressedClass: string;
  unpressedClass: string;
  toggleClass: string;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className="inline-flex items-center gap-2 shrink-0"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <span className={pressed ? pressedClass : unpressedClass}>{label}</span>
      <input
        type="checkbox"
        className={`toggle toggle-sm ${toggleClass}`}
        checked={pressed}
        disabled={disabled}
        onChange={() => onToggle()}
        aria-label={`Toggle ${label}`}
      />
    </div>
  );
}

/** Reusable section header — Stripe-style label */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-widest text-base-content/40">
      {children}
    </div>
  );
}

const NOTES_URL_SPLIT_RE = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi;

function notesSegmentIsUrl(segment: string): boolean {
  return /^https?:\/\//i.test(segment) || /^www\./i.test(segment);
}

/** Notes text with URLs shown as clickable "Link" labels */
function renderNotesWithLinks(text: string): React.ReactNode {
  const parts = text.split(NOTES_URL_SPLIT_RE);
  return parts.map((part, i) => {
    if (!part) return null;
    if (notesSegmentIsUrl(part)) {
      const href = /^https?:\/\//i.test(part) ? part : `https://${part}`;
      return (
        <a
          key={`link-${i}`}
          href={href}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-primary hover:underline"
        >
          Link
        </a>
      );
    }
    return <React.Fragment key={`text-${i}`}>{part}</React.Fragment>;
  });
}

/** Reusable detail field block */
function DetailField({ label, value, mono = false }: { label: string; value?: React.ReactNode; mono?: boolean }) {
  return (
    <div className="space-y-1">
      <SectionLabel>{label}</SectionLabel>
      <div className={`text-sm text-base-content/90 ${mono ? 'font-mono text-xs' : 'font-medium'}`}>
        {value || '—'}
      </div>
    </div>
  );
}

/** Empty state with icon + message */
function EmptyState({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-base-300 bg-base-100 py-16 text-center">
      <BuildingOffice2Icon className="h-10 w-10 text-base-content/20" />
      <div>
        <div className="text-sm font-semibold text-base-content/60">{title}</div>
        {subtitle && <div className="mt-0.5 text-xs text-base-content/40">{subtitle}</div>}
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Breadcrumb navigation */
function Breadcrumb({
  items,
  variant = 'default',
}: {
  items: { label: string; onClick?: () => void }[];
  variant?: 'default' | 'header';
}) {
  const isHeader = variant === 'header';
  const navCls = isHeader
    ? 'flex flex-wrap items-center justify-center gap-1.5 tracking-tight'
    : 'flex items-center gap-1 text-sm';
  const sepCls = (i: number) =>
    isHeader
      ? i === 1
        ? 'h-4 w-4 shrink-0 text-base-content/35'
        : 'h-5 w-5 shrink-0 text-base-content/35'
      : 'h-3.5 w-3.5 shrink-0 text-base-content/30';
  const lastMaxW = isHeader ? 'max-w-[min(28rem,70vw)]' : 'max-w-[16rem]';
  const linkMaxW = isHeader ? 'max-w-[min(18rem,50vw)]' : 'max-w-[12rem]';

  const headerSegmentCls = (index: number) =>
    index === 0
      ? 'text-xl md:text-2xl font-bold text-base-content/95'
      : 'text-sm md:text-base font-semibold text-base-content/75';

  return (
    <nav className={navCls}>
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        const headerText = isHeader ? headerSegmentCls(i) : '';
        return (
          <React.Fragment key={i}>
            {i > 0 && <ChevronRightIcon className={sepCls(i)} />}
            {isLast ? (
              <span
                className={`truncate ${lastMaxW} ${headerText} ${
                  !isHeader ? 'font-semibold text-base-content/90' : ''
                }`}
              >
                {item.label}
              </span>
            ) : (
              <button
                type="button"
                onClick={item.onClick}
                disabled={!item.onClick}
                className={`truncate transition-colors duration-150 ${linkMaxW} ${headerText} ${
                  item.onClick
                    ? isHeader
                      ? i === 0
                        ? 'text-base-content/55 hover:text-base-content/90'
                        : 'text-base-content/60 hover:text-base-content/90'
                      : 'text-base-content/50 hover:text-base-content/80'
                    : !isHeader
                      ? 'font-semibold text-base-content/90 cursor-default'
                      : 'cursor-default'
                }`}
              >
                {item.label}
              </button>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Main page
// ═══════════════════════════════════════════════════════════════════════════════

export default function ExternalFirmsReportPage() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [firms, setFirms] = useState<FirmRow[]>([]);
  const [query, setQuery] = useState('');
  
  // Sorting & Filtering
  const [sortKey, setSortKey] = useState<'name' | 'type' | 'contacts'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  
  const handleSort = (key: 'name' | 'type' | 'contacts') => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const [selectedFirmId, setSelectedFirmId] = useState<string | null>(null);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
  
  // Editing state
  const [editingFirm, setEditingFirm] = useState<FirmRow | null>(null);
  const [editingContact, setEditingContact] = useState<FirmContactRow | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  /** management cost modal (includes invoice + payment / tax documents) */
  const [costModalFirmId, setCostModalFirmId] = useState<string | null>(null);
  const [costModalEditingId, setCostModalEditingId] = useState<string | null>(null);
  const [costModalInvoiceEditingId, setCostModalInvoiceEditingId] = useState<string | null>(null);
  const [costForm, setCostForm] = useState({ month: '', amount: '', notes: '', expense_type_id: '' });
  const [expenseTypes, setExpenseTypes] = useState<ExpenseTypeRow[]>([]);
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [paymentConfirmationFile, setPaymentConfirmationFile] = useState<File | null>(null);
  const [taxReceiptFile, setTaxReceiptFile] = useState<File | null>(null);
  const [costModalUploading, setCostModalUploading] = useState(false);
  const [documentPreviewOpen, setDocumentPreviewOpen] = useState(false);
  const [documentPreviewItems, setDocumentPreviewItems] = useState<DocumentPreviewItem[]>([]);

  // Phase 3 State
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [activeLogs, setActiveLogs] = useState<ActivityLog[]>([]);
  const [togglingContactKey, setTogglingContactKey] = useState<string | null>(null);
  const [profileImageUploadKey, setProfileImageUploadKey] = useState<string | null>(null);
  const [missingDataModalOpen, setMissingDataModalOpen] = useState(false);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);

  const [externSourceNameById, setExternSourceNameById] = useState<Record<string, string>>({});
  const [sourcesById, setSourcesById] = useState<Record<string, SourceMeta>>({});
  const [channelsById, setChannelsById] = useState<Record<string, ChannelRow>>({});

  useEffect(() => {
    void fetchActiveExpenseTypes()
      .then(setExpenseTypes)
      .catch((err) => console.error('Failed to load expense types:', err));
  }, []);

  const fetchData = async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      const { data, error } = await supabase
        .from('firms')
        .select(
          `
          id,
          name,
          firm_type_id,
          legal_name,
          vat_number,
          website,
          address,
          contract,
          invoices,
          other_docs,
          notes,
          profile_image_url,
          cover_image_url,
          is_active,
          created_at,
          updated_at,
          firm_types:firm_type_id(id, code, label),
          firm_contacts(
            id,
            firm_id,
            name,
            email,
            second_email,
            phone,
            user_email,
            user_id,
            firm_owner,
            is_active,
            notes,
            profile_image_url,
            created_at,
            updated_at,
            users:user_id(*)
          ),
          firm_management_costs(
            id,
            firm_id,
            billing_month,
            amount,
            currency,
            notes,
            payment_confirmation,
            tax_receipt,
            expense_type_id,
            expense_types ( label ),
            created_at,
            updated_at
          ),
          firm_invoices(
            id,
            firm_id,
            invoice_month,
            amount,
            currency,
            notes,
            storage_path,
            file_name,
            mime_type,
            created_at,
            updated_at
          )
        `,
        )
        .order('name', { ascending: true });

      if (error) throw error;
      const nextFirms = (data as any as FirmRow[]) || [];
      setFirms(nextFirms);

      const sourceIds = Array.from(
        new Set(
          nextFirms
            .flatMap((f) => f.firm_contacts || [])
            .flatMap((c) => parseExternSourceIds((c as any).users?.extern_source_id)),
        ),
      );

      if (sourceIds.length > 0) {
        const { data: sourcesData, error: sourcesErr } = await supabase
          .from('misc_leadsource')
          .select('id, name, channel_id')
          .in('id', sourceIds as any);
        if (!sourcesErr && sourcesData) {
          const nameMap: Record<string, string> = {};
          const metaMap: Record<string, SourceMeta> = {};
          const channelUuids = new Set<string>();
          sourcesData.forEach((row: any) => {
            if (row?.id != null) {
              const sid = String(row.id);
              nameMap[sid] = String(row.name || row.id);
              metaMap[sid] = { id: sid, name: String(row.name || row.id), channel_id: row.channel_id ?? null };
              if (row.channel_id) channelUuids.add(row.channel_id);
            }
          });
          setExternSourceNameById(nameMap);
          setSourcesById(metaMap);

          // Fetch channel labels
          if (channelUuids.size > 0) {
            const { data: chData, error: chErr } = await supabase
              .from('channels')
              .select('id, code, label, is_active')
              .in('id', Array.from(channelUuids));
            if (!chErr && chData) {
              const chMap: Record<string, ChannelRow> = {};
              chData.forEach((ch: any) => { if (ch?.id) chMap[ch.id] = ch as ChannelRow; });
              setChannelsById(chMap);
            }
          }
        }
      }
    } catch (err: any) {
      console.error(err);
    } finally {
      if (isRefresh) setRefreshing(false);
      else setLoading(false);
    }
  };

  const fetchSavedViews = async () => {
    try {
      const { data, error } = await supabase
        .from('user_saved_views')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setSavedViews(data || []);
    } catch (err) {
      console.error('Error fetching views:', err);
    }
  };

  const fetchActivityLogs = async (firmId: string) => {
    setIsLoadingLogs(true);
    try {
      const { data, error } = await supabase
        .from('firm_activity_log')
        .select('*')
        .eq('firm_id', firmId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setActiveLogs(data || []);
    } catch (err) {
      console.error('Error fetching logs:', err);
    } finally {
      setIsLoadingLogs(false);
    }
  };

  const logActivity = async (payload: Omit<ActivityLog, 'id' | 'created_at'>) => {
    try {
      await supabase.from('firm_activity_log').insert([payload]);
    } catch (err) {
      console.error('Failed to log activity:', err);
    }
  };

  useEffect(() => {
    fetchData();
    fetchSavedViews();
  }, []);

  useEffect(() => {
    if (selectedFirmId) {
      fetchActivityLogs(selectedFirmId);
    }
  }, [selectedFirmId]);

  const availableTypes = useMemo(() => {
    const typesMap = new Map<string, string>();
    firms.forEach(f => {
      if (f.firm_types?.id) typesMap.set(f.firm_types.id, f.firm_types.label || 'Unknown');
    });
    return Array.from(typesMap.entries()).map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [firms]);

  const filtered = useMemo(() => {
    let result = firms;

    // Apply Faceted Filters
    if (statusFilter !== 'all') {
      const wantActive = statusFilter === 'active';
      result = result.filter(f => f.is_active === wantActive);
    }
    if (typeFilter !== 'all') {
      result = result.filter(f => f.firm_types?.id === typeFilter);
    }

    // Apply Search Query
    const q = query.trim().toLowerCase();
    if (q) {
      result = result.filter((f) => {
        const inFirm =
          f.name?.toLowerCase().includes(q) ||
          (f.legal_name || '').toLowerCase().includes(q) ||
          (f.vat_number || '').toLowerCase().includes(q) ||
          (f.website || '').toLowerCase().includes(q);
        if (inFirm) return true;
        return (f.firm_contacts || []).some((c) => {
          const u = (c as any).users as UserRow | null | undefined;
          return (
            (c.name || '').toLowerCase().includes(q) ||
            (c.email || '').toLowerCase().includes(q) ||
            (c.second_email || '').toLowerCase().includes(q) ||
            (c.phone || '').toLowerCase().includes(q) ||
            (c.user_email || '').toLowerCase().includes(q) ||
            (u?.email || '').toLowerCase().includes(q) ||
            (u?.auth_id || '').toLowerCase().includes(q)
          );
        });
      });
    }

    // Apply Sorting
    return [...result].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'name') {
        cmp = (a.name || '').localeCompare(b.name || '');
      } else if (sortKey === 'type') {
        const typeA = a.firm_types?.label || '';
        const typeB = b.firm_types?.label || '';
        cmp = typeA.localeCompare(typeB);
      } else if (sortKey === 'contacts') {
        const countA = a.firm_contacts?.length || 0;
        const countB = b.firm_contacts?.length || 0;
        cmp = countA - countB;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [firms, query, statusFilter, typeFilter, sortKey, sortDir]);

  const missingDataRows = useMemo(() => collectMissingDataRows(filtered), [filtered]);

  const stats = useMemo(() => {
    const firmsCount = filtered.length;
    const contactsCount = filtered.reduce((sum, f) => sum + (f.firm_contacts?.length || 0), 0);
    const usersCount = filtered.reduce((sum, f) => {
      const uniq = new Set<string>();
      (f.firm_contacts || []).forEach((c) => {
        const u = (c as any).users as UserRow | null | undefined;
        if (u?.id != null) uniq.add(String(u.id));
      });
      return sum + uniq.size;
    }, 0);
    const firmsWithoutContacts = filtered.filter(f => (f.firm_contacts?.length || 0) === 0).length;
    const inactiveFirms = filtered.filter(f => f.is_active === false).length;
    const missingDataCount = missingDataRows.length;
    return { firmsCount, contactsCount, usersCount, firmsWithoutContacts, inactiveFirms, missingDataCount };
  }, [filtered, missingDataRows]);

  const selectedFirm = useMemo(
    () => (selectedFirmId ? firms.find((f) => f.id === selectedFirmId) || null : null),
    [firms, selectedFirmId],
  );

  const selectedContact = useMemo(() => {
    if (!selectedFirm || !selectedContactId) return null;
    return (selectedFirm.firm_contacts || []).find((c) => c.id === selectedContactId) || null;
  }, [selectedFirm, selectedContactId]);

  const handleUpdateFirm = async (formData: Partial<FirmRow>) => {
    if (!editingFirm) return;
    setIsUpdating(true);
    try {
      const { error } = await supabase
        .from('firms')
        .update(formData)
        .eq('id', editingFirm.id);

      if (error) throw error;

      // Optimistic Update
      setFirms(prev => prev.map(f => f.id === editingFirm.id ? { ...f, ...formData } : f));
      toast.success('Firm updated successfully');
      setEditingFirm(null);

      // Log Activity
      logActivity({
        firm_id: editingFirm.id,
        contact_id: null,
        action_type: 'UPDATE_FIRM',
        description: `Modified firm details via slide-over.`
      });
      fetchActivityLogs(editingFirm.id);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Failed to update firm');
    } finally {
      setIsUpdating(false);
    }
  };

  const patchContactToggle = async (
    contact: FirmContactRow,
    field: 'is_active' | 'firm_owner',
    nextValue: boolean,
  ) => {
    const toggleKey = `${contact.id}:${field}`;
    setTogglingContactKey(toggleKey);
    try {
      const { error } = await supabase
        .from('firm_contacts')
        .update({ [field]: nextValue })
        .eq('id', contact.id);

      if (error) throw error;

      setFirms((prev) =>
        prev.map((f) => {
          if (f.id !== contact.firm_id) return f;
          return {
            ...f,
            firm_contacts: (f.firm_contacts || []).map((c) =>
              c.id === contact.id ? { ...c, [field]: nextValue } : c,
            ),
          };
        }),
      );

      const contactName = contact.name || 'Contact';
      if (field === 'is_active') {
        void logActivity({
          firm_id: contact.firm_id,
          contact_id: contact.id,
          action_type: 'UPDATE_CONTACT',
          description: `Set ${contactName} ${nextValue ? 'active' : 'inactive'}.`,
        });
        toast.success(nextValue ? `${contactName} marked active` : `${contactName} marked inactive`);
      } else {
        void logActivity({
          firm_id: contact.firm_id,
          contact_id: contact.id,
          action_type: 'UPDATE_CONTACT',
          description: `Set ${contactName} ${nextValue ? 'as firm owner' : 'not firm owner'}.`,
        });
        toast.success(nextValue ? `${contactName} set as owner` : `${contactName} removed as owner`);
      }

      if (selectedFirmId) void fetchActivityLogs(selectedFirmId);
    } catch (err: unknown) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Failed to update contact');
    } finally {
      setTogglingContactKey(null);
    }
  };

  const patchFirmProfileImageUrl = useCallback(async (firmId: string, url: string | null) => {
    const { error } = await supabase.from('firms').update({ profile_image_url: url }).eq('id', firmId);
    if (error) throw error;
    setFirms((prev) =>
      prev.map((f) => (f.id === firmId ? { ...f, profile_image_url: url } : f)),
    );
  }, []);

  const patchFirmCoverImageUrl = useCallback(async (firmId: string, url: string | null) => {
    const { error } = await supabase.from('firms').update({ cover_image_url: url }).eq('id', firmId);
    if (error) throw error;
    setFirms((prev) =>
      prev.map((f) => (f.id === firmId ? { ...f, cover_image_url: url } : f)),
    );
  }, []);

  const patchContactProfileImageUrl = useCallback(
    async (contact: FirmContactRow, url: string | null) => {
      const { error } = await supabase
        .from('firm_contacts')
        .update({ profile_image_url: url })
        .eq('id', contact.id);
      if (error) throw error;
      setFirms((prev) =>
        prev.map((f) => {
          if (f.id !== contact.firm_id) return f;
          return {
            ...f,
            firm_contacts: (f.firm_contacts || []).map((c) =>
              c.id === contact.id ? { ...c, profile_image_url: url } : c,
            ),
          };
        }),
      );
    },
    [],
  );

  const handleFirmProfileImageUpload = async (firm: FirmRow, file: File) => {
    const key = `firm:${firm.id}`;
    setProfileImageUploadKey(key);
    try {
      const prevUrl = firm.profile_image_url?.trim() || null;
      const nextUrl = await uploadFirmProfileImage(firm.id, file);
      await patchFirmProfileImageUrl(firm.id, nextUrl);
      if (prevUrl && extractFirmProfileImageObjectPath(prevUrl)) {
        await removeFirmProfileImageFromStorage(prevUrl).catch(() => undefined);
      }
      void logActivity({
        firm_id: firm.id,
        contact_id: null,
        action_type: 'UPDATE_FIRM',
        description: `Updated profile image for ${firm.name}.`,
      });
      toast.success('Firm profile image saved');
    } catch (err: unknown) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Failed to upload firm image');
    } finally {
      setProfileImageUploadKey(null);
    }
  };

  const handleFirmProfileImageRemove = async (firm: FirmRow) => {
    const key = `firm:${firm.id}`;
    setProfileImageUploadKey(key);
    try {
      await removeFirmProfileImageFromStorage(firm.profile_image_url);
      await patchFirmProfileImageUrl(firm.id, null);
      void logActivity({
        firm_id: firm.id,
        contact_id: null,
        action_type: 'UPDATE_FIRM',
        description: `Removed profile image for ${firm.name}.`,
      });
      toast.success('Firm profile image removed');
    } catch (err: unknown) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Failed to remove firm image');
    } finally {
      setProfileImageUploadKey(null);
    }
  };

  const handleFirmCoverImageUpload = async (firm: FirmRow, file: File) => {
    const key = `firm-cover:${firm.id}`;
    setProfileImageUploadKey(key);
    try {
      const prevUrl = firm.cover_image_url?.trim() || null;
      const nextUrl = await uploadFirmCoverImage(firm.id, file);
      await patchFirmCoverImageUrl(firm.id, nextUrl);
      if (prevUrl && extractFirmProfileImageObjectPath(prevUrl)) {
        await removeFirmProfileImageFromStorage(prevUrl).catch(() => undefined);
      }
      void logActivity({
        firm_id: firm.id,
        contact_id: null,
        action_type: 'UPDATE_FIRM',
        description: `Updated cover image for ${firm.name}.`,
      });
      toast.success('Firm cover image saved');
    } catch (err: unknown) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Failed to upload cover image');
    } finally {
      setProfileImageUploadKey(null);
    }
  };

  const handleFirmCoverImageRemove = async (firm: FirmRow) => {
    const key = `firm-cover:${firm.id}`;
    setProfileImageUploadKey(key);
    try {
      await removeFirmProfileImageFromStorage(firm.cover_image_url);
      await patchFirmCoverImageUrl(firm.id, null);
      void logActivity({
        firm_id: firm.id,
        contact_id: null,
        action_type: 'UPDATE_FIRM',
        description: `Removed custom cover image for ${firm.name}.`,
      });
      toast.success('Cover reset to default');
    } catch (err: unknown) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Failed to remove cover image');
    } finally {
      setProfileImageUploadKey(null);
    }
  };

  const handleContactProfileImageUpload = async (contact: FirmContactRow, file: File) => {
    const key = `contact:${contact.id}`;
    setProfileImageUploadKey(key);
    try {
      const prevUrl = contact.profile_image_url?.trim() || null;
      const nextUrl = await uploadContactProfileImage(contact.id, file);
      await patchContactProfileImageUrl(contact, nextUrl);
      if (prevUrl && extractFirmProfileImageObjectPath(prevUrl)) {
        await removeFirmProfileImageFromStorage(prevUrl).catch(() => undefined);
      }
      void logActivity({
        firm_id: contact.firm_id,
        contact_id: contact.id,
        action_type: 'UPDATE_CONTACT',
        description: `Updated profile image for ${contact.name || 'contact'}.`,
      });
      toast.success('Contact profile image saved');
    } catch (err: unknown) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Failed to upload contact image');
    } finally {
      setProfileImageUploadKey(null);
    }
  };

  const handleContactProfileImageRemove = async (contact: FirmContactRow) => {
    const key = `contact:${contact.id}`;
    setProfileImageUploadKey(key);
    try {
      await removeFirmProfileImageFromStorage(contact.profile_image_url);
      await patchContactProfileImageUrl(contact, null);
      void logActivity({
        firm_id: contact.firm_id,
        contact_id: contact.id,
        action_type: 'UPDATE_CONTACT',
        description: `Removed profile image for ${contact.name || 'contact'}.`,
      });
      toast.success('Contact profile image removed');
    } catch (err: unknown) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Failed to remove contact image');
    } finally {
      setProfileImageUploadKey(null);
    }
  };

  const handleUpdateContact = async (formData: Partial<FirmContactRow>) => {
    if (!editingContact) return;
    setIsUpdating(true);
    try {
      const { error } = await supabase
        .from('firm_contacts')
        .update(formData)
        .eq('id', editingContact.id);

      if (error) throw error;

      // Optimistic Update
      setFirms(prev => prev.map(f => {
        if (f.id !== editingContact.firm_id) return f;
        return {
          ...f,
          firm_contacts: (f.firm_contacts || []).map(c => c.id === editingContact.id ? { ...c, ...formData } : c)
        };
      }));
      
      toast.success('Contact updated successfully');
      setEditingContact(null);

      // Log Activity
      logActivity({
        firm_id: editingContact.firm_id,
        contact_id: editingContact.id,
        action_type: 'UPDATE_CONTACT',
        description: `Modified contact ${editingContact.name} via slide-over.`
      });
      if (selectedFirmId) fetchActivityLogs(selectedFirmId);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Failed to update contact');
    } finally {
      setIsUpdating(false);
    }
  };

  const mergeFirmChildRows = (
    firmId: string,
    patch: {
      firm_management_costs?: FirmManagementCostRow[];
      firm_invoices?: FirmInvoiceRow[];
    },
  ) => {
    setFirms((prev) =>
      prev.map((f) =>
        f.id === firmId
          ? {
              ...f,
              ...(patch.firm_management_costs != null ? { firm_management_costs: patch.firm_management_costs } : {}),
              ...(patch.firm_invoices != null ? { firm_invoices: patch.firm_invoices } : {}),
            }
          : f,
      ),
    );
  };

  const sortCostRows = (rows: FirmManagementCostRow[]) =>
    [...rows].sort((a, b) => String(b.billing_month).localeCompare(String(a.billing_month)));

  const sortInvoiceRows = (rows: FirmInvoiceRow[]) =>
    [...rows].sort((a, b) => String(b.invoice_month).localeCompare(String(a.invoice_month)));

  const resetCostModalFiles = () => {
    setInvoiceFile(null);
    setPaymentConfirmationFile(null);
    setTaxReceiptFile(null);
  };

  const closeCostModal = () => {
    setCostModalFirmId(null);
    setCostModalEditingId(null);
    setCostModalInvoiceEditingId(null);
    resetCostModalFiles();
    setCostModalUploading(false);
  };

  const openAddCost = (firmId: string) => {
    setCostModalEditingId(null);
    setCostModalInvoiceEditingId(null);
    resetCostModalFiles();
    const defaultTypeId = defaultMarketingExpenseTypeId(expenseTypes);
    setCostForm({
      month: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`,
      amount: '',
      notes: '',
      expense_type_id: defaultTypeId ?? '',
    });
    setCostModalFirmId(firmId);
  };

  const openEditMergedCost = (firmId: string, merged: MergedManagementCostRow) => {
    const { cost, invoice } = merged;
    setCostModalEditingId(cost?.id ?? null);
    setCostModalInvoiceEditingId(invoice?.id ?? null);
    resetCostModalFiles();
    setCostForm({
      month: isoFirstDayToMonthInput(cost?.billing_month ?? invoice?.invoice_month ?? merged.monthAnchor),
      amount:
        cost?.amount != null
          ? String(cost.amount)
          : invoice?.amount != null
            ? String(invoice.amount)
            : '',
      notes: (cost?.notes || invoice?.notes || '').trim(),
      expense_type_id: cost?.expense_type_id ?? defaultMarketingExpenseTypeId(expenseTypes) ?? '',
    });
    setCostModalFirmId(firmId);
  };

  const COST_ROW_SELECT =
    'id, firm_id, billing_month, amount, currency, notes, payment_confirmation, tax_receipt, expense_type_id, expense_types ( label ), created_at, updated_at';

  const INVOICE_ROW_SELECT =
    'id, firm_id, invoice_month, amount, currency, notes, storage_path, file_name, mime_type, created_at, updated_at';

  const submitCostModal = async () => {
    if (!costModalFirmId) return;
    const amt = parseAmount(costForm.amount);
    if (amt == null || amt < 0) {
      toast.error('Enter a valid amount.');
      return;
    }
    const billing_month = monthInputToIsoFirstDay(costForm.month);
    const notes = costForm.notes.trim() || null;
    const expense_type_id = costForm.expense_type_id.trim() || null;
    if (!expense_type_id) {
      toast.error('Select an expense type.');
      return;
    }
    const needsInvoiceRow = Boolean(invoiceFile || costModalInvoiceEditingId);

    setIsUpdating(true);
    setCostModalUploading(true);
    try {
      let costId = costModalEditingId;
      let costRow: FirmManagementCostRow | null = null;
      const firm = firms.find((f) => f.id === costModalFirmId);
      let costs = [...(firm?.firm_management_costs || [])];

      if (costId) {
        const { error } = await supabase
          .from('firm_management_costs')
          .update({
            billing_month,
            amount: amt,
            currency: FIRM_MONEY_CURRENCY,
            notes,
            expense_type_id,
          })
          .eq('id', costId);
        if (error) throw error;
        costs = sortCostRows(
          costs.map((r) =>
            r.id === costId
              ? {
                  ...r,
                  billing_month,
                  amount: amt,
                  currency: FIRM_MONEY_CURRENCY,
                  notes,
                  expense_type_id,
                  expense_types: {
                    label: expenseTypeLabel(expense_type_id, expenseTypes),
                  },
                }
              : r,
          ),
        );
        costRow = costs.find((r) => r.id === costId) ?? null;
        toast.success('Management cost updated');
      } else {
        const { data, error } = await supabase
          .from('firm_management_costs')
          .insert([
            {
              firm_id: costModalFirmId,
              billing_month,
              amount: amt,
              currency: FIRM_MONEY_CURRENCY,
              notes,
              expense_type_id,
            },
          ])
          .select(COST_ROW_SELECT)
          .single();
        if (error) throw error;
        costRow = data as FirmManagementCostRow;
        costId = costRow.id;
        costs = sortCostRows([...costs, costRow]);
        await logActivity({
          firm_id: costModalFirmId,
          contact_id: null,
          action_type: 'ADD_MANAGEMENT_COST',
          description: `Added management cost for ${formatMonthAnchor(billing_month)}.`,
        });
        toast.success('Management cost added');
      }

      if (costId && paymentConfirmationFile) {
        const path = await uploadFirmManagementCostDocument(
          costId,
          'payment_confirmation',
          paymentConfirmationFile,
        );
        costs = sortCostRows(
          costs.map((r) => (r.id === costId ? { ...r, payment_confirmation: path } : r)),
        );
        costRow = costs.find((r) => r.id === costId) ?? costRow;
      }

      if (costId && taxReceiptFile) {
        const path = await uploadFirmManagementCostDocument(costId, 'tax_receipt', taxReceiptFile);
        costs = sortCostRows(
          costs.map((r) => (r.id === costId ? { ...r, tax_receipt: path } : r)),
        );
        costRow = costs.find((r) => r.id === costId) ?? costRow;
      }

      let invoices = [...(firm?.firm_invoices || [])];
      let invoiceId = costModalInvoiceEditingId;

      if (needsInvoiceRow) {
        if (!invoiceId) {
          const { data, error } = await supabase
            .from('firm_invoices')
            .insert([
              {
                firm_id: costModalFirmId,
                invoice_month: billing_month,
                amount: null,
                currency: FIRM_MONEY_CURRENCY,
                notes,
              },
            ])
            .select(INVOICE_ROW_SELECT)
            .single();
          if (error) throw error;
          invoiceId = (data as FirmInvoiceRow).id;
          invoices = sortInvoiceRows([...invoices, data as FirmInvoiceRow]);
        } else {
          const { error } = await supabase
            .from('firm_invoices')
            .update({ invoice_month: billing_month, notes })
            .eq('id', invoiceId);
          if (error) throw error;
          invoices = sortInvoiceRows(
            invoices.map((r) =>
              r.id === invoiceId ? { ...r, invoice_month: billing_month, notes } : r,
            ),
          );
        }

        if (invoiceFile && invoiceId) {
          const path = buildFirmInvoiceStoragePath(costModalFirmId, invoiceId, invoiceFile.name);
          const { error: upErr } = await supabase.storage
            .from(FIRM_INVOICE_DOCUMENTS_BUCKET)
            .upload(path, invoiceFile, { contentType: invoiceFile.type || undefined, upsert: true });
          if (upErr) throw upErr;
          const { error: uErr } = await supabase
            .from('firm_invoices')
            .update({
              storage_path: path,
              file_name: invoiceFile.name,
              mime_type: invoiceFile.type || null,
              invoice_month: billing_month,
            })
            .eq('id', invoiceId);
          if (uErr) throw uErr;
          invoices = sortInvoiceRows(
            invoices.map((r) =>
              r.id === invoiceId
                ? {
                    ...r,
                    storage_path: path,
                    file_name: invoiceFile.name,
                    mime_type: invoiceFile.type || null,
                    invoice_month: billing_month,
                    notes,
                  }
                : r,
            ),
          );
        }
      } else if (invoiceId) {
        const { error } = await supabase
          .from('firm_invoices')
          .update({ invoice_month: billing_month, notes })
          .eq('id', invoiceId);
        if (error) throw error;
        invoices = sortInvoiceRows(
          invoices.map((r) =>
            r.id === invoiceId ? { ...r, invoice_month: billing_month, notes } : r,
          ),
        );
      }

      mergeFirmChildRows(costModalFirmId, {
        firm_management_costs: costs,
        firm_invoices: invoices,
      });

      if (costModalEditingId) {
        await logActivity({
          firm_id: costModalFirmId,
          contact_id: null,
          action_type: 'UPDATE_MANAGEMENT_COST',
          description: `Updated management cost (${formatMonthAnchor(billing_month)}).`,
        });
      }

      closeCostModal();
      if (selectedFirmId === costModalFirmId) await fetchActivityLogs(costModalFirmId);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Failed to save');
    } finally {
      setIsUpdating(false);
      setCostModalUploading(false);
    }
  };

  const deleteMergedCostRow = async (firmId: string, merged: MergedManagementCostRow) => {
    const hasFiles =
      merged.invoice?.storage_path ||
      merged.cost?.payment_confirmation ||
      merged.cost?.tax_receipt;
    if (
      !window.confirm(
        'Delete this month entry' + (hasFiles ? ' and any attached documents?' : '?'),
      )
    ) {
      return;
    }
    setIsUpdating(true);
    try {
      const firm = firms.find((f) => f.id === firmId);
      let costs = [...(firm?.firm_management_costs || [])];
      let invoices = [...(firm?.firm_invoices || [])];

      if (merged.cost) {
        if (merged.cost.payment_confirmation?.trim()) {
          await supabase.storage
            .from('firm-management-payment-confirmations')
            .remove([merged.cost.payment_confirmation.trim()]);
        }
        if (merged.cost.tax_receipt?.trim()) {
          await supabase.storage
            .from('firm-management-tax-receipts')
            .remove([merged.cost.tax_receipt.trim()]);
        }
        const { error } = await supabase
          .from('firm_management_costs')
          .delete()
          .eq('id', merged.cost.id);
        if (error) throw error;
        costs = costs.filter((r) => r.id !== merged.cost!.id);
        await logActivity({
          firm_id: firmId,
          contact_id: null,
          action_type: 'DELETE_MANAGEMENT_COST',
          description: `Removed management cost (${formatMonthAnchor(merged.monthAnchor)}).`,
        });
      }

      if (merged.invoice) {
        if (merged.invoice.storage_path?.trim()) {
          await supabase.storage
            .from(FIRM_INVOICE_DOCUMENTS_BUCKET)
            .remove([merged.invoice.storage_path.trim()]);
        }
        const { error } = await supabase.from('firm_invoices').delete().eq('id', merged.invoice.id);
        if (error) throw error;
        invoices = invoices.filter((r) => r.id !== merged.invoice!.id);
        await logActivity({
          firm_id: firmId,
          contact_id: null,
          action_type: 'DELETE_INVOICE',
          description: `Removed invoice (${formatMonthAnchor(merged.monthAnchor)}).`,
        });
      }

      mergeFirmChildRows(firmId, { firm_management_costs: costs, firm_invoices: invoices });
      toast.success('Deleted');
      if (selectedFirmId === firmId) await fetchActivityLogs(firmId);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Delete failed');
    } finally {
      setIsUpdating(false);
    }
  };

  const openStorageDocumentInPreview = useCallback(
    async (
      bucket: string,
      storagePath: string,
      fileName: string,
      mimeType?: string | null,
    ) => {
      const path = storagePath.trim();
      if (!path) return;
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
      if (error || !data?.signedUrl) {
        toast.error('Could not open file');
        return;
      }
      const name = fileName.trim() || fileNameFromStoragePath(path) || 'Document';
      setDocumentPreviewItems([
        {
          id: `${bucket}:${path}`,
          name,
          downloadUrl: data.signedUrl,
          fileType: mimeType?.trim() || guessMimeTypeFromFileName(name),
          lastModified: new Date().toISOString(),
        },
      ]);
      setDocumentPreviewOpen(true);
    },
    [],
  );

  const openManagementCostDocPreview = useCallback(
    (column: FirmManagementCostDocColumn, storagePath: string, fileName: string) => {
      void openStorageDocumentInPreview(
        bucketForManagementCostDocColumn(column),
        storagePath,
        fileName,
      );
    },
    [openStorageDocumentInPreview],
  );

  const openInvoiceFileInPreview = useCallback(
    (row: FirmInvoiceRow) => {
      if (!row.storage_path?.trim()) return;
      void openStorageDocumentInPreview(
        FIRM_INVOICE_DOCUMENTS_BUCKET,
        row.storage_path,
        row.file_name?.trim() || fileNameFromStoragePath(row.storage_path) || 'Invoice',
        row.mime_type,
      );
    },
    [openStorageDocumentInPreview],
  );

  const handleSaveView = async () => {
    const name = window.prompt('Enter a name for this view:');
    if (!name) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return toast.error('Check your login session.');

      const { error } = await supabase.from('user_saved_views').insert([{
        user_id: user.id,
        view_name: name,
        filters: { query, status: statusFilter, type: typeFilter },
        sort_config: { key: sortKey, dir: sortDir }
      }]);

      if (error) throw error;
      toast.success('View saved successfully');
      fetchSavedViews();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save view');
    }
  };

  const applyView = (view: SavedView) => {
    setQuery(view.filters?.query || '');
    setStatusFilter((view.filters?.status as any) || 'all');
    setTypeFilter(view.filters?.type || 'all');
    setSortKey((view.sort_config?.key as any) || 'name');
    setSortDir((view.sort_config?.dir as any) || 'asc');
    toast.success(`Applied view: ${view.view_name}`);
  };

  const view: 'firms' | 'firm' | 'contact' = selectedContactId
    ? 'contact'
    : selectedFirmId
      ? 'firm'
      : 'firms';

  const allSelected = filtered.length > 0 && selectedRowIds.size === filtered.length;
  const someSelected = selectedRowIds.size > 0 && !allSelected;
  
  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedRowIds(new Set());
    } else {
      setSelectedRowIds(new Set(filtered.map(f => String(f.id))));
    }
  };

  const toggleRowSelect = (id: string, e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const next = new Set(selectedRowIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedRowIds(next);
  };

  const handleExportCSV = () => {
    const dataToExport = selectedRowIds.size > 0 
      ? filtered.filter(f => selectedRowIds.has(String(f.id)))
      : filtered;

    if (dataToExport.length === 0) return;

    const rows = [
      ['Firm Name', 'Legal Name', 'Type', 'VAT', 'Website', 'Contacts Count', 'Status'],
      ...dataToExport.map(f => [
        `"${(f.name || '').replace(/"/g, '""')}"`,
        `"${(f.legal_name || '').replace(/"/g, '""')}"`,
        `"${(f.firm_types?.label || '').replace(/"/g, '""')}"`,
        `"${(f.vat_number || '').replace(/"/g, '""')}"`,
        `"${(f.website || '').replace(/"/g, '""')}"`,
        String(f.firm_contacts?.length || 0),
        f.is_active ? 'Active' : 'Inactive'
      ])
    ];

    const csvContent = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Firms_Export_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success(`Exported ${dataToExport.length} firms to CSV`);
  };

  // ── Breadcrumb items by view ──────────────────────────────────────────────
  const breadcrumbItems = useMemo(() => {
    const items: { label: string; onClick?: () => void }[] = [
      {
        label: 'External Firms',
        onClick:
          view !== 'firms'
            ? () => {
                setSelectedFirmId(null);
                setSelectedContactId(null);
              }
            : undefined,
      },
    ];
    if (selectedFirm) {
      items.push({
        label: selectedFirm.name,
        onClick:
          view === 'contact'
            ? () => setSelectedContactId(null)
            : undefined,
      });
    }
    if (selectedContact) {
      items.push({ label: selectedContact.name || 'Contact' });
    }
    return items;
  }, [view, selectedFirm, selectedContact]);

  // ─────────────────────────────────────────────────────────────────────────
  //  Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="external-firms-page-shell min-h-[calc(100vh-3rem)] bg-[#ececec] px-4 py-6 md:px-10 md:py-8 [zoom:1.075]">
      <div className="w-full space-y-5">

        {/* ── Page Header (title / path centred; actions top-right) ─────── */}
        <div className="grid w-full grid-cols-1 gap-3 md:grid-cols-[1fr_auto_1fr] md:items-start md:gap-2">
          <div className="hidden md:block" aria-hidden />
          <div className="flex flex-col items-center text-center min-w-0 md:col-start-2 md:row-start-1">
            {view === 'firms' ? (
              <>
                <div className="flex items-center justify-center gap-2.5">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <BuildingOffice2Icon className="h-5 w-5" />
                  </div>
                  <h1 className="text-2xl font-bold tracking-tight text-base-content/95">
                    External Firms
                  </h1>
                </div>
              </>
            ) : (
              <div className="flex flex-wrap items-center justify-center gap-2.5 min-w-0 w-full">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <BuildingOffice2Icon className="h-5 w-5" />
                </div>
                <Breadcrumb items={breadcrumbItems} variant="header" />
              </div>
            )}
          </div>
          {view !== 'firms' && (
            <div className="flex items-center justify-center gap-2 md:col-start-3 md:justify-end md:row-start-1">
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition-colors"
                onClick={() => {
                  if (view === 'contact') { setSelectedContactId(null); return; }
                  setSelectedFirmId(null);
                  setSelectedContactId(null);
                }}
              >
                <ArrowLeftIcon className="h-4 w-4" />
                Back
              </button>
            </div>
          )}
        </div>

        {/* ── Toolbar: search + stats (firms list only) ────────────────── */}
        {view === 'firms' && (
          <div className="-mx-4 px-4 py-3 md:-mx-10 md:px-10 md:sticky md:top-0 md:z-30 md:bg-[#ececec]/95 md:backdrop-blur flex flex-col gap-3 md:flex-row md:items-center md:justify-between border-b border-base-300/50 md:border-b-0">
            {/* Search + Faceted Filters */}
            <div className="flex flex-wrap flex-1 items-center gap-2">
              <label className="flex items-center gap-2.5 rounded-lg border border-base-300 bg-base-100 px-3 py-2 w-full md:max-w-[20rem] focus-within:border-primary/60 focus-within:ring-1 focus-within:ring-primary/20 transition-all duration-150 cursor-text">
                <MagnifyingGlassIcon className="h-5 w-5 shrink-0 text-base-content/40" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="grow bg-transparent text-sm outline-none placeholder:text-base-content/35"
                  placeholder="Search firms, contacts, email, VAT…"
                  spellCheck={false}
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    className="text-base-content/35 hover:text-base-content/70 transition-colors"
                  >
                    ×
                  </button>
                )}
              </label>

              <select 
                className="select select-bordered border-base-300 bg-base-100 font-medium text-sm h-[42px] min-h-[42px]"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
              >
                <option value="all">All Status</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>

              <select 
                className="select select-bordered border-base-300 bg-base-100 font-medium text-sm h-[42px] min-h-[42px]"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
              >
                <option value="all">All Types</option>
                {availableTypes.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>

              <button 
                className="btn btn-sm btn-outline gap-1.5 h-[42px] min-h-[42px] border-base-300 text-base-content/60 hover:text-primary hover:border-primary px-3"
                onClick={handleSaveView}
              >
                <StarIcon className="h-4 w-4" />
                Save View
              </button>

              {savedViews.length > 0 && (
                <div className="dropdown dropdown-end">
                  <div tabIndex={0} role="button" className="btn btn-sm btn-ghost h-[42px] border border-base-300 px-3 flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-base-content/50">Views</span>
                    <ChevronDownIcon className="h-4 w-4 opacity-50" />
                  </div>
                  <ul tabIndex={0} className="dropdown-content z-[100] menu p-2 shadow-2xl bg-base-100 rounded-box w-52 mt-1 border border-base-300">
                    <li className="menu-title px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-40">Your Presets</li>
                    {savedViews.map(v => (
                      <li key={v.id}>
                        <button 
                          type="button"
                          onClick={() => applyView(v)} 
                          className="flex items-center justify-between text-sm py-2.5 w-full hover:bg-base-200 px-3 rounded-lg"
                        >
                          {v.view_name}
                          {v.is_default && <span className="bg-primary/10 text-primary text-[10px] px-1.5 py-0.5 rounded">Default</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Right side: stats + refresh */}
            <div className="flex items-center gap-3">
              {/* Compact stat chips */}
              {!loading && (
                <div className="flex flex-wrap items-center justify-end gap-2 text-sm text-base-content/60">
                  <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1.5 rounded-md bg-base-200 px-3 py-1.5 font-semibold">
                      <BuildingOffice2Icon className="h-4 w-4" />
                      {stats.firmsCount} 
                    </span>
                    <span className="flex items-center gap-1.5 rounded-md bg-base-200 px-3 py-1.5 font-semibold">
                      <UsersIcon className="h-4 w-4" />
                      {stats.contactsCount} 
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {stats.inactiveFirms > 0 && (
                      <span className="flex items-center gap-1.5 rounded-md bg-red-500/10 text-red-600 px-3 py-1.5 font-semibold">
                         <XCircleIcon className="h-4 w-4" />
                         {stats.inactiveFirms} inactive
                      </span>
                    )}
                    {stats.missingDataCount > 0 && (
                      <button
                        type="button"
                        className="flex items-center gap-1.5 rounded-md bg-amber-500/10 text-amber-700 px-3 py-1.5 font-semibold hover:bg-amber-500/20 transition-colors"
                        onClick={() => setMissingDataModalOpen(true)}
                      >
                        <ExclamationTriangleIcon className="h-4 w-4" />
                        {stats.missingDataCount} missing data
                      </button>
                    )}
                  </div>
                </div>
              )}
              <button
                type="button"
                title="Refresh"
                onClick={() => void fetchData(true)}
                disabled={refreshing}
                className="btn btn-ghost btn-sm btn-square text-base-content/50 hover:text-base-content/80"
              >
                <ArrowPathIcon className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>
        )}

        {/* ── Main content area ─────────────────────────────────────────── */}
        <div key={`${view}-${selectedFirmId}-${selectedContactId}`} className="fade-in">
          {loading ? (
            <TableSkeleton rows={7} />
          ) : view === 'firms' ? (
            filtered.length === 0 ? (
              <EmptyState
                title={query ? 'No firms match your search' : 'No firms found'}
                subtitle={query ? 'Try searching by name, email, VAT, or auth ID.' : undefined}
                action={
                  query ? (
                    <button type="button" onClick={() => setQuery('')} className="btn btn-sm btn-outline">
                      Clear filters
                    </button>
                  ) : undefined
                }
              />
            ) : (
              // ── Firms table ─────────────────────────────────────────────
              <div className="-mx-4 overflow-x-auto md:mx-0 py-2">
                <table className="table external-firms-firms-table w-full min-w-[36rem] text-base">
                  <thead>
                    <tr className="md:sticky md:top-0 z-20">
                      <th 
                        className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider w-[38%] md:sticky md:left-0 z-30 bg-[#ececec] md:shadow-[1px_0_0_0_#d1d5db] cursor-pointer transition-colors select-none group/th"
                        onClick={() => handleSort('name')}
                      >
                        <div className={`flex items-center gap-2.5 ${sortKey === 'name' ? 'text-primary' : 'text-base-content/40 group-hover/th:text-base-content/70'}`}>
                          <div className="flex pl-1" onClick={(e) => e.stopPropagation()}>
                            <input 
                              type="checkbox" 
                              className="checkbox checkbox-sm checkbox-primary rounded transition-all duration-150"
                              checked={allSelected}
                              ref={(input) => { if (input) input.indeterminate = someSelected; }}
                              onChange={toggleSelectAll} 
                            />
                          </div>
                          Firm
                          {sortKey === 'name' ? (sortDir === 'asc' ? <ChevronUpIcon className="h-3.5 w-3.5" /> : <ChevronDownIcon className="h-3.5 w-3.5" />) : <ChevronUpDownIcon className="h-3.5 w-3.5 opacity-0 group-hover/th:opacity-100 transition-opacity" />}
                        </div>
                      </th>
                      <th 
                        className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider cursor-pointer transition-colors select-none group/th"
                        onClick={() => handleSort('type')}
                      >
                        <div className={`flex items-center gap-1 ${sortKey === 'type' ? 'text-primary' : 'text-base-content/40 group-hover/th:text-base-content/70'}`}>
                          Type
                          {sortKey === 'type' ? (sortDir === 'asc' ? <ChevronUpIcon className="h-3.5 w-3.5" /> : <ChevronDownIcon className="h-3.5 w-3.5" />) : <ChevronUpDownIcon className="h-3.5 w-3.5 opacity-0 group-hover/th:opacity-100 transition-opacity" />}
                        </div>
                      </th>
                      <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-base-content/40 hidden md:table-cell">VAT</th>
                      <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-base-content/40 hidden lg:table-cell">Website</th>
                      <th 
                        className="px-5 py-3.5 text-right text-xs font-semibold uppercase tracking-wider cursor-pointer transition-colors select-none group/th"
                        onClick={() => handleSort('contacts')}
                      >
                        <div className={`flex items-center justify-end gap-1 ${sortKey === 'contacts' ? 'text-primary' : 'text-base-content/40 group-hover/th:text-base-content/70'}`}>
                          {sortKey === 'contacts' ? (sortDir === 'asc' ? <ChevronUpIcon className="h-3.5 w-3.5" /> : <ChevronDownIcon className="h-3.5 w-3.5" />) : <ChevronUpDownIcon className="h-3.5 w-3.5 opacity-0 group-hover/th:opacity-100 transition-opacity" />}
                          Contacts
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((firm) => {
                      const firmTypeLabel = firm.firm_types?.label || null;
                      const contacts = firm.firm_contacts || [];
                      const isInactive = firm.is_active === false;
                      return (
                        <tr
                          key={firm.id}
                          className="group cursor-pointer"
                          onClick={() => { setSelectedFirmId(firm.id); setSelectedContactId(null); }}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setSelectedFirmId(firm.id);
                              setSelectedContactId(null);
                            }
                          }}
                        >
                          <td className="px-5 py-3 md:sticky md:left-0 z-10 md:shadow-[1px_0_0_0_#e5e7eb]">
                            <div className="flex items-center gap-3">
                              <div className="flex pl-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                                <input 
                                  type="checkbox" 
                                  className="checkbox checkbox-sm checkbox-primary rounded transition-all duration-150 border-base-content/20"
                                  checked={selectedRowIds.has(String(firm.id))}
                                  onChange={(e) => toggleRowSelect(String(firm.id), e)} 
                                />
                              </div>
                              <EntityAvatar
                                name={firm.name}
                                imageUrl={firm.profile_image_url}
                                stableKey={firm.id}
                                className="h-9 w-9 text-xs"
                              />
                              <div className="min-w-0">
                                <span className={`font-semibold truncate block max-w-[18rem] ${isInactive ? 'text-base-content/45 line-through' : 'text-base-content/90'}`}>
                                  {firm.name}
                                </span>
                                {firm.legal_name && firm.legal_name !== firm.name && (
                                  <span className="text-sm text-base-content/40 truncate block">{firm.legal_name}</span>
                                )}
                              </div>
                              {isInactive && (
                                <span className={STATUS_BADGE_INACTIVE}>Inactive</span>
                              )}
                            </div>
                          </td>
                          <td className="px-5 py-4">
                            {firmTypeLabel ? (
                              <FirmTypeBadge
                                label={firmTypeLabel}
                                typeId={firm.firm_types?.id}
                              />
                            ) : (
                              <span className="text-base-content/30">—</span>
                            )}
                          </td>
                          <td className="px-5 py-4 hidden md:table-cell">
                            <span className="text-sm text-base-content/55">{firm.vat_number || '—'}</span>
                          </td>
                          <td className="px-5 py-4 hidden lg:table-cell max-w-[18rem]">
                            {firm.website ? (
                              <a
                                href={firm.website.startsWith('http') ? firm.website : `https://${firm.website}`}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="truncate block text-sm text-base-content/55 hover:text-primary transition-colors hover:underline"
                              >
                                {firm.website}
                              </a>
                            ) : (
                              <span className="text-base-content/30">—</span>
                            )}
                          </td>
                          <td className="px-5 py-4 text-right">
                            <div className="flex items-center justify-end gap-3">
                              <span className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-semibold
                                ${contacts.length > 0 ? 'bg-primary/10 text-primary' : 'bg-base-200 text-base-content/40'}`}>
                                <UsersIcon className="h-3.5 w-3.5" />
                                {contacts.length}
                              </span>
                              <button 
                                type="button" 
                                onClick={(e) => { 
                                  e.stopPropagation(); 
                                  setEditingFirm(firm);
                                }} 
                                className="opacity-0 group-hover:opacity-100 p-1 text-base-content/40 hover:text-base-content/80 transition-all duration-150 rounded-md hover:bg-base-300"
                                aria-label="Firm actions"
                              >
                                <EllipsisVerticalIcon className="h-5 w-5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          ) : view === 'firm' ? (
            // ── Firm detail ──────────────────────────────────────────────
            selectedFirm ? (
              <div className="space-y-4">
                <div className="rounded-[18px] bg-white shadow-sm w-full overflow-hidden">
                  <EditableProfileCover
                    coverKey={`firm::${selectedFirm.id}::${(selectedFirm.name || '').trim()}`}
                    customImageUrl={selectedFirm.cover_image_url}
                    editable
                    uploading={profileImageUploadKey === `firm-cover:${selectedFirm.id}`}
                    onUpload={(file) => void handleFirmCoverImageUpload(selectedFirm, file)}
                    onRemove={
                      selectedFirm.cover_image_url?.trim()
                        ? () => void handleFirmCoverImageRemove(selectedFirm)
                        : undefined
                    }
                  />
                  <div className="px-4 pb-4 pt-2 sm:px-5">
                    <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-start">
                      <EditableProfileAvatar
                        name={selectedFirm.name}
                        imageUrl={selectedFirm.profile_image_url}
                        stableKey={selectedFirm.id}
                        roundedFull={false}
                        editable
                        uploading={profileImageUploadKey === `firm:${selectedFirm.id}`}
                        wrapperClassName="-mt-10 shrink-0 self-start md:-mt-12"
                        className="h-14 w-14 md:h-16 md:w-16 text-sm md:text-base"
                        onUpload={(file) => void handleFirmProfileImageUpload(selectedFirm, file)}
                        onRemove={() => void handleFirmProfileImageRemove(selectedFirm)}
                      />
                      <div className="min-w-0 w-full flex-1 sm:pt-1 md:pt-2">
                        <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                          <div className="min-w-0 w-full">
                            <div className="mb-2 flex flex-wrap items-center gap-2 sm:mb-0 sm:hidden">
                              {selectedFirm.is_active === false ? (
                                <span className={STATUS_BADGE_INACTIVE}>Inactive</span>
                              ) : (
                                <span className={STATUS_BADGE_ACTIVE}>Active</span>
                              )}
                              <p className="text-xs text-base-content/35">
                                Created {formatDate(selectedFirm.created_at)} · Updated{' '}
                                {formatDate(selectedFirm.updated_at)}
                              </p>
                            </div>
                            <h2 className="text-lg font-bold leading-snug text-base-content/95 break-words sm:text-xl">
                              {selectedFirm.name}
                            </h2>
                            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-base-content/55">
                              {selectedFirm.firm_types?.label && (
                                <FirmTypeBadge
                                  label={selectedFirm.firm_types.label}
                                  typeId={selectedFirm.firm_types.id}
                                  size="sm"
                                />
                              )}
                              {selectedFirm.vat_number && (
                                <span className="shrink-0">VAT {selectedFirm.vat_number}</span>
                              )}
                              {selectedFirm.website && (
                                <span className="flex min-w-0 max-w-full items-center gap-1 break-all text-base-content/55">
                                  <GlobeAltIcon className="h-3.5 w-3.5 shrink-0" />
                                  {selectedFirm.website}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="hidden shrink-0 flex-col items-end gap-1.5 sm:flex">
                            {selectedFirm.is_active === false ? (
                              <span className={STATUS_BADGE_INACTIVE}>Inactive</span>
                            ) : (
                              <span className={STATUS_BADGE_ACTIVE}>Active</span>
                            )}
                            <p className="text-xs text-base-content/35 text-right whitespace-nowrap">
                              Created {formatDate(selectedFirm.created_at)} · Updated{' '}
                              {formatDate(selectedFirm.updated_at)}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Contacts section */}
                <div>
                  <div className="flex items-center justify-between px-5 py-3">
                    <div className="flex items-center gap-2">
                      <UsersIcon className="h-4 w-4 text-base-content/50" />
                      <span className="text-sm font-semibold text-base-content/80">Contacts</span>
                    </div>
                    <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
                      (selectedFirm.firm_contacts || []).length > 0
                        ? 'bg-primary/8 text-primary'
                        : 'bg-base-200 text-base-content/40'
                    }`}>
                      {(selectedFirm.firm_contacts || []).length}
                    </span>
                  </div>

                  {(selectedFirm.firm_contacts || []).length === 0 ? (
                    <div className="flex items-center justify-center gap-2 py-10 text-sm text-base-content/40">
                      <UsersIcon className="h-5 w-5" />
                      No contacts linked to this firm
                    </div>
                  ) : (
                    <div className="overflow-x-auto py-2">
                    <table className="table w-full min-w-[32rem] text-base">
                      <thead>
                        <tr>
                          <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-base-content/35 w-[28%]">Contact</th>
                          <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-base-content/35">Email</th>
                          <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-base-content/35 hidden md:table-cell">Phone</th>
                          <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-base-content/35 hidden sm:table-cell">Owner</th>
                          <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-base-content/35">Status</th>
                          <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-base-content/35 hidden lg:table-cell">Linked user</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(selectedFirm.firm_contacts || []).map((c) => {
                          const u = (c as any).users as UserRow | null | undefined;
                          return (
                            <tr
                              key={c.id}
                              className="cursor-pointer"
                              onClick={() => setSelectedContactId(c.id)}
                              role="button"
                              tabIndex={0}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedContactId(c.id); }
                              }}
                            >
                              <td className="px-5 py-4">
                                <div className="flex items-center gap-3">
                                  <ProfileAvatar
                                    name={c.name}
                                    imageUrl={c.profile_image_url}
                                    colorKey={c.id}
                                    size="report"
                                    borderless
                                    roundedFull
                                  />
                                  <span className="font-semibold text-base-content/90 truncate max-w-[12rem]">{c.name || '—'}</span>
                                </div>
                              </td>
                              <td className="px-5 py-4 max-w-[16rem]">
                                <div className="flex flex-col gap-0.5">
                                  {c.email ? (
                                    <a
                                      href={`mailto:${c.email}`}
                                      onClick={(e) => e.stopPropagation()}
                                      className="truncate text-base-content/75 hover:text-primary transition-colors hover:underline"
                                    >
                                      {c.email}
                                    </a>
                                  ) : (
                                    <span className="truncate text-base-content/75">—</span>
                                  )}
                                  {c.user_email && (
                                    <span className="truncate text-xs text-base-content/40">
                                      Login:{' '}
                                      <a
                                        href={`mailto:${c.user_email}`}
                                        onClick={(e) => e.stopPropagation()}
                                        className="hover:text-primary transition-colors hover:underline"
                                      >
                                        {c.user_email}
                                      </a>
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-5 py-4 hidden md:table-cell text-base-content/60">
                                {c.phone ? (
                                  <a
                                    href={`tel:${c.phone}`}
                                    onClick={(e) => e.stopPropagation()}
                                    className="hover:text-primary transition-colors hover:underline"
                                  >
                                    {c.phone}
                                  </a>
                                ) : (
                                  '—'
                                )}
                              </td>
                              <td className="px-5 py-4 hidden sm:table-cell">
                                <ContactStatusToggleRow
                                  label="Owner"
                                  pressed={Boolean(c.firm_owner)}
                                  pressedClass={STATUS_BADGE_OWNER}
                                  unpressedClass={STATUS_BADGE_OWNER_OFF}
                                  toggleClass="toggle-warning"
                                  disabled={togglingContactKey === `${c.id}:firm_owner`}
                                  onToggle={() =>
                                    void patchContactToggle(c, 'firm_owner', !c.firm_owner)
                                  }
                                />
                              </td>
                              <td className="px-5 py-4">
                                <ContactStatusToggleRow
                                  label={contactIsActive(c) ? 'Active' : 'Inactive'}
                                  pressed={contactIsActive(c)}
                                  pressedClass={STATUS_BADGE_ACTIVE}
                                  unpressedClass={STATUS_BADGE_INACTIVE}
                                  toggleClass="toggle-success"
                                  disabled={togglingContactKey === `${c.id}:is_active`}
                                  onToggle={() =>
                                    void patchContactToggle(c, 'is_active', !contactIsActive(c))
                                  }
                                />
                              </td>
                              <td className="px-5 py-4 hidden lg:table-cell">
                                {u?.email ? (
                                  <a 
                                    href={`mailto:${u.email}`}
                                    onClick={(e) => e.stopPropagation()}
                                    className="flex items-center gap-1.5 text-sm text-base-content/55 hover:text-primary transition-colors hover:underline"
                                  >
                                    <LinkIcon className="h-3.5 w-3.5" />
                                    {u.email}
                                  </a>
                                ) : c.user_id ? (
                                  <span className="text-sm text-base-content/35 italic">Linked (no email)</span>
                                ) : (
                                  <span className="text-sm text-base-content/25">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    </div>
                  )}
                </div>

                {/* Management costs (amount + invoice + payment / tax docs per month) */}
                {(() => {
                  const mergedRows = buildMergedManagementRows(
                    selectedFirm.firm_management_costs || [],
                    selectedFirm.firm_invoices || [],
                  );
                  return (
                    <div>
                      <div className="flex items-center justify-between px-5 py-3">
                        <div className="flex items-center gap-2">
                          <BanknotesIcon className="h-4 w-4 text-base-content/50" />
                          <span className="text-sm font-semibold text-base-content/80">Management costs</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
                              mergedRows.length > 0
                                ? 'bg-primary/8 text-primary'
                                : 'bg-base-200 text-base-content/40'
                            }`}
                          >
                            {mergedRows.length}
                          </span>
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs gap-1"
                            onClick={() => openAddCost(selectedFirm.id)}
                          >
                            <PlusIcon className="h-4 w-4" />
                            Add
                          </button>
                        </div>
                      </div>
                      {mergedRows.length === 0 ? (
                        <div className="flex flex-col items-center justify-center gap-2 py-10 text-sm text-base-content/40">
                          <BanknotesIcon className="h-5 w-5" />
                          No management costs yet
                        </div>
                      ) : (
                        <div className="overflow-x-auto py-2">
                          <table className="table w-full min-w-[40rem] text-base">
                            <thead>
                              <tr>
                                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-base-content/35">
                                  Month
                                </th>
                                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-base-content/35">
                                  Amount
                                </th>
                                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-base-content/35 hidden sm:table-cell">
                                  Expense type
                                </th>
                                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-base-content/35 hidden md:table-cell">
                                  Invoice
                                </th>
                                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-base-content/35 hidden lg:table-cell">
                                  Payment confirmation
                                </th>
                                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-base-content/35 hidden lg:table-cell">
                                  Tax receipt
                                </th>
                                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-base-content/35 hidden xl:table-cell">
                                  Notes
                                </th>
                                <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-base-content/35 w-[7rem]">
                                  Actions
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {mergedRows.map((merged) => {
                                const rowKey = merged.cost?.id ?? merged.invoice?.id ?? merged.monthAnchor;
                                const notes =
                                  merged.cost?.notes?.trim() || merged.invoice?.notes?.trim() || '';
                                return (
                                  <tr key={rowKey}>
                                    <td className="px-5 py-3 text-base-content/90">
                                      {formatMonthAnchor(merged.monthAnchor)}
                                    </td>
                                    <td className="px-5 py-3 font-medium tabular-nums">
                                      {merged.cost
                                        ? moneyStr(merged.cost.amount, FIRM_MONEY_CURRENCY)
                                        : '—'}
                                    </td>
                                    <td className="px-5 py-3 text-sm text-base-content/80 hidden sm:table-cell">
                                      {merged.cost
                                        ? (() => {
                                            const fromJoin = resolveExpenseTypeDisplayName(merged.cost);
                                            return fromJoin !== '—'
                                              ? fromJoin
                                              : expenseTypeLabel(merged.cost!.expense_type_id, expenseTypes);
                                          })()
                                        : '—'}
                                    </td>
                                    <td className="px-5 py-3 hidden md:table-cell">
                                      {merged.invoice?.storage_path && merged.invoice?.file_name ? (
                                        <button
                                          type="button"
                                          className="link link-primary text-sm max-w-[10rem] truncate inline-block"
                                          title={merged.invoice.file_name}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            openInvoiceFileInPreview(merged.invoice!);
                                          }}
                                        >
                                          <DocumentTextIcon className="inline h-4 w-4 mr-1 align-text-bottom" />
                                          {merged.invoice.file_name}
                                        </button>
                                      ) : (
                                        <span className="text-base-content/35">—</span>
                                      )}
                                    </td>
                                    <td className="px-5 py-3 hidden lg:table-cell">
                                      <ManagementCostDocLink
                                        storagePath={merged.cost?.payment_confirmation}
                                        onOpen={(path, name) =>
                                          openManagementCostDocPreview('payment_confirmation', path, name)
                                        }
                                      />
                                    </td>
                                    <td className="px-5 py-3 hidden lg:table-cell">
                                      <ManagementCostDocLink
                                        storagePath={merged.cost?.tax_receipt}
                                        onOpen={(path, name) =>
                                          openManagementCostDocPreview('tax_receipt', path, name)
                                        }
                                      />
                                    </td>
                                    <td
                                      className="px-5 py-3 text-sm text-base-content/60 hidden xl:table-cell max-w-[14rem] truncate"
                                      title={notes}
                                    >
                                      {notes || '—'}
                                    </td>
                                    <td className="px-5 py-3 text-right">
                                      <FirmTableActionsDropdown
                                        ariaLabel="Management cost actions"
                                        onEdit={() => openEditMergedCost(selectedFirm.id, merged)}
                                        onDelete={() => void deleteMergedCostRow(selectedFirm.id, merged)}
                                      />
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            ) : (
              <EmptyState title="Firm not found" subtitle="This firm may have been removed." />
            )
          ) : (
            // ── Contact detail ───────────────────────────────────────────
            selectedFirm && selectedContact ? (() => {
              const linkedUser = (selectedContact as any).users as UserRow | null | undefined;
              const contactProfilePhoto =
                selectedContact.profile_image_url?.trim() ||
                (linkedUser as any)?.photo_url ||
                (linkedUser as any)?.photo ||
                null;
              // Resolve sources for this contact from the globally-fetched sourcesById
              const externSourceIds = parseExternSourceIds(linkedUser?.extern_source_id);
              // Group sources by channel
              const channelGroups: { channel: ChannelRow | null; sources: SourceMeta[] }[] = [];
              const seenChannels: Record<string, number> = {}; // channel uuid | '__none__' → index in channelGroups
              externSourceIds.forEach((sid) => {
                const meta = sourcesById[sid] ?? { id: sid, name: externSourceNameById[sid] ?? sid, channel_id: null };
                const key = meta.channel_id ?? '__none__';
                if (seenChannels[key] == null) {
                  seenChannels[key] = channelGroups.length;
                  channelGroups.push({
                    channel: meta.channel_id ? (channelsById[meta.channel_id] ?? null) : null,
                    sources: [],
                  });
                }
                channelGroups[seenChannels[key]].sources.push(meta);
              });

              return (
                <div className="space-y-4">
                  <div className="rounded-[18px] bg-white shadow-sm w-full overflow-hidden">
                    <ContactProfileCover
                      firmId={selectedFirm.id}
                      firmName={selectedFirm.name}
                      firmCoverImageUrl={selectedFirm.cover_image_url}
                    />
                    <div className="px-4 pb-4 pt-2 sm:px-5">
                    <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
                      <EditableProfileAvatar
                        name={selectedContact.name}
                        imageUrl={contactProfilePhoto}
                        stableKey={selectedContact.id}
                        size="xl"
                        roundedFull
                        editable
                        uploading={profileImageUploadKey === `contact:${selectedContact.id}`}
                        wrapperClassName="-mt-12 shrink-0 self-start md:-mt-14"
                        onUpload={(file) => void handleContactProfileImageUpload(selectedContact, file)}
                        onRemove={() => void handleContactProfileImageRemove(selectedContact)}
                      />
                      <div className="min-w-0 w-full flex-1 sm:pt-1 md:pt-2">
                        <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                          <div className="min-w-0 w-full">
                            <p className="mb-2 text-xs text-base-content/35 sm:hidden">
                              Created {formatDate(selectedContact.created_at)} · Updated{' '}
                              {formatDate(selectedContact.updated_at)}
                            </p>
                            <div className="flex flex-wrap items-center gap-2">
                              <h2 className="w-full text-xl font-bold leading-snug text-base-content/95 break-words sm:w-auto sm:text-2xl">
                                {selectedContact.name || 'Contact'}
                              </h2>
                              <ContactStatusToggleRow
                                label={contactIsActive(selectedContact) ? 'Active' : 'Inactive'}
                                pressed={contactIsActive(selectedContact)}
                                pressedClass={STATUS_BADGE_ACTIVE}
                                unpressedClass={STATUS_BADGE_INACTIVE}
                                toggleClass="toggle-success"
                                disabled={togglingContactKey === `${selectedContact.id}:is_active`}
                                onToggle={() =>
                                  void patchContactToggle(
                                    selectedContact,
                                    'is_active',
                                    !contactIsActive(selectedContact),
                                  )
                                }
                              />
                              <ContactStatusToggleRow
                                label="Owner"
                                pressed={Boolean(selectedContact.firm_owner)}
                                pressedClass={STATUS_BADGE_OWNER}
                                unpressedClass={STATUS_BADGE_OWNER_OFF}
                                toggleClass="toggle-warning"
                                disabled={togglingContactKey === `${selectedContact.id}:firm_owner`}
                                onToggle={() =>
                                  void patchContactToggle(
                                    selectedContact,
                                    'firm_owner',
                                    !selectedContact.firm_owner,
                                  )
                                }
                              />
                              {linkedUser && (
                                <span className={STATUS_BADGE_LINKED}>Linked user</span>
                              )}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-base-content/55">
                              <span className="font-medium text-base-content/70">{selectedFirm.name}</span>
                              {selectedFirm.firm_types?.label && (
                                <FirmTypeBadge
                                  label={selectedFirm.firm_types.label}
                                  typeId={selectedFirm.firm_types.id}
                                  size="sm"
                                />
                              )}
                            </div>
                          </div>
                          <p className="hidden shrink-0 text-xs text-base-content/35 text-right whitespace-nowrap sm:block sm:self-start sm:pt-1">
                            Created {formatDate(selectedContact.created_at)} · Updated{' '}
                            {formatDate(selectedContact.updated_at)}
                          </p>
                        </div>
                      </div>
                    </div>
                    </div>
                  </div>

                  {/* Detail grid */}
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
                    {/* Contact info */}
                    <div className="lg:col-span-2 space-y-2">
                      <div className="flex items-center gap-2 px-0.5">
                        <IdentificationIcon className="h-4 w-4 text-base-content/40" />
                        <span className="text-sm font-semibold text-base-content/75">Contact info</span>
                      </div>
                      <div className="rounded-[18px] bg-white px-5 py-4 shadow-sm space-y-4">
                        <div className="flex items-start gap-3">
                          <EnvelopeIcon className="h-4 w-4 mt-0.5 shrink-0 text-base-content/35" />
                          <div className="min-w-0">
                            <SectionLabel>Email</SectionLabel>
                            <div className="mt-0.5 text-base font-medium text-base-content/85 break-all">
                              {selectedContact.email ? (
                                <a href={`mailto:${selectedContact.email}`} className="hover:text-primary transition-colors hover:underline">
                                  {selectedContact.email}
                                </a>
                              ) : (
                                '—'
                              )}
                            </div>
                            {selectedContact.second_email && (
                              <div className="mt-0.5 text-xs text-base-content/45 break-all">
                                <a href={`mailto:${selectedContact.second_email}`} className="hover:text-primary transition-colors hover:underline">
                                  {selectedContact.second_email}
                                </a>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-start gap-3">
                          <PhoneIcon className="h-4 w-4 mt-0.5 shrink-0 text-base-content/35" />
                          <div>
                            <SectionLabel>Phone</SectionLabel>
                            <div className="mt-0.5 text-sm font-medium text-base-content/85">
                              {selectedContact.phone ? (
                                <a href={`tel:${selectedContact.phone}`} className="hover:text-primary transition-colors hover:underline">
                                  {selectedContact.phone}
                                </a>
                              ) : (
                                '—'
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-start gap-3">
                          <EnvelopeIcon className="h-4 w-4 mt-0.5 shrink-0 text-base-content/35" />
                          <div>
                            <SectionLabel>Login email</SectionLabel>
                            <div className="mt-0.5 text-sm font-medium text-base-content/85 break-all">
                              {selectedContact.user_email ? (
                                <a href={`mailto:${selectedContact.user_email}`} className="hover:text-primary transition-colors hover:underline">
                                  {selectedContact.user_email}
                                </a>
                              ) : (
                                '—'
                              )}
                            </div>
                          </div>
                        </div>
                        {selectedContact.notes && (
                          <div className="flex items-start gap-3">
                            <DocumentTextIcon className="h-4 w-4 mt-0.5 shrink-0 text-base-content/35" />
                            <div>
                              <SectionLabel>Notes</SectionLabel>
                              <div className="mt-0.5 text-sm text-base-content/75 whitespace-pre-wrap break-words">
                                {renderNotesWithLinks(selectedContact.notes)}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Sources & Channels panel */}
                    <div className="lg:col-span-3 space-y-2">
                      <div className="flex items-center gap-2 px-0.5">
                        <SignalIcon className="h-4 w-4 text-base-content/40" />
                        <span className="text-sm font-semibold text-base-content/75">Sources & Channels</span>
                        {externSourceIds.length > 0 && (
                          <span className="ml-auto rounded-md bg-primary/8 px-2 py-0.5 text-[11px] font-semibold text-primary">
                            {externSourceIds.length} source{externSourceIds.length !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                      <div className="rounded-[18px] bg-white px-5 py-4 shadow-sm">
                      {externSourceIds.length === 0 ? (
                        <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                          <FunnelIcon className="h-6 w-6 text-base-content/20" />
                          <div className="text-sm text-base-content/40">No sources linked</div>
                          <div className="text-xs text-base-content/30">This contact has no lead sources assigned</div>
                        </div>
                      ) : (
                        <div className="divide-y divide-base-300/50">
                          {channelGroups.map((group, gi) => (
                            <div key={group.channel?.id ?? `__none__${gi}`} className="px-5 py-4">
                              {/* Channel header — icons/colours match MarketingDashboardReport */}
                              <div className="flex items-center gap-2 mb-2.5 flex-wrap">
                                {group.channel ? (
                                  <>
                                    <ChannelLabel
                                      label={
                                        group.channel.is_active === false
                                          ? `${group.channel.label} (inactive)`
                                          : group.channel.label
                                      }
                                      seed={group.channel.code || group.channel.id}
                                      inactive={group.channel.is_active === false}
                                      className="text-xs font-semibold"
                                    />
                                    <span className="rounded border border-base-300 bg-base-200/60 px-1.5 py-0.5 text-[10px] font-mono text-base-content/40">
                                      {group.channel.code}
                                    </span>
                                  </>
                                ) : (
                                  <ChannelLabel
                                    label="No channel"
                                    seed="__none__"
                                    className="text-xs font-semibold italic"
                                  />
                                )}
                              </div>
                              {/* Source chips under this channel */}
                              <div className="flex flex-wrap gap-1.5 pl-1">
                                {group.sources.map((src) => (
                                  <span
                                    key={src.id}
                                    className="inline-block rounded-md bg-gray-100 px-2 py-1 text-[11px] font-medium text-gray-700"
                                  >
                                    {src.name}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2 px-0.5">
                      <BuildingOffice2Icon className="h-4 w-4 text-base-content/40" />
                      <span className="text-sm font-semibold text-base-content/75">Firm context</span>
                      {selectedFirm.firm_types?.label && (
                        <FirmTypeBadge
                          className="ml-auto"
                          label={selectedFirm.firm_types.label}
                          typeId={selectedFirm.firm_types.id}
                          size="sm"
                        />
                      )}
                    </div>

                    {/* Mobile: each label paired with its value */}
                    <div className="space-y-4 rounded-[18px] bg-white px-4 py-4 shadow-sm sm:px-5 md:hidden">
                      <DetailField label="Firm name" value={selectedFirm.name} />
                      <DetailField label="VAT" value={selectedFirm.vat_number} mono />
                      <DetailField
                        label="Website"
                        value={
                          selectedFirm.website ? (
                            <a
                              href={
                                selectedFirm.website.startsWith('http')
                                  ? selectedFirm.website
                                  : `https://${selectedFirm.website}`
                              }
                              target="_blank"
                              rel="noreferrer"
                              className="break-all font-medium text-base-content/75 hover:text-primary hover:underline"
                            >
                              {selectedFirm.website}
                            </a>
                          ) : undefined
                        }
                      />
                      <DetailField
                        label="Address"
                        value={
                          <span className="font-medium text-base-content/75 break-words">
                            {selectedFirm.address || '—'}
                          </span>
                        }
                      />
                    </div>

                    {/* md+: column titles on grey shell, values in white card */}
                    <div className="hidden md:block min-w-0 overflow-x-auto">
                      <div className="grid min-w-[32rem] grid-cols-4 gap-x-6 px-5">
                        <SectionLabel>Firm name</SectionLabel>
                        <SectionLabel>VAT</SectionLabel>
                        <SectionLabel>Website</SectionLabel>
                        <SectionLabel>Address</SectionLabel>
                      </div>
                      <div className="mt-2 w-full overflow-hidden rounded-[18px] bg-white shadow-sm">
                        <div className="grid min-w-[32rem] grid-cols-4 gap-x-6 gap-y-3 px-5 py-4 text-sm text-base-content/75">
                          <div className="min-w-0 font-medium text-base-content/90 break-words">
                            {selectedFirm.name || '—'}
                          </div>
                          <div className="text-base-content/55">{selectedFirm.vat_number || '—'}</div>
                          <div className="min-w-0 text-base-content/55 break-all">
                            {selectedFirm.website ? (
                              <a
                                href={
                                  selectedFirm.website.startsWith('http')
                                    ? selectedFirm.website
                                    : `https://${selectedFirm.website}`
                                }
                                target="_blank"
                                rel="noreferrer"
                                className="hover:text-primary transition-colors hover:underline"
                              >
                                {selectedFirm.website}
                              </a>
                            ) : (
                              '—'
                            )}
                          </div>
                          <div className="min-w-0 text-base-content/55 break-words">
                            {selectedFirm.address || '—'}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Activity Timeline */}
                  <div className="rounded-xl border border-base-300 bg-base-100 overflow-hidden">
                    <div className="flex items-center gap-2 px-5 py-3 bg-base-200/30 border-b border-base-300/50">
                      <ArrowPathIcon className="h-4 w-4 text-base-content/40" />
                      <span className="text-sm font-semibold text-base-content/75">Activity Timeline</span>
                    </div>
                    <div className="p-6">
                      {isLoadingLogs ? (
                        <div className="flex items-center justify-center py-10">
                          <span className="loading loading-spinner text-primary" />
                        </div>
                      ) : activeLogs.length === 0 ? (
                        <div className="text-center py-10 space-y-2">
                          <p className="text-sm text-base-content/40">No activity recorded yet.</p>
                        </div>
                      ) : (
                        <div className="relative border-l-2 border-base-300 ml-3 space-y-8 pb-4">
                          {activeLogs.map((item) => {
                            const isFirmUpdate = item.action_type === 'UPDATE_FIRM';
                            return (
                              <div key={item.id} className="relative pl-8">
                                <span className={`absolute -left-[11px] top-0 flex h-5 w-5 items-center justify-center rounded-full ${isFirmUpdate ? 'bg-primary' : 'bg-blue-500'} text-white ring-4 ring-base-100`}>
                                  {isFirmUpdate ? <ArrowPathIcon className="h-3 w-3" /> : <UserIcon className="h-3 w-3" />}
                                </span>
                                <div>
                                  <div className="flex items-center justify-between text-sm">
                                    <p className="font-bold text-base-content/80">{item.action_type.replace(/_/g, ' ')}</p>
                                    <span className="text-xs text-base-content/40">
                                      {new Date(item.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                                    </span>
                                  </div>
                                  <p className="text-xs text-base-content/50 mt-1">{item.description}</p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      
                      {activeLogs.length > 0 && (
                        <div className="mt-2 text-center">
                          <button className="text-xs font-bold text-primary hover:underline" onClick={() => toast.success('Showing recent activity.')}>
                            View full audit log
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })() : (
              <EmptyState title="Contact not found" subtitle="This contact may have been removed." />
            )
          )}
        </div>

        {/* Floating Action Bar */}
        {selectedRowIds.size > 0 && view === 'firms' && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-4 rounded-xl bg-base-content px-5 py-3 text-base-100 shadow-2xl transition-all duration-300 transform animate-in slide-in-from-bottom-5">
            <div className="flex items-center gap-3 border-r border-base-100/20 pr-4">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-base-100/20 text-xs font-bold font-mono">
                {selectedRowIds.size}
              </span>
              <span className="text-sm font-medium">selected</span>
            </div>
            <div className="flex items-center gap-2">
              <button 
                type="button" 
                onClick={handleExportCSV}
                className="btn btn-sm hover:bg-base-100/20 text-base-100 border-none bg-transparent transition-colors shadow-none"
              >
                Export CSV
              </button>
              <button 
                type="button"
                onClick={() => setSelectedRowIds(new Set())}
                className="btn btn-sm hover:bg-base-100/20 text-base-100/60 border-none bg-transparent transition-colors px-2 shadow-none"
              >
                Clear
              </button>
            </div>
          </div>
        )}

        {/* Firm Edit Slide-over */}
        {editingFirm && (
          <div className="fixed inset-0 z-[100] overflow-hidden">
            <div 
              className="absolute inset-0 bg-base-content/20 backdrop-blur-[2px] transition-opacity animate-in fade-in duration-300" 
              onClick={() => !isUpdating && setEditingFirm(null)} 
            />
            <div className="absolute inset-y-0 right-0 flex max-w-full pl-10">
              <div className="w-screen max-w-md transform transition-transform animate-in slide-in-from-right duration-300 ease-in-out bg-base-100 shadow-2xl">
                <div className="flex h-full flex-col divide-y divide-base-300">
                  <div className="flex items-center justify-between px-6 py-5 bg-base-200/50">
                    <div>
                      <h2 className="text-lg font-bold text-base-content">Edit Firm</h2>
                      <p className="text-xs text-base-content/50 uppercase tracking-widest font-semibold mt-0.5">Firm ID: {editingFirm.id.slice(0,8)}…</p>
                    </div>
                    <button 
                      onClick={() => setEditingFirm(null)}
                      className="rounded-md p-1 text-base-content/40 hover:text-base-content/80 hover:bg-base-300 transition-all"
                    >
                      <XMarkIcon className="h-6 w-6" />
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto px-6 py-8">
                    <form 
                      id="edit-firm-form"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const formData = new FormData(e.currentTarget);
                        const updates = {
                          name: String(formData.get('name')),
                          legal_name: String(formData.get('legal_name')),
                          vat_number: String(formData.get('vat_number')),
                          website: String(formData.get('website')),
                          address: String(formData.get('address')),
                          notes: String(formData.get('notes')),
                          firm_type_id: String(formData.get('firm_type_id')),
                          is_active: formData.get('is_active') === 'on'
                        };
                        await handleUpdateFirm(updates);
                      }}
                      className="space-y-6"
                    >
                      <div className="space-y-1">
                        <label className="text-[11px] font-bold uppercase tracking-wider text-base-content/40 ml-1">Firm Name</label>
                        <input name="name" defaultValue={editingFirm.name || ''} className="input input-bordered w-full bg-base-100" required />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] font-bold uppercase tracking-wider text-base-content/40 ml-1">Legal Name</label>
                        <input name="legal_name" defaultValue={editingFirm.legal_name || ''} className="input input-bordered w-full bg-base-100" />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-[11px] font-bold uppercase tracking-wider text-base-content/40 ml-1">VAT Number</label>
                          <input name="vat_number" defaultValue={editingFirm.vat_number || ''} className="input input-bordered w-full font-mono bg-base-100" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[11px] font-bold uppercase tracking-wider text-base-content/40 ml-1">Firm Type</label>
                          <select name="firm_type_id" defaultValue={editingFirm.firm_type_id || ''} className="select select-bordered w-full bg-base-100">
                            <option value="">Select Type</option>
                            {availableTypes.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] font-bold uppercase tracking-wider text-base-content/40 ml-1">Website URL</label>
                        <input name="website" defaultValue={editingFirm.website || ''} className="input input-bordered w-full bg-base-100" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] font-bold uppercase tracking-wider text-base-content/40 ml-1">Office Address</label>
                        <textarea name="address" defaultValue={editingFirm.address || ''} className="textarea textarea-bordered w-full bg-base-100 h-20" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] font-bold uppercase tracking-wider text-base-content/40 ml-1">Internal Notes</label>
                        <textarea name="notes" defaultValue={editingFirm.notes || ''} className="textarea textarea-bordered w-full bg-base-100 h-24" />
                      </div>
                      <div className="flex items-center gap-3 pt-2">
                        <input type="checkbox" name="is_active" defaultChecked={editingFirm.is_active ?? undefined} className="checkbox checkbox-primary rounded" />
                        <span className="text-sm font-semibold text-base-content/75">Firm is currently active</span>
                      </div>
                    </form>
                  </div>

                  <div className="px-6 py-5 bg-base-50/50 flex items-center justify-end gap-3">
                    <button 
                      type="button" 
                      onClick={() => setEditingFirm(null)} 
                      disabled={isUpdating}
                      className="btn btn-ghost"
                    >
                      Cancel
                    </button>
                    <button 
                      type="submit" 
                      form="edit-firm-form"
                      disabled={isUpdating}
                      className="btn btn-primary px-8"
                    >
                      {isUpdating ? <span className="loading loading-spinner loading-sm" /> : 'Save Changes'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Contact Edit Slide-over */}
        {editingContact && (
          <div className="fixed inset-0 z-[100] overflow-hidden">
            <div 
              className="absolute inset-0 bg-base-content/20 backdrop-blur-[2px] transition-opacity animate-in fade-in duration-300" 
              onClick={() => !isUpdating && setEditingContact(null)} 
            />
            <div className="absolute inset-y-0 right-0 flex max-w-full pl-10">
              <div className="w-screen max-w-md transform transition-transform animate-in slide-in-from-right duration-300 ease-in-out bg-base-100 shadow-2xl">
                <div className="flex h-full flex-col divide-y divide-base-300">
                  <div className="flex items-center justify-between px-6 py-5 bg-base-200/50">
                    <div>
                      <h2 className="text-lg font-bold text-base-content">Edit Contact</h2>
                      <p className="text-xs text-base-content/50 uppercase tracking-widest font-semibold mt-0.5">{editingContact.name}</p>
                    </div>
                    <button 
                      onClick={() => setEditingContact(null)}
                      className="rounded-md p-1 text-base-content/40 hover:text-base-content/80 hover:bg-base-300 transition-all"
                    >
                      <XMarkIcon className="h-6 w-6" />
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto px-6 py-8">
                    <form 
                      id="edit-contact-form"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const formData = new FormData(e.currentTarget);
                        const updates = {
                          name: String(formData.get('name')),
                          email: String(formData.get('email')),
                          second_email: String(formData.get('second_email')),
                          phone: String(formData.get('phone')),
                          user_email: String(formData.get('user_email')),
                          notes: String(formData.get('notes')),
                        };
                        await handleUpdateContact(updates);
                      }}
                      className="space-y-6"
                    >
                      <div className="space-y-1">
                        <label className="text-[11px] font-bold uppercase tracking-wider text-base-content/40 ml-1">Full Name</label>
                        <input name="name" defaultValue={editingContact.name || ''} className="input input-bordered w-full bg-base-100" required />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-[11px] font-bold uppercase tracking-wider text-base-content/40 ml-1">Primary Email</label>
                          <input name="email" type="email" defaultValue={editingContact.email || ''} className="input input-bordered w-full bg-base-100" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[11px] font-bold uppercase tracking-wider text-base-content/40 ml-1">Second Email</label>
                          <input name="second_email" type="email" defaultValue={editingContact.second_email || ''} className="input input-bordered w-full bg-base-100" />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] font-bold uppercase tracking-wider text-base-content/40 ml-1">Phone Number</label>
                        <input name="phone" defaultValue={editingContact.phone || ''} className="input input-bordered w-full bg-base-100" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] font-bold uppercase tracking-wider text-base-content/40 ml-1">User Login Email</label>
                        <input name="user_email" defaultValue={editingContact.user_email || ''} className="input input-bordered w-full bg-base-100" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] font-bold uppercase tracking-wider text-base-content/40 ml-1">Private Notes</label>
                        <textarea name="notes" defaultValue={editingContact.notes || ''} className="textarea textarea-bordered w-full bg-base-100 h-32" />
                      </div>
                    </form>
                  </div>

                  <div className="px-6 py-5 bg-base-50/50 flex items-center justify-end gap-3">
                    <button 
                      type="button" 
                      onClick={() => setEditingContact(null)} 
                      disabled={isUpdating}
                      className="btn btn-ghost"
                    >
                      Cancel
                    </button>
                    <button 
                      type="submit" 
                      form="edit-contact-form"
                      disabled={isUpdating}
                      className="btn btn-primary px-8"
                    >
                      {isUpdating ? <span className="loading loading-spinner loading-sm" /> : 'Save Contact'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {costModalFirmId && (
          <div className="modal modal-open z-[110]">
            <div className="modal-box max-w-md max-h-[90vh] overflow-y-auto">
              <h3 className="font-bold text-lg">
                {costModalEditingId ? 'Edit management cost' : 'Add management cost'}
              </h3>
              <div className="mt-4 space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-wide text-base-content/50">Month</label>
                  <input
                    type="month"
                    className="input input-bordered w-full"
                    value={costForm.month}
                    onChange={(e) => setCostForm((f) => ({ ...f, month: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-wide text-base-content/50">
                    Amount (NIS)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="input input-bordered w-full"
                    value={costForm.amount}
                    onChange={(e) => setCostForm((f) => ({ ...f, amount: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-wide text-base-content/50">
                    Expense type
                  </label>
                  <select
                    className="select select-bordered w-full"
                    value={costForm.expense_type_id}
                    onChange={(e) => setCostForm((f) => ({ ...f, expense_type_id: e.target.value }))}
                  >
                    <option value="">Select type</option>
                    {expenseTypes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-wide text-base-content/50">Notes</label>
                  <textarea
                    className="textarea textarea-bordered w-full min-h-[4rem]"
                    value={costForm.notes}
                    onChange={(e) => setCostForm((f) => ({ ...f, notes: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-wide text-base-content/50">
                    Invoice (PDF, image, office)
                  </label>
                  <input
                    type="file"
                    className="file-input file-input-bordered w-full file-input-sm"
                    accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx"
                    onChange={(e) => setInvoiceFile(e.target.files?.[0] ?? null)}
                  />
                  {costModalInvoiceEditingId && !invoiceFile ? (
                    <p className="text-xs text-base-content/50">
                      Current:{' '}
                      {(firms.find((x) => x.id === costModalFirmId)?.firm_invoices || []).find(
                        (r) => r.id === costModalInvoiceEditingId,
                      )?.file_name || 'file'}{' '}
                      — upload a new file to replace.
                    </p>
                  ) : null}
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-wide text-base-content/50">
                    Payment confirmation
                  </label>
                  <input
                    type="file"
                    className="file-input file-input-bordered w-full file-input-sm"
                    accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx"
                    onChange={(e) => setPaymentConfirmationFile(e.target.files?.[0] ?? null)}
                  />
                  {costModalEditingId &&
                  !paymentConfirmationFile &&
                  (firms.find((x) => x.id === costModalFirmId)?.firm_management_costs || []).find(
                    (r) => r.id === costModalEditingId,
                  )?.payment_confirmation ? (
                    <p className="text-xs text-base-content/50">A file is on record — upload to replace.</p>
                  ) : null}
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-wide text-base-content/50">
                    Tax receipt
                  </label>
                  <input
                    type="file"
                    className="file-input file-input-bordered w-full file-input-sm"
                    accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx"
                    onChange={(e) => setTaxReceiptFile(e.target.files?.[0] ?? null)}
                  />
                  {costModalEditingId &&
                  !taxReceiptFile &&
                  (firms.find((x) => x.id === costModalFirmId)?.firm_management_costs || []).find(
                    (r) => r.id === costModalEditingId,
                  )?.tax_receipt ? (
                    <p className="text-xs text-base-content/50">A file is on record — upload to replace.</p>
                  ) : null}
                </div>
              </div>
              <div className="modal-action">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={closeCostModal}
                  disabled={isUpdating || costModalUploading}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={isUpdating || costModalUploading}
                  onClick={() => void submitCostModal()}
                >
                  {isUpdating || costModalUploading ? (
                    <span className="loading loading-sm loading-spinner" />
                  ) : (
                    'Save'
                  )}
                </button>
              </div>
            </div>
            <button
              type="button"
              className="modal-backdrop bg-black/40"
              aria-label="Close"
              onClick={() => !isUpdating && !costModalUploading && closeCostModal()}
            />
          </div>
        )}

        {missingDataModalOpen && (
          <div className="modal modal-open z-[110]">
            <div className="modal-box max-w-4xl max-h-[85vh] flex flex-col p-0 overflow-hidden">
              <div className="flex items-start justify-between gap-4 border-b border-base-300 px-6 py-4">
                <div>
                  <h3 className="font-bold text-lg text-base-content/90">Missing data</h3>
                  <p className="text-sm text-base-content/50 mt-1">
                    Firms and contacts in the current list missing required fields
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm btn-circle shrink-0"
                  aria-label="Close"
                  onClick={() => setMissingDataModalOpen(false)}
                >
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>
              <div className="overflow-auto flex-1 px-6 py-4">
                {missingDataRows.length === 0 ? (
                  <p className="text-sm text-base-content/50 py-8 text-center">No missing data in current view.</p>
                ) : (
                  <table className="table table-sm w-full">
                    <thead>
                      <tr className="text-xs uppercase tracking-wider text-base-content/40">
                        <th className="bg-transparent">Type</th>
                        <th className="bg-transparent">Firm</th>
                        <th className="bg-transparent">Contact</th>
                        <th className="bg-transparent">Missing fields</th>
                      </tr>
                    </thead>
                    <tbody>
                      {missingDataRows.map((row) => (
                        <tr
                          key={row.id}
                          className="cursor-pointer hover:bg-base-200/40"
                          onClick={() => {
                            setMissingDataModalOpen(false);
                            setSelectedFirmId(row.firmId);
                            setSelectedContactId(row.contactId ?? null);
                          }}
                        >
                          <td className="text-sm font-medium">{row.entity}</td>
                          <td className="text-sm max-w-[14rem] truncate">{row.firmName}</td>
                          <td className="text-sm text-base-content/60 max-w-[12rem] truncate">
                            {row.entity === 'Contact' ? row.contactName : '—'}
                          </td>
                          <td>
                            <div className="flex flex-wrap gap-1">
                              {row.missingFields.map((field) => (
                                <span
                                  key={field}
                                  className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900"
                                >
                                  {field}
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div className="border-t border-base-300 px-6 py-3 flex justify-end">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setMissingDataModalOpen(false)}
                >
                  Close
                </button>
              </div>
            </div>
            <button
              type="button"
              className="modal-backdrop bg-black/40"
              aria-label="Close"
              onClick={() => setMissingDataModalOpen(false)}
            />
          </div>
        )}

        <DocumentPreviewModal
          isOpen={documentPreviewOpen}
          onClose={() => {
            setDocumentPreviewOpen(false);
            setDocumentPreviewItems([]);
          }}
          documents={documentPreviewItems}
        />

        <style>{`
          .external-firms-page-shell table {
            background: transparent !important;
            border: none !important;
            box-shadow: none !important;
            border-collapse: separate !important;
            border-spacing: 0 10px !important;
          }

          .external-firms-page-shell .table tbody tr:hover {
            background-color: transparent !important;
          }
          html.dark .external-firms-page-shell .table tbody tr:hover {
            background-color: transparent !important;
          }

          .external-firms-page-shell table tbody tr {
            background: transparent !important;
            border-radius: 18px !important;
            overflow: hidden !important;
            box-shadow: none !important;
          }

          .external-firms-page-shell table tbody tr:hover {
            box-shadow: none !important;
          }

          .external-firms-page-shell table tbody td {
            border: none !important;
            border-bottom: none !important;
            background: #ffffff !important;
            box-shadow: none !important;
            vertical-align: middle;
          }

          .external-firms-page-shell table tbody td:first-child {
            border-top-left-radius: 18px !important;
            border-bottom-left-radius: 18px !important;
            padding-left: 1.1rem !important;
          }

          .external-firms-page-shell table tbody td:last-child {
            border-top-right-radius: 18px !important;
            border-bottom-right-radius: 18px !important;
            padding-right: 1.1rem !important;
          }

          .external-firms-page-shell table tbody tr:hover td {
            background: #f1f5f9 !important;
          }

          html.dark .external-firms-page-shell table tbody td {
            background: rgba(255, 255, 255, 0.06) !important;
          }

          html.dark .external-firms-page-shell table tbody tr:hover td {
            background: rgba(255, 255, 255, 0.10) !important;
          }

          .external-firms-page-shell table thead,
          .external-firms-page-shell table thead tr,
          .external-firms-page-shell table thead th {
            background-color: transparent !important;
            background-image: none !important;
            border-bottom: none !important;
          }

          .external-firms-page-shell table.external-firms-firms-table thead tr,
          .external-firms-page-shell table.external-firms-firms-table thead th {
            background-color: #ececec !important;
          }
        `}</style>
      </div>
    </div>
  );
}
