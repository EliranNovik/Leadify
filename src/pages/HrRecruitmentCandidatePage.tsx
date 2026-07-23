import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import EmployeesManager from '../components/admin/EmployeesManager';
import DocumentModal from '../components/DocumentModal';
import DocumentViewerModal from '../components/DocumentViewerModal';
import StaffMeetingEditModal from '../components/StaffMeetingEditModal';
import StaffMeetingParticipantsModal from '../components/StaffMeetingParticipantsModal';
import HrEmployeeAvatar from '../components/hr/HrEmployeeAvatar';
import {
  ArrowLeftIcon,
  CalendarDaysIcon,
  ChevronDownIcon,
  DocumentTextIcon,
  EnvelopeIcon,
  EyeIcon,
  PencilIcon,
  PhoneIcon,
  PlusIcon,
  ShareIcon,
  TrashIcon,
  UserPlusIcon,
  XCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { StarIcon as StarIconSolid } from '@heroicons/react/24/solid';
import { StarIcon as StarIconOutline } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import {
  buildRecruitmentReschedulePath,
  buildRecruitmentSchedulePath,
  candidateDisplayName,
  ensureRecruitmentCandidateForUser,
  updateRecruitmentCandidateProfile,
  type RecruitmentCandidate,
} from '../lib/recruitmentCandidates';
import { transferRecruitmentAssetsOnHire } from '../lib/recruitmentHireTransfer';
import {
  fetchActiveStaffEmployees,
  getSalaryEmployeeInitials,
  salaryAvatarGradientStyle,
  type ActiveStaffEmployee,
} from '../lib/employeeSalaries';
import {
  buildRecruitmentContractEditorPath,
  buildRecruitmentContractPublicUrl,
  createRecruitmentDigitalContract,
  deleteRecruitmentDigitalContract,
  ensureRecruitmentContractPublicToken,
  fetchRecruitmentContractTemplates,
  fetchRecruitmentDigitalContracts,
  fetchRecruitmentUserById,
  type RecruitmentContractTemplateOption,
  type RecruitmentDigitalContract,
  type RecruitmentUser,
} from '../lib/recruitmentDigitalContracts';
import {
  deleteRecruitmentDocument,
  fetchRecruitmentDocumentTypes,
  fetchRecruitmentDocuments,
  fetchRecruitmentInterviewDocuments,
  getRecruitmentDocumentSignedUrl,
  getStaffMeetingDocumentSignedUrl,
  uploadRecruitmentDocument,
  type RecruitmentDocument,
  type RecruitmentDocumentType,
  type RecruitmentInterviewDocument,
} from '../lib/recruitmentDocuments';
import {
  fetchRecruitmentMeetings,
  nextUpcomingMeeting,
  type RecruitmentMeeting,
} from '../lib/recruitmentMeetings';
import { ensureRecruitmentCandidateParticipant } from '../lib/recruitmentMeetingParticipants';
import {
  daysInStage,
  fetchCandidateStageHistory,
  fetchRecruitmentStages,
  getRecruitmentStageBySlug,
  STUCK_STAGE_DAYS,
  updateCandidateStageWithHistory,
  type RecruitmentStage,
} from '../lib/recruitmentStages';
import {
  fetchEnrichedParticipantsByMeetingIds,
  removeMeetingParticipantRow,
  type EnrichedMeetingParticipant,
} from '../lib/staffMeetingParticipants';
import { resolveStaffMeetingDocumentsContext } from '../lib/staffMeetingDocuments';
import { supabase } from '../lib/supabase';
import { useAdminRole } from '../hooks/useAdminRole';

type FileTab = 'overview' | 'meetings' | 'documents' | 'contracts' | 'notes';

/** Same default banner as MyProfilePage / HR employee file. */
const RECRUITMENT_DEFAULT_BANNER =
  'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?ixlib=rb-4.0.3&auto=format&fit=crop&w=2070&q=80';

function formatMeetingWhen(m: RecruitmentMeeting): string {
  if (!m.date) return '—';
  const d = new Date(`${m.date}T${m.time || '00:00'}`);
  if (Number.isNaN(d.getTime())) return `${m.date} ${m.time || ''}`.trim();
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function RecruitmentMeetingStatusBadge({ status }: { status: string | null }) {
  const normalized = String(status || 'scheduled').trim().toLowerCase();
  const isCanceled = normalized.includes('cancel');

  if (isCanceled) {
    return (
      <span className="badge badge-error badge-sm h-7 gap-1 border-0 px-2.5 text-xs font-semibold text-white">
        <XCircleIcon className="h-5 w-5 shrink-0" aria-hidden />
        Canceled
      </span>
    );
  }

  return (
    <span className="badge badge-success badge-sm h-7 border-0 px-2.5 text-xs font-semibold capitalize text-white">
      {status || 'scheduled'}
    </span>
  );
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

async function markCandidateHired(linkedUserId: string): Promise<void> {
  const cand = await ensureRecruitmentCandidateForUser(linkedUserId);
  const stages = await fetchRecruitmentStages();
  const hired = getRecruitmentStageBySlug(stages, 'hired');
  if (!hired) return;
  await updateCandidateStageWithHistory({
    candidateId: cand.id,
    stageId: hired.id,
    note: 'Hired — employee profile created',
  });
}

async function completeHireHandoff(params: {
  linkedUserId: string;
  employeeId: number;
}): Promise<void> {
  await markCandidateHired(params.linkedUserId);
  const transfer = await transferRecruitmentAssetsOnHire({
    userId: params.linkedUserId,
    employeeId: params.employeeId,
  });
  const parts: string[] = ['Candidate marked as Hired'];
  if (transfer.contractsPromoted > 0) {
    parts.push(
      `${transfer.contractsPromoted} contract${transfer.contractsPromoted === 1 ? '' : 's'} moved`,
    );
  }
  if (transfer.documentsCopied > 0) {
    parts.push(
      `${transfer.documentsCopied} document${transfer.documentsCopied === 1 ? '' : 's'} copied`,
    );
  }
  toast.success(parts.join(' · '));
  if (transfer.documentFailures > 0) {
    toast.error(
      `${transfer.documentFailures} document${transfer.documentFailures === 1 ? '' : 's'} failed to copy`,
    );
  }
}

const HrRecruitmentCandidatePage: React.FC = () => {
  const { isSuperUser } = useAdminRole();
  const { userId: rawUserId } = useParams<{ userId: string }>();
  const userId = rawUserId ? decodeURIComponent(rawUserId) : '';
  const navigate = useNavigate();
  const pendingHireUserIdRef = useRef<string | null>(null);
  const [hireDrawerOpen, setHireDrawerOpen] = useState(false);
  const [hireDefaults, setHireDefaults] = useState<Record<string, unknown> | undefined>();

  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<RecruitmentUser | null>(null);
  const [candidate, setCandidate] = useState<RecruitmentCandidate | null>(null);
  const [stages, setStages] = useState<RecruitmentStage[]>([]);
  const [history, setHistory] = useState<
    Array<{ id: number; stage_id: number; changed_at: string; changed_by: string | null; note: string | null; stage?: RecruitmentStage | null }>
  >([]);
  const [meetings, setMeetings] = useState<RecruitmentMeeting[]>([]);
  const [participantsByMeetingId, setParticipantsByMeetingId] = useState<
    Record<number, EnrichedMeetingParticipant[]>
  >({});
  const [participantsModalOpen, setParticipantsModalOpen] = useState(false);
  const [participantsModalLoading, setParticipantsModalLoading] = useState(false);
  const [selectedMeetingForModal, setSelectedMeetingForModal] = useState<any | null>(null);
  const [modalParticipants, setModalParticipants] = useState<EnrichedMeetingParticipant[]>([]);
  const [editMeetingOpen, setEditMeetingOpen] = useState(false);
  const [selectedMeetingForEdit, setSelectedMeetingForEdit] = useState<any | null>(null);
  const [staffDocsOpen, setStaffDocsOpen] = useState(false);
  const [staffDocsMeetingId, setStaffDocsMeetingId] = useState<number | null>(null);
  const [staffDocsTitle, setStaffDocsTitle] = useState('Meeting documents');
  const [documents, setDocuments] = useState<RecruitmentDocument[]>([]);
  const [interviewDocuments, setInterviewDocuments] = useState<RecruitmentInterviewDocument[]>([]);
  const [docTypes, setDocTypes] = useState<RecruitmentDocumentType[]>([]);
  const [contracts, setContracts] = useState<RecruitmentDigitalContract[]>([]);
  const [templates, setTemplates] = useState<RecruitmentContractTemplateOption[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [fileTab, setFileTab] = useState<FileTab>('overview');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSaveStatus, setProfileSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>(
    'idle',
  );
  const skipNextProfileSaveRef = useRef(true);
  const profileSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [stageBusy, setStageBusy] = useState(false);
  const [creatingContract, setCreatingContract] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadTypeId, setUploadTypeId] = useState<number | ''>('');
  const [viewer, setViewer] = useState<{
    url: string;
    name: string;
    uploadedAt?: string;
  } | null>(null);
  const [activeEmployees, setActiveEmployees] = useState<ActiveStaffEmployee[]>([]);
  const [departments, setDepartments] = useState<Array<{ id: number; name: string }>>([]);
  const [referredByOpen, setReferredByOpen] = useState(false);
  const [referredBySearch, setReferredBySearch] = useState('');
  const referredByRef = useRef<HTMLDivElement | null>(null);

  const [profileDraft, setProfileDraft] = useState({
    phone: '',
    linkedin_url: '',
    address: '',
    nationality: '',
    position_applied: '',
    source: '',
    expected_salary: '',
    availability: '',
    notice_period: '',
    notes: '',
    rating: '',
    department_id: '' as string | number,
    recruiter_employee_id: '' as string | number,
    referred_by_employee_id: '' as string | number,
  });

  const loadAll = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const [u, stagesRows, tmpl, types, empRows, deptRes] = await Promise.all([
        fetchRecruitmentUserById(userId),
        fetchRecruitmentStages(),
        fetchRecruitmentContractTemplates().catch(() => []),
        fetchRecruitmentDocumentTypes().catch(() => []),
        fetchActiveStaffEmployees().catch(() => [] as ActiveStaffEmployee[]),
        supabase.from('tenant_departement').select('id, name').order('name'),
      ]);

      if (!u) {
        toast.error('Candidate user not found');
        setUser(null);
        setCandidate(null);
        return;
      }

      const cand = await ensureRecruitmentCandidateForUser(userId);
      const [hist, meets, docs, interviewDocs, ctrs] = await Promise.all([
        fetchCandidateStageHistory(cand.id).catch(() => []),
        fetchRecruitmentMeetings(userId).catch(() => []),
        fetchRecruitmentDocuments(userId).catch(() => []),
        fetchRecruitmentInterviewDocuments(userId).catch(() => []),
        fetchRecruitmentDigitalContracts(userId).catch(() => []),
      ]);

      setUser(u);
      setCandidate(cand);
      setStages(stagesRows);
      setHistory(hist);
      setMeetings(meets);
      setDocuments(docs);
      setInterviewDocuments(interviewDocs);
      const meetingIds = meets.map((m) => m.id).filter((id) => Number.isFinite(id));
      if (meetingIds.length > 0) {
        const displayName = candidateDisplayName(u);
        await Promise.all(
          meetingIds.map((id) =>
            ensureRecruitmentCandidateParticipant(id, userId, displayName).catch(
              () => false,
            ),
          ),
        );
        const byId = await fetchEnrichedParticipantsByMeetingIds(meetingIds);
        setParticipantsByMeetingId(byId);
      } else {
        setParticipantsByMeetingId({});
      }
      setDocTypes(types);
      setContracts(ctrs);
      setTemplates(tmpl);
      setSelectedTemplateId((prev) => {
        if (prev && tmpl.some((t) => t.id === prev)) return prev;
        return tmpl[0]?.id || '';
      });
      setUploadTypeId(types[0]?.id ?? '');
      setActiveEmployees(empRows);
      setDepartments(
        (deptRes.data || []).map((d) => ({ id: Number(d.id), name: d.name })),
      );
      skipNextProfileSaveRef.current = true;
      setProfileDraft({
        phone: cand.phone || '',
        linkedin_url: cand.linkedin_url || '',
        address: cand.address || '',
        nationality: cand.nationality || '',
        position_applied: cand.position_applied || '',
        source: cand.source || '',
        expected_salary: cand.expected_salary || '',
        availability: cand.availability || '',
        notice_period: cand.notice_period || '',
        notes: cand.notes || '',
        rating: cand.rating != null ? String(cand.rating) : '',
        department_id: cand.department_id ?? '',
        recruiter_employee_id: cand.recruiter_employee_id ?? '',
        referred_by_employee_id: cand.referred_by_employee_id ?? '',
      });
      setProfileSaveStatus('idle');
    } catch (error) {
      console.error(error);
      toast.error('Failed to load candidate');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!referredByOpen) return;
    const onDocClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (referredByRef.current && !referredByRef.current.contains(target)) {
        setReferredByOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [referredByOpen]);

  const stage = useMemo(() => {
    if (!candidate) return null;
    return (
      stages.find((s) => s.id === candidate.stage_id) ||
      candidate.stage ||
      null
    );
  }, [candidate, stages]);

  const referredByOptions = useMemo(() => {
    const options = [...activeEmployees];
    const selectedId =
      profileDraft.referred_by_employee_id === ''
        ? null
        : Number(profileDraft.referred_by_employee_id);
    if (
      selectedId != null &&
      Number.isFinite(selectedId) &&
      !options.some((e) => e.id === selectedId)
    ) {
      options.unshift({
        id: selectedId,
        display_name: candidate?.referred_by_name || `Employee #${selectedId}`,
        photo_url: candidate?.referred_by_photo_url || null,
      });
    }
    return options;
  }, [
    activeEmployees,
    profileDraft.referred_by_employee_id,
    candidate?.referred_by_name,
    candidate?.referred_by_photo_url,
  ]);

  const selectedReferredBy = useMemo(() => {
    const selectedId =
      profileDraft.referred_by_employee_id === ''
        ? null
        : Number(profileDraft.referred_by_employee_id);
    if (selectedId == null || !Number.isFinite(selectedId)) return null;
    return referredByOptions.find((e) => e.id === selectedId) || null;
  }, [profileDraft.referred_by_employee_id, referredByOptions]);

  const filteredReferredByOptions = useMemo(() => {
    const q = referredBySearch.trim().toLowerCase();
    if (!q) return referredByOptions;
    return referredByOptions.filter((e) => e.display_name.toLowerCase().includes(q));
  }, [referredByOptions, referredBySearch]);

  const days = daysInStage(candidate?.stage_changed_at);
  const stuck = days >= STUCK_STAGE_DAYS && stage && !stage.is_terminal;
  const upcoming = nextUpcomingMeeting(meetings);
  const name = user ? candidateDisplayName(user) : 'Candidate';

  const toCalendarMeetingShape = useCallback(
    (m: RecruitmentMeeting) => ({
      id: m.id,
      user_id: m.user_id || userId,
      calendar_type: 'recruitment',
      meeting_subject: m.subject || `Job Interview — ${name}`,
      meeting_date: m.date,
      meeting_time: m.time,
      meeting_location: m.location,
      teams_meeting_url: m.teams_meeting_url,
      meeting_brief: m.brief,
      duration: m.duration,
      meeting_duration_minutes: m.duration,
    }),
    [name, userId],
  );

  const refreshMeetingParticipants = useCallback(async (meetingId: number) => {
    try {
      if (userId) {
        await ensureRecruitmentCandidateParticipant(meetingId, userId, name).catch(
          () => false,
        );
      }
      const byId = await fetchEnrichedParticipantsByMeetingIds([meetingId]);
      setParticipantsByMeetingId((prev) => ({ ...prev, ...byId }));
      setModalParticipants(byId[meetingId] || []);
    } catch (err) {
      console.error(err);
    }
  }, [userId, name]);

  const openMeetingParticipantsModal = useCallback(
    async (m: RecruitmentMeeting) => {
      const shaped = toCalendarMeetingShape(m);
      setSelectedMeetingForModal(shaped);
      setParticipantsModalOpen(true);
      setParticipantsModalLoading(true);
      try {
        const cached = participantsByMeetingId[m.id];
        if (cached) setModalParticipants(cached);
        if (userId) {
          await ensureRecruitmentCandidateParticipant(m.id, userId, name).catch(
            () => false,
          );
        }
        const byId = await fetchEnrichedParticipantsByMeetingIds([m.id]);
        const rows = byId[m.id] || [];
        setModalParticipants(rows);
        setParticipantsByMeetingId((prev) => ({ ...prev, ...byId }));
      } catch (err) {
        console.error(err);
        toast.error('Failed to load participants');
        setModalParticipants([]);
      } finally {
        setParticipantsModalLoading(false);
      }
    },
    [participantsByMeetingId, toCalendarMeetingShape, userId, name],
  );

  const handleOpenMeetingDocuments = useCallback(
    (meeting: any | null, dbMeetingId: number | null) => {
      const ctx = resolveStaffMeetingDocumentsContext(meeting, dbMeetingId);
      if (!ctx || ctx.mode !== 'meeting') {
        toast.error('Save this meeting first before uploading documents.');
        return;
      }
      setStaffDocsMeetingId(ctx.staffMeetingId);
      setStaffDocsTitle(ctx.meetingTitle || 'Meeting documents');
      setStaffDocsOpen(true);
    },
    [],
  );

  const handleSetStage = async (stageId: number) => {
    if (!candidate) return;
    if (stageId === candidate.stage_id) return;
    setStageBusy(true);
    try {
      await updateCandidateStageWithHistory({ candidateId: candidate.id, stageId });
      toast.success('Stage updated');
      await loadAll();
    } catch (error) {
      console.error(error);
      toast.error('Failed to update stage');
    } finally {
      setStageBusy(false);
    }
  };

  const candidateIdRef = useRef<number | null>(null);
  const profileDraftRef = useRef(profileDraft);
  candidateIdRef.current = candidate?.id ?? null;
  profileDraftRef.current = profileDraft;

  useEffect(() => {
    if (!candidate?.id) return;
    if (skipNextProfileSaveRef.current) {
      skipNextProfileSaveRef.current = false;
      return;
    }
    if (profileSaveTimerRef.current) clearTimeout(profileSaveTimerRef.current);
    setProfileSaveStatus('saving');
    profileSaveTimerRef.current = setTimeout(() => {
      const id = candidateIdRef.current;
      const draft = profileDraftRef.current;
      if (!id) return;
      void (async () => {
        setSavingProfile(true);
        try {
          const ratingNum = draft.rating.trim() ? Number(draft.rating) : null;
          await updateRecruitmentCandidateProfile(id, {
            phone: draft.phone.trim() || null,
            linkedin_url: draft.linkedin_url.trim() || null,
            address: draft.address.trim() || null,
            nationality: draft.nationality.trim() || null,
            position_applied: draft.position_applied.trim() || null,
            source: draft.source.trim() || null,
            expected_salary: draft.expected_salary.trim() || null,
            availability: draft.availability.trim() || null,
            notice_period: draft.notice_period.trim() || null,
            notes: draft.notes.trim() || null,
            rating: ratingNum != null && Number.isFinite(ratingNum) ? ratingNum : null,
            department_id:
              draft.department_id === '' ? null : Number(draft.department_id),
            referred_by_employee_id:
              draft.referred_by_employee_id === ''
                ? null
                : Number(draft.referred_by_employee_id),
          });
          setProfileSaveStatus('saved');
        } catch (error) {
          console.error(error);
          setProfileSaveStatus('error');
          toast.error('Failed to save profile');
        } finally {
          setSavingProfile(false);
        }
      })();
    }, 700);
    return () => {
      if (profileSaveTimerRef.current) clearTimeout(profileSaveTimerRef.current);
    };
  }, [profileDraft, candidate?.id]);

  const handleCreateContract = async () => {
    if (!user || !selectedTemplateId) return;
    setCreatingContract(true);
    try {
      const created = await createRecruitmentDigitalContract({
        userId: user.id,
        templateId: selectedTemplateId,
        contactName: name,
        contactEmail: user.email,
      });
      toast.success('Contract created');
      navigate(buildRecruitmentContractEditorPath(user.id, created.id));
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Failed to create contract');
    } finally {
      setCreatingContract(false);
    }
  };

  const handleShareContract = async (contract: RecruitmentDigitalContract) => {
    try {
      const token = await ensureRecruitmentContractPublicToken(contract.id);
      const url = buildRecruitmentContractPublicUrl(contract.id, token);
      await navigator.clipboard.writeText(url);
      toast.success('Signing link copied');
    } catch (error) {
      console.error(error);
      toast.error('Failed to copy link');
    }
  };

  const handleDeleteContract = async (contract: RecruitmentDigitalContract) => {
    const label = contract.template_name || 'this contract';
    if (
      !window.confirm(
        `Delete ${label}? This cannot be undone.`,
      )
    ) {
      return;
    }
    try {
      await deleteRecruitmentDigitalContract(contract.id);
      setContracts((prev) => prev.filter((c) => c.id !== contract.id));
      toast.success('Contract deleted');
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Failed to delete contract');
    }
  };

  const handleUpload = async (fileList: FileList | null) => {
    if (!fileList?.length || !user || !candidate || !uploadTypeId) {
      toast.error('Choose a document type and file');
      return;
    }
    const type = docTypes.find((t) => t.id === Number(uploadTypeId));
    if (!type) return;
    setUploading(true);
    try {
      for (const file of Array.from(fileList)) {
        await uploadRecruitmentDocument({
          userId: user.id,
          candidateId: candidate.id,
          documentTypeId: type.id,
          typeSlug: type.slug,
          file,
        });
      }
      toast.success('Document uploaded');
      const docs = await fetchRecruitmentDocuments(user.id);
      setDocuments(docs);
    } catch (error) {
      console.error(error);
      toast.error('Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleOpenDoc = async (doc: RecruitmentDocument) => {
    try {
      const url = await getRecruitmentDocumentSignedUrl(doc.storage_path);
      if (!url) {
        toast.error('Could not open file');
        return;
      }
      setViewer({
        url,
        name: doc.file_name,
        uploadedAt: doc.created_at,
      });
    } catch (error) {
      console.error(error);
      toast.error('Could not open file');
    }
  };

  const handleOpenInterviewDoc = async (doc: RecruitmentInterviewDocument) => {
    try {
      const url = await getStaffMeetingDocumentSignedUrl(doc.storage_path);
      if (!url) {
        toast.error('Could not open file');
        return;
      }
      setViewer({
        url,
        name: doc.file_name,
        uploadedAt: doc.created_at,
      });
    } catch (error) {
      console.error(error);
      toast.error('Could not open file');
    }
  };

  const handleDeleteDoc = async (doc: RecruitmentDocument) => {
    if (!confirm(`Delete ${doc.file_name}?`)) return;
    try {
      await deleteRecruitmentDocument(doc);
      toast.success('Deleted');
      setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
    } catch (error) {
      console.error(error);
      toast.error('Delete failed');
    }
  };

  if (!userId) {
    return <div className="p-8 text-center text-gray-500">Missing candidate id.</div>;
  }

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <span className="loading loading-spinner loading-md text-emerald-600" />
      </div>
    );
  }

  if (!user || !candidate) {
    return (
      <div className="rounded-2xl bg-white p-8 text-center shadow-sm">
        <p className="text-gray-600">Candidate not found.</p>
        <button
          type="button"
          className="mt-4 text-sm font-semibold text-emerald-700"
          onClick={() => navigate('/reports/hr-management?tab=recruitment')}
        >
          Back to recruitment
        </button>
      </div>
    );
  }

  const tabs: Array<{ id: FileTab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'meetings', label: 'Meetings' },
    { id: 'documents', label: 'Documents' },
    { id: 'contracts', label: 'Contracts' },
    { id: 'notes', label: 'Activity' },
  ];

  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-[#ececec] px-4 py-6 md:px-8">
    <div className="mx-auto w-full max-w-none space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-sm font-semibold text-gray-800 shadow-sm hover:bg-gray-50"
          onClick={() => navigate('/reports/hr-management?tab=recruitment')}
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Recruitment
        </button>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-sm font-semibold text-gray-800 hover:bg-gray-50"
            onClick={() => navigate(buildRecruitmentSchedulePath(userId))}
          >
            <CalendarDaysIcon className="h-4 w-4" />
            Schedule interview
          </button>
          <div
            className={`dropdown dropdown-end ${stageBusy ? 'pointer-events-none opacity-60' : ''}`}
          >
            <div
              tabIndex={0}
              role="button"
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              {stageBusy ? 'Updating…' : 'Next stage'}
              <ChevronDownIcon className="h-4 w-4" />
            </div>
            <ul
              tabIndex={0}
              className="dropdown-content menu z-30 mt-1 w-64 rounded-xl border border-gray-100 bg-white p-2 shadow-lg"
            >
              {stages.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    disabled={s.id === candidate.stage_id}
                    className={`justify-between ${s.id === candidate.stage_id ? 'opacity-60' : ''}`}
                    onClick={() => {
                      const el = document.activeElement as HTMLElement | null;
                      el?.blur();
                      void handleSetStage(s.id);
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
                    {s.id === candidate.stage_id ? (
                      <span className="text-xs text-gray-400">Current</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          {isSuperUser && !user.employee_id ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700"
              onClick={() => {
                pendingHireUserIdRef.current = user.id;
                setHireDefaults({
                  connected_user_id: user.id,
                  display_name: name,
                  official_name: name,
                });
                setHireDrawerOpen(true);
              }}
            >
              <UserPlusIcon className="h-4 w-4" />
              Hire candidate
            </button>
          ) : null}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="relative h-44 w-full md:h-52">
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${RECRUITMENT_DEFAULT_BANNER})` }}
          >
            <div className="absolute inset-0 bg-black/35" />
          </div>

          <div className="absolute inset-x-0 bottom-0 z-10 px-5 pb-4 sm:px-6 sm:pb-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex min-w-0 items-end gap-4">
                <span
                  className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full text-xl font-bold text-white shadow-xl sm:h-24 sm:w-24 sm:text-2xl"
                  style={salaryAvatarGradientStyle(
                    Number.parseInt(userId.replace(/\D/g, '').slice(0, 8) || '0', 10) || 0,
                    name,
                  )}
                  aria-hidden
                >
                  {getSalaryEmployeeInitials(name) || '?'}
                </span>
                <div className="min-w-0 flex-1 pb-1">
                  <div
                    className="mb-1 inline-flex items-center gap-0.5"
                    aria-label={
                      profileDraft.rating
                        ? `Rated ${profileDraft.rating} of 5`
                        : 'Not rated'
                    }
                  >
                    {(() => {
                      const current = Number(profileDraft.rating);
                      const rated =
                        Number.isFinite(current) && current > 0
                          ? Math.min(5, Math.round(current))
                          : 0;
                      if (rated > 0) {
                        return Array.from({ length: rated }, (_, i) => (
                          <StarIconSolid
                            key={i}
                            className="h-4 w-4 text-white drop-shadow"
                          />
                        ));
                      }
                      return [1, 2, 3, 4, 5].map((star) => (
                        <StarIconOutline
                          key={star}
                          className="h-4 w-4 text-white/55 drop-shadow"
                        />
                      ));
                    })()}
                  </div>
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h1 className="truncate text-xl font-bold tracking-tight text-white drop-shadow-lg sm:text-2xl md:text-3xl">
                      {name}
                    </h1>
                    <span className="truncate text-sm font-medium text-white/90 drop-shadow-md sm:text-base">
                      {candidate.position_applied || 'No position set'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex shrink-0 flex-col items-stretch gap-1.5 sm:items-end">
                <span
                  className="inline-flex items-center justify-center rounded-full px-5 py-2.5 text-base font-bold text-white shadow-lg sm:px-6 sm:py-3 sm:text-lg"
                  style={{ backgroundColor: stage?.colour || '#6b7280' }}
                >
                  {stage?.name || 'No stage'}
                </span>
                <p
                  className={`text-center text-xs drop-shadow sm:text-right ${
                    stuck ? 'font-semibold text-amber-200' : 'text-white/85'
                  }`}
                >
                  {stuck ? 'Stuck · ' : ''}
                  {days} {days === 1 ? 'day' : 'days'} in stage
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="px-5 py-3 sm:px-6">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-gray-500">
            {user.email ? (
              <a
                href={`mailto:${user.email}`}
                className="inline-flex max-w-full items-center gap-1.5 hover:text-gray-800"
              >
                <EnvelopeIcon className="h-4 w-4 shrink-0 text-gray-400" />
                <span className="truncate">{user.email}</span>
              </a>
            ) : null}
            {profileDraft.phone.trim() ? (
              <a
                href={`tel:${profileDraft.phone.trim()}`}
                className="inline-flex items-center gap-1.5 hover:text-gray-800"
              >
                <PhoneIcon className="h-4 w-4 shrink-0 text-gray-400" />
                <span>{profileDraft.phone.trim()}</span>
              </a>
            ) : null}
          </div>

          {selectedReferredBy ? (
            <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white py-1 pl-1 pr-3 shadow-sm">
              <HrEmployeeAvatar
                employeeId={selectedReferredBy.id}
                name={selectedReferredBy.display_name}
                photoUrl={selectedReferredBy.photo_url}
                size="sm"
                className="!h-7 !w-7 !text-[10px]"
              />
              <span className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
                Referred by
              </span>
              <span className="text-sm font-semibold text-gray-800">
                {selectedReferredBy.display_name}
              </span>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-gray-100 px-5 py-3 sm:px-6">
          {(() => {
            const contractLabel = contracts.some((c) => c.status === 'signed')
              ? 'Signed'
              : contracts.length
                ? 'Pending'
                : 'None';
            const contractTone =
              contractLabel === 'Signed'
                ? 'text-emerald-700'
                : contractLabel === 'Pending'
                  ? 'text-amber-700'
                  : 'text-gray-500';
            return (
              <div className="inline-flex items-center gap-2 text-sm">
                <DocumentTextIcon className="h-4 w-4 text-gray-400" />
                <span className="text-gray-500">Contract</span>
                <span className={`font-semibold ${contractTone}`}>{contractLabel}</span>
              </div>
            );
          })()}
          <div className="hidden h-4 w-px bg-gray-200 sm:block" aria-hidden />
          <div className="inline-flex flex-wrap items-center gap-2 text-sm">
            <CalendarDaysIcon className="h-4 w-4 text-gray-400" />
            <span className="text-gray-500">Next interview</span>
            <span className="font-semibold text-gray-800">
              {upcoming ? formatMeetingWhen(upcoming) : '—'}
            </span>
            {upcoming &&
            String(upcoming.status || '')
              .trim()
              .toLowerCase()
              .includes('cancel') ? (
              <RecruitmentMeetingStatusBadge status={upcoming.status} />
            ) : null}
            <button
              type="button"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 hover:text-emerald-800 hover:underline"
              onClick={() => navigate(buildRecruitmentSchedulePath(userId))}
            >
              <PlusIcon className="h-5 w-5 shrink-0" />
              Schedule new meeting
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-gray-200">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setFileTab(t.id)}
            className={`px-4 py-2.5 text-sm font-semibold ${
              fileTab === t.id
                ? 'border-b-2 border-emerald-600 text-emerald-800'
                : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {fileTab === 'overview' && (
        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5 space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div ref={referredByRef} className="relative flex max-w-sm flex-col gap-1 text-sm">
              <span className="font-medium text-gray-600">Referred by</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-left hover:border-gray-300"
                  onClick={() => {
                    setReferredByOpen((open) => !open);
                    setReferredBySearch('');
                  }}
                >
                  {selectedReferredBy ? (
                    <>
                      <HrEmployeeAvatar
                        employeeId={selectedReferredBy.id}
                        name={selectedReferredBy.display_name}
                        photoUrl={selectedReferredBy.photo_url}
                        size="sm"
                        className="!h-8 !w-8 !text-[10px]"
                      />
                      <span className="min-w-0 flex-1 truncate font-medium text-gray-900">
                        {selectedReferredBy.display_name}
                      </span>
                    </>
                  ) : (
                    <span className="min-w-0 flex-1 text-gray-400">Select employee…</span>
                  )}
                  <ChevronDownIcon className="h-4 w-4 shrink-0 text-gray-400" />
                </button>
                {selectedReferredBy ? (
                  <button
                    type="button"
                    className="shrink-0 rounded-xl border border-gray-200 p-2 text-gray-400 hover:bg-gray-50 hover:text-gray-700"
                    aria-label="Clear referred by"
                    onClick={() => {
                      setProfileDraft((prev) => ({
                        ...prev,
                        referred_by_employee_id: '',
                      }));
                      setReferredByOpen(false);
                    }}
                  >
                    <XMarkIcon className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
              {referredByOpen ? (
                <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
                  <div className="border-b border-gray-100 p-2">
                    <input
                      autoFocus
                      type="text"
                      className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm"
                      placeholder="Search employees…"
                      value={referredBySearch}
                      onChange={(e) => setReferredBySearch(e.target.value)}
                    />
                  </div>
                  <div className="max-h-56 overflow-auto">
                    <button
                      type="button"
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-gray-500 hover:bg-gray-50"
                      onClick={() => {
                        setProfileDraft((prev) => ({
                          ...prev,
                          referred_by_employee_id: '',
                        }));
                        setReferredByOpen(false);
                        setReferredBySearch('');
                      }}
                    >
                      None
                    </button>
                    {filteredReferredByOptions.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-gray-500">No matches</div>
                    ) : (
                      filteredReferredByOptions.map((emp) => {
                        const selected = selectedReferredBy?.id === emp.id;
                        return (
                          <button
                            key={emp.id}
                            type="button"
                            className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-gray-50 ${
                              selected ? 'bg-emerald-50' : ''
                            }`}
                            onClick={() => {
                              setProfileDraft((prev) => ({
                                ...prev,
                                referred_by_employee_id: emp.id,
                              }));
                              setReferredByOpen(false);
                              setReferredBySearch('');
                            }}
                          >
                            <HrEmployeeAvatar
                              employeeId={emp.id}
                              name={emp.display_name}
                              photoUrl={emp.photo_url}
                              size="sm"
                              className="!h-8 !w-8 !text-[10px]"
                            />
                            <span
                              className={`min-w-0 flex-1 truncate ${
                                selected ? 'font-semibold text-emerald-900' : 'font-medium text-gray-900'
                              }`}
                            >
                              {emp.display_name}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              ) : null}
            </div>
            {(
              [
                ['phone', 'Phone'],
                ['linkedin_url', 'LinkedIn'],
                ['address', 'Address'],
                ['nationality', 'Nationality'],
                ['position_applied', 'Position applied'],
                ['source', 'Source'],
                ['expected_salary', 'Expected salary'],
                ['availability', 'Availability'],
                ['notice_period', 'Notice period'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-gray-600">{label}</span>
                <input
                  className="rounded-xl border border-gray-200 px-3 py-2"
                  value={profileDraft[key]}
                  onChange={(e) =>
                    setProfileDraft((prev) => ({ ...prev, [key]: e.target.value }))
                  }
                />
              </label>
            ))}
            <div className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-gray-600">Rating</span>
              <div className="flex items-center gap-1 py-1.5">
                {[1, 2, 3, 4, 5].map((star) => {
                  const current = Number(profileDraft.rating);
                  const active = Number.isFinite(current) && current >= star;
                  const Star = active ? StarIconSolid : StarIconOutline;
                  return (
                    <button
                      key={star}
                      type="button"
                      className={`rounded-md p-0.5 transition ${
                        active
                          ? 'text-gray-900 hover:text-black'
                          : 'text-gray-300 hover:text-gray-500'
                      }`}
                      aria-label={`Rate ${star} of 5`}
                      aria-pressed={active}
                      onClick={() =>
                        setProfileDraft((prev) => ({
                          ...prev,
                          // Click same star again clears rating
                          rating:
                            String(prev.rating) === String(star) ? '' : String(star),
                        }))
                      }
                    >
                      <Star className="h-7 w-7" />
                    </button>
                  );
                })}
              </div>
            </div>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-gray-600">Department</span>
              <select
                className="rounded-xl border border-gray-200 px-3 py-2"
                value={profileDraft.department_id}
                onChange={(e) =>
                  setProfileDraft((prev) => ({
                    ...prev,
                    department_id: e.target.value,
                  }))
                }
              >
                <option value="">—</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            {/* <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-gray-600">Recruiter</span>
              <select
                className="rounded-xl border border-gray-200 px-3 py-2"
                value={profileDraft.recruiter_employee_id}
                onChange={(e) =>
                  setProfileDraft((prev) => ({
                    ...prev,
                    recruiter_employee_id: e.target.value,
                  }))
                }
              >
                <option value="">—</option>
                {activeEmployees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.display_name}
                  </option>
                ))}
              </select>
            </label> */}
          </div>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-gray-600">Notes</span>
            <textarea
              className="min-h-[100px] rounded-xl border border-gray-200 px-3 py-2"
              value={profileDraft.notes}
              onChange={(e) =>
                setProfileDraft((prev) => ({ ...prev, notes: e.target.value }))
              }
            />
          </label>
          <div className="text-xs text-gray-500">
            {profileSaveStatus === 'saving' || savingProfile
              ? 'Saving…'
              : profileSaveStatus === 'saved'
                ? 'Saved'
                : profileSaveStatus === 'error'
                  ? 'Save failed'
                  : null}
          </div>
        </div>
      )}

      {fileTab === 'meetings' && (
        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5 space-y-3">
          <div className="flex justify-end">
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700"
              onClick={() => navigate(buildRecruitmentSchedulePath(userId))}
            >
              <PlusIcon className="h-4 w-4" />
              Schedule
            </button>
          </div>
          {meetings.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500">No interviews yet.</p>
          ) : (
            <table className="table w-full text-sm">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Location</th>
                  <th>Participants</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {meetings.map((m) => {
                  const parts = participantsByMeetingId[m.id] || [];
                  return (
                    <tr
                      key={m.id}
                      className="cursor-pointer hover:bg-base-200/60"
                      onClick={() => void openMeetingParticipantsModal(m)}
                    >
                      <td className="font-medium">
                        <span className="inline-flex items-center gap-1.5">
                          <CalendarDaysIcon className="h-5 w-5 shrink-0 text-gray-400" />
                          {formatMeetingWhen(m)}
                        </span>
                      </td>
                      <td>{m.location || '—'}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {parts.length === 0 ? (
                          <span className="text-gray-400">—</span>
                        ) : (
                          <div className="flex items-center -space-x-2">
                            {parts.slice(0, 4).map((p, idx) => {
                              const initials = String(p.name || '?')
                                .split(' ')
                                .filter(Boolean)
                                .slice(0, 2)
                                .map((s) => s[0]?.toUpperCase())
                                .join('');
                              return (
                                <div
                                  key={p.participantRowId || `${p.name}-${idx}`}
                                  className="relative h-8 w-8 overflow-hidden rounded-full bg-gray-100 ring-2 ring-white"
                                  title={p.name}
                                >
                                  {p.imageUrl ? (
                                    <img
                                      src={p.imageUrl}
                                      alt=""
                                      className="h-full w-full object-cover"
                                    />
                                  ) : (
                                    <span className="flex h-full w-full items-center justify-center text-[10px] font-semibold text-gray-600">
                                      {initials || '?'}
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                            {parts.length > 4 ? (
                              <span className="ml-2 text-xs font-medium text-gray-500">
                                +{parts.length - 4}
                              </span>
                            ) : null}
                          </div>
                        )}
                      </td>
                      <td>
                        <RecruitmentMeetingStatusBadge status={m.status} />
                      </td>
                      <td className="text-right" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          title="Edit meeting"
                          onClick={() => {
                            void (async () => {
                              if (userId) {
                                await ensureRecruitmentCandidateParticipant(
                                  m.id,
                                  userId,
                                  name,
                                ).catch(() => false);
                              }
                              setSelectedMeetingForEdit(toCalendarMeetingShape(m));
                              setEditMeetingOpen(true);
                            })();
                          }}
                        >
                          <PencilIcon className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() =>
                            navigate(buildRecruitmentReschedulePath(userId, m.id))
                          }
                        >
                          Reschedule
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {fileTab === 'documents' && (
        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5 space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-gray-600">Type</span>
              <select
                className="rounded-xl border border-gray-200 px-3 py-2 min-w-[10rem]"
                value={uploadTypeId}
                onChange={(e) =>
                  setUploadTypeId(e.target.value ? Number(e.target.value) : '')
                }
              >
                {docTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
              <PlusIcon className="h-4 w-4" />
              {uploading ? 'Uploading…' : 'Upload'}
              <input
                type="file"
                className="hidden"
                multiple
                disabled={uploading}
                onChange={(e) => {
                  void handleUpload(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
          {documents.length === 0 && interviewDocuments.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500">No documents yet.</p>
          ) : (
            <table className="table w-full text-sm">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Type</th>
                  <th>Uploaded</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {interviewDocuments.map((doc) => (
                  <tr key={doc.id}>
                    <td className="font-medium">
                      <span className="inline-flex items-center gap-1.5">
                        <DocumentTextIcon className="h-5 w-5 shrink-0 text-gray-400" />
                        {doc.file_name}
                      </span>
                    </td>
                    <td>
                      Interview
                      {doc.meeting_date ? (
                        <span className="ml-1 text-xs text-gray-500">
                          ({doc.meeting_date})
                        </span>
                      ) : null}
                    </td>
                    <td>{formatCreatedAt(doc.created_at)}</td>
                    <td className="text-right">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm btn-circle"
                        title="View"
                        onClick={() => void handleOpenInterviewDoc(doc)}
                      >
                        <EyeIcon className="h-5 w-5" />
                      </button>
                    </td>
                  </tr>
                ))}
                {documents.map((doc) => (
                  <tr key={doc.id}>
                    <td className="font-medium">
                      <span className="inline-flex items-center gap-1.5">
                        <DocumentTextIcon className="h-5 w-5 shrink-0 text-gray-400" />
                        {doc.file_name}
                      </span>
                    </td>
                    <td>{doc.document_type?.label || '—'}</td>
                    <td>{formatCreatedAt(doc.created_at)}</td>
                    <td className="text-right">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm btn-circle"
                        title="View"
                        onClick={() => void handleOpenDoc(doc)}
                      >
                        <EyeIcon className="h-5 w-5" />
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm btn-circle text-error"
                        title="Delete"
                        onClick={() => void handleDeleteDoc(doc)}
                      >
                        <TrashIcon className="h-5 w-5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {fileTab === 'contracts' && (
        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5 space-y-4">
          {isSuperUser ? (
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-gray-600">Template</span>
                <select
                  className="rounded-xl border border-gray-200 px-3 py-2 min-w-[12rem]"
                  value={selectedTemplateId}
                  onChange={(e) => setSelectedTemplateId(e.target.value)}
                >
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                disabled={creatingContract || !selectedTemplateId}
                onClick={() => void handleCreateContract()}
              >
                <PlusIcon className="h-4 w-4" />
                Create contract
              </button>
            </div>
          ) : null}
          {contracts.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500">No digital contracts yet.</p>
          ) : (
            <table className="table w-full text-sm">
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
                    <td>
                      <span className="inline-flex items-center gap-1.5 font-medium">
                        <DocumentTextIcon className="h-5 w-5 shrink-0 text-gray-400" />
                        {contract.template_name || 'Employee contract'}
                      </span>
                    </td>
                    <td>{contract.status || 'draft'}</td>
                    <td>
                      {contract.created_at ? formatCreatedAt(contract.created_at) : '—'}
                    </td>
                    <td className="text-right">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm btn-circle"
                        title="Open contract"
                        onClick={() =>
                          navigate(
                            buildRecruitmentContractEditorPath(user.id, contract.id),
                          )
                        }
                      >
                        <EyeIcon className="h-5 w-5" />
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm btn-circle"
                        title="Copy signing link"
                        onClick={() => void handleShareContract(contract)}
                      >
                        <ShareIcon className="h-5 w-5" />
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm btn-circle text-error"
                        title="Delete contract"
                        onClick={() => void handleDeleteContract(contract)}
                      >
                        <TrashIcon className="h-5 w-5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {fileTab === 'notes' && (
        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5 space-y-3">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <DocumentTextIcon className="h-4 w-4" />
            Stage history
          </h3>
          {history.length === 0 ? (
            <p className="text-sm text-gray-500">No stage changes recorded yet.</p>
          ) : (
            <ul className="space-y-2">
              {history.map((h) => (
                <li
                  key={h.id}
                  className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm"
                >
                  <div className="font-medium text-gray-800">
                    {h.stage?.name || `Stage #${h.stage_id}`}
                  </div>
                  <div className="text-xs text-gray-500">
                    {formatCreatedAt(h.changed_at)}
                    {h.changed_by ? ` · ${h.changed_by}` : ''}
                  </div>
                  {h.note ? <p className="mt-1 text-gray-600">{h.note}</p> : null}
                </li>
              ))}
            </ul>
          )}
          {candidate.notes ? (
            <div className="mt-4 rounded-xl border border-amber-100 bg-amber-50/50 px-3 py-2 text-sm">
              <div className="font-semibold text-amber-900">Profile notes</div>
              <p className="mt-1 whitespace-pre-wrap text-amber-950/80">{candidate.notes}</p>
            </div>
          ) : null}
        </div>
      )}

      {viewer ? (
        <DocumentViewerModal
          isOpen
          onClose={() => setViewer(null)}
          documentUrl={viewer.url}
          documentName={viewer.name}
          employeeName={name}
          uploadedAt={viewer.uploadedAt}
        />
      ) : null}

      <StaffMeetingParticipantsModal
        open={participantsModalOpen}
        onClose={() => setParticipantsModalOpen(false)}
        meeting={selectedMeetingForModal}
        dbMeetingId={
          selectedMeetingForModal?.id != null ? Number(selectedMeetingForModal.id) : null
        }
        participants={modalParticipants}
        loading={participantsModalLoading}
        onOpenDocuments={handleOpenMeetingDocuments}
        onEdit={(meeting) => {
          void (async () => {
            const mid = meeting?.id != null ? Number(meeting.id) : null;
            const uid = meeting?.user_id || userId;
            if (mid != null && uid) {
              await ensureRecruitmentCandidateParticipant(mid, String(uid), name).catch(
                () => false,
              );
            }
            setSelectedMeetingForEdit(meeting);
            setEditMeetingOpen(true);
            setParticipantsModalOpen(false);
          })();
        }}
        onRemoveParticipant={async (participantRowId) => {
          try {
            await removeMeetingParticipantRow(participantRowId);
            setModalParticipants((prev) =>
              prev.filter((p) => String(p.participantRowId) !== participantRowId),
            );
            const mid =
              selectedMeetingForModal?.id != null
                ? Number(selectedMeetingForModal.id)
                : null;
            if (mid != null) {
              setParticipantsByMeetingId((prev) => ({
                ...prev,
                [mid]: (prev[mid] || []).filter(
                  (p) => String(p.participantRowId) !== participantRowId,
                ),
              }));
            }
            toast.success('Participant removed');
          } catch (e: any) {
            console.error(e);
            toast.error(e?.message || 'Failed to remove participant');
            throw e;
          }
        }}
      />

      <StaffMeetingEditModal
        isOpen={editMeetingOpen}
        onClose={() => {
          setEditMeetingOpen(false);
          setSelectedMeetingForEdit(null);
        }}
        meeting={selectedMeetingForEdit}
        onOpenDocuments={(meeting, dbMeetingId) =>
          handleOpenMeetingDocuments(meeting, dbMeetingId)
        }
        onUpdate={() => {
          void loadAll();
          const mid =
            selectedMeetingForEdit?.id != null
              ? Number(selectedMeetingForEdit.id)
              : null;
          if (mid != null) void refreshMeetingParticipants(mid);
        }}
        onDelete={() => {
          void loadAll();
          setEditMeetingOpen(false);
          setSelectedMeetingForEdit(null);
        }}
      />

      {staffDocsMeetingId != null ? (
        <DocumentModal
          isOpen={staffDocsOpen}
          onClose={() => {
            setStaffDocsOpen(false);
            setStaffDocsMeetingId(null);
            void loadAll();
          }}
          staffMeetingId={staffDocsMeetingId}
          staffMeetingTitle={staffDocsTitle}
          modalTitle="Meeting documents"
        />
      ) : null}

      <EmployeesManager
        embed={{
          addDrawerOpen: hireDrawerOpen,
          onAddDrawerOpenChange: (open) => {
            setHireDrawerOpen(open);
            if (!open) {
              setHireDefaults(undefined);
              pendingHireUserIdRef.current = null;
            }
          },
          createDefaults: hireDefaults,
          onRecordCreated: (record) => {
            const linked = pendingHireUserIdRef.current;
            const employeeId = record?.id != null ? Number(record.id) : NaN;
            pendingHireUserIdRef.current = null;
            void (async () => {
              if (linked && Number.isFinite(employeeId) && employeeId > 0) {
                try {
                  await completeHireHandoff({ linkedUserId: linked, employeeId });
                } catch (err) {
                  console.error(err);
                  toast.error(
                    'Employee created, but failed to finish hire handoff (stage / docs / contracts)',
                  );
                }
              } else if (linked) {
                try {
                  await markCandidateHired(linked);
                  toast.success('Candidate marked as Hired');
                  toast.error('Could not copy documents/contracts — missing employee id');
                } catch (err) {
                  console.error(err);
                  toast.error('Employee created, but failed to set Hired stage');
                }
              }
              await loadAll();
            })();
          },
        }}
      />
    </div>
    </div>
  );
};

export default HrRecruitmentCandidatePage;

