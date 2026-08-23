import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import {
  PlusIcon,
  BanknotesIcon,
  XMarkIcon,
  BuildingOffice2Icon,
  EllipsisVerticalIcon,
  CheckIcon,
  PencilSquareIcon,
  TrashIcon,
  DocumentTextIcon,
  DocumentPlusIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { useAuthContext } from '../../contexts/AuthContext';
import type { ClientTabProps } from '../../types/client';
import {
  deleteAllLeadSubcontractorFees,
  deleteLeadSubcontractorFee,
  dispatchSubcontractorFeesChanged,
  fetchLeadSubcontractorFees,
  insertLeadSubcontractorFee,
  resolveLeadFeeIdentity,
  setLeadSubcontractorFeeScalar,
  sumSubcontractorFeeAmounts,
  setLeadSubcontractorFeePaid,
  updateLeadSubcontractorFee,
  updateLeadSubcontractorFeeNotes,
  type LeadSubcontractorFeeRow,
} from '../../lib/leadSubcontractorFees';
import { FinanceExpenseLikeColgroup, PaymentStatusPill } from './paymentPlanUi';
import FinancesLeadExpensesSection from './FinancesLeadExpensesSection';
import ExpenseDocumentsDrawer from '../finance/ExpenseDocumentsDrawer';
import DocumentViewerModal, { type DocumentViewerItem } from '../DocumentViewerModal';
import {
  ensureRegistryForKindDestination,
  fetchFinanceDocsByDestinationIds,
  type FinanceExpenseEntryRow,
} from '../../lib/financeExpenseCreate';
import {
  FINANCE_EXPENSE_DOC_MAX_FILES,
  FINANCE_EXPENSE_DOCUMENTS_BUCKET,
  FINANCE_EXPENSE_DOCUMENT_TYPE_LABEL,
  uploadFinanceExpenseDocuments,
  validateFinanceExpenseDocumentFile,
  type FinanceExpenseDocumentRow,
  type FinanceExpenseDocumentType,
} from '../../lib/financeExpenseDocuments';

type FirmOption = { id: string; name: string };
type CurrencyOption = { id: number; name: string; iso_code: string | null };
type PendingDoc = {
  localId: string;
  file: File;
  documentType: FinanceExpenseDocumentType;
};
const DOC_TYPES: FinanceExpenseDocumentType[] = ['invoice', 'receipt', 'other'];

function feeToDocsRow(
  fee: LeadSubcontractorFeeRow,
  docs?: { entryId: number; documents: FinanceExpenseDocumentRow[] },
): FinanceExpenseEntryRow {
  return {
    id: docs?.entryId || 0,
    listKey: `subcontractor:${fee.id}`,
    created_at: fee.created_at,
    kind: 'subcontractor',
    destination_table: 'lead_subcontractor_fees',
    destination_id: String(fee.id),
    expense_date: fee.created_at ? fee.created_at.slice(0, 10) : null,
    amount: Number(fee.amount) || 0,
    currency_code: fee.accounting_currencies?.iso_code || fee.accounting_currencies?.name || null,
    firm_id: fee.firm_id,
    new_lead_id: fee.new_lead_id,
    legacy_lead_id: fee.legacy_lead_id,
    category_label: 'Subcontractor fee',
    vendor_label: fee.firms?.name || null,
    lead_number: fee.lead_number,
    notes: fee.notes,
    created_by: fee.created_by,
    created_by_name: fee.created_by_display_name || null,
    created_by_photo: null,
    documents: docs?.documents || [],
  };
}

type FinancesExpensesFeesPageProps = Pick<ClientTabProps, 'client' | 'onClientUpdate'> & {
  openAddExpenseRequest?: {
    token: number;
    contactId?: number | null;
    contactName?: string | null;
  } | null;
  onOpenAddExpenseHandled?: () => void;
};

const FeeRowMenuPortal: React.FC<{
  open: boolean;
  anchorEl: HTMLButtonElement | null;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  paid?: boolean;
  onTogglePaid?: () => void;
}> = ({ open, anchorEl, onClose, onEdit, onDelete, paid = false, onTogglePaid }) => {
  const [style, setStyle] = useState<React.CSSProperties>({ visibility: 'hidden' });

  useEffect(() => {
    if (!open || !anchorEl) return;

    const updatePosition = () => {
      const rect = anchorEl.getBoundingClientRect();
      const menuHeight = onTogglePaid ? 140 : 96;
      const spaceBelow = window.innerHeight - rect.bottom;
      const openUpward = spaceBelow < menuHeight + 8;
      setStyle({
        position: 'fixed',
        top: openUpward ? undefined : rect.bottom + 4,
        bottom: openUpward ? window.innerHeight - rect.top + 4 : undefined,
        right: Math.max(8, window.innerWidth - rect.right),
        zIndex: 99999,
        visibility: 'visible',
      });
    };

    updatePosition();
    const raf = requestAnimationFrame(updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open, anchorEl, onTogglePaid]);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-fee-row-menu]') || target.closest('[data-fee-menu-trigger]')) {
        return;
      }
      onClose();
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open, onClose]);

  if (!open) return null;

  return ReactDOM.createPortal(
    <ul
      data-fee-row-menu
      style={style}
      className="w-44 rounded-xl border border-slate-200 bg-white p-1 shadow-lg"
    >
      {onTogglePaid ? (
        <li>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
            onClick={onTogglePaid}
          >
            <CheckIcon className="h-4 w-4" />
            {paid ? 'Mark unpaid' : 'Mark paid'}
          </button>
        </li>
      ) : null}
      <li>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
          onClick={onEdit}
        >
          <PencilSquareIcon className="h-4 w-4" />
          Edit
        </button>
      </li>
      <li>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
          onClick={onDelete}
        >
          <TrashIcon className="h-4 w-4" />
          Delete
        </button>
      </li>
    </ul>,
    document.body,
  );
};

const FinancesExpensesFeesPage: React.FC<FinancesExpensesFeesPageProps> = ({
  client,
  openAddExpenseRequest,
  onOpenAddExpenseHandled,
}) => {
  const { user } = useAuthContext();
  const [fees, setFees] = useState<LeadSubcontractorFeeRow[]>([]);
  const [loadingFees, setLoadingFees] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [firmOptions, setFirmOptions] = useState<FirmOption[]>([]);
  const [currencies, setCurrencies] = useState<CurrencyOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [saving, setSaving] = useState(false);
  const [firmId, setFirmId] = useState('');
  const [firmSearch, setFirmSearch] = useState('');
  const [firmDropdownOpen, setFirmDropdownOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [currencyId, setCurrencyId] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [notesModalFee, setNotesModalFee] = useState<LeadSubcontractorFeeRow | null>(null);
  const [notesModalDraft, setNotesModalDraft] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [editingFeeId, setEditingFeeId] = useState<number | null>(null);
  const [editingLeadFee, setEditingLeadFee] = useState(false);
  const [leadFeeLocal, setLeadFeeLocal] = useState<number | null>(null);
  const [leadExternalFirmId, setLeadExternalFirmId] = useState<string | null>(null);
  const [leadExternalFirmName, setLeadExternalFirmName] = useState<string | null>(null);
  const [openRowMenuId, setOpenRowMenuId] = useState<number | null>(null);
  const [leadFeeMenuOpen, setLeadFeeMenuOpen] = useState(false);
  const rowMenuButtonRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const leadFeeMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const [docsByFeeId, setDocsByFeeId] = useState<
    Map<number, { entryId: number; documents: FinanceExpenseDocumentRow[] }>
  >(new Map());
  const [docsRow, setDocsRow] = useState<FinanceExpenseEntryRow | null>(null);
  const [viewerDocs, setViewerDocs] = useState<DocumentViewerItem[]>([]);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [pendingDocs, setPendingDocs] = useState<PendingDoc[]>([]);

  const identity = useMemo(
    () => resolveLeadFeeIdentity(client),
    [client?.id, client?.lead_type, client?.lead_number],
  );

  const externalFirmIdFromClient = useMemo(() => {
    const raw = (client as any)?.external_firm_id;
    if (raw == null || raw === '') return null;
    return String(raw);
  }, [(client as any)?.external_firm_id]);

  useEffect(() => {
    setLeadFeeLocal(null);
  }, [client?.id, (client as any)?.subcontractor_fee]);

  // Resolve external_firm_id from client, or fetch from leads / leads_lead when missing.
  useEffect(() => {
    if (externalFirmIdFromClient) {
      setLeadExternalFirmId(externalFirmIdFromClient);
      return;
    }
    if (!identity) {
      setLeadExternalFirmId(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        if (identity.leadType === 'legacy' && identity.legacyLeadId != null) {
          const { data, error } = await supabase
            .from('leads_lead')
            .select('external_firm_id')
            .eq('id', identity.legacyLeadId)
            .maybeSingle();
          if (error) throw error;
          if (cancelled) return;
          const id = data?.external_firm_id != null ? String(data.external_firm_id) : null;
          setLeadExternalFirmId(id);
          return;
        }
        if (identity.newLeadId) {
          const { data, error } = await supabase
            .from('leads')
            .select('external_firm_id')
            .eq('id', identity.newLeadId)
            .maybeSingle();
          if (error) throw error;
          if (cancelled) return;
          const id = data?.external_firm_id != null ? String(data.external_firm_id) : null;
          setLeadExternalFirmId(id);
        }
      } catch (err) {
        console.warn('[FinancesExpensesFeesPage] external_firm_id lookup:', err);
        if (!cancelled) setLeadExternalFirmId(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [externalFirmIdFromClient, identity]);

  useEffect(() => {
    if (!leadExternalFirmId) {
      setLeadExternalFirmName(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const { data, error } = await supabase
          .from('firms')
          .select('id, name')
          .eq('id', leadExternalFirmId)
          .maybeSingle();
        if (cancelled) return;
        if (error) throw error;
        const name = String((data as any)?.name || '').trim();
        setLeadExternalFirmName(name || null);
      } catch (err) {
        console.warn('[FinancesExpensesFeesPage] external firm lookup:', err);
        if (!cancelled) setLeadExternalFirmName(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leadExternalFirmId]);

  const filteredFirms = useMemo(() => {
    const q = firmSearch.trim().toLowerCase();
    if (!q) return firmOptions;
    return firmOptions.filter((f) => f.name.toLowerCase().includes(q));
  }, [firmOptions, firmSearch]);

  const getNotesTextDirection = (text: string | null | undefined): 'rtl' | 'ltr' => {
    if (!text) return 'ltr';
    const hebrewRegex = /[\u0590-\u05FF]/;
    return hebrewRegex.test(text) ? 'rtl' : 'ltr';
  };

  const loadFees = useCallback(async () => {
    if (!identity) {
      setFees([]);
      setLoadingFees(false);
      return;
    }
    setLoadingFees(true);
    try {
      const rows = await fetchLeadSubcontractorFees(identity);
      setFees(rows);
      try {
        const docs = await fetchFinanceDocsByDestinationIds(
          'lead_subcontractor_fees',
          rows.map((row) => row.id),
        );
        const next = new Map<number, { entryId: number; documents: FinanceExpenseDocumentRow[] }>();
        docs.forEach((value, key) => next.set(Number(key), value));
        setDocsByFeeId(next);
      } catch {
        setDocsByFeeId(new Map());
      }
      const feeSum = sumSubcontractorFeeAmounts(rows);
      if (rows.length > 0) {
        setLeadFeeLocal(feeSum);
        try {
          await setLeadSubcontractorFeeScalar(identity, feeSum);
        } catch (syncErr) {
          console.warn('[FinancesExpensesFeesPage] scalar sync on load:', syncErr);
        }
        dispatchSubcontractorFeesChanged({ leadId: client?.id, feeSum });
      }
    } catch (err: any) {
      console.error('[FinancesExpensesFeesPage] load fees:', err);
      toast.error(err?.message || 'Failed to load fees');
    } finally {
      setLoadingFees(false);
    }
  }, [identity, client?.id]);

  useEffect(() => {
    void loadFees();
  }, [loadFees]);

  const loadDrawerOptions = useCallback(async (preferredCurrencyId?: string | null) => {
    setLoadingOptions(true);
    try {
      const [firmsRes, currenciesRes] = await Promise.all([
        supabase.from('firms').select('id, name').eq('is_active', true).order('name', { ascending: true }),
        supabase
          .from('accounting_currencies')
          .select('id, name, iso_code')
          .order('id', { ascending: true }),
      ]);
      if (firmsRes.error) throw firmsRes.error;
      if (currenciesRes.error) throw currenciesRes.error;
      setFirmOptions(
        (firmsRes.data || []).map((f: any) => ({
          id: String(f.id),
          name: String(f.name ?? '').trim() || 'Unnamed firm',
        })),
      );
      const currencyRows = (currenciesRes.data || []).map((c: any) => ({
        id: Number(c.id),
        name: String(c.name ?? ''),
        iso_code: c.iso_code ?? null,
      }));
      setCurrencies(currencyRows);

      if (preferredCurrencyId && currencyRows.some((c) => String(c.id) === String(preferredCurrencyId))) {
        setCurrencyId(String(preferredCurrencyId));
      } else {
        // Default currency from lead when possible
        const leadCurrencyId =
          client?.currency_id != null ? String(client.currency_id) : '';
        const leadCurrencyName = String(
          (client as any)?.currency || (client as any)?.proposal_currency || '',
        );
        const matchById = currencyRows.find((c) => String(c.id) === leadCurrencyId);
        const matchByName = currencyRows.find(
          (c) =>
            c.name === leadCurrencyName ||
            c.iso_code === leadCurrencyName ||
            (leadCurrencyName === '₪' && (c.name === '₪' || c.iso_code === 'ILS')),
        );
        setCurrencyId(String(matchById?.id ?? matchByName?.id ?? currencyRows[0]?.id ?? ''));
      }
    } catch (err: any) {
      console.error('[FinancesExpensesFeesPage] load options:', err);
      toast.error(err?.message || 'Failed to load firms / currencies');
    } finally {
      setLoadingOptions(false);
    }
  }, [client]);

  const refreshFeesAndTotals = async () => {
    if (!identity) return;
    const rows = await fetchLeadSubcontractorFees(identity);
    setFees(rows);
    const feeSum = sumSubcontractorFeeAmounts(rows);
    // Keep leads.subcontractor_fee aligned with fee lines (trigger + explicit write).
    try {
      await setLeadSubcontractorFeeScalar(identity, feeSum);
    } catch (syncErr) {
      console.warn('[FinancesExpensesFeesPage] scalar sync:', syncErr);
    }
    setLeadFeeLocal(feeSum);
    dispatchSubcontractorFeesChanged({
      leadId: client?.id,
      feeSum,
    });
    try {
      const docs = await fetchFinanceDocsByDestinationIds(
        'lead_subcontractor_fees',
        rows.map((row) => row.id),
      );
      const next = new Map<number, { entryId: number; documents: FinanceExpenseDocumentRow[] }>();
      docs.forEach((value, key) => next.set(Number(key), value));
      setDocsByFeeId(next);
    } catch {
      setDocsByFeeId(new Map());
    }
  };

  /** Move leads.subcontractor_fee into a fee line so totals stay additive with the fees table. */
  const migrateLeadFeeIntoTableIfNeeded = async (currencyNum: number) => {
    if (!identity || fees.length > 0) return;
    const leadFee =
      leadFeeLocal ?? Number((client as any)?.subcontractor_fee ?? 0);
    if (!Number.isFinite(leadFee) || leadFee <= 0) return;

    const migrateFirmId = leadExternalFirmId;
    if (!migrateFirmId) {
      const ok = window.confirm(
        'This lead has a subcontractor fee on the lead record but no external firm. Adding a fee line will replace that lead fee unless you cancel and set an external firm first. Continue and replace?',
      );
      if (!ok) throw new Error('CANCELLED');
      await setLeadSubcontractorFeeScalar(identity, 0);
      setLeadFeeLocal(0);
      return;
    }

    const already = fees.some((f) => String(f.firm_id) === String(migrateFirmId));
    if (already) return;

    await insertLeadSubcontractorFee({
      identity,
      firmId: migrateFirmId,
      amount: Math.round(leadFee * 100) / 100,
      currencyId: currencyNum,
      notes: 'Migrated from lead record',
      createdBy: user?.id || null,
    });
  };

  // Live list + header updates when fee rows change (DB trigger syncs leads.subcontractor_fee).
  useEffect(() => {
    if (!identity || !client?.id) return;

    const channelName = `lead-subcontractor-fees-${String(client.id)}`;
    const isLegacy = identity.leadType === 'legacy';
    const legacyId = identity.legacyLeadId != null ? String(identity.legacyLeadId) : null;
    const newId = identity.newLeadId ? String(identity.newLeadId).toLowerCase() : null;

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'lead_subcontractor_fees' },
        (payload: any) => {
          const row = payload?.new ?? payload?.old;
          if (!row) return;
          const matches = isLegacy
            ? legacyId != null && String(row.legacy_lead_id ?? '') === legacyId
            : newId != null && String(row.new_lead_id ?? '').toLowerCase() === newId;
          if (!matches) return;
          void refreshFeesAndTotals();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh when lead identity changes
  }, [identity?.leadType, identity?.legacyLeadId, identity?.newLeadId, client?.id]);

  const openAddFeeDrawer = () => {
    setEditingFeeId(null);
    setEditingLeadFee(false);
    setFirmId('');
    setFirmSearch('');
    setFirmDropdownOpen(false);
    setAmount('');
    setNotes('');
    setOpenRowMenuId(null);
    setLeadFeeMenuOpen(false);
    setPendingDocs([]);
    setDrawerOpen(true);
    void loadDrawerOptions();
  };

  const openEditFeeDrawer = (fee: LeadSubcontractorFeeRow) => {
    setEditingFeeId(fee.id);
    setEditingLeadFee(false);
    setFirmId(fee.firm_id);
    setFirmSearch(fee.firms?.name || '');
    setFirmDropdownOpen(false);
    setAmount(String(fee.amount ?? ''));
    setCurrencyId(fee.currency_id != null ? String(fee.currency_id) : '');
    setNotes(fee.notes || '');
    setOpenRowMenuId(null);
    setLeadFeeMenuOpen(false);
    setPendingDocs([]);
    setDrawerOpen(true);
    void loadDrawerOptions(fee.currency_id != null ? String(fee.currency_id) : null);
  };

  const openEditLeadFeeDrawer = () => {
    const currentLeadFee =
      leadFeeLocal ?? Number((client as any)?.subcontractor_fee ?? 0);
    setEditingFeeId(null);
    setEditingLeadFee(true);
    setFirmId('');
    setFirmSearch('');
    setFirmDropdownOpen(false);
    setAmount(String(currentLeadFee || ''));
    setNotes('');
    setOpenRowMenuId(null);
    setLeadFeeMenuOpen(false);
    setPendingDocs([]);
    setDrawerOpen(true);
    void loadDrawerOptions(
      client?.currency_id != null ? String(client.currency_id) : null,
    );
  };

  const closeDrawer = () => {
    if (saving) return;
    setDrawerOpen(false);
    setEditingFeeId(null);
    setEditingLeadFee(false);
    setPendingDocs([]);
  };

  const handleSaveLeadFee = async () => {
    if (!identity) {
      toast.error('Lead identity missing');
      return;
    }
    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum < 0) {
      toast.error('Enter a valid amount');
      return;
    }

    setSaving(true);
    try {
      const roundedAmount = Math.round(amountNum * 100) / 100;
      if (fees.length > 0) {
        const ok = window.confirm(
          'Updating the lead fee will remove existing fee line items and replace them with this amount. Continue?',
        );
        if (!ok) {
          setSaving(false);
          return;
        }
        await deleteAllLeadSubcontractorFees(identity);
        setFees([]);
      }
      const saved = await setLeadSubcontractorFeeScalar(identity, roundedAmount);
      setLeadFeeLocal(saved);
      dispatchSubcontractorFeesChanged({ leadId: client?.id, feeSum: saved });
      toast.success('Lead fee updated');
      setDrawerOpen(false);
      setEditingLeadFee(false);
    } catch (err: any) {
      console.error('[FinancesExpensesFeesPage] save lead fee:', err);
      toast.error(err?.message || 'Failed to update lead fee');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteLeadFee = async () => {
    if (!identity) {
      toast.error('Lead identity missing');
      return;
    }
    setLeadFeeMenuOpen(false);
    const message =
      fees.length > 0
        ? 'Delete lead subcontractor fee and all fee line items?'
        : 'Delete lead subcontractor fee?';
    if (!window.confirm(message)) return;
    try {
      if (fees.length > 0) {
        await deleteAllLeadSubcontractorFees(identity);
        setFees([]);
      }
      await setLeadSubcontractorFeeScalar(identity, 0);
      setLeadFeeLocal(0);
      dispatchSubcontractorFeesChanged({ leadId: client?.id, feeSum: 0 });
      toast.success('Lead fee deleted');
    } catch (err: any) {
      console.error('[FinancesExpensesFeesPage] delete lead fee:', err);
      toast.error(err?.message || 'Failed to delete lead fee');
    }
  };

  const handleSaveFee = async () => {
    if (editingLeadFee) {
      await handleSaveLeadFee();
      return;
    }
    if (!identity) {
      toast.error('Lead identity missing');
      return;
    }
    if (!firmId) {
      toast.error('Choose a firm');
      return;
    }
    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum < 0) {
      toast.error('Enter a valid amount');
      return;
    }
    const currencyNum = currencyId ? Number(currencyId) : NaN;
    if (!Number.isFinite(currencyNum)) {
      toast.error('Choose a currency');
      return;
    }

    setSaving(true);
    try {
      const roundedAmount = Math.round(amountNum * 100) / 100;
      const currencyCode =
        currencies.find((c) => String(c.id) === currencyId)?.iso_code ||
        currencies.find((c) => String(c.id) === currencyId)?.name ||
        null;
      const vendorLabel = firmOptions.find((f) => f.id === firmId)?.name || null;
      const attachPending = async (destinationId: number) => {
        if (!pendingDocs.length) return;
        const entryId = await ensureRegistryForKindDestination({
          kind: 'subcontractor',
          destinationId,
          expenseDate: new Date().toISOString().slice(0, 10),
          amount: roundedAmount,
          currencyCode,
          firmId,
          newLeadId: identity.leadType === 'new' ? identity.newLeadId || null : null,
          legacyLeadId: identity.leadType === 'legacy' ? identity.legacyLeadId || null : null,
          categoryLabel: 'Subcontractor fee',
          vendorLabel,
          notes,
        });
        const uploaded = await uploadFinanceExpenseDocuments(
          entryId,
          pendingDocs.map((d) => ({ file: d.file, documentType: d.documentType })),
        );
        if (uploaded && uploaded < pendingDocs.length) {
          toast.error('Fee saved; some files failed to upload');
        }
      };
      if (editingFeeId != null) {
        await updateLeadSubcontractorFee({
          feeId: editingFeeId,
          firmId,
          amount: roundedAmount,
          currencyId: currencyNum,
          notes,
          updatedBy: user?.id || null,
        });
        await attachPending(editingFeeId);
        toast.success('Fee updated');
      } else {
        try {
          await migrateLeadFeeIntoTableIfNeeded(currencyNum);
        } catch (migErr: any) {
          if (String(migErr?.message || '') === 'CANCELLED') {
            setSaving(false);
            return;
          }
          throw migErr;
        }
        const created = await insertLeadSubcontractorFee({
          identity,
          firmId,
          amount: roundedAmount,
          currencyId: currencyNum,
          notes,
          createdBy: user?.id || null,
        });
        await attachPending(created.id);
        toast.success('Fee added');
      }
      await refreshFeesAndTotals();
      setDrawerOpen(false);
      setEditingFeeId(null);
      setEditingLeadFee(false);
      setPendingDocs([]);
    } catch (err: any) {
      console.error('[FinancesExpensesFeesPage] save fee:', err);
      toast.error(err?.message || (editingFeeId != null ? 'Failed to update fee' : 'Failed to add fee'));
    } finally {
      setSaving(false);
    }
  };

  const handleToggleFeePaid = async (fee: LeadSubcontractorFeeRow) => {
    setOpenRowMenuId(null);
    const nextPaid = !fee.paid;
    try {
      await setLeadSubcontractorFeePaid({
        feeId: fee.id,
        paid: nextPaid,
        updatedBy: user?.id || null,
      });
      setFees((prev) =>
        prev.map((row) =>
          row.id === fee.id
            ? { ...row, paid: nextPaid, paid_at: nextPaid ? new Date().toISOString() : null }
            : row,
        ),
      );
      toast.success(nextPaid ? 'Fee marked paid' : 'Fee marked unpaid');
    } catch (err: any) {
      console.error('[FinancesExpensesFeesPage] toggle paid:', err);
      toast.error(err?.message || 'Failed to update fee status. Run sql/2026-08-23_lead_subcontractor_fees_paid.sql if the paid column is missing.');
    }
  };

  const handleDeleteFee = async (fee: LeadSubcontractorFeeRow) => {
    setOpenRowMenuId(null);
    if (!window.confirm(`Delete fee for ${fee.firms?.name || 'this firm'}?`)) return;
    try {
      await deleteLeadSubcontractorFee(fee.id);
      await refreshFeesAndTotals();
      toast.success('Fee deleted');
    } catch (err: any) {
      console.error('[FinancesExpensesFeesPage] delete fee:', err);
      toast.error(err?.message || 'Failed to delete fee');
    }
  };

  const openNotesModal = (fee: LeadSubcontractorFeeRow) => {
    setNotesModalFee(fee);
    setNotesModalDraft(fee.notes || '');
  };

  const closeNotesModal = () => {
    if (savingNotes) return;
    setNotesModalFee(null);
    setNotesModalDraft('');
  };

  const handleSaveNotes = async () => {
    if (!notesModalFee) return;
    setSavingNotes(true);
    try {
      await updateLeadSubcontractorFeeNotes({
        feeId: notesModalFee.id,
        notes: notesModalDraft,
        updatedBy: user?.id || null,
      });
      setFees((prev) =>
        prev.map((fee) =>
          fee.id === notesModalFee.id
            ? { ...fee, notes: notesModalDraft.trim() || null }
            : fee,
        ),
      );
      toast.success('Notes updated');
      setNotesModalFee(null);
      setNotesModalDraft('');
    } catch (err: any) {
      console.error('[FinancesExpensesFeesPage] save notes:', err);
      toast.error(err?.message || 'Failed to update notes');
    } finally {
      setSavingNotes(false);
    }
  };

  const formatFeeAmount = (fee: LeadSubcontractorFeeRow) => {
    const symbol =
      fee.accounting_currencies?.name ||
      fee.accounting_currencies?.iso_code ||
      '';
    const amountLabel = Number(fee.amount || 0).toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
    return `${symbol ? `${symbol} ` : ''}${amountLabel}`;
  };

  const leadSubcontractorFee =
    leadFeeLocal ?? Number((client as any)?.subcontractor_fee ?? 0);
  const feesTableSum = sumSubcontractorFeeAmounts(fees);
  const leadCurrencySymbol = String(
    (client as any)?.accounting_currencies?.name ||
      (client as any)?.balance_currency ||
      (client as any)?.proposal_currency ||
      (client as any)?.currency ||
      '',
  ).trim();
  // Lead-record row only when there are no fee lines yet (once lines exist, lead.subcontractor_fee = SUM(lines)).
  const showLeadFeeRow =
    fees.length === 0 && Number.isFinite(leadSubcontractorFee) && leadSubcontractorFee > 0;
  const effectiveFeeTotal = fees.length > 0 ? feesTableSum : Math.max(0, leadSubcontractorFee);
  const showFeesTable = fees.length > 0 || showLeadFeeRow;

  const formatLeadFeeAmount = () => {
    const amountLabel = leadSubcontractorFee.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
    return `${leadCurrencySymbol ? `${leadCurrencySymbol} ` : ''}${amountLabel}`;
  };

  const addPendingFiles = (fileList: FileList | File[]) => {
    const incoming = Array.from(fileList);
    setPendingDocs((prev) => {
      const next = [...prev];
      for (const file of incoming) {
        if (next.length >= FINANCE_EXPENSE_DOC_MAX_FILES) {
          toast.error(`You can attach up to ${FINANCE_EXPENSE_DOC_MAX_FILES} files`);
          break;
        }
        const errMsg = validateFinanceExpenseDocumentFile(file);
        if (errMsg) {
          toast.error(errMsg);
          continue;
        }
        const isDup = next.some((d) => d.file.name === file.name && d.file.size === file.size);
        if (isDup) continue;
        next.push({
          localId: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}`,
          file,
          documentType: file.name.toLowerCase().includes('receipt') ? 'receipt' : 'invoice',
        });
      }
      return next;
    });
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:gap-5">
      {/* Fees */}
      <section className="overflow-hidden rounded-2xl bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gray-50">
              <BanknotesIcon className="h-5 w-5 text-slate-600" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-slate-900">Fees</h3>
              <p className="text-xs text-slate-500">
                {loadingFees
                  ? 'Loading…'
                  : !showFeesTable
                    ? 'Subcontractor fees'
                    : fees.length > 0
                      ? `${fees.length} fee${fees.length === 1 ? '' : 's'} · total ${Number(
                          effectiveFeeTotal.toFixed(2),
                        ).toLocaleString(undefined, {
                          minimumFractionDigits: 0,
                          maximumFractionDigits: 2,
                        })}`
                      : `Lead fee · ${formatLeadFeeAmount()}`}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-ghost gap-1 rounded-xl border-0 px-2 text-indigo-700 hover:bg-indigo-50"
            onClick={openAddFeeDrawer}
          >
            <PlusIcon className="h-5 w-5" />
            Add fee
          </button>
        </div>

        {loadingFees ? (
          <div className="flex items-center justify-center py-14">
            <span className="loading loading-spinner loading-md text-primary" />
          </div>
        ) : !showFeesTable ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm text-slate-500">No fees yet. Add a subcontractor fee to get started.</p>
          </div>
        ) : (
          <div className="min-w-0 overflow-x-hidden">
            <table className="table w-full max-w-full table-fixed text-sm">
              <FinanceExpenseLikeColgroup />
              <thead>
                <tr className="border-0 text-xs uppercase tracking-wider text-slate-400">
                  <th className="border-0 bg-transparent font-semibold text-slate-500">Status</th>
                  <th className="border-0 bg-transparent font-semibold text-slate-500">Firm</th>
                  <th className="border-0 bg-transparent font-semibold text-right text-slate-500">Amount</th>
                  <th className="border-0 bg-transparent font-semibold text-slate-500">Notes</th>
                  <th className="border-0 bg-transparent" aria-hidden />
                  <th className="border-0 bg-transparent font-semibold text-right text-slate-500">Added</th>
                  <th className="border-0 bg-transparent w-12 text-center font-semibold text-slate-500">
                    Docs
                  </th>
                  <th className="border-0 bg-transparent w-10" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {showLeadFeeRow ? (
                  <tr className="border-t border-slate-100 bg-slate-50/60">
                    <td>
                      <PaymentStatusPill paid={false} />
                    </td>
                    <td className="font-medium text-slate-900">
                      <span className="inline-flex items-center gap-2">
                        <BuildingOffice2Icon className="h-5 w-5 shrink-0 text-slate-400" />
                        {leadExternalFirmName || (leadExternalFirmId ? 'Firm unavailable' : '—')}
                      </span>
                    </td>
                    <td className="text-right tabular-nums font-semibold text-slate-900">
                      {formatLeadFeeAmount()}
                    </td>
                    <td className="max-w-[12rem] text-slate-500">On lead record</td>
                    <td aria-hidden />
                    <td className="text-right text-slate-400">—</td>
                    <td className="text-center text-slate-300">—</td>
                    <td className="text-right">
                      <button
                        type="button"
                        data-fee-menu-trigger
                        ref={leadFeeMenuButtonRef}
                        className="btn btn-ghost btn-sm btn-circle text-slate-500 hover:bg-slate-100"
                        title="Lead fee actions"
                        aria-label="Lead fee actions"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenRowMenuId(null);
                          setLeadFeeMenuOpen((prev) => !prev);
                        }}
                      >
                        <EllipsisVerticalIcon className="h-5 w-5" />
                      </button>
                      <FeeRowMenuPortal
                        open={leadFeeMenuOpen}
                        anchorEl={leadFeeMenuButtonRef.current}
                        onClose={() => setLeadFeeMenuOpen(false)}
                        onEdit={openEditLeadFeeDrawer}
                        onDelete={() => void handleDeleteLeadFee()}
                      />
                    </td>
                  </tr>
                ) : null}
                {fees.map((fee) => (
                  <tr key={fee.id} className="border-t border-slate-100">
                    <td>
                      <PaymentStatusPill paid={Boolean(fee.paid)} />
                    </td>
                    <td className="font-medium text-slate-900">
                      <span className="inline-flex items-center gap-2">
                        <BuildingOffice2Icon className="h-5 w-5 shrink-0 text-slate-400" />
                        {fee.firms?.name || '—'}
                      </span>
                    </td>
                    <td className="text-right tabular-nums font-semibold text-slate-900">
                      {formatFeeAmount(fee)}
                    </td>
                    <td className="max-w-[12rem]">
                      <button
                        type="button"
                        className="block w-full truncate text-slate-600 hover:text-indigo-700"
                        title={fee.notes?.trim() || 'Click to add notes'}
                        onClick={() => openNotesModal(fee)}
                        dir={getNotesTextDirection(fee.notes)}
                        style={{
                          textAlign: getNotesTextDirection(fee.notes) === 'rtl' ? 'right' : 'left',
                        }}
                      >
                        {fee.notes?.trim() || '—'}
                      </button>
                    </td>
                    <td aria-hidden />
                    <td className="text-right text-slate-500">
                      <span className="whitespace-nowrap">
                        {fee.created_at ? new Date(fee.created_at).toLocaleDateString() : '—'}
                        {fee.created_by_display_name ? (
                          <span className="text-slate-400">
                            {' '}
                            by <span className="font-medium text-slate-600">{fee.created_by_display_name}</span>
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td className="text-center">
                      {(() => {
                        const count = docsByFeeId.get(fee.id)?.documents.length || 0;
                        return (
                          <button
                            type="button"
                            className={`relative inline-flex h-8 w-8 items-center justify-center rounded-full ${
                              count
                                ? 'text-blue-600 hover:bg-blue-50'
                                : 'text-gray-400 hover:bg-blue-50 hover:text-blue-600'
                            }`}
                            title={count ? `${count} document${count === 1 ? '' : 's'}` : 'Add documents'}
                            aria-label={count ? `${count} documents` : 'Add documents'}
                            onClick={() => setDocsRow(feeToDocsRow(fee, docsByFeeId.get(fee.id)))}
                          >
                            <DocumentTextIcon className="h-5 w-5" />
                            {count ? (
                              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-bold leading-none text-white">
                                {count}
                              </span>
                            ) : null}
                          </button>
                        );
                      })()}
                    </td>
                    <td className="text-right">
                      <button
                        type="button"
                        data-fee-menu-trigger
                        ref={(el) => {
                          rowMenuButtonRefs.current[fee.id] = el;
                        }}
                        className="btn btn-ghost btn-sm btn-circle text-slate-500 hover:bg-slate-100"
                        title="Fee actions"
                        aria-label="Fee actions"
                        onClick={(e) => {
                          e.stopPropagation();
                          setLeadFeeMenuOpen(false);
                          setOpenRowMenuId((prev) => (prev === fee.id ? null : fee.id));
                        }}
                      >
                        <EllipsisVerticalIcon className="h-5 w-5" />
                      </button>
                      <FeeRowMenuPortal
                        open={openRowMenuId === fee.id}
                        anchorEl={rowMenuButtonRefs.current[fee.id] || null}
                        onClose={() => setOpenRowMenuId(null)}
                        onEdit={() => openEditFeeDrawer(fee)}
                        onDelete={() => void handleDeleteFee(fee)}
                        paid={Boolean(fee.paid)}
                        onTogglePaid={() => void handleToggleFeePaid(fee)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <FinancesLeadExpensesSection
        client={client}
        openAddExpenseRequest={openAddExpenseRequest}
        onOpenAddExpenseHandled={onOpenAddExpenseHandled}
      />

      {drawerOpen &&
        ReactDOM.createPortal(
          <div className="fixed inset-0 z-[100]">
            <div className="absolute inset-0 bg-black/30" onClick={closeDrawer} />
            <div className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col overflow-hidden bg-white shadow-2xl animate-slideInRight">
              <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-6 py-5">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">
                    {editingLeadFee
                      ? 'Edit lead fee'
                      : editingFeeId != null
                        ? 'Edit fee'
                        : 'Add fee'}
                  </h2>
                  <p className="mt-0.5 text-sm text-slate-500">
                    {editingLeadFee
                      ? `Lead subcontractor fee for ${client?.name || 'this lead'}`
                      : `Subcontractor fee for ${client?.name || 'this lead'}`}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm btn-circle"
                  onClick={closeDrawer}
                  disabled={saving}
                  aria-label="Close"
                >
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>

              <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
                {loadingOptions ? (
                  <div className="flex justify-center py-10">
                    <span className="loading loading-spinner loading-md text-primary" />
                  </div>
                ) : editingLeadFee ? (
                  <div className="form-control">
                    <label className="label py-1">
                      <span className="label-text font-medium text-slate-700">Amount</span>
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="input input-bordered w-full"
                      placeholder="0.00"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      disabled={saving}
                      autoFocus
                    />
                    <p className="mt-2 text-xs text-slate-500">
                      Updates the lead subcontractor fee.
                      {fees.length > 0
                        ? ' Saving will replace existing fee line items.'
                        : ''}
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="form-control relative">
                      <label className="label py-1">
                        <span className="label-text font-medium text-slate-700">Firm</span>
                      </label>
                      <input
                        type="text"
                        className="input input-bordered w-full"
                        placeholder="Select firm…"
                        value={firmSearch}
                        disabled={saving}
                        autoComplete="off"
                        onFocus={() => setFirmDropdownOpen(true)}
                        onChange={(e) => {
                          const next = e.target.value;
                          setFirmSearch(next);
                          setFirmDropdownOpen(true);
                          const exact = firmOptions.find(
                            (f) => f.name.toLowerCase() === next.trim().toLowerCase(),
                          );
                          setFirmId(exact ? exact.id : '');
                        }}
                        onBlur={() => {
                          // Allow click on dropdown item before closing
                          window.setTimeout(() => setFirmDropdownOpen(false), 150);
                        }}
                      />
                      {firmDropdownOpen && (
                        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                          {filteredFirms.length === 0 ? (
                            <div className="px-3 py-2.5 text-sm text-slate-500">No firms found</div>
                          ) : (
                            filteredFirms.map((firm) => (
                              <button
                                key={firm.id}
                                type="button"
                                className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors hover:bg-slate-50 ${
                                  firmId === firm.id ? 'bg-slate-50 font-semibold text-slate-900' : 'text-slate-700'
                                }`}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                  setFirmId(firm.id);
                                  setFirmSearch(firm.name);
                                  setFirmDropdownOpen(false);
                                }}
                              >
                                <BuildingOffice2Icon className="h-4 w-4 shrink-0 text-slate-400" />
                                {firm.name}
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>

                    <div className="form-control">
                      <label className="label py-1">
                        <span className="label-text font-medium text-slate-700">Amount</span>
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className="input input-bordered w-full"
                        placeholder="0.00"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        disabled={saving}
                      />
                    </div>

                    <div className="form-control">
                      <label className="label py-1">
                        <span className="label-text font-medium text-slate-700">Currency</span>
                      </label>
                      <select
                        className="select select-bordered w-full"
                        value={currencyId}
                        onChange={(e) => setCurrencyId(e.target.value)}
                        disabled={saving}
                      >
                        {currencies.length === 0 ? (
                          <option value="">No currencies</option>
                        ) : (
                          currencies.map((curr) => (
                            <option key={curr.id} value={String(curr.id)}>
                              {curr.name}
                              {curr.iso_code ? ` (${curr.iso_code})` : ''}
                            </option>
                          ))
                        )}
                      </select>
                    </div>

                    <div className="form-control">
                      <label className="label py-1">
                        <span className="label-text font-medium text-slate-700">
                          Notes <span className="font-normal text-slate-400">(optional)</span>
                        </span>
                      </label>
                      <textarea
                        className="textarea textarea-bordered w-full min-h-[88px]"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        disabled={saving}
                        placeholder="Optional note"
                        dir={getNotesTextDirection(notes)}
                        style={{
                          direction: getNotesTextDirection(notes),
                          textAlign: getNotesTextDirection(notes) === 'rtl' ? 'right' : 'left',
                        }}
                      />
                    </div>
                    <div className="form-control">
                      <label className="label py-1">
                        <span className="label-text font-medium text-slate-700">Invoices & receipts</span>
                      </label>
                      {editingFeeId != null && (docsByFeeId.get(editingFeeId)?.documents.length || 0) > 0 ? (
                        <p className="mb-2 text-xs text-slate-500">
                          {docsByFeeId.get(editingFeeId)?.documents.length} existing document
                          {(docsByFeeId.get(editingFeeId)?.documents.length || 0) === 1 ? '' : 's'}. Add more below.
                        </p>
                      ) : null}
                      <label
                        className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center hover:border-blue-400 hover:bg-blue-50/40"
                        onDragOver={(e) => {
                          e.preventDefault();
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (e.dataTransfer.files?.length) addPendingFiles(e.dataTransfer.files);
                        }}
                      >
                        <DocumentPlusIcon className="h-8 w-8 text-slate-400" />
                        <span className="text-sm font-medium text-slate-700">Drop PDF or image files here</span>
                        <span className="text-xs text-slate-500">
                          or click to browse · up to {FINANCE_EXPENSE_DOC_MAX_FILES} files
                        </span>
                        <input
                          type="file"
                          className="hidden"
                          multiple
                          accept="application/pdf,image/*,.doc,.docx,.xls,.xlsx"
                          onChange={(e) => {
                            if (e.target.files?.length) addPendingFiles(e.target.files);
                            e.target.value = '';
                          }}
                        />
                      </label>
                      {pendingDocs.length > 0 ? (
                        <ul className="mt-2 space-y-2">
                          {pendingDocs.map((doc) => (
                            <li
                              key={doc.localId}
                              className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-2"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium text-slate-800">{doc.file.name}</p>
                                <p className="text-xs text-slate-500">{Math.round(doc.file.size / 1024)} KB</p>
                              </div>
                              <select
                                className="select select-bordered select-xs w-28"
                                value={doc.documentType}
                                onChange={(e) => {
                                  const nextType = e.target.value as FinanceExpenseDocumentType;
                                  setPendingDocs((prev) =>
                                    prev.map((d) =>
                                      d.localId === doc.localId ? { ...d, documentType: nextType } : d,
                                    ),
                                  );
                                }}
                              >
                                {DOC_TYPES.map((t) => (
                                  <option key={t} value={t}>
                                    {FINANCE_EXPENSE_DOCUMENT_TYPE_LABEL[t]}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                className="btn btn-ghost btn-xs btn-circle"
                                aria-label="Remove file"
                                onClick={() =>
                                  setPendingDocs((prev) => prev.filter((d) => d.localId !== doc.localId))
                                }
                              >
                                <XMarkIcon className="h-4 w-4" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  </>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-4">
                <button
                  type="button"
                  className="btn btn-ghost rounded-xl"
                  onClick={closeDrawer}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn rounded-xl border-0 bg-black text-white hover:bg-slate-800"
                  onClick={() => void handleSaveFee()}
                  disabled={saving || (!editingLeadFee && loadingOptions)}
                >
                  {saving ? (
                    <span className="loading loading-spinner loading-sm" />
                  ) : editingLeadFee || editingFeeId != null ? (
                    <PencilSquareIcon className="h-4 w-4" />
                  ) : (
                    <PlusIcon className="h-4 w-4" />
                  )}
                  {editingLeadFee || editingFeeId != null ? 'Save changes' : 'Save fee'}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {notesModalFee &&
        ReactDOM.createPortal(
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/30" onClick={closeNotesModal} />
            <div className="relative z-[111] flex w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
              <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
                <div className="min-w-0">
                  <h3 className="text-lg font-bold text-slate-900">Fee notes</h3>
                  <p className="mt-0.5 truncate text-sm text-slate-500">
                    {notesModalFee.firms?.name || 'Subcontractor fee'}
                    {' · '}
                    {formatFeeAmount(notesModalFee)}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm btn-circle"
                  onClick={closeNotesModal}
                  disabled={savingNotes}
                  aria-label="Close"
                >
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>
              <div className="px-5 py-4">
                <textarea
                  className="textarea textarea-bordered w-full min-h-[160px] text-sm"
                  value={notesModalDraft}
                  onChange={(e) => setNotesModalDraft(e.target.value)}
                  disabled={savingNotes}
                  placeholder="Add notes…"
                  autoFocus
                  dir={getNotesTextDirection(notesModalDraft)}
                  style={{
                    direction: getNotesTextDirection(notesModalDraft),
                    textAlign: getNotesTextDirection(notesModalDraft) === 'rtl' ? 'right' : 'left',
                  }}
                />
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-4">
                <button
                  type="button"
                  className="btn btn-ghost rounded-xl"
                  onClick={closeNotesModal}
                  disabled={savingNotes}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn rounded-xl border-0 bg-black text-white hover:bg-slate-800"
                  onClick={() => void handleSaveNotes()}
                  disabled={savingNotes}
                >
                  {savingNotes ? <span className="loading loading-spinner loading-sm" /> : null}
                  Save notes
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      <ExpenseDocumentsDrawer
        open={Boolean(docsRow)}
        row={docsRow}
        onClose={() => setDocsRow(null)}
        onChanged={() => void loadFees()}
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

export default FinancesExpensesFeesPage;
