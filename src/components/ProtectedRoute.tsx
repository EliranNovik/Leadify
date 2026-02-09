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
  
  // Wait for INITIAL_SESSION to fire in new tabs
  // INITIAL_SESSION fires when the auth listener is set up, which happens quickly
  // But in some cases (multiple tabs, slow initialization), it may take longer
  useEffect(() => {
    if (isInitialized) {
      // If user exists, we're good to go immediately
      if (user) {
        setHasCheckedInitialSession(true);
        return;
      }
      // If there are stored tokens in localStorage, wait longer
      // This means a session exists but INITIAL_SESSION hasn't processed it yet
      const waitTime = hasStoredSession ? 2000 : 1000; // Wait 2 seconds if tokens exist, 1 second otherwise
      
      // If isLoading is true, wait a bit longer - auth is still being checked
      const finalWaitTime = isLoading ? Math.max(waitTime, 1500) : waitTime;
      
      const timer = setTimeout(() => {
        setHasCheckedInitialSession(true);
      }, finalWaitTime);
      return () => clearTimeout(timer);
    }
  }, [isInitialized, user, isLoading, hasStoredSession]);
  
  // Only show loading if we're truly not initialized (first time check)
  if (!isInitialized) {
    return (
      <div className="flex justify-center items-center h-screen bg-white">
        <div className="text-center">
          <div className="loading loading-spinner loading-lg text-primary"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }
  
  // If user exists, render immediately (no waiting, no loading screen)
  if (user) {
    return <>{children}</>;
  }
  
  // If we haven't checked initial session yet, wait
  // Show a minimal loading state to avoid blank screen
  // This gives INITIAL_SESSION time to fire in new tabs
  if (!hasCheckedInitialSession) {
    return (
      <div className="flex justify-center items-center h-screen bg-white">
        <div className="text-center">
          <div className="loading loading-spinner loading-sm text-primary"></div>
        </div>
      </div>
    );
  }
  
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
