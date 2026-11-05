import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  BanknotesIcon,
  CalendarDaysIcon,
  VideoCameraIcon,
  BriefcaseIcon,
  DocumentArrowUpIcon,
  FlagIcon,
} from '@heroicons/react/24/outline';
import {
  type PortalContact,
  type PortalMeetingRow,
  type PortalPaymentRow,
  type PortalTeamContact,
} from '../../../lib/portalApi';
import {
  fetchEmployeeProfileByName,
  type EmployeeProfile,
} from '../../../lib/fetchEmployeeProfile';
import EmployeeBusinessCardModal from '../../../components/EmployeeBusinessCardModal';
import { buildPaymentPagePath } from '../../../lib/proformaPaymentLink';
import {
  EntityAvatar,
  PortalLoading,
  PortalStatCard,
  PORTAL_DASHBOARD_CONTAINER,
  PORTAL_NEXT_STEP_CARD_CLASS,
  PORTAL_TEAM_CARD_CLASS,
  isPaymentOverdue,
} from '../components/portalTheme';
import PortalTeamContactButtons from '../components/PortalTeamContactButtons';
import { usePortalTabData } from '../context/PortalTabDataContext';
import {
  portalActiveSubEffortCardCopy,
  type PortalSubEffortRow,
} from '../../../lib/portalSubEfforts';
import { translatePortalDynamicLabel } from '../i18n/portalDynamicLabels';

type TabId = 'summary' | 'stages' | 'finance' | 'documents' | 'contacts' | 'meetings';

type Props = {
  sessionContact: PortalContact | null;
  onNavigate: (tab: TabId) => void;
  onRequestMeeting: () => void;
  onSessionRefresh?: () => void;
};

function formatDate(d: string | null | undefined, locale?: string): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString(locale, { dateStyle: 'medium' });
  } catch {
    return d;
  }
}

function formatTime(t: string | null | undefined): string {
  if (!t) return '';
  const match = t.trim().match(/^(\d{1,2}):(\d{2})/);
  if (match) return `${match[1].padStart(2, '0')}:${match[2]}`;
  return t.trim();
}

function formatMoney(amount: number, currency: string | null): string {
  const sym = currency?.trim() || '₪';
  return `${sym}${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function meetingSortKey(m: PortalMeetingRow): number {
  const date = m.meeting_date ? new Date(m.meeting_date).getTime() : 0;
  const time = formatTime(m.meeting_time) || '00:00';
  const [h, min] = time.split(':').map(Number);
  return date + (h || 0) * 3600000 + (min || 0) * 60000;
}

function pickNextMeeting(meetings: PortalMeetingRow[]): PortalMeetingRow | null {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const upcoming = meetings
    .filter((m) => {
      const status = (m.status || '').toLowerCase();
      if (status === 'completed' || status === 'canceled' || status === 'cancelled') return false;
      const d = m.meeting_date ? new Date(m.meeting_date) : null;
      if (!d) return true;
      d.setHours(0, 0, 0, 0);
      return d.getTime() >= now.getTime();
    })
    .sort((a, b) => meetingSortKey(a) - meetingSortKey(b));
  return upcoming[0] ?? null;
}

function pickNextPayment(payments: PortalPaymentRow[]): PortalPaymentRow | null {
  const unpaid = payments.filter((p) => !p.paid);
  unpaid.sort((a, b) => {
    const da = a.due_date ? new Date(a.due_date).getTime() : Number.MAX_SAFE_INTEGER;
    const db = b.due_date ? new Date(b.due_date).getTime() : Number.MAX_SAFE_INTEGER;
    return da - db;
  });
  return unpaid[0] ?? null;
}

function portalGreeting(t: TFunction): string {
  const hour = new Date().getHours();
  if (hour < 12) return t('dashboard.greeting.morning');
  if (hour < 17) return t('dashboard.greeting.afternoon');
  return t('dashboard.greeting.evening');
}

function firstName(name: string | null | undefined, t: TFunction): string {
  const part = (name || '').trim().split(/\s+/).filter(Boolean)[0];
  return part || t('dashboard.firstNameFallback');
}

type NextStepActionId = 'payOnline' | 'viewFinance' | 'joinMeeting' | 'viewCaseStatus' | 'viewDocuments';

type NextStepInfo = {
  title: string;
  description: string;
  actionId?: NextStepActionId;
  href?: string;
  onAction?: () => void;
};

function buildNextStep(input: {
  t: TFunction;
  locale: string;
  nextPayment: PortalPaymentRow | null;
  nextPaymentTotal: string | null;
  nextPaymentOverdue: boolean;
  nextMeeting: PortalMeetingRow | null;
  nextMeetingLabel: string;
  latestSubEffort: PortalSubEffortRow | null;
  category: string | null;
  onNavigate: (tab: TabId) => void;
}): NextStepInfo {
  const {
    t,
    locale,
    nextPayment,
    nextPaymentTotal,
    nextPaymentOverdue,
    nextMeeting,
    nextMeetingLabel,
    latestSubEffort,
    category,
    onNavigate,
  } = input;

  if (nextPaymentOverdue && nextPayment?.secure_token) {
    return {
      title: t('dashboard.nextStep.titleNext'),
      description: t('dashboard.nextStep.paymentOverdue', {
        amount: nextPaymentTotal,
        date: formatDate(nextPayment.due_date, locale),
      }),
      actionId: 'payOnline',
      href: buildPaymentPagePath(nextPayment.secure_token),
    };
  }

  if (nextPayment && nextPaymentTotal) {
    return {
      title: t('dashboard.nextStep.titleNext'),
      description: t('dashboard.nextStep.paymentUpcoming', {
        amount: nextPaymentTotal,
        dueSuffix: nextPayment.due_date
          ? t('dashboard.nextStep.dueSuffix', { date: formatDate(nextPayment.due_date, locale) })
          : '',
      }),
      actionId: 'viewFinance',
      onAction: () => onNavigate('finance'),
    };
  }

  if (nextMeeting?.join_url) {
    return {
      title: t('dashboard.nextStep.titleNext'),
      description: t('dashboard.nextStep.meetingScheduled', { meetingLabel: nextMeetingLabel }),
      actionId: 'joinMeeting',
      href: nextMeeting.join_url,
    };
  }

  if (latestSubEffort?.sub_effort_name) {
    const categorySuffix = category ? t('dashboard.nextStep.categorySuffix', { category }) : '';
    return {
      title: t('dashboard.nextStep.titleOverview'),
      description: t('dashboard.nextStep.caseInStage', {
        stageName: translatePortalDynamicLabel(
          locale,
          latestSubEffort.sub_effort_name,
          latestSubEffort.sub_effort_name_he,
        ),
        categorySuffix,
      }),
      actionId: 'viewCaseStatus',
      onAction: () => onNavigate('stages'),
    };
  }

  return {
    title: t('dashboard.nextStep.titleOverview'),
    description: t('dashboard.nextStep.defaultDescription'),
    actionId: 'viewDocuments',
    onAction: () => onNavigate('documents'),
  };
}

type ActivityItem = { id: string; text: string };

function buildRecentActivity(input: {
  t: TFunction;
  locale: string;
  nextMeeting: PortalMeetingRow | null;
  nextMeetingLabel: string;
  payments: PortalPaymentRow[];
  latestSubEffort: PortalSubEffortRow | null;
}): ActivityItem[] {
  const { t, locale, nextMeeting, nextMeetingLabel, payments, latestSubEffort } = input;
  const items: ActivityItem[] = [];

  if (nextMeeting) {
    items.push({
      id: 'meeting',
      text: t('dashboard.recentActivity.meetingScheduled', { meetingLabel: nextMeetingLabel }),
    });
  }

  const recentlyPaid = [...payments]
    .filter((p) => p.paid && p.paid_at)
    .sort((a, b) => new Date(b.paid_at!).getTime() - new Date(a.paid_at!).getTime())[0];

  if (recentlyPaid?.paid_at) {
    items.push({
      id: 'payment-paid',
      text: t('dashboard.recentActivity.paymentReceived', { date: formatDate(recentlyPaid.paid_at, locale) }),
    });
  } else {
    const unpaid = pickNextPayment(payments);
    if (unpaid?.due_date) {
      items.push({
        id: 'payment-due',
        text: t('dashboard.recentActivity.paymentDue', { date: formatDate(unpaid.due_date, locale) }),
      });
    }
  }

  if (latestSubEffort?.sub_effort_name) {
    items.push({
      id: 'stage',
      text: t('dashboard.recentActivity.caseMoved', {
        stageName: translatePortalDynamicLabel(
          locale,
          latestSubEffort.sub_effort_name,
          latestSubEffort.sub_effort_name_he,
        ),
      }),
    });
  }

  return items.slice(0, 4);
}

function nextStepActionIcon(actionId: NextStepActionId | undefined) {
  if (!actionId) return FlagIcon;
  if (actionId === 'joinMeeting') return VideoCameraIcon;
  if (actionId === 'viewDocuments') return DocumentArrowUpIcon;
  if (actionId === 'viewCaseStatus') return BriefcaseIcon;
  return BanknotesIcon;
}

const TEAM_CARD_CLASS = 'relative flex h-full min-h-[11.5rem] min-w-[17.5rem] flex-col p-5 sm:min-w-0';

const MOBILE_CAROUSEL_ITEM_CLASS =
  'flex w-[calc(100vw-1rem)] max-w-[340px] shrink-0 snap-center sm:w-auto sm:max-w-none sm:shrink sm:snap-align-none [&>*]:h-full [&>*]:w-full';

const MOBILE_CAROUSEL_ROW_CLASS =
  'flex items-stretch gap-4 overflow-x-auto pb-2 snap-x snap-mandatory scroll-px-0 scrollbar-hide sm:snap-none sm:overflow-visible sm:pb-0';

const TEAM_ROW_CLASS =
  `${MOBILE_CAROUSEL_ROW_CLASS} md:grid md:grid-cols-2 md:gap-4 xl:grid-cols-3`;

const ROLE_META = [
  { key: 'handler' as const, labelKey: 'dashboard.team.roles.caseHandler' },
  { key: 'retainer_handler' as const, labelKey: 'dashboard.team.roles.legalAssistant' },
  { key: 'department_manager' as const, labelKey: 'dashboard.team.roles.departmentManager' },
];

/** Lower number wins when the same person is assigned to more than one role. */
const ROLE_PRIORITY: Record<(typeof ROLE_META)[number]['key'], number> = {
  handler: 0,
  department_manager: 1,
  retainer_handler: 2,
};

function buildPortalTeamEmployeeFallback(
  displayName: string,
  photoUrl: string | null | undefined,
  contact: PortalTeamContact | null | undefined,
  department?: string | null,
): EmployeeProfile {
  return {
    id: 0,
    display_name: displayName,
    official_name: displayName,
    photo_url: photoUrl?.trim() || null,
    chat_background_image_url: null,
    mobile: contact?.mobile ?? '',
    phone: contact?.phone ?? '',
    phone_ext: '',
    email: contact?.email ?? null,
    department_name: department?.trim() || 'General',
    bonuses_role: 'Employee',
    linkedin_url: null,
    // The card shows no hours; this is the standard day the rest of the app assumes.
    min_hours: 8,
  };
}

const PortalDashboardTab: React.FC<Props> = ({
  sessionContact,
  onNavigate,
}) => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const { data, initialLoading } = usePortalTabData();
  const summary = data?.summary ?? null;
  const meetings = data?.meetings?.meetings ?? [];
  const payments = data?.finances?.payments ?? [];
  const subEfforts = data?.subEfforts ?? [];
  const [businessCardEmployee, setBusinessCardEmployee] = useState<EmployeeProfile | null>(null);
  const [businessCardOpen, setBusinessCardOpen] = useState(false);

  const openTeamBusinessCard = async (
    displayName: string,
    photoUrl: string | null | undefined,
    contact: PortalTeamContact | null | undefined,
    department?: string | null,
  ) => {
    const profile =
      (await fetchEmployeeProfileByName(displayName)) ??
      buildPortalTeamEmployeeFallback(displayName, photoUrl, contact, department);
    setBusinessCardEmployee(profile);
    setBusinessCardOpen(true);
  };

  const loading = initialLoading && !data;

  const nextMeeting = useMemo(() => pickNextMeeting(meetings), [meetings]);
  const nextPayment = useMemo(() => pickNextPayment(payments), [payments]);
  const caseStatusCopy = useMemo(() => portalActiveSubEffortCardCopy(subEfforts), [subEfforts]);
  const latestSubEffort = caseStatusCopy.current;

  if (loading) return <PortalLoading />;

  if (!summary?.lead) {
    return <p className="text-base-content/50">{t('dashboard.loadError')}</p>;
  }

  const lead = summary.lead;
  const coverKey = `case::${lead.lead_number}::${lead.display_name}`;
  const preferHebrewName = locale.toLowerCase().startsWith('he');
  const pickTeamName = (en: string | null | undefined, he: string | null | undefined) => {
    const english = en?.trim() || '';
    const hebrew = he?.trim() || '';
    // Only use Hebrew when it is a real alternate value (not an English fallback).
    if (preferHebrewName && hebrew && hebrew !== english) return hebrew;
    return english || hebrew;
  };
  const rolesWithPeople = [
    {
      ...ROLE_META[0],
      name: pickTeamName(summary.handler_name, summary.handler_name_he),
      lookupName: summary.handler_name?.trim() || summary.handler_name_he?.trim() || '',
      photo: summary.handler_photo_url,
      contact: summary.handler_contact,
      department: summary.handler_department,
    },
    {
      ...ROLE_META[1],
      name: pickTeamName(summary.retainer_handler_name, summary.retainer_handler_name_he),
      lookupName:
        summary.retainer_handler_name?.trim() || summary.retainer_handler_name_he?.trim() || '',
      photo: summary.retainer_handler_photo_url,
      contact: summary.retainer_handler_contact,
      department: summary.retainer_handler_department,
    },
    {
      ...ROLE_META[2],
      name: pickTeamName(summary.department_manager_name, summary.department_manager_name_he),
      lookupName:
        summary.department_manager_name?.trim() ||
        summary.department_manager_name_he?.trim() ||
        '',
      photo: summary.department_manager_photo_url,
      contact: summary.department_manager_contact,
      department: summary.department_manager_department || summary.main_category_name,
    },
  ].filter((role) => {
    const displayName = role.name?.trim() || '';
    return Boolean(displayName) && displayName !== '—' && displayName !== 'Not assigned';
  });

  // Same employee in multiple roles → show once, preferring Case Handler over Legal Assistant.
  const preferredRoleByName = new Map<string, (typeof rolesWithPeople)[number]>();
  for (const role of rolesWithPeople) {
    const nameKey = (role.lookupName || role.name!).trim().toLowerCase();
    const existing = preferredRoleByName.get(nameKey);
    if (!existing || ROLE_PRIORITY[role.key] < ROLE_PRIORITY[existing.key]) {
      preferredRoleByName.set(nameKey, role);
    }
  }
  const roles = rolesWithPeople.filter(
    (role) =>
      preferredRoleByName.get((role.lookupName || role.name!).trim().toLowerCase()) === role,
  );

  const rolePhotoByName = new Map<string, string>();
  for (const role of roles) {
    const photo = role.photo?.trim();
    if (!photo) continue;
    const keys = [role.lookupName, role.name].map((n) => n?.trim().toLowerCase()).filter(Boolean);
    for (const key of keys) rolePhotoByName.set(key!, photo);
  }

  const nextMeetingLabel = nextMeeting
    ? `${formatDate(nextMeeting.meeting_date, locale)}${formatTime(nextMeeting.meeting_time) ? ` · ${formatTime(nextMeeting.meeting_time)}` : ''}`
    : t('dashboard.stats.nextMeeting.noneScheduled');

  const nextPaymentTotal = nextPayment
    ? formatMoney(Number(nextPayment.value || 0) + Number(nextPayment.value_vat || 0), nextPayment.currency)
    : null;
  const nextPaymentOverdue = nextPayment ? isPaymentOverdue(nextPayment.due_date) : false;

  const clientFirstName = firstName(sessionContact?.name || lead.display_name, t);

  const nextStep = buildNextStep({
    t,
    locale,
    nextPayment,
    nextPaymentTotal,
    nextPaymentOverdue,
    nextMeeting,
    nextMeetingLabel,
    latestSubEffort,
    category: summary.category,
    onNavigate,
  });

  const meetingHint = nextMeeting?.meeting_location?.trim()
    || (nextMeeting?.join_url
      ? t('dashboard.stats.nextMeeting.hintTeams')
      : nextMeeting
        ? t('dashboard.stats.nextMeeting.hintViewDetails')
        : t('dashboard.stats.nextMeeting.hintSchedule'));

  const recentActivity = buildRecentActivity({
    t,
    locale,
    nextMeeting,
    nextMeetingLabel,
    payments,
    latestSubEffort,
  });

  const NextStepIcon = nextStepActionIcon(nextStep.actionId);
  const nextStepActionLabel = nextStep.actionId
    ? t(`dashboard.nextStep.actions.${nextStep.actionId}`)
    : undefined;

  const caseStatusValue =
    caseStatusCopy.valueKey === 'complete'
      ? t('dashboard.stats.caseStatus.valueComplete')
      : caseStatusCopy.valueKey === 'noActive'
        ? t('dashboard.stats.caseStatus.valueNoActiveStage')
        : translatePortalDynamicLabel(
            locale,
            caseStatusCopy.value,
            caseStatusCopy.current?.sub_effort_name_he,
          );
  const caseStatusHint =
    caseStatusCopy.hintKey === 'current'
      ? t('dashboard.stats.caseStatus.hintCurrentStage')
      : caseStatusCopy.hintKey === 'allComplete'
        ? t('dashboard.stats.caseStatus.hintAllComplete')
        : t('dashboard.stats.caseStatus.hintLatestMilestone');

  return (
    <div className="space-y-8">
      <div className={`${PORTAL_DASHBOARD_CONTAINER} pt-1 md:pt-2`}>
        <p className="text-xl font-semibold tracking-tight text-[#16161d] md:text-2xl">
          {t('dashboard.greeting.withName', {
            greeting: portalGreeting(t),
            firstName: clientFirstName,
          })}
        </p>
      </div>

      <section className={`space-y-6 md:space-y-8 ${PORTAL_DASHBOARD_CONTAINER}`}>
        <div className={`${MOBILE_CAROUSEL_ROW_CLASS} sm:grid sm:grid-cols-2 xl:grid-cols-3`}>
        <div className={MOBILE_CAROUSEL_ITEM_CLASS}>
          <PortalStatCard
            label={t('dashboard.stats.nextMeeting.label')}
            value={nextMeetingLabel}
            hint={meetingHint}
            icon={CalendarDaysIcon}
            accent="sky"
            coverKey={`${coverKey}::stat-next-meeting`}
            onClick={() => onNavigate('meetings')}
          />
        </div>
        <div className={MOBILE_CAROUSEL_ITEM_CLASS}>
          <PortalStatCard
            label={t('dashboard.stats.nextPayment.label')}
            value={nextPayment ? nextPaymentTotal! : t('dashboard.stats.nextPayment.allCaughtUp')}
            hint={
              nextPayment?.due_date
                ? t('dashboard.stats.nextPayment.hintDue', { date: formatDate(nextPayment.due_date, locale) })
                : t('dashboard.stats.nextPayment.hintNoOutstanding')
            }
            icon={BanknotesIcon}
            accent="emerald"
            coverKey={`${coverKey}::stat-next-payment`}
            onClick={() => onNavigate('finance')}
            badge={
              nextPaymentOverdue ? (
                <span className="inline-flex rounded-full bg-red-100 px-3 py-0.5 text-xs font-semibold text-red-600 md:text-sm">
                  {t('common.badges.overdue')}
                </span>
              ) : undefined
            }
          />
        </div>
        <div className={MOBILE_CAROUSEL_ITEM_CLASS}>
          <PortalStatCard
            label={t('dashboard.stats.caseStatus.label')}
            value={caseStatusValue}
            hint={summary.category || caseStatusHint}
            icon={BriefcaseIcon}
            accent="primary"
            coverKey={`${coverKey}::stat-case-status`}
            onClick={() => onNavigate('stages')}
          />
        </div>
          </div>

          <div className={`${PORTAL_NEXT_STEP_CARD_CLASS} mt-2 flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between md:gap-6 md:p-6`}>
            <div
              className="pointer-events-none absolute bottom-[18px] left-0 top-[18px] w-1 rounded-full bg-blue-800"
              aria-hidden
            />
            <div className="flex min-w-0 items-start gap-4 pl-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-100 text-blue-800">
                <NextStepIcon className="h-5 w-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#747684]">{nextStep.title}</p>
                <p className="mt-1.5 text-sm font-semibold leading-relaxed text-[#16161d] md:text-base">{nextStep.description}</p>
              </div>
            </div>
            {nextStepActionLabel ? (
              nextStep.href ? (
                <a
                  href={nextStep.href}
                  target={nextStep.href.startsWith('http') ? '_blank' : undefined}
                  rel={nextStep.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                  className="inline-flex shrink-0 items-center gap-2 self-start rounded-full bg-blue-900 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_8px_22px_rgba(30,58,138,0.3)] transition-all hover:-translate-y-0.5 hover:bg-blue-950 md:self-center"
                >
                  <NextStepIcon className="h-4 w-4" />
                  {nextStepActionLabel}
                </a>
              ) : (
                <button
                  type="button"
                  onClick={nextStep.onAction}
                  className="inline-flex shrink-0 items-center gap-2 self-start rounded-full bg-blue-900 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_8px_22px_rgba(30,58,138,0.3)] transition-all hover:-translate-y-0.5 hover:bg-blue-950 md:self-center"
                >
                  <NextStepIcon className="h-4 w-4" />
                  {nextStepActionLabel}
                </button>
              )
            ) : null}
          </div>
      </section>

      {roles.length > 0 ? (
      <div className={`flex flex-col gap-5 md:gap-6 ${PORTAL_DASHBOARD_CONTAINER}`}>
        <div className="flex flex-col gap-1">
          <h3 className="text-lg font-bold tracking-tight text-[#16161d]">{t('dashboard.team.title')}</h3>
          <p className="text-sm text-[#747684]">{t('dashboard.team.subtitle')}</p>
        </div>
        <div className={TEAM_ROW_CLASS}>
            {roles.map((role) => {
              const displayName = role.name!.trim();
              const lookupName = (role.lookupName || displayName).trim();
              const photoUrl =
                role.photo?.trim() ||
                rolePhotoByName.get(lookupName.toLowerCase()) ||
                rolePhotoByName.get(displayName.toLowerCase());
              const avatarStableKey = `role::${role.key}::${lookupName || displayName}`;
              return (
                <div key={role.key} className={`${MOBILE_CAROUSEL_ITEM_CLASS} md:min-w-0`}>
                  <div
                    className={`${PORTAL_TEAM_CARD_CLASS} ${TEAM_CARD_CLASS} w-full cursor-pointer transition-shadow hover:shadow-[0_8px_24px_rgba(15,23,42,0.08)]`}
                    role="button"
                    tabIndex={0}
                    title={t('dashboard.team.viewBusinessCardTitle', { name: displayName })}
                    onClick={() =>
                      void openTeamBusinessCard(
                        lookupName,
                        photoUrl,
                        role.contact,
                        role.department,
                      )
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        void openTeamBusinessCard(
                          lookupName,
                          photoUrl,
                          role.contact,
                          role.department,
                        );
                      }
                    }}
                  >
                    <div className="flex min-h-0 flex-1 flex-col gap-4">
                      <div className="flex items-start gap-3.5">
                        <EntityAvatar
                          name={displayName}
                          imageUrl={photoUrl}
                          stableKey={avatarStableKey}
                          className="h-[68px] w-[68px] shrink-0 text-base"
                        />
                        <div className="min-w-0 flex-1 pt-0.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#747684]">
                              {t(role.labelKey)}
                            </p>
                            {role.key === 'handler' ? (
                              <span className="inline-flex rounded-full bg-blue-50 px-1.5 py-0.5 text-[9px] font-medium text-blue-700">
                                {t('common.mainContactBadge')}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-0.5 text-base font-semibold leading-snug text-[#16161d] lg:text-lg">
                            {displayName}
                          </p>
                        </div>
                      </div>
                      <div
                        className="team-actions mt-auto flex justify-start border-t border-[rgba(15,23,42,0.06)] pt-3.5"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        <PortalTeamContactButtons contact={role.contact} />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
        </div>
      </div>
      ) : null}

      <div className={`${PORTAL_DASHBOARD_CONTAINER}`}>
        <div className={`${PORTAL_TEAM_CARD_CLASS} p-5 md:p-6`}>
          <h4 className="text-sm font-bold tracking-tight text-[#16161d]">{t('dashboard.recentActivity.title')}</h4>
          {recentActivity.length > 0 ? (
            <ul className="mt-3 space-y-2.5">
              {recentActivity.map((item) => (
                <li key={item.id} className="flex items-start gap-2.5 text-sm text-[#16161d]">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-800" aria-hidden />
                  <span className="leading-relaxed">{item.text}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-[#747684]">{t('dashboard.recentActivity.empty')}</p>
          )}
        </div>
      </div>

      {businessCardEmployee ? (
        <EmployeeBusinessCardModal
          employee={businessCardEmployee}
          open={businessCardOpen}
          onClose={() => setBusinessCardOpen(false)}
        />
      ) : null}
    </div>
  );
};

export default PortalDashboardTab;
