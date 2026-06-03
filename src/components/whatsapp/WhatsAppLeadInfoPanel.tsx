import React, { useMemo } from 'react';
import {
  ChevronLeftIcon,
  PhoneIcon,
  LinkIcon,
  UserGroupIcon,
  LockClosedIcon,
  ClockIcon,
  ChatBubbleLeftRightIcon,
} from '@heroicons/react/24/outline';
import { format } from 'date-fns';
import WhatsAppAvatar from './WhatsAppAvatar';

export type WhatsAppLeadInfoPanelLead = {
  id: number;
  phone_number?: string;
  sender_name: string;
  message: string;
  message_count: number;
  unread_count?: number;
  last_message_at: string;
  profile_picture_url?: string | null;
  is_connected: boolean;
  lead_id?: string | null;
  legacy_id?: number | null;
};

type ConnectedLeadRow = {
  id: string;
  lead_number: string;
  name: string;
  isLegacy: boolean;
};

type ConnectedContactRow = {
  id: number;
  name: string;
  lead_number: string;
  isLegacy: boolean;
};

type WhatsAppLeadInfoPanelProps = {
  lead: WhatsAppLeadInfoPanelLead;
  displayName: string;
  hasDisplayName: boolean;
  connectedLeads: ConnectedLeadRow[];
  connectedContacts: ConnectedContactRow[];
  loadingConnections: boolean;
  messages: Array<{ sent_at: string; direction?: string }>;
  isLocked: boolean;
  timeLeft: string;
  getMessagePreview: (message: string) => string;
  onClose: () => void;
  onOpenLead: (leadNumber: string, openInNewTab: boolean) => void;
  className?: string;
};

const WhatsAppLeadInfoPanel: React.FC<WhatsAppLeadInfoPanelProps> = ({
  lead,
  displayName,
  hasDisplayName,
  connectedLeads,
  connectedContacts,
  loadingConnections,
  messages,
  isLocked,
  timeLeft,
  getMessagePreview,
  onClose,
  onOpenLead,
  className = '',
}) => {
  const phone = lead.phone_number?.trim() || null;

  const whatsappDisplayName = useMemo(() => {
    const name = (lead.sender_name || '').trim();
    if (!name || name === phone || /^\d+$/.test(name)) return null;
    return name;
  }, [lead.sender_name, phone]);

  const messageStats = useMemo(() => {
    if (!messages.length) return null;
    const sorted = [...messages].sort(
      (a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime(),
    );
    const incoming = messages.filter((m) => m.direction === 'in').length;
    const outgoing = messages.filter((m) => m.direction === 'out').length;
    return {
      firstAt: sorted[0]?.sent_at,
      lastAt: sorted[sorted.length - 1]?.sent_at,
      incoming,
      outgoing,
    };
  }, [messages]);

  const formatFullTime = (ts?: string) => {
    if (!ts) return '—';
    try {
      return format(new Date(ts), 'dd MMM yyyy, HH:mm');
    } catch {
      return ts;
    }
  };

  const handleCall = () => {
    if (!phone) return;
    window.location.href = `tel:${phone.replace(/\s+/g, '')}`;
  };

  const DetailRow = ({
    label,
    children,
  }: {
    label: string;
    children: React.ReactNode;
  }) => (
    <div>
      <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</dt>
      <dd className="text-gray-900 mt-0.5 break-words">{children}</dd>
    </div>
  );

  return (
    <aside
      className={`flex flex-col min-h-0 bg-white border-l border-gray-200 w-full md:w-80 flex-shrink-0 max-md:border-l-0 ${className}`}
      aria-label="WhatsApp lead details"
    >
      <div className="flex items-center gap-2 px-3 py-3 border-b border-gray-200 flex-shrink-0 min-w-0">
        <button
          type="button"
          onClick={onClose}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gray-700 hover:bg-gray-100 border-0 bg-transparent p-0"
          aria-label="Close details panel"
          title="Close panel"
        >
          <ChevronLeftIcon className="h-7 w-7" strokeWidth={2.5} aria-hidden />
        </button>
        <WhatsAppAvatar
          name={hasDisplayName ? displayName : '?'}
          profilePictureUrl={lead.profile_picture_url}
          size="md"
          colorSeed={String(lead.phone_number ?? lead.id)}
        />
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-gray-900 truncate">{displayName}</h3>
          {phone && <p className="text-xs text-gray-500 truncate">{phone}</p>}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 px-4 py-4 space-y-5">
        <button
          type="button"
          onClick={handleCall}
          disabled={!phone}
          className="btn btn-sm w-full gap-2 bg-gray-100 hover:bg-gray-200 border-0 text-gray-900 disabled:opacity-50 rounded-xl"
        >
          <PhoneIcon className="w-4 h-4" />
          Call
        </button>

        <dl className="space-y-3 text-sm">
          {phone && <DetailRow label="Phone">{phone}</DetailRow>}
          {whatsappDisplayName && (
            <DetailRow label="WhatsApp name">{whatsappDisplayName}</DetailRow>
          )}
          <DetailRow label="CRM status">
            {lead.is_connected || connectedLeads.length > 0 || connectedContacts.length > 0
              ? 'Linked to CRM'
              : 'Not linked yet'}
          </DetailRow>
          <DetailRow label="Messages (thread)">{lead.message_count}</DetailRow>
          {(lead.unread_count ?? 0) > 0 && (
            <DetailRow label="Unread">{lead.unread_count}</DetailRow>
          )}
          {messageStats && (
            <>
              <DetailRow label="In this chat">
                {messageStats.incoming} received · {messageStats.outgoing} sent
              </DetailRow>
              <DetailRow label="First message">{formatFullTime(messageStats.firstAt)}</DetailRow>
              <DetailRow label="Last activity">{formatFullTime(messageStats.lastAt)}</DetailRow>
            </>
          )}
          {!messageStats && (
            <DetailRow label="Last activity">{formatFullTime(lead.last_message_at)}</DetailRow>
          )}
          <DetailRow label="24h window">
            <span className="inline-flex items-center gap-1">
              {isLocked ? (
                <>
                  <LockClosedIcon className="w-4 h-4 text-red-600" />
                  <span className="text-red-700 font-medium">Locked — use templates</span>
                </>
              ) : (
                <>
                  <ClockIcon className="w-4 h-4 text-yellow-700" />
                  <span>{timeLeft || 'Open'}</span>
                </>
              )}
            </span>
          </DetailRow>
        </dl>

        <div>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1">
            <ChatBubbleLeftRightIcon className="w-4 h-4" />
            Latest message
          </h4>
          <p className="text-sm text-gray-700 whitespace-pre-wrap break-words rounded-lg bg-gray-50 border border-gray-100 px-3 py-2">
            {getMessagePreview(lead.message) || '—'}
          </p>
        </div>

        <div>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Connected leads
          </h4>
          {loadingConnections ? (
            <div className="flex justify-center py-4">
              <div className="loading loading-spinner loading-md text-green-600" />
            </div>
          ) : connectedLeads.length === 0 ? (
            <p className="text-sm text-gray-400">No linked leads</p>
          ) : (
            <ul className="space-y-2">
              {connectedLeads.map((row) => (
                <li key={`lead-${row.id}`}>
                  <button
                    type="button"
                    onClick={(e) => onOpenLead(row.lead_number, e.metaKey || e.ctrlKey)}
                    className="w-full text-left rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5 hover:bg-gray-100 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <UserGroupIcon className="w-4 h-4 text-blue-600 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 truncate">{row.name}</p>
                        <p className="text-xs text-gray-500 font-mono truncate">#{row.lead_number}</p>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Connected contacts
          </h4>
          {loadingConnections ? null : connectedContacts.length === 0 ? (
            <p className="text-sm text-gray-400">No linked contacts</p>
          ) : (
            <ul className="space-y-2">
              {connectedContacts.map((row) => (
                <li key={`contact-${row.id}`}>
                  <button
                    type="button"
                    onClick={(e) => onOpenLead(row.lead_number, e.metaKey || e.ctrlKey)}
                    className="w-full text-left rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5 hover:bg-gray-100 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <LinkIcon className="w-4 h-4 text-purple-600 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 truncate">{row.name}</p>
                        <p className="text-xs text-gray-500 truncate">Lead #{row.lead_number}</p>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </aside>
  );
};

export default WhatsAppLeadInfoPanel;
