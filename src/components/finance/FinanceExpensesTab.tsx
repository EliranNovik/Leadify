import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { Link } from 'react-router-dom';
import {
  BanknotesIcon,
  BuildingOffice2Icon,
  BuildingOfficeIcon,
  DocumentTextIcon,
  EllipsisVerticalIcon,
  HomeModernIcon,
  MagnifyingGlassIcon,
  MegaphoneIcon,
  PencilSquareIcon,
  PlusIcon,
  TrashIcon,
  UserGroupIcon,
  UserIcon,
  WrenchScrewdriverIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import AddExpenseDrawer from './AddExpenseDrawer';
import ExpenseDocumentsDrawer from './ExpenseDocumentsDrawer';
import DocumentViewerModal, { type DocumentViewerItem } from '../DocumentViewerModal';
import {
  deleteFinanceExpense,
  fetchFinanceExpenseEntries,
  FINANCE_EXPENSE_KIND_LABEL,
  canEditFinanceExpenseKind,
  canViewFinanceExpenseKind,
  formatFinanceExpenseAmount,
  type FinanceExpenseEntryRow,
  type FinanceExpenseKind,
} from '../../lib/financeExpenseCreate';
import { FINANCE_EXPENSE_DOCUMENTS_BUCKET } from '../../lib/financeExpenseDocuments';
import { useAdminRole } from '../../hooks/useAdminRole';

const TABLE_COLGROUP = (
  <colgroup>
    <col className="w-[11%]" />
    <col className="w-[12%]" />
    <col className="w-[24%]" />
    <col className="w-[18%]" />
    <col className="w-[12%]" />
    <col className="w-[14%]" />
    <col className="w-24" />
    <col className="w-12" />
  </colgroup>
);

const KIND_TOTALS: Array<{
  id: FinanceExpenseKind;
  label: string;
  icon: React.ElementType;
}> = [
  { id: 'lead', label: FINANCE_EXPENSE_KIND_LABEL.lead, icon: UserIcon },
  { id: 'subcontractor', label: FINANCE_EXPENSE_KIND_LABEL.subcontractor, icon: WrenchScrewdriverIcon },
  { id: 'other_firm', label: FINANCE_EXPENSE_KIND_LABEL.other_firm, icon: BuildingOffice2Icon },
  { id: 'office', label: FINANCE_EXPENSE_KIND_LABEL.office, icon: BuildingOfficeIcon },
  { id: 'marketing', label: FINANCE_EXPENSE_KIND_LABEL.marketing, icon: MegaphoneIcon },
  { id: 'rent', label: FINANCE_EXPENSE_KIND_LABEL.rent, icon: HomeModernIcon },
  { id: 'partner_draws', label: FINANCE_EXPENSE_KIND_LABEL.partner_draws, icon: UserGroupIcon },
];

function formatTotalsMap(map: Map<string, number>): string {
  if (map.size === 0) return formatFinanceExpenseAmount(0, 'ILS');
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([code, amount]) => formatFinanceExpenseAmount(amount, code))
    .join(' · ');
}

function isTotalsMapZero(map: Map<string, number>): boolean {
  if (map.size === 0) return true;
  return [...map.values()].every((amount) => !amount);
}

const EXPENSE_SUMMARY_THEMES: Record<
  'total' | FinanceExpenseKind,
  { bg: string; border: string; title: string; muted: string; icon: string; iconBg: string }
> = {
  total: {
    bg: 'bg-[#f4ecff]',
    border: 'border-[#eadbff]',
    title: 'text-[#342b56]',
    muted: 'text-[#6d6791]',
    icon: 'text-[#8a63d2]',
    iconBg: 'bg-white/70',
  },
  lead: {
    bg: 'bg-[#e8f8f2]',
    border: 'border-[#cfeede]',
    title: 'text-[#2a5f50]',
    muted: 'text-[#578874]',
    icon: 'text-[#2d947b]',
    iconBg: 'bg-white/70',
  },
  subcontractor: {
    bg: 'bg-[#fff4e6]',
    border: 'border-[#fde4c3]',
    title: 'text-[#7a4a12]',
    muted: 'text-[#a67c3d]',
    icon: 'text-[#d97706]',
    iconBg: 'bg-white/70',
  },
  other_firm: {
    bg: 'bg-[#eaf0ff]',
    border: 'border-[#d6e2ff]',
    title: 'text-[#2f3f7a]',
    muted: 'text-[#5f73a8]',
    icon: 'text-[#4b63c9]',
    iconBg: 'bg-white/70',
  },
  office: {
    bg: 'bg-[#f1f5f9]',
    border: 'border-[#e2e8f0]',
    title: 'text-[#334155]',
    muted: 'text-[#64748b]',
    icon: 'text-[#64748b]',
    iconBg: 'bg-white/70',
  },
  marketing: {
    bg: 'bg-[#f4ecff]',
    border: 'border-[#eadbff]',
    title: 'text-[#342b56]',
    muted: 'text-[#6d6791]',
    icon: 'text-[#8a63d2]',
    iconBg: 'bg-white/70',
  },
  rent: {
    bg: 'bg-[#eaf0ff]',
    border: 'border-[#d6e2ff]',
    title: 'text-[#2f3f7a]',
    muted: 'text-[#5f73a8]',
    icon: 'text-[#4b63c9]',
    iconBg: 'bg-white/70',
  },
  partner_draws: {
    bg: 'bg-[#e8f8f2]',
    border: 'border-[#cfeede]',
    title: 'text-[#2a5f50]',
    muted: 'text-[#578874]',
    icon: 'text-[#2d947b]',
    iconBg: 'bg-white/70',
  },
};

function TotalPill({
  label,
  value,
  icon: Icon,
  theme,
  loading = false,
  active = false,
  isZero = false,
  onClick,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
  theme: (typeof EXPENSE_SUMMARY_THEMES)['total'];
  loading?: boolean;
  active?: boolean;
  isZero?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={`${label}: ${value}`}
      className={`flex min-h-[4.5rem] min-w-0 items-center justify-between gap-2 rounded-2xl border px-3 py-2.5 text-left shadow-sm transition-all duration-300 ${theme.bg} ${theme.border} ${
        active ? 'ring-2 ring-primary/40 scale-[1.02]' : 'hover:scale-[1.02] hover:shadow-md'
      }`}
    >
      <div className="min-w-0">
        <p className={`truncate text-sm font-semibold leading-tight sm:text-base ${theme.title}`}>{label}</p>
        {loading ? (
          <span className="loading loading-spinner loading-xs mt-1" />
        ) : (
          <p
            className={`mt-0.5 truncate text-sm font-bold leading-tight tabular-nums sm:text-base ${
              isZero ? theme.muted : theme.title
            }`}
          >
            {value}
          </p>
        )}
      </div>
      <div className={`shrink-0 rounded-full border border-white p-2.5 shadow-sm ${theme.iconBg}`}>
        <Icon className={`h-8 w-8 ${theme.icon}`} aria-hidden />
      </div>
    </button>
  );
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const iso = value.slice(0, 10);
  const today = localDateIso();
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const yesterday = localDateIso(y);
  if (iso === today) return 'Today';
  if (iso === yesterday) return 'Yesterday';
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function localDateIso(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildExpenseLeadPath(row: FinanceExpenseEntryRow): string | null {
  const leadNumber = (row.lead_number || '').trim();
  if (row.legacy_lead_id != null) {
    if (leadNumber.includes('/')) {
      return `/clients/${encodeURIComponent(String(row.legacy_lead_id))}?lead=${encodeURIComponent(leadNumber)}`;
    }
    return `/clients/${encodeURIComponent(String(row.legacy_lead_id))}`;
  }
  if (leadNumber) return `/clients/${encodeURIComponent(leadNumber)}`;
  return null;
}

function buildExpenseFirmPath(firmId: string | null): string | null {
  if (!firmId) return null;
  return `/reports/external-firms?firmId=${encodeURIComponent(firmId)}`;
}

function VendorRelatedCell({ row }: { row: FinanceExpenseEntryRow }) {
  const leadPath = buildExpenseLeadPath(row);
  const firmPath = buildExpenseFirmPath(row.firm_id);
  const name = (row.vendor_label || '').trim();
  const leadNumber = (row.lead_number || '').trim();
  const linkClass = 'font-medium text-blue-700 hover:underline';

  const leadLink = (text: string) =>
    leadPath ? (
      <Link to={leadPath} className={linkClass}>
        {text}
      </Link>
    ) : (
      <span>{text}</span>
    );

  const firmLink = (text: string) =>
    firmPath ? (
      <Link to={firmPath} className={linkClass}>
        {text}
      </Link>
    ) : (
      <span>{text}</span>
    );

  if (row.kind === 'lead') {
    if (name && leadNumber && name !== leadNumber) {
      return (
        <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
          {leadLink(name)}
          {leadLink(leadNumber)}
        </span>
      );
    }
    return leadLink(name || leadNumber || '—');
  }

  if (row.kind === 'subcontractor') {
    return (
      <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
        {name ? firmLink(name) : <span>—</span>}
        {leadNumber ? leadLink(leadNumber) : null}
      </span>
    );
  }

  if (row.kind === 'other_firm' || row.kind === 'office') {
    return name ? firmLink(name) : <span>—</span>;
  }

  return <span>{name || '—'}</span>;
}

function initialsFromName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed === '—') return '?';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  return trimmed.slice(0, 2).toUpperCase();
}

function CreatedByCell({ name, photoUrl }: { name: string | null; photoUrl: string | null }) {
  const label = (name || '').trim() || '—';
  const url = (photoUrl || '').trim();
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      {url ? (
        <img
          src={url}
          alt=""
          className="h-8 w-8 shrink-0 rounded-full object-cover"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
            const fallback = e.currentTarget.nextElementSibling;
            if (fallback instanceof HTMLElement) fallback.classList.remove('hidden');
          }}
        />
      ) : null}
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600 ${url ? 'hidden' : ''}`}
        aria-hidden
      >
        {initialsFromName(label)}
      </span>
      <span className="truncate">{label}</span>
    </div>
  );
}

function RowActionsMenu({
  canEdit,
  canDelete,
  onEdit,
  onDelete,
}: {
  canEdit: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const [pos, setPos] = useState({ top: 0, right: 0 });

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    const close = () => setOpen(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  if (!canEdit && !canDelete) return null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="btn btn-ghost btn-sm btn-circle text-gray-500 hover:bg-gray-100 hover:text-gray-800"
        aria-label="Row actions"
        onClick={() => {
          const r = btnRef.current?.getBoundingClientRect();
          if (r) setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
          setOpen((v) => !v);
        }}
      >
        <EllipsisVerticalIcon className="h-5 w-5" />
      </button>
      {open
        ? ReactDOM.createPortal(
            <ul
              ref={menuRef}
              className="menu fixed z-[120] w-40 rounded-box border border-gray-200 bg-base-100 p-2 shadow-lg"
              style={{ top: pos.top, right: pos.right }}
            >
              {canEdit ? (
                <li>
                  <button
                    type="button"
                    className="flex items-center gap-2"
                    onClick={() => {
                      setOpen(false);
                      onEdit();
                    }}
                  >
                    <PencilSquareIcon className="h-4 w-4" />
                    Edit
                  </button>
                </li>
              ) : null}
              {canDelete ? (
                <li>
                  <button
                    type="button"
                    className="flex items-center gap-2 text-error"
                    onClick={() => {
                      setOpen(false);
                      onDelete();
                    }}
                  >
                    <TrashIcon className="h-4 w-4" />
                    Delete
                  </button>
                </li>
              ) : null}
            </ul>,
            document.body,
          )
        : null}
    </>
  );
}

const FinanceExpensesTab: React.FC<{ canManageRestrictedKinds?: boolean }> = ({
  canManageRestrictedKinds = false,
}) => {
  const { isSuperUser } = useAdminRole();
  const [rows, setRows] = useState<FinanceExpenseEntryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editRow, setEditRow] = useState<FinanceExpenseEntryRow | null>(null);
  const [docsRow, setDocsRow] = useState<FinanceExpenseEntryRow | null>(null);
  const [viewerDocs, setViewerDocs] = useState<DocumentViewerItem[]>([]);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [selectedKinds, setSelectedKinds] = useState<FinanceExpenseKind[]>([]);
  const [dateFrom, setDateFrom] = useState(localDateIso);
  const [dateTo, setDateTo] = useState(localDateIso);

  const visibleKindTotals = useMemo(
    () => KIND_TOTALS.filter((k) => canViewFinanceExpenseKind(k.id, canManageRestrictedKinds)),
    [canManageRestrictedKinds],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchFinanceExpenseEntries({
        search,
        dateFrom,
        dateTo,
        hidePartnerDraws: !canManageRestrictedKinds,
      });
      setRows(data);
      setDocsRow((prev) => {
        if (!prev) return prev;
        return data.find((r) => r.listKey === prev.listKey) ?? prev;
      });
    } catch (err: any) {
      console.error('[FinanceExpensesTab] load:', err);
      toast.error(err?.message || 'Failed to load expenses');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [canManageRestrictedKinds, dateFrom, dateTo, search]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      void load();
    }, search ? 250 : 0);
    return () => window.clearTimeout(t);
  }, [load, search]);

  const openCreate = () => {
    setEditRow(null);
    setDrawerOpen(true);
  };

  const openEdit = (row: FinanceExpenseEntryRow) => {
    if (!canEditFinanceExpenseKind(row.kind, canManageRestrictedKinds)) return;
    setEditRow(row);
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setEditRow(null);
  };

  const handleDelete = async (row: FinanceExpenseEntryRow) => {
    if (!isSuperUser) return;
    const kindLabel = FINANCE_EXPENSE_KIND_LABEL[row.kind] || 'expense';
    const ok = window.confirm(`Delete this ${kindLabel.toLowerCase()} expense? This cannot be undone.`);
    if (!ok) return;
    try {
      await deleteFinanceExpense(row);
      toast.success('Expense deleted');
      if (docsRow?.listKey === row.listKey) setDocsRow(null);
      await load();
    } catch (err: any) {
      console.error('[FinanceExpensesTab] delete:', err);
      toast.error(err?.message || 'Failed to delete expense');
    }
  };

  const visibleRows = useMemo(
    () => rows.filter((row) => canViewFinanceExpenseKind(row.kind, canManageRestrictedKinds)),
    [canManageRestrictedKinds, rows],
  );

  const totalsByCurrency = useMemo(() => {
    const map = new Map<string, number>();
    visibleRows.forEach((row) => {
      const code = (row.currency_code || 'ILS').trim().toUpperCase() || 'ILS';
      map.set(code, (map.get(code) || 0) + (Number(row.amount) || 0));
    });
    return map;
  }, [visibleRows]);

  const totalsByKind = useMemo(() => {
    const byKind = new Map<FinanceExpenseKind, Map<string, number>>();
    visibleKindTotals.forEach((k) => byKind.set(k.id, new Map()));
    visibleRows.forEach((row) => {
      const code = (row.currency_code || 'ILS').trim().toUpperCase() || 'ILS';
      const map = byKind.get(row.kind) ?? new Map<string, number>();
      map.set(code, (map.get(code) || 0) + (Number(row.amount) || 0));
      byKind.set(row.kind, map);
    });
    return byKind;
  }, [visibleKindTotals, visibleRows]);

  const filteredRows = useMemo(() => {
    if (selectedKinds.length === 0) return visibleRows;
    const selected = new Set(selectedKinds);
    return visibleRows.filter((row) => selected.has(row.kind));
  }, [visibleRows, selectedKinds]);

  const toggleKind = (kindId: FinanceExpenseKind) => {
    setSelectedKinds((prev) =>
      prev.includes(kindId) ? prev.filter((k) => k !== kindId) : [...prev, kindId],
    );
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <button
            type="button"
            className="btn btn-primary col-start-2 row-start-1 h-auto min-h-[4.5rem] w-full gap-2 rounded-2xl px-3 py-2.5 text-base font-semibold sm:col-start-5 sm:text-lg"
            onClick={openCreate}
          >
            <PlusIcon className="h-8 w-8" />
            Add expense
          </button>
          <TotalPill
            label="Total"
            icon={BanknotesIcon}
            theme={EXPENSE_SUMMARY_THEMES.total}
            value={formatTotalsMap(totalsByCurrency)}
            isZero={isTotalsMapZero(totalsByCurrency)}
            loading={loading && rows.length === 0}
            active={selectedKinds.length === 0}
            onClick={() => setSelectedKinds([])}
          />
          {visibleKindTotals.map((kindMeta) => {
            const kindTotals = totalsByKind.get(kindMeta.id) ?? new Map();
            return (
              <TotalPill
                key={kindMeta.id}
                label={kindMeta.label}
                icon={kindMeta.icon}
                theme={EXPENSE_SUMMARY_THEMES[kindMeta.id]}
                value={formatTotalsMap(kindTotals)}
                isZero={isTotalsMapZero(kindTotals)}
                loading={loading && rows.length === 0}
                active={selectedKinds.includes(kindMeta.id)}
                onClick={() => toggleKind(kindMeta.id)}
              />
            );
          })}
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <label className="form-control w-full max-w-xs lg:w-64 lg:max-w-none">
          <span className="label py-1">
            <span className="label-text text-xs font-semibold uppercase tracking-wide text-gray-500">Search</span>
          </span>
            <div className="relative">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-4 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-gray-400" />
              <input
                className="input input-bordered w-full rounded-full bg-white pl-11"
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
        </label>
        <div className="flex w-full flex-col gap-3 sm:flex-row sm:justify-end lg:w-auto">
        <label className="form-control w-full lg:w-40">
          <span className="label py-1">
            <span className="label-text text-xs font-semibold uppercase tracking-wide text-gray-500">From</span>
          </span>
          <input
            type="date"
            className="input input-bordered w-full bg-white"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </label>
        <label className="form-control w-full lg:w-40">
          <span className="label py-1">
            <span className="label-text text-xs font-semibold uppercase tracking-wide text-gray-500">To</span>
          </span>
          <input
            type="date"
            className="input input-bordered w-full bg-white"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </label>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] table-fixed border-separate border-spacing-0 text-base">
          {TABLE_COLGROUP}
          <thead>
            <tr>
              <th className="px-4 pb-2 pt-0 text-left text-sm font-semibold uppercase tracking-wide text-gray-500">
                Date
              </th>
              <th className="px-4 pb-2 pt-0 text-left text-sm font-semibold uppercase tracking-wide text-gray-500">
                Kind
              </th>
              <th className="px-4 pb-2 pt-0 text-left text-sm font-semibold uppercase tracking-wide text-gray-500">
                Vendor / related
              </th>
              <th className="px-4 pb-2 pt-0 text-left text-sm font-semibold uppercase tracking-wide text-gray-500">
                Category
              </th>
              <th className="px-4 pb-2 pt-0 text-right text-sm font-semibold uppercase tracking-wide text-gray-500">
                Amount
              </th>
              <th className="px-4 pb-2 pt-0 text-left text-sm font-semibold uppercase tracking-wide text-gray-500">
                Created by
              </th>
              <th className="w-24 px-1 pb-2 pt-0 text-center text-sm font-semibold uppercase tracking-wide text-gray-500">
                Documents
              </th>
              <th className="w-12 px-1 pb-2 pt-0 text-right text-sm font-semibold uppercase tracking-wide text-gray-500">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={8}
                  className="rounded-2xl bg-white py-10 text-center shadow-sm"
                >
                  <span className="loading loading-spinner loading-md text-blue-600" />
                </td>
              </tr>
            ) : filteredRows.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="rounded-2xl bg-white py-10 text-center text-base text-gray-500 shadow-sm"
                >
                  {visibleRows.length === 0
                    ? 'No expenses for this date range.'
                    : 'No expenses for the selected kinds.'}
                </td>
              </tr>
            ) : (
              filteredRows.map((row, index) => {
                const first = index === 0;
                const last = index === filteredRows.length - 1;
                const rowLine = last ? '' : 'border-b border-gray-100';
                return (
                  <tr key={row.listKey}>
                    <td
                      className={`bg-white px-4 py-3 whitespace-nowrap ${rowLine} ${first ? 'rounded-tl-2xl' : ''} ${last ? 'rounded-bl-2xl' : ''}`}
                    >
                      {formatDate(row.expense_date)}
                    </td>
                    <td className={`bg-white px-4 py-3 whitespace-nowrap text-gray-700 ${rowLine}`}>
                      {FINANCE_EXPENSE_KIND_LABEL[row.kind] || row.kind}
                    </td>
                    <td className={`bg-white px-4 py-3 ${rowLine}`}>
                      <VendorRelatedCell row={row} />
                    </td>
                    <td className={`truncate bg-white px-4 py-3 ${rowLine}`}>{row.category_label || '—'}</td>
                    <td className={`bg-white px-4 py-3 whitespace-nowrap text-right font-semibold ${rowLine}`}>
                      {formatFinanceExpenseAmount(row.amount, row.currency_code)}
                    </td>
                    <td className={`bg-white px-4 py-3 whitespace-nowrap text-gray-700 ${rowLine}`}>
                      <CreatedByCell name={row.created_by_name} photoUrl={row.created_by_photo} />
                    </td>
                    <td className={`w-24 bg-white px-1 py-3 text-center ${rowLine}`}>
                      <button
                        type="button"
                        className={`relative inline-flex h-9 w-9 items-center justify-center rounded-full ${
                          row.documents?.length
                            ? 'text-blue-600 hover:bg-blue-50'
                            : 'text-gray-400 hover:bg-blue-50 hover:text-blue-600'
                        }`}
                        title={
                          row.documents?.length
                            ? `${row.documents.length} document${row.documents.length === 1 ? '' : 's'}`
                            : 'Add documents'
                        }
                        aria-label={
                          row.documents?.length
                            ? `${row.documents.length} documents`
                            : 'Add documents'
                        }
                        onClick={() => setDocsRow(row)}
                      >
                        <DocumentTextIcon className="h-6 w-6" />
                        {row.documents?.length ? (
                          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-bold leading-none text-white">
                            {row.documents.length}
                          </span>
                        ) : null}
                      </button>
                    </td>
                    <td
                      className={`w-12 bg-white px-1 py-3 text-right ${rowLine} ${first ? 'rounded-tr-2xl' : ''} ${last ? 'rounded-br-2xl' : ''}`}
                    >
                      <RowActionsMenu
                        canEdit={canEditFinanceExpenseKind(row.kind, canManageRestrictedKinds)}
                        canDelete={isSuperUser}
                        onEdit={() => openEdit(row)}
                        onDelete={() => void handleDelete(row)}
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <AddExpenseDrawer
        open={drawerOpen}
        editRow={editRow}
        canManageRestrictedKinds={canManageRestrictedKinds}
        onClose={closeDrawer}
        onSaved={() => void load()}
      />
      <ExpenseDocumentsDrawer
        open={Boolean(docsRow)}
        row={docsRow}
        onClose={() => setDocsRow(null)}
        onChanged={() => void load()}
        onOpenDocument={(docs, index) => {
          setViewerDocs(docs);
          setViewerIndex(index);
        }}
      />
      <DocumentViewerModal
        isOpen={viewerIndex !== null && viewerDocs.length > 0}
        onClose={() => {
          setViewerIndex(null);
          setViewerDocs([]);
        }}
        documents={viewerDocs}
        initialIndex={viewerIndex ?? 0}
        bucketName={FINANCE_EXPENSE_DOCUMENTS_BUCKET}
      />
    </div>
  );
};

export default FinanceExpensesTab;
