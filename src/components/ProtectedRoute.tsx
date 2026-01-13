import React, { useState, useEffect, useRef } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthContext } from '../contexts/AuthContext';
import { supabase, isAuthError, sessionManager, handleSessionExpiration } from '../lib/supabase';

const ProtectedRoute: React.FC<{ user: any; children: React.ReactNode }> = ({ user, children }) => {
  const { isLoading, isInitialized, user: authUser } = useAuthContext();
  const [retryCount, setRetryCount] = useState(0);
  const [isCheckingSession, setIsCheckingSession] = useState(false);
  const [hasCompletedImmediateCheck, setHasCompletedImmediateCheck] = useState(false);
  const hasCheckedRef = useRef(false);
  
  // Give more time for session initialization, especially for new tabs
  useEffect(() => {
    // Only retry if we're initialized but have no user, and haven't checked too many times
    // Reduced retries for faster security (was 3, now 2)
    if (isInitialized && !isLoading && !user && !authUser && retryCount < 2 && !hasCheckedRef.current) {
      hasCheckedRef.current = true;
      // Retry session check for new tabs that might not have synced yet
      const timer = setTimeout(async () => {
        setIsCheckingSession(true);
        try {
          // Check session directly from Supabase
          const { data: { session }, error } = await supabase.auth.getSession();
          
          // If it's an auth error, redirect immediately
          if (error && isAuthError(error)) {
            console.error('Auth error in ProtectedRoute - redirecting immediately');
            hasCheckedRef.current = true;
            // Session expired - redirect immediately
            const isExpired = await sessionManager.checkAndHandleExpiration();
            return;
          }
          
          if (session?.user && !error) {
            // Check if session is expired
            if (sessionManager.isSessionExpired(session)) {
              console.error('Session expired in ProtectedRoute - redirecting immediately');
              hasCheckedRef.current = true;
              await sessionManager.checkAndHandleExpiration();
              return;
            }
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
          // If it's an auth error, redirect immediately
          if (isAuthError(error)) {
            hasCheckedRef.current = true;
            await sessionManager.checkAndHandleExpiration();
            return;
          }
          // On other errors, give it one more chance
          if (retryCount < 2) {
            hasCheckedRef.current = false;
            setRetryCount(prev => prev + 1);
          } else {
            hasCheckedRef.current = true;
          }
        } finally {
          setIsCheckingSession(false);
        }
      }, retryCount === 0 ? 100 : 400 * retryCount); // First check after 100ms, then 400ms, 800ms
      
      return () => clearTimeout(timer);
    }
  }, [isInitialized, isLoading, user, authUser, retryCount]);
  
  // Check for Supabase authentication - check both AuthContext and direct session
  const isAuthenticated = user || authUser;
  
  // Immediate session check when no user is detected
  useEffect(() => {
    if (!isAuthenticated && isInitialized && !isLoading && !hasCompletedImmediateCheck) {
      const immediateCheck = async () => {
        // Set a timeout to prevent infinite waiting (max 3 seconds)
        const timeoutId = setTimeout(() => {
          console.warn('ProtectedRoute auth check timeout - marking as complete');
          setHasCompletedImmediateCheck(true);
        }, 3000);
        
        try {
          // Small delay to allow coordination with other tabs
          await new Promise(resolve => setTimeout(resolve, 50));
          
          // Check if another tab is redirecting
          const redirectingUntil = typeof window !== 'undefined' ? localStorage.getItem('supabase_auth_redirecting') : null;
          if (redirectingUntil) {
            const until = parseInt(redirectingUntil, 10);
            if (Date.now() < until) {
              // Another tab is handling redirect, wait a bit but not too long
              await new Promise(resolve => setTimeout(resolve, 300));
            } else {
              // Stale flag, clear it
              if (typeof window !== 'undefined') {
                localStorage.removeItem('supabase_auth_redirecting');
              }
            }
          }
          
          const { data: { session }, error } = await supabase.auth.getSession();
          if (error && isAuthError(error)) {
            console.error('Auth error in ProtectedRoute immediate check - redirecting');
            clearTimeout(timeoutId);
            await sessionManager.checkAndHandleExpiration();
            return;
          }
          if (!session || !session.user) {
            // No session - redirect immediately
            console.log('No session in ProtectedRoute - redirecting immediately');
            clearTimeout(timeoutId);
            await handleSessionExpiration();
            return;
          } else if (sessionManager.isSessionExpired(session)) {
            // Session expired - redirect immediately
            console.log('Session expired in ProtectedRoute - redirecting immediately');
            clearTimeout(timeoutId);
            await sessionManager.checkAndHandleExpiration();
            return;
          }
          // Session is valid - mark check as complete
          clearTimeout(timeoutId);
          setHasCompletedImmediateCheck(true);
        } catch (error) {
          console.error('Error in ProtectedRoute immediate check:', error);
          clearTimeout(timeoutId);
          if (isAuthError(error)) {
            await sessionManager.checkAndHandleExpiration();
            return;
          }
          // On non-auth errors, mark as complete (might be network issue)
          setHasCompletedImmediateCheck(true);
        }
      };
      // Run check with small delay to coordinate with other tabs
      immediateCheck();
    } else if (isAuthenticated) {
      // If authenticated, mark check as complete immediately
      setHasCompletedImmediateCheck(true);
    }
  }, [isAuthenticated, isInitialized, isLoading, hasCompletedImmediateCheck]);
  
  // Show loading while initializing or checking session
  // CRITICAL: Show loading immediately if not authenticated and initialized (prevents flash of content)
  if ((isLoading && !isInitialized) || isCheckingSession) {
    return (
      <div className="flex justify-center items-center h-screen bg-white">
        <div className="text-center">
          <div className="loading loading-spinner loading-lg text-primary"></div>
          <p className="mt-4 text-gray-600">Verifying authentication...</p>
        </div>
      </div>
    );
  }
  
  // If not authenticated and initialized, show loading while checking (prevents flash)
  // Only redirect after we've confirmed no session
  if (!isAuthenticated && isInitialized) {
    // Show loading while we're still checking (prevents flash of content)
    if (!hasCompletedImmediateCheck || retryCount < 1) {
      return (
        <div className="flex justify-center items-center h-screen bg-white">
          <div className="text-center">
            <div className="loading loading-spinner loading-lg text-primary"></div>
            <p className="mt-4 text-gray-600">Verifying authentication...</p>
          </div>
        </div>
      );
    }
    // After checking, redirect if still no session
    return <Navigate to="/login" replace />;
  }
  
  // If not authenticated but still initializing, show loading
  if (!isAuthenticated && !isInitialized) {
    return (
      <div className="flex justify-center items-center h-screen bg-white">
        <div className="text-center">
          <div className="loading loading-spinner loading-lg text-primary"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }
  
  return <>{children}</>;
};

export default ProtectedRoute; 