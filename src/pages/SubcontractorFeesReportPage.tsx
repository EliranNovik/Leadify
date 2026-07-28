import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import {
  ArrowLeftIcon,
  BanknotesIcon,
  BuildingOffice2Icon,
  ChevronDownIcon,
  ChevronUpDownIcon,
  ChevronUpIcon,
  EllipsisVerticalIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  TrashIcon,
  XMarkIcon,
  CheckIcon,
} from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import { useAdminRole } from '../hooks/useAdminRole';
import { useAuthContext } from '../contexts/AuthContext';
import {
  buildExternalFirmReportRoute,
  buildSubcontractorFeeClientRoute,
  deleteReportFeeRow,
  fetchSubcontractorFeesReport,
  formatFeeReportAmount,
  formatFeeReportCategory,
  formatFeeReportDate,
  formatFeeReportMoney,
  updateReportFeeAmount,
  updateReportFeeNotes,
  updateReportLeadExternalFirm,
  updateReportLeadSource,
  type SubcontractorFeeReportRow,
} from '../lib/subcontractorFeesReport';
import { getSoftStageBadgeStyle } from '../lib/stageUtils';
import {
  fetchActiveLeadSourceOptions,
  type LeadSourceOption,
} from '../lib/leadSourceId';
import SubcontractorFeeAddDrawer, {
  type FeeDrawerLeadPick,
} from '../components/SubcontractorFeeAddDrawer';

type FirmOption = { id: string; name: string; profileImageUrl: string | null };
type RowEditMode = 'firm' | 'source' | 'amount' | 'notes' | null;

function StageBadge({
  name,
  stageId,
  colour,
}: {
  name: string | null;
  stageId: string | null;
  colour: string | null;
}) {
  if (!name) {
    return (
      <span className="badge stage-badge shrink-0 rounded-full border-0 bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600">
        No Stage
      </span>
    );
  }
  const soft = getSoftStageBadgeStyle(colour, stageId || name);
  return (
    <span
      className="badge stage-badge max-w-[12rem] shrink-0 rounded-full border-0 px-2.5 py-0.5 text-xs transition-opacity duration-200 hover:opacity-90"
      style={{
        backgroundColor: soft.backgroundColor,
        color: soft.color,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        display: 'inline-block',
      }}
      title={name}
    >
      {name}
    </span>
  );
}

function FirmCellLogo({
  imageUrl,
  size = 'sm',
}: {
  imageUrl: string | null;
  size?: 'sm' | 'md' | 'lg';
}) {
  const [broken, setBroken] = useState(false);
  const url = imageUrl?.trim() || '';
  const sizeClass =
    size === 'lg' ? 'h-12 w-12' : size === 'md' ? 'h-9 w-9' : 'h-7 w-7';
  const iconClass = size === 'lg' ? 'h-6 w-6' : size === 'md' ? 'h-5 w-5' : 'h-4 w-4';
  if (url && !broken) {
    return (
      <img
        src={url}
        alt=""
        className={`${sizeClass} shrink-0 rounded-md object-cover`}
        draggable={false}
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <span
      className={`flex ${sizeClass} shrink-0 items-center justify-center rounded-md bg-gray-100 text-gray-400`}
    >
      <BuildingOffice2Icon className={iconClass} />
    </span>
  );
}

function RowActionsMenu({
  open,
  anchorEl,
  onClose,
  onEditFirm,
  onEditSource,
  onEditAmount,
  onEditNote,
  onDelete,
}: {
  open: boolean;
  anchorEl: HTMLElement | null;
  onClose: () => void;
  onEditFirm: () => void;
  onEditSource: () => void;
  onEditAmount: () => void;
  onEditNote: () => void;
  onDelete: () => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open || !anchorEl) {
      setPos(null);
      return;
    }
    const rect = anchorEl.getBoundingClientRect();
    const width = 180;
    const left = Math.min(
      Math.max(8, rect.right - width),
      window.innerWidth - width - 8,
    );
    setPos({ top: rect.bottom + 4, left });
  }, [open, anchorEl]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t)) return;
      if (anchorEl?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, anchorEl, onClose]);

  if (!open || !pos) return null;

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[120] w-[180px] overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg"
      style={{ top: pos.top, left: pos.left }}
    >
      <button
        type="button"
        className="block w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gray-50"
        onClick={() => {
          onClose();
          onEditFirm();
        }}
      >
        Edit firm
      </button>
      <button
        type="button"
        className="block w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gray-50"
        onClick={() => {
          onClose();
          onEditSource();
        }}
      >
        Edit source
      </button>
      <button
        type="button"
        className="block w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gray-50"
        onClick={() => {
          onClose();
          onEditAmount();
        }}
      >
        Edit amount
      </button>
      <button
        type="button"
        className="block w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gray-50"
        onClick={() => {
          onClose();
          onEditNote();
        }}
      >
        Edit note
      </button>
      <div className="my-1 border-t border-gray-100" />
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
        onClick={() => {
          onClose();
          onDelete();
        }}
      >
        <TrashIcon className="h-4 w-4" />
        Delete row
      </button>
    </div>,
    document.body,
  );
}

function PickerModal({
  title,
  open,
  onClose,
  children,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h3 className="text-lg font-bold text-gray-900">{title}</h3>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-circle"
            onClick={onClose}
            aria-label="Close"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

const SubcontractorFeesReportPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const { isSuperUser, isLoading: isAdminLoading } = useAdminRole();
  const firmBoxRef = useRef<HTMLDivElement | null>(null);
  const rowMenuButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [mainCategory, setMainCategory] = useState('');
  const [firmSearchQuery, setFirmSearchQuery] = useState('');
  const [selectedFirmIds, setSelectedFirmIds] = useState<string[]>([]);
  /** Firms whose rows are currently shown in the table (subset of selectedFirmIds). */
  const [tableFirmIds, setTableFirmIds] = useState<string[]>([]);
  const [firmDropdownOpen, setFirmDropdownOpen] = useState(false);
  const [firmOptions, setFirmOptions] = useState<FirmOption[]>([]);
  const [sourceOptions, setSourceOptions] = useState<LeadSourceOption[]>([]);
  const [leadSearch, setLeadSearch] = useState('');
  const [leadSearchDraft, setLeadSearchDraft] = useState('');

  const [rows, setRows] = useState<SubcontractorFeeReportRow[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [rowBusyKey, setRowBusyKey] = useState<string | null>(null);

  const [addFeeOpen, setAddFeeOpen] = useState(false);
  const [addFeeLead, setAddFeeLead] = useState<FeeDrawerLeadPick | null>(null);
  const [sortKey, setSortKey] = useState<'amount' | 'date' | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const [openRowMenuKey, setOpenRowMenuKey] = useState<string | null>(null);
  const [editRow, setEditRow] = useState<SubcontractorFeeReportRow | null>(null);
  const [editMode, setEditMode] = useState<RowEditMode>(null);
  const [pickerQuery, setPickerQuery] = useState('');
  const [amountDraft, setAmountDraft] = useState('');
  const [notesDraft, setNotesDraft] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => {
    if (isAdminLoading) return;
    if (!isSuperUser) {
      toast.error('Access denied. This report is only available to superusers.');
      navigate('/reports');
    }
  }, [isAdminLoading, isSuperUser, navigate]);

  useEffect(() => {
    if (!isSuperUser) return;
    let cancelled = false;
    void (async () => {
      try {
        const [firmsRes, sources] = await Promise.all([
          supabase
            .from('firms')
            .select('id, name, profile_image_url')
            .order('name', { ascending: true }),
          fetchActiveLeadSourceOptions(),
        ]);
        if (firmsRes.error) throw firmsRes.error;
        if (cancelled) return;
        setFirmOptions(
          (firmsRes.data || [])
            .map((f: any) => ({
              id: String(f.id),
              name: String(f.name || '').trim(),
              profileImageUrl:
                f.profile_image_url != null
                  ? String(f.profile_image_url).trim() || null
                  : null,
            }))
            .filter((f) => f.name),
        );
        setSourceOptions(sources);
      } catch (err) {
        console.warn('[SubcontractorFeesReport] options:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isSuperUser]);

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (!firmBoxRef.current?.contains(e.target as Node)) {
        setFirmDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchSubcontractorFeesReport({
        dateFrom: dateFrom || null,
        dateTo: dateTo || null,
        mainCategory: mainCategory || null,
        firmSearch: null,
        leadSearch: leadSearch || null,
      });
      setRows(result.rows);
      setCategories(result.mainCategories);
    } catch (err: any) {
      console.error('[SubcontractorFeesReport]', err);
      toast.error(err?.message || 'Failed to load subcontractor fees');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, mainCategory, leadSearch]);

  useEffect(() => {
    if (!isSuperUser) return;
    void load();
  }, [load, isSuperUser]);

  const firmRowCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      if (!row.firmId) continue;
      counts.set(row.firmId, (counts.get(row.firmId) || 0) + 1);
    }
    return counts;
  }, [rows]);

  const firmSuggestions = useMemo(() => {
    const q = firmSearchQuery.trim().toLowerCase();
    const list = !q
      ? firmOptions
      : firmOptions.filter((f) => f.name.toLowerCase().includes(q));
    return list.slice(0, 60);
  }, [firmOptions, firmSearchQuery]);

  const selectedFirms = useMemo(() => {
    const byId = new Map(firmOptions.map((f) => [f.id, f]));
    return selectedFirmIds
      .map((id) => byId.get(id))
      .filter((f): f is FirmOption => Boolean(f));
  }, [firmOptions, selectedFirmIds]);

  const displayRows = useMemo(() => {
    let list =
      selectedFirmIds.length === 0
        ? rows
        : tableFirmIds.length === 0
          ? []
          : rows.filter(
              (r) => r.firmId != null && tableFirmIds.includes(r.firmId),
            );

    if (sortKey) {
      list = [...list].sort((a, b) => {
        let cmp = 0;
        if (sortKey === 'amount') {
          cmp = (Number(a.amount) || 0) - (Number(b.amount) || 0);
        } else {
          const ta = a.feeDate ? new Date(a.feeDate).getTime() : 0;
          const tb = b.feeDate ? new Date(b.feeDate).getTime() : 0;
          cmp = (Number.isFinite(ta) ? ta : 0) - (Number.isFinite(tb) ? tb : 0);
        }
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return list;
  }, [rows, selectedFirmIds, tableFirmIds, sortKey, sortDir]);

  const totalsNis = useMemo(() => {
    return (
      Math.round(
        displayRows.reduce((sum, row) => sum + (Number(row.amountNis) || 0), 0) * 100,
      ) / 100
    );
  }, [displayRows]);

  /** Firm summary boxes — only for firms chosen in the filter. */
  const firmSummaryBoxes = useMemo(() => {
    if (selectedFirmIds.length === 0) return [];
    const byId = new Map(firmOptions.map((f) => [f.id, f]));
    return selectedFirmIds
      .map((id) => {
        const firm =
          byId.get(id) ||
          (() => {
            const row = rows.find((r) => r.firmId === id);
            if (!row) return null;
            return {
              id,
              name: row.firmName || 'Firm',
              profileImageUrl: row.firmProfileImageUrl,
            } satisfies FirmOption;
          })();
        if (!firm) return null;
        const totalNis =
          Math.round(
            rows
              .filter((r) => r.firmId === id)
              .reduce((sum, row) => sum + (Number(row.amountNis) || 0), 0) * 100,
          ) / 100;
        return { firm, totalNis };
      })
      .filter((v): v is { firm: FirmOption; totalNis: number } => Boolean(v));
  }, [selectedFirmIds, firmOptions, rows]);

  const firmPickerList = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    const list = !q
      ? firmOptions
      : firmOptions.filter((f) => f.name.toLowerCase().includes(q));
    return list.slice(0, 50);
  }, [firmOptions, pickerQuery]);

  const sourcePickerList = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    const list = !q
      ? sourceOptions
      : sourceOptions.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            s.code.toLowerCase().includes(q),
        );
    return list.slice(0, 50);
  }, [sourceOptions, pickerQuery]);

  const toggleSort = (key: 'amount' | 'date') => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const applyLeadSearch = () => {
    setLeadSearch(leadSearchDraft.trim());
  };

  const toggleFirmFilter = (firmId: string) => {
    const removing = selectedFirmIds.includes(firmId);
    if (removing) {
      setSelectedFirmIds((prev) => prev.filter((id) => id !== firmId));
      setTableFirmIds((prev) => prev.filter((id) => id !== firmId));
      return;
    }
    setSelectedFirmIds((prev) => [...prev, firmId]);
    setTableFirmIds((prev) => (prev.includes(firmId) ? prev : [...prev, firmId]));
  };

  /** Box click: keep the box, toggle whether that firm's rows appear in the table. */
  const toggleFirmRowsVisible = (firmId: string) => {
    setTableFirmIds((prev) =>
      prev.includes(firmId) ? prev.filter((id) => id !== firmId) : [...prev, firmId],
    );
  };

  const clearFirmFilter = () => {
    setSelectedFirmIds([]);
    setTableFirmIds([]);
    setFirmSearchQuery('');
    setFirmDropdownOpen(false);
  };

  const openAddFee = () => {
    setAddFeeLead(null);
    setAddFeeOpen(true);
  };

  const closeEdit = (force = false) => {
    if (savingEdit && !force) return;
    setEditRow(null);
    setEditMode(null);
    setPickerQuery('');
    setAmountDraft('');
    setNotesDraft('');
  };

  const openEdit = (row: SubcontractorFeeReportRow, mode: RowEditMode) => {
    setEditRow(row);
    setEditMode(mode);
    setPickerQuery('');
    setAmountDraft(mode === 'amount' ? String(row.amount ?? '') : '');
    setNotesDraft(mode === 'notes' ? row.notes || '' : '');
  };

  const handleFirmSave = async (firm: FirmOption | null) => {
    if (!editRow) return;
    setSavingEdit(true);
    setRowBusyKey(editRow.key);
    try {
      await updateReportLeadExternalFirm(editRow, firm?.id ?? null);
      toast.success(firm ? 'Firm updated' : 'Firm cleared');
      setSavingEdit(false);
      closeEdit(true);
      await load();
    } catch (err: any) {
      console.error('[SubcontractorFeesReport] firm update:', err);
      toast.error(err?.message || 'Failed to update firm');
      setSavingEdit(false);
    } finally {
      setRowBusyKey(null);
    }
  };

  const handleSourceSave = async (source: LeadSourceOption | null) => {
    if (!editRow) return;
    setSavingEdit(true);
    setRowBusyKey(editRow.key);
    try {
      await updateReportLeadSource(editRow, source?.id ?? null, source?.name ?? null);
      toast.success(source ? 'Source updated' : 'Source cleared');
      setSavingEdit(false);
      closeEdit(true);
      await load();
    } catch (err: any) {
      console.error('[SubcontractorFeesReport] source update:', err);
      toast.error(err?.message || 'Failed to update source');
      setSavingEdit(false);
    } finally {
      setRowBusyKey(null);
    }
  };

  const handleAmountSave = async () => {
    if (!editRow) return;
    const amountNum = Number(amountDraft);
    if (!Number.isFinite(amountNum) || amountNum < 0) {
      toast.error('Enter a valid amount');
      return;
    }
    setSavingEdit(true);
    setRowBusyKey(editRow.key);
    try {
      await updateReportFeeAmount(editRow, amountNum, user?.id || null);
      toast.success('Amount updated');
      setSavingEdit(false);
      closeEdit(true);
      await load();
    } catch (err: any) {
      console.error('[SubcontractorFeesReport] amount update:', err);
      toast.error(err?.message || 'Failed to update amount');
      setSavingEdit(false);
    } finally {
      setRowBusyKey(null);
    }
  };

  const handleNotesSave = async () => {
    if (!editRow) return;
    setSavingEdit(true);
    setRowBusyKey(editRow.key);
    try {
      await updateReportFeeNotes(editRow, notesDraft, user?.id || null);
      toast.success('Note updated');
      setSavingEdit(false);
      closeEdit(true);
      await load();
    } catch (err: any) {
      console.error('[SubcontractorFeesReport] notes update:', err);
      toast.error(err?.message || 'Failed to update note');
      setSavingEdit(false);
    } finally {
      setRowBusyKey(null);
    }
  };

  const handleDeleteRow = async (row: SubcontractorFeeReportRow) => {
    const label = row.firmName || row.leadNumber || 'this row';
    if (!window.confirm(`Delete subcontractor fee for ${label}?`)) return;
    setRowBusyKey(row.key);
    try {
      await deleteReportFeeRow(row);
      toast.success('Row deleted');
      await load();
    } catch (err: any) {
      console.error('[SubcontractorFeesReport] delete:', err);
      toast.error(err?.message || 'Failed to delete row');
    } finally {
      setRowBusyKey(null);
    }
  };

  if (isAdminLoading || !isSuperUser) {
    return (
      <div className="flex min-h-[calc(100dvh-3.5rem)] items-center justify-center bg-[#ececec]">
        <span className="loading loading-spinner loading-lg text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-[#ececec]">
      <div className="w-full px-4 py-6 md:px-8 md:py-8">
        <div className="mb-6">
          <button
            type="button"
            className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-800"
            onClick={() => navigate('/reports')}
          >
            <ArrowLeftIcon className="h-4 w-4" />
            Reports
          </button>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
            <BanknotesIcon className="h-7 w-7 text-primary" />
            Subcontractor fees
          </h1>
        </div>

        <div className="mb-5 grid grid-cols-1 items-end gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-100 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <label className="block min-w-0">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500">
              From
            </span>
            <input
              type="date"
              className="input input-bordered input-sm h-10 min-h-10 w-full"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </label>
          <label className="block min-w-0">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500">
              To
            </span>
            <input
              type="date"
              className="input input-bordered input-sm h-10 min-h-10 w-full"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </label>
          <label className="block min-w-0">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500">
              Main category
            </span>
            <select
              className="select select-bordered select-sm h-10 min-h-10 w-full"
              value={mainCategory}
              onChange={(e) => setMainCategory(e.target.value)}
            >
              <option value="">All main categories</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </label>
          <label className="block min-w-0 xl:col-span-2">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500">
              Lead / contact / client
            </span>
            <div className="flex gap-2">
              <div className="flex h-10 min-h-10 min-w-0 grow items-center gap-2 rounded-lg border border-base-content/20 bg-base-100 px-3 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-base-content/20">
                <MagnifyingGlassIcon className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
                <input
                  type="search"
                  className="h-full min-w-0 grow bg-transparent text-sm outline-none placeholder:text-gray-400"
                  placeholder="Lead #, client, or contact…"
                  value={leadSearchDraft}
                  onChange={(e) => setLeadSearchDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      applyLeadSearch();
                    }
                  }}
                />
              </div>
              <button
                type="button"
                className="btn btn-sm btn-ghost h-10 min-h-10 border border-base-content/15 px-3"
                onClick={applyLeadSearch}
              >
                Go
              </button>
            </div>
          </label>
          <div className="relative block min-w-0" ref={firmBoxRef}>
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500">
              Firm
            </span>
            <div className="flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-lg border border-base-content/20 bg-base-100 px-2 py-1.5 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-base-content/20">
              <BuildingOffice2Icon className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
              {selectedFirms.slice(0, 2).map((firm) => (
                <span
                  key={firm.id}
                  className="inline-flex max-w-[7rem] items-center gap-1 rounded-full bg-gray-100 py-0.5 pl-0.5 pr-1.5 text-xs text-gray-800"
                >
                  <FirmCellLogo imageUrl={firm.profileImageUrl} />
                  <span className="truncate">{firm.name}</span>
                  <button
                    type="button"
                    className="rounded-full p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700"
                    aria-label={`Remove ${firm.name}`}
                    onClick={() => toggleFirmFilter(firm.id)}
                  >
                    <XMarkIcon className="h-3 w-3" />
                  </button>
                </span>
              ))}
              {selectedFirms.length > 2 ? (
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                  +{selectedFirms.length - 2}
                </span>
              ) : null}
              <input
                type="text"
                role="combobox"
                aria-expanded={firmDropdownOpen}
                aria-controls="firm-fee-report-listbox"
                aria-autocomplete="list"
                className="h-7 min-w-[6rem] grow bg-transparent text-sm outline-none placeholder:text-gray-400"
                placeholder={
                  selectedFirmIds.length === 0 ? 'Select firms…' : 'Add firm…'
                }
                value={firmSearchQuery}
                onChange={(e) => {
                  setFirmSearchQuery(e.target.value);
                  setFirmDropdownOpen(true);
                }}
                onFocus={() => setFirmDropdownOpen(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setFirmDropdownOpen(false);
                  } else if (e.key === 'Enter' && firmSuggestions[0]) {
                    e.preventDefault();
                    toggleFirmFilter(firmSuggestions[0].id);
                    setFirmSearchQuery('');
                  } else if (
                    e.key === 'Backspace' &&
                    !firmSearchQuery &&
                    selectedFirmIds.length > 0
                  ) {
                    setSelectedFirmIds((prev) => prev.slice(0, -1));
                  }
                }}
              />
              {selectedFirmIds.length > 0 ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-xs h-6 min-h-6 w-6 shrink-0 rounded-full p-0"
                  aria-label="Clear firm filter"
                  onClick={clearFirmFilter}
                >
                  <XMarkIcon className="h-3.5 w-3.5" />
                </button>
              ) : (
                <ChevronDownIcon className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
              )}
            </div>
            {firmDropdownOpen ? (
              <ul
                id="firm-fee-report-listbox"
                role="listbox"
                aria-multiselectable="true"
                className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-xl border border-gray-200 bg-white py-1 shadow-lg"
              >
                <li>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selectedFirmIds.length === 0}
                    className="w-full px-3 py-2 text-left text-sm text-gray-500 hover:bg-gray-50"
                    onClick={clearFirmFilter}
                  >
                    All firms
                  </button>
                </li>
                {firmSuggestions.length === 0 ? (
                  <li className="px-3 py-2 text-sm text-gray-400">No matching firms</li>
                ) : (
                  firmSuggestions.map((firm) => {
                    const selected = selectedFirmIds.includes(firm.id);
                    const rowCount = firmRowCounts.get(firm.id) || 0;
                    return (
                      <li key={firm.id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={selected}
                          className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50 ${
                            selected ? 'bg-gray-50 font-medium text-gray-900' : 'text-gray-800'
                          }`}
                          onClick={() => {
                            toggleFirmFilter(firm.id);
                            setFirmSearchQuery('');
                          }}
                        >
                          <span
                            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                              selected
                                ? 'border-primary bg-primary text-white'
                                : 'border-gray-300 bg-white'
                            }`}
                          >
                            {selected ? <CheckIcon className="h-3 w-3" /> : null}
                          </span>
                          <FirmCellLogo imageUrl={firm.profileImageUrl} />
                          <span className="min-w-0 flex-1 truncate">{firm.name}</span>
                          <span className="badge badge-ghost badge-sm shrink-0 tabular-nums text-gray-600">
                            {rowCount}
                          </span>
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
            ) : null}
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="rounded-xl bg-white px-4 py-2 text-sm shadow-sm ring-1 ring-gray-100">
            <span className="text-gray-500">Rows</span>{' '}
            <span className="font-semibold text-gray-900">
              {loading ? '…' : displayRows.length}
            </span>
          </div>
          <div className="rounded-xl bg-white px-4 py-2 text-sm shadow-sm ring-1 ring-gray-100">
            <span className="text-gray-500">Total ₪</span>{' '}
            <span className="font-semibold tabular-nums text-gray-900">
              {loading ? '…' : formatFeeReportAmount(totalsNis)}
            </span>
          </div>
          {firmSummaryBoxes.map(({ firm, totalNis }) => (
            <button
              key={firm.id}
              type="button"
              title={
                tableFirmIds.includes(firm.id)
                  ? `Hide ${firm.name} rows`
                  : `Show ${firm.name} rows`
              }
              aria-pressed={tableFirmIds.includes(firm.id)}
              onClick={() => toggleFirmRowsVisible(firm.id)}
              className="inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-left text-sm shadow-sm ring-1 ring-gray-100 hover:bg-gray-50"
            >
              <FirmCellLogo imageUrl={firm.profileImageUrl} size="lg" />
              <div className="min-w-0">
                <div className="truncate font-medium text-gray-900">{firm.name}</div>
                <div className="tabular-nums text-gray-600">
                  ₪{loading ? '…' : formatFeeReportAmount(totalNis)}
                </div>
              </div>
            </button>
          ))}
          <div className="ms-auto">
            <button
              type="button"
              className="btn btn-primary h-10 min-h-10 gap-1.5 rounded-full px-5"
              onClick={() => openAddFee()}
            >
              <PlusIcon className="h-4 w-4" />
              Add fee
            </button>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-100">
          <div className="overflow-x-auto">
            <table className="table table-sm w-full">
              <thead>
                <tr className="border-b border-gray-100 text-xs uppercase tracking-wider text-gray-500">
                  <th className="bg-gray-50/80 px-4 py-3 font-semibold">Lead / client</th>
                  <th className="bg-gray-50/80 px-4 py-3 font-semibold">Stage</th>
                  <th className="bg-gray-50/80 px-4 py-3 font-semibold">Category</th>
                  <th className="bg-gray-50/80 px-4 py-3 font-semibold">Source</th>
                  <th className="bg-gray-50/80 px-4 py-3 font-semibold">Firm</th>
                  <th className="bg-gray-50/80 px-4 py-3 font-semibold text-right">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-gray-800"
                      onClick={() => toggleSort('amount')}
                    >
                      Amount
                      {sortKey === 'amount' ? (
                        sortDir === 'asc' ? (
                          <ChevronUpIcon className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDownIcon className="h-3.5 w-3.5" />
                        )
                      ) : (
                        <ChevronUpDownIcon className="h-3.5 w-3.5 opacity-50" />
                      )}
                    </button>
                  </th>
                  <th className="bg-gray-50/80 px-4 py-3 font-semibold text-right">Amount ₪</th>
                  <th className="bg-gray-50/80 px-4 py-3 font-semibold">Notes</th>
                  <th className="bg-gray-50/80 px-4 py-3 font-semibold">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-gray-800"
                      onClick={() => toggleSort('date')}
                    >
                      Date
                      {sortKey === 'date' ? (
                        sortDir === 'asc' ? (
                          <ChevronUpIcon className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDownIcon className="h-3.5 w-3.5" />
                        )
                      ) : (
                        <ChevronUpDownIcon className="h-3.5 w-3.5 opacity-50" />
                      )}
                    </button>
                  </th>
                  <th className="bg-gray-50/80 px-4 py-3 font-semibold" />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-12 text-center text-gray-500">
                      <span className="loading loading-spinner loading-md text-primary" />
                    </td>
                  </tr>
                ) : displayRows.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-12 text-center text-sm text-gray-500">
                      No subcontractor fees for these filters.
                    </td>
                  </tr>
                ) : (
                  displayRows.map((row) => {
                    const route = buildSubcontractorFeeClientRoute(row);
                    const firmRoute =
                      row.firmId && row.firmName
                        ? buildExternalFirmReportRoute(row.firmId)
                        : null;
                    const busy = rowBusyKey === row.key;
                    return (
                      <tr key={row.key} className="border-b border-gray-50 hover:bg-gray-50/60">
                        <td className="px-4 py-3 max-w-[280px]">
                          {route ? (
                            <Link
                              to={route}
                              className="text-sm text-primary hover:underline"
                            >
                              {row.leadNumber || row.leadKey}
                            </Link>
                          ) : (
                            <span className="text-sm text-gray-800">
                              {row.leadNumber || row.leadKey}
                            </span>
                          )}
                          <div className="truncate text-sm text-gray-700">
                            {row.clientName || '—'}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <StageBadge
                            name={row.stageName}
                            stageId={row.stageId}
                            colour={row.stageColour}
                          />
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">
                          {formatFeeReportCategory(row)}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">
                          {row.leadSource || <span className="text-gray-400">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          {firmRoute ? (
                            <Link
                              to={firmRoute}
                              className="inline-flex max-w-[16rem] items-center gap-2 text-sm text-primary hover:underline"
                            >
                              <FirmCellLogo imageUrl={row.firmProfileImageUrl} />
                              <span className="truncate">{row.firmName}</span>
                            </Link>
                          ) : row.firmName ? (
                            <span className="inline-flex max-w-[16rem] items-center gap-2 text-sm text-gray-700">
                              <FirmCellLogo imageUrl={row.firmProfileImageUrl} />
                              <span className="truncate">{row.firmName}</span>
                            </span>
                          ) : (
                            <span className="text-sm text-gray-400">No firm</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-sm font-medium tabular-nums text-gray-800">
                          {formatFeeReportMoney(row.amount, row.currencyLabel, row.currencyId)}
                        </td>
                        <td className="px-4 py-3 text-right text-sm font-medium tabular-nums text-gray-800">
                          ₪{formatFeeReportAmount(row.amountNis)}
                        </td>
                        <td className="px-4 py-3 max-w-[220px]">
                          {row.notes ? (
                            <span
                              className="block whitespace-pre-line text-sm text-gray-700 line-clamp-3"
                              title={row.notes}
                              dir={/[\u0590-\u05FF]/.test(row.notes) ? 'rtl' : 'ltr'}
                            >
                              {row.notes}
                            </span>
                          ) : (
                            <span className="text-sm text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
                          {formatFeeReportDate(row.feeDate)}
                        </td>
                        <td className="px-2 py-3 text-right">
                          <button
                            type="button"
                            ref={(el) => {
                              rowMenuButtonRefs.current[row.key] = el;
                            }}
                            className="btn btn-ghost btn-sm btn-circle text-gray-500 hover:bg-gray-100"
                            title="Row actions"
                            aria-label="Row actions"
                            disabled={busy}
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenRowMenuKey((prev) =>
                                prev === row.key ? null : row.key,
                              );
                            }}
                          >
                            <EllipsisVerticalIcon className="h-5 w-5" />
                          </button>
                          <RowActionsMenu
                            open={openRowMenuKey === row.key}
                            anchorEl={rowMenuButtonRefs.current[row.key] || null}
                            onClose={() => setOpenRowMenuKey(null)}
                            onEditFirm={() => openEdit(row, 'firm')}
                            onEditSource={() => openEdit(row, 'source')}
                            onEditAmount={() => openEdit(row, 'amount')}
                            onEditNote={() => openEdit(row, 'notes')}
                            onDelete={() => void handleDeleteRow(row)}
                          />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <PickerModal
        title="Edit firm"
        open={editMode === 'firm' && !!editRow}
        onClose={closeEdit}
      >
        <input
          type="search"
          className="input input-bordered mb-3 w-full"
          placeholder="Search firms…"
          value={pickerQuery}
          autoFocus
          disabled={savingEdit}
          onChange={(e) => setPickerQuery(e.target.value)}
        />
        <ul className="max-h-64 overflow-auto rounded-xl border border-gray-100">
          {editRow?.firmId && editRow.source !== 'fee_table' ? (
            <li>
              <button
                type="button"
                className="w-full px-3 py-2.5 text-left text-sm text-red-600 hover:bg-red-50"
                disabled={savingEdit}
                onClick={() => void handleFirmSave(null)}
              >
                Clear firm
              </button>
            </li>
          ) : null}
          {firmPickerList.map((firm) => (
            <li key={firm.id}>
              <button
                type="button"
                className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-gray-50 ${
                  firm.id === editRow?.firmId ? 'bg-gray-50 font-semibold' : ''
                }`}
                disabled={savingEdit}
                onClick={() => void handleFirmSave(firm)}
              >
                <FirmCellLogo imageUrl={firm.profileImageUrl} />
                <span className="truncate">{firm.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </PickerModal>

      <PickerModal
        title="Edit source"
        open={editMode === 'source' && !!editRow}
        onClose={closeEdit}
      >
        <input
          type="search"
          className="input input-bordered mb-3 w-full"
          placeholder="Search sources…"
          value={pickerQuery}
          autoFocus
          disabled={savingEdit}
          onChange={(e) => setPickerQuery(e.target.value)}
        />
        <ul className="max-h-64 overflow-auto rounded-xl border border-gray-100">
          {editRow?.leadSourceId ? (
            <li>
              <button
                type="button"
                className="w-full px-3 py-2.5 text-left text-sm text-red-600 hover:bg-red-50"
                disabled={savingEdit}
                onClick={() => void handleSourceSave(null)}
              >
                Clear source
              </button>
            </li>
          ) : null}
          {sourcePickerList.map((source) => (
            <li key={source.id}>
              <button
                type="button"
                className={`w-full px-3 py-2.5 text-left text-sm hover:bg-gray-50 ${
                  source.id === editRow?.leadSourceId ? 'bg-gray-50 font-semibold' : ''
                }`}
                disabled={savingEdit}
                onClick={() => void handleSourceSave(source)}
              >
                {source.name}
              </button>
            </li>
          ))}
        </ul>
      </PickerModal>

      <PickerModal
        title="Edit amount"
        open={editMode === 'amount' && !!editRow}
        onClose={closeEdit}
      >
        <label className="form-control w-full">
          <span className="label-text mb-1 font-medium text-gray-700">
            Amount
            {editRow?.currencyLabel ? ` (${editRow.currencyLabel})` : ''}
          </span>
          <input
            type="number"
            min="0"
            step="0.01"
            className="input input-bordered w-full"
            value={amountDraft}
            disabled={savingEdit}
            autoFocus
            onChange={(e) => setAmountDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleAmountSave();
              }
            }}
          />
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={savingEdit}
            onClick={closeEdit}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={savingEdit}
            onClick={() => void handleAmountSave()}
          >
            {savingEdit ? <span className="loading loading-spinner loading-sm" /> : null}
            Save
          </button>
        </div>
      </PickerModal>

      <PickerModal
        title="Edit note"
        open={editMode === 'notes' && !!editRow}
        onClose={closeEdit}
      >
        <label className="form-control w-full">
          <span className="label-text mb-1 font-medium text-gray-700">Notes</span>
          <textarea
            className="textarea textarea-bordered min-h-[120px] w-full"
            value={notesDraft}
            disabled={savingEdit}
            autoFocus
            placeholder="Optional note"
            dir={/[\u0590-\u05FF]/.test(notesDraft) ? 'rtl' : 'ltr'}
            onChange={(e) => setNotesDraft(e.target.value)}
          />
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={savingEdit}
            onClick={closeEdit}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={savingEdit}
            onClick={() => void handleNotesSave()}
          >
            {savingEdit ? <span className="loading loading-spinner loading-sm" /> : null}
            Save
          </button>
        </div>
      </PickerModal>

      <SubcontractorFeeAddDrawer
        open={addFeeOpen}
        onClose={() => {
          setAddFeeOpen(false);
          setAddFeeLead(null);
        }}
        onSaved={() => void load()}
        initialLead={addFeeLead}
        firmOptions={firmOptions}
      />
    </div>
  );
};

export default SubcontractorFeesReportPage;
