import React, { useEffect, useMemo, useState } from 'react';
import { ClientTabProps } from '../../types/client';
import TimelineHistoryButtons from './TimelineHistoryButtons';
import { CurrencyDollarIcon, PencilSquareIcon } from '@heroicons/react/24/outline';
import { supabase } from '../../lib/supabase';

interface PriceOfferHistoryEntry {
  id: string;
  messageId: string | null;
  senderName: string;
  senderEmail: string | null;
  sentAt: string | null;
  body: string;
  isFallback: boolean;
}

const PriceOfferTab: React.FC<ClientTabProps> = ({ client, onClientUpdate }) => {
  // Use values from client, fallback to defaults if missing
  const proposalTotal = client?.proposal_total;
  const currency = client?.proposal_currency ?? 'NIS';
  const closer = client?.closer || '---';
  const proposal = client?.proposal_text ?? '';

  const [isEditing, setIsEditing] = useState(false);
  const [editExtra, setEditExtra] = useState(3060.0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [history, setHistory] = useState<PriceOfferHistoryEntry[]>([]);
  const [activeOfferId, setActiveOfferId] = useState<string | null>(null);
  const [closerDisplayName, setCloserDisplayName] = useState<string>('---');
  const [legacyTotal, setLegacyTotal] = useState<number | null>(null);

  const isLegacyLead = useMemo(
    () => typeof client?.id === 'string' && client.id.startsWith('legacy_'),
    [client?.id]
  );

  // Use legacyTotal for legacy leads, otherwise use proposalTotal
  const total = isLegacyLead && legacyTotal !== null ? legacyTotal : proposalTotal;
  
  const [editTotal, setEditTotal] = useState<number | null | undefined>(proposalTotal);
  
  // Update editTotal when total changes (but not while editing)
  useEffect(() => {
    if (!isEditing) {
      setEditTotal(total);
    }
  }, [total, isEditing]);

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
          if (leadData?.total !== null && leadData?.total !== undefined) {
            const totalNum = typeof leadData.total === 'string' 
              ? parseFloat(leadData.total) 
              : Number(leadData.total);
            setLegacyTotal(!isNaN(totalNum) ? totalNum : null);
          } else {
            setLegacyTotal(null);
          }

          // Fetch display_name from tenants_employee if closer_id exists
          if (leadData?.closer_id) {
            const { data: employeeData, error: employeeError } = await supabase
              .from('tenants_employee')
              .select('display_name')
              .eq('id', leadData.closer_id)
              .maybeSingle();

            if (!employeeError && employeeData?.display_name) {
              setCloserDisplayName(employeeData.display_name);
            } else {
              setCloserDisplayName('---');
            }
          } else {
            setCloserDisplayName('---');
          }
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
  }, [client?.id, isLegacyLead, closer]);

  const convertHtmlToPlainText = (html: string | null | undefined): string => {
    if (!html) return '';
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/&nbsp;/gi, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(/\r/g, '')
      .trim();
  };

  useEffect(() => {
    const fetchHistory = async () => {
      if (!client?.id) {
        setHistory([]);
        setActiveOfferId(null);
        return;
      }

      setHistoryLoading(true);
      setHistoryError(null);

      try {
        let query = supabase
          .from('emails')
          .select('id, message_id, sender_name, sender_email, body_html, body_preview, sent_at')
          .like('message_id', 'offer_%')
          .order('sent_at', { ascending: false });

        if (isLegacyLead) {
          const legacyId = Number.parseInt(String(client.id).replace('legacy_', ''), 10);
          if (!Number.isNaN(legacyId)) {
            query = query.eq('legacy_id', legacyId);
          } else {
            query = query.eq('legacy_id', -1);
          }
        } else {
          query = query.eq('client_id', client.id);
        }

        const { data, error } = await query;

        if (error) {
          throw error;
        }

        const entries: PriceOfferHistoryEntry[] = (data || []).map((email) => {
          const bodyHtml: string | null = email.body_html;
          const bodyPreview: string | null = email.body_preview;
          const fallbackBody = bodyPreview && bodyPreview.trim() !== '' ? bodyPreview : bodyHtml;
          return {
            id: `email_${email.id}`,
            messageId: email.message_id,
            senderName: email.sender_name || closerDisplayName || '---',
            senderEmail: email.sender_email || null,
            sentAt: email.sent_at || null,
            body: convertHtmlToPlainText(fallbackBody) || proposal,
            isFallback: false,
          };
        });

        // For legacy leads, also fetch proposal from leads_lead table as a fallback
        // (only if no emails were found, since emails table is the primary source for multiple offers)
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
              
              // Only add as fallback if no emails exist
              entries.unshift({
                id: 'legacy_proposal',
                messageId: null,
                senderName: closerDisplayName,
                senderEmail: null,
                sentAt: null, // No date available from leads_lead.proposal
                body: legacyProposal,
                isFallback: true,
              });
            }
          }
        }

        setHistory(entries);
        if (entries.length > 0) {
          setActiveOfferId(entries[0].id);
        } else {
          setActiveOfferId(null);
        }
      } catch (error: any) {
        console.error('Failed to fetch price offer history:', error);
        setHistoryError('Failed to load previous offers.');
        setHistory([]);
        setActiveOfferId(null);
      } finally {
        setHistoryLoading(false);
      }
    };

    fetchHistory();
  }, [client?.id, isLegacyLead, closerDisplayName, proposal, client?.last_stage_changed_at]);

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

  const handleEdit = () => {
    setEditTotal(total);
    setEditExtra(3060.0);
    setIsEditing(true);
  };

  const handleSave = () => {
    // Handle saving the edited total and extra
    setIsEditing(false);
  };

  const handleCancel = () => {
    setIsEditing(false);
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
    if (history.length === 0) {
      return fallbackEntry ? [fallbackEntry] : [];
    }

    const offers = [...history];

    if (
      fallbackEntry &&
      !offers.some(entry => entry.body === fallbackEntry.body && entry.sentAt === fallbackEntry.sentAt)
    ) {
      offers.unshift(fallbackEntry);
    }

    return offers;
  }, [history, fallbackEntry]);

  useEffect(() => {
    if (!combinedOffers || combinedOffers.length === 0) {
      setActiveOfferId(null);
      return;
    }

    if (!activeOfferId || !combinedOffers.some(entry => entry.id === activeOfferId)) {
      setActiveOfferId(combinedOffers[0].id);
    }
  }, [combinedOffers, activeOfferId]);

  const activeOffer = useMemo(
    () => combinedOffers.find(entry => entry.id === activeOfferId) || combinedOffers[0] || null,
    [combinedOffers, activeOfferId]
  );

  const displayCloser = activeOffer?.senderName || closerDisplayName;
  const displayProposal = activeOffer?.body || proposal;
  const displaySentAt = activeOffer?.sentAt
    ? new Date(activeOffer.sentAt).toLocaleString()
    : null;

  return (
    <div className="p-2 sm:p-4 md:p-8">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-8 h-8 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 rounded-lg flex items-center justify-center">
          <CurrencyDollarIcon className="w-6 h-6 text-white" />
        </div>
        <div>
          <h2 className="text-2xl font-bold">Price Offer</h2>
          <p className="text-sm text-gray-500">Manage pricing and proposals</p>
        </div>
      </div>
      <div className="text-lg mb-4 text-base-content/80 flex flex-col gap-1">
        <span>
          <span className="font-semibold">Closer:</span> {displayCloser}
        </span>
        {displaySentAt && (
          <span className="text-sm text-base-content/60">
            Sent on {displaySentAt}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 mb-6">
        <span className="text-xl font-semibold">Total:</span>
        <span className="inline-flex items-center gap-2 bg-base-300 text-base-content font-bold rounded-lg px-4 py-2 text-lg tracking-wide shadow">
          <span className="text-base-content/70 text-base">₪</span>
          {typeof total === 'number' && !isNaN(total) ? total.toLocaleString() : '--'}
          {currency && (
            <span className="ml-2 text-base-content/80 font-medium">{currency}</span>
          )}
        </span>
      </div>
      <div className="mb-2 text-lg font-semibold">Proposal:</div>
      {historyLoading && (
        <div className="mb-4 text-sm text-base-content/60">Loading previous offers...</div>
      )}
      {historyError && (
        <div className="mb-4 text-sm text-error">{historyError}</div>
      )}
      {combinedOffers.length > 1 && (
        <div className="mb-6">
          <div className="text-sm font-semibold text-base-content/70 mb-2">
            Offer Versions
          </div>
          <div className="flex flex-wrap gap-2">
            {combinedOffers.map(entry => (
              <button
                key={entry.id}
                className={`btn btn-sm ${
                  entry.id === activeOfferId
                    ? 'btn-primary'
                    : 'btn-outline border-base-300 text-base-content/80'
                }`}
                onClick={() => setActiveOfferId(entry.id)}
              >
                {entry.isFallback
                  ? 'Current Offer'
                  : `${entry.senderName || 'Offer'}${entry.sentAt ? ` • ${new Date(entry.sentAt).toLocaleString()}` : ''}`}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="mb-8">
        <div className="w-full min-h-[200px] max-h-[600px] border border-base-300 rounded-xl p-4 text-base font-medium bg-base-100 shadow-inner overflow-y-auto">
          {renderProposalContent(displayProposal)}
        </div>
      </div>
      {isEditing ? (
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center mb-2">
          <div className="flex gap-2 items-center">
            <label className="font-semibold">Total:</label>
            <input
              type="number"
              className="input input-bordered w-28"
              value={editTotal}
              onChange={e => setEditTotal(Number(e.target.value))}
              min={0}
            />
          </div>
          <div className="flex gap-2 items-center">
            <label className="font-semibold">Extra:</label>
            <input
              type="number"
              className="input input-bordered w-28"
              value={editExtra}
              onChange={e => setEditExtra(Number(e.target.value))}
              min={0}
            />
          </div>
          <div className="flex gap-2 mt-2 sm:mt-0">
            <button className="btn btn-success btn-sm" onClick={handleSave}>Save</button>
            <button className="btn btn-ghost btn-sm" onClick={handleCancel}>Cancel</button>
          </div>
        </div>
      ) : (
        <button className="btn btn-outline flex items-center gap-2" onClick={handleEdit}>
          <PencilSquareIcon className="w-5 h-5" />
          Edit Total
        </button>
      )}
      
      <TimelineHistoryButtons client={client} />
    </div>
  );
};

export default PriceOfferTab;
