import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import type { DayMeeting, DayMeetingChoice } from '../../lib/dayMeetings';
import { MEETING_HEADER_COLORS, type MeetingHeaderKind } from '../../lib/meetingHeaderColors';
import { WORK_AREAS, isEffortArea, type EffortAreaId } from '../../lib/workAreaEfforts';

type Props = {
  meetings: DayMeeting[];
  choices: Record<number, DayMeetingChoice>;
  disabled?: boolean;
  onChoose: (meetingId: number, choice: DayMeetingChoice | null) => void;
};

const AREAS = WORK_AREAS.filter((area) => isEffortArea(area.id));

const KIND_LABEL: Record<MeetingHeaderKind, string> = {
  active_client: 'Active client',
  potential_client: 'Potential client',
  internal_meeting: 'Internal',
  external_meeting: 'With externals',
};

function choiceValue(choice: DayMeetingChoice | null): string {
  if (!choice || choice.kind !== 'area') return '';
  return `area:${choice.area}`;
}

function setAsideClass(active: boolean) {
  return `rounded-full px-2.5 py-1 text-xs font-semibold ${
    active ? 'bg-gray-800 text-white' : 'bg-gray-50 text-gray-600 ring-1 ring-gray-200 hover:bg-gray-100'
  }`;
}

const DayMeetingsStrip: React.FC<Props> = ({ meetings, choices, disabled = false, onChoose }) => {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const update = () => {
      setCanScrollLeft(el.scrollLeft > 4);
      setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [meetings.length]);

  const scrollByCard = (direction: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    const card = el.querySelector('article');
    const distance = card ? card.getBoundingClientRect().width + 12 : Math.round(el.clientWidth * 0.8);
    el.scrollBy({ left: direction * distance, behavior: 'smooth' });
  };

  if (meetings.length === 0) return null;

  const showArrows = canScrollLeft || canScrollRight;

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-gray-700">Meetings today</h2>
      <div className="relative">
        {showArrows ? (
          <button
            type="button"
            aria-label="Previous meetings"
            disabled={!canScrollLeft}
            className="absolute left-1 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white text-gray-700 shadow-md ring-1 ring-black/10 hover:bg-gray-50 disabled:pointer-events-none disabled:opacity-0"
            onClick={() => scrollByCard(-1)}
          >
            <ChevronLeftIcon className="h-5 w-5" aria-hidden />
          </button>
        ) : null}
        <div
          ref={scrollerRef}
          className={`flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth pb-1 scrollbar-hide ${
            showArrows ? 'px-11' : ''
          }`}
        >
        {meetings.map((meeting) => {
          const choice = choices[meeting.id] ?? null;
          return (
            <article
              key={meeting.id}
              className="w-64 shrink-0 snap-start rounded-[18px] bg-white p-3 shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-gray-900">
                  {meeting.time || 'Meeting'}
                  {meeting.leadNumber ? ` · #${meeting.leadNumber}` : ''}
                </p>
                <span
                  className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
                  style={{ backgroundColor: MEETING_HEADER_COLORS[meeting.kind] }}
                >
                  {KIND_LABEL[meeting.kind]}
                </span>
              </div>
              <p className="truncate text-sm text-gray-600" title={meeting.clientName}>
                {meeting.clientName}
              </p>
              {meeting.place ? <p className="truncate text-xs text-gray-400">{meeting.place}</p> : null}
              <select
                aria-label={`File meeting with ${meeting.clientName}`}
                disabled={disabled}
                value={choiceValue(choice)}
                className="mt-2 h-9 w-full rounded-[12px] bg-gray-50 px-2 text-sm text-gray-800 ring-1 ring-gray-200 focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
                onChange={(event) => {
                  const value = event.target.value;
                  if (!value) {
                    onChoose(meeting.id, null);
                    return;
                  }
                  onChoose(meeting.id, { kind: 'area', area: value.slice(5) as EffortAreaId });
                }}
              >
                <option value="">Choose where it goes</option>
                {AREAS.map((area) => (
                  <option key={area.id} value={`area:${area.id}`}>
                    {area.label}
                  </option>
                ))}
              </select>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  disabled={disabled}
                  className={setAsideClass(choice?.kind === 'disregard' && choice.reason === 'didnt_participate')}
                  onClick={() =>
                    onChoose(
                      meeting.id,
                      choice?.kind === 'disregard' && choice.reason === 'didnt_participate'
                        ? null
                        : { kind: 'disregard', reason: 'didnt_participate' },
                    )
                  }
                >
                  Didn't participate
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  className={setAsideClass(choice?.kind === 'disregard' && choice.reason === 'client_no_show')}
                  onClick={() =>
                    onChoose(
                      meeting.id,
                      choice?.kind === 'disregard' && choice.reason === 'client_no_show'
                        ? null
                        : { kind: 'disregard', reason: 'client_no_show' },
                    )
                  }
                >
                  Client didn't arrive
                </button>
              </div>
            </article>
          );
        })}
        </div>
        {showArrows ? (
          <button
            type="button"
            aria-label="Next meetings"
            disabled={!canScrollRight}
            className="absolute right-1 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white text-gray-700 shadow-md ring-1 ring-black/10 hover:bg-gray-50 disabled:pointer-events-none disabled:opacity-0"
            onClick={() => scrollByCard(1)}
          >
            <ChevronRightIcon className="h-5 w-5" aria-hidden />
          </button>
        ) : null}
      </div>
    </section>
  );
};

export default DayMeetingsStrip;
