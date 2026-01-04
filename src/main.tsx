import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { msalConfig } from './msalConfig'
import { PublicClientApplication, EventType, AuthenticationResult } from '@azure/msal-browser'
import { MsalProvider } from '@azure/msal-react'
import { supabase, sessionManager } from './lib/supabase'
import { loadRouteCacheFromStorage } from './utils/routeCache'

// Expose Supabase client globally for debugging (remove in production)
(window as any).supabase = supabase;
(window as any).sessionManager = sessionManager;

// Load route cache from sessionStorage before React mounts
loadRouteCacheFromStorage();

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

// Register Service Worker for PWA (production only to avoid dev caching issues)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
      .then((registration) => {
        console.log('✅ Service Worker registered successfully:', registration.scope);
        
        // Check for updates
        const checkForUpdates = () => {
          registration.update().catch((error) => {
            console.warn('⚠️ Service Worker update check failed:', error);
          });
        };
        
        // Check immediately on load
        checkForUpdates();
        
        // Check periodically every 60 seconds (aggressive checking)
        const updateInterval = setInterval(() => {
          console.log('🔄 Periodic service worker update check...');
          checkForUpdates();
        }, 60 * 1000);
        
        // Store interval ID for cleanup
        (window as any).__swUpdateInterval = updateInterval;
        
        // Also check when page becomes visible (user returns to tab)
        document.addEventListener('visibilitychange', () => {
          if (!document.hidden) {
            console.log('🔄 Page visible - checking for service worker updates...');
            checkForUpdates();
          }
        });
        
        // Listen for service worker updates
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                // New service worker is ready - reload immediately
                console.log('🔄 New Service Worker installed - reloading page');
                if ((window as any).__swUpdateInterval) {
                  clearInterval((window as any).__swUpdateInterval);
                }
                window.location.reload();
              }
            });
          }
        });
      })
      .catch((error) => {
        console.warn('⚠️ Service Worker registration failed:', error);
      });

    // Listen for service worker controller changes
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      console.log('🔄 Service Worker controller changed - reloading page');
      if ((window as any).__swUpdateInterval) {
        clearInterval((window as any).__swUpdateInterval);
      }
      window.location.reload();
    });
  });
} else if ('serviceWorker' in navigator) {
  // During local development, make sure no stale workers stay registered
  navigator.serviceWorker.getRegistrations?.().then((registrations) => {
    registrations.forEach((registration) => {
      registration.unregister().then((didUnregister) => {
        if (didUnregister) {
          console.log('🧹 Unregistered service worker for local dev:', registration.scope);
        }
      });
    });
  }).catch((error) => {
    console.warn('⚠️ Failed to clean up service workers in dev:', error);
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
