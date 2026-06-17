import React, { Suspense, lazy, useCallback, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useExternalUser } from '../hooks/useExternalUser';
import { useOptionalClockInGate } from '../hooks/useClockInGate';
import PageLoader from '../components/PageLoader';
import DashboardWelcomeModal from '../components/DashboardWelcomeModal';
import { DashboardWelcomeReadyProvider } from '../contexts/DashboardWelcomeReadyContext';
import { clearDashboardWelcomePending, hasDashboardWelcomePending } from '../lib/dashboardWelcomeSession';

// Wrap the lazy import so we can detect when the chunk has resolved (UI mounted).
const LazyDashboard = lazy(() => import('../components/Dashboard'));

/**
 * Root route (`/`): resolves external vs internal user first so the heavy
 * staff `Dashboard` chunk never mounts for external users (no flash).
 */
export default function HomeEntryPage() {
  const { isExternalUser, isLoading } = useExternalUser();
  const gate = useOptionalClockInGate();
  const isGateOpen = gate?.isGateOpen ?? true;
  const [welcomeActive, setWelcomeActive] = useState(() => hasDashboardWelcomePending());
  // Ready as soon as the Dashboard UI renders — no waiting for data fetches.
  const [uiMounted, setUiMounted] = useState(false);

  const handleWelcomeFinished = useCallback(() => {
    setWelcomeActive(false);
  }, []);

  // noop — kept so DashboardWelcomeReadyProvider still works without errors
  const handleDepartmentPerformanceReady = useCallback(() => {}, []);

  if (!isLoading && isExternalUser) {
    clearDashboardWelcomePending();
    return <Navigate to="/external-home" replace />;
  }

  const showWelcomeOverlay = welcomeActive && isGateOpen;

  return (
    <>
      {showWelcomeOverlay && (
        <DashboardWelcomeModal
          ready={uiMounted}
          onFinished={handleWelcomeFinished}
        />
      )}
      <DashboardWelcomeReadyProvider onReady={handleDepartmentPerformanceReady}>
        {isLoading ? <PageLoader /> : (
          <Suspense fallback={showWelcomeOverlay ? null : <PageLoader />}>
            {/* UiMountDetector fires as soon as the lazy chunk renders */}
            {!uiMounted && <UiMountDetector onMounted={() => setUiMounted(true)} />}
            <LazyDashboard />
          </Suspense>
        )}
      </DashboardWelcomeReadyProvider>
    </>
  );
}

/** Tiny component that calls onMounted on first render inside Suspense. */
function UiMountDetector({ onMounted }: { onMounted: () => void }) {
  // Use a layout effect so it fires synchronously after DOM paint.
  React.useLayoutEffect(() => {
    onMounted();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
