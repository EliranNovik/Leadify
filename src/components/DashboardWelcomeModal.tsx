import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  clearDashboardWelcomePending,
  readDashboardWelcomePending,
  type DashboardWelcomeSession,
} from '../lib/dashboardWelcomeSession';

const MIN_VISIBLE_MS = 150;
const MAX_VISIBLE_MS = 12_000;

type DashboardWelcomeModalProps = {
  /** True when the department performance (Agreement signed) table has finished its initial load. */
  ready: boolean;
  onFinished?: () => void;
};

const DashboardWelcomeModal: React.FC<DashboardWelcomeModalProps> = ({ ready, onFinished }) => {
  const [session, setSession] = useState<DashboardWelcomeSession | null>(() => readDashboardWelcomePending());
  const [dismissing, setDismissing] = useState(false);

  useEffect(() => {
    if (!session || !ready) return;

    const elapsed = Date.now() - session.startedAt;
    const waitMs = Math.max(0, MIN_VISIBLE_MS - elapsed);

    const finish = () => {
      setDismissing(true);
      window.setTimeout(() => {
        clearDashboardWelcomePending();
        setSession(null);
        onFinished?.();
      }, 180);
    };

    const timer = window.setTimeout(finish, waitMs);

    return () => window.clearTimeout(timer);
  }, [session, ready, onFinished]);

  useEffect(() => {
    if (!session) return;
    const failSafe = window.setTimeout(() => {
      setDismissing(true);
      window.setTimeout(() => {
        clearDashboardWelcomePending();
        setSession(null);
        onFinished?.();
      }, 180);
    }, MAX_VISIBLE_MS);
    return () => window.clearTimeout(failSafe);
  }, [session, onFinished]);

  if (!session) return null;

  const firstName = session.name.trim().split(/\s+/)[0] || session.name;

  return createPortal(
    <div
      className={`fixed inset-0 z-[200] flex flex-col items-center justify-center bg-white transition-opacity duration-300 dark:bg-white ${
        dismissing ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="dashboard-welcome-title"
      aria-busy={!ready}
    >
      <div className="flex flex-col items-center text-center gap-5 px-6 max-w-sm">
        {session.imageUrl ? (
          <img
            src={session.imageUrl}
            alt=""
            className="h-20 w-20 rounded-full object-cover ring-2 ring-gray-200"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <span className="inline-flex h-20 w-20 items-center justify-center rounded-full bg-gray-100 text-2xl font-semibold text-gray-700">
            {session.name.trim().slice(0, 2).toUpperCase()}
          </span>
        )}

        <div>
          <h2 id="dashboard-welcome-title" className="text-2xl font-semibold tracking-tight text-gray-900">
            Welcome back{firstName ? `, ${firstName}` : ''}
          </h2>
          <p className="mt-2 text-sm text-gray-500">Loading your dashboard…</p>
        </div>

        <span className="loading loading-spinner loading-lg text-primary" aria-hidden />
      </div>
    </div>,
    document.body
  );
};

export default DashboardWelcomeModal;
