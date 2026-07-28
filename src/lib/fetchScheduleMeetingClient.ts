import { supabase } from './supabase';
import { safeDecodeRouteParam } from './meetingScheduleNavigation';
import type { Client } from '../types/client';

function asLegacyClient(row: Record<string, unknown>, leadNumberOverride?: string): Client {
  return {
    ...row,
    id: `legacy_${row.id}`,
    lead_number: leadNumberOverride || String(row.manual_id || row.id),
    lead_type: 'legacy',
  } as Client;
}

function asNewClient(row: Record<string, unknown>): Client {
  return { ...row, lead_type: 'new' } as Client;
}

/** Parse `12345/2`, `L12345/2`, or `C12345/2` into master digits + suffix. */
function parseSubleadKey(
  decoded: string,
): { masterDigits: string; suffix: number; raw: string } | null {
  const m = String(decoded || '')
    .trim()
    .match(/^(?:[LClc])?(\d+)\/(\d+)$/);
  if (!m) return null;
  const suffix = Number.parseInt(m[2], 10);
  if (!Number.isFinite(suffix) || suffix < 2) return null;
  return { masterDigits: m[1], suffix, raw: `${m[1]}/${m[2]}` };
}

async function fetchNewLeadByLeadNumber(leadNumber: string): Promise<Client | null> {
  const variants = Array.from(
    new Set(
      [
        leadNumber,
        leadNumber.startsWith('L') || leadNumber.startsWith('C')
          ? leadNumber
          : `L${leadNumber}`,
        leadNumber.replace(/^[LClc]/, ''),
      ].filter(Boolean),
    ),
  );

  for (const variant of variants) {
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .eq('lead_number', variant)
      .maybeSingle();
    if (!error && data) return asNewClient(data);
  }
  return null;
}

/**
 * Resolve the exact lead for schedule/reschedule pages.
 * Must return the sublead row (own stage) — never the master with an overridden lead_number.
 */
export async function fetchClientForMeetingSchedule(
  leadNumber: string,
): Promise<Client | null> {
  const decoded = safeDecodeRouteParam(leadNumber);
  if (!decoded) return null;

  // 1) New leads by exact lead_number (including L210764/3 subleads).
  const newLead = await fetchNewLeadByLeadNumber(decoded);
  if (newLead) return newLead;

  // 2) Legacy sublead by master_id + ordered index (suffix N → index N-2).
  const sublead = parseSubleadKey(decoded);
  if (sublead) {
    const masterId = Number.parseInt(sublead.masterDigits, 10);
    if (Number.isFinite(masterId)) {
      const { data: siblings, error } = await supabase
        .from('leads_lead')
        .select('*')
        .eq('master_id', masterId)
        .not('master_id', 'is', null)
        .order('id', { ascending: true });
      if (!error && siblings?.length) {
        const index = sublead.suffix - 2;
        const row = siblings[index];
        if (row) {
          return asLegacyClient(row as Record<string, unknown>, `${masterId}/${sublead.suffix}`);
        }
      }
    }

    // Also try new-lead style lead_number variants for digit/suffix keys.
    const newSub = await fetchNewLeadByLeadNumber(
      `L${sublead.masterDigits}/${sublead.suffix}`,
    );
    if (newSub) return newSub;
    const newSubBare = await fetchNewLeadByLeadNumber(
      `${sublead.masterDigits}/${sublead.suffix}`,
    );
    if (newSubBare) return newSubBare;
  }

  // 3) Legacy by manual_id (master or non-slash keys).
  const { data: legacyByManual } = await supabase
    .from('leads_lead')
    .select('*')
    .eq('manual_id', decoded)
    .maybeSingle();
  if (legacyByManual) {
    return asLegacyClient(legacyByManual as Record<string, unknown>);
  }

  // Digits-only: try manual_id / id without treating as sublead parent fallback.
  const digitsOnly = decoded.replace(/^[LClc]/, '');
  if (/^\d+$/.test(digitsOnly) && digitsOnly !== decoded) {
    const { data: legacyByManualDigits } = await supabase
      .from('leads_lead')
      .select('*')
      .eq('manual_id', digitsOnly)
      .maybeSingle();
    if (legacyByManualDigits) {
      return asLegacyClient(legacyByManualDigits as Record<string, unknown>);
    }
  }

  const asId = Number.parseInt(digitsOnly, 10);
  if (Number.isFinite(asId) && String(asId) === digitsOnly) {
    const { data: legacyById } = await supabase
      .from('leads_lead')
      .select('*')
      .eq('id', asId)
      .maybeSingle();
    if (legacyById) {
      return asLegacyClient(legacyById as Record<string, unknown>);
    }
  }

  return null;
}
