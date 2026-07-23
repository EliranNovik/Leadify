import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ArchiveBoxIcon,
  CalendarDaysIcon,
  ChevronLeftIcon,
  DocumentTextIcon,
  EllipsisVerticalIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  TrashIcon,
  UserPlusIcon,
} from '@heroicons/react/24/outline';
import {
  buildRecruitmentCandidatePath,
  buildRecruitmentSchedulePath,
  deleteRecruitmentCandidate,
  fetchRecruitmentListRows,
  type RecruitmentListRow,
} from '../../lib/recruitmentCandidates';
import {
  buildRecruitmentContractEditorPath,
  createRecruitmentDigitalContract,
  fetchRecruitmentContractTemplates,
  fetchRecruitmentContractStatusByUserId,
  recruitmentUserDisplayName,
  type RecruitmentContractTemplateOption,
  type RecruitmentUser,
} from '../../lib/recruitmentDigitalContracts';
import {
  daysInStage,
  fetchRecruitmentStages,
  getRecruitmentStageBySlug,
  STUCK_STAGE_DAYS,
  updateCandidateStageWithHistory,
  type RecruitmentStage,
} from '../../lib/recruitmentStages';
import HrEmployeeAvatar from './HrEmployeeAvatar';

type Props = {
  isSuperUser: boolean;
  onAddUser: () => void;
  onAddEmployee?: (user?: RecruitmentUser) => void;
  refreshKey?: number;
};

type ActiveFilter = 'all' | 'active' | 'inactive';
type ContractFilter = 'all' | 'pending' | 'signed' | 'without';
type PipelineFilter = 'active' | 'all' | 'terminal';
type ContractStatus = 'pending' | 'signed';

const HrRecruitmentTab: React.FC<Props> = ({
  isSuperUser,
  onAddUser,
  onAddEmployee,
  refreshKey = 0,
}) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<RecruitmentListRow[]>([]);
  const [stages, setStages] = useState<RecruitmentStage[]>([]);
  const [contractStatusByUser, setContractStatusByUser] = useState<
    Record<string, ContractStatus>
  >({});
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('all');
  const [contractFilter, setContractFilter] = useState<ContractFilter>('all');
  const [stageFilter, setStageFilter] = useState<string>('all');
  const [pipelineFilter, setPipelineFilter] = useState<PipelineFilter>('active');
  const [templates, setTemplates] = useState<RecruitmentContractTemplateOption[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [creatingUserId, setCreatingUserId] = useState<string | null>(null);
  const [actionBusyId, setActionBusyId] = useState<number | null>(null);
  const [stageMenuOpen, setStageMenuOpen] = useState(false);
  const [actionsMenu, setActionsMenu] = useState<{
    candidateId: number;
    userId: string;
    name: string;
    stageId: number;
    stageSlug: string | null;
    employeeId: number | null;
    top: number;
    left: number;
    openUp: boolean;
  } | null>(null);
  const actionsMenuRef = useRef<HTMLDivElement | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [listRows, stageRows, tmpl, statusByUser] = await Promise.all([
        fetchRecruitmentListRows(),
        fetchRecruitmentStages().catch(() => []),
        fetchRecruitmentContractTemplates().catch(() => []),
        fetchRecruitmentContractStatusByUserId().catch(() => ({})),
      ]);
      setRows(listRows);
      setStages(stageRows);
      setContractStatusByUser(statusByUser);
      setTemplates(tmpl);
      setSelectedTemplateId((prev) => {
        if (prev && tmpl.some((t) => t.id === prev)) return prev;
        return tmpl[0]?.id || '';
      });
    } catch (error) {
      console.error('HrRecruitmentTab load:', error);
      toast.error('Failed to load recruitment pipeline');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(({ user, candidate }) => {
      if (activeFilter === 'active' && user.is_active === false) return false;
      if (activeFilter === 'inactive' && user.is_active !== false) return false;

      const status = contractStatusByUser[user.id] ?? null;
      if (contractFilter === 'pending' && status !== 'pending') return false;
      if (contractFilter === 'signed' && status !== 'signed') return false;
      if (contractFilter === 'without' && status != null) return false;

      const stage = candidate.stage || stages.find((s) => s.id === candidate.stage_id);
      if (pipelineFilter === 'active' && stage?.is_terminal) return false;
      if (pipelineFilter === 'terminal' && !stage?.is_terminal) return false;
      if (stageFilter !== 'all' && String(candidate.stage_id) !== stageFilter) return false;

      if (!q) return true;
      const name = recruitmentUserDisplayName(user).toLowerCase();
      const email = String(user.email || '').toLowerCase();
      const position = String(candidate.position_applied || '').toLowerCase();
      return name.includes(q) || email.includes(q) || position.includes(q);
    });
  }, [
    rows,
    search,
    activeFilter,
    contractFilter,
    contractStatusByUser,
    pipelineFilter,
    stageFilter,
    stages,
  ]);

  const handleCreateContract = async (user: RecruitmentUser) => {
    if (!isSuperUser) {
      toast.error('Only superusers can create digital contracts');
      return;
    }
    if (!selectedTemplateId) {
      toast.error('No employee contract template is available');
      return;
    }
    setCreatingUserId(user.id);
    try {
      const created = await createRecruitmentDigitalContract({
        userId: user.id,
        templateId: selectedTemplateId,
        contactName: recruitmentUserDisplayName(user),
        contactEmail: user.email,
      });
      toast.success('Digital contract created');
      setContractStatusByUser((prev) => ({
        ...prev,
        [user.id]: prev[user.id] === 'signed' ? 'signed' : 'pending',
      }));
      navigate(buildRecruitmentContractEditorPath(user.id, created.id));
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Failed to create contract');
    } finally {
      setCreatingUserId(null);
    }
  };

  const closeActionsMenu = useCallback(() => {
    setActionsMenu(null);
    setStageMenuOpen(false);
  }, []);

  useEffect(() => {
    if (!actionsMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeActionsMenu();
    };
    const onScroll = (e: Event) => {
      const target = e.target;
      if (
        target instanceof Node &&
        actionsMenuRef.current &&
        actionsMenuRef.current.contains(target)
      ) {
        return;
      }
      closeActionsMenu();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', closeActionsMenu);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', closeActionsMenu);
    };
  }, [actionsMenu, closeActionsMenu]);

  const openActionsMenu = (
    event: React.MouseEvent<HTMLButtonElement>,
    params: {
      candidateId: number;
      userId: string;
      name: string;
      stageId: number;
      stageSlug: string | null;
      employeeId: number | null;
    },
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const menuWidth = 260;
    const menuHeight = 320;
    const gap = 6;
    const openUp = rect.bottom + menuHeight > window.innerHeight - 8;
    const left = Math.min(
      Math.max(8, rect.right - menuWidth),
      window.innerWidth - menuWidth - 8,
    );
    const top = openUp
      ? Math.max(8, rect.top - gap)
      : Math.min(rect.bottom + gap, window.innerHeight - 8);

    if (actionsMenu?.candidateId === params.candidateId) {
      closeActionsMenu();
      return;
    }

    setStageMenuOpen(false);
    setActionsMenu({
      ...params,
      top,
      left,
      openUp,
    });
  };

  const handleSetStage = async (
    candidateId: number,
    stageId: number,
    note?: string,
  ) => {
    setActionBusyId(candidateId);
    try {
      await updateCandidateStageWithHistory({ candidateId, stageId, note });
      toast.success('Stage updated');
      await load();
    } catch (error) {
      console.error(error);
      toast.error('Failed to update stage');
    } finally {
      setActionBusyId(null);
    }
  };

  const handleArchive = async (candidateId: number, currentStageId: number) => {
    const archived = getRecruitmentStageBySlug(stages, 'archived');
    if (!archived) {
      toast.error('Archived stage is not configured');
      return;
    }
    if (archived.id === currentStageId) {
      toast('Already archived');
      return;
    }
    await handleSetStage(candidateId, archived.id, 'Archived from recruitment list');
  };

  const handleDelete = async (candidateId: number, displayName: string) => {
    if (
      !confirm(
        `Remove ${displayName} from the recruitment pipeline?\n\nThis deletes the candidate record only — the CRM user is kept.`,
      )
    ) {
      return;
    }
    setActionBusyId(candidateId);
    try {
      await deleteRecruitmentCandidate(candidateId);
      toast.success('Candidate removed from pipeline');
      await load();
    } catch (error) {
      console.error(error);
      toast.error('Failed to delete candidate');
    } finally {
      setActionBusyId(null);
    }
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const toggleSelectMode = () => {
    if (selectMode) {
      exitSelectMode();
      return;
    }
    setSelectMode(true);
    setSelectedIds(new Set());
  };

  const toggleRowSelected = (candidateId: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(candidateId)) next.delete(candidateId);
      else next.add(candidateId);
      return next;
    });
  };

  const selectableRows = useMemo(
    () =>
      filteredRows.filter(({ candidate }) => {
        const stage =
          candidate.stage || stages.find((s) => s.id === candidate.stage_id);
        return stage?.slug !== 'archived';
      }),
    [filteredRows, stages],
  );

  const allSelectableSelected =
    selectableRows.length > 0 &&
    selectableRows.every(({ candidate }) => selectedIds.has(candidate.id));

  const toggleSelectAll = () => {
    if (allSelectableSelected) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(selectableRows.map(({ candidate }) => candidate.id)));
  };

  const handleBulkArchive = async () => {
    const archived = getRecruitmentStageBySlug(stages, 'archived');
    if (!archived) {
      toast.error('Archived stage is not configured');
      return;
    }
    const ids = [...selectedIds].filter((id) => {
      const row = filteredRows.find((r) => r.candidate.id === id);
      const stage =
        row?.candidate.stage || stages.find((s) => s.id === row?.candidate.stage_id);
      return stage?.slug !== 'archived';
    });
    if (!ids.length) {
      toast('No candidates selected to archive');
      return;
    }
    if (!confirm(`Archive ${ids.length} candidate${ids.length === 1 ? '' : 's'}?`)) {
      return;
    }
    setBulkBusy(true);
    let ok = 0;
    let failed = 0;
    try {
      for (const candidateId of ids) {
        try {
          await updateCandidateStageWithHistory({
            candidateId,
            stageId: archived.id,
            note: 'Bulk archived from recruitment list',
          });
          ok += 1;
        } catch (err) {
          console.error('Bulk archive failed for', candidateId, err);
          failed += 1;
        }
      }
      if (ok) toast.success(`Archived ${ok} candidate${ok === 1 ? '' : 's'}`);
      if (failed) toast.error(`${failed} failed to archive`);
      exitSelectMode();
      await load();
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Recruitment</h2>
            <p className="mt-0.5 text-sm text-gray-500">
              {selectMode
                ? 'Select candidates, then archive them. Already archived rows are skipped.'
                : 'Candidate pipeline from application to hire. Click a row to open the candidate dashboard.'}
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-800 shadow-sm hover:bg-gray-50"
              onClick={() => onAddEmployee?.()}
            >
              <PlusIcon className="h-4 w-4" />
              Add employee
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"
              onClick={onAddUser}
            >
              <UserPlusIcon className="h-4 w-4" />
              Add user
            </button>
            <button
              type="button"
              className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold shadow-sm ${
                selectMode
                  ? 'border-amber-300 bg-amber-50 text-amber-900'
                  : 'border-gray-200 bg-white text-gray-800 hover:bg-gray-50'
              }`}
              onClick={toggleSelectMode}
            >
              <ArchiveBoxIcon className="h-4 w-4" />
              {selectMode ? 'Cancel select' : 'Archive'}
            </button>
            {selectMode ? (
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-full bg-gray-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-black disabled:opacity-50"
                disabled={bulkBusy || selectedIds.size === 0}
                onClick={() => void handleBulkArchive()}
              >
                {bulkBusy ? (
                  <span className="loading loading-spinner loading-xs" />
                ) : (
                  <ArchiveBoxIcon className="h-4 w-4" />
                )}
                Archive selected ({selectedIds.size})
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <label className="relative block min-w-[14rem] max-w-md flex-1">
            <span className="mb-1 block text-sm font-medium text-gray-600">Search</span>
            <div className="relative">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="search"
                className="w-full rounded-full border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                placeholder="Search name, email, position…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-gray-600">Pipeline</span>
            <select
              className="min-w-[10rem] rounded-full border border-gray-200 bg-white px-3.5 py-2 text-sm"
              value={pipelineFilter}
              onChange={(e) => setPipelineFilter(e.target.value as PipelineFilter)}
            >
              <option value="active">Active only</option>
              <option value="all">All stages</option>
              <option value="terminal">Hired / Declined / Archived</option>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-gray-600">Stage</span>
            <select
              className="min-w-[12rem] rounded-full border border-gray-200 bg-white px-3.5 py-2 text-sm"
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value)}
            >
              <option value="all">All</option>
              {stages.map((s) => (
                <option key={s.id} value={String(s.id)}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-gray-600">User status</span>
            <select
              className="min-w-[10rem] rounded-full border border-gray-200 bg-white px-3.5 py-2 text-sm"
              value={activeFilter}
              onChange={(e) => setActiveFilter(e.target.value as ActiveFilter)}
            >
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-gray-600">Contract</span>
            <select
              className="min-w-[12rem] rounded-full border border-gray-200 bg-white px-3.5 py-2 text-sm"
              value={contractFilter}
              onChange={(e) => setContractFilter(e.target.value as ContractFilter)}
            >
              <option value="all">All</option>
              <option value="pending">Pending</option>
              <option value="signed">Signed</option>
              <option value="without">Without contract</option>
            </select>
          </label>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        {loading ? (
          <div className="flex justify-center py-16">
            <span className="loading loading-spinner loading-md text-emerald-600" />
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-14 text-center text-sm text-gray-500">
            <DocumentTextIcon className="h-6 w-6 text-gray-300" />
            <p>
              {rows.length === 0
                ? 'No recruitment candidates found.'
                : 'No candidates match the current filters.'}
            </p>
            {rows.length === 0 ? (
              <button
                type="button"
                className="mt-2 inline-flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                onClick={onAddUser}
              >
                <UserPlusIcon className="h-4 w-4" />
                Add user
              </button>
            ) : null}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table w-full text-base">
              <thead>
                <tr className="text-sm uppercase tracking-wider text-gray-500">
                  {selectMode ? (
                    <th className="bg-transparent w-10">
                      <input
                        type="checkbox"
                        className="checkbox checkbox-sm"
                        checked={allSelectableSelected}
                        onChange={toggleSelectAll}
                        aria-label="Select all"
                        disabled={selectableRows.length === 0 || bulkBusy}
                      />
                    </th>
                  ) : null}
                  <th className="bg-transparent font-semibold">Candidate</th>
                  <th className="bg-transparent font-semibold">Position</th>
                  <th className="bg-transparent font-semibold">Stage</th>
                  <th className="bg-transparent font-semibold">Referred by</th>
                  {/* <th className="bg-transparent font-semibold">Recruiter</th> */}
                  <th className="bg-transparent font-semibold text-center">Days</th>
                  <th className="bg-transparent font-semibold text-center">Contract</th>
                  <th className="bg-transparent font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map(({ user, candidate }) => {
                  const stage =
                    candidate.stage || stages.find((s) => s.id === candidate.stage_id);
                  const days = daysInStage(candidate.stage_changed_at);
                  const stuck = days >= STUCK_STAGE_DAYS && stage && !stage.is_terminal;
                  const contractStatus = contractStatusByUser[user.id] ?? null;
                  const creating = creatingUserId === user.id;
                  const name = recruitmentUserDisplayName(user);
                  const isSelected = selectedIds.has(candidate.id);
                  const canSelect = stage?.slug !== 'archived';
                  return (
                    <tr
                      key={user.id}
                      className={`hover:bg-base-200/70 ${
                        selectMode ? (canSelect ? 'cursor-pointer' : 'cursor-default') : 'cursor-pointer'
                      } ${isSelected ? 'bg-amber-50/70' : ''}`}
                      onClick={() => {
                        if (selectMode) {
                          if (canSelect) toggleRowSelected(candidate.id);
                          return;
                        }
                        navigate(buildRecruitmentCandidatePath(user.id));
                      }}
                    >
                      {selectMode ? (
                        <td onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            className="checkbox checkbox-sm"
                            checked={isSelected}
                            disabled={!canSelect || bulkBusy}
                            onChange={() => toggleRowSelected(candidate.id)}
                            aria-label={`Select ${name}`}
                          />
                        </td>
                      ) : null}
                      <td>
                        <div className="font-medium text-gray-900 whitespace-nowrap">{name}</div>
                        <div className="text-sm text-gray-500 whitespace-nowrap">
                          {user.email || '—'}
                        </div>
                      </td>
                      <td className="text-sm text-gray-700 whitespace-nowrap">
                        {candidate.position_applied || '—'}
                      </td>
                      <td>
                        {stage ? (
                          <span
                            className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap"
                            style={{
                              color: stage.colour || '#374151',
                              backgroundColor: `${stage.colour || '#9ca3af'}22`,
                            }}
                          >
                            {stage.name}
                          </span>
                        ) : (
                          <span className="text-sm text-gray-400">—</span>
                        )}
                      </td>
                      <td className="text-sm text-gray-700 whitespace-nowrap">
                        {candidate.referred_by_employee_id && candidate.referred_by_name ? (
                          <span className="inline-flex items-center gap-2">
                            <HrEmployeeAvatar
                              employeeId={candidate.referred_by_employee_id}
                              name={candidate.referred_by_name}
                              photoUrl={candidate.referred_by_photo_url}
                              size="sm"
                              className="!h-7 !w-7 !text-[10px]"
                            />
                            <span>{candidate.referred_by_name}</span>
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      {/* <td className="text-sm text-gray-700 whitespace-nowrap">
                        {candidate.recruiter_name || '—'}
                      </td> */}
                      <td
                        className={`text-center text-sm font-medium ${
                          stuck ? 'text-amber-700' : 'text-gray-700'
                        }`}
                      >
                        {days}
                      </td>
                      <td className="text-center text-sm font-medium">
                        {contractStatus === 'signed' ? (
                          <span className="text-emerald-700">Signed</span>
                        ) : contractStatus === 'pending' ? (
                          <span className="text-amber-700">Pending</span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="text-right whitespace-nowrap">
                        <div
                          className="inline-flex items-center gap-1.5"
                          onClick={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.stopPropagation()}
                        >
                          {isSuperUser ? (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                              disabled={creating || !selectedTemplateId}
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleCreateContract(user);
                              }}
                            >
                              {creating ? (
                                <span className="loading loading-spinner loading-xs" />
                              ) : (
                                <PlusIcon className="h-4 w-4" />
                              )}
                              Contract
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className={`inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 ${
                              actionBusyId === candidate.id
                                ? 'pointer-events-none opacity-60'
                                : ''
                            } ${
                              actionsMenu?.candidateId === candidate.id
                                ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                                : ''
                            }`}
                            aria-label="More actions"
                            aria-expanded={actionsMenu?.candidateId === candidate.id}
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) =>
                              openActionsMenu(e, {
                                candidateId: candidate.id,
                                userId: user.id,
                                name,
                                stageId: candidate.stage_id,
                                stageSlug: stage?.slug ?? null,
                                employeeId: user.employee_id,
                              })
                            }
                          >
                            {actionBusyId === candidate.id ? (
                              <span className="loading loading-spinner loading-xs" />
                            ) : (
                              <EllipsisVerticalIcon className="h-5 w-5" />
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {actionsMenu
        ? createPortal(
            <>
              <button
                type="button"
                className="fixed inset-0 z-[80] cursor-default"
                aria-label="Close actions menu"
                onClick={closeActionsMenu}
                onMouseDown={(e) => e.stopPropagation()}
              />
              <div
                ref={actionsMenuRef}
                className="fixed z-[90] w-64 rounded-xl border border-gray-100 bg-white p-2.5 shadow-xl"
                style={{
                  top: actionsMenu.openUp ? undefined : actionsMenu.top,
                  bottom: actionsMenu.openUp
                    ? window.innerHeight - actionsMenu.top
                    : undefined,
                  left: actionsMenu.left,
                }}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                onWheel={(e) => e.stopPropagation()}
              >
                <ul className="menu menu-md gap-0.5 p-0 text-base [&_li>*>svg]:h-5 [&_li>*>svg]:w-5">
                  {onAddEmployee && !actionsMenu.employeeId ? (
                    <li>
                      <button
                        type="button"
                        className="rounded-lg py-2.5 font-medium"
                        onClick={() => {
                          const hireUser = rows.find(
                            (r) => r.candidate.id === actionsMenu.candidateId,
                          )?.user;
                          closeActionsMenu();
                          if (hireUser) onAddEmployee(hireUser);
                        }}
                      >
                        <UserPlusIcon className="h-5 w-5" />
                        Hire candidate
                      </button>
                    </li>
                  ) : null}
                  <li>
                    <button
                      type="button"
                      className="rounded-lg py-2.5 font-medium"
                      onClick={() => {
                        const userId = actionsMenu.userId;
                        closeActionsMenu();
                        navigate(buildRecruitmentSchedulePath(userId));
                      }}
                    >
                      <CalendarDaysIcon className="h-5 w-5" />
                      Schedule meeting
                    </button>
                  </li>
                  <li className="relative">
                    <button
                      type="button"
                      className="justify-between rounded-lg py-2.5 font-medium"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setStageMenuOpen((open) => !open);
                      }}
                    >
                      <span>Next stage</span>
                      <ChevronLeftIcon className="h-5 w-5 shrink-0 opacity-60" />
                    </button>
                    {stageMenuOpen ? (
                      <ul
                        className={`absolute top-0 z-[95] max-h-64 w-56 overflow-auto rounded-xl border border-gray-100 bg-white p-2 shadow-xl ${
                          actionsMenu.left < 240 ? 'left-full ml-1' : 'right-full mr-1'
                        }`}
                      >
                        {stages.map((s) => (
                          <li key={s.id}>
                            <button
                              type="button"
                              disabled={s.id === actionsMenu.stageId}
                              className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium hover:bg-gray-50 ${
                                s.id === actionsMenu.stageId
                                  ? 'opacity-60'
                                  : ''
                              }`}
                              onClick={() => {
                                const id = actionsMenu.candidateId;
                                closeActionsMenu();
                                void handleSetStage(id, s.id);
                              }}
                            >
                              <span
                                className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold"
                                style={{
                                  color: s.colour || '#374151',
                                  backgroundColor: `${s.colour || '#9ca3af'}22`,
                                }}
                              >
                                {s.name}
                              </span>
                              {s.id === actionsMenu.stageId ? (
                                <span className="text-xs text-gray-400">Current</span>
                              ) : null}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                  <li>
                    <button
                      type="button"
                      className="rounded-lg py-2.5 font-medium"
                      disabled={actionsMenu.stageSlug === 'archived'}
                      onClick={() => {
                        const { candidateId, stageId } = actionsMenu;
                        closeActionsMenu();
                        void handleArchive(candidateId, stageId);
                      }}
                    >
                      <ArchiveBoxIcon className="h-5 w-5" />
                      Archive
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      className="rounded-lg py-2.5 font-medium text-red-600 hover:!bg-red-50"
                      onClick={() => {
                        const { candidateId, name } = actionsMenu;
                        closeActionsMenu();
                        void handleDelete(candidateId, name);
                      }}
                    >
                      <TrashIcon className="h-5 w-5" />
                      Delete
                    </button>
                  </li>
                </ul>
              </div>
            </>,
            document.body,
          )
        : null}
    </div>
  );
};

export default HrRecruitmentTab;
