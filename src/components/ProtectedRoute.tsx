import React from 'react';
import { Navigate } from 'react-router-dom';
import { useMsal } from '@azure/msal-react';
import { useAuthContext } from '../contexts/AuthContext';

const ProtectedRoute: React.FC<{ user: any; children: React.ReactNode }> = ({ user, children }) => {
  const { instance } = useMsal();
  const msalAccount = instance.getActiveAccount();
  const { isLoading, isInitialized, user: authUser } = useAuthContext();
  
  // Show loading while auth is initializing
  if (isLoading || !isInitialized) {
    return (
      <div className="flex justify-center items-center h-screen">
        <div className="loading loading-spinner loading-lg text-primary"></div>
      </div>
    );
  }
  
  // Check for any type of authentication
  const isAuthenticated = user || msalAccount || authUser;
  
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  
  return <>{children}</>;
};

export default ProtectedRoute; 