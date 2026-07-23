import { supabase } from './supabase';
import { fetchStageActorInfo } from './leadStageManager';

export type RecruitmentStage = {
  id: number;
  slug: string;
  name: string;
  colour: string;
  sort_order: number;
  is_terminal: boolean;
};

let stagesCache: RecruitmentStage[] | null = null;

export async function fetchRecruitmentStages(force = false): Promise<RecruitmentStage[]> {
  if (!force && stagesCache) return stagesCache;
  const { data, error } = await supabase
    .from('recruitment_stages')
    .select('id, slug, name, colour, sort_order, is_terminal')
    .order('sort_order', { ascending: true });
  if (error) throw error;
  stagesCache = (data || []) as RecruitmentStage[];
  return stagesCache;
}

export function getRecruitmentStageBySlug(
  stages: RecruitmentStage[],
  slug: string,
): RecruitmentStage | null {
  return stages.find((s) => s.slug === slug) ?? null;
}

export function getRecruitmentStageById(
  stages: RecruitmentStage[],
  id: number | null | undefined,
): RecruitmentStage | null {
  if (id == null) return null;
  return stages.find((s) => s.id === id) ?? null;
}

export async function updateCandidateStageWithHistory(params: {
  candidateId: number;
  stageId: number;
  note?: string | null;
}): Promise<void> {
  const actor = await fetchStageActorInfo();
  const timestamp = new Date().toISOString();

  const { error: updateError } = await supabase
    .from('recruitment_candidates')
    .update({
      stage_id: params.stageId,
      stage_changed_at: timestamp,
      stage_changed_by: actor.fullName,
      updated_at: timestamp,
    })
    .eq('id', params.candidateId);

  if (updateError) throw updateError;

  const { error: historyError } = await supabase
    .from('recruitment_candidate_stage_history')
    .insert({
      candidate_id: params.candidateId,
      stage_id: params.stageId,
      changed_at: timestamp,
      changed_by: actor.fullName,
      changed_by_employee_id: actor.employeeId,
      note: params.note?.trim() || null,
    });

  if (historyError) {
    console.error('recruitment stage history insert failed:', historyError);
  }
}

export async function fetchCandidateStageHistory(candidateId: number): Promise<
  Array<{
    id: number;
    stage_id: number;
    changed_at: string;
    changed_by: string | null;
    note: string | null;
    stage?: RecruitmentStage | null;
  }>
> {
  const { data, error } = await supabase
    .from('recruitment_candidate_stage_history')
    .select(
      'id, stage_id, changed_at, changed_by, note, recruitment_stages(id, slug, name, colour, sort_order, is_terminal)',
    )
    .eq('candidate_id', candidateId)
    .order('changed_at', { ascending: false });

  if (error) throw error;

  return (data || []).map((row: any) => {
    const stageRaw = row.recruitment_stages;
    const stage = Array.isArray(stageRaw) ? stageRaw[0] ?? null : stageRaw ?? null;
    return {
      id: Number(row.id),
      stage_id: Number(row.stage_id),
      changed_at: row.changed_at,
      changed_by: row.changed_by ?? null,
      note: row.note ?? null,
      stage: stage as RecruitmentStage | null,
    };
  });
}

/** Days since stage_changed_at (UTC calendar days). */
export function daysInStage(stageChangedAt: string | null | undefined): number {
  if (!stageChangedAt) return 0;
  const then = new Date(stageChangedAt).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((Date.now() - then) / (24 * 60 * 60 * 1000)));
}

export const STUCK_STAGE_DAYS = 7;
