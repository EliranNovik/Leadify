import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom';
import {
  BuildingOffice2Icon,
  MagnifyingGlassIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import { useAuthContext } from '../contexts/AuthContext';
import {
  insertLeadSubcontractorFee,
  type LeadFeeIdentity,
} from '../lib/leadSubcontractorFees';

type FirmOption = { id: string; name: string; profileImageUrl: string | null };
type CurrencyOption = { id: number; name: string; iso_code: string | null };

export type FeeDrawerLeadPick = {
  leadType: 'new' | 'legacy';
  newLeadId: string | null;
  legacyLeadId: number | null;
  leadNumber: string | null;
  clientName: string | null;
  currencyId: number | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** Pre-select a lead when opened from a row. */
  initialLead?: FeeDrawerLeadPick | null;
  firmOptions: FirmOption[];
};

function identityFromPick(lead: FeeDrawerLeadPick): LeadFeeIdentity {
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

const SubcontractorFeeAddDrawer: React.FC<Props> = ({
  open,
  onClose,
  onSaved,
  initialLead = null,
  firmOptions,
}) => {
  const { user } = useAuthContext();
  const [leadQuery, setLeadQuery] = useState('');
  const [leadResults, setLeadResults] = useState<FeeDrawerLeadPick[]>([]);
  const [leadSearching, setLeadSearching] = useState(false);
  const [selectedLead, setSelectedLead] = useState<FeeDrawerLeadPick | null>(null);
  const [firmId, setFirmId] = useState('');
  const [firmSearch, setFirmSearch] = useState('');
  const [firmDropdownOpen, setFirmDropdownOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [currencyId, setCurrencyId] = useState('');
  const [currencies, setCurrencies] = useState<CurrencyOption[]>([]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadingCurrencies, setLoadingCurrencies] = useState(false);

  const resetForm = useCallback((lead: FeeDrawerLeadPick | null) => {
    setSelectedLead(lead);
    setLeadQuery(
      lead
        ? [lead.leadNumber, lead.clientName].filter(Boolean).join(' — ')
        : '',
    );
    setLeadResults([]);
    setFirmId('');
    setFirmSearch('');
    setFirmDropdownOpen(false);
    setAmount('');
    setNotes('');
    setCurrencyId(lead?.currencyId != null ? String(lead.currencyId) : '');
  }, []);

  useEffect(() => {
    if (!open) return;
    resetForm(initialLead || null);
    let cancelled = false;
    setLoadingCurrencies(true);
    void (async () => {
      try {
        const { data, error } = await supabase
          .from('accounting_currencies')
          .select('id, name, iso_code')
          .order('id', { ascending: true });
        if (error) throw error;
        if (cancelled) return;
        const list = (data || []).map((c: any) => ({
          id: Number(c.id),
          name: String(c.name || ''),
          iso_code: c.iso_code != null ? String(c.iso_code) : null,
        }));
        setCurrencies(list);
        setCurrencyId((prev) => {
          if (prev) return prev;
          if (initialLead?.currencyId != null) return String(initialLead.currencyId);
          const nis = list.find((c) => c.name === '₪' || c.iso_code === 'ILS');
          return nis ? String(nis.id) : list[0] ? String(list[0].id) : '';
        });
      } catch (err) {
        console.warn('[SubcontractorFeeAddDrawer] currencies:', err);
      } finally {
        if (!cancelled) setLoadingCurrencies(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, initialLead, resetForm]);

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
            supabase
              .from('leads_lead')
              .select('id, name, manual_id, currency_id')
              .ilike('name', pattern)
              .limit(12),
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
          const picks: FeeDrawerLeadPick[] = [];
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
          console.warn('[SubcontractorFeeAddDrawer] lead search:', err);
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
    if (!q) return firmOptions.slice(0, 40);
    return firmOptions.filter((f) => f.name.toLowerCase().includes(q)).slice(0, 40);
  }, [firmOptions, firmSearch]);

  const close = () => {
    if (saving) return;
    onClose();
  };

  const handleSave = async () => {
    if (!selectedLead) {
      toast.error('Choose a lead');
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
      await insertLeadSubcontractorFee({
        identity: identityFromPick(selectedLead),
        firmId,
        amount: Math.round(amountNum * 100) / 100,
        currencyId: currencyNum,
        notes,
        createdBy: user?.id || null,
      });
      toast.success('Fee added');
      onSaved();
      onClose();
    } catch (err: any) {
      console.error('[SubcontractorFeeAddDrawer] save:', err);
      toast.error(err?.message || 'Failed to add fee');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-[100]">
      <div className="absolute inset-0 bg-black/30" onClick={close} />
      <div className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col overflow-hidden bg-white shadow-2xl animate-slideInRight">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-6 py-5">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Add fee</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Add a subcontractor fee line for a lead
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

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {loadingCurrencies ? (
            <div className="flex justify-center py-10">
              <span className="loading loading-spinner loading-md text-primary" />
            </div>
          ) : (
            <>
              <div className="form-control relative">
                <label className="label py-1">
                  <span className="label-text font-medium text-slate-700">Lead</span>
                </label>
                {selectedLead ? (
                  <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                    <div className="min-w-0 grow">
                      <div className="font-semibold text-slate-900">
                        {selectedLead.leadNumber || '—'}
                      </div>
                      <div className="truncate text-sm text-slate-600">
                        {selectedLead.clientName || '—'}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      disabled={saving}
                      onClick={() => {
                        setSelectedLead(null);
                        setLeadQuery('');
                        setLeadResults([]);
                      }}
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2 rounded-lg border border-base-content/20 bg-base-100 px-3 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-base-content/20">
                      <MagnifyingGlassIcon className="h-4 w-4 shrink-0 text-slate-400" />
                      <input
                        type="search"
                        className="h-11 min-w-0 grow bg-transparent text-sm outline-none"
                        placeholder="Search lead # or client name…"
                        value={leadQuery}
                        onChange={(e) => setLeadQuery(e.target.value)}
                        disabled={saving}
                        autoFocus
                      />
                    </div>
                    {(leadSearching || leadResults.length > 0 || leadQuery.trim().length >= 2) && (
                      <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                        {leadSearching ? (
                          <div className="px-3 py-2.5 text-sm text-slate-500">Searching…</div>
                        ) : leadResults.length === 0 ? (
                          <div className="px-3 py-2.5 text-sm text-slate-500">No leads found</div>
                        ) : (
                          leadResults.map((lead) => {
                            const key =
                              lead.leadType === 'legacy'
                                ? `legacy_${lead.legacyLeadId}`
                                : String(lead.newLeadId);
                            return (
                              <button
                                key={key}
                                type="button"
                                className="flex w-full flex-col px-3 py-2.5 text-left hover:bg-slate-50"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                  setSelectedLead(lead);
                                  setLeadQuery('');
                                  setLeadResults([]);
                                  if (lead.currencyId != null) {
                                    setCurrencyId(String(lead.currencyId));
                                  }
                                }}
                              >
                                <span className="font-semibold text-slate-900">
                                  {lead.leadNumber || '—'}
                                </span>
                                <span className="truncate text-sm text-slate-600">
                                  {lead.clientName || '—'}
                                </span>
                              </button>
                            );
                          })
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>

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
                            firmId === firm.id
                              ? 'bg-slate-50 font-semibold text-slate-900'
                              : 'text-slate-700'
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
                />
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-4">
          <button type="button" className="btn btn-ghost" onClick={close} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleSave()}
            disabled={saving || loadingCurrencies}
          >
            {saving ? <span className="loading loading-spinner loading-sm" /> : null}
            Add fee
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default SubcontractorFeeAddDrawer;
