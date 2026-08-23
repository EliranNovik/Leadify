import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import {
  PlusIcon,
  ReceiptPercentIcon,
  XMarkIcon,
  EllipsisVerticalIcon,
  PencilSquareIcon,
  ScissorsIcon,
  TrashIcon,
  DocumentTextIcon,
  DocumentPlusIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { useAuthContext } from '../../contexts/AuthContext';
import type { ClientTabProps } from '../../types/client';
import {
  deleteLeadExpense,
  fetchLeadExpenseContacts,
  fetchLeadExpenseTypes,
  fetchLeadExpenses,
  insertLeadExpense,
  insertSplitLeadExpenses,
  leadExpenseGrossAmount,
  leadExpenseVatAmount,
  resolveLeadFeeIdentity,
  splitExpenseAmountEvenly,
  updateLeadExpense,
  type LeadExpenseContactOption,
  type LeadExpensePaidBy,
  type LeadExpenseRow,
  type LeadExpenseTypeRow,
  type SplitLeadExpenseTarget,
} from '../../lib/leadExpenses';
import ExpenseSplitTargetPicker from './ExpenseSplitTargetPicker';
import { FinanceExpenseLikeColgroup, getContactAccentSoftStyle, PaymentStatusPill } from './paymentPlanUi';
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

type CurrencyOption = { id: number; name: string; iso_code: string | null };
type PendingDoc = {
  localId: string;
  file: File;
  documentType: FinanceExpenseDocumentType;
};
const DOC_TYPES: FinanceExpenseDocumentType[] = ['invoice', 'receipt', 'other'];

function expenseToDocsRow(
  row: LeadExpenseRow,
  docs?: { entryId: number; documents: FinanceExpenseDocumentRow[] },
): FinanceExpenseEntryRow {
  return {
    id: docs?.entryId || 0,
    listKey: `lead:${row.id}`,
    created_at: row.created_at,
    kind: 'lead',
    destination_table: 'lead_expenses',
    destination_id: String(row.id),
    expense_date: row.expense_date,
    amount: Number(row.amount) || 0,
    currency_code: row.accounting_currencies?.iso_code || row.accounting_currencies?.name || null,
    firm_id: null,
    new_lead_id: row.new_lead_id,
    legacy_lead_id: row.legacy_lead_id,
    category_label: row.lead_expense_types?.label || null,
    vendor_label: row.leads_contact?.name || null,
    lead_number: row.lead_number,
    notes: row.notes,
    created_by: row.created_by,
    created_by_name: null,
    created_by_photo: null,
    documents: docs?.documents || [],
  };
}

type FinancesLeadExpensesSectionProps = Pick<ClientTabProps, 'client'> & {
  /** When set, open the add-expense drawer (from Finances payment Order → Expense no VAT). */
  openAddExpenseRequest?: {
    token: number;
    contactId?: number | null;
    contactName?: string | null;
  } | null;
  onOpenAddExpenseHandled?: () => void;
};

const ExpenseRowMenuPortal: React.FC<{
  open: boolean;
  anchorEl: HTMLButtonElement | null;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}> = ({ open, anchorEl, onClose, onEdit, onDelete }) => {
  const [style, setStyle] = useState<React.CSSProperties>({ visibility: 'hidden' });

  useEffect(() => {
    if (!open || !anchorEl) return;

    const updatePosition = () => {
      const rect = anchorEl.getBoundingClientRect();
      const menuHeight = 96;
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
  }, [open, anchorEl]);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.closest('[data-expense-row-menu]') ||
        target.closest('[data-expense-menu-trigger]')
      ) {
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
      data-expense-row-menu
      style={style}
      className="w-40 rounded-xl border border-slate-200 bg-white p-1 shadow-lg"
    >
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

const FinancesLeadExpensesSection: React.FC<FinancesLeadExpensesSectionProps> = ({
  client,
  openAddExpenseRequest,
  onOpenAddExpenseHandled,
}) => {
  const { user } = useAuthContext();
  const [expenses, setExpenses] = useState<LeadExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [expenseTypes, setExpenseTypes] = useState<LeadExpenseTypeRow[]>([]);
  const [contacts, setContacts] = useState<LeadExpenseContactOption[]>([]);
  const [currencies, setCurrencies] = useState<CurrencyOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [drawerMode, setDrawerMode] = useState<'single' | 'split'>('single');
  const [splitTargets, setSplitTargets] = useState<SplitLeadExpenseTarget[]>([]);
  const [openRowMenuId, setOpenRowMenuId] = useState<number | null>(null);
  const rowMenuButtonRefs = useRef<Record<number, HTMLButtonElement | null>>({});

  const [expenseTypeId, setExpenseTypeId] = useState('');
  const [amount, setAmount] = useState('');
  const [currencyId, setCurrencyId] = useState('');
  const [expenseDate, setExpenseDate] = useState('');
  const [notes, setNotes] = useState('');
  const [paidBy, setPaidBy] = useState<LeadExpensePaidBy>('client');
  const [includeVat, setIncludeVat] = useState(false);
  const [isReimbursable, setIsReimbursable] = useState(false);
  const [isReimbursed, setIsReimbursed] = useState(false);
  const [contactId, setContactId] = useState('');
  const [docsByExpenseId, setDocsByExpenseId] = useState<
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

  const loadExpenses = useCallback(async () => {
    if (!identity) {
      setExpenses([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const rows = await fetchLeadExpenses(identity);
      setExpenses(rows);
      try {
        const docs = await fetchFinanceDocsByDestinationIds(
          'lead_expenses',
          rows.map((row) => row.id),
        );
        const next = new Map<number, { entryId: number; documents: FinanceExpenseDocumentRow[] }>();
        docs.forEach((value, key) => next.set(Number(key), value));
        setDocsByExpenseId(next);
      } catch {
        setDocsByExpenseId(new Map());
      }
    } catch (err: any) {
      console.error('[FinancesLeadExpensesSection] load:', err);
      toast.error(err?.message || 'Failed to load expenses');
    } finally {
      setLoading(false);
    }
  }, [identity]);

  useEffect(() => {
    void loadExpenses();
  }, [loadExpenses]);

  useEffect(() => {
    const onChange = () => {
      void loadExpenses();
    };
    window.addEventListener('paymentPlan:changed', onChange);
    return () => window.removeEventListener('paymentPlan:changed', onChange);
  }, [loadExpenses]);

  const resetForm = () => {
    setEditingId(null);
    setExpenseTypeId('');
    setAmount('');
    setCurrencyId('');
    setExpenseDate('');
    setNotes('');
    setPaidBy('client');
    setIncludeVat(false);
    setIsReimbursable(false);
    setIsReimbursed(false);
    setContactId('');
    setDrawerMode('single');
    setSplitTargets([]);
    setPendingDocs([]);
  };

  const closeDrawer = () => {
    if (saving) return;
    setDrawerOpen(false);
    resetForm();
  };

  const loadDrawerOptions = useCallback(
    async (preferred?: {
      expenseTypeId?: string | null;
      currencyId?: string | null;
      contactId?: string | null;
    }) => {
      if (!identity) return;
      setLoadingOptions(true);
      try {
        const [types, contactRows, currenciesRes] = await Promise.all([
          fetchLeadExpenseTypes(),
          fetchLeadExpenseContacts(identity),
          supabase
            .from('accounting_currencies')
            .select('id, name, iso_code')
            .order('id', { ascending: true }),
        ]);
        if (currenciesRes.error) throw currenciesRes.error;

        setExpenseTypes(types);
        setContacts(contactRows);
        const currencyRows = (currenciesRes.data || []).map((c: any) => ({
          id: Number(c.id),
          name: String(c.name ?? ''),
          iso_code: c.iso_code ?? null,
        }));
        setCurrencies(currencyRows);

        if (
          preferred?.expenseTypeId &&
          types.some((t) => t.id === preferred.expenseTypeId)
        ) {
          setExpenseTypeId(preferred.expenseTypeId);
        } else if (!preferred?.expenseTypeId) {
          setExpenseTypeId('');
        }

        if (
          preferred?.currencyId &&
          currencyRows.some((c) => String(c.id) === String(preferred.currencyId))
        ) {
          setCurrencyId(String(preferred.currencyId));
        } else if (!preferred?.currencyId) {
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

        if (
          preferred?.contactId &&
          contactRows.some((c) => String(c.id) === String(preferred.contactId))
        ) {
          setContactId(String(preferred.contactId));
        } else if (!preferred?.contactId) {
          setContactId('');
        }
      } catch (err: any) {
        console.error('[FinancesLeadExpensesSection] options:', err);
        toast.error(err?.message || 'Failed to load expense options');
      } finally {
        setLoadingOptions(false);
      }
    },
    [identity, client],
  );

  const openAddDrawer = (preferredContact?: {
    contactId?: number | null;
    contactName?: string | null;
  }) => {
    resetForm();
    setDrawerMode('single');
    setDrawerOpen(true);
    void (async () => {
      let preferredContactId: string | null =
        preferredContact?.contactId != null && Number.isFinite(Number(preferredContact.contactId))
          ? String(preferredContact.contactId)
          : null;

      if (!preferredContactId && preferredContact?.contactName && identity) {
        try {
          const contactRows = await fetchLeadExpenseContacts(identity);
          const name = String(preferredContact.contactName).trim().toLowerCase();
          const match = contactRows.find((c) => c.name.trim().toLowerCase() === name);
          if (match) preferredContactId = String(match.id);
        } catch {
          /* ignore */
        }
      }

      await loadDrawerOptions(
        preferredContactId ? { contactId: preferredContactId } : undefined,
      );
    })();
  };

  const openSplitDrawer = () => {
    if (!identity) {
      toast.error('Lead not found');
      return;
    }
    resetForm();
    setDrawerMode('split');
    setDrawerOpen(true);
    void loadDrawerOptions();
  };

  useEffect(() => {
    if (!openAddExpenseRequest?.token) return;
    openAddDrawer({
      contactId: openAddExpenseRequest.contactId,
      contactName: openAddExpenseRequest.contactName,
    });
    onOpenAddExpenseHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open once per request token
  }, [openAddExpenseRequest?.token]);

  const openEditDrawer = (row: LeadExpenseRow) => {
    setOpenRowMenuId(null);
    setDrawerMode('single');
    setEditingId(row.id);
    setExpenseTypeId(row.expense_type_id);
    setAmount(String(row.amount ?? ''));
    setCurrencyId(row.currency_id != null ? String(row.currency_id) : '');
    setExpenseDate(row.expense_date || '');
    setNotes(row.notes || '');
    setPaidBy(row.paid_by);
    setIncludeVat(Boolean(row.include_vat));
    setIsReimbursable(row.is_reimbursable);
    setIsReimbursed(row.is_reimbursed);
    setContactId(row.contact_id != null ? String(row.contact_id) : '');
    setDrawerOpen(true);
    void loadDrawerOptions({
      expenseTypeId: row.expense_type_id,
      currencyId: row.currency_id != null ? String(row.currency_id) : null,
      contactId: row.contact_id != null ? String(row.contact_id) : null,
    });
  };

  const handleSave = async () => {
    if (!identity) {
      toast.error('Lead not found');
      return;
    }
    if (!expenseTypeId) {
      toast.error('Select an expense type');
      return;
    }
    const contactNum = contactId ? Number(contactId) : NaN;
    if (drawerMode === 'single' && !Number.isFinite(contactNum)) {
      toast.error('Select a related client contact');
      return;
    }
    if (drawerMode === 'split' && splitTargets.length < 2) {
      toast.error('Select at least two lead contacts');
      return;
    }
    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum < 0) {
      toast.error('Enter a valid amount');
      return;
    }
    if (drawerMode === 'split' && amountNum <= 0) {
      toast.error('Enter a total amount greater than zero');
      return;
    }
    const currencyNum = currencyId ? Number(currencyId) : null;
    const reimbursable = drawerMode !== 'split' && editingId != null ? isReimbursable : false;
    const reimbursed = reimbursable && isReimbursed;
    const currencyCode =
      currencies.find((c) => String(c.id) === currencyId)?.iso_code ||
      currencies.find((c) => String(c.id) === currencyId)?.name ||
      null;
    const categoryLabel = expenseTypes.find((type) => type.id === expenseTypeId)?.label || null;
    const vendorLabel =
      contacts.find((contact) => String(contact.id) === contactId)?.name || null;

    const attachPending = async (destinationId: number) => {
      if (!pendingDocs.length || drawerMode === 'split') return;
      const entryId = await ensureRegistryForKindDestination({
        kind: 'lead',
        destinationId,
        expenseDate: expenseDate || null,
        amount: amountNum,
        currencyCode,
        newLeadId: identity.leadType === 'new' ? identity.newLeadId || null : null,
        legacyLeadId: identity.leadType === 'legacy' ? identity.legacyLeadId || null : null,
        categoryLabel,
        vendorLabel,
        notes,
      });
      const uploaded = await uploadFinanceExpenseDocuments(
        entryId,
        pendingDocs.map((d) => ({ file: d.file, documentType: d.documentType })),
      );
      if (uploaded && uploaded < pendingDocs.length) {
        toast.error('Expense saved; some files failed to upload');
      }
    };

    setSaving(true);
    try {
      if (drawerMode === 'split') {
        await insertSplitLeadExpenses({
          targets: splitTargets,
          expenseTypeId,
          totalAmount: amountNum,
          currencyId: Number.isFinite(currencyNum as number) ? currencyNum : null,
          expenseDate: expenseDate || null,
          notes,
          includeVat,
          paidBy,
          isReimbursable: false,
          isReimbursed: false,
        });
      } else if (editingId != null) {
        await updateLeadExpense({
          expenseId: editingId,
          identity,
          expenseTypeId,
          amount: amountNum,
          currencyId: Number.isFinite(currencyNum as number) ? currencyNum : null,
          expenseDate: expenseDate || null,
          notes,
          includeVat,
          paidBy,
          isReimbursable: reimbursable,
          isReimbursed: reimbursed,
          contactId: contactNum,
          updatedBy: user?.id || null,
        });
        await attachPending(editingId);
      } else {
        const created = await insertLeadExpense({
          identity,
          expenseTypeId,
          amount: amountNum,
          currencyId: Number.isFinite(currencyNum as number) ? currencyNum : null,
          expenseDate: expenseDate || null,
          notes,
          includeVat,
          paidBy,
          isReimbursable: false,
          isReimbursed: false,
          contactId: contactNum,
          createdBy: user?.id || null,
        });
        await attachPending(created.id);
      }

      toast.success(
        drawerMode === 'split'
          ? `Expense split across ${splitTargets.length} contacts`
          : editingId != null
            ? 'Expense updated'
            : 'Expense added',
      );
      setDrawerOpen(false);
      resetForm();
      await loadExpenses();
    } catch (err: any) {
      console.error('[FinancesLeadExpensesSection] save:', err);
      toast.error(err?.message || 'Failed to save expense');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row: LeadExpenseRow) => {
    setOpenRowMenuId(null);
    if (!window.confirm('Delete this expense and its Finances payment row?')) return;
    try {
      await deleteLeadExpense(row.id, identity);
      toast.success('Expense deleted');
      await loadExpenses();
    } catch (err: any) {
      console.error('[FinancesLeadExpensesSection] delete:', err);
      toast.error(err?.message || 'Failed to delete expense');
    }
  };

  const formatMoney = (row: LeadExpenseRow, value: number) => {
    const symbol =
      row.accounting_currencies?.name || row.accounting_currencies?.iso_code || '';
    const amountLabel = Number(value || 0).toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
    return `${symbol ? `${symbol} ` : ''}${amountLabel}`;
  };

  const total = expenses.reduce((sum, row) => sum + leadExpenseGrossAmount(row), 0);
  const splitAmounts = useMemo(
    () => splitExpenseAmountEvenly(Number(amount), splitTargets.length),
    [amount, splitTargets.length],
  );
  const splitCurrencyLabel =
    currencies.find((currency) => String(currency.id) === currencyId)?.name ||
    currencies.find((currency) => String(currency.id) === currencyId)?.iso_code ||
    '';

  const expensesByContact = useMemo(() => {
    const groups = new Map<
      string,
      { key: string; name: string; rows: LeadExpenseRow[] }
    >();
    for (const row of expenses) {
      const name = row.leads_contact?.name?.trim() || 'Unassigned';
      const key = row.contact_id != null ? `id:${row.contact_id}` : `name:${name}`;
      const existing = groups.get(key);
      if (existing) existing.rows.push(row);
      else groups.set(key, { key, name, rows: [row] });
    }
    return [...groups.values()].sort((a, b) => {
      if (a.name === 'Unassigned') return 1;
      if (b.name === 'Unassigned') return -1;
      return a.name.localeCompare(b.name);
    });
  }, [expenses]);

  const formatGroupTotal = (rows: LeadExpenseRow[]) => {
    const byCurrency = new Map<string, number>();
    for (const row of rows) {
      const symbol =
        row.accounting_currencies?.name || row.accounting_currencies?.iso_code || '';
      byCurrency.set(symbol, (byCurrency.get(symbol) || 0) + leadExpenseGrossAmount(row));
    }
    return [...byCurrency.entries()]
      .map(([symbol, value]) => {
        const amountLabel = Number(value || 0).toLocaleString(undefined, {
          minimumFractionDigits: 0,
          maximumFractionDigits: 2,
        });
        return `${symbol ? `${symbol} ` : ''}${amountLabel}`;
      })
      .join(' · ');
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

  const openExpenseDocuments = (row: LeadExpenseRow) => {
    setDocsRow(expenseToDocsRow(row, docsByExpenseId.get(row.id)));
  };

  return (
    <>
      <section className="w-full">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gray-50">
              <ReceiptPercentIcon className="h-5 w-5 text-slate-600" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-slate-900">Expenses</h3>
              <p className="text-xs text-slate-500">
                {loading
                  ? 'Loading…'
                  : expenses.length === 0
                    ? 'Case expenses · synced to Finances'
                    : `${expenses.length} expense${expenses.length === 1 ? '' : 's'} · total ${Number(
                        total.toFixed(2),
                      ).toLocaleString(undefined, {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 2,
                      })}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="btn btn-sm btn-ghost gap-1 rounded-xl border-0 px-2 text-indigo-700 hover:bg-indigo-50"
              onClick={openAddDrawer}
            >
              <PlusIcon className="h-5 w-5" />
              Add expense
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost gap-1 rounded-xl border-0 px-2 text-indigo-700 hover:bg-indigo-50"
              onClick={openSplitDrawer}
            >
              <ScissorsIcon className="h-5 w-5" />
              Split
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-14">
            <span className="loading loading-spinner loading-md text-primary" />
          </div>
        ) : expenses.length === 0 ? (
          <div className="w-full overflow-hidden rounded-2xl bg-white">
            <div className="px-6 py-12 text-center">
              <p className="text-sm text-slate-500">No expenses added</p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {expensesByContact.map((group) => {
              const initials = group.name
                .trim()
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 2)
                .map((part) => part.charAt(0).toUpperCase())
                .join('') || '?';
              const avatarStyle = getContactAccentSoftStyle(group.name);
              return (
                <div
                  key={group.key}
                  className="w-full overflow-hidden rounded-2xl bg-white"
                >
                  <div className="overflow-x-auto bg-white">
                    <table className="table w-full table-fixed text-sm">
                      <FinanceExpenseLikeColgroup />
                      <thead>
                        <tr className="border-0">
                          <th colSpan={8} className="border-0 bg-transparent px-4 py-3">
                            <div className="flex min-w-0 items-center gap-3">
                              <span
                                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
                                style={avatarStyle}
                              >
                                {initials}
                              </span>
                              <div className="min-w-0">
                                <p className="truncate text-base font-semibold text-slate-800">{group.name}</p>
                                <p className="text-sm font-normal text-slate-500">
                                  {group.rows.length} expense{group.rows.length === 1 ? '' : 's'}
                                </p>
                              </div>
                            </div>
                          </th>
                        </tr>
                        <tr className="border-0 text-xs uppercase tracking-wider text-slate-400">
                          <th className="border-0 bg-transparent font-semibold text-slate-500">Status</th>
                          <th className="border-0 bg-transparent font-semibold text-slate-500">Type</th>
                          <th className="border-0 bg-transparent font-semibold text-right text-slate-500">
                            Amount
                          </th>
                          <th className="border-0 bg-transparent font-semibold text-right text-slate-500">
                            Total
                          </th>
                          <th className="border-0 bg-transparent font-semibold text-slate-500">Paid by</th>
                          <th className="border-0 bg-transparent font-semibold text-right text-slate-500">
                            Added
                          </th>
                          <th className="border-0 bg-transparent w-12 text-center font-semibold text-slate-500">
                            Docs
                          </th>
                          <th className="border-0 bg-transparent w-10" aria-label="Actions" />
                        </tr>
                      </thead>
                      <tbody>
                        {group.rows.map((row) => {
                          const vatAmount = leadExpenseVatAmount(row);
                          return (
                            <tr key={row.id} className="border-t border-slate-100">
                              <td>
                                <PaymentStatusPill paid={Boolean(row.paid)} />
                              </td>
                              <td className="font-medium text-slate-900">
                                {row.lead_expense_types?.label || 'Expense'}
                              </td>
                              <td className="text-right tabular-nums text-slate-800">
                                <div>{formatMoney(row, Number(row.amount) || 0)}</div>
                                {vatAmount > 0 ? (
                                  <div className="text-xs font-normal text-slate-500">
                                    + {formatMoney(row, vatAmount)} VAT
                                  </div>
                                ) : null}
                              </td>
                              <td className="text-right font-semibold tabular-nums text-slate-900">
                                {formatMoney(row, leadExpenseGrossAmount(row))}
                              </td>
                              <td>
                                <span
                                  className={`inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold uppercase leading-tight tracking-wide ${
                                    row.paid_by === 'firm' ? 'text-slate-700' : 'text-sky-600'
                                  }`}
                                >
                                  {row.paid_by === 'firm' ? 'Firm' : 'Client'}
                                </span>
                              </td>
                              <td className="text-right text-slate-500">
                                <span className="whitespace-nowrap">
                                  {row.created_at ? new Date(row.created_at).toLocaleDateString() : '—'}
                                  {row.created_by_display_name ? (
                                    <span className="text-slate-400">
                                      {' '}
                                      by <span className="font-medium text-slate-600">{row.created_by_display_name}</span>
                                    </span>
                                  ) : null}
                                </span>
                              </td>
                              <td className="text-center">
                                {(() => {
                                  const count = docsByExpenseId.get(row.id)?.documents.length || 0;
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
                                      onClick={() => openExpenseDocuments(row)}
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
                                  data-expense-menu-trigger
                                  ref={(el) => {
                                    rowMenuButtonRefs.current[row.id] = el;
                                  }}
                                  className="btn btn-ghost btn-xs btn-circle"
                                  onClick={() =>
                                    setOpenRowMenuId((prev) => (prev === row.id ? null : row.id))
                                  }
                                  aria-label="Expense actions"
                                >
                                  <EllipsisVerticalIcon className="h-4 w-4" />
                                </button>
                                <ExpenseRowMenuPortal
                                  open={openRowMenuId === row.id}
                                  anchorEl={rowMenuButtonRefs.current[row.id] || null}
                                  onClose={() => setOpenRowMenuId(null)}
                                  onEdit={() => openEditDrawer(row)}
                                  onDelete={() => void handleDelete(row)}
                                />
                              </td>
                            </tr>
                          );
                        })}
                        <tr className="border-t-2 border-slate-200">
                          <td colSpan={3} className="py-3.5" />
                          <td className="py-3.5 text-right text-base font-semibold tabular-nums text-slate-900">
                            {formatGroupTotal(group.rows)}
                          </td>
                          <td colSpan={4} className="py-3.5" />
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {drawerOpen &&
        ReactDOM.createPortal(
          <div className="fixed inset-0 z-[100]">
            <div className="absolute inset-0 bg-black/30" onClick={closeDrawer} />
            <div
              className={`absolute inset-y-0 right-0 flex w-full flex-col overflow-hidden bg-white shadow-2xl animate-slideInRight ${
                drawerMode === 'split' ? 'max-w-xl' : 'max-w-md'
              }`}
            >
              <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-6 py-5">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">
                    {drawerMode === 'split'
                      ? 'Split expense'
                      : editingId != null
                        ? 'Edit expense'
                        : 'Add expense'}
                  </h2>
                  {drawerMode === 'split' ? (
                    <p className="mt-0.5 text-sm text-slate-500">
                      Split one total across two or more lead contacts
                    </p>
                  ) : null}
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
                ) : (
                  <div className="space-y-5">
                    <div className="form-control">
                      <label className="label py-1">
                        <span className="label-text font-medium text-slate-700">Expense type</span>
                      </label>
                      <select
                        className="select select-bordered w-full"
                        value={expenseTypeId}
                        onChange={(e) => setExpenseTypeId(e.target.value)}
                        disabled={saving}
                      >
                        <option value="" disabled>
                          Select type…
                        </option>
                        {expenseTypes.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
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
                          {currencies.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name || c.iso_code || c.id}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="form-control">
                        <label className="label py-1">
                          <span className="label-text font-medium text-slate-700">Due date</span>
                        </label>
                        <input
                          type="date"
                          className="input input-bordered w-full"
                          value={expenseDate}
                          onChange={(e) => setExpenseDate(e.target.value)}
                          disabled={saving}
                        />
                      </div>
                    </div>

                    <div className="form-control">
                      <label className="label py-1">
                        <span className="label-text font-medium text-slate-700">
                          {drawerMode === 'split' ? 'Total amount' : 'Amount'}
                        </span>
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

                    {drawerMode === 'split' && identity ? (
                      <div className="space-y-3">
                        <ExpenseSplitTargetPicker
                          currentIdentity={identity}
                          currentLeadName={client?.name || identity.leadNumber || 'Current lead'}
                          disabled={saving}
                          onChange={setSplitTargets}
                        />
                        <div className="rounded-xl bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
                          {splitTargets.length < 2 ||
                          splitAmounts.length === 0 ||
                          Number(amount) <= 0 ? (
                            <span>Select at least two contacts to preview the split.</span>
                          ) : (
                            <span>
                              The total will create {splitTargets.length} expense rows.{' '}
                              {Math.min(...splitAmounts) === Math.max(...splitAmounts)
                                ? `Each contact receives ${splitCurrencyLabel} ${splitAmounts[0].toFixed(2)}.`
                                : `Shares range from ${splitCurrencyLabel} ${Math.min(
                                    ...splitAmounts,
                                  ).toFixed(2)} to ${splitCurrencyLabel} ${Math.max(
                                    ...splitAmounts,
                                  ).toFixed(2)} so the total remains exact.`}
                            </span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="form-control">
                        <label className="label py-1">
                          <span className="label-text font-medium text-slate-700">
                            Related client
                          </span>
                        </label>
                        <select
                          className="select select-bordered w-full"
                          value={contactId}
                          onChange={(e) => setContactId(e.target.value)}
                          disabled={saving}
                        >
                          <option value="" disabled>
                            Select contact…
                          </option>
                          {contacts.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                              {c.isMain ? ' (main)' : ''}
                            </option>
                          ))}
                        </select>
                        {contacts.length === 0 ? (
                          <p className="mt-1.5 text-xs text-amber-700">
                            No contacts on this lead. Add a contact before creating an expense.
                          </p>
                        ) : (
                          <p className="mt-1.5 text-xs text-slate-500">
                            Finances payment row will appear under this contact.
                          </p>
                        )}
                      </div>
                    )}

                    <div className="form-control">
                      <label className="label py-1">
                        <span className="label-text font-medium text-slate-700">Paid by</span>
                      </label>
                      <div
                        role="group"
                        aria-label="Paid by"
                        className="inline-flex w-full rounded-full bg-slate-100/90 p-1"
                      >
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => setPaidBy('client')}
                          className={`flex-1 rounded-full px-3 py-2 text-sm transition ${
                            paidBy === 'client'
                              ? 'bg-white font-semibold text-slate-900 shadow-sm'
                              : 'font-medium text-slate-500 hover:text-slate-700'
                          }`}
                        >
                          Client
                        </button>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => setPaidBy('firm')}
                          className={`flex-1 rounded-full px-3 py-2 text-sm transition ${
                            paidBy === 'firm'
                              ? 'bg-white font-semibold text-slate-900 shadow-sm'
                              : 'font-medium text-slate-500 hover:text-slate-700'
                          }`}
                        >
                          Firm
                        </button>
                      </div>
                    </div>

                    <div className="form-control">
                      <label className="label py-1">
                        <span className="label-text font-medium text-slate-700">VAT</span>
                      </label>
                      <div
                        role="group"
                        aria-label="VAT"
                        className="inline-flex w-full rounded-full bg-slate-100/90 p-1"
                      >
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => setIncludeVat(false)}
                          className={`flex-1 rounded-full px-3 py-2 text-sm transition ${
                            !includeVat
                              ? 'bg-white font-semibold text-slate-900 shadow-sm'
                              : 'font-medium text-slate-500 hover:text-slate-700'
                          }`}
                        >
                          Without VAT
                        </button>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => setIncludeVat(true)}
                          className={`flex-1 rounded-full px-3 py-2 text-sm transition ${
                            includeVat
                              ? 'bg-white font-semibold text-slate-900 shadow-sm'
                              : 'font-medium text-slate-500 hover:text-slate-700'
                          }`}
                        >
                          With VAT
                        </button>
                      </div>
                    </div>

                    <div className="form-control">
                      <label className="label py-1">
                        <span className="label-text font-medium text-slate-700">Notes</span>
                      </label>
                      <textarea
                        className="textarea textarea-bordered min-h-[88px] w-full"
                        placeholder="Optional notes…"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        disabled={saving}
                        dir={/[\u0590-\u05FF]/.test(notes) ? 'rtl' : 'ltr'}
                      />
                    </div>

                    {drawerMode === 'split' ? (
                      <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                        Add invoices or receipts on each expense after the split.
                      </p>
                    ) : (
                      <div className="form-control">
                        <label className="label py-1">
                          <span className="label-text font-medium text-slate-700">Invoices & receipts</span>
                        </label>
                        {editingId != null && (docsByExpenseId.get(editingId)?.documents.length || 0) > 0 ? (
                          <p className="mb-2 text-xs text-slate-500">
                            {docsByExpenseId.get(editingId)?.documents.length} existing document
                            {(docsByExpenseId.get(editingId)?.documents.length || 0) === 1 ? '' : 's'}. Add more below.
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
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-2 px-6 py-4">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={closeDrawer}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary min-w-28"
                  onClick={() => void handleSave()}
                  disabled={saving || loadingOptions}
                >
                  {saving ? (
                    <span className="loading loading-spinner loading-sm" />
                  ) : drawerMode === 'split' ? (
                    'Split expense'
                  ) : editingId != null ? (
                    'Save changes'
                  ) : (
                    'Add expense'
                  )}
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
        onChanged={() => void loadExpenses()}
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
    </>
  );
};

export default FinancesLeadExpensesSection;
