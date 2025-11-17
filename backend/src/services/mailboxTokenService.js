const supabase = require('../config/supabase');
const { encrypt, decrypt } = require('../utils/encryption');

const TOKEN_TABLE = process.env.MAILBOX_TOKEN_TABLE || 'mailbox_tokens';
const USER_TABLE = process.env.USERS_TABLE || 'users';

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

class MailboxTokenService {
  async upsertToken({
    userId,
    mailboxAddress,
    msUserId,
    tenantId,
    homeAccountId,
    environment,
    refreshToken,
    expiresOn,
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

    await safeQuery(
      supabase
        .from(TOKEN_TABLE)
        .upsert(
          {
            user_id: internalUserId,
            mailbox_address: normaliseMailbox(mailboxAddress),
            ms_user_id: msUserId || null,
            tenant_id: tenantId || null,
            home_account_id: homeAccountId || null,
            environment: environment || null,
            refresh_token_encrypted: encryptedRefreshToken,
            expires_on: expiresOn || null,
            updated_at: now,
            created_at: now,
          },
          { onConflict: 'user_id' }
        )
        .select('user_id')
    );
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
    const row = rows[0];
    const refreshToken = row.refresh_token_encrypted ? decrypt(row.refresh_token_encrypted) : null;
    if (!refreshToken) {
      throw new Error('Stored refresh token is invalid');
    }
    return {
      ...row,
      mailbox_address: normaliseMailbox(row.mailbox_address),
      refresh_token: refreshToken,
    };
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
    }));
  }
}

module.exports = new MailboxTokenService();


