const supabase = require('../config/supabase');

/** Matches reminder_of_a_meeting Meta template body placeholders. */
const DEFAULT_REMINDER_PARAM_MAPPING = [
  { type: 'meeting_date' },
  { type: 'meeting_time' },
  { type: 'location' },
  { type: 'meeting_link' },
  { type: 'mobile_number' },
  { type: 'phone_number' },
  { type: 'email' },
];

function sanitizeWhatsAppTemplateVariableText(text) {
  if (text == null) return '';
  let s = String(text);
  s = s.replace(/\\r\\n/g, ' ').replace(/\\n/g, ' ').replace(/\\r/g, ' ');
  s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  s = s
    .split(/\n+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function fillWhatsAppTemplateContent(content, templateParameters) {
  let filled = content || '';
  templateParameters.forEach((param, index) => {
    const text = param?.text != null ? String(param.text) : '';
    if (text) {
      filled = filled.replace(new RegExp(`\\{\\{${index + 1}\\}\\}`, 'g'), text);
    }
  });
  return filled;
}

function resolveDefaultStaffEmployeeId(hostEmployeeId) {
  const fromSettings = Number(hostEmployeeId);
  if (Number.isFinite(fromSettings) && fromSettings > 0) return fromSettings;

  const fromEnv = Number(process.env.BOOKING_WHATSAPP_EMPLOYEE_ID);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;

  return 1;
}

async function fetchStaffContactForBooking(hostEmployeeId) {
  const employeeId = resolveDefaultStaffEmployeeId(hostEmployeeId);

  const { data: emp, error: empError } = await supabase
    .from('tenants_employee')
    .select('id, display_name, mobile, employee_mobile, phone, phone_ext')
    .eq('id', employeeId)
    .maybeSingle();

  if (empError) {
    console.warn('[BookingWhatsApp] employee lookup failed:', empError.message);
  }

  let email = '';
  const { data: userRow } = await supabase
    .from('users')
    .select('email')
    .eq('employee_id', employeeId)
    .maybeSingle();
  if (userRow?.email) {
    email = String(userRow.email).trim();
  }

  const mobile = String(emp?.mobile || emp?.employee_mobile || '').trim();
  const phone = String(emp?.phone || '').trim();

  return {
    employeeId,
    displayName: emp?.display_name || '',
    mobile,
    phone,
    email,
  };
}

async function resolveBookingLocationDisplay(locationName, preferEnglish = false) {
  const raw = String(locationName || '').trim();
  if (!raw) return '';
  if (raw === 'Teams') return 'Teams';

  const { data: rows } = await supabase
    .from('tenants_meetinglocation')
    .select('name, address, address_en, is_physical_location')
    .ilike('name', raw)
    .limit(5);

  const match =
    rows?.find((r) => String(r.name || '').trim().toLowerCase() === raw.toLowerCase()) ||
    rows?.[0];

  if (!match) return raw;

  const isPhysical =
    match.is_physical_location === true ||
    match.is_physical_location === 1 ||
    String(match.is_physical_location).toLowerCase() === 'true';

  if (isPhysical) {
    const addressEn = match.address_en != null ? String(match.address_en).trim() : '';
    const addressHe = match.address != null ? String(match.address).trim() : '';
    const address = preferEnglish && addressEn ? addressEn : addressHe || addressEn;
    if (address) return sanitizeWhatsAppTemplateVariableText(address);
  }

  return match.name ? String(match.name).trim() : raw;
}

function isTeamsBookingLocation(locationName) {
  return String(locationName || '').trim() === 'Teams';
}

async function getTemplateParamDefinitions(template) {
  const paramCount = Number(template?.params) || 0;

  if (template?.name === 'reminder_of_a_meeting') {
    return DEFAULT_REMINDER_PARAM_MAPPING.slice(
      0,
      paramCount > 0 ? paramCount : DEFAULT_REMINDER_PARAM_MAPPING.length,
    );
  }

  if (template?.param_mapping && Array.isArray(template.param_mapping) && template.param_mapping.length) {
    return template.param_mapping;
  }

  if (template?.name === 'reminder_of_external_meeting') {
    return DEFAULT_REMINDER_PARAM_MAPPING.slice(
      0,
      paramCount > 0 ? paramCount : DEFAULT_REMINDER_PARAM_MAPPING.length,
    );
  }

  return [];
}

/**
 * Build WhatsApp template body parameters for client self-booking confirmations.
 * Uses DB param_mapping when present; otherwise DEFAULT_REMINDER_PARAM_MAPPING.
 */
async function buildBookingWhatsAppTemplateParameters(template, ctx) {
  const paramCount = Number(template?.params) || 0;
  if (paramCount <= 0) return [];

  const definitions = await getTemplateParamDefinitions(template);
  const effectiveDefinitions =
    definitions.length > 0
      ? definitions.slice(0, paramCount)
      : DEFAULT_REMINDER_PARAM_MAPPING.slice(0, paramCount);

  while (effectiveDefinitions.length < paramCount) {
    effectiveDefinitions.push({ type: 'custom', value: '' });
  }

  const staff = await fetchStaffContactForBooking(ctx.hostEmployeeId);
  const locationDisplay = await resolveBookingLocationDisplay(ctx.locationName, ctx.preferEnglish);
  const includeLink = isTeamsBookingLocation(ctx.locationName);
  const meetingLink = includeLink ? String(ctx.teamsUrl || '').trim() : '';

  const parameters = [];

  for (const def of effectiveDefinitions) {
    let value = '';

    switch (def.type) {
      case 'meeting_date':
        value = ctx.formattedDate || '';
        break;
      case 'meeting_time':
        value = ctx.formattedTime || '';
        break;
      case 'meeting_datetime':
        value = [ctx.formattedDate, ctx.formattedTime].filter(Boolean).join(' at ');
        break;
      case 'meeting_location':
      case 'location':
        value = locationDisplay || ctx.locationName || '';
        break;
      case 'meeting_link':
        value = meetingLink;
        break;
      case 'mobile_number':
        value = staff.mobile || staff.phone || '';
        break;
      case 'phone_number':
        value = staff.phone || staff.mobile || '';
        break;
      case 'email':
        value = staff.email || '';
        break;
      case 'name':
      case 'contact_name':
      case 'client_name':
        value = ctx.contactName || '';
        break;
      case 'custom':
        value = def.value || '';
        break;
      default:
        value = '';
    }

    parameters.push({
      type: 'text',
      text: sanitizeWhatsAppTemplateVariableText(value),
    });
  }

  console.log('[BookingWhatsApp] template params built:', {
    templateId: template?.id,
    templateName: template?.name,
    employeeId: staff.employeeId,
    parameters: parameters.map((p, i) => ({ slot: i + 1, text: p.text })),
  });

  return parameters.slice(0, paramCount);
}

module.exports = {
  buildBookingWhatsAppTemplateParameters,
  fillWhatsAppTemplateContent,
  DEFAULT_REMINDER_PARAM_MAPPING,
};
