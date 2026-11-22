import React, { useEffect, useRef, useState } from 'react';
import { ChevronDownIcon, MinusIcon } from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import {
  allocationPercentToWorkedMs,
  snapAllocationPercent,
  formatAllocationPercent,
  formatAllocationWorkedDuration,
} from '../../lib/employeeLeadReporting';
import { createCustomWorkEffort } from '../../lib/customWorkEfforts';
import {
  fetchAgreementScoreboardDepartments,
  GENERAL_EFFORT_DEPARTMENT_LABEL,
  type ScoreboardDepartment,
} from '../../lib/scoreboardDepartments';
import {
  effortCategories,
  effortsForArea,
  WORK_AREAS,
  isEffortArea,
  type EffortAreaId,
  type EffortTimeDraft,
  type WorkEffort,
} from '../../lib/workAreaEfforts';
import EffortLinkPicker from './EffortLinkPicker';
import AllocationTimeBadge from './AllocationTimeBadge';
import type { DayMeeting } from '../../lib/dayMeetings';
import { MEETING_HEADER_COLORS, type MeetingHeaderKind } from '../../lib/meetingHeaderColors';

type Props = {
  drafts: Record<string, EffortTimeDraft>;
  customEfforts: WorkEffort[];
  onEffortCreated: (effort: WorkEffort) => void;
  onDraftChange: (effortId: string, patch: Partial<EffortTimeDraft>) => void;
  readOnly?: boolean;
  dayWorkedMs?: number;
  /** Whole day so far, Handling plus every effort. Sliders cannot push this past 100. */
  dayTotalPercent?: number;
  meetingsByEffort?: Record<string, DayMeeting[]>;
};

const KIND_LABEL: Record<MeetingHeaderKind, string> = {
  active_client: 'Active client',
  potential_client: 'Potential client',
  internal_meeting: 'Internal',
  external_meeting: 'With externals',
};

const TITLE_TIME_BADGE_CLASS =
  'inline-flex min-w-[4.5rem] items-center justify-center rounded-full bg-gray-100 px-2.5 py-0.5 text-sm font-semibold tabular-nums text-gray-500';

const TIME_BADGE_CLASS =
  'inline-flex min-w-[4.5rem] items-center justify-center rounded-full px-2.5 py-0.5 text-sm font-semibold tabular-nums';

function EffortDepartmentsField({
  ids,
  departments,
  readOnly,
  effortName,
  onChange,
}: {
  ids: number[];
  departments: ScoreboardDepartment[];
  readOnly: boolean;
  effortName: string;
  onChange: (ids: number[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const choices = departments.filter((department) => department.name.toLowerCase() !== 'general');
  const selected = choices.filter((department) => ids.includes(department.id));
  const summary =
    selected.length === 0
      ? GENERAL_EFFORT_DEPARTMENT_LABEL
      : selected.length === 1
        ? selected[0].name
        : `${selected[0].name} +${selected.length - 1}`;

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [open]);

  const toggle = (id: number) => {
    onChange(ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);
  };

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        disabled={readOnly}
        aria-label={`${effortName} departments`}
        aria-expanded={open}
        title={selected.length === 0 ? GENERAL_EFFORT_DEPARTMENT_LABEL : selected.map((department) => department.name).join(', ')}
        className="inline-flex h-10 w-36 items-center justify-between gap-2 rounded-[14px] bg-transparent px-3 text-left text-sm text-gray-900 ring-1 ring-gray-300/80 hover:bg-gray-50 disabled:opacity-60"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="truncate">{summary}</span>
        <ChevronDownIcon className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
      </button>
      {open && !readOnly ? (
        <ul className="absolute left-0 z-40 mt-1 max-h-64 w-64 overflow-y-auto rounded-2xl bg-white p-1 shadow-xl ring-1 ring-black/10">
          <li>
            <label className="flex cursor-pointer items-center gap-2 rounded-xl px-2 py-1.5 text-sm hover:bg-gray-50">
              <input
                type="checkbox"
                className="checkbox checkbox-primary checkbox-xs"
                checked={ids.length === 0}
                onChange={() => onChange([])}
              />
              {GENERAL_EFFORT_DEPARTMENT_LABEL}
            </label>
          </li>
          {choices.map((department) => (
            <li key={department.id}>
              <label className="flex cursor-pointer items-center gap-2 rounded-xl px-2 py-1.5 text-sm hover:bg-gray-50">
                <input
                  type="checkbox"
                  className="checkbox checkbox-primary checkbox-xs"
                  checked={ids.includes(department.id)}
                  onChange={() => toggle(department.id)}
                />
                <span className="min-w-0 truncate">{department.name}</span>
              </label>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Time needs a clocked day. With no From/To, show the share so the slider still moves a number. */
function effortShareLabel(dayWorkedMs: number, percent: number): string {
  if (dayWorkedMs > 0) {
    return formatAllocationWorkedDuration(allocationPercentToWorkedMs(dayWorkedMs, percent));
  }
  return `${formatAllocationPercent(percent)}%`;
}

const WorkEffortAllocator: React.FC<Props> = ({
  drafts,
  customEfforts,
  onEffortCreated,
  onDraftChange,
  readOnly = false,
  dayWorkedMs = 0,
  dayTotalPercent = 0,
  meetingsByEffort = {},
}) => {
  const [departments, setDepartments] = useState<ScoreboardDepartment[]>([]);
  const [openedIds, setOpenedIds] = useState<Record<string, true>>({});
  const [addingArea, setAddingArea] = useState<EffortAreaId | null>(null);
  const [newEffortName, setNewEffortName] = useState('');
  const [savingEffort, setSavingEffort] = useState(false);
  const [openMeetings, setOpenMeetings] = useState<{ title: string; meetings: DayMeeting[] } | null>(null);

  useEffect(() => {
    if (!openMeetings) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMeetings(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openMeetings]);

  useEffect(() => {
    let cancelled = false;
    void fetchAgreementScoreboardDepartments()
      .then((list) => {
        if (!cancelled) setDepartments(list);
      })
      .catch((error) => {
        console.error('[WorkEffortAllocator] departments failed:', error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const areas = WORK_AREAS.filter((area) => isEffortArea(area.id));
  if (areas.length === 0) return null;

  return (
    <div className="w-full space-y-8">
      {areas.map((area) => {
        const catalog = effortsForArea(area.id);
        const added = customEfforts.filter((effort) => effort.area === area.id);
        const areaPercent = [...catalog, ...added].reduce(
          (sum, effort) => sum + Number(drafts[effort.id]?.percent || 0),
          0,
        );
        const meetings = catalog.filter((effort) => effort.id.endsWith('.meetings'));
        const catalogRest = catalog.filter((effort) => !effort.id.endsWith('.meetings'));
        const isShown = (effort: WorkEffort) =>
          Boolean(openedIds[effort.id]) || Number(drafts[effort.id]?.percent || 0) > 0;
        const shownExtra = [...catalogRest, ...added].filter(isShown);
        const availableGroups = effortCategories(area.id)
          .map((group) => ({
            ...group,
            efforts: group.efforts.filter((effort) => !effort.id.endsWith('.meetings') && !isShown(effort)),
          }))
          .filter((group) => group.efforts.length > 0);
        const availableCustom = added.filter((effort) => !isShown(effort));

        const renderEffort = (effort: WorkEffort) => {
          const draft = drafts[effort.id];
          const percent = Number(draft?.percent || 0);
          const departmentIds = draft?.departmentIds ?? [];
          const sliderCap = Math.min(100, percent + Math.max(0, 100 - dayTotalPercent));
          const snappedPercent = snapAllocationPercent(percent, dayWorkedMs, 0, sliderCap);
          return (
            <li
              key={effort.id}
              className="flex flex-wrap items-center gap-3 py-3 sm:flex-nowrap"
            >
              <p className="w-full shrink-0 text-sm font-medium text-gray-900 sm:w-52">
                <span className="inline-flex items-center gap-2">
                  {!readOnly && !effort.id.endsWith('.meetings') ? (
                    <button
                      type="button"
                      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-400 hover:bg-red-200 hover:text-red-500"
                      aria-label={`Move ${effort.name} back to the list`}
                      title="Move back to the list"
                      onClick={() => {
                        setOpenedIds((current) => {
                          const next = { ...current };
                          delete next[effort.id];
                          return next;
                        });
                        onDraftChange(effort.id, {
                          percent: 0,
                          departmentIds: [],
                          firms: [],
                          leads: [],
                        });
                      }}
                    >
                      <MinusIcon className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  ) : null}
                  {effort.name}
                  {(meetingsByEffort[effort.id] || []).length > 0 ? (
                    <button
                      type="button"
                      className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-800 hover:bg-sky-200"
                      aria-label={`${meetingsByEffort[effort.id].length} meetings in ${area.label}`}
                      onClick={() =>
                        setOpenMeetings({
                          title: `${area.label} meetings`,
                          meetings: meetingsByEffort[effort.id],
                        })
                      }
                    >
                      {meetingsByEffort[effort.id].length}
                    </button>
                  ) : null}
                </span>
              </p>
              <EffortDepartmentsField
                ids={departmentIds}
                departments={departments}
                readOnly={readOnly}
                effortName={effort.name}
                onChange={(next) => onDraftChange(effort.id, { departmentIds: next })}
              />
              <EffortLinkPicker
                firms={draft?.firms ?? []}
                leads={draft?.leads ?? []}
                readOnly={readOnly}
                persists={percent > 0}
                onChange={(next) => onDraftChange(effort.id, next)}
              />
              <input
                type="range"
                min={0}
                max={100}
                step="any"
                value={snappedPercent}
                disabled={readOnly}
                aria-label={`${effort.name} time`}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (!Number.isFinite(next)) return;
                  onDraftChange(effort.id, {
                    percent: snapAllocationPercent(next, dayWorkedMs, 0, sliderCap),
                  });
                }}
                className={`effort-allocation-range range range-primary min-w-0 flex-1 cursor-grab active:cursor-grabbing ${
                  readOnly ? 'pointer-events-none opacity-60' : ''
                }`}
              />
              <AllocationTimeBadge
                percent={snappedPercent}
                dayWorkedMs={dayWorkedMs}
                maxPercent={sliderCap}
                readOnly={readOnly}
                className={TIME_BADGE_CLASS}
                onChange={(next) =>
                  onDraftChange(effort.id, {
                    percent: snapAllocationPercent(next, dayWorkedMs, 0, sliderCap),
                  })
                }
              />
            </li>
          );
        };

        const submitEffort = async () => {
          const name = newEffortName.trim();
          if (name.length < 2 || savingEffort) return;
          setSavingEffort(true);
          try {
            const effort = await createCustomWorkEffort(area.id, name);
            onEffortCreated(effort);
            setOpenedIds((current) => ({ ...current, [effort.id]: true }));
            setNewEffortName('');
            setAddingArea(null);
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Could not add that effort.');
          } finally {
            setSavingEffort(false);
          }
        };

        return (
        <section key={area.id} id={`allocation-${area.id}`} className="scroll-mt-16">
          <div className="mb-3 flex items-center gap-3">
            <h2 className="text-lg font-bold text-gray-900">{area.label}</h2>
            <span className={TITLE_TIME_BADGE_CLASS}>
              {effortShareLabel(dayWorkedMs, areaPercent)}
            </span>
          </div>
          <div className="rounded-[18px] bg-white px-5 py-2 shadow-sm">
            <ul className="divide-y divide-gray-100">
              {meetings.map(renderEffort)}
              {shownExtra.map(renderEffort)}
            </ul>
            {!readOnly ? (
              <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 py-3">
                <select
                  aria-label={`Add an effort in ${area.label}`}
                  value=""
                  className="h-10 w-48 min-w-0 max-w-[12rem] shrink-0 rounded-[14px] bg-gray-50 px-3 text-sm text-gray-700 ring-1 ring-gray-200 focus:outline-none focus:ring-2 focus:ring-primary/20"
                  onChange={(event) => {
                    const effortId = event.target.value;
                    if (!effortId) return;
                    setOpenedIds((current) => ({ ...current, [effortId]: true }));
                  }}
                >
                  <option value="">Add an effort</option>
                  {availableGroups.map((group) => (
                    <optgroup key={group.category} label={group.category}>
                      {group.efforts.map((effort) => (
                        <option key={effort.id} value={effort.id}>
                          {effort.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                  {availableCustom.length > 0 ? (
                    <optgroup label="Added efforts">
                      {availableCustom.map((effort) => (
                        <option key={effort.id} value={effort.id}>
                          {effort.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                </select>
                <button
                  type="button"
                  className="text-sm font-medium text-primary hover:underline"
                  onClick={() => {
                    setAddingArea(area.id);
                    setNewEffortName('');
                  }}
                >
                  Add effort
                </button>
              </div>
            ) : null}
            {addingArea === area.id && !readOnly ? (
              <form
                className="flex items-center gap-2 pb-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitEffort();
                }}
              >
                <input
                  autoFocus
                  value={newEffortName}
                  onChange={(event) => setNewEffortName(event.target.value)}
                  placeholder="New effort name"
                  className="h-10 w-80 shrink-0 rounded-[14px] bg-gray-50 px-3 text-sm ring-1 ring-gray-200 focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                <button
                  type="submit"
                  className="btn btn-primary btn-sm rounded-full px-4"
                  disabled={savingEffort || newEffortName.trim().length < 2}
                >
                  Add
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm rounded-full px-4"
                  disabled={savingEffort}
                  onClick={() => {
                    setNewEffortName('');
                    setAddingArea(null);
                  }}
                >
                  Cancel
                </button>
              </form>
            ) : null}
          </div>
        </section>
        );
      })}
      {openMeetings ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onMouseDown={() => setOpenMeetings(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={openMeetings.title}
            className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-gray-900">{openMeetings.title}</h3>
              <button
                type="button"
                className="text-sm text-gray-500 hover:text-gray-800"
                onClick={() => setOpenMeetings(null)}
              >
                Close
              </button>
            </div>
            <ul className="mt-3 max-h-80 space-y-2 overflow-y-auto">
              {openMeetings.meetings.map((meeting) => (
                <li key={meeting.id} className="rounded-xl bg-gray-50 px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-gray-900">
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
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
      <style>{`
        .effort-allocation-range {
          --range-thumb: #ffffff;
          --range-thumb-size: 1.125rem;
          --range-progress: var(--color-primary);
          --range-bg: color-mix(in srgb, var(--color-primary) 16%, white);
          --range-p: 0.25rem;
          color: var(--color-primary);
          width: auto;
          min-width: 8rem;
          flex: 1 1 8rem;
          touch-action: pan-x;
        }
        .effort-allocation-range::-webkit-slider-thumb {
          border-radius: 9999px;
        }
        .effort-allocation-range::-moz-range-thumb {
          border-radius: 9999px;
        }
      `}</style>
    </div>
  );
};

export default WorkEffortAllocator;
