import React, { Suspense, lazy } from 'react';
import { Navigate } from 'react-router-dom';
import { useExternalUser } from '../hooks/useExternalUser';

const LazyDashboard = lazy(() => import('../components/Dashboard'));

/**
 * Root route (`/`): resolves external vs internal user first so the heavy
 * staff `Dashboard` chunk never mounts for external users (no flash).
 */
export default function HomeEntryPage() {
  const { isExternalUser, isLoading } = useExternalUser();

  if (isLoading) {
    return (
      <div className="flex min-h-[calc(100dvh-3.5rem)] w-full items-center justify-center bg-base-100">
        <span className="loading loading-spinner loading-md text-primary" />
      </div>
    );
  }

  if (isExternalUser) {
    return <Navigate to="/external-home" replace />;
  }

  return (
    <Suspense
      fallback={
        <div className="flex min-h-[calc(100dvh-3.5rem)] w-full items-center justify-center bg-base-100">
          <span className="loading loading-spinner loading-md text-primary" />
        </div>
      }
    >
      <LazyDashboard />
    </Suspense>
  );
}
