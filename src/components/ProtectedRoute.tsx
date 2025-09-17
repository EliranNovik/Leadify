import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthContext } from '../contexts/AuthContext';

const ProtectedRoute: React.FC<{ user: any; children: React.ReactNode }> = ({ user, children }) => {
  const { isLoading, isInitialized, user: authUser } = useAuthContext();
  
  // Show loading while auth is initializing
  if (isLoading || !isInitialized) {
    return (
      <div className="flex justify-center items-center h-screen">
        <div className="loading loading-spinner loading-lg text-primary"></div>
      </div>
    );
  }
  
  // Only check for Supabase authentication - no Microsoft fallback
  const isAuthenticated = user || authUser;
  
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  
  return <>{children}</>;
};

export default ProtectedRoute; 