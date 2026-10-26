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
  XMarkIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { loginRequest } from '../../msalConfig';
import { useAuthContext } from '../../contexts/AuthContext';
import {
  createDocumentShare,
  fetchShareTargets,
  resolveDocumentShareUrl,
  type ShareTargetEmployee,
} from '../../lib/documentShares';
import { resolveAuthEmployeeId } from '../../lib/leadShares';
import { createOutlookDraftWithAttachment } from '../../lib/outlookDraftShare';
import type { DocumentShareTarget } from '../../lib/documentShareTargets';
import { UploaderAttribution } from '../UploaderAttribution';

/**
 * The two ways to pass a document on: an Outlook draft with the file attached, or a colleague's
 * notification bell. Shared by everything that shares a document, so the Scan Center and the
 * drive behave identically.
 */

type Panel = 'menu' | 'employee';

async function fetchDocumentBytes(
  target: DocumentShareTarget,
): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const url = (await resolveDocumentShareUrl(target.locator)) || target.fallbackUrl || null;
  if (!url) throw new Error('This document has no file yet');
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error('Could not download the document');
  const blob = await response.blob();
  return {
    bytes: await blob.arrayBuffer(),
    contentType: blob.type || target.contentType || 'application/pdf',
  };
}

const rowClass =
  'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50';

/**
 * The options themselves, without any opinion about what they sit inside — an anchored menu for a
 * button on a toolbar, a dialog for a button that lives in another dropdown.
 */
export function DocumentSharePanel({
  target,
  onClose,
}: {
  target: DocumentShareTarget;
  onClose: () => void;
}) {
  const { instance } = useMsal();
  const { user } = useAuthContext();
  const [panel, setPanel] = useState<Panel>('menu');
  const [busy, setBusy] = useState(false);
  const [employees, setEmployees] = useState<ShareTargetEmployee[] | null>(null);
  const [search, setSearch] = useState('');
  const [myEmployeeId, setMyEmployeeId] = useState<number | null>(null);

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

      const file = await fetchDocumentBytes(target);
      const message = target.message(account.name || undefined);
      const draft = await createOutlookDraftWithAttachment({
        accessToken: token.accessToken,
        subject: message.subject,
        bodyHtml: message.bodyHtml,
        file: {
          name: target.fileName,
          contentType: file.contentType,
          bytes: file.bytes,
        },
      });

      toast.dismiss(toastId);
      onClose();
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
        documentName: target.fileName,
        documentType: target.documentType,
        contentType: target.contentType,
        ...target.locator,
        leadNumber: target.leadNumber,
        leadName: target.leadName,
        sharedByEmployeeId: mine,
        sharedWithEmployeeId: employee.id,
      });

      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      onClose();
      toast.success(`Shared with ${employee.name}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not share the document');
    } finally {
      setBusy(false);
    }
  };

  if (panel === 'menu') {
    return (
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
    );
  }

  return (
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
          className="h-9 w-full rounded-xl border border-gray-200 bg-white pl-8 pr-3 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-gray-100"
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
              {/* The same attribution the document tables use, so someone with no photo is a
                  coloured bead of their initials here too rather than a grey letter. */}
              <UploaderAttribution
                name={employee.name}
                photoUrl={employee.photoUrl}
                imageClassName="h-7 w-7 text-[10px]"
                nameClassName="font-medium text-gray-800"
              />
            </button>
          ))
        )}
      </div>
    </>
  );
}

/** A share button with the options hanging under it, for a toolbar or a row of its own. */
export function DocumentShareMenu({
  target,
  disabled,
  buttonClassName = 'btn btn-ghost btn-sm btn-circle',
}: {
  target: DocumentShareTarget;
  disabled?: boolean;
  buttonClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const node = event.target as Node;
      if (wrapRef.current?.contains(node) || menuRef.current?.contains(node)) return;
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

  const MENU_WIDTH = 288;
  const anchor = open ? buttonRef.current?.getBoundingClientRect() : undefined;

  // Portalled like the lead search beside it: a drawer clips and stacks over anything in flow.
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
            {/* Unmounted with the menu, so it always opens back on the first panel. */}
            <DocumentSharePanel target={target} onClose={() => setOpen(false)} />
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="shrink-0" ref={wrapRef} data-sheet-no-drag>
      <button
        ref={buttonRef}
        type="button"
        className={buttonClassName}
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

/**
 * The same options as a small dialog, for a Share that is itself a row in another dropdown: that
 * menu closes as it is picked, so there is no button left to hang a menu under.
 */
export function DocumentShareDialog({
  target,
  onClose,
}: {
  target: DocumentShareTarget;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[12000] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-label="Share document"
        className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-2 shadow-2xl"
      >
        <div className="flex items-center justify-between gap-2 px-1.5 pb-1 pt-0.5">
          <span className="min-w-0 truncate text-sm font-semibold text-gray-900">
            Share {target.fileName}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-xs btn-circle text-gray-500"
            aria-label="Close"
            onClick={onClose}
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>
        <DocumentSharePanel target={target} onClose={onClose} />
      </div>
    </div>,
    document.body,
  );
}
