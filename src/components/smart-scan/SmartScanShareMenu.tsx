import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMsal } from '@azure/msal-react';
import { InteractionRequiredAuthError } from '@azure/msal-browser';
import {
  ArrowLeftIcon,
  EnvelopeIcon,
  MagnifyingGlassIcon,
  ShareIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { loginRequest } from '../../msalConfig';
import { useAuthContext } from '../../contexts/AuthContext';
import {
  createDocumentShare,
  fetchShareTargets,
  resolveDocumentShareUrl,
  type DocumentShareLocator,
  type ShareTargetEmployee,
} from '../../lib/documentShares';
import { resolveAuthEmployeeId } from '../../lib/leadShares';
import { createOutlookDraftWithAttachment } from '../../lib/outlookDraftShare';
import { EMAIL_ATTACHMENTS_STORAGE_BUCKET } from '../../lib/leadEmailAttachments';
import { fullScanPreviewUrl } from '../../lib/smartScan/scanCenterInbox';
import { buildScanShareMessage, scanDocumentLabel, scanShareFilename } from '../../lib/smartScan/smartScanShareMessage';
import type { SmartScanItem } from '../../lib/smartScan/smartScanTypes';

type Props = {
  item: SmartScanItem;
  disabled?: boolean;
};

type Panel = 'menu' | 'employee';

/**
 * Where this scan's bytes live, in the form the share row stores and the resolver understands.
 *
 * Without a stored file of its own — a split part, or an attachment not yet copied to storage — the
 * parent scan is the only thing that can serve bytes, which is why its id wins over the item's.
 */
function locatorFor(item: SmartScanItem): DocumentShareLocator {
  return {
    storageBucket: item.storagePath ? EMAIL_ATTACHMENTS_STORAGE_BUCKET : null,
    storagePath: item.storagePath ?? null,
    scanDocumentId: item.parentDocumentId ?? item.scanDocumentId ?? null,
  };
}

async function fetchDocumentBytes(item: SmartScanItem): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const url = (await resolveDocumentShareUrl(locatorFor(item))) || fullScanPreviewUrl(item);
  if (!url) throw new Error('This document has no file yet');
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error('Could not download the document');
  const blob = await response.blob();
  return {
    bytes: await blob.arrayBuffer(),
    contentType: blob.type || item.contentType || 'application/pdf',
  };
}

export function SmartScanShareMenu({ item, disabled }: Props) {
  const { instance } = useMsal();
  const { user } = useAuthContext();
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>('menu');
  const [busy, setBusy] = useState(false);
  const [employees, setEmployees] = useState<ShareTargetEmployee[] | null>(null);
  const [search, setSearch] = useState('');
  const [myEmployeeId, setMyEmployeeId] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (wrapRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setPanel('menu');
      setSearch('');
    }
  }, [open]);

  // The employee list is only worth loading once someone actually opens the picker.
  useEffect(() => {
    if (panel !== 'employee' || employees !== null) return;
    let cancelled = false;
    void (async () => {
      const mine = myEmployeeId ?? (await resolveAuthEmployeeId(user?.id));
      if (cancelled) return;
      setMyEmployeeId(mine);
      const rows = await fetchShareTargets(mine);
      if (!cancelled) setEmployees(rows);
    })();
    return () => {
      cancelled = true;
    };
  }, [panel, employees, myEmployeeId, user?.id]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const rows = employees ?? [];
    return term ? rows.filter((emp) => emp.name.toLowerCase().includes(term)) : rows;
  }, [employees, search]);

  const shareByEmail = async () => {
    if (busy) return;
    setBusy(true);
    const toastId = toast.loading('Preparing the Outlook draft…');
    try {
      const accounts = instance.getAllAccounts();
      if (!accounts.length) throw new Error('No Microsoft account is signed in');
      const account = accounts[0];

      let token;
      try {
        token = await instance.acquireTokenSilent({ ...loginRequest, account });
      } catch (error) {
        if (!(error instanceof InteractionRequiredAuthError)) throw error;
        token = await instance.acquireTokenPopup({ ...loginRequest, account });
      }

      const file = await fetchDocumentBytes(item);
      const message = buildScanShareMessage(item, account.name || undefined);
      const draft = await createOutlookDraftWithAttachment({
        accessToken: token.accessToken,
        subject: message.subject,
        bodyHtml: message.bodyHtml,
        file: {
          name: scanShareFilename(item),
          contentType: file.contentType,
          bytes: file.bytes,
        },
      });

      toast.dismiss(toastId);
      setOpen(false);
      if (draft.webLink) {
        window.open(draft.webLink, '_blank', 'noopener,noreferrer');
        toast.success('Draft opened in Outlook with the document attached');
      } else {
        // The attachment is safely on the draft either way, so point at Drafts rather than fail.
        toast.success('Draft saved to your Outlook Drafts with the document attached');
      }
    } catch (error) {
      toast.dismiss(toastId);
      toast.error(error instanceof Error ? error.message : 'Could not create the Outlook draft');
    } finally {
      setBusy(false);
    }
  };

  const shareWithEmployee = async (employee: ShareTargetEmployee) => {
    if (busy) return;
    setBusy(true);
    try {
      const mine = myEmployeeId ?? (await resolveAuthEmployeeId(user?.id));
      setMyEmployeeId(mine);
      if (!mine) {
        toast.error('Could not identify your employee profile');
        return;
      }

      const result = await createDocumentShare({
        documentName: scanShareFilename(item),
        documentType: scanDocumentLabel(item),
        contentType: item.contentType ?? null,
        ...locatorFor(item),
        leadNumber: item.lead?.leadNumber ?? null,
        leadName: item.lead?.name ?? null,
        sharedByEmployeeId: mine,
        sharedWithEmployeeId: employee.id,
      });

      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setOpen(false);
      toast.success(`Shared with ${employee.name}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not share the document');
    } finally {
      setBusy(false);
    }
  };

  const rowClass =
    'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50';

  const MENU_WIDTH = 288;
  const anchor = open ? buttonRef.current?.getBoundingClientRect() : undefined;

  // Portalled like the lead search beside it: the drawer clips and stacks over anything in flow.
  const menu =
    open && anchor && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={menuRef}
            role="menu"
            className="z-[230] rounded-2xl border border-gray-200 bg-white p-1.5 shadow-xl"
            style={{
              position: 'fixed',
              top: anchor.bottom + 6,
              left: Math.max(8, Math.min(anchor.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8)),
              width: MENU_WIDTH,
            }}
          >
            {panel === 'menu' ? (
              <>
                <button
                  type="button"
                  role="menuitem"
                  className={rowClass}
                  disabled={busy}
                  onClick={() => void shareByEmail()}
                >
                  <EnvelopeIcon className="h-5 w-5 shrink-0 text-gray-400" />
                  <span className="min-w-0">
                    <span className="block font-medium text-gray-900">Send via Outlook email</span>
                    <span className="block text-xs text-gray-500">Opens a draft with the file attached</span>
                  </span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={rowClass}
                  disabled={busy}
                  onClick={() => setPanel('employee')}
                >
                  <UserGroupIcon className="h-5 w-5 shrink-0 text-gray-400" />
                  <span className="min-w-0">
                    <span className="block font-medium text-gray-900">Share with employee</span>
                    <span className="block text-xs text-gray-500">Sends it to their notification bell</span>
                  </span>
                </button>
              </>
            ) : (
              <>
                <div className="flex items-center gap-1 px-1 pb-1.5 pt-0.5">
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs btn-circle"
                    aria-label="Back"
                    onClick={() => setPanel('menu')}
                  >
                    <ArrowLeftIcon className="h-4 w-4" />
                  </button>
                  <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Share with</span>
                </div>
                <label className="relative mb-1.5 block">
                  <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    autoFocus
                    className="h-9 w-full rounded-xl border border-gray-200 bg-white pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-gray-100"
                    placeholder="Search employees"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>
                <div className="max-h-64 overflow-y-auto">
                  {employees === null ? (
                    <p className="px-2.5 py-3 text-sm text-gray-500">Loading employees…</p>
                  ) : filtered.length === 0 ? (
                    <p className="px-2.5 py-3 text-sm text-gray-500">No matching employees</p>
                  ) : (
                    filtered.map((employee) => (
                      <button
                        key={employee.id}
                        type="button"
                        role="menuitem"
                        className={rowClass}
                        disabled={busy}
                        onClick={() => void shareWithEmployee(employee)}
                      >
                        {employee.photoUrl ? (
                          <img src={employee.photoUrl} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
                        ) : (
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-500">
                            {employee.name.slice(0, 1).toUpperCase()}
                          </span>
                        )}
                        <span className="min-w-0 truncate">{employee.name}</span>
                      </button>
                    ))
                  )}
                </div>
              </>
            )}
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="shrink-0" ref={wrapRef} data-sheet-no-drag>
      <button
        ref={buttonRef}
        type="button"
        className="btn btn-ghost btn-sm btn-circle"
        disabled={disabled}
        title="Share document"
        aria-label="Share document"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <ShareIcon className="h-5 w-5" />
      </button>
      {menu}
    </div>
  );
}
