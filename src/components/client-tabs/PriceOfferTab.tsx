import React, { useEffect, useMemo, useState } from 'react';
import { ClientTabProps } from '../../types/client';
import { CurrencyDollarIcon } from '@heroicons/react/24/outline';
import { supabase } from '../../lib/supabase';
import { useRealtimeRefresh, type RealtimeChangePayload } from '../../hooks/useRealtimeRefresh';
import { ClientTabPageHeader } from './ClientTabPageHeader';
import {
  clientsTabCacheLeadKey,
  readClientsTabCache,
  writeClientsTabCache,
} from '../../lib/clientsTabCache';
import {
  fetchLeadPriceOffers,
  PRICE_OFFERS_CHANGED_EVENT,
} from '../../lib/leadPriceOfferVersions';

interface PriceOfferHistoryEntry {
  id: string;
  messageId: string | null;
  senderName: string;
  senderEmail: string | null;
  sentAt: string | null;
  body: string;
  isFallback: boolean;
}

type PriceOfferTabCacheSlice = {
  history?: PriceOfferHistoryEntry[];
  closerDisplayName?: string;
  legacyTotal?: number | null;
};

const PriceOfferTab: React.FC<ClientTabProps> = ({ client, onClientUpdate }) => {
  // Use values from client, fallback to defaults if missing
  const proposalTotal = client?.proposal_total;
  const currency = client?.proposal_currency ?? 'NIS';
  const closer = client?.closer || '---';
  const proposal = client?.proposal_text ?? '';

  // Cache-first: paint this lead's last-known offer history immediately (no spinner), then
  // silently refresh from the network below.
  const priceLeadKey = clientsTabCacheLeadKey(client);
  const cachedPriceTabData = readClientsTabCache<PriceOfferTabCacheSlice>(priceLeadKey, 'price');

  const [historyLoading, setHistoryLoading] = useState(() => !cachedPriceTabData);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [history, setHistory] = useState<PriceOfferHistoryEntry[]>(() => cachedPriceTabData?.history ?? []);
  const [activeOfferId, setActiveOfferId] = useState<string | null>(null);
  const [closerDisplayName, setCloserDisplayName] = useState<string>(
    () => cachedPriceTabData?.closerDisplayName ?? '---'
  );
  const [legacyTotal, setLegacyTotal] = useState<number | null>(() => cachedPriceTabData?.legacyTotal ?? null);

  const isLegacyLead = useMemo(
    () => typeof client?.id === 'string' && client.id.startsWith('legacy_'),
    [client?.id]
  );

  // Bumped by the realtime subscription below; the data effects depend on it so a DB change to this
  // lead's offer emails (or the legacy lead total) silently refetches in place — no page reload.
  const [realtimeNonce, setRealtimeNonce] = useState(0);

  useRealtimeRefresh({
    channelName: `price-offer-tab-${client?.id ?? 'none'}`,
    enabled: !!client?.id,
    tables: (() => {
      const leadIdRaw = String(client?.id ?? '');
      const leadIdStripped = leadIdRaw.replace(/^legacy_/, '').toLowerCase();
      const matchLead = (payload: RealtimeChangePayload) => {
        const row = payload?.new ?? payload?.old;
        if (!row) return true;
        const r = row as Record<string, unknown>;
        const candidates = [r.lead_id, r.legacy_id, r.client_id, r.id];
        if (candidates.every((c) => c == null)) return true;
        return candidates.some((c) => {
          if (c == null) return false;
          const s = String(c).toLowerCase();
          return s === leadIdStripped || s === leadIdRaw.toLowerCase();
        });
      };
      return [
        { table: 'lead_price_offers', event: '*' as const, match: matchLead },
        { table: isLegacyLead ? 'leads_lead' : 'leads', event: '*' as const, match: matchLead },
      ];
    })(),
    onChange: () => setRealtimeNonce((n) => n + 1),
  });

  useEffect(() => {
    const onChanged = (event: Event) => {
      const leadId = (event as CustomEvent<{ leadId?: string | number | null }>).detail?.leadId;
      if (leadId != null && String(leadId) !== String(client?.id ?? '')) return;
      setRealtimeNonce((n) => n + 1);
    };
    window.addEventListener(PRICE_OFFERS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(PRICE_OFFERS_CHANGED_EVENT, onChanged);
  }, [client?.id]);

  // Use legacyTotal for legacy leads, otherwise use proposalTotal
  const total = isLegacyLead && legacyTotal !== null ? legacyTotal : proposalTotal;
  const currencySign = useMemo(() => {
    const value = String(currency || '').trim();
    if (['$', '€', '£', '₪'].includes(value)) return value;
    const upper = value.toUpperCase();
    if (upper === 'USD') return '$';
    if (upper === 'EUR') return '€';
    if (upper === 'GBP') return '£';
    return '₪';
  }, [currency]);

  // Fetch closer display name and total for legacy leads
  useEffect(() => {
    const fetchLegacyData = async () => {
      if (!client?.id) {
        setCloserDisplayName('---');
        setLegacyTotal(null);
        return;
      }

      if (isLegacyLead) {
        // For legacy leads, closer_id is numeric, fetch display_name from tenants_employee
        const legacyId = Number.parseInt(String(client.id).replace('legacy_', ''), 10);
        if (Number.isNaN(legacyId)) {
          setCloserDisplayName('---');
          setLegacyTotal(null);
          return;
        }

        try {
          // Fetch closer_id and total from leads_lead table
          const { data: leadData, error: leadError } = await supabase
            .from('leads_lead')
            .select('closer_id, total')
            .eq('id', legacyId)
            .maybeSingle();

          if (leadError) {
            setCloserDisplayName('---');
            setLegacyTotal(null);
            return;
          }

          // Set total if available
          let nextLegacyTotal: number | null = null;
          if (leadData?.total !== null && leadData?.total !== undefined) {
            const totalNum = typeof leadData.total === 'string' 
              ? parseFloat(leadData.total) 
              : Number(leadData.total);
            nextLegacyTotal = !isNaN(totalNum) ? totalNum : null;
          }
          setLegacyTotal(nextLegacyTotal);

          // Fetch display_name from tenants_employee if closer_id exists
          let nextCloserDisplayName = '---';
          if (leadData?.closer_id) {
            const { data: employeeData, error: employeeError } = await supabase
              .from('tenants_employee')
              .select('display_name')
              .eq('id', leadData.closer_id)
              .maybeSingle();

            if (!employeeError && employeeData?.display_name) {
              nextCloserDisplayName = employeeData.display_name;
            }
          }
          setCloserDisplayName(nextCloserDisplayName);

          const leadKey = clientsTabCacheLeadKey(client);
          const prevCache = readClientsTabCache<PriceOfferTabCacheSlice>(leadKey, 'price') ?? {};
          writeClientsTabCache(leadKey, 'price', {
            ...prevCache,
            closerDisplayName: nextCloserDisplayName,
            legacyTotal: nextLegacyTotal,
          });
        } catch (error) {
          console.error('Error fetching legacy data:', error);
          setCloserDisplayName('---');
          setLegacyTotal(null);
        }
      } else {
        // For new leads, closer is already a display_name string
        setCloserDisplayName(closer || '---');
        setLegacyTotal(null);
      }
    };

    fetchLegacyData();
  }, [client?.id, isLegacyLead, closer, realtimeNonce]);

  useEffect(() => {
    const fetchHistory = async () => {
      if (!client?.id) {
        setHistory([]);
        setActiveOfferId(null);
        return;
      }

      // Cache-first / silent-refresh: only show the loading state when there's nothing on
      // screen yet. Cache hits and realtime-triggered refetches update history in place.
      if (!cachedPriceTabData && history.length === 0) {
        setHistoryLoading(true);
      }
      setHistoryError(null);

      try {
        const offerRows = await fetchLeadPriceOffers(client);
        console.log('[PriceOfferTab] offers', {
          leadId: client.id,
          count: offerRows.length,
        });

        const entries: PriceOfferHistoryEntry[] = offerRows.map((offer) => ({
          id: `offer_${offer.id}`,
          messageId: String(offer.id),
          senderName: offer.senderName || closerDisplayName || '---',
          senderEmail: offer.senderEmail || null,
          sentAt: offer.sentAt || null,
          body: offer.body || '',
          isFallback: false,
        }));

        // For legacy leads, also fetch proposal from leads_lead table as a fallback
        if (isLegacyLead && entries.length === 0) {
          const legacyId = Number.parseInt(String(client.id).replace('legacy_', ''), 10);
          if (!Number.isNaN(legacyId)) {
            const { data: legacyLeadData, error: legacyError } = await supabase
              .from('leads_lead')
              .select('proposal')
              .eq('id', legacyId)
              .maybeSingle();

            if (!legacyError && legacyLeadData?.proposal && legacyLeadData.proposal.trim()) {
              const legacyProposal = legacyLeadData.proposal.trim();
              entries.unshift({
                id: 'legacy_proposal',
                messageId: null,
                senderName: closerDisplayName,
                senderEmail: null,
                sentAt: null,
                body: legacyProposal,
                isFallback: true,
              });
            }
          }
        }

        setHistory(entries);
        setActiveOfferId((current) => {
          if (current && entries.some((entry) => entry.id === current)) return current;
          return entries.length > 0 ? entries[entries.length - 1].id : null;
        });
        const leadKey = clientsTabCacheLeadKey(client);
        const prevCache = readClientsTabCache<PriceOfferTabCacheSlice>(leadKey, 'price') ?? {};
        writeClientsTabCache(leadKey, 'price', { ...prevCache, history: entries });
      } catch (error: any) {
        console.error('Failed to fetch price offer history:', error);
        setHistoryError(error?.message || 'Failed to load previous offers.');
        setHistory([]);
        setActiveOfferId(null);
      } finally {
        setHistoryLoading(false);
      }
    };

    fetchHistory();
  }, [client?.id, isLegacyLead, closerDisplayName, proposal, client?.last_stage_changed_at, realtimeNonce]);

  const linkifyLine = (line: string, lineIndex: number): React.ReactNode => {
    const urlRegex = /(https?:\/\/[^\s]+)/gi;
    const nodes: React.ReactNode[] = [];
    let match: RegExpExecArray | null;
    let lastIndex = 0;
    let segmentIndex = 0;

    while ((match = urlRegex.exec(line)) !== null) {
      if (match.index > lastIndex) {
        nodes.push(
          <span key={`text-${lineIndex}-${segmentIndex++}`}>{line.slice(lastIndex, match.index)}</span>
        );
      }

      const url = match[0];
      nodes.push(
        <a
          key={`link-${lineIndex}-${segmentIndex++}`}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline break-words"
        >
          {url}
        </a>
      );

      lastIndex = match.index + url.length;
    }

    if (lastIndex < line.length) {
      nodes.push(
        <span key={`text-${lineIndex}-${segmentIndex++}`}>{line.slice(lastIndex)}</span>
      );
    }

    if (nodes.length === 0) {
      return line;
    }

    return nodes;
  };

  const renderProposalContent = (text: string) => {
    if (!text || !text.trim()) {
      return (
        <p className="text-base-content/50 italic">No proposal text recorded.</p>
      );
    }

    return text.split(/\r?\n/).map((line, index) => {
      if (!line.trim()) {
        return <div key={`gap-${index}`} className="h-3" />;
      }

      return (
        <p key={`line-${index}`} className="mb-2 text-base whitespace-pre-wrap break-words">
          {linkifyLine(line, index)}
        </p>
      );
    });
  };

  const fallbackEntry: PriceOfferHistoryEntry | null = useMemo(() => {
    if (!proposal || !proposal.trim()) {
      return null;
    }

    return {
      id: 'current_offer',
      messageId: null,
      senderName: closerDisplayName,
      senderEmail: null,
      sentAt: client?.last_stage_changed_at ?? null,
      body: proposal,
      isFallback: true,
    };
  }, [proposal, closerDisplayName, client?.last_stage_changed_at]);

  const combinedOffers = useMemo(() => {
    const offers = [...history].sort((a, b) => {
      const aTime = a.sentAt ? Date.parse(a.sentAt) : 0;
      const bTime = b.sentAt ? Date.parse(b.sentAt) : 0;
      return aTime - bTime;
    });

    if (offers.length > 0) {
      return offers;
    }

    return fallbackEntry ? [fallbackEntry] : [];
  }, [history, fallbackEntry]);

  useEffect(() => {
    if (!combinedOffers || combinedOffers.length === 0) {
      setActiveOfferId(null);
      return;
    }

    if (!activeOfferId || !combinedOffers.some(entry => entry.id === activeOfferId)) {
      setActiveOfferId(combinedOffers[combinedOffers.length - 1].id);
    }
  }, [combinedOffers, activeOfferId]);

  const activeOffer = useMemo(
    () =>
      combinedOffers.find(entry => entry.id === activeOfferId) ||
      combinedOffers[combinedOffers.length - 1] ||
      null,
    [combinedOffers, activeOfferId]
  );

  const displayProposal = activeOffer?.body || proposal;

  const formatOfferSentAt = (sentAt: string | null | undefined) => {
    if (!sentAt) return null;
    const date = new Date(sentAt);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleString();
  };

  const offerVersionTabs =
    combinedOffers.length > 1 ? (
      <div
        className="flex max-w-full flex-wrap gap-2"
        role="tablist"
        aria-label="Price offer versions"
      >
        {combinedOffers.map((entry, index) => {
          const selected = entry.id === activeOfferId;
          const sentLabel = formatOfferSentAt(entry.sentAt);
          const sender = entry.senderName || closerDisplayName || '---';
          return (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={selected}
              className={`inline-flex min-w-[12rem] flex-col items-stretch rounded-xl border px-3 py-2 text-left transition-colors ${
                selected
                  ? 'border-slate-300 bg-white text-slate-900 shadow-sm'
                  : 'border-transparent bg-slate-200/80 text-slate-600 hover:bg-slate-200'
              }`}
              onClick={() => setActiveOfferId(entry.id)}
            >
              <span className="flex items-start justify-between gap-3">
                <span className="text-sm font-semibold">
                  {entry.isFallback ? 'Current' : `Offer ${index + 1}`}
                </span>
                <span className="shrink-0 text-[11px] font-medium text-slate-400">
                  by {sender}
                </span>
              </span>
              {sentLabel ? (
                <span className="mt-0.5 text-[11px] text-slate-400">{sentLabel}</span>
              ) : null}
            </button>
          );
        })}
      </div>
    ) : null;

  return (
    <div className="p-1 sm:p-2 md:p-3">
      <ClientTabPageHeader
        className="mb-6"
        icon={CurrencyDollarIcon}
        title="Price Offer"
        subtitle="Manage pricing and proposals"
      />
      <div className="mb-6 text-xl">
        <span className="font-semibold">Total:</span>{' '}
        <span className="font-semibold">
          {typeof total === 'number' && !isNaN(total)
            ? `${currencySign}${total.toLocaleString()}`
            : '--'}
        </span>
      </div>
      {offerVersionTabs ? <div className="mb-5">{offerVersionTabs}</div> : null}
      <div className="mb-2 text-lg font-semibold">Proposal:</div>
      {historyLoading && (
        <div className="mb-4 text-sm text-base-content/60">Loading previous offers...</div>
      )}
      {historyError && (
        <div className="mb-4 text-sm text-error">{historyError}</div>
      )}
      <div className="mb-8">
        <div className="w-full min-h-[200px] max-h-[600px] border border-base-300 rounded-xl p-4 text-base font-medium bg-base-100 shadow-inner overflow-y-auto">
          {renderProposalContent(displayProposal)}
        </div>
      </div>
      
    </div>
  );
};

export default PriceOfferTab;
