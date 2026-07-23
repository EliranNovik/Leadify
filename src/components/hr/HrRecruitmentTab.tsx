import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  DocumentTextIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  UserPlusIcon,
} from '@heroicons/react/24/outline';
import {
  buildRecruitmentCandidatePath,
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
  STUCK_STAGE_DAYS,
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
      toast.error('Select an Employee Contract template first');
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

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Recruitment</h2>
            <p className="mt-0.5 text-sm text-gray-500">
              Candidate pipeline from application to hire. Click a row to open the candidate
              dashboard.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            {isSuperUser ? (
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-gray-500">Employee Contract template</span>
                <select
                  className="select select-bordered select-sm min-w-[12rem]"
                  value={selectedTemplateId}
                  onChange={(e) => setSelectedTemplateId(e.target.value)}
                  disabled={templates.length === 0}
                >
                  {templates.length === 0 ? (
                    <option value="">No employee templates</option>
                  ) : (
                    templates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    ))
                  )}
                </select>
              </label>
            ) : null}
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
                  return (
                    <tr
                      key={user.id}
                      className="cursor-pointer hover:bg-base-200/70"
                      onClick={() => navigate(buildRecruitmentCandidatePath(user.id))}
                    >
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
                        <span
                          className="text-sm font-semibold whitespace-nowrap"
                          style={{ color: stage?.colour || '#374151' }}
                        >
                          {stage?.name || '—'}
                        </span>
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
                        >
                          {onAddEmployee ? (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
                              onClick={() => onAddEmployee(user)}
                            >
                              <PlusIcon className="h-4 w-4" />
                              Employee
                            </button>
                          ) : null}
                          {isSuperUser ? (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                              disabled={creating || !selectedTemplateId}
                              onClick={() => void handleCreateContract(user)}
                            >
                              {creating ? (
                                <span className="loading loading-spinner loading-xs" />
                              ) : (
                                <PlusIcon className="h-4 w-4" />
                              )}
                              Contract
                            </button>
                          ) : null}
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
    </div>
  );
};

export default HrRecruitmentTab;
