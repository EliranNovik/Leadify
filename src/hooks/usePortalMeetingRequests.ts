import { useCallback, useEffect, useState } from 'react';
import {
  fetchPendingPortalMeetingRequests,
  type PortalMeetingRequest,
} from '../lib/portalMeetingRequests';
import { supabase } from '../lib/supabase';

export function usePortalMeetingRequests(enabled = true) {
  const [requests, setRequests] = useState<PortalMeetingRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const data = await fetchPendingPortalMeetingRequests();
      setRequests(data);
    } catch (e) {
      console.error('portal meeting requests', e);
      setRequests([]);
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
      .channel('portal-meeting-requests-pending')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'client_portal_meeting_requests' },
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
    requests,
    count: requests.length,
    loading,
    refresh,
  };
}
