import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App'
import { PublicClientApplication, EventType, EventMessage, AuthenticationResult } from '@azure/msal-browser'
import { MsalProvider } from '@azure/msal-react'
import { msalConfig } from './msalConfig'

// Force light theme
if (typeof document !== 'undefined') {
  document.documentElement.setAttribute('data-theme', 'light');
}

// Initialize MSAL
const msalInstance = new PublicClientApplication(msalConfig);

// Default to using the first account if available
msalInstance.initialize().then(() => {
  // Optional - This will update the account state if a user signs in from another tab/window
  msalInstance.enableAccountStorageEvents();
  
  // Account selection logic is app dependent. Adjust as needed for different use cases.
  const accounts = msalInstance.getAllAccounts();
  if (accounts.length > 0) {
    msalInstance.setActiveAccount(accounts[0]);
  }
  
  msalInstance.addEventCallback((event: EventMessage) => {
    if (
      event.eventType === EventType.LOGIN_SUCCESS && 
      event.payload && 
      'account' in event.payload
    ) {
      const payload = event.payload as AuthenticationResult;
      if (payload.account) {
        console.log('Login successful');
        msalInstance.setActiveAccount(payload.account);
      }
    }
  });

  // Render the application
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <MsalProvider instance={msalInstance}>
        <App />
      </MsalProvider>
    </React.StrictMode>
  );
}).catch(error => {
  console.error('Error initializing MSAL:', error);
  // Render the application without MSAL if initialization fails
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});
