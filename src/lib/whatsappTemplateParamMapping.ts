/**
 * Template Parameter Mapping
 * Defines which parameters each template needs and what they should be filled with
 * 
 * Format: {
 *   template_id: {
 *     params: [
 *       { type: 'name' | 'phone_number' | 'email' | 'meeting_datetime' | 'custom', value?: string },
 *       ...
 *     ]
 *   }
 * }
 * 
 * Note: The 'name' type automatically resolves to contact name or client name
 * based on the chat context (frontend handles this automatically).
 */

export interface TemplateParamDefinition {
  type:
    | 'name'
    | 'contact_name'
    | 'client_name'
    | 'meeting_datetime'
    | 'meeting_date'
    | 'meeting_time'
    | 'phone_number'
    | 'mobile_number'
    | 'email'
    | 'meeting_location'
    | 'location'
    | 'manual_address'
    | 'meeting_link'
    | 'invoice_link'
    | 'payment_link'
    | 'lead_number'
    | 'custom';
  value?: string; // For custom params, specify the value
  // Note: 'contact_name' and 'client_name' are deprecated but supported for backward compatibility.
  // They both resolve to the same 'name' behavior - the frontend automatically determines which to use.
}

export interface TemplateParamMapping {
  [templateId: number]: {
    params: TemplateParamDefinition[];
  };
}

/**
 * Template parameter mappings by template name
 * Maps template names to their parameter requirements
 */
export const TEMPLATE_PARAM_MAPPING: Record<string, TemplateParamDefinition[]> = {
  'missed_appointment': [
    { type: 'name' }, // Param 1: Name (automatically resolves to contact or client name)
    { type: 'meeting_datetime' } // Param 2: Meeting date and time
  ],
  'appointment_reminder': [
    { type: 'name' },
    { type: 'meeting_datetime' }
  ],
  'welcome_message': [
    { type: 'name' }
  ],
  // Add more templates as needed
};

/**
 * Get parameter definitions for a template by its database ID
 * Priority: Database param_mapping > Static TEMPLATE_PARAM_MAPPING > Empty array
 */
export async function getTemplateParamDefinitions(
  templateId: number,
  templateName: string
): Promise<TemplateParamDefinition[]> {
  // PRIORITY 1: Check database param_mapping column
  try {
    const { supabase } = await import('./supabase');
    const { data: template, error } = await supabase
      .from('whatsapp_templates_v2')
      .select('param_mapping')
      .eq('id', templateId)
      .single();
    
    if (!error && template?.param_mapping) {
      // param_mapping is stored as JSONB, should be an array
      const mapping = template.param_mapping;
      if (Array.isArray(mapping) && mapping.length > 0) {
        console.log(`✅ Using database param_mapping for template ${templateId}:`, mapping);
        return mapping as TemplateParamDefinition[];
      }
    }
  } catch (error) {
    console.warn('Error fetching param_mapping from database:', error);
  }
  
  // PRIORITY 2: Check static mapping by template name
  if (TEMPLATE_PARAM_MAPPING[templateName]) {
    console.log(`✅ Using static param mapping for template ${templateName}`);
    return TEMPLATE_PARAM_MAPPING[templateName];
  }
  
  // PRIORITY 3: Return empty array (will use generic parameter generation)
  console.log(`⚠️ No param mapping found for template ${templateId} (${templateName}), using generic generation`);
  return [];
}

/**
 * Generate parameters based on template definitions
 */
/** Optional proforma invoice context (Send on view proforma). */
export type ProformaWhatsAppParamContext = {
  invoiceLink?: string;
  leadNumber?: string;
};

const isStaffMeetingClient = (client: any): boolean =>
  client?.isStaffMeeting === true || client?.id === 'staff-meeting';

export async function generateParamsFromDefinitions(
  definitions: TemplateParamDefinition[],
  client: any,
  contactId?: number | null,
  proformaContext?: ProformaWhatsAppParamContext | null,
): Promise<Array<{ type: string; text: string }>> {
  const {
    getClientOrContactName,
    getMeetingDateTime,
    getPhoneNumber,
    getMobileNumber,
    getEmailAddress,
    getMeetingLocation,
    getMeetingLocationRaw,
    getMeetingManualAddress,
    getMeetingLink,
    getPaymentLinkForClient,
    sanitizeWhatsAppTemplateVariableText,
  } = await import('./whatsappTemplateParams');

  const staffMeeting = isStaffMeetingClient(client);

  const ctx: ProformaWhatsAppParamContext = {
    invoiceLink:
      proformaContext?.invoiceLink ??
      client?.proformaPublicUrl ??
      client?.invoiceLink ??
      '',
    paymentLink: proformaContext?.paymentLink ?? client?.paymentLinkUrl ?? '',
    leadNumber:
      proformaContext?.leadNumber ??
      client?.proformaLeadNumber ??
      client?.lead_number ??
      '',
    paymentPlanId:
      proformaContext?.paymentPlanId ?? client?.paymentPlanId ?? null,
  };
  
  const parameters: Array<{ type: string; text: string }> = [];
  
  for (const def of definitions) {
    let value = '';
    
    switch (def.type) {
      case 'name':
      // Backward compatibility: support old 'contact_name' and 'client_name' types
      case 'contact_name':
      case 'client_name':
        if (staffMeeting) {
          value = sanitizeWhatsAppTemplateVariableText(
            client?.templateRecipientName || client?.name || 'Participant',
          );
        } else {
          value = await getClientOrContactName(client, contactId);
        }
        break;
      case 'phone_number':
        value = await getPhoneNumber(client, contactId);
        break;
      case 'mobile_number':
        value = await getMobileNumber(client, contactId);
        break;
      case 'email':
        value = await getEmailAddress(client, contactId);
        break;
      case 'meeting_datetime': {
        if (staffMeeting && client?.meeting_datetime) {
          value = sanitizeWhatsAppTemplateVariableText(String(client.meeting_datetime));
        } else {
          const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
          const clientIdForMeeting = client?.isContact && client?.lead_id ? client.lead_id : client?.id;
          const meetingDateTime = await getMeetingDateTime(clientIdForMeeting, isLegacyLead);
          value = meetingDateTime || 'your scheduled appointment';
        }
        break;
      }
      case 'meeting_date': {
        if (staffMeeting && client?.meeting_date) {
          value = sanitizeWhatsAppTemplateVariableText(String(client.meeting_date));
        } else {
          const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
          const clientIdForMeeting = client?.isContact && client?.lead_id ? client.lead_id : client?.id;
          const dateTime = await getMeetingDateTime(clientIdForMeeting, isLegacyLead);
          if (dateTime) {
            value = dateTime.split(' at ')[0] || dateTime;
          } else if (client?.meeting_date) {
            value = sanitizeWhatsAppTemplateVariableText(String(client.meeting_date));
          } else {
            value = 'your scheduled appointment';
          }
        }
        break;
      }
      case 'meeting_time': {
        if (staffMeeting && client?.meeting_time) {
          value = sanitizeWhatsAppTemplateVariableText(String(client.meeting_time));
        } else {
          const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
          const clientIdForMeeting = client?.isContact && client?.lead_id ? client.lead_id : client?.id;
          const { getMeetingTime } = await import('./whatsappTemplateParams');
          const meetingTime = clientIdForMeeting ? await getMeetingTime(clientIdForMeeting, isLegacyLead) : '';
          value = meetingTime || client?.meeting_time || 'your scheduled appointment';
        }
        break;
      }
      case 'meeting_location': {
        if (staffMeeting && client?.meeting_location) {
          value = sanitizeWhatsAppTemplateVariableText(String(client.meeting_location));
        } else {
          const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
          const clientIdForMeeting = client?.isContact && client?.lead_id ? client.lead_id : client?.id;
          const preferEnglish =
            client?.preferEnglishMeetingLocation === true ||
            String(client?.templateLanguage || '')
              .toLowerCase()
              .split(/[-_]/)[0] === 'en';
          value = clientIdForMeeting
            ? await getMeetingLocation(clientIdForMeeting, isLegacyLead, client?.currentMeetingId ?? null, {
                preferEnglish,
              })
            : '';
          if ((!value || value === '-') && client?.meeting_location) {
            value = sanitizeWhatsAppTemplateVariableText(String(client.meeting_location));
          }
        }
        break;
      }
      case 'location': {
        const rawInline =
          client?.meeting_location_raw != null
            ? String(client.meeting_location_raw).trim()
            : '';
        if (rawInline) {
          value = sanitizeWhatsAppTemplateVariableText(rawInline);
        } else if (staffMeeting && client?.meeting_location) {
          value = sanitizeWhatsAppTemplateVariableText(String(client.meeting_location));
        } else {
          const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
          const clientIdForMeeting = client?.isContact && client?.lead_id ? client.lead_id : client?.id;
          const meetingId = client?.currentMeetingId ?? null;
          value = clientIdForMeeting
            ? await getMeetingLocationRaw(clientIdForMeeting, isLegacyLead, meetingId)
            : '';
        }
        break;
      }
      case 'manual_address': {
        const manualInline =
          client?.manual_address != null ? String(client.manual_address).trim() : '';
        if (manualInline) {
          value = sanitizeWhatsAppTemplateVariableText(manualInline);
        } else {
          const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
          const clientIdForMeeting = client?.isContact && client?.lead_id ? client.lead_id : client?.id;
          const meetingId = client?.currentMeetingId ?? null;
          value = clientIdForMeeting
            ? await getMeetingManualAddress(clientIdForMeeting, isLegacyLead, meetingId)
            : '';
        }
        break;
      }
      case 'meeting_link': {
        if (staffMeeting) {
          value = client?.meeting_link ? sanitizeWhatsAppTemplateVariableText(String(client.meeting_link)) : '';
        } else {
          const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
          const clientIdForMeeting = client?.isContact && client?.lead_id ? client.lead_id : client?.id;
          value = await getMeetingLink(clientIdForMeeting, isLegacyLead);
        }
        break;
      }
      case 'invoice_link':
        value = sanitizeWhatsAppTemplateVariableText(ctx.invoiceLink || '');
        break;
      case 'payment_link':
        value = await getPaymentLinkForClient(
          client,
          ctx.paymentPlanId,
          ctx.paymentLink || undefined,
        );
        break;
      case 'lead_number':
        value = sanitizeWhatsAppTemplateVariableText(ctx.leadNumber || '');
        break;
      case 'custom':
        value = def.value || '';
        break;
      default:
        value = '';
    }
    
    parameters.push({
      type: 'text',
      text: value
    });
  }
  
  return parameters;
}

