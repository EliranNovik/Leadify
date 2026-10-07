import { formatScanDate, scanDisplayFilename } from './smartScanFormat';
import type { SmartScanItem } from './smartScanTypes';

/** The subject and body prefilled into the Outlook draft when a scan is shared by email. */
export type ScanShareMessage = { subject: string; bodyHtml: string };

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function scanDocumentLabel(item: SmartScanItem): string {
  return item.documentType || item.suggestedDocumentType || item.title || 'Document';
}

export function scanShareFilename(item: SmartScanItem): string {
  return scanDisplayFilename(item) || 'scan.pdf';
}

/** Who the document is about: the assigned lead, else whoever the AI read off the page. */
function scanSubjectParty(item: SmartScanItem): string {
  if (item.lead?.leadNumber) {
    return [item.lead.leadNumber, item.lead.name].filter(Boolean).join(' ');
  }
  return item.detectedPersonName || '';
}

export function buildScanShareMessage(item: SmartScanItem, senderName?: string): ScanShareMessage {
  const label = scanDocumentLabel(item);
  const party = scanSubjectParty(item);
  const subject = party ? `${label} — ${party}` : `${label} — ${scanShareFilename(item)}`;

  const facts: Array<[string, string]> = [['Document', scanShareFilename(item)]];
  if (item.lead?.leadNumber) {
    facts.push(['Lead', [item.lead.leadNumber, item.lead.name].filter(Boolean).join(' — ')]);
  }
  if (item.detectedPersonName) facts.push(['Name on document', item.detectedPersonName]);
  if (item.detectedCountry) facts.push(['Country', item.detectedCountry]);
  if (item.documentDate) facts.push(['Document date', formatScanDate(item.documentDate)]);
  if (item.expiryDate) facts.push(['Expiry', formatScanDate(item.expiryDate)]);

  const rows = facts
    .map(
      ([name, value]) =>
        `<tr><td style="padding:2px 12px 2px 0;color:#6b7280;">${escapeHtml(name)}</td>` +
        `<td style="padding:2px 0;color:#111827;">${escapeHtml(value)}</td></tr>`,
    )
    .join('');

  const intro = party
    ? `Please find attached the ${escapeHtml(label.toLowerCase())} for ${escapeHtml(party)}.`
    : `Please find attached the ${escapeHtml(label.toLowerCase())}.`;

  const signOff = senderName ? `Best regards,<br />${escapeHtml(senderName)}` : 'Best regards,';

  const bodyHtml =
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111827;">` +
    `<p>Hello,</p>` +
    `<p>${intro}</p>` +
    `<table style="border-collapse:collapse;font-size:13px;margin:12px 0;">${rows}</table>` +
    (item.summary ? `<p style="color:#374151;">${escapeHtml(item.summary)}</p>` : '') +
    `<p>${signOff}</p>` +
    `</div>`;

  return { subject, bodyHtml };
}
