import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronLeftIcon,
  PhoneIcon,
  EnvelopeIcon,
  ArrowDownIcon,
  ArrowUpIcon,
} from '@heroicons/react/24/outline';
import { format } from 'date-fns';
import { toast } from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { getStageName } from '../../lib/stageUtils';
import {
  buildEmailFilterClauses,
  collectClientEmails,
  EMAIL_MODAL_SELECT,
  fetchLeadEmailsForTimeline,
} from '../../lib/interactions/emailFilters';
import type { ContactInfo } from '../../lib/contactHelpers';
import EmailThreadModal from '../EmailThreadModal';
import { formatEmailPlainTextPreview } from '../client-tabs/interactionsEmailViewUtils';
import WhatsAppAvatar from './WhatsAppAvatar';

export type WhatsAppClientInfoPanelClient = {
  id: string;
  lead_number: string;
  name: string;
  email?: string;
  phone?: string;
  mobile?: string;
  topic?: string;
  stage?: string;
  lead_type?: 'legacy' | 'new';
  lead_id?: string | null;
  contact_id?: number;
  isContact?: boolean;
};

type EmailRow = {
  id: number;
  subject?: string | null;
  sent_at: string;
  direction?: string | null;
  sender_email?: string | null;
  recipient_list?: string | null;
  body_preview?: string | null;
  body_html?: string | null;
};

type WhatsAppClientInfoPanelProps = {
  client: WhatsAppClientInfoPanelClient;
  leadContacts?: ContactInfo[];
  onClose: () => void;
  className?: string;
};

const WhatsAppClientInfoPanel: React.FC<WhatsAppClientInfoPanelProps> = ({
  client,
  leadContacts = [],
  onClose,
  className = '',
}) => {
  const [factsText, setFactsText] = useState<string | null>(null);
  const [loadingFacts, setLoadingFacts] = useState(false);
  const [emails, setEmails] = useState<EmailRow[]>([]);
  const [loadingEmails, setLoadingEmails] = useState(false);
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);

  const isLegacy =
    client.lead_type === 'legacy' || client.id?.toString().startsWith('legacy_');

  const loadFacts = useCallback(async () => {
    setLoadingFacts(true);
    try {
      if (isLegacy) {
        const raw = String(client.id).replace('legacy_', '') || String(client.lead_id ?? '');
        const legacyId = Number(raw);
        if (Number.isNaN(legacyId)) {
          setFactsText(null);
          return;
        }
        const { data, error } = await supabase
          .from('leads_lead')
          .select('description')
          .eq('id', legacyId)
          .maybeSingle();
        if (error) throw error;
        setFactsText((data?.description as string | null)?.trim() || null);
      } else {
        const leadId = client.lead_id || client.id;
        const { data, error } = await supabase
          .from('leads')
          .select('facts')
          .eq('id', leadId)
          .maybeSingle();
        if (error) throw error;
        setFactsText((data?.facts as string | null)?.trim() || null);
      }
    } catch {
      setFactsText(null);
    } finally {
      setLoadingFacts(false);
    }
  }, [client.id, client.lead_id, isLegacy]);

  const loadEmails = useCallback(async () => {
    setLoadingEmails(true);
    try {
      const legacyId = isLegacy
        ? Number(String(client.id).replace('legacy_', '') || client.lead_id)
        : null;
      const clientEmails = collectClientEmails(client);
      const allEmails = [...clientEmails];
      leadContacts.forEach((c) => {
        if (c.email) {
          const n = c.email.trim().toLowerCase();
          if (n && !allEmails.includes(n)) allEmails.push(n);
        }
      });

      const emailFilters = buildEmailFilterClauses({
        clientId: !isLegacy ? String(client.lead_id || client.id) : null,
        legacyId: isLegacy && legacyId != null && !Number.isNaN(legacyId) ? legacyId : null,
        emails: allEmails,
      });

      const { data, error } = await fetchLeadEmailsForTimeline(supabase, {
        isLegacyLead: isLegacy,
        legacyId: isLegacy && legacyId != null && !Number.isNaN(legacyId) ? legacyId : null,
        clientId: client.lead_id || client.id,
        emailFilters,
        limit: 40,
        select: EMAIL_MODAL_SELECT,
        matchByAddress: true,
      });

      if (error) throw error;

      const rows = (data || []) as EmailRow[];
      rows.sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime());
      setEmails(rows);
    } catch {
      toast.error('Failed to load emails');
      setEmails([]);
    } finally {
      setLoadingEmails(false);
    }
  }, [client, isLegacy, leadContacts]);

  useEffect(() => {
    void loadFacts();
    void loadEmails();
  }, [loadFacts, loadEmails]);

  const callNumber = useMemo(() => {
    const raw = (client.mobile || client.phone || '').replace(/\s+/g, '');
    return raw || null;
  }, [client.mobile, client.phone]);

  const emailModalContact = useMemo(() => {
    const main =
      leadContacts.find((c) => c.isMain) ||
      leadContacts[0] ||
      ({
        id: client.contact_id ?? 0,
        name: client.name,
        email: client.email ?? null,
        phone: client.phone ?? null,
        mobile: client.mobile ?? null,
        country_id: null,
        isMain: true,
      } as ContactInfo);

    const leadId = isLegacy
      ? String(client.id).replace('legacy_', '') || String(client.lead_id ?? client.id)
      : client.lead_id || client.id;

    return {
      contact: main,
      leadId,
      leadType: isLegacy ? ('legacy' as const) : ('new' as const),
    };
  }, [client, leadContacts, isLegacy]);

  const stageName = client.stage ? getStageName(client.stage) : null;

  const handleCall = () => {
    if (!callNumber) {
      toast.error('No phone number available');
      return;
    }
    window.location.href = `tel:${callNumber}`;
  };

  const handleEmail = () => {
    const hasEmail =
      client.email ||
      leadContacts.some((c) => c.email) ||
      emails.length > 0;
    if (!hasEmail) {
      toast.error('No email address available');
      return;
    }
    setIsEmailModalOpen(true);
  };

  const formatEmailTime = (sentAt: string) => {
    try {
      return format(new Date(sentAt), 'dd MMM yyyy, HH:mm');
    } catch {
      return sentAt;
    }
  };

  const isIncoming = (dir?: string | null) => {
    const d = String(dir || '').toLowerCase();
    return d === 'incoming' || d === 'in';
  };

  return (
    <>
      <aside
        className={`flex flex-col min-h-0 bg-white border-l border-gray-200 w-full md:w-80 flex-shrink-0 max-md:border-l-0 ${className}`}
        aria-label="Client details"
      >
        <div className="flex items-center gap-2 px-3 py-3 border-b border-gray-200 flex-shrink-0 min-w-0">
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gray-700 hover:bg-gray-100 border-0 bg-transparent p-0"
            aria-label="Close client panel"
            title="Close panel"
          >
            <ChevronLeftIcon className="h-7 w-7" strokeWidth={2.5} aria-hidden />
          </button>
          <WhatsAppAvatar
            name={client.name}
            size="md"
            colorSeed={String(client.contact_id ?? client.id)}
          />
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-gray-900 truncate">{client.name}</h3>
            <p className="text-xs text-gray-500 font-mono truncate">#{client.lead_number}</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 px-4 py-4 space-y-5">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCall}
              disabled={!callNumber}
              className="btn btn-sm flex-1 gap-2 bg-gray-100 hover:bg-gray-200 border-0 text-gray-900 disabled:opacity-50"
            >
              <PhoneIcon className="w-4 h-4" />
              Call
            </button>
            <button
              type="button"
              onClick={handleEmail}
              className="btn btn-sm flex-1 gap-2 bg-gray-100 hover:bg-gray-200 border-0 text-gray-900"
            >
              <EnvelopeIcon className="w-4 h-4" />
              Email
            </button>
          </div>

          <dl className="space-y-3 text-sm">
            {client.phone && (
              <div>
                <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">Phone</dt>
                <dd className="text-gray-900 mt-0.5 break-all">{client.phone}</dd>
              </div>
            )}
            {client.mobile && (
              <div>
                <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">Mobile</dt>
                <dd className="text-gray-900 mt-0.5 break-all">{client.mobile}</dd>
              </div>
            )}
            {client.email && (
              <div>
                <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">Email</dt>
                <dd className="text-gray-900 mt-0.5 break-all">{client.email}</dd>
              </div>
            )}
            {client.topic && (
              <div>
                <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">Topic</dt>
                <dd className="text-gray-900 mt-0.5">{client.topic}</dd>
              </div>
            )}
            {stageName && (
              <div>
                <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">Stage</dt>
                <dd className="text-gray-900 mt-0.5">{stageName}</dd>
              </div>
            )}
            <div>
              <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                {isLegacy ? 'Facts' : 'Facts'}
              </dt>
              <dd className="text-gray-900 mt-0.5 whitespace-pre-wrap">
                {loadingFacts ? (
                  <span className="text-gray-400">Loading…</span>
                ) : factsText ? (
                  factsText
                ) : (
                  <span className="text-gray-400">—</span>
                )}
              </dd>
            </div>
          </dl>

          <div>
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Emails
            </h4>
            {loadingEmails ? (
              <div className="flex justify-center py-6">
                <div className="loading loading-spinner loading-md text-green-600" />
              </div>
            ) : emails.length === 0 ? (
              <p className="text-sm text-gray-400">No emails found</p>
            ) : (
              <ul className="space-y-2">
                {emails.map((email) => {
                  const incoming = isIncoming(email.direction);
                  const previewText = formatEmailPlainTextPreview(
                    email.body_preview,
                    email.body_html,
                  );
                  return (
                    <li
                      key={email.id}
                      className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5"
                    >
                      <div className="flex items-start gap-2">
                        <span
                          className={`flex-shrink-0 mt-0.5 ${
                            incoming ? 'text-blue-600' : 'text-green-600'
                          }`}
                          title={incoming ? 'Received' : 'Sent'}
                        >
                          {incoming ? (
                            <ArrowDownIcon className="w-4 h-4" />
                          ) : (
                            <ArrowUpIcon className="w-4 h-4" />
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-gray-500">{formatEmailTime(email.sent_at)}</p>
                          <p className="text-sm font-medium text-gray-900 truncate mt-0.5">
                            {email.subject?.trim() || '(No subject)'}
                          </p>
                          {previewText && (
                            <p className="text-xs text-gray-600 line-clamp-2 mt-1 break-words">
                              {previewText}
                            </p>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </aside>

      <EmailThreadModal
        isOpen={isEmailModalOpen}
        onClose={() => setIsEmailModalOpen(false)}
        selectedContact={emailModalContact}
      />
    </>
  );
};

export default WhatsAppClientInfoPanel;
