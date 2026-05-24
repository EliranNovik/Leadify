/** Shared cron secret check for Google Sheets conversion edge functions. */
export function googleSheetsCronAuthorized(req: Request, perFunctionSecretEnv: string): boolean {
  const header = req.headers.get('x-cron-secret') ?? '';
  if (!header) return false;

  const candidates = [
    Deno.env.get('GOOGLE_SHEETS_SYNC_CRON_SECRET'),
    Deno.env.get(perFunctionSecretEnv),
  ].filter((s): s is string => Boolean(s && s.trim()));

  return candidates.some((secret) => secret === header);
}
