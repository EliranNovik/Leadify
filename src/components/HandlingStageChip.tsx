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
  type HandlingRole,
  type HandlingStage,
} from '../lib/handlingRoles';

function personName(value: string | null | undefined): string {
  const text = String(value || '').trim();
  if (!text || text === '---' || text === '--' || /^not[_\s]?assigned$/i.test(text)) return 'Not assigned';
  return text;
}

/**
 * Handling stage beside the active worker. The stage follows the active role.
 * The question mark opens the focus of that role and who speaks to the client in the stage.
 */
const HandlingStageChip: React.FC<{
  lead: any;
  employeeName: (id: number | null) => string;
}> = ({ lead, employeeName }) => {
  const [open, setOpen] = useState(false);
  const [stageCopy, setStageCopy] = useState<Pick<HandlingStage, 'name' | 'shortLabel' | 'description'> | null>(null);
  const [roleCopy, setRoleCopy] = useState<Pick<HandlingRole, 'title' | 'focus' | 'responsibilities'> | null>(null);
  const [commCopy, setCommCopy] = useState<Pick<HandlingRole, 'title'> | null>(null);
  const activeType = readHandlingActiveType(lead?.active_handler_type);
  const role = handlingRoleByType(activeType);
  const stage = handlingStageForActiveType(activeType);
  const commRole = stage ? communicationRoleForStage(stage.id) : null;

  useEffect(() => {
    if (!open || !role || !stage) return;
    let cancelled = false;
    setStageCopy(null);
    setRoleCopy(null);
    setCommCopy(null);
    const load = async () => {
      const typeIds = commRole ? [role.activeType, commRole.activeType] : [role.activeType];
      const [stageResult, roleResult] = await Promise.all([
        supabase
          .from('handling_stages')
          .select('name, short_label, description')
          .eq('id', stage.id)
          .maybeSingle(),
        supabase
          .from('handling_roles')
          .select('active_type, title, focus, responsibilities')
          .in('active_type', typeIds),
      ]);
      if (cancelled || stageResult.error || roleResult.error) return;
      const stageRow = stageResult.data as { name?: string; short_label?: string; description?: string } | null;
      if (stageRow?.name && stageRow.short_label && stageRow.description) {
        setStageCopy({
          name: stageRow.name,
          shortLabel: stageRow.short_label,
          description: stageRow.description,
        });
      }
      const rows = (roleResult.data || []) as Array<{
        active_type: number;
        title?: string;
        focus?: string;
        responsibilities?: string;
      }>;
      const activeRow = rows.find((row) => Number(row.active_type) === role.activeType);
      if (activeRow?.title && activeRow.focus && activeRow.responsibilities) {
        setRoleCopy({
          title: activeRow.title,
          focus: activeRow.focus,
          responsibilities: activeRow.responsibilities,
        });
      }
      if (commRole) {
        const commRow = rows.find((row) => Number(row.active_type) === commRole.activeType);
        if (commRow?.title) setCommCopy({ title: commRow.title });
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [open, role, stage, commRole]);

  if (!role || !stage) return null;

  const stageName = stageCopy?.name || stage.name;
  const stageShort = stageCopy?.shortLabel || stage.shortLabel;
  const stageDescription = stageCopy?.description || stage.description;
  const roleTitle = roleCopy?.title || role.title;
  const roleFocus = roleCopy?.focus || role.focus;
  const roleResponsibilities = roleCopy?.responsibilities || role.responsibilities;
  const commTitle = commCopy?.title || commRole?.title;
  const commEmployeeId = commRole ? employeeIdOnLead(lead, commRole.id) : null;
  const commName = personName(commEmployeeId ? employeeName(commEmployeeId) : null);
  const activeEmployeeId = employeeIdOnLead(lead, role.id);
  const activeName = personName(activeEmployeeId ? employeeName(activeEmployeeId) : null);

  return (
    <>
      <div className="flex shrink-0 items-center gap-0.5 rounded-xl border border-emerald-200/80 bg-emerald-50/80 py-1 pl-2.5 pr-1 dark:border-emerald-400/25 dark:bg-emerald-500/10">
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
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-base-content/45">
                      Handling stage
                    </p>
                    <h2 id="handling-stage-info-title" className="text-lg font-semibold text-base-content">
                      {stageName}
                    </h2>
                    <p className="mt-0.5 text-sm text-base-content/55">{stageShort}</p>
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

                <div className="mt-4 rounded-xl bg-base-200/70 p-3.5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-base-content/45">
                    Active role
                  </p>
                  <p className="mt-1 text-sm font-semibold text-base-content">{roleTitle}</p>
                  <p className="text-sm text-base-content/70">{activeName}</p>
                  <p className="mt-2 text-sm font-medium text-base-content">{roleFocus}</p>
                  <p className="mt-1 text-sm leading-relaxed text-base-content/80">{roleResponsibilities}</p>
                </div>

                <div className="mt-3 rounded-xl border border-emerald-200/80 bg-emerald-50/70 p-3.5 dark:border-emerald-400/20 dark:bg-emerald-500/10">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-800/70 dark:text-emerald-200/70">
                    Client communication
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-base-content/80">
                    {commTitle
                      ? `${commTitle} is responsible for client communication during ${stageName}.`
                      : 'No role is marked as responsible for client communication in this stage.'}
                  </p>
                  {commTitle ? (
                    <p className="mt-2 text-sm font-semibold text-base-content">
                      {commTitle}
                      <span className="font-medium text-base-content/70"> · {commName}</span>
                    </p>
                  ) : null}
                  <p className="mt-1 text-xs text-base-content/55">Active stage: {stageShort}</p>
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
