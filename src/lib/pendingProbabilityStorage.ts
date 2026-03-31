import {
  clampProbabilityPart,
  type ProbabilitySlidersValues,
} from '../components/client-tabs/ProbabilitySlidersModal';

const PENDING_PROB_STORAGE_PREFIX = 'infoTab_pendingProb_v1_';

export function pendingProbStorageKey(client: {
  id: string | number;
  lead_type?: string | null;
}): string {
  const isLeg =
    client.lead_type === 'legacy' || client.id?.toString().startsWith('legacy_');
  const lt = isLeg ? 'legacy' : 'new';
  return `${PENDING_PROB_STORAGE_PREFIX}${lt}_${String(client.id)}`;
}

export function readPendingProbSession(client: {
  id: string | number;
  lead_type?: string | null;
}): ProbabilitySlidersValues | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(pendingProbStorageKey(client));
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<ProbabilitySlidersValues>;
    if (
      typeof p.legal !== 'number' ||
      typeof p.seriousness !== 'number' ||
      typeof p.financial !== 'number'
    ) {
      return null;
    }
    return {
      legal: clampProbabilityPart(p.legal),
      seriousness: clampProbabilityPart(p.seriousness),
      financial: clampProbabilityPart(p.financial),
    };
  } catch {
    return null;
  }
}

export function writePendingProbSession(
  client: { id: string | number; lead_type?: string | null },
  values: ProbabilitySlidersValues
): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(
      pendingProbStorageKey(client),
      JSON.stringify({
        legal: clampProbabilityPart(values.legal),
        seriousness: clampProbabilityPart(values.seriousness),
        financial: clampProbabilityPart(values.financial),
      })
    );
  } catch {
    /* ignore quota */
  }
}

export function clearPendingProbSession(client: {
  id: string | number;
  lead_type?: string | null;
}): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(pendingProbStorageKey(client));
  } catch {
    /* ignore */
  }
}
