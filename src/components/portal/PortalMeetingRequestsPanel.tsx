import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarDaysIcon,
  CheckIcon,
  ChevronDownIcon,
  ClockIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import ContactProfileAvatar from '../ContactProfileAvatar';
import { useContactProfileImageUrls } from '../../hooks/useContactProfileImageUrls';
import { supabase } from '../../lib/supabase';

type ContactInfo = {
  name: string;
  portal_profile_image_path: string | null;
};

type MeetingRequest = {
  id: number;
  preferred_date: string;
  preferred_time_range: string | null;
  notes: string | null;
  status: string;
  created_at: string;
  contact_id: number;
  leads_contact?: ContactInfo | ContactInfo[];
};

type Props = {
  leadId: string;
  leadType?: string | null;
};

function resolveContact(req: MeetingRequest): ContactInfo | null {
  const raw = req.leads_contact;
  if (!raw) return null;
  return Array.isArray(raw) ? raw[0] ?? null : raw;
}

function formatPreferredDate(value: string): string {
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return value;
  }
}

function formatRequestedAt(value: string): string {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

const PortalMeetingRequestsPanel: React.FC<Props> = ({ leadId, leadType }) => {
  const [requests, setRequests] = useState<MeetingRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const isLegacy = leadType === 'legacy' || String(leadId).startsWith('legacy_');
  const legacyId = isLegacy ? parseInt(String(leadId).replace(/^legacy_/, ''), 10) : null;
  const newLeadId = !isLegacy ? String(leadId) : null;

  const profilePaths = useMemo(
    () => requests.map((req) => resolveContact(req)?.portal_profile_image_path),
    [requests],
  );
  const profileImageUrls = useContactProfileImageUrls(profilePaths);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('client_portal_meeting_requests')
        .select(`
          id,
          preferred_date,
          preferred_time_range,
          notes,
          status,
          created_at,
          contact_id,
          leads_contact (name, portal_profile_image_path)
        `)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (isLegacy && legacyId) {
        query = query.eq('legacy_lead_id', legacyId);
      } else if (newLeadId) {
        query = query.eq('new_lead_id', newLeadId);
      }

      const { data, error } = await query;
      if (error) throw error;
      setRequests((data ?? []) as MeetingRequest[]);
    } catch (e) {
      console.error('portal meeting requests', e);
    } finally {
      setLoading(false);
    }
  }, [isLegacy, legacyId, newLeadId]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateStatus = async (id: number, status: 'confirmed' | 'cancelled') => {
    try {
      const { error } = await supabase
        .from('client_portal_meeting_requests')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
      toast.success(status === 'confirmed' ? 'Request marked confirmed' : 'Request cancelled');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed');
    }
  };

  if (loading || requests.length === 0) return null;

  return (
    <details className="group mb-6 overflow-hidden rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/[0.06] via-white to-violet-50/40 shadow-[0_8px_30px_rgba(59,40,199,0.08)]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-white/70 px-4 py-4 md:px-5 [&::-webkit-details-marker]:hidden">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <CalendarDaysIcon className="h-6 w-6" aria-hidden />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-bold tracking-tight text-gray-900 md:text-lg">
              Client portal meeting requests
            </h3>
            <p className="text-xs text-gray-500 md:text-sm">
              {requests.length} pending · click to {''}
              <span className="group-open:hidden">view</span>
              <span className="hidden group-open:inline">hide</span>
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="inline-flex min-w-[2rem] items-center justify-center rounded-full bg-primary px-3 py-1 text-sm font-bold tabular-nums text-primary-content shadow-sm">
            {requests.length}
          </span>
          <ChevronDownIcon
            className="h-5 w-5 text-gray-400 transition-transform duration-200 group-open:rotate-180"
            aria-hidden
          />
        </div>
      </summary>

      <div className="border-t border-primary/10">
        <div className="space-y-3 p-4 md:p-5">
          {requests.map((req) => {
            const contact = resolveContact(req);
            const contactName = contact?.name?.trim() || 'Unknown contact';
            const profilePath = contact?.portal_profile_image_path?.trim() || null;
            const profileImageUrl = profilePath ? profileImageUrls[profilePath] : undefined;

            return (
              <div
                key={req.id}
                className="rounded-xl border border-gray-200/80 bg-white p-4 shadow-sm transition-shadow hover:shadow-md md:p-5"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="flex items-start gap-3">
                      <ContactProfileAvatar
                        name={contactName}
                        imageUrl={profileImageUrl}
                        className="h-11 w-11 text-sm"
                      />
                      <div className="min-w-0">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">
                          Submitted by
                        </p>
                        <p className="truncate text-base font-semibold text-gray-900">{contactName}</p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary">
                        <CalendarDaysIcon className="h-4 w-4 shrink-0" aria-hidden />
                        {formatPreferredDate(req.preferred_date)}
                      </span>
                      {req.preferred_time_range ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/12 px-3 py-1.5 text-sm font-medium text-amber-800">
                          <ClockIcon className="h-4 w-4 shrink-0" aria-hidden />
                          {req.preferred_time_range}
                        </span>
                      ) : null}
                      <span className="inline-flex rounded-full bg-neutral-500/10 px-2.5 py-1 text-xs font-semibold text-neutral-600">
                        Pending
                      </span>
                    </div>

                    {req.notes ? (
                      <div className="rounded-lg border border-gray-100 bg-gray-50/80 px-3 py-2.5 text-sm text-gray-600">
                        {req.notes}
                      </div>
                    ) : null}

                    <p className="text-xs text-gray-400">
                      Requested {formatRequestedAt(req.created_at)}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2 self-start lg:flex-col lg:items-stretch">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm gap-1.5 rounded-full px-4 shadow-sm"
                      onClick={() => updateStatus(req.id, 'confirmed')}
                    >
                      <CheckIcon className="h-4 w-4" />
                      Confirm
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm gap-1 rounded-full text-gray-500 hover:bg-red-50 hover:text-red-600"
                      onClick={(e) => {
                        e.preventDefault();
                        void updateStatus(req.id, 'cancelled');
                      }}
                      aria-label="Dismiss request"
                    >
                      <XMarkIcon className="h-4 w-4" />
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="border-t border-primary/10 bg-white/60 px-4 py-3 md:px-5">
          <p className="text-xs leading-relaxed text-gray-500">
            Confirming marks the portal request as handled. Schedule the actual meeting using the tools
            below.
          </p>
        </div>
      </div>
    </details>
  );
};

export default PortalMeetingRequestsPanel;
