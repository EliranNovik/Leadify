import React, { useEffect, useState } from 'react';
import {
  ChatBubbleLeftRightIcon,
  EnvelopeIcon,
  PhoneIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import {
  fetchLeadRecentInteractions,
  type LeadRecentInteractions,
  type RecentInteractionItem,
} from '../../lib/leadActionCounts';
import { parseDateMs } from '../../lib/pipelineSummary';

export type PipelineInteractionsLead = {
  id: string | number;
  lead_number: string;
  name?: string | null;
  lead_type?: string | null;
};

type Props = {
  lead: PipelineInteractionsLead | null;
  onClose: () => void;
};

function formatDisplayDate(value: string | null | undefined): string {
  const ms = parseDateMs(value);
  if (ms == null) return '—';
  return new Date(ms).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

const PipelineLastInteractionsModal: React.FC<Props> = ({ lead, onClose }) => {
  const [interactions, setInteractions] = useState<LeadRecentInteractions | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!lead) {
      setInteractions(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setInteractions(null);
    fetchLeadRecentInteractions({
      id: lead.id,
      lead_type: lead.lead_type,
      lead_number: lead.lead_number,
    })
      .then((data) => {
        if (!cancelled) setInteractions(data);
      })
      .catch((error) => {
        console.error('Failed to load interactions:', error);
        if (!cancelled) setInteractions({ calls: [], emails: [], whatsapp: [] });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [lead]);

  if (!lead) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pipeline-interactions-title"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 id="pipeline-interactions-title" className="text-lg font-bold text-gray-900">
              Last interactions
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              #{lead.lead_number}
              {lead.name ? ` · ${lead.name}` : ''}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-circle"
            onClick={onClose}
            aria-label="Close"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <span className="loading loading-spinner loading-lg text-primary" />
          </div>
        ) : (
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <InteractionColumn
              title="WhatsApp"
              icon={ChatBubbleLeftRightIcon}
              accent="text-emerald-600"
              items={interactions?.whatsapp || []}
            />
            <InteractionColumn
              title="Calls"
              icon={PhoneIcon}
              accent="text-sky-600"
              items={interactions?.calls || []}
            />
            <InteractionColumn
              title="Emails"
              icon={EnvelopeIcon}
              accent="text-violet-600"
              items={interactions?.emails || []}
            />
          </div>
        )}
      </div>
    </div>
  );
};

function InteractionColumn({
  title,
  icon: Icon,
  accent,
  items,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
  items: RecentInteractionItem[];
}) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-gray-50/60 p-3">
      <div className="flex items-center gap-2 px-1 pb-2">
        <Icon className={`h-4 w-4 ${accent}`} />
        <span className="text-sm font-semibold text-gray-800">{title}</span>
        <span className="ml-auto text-xs text-gray-400">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="px-1 py-4 text-center text-xs text-gray-400">No {title.toLowerCase()} yet</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={`${item.kind}-${item.id}`} className="rounded-xl bg-white p-2.5 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                  {item.direction === 'in' ? 'Incoming' : item.direction === 'out' ? 'Outgoing' : '—'}
                </span>
                <span className="text-[11px] text-gray-400">{formatDisplayDate(item.at)}</span>
              </div>
              <p className="mt-1 break-words text-sm text-gray-800">{item.preview}</p>
              {item.meta ? (
                <p className="mt-0.5 truncate text-[11px] text-gray-400" title={item.meta}>
                  {item.meta}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default PipelineLastInteractionsModal;
