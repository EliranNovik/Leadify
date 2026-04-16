import React from 'react';
import { Navigate } from 'react-router-dom';
import { useExternalUser } from '../hooks/useExternalUser';
import ExternalUserDashboard from '../components/ExternalUserDashboard';

/**
 * External-only home: separate from staff `Dashboard` to avoid loading that tree.
 */
export default function ExternalUserHomePage() {
  const { isExternalUser, isLoading, userName, userImage } = useExternalUser();

  if (isLoading) {
    return (
      <div className="flex min-h-[calc(100dvh-3.5rem)] w-full items-center justify-center bg-base-100">
        <span className="loading loading-spinner loading-md text-primary" />
      </div>
    );
  }

  if (!isExternalUser) {
    return <Navigate to="/" replace />;
  }

  return <ExternalUserDashboard userName={userName} userImage={userImage} />;
}
