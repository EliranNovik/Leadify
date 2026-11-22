import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckIcon } from '@heroicons/react/24/solid';
import { ClockIcon, DocumentTextIcon, FlagIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { HANDLING_STAGES, type HandlingStageId } from '../../../lib/handlingRoles';
import { EntityAvatar, PORTAL_TEAM_CARD_CLASS } from '../components/portalTheme';
import EmployeeBusinessCardModal from '../../../components/EmployeeBusinessCardModal';
import {
  fetchEmployeeProfileByName,
  type EmployeeProfile,
} from '../../../lib/fetchEmployeeProfile';
import type { PortalHandlingBoard, PortalHandlingPerson } from './portalHandlingBoard';

const STEP_ICON: Record<HandlingStageId, React.ComponentType<{ className?: string }>> = {
  1: DocumentTextIcon,
  2: ClockIcon,
  3: FlagIcon,
};

const STEP_COPY: Record<HandlingStageId, { title: string; body: string }> = {
  1: { title: 'stages.handling.preparingTitle', body: 'stages.handling.preparingBody' },
  2: { title: 'stages.handling.waitingTitle', body: 'stages.handling.waitingBody' },
  3: { title: 'stages.handling.finishingTitle', body: 'stages.handling.finishingBody' },
};

const ROLE_SHORT: Record<string, string> = {
  submission_manager: 'stages.handling.roleShort.submission',
  digital_case_coordinator: 'stages.handling.roleShort.digital',
  document_procurement_coordinator: 'stages.handling.roleShort.documents',
  certification_coordinator: 'stages.handling.roleShort.certification',
  authorities_coordinator: 'stages.handling.roleShort.authorities',
};

type StageDetailStep = { title: string; body: string; role?: string };
type StageDetail = { intro: string; steps: StageDetailStep[] };

function stageDetail(t: (key: string, options?: { returnObjects?: boolean }) => unknown, stageId: HandlingStageId): StageDetail {
  const value = t(`stages.handling.detail.${stageId}`, { returnObjects: true });
  if (!value || typeof value !== 'object' || !('steps' in value)) {
    return { intro: '', steps: [] };
  }
  return value as StageDetail;
}

function businessCardFallback(person: PortalHandlingPerson): EmployeeProfile {
  return {
    id: 0,
    display_name: person.name,
    official_name: person.lookupName || person.name,
    photo_url: person.photoUrl,
    chat_background_image_url: null,
    mobile: '',
    phone: '',
    phone_ext: '',
    email: null,
    department_name: 'General',
    bonuses_role: 'Employee',
    linkedin_url: null,
    min_hours: 8,
  };
}

const PortalHandlingJourney: React.FC<{ board: PortalHandlingBoard }> = ({ board }) => {
  const { t, i18n } = useTranslation();
  const [openStageId, setOpenStageId] = useState<HandlingStageId | null>(null);
  const [businessCardEmployee, setBusinessCardEmployee] = useState<EmployeeProfile | null>(null);
  const [businessCardOpen, setBusinessCardOpen] = useState(false);

  const openBusinessCard = async (person: PortalHandlingPerson) => {
    const profile =
      (await fetchEmployeeProfileByName(person.lookupName || person.name)) ??
      businessCardFallback(person);
    setBusinessCardEmployee(profile);
    setBusinessCardOpen(true);
  };
  const lineFill = board.activeStageId <= 1 ? '0%' : board.activeStageId === 2 ? '50%' : '100%';
  const team: Array<{ person: PortalHandlingPerson; lines: string[] }> = [];
  const addTeamLine = (person: PortalHandlingPerson, line: string) => {
    const key = person.name.trim().toLowerCase();
    const existing = team.find((member) => member.person.name.trim().toLowerCase() === key);
    if (!existing) {
      team.push({ person, lines: [line] });
      return;
    }
    if (!existing.lines.includes(line)) existing.lines.push(line);
  };
  if (board.contact) addTeamLine(board.contact, t('stages.handling.yourContact'));
  for (const person of board.others) {
    addTeamLine(person, t(ROLE_SHORT[person.roleId] ?? 'stages.handling.alsoWorking'));
  }
  const openDetail = openStageId ? stageDetail(t, openStageId) : null;
  const openTitle = openStageId ? t(STEP_COPY[openStageId].title) : '';

  useEffect(() => {
    if (!openStageId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenStageId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openStageId]);

  return (
    <section className="space-y-4">
      <div className={`${PORTAL_TEAM_CARD_CLASS} px-4 py-6 sm:px-8 sm:py-8`}>
        <div className="relative">
          <div
            className="pointer-events-none absolute top-[26px] hidden h-1 overflow-hidden rounded-full bg-[#e7e8ee] sm:block"
            style={{ insetInlineStart: '16.666%', insetInlineEnd: '16.666%' }}
            aria-hidden
          >
            <span className="block h-full rounded-full bg-blue-900" style={{ width: lineFill }} />
          </div>
          <ol className="relative grid grid-cols-1 gap-6 sm:grid-cols-3 sm:gap-8" aria-label={t('stages.title')}>
            {HANDLING_STAGES.map((stage) => {
              const state =
                stage.id < board.activeStageId ? 'done' : stage.id === board.activeStageId ? 'now' : 'later';
              const Icon = state === 'done' ? CheckIcon : STEP_ICON[stage.id];
              const copy = STEP_COPY[stage.id];
              return (
                <li
                  key={stage.id}
                  className="flex items-start gap-3.5 sm:flex-col sm:items-center sm:text-center"
                  aria-current={state === 'now' ? 'step' : undefined}
                >
                  <button
                    type="button"
                    className="relative z-10 flex h-14 w-14 shrink-0 items-center justify-center rounded-full transition-transform hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                    aria-label={t('stages.handling.openStageAria', { stageName: t(copy.title) })}
                    onClick={() => setOpenStageId(stage.id)}
                  >
                    <span
                      className={`flex items-center justify-center rounded-full ${
                        state === 'now'
                          ? 'h-14 w-14 bg-emerald-500 text-white shadow-[0_8px_20px_rgba(16,185,129,0.35)] ring-4 ring-emerald-500/20'
                          : state === 'done'
                            ? 'h-12 w-12 bg-emerald-500 text-white'
                            : 'h-12 w-12 bg-[#eef0f4] text-[#9aa0ad]'
                      }`}
                    >
                      <Icon className={state === 'now' ? 'h-7 w-7' : 'h-6 w-6'} aria-hidden />
                    </span>
                  </button>
                  <div className="min-w-0 sm:mt-1">
                    <p
                      className={`text-sm font-semibold leading-snug sm:text-base ${
                        state === 'now' ? 'text-emerald-600' : 'text-slate-400'
                      }`}
                    >
                      {t(copy.title)}
                    </p>
                    <p
                      className={`mt-1.5 text-sm leading-relaxed ${
                        state === 'now' ? 'text-[#4b4e5a]' : 'text-slate-300'
                      }`}
                    >
                      {t(copy.body)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
        {team.length > 0 ? (
          <div className="-mx-4 mt-6 divide-y divide-black/5 border-t border-black/5 px-4 sm:-mx-8 sm:px-8">
            {team.map(({ person, lines }) => (
              <div key={`${person.roleId}::${person.name}`} className="flex items-center gap-4 py-4">
              <button
                type="button"
                className="shrink-0 rounded-full transition-transform hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                title={t('dashboard.team.viewBusinessCardTitle', { name: person.name })}
                aria-label={t('dashboard.team.viewBusinessCardTitle', { name: person.name })}
                onClick={() => void openBusinessCard(person)}
              >
                <EntityAvatar
                  name={person.name}
                  imageUrl={person.photoUrl}
                  stableKey={`handling::${person.roleId}::${person.name}`}
                  className="h-14 w-14 text-base"
                />
              </button>
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold text-[#16161d]">{person.name}</p>
                  {lines.map((line) => (
                    <p key={line} className="mt-0.5 text-sm leading-snug text-[#4b4e5a]">
                      {line}
                    </p>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {businessCardEmployee ? (
        <EmployeeBusinessCardModal
          employee={businessCardEmployee}
          open={businessCardOpen}
          onClose={() => setBusinessCardOpen(false)}
        />
      ) : null}

      {openStageId && openDetail ? (
        <div className="modal modal-open z-[300]">
          <div
            className="modal-box max-w-lg"
            dir={i18n.language.toLowerCase().startsWith('he') ? 'rtl' : 'ltr'}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#747684]">
                  {t('stages.handling.detailEyebrow')}
                </p>
                <h3 className="mt-1 text-lg font-bold text-[#16161d]">{openTitle}</h3>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-square"
                onClick={() => setOpenStageId(null)}
                aria-label={t('common.close')}
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            {openDetail.intro ? (
              <p className="mt-4 text-sm leading-relaxed text-[#4b4e5a]">{openDetail.intro}</p>
            ) : null}
            <ol className="mt-5 space-y-4">
              {openDetail.steps.map((step, index) => {
                const people = step.role
                  ? board.assigned.filter((person) => person.roleId === step.role)
                  : [];
                return (
                  <li key={`${step.title}-${index}`} className="flex gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-sm font-semibold text-emerald-700">
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#16161d]">{step.title}</p>
                      <p className="mt-1 text-sm leading-relaxed text-[#4b4e5a]">{step.body}</p>
                      {people.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {people.map((person) => (
                            <span
                              key={`${person.roleId}-${person.name}`}
                              className="inline-flex items-center gap-2 rounded-full bg-[#f4f5f8] py-1 pe-3 ps-1"
                            >
                              <EntityAvatar
                                name={person.name}
                                imageUrl={person.photoUrl}
                                stableKey={`detail::${person.roleId}::${person.name}`}
                                className="h-6 w-6 text-[10px]"
                              />
                              <span className="text-xs font-medium text-[#16161d]">{person.name}</span>
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
            <div className="modal-action mt-4">
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpenStageId(null)}>
                {t('common.close')}
              </button>
            </div>
          </div>
          <button
            type="button"
            className="modal-backdrop"
            aria-label={t('common.close')}
            onClick={() => setOpenStageId(null)}
          />
        </div>
      ) : null}
    </section>
  );
};

export default PortalHandlingJourney;
