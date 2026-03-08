import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthContext } from '../contexts/AuthContext';

/**
 * ProtectedRoute - Relies on AuthContext.
 * Redirects to login only after Supabase has reported session state (sessionCheckComplete && no user).
 * Never redirects before INITIAL_SESSION is handled, so reloads stay on the app when session is valid.
 */
const ProtectedRoute: React.FC<{ user: any; children: React.ReactNode }> = ({ children }) => {
  const { user, sessionCheckComplete } = useAuthContext();

  if (user) {
    return <>{children}</>;
  }

  if (sessionCheckComplete && !user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
