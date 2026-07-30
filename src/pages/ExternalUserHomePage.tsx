import React from 'react';
import { Navigate } from 'react-router-dom';
import { useExternalUser } from '../hooks/useExternalUser';
import ExternalUserDashboard from '../components/ExternalUserDashboard';

/**
 * External-only home: separate from staff `Dashboard` to avoid loading that tree.
 */
export default function ExternalUserHomePage() {
  const { isExternalUser, isLoading, isResolved, userName, userImage } = useExternalUser();

  if (isLoading) {
    return (
      <div className="flex min-h-[calc(100dvh-3.5rem)] w-full items-center justify-center bg-base-100">
        <span className="loading loading-spinner loading-md text-primary" />
      </div>
    );
  }

  if (!isResolved) {
    return (
      <div className="flex min-h-[calc(100dvh-3.5rem)] flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="font-medium text-base-content">We couldn’t load your user profile.</p>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => window.location.reload()}>
          Retry
        </button>
      </div>
    );
  }

  if (!isExternalUser) {
    return <Navigate to="/" replace />;
  }

  return <ExternalUserDashboard userName={userName} userImage={userImage} />;
}
