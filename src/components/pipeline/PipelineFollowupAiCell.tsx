import React from 'react';
import { SparklesIcon } from '@heroicons/react/24/outline';
import type { Lead } from '../../lib/supabase';
import { PIPELINE_CELL_MID } from './pipelineUi';

export type PipelineFollowupLeadSource = {
  id: string | number;
  lead_number?: string | null;
  name?: string | null;
  client_name?: string | null;
  lead_type?: 'new' | 'legacy' | string;
  isNewLead?: boolean;
  created_at?: string | null;
  assigned_date?: string | null;
  stage?: string | number | null;
  facts?: string | null;
  special_notes?: string | null;
  next_followup?: string | null;
  follow_up?: string | null;
};

export function toPipelineFollowupLead(row: PipelineFollowupLeadSource): Lead {
  const idStr = String(row.id);
  const isLegacy =
    row.lead_type === 'legacy' || row.isNewLead === false || idStr.startsWith('legacy_');
  const id = isLegacy ? (idStr.startsWith('legacy_') ? idStr : `legacy_${idStr}`) : idStr.replace(/^legacy_/i, '');
  return {
    id,
    lead_number: String(row.lead_number || ''),
    name: String(row.name || row.client_name || ''),
    created_at: String(row.created_at || row.assigned_date || ''),
    source: '',
    language: '',
    topic: '',
    facts: String(row.facts || ''),
    special_notes: String(row.special_notes || ''),
    status: 'in_progress',
    stage: String(row.stage ?? '') as Lead['stage'],
    next_followup: row.next_followup || row.follow_up || undefined,
    lead_type: isLegacy ? 'legacy' : 'new',
  } as Lead;
}

export const PipelineFollowupAiHeader: React.FC = () => (
  <th className="w-10 px-1 py-3" aria-label="AI follow-up" />
);

type CellProps = {
  name: string;
  onOpen: (event: React.MouseEvent) => void;
};

export const PipelineFollowupAiCell: React.FC<CellProps> = ({ name, onOpen }) => (
  <td className={`${PIPELINE_CELL_MID} pipeline-ai-cell w-10 px-1`}>
    <button
      type="button"
      className="pipeline-ai-btn flex h-8 w-8 items-center justify-center rounded-full text-violet-600 hover:bg-violet-50"
      onClick={(event) => {
        event.stopPropagation();
        onOpen(event);
      }}
      title="AI follow-up"
      aria-label={`AI follow-up for ${name}`}
    >
      <SparklesIcon className="h-5 w-5" aria-hidden />
    </button>
  </td>
);
