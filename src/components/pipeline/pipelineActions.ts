import { supabase } from '../../lib/supabase';
import { openLeadFromRowClick } from '../../lib/leadNavigation';
import { updateLeadStageWithHistory, fetchStageActorInfo } from '../../lib/leadStageManager';
import type { CombinedLead } from '../../lib/legacyLeadsApi';
import type { PipelineFollowupLeadSource } from './PipelineFollowupAiCell';

export type PipelineRailAction = 'ai' | 'followup' | 'email' | 'call' | 'whatsapp' | 'finance';

export type PipelineActionLead = PipelineFollowupLeadSource & {
  navId: string;
  phone?: string | null;
  mobile?: string | null;
  email?: string | null;
  topic?: string | null;
  language?: string | null;
  category?: string | null;
};

export type PipelineLeadSelectProps = {
  selectedLeadId?: string | null;
  selectedLeadIds?: string[];
  picking?: boolean;
  multiSelect?: boolean;
  onSelectLead?: (lead: PipelineActionLead, event?: React.MouseEvent) => void;
  refreshToken?: number;
};

export function isPipelineLeadPicked(
  leadId: string | number,
  selectedLeadId?: string | null,
  selectedLeadIds?: string[],
): boolean {
  const id = String(leadId);
  if (selectedLeadIds) return selectedLeadIds.includes(id);
  return selectedLeadId != null && String(selectedLeadId) === id;
}

export function isLegacyActionLead(lead: Pick<PipelineActionLead, 'id' | 'lead_type' | 'isNewLead'>): boolean {
  return lead.lead_type === 'legacy' || lead.isNewLead === false || String(lead.id).startsWith('legacy_');
}

export function toPipelineActionLead(row: {
  id: string | number;
  navId?: string | null;
  nav_id?: string | null;
  name?: string | null;
  client_name?: string | null;
  lead_number?: string | null;
  phone?: string | null;
  mobile?: string | null;
  email?: string | null;
  lead_type?: string;
  isNewLead?: boolean;
  created_at?: string | null;
  assigned_date?: string | null;
  stage?: string | number | null;
  facts?: string | null;
  special_notes?: string | null;
  next_followup?: string | null;
  follow_up?: string | null;
  topic?: string | null;
  language?: string | null;
  category?: string | null;
}): PipelineActionLead {
  const id = String(row.id);
  const leadNumber = String(row.lead_number || row.navId || row.nav_id || id);
  return {
    id,
    navId: String(row.navId || row.nav_id || leadNumber),
    name: String(row.name || row.client_name || ''),
    lead_number: leadNumber,
    phone: row.phone || null,
    mobile: row.mobile || null,
    email: row.email || null,
    lead_type: row.lead_type || (row.isNewLead === false || id.startsWith('legacy_') ? 'legacy' : 'new'),
    isNewLead: row.isNewLead,
    created_at: row.created_at || null,
    assigned_date: row.assigned_date || null,
    stage: row.stage ?? null,
    facts: row.facts || null,
    special_notes: row.special_notes || null,
    next_followup: row.next_followup || row.follow_up || null,
    topic: row.topic || null,
    language: row.language || null,
    category: row.category || null,
  };
}

export function handlePipelineRowPick(
  event: React.MouseEvent | undefined,
  lead: PipelineActionLead,
  navigate: (path: string) => void,
  options?: {
    multiSelect?: boolean;
    onSelectLead?: (lead: PipelineActionLead, event?: React.MouseEvent) => void;
  },
): void {
  if (
    options?.multiSelect &&
    options.onSelectLead &&
    !(event?.metaKey || event?.ctrlKey || event?.button === 1)
  ) {
    options.onSelectLead(lead, event);
    return;
  }
  openLeadFromRowClick(event, lead.navId, navigate);
}

export async function applyPipelineBulkStageChange(
  leads: PipelineActionLead[],
  stage: string | number,
): Promise<{ updated: number; failed: number }> {
  const actor = await fetchStageActorInfo();
  let updated = 0;
  let failed = 0;
  for (const lead of leads) {
    try {
      await updateLeadStageWithHistory({
        lead: {
          id: String(lead.id),
          lead_number: lead.lead_number || '',
          name: lead.name || '',
          lead_type: isLegacyActionLead(lead) ? 'legacy' : 'new',
        } as CombinedLead,
        stage,
        actor,
      });
      updated += 1;
    } catch (error) {
      console.error('Bulk stage change failed', lead.id, error);
      failed += 1;
    }
  }
  return { updated, failed };
}

function asContact(data: { phone?: string | null; mobile?: string | null; email?: string | null } | null | undefined) {
  if (!data) return null;
  return {
    phone: data.phone || null,
    mobile: data.mobile || null,
    email: data.email || null,
  };
}

/** Fill phone / email when a pipeline row was loaded without them. */
export async function hydratePipelineActionLead(lead: PipelineActionLead): Promise<PipelineActionLead> {
  const hasPhone = Boolean(lead.phone || lead.mobile);
  const hasEmail = Boolean(lead.email && String(lead.email).trim());
  if (hasPhone && hasEmail) return lead;
  const rawId = String(lead.id).replace(/^legacy_/i, '');
  const mergeContact = (
    next: PipelineActionLead,
    contact: { phone?: string | null; mobile?: string | null; email?: string | null } | null,
  ): PipelineActionLead => ({
    ...next,
    phone: next.phone || contact?.phone || null,
    mobile: next.mobile || contact?.mobile || null,
    email: next.email || contact?.email || null,
  });
  try {
    if (isLegacyActionLead(lead)) {
      let next = lead;
      if (!hasPhone) {
        const { data } = await supabase
          .from('leads_lead')
          .select('phone')
          .eq('id', rawId)
          .maybeSingle();
        next = mergeContact(next, asContact(data));
      }
      if (!next.email) {
        const { data: contacts } = await supabase
          .from('lead_leadcontact')
          .select('leads_contact ( phone, mobile, email )')
          .eq('lead_id', rawId)
          .eq('main', 'true')
          .maybeSingle();
        const contact = Array.isArray((contacts as { leads_contact?: unknown } | null)?.leads_contact)
          ? (contacts as { leads_contact: Array<{ phone?: string | null; mobile?: string | null; email?: string | null }> }).leads_contact[0]
          : (contacts as { leads_contact?: { phone?: string | null; mobile?: string | null; email?: string | null } } | null)?.leads_contact;
        next = mergeContact(next, asContact(contact));
      }
      return next;
    }

    const { data } = await supabase
      .from('leads')
      .select('phone, mobile, email')
      .eq('id', rawId)
      .maybeSingle();
    return mergeContact(lead, asContact(data));
  } catch (error) {
    console.error('Failed to load lead contact details', error);
  }
  return lead;
}
