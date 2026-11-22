import React from 'react';
import { Link } from 'react-router-dom';
import { WORK_AREAS, type WorkAreaId } from '../../lib/workAreaEfforts';

export type WorkAreaEffortLine = {
  key: string;
  name: string;
  time: string;
};

export type WorkAreaSummary = {
  total: string;
  efforts: WorkAreaEffortLine[];
};

type Props = {
  selected: WorkAreaId[];
  onChange: (next: WorkAreaId[]) => void;
  disabled?: boolean;
  layout?: 'row' | 'sidebar';
  summaries?: Partial<Record<WorkAreaId, WorkAreaSummary>>;
  /** When set, each area opens this page instead of filtering the current view. */
  openPath?: (id: WorkAreaId) => string;
  links?: boolean;
};

const WorkAreaTabs: React.FC<Props> = ({
  selected,
  onChange,
  disabled = false,
  layout = 'row',
  summaries,
  openPath,
  links = false,
}) => {
  const toggle = (id: WorkAreaId) => {
    if (disabled) return;
    const active = selected.includes(id);
    if (active) {
      if (selected.length === 1) return;
      onChange(selected.filter((area) => area !== id));
      return;
    }
    onChange(WORK_AREAS.map((area) => area.id).filter((area) => area === id || selected.includes(area)));
  };

  if (layout === 'sidebar') {
    return (
      <nav className="flex w-full flex-col rounded-[18px] bg-white p-2 shadow-sm" aria-label="Work areas">
        <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
          Areas
        </p>
        <ul className="flex flex-col gap-0.5">
          {WORK_AREAS.map((area) => {
            const active = selected.includes(area.id);
            const summary = summaries?.[area.id];
            const rowClass =
              'flex min-w-0 flex-1 items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50';
            const row = (
              <>
                <span className="min-w-0 truncate">{area.label}</span>
                {summary ? (
                  <span className="shrink-0 text-xs tabular-nums text-gray-500">{summary.total}</span>
                ) : null}
              </>
            );
            return (
              <li key={area.id}>
                <div className="flex items-start gap-0.5">
                {links && openPath ? (
                  <Link to={openPath(area.id)} className={rowClass}>
                    {row}
                  </Link>
                ) : (
                <button
                  type="button"
                  aria-pressed={active}
                  disabled={disabled}
                  onClick={() => toggle(area.id)}
                  className={
                    active
                      ? 'flex min-w-0 flex-1 items-center justify-between gap-2 rounded-xl bg-primary px-3 py-2.5 text-left text-sm font-semibold text-white'
                      : rowClass + ' disabled:opacity-60'
                  }
                >
                  <span className="min-w-0 truncate">{area.label}</span>
                  {summary ? (
                    <span className={`shrink-0 text-xs tabular-nums ${active ? 'text-white/90' : 'text-gray-500'}`}>
                      {summary.total}
                    </span>
                  ) : null}
                </button>
                )}
                </div>
                {summary && summary.efforts.length > 0 ? (
                  <ul className="mb-1 max-h-40 space-y-0.5 overflow-y-auto px-3 pb-1">
                    {summary.efforts.map((effort) => (
                      <li key={effort.key} className="flex items-baseline justify-between gap-2 text-xs text-gray-500">
                        <span className="min-w-0 truncate" title={effort.name}>
                          {effort.name}
                        </span>
                        <span className="shrink-0 tabular-nums">{effort.time}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      </nav>
    );
  }

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Work areas">
      {WORK_AREAS.map((area) => {
        const active = selected.includes(area.id);
        const summary = summaries?.[area.id];
        const className = links
          ? 'inline-flex h-10 items-center gap-2 rounded-full bg-white px-4 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-gray-200 transition-colors hover:bg-gray-50'
          : active
            ? 'inline-flex h-10 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-white shadow-sm'
            : 'inline-flex h-10 items-center gap-2 rounded-full bg-white px-4 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-gray-200 transition-colors hover:bg-gray-50 disabled:opacity-60';
        const label = (
          <>
            <span>{area.label}</span>
            {summary ? (
              <span className={`text-xs tabular-nums ${active && !links ? 'text-white/90' : 'text-gray-500'}`}>
                {summary.total}
              </span>
            ) : null}
          </>
        );
        if (links && openPath) {
          return (
            <Link key={area.id} to={openPath(area.id)} className={className}>
              {label}
            </Link>
          );
        }
        return (
          <button
            key={area.id}
            type="button"
            aria-pressed={active}
            disabled={disabled}
            onClick={() => toggle(area.id)}
            className={className}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
};

export default WorkAreaTabs;
