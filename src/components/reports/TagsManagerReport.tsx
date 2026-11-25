import React, { useCallback, useEffect, useMemo, useRef, useState, type FC } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  ArchiveBoxIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  ExclamationTriangleIcon,
  FlagIcon,
  FunnelIcon,
  PencilSquareIcon,
  PhoneIcon,
  TagIcon,
  XMarkIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import { CheckCircleIcon } from '@heroicons/react/24/solid';
import { FaWhatsapp } from 'react-icons/fa';
import { supabase } from '../../lib/supabase';
import { convertToNIS } from '../../lib/currencyConversion';
import {
  fetchOutstandingPaymentPlanRowsForTagsManager,
  formatCurrency,
  type PaymentRow,
} from '../../pages/CollectionFinancesReport';
import {
  fetchUnpaidTotalsBatchByLeadKey,
  pickUnpaidAmountForCurrency,
  type UnpaidByCurrencyMap,
} from '../../lib/financeUnpaidTotal';
import {
  conversationChannelLabel,
  fetchFlagTypes,
  FLAG_TYPE_PROBABILITY,
  type ConversationChannel,
  type FlagTypeRow,
} from '../../lib/userContentFlags';
import { fetchStageNames, getSoftStageBadgeStyle, getStageColour, getStageName } from '../../lib/stageUtils';
import { usePersistedFilters, usePersistedState } from '../../hooks/usePersistedState';

type JunctionRow = {
  id?: number;
  lead_id?: number | null;
  newlead_id?: string | null;
  leadtag_id?: number | null;
  employee_id?: number | null;
  tagged_at?: string | null;
  misc_leadtag?: { id?: number; name?: string | null } | { id?: number; name?: string | null }[] | null;
  tenants_employee?: {
    id?: number;
    display_name?: string | null;
    photo_url?: string | null;
    photo?: string | null;
  } | null;
};

type TagsManagerFilterState = {
  taggedFromDate: string;
  taggedToDate: string;
  /** Filters the "Date" column (due / plan date) in expanded outstanding payment plans; client-side on loaded rows. */
  paymentPlanFromDate: string;
  paymentPlanToDate: string;
  filterTagIds: number[];
  filterEmployeeIds: number[];
  /** First visit selects the signed-in employee, then stays as the user left it. */
  mineDefaultPending?: boolean;
};

/** Serialized report cache (sessionStorage) — maps as entry arrays for JSON. */
type TagsManagerPersistedReport = {
  signature: string;
  rows: JunctionRow[];
  newLeadEntries: [string, Record<string, unknown>][];
  legacyEntries: [number, Record<string, unknown>][];
  unpaidEntries: [string, UnpaidByCurrencyMap][];
  currencyEntries: [number, string][];
};

/** Signature for junction report fetch only (plan payment dates are client-side on expanded rows). */
function tagsManagerReportFetchSignature(f: {
  taggedFromDate: string;
  taggedToDate: string;
  filterTagIds: number[];
  filterEmployeeIds: number[];
}): string {
  return JSON.stringify({
    v: 3,
    from: f.taggedFromDate,
    to: f.taggedToDate,
    tags: [...f.filterTagIds].sort((a, b) => a - b),
    emps: [...f.filterEmployeeIds].sort((a, b) => a - b),
  });
}

/** Calendar YYYY-MM-DD in local TZ — same basis as the subtable "Date" column (dueDate ?? planDate). */
function paymentPlanRowDateYmd(row: PaymentRow): string | null {
  const raw = row.dueDate ?? row.planDate;
  if (raw == null || !String(raw).trim()) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function filterPaymentPlanRowsByPlanDate(
  rows: PaymentRow[],
  fromYmd: string,
  toYmd: string
): PaymentRow[] {
  const from = fromYmd.trim();
  const to = toYmd.trim();
  if (!from && !to) return rows;
  return rows.filter((row) => {
    const ymd = paymentPlanRowDateYmd(row);
    if (!ymd) return false;
    if (from && ymd < from) return false;
    if (to && ymd > to) return false;
    return true;
  });
}

/** Page title. Flags tab uses its own name and icon. */
export const TagsManagerShellTitle: FC<{ mode?: 'tags' | 'flags' }> = ({ mode = 'tags' }) => {
  const flags = mode === 'flags';
  const Icon = flags ? FlagIcon : TagIcon;
  return (
    <div className="min-w-0 pr-2 flex items-center gap-3">
      <Icon className="w-8 h-8 shrink-0 text-primary" aria-hidden />
      <h3 className="text-2xl font-bold text-gray-900 dark:text-white">{flags ? 'Flags manager' : 'Tags manager'}</h3>
    </div>
  );
};

function tagNameFromRow(row: JunctionRow): string {
  const rel = row.misc_leadtag as any;
  if (Array.isArray(rel)) return String(rel[0]?.name ?? '').trim() || '—';
  return String(rel?.name ?? '').trim() || '—';
}

function employeePhotoFromEmp(emp: {
  photo_url?: string | null;
  photo?: string | null;
} | null | undefined): string | null {
  if (!emp || typeof emp !== 'object') return null;
  const a = emp.photo_url;
  const b = emp.photo;
  const s = (typeof a === 'string' && a.trim()) || (typeof b === 'string' && b.trim()) || '';
  return s || null;
}

function employeeDisplayFromRow(row: JunctionRow): { name: string; avatarUrl: string | null } {
  const rel = row.tenants_employee as JunctionRow['tenants_employee'] | JunctionRow['tenants_employee'][] | null;
  const emp = Array.isArray(rel) ? rel[0] : rel;
  if (!emp) return { name: '—', avatarUrl: null };
  const n = emp.display_name;
  const name = n != null && String(n).trim() ? String(n).trim() : '—';
  return { name, avatarUrl: employeePhotoFromEmp(emp) };
}

function initialsFromDisplayName(name: string): string {
  const t = name.trim();
  if (!t || t === '—') return '?';
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  if (parts[0].length >= 2) return parts[0].slice(0, 2).toUpperCase();
  return parts[0].toUpperCase();
}

/** Stable hue for avatar gradient (per employee id, or from name if id missing). */
function stableHueForAvatar(employeeId: number | null | undefined, label: string): number {
  if (employeeId != null && Number.isFinite(employeeId)) {
    return Math.abs(Math.trunc(employeeId)) * 47 % 360;
  }
  let h = 0;
  const s = label || '?';
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

type AvatarSize = 'sm' | 'md' | 'lg';

/** Photo when valid; on error or no URL — gradient circle with initials (employee filter + table). */
function EmployeeAvatarCircle({
  label,
  photoUrl,
  employeeId,
  size,
}: {
  label: string;
  photoUrl: string | null | undefined;
  employeeId?: number | null;
  size: AvatarSize;
}) {
  const [imgErr, setImgErr] = useState(false);
  const url = typeof photoUrl === 'string' ? photoUrl.trim() : '';
  const showPhoto = url.length > 0 && !imgErr;

  const dim = size === 'sm' ? 'w-6 h-6' : size === 'md' ? 'w-9 h-9' : 'w-10 h-10';
  const textSz =
    size === 'sm' ? 'text-[10px] leading-none' : size === 'md' ? 'text-xs leading-none' : 'text-sm leading-none';

  const hue = stableHueForAvatar(employeeId ?? null, label);
  const hue2 = (hue + 32) % 360;
  const bg = `linear-gradient(145deg, hsl(${hue} 58% 46%), hsl(${hue2} 52% 36%))`;

  if (showPhoto) {
    return (
      <img
        src={url}
        alt=""
        className={`${dim} rounded-full object-cover shrink-0 shadow-sm ring-2 ring-base-100 dark:ring-base-300/60`}
        onError={() => setImgErr(true)}
      />
    );
  }

  return (
    <span
      className={`${dim} rounded-full shrink-0 flex items-center justify-center font-bold tracking-tight text-white shadow-md ring-2 ring-inset ring-white/25 ${textSz}`}
      style={{ background: bg }}
      aria-hidden
    >
      {initialsFromDisplayName(label)}
    </span>
  );
}

function FilterDateInput({
  value,
  onChange,
  min,
  max,
  title,
  className = 'min-w-0 flex-1',
  inputClassName = 'input input-bordered input-sm md:input-md w-full min-w-0 bg-base-100',
}: {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  title?: string;
  className?: string;
  inputClassName?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <input
        type="date"
        className={`${inputClassName} ${value ? 'pr-8' : ''}`}
        value={value}
        min={min}
        max={max}
        title={title}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button
          type="button"
          className="btn btn-ghost btn-circle btn-xs absolute right-1 top-1/2 z-[1] -translate-y-1/2"
          aria-label="Clear date"
          onClick={() => onChange('')}
        >
          <XMarkIcon className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
/** Local calendar day → ISO bounds for `tagged_at` filtering. */
function taggedAtRangeIso(fromDate: string, toDate: string): { gte?: string; lte?: string } {
  const out: { gte?: string; lte?: string } = {};
  const from = fromDate.trim();
  const to = toDate.trim();
  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  if (from && ymd.test(from)) {
    const [y, m, d] = from.split('-').map(Number);
    out.gte = new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
  }
  if (to && ymd.test(to)) {
    const [y, m, d] = to.split('-').map(Number);
    out.lte = new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
  }
  return out;
}

function applyTaggedAtRange<T extends { gte: (c: string, v: string) => T; lte: (c: string, v: string) => T }>(
  query: T,
  fromDate: string,
  toDate: string,
  column = 'tagged_at'
): T {
  const { gte, lte } = taggedAtRangeIso(fromDate, toDate);
  let q = query;
  if (gte) q = q.gte(column, gte);
  if (lte) q = q.lte(column, lte);
  return q;
}

function newLeadUuidFromRow(row: JunctionRow): string | null {
  const a = row.newlead_id != null && String(row.newlead_id).trim() ? String(row.newlead_id).trim() : '';
  return a || null;
}

function currencyLabelFromLead(
  currencyId: unknown,
  acJoin: unknown,
  currencyMap: Map<number, string>,
  balanceCurrencyFallback?: string | null
): string {
  const ac = Array.isArray(acJoin) ? acJoin[0] : acJoin;
  if (ac && typeof ac === 'object' && (ac as { name?: string }).name) {
    const n = String((ac as { name?: string }).name).trim();
    if (n) return n;
  }
  const idNum = Number(currencyId ?? 1);
  if (currencyMap.has(idNum)) return currencyMap.get(idNum)!;
  if (balanceCurrencyFallback && String(balanceCurrencyFallback).trim()) return String(balanceCurrencyFallback).trim();
  return '₪';
}

/**
 * Mirrors ClientHeader total-value math (main amount after subcontractor; VAT line uses base before sub for rates).
 */
function computeTotalDisplayParts(
  lead: Record<string, unknown> | null | undefined,
  isLegacy: boolean
): { main: number; vat: number; showVat: boolean } {
  if (!lead) return { main: 0, vat: 0, showVat: false };

  let baseAmount: number;
  if (isLegacy) {
    const currencyIdNum = Number(lead.currency_id ?? 1);
    baseAmount =
      currencyIdNum === 1 ? Number(lead.total_base ?? 0) : Number(lead.total ?? 0);
  } else {
    baseAmount = Number(lead.balance ?? lead.proposal_total ?? 0);
  }

  const subcontractorFee = Number(lead.subcontractor_fee ?? 0);
  const mainAmount = baseAmount - subcontractorFee;

  let shouldShowVat = true;
  const vatValue = lead.vat;
  if (vatValue !== null && vatValue !== undefined) {
    const vatStr = String(vatValue).toLowerCase().trim();
    if (vatStr === 'false' || vatStr === '0' || vatStr === 'no' || vatStr === 'excluded') shouldShowVat = false;
  }

  let vatAmount = 0;
  if (shouldShowVat) {
    if (isLegacy) {
      vatAmount = baseAmount * 0.18;
    } else {
      vatAmount =
        lead.vat_value != null && Number(lead.vat_value) > 0
          ? Number(lead.vat_value)
          : baseAmount * 0.18;
    }
  }

  return { main: mainAmount, vat: vatAmount, showVat: shouldShowVat && vatAmount > 0 };
}

function formatMoney(cur: string, n: number): string {
  return `${cur}${Number(n.toFixed(2)).toLocaleString()}`;
}

/** Same as Clients list / header: legacy number is not always in `lead_number`. */
function legacyLeadDisplayNumber(lead: Record<string, unknown>): string {
  const number = readableLeadNumber(lead.lead_number, lead.manual_id);
  if (number) return number;
  if (lead.id != null && String(lead.id).trim() !== '') return String(lead.id);
  return '—';
}

const LEAD_NUMBER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readableLeadNumber(...values: unknown[]): string {
  for (const value of values) {
    const text = value != null ? String(value).trim() : '';
    if (!text || LEAD_NUMBER_UUID.test(text)) continue;
    return text;
  }
  return '';
}

function newLeadDisplayNumber(lead: Record<string, unknown>): string {
  const number = readableLeadNumber(lead.lead_number, lead.manual_id, lead.display_lead_number);
  return number || '—';
}

/**
 * Same rules as LeadSearchPage.handleLeadClick: legacy → /clients/{leads_lead.id};
 * new → manual_id / sublead ?lead= / lead_number / id.
 */
function clientsPathForTagsRow(
  isLegacy: boolean,
  lead: Record<string, unknown> | null,
  legacyLeadId: number | null
): string | null {
  if (isLegacy) {
    const id =
      legacyLeadId != null && Number.isFinite(legacyLeadId) ? String(Math.trunc(legacyLeadId)) : '';
    if (!id) return null;
    return `/clients/${encodeURIComponent(id)}`;
  }
  if (!lead) return null;

  const displayLeadNumber = (lead as { display_lead_number?: unknown }).display_lead_number;
  let leadNumber = '';
  if (displayLeadNumber != null && String(displayLeadNumber).trim() !== '') {
    leadNumber = String(displayLeadNumber).trim();
  } else if (lead.lead_number != null && String(lead.lead_number).trim() !== '') {
    leadNumber = String(lead.lead_number).trim();
  } else if (lead.id != null && String(lead.id).trim() !== '') {
    leadNumber = String(lead.id).trim();
  }

  const manualRaw = lead.manual_id != null ? String(lead.manual_id).trim() : '';
  const manualId = manualRaw !== '' ? manualRaw : null;
  const leadId = lead.id != null ? String(lead.id).trim() : '';

  if (!leadNumber && !leadId) return null;

  const isSubLead = leadNumber.includes('/');

  if (isSubLead && manualId) {
    return `/clients/${encodeURIComponent(manualId)}?lead=${encodeURIComponent(leadNumber)}`;
  }
  if (isSubLead && !manualId) {
    const baseNumber = leadNumber.split('/')[0];
    return `/clients/${encodeURIComponent(baseNumber)}?lead=${encodeURIComponent(leadNumber)}`;
  }
  const identifier = manualId || leadNumber || leadId;
  return `/clients/${encodeURIComponent(identifier)}`;
}

type TagOption = { id: number; name: string };
type EmployeeOption = {
  id: number;
  display_name: string | null;
  photo_url?: string | null;
  photo?: string | null;
};

type PickerOption = {
  id: number;
  label: string;
  avatarUrl?: string | null;
  icon?: React.ReactNode;
};

function EmployeeTagCell({
  name,
  avatarUrl,
  employeeId,
}: {
  name: string;
  avatarUrl: string | null;
  employeeId?: number | null;
}) {
  if (employeeId == null) {
    return <span className="text-sm text-base-content/60">—</span>;
  }
  return (
    <span className="inline-flex items-center gap-2 min-w-0 text-sm">
      <EmployeeAvatarCircle label={name} photoUrl={avatarUrl} employeeId={employeeId} size="md" />
      <span className="truncate">{name}</span>
    </span>
  );
}

/** Search field first; dropdown below with checkboxes for multiple IDs. */
function MultiIdPicker({
  label,
  placeholder,
  options,
  selectedIds,
  onChange,
  showOptionAvatars,
}: {
  label: string;
  placeholder: string;
  options: PickerOption[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  showOptionAvatars?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [typingUnlocked, setTypingUnlocked] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const q = search.trim().toLowerCase();
  const selectedSet = new Set(selectedIds);
  const selectedOptions = options.filter((o) => selectedSet.has(o.id));
  const filtered = options.filter((o) => !selectedSet.has(o.id) && o.label.toLowerCase().includes(q));
  const chosenCount = selectedIds.length;

  const toggle = (id: number) => {
    if (selectedIds.includes(id)) onChange(selectedIds.filter((x) => x !== id));
    else {
      onChange([...selectedIds, id].sort((a, b) => a - b));
      setSearch('');
    }
  };

  const inputPlaceholder = search === '' && chosenCount > 0 ? `${chosenCount} chosen` : placeholder;

  return (
    <div ref={ref} className="relative w-full min-w-[220px] max-w-sm">
      <div className="label justify-between py-1">
        <span className="label-text font-medium">{label}</span>
      </div>
      <form autoComplete="off" onSubmit={(event) => event.preventDefault()} className="relative">
        <input
          type="search"
          name="list-filter"
          inputMode="search"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-1p-ignore="true"
          data-lpignore="true"
          data-form-type="other"
          aria-autocomplete="none"
          readOnly={!typingUnlocked}
          onPointerDown={(event) => {
            event.currentTarget.readOnly = false;
            setTypingUnlocked(true);
          }}
          className={`input input-bordered input-sm md:input-md w-full bg-base-100 [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden ${
            chosenCount > 0 ? 'pr-16' : search ? 'pr-8' : ''
          }`}
          placeholder={inputPlaceholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onFocus={() => setOpen(true)}
          aria-expanded={open}
          aria-haspopup="listbox"
        />
        {chosenCount > 0 && (
          <span className="pointer-events-none absolute right-8 top-1/2 -translate-y-1/2 badge badge-primary badge-sm">
            {chosenCount}
          </span>
        )}
        {(chosenCount > 0 || search) && (
          <button
            type="button"
            className="btn btn-ghost btn-circle btn-xs absolute right-1 top-1/2 z-[1] -translate-y-1/2"
            aria-label="Clear filter"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onChange([]);
              setSearch('');
            }}
          >
            <XMarkIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </form>
      {open && (
        <div
          className="absolute left-0 right-0 top-full z-[100] mt-1 max-h-72 overflow-y-auto rounded-lg border border-base-300 bg-base-100 shadow-lg"
          role="listbox"
        >
          {selectedOptions.length > 0 && (
            <div className="border-b border-base-200 bg-base-200/40 p-2">
              <p className="mb-1 text-xs font-medium text-base-content/60">{chosenCount} chosen</p>
              <div className="flex flex-wrap gap-1">
                {selectedOptions.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    className="badge badge-primary gap-1.5 pr-1.5 h-auto min-h-8 py-1 text-sm"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => toggle(o.id)}
                  >
                    {o.icon}
                    {showOptionAvatars && (
                      <EmployeeAvatarCircle label={o.label} photoUrl={o.avatarUrl} employeeId={o.id} size="sm" />
                    )}
                    {o.label}
                    <XMarkIcon className="h-4 w-4 shrink-0" aria-hidden />
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-sm text-base-content/50">
                {q ? 'No matches' : 'No more to add'}
              </div>
            ) : (
              filtered.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm hover:bg-base-200"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => toggle(o.id)}
                >
                  {o.icon}
                  {showOptionAvatars && (
                    <EmployeeAvatarCircle label={o.label} photoUrl={o.avatarUrl} employeeId={o.id} size="md" />
                  )}
                  <span className="truncate">{o.label}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PlanPaymentDateFilter({
  fromDate,
  toDate,
  onChange,
}: {
  fromDate: string;
  toDate: string;
  onChange: (next: { fromDate: string; toDate: string }) => void;
}) {
  const active = Boolean(fromDate.trim() || toDate.trim());
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        className={`btn btn-circle btn-sm md:btn-md h-10 w-10 min-h-10 min-w-10 rounded-full border-0 p-0 shadow-sm ring-1 ring-gray-200 ${
          open || active ? 'bg-primary text-primary-content' : 'bg-white text-gray-700 hover:bg-gray-100'
        }`}
        aria-expanded={open}
        aria-label="Plan payment dates"
        title="Plan payment dates"
        onClick={() => setOpen((value) => !value)}
      >
        <FunnelIcon className="h-5 w-5" />
      </button>
      {active && !open && (
        <span className="pointer-events-none absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-[#ececec]" />
      )}
      {open && (
        <div className="absolute right-0 top-full z-[80] mt-2 w-[min(100vw-2rem,22rem)] rounded-2xl bg-white p-3 shadow-lg ring-1 ring-gray-100">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-gray-900">Plan payment dates</p>
            {active && (
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={() => onChange({ fromDate: '', toDate: '' })}
              >
                Clear
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="form-control min-w-0">
              <span className="label-text mb-1 text-xs">From</span>
              <FilterDateInput
                value={fromDate}
                max={toDate || undefined}
                title="Filters the Date column in expanded outstanding payment plans"
                inputClassName="input input-bordered input-sm w-full min-w-0 bg-base-100"
                onChange={(next) => onChange({ fromDate: next, toDate })}
              />
            </label>
            <label className="form-control min-w-0">
              <span className="label-text mb-1 text-xs">To</span>
              <FilterDateInput
                value={toDate}
                min={fromDate || undefined}
                title="Filters the Date column in expanded outstanding payment plans"
                inputClassName="input input-bordered input-sm w-full min-w-0 bg-base-100"
                onChange={(next) => onChange({ fromDate, toDate: next })}
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

type ExpandLeadParam = { kind: 'new'; uuid: string } | { kind: 'legacy'; id: number };

type TagsManagerSortKey = 'total' | 'remaining' | 'applicants' | 'taggedAt';

type TagsManagerTableRow = {
  key: string;
  tag: string;
  leadLabel: string;
  stage: unknown;
  expandLead: ExpandLeadParam | null;
  clientsPath: string | null;
  totalStr: string;
  remainingStr: string;
  applicants: string | number;
  taggedBy: string;
  taggedByAvatarUrl: string | null;
  taggedByEmployeeId: number | null;
  taggedAt: string;
  stableIndex: number;
  /** NIS-equivalent (via `convertToNIS` + lead `currency_id`) for cross-currency sort */
  sortTotal: number;
  /** NIS-equivalent unpaid gross for cross-currency sort */
  sortRemaining: number;
  sortApplicants: number | null;
  taggedAtMs: number;
};

function LeadStageBadge({ stage, ready }: { stage: unknown; ready: boolean }) {
  if (stage == null || String(stage).trim() === '') {
    return <span className="text-sm text-base-content/40">—</span>;
  }
  const stageId = String(stage);
  const name = (ready ? getStageName : getStageName)(stageId);
  const soft = getSoftStageBadgeStyle(getStageColour(stageId), stageId);
  return (
    <span
      className="inline-flex max-w-[11rem] truncate rounded-full border px-2.5 py-1 text-xs font-semibold"
      style={{ backgroundColor: soft.backgroundColor, borderColor: soft.borderColor, color: soft.color }}
      title={name}
    >
      {name}
    </span>
  );
}

function compareTagsManagerRows(
  a: TagsManagerTableRow,
  b: TagsManagerTableRow,
  sortKey: TagsManagerSortKey,
  sortDir: 'asc' | 'desc'
): number {
  const mul = sortDir === 'asc' ? 1 : -1;
  const tie = a.stableIndex - b.stableIndex;
  switch (sortKey) {
    case 'total': {
      const d = a.sortTotal - b.sortTotal;
      return d !== 0 ? d * mul : tie;
    }
    case 'remaining': {
      const d = a.sortRemaining - b.sortRemaining;
      return d !== 0 ? d * mul : tie;
    }
    case 'applicants': {
      const va = a.sortApplicants;
      const vb = b.sortApplicants;
      if (va == null && vb == null) return tie;
      if (va == null) return 1;
      if (vb == null) return -1;
      const d = va - vb;
      return d !== 0 ? d * mul : tie;
    }
    case 'taggedAt': {
      const d = a.taggedAtMs - b.taggedAtMs;
      return d !== 0 ? d * mul : tie;
    }
    default:
      return tie;
  }
}

/**
 * Sticky header cells — vertical scroll is on `.app-main-scroll` (main), not an inner wrapper.
 * Do not wrap this table in `overflow-x-auto`; that creates a nested scrollport and breaks sticky.
 */
const TAGS_MANAGER_TH_STICKY =
  'sticky top-0 z-[31] bg-white border-b border-gray-200 align-middle';

function TagsManagerSortTh({
  label,
  column,
  align,
  activeKey,
  sortDir,
  onSort,
  summaryFooter,
}: {
  label: string;
  column: TagsManagerSortKey;
  align: 'left' | 'right';
  activeKey: TagsManagerSortKey | null;
  sortDir: 'asc' | 'desc';
  onSort: (k: TagsManagerSortKey) => void;
  /** Second line under title (e.g. column sum). */
  summaryFooter?: string;
}) {
  const active = activeKey === column;
  const end = align === 'right';
  return (
    <th
      scope="col"
      className={`text-sm ${TAGS_MANAGER_TH_STICKY} ${end ? 'text-right' : ''}`}
    >
      <div className={`flex min-w-0 flex-col gap-1 py-0.5 ${end ? 'items-end' : 'items-start'}`}>
        <button
          type="button"
          className={`inline-flex w-full min-w-0 items-center gap-0.5 font-semibold hover:text-primary ${
            end ? 'justify-end text-right' : 'justify-start text-left'
          }`}
          onClick={() => onSort(column)}
          aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
        >
          <span className="truncate">{label}</span>
          <span className="inline-flex shrink-0 text-primary" aria-hidden>
            {active ? (
              sortDir === 'asc' ? (
                <ChevronUpIcon className="w-4 h-4" />
              ) : (
                <ChevronDownIcon className="w-4 h-4" />
              )
            ) : (
              <span className="inline-flex flex-col opacity-40">
                <ChevronUpIcon className="-mb-1 w-3 h-3" />
                <ChevronDownIcon className="w-3 h-3" />
              </span>
            )}
          </span>
        </button>
        {summaryFooter != null && summaryFooter !== '' && (
          <span
            className="block w-full max-w-[min(100%,14rem)] text-[11px] sm:text-xs font-semibold tabular-nums tracking-tight text-base-content/75 leading-tight"
            title="Sum of displayed rows (NIS equivalent)"
          >
            {summaryFooter}
          </span>
        )}
      </div>
    </th>
  );
}

function tagsPaymentAmountInNis(row: PaymentRow): string {
  let c = row.currency || 'NIS';
  if (c === '₪') c = 'NIS';
  else if (c === '€') c = 'EUR';
  else if (c === '$') c = 'USD';
  else if (c === '£') c = 'GBP';
  const valueInNIS = convertToNIS(row.value, c);
  const vatInNIS = convertToNIS(row.vat, c);
  return formatCurrency(valueInNIS + vatInNIS, '₪');
}

/** Same columns as Collection Finances report; read-only (no inline handler/notes edit). */
function TagsManagerPaymentPlanSubtable({
  rows,
  loading,
  loadError,
  planDateFilterActive,
  fetchedRowCount,
}: {
  rows: PaymentRow[];
  loading: boolean;
  loadError: boolean;
  /** True when plan-date from/to filters are set (may hide every row). */
  planDateFilterActive: boolean;
  /** Count before plan-date filter; used when filter excludes all rows. */
  fetchedRowCount: number;
}) {
  if (loading) {
    return (
      <div className="flex justify-center py-6 bg-base-200/40">
        <span className="loading loading-spinner loading-md" />
      </div>
    );
  }
  if (loadError) {
    return <p className="text-error text-sm py-4 px-3">Could not load payment plans.</p>;
  }
  if (rows.length === 0) {
    const noRowsMatchPlanDate =
      planDateFilterActive && fetchedRowCount > 0;
    return (
      <p className="text-base-content/60 text-sm py-4 px-3">
        {noRowsMatchPlanDate
          ? 'No rows match the plan date filter. Adjust or clear the plan date fields in the filters above.'
          : 'No outstanding payment plan rows (unpaid) for this lead.'}
      </p>
    );
  }
  return (
    <div className="overflow-x-auto bg-base-200/30 border-t border-base-300">
      {/*
        Avoid DaisyUI `table` class here: nested inside the main `.table` it matches global
        tbody/tr hover rules so every nested row highlights together.
      */}
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-base-300 bg-base-200">
            <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">Lead Name</th>
            <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">Client</th>
            <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">Amount</th>
            <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">Amount (in NIS)</th>
            <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">Order</th>
            <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">Collected</th>
            <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">Date</th>
            <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">Proforma Date</th>
            <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">Handler</th>
            <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">Case</th>
            <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">Category</th>
            <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className="border-b border-base-300/50 transition-colors hover:bg-base-300/45 dark:hover:bg-neutral-700/35"
            >
              <td className="px-3 py-2 align-middle text-black dark:text-white">{row.leadName}</td>
              <td className="px-3 py-2 align-middle">{row.clientName || row.leadName || '—'}</td>
              <td className="px-3 py-2 align-middle font-semibold">
                {formatCurrency(row.value, row.currency)}
                {row.vat > 0 && (
                  <span className="text-base-content/60 ml-1">+ {formatCurrency(row.vat, row.currency)}</span>
                )}
              </td>
              <td className="px-3 py-2 align-middle font-semibold">{tagsPaymentAmountInNis(row)}</td>
              <td className="px-3 py-2 align-middle">{row.orderLabel || '—'}</td>
              <td className="px-3 py-2 align-middle">
                {row.collected ? (
                  <span className="inline-flex items-center gap-2 text-green-600 font-semibold">
                    <CheckCircleIcon className="w-5 h-5" />
                    {row.hasProforma ? 'Collected - With Proforma' : 'Collected - Without Proforma'}
                  </span>
                ) : row.hasProforma ? (
                  <span className="inline-flex items-center gap-2 text-yellow-600 font-semibold">
                    <ExclamationTriangleIcon className="w-5 h-5" />
                    Pending (Proforma)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-2 text-red-600 font-semibold">
                    <XCircleIcon className="w-5 h-5" />
                    Pending
                  </span>
                )}
              </td>
              <td className="px-3 py-2 align-middle">
                {(() => {
                  const displayDate = row.dueDate ?? row.planDate;
                  return displayDate ? new Date(displayDate).toLocaleDateString() : '—';
                })()}
              </td>
              <td className="px-3 py-2 align-middle">
                {row.proformaDate ? new Date(row.proformaDate).toLocaleDateString() : '—'}
              </td>
              <td className="px-3 py-2 align-middle">{row.handlerName || '—'}</td>
              <td className="px-3 py-2 align-middle">{row.caseNumber || '—'}</td>
              <td className="px-3 py-2 align-middle">{row.categoryName || '—'}</td>
              <td className="px-3 py-2 align-middle max-w-xs truncate" title={row.notes || ''}>
                {row.notes || '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type MineRequest = { nonce: number; include: boolean };

function employeeIdsWithMine(ids: number[], employeeId: number, include: boolean): number[] {
  if (include) return ids.includes(employeeId) ? ids : [...ids, employeeId].sort((a, b) => a - b);
  return ids.filter((id) => id !== employeeId);
}

type ManagerMineProps = {
  dateSlot?: HTMLElement | null;
  loggedInEmployeeId?: number | null;
  employeeResolved?: boolean;
  /** Toggle the signed-in employee in the employee filter. */
  mineRequest?: MineRequest | null;
  onEmployeeIds?: (ids: number[]) => void;
};

export default function TagsManagerReport({
  dateSlot = null,
  loggedInEmployeeId = null,
  employeeResolved = false,
  mineRequest = null,
  onEmployeeIds,
}: ManagerMineProps) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [filters, setFilters] = usePersistedFilters<TagsManagerFilterState>('tagsManager_filters_v2', {
    taggedFromDate: '',
    taggedToDate: '',
    paymentPlanFromDate: '',
    paymentPlanToDate: '',
    filterTagIds: [],
    filterEmployeeIds: [],
    mineDefaultPending: true,
  }, { storage: 'sessionStorage' });

  const {
    taggedFromDate,
    taggedToDate,
    paymentPlanFromDate = '',
    paymentPlanToDate = '',
    filterTagIds,
    filterEmployeeIds,
    mineDefaultPending = false,
  } = filters;

  useEffect(() => {
    onEmployeeIds?.(filterEmployeeIds);
  }, [filterEmployeeIds, onEmployeeIds]);

  useEffect(() => {
    if (!mineDefaultPending || !employeeResolved) return;
    setFilters((current) => ({
      ...current,
      mineDefaultPending: false,
      filterEmployeeIds: loggedInEmployeeId != null ? [loggedInEmployeeId] : current.filterEmployeeIds,
    }));
  }, [mineDefaultPending, employeeResolved, loggedInEmployeeId, setFilters]);

  useEffect(() => {
    if (!mineRequest?.nonce || loggedInEmployeeId == null) return;
    const include = mineRequest.include;
    setFilters((current) => ({
      ...current,
      mineDefaultPending: false,
      filterEmployeeIds: employeeIdsWithMine(current.filterEmployeeIds || [], loggedInEmployeeId, include),
    }));
  }, [mineRequest, loggedInEmployeeId, setFilters]);

  const [reportData, setReportData] = usePersistedState<TagsManagerPersistedReport | null>(
    'tagsManager_report',
    null,
    { storage: 'sessionStorage' }
  );

  const filterSig = useMemo(
    () =>
      tagsManagerReportFetchSignature({
        taggedFromDate,
        taggedToDate,
        filterTagIds,
        filterEmployeeIds,
      }),
    [taggedFromDate, taggedToDate, filterTagIds, filterEmployeeIds]
  );

  const rows = reportData?.rows ?? [];
  const newLeadMap = useMemo(() => new Map(reportData?.newLeadEntries ?? []), [reportData]);
  const legacyLeadMap = useMemo(() => new Map(reportData?.legacyEntries ?? []), [reportData]);
  const unpaidMap = useMemo(() => new Map(reportData?.unpaidEntries ?? []), [reportData]);

  const [tagOptions, setTagOptions] = useState<TagOption[]>([]);
  const [employeeOptions, setEmployeeOptions] = useState<EmployeeOption[]>([]);

  const [expandedRowKey, setExpandedRowKey] = useState<string | null>(null);
  const [paymentRowsByRowKey, setPaymentRowsByRowKey] = useState<Map<string, PaymentRow[]>>(new Map());
  const [paymentLoadingKey, setPaymentLoadingKey] = useState<string | null>(null);
  const [paymentErrorKey, setPaymentErrorKey] = useState<string | null>(null);

  const hasPaymentPlanDateFilter = Boolean(paymentPlanFromDate.trim() || paymentPlanToDate.trim());

  const filteredPaymentRowsByRowKey = useMemo(() => {
    if (!hasPaymentPlanDateFilter) return paymentRowsByRowKey;
    const out = new Map<string, PaymentRow[]>();
    for (const [k, arr] of paymentRowsByRowKey.entries()) {
      out.set(k, filterPaymentPlanRowsByPlanDate(arr, paymentPlanFromDate, paymentPlanToDate));
    }
    return out;
  }, [paymentRowsByRowKey, hasPaymentPlanDateFilter, paymentPlanFromDate, paymentPlanToDate]);

  const [currencyBootstrap, setCurrencyBootstrap] = useState<Map<number, string>>(new Map());

  const loadFilterOptions = useCallback(async () => {
    const [tagsRes, empRes] = await Promise.all([
      supabase.from('misc_leadtag').select('id, name').order('name', { ascending: true }),
      supabase
        .from('tenants_employee')
        .select('id, display_name, photo_url, photo')
        .order('display_name', { ascending: true }),
    ]);
    if (!tagsRes.error && tagsRes.data) {
      setTagOptions(
        (tagsRes.data as TagOption[]).filter((t) => t.name && String(t.name).trim())
      );
    }
    if (!empRes.error && empRes.data) {
      setEmployeeOptions(empRes.data as EmployeeOption[]);
    }
  }, []);

  const loadCurrencies = useCallback(async (): Promise<Map<number, string>> => {
    const m = new Map<number, string>();
    const { data, error: err } = await supabase.from('accounting_currencies').select('id, name');
    if (err || !data) {
      setCurrencyBootstrap(m);
      return m;
    }
    for (const c of data as { id?: number; name?: string }[]) {
      const id = Number(c.id);
      if (Number.isFinite(id) && c.name) m.set(id, String(c.name).trim());
    }
    setCurrencyBootstrap(m);
    return m;
  }, []);

  const currencyMap = useMemo(() => {
    const fromReport = reportData?.currencyEntries;
    if (fromReport && fromReport.length > 0) return new Map(fromReport);
    return currencyBootstrap;
  }, [reportData?.currencyEntries, currencyBootstrap]);

  const runFetchReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    setExpandedRowKey(null);
    setPaymentRowsByRowKey(new Map());
    setPaymentLoadingKey(null);
    setPaymentErrorKey(null);
    const sig = tagsManagerReportFetchSignature({
      taggedFromDate,
      taggedToDate,
      filterTagIds,
      filterEmployeeIds,
    });
    try {
      let q = supabase
        .from('leads_lead_tags')
        .select(
          `
          id,
          lead_id,
          newlead_id,
          leadtag_id,
          employee_id,
          tagged_at,
          misc_leadtag ( id, name ),
          tenants_employee ( id, display_name, photo_url, photo )
        `
        )
        .order('tagged_at', { ascending: false, nullsFirst: false })
        .limit(4000);

      if (filterTagIds.length > 0) q = q.in('leadtag_id', filterTagIds);
      if (filterEmployeeIds.length > 0) q = q.in('employee_id', filterEmployeeIds);
      q = applyTaggedAtRange(q, taggedFromDate, taggedToDate);

      const { data: junctionData, error: jErr } = await q;

      let dataForBatch: JunctionRow[] = [];

      if (jErr) {
        const msg = jErr.message || String(jErr);
        if (msg.includes('tenants_employee') || msg.includes('schema cache')) {
          let q2 = supabase
            .from('leads_lead_tags')
            .select(
              `
              id,
              lead_id,
              newlead_id,
              leadtag_id,
              employee_id,
              tagged_at,
              misc_leadtag ( id, name )
            `
            )
            .order('tagged_at', { ascending: false, nullsFirst: false })
            .limit(4000);
          if (filterTagIds.length > 0) q2 = q2.in('leadtag_id', filterTagIds);
          if (filterEmployeeIds.length > 0) q2 = q2.in('employee_id', filterEmployeeIds);
          q2 = applyTaggedAtRange(q2, taggedFromDate, taggedToDate);
          const { data: j2, error: e2 } = await q2;
          if (e2) throw e2;
          const baseRows = (j2 || []) as JunctionRow[];
          const empIds = [
            ...new Set(
              baseRows
                .map((r) => r.employee_id)
                .filter((id): id is number => id != null && Number.isFinite(Number(id)))
                .map((id) => Number(id))
            ),
          ];
          const empById = new Map<
            number,
            { display_name: string; photo_url: string | null; photo: string | null }
          >();
          if (empIds.length) {
            const { data: emps } = await supabase
              .from('tenants_employee')
              .select('id, display_name, photo_url, photo')
              .in('id', empIds);
            for (const e of (emps || []) as {
              id: number;
              display_name: string | null;
              photo_url?: string | null;
              photo?: string | null;
            }[]) {
              empById.set(Number(e.id), {
                display_name: e.display_name || '',
                photo_url: e.photo_url ?? null,
                photo: e.photo ?? null,
              });
            }
          }
          const enriched = baseRows.map((r) => {
            const empId = r.employee_id != null ? Number(r.employee_id) : NaN;
            const row = Number.isFinite(empId) ? empById.get(empId) : undefined;
            return {
              ...r,
              tenants_employee:
                row != null
                  ? {
                      id: r.employee_id!,
                      display_name: row.display_name,
                      photo_url: row.photo_url,
                      photo: row.photo,
                    }
                  : null,
            };
          });
          dataForBatch = enriched;
        } else {
          throw jErr;
        }
      } else {
        dataForBatch = (junctionData || []) as JunctionRow[];
      }

      const newUuids: string[] = [];
      const legacyIds: number[] = [];
      for (const r of dataForBatch) {
        const nu = newLeadUuidFromRow(r);
        if (nu) newUuids.push(nu);
        else if (r.lead_id != null) {
          const lid = Number(r.lead_id);
          if (Number.isFinite(lid)) legacyIds.push(lid);
        }
      }

      const uniqNew = [...new Set(newUuids)];
      const uniqLegacy = [...new Set(legacyIds)];

      const [newLeads, legacyLeads, unpaidBatch] = await Promise.all([
        uniqNew.length ? fetchRowsById('leads', NEW_LEAD_FIELDS, uniqNew) : Promise.resolve([] as Record<string, unknown>[]),
        uniqLegacy.length
          ? fetchRowsById('leads_lead', LEGACY_LEAD_FIELDS, uniqLegacy)
          : Promise.resolve([] as Record<string, unknown>[]),
        fetchUnpaidTotalsBatchByLeadKey(uniqNew, uniqLegacy),
      ]);

      const nm = new Map<string, Record<string, unknown>>();
      for (const L of newLeads) {
        if (L.id != null) nm.set(String(L.id), L);
      }
      const lm = new Map<number, Record<string, unknown>>();
      for (const L of legacyLeads) {
        const id = Number(L.id);
        if (Number.isFinite(id)) lm.set(id, L);
      }

      const curMap = await loadCurrencies();
      setReportData({
        signature: sig,
        rows: dataForBatch,
        newLeadEntries: Array.from(nm.entries()) as [string, Record<string, unknown>][],
        legacyEntries: Array.from(lm.entries()) as [number, Record<string, unknown>][],
        unpaidEntries: Array.from(unpaidBatch.entries()),
        currencyEntries: Array.from(curMap.entries()),
      });
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : 'Failed to load tags report');
      setReportData(null);
    } finally {
      setLoading(false);
    }
  }, [taggedFromDate, taggedToDate, filterTagIds, filterEmployeeIds, loadCurrencies]);

  const togglePaymentExpand = useCallback(async (rowKey: string, expandLead: ExpandLeadParam | null) => {
    if (!expandLead) return;
    if (expandedRowKey === rowKey) {
      setExpandedRowKey(null);
      return;
    }
    setExpandedRowKey(rowKey);
    setPaymentRowsByRowKey((prev) => {
      if (prev.has(rowKey)) return prev;
      void (async () => {
        setPaymentLoadingKey(rowKey);
        setPaymentErrorKey(null);
        try {
          const pr =
            expandLead.kind === 'new'
              ? await fetchOutstandingPaymentPlanRowsForTagsManager({ kind: 'new', leadUuid: expandLead.uuid })
              : await fetchOutstandingPaymentPlanRowsForTagsManager({ kind: 'legacy', legacyId: expandLead.id });
          setPaymentRowsByRowKey((p) => new Map(p).set(rowKey, pr));
        } catch (e) {
          console.error(e);
          setPaymentErrorKey(rowKey);
          setPaymentRowsByRowKey((p) => new Map(p).set(rowKey, []));
        } finally {
          setPaymentLoadingKey((k) => (k === rowKey ? null : k));
        }
      })();
      return prev;
    });
  }, [expandedRowKey]);

  const [stageNamesReady, setStageNamesReady] = useState(false);
  useEffect(() => {
    void loadFilterOptions();
    void loadCurrencies();
    void fetchStageNames().finally(() => setStageNamesReady(true));
  }, [loadFilterOptions, loadCurrencies]);

  const reportDataRef = useRef(reportData);
  reportDataRef.current = reportData;

  useEffect(() => {
    if (reportDataRef.current?.signature === filterSig) return;
    void runFetchReport();
  }, [filterSig, runFetchReport]);

  /** Single object so toggling direction always updates state (React skips re-renders when useState returns the same primitive for sort key). */
  const [sortState, setSortState] = useState<{ key: TagsManagerSortKey; dir: 'asc' | 'desc' } | null>(null);
  const sortKey = sortState?.key ?? null;
  const sortDir = sortState?.dir ?? 'desc';

  const handleSort = useCallback((k: TagsManagerSortKey) => {
    setSortState((prev) => {
      if (!prev || prev.key !== k) return { key: k, dir: 'desc' };
      return { key: k, dir: prev.dir === 'desc' ? 'asc' : 'desc' };
    });
  }, []);

  const tableRows = useMemo(() => {
    return rows.map((row, stableIndex) => {
      const nu = newLeadUuidFromRow(row);
      const isLegacy = !nu && row.lead_id != null;
      const leadKey = nu ? `new:${nu}` : isLegacy ? `legacy:${Number(row.lead_id)}` : '';
      const lead = nu ? newLeadMap.get(nu) : isLegacy ? legacyLeadMap.get(Number(row.lead_id)) : null;

      const currencyLabel = currencyLabelFromLead(
        lead?.currency_id,
        lead?.accounting_currencies,
        currencyMap,
        (lead?.balance_currency as string) || null
      );

      const { main, vat, showVat } = computeTotalDisplayParts(lead, isLegacy);
      const unpaidBy = leadKey ? unpaidMap.get(leadKey) ?? null : null;
      const remainingGross = pickUnpaidAmountForCurrency(unpaidBy, currencyLabel);

      const applicants = isLegacy
        ? lead?.no_of_applicants != null
          ? Number(lead.no_of_applicants)
          : null
        : lead?.number_of_applicants_meeting != null
          ? Number(lead.number_of_applicants_meeting)
          : null;

      const leadLabel =
        lead != null
          ? `${isLegacy ? legacyLeadDisplayNumber(lead) : newLeadDisplayNumber(lead)} · ${String(lead.name ?? '—')}`
          : nu
            ? 'Lead not found'
            : isLegacy
              ? `(missing legacy ${row.lead_id})`
              : '—';

      const totalStr =
        showVat && vat > 0
          ? `${formatMoney(currencyLabel, main)} + ${formatMoney(currencyLabel, vat)} VAT`
          : formatMoney(currencyLabel, main);

      const grossTotal = main + (showVat && vat > 0 ? vat : 0);
      const currencyIdForSort =
        lead?.currency_id != null && Number.isFinite(Number(lead.currency_id))
          ? Number(lead.currency_id)
          : 1;
      /** NIS-equivalent for cross-currency sort (USD/EUR/GBP rank above raw NIS amounts). */
      const sortTotal = convertToNIS(grossTotal, currencyIdForSort);
      const sortRemaining =
        remainingGross > 0 ? convertToNIS(remainingGross, currencyIdForSort) : 0;

      const remainingStr =
        remainingGross > 0 ? formatMoney(currencyLabel, remainingGross) : '—';

      let clientsPath = clientsPathForTagsRow(
        isLegacy,
        lead ?? null,
        isLegacy ? Number(row.lead_id) : null
      );
      if (!clientsPath && nu && !isLegacy) {
        clientsPath = `/clients/${encodeURIComponent(nu)}`;
      }

      const taggedAt =
        row.tagged_at != null && String(row.tagged_at).trim()
          ? new Date(row.tagged_at).toLocaleString()
          : '—';

      const taggedAtMs = (() => {
        if (row.tagged_at == null || !String(row.tagged_at).trim()) return 0;
        const t = Date.parse(String(row.tagged_at));
        return Number.isFinite(t) ? t : 0;
      })();

      const applicantsDisplay =
        applicants != null && Number.isFinite(applicants) && applicants > 0 ? applicants : '—';
      const sortApplicants =
        applicants != null && Number.isFinite(applicants) && applicants > 0 ? applicants : null;

      const { name: taggedBy, avatarUrl: taggedByAvatarUrl } = employeeDisplayFromRow(row);
      const taggedByEmployeeId =
        row.employee_id != null && Number.isFinite(Number(row.employee_id))
          ? Number(row.employee_id)
          : null;

      const expandLead: ExpandLeadParam | null = nu
        ? { kind: 'new', uuid: nu }
        : isLegacy && row.lead_id != null && Number.isFinite(Number(row.lead_id))
          ? { kind: 'legacy', id: Number(row.lead_id) }
          : null;

      return {
        key: `${row.id ?? row.leadtag_id}-${leadKey}-${row.tagged_at}`,
        tag: tagNameFromRow(row),
        leadLabel,
        stage: lead?.stage ?? null,
        expandLead,
        clientsPath,
        totalStr,
        remainingStr,
        applicants: applicantsDisplay,
        taggedBy,
        taggedByAvatarUrl,
        taggedByEmployeeId,
        taggedAt,
        stableIndex,
        sortTotal,
        sortRemaining,
        sortApplicants,
        taggedAtMs,
      } satisfies TagsManagerTableRow;
    });
  }, [rows, newLeadMap, legacyLeadMap, unpaidMap, currencyMap]);

  /** NIS-equivalent sums over all rows currently shown (same basis as sort). */
  const totalValueSumNisFooter = useMemo(() => {
    if (tableRows.length === 0) return '—';
    let s = 0;
    for (const r of tableRows) s += r.sortTotal;
    return `Σ ${formatMoney('₪', s)}`;
  }, [tableRows]);

  const remainingValueSumNisFooter = useMemo(() => {
    if (tableRows.length === 0) return '—';
    let s = 0;
    for (const r of tableRows) s += r.sortRemaining;
    return `Σ ${formatMoney('₪', s)}`;
  }, [tableRows]);

  const sortedTableRows = useMemo(() => {
    if (!sortKey) return tableRows;
    const copy = [...tableRows];
    copy.sort((a, b) => compareTagsManagerRows(a, b, sortKey, sortDir));
    return copy;
  }, [tableRows, sortKey, sortDir]);

  const assignmentCount = tableRows.length;
  const hasTagOrEmployeeFilter = filterTagIds.length > 0 || filterEmployeeIds.length > 0;

  return (
    <div className="space-y-6">
      {dateSlot
        ? createPortal(
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <span className="shrink-0">Tagged from</span>
            <FilterDateInput
              className="w-40 shrink-0"
              value={taggedFromDate}
              max={taggedToDate || undefined}
              onChange={(value) => setFilters((f) => ({ ...f, taggedFromDate: value }))}
            />
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <span className="shrink-0">Tagged to</span>
            <FilterDateInput
              className="w-40 shrink-0"
              value={taggedToDate}
              min={taggedFromDate || undefined}
              onChange={(value) => setFilters((f) => ({ ...f, taggedToDate: value }))}
            />
          </label>
          <PlanPaymentDateFilter
            fromDate={paymentPlanFromDate}
            toDate={paymentPlanToDate}
            onChange={({ fromDate, toDate }) =>
              setFilters((f) => ({ ...f, paymentPlanFromDate: fromDate, paymentPlanToDate: toDate }))
            }
          />
        </div>,
        dateSlot
      )
        : null}

      <div className="flex flex-col lg:flex-row lg:items-end gap-4 flex-wrap">
        <MultiIdPicker
          label="Filter by tag"
          placeholder="Type to search tags…"
          options={tagOptions.map((t) => ({ id: t.id, label: t.name }))}
          selectedIds={filterTagIds}
          onChange={(ids) => setFilters((f) => ({ ...f, filterTagIds: ids }))}
        />
        <MultiIdPicker
          label="Filter by employee"
          placeholder="Type to search employees…"
          options={employeeOptions.map((e) => ({
            id: e.id,
            label: e.display_name?.trim() || `Employee #${e.id}`,
            avatarUrl: employeePhotoFromEmp(e),
          }))}
          selectedIds={filterEmployeeIds}
          onChange={(ids) => setFilters((f) => ({ ...f, filterEmployeeIds: ids }))}
          showOptionAvatars
        />
        <div className="flex flex-wrap items-center gap-3 lg:ml-auto">
          <output
            className="inline-flex items-center gap-2 rounded-lg border border-base-300 bg-base-100 px-3 py-2 text-sm tabular-nums"
            aria-live="polite"
            aria-atomic="true"
          >
            {loading && rows.length === 0 ? (
              <span className="flex items-center gap-2 text-base-content/70">
                <span className="loading loading-spinner loading-sm" />
                Loading…
              </span>
            ) : (
              <>
                <span className="font-semibold text-base-content">{assignmentCount.toLocaleString()}</span>
                <span className="text-base-content/70">
                  {assignmentCount === 1 ? 'assignment' : 'assignments'}
                </span>
                {!hasTagOrEmployeeFilter && (
                  <span className="text-xs text-base-content/50 hidden sm:inline" title="Narrow with tag or employee filters">
                    All tags · all employees
                  </span>
                )}
                {loading && (
                  <span className="flex items-center gap-1 text-xs text-base-content/50" title="Refreshing data">
                    <span className="loading loading-spinner loading-xs" />
                    updating
                  </span>
                )}
              </>
            )}
          </output>
        </div>
      </div>

      {error && (
        <div className="alert alert-error text-sm">
          <span>{error}</span>
        </div>
      )}

      <div className="relative w-full min-w-0 overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-gray-100">
        <table className="table table-sm w-full min-w-max text-sm">
          <thead>
            <tr>
              <th className={`text-sm w-7 px-1 ${TAGS_MANAGER_TH_STICKY}`} aria-label="Expand" />
              <th className={`text-sm ${TAGS_MANAGER_TH_STICKY}`}>Tag</th>
              <th className={`text-sm ${TAGS_MANAGER_TH_STICKY}`}>Lead</th>
              <th className={`text-sm ${TAGS_MANAGER_TH_STICKY}`}>Stage</th>
              <TagsManagerSortTh
                label="Total value (lead)"
                column="total"
                align="right"
                activeKey={sortKey}
                sortDir={sortDir}
                onSort={handleSort}
                summaryFooter={totalValueSumNisFooter}
              />
              <TagsManagerSortTh
                label="Remaining lead value"
                column="remaining"
                align="right"
                activeKey={sortKey}
                sortDir={sortDir}
                onSort={handleSort}
                summaryFooter={remainingValueSumNisFooter}
              />
              <TagsManagerSortTh
                label="Applicants"
                column="applicants"
                align="right"
                activeKey={sortKey}
                sortDir={sortDir}
                onSort={handleSort}
              />
              <th className={`text-sm ${TAGS_MANAGER_TH_STICKY}`}>Tagged by</th>
              <TagsManagerSortTh
                label="Tagged at"
                column="taggedAt"
                align="left"
                activeKey={sortKey}
                sortDir={sortDir}
                onSort={handleSort}
              />
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center py-10">
                  <span className="loading loading-spinner loading-lg" />
                </td>
              </tr>
            ) : tableRows.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center py-8 text-sm text-base-content/60 max-w-lg mx-auto">
                  No tag assignments match the selected dates
                  {hasTagOrEmployeeFilter ? ' and filters' : ''}. Try another date range or clear filters.
                </td>
              </tr>
            ) : (
              sortedTableRows.map((r) => (
                <React.Fragment key={r.key}>
                  <tr
                    className={`hover ${r.expandLead ? 'cursor-pointer' : ''}`}
                    onClick={() => {
                      if (r.expandLead) void togglePaymentExpand(r.key, r.expandLead);
                    }}
                  >
                    <td className="w-7 px-1 align-middle">
                      {r.expandLead ? (
                        <ChevronRightIcon
                          className={`w-5 h-5 text-base-content/60 transition-transform shrink-0 ${
                            expandedRowKey === r.key ? 'rotate-90' : ''
                          }`}
                          aria-hidden
                        />
                      ) : (
                        <span className="inline-block w-5" />
                      )}
                    </td>
                    <td className="font-medium whitespace-nowrap text-sm">{r.tag}</td>
                    <td className="max-w-[220px] p-0">
                      {r.clientsPath ? (
                        <button
                          type="button"
                          className="link link-primary hover:underline text-left text-sm w-full truncate block pl-1 pr-2 py-2 max-w-[220px]"
                          title={r.leadLabel}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (e.metaKey || e.ctrlKey) window.open(r.clientsPath!, '_blank');
                            else navigate(r.clientsPath!);
                          }}
                        >
                          {r.leadLabel}
                        </button>
                      ) : (
                        <span className="text-sm block pl-1 pr-2 py-2 truncate text-base-content/60" title={r.leadLabel}>
                          {r.leadLabel}
                        </span>
                      )}
                    </td>
                    <td className="align-middle whitespace-nowrap">
                      <LeadStageBadge stage={r.stage} ready={stageNamesReady} />
                    </td>
                    <td className="text-right text-sm whitespace-nowrap">{r.totalStr}</td>
                    <td className="text-right text-sm whitespace-nowrap text-amber-800 dark:text-amber-200">
                      {r.remainingStr}
                    </td>
                    <td className="text-right text-sm">{r.applicants}</td>
                    <td className="text-sm max-w-[200px]" onClick={(e) => e.stopPropagation()}>
                      <EmployeeTagCell
                        name={r.taggedBy}
                        avatarUrl={r.taggedByAvatarUrl}
                        employeeId={r.taggedByEmployeeId}
                      />
                    </td>
                    <td className="text-sm whitespace-nowrap">{r.taggedAt}</td>
                  </tr>
                  {expandedRowKey === r.key && r.expandLead && (
                    <tr className="bg-base-200/20 hover:!bg-base-200/20">
                      <td colSpan={9} className="p-0 align-top">
                        <div className="px-2 py-1 border-b border-base-300 bg-base-200/50 text-xs font-semibold text-base-content/70">
                          Outstanding payment plans (unpaid)
                        </div>
                        <TagsManagerPaymentPlanSubtable
                          rows={filteredPaymentRowsByRowKey.get(r.key) ?? []}
                          loading={paymentLoadingKey === r.key}
                          loadError={paymentErrorKey === r.key}
                          planDateFilterActive={hasPaymentPlanDateFilter}
                          fetchedRowCount={(paymentRowsByRowKey.get(r.key) ?? []).length}
                        />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type FlagAssignmentRow = {
  id: string;
  userId: string | null;
  flagTypeId: number;
  createdAt: string | null;
  newLeadId: string | null;
  legacyLeadId: number | null;
  whereLabel: string;
};

type FlagAssignmentDraft = FlagAssignmentRow & {
  channel: ConversationChannel | null;
  externalId: string | null;
  flagKind: string | null;
};

type FlagUserProfile = {
  name: string;
  avatarUrl: string | null;
  employeeId: number | null;
};

type ProbabilityChannel = ConversationChannel;

const PROBABILITY_CHANNEL_OPTIONS: { id: number; channel: ProbabilityChannel; label: string }[] = [
  { id: 1, channel: 'email', label: 'Email' },
  { id: 2, channel: 'whatsapp', label: 'WhatsApp' },
  { id: 3, channel: 'phone', label: 'Phone call' },
  { id: 4, channel: 'manual', label: 'Manual' },
  { id: 5, channel: 'legacy_interaction', label: 'Legacy' },
];

function OutlookChannelIcon({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#0078D4" d="M22 6.5v11c0 .83-.67 1.5-1.5 1.5H17V5h3.5c.83 0 1.5.67 1.5 1.5z" />
      <path fill="#0078D4" d="M16 5H4.5C3.67 5 3 5.67 3 6.5v11c0 .83.67 1.5 1.5 1.5H16V5z" />
      <path fill="#28A8EA" d="M15 12.5 8.5 7.25v10.5L15 12.5z" />
      <ellipse fill="#0078D4" cx="9.5" cy="12.5" rx="3.5" ry="4" />
    </svg>
  );
}

function ProbabilityChannelMark({ channel }: { channel: ProbabilityChannel }) {
  const className = 'h-6 w-6 shrink-0';
  if (channel === 'email') return <OutlookChannelIcon className={className} />;
  if (channel === 'whatsapp') return <FaWhatsapp className={`${className} text-[#25D366]`} aria-hidden />;
  const Icon = channel === 'phone' ? PhoneIcon : channel === 'manual' ? PencilSquareIcon : ArchiveBoxIcon;
  const color = channel === 'phone' ? 'text-violet-600' : channel === 'manual' ? 'text-amber-600' : 'text-slate-600';
  return <Icon className={`${className} ${color}`} aria-hidden />;
}

type FlagsManagerFilterState = {
  flaggedFromDate: string;
  flaggedToDate: string;
  paymentPlanFromDate: string;
  paymentPlanToDate: string;
  filterFlagTypeIds: number[];
  filterEmployeeIds: number[];
  /** Empty means every channel. Any selection narrows Probability flags to those channels. */
  probabilityChannels: ProbabilityChannel[];
  /** First visit selects the signed-in employee, then stays as the user left it. */
  mineDefaultPending?: boolean;
};

type FlagsPersistedReport = {
  signature: string;
  rows: FlagAssignmentRow[];
  newLeadEntries: [string, Record<string, unknown>][];
  legacyEntries: [number, Record<string, unknown>][];
  unpaidEntries: [string, UnpaidByCurrencyMap][];
  currencyEntries: [number, string][];
  userEntries: [string, FlagUserProfile][];
  truncated: boolean;
};

type FlagsTableRow = TagsManagerTableRow & { whereLabel: string };

const FLAG_PAGE = 1000;
const FLAG_MAX_ROWS = 5000;

function chunkList<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const NEW_LEAD_FIELDS =
  'id, name, lead_number, manual_id, stage, balance, proposal_total, subcontractor_fee, currency_id, vat, vat_value, number_of_applicants_meeting, balance_currency';
const LEGACY_LEAD_FIELDS =
  'id, name, lead_number, manual_id, stage, total, total_base, subcontractor_fee, currency_id, vat, no_of_applicants';

async function fetchRowsById(
  table: 'leads' | 'leads_lead',
  fields: string,
  ids: (string | number)[]
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (const batch of chunkList(ids, 60)) {
    const { data, error } = await supabase.from(table).select(fields).in('id', batch);
    if (error) {
      console.warn(`Tags manager ${table} fetch`, error);
      continue;
    }
    out.push(...((data || []) as Record<string, unknown>[]));
  }
  return out;
}

function flagsReportSignature(f: FlagsManagerFilterState): string {
  return JSON.stringify({
    v: 3,
    from: f.flaggedFromDate,
    to: f.flaggedToDate,
    types: [...f.filterFlagTypeIds].sort((a, b) => a - b),
    emps: [...f.filterEmployeeIds].sort((a, b) => a - b),
    channels: [...(f.probabilityChannels || [])].sort(),
  });
}

function contentFlagFilter(query: any, typeIds: number[], channels: ProbabilityChannel[]) {
  if (channels.length === 0) return typeIds.length > 0 ? query.in('flag_type', typeIds) : query;
  const others = typeIds.filter((id) => id !== FLAG_TYPE_PROBABILITY);
  const includeProbability = typeIds.length === 0 || typeIds.includes(FLAG_TYPE_PROBABILITY);
  if (!includeProbability) return query.in('flag_type', typeIds);
  if (others.length === 0 && typeIds.length > 0) {
    return query.eq('flag_type', FLAG_TYPE_PROBABILITY).in('conversation_channel', channels);
  }
  const channelList = channels.join(',');
  const probability = `and(flag_type.eq.${FLAG_TYPE_PROBABILITY},conversation_channel.in.(${channelList}))`;
  if (typeIds.length === 0) {
    return query.or(`flag_type.neq.${FLAG_TYPE_PROBABILITY},${probability}`);
  }
  return query.or(`flag_type.in.(${others.join(',')}),${probability}`);
}

function rmqFlagFilter(query: any, typeIds: number[], channels: ProbabilityChannel[]): any | null {
  if (channels.length === 0) return typeIds.length > 0 ? query.in('flag_type', typeIds) : query;
  const others = typeIds.filter((id) => id !== FLAG_TYPE_PROBABILITY);
  if (typeIds.length > 0 && others.length === 0) return null;
  if (others.length > 0) return query.in('flag_type', others);
  return query.neq('flag_type', FLAG_TYPE_PROBABILITY);
}

function flagWhereLabel(row: {
  source: 'content' | 'rmq';
  flag_kind?: string | null;
  conversation_channel?: string | null;
  lead_field_key?: string | null;
}): string {
  if (row.source === 'rmq') return 'RMQ chat';
  if (row.flag_kind === 'lead_field') {
    const key = String(row.lead_field_key || '').replace(/_/g, ' ').trim();
    return key ? `Lead field · ${key}` : 'Lead field';
  }
  const ch = String(row.conversation_channel || '');
  if (ch === 'email' || ch === 'whatsapp' || ch === 'phone' || ch === 'manual' || ch === 'legacy_interaction') {
    return conversationChannelLabel(ch);
  }
  return 'Conversation';
}

function leadHit(newId: unknown, legacyId: unknown): { newLeadId: string | null; legacyLeadId: number | null } | null {
  const nextNew = newId != null && String(newId).trim() ? String(newId).trim() : null;
  const nextLegacy = legacyId != null && Number.isFinite(Number(legacyId)) ? Number(legacyId) : null;
  if (nextNew) return { newLeadId: nextNew, legacyLeadId: null };
  if (nextLegacy != null) return { newLeadId: null, legacyLeadId: nextLegacy };
  return null;
}

async function readFlagPages(query: any): Promise<any[]> {
  const rows: any[] = [];
  let from = 0;
  while (rows.length < FLAG_MAX_ROWS) {
    const { data, error } = await query.range(from, from + FLAG_PAGE - 1);
    if (error) throw new Error(error.message || 'Failed to load flags');
    const page = data || [];
    rows.push(...page);
    if (page.length < FLAG_PAGE) break;
    from += FLAG_PAGE;
  }
  return rows;
}

async function loadEmployeeUserMap(): Promise<Map<number, string[]>> {
  const map = new Map<number, string[]>();
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('users')
      .select('id, employee_id')
      .not('employee_id', 'is', null)
      .range(from, from + FLAG_PAGE - 1);
    if (error) throw new Error(error.message || 'Failed to load employees');
    const page = data || [];
    for (const row of page as { id?: string; employee_id?: number | string | null }[]) {
      const emp = Number(row.employee_id);
      const id = row.id != null ? String(row.id) : '';
      if (!id || !Number.isFinite(emp)) continue;
      const list = map.get(emp) || [];
      list.push(id);
      map.set(emp, list);
    }
    if (page.length < FLAG_PAGE) break;
    from += FLAG_PAGE;
  }
  return map;
}

async function resolveConversationLeads(
  pending: { channel: ConversationChannel; externalId: string }[]
): Promise<Map<string, { newLeadId: string | null; legacyLeadId: number | null }>> {
  const found = new Map<string, { newLeadId: string | null; legacyLeadId: number | null }>();
  const pairKey = (channel: string, externalId: string) => `${channel}\t${externalId}`;
  const byChannel: Record<ConversationChannel, string[]> = {
    email: [],
    whatsapp: [],
    phone: [],
    manual: [],
    legacy_interaction: [],
  };
  for (const row of pending) {
    if (!byChannel[row.channel]) continue;
    byChannel[row.channel].push(row.externalId);
  }
  const contactWait: { mapKey: string; contactId: number }[] = [];

  const emailIds = [...new Set(byChannel.email)].slice(0, 250);
  let emailCursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(8, emailIds.length) }, async () => {
      while (emailCursor < emailIds.length) {
        const externalId = emailIds[emailCursor++];
        const { data } = await supabase
          .from('emails')
          .select('client_id, legacy_id, contact_id')
          .eq('message_id', externalId)
          .limit(1);
        let row = (data || [])[0] as { client_id?: string | null; legacy_id?: number | null; contact_id?: number | null } | undefined;
        if (!row && /^\d+$/.test(externalId)) {
          const byId = await supabase
            .from('emails')
            .select('client_id, legacy_id, contact_id')
            .eq('id', Number(externalId))
            .maybeSingle();
          row = (byId.data || undefined) as typeof row;
        }
        const hit = row ? leadHit(row.client_id, row.legacy_id) : null;
        if (hit) found.set(pairKey('email', externalId), hit);
        else if (row?.contact_id != null && Number.isFinite(Number(row.contact_id))) {
          contactWait.push({ mapKey: pairKey('email', externalId), contactId: Number(row.contact_id) });
        }
      }
    })
  );

  for (const batch of chunkList([...new Set(byChannel.whatsapp)], 150)) {
    const { data, error } = await supabase
      .from('whatsapp_messages')
      .select('id, lead_id, legacy_id, contact_id')
      .in('id', batch);
    if (error) continue;
    for (const row of (data || []) as { id?: string | number; lead_id?: string | null; legacy_id?: number | null; contact_id?: number | null }[]) {
      const id = row.id != null ? String(row.id) : '';
      if (!id) continue;
      const hit = leadHit(row.lead_id, row.legacy_id);
      if (hit) found.set(pairKey('whatsapp', id), hit);
      else if (row.contact_id != null) contactWait.push({ mapKey: pairKey('whatsapp', id), contactId: Number(row.contact_id) });
    }
  }

  const callIds = [...new Set(byChannel.phone.map((id) => String(id).replace(/^call_/, '').trim()))].filter((id) => /^\d+$/.test(id));
  for (const batch of chunkList(callIds, 150)) {
    const { data, error } = await supabase.from('call_logs').select('id, client_id, lead_id').in('id', batch);
    if (error) continue;
    for (const row of (data || []) as { id?: string | number; client_id?: string | null; lead_id?: number | null }[]) {
      const id = row.id != null ? String(row.id) : '';
      const hit = leadHit(row.client_id, row.lead_id);
      if (id && hit) found.set(pairKey('phone', id), hit);
    }
  }

  for (const batch of chunkList([...new Set(byChannel.manual)], 150)) {
    const { data, error } = await supabase.from('lead_manual_interactions').select('id, lead_id').in('id', batch);
    if (error) continue;
    for (const row of (data || []) as { id?: string | number; lead_id?: string | null }[]) {
      const id = row.id != null ? String(row.id) : '';
      const hit = leadHit(row.lead_id, null);
      if (id && hit) found.set(pairKey('manual', id), hit);
    }
  }

  const legacyIds = [...new Set(byChannel.legacy_interaction.map((id) => Number(String(id).replace(/^legacy_/, ''))))].filter((id) =>
    Number.isFinite(id)
  );
  for (const batch of chunkList(legacyIds, 150)) {
    const { data, error } = await supabase.from('leads_leadinteractions').select('id, lead_id').in('id', batch);
    if (error) continue;
    for (const row of (data || []) as { id?: number; lead_id?: number | null }[]) {
      const hit = leadHit(null, row.lead_id);
      if (row.id != null && hit) found.set(pairKey('legacy_interaction', String(row.id)), hit);
    }
  }

  if (contactWait.length > 0) {
    const contactLead = new Map<number, { newLeadId: string | null; legacyLeadId: number | null }>();
    for (const batch of chunkList([...new Set(contactWait.map((item) => item.contactId))], 150)) {
      const { data, error } = await supabase
        .from('lead_leadcontact')
        .select('contact_id, newlead_id, lead_id')
        .in('contact_id', batch);
      if (error) continue;
      for (const row of (data || []) as { contact_id?: number; newlead_id?: string | null; lead_id?: number | null }[]) {
        const cid = Number(row.contact_id);
        if (!Number.isFinite(cid) || contactLead.has(cid)) continue;
        const hit = leadHit(row.newlead_id, row.lead_id);
        if (hit) contactLead.set(cid, hit);
      }
    }
    for (const item of contactWait) {
      if (found.has(item.mapKey)) continue;
      const hit = contactLead.get(item.contactId);
      if (hit) found.set(item.mapKey, hit);
    }
  }

  return found;
}

async function loadFlagUserProfiles(userIds: string[]): Promise<Map<string, FlagUserProfile>> {
  const map = new Map<string, FlagUserProfile>();
  const nameOf = (row: {
    full_name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    tenants_employee?: { display_name?: string | null; photo_url?: string | null; photo?: string | null; id?: number } | { display_name?: string | null; photo_url?: string | null; photo?: string | null; id?: number }[] | null;
    employee_id?: number | string | null;
  }): FlagUserProfile => {
    const rel = row.tenants_employee;
    const emp = Array.isArray(rel) ? rel[0] : rel;
    const display = emp?.display_name != null ? String(emp.display_name).trim() : '';
    const full = row.full_name != null ? String(row.full_name).trim() : '';
    const both = [row.first_name, row.last_name].map((part) => (part != null ? String(part).trim() : '')).filter(Boolean).join(' ');
    const employeeId =
      emp?.id != null && Number.isFinite(Number(emp.id))
        ? Number(emp.id)
        : row.employee_id != null && Number.isFinite(Number(row.employee_id))
          ? Number(row.employee_id)
          : null;
    return {
      name: display || full || both || '—',
      avatarUrl: employeePhotoFromEmp(emp),
      employeeId,
    };
  };

  for (const batch of chunkList(userIds, 80)) {
    const embedded = await supabase
      .from('users')
      .select('id, full_name, first_name, last_name, employee_id, tenants_employee!employee_id(id, display_name, photo_url, photo)')
      .in('id', batch);
    if (!embedded.error) {
      for (const row of (embedded.data || []) as { id?: string }[]) {
        if (row.id) map.set(String(row.id), nameOf(row as any));
      }
      continue;
    }
    const plain = await supabase.from('users').select('id, full_name, first_name, last_name, employee_id').in('id', batch);
    if (plain.error) continue;
    const empIds = [
      ...new Set(
        ((plain.data || []) as { employee_id?: number | string | null }[])
          .map((row) => Number(row.employee_id))
          .filter((id) => Number.isFinite(id))
      ),
    ];
    const empById = new Map<number, { id: number; display_name: string | null; photo_url: string | null; photo: string | null }>();
    if (empIds.length) {
      const emps = await supabase.from('tenants_employee').select('id, display_name, photo_url, photo').in('id', empIds);
      for (const emp of (emps.data || []) as { id: number; display_name: string | null; photo_url?: string | null; photo?: string | null }[]) {
        empById.set(Number(emp.id), {
          id: Number(emp.id),
          display_name: emp.display_name,
          photo_url: emp.photo_url ?? null,
          photo: emp.photo ?? null,
        });
      }
    }
    for (const row of (plain.data || []) as { id?: string; employee_id?: number | string | null }[]) {
      if (!row.id) continue;
      const emp = empById.get(Number(row.employee_id));
      map.set(String(row.id), nameOf({ ...row, tenants_employee: emp || null }));
    }
  }
  return map;
}

export function FlagsManagerReport({
  dateSlot = null,
  loggedInEmployeeId = null,
  employeeResolved = false,
  mineRequest = null,
  onEmployeeIds,
}: ManagerMineProps) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = usePersistedFilters<FlagsManagerFilterState>(
    'flagsManager_filters_v2',
    {
      flaggedFromDate: '',
      flaggedToDate: '',
      paymentPlanFromDate: '',
      paymentPlanToDate: '',
      filterFlagTypeIds: [],
      filterEmployeeIds: [],
      probabilityChannels: [],
      mineDefaultPending: true,
    },
    { storage: 'sessionStorage' }
  );
  const {
    flaggedFromDate,
    flaggedToDate,
    paymentPlanFromDate = '',
    paymentPlanToDate = '',
    filterFlagTypeIds,
    filterEmployeeIds,
    probabilityChannels = [],
    mineDefaultPending = false,
  } = filters;

  useEffect(() => {
    onEmployeeIds?.(filterEmployeeIds);
  }, [filterEmployeeIds, onEmployeeIds]);

  useEffect(() => {
    if (!mineDefaultPending || !employeeResolved) return;
    setFilters((current) => ({
      ...current,
      mineDefaultPending: false,
      filterEmployeeIds: loggedInEmployeeId != null ? [loggedInEmployeeId] : current.filterEmployeeIds,
    }));
  }, [mineDefaultPending, employeeResolved, loggedInEmployeeId, setFilters]);

  useEffect(() => {
    if (!mineRequest?.nonce || loggedInEmployeeId == null) return;
    const include = mineRequest.include;
    setFilters((current) => ({
      ...current,
      mineDefaultPending: false,
      filterEmployeeIds: employeeIdsWithMine(current.filterEmployeeIds || [], loggedInEmployeeId, include),
    }));
  }, [mineRequest, loggedInEmployeeId, setFilters]);

  const [reportData, setReportData] = usePersistedState<FlagsPersistedReport | null>('flagsManager_report', null, {
    storage: 'sessionStorage',
  });
  const [flagTypes, setFlagTypes] = useState<FlagTypeRow[]>([]);
  const [employeeOptions, setEmployeeOptions] = useState<EmployeeOption[]>([]);
  const employeeUsersRef = useRef<Map<number, string[]> | null>(null);

  const filterSig = useMemo(
    () =>
      flagsReportSignature({
        flaggedFromDate,
        flaggedToDate,
        paymentPlanFromDate,
        paymentPlanToDate,
        filterFlagTypeIds,
        filterEmployeeIds,
        probabilityChannels,
      }),
    [flaggedFromDate, flaggedToDate, paymentPlanFromDate, paymentPlanToDate, filterFlagTypeIds, filterEmployeeIds, probabilityChannels]
  );

  const rows = reportData?.rows ?? [];
  const newLeadMap = useMemo(() => new Map(reportData?.newLeadEntries ?? []), [reportData]);
  const legacyLeadMap = useMemo(() => new Map(reportData?.legacyEntries ?? []), [reportData]);
  const unpaidMap = useMemo(() => new Map(reportData?.unpaidEntries ?? []), [reportData]);
  const userMap = useMemo(() => new Map(reportData?.userEntries ?? []), [reportData]);
  const truncated = reportData?.truncated === true;

  const [expandedRowKey, setExpandedRowKey] = useState<string | null>(null);
  const [paymentRowsByRowKey, setPaymentRowsByRowKey] = useState<Map<string, PaymentRow[]>>(new Map());
  const [paymentLoadingKey, setPaymentLoadingKey] = useState<string | null>(null);
  const [paymentErrorKey, setPaymentErrorKey] = useState<string | null>(null);
  const hasPaymentPlanDateFilter = Boolean(paymentPlanFromDate.trim() || paymentPlanToDate.trim());
  const filteredPaymentRowsByRowKey = useMemo(() => {
    if (!hasPaymentPlanDateFilter) return paymentRowsByRowKey;
    const out = new Map<string, PaymentRow[]>();
    for (const [k, arr] of paymentRowsByRowKey.entries()) {
      out.set(k, filterPaymentPlanRowsByPlanDate(arr, paymentPlanFromDate, paymentPlanToDate));
    }
    return out;
  }, [paymentRowsByRowKey, hasPaymentPlanDateFilter, paymentPlanFromDate, paymentPlanToDate]);

  const [currencyBootstrap, setCurrencyBootstrap] = useState<Map<number, string>>(new Map());
  const currencyMap = useMemo(() => {
    const fromReport = reportData?.currencyEntries;
    if (fromReport && fromReport.length > 0) return new Map(fromReport);
    return currencyBootstrap;
  }, [reportData?.currencyEntries, currencyBootstrap]);

  const loadCurrencies = useCallback(async (): Promise<Map<number, string>> => {
    const m = new Map<number, string>();
    const { data, error: err } = await supabase.from('accounting_currencies').select('id, name');
    if (err || !data) {
      setCurrencyBootstrap(m);
      return m;
    }
    for (const c of data as { id?: number; name?: string }[]) {
      const id = Number(c.id);
      if (Number.isFinite(id) && c.name) m.set(id, String(c.name).trim());
    }
    setCurrencyBootstrap(m);
    return m;
  }, []);

  const [stageNamesReady, setStageNamesReady] = useState(false);
  useEffect(() => {
    void (async () => {
      const [types, emps] = await Promise.all([
        fetchFlagTypes(supabase),
        supabase.from('tenants_employee').select('id, display_name, photo_url, photo').order('display_name', { ascending: true }),
        fetchStageNames().finally(() => setStageNamesReady(true)),
      ]);
      setFlagTypes(types);
      if (!emps.error && emps.data) setEmployeeOptions(emps.data as EmployeeOption[]);
    })();
    void loadCurrencies();
  }, [loadCurrencies]);

  const runFetchReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    setExpandedRowKey(null);
    setPaymentRowsByRowKey(new Map());
    setPaymentLoadingKey(null);
    setPaymentErrorKey(null);
    const sig = flagsReportSignature({
      flaggedFromDate,
      flaggedToDate,
      paymentPlanFromDate,
      paymentPlanToDate,
      filterFlagTypeIds,
      filterEmployeeIds,
      probabilityChannels,
    });
    try {
      let userIdFilter: string[] | null = null;
      if (filterEmployeeIds.length > 0) {
        if (!employeeUsersRef.current) employeeUsersRef.current = await loadEmployeeUserMap();
        const ids = new Set<string>();
        for (const empId of filterEmployeeIds) {
          for (const userId of employeeUsersRef.current.get(Number(empId)) || []) ids.add(userId);
        }
        userIdFilter = [...ids];
        if (userIdFilter.length === 0) {
          const curMap = await loadCurrencies();
          setReportData({
            signature: sig,
            rows: [],
            newLeadEntries: [],
            legacyEntries: [],
            unpaidEntries: [],
            currencyEntries: Array.from(curMap.entries()),
            userEntries: [],
            truncated: false,
          });
          return;
        }
      }

      const typeIds = filterFlagTypeIds.map(Number).filter((id) => Number.isFinite(id));
      const userChunks = userIdFilter ? chunkList(userIdFilter, 40) : [null];
      const contentRaw: any[] = [];
      const rmqRaw: any[] = [];
      for (const users of userChunks) {
        let contentQuery: any = supabase
          .from('user_content_flags')
          .select('id, user_id, flag_kind, conversation_channel, external_id, lead_field_key, new_lead_id, legacy_lead_id, flag_type, created_at')
          .order('created_at', { ascending: false });
        let rmqQuery: any = supabase
          .from('rmq_message_lead_flags')
          .select('id, user_id, new_lead_id, legacy_lead_id, flag_type, created_at')
          .order('created_at', { ascending: false });
        contentQuery = contentFlagFilter(contentQuery, typeIds, probabilityChannels);
        const rmqFiltered = rmqFlagFilter(rmqQuery, typeIds, probabilityChannels);
        if (users) {
          contentQuery = contentQuery.in('user_id', users);
          if (rmqFiltered) rmqQuery = rmqFiltered.in('user_id', users);
        } else if (rmqFiltered) {
          rmqQuery = rmqFiltered;
        }
        contentQuery = applyTaggedAtRange(contentQuery, flaggedFromDate, flaggedToDate, 'created_at');
        if (rmqFiltered) rmqQuery = applyTaggedAtRange(rmqQuery, flaggedFromDate, flaggedToDate, 'created_at');
        const [contentPage, rmqPage] = await Promise.all([
          readFlagPages(contentQuery),
          rmqFiltered ? readFlagPages(rmqQuery) : Promise.resolve([]),
        ]);
        contentRaw.push(...contentPage);
        rmqRaw.push(...rmqPage);
      }

      let assignments: FlagAssignmentDraft[] = [
        ...contentRaw.map((row) => ({
          id: `content:${row.id}`,
          userId: row.user_id != null ? String(row.user_id) : null,
          flagTypeId: Number(row.flag_type),
          createdAt: row.created_at != null ? String(row.created_at) : null,
          newLeadId: row.new_lead_id != null ? String(row.new_lead_id) : null,
          legacyLeadId: row.legacy_lead_id != null && Number.isFinite(Number(row.legacy_lead_id)) ? Number(row.legacy_lead_id) : null,
          whereLabel: flagWhereLabel({
            source: 'content',
            flag_kind: row.flag_kind,
            conversation_channel: row.conversation_channel,
            lead_field_key: row.lead_field_key,
          }),
          channel: row.conversation_channel as ConversationChannel | null,
          externalId: row.external_id != null ? String(row.external_id) : null,
          flagKind: row.flag_kind as string | null,
        })),
        ...rmqRaw.map((row) => ({
          id: `rmq:${row.id}`,
          userId: row.user_id != null ? String(row.user_id) : null,
          flagTypeId: Number(row.flag_type),
          createdAt: row.created_at != null ? String(row.created_at) : null,
          newLeadId: row.new_lead_id != null ? String(row.new_lead_id) : null,
          legacyLeadId: row.legacy_lead_id != null && Number.isFinite(Number(row.legacy_lead_id)) ? Number(row.legacy_lead_id) : null,
          whereLabel: 'RMQ chat',
          channel: null,
          externalId: null,
          flagKind: null,
        })),
      ];

      const pending = assignments.filter(
        (row) =>
          !row.newLeadId &&
          row.legacyLeadId == null &&
          row.channel &&
          row.externalId &&
          (row.channel === 'email' ||
            row.channel === 'whatsapp' ||
            row.channel === 'phone' ||
            row.channel === 'manual' ||
            row.channel === 'legacy_interaction')
      );
      if (pending.length > 0) {
        const resolved = await resolveConversationLeads(
          pending.map((row) => ({ channel: row.channel as ConversationChannel, externalId: row.externalId as string }))
        );
        assignments = assignments.map((row) => {
          if (row.newLeadId || row.legacyLeadId != null || !row.channel || !row.externalId) return row;
          const hit = resolved.get(`${row.channel}\t${row.externalId}`);
          if (!hit) return row;
          return { ...row, newLeadId: hit.newLeadId, legacyLeadId: hit.legacyLeadId };
        });
      }

      assignments.sort((a, b) => Date.parse(b.createdAt || '') - Date.parse(a.createdAt || ''));
      const truncatedRows = assignments.length > FLAG_MAX_ROWS;
      const visibleRows: FlagAssignmentRow[] = assignments.slice(0, FLAG_MAX_ROWS).map(
        ({ channel: _channel, externalId: _externalId, flagKind: _flagKind, ...row }) => row
      );

      const uniqNew = [...new Set(visibleRows.map((row) => row.newLeadId).filter((id): id is string => Boolean(id)))];
      const uniqLegacy = [...new Set(visibleRows.map((row) => row.legacyLeadId).filter((id): id is number => id != null))];
      const userIds = [...new Set(visibleRows.map((row) => row.userId).filter((id): id is string => Boolean(id)))];

      const loadLeads = (table: 'leads' | 'leads_lead', fields: string, ids: (string | number)[]) =>
        fetchRowsById(table, fields, ids);

      const [newLeads, legacyLeads, unpaidBatch, profiles, curMap] = await Promise.all([
        uniqNew.length ? loadLeads('leads', NEW_LEAD_FIELDS, uniqNew) : Promise.resolve([] as Record<string, unknown>[]),
        uniqLegacy.length
          ? loadLeads('leads_lead', LEGACY_LEAD_FIELDS, uniqLegacy)
          : Promise.resolve([] as Record<string, unknown>[]),
        fetchUnpaidTotalsBatchByLeadKey(uniqNew, uniqLegacy),
        loadFlagUserProfiles(userIds),
        loadCurrencies(),
      ]);

      const nm = new Map<string, Record<string, unknown>>();
      for (const lead of newLeads) if (lead.id != null) nm.set(String(lead.id), lead);
      const lm = new Map<number, Record<string, unknown>>();
      for (const lead of legacyLeads) {
        const id = Number(lead.id);
        if (Number.isFinite(id)) lm.set(id, lead);
      }

      setReportData({
        signature: sig,
        rows: visibleRows,
        newLeadEntries: Array.from(nm.entries()),
        legacyEntries: Array.from(lm.entries()),
        unpaidEntries: Array.from(unpaidBatch.entries()),
        currencyEntries: Array.from(curMap.entries()),
        userEntries: Array.from(profiles.entries()),
        truncated: truncatedRows,
      });
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : 'Failed to load flags');
      setReportData(null);
    } finally {
      setLoading(false);
    }
  }, [flaggedFromDate, flaggedToDate, paymentPlanFromDate, paymentPlanToDate, filterFlagTypeIds, filterEmployeeIds, probabilityChannels, loadCurrencies]);

  const togglePaymentExpand = useCallback(async (rowKey: string, expandLead: ExpandLeadParam | null) => {
    if (!expandLead) return;
    if (expandedRowKey === rowKey) {
      setExpandedRowKey(null);
      return;
    }
    setExpandedRowKey(rowKey);
    setPaymentRowsByRowKey((prev) => {
      if (prev.has(rowKey)) return prev;
      void (async () => {
        setPaymentLoadingKey(rowKey);
        setPaymentErrorKey(null);
        try {
          const pr =
            expandLead.kind === 'new'
              ? await fetchOutstandingPaymentPlanRowsForTagsManager({ kind: 'new', leadUuid: expandLead.uuid })
              : await fetchOutstandingPaymentPlanRowsForTagsManager({ kind: 'legacy', legacyId: expandLead.id });
          setPaymentRowsByRowKey((p) => new Map(p).set(rowKey, pr));
        } catch (e) {
          console.error(e);
          setPaymentErrorKey(rowKey);
          setPaymentRowsByRowKey((p) => new Map(p).set(rowKey, []));
        } finally {
          setPaymentLoadingKey((k) => (k === rowKey ? null : k));
        }
      })();
      return prev;
    });
  }, [expandedRowKey]);

  const reportDataRef = useRef(reportData);
  reportDataRef.current = reportData;
  useEffect(() => {
    if (reportDataRef.current?.signature === filterSig) return;
    void runFetchReport();
  }, [filterSig, runFetchReport]);

  const [sortState, setSortState] = useState<{ key: TagsManagerSortKey; dir: 'asc' | 'desc' } | null>(null);
  const sortKey = sortState?.key ?? null;
  const sortDir = sortState?.dir ?? 'desc';
  const handleSort = useCallback((k: TagsManagerSortKey) => {
    setSortState((prev) => {
      if (!prev || prev.key !== k) return { key: k, dir: 'desc' };
      return { key: k, dir: prev.dir === 'desc' ? 'asc' : 'desc' };
    });
  }, []);

  const flagLabel = useCallback(
    (id: number) => flagTypes.find((row) => Number(row.id) === Number(id))?.label || `Flag ${id}`,
    [flagTypes]
  );

  const tableRows = useMemo(() => {
    return rows.map((row, stableIndex) => {
      const isLegacy = !row.newLeadId && row.legacyLeadId != null;
      const leadKey = row.newLeadId ? `new:${row.newLeadId}` : isLegacy ? `legacy:${row.legacyLeadId}` : '';
      const lead = row.newLeadId ? newLeadMap.get(row.newLeadId) : isLegacy ? legacyLeadMap.get(Number(row.legacyLeadId)) : null;
      const currencyLabel = currencyLabelFromLead(
        lead?.currency_id,
        lead?.accounting_currencies,
        currencyMap,
        (lead?.balance_currency as string) || null
      );
      const { main, vat, showVat } = computeTotalDisplayParts(lead, isLegacy);
      const unpaidBy = leadKey ? unpaidMap.get(leadKey) ?? null : null;
      const remainingGross = pickUnpaidAmountForCurrency(unpaidBy, currencyLabel);
      const applicants = isLegacy
        ? lead?.no_of_applicants != null
          ? Number(lead.no_of_applicants)
          : null
        : lead?.number_of_applicants_meeting != null
          ? Number(lead.number_of_applicants_meeting)
          : null;
      const leadLabel =
        lead != null
          ? `${isLegacy ? legacyLeadDisplayNumber(lead) : newLeadDisplayNumber(lead)} · ${String(lead.name ?? '—')}`
          : row.newLeadId
            ? 'Lead not found'
            : isLegacy
              ? `(missing legacy ${row.legacyLeadId})`
              : 'Lead not linked';
      const totalStr =
        showVat && vat > 0
          ? `${formatMoney(currencyLabel, main)} + ${formatMoney(currencyLabel, vat)} VAT`
          : formatMoney(currencyLabel, main);
      const grossTotal = main + (showVat && vat > 0 ? vat : 0);
      const currencyIdForSort =
        lead?.currency_id != null && Number.isFinite(Number(lead.currency_id)) ? Number(lead.currency_id) : 1;
      const sortTotal = convertToNIS(grossTotal, currencyIdForSort);
      const sortRemaining = remainingGross > 0 ? convertToNIS(remainingGross, currencyIdForSort) : 0;
      const remainingStr = remainingGross > 0 ? formatMoney(currencyLabel, remainingGross) : '—';
      let clientsPath = clientsPathForTagsRow(isLegacy, lead ?? null, isLegacy ? Number(row.legacyLeadId) : null);
      if (!clientsPath && row.newLeadId && !isLegacy) clientsPath = `/clients/${encodeURIComponent(row.newLeadId)}`;
      const taggedAt =
        row.createdAt && String(row.createdAt).trim() ? new Date(row.createdAt).toLocaleString() : '—';
      const taggedAtMs = row.createdAt ? Date.parse(String(row.createdAt)) : 0;
      const applicantsDisplay = applicants != null && Number.isFinite(applicants) && applicants > 0 ? applicants : '—';
      const profile = row.userId ? userMap.get(row.userId) : undefined;
      const expandLead: ExpandLeadParam | null = row.newLeadId
        ? { kind: 'new', uuid: row.newLeadId }
        : isLegacy && row.legacyLeadId != null
          ? { kind: 'legacy', id: Number(row.legacyLeadId) }
          : null;
      return {
        key: row.id,
        tag: flagLabel(row.flagTypeId),
        whereLabel: row.whereLabel,
        leadLabel,
        stage: lead?.stage ?? null,
        expandLead,
        clientsPath,
        totalStr: lead ? totalStr : '—',
        remainingStr: lead ? remainingStr : '—',
        applicants: lead ? applicantsDisplay : '—',
        taggedBy: profile?.name || '—',
        taggedByAvatarUrl: profile?.avatarUrl || null,
        taggedByEmployeeId: profile?.employeeId ?? null,
        taggedAt,
        stableIndex,
        sortTotal: lead ? sortTotal : 0,
        sortRemaining: lead ? sortRemaining : 0,
        sortApplicants: lead && applicants != null && Number.isFinite(applicants) && applicants > 0 ? applicants : null,
        taggedAtMs: Number.isFinite(taggedAtMs) ? taggedAtMs : 0,
      } satisfies FlagsTableRow;
    });
  }, [rows, newLeadMap, legacyLeadMap, unpaidMap, currencyMap, userMap, flagLabel]);

  const totalValueSumNisFooter = useMemo(() => {
    if (tableRows.length === 0) return '—';
    let s = 0;
    for (const r of tableRows) s += r.sortTotal;
    return `Σ ${formatMoney('₪', s)}`;
  }, [tableRows]);
  const remainingValueSumNisFooter = useMemo(() => {
    if (tableRows.length === 0) return '—';
    let s = 0;
    for (const r of tableRows) s += r.sortRemaining;
    return `Σ ${formatMoney('₪', s)}`;
  }, [tableRows]);
  const sortedTableRows = useMemo(() => {
    if (!sortKey) return tableRows;
    const copy = [...tableRows];
    copy.sort((a, b) => compareTagsManagerRows(a, b, sortKey, sortDir));
    return copy;
  }, [tableRows, sortKey, sortDir]);

  const assignmentCount = tableRows.length;
  const hasTypeOrEmployeeFilter =
    filterFlagTypeIds.length > 0 || filterEmployeeIds.length > 0 || probabilityChannels.length > 0;

  return (
    <div className="space-y-6">
      {dateSlot
        ? createPortal(
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <span className="shrink-0">Flagged from</span>
            <FilterDateInput
              className="w-40 shrink-0"
              value={flaggedFromDate}
              max={flaggedToDate || undefined}
              onChange={(value) => setFilters((f) => ({ ...f, flaggedFromDate: value }))}
            />
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <span className="shrink-0">Flagged to</span>
            <FilterDateInput
              className="w-40 shrink-0"
              value={flaggedToDate}
              min={flaggedFromDate || undefined}
              onChange={(value) => setFilters((f) => ({ ...f, flaggedToDate: value }))}
            />
          </label>
          <PlanPaymentDateFilter
            fromDate={paymentPlanFromDate}
            toDate={paymentPlanToDate}
            onChange={({ fromDate, toDate }) =>
              setFilters((f) => ({ ...f, paymentPlanFromDate: fromDate, paymentPlanToDate: toDate }))
            }
          />
        </div>,
        dateSlot
      )
        : null}

      <div className="flex flex-col lg:flex-row lg:items-end gap-4 flex-wrap">
        <MultiIdPicker
          label="Filter by flag type"
          placeholder="Type to search flag types…"
          options={flagTypes.map((row) => ({ id: Number(row.id), label: row.label || row.code }))}
          selectedIds={filterFlagTypeIds}
          onChange={(ids) => setFilters((f) => ({ ...f, filterFlagTypeIds: ids }))}
        />
        <MultiIdPicker
          label="Probability channel"
          placeholder="All channels"
          options={PROBABILITY_CHANNEL_OPTIONS.map((row) => ({
            id: row.id,
            label: row.label,
            icon: <ProbabilityChannelMark channel={row.channel} />,
          }))}
          selectedIds={PROBABILITY_CHANNEL_OPTIONS.filter((row) => probabilityChannels.includes(row.channel)).map((row) => row.id)}
          onChange={(ids) =>
            setFilters((f) => ({
              ...f,
              probabilityChannels: PROBABILITY_CHANNEL_OPTIONS.filter((row) => ids.includes(row.id)).map((row) => row.channel),
            }))
          }
        />
        <MultiIdPicker
          label="Filter by employee"
          placeholder="Type to search employees…"
          options={employeeOptions.map((e) => ({
            id: Number(e.id),
            label: e.display_name?.trim() || `Employee #${e.id}`,
            avatarUrl: employeePhotoFromEmp(e),
          }))}
          selectedIds={filterEmployeeIds}
          onChange={(ids) => setFilters((f) => ({ ...f, filterEmployeeIds: ids }))}
          showOptionAvatars
        />
        <div className="flex flex-wrap items-center gap-3 lg:ml-auto">
          <output className="inline-flex items-center gap-2 rounded-lg border border-base-300 bg-base-100 px-3 py-2 text-sm tabular-nums" aria-live="polite">
            {loading && rows.length === 0 ? (
              <span className="flex items-center gap-2 text-base-content/70">
                <span className="loading loading-spinner loading-sm" />
                Loading…
              </span>
            ) : (
              <>
                <span className="font-semibold text-base-content">{assignmentCount.toLocaleString()}</span>
                <span className="text-base-content/70">{assignmentCount === 1 ? 'flag' : 'flags'}</span>
                {!hasTypeOrEmployeeFilter && (
                  <span className="text-xs text-base-content/50 hidden sm:inline">All flag types · all employees</span>
                )}
                {loading && <span className="loading loading-spinner loading-xs" />}
              </>
            )}
          </output>
        </div>
      </div>

      {truncated && (
        <div className="alert alert-warning text-sm">
          <span>Showing the latest {FLAG_MAX_ROWS.toLocaleString()} flags. Narrow the dates or filters to see the rest.</span>
        </div>
      )}
      {error && (
        <div className="alert alert-error text-sm">
          <span>{error}</span>
        </div>
      )}

      <div className="relative w-full min-w-0 overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-gray-100">
        <table className="table table-sm w-full min-w-max text-sm">
          <thead>
            <tr>
              <th className={`text-sm w-7 px-1 ${TAGS_MANAGER_TH_STICKY}`} aria-label="Expand" />
              <th className={`text-sm ${TAGS_MANAGER_TH_STICKY}`}>Flag</th>
              <th className={`text-sm ${TAGS_MANAGER_TH_STICKY}`}>Lead</th>
              <th className={`text-sm ${TAGS_MANAGER_TH_STICKY}`}>Stage</th>
              <TagsManagerSortTh label="Total value (lead)" column="total" align="right" activeKey={sortKey} sortDir={sortDir} onSort={handleSort} summaryFooter={totalValueSumNisFooter} />
              <TagsManagerSortTh label="Remaining lead value" column="remaining" align="right" activeKey={sortKey} sortDir={sortDir} onSort={handleSort} summaryFooter={remainingValueSumNisFooter} />
              <TagsManagerSortTh label="Applicants" column="applicants" align="right" activeKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              <th className={`text-sm ${TAGS_MANAGER_TH_STICKY}`}>Flagged by</th>
              <TagsManagerSortTh label="Flagged at" column="taggedAt" align="left" activeKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center py-10"><span className="loading loading-spinner loading-lg" /></td>
              </tr>
            ) : tableRows.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center py-8 text-sm text-base-content/60">
                  No flags match the selected dates{hasTypeOrEmployeeFilter ? ' and filters' : ''}. Try another date range or clear filters.
                </td>
              </tr>
            ) : (
              sortedTableRows.map((r) => (
                <React.Fragment key={r.key}>
                  <tr
                    className={`hover ${r.expandLead ? 'cursor-pointer' : ''}`}
                    onClick={() => {
                      if (r.expandLead) void togglePaymentExpand(r.key, r.expandLead);
                    }}
                  >
                    <td className="w-7 px-1 align-middle">
                      {r.expandLead ? (
                        <ChevronRightIcon className={`w-5 h-5 text-base-content/60 transition-transform shrink-0 ${expandedRowKey === r.key ? 'rotate-90' : ''}`} />
                      ) : (
                        <span className="inline-block w-5" />
                      )}
                    </td>
                    <td className="align-middle">
                      <div className="font-medium whitespace-nowrap text-sm">{r.tag}</div>
                      <div className="text-sm text-base-content/60">{r.whereLabel}</div>
                    </td>
                    <td className="max-w-[220px] p-0">
                      {r.clientsPath ? (
                        <button
                          type="button"
                          className="link link-primary hover:underline text-left text-sm w-full truncate block pl-1 pr-2 py-2 max-w-[220px]"
                          title={r.leadLabel}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (e.metaKey || e.ctrlKey) window.open(r.clientsPath!, '_blank');
                            else navigate(r.clientsPath!);
                          }}
                        >
                          {r.leadLabel}
                        </button>
                      ) : (
                        <span className="text-sm block pl-1 pr-2 py-2 truncate text-base-content/60" title={r.leadLabel}>{r.leadLabel}</span>
                      )}
                    </td>
                    <td className="align-middle whitespace-nowrap">
                      <LeadStageBadge stage={r.stage} ready={stageNamesReady} />
                    </td>
                    <td className="text-right text-sm whitespace-nowrap">{r.totalStr}</td>
                    <td className="text-right text-sm whitespace-nowrap text-amber-800 dark:text-amber-200">{r.remainingStr}</td>
                    <td className="text-right text-sm">{r.applicants}</td>
                    <td className="text-sm max-w-[200px]" onClick={(e) => e.stopPropagation()}>
                      {r.taggedByEmployeeId == null && r.taggedBy === '—' ? (
                        <span className="text-sm text-base-content/60">—</span>
                      ) : (
                        <span className="inline-flex items-center gap-2 min-w-0 text-sm">
                          <EmployeeAvatarCircle label={r.taggedBy} photoUrl={r.taggedByAvatarUrl} employeeId={r.taggedByEmployeeId} size="md" />
                          <span className="truncate">{r.taggedBy}</span>
                        </span>
                      )}
                    </td>
                    <td className="text-sm whitespace-nowrap">{r.taggedAt}</td>
                  </tr>
                  {expandedRowKey === r.key && r.expandLead && (
                    <tr className="bg-base-200/20 hover:!bg-base-200/20">
                      <td colSpan={9} className="p-0 align-top">
                        <div className="px-2 py-1 border-b border-base-300 bg-base-200/50 text-xs font-semibold text-base-content/70">
                          Outstanding payment plans (unpaid)
                        </div>
                        <TagsManagerPaymentPlanSubtable
                          rows={filteredPaymentRowsByRowKey.get(r.key) ?? []}
                          loading={paymentLoadingKey === r.key}
                          loadError={paymentErrorKey === r.key}
                          planDateFilterActive={hasPaymentPlanDateFilter}
                          fetchedRowCount={(paymentRowsByRowKey.get(r.key) ?? []).length}
                        />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
