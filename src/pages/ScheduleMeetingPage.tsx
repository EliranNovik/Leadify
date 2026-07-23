import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import MeetingTab from '../components/client-tabs/MeetingTab';
import MicrosoftSignInBox from '../components/meeting/MicrosoftSignInBox';
import {
  getClientPagePathFromClient,
  safeDecodeRouteParam,
} from '../lib/meetingScheduleNavigation';
import { supabase } from '../lib/supabase';
import type { Client } from '../types/client';

function asLegacyClient(row: Record<string, unknown>, leadNumberOverride?: string): Client {
  return {
    ...row,
    id: `legacy_${row.id}`,
    lead_number: leadNumberOverride || String(row.manual_id || row.id),
    lead_type: 'legacy',
  } as Client;
}

async function fetchClientByLeadNumber(leadNumber: string): Promise<Client | null> {
  const decoded = safeDecodeRouteParam(leadNumber);

  const { data: newLead, error: newErr } = await supabase
    .from('leads')
    .select('*')
    .eq('lead_number', decoded)
    .maybeSingle();

  if (!newErr && newLead) {
    return { ...newLead, lead_type: 'new' } as Client;
  }

  const { data: legacyByManual } = await supabase
    .from('leads_lead')
    .select('*')
    .eq('manual_id', decoded)
    .maybeSingle();

  if (legacyByManual) {
    return asLegacyClient(legacyByManual);
  }

  // Legacy sub-leads use /clients/{id}?lead={base}/{n}; schedule routes may pass the sub-lead key.
  if (decoded.includes('/')) {
    const base = decoded.split('/')[0] || '';
    if (base) {
      const { data: legacyParentByManual } = await supabase
        .from('leads_lead')
        .select('*')
        .eq('manual_id', base)
        .maybeSingle();
      if (legacyParentByManual) {
        return asLegacyClient(legacyParentByManual, decoded);
      }
      const parentId = Number.parseInt(base, 10);
      if (Number.isFinite(parentId) && String(parentId) === base) {
        const { data: legacyParentById } = await supabase
          .from('leads_lead')
          .select('*')
          .eq('id', parentId)
          .maybeSingle();
        if (legacyParentById) {
          return asLegacyClient(legacyParentById, decoded);
        }
      }
    }
  }

  const asId = Number.parseInt(decoded, 10);
  if (Number.isFinite(asId) && String(asId) === decoded) {
    const { data: legacyById } = await supabase
      .from('leads_lead')
      .select('*')
      .eq('id', asId)
      .maybeSingle();

    if (legacyById) {
      return asLegacyClient(legacyById);
    }
  }

  return null;
}

/**
 * Desktop schedule-meeting route. Styled like /contacts/:id (grey canvas + white cards).
 * Mobile entry points still use the native bottom sheet from MeetingTab / Clients.
 */
const ScheduleMeetingPage: React.FC = () => {
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
        const result = await fetchClientByLeadNumber(lead_number);
        if (cancelled) return;
        if (!result) {
          setError('Lead not found.');
          setClient(null);
        } else {
          setClient(result);
        }
      } catch (e) {
        if (cancelled) return;
        console.error('ScheduleMeetingPage', e);
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
              variant="schedule-page"
              onClientUpdate={async () => {
                const refreshed = await fetchClientByLeadNumber(lead_number);
                if (refreshed) setClient(refreshed);
              }}
              onScheduleComplete={goToClient}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default ScheduleMeetingPage;
