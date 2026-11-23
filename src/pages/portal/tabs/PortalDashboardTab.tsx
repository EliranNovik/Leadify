import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  BanknotesIcon,
  CalendarDaysIcon,
  VideoCameraIcon,
  BriefcaseIcon,
  DocumentArrowUpIcon,
  FlagIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PlayIcon,
} from '@heroicons/react/24/outline';
import {
  portalGetClientNeededDocuments,
  portalGetNotifications,
  type PortalContact,
  type PortalContactContractRow,
  type PortalMeetingRow,
  type PortalNeededDocument,
  type PortalNotificationRow,
  type PortalPaymentRow,
  type PortalTeamContact,
} from '../../../lib/portalApi';
import { buildPoaUrl } from '../../../lib/poaApi';
import { getFrontendBaseUrl } from '../../../lib/api';
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
import { notificationSubtitle, notificationTitle } from '../components/PortalNotifications';
import {
  findCurrentPortalSubEffort,
  portalActiveSubEffortCardCopy,
  type PortalSubEffortRow,
} from '../../../lib/portalSubEfforts';
import { FaYoutube } from 'react-icons/fa';
import { translatePortalDynamicLabel } from '../i18n/portalDynamicLabels';

type TabId = 'summary' | 'stages' | 'finance' | 'documents' | 'contacts' | 'meetings';

const PORTAL_NEWS = [
  { id: 'archive', image: '/portal-news-archive.jpg' },
  { id: 'payments', image: '/portal-news-payment.jpg' },
  { id: 'welcome', image: '/portal-news-welcome.jpg' },
] as const;

const PORTAL_VIDEOS = [
  { id: 'aCBU_vZ3AK8', title: 'Navigating War and Law: Decker, Pex, Levi Stays the Course' },
  { id: 'yRAhjY3mzRQ', title: 'Israeli Citizenship Process Interrupted: Rights & Legal Options for Foreign Spouses' },
  { id: 'U6zbKnnfYAI', title: 'Legal Challenges in Wartime Israel – Interview with Joshua Pex | ILTV' },
  { id: 'yPPUJZEps7A', title: 'Get German or Austrian Citizenship Through Jewish Ancestry.' },
] as const;

const PORTAL_FAQ: ReadonlyArray<{ id: string; tab?: TabId; anchor?: string }> = [
  { id: 'pay', tab: 'finance' },
  { id: 'meeting', tab: 'meetings' },
  { id: 'documents', tab: 'documents' },
  { id: 'upload', tab: 'documents' },
  { id: 'team', anchor: 'portal-legal-team' },
  { id: 'contact', anchor: 'portal-legal-team' },
  { id: 'status', tab: 'stages' },
];

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

function icsEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

function downloadMeetingIcs(meeting: PortalMeetingRow, summaryFallback: string) {
  const dateMatch = (meeting.meeting_date || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!dateMatch) return;
  const timeMatch = formatTime(meeting.meeting_time).match(/^(\d{2}):(\d{2})/);
  const hour = timeMatch ? timeMatch[1] : '09';
  const minute = timeMatch ? timeMatch[2] : '00';
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const start = `${dateMatch[1]}${dateMatch[2]}${dateMatch[3]}T${hour}${minute}00`;
  const endHour = String((Number(hour) + 1) % 24).padStart(2, '0');
  const end = `${dateMatch[1]}${dateMatch[2]}${dateMatch[3]}T${endHour}${minute}00`;
  const summary = icsEscape((meeting.meeting_subject || '').trim() || summaryFallback);
  const location = icsEscape((meeting.meeting_address || meeting.meeting_location || '').trim());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Decker Pex Levi//Client Portal//EN',
    'BEGIN:VEVENT',
    `UID:portal-meeting-${meeting.id}@lawoffice.org.il`,
    `DTSTAMP:${stamp}`,
    `DTSTART;TZID=Asia/Jerusalem:${start}`,
    `DTEND;TZID=Asia/Jerusalem:${end}`,
    `SUMMARY:${summary}`,
  ];
  if (location) lines.push(`LOCATION:${location}`);
  if (meeting.join_url) lines.push(`URL:${meeting.join_url}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'meeting.ics';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildContractUrl(row: PortalContactContractRow): string {
  const path = row.is_legacy ? 'public-legacy-contract' : 'public-contract';
  return `${getFrontendBaseUrl()}/${path}/${encodeURIComponent(row.id)}/${encodeURIComponent(
    row.public_token,
  )}`;
}

const PORTAL_TABS = new Set<TabId>(['summary', 'stages', 'finance', 'documents', 'contacts', 'meetings']);

const MEETING_ACTION_CLASS =
  'inline-flex rounded-full bg-[#f4f5f8] px-3 py-1.5 text-xs font-medium text-[#1c1c22] hover:bg-[#eceef3]';

type WaitingItem = {
  id: string;
  label: string;
  actionLabel: string;
  href?: string;
  tab?: TabId;
};

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
  description: React.ReactNode;
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
      description: (
        <Trans
          i18nKey="dashboard.nextStep.paymentOverdue"
          values={{
            amount: nextPaymentTotal,
            date: formatDate(nextPayment.due_date, locale),
          }}
          components={{
            amount: <span className="font-semibold underline underline-offset-2" />,
            date: <span className="font-semibold underline underline-offset-2" />,
          }}
        />
      ),
      actionId: 'payOnline',
      href: buildPaymentPagePath(nextPayment.secure_token),
    };
  }

  if (nextPayment && nextPaymentTotal) {
    return {
      title: t('dashboard.nextStep.titleNext'),
      description: nextPayment.due_date ? (
        <Trans
          i18nKey="dashboard.nextStep.paymentUpcomingDated"
          values={{
            amount: nextPaymentTotal,
            date: formatDate(nextPayment.due_date, locale),
          }}
          components={{
            amount: <span className="font-semibold underline underline-offset-2" />,
            date: <span className="font-semibold underline underline-offset-2" />,
          }}
        />
      ) : (
        <Trans
          i18nKey="dashboard.nextStep.paymentUpcoming"
          values={{ amount: nextPaymentTotal }}
          components={{
            amount: <span className="font-semibold underline underline-offset-2" />,
          }}
        />
      ),
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
  const [playingVideoId, setPlayingVideoId] = useState<string | null>(null);
  const [neededDocs, setNeededDocs] = useState<PortalNeededDocument[]>([]);
  const [changes, setChanges] = useState<PortalNotificationRow[] | null>(null);
  const videoRowRef = useRef<HTMLDivElement>(null);
  const [canScrollVideosBack, setCanScrollVideosBack] = useState(false);
  const [canScrollVideosForward, setCanScrollVideosForward] = useState(true);

  const updateVideoArrows = () => {
    const row = videoRowRef.current;
    if (!row) return;
    setCanScrollVideosBack(row.scrollLeft > 8);
    setCanScrollVideosForward(row.scrollLeft + row.clientWidth < row.scrollWidth - 8);
  };

  const moveVideos = (direction: 1 | -1) => {
    const row = videoRowRef.current;
    if (!row) return;
    const card = row.querySelector('[data-video-card]') as HTMLElement | null;
    const amount = (card?.offsetWidth ?? 360) + 16;
    row.scrollBy({ left: amount * direction, behavior: 'smooth' });
  };

  useEffect(() => {
    updateVideoArrows();
    window.addEventListener('resize', updateVideoArrows);
    return () => window.removeEventListener('resize', updateVideoArrows);
  }, []);

  useEffect(() => {
    let cancelled = false;
    portalGetClientNeededDocuments()
      .then((rows) => {
        if (!cancelled) setNeededDocs(rows);
      })
      .catch(() => {
        if (!cancelled) setNeededDocs([]);
      });
    portalGetNotifications(3)
      .then((rows) => {
        if (!cancelled) setChanges(rows.slice(0, 3));
      })
      .catch(() => {
        if (!cancelled) setChanges([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
  const stageProgress = useMemo(() => {
    if (!subEfforts.length) return null;
    const total = subEfforts.length;
    const current = findCurrentPortalSubEffort(subEfforts);
    if (current) {
      const index = subEfforts.findIndex((row) => row.id === current.id);
      if (index >= 0) return { current: index + 1, total };
    }
    if (subEfforts.every((row) => row.active === false)) return { current: total, total };
    return null;
  }, [subEfforts]);
  const waitingItems = useMemo(() => {
    const items: WaitingItem[] = [];
    const poas = Object.values(data?.poasByContact ?? {}).flat();
    for (const poa of poas) {
      if (poa.status === 'signed' || poa.status === 'cancelled' || !poa.secure_token) continue;
      items.push({
        id: `poa-${poa.id}`,
        label: poa.type_name?.trim() || t('dashboard.waiting.poaFallback'),
        actionLabel: t('dashboard.waiting.sign'),
        href: buildPoaUrl(poa.secure_token),
      });
    }
    const contracts = Object.values(data?.contractsByContact ?? {}).flat();
    for (const contract of contracts) {
      if (contract.status === 'signed' || contract.status === 'cancelled' || !contract.public_token) continue;
      items.push({
        id: `contract-${contract.id}`,
        label: contract.title?.trim() || t('dashboard.waiting.contractFallback'),
        actionLabel: t('dashboard.waiting.sign'),
        href: buildContractUrl(contract),
      });
    }
    for (const doc of neededDocs) {
      items.push({
        id: `doc-${doc.id}`,
        label: doc.name,
        actionLabel: t('dashboard.waiting.upload'),
        tab: 'documents',
      });
    }
    return items.slice(0, 3);
  }, [data?.poasByContact, data?.contractsByContact, neededDocs, t]);
  const hasUnsignedDocuments = useMemo(() => {
    const poas = Object.values(data?.poasByContact ?? {}).flat();
    const contracts = Object.values(data?.contractsByContact ?? {}).flat();
    const unsignedPoa = poas.some(
      (poa) => poa.status !== 'signed' && poa.status !== 'cancelled' && Boolean(poa.secure_token),
    );
    const unsignedContract = contracts.some(
      (contract) =>
        contract.status !== 'signed' && contract.status !== 'cancelled' && Boolean(contract.public_token),
    );
    return unsignedPoa || unsignedContract;
  }, [data?.poasByContact, data?.contractsByContact]);
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
    <div className="space-y-12 md:space-y-16">
      <div className={`${PORTAL_DASHBOARD_CONTAINER} pt-1 md:pt-2`}>
        <p className="text-xl font-semibold tracking-tight text-[#16161d] md:text-2xl">
          {t('dashboard.greeting.withName', {
            greeting: portalGreeting(t),
            firstName: clientFirstName,
          })}
        </p>
        <p className="mt-1 text-sm font-medium text-[#8b909a] md:text-base">
          {t('dashboard.greeting.subtitle')}
        </p>
      </div>

      <section className={`space-y-8 md:space-y-12 ${PORTAL_DASHBOARD_CONTAINER}`}>
        <div className={`${MOBILE_CAROUSEL_ROW_CLASS} sm:grid sm:grid-cols-2 sm:items-start xl:grid-cols-3`}>
        <div className={MOBILE_CAROUSEL_ITEM_CLASS}>
          <PortalStatCard
            label={t('dashboard.stats.nextMeeting.label')}
            value={nextMeetingLabel}
            hint={meetingHint}
            icon={CalendarDaysIcon}
            accent="sky"
            coverKey={`${coverKey}::stat-next-meeting`}
            onClick={() => onNavigate('meetings')}
            action={
              nextMeeting && (nextMeeting.join_url || nextMeeting.meeting_date) ? (
                <>
                  {nextMeeting.join_url ? (
                    <a
                      href={nextMeeting.join_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={MEETING_ACTION_CLASS}
                    >
                      {t('dashboard.stats.nextMeeting.join')}
                    </a>
                  ) : null}
                  {nextMeeting.meeting_date ? (
                    <button
                      type="button"
                      className={MEETING_ACTION_CLASS}
                      onClick={() =>
                        downloadMeetingIcs(nextMeeting, t('dashboard.stats.nextMeeting.calendarTitle'))
                      }
                    >
                      {t('dashboard.stats.nextMeeting.addToCalendar')}
                    </button>
                  ) : null}
                </>
              ) : undefined
            }
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
                <span className="text-[11px] font-medium uppercase tracking-wide text-[#9a4a4a]">
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
            badge={
              stageProgress ? (
                <span className="text-[11px] font-medium tracking-wide text-[#8b909a]">
                  {t('dashboard.stats.caseStatus.progress', stageProgress)}
                </span>
              ) : undefined
            }
          />
        </div>
          </div>

          <div className={`${PORTAL_NEXT_STEP_CARD_CLASS} mt-2`}>
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-blue-100">{nextStep.title}</p>
              <p className="mt-1.5 text-sm font-medium leading-relaxed text-white md:text-base">{nextStep.description}</p>
            </div>
            {nextStepActionLabel ? (
              nextStep.href ? (
                <a
                  href={nextStep.href}
                  target={nextStep.href.startsWith('http') ? '_blank' : undefined}
                  rel={nextStep.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                  className="inline-flex shrink-0 items-center gap-2 self-start rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-blue-900 shadow-[0_8px_22px_rgba(15,23,42,0.16)] transition-all hover:-translate-y-0.5 hover:bg-blue-50 md:self-center"
                >
                  <NextStepIcon className="h-6 w-6" />
                  {nextStepActionLabel}
                </a>
              ) : (
                <button
                  type="button"
                  onClick={nextStep.onAction}
                  className="inline-flex shrink-0 items-center gap-2 self-start rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-blue-900 shadow-[0_8px_22px_rgba(15,23,42,0.16)] transition-all hover:-translate-y-0.5 hover:bg-blue-50 md:self-center"
                >
                  <NextStepIcon className="h-6 w-6" />
                  {nextStepActionLabel}
                </button>
              )
            ) : null}
          </div>

          {waitingItems.length > 0 || hasUnsignedDocuments ? (
          <div className="flex flex-col items-start gap-4 md:flex-row md:items-center" dir="ltr">
            {waitingItems.length > 0 ? (
              <div className="min-w-0" dir={locale.toLowerCase().startsWith('he') ? 'rtl' : 'ltr'}>
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#8b909a]">
                  {t('dashboard.waiting.title')}
                </p>
                <ul className="mt-3 flex flex-col items-start gap-2">
                  {waitingItems.map((item) => (
                    <li
                      key={item.id}
                      className="flex max-w-full items-center gap-3 rounded-full bg-white py-1.5 ps-4 pe-1.5 shadow-[0_8px_22px_rgba(22,22,29,0.06)]"
                    >
                      <p className="min-w-0 truncate text-sm text-[#1c1c22]">{item.label}</p>
                      {item.href ? (
                        <a
                          href={item.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex shrink-0 rounded-full bg-[#1c1c22] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#2a2a32]"
                        >
                          {item.actionLabel}
                        </a>
                      ) : (
                        <button
                          type="button"
                          onClick={() => item.tab && onNavigate(item.tab)}
                          className="inline-flex shrink-0 rounded-full bg-[#1c1c22] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#2a2a32]"
                        >
                          {item.actionLabel}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {hasUnsignedDocuments ? (
            <button
              type="button"
              onClick={() => onNavigate('contacts')}
              className="group flex w-full max-w-sm shrink-0 items-stretch overflow-hidden rounded-2xl bg-white text-start shadow-[0_10px_28px_rgba(22,22,29,0.06)] md:w-[22rem]"
            >
              <div
                dir={locale.toLowerCase().startsWith('he') ? 'rtl' : 'ltr'}
                className="flex min-w-0 flex-1 flex-col justify-center px-4 py-3"
              >
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#8b909a]">
                  {t('dashboard.contactsBanner.eyebrow')}
                </p>
                <p className="mt-1 text-sm leading-snug text-[#1c1c22]">
                  {t('dashboard.contactsBanner.body')}
                </p>
                <span className="mt-3 inline-flex w-fit items-center rounded-full bg-[#1c1c22] px-3 py-1.5 text-xs font-semibold text-white transition-colors group-hover:bg-[#2a2a32]">
                  {t('dashboard.contactsBanner.action')}
                </span>
              </div>
              <div className="relative w-[42%] shrink-0 self-stretch">
                <img
                  src="/portal-contacts-banner.jpg"
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover object-[center_20%]"
                />
              </div>
            </button>
            ) : null}
          </div>
          ) : null}
      </section>

      {roles.length > 0 ? (
      <div id="portal-legal-team" className={`flex flex-col gap-5 md:gap-6 ${PORTAL_DASHBOARD_CONTAINER}`}>
        <div className="flex flex-col gap-1">
          <h3 className="text-lg font-bold tracking-tight text-[#16161d]">{t('dashboard.team.title')}</h3>
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
        <div>
          <h4 className="text-lg font-bold tracking-tight text-[#16161d]">{t('dashboard.recentActivity.title')}</h4>
          {changes && changes.length > 0 ? (
            <ul className="mt-3 space-y-2.5">
              {changes.map((item) => {
                const title = notificationTitle(item, t, locale);
                const subtitle = notificationSubtitle(item, t, locale);
                const text = subtitle && subtitle !== title ? `${title} · ${subtitle}` : title;
                const tab = PORTAL_TABS.has(item.tab as TabId) ? (item.tab as TabId) : null;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="flex w-full items-start gap-2.5 text-left text-sm text-[#16161d] disabled:cursor-default"
                      disabled={!tab}
                      onClick={() => tab && onNavigate(tab)}
                    >
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#c5c8d0]" aria-hidden />
                      <span className="leading-relaxed">{text}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : recentActivity.length > 0 ? (
            <ul className="mt-3 space-y-2.5">
              {recentActivity.map((item) => (
                <li key={item.id} className="flex items-start gap-2.5 text-sm text-[#16161d]">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#c5c8d0]" aria-hidden />
                  <span className="leading-relaxed">{item.text}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-[#747684]">{t('dashboard.recentActivity.empty')}</p>
          )}
        </div>
      </div>

      <section className={PORTAL_DASHBOARD_CONTAINER}>
        <h2 className="text-lg font-bold tracking-tight text-[#16161d]">
          {t('dashboard.news.title')}
        </h2>
        <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-3">
          {PORTAL_NEWS.map((item) => (
            <article key={item.id} className="flex flex-col">
              <div className="overflow-hidden rounded-2xl">
                <img
                  src={item.image}
                  alt=""
                  className="h-44 w-full object-cover md:h-48"
                />
              </div>
              <div className="relative z-10 -mt-8 mx-3 rounded-2xl bg-white p-4 shadow-[0_12px_32px_rgba(22,22,29,0.08)] md:p-5">
                <h3 className="text-sm font-semibold leading-snug tracking-tight text-[#16161d]">
                  {t(`dashboard.news.items.${item.id}.title`)}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-[#747684]">
                  {t(`dashboard.news.items.${item.id}.body`)}
                </p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className={PORTAL_DASHBOARD_CONTAINER}>
        <div className="mx-auto max-w-4xl">
          <h2 className="text-2xl font-bold tracking-tight text-[#16161d] md:text-3xl">
            {t('dashboard.faq.title')}
          </h2>
          <div className="mt-6 divide-y divide-[rgba(20,20,30,0.08)]">
            {PORTAL_FAQ.map((item) => (
              <details key={item.id} className="group py-5 md:py-6">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-semibold text-[#16161d] md:text-lg [&::-webkit-details-marker]:hidden">
                  <span>{t(`dashboard.faq.items.${item.id}.question`)}</span>
                  <ChevronDownIcon className="h-5 w-5 shrink-0 text-[#747684] transition-transform group-open:rotate-180" />
                </summary>
                <p className="mt-3 max-w-3xl text-base leading-relaxed text-[#747684]">
                  {t(`dashboard.faq.items.${item.id}.answer`)}
                </p>
                <button
                  type="button"
                  className="mt-4 inline-flex items-center rounded-full bg-blue-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-950"
                  onClick={() => {
                    if (item.tab) onNavigate(item.tab);
                    if (item.anchor) {
                      document.getElementById(item.anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                  }}
                >
                  {t(`dashboard.faq.items.${item.id}.action`)}
                </button>
              </details>
            ))}
          </div>
        </div>
      </section>

      <div className={`${PORTAL_DASHBOARD_CONTAINER} flex justify-center`}>
        <a
          href="https://lawoffice.org.il/en/"
          target="_blank"
          rel="noopener noreferrer"
          className="group relative flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-gradient-to-br from-[#1e40af] via-[#1e3a8a] to-[#0b1f4d] text-white shadow-[0_18px_45px_rgba(30,58,138,0.28)] transition-shadow hover:shadow-[0_22px_50px_rgba(30,58,138,0.36)] md:min-h-[220px] md:flex-row"
        >
          <div className={`relative z-10 flex flex-1 flex-col justify-center px-6 py-6 md:px-8 ${locale.toLowerCase().startsWith('he') ? 'md:ml-auto md:w-[58%] md:flex-none' : 'md:max-w-[58%]'}`}>
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-blue-100">
              {t('dashboard.websiteBanner.eyebrow')}
            </p>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-blue-100">
              {t('dashboard.websiteBanner.body')}
            </p>
            <span className="mt-4 inline-flex w-fit items-center gap-2 rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-blue-900 transition-colors group-hover:bg-blue-50">
              {t('dashboard.websiteBanner.action')}
            </span>
          </div>
          <div className={`relative h-52 w-full md:absolute md:inset-y-0 md:h-full md:w-[42%] ${locale.toLowerCase().startsWith('he') ? 'md:left-0' : 'md:right-0'}`}>
            <img
              src="/portal-lawyer-commercial.jpg"
              alt=""
              className="h-full w-full object-cover object-[center_15%]"
            />
            <div className={`pointer-events-none absolute inset-y-0 hidden w-24 md:block ${locale.toLowerCase().startsWith('he') ? 'right-0 bg-gradient-to-l from-[#1e3a8a] to-transparent' : 'left-0 bg-gradient-to-r from-[#1e3a8a] to-transparent'}`} />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#0b1f4d] via-transparent to-transparent md:hidden" />
          </div>
        </a>
      </div>

      <section className="-mx-2 w-[calc(100%+1rem)] md:-mx-10 md:w-[calc(100%+5rem)]">
        <div className="bg-white px-4 py-5 shadow-[0_12px_32px_rgba(22,22,29,0.06)] md:px-10 md:py-7">
        <h2 className="text-2xl font-bold tracking-tight text-[#16161d] md:text-3xl">
          {t('dashboard.videos.title')}
        </h2>
        <div className="mt-6 flex flex-col gap-6 md:flex-row md:items-center md:gap-3" dir="ltr">
          <button
            type="button"
            className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#f4f5f8] text-blue-900 transition-opacity disabled:opacity-30 md:inline-flex"
            aria-label={t('dashboard.videos.previous')}
            disabled={!canScrollVideosBack}
            onClick={() => moveVideos(-1)}
          >
            <ChevronLeftIcon className="h-5 w-5" />
          </button>
          <div
            ref={videoRowRef}
            onScroll={updateVideoArrows}
            className="flex min-w-0 flex-1 flex-col gap-6 md:snap-x md:snap-mandatory md:flex-row md:gap-4 md:overflow-x-auto md:scroll-smooth scrollbar-hide"
          >
          {PORTAL_VIDEOS.map((video) => (
            <article
              key={video.id}
              data-video-card
              className="w-full shrink-0 md:w-[min(88vw,32rem)] md:snap-start"
            >
              <div className="relative aspect-video overflow-hidden rounded-2xl bg-[#0b1f4d]">
                {playingVideoId === video.id ? (
                  <iframe
                    src={`https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1`}
                    title={video.title}
                    className="h-full w-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                  />
                ) : (
                  <button
                    type="button"
                    className="group relative h-full w-full"
                    onClick={() => setPlayingVideoId(video.id)}
                    aria-label={t('dashboard.videos.play', { title: video.title })}
                  >
                    <img
                      src={`https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                    <span className="absolute inset-0 bg-[#0b1f4d]/20 transition-colors group-hover:bg-[#0b1f4d]/35" />
                    <span className="pointer-events-none absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-[#FF0000] px-2.5 py-1 text-[11px] font-bold text-white shadow-md">
                      <FaYoutube className="h-4 w-4" aria-hidden />
                      YouTube
                    </span>
                    <span className="absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-blue-900 shadow-lg">
                      <PlayIcon className="ml-0.5 h-7 w-7" />
                    </span>
                  </button>
                )}
              </div>
              <p className="px-1 pb-1 pt-3 text-base font-semibold leading-snug text-[#16161d]">{video.title}</p>
            </article>
          ))}
          </div>
          <button
            type="button"
            className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#f4f5f8] text-blue-900 transition-opacity disabled:opacity-30 md:inline-flex"
            aria-label={t('dashboard.videos.next')}
            disabled={!canScrollVideosForward}
            onClick={() => moveVideos(1)}
          >
            <ChevronRightIcon className="h-5 w-5" />
          </button>
        </div>
        </div>
      </section>

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
