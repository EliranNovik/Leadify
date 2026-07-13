import React, { useEffect, useMemo, useState } from 'react';
import { MagnifyingGlassIcon, PlusIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import LeadContactSearchResults from '../search/LeadContactSearchResults';
import { useLeadContactSearch } from '../../hooks/useLeadContactSearch';
import type { CombinedLead } from '../../lib/legacyLeadsApi';
import { allocationRowFromCombinedLead } from '../../lib/employeeLeadReporting';

type AddLeadToAllocationModalProps = {
  open: boolean;
  onClose: () => void;
  existingKeys: Set<string>;
  onAdd: (lead: CombinedLead) => void;
};

const AddLeadToAllocationModal: React.FC<AddLeadToAllocationModalProps> = ({
  open,
  onClose,
  existingKeys,
  onAdd,
}) => {
  const [query, setQuery] = useState('');
  const { results, loading } = useLeadContactSearch(query, {
    enabled: open,
    limit: 40,
  });

  useEffect(() => {
    if (!open) {
      setQuery('');
    }
  }, [open]);

  const displayResults = useMemo(() => {
    return results.filter((lead) => {
      const row = allocationRowFromCombinedLead(lead);
      if (!row) return false;
      return !existingKeys.has(row.key);
    });
  }, [existingKeys, results]);

  if (!open) return null;

  const handleSelect = (lead: CombinedLead) => {
    const row = allocationRowFromCombinedLead(lead);
    if (!row) {
      toast.error('Could not add this lead.');
      return;
    }
    if (existingKeys.has(row.key)) {
      toast.error('This lead is already in the list.');
      return;
    }
    onAdd(lead);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-base-100 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col border border-base-300">
        <div className="p-4 border-b border-base-300 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-base-content flex items-center gap-2">
              <PlusIcon className="h-6 w-6 text-primary shrink-0" />
              Add lead
            </h3>
            <p className="text-sm text-base-content/70 mt-1">
              Search by lead number, name, phone, email, or contact. Click a result to add it.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-circle shrink-0"
            onClick={onClose}
            aria-label="Close"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto flex-1 min-h-0">
          <div className="relative">
            <MagnifyingGlassIcon className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-base-content/40" />
            <input
              type="search"
              className="input input-bordered w-full pl-10"
              placeholder="Lead #, name, phone, email, contact…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
          </div>

          {query.trim().length < 2 && !loading ? (
            <p className="text-sm text-base-content/60 text-center py-6">
              Type at least 2 characters to search
            </p>
          ) : (
            <LeadContactSearchResults
              results={displayResults}
              loading={loading}
              query={query}
              onSelect={handleSelect}
              minLength={2}
              showTypeFilter
              emptyMessage="No addable leads or contacts found for this search."
              className="rounded-lg border border-base-300"
            />
          )}
        </div>

        <div className="p-4 border-t border-base-300 flex justify-end">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default AddLeadToAllocationModal;
