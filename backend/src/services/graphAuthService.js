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

const GRAPH_SCOPES = (resolveEnv('GRAPH_SCOPES', 'MS_GRAPH_SCOPES') || 'offline_access Mail.Read Mail.Send').split(/\s+/);

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
  }

  getMsalClient() {
    return this.msalClient;
  }

  async createAuthUrl(userId, redirectTo) {
    if (!userId) {
      throw new Error('userId is required to initiate Microsoft login');
    }
    if (!GRAPH_CLIENT_ID || !GRAPH_CLIENT_SECRET) {
      throw new Error('Microsoft Graph OAuth is not configured');
    }

    cleanupExpiredStates();

    const state = crypto.randomUUID();
    const { verifier, challenge } = await this.cryptoProvider.generatePkceCodes();
    const authUrl = await this.msalClient.getAuthCodeUrl({
      scopes: GRAPH_SCOPES,
      redirectUri: GRAPH_REDIRECT_URI,
      state,
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
      prompt: 'select_account',
    });

    stateStore.set(state, {
      userId,
      verifier,
      redirectTo,
      createdAt: Date.now(),
    });

    return authUrl;
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
      throw new Error(error?.message || 'Failed to acquire tokens from Microsoft Graph');
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

    await mailboxTokenService.upsertToken({
      userId,
      mailboxAddress: profile.mail || profile.userPrincipalName,
      msUserId: profile.id,
      tenantId: tokenResponse.tenantId || GRAPH_TENANT_ID,
      homeAccountId: tokenResponse.account?.homeAccountId,
      environment: tokenResponse.account?.environment,
      refreshToken,
      expiresOn: tokenResponse.expiresOn?.toISOString?.() || null,
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
    
    // If no token exists, definitely not connected
    if (!tokenRecord) {
      return { connected: false };
    }
    
    // If token exists, mailbox is connected (state might not exist yet if never synced)
    // State is created on first sync, but connection exists as soon as token is present
    const state = await mailboxStateService.getState(userId).catch(() => null);
    
    return {
      connected: true,
      mailbox: state?.mailbox_address || tokenRecord.mailbox_address,
      displayName: state?.display_name || null,
      lastSyncedAt: state?.last_synced_at || null,
      subscriptionExpiry: state?.subscription_expiry || null,
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

  async acquireTokenByRefreshToken(refreshToken, account) {
    try {
      return await this.msalClient.acquireTokenByRefreshToken({
        refreshToken,
        scopes: GRAPH_SCOPES,
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


