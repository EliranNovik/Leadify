import React, { useCallback, useEffect, useMemo, useRef, useState, type FC } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowPathIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  ExclamationTriangleIcon,
  TagIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import { CheckCircleIcon } from '@heroicons/react/24/solid';
import { supabase } from '../../lib/supabase';
import { convertToNIS } from '../../lib/currencyConversion';
import {
  buildLeadLink,
  fetchOutstandingPaymentPlanRowsForTagsManager,
  formatCurrency,
  type PaymentRow,
} from '../../pages/CollectionFinancesReport';
import {
  fetchUnpaidTotalsBatchByLeadKey,
  pickUnpaidAmountForCurrency,
  type UnpaidByCurrencyMap,
} from '../../lib/financeUnpaidTotal';
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
  filterTagIds: number[];
  filterEmployeeIds: number[];
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

function tagsManagerFilterSignature(f: TagsManagerFilterState): string {
  return JSON.stringify({
    from: f.taggedFromDate,
    to: f.taggedToDate,
    tags: [...f.filterTagIds].sort((a, b) => a - b),
    emps: [...f.filterEmployeeIds].sort((a, b) => a - b),
  });
}

/** Page title (Tags manager standalone page). */
export const TagsManagerShellTitle: FC = () => (
  <div className="min-w-0 pr-2 flex items-center gap-3">
    <TagIcon className="w-8 h-8 shrink-0 text-primary" aria-hidden />
    <h3 className="text-2xl font-bold text-gray-900 dark:text-white">Tags manager</h3>
  </div>
);

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
    size === 'sm' ? 'text-[10px] leading-none' : size === 'md' ? 'text-xs leading-none' : 'text-base leading-none';

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

/** Today's date in local time as `YYYY-MM-DD` for `<input type="date" />`. */
function todayYmdLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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
  toDate: string
): T {
  const { gte, lte } = taggedAtRangeIso(fromDate, toDate);
  let q = query;
  if (gte) q = q.gte('tagged_at', gte);
  if (lte) q = q.lte('tagged_at', lte);
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
  const a = lead.lead_number != null ? String(lead.lead_number).trim() : '';
  if (a) return a;
  const b = lead.manual_id != null ? String(lead.manual_id).trim() : '';
  if (b) return b;
  if (lead.id != null && String(lead.id).trim() !== '') return String(lead.id);
  return '—';
}

function newLeadDisplayNumber(lead: Record<string, unknown>): string {
  const a = lead.lead_number != null ? String(lead.lead_number).trim() : '';
  if (a) return a;
  if (lead.id != null && String(lead.id).trim() !== '') return String(lead.id);
  return '—';
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

type PickerOption = { id: number; label: string; avatarUrl?: string | null };

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
    return <span className="text-base text-base-content/60">—</span>;
  }
  return (
    <span className="inline-flex items-center gap-2 min-w-0 text-base">
      <EmployeeAvatarCircle label={name} photoUrl={avatarUrl} employeeId={employeeId} size="lg" />
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
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const q = search.trim().toLowerCase();
  const filtered = options.filter((o) => o.label.toLowerCase().includes(q));

  const toggle = (id: number) => {
    if (selectedIds.includes(id)) onChange(selectedIds.filter((x) => x !== id));
    else onChange([...selectedIds, id].sort((a, b) => a - b));
  };

  const selectedSet = new Set(selectedIds);
  const selectedOptions = options.filter((o) => selectedSet.has(o.id));

  const summaryPlaceholder = `${selectedIds.length} selected — focus the field to search or change`;
  const inputPlaceholder =
    !open && selectedIds.length > 0 && search === '' ? summaryPlaceholder : placeholder;

  return (
    <div ref={ref} className="relative w-full min-w-[220px] max-w-sm">
      <div className="label justify-between py-1">
        <span className="label-text font-medium">{label}</span>
        {selectedIds.length > 0 && (
          <button type="button" className="label-text-alt link link-hover text-xs" onClick={() => onChange([])}>
            Clear all
          </button>
        )}
      </div>
      <input
        type="text"
        className="input input-bordered input-sm md:input-md w-full bg-base-100"
        placeholder={inputPlaceholder}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onFocus={() => setOpen(true)}
        aria-expanded={open}
        aria-haspopup="listbox"
      />
      {open && (
        <div
          className="absolute left-0 right-0 top-full z-[100] mt-1 max-h-72 overflow-y-auto rounded-lg border border-base-300 bg-base-100 shadow-lg"
          role="listbox"
        >
          {selectedOptions.length > 0 && (
            <div className="border-b border-base-200 bg-base-200/40 p-2">
              <p className="mb-1 text-xs font-medium text-base-content/60">Selected</p>
              <div className="flex flex-wrap gap-1">
                {selectedOptions.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    className="badge badge-primary badge-sm gap-1 pr-1 h-auto min-h-7 py-0.5"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => toggle(o.id)}
                  >
                    {showOptionAvatars && (
                      <EmployeeAvatarCircle label={o.label} photoUrl={o.avatarUrl} employeeId={o.id} size="sm" />
                    )}
                    {o.label}
                    <span className="opacity-70" aria-hidden>
                      ×
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-sm text-base-content/50">No matches</div>
            ) : (
              filtered.map((o) => (
                <label
                  key={o.id}
                  className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-base-200"
                >
                  <input
                    type="checkbox"
                    className="checkbox checkbox-primary checkbox-sm shrink-0"
                    checked={selectedIds.includes(o.id)}
                    onChange={() => toggle(o.id)}
                  />
                  {showOptionAvatars && (
                    <EmployeeAvatarCircle label={o.label} photoUrl={o.avatarUrl} employeeId={o.id} size="md" />
                  )}
                  <span className="truncate">{o.label}</span>
                </label>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

type ExpandLeadParam = { kind: 'new'; uuid: string } | { kind: 'legacy'; id: number };

type TagsManagerSortKey = 'total' | 'remaining' | 'applicants' | 'hours' | 'taggedAt';

type TagsManagerTableRow = {
  key: string;
  tag: string;
  leadLabel: string;
  expandLead: ExpandLeadParam | null;
  clientsPath: string | null;
  totalStr: string;
  remainingStr: string;
  applicants: string | number;
  hours: string;
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
  sortHours: number;
  taggedAtMs: number;
};

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
    case 'hours': {
      const d = a.sortHours - b.sortHours;
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

function TagsManagerSortTh({
  label,
  column,
  align,
  activeKey,
  sortDir,
  onSort,
}: {
  label: string;
  column: TagsManagerSortKey;
  align: 'left' | 'right';
  activeKey: TagsManagerSortKey | null;
  sortDir: 'asc' | 'desc';
  onSort: (k: TagsManagerSortKey) => void;
}) {
  const active = activeKey === column;
  return (
    <th scope="col" className={`text-base ${align === 'right' ? 'text-right' : ''}`}>
      <button
        type="button"
        className={`inline-flex w-full min-w-0 items-center gap-0.5 font-semibold hover:text-primary ${
          align === 'right' ? 'justify-end text-right' : 'justify-start text-left'
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
}: {
  rows: PaymentRow[];
  loading: boolean;
  loadError: boolean;
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
    return (
      <p className="text-base-content/60 text-sm py-4 px-3">
        No outstanding payment plan rows (unpaid) for this lead.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto bg-base-200/30 border-t border-base-300">
      <table className="table table-sm md:table-md w-full text-base [&_tbody_tr:hover]:!bg-transparent">
        <thead>
          <tr className="bg-base-200">
            <th>Lead Name</th>
            <th>Client</th>
            <th>Amount</th>
            <th>Amount (in NIS)</th>
            <th>Order</th>
            <th>Collected</th>
            <th>Date</th>
            <th>Proforma Date</th>
            <th>Handler</th>
            <th>Case</th>
            <th>Category</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <Link to={buildLeadLink(row)} className="link link-primary" onClick={(e) => e.stopPropagation()}>
                  {row.leadName}
                </Link>
              </td>
              <td>{row.clientName || row.leadName || '—'}</td>
              <td className="font-semibold">
                {formatCurrency(row.value, row.currency)}
                {row.vat > 0 && (
                  <span className="text-base-content/60 ml-1">+ {formatCurrency(row.vat, row.currency)}</span>
                )}
              </td>
              <td className="font-semibold">{tagsPaymentAmountInNis(row)}</td>
              <td>{row.orderLabel || '—'}</td>
              <td>
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
              <td>
                {(() => {
                  const displayDate = row.dueDate ?? row.planDate;
                  return displayDate ? new Date(displayDate).toLocaleDateString() : '—';
                })()}
              </td>
              <td>{row.proformaDate ? new Date(row.proformaDate).toLocaleDateString() : '—'}</td>
              <td>{row.handlerName || '—'}</td>
              <td>{row.caseNumber || '—'}</td>
              <td>{row.categoryName || '—'}</td>
              <td className="max-w-xs truncate" title={row.notes || ''}>
                {row.notes || '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function TagsManagerReport() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = todayYmdLocal();
  const [filters, setFilters] = usePersistedFilters<TagsManagerFilterState>('tagsManager_filters', {
    taggedFromDate: today,
    taggedToDate: today,
    filterTagIds: [],
    filterEmployeeIds: [],
  }, { storage: 'sessionStorage' });

  const { taggedFromDate, taggedToDate, filterTagIds, filterEmployeeIds } = filters;

  const [reportData, setReportData] = usePersistedState<TagsManagerPersistedReport | null>(
    'tagsManager_report',
    null,
    { storage: 'sessionStorage' }
  );

  const filterSig = useMemo(
    () =>
      tagsManagerFilterSignature({
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
    const sig = tagsManagerFilterSignature({
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

      const [newLeadsRes, legacyRes, unpaidBatch] = await Promise.all([
        uniqNew.length
          ? supabase
              .from('leads')
              .select(
                `
              id,
              name,
              lead_number,
              manual_id,
              balance,
              proposal_total,
              subcontractor_fee,
              currency_id,
              vat,
              vat_value,
              number_of_applicants_meeting,
              balance_currency,
              accounting_currencies ( name )
            `
              )
              .in('id', uniqNew)
          : Promise.resolve({ data: [] as Record<string, unknown>[], error: null }),
        uniqLegacy.length
          ? supabase
              .from('leads_lead')
              .select(
                `
              id,
              name,
              lead_number,
              manual_id,
              total,
              total_base,
              subcontractor_fee,
              currency_id,
              vat,
              no_of_applicants,
              accounting_currencies ( name )
            `
              )
              .in('id', uniqLegacy)
          : Promise.resolve({ data: [] as Record<string, unknown>[], error: null }),
        fetchUnpaidTotalsBatchByLeadKey(uniqNew, uniqLegacy),
      ]);

      if (newLeadsRes.error) console.warn('TagsManagerReport: leads fetch', newLeadsRes.error);
      if (legacyRes.error) console.warn('TagsManagerReport: leads_lead fetch', legacyRes.error);

      const nm = new Map<string, Record<string, unknown>>();
      for (const L of (newLeadsRes.data || []) as Record<string, unknown>[]) {
        if (L.id != null) nm.set(String(L.id), L);
      }
      const lm = new Map<number, Record<string, unknown>>();
      for (const L of (legacyRes.data || []) as Record<string, unknown>[]) {
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

  useEffect(() => {
    void loadFilterOptions();
    void loadCurrencies();
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
            ? `(missing lead ${nu.slice(0, 8)}…)`
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
        expandLead,
        clientsPath,
        totalStr,
        remainingStr,
        applicants: applicantsDisplay,
        hours: '',
        taggedBy,
        taggedByAvatarUrl,
        taggedByEmployeeId,
        taggedAt,
        stableIndex,
        sortTotal,
        sortRemaining,
        sortApplicants,
        sortHours: 0,
        taggedAtMs,
      } satisfies TagsManagerTableRow;
    });
  }, [rows, newLeadMap, legacyLeadMap, unpaidMap, currencyMap]);

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
      <div className="flex w-full flex-col gap-2">
        <div className="flex w-full flex-row flex-wrap gap-2 sm:gap-4 items-end">
          <div className="form-control min-w-0 flex-1 sm:max-w-xs">
            <label className="label py-1">
              <span className="label-text font-medium">Tagged from</span>
            </label>
            <input
              type="date"
              className="input input-bordered input-sm md:input-md w-full min-w-0 bg-base-100"
              value={taggedFromDate}
              onChange={(e) => setFilters((f) => ({ ...f, taggedFromDate: e.target.value }))}
              max={taggedToDate || undefined}
            />
          </div>
          <div className="form-control min-w-0 flex-1 sm:max-w-xs">
            <label className="label py-1">
              <span className="label-text font-medium">Tagged to</span>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                className="input input-bordered input-sm md:input-md min-w-0 flex-1 bg-base-100"
                value={taggedToDate}
                onChange={(e) => setFilters((f) => ({ ...f, taggedToDate: e.target.value }))}
                min={taggedFromDate || undefined}
              />
              {(taggedFromDate || taggedToDate) && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm shrink-0"
                  onClick={() => {
                    setFilters((f) => ({ ...f, taggedFromDate: '', taggedToDate: '' }));
                  }}
                >
                  Clear dates
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

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
          <button
            type="button"
            className="btn btn-primary btn-sm md:btn-md gap-2"
            onClick={() => void runFetchReport()}
            disabled={loading}
          >
            {loading ? <span className="loading loading-spinner loading-sm" /> : <ArrowPathIcon className="w-5 h-5" />}
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-error text-sm">
          <span>{error}</span>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-base-300 bg-base-100">
        <table className="table table-md text-base">
          <thead>
            <tr className="bg-base-200">
              <th className="text-base w-10 px-2" aria-label="Expand" />
              <th className="text-base">Tag</th>
              <th className="text-base">Lead</th>
              <TagsManagerSortTh
                label="Total value (lead)"
                column="total"
                align="right"
                activeKey={sortKey}
                sortDir={sortDir}
                onSort={handleSort}
              />
              <TagsManagerSortTh
                label="Remaining lead value"
                column="remaining"
                align="right"
                activeKey={sortKey}
                sortDir={sortDir}
                onSort={handleSort}
              />
              <TagsManagerSortTh
                label="Applicants"
                column="applicants"
                align="right"
                activeKey={sortKey}
                sortDir={sortDir}
                onSort={handleSort}
              />
              <TagsManagerSortTh
                label="Hours"
                column="hours"
                align="right"
                activeKey={sortKey}
                sortDir={sortDir}
                onSort={handleSort}
              />
              <th className="text-base">Tagged by</th>
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
                <td colSpan={9} className="text-center py-8 text-base text-base-content/60 max-w-lg mx-auto">
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
                    <td className="w-10 px-2 align-middle">
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
                    <td className="font-medium whitespace-nowrap text-base">{r.tag}</td>
                    <td className="max-w-[220px] p-0">
                      {r.clientsPath ? (
                        <button
                          type="button"
                          className="link link-primary hover:underline text-left text-base w-full truncate block px-4 py-3 max-w-[220px]"
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
                        <span className="text-sm block px-4 py-3 truncate text-base-content/60" title={r.leadLabel}>
                          {r.leadLabel}
                        </span>
                      )}
                    </td>
                    <td className="text-right text-base whitespace-nowrap">{r.totalStr}</td>
                    <td className="text-right text-base whitespace-nowrap text-amber-800 dark:text-amber-200">
                      {r.remainingStr}
                    </td>
                    <td className="text-right text-base">{r.applicants}</td>
                    <td className="text-right text-base text-base-content/50">{r.hours || '—'}</td>
                    <td className="text-base max-w-[200px]" onClick={(e) => e.stopPropagation()}>
                      <EmployeeTagCell
                        name={r.taggedBy}
                        avatarUrl={r.taggedByAvatarUrl}
                        employeeId={r.taggedByEmployeeId}
                      />
                    </td>
                    <td className="text-base whitespace-nowrap">{r.taggedAt}</td>
                  </tr>
                  {expandedRowKey === r.key && r.expandLead && (
                    <tr className="bg-base-200/20 hover:!bg-base-200/20">
                      <td colSpan={9} className="p-0 align-top">
                        <div className="px-2 py-1 border-b border-base-300 bg-base-200/50 text-xs font-semibold text-base-content/70">
                          Outstanding payment plans (unpaid)
                        </div>
                        <TagsManagerPaymentPlanSubtable
                          rows={paymentRowsByRowKey.get(r.key) ?? []}
                          loading={paymentLoadingKey === r.key}
                          loadError={paymentErrorKey === r.key}
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
