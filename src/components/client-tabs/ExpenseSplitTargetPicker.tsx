import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  MagnifyingGlassIcon,
  PlusIcon,
  UserGroupIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { useLeadContactSearch } from '../../hooks/useLeadContactSearch';
import { leadViewIdentityFromCombinedLead } from '../../lib/employeeLeadReporting';
import {
  fetchLeadExpenseContacts,
  type LeadExpenseContactOption,
  type LeadFeeIdentity,
  type SplitLeadExpenseTarget,
} from '../../lib/leadExpenses';
import type { CombinedLead } from '../../lib/legacyLeadsApi';

type SelectedLead = {
  key: string;
  identity: LeadFeeIdentity;
  name: string;
  contacts: LeadExpenseContactOption[];
  selectedContactIds: number[];
  loading: boolean;
  error: string | null;
};

type Props = {
  currentIdentity: LeadFeeIdentity;
  currentLeadName: string;
  disabled?: boolean;
  onChange: (targets: SplitLeadExpenseTarget[]) => void;
};

function identityKey(identity: LeadFeeIdentity): string {
  return identity.leadType === 'legacy'
    ? `legacy:${identity.legacyLeadId}`
    : `new:${identity.newLeadId}`;
}

function identityFromSearchResult(result: CombinedLead): LeadFeeIdentity | null {
  const value = leadViewIdentityFromCombinedLead(result);
  if (!value) return null;
  if (value.lead_type === 'legacy' && value.legacy_lead_id != null) {
    return {
      leadType: 'legacy',
      newLeadId: null,
      legacyLeadId: value.legacy_lead_id,
      leadNumber: value.lead_number,
    };
  }
  if (value.lead_type === 'new' && value.new_lead_id) {
    return {
      leadType: 'new',
      newLeadId: value.new_lead_id,
      legacyLeadId: null,
      leadNumber: value.lead_number,
    };
  }
  return null;
}

const ExpenseSplitTargetPicker: React.FC<Props> = ({
  currentIdentity,
  currentLeadName,
  disabled = false,
  onChange,
}) => {
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedLeads, setSelectedLeads] = useState<SelectedLead[]>([]);
  const { results, loading: searching } = useLeadContactSearch(query, {
    enabled: !disabled && searchOpen,
    limit: 12,
    debounceMs: 250,
  });

  const addLead = useCallback(
    async (
      identity: LeadFeeIdentity,
      name: string,
      preferredContactId?: number | null,
    ) => {
      const key = identityKey(identity);
      let alreadyLoaded = false;
      setSelectedLeads((previous) => {
        const existing = previous.find((lead) => lead.key === key);
        if (existing) {
          alreadyLoaded = true;
          if (
            preferredContactId != null &&
            existing.contacts.some((contact) => contact.id === preferredContactId) &&
            !existing.selectedContactIds.includes(preferredContactId)
          ) {
            return previous.map((lead) =>
              lead.key === key
                ? {
                    ...lead,
                    selectedContactIds: [...lead.selectedContactIds, preferredContactId],
                  }
                : lead,
            );
          }
          return previous;
        }
        return [
          ...previous,
          {
            key,
            identity,
            name,
            contacts: [],
            selectedContactIds: [],
            loading: true,
            error: null,
          },
        ];
      });
      if (alreadyLoaded) return;

      try {
        const contacts = await fetchLeadExpenseContacts(identity);
        const preferred =
          preferredContactId != null
            ? contacts.find((contact) => contact.id === preferredContactId)
            : null;
        const initial = preferred || contacts.find((contact) => contact.isMain) || contacts[0];
        setSelectedLeads((previous) =>
          previous.map((lead) =>
            lead.key === key
              ? {
                  ...lead,
                  contacts,
                  selectedContactIds: initial ? [initial.id] : [],
                  loading: false,
                  error: contacts.length === 0 ? 'No contacts are attached to this lead.' : null,
                }
              : lead,
          ),
        );
      } catch (error: any) {
        setSelectedLeads((previous) =>
          previous.map((lead) =>
            lead.key === key
              ? {
                  ...lead,
                  loading: false,
                  error: error?.message || 'Could not load contacts.',
                }
              : lead,
          ),
        );
      }
    },
    [],
  );

  useEffect(() => {
    void addLead(currentIdentity, currentLeadName || currentIdentity.leadNumber || 'Current lead');
  }, [addLead, currentIdentity, currentLeadName]);

  const targets = useMemo(
    () =>
      selectedLeads.flatMap((lead) =>
        lead.selectedContactIds.map((selectedContactId) => ({
          identity: lead.identity,
          contactId: selectedContactId,
        })),
      ),
    [selectedLeads],
  );

  useEffect(() => {
    onChange(targets);
  }, [onChange, targets]);

  const selectSearchResult = (result: CombinedLead) => {
    const identity = identityFromSearchResult(result);
    if (!identity) return;
    const preferredContactId =
      result.contact_id != null && Number.isFinite(Number(result.contact_id))
        ? Number(result.contact_id)
        : null;
    const leadName = preferredContactId
      ? `Lead ${result.lead_number || identity.leadNumber || result.id}`
      : result.name || identity.leadNumber || 'Lead';
    void addLead(identity, leadName, preferredContactId);
    setQuery('');
    setSearchOpen(false);
  };

  const toggleContact = (leadKey: string, contactId: number) => {
    setSelectedLeads((previous) =>
      previous.map((lead) => {
        if (lead.key !== leadKey) return lead;
        const selected = lead.selectedContactIds.includes(contactId);
        return {
          ...lead,
          selectedContactIds: selected
            ? lead.selectedContactIds.filter((id) => id !== contactId)
            : [...lead.selectedContactIds, contactId],
        };
      }),
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-700">Selected destinations</p>
          <p className="text-xs text-slate-500">
            Choose contacts from each lead that should share the expense.
          </p>
        </div>
        <span className="shrink-0 text-xs font-medium text-slate-500">
          {targets.length} selected
        </span>
      </div>

      <div className="space-y-2">
        {selectedLeads.map((lead) => (
          <div key={lead.key} className="rounded-xl bg-slate-50 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-800">{lead.name}</p>
                <p className="text-xs text-slate-500">
                  {lead.identity.leadNumber || 'No lead number'}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-xs btn-circle"
                onClick={() =>
                  setSelectedLeads((previous) => previous.filter((item) => item.key !== lead.key))
                }
                disabled={disabled}
                aria-label={`Remove ${lead.name}`}
              >
                <XMarkIcon className="h-4 w-4" />
              </button>
            </div>

            {lead.loading ? (
              <div className="flex justify-center py-4">
                <span className="loading loading-spinner loading-sm text-primary" />
              </div>
            ) : lead.error ? (
              <p className="mt-2 text-xs text-amber-700">{lead.error}</p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                {lead.contacts.map((contact) => {
                  const selected = lead.selectedContactIds.includes(contact.id);
                  return (
                    <button
                      key={contact.id}
                      type="button"
                      className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                        selected
                          ? 'bg-indigo-600 text-white'
                          : 'bg-white text-slate-600 shadow-sm hover:bg-indigo-50'
                      }`}
                      onClick={() => toggleContact(lead.key, contact.id)}
                      disabled={disabled}
                      aria-pressed={selected}
                    >
                      {contact.name}
                      {contact.isMain ? ' · main' : ''}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      {searchOpen ? (
        <div className="animate-fade-in rounded-xl border border-indigo-100 bg-indigo-50/40 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-800">Add another lead or contact</p>
            <button
              type="button"
              className="btn btn-ghost btn-xs btn-circle"
              onClick={() => {
                setSearchOpen(false);
                setQuery('');
              }}
              aria-label="Close search"
            >
              <XMarkIcon className="h-4 w-4" />
            </button>
          </div>
          <div className="relative">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
            <input
              type="search"
              autoFocus
              className="input input-bordered w-full bg-white pl-9"
              placeholder="Search lead number, name or contact…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              disabled={disabled}
            />
            {query.trim().length >= 2 ? (
              <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
                {searching ? (
                  <div className="flex justify-center py-6">
                    <span className="loading loading-spinner loading-sm text-primary" />
                  </div>
                ) : results.length === 0 ? (
                  <p className="px-3 py-5 text-center text-sm text-slate-500">No leads found</p>
                ) : (
                  results.map((result, index) => (
                    <button
                      key={`${result.lead_type}:${result.id}:${result.contact_id || 'lead'}:${index}`}
                      type="button"
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-slate-50"
                      onClick={() => selectSearchResult(result)}
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-700">
                        <UserGroupIcon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-800">
                          {result.contact_id ? result.contactName || result.name : result.name}
                        </span>
                        <span className="block truncate text-xs text-slate-500">
                          {result.lead_number}
                          {result.contact_id ? ' · contact' : ''}
                        </span>
                      </span>
                      <span className="text-[10px] font-semibold uppercase text-slate-400">
                        {result.lead_type}
                      </span>
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="btn btn-outline btn-primary btn-sm w-full gap-2 rounded-xl"
          onClick={() => setSearchOpen(true)}
          disabled={disabled}
        >
          <PlusIcon className="h-4 w-4" />
          Add another lead or contact
        </button>
      )}
    </div>
  );
};

export default ExpenseSplitTargetPicker;
