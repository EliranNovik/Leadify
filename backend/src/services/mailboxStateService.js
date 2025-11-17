const supabase = require('../config/supabase');

const STATE_TABLE = process.env.MAILBOX_STATE_TABLE || 'mailbox_state';
const USER_TABLE = process.env.USERS_TABLE || 'users';

const safeQuery = async (builder) => {
  try {
    const { data, error } = await builder;
    if (error) throw error;
    return data;
  } catch (error) {
    console.error('❌ Mailbox state table error:', error.message || error);
    throw error;
  }
};

const resolveInternalUserId = async (userId) => {
  if (!userId) return null;
  try {
    const { data, error } = await supabase
      .from(USER_TABLE)
      .select('id')
      .or(`id.eq.${userId},auth_id.eq.${userId}`)
      .maybeSingle();

    if (error) {
      console.error('❌ Mailbox state: failed to resolve user:', error.message || error);
      throw new Error('Unable to resolve user for mailbox state');
    }

    return data?.id || null;
  } catch (err) {
    console.error('❌ Mailbox state: error resolving user:', err.message || err);
    throw new Error('Unable to resolve user for mailbox state');
  }
};

class MailboxStateService {
  async getState(userId) {
    if (!userId) return null;
    try {
      const internalUserId = await resolveInternalUserId(userId);
      if (!internalUserId) return null;

      const rows = await safeQuery(
        supabase.from(STATE_TABLE).select('*').eq('user_id', internalUserId).limit(1)
      );
      return rows?.[0] || null;
    } catch (error) {
      console.error('❌ Mailbox state fetch failed:', error.message || error);
      return null;
    }
  }

  async upsertState(userId, patch = {}) {
    if (!userId) return;
    try {
      const internalUserId = await resolveInternalUserId(userId);
      if (!internalUserId) {
        throw new Error('Unable to resolve user for mailbox state');
      }

      await safeQuery(
        supabase
          .from(STATE_TABLE)
          .upsert(
            {
              user_id: internalUserId,
              updated_at: new Date().toISOString(),
              ...patch,
            },
            { onConflict: 'user_id' }
          )
      );
    } catch (error) {
      console.error('❌ Mailbox state update failed:', error.message || error);
      throw new Error('Unable to update mailbox state');
    }
  }
}

module.exports = new MailboxStateService();


