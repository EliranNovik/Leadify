import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import PublicPageContactButtons from '../components/public/PublicPageContactButtons';
import ClientBookingScheduler, { portalMeetingsUrl } from '../components/client-booking/ClientBookingScheduler';
import { PortalCard, PortalLoading, PORTAL_SHELL_CLASS } from './portal/components/portalTheme';

function BookingShell({
  leadRef,
  children,
}: {
  leadRef?: string | null;
  children: React.ReactNode;
}) {
  const portalUrl = portalMeetingsUrl(leadRef);
  const year = new Date().getFullYear();

  return (
    <div className={`${PORTAL_SHELL_CLASS} flex min-h-[100dvh] flex-col`}>
      <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/95 backdrop-blur-md">
        <div className="flex h-16 w-full items-center justify-between gap-4 px-4 md:h-20 md:px-10">
          <img
            src="/DPL-LOGO1.png"
            alt="Decker Pex & Co Law Offices"
            className="h-10 w-auto max-w-[160px] object-contain md:h-11"
          />
          <div className="flex items-center gap-2">
            {portalUrl ? (
              <Link
                to={portalUrl}
                className="btn btn-ghost btn-sm rounded-full font-medium text-base-content/70"
              >
                Client portal
              </Link>
            ) : null}
          </div>
        </div>
      </header>

      <main className="w-full flex-1 px-2 py-6 pb-[max(2.5rem,env(safe-area-inset-bottom,0px))] md:px-10 md:py-8 md:pb-12">
        <div className="mx-auto w-full max-w-6xl">{children}</div>
      </main>

      <footer className="shrink-0 border-t border-gray-200/80 bg-white/60 px-4 py-4 text-center text-xs text-base-content/40 md:text-sm">
        © RMQ 2.0 {year}
      </footer>

      <PublicPageContactButtons />
    </div>
  );
}

const PublicBookingPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [leadRef, setLeadRef] = useState<string | null>(null);

  if (!token) {
    return (
      <BookingShell>
        <PortalCard className="mx-auto max-w-lg text-center">
          <h1 className="text-xl font-semibold text-gray-900">Booking unavailable</h1>
          <p className="mt-2 text-sm text-base-content/55">Invalid booking link</p>
        </PortalCard>
      </BookingShell>
    );
  }

  return (
    <BookingShell leadRef={leadRef}>
      <React.Suspense fallback={<PortalLoading className="py-24" />}>
        <ClientBookingScheduler
          bookingToken={token}
          variant="public"
          onLeadRefLoaded={setLeadRef}
        />
      </React.Suspense>
    </BookingShell>
  );
};

export default PublicBookingPage;
