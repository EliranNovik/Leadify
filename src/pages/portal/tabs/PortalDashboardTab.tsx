import React, { useEffect, useMemo, useState } from 'react';
import {
  BanknotesIcon,
  CalendarDaysIcon,
  VideoCameraIcon,
  BriefcaseIcon,
  ArrowPathIcon,
  ClipboardDocumentCheckIcon,
} from '@heroicons/react/24/outline';
import {
  portalGetCaseSummary,
  portalGetContacts,
  portalGetDocuments,
  portalGetFinances,
  portalGetMeetings,
  portalGetSubEfforts,
  type PortalContact,
  type PortalDocumentRow,
  type PortalMeetingRow,
  type PortalPaymentRow,
} from '../../../lib/portalApi';
import { buildPaymentPagePath } from '../../../lib/proformaPaymentLink';
import {
  EntityAvatar,
  getInitialsTheme,
  PortalCard,
  PortalLoading,
  PortalStatCard,
  PORTAL_STAT_ACTION_BTN_CLASS,
  PORTAL_DEFAULT_BANNER,
  isPaymentOverdue,
} from '../components/portalTheme';
import PortalTeamContactButtons from '../components/PortalTeamContactButtons';
import PortalBannerSearch from '../components/PortalBannerSearch';
import type { PortalSearchData } from '../lib/portalSearch';

type SubEffortRow = {
  sub_effort_name?: string;
  created_at?: string;
  updated_at?: string;
};

type TabId = 'summary' | 'stages' | 'finance' | 'documents' | 'contacts' | 'meetings';

type ContactRow = {
  id: number;
  name: string;
  mobile: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  is_main: boolean;
  portal_profile_image_path: string | null;
};

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

const TEAM_CARD_CLASS = 'relative flex h-full min-h-[260px] min-w-[17.5rem] flex-col p-0 sm:min-w-0';

const MOBILE_CAROUSEL_ITEM_CLASS =
  'flex w-[calc(100vw-1rem)] max-w-[340px] shrink-0 snap-center sm:w-auto sm:max-w-none sm:shrink sm:snap-align-none [&>*]:h-full [&>*]:w-full';

const MOBILE_CAROUSEL_ROW_CLASS =
  'flex items-stretch gap-4 overflow-x-auto pb-2 -mx-2 snap-x snap-mandatory scroll-px-2 px-2 scrollbar-hide sm:mx-0 sm:snap-none sm:overflow-visible sm:pb-0 sm:px-0';

const TEAM_ROW_CLASS =
  `${MOBILE_CAROUSEL_ROW_CLASS} md:grid md:grid-cols-2 md:gap-4 xl:grid-cols-3`;

const ROLE_META = [
  { key: 'handler' as const, label: 'Case Handler', icon: ClipboardDocumentCheckIcon },
  { key: 'retainer_handler' as const, label: 'Retention handler', icon: ArrowPathIcon },
  { key: 'meeting_manager' as const, label: 'Meeting manager', icon: CalendarDaysIcon },
];

const PortalDashboardTab: React.FC<Props> = ({
  onNavigate,
  onRequestMeeting,
}) => {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof portalGetCaseSummary>>>(null);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [meetings, setMeetings] = useState<PortalMeetingRow[]>([]);
  const [payments, setPayments] = useState<PortalPaymentRow[]>([]);
  const [subEfforts, setSubEfforts] = useState<SubEffortRow[]>([]);
  const [documents, setDocuments] = useState<PortalDocumentRow[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const [summaryData, contactsData, meetingsData, financeData, subEffortsData, documentsData] =
          await Promise.all([
          portalGetCaseSummary(),
          portalGetContacts(),
          portalGetMeetings(),
          portalGetFinances(),
          portalGetSubEfforts(),
          portalGetDocuments(),
        ]);
        setSummary(summaryData);
        setContacts((contactsData?.contacts ?? []) as ContactRow[]);
        setMeetings(meetingsData?.meetings ?? []);
        setPayments(financeData?.payments ?? []);
        setSubEfforts((subEffortsData?.rows ?? []) as SubEffortRow[]);
        setDocuments(documentsData?.documents ?? []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

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

  const searchData = useMemo((): PortalSearchData => {
    if (!summary?.lead) return {};
    return {
      lead: {
        display_name: summary.lead.display_name,
        lead_number: summary.lead.lead_number,
        stage_name: summary.lead.stage_name,
        category: summary.category,
      },
      contacts: contacts.map((c) => ({
        name: c.name,
        email: c.email,
        phone: c.phone,
        mobile: c.mobile,
      })),
      meetings: meetings.map((m) => ({
        meeting_subject: m.meeting_subject,
        meeting_date: m.meeting_date,
        meeting_location: m.meeting_location,
      })),
      payments,
      subEfforts,
      documents: documents.map((d) => ({ file_name: d.file_name })),
      team: [
        { role: 'Case Handler', name: summary.handler_name },
        { role: 'Retention handler', name: summary.retainer_handler_name },
        { role: 'Meeting manager', name: summary.meeting_manager_name },
      ],
    };
  }, [summary, contacts, meetings, payments, subEfforts, documents]);

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
      name: summary.meeting_manager_name,
      photo: summary.meeting_manager_photo_url,
      contact: summary.meeting_manager_contact,
      department: summary.meeting_manager_department,
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

  const bannerSearch = (
    <PortalBannerSearch
      data={searchData}
      onNavigate={onNavigate}
      onRequestMeeting={onRequestMeeting}
    />
  );

  return (
    <div className="space-y-8">
      {/* Top region — shared banner background behind hero + summary cards */}
      <section className="relative -mx-2 -mt-6 px-2 pt-6 md:-mx-10 md:-mt-[7rem] md:px-10 md:pt-[7rem]">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <img
            src={PORTAL_DEFAULT_BANNER}
            alt=""
            className="h-full w-full object-cover object-center"
            loading="lazy"
          />
          <div
            className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/20 to-[#ececec]"
            aria-hidden
          />
        </div>

        <div className="relative z-10 space-y-6 pb-8 md:space-y-8">
          {/* Case hero — search + badges directly on the banner */}
          <div className="lg:mx-auto lg:max-w-4xl xl:max-w-5xl">
            <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center md:justify-between md:gap-4">
              <div className="w-full md:max-w-sm">{bannerSearch}</div>
              <div className="flex flex-wrap gap-2 md:justify-end">
                {latestSubEffort?.sub_effort_name ? (
                  <span className="rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-primary-content shadow-md">
                    {latestSubEffort.sub_effort_name}
                  </span>
                ) : null}
                {summary.category ? (
                  <span className="rounded-full bg-white/90 px-4 py-1.5 text-sm font-semibold text-base-content/75 shadow-md backdrop-blur-sm">
                    {summary.category}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          {/* KPI row */}
          <div className={`${MOBILE_CAROUSEL_ROW_CLASS} sm:grid sm:grid-cols-2 xl:grid-cols-3`}>
        <div className={MOBILE_CAROUSEL_ITEM_CLASS}>
          <PortalStatCard
            label="Next meeting"
            value={nextMeetingLabel}
            hint={nextMeeting?.meeting_location || (nextMeeting ? 'Tap Meetings for details' : 'Schedule a time in Meetings')}
            icon={CalendarDaysIcon}
            accent="sky"
            coverKey={`${coverKey}::stat-next-meeting`}
            onClick={() => onNavigate('meetings')}
            action={
              nextMeeting?.join_url ? (
                <a
                  href={nextMeeting.join_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={PORTAL_STAT_ACTION_BTN_CLASS}
                >
                  <VideoCameraIcon className="h-4 w-4 shrink-0" />
                  Join
                </a>
              ) : undefined
            }
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
            action={
              nextPayment?.secure_token ? (
                <a
                  href={buildPaymentPagePath(nextPayment.secure_token)}
                  className={PORTAL_STAT_ACTION_BTN_CLASS}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <BanknotesIcon className="h-4 w-4 shrink-0" />
                  Pay online
                </a>
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
        </div>
      </section>

      <div className="flex flex-col gap-4">
        <h3 className="px-0.5 text-lg font-bold tracking-tight text-base-content/90">Your team</h3>
        <div className={TEAM_ROW_CLASS}>
            {roles.map((role) => {
              const displayName = role.name?.trim() || 'Not assigned';
              const assigned = displayName !== 'Not assigned' && displayName !== '—';
              const department = role.department?.trim() || null;
              const photoUrl =
                role.photo?.trim() ||
                (assigned ? rolePhotoByName.get(displayName.toLowerCase()) : undefined);
              const avatarStableKey = `role::${role.key}::${displayName}`;
              const initialsTheme = getInitialsTheme(avatarStableKey);
              const RoleIcon = role.icon;
              return (
                <div key={role.key} className={`${MOBILE_CAROUSEL_ITEM_CLASS} md:min-w-0`}>
                <PortalCard padding="p-0" className={`${TEAM_CARD_CLASS} w-full`}>
                  <div className="flex min-h-0 flex-1 flex-col">
                    <div className="relative px-3 pb-1 pt-3 pr-[6rem] md:px-4 md:pt-4 lg:pr-[8.75rem]">
                      <div className="flex min-w-0 items-start gap-2.5">
                        <span
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg lg:h-12 lg:w-12"
                          style={{
                            backgroundColor: initialsTheme.avatarStyle.backgroundColor,
                            color: initialsTheme.avatarStyle.color,
                          }}
                        >
                          <RoleIcon className="h-5 w-5 lg:h-7 lg:w-7" aria-hidden />
                        </span>
                        <span
                          className="min-w-0 flex-1 text-xs font-bold uppercase leading-snug tracking-wide lg:text-lg"
                          style={{ color: initialsTheme.headerStyle.color }}
                        >
                          {role.label}
                        </span>
                      </div>
                      <div className="absolute right-3 top-full z-10 -translate-y-1/2 rounded-full ring-[3px] ring-white md:right-4">
                        <EntityAvatar
                          name={assigned ? displayName : role.label}
                          imageUrl={photoUrl}
                          stableKey={avatarStableKey}
                          className="h-20 w-20 shrink-0 text-lg lg:h-32 lg:w-32 lg:text-2xl"
                        />
                      </div>
                    </div>
                    <div className="flex flex-1 flex-col items-center justify-center px-3 pb-2 pt-8 text-center md:px-4 lg:pt-12">
                      <p className="text-sm font-semibold leading-snug tracking-tight text-neutral-900 lg:text-xl">
                        {assigned ? displayName : '—'}
                      </p>
                      {assigned && department ? (
                        <span
                          className="mt-1.5 inline-flex max-w-full rounded-full px-3 py-1 text-[11px] font-semibold lg:mt-2 lg:text-sm"
                          style={{
                            backgroundColor: initialsTheme.headerStyle.backgroundColor,
                            color: initialsTheme.headerStyle.color,
                          }}
                        >
                          {department}
                        </span>
                      ) : null}
                      {!assigned ? (
                        <p className="mt-1 text-xs text-neutral-400 lg:text-sm">Not assigned yet</p>
                      ) : null}
                    </div>
                    {assigned ? (
                      <div className="mt-auto px-3 pb-3 pt-1 md:px-4">
                        <PortalTeamContactButtons contact={role.contact} />
                      </div>
                    ) : (
                      <div className="pb-3 md:pb-4" />
                    )}
                  </div>
                </PortalCard>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
};

export default PortalDashboardTab;
