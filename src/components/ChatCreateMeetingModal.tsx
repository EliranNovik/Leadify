import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDaysIcon,
  ClockIcon,
  MapPinIcon,
  PlusIcon,
  TrashIcon,
  UserGroupIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import {
  bookLeadMeeting,
  decideMeetingCalendar,
  formatMeetingDate,
  loadLeadForMeeting,
  loadMeetingLocations,
  loadMeetingStaffOptions,
  meetingDateInDays,
  meetingTodayIso,
  normalizeMeetingTimeInput,
  type AiMeetingEmployeeRef,
  type AiMeetingLead,
  type AiMeetingLocation,
  type AiMeetingSummary,
} from '../lib/aiMeetingBooking';
import { fetchStageActorInfo } from '../lib/leadStageManager';

/** Whatever the chat knows about the client whose page is open. */
export type ChatCreateMeetingLead = {
  id?: string | number | null;
  lead_number?: string | null;
  name?: string | null;
  lead_type?: string | null;
};

/** Somebody outside the firm who is sitting in: a clerk, a banker, an accountant. */
type GuestDraft = { key: number; name: string; email: string; phone: string };

/** One meeting being filled in. Several can be queued up and booked in one go. */
type MeetingSlot = {
  key: number;
  date: string;
  time: string;
  location: string;
  /** Colleagues, only asked for when the location makes this an external meeting. */
  staffEmployeeIds: number[];
  guests: GuestDraft[];
};

let nextSlotKey = 1;

function newSlot(previous?: MeetingSlot, defaultStaffIds: number[] = []): MeetingSlot {
  nextSlotKey += 1;
  return {
    key: nextSlotKey,
    // A second meeting is nearly always a later day at the same hour and place.
    date: previous ? meetingDateInDays(1, new Date(`${previous.date}T12:00:00`)) : meetingDateInDays(1),
    time: previous?.time || '11:00',
    location: previous?.location || 'Teams',
    // The same colleagues usually go to the follow-up as well; the outsiders rarely do.
    staffEmployeeIds: previous ? [...previous.staffEmployeeIds] : [...defaultStaffIds],
    guests: [],
  };
}

function newGuest(): GuestDraft {
  nextSlotKey += 1;
  return { key: nextSlotKey, name: '', email: '', phone: '' };
}

/**
 * Book one or several meetings for the open client from inside the chat window, without asking the
 * model.
 *
 * The things a person has to decide are the date, the time and the location; everything else —
 * which shared Outlook calendar it lands on, the stage the lead moves to, the Teams link, the roles
 * copied onto the meeting — is the same product logic the Meeting tab applies, so it is derived
 * here rather than offered as a choice.
 */
export default function ChatCreateMeetingModal({
  open,
  lead,
  onClose,
  onBooked,
}: {
  open: boolean;
  lead: ChatCreateMeetingLead | null;
  onClose: () => void;
  onBooked: (booking: { summaries: AiMeetingSummary[]; failures: string[] }) => void;
}) {
  const [slots, setSlots] = useState<MeetingSlot[]>(() => [newSlot()]);
  const [activeKey, setActiveKey] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [locations, setLocations] = useState<AiMeetingLocation[]>([]);
  const [staffOptions, setStaffOptions] = useState<AiMeetingEmployeeRef[]>([]);
  const [signedInEmployeeId, setSignedInEmployeeId] = useState<number | null>(null);
  const [meetingLead, setMeetingLead] = useState<AiMeetingLead | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const leadId = lead?.id != null ? String(lead.id) : '';
  const isLegacy = lead?.lead_type === 'legacy' || leadId.toLowerCase().startsWith('legacy_');

  useEffect(() => {
    if (!open) return;
    const first = newSlot(undefined, signedInEmployeeId != null ? [signedInEmployeeId] : []);
    setSlots([first]);
    setActiveKey(first.key);
    setShowAll(false);
    setError(null);
    // Deliberately not reacting to the signed-in id landing later; the effect below fills it in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const [rows, loaded] = await Promise.all([
        loadMeetingLocations(),
        leadId
          ? loadLeadForMeeting({
              leadId,
              isLegacy,
              leadNumber: lead?.lead_number != null ? String(lead.lead_number) : undefined,
            })
          : Promise.resolve(null),
      ]);
      if (cancelled) return;
      setLocations(rows);
      setMeetingLead(loaded);
      if (!loaded) setError('I could not load this client, so there is nothing to book against.');
      if (rows.length > 0) {
        setSlots((current) =>
          current.map((slot) =>
            rows.some((row) => row.name === slot.location)
              ? slot
              : { ...slot, location: rows[0].name },
          ),
        );
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, leadId, isLegacy, lead?.lead_number]);

  /*
   * Whoever is signed in is going to the meeting, so they start off as a participant. Fetched once
   * per session and then only used to seed slots that nobody has touched yet.
   */
  useEffect(() => {
    if (!open || signedInEmployeeId != null) return;
    let cancelled = false;
    void (async () => {
      const actor = await fetchStageActorInfo();
      const employeeId = Number(actor?.employeeId);
      if (cancelled || !Number.isFinite(employeeId) || employeeId <= 0) return;
      setSignedInEmployeeId(employeeId);
      setSlots((current) =>
        current.map((slot) =>
          slot.staffEmployeeIds.length === 0 ? { ...slot, staffEmployeeIds: [employeeId] } : slot,
        ),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [open, signedInEmployeeId]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, saving, onClose]);

  const selectableLocations = useMemo(
    () => locations.filter((row) => row.is_active !== false),
    [locations],
  );

  /** A signed client met at a court, ministry, embassy or bank — the meetings that take people. */
  const externalSlotKeys = useMemo(() => {
    if (!meetingLead) return new Set<number>();
    return new Set(
      slots
        .filter(
          (slot) =>
            decideMeetingCalendar({ stage: meetingLead.stage, locationName: slot.location })
              .internalTypeCode === 'extern',
        )
        .map((slot) => slot.key),
    );
  }, [slots, meetingLead]);

  // The employee list is only needed once a meeting turns out to be an external one.
  useEffect(() => {
    if (externalSlotKeys.size === 0 || staffOptions.length > 0) return;
    let cancelled = false;
    void (async () => {
      const rows = await loadMeetingStaffOptions();
      if (!cancelled) setStaffOptions(rows);
    })();
    return () => {
      cancelled = true;
    };
  }, [externalSlotKeys, staffOptions.length]);

  const activeSlot = slots.find((slot) => slot.key === activeKey) || slots[0] || null;
  /*
   * One label per calendar in play. The location matters as well as the stage: a signed client's
   * meeting at a court, ministry, embassy or bank is an external meeting on the staff calendar.
   */
  const calendarLabels = meetingLead
    ? Array.from(
        new Set(
          slots.map(
            (slot) =>
              decideMeetingCalendar({ stage: meetingLead.stage, locationName: slot.location }).label,
          ),
        ),
      )
    : [];
  const leadTitle = [lead?.lead_number, lead?.name].filter(Boolean).join(' · ');

  const patchSlot = (key: number, patch: Partial<MeetingSlot>) => {
    setSlots((current) => current.map((slot) => (slot.key === key ? { ...slot, ...patch } : slot)));
  };

  const addSlot = () => {
    setSlots((current) => {
      const added = newSlot(
        current[current.length - 1],
        signedInEmployeeId != null ? [signedInEmployeeId] : [],
      );
      setActiveKey(added.key);
      return [...current, added];
    });
  };

  const removeSlot = (key: number) => {
    setSlots((current) => {
      if (current.length <= 1) return current;
      const next = current.filter((slot) => slot.key !== key);
      if (key === activeKey) setActiveKey(next[next.length - 1].key);
      return next;
    });
  };

  const submit = async () => {
    setError(null);
    if (!meetingLead) {
      setError('I could not load this client, so nothing was booked.');
      return;
    }

    // Everything is checked before anything is written, so a typo in the third meeting does not
    // leave the first two booked.
    const prepared: Array<{ slot: MeetingSlot; time: string }> = [];
    for (const [index, slot] of slots.entries()) {
      const parsedTime = normalizeMeetingTimeInput(slot.time);
      if ('error' in parsedTime) {
        setActiveKey(slot.key);
        setError(`Meeting ${index + 1}: ${parsedTime.error}`);
        return;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(slot.date)) {
        setActiveKey(slot.key);
        setError(`Meeting ${index + 1}: pick a meeting date.`);
        return;
      }
      prepared.push({ slot, time: parsedTime.time });
    }

    setSaving(true);
    const summaries: AiMeetingSummary[] = [];
    const failures: string[] = [];
    const unbooked: MeetingSlot[] = [];
    // One at a time: each booking moves the lead stage and checks the room for that hour, so they
    // have to see each other's work.
    for (const [index, item] of prepared.entries()) {
      const result = await bookLeadMeeting({
        lead: meetingLead,
        mode: 'schedule',
        date: item.slot.date,
        time: item.time,
        location: item.slot.location,
        participants: {
          // Colleagues belong to external meetings, which is also the only place they are asked for.
          staffEmployeeIds: externalSlotKeys.has(item.slot.key) ? item.slot.staffEmployeeIds : [],
          guests: item.slot.guests
            .filter((person) => person.name.trim() !== '')
            .map((person) => ({ name: person.name, email: person.email, phone: person.phone })),
        },
      });
      if (result.status === 'booked') {
        summaries.push(result.summary);
      } else {
        failures.push(`Meeting ${index + 1} (${formatMeetingDate(item.slot.date)}): ${result.message}`);
        unbooked.push(item.slot);
      }
    }
    setSaving(false);

    if (summaries.length > 0) {
      toast.success(summaries.length === 1 ? 'Meeting created' : `${summaries.length} meetings created`);
      onBooked({ summaries, failures });
    }
    if (failures.length === 0) {
      onClose();
      return;
    }
    // Leave the ones that failed on screen so they can be fixed and sent again.
    setSlots(unbooked);
    setActiveKey(unbooked[0]?.key ?? null);
    setError(failures.join(' '));
  };

  if (!open) return null;

  const createLabel = saving
    ? 'Creating…'
    : slots.length === 1
      ? 'Create meeting'
      : `Create ${slots.length} meetings`;

  return (
    <div className="fixed inset-0 z-[10060] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={() => {
          if (!saving) onClose();
        }}
      />
      <div className="relative z-10 flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 px-5 pb-2 pt-4">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-gray-900">
              {slots.length === 1 ? 'Create meeting' : `Create ${slots.length} meetings`}
            </h3>
            <p className="mt-0.5 truncate text-xs text-gray-500">
              {leadTitle || 'Open a client to book a meeting'}
            </p>
          </div>
          <button
            type="button"
            className="rounded-full p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="flex items-center justify-between gap-2 px-5 pb-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1 rounded-full bg-gray-100 p-1">
            {slots.map((slot, index) => (
              <button
                key={slot.key}
                type="button"
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                  !showAll && slot.key === activeSlot?.key
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
                onClick={() => {
                  setShowAll(false);
                  setActiveKey(slot.key);
                }}
                disabled={saving}
              >
                Meeting {index + 1}
              </button>
            ))}
            <button
              type="button"
              className="rounded-full p-1.5 text-gray-500 transition hover:bg-white hover:text-gray-800"
              onClick={addSlot}
              disabled={saving}
              aria-label="Add another meeting"
              title="Add another meeting"
            >
              <PlusIcon className="h-4 w-4" />
            </button>
          </div>
          {slots.length > 1 ? (
            <button
              type="button"
              className="shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold text-primary transition hover:bg-primary/10"
              onClick={() => setShowAll((current) => !current)}
              disabled={saving}
            >
              {showAll ? 'Show one' : 'Show all'}
            </button>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {showAll ? (
            <div className="space-y-3">
              {slots.map((slot, index) => (
                <div key={slot.key} className="rounded-2xl bg-gray-50 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wide text-gray-500">
                      Meeting {index + 1}
                    </span>
                    {slots.length > 1 ? (
                      <button
                        type="button"
                        className="rounded-full p-1 text-gray-400 transition hover:bg-white hover:text-red-500"
                        onClick={() => removeSlot(slot.key)}
                        disabled={saving}
                        aria-label={`Remove meeting ${index + 1}`}
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    ) : null}
                  </div>
                  <MeetingSlotFields
                    slot={slot}
                    locations={selectableLocations}
                    disabled={saving}
                    loadingLocations={loading}
                    isExternal={externalSlotKeys.has(slot.key)}
                    staffOptions={staffOptions}
                    onChange={(patch) => patchSlot(slot.key, patch)}
                  />
                </div>
              ))}
            </div>
          ) : activeSlot ? (
            <div className="space-y-4">
              {slots.length > 1 ? (
                <div className="flex items-center justify-end">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-gray-500 transition hover:bg-gray-100 hover:text-red-500"
                    onClick={() => removeSlot(activeSlot.key)}
                    disabled={saving}
                  >
                    <TrashIcon className="h-4 w-4" />
                    Remove this meeting
                  </button>
                </div>
              ) : null}
              <MeetingSlotFields
                slot={activeSlot}
                locations={selectableLocations}
                disabled={saving}
                loadingLocations={loading}
                isExternal={externalSlotKeys.has(activeSlot.key)}
                staffOptions={staffOptions}
                onChange={(patch) => patchSlot(activeSlot.key, patch)}
              />
            </div>
          ) : null}

          {calendarLabels.length === 1 ? (
            <p className="mt-4 rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-600">
              {slots.length === 1 ? 'Goes' : 'All of them go'} on the {calendarLabels[0]}, and the
              lead stage is updated the same way the Meeting tab does it.
            </p>
          ) : calendarLabels.length > 1 ? (
            <p className="mt-4 rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-600">
              Each meeting goes where its location calls for: {calendarLabels.join(', ')}.
            </p>
          ) : null}

          {error ? (
            <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 pb-4 pt-1">
          <button
            type="button"
            className="btn btn-ghost h-11 min-h-0 rounded-full px-4 text-sm"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn h-11 min-h-0 rounded-full bg-primary px-7 text-sm font-semibold text-white hover:bg-primary/90"
            onClick={() => void submit()}
            disabled={saving || loading || !meetingLead}
          >
            {createLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Pick colleagues by typing their name.
 *
 * A plain dropdown is unusable at this length — the firm has hundreds of employees — so the field
 * is a search box and the matches appear underneath it, the way the Meeting tab's picker works.
 */
function StaffPicker({
  selectedIds,
  options,
  disabled,
  onChange,
}: {
  selectedIds: number[];
  options: AiMeetingEmployeeRef[];
  disabled?: boolean;
  onChange: (next: number[]) => void;
}) {
  const [search, setSearch] = useState('');
  const [showList, setShowList] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDocumentClick = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setShowList(false);
    };
    document.addEventListener('mousedown', onDocumentClick);
    return () => document.removeEventListener('mousedown', onDocumentClick);
  }, []);

  const query = search.trim().toLowerCase();
  const matches = options
    .filter((person) => !selectedIds.includes(person.id))
    .filter((person) => (query ? person.name.toLowerCase().includes(query) : true))
    .slice(0, 30);
  const selected = selectedIds.map(
    (id) => options.find((person) => person.id === id) || { id, name: `Employee #${id}` },
  );

  return (
    <div ref={boxRef} className="relative">
      <input
        type="text"
        className="input input-bordered h-10 w-full text-sm"
        placeholder={options.length === 0 ? 'Loading colleagues…' : 'Search a colleague…'}
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          setShowList(true);
        }}
        onFocus={() => setShowList(true)}
        disabled={disabled || options.length === 0}
      />
      {showList ? (
        <div className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-xl border border-gray-200 bg-white shadow-lg">
          {matches.length === 0 ? (
            <p className="px-3 py-2 text-sm text-gray-500">No matches</p>
          ) : (
            matches.map((person) => (
              <button
                key={person.id}
                type="button"
                className="block w-full truncate px-3 py-2 text-left text-sm font-medium hover:bg-gray-50"
                onClick={() => {
                  onChange([...selectedIds, person.id]);
                  // Cleared so the next name can be typed straight away.
                  setSearch('');
                }}
              >
                {person.name}
              </button>
            ))
          )}
        </div>
      ) : null}
      {selected.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {selected.map((person) => (
            <span
              key={person.id}
              className="inline-flex items-center gap-1 rounded-full bg-primary/10 py-1 pl-3 pr-1 text-xs font-semibold text-primary"
            >
              {person.name}
              <button
                type="button"
                className="rounded-full p-0.5 transition hover:bg-primary/20"
                onClick={() => onChange(selectedIds.filter((id) => id !== person.id))}
                disabled={disabled}
                aria-label={`Remove ${person.name}`}
              >
                <XMarkIcon className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The date, time and location of one meeting, plus who else is coming. */
function MeetingSlotFields({
  slot,
  locations,
  disabled,
  loadingLocations,
  isExternal,
  staffOptions,
  onChange,
}: {
  slot: MeetingSlot;
  locations: AiMeetingLocation[];
  disabled?: boolean;
  loadingLocations?: boolean;
  isExternal?: boolean;
  staffOptions: AiMeetingEmployeeRef[];
  onChange: (patch: Partial<MeetingSlot>) => void;
}) {
  const patchGuest = (key: number, patch: Partial<GuestDraft>) =>
    slot.guests.map((row) => (row.key === key ? { ...row, ...patch } : row));

  /** Today and tomorrow carry most bookings, so they are one tap rather than a date picker. */
  const dayTabs = [
    { label: 'Today', iso: meetingTodayIso() },
    { label: 'Tomorrow', iso: meetingDateInDays(1) },
  ];

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-gray-600">
          <CalendarDaysIcon className="h-4 w-4" />
          Date
        </label>
        <div className="mb-2 flex gap-1.5">
          {dayTabs.map((tab) => (
            <button
              key={tab.label}
              type="button"
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                slot.date === tab.iso
                  ? 'bg-primary text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
              onClick={() => onChange({ date: tab.iso })}
              disabled={disabled}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <input
          type="date"
          className="input input-bordered h-11 w-full text-sm"
          value={slot.date}
          min={meetingTodayIso()}
          onChange={(event) => onChange({ date: event.target.value })}
          disabled={disabled}
        />
        {/^\d{4}-\d{2}-\d{2}$/.test(slot.date) ? (
          <p className="mt-1 text-xs text-gray-400">{formatMeetingDate(slot.date)}</p>
        ) : null}
      </div>

      <div>
        <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-gray-600">
          <ClockIcon className="h-4 w-4" />
          Time
        </label>
        <input
          type="time"
          className="input input-bordered h-11 w-full text-sm"
          value={slot.time}
          onChange={(event) => onChange({ time: event.target.value })}
          disabled={disabled}
        />
      </div>

      <div>
        <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-gray-600">
          <MapPinIcon className="h-4 w-4" />
          Location
        </label>
        <select
          className="select select-bordered h-11 w-full text-sm"
          value={slot.location}
          onChange={(event) => onChange({ location: event.target.value })}
          disabled={disabled || loadingLocations}
        >
          {locations.length === 0 ? <option value={slot.location}>{slot.location}</option> : null}
          {locations.map((row) => (
            <option key={row.id ?? row.name} value={row.name}>
              {row.name}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-2xl border border-gray-200 p-3">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-gray-600">
          <UserGroupIcon className="h-4 w-4" />
          {isExternal ? 'Participants and guests' : 'Guests'}
        </div>

        {isExternal ? (
          <>
            <p className="mb-2 text-xs text-gray-500">
              {slot.location} makes this an external meeting, so it can carry the people going along.
            </p>
            <label className="mb-1 block text-xs font-semibold text-gray-600">From the firm</label>
            <StaffPicker
              selectedIds={slot.staffEmployeeIds}
              options={staffOptions}
              disabled={disabled}
              onChange={(staffEmployeeIds) => onChange({ staffEmployeeIds })}
            />
            <label className="mb-1 mt-3 block text-xs font-semibold text-gray-600">Guests</label>
          </>
        ) : null}

        <div className="space-y-2">
          {slot.guests.map((person) => (
            <div key={person.key} className="rounded-xl bg-gray-50 p-2">
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  className="input input-bordered h-9 w-full text-sm"
                  placeholder="Name"
                  value={person.name}
                  onChange={(event) =>
                    onChange({ guests: patchGuest(person.key, { name: event.target.value }) })
                  }
                  disabled={disabled}
                />
                <button
                  type="button"
                  className="rounded-full p-1 text-gray-400 transition hover:bg-white hover:text-red-500"
                  onClick={() =>
                    onChange({ guests: slot.guests.filter((row) => row.key !== person.key) })
                  }
                  disabled={disabled}
                  aria-label="Remove guest"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-1.5 flex gap-1.5">
                <input
                  type="email"
                  className="input input-bordered h-9 w-full text-sm"
                  placeholder="Email (gets the invite)"
                  value={person.email}
                  onChange={(event) =>
                    onChange({ guests: patchGuest(person.key, { email: event.target.value }) })
                  }
                  disabled={disabled}
                />
                <input
                  type="tel"
                  className="input input-bordered h-9 w-full text-sm"
                  placeholder="Phone (optional)"
                  value={person.phone}
                  onChange={(event) =>
                    onChange({ guests: patchGuest(person.key, { phone: event.target.value }) })
                  }
                  disabled={disabled}
                />
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="mt-2 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-primary transition hover:bg-primary/10"
          onClick={() => onChange({ guests: [...slot.guests, newGuest()] })}
          disabled={disabled}
        >
          <PlusIcon className="h-4 w-4" />
          Add a guest
        </button>
        {slot.guests.length > 0 ? (
          <p className="mt-2 text-xs text-gray-500">
            A guest with an email address is invited to the calendar event; the rest are only
            recorded on the meeting.
          </p>
        ) : null}
      </div>
    </div>
  );
}
