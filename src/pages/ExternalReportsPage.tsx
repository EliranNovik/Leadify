import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { ChartBarIcon } from '@heroicons/react/24/outline';
import { useExternalUser } from '../hooks/useExternalUser';
import { EXTERNAL_USER_PAGE_INNER } from '../lib/externalUserLayout';
import MarketingDashboardReport from './MarketingDashboardReport';
import { fetchCurrentUserExternSourceIds } from '../lib/externalUserSources';

export default function ExternalReportsPage() {
  const { isExternalUser, isLoading } = useExternalUser();
  const [lockedSourceIds, setLockedSourceIds] = useState<string[] | null>(null);
  const [sourcesError, setSourcesError] = useState<string | null>(null);

  useEffect(() => {
    if (!isExternalUser) return;
    let cancelled = false;
    (async () => {
      try {
        const ids = await fetchCurrentUserExternSourceIds();
        if (!cancelled) setLockedSourceIds(ids);
      } catch (err) {
        console.error('[ExternalReports] source load failed:', err);
        if (!cancelled) {
          setSourcesError('Could not load your assigned marketing sources.');
          setLockedSourceIds([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isExternalUser]);

  if (isLoading || (isExternalUser && lockedSourceIds === null && !sourcesError)) {
    return (
      <div className="flex min-h-[calc(100dvh-3.5rem)] w-full items-center justify-center bg-base-100">
        <span className="loading loading-spinner loading-md text-primary" />
      </div>
    );
  }

  if (!isExternalUser) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className={`min-h-[calc(100dvh-3.5rem)] w-full bg-white ${EXTERNAL_USER_PAGE_INNER} py-8 md:py-10`}>
      <div className="w-full space-y-8 pb-12">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-base-content md:text-3xl">Reports</h1>
          <p className="mt-2 text-sm text-base-content/60">
            Marketing performance for your assigned lead sources.
          </p>
        </div>

        {sourcesError && (
          <div className="alert alert-error text-sm">
            <span>{sourcesError}</span>
          </div>
        )}

        {!sourcesError && lockedSourceIds && lockedSourceIds.length === 0 && (
          <div className="rounded-2xl border border-dashed border-base-300 bg-base-200/30 px-6 py-12 text-center">
            <ChartBarIcon className="mx-auto mb-3 h-10 w-10 text-base-content/35" />
            <p className="font-medium text-base-content/80">No sources assigned</p>
            <p className="mt-2 text-sm text-base-content/55">
              Contact our office to connect marketing sources to your account.
            </p>
          </div>
        )}

        {lockedSourceIds && lockedSourceIds.length > 0 && (
          <div className="w-full min-w-0">
            <MarketingDashboardReport variant="external" lockedSourceIds={lockedSourceIds} />
          </div>
        )}
      </div>
    </div>
  );
}
