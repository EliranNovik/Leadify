import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthContext } from '../contexts/AuthContext';

/**
 * ProtectedRoute - Simple wrapper that relies entirely on AuthContext
 * No redundant session checks - AuthContext handles all authentication state
 */
const ProtectedRoute: React.FC<{ user: any; children: React.ReactNode }> = ({ children }) => {
  const { user, isLoading, isInitialized } = useAuthContext();
  
  // Only show loading if we're truly not initialized (first time check)
  // If initialized but still loading (background refresh), show content
  // This prevents annoying loading screens on every page navigation
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
  
  // If initialized but no user, redirect to login
  // Don't wait for isLoading if we're already initialized
  if (!user && !isLoading) {
    return <Navigate to="/login" replace />;
  }
  
  // If we have a user or are still loading in background, render children
  // This allows pages to render immediately if user exists, even if still loading details
  return <>{children}</>;
};

export default ProtectedRoute;
