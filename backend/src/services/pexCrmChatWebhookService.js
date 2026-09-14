const axios = require('axios');
const crypto = require('crypto');
const supabase = require('../config/supabase');

const DEFAULT_WEBHOOK_URL = 'https://pexagent-production.up.railway.app/webhooks/crm-chat';
const PEX_WHATSAPP_MESSAGE_ID_RE = /^(partner_|pex_|pexagent_)/i;
const PEX_WHATSAPP_SENDER_RE = /\b(pex|partner firm)\b/i;

function webhookUrl() {
  return (process.env.PEX_CRM_CHAT_WEBHOOK_URL || DEFAULT_WEBHOOK_URL).trim();
}

function webhookSecret() {
  return (process.env.PEX_CRM_CHAT_WEBHOOK_SECRET || '').trim();
}

function isPexWhatsAppMessageId(id) {
  return typeof id === 'string' && PEX_WHATSAPP_MESSAGE_ID_RE.test(id.trim());
}

function isPexWhatsAppSenderName(name) {
  return typeof name === 'string' && PEX_WHATSAPP_SENDER_RE.test(name);
}

function messagesLookLikePex(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return false;
  return rows.some(
    (row) =>
      isPexWhatsAppMessageId(row.whatsapp_message_id) || isPexWhatsAppSenderName(row.sender_name),
  );
}

function resolveLeadRef(leadId) {
  if (leadId == null || leadId === '' || leadId === 'null') {
    return { leadId: null, legacyId: null };
  }
  const value = String(leadId);
  if (value.startsWith('legacy_')) {
    const legacyId = parseInt(value.replace('legacy_', ''), 10);
    return { leadId: null, legacyId: Number.isFinite(legacyId) ? legacyId : null };
  }
  if (value.startsWith('contact_') || value.startsWith('whatsapp_')) {
    return { leadId: null, legacyId: null };
  }
  return { leadId: value, legacyId: null };
}

/** CRM staff replies on a PEX thread. Must not start with pex_/partner_/pexagent_. */
function buildPexCrmMessageId() {
  return `crm_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

async function fetchLeadWaWindow(leadId) {
  if (!leadId) return null;
  const { data, error } = await supabase
    .from('leads')
    .select('wa_window_expires_at')
    .eq('id', leadId)
    .maybeSingle();
  if (error) {
    console.warn('PEX chat detect: lead wa_window lookup failed:', error.message);
    return null;
  }
  return data?.wa_window_expires_at || null;
}

async function fetchMessageSignals({ leadId, legacyId, phoneNumber }) {
  const rows = [];

  if (leadId) {
    const { data, error } = await supabase
      .from('whatsapp_messages')
      .select('whatsapp_message_id, sender_name')
      .eq('lead_id', leadId)
      .order('sent_at', { ascending: false })
      .limit(300);
    if (error) {
      console.warn('PEX chat detect: lead messages lookup failed:', error.message);
    } else if (data?.length) {
      rows.push(...data);
    }
  }

  if (legacyId) {
    const { data, error } = await supabase
      .from('whatsapp_messages')
      .select('whatsapp_message_id, sender_name')
      .eq('legacy_id', legacyId)
      .order('sent_at', { ascending: false })
      .limit(300);
    if (error) {
      console.warn('PEX chat detect: legacy messages lookup failed:', error.message);
    } else if (data?.length) {
      rows.push(...data);
    }
  }

  if (rows.length === 0 && phoneNumber) {
    const { data, error } = await supabase
      .from('whatsapp_messages')
      .select('whatsapp_message_id, sender_name')
      .eq('phone_number', phoneNumber)
      .order('sent_at', { ascending: false })
      .limit(200);
    if (error) {
      console.warn('PEX chat detect: phone messages lookup failed:', error.message);
    } else if (data?.length) {
      rows.push(...data);
    }
  }

  return rows;
}

async function isPexWhatsAppConversation({ leadId, legacyId, phoneNumber } = {}) {
  const resolved = resolveLeadRef(leadId);
  const finalLeadId = resolved.leadId;
  const finalLegacyId = legacyId || resolved.legacyId;

  const waWindow = await fetchLeadWaWindow(finalLeadId);
  if (waWindow) return true;

  const signals = await fetchMessageSignals({
    leadId: finalLeadId,
    legacyId: finalLegacyId,
    phoneNumber,
  });
  return messagesLookLikePex(signals);
}

/**
 * Accelerator for PEX. Failures are ignored — they poll the same tables every 2 minutes.
 */
async function notifyPexCrmChat({ table, rowId, row_id: rowIdSnake } = {}) {
  const secret = webhookSecret();
  const url = webhookUrl();
  const parsedRowId = Number(rowId ?? rowIdSnake);

  if (!table || !Number.isFinite(parsedRowId) || parsedRowId <= 0) {
    console.warn('PEX CRM chat webhook skipped: invalid table/row_id', { table, rowId });
    return { skipped: true, reason: 'invalid_payload' };
  }

  if (!secret) {
    console.warn(
      'PEX CRM chat webhook skipped: PEX_CRM_CHAT_WEBHOOK_SECRET is not set (PEX will poll)',
    );
    return { skipped: true, reason: 'missing_secret' };
  }

  try {
    const response = await axios.post(
      url,
      { table, row_id: parsedRowId },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Pex-Internal-Secret': secret,
        },
        timeout: 8000,
        validateStatus: () => true,
      },
    );
    if (response.status >= 200 && response.status < 300) {
      console.log(`📣 PEX CRM chat webhook ok (${response.status}) ${table}#${parsedRowId}`);
      return { ok: true, status: response.status };
    }
    console.warn(
      `📣 PEX CRM chat webhook non-2xx ${response.status} for ${table}#${parsedRowId} (PEX will poll)`,
    );
    return { ok: false, status: response.status };
  } catch (error) {
    console.warn(
      `📣 PEX CRM chat webhook failed for ${table}#${parsedRowId} (PEX will poll):`,
      error.message,
    );
    return { ok: false, error: error.message };
  }
}

async function notifyWhatsAppRow(rowId) {
  return notifyPexCrmChat({ table: 'whatsapp_messages', row_id: rowId });
}

async function notifyEmailRow(rowId) {
  return notifyPexCrmChat({ table: 'emails', row_id: rowId });
}

module.exports = {
  webhookUrl,
  isPexWhatsAppConversation,
  isPexWhatsAppMessageId,
  buildPexCrmMessageId,
  notifyPexCrmChat,
  notifyWhatsAppRow,
  notifyEmailRow,
  resolveLeadRef,
};
