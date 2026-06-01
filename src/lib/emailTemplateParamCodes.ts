/**
 * Documented merge-field codes for misc_emailtemplate content (Admin → Email Templates).
 * Resolution logic lives in emailTemplateParams.ts (aligned with WhatsApp param_mapping types).
 */

export type EmailTemplateParamCode = {
  code: string;
  label: string;
  description: string;
};

export const EMAIL_TEMPLATE_PARAM_CODES: EmailTemplateParamCode[] = [
  { code: '{{name}}', label: 'Name', description: 'Contact or client name' },
  { code: '{{client_name}}', label: 'Client name', description: 'Same as name' },
  { code: '{{lead_number}}', label: 'Lead number', description: 'Lead / case number' },
  { code: '{{lead_type}}', label: 'Lead type', description: 'Legacy or new lead type' },
  { code: '{{date}}', label: 'Meeting date', description: 'Formatted meeting date' },
  { code: '{{time}}', label: 'Meeting time', description: 'Formatted meeting time' },
  {
    code: '{{location}}',
    label: 'Location (raw)',
    description: 'Raw meetings.meeting_location value as stored on the meeting row',
  },
  {
    code: '{{meeting_location}}',
    label: 'Meeting location (resolved)',
    description:
      'Resolved place for the meeting: physical address from tenants_meetinglocation (address_en for English templates when set, else address), custom_address, or location name (same as WhatsApp “Meeting Location (resolved)”)',
  },
  { code: '{{link}}', label: 'Meeting link', description: 'Teams / Zoom / catalog default link' },
  {
    code: '{{address}}',
    label: 'Manual address',
    description: 'Free-text meetings.manual_address on the meeting row',
  },
];
