import React, { useState, useEffect, useRef } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthContext } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

const ProtectedRoute: React.FC<{ user: any; children: React.ReactNode }> = ({ user, children }) => {
  const { isLoading, isInitialized, user: authUser } = useAuthContext();
  const [retryCount, setRetryCount] = useState(0);
  const [isCheckingSession, setIsCheckingSession] = useState(false);
  const hasCheckedRef = useRef(false);
  
  // Give more time for session initialization, especially for new tabs
  useEffect(() => {
    // Only retry if we're initialized but have no user, and haven't checked too many times
    if (isInitialized && !isLoading && !user && !authUser && retryCount < 3 && !hasCheckedRef.current) {
      hasCheckedRef.current = true;
      // Retry session check for new tabs that might not have synced yet
      const timer = setTimeout(async () => {
        setIsCheckingSession(true);
        try {
          // Check session directly from Supabase
          const { data: { session }, error } = await supabase.auth.getSession();
          
          if (session?.user && !error) {
            // Session found in localStorage, but AuthContext hasn't caught up yet
            // Wait a bit more for AuthContext to sync
            setRetryCount(prev => prev + 1);
            hasCheckedRef.current = false; // Allow more checks
          } else {
            // No session found after retries, stop checking
            hasCheckedRef.current = true;
          }
        } catch (error) {
          console.error('Session check error:', error);
          // On error, give it one more chance
          if (retryCount < 2) {
            hasCheckedRef.current = false;
            setRetryCount(prev => prev + 1);
          } else {
            hasCheckedRef.current = true;
          }
        } finally {
          setIsCheckingSession(false);
        }
      }, 400 * (retryCount + 1)); // Progressive delay: 400ms, 800ms, 1200ms
      
      return () => clearTimeout(timer);
    }
  }, [isInitialized, isLoading, user, authUser, retryCount]);
  
  // Show loading while initializing or checking session
  if ((isLoading && !isInitialized) || isCheckingSession) {
    return (
      <div className="flex justify-center items-center h-screen">
        <div className="loading loading-spinner loading-lg text-primary"></div>
      </div>
    );
  }
  
  // Check for Supabase authentication - check both AuthContext and direct session
  const isAuthenticated = user || authUser;
  
  // Only redirect if we're sure there's no session after initialization and all retries
  // This prevents premature redirects when new tabs are still syncing
  if (!isAuthenticated && isInitialized && retryCount >= 2) {
    return <Navigate to="/login" replace />;
  }
  
  // If not authenticated but still initializing, show loading
  if (!isAuthenticated && !isInitialized) {
    return (
      <div className="flex justify-center items-center h-screen">
        <div className="loading loading-spinner loading-lg text-primary"></div>
      </div>
    );
  }
  
  return <>{children}</>;
};

export default ProtectedRoute; 