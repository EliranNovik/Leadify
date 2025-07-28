const clientId = import.meta.env.VITE_MSAL_CLIENT_ID;
const tenantId = import.meta.env.VITE_MSAL_TENANT_ID;

if (!clientId || !tenantId) {
  throw new Error('MSAL clientId or tenantId is not set in environment variables.');
}

export const msalConfig = {
  auth: {
    clientId,
    authority: `https://login.microsoftonline.com/${tenantId}`,
    redirectUri: window.location.origin,
    navigateToLoginRequestUrl: true,
  },
  cache: {
    cacheLocation: "localStorage",
    storeAuthStateInCookie: false,
  },
  system: {
    allowNativeBroker: false,
    loggerOptions: {
      loggerCallback: (level: any, message: string, containsPii: boolean) => {
        if (containsPii) {
          return;
        }
        switch (level) {
          case 0:
            console.error(message);
            break;
          case 1:
            console.warn(message);
            break;
          case 2:
            console.info(message);
            break;
          case 3:
            console.debug(message);
            break;
        }
      },
      logLevel: 3,
    }
  }
};

export const loginRequest = {
  scopes: [
    "User.Read",
    "openid",
    "profile",
    "email",
    "offline_access",
    "Calendars.Read",
    "Calendars.Read.Shared",
    "Calendars.ReadWrite",
    "Calendars.ReadWrite.Shared",
    "Mail.Read",
    "Files.Read",
    "OnlineMeetings.ReadWrite",
    "Mail.ReadWrite",
    "Chat.Read",
    "Chat.ReadWrite",
    "ChatMessage.Read",
    "ChatMessage.Send"
  ],
};

// Fallback scopes for when calling permissions aren't available
export const basicLoginRequest = {
  scopes: [
    "User.Read",
    "openid",
    "profile",
    "email",
    "offline_access",
    "Calendars.Read",
    "Calendars.Read.Shared",
    "Calendars.ReadWrite",
    "Calendars.ReadWrite.Shared",
    "Mail.Read",
    "Files.Read",
    "OnlineMeetings.ReadWrite",
    "Mail.ReadWrite",
    "Chat.Read",
    "Chat.ReadWrite",
    "ChatMessage.Read",
    "ChatMessage.Send"
  ],
}; 