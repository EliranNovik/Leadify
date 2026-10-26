import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import {
  ArrowRightCircleIcon,
  ArrowsRightLeftIcon,
  ArrowUpTrayIcon,
  BriefcaseIcon,
  BuildingOffice2Icon,
  CalendarDaysIcon,
  DocumentDuplicateIcon,
  DocumentPlusIcon,
  FolderPlusIcon,
  MagnifyingGlassIcon,
  UserIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { FolderIcon as FolderSolidIcon } from '@heroicons/react/24/solid';
import { searchLeads } from '../lib/legacyLeadsApi';
import {
  childFolders,
  createDocumentFolder,
  listDocumentFolders,
  MAX_DOCUMENT_FOLDER_TITLE,
  type DocumentFolder,
  type DocumentFolderScope,
} from '../lib/documentFolders';
import {
  describeDestination,
  fetchDriveClassifications,
  isSameDrivePlace,
  searchDriveMeetings,
  transferDocumentsToDestination,
  uploadEntriesToDestination,
  type DriveClassification,
  type DriveCreatedFile,
  type DriveDestination,
  type DriveMeetingOption,
  type DriveTransferMode,
} from '../lib/documentDriveUpload';
import { formatDocumentSize, type DocumentIndexRow } from '../lib/documentIndex';
import { blankOfficeSpec, type BlankOfficeKind } from '../lib/blankOfficeDocuments';
import { DocumentFileGlyph, ExcelLogoIcon, WordLogoIcon } from '../lib/documentFileGlyphs';
import {
  entriesFromDirectoryInput,
  expandDroppedItems,
  planFolderUpload,
  readDroppedItems,
  type FolderUploadEntry,
} from '../lib/browserFolderUpload';
import { createOfficeDocumentFolder, fetchOfficeDocumentFolders, type OfficeDocumentFolder } from '../lib/officeDocuments';
import { orderSpaceFolders } from '../lib/spaceFolders';
import { fetchOfficeSpaces, OFFICE_ADMIN_SPACE, type OfficeSpace } from '../lib/officeSpaces';
import {
  createEmployeePersonalFolder,
  fetchEmployeePersonalFolders,
  type EmployeePersonalFolder,
} from '../lib/employeePersonalSpace';
import { fetchStageActorInfo } from '../lib/leadStageManager';

/**
 * Pick where something goes, then put it there. One dialog covers uploading files, uploading a
 * whole folder, creating an empty folder and starting a new Word or Excel document, because all
 * of them need the same destination.
 */

export type DriveCreateMode =
  | 'files'
  | 'folder'
  | 'new-folder'
  | 'new-word'
  | 'new-excel'
  | 'copy'
  | 'move';

export type DriveCreateContext = {
  leadNumber?: string | null;
  leadName?: string | null;
  classificationId?: string | null;
  /** The open folder's area, since a folder has to be created in its parent's exact scope. */
  area?: string | null;
  folderId?: string | null;
  officeSpaceKey?: string | null;
  /** The open folder inside a department space, so new files land in it rather than at the top. */
  officeFolderId?: string | null;
  /** The same, for a folder open in the employee's own space. */
  personalFolderId?: string | null;
  /** The section the drive is showing, so the dialog opens on the same one. */
  section?: 'lead' | 'staff_meeting' | 'office' | 'personal' | null;
};

type Section = 'lead' | 'staff_meeting' | 'office' | 'personal';

const SECTIONS: Array<{ id: Section; label: string; icon: typeof BriefcaseIcon }> = [
  { id: 'lead', label: 'Cases', icon: BriefcaseIcon },
  { id: 'staff_meeting', label: 'Meetings', icon: CalendarDaysIcon },
  { id: 'office', label: 'Office', icon: BuildingOffice2Icon },
  { id: 'personal', label: 'My space', icon: UserIcon },
];

const MODE_TITLE: Record<DriveCreateMode, string> = {
  files: 'Upload files',
  folder: 'Upload a folder',
  'new-folder': 'New folder',
  'new-word': 'New Word document',
  'new-excel': 'New Excel sheet',
  copy: 'Copy to another place',
  move: 'Move to another place',
};

/** Which editor a mode is for, and null for the modes that are not about a new document. */
function blankKindForMode(mode: DriveCreateMode): BlankOfficeKind | null {
  if (mode === 'new-word') return 'word';
  if (mode === 'new-excel') return 'excel';
  return null;
}

type LeadOption = { leadNumber: string; name: string };

const DocumentsDriveCreateModal: React.FC<{
  mode: DriveCreateMode;
  context?: DriveCreateContext;
  /** Already-dropped files, when the dialog is opened by dropping onto the table. */
  initialEntries?: FolderUploadEntry[];
  /** The documents a copy or move is about, which are already in the drive. */
  sourceRows?: DocumentIndexRow[];
  onClose: () => void;
  /** Told what was created, so a new document can be opened for editing straight away. */
  onDone: (created?: DriveCreatedFile[]) => void;
}> = ({ mode, context, initialEntries, sourceRows, onClose, onDone }) => {
  const blankKind = blankKindForMode(mode);
  const transferMode: DriveTransferMode | null =
    mode === 'copy' || mode === 'move' ? mode : null;
  const transferRows = useMemo(() => sourceRows ?? [], [sourceRows]);
  // A meeting keeps no folders of its own, so there is nothing to create one in. A folder can
  // still be dropped on it: the files land in the meeting itself, which the dialog says below.
  const sections = useMemo(
    () => (mode === 'new-folder' ? SECTIONS.filter((s) => s.id !== 'staff_meeting') : SECTIONS),
    [mode],
  );

  const [section, setSection] = useState<Section>(() =>
    context?.section && sections.some((s) => s.id === context.section)
      ? (context.section as Section)
      : sections[0]?.id ?? 'lead',
  );
  const [busy, setBusy] = useState(false);

  const [leadTerm, setLeadTerm] = useState('');
  const [leadResults, setLeadResults] = useState<LeadOption[]>([]);
  const [leadSearching, setLeadSearching] = useState(false);
  const [lead, setLead] = useState<LeadOption | null>(
    context?.leadNumber ? { leadNumber: context.leadNumber, name: context.leadName || '' } : null,
  );

  const [classifications, setClassifications] = useState<DriveClassification[]>([]);
  const [classificationId, setClassificationId] = useState<string>(context?.classificationId || '');

  const [caseFolders, setCaseFolders] = useState<DocumentFolder[]>([]);
  const [caseFolderId, setCaseFolderId] = useState<string | null>(context?.folderId ?? null);
  // The tree the open folder belongs to. Picking a different tab or case leaves it behind.
  const [caseArea, setCaseArea] = useState<string | null>(context?.area ?? null);

  const [meetingTerm, setMeetingTerm] = useState('');
  const [meetings, setMeetings] = useState<DriveMeetingOption[]>([]);
  const [meeting, setMeeting] = useState<DriveMeetingOption | null>(null);

  const [officeSpaces, setOfficeSpaces] = useState<OfficeSpace[]>([OFFICE_ADMIN_SPACE]);
  const [officeSpaceKey, setOfficeSpaceKey] = useState<string>(
    context?.officeSpaceKey || OFFICE_ADMIN_SPACE.scopeKey,
  );
  const [officeFolders, setOfficeFolders] = useState<OfficeDocumentFolder[]>([]);
  const [officeFolderId, setOfficeFolderId] = useState<string | null>(context?.officeFolderId ?? null);

  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [personalFolders, setPersonalFolders] = useState<EmployeePersonalFolder[]>([]);
  const [personalFolderId, setPersonalFolderId] = useState<string | null>(
    context?.personalFolderId ?? null,
  );

  const [folderName, setFolderName] = useState('');
  const [documentName, setDocumentName] = useState('');
  const [showAllSteps, setShowAllSteps] = useState(false);
  // Dropped onto the table rather than picked here, so the files are already in hand.
  const [dropped] = useState(() =>
    initialEntries && initialEntries.length > 0 ? planFolderUpload(initialEntries) : null,
  );
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchDriveClassifications()
      .then((rows) => {
        setClassifications(rows);
        setClassificationId((prev) => prev || rows[0]?.id || '');
      })
      .catch((err: any) => toast.error(err?.message || 'Could not load document tabs'));
    void fetchStageActorInfo()
      .then((actor) => setEmployeeId(actor.employeeId))
      .catch(() => setEmployeeId(null));
  }, []);

  useEffect(() => {
    const term = leadTerm.trim();
    if (term.length < 2) {
      setLeadResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLeadSearching(true);
      searchLeads(term, { limit: 15, signal: controller.signal })
        .then((rows) =>
          setLeadResults(
            rows
              .filter((row) => (row.lead_number || '').trim())
              .map((row) => ({ leadNumber: String(row.lead_number), name: String(row.name || '') })),
          ),
        )
        .catch(() => setLeadResults([]))
        .finally(() => setLeadSearching(false));
    }, 300);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [leadTerm]);

  const caseScope: DocumentFolderScope | null = useMemo(
    () =>
      lead && classificationId
        ? { scopeType: 'lead', scopeKey: lead.leadNumber, classificationId, area: caseArea }
        : null,
    [lead, classificationId, caseArea],
  );

  useEffect(() => {
    if (!caseScope) {
      setCaseFolders([]);
      return;
    }
    let cancelled = false;
    listDocumentFolders(caseScope)
      .then((rows) => {
        if (cancelled) return;
        setCaseFolders(rows);
        // A folder from another tree would be rejected as a parent, so never keep one.
        setCaseFolderId((prev) => (prev && rows.some((row) => row.id === prev) ? prev : null));
      })
      .catch(() => {
        if (!cancelled) setCaseFolders([]);
      });
    return () => {
      cancelled = true;
    };
  }, [caseScope]);

  useEffect(() => {
    if (section !== 'staff_meeting') return;
    const timer = window.setTimeout(() => {
      searchDriveMeetings(meetingTerm)
        .then(setMeetings)
        .catch(() => setMeetings([]));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [section, meetingTerm]);

  useEffect(() => {
    if (section !== 'office') return;
    fetchOfficeSpaces()
      .then((spaces) => {
        setOfficeSpaces(spaces);
        // A space you cannot reach would only fail on insert, so fall back to the admin space.
        setOfficeSpaceKey((prev) =>
          spaces.some((space) => space.scopeKey === prev) ? prev : OFFICE_ADMIN_SPACE.scopeKey,
        );
      })
      .catch(() => setOfficeSpaces([OFFICE_ADMIN_SPACE]));
  }, [section]);

  const officeSpace = useMemo(
    () => officeSpaces.find((space) => space.scopeKey === officeSpaceKey) || OFFICE_ADMIN_SPACE,
    [officeSpaces, officeSpaceKey],
  );

  useEffect(() => {
    if (section !== 'office') return;
    let cancelled = false;
    fetchOfficeDocumentFolders(officeSpace.departmentId)
      .then((rows) => {
        if (cancelled) return;
        setOfficeFolders(rows);
        setOfficeFolderId((prev) => (rows.some((row) => row.id === prev) ? prev : null));
      })
      .catch(() => {
        if (!cancelled) setOfficeFolders([]);
      });
    return () => {
      cancelled = true;
    };
  }, [section, officeSpace]);

  useEffect(() => {
    if (section !== 'personal' || employeeId == null) return;
    fetchEmployeePersonalFolders(employeeId)
      .then((rows) => {
        setPersonalFolders(rows);
        setPersonalFolderId((prev) => (rows.some((row) => row.id === prev) ? prev : null));
      })
      .catch(() => setPersonalFolders([]));
  }, [section, employeeId]);

  // Both of these stores keep their folders as a tree now, so the pickers show the nesting.
  const orderedOfficeFolders = useMemo(() => orderSpaceFolders(officeFolders), [officeFolders]);
  const orderedPersonalFolders = useMemo(
    () => orderSpaceFolders(personalFolders),
    [personalFolders],
  );

  const orderedCaseFolders = useMemo(() => {
    const out: Array<{ folder: DocumentFolder; depth: number }> = [];
    const walk = (parentId: string | null, depth: number) => {
      for (const folder of childFolders(caseFolders, parentId)) {
        out.push({ folder, depth });
        walk(folder.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [caseFolders]);

  const destination: DriveDestination | null = useMemo(() => {
    if (section === 'lead') {
      if (!lead || !classificationId) return null;
      return {
        kind: 'lead',
        leadNumber: lead.leadNumber,
        leadName: lead.name,
        classificationId,
        classificationLabel: classifications.find((c) => c.id === classificationId)?.label || null,
        folderId: caseFolderId,
      };
    }
    if (section === 'staff_meeting') {
      if (!meeting) return null;
      return { kind: 'staff_meeting', meetingId: meeting.id, meetingTitle: meeting.label };
    }
    if (section === 'office') {
      return {
        kind: 'office',
        folderId: officeFolderId,
        departmentId: officeSpace.departmentId,
        spaceLabel: officeSpace.label,
      };
    }
    if (employeeId == null) return null;
    return { kind: 'personal', employeeId, folderId: personalFolderId };
  }, [
    section,
    lead,
    classificationId,
    classifications,
    caseFolderId,
    meeting,
    officeFolderId,
    officeSpace,
    employeeId,
    personalFolderId,
  ]);

  const runUpload = useCallback(
    async (entries: FolderUploadEntry[], folderPaths: string[][]) => {
      if (!destination || entries.length === 0) return;
      setBusy(true);
      setProgress({ done: 0, total: entries.length });
      try {
        const actor = await fetchStageActorInfo().catch(() => null);
        const result = await uploadEntriesToDestination({
          destination,
          entries,
          folderPaths,
          uploadedBy: actor?.fullName || null,
          onProgress: (done, total) => setProgress({ done, total }),
        });
        if (result.succeeded > 0) {
          toast.success(
            result.failed > 0
              ? `Uploaded ${result.succeeded}, ${result.failed} failed`
              : `Uploaded ${result.succeeded} ${result.succeeded === 1 ? 'file' : 'files'}`,
          );
          onDone();
        } else {
          toast.error(result.lastError || 'Nothing could be uploaded');
        }
      } catch (err: any) {
        toast.error(err?.message || 'Upload failed');
      } finally {
        setBusy(false);
        setProgress(null);
      }
    },
    [destination, onDone],
  );

  /** Where the source documents sit now, so the dialog can refuse a pointless move. */
  const alreadyThere = useMemo(
    () =>
      !!destination &&
      transferRows.length > 0 &&
      transferRows.every((row) => isSameDrivePlace(row, destination)),
    [destination, transferRows],
  );

  const runTransfer = useCallback(async () => {
    if (!destination || !transferMode || transferRows.length === 0) return;
    setBusy(true);
    setProgress({ done: 0, total: transferRows.length });
    try {
      const actor = await fetchStageActorInfo().catch(() => null);
      const result = await transferDocumentsToDestination({
        rows: transferRows,
        destination,
        mode: transferMode,
        uploadedBy: actor?.fullName || null,
        onProgress: (done, total) => setProgress({ done, total }),
      });

      if (result.succeeded === 0) {
        toast.error(result.lastError || 'Nothing could be copied');
        return;
      }
      const what = `${result.succeeded} ${result.succeeded === 1 ? 'file' : 'files'}`;
      if (result.originalsKept > 0) {
        toast.success(
          `Copied ${what} to ${describeDestination(destination)}, but the original stayed where it was`,
        );
      } else {
        toast.success(
          `${transferMode === 'move' ? 'Moved' : 'Copied'} ${what} to ${describeDestination(destination)}`,
        );
      }
      if (result.failed > 0) toast.error(`${result.failed} could not be handled`);
      onDone();
    } catch (err: any) {
      toast.error(err?.message || 'Could not copy this file');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [destination, transferMode, transferRows, onDone]);

  const startUpload = (raw: FolderUploadEntry[]) => {
    const plan = planFolderUpload(raw);
    if (plan.entries.length === 0) return;
    if (plan.droppedForLimit > 0) {
      toast.error(`${plan.droppedForLimit} files were skipped — too many at once`);
    }
    void runUpload(plan.entries, plan.folderPaths);
  };

  const handleFiles = (fileList: FileList | null) => {
    const files = fileList ? Array.from(fileList) : [];
    if (files.length === 0) return;
    startUpload(
      mode === 'folder'
        ? entriesFromDirectoryInput(files)
        : files.map((file) => ({ file, segments: [] })),
    );
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (!destination || busy) return;
    // The dropped items must be read before any await or the browser discards them.
    const items = readDroppedItems(event.dataTransfer);
    void (async () => {
      const entries = await expandDroppedItems(items);
      startUpload(entries);
    })();
  };

  const createFolder = async () => {
    const title = folderName.trim();
    if (!title) {
      toast.error('Give the folder a name');
      return;
    }
    setBusy(true);
    try {
      if (section === 'lead') {
        if (!caseScope) throw new Error('Pick a case and a tab first');
        const actor = await fetchStageActorInfo().catch(() => null);
        await createDocumentFolder({
          scope: caseScope,
          title,
          parentId: caseFolderId,
          createdBy: actor?.fullName || null,
          createdByEmployeeId: actor?.employeeId ?? null,
        });
      } else if (section === 'office') {
        await createOfficeDocumentFolder(title, officeSpace.departmentId, officeFolderId);
      } else {
        if (employeeId == null) throw new Error('Could not tell which employee you are');
        await createEmployeePersonalFolder(employeeId, title, personalFolderId);
      }
      toast.success(`Created “${title}”`);
      onDone();
    } catch (err: any) {
      toast.error(err?.message || 'Could not create the folder');
    } finally {
      setBusy(false);
    }
  };

  /**
   * Put an empty document where it was asked for. It goes through the same upload as any file,
   * so it lands in storage, in the right folder and in the right table, and the caller can open
   * it for editing from what comes back.
   */
  const createBlankDocument = async () => {
    if (!destination || !blankKind) return;
    const spec = blankOfficeSpec(blankKind);
    setBusy(true);
    try {
      const { createBlankOfficeFile } = await import('../lib/blankOfficeDocuments');
      const file = await createBlankOfficeFile(blankKind, documentName);
      const actor = await fetchStageActorInfo().catch(() => null);
      const result = await uploadEntriesToDestination({
        destination,
        entries: [{ file, segments: [] }],
        uploadedBy: actor?.fullName || null,
      });
      if (result.succeeded === 0) {
        throw new Error(result.lastError || `Could not create the ${spec.appName} document`);
      }
      toast.success(`Created “${file.name}”`);
      onDone(result.created);
    } catch (err: any) {
      toast.error(err?.message || `Could not create the ${spec.appName} document`);
    } finally {
      setBusy(false);
    }
  };

  const ready =
    !!destination &&
    (mode !== 'new-folder' || !!folderName.trim()) &&
    (!blankKind || !!documentName.trim()) &&
    (!transferMode || (transferRows.length > 0 && !alreadyThere));

  /**
   * Opened from inside a case, a folder or an office space, the destination is already decided,
   * so the dialog asks only for what is still missing instead of walking through every step.
   */
  const contextSection =
    context?.section && sections.some((item) => item.id === context.section)
      ? (context.section as Section)
      : null;
  const knownLead = contextSection === 'lead' && !!context?.leadNumber;
  const knownTab = knownLead && !!context?.classificationId;
  const knownSpace = contextSection === 'office' && !!context?.officeSpaceKey;
  const knownPersonal = contextSection === 'personal' && employeeId != null;
  const destinationKnown =
    (knownLead || knownSpace || knownPersonal) && section === contextSection;
  const showSections = showAllSteps || !destinationKnown;
  const showLeadPicker = showAllSteps || !knownLead || section !== 'lead';
  const showTabPicker = showAllSteps || !knownTab || section !== 'lead';
  const showSpacePicker = showAllSteps || !knownSpace || section !== 'office';

  return (
    <div className="fixed inset-0 z-[75] flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="mt-8 w-full max-w-2xl rounded-2xl bg-base-100 shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-base-300 px-5 py-4">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              {blankKind === 'word' ? (
                <WordLogoIcon className="h-6 w-6 shrink-0" />
              ) : blankKind === 'excel' ? (
                <ExcelLogoIcon className="h-6 w-6 shrink-0" />
              ) : null}
              {MODE_TITLE[mode]}
            </h2>
            <p className="mt-0.5 flex items-center gap-2 text-sm text-base-content/60">
              <span className="truncate">
                {destination ? `Into ${describeDestination(destination)}` : 'Choose where it goes'}
              </span>
              {destinationKnown && !showAllSteps && (
                <button
                  type="button"
                  className="btn btn-xs shrink-0 gap-1 rounded-full border-base-300 bg-base-200"
                  onClick={() => setShowAllSteps(true)}
                >
                  <ArrowsRightLeftIcon className="h-3.5 w-3.5" />
                  Other place
                </button>
              )}
            </p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm btn-square" onClick={onClose}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 px-5 py-5">
          {showSections && (
          <div>
            <h3 className="mb-2 text-sm font-semibold text-base-content/70">Where</h3>
            {/* One grey tray holding the four places, with the chosen one raised out of it in
                white — the sections read as one choice rather than four buttons. */}
            <div className="inline-flex flex-wrap items-center gap-1 rounded-2xl bg-base-200 p-1">
              {sections.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`btn btn-ghost btn-sm gap-1.5 rounded-full border-0 ${
                    section === item.id
                      ? 'bg-white text-base-content shadow-sm hover:bg-white dark:bg-base-100 dark:hover:bg-base-100'
                      : 'text-base-content/70 hover:bg-base-300'
                  }`}
                  onClick={() => setSection(item.id)}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          )}

          {section === 'lead' && (
            <>
              {showLeadPicker && (
              <div>
                <h3 className="mb-2 text-sm font-semibold text-base-content/70">Which case</h3>
                {lead ? (
                  <div className="flex items-center gap-2 rounded-xl bg-base-200 px-4 py-3">
                    <BriefcaseIcon className="h-5 w-5 shrink-0 text-base-content/60" />
                    <span className="min-w-0 flex-1 truncate text-sm">
                      <span className="font-semibold">{lead.leadNumber}</span>
                      {lead.name ? ` · ${lead.name}` : ''}
                    </span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      onClick={() => {
                        setLead(null);
                        setCaseFolderId(null);
                        setCaseArea(null);
                      }}
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <>
                    <label className="input input-bordered flex items-center gap-2">
                      <MagnifyingGlassIcon className="h-5 w-5 text-base-content/40" />
                      <input
                        type="search"
                        className="grow"
                        placeholder="Search by lead number, name, email or phone"
                        value={leadTerm}
                        onChange={(e) => setLeadTerm(e.target.value)}
                      />
                      {leadSearching && <span className="loading loading-spinner loading-xs" />}
                    </label>
                    {leadResults.length > 0 && (
                      <ul className="mt-2 max-h-56 divide-y divide-base-200 overflow-y-auto rounded-xl border border-base-300">
                        {leadResults.map((option) => (
                          <li key={option.leadNumber}>
                            <button
                              type="button"
                              className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-base-200"
                              onClick={() => {
                                setLead(option);
                                setLeadResults([]);
                                setLeadTerm('');
                                setCaseArea(null);
                              }}
                            >
                              <span className="font-semibold">{option.leadNumber}</span>
                              <span className="truncate text-base-content/70">{option.name}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>
              )}

              {lead && (
                <>
                  {showTabPicker && (
                  <div>
                    <h3 className="mb-2 text-sm font-semibold text-base-content/70">Which tab</h3>
                    <select
                      className="select select-bordered w-full"
                      value={classificationId}
                      onChange={(e) => {
                        setClassificationId(e.target.value);
                        setCaseFolderId(null);
                        setCaseArea(null);
                      }}
                    >
                      {classifications.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  )}

                  <div>
                    <h3 className="mb-2 text-sm font-semibold text-base-content/70">
                      {mode === 'new-folder' ? 'Inside' : 'Which folder'}
                    </h3>
                    <select
                      className="select select-bordered w-full"
                      value={caseFolderId ?? ''}
                      onChange={(e) => setCaseFolderId(e.target.value || null)}
                    >
                      <option value="">
                        {mode === 'new-folder' ? 'Top level' : 'All files (no folder)'}
                      </option>
                      {orderedCaseFolders.map(({ folder, depth }) => (
                        <option key={folder.id} value={folder.id}>
                          {`${'— '.repeat(depth)}${folder.title}`}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}
            </>
          )}

          {section === 'staff_meeting' && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-base-content/70">Which meeting</h3>
              <label className="input input-bordered flex items-center gap-2">
                <MagnifyingGlassIcon className="h-5 w-5 text-base-content/40" />
                <input
                  type="search"
                  className="grow"
                  placeholder="Search meetings by subject"
                  value={meetingTerm}
                  onChange={(e) => setMeetingTerm(e.target.value)}
                />
              </label>
              <ul className="mt-2 max-h-56 divide-y divide-base-200 overflow-y-auto rounded-xl border border-base-300">
                {meetings.map((option) => (
                  <li key={option.id}>
                    <button
                      type="button"
                      className={`flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm hover:bg-base-200 ${
                        meeting?.id === option.id ? 'bg-primary/10 font-semibold' : ''
                      }`}
                      onClick={() => setMeeting(option)}
                    >
                      <span className="min-w-0 truncate">{option.label}</span>
                      {option.when && (
                        <span className="shrink-0 text-xs text-base-content/50">{option.when}</span>
                      )}
                    </button>
                  </li>
                ))}
                {meetings.length === 0 && (
                  <li className="px-4 py-3 text-sm text-base-content/50">No meetings found.</li>
                )}
              </ul>
            </div>
          )}

          {section === 'office' && showSpacePicker && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-base-content/70">Which space</h3>
              <select
                className="select select-bordered w-full"
                value={officeSpaceKey}
                onChange={(e) => setOfficeSpaceKey(e.target.value)}
              >
                {officeSpaces.map((space) => (
                  <option key={space.scopeKey} value={space.scopeKey}>
                    {space.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-base-content/50">
                Department spaces are open to that department's staff. Admins is for superusers.
              </p>
            </div>
          )}

          {section === 'office' && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-base-content/70">
                {mode === 'new-folder' ? 'Inside' : 'Which folder'}
              </h3>
              <select
                className="select select-bordered w-full"
                value={officeFolderId ?? ''}
                onChange={(e) => setOfficeFolderId(e.target.value || null)}
              >
                <option value="">
                  {mode === 'new-folder' ? 'Top level' : 'All files (no folder)'}
                </option>
                {orderedOfficeFolders.map(({ folder, depth }) => (
                  <option key={folder.id} value={folder.id}>
                    {`${'— '.repeat(depth)}${folder.title}`}
                  </option>
                ))}
              </select>
            </div>
          )}

          {section === 'personal' && (
            <>
              <p className="rounded-xl bg-base-200 px-4 py-3 text-sm text-base-content/70">
                {employeeId == null
                  ? 'Could not tell which employee you are, so this destination is unavailable.'
                  : mode === 'new-folder'
                    ? 'The folder is created in your own space.'
                    : 'Files go to your own space.'}
              </p>
              {employeeId != null && (
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-base-content/70">
                    {mode === 'new-folder' ? 'Inside' : 'Which folder'}
                  </h3>
                  <select
                    className="select select-bordered w-full"
                    value={personalFolderId ?? ''}
                    onChange={(e) => setPersonalFolderId(e.target.value || null)}
                  >
                    <option value="">
                      {mode === 'new-folder' ? 'Top level' : 'All files (no folder)'}
                    </option>
                    {orderedPersonalFolders.map(({ folder, depth }) => (
                      <option key={folder.id} value={folder.id}>
                        {`${'— '.repeat(depth)}${folder.title}`}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}

          {mode === 'new-folder' ? (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-base-content/70">Folder name</h3>
              <input
                type="text"
                className="input input-bordered w-full"
                placeholder="e.g. Passports"
                maxLength={MAX_DOCUMENT_FOLDER_TITLE}
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && ready && !busy) void createFolder();
                }}
              />
            </div>
          ) : blankKind ? (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-base-content/70">Document name</h3>
              <label className="input input-bordered flex items-center gap-2">
                <input
                  type="text"
                  className="grow"
                  placeholder={blankKind === 'word' ? 'e.g. Power of attorney' : 'e.g. Costs'}
                  value={documentName}
                  autoFocus
                  onChange={(e) => setDocumentName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && ready && !busy) void createBlankDocument();
                  }}
                />
                <span className="shrink-0 text-sm text-base-content/40">
                  .{blankOfficeSpec(blankKind).extension}
                </span>
              </label>
              <p className="mt-2 text-xs text-base-content/50">
                An empty document is filed here and opens in {blankOfficeSpec(blankKind).appName}.
              </p>
            </div>
          ) : transferMode ? (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-base-content/70">
                {transferRows.length === 1 ? 'This file' : `These ${transferRows.length} files`}
              </h3>
              <ul className="divide-y divide-base-200 rounded-xl border border-base-300">
                {transferRows.map((row) => (
                  <li key={`${row.source}-${row.row_id}`} className="flex items-center gap-3 px-4 py-3">
                    <DocumentFileGlyph
                      fileType={row.mime_type || ''}
                      fileName={row.file_name}
                      className="h-6 w-6 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{row.file_name}</p>
                      <p className="truncate text-xs text-base-content/55">
                        {[row.scope_label, row.folder_path, formatDocumentSize(row.file_size)]
                          .filter((part) => part && part !== '—')
                          .join(' · ')}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
              {progress && (
                <div className="mt-3 rounded-xl bg-base-200 px-4 py-4">
                  <p className="text-sm font-medium">
                    {transferMode === 'move' ? 'Moving' : 'Copying'} {progress.done} of{' '}
                    {progress.total}…
                  </p>
                  <progress
                    className="progress progress-primary mt-2 w-full"
                    value={progress.done}
                    max={progress.total}
                  />
                </div>
              )}
              {alreadyThere ? (
                <p className="mt-2 text-xs text-warning">
                  {transferRows.length === 1 ? 'This file is' : 'These files are'} already there —
                  pick somewhere else.
                </p>
              ) : (
                <p className="mt-2 text-xs text-base-content/50">
                  {transferMode === 'move'
                    ? 'The file is filed in the new place first, and only then removed from this one.'
                    : 'The original stays where it is, and a copy is filed in the new place.'}
                </p>
              )}
            </div>
          ) : (
            <div>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                multiple={mode === 'files'}
                {...(mode === 'folder'
                  ? ({ webkitdirectory: '', directory: '' } as Record<string, string>)
                  : {})}
                onChange={(e) => {
                  handleFiles(e.target.files);
                  e.currentTarget.value = '';
                }}
              />
              {progress ? (
                <div className="rounded-xl bg-base-200 px-4 py-4">
                  <p className="text-sm font-medium">
                    Uploading {progress.done} of {progress.total}…
                  </p>
                  <progress
                    className="progress progress-primary mt-2 w-full"
                    value={progress.done}
                    max={progress.total}
                  />
                </div>
              ) : dropped ? (
                <div className="rounded-2xl bg-base-200 px-5 py-4">
                  <p className="text-sm font-medium text-base-content">
                    {dropped.entries.length} {dropped.entries.length === 1 ? 'file' : 'files'} ready
                    {dropped.folderPaths.length > 0
                      ? ` in ${dropped.folderPaths.length} ${
                          dropped.folderPaths.length === 1 ? 'folder' : 'folders'
                        }`
                      : ''}
                  </p>
                  <ul className="mt-2 max-h-28 space-y-0.5 overflow-y-auto text-xs text-base-content/60">
                    {dropped.entries.slice(0, 20).map((entry, index) => (
                      <li key={`${entry.segments.join('/')}/${entry.file.name}-${index}`} className="truncate">
                        {[...entry.segments, entry.file.name].join(' / ')}
                      </li>
                    ))}
                    {dropped.entries.length > 20 && (
                      <li>and {dropped.entries.length - 20} more…</li>
                    )}
                  </ul>
                  {dropped.droppedForLimit > 0 && (
                    <p className="mt-2 text-xs text-error">
                      {dropped.droppedForLimit} files were skipped — too many at once
                    </p>
                  )}
                  <button
                    type="button"
                    className="btn btn-primary btn-sm mt-3"
                    disabled={!ready || busy}
                    onClick={() => void runUpload(dropped.entries, dropped.folderPaths)}
                  >
                    <ArrowUpTrayIcon className="h-4 w-4" />
                    {ready
                      ? `Upload ${dropped.entries.length} ${
                          dropped.entries.length === 1 ? 'file' : 'files'
                        }`
                      : 'Pick a destination first'}
                  </button>
                </div>
              ) : (
                <div
                  className={`rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-colors ${
                    dragging ? 'border-primary bg-primary/10' : 'border-base-300 bg-base-200'
                  } ${ready ? '' : 'opacity-60'}`}
                  onDragOver={(event) => {
                    event.preventDefault();
                    if (ready && !busy) setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={handleDrop}
                >
                  {mode === 'folder' ? (
                    <FolderSolidIcon className="mx-auto h-10 w-10 text-slate-400" />
                  ) : (
                    <ArrowUpTrayIcon className="mx-auto h-10 w-10 text-base-content/40" />
                  )}
                  <p className="mt-3 text-sm font-medium text-base-content">
                    {mode === 'folder'
                      ? 'Drop a folder here'
                      : 'Drop files or folders here'}
                  </p>
                  <p className="mt-1 text-xs text-base-content/50">
                    {ready ? 'or' : 'Choose a destination first, then'}
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm mt-3"
                    disabled={!ready || busy}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Browse
                  </button>
                </div>
              )}
              {(mode === 'files' || mode === 'folder') && section === 'staff_meeting' && (
                <p className="mt-2 text-xs text-base-content/50">
                  A meeting keeps its files in a single list, so a dropped folder's files all land
                  in the meeting itself.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-base-300 px-5 py-4">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          {mode === 'new-folder' && (
            <button
              type="button"
              className="btn btn-primary gap-2 rounded-full px-7"
              disabled={!ready || busy}
              onClick={() => void createFolder()}
            >
              {busy ? <span className="loading loading-spinner loading-xs" /> : <FolderPlusIcon className="h-5 w-5" />}
              Create folder
            </button>
          )}
          {transferMode && (
            <button
              type="button"
              className="btn btn-primary gap-2 rounded-full px-7"
              disabled={!ready || busy}
              onClick={() => void runTransfer()}
            >
              {busy ? (
                <span className="loading loading-spinner loading-xs" />
              ) : transferMode === 'move' ? (
                <ArrowRightCircleIcon className="h-5 w-5" />
              ) : (
                <DocumentDuplicateIcon className="h-5 w-5" />
              )}
              {transferMode === 'move' ? 'Move here' : 'Copy here'}
            </button>
          )}
          {blankKind && (
            <button
              type="button"
              className="btn btn-primary gap-2 rounded-full px-7"
              disabled={!ready || busy}
              onClick={() => void createBlankDocument()}
            >
              {busy ? (
                <span className="loading loading-spinner loading-xs" />
              ) : (
                <DocumentPlusIcon className="h-5 w-5" />
              )}
              Create and open
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default DocumentsDriveCreateModal;
