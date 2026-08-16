const supabase = require('../config/supabase');
const { encrypt, decrypt } = require('../utils/encryption');

const TOKEN_TABLE = process.env.MAILBOX_TOKEN_TABLE || 'mailbox_tokens';
const USER_TABLE = process.env.USERS_TABLE || 'users';

const STATUS_CONNECTED = 'connected';
const STATUS_NEEDS_RECONNECT = 'needs_reconnect';

const safeQuery = async (builder) => {
  try {
    const { data, error } = await builder;
    if (error) throw error;
    return data;
  } catch (error) {
    console.error('❌ Mailbox token table error:', error.message || error);
    throw new Error('Mailbox token store is not available');
  }
};

const normaliseMailbox = (value) => (value || '').trim().toLowerCase();

const resolveInternalUserId = async (userId) => {
  if (!userId) return null;
  try {
    const { data, error } = await supabase
      .from(USER_TABLE)
      .select('id')
      .or(`id.eq.${userId},auth_id.eq.${userId}`)
      .maybeSingle();

    if (error) {
      console.error('❌ Failed to resolve internal user id for mailbox tokens:', error.message || error);
      throw new Error('Unable to resolve user for mailbox tokens');
    }

    return data?.id || null;
  } catch (err) {
    console.error('❌ Error resolving internal user id for mailbox tokens:', err.message || err);
    throw new Error('Unable to resolve user for mailbox tokens');
  }
};

const decodeTokenRow = (row) => {
  if (!row) return null;
  const refreshToken = row.refresh_token_encrypted ? decrypt(row.refresh_token_encrypted) : null;
  if (!refreshToken) {
    throw new Error('Stored refresh token is invalid');
  }
  return {
    ...row,
    mailbox_address: normaliseMailbox(row.mailbox_address),
    refresh_token: refreshToken,
    status: row.status || STATUS_CONNECTED,
  };
};

class MailboxTokenService {
  async getUserEmail(userId) {
    const internalUserId = await resolveInternalUserId(userId);
    if (!internalUserId) return null;
    const { data, error } = await supabase
      .from(USER_TABLE)
      .select('email')
      .eq('id', internalUserId)
      .maybeSingle();
    if (error) {
      console.error('❌ Failed to load CRM user email for mailbox tokens:', error.message || error);
      return null;
    }
    return normaliseMailbox(data?.email);
  }

  async upsertToken({
    userId,
    mailboxAddress,
    msUserId,
    tenantId,
    homeAccountId,
    environment,
    refreshToken,
    expiresOn,
    status = STATUS_CONNECTED,
  }) {
    if (!userId || !refreshToken) {
      throw new Error('userId and refreshToken are required');
    }

    const internalUserId = await resolveInternalUserId(userId);
    if (!internalUserId) {
      throw new Error('Unable to resolve CRM user for mailbox tokens. Please ensure the user exists.');
    }

    const encryptedRefreshToken = encrypt(refreshToken);
    const now = new Date().toISOString();
    const existing = await safeQuery(
      supabase.from(TOKEN_TABLE).select('created_at').eq('user_id', internalUserId).limit(1)
    );
    const createdAt = existing?.[0]?.created_at || now;

    const payload = {
      user_id: internalUserId,
      mailbox_address: normaliseMailbox(mailboxAddress),
      ms_user_id: msUserId || null,
      tenant_id: tenantId || null,
      home_account_id: homeAccountId || null,
      environment: environment || null,
      refresh_token_encrypted: encryptedRefreshToken,
      expires_on: expiresOn || null,
      updated_at: now,
      created_at: createdAt,
      status,
      last_refresh_error: null,
      last_refresh_at: now,
    };

    const { error } = await supabase.from(TOKEN_TABLE).upsert(payload, { onConflict: 'user_id' }).select('user_id');
    if (error) {
      const missingStatusColumns = /status|last_refresh/i.test(error.message || '');
      if (missingStatusColumns) {
        const { status: _s, last_refresh_error: _e, last_refresh_at: _t, ...legacy } = payload;
        await safeQuery(
          supabase.from(TOKEN_TABLE).upsert(legacy, { onConflict: 'user_id' }).select('user_id')
        );
        return internalUserId;
      }
      console.error('❌ Mailbox token table error:', error.message || error);
      throw new Error('Mailbox token store is not available');
    }
    return internalUserId;
  }

  async markNeedsReconnect(userId, errorMessage) {
    const internalUserId = await resolveInternalUserId(userId);
    if (!internalUserId) return;
    const now = new Date().toISOString();
    const { error } = await supabase
      .from(TOKEN_TABLE)
      .update({
        status: STATUS_NEEDS_RECONNECT,
        last_refresh_error: String(errorMessage || 'Refresh token rejected').slice(0, 1000),
        last_refresh_at: now,
        updated_at: now,
      })
      .eq('user_id', internalUserId);
    if (error) {
      console.error('❌ Failed to mark mailbox token needs_reconnect:', error.message || error);
    }
  }

  async markRefreshed(userId) {
    const internalUserId = await resolveInternalUserId(userId);
    if (!internalUserId) return;
    const now = new Date().toISOString();
    const { error } = await supabase
      .from(TOKEN_TABLE)
      .update({
        status: STATUS_CONNECTED,
        last_refresh_error: null,
        last_refresh_at: now,
        updated_at: now,
      })
      .eq('user_id', internalUserId);
    if (error && !/status|last_refresh/i.test(error.message || '')) {
      console.error('❌ Failed to mark mailbox token refreshed:', error.message || error);
    }
  }

  async removeToken(userId) {
    if (!userId) return;
    const internalUserId = await resolveInternalUserId(userId);
    if (!internalUserId) return;
    await safeQuery(supabase.from(TOKEN_TABLE).delete().eq('user_id', internalUserId));
  }

  async getTokenByUserId(userId) {
    if (!userId) return null;
    const internalUserId = await resolveInternalUserId(userId);
    if (!internalUserId) return null;
    const rows = await safeQuery(
      supabase.from(TOKEN_TABLE).select('*').eq('user_id', internalUserId).limit(1)
    );
    if (!rows || !rows.length) return null;
    return decodeTokenRow(rows[0]);
  }

  async getAllTokens() {
    const rows = await safeQuery(
      supabase.from(TOKEN_TABLE).select('*')
    );
    if (!rows || !rows.length) {
      return [];
    }
    return rows.map((row) => ({
      ...row,
      mailbox_address: normaliseMailbox(row.mailbox_address || ''),
      status: row.status || STATUS_CONNECTED,
    }));
  }
}

module.exports = new MailboxTokenService();
module.exports.STATUS_CONNECTED = STATUS_CONNECTED;
module.exports.STATUS_NEEDS_RECONNECT = STATUS_NEEDS_RECONNECT;
module.exports.normaliseMailbox = normaliseMailbox;
