/**
 * Landing-page WhatsApp clicks send a ready-made message with the source code in parentheses:
 * "שלום, אני מעוניין/ת ... (22018) ואשמח לקבל פרטים נוספים"
 */

function extractParenthesizedSourceCode(text) {
  if (text == null) return null;
  const source = String(text);
  const matches = source.match(/\((\d{3,12})\)/g);
  if (!matches || matches.length === 0) return null;
  const last = matches[matches.length - 1];
  const digits = last.slice(1, -1);
  const code = Number(digits);
  return Number.isSafeInteger(code) ? code : null;
}

function messageTextHasHebrew(text) {
  return /[\u0590-\u05FF]/.test(String(text || ''));
}

/**
 * Create a CRM lead for an unknown WhatsApp sender whose message contains a misc_leadsource.code.
 * Returns the created lead, or null when there is no code or that code is not an active source.
 */
async function createCrmLeadFromWhatsAppSourceCode(supabase, { phoneNumber, senderName, messageText }) {
  const sourceCode = extractParenthesizedSourceCode(messageText);
  if (sourceCode == null) return null;

  const { data: source, error: sourceError } = await supabase
    .from('misc_leadsource')
    .select('id, code, name, active')
    .eq('code', sourceCode)
    .maybeSingle();

  if (sourceError) {
    console.error('WhatsApp source-code lookup failed:', sourceError);
    return null;
  }
  if (!source || source.active === false) {
    console.warn(`WhatsApp message contained source code ${sourceCode}, but no active misc_leadsource row matched.`);
    return null;
  }

  const hasHebrew = messageTextHasHebrew(messageText);
  const trimmedName = String(senderName || '').trim();
  const leadName = trimmedName || String(phoneNumber || '').trim() || 'WhatsApp Lead';

  const { data, error } = await supabase.rpc('create_lead_with_source_validation', {
    p_lead_name: leadName,
    p_lead_email: null,
    p_lead_phone: phoneNumber || null,
    p_lead_topic: null,
    p_lead_language: hasHebrew ? 'HE' : 'EN',
    p_lead_source: source.name || 'WhatsApp',
    p_created_by: 'webhook@system',
    p_source_code: sourceCode,
    p_balance_currency: 'NIS',
    p_proposal_currency: 'NIS',
    p_language_id: hasHebrew ? 2 : null,
    p_country_id: null,
    p_source_url: null,
  });

  if (error || !data || data.length === 0) {
    console.error('Failed to create lead from WhatsApp source code:', error);
    return null;
  }

  const created = data[0];
  const { error: flagError } = await supabase
    .from('leads')
    .update({
      utm_params: {
        arrived_via_whatsapp: true,
        whatsapp_source_code: sourceCode,
      },
    })
    .eq('id', created.id);

  if (flagError) {
    console.error('Lead was created, but the WhatsApp arrival flag was not saved:', flagError);
  }

  console.log(
    `✅ WhatsApp lead created as source ${source.name} (code ${sourceCode}): ${created.lead_number}`,
  );
  return created;
}

module.exports = {
  extractParenthesizedSourceCode,
  messageTextHasHebrew,
  createCrmLeadFromWhatsAppSourceCode,
};
