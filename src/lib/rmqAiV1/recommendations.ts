import { supabase } from '../supabase';
import { getCurrentAiTrace } from './trace';
import type { RecommendationOutcome } from './types';

export type AiRecommendation = {
  recommendationId: string;
  actionType: string;
  reason: string;
  executable: boolean;
  conversationId?: string | null;
};

export async function persistRecommendation(row: AiRecommendation) {
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return;
  const trace = getCurrentAiTrace();
  await supabase.from('ai_recommendations').upsert(
    {
      id: row.recommendationId,
      user_id: user.id,
      conversation_id: row.conversationId || null,
      ai_trace_id: trace?.aiTraceId || null,
      action_type: row.actionType,
      reason: row.reason,
      executable: row.executable,
      outcome: null,
    },
    { onConflict: 'id' },
  );
}

export async function recordRecommendationOutcome(
  recommendationId: string,
  outcome: RecommendationOutcome,
) {
  await supabase
    .from('ai_recommendations')
    .update({ outcome, updated_at: new Date().toISOString() })
    .eq('id', recommendationId);
}
