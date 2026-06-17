import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRightOnRectangleIcon } from '@heroicons/react/24/outline';
import { useAuthContext } from '../contexts/AuthContext';
import { useOptionalClockInGate } from '../hooks/useClockInGate';
import { useSignOutWithClockOut } from '../hooks/useSignOutWithClockOut';
import ClockInModal from './ClockInModal';
import LoginHeroBackground from './LoginHeroBackground';
import ClockInGateHelpBox from './ClockInGateHelpBox';
import ClockInGateHeader from './ClockInGateHeader';

const CLOCK_IN_GATE_THEME_COLOR = '#1a1a1a';

type ClockInGateProps = {
  children: React.ReactNode;
};

const ClockInGate: React.FC<ClockInGateProps> = ({ children }) => {
  const { user } = useAuthContext();
  const gate = useOptionalClockInGate();
  const { requestSignOut, signOutModal } = useSignOutWithClockOut({ redirectOnSignOut: false });

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
    const gateScreenActive = !isGateOpen;

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
  }, [isGateOpen]);

  if (isGateOpen) {
    return <>{children}</>;
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
    if (status === 'loading') {
      return (
        <div className="flex flex-col items-center text-center gap-4 px-6">
          <span className="loading loading-spinner loading-lg text-[#d4af37]" aria-hidden />
          <p className="text-sm text-white/80">Checking your clock-in status…</p>
        </div>
      );
    }

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
        />
      )}

      <div
        className="relative z-10 flex flex-1 flex-col items-center justify-center w-full px-4"
        style={{
          paddingTop: 'max(3.5rem, calc(env(safe-area-inset-top, 0px) + 2.75rem))',
          paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))',
        }}
      >
        {gateBody}
      </div>

      {showClockInChrome && (
        <div
          className="absolute z-20 right-0 bottom-0 p-4 md:p-6 pointer-events-none"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))' }}
        >
          <ClockInGateHelpBox />
        </div>
      )}

      {signOutModal}
    </div>,
    document.body,
  );
};

export default ClockInGate;
