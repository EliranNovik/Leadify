import type { WhatsAppTemplate } from '../whatsappTemplates';
import { interactionsDevWarn } from './devLog';

type TemplateMsg = {
  id?: unknown;
  message?: string;
  direction?: string;
  template_id?: unknown;
};

/**
 * Resolve stored WhatsApp row text to user-facing template body (used in timeline + cache refresh).
 */
export function processWhatsAppTemplateMessage(
  msg: TemplateMsg,
  whatsAppTemplates: WhatsAppTemplate[]
): string {
  let processedMessage = msg.message != null && msg.message !== '' ? String(msg.message) : '';

  if (whatsAppTemplates.length === 0) {
    return processedMessage;
  }

  if (msg.template_id) {
    const templateId = Number(msg.template_id);
    const template = whatsAppTemplates.find((t) => Number(t.id) === templateId);
    if (template) {
      if (template.params === '0' && template.content) {
        processedMessage = template.content;
      } else if (template.params === '1') {
        const paramMatch = msg.message?.match(/\[Template:.*?\]\s*(.+)/);
        if (paramMatch && paramMatch[1].trim()) {
          processedMessage = paramMatch[1].trim();
        } else {
          processedMessage = template.content || processedMessage;
        }
      }
      return processedMessage;
    }
    interactionsDevWarn(
      `⚠️ Template with ID ${templateId} not found. Available IDs:`,
      whatsAppTemplates.map((t) => t.id)
    );
  }

  if (msg.direction === 'out' && msg.message) {
    const isAlreadyProperlyFormatted = whatsAppTemplates.some(
      (template) => template.content && msg.message === template.content
    );

    if (isAlreadyProperlyFormatted) {
      return processedMessage;
    }

    const templateMatch =
      msg.message.match(/\[Template:\s*([^\]]+)\]/) ||
      msg.message.match(/Template:\s*(.+)/) ||
      msg.message.match(/TEMPLATE_MARKER:(.+)/);

    if (templateMatch) {
      const templateTitle = templateMatch[1].trim().replace(/\]$/, '');

      const template = whatsAppTemplates.find(
        (t) =>
          t.title.toLowerCase() === templateTitle.toLowerCase() ||
          (t.name360 && t.name360.toLowerCase() === templateTitle.toLowerCase())
      );

      if (template) {
        if (template.params === '0' && template.content) {
          processedMessage = template.content;
        } else if (template.params === '1') {
          const paramMatch = msg.message.match(/\[Template:.*?\]\s*(.+)/);
          if (paramMatch && paramMatch[1].trim()) {
            processedMessage = paramMatch[1].trim();
          } else {
            processedMessage = template.content || processedMessage;
          }
        }
      } else {
        interactionsDevWarn(
          `⚠️ Template with name "${templateTitle}" not found. Available names:`,
          whatsAppTemplates.map((t) => t.title || t.name360)
        );
      }
    }
  }

  return processedMessage;
}

function isWhatsAppTimelineRow(row: Record<string, any>): boolean {
  const kind = String(row.kind || '');
  return kind === 'whatsapp' || kind === 'whatsapp_manual';
}

function whatsappTimelineSoftKey(row: Record<string, any>): string[] {
  const direction = String(row.direction || '');
  const content = String(row.content || row.message || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  const keys: string[] = [];
  const ts = Date.parse(String(row.raw_date || row.sent_at || ''));
  if (Number.isFinite(ts)) {
    keys.push(`${direction}|m:${Math.floor(ts / 60000)}|${content}`);
    const dateObj = new Date(ts);
    const displayDate = `${dateObj.getDate().toString().padStart(2, '0')} ${dateObj.toLocaleString('en', { month: 'short' })} ${dateObj.getFullYear()}`;
    const displayTime = dateObj.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    keys.push(`${direction}|${displayDate}|${displayTime}|${content}`);
  }
  const date = String(row.date || '').trim();
  const time = String(row.time || '').trim();
  if (date && time && content) keys.push(`${direction}|${date}|${time}|${content}`);
  return keys;
}

function whatsappTimelineKeys(row: Record<string, any>): string[] {
  const keys: string[] = [];
  const wamid = String(row.whatsapp_message_id || '').trim();
  if (wamid) keys.push(`w:${wamid}`);
  for (const soft of whatsappTimelineSoftKey(row)) keys.push(`s:${soft}`);
  return keys;
}

function whatsappTimelineRichness(row: Record<string, any>): number {
  return (String(row.whatsapp_message_id || '').trim() ? 2 : 0) + (row.editable === true ? 0 : 1);
}

/** One inbound event can exist on several leads; a timeline must show it once. */
export function dedupeWhatsAppTimelineRows<T extends Record<string, any>>(rows: T[]): T[] {
  if (!Array.isArray(rows) || rows.length <= 1) return rows || [];

  const keepByKey = new Map<string, number>();
  rows.forEach((row, index) => {
    if (!isWhatsAppTimelineRow(row)) return;
    const keys = whatsappTimelineKeys(row);
    const existing = keys.map((key) => keepByKey.get(key)).find((idx) => idx != null);
    if (existing == null) {
      keys.forEach((key) => keepByKey.set(key, index));
      return;
    }
    if (whatsappTimelineRichness(row) > whatsappTimelineRichness(rows[existing])) {
      whatsappTimelineKeys(rows[existing]).forEach((key) => keepByKey.delete(key));
      keys.forEach((key) => keepByKey.set(key, index));
      return;
    }
    keys.forEach((key) => {
      if (!keepByKey.has(key)) keepByKey.set(key, existing);
    });
  });

  const keep = new Set(keepByKey.values());
  return rows.filter((row, index) => !isWhatsAppTimelineRow(row) || keep.has(index));
}
