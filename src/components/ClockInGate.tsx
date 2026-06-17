import React, { lazy, Suspense, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRightOnRectangleIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useAuthContext } from '../contexts/AuthContext';
import { useOptionalClockInGate } from '../hooks/useClockInGate';
import { useSignOutWithClockOut } from '../hooks/useSignOutWithClockOut';
import RMQMessagesPage from '../pages/RMQMessagesPage';
import ClockInModal from './ClockInModal';
import LoginHeroBackground from './LoginHeroBackground';
import ClockInGateHelpBox from './ClockInGateHelpBox';
import ClockInGateVideos from './ClockInGateVideos';
import ClockInGateHeader from './ClockInGateHeader';

const LazyCalendarPage = lazy(() => import('./CalendarPage'));

const CLOCK_IN_GATE_THEME_COLOR = '#1a1a1a';

function GateCheckPendingLoader() {
  return (
    <div className="relative min-h-[20vh]" aria-busy="true" aria-label="Checking clock-in status">
      <div className="fixed top-0 left-0 right-0 z-[100] h-0.5 bg-primary/25 overflow-hidden pointer-events-none">
        <div
          className="h-full w-1/4 bg-primary/60 rounded-r-full"
          style={{ animation: 'clockin-gate-shimmer 1s ease-in-out infinite' }}
        />
      </div>
      <style>{`
        @keyframes clockin-gate-shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(500%); }
        }
      `}</style>
      <div className="flex justify-center pt-14 opacity-50">
        <span className="loading loading-spinner loading-sm text-primary" />
      </div>
    </div>
  );
}

type ClockInGateProps = {
  children: React.ReactNode;
};

const ClockInGate: React.FC<ClockInGateProps> = ({ children }) => {
  const { user } = useAuthContext();
  const gate = useOptionalClockInGate();
  const { requestSignOut, signOutModal } = useSignOutWithClockOut({ redirectOnSignOut: false });
  const [isMessagingOpen, setIsMessagingOpen] = useState(false);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);

  const status = gate?.status ?? 'loading';
  const employeeId = gate?.employeeId ?? null;
  const isGateOpen = gate?.isGateOpen ?? false;
  const refreshClockInGate = gate?.refreshClockInGate ?? (async () => {});

  if (!gate) {
    return (
      <div className="flex justify-center pt-14 opacity-50" aria-busy="true">
        <span className="loading loading-spinner loading-sm text-primary" />
      </div>
    );
  }

  useEffect(() => {
    const html = document.documentElement;
    const gateScreenActive = !isGateOpen && status !== 'loading';

    if (!gateScreenActive) {
      html.classList.remove('login-page-active');
      return;
    }

    const metaTheme = document.querySelector('meta[name="theme-color"]');
    const prevTheme = metaTheme?.getAttribute('content') ?? '#ffffff';
    const prevOverflow = document.body.style.overflow;

    html.classList.add('login-page-active');
    metaTheme?.setAttribute('content', CLOCK_IN_GATE_THEME_COLOR);
    document.body.style.overflow = 'hidden';

    return () => {
      html.classList.remove('login-page-active');
      metaTheme?.setAttribute('content', prevTheme);
      document.body.style.overflow = prevOverflow;
    };
  }, [isGateOpen, status]);

  if (isGateOpen) {
    return <>{children}</>;
  }

  if (status === 'loading') {
    return <GateCheckPendingLoader />;
  }

  const handleSignOut = () => {
    void requestSignOut();
  };

  const handleClockInSuccess = () => {
    void refreshClockInGate();
  };

  const showClockInChrome = status === 'blocked' && employeeId != null;

  const showGateHeader = !isGateOpen;

  const gateBody = (() => {
    if (status === 'no_employee') {
      return (
        <div className="w-full max-w-sm p-6 md:p-9 bg-[rgba(20,20,20,0.30)] backdrop-blur-[16px] border border-[rgba(255,255,255,0.08)] shadow-[0_20px_60px_rgba(0,0,0,0.45)] rounded-2xl text-center text-white">
          <h2 className="text-xl font-semibold tracking-wide" style={{ fontFamily: "'Playfair Display', 'Libre Baskerville', serif" }}>
            Account not linked
          </h2>
          <p className="mt-3 text-sm text-white/75 leading-relaxed">
            Your user account is not linked to an employee profile, so you cannot clock in.
            Please contact your administrator.
          </p>
          <button
            type="button"
            className="btn btn-outline btn-sm gap-2 mt-6 border-white/30 text-white hover:bg-white/10 hover:border-white/50"
            onClick={() => void handleSignOut()}
          >
            <ArrowRightOnRectangleIcon className="w-5 h-5" />
            Sign out
          </button>
        </div>
      );
    }

    if (showClockInChrome && user?.id) {
      return (
        <ClockInModal
          isOpen
          embedded
          required
          employeeId={employeeId}
          userId={user.id}
          onClose={() => {}}
          onClockInSuccess={handleClockInSuccess}
          onSignOut={() => void handleSignOut()}
        />
      );
    }

    return (
      <div className="flex flex-col items-center text-center gap-4 px-6">
        <span className="loading loading-spinner loading-lg text-[#d4af37]" aria-hidden />
      </div>
    );
  })();

  return createPortal(
    <div
      className="login-page fixed inset-0 z-[200] flex flex-col overflow-hidden min-h-[100dvh] min-h-[100svh]"
      role="dialog"
      aria-modal="true"
      aria-label="Clock in required"
    >
      <LoginHeroBackground />

      {showGateHeader && (
        <ClockInGateHeader
          employeeId={employeeId}
          onSignOut={() => void handleSignOut()}
          onOpenMessaging={() => setIsMessagingOpen(true)}
          onOpenCalendar={() => setIsCalendarOpen(true)}
        />
      )}

      <RMQMessagesPage
        isOpen={isMessagingOpen}
        onClose={() => setIsMessagingOpen(false)}
      />

      {isCalendarOpen && (
        <div className="fixed inset-0 z-[300] flex flex-col bg-white overflow-hidden">
          <div
            className="shrink-0 flex items-center justify-between gap-3 px-4 py-2 border-b border-gray-200 bg-white"
            style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top, 0px))' }}
          >
            <h2 className="text-lg font-semibold text-gray-900">Calendar</h2>
            <button
              type="button"
              onClick={() => setIsCalendarOpen(false)}
              className="btn btn-ghost btn-circle btn-sm"
              aria-label="Close calendar"
            >
              <XMarkIcon className="w-6 h-6" />
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-auto">
            <Suspense
              fallback={(
                <div className="flex justify-center items-center h-48">
                  <span className="loading loading-spinner loading-lg text-primary" />
                </div>
              )}
            >
              <LazyCalendarPage />
            </Suspense>
          </div>
        </div>
      )}

      <div
        className="relative z-10 flex flex-1 flex-col w-full min-h-0 overflow-hidden"
        style={{
          paddingTop: 'max(3.5rem, calc(env(safe-area-inset-top, 0px) + 2.75rem))',
          paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))',
        }}
      >
        <div className="flex flex-1 min-h-0 w-full items-center gap-3 lg:gap-6 px-3 md:px-6 lg:px-8">
          {showClockInChrome && (
            <aside className="hidden lg:flex w-[min(18rem,22vw)] shrink-0 items-center justify-end min-h-0 self-center py-2 pointer-events-none">
              <ClockInGateVideos placement="desktop" />
            </aside>
          )}

          <div className="flex flex-1 flex-col items-center justify-center min-h-0 min-w-0 py-2">
            {gateBody}
          </div>

          {showClockInChrome && (
            <aside className="hidden lg:flex w-[min(18rem,22vw)] shrink-0 items-center justify-start min-h-0 self-center py-2 pointer-events-none">
              <ClockInGateHelpBox placement="desktop" />
            </aside>
          )}
        </div>

        {showClockInChrome && (
          <div
            className="lg:hidden shrink-0 flex flex-col gap-3 px-3 pb-2 pointer-events-none"
            style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom, 0px))' }}
          >
            <ClockInGateVideos placement="mobile" />
            <ClockInGateHelpBox placement="mobile" />
          </div>
        )}
      </div>

      {signOutModal}
    </div>,
    document.body,
  );
};

export default ClockInGate;
