import type { WhatsAppTemplate } from '../whatsappTemplates';
import { interactionsDevLog, interactionsDevWarn } from './devLog';

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
    interactionsDevLog('⚠️ Templates not loaded yet, skipping template processing for message:', msg.id);
    return processedMessage;
  }

  if (msg.template_id) {
    const templateId = Number(msg.template_id);
    const template = whatsAppTemplates.find((t) => Number(t.id) === templateId);
    if (template) {
      interactionsDevLog(
        `✅ Matched template by ID ${templateId}: ${template.title} (${template.language || 'N/A'})`
      );
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
      interactionsDevLog(`🔍 Looking for template by name: "${templateTitle}"`);

      const template = whatsAppTemplates.find(
        (t) =>
          t.title.toLowerCase() === templateTitle.toLowerCase() ||
          (t.name360 && t.name360.toLowerCase() === templateTitle.toLowerCase())
      );

      if (template) {
        interactionsDevLog(
          `✅ Matched template by name "${templateTitle}": ${template.title} (${template.language || 'N/A'})`
        );
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
