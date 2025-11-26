/**
 * Helper functions for displaying WhatsApp template messages with filled parameters
 */

import type { WhatsAppTemplate } from './whatsappTemplates';

/**
 * Replace template placeholders ({{1}}, {{2}}, etc.) with actual parameter values
 */
export function fillTemplateContent(
  templateContent: string,
  parameters: Array<{ type: string; text: string }>
): string {
  if (!templateContent) return '';
  
  let filledContent = templateContent;
  
  // Replace each placeholder with its corresponding parameter
  parameters.forEach((param, index) => {
    const placeholder = `{{${index + 1}}}`;
    filledContent = filledContent.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), param.text || '');
  });
  
  return filledContent;
}

/**
 * Get the display text for a template message
 * If template_id is provided, fetch the template and fill it with stored parameters
 */
export function getTemplateDisplayText(
  templateId: number | null,
  templateContent: string | null,
  storedMessage: string,
  templates: WhatsAppTemplate[]
): string {
  // If we have a template ID and the stored message is just a marker, try to get the filled content
  if (templateId && storedMessage && (storedMessage.includes('TEMPLATE_MARKER:') || storedMessage.includes('[Template:'))) {
    const template = templates.find(t => Number(t.id) === Number(templateId));
    if (template && template.content) {
      // If we have template content, use it
      // Note: We can't fill params here since we don't have the original params that were sent
      // This should ideally be stored in the message field when sent
      return template.content;
    }
  }
  
  // If the message looks like it already has filled content, return it
  if (storedMessage && !storedMessage.includes('TEMPLATE_MARKER:') && !storedMessage.includes('[Template:')) {
    return storedMessage;
  }
  
  // Fallback: return the stored message as-is
  return storedMessage || '';
}

