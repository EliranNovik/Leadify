import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import MeetingTab from '../components/client-tabs/MeetingTab';
import MicrosoftSignInBox from '../components/meeting/MicrosoftSignInBox';
import { fetchClientForMeetingSchedule } from '../lib/fetchScheduleMeetingClient';
import {
  getClientPagePathFromClient,
  safeDecodeRouteParam,
} from '../lib/meetingScheduleNavigation';
import type { Client } from '../types/client';

/**
 * Desktop reschedule-meeting route. Same contacts-style layout as schedule-meeting.
 * Mobile entry points still use the native bottom sheet from MeetingTab / Clients.
 */
const RescheduleMeetingPage: React.FC = () => {
  const { lead_number: rawLeadNumber = '' } = useParams<{ lead_number: string }>();
  const lead_number = safeDecodeRouteParam(rawLeadNumber);
  const navigate = useNavigate();
  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const clientPath = useMemo(
    () => getClientPagePathFromClient(client, lead_number),
    [client, lead_number],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchClientForMeetingSchedule(lead_number);
        if (cancelled) return;
        if (!result) {
          setError('Lead not found.');
          setClient(null);
        } else {
          setClient(result);
        }
      } catch (e) {
        if (cancelled) return;
        console.error('RescheduleMeetingPage', e);
        setError('Failed to load lead.');
        setClient(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lead_number]);

  const goToClient = () => {
    navigate(clientPath, { replace: true });
  };

  return (
    <div className="min-h-full bg-[#ececec] px-4 py-6 md:px-8 md:py-10">
      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-5 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={goToClient}
            className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-base-content shadow-sm transition-colors hover:bg-white/90"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            Back
          </button>
          <MicrosoftSignInBox />
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <span className="loading loading-spinner loading-lg text-primary" />
          </div>
        ) : error ? (
          <div className="rounded-[18px] bg-white p-10 text-center shadow-sm">
            <p className="text-base-content/60">{error}</p>
          </div>
        ) : client ? (
          <div className="min-w-0">
            <MeetingTab
              client={client}
              variant="reschedule-page"
              onClientUpdate={async () => {
                const refreshed = await fetchClientForMeetingSchedule(lead_number);
                if (refreshed) setClient(refreshed);
              }}
              onRescheduleComplete={goToClient}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default RescheduleMeetingPage;
