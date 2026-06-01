import React, { Suspense, lazy, useCallback, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useExternalUser } from '../hooks/useExternalUser';
import PageLoader from '../components/PageLoader';
import DashboardWelcomeModal from '../components/DashboardWelcomeModal';
import { DashboardWelcomeReadyProvider } from '../contexts/DashboardWelcomeReadyContext';
import { clearDashboardWelcomePending, hasDashboardWelcomePending } from '../lib/dashboardWelcomeSession';

const LazyDashboard = lazy(() => import('../components/Dashboard'));

/**
 * Root route (`/`): resolves external vs internal user first so the heavy
 * staff `Dashboard` chunk never mounts for external users (no flash).
 */
export default function HomeEntryPage() {
  const { isExternalUser, isLoading } = useExternalUser();
  const [welcomeActive, setWelcomeActive] = useState(() => hasDashboardWelcomePending());
  const [departmentPerformanceReady, setDepartmentPerformanceReady] = useState(false);

  const handleWelcomeFinished = useCallback(() => {
    setWelcomeActive(false);
  }, []);

  const handleDepartmentPerformanceReady = useCallback(() => {
    setDepartmentPerformanceReady(true);
  }, []);

  if (!isLoading && isExternalUser) {
    clearDashboardWelcomePending();
    return <Navigate to="/external-home" replace />;
  }

  const showWelcomeOverlay = welcomeActive;

  return (
    <>
      {showWelcomeOverlay && (
        <DashboardWelcomeModal
          ready={departmentPerformanceReady}
          onFinished={handleWelcomeFinished}
        />
      )}
      <DashboardWelcomeReadyProvider onReady={handleDepartmentPerformanceReady}>
        {isLoading ? null : (
          <Suspense fallback={showWelcomeOverlay ? null : <PageLoader />}>
            <LazyDashboard />
          </Suspense>
        )}
      </DashboardWelcomeReadyProvider>
    </>
  );
}
