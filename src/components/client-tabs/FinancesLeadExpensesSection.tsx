import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import {
  PlusIcon,
  ReceiptPercentIcon,
  XMarkIcon,
  EllipsisVerticalIcon,
  PencilSquareIcon,
  TrashIcon,
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
  paidByLabel,
  resolveLeadFeeIdentity,
  sumLeadExpenseAmounts,
  updateLeadExpense,
  type LeadExpenseContactOption,
  type LeadExpensePaidBy,
  type LeadExpenseRow,
  type LeadExpenseTypeRow,
} from '../../lib/leadExpenses';

type CurrencyOption = { id: number; name: string; iso_code: string | null };

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
          setExpenseTypeId(types[0]?.id || '');
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
          const main = contactRows.find((c) => c.isMain);
          setContactId(main ? String(main.id) : contactRows[0] ? String(contactRows[0].id) : '');
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
    if (!Number.isFinite(contactNum)) {
      toast.error('Select a related client contact');
      return;
    }
    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum < 0) {
      toast.error('Enter a valid amount');
      return;
    }
    const currencyNum = currencyId ? Number(currencyId) : null;
    const reimbursable = isReimbursable;
    const reimbursed = reimbursable && isReimbursed;

    setSaving(true);
    try {
      if (editingId != null) {
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
      } else {
        await insertLeadExpense({
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
          createdBy: user?.id || null,
        });
      }

      toast.success(editingId != null ? 'Expense updated' : 'Expense added');
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

  const formatAmount = (row: LeadExpenseRow) => {
    const symbol =
      row.accounting_currencies?.name || row.accounting_currencies?.iso_code || '';
    const amountLabel = Number(row.amount || 0).toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
    return `${symbol ? `${symbol} ` : ''}${amountLabel}`;
  };

  const total = sumLeadExpenseAmounts(expenses);

  const statusChips = (row: LeadExpenseRow) => {
    const chips: string[] = [paidByLabel(row.paid_by)];
    chips.push(row.include_vat ? 'With VAT' : 'Without VAT');
    if (row.is_reimbursed) chips.push('Reimbursed');
    else if (row.is_reimbursable) chips.push('Reimbursable');
    return chips;
  };

  return (
    <>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
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
          <button
            type="button"
            className="btn btn-sm btn-ghost gap-1 rounded-xl border-0 px-2 text-indigo-700 hover:bg-indigo-50"
            onClick={openAddDrawer}
          >
            <PlusIcon className="h-4 w-4" />
            Add expense
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-14">
            <span className="loading loading-spinner loading-md text-primary" />
          </div>
        ) : expenses.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm text-slate-500">No expenses yet. Add an expense to get started.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table w-full text-sm">
              <thead>
                <tr className="border-0 text-xs uppercase tracking-wider text-slate-400">
                  <th className="border-0 bg-transparent font-semibold text-slate-500">Type</th>
                  <th className="border-0 bg-transparent font-semibold text-right text-slate-500">
                    Amount
                  </th>
                  <th className="border-0 bg-transparent font-semibold text-slate-500">Status</th>
                  <th className="border-0 bg-transparent font-semibold text-slate-500">Client</th>
                  <th className="border-0 bg-transparent w-10" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {expenses.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="font-medium text-slate-900">
                      {row.lead_expense_types?.label || 'Expense'}
                      {row.expense_date ? (
                        <div className="mt-0.5 text-xs font-normal text-slate-400">
                          {row.expense_date}
                        </div>
                      ) : null}
                    </td>
                    <td className="text-right tabular-nums text-slate-800">{formatAmount(row)}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {statusChips(row).map((chip) => (
                          <span
                            key={chip}
                            className="inline-flex rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600"
                          >
                            {chip}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="text-slate-600">
                      {row.leads_contact?.name || '—'}
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
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {drawerOpen &&
        ReactDOM.createPortal(
          <div className="fixed inset-0 z-[100]">
            <div className="absolute inset-0 bg-black/30" onClick={closeDrawer} />
            <div className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col overflow-hidden bg-white shadow-2xl animate-slideInRight">
              <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-6 py-5">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">
                    {editingId != null ? 'Edit expense' : 'Add expense'}
                  </h2>
                  <p className="mt-0.5 text-sm text-slate-500">
                    Creates an Expense row on Finances for the selected contact
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
                ) : (
                  <>
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
                          {currencies.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name || c.iso_code || c.id}
                            </option>
                          ))}
                        </select>
                      </div>
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

                    <div className="space-y-2">
                      <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-slate-200 px-3 py-2.5 hover:bg-slate-50">
                        <input
                          type="checkbox"
                          className="checkbox checkbox-sm"
                          checked={isReimbursable}
                          onChange={(e) => {
                            const next = e.target.checked;
                            setIsReimbursable(next);
                            if (!next) setIsReimbursed(false);
                          }}
                          disabled={saving}
                        />
                        <span className="text-sm text-slate-800">Reimbursable</span>
                      </label>
                      <label
                        className={`flex items-center gap-2.5 rounded-xl border border-slate-200 px-3 py-2.5 ${
                          isReimbursable
                            ? 'cursor-pointer hover:bg-slate-50'
                            : 'cursor-not-allowed opacity-50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="checkbox checkbox-sm"
                          checked={isReimbursed}
                          onChange={(e) => setIsReimbursed(e.target.checked)}
                          disabled={saving || !isReimbursable}
                        />
                        <span className="text-sm text-slate-800">Already reimbursed</span>
                      </label>
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
                  </>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-4">
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
                  className="btn btn-primary"
                  onClick={() => void handleSave()}
                  disabled={saving || loadingOptions || contacts.length === 0}
                >
                  {saving ? (
                    <span className="loading loading-spinner loading-sm" />
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
    </>
  );
};

export default FinancesLeadExpensesSection;
