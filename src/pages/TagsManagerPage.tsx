import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeftIcon } from '@heroicons/react/24/solid';
import { FlagIcon, TagIcon } from '@heroicons/react/24/outline';
import TagsManagerReport, { FlagsManagerReport, TagsManagerShellTitle } from '../components/reports/TagsManagerReport';
import { fetchCurrentEmployeeContext } from '../lib/employeeLeadReporting';

type ManagerTab = 'tags' | 'flags';

function includesEmployee(ids: number[], employeeId: number | null): boolean {
  return employeeId != null && ids.includes(employeeId);
}

export default function TagsManagerPage() {
  const [tab, setTab] = useState<ManagerTab>('tags');
  const [dateSlot, setDateSlot] = useState<HTMLDivElement | null>(null);
  const [loggedInEmployeeId, setLoggedInEmployeeId] = useState<number | null>(null);
  const [employeeResolved, setEmployeeResolved] = useState(false);
  const [mineRequest, setMineRequest] = useState<{
    tags: { nonce: number; include: boolean } | null;
    flags: { nonce: number; include: boolean } | null;
  }>({ tags: null, flags: null });
  const [tagsEmployeeIds, setTagsEmployeeIds] = useState<number[]>([]);
  const [flagsEmployeeIds, setFlagsEmployeeIds] = useState<number[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetchCurrentEmployeeContext()
      .then((ctx) => {
        if (!cancelled) setLoggedInEmployeeId(ctx?.employeeId ?? null);
      })
      .catch(() => {
        if (!cancelled) setLoggedInEmployeeId(null);
      })
      .finally(() => {
        if (!cancelled) setEmployeeResolved(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleMine = (next: ManagerTab) => {
    const ids = next === 'tags' ? tagsEmployeeIds : flagsEmployeeIds;
    const include = !includesEmployee(ids, loggedInEmployeeId);
    setMineRequest((current) => ({
      ...current,
      [next]: { nonce: (current[next]?.nonce ?? 0) + 1, include },
    }));
  };

  const onTagsEmployees = useCallback((ids: number[]) => setTagsEmployeeIds(ids), []);
  const onFlagsEmployees = useCallback((ids: number[]) => setFlagsEmployeeIds(ids), []);

  const mineButtonClass = (active: boolean) =>
    `inline-flex items-center rounded-full px-4 py-1.5 text-sm font-semibold ring-1 transition-colors ${
      active
        ? 'bg-white text-gray-900 ring-gray-200 shadow-sm'
        : 'bg-[#d5d5d5] text-gray-600 ring-transparent hover:bg-[#c8c8c8]'
    }`;

  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-[#ececec]">
      <div className="mx-auto max-w-[1600px] px-4 py-4 md:px-6 md:py-6">
        <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <TagsManagerShellTitle mode={tab} />
          <Link to="/reports" className="btn btn-ghost btn-sm self-start sm:self-auto shrink-0">
            <ArrowLeftIcon className="w-4 h-4 mr-2" />
            Back to Reports
          </Link>
        </div>

        <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div role="tablist" aria-label="Tags or flags" className="inline-flex shrink-0 rounded-full bg-white p-1 shadow-sm ring-1 ring-gray-100">
              {([
                { id: 'tags' as const, label: 'Tags', icon: TagIcon },
                { id: 'flags' as const, label: 'Flags', icon: FlagIcon },
              ]).map((item) => {
                const selected = tab === item.id;
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setTab(item.id)}
                    className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                      selected ? 'bg-primary text-primary-content shadow-sm' : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                    {item.label}
                  </button>
                );
              })}
            </div>
            {tab === 'tags' ? (
              <button
                type="button"
                className={mineButtonClass(includesEmployee(tagsEmployeeIds, loggedInEmployeeId))}
                onClick={() => toggleMine('tags')}
              >
                My Tags
              </button>
            ) : (
              <button
                type="button"
                className={mineButtonClass(includesEmployee(flagsEmployeeIds, loggedInEmployeeId))}
                onClick={() => toggleMine('flags')}
              >
                My Flags
              </button>
            )}
          </div>
          <div ref={setDateSlot} className="flex min-w-0 flex-wrap items-center gap-3 lg:justify-end" />
        </div>

        {tab === 'tags' ? (
          <TagsManagerReport
            dateSlot={dateSlot}
            loggedInEmployeeId={loggedInEmployeeId}
            employeeResolved={employeeResolved}
            mineRequest={mineRequest.tags}
            onEmployeeIds={onTagsEmployees}
          />
        ) : (
          <FlagsManagerReport
            dateSlot={dateSlot}
            loggedInEmployeeId={loggedInEmployeeId}
            employeeResolved={employeeResolved}
            mineRequest={mineRequest.flags}
            onEmployeeIds={onFlagsEmployees}
          />
        )}
      </div>
    </div>
  );
}
