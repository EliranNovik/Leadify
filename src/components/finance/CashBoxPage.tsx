import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import {
  ArrowDownCircleIcon,
  ArrowLeftIcon,
  ArrowUpCircleIcon,
  BanknotesIcon,
  EllipsisVerticalIcon,
  PencilSquareIcon,
  PaperClipIcon,
  PlusIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { fetchLeadExpenseTypes, type LeadExpenseTypeRow } from '../../lib/leadExpenses';
import { fetchActiveStaffEmployees, type ActiveStaffEmployee } from '../../lib/employeeSalaries';
import { useAdminRole } from '../../hooks/useAdminRole';
import DocumentViewerModal, { type DocumentViewerItem } from '../DocumentViewerModal';
import {
  createCashBoxTransaction,
  deleteCashBoxTransaction,
  fetchCashInCategories,
  fetchCashBoxTransactions,
  formatCashBoxNis,
  updateCashBoxTransaction,
  type CashBoxTransaction,
  type CashBoxTransactionInput,
  type CashInCategory,
} from '../../lib/financeCashBox';
import {
  CASH_BOX_DOCUMENT_MAX_FILES,
  FINANCE_CASH_BOX_DOCUMENTS_BUCKET,
  fetchCashBoxDocuments,
  uploadCashBoxDocuments,
  type CashBoxDocument,
} from '../../lib/financeCashBoxDocuments';
import { validateFinanceExpenseDocumentFile } from '../../lib/financeExpenseDocuments';

function localDateIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDate(value: string): string {
  const d = new Date(`${value}T12:00:00`);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function PersonCell({ name, photoUrl }: { name: string | null; photoUrl: string | null }) {
  const label = name?.trim() || '—';
  const initials = label === '—'
    ? '?'
    : label.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  return (
    <div className="flex min-w-0 items-center gap-2">
      {photoUrl ? (
        <img src={photoUrl} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
      ) : (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-600">
          {initials}
        </span>
      )}
      <span className="truncate">{label}</span>
    </div>
  );
}

type DrawerProps = {
  open: boolean;
  edit: CashBoxTransaction | null;
  categories: LeadExpenseTypeRow[];
  cashInCategories: CashInCategory[];
  employees: ActiveStaffEmployee[];
  onClose: () => void;
  onSaved: () => void;
  initialDirection?: 'add' | 'remove';
};

const CashBoxTransactionDrawer: React.FC<DrawerProps> = ({
  open,
  edit,
  categories,
  cashInCategories,
  employees,
  onClose,
  onSaved,
  initialDirection = 'add',
}) => {
  const [direction, setDirection] = useState<'add' | 'remove'>(initialDirection);
  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [employeeDropdownOpen, setEmployeeDropdownOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [date, setDate] = useState(localDateIso);
  const [saving, setSaving] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const employeePickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setDirection(edit ? (edit.amount_nis < 0 ? 'remove' : 'add') : initialDirection);
    setAmount(edit ? String(Math.abs(edit.amount_nis)) : '');
    setCategoryId(
      edit
        ? edit.amount_nis >= 0
          ? edit.cash_in_category_id || ''
          : edit.expense_type_id || ''
        : '',
    );
    setEmployeeId(edit?.employee_id ? String(edit.employee_id) : '');
    setEmployeeSearch(
      edit?.employee_name ||
      employees.find((employee) => employee.id === edit?.employee_id)?.display_name ||
      '',
    );
    setEmployeeDropdownOpen(false);
    setNotes(edit?.notes || '');
    setDate(edit?.transaction_date || localDateIso());
    setPendingFiles([]);
  }, [edit, employees, initialDirection, open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [onClose, open, saving]);

  useEffect(() => {
    if (!employeeDropdownOpen) return;
    const close = (event: MouseEvent) => {
      if (!employeePickerRef.current?.contains(event.target as Node)) {
        setEmployeeDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [employeeDropdownOpen]);

  const filteredEmployees = useMemo(() => {
    const query = employeeSearch.trim().toLowerCase();
    if (!query || employeeId) return employees;
    return employees.filter((employee) => employee.display_name.toLowerCase().includes(query));
  }, [employeeId, employeeSearch, employees]);

  if (!open) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const input: CashBoxTransactionInput = {
      direction,
      amount: Number(amount),
      categoryId: categoryId || null,
      employeeId: employeeId ? Number(employeeId) : null,
      notes,
      transactionDate: date,
    };
    setSaving(true);
    try {
      let transactionId = edit?.id || '';
      if (edit) await updateCashBoxTransaction(edit.id, input);
      else transactionId = await createCashBoxTransaction(input);
      if (pendingFiles.length) await uploadCashBoxDocuments(transactionId, pendingFiles);
      toast.success(edit ? 'Cash box transaction updated' : 'Cash box transaction added');
      onSaved();
      onClose();
    } catch (error: any) {
      toast.error(error?.message || 'Failed to save transaction');
    } finally {
      setSaving(false);
    }
  };

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-[130] flex justify-end">
      <button className="absolute inset-0 bg-black/30 backdrop-blur-[1px]" onClick={onClose} aria-label="Close" />
      <aside className="relative flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
        <div className="flex items-center justify-between px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Cash box</p>
            <h2 className="text-xl font-bold text-gray-900">{edit ? 'Edit transaction' : 'New transaction'}</h2>
          </div>
          <button type="button" className="btn btn-ghost btn-circle" onClick={onClose}>
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
            <div className="grid grid-cols-2 gap-2 rounded-2xl bg-gray-100 p-1.5">
              <button
                type="button"
                onClick={() => {
                  setDirection('add');
                  setCategoryId('');
                }}
                className={`flex items-center justify-center gap-2 rounded-xl px-3 py-3 font-semibold ${direction === 'add' ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500'}`}
              >
                <ArrowUpCircleIcon className="h-6 w-6" /> Add
              </button>
              <button
                type="button"
                onClick={() => {
                  setDirection('remove');
                  setCategoryId('');
                }}
                className={`flex items-center justify-center gap-2 rounded-xl px-3 py-3 font-semibold ${direction === 'remove' ? 'bg-white text-rose-700 shadow-sm' : 'text-gray-500'}`}
              >
                <ArrowDownCircleIcon className="h-6 w-6" /> Withdraw
              </button>
            </div>
            <label className="form-control">
              <span className="label-text mb-2 font-semibold text-gray-600">Amount (NIS)</span>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lg font-bold text-gray-400">₪</span>
                <input
                  autoFocus
                  required
                  min="0.01"
                  step="0.01"
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="input input-bordered w-full rounded-xl pl-10 text-lg font-semibold"
                />
              </div>
            </label>
            <label className="form-control">
              <span className="label-text mb-2 font-semibold text-gray-600">Category</span>
              <select required value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="select select-bordered w-full rounded-xl">
                <option value="">Select category</option>
                {(direction === 'add' ? cashInCategories : categories).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                    {'description' in item && item.description ? ` — ${item.description}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-control" ref={employeePickerRef}>
              <span className="label-text mb-2 font-semibold text-gray-600">Employee</span>
              <div className="relative">
                <input
                  value={employeeSearch}
                  onFocus={() => setEmployeeDropdownOpen(true)}
                  onChange={(event) => {
                    setEmployeeSearch(event.target.value);
                    setEmployeeId('');
                    setEmployeeDropdownOpen(true);
                  }}
                  className="input input-bordered w-full rounded-xl pr-10"
                  placeholder="Search employee..."
                  autoComplete="off"
                />
                {employeeSearch ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-circle btn-xs absolute right-3 top-1/2 -translate-y-1/2"
                    onClick={() => {
                      setEmployeeSearch('');
                      setEmployeeId('');
                      setEmployeeDropdownOpen(true);
                    }}
                    aria-label="Clear employee"
                  >
                    <XMarkIcon className="h-4 w-4" />
                  </button>
                ) : null}
                {employeeDropdownOpen ? (
                  <div className="absolute z-30 mt-2 max-h-64 w-full overflow-y-auto rounded-2xl border border-gray-200 bg-white p-1.5 shadow-xl">
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-gray-500 hover:bg-gray-50"
                      onClick={() => {
                        setEmployeeId('');
                        setEmployeeSearch('');
                        setEmployeeDropdownOpen(false);
                      }}
                    >
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-sm font-semibold">—</span>
                      No employee
                    </button>
                    {filteredEmployees.map((employee) => (
                      <button
                        key={employee.id}
                        type="button"
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-emerald-50"
                        onClick={() => {
                          setEmployeeId(String(employee.id));
                          setEmployeeSearch(employee.display_name);
                          setEmployeeDropdownOpen(false);
                        }}
                      >
                        {employee.photo_url ? (
                          <img src={employee.photo_url} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
                        ) : (
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">
                            {employee.display_name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}
                          </span>
                        )}
                        <span className="truncate font-medium text-gray-800">{employee.display_name}</span>
                      </button>
                    ))}
                    {filteredEmployees.length === 0 ? (
                      <p className="px-3 py-4 text-center text-sm text-gray-500">No employees found</p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
            <label className="form-control">
              <span className="label-text mb-2 font-semibold text-gray-600">Date</span>
              <input required type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input input-bordered w-full rounded-xl" />
            </label>
            <label className="form-control">
              <span className="label-text mb-2 font-semibold text-gray-600">Notes</span>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="textarea textarea-bordered min-h-28 w-full rounded-xl" placeholder="Optional details..." />
            </label>
            <label className="form-control">
              <span className="label-text mb-2 font-semibold text-gray-600">Documents</span>
              <input
                type="file"
                multiple
                accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.doc,.docx,.xls,.xlsx"
                className="file-input file-input-bordered w-full rounded-xl"
                onChange={(event) => {
                  const selected = Array.from(event.target.files || []);
                  const valid: File[] = [];
                  for (const file of selected) {
                    const message = validateFinanceExpenseDocumentFile(file);
                    if (message) toast.error(message);
                    else valid.push(file);
                  }
                  setPendingFiles((current) => [...current, ...valid].slice(0, CASH_BOX_DOCUMENT_MAX_FILES));
                  event.target.value = '';
                }}
              />
              {pendingFiles.length ? (
                <div className="mt-2 space-y-1.5">
                  {pendingFiles.map((file, index) => (
                    <div key={`${file.name}-${index}`} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm">
                      <span className="flex min-w-0 items-center gap-2 truncate"><PaperClipIcon className="h-4 w-4 shrink-0 text-slate-400" />{file.name}</span>
                      <button type="button" className="btn btn-ghost btn-circle btn-xs" onClick={() => setPendingFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                        <XMarkIcon className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </label>
          </div>
          <div className="flex items-center gap-3 p-5">
            <button type="button" className="btn btn-ghost rounded-full px-4 text-gray-500" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button disabled={saving} className={`btn flex-1 rounded-full border-none text-white ${direction === 'add' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'}`}>
              {saving ? <span className="loading loading-spinner loading-sm" /> : edit ? 'Save changes' : direction === 'add' ? 'Add to cash box' : 'Withdraw from cash box'}
            </button>
          </div>
        </form>
      </aside>
    </div>,
    document.body,
  );
};

function CashBoxRowActions({
  onEdit,
  onDelete,
}: {
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, right: 0 });

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const closeOnMove = () => setOpen(false);
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', closeOnMove, true);
    window.addEventListener('resize', closeOnMove);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', closeOnMove, true);
      window.removeEventListener('resize', closeOnMove);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`btn btn-ghost btn-circle btn-sm transition ${open ? 'bg-slate-100 text-slate-900' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-800'}`}
        aria-label="Transaction actions"
        onClick={() => {
          const rect = buttonRef.current?.getBoundingClientRect();
          if (rect) setPosition({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
          setOpen((value) => !value);
        }}
      >
        <EllipsisVerticalIcon className="h-5 w-5" />
      </button>
      {open
        ? ReactDOM.createPortal(
            <div
              ref={menuRef}
              className="fixed z-[140] w-44 overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-2xl"
              style={{ top: position.top, right: position.right }}
            >
              <button
                type="button"
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
                onClick={() => {
                  setOpen(false);
                  onEdit();
                }}
              >
                <PencilSquareIcon className="h-4 w-4 text-slate-400" />
                Edit transaction
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-rose-600 hover:bg-rose-50"
                onClick={() => {
                  setOpen(false);
                  onDelete();
                }}
              >
                <TrashIcon className="h-4 w-4 text-slate-400" />
                Delete
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

const CashBoxPage: React.FC<{
  onBack: () => void;
  openCreateOnMount?: boolean;
  initialTransactionDirection?: 'add' | 'remove';
}> = ({
  onBack,
  openCreateOnMount = false,
  initialTransactionDirection = 'add',
}) => {
  const { isSuperUser } = useAdminRole();
  const [rows, setRows] = useState<CashBoxTransaction[]>([]);
  const [categories, setCategories] = useState<LeadExpenseTypeRow[]>([]);
  const [cashInCategories, setCashInCategories] = useState<CashInCategory[]>([]);
  const [employees, setEmployees] = useState<ActiveStaffEmployee[]>([]);
  const [documentsByTransaction, setDocumentsByTransaction] = useState<Map<string, CashBoxDocument[]>>(new Map());
  const [viewerDocuments, setViewerDocuments] = useState<DocumentViewerItem[]>([]);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(openCreateOnMount);
  const [edit, setEdit] = useState<CashBoxTransaction | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [employeeFilter, setEmployeeFilter] = useState('');
  const [employeeFilterSearch, setEmployeeFilterSearch] = useState('');
  const [employeeFilterOpen, setEmployeeFilterOpen] = useState(false);
  const [movementFilter, setMovementFilter] = useState<'all' | 'added' | 'removed'>('all');
  const employeeFilterRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [transactions, categoryRows, cashInCategoryRows, employeeRows] = await Promise.all([
        fetchCashBoxTransactions(),
        fetchLeadExpenseTypes(),
        fetchCashInCategories(),
        fetchActiveStaffEmployees(),
      ]);
      setRows(transactions);
      setCategories(categoryRows);
      setCashInCategories(cashInCategoryRows);
      setEmployees(employeeRows);
      setDocumentsByTransaction(await fetchCashBoxDocuments(transactions.map((row) => row.id)));
    } catch (error: any) {
      toast.error(error?.message || 'Failed to load cash box');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!employeeFilterOpen) return;
    const close = (event: MouseEvent) => {
      if (!employeeFilterRef.current?.contains(event.target as Node)) {
        setEmployeeFilterOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [employeeFilterOpen]);

  const filteredEmployeeOptions = useMemo(() => {
    const query = employeeFilterSearch.trim().toLowerCase();
    if (!query || employeeFilter) return employees;
    return employees.filter((employee) => employee.display_name.toLowerCase().includes(query));
  }, [employeeFilter, employeeFilterSearch, employees]);

  const balance = useMemo(() => rows.reduce((sum, row) => sum + row.amount_nis, 0), [rows]);
  const periodTotals = useMemo(() => {
    return rows.reduce(
      (totals, row) => {
        if (dateFrom && row.transaction_date < dateFrom) return totals;
        if (dateTo && row.transaction_date > dateTo) return totals;
        if (categoryFilter && row.category_key !== categoryFilter) return totals;
        if (employeeFilter && String(row.employee_id || '') !== employeeFilter) return totals;
        if (row.amount_nis >= 0) totals.added += row.amount_nis;
        else totals.removed += Math.abs(row.amount_nis);
        return totals;
      },
      { added: 0, removed: 0 },
    );
  }, [categoryFilter, dateFrom, dateTo, employeeFilter, rows]);

  const visibleRows = useMemo(
    () => rows.filter((row) => {
      if (dateFrom && row.transaction_date < dateFrom) return false;
      if (dateTo && row.transaction_date > dateTo) return false;
      if (categoryFilter && row.category_key !== categoryFilter) return false;
      if (employeeFilter && String(row.employee_id || '') !== employeeFilter) return false;
      if (movementFilter === 'added') return row.amount_nis >= 0;
      if (movementFilter === 'removed') return row.amount_nis < 0;
      return true;
    }),
    [categoryFilter, dateFrom, dateTo, employeeFilter, movementFilter, rows],
  );

  const remove = async (row: CashBoxTransaction) => {
    if (!window.confirm('Delete this cash box transaction?')) return;
    try {
      await deleteCashBoxTransaction(row.id);
      toast.success('Transaction deleted');
      await load();
    } catch (error: any) {
      toast.error(error?.message || 'Failed to delete transaction');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <button className="btn btn-ghost btn-circle bg-white" onClick={onBack} aria-label="Back to expenses">
            <ArrowLeftIcon className="h-5 w-5" />
          </button>
          <div>
            <p className="text-sm font-medium text-gray-500">Finance</p>
            <h2 className="text-2xl font-bold text-gray-900">Cash box history</h2>
          </div>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-end sm:justify-end">
          <label className="form-control w-full sm:w-40">
            <span className="label-text mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Category</span>
            <select className="select select-bordered h-11 min-h-11 w-full rounded-xl bg-white" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
              <option value="">All categories</option>
              <optgroup label="Cash added">
                {cashInCategories.map((category) => <option key={`in:${category.id}`} value={`in:${category.id}`}>{category.label}</option>)}
              </optgroup>
              <optgroup label="Cash withdrawn">
                {categories.map((category) => <option key={`out:${category.id}`} value={`out:${category.id}`}>{category.label}</option>)}
              </optgroup>
            </select>
          </label>
          <label className="form-control w-full sm:w-40">
            <span className="label-text mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Transaction type</span>
            <select
              className="select select-bordered h-11 min-h-11 w-full rounded-xl bg-white"
              value={movementFilter}
              onChange={(event) => setMovementFilter(event.target.value as 'all' | 'added' | 'removed')}
            >
              <option value="all">All transactions</option>
              <option value="added">Cash added</option>
              <option value="removed">Cash withdrawn</option>
            </select>
          </label>
          <div className="form-control relative w-full sm:w-48" ref={employeeFilterRef}>
            <span className="label-text mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Employee</span>
            <div className="relative">
              <input
                className="input input-bordered h-11 w-full rounded-xl bg-white pr-9"
                placeholder="All employees"
                value={employeeFilterSearch}
                onFocus={() => setEmployeeFilterOpen(true)}
                onChange={(event) => {
                  setEmployeeFilterSearch(event.target.value);
                  setEmployeeFilter('');
                  setEmployeeFilterOpen(true);
                }}
                autoComplete="off"
              />
              {employeeFilterSearch ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-circle btn-xs absolute right-2 top-1/2 -translate-y-1/2"
                  onClick={() => {
                    setEmployeeFilter('');
                    setEmployeeFilterSearch('');
                    setEmployeeFilterOpen(true);
                  }}
                  aria-label="Clear employee filter"
                >
                  <XMarkIcon className="h-4 w-4" />
                </button>
              ) : null}
            </div>
            {employeeFilterOpen ? (
              <div className="absolute right-0 top-full z-40 mt-2 max-h-64 w-full min-w-64 overflow-y-auto rounded-2xl border border-gray-200 bg-white p-1.5 shadow-xl">
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-gray-500 hover:bg-gray-50"
                  onClick={() => {
                    setEmployeeFilter('');
                    setEmployeeFilterSearch('');
                    setEmployeeFilterOpen(false);
                  }}
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-sm font-semibold">—</span>
                  All employees
                </button>
                {filteredEmployeeOptions.map((employee) => (
                  <button
                    key={employee.id}
                    type="button"
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-sky-50"
                    onClick={() => {
                      setEmployeeFilter(String(employee.id));
                      setEmployeeFilterSearch(employee.display_name);
                      setEmployeeFilterOpen(false);
                    }}
                  >
                    {employee.photo_url ? (
                      <img src={employee.photo_url} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
                    ) : (
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-100 text-xs font-bold text-sky-700">
                        {employee.display_name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}
                      </span>
                    )}
                    <span className="truncate font-medium text-gray-800">{employee.display_name}</span>
                  </button>
                ))}
                {filteredEmployeeOptions.length === 0 ? (
                  <p className="px-3 py-4 text-center text-sm text-gray-500">No employees found</p>
                ) : null}
              </div>
            ) : null}
          </div>
          <label className="form-control w-full sm:w-40">
            <span className="label-text mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">From</span>
            <input type="date" className="input input-bordered h-11 w-full rounded-xl bg-white" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
          </label>
          <label className="form-control w-full sm:w-40">
            <span className="label-text mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">To</span>
            <input type="date" className="input input-bordered h-11 w-full rounded-xl bg-white" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
          </label>
          <button
            className="btn h-11 min-h-11 rounded-xl border-none bg-[#391BC8] px-5 text-white hover:bg-[#2f16aa]"
            onClick={() => { setEdit(null); setDrawerOpen(true); }}
          >
            <span className="rounded-full bg-white/20 p-1.5">
              <PlusIcon className="h-4 w-4" />
            </span>
            New transaction
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="flex items-center justify-between rounded-2xl bg-gradient-to-tr from-teal-600 via-emerald-500 to-green-500 p-5 text-white shadow-xl transition-all duration-300 hover:scale-[1.02] hover:shadow-2xl">
          <div>
            <p className="font-medium text-white/90">Current cash balance</p>
            <p className="mt-1 text-3xl font-bold tabular-nums text-white">{formatCashBoxNis(balance)}</p>
          </div>
          <span className="rounded-full bg-white/20 p-3"><BanknotesIcon className="h-8 w-8 text-white" /></span>
        </div>
        <button
          type="button"
          aria-pressed={movementFilter === 'removed'}
          onClick={() => setMovementFilter((value) => value === 'removed' ? 'all' : 'removed')}
          className={`flex items-center justify-between rounded-2xl bg-gradient-to-tr from-pink-500 via-rose-500 to-orange-500 p-5 text-left text-white shadow-xl transition-all duration-300 hover:scale-[1.02] hover:shadow-2xl ${movementFilter === 'removed' ? 'ring-4 ring-rose-200' : ''}`}
        >
          <div>
            <p className="font-medium text-white/90">Cash withdrawn in period</p>
            <p className="mt-1 text-3xl font-bold tabular-nums text-white">{formatCashBoxNis(periodTotals.removed)}</p>
          </div>
          <span className="rounded-full bg-white/20 p-3"><ArrowDownCircleIcon className="h-8 w-8 text-white" /></span>
        </button>
        <button
          type="button"
          aria-pressed={movementFilter === 'added'}
          onClick={() => setMovementFilter((value) => value === 'added' ? 'all' : 'added')}
          className={`flex items-center justify-between rounded-2xl bg-gradient-to-tr from-sky-600 via-cyan-500 to-blue-500 p-5 text-left text-white shadow-xl transition-all duration-300 hover:scale-[1.02] hover:shadow-2xl ${movementFilter === 'added' ? 'ring-4 ring-sky-200' : ''}`}
        >
          <div>
            <p className="font-medium text-white/90">Cash added in period</p>
            <p className="mt-1 text-3xl font-bold tabular-nums text-white">{formatCashBoxNis(periodTotals.added)}</p>
          </div>
          <span className="rounded-full bg-white/20 p-3"><ArrowUpCircleIcon className="h-8 w-8 text-white" /></span>
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="table min-w-[64rem] border-separate border-spacing-0 [&_tbody_td]:bg-white [&_tbody_tr:first-child_td:first-child]:rounded-tl-2xl [&_tbody_tr:first-child_td:last-child]:rounded-tr-2xl [&_tbody_tr:last-child_td:first-child]:rounded-bl-2xl [&_tbody_tr:last-child_td:last-child]:rounded-br-2xl">
          <thead>
            <tr className="text-xs uppercase text-gray-500">
              <th>Date</th><th>Type</th><th>Category</th><th>Employee</th><th>Notes</th><th>Created by</th><th className="text-right">Amount</th><th className="text-center">Documents</th><th />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="rounded-2xl bg-white py-12 text-center"><span className="loading loading-spinner loading-md text-primary" /></td></tr>
            ) : visibleRows.length === 0 ? (
              <tr><td colSpan={9} className="rounded-2xl bg-white py-12 text-center text-gray-500">No cash box transactions yet.</td></tr>
            ) : visibleRows.map((row, index) => (
              <tr key={row.id}>
                <td className={index === 0 ? 'rounded-tl-2xl' : ''}>{formatDate(row.transaction_date)}</td>
                <td><span className={`badge border-0 ${row.amount_nis >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>{row.amount_nis >= 0 ? 'Added' : 'Withdrawn'}</span></td>
                <td>{row.category_label || '—'}</td>
                <td><PersonCell name={row.employee_name} photoUrl={row.employee_photo_url} /></td>
                <td className="max-w-xs truncate" title={row.notes || ''}>{row.notes || '—'}</td>
                <td><PersonCell name={row.created_by_name} photoUrl={row.created_by_photo_url} /></td>
                <td className={`text-right font-bold tabular-nums ${row.amount_nis >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{row.amount_nis >= 0 ? '+' : '−'}{formatCashBoxNis(Math.abs(row.amount_nis))}</td>
                <td className="text-center">
                  {(() => {
                    const documents = documentsByTransaction.get(row.id) || [];
                    return (
                      <button
                        type="button"
                        className={`relative btn btn-ghost btn-circle btn-sm ${documents.length ? 'text-sky-600' : 'text-slate-300'}`}
                        title={documents.length ? `View ${documents.length} document${documents.length === 1 ? '' : 's'}` : 'No documents'}
                        disabled={!documents.length}
                        onClick={() => {
                          setViewerDocuments(documents.map((document) => ({
                            id: String(document.id),
                            name: document.file_name,
                            url: document.storage_path,
                            fileType: document.mime_type || undefined,
                            lastModified: document.created_at,
                            storagePath: document.storage_path,
                            storageBucket: FINANCE_CASH_BOX_DOCUMENTS_BUCKET,
                          })));
                          setViewerIndex(0);
                        }}
                      >
                        <PaperClipIcon className="h-5 w-5" />
                        {documents.length ? <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-sky-600 px-1 text-[10px] font-bold text-white">{documents.length}</span> : null}
                      </button>
                    );
                  })()}
                </td>
                <td>
                  <div className="flex justify-end">
                    {isSuperUser ? (
                      <CashBoxRowActions
                        onEdit={() => { setEdit(row); setDrawerOpen(true); }}
                        onDelete={() => void remove(row)}
                      />
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <CashBoxTransactionDrawer
        open={drawerOpen}
        edit={edit}
        categories={categories}
        cashInCategories={cashInCategories}
        employees={employees}
        onClose={() => { setDrawerOpen(false); setEdit(null); }}
        onSaved={() => void load()}
        initialDirection={initialTransactionDirection}
      />
      <DocumentViewerModal
        isOpen={viewerIndex !== null && viewerDocuments.length > 0}
        onClose={() => {
          setViewerIndex(null);
          setViewerDocuments([]);
        }}
        documents={viewerDocuments}
        initialIndex={viewerIndex ?? 0}
        bucketName={FINANCE_CASH_BOX_DOCUMENTS_BUCKET}
      />
    </div>
  );
};

export default CashBoxPage;
