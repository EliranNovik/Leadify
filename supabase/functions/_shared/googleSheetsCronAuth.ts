const ORCHESTRATOR_SECRET_ENVS = [
  'GOOGLE_SHEETS_SYNC_CRON_SECRET',
  'BAD_LEADS_SYNC_CRON_SECRET',
  'QLEADS_SYNC_CRON_SECRET',
  'HQLEADS_SYNC_CRON_SECRET',
] as const;

function trimSecret(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Shared cron secret check for Google Sheets conversion edge functions. */
export function googleSheetsCronAuthorized(req: Request, perFunctionSecretEnv: string): boolean {
  const header = trimSecret(req.headers.get('x-cron-secret') ?? undefined);
  if (!header) return false;

  const candidates = new Set<string>();
  for (const envKey of [ORCHESTRATOR_SECRET_ENVS[0], perFunctionSecretEnv]) {
    const secret = trimSecret(Deno.env.get(envKey));
    if (secret) candidates.add(secret);
  }

  return candidates.has(header);
}

/** Secret forwarded to child sync functions (prefers request header). */
export function resolveGoogleSheetsCronSecret(req: Request): string | null {
  const header = trimSecret(req.headers.get('x-cron-secret') ?? undefined);
  if (header) return header;

  for (const envKey of ORCHESTRATOR_SECRET_ENVS) {
    const secret = trimSecret(Deno.env.get(envKey));
    if (secret) return secret;
  }
  return null;
}
