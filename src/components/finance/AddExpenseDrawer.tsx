import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom';
import { DocumentPlusIcon, MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import {
  fetchLeadExpenseContacts,
  fetchLeadExpenseTypes,
  type LeadExpenseContactOption,
  type LeadExpensePaidBy,
  type LeadExpenseTypeRow,
} from '../../lib/leadExpenses';
import { fetchActiveExpenseTypes, type ExpenseTypeRow } from '../../lib/expenseTypes';
import { FIRM_MANAGEMENT_DEFAULT_CURRENCY } from '../../lib/firmManagementCosts';
import {
  createLeadFinanceExpense,
  createMarketingFinanceExpense,
  createOfficeFinanceExpense,
  createOtherFirmFinanceExpense,
  createSubcontractorFinanceExpense,
  ensureFinanceExpenseRegistry,
  fetchFinanceExpenseEditDetails,
  updateFinanceExpense,
  FINANCE_EXPENSE_KIND_LABEL,
  type FinanceExpenseEntryRow,
  type FinanceExpenseKind,
} from '../../lib/financeExpenseCreate';
import type { LeadFeeIdentity } from '../../lib/leadSubcontractorFees';
import {
  FINANCE_EXPENSE_DOC_MAX_FILES,
  FINANCE_EXPENSE_DOCUMENT_TYPE_LABEL,
  uploadFinanceExpenseDocuments,
  validateFinanceExpenseDocumentFile,
  type FinanceExpenseDocumentType,
} from '../../lib/financeExpenseDocuments';

export type ExpenseDrawerLeadPick = {
  leadType: 'new' | 'legacy';
  newLeadId: string | null;
  legacyLeadId: number | null;
  leadNumber: string | null;
  clientName: string | null;
  currencyId: number | null;
};

type FirmOption = { id: string; name: string };
type CurrencyOption = { id: number; name: string; iso_code: string | null };
type OfficeTypeOption = { id: string; label: string };
type SourceOption = { id: number; name: string };

const KINDS: FinanceExpenseKind[] = ['lead', 'subcontractor', 'other_firm', 'office', 'marketing'];
const ISO_CURRENCIES = ['ILS', 'USD', 'EUR', 'GBP'];
const DOC_TYPES: FinanceExpenseDocumentType[] = ['invoice', 'receipt', 'other'];

type PendingDoc = {
  localId: string;
  file: File;
  documentType: FinanceExpenseDocumentType;
};

function identityFromPick(lead: ExpenseDrawerLeadPick): LeadFeeIdentity {
  if (lead.leadType === 'legacy') {
    return {
      leadType: 'legacy',
      legacyLeadId: lead.legacyLeadId,
      leadNumber: lead.leadNumber,
    };
  }
  return {
    leadType: 'new',
    newLeadId: lead.newLeadId,
    leadNumber: lead.leadNumber,
  };
}

function currentMonthInput(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function localDateIso(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function sanitizeAmountInput(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, '');
  const firstDot = cleaned.indexOf('.');
  let next =
    firstDot === -1
      ? cleaned
      : `${cleaned.slice(0, firstDot + 1)}${cleaned.slice(firstDot + 1).replace(/\./g, '')}`;
  if (next.includes('.')) {
    const [whole, frac = ''] = next.split('.');
    next = `${whole}.${frac.slice(0, 2)}`;
  }
  return next;
}

function currencySign(code: string | null | undefined): string {
  const c = (code || '').trim().toUpperCase();
  if (c === 'ILS' || c === 'NIS') return '₪';
  if (c === 'USD') return '$';
  if (c === 'EUR') return '€';
  if (c === 'GBP') return '£';
  if (c === 'CHF') return 'Fr';
  return '';
}

function currencyOptionLabel(code: string | null | undefined, name?: string | null): string {
  const text = (code || name || '').trim() || '—';
  const sign = currencySign(code || name);
  return sign ? `${sign} ${text}` : text;
}

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  editRow?: FinanceExpenseEntryRow | null;
};

const AddExpenseDrawer: React.FC<Props> = ({ open, onClose, onSaved, editRow = null }) => {
  const [kind, setKind] = useState<FinanceExpenseKind>('lead');
  const [saving, setSaving] = useState(false);

  const [leadQuery, setLeadQuery] = useState('');
  const [leadResults, setLeadResults] = useState<ExpenseDrawerLeadPick[]>([]);
  const [leadSearching, setLeadSearching] = useState(false);
  const [selectedLead, setSelectedLead] = useState<ExpenseDrawerLeadPick | null>(null);

  const [contacts, setContacts] = useState<LeadExpenseContactOption[]>([]);
  const [contactId, setContactId] = useState('');
  const [leadTypes, setLeadTypes] = useState<LeadExpenseTypeRow[]>([]);
  const [leadTypeId, setLeadTypeId] = useState('');
  const [paidBy, setPaidBy] = useState<LeadExpensePaidBy>('client');
  const [includeVat, setIncludeVat] = useState(false);

  const [firms, setFirms] = useState<FirmOption[]>([]);
  const [firmId, setFirmId] = useState('');
  const [firmSearch, setFirmSearch] = useState('');
  const [firmTypes, setFirmTypes] = useState<ExpenseTypeRow[]>([]);
  const [firmTypeId, setFirmTypeId] = useState('');
  const [officeTypes, setOfficeTypes] = useState<OfficeTypeOption[]>([]);
  const [officeTypeId, setOfficeTypeId] = useState('');
  const [sources, setSources] = useState<SourceOption[]>([]);
  const [sourceId, setSourceId] = useState('');
  const [sourceSearch, setSourceSearch] = useState('');

  const [currencies, setCurrencies] = useState<CurrencyOption[]>([]);
  const [currencyId, setCurrencyId] = useState('');
  const [isoCurrency, setIsoCurrency] = useState(FIRM_MANAGEMENT_DEFAULT_CURRENCY);

  const [amount, setAmount] = useState('');
  const [expenseDate, setExpenseDate] = useState(localDateIso);
  const [month, setMonth] = useState(currentMonthInput);
  const [notes, setNotes] = useState('');
  const [paid, setPaid] = useState(false);
  const [paidAt, setPaidAt] = useState('');
  const [pendingDocs, setPendingDocs] = useState<PendingDoc[]>([]);
  const [editLoading, setEditLoading] = useState(false);

  const needsLead = kind === 'lead' || kind === 'subcontractor';
  const needsFirm = kind === 'subcontractor' || kind === 'other_firm' || kind === 'office';
  const usesIsoCurrency = kind === 'other_firm' || kind === 'office' || kind === 'marketing';

  const resetForm = useCallback(() => {
    setKind('lead');
    setLeadQuery('');
    setLeadResults([]);
    setSelectedLead(null);
    setContacts([]);
    setContactId('');
    setLeadTypeId('');
    setPaidBy('client');
    setIncludeVat(false);
    setFirmId('');
    setFirmSearch('');
    setFirmTypeId('');
    setOfficeTypeId('');
    setSourceId('');
    setSourceSearch('');
    setCurrencyId('');
    setIsoCurrency(FIRM_MANAGEMENT_DEFAULT_CURRENCY);
    setAmount('');
    setExpenseDate(localDateIso());
    setMonth(currentMonthInput());
    setNotes('');
    setPaid(false);
    setPaidAt('');
    setPendingDocs([]);
  }, []);

  useEffect(() => {
    if (!open) return;
    if (!editRow) {
      resetForm();
      setEditLoading(false);
    }
  }, [open, editRow, resetForm]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const [typeRes, firmTypeRes, officeTypeRes, currencyRes, firmRes, sourceRes] = await Promise.all([
          fetchLeadExpenseTypes(),
          fetchActiveExpenseTypes(),
          supabase
            .from('office_expense_types')
            .select('id, label, sort_order, is_active')
            .eq('is_active', true)
            .order('sort_order', { ascending: true }),
          supabase.from('accounting_currencies').select('id, name, iso_code').order('name'),
          supabase.from('firms').select('id, name').order('name'),
          supabase.from('misc_leadsource').select('id, name').order('name'),
        ]);
        if (cancelled) return;
        setLeadTypes(typeRes);
        if (typeRes[0]?.id) setLeadTypeId((prev) => prev || typeRes[0].id);
        setFirmTypes(firmTypeRes);
        if (firmTypeRes[0]?.id) setFirmTypeId((prev) => prev || firmTypeRes[0].id);
        const officeRows = (officeTypeRes.data || []).map((r: any) => ({
          id: String(r.id),
          label: String(r.label || ''),
        }));
        setOfficeTypes(officeRows);
        if (officeRows[0]?.id) setOfficeTypeId((prev) => prev || officeRows[0].id);
        const currRows = (currencyRes.data || []).map((r: any) => ({
          id: Number(r.id),
          name: String(r.name || ''),
          iso_code: r.iso_code != null ? String(r.iso_code) : null,
        }));
        setCurrencies(currRows);
        const ils = currRows.find((c) => (c.iso_code || c.name || '').toUpperCase().includes('ILS') || (c.name || '').toUpperCase().includes('NIS'));
        setCurrencyId((prev) => prev || String(ils?.id || currRows[0]?.id || ''));
        setFirms((firmRes.data || []).map((f: any) => ({ id: String(f.id), name: String(f.name || '') })));
        setSources(
          (sourceRes.data || []).map((s: any) => ({ id: Number(s.id), name: String(s.name || `#${s.id}`) })),
        );
      } catch (err) {
        console.warn('[AddExpenseDrawer] lookups:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !editRow) return;
    let cancelled = false;
    setEditLoading(true);
    setPendingDocs([]);
    setKind(editRow.kind);
    setSelectedLead(null);
    setLeadQuery('');
    setLeadResults([]);
    setFirmId('');
    setFirmSearch('');
    setSourceId('');
    setSourceSearch('');
    setContactId('');
    setPaidBy('client');
    setIncludeVat(false);
    setPaid(false);
    setPaidAt('');
    setAmount(editRow.amount != null ? String(editRow.amount) : '');
    setNotes(editRow.notes || '');
    if (editRow.expense_date) {
      const iso = String(editRow.expense_date).slice(0, 10);
      setExpenseDate(iso);
      setMonth(iso.slice(0, 7));
    }
    void (async () => {
      try {
        const details = await fetchFinanceExpenseEditDetails(editRow);
        if (cancelled) return;
        setKind(editRow.kind);
        setAmount(details.amount != null ? String(details.amount) : '');
        setNotes(details.notes);
        if (details.expenseDate) setExpenseDate(details.expenseDate);
        if (details.month) setMonth(details.month);
        if (details.firmId) setFirmId(details.firmId);
        if (details.expenseTypeId) {
          if (editRow.kind === 'lead') setLeadTypeId(details.expenseTypeId);
          else if (editRow.kind === 'other_firm') setFirmTypeId(details.expenseTypeId);
          else if (editRow.kind === 'office') setOfficeTypeId(details.expenseTypeId);
        }
        if (details.currencyId) setCurrencyId(String(details.currencyId));
        if (details.currencyCode) setIsoCurrency(details.currencyCode);
        if (details.contactId != null) setContactId(String(details.contactId));
        setPaidBy(details.paidBy);
        setIncludeVat(details.includeVat);
        setPaid(details.paid);
        setPaidAt(details.paidAt || '');
        if (details.leadSourceId) setSourceId(String(details.leadSourceId));
        if (details.leadType === 'legacy' && details.legacyLeadId != null) {
          setSelectedLead({
            leadType: 'legacy',
            newLeadId: null,
            legacyLeadId: details.legacyLeadId,
            leadNumber: details.leadNumber,
            clientName: details.clientName,
            currencyId: details.currencyId,
          });
        } else if (details.leadType === 'new' && details.newLeadId) {
          setSelectedLead({
            leadType: 'new',
            newLeadId: details.newLeadId,
            legacyLeadId: null,
            leadNumber: details.leadNumber,
            clientName: details.clientName,
            currencyId: details.currencyId,
          });
        }
      } catch (err) {
        console.warn('[AddExpenseDrawer] edit load:', err);
        toast.error('Could not load expense details');
      } finally {
        if (!cancelled) setEditLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, editRow]);

  useEffect(() => {
    if (!open || !selectedLead || kind !== 'lead') {
      if (!editRow) {
        setContacts([]);
        setContactId('');
      }
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const rows = await fetchLeadExpenseContacts(identityFromPick(selectedLead));
        if (cancelled) return;
        setContacts(rows);
        setContactId((prev) => {
          if (prev && rows.some((c) => String(c.id) === prev)) return prev;
          const main = rows.find((c) => c.isMain) || rows[0];
          return main ? String(main.id) : '';
        });
      } catch {
        if (!cancelled && !editRow) {
          setContacts([]);
          setContactId('');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editRow, kind, open, selectedLead]);

  useEffect(() => {
    if (!open || selectedLead) return;
    const q = leadQuery.trim();
    if (q.length < 2) {
      setLeadResults([]);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(() => {
      void (async () => {
        setLeadSearching(true);
        try {
          const pattern = `%${q.replace(/[%_,]/g, '')}%`;
          const digitId = /^\d+$/.test(q) ? Number(q) : NaN;
          const [newRes, legacyByName, legacyById] = await Promise.all([
            supabase
              .from('leads')
              .select('id, name, lead_number, currency_id')
              .or(`lead_number.ilike.${pattern},name.ilike.${pattern}`)
              .limit(12),
            supabase.from('leads_lead').select('id, name, manual_id, currency_id').ilike('name', pattern).limit(12),
            Number.isFinite(digitId)
              ? supabase
                  .from('leads_lead')
                  .select('id, name, manual_id, currency_id')
                  .or(`id.eq.${digitId},manual_id.eq.${q}`)
                  .limit(8)
              : Promise.resolve({ data: [] as any[], error: null }),
          ]);
          if (cancelled) return;
          if (newRes.error) throw newRes.error;
          if (legacyByName.error) throw legacyByName.error;
          const picks: ExpenseDrawerLeadPick[] = [];
          const seenLegacy = new Set<number>();
          for (const row of newRes.data || []) {
            picks.push({
              leadType: 'new',
              newLeadId: String(row.id),
              legacyLeadId: null,
              leadNumber: row.lead_number != null ? String(row.lead_number) : null,
              clientName: row.name != null ? String(row.name).trim() || null : null,
              currencyId:
                row.currency_id != null && Number.isFinite(Number(row.currency_id))
                  ? Number(row.currency_id)
                  : null,
            });
          }
          for (const row of [...(legacyById.data || []), ...(legacyByName.data || [])]) {
            const id = Number(row.id);
            if (!Number.isFinite(id) || seenLegacy.has(id)) continue;
            seenLegacy.add(id);
            picks.push({
              leadType: 'legacy',
              newLeadId: null,
              legacyLeadId: id,
              leadNumber: row.manual_id != null ? String(row.manual_id) : String(id),
              clientName: row.name != null ? String(row.name).trim() || null : null,
              currencyId:
                row.currency_id != null && Number.isFinite(Number(row.currency_id))
                  ? Number(row.currency_id)
                  : null,
            });
          }
          setLeadResults(picks.slice(0, 20));
        } catch (err) {
          console.warn('[AddExpenseDrawer] lead search:', err);
          if (!cancelled) setLeadResults([]);
        } finally {
          if (!cancelled) setLeadSearching(false);
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [leadQuery, open, selectedLead]);

  const filteredFirms = useMemo(() => {
    const q = firmSearch.trim().toLowerCase();
    if (!q) return firms.slice(0, 40);
    return firms.filter((f) => f.name.toLowerCase().includes(q)).slice(0, 40);
  }, [firmSearch, firms]);

  const filteredSources = useMemo(() => {
    const q = sourceSearch.trim().toLowerCase();
    if (!q) return sources.slice(0, 40);
    return sources.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 40);
  }, [sourceSearch, sources]);

  const selectedFirm = firms.find((f) => f.id === firmId) || null;
  const selectedSource = sources.find((s) => String(s.id) === sourceId) || null;
  const selectedCurrency = currencies.find((c) => String(c.id) === currencyId) || null;

  const addFiles = (fileList: FileList | File[]) => {
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

  const close = () => {
    if (saving) return;
    onClose();
  };

  const handleSave = async () => {
    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum < 0) {
      toast.error('Enter a valid amount');
      return;
    }
    const rounded = Math.round(amountNum * 100) / 100;

    setSaving(true);
    try {
      let entryId: number | null = editRow && editRow.id > 0 ? editRow.id : null;
      if (kind === 'lead') {
        if (!selectedLead) throw new Error('Choose a lead');
        if (!leadTypeId) throw new Error('Choose an expense type');
        const cid = Number(contactId);
        if (!Number.isFinite(cid)) throw new Error('Choose a related contact');
        const typeLabel = leadTypes.find((t) => t.id === leadTypeId)?.label || 'Expense';
        if (editRow) {
          await updateFinanceExpense({
            row: editRow,
            identity: identityFromPick(selectedLead),
            expenseTypeId: leadTypeId,
            expenseTypeLabel: typeLabel,
            amount: rounded,
            currencyId: selectedCurrency?.id ?? selectedLead.currencyId,
            currencyCode: selectedCurrency?.iso_code || selectedCurrency?.name || null,
            expenseDate,
            notes,
            includeVat,
            paidBy,
            contactId: cid,
            vendorLabel: selectedLead.clientName || selectedLead.leadNumber,
          });
          toast.success('Expense updated');
        } else {
          const result = await createLeadFinanceExpense({
            identity: identityFromPick(selectedLead),
            expenseTypeId: leadTypeId,
            expenseTypeLabel: typeLabel,
            amount: rounded,
            currencyId: selectedCurrency?.id ?? selectedLead.currencyId,
            currencyCode: selectedCurrency?.iso_code || selectedCurrency?.name || null,
            expenseDate,
            notes,
            includeVat,
            paidBy,
            contactId: cid,
            vendorLabel: selectedLead.clientName || selectedLead.leadNumber,
          });
          entryId = result.entryId;
          toast.success('Lead expense added');
        }
      } else if (kind === 'subcontractor') {
        if (!selectedLead) throw new Error('Choose a lead');
        if (!firmId || !selectedFirm) throw new Error('Choose a firm');
        if (!selectedCurrency) throw new Error('Choose a currency');
        if (editRow) {
          await updateFinanceExpense({
            row: editRow,
            identity: identityFromPick(selectedLead),
            firmId,
            firmName: selectedFirm.name,
            amount: rounded,
            currencyId: selectedCurrency.id,
            currencyCode: selectedCurrency.iso_code || selectedCurrency.name,
            notes,
            expenseDate,
          });
          toast.success('Expense updated');
        } else {
          const result = await createSubcontractorFinanceExpense({
            identity: identityFromPick(selectedLead),
            firmId,
            firmName: selectedFirm.name,
            amount: rounded,
            currencyId: selectedCurrency.id,
            currencyCode: selectedCurrency.iso_code || selectedCurrency.name,
            notes,
            expenseDate,
          });
          entryId = result.entryId;
          toast.success('Subcontractor fee added');
        }
      } else if (kind === 'other_firm') {
        if (!firmId || !selectedFirm) throw new Error('Choose a firm');
        if (!firmTypeId) throw new Error('Choose an expense type');
        const typeLabel = firmTypes.find((t) => t.id === firmTypeId)?.label || 'Firm cost';
        if (editRow) {
          await updateFinanceExpense({
            row: editRow,
            firmId,
            firmName: selectedFirm.name,
            month,
            amount: rounded,
            currencyCode: isoCurrency,
            expenseTypeId: firmTypeId,
            expenseTypeLabel: typeLabel,
            notes,
          });
          toast.success('Expense updated');
        } else {
          const result = await createOtherFirmFinanceExpense({
            firmId,
            firmName: selectedFirm.name,
            billingMonth: month,
            amount: rounded,
            currencyCode: isoCurrency,
            expenseTypeId: firmTypeId,
            expenseTypeLabel: typeLabel,
            notes,
          });
          entryId = result.entryId;
          toast.success('Firm expense added');
        }
      } else if (kind === 'office') {
        if (!firmId || !selectedFirm) throw new Error('Choose a firm');
        if (!officeTypeId) throw new Error('Choose an office expense type');
        const typeLabel = officeTypes.find((t) => t.id === officeTypeId)?.label || 'Office';
        if (editRow) {
          await updateFinanceExpense({
            row: editRow,
            firmId,
            firmName: selectedFirm.name,
            amount: rounded,
            currencyCode: isoCurrency,
            expenseTypeId: officeTypeId,
            expenseTypeLabel: typeLabel,
            notes,
            paid,
            paidAt: paid ? paidAt || expenseDate : null,
            expenseDate,
          });
          toast.success('Expense updated');
        } else {
          const result = await createOfficeFinanceExpense({
            firmId,
            firmName: selectedFirm.name,
            amount: rounded,
            currencyCode: isoCurrency,
            expenseTypeId: officeTypeId,
            expenseTypeLabel: typeLabel,
            description: notes,
            paid,
            paidAt: paid ? paidAt || expenseDate : null,
            expenseDate,
          });
          entryId = result.entryId;
          toast.success('Office expense added');
        }
      } else {
        if (!selectedSource) throw new Error('Choose a lead source');
        if (editRow) {
          await updateFinanceExpense({
            row: editRow,
            amount: rounded,
            month,
            leadSourceId: selectedSource.id,
            leadSourceName: selectedSource.name,
          });
          toast.success('Expense updated');
        } else {
          let result = await createMarketingFinanceExpense({
            leadSourceId: selectedSource.id,
            leadSourceName: selectedSource.name,
            expenseMonth: month,
            amount: rounded,
          });
          if (result.needsConfirm) {
            const ok = window.confirm(
              `This source already has ₪${result.existingAmount?.toLocaleString()} for ${month}. Replace it with ₪${rounded.toLocaleString()}?`,
            );
            if (!ok) {
              setSaving(false);
              return;
            }
            result = await createMarketingFinanceExpense({
              leadSourceId: selectedSource.id,
              leadSourceName: selectedSource.name,
              expenseMonth: month,
              amount: rounded,
              confirmUpdate: true,
            });
            toast.success('Marketing expense updated');
          } else {
            toast.success('Marketing expense added');
          }
          entryId = result.entryId;
        }
      }

      if (pendingDocs.length) {
        if ((!entryId || entryId <= 0) && editRow) {
          entryId = await ensureFinanceExpenseRegistry(editRow);
        }
        if (!entryId) {
          toast.error('Expense saved, but documents could not be attached. Run the finance expense documents SQL.');
        } else {
          const uploaded = await uploadFinanceExpenseDocuments(
            entryId,
            pendingDocs.map((d) => ({ file: d.file, documentType: d.documentType })),
          );
          if (uploaded && uploaded < pendingDocs.length) {
            toast.error('Expense saved; some files failed to upload');
          }
        }
      }
      onSaved();
      onClose();
    } catch (err: any) {
      console.error('[AddExpenseDrawer] save:', err);
      toast.error(err?.message || 'Failed to save expense');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-[100]">
      <div className="absolute inset-0 bg-black/30" onClick={close} />
      <div className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col overflow-hidden bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-6 py-5">
          <div>
            <h2 className="text-xl font-bold text-slate-900">{editRow ? 'Edit expense' : 'New expense'}</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              {editRow ? 'Update this expense in its finance table' : 'Saves into the matching finance table'}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-circle"
            onClick={close}
            disabled={saving}
            aria-label="Close"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="relative flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {editLoading ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70">
              <span className="loading loading-spinner loading-md text-blue-600" />
            </div>
          ) : null}
          <div className="form-control">
            <label className="label py-1">
              <span className="label-text font-medium text-slate-700">Expense type</span>
            </label>
            <select
              className="select select-bordered w-full"
              value={kind}
              disabled={Boolean(editRow) || editLoading}
              onChange={(e) => setKind(e.target.value as FinanceExpenseKind)}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {FINANCE_EXPENSE_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </div>

          {needsLead ? (
            <div className="form-control relative">
              <label className="label py-1">
                <span className="label-text font-medium text-slate-700">Lead</span>
              </label>
              {selectedLead ? (
                <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                  <div className="min-w-0 grow">
                    <div className="font-semibold text-slate-900">
                      {selectedLead.leadNumber || '—'}
                      {selectedLead.clientName ? ` — ${selectedLead.clientName}` : ''}
                    </div>
                    <div className="text-xs text-slate-500">
                      {selectedLead.leadType === 'legacy' ? 'Legacy' : 'New'} lead
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    onClick={() => {
                      setSelectedLead(null);
                      setLeadQuery('');
                    }}
                  >
                    Change
                  </button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      className="input input-bordered w-full pl-9"
                      placeholder="Search lead number or name"
                      value={leadQuery}
                      onChange={(e) => setLeadQuery(e.target.value)}
                    />
                  </div>
                  {leadSearching ? (
                    <p className="mt-2 text-xs text-slate-500">Searching…</p>
                  ) : leadResults.length > 0 ? (
                    <ul className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-sm">
                      {leadResults.map((pick) => (
                        <li key={`${pick.leadType}-${pick.newLeadId || pick.legacyLeadId}`}>
                          <button
                            type="button"
                            className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                            onClick={() => {
                              setSelectedLead(pick);
                              setLeadQuery('');
                              setLeadResults([]);
                              if (pick.currencyId) setCurrencyId(String(pick.currencyId));
                            }}
                          >
                            <span className="font-semibold">{pick.leadNumber || '—'}</span>
                            {pick.clientName ? (
                              <span className="text-slate-600"> — {pick.clientName}</span>
                            ) : null}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </>
              )}
            </div>
          ) : null}

          {kind === 'lead' && selectedLead ? (
            <>
              <div className="form-control">
                <label className="label py-1">
                  <span className="label-text font-medium text-slate-700">Category</span>
                </label>
                <select
                  className="select select-bordered w-full"
                  value={leadTypeId}
                  onChange={(e) => setLeadTypeId(e.target.value)}
                >
                  {leadTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-control">
                <label className="label py-1">
                  <span className="label-text font-medium text-slate-700">Related contact</span>
                </label>
                <select
                  className="select select-bordered w-full"
                  value={contactId}
                  onChange={(e) => setContactId(e.target.value)}
                >
                  <option value="">Select contact</option>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.isMain ? ' (main)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-control">
                <label className="label py-1">
                  <span className="label-text font-medium text-slate-700">Paid by</span>
                </label>
                <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2.5">
                  <span className={`text-sm ${paidBy === 'client' ? 'font-semibold text-slate-800' : 'text-slate-400'}`}>
                    Client
                  </span>
                  <input
                    type="checkbox"
                    className="toggle toggle-primary toggle-sm"
                    checked={paidBy === 'firm'}
                    onChange={(e) => setPaidBy(e.target.checked ? 'firm' : 'client')}
                    aria-label="Paid by office"
                  />
                  <span className={`text-sm ${paidBy === 'firm' ? 'font-semibold text-slate-800' : 'text-slate-400'}`}>
                    Office
                  </span>
                </div>
              </div>
              <div className="form-control">
                <label className="label py-1">
                  <span className="label-text font-medium text-slate-700">VAT</span>
                </label>
                <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2.5">
                  <span className={`text-sm ${!includeVat ? 'font-semibold text-slate-800' : 'text-slate-400'}`}>
                    Without VAT
                  </span>
                  <input
                    type="checkbox"
                    className="toggle toggle-primary toggle-sm"
                    checked={includeVat}
                    onChange={(e) => setIncludeVat(e.target.checked)}
                    aria-label="Include VAT"
                  />
                  <span className={`text-sm ${includeVat ? 'font-semibold text-slate-800' : 'text-slate-400'}`}>
                    With VAT
                  </span>
                </div>
              </div>
            </>
          ) : null}

          {needsFirm ? (
            <div className="form-control">
              <label className="label py-1">
                <span className="label-text font-medium text-slate-700">
                  {kind === 'office' ? 'Firm / vendor' : 'Firm'}
                </span>
              </label>
              <div className="relative mb-2">
                <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  className="input input-bordered w-full pl-9"
                  placeholder="Search firms"
                  value={firmSearch}
                  onChange={(e) => setFirmSearch(e.target.value)}
                />
              </div>
              <select
                className="select select-bordered w-full"
                value={firmId}
                onChange={(e) => setFirmId(e.target.value)}
              >
                <option value="">Select firm</option>
                {filteredFirms.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {kind === 'other_firm' ? (
            <div className="form-control">
              <label className="label py-1">
                <span className="label-text font-medium text-slate-700">Category</span>
              </label>
              <select
                className="select select-bordered w-full"
                value={firmTypeId}
                onChange={(e) => setFirmTypeId(e.target.value)}
              >
                {firmTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {kind === 'office' ? (
            <>
              <div className="form-control">
                <label className="label py-1">
                  <span className="label-text font-medium text-slate-700">Office category</span>
                </label>
                <select
                  className="select select-bordered w-full"
                  value={officeTypeId}
                  onChange={(e) => setOfficeTypeId(e.target.value)}
                >
                  {officeTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm"
                  checked={paid}
                  onChange={(e) => setPaid(e.target.checked)}
                />
                Paid
              </label>
              {paid ? (
                <div className="form-control">
                  <label className="label py-1">
                    <span className="label-text font-medium text-slate-700">Paid date</span>
                  </label>
                  <input
                    type="date"
                    className="input input-bordered w-full"
                    value={paidAt}
                    onChange={(e) => setPaidAt(e.target.value)}
                  />
                </div>
              ) : null}
            </>
          ) : null}

          {kind === 'marketing' ? (
            <div className="form-control">
              <label className="label py-1">
                <span className="label-text font-medium text-slate-700">Lead source</span>
              </label>
              <div className="relative mb-2">
                <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  className="input input-bordered w-full pl-9"
                  placeholder="Search sources"
                  value={sourceSearch}
                  onChange={(e) => setSourceSearch(e.target.value)}
                />
              </div>
              <select
                className="select select-bordered w-full"
                value={sourceId}
                onChange={(e) => setSourceId(e.target.value)}
              >
                <option value="">Select source</option>
                {filteredSources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="flex items-end gap-2">
            <div className="form-control min-w-0 flex-1">
              <label className="label py-1">
                <span className="label-text font-medium text-slate-700">Amount</span>
              </label>
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                className="input input-bordered w-full"
                value={amount}
                placeholder="0.00"
                onKeyDown={(e) => {
                  if (['e', 'E', '+', '-', ' '].includes(e.key)) e.preventDefault();
                }}
                onChange={(e) => setAmount(sanitizeAmountInput(e.target.value))}
              />
            </div>
            <div className="form-control w-40 shrink-0">
              <label className="label py-1">
                <span className="label-text font-medium text-slate-700">Currency</span>
              </label>
              {kind === 'marketing' ? (
                <select className="select select-bordered w-full" value="ILS" disabled>
                  <option value="ILS">{currencyOptionLabel('ILS')}</option>
                </select>
              ) : usesIsoCurrency ? (
                <select
                  className="select select-bordered w-full"
                  value={isoCurrency}
                  onChange={(e) => setIsoCurrency(e.target.value)}
                >
                  {ISO_CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {currencyOptionLabel(c)}
                    </option>
                  ))}
                </select>
              ) : (
                <select
                  className="select select-bordered w-full"
                  value={currencyId}
                  onChange={(e) => setCurrencyId(e.target.value)}
                >
                  {currencies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {currencyOptionLabel(c.iso_code, c.name)}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {kind === 'other_firm' || kind === 'marketing' ? (
            <div className="form-control">
              <label className="label py-1">
                <span className="label-text font-medium text-slate-700">Month</span>
              </label>
              <input
                type="month"
                className="input input-bordered w-full"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
              />
            </div>
          ) : (
            <div className="form-control">
              <label className="label py-1">
                <span className="label-text font-medium text-slate-700">Date</span>
              </label>
              <input
                type="date"
                className="input input-bordered w-full"
                value={expenseDate}
                onChange={(e) => setExpenseDate(e.target.value)}
              />
            </div>
          )}

          <div className="form-control">
            <label className="label py-1">
              <span className="label-text font-medium text-slate-700">Invoices & receipts</span>
            </label>
            <label
              className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center hover:border-blue-400 hover:bg-blue-50/40"
              onDragOver={(e) => {
                e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
              }}
            >
              <DocumentPlusIcon className="h-8 w-8 text-slate-400" />
              <span className="text-sm font-medium text-slate-700">Drop PDF or image files here</span>
              <span className="text-xs text-slate-500">or click to browse · up to {FINANCE_EXPENSE_DOC_MAX_FILES} files</span>
              <input
                type="file"
                className="hidden"
                multiple
                accept="application/pdf,image/*,.doc,.docx,.xls,.xlsx"
                onChange={(e) => {
                  if (e.target.files?.length) addFiles(e.target.files);
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
                          prev.map((d) => (d.localId === doc.localId ? { ...d, documentType: nextType } : d)),
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
                      onClick={() => setPendingDocs((prev) => prev.filter((d) => d.localId !== doc.localId))}
                    >
                      <XMarkIcon className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="form-control">
            <label className="label py-1">
              <span className="label-text font-medium text-slate-700">Notes</span>
            </label>
            <textarea
              className="textarea textarea-bordered w-full"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-4">
          <button
            type="button"
            className="rounded-full px-4 py-2.5 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
            onClick={close}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary h-11 min-h-11 rounded-full px-6"
            onClick={() => void handleSave()}
            disabled={saving || editLoading}
          >
            {saving ? (
              <span className="loading loading-spinner loading-sm" />
            ) : editRow ? (
              'Save changes'
            ) : (
              'Save expense'
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default AddExpenseDrawer;
