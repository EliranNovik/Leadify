import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthContext } from '../contexts/AuthContext';

/**
 * ProtectedRoute — uses AuthContext only (no extra auth round-trips).
 * With sync session hydrate, returning users see the app on first paint.
 */
const ProtectedRoute: React.FC<{ user: any; children: React.ReactNode }> = ({ children }) => {
  const { user, sessionCheckComplete } = useAuthContext();

  if (user) {
    return <>{children}</>;
  }

  if (sessionCheckComplete && !user) {
    return <Navigate to="/login" replace />;
  }

  // Rare: auth keys exist but Supabase not hydrated yet — thin bar + tiny spinner, no “loading session” text
  return (
    <div className="relative min-h-[20vh]" aria-busy="true" aria-label="Loading">
      <div className="fixed top-0 left-0 right-0 z-[100] h-0.5 bg-primary/25 overflow-hidden pointer-events-none">
        <div
          className="h-full w-1/4 bg-primary/60 rounded-r-full"
          style={{ animation: 'auth-shimmer 1s ease-in-out infinite' }}
        />
      </div>
      <style>{`
        @keyframes auth-shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(500%); }
        }
      `}</style>
      <div className="flex justify-center pt-14 opacity-50">
        <span className="loading loading-spinner loading-sm text-primary" />
      </div>
    </div>
  );
};

export default ProtectedRoute;
