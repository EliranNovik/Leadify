const { ConfidentialClientApplication, LogLevel, CryptoProvider } = require('@azure/msal-node');
const crypto = require('crypto');
const mailboxTokenService = require('./mailboxTokenService');
const mailboxStateService = require('./mailboxStateService');

const resolveEnv = (...keys) => {
  for (const key of keys) {
    if (key && process.env[key]) {
      return process.env[key];
    }
  }
  return undefined;
};

const GRAPH_TENANT_ID = resolveEnv(
  'GRAPH_TENANT_ID',
  'MS_GRAPH_TENANT_ID',
  'MSAL_TENANT_ID',
  'AZURE_TENANT_ID',
  'VITE_MSAL_TENANT_ID'
);

const GRAPH_CLIENT_ID = resolveEnv(
  'GRAPH_CLIENT_ID',
  'MS_GRAPH_CLIENT_ID',
  'MSAL_CLIENT_ID',
  'AZURE_CLIENT_ID',
  'AZURE_AD_CLIENT_ID',
  'VITE_MSAL_CLIENT_ID'
);

const GRAPH_CLIENT_SECRET = resolveEnv(
  'GRAPH_CLIENT_SECRET',
  'MS_GRAPH_CLIENT_SECRET',
  'MSAL_CLIENT_SECRET',
  'AZURE_CLIENT_SECRET'
);

const GRAPH_REDIRECT_URI = resolveEnv(
  'GRAPH_REDIRECT_URI',
  'MS_GRAPH_REDIRECT_URI',
  'MSAL_REDIRECT_URI'
);

const GRAPH_SCOPES = (
  resolveEnv('GRAPH_SCOPES', 'MS_GRAPH_SCOPES') ||
  'offline_access Mail.Read Mail.Send Calendars.ReadWrite Calendars.ReadWrite.Shared OnlineMeetings.ReadWrite'
).split(/\s+/);

if (!GRAPH_CLIENT_ID || !GRAPH_CLIENT_SECRET || !GRAPH_TENANT_ID || !GRAPH_REDIRECT_URI) {
  console.warn('⚠️  Missing Graph OAuth configuration. Auth endpoints will not work until configured.');
}

const STATE_TTL_MS = 15 * 60 * 1000;
const stateStore = new Map();

const cleanupExpiredStates = () => {
  const now = Date.now();
  for (const [key, value] of stateStore.entries()) {
    if (now - value.createdAt > STATE_TTL_MS) {
      stateStore.delete(key);
    }
  }
};

class GraphAuthService {
  constructor() {
    this.msalClient = new ConfidentialClientApplication({
      auth: {
        clientId: GRAPH_CLIENT_ID,
        clientSecret: GRAPH_CLIENT_SECRET,
        authority: `https://login.microsoftonline.com/${GRAPH_TENANT_ID}`,
      },
      system: {
        loggerOptions: {
          logLevel: LogLevel.Error,
        },
      },
    });
    this.cryptoProvider = new CryptoProvider();
    this.accessTokenLocks = new Map();
  }

  getMsalClient() {
    return this.msalClient;
  }

  async createAuthUrl(userId, redirectTo, options = {}) {
    if (!userId) {
      throw new Error('userId is required to initiate Microsoft login');
    }
    if (!GRAPH_CLIENT_ID || !GRAPH_CLIENT_SECRET) {
      throw new Error('Microsoft Graph OAuth is not configured');
    }

    cleanupExpiredStates();

    const loginHint =
      (typeof options.loginHint === 'string' && options.loginHint.trim()) ||
      (await mailboxTokenService.getUserEmail(userId)) ||
      '';

    const state = crypto.randomUUID();
    const { verifier, challenge } = await this.cryptoProvider.generatePkceCodes();
    const authUrl = await this.msalClient.getAuthCodeUrl({
      scopes: GRAPH_SCOPES,
      redirectUri: GRAPH_REDIRECT_URI,
      state,
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
      prompt: options.silent ? 'none' : 'select_account',
      ...(loginHint ? { loginHint } : {}),
    });

    stateStore.set(state, {
      userId,
      verifier,
      redirectTo,
      createdAt: Date.now(),
    });

    return authUrl;
  }

  consumeAuthRedirectState(state) {
    if (!state || !stateStore.has(state)) return null;
    const value = stateStore.get(state);
    stateStore.delete(state);
    return value;
  }

  async handleAuthCode(code, state) {
    if (!stateStore.has(state)) {
      throw new Error('Auth state is invalid or expired. Please try again.');
    }

    const { userId, verifier, redirectTo } = stateStore.get(state);
    stateStore.delete(state);

    let tokenResponse;
    try {
      tokenResponse = await this.msalClient.acquireTokenByCode({
        code,
        scopes: GRAPH_SCOPES,
        redirectUri: GRAPH_REDIRECT_URI,
        codeVerifier: verifier,
      });
    } catch (error) {
      console.error('❌ MSAL acquireTokenByCode failed:', error);
      const wrapped = new Error(error?.message || 'Failed to acquire tokens from Microsoft Graph');
      wrapped.redirectTo = redirectTo;
      throw wrapped;
    }

    if (!tokenResponse?.accessToken) {
      throw new Error('Failed to acquire tokens from Microsoft Graph');
    }

    const refreshToken =
      tokenResponse?.refreshToken ||
      this.extractRefreshToken(tokenResponse.account) ||
      this.extractAnyRefreshToken();
    if (!refreshToken) {
      console.error('GraphAuthService: Missing refresh token', {
        hasTokenResponse: !!tokenResponse,
        hasAccessToken: !!tokenResponse?.accessToken,
        hasAccount: !!tokenResponse?.account,
        cacheStats: this.getRefreshTokenCacheStats(),
      });
      throw new Error('Failed to acquire refresh token from Microsoft Graph');
    }

    const profile = await this.fetchProfile(tokenResponse.accessToken);
    const connectedMailbox = String(profile.mail || profile.userPrincipalName || '')
      .trim()
      .toLowerCase();
    const crmEmail = await mailboxTokenService.getUserEmail(userId);
    if (crmEmail) {
      const graphMail = String(profile.mail || '').trim().toLowerCase();
      const graphUpn = String(profile.userPrincipalName || '').trim().toLowerCase();
      if (graphMail !== crmEmail && graphUpn !== crmEmail) {
        const mismatch = new Error(
          `Microsoft account ${connectedMailbox || 'unknown'} does not match CRM user ${crmEmail}. Sign in as ${crmEmail}.`
        );
        mismatch.code = 'MAILBOX_ACCOUNT_MISMATCH';
        mismatch.mailbox = connectedMailbox;
        mismatch.expectedEmail = crmEmail;
        mismatch.redirectTo = redirectTo;
        throw mismatch;
      }
    }

    await mailboxTokenService.upsertToken({
      userId,
      mailboxAddress: profile.mail || profile.userPrincipalName,
      msUserId: profile.id,
      tenantId: tokenResponse.tenantId || GRAPH_TENANT_ID,
      homeAccountId: tokenResponse.account?.homeAccountId,
      environment: tokenResponse.account?.environment,
      refreshToken,
      expiresOn: tokenResponse.expiresOn?.toISOString?.() || null,
      status: 'connected',
    });

    try {
      if (tokenResponse.account) {
        await this.msalClient.getTokenCache().removeAccount(tokenResponse.account);
      }
    } catch (cacheError) {
      console.warn('⚠️  Failed to remove account from MSAL cache:', cacheError);
    }

    await mailboxStateService.upsertState(userId, {
      mailbox_address: profile.mail || profile.userPrincipalName,
      ms_user_id: profile.id,
      display_name: profile.displayName,
      last_connected_at: new Date().toISOString(),
    });

    return {
      userId,
      mailbox: profile.mail || profile.userPrincipalName,
      displayName: profile.displayName,
      redirectTo,
    };
  }

  async fetchProfile(accessToken) {
    const response = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch Microsoft profile: ${errorText}`);
    }
    return response.json();
  }

  async getConnectionStatus(userId) {
    const tokenRecord = await mailboxTokenService.getTokenByUserId(userId).catch(() => null);

    if (!tokenRecord) {
      return { connected: false, needsReconnect: true };
    }

    const needsReconnect = tokenRecord.status === 'needs_reconnect';
    const state = await mailboxStateService.getState(userId).catch(() => null);
    const webhookConfigured = Boolean(process.env.GRAPH_WEBHOOK_NOTIFICATION_URL);
    const staleAfterMs = Math.max(
      10 * 60 * 1000,
      parseInt(process.env.MAILBOX_SYNC_STALE_AFTER_MS || '', 10) || 4 * 60 * 60 * 1000
    );
    const lastMs = state?.last_synced_at ? new Date(state.last_synced_at).getTime() : 0;
    const syncStale = !lastMs || Date.now() - lastMs > staleAfterMs;
    const subExpMs = state?.subscription_expiry ? new Date(state.subscription_expiry).getTime() : 0;
    const subscriptionMissingOrExpired =
      webhookConfigured &&
      (!state?.subscription_id || !subExpMs || subExpMs < Date.now());
    const needsMailboxSync = !needsReconnect && (syncStale || subscriptionMissingOrExpired);

    return {
      connected: !needsReconnect,
      needsReconnect,
      mailbox: state?.mailbox_address || tokenRecord.mailbox_address,
      displayName: state?.display_name || null,
      lastSyncedAt: state?.last_synced_at || null,
      subscriptionExpiry: state?.subscription_expiry || null,
      webhookConfigured,
      syncStale,
      subscriptionMissingOrExpired,
      needsMailboxSync,
    };
  }

  async disconnect(userId) {
    await mailboxTokenService.removeToken(userId);
    await mailboxStateService.upsertState(userId, {
      delta_link: null,
      subscription_id: null,
      subscription_expiry: null,
      last_synced_at: null,
    });
  }

  async withUserLock(userId, fn) {
    const key = String(userId);
    const previous = this.accessTokenLocks.get(key) || Promise.resolve();
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const queued = previous.catch(() => {}).then(() => gate);
    this.accessTokenLocks.set(key, queued);
    await previous.catch(() => {});
    try {
      return await fn();
    } finally {
      release();
      if (this.accessTokenLocks.get(key) === queued) {
        this.accessTokenLocks.delete(key);
      }
    }
  }

  /**
   * Refresh Graph access token for a CRM user. Serialised per user so rotating
   * refresh tokens cannot race and wipe the stored connection.
   */
  async getAccessTokenForUser(userId, scopes = GRAPH_SCOPES) {
    if (!userId) {
      throw new Error('userId is required');
    }

    return this.withUserLock(userId, async () => {
      const tokenRecord = await mailboxTokenService.getTokenByUserId(userId);
      if (!tokenRecord) {
        const err = new Error('Mailbox is not connected for this user');
        err.code = 'MAILBOX_NOT_CONNECTED';
        throw err;
      }
      if (tokenRecord.status === 'needs_reconnect') {
        const err = new Error('Your mailbox connection has expired. Please reconnect your mailbox.');
        err.code = 'EXPIRED_REFRESH_TOKEN';
        err.statusCode = 401;
        throw err;
      }

      const account = {
        homeAccountId: tokenRecord.home_account_id,
        environment: tokenRecord.environment,
        tenantId: tokenRecord.tenant_id,
        username: tokenRecord.mailbox_address,
      };

      let tokenResponse;
      try {
        tokenResponse = await this.acquireTokenByRefreshToken(tokenRecord.refresh_token, account, scopes);
      } catch (error) {
        if (error?.code === 'EXPIRED_REFRESH_TOKEN') {
          await mailboxTokenService.markNeedsReconnect(userId, error.message);
        }
        throw error;
      }

      if (!tokenResponse?.accessToken) {
        throw new Error('Unable to acquire Microsoft Graph access token');
      }

      if (tokenResponse.refreshToken && tokenResponse.refreshToken !== tokenRecord.refresh_token) {
        await mailboxTokenService.upsertToken({
          userId,
          mailboxAddress: tokenRecord.mailbox_address,
          msUserId: tokenRecord.ms_user_id,
          tenantId: tokenRecord.tenant_id,
          homeAccountId: tokenResponse.account?.homeAccountId || tokenRecord.home_account_id,
          environment: tokenResponse.account?.environment || tokenRecord.environment,
          refreshToken: tokenResponse.refreshToken,
          expiresOn: tokenResponse.expiresOn?.toISOString?.() || null,
          status: 'connected',
        });
      } else {
        await mailboxTokenService.markRefreshed(userId);
      }

      return {
        accessToken: tokenResponse.accessToken,
        tokenRecord,
        tokenResponse,
      };
    });
  }

  async acquireTokenByRefreshToken(refreshToken, account, scopes = GRAPH_SCOPES) {
    try {
      return await this.msalClient.acquireTokenByRefreshToken({
        refreshToken,
        scopes,
        account,
      });
    } catch (error) {
      // Handle expired refresh token (AADSTS700082)
      if (error?.errorCode === 'invalid_grant' || 
          error?.errorMessage?.includes('AADSTS700082') ||
          error?.errorMessage?.includes('refresh token has expired')) {
        const expiredTokenError = new Error('Refresh token has expired. Please reconnect your mailbox.');
        expiredTokenError.code = 'EXPIRED_REFRESH_TOKEN';
        expiredTokenError.statusCode = 401;
        throw expiredTokenError;
      }
      // Re-throw other errors as-is
      throw error;
    }
  }

  extractRefreshToken(account) {
    if (!account) return null;
    try {
      const rawCache = this.msalClient.getTokenCache().serialize();
      const parsedCache = JSON.parse(rawCache);
      const refreshTokens = parsedCache?.RefreshToken || {};
      const entries = Object.values(refreshTokens);
      const matchingEntry = entries.find((entry) => {
        return (
          entry?.homeAccountId === account.homeAccountId &&
          entry?.environment === account.environment &&
          entry?.clientId === GRAPH_CLIENT_ID
        );
      });
      return matchingEntry?.secret || null;
    } catch (error) {
      console.error('⚠️  Failed to extract refresh token from MSAL cache:', error);
      return null;
    }
  }

  extractAnyRefreshToken() {
    try {
      const rawCache = this.msalClient.getTokenCache().serialize();
      const parsedCache = JSON.parse(rawCache);
      const refreshTokens = parsedCache?.RefreshToken || {};
      const entries = Object.values(refreshTokens);
      if (entries.length === 0) {
        return null;
      }
      // Return the most recent entry
      const lastEntry = entries.at(-1);
      return lastEntry?.secret || null;
    } catch (error) {
      console.error('⚠️  Failed to extract fallback refresh token from MSAL cache:', error);
      return null;
    }
  }

  getRefreshTokenCacheStats() {
    try {
      const rawCache = this.msalClient.getTokenCache().serialize();
      const parsedCache = JSON.parse(rawCache);
      const refreshTokens = parsedCache?.RefreshToken || {};
      return {
        totalEntries: Object.keys(refreshTokens).length,
        hasKeys: Object.keys(refreshTokens).length > 0,
      };
    } catch (error) {
      return { error: error?.message || 'Failed to inspect cache' };
    }
  }
}

module.exports = new GraphAuthService();


