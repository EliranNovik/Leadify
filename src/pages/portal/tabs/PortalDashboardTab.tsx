import React, { useEffect, useMemo, useState } from 'react';
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
  PortalTabHeaderCover,
  PORTAL_DEFAULT_BANNER,
  PORTAL_TEAM_CARD_CLASS,
  isPaymentOverdue,
} from '../components/portalTheme';
import PortalTeamContactButtons from '../components/PortalTeamContactButtons';
import { usePortalTabData } from '../context/PortalTabDataContext';

type SubEffortRow = {
  sub_effort_name?: string;
  created_at?: string;
  updated_at?: string;
};

type TabId = 'summary' | 'stages' | 'finance' | 'documents' | 'contacts' | 'meetings';

type Props = {
  sessionContact: PortalContact | null;
  onNavigate: (tab: TabId) => void;
  onRequestMeeting: () => void;
  onSessionRefresh?: () => void;
};

function formatDate(d: string | null | undefined): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString(undefined, { dateStyle: 'medium' });
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

function portalGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function firstName(name: string | null | undefined): string {
  const part = (name || '').trim().split(/\s+/).filter(Boolean)[0];
  return part || 'there';
}

type NextStepInfo = {
  title: string;
  description: string;
  actionLabel?: string;
  href?: string;
  onAction?: () => void;
};

function buildNextStep(input: {
  nextPayment: PortalPaymentRow | null;
  nextPaymentTotal: string | null;
  nextPaymentOverdue: boolean;
  nextMeeting: PortalMeetingRow | null;
  nextMeetingLabel: string;
  latestSubEffort: SubEffortRow | null;
  category: string | null;
  onNavigate: (tab: TabId) => void;
}): NextStepInfo {
  const {
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
      title: 'Next step',
      description: `Your payment of ${nextPaymentTotal} was due ${formatDate(nextPayment.due_date)}. Please complete it to keep your case on track.`,
      actionLabel: 'Pay online',
      href: buildPaymentPagePath(nextPayment.secure_token),
    };
  }

  if (nextPayment && nextPaymentTotal) {
    return {
      title: 'Next step',
      description: `Upcoming payment of ${nextPaymentTotal}${nextPayment.due_date ? ` due ${formatDate(nextPayment.due_date)}` : ''}.`,
      actionLabel: 'View finance',
      onAction: () => onNavigate('finance'),
    };
  }

  if (nextMeeting?.join_url) {
    return {
      title: 'Next step',
      description: `Your meeting is scheduled for ${nextMeetingLabel}.`,
      actionLabel: 'Join meeting',
      href: nextMeeting.join_url,
    };
  }

  if (latestSubEffort?.sub_effort_name) {
    const categorySuffix = category ? ` (${category})` : '';
    return {
      title: 'Case overview',
      description: `Your case is currently in ${latestSubEffort.sub_effort_name}${categorySuffix}.`,
      actionLabel: 'View case status',
      onAction: () => onNavigate('stages'),
    };
  }

  return {
    title: 'Case overview',
    description: 'Track your meetings, payments, documents, and communication in one secure place.',
    actionLabel: 'View documents',
    onAction: () => onNavigate('documents'),
  };
}

const FALLBACK_PROGRESS_STEPS = [
  'Documents received',
  'Review',
  'Client communication',
  'Submission',
  'Decision',
] as const;

function buildCaseProgress(
  subEfforts: SubEffortRow[],
  activeName: string | null | undefined,
  stageName: string | null | undefined,
): { steps: string[]; activeIndex: number } {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const sorted = [...subEfforts].sort(
    (a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime(),
  );

  for (const row of sorted) {
    const name = row.sub_effort_name?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      ordered.push(name);
    }
  }

  const steps = ordered.length > 0 ? ordered : [...FALLBACK_PROGRESS_STEPS];
  const active = (activeName || stageName || '').trim().toLowerCase();

  let activeIndex = active
    ? steps.findIndex((step) => {
        const stepKey = step.toLowerCase();
        return stepKey === active || stepKey.includes(active) || active.includes(stepKey);
      })
    : -1;

  if (activeIndex < 0 && ordered.length > 0) {
    activeIndex = ordered.length - 1;
  }

  return { steps, activeIndex };
}

type ActivityItem = { id: string; text: string };

function buildRecentActivity(input: {
  nextMeeting: PortalMeetingRow | null;
  nextMeetingLabel: string;
  payments: PortalPaymentRow[];
  latestSubEffort: SubEffortRow | null;
}): ActivityItem[] {
  const { nextMeeting, nextMeetingLabel, payments, latestSubEffort } = input;
  const items: ActivityItem[] = [];

  if (nextMeeting) {
    items.push({
      id: 'meeting',
      text: `Meeting scheduled for ${nextMeetingLabel}`,
    });
  }

  const recentlyPaid = [...payments]
    .filter((p) => p.paid && p.paid_at)
    .sort((a, b) => new Date(b.paid_at!).getTime() - new Date(a.paid_at!).getTime())[0];

  if (recentlyPaid?.paid_at) {
    items.push({
      id: 'payment-paid',
      text: `Payment received on ${formatDate(recentlyPaid.paid_at)}`,
    });
  } else {
    const unpaid = pickNextPayment(payments);
    if (unpaid?.due_date) {
      items.push({
        id: 'payment-due',
        text: `Payment due ${formatDate(unpaid.due_date)}`,
      });
    }
  }

  if (latestSubEffort?.sub_effort_name) {
    items.push({
      id: 'stage',
      text: `Case moved to ${latestSubEffort.sub_effort_name}`,
    });
  }

  return items.slice(0, 4);
}

function nextStepActionIcon(label: string | undefined) {
  if (!label) return FlagIcon;
  if (label === 'Join meeting') return VideoCameraIcon;
  if (label === 'View documents') return DocumentArrowUpIcon;
  if (label === 'View case status') return BriefcaseIcon;
  return BanknotesIcon;
}

function PortalCaseProgressStrip({
  steps,
  activeIndex,
}: {
  steps: string[];
  activeIndex: number;
}) {
  if (!steps.length) return null;

  return (
    <div className="mt-3 overflow-x-auto scrollbar-hide md:mt-4">
      <div
        className="inline-flex max-w-full gap-1.5 rounded-full bg-black/25 p-[7px] backdrop-blur-[14px]"
        role="list"
        aria-label="Case progress"
      >
        {steps.map((step, idx) => {
          const active = idx === activeIndex;
          return (
            <span
              key={`${step}-${idx}`}
              role="listitem"
              className={`shrink-0 rounded-full px-4 py-2.5 text-[13px] font-semibold ${
                active
                  ? 'bg-white text-blue-900 shadow-[0_8px_22px_rgba(0,0,0,0.18)]'
                  : 'bg-white/10 text-white'
              }`}
            >
              {step}
            </span>
          );
        })}
      </div>
    </div>
  );
}

const TEAM_CARD_CLASS = 'relative flex h-full min-h-[11.5rem] min-w-[17.5rem] flex-col p-5 sm:min-w-0';

const MOBILE_CAROUSEL_ITEM_CLASS =
  'flex w-[calc(100vw-1rem)] max-w-[340px] shrink-0 snap-center sm:w-auto sm:max-w-none sm:shrink sm:snap-align-none [&>*]:h-full [&>*]:w-full';

const MOBILE_CAROUSEL_ROW_CLASS =
  'flex items-stretch gap-4 overflow-x-auto pb-2 snap-x snap-mandatory scroll-px-0 scrollbar-hide sm:snap-none sm:overflow-visible sm:pb-0';

const TEAM_ROW_CLASS =
  `${MOBILE_CAROUSEL_ROW_CLASS} md:grid md:grid-cols-2 md:gap-4 xl:grid-cols-3`;

const ROLE_META = [
  { key: 'handler' as const, label: 'Case Handler' },
  { key: 'retainer_handler' as const, label: 'Retention handler' },
  { key: 'department_manager' as const, label: 'Department manager' },
];

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
  };
}

const PortalDashboardTab: React.FC<Props> = ({
  sessionContact,
  onNavigate,
}) => {
  const { data, initialLoading } = usePortalTabData();
  const summary = data?.summary ?? null;
  const meetings = data?.meetings?.meetings ?? [];
  const payments = data?.finances?.payments ?? [];
  const subEfforts = (data?.subEfforts ?? []) as SubEffortRow[];
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
  const latestSubEffort = useMemo(() => {
    if (!subEfforts.length) return null;
    return [...subEfforts].sort((a, b) => {
      const ta = new Date(a.created_at || a.updated_at || 0).getTime();
      const tb = new Date(b.created_at || b.updated_at || 0).getTime();
      return tb - ta;
    })[0];
  }, [subEfforts]);

  if (loading) return <PortalLoading />;

  if (!summary?.lead) {
    return <p className="text-base-content/50">Unable to load your dashboard.</p>;
  }

  const lead = summary.lead;
  const coverKey = `case::${lead.lead_number}::${lead.display_name}`;
  const roles = [
    {
      ...ROLE_META[0],
      name: summary.handler_name,
      photo: summary.handler_photo_url,
      contact: summary.handler_contact,
      department: summary.handler_department,
    },
    {
      ...ROLE_META[1],
      name: summary.retainer_handler_name,
      photo: summary.retainer_handler_photo_url,
      contact: summary.retainer_handler_contact,
      department: summary.retainer_handler_department,
    },
    {
      ...ROLE_META[2],
      name: summary.department_manager_name,
      photo: summary.department_manager_photo_url,
      contact: summary.department_manager_contact,
      department: summary.department_manager_department || summary.main_category_name,
    },
  ];

  const rolePhotoByName = new Map<string, string>();
  for (const role of roles) {
    const name = role.name?.trim();
    const photo = role.photo?.trim();
    if (name && photo) rolePhotoByName.set(name.toLowerCase(), photo);
  }

  const nextMeetingLabel = nextMeeting
    ? `${formatDate(nextMeeting.meeting_date)}${formatTime(nextMeeting.meeting_time) ? ` · ${formatTime(nextMeeting.meeting_time)}` : ''}`
    : 'None scheduled';

  const nextPaymentTotal = nextPayment
    ? formatMoney(Number(nextPayment.value || 0) + Number(nextPayment.value_vat || 0), nextPayment.currency)
    : null;
  const nextPaymentOverdue = nextPayment ? isPaymentOverdue(nextPayment.due_date) : false;

  const clientFirstName = firstName(sessionContact?.name || lead.display_name);

  const nextStep = buildNextStep({
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
    || (nextMeeting?.join_url ? 'Teams meeting' : nextMeeting ? 'View details in Meetings' : 'Schedule a time in Meetings');

  const caseProgress = buildCaseProgress(
    subEfforts,
    latestSubEffort?.sub_effort_name,
    lead.stage_name,
  );

  const recentActivity = buildRecentActivity({
    nextMeeting,
    nextMeetingLabel,
    payments,
    latestSubEffort,
  });

  const NextStepIcon = nextStepActionIcon(nextStep.actionLabel);

  return (
    <div className="space-y-8">
      <PortalTabHeaderCover coverImage={PORTAL_DEFAULT_BANNER} tall>
        <p className="text-sm font-medium text-white/90 md:text-base">
          {portalGreeting()}, {clientFirstName}
        </p>
        <h2 className="mt-1 text-2xl font-bold tracking-tight text-white md:text-3xl">Case overview</h2>
        <PortalCaseProgressStrip steps={caseProgress.steps} activeIndex={caseProgress.activeIndex} />
      </PortalTabHeaderCover>

      <section className={`space-y-6 md:space-y-8 ${PORTAL_DASHBOARD_CONTAINER}`}>
        <div className={`${MOBILE_CAROUSEL_ROW_CLASS} sm:grid sm:grid-cols-2 xl:grid-cols-3`}>
        <div className={MOBILE_CAROUSEL_ITEM_CLASS}>
          <PortalStatCard
            label="Next meeting"
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
            label="Next payment"
            value={nextPayment ? nextPaymentTotal! : 'All caught up'}
            hint={nextPayment?.due_date ? `Due ${formatDate(nextPayment.due_date)}` : 'No outstanding payments'}
            icon={BanknotesIcon}
            accent="emerald"
            coverKey={`${coverKey}::stat-next-payment`}
            onClick={() => onNavigate('finance')}
            badge={
              nextPaymentOverdue ? (
                <span className="inline-flex rounded-full bg-red-100 px-3 py-0.5 text-xs font-semibold text-red-600 md:text-sm">
                  Overdue
                </span>
              ) : undefined
            }
          />
        </div>
        <div className={MOBILE_CAROUSEL_ITEM_CLASS}>
          <PortalStatCard
            label="Case Status"
            value={latestSubEffort?.sub_effort_name || 'No active stage'}
            hint={summary.category || 'Latest case milestone'}
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
            {nextStep.actionLabel ? (
              nextStep.href ? (
                <a
                  href={nextStep.href}
                  target={nextStep.href.startsWith('http') ? '_blank' : undefined}
                  rel={nextStep.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                  className="inline-flex shrink-0 items-center gap-2 self-start rounded-full bg-blue-900 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_8px_22px_rgba(30,58,138,0.3)] transition-all hover:-translate-y-0.5 hover:bg-blue-950 md:self-center"
                >
                  <NextStepIcon className="h-4 w-4" />
                  {nextStep.actionLabel}
                </a>
              ) : (
                <button
                  type="button"
                  onClick={nextStep.onAction}
                  className="inline-flex shrink-0 items-center gap-2 self-start rounded-full bg-blue-900 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_8px_22px_rgba(30,58,138,0.3)] transition-all hover:-translate-y-0.5 hover:bg-blue-950 md:self-center"
                >
                  <NextStepIcon className="h-4 w-4" />
                  {nextStep.actionLabel}
                </button>
              )
            ) : null}
          </div>
      </section>

      <div className={`flex flex-col gap-5 md:gap-6 ${PORTAL_DASHBOARD_CONTAINER}`}>
        <div className="flex flex-col gap-1">
          <h3 className="text-lg font-bold tracking-tight text-[#16161d]">Your legal team</h3>
          <p className="text-sm text-[#747684]">Reach your assigned professionals directly.</p>
        </div>
        <div className={TEAM_ROW_CLASS}>
            {roles.map((role) => {
              const displayName = role.name?.trim() || 'Not assigned';
              const assigned = displayName !== 'Not assigned' && displayName !== '—';
              const photoUrl =
                role.photo?.trim() ||
                (assigned ? rolePhotoByName.get(displayName.toLowerCase()) : undefined);
              const avatarStableKey = `role::${role.key}::${displayName}`;
              return (
                <div key={role.key} className={`${MOBILE_CAROUSEL_ITEM_CLASS} md:min-w-0`}>
                  <div
                    className={`${PORTAL_TEAM_CARD_CLASS} ${TEAM_CARD_CLASS} w-full ${
                      assigned
                        ? 'cursor-pointer transition-shadow hover:shadow-[0_8px_24px_rgba(15,23,42,0.08)]'
                        : ''
                    }`}
                    role={assigned ? 'button' : undefined}
                    tabIndex={assigned ? 0 : undefined}
                    title={assigned ? `View ${displayName}'s business card` : undefined}
                    onClick={
                      assigned
                        ? () =>
                            void openTeamBusinessCard(
                              displayName,
                              photoUrl,
                              role.contact,
                              role.department,
                            )
                        : undefined
                    }
                    onKeyDown={
                      assigned
                        ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              void openTeamBusinessCard(
                                displayName,
                                photoUrl,
                                role.contact,
                                role.department,
                              );
                            }
                          }
                        : undefined
                    }
                  >
                    <div className="flex min-h-0 flex-1 flex-col gap-4">
                      <div className="flex items-start gap-3.5">
                        <EntityAvatar
                          name={assigned ? displayName : role.label}
                          imageUrl={photoUrl}
                          stableKey={avatarStableKey}
                          className="h-[68px] w-[68px] shrink-0 text-base"
                        />
                        <div className="min-w-0 flex-1 pt-0.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#747684]">
                              {role.label}
                            </p>
                            {assigned && role.key === 'handler' ? (
                              <span className="inline-flex rounded-full bg-blue-50 px-1.5 py-0.5 text-[9px] font-medium text-blue-700">
                                Main contact
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-0.5 text-base font-semibold leading-snug text-[#16161d] lg:text-lg">
                            {assigned ? displayName : '—'}
                          </p>
                          {!assigned ? (
                            <p className="mt-1 text-xs text-[#747684]">Not assigned yet</p>
                          ) : null}
                        </div>
                      </div>
                      {assigned ? (
                        <div
                          className="team-actions mt-auto flex justify-start border-t border-[rgba(15,23,42,0.06)] pt-3.5"
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          <PortalTeamContactButtons contact={role.contact} />
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
        </div>

        <div className={`${PORTAL_TEAM_CARD_CLASS} p-5 md:p-6`}>
          <h4 className="text-sm font-bold tracking-tight text-[#16161d]">Recent activity</h4>
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
            <p className="mt-2 text-sm text-[#747684]">No recent updates to show yet.</p>
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
