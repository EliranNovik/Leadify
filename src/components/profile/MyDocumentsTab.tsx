import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUpTrayIcon,
  DocumentTextIcon,
  EyeIcon,
  FunnelIcon,
  PlusIcon,
  ShareIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import {
  documentNameFromUrl,
  fetchEmployeeUnavailabilityDocuments,
  unavailabilityDateRangeLabel,
  unavailabilityReasonText,
  type EmployeeUnavailabilityDocument,
  type UnavailabilityType,
} from '../../lib/employeeUnavailabilities';
import {
  deleteEmployeeHrDocument,
  EMPLOYEE_HR_DOCUMENTS_BUCKET,
  fetchEmployeeHrDocuments,
  fetchHrDocumentTypes,
  uploadEmployeeHrDocument,
  type EmployeeHrDocument,
  type HrDocumentType,
} from '../../lib/employeeHrDocuments';
import {
  buildEmployeeContractEditorPath,
  buildEmployeeContractPublicUrl,
  createEmployeeDigitalContract,
  ensureEmployeeContractPublicToken,
  fetchEmployeeContractTemplates,
  fetchEmployeeDigitalContracts,
  type EmployeeContractTemplateOption,
  type EmployeeDigitalContract,
} from '../../lib/employeeDigitalContracts';
import { fetchEmployeeProfileById } from '../../lib/fetchEmployeeProfile';
import { DocumentFileGlyph } from '../../lib/documentFileGlyphs';
import UnavailabilityTypeBadge from '../UnavailabilityTypeBadge';
import DocumentViewerModal from '../DocumentViewerModal';
import { useAuthContext } from '../../contexts/AuthContext';

interface MyDocumentsTabProps {
  employeeId: number;
  employeeName?: string;
}

type LeaveTypeFilter = 'all' | UnavailabilityType;

function formatUploadedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const MyDocumentsTab: React.FC<MyDocumentsTabProps> = ({ employeeId, employeeName = '' }) => {
  const navigate = useNavigate();
  const { isSuperUser } = useAuthContext();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [creatingDigital, setCreatingDigital] = useState(false);

  const [hrTypes, setHrTypes] = useState<HrDocumentType[]>([]);
  const [hrDocuments, setHrDocuments] = useState<EmployeeHrDocument[]>([]);
  const [hrTypeFilter, setHrTypeFilter] = useState<'all' | number>('all');
  const [uploadTypeId, setUploadTypeId] = useState<number | null>(null);
  const [selectedHrDocument, setSelectedHrDocument] = useState<EmployeeHrDocument | null>(null);

  const [leaveDocuments, setLeaveDocuments] = useState<EmployeeUnavailabilityDocument[]>([]);
  const [leaveTypeFilter, setLeaveTypeFilter] = useState<LeaveTypeFilter>('all');
  const [selectedLeaveDocument, setSelectedLeaveDocument] =
    useState<EmployeeUnavailabilityDocument | null>(null);

  const [digitalContracts, setDigitalContracts] = useState<EmployeeDigitalContract[]>([]);
  const [employeeTemplates, setEmployeeTemplates] = useState<EmployeeContractTemplateOption[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');

  const loadAll = useCallback(async () => {
    try {
      setLoading(true);
      const [types, hrDocs, leaveDocs, contracts, templates] = await Promise.all([
        fetchHrDocumentTypes(),
        fetchEmployeeHrDocuments(employeeId),
        fetchEmployeeUnavailabilityDocuments(employeeId).catch(() => []),
        fetchEmployeeDigitalContracts(employeeId).catch(() => []),
        fetchEmployeeContractTemplates().catch(() => []),
      ]);
      setHrTypes(types);
      setHrDocuments(hrDocs);
      setLeaveDocuments(leaveDocs);
      setDigitalContracts(contracts);
      setEmployeeTemplates(templates);
      setSelectedTemplateId((prev) => {
        if (prev && templates.some((t) => t.id === prev)) return prev;
        return templates[0]?.id ?? '';
      });
      setUploadTypeId((prev) => {
        if (prev != null && types.some((t) => t.id === prev)) return prev;
        return types[0]?.id ?? null;
      });
    } catch (error) {
      console.error('Error loading documents:', error);
      toast.error('Failed to load documents');
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const filteredHrDocuments = useMemo(() => {
    if (hrTypeFilter === 'all') return hrDocuments;
    return hrDocuments.filter((doc) => doc.document_type_id === hrTypeFilter);
  }, [hrDocuments, hrTypeFilter]);

  const filteredLeaveDocuments = useMemo(() => {
    if (leaveTypeFilter === 'all') return leaveDocuments;
    return leaveDocuments.filter((doc) => doc.unavailability_type === leaveTypeFilter);
  }, [leaveDocuments, leaveTypeFilter]);

  const selectedUploadType = useMemo(
    () => hrTypes.find((t) => t.id === uploadTypeId) ?? null,
    [hrTypes, uploadTypeId],
  );

  const handleUploadClick = () => {
    if (!selectedUploadType) {
      toast.error('Select a document type first');
      return;
    }
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !selectedUploadType) return;

    setUploading(true);
    try {
      await uploadEmployeeHrDocument({
        employeeId,
        documentTypeId: selectedUploadType.id,
        typeSlug: selectedUploadType.slug,
        file,
      });
      toast.success('Document uploaded');
      await loadAll();
    } catch (error) {
      console.error('HR document upload failed:', error);
      toast.error(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteHrDocument = async (doc: EmployeeHrDocument) => {
    const label = doc.document_type?.label || doc.file_name;
    const confirmed = window.confirm(`Remove ${label} document "${doc.file_name}"?`);
    if (!confirmed) return;

    setDeletingId(doc.id);
    try {
      await deleteEmployeeHrDocument(doc);
      toast.success('Document removed');
      setHrDocuments((prev) => prev.filter((row) => row.id !== doc.id));
    } catch (error) {
      console.error('HR document delete failed:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to remove document');
    } finally {
      setDeletingId(null);
    }
  };

  const handleCreateDigitalContract = async () => {
    if (!isSuperUser) {
      toast.error('Only superusers can create digital contracts');
      return;
    }
    if (!selectedTemplateId) {
      toast.error('Select an Employee Contract template first');
      return;
    }
    setCreatingDigital(true);
    try {
      const profile = await fetchEmployeeProfileById(employeeId);
      const created = await createEmployeeDigitalContract({
        employeeId,
        templateId: selectedTemplateId,
        contactName: profile?.official_name || profile?.display_name || employeeName || null,
        contactEmail: profile?.email || null,
      });
      toast.success('Digital employee contract created');
      navigate(buildEmployeeContractEditorPath(employeeId, created.id));
    } catch (error) {
      console.error('Create employee digital contract failed:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to create contract');
    } finally {
      setCreatingDigital(false);
    }
  };

  const handleShareDigitalContract = async (contract: EmployeeDigitalContract) => {
    try {
      const token = await ensureEmployeeContractPublicToken(contract.id);
      const url = buildEmployeeContractPublicUrl(contract.id, token);
      await navigator.clipboard.writeText(url);
      toast.success('Signing link copied');
      setDigitalContracts((prev) =>
        prev.map((row) => (row.id === contract.id ? { ...row, public_token: token } : row)),
      );
    } catch (error) {
      console.error('Share employee contract failed:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to copy link');
    }
  };

  return (
    <div className="my-profile-documents-shell w-full max-w-full min-w-0 overflow-x-hidden space-y-6">
      <div className="flex flex-col gap-3 px-1 sm:flex-row sm:items-center sm:justify-between w-full min-w-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <DocumentTextIcon className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h2 className="text-xl md:text-2xl font-bold text-gray-800">Documents</h2>
            <p className="text-sm text-gray-500">
              HR files for {employeeName || 'this employee'} — upload, view, and remove
            </p>
          </div>
        </div>
        {!loading && (
          <span className="inline-flex items-center px-4 py-2 rounded-full text-sm font-semibold bg-gray-100 text-gray-700 border border-gray-200/80 shrink-0">
            {filteredHrDocuments.length} HR document
            {filteredHrDocuments.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      <div className="space-y-4 rounded-2xl bg-white border border-gray-200 p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-base font-semibold text-gray-800">Digital employee contracts</h3>
            <p className="text-sm text-gray-500">
              {isSuperUser
                ? 'Create and manage TipTap contracts from Employee Contract templates only'
                : 'View TipTap contracts created for this employee'}
            </p>
          </div>
          {isSuperUser ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <label className="flex flex-col gap-1.5 min-w-[12rem]">
                <span className="text-sm font-medium text-gray-600">Employee Contract template</span>
                <select
                  className="rounded-full border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-800 min-w-[14rem] focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                  value={selectedTemplateId}
                  onChange={(e) => setSelectedTemplateId(e.target.value)}
                  disabled={employeeTemplates.length === 0 || creatingDigital}
                >
                  {employeeTemplates.length === 0 ? (
                    <option value="">No employee templates</option>
                  ) : (
                    employeeTemplates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    ))
                  )}
                </select>
              </label>
              <button
                type="button"
                className="btn btn-sm rounded-full gap-2 border-0 bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-600/50 h-10 min-h-10"
                onClick={() => void handleCreateDigitalContract()}
                disabled={creatingDigital || !selectedTemplateId || loading}
              >
                {creatingDigital ? (
                  <span className="loading loading-spinner loading-sm" />
                ) : (
                  <PlusIcon className="w-4 h-4" />
                )}
                Create digital contract
              </button>
            </div>
          ) : null}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <span className="loading loading-spinner loading-md text-primary" />
          </div>
        ) : digitalContracts.length === 0 ? (
          <div className="rounded-xl bg-gray-50 py-10 text-center text-gray-400">
            <p>No digital employee contracts yet.</p>
            <p className="text-sm mt-1">
              {isSuperUser
                ? 'Mark a template as Employee Contract in Admin, then create one here.'
                : 'Ask a superuser to create a digital contract if you need one.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table w-full text-base">
              <thead>
                <tr className="text-sm uppercase tracking-wider text-gray-500">
                  <th className="bg-transparent font-semibold">Template</th>
                  <th className="bg-transparent font-semibold">Status</th>
                  <th className="bg-transparent font-semibold">Created</th>
                  <th className="bg-transparent font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {digitalContracts.map((contract) => (
                  <tr key={contract.id} className="hover:bg-base-200">
                    <td className="font-medium text-gray-900">
                      {contract.template_name || 'Employee contract'}
                    </td>
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
                    <td className="text-gray-600 whitespace-nowrap text-sm">
                      {contract.created_at ? formatUploadedAt(contract.created_at) : '—'}
                    </td>
                    <td className="text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm btn-circle"
                          title="Open editor"
                          aria-label="Open digital contract"
                          onClick={() =>
                            navigate(buildEmployeeContractEditorPath(employeeId, contract.id))
                          }
                        >
                          <EyeIcon className="w-5 h-5" />
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm btn-circle"
                          title="Copy signing link"
                          aria-label="Copy signing link"
                          onClick={() => void handleShareDigitalContract(contract)}
                        >
                          <ShareIcon className="w-5 h-5" />
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

      <div className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-wrap items-end gap-3 flex-1">
            <label className="flex flex-col gap-1.5 min-w-[10rem]">
              <span className="text-sm font-medium text-gray-600 flex items-center gap-1.5">
                <FunnelIcon className="w-4 h-4" />
                Filter type
              </span>
              <select
                className="rounded-full border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-800 min-w-[12rem] focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                value={hrTypeFilter === 'all' ? 'all' : String(hrTypeFilter)}
                onChange={(e) => {
                  const value = e.target.value;
                  setHrTypeFilter(value === 'all' ? 'all' : Number(value));
                }}
              >
                <option value="all">All types</option>
                {hrTypes.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1.5 min-w-[10rem]">
              <span className="text-sm font-medium text-gray-600">Upload as</span>
              <select
                className="rounded-full border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-800 min-w-[12rem] focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                value={uploadTypeId ?? ''}
                onChange={(e) => setUploadTypeId(Number(e.target.value))}
                disabled={hrTypes.length === 0}
              >
                {hrTypes.length === 0 ? (
                  <option value="">No types configured</option>
                ) : (
                  hrTypes.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.label}
                    </option>
                  ))
                )}
              </select>
            </label>
          </div>

          <button
            type="button"
            className="btn btn-sm rounded-full gap-2 border-0 bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-600/50 h-10 min-h-10"
            onClick={handleUploadClick}
            disabled={uploading || !selectedUploadType || loading}
          >
            {uploading ? (
              <span className="loading loading-spinner loading-sm" />
            ) : (
              <ArrowUpTrayIcon className="w-4 h-4" />
            )}
            Upload document
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.doc,.docx,.xls,.xlsx,application/pdf,image/*"
            onChange={(e) => void handleFileChange(e)}
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <span className="loading loading-spinner loading-md text-primary" />
          </div>
        ) : filteredHrDocuments.length === 0 ? (
          <div className="rounded-2xl bg-gray-50 py-14 text-center text-gray-400">
            <DocumentTextIcon className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>No HR documents yet.</p>
            <p className="text-sm mt-1">Choose a type and upload a file to get started.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table w-full text-base">
              <thead>
                <tr className="text-sm uppercase tracking-wider text-gray-500">
                  <th className="bg-transparent font-semibold">Document</th>
                  <th className="bg-transparent font-semibold">Type</th>
                  <th className="bg-transparent font-semibold">Uploaded</th>
                  <th className="bg-transparent font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredHrDocuments.map((doc) => (
                  <tr key={doc.id} className="hover:bg-base-200">
                    <td className="font-medium text-gray-900">
                      <div className="flex items-center gap-3 min-w-0">
                        <DocumentFileGlyph
                          fileName={doc.file_name}
                          className="h-9 w-9 shrink-0"
                        />
                        <span className="truncate max-w-[16rem]" title={doc.file_name}>
                          {doc.file_name}
                        </span>
                      </div>
                    </td>
                    <td className="text-gray-700 whitespace-nowrap">
                      <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                        {doc.document_type?.label || '—'}
                      </span>
                    </td>
                    <td className="text-gray-600 whitespace-nowrap text-sm">
                      {formatUploadedAt(doc.created_at)}
                    </td>
                    <td className="text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm btn-circle"
                          title="View"
                          aria-label={`View ${doc.file_name}`}
                          onClick={() => setSelectedHrDocument(doc)}
                        >
                          <EyeIcon className="w-5 h-5" />
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm btn-circle text-error"
                          title="Remove"
                          aria-label={`Remove ${doc.file_name}`}
                          disabled={deletingId === doc.id}
                          onClick={() => void handleDeleteHrDocument(doc)}
                        >
                          {deletingId === doc.id ? (
                            <span className="loading loading-spinner loading-xs" />
                          ) : (
                            <TrashIcon className="w-5 h-5" />
                          )}
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

      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between px-1">
          <div>
            <h3 className="text-base font-semibold text-gray-800">Leave documents</h3>
            <p className="text-sm text-gray-500">
              Attachments from sick days and other unavailabilities
            </p>
          </div>
          <label className="form-control w-full sm:max-w-xs">
            <span className="label-text text-sm text-gray-600 mb-1.5 font-medium">Leave type</span>
            <select
              className="select select-bordered w-full bg-white text-base h-12"
              value={leaveTypeFilter}
              onChange={(e) => setLeaveTypeFilter(e.target.value as LeaveTypeFilter)}
            >
              <option value="all">All leave types</option>
              <option value="sick_days">Sick day/s</option>
              <option value="vacation">Vacation</option>
              <option value="general">General</option>
            </select>
          </label>
        </div>

        <div className="space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <span className="loading loading-spinner loading-md text-primary" />
            </div>
          ) : filteredLeaveDocuments.length === 0 ? (
            <div className="rounded-2xl bg-gray-50 py-12 text-center text-gray-400">
              <p>No leave documents uploaded yet.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {filteredLeaveDocuments.map((doc) => {
                const docName = documentNameFromUrl(doc.document_url);
                const reason = unavailabilityReasonText(doc);
                return (
                  <div
                    key={doc.id}
                    className="flex min-w-0 max-w-full cursor-pointer items-center justify-between gap-2 rounded-[18px] bg-white px-3 py-4 transition-colors hover:bg-base-200/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 sm:gap-3 sm:p-5"
                    role="button"
                    tabIndex={0}
                    aria-label={`View document for ${unavailabilityDateRangeLabel(doc.start_date, doc.end_date)}`}
                    onClick={() => setSelectedLeaveDocument(doc)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedLeaveDocument(doc);
                      }
                    }}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
                      <span className="shrink-0">
                        <DocumentFileGlyph fileName={docName} className="h-10 w-10 sm:h-11 sm:w-11" />
                      </span>
                      <div className="min-w-0 flex-1 overflow-hidden">
                        <p className="min-w-0 break-words text-base font-semibold leading-snug text-gray-900 [overflow-wrap:anywhere]">
                          {docName}
                        </p>
                        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                          <UnavailabilityTypeBadge type={doc.unavailability_type} size="xs" />
                          <span className="text-sm text-gray-600">
                            {unavailabilityDateRangeLabel(doc.start_date, doc.end_date)}
                          </span>
                          <span className="text-sm text-gray-400">·</span>
                          <span className="text-sm text-gray-500">
                            Uploaded {formatUploadedAt(doc.created_at)}
                          </span>
                        </div>
                        {reason !== '—' && (
                          <p className="mt-1 text-sm text-gray-500 truncate" title={reason}>
                            {reason}
                          </p>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      className="btn btn-ghost btn-sm btn-circle min-h-10 min-w-10 h-10 w-10 shrink-0 hover:bg-base-200"
                      title="View document"
                      aria-label={`View ${docName}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedLeaveDocument(doc);
                      }}
                    >
                      <EyeIcon className="w-6 h-6" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {selectedHrDocument && (
        <DocumentViewerModal
          isOpen
          onClose={() => setSelectedHrDocument(null)}
          documentUrl={selectedHrDocument.storage_path}
          documentName={selectedHrDocument.file_name}
          employeeName={employeeName}
          uploadedAt={selectedHrDocument.created_at}
          sickDaysReason={selectedHrDocument.document_type?.label}
          bucketName={EMPLOYEE_HR_DOCUMENTS_BUCKET}
        />
      )}

      {selectedLeaveDocument && (
        <DocumentViewerModal
          isOpen
          onClose={() => setSelectedLeaveDocument(null)}
          documentUrl={selectedLeaveDocument.document_url}
          documentName={documentNameFromUrl(selectedLeaveDocument.document_url)}
          employeeName={employeeName}
          uploadedAt={selectedLeaveDocument.created_at}
          sickDaysReason={unavailabilityReasonText(selectedLeaveDocument)}
        />
      )}
    </div>
  );
};

export default MyDocumentsTab;
