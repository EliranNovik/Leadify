import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowDownTrayIcon,
  ArrowLeftIcon,
  MagnifyingGlassIcon,
  ShareIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';

import { supabase } from '../../lib/supabase';
import { useAuthContext } from '../../contexts/AuthContext';
import {
  createDocumentShare,
  fetchShareTargets,
  type ShareTargetEmployee,
} from '../../lib/documentShares';
import { resolveAuthEmployeeId } from '../../lib/leadShares';
import { EMAIL_ATTACHMENTS_STORAGE_BUCKET } from '../../lib/leadEmailAttachments';
import { caseSheetSharePath } from '../../lib/caseSheetApi';

const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

type Props = {
  sheetId: string;
  filename: string;
  leadNumber: string | null;
  leadName: string | null;
  disabled?: boolean;
  /** The sheet as .xlsx bytes, built on demand so nothing is generated until it is shared. */
  buildBytes: () => ArrayBuffer | null;
  /** The external route: straight to the handler's own machine. */
  onDownload: () => void;
};

type Panel = 'menu' | 'employee';

/**
 * Share for a case sheet: internally to a colleague's notification bell, or externally as a file.
 *
 * Both routes send the same snapshot. A sheet is live and co-edited, so "share" has to mean the sheet
 * as it is right now — a link to a document that changes under the recipient would not be the thing
 * that was shared.
 *
 * Built to match the Smart Scan share menu, down to the portalled panel: the tab it sits in scrolls
 * and clips, so a menu in normal flow would be cut off at the edge of the sheet.
 */
export function CaseSheetShareMenu({
  sheetId,
  filename,
  leadNumber,
  leadName,
  disabled,
  buildBytes,
  onDownload,
}: Props) {
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
    return term ? rows.filter((employee) => employee.name.toLowerCase().includes(term)) : rows;
  }, [employees, search]);

  const shareWithEmployee = async (employee: ShareTargetEmployee) => {
    if (busy) return;
    setBusy(true);
    const toastId = toast.loading(`Sharing with ${employee.name}…`);

    try {
      const mine = myEmployeeId ?? (await resolveAuthEmployeeId(user?.id));
      setMyEmployeeId(mine);
      if (!mine) {
        toast.error('Could not identify your employee profile', { id: toastId });
        return;
      }

      const bytes = buildBytes();
      if (!bytes) throw new Error('There is nothing in this sheet to share yet');

      /*
       * The share row has to resolve back to bytes, so the snapshot is uploaded first and only then
       * announced. Doing it the other way round would leave the recipient a notification pointing at
       * a file that does not exist if the upload failed.
       */
      const path = caseSheetSharePath(sheetId, filename);
      const { error: uploadError } = await supabase.storage
        .from(EMAIL_ATTACHMENTS_STORAGE_BUCKET)
        .upload(path, new Blob([bytes], { type: XLSX_CONTENT_TYPE }), {
          contentType: XLSX_CONTENT_TYPE,
          upsert: false,
        });
      if (uploadError) throw uploadError;

      const result = await createDocumentShare({
        documentName: filename,
        documentType: 'Case handling sheet',
        contentType: XLSX_CONTENT_TYPE,
        storageBucket: EMAIL_ATTACHMENTS_STORAGE_BUCKET,
        storagePath: path,
        scanDocumentId: null,
        leadNumber,
        leadName,
        sharedByEmployeeId: mine,
        sharedWithEmployeeId: employee.id,
      });

      if (!result.ok) {
        toast.error(result.message, { id: toastId });
        return;
      }

      setOpen(false);
      toast.success(`Shared with ${employee.name}`, { id: toastId });
    } catch (error) {
      console.error('[CaseHandling] internal share failed', error);
      toast.error(error instanceof Error ? error.message : 'Could not share the sheet', {
        id: toastId,
      });
    } finally {
      setBusy(false);
    }
  };

  const rowClass =
    'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50';

  const MENU_WIDTH = 288;
  const anchor = open ? buttonRef.current?.getBoundingClientRect() : undefined;

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
              left: Math.max(
                8,
                Math.min(anchor.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8),
              ),
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
                  onClick={() => setPanel('employee')}
                >
                  <UserGroupIcon className="h-5 w-5 shrink-0 text-gray-400" />
                  <span className="min-w-0">
                    <span className="block font-medium text-gray-900">Internal</span>
                    <span className="block text-xs text-gray-500">
                      Sends it to a colleague's notification bell
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={rowClass}
                  disabled={busy}
                  onClick={() => {
                    setOpen(false);
                    onDownload();
                  }}
                >
                  <ArrowDownTrayIcon className="h-5 w-5 shrink-0 text-gray-400" />
                  <span className="min-w-0">
                    <span className="block font-medium text-gray-900">External</span>
                    <span className="block text-xs text-gray-500">
                      Downloads the sheet as an Excel file
                    </span>
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
                  <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Share with
                  </span>
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
                          <img
                            src={employee.photoUrl}
                            alt=""
                            className="h-7 w-7 shrink-0 rounded-full object-cover"
                          />
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
    <div className="shrink-0" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className="btn btn-sm btn-outline gap-1"
        disabled={disabled}
        title="Share this sheet"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <ShareIcon className="w-4 h-4" />
        Share
      </button>
      {menu}
    </div>
  );
}

export default CaseSheetShareMenu;
