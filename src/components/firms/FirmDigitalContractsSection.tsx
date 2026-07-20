import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  DocumentTextIcon,
  EyeIcon,
  PlusIcon,
  ShareIcon,
} from '@heroicons/react/24/outline';
import {
  buildFirmContractEditorPath,
  buildFirmContractPublicUrl,
  createFirmDigitalContract,
  ensureFirmContractPublicToken,
  fetchFirmContractTemplates,
  fetchFirmDigitalContracts,
  type FirmContractTemplateOption,
  type FirmDigitalContract,
} from '../../lib/firmDigitalContracts';

type FirmContactLite = {
  name?: string | null;
  email?: string | null;
  firm_owner?: boolean | null;
};

type Props = {
  firmId: string;
  firmName?: string | null;
  contacts?: FirmContactLite[] | null;
  isSuperUser: boolean;
};

function formatCreatedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function primaryContactDetails(contacts: FirmContactLite[] | null | undefined): {
  name: string | null;
  email: string | null;
} {
  const list = contacts || [];
  const owner = list.find((c) => c.firm_owner === true);
  const primary = owner || list.find((c) => c.email?.trim()) || list[0];
  return {
    name: primary?.name?.trim() || null,
    email: primary?.email?.trim() || null,
  };
}

const FirmDigitalContractsSection: React.FC<Props> = ({
  firmId,
  firmName,
  contacts,
  isSuperUser,
}) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [digitalContracts, setDigitalContracts] = useState<FirmDigitalContract[]>([]);
  const [firmTemplates, setFirmTemplates] = useState<FirmContractTemplateOption[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');

  const loadContracts = useCallback(async () => {
    setLoading(true);
    try {
      const [contracts, templates] = await Promise.all([
        fetchFirmDigitalContracts(firmId).catch(() => []),
        fetchFirmContractTemplates().catch(() => []),
      ]);
      setDigitalContracts(contracts);
      setFirmTemplates(templates);
      setSelectedTemplateId((prev) => {
        if (prev && templates.some((t) => t.id === prev)) return prev;
        return templates[0]?.id || '';
      });
    } finally {
      setLoading(false);
    }
  }, [firmId]);

  useEffect(() => {
    void loadContracts();
  }, [loadContracts]);

  const handleCreateDigitalContract = async () => {
    if (!isSuperUser) {
      toast.error('Only superusers can create digital contracts');
      return;
    }
    if (!selectedTemplateId) {
      toast.error('Select a Firm Contract template first');
      return;
    }
    setCreating(true);
    try {
      const { name, email } = primaryContactDetails(contacts);
      const created = await createFirmDigitalContract({
        firmId,
        templateId: selectedTemplateId,
        contactName: firmName?.trim() || name,
        contactEmail: email,
      });
      toast.success('Digital firm contract created');
      navigate(buildFirmContractEditorPath(firmId, created.id));
    } catch (error) {
      console.error('Create firm digital contract failed:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to create contract');
    } finally {
      setCreating(false);
    }
  };

  const handleShareDigitalContract = async (contract: FirmDigitalContract) => {
    try {
      const token = await ensureFirmContractPublicToken(contract.id);
      const url = buildFirmContractPublicUrl(contract.id, token);
      await navigator.clipboard.writeText(url);
      toast.success('Signing link copied');
      setDigitalContracts((prev) =>
        prev.map((row) => (row.id === contract.id ? { ...row, public_token: token } : row)),
      );
    } catch (error) {
      console.error('Share firm contract failed:', error);
      toast.error('Failed to copy signing link');
    }
  };

  return (
    <div>
      <div className="flex flex-col gap-3 px-5 py-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-2">
          <DocumentTextIcon className="h-4 w-4 text-base-content/50" />
          <div>
            <span className="text-sm font-semibold text-base-content/80">Digital firm contracts</span>
            <p className="text-xs text-base-content/45 mt-0.5">
              {isSuperUser
                ? 'Create and manage TipTap contracts from Firm Contract templates'
                : 'View TipTap contracts created for this firm'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
              digitalContracts.length > 0
                ? 'bg-primary/8 text-primary'
                : 'bg-base-200 text-base-content/40'
            }`}
          >
            {digitalContracts.length}
          </span>
          {isSuperUser ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-base-content/50">Firm Contract template</span>
                <select
                  className="select select-bordered select-sm min-w-[12rem]"
                  value={selectedTemplateId}
                  onChange={(e) => setSelectedTemplateId(e.target.value)}
                  disabled={firmTemplates.length === 0 || creating}
                >
                  {firmTemplates.length === 0 ? (
                    <option value="">No firm templates</option>
                  ) : (
                    firmTemplates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    ))
                  )}
                </select>
              </label>
              <button
                type="button"
                className="btn btn-primary btn-sm gap-1.5"
                onClick={() => void handleCreateDigitalContract()}
                disabled={creating || !selectedTemplateId || loading}
              >
                {creating ? (
                  <span className="loading loading-spinner loading-xs" />
                ) : (
                  <PlusIcon className="h-4 w-4" />
                )}
                Create digital contract
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <span className="loading loading-spinner loading-md text-primary" />
        </div>
      ) : digitalContracts.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-1 py-10 text-sm text-base-content/40">
          <DocumentTextIcon className="h-5 w-5" />
          <p>No digital firm contracts yet.</p>
          <p className="text-xs">
            {isSuperUser
              ? 'Mark a template as Firm Contract in Admin, then create one here.'
              : 'Ask a superuser to create a digital contract if you need one.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto py-2">
          <table className="table w-full min-w-[32rem] text-base">
            <thead>
              <tr>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-base-content/35">
                  Template
                </th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-base-content/35">
                  Status
                </th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-base-content/35">
                  Created
                </th>
                <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-base-content/35">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {digitalContracts.map((contract) => (
                <tr key={contract.id} className="hover:bg-base-200/60">
                  <td className="px-5 py-4 font-medium text-base-content/90">
                    {contract.template_name || 'Firm contract'}
                  </td>
                  <td className="px-5 py-4">
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
                  <td className="px-5 py-4 text-sm text-base-content/60 whitespace-nowrap">
                    {contract.created_at ? formatCreatedAt(contract.created_at) : '—'}
                  </td>
                  <td className="px-5 py-4 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm btn-circle"
                        title="Open editor"
                        aria-label="Open digital contract"
                        onClick={() =>
                          navigate(buildFirmContractEditorPath(firmId, contract.id))
                        }
                      >
                        <EyeIcon className="h-5 w-5" />
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm btn-circle"
                        title="Copy signing link"
                        aria-label="Copy signing link"
                        onClick={() => void handleShareDigitalContract(contract)}
                      >
                        <ShareIcon className="h-5 w-5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default FirmDigitalContractsSection;
