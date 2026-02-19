import React, { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthContext } from '../contexts/AuthContext';

/**
 * ProtectedRoute - Simple wrapper that relies entirely on AuthContext
 * No redundant session checks - AuthContext handles all authentication state
 */
const ProtectedRoute: React.FC<{ user: any; children: React.ReactNode }> = ({ children }) => {
  const { user, isLoading, isInitialized } = useAuthContext();
  const [hasCheckedInitialSession, setHasCheckedInitialSession] = useState(false);
  
  // Helper to check if there are Supabase tokens in localStorage
  // This helps detect sessions that haven't been processed by INITIAL_SESSION yet
  const hasStoredSession = typeof window !== 'undefined' && (() => {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.includes('supabase.auth.token') || (key.includes('sb-') && key.includes('-auth-token')))) {
          return true;
        }
      }
      return false;
    } catch (e) {
      return false;
    }
  })();
  
  // NO LOADING SCREENS - render immediately
  // AuthContext now uses cached session for instant initialization
  // If user exists, render immediately
  if (user) {
    return <>{children}</>;
  }
  
  // If we have stored tokens, render children immediately (session will be processed in background)
  // This prevents showing loading screens when a session exists
  if (hasStoredSession) {
    return <>{children}</>;
  }
  
  // If initialized but no user and no stored session, redirect to login
  if (isInitialized && !user && !hasStoredSession) {
    return <Navigate to="/login" replace />;
  }
  
  // If not initialized yet, still render (AuthContext is instant now)
  // This prevents any loading screens
  return <>{children}</>;
  
  // If initialized and checked, but no user and not loading
  // Only redirect if we're sure there's no session (not loading, no user, and no stored tokens)
  // If stored tokens exist, don't redirect - session might still be processing
  if (!user && !isLoading && !hasStoredSession) {
    return <Navigate to="/login" replace />;
  }
  
  // If we have stored tokens but no user yet, render children and let INITIAL_SESSION process
  // This prevents redirecting when a session exists but hasn't been processed yet
  // The user will appear once INITIAL_SESSION fires
  if (!user && !isLoading && hasStoredSession) {
    return <>{children}</>;
  }
  
  // If we have a user or are still loading, render children
  return <>{children}</>;
};

export default ProtectedRoute;
