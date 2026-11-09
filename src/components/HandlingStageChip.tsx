import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { QuestionMarkCircleIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import {
  communicationRoleForStage,
  employeeIdOnLead,
  handlingRoleByType,
  handlingStageForActiveType,
  readHandlingActiveType,
  rolesForHandlingStage,
  type HandlingStage,
} from '../lib/handlingRoles';
import { resolveEmployeePhotoUrl, toEmployeeAvatarSrc } from '../lib/employeePhotoUrl';

function personName(value: string | null | undefined): string {
  const text = String(value || '').trim();
  if (!text || text === '---' || text === '--' || /^not[_\s]?assigned$/i.test(text)) return '--';
  return text;
}

/**
 * Handling stage beside the active worker. The stage follows the active role.
 * The question mark opens the focus of that role and who speaks to the client in the stage.
 */
const HandlingStageChip: React.FC<{
  lead: any;
  employeeName: (id: number | null) => string;
  employeePhoto?: (id: number | null) => string | null;
}> = ({ lead, employeeName, employeePhoto }) => {
  const [open, setOpen] = useState(false);
  const [stageCopy, setStageCopy] = useState<Pick<HandlingStage, 'name' | 'shortLabel' | 'description'> | null>(null);
  const activeType = readHandlingActiveType(lead?.active_handler_type);
  const role = handlingRoleByType(activeType);
  const stage = handlingStageForActiveType(activeType, lead);
  const commRole = stage ? communicationRoleForStage(stage.id, lead) : null;
  const stageRoles = stage ? rolesForHandlingStage(stage.id, lead) : [];

  useEffect(() => {
    if (!open || !role || !stage) return;
    let cancelled = false;
    setStageCopy(null);
    const load = async () => {
      const stageResult = await supabase
        .from('handling_stages')
        .select('name, short_label, description')
        .eq('id', stage.id)
        .maybeSingle();
      if (cancelled || stageResult.error) return;
      const stageRow = stageResult.data as { name?: string; short_label?: string; description?: string } | null;
      if (stageRow?.name && stageRow.short_label && stageRow.description) {
        setStageCopy({
          name: stageRow.name,
          shortLabel: stageRow.short_label,
          description: stageRow.description,
        });
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [open, role, stage]);

  if (!role || !stage) return null;

  const stageName = stageCopy?.name || stage.name;
  const stageShort = stageCopy?.shortLabel || stage.shortLabel;
  const stageDescription = stageCopy?.description || stage.description;

  return (
    <>
      <div className="flex shrink-0 items-center gap-1.5 rounded-xl border border-emerald-200/80 bg-emerald-50/80 py-1 pl-1.5 pr-1 dark:border-emerald-400/25 dark:bg-emerald-500/10">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-100">
          {stage.id}
        </span>
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-800/60 dark:text-emerald-200/70">
            Stage
          </div>
          <div className="whitespace-nowrap text-xs font-semibold text-emerald-950 dark:text-emerald-50">
            {stageShort}
          </div>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-xs btn-circle text-emerald-800/70 hover:bg-emerald-100 dark:text-emerald-100 dark:hover:bg-emerald-500/20"
          aria-label="About this handling stage and role"
          title="About this stage and role"
          onClick={(event) => {
            event.stopPropagation();
            setOpen(true);
          }}
        >
          <QuestionMarkCircleIcon className="h-5 w-5" aria-hidden />
        </button>
      </div>
      {open
        ? createPortal(
            <div
              className="fixed inset-0 z-[400] flex items-center justify-center bg-black/40 p-4"
              onClick={() => setOpen(false)}
              role="presentation"
            >
              <div
                className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl dark:bg-base-100"
                role="dialog"
                aria-modal="true"
                aria-labelledby="handling-stage-info-title"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <h2 id="handling-stage-info-title" className="text-lg font-semibold text-black dark:text-base-content">
                      {stageName}
                    </h2>
                    <p className="mt-0.5 text-sm text-gray-400 dark:text-base-content/40">{stageShort}</p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm btn-circle"
                    aria-label="Close"
                    onClick={() => setOpen(false)}
                  >
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </div>

                <p className="text-sm leading-relaxed text-base-content/80">{stageDescription}</p>

                <div className="mt-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-base-content/45">
                    Responsible in this stage
                  </p>
                  <ul className="mt-2 space-y-2">
                    {stageRoles.map((stageRole) => {
                      const employeeId = employeeIdOnLead(lead, stageRole.id);
                      const name = personName(employeeId ? employeeName(employeeId) : null);
                      const photo = employeePhoto ? employeePhoto(employeeId) : null;
                      const photoSrc = toEmployeeAvatarSrc(resolveEmployeePhotoUrl(photo, null), 64);
                      const isContact = commRole?.id === stageRole.id;
                      const initials = name === '--'
                        ? ''
                        : name
                            .split(/\s+/)
                            .filter(Boolean)
                            .slice(0, 2)
                            .map((part) => part[0]?.toUpperCase() || '')
                            .join('');
                      return (
                        <li
                          key={stageRole.id}
                          className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${
                            isContact
                              ? 'border border-emerald-200/80 bg-emerald-50/80 dark:border-emerald-400/20 dark:bg-emerald-500/10'
                              : 'bg-base-200/70'
                          }`}
                        >
                          {photoSrc ? (
                            <img
                              src={photoSrc}
                              alt=""
                              className="h-10 w-10 shrink-0 rounded-full object-cover bg-gray-200"
                            />
                          ) : (
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-200 text-sm font-semibold text-gray-600">
                              {initials || '—'}
                            </span>
                          )}
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold text-base-content">
                              {stageRole.title}
                              {isContact ? (
                                <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                                  Client contact
                                </span>
                              ) : null}
                            </span>
                            <span className="block truncate text-sm text-base-content/70">{name}</span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
};

export default HandlingStageChip;
