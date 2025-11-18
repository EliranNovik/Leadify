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

// Apply saved theme preference before React mounts
const savedTheme = (() => {
  try {
    const stored = localStorage.getItem('theme');
    return stored === 'dark' || stored === 'alternative' ? stored : 'light';
  } catch {
    return 'light';
  }
})();
document.documentElement.setAttribute('data-theme', savedTheme);
const applyThemeClass = (theme: string) => {
  const isDark = theme === 'dark';
  const isAlt = theme === 'alternative';
  document.documentElement.classList.toggle('dark', isDark);
  document.body.classList.toggle('dark', isDark);
  document.getElementById('root')?.classList.toggle('dark', isDark);

  document.documentElement.classList.toggle('theme-alt', isAlt);
  document.body.classList.toggle('theme-alt', isAlt);
  document.getElementById('root')?.classList.toggle('theme-alt', isAlt);
};
applyThemeClass(savedTheme);

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        console.log('✅ Service Worker registered successfully:', registration.scope);
        
        // Check for updates periodically
        setInterval(() => {
          registration.update();
        }, 60000); // Check every minute
      })
      .catch((error) => {
        console.warn('⚠️ Service Worker registration failed:', error);
      });

    // Listen for service worker updates
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      console.log('🔄 Service Worker controller changed - reloading page');
      window.location.reload();
    });
  });
}

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
