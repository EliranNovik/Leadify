import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { msalConfig } from './msalConfig'
import { PublicClientApplication, EventType, AuthenticationResult } from '@azure/msal-browser'
import { MsalProvider } from '@azure/msal-react'
import { supabase, sessionManager } from './lib/supabase'

// Expose Supabase client globally for debugging (remove in production)
(window as any).supabase = supabase;
(window as any).sessionManager = sessionManager;

// Force light theme
document.documentElement.setAttribute('data-theme', 'light');

// Initialize MSAL
const msalInstance = new PublicClientApplication(msalConfig);

// Initialize MSAL instance before using it
msalInstance.initialize().then(() => {
  // MSAL event logging
  msalInstance.addEventCallback((event) => {
    if (event.eventType === EventType.LOGIN_SUCCESS) {
      const payload = event.payload as AuthenticationResult;
      msalInstance.setActiveAccount(payload.account);
    }
  });

  // MSAL token acquisition logging
  msalInstance.addEventCallback((event) => {
    if (event.eventType === EventType.ACQUIRE_TOKEN_SUCCESS) {
      // Token acquired successfully
    }
  });

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <MsalProvider instance={msalInstance}>
        <App />
      </MsalProvider>
    </React.StrictMode>,
  )
}).catch(error => {
  console.error('Failed to initialize MSAL:', error);
  // Render app without MSAL if initialization fails
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
});
