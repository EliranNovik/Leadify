import { buildClientRoute } from './masterLeadApi';

/** Opens the client page on the Finances tab (`FinancesTab`). */
export const CLIENT_FINANCES_TAB = 'finances';

/** Opens the client page on the Interactions tab (`InteractionsTab`). */
export const CLIENT_INTERACTIONS_TAB = 'interactions';

export type ClientFinancesTabPathInput = {
  isLegacy?: boolean;
  leadId?: string | number | null;
  leadNumber?: string | null;
  manualId?: string | null;
};

function appendFinancesTab(path: string): string {
  if (!path || path === '/clients') return path;
  const qIndex = path.indexOf('?');
  const pathname = qIndex >= 0 ? path.slice(0, qIndex) : path;
  const params = new URLSearchParams(qIndex >= 0 ? path.slice(qIndex + 1) : '');
  params.set('tab', CLIENT_FINANCES_TAB);
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : `${pathname}?tab=${CLIENT_FINANCES_TAB}`;
}

/** Build `/clients/...?tab=finances` for internal or signed-in public proforma views. */
export function buildClientFinancesTabPath(input: ClientFinancesTabPathInput): string | null {
  const leadString = input.leadNumber?.toString().trim() || '';
  const manualString = input.manualId?.toString().trim() || '';
  const isLegacy = input.isLegacy ?? false;

  if (isLegacy) {
    const numericId =
      input.leadId != null ? String(input.leadId).replace(/^legacy_/, '').trim() : '';

    if (leadString.includes('/')) {
      const masterSegment = manualString || leadString.split('/')[0] || numericId;
      if (!masterSegment) return null;
      return appendFinancesTab(buildClientRoute(masterSegment, leadString));
    }

    const segment = manualString || numericId || leadString;
    if (!segment) return null;
    return appendFinancesTab(buildClientRoute(null, segment));
  }

  if (leadString) {
    return appendFinancesTab(buildClientRoute(manualString || null, leadString));
  }

  const idStr = input.leadId != null ? String(input.leadId).trim() : '';
  if (idStr) {
    return appendFinancesTab(buildClientRoute(null, idStr));
  }

  return null;
}

function appendInteractionsTab(path: string): string {
  if (!path || path === '/clients') return path;
  const qIndex = path.indexOf('?');
  const pathname = qIndex >= 0 ? path.slice(0, qIndex) : path;
  const params = new URLSearchParams(qIndex >= 0 ? path.slice(qIndex + 1) : '');
  params.set('tab', CLIENT_INTERACTIONS_TAB);
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : `${pathname}?tab=${CLIENT_INTERACTIONS_TAB}`;
}

/** Build `/clients/...?tab=interactions` for a lead. */
export function buildClientInteractionsTabPath(input: ClientFinancesTabPathInput): string | null {
  const financesPath = buildClientFinancesTabPath(input);
  if (!financesPath) return null;
  const qIndex = financesPath.indexOf('?');
  const pathname = qIndex >= 0 ? financesPath.slice(0, qIndex) : financesPath;
  const params = new URLSearchParams(qIndex >= 0 ? financesPath.slice(qIndex + 1) : '');
  params.set('tab', CLIENT_INTERACTIONS_TAB);
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : appendInteractionsTab(pathname);
}
