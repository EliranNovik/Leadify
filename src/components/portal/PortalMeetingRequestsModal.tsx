import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CalendarDaysIcon,
  CheckIcon,
  ChevronDownIcon,
  ClockIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import ContactProfileAvatar from '../ContactProfileAvatar';
import { useContactProfileImageUrls } from '../../hooks/useContactProfileImageUrls';
import {
  buildPortalRequestMeetingTabRoute,
  formatPortalPreferredDate,
  formatPortalRequestedAt,
  getPortalRequestLeadNumber,
  resolvePortalRequestContact,
  updatePortalMeetingRequestStatus,
  type PortalMeetingRequest,
} from '../../lib/portalMeetingRequests';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  requests: PortalMeetingRequest[];
  loading: boolean;
  onUpdated?: () => void;
};

const PENDING_BADGE_CLASS =
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium shrink-0 bg-amber-100/60 text-amber-800/70 whitespace-nowrap';

const PortalMeetingRequestsModal: React.FC<Props> = ({
  isOpen,
  onClose,
  requests,
  loading,
  onUpdated,
}) => {
  const navigate = useNavigate();
  const [expandedLeadNumbers, setExpandedLeadNumbers] = useState<Set<string>>(new Set());
  const [actingId, setActingId] = useState<number | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setExpandedLeadNumbers(new Set());
      setActingId(null);
    }
  }, [isOpen]);

  const profilePaths = useMemo(
    () => requests.map((req) => resolvePortalRequestContact(req)?.portal_profile_image_path),
    [requests],
  );
  const profileImageUrls = useContactProfileImageUrls(profilePaths);

  const groupedByLead = useMemo(() => {
    const map = new Map<string, PortalMeetingRequest[]>();
    for (const req of requests) {
      const leadNumber = getPortalRequestLeadNumber(req);
      const bucket = map.get(leadNumber);
      if (bucket) bucket.push(req);
      else map.set(leadNumber, [req]);
    }
    return Array.from(map.entries()).sort((a, b) =>
      a[0].localeCompare(b[0], undefined, { numeric: true }),
    );
  }, [requests]);

  const toggleLeadExpanded = (leadNumber: string) => {
    setExpandedLeadNumbers((prev) => {
      const next = new Set(prev);
      if (next.has(leadNumber)) next.delete(leadNumber);
      else next.add(leadNumber);
      return next;
    });
  };

  const handleOpenMeetingTab = (req: PortalMeetingRequest) => {
    navigate(buildPortalRequestMeetingTabRoute(req));
    onClose();
  };

  const handleUpdateStatus = async (id: number, status: 'confirmed' | 'cancelled') => {
    setActingId(id);
    try {
      await updatePortalMeetingRequestStatus(id, status);
      toast.success(status === 'confirmed' ? 'Request marked confirmed' : 'Request cancelled');
      onUpdated?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setActingId(null);
    }
  };

  if (!isOpen || typeof window === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex flex-col bg-base-100"
      role="dialog"
      aria-modal="true"
      aria-labelledby="portal-meeting-requests-title"
    >
      <div className="flex items-start justify-between gap-4 px-5 py-4 shrink-0 bg-base-100">
        <div>
          <h2 id="portal-meeting-requests-title" className="text-xl font-bold flex items-center gap-2">
            <CalendarDaysIcon className="w-6 h-6 text-primary" />
            Client portal meeting requests
          </h2>
          <p className="text-sm text-base-content/60 mt-1">
            {loading
              ? 'Loading…'
              : requests.length === 0
                ? 'No pending requests'
                : `${requests.length} pending · ${groupedByLead.length} lead${groupedByLead.length === 1 ? '' : 's'}`}
            {!loading && requests.length > 0 ? ' · expand a lead to view requests' : ''}
          </p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm btn-circle" onClick={onClose} aria-label="Close">
          <XMarkIcon className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-auto px-5 py-4 space-y-4 min-h-0 bg-[#ececec]">
        {loading ? (
          <div className="flex justify-center py-16">
            <span className="loading loading-spinner loading-lg text-primary" />
          </div>
        ) : groupedByLead.length === 0 ? (
          <div className="text-center py-16 text-base-content/50">
            All portal meeting requests have been confirmed or dismissed.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5">
            {groupedByLead.map(([leadNumber, leadRequests]) => {
              const isExpanded = expandedLeadNumbers.has(leadNumber);

              return (
                <section key={leadNumber} className="flex min-w-0 flex-col gap-3">
                  <div
                    className="rounded-[18px] bg-white px-4 py-4 shadow-sm cursor-pointer"
                    onClick={() => toggleLeadExpanded(leadNumber)}
                    role="button"
                    tabIndex={0}
                    aria-expanded={isExpanded}
                    aria-controls={`portal-meeting-requests-lead-${leadNumber}`}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleLeadExpanded(leadNumber);
                      }
                    }}
                  >
                    <div className="flex w-full items-center justify-between gap-3 text-left">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold uppercase tracking-wider text-base-content/40">
                          Lead
                        </p>
                        <h3 className="truncate text-base font-semibold leading-snug text-base-content">
                          {leadNumber}
                        </h3>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span className={PENDING_BADGE_CLASS}>
                            {leadRequests.length} pending
                          </span>
                        </div>
                      </div>
                      <ChevronDownIcon
                        className={`h-5 w-5 shrink-0 text-base-content/40 transition-transform duration-200 ${
                          isExpanded ? 'rotate-180' : ''
                        }`}
                        aria-hidden
                      />
                    </div>
                  </div>

                  {isExpanded ? (
                    <div
                      id={`portal-meeting-requests-lead-${leadNumber}`}
                      className="flex flex-col gap-3"
                    >
                      {leadRequests.map((req) => {
                        const contact = resolvePortalRequestContact(req);
                        const contactName = contact?.name?.trim() || 'Unknown contact';
                        const profilePath = contact?.portal_profile_image_path?.trim() || null;
                        const profileImageUrl = profilePath ? profileImageUrls[profilePath] : undefined;
                        const isActing = actingId === req.id;

                        return (
                          <div
                            key={req.id}
                            className="rounded-[18px] bg-white px-4 py-4 shadow-sm"
                          >
                            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                              <div className="flex min-w-0 flex-1 items-start gap-3">
                                <ContactProfileAvatar
                                  name={contactName}
                                  imageUrl={profileImageUrl}
                                  className="h-11 w-11 shrink-0 text-sm"
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="truncate text-sm font-semibold text-base-content">
                                      {contactName}
                                    </p>
                                    <span className={PENDING_BADGE_CLASS}>Pending</span>
                                  </div>
                                  <div className="mt-2 flex flex-wrap items-center gap-2">
                                    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600">
                                      <CalendarDaysIcon className="h-3.5 w-3.5" aria-hidden />
                                      {formatPortalPreferredDate(req.preferred_date)}
                                    </span>
                                    {req.preferred_time_range ? (
                                      <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600">
                                        <ClockIcon className="h-3.5 w-3.5" aria-hidden />
                                        {req.preferred_time_range}
                                      </span>
                                    ) : null}
                                  </div>
                                  {req.notes ? (
                                    <p className="mt-2 text-sm text-base-content/70">{req.notes}</p>
                                  ) : null}
                                  <p className="mt-2 text-xs text-base-content/45">
                                    Requested {formatPortalRequestedAt(req.created_at)}
                                  </p>
                                  <button
                                    type="button"
                                    className="mt-2 text-xs font-medium text-primary hover:underline"
                                    onClick={() => handleOpenMeetingTab(req)}
                                  >
                                    Open meeting tab
                                  </button>
                                </div>
                              </div>

                              <div className="flex shrink-0 items-center gap-2 self-start lg:flex-col lg:items-stretch">
                                <button
                                  type="button"
                                  className="btn btn-primary btn-sm gap-1.5 rounded-full px-4 shadow-sm"
                                  disabled={isActing}
                                  onClick={() => void handleUpdateStatus(req.id, 'confirmed')}
                                >
                                  {isActing ? (
                                    <span className="loading loading-spinner loading-xs" />
                                  ) : (
                                    <CheckIcon className="h-4 w-4" />
                                  )}
                                  Confirm
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-sm gap-1 rounded-full text-gray-500 hover:bg-red-50 hover:text-red-600"
                                  disabled={isActing}
                                  onClick={() => void handleUpdateStatus(req.id, 'cancelled')}
                                >
                                  <XMarkIcon className="h-4 w-4" />
                                  Cancel
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};

export default PortalMeetingRequestsModal;
