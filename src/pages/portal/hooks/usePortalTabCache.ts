import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  portalGetCaseSummary,
  portalGetContactContracts,
  portalGetContactPoas,
  portalGetContactProfileSignedUrls,
  portalGetContacts,
  portalGetDocumentSignedUrls,
  portalGetDocuments,
  portalGetFinances,
  portalGetMeetings,
  portalGetSubEfforts,
  type PortalContactContractRow,
  type PortalContactPoaRow,
  type PortalLeadSummary,
} from '../../../lib/portalApi';
import { useRealtimeRefresh, type RealtimeTableSubscription } from '../../../hooks/useRealtimeRefresh';
import type { PortalTabId } from '../portalTabTypes';
import { readPortalTabCache, writePortalTabCache } from './portalTabCacheStorage';
import { seedPortalContactProfileUrls } from './usePortalContactProfileUrls';

export type PortalTabCacheData = {
  summary: Awaited<ReturnType<typeof portalGetCaseSummary>>;
  subEfforts: Array<Record<string, unknown>>;
  finances: Awaited<ReturnType<typeof portalGetFinances>>;
  meetings: Awaited<ReturnType<typeof portalGetMeetings>>;
  documents: Awaited<ReturnType<typeof portalGetDocuments>>;
  contacts: Awaited<ReturnType<typeof portalGetContacts>>;
  poasByContact: Record<number, PortalContactPoaRow[]>;
  contractsByContact: Record<number, PortalContactContractRow[]>;
  documentSignedUrls: Record<string, string>;
  contactProfileSignedUrls: Record<string, string>;
};

export type PortalTabCacheState = {
  data: PortalTabCacheData | null;
  initialLoading: boolean;
  refreshing: boolean;
  refresh: (scope?: PortalTabId | 'all') => Promise<void>;
};

function emptyCacheData(): PortalTabCacheData {
  return {
    summary: null,
    subEfforts: [],
    finances: { payments: [], proformas: [], is_legacy: false },
    meetings: { meetings: [], requests: [] },
    documents: { documents: [], classifications: [], lead_number: '' },
    contacts: { contacts: [] },
    poasByContact: {},
    contractsByContact: {},
    documentSignedUrls: {},
    contactProfileSignedUrls: {},
  };
}

async function loadContactProfileSignedUrls(
  paths: Array<string | null | undefined>,
  existing: Record<string, string> = {},
): Promise<Record<string, string>> {
  const unique = [...new Set(paths.filter((p): p is string => Boolean(p?.trim())))];
  const missing = unique.filter((path) => !existing[path]);
  if (!missing.length) return existing;

  try {
    const fresh = await portalGetContactProfileSignedUrls(missing);
    const merged = { ...existing, ...fresh };
    seedPortalContactProfileUrls(merged);
    return merged;
  } catch {
    return existing;
  }
}

async function loadContactExtras(
  contacts: NonNullable<Awaited<ReturnType<typeof portalGetContacts>>>['contacts'],
): Promise<{
  poasByContact: Record<number, PortalContactPoaRow[]>;
  contractsByContact: Record<number, PortalContactContractRow[]>;
}> {
  if (!contacts.length) {
    return { poasByContact: {}, contractsByContact: {} };
  }

  const [poaEntries, contractEntries] = await Promise.all([
    Promise.all(
      contacts.map(async (c) => {
        try {
          return [c.id, await portalGetContactPoas(c.id)] as const;
        } catch {
          return [c.id, [] as PortalContactPoaRow[]] as const;
        }
      }),
    ),
    Promise.all(
      contacts.map(async (c) => {
        try {
          return [c.id, await portalGetContactContracts(c.id)] as const;
        } catch {
          return [c.id, [] as PortalContactContractRow[]] as const;
        }
      }),
    ),
  ]);

  return {
    poasByContact: Object.fromEntries(poaEntries),
    contractsByContact: Object.fromEntries(contractEntries),
  };
}

async function loadDocumentSignedUrls(
  documents: Awaited<ReturnType<typeof portalGetDocuments>> | null,
): Promise<Record<string, string>> {
  const paths = (documents?.documents ?? [])
    .map((d) => d.storage_path)
    .filter(Boolean) as string[];
  if (!paths.length) return {};
  try {
    return await portalGetDocumentSignedUrls(paths);
  } catch {
    return {};
  }
}

function buildRealtimeTables(lead: PortalLeadSummary | null): RealtimeTableSubscription[] {
  if (!lead) return [];

  const subs: RealtimeTableSubscription[] = [];

  if (lead.is_legacy && lead.legacy_lead_id != null) {
    const legacyId = String(lead.legacy_lead_id);
    subs.push({
      table: 'leads_lead',
      match: (p) => String(p.new?.id ?? p.old?.id ?? '') === legacyId,
    });
  } else if (lead.new_lead_id) {
    const newId = lead.new_lead_id.toLowerCase();
    subs.push({
      table: 'leads',
      match: (p) => String(p.new?.id ?? p.old?.id ?? '').toLowerCase() === newId,
    });
  }

  const matchLeadRow = (row: Record<string, unknown> | null | undefined): boolean => {
    if (!row || !lead) return false;
    if (lead.is_legacy && lead.legacy_lead_id != null) {
      const legacyId = String(lead.legacy_lead_id);
      return (
        String(row.legacy_lead_id ?? '') === legacyId
        || String(row.lead_id ?? '') === legacyId
      );
    }
    const newId = lead.new_lead_id?.toLowerCase();
    if (!newId) return false;
    const rowLead = String(row.new_lead_id ?? row.lead_id ?? row.lead_uuid ?? '').toLowerCase();
    return rowLead === newId;
  };

  subs.push({
    table: 'meetings',
    match: (p) => matchLeadRow(p.new) || matchLeadRow(p.old),
  });

  subs.push({
    table: 'lead_sub_efforts',
    match: (p) => matchLeadRow(p.new) || matchLeadRow(p.old),
  });

  if (lead.lead_number) {
    const leadNumber = lead.lead_number;
    subs.push({
      table: 'lead_case_documents',
      match: (p) => String(p.new?.lead_number ?? p.old?.lead_number ?? '') === leadNumber,
    });
  }

  for (const table of [
    'payment_plans',
    'finances_paymentplanrow',
    'leads_contact',
    'client_portal_notifications',
    'client_portal_meeting_requests',
    'contracts',
    'poa_documents',
  ]) {
    subs.push({ table });
  }

  return subs;
}

async function fetchPortalScope(
  scope: PortalTabId | 'all',
  existingContactProfileUrls: Record<string, string> = {},
): Promise<Partial<PortalTabCacheData>> {
  const patch: Partial<PortalTabCacheData> = {};
  const needs = (tab: PortalTabId) => scope === 'all' || scope === tab;

  if (needs('summary')) {
    patch.summary = await portalGetCaseSummary();
  }

  if (needs('stages') || needs('summary')) {
    const sub = await portalGetSubEfforts();
    patch.subEfforts = (sub?.rows ?? []) as Array<Record<string, unknown>>;
  }

  if (needs('finance') || needs('summary')) {
    patch.finances = await portalGetFinances();
  }

  if (needs('meetings') || needs('summary')) {
    patch.meetings = await portalGetMeetings();
  }

  if (needs('documents') || scope === 'all') {
    const documents = await portalGetDocuments();
    patch.documents = documents;
    patch.documentSignedUrls = await loadDocumentSignedUrls(documents);
  }

  if (needs('contacts') || scope === 'all') {
    const contacts = await portalGetContacts();
    patch.contacts = contacts;
    const extras = await loadContactExtras(contacts?.contacts ?? []);
    patch.poasByContact = extras.poasByContact;
    patch.contractsByContact = extras.contractsByContact;
    patch.contactProfileSignedUrls = await loadContactProfileSignedUrls(
      (contacts?.contacts ?? []).map((c) => c.portal_profile_image_path),
      existingContactProfileUrls,
    );
  }

  return patch;
}

function mergeCache(
  current: PortalTabCacheData | null,
  patch: Partial<PortalTabCacheData>,
): PortalTabCacheData {
  const base = current ?? emptyCacheData();
  return {
    summary: patch.summary !== undefined ? patch.summary : base.summary,
    subEfforts: patch.subEfforts !== undefined ? patch.subEfforts : base.subEfforts,
    finances: patch.finances !== undefined ? patch.finances : base.finances,
    meetings: patch.meetings !== undefined ? patch.meetings : base.meetings,
    documents: patch.documents !== undefined ? patch.documents : base.documents,
    contacts: patch.contacts !== undefined ? patch.contacts : base.contacts,
    poasByContact: patch.poasByContact !== undefined ? patch.poasByContact : base.poasByContact,
    contractsByContact:
      patch.contractsByContact !== undefined ? patch.contractsByContact : base.contractsByContact,
    documentSignedUrls:
      patch.documentSignedUrls !== undefined ? patch.documentSignedUrls : base.documentSignedUrls,
    contactProfileSignedUrls:
      patch.contactProfileSignedUrls !== undefined
        ? { ...(base.contactProfileSignedUrls ?? {}), ...patch.contactProfileSignedUrls }
        : (base.contactProfileSignedUrls ?? {}),
  };
}

export function usePortalTabCache(
  leadRef: string | null | undefined,
  leadSummary: PortalLeadSummary | null,
): PortalTabCacheState {
  const [data, setData] = useState<PortalTabCacheData | null>(() =>
    readPortalTabCache(leadRef),
  );
  const [initialLoading, setInitialLoading] = useState(() => !readPortalTabCache(leadRef));
  const [refreshing, setRefreshing] = useState(false);
  const fetchingRef = useRef(false);

  const hasCachedDataRef = useRef(Boolean(readPortalTabCache(leadRef)));

  const refresh = useCallback(
    async (scope: PortalTabId | 'all' = 'all') => {
      if (fetchingRef.current) return;
      fetchingRef.current = true;
      if (hasCachedDataRef.current) {
        setRefreshing(true);
      } else {
        setInitialLoading(true);
      }

      try {
        const existingProfileUrls =
          readPortalTabCache(leadRef)?.contactProfileSignedUrls ?? {};
        const patch = await fetchPortalScope(scope, existingProfileUrls);
        setData((prev) => {
          const merged = mergeCache(prev, patch);
          if (merged.contactProfileSignedUrls) {
            seedPortalContactProfileUrls(merged.contactProfileSignedUrls);
          }
          writePortalTabCache(leadRef, merged);
          return merged;
        });
        hasCachedDataRef.current = true;
      } catch (err) {
        console.error('portal tab cache refresh failed', err);
      } finally {
        fetchingRef.current = false;
        setInitialLoading(false);
        setRefreshing(false);
      }
    },
    [leadRef],
  );

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    const cached = readPortalTabCache(leadRef);
    hasCachedDataRef.current = Boolean(cached);
    if (cached) {
      if (cached.contactProfileSignedUrls) {
        seedPortalContactProfileUrls(cached.contactProfileSignedUrls);
      }
      setData(cached);
      setInitialLoading(false);
    } else {
      setData(null);
      setInitialLoading(true);
    }
    void refreshRef.current('all');
  }, [leadRef]);

  const realtimeTables = useMemo(() => buildRealtimeTables(leadSummary), [leadSummary]);

  useRealtimeRefresh({
    channelName: leadRef ? `portal-case-tabs:${leadRef}` : 'portal-case-tabs:inactive',
    tables: realtimeTables,
    enabled: Boolean(leadRef && leadSummary),
    debounceMs: 650,
    onChange: () => refreshRef.current('all'),
  });

  return { data, initialLoading, refreshing, refresh };
}
