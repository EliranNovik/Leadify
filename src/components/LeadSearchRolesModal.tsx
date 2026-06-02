import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import type { Lead } from '../lib/supabase';
import type { Client } from '../types/client';
import RolesTab from './client-tabs/RolesTab';

type LeadSearchRolesModalProps = {
  lead: Lead | null;
  isOpen: boolean;
  onClose: () => void;
};

function toRolesClient(lead: Lead): Client {
  const anyLead = lead as Record<string, unknown>;
  const roles = (anyLead.roles as Record<string, string | null | undefined>) || {};
  const isLegacy = anyLead.lead_type === 'legacy';

  return {
    ...(lead as Client),
    lead_type: isLegacy ? 'legacy' : 'new',
    id: String(anyLead.id ?? ''),
    name: String(anyLead.name ?? 'Unknown'),
    scheduler: (anyLead.scheduler ?? roles.scheduler) as string | undefined,
    manager: (anyLead.manager ?? roles.manager) as string | undefined,
    helper: (anyLead.helper ?? roles.lawyer ?? anyLead.lawyer) as string | undefined,
    expert: (anyLead.expert ?? roles.expert) as string | undefined,
    closer: (anyLead.closer ?? roles.closer) as string | undefined,
    handler: (anyLead.handler ?? roles.case_handler ?? anyLead.case_handler) as string | undefined,
    meeting_scheduler_id: anyLead.meeting_scheduler_id as string | undefined,
    meeting_manager_id: anyLead.meeting_manager_id as string | undefined,
    meeting_lawyer_id: anyLead.meeting_lawyer_id as string | undefined,
    expert_id: anyLead.expert_id as string | undefined,
    closer_id: anyLead.closer_id as string | undefined,
    case_handler_id: anyLead.case_handler_id as string | undefined,
    retainer_handler_id: anyLead.retainer_handler_id as string | undefined,
    meeting_collection_id: anyLead.meeting_collection_id as string | number | null | undefined,
    marketing_officer_id: anyLead.marketing_officer_id as string | number | null | undefined,
    sales_roles_locked: anyLead.sales_roles_locked as boolean | string | undefined,
  };
}

const LeadSearchRolesModal: React.FC<LeadSearchRolesModalProps> = ({ lead, isOpen, onClose }) => {
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const client = useMemo(() => (lead ? toRolesClient(lead) : null), [lead]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('tenants_employee')
          .select('id, display_name, photo_url, photo')
          .not('display_name', 'is', null);
        if (!cancelled && !error) {
          setEmployees(data || []);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  if (!isOpen || !lead || !client) return null;

  const leadNumber =
    (lead as { display_lead_number?: string }).display_lead_number ||
    lead.lead_number ||
    lead.id;

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-end justify-center p-0 sm:items-center sm:p-4" role="presentation">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <div
        className="relative z-10 flex h-[min(92vh,720px)] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:h-[min(85vh,720px)] sm:rounded-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lead-roles-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-200 px-4 py-4 sm:px-6">
          <div className="min-w-0 pr-2">
            <h3 id="lead-roles-modal-title" className="truncate text-lg font-bold text-gray-900">
              {lead.name}
            </h3>
            <p className="mt-0.5 font-mono text-sm text-gray-500">#{leadNumber}</p>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-circle btn-sm shrink-0"
            onClick={onClose}
            aria-label="Close"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-16">
              <span className="loading loading-spinner loading-lg text-primary" />
            </div>
          ) : (
            <RolesTab client={client} allEmployees={employees} readOnly />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default LeadSearchRolesModal;
