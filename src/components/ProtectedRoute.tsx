import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthContext } from '../contexts/AuthContext';

/**
 * ProtectedRoute - Relies on AuthContext.
 * Redirects to login only after Supabase has reported session state (sessionCheckComplete && no user).
 * Shows a brief loading state until session check completes to avoid flashing protected content then redirect.
 */
const ProtectedRoute: React.FC<{ user: any; children: React.ReactNode }> = ({ children }) => {
  const { user, sessionCheckComplete } = useAuthContext();

  if (user) {
    return <>{children}</>;
  }

  if (sessionCheckComplete && !user) {
    return <Navigate to="/login" replace />;
  }

  // Session not yet determined: show loading to avoid flash of dashboard then redirect
  return (
    <div className="min-h-screen flex items-center justify-center bg-base-200">
      <span className="loading loading-spinner loading-lg text-primary" />
    </div>
  );
};

export default ProtectedRoute;
