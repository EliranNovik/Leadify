import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { DateTime } from 'luxon';
import {
  CalendarDaysIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MapPinIcon,
  VideoCameraIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import BookingTimeWheel from './BookingTimeWheel';
import { BookingMeetingCardActions } from './BookingMeetingCardActions';
import {
  bookPublicMeeting,
  CLIENT_BOOKING_LOCATION_OPTIONS,
  fetchPublicBookingConfig,
  fetchPublicBookingMeetings,
  fetchPublicBookingSlots,
  type BookingContact,
  type ClientBookingLocation,
  type PublicBookingConfig,
  type PublicBookingMeeting,
} from '../../lib/clientBookingApi';
import {
  BUSINESS_TZ,
  detectClientTimezone,
  formatBookingTimeWithZone,
  formatMeetingForClientDisplay,
  formatTimezoneLabel,
  getStoredClientTimezone,
  isClientBookingDateBlocked,
  persistClientTimezone,
  resolveCategoryAvailabilityForLead,
} from '../../lib/bookingTimezone';
import {
  getPortalTabHeaderCoverImage,
  PortalCard,
  PortalLoading,
  PortalSectionLabel,
  PortalTabFrame,
} from '../../pages/portal/components/portalTheme';
import PortalMeetingLocationLines from '../../pages/portal/components/PortalMeetingLocationLines';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function formatBookingDisplayDate(dateStr: string): string {
  const d = DateTime.fromISO(`${dateStr}T12:00:00`);
  if (!d.isValid) return dateStr;
  return d.toLocaleString({ weekday: 'long', month: 'long', day: 'numeric' });
}

export function formatBookingShortDate(dateStr: string): string {
  const d = DateTime.fromISO(`${dateStr}T12:00:00`);
  if (!d.isValid) return dateStr;
  return d.toLocaleString({ weekday: 'short', month: 'short', day: 'numeric' });
}

function toDateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function portalMeetingsUrl(leadRef?: string | null): string | null {
  if (!leadRef?.trim()) return null;
  return `/portal/${encodeURIComponent(leadRef.trim())}/case?tab=meetings`;
}

export function ScheduledMeetingsSection({
  meetings,
  clientTimezone,
  durationMinutes = 30,
}: {
  meetings: PublicBookingMeeting[];
  clientTimezone: string;
  durationMinutes?: number;
}) {
  return (
    <section className="space-y-4">
      <PortalSectionLabel>Your scheduled meetings</PortalSectionLabel>
      {meetings.length === 0 ? (
        <PortalCard>
          <p className="text-sm text-base-content/45">
            No upcoming meetings yet. Pick a date and time below to schedule your first appointment.
          </p>
        </PortalCard>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {meetings.map((m) => {
            const tz = m.client_booking_timezone || clientTimezone;
            const jerusalemTime = m.meeting_time?.substring(0, 5) || '';
            const display = m.meeting_date
              ? formatMeetingForClientDisplay(m.meeting_date, jerusalemTime, tz)
              : null;
            const displayDate = display?.clientDate || m.meeting_date || '';
            const timeWithZone = display?.clientTimeWithZone
              || (jerusalemTime ? formatBookingTimeWithZone(jerusalemTime, tz, displayDate) : '');
            const cardTitle = m.meeting_subject || 'Meeting';
            return (
              <PortalCard key={m.id} className="flex h-full flex-col">
                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900">{cardTitle}</p>
                      <p className="mt-2 flex items-center gap-2 text-sm text-gray-600">
                        <CalendarDaysIcon className="h-4 w-4 shrink-0 text-gray-400" />
                        {displayDate ? formatBookingShortDate(displayDate) : ''}
                        {timeWithZone ? ` · ${timeWithZone}` : ''}
                      </p>
                      {display?.israelTimeWithZone && tz !== BUSINESS_TZ ? (
                        <p className="mt-1 text-xs text-base-content/45">
                          Israel office: {display.israelTimeWithZone}
                        </p>
                      ) : null}
                      {m.meeting_location ? (
                        <PortalMeetingLocationLines
                          location={m.meeting_location}
                          isPhysicalMeeting={m.is_physical_meeting}
                          meetingAddress={m.meeting_address}
                          className="mt-1 space-y-1"
                          locationClassName="flex items-center gap-2 text-sm text-gray-600"
                          addressClassName="pl-6 text-sm leading-snug text-gray-500 whitespace-pre-wrap"
                        />
                      ) : null}
                    </div>
                    <span className="inline-flex shrink-0 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                      Scheduled
                    </span>
                  </div>
                  {m.join_url ? (
                    <a
                      href={m.join_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-primary btn-sm mt-4 w-full gap-1.5 rounded-lg"
                    >
                      <VideoCameraIcon className="h-4 w-4" />
                      Join meeting
                    </a>
                  ) : null}
                  <BookingMeetingCardActions
                    title={cardTitle}
                    meetingDate={m.meeting_date}
                    meetingTime={m.meeting_time}
                    meetingLocation={m.meeting_location}
                    joinUrl={m.join_url}
                    durationMinutes={durationMinutes}
                  />
                </div>
              </PortalCard>
            );
          })}
        </div>
      )}
    </section>
  );
}

export type ClientBookingSchedulerProps = {
  bookingToken: string;
  variant?: 'public' | 'embedded';
  /** When true, uses the public booking layout inside the client portal tab */
  inClientPortal?: boolean;
  defaultContactId?: number | null;
  hideScheduledMeetings?: boolean;
  onBooked?: () => void;
  onLeadRefLoaded?: (leadRef: string | null) => void;
};

const ClientBookingScheduler: React.FC<ClientBookingSchedulerProps> = ({
  bookingToken,
  variant = 'public',
  inClientPortal = false,
  defaultContactId = null,
  hideScheduledMeetings = false,
  onBooked,
  onLeadRefLoaded,
}) => {
  const embedded = variant === 'embedded';
  const usePublicExperience = variant === 'public';
  const [clientTimezone, setClientTimezone] = useState(() => getStoredClientTimezone());
  const [config, setConfig] = useState<PublicBookingConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMonth, setViewMonth] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [slots, setSlots] = useState<string[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [selectedContact, setSelectedContact] = useState<BookingContact | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<ClientBookingLocation>('Teams');
  const [notes, setNotes] = useState('');
  const [step, setStep] = useState<'datetime' | 'contact' | 'done'>('datetime');
  const [submitting, setSubmitting] = useState(false);
  const [confirmedMeeting, setConfirmedMeeting] = useState<{
    date: string;
    time: string;
    timeWithZone: string;
    israelTimeWithZone?: string;
    location: string;
  } | null>(null);
  const [scheduledMeetings, setScheduledMeetings] = useState<PublicBookingMeeting[]>([]);
  const [bookingOpen, setBookingOpen] = useState(variant === 'embedded');

  useEffect(() => {
    const tz = persistClientTimezone(detectClientTimezone());
    setClientTimezone(tz);
  }, []);

  const loadScheduledMeetings = useCallback(async () => {
    if (!bookingToken) return;
    try {
      setScheduledMeetings(await fetchPublicBookingMeetings(bookingToken));
    } catch {
      setScheduledMeetings([]);
    }
  }, [bookingToken]);

  useEffect(() => {
    if (!bookingToken) {
      setError('Invalid booking link');
      setLoading(false);
      return;
    }
    void Promise.all([fetchPublicBookingConfig(bookingToken), fetchPublicBookingMeetings(bookingToken)])
      .then(([cfg, meetings]) => {
        setConfig(cfg);
        setScheduledMeetings(meetings);
        onLeadRefLoaded?.(cfg.lead?.lead_ref || cfg.lead?.lead_number || null);
        const reachable = (cfg.contacts || []).filter((c) => c.email || c.mobile || c.phone);
        if (defaultContactId) {
          const match = reachable.find((c) => Number(c.id) === Number(defaultContactId));
          if (match) setSelectedContact(match);
        } else if (reachable.length === 1) {
          setSelectedContact(reachable[0]);
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Link not found'))
      .finally(() => setLoading(false));
  }, [bookingToken, defaultContactId, onLeadRefLoaded]);

  const loadSlots = useCallback(
    async (date: string) => {
      setSlotsLoading(true);
      try {
        const result = await fetchPublicBookingSlots(bookingToken, date, clientTimezone);
        setSlots(result.slots);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not load times');
        setSlots([]);
      } finally {
        setSlotsLoading(false);
      }
    },
    [bookingToken, clientTimezone],
  );

  useEffect(() => {
    if (selectedDate) {
      setSelectedTime(null);
      void loadSlots(selectedDate);
    }
  }, [selectedDate, loadSlots]);

  useEffect(() => {
    if (slotsLoading || !selectedDate) return;
    if (slots.length === 0) {
      setSelectedTime(null);
      return;
    }
    setSelectedTime((prev) => {
      const normalized = prev?.substring(0, 5);
      if (normalized && slots.includes(normalized)) return prev;
      return slots[0];
    });
  }, [selectedDate, slots, slotsLoading]);

  const effectiveAvailability = useMemo(() => {
    if (!config) return null;
    return resolveCategoryAvailabilityForLead(
      config.settings,
      config.lead.main_category_id ?? null,
    );
  }, [config]);

  const unavailableDates = useMemo(
    () => config?.settings.unavailable_dates || [],
    [config?.settings.unavailable_dates],
  );

  const calendarDays = useMemo(() => {
    if (!config || !effectiveAvailability) return [];
    const year = viewMonth.getFullYear();
    const month = viewMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const maxDate = new Date();
    maxDate.setDate(maxDate.getDate() + (config.settings.max_days_ahead || 60));
    const allowedDays = effectiveAvailability.days_of_week || [];

    const cells: Array<{
      date: string | null;
      day: number | null;
      isSelectable: boolean;
      isToday: boolean;
      isSelected: boolean;
    }> = [];

    for (let i = 0; i < firstDay; i += 1) {
      cells.push({ date: null, day: null, isSelectable: false, isToday: false, isSelected: false });
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const dateKey = toDateKey(year, month, day);
      const cellDate = new Date(year, month, day);
      const dow = cellDate.getDay();
      const inRange = cellDate >= today && cellDate <= maxDate;
      const allowedDay = allowedDays.includes(dow);
      const blockedDate = isClientBookingDateBlocked(dateKey, unavailableDates, clientTimezone);
      cells.push({
        date: dateKey,
        day,
        isSelectable: inRange && allowedDay && !blockedDate,
        isToday: cellDate.getTime() === today.getTime(),
        isSelected: selectedDate === dateKey,
      });
    }

    return cells;
  }, [config, viewMonth, selectedDate, effectiveAvailability, unavailableDates, clientTimezone]);

  const contactsWithReach = useMemo(() => {
    if (!config?.contacts) return [];
    return config.contacts.filter((c) => c.email || c.mobile || c.phone);
  }, [config]);

  const handleConfirmTime = () => {
    if (!selectedDate || !selectedTime) return;
    const normalized = selectedTime.substring(0, 5);
    if (slots.length > 0 && !slots.includes(normalized)) {
      toast.error('This time is not available. Please choose another.');
      return;
    }
    if (contactsWithReach.length === 0) {
      toast.error('No contacts with email or phone on file. Please contact our office.');
      return;
    }
    setStep('contact');
    if (!selectedContact && contactsWithReach.length === 1) {
      setSelectedContact(contactsWithReach[0]);
    }
  };

  const handleBook = async () => {
    if (!selectedDate || !selectedTime || !selectedContact) return;
    setSubmitting(true);
    try {
      const result = await bookPublicMeeting(bookingToken, {
        date: selectedDate,
        time: selectedTime,
        contact_id: selectedContact.id,
        meeting_location: selectedLocation,
        notes: notes.trim() || undefined,
        client_timezone: clientTimezone,
      });
      const jerusalemTime = result.meeting.time?.substring(0, 5) || selectedTime.substring(0, 5);
      const display = formatMeetingForClientDisplay(
        result.meeting.date,
        jerusalemTime,
        clientTimezone,
      );
      setConfirmedMeeting({
        date: display?.clientDate || selectedDate,
        time: display?.clientTime || selectedTime.substring(0, 5),
        timeWithZone:
          display?.clientTimeWithZone
          || formatBookingTimeWithZone(selectedTime, clientTimezone, selectedDate || undefined),
        israelTimeWithZone: display?.israelTimeWithZone,
        location: result.meeting.location,
      });
      setScheduledMeetings(result.scheduled_meetings ?? []);
      await loadScheduledMeetings();
      setStep('done');
      onBooked?.();
      if (result.warnings?.length) {
        toast.success('Meeting confirmed!');
        toast.error(result.warnings.join(' · '), { duration: 8000 });
      } else {
        toast.success('Meeting confirmed!');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Booking failed');
    } finally {
      setSubmitting(false);
    }
  };

  const resetBooking = () => {
    setStep('datetime');
    setBookingOpen(variant === 'embedded');
    setSelectedDate(null);
    setSelectedTime(null);
    setSelectedLocation('Teams');
    setNotes('');
    setConfirmedMeeting(null);
    if (defaultContactId && config?.contacts) {
      const match = config.contacts.find((c) => Number(c.id) === Number(defaultContactId));
      setSelectedContact(match || null);
    } else {
      setSelectedContact(null);
    }
  };

  if (loading) {
    return embedded ? <PortalLoading className="py-12" /> : <PortalLoading className="py-24" />;
  }

  if (error || !config) {
    return (
      <PortalCard className={embedded ? undefined : 'mx-auto max-w-lg text-center'}>
        <h3 className="text-lg font-semibold text-gray-900">Scheduling unavailable</h3>
        <p className="mt-2 text-sm text-base-content/55">
          {error || 'This link is invalid or has been disabled.'}
        </p>
      </PortalCard>
    );
  }

  const { settings, host, lead } = config;
  const leadRef = lead.lead_ref || lead.lead_number;
  const portalUrl = portalMeetingsUrl(leadRef);

  const timezoneBanner = (
    <div className="space-y-1 text-sm text-base-content/60">
      <p>Times shown in your local time ({formatTimezoneLabel(clientTimezone)}).</p>
      {clientTimezone !== BUSINESS_TZ ? (
        <p className="text-xs text-base-content/50">
          Our office schedules in Israel ({formatTimezoneLabel(BUSINESS_TZ)}).
        </p>
      ) : null}
    </div>
  );

  const confirmationCard = confirmedMeeting ? (
    <PortalCard className={embedded ? undefined : 'max-w-xl'}>
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 text-xl font-bold text-emerald-600">
          ✓
        </div>
        <div>
          <p className="font-semibold text-gray-900">Meeting confirmed</p>
          <p className="text-sm text-base-content/50">{formatBookingDisplayDate(confirmedMeeting.date)}</p>
        </div>
      </div>
      <dl className="mt-5 grid gap-2 text-sm text-gray-700 sm:grid-cols-2">
        <div>
          <dt className="text-base-content/45">Time</dt>
          <dd className="font-medium">{confirmedMeeting.timeWithZone}</dd>
          {confirmedMeeting.israelTimeWithZone && clientTimezone !== BUSINESS_TZ ? (
            <dd className="mt-1 text-xs text-base-content/45">
              Israel office: {confirmedMeeting.israelTimeWithZone}
            </dd>
          ) : null}
        </div>
        <div>
          <dt className="text-base-content/45">Duration</dt>
          <dd className="font-medium">{settings.duration_minutes} min</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-base-content/45">Location</dt>
          <dd className="font-medium">{confirmedMeeting.location}</dd>
        </div>
      </dl>
      <div className="mt-6 flex flex-col gap-2 sm:flex-row">
        {!embedded && !inClientPortal && portalUrl ? (
          <Link to={portalUrl} className="btn btn-primary flex-1 rounded-full">
            View in client portal
          </Link>
        ) : null}
        <button type="button" className="btn btn-outline flex-1 rounded-full" onClick={resetBooking}>
          Schedule another
        </button>
      </div>
    </PortalCard>
  ) : null;

  const bookingFlow = (
    <section className={`space-y-4 ${!bookingOpen && step === 'datetime' && usePublicExperience ? 'pb-4' : ''}`}>
      <PortalSectionLabel>{embedded ? 'Schedule a meeting' : 'Book a new meeting'}</PortalSectionLabel>
      {timezoneBanner}

      {step === 'done' && confirmationCard ? (
        confirmationCard
      ) : !bookingOpen && step === 'datetime' && usePublicExperience ? (
        <button
          type="button"
          className="btn btn-primary btn-lg mb-10 gap-2 rounded-full px-8"
          onClick={() => setBookingOpen(true)}
        >
          <CalendarDaysIcon className="h-5 w-5" />
          Schedule new meeting
        </button>
      ) : step === 'contact' ? (
        <PortalCard>
          <button
            type="button"
            className="btn btn-ghost btn-sm -ml-2 mb-2 gap-1 rounded-full"
            onClick={() => setStep('datetime')}
          >
            <ChevronLeftIcon className="h-4 w-4" />
            Back to calendar
          </button>
          <h3 className="text-lg font-bold text-gray-900">Confirm your details</h3>
          <p className="mt-1 text-sm text-base-content/55">
            {formatBookingDisplayDate(selectedDate!)} at{' '}
            {formatBookingTimeWithZone(selectedTime!, clientTimezone, selectedDate || undefined)}
          </p>

          <div className="mt-6">
            <p className="mb-2 text-sm font-medium text-gray-900">Meeting location</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {CLIENT_BOOKING_LOCATION_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition-colors ${
                    selectedLocation === opt.value
                      ? 'border-primary bg-primary/5 ring-1 ring-primary/25'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="booking-location"
                    className="radio radio-primary radio-sm mt-0.5"
                    checked={selectedLocation === opt.value}
                    onChange={() => setSelectedLocation(opt.value)}
                  />
                  <div>
                    <p className="flex items-center gap-2 font-medium text-gray-900">
                      {opt.value === 'Teams' ? (
                        <VideoCameraIcon className="h-4 w-4 text-gray-500" />
                      ) : (
                        <MapPinIcon className="h-4 w-4 text-gray-500" />
                      )}
                      {opt.label}
                    </p>
                    <p className="mt-1 text-xs text-base-content/50">{opt.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="mt-6">
            <p className="mb-2 text-sm font-medium text-gray-900">Confirmation recipient</p>
            <div className="space-y-2">
              {contactsWithReach.map((contact) => (
                <label
                  key={contact.id}
                  className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition-colors ${
                    selectedContact?.id === contact.id
                      ? 'border-primary bg-primary/5 ring-1 ring-primary/25'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="booking-contact"
                    className="radio radio-primary radio-sm mt-0.5"
                    checked={selectedContact?.id === contact.id}
                    onChange={() => setSelectedContact(contact)}
                  />
                  <div>
                    <p className="font-medium text-gray-900">{contact.name}</p>
                    {contact.email ? <p className="text-xs text-base-content/50">{contact.email}</p> : null}
                    {contact.mobile || contact.phone ? (
                      <p className="text-xs text-base-content/50">{contact.mobile || contact.phone}</p>
                    ) : null}
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="mt-4">
            <label className="mb-2 block text-sm font-medium text-gray-900" htmlFor="booking-notes">
              Notes (optional)
            </label>
            <textarea
              id="booking-notes"
              className="textarea textarea-bordered w-full rounded-2xl"
              rows={3}
              placeholder="Anything we should know?"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <button
            type="button"
            className="btn btn-primary mt-6 w-full rounded-full sm:w-auto sm:min-w-[200px]"
            disabled={!selectedContact || submitting}
            onClick={() => void handleBook()}
          >
            {submitting ? 'Scheduling…' : 'Confirm meeting'}
          </button>
        </PortalCard>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <PortalCard>
            <h3 className="text-lg font-bold text-gray-900">Select a date</h3>
            <div className="mt-4 flex items-center justify-between">
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-circle"
                onClick={() => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
              >
                <ChevronLeftIcon className="h-5 w-5" />
              </button>
              <span className="font-semibold text-gray-800">
                {MONTH_NAMES[viewMonth.getMonth()]} {viewMonth.getFullYear()}
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-circle"
                onClick={() => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
              >
                <ChevronRightIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-3 grid grid-cols-7 gap-1 text-center text-xs font-semibold uppercase tracking-wide text-base-content/40">
              {DAY_LABELS.map((d) => (
                <div key={d} className="py-1">{d}</div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {calendarDays.map((cell, idx) => {
                if (!cell.day) return <div key={`empty-${idx}`} />;
                return (
                  <button
                    key={cell.date!}
                    type="button"
                    disabled={!cell.isSelectable}
                    onClick={() => {
                      setSelectedDate(cell.date);
                      setSelectedTime(null);
                    }}
                    className={`aspect-square rounded-full text-sm font-medium transition-colors ${
                      cell.isSelected
                        ? 'bg-primary text-primary-content shadow-sm'
                        : cell.isSelectable
                          ? 'text-gray-800 hover:bg-primary/10'
                          : 'cursor-not-allowed text-gray-300'
                    } ${cell.isToday && !cell.isSelected ? 'ring-2 ring-primary/30' : ''}`}
                  >
                    {cell.day}
                  </button>
                );
              })}
            </div>
          </PortalCard>

          <PortalCard className="flex flex-col">
            <h3 className="text-lg font-bold text-gray-900">Select a time</h3>
            {selectedDate ? (
              <>
                <p className="mt-1 text-sm text-base-content/55">{formatBookingDisplayDate(selectedDate)}</p>
                <div className="mt-4 flex flex-col gap-4">
                  <BookingTimeWheel
                    value={selectedTime}
                    onChange={setSelectedTime}
                    loading={slotsLoading}
                    dayUnavailable={!slotsLoading && slots.length === 0}
                    allowedTimes={slots}
                  />
                  {!slotsLoading && slots.length > 0 && clientTimezone !== BUSINESS_TZ ? (
                    <p className="text-center text-xs text-base-content/45">
                      Only times within our Israel office hours are available in your timezone.
                    </p>
                  ) : null}
                  {selectedTime ? (
                    <p className="text-center text-sm font-medium text-gray-700">
                      Selected: {formatBookingTimeWithZone(selectedTime, clientTimezone, selectedDate)}
                    </p>
                  ) : null}
                  {!slotsLoading && selectedTime && slots.length > 0 ? (
                    <button
                      type="button"
                      className="btn btn-primary w-full rounded-full sm:self-center sm:px-10"
                      onClick={handleConfirmTime}
                    >
                      Continue
                    </button>
                  ) : null}
                </div>
              </>
            ) : (
              <p className="mt-6 flex flex-1 items-center text-sm text-base-content/45">
                Choose a date on the left to see available times.
              </p>
            )}
          </PortalCard>
        </div>
      )}
    </section>
  );

  if (embedded) {
    return bookingFlow;
  }

  if (step === 'done' && confirmedMeeting) {
    return (
      <PortalTabFrame
        title="You're scheduled"
        subtitle={`A confirmation was sent to ${selectedContact?.name || 'your contact'}.`}
        headerCoverImage={getPortalTabHeaderCoverImage('meetings')}
      >
        {confirmationCard}
        {!hideScheduledMeetings ? (
          <ScheduledMeetingsSection
            meetings={scheduledMeetings}
            clientTimezone={clientTimezone}
            durationMinutes={settings.duration_minutes}
          />
        ) : null}
      </PortalTabFrame>
    );
  }

  return (
    <PortalTabFrame
      title={settings.title}
      subtitle={
        lead.display_name
          ? `Schedule with ${host.name || 'our team'} · Case: ${lead.display_name}`
          : `Schedule with ${host.name || 'our team'}`
      }
      headerCoverImage={getPortalTabHeaderCoverImage('meetings')}
    >
      {!hideScheduledMeetings ? (
        <ScheduledMeetingsSection
          meetings={scheduledMeetings}
          clientTimezone={clientTimezone}
          durationMinutes={settings.duration_minutes}
        />
      ) : null}
      {bookingFlow}
    </PortalTabFrame>
  );
};

export default ClientBookingScheduler;
