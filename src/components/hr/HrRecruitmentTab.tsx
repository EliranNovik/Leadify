import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ChevronDownIcon,
  DocumentTextIcon,
  EyeIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  ShareIcon,
  UserPlusIcon,
} from '@heroicons/react/24/outline';
import {
  buildRecruitmentContractEditorPath,
  buildRecruitmentContractPublicUrl,
  createRecruitmentDigitalContract,
  ensureRecruitmentContractPublicToken,
  fetchRecruitmentContractTemplates,
  fetchRecruitmentDigitalContracts,
  fetchRecruitmentContractStatusByUserId,
  fetchRecruitmentUsers,
  recruitmentUserDisplayName,
  type RecruitmentContractTemplateOption,
  type RecruitmentDigitalContract,
  type RecruitmentUser,
} from '../../lib/recruitmentDigitalContracts';

type Props = {
  isSuperUser: boolean;
  onAddUser: () => void;
  /** Bump after creating a user so the list reloads. */
  refreshKey?: number;
};

type ActiveFilter = 'all' | 'active' | 'inactive';
type ContractFilter = 'all' | 'pending' | 'signed' | 'without';
type ContractStatus = 'pending' | 'signed';

function summarizeContractStatus(
  rows: Array<{ status?: string | null; signed_at?: string | null }>,
): ContractStatus | null {
  if (!rows.length) return null;
  const anySigned = rows.some(
    (row) => String(row.status || '').toLowerCase() === 'signed' || Boolean(row.signed_at),
  );
  return anySigned ? 'signed' : 'pending';
}

function formatCreatedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

const HrRecruitmentTab: React.FC<Props> = ({ isSuperUser, onAddUser, refreshKey = 0 }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<RecruitmentUser[]>([]);
  const [contractStatusByUser, setContractStatusByUser] = useState<
    Record<string, ContractStatus>
  >({});
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('all');
  const [contractFilter, setContractFilter] = useState<ContractFilter>('all');
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [templates, setTemplates] = useState<RecruitmentContractTemplateOption[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [contractsByUser, setContractsByUser] = useState<Record<string, RecruitmentDigitalContract[]>>(
    {},
  );
  const [contractsLoadingUserId, setContractsLoadingUserId] = useState<string | null>(null);
  const [creatingUserId, setCreatingUserId] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, tmpl, statusByUser] = await Promise.all([
        fetchRecruitmentUsers(),
        fetchRecruitmentContractTemplates().catch(() => []),
        fetchRecruitmentContractStatusByUserId().catch(() => ({})),
      ]);
      setUsers(rows);
      setContractStatusByUser(statusByUser);
      setTemplates(tmpl);
      setSelectedTemplateId((prev) => {
        if (prev && tmpl.some((t) => t.id === prev)) return prev;
        return tmpl[0]?.id || '';
      });
    } catch (error) {
      console.error('HrRecruitmentTab load:', error);
      toast.error('Failed to load recruitment users');
      setUsers([]);
      setContractStatusByUser({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers, refreshKey]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (activeFilter === 'active' && u.is_active === false) return false;
      if (activeFilter === 'inactive' && u.is_active !== false) return false;

      const status = contractStatusByUser[u.id] ?? null;
      if (contractFilter === 'pending' && status !== 'pending') return false;
      if (contractFilter === 'signed' && status !== 'signed') return false;
      if (contractFilter === 'without' && status != null) return false;

      if (!q) return true;
      const name = recruitmentUserDisplayName(u).toLowerCase();
      const email = String(u.email || '').toLowerCase();
      return name.includes(q) || email.includes(q);
    });
  }, [users, search, activeFilter, contractFilter, contractStatusByUser]);

  const loadContractsForUser = useCallback(async (userId: string) => {
    setContractsLoadingUserId(userId);
    try {
      const rows = await fetchRecruitmentDigitalContracts(userId);
      setContractsByUser((prev) => ({ ...prev, [userId]: rows }));
      setContractStatusByUser((prev) => {
        const next = { ...prev };
        const status = summarizeContractStatus(rows);
        if (status) next[userId] = status;
        else delete next[userId];
        return next;
      });
    } catch (error) {
      console.error('Load recruitment contracts:', error);
      toast.error('Failed to load contracts');
      setContractsByUser((prev) => ({ ...prev, [userId]: [] }));
    } finally {
      setContractsLoadingUserId(null);
    }
  }, []);

  const toggleExpand = (userId: string) => {
    setExpandedUserId((prev) => {
      const next = prev === userId ? null : userId;
      if (next && contractsByUser[next] == null) {
        void loadContractsForUser(next);
      }
      return next;
    });
  };

  const handleCreate = async (user: RecruitmentUser) => {
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
      setContractsByUser((prev) => ({
        ...prev,
        [user.id]: [created, ...(prev[user.id] || [])],
      }));
      setContractStatusByUser((prev) => ({
        ...prev,
        [user.id]: prev[user.id] === 'signed' ? 'signed' : 'pending',
      }));
      setExpandedUserId(user.id);
      navigate(buildRecruitmentContractEditorPath(user.id, created.id));
    } catch (error) {
      console.error('Create recruitment contract failed:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to create contract');
    } finally {
      setCreatingUserId(null);
    }
  };

  const handleShare = async (userId: string, contract: RecruitmentDigitalContract) => {
    try {
      const token = await ensureRecruitmentContractPublicToken(contract.id);
      const url = buildRecruitmentContractPublicUrl(contract.id, token);
      await navigator.clipboard.writeText(url);
      toast.success('Signing link copied');
      setContractsByUser((prev) => ({
        ...prev,
        [userId]: (prev[userId] || []).map((row) =>
          row.id === contract.id ? { ...row, public_token: token } : row,
        ),
      }));
    } catch (error) {
      console.error('Share recruitment contract failed:', error);
      toast.error('Failed to copy signing link');
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Recruitment</h2>
            <p className="mt-0.5 text-sm text-gray-500">
              Users without an employee profile (and not external). Create the same digital employee
              contracts for hiring paperwork.
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
              className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
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
                placeholder="Search name or email…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-gray-600">Status</span>
            <select
              className="min-w-[10rem] rounded-full border border-gray-200 bg-white px-3.5 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
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
              className="min-w-[12rem] rounded-full border border-gray-200 bg-white px-3.5 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
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
        ) : filteredUsers.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-14 text-center text-sm text-gray-500">
            <DocumentTextIcon className="h-6 w-6 text-gray-300" />
            <p>
              {users.length === 0
                ? 'No recruitment users found.'
                : 'No users match the current filters.'}
            </p>
            {users.length === 0 ? (
              <>
                <p className="text-xs text-gray-400">
                  Create a user without linking an employee — they will appear here.
                </p>
                <button
                  type="button"
                  className="mt-2 inline-flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                  onClick={onAddUser}
                >
                  <UserPlusIcon className="h-4 w-4" />
                  Add user
                </button>
              </>
            ) : null}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table w-full text-base">
              <thead>
                <tr className="text-sm uppercase tracking-wider text-gray-500">
                  <th className="bg-transparent font-semibold w-10" />
                  <th className="bg-transparent font-semibold">User</th>
                  <th className="bg-transparent font-semibold">Email</th>
                  <th className="bg-transparent font-semibold text-center">Active</th>
                  <th className="bg-transparent font-semibold text-center">Contract</th>
                  <th className="bg-transparent font-semibold">Created</th>
                  <th className="bg-transparent font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((user) => {
                  const expanded = expandedUserId === user.id;
                  const contracts = contractsByUser[user.id];
                  const contractsLoading = contractsLoadingUserId === user.id;
                  const creating = creatingUserId === user.id;
                  const name = recruitmentUserDisplayName(user);
                  const contractStatus = contractStatusByUser[user.id] ?? null;
                  return (
                    <React.Fragment key={user.id}>
                      <tr className="hover:bg-base-200/70">
                        <td className="align-middle">
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm btn-circle"
                            aria-label={expanded ? 'Collapse contracts' : 'Expand contracts'}
                            onClick={() => toggleExpand(user.id)}
                          >
                            <ChevronDownIcon
                              className={`h-5 w-5 transition-transform ${expanded ? 'rotate-180' : ''}`}
                            />
                          </button>
                        </td>
                        <td className="font-medium text-gray-900 whitespace-nowrap">{name}</td>
                        <td className="text-gray-700 whitespace-nowrap">{user.email || '—'}</td>
                        <td className="text-center">
                          {user.is_active === false ? (
                            <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-500">
                              Inactive
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                              Active
                            </span>
                          )}
                        </td>
                        <td className="text-center">
                          {contractStatus === 'signed' ? (
                            <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                              Signed
                            </span>
                          ) : contractStatus === 'pending' ? (
                            <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">
                              Pending
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-400">
                              —
                            </span>
                          )}
                        </td>
                        <td className="text-sm text-gray-500 whitespace-nowrap">
                          {user.created_at ? formatCreatedAt(user.created_at) : '—'}
                        </td>
                        <td className="text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            {isSuperUser ? (
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 disabled:cursor-not-allowed disabled:opacity-50"
                                disabled={creating || !selectedTemplateId}
                                onClick={() => void handleCreate(user)}
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
                              className="btn btn-ghost btn-sm"
                              onClick={() => toggleExpand(user.id)}
                            >
                              Contracts
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expanded ? (
                        <tr className="bg-base-200/40">
                          <td colSpan={7} className="p-0">
                            <div className="border-t border-base-300/60 px-4 py-3 sm:px-6">
                              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-base-content/70">
                                <DocumentTextIcon className="h-4 w-4" />
                                Digital contracts
                              </div>
                              {contractsLoading ? (
                                <div className="flex justify-center py-6">
                                  <span className="loading loading-spinner loading-sm text-primary" />
                                </div>
                              ) : !contracts || contracts.length === 0 ? (
                                <p className="py-4 text-sm text-base-content/45">
                                  No digital contracts yet for this user.
                                </p>
                              ) : (
                                <table className="table w-full min-w-[28rem] text-sm">
                                  <thead>
                                    <tr>
                                      <th>Template</th>
                                      <th>Status</th>
                                      <th>Created</th>
                                      <th className="text-right">Actions</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {contracts.map((contract) => (
                                      <tr key={contract.id}>
                                        <td>{contract.template_name || 'Employee contract'}</td>
                                        <td>
                                          <span
                                            className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
                                              contract.status === 'signed'
                                                ? 'bg-emerald-100 text-emerald-800'
                                                : 'bg-amber-100 text-amber-800'
                                            }`}
                                          >
                                            {contract.status || 'draft'}
                                          </span>
                                        </td>
                                        <td className="whitespace-nowrap text-base-content/60">
                                          {contract.created_at
                                            ? formatCreatedAt(contract.created_at)
                                            : '—'}
                                        </td>
                                        <td className="text-right whitespace-nowrap">
                                          <div className="inline-flex items-center gap-1">
                                            <button
                                              type="button"
                                              className="btn btn-ghost btn-sm btn-circle"
                                              title="Open editor"
                                              onClick={() =>
                                                navigate(
                                                  buildRecruitmentContractEditorPath(
                                                    user.id,
                                                    contract.id,
                                                  ),
                                                )
                                              }
                                            >
                                              <EyeIcon className="h-5 w-5" />
                                            </button>
                                            <button
                                              type="button"
                                              className="btn btn-ghost btn-sm btn-circle"
                                              title="Copy signing link"
                                              onClick={() => void handleShare(user.id, contract)}
                                            >
                                              <ShareIcon className="h-5 w-5" />
                                            </button>
                                          </div>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
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
