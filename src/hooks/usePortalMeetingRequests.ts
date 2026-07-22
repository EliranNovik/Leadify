import { useCallback, useEffect, useState } from 'react';
import {
  fetchUpcomingClientPortalBookings,
  type ClientPortalBookedMeeting,
} from '../lib/portalMeetingRequests';
import { supabase } from '../lib/supabase';

/** Upcoming (today+) meetings booked by clients via the portal / public booking link. */
export function usePortalMeetingRequests(enabled = true) {
  const [meetings, setMeetings] = useState<ClientPortalBookedMeeting[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const data = await fetchUpcomingClientPortalBookings();
      setMeetings(data);
    } catch (e) {
      console.error('client portal bookings', e);
      setMeetings([]);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!enabled) return;

    const channel = supabase
      .channel('client-portal-booked-meetings')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'meetings' },
        () => {
          void refresh();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [enabled, refresh]);

  return {
    /** @deprecated use `meetings` — kept for CalendarPage naming compatibility */
    requests: meetings,
    meetings,
    count: meetings.length,
    loading,
    refresh,
  };
}
