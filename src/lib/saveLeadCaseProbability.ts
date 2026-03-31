import { supabase } from './supabase';
import {
  caseProbabilityFromFactors,
  clampProbabilityPart,
  type ProbabilitySlidersValues,
} from '../components/client-tabs/ProbabilitySlidersModal';

/** Persist legal / seriousness / financial factors and derived case probability for a lead row. */
export async function saveLeadCaseProbability(
  client: { id: string | number; lead_type?: string | null },
  values: ProbabilitySlidersValues
): Promise<void> {
  const L = clampProbabilityPart(values.legal);
  const S = clampProbabilityPart(values.seriousness);
  const F = clampProbabilityPart(values.financial);
  const prob = caseProbabilityFromFactors(L, S, F);
  const isLegacy =
    client.lead_type === 'legacy' || client.id?.toString().startsWith('legacy_');
  const tableName = isLegacy ? 'leads_lead' : 'leads';
  const clientId = isLegacy ? client.id.toString().replace(/^legacy_/, '') : client.id;

  const updatePayload = isLegacy
    ? {
        legal_potential: String(L),
        seriousness: S,
        financial_ability: F,
        probability: prob,
      }
    : {
        legal_potential: L,
        seriousness: S,
        financial_ability: F,
        probability: prob,
      };

  const { error } = await supabase.from(tableName).update(updatePayload).eq('id', clientId);
  if (error) throw error;
}
