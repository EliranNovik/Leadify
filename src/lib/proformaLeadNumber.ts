/** Display lead number for proforma UI (new leads table). */
export function formatNewLeadDisplayNumber(
  lead: {
    lead_number?: string | null;
    manual_id?: string | null;
    master_id?: string | null;
    stage?: string | number | null;
  } | null | undefined,
  options?: { subLeadsCount?: number; isMasterLead?: boolean },
): string {
  if (!lead) return '';

  let displayNumber = lead.lead_number || lead.manual_id || '';
  if (!displayNumber) return '';

  const displayStr = displayNumber.toString();
  const hasExistingSuffix = displayStr.includes('/');
  let baseNumber = hasExistingSuffix ? displayStr.split('/')[0] : displayStr;
  const existingSuffix = hasExistingSuffix ? displayStr.split('/').slice(1).join('/') : null;

  const isSuccessStage = lead.stage === '100' || lead.stage === 100;
  if (isSuccessStage && baseNumber && !baseNumber.toString().startsWith('C')) {
    baseNumber = baseNumber.toString().replace(/^L/, 'C');
  }

  const hasNoMasterId = !lead.master_id || String(lead.master_id).trim() === '';
  const hasSubLeads = (options?.subLeadsCount || 0) > 0;
  const isMasterWithSubLeads = hasNoMasterId && (options?.isMasterLead || hasSubLeads);

  if (isMasterWithSubLeads && !hasExistingSuffix) {
    return `${baseNumber}/1`;
  }
  if (hasExistingSuffix) {
    return `${baseNumber}/${existingSuffix}`;
  }
  return baseNumber;
}
