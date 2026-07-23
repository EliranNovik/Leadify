import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  CalendarIcon,
  ClockIcon,
  DocumentArrowUpIcon,
  DocumentTextIcon,
  EllipsisVerticalIcon,
  MagnifyingGlassIcon,
  MapPinIcon,
  UserGroupIcon,
  UserIcon,
  UserPlusIcon,
  VideoCameraIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import MobileBottomSheet from './MobileBottomSheet';
import MeetingNotifyControls from './MeetingNotifyControls';
import { InternalMeetingTypeBadge } from '../lib/internalMeetingTypeBadge';
import type { EnrichedMeetingParticipant } from '../lib/staffMeetingParticipants';

type Segment = 'all' | 'staff' | 'firm' | 'extern';

type Props = {
  open: boolean;
  onClose: () => void;
  meeting: any | null;
  dbMeetingId: number | null;
  participants: EnrichedMeetingParticipant[];
  loading: boolean;
  onOpenDocuments: (meeting: any | null, dbMeetingId: number | null) => void;
  onEdit: (meeting: any | null) => void;
  onRemoveParticipant: (participantRowId: string) => void | Promise<void>;
};

function getInternalMeetingTypeRow(meeting: any) {
  const rel = meeting?.internal_meeting_types;
  if (Array.isArray(rel)) return rel[0] ?? null;
  return rel ?? null;
}

const StaffMeetingParticipantsModal: React.FC<Props> = ({
  open,
  onClose,
  meeting,
  dbMeetingId,
  participants,
  loading,
  onOpenDocuments,
  onEdit,
  onRemoveParticipant,
}) => {
  const [segment, setSegment] = useState<Segment>('all');
  const [search, setSearch] = useState('');
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSegment('all');
      setSearch('');
      setActionMenuId(null);
      setRemovingId(null);
    }
  }, [open]);

  useEffect(() => {
    if (!actionMenuId) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest?.('[data-staff-participant-actions]')) return;
      setActionMenuId(null);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [actionMenuId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (participants || []).filter((p) => {
      if (segment !== 'all' && String(p?.type) !== segment) return false;
      if (!q) return true;
      const hay = [
        p.name,
        p.subtitle,
        p.badge,
        p.details?.email,
        p.details?.phone,
        p.details?.notes,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [participants, segment, search]);

  const aggregatedNotes = useMemo(() => {
    const notes: string[] = [];
    for (const p of participants || []) {
      const n = String(p?.details?.notes || '').trim();
      if (n) notes.push(`${p.name}: ${n}`);
    }
    return notes;
  }, [participants]);

  const m = meeting || {};
  const isRecruitment = m.calendar_type === 'recruitment';
  const subtitle = String(m.meeting_subject || m.lead?.name || '').trim();
  const dateRaw = String(m.meeting_date || '').trim();
  const formattedDate = /^(\d{4})-(\d{2})-(\d{2})$/.test(dateRaw)
    ? new Date(`${dateRaw}T12:00:00`).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : dateRaw || '—';
  const isoStartRaw = m.staff_event_start_iso || m.start_date_time;
  const isoEndRaw = m.staff_event_end_iso || m.end_date_time;
  const pad2 = (n: number) => String(n).padStart(2, '0');
  let durMin: number | null =
    m.meeting_duration_minutes != null
      ? Number(m.meeting_duration_minutes)
      : m.duration != null
        ? Number(m.duration)
        : null;
  let startHm = String(m.meeting_time || '').slice(0, 5);
  let endHm = m.meeting_end_time ? String(m.meeting_end_time).slice(0, 5) : '';
  if (isoStartRaw && isoEndRaw) {
    const t0 = new Date(isoStartRaw).getTime();
    const t1 = new Date(isoEndRaw).getTime();
    const diff = Math.round((t1 - t0) / 60000);
    if (Number.isFinite(diff) && diff > 0) {
      durMin = diff;
      const sd = new Date(isoStartRaw);
      startHm = `${pad2(sd.getHours())}:${pad2(sd.getMinutes())}`;
      const ed = new Date(isoEndRaw);
      endHm = `${pad2(ed.getHours())}:${pad2(ed.getMinutes())}`;
    }
  } else if (startHm && durMin && Number.isFinite(durMin) && !endHm) {
    const [hh, mm] = startHm.split(':').map((x: string) => Number(x));
    if (Number.isFinite(hh) && Number.isFinite(mm)) {
      const total = hh * 60 + mm + durMin;
      endHm = `${pad2(Math.floor(total / 60) % 24)}:${pad2(total % 60)}`;
    }
  }
  const timeLabel = startHm ? (endHm ? `${startHm}–${endHm}` : startHm) : '—';
  const location = String(m.meeting_location || m.location || '—').trim() || '—';
  const address = String(m.custom_address || m.manual_address || '').trim();
  const link = String(m.teams_meeting_url || m.custom_link || '').trim();

  const total = participants.length;
  const staffCount = participants.filter((p) => p?.type === 'staff').length;
  const firmCount = participants.filter((p) => p?.type === 'firm').length;
  const externCount = participants.filter((p) => p?.type === 'extern').length;
  const segmentTabs: Array<{ key: Segment; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'staff', label: 'Staff' },
    { key: 'firm', label: 'Firm' },
    { key: 'extern', label: 'External' },
  ];
  const typeRow = getInternalMeetingTypeRow(m);

  const handleRemove = async (participantRowId: string) => {
    setRemovingId(participantRowId);
    try {
      await onRemoveParticipant(participantRowId);
      setActionMenuId(null);
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <MobileBottomSheet
      open={open}
      onClose={onClose}
      hideDefaultHeader
      mobileFullHeight
      zIndex={50}
      sheetClassName="md:max-w-3xl"
      contentClassName="!overflow-hidden flex flex-col min-h-0 p-0"
    >
      <div
        className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-30 border-b border-gray-200 bg-white px-4 py-4 md:px-6 md:py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 gap-y-2">
                <div className="text-lg font-semibold tracking-tight text-gray-900">
                  {isRecruitment ? 'Job interview' : 'Internal meeting'}
                </div>
                {isRecruitment ? (
                  <InternalMeetingTypeBadge typeLabel="Staff" typeCode="staff" />
                ) : (
                  <InternalMeetingTypeBadge
                    typeLabel={typeRow?.label}
                    typeCode={typeRow?.code}
                    internalMeetingTypeId={m?.internal_meeting_type_id}
                  />
                )}
              </div>
              <div className="mt-1 truncate text-sm text-gray-500">{subtitle || '—'}</div>
            </div>

            <div className="flex flex-shrink-0 items-center gap-1">
              <MeetingNotifyControls
                variant="toolbar"
                modalZIndexClass="z-[60]"
                alwaysShow
                dbMeetingId={dbMeetingId}
                meeting={{
                  id: dbMeetingId ?? m.id,
                  date: String(m.meeting_date || '').trim(),
                  time: String(m.meeting_time || '').slice(0, 5),
                  location: m.meeting_location ?? m.location ?? null,
                  link: m.teams_meeting_url || null,
                  brief: m.description || m.meeting_brief || null,
                  calendar_type: isRecruitment ? 'recruitment' : 'staff',
                  custom_link: m.custom_link ?? null,
                  custom_address: m.custom_address ?? null,
                  manual_address: m.manual_address ?? null,
                }}
                client={(() => {
                  const lead = m.lead;
                  const hasRealLead =
                    lead &&
                    lead.id != null &&
                    String(lead.id) !== '' &&
                    !String(lead.id).startsWith('staff-') &&
                    String(lead.lead_number || '').toUpperCase() !== 'STAFF';
                  if (hasRealLead) {
                    return {
                      id: lead.id,
                      name: lead.name || m.meeting_subject || 'Client',
                      email: lead.email || undefined,
                      phone: lead.phone || undefined,
                      mobile: lead.mobile || undefined,
                      lead_number: lead.lead_number || undefined,
                      lead_type: lead.lead_type || undefined,
                      language: lead.language || undefined,
                      language_id: lead.language_id ?? undefined,
                    };
                  }
                  return {
                    id: isRecruitment ? 'recruitment-meeting' : 'staff-meeting',
                    isStaffMeeting: true,
                    name: String(m.meeting_subject || m.lead?.name || 'Internal meeting').trim(),
                    email: undefined,
                    phone: undefined,
                    mobile: undefined,
                    lead_number: undefined,
                  };
                })()}
              />
              <button
                type="button"
                className="btn btn-ghost btn-sm font-medium text-gray-700 gap-1.5"
                onClick={() => onOpenDocuments(meeting, dbMeetingId)}
              >
                <DocumentArrowUpIcon className="h-5 w-5" />
                Documents
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm font-medium text-gray-700"
                onClick={() => onEdit(meeting)}
              >
                Edit
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-circle"
                aria-label="Close"
                onClick={onClose}
              >
                <XMarkIcon className="h-6 w-6 text-gray-500" />
              </button>
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="px-6 pt-6">
            <div className="rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-600">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                <div className="flex min-w-0 items-center gap-2">
                  <CalendarIcon className="h-4 w-4 flex-shrink-0 text-gray-400" />
                  <span className="truncate font-medium text-gray-700">{formattedDate}</span>
                </div>
                <div className="flex min-w-0 items-center gap-2">
                  <ClockIcon className="h-4 w-4 flex-shrink-0 text-gray-400" />
                  <span className="truncate font-medium text-gray-700">{timeLabel}</span>
                </div>
                <div className="flex min-w-0 items-center gap-2">
                  <MapPinIcon className="h-4 w-4 flex-shrink-0 text-gray-400" />
                  <span className="truncate font-medium text-gray-700">{location}</span>
                </div>
                <div className="flex min-w-0 items-center gap-2">
                  <span className="text-base leading-none text-gray-300">⏱</span>
                  <span className="truncate font-medium text-gray-700">
                    {durMin == null || !Number.isFinite(durMin) ? '—' : `${durMin}m`}
                  </span>
                </div>
              </div>

              {address ? (
                <div className="mt-2 border-t border-gray-200 pt-2 text-xs text-gray-500">{address}</div>
              ) : null}

              {link ? (
                <div className="mt-3 flex items-center justify-between gap-3 border-t border-gray-200 pt-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <VideoCameraIcon className="h-4 w-4 flex-shrink-0 text-gray-400" />
                    <a
                      href={link}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate text-sm font-medium text-primary hover:opacity-85"
                      title={link}
                      onClick={(e) => e.stopPropagation()}
                    >
                      Open meeting link
                    </a>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm text-gray-700"
                    onClick={(e) => {
                      e.stopPropagation();
                      void navigator.clipboard?.writeText(link);
                      toast.success('Link copied');
                    }}
                  >
                    Copy
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          {!loading && participants.length > 0 ? (
            <div className="border-b border-gray-200 px-6 py-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap items-center gap-1 overflow-x-auto">
                  {segmentTabs.map((tab) => {
                    const counts: Record<string, number> = {
                      all: total,
                      staff: staffCount,
                      firm: firmCount,
                      extern: externCount,
                    };
                    const active = segment === tab.key;
                    return (
                      <button
                        key={tab.key}
                        type="button"
                        onClick={() => setSegment(tab.key)}
                        className={`cursor-pointer whitespace-nowrap rounded-md px-2.5 py-1 text-sm font-medium transition-colors ${
                          active
                            ? 'bg-gray-100 text-gray-900 shadow-[inset_0_-2px_0_0_rgb(229,231,235)]'
                            : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'
                        }`}
                      >
                        {tab.label} ({counts[String(tab.key)] ?? 0})
                      </button>
                    );
                  })}
                </div>

                <div className="relative w-full lg:max-w-xs">
                  <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    className="input input-sm input-bordered h-10 w-full pl-10 pr-10 text-sm"
                    placeholder="Search participants…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  {search.trim() ? (
                    <button
                      type="button"
                      aria-label="Clear search"
                      className="absolute right-2 top-1/2 btn btn-ghost btn-xs -translate-y-1/2 text-gray-500"
                      onClick={() => setSearch('')}
                    >
                      <XMarkIcon className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          <div className="relative min-h-0 flex-1">
            <div className="h-full overflow-y-auto px-6 pb-8">
              {loading ? (
                <div className="flex items-center justify-center py-14">
                  <span className="loading loading-spinner loading-md" />
                </div>
              ) : participants.length === 0 ? (
                <div className="py-10 text-sm text-gray-500">No participants found.</div>
              ) : (
                <div className="space-y-6 pt-6">
                  {aggregatedNotes.length > 0 ? (
                    <section className="space-y-3">
                      <div className="flex items-center gap-2">
                        <DocumentTextIcon className="h-5 w-5 text-gray-400" />
                        <div className="text-sm font-semibold text-gray-900">Notes</div>
                      </div>
                      <div className="divider my-0 before:bg-gray-200 after:bg-gray-200" />
                      <div className="rounded-xl bg-gray-50 px-4 py-3 text-sm whitespace-pre-wrap text-gray-700">
                        {aggregatedNotes.join('\n\n')}
                      </div>
                    </section>
                  ) : null}

                  <section className={`space-y-3 ${aggregatedNotes.length ? 'pt-2' : ''}`}>
                    <div className="text-sm font-semibold text-gray-900">
                      Participants ({filtered.length}
                      {segment === 'all' && search.trim() ? (
                        <span className="ml-2 text-xs font-normal text-gray-400">filtered</span>
                      ) : null}
                      )
                    </div>

                    {filtered.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-10 text-center text-sm text-gray-500">
                        No participants match your filters.
                      </div>
                    ) : (
                      <div className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-100 bg-white">
                        {filtered.map((p, idx) => {
                          const roleChip =
                            p.type === 'staff'
                              ? 'border-sky-200/70 bg-sky-50 text-sky-950/65'
                              : p.type === 'firm'
                                ? 'border-fuchsia-200/65 bg-fuchsia-50 text-fuchsia-950/65'
                                : 'border-amber-200/70 bg-amber-50 text-amber-950/65';
                          const badgeIcon =
                            p.type === 'staff' ? (
                              <UserIcon className="h-3.5 w-3.5 shrink-0 opacity-70" />
                            ) : p.type === 'firm' ? (
                              <UserGroupIcon className="h-3.5 w-3.5 shrink-0 opacity-70" />
                            ) : (
                              <UserPlusIcon className="h-3.5 w-3.5 shrink-0 opacity-70" />
                            );
                          const initials = String(p.name || '?')
                            .split(' ')
                            .filter(Boolean)
                            .slice(0, 2)
                            .map((s) => s[0]?.toUpperCase())
                            .join('');
                          const rowKey = p.participantRowId
                            ? String(p.participantRowId)
                            : `${p.type}-${idx}-${p.name}`;

                          return (
                            <div key={rowKey} className="px-3 py-3 sm:px-4">
                              <div className="flex items-start gap-2 sm:gap-3">
                                <div className="relative h-[38px] w-[38px] flex-shrink-0 overflow-hidden rounded-full bg-gray-50 ring-1 ring-gray-200">
                                  {p.imageUrl ? (
                                    <img src={p.imageUrl} alt="" className="h-full w-full object-cover" />
                                  ) : (
                                    <span className="flex h-full w-full items-center justify-center text-[11px] font-semibold text-gray-600">
                                      {initials || '?'}
                                    </span>
                                  )}
                                </div>

                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-sm font-semibold text-gray-900">{p.name}</div>
                                  {p.details?.email || p.details?.phone ? (
                                    <div className="mt-1 truncate text-xs text-gray-500">
                                      {p.details?.email ? (
                                        <a
                                          href={`mailto:${p.details.email}`}
                                          className="hover:underline"
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          {p.details.email}
                                        </a>
                                      ) : null}
                                      {p.details?.email && p.details?.phone ? (
                                        <span className="text-gray-400"> · </span>
                                      ) : null}
                                      {p.details?.phone ? (
                                        <a
                                          href={`tel:${String(p.details.phone).replace(/[^\d+]/g, '')}`}
                                          className="hover:underline"
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          {p.details.phone}
                                        </a>
                                      ) : null}
                                    </div>
                                  ) : null}
                                  {p.subtitle ? (
                                    <div className="mt-1 truncate text-xs text-gray-500">{p.subtitle}</div>
                                  ) : null}
                                </div>

                                <div
                                  data-staff-participant-actions
                                  className="relative flex flex-shrink-0 items-start gap-1"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <span
                                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium ${roleChip}`}
                                  >
                                    {badgeIcon}
                                    {p.type === 'extern' ? 'External' : p.badge}
                                  </span>

                                  {p.participantRowId ? (
                                    <>
                                      <button
                                        type="button"
                                        className="btn btn-ghost btn-xs btn-square text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                                        aria-label="Participant actions"
                                        aria-expanded={actionMenuId === String(p.participantRowId)}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const id = String(p.participantRowId);
                                          setActionMenuId((v) => (v === id ? null : id));
                                        }}
                                      >
                                        <EllipsisVerticalIcon className="h-5 w-5" />
                                      </button>
                                      {actionMenuId === String(p.participantRowId) ? (
                                        <div className="absolute right-0 top-[calc(100%+4px)] z-50 min-w-[9.5rem] rounded-lg border border-gray-100 bg-white py-1 shadow-lg">
                                          <button
                                            type="button"
                                            className="block w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-gray-50 disabled:opacity-50"
                                            disabled={removingId === String(p.participantRowId)}
                                            onClick={() => void handleRemove(String(p.participantRowId))}
                                          >
                                            {removingId === String(p.participantRowId)
                                              ? 'Removing…'
                                              : 'Remove'}
                                          </button>
                                        </div>
                                      ) : null}
                                    </>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                </div>
              )}
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-white to-transparent" />
          </div>
        </div>
      </div>
    </MobileBottomSheet>
  );
};

export default StaffMeetingParticipantsModal;
