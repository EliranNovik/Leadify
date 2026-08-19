const supabase = require('../config/supabase');

const TABLE = 'lead_price_offers';

function leadScope(clientId, legacyId) {
  const uuid = clientId != null && String(clientId).trim() !== '' ? String(clientId).trim() : null;
  const legacy =
    legacyId != null && legacyId !== '' && Number.isFinite(Number(legacyId))
      ? Number(legacyId)
      : null;
  return { uuid, legacy };
}

async function insertPriceOffer(record = {}) {
  const body = String(record.body || '').trim();
  if (!body) {
    throw new Error('Offer text is required');
  }
  const { uuid, legacy } = leadScope(record.clientId ?? record.client_id, record.legacyId ?? record.legacy_id);
  if (!uuid && legacy == null) {
    throw new Error('clientId or legacyId is required');
  }

  const row = {
    client_id: uuid,
    legacy_id: legacy,
    body,
    sender_name: record.senderName ?? record.sender_name ?? null,
    sender_email: record.senderEmail ?? record.sender_email ?? null,
    total: record.total ?? null,
    currency: record.currency ?? null,
    email_message_id: record.emailMessageId ?? record.email_message_id ?? null,
    sent_at: record.sentAt ?? record.sent_at ?? new Date().toISOString(),
  };

  const { data, error } = await supabase.from(TABLE).insert(row).select('id').maybeSingle();
  if (error) {
    if (error.code === '23505' && row.email_message_id) {
      const existing = await supabase
        .from(TABLE)
        .select('id')
        .eq('email_message_id', row.email_message_id)
        .maybeSingle();
      if (existing.data?.id) return { id: existing.data.id };
    }
    if (error.code === '42P01' || error.code === 'PGRST205' || /schema cache|does not exist/i.test(error.message || '')) {
      throw new Error('Run sql/2026-08-19_lead_price_offers.sql in the Supabase SQL editor');
    }
    throw new Error(error.message || 'Failed to save price offer');
  }
  return { id: data?.id ?? null };
}

async function listPriceOffers({ clientId, legacyId } = {}) {
  const { uuid, legacy } = leadScope(clientId, legacyId);
  if (!uuid && legacy == null) return [];

  let query = supabase
    .from(TABLE)
    .select('id, client_id, legacy_id, body, sender_name, sender_email, total, currency, email_message_id, sent_at')
    .order('sent_at', { ascending: true })
    .limit(100);

  query = uuid ? query.eq('client_id', uuid) : query.eq('legacy_id', legacy);

  const { data, error } = await query;
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205' || /lead_price_offers/i.test(error.message || '')) {
      throw new Error('Run sql/2026-08-19_lead_price_offers.sql in the Supabase SQL editor');
    }
    throw new Error(error.message || 'Failed to list price offers');
  }
  return data || [];
}

module.exports = {
  insertPriceOffer,
  listPriceOffers,
};
