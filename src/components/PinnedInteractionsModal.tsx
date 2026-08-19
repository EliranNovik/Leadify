import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookmarkIcon, EnvelopeIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { FaWhatsapp } from 'react-icons/fa';
import { formatFlaggedAt } from '../lib/userContentFlags';
import type { LeadPinnedInteractionRow } from '../lib/leadPinnedInteractions';
import { supabase } from '../lib/supabase';
import { resolveEmployeePhotoUrl } from '../lib/employeePhotoUrl';

type Props = {
  open: boolean;
  onClose: () => void;
  loading?: boolean;
  pins: LeadPinnedInteractionRow[];
  onView: (pin: LeadPinnedInteractionRow) => void;
  onUnpin: (pin: LeadPinnedInteractionRow) => void;
};

function pinOccurredLabel(pin: LeadPinnedInteractionRow): string {
  if (!pin.occurred_at) return '';
  try {
    return new Date(pin.occurred_at).toLocaleString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase();
}

function SavedByAvatar({ name, photoUrl }: { name: string; photoUrl: string | null }) {
  const [broken, setBroken] = useState(false);
  if (photoUrl && !broken) {
    return (
      <img
        src={photoUrl}
        alt=""
        className="h-5 w-5 shrink-0 rounded-full object-cover"
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-200 text-[9px] font-semibold text-gray-600">
      {initialsFromName(name)}
    </span>
  );
}

export default function PinnedInteractionsModal({
  open,
  onClose,
  loading = false,
  pins,
  onView,
  onUnpin,
}: Props) {
  const [photoByUserId, setPhotoByUserId] = useState<Record<string, string | null>>({});

  const pinnedByIds = useMemo(
    () => [...new Set(pins.map((pin) => pin.pinned_by).filter((id): id is string => Boolean(id)))],
    [pins],
  );

  useEffect(() => {
    if (!open || pinnedByIds.length === 0) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, tenants_employee!users_employee_id_fkey(photo_url, photo)')
        .in('id', pinnedByIds);
      if (cancelled || error) return;
      const next: Record<string, string | null> = {};
      for (const row of data || []) {
        const emp = Array.isArray(row.tenants_employee) ? row.tenants_employee[0] : row.tenants_employee;
        next[String(row.id)] = resolveEmployeePhotoUrl(emp?.photo_url, emp?.photo);
      }
      setPhotoByUserId((prev) => ({ ...prev, ...next }));
    })();
    return () => {
      cancelled = true;
    };
  }, [open, pinnedByIds.join('|')]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <div
        className="relative z-[1001] flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl border border-base-300 bg-base-100 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pinned-interactions-modal-title"
      >
        <div className="flex items-center justify-between gap-3 border-b border-base-300 px-4 py-3 sm:px-5 sm:py-4">
          <div className="flex min-w-0 items-center gap-2">
            <BookmarkIcon className="h-6 w-6 shrink-0 text-sky-600" />
            <div className="min-w-0">
              <h2 id="pinned-interactions-modal-title" className="truncate text-lg font-semibold">
                Saved interactions
              </h2>
              <p className="text-xs text-base-content/60">
                {pins.length === 0
                  ? 'Email and WhatsApp messages saved on this lead'
                  : `${pins.length} saved ${pins.length === 1 ? 'item' : 'items'} on this lead`}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-circle btn-ghost btn-sm"
            onClick={onClose}
            aria-label="Close"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex justify-center py-10">
              <span className="loading loading-spinner loading-md text-primary" />
            </div>
          ) : pins.length === 0 ? (
            <p className="text-sm text-base-content/70">
              No saved interactions yet. Use the menu on an email or WhatsApp message in
              Interactions to save it here.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {pins.map((pin) => {
                const occurred = pinOccurredLabel(pin);
                const subject = (pin.subject || '').trim();
                const body = (pin.preview || '').trim();
                const bodyUnderSubject =
                  body && subject && body.toLowerCase() === subject.toLowerCase() ? '' : body;
                return (
                  <li key={pin.id}>
                    <div
                      role="button"
                      tabIndex={0}
                      className="relative flex cursor-pointer flex-col rounded-xl border border-base-200 bg-base-200/30 p-3 text-left transition-colors hover:border-sky-200 hover:bg-sky-50/70 hover:shadow-sm dark:hover:border-sky-800/50 dark:hover:bg-sky-900/20"
                      onClick={() => onView(pin)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onView(pin);
                        }
                      }}
                    >
                    <div className="mb-4 flex items-center gap-2">
                      {pin.channel === 'whatsapp' ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
                          <FaWhatsapp className="h-5 w-5" />
                          WhatsApp
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-sky-800">
                          <EnvelopeIcon className="h-5 w-5" />
                          Email
                        </span>
                      )}
                      <div className="ml-auto flex min-w-0 shrink-0 items-center gap-1.5">
                        {pin.direction === 'in' || pin.direction === 'out' ? (
                          <span className="inline-flex max-w-[16rem] items-center rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-500">
                            <span className="truncate">
                              {pin.direction === 'in' ? 'Received from' : 'Sent by'}
                              {pin.party_name ? ` ${pin.party_name}` : ''}
                              {occurred ? ` · ${occurred}` : ''}
                            </span>
                          </span>
                        ) : occurred ? (
                          <span className="inline-flex whitespace-nowrap rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-500">
                            {occurred}
                          </span>
                        ) : null}
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs btn-circle text-base-content/40 hover:bg-red-50 hover:text-red-600"
                          onClick={(event) => {
                            event.stopPropagation();
                            onUnpin(pin);
                          }}
                          title="Remove save"
                          aria-label="Remove save"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    {subject ? (
                      <p className="line-clamp-1 break-words text-sm font-semibold text-base-content">
                        {subject}
                      </p>
                    ) : null}
                    {bodyUnderSubject ? (
                      <p className="mt-1 line-clamp-2 break-words text-sm leading-5 text-base-content/80">
                        {bodyUnderSubject}
                      </p>
                    ) : !subject ? (
                      <p className="mt-4 text-sm text-base-content/50">—</p>
                    ) : null}
                    <div className="mt-4 flex flex-row flex-wrap items-center justify-start gap-x-2 border-t border-base-300/50 pt-3 text-xs text-gray-400">
                      <span className="inline-flex min-w-0 items-center gap-1.5">
                        <SavedByAvatar
                          name={pin.pinned_by_name || 'Team'}
                          photoUrl={pin.pinned_by ? photoByUserId[pin.pinned_by] ?? null : null}
                        />
                        <span>
                          <span className="font-medium">Saved by</span>{' '}
                          {pin.pinned_by_name || 'Team'}
                        </span>
                      </span>
                      <span className="text-gray-300" aria-hidden>
                        ·
                      </span>
                      <span>
                        <span className="font-medium">At</span> {formatFlaggedAt(pin.pinned_at)}
                      </span>
                    </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
