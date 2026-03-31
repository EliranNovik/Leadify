import React, { useState, useEffect, useRef } from 'react';
import { XMarkIcon, MagnifyingGlassIcon, LinkIcon } from '@heroicons/react/24/outline';
import { searchLeads } from '../lib/legacyLeadsApi';
import type { CombinedLead } from '../lib/legacyLeadsApi';
import { linkLeadToChain } from '../lib/masterLeadApi';
import { getStageName, getStageColour } from '../lib/stageUtils';
import toast from 'react-hot-toast';

export interface CurrentLeadForCombine {
  id: string;
  lead_number?: string;
  lead_type?: 'new' | 'legacy';
}

interface CombineLeadsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentLead: CurrentLeadForCombine | null;
  onSuccess: () => void;
}

function normalizeBaseLeadNumber(leadNumber: string): string {
  const trimmed = (leadNumber || '').trim().replace(/^[LC]/i, '');
  const firstSegment = trimmed.includes('/') ? trimmed.split('/')[0] : trimmed;
  return firstSegment || '';
}

const CombineLeadsModal: React.FC<CombineLeadsModalProps> = ({
  isOpen,
  onClose,
  currentLead,
  onSuccess,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<CombinedLead[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<CombinedLead | null>(null);
  const [confirming, setConfirming] = useState(false);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('');
      setSearchResults([]);
      setSelected(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !currentLead) return;
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    setSearching(true);
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const results = await searchLeads(searchQuery.trim(), { limit: 20 });
        const currentId = String(currentLead.id);
        const currentIdLegacy = currentLead.lead_type === 'legacy' || currentId.startsWith('legacy_')
          ? `legacy_${currentId.replace(/^legacy_/, '')}`
          : currentId;
        setSearchResults(
          results.filter((r) => {
            const id = String(r.id);
            const legacyId = r.lead_type === 'legacy' ? `legacy_${id}` : id;
            if (id === currentId || legacyId === currentIdLegacy) return false;
            if (r.master_id != null && r.master_id !== '') return false;
            if (r.lead_type === 'new' && (r.lead_number || '').includes('/')) return false;
            if (r.linked_master_lead != null && r.linked_master_lead !== '') return false;
            return true;
          })
        );
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [isOpen, searchQuery, currentLead?.id, currentLead?.lead_type]);

  const handleConfirm = async () => {
    if (!selected || !currentLead) return;
    const isLegacyMaster =
      currentLead.lead_type === 'legacy' ||
      String(currentLead.id).startsWith('legacy_');
    let baseLeadNumber: string;
    let masterLeadInfo: { id?: number | string } | undefined;

    if (isLegacyMaster) {
      const rawId = String(currentLead.id).replace(/^legacy_/, '');
      const numericId = parseInt(rawId, 10);
      if (Number.isNaN(numericId)) {
        toast.error('Invalid master lead');
        return;
      }
      baseLeadNumber = String(numericId);
      masterLeadInfo = { id: numericId };
    } else {
      // Use full lead_number (e.g. "L210292") so linked_master_lead is saved correctly and master row can be found/updated
      baseLeadNumber = (currentLead.lead_number || '').trim();
      if (!baseLeadNumber) {
        toast.error('Could not determine master lead number');
        return;
      }
      // Pass master's UUID so linkLeadToChain can set the master row's linked_master_lead
      masterLeadInfo = { id: currentLead.id };
    }

    const subleadId =
      selected.lead_type === 'legacy'
        ? String(selected.id)
        : selected.id;
    const subleadType = selected.lead_type || 'new';

    setConfirming(true);
    try {
      const result = await linkLeadToChain(
        subleadId,
        subleadType,
        baseLeadNumber,
        isLegacyMaster,
        masterLeadInfo
      );
      if (result.success) {
        toast.success('Lead linked to master. It will appear on the master lead page.');
        onSuccess();
        onClose();
      } else {
        toast.error(result.error || 'Failed to link lead');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to link lead');
    } finally {
      setConfirming(false);
    }
  };

  const getStageBadge = (lead: CombinedLead) => {
    const stageStr = String(lead.stage ?? '');
    const stageName = stageStr ? (/^\d+$/.test(stageStr) ? getStageName(stageStr) : stageStr) : '—';
    const stageColor = getStageColour(stageStr);
    const bg = stageColor || '#6b7280';
    return (
      <span
        className="badge badge-sm text-xs px-2 py-0.5 text-white border-0"
        style={{ backgroundColor: bg }}
      >
        {stageName}
      </span>
    );
  };

  if (!isOpen) return null;

  const masterDisplay = currentLead?.lead_number ?? currentLead?.id ?? '—';

  return (
    <div
      className="fixed inset-0 z-[340] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="combine-leads-title"
    >
      <div className="absolute inset-0 z-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div className="relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border border-base-300 bg-base-100 shadow-xl">
        <div className="flex shrink-0 items-center justify-between rounded-t-xl border-b border-base-300 bg-base-100 p-4">
          <h2 id="combine-leads-title" className="flex items-center gap-2 text-lg font-semibold">
            <LinkIcon className="h-5 w-5 shrink-0" />
            Combine leads
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-sm btn-circle"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 flex flex-col gap-3 flex-1 min-h-0 overflow-hidden">
          <p className="text-sm text-base-content/70">
            This lead <strong>#{masterDisplay}</strong> will be the master. Choose another lead to link to it (it will appear on the master lead page).
          </p>
          {!selected ? (
            <>
              <div className="relative">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-base-content/40" />
                <input
                  type="text"
                  placeholder="Search by lead number, name, email..."
                  className="input input-bordered w-full pl-10"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="flex-1 overflow-auto min-h-[200px] border border-base-300 rounded-lg">
                {searching ? (
                  <div className="p-6 text-center text-base-content/60">
                    <span className="loading loading-spinner loading-sm" />
                    <span className="ml-2">Searching...</span>
                  </div>
                ) : searchResults.length > 0 ? (
                  <ul className="divide-y divide-base-200">
                    {searchResults.map((lead) => (
                      <li key={lead.lead_type === 'legacy' ? `legacy_${lead.id}` : lead.id}>
                        <button
                          type="button"
                          onClick={() => setSelected(lead)}
                          className="relative w-full px-4 py-3 text-left hover:bg-base-200 transition-colors rounded-lg border border-transparent hover:border-base-300"
                        >
                          <div className="absolute top-1.5 right-2 z-10">
                            {getStageBadge(lead)}
                          </div>
                          <div className="flex flex-col gap-0.5 pr-20">
                            <p className="font-medium text-base-content">
                              {lead.contactName || lead.name || '—'}
                            </p>
                            <p className="text-sm text-base-content/70 font-mono">
                              #{lead.lead_number || lead.id}
                            </p>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : searchQuery.trim() ? (
                  <div className="p-6 text-center text-base-content/60 text-sm">
                    No eligible leads found. Excluded: current lead, subleads, and already linked leads.
                  </div>
                ) : (
                  <div className="p-6 text-center text-base-content/50 text-sm">
                    Type to search for a lead to link.
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-base-content/70">
                Link this lead to the master?
              </p>
              <div className="p-3 bg-base-200 rounded-lg flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{selected.contactName || selected.name || '—'}</p>
                  <p className="text-sm text-base-content/70 font-mono">#{selected.lead_number || selected.id}</p>
                </div>
                <div>{getStageBadge(selected)}</div>
              </div>
              <div className="flex gap-2 justify-end mt-2">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setSelected(null)}
                  disabled={confirming}
                >
                  Back
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleConfirm}
                  disabled={confirming}
                >
                  {confirming ? (
                    <>
                      <span className="loading loading-spinner loading-sm" />
                      Linking...
                    </>
                  ) : (
                    'Link to master'
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default CombineLeadsModal;
