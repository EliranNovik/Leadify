import React, { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from 'react';
import Meetings from './Meetings';
import OverdueFollowups from './OverdueFollowups';
import UnavailableEmployeesModal from './UnavailableEmployeesModal';
import TeamStatusModal from './TeamStatusModal';
import ClockInBox from './ClockInBox';

// Lazy load bottom components for faster initial render
const WaitingForPriceOfferMyLeadsWidget = lazy(() => import('./WaitingForPriceOfferMyLeadsWidget'));
const ClosedDealsWithoutPaymentPlanWidget = lazy(() => import('./ClosedDealsWithoutPaymentPlanWidget'));
const NewHandlerCasesWidget = lazy(() => import('./NewHandlerCasesWidget'));
import { UserGroupIcon, CalendarIcon, ExclamationTriangleIcon, ChatBubbleLeftRightIcon, ArrowTrendingUpIcon, ChartBarIcon, ChevronLeftIcon, ChevronRightIcon, ChevronDownIcon, ChevronUpIcon, XMarkIcon, ClockIcon, MagnifyingGlassIcon, FunnelIcon, CheckCircleIcon, PlusIcon, ArrowPathIcon, VideoCameraIcon, PhoneIcon, EnvelopeIcon, DocumentTextIcon, PencilSquareIcon, TrashIcon, Squares2X2Icon, TableCellsIcon, FaceFrownIcon, SunIcon, CalendarDaysIcon } from '@heroicons/react/24/outline';
import { supabase, isAuthError, tryRefreshThenExpire, authRetryQueryOnce } from '../lib/supabase';
import { useAuthContext } from '../contexts/AuthContext';
import { useOptionalClockInGate } from '../hooks/useClockInGate';
import { resolveSessionUser } from '../lib/resolveSessionUser';
import { getCurrencySymbol } from '../lib/currencyConversion';
import {
  resolvePaymentPlanBoiAsOfInput,
  createBoiDateRateConverter,
  buildCurrencyMetaFromId,
} from '../lib/boiCurrencyConversion';
import {
  fetchStage60RecordsInRange,
  getJerusalemScoreboardDates,
  resolveStage60SignTimestamp,
  toSignCalendarDateKey,
} from '../lib/stage60SignDate';
import {
  applyDashboardCostTargetsToDepartments,
  departmentScoreboardExpected,
  fetchDashboardDepartmentCostTargets,
  fetchDashboardOtherColumnCostTarget,
  otherScoreboardExpected,
} from '../lib/dashboardDepartmentCostTargets';
import { PieChart as RechartsPieChart, Pie, Cell } from 'recharts';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceDot, ReferenceArea, BarChart, Bar, Legend as RechartsLegend, CartesianGrid } from 'recharts';
import { RadialBarChart, RadialBar, PolarAngleAxis, Legend } from 'recharts';
import { useMsal } from '@azure/msal-react';
import { DateTime } from 'luxon';
import { FaWhatsapp } from 'react-icons/fa';
import { useNavigate, useLocation } from 'react-router-dom';
import { getCachedData, setCachedData } from '../utils/dataCache';
import { getStageName } from '../lib/stageUtils';
import EmployeeScoreboard from './EmployeeScoreboard';
import { formatMeetingValue } from '../lib/meetingValue';
import { toast } from 'react-hot-toast';
import CompactAvailabilityCalendar, { CompactAvailabilityCalendarRef } from './CompactAvailabilityCalendar';
import SickDaysDocumentUploadModal from './SickDaysDocumentUploadModal';
import MyContribution from './MyContribution';
import { DocumentArrowUpIcon } from '@heroicons/react/24/outline';
import { employeeHasAnySalesRoleOnLeadBundle } from '../utils/rolePercentageCalculator';
import { useRefetchOnVisible } from '../hooks/useRefetchOnVisible';
import { getMobileAwareCacheTtlMs } from '../lib/mobileCache';

import { resolveCategoryAndDepartment, shouldUseScoreboardOtherColumn } from '../lib/resolveCategoryDepartment';
import { hasDashboardWelcomePending } from '../lib/dashboardWelcomeSession';
import { useReportDashboardWelcomeReady } from '../contexts/DashboardWelcomeReadyContext';
import DashboardScoreboardDealsModal, {
  appendScoreboardDeal,
  scoreboardDealsCellKey,
  type DashboardScoreboardDeal,
} from './DashboardScoreboardDealsModal';

function getDashboardScoreboardCacheTtlMs(): number {
  return getMobileAwareCacheTtlMs(10 * 60 * 1000, 2 * 60 * 1000);
}

function getDashboardTeamAvailabilityCacheTtlMs(): number {
  return getMobileAwareCacheTtlMs(5 * 60 * 1000, 90_000);
}

/** Virtual column for leads/payments outside the main scoreboard departments. */
const SCOREBOARD_OTHER_COLUMN = 'Other';

function dedupeRowsById<T extends { id?: string | number | null }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    if (row?.id == null) continue;
    const id = String(row.id);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(row);
  }
  return out;
}

function parsePaymentDuePercent(value: unknown): number {
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  if (typeof value === 'string') {
    const n = parseFloat(value.replace(/%/g, '').trim());
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

function normalizeInvoicedCurrency(raw: unknown): string {
  let c = (raw != null && String(raw).trim() !== '' ? String(raw) : 'NIS').trim();
  if (c === '₪') return 'NIS';
  if (c === '€') return 'EUR';
  if (c === '$') return 'USD';
  if (c === '£') return 'GBP';
  return c;
}

/** Allocate lead subcontractor fee onto one payment row (prefer due_percent, else amount share). */
function allocateInvoicedSubcontractorFeeNis(params: {
  feeTotalNis: number;
  rowAmountNis: number;
  leadPlanTotalNis: number;
  duePercent: number;
}): number {
  const fee = params.feeTotalNis || 0;
  if (fee <= 0) return 0;
  if (params.duePercent > 0) return fee * (params.duePercent / 100);
  if (params.leadPlanTotalNis > 0) return fee * (params.rowAmountNis / params.leadPlanTotalNis);
  return 0;
}

function getScoreboardPeriodColumnName(
  deptIndex: number,
  departmentTargets: { name?: string }[],
): string | null {
  if (deptIndex >= 1 && deptIndex <= departmentTargets.length) {
    return String(departmentTargets[deptIndex - 1]?.name || '');
  }
  if (deptIndex === departmentTargets.length + 1) return SCOREBOARD_OTHER_COLUMN;
  return null;
}

function getScoreboardMonthColumnName(
  deptIndex: number,
  departmentTargets: { name?: string }[],
): string | null {
  if (deptIndex >= 0 && deptIndex < departmentTargets.length) {
    return String(departmentTargets[deptIndex]?.name || '');
  }
  if (deptIndex === departmentTargets.length) return SCOREBOARD_OTHER_COLUMN;
  return null;
}

function leadDisplayName(lead: any): string {
  if (!lead) return '';
  if (typeof lead.name === 'string' && lead.name.trim()) return lead.name.trim();
  const first = typeof lead.first_name === 'string' ? lead.first_name.trim() : '';
  const last = typeof lead.last_name === 'string' ? lead.last_name.trim() : '';
  return [first, last].filter(Boolean).join(' ');
}

function leadDisplayNumber(lead: any, isNewLead?: boolean): string {
  if (!lead) return '';
  if (lead.lead_number != null && String(lead.lead_number).trim()) return String(lead.lead_number);
  if (lead.display_lead_number != null && String(lead.display_lead_number).trim()) {
    return String(lead.display_lead_number);
  }
  return isNewLead ? `L${lead.id}` : String(lead.id ?? '');
}

function leadCategoryLabel(lead: any): string {
  const misc = Array.isArray(lead?.misc_category) ? lead.misc_category[0] : lead?.misc_category;
  const subName = (misc?.name || lead?.category || '').toString().trim();
  const main = Array.isArray(misc?.misc_maincategory)
    ? misc.misc_maincategory[0]
    : misc?.misc_maincategory;
  const mainName = (main?.name || '').toString().trim();
  if (mainName && subName) return `${mainName} > ${subName}`;
  return mainName || subName || '—';
}

function unwrapEmployeeRel(rel: any): { id?: number | string; display_name?: string; photo_url?: string | null; photo?: string | null } | null {
  if (!rel) return null;
  return Array.isArray(rel) ? rel[0] || null : rel;
}

function employeePhotoUrl(emp: { photo_url?: string | null; photo?: string | null } | null | undefined): string | null {
  if (!emp) return null;
  const url = (emp.photo_url || emp.photo || '').toString().trim();
  return url || null;
}

/** Extract closer (agreement) or handler (invoiced) display fields from a lead row. */
function leadRoleFields(
  lead: any,
  kind: 'closer' | 'handler',
): { roleName: string; roleEmployeeId: string | null; rolePhotoUrl: string | null } {
  if (!lead) return { roleName: '', roleEmployeeId: null, rolePhotoUrl: null };

  if (kind === 'closer') {
    const closerEmp = unwrapEmployeeRel(lead.closer_employee);
    if (closerEmp?.display_name || closerEmp?.id) {
      return {
        roleName: (closerEmp.display_name || '').trim(),
        roleEmployeeId: closerEmp.id != null ? String(closerEmp.id) : (lead.closer_id != null ? String(lead.closer_id) : null),
        rolePhotoUrl: employeePhotoUrl(closerEmp),
      };
    }
    if (lead.closer_id != null && String(lead.closer_id).trim() !== '') {
      return { roleName: '', roleEmployeeId: String(lead.closer_id), rolePhotoUrl: null };
    }
    const closerRaw = lead.closer != null ? String(lead.closer).trim() : '';
    if (/^\d+$/.test(closerRaw)) {
      return { roleName: '', roleEmployeeId: closerRaw, rolePhotoUrl: null };
    }
    return { roleName: closerRaw, roleEmployeeId: null, rolePhotoUrl: null };
  }

  const handlerEmp = unwrapEmployeeRel(lead.handler_employee) || unwrapEmployeeRel(lead.case_handler);
  if (handlerEmp?.display_name || handlerEmp?.id) {
    return {
      roleName: (handlerEmp.display_name || '').trim(),
      roleEmployeeId:
        handlerEmp.id != null
          ? String(handlerEmp.id)
          : lead.case_handler_id != null
            ? String(lead.case_handler_id)
            : null,
      rolePhotoUrl: employeePhotoUrl(handlerEmp),
    };
  }
  if (lead.case_handler_id != null && String(lead.case_handler_id).trim() !== '') {
    return { roleName: '', roleEmployeeId: String(lead.case_handler_id), rolePhotoUrl: null };
  }
  const handlerRaw = lead.handler != null ? String(lead.handler).trim() : '';
  if (/^\d+$/.test(handlerRaw)) {
    return { roleName: '', roleEmployeeId: handlerRaw, rolePhotoUrl: null };
  }
  return { roleName: handlerRaw, roleEmployeeId: null, rolePhotoUrl: null };
}

async function enrichScoreboardDealRolePhotos(
  store: Map<string, DashboardScoreboardDeal[]>,
): Promise<void> {
  const deals = Array.from(store.values()).flat();
  if (deals.length === 0) return;

  const ids = new Set<number>();
  const names = new Set<string>();
  for (const deal of deals) {
    if (deal.rolePhotoUrl && deal.roleName) continue;
    if (deal.roleEmployeeId && /^\d+$/.test(deal.roleEmployeeId)) {
      ids.add(Number(deal.roleEmployeeId));
    } else if ((deal.roleName || '').trim()) {
      names.add(deal.roleName!.trim());
    }
  }

  const byId = new Map<string, { name: string; photoUrl: string | null }>();
  const byName = new Map<string, { name: string; photoUrl: string | null }>();

  const idList = Array.from(ids);
  for (let i = 0; i < idList.length; i += 500) {
    const chunk = idList.slice(i, i + 500);
    const { data, error } = await supabase
      .from('tenants_employee')
      .select('id, display_name, photo_url, photo')
      .in('id', chunk);
    if (error) {
      console.error('[Dashboard] role employee enrichment by id failed:', error);
      continue;
    }
    for (const emp of data || []) {
      const entry = {
        name: String(emp.display_name || '').trim(),
        photoUrl: employeePhotoUrl(emp),
      };
      byId.set(String(emp.id), entry);
      if (entry.name) byName.set(entry.name.toLowerCase(), entry);
    }
  }

  const nameList = Array.from(names).filter((n) => !byName.has(n.toLowerCase()));
  for (let i = 0; i < nameList.length; i += 200) {
    const chunk = nameList.slice(i, i + 200);
    const { data, error } = await supabase
      .from('tenants_employee')
      .select('id, display_name, photo_url, photo')
      .in('display_name', chunk);
    if (error) {
      console.error('[Dashboard] role employee enrichment by name failed:', error);
      continue;
    }
    for (const emp of data || []) {
      const entry = {
        name: String(emp.display_name || '').trim(),
        photoUrl: employeePhotoUrl(emp),
      };
      byId.set(String(emp.id), entry);
      if (entry.name) byName.set(entry.name.toLowerCase(), entry);
    }
  }

  for (const deal of deals) {
    const fromId = deal.roleEmployeeId ? byId.get(deal.roleEmployeeId) : undefined;
    const fromName = deal.roleName ? byName.get(deal.roleName.trim().toLowerCase()) : undefined;
    const match = fromId || fromName;
    if (!match) continue;
    if (!deal.roleName && match.name) deal.roleName = match.name;
    if (!deal.rolePhotoUrl && match.photoUrl) deal.rolePhotoUrl = match.photoUrl;
  }
}

/** Scoreboard period after Last 30d (toggled via Filter by → Last 3m). Displayed as monthly average. */
const SCOREBOARD_LAST_3M = 'Last 3m';
/** Months in the Last 3m averaging window. */
const SCOREBOARD_LAST_3M_MONTHS = 3;

const createEmptyScoreboardRow = () => ({ count: 0, amount: 0, expected: 0 });

/** Monthly average for a 3-month rolling window total. */
function scoreboardThreeMonthAverage(totalAmount: number): number {
  return (totalAmount || 0) / SCOREBOARD_LAST_3M_MONTHS;
}

/** Calendar start date for rolling “Last 3 months” (ISO YYYY-MM-DD). */
function getLast3MonthsStartDate(todayStr: string): string {
  return DateTime.fromISO(todayStr, { zone: 'utc' }).minus({ months: 3 }).toISODate() || todayStr;
}

/** Today / Week / Last 30d row index (index 0 = General). */
function getScoreboardPeriodDeptIndex(
  departmentId: number | null | undefined,
  departmentIds: number[],
  mainCategoryId?: number | null,
  mainCategoryName?: string | null,
): number {
  if (
    shouldUseScoreboardOtherColumn({
      departmentId,
      departmentIds,
      mainCategoryId,
      mainCategoryName,
    })
  ) {
    return departmentIds.length + 1;
  }
  return departmentIds.indexOf(Number(departmentId)) + 1;
}

/** Month row index (no General column). */
function getScoreboardMonthDeptIndex(
  departmentId: number | null | undefined,
  departmentIds: number[],
  mainCategoryId?: number | null,
  mainCategoryName?: string | null,
): number {
  if (
    shouldUseScoreboardOtherColumn({
      departmentId,
      departmentIds,
      mainCategoryId,
      mainCategoryName,
    })
  ) {
    return departmentIds.length;
  }
  return departmentIds.indexOf(Number(departmentId));
}

function buildScoreboardPeriodRows(departmentTargets: any[], otherExpected = 0) {
  return [
    createEmptyScoreboardRow(),
    ...departmentTargets.map((dept) => ({
      count: 0,
      amount: 0,
      expected: departmentScoreboardExpected(dept),
    })),
    { count: 0, amount: 0, expected: otherExpected },
    createEmptyScoreboardRow(),
  ];
}

function buildScoreboardMonthRows(departmentTargets: any[], otherExpected = 0) {
  return [
    ...departmentTargets.map((dept) => ({
      count: 0,
      amount: 0,
      expected: departmentScoreboardExpected(dept),
    })),
    { count: 0, amount: 0, expected: otherExpected },
    createEmptyScoreboardRow(),
  ];
}

function getScoreboardTotalIndexes(departmentCount: number) {
  return {
    otherIndexToday: departmentCount + 1,
    totalIndexToday: departmentCount + 2,
    otherIndexMonth: departmentCount,
    totalIndexMonth: departmentCount + 1,
  };
}

type DashboardScoreboardRow = { count: number; amount: number; expected: number };
type DashboardScoreboardData = {
  Today: DashboardScoreboardRow[];
  'Last 30d': DashboardScoreboardRow[];
  [key: string]: DashboardScoreboardRow[];
};

type DashboardScoreboardCache = {
  agreementData: DashboardScoreboardData;
  invoicedData: DashboardScoreboardData;
  departmentNames: string[];
  departmentChartData: { [category: string]: { date: string; contracts: number; amount: number }[] };
  fetchedAt: number;
};

type DashboardTeamAvailabilityCache = {
  unavailableEmployeesData: any[];
  groupedUnavailableData: { sick_days: any[]; vacation: any[]; general: any[] };
  unavailableEmployeesCount: number;
  currentlyUnavailableCount: number;
  scheduledTimeOffCount: number;
  availableDepartments: string[];
  fetchedAt: number;
};

// My Availability Section Component
const MyAvailabilitySection: React.FC<{ onAvailabilityChange?: () => void; onOpenUploadDocs?: () => void }> = ({ onAvailabilityChange, onOpenUploadDocs }) => {
  const calendarRef = React.useRef<CompactAvailabilityCalendarRef>(null);

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">My Availability</h3>
        <div className="flex items-center gap-2">
          {onOpenUploadDocs && (
            <button
              onClick={onOpenUploadDocs}
              className="btn btn-sm btn-outline btn-circle"
              title="Upload Docs"
            >
              <DocumentArrowUpIcon className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => {
              calendarRef.current?.openAddRangeModal();
            }}
            className="btn btn-sm btn-primary btn-circle"
            title="Add Range"
          >
            <PlusIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
      <CompactAvailabilityCalendar ref={calendarRef} onAvailabilityChange={onAvailabilityChange} />
    </>
  );
};

const Dashboard: React.FC = () => {
  // Get auth state from context to skip redundant checks
  const { user: authUser, isInitialized } = useAuthContext();
  const clockInGate = useOptionalClockInGate();

  const resolveDashboardAuthUser = useCallback(
    () => resolveSessionUser(authUser, tryRefreshThenExpire),
    [authUser],
  );

  // Check if alternative (green) theme is active - make it reactive
  const [isAltTheme, setIsAltTheme] = useState(() => document.documentElement.classList.contains('theme-alt'));
  const [isDark2Theme, setIsDark2Theme] = useState(() => document.documentElement.classList.contains('theme-dark2'));

  useEffect(() => {
    const checkTheme = () => {
      const root = document.documentElement;
      setIsAltTheme(root.classList.contains('theme-alt'));
      setIsDark2Theme(root.classList.contains('theme-dark2'));
    };

    // Check on mount
    checkTheme();

    // Watch for theme changes via MutationObserver
    const observer = new MutationObserver(checkTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    // Listen to custom theme change event
    const handleThemeChange = (e: CustomEvent) => {
      setTimeout(checkTheme, 50);
    };
    window.addEventListener('themechange', handleThemeChange as EventListener);

    // Also listen to storage changes (cross-tab)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'theme') {
        setTimeout(checkTheme, 100);
      }
    };
    window.addEventListener('storage', handleStorageChange);

    return () => {
      observer.disconnect();
      window.removeEventListener('themechange', handleThemeChange as EventListener);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  // Get the current month name
  const currentMonthName = new Date().toLocaleString('en-US', { month: 'long' });

  // State for summary numbers
  const [meetingsToday, setMeetingsToday] = useState(0);
  const [overdueFollowups, setOverdueFollowups] = useState(0);
  const [latestMessages, setLatestMessages] = useState<any[]>([]);
  /** Superuser only: latest messages across all leads (no role filter). */
  const [latestMessagesAllLeads, setLatestMessagesAllLeads] = useState<any[]>([]);
  const [dashboardIsSuperuser, setDashboardIsSuperuser] = useState(false);

  // State for expanded sections
  const [expanded, setExpanded] = useState<'meetings' | 'overdue' | 'messages' | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const reportWelcomeReady = useReportDashboardWelcomeReady();
  const [leads, setLeads] = useState<any[]>([]);
  const [meetings, setMeetings] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [isUnavailableEmployeesModalOpen, setIsUnavailableEmployeesModalOpen] = useState(false);
  const [isMyAvailabilityModalOpen, setIsMyAvailabilityModalOpen] = useState(false);
  const [isSickDaysUploadModalOpen, setIsSickDaysUploadModalOpen] = useState(false);
  const [isTeamStatusModalOpen, setIsTeamStatusModalOpen] = useState(false);
  const [unavailableEmployeesCount, setUnavailableEmployeesCount] = useState(0);
  const [currentlyUnavailableCount, setCurrentlyUnavailableCount] = useState(0);
  const [scheduledTimeOffCount, setScheduledTimeOffCount] = useState(0);
  const [unavailableEmployeesData, setUnavailableEmployeesData] = useState<any[]>([]);
  const [unavailableEmployeesLoading, setUnavailableEmployeesLoading] = useState(false);
  const [groupedUnavailableData, setGroupedUnavailableData] = useState<{
    sick_days: any[];
    vacation: any[];
    general: any[];
  }>({
    sick_days: [],
    vacation: [],
    general: []
  });
  // Date filter for team availability (default to today)
  const [teamAvailabilityDate, setTeamAvailabilityDate] = useState<string>(() => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  });
  // Department filter for team availability
  const [departmentFilter, setDepartmentFilter] = useState<string>('');
  const [availableDepartments, setAvailableDepartments] = useState<string[]>([]);
  // State for expanded employee unavailability cards
  const [expandedEmployeeCards, setExpandedEmployeeCards] = useState<Set<number>>(new Set());
  const navigate = useNavigate();
  // Map of meeting location name -> default_link (from tenants_meetinglocation)
  const [meetingLocationLinks, setMeetingLocationLinks] = useState<Record<string, string>>({});

  // 1. Add state for real signed leads
  const [realSignedLeads, setRealSignedLeads] = useState<any[]>([]);
  const [realLeadsLoading, setRealLeadsLoading] = useState(false);

  // State for real performance data
  const [realPerformanceData, setRealPerformanceData] = useState<any[]>([]);
  const [realTeamAverageData, setRealTeamAverageData] = useState<any[]>([]);
  const [performanceLoading, setPerformanceLoading] = useState(false);
  const [currentUserEmployeeId, setCurrentUserEmployeeId] = useState<number | null>(() => {
    try {
      const v = localStorage.getItem('_clockin_emp_id');
      return v ? parseInt(v, 10) : null;
    } catch {
      return null;
    }
  });

  const setAndCacheEmployeeId = useCallback((id: number) => {
    setCurrentUserEmployeeId(id);
    try { localStorage.setItem('_clockin_emp_id', String(id)); } catch { /* noop */ }
  }, []);

  useEffect(() => {
    if (clockInGate?.adminBypassActive && clockInGate.employeeId != null) {
      setAndCacheEmployeeId(clockInGate.employeeId);
    }
  }, [clockInGate?.adminBypassActive, clockInGate?.employeeId, setAndCacheEmployeeId]);
  const [currentUserFullName, setCurrentUserFullName] = useState<string>('');

  // 1. Add state for real overdue leads
  const [realOverdueLeads, setRealOverdueLeads] = useState<any[]>([]);
  const [overdueLeadsLoading, setOverdueLeadsLoading] = useState(false);

  const location = useLocation();
  const dashboardPathname = location.pathname || '/';
  const realtimeRefreshTimerRef = useRef<number | null>(null);
  const [scoreboardRefreshToken, setScoreboardRefreshToken] = useState(0);
  const [teamAvailabilityRefreshToken, setTeamAvailabilityRefreshToken] = useState(0);
  const dashboardLastResumeRef = useRef(0);

  useRefetchOnVisible({
    enabled: location.pathname === '/' || location.pathname === '/dashboard',
    staleMs: getMobileAwareCacheTtlMs(2 * 60 * 1000, 45_000),
    lastFetchedAtRef: dashboardLastResumeRef,
    onRefetch: () => {
      setScoreboardRefreshToken((t) => t + 1);
      setTeamAvailabilityRefreshToken((t) => t + 1);
    },
  });

  // State for "Show More" functionality
  const [showAllOverdueLeads, setShowAllOverdueLeads] = useState(false);
  const [allOverdueLeads, setAllOverdueLeads] = useState<any[]>([]);
  const [loadingMoreLeads, setLoadingMoreLeads] = useState(false);
  const [overdueCountFetched, setOverdueCountFetched] = useState(false);

  // State for follow-ups tabs and view mode
  const [followUpTab, setFollowUpTab] = useState<'today' | 'overdue' | 'tomorrow' | 'future'>('today');
  const [followUpViewMode, setFollowUpViewMode] = useState<'table' | 'card'>(() => {
    // Default to table on desktop, card on mobile
    if (typeof window !== 'undefined') {
      return window.innerWidth >= 768 ? 'table' : 'card';
    }
    return 'table';
  });
  const [todayFollowUps, setTodayFollowUps] = useState<any[]>([]);
  const [tomorrowFollowUps, setTomorrowFollowUps] = useState<any[]>([]);
  const [futureFollowUps, setFutureFollowUps] = useState<any[]>([]);
  const [futureFollowUpsLoading, setFutureFollowUpsLoading] = useState(false);
  const [todayFollowUpsLoading, setTodayFollowUpsLoading] = useState(false);
  const [tomorrowFollowUpsLoading, setTomorrowFollowUpsLoading] = useState(false);
  const [editingFollowUpId, setEditingFollowUpId] = useState<string | number | null>(null);
  const [editFollowUpDate, setEditFollowUpDate] = useState<string>('');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Skip redundant auth check - ProtectedRoute already handles authentication
  // Just rely on AuthContext state for faster page loads
  // isInitialized is checked directly in render below

  // Eagerly fetch the employee ID so ClockInBox renders immediately on mount
  // without waiting for the heavy meetings / performance data fetches.
  useEffect(() => {
    if (!authUser?.id || currentUserEmployeeId != null) return;
    void (async () => {
      try {
        const { data } = await supabase
          .from('users')
          .select('employee_id')
          .eq('auth_id', authUser.id)
          .maybeSingle();
        if (data?.employee_id != null) {
          setAndCacheEmployeeId(data.employee_id);
        }
      } catch {
        // non-critical; the heavy fetches will also set this as a fallback
      }
    })();
  }, [authUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch meeting locations and their default links for join buttons
  // DEFERRED: Load after initial render
  useEffect(() => {
    // Defer to next tick to allow initial render
    const timeoutId = setTimeout(() => {
      const fetchMeetingLocations = async () => {
        try {
          const { data, error } = await authRetryQueryOnce(() =>
            supabase.from('tenants_meetinglocation').select('name, default_link')
          );

          if (error) {
            return;
          }

          const map: Record<string, string> = {};
          (data || []).forEach((loc: any) => {
            if (loc.name && loc.default_link) {
              map[loc.name] = loc.default_link;
            }
          });
          setMeetingLocationLinks(map);
        } catch (err) {
        }
      };

      fetchMeetingLocations();
    }, 0);
    return () => clearTimeout(timeoutId);
  }, []);

  // Fetch detailed unavailable employees data for table
  // Helper function to map role codes to display names
  // Helper function to get today's date string in YYYY-MM-DD format
  const getTodayDateString = (): string => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Helper function to format the date description for display
  const getDateDescription = (dateString: string): string => {
    if (dateString === getTodayDateString()) {
      return 'today';
    }
    const date = new Date(dateString + 'T00:00:00');
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const getRoleDisplayName = (roleCode: string | null | undefined): string => {
    if (!roleCode) return 'N/A';

    const roleMap: { [key: string]: string } = {
      'c': 'Closer',
      's': 'Scheduler',
      'h': 'Handler',
      'n': 'No role',
      'e': 'Expert',
      'z': 'Manager',
      'Z': 'Manager',
      'p': 'Partner',
      'm': 'Manager',
      'dm': 'Department Manager',
      'pm': 'Project Manager',
      'se': 'Secretary',
      'b': 'Book keeper',
      'partners': 'Partners',
      'dv': 'Developer',
      'ma': 'Marketing',
      'P': 'Partner',
      'M': 'Manager',
      'DM': 'Department Manager',
      'PM': 'Project Manager',
      'SE': 'Secretary',
      'B': 'Book keeper',
      'Partners': 'Partners',
      'd': 'Diverse',
      'f': 'Finance',
      'col': 'Collection',
      'lawyer': 'Helper Closer'
    };

    return roleMap[roleCode] || roleCode || 'N/A';
  };

  // Helper function to format time string to remove seconds (e.g., "09:00:00" -> "09:00")
  const formatTimeString = (timeStr: string): string => {
    if (!timeStr) return '';
    // If time includes seconds (HH:MM:SS), remove them
    if (timeStr.length === 8 && timeStr.includes(':')) {
      return timeStr.substring(0, 5); // Return HH:MM
    }
    return timeStr; // Already in HH:MM format or invalid
  };

  const fetchUnavailableEmployeesData = async (selectedDate?: string) => {
    setUnavailableEmployeesLoading(true);
    try {
      // Use provided date or default to today
      const dateToUse = selectedDate || teamAvailabilityDate;
      const selectedDateObj = new Date(dateToUse);
      const year = selectedDateObj.getFullYear();
      const month = String(selectedDateObj.getMonth() + 1).padStart(2, '0');
      const day = String(selectedDateObj.getDate()).padStart(2, '0');
      const selectedDateString = `${year}-${month}-${day}`;

      // Also get today's date for "currently active" comparison
      const today = new Date();
      const todayYear = today.getFullYear();
      const todayMonth = String(today.getMonth() + 1).padStart(2, '0');
      const todayDay = String(today.getDate()).padStart(2, '0');
      const todayString = `${todayYear}-${todayMonth}-${todayDay}`;

      // Fetch from both sources: employee_unavailability_reasons table AND tenants_employee table
      const [reasonsResult, employeesResult] = await Promise.all([
        supabase
          .from('employee_unavailability_reasons')
          .select(`
            id,
            employee_id,
            unavailability_type,
            start_date,
            end_date,
            start_time,
            end_time,
            sick_days_reason,
            vacation_reason,
            general_reason,
            created_at,
            approved,
            declined,
            tenants_employee!employee_id(
              id,
              display_name,
              bonuses_role,
              department_id,
              photo_url,
              photo,
              tenant_departement!department_id(id, name)
            )
          `)
          .or(`start_date.eq.${selectedDateString},and(start_date.lte.${selectedDateString},end_date.gte.${selectedDateString})`)
          .order('start_time', { ascending: true }),
        supabase
          .from('tenants_employee')
          .select(`
            id,
            display_name,
            unavailable_times,
            unavailable_ranges,
            bonuses_role,
            department_id,
            photo_url,
            photo,
            tenant_departement!department_id(id, name)
          `)
          .not('unavailable_times', 'is', null)
      ]);

      const unavailabilityReasons = reasonsResult.data || [];
      const employees = employeesResult.data || [];

      // Group by employee
      const employeeMap = new Map<number, {
        employeeId: number;
        employeeName: string;
        role: string;
        department: string;
        photo_url: string | null;
        photo: string | null;
        unavailabilities: any[];
      }>();

      // Track unique unavailabilities to prevent duplicates (employee_id + date + time)
      const uniqueUnavailabilityKeys = new Set<string>();

      const now = new Date();
      const currentTime = now.getHours() * 60 + now.getMinutes();
      let totalUnavailable = 0;
      let currentlyUnavailable = 0;
      let scheduledTimeOff = 0;

      // Helper function to create a unique key for an unavailability
      const getUnavailabilityKey = (employeeId: number, date: string, time: string): string => {
        return `${employeeId}_${date}_${time}`;
      };

      // Process data from employee_unavailability_reasons table (approved leave only)
      unavailabilityReasons.forEach((reason: any) => {
        if (reason.declined === true) return;
        if (reason.approved !== true) return;
        const employee = reason.tenants_employee;
        if (!employee) return;

        const employeeId = reason.employee_id;
        const startDate = reason.start_date;
        const endDate = reason.end_date || startDate;

        // Check if the selected date falls within this unavailability
        const isOnDate = selectedDateString >= startDate && selectedDateString <= endDate;
        if (!isOnDate) return;

        if (!employeeMap.has(employeeId)) {
          const departmentName = (employee.tenant_departement as any)?.name || 'N/A';
          employeeMap.set(employeeId, {
            employeeId,
            employeeName: employee.display_name,
            role: getRoleDisplayName(employee.bonuses_role),
            department: departmentName,
            photo_url: employee.photo_url || null,
            photo: employee.photo || null,
            unavailabilities: []
          });
          totalUnavailable++;
        }

        const employeeData = employeeMap.get(employeeId)!;

        // Get reason text based on type
        let reasonText = '';
        if (reason.unavailability_type === 'sick_days') {
          reasonText = reason.sick_days_reason || '';
        } else if (reason.unavailability_type === 'vacation') {
          reasonText = reason.vacation_reason || '';
        } else {
          reasonText = reason.general_reason || '';
        }

        // Determine time display
        let timeDisplay = '';
        let isCurrentlyActive = false;

        if (reason.start_time && reason.end_time) {
          // Time-based unavailability - format to remove seconds
          const formattedStartTime = formatTimeString(reason.start_time);
          const formattedEndTime = formatTimeString(reason.end_time);
          timeDisplay = `${formattedStartTime} - ${formattedEndTime}`;
          if (selectedDateString === todayString) {
            const startTime = parseInt(formattedStartTime.split(':')[0]) * 60 + parseInt(formattedStartTime.split(':')[1]);
            const endTime = parseInt(formattedEndTime.split(':')[0]) * 60 + parseInt(formattedEndTime.split(':')[1]);
            isCurrentlyActive = currentTime >= startTime && currentTime <= endTime;
          }
        } else if (endDate && endDate !== startDate) {
          // Date range
          const startDateFormatted = new Date(startDate).toLocaleDateString('en-GB', {
            day: '2-digit',
            month: '2-digit'
          });
          const endDateFormatted = new Date(endDate).toLocaleDateString('en-GB', {
            day: '2-digit',
            month: '2-digit'
          });
          timeDisplay = 'All Day';

          // Check for duplicates
          const uniqueKey = getUnavailabilityKey(employeeId, selectedDateString, timeDisplay);
          if (uniqueUnavailabilityKeys.has(uniqueKey)) {
            return; // Skip duplicate
          }
          uniqueUnavailabilityKeys.add(uniqueKey);

          employeeData.unavailabilities.push({
            id: `reason-${reason.id}`,
            date: `${startDateFormatted} to ${endDateFormatted}`,
            time: timeDisplay,
            reason: reasonText,
            isActive: false,
            unavailabilityType: reason.unavailability_type
          });
          scheduledTimeOff++;
          return;
        } else {
          timeDisplay = 'All Day';
        }

        // Check for duplicates before adding
        const uniqueKey = getUnavailabilityKey(employeeId, selectedDateString, timeDisplay);
        if (uniqueUnavailabilityKeys.has(uniqueKey)) {
          return; // Skip duplicate
        }
        uniqueUnavailabilityKeys.add(uniqueKey);

        if (isCurrentlyActive) {
          currentlyUnavailable++;
        } else {
          scheduledTimeOff++;
        }

        employeeData.unavailabilities.push({
          id: `reason-${reason.id}`,
          date: new Date(startDate).toLocaleDateString('en-GB', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
          }),
          time: timeDisplay,
          reason: reasonText,
          isActive: isCurrentlyActive,
          unavailabilityType: reason.unavailability_type
        });
      });

      // Process data from tenants_employee table (unavailable_times and unavailable_ranges)
      employees.forEach(employee => {
        const unavailableTimes = employee.unavailable_times || [];
        const unavailableRanges = employee.unavailable_ranges || [];

        // Check for specific time slots on selected date
        const selectedDateTimes = unavailableTimes.filter((time: any) => time.date === selectedDateString);

        // Check for date ranges that include selected date
        const selectedDateRanges = unavailableRanges.filter((range: any) =>
          selectedDateString >= range.startDate && selectedDateString <= range.endDate
        );

        if (selectedDateTimes.length > 0 || selectedDateRanges.length > 0) {
          const employeeId = employee.id;
          const departmentName = (employee.tenant_departement as any)?.name || 'N/A';

          if (!employeeMap.has(employeeId)) {
            employeeMap.set(employeeId, {
              employeeId,
              employeeName: employee.display_name,
              role: getRoleDisplayName(employee.bonuses_role),
              department: departmentName,
              photo_url: employee.photo_url || null,
              photo: employee.photo || null,
              unavailabilities: []
            });
            totalUnavailable++;
          }

          const employeeData = employeeMap.get(employeeId)!;

          // Process time slots
          selectedDateTimes.forEach((time: any) => {
            const formattedStartTime = formatTimeString(time.startTime);
            const formattedEndTime = formatTimeString(time.endTime);
            const timeDisplay = `${formattedStartTime} - ${formattedEndTime}`;

            // Check for duplicates
            const uniqueKey = getUnavailabilityKey(employeeId, selectedDateString, timeDisplay);
            if (uniqueUnavailabilityKeys.has(uniqueKey)) {
              return; // Skip duplicate
            }
            uniqueUnavailabilityKeys.add(uniqueKey);

            const startTime = parseInt(formattedStartTime.split(':')[0]) * 60 + parseInt(formattedStartTime.split(':')[1]);
            const endTime = parseInt(formattedEndTime.split(':')[0]) * 60 + parseInt(formattedEndTime.split(':')[1]);
            // Only mark as "currently active" if it's today and the current time is within the range
            const isCurrentlyActive = selectedDateString === todayString && currentTime >= startTime && currentTime <= endTime;

            if (isCurrentlyActive) {
              currentlyUnavailable++;
            } else {
              scheduledTimeOff++;
            }

            const formattedDate = new Date(time.date).toLocaleDateString('en-GB', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric'
            });

            employeeData.unavailabilities.push({
              id: `time-${time.id || Date.now()}`,
              date: formattedDate,
              time: timeDisplay,
              reason: time.reason || '',
              isActive: isCurrentlyActive,
              unavailabilityType: 'general' // Legacy data doesn't have type, default to general
            });
          });

          // Process date ranges
          selectedDateRanges.forEach((range: any) => {
            const timeDisplay = 'All Day';

            // Check for duplicates
            const uniqueKey = getUnavailabilityKey(employeeId, selectedDateString, timeDisplay);
            if (uniqueUnavailabilityKeys.has(uniqueKey)) {
              return; // Skip duplicate
            }
            uniqueUnavailabilityKeys.add(uniqueKey);

            scheduledTimeOff++;

            const startDateFormatted = new Date(range.startDate).toLocaleDateString('en-GB', {
              day: '2-digit',
              month: '2-digit'
            });
            const endDateFormatted = new Date(range.endDate).toLocaleDateString('en-GB', {
              day: '2-digit',
              month: '2-digit'
            });

            employeeData.unavailabilities.push({
              id: `range-${range.id || Date.now()}`,
              date: `${startDateFormatted} to ${endDateFormatted}`,
              time: timeDisplay,
              reason: range.reason || '',
              isActive: false,
              unavailabilityType: 'general' // Legacy data doesn't have type, default to general
            });
          });
        }
      });

      // Convert to array format and group by type
      const sickDaysData: any[] = [];
      const vacationData: any[] = [];
      const generalData: any[] = [];

      Array.from(employeeMap.values()).forEach(emp => {
        // Group unavailabilities by type
        const sickDaysUnavailabilities = emp.unavailabilities.filter(u => u.unavailabilityType === 'sick_days');
        const vacationUnavailabilities = emp.unavailabilities.filter(u => u.unavailabilityType === 'vacation');
        const generalUnavailabilities = emp.unavailabilities.filter(u =>
          !u.unavailabilityType || u.unavailabilityType === 'general'
        );

        // Create entries for each type that has unavailabilities
        if (sickDaysUnavailabilities.length > 0) {
          sickDaysData.push({
            id: `${emp.employeeId}-sick-${sickDaysUnavailabilities[0]?.id || 'main'}`,
            employeeId: emp.employeeId,
            employeeName: emp.employeeName,
            role: emp.role,
            department: emp.department,
            photo_url: emp.photo_url,
            photo: emp.photo,
            date: sickDaysUnavailabilities[0]?.date || '',
            time: sickDaysUnavailabilities[0]?.time || '',
            reason: sickDaysUnavailabilities[0]?.reason || '',
            isActive: sickDaysUnavailabilities.some(u => u.isActive),
            allUnavailabilities: sickDaysUnavailabilities,
            type: 'sick_days'
          });
        }

        if (vacationUnavailabilities.length > 0) {
          vacationData.push({
            id: `${emp.employeeId}-vacation-${vacationUnavailabilities[0]?.id || 'main'}`,
            employeeId: emp.employeeId,
            employeeName: emp.employeeName,
            role: emp.role,
            department: emp.department,
            photo_url: emp.photo_url,
            photo: emp.photo,
            date: vacationUnavailabilities[0]?.date || '',
            time: vacationUnavailabilities[0]?.time || '',
            reason: vacationUnavailabilities[0]?.reason || '',
            isActive: vacationUnavailabilities.some(u => u.isActive),
            allUnavailabilities: vacationUnavailabilities,
            type: 'vacation'
          });
        }

        if (generalUnavailabilities.length > 0) {
          generalData.push({
            id: `${emp.employeeId}-general-${generalUnavailabilities[0]?.id || 'main'}`,
            employeeId: emp.employeeId,
            employeeName: emp.employeeName,
            role: emp.role,
            department: emp.department,
            photo_url: emp.photo_url,
            photo: emp.photo,
            date: generalUnavailabilities[0]?.date || '',
            time: generalUnavailabilities[0]?.time || '',
            reason: generalUnavailabilities[0]?.reason || '',
            isActive: generalUnavailabilities.some(u => u.isActive),
            allUnavailabilities: generalUnavailabilities,
            type: 'general'
          });
        }
      });

      // Combine all data for backward compatibility (for department filter, etc.)
      const detailedData = [...sickDaysData, ...vacationData, ...generalData];

      setUnavailableEmployeesData(detailedData);
      setGroupedUnavailableData({
        sick_days: sickDaysData,
        vacation: vacationData,
        general: generalData
      });
      setUnavailableEmployeesCount(totalUnavailable);
      setCurrentlyUnavailableCount(currentlyUnavailable);
      setScheduledTimeOffCount(scheduledTimeOff);

      // Extract unique departments
      const departments = Array.from(new Set(detailedData.map(item => item.department).filter(dept => dept && dept !== 'N/A')));
      departments.sort();
      setAvailableDepartments(departments as string[]);

      const cachePayload: DashboardTeamAvailabilityCache = {
        unavailableEmployeesData: detailedData,
        groupedUnavailableData: {
          sick_days: sickDaysData,
          vacation: vacationData,
          general: generalData,
        },
        unavailableEmployeesCount: totalUnavailable,
        currentlyUnavailableCount: currentlyUnavailable,
        scheduledTimeOffCount: scheduledTimeOff,
        availableDepartments: departments as string[],
        fetchedAt: Date.now(),
      };
      setCachedData(
        dashboardPathname,
        `dashboard-team-availability:v1:${selectedDateString}:${teamAvailabilityRefreshToken}`,
        cachePayload,
      );
      return cachePayload;
    } catch (error) {
      console.error('Error fetching unavailable employees:', error);
      return null;
    } finally {
      setUnavailableEmployeesLoading(false);
    }
  };

  // Optimized function to fetch follow-up leads data using the new follow_ups table
  const fetchFollowUpLeadsData = async (dateType: 'today' | 'overdue' | 'tomorrow' | 'future', fetchAll = false) => {
    try {
      // Get current user's data
      const user = await resolveDashboardAuthUser();
      if (!user) {
        return { newLeads: [], legacyLeads: [], totalCount: 0 };
      }
      const { data: userData, error: userDataError } = await supabase
        .from('users')
        .select('id')
        .eq('auth_id', user.id)
        .maybeSingle();

      if (userDataError || !userData?.id) {
        return { newLeads: [], legacyLeads: [], totalCount: 0 };
      }

      const userId = userData.id;

      // Get today's date for filtering
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayStart = today.toISOString();
      today.setHours(23, 59, 59, 999);
      const todayEnd = today.toISOString();

      // Get tomorrow's date for filtering
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      const tomorrowStart = tomorrow.toISOString();
      tomorrow.setHours(23, 59, 59, 999);
      const tomorrowEnd = tomorrow.toISOString();

      // Get 2 days from now (start of future follow-ups)
      const twoDaysFromNow = new Date(today);
      twoDaysFromNow.setDate(twoDaysFromNow.getDate() + 2);
      twoDaysFromNow.setHours(0, 0, 0, 0);
      const futureStart = twoDaysFromNow.toISOString();

      const fiftyDaysAgo = new Date();
      fiftyDaysAgo.setDate(fiftyDaysAgo.getDate() - 50);
      fiftyDaysAgo.setHours(0, 0, 0, 0);
      const fiftyDaysAgoISO = fiftyDaysAgo.toISOString();

      // Fetch new leads with follow-ups from follow_ups table (include manual_id, master_id for sublead display)
      let newFollowupsQuery = supabase
        .from('follow_ups')
        .select(`
          id,
          date,
          new_lead_id,
          leads!follow_ups_new_lead_id_fkey (
            id,
            lead_number,
            manual_id,
            master_id,
            name,
            stage,
            topic,
            status,
            unactivated_at,
            expert,
            manager,
            meeting_manager,
            category,
            category_id,
            balance,
            balance_currency,
            probability,
            handler,
            scheduler,
            closer,
            meeting_manager_id,
            expert_id,
            case_handler_id
          )
        `)
        .eq('user_id', userId)
        .not('new_lead_id', 'is', null);

      // Apply date filter based on dateType
      if (dateType === 'today') {
        newFollowupsQuery = newFollowupsQuery.gte('date', todayStart).lte('date', todayEnd);
      } else if (dateType === 'tomorrow') {
        newFollowupsQuery = newFollowupsQuery.gte('date', tomorrowStart).lte('date', tomorrowEnd);
      } else if (dateType === 'future') {
        // future: 2 days and up from now
        newFollowupsQuery = newFollowupsQuery.gte('date', futureStart);
      } else {
        // overdue: less than today but not more than 50 days ago
        newFollowupsQuery = newFollowupsQuery.gte('date', fiftyDaysAgoISO).lt('date', todayStart);
      }

      newFollowupsQuery = newFollowupsQuery.limit(fetchAll ? 1000 : 1000);

      const { data: newFollowupsData, error: newFollowupsError } = await newFollowupsQuery;
      if (newFollowupsError) throw newFollowupsError;

      // Fetch legacy leads with follow-ups from follow_ups table (include lead_number, master_id for sublead display)
      let legacyFollowupsQuery = supabase
        .from('follow_ups')
        .select(`
          id,
          date,
          lead_id,
          leads_lead!follow_ups_lead_id_fkey (
            id,
            name,
            lead_number,
            master_id,
            stage,
            topic,
            status,
            expert_id,
            meeting_manager_id,
            meeting_lawyer_id,
            meeting_scheduler_id,
            case_handler_id,
            closer_id,
            category_id,
            total,
            currency_id
          )
        `)
        .eq('user_id', userId)
        .not('lead_id', 'is', null);

      // Apply date filter based on dateType
      if (dateType === 'today') {
        legacyFollowupsQuery = legacyFollowupsQuery.gte('date', todayStart).lte('date', todayEnd);
      } else if (dateType === 'tomorrow') {
        legacyFollowupsQuery = legacyFollowupsQuery.gte('date', tomorrowStart).lte('date', tomorrowEnd);
      } else if (dateType === 'future') {
        // future: 2 days and up from now
        legacyFollowupsQuery = legacyFollowupsQuery.gte('date', futureStart);
      } else {
        // overdue: less than today but not more than 50 days ago
        legacyFollowupsQuery = legacyFollowupsQuery.gte('date', fiftyDaysAgoISO).lt('date', todayStart);
      }

      legacyFollowupsQuery = legacyFollowupsQuery.limit(fetchAll ? 1000 : 1000);

      const { data: legacyFollowupsDataRaw, error: legacyFollowupsError } = await legacyFollowupsQuery;
      if (legacyFollowupsError) throw legacyFollowupsError;
      let legacyFollowupsData = legacyFollowupsDataRaw || [];

      // If PostgREST embed fails (RLS/FK), still resolve rows using lead_id
      const tmpLegacyRow = (row: any) => {
        const r = row?.leads_lead;
        return Array.isArray(r) ? r[0] : r;
      };
      const orphanLegacyIds = [
        ...new Set(
          (legacyFollowupsData || [])
            .filter((f: any) => f?.lead_id != null && !tmpLegacyRow(f))
            .map((f: any) => Number(f.lead_id))
            .filter((n: number) => Number.isFinite(n))
        ),
      ];
      if (orphanLegacyIds.length > 0) {
        const { data: orphanLeads, error: orphanErr } = await supabase
          .from('leads_lead')
          .select(
            `id, name, lead_number, master_id, stage, topic, status, expert_id, meeting_manager_id, meeting_lawyer_id, meeting_scheduler_id, case_handler_id, closer_id, category_id, total, currency_id`
          )
          .in('id', orphanLegacyIds);
        if (!orphanErr && orphanLeads?.length) {
          const byId = new Map(orphanLeads.map((r: any) => [Number(r.id), r]));
          legacyFollowupsData = (legacyFollowupsData || []).map((f: any) => {
            if (tmpLegacyRow(f) || f?.lead_id == null) return f;
            const resolved = byId.get(Number(f.lead_id));
            return resolved ? { ...f, leads_lead: resolved } : f;
          });
        }
      }

      // Fetch master lead_numbers for sublead display (match CalendarPage / OverdueFollowups)
      const legacyMasterIds = [
        ...new Set(
          (legacyFollowupsData || [])
            .map((f: any) => {
              const ll = f.leads_lead;
              const row = Array.isArray(ll) ? ll[0] : ll;
              return row?.master_id;
            })
            .filter((id: unknown) => id != null)
        ),
      ] as number[];
      const newMasterIds = [...new Set((newFollowupsData || []).map((f: any) => f.leads?.master_id).filter((id: unknown) => id != null))] as number[];
      let legacyMasterMap: Record<string, { lead_number: string }> = {};
      let newMasterMap: Record<string, { lead_number: string; manual_id?: string | null }> = {};
      if (legacyMasterIds.length > 0) {
        const { data: legacyMasters } = await supabase.from('leads_lead').select('id, lead_number').in('id', legacyMasterIds);
        legacyMasters?.forEach((m: any) => { legacyMasterMap[String(m.id)] = { lead_number: m.lead_number || '' }; });
      }
      if (newMasterIds.length > 0) {
        const { data: newMasters } = await supabase.from('leads').select('id, lead_number, manual_id').in('id', newMasterIds);
        newMasters?.forEach((m: any) => { newMasterMap[String(m.id)] = { lead_number: m.lead_number || '', manual_id: m.manual_id }; });
      }
      // leads table: id = UUID (internal), lead_number = business id (e.g. L211325). Never use leads.id as display.
      const isUuid = (s: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s ?? '').trim());
      const formatNewLeadNumber = (lead: any): string => {
        let raw = typeof lead.lead_number === 'string' ? lead.lead_number : (lead.lead_number != null ? String(lead.lead_number) : '');
        if (isUuid(raw)) raw = ''; // lead_number must not be the internal UUID
        if (!raw && typeof lead.id === 'number') raw = String(lead.id); // only fall back to numeric id, never UUID
        if (!lead.master_id) return raw;
        if (raw && raw.includes('/')) return raw;
        const master = newMasterMap[String(lead.master_id)];
        const masterNum = master?.manual_id || master?.lead_number || lead.master_id?.toString() || '';
        return masterNum ? `${masterNum}/2` : raw;
      };
      const formatLegacyLeadNumber = (lead: any): string => {
        const raw = lead.lead_number || lead.id?.toString() || '';
        if (!lead.master_id) return raw;
        if (raw && raw.includes('/')) return raw;
        const master = legacyMasterMap[String(lead.master_id)];
        const masterNum = master?.lead_number || lead.master_id?.toString() || '';
        return masterNum ? `${masterNum}/2` : raw;
      };

      // Process new leads - filter for active leads only; exclude rows with no valid lead_number (e.g. UUID from leads.id)
      const processedNewLeads = (newFollowupsData || [])
        .filter(followup => {
          const lead = followup.leads as any;
          // Filter out inactive leads: no lead_number, empty lead_number, or has unactivated_at
          return lead &&
            lead.lead_number &&
            lead.lead_number !== '' &&
            !lead.unactivated_at &&
            lead.status !== 'not_qualified' &&
            lead.status !== 'declined';
        })
        .map(followup => {
          const lead = followup.leads as any;
          return {
            ...lead,
            lead_number: formatNewLeadNumber(lead),
            next_followup: followup.date, // Include follow-up date for compatibility
            follow_up_id: followup.id, // Include follow-up ID for editing/deleting
            lead_type: 'new' as const
          };
        })
        .filter(lead => {
          const num = lead.lead_number != null ? String(lead.lead_number) : '';
          return num !== '' && !isUuid(num); // drop new leads with no valid number (avoids duplicate row showing UUID)
        });

      // Normalize embedded row (PostgREST may return object or single-element array)
      const legacyRow = (row: any) => {
        const r = row?.leads_lead;
        return Array.isArray(r) ? r[0] : r;
      };

      // Active legacy for follow-up list: status only — stage is never used to exclude a row here.
      const isActiveLegacyLead = (lead: any) => {
        if (!lead) return false;
        const s = lead.status;
        if (s === 10 || s === '10') return false;
        return s === 0 || s === '0' || s === null || s === undefined;
      };

      // Process legacy leads — include subleads (status null) per PipelinePage / CalendarPage
      const processedLegacyLeads = (legacyFollowupsData || [])
        .filter((followup) => {
          const lead = legacyRow(followup);
          return isActiveLegacyLead(lead);
        })
        .map((followup) => {
          const lead = legacyRow(followup);
          return {
            ...lead,
            next_followup: followup.date, // Include follow-up date for compatibility
            follow_up_id: followup.id, // Include follow-up ID for editing/deleting
            lead_type: 'legacy' as const,
            lead_number: formatLegacyLeadNumber(lead)
          };
        });

      // One row per follow_up row (same lead can have multiple follow_ups in DB; dedupe only duplicate ids)
      const combined = [...processedNewLeads, ...processedLegacyLeads].sort((a, b) => {
        const da = a.next_followup ? new Date(a.next_followup).getTime() : 0;
        const db = b.next_followup ? new Date(b.next_followup).getTime() : 0;
        if (da !== db) return da - db;
        return (a.lead_type === 'new' ? 0 : 1) - (b.lead_type === 'new' ? 0 : 1);
      });
      const seenFollowUpIds = new Set<number>();
      const deduped = combined.filter((lead) => {
        const fid = lead.follow_up_id;
        if (fid == null) return true;
        const n = Number(fid);
        if (!Number.isFinite(n)) return true;
        if (seenFollowUpIds.has(n)) return false;
        seenFollowUpIds.add(n);
        return true;
      });
      const dedupedNew = deduped.filter(l => l.lead_type === 'new');
      const dedupedLegacy = deduped.filter(l => l.lead_type === 'legacy');

      const result = {
        newLeads: dedupedNew,
        legacyLeads: dedupedLegacy,
        totalCount: deduped.length
      };

      return result;
    } catch (error) {
      console.error('Dashboard fetchFollowUpLeadsData:', error);
      return { newLeads: [], legacyLeads: [], totalCount: 0 };
    }
  };

  // Keep old function name for backward compatibility
  const fetchOverdueLeadsData = async (fetchAll = false) => {
    return fetchFollowUpLeadsData('overdue', fetchAll);
  };

  // Helper function to extract valid Teams link from stored data
  const getValidTeamsLink = (link: string | undefined): string => {
    if (!link) return '';
    try {
      // If it's a plain URL, return as is
      if (link.startsWith('http')) return link;
      // If it's a stringified object, parse and extract joinUrl
      const obj = JSON.parse(link);
      if (obj && typeof obj === 'object' && obj.joinUrl && typeof obj.joinUrl === 'string') {
        return obj.joinUrl;
      }
      // Some Graph API responses use joinWebUrl
      if (obj && typeof obj === 'object' && obj.joinWebUrl && typeof obj.joinWebUrl === 'string') {
        return obj.joinWebUrl;
      }
    } catch (e) {
      // Not JSON, just return as is
      if (typeof link === 'string' && link.startsWith('http')) return link;
    }
    return '';
  };

  // Helper function to check if location is online/teams/zoom
  const isOnlineLocation = (location: string | undefined): boolean => {
    if (!location) return false;
    const locationLower = location.toLowerCase().trim();
    return locationLower === 'online' || locationLower === 'teams' || locationLower === 'zoom';
  };

  // Build client route for lead (match CalendarPage: sublead query param, no (L) badge)
  const buildClientRoute = (lead: any): string => {
    if (!lead) return '/clients';
    if (lead.lead_type === 'new' && lead.lead_number) {
      const isSubLead = lead.lead_number.includes('/');
      if (isSubLead) {
        const manualId = lead.manual_id || null;
        if (manualId) return `/clients/${encodeURIComponent(manualId)}?lead=${encodeURIComponent(lead.lead_number)}`;
        const base = lead.lead_number.split('/')[0];
        return `/clients/${encodeURIComponent(base)}?lead=${encodeURIComponent(lead.lead_number)}`;
      }
      return `/clients/${encodeURIComponent(lead.manual_id || lead.lead_number)}`;
    }
    if (lead.lead_type === 'legacy' || lead.id?.toString().startsWith('legacy_')) {
      const legacyId = lead.id?.toString().replace('legacy_', '') || lead.id;
      const isSubLead = lead.lead_number && lead.lead_number.includes('/');
      if (isSubLead) return `/clients/${encodeURIComponent(legacyId)}?lead=${encodeURIComponent(lead.lead_number)}`;
      return `/clients/${encodeURIComponent(legacyId)}`;
    }
    if (lead.lead_number) {
      const isSubLead = lead.lead_number.includes('/');
      if (isSubLead) {
        const base = lead.lead_number.split('/')[0];
        return `/clients/${encodeURIComponent(base)}?lead=${encodeURIComponent(lead.lead_number)}`;
      }
      return `/clients/${encodeURIComponent(lead.lead_number)}`;
    }
    return '/clients';
  };

  const formatLeadNumberForDisplay = (leadNumber: string | undefined): string => {
    const s = (leadNumber || '').trim();
    return s || '--';
  };

  // Resolve CRM users.id from AuthContext (no redundant getUser network calls)
  useEffect(() => {
    if (!authUser?.id) {
      setCurrentUserId(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from('users')
        .select('id')
        .eq('auth_id', authUser.id)
        .maybeSingle();
      if (!cancelled && data?.id) {
        setCurrentUserId(data.id);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authUser?.id]);

  // Handler to edit follow-up date
  const handleEditFollowUp = (lead: any) => {
    setEditingFollowUpId(lead.follow_up_id);
    setEditFollowUpDate(lead.next_followup ? new Date(lead.next_followup).toISOString().split('T')[0] : '');
  };

  // Handler to save edited follow-up date
  const handleSaveFollowUp = async (lead: any) => {
    if (!currentUserId || !editingFollowUpId) return;

    try {
      if (editFollowUpDate && editFollowUpDate.trim() !== '') {
        const { error } = await supabase
          .from('follow_ups')
          .update({ date: editFollowUpDate + 'T00:00:00Z' })
          .eq('id', editingFollowUpId)
          .eq('user_id', currentUserId);

        if (error) throw error;

        toast.success('Follow-up date updated successfully');
      } else {
        // Delete if date is empty
        await handleDeleteFollowUp(lead);
        return;
      }

      // Refresh follow-ups
      if (followUpTab === 'today') {
        const result = await fetchFollowUpLeadsData('today');
        setTodayFollowUps([...result.newLeads, ...result.legacyLeads]);
      } else if (followUpTab === 'tomorrow') {
        const result = await fetchFollowUpLeadsData('tomorrow');
        setTomorrowFollowUps([...result.newLeads, ...result.legacyLeads]);
      } else if (followUpTab === 'future') {
        const result = await fetchFollowUpLeadsData('future');
        setFutureFollowUps([...result.newLeads, ...result.legacyLeads]);
      } else {
        const result = await fetchFollowUpLeadsData('overdue');
        setRealOverdueLeads([...result.newLeads, ...result.legacyLeads]);
      }

      setEditingFollowUpId(null);
      setEditFollowUpDate('');
    } catch (error: any) {
      toast.error(`Failed to update follow-up: ${error.message || 'Unknown error'}`);
    }
  };

  // Handler to delete follow-up
  const handleDeleteFollowUp = async (lead: any) => {
    if (!currentUserId || !lead.follow_up_id) return;

    if (!window.confirm('Are you sure you want to delete this follow-up?')) {
      return;
    }

    try {
      const { error } = await supabase
        .from('follow_ups')
        .delete()
        .eq('id', lead.follow_up_id)
        .eq('user_id', currentUserId);

      if (error) throw error;

      toast.success('Follow-up deleted successfully');

      // Refresh follow-ups
      if (followUpTab === 'today') {
        const result = await fetchFollowUpLeadsData('today');
        setTodayFollowUps([...result.newLeads, ...result.legacyLeads]);
      } else if (followUpTab === 'tomorrow') {
        const result = await fetchFollowUpLeadsData('tomorrow');
        setTomorrowFollowUps([...result.newLeads, ...result.legacyLeads]);
      } else if (followUpTab === 'future') {
        const result = await fetchFollowUpLeadsData('future');
        setFutureFollowUps([...result.newLeads, ...result.legacyLeads]);
      } else {
        const result = await fetchFollowUpLeadsData('overdue');
        setRealOverdueLeads([...result.newLeads, ...result.legacyLeads]);
      }

      setEditingFollowUpId(null);
      setEditFollowUpDate('');
    } catch (error: any) {
      toast.error(`Failed to delete follow-up: ${error.message || 'Unknown error'}`);
    }
  };

  // Handler to cancel editing
  const handleCancelEditFollowUp = () => {
    setEditingFollowUpId(null);
    setEditFollowUpDate('');
  };

  // --- Add state for today's meetings (real data) ---
  const [todayMeetings, setTodayMeetings] = useState<any[]>([]);
  const [meetingsLoading, setMeetingsLoading] = useState(false);
  const [meetingsInNextHour, setMeetingsInNextHour] = useState(0);
  const [nextHourMeetings, setNextHourMeetings] = useState<any[]>([]);
  // Fetch meetings on initial mount and refresh every minute - DEFERRED
  useEffect(() => {
    // Defer to next tick to allow initial render
    const timeoutId = setTimeout(() => {
      const fetchMeetings = async () => {
      setMeetingsLoading(true);
      try {
        // First, fetch current user's employee_id, display name, and email
        const user = await resolveDashboardAuthUser();
        if (!user) return;
        let userEmployeeId: number | null = null;
        let userDisplayName: string | null = null;
        let userEmail: string | null = null;

        if (user) {
          userEmail = user.email || null;

          const { data: userData } = await supabase
            .from('users')
            .select(`
              employee_id,
              email,
              tenants_employee!employee_id(
                id,
                display_name
              )
            `)
            .eq('auth_id', user.id)
            .maybeSingle();

          if (userData?.employee_id) {
            userEmployeeId = userData.employee_id;
            setAndCacheEmployeeId(userData.employee_id);
          }

          // Use email from userData if available, otherwise use auth email
          if (userData?.email) {
            userEmail = userData.email;
          }

          // Get display name from employee relationship
          if (userData?.tenants_employee) {
            const empData = Array.isArray(userData.tenants_employee)
              ? userData.tenants_employee[0]
              : userData.tenants_employee;
            if (empData?.display_name) {
              userDisplayName = empData.display_name;
            }
          }
        }

        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        const todayStart = new Date(today);
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date(today);
        todayEnd.setHours(23, 59, 59, 999);

        // Fetch client meetings with proper joins to both leads and leads_lead tables
        // Include extern1 and extern2 to show meetings where user is a guest
        const { data: meetings, error } = await supabase
          .from('meetings')
          .select(`
            id,
            meeting_date,
            meeting_time,
            meeting_location,
            meeting_manager,
            meeting_currency,
            meeting_amount,
            scheduler,
            expert,
            helper,
            teams_meeting_url,
            meeting_brief,
            legacy_lead_id,
            extern1,
            extern2,
            status,
            lead:leads!client_id(
              id, name, lead_number, manual_id, master_id, manager, topic, expert, stage, scheduler, helper, closer, handler, balance, balance_currency, unactivated_at
            ),
            legacy_lead:leads_lead!legacy_lead_id(
              id, name, lead_number, master_id, meeting_manager_id, meeting_lawyer_id, meeting_scheduler_id, category, category_id, expert_id, stage, closer_id, case_handler_id, total, currency_id, status,
              scheduler_employee:tenants_employee!fk_leads_lead_meeting_scheduler_id(id, display_name),
              manager_employee:tenants_employee!fk_leads_lead_meeting_manager_id(id, display_name),
              lawyer_employee:tenants_employee!fk_leads_lead_meeting_lawyer_id(id, display_name),
              expert_employee:tenants_employee!fk_leads_lead_expert_id(id, display_name),
              currency_record:accounting_currencies!leads_lead_currency_id_fkey(name, iso_code),
              stage_record:lead_stages!fk_leads_lead_stage(id, name)
            )
          `)
          .eq('meeting_date', todayStr)
          .or('status.is.null,status.neq.canceled,status.neq.cancelled');

        // Fetch legacy leads directly from leads_lead table that have meetings today
        // Get IDs of legacy leads that are already in meetings table to exclude them
        const existingLegacyLeadIds = new Set<string>();
        if (meetings) {
          meetings.forEach((m: any) => {
            if (m.legacy_lead_id) {
              existingLegacyLeadIds.add(String(m.legacy_lead_id));
            }
          });
        }

        let directLegacyMeetings: any[] = [];
        try {
            const { data: legacyLeadsData, error: legacyError } = await supabase
            .from('leads_lead')
            .select(`
              id, name, lead_number, master_id, meeting_date, meeting_time, category, category_id, stage, status, meeting_manager_id, meeting_lawyer_id, meeting_scheduler_id, total, meeting_total_currency_id, currency_id, expert_id, probability, phone, email, mobile, meeting_location_id, expert_examination,
              scheduler_employee:tenants_employee!fk_leads_lead_meeting_scheduler_id(id, display_name),
              manager_employee:tenants_employee!fk_leads_lead_meeting_manager_id(id, display_name),
              lawyer_employee:tenants_employee!fk_leads_lead_meeting_lawyer_id(id, display_name),
              expert_employee:tenants_employee!fk_leads_lead_expert_id(id, display_name),
              currency_record:accounting_currencies!leads_lead_currency_id_fkey(name, iso_code),
              stage_record:lead_stages!fk_leads_lead_stage(id, name)
            `)
            .eq('meeting_date', todayStr)
            .not('meeting_date', 'is', null)
            .not('name', 'is', null)
            .limit(500);

          if (!legacyError && legacyLeadsData) {
            // Filter out legacy leads that already exist in meetings table
            let newLegacyLeads = legacyLeadsData.filter((legacyLead: any) => {
              return !existingLegacyLeadIds.has(String(legacyLead.id));
            });
            // Filter out inactive legacy leads (same as CalendarPage: status 10 or stage 91)
            newLegacyLeads = newLegacyLeads.filter((legacyLead: any) => {
              if (legacyLead.status === 10 || legacyLead.status === '10') return false;
              if (legacyLead.stage === 91 || legacyLead.stage === '91') return false;
              return true;
            });

            // Transform legacy leads to match meeting structure (include joined employee/currency/stage for display)
            directLegacyMeetings = newLegacyLeads.map((legacyLead: any) => ({
              id: `legacy_${legacyLead.id}`,
              meeting_date: legacyLead.meeting_date,
              meeting_time: legacyLead.meeting_time || '09:00',
              meeting_location: 'Teams',
              meeting_manager: legacyLead.meeting_manager_id,
              meeting_currency: legacyLead.currency_record?.iso_code ?? (legacyLead.meeting_total_currency_id === 1 ? 'NIS' :
                legacyLead.meeting_total_currency_id === 2 ? 'USD' :
                  legacyLead.meeting_total_currency_id === 3 ? 'EUR' : 'NIS'),
              meeting_amount: parseFloat(legacyLead.total || '0'),
              expert: legacyLead.expert_id,
              helper: legacyLead.meeting_lawyer_id,
              teams_meeting_url: null,
              meeting_brief: null,
              legacy_lead: {
                id: legacyLead.id,
                name: legacyLead.name,
                stage: legacyLead.stage,
                status: legacyLead.status,
                expert_id: legacyLead.expert_id,
                meeting_manager_id: legacyLead.meeting_manager_id,
                meeting_lawyer_id: legacyLead.meeting_lawyer_id,
                meeting_scheduler_id: legacyLead.meeting_scheduler_id,
                category: legacyLead.category,
                category_id: legacyLead.category_id,
                total: parseFloat(legacyLead.total || '0'),
                currency_id: legacyLead.currency_id ?? legacyLead.meeting_total_currency_id,
                expert_examination: legacyLead.expert_examination,
                scheduler_employee: legacyLead.scheduler_employee,
                manager_employee: legacyLead.manager_employee,
                lawyer_employee: legacyLead.lawyer_employee,
                expert_employee: legacyLead.expert_employee,
                currency_record: legacyLead.currency_record,
                stage_record: legacyLead.stage_record,
              },
              lead: null
            }));
          }
        } catch (legacyErr) {
          console.error('Error fetching legacy leads directly:', legacyErr);
          // Continue even if legacy fetch fails
        }

        // Fetch staff meetings from outlook_teams_meetings where user is in attendees
        let staffMeetings: any[] = [];
        if (userEmail) {
          const { data: outlookMeetings, error: outlookError } = await supabase
            .from('outlook_teams_meetings')
            .select('*')
            .gte('start_date_time', todayStart.toISOString())
            .lte('start_date_time', todayEnd.toISOString())
            .or('status.is.null,status.neq.cancelled');

          if (!outlookError && outlookMeetings) {
            // Filter staff meetings where user's email is in attendees array
            staffMeetings = outlookMeetings.filter((meeting: any) => {
              if (!meeting.attendees || !Array.isArray(meeting.attendees)) return false;
              // Check if user's email is in the attendees array
              return meeting.attendees.some((attendee: any) => {
                const attendeeEmail = typeof attendee === 'string'
                  ? attendee.toLowerCase()
                  : (attendee.email || '').toLowerCase();
                return attendeeEmail === userEmail?.toLowerCase();
              });
            });
          }
        }

        // Combine meetings from meetings table with direct legacy meetings (if fetched)
        const allMeetingsDataForProcessing = error ? directLegacyMeetings : [...(meetings || []), ...directLegacyMeetings];

        if (!error || directLegacyMeetings.length > 0) {
          // Fetch employee names for ID mapping (numeric ids only — role fields often store names)
          const employeeIds = new Set<number>();
          allMeetingsDataForProcessing.forEach((meeting: any) => {
            const addValidId = (id: any) => {
              if (id == null || id === '---' || id === '' || id === 'Not assigned') return;
              const s = String(id).trim();
              if (!/^\d+$/.test(s)) return;
              const n = Number(s);
              if (Number.isFinite(n) && n > 0) employeeIds.add(n);
            };

            addValidId(meeting.legacy_lead?.expert_id);
            addValidId(meeting.legacy_lead?.meeting_manager_id);
            addValidId(meeting.legacy_lead?.meeting_lawyer_id);
            addValidId(meeting.legacy_lead?.meeting_scheduler_id);
            addValidId(meeting.legacy_lead?.case_handler_id);
            addValidId(meeting.expert);
            addValidId(meeting.meeting_manager);
            addValidId(meeting.scheduler);
            addValidId(meeting.helper);
            addValidId(meeting.extern1);
            addValidId(meeting.extern2);
            // For new leads, expert might be an ID
            if (meeting.lead?.expert && !isNaN(Number(meeting.lead.expert))) {
              addValidId(meeting.lead.expert);
            }
            // For new leads, scheduler might be an ID
            if (meeting.lead?.scheduler && !isNaN(Number(meeting.lead.scheduler))) {
              addValidId(meeting.lead.scheduler);
            }
            // For new leads, helper might be an ID
            if (meeting.lead?.helper && !isNaN(Number(meeting.lead.helper))) {
              addValidId(meeting.lead.helper);
            }
            // For new leads, closer might be an ID
            if (meeting.lead?.closer && !isNaN(Number(meeting.lead.closer))) {
              addValidId(meeting.lead.closer);
            }
            // For new leads, manager might be an ID
            if (meeting.lead?.manager && !isNaN(Number(meeting.lead.manager))) {
              addValidId(meeting.lead.manager);
            }
            // For new leads, handler might be an ID
            if (meeting.lead?.handler && !isNaN(Number(meeting.lead.handler))) {
              addValidId(meeting.lead.handler);
            }
          });

          let employeeNameMap: Record<string, string> = {};
          if (employeeIds.size > 0) {
            const { data: employees, error: employeeError } = await supabase
              .from('tenants_employee')
              .select('id, display_name')
              .in('id', Array.from(employeeIds));

            if (!employeeError && employees) {
              employeeNameMap = employees.reduce((acc, emp) => {
                acc[emp.id.toString()] = emp.display_name;
                return acc;
              }, {} as Record<string, string>);
            }
          }

          // Filter meetings to only include those where user's employee_id matches a role
          // Helper function to check if user matches any role
          const userMatchesRole = (meeting: any): boolean => {
            if (!userEmployeeId) return true; // If no user employee_id, show all meetings

            // Check if user is extern1 or extern2 (Guest 1 or Guest 2)
            if (meeting.extern1?.toString() === userEmployeeId.toString() ||
              meeting.extern2?.toString() === userEmployeeId.toString()) {
              return true;
            }

            // Check legacy lead roles
            if (meeting.legacy_lead) {
              const legacyLead = meeting.legacy_lead;
              return (
                legacyLead.meeting_scheduler_id?.toString() === userEmployeeId.toString() ||
                legacyLead.meeting_manager_id?.toString() === userEmployeeId.toString() ||
                legacyLead.meeting_lawyer_id?.toString() === userEmployeeId.toString() ||
                legacyLead.expert_id?.toString() === userEmployeeId.toString() ||
                legacyLead.closer_id?.toString() === userEmployeeId.toString() ||
                legacyLead.case_handler_id?.toString() === userEmployeeId.toString()
              );
            }

            // Check new lead roles
            if (meeting.lead) {
              const newLead = meeting.lead;
              // For new leads, fields might be IDs or display names
              // We need to check both the lead fields and the meeting fields
              const checkField = (field: any): boolean => {
                if (!field) return false;
                // If it's a number/ID, compare directly with employee_id
                if (!isNaN(Number(field))) {
                  return field.toString() === userEmployeeId?.toString();
                }
                // If it's a string (display name), compare with user's display name
                if (typeof field === 'string' && userDisplayName) {
                  return field.trim() === userDisplayName.trim();
                }
                return false;
              };

              return (
                checkField(newLead.scheduler) ||
                checkField(newLead.manager) ||
                checkField(newLead.helper) ||
                checkField(newLead.expert) ||
                checkField(newLead.closer) ||
                checkField(newLead.handler) ||
                checkField(meeting.scheduler) ||
                checkField(meeting.meeting_manager) ||
                checkField(meeting.expert) ||
                checkField(meeting.helper)
              );
            }

            // Fallback: check meeting-level fields (meetings table has scheduler, meeting_manager, helper as text)
            if (userEmployeeId) {
              return (
                meeting.scheduler?.toString() === userEmployeeId.toString() ||
                meeting.meeting_manager?.toString() === userEmployeeId.toString() ||
                meeting.expert?.toString() === userEmployeeId.toString() ||
                meeting.helper?.toString() === userEmployeeId.toString()
              );
            }
            // If we have display name, check against meeting fields that might be display names
            if (userDisplayName) {
              return (
                (typeof meeting.scheduler === 'string' && meeting.scheduler.trim() === userDisplayName.trim()) ||
                (typeof meeting.meeting_manager === 'string' && meeting.meeting_manager.trim() === userDisplayName.trim()) ||
                (typeof meeting.expert === 'string' && meeting.expert.trim() === userDisplayName.trim()) ||
                (typeof meeting.helper === 'string' && meeting.helper.trim() === userDisplayName.trim())
              );
            }
            return false;
          };

          // Filter meetings by user role
          let filteredMeetings = allMeetingsDataForProcessing.filter(userMatchesRole);

          // Exclude canceled/cancelled meetings (client-side, same as CalendarPage)
          filteredMeetings = filteredMeetings.filter((m: any) => {
            const s = (m.status || '').toString().toLowerCase();
            return s !== 'canceled' && s !== 'cancelled';
          });

          // Exclude meetings with inactive leads (same logic as CalendarPage)
          filteredMeetings = filteredMeetings.filter((m: any) => {
            const lead = m.lead || {};
            const legacyLead = m.legacy_lead || {};
            // If meeting has client/legacy_lead_id but no lead data, exclude
            if ((m.client_id || m.legacy_lead_id) && !lead.id && !legacyLead.id) return false;
            // New leads: exclude if stage 91 or unactivated_at
            if (lead.id && !lead.id?.toString().startsWith('legacy_')) {
              if (lead.stage === 91 || lead.stage === '91') return false;
              if (lead.unactivated_at) return false;
            }
            // Legacy leads: exclude if stage 91 or status 10
            if (legacyLead.id || lead.id?.toString().startsWith('legacy_')) {
              const stage = legacyLead.stage ?? lead.stage;
              const status = legacyLead.status ?? lead.status;
              if (stage === 91 || stage === '91') return false;
              if (status === 10 || status === '10') return false;
            }
            return true;
          });

          // Build maps for sublead lead_number formatting (match CalendarPage)
          const legacyLeadsMap = new Map<string, { lead_number?: string }>();
          const newLeadsMap = new Map<string, { lead_number?: string; manual_id?: string | null }>();
          (filteredMeetings || []).forEach((m: any) => {
            if (m.legacy_lead?.id) legacyLeadsMap.set(String(m.legacy_lead.id), m.legacy_lead);
            if (m.lead?.id) newLeadsMap.set(String(m.lead.id), m.lead);
          });
          directLegacyMeetings.forEach((m: any) => {
            const ll = m.legacy_lead;
            if (ll?.id) legacyLeadsMap.set(String(ll.id), ll);
          });

          // Process the meetings to combine lead data from both tables
          const processedMeetings = filteredMeetings.map((meeting: any) => {
            // Determine which lead data to use
            let leadData = null;

            if (meeting.legacy_lead) {
              const leg = meeting.legacy_lead;
              let displayLegacyLeadNumber = leg.lead_number || leg.id?.toString() || '';
              if (leg.master_id) {
                if (displayLegacyLeadNumber && displayLegacyLeadNumber.includes('/')) {
                  // already formatted
                } else {
                  const master = legacyLeadsMap.get(String(leg.master_id));
                  const masterNum = master?.lead_number || leg.master_id?.toString() || '';
                  displayLegacyLeadNumber = masterNum ? `${masterNum}/2` : displayLegacyLeadNumber;
                }
              }
              leadData = {
                ...leg,
                lead_type: 'legacy',
                manager: leg.meeting_manager_id,
                helper: leg.meeting_lawyer_id,
                lead_number: displayLegacyLeadNumber,
                topic: leg.category || leg.category_id
              };
            } else if (meeting.lead) {
              const lead = meeting.lead;
              let displayLeadNumber = lead.lead_number || lead.id?.toString() || '';
              if (lead.master_id) {
                if (displayLeadNumber && displayLeadNumber.includes('/')) {
                  // already formatted
                } else {
                  const master = newLeadsMap.get(String(lead.master_id));
                  const masterNum = master?.manual_id || master?.lead_number || lead.master_id?.toString() || '';
                  displayLeadNumber = masterNum ? `${masterNum}/2` : displayLeadNumber;
                }
              }
              leadData = {
                ...lead,
                lead_type: 'new',
                lead_number: displayLeadNumber
              };
            }

            return {
              ...meeting,
              lead: leadData
            };
          });

          // Store processed meetings first (use joined data for legacy leads; fallback to employeeNameMap)
          const processedMeetingsList = processedMeetings.map((meeting: any) => {
            // Resolve employee display name: prefer joined record, then map, then raw id/name
            const fromJoinOrMap = (joinedDisplayName: string | null | undefined, idOrName: any, fallbackLabel: string): string => {
              if (joinedDisplayName) return joinedDisplayName;
              if (!idOrName) return fallbackLabel;
              if (typeof idOrName === 'string' && isNaN(Number(idOrName))) return idOrName;
              return employeeNameMap[idOrName.toString()] || idOrName.toString();
            };

            // Determine expert name (legacy: use join; new: use map or lead field)
            let expertName = 'Unassigned';
            if (meeting.legacy_lead) {
              expertName = fromJoinOrMap(
                meeting.legacy_lead.expert_employee?.display_name,
                meeting.legacy_lead.expert_id,
                'Unassigned'
              );
            } else if (meeting.lead?.expert) {
              expertName = fromJoinOrMap(null, meeting.lead.expert, 'Unassigned');
            } else if (meeting.expert) {
              expertName = fromJoinOrMap(null, meeting.expert, 'Unassigned');
            }

            // Determine scheduler name
            let schedulerName = '---';
            if (meeting.legacy_lead) {
              schedulerName = fromJoinOrMap(
                meeting.legacy_lead.scheduler_employee?.display_name,
                meeting.legacy_lead.meeting_scheduler_id,
                '---'
              );
            } else if (meeting.lead?.scheduler) {
              schedulerName = fromJoinOrMap(null, meeting.lead.scheduler, '---');
            } else if (meeting.scheduler) {
              schedulerName = fromJoinOrMap(null, meeting.scheduler, '---');
            } else if (meeting.meeting_manager) {
              schedulerName = fromJoinOrMap(null, meeting.meeting_manager, '---');
            }

            // Determine stage name (legacy: use join; else getStageName)
            let stageName = 'N/A';
            if (meeting.legacy_lead?.stage_record?.name) {
              stageName = meeting.legacy_lead.stage_record.name;
            } else if (meeting.lead?.stage) {
              stageName = getStageName(meeting.lead.stage.toString());
            } else if (meeting.legacy_lead?.stage) {
              stageName = getStageName(meeting.legacy_lead.stage.toString());
            }

            // Determine manager name
            let managerName = 'Unassigned';
            if (meeting.legacy_lead) {
              managerName = fromJoinOrMap(
                meeting.legacy_lead.manager_employee?.display_name,
                meeting.legacy_lead.meeting_manager_id,
                'Unassigned'
              );
            } else if (meeting.lead?.manager) {
              managerName = fromJoinOrMap(null, meeting.lead.manager, 'Unassigned');
            } else if (meeting.meeting_manager) {
              managerName = fromJoinOrMap(null, meeting.meeting_manager, 'Unassigned');
            }

            // Determine helper name
            let helperName = '---';
            if (meeting.legacy_lead) {
              helperName = fromJoinOrMap(
                meeting.legacy_lead.lawyer_employee?.display_name,
                meeting.legacy_lead.meeting_lawyer_id,
                '---'
              );
            } else if (meeting.lead?.helper) {
              helperName = fromJoinOrMap(null, meeting.lead.helper, '---');
            } else if (meeting.helper) {
              helperName = fromJoinOrMap(null, meeting.helper, '---');
            }

            // Determine if user is a guest (extern1 or extern2)
            let userRole = null;
            if (userEmployeeId) {
              if (meeting.extern1?.toString() === userEmployeeId.toString()) {
                userRole = 'Guest 1';
              } else if (meeting.extern2?.toString() === userEmployeeId.toString()) {
                userRole = 'Guest 2';
              }
            }

            return {
              id: meeting.id,
              lead: meeting.lead?.lead_number || meeting.legacy_lead?.id?.toString() || 'N/A',
              name: meeting.legacy_lead?.name || meeting.lead?.name || 'Unknown',
              topic: meeting.lead?.topic || meeting.legacy_lead?.category || 'Consultation',
              expert: expertName,
              scheduler: schedulerName,
              helper: helperName,
              stage: stageName,
              time: meeting.meeting_time,
              location: meeting.meeting_location || 'Teams',
              manager: managerName,
              userRole: userRole, // Add user role (Guest 1 or Guest 2)
              value: formatMeetingValue({
                leadBalance: meeting.lead?.balance,
                leadBalanceCurrency: meeting.lead?.balance_currency,
                legacyTotal: meeting.legacy_lead?.total,
                legacyCurrencyId: meeting.legacy_lead?.currency_id ?? null,
                legacyCurrencyCode: meeting.legacy_lead?.currency_record?.iso_code ?? meeting.legacy_lead?.currency_record?.name ?? null,
                meetingAmount: meeting.meeting_amount,
                meetingCurrency: meeting.meeting_currency,
              }).display,
              link: meeting.teams_meeting_url || meetingLocationLinks[meeting.meeting_location] || '',
            };
          });

          // Deduplicate client meetings by lead (one row per lead; same lead can have multiple meeting rows in DB)
          const seenLeadKeys = new Set<string>();
          const dedupedClientMeetings = processedMeetingsList
            .slice()
            .sort((a: any, b: any) => (a.time || '00:00').localeCompare(b.time || '00:00'))
            .filter((m: any) => {
              const key = m.lead != null && m.lead !== 'N/A' ? String(m.lead) : `meeting-${m.id}`;
              if (seenLeadKeys.has(key)) return false;
              seenLeadKeys.add(key);
              return true;
            });

          // Process staff meetings to match the same structure
          const processedStaffMeetings = staffMeetings.map((staffMeeting: any) => {
            // Extract time from start_date_time
            const startDate = new Date(staffMeeting.start_date_time);
            const timeStr = startDate.toTimeString().substring(0, 5); // HH:MM format

            return {
              id: `staff-${staffMeeting.id}`,
              lead: 'Staff Meeting',
              name: staffMeeting.subject || 'Staff Meeting',
              topic: staffMeeting.description || 'Staff Meeting',
              expert: '---',
              scheduler: '---',
              helper: '---',
              stage: 'N/A',
              time: timeStr,
              location: staffMeeting.location || 'Teams',
              manager: '---',
              value: 'N/A',
              link: staffMeeting.teams_join_url || staffMeeting.teams_meeting_url || '',
              isStaffMeeting: true,
              meetingDateTime: startDate
            };
          });

          // Combine client meetings (one per lead) and staff meetings
          const allMeetings = [...dedupedClientMeetings, ...processedStaffMeetings];

          // Sort all meetings by time
          allMeetings.sort((a: any, b: any) => {
            const timeA = a.time || '00:00';
            const timeB = b.time || '00:00';
            return timeA.localeCompare(timeB);
          });

          setTodayMeetings(allMeetings);

          // Calculate meetings in next hour
          const nowForNextHour = new Date();
          const oneHourLater = new Date(nowForNextHour.getTime() + 60 * 60 * 1000);

          const meetingsInNextHourList = allMeetings
            .map((meeting: any) => {
              if (!meeting.time && !meeting.meetingDateTime) return null;

              let meetingDateTime: Date;
              if (meeting.meetingDateTime) {
                // Staff meeting already has meetingDateTime
                meetingDateTime = meeting.meetingDateTime;
              } else {
                // Parse meeting time (format: HH:MM or HH:MM:SS)
                const timeParts = meeting.time.split(':');
                if (timeParts.length < 2) return null;

                const meetingHour = parseInt(timeParts[0], 10);
                const meetingMinute = parseInt(timeParts[1], 10);

                // Create meeting datetime for today
                meetingDateTime = new Date(nowForNextHour);
                meetingDateTime.setHours(meetingHour, meetingMinute, 0, 0);
              }

              // Check if meeting is between now and one hour from now
              if (meetingDateTime >= nowForNextHour && meetingDateTime <= oneHourLater) {
                return {
                  ...meeting,
                  meetingDateTime
                };
              }
              return null;
            })
            .filter(Boolean)
            .sort((a: any, b: any) => a.meetingDateTime.getTime() - b.meetingDateTime.getTime());

          setMeetingsInNextHour(meetingsInNextHourList.length);
          setNextHourMeetings(meetingsInNextHourList);
        } else {
          // Even if client meetings fail, try to show staff meetings
          let staffMeetingsFallback: any[] = [];
          if (userEmail) {
            const today = new Date();
            const todayStart = new Date(today);
            todayStart.setHours(0, 0, 0, 0);
            const todayEnd = new Date(today);
            todayEnd.setHours(23, 59, 59, 999);

            const { data: outlookMeetings, error: outlookError } = await supabase
              .from('outlook_teams_meetings')
              .select('*')
              .gte('start_date_time', todayStart.toISOString())
              .lte('start_date_time', todayEnd.toISOString())
              .or('status.is.null,status.neq.cancelled');

            if (!outlookError && outlookMeetings) {
              staffMeetingsFallback = outlookMeetings.filter((meeting: any) => {
                if (!meeting.attendees || !Array.isArray(meeting.attendees)) return false;
                return meeting.attendees.some((attendee: any) => {
                  const attendeeEmail = typeof attendee === 'string'
                    ? attendee.toLowerCase()
                    : (attendee.email || '').toLowerCase();
                  return attendeeEmail === userEmail?.toLowerCase();
                });
              });
            }
          }

          const processedStaffMeetings = staffMeetingsFallback.map((staffMeeting: any) => {
            const startDate = new Date(staffMeeting.start_date_time);
            const timeStr = startDate.toTimeString().substring(0, 5);
            return {
              id: `staff-${staffMeeting.id}`,
              lead: 'Staff Meeting',
              name: staffMeeting.subject || 'Staff Meeting',
              topic: staffMeeting.description || 'Staff Meeting',
              expert: '---',
              scheduler: '---',
              helper: '---',
              stage: 'N/A',
              time: timeStr,
              location: staffMeeting.location || 'Teams',
              manager: '---',
              value: 'N/A',
              link: staffMeeting.teams_join_url || staffMeeting.teams_meeting_url || '',
              isStaffMeeting: true,
              meetingDateTime: startDate
            };
          });

          setTodayMeetings(processedStaffMeetings);
          setMeetingsInNextHour(0);
          setNextHourMeetings([]);
        }
      } catch (e) {
        setTodayMeetings([]);
        setMeetingsInNextHour(0);
        setNextHourMeetings([]);
      }
      setMeetingsLoading(false);
    };

      // Fetch immediately on mount
      fetchMeetings();

      // Refresh meetings every minute to update the "next hour" count
      const interval = setInterval(() => {
        fetchMeetings();
      }, 60000); // 60 seconds

      return () => clearInterval(interval);
    }, 0); // Defer to next tick

    return () => clearTimeout(timeoutId);
  }, []); // Empty dependency array - only run on mount

  // Helper function to format time until meeting
  const formatTimeUntil = (meetingDateTime: Date): string => {
    const now = new Date();
    const diffMs = meetingDateTime.getTime() - now.getTime();
    const diffMinutes = Math.floor(diffMs / 60000);

    if (diffMinutes < 1) return 'now';
    if (diffMinutes === 1) return 'in 1 minute';
    if (diffMinutes < 60) return `in ${diffMinutes} minutes`;

    const hours = Math.floor(diffMinutes / 60);
    const minutes = diffMinutes % 60;
    if (minutes === 0) return `in ${hours} hour${hours > 1 ? 's' : ''}`;
    return `in ${hours} hour${hours > 1 ? 's' : ''} ${minutes} minute${minutes > 1 ? 's' : ''}`;
  };

  // Note: Meetings are now fetched on mount and refreshed every minute in the main useEffect above
  // This useEffect is kept for backwards compatibility but may be redundant
  useEffect(() => {
    const updateNextHourCount = () => {
      if (todayMeetings.length === 0) {
        setMeetingsInNextHour(0);
        setNextHourMeetings([]);
        return;
      }

      const now = new Date();
      const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);

      const meetingsList = todayMeetings
        .map((meeting: any) => {
          if (!meeting.time) return null;

          // Parse meeting time (format: HH:MM or HH:MM:SS)
          const timeParts = meeting.time.split(':');
          if (timeParts.length < 2) return null;

          const meetingHour = parseInt(timeParts[0], 10);
          const meetingMinute = parseInt(timeParts[1], 10);

          // Create meeting datetime for today
          const meetingDateTime = new Date(now);
          meetingDateTime.setHours(meetingHour, meetingMinute, 0, 0);

          // Check if meeting is between now and one hour from now
          if (meetingDateTime >= now && meetingDateTime <= oneHourLater) {
            return {
              ...meeting,
              meetingDateTime
            };
          }
          return null;
        })
        .filter(Boolean)
        .sort((a: any, b: any) => a.meetingDateTime.getTime() - b.meetingDateTime.getTime());

      setMeetingsInNextHour(meetingsList.length);
      setNextHourMeetings(meetingsList);
    };

    // Update immediately
    updateNextHourCount();

    // Update every minute
    const interval = setInterval(updateNextHourCount, 60000);

    return () => clearInterval(interval);
  }, [todayMeetings]);

  const refreshDashboardMessages = useCallback(async () => {
    const resetEmpty = () => {
      setLatestMessages([]);
      setLatestMessagesAllLeads([]);
      setDashboardIsSuperuser(false);
    };

    try {
      const user = await resolveDashboardAuthUser();
      if (!user) {
        resetEmpty();
        return;
      }

      let { data: userRow, error: userRowError } = await supabase
        .from('users')
        .select(`
          id,
          is_superuser,
          employee_id,
          full_name,
          tenants_employee!employee_id(
            id,
            display_name
          )
        `)
        .eq('auth_id', user.id)
        .maybeSingle();

      if ((!userRow || userRowError) && user.email) {
        const retry = await supabase
          .from('users')
          .select(`
            id,
            is_superuser,
            employee_id,
            full_name,
            tenants_employee!employee_id(
              id,
              display_name
            )
          `)
          .eq('email', user.email)
          .maybeSingle();
        userRow = retry.data;
        userRowError = retry.error;
      }

      if (userRowError || !userRow) {
        resetEmpty();
        return;
      }

      const superuserStatus =
        userRow.is_superuser === true ||
        userRow.is_superuser === 'true' ||
        userRow.is_superuser === 1;
      setDashboardIsSuperuser(superuserStatus);

      const empData = Array.isArray(userRow.tenants_employee)
        ? userRow.tenants_employee[0]
        : userRow.tenants_employee;
      const displayName = String(empData?.display_name || userRow.full_name || '').trim();
      const employeeId =
        userRow.employee_id != null && userRow.employee_id !== ''
          ? Number(userRow.employee_id)
          : null;

      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const since = sevenDaysAgo.toISOString();
      const emailFetchLimit = 50;
      // Unread + role filter shrinks the list; fetch more so "My contacts" can still fill the widget.
      const whatsappFetchLimit = 120;

      const LEADS_DASHBOARD_ROLE_SELECT = `
            id,
            closer,
            scheduler,
            handler,
            case_handler_id,
            manager,
            expert,
            expert_id,
            helper,
            meeting_lawyer_id,
            lawyer,
            retainer_handler_id,
            meeting_collection_id,
            marketing_officer_id,
            meeting_manager_id
          `;

      const LEGACY_DASHBOARD_ROLE_SELECT = `
              id,
              closer_id,
              meeting_scheduler_id,
              meeting_manager_id,
              meeting_lawyer_id,
              case_handler_id,
              expert_id,
              retainer_handler_id,
              meeting_collection_id,
              marketing_officer_id
            `;

      const fetchDashboardLeadsByIdsBatched = async (ids: string[]): Promise<any[]> => {
        const uniq = [...new Set(ids.map((x) => String(x).trim()).filter(Boolean))];
        const CHUNK = 80;
        const merged: any[] = [];
        const seen = new Set<string>();
        for (let i = 0; i < uniq.length; i += CHUNK) {
          const chunk = uniq.slice(i, i + CHUNK);
          const { data, error } = await supabase
            .from('leads')
            .select(LEADS_DASHBOARD_ROLE_SELECT)
            .in('id', chunk);
          if (error) {
            console.error('Dashboard inbox: batched leads fetch error', error);
            continue;
          }
          for (const row of data || []) {
            const k = String((row as any).id);
            if (k && !seen.has(k)) {
              seen.add(k);
              merged.push(row);
            }
          }
        }
        return merged;
      };

      const fetchDashboardLegacyByIdsBatched = async (idNums: number[]): Promise<any[]> => {
        const uniq = [...new Set(idNums.filter((n) => !Number.isNaN(n)))];
        const CHUNK = 120;
        const merged: any[] = [];
        for (let i = 0; i < uniq.length; i += CHUNK) {
          const chunk = uniq.slice(i, i + CHUNK);
          const { data, error } = await supabase
            .from('leads_lead')
            .select(LEGACY_DASHBOARD_ROLE_SELECT)
            .in('id', chunk);
          if (error) {
            console.error('Dashboard inbox: batched legacy leads fetch error', error);
            continue;
          }
          if (data) merged.push(...data);
        }
        return merged;
      };

      const [{ data: recentEmails }, { data: recentWhatsApp }] = await Promise.all([
        supabase
          .from('emails')
          .select(`
            id,
            message_id,
            client_id,
            sender_name,
            sender_email,
            subject,
            body_preview,
            sent_at,
            direction,
            leads:client_id (
              id,
              name,
              lead_number,
              email
            )
          `)
          .eq('direction', 'incoming')
          .gte('sent_at', since)
          .order('sent_at', { ascending: false })
          .limit(emailFetchLimit),
        supabase
          .from('whatsapp_messages')
          .select(`
            id,
            lead_id,
            sender_name,
            message,
            sent_at,
            direction,
            is_read,
            leads:lead_id (
              id,
              name,
              lead_number,
              email
            )
          `)
          .eq('direction', 'in')
          .or('is_read.is.null,is_read.eq.false')
          .gte('sent_at', since)
          .order('sent_at', { ascending: false })
          .limit(whatsappFetchLimit),
      ]);

      const allMessages: any[] = [];

      if (recentEmails) {
        recentEmails.forEach((email) => {
          if (email.leads && typeof email.leads === 'object' && 'name' in email.leads) {
            const leads = email.leads as any;
            allMessages.push({
              id: email.message_id,
              type: 'email',
              client_name: leads.name,
              lead_number: leads.lead_number,
              content: email.subject || email.body_preview || 'Email received',
              sender: email.sender_name || email.sender_email,
              created_at: email.sent_at,
              client_id: email.client_id,
              direction: email.direction,
            });
          }
        });
      }

      if (recentWhatsApp) {
        recentWhatsApp.forEach((msg) => {
          if (msg.leads && typeof msg.leads === 'object' && 'name' in msg.leads) {
            const leads = msg.leads as any;
            allMessages.push({
              id: msg.id,
              type: 'whatsapp',
              client_name: leads.name,
              lead_number: leads.lead_number,
              content: msg.message,
              sender: msg.sender_name || 'Client',
              created_at: msg.sent_at,
              client_id: msg.lead_id,
              direction: msg.direction,
            });
          }
        });
      }

      const sortedAll = allMessages.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      const leadIds = [...new Set(sortedAll.map((m) => m.client_id).filter(Boolean).map((id) => String(id)))];
      const leadsMap = new Map<string, any>();
      const legacyMap = new Map<number, any>();

      if (leadIds.length > 0) {
        const leadsRows = await fetchDashboardLeadsByIdsBatched(leadIds);

        for (const row of leadsRows || []) {
          if (row?.id != null) leadsMap.set(String(row.id), row);
        }

        // Optional FK on some DBs; omit from select when column missing (WhatsAppPage pattern).
        const legacyIds = [
          ...new Set(
            (leadsRows || [])
              .map((r: any) => r.legacy_lead_id)
              .filter((x: any) => x != null && x !== '')
              .map((x: any) => Number(x))
              .filter((n: number) => !Number.isNaN(n))
          ),
        ];

        if (legacyIds.length > 0) {
          const legacyRows = await fetchDashboardLegacyByIdsBatched(legacyIds);
          for (const lr of legacyRows || []) {
            if (lr?.id != null) legacyMap.set(Number(lr.id), lr);
          }
        }
      }

      const messageHasMyRole = (msg: any) => {
        const lid = msg.client_id;
        if (lid == null || lid === '') return false;
        const newLead = leadsMap.get(String(lid));
        if (!newLead) return false;
        const legRaw = (newLead as any).legacy_lead_id;
        const legNum = legRaw != null && legRaw !== '' ? Number(legRaw) : NaN;
        const legacyRow =
          !Number.isNaN(legNum) && legacyMap.has(legNum) ? legacyMap.get(legNum) : null;
        return employeeHasAnySalesRoleOnLeadBundle(newLead, legacyRow, employeeId, displayName);
      };

      const myContactsMessages = sortedAll.filter(messageHasMyRole).slice(0, 5);
      const allLeadsTop = sortedAll.slice(0, 5);

      setLatestMessages(myContactsMessages);
      setLatestMessagesAllLeads(superuserStatus ? allLeadsTop : []);
    } catch {
      setLatestMessages([]);
      setLatestMessagesAllLeads([]);
    }
  }, [resolveDashboardAuthUser]);

  // Update meetingsToday count when todayMeetings changes
  useEffect(() => {
    setMeetingsToday(todayMeetings.length);
  }, [todayMeetings]);

  // Fetch summary data (mocked for now, replace with real queries)
  useEffect(() => {
    // Fetch today's followups count - optimized count query using employee relationship
    (async () => {
      // Prevent multiple calls
      if (overdueCountFetched) return;
      setOverdueCountFetched(true);

      try {
        // Get current user's data with employee relationship using JOIN
        const user = await resolveDashboardAuthUser();
        if (!user) {
          setOverdueFollowups(0);
          return;
        }
        const { data: userData, error: userDataError } = await supabase
          .from('users')
          .select(`
            id,
            full_name,
            employee_id,
            tenants_employee!employee_id(
              id,
              display_name
            )
          `)
          .eq('auth_id', user.id)
          .maybeSingle();

        if (userDataError || !userData) {
          setOverdueFollowups(0);
          return;
        }

        if (!userData) {
          setOverdueFollowups(0);
          return;
        }

        // Same pipeline as the Today tab + processOverdueLeadsForDisplay so the card matches visible rows
        const { newLeads, legacyLeads } = await fetchFollowUpLeadsData('today', true);
        const combinedLeads = [...newLeads, ...legacyLeads];
        const processedLeads = await processOverdueLeadsForDisplay(combinedLeads, true);
        setOverdueFollowups(processedLeads.length);
      } catch (error) {
        setOverdueFollowups(0);
      }
    })();
    void refreshDashboardMessages();
  }, [refreshDashboardMessages]);

  useEffect(() => {
    if (!dashboardIsSuperuser && isTeamStatusModalOpen) {
      setIsTeamStatusModalOpen(false);
    }
  }, [dashboardIsSuperuser, isTeamStatusModalOpen]);

  // Graph data (mocked)
  const meetingsPerMonth = [
    { month: 'June 2025', count: 64 },
    { month: 'July 2025', count: 74 },
    { month: `${currentMonthName} 2025`, count: 41 },
  ];
  // Mock data for contracts signed by category
  const contractsByCategory = [
    { category: 'German Citizenship', count: 14, amount: 168000 },
    { category: 'Austrian Citizenship', count: 7, amount: 98000 },
    { category: 'Business Visa', count: 4, amount: 48000 },
    { category: 'Family Reunification', count: 3, amount: 36000 },
    { category: 'Other', count: 2, amount: 24000 },
  ];





  // Calculate date array for last 30 days
  const today = new Date();
  const daysArray = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (29 - i));
    return d;
  });

  // Use real performance data if available, otherwise use empty array
  const performanceData = realPerformanceData.length > 0 ? realPerformanceData : daysArray.map((date) => ({
    date: date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
    count: 0,
    isToday: date.toDateString() === today.toDateString(),
    isThisMonth: date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear(),
  }));

  // Use real team average data if available, otherwise use empty array
  const teamAverageData = realTeamAverageData.length > 0 ? realTeamAverageData : daysArray.map((date) => ({
    date: date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
    avg: 0
  }));

  const contractsToday = performanceData.find(d => d.isToday)?.count || 0;
  const contractsThisMonth = performanceData.filter(d => d.isThisMonth).reduce((sum: number, d: { count: number; isThisMonth: boolean }) => sum + d.count, 0);
  const contractsLast30 = performanceData.reduce((sum: number, d: { count: number }) => sum + d.count, 0);

  // Remove dropdown state
  const [showLeadsList, setShowLeadsList] = React.useState(false);

  // Real data for Score Board
  const [realRevenueThisMonth, setRealRevenueThisMonth] = useState<number>(0);
  const [revenueLoading, setRevenueLoading] = useState<boolean>(true);
  const REVENUE_TARGET = 2000000; // 2M target

  // Lead growth data
  const [totalLeadsThisMonth, setTotalLeadsThisMonth] = useState<number>(0);
  const [totalLeadsLastMonth, setTotalLeadsLastMonth] = useState<number>(0);
  const [leadsLoading, setLeadsLoading] = useState<boolean>(true);

  // Conversion rate data
  const [meetingsScheduledThisMonth, setMeetingsScheduledThisMonth] = useState<number>(0);
  const [totalExistingLeads, setTotalExistingLeads] = useState<number>(0);
  const [conversionLoading, setConversionLoading] = useState<boolean>(true);

  // Contracts signed data
  const [contractsSignedThisMonth, setContractsSignedThisMonth] = useState<number>(0);
  const [contractsSignedLastMonth, setContractsSignedLastMonth] = useState<number>(0);
  const [contractsLoading, setContractsLoading] = useState<boolean>(true);

  // Department Performance data
  const [departmentPerformanceLoading, setDepartmentPerformanceLoading] = useState<boolean>(true);
  const [invoicedDataLoading, setInvoicedDataLoading] = useState<boolean>(true);

  // State for real chart data (daily department performance)
  const [departmentChartData, setDepartmentChartData] = useState<{
    [category: string]: { date: string; contracts: number; amount: number }[];
  }>({});

  // Fetch real revenue this month - DEFERRED
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      const fetchRevenueThisMonth = async () => {
      setRevenueLoading(true);
      try {
        const now = new Date();
        const thisMonth = now.getMonth();
        const thisYear = now.getFullYear();
        const startOfMonth = new Date(thisYear, thisMonth, 1);
        const endOfMonth = new Date(thisYear, thisMonth + 1, 0);

        const { data, error } = await supabase
          .from('payment_plans')
          .select('value, value_vat, paid_at')
          .eq('paid', true)
          .gte('paid_at', startOfMonth.toISOString())
          .lte('paid_at', endOfMonth.toISOString());

        if (!error && data) {
          const total = data.reduce((sum: number, row: { value: string | number; value_vat: string | number }) => {
            return sum + (Number(row.value) + Number(row.value_vat));
          }, 0);
          setRealRevenueThisMonth(total);
        } else {
          setRealRevenueThisMonth(0);
        }
      } catch (error) {
        setRealRevenueThisMonth(0);
      } finally {
        setRevenueLoading(false);
      }
    };

      fetchRevenueThisMonth();
    }, 0);
    return () => clearTimeout(timeoutId);
  }, []);

  // Fetch lead growth data - DEFERRED
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      const fetchLeadGrowth = async () => {
      setLeadsLoading(true);
      try {
        const now = new Date();
        const thisMonth = now.getMonth();
        const thisYear = now.getFullYear();

        // This month
        const startOfThisMonth = new Date(thisYear, thisMonth, 1);
        const endOfThisMonth = new Date(thisYear, thisMonth + 1, 0);

        // Last month
        const lastMonth = thisMonth === 0 ? 11 : thisMonth - 1;
        const lastMonthYear = thisMonth === 0 ? thisYear - 1 : thisYear;
        const startOfLastMonth = new Date(lastMonthYear, lastMonth, 1);
        const endOfLastMonth = new Date(lastMonthYear, lastMonth + 1, 0);

        // Fetch this month's leads
        const { data: thisMonthData, error: thisMonthError } = await supabase
          .from('leads')
          .select('id')
          .gte('created_at', startOfThisMonth.toISOString())
          .lte('created_at', endOfThisMonth.toISOString());

        // Fetch last month's leads
        const { data: lastMonthData, error: lastMonthError } = await supabase
          .from('leads')
          .select('id')
          .gte('created_at', startOfLastMonth.toISOString())
          .lte('created_at', endOfLastMonth.toISOString());

        if (!thisMonthError && thisMonthData) {
          setTotalLeadsThisMonth(thisMonthData.length);
        } else {
          setTotalLeadsThisMonth(0);
        }

        if (!lastMonthError && lastMonthData) {
          setTotalLeadsLastMonth(lastMonthData.length);
        } else {
          setTotalLeadsLastMonth(0);
        }
      } catch (error) {
        setTotalLeadsThisMonth(0);
        setTotalLeadsLastMonth(0);
      } finally {
        setLeadsLoading(false);
      }
    };

      fetchLeadGrowth();
    }, 0);
    return () => clearTimeout(timeoutId);
  }, []);

  // Fetch conversion rate data - DEFERRED
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      const fetchConversionRate = async () => {
      setConversionLoading(true);
      try {
        const now = new Date();
        const thisMonth = now.getMonth();
        const thisYear = now.getFullYear();
        const startOfThisMonth = new Date(thisYear, thisMonth, 1, 0, 0, 0, 0);
        const endOfThisMonth = new Date(thisYear, thisMonth + 1, 0, 23, 59, 59, 999);



        // Get new leads created this month
        const { data: newLeadsData, error: newLeadsError } = await supabase
          .from('leads')
          .select('id, created_at')
          .gte('created_at', startOfThisMonth.toISOString())
          .lte('created_at', endOfThisMonth.toISOString());



        // Get meetings scheduled this month (no duplicates per client)
        const { data: meetingsData, error: meetingsError } = await supabase
          .from('meetings')
          .select('client_id, created_at, status')
          .gte('created_at', startOfThisMonth.toISOString())
          .lte('created_at', endOfThisMonth.toISOString())
          .eq('status', 'scheduled');



        if (!newLeadsError && newLeadsData) {
          setTotalExistingLeads(newLeadsData.length);
        } else {
          setTotalExistingLeads(0);
        }

        if (!meetingsError && meetingsData) {
          // Remove duplicates per client (client_id)
          const uniqueClientIds = [...new Set(meetingsData.map(meeting => meeting.client_id))];
          setMeetingsScheduledThisMonth(uniqueClientIds.length);

        } else {
          setMeetingsScheduledThisMonth(0);
        }
      } catch (error) {
        setTotalExistingLeads(0);
        setMeetingsScheduledThisMonth(0);
      } finally {
        setConversionLoading(false);
      }
    };

      fetchConversionRate();
    }, 0);
    return () => clearTimeout(timeoutId);
  }, []);

  // Fetch contracts signed data - DEFERRED
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      const fetchContractsSigned = async () => {
      setContractsLoading(true);
      try {
        const now = new Date();
        const thisMonth = now.getMonth();
        const thisYear = now.getFullYear();

        // This month
        const startOfThisMonth = new Date(thisYear, thisMonth, 1, 0, 0, 0, 0);
        const endOfThisMonth = new Date(thisYear, thisMonth + 1, 0, 23, 59, 59, 999);

        // Last month
        const lastMonth = thisMonth === 0 ? 11 : thisMonth - 1;
        const lastMonthYear = thisMonth === 0 ? thisYear - 1 : thisYear;
        const startOfLastMonth = new Date(lastMonthYear, lastMonth, 1, 0, 0, 0, 0);
        const endOfLastMonth = new Date(lastMonthYear, lastMonth + 1, 0, 23, 59, 59, 999);

        // Get contracts signed this month
        const { data: thisMonthContracts, error: thisMonthError } = await supabase
          .from('contracts')
          .select('id')
          .gte('created_at', startOfThisMonth.toISOString())
          .lte('created_at', endOfThisMonth.toISOString());

        // Get contracts signed last month
        const { data: lastMonthContracts, error: lastMonthError } = await supabase
          .from('contracts')
          .select('id')
          .gte('created_at', startOfLastMonth.toISOString())
          .lte('created_at', endOfLastMonth.toISOString());

        if (!thisMonthError && thisMonthContracts) {
          setContractsSignedThisMonth(thisMonthContracts.length);
        } else {
          setContractsSignedThisMonth(0);
        }

        if (!lastMonthError && lastMonthContracts) {
          setContractsSignedLastMonth(lastMonthContracts.length);
        } else {
          setContractsSignedLastMonth(0);
        }
      } catch (error) {
        setContractsSignedThisMonth(0);
        setContractsSignedLastMonth(0);
      } finally {
        setContractsLoading(false);
      }
    };

      fetchContractsSigned();
    }, 0);
    return () => clearTimeout(timeoutId);
  }, []);

  // Fetch real performance data from leads_leadstage
  const fetchPerformanceData = async (opts?: { background?: boolean }) => {
    if (!opts?.background) setPerformanceLoading(true);
    try {
      // Get current user's employee ID and full name
      const user = await resolveDashboardAuthUser();
      if (!user) {
        setPerformanceLoading(false);
        return;
      }

      // Get user's full name and employee ID
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select(`
          id,
          full_name,
          employee_id,
          tenants_employee!employee_id(
            id,
            display_name
          )
        `)
        .eq('auth_id', user.id)
        .maybeSingle();

      if (userError || !userData) {
        setPerformanceLoading(false);
        return;
      }

      const userFullName = (userData.tenants_employee as any)?.display_name || userData.full_name;
      const userEmployeeId = userData.employee_id;

      setCurrentUserFullName(userFullName || '');
      if (userEmployeeId != null) setAndCacheEmployeeId(userEmployeeId);

      // Calculate date 30 days ago
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const thirtyDaysAgoStr = thirtyDaysAgo.toISOString();

      // Fetch contracts signed (stage = 60) from last 30 days
      const { data: contractsData, error: contractsError } = await supabase
        .from('leads_leadstage')
        .select(`
          id,
          stage,
          date,
          creator_id,
          lead_id,
          newlead_id
        `)
        .eq('stage', 60)
        .gte('date', thirtyDaysAgoStr);

      if (contractsError) {
      }

      // Process contracts to determine which belong to current user
      const userContractsByDate: Record<string, number> = {};
      const allContractsByDate: Record<string, number> = {};

      // Initialize all dates with 0
      daysArray.forEach(date => {
        const dateStr = date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
        userContractsByDate[dateStr] = 0;
        allContractsByDate[dateStr] = 0;
      });

      // Process each contract
      for (const contract of contractsData || []) {
        if (!contract.date) continue;

        const contractDate = new Date(contract.date);
        const dateStr = contractDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

        // Count all contracts for team average
        allContractsByDate[dateStr] = (allContractsByDate[dateStr] || 0) + 1;

        // Check if this contract belongs to current user
        let belongsToUser = false;

        if (contract.creator_id) {
          // Use creator_id if available
          belongsToUser = contract.creator_id === userEmployeeId;
        } else {
          // If creator_id is NULL, get closer from the lead
          if (contract.newlead_id) {
            // New lead - get closer (string) from leads table
            const { data: newLead } = await supabase
              .from('leads')
              .select('closer')
              .eq('id', contract.newlead_id)
              .maybeSingle();

            if (newLead?.closer === userFullName) {
              belongsToUser = true;
            }
          } else if (contract.lead_id) {
            // Legacy lead - get closer_id (bigint) from leads_lead table
            const { data: legacyLead } = await supabase
              .from('leads_lead')
              .select('closer_id')
              .eq('id', contract.lead_id)
              .maybeSingle();

            if (legacyLead?.closer_id === userEmployeeId) {
              belongsToUser = true;
            }
          }
        }

        if (belongsToUser) {
          userContractsByDate[dateStr] = (userContractsByDate[dateStr] || 0) + 1;
        }
      }

      // Calculate team average per day
      const totalContracts = Object.values(allContractsByDate).reduce((sum, count) => sum + count, 0);
      const teamDailyAverage = totalContracts / 30; // Average per day over 30 days

      // Build performance data array
      const performanceDataArray = daysArray.map((date) => {
        const dateStr = date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
        return {
          date: dateStr,
          count: userContractsByDate[dateStr] || 0,
          isToday: date.toDateString() === today.toDateString(),
          isThisMonth: date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear(),
        };
      });

      // Build team average data array
      const teamAverageDataArray = daysArray.map((date) => {
        const dateStr = date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
        return {
          date: dateStr,
          avg: Math.round((allContractsByDate[dateStr] || 0) * 10) / 10 // Round to 1 decimal
        };
      });

      setRealPerformanceData(performanceDataArray);
      setRealTeamAverageData(teamAverageDataArray);
    } catch (error) {
    } finally {
      setPerformanceLoading(false);
    }
  };

  // Fetch performance data on mount and when live-refresh token bumps (see realtime subscription).
  useEffect(() => {
    void fetchPerformanceData({ background: scoreboardRefreshToken > 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- token drives background refetch only
  }, [scoreboardRefreshToken]);

  // Shared fetch: departments + categories (join-based). Used by both Agreement signed and Invoiced to avoid duplicate requests.
  const fetchDepartmentsAndCategories = async (): Promise<{
    departmentTargets: any[];
    departmentIds: number[];
    allCategoriesData: any[] | null;
    categoryNameToDataMap: Map<string, any>;
    targetMap: { [key: number]: number };
    otherExpected: number;
    selectedMonthName: string;
  }> => {
    const mergedTargetDeptIds = [2, 4, 5, 6];
    const salesDeptIdsToExclude = [12, 14, 15];
    const selectedMonthIndex = months.indexOf(selectedMonth);
    const selectedDate = new Date(selectedYear, selectedMonthIndex, 1);
    const selectedMonthName = selectedDate.toLocaleDateString('en-US', { month: 'long' });

    const [{ data: importantDepartments, error: importantError }, { data: mergedTargetDepts, error: mergedError }, { data: allCategoriesData, error: categoriesError }] = await Promise.all([
      supabase.from('tenant_departement').select('id, name, min_income, important').eq('important', 't').order('id'),
      supabase.from('tenant_departement').select('id, name, min_income, important').in('id', mergedTargetDeptIds).order('id'),
      supabase.from('misc_category').select(`
        id, name, parent_id,
        misc_maincategory!parent_id(
          id, name, department_id,
          tenant_departement!fk_misc_maincategory_department_id(id, name)
        )
      `).order('name', { ascending: true })
    ]);

    if (importantError) throw importantError;
    if (mergedError) console.error('Error fetching merged target departments:', mergedError);
    if (categoriesError) console.error('Error fetching categories for department mapping:', categoriesError);

    const departmentMap = new Map<number, any>();
    (importantDepartments || []).forEach((dept: any) => {
      if (!salesDeptIdsToExclude.includes(dept.id)) departmentMap.set(dept.id, dept);
    });
    (mergedTargetDepts || []).forEach((dept: any) => {
      if (!salesDeptIdsToExclude.includes(dept.id) && !departmentMap.has(dept.id)) departmentMap.set(dept.id, dept);
    });

    let departmentTargets = Array.from(departmentMap.values());
    departmentTargets = departmentTargets.filter((dept: any) => {
      if (dept.id === 20) return true;
      if (dept.name === 'Commercial - Sales' || dept.name?.includes('Commercial - Sales')) return false;
      if (departmentMap.has(20) && (dept.name === 'Commercial & Civil' || dept.name?.includes('Commercial & Civil'))) return false;
      return true;
    });
    departmentTargets = departmentTargets.map((dept: any) =>
      dept.id === 20 ? { ...dept, name: 'Commercial & Civil' } : dept
    );
    departmentTargets.sort((a: any, b: any) => a.id - b.id);
    const departmentIds = departmentTargets.map((d: any) => d.id);

    let otherExpected = 0;
    try {
      const scoreboardRefs = departmentTargets.map((d: any) => ({ id: d.id, name: String(d.name || '') }));
      const [costByDept, otherCost] = await Promise.all([
        fetchDashboardDepartmentCostTargets(scoreboardRefs, { salesDeptIdsToExclude }),
        fetchDashboardOtherColumnCostTarget(scoreboardRefs, { salesDeptIdsToExclude }),
      ]);
      departmentTargets = applyDashboardCostTargetsToDepartments(departmentTargets, costByDept);
      otherExpected = otherScoreboardExpected(otherCost);
    } catch (costErr) {
      console.error('[Dashboard] department cost targets failed:', costErr);
      departmentTargets = departmentTargets.map((dept: any) => ({
        ...dept,
        cost_target: parseFloat(dept.min_income || '0') || 0,
      }));
    }

    const categoryNameToDataMap = new Map<string, any>();
    (allCategoriesData || []).forEach((category: any) => {
      if (category.name) categoryNameToDataMap.set(category.name.trim().toLowerCase(), category);
    });

    const targetMap: { [key: number]: number } = {};
    departmentTargets.forEach((dept: any) => {
      targetMap[dept.id] = departmentScoreboardExpected(dept);
    });

    return {
      departmentTargets,
      departmentIds,
      allCategoriesData: allCategoriesData || null,
      categoryNameToDataMap,
      targetMap,
      otherExpected,
      selectedMonthName,
    };
  };

  // Fetch department performance data
  const fetchDepartmentPerformance = async (
    shared?: Awaited<ReturnType<typeof fetchDepartmentsAndCategories>>,
    opts?: { background?: boolean },
  ) => {
    if (!opts?.background) setDepartmentPerformanceLoading(true);
    try {
      const now = new Date();
      const today = new Date();
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(now.getDate() - 30);

      const selectedMonthIndex = months.indexOf(selectedMonth);
      const selectedDate = new Date(selectedYear, selectedMonthIndex, 1);
      const selectedMonthName = selectedDate.toLocaleDateString('en-US', { month: 'long' });

      let departmentTargets: any[];
      let departmentIds: number[];
      let allCategoriesData: any[] | null;
      let categoryNameToDataMap: Map<string, any>;
      let otherExpected = 0;

      if (shared) {
        departmentTargets = shared.departmentTargets;
        departmentIds = shared.departmentIds;
        allCategoriesData = shared.allCategoriesData;
        categoryNameToDataMap = shared.categoryNameToDataMap;
        otherExpected = shared.otherExpected ?? 0;
      } else {
        const mergedTargetDeptIds = [2, 4, 5, 6];
        const salesDeptIdsToExclude = [12, 14, 15];

        const { data: importantDepartments, error: importantError } = await supabase
          .from('tenant_departement')
          .select('id, name, min_income, important')
          .eq('important', 't')
          .order('id');
        if (importantError) throw importantError;

        const { data: mergedTargetDepts, error: mergedError } = await supabase
          .from('tenant_departement')
          .select('id, name, min_income, important')
          .in('id', mergedTargetDeptIds)
          .order('id');
        if (mergedError) console.error('Error fetching merged target departments:', mergedError);

        const departmentMap = new Map<number, any>();
        (importantDepartments || []).forEach(dept => {
          if (!salesDeptIdsToExclude.includes(dept.id)) departmentMap.set(dept.id, dept);
        });
        (mergedTargetDepts || []).forEach(dept => {
          if (!salesDeptIdsToExclude.includes(dept.id) && !departmentMap.has(dept.id)) departmentMap.set(dept.id, dept);
        });

        let deptTargets = Array.from(departmentMap.values());
        deptTargets = deptTargets.filter(dept => {
          if (dept.id === 20) return true;
          if (dept.name === 'Commercial - Sales' || dept.name?.includes('Commercial - Sales')) return false;
          if (departmentMap.has(20) && (dept.name === 'Commercial & Civil' || dept.name?.includes('Commercial & Civil'))) return false;
          return true;
        });
        departmentTargets = deptTargets.map(dept => (dept.id === 20 ? { ...dept, name: 'Commercial & Civil' } : dept));
        departmentTargets.sort((a, b) => a.id - b.id);
        departmentIds = departmentTargets.map(dept => dept.id);

        const { data: categoriesData, error: categoriesError } = await supabase
          .from('misc_category')
          .select(`
            id, name, parent_id,
            misc_maincategory!parent_id(
              id, name, department_id,
              tenant_departement!fk_misc_maincategory_department_id(id, name)
            )
          `)
          .order('name', { ascending: true });
        if (categoriesError) console.error('Error fetching categories for department mapping:', categoriesError);
        allCategoriesData = categoriesData || null;
        categoryNameToDataMap = new Map<string, any>();
        (allCategoriesData || []).forEach((category: any) => {
          if (category.name) categoryNameToDataMap.set(category.name.trim().toLowerCase(), category);
        });

        try {
          const scoreboardRefs = departmentTargets.map((d: any) => ({ id: d.id, name: String(d.name || '') }));
          const [costByDept, otherCost] = await Promise.all([
            fetchDashboardDepartmentCostTargets(scoreboardRefs, { salesDeptIdsToExclude }),
            fetchDashboardOtherColumnCostTarget(scoreboardRefs, { salesDeptIdsToExclude }),
          ]);
          departmentTargets = applyDashboardCostTargetsToDepartments(departmentTargets, costByDept);
          otherExpected = otherScoreboardExpected(otherCost);
        } catch (costErr) {
          console.error('[Dashboard Agreement Signed] department cost targets failed:', costErr);
          departmentTargets = departmentTargets.map((dept: any) => ({
            ...dept,
            cost_target: parseFloat(dept.min_income || '0') || 0,
          }));
        }
      }

      // Log which departments are important
      const importantDepts = departmentTargets.filter(dept => dept.important === 't');
      // Debug: Log each department with its index
      departmentTargets.forEach((dept, index) => {
      });

      // Set department names for UI display (main departments + Other bucket)
      const names = [...departmentTargets.map(dept => dept.name), SCOREBOARD_OTHER_COLUMN];
      setDepartmentNames(names);
      // Debug: Show the exact mapping of ID -> Name -> Target
      departmentTargets.forEach((dept, index) => {
      });

      const targetMap = shared?.targetMap ?? (() => {
        const t: { [key: number]: number } = {};
        departmentTargets?.forEach((dept: any) => { t[dept.id] = departmentScoreboardExpected(dept); });
        return t;
      })();
      // Initialize data structure dynamically based on actual departments
      const newAgreementData = {
        Today: buildScoreboardPeriodRows(departmentTargets, otherExpected),
        Yesterday: buildScoreboardPeriodRows(departmentTargets, otherExpected),
        Week: buildScoreboardPeriodRows(departmentTargets, otherExpected),
        "Last 30d": buildScoreboardPeriodRows(departmentTargets, otherExpected),
        [SCOREBOARD_LAST_3M]: buildScoreboardPeriodRows(departmentTargets, otherExpected),
        [selectedMonthName]: buildScoreboardMonthRows(departmentTargets, otherExpected),
      };
      const agreementDealsStore = new Map<string, DashboardScoreboardDeal[]>();
      const pushAgreementPeriodDeal = (
        period: string,
        deptIndex: number,
        deal: Omit<DashboardScoreboardDeal, 'departmentName' | 'source'> & { departmentName?: string },
      ) => {
        const columnName = getScoreboardPeriodColumnName(deptIndex, departmentTargets);
        if (!columnName) return;
        const row: DashboardScoreboardDeal = {
          ...deal,
          departmentName: columnName,
          source: 'agreement',
        };
        appendScoreboardDeal(agreementDealsStore, period, columnName, row);
        appendScoreboardDeal(agreementDealsStore, period, 'Total', { ...row, id: `${row.id}::total` });
      };
      const pushAgreementMonthDeal = (
        deptIndex: number,
        deal: Omit<DashboardScoreboardDeal, 'departmentName' | 'source'> & { departmentName?: string },
      ) => {
        const columnName = getScoreboardMonthColumnName(deptIndex, departmentTargets);
        if (!columnName) return;
        const row: DashboardScoreboardDeal = {
          ...deal,
          departmentName: columnName,
          source: 'agreement',
        };
        appendScoreboardDeal(agreementDealsStore, selectedMonthName, columnName, row);
        appendScoreboardDeal(agreementDealsStore, selectedMonthName, 'Total', { ...row, id: `${row.id}::total` });
      };

      // Calculate date ranges (Asia/Jerusalem — matches SignedSalesReportPage)
      const { todayStr, yesterdayStr, oneWeekAgoStr, thirtyDaysAgoStr: last30dStartDate } =
        getJerusalemScoreboardDates(today);
      const last3mStartDate = getLast3MonthsStartDate(todayStr);
      const effectiveLast30dEnd = todayStr;

      // Fix timezone issue: Use UTC to avoid timezone conversion problems
      const startOfMonth = new Date(Date.UTC(selectedYear, selectedMonthIndex, 1));
      const startOfMonthStr = startOfMonth.toISOString().split('T')[0];
      // Calculate end of month here so we can use it for effectiveLast30dEnd
      const endOfMonth = new Date(selectedYear, selectedMonthIndex + 1, 0);
      const endOfMonthStr = endOfMonth.toISOString().split('T')[0];

      // Fetch stage 60 (agreement signed) — same widened SQL + Jerusalem calendar filter as SignedSalesReportPage
      let allStage60InWindow: any[] = [];
      let stageFetchError: any = null;
      try {
        allStage60InWindow = await fetchStage60RecordsInRange(last3mStartDate, effectiveLast30dEnd);
      } catch (err: any) {
        stageFetchError = err;
      }
      if (stageFetchError) {
        // Don't throw, continue without stage records
      }

      const stageRecords = allStage60InWindow.filter((r) => r.lead_id != null);
      const newLeadStageRecords = allStage60InWindow.filter((r) => r.newlead_id != null);

      // Combine all new lead IDs (only from leads_leadstage for stage 60)
      const newLeadIdsSet = new Set<string>();
      (newLeadStageRecords || []).forEach(record => {
        if (record.newlead_id) newLeadIdsSet.add(String(record.newlead_id));
      });

      const newLeadIds = Array.from(newLeadIdsSet);
      // Fetch new leads data
      let newLeadsData: any[] = [];
      if (newLeadIds.length > 0) {
        const { data: newLeads, error: newLeadsError } = await supabase
          .from('leads')
          .select(`
              id, lead_number, name, balance, proposal_total, currency_id, balance_currency, proposal_currency, subcontractor_fee, category, category_id, closer, handler,
              misc_category!category_id(
                id, name, parent_id,
                misc_maincategory!parent_id(
                  id, name, department_id,
                  tenant_departement!fk_misc_maincategory_department_id(id, name)
                )
              )
            `)
          .in('id', newLeadIds);

        if (newLeadsError) {
          // Don't throw, continue without new leads
        } else {
          newLeadsData = newLeads || [];
        }
      }

      // Fetch leads data separately if we have stage records
      let agreementRecords: any[] = [];

      // Process legacy leads
      if (stageRecords && stageRecords.length > 0) {
        const leadIds = [...new Set(stageRecords.map(record => record.lead_id).filter(id => id !== null))];
        const { data: leadsData, error: leadsError } = await supabase
          .from('leads_lead')
          .select(`
              id, lead_number, name, total, total_base, currency_id, subcontractor_fee, meeting_total_currency_id, closer_id, case_handler_id,
              accounting_currencies!leads_lead_currency_id_fkey(
                id,
                iso_code,
                name
              ),
              misc_category(
                id, name, parent_id,
                misc_maincategory(
                  id, name, department_id,
                  tenant_departement!fk_misc_maincategory_department_id(id, name)
                )
              ),
              closer_employee:tenants_employee!fk_leads_lead_closer_id(id, display_name, photo_url, photo),
              handler_employee:tenants_employee!fk_leads_lead_case_handler_id(id, display_name, photo_url, photo)
            `)
          .in('id', leadIds);

        if (leadsError) {
          throw leadsError;
        }
        // Deduplicate stage records: keep only the latest date for each lead_id
        const leadRecordsMap = new Map<number, any>();
        stageRecords.forEach(stageRecord => {
          if (!stageRecord.lead_id) return;
          const leadId = stageRecord.lead_id;
          const recordDate = stageRecord.date || stageRecord.cdate;
          if (!recordDate) return;

          const existingRecord = leadRecordsMap.get(leadId);
          if (!existingRecord) {
            leadRecordsMap.set(leadId, stageRecord);
          } else {
            const existingDate = existingRecord.date || existingRecord.cdate;
            if (existingDate && new Date(recordDate) > new Date(existingDate)) {
              // This record has a later date, replace the existing one
              leadRecordsMap.set(leadId, stageRecord);
            }
          }
        });

        // Convert map back to array
        const deduplicatedStageRecords = Array.from(leadRecordsMap.values());

        // Join the legacy data
        const leadsMap = new Map(leadsData?.map(lead => [lead.id, lead]) || []);
        const legacyRecords = deduplicatedStageRecords.map(stageRecord => {
          const lead = leadsMap.get(stageRecord.lead_id);
          // Use date as the sign date (preferred) or cdate as fallback
          const recordDate = stageRecord.date || stageRecord.cdate;
          return {
            ...stageRecord,
            date: recordDate,
            leads_lead: lead || null,
            isNewLead: false
          };
        }).filter(record => record.leads_lead !== null);

        agreementRecords.push(...legacyRecords);
      }

      // Process new leads - create records ONLY from stage records (leads_leadstage for stage 60)
      // Do NOT include contracts - match SignedSalesReportPage behavior
      // Deduplicate new lead stage records: keep only the latest date for each newlead_id
      const newLeadRecordsMap = new Map<string, any>();
      (newLeadStageRecords || []).forEach(record => {
        if (!record.newlead_id) return;
        const newLeadId = String(record.newlead_id);
        const recordDate = record.date || record.cdate;
        if (!recordDate) return;

        const existingRecord = newLeadRecordsMap.get(newLeadId);
        if (!existingRecord) {
          newLeadRecordsMap.set(newLeadId, record);
        } else {
          const existingDate = existingRecord.date || existingRecord.cdate;
          if (existingDate && new Date(recordDate) > new Date(existingDate)) {
            // This record has a later date, replace the existing one
            newLeadRecordsMap.set(newLeadId, record);
          }
        }
      });

      // Convert map back to array
      const deduplicatedNewLeadStageRecords = Array.from(newLeadRecordsMap.values());

      const newLeadsMap = new Map(newLeadsData.map(lead => [String(lead.id), lead]));

      // Create records from deduplicated new lead stage records (only source - no contracts)
      deduplicatedNewLeadStageRecords.forEach(record => {
        if (!record.newlead_id) return;
        const lead = newLeadsMap.get(String(record.newlead_id));
        if (!lead) return;
        const recordDate = resolveStage60SignTimestamp(record);
        agreementRecords.push({
          id: `newstage-${record.id}`,
          date: recordDate,
          cdate: record.date || record.cdate,
          lead_id: null,
          newlead_id: String(record.newlead_id),
          leads_lead: lead,
          isNewLead: true
        });
      });

      const resolveLeadDepartment = (lead: any) =>
        resolveCategoryAndDepartment(
          lead?.category,
          lead?.category_id,
          lead?.misc_category,
          allCategoriesData,
          categoryNameToDataMap,
        );

      // Fetch data for selected month (Jerusalem calendar filter — same as SignedSalesReportPage)
      let monthStage60Records: any[] = [];
      try {
        monthStage60Records = await fetchStage60RecordsInRange(startOfMonthStr, endOfMonthStr);
      } catch (monthStageError) {
        throw monthStageError;
      }
      const monthStageRecords = monthStage60Records.filter((r) => r.lead_id != null);
      const monthNewLeadStageRecords = monthStage60Records.filter((r) => r.newlead_id != null);
      // Combine all new lead IDs for month (only from leads_leadstage for stage 60)
      const monthNewLeadIdsSet = new Set<string>();
      (monthNewLeadStageRecords || []).forEach(record => {
        if (record.newlead_id) monthNewLeadIdsSet.add(String(record.newlead_id));
      });

      const monthNewLeadIds = Array.from(monthNewLeadIdsSet);
      // Fetch month new leads data
      let monthNewLeadsData: any[] = [];
      if (monthNewLeadIds.length > 0) {
        const { data: monthNewLeads, error: monthNewLeadsError } = await supabase
          .from('leads')
          .select(`
              id, lead_number, name, balance, proposal_total, currency_id, balance_currency, proposal_currency, subcontractor_fee, category, category_id, closer, handler,
              misc_category!category_id(
                id, name, parent_id,
                misc_maincategory!parent_id(
                  id, name, department_id,
                  tenant_departement!fk_misc_maincategory_department_id(id, name)
                )
              )
            `)
          .in('id', monthNewLeadIds);

        if (monthNewLeadsError) {
        } else {
          monthNewLeadsData = monthNewLeads || [];
        }
      }

      // Fetch leads data separately for month if we have stage records
      let monthAgreementRecords: any[] = [];

      // Process legacy leads for month
      if (monthStageRecords && monthStageRecords.length > 0) {
        const monthLeadIds = [...new Set(monthStageRecords.map(record => record.lead_id).filter(id => id !== null))];
        const { data: monthLeadsData, error: monthLeadsError } = await supabase
          .from('leads_lead')
          .select(`
              id, lead_number, name, total, total_base, currency_id, subcontractor_fee, meeting_total_currency_id, closer_id, case_handler_id,
              accounting_currencies!leads_lead_currency_id_fkey(
                id,
                iso_code,
                name
              ),
              misc_category(
                id, name, parent_id,
                misc_maincategory(
                  id, name, department_id,
                  tenant_departement!fk_misc_maincategory_department_id(id, name)
                )
              ),
              closer_employee:tenants_employee!fk_leads_lead_closer_id(id, display_name, photo_url, photo),
              handler_employee:tenants_employee!fk_leads_lead_case_handler_id(id, display_name, photo_url, photo)
            `)
          .in('id', monthLeadIds);

        if (monthLeadsError) {
          throw monthLeadsError;
        }
        // Deduplicate month stage records: keep only the latest date for each lead_id
        const monthLeadRecordsMap = new Map<number, any>();
        monthStageRecords.forEach(stageRecord => {
          if (!stageRecord.lead_id) return;
          const leadId = stageRecord.lead_id;
          const recordDate = stageRecord.date || stageRecord.cdate;
          if (!recordDate) return;

          const existingRecord = monthLeadRecordsMap.get(leadId);
          if (!existingRecord) {
            monthLeadRecordsMap.set(leadId, stageRecord);
          } else {
            const existingDate = existingRecord.date || existingRecord.cdate;
            if (existingDate && new Date(recordDate) > new Date(existingDate)) {
              // This record has a later date, replace the existing one
              monthLeadRecordsMap.set(leadId, stageRecord);
            }
          }
        });

        // Convert map back to array
        const deduplicatedMonthStageRecords = Array.from(monthLeadRecordsMap.values());

        // Join the legacy data
        const monthLeadsMap = new Map(monthLeadsData?.map(lead => [lead.id, lead]) || []);
        const monthLegacyRecords = deduplicatedMonthStageRecords.map(stageRecord => {
          const lead = monthLeadsMap.get(stageRecord.lead_id);
          // Use date as the sign date (preferred) or cdate as fallback
          const recordDate = (stageRecord.date || stageRecord.cdate || '').split('T')[0];
          return {
            ...stageRecord,
            date: recordDate,
            leads_lead: lead || null,
            isNewLead: false
          };
        }).filter(record => record.leads_lead !== null);

        monthAgreementRecords.push(...monthLegacyRecords);
      }

      // Process new leads for month (only from leads_leadstage - no contracts)
      // Deduplicate month new lead stage records: keep only the latest date for each newlead_id
      const monthNewLeadRecordsMap = new Map<string, any>();
      (monthNewLeadStageRecords || []).forEach(record => {
        if (!record.newlead_id) return;
        const newLeadId = String(record.newlead_id);
        const recordDate = record.date || record.cdate;
        if (!recordDate) return;

        const existingRecord = monthNewLeadRecordsMap.get(newLeadId);
        if (!existingRecord) {
          monthNewLeadRecordsMap.set(newLeadId, record);
        } else {
          const existingDate = existingRecord.date || existingRecord.cdate;
          if (existingDate && new Date(recordDate) > new Date(existingDate)) {
            // This record has a later date, replace the existing one
            monthNewLeadRecordsMap.set(newLeadId, record);
          }
        }
      });

      // Convert map back to array
      const deduplicatedMonthNewLeadStageRecords = Array.from(monthNewLeadRecordsMap.values());

      const monthNewLeadsMap = new Map(monthNewLeadsData.map(lead => [String(lead.id), lead]));

      deduplicatedMonthNewLeadStageRecords.forEach(record => {
        if (!record.newlead_id) return;
        const lead = monthNewLeadsMap.get(String(record.newlead_id));
        if (!lead) return;
        const recordDate = resolveStage60SignTimestamp(record);
        monthAgreementRecords.push({
          id: `month-newstage-${record.id}`,
          date: recordDate,
          cdate: record.date || record.cdate,
          lead_id: null,
          newlead_id: String(record.newlead_id),
          leads_lead: lead,
          isNewLead: true
        });
      });

      // Only use leads_leadstage for stage 60 - no date_signed from leads table
      if (monthAgreementRecords && monthAgreementRecords.length > 0) {
      }

      // BOI as-of conversion for Agreement Signed (rate available on sign date)
      const boiConverter = await createBoiDateRateConverter();
      const toNis = async (amount: number, currency: string | number, signDateOnly: string | null) => {
        return boiConverter.toNis(amount, currency, signDateOnly);
      };

      const buildAgreementCurrencyMeta = (...candidates: any[]) => {
        const meta = buildCurrencyMetaFromId(...candidates);
        return {
          displaySymbol: meta.displaySymbol,
          conversionValue: meta.isoCode,
          isoCode: meta.isoCode,
          currencyId: meta.currencyId,
        };
      };

      const parseNumericAmount = (val: any) => {
        if (typeof val === 'number') return val;
        if (typeof val === 'string') {
          const cleaned = val.replace(/[^0-9.-]/g, '');
          const parsed = parseFloat(cleaned);
          return Number.isNaN(parsed) ? 0 : parsed;
        }
        return 0;
      };

      if (agreementRecords && agreementRecords.length > 0) {
        const processedRecordIds = new Set();

        for (const record of agreementRecords) {
          if (processedRecordIds.has(record.id)) {
            continue;
          }
          processedRecordIds.add(record.id);

          const lead = record.leads_lead as any;
          if (!lead) {
            continue;
          }

          // Use actual amounts (VAT already excluded in database)
          let amount = 0;
          if (record.isNewLead) {
            amount = parseFloat(lead.balance) || parseFloat(lead.proposal_total) || 0;
          } else {
            const currencyId = lead.currency_id;
            const numericCurrencyId = typeof currencyId === 'string' ? parseInt(currencyId, 10) : Number(currencyId);
            if (numericCurrencyId === 1) {
              amount = parseFloat(lead.total_base) || 0;
            } else {
              amount = parseFloat(lead.total) || 0;
            }
          }
          const recordDate = resolveStage60SignTimestamp(record);
          const recordDateOnly = toSignCalendarDateKey(recordDate) ?? '';
          const currencyMeta = record.isNewLead
            ? buildAgreementCurrencyMeta(lead.currency_id, lead.proposal_currency, lead.balance_currency)
            : buildAgreementCurrencyMeta(lead.currency_id, lead.meeting_total_currency_id, lead.accounting_currencies);
          const amountInNIS = await toNis(amount, currencyMeta.conversionValue, recordDateOnly);

          const subcontractorFee = parseNumericAmount(lead.subcontractor_fee) || 0;
          const subcontractorFeeNIS = await toNis(subcontractorFee, currencyMeta.conversionValue, recordDateOnly);
          const amountAfterFee = amountInNIS - subcontractorFeeNIS;

          const { departmentId, mainCategoryId, mainCategoryName } = resolveLeadDepartment(lead);
          const deptIndex = getScoreboardPeriodDeptIndex(
            departmentId,
            departmentIds,
            mainCategoryId,
            mainCategoryName,
          );

          const agreementDealBase = {
            id: String(record.id),
            leadId: String(record.isNewLead ? record.newlead_id || lead.id : record.lead_id || lead.id),
            leadNumber: leadDisplayNumber(lead, !!record.isNewLead),
            name: leadDisplayName(lead),
            date: recordDateOnly,
            amountNis: amountAfterFee,
            subcontractorFeeNis: subcontractorFeeNIS,
            categoryLabel: leadCategoryLabel(lead),
            ...leadRoleFields(lead, 'closer'),
            isNewLead: !!record.isNewLead,
          };

          if (recordDateOnly === todayStr) {
            newAgreementData.Today[deptIndex].count++;
            newAgreementData.Today[deptIndex].amount += amountAfterFee;
            newAgreementData.Today[0].count++;
            newAgreementData.Today[0].amount += amountAfterFee;
            pushAgreementPeriodDeal('Today', deptIndex, { ...agreementDealBase, id: `${agreementDealBase.id}::Today` });
          }

          if (recordDateOnly === yesterdayStr) {
            newAgreementData.Yesterday[deptIndex].count++;
            newAgreementData.Yesterday[deptIndex].amount += amountAfterFee;
            newAgreementData.Yesterday[0].count++;
            newAgreementData.Yesterday[0].amount += amountAfterFee;
            pushAgreementPeriodDeal('Yesterday', deptIndex, { ...agreementDealBase, id: `${agreementDealBase.id}::Yesterday` });
          }

          if (recordDateOnly >= oneWeekAgoStr && recordDateOnly <= todayStr) {
            newAgreementData.Week[deptIndex].count++;
            newAgreementData.Week[deptIndex].amount += amountAfterFee;
            newAgreementData.Week[0].count++;
            newAgreementData.Week[0].amount += amountAfterFee;
            pushAgreementPeriodDeal('Week', deptIndex, { ...agreementDealBase, id: `${agreementDealBase.id}::Week` });
          }

          if (recordDateOnly >= last30dStartDate && recordDateOnly <= todayStr) {
            newAgreementData["Last 30d"][deptIndex].count++;
            newAgreementData["Last 30d"][deptIndex].amount += amountAfterFee;
            newAgreementData["Last 30d"][0].count++;
            newAgreementData["Last 30d"][0].amount += amountAfterFee;
            pushAgreementPeriodDeal('Last 30d', deptIndex, { ...agreementDealBase, id: `${agreementDealBase.id}::Last30d` });
          }

          if (recordDateOnly >= last3mStartDate && recordDateOnly <= todayStr) {
            newAgreementData[SCOREBOARD_LAST_3M][deptIndex].count++;
            newAgreementData[SCOREBOARD_LAST_3M][deptIndex].amount += amountAfterFee;
            newAgreementData[SCOREBOARD_LAST_3M][0].count++;
            newAgreementData[SCOREBOARD_LAST_3M][0].amount += amountAfterFee;
            pushAgreementPeriodDeal(SCOREBOARD_LAST_3M, deptIndex, { ...agreementDealBase, id: `${agreementDealBase.id}::Last3m` });
          }
        }
      }

      // Process month data separately
      if (monthAgreementRecords && monthAgreementRecords.length > 0) {
        const processedMonthRecordIds = new Set();

        for (const record of monthAgreementRecords) {
          if (processedMonthRecordIds.has(record.id)) {
            continue;
          }
          processedMonthRecordIds.add(record.id);

          const lead = record.leads_lead as any;
          if (!lead) {
            continue;
          }

          let amount = 0;
          if (record.isNewLead) {
            amount = parseFloat(lead.balance) || parseFloat(lead.proposal_total) || 0;
          } else {
            const currencyId = lead.currency_id;
            const numericCurrencyId = typeof currencyId === 'string' ? parseInt(currencyId, 10) : Number(currencyId);
            if (numericCurrencyId === 1) {
              amount = parseFloat(lead.total_base) || 0;
            } else {
              amount = parseFloat(lead.total) || 0;
            }
          }
          const recordDate = resolveStage60SignTimestamp(record);
          const recordDateOnly = toSignCalendarDateKey(recordDate) ?? '';
          const currencyMeta = record.isNewLead
            ? buildAgreementCurrencyMeta(lead.currency_id, lead.proposal_currency, lead.balance_currency)
            : buildAgreementCurrencyMeta(lead.currency_id, lead.meeting_total_currency_id, lead.accounting_currencies);
          const amountInNIS = await toNis(amount, currencyMeta.conversionValue, recordDateOnly);

          const subcontractorFee = parseNumericAmount(lead.subcontractor_fee) || 0;
          const subcontractorFeeNIS = await toNis(subcontractorFee, currencyMeta.conversionValue, recordDateOnly);
          const amountAfterFee = amountInNIS - subcontractorFeeNIS;

          const { departmentId, mainCategoryId, mainCategoryName } = resolveLeadDepartment(lead);
          const monthDeptIndex = getScoreboardMonthDeptIndex(
            departmentId,
            departmentIds,
            mainCategoryId,
            mainCategoryName,
          );

          if (recordDateOnly >= startOfMonthStr && recordDateOnly <= endOfMonthStr) {
            newAgreementData[selectedMonthName][monthDeptIndex].count++;
            newAgreementData[selectedMonthName][monthDeptIndex].amount += amountAfterFee;
            pushAgreementMonthDeal(monthDeptIndex, {
              id: `${String(record.id)}::${selectedMonthName}`,
              leadId: String(record.isNewLead ? record.newlead_id || lead.id : record.lead_id || lead.id),
              leadNumber: leadDisplayNumber(lead, !!record.isNewLead),
              name: leadDisplayName(lead),
              date: recordDateOnly,
              amountNis: amountAfterFee,
              subcontractorFeeNis: subcontractorFeeNIS,
              categoryLabel: leadCategoryLabel(lead),
              ...leadRoleFields(lead, 'closer'),
              isNewLead: !!record.isNewLead,
            });
          }
        }
      }

      // Calculate totals for each time period
      const numDepartments = departmentTargets.length;
      const { totalIndexToday, totalIndexMonth } = getScoreboardTotalIndexes(numDepartments);
      // Today totals (sum of departments + Other, excluding General and Total)
      const todayTotalCount = newAgreementData.Today.slice(1, totalIndexToday).reduce((sum, item) => sum + item.count, 0);
      const todayTotalAmount = Math.ceil(newAgreementData.Today.slice(1, totalIndexToday).reduce((sum, item) => sum + item.amount, 0));
      newAgreementData.Today[totalIndexToday] = {
        count: todayTotalCount,
        amount: todayTotalAmount,
        expected: 0
      };

      // Yesterday totals
      const yesterdayTotalCount = newAgreementData.Yesterday.slice(1, totalIndexToday).reduce((sum, item) => sum + item.count, 0);
      const yesterdayTotalAmount = Math.ceil(newAgreementData.Yesterday.slice(1, totalIndexToday).reduce((sum, item) => sum + item.amount, 0));
      newAgreementData.Yesterday[totalIndexToday] = {
        count: yesterdayTotalCount,
        amount: yesterdayTotalAmount,
        expected: 0
      };

      // Week totals
      const weekTotalCount = newAgreementData.Week.slice(1, totalIndexToday).reduce((sum, item) => sum + item.count, 0);
      const weekTotalAmount = Math.ceil(newAgreementData.Week.slice(1, totalIndexToday).reduce((sum, item) => sum + item.amount, 0));
      newAgreementData.Week[totalIndexToday] = {
        count: weekTotalCount,
        amount: weekTotalAmount,
        expected: 0
      };

      // Last 30d totals - use the General row [0] which already contains the total
      const last30TotalCount = newAgreementData["Last 30d"][0].count;
      const last30TotalAmount = Math.ceil(newAgreementData["Last 30d"][0].amount);
      newAgreementData["Last 30d"][totalIndexToday] = {
        count: last30TotalCount,
        amount: last30TotalAmount,
        expected: 0
      };

      const last3mTotalCount = newAgreementData[SCOREBOARD_LAST_3M][0].count;
      const last3mTotalAmount = Math.ceil(newAgreementData[SCOREBOARD_LAST_3M][0].amount);
      newAgreementData[SCOREBOARD_LAST_3M][totalIndexToday] = {
        count: last3mTotalCount,
        amount: last3mTotalAmount,
        expected: 0
      };

      // Current month totals - calculate by summing the individual department values
      const monthTotalCount = newAgreementData[selectedMonthName].slice(0, totalIndexMonth).reduce((sum, item) => sum + item.count, 0);
      const monthTotalAmount = Math.ceil(newAgreementData[selectedMonthName].slice(0, totalIndexMonth).reduce((sum, item) => sum + item.amount, 0));
      newAgreementData[selectedMonthName][totalIndexMonth] = {
        count: monthTotalCount,
        amount: monthTotalAmount,
        expected: 0
      };

      setAgreementData(newAgreementData);
      await enrichScoreboardDealRolePhotos(agreementDealsStore);
      setAgreementScoreboardDeals(agreementDealsStore);
      setAgreementScoreboardDealsReady(true);

      // Fetch daily chart data for the last 30 days
      const chartData = await fetchDepartmentChartData(departmentIds, departmentTargets, last30dStartDate, todayStr);

      return {
        agreementData: newAgreementData,
        departmentNames: names,
        departmentChartData: chartData ?? {},
      };
    } catch (error) {
      console.error('[Dashboard Agreement Signed] fetchDepartmentPerformance failed:', error);
      return null;
    } finally {
      setDepartmentPerformanceLoading(false);
    }
  };

  // Fetch real daily chart data for department performance
  const fetchDepartmentChartData = async (
    departmentIds: number[],
    departmentTargets: any[],
    fromDate: string,
    toDate: string
  ) => {
    try {
      // Fetch stage records for the date range
      const { data: stageRecords, error: stageError } = await supabase
        .from('leads_leadstage')
        .select('id, date, lead_id')
        .eq('stage', 60)
        .gte('date', fromDate)
        .lte('date', toDate);

      if (stageError) {
        return {};
      }

      if (!stageRecords || stageRecords.length === 0) {
        setDepartmentChartData({});
        return {};
      }

      // Fetch leads data
      const leadIds = [...new Set(stageRecords.map(record => record.lead_id).filter(id => id !== null))];
      const { data: leadsData, error: leadsError } = await supabase
        .from('leads_lead')
        .select('id, category_id, meeting_total, meeting_total_currency_id')
        .in('id', leadIds);

      if (leadsError) {
        return;
      }

      // Create a map of lead_id to lead data
      const leadsMap = new Map();
      leadsData?.forEach(lead => {
        leadsMap.set(lead.id, lead);
      });

      // Create date range array
      const startDate = new Date(fromDate);
      const endDate = new Date(toDate);
      const dateArray: string[] = [];
      for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        dateArray.push(d.toISOString().split('T')[0]);
      }

      // Initialize chart data structure with all categories
      const allCategories = ['General', ...departmentTargets.map(d => d.name), 'Total'];
      const chartDataMap: { [category: string]: { [date: string]: { contracts: number; amount: number } } } = {};

      // Initialize all categories with all dates
      allCategories.forEach(category => {
        chartDataMap[category] = {};
        dateArray.forEach(date => {
          chartDataMap[category][date] = { contracts: 0, amount: 0 };
        });
      });

      // Process stage records
      stageRecords.forEach(record => {
        const lead = leadsMap.get(record.lead_id);
        if (!lead) return;

        const recordDate = record.date?.split('T')[0] || record.date;
        if (!recordDate || !dateArray.includes(recordDate)) return;

        // Get department from category_id
        const departmentId = lead.category_id;
        const deptIndex = departmentIds.indexOf(departmentId);

        // Convert amount to NIS
        let amountInNIS = 0;
        if (lead.meeting_total && lead.meeting_total_currency_id) {
          const currencyId = lead.meeting_total_currency_id;
          const amount = parseFloat(lead.meeting_total) || 0;
          if (currencyId === 1) { // NIS
            amountInNIS = amount;
          } else if (currencyId === 2) { // USD
            amountInNIS = amount * 3.5; // Approximate conversion
          } else if (currencyId === 3) { // EUR
            amountInNIS = amount * 3.8; // Approximate conversion
          }
        }

        if (deptIndex >= 0) {
          const categoryName = departmentTargets[deptIndex]?.name;
          if (categoryName && chartDataMap[categoryName]) {
            chartDataMap[categoryName][recordDate].contracts++;
            chartDataMap[categoryName][recordDate].amount += amountInNIS;
          }
        }

        // Also add to General and Total
        if (chartDataMap['General']) {
          chartDataMap['General'][recordDate].contracts++;
          chartDataMap['General'][recordDate].amount += amountInNIS;
        }
        if (chartDataMap['Total']) {
          chartDataMap['Total'][recordDate].contracts++;
          chartDataMap['Total'][recordDate].amount += amountInNIS;
        }
      });

      // Convert to array format for charts
      const finalChartData: { [category: string]: { date: string; contracts: number; amount: number }[] } = {};
      Object.keys(chartDataMap).forEach(category => {
        finalChartData[category] = dateArray.map(date => ({
          date: new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
          contracts: chartDataMap[category][date].contracts,
          amount: chartDataMap[category][date].amount
        }));
      });

      setDepartmentChartData(finalChartData);
      return finalChartData;
    } catch (error) {
      setDepartmentChartData({});
      return {};
    }
  };

  // Fetch invoiced data using the same logic as CollectionDueReport
  // For new leads: payment_plans where ready_to_pay = true and paid = false
  // For legacy leads: finances_paymentplanrow where ready_to_pay = true and actual_date IS NULL
  // Group by department instead of employee
  const fetchInvoicedData = async (
    shared?: Awaited<ReturnType<typeof fetchDepartmentsAndCategories>>,
    opts?: { background?: boolean },
  ) => {
    if (!opts?.background) setInvoicedDataLoading(true);
    try {
      const now = new Date();
      const today = new Date();
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(now.getDate() - 30);

      const selectedMonthIndex = months.indexOf(selectedMonth);
      const selectedDate = new Date(selectedYear, selectedMonthIndex, 1);
      const selectedMonthName = selectedDate.toLocaleDateString('en-US', { month: 'long' });

      let departmentTargets: any[];
      let departmentIds: number[];
      let allCategoriesData: any[] | null;
      let otherExpected = 0;

      if (shared) {
        departmentTargets = shared.departmentTargets;
        departmentIds = shared.departmentIds;
        allCategoriesData = shared.allCategoriesData;
        otherExpected = shared.otherExpected ?? 0;
      } else {
        const { data: allDepartments, error: departmentsError } = await supabase
          .from('tenant_departement')
          .select('id, name, min_income, important')
          .eq('important', 't')
          .order('id');
        if (departmentsError) throw departmentsError;

        let deptTargets = (allDepartments || []).filter((dept: any) => {
          if (dept.id === 20) return true;
          if (dept.name === 'Commercial - Sales' || dept.name?.includes('Commercial - Sales')) return false;
          const hasDept20 = (allDepartments || []).some((d: any) => d.id === 20);
          if (hasDept20 && (dept.name === 'Commercial & Civil' || dept.name?.includes('Commercial & Civil'))) return false;
          return true;
        });
        departmentTargets = deptTargets.map((dept: any) => (dept.id === 20 ? { ...dept, name: 'Commercial & Civil' } : dept));
        departmentIds = departmentTargets.map((d: any) => d.id);

        const { data: categoriesData, error: categoriesError } = await supabase
          .from('misc_category')
          .select(`
            id, name, parent_id,
            misc_maincategory!parent_id(
              id, name, department_id,
              tenant_departement!fk_misc_maincategory_department_id(id, name)
            )
          `)
          .order('name', { ascending: true });
        if (categoriesError) console.error('Error fetching categories for invoiced department mapping:', categoriesError);
        allCategoriesData = categoriesData || null;

        try {
          const scoreboardRefs = departmentTargets.map((d: any) => ({ id: d.id, name: String(d.name || '') }));
          const salesDeptIdsToExclude = [12, 14, 15];
          const [costByDept, otherCost] = await Promise.all([
            fetchDashboardDepartmentCostTargets(scoreboardRefs, { salesDeptIdsToExclude }),
            fetchDashboardOtherColumnCostTarget(scoreboardRefs, { salesDeptIdsToExclude }),
          ]);
          departmentTargets = applyDashboardCostTargetsToDepartments(departmentTargets, costByDept);
          otherExpected = otherScoreboardExpected(otherCost);
        } catch (costErr) {
          console.error('[Dashboard Invoiced] department cost targets failed:', costErr);
          departmentTargets = departmentTargets.map((dept: any) => ({
            ...dept,
            cost_target: parseFloat(dept.min_income || '0') || 0,
          }));
        }
      }

      const categoryNameToDataMap = shared?.categoryNameToDataMap ?? new Map<string, any>();
      if (!shared && allCategoriesData) {
        (allCategoriesData || []).forEach((category: any) => {
          if (category.name) categoryNameToDataMap.set(category.name.trim().toLowerCase(), category);
        });
      }

      // BOI as-of conversion for invoiced totals (paid → payment time; unpaid → due date)
      const boiConverter = await createBoiDateRateConverter();

      // Create target map (department ID -> employee cost target)
      const targetMap: { [key: number]: number } = {};
      departmentTargets.forEach(dept => {
        targetMap[dept.id] = departmentScoreboardExpected(dept);
      });

      // Calculate date ranges
      const todayStr = today.toISOString().split('T')[0];
      const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];
      const startOfMonth = new Date(Date.UTC(selectedYear, selectedMonthIndex, 1));
      const startOfMonthStr = startOfMonth.toISOString().split('T')[0];
      const endOfMonthStr = new Date(selectedYear, selectedMonthIndex + 1, 0).toISOString().split('T')[0];

      // Calculate Last 30d: always use rolling 30 days from today (not affected by month boundaries)
      // IMPORTANT: Last 30d should be inclusive of both start and end dates
      // If today is Jan 11, 30 days ago is Dec 12, so range is Dec 12 to Jan 11 (inclusive) = 31 days total
      const effectiveThirtyDaysAgo = thirtyDaysAgoStr;
      const last3mStartDate = getLast3MonthsStartDate(todayStr);

      // Calculate date ranges for invoiced data
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];
      const oneWeekAgo = new Date(today);
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
      const oneWeekAgoStr = oneWeekAgo.toISOString().split('T')[0];

      // Initialize invoiced data structure
      const newInvoicedData = {
        Today: buildScoreboardPeriodRows(departmentTargets, otherExpected),
        Yesterday: buildScoreboardPeriodRows(departmentTargets, otherExpected),
        Week: buildScoreboardPeriodRows(departmentTargets, otherExpected),
        "Last 30d": buildScoreboardPeriodRows(departmentTargets, otherExpected),
        [SCOREBOARD_LAST_3M]: buildScoreboardPeriodRows(departmentTargets, otherExpected),
        [selectedMonthName]: buildScoreboardMonthRows(departmentTargets, otherExpected),
      };
      const invoicedDealsStore = new Map<string, DashboardScoreboardDeal[]>();
      const pushInvoicedPeriodDeal = (
        period: string,
        deptIndex: number,
        deal: Omit<DashboardScoreboardDeal, 'departmentName' | 'source'>,
      ) => {
        const columnName = getScoreboardPeriodColumnName(deptIndex, departmentTargets);
        if (!columnName) return;
        const row: DashboardScoreboardDeal = {
          ...deal,
          departmentName: columnName,
          source: 'invoiced',
        };
        appendScoreboardDeal(invoicedDealsStore, period, columnName, row);
        appendScoreboardDeal(invoicedDealsStore, period, 'Total', { ...row, id: `${row.id}::total` });
      };
      const pushInvoicedMonthDeal = (
        deptIndex: number,
        deal: Omit<DashboardScoreboardDeal, 'departmentName' | 'source'>,
      ) => {
        const columnName = getScoreboardMonthColumnName(deptIndex, departmentTargets);
        if (!columnName) return;
        const row: DashboardScoreboardDeal = {
          ...deal,
          departmentName: columnName,
          source: 'invoiced',
        };
        appendScoreboardDeal(invoicedDealsStore, selectedMonthName, columnName, row);
        appendScoreboardDeal(invoicedDealsStore, selectedMonthName, 'Total', { ...row, id: `${row.id}::total` });
      };

      // Fetch new payment plans - show all payments with due_date (both paid and unpaid)
      // Note: We don't filter by date range here because we need data for multiple periods (Today, Last 30d, Month)
      // We'll filter by date in the processing step
      let newPaymentsQuery = supabase
        .from('payment_plans')
        .select(`
          id,
          lead_id,
          value,
          value_vat,
          currency,
          due_date,
          due_percent,
          cancel_date,
          ready_to_pay,
          paid,
          paid_at
        `)
        .eq('ready_to_pay', true)
        .not('due_date', 'is', null)
        .is('cancel_date', null);

      const { data: newPayments, error: newError } = await newPaymentsQuery;
      if (newError) {
        console.error('❌ Invoiced Data - Error fetching new payments:', newError);
        throw newError;
      }

      // Filter out any payments with cancel_date (safety check)
      const filteredNewPayments = dedupeRowsById((newPayments || []).filter(p => !p.cancel_date));

      // Fetch legacy payment plans from finances_paymentplanrow
      // IMPORTANT: Match Collection Due Report - NO ready_to_pay filter, only filter by due_date IS NOT NULL
      // Use pagination to fetch ALL records (Supabase limit is 1000 per query)
      // Note: We don't filter by date range here because we need data for multiple periods (Today, Last 30d, Month)
      // We'll filter by date in the processing step

      let allLegacyPayments: any[] = [];
      const batchSize = 1000; // Supabase limit
      let offset = 0;
      let hasMore = true;
      let batchNumber = 0;

      while (hasMore) {
        batchNumber++;
        const { data: batch, error: batchError } = await supabase
          .from('finances_paymentplanrow')
          .select(`
            id,
            lead_id,
            client_id,
            value,
            value_base,
            vat_value,
            currency_id,
            due_date,
            due_percent,
            date,
            cancel_date,
            ready_to_pay,
            actual_date,
            accounting_currencies!finances_paymentplanrow_currency_id_fkey(name, iso_code)
          `)
          .not('due_date', 'is', null) // ONLY filter by due_date - fetch all payments with due_date set (regardless of ready_to_pay flag)
          .is('cancel_date', null) // Exclude cancelled payments only - show both paid and unpaid payments
          .order('id', { ascending: true }) // Order by id for consistent pagination
          .range(offset, offset + batchSize - 1);

        if (batchError) {
          console.error('❌ Invoiced Data - Error fetching legacy payments batch:', batchError);
          throw batchError;
        }

        if (batch && batch.length > 0) {
          allLegacyPayments = [...allLegacyPayments, ...batch];

          // If we got fewer than batchSize, we've reached the end
          if (batch.length < batchSize) {
            hasMore = false;
          } else {
            offset += batchSize;
          }
        } else {
          hasMore = false;
        }
      }

      // Filter out any payments with cancel_date (safety check)
      const filteredLegacyPayments = dedupeRowsById(allLegacyPayments.filter(p => !p.cancel_date));

      // Get unique lead IDs
      const newLeadIds = Array.from(new Set(filteredNewPayments.map(p => p.lead_id).filter(Boolean)));
      const legacyLeadIds = Array.from(new Set(filteredLegacyPayments.map(p => p.lead_id).filter(Boolean))).map(id => Number(id)).filter(id => !Number.isNaN(id));

      // Fetch lead metadata with handler info and category (to get department from category, matching Agreement Signed)
      let newLeadsMap = new Map();
      if (newLeadIds.length > 0) {
        const { data: newLeads, error: newLeadsError } = await supabase
          .from('leads')
          .select(`
            id,
            lead_number,
            name,
            handler,
            closer,
            category_id,
            category,
            subcontractor_fee,
            misc_category!category_id(
              id, name, parent_id,
              misc_maincategory!parent_id(
                id, name, department_id,
                tenant_departement!fk_misc_maincategory_department_id(id, name)
              )
            )
          `)
          .in('id', newLeadIds);

        if (newLeadsError) {
          console.error('❌ Invoiced Data - Error fetching new leads:', newLeadsError);
        } else {
          if (newLeads) {
            newLeads.forEach(lead => {
              newLeadsMap.set(lead.id, lead);
            });
          }
        }
      }

      let legacyLeadsMap = new Map();
      if (legacyLeadIds.length > 0) {
        // Supabase's .in() has a limit of 1000 items, so we need to fetch in batches
        const leadIdBatchSize = 1000;
        let allLegacyLeads: any[] = [];

        for (let i = 0; i < legacyLeadIds.length; i += leadIdBatchSize) {
          const batchLeadIds = legacyLeadIds.slice(i, i + leadIdBatchSize);
          const { data: legacyLeadsBatch, error: legacyLeadsError } = await supabase
            .from('leads_lead')
            .select(`
              id,
              lead_number,
              name,
              case_handler_id,
              closer_id,
              category_id,
              category,
              subcontractor_fee,
              misc_category!category_id(
                id,
                name,
                parent_id,
                misc_maincategory!parent_id(
                  id,
                  name,
                  department_id,
                  tenant_departement!fk_misc_maincategory_department_id(id, name)
                )
              ),
              handler_employee:tenants_employee!fk_leads_lead_case_handler_id(id, display_name, photo_url, photo)
            `)
            .in('id', batchLeadIds);

          if (legacyLeadsError) {
            console.error('❌ Invoiced Data - Error fetching legacy leads batch:', legacyLeadsError);
          } else {
            if (legacyLeadsBatch) {
              allLegacyLeads = [...allLegacyLeads, ...legacyLeadsBatch];
            }
          }
        }

        if (allLegacyLeads.length > 0) {
          allLegacyLeads.forEach(lead => {
            const key = lead.id?.toString() || String(lead.id);
            legacyLeadsMap.set(key, lead);
            if (typeof lead.id === 'number') {
              legacyLeadsMap.set(lead.id, lead);
            }
          });
        }
      }

      // Contact names for invoiced deals (match CollectionDueReport drawer)
      // New: main contact via lead_leadcontact; Legacy: payment.client_id → leads_contact
      const newLeadContactByLeadId = new Map<string, string>();
      if (newLeadIds.length > 0) {
        const { data: leadContacts, error: leadContactsError } = await supabase
          .from('lead_leadcontact')
          .select('newlead_id, main, leads_contact:contact_id(name)')
          .eq('main', 'true')
          .in('newlead_id', newLeadIds);

        if (!leadContactsError && leadContacts) {
          leadContacts.forEach((entry: any) => {
            const leadId = entry.newlead_id != null ? String(entry.newlead_id) : '';
            const contactRel = Array.isArray(entry.leads_contact) ? entry.leads_contact[0] : entry.leads_contact;
            const contactName = (contactRel?.name || '').toString().trim();
            if (leadId && contactName) newLeadContactByLeadId.set(leadId, contactName);
          });
        }

        if (newLeadContactByLeadId.size < newLeadIds.length) {
          const missingLeadIds = newLeadIds.filter((id) => !newLeadContactByLeadId.has(String(id)));
          if (missingLeadIds.length > 0) {
            const { data: contacts, error: contactsError } = await supabase
              .from('contacts')
              .select('id, name, lead_id')
              .in('lead_id', missingLeadIds)
              .eq('is_persecuted', false);

            if (!contactsError && contacts) {
              contacts.forEach((contact: any) => {
                const leadId = contact.lead_id != null ? String(contact.lead_id) : '';
                const contactName = (contact.name || '').toString().trim();
                if (leadId && contactName && !newLeadContactByLeadId.has(leadId)) {
                  newLeadContactByLeadId.set(leadId, contactName);
                }
              });
            }
          }
        }
      }

      const legacyContactById = new Map<number, string>();
      const legacyContactIds = Array.from(
        new Set(
          filteredLegacyPayments
            .map((p: any) => p.client_id)
            .filter(Boolean)
            .map((id: any) => Number(id))
            .filter((id: number) => !Number.isNaN(id)),
        ),
      );
      for (let i = 0; i < legacyContactIds.length; i += 1000) {
        const chunk = legacyContactIds.slice(i, i + 1000);
        const { data: contacts, error: contactsError } = await supabase
          .from('leads_contact')
          .select('id, name')
          .in('id', chunk);
        if (contactsError) {
          console.error('❌ Invoiced Data - Error fetching legacy contacts:', contactsError);
          continue;
        }
        (contacts || []).forEach((contact: any) => {
          if (contact.id != null && contact.name) {
            legacyContactById.set(Number(contact.id), String(contact.name).trim());
          }
        });
      }

      // Fetch handler information and map to departments (EXACTLY matching CollectionDueReport)
      // Collect handler names from new leads and handler IDs from legacy leads
      const allHandlerNames = new Set<string>();
      const allHandlerIds = new Set<number>();

      // Collect handler names from new leads
      newLeadsMap.forEach((lead: any) => {
        if (lead.handler && typeof lead.handler === 'string' && lead.handler.trim() && lead.handler !== '---' && lead.handler.toLowerCase() !== 'not assigned') {
          allHandlerNames.add(lead.handler.trim());
        }
      });

      // Collect handler IDs from legacy leads
      legacyLeadsMap.forEach((lead: any) => {
        const handlerId = lead.case_handler_id ? Number(lead.case_handler_id) : null;
        if (handlerId !== null && !Number.isNaN(handlerId)) {
          allHandlerIds.add(handlerId);
        }
      });

      // Fetch employees by display_name for new leads
      const handlerNameToIdMap = new Map<string, number>();
      const handlerMap = new Map<number, string>(); // handlerId -> display_name

      if (allHandlerNames.size > 0) {
        const handlerNamesArray = Array.from(allHandlerNames);
        const { data: handlerDataByName, error: handlerErrorByName } = await supabase
          .from('tenants_employee')
          .select('id, display_name')
          .in('display_name', handlerNamesArray);

        if (!handlerErrorByName && handlerDataByName) {
          handlerDataByName.forEach(emp => {
            const empId = Number(emp.id);
            const displayName = emp.display_name?.trim();
            if (!Number.isNaN(empId) && displayName) {
              handlerNameToIdMap.set(displayName, empId);
              handlerMap.set(empId, displayName);
            }
          });
        }
      }

      // Fetch employees by ID for legacy leads
      const uniqueHandlerIds = Array.from(new Set(allHandlerIds));
      if (uniqueHandlerIds.length > 0) {
        const { data: handlerDataById, error: handlerErrorById } = await supabase
          .from('tenants_employee')
          .select('id, display_name')
          .in('id', uniqueHandlerIds);

        if (!handlerErrorById && handlerDataById) {
          handlerDataById.forEach(emp => {
            const empId = Number(emp.id);
            if (!Number.isNaN(empId)) {
              const displayName = emp.display_name?.trim() || `Employee #${emp.id}`;
              handlerMap.set(empId, displayName);
            }
          });
        }
      }

      // Fetch department information from tenants_employee for all handlers (EXACTLY matching CollectionDueReport)
      const handlerIdsWithDepartments = Array.from(new Set([
        ...Array.from(handlerNameToIdMap.values()),
        ...Array.from(allHandlerIds)
      ]));

      const handlerIdToDepartmentNameMap = new Map<number, string>(); // handlerId -> departmentName (string)

      if (handlerIdsWithDepartments.length > 0) {
        const { data: employeeDepartmentData, error: employeeDepartmentError } = await supabase
          .from('tenants_employee')
          .select(`
            id,
            display_name,
            department_id,
            tenant_departement!department_id (
              id,
              name
            )
          `)
          .in('id', handlerIdsWithDepartments);

        if (!employeeDepartmentError && employeeDepartmentData) {
          employeeDepartmentData.forEach(emp => {
            const empId = Number(emp.id);
            if (!Number.isNaN(empId)) {
              const department = emp.tenant_departement;
              if (department) {
                const dept = Array.isArray(department) ? department[0] : department;
                // Fix department name for ID 20: should be "Commercial & Civil" not "Commercial - Sales"
                let departmentName = dept?.name || '—';
                if (dept?.id === 20) {
                  departmentName = 'Commercial & Civil';
                }
                handlerIdToDepartmentNameMap.set(empId, departmentName);
              } else {
                handlerIdToDepartmentNameMap.set(empId, '—');
              }
            }
          });
        }
      }

      // Create a map from department name to department ID (for matching with departmentIds)
      const departmentNameToIdMap = new Map<string, number>();
      departmentTargets.forEach(dept => {
        departmentNameToIdMap.set(dept.name, dept.id);
      });
      // CRITICAL: Also map "Commercial - Sales" to department 20's ID (for employees who still have the old name)
      const dept20 = departmentTargets.find(d => d.id === 20);
      if (dept20) {
        departmentNameToIdMap.set('Commercial - Sales', 20);
        departmentNameToIdMap.set('Commercial & Civil', 20); // Ensure both names map to the same ID
      }

      // Function to normalize department names by removing " - Sales" suffix for consolidation
      // This ensures "Austria and Germany" and "Austria and Germany - Sales" map to the same department
      const normalizeDepartmentName = (deptName: string): string => {
        if (!deptName || deptName === '—') return deptName;
        // Remove " - Sales" suffix if present
        const baseName = deptName.replace(/ - Sales$/, '').trim();
        return baseName;
      };

      // Create a map from normalized name to primary department ID (the one WITHOUT " - Sales" suffix)
      // First pass: identify primary departments (those without " - Sales" suffix)
      const normalizedNameToPrimaryIdMap = new Map<string, number>();
      departmentTargets.forEach(dept => {
        const normalizedName = normalizeDepartmentName(dept.name);
        // If this is the primary department (no " - Sales" suffix), use it as the primary ID
        if (dept.name === normalizedName) {
          // This is a primary department - use it as the target ID
          if (!normalizedNameToPrimaryIdMap.has(normalizedName)) {
            normalizedNameToPrimaryIdMap.set(normalizedName, dept.id);
          }
        }
      });
      // Second pass: for departments with " - Sales" suffix, map to their primary department
      departmentTargets.forEach(dept => {
        const normalizedName = normalizeDepartmentName(dept.name);
        const primaryId = normalizedNameToPrimaryIdMap.get(normalizedName);
        if (primaryId && dept.name !== normalizedName) {
          // This is a " - Sales" variant - it should map to the primary ID
          // But we still want to keep the original mapping too for exact matches
        }
      });

      // Create a map from any department name (including variants) to the consolidated department ID
      const allDepartmentNamesToIdMap = new Map<string, number>();
      departmentTargets.forEach(dept => {
        const normalizedName = normalizeDepartmentName(dept.name);
        const primaryId = normalizedNameToPrimaryIdMap.get(normalizedName);
        const targetId = primaryId || dept.id; // Use primary ID if available, otherwise use the department's own ID

        // Map the original name to the target ID
        allDepartmentNamesToIdMap.set(dept.name, targetId);
        // Map the normalized name to the target ID (will overwrite with primary ID if it exists)
        allDepartmentNamesToIdMap.set(normalizedName, targetId);
      });
      // Also map "Commercial - Sales" variants
      if (dept20) {
        allDepartmentNamesToIdMap.set('Commercial - Sales', 20);
        allDepartmentNamesToIdMap.set('Commercial & Civil', 20);
      }

      // Process payments and group by department (using employee's department NAME, EXACTLY matching CollectionDueReport)
      // IMPORTANT: Each payment row is counted separately - no deduplication by lead_id
      // Multiple payment rows per lead are all counted and summed
      // Guard against the same installment appearing twice (pagination dupes or new+legacy overlap).
      // Subcontractor fee is allocated per row by due_percent (else by share of lead plan total in NIS).
      const seenInvoicedInstallments = new Set<string>();
      const invoicedInstallmentKey = (
        leadNumber: string,
        dueDate: string,
        amountNis: number,
      ) => `${leadNumber}|${dueDate}|${Math.round(amountNis || 0)}`;

      type PreparedInvoicedPayment = {
        kind: 'new' | 'legacy';
        paymentId: string | number;
        lead: any;
        leadKey: string;
        leadNumber: string;
        dueDate: string;
        amountInNIS: number;
        duePercent: number;
        contactName: string | null;
        departmentId: number | null;
        mainCategoryId: number | null;
        mainCategoryName: string | null;
        currencyForConversion: string;
        rateAsOf: any;
      };

      const preparedInvoicedPayments: PreparedInvoicedPayment[] = [];
      const leadPlanTotalNis = new Map<string, number>();
      const leadFeeNis = new Map<string, number>();

      // --- Prepare new payments ---
      for (const payment of filteredNewPayments) {
        const lead = newLeadsMap.get(payment.lead_id);
        if (!lead) continue;

        const { departmentId, mainCategoryId, mainCategoryName } = resolveCategoryAndDepartment(
          lead.category,
          lead.category_id,
          lead.misc_category,
          allCategoriesData,
          categoryNameToDataMap,
        );

        const value = Number(payment.value || 0);
        const currencyForConversion = normalizeInvoicedCurrency(payment.currency);
        const dueDate = payment.due_date
          ? (typeof payment.due_date === 'string' ? payment.due_date.split('T')[0] : new Date(payment.due_date).toISOString().split('T')[0])
          : null;
        if (!dueDate) continue;

        const rateAsOf = resolvePaymentPlanBoiAsOfInput({
          paid: payment.paid,
          paid_at: payment.paid_at,
          due_date: payment.due_date,
        });
        const amountInNIS = await boiConverter.toNis(value, currencyForConversion, rateAsOf);
        const leadNumber = leadDisplayNumber(lead, true);
        const installmentKey = invoicedInstallmentKey(leadNumber, dueDate, amountInNIS);
        if (seenInvoicedInstallments.has(installmentKey)) continue;
        seenInvoicedInstallments.add(installmentKey);

        const leadKey = String(payment.lead_id || lead.id);
        leadPlanTotalNis.set(leadKey, (leadPlanTotalNis.get(leadKey) || 0) + amountInNIS);
        if (!leadFeeNis.has(leadKey)) {
          const feeRaw = Number(lead.subcontractor_fee) || 0;
          leadFeeNis.set(
            leadKey,
            feeRaw > 0 ? await boiConverter.toNis(feeRaw, currencyForConversion, rateAsOf) : 0,
          );
        }

        preparedInvoicedPayments.push({
          kind: 'new',
          paymentId: payment.id,
          lead,
          leadKey,
          leadNumber,
          dueDate,
          amountInNIS,
          duePercent: parsePaymentDuePercent(payment.due_percent),
          contactName: newLeadContactByLeadId.get(String(payment.lead_id || lead.id)) || null,
          departmentId,
          mainCategoryId,
          mainCategoryName,
          currencyForConversion,
          rateAsOf,
        });
      }

      // --- Prepare legacy payments ---
      for (const payment of filteredLegacyPayments) {
        const leadIdKey = payment.lead_id?.toString() || String(payment.lead_id);
        const leadIdNum = typeof payment.lead_id === 'number' ? payment.lead_id : Number(payment.lead_id);
        const lead = legacyLeadsMap.get(leadIdKey) || legacyLeadsMap.get(leadIdNum);
        if (!lead) continue;

        const { departmentId, mainCategoryId, mainCategoryName } = resolveCategoryAndDepartment(
          lead.category,
          lead.category_id,
          lead.misc_category,
          allCategoriesData,
          categoryNameToDataMap,
        );

        const value = Number(payment.value || payment.value_base || 0);
        const accountingCurrency: any = payment.accounting_currencies
          ? (Array.isArray(payment.accounting_currencies) ? payment.accounting_currencies[0] : payment.accounting_currencies)
          : null;

        let currencyForConversion = 'NIS';
        if (accountingCurrency?.name) currencyForConversion = accountingCurrency.name;
        else if (accountingCurrency?.iso_code) currencyForConversion = accountingCurrency.iso_code;
        else if (payment.currency_id) {
          switch (payment.currency_id) {
            case 1: currencyForConversion = 'NIS'; break;
            case 2: currencyForConversion = 'EUR'; break;
            case 3: currencyForConversion = 'USD'; break;
            case 4: currencyForConversion = 'GBP'; break;
            default: currencyForConversion = 'NIS'; break;
          }
        }
        currencyForConversion = normalizeInvoicedCurrency(currencyForConversion);

        const dueDate = payment.due_date
          ? (typeof payment.due_date === 'string' ? payment.due_date.split('T')[0] : new Date(payment.due_date).toISOString().split('T')[0])
          : null;
        if (!dueDate) continue;

        const rateAsOf = resolvePaymentPlanBoiAsOfInput({
          actual_date: payment.actual_date,
          due_date: payment.due_date,
        });
        const amountInNIS = await boiConverter.toNis(value, currencyForConversion, rateAsOf);
        const leadNumber = leadDisplayNumber(lead, false);
        const installmentKey = invoicedInstallmentKey(leadNumber, dueDate, amountInNIS);
        if (seenInvoicedInstallments.has(installmentKey)) continue;
        seenInvoicedInstallments.add(installmentKey);

        const leadKey = String(payment.lead_id || lead.id);
        leadPlanTotalNis.set(leadKey, (leadPlanTotalNis.get(leadKey) || 0) + amountInNIS);
        if (!leadFeeNis.has(leadKey)) {
          const feeRaw = Number(lead.subcontractor_fee) || 0;
          leadFeeNis.set(
            leadKey,
            feeRaw > 0 ? await boiConverter.toNis(feeRaw, currencyForConversion, rateAsOf) : 0,
          );
        }

        const contactId = payment.client_id != null ? Number(payment.client_id) : null;
        const contactName =
          contactId != null && !Number.isNaN(contactId) ? (legacyContactById.get(contactId) || null) : null;

        preparedInvoicedPayments.push({
          kind: 'legacy',
          paymentId: payment.id,
          lead,
          leadKey,
          leadNumber,
          dueDate,
          amountInNIS,
          duePercent: parsePaymentDuePercent(payment.due_percent),
          contactName,
          departmentId,
          mainCategoryId,
          mainCategoryName,
          currencyForConversion,
          rateAsOf,
        });
      }

      // --- Scoreboard + deals (amounts net of proportional subcontractor fee) ---
      for (const row of preparedInvoicedPayments) {
        const feeTotalNis = leadFeeNis.get(row.leadKey) || 0;
        const planTotalNis = leadPlanTotalNis.get(row.leadKey) || 0;
        const subcontractorFeeNis = allocateInvoicedSubcontractorFeeNis({
          feeTotalNis,
          rowAmountNis: row.amountInNIS,
          leadPlanTotalNis: planTotalNis,
          duePercent: row.duePercent,
        });
        const amountAfterFee = row.amountInNIS - subcontractorFeeNis;
        const { dueDate } = row;

        const deptIndex = getScoreboardPeriodDeptIndex(
          row.departmentId,
          departmentIds,
          row.mainCategoryId,
          row.mainCategoryName,
        );

        const invoicedDealBase = {
          id: `${row.kind === 'new' ? 'newpay' : 'legpay'}-${row.paymentId}`,
          leadId: row.leadKey,
          leadNumber: row.leadNumber,
          name: leadDisplayName(row.lead),
          contactName: row.contactName,
          date: dueDate,
          amountNis: amountAfterFee,
          subcontractorFeeNis,
          categoryLabel: leadCategoryLabel(row.lead),
          ...leadRoleFields(row.lead, 'handler'),
          isNewLead: row.kind === 'new',
        };

        if (dueDate === todayStr) {
          newInvoicedData["Today"][deptIndex].count += 1;
          newInvoicedData["Today"][deptIndex].amount += amountAfterFee;
          newInvoicedData["Today"][0].count += 1;
          newInvoicedData["Today"][0].amount += amountAfterFee;
          pushInvoicedPeriodDeal('Today', deptIndex, { ...invoicedDealBase, id: `${invoicedDealBase.id}::Today` });
        }

        if (dueDate === yesterdayStr) {
          newInvoicedData["Yesterday"][deptIndex].count += 1;
          newInvoicedData["Yesterday"][deptIndex].amount += amountAfterFee;
          newInvoicedData["Yesterday"][0].count += 1;
          newInvoicedData["Yesterday"][0].amount += amountAfterFee;
          pushInvoicedPeriodDeal('Yesterday', deptIndex, { ...invoicedDealBase, id: `${invoicedDealBase.id}::Yesterday` });
        }

        if (dueDate >= oneWeekAgoStr && dueDate <= todayStr) {
          newInvoicedData["Week"][deptIndex].count += 1;
          newInvoicedData["Week"][deptIndex].amount += amountAfterFee;
          newInvoicedData["Week"][0].count += 1;
          newInvoicedData["Week"][0].amount += amountAfterFee;
          pushInvoicedPeriodDeal('Week', deptIndex, { ...invoicedDealBase, id: `${invoicedDealBase.id}::Week` });
        }

        if (dueDate >= effectiveThirtyDaysAgo && dueDate <= todayStr) {
          newInvoicedData["Last 30d"][deptIndex].count += 1;
          newInvoicedData["Last 30d"][deptIndex].amount += amountAfterFee;
          newInvoicedData["Last 30d"][0].count += 1;
          newInvoicedData["Last 30d"][0].amount += amountAfterFee;
          pushInvoicedPeriodDeal('Last 30d', deptIndex, { ...invoicedDealBase, id: `${invoicedDealBase.id}::Last30d` });
        }

        if (dueDate >= last3mStartDate && dueDate <= todayStr) {
          newInvoicedData[SCOREBOARD_LAST_3M][deptIndex].count += 1;
          newInvoicedData[SCOREBOARD_LAST_3M][deptIndex].amount += amountAfterFee;
          newInvoicedData[SCOREBOARD_LAST_3M][0].count += 1;
          newInvoicedData[SCOREBOARD_LAST_3M][0].amount += amountAfterFee;
          pushInvoicedPeriodDeal(SCOREBOARD_LAST_3M, deptIndex, { ...invoicedDealBase, id: `${invoicedDealBase.id}::Last3m` });
        }

        if (dueDate >= startOfMonthStr && dueDate <= endOfMonthStr) {
          const monthDeptIndex = getScoreboardMonthDeptIndex(
            row.departmentId,
            departmentIds,
            row.mainCategoryId,
            row.mainCategoryName,
          );
          newInvoicedData[selectedMonthName][monthDeptIndex].count += 1;
          newInvoicedData[selectedMonthName][monthDeptIndex].amount += amountAfterFee;
          pushInvoicedMonthDeal(monthDeptIndex, {
            ...invoicedDealBase,
            id: `${invoicedDealBase.id}::${selectedMonthName}`,
          });
        }
      }

      // Calculate totals
      const numDepartments = departmentTargets.length;
      const { totalIndexToday, totalIndexMonth } = getScoreboardTotalIndexes(numDepartments);

      // Today totals (sum of departments + Other, excluding General and Total)
      const todayTotalCount = newInvoicedData.Today.slice(1, totalIndexToday).reduce((sum, item) => sum + item.count, 0);
      const todayTotalAmount = Math.ceil(newInvoicedData.Today.slice(1, totalIndexToday).reduce((sum, item) => sum + item.amount, 0));
      newInvoicedData.Today[totalIndexToday] = { count: todayTotalCount, amount: todayTotalAmount, expected: 0 };

      // Yesterday totals
      const yesterdayTotalCount = newInvoicedData.Yesterday.slice(1, totalIndexToday).reduce((sum, item) => sum + item.count, 0);
      const yesterdayTotalAmount = Math.ceil(newInvoicedData.Yesterday.slice(1, totalIndexToday).reduce((sum, item) => sum + item.amount, 0));
      newInvoicedData.Yesterday[totalIndexToday] = { count: yesterdayTotalCount, amount: yesterdayTotalAmount, expected: 0 };

      // Week totals
      const weekTotalCount = newInvoicedData.Week.slice(1, totalIndexToday).reduce((sum, item) => sum + item.count, 0);
      const weekTotalAmount = Math.ceil(newInvoicedData.Week.slice(1, totalIndexToday).reduce((sum, item) => sum + item.amount, 0));
      newInvoicedData.Week[totalIndexToday] = { count: weekTotalCount, amount: weekTotalAmount, expected: 0 };

      // Last 30d totals
      const last30TotalCount = newInvoicedData["Last 30d"].slice(1, totalIndexToday).reduce((sum, item) => sum + item.count, 0);
      const last30TotalAmount = Math.ceil(newInvoicedData["Last 30d"].slice(1, totalIndexToday).reduce((sum, item) => sum + item.amount, 0));
      newInvoicedData["Last 30d"][totalIndexToday] = { count: last30TotalCount, amount: last30TotalAmount, expected: 0 };

      const last3mTotalCount = newInvoicedData[SCOREBOARD_LAST_3M].slice(1, totalIndexToday).reduce((sum, item) => sum + item.count, 0);
      const last3mTotalAmount = Math.ceil(newInvoicedData[SCOREBOARD_LAST_3M].slice(1, totalIndexToday).reduce((sum, item) => sum + item.amount, 0));
      newInvoicedData[SCOREBOARD_LAST_3M][totalIndexToday] = { count: last3mTotalCount, amount: last3mTotalAmount, expected: 0 };

      // Current month totals
      const monthTotalCount = newInvoicedData[selectedMonthName].slice(0, totalIndexMonth).reduce((sum, item) => sum + item.count, 0);
      const monthTotalAmount = Math.ceil(newInvoicedData[selectedMonthName].slice(0, totalIndexMonth).reduce((sum, item) => sum + item.amount, 0));
      newInvoicedData[selectedMonthName][totalIndexMonth] = { count: monthTotalCount, amount: monthTotalAmount, expected: 0 };

      setInvoicedData(newInvoicedData);
      await enrichScoreboardDealRolePhotos(invoicedDealsStore);
      setInvoicedScoreboardDeals(invoicedDealsStore);
      setInvoicedScoreboardDealsReady(true);
      return newInvoicedData;

    } catch (error: any) {
      return null;
    } finally {
      setInvoicedDataLoading(false);
    }
  };

  // Calculate percentage from target
  const revenuePercentage = REVENUE_TARGET > 0 ? (realRevenueThisMonth / REVENUE_TARGET) * 100 : 0;
  const isAboveTarget = realRevenueThisMonth >= REVENUE_TARGET;

  // Calculate lead growth percentage
  const leadGrowthPercentage = totalLeadsLastMonth > 0
    ? ((totalLeadsThisMonth - totalLeadsLastMonth) / totalLeadsLastMonth) * 100
    : 0;
  const isLeadGrowthPositive = leadGrowthPercentage >= 0;

  // Calculate conversion rate
  const conversionRate = totalExistingLeads > 0
    ? (meetingsScheduledThisMonth / totalExistingLeads) * 100
    : 0;

  // Calculate contracts signed percentage
  const contractsPercentage = contractsSignedLastMonth > 0
    ? ((contractsSignedThisMonth - contractsSignedLastMonth) / contractsSignedLastMonth) * 100
    : 0;
  const isContractsGrowthPositive = contractsPercentage >= 0;

  const scoreboardTabs = ["Today", "Last 30d", "Tables"];
  // Department names state
  const [departmentNames, setDepartmentNames] = useState<string[]>([]);

  // Dynamic scoreboard categories based on actual departments
  const scoreboardCategories = [
    "General",
    ...departmentNames,
    "Total"
  ];
  // Agreement signed data (first table) - will be populated with real data
  const [agreementScoreboardDeals, setAgreementScoreboardDeals] = useState<Map<string, DashboardScoreboardDeal[]>>(new Map());
  const [invoicedScoreboardDeals, setInvoicedScoreboardDeals] = useState<Map<string, DashboardScoreboardDeal[]>>(new Map());
  const [agreementScoreboardDealsReady, setAgreementScoreboardDealsReady] = useState(false);
  const [invoicedScoreboardDealsReady, setInvoicedScoreboardDealsReady] = useState(false);
  const [scoreboardDealsModal, setScoreboardDealsModal] = useState<{
    tableType: 'agreement' | 'invoiced';
    period: string;
    departmentName: string;
  } | null>(null);

  const [agreementData, setAgreementData] = useState<{
    Today: { count: number; amount: number; expected: number }[];
    "Last 30d": { count: number; amount: number; expected: number }[];
    [key: string]: { count: number; amount: number; expected: number }[];
  }>({
    Today: [
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
    ],
    "Last 30d": [
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
    ],
  });

  // Score Board state
  const [scoreTab, setScoreTab] = React.useState("Tables");
  const [flippedCards, setFlippedCards] = React.useState<Set<string>>(new Set());
  // Column visibility for Department Performance table (desktop) - simplified to rows only
  const [showTodayCols, setShowTodayCols] = React.useState(true);
  const [showLast30Cols, setShowLast30Cols] = React.useState(true);
  const [showLast3MonthsCols, setShowLast3MonthsCols] = React.useState(true);
  const [showLastMonthCols, setShowLastMonthCols] = React.useState(true);

  // Filter mode: 'today' or 'week' - controls which data is shown in "Today" column
  const [todayFilterMode, setTodayFilterMode] = React.useState<'today' | 'week'>('today');

  // Month and year filter states - default to current month and year
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthName);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());


  // Available months and years for filtering
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const years = [2023, 2024, 2025, 2026, 2027];

  const applyTeamAvailabilityCache = useCallback((cached: DashboardTeamAvailabilityCache) => {
    setUnavailableEmployeesData(cached.unavailableEmployeesData);
    setGroupedUnavailableData(cached.groupedUnavailableData);
    setUnavailableEmployeesCount(cached.unavailableEmployeesCount);
    setCurrentlyUnavailableCount(cached.currentlyUnavailableCount);
    setScheduledTimeOffCount(cached.scheduledTimeOffCount);
    setAvailableDepartments(cached.availableDepartments);
  }, []);

  const loadScoreboardData = useCallback(
    async (opts?: { background?: boolean }) => {
      const periodKey = `${selectedYear}-${selectedMonth}`;
      const cacheKey = `dashboard-scoreboard:v21:${periodKey}`;
      const cached = getCachedData<DashboardScoreboardCache>(dashboardPathname, cacheKey);

      // Deal lists are not cached; mark not-ready until fresh fetch fills them (incl. period changes).
      if (!opts?.background) {
        setAgreementScoreboardDealsReady(false);
        setInvoicedScoreboardDealsReady(false);
      }

      if (cached) {
        setAgreementData(cached.agreementData);
        setInvoicedData(cached.invoicedData);
        setDepartmentNames(cached.departmentNames);
        setDepartmentChartData(cached.departmentChartData);
        setDepartmentPerformanceLoading(false);
        setInvoicedDataLoading(false);
        const age = Date.now() - (cached.fetchedAt ?? 0);
        if (age < getDashboardScoreboardCacheTtlMs() && !opts?.background) {
          // Keep cached totals visible, but refresh in background so count-badge deal lists populate.
          opts = { background: true };
        } else if (age < getDashboardScoreboardCacheTtlMs()) {
          return;
        }
      }

      if (!opts?.background) {
        setDepartmentPerformanceLoading(true);
        setInvoicedDataLoading(true);
      }

      try {
        const shared = await fetchDepartmentsAndCategories();
        const [agreementResult, invoicedResult] = await Promise.all([
          fetchDepartmentPerformance(shared, opts),
          fetchInvoicedData(shared, opts),
        ]);
        if (agreementResult && invoicedResult) {
          setDepartmentNames(agreementResult.departmentNames);
          setDepartmentChartData(agreementResult.departmentChartData);
          setCachedData(dashboardPathname, cacheKey, {
            agreementData: agreementResult.agreementData,
            invoicedData: invoicedResult,
            departmentNames: agreementResult.departmentNames,
            departmentChartData: agreementResult.departmentChartData,
            fetchedAt: Date.now(),
          });
        }
      } catch {
        await Promise.all([
          fetchDepartmentPerformance(undefined, opts),
          fetchInvoicedData(undefined, opts),
        ]);
      }
    },
    [dashboardPathname, selectedMonth, selectedYear],
  );

  const loadTeamAvailability = useCallback(
    async (date: string, opts?: { background?: boolean }) => {
      const cacheKey = `dashboard-team-availability:v2:${date}`;
      const cached = getCachedData<DashboardTeamAvailabilityCache>(dashboardPathname, cacheKey);

      if (cached) {
        applyTeamAvailabilityCache(cached);
        setUnavailableEmployeesLoading(false);
        const age = Date.now() - (cached.fetchedAt ?? 0);
        if (age < getDashboardTeamAvailabilityCacheTtlMs() && !opts?.background) {
          return;
        }
      }

      if (!opts?.background) {
        setUnavailableEmployeesLoading(true);
      }
      await fetchUnavailableEmployeesData(date);
    },
    [applyTeamAvailabilityCache, dashboardPathname],
  );

  // Scoreboard (Agreement signed + Invoiced): cache-first load; refetch on month/year change.
  useEffect(() => {
    void loadScoreboardData();
  }, [loadScoreboardData]);

  useEffect(() => {
    if (!departmentPerformanceLoading) {
      reportWelcomeReady?.();
    }
  }, [departmentPerformanceLoading, reportWelcomeReady]);

  // Live refresh: background refetch (no full-page spinner) when realtime bumps the token.
  useEffect(() => {
    if (scoreboardRefreshToken === 0) return;
    void loadScoreboardData({ background: true });
  }, [scoreboardRefreshToken, loadScoreboardData]);

  // Team availability: cache-first load; refetch on date change.
  useEffect(() => {
    void loadTeamAvailability(teamAvailabilityDate);
  }, [teamAvailabilityDate, loadTeamAvailability]);

  useEffect(() => {
    if (teamAvailabilityRefreshToken === 0) return;
    void loadTeamAvailability(teamAvailabilityDate, { background: true });
  }, [teamAvailabilityRefreshToken, teamAvailabilityDate, loadTeamAvailability]);

  // Live updates (same pattern as CalendarPage): debounced refresh without resetting the whole dashboard.
  useEffect(() => {
    const scheduleScoreboardRefresh = (ms = 500) => {
      if (typeof window === 'undefined') return;
      if (realtimeRefreshTimerRef.current) window.clearTimeout(realtimeRefreshTimerRef.current);
      realtimeRefreshTimerRef.current = window.setTimeout(() => {
        realtimeRefreshTimerRef.current = null;
        setScoreboardRefreshToken((t) => t + 1);
      }, ms);
    };

    const scheduleTeamAvailabilityRefresh = () => {
      if (typeof window === 'undefined') return;
      if (realtimeRefreshTimerRef.current) window.clearTimeout(realtimeRefreshTimerRef.current);
      realtimeRefreshTimerRef.current = window.setTimeout(() => {
        realtimeRefreshTimerRef.current = null;
        setTeamAvailabilityRefreshToken((t) => t + 1);
      }, 250);
    };

    const channel = supabase
      .channel('dashboard-page:realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads_leadstage' }, () => {
        scheduleScoreboardRefresh(500);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_plans' }, () => {
        scheduleScoreboardRefresh(500);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'finances_paymentplanrow' }, () => {
        scheduleScoreboardRefresh(500);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, () => {
        scheduleScoreboardRefresh(800);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads_lead' }, () => {
        scheduleScoreboardRefresh(800);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contracts' }, () => {
        scheduleScoreboardRefresh(500);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'employee_unavailability_reasons' }, () => {
        scheduleTeamAvailabilityRefresh();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tenants_employee' }, () => {
        scheduleTeamAvailabilityRefresh();
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          console.warn('[Dashboard] realtime subscription failed — performance boxes will not auto-update');
        }
      });

    return () => {
      if (realtimeRefreshTimerRef.current && typeof window !== 'undefined') {
        window.clearTimeout(realtimeRefreshTimerRef.current);
      }
      void supabase.removeChannel(channel);
    };
  }, []);

  // Refresh team availability when modal closes (force background refresh).
  useEffect(() => {
    if (!isUnavailableEmployeesModalOpen) {
      void loadTeamAvailability(teamAvailabilityDate, { background: true });
    }
  }, [isUnavailableEmployeesModalOpen, teamAvailabilityDate, loadTeamAvailability]);

  // Invoiced data (second table) - will be populated with real data
  const [invoicedData, setInvoicedData] = useState<{
    Today: { count: number; amount: number; expected: number }[];
    "Last 30d": { count: number; amount: number; expected: number }[];
    [key: string]: { count: number; amount: number; expected: number }[];
  }>({
    Today: [
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
    ],
    "Last 30d": [
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
    ],
    [selectedMonth]: [
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
    ],
  });

  const scoreboardHighlights = {
    [selectedMonth]: [
      null,
      null,
      { amount: 100000 },
      { amount: 70000 },
      { amount: 150000 },
      { amount: 250000 },
      { amount: 1700000 },
      { amount: 2350000 },
    ],
  };

  // Derived totals for Department Performance table (exclude 'General' and 'Total')
  const includedDeptIndexes = scoreboardCategories
    .map((cat, idx) => ({ cat, idx }))
    .filter(({ cat }) => cat !== 'General' && cat !== 'Total')
    .map(({ idx }) => idx);
  const departmentCategories = includedDeptIndexes.map(idx => scoreboardCategories[idx]);
  const mobileCategories = scoreboardCategories.filter(cat => cat !== 'General');

  type MobilePeriodType = 'today' | 'last30d' | 'currentMonth' | 'target';
  const [mobilePeriodRows, setMobilePeriodRows] = useState<{ id: string; period: MobilePeriodType }[]>([
    { id: 'row-today', period: 'today' },
  ]);

  const mobilePeriodOptions: { period: MobilePeriodType; label: string }[] = [
    { period: 'today', label: 'Today' },
    { period: 'last30d', label: 'Last 30d' },
    { period: 'currentMonth', label: selectedMonth },
    { period: 'target', label: 'Target' },
  ];

  const addMobilePeriodRow = (period: MobilePeriodType) => {
    setMobilePeriodRows((prev) => [
      ...prev,
      { id: `${period}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, period },
    ]);
  };

  const toggleMobilePeriodRow = (period: MobilePeriodType) => {
    setMobilePeriodRows((prev) => {
      const existingIndex = prev.findIndex((row) => row.period === period);
      if (existingIndex !== -1) {
        if (prev.length <= 1) {
          return prev;
        }
        const next = [...prev];
        next.splice(existingIndex, 1);
        return next;
      }
      return [
        ...prev,
        { id: `${period}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, period },
      ];
    });
  };

  const getMobilePeriodInfo = (period: MobilePeriodType) => {
    switch (period) {
      case 'today':
        return { 
          label: 'Today', 
          gradient: isAltTheme ? 'from-green-500 to-emerald-600' : 'from-indigo-500 to-purple-600', 
          dotColor: isAltTheme ? 'bg-green-500' : 'bg-indigo-500' 
        };
      case 'last30d':
        return { 
          label: 'Last 30d', 
          gradient: isAltTheme ? 'from-emerald-500 to-green-600' : 'from-purple-500 to-indigo-600', 
          dotColor: isAltTheme ? 'bg-emerald-500' : 'bg-purple-500' 
        };
      case 'currentMonth':
        return { 
          label: selectedMonth, 
          gradient: isAltTheme ? 'from-green-500 to-lime-600' : 'from-blue-500 to-cyan-600', 
          dotColor: isAltTheme ? 'bg-green-500' : 'bg-blue-500' 
        };
      case 'target':
        return { label: 'Target', gradient: 'from-emerald-500 to-teal-600', dotColor: 'bg-emerald-500' };
      default:
        return { 
          label: 'Today', 
          gradient: isAltTheme ? 'from-green-500 to-emerald-600' : 'from-indigo-500 to-purple-600', 
          dotColor: isAltTheme ? 'bg-green-500' : 'bg-indigo-500' 
        };
    }
  };

  const getMobilePeriodData = (period: MobilePeriodType, category: string, dataType: 'agreement' | 'invoiced' = 'agreement') => {
    const defaultValue = { count: 0, amount: 0, expected: 0 };
    const dataSource = dataType === 'agreement' ? agreementData : invoicedData;
    const categoryIndex = scoreboardCategories.indexOf(category);
    const todayData = dataSource['Today']?.[categoryIndex] || defaultValue;
    const last30Data = dataSource['Last 30d']?.[categoryIndex] || defaultValue;
    const monthArray = dataSource[selectedMonth] || [];
    const monthIndex =
      category === 'Total'
        ? departmentNames.length
        : Math.max(0, departmentNames.indexOf(category));
    const monthData = monthArray[monthIndex] || defaultValue;
    const targetData = {
      count: 0,
      amount: 0,
      expected: monthData.expected || last30Data.expected || todayData.expected || 0,
    };

    switch (period) {
      case 'today':
        return todayData;
      case 'last30d':
        return last30Data;
      case 'currentMonth':
        return monthData;
      case 'target':
        return targetData;
      default:
        return todayData;
    }
  };

  // Stable targets for Today where not provided
  const randomTodayTargetsRef = useRef<number[]>([]);
  useEffect(() => {
    if (randomTodayTargetsRef.current.length === 0) {
      randomTodayTargetsRef.current = scoreboardCategories.map((_, idx) => {
        const provided = agreementData['Today'][idx]?.expected;
        return provided || 0;
      });
    }
  }, []);

  const sumTodayCount = includedDeptIndexes.reduce((sum: number, i: number) => sum + (agreementData['Today'][i]?.count || 0), 0);
  const sumTodayAmount = includedDeptIndexes.reduce((sum: number, i: number) => sum + (agreementData['Today'][i]?.amount || 0), 0);
  const sumTodayExpected = includedDeptIndexes.reduce((sum: number, i: number) => sum + ((agreementData['Today'][i]?.expected || randomTodayTargetsRef.current[i] || 0)), 0);

  const sum30Count = includedDeptIndexes.reduce((sum: number, i: number) => sum + (agreementData['Last 30d'][i]?.count || 0), 0);
  const sum30Amount = includedDeptIndexes.reduce((sum: number, i: number) => sum + (agreementData['Last 30d'][i]?.amount || 0), 0);
  const sum30Expected = includedDeptIndexes.reduce((sum: number, i: number) => sum + (agreementData['Last 30d'][i]?.expected || 0), 0);

  const sumMonthCount = sum30Count; // using 30d as proxy for this month (demo)
  const sumMonthAmount = sum30Amount;
  const sumMonthTarget = sum30Expected;
  const totalPerformancePct = sum30Expected > 0 ? Math.round((sum30Amount / sum30Expected) * 100) : 0;

  // Mock data for department line graphs (last 30 days)
  const generateDepartmentData = (category: string) => {
    const today = new Date();
    const data = Array.from({ length: 30 }, (_, i) => {
      const date = new Date(today);
      date.setDate(today.getDate() - (29 - i));

      // Different patterns for different departments
      let baseValue = 0;
      switch (category) {
        case 'General':
          baseValue = Math.random() * 2;
          break;
        case 'Commercial & Civil':
          baseValue = 3 + Math.sin(i / 5) * 2 + Math.random() * 1.5;
          break;
        case 'Small cases':
          baseValue = 1 + Math.cos(i / 3) * 1 + Math.random() * 2;
          break;
        case 'USA - Immigration':
          baseValue = 2 + Math.sin(i / 4) * 1.5 + Math.random() * 1;
          break;
        case 'Immigration to Israel':
          baseValue = 4 + Math.cos(i / 6) * 2 + Math.random() * 2;
          break;
        case 'Austria and Germany':
          baseValue = 15 + Math.sin(i / 7) * 5 + Math.random() * 3;
          break;
        default:
          baseValue = Math.random() * 5;
      }

      return {
        date: date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
        fullDate: date.toLocaleDateString(),
        contracts: Math.max(0, Math.round(baseValue))
      };
    });
    return data;
  };

  // Handle card flip
  const handleCardFlip = (cardKey: string) => {
    setFlippedCards(prev => {
      const newSet = new Set(prev);
      if (newSet.has(cardKey)) {
        newSet.delete(cardKey);
      } else {
        newSet.add(cardKey);
      }
      return newSet;
    });
  };

  // Compute chart data from actual agreementData and invoicedData
  // "signed" = signed agreements (from agreementData)
  // "due" = invoiced (from invoicedData)
  const scoreboardBarDataToday = useMemo(() => {
    // Filter out "General" from departmentNames if it exists to avoid duplicates
    const filteredDeptNames = departmentNames.filter(name => name !== 'General');
    const categories = ['General', ...filteredDeptNames, 'Total'];

    // Create a mapping from department name to its index in departmentNames (which matches data structure order)
    const deptNameToIndex = new Map<string, number>();
    departmentNames.forEach((name, idx) => {
      if (name !== 'General') {
        deptNameToIndex.set(name, idx);
      }
    });

    return categories.map((category, index) => {
      let signedAmount = 0;
      let dueAmount = 0;

      if (index === 0) {
        // General -> data index 0
        signedAmount = agreementData['Today']?.[0]?.amount || 0;
        dueAmount = invoicedData['Today']?.[0]?.amount || 0;
      } else if (index === categories.length - 1) {
        // Total -> data index = departmentNames.length + 1
        signedAmount = agreementData['Today']?.[departmentNames.length + 1]?.amount || 0;
        dueAmount = invoicedData['Today']?.[departmentNames.length + 1]?.amount || 0;
      } else {
        // Department -> find its index in departmentNames to get correct data index
        const deptIndexInNames = deptNameToIndex.get(category);
        if (deptIndexInNames !== undefined) {
          // Data index = deptIndexInNames + 1 (because General is at index 0)
          signedAmount = agreementData['Today']?.[deptIndexInNames + 1]?.amount || 0;
          dueAmount = invoicedData['Today']?.[deptIndexInNames + 1]?.amount || 0;
        }
      }

      return {
        category,
        signed: Math.ceil(signedAmount),
        due: Math.ceil(dueAmount),
      };
    });
  }, [departmentNames, agreementData, invoicedData]);

  const scoreboardBarData30d = useMemo(() => {
    // Filter out "General" from departmentNames if it exists to avoid duplicates
    const filteredDeptNames = departmentNames.filter(name => name !== 'General');
    const categories = ['General', ...filteredDeptNames, 'Total'];

    // Create a mapping from department name to its index in departmentNames (which matches data structure order)
    const deptNameToIndex = new Map<string, number>();
    departmentNames.forEach((name, idx) => {
      if (name !== 'General') {
        deptNameToIndex.set(name, idx);
      }
    });

    return categories.map((category, index) => {
      let signedAmount = 0;
      let dueAmount = 0;

      if (index === 0) {
        // General -> data index 0
        signedAmount = agreementData['Last 30d']?.[0]?.amount || 0;
        dueAmount = invoicedData['Last 30d']?.[0]?.amount || 0;
      } else if (index === categories.length - 1) {
        // Total -> data index = departmentNames.length + 1
        signedAmount = agreementData['Last 30d']?.[departmentNames.length + 1]?.amount || 0;
        dueAmount = invoicedData['Last 30d']?.[departmentNames.length + 1]?.amount || 0;
      } else {
        // Department -> find its index in departmentNames to get correct data index
        const deptIndexInNames = deptNameToIndex.get(category);
        if (deptIndexInNames !== undefined) {
          // Data index = deptIndexInNames + 1 (because General is at index 0)
          signedAmount = agreementData['Last 30d']?.[deptIndexInNames + 1]?.amount || 0;
          dueAmount = invoicedData['Last 30d']?.[deptIndexInNames + 1]?.amount || 0;
        }
      }

      return {
        category,
        signed: Math.ceil(signedAmount),
        due: Math.ceil(dueAmount),
      };
    });
  }, [departmentNames, agreementData, invoicedData]);

  const scoreboardBarDataMonth = useMemo(() => {
    // Filter out "General" from departmentNames if it exists to avoid duplicates
    const filteredDeptNames = departmentNames.filter(name => name !== 'General');
    const categories = [...filteredDeptNames, 'Total'];
    const selectedMonthName = new Date(selectedYear, months.indexOf(selectedMonth), 1).toLocaleDateString('en-US', { month: 'long' });

    // Create a mapping from department name to its index in departmentNames (which matches data structure order)
    const deptNameToIndex = new Map<string, number>();
    departmentNames.forEach((name, idx) => {
      if (name !== 'General') {
        deptNameToIndex.set(name, idx);
      }
    });

    return categories.map((category, index) => {
      let signedAmount = 0;
      let dueAmount = 0;

      if (index === categories.length - 1) {
        // Total -> data index = departmentNames.length (no General column in month data)
        signedAmount = agreementData[selectedMonthName]?.[departmentNames.length]?.amount || 0;
        dueAmount = invoicedData[selectedMonthName]?.[departmentNames.length]?.amount || 0;
      } else {
        // Department -> find its index in departmentNames to get correct data index
        const deptIndexInNames = deptNameToIndex.get(category);
        if (deptIndexInNames !== undefined) {
          // For month data: no General column, so data index = deptIndexInNames
          signedAmount = agreementData[selectedMonthName]?.[deptIndexInNames]?.amount || 0;
          dueAmount = invoicedData[selectedMonthName]?.[deptIndexInNames]?.amount || 0;
        }
      }

      return {
        category,
        signed: Math.ceil(signedAmount),
        due: Math.ceil(dueAmount),
      };
    });
  }, [departmentNames, agreementData, invoicedData, selectedMonth, selectedYear, months]);

  // Custom Tooltip for My Performance chart
  const PerformanceTooltip = ({ active, payload, label }: { active?: boolean; payload?: any[]; label?: string }) => {
    if (!active || !payload || payload.length === 0) return null;
    // Find the team avg for this date
    const teamAvgObj = teamAverageData.find(d => d.date === label);
    const teamAvg = teamAvgObj ? Math.ceil(teamAvgObj.avg) : null;
    // Find my contracts for this date
    const myContractsObj = performanceData.find(d => d.date === label);
    const myContracts = myContractsObj ? myContractsObj.count : null;
    return (
      <div style={{ background: 'rgba(0,0,0,0.8)', borderRadius: 12, color: '#fff', padding: 12, minWidth: 120 }}>
        <div className="font-bold mb-1">{label}</div>
        {myContracts !== null && (
          <div>Contracts: {myContracts} contracts</div>
        )}
        {teamAvg !== null && (
          <div>Team Avg: {teamAvg} contracts</div>
        )}
      </div>
    );
  };

  // NO LOADING SCREEN - render immediately, data will load in background
  // AuthContext is now instant, so we can always render

  // Split department name at space near middle for two-line header on mobile (saves column width)
  const splitCategoryTwoLines = (name: string): [string, string] => {
    const t = name.trim();
    if (!t) return ['', ''];
    const mid = Math.floor(t.length / 2);
    const spaceBefore = t.lastIndexOf(' ', mid);
    const spaceAfter = t.indexOf(' ', mid);
    if (spaceBefore === -1 && spaceAfter === -1) return [t, ''];
    if (spaceBefore === -1) return [t.slice(0, spaceAfter), t.slice(spaceAfter + 1)];
    if (spaceAfter === -1) return [t.slice(0, spaceBefore), t.slice(spaceBefore + 1)];
    const splitAt = (mid - spaceBefore <= spaceAfter - mid) ? spaceBefore : spaceAfter;
    return [t.slice(0, splitAt), t.slice(splitAt + 1)];
  };

  // Helper function to render table in columns view (departments as columns)
  const renderColumnsView = (tableType: 'agreement' | 'invoiced') => {
    const categories = scoreboardCategories.filter(cat => cat !== 'General' && cat !== 'Total');
    const visibleColumns: string[] = [];
    if (showTodayCols) {
      if (todayFilterMode === 'week') visibleColumns.push('Week');
      else visibleColumns.push('Today');
    }
    if (showLast30Cols) visibleColumns.push('Last 30d');
    if (showLast3MonthsCols) visibleColumns.push(SCOREBOARD_LAST_3M);
    if (showLastMonthCols) visibleColumns.push(selectedMonth);

    const dataSource: { [key: string]: { count: number; amount: number; expected: number }[] } = tableType === 'agreement' ? agreementData : invoicedData;
    const totalIndexToday = departmentNames.length + 1;
    const totalIndexMonth = departmentNames.length;

    const openScoreboardDeals = (period: string, departmentName: string, count: number) => {
      if (!count) return;
      setScoreboardDealsModal({ tableType, period, departmentName });
    };

    const getDeptData = (deptName: string, periodKey: 'Today' | 'Week' | 'Yesterday' | 'Last 30d' | string) => {
      const deptIndexInNames = departmentNames.indexOf(deptName);
      const dataIndex = deptIndexInNames >= 0 ? deptIndexInNames : categories.indexOf(deptName);
      const isMonthLayout = periodKey === selectedMonth;
      const row = isMonthLayout ? dataSource[periodKey]?.[dataIndex] : dataSource[periodKey]?.[dataIndex + 1];
      return row || { count: 0, amount: 0, expected: 0 };
    };

    const getTotalData = (periodKey: 'Today' | 'Yesterday' | 'Week' | 'Last 30d' | string) => {
      const isMonthLayout = periodKey === selectedMonth;
      const row = isMonthLayout ? dataSource[periodKey]?.[totalIndexMonth] : dataSource[periodKey]?.[totalIndexToday];
      return row || { count: 0, amount: 0, expected: 0 };
    };

    const mobilePeriods = [
      ...(showTodayCols
        ? [{
            key: 'Today' as const,
            label: todayFilterMode === 'week' ? 'Week' : 'Today',
            dataKey: todayFilterMode === 'week' ? 'Week' : 'Today',
          }]
        : []),
      ...(showLast30Cols
        ? [{ key: 'Last 30d' as const, label: 'Last 30d', dataKey: 'Last 30d' }]
        : []),
      ...(showLast3MonthsCols
        ? [{ key: SCOREBOARD_LAST_3M, label: SCOREBOARD_LAST_3M, dataKey: SCOREBOARD_LAST_3M }]
        : []),
      ...(showLastMonthCols
        ? [{ key: selectedMonth, label: selectedMonth, dataKey: selectedMonth }]
        : []),
      // Always keep Target month visible at the end (independent of This Month filter)
      { key: `Target ${selectedMonth}`, label: `Target ${selectedMonth}`, dataKey: `Target ${selectedMonth}` },
    ];

    // Table full width on mobile (no inner box); desktop keeps existing layout
    return (
      <>
        {/* Mobile: departments as rows, periods as columns */}
        <div className="md:hidden overflow-x-auto w-full min-w-0 px-2 pb-2">
          <table className="w-full min-w-[600px] text-sm table-fixed">
            <thead className="bg-white sticky top-0">
              <tr>
                <th className="text-left px-1.5 py-2 font-semibold text-slate-700 w-[96px]">Department</th>
                {mobilePeriods.map((p) => (
                  <th key={p.key} className="text-center px-1.5 py-2 font-semibold text-slate-700 w-[118px]">
                    {p.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[...categories, 'Total'].map((deptName) => (
                <tr key={deptName} className="hover:bg-slate-50">
                  <td className="px-1.5 py-2 font-semibold text-slate-800 align-top">
                    {(() => {
                      if (deptName === 'Total') return <span className="whitespace-nowrap">Total</span>;
                      const [l1, l2] = splitCategoryTwoLines(deptName);
                      return (
                        <span className="leading-tight text-xs">
                          {l1}
                          {l2 ? (
                            <>
                              <br />
                              {l2}
                            </>
                          ) : null}
                        </span>
                      );
                    })()}
                  </td>
                  {mobilePeriods.map((p) => {
                    if (p.key === `Target ${selectedMonth}`) {
                      const row = deptName === 'Total'
                        ? (() => {
                          const otherIdx = departmentNames.indexOf(SCOREBOARD_OTHER_COLUMN);
                          // Include dedicated departments + Other (exclude Total slot).
                          const endExclusive = otherIdx >= 0 ? otherIdx + 1 : departmentNames.length;
                          const totalTarget = dataSource[selectedMonth]?.slice(0, endExclusive).reduce(
                            (sum: number, item: { count: number; amount: number; expected: number }) => sum + (item.expected || 0),
                            0,
                          ) || 0;
                          return { expected: totalTarget, amount: getTotalData(selectedMonth).amount };
                        })()
                        : (() => {
                          const data = getDeptData(deptName, selectedMonth);
                          return { expected: data.expected || 0, amount: data.amount || 0 };
                        })();
                      const target = row.expected || 0;
                      const amount = row.amount || 0;
                      const targetClass = target > 0 ? (amount >= target ? 'text-green-700' : 'text-red-700') : 'text-slate-700';
                      return (
                        <td key={`${deptName}-${p.key}`} className={`px-1.5 py-2 text-center font-semibold whitespace-nowrap ${targetClass}`}>
                          {target ? `₪${Math.ceil(target).toLocaleString()}` : '—'}
                        </td>
                      );
                    }

                    const row = deptName === 'Total'
                      ? getTotalData(p.dataKey)
                      : getDeptData(deptName, p.dataKey);
                    const displayAmount = p.key === SCOREBOARD_LAST_3M
                      ? scoreboardThreeMonthAverage(row.amount || 0)
                      : (row.amount || 0);
                    return (
                      <td key={`${deptName}-${p.key}`} className="px-1.5 py-2 text-center">
                        <div className="inline-flex flex-col items-center gap-0.5">
                          <button
                            type="button"
                            className={`badge badge-ghost text-[11px] font-semibold px-1.5 py-1 leading-none border-0 ${
                              (row.count || 0) > 0 ? 'cursor-pointer hover:bg-slate-200' : 'cursor-default'
                            }`}
                            onClick={() => openScoreboardDeals(p.dataKey, deptName, row.count || 0)}
                            disabled={!(row.count > 0)}
                            title={(row.count || 0) > 0 ? 'View deals' : undefined}
                          >
                            {row.count || 0}
                          </button>
                          <div className="text-[13px] font-semibold text-slate-800 whitespace-nowrap leading-tight">
                            ₪{Math.ceil(displayAmount).toLocaleString()}
                          </div>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Desktop: existing layout */}
        <div className="hidden md:block overflow-x-auto w-full min-w-0">
          <table className="min-w-full text-xs md:text-sm w-full">
            <thead className="bg-white">
              <tr>
                <th className="text-left px-0.5 md:px-5 py-1.5 md:py-3 text-xs md:text-sm font-semibold text-slate-700"></th>
                {categories.map(category => {
                  const [line1, line2] = splitCategoryTwoLines(category);
                  return (
                    <th key={category} className="text-center px-0.5 md:px-5 py-1 md:py-3 text-[10px] md:text-sm font-semibold text-slate-700 align-bottom">
                      <span className="hidden md:inline whitespace-nowrap">{category}</span>
                      <span className="md:hidden leading-tight">{line1}{line2 ? <><br />{line2}</> : ''}</span>
                    </th>
                  );
                })}
                <th className="text-center px-0.5 md:px-5 py-1.5 md:py-3 text-xs md:text-sm font-semibold text-slate-700">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleColumns.map(columnType => {
                const isToday = columnType === 'Today';
                const isYesterday = columnType === 'Yesterday';
                const isWeek = columnType === 'Week';
                const isLast30 = columnType === 'Last 30d';
                const isLast3m = columnType === SCOREBOARD_LAST_3M;

                return (
                  <React.Fragment key={columnType}>
                    <tr className="hover:bg-slate-50">
                      <td className="px-0.5 md:px-5 py-1.5 md:py-3 text-xs md:text-sm font-semibold text-slate-700 whitespace-nowrap">{columnType}</td>
                      {categories.map((category, index) => {
                        const deptIndexInNames = departmentNames.indexOf(category);
                        const dataIndex = deptIndexInNames >= 0 ? deptIndexInNames : index;
                        const data = isToday ? dataSource["Today"]?.[dataIndex + 1] :
                          isYesterday ? dataSource["Yesterday"]?.[dataIndex + 1] :
                            isWeek ? dataSource["Week"]?.[dataIndex + 1] :
                              isLast30 ? dataSource["Last 30d"]?.[dataIndex + 1] :
                                isLast3m ? dataSource[SCOREBOARD_LAST_3M]?.[dataIndex + 1] :
                                  dataSource[selectedMonth]?.[dataIndex];
                        const amount = data?.amount ?? 0;
                        const displayAmount = isLast3m ? scoreboardThreeMonthAverage(amount) : amount;
                        return (
                          <td key={`${category}-combined`} className="px-0.5 md:px-5 py-1 md:py-3 text-center">
                            <div className="space-y-0.5 md:space-y-1">
                              <button
                                type="button"
                                className={`badge text-[10px] md:text-xs font-semibold px-0.5 md:px-2 py-0.5 bg-slate-100 text-slate-700 border-0 ${
                                  (data?.count ?? 0) > 0 ? 'cursor-pointer hover:bg-slate-200' : 'cursor-default'
                                }`}
                                onClick={() => openScoreboardDeals(columnType, category, data?.count ?? 0)}
                                disabled={!((data?.count ?? 0) > 0)}
                                title={(data?.count ?? 0) > 0 ? 'View deals' : undefined}
                              >
                                {data?.count ?? 0}
                              </button>
                              <div className="border-t border-slate-200 my-0.5 md:my-1"></div>
                              <div className="text-[10px] md:text-sm font-semibold text-slate-700 whitespace-nowrap">
                                ₪{Math.ceil(displayAmount).toLocaleString()}
                              </div>
                            </div>
                          </td>
                        );
                      })}
                      <td className="px-0.5 md:px-5 py-1 md:py-3 text-center text-slate-700">
                        <div className="space-y-0.5 md:space-y-1">
                          <div className="flex items-center justify-center">
                            {(() => {
                              const totalCount = isToday ? (dataSource["Today"]?.[totalIndexToday]?.count ?? 0) :
                                isWeek ? (dataSource["Week"]?.[totalIndexToday]?.count ?? 0) :
                                  isLast30 ? (dataSource["Last 30d"]?.[totalIndexToday]?.count ?? 0) :
                                    isLast3m ? (dataSource[SCOREBOARD_LAST_3M]?.[totalIndexToday]?.count ?? 0) :
                                      (dataSource[selectedMonth]?.[totalIndexMonth]?.count ?? 0);
                              return (
                                <button
                                  type="button"
                                  className={`badge text-[10px] md:text-xs bg-slate-100 text-slate-700 font-semibold px-0.5 md:px-2 py-0.5 border-0 ${
                                    totalCount > 0 ? 'cursor-pointer hover:bg-slate-200' : 'cursor-default'
                                  }`}
                                  onClick={() => openScoreboardDeals(columnType, 'Total', totalCount)}
                                  disabled={!(totalCount > 0)}
                                  title={totalCount > 0 ? 'View deals' : undefined}
                                >
                                  {totalCount}
                                </button>
                              );
                            })()}
                          </div>
                          <div className="border-t border-slate-200 my-0.5 md:my-1"></div>
                          <div className="text-[10px] md:text-sm font-semibold text-slate-700 whitespace-nowrap">
                            ₪{Math.ceil(
                              isToday ? (dataSource["Today"]?.[totalIndexToday]?.amount ?? 0) :
                                isWeek ? (dataSource["Week"]?.[totalIndexToday]?.amount ?? 0) :
                                  isLast30 ? (dataSource["Last 30d"]?.[totalIndexToday]?.amount ?? 0) :
                                    isLast3m ? scoreboardThreeMonthAverage(dataSource[SCOREBOARD_LAST_3M]?.[totalIndexToday]?.amount ?? 0) :
                                      (dataSource[selectedMonth]?.[totalIndexMonth]?.amount ?? 0)
                            ).toLocaleString()}
                          </div>
                        </div>
                      </td>
                    </tr>
                  </React.Fragment>
                );
              })}
              {/* Always keep Target month at the bottom (independent of This Month filter) */}
              <tr className="bg-white border border-slate-200">
                <td className="px-0.5 md:px-5 py-1 md:py-3 text-xs md:text-sm font-semibold text-slate-700 whitespace-nowrap">Target {selectedMonth}</td>
                {categories.map((category) => {
                  const data = getDeptData(category, selectedMonth);
                  const amount = data.amount ?? 0;
                  const target = data.expected ?? 0;
                  const targetClass = target > 0 ? (amount >= target ? 'text-green-600' : 'text-red-600') : 'text-slate-700';
                  return (
                    <td key={`${category}-target`} className={`px-0.5 md:px-5 py-1 md:py-3 text-center text-[10px] md:text-sm font-semibold ${targetClass} whitespace-nowrap`}>
                      {target ? `₪${Math.ceil(target).toLocaleString()}` : '—'}
                    </td>
                  );
                })}
                <td
                  className={`px-0.5 md:px-5 py-1 md:py-3 text-center text-[10px] md:text-sm font-semibold whitespace-nowrap ${(() => {
                    const otherIdx = departmentNames.indexOf(SCOREBOARD_OTHER_COLUMN);
                    const endExclusive = otherIdx >= 0 ? otherIdx + 1 : departmentNames.length;
                    const totalTarget =
                      dataSource[selectedMonth]?.slice(0, endExclusive).reduce(
                        (sum: number, item: { count: number; amount: number; expected: number }) =>
                          sum + (item.expected || 0),
                        0,
                      ) || 0;
                    const totalAmount = dataSource[selectedMonth]?.[totalIndexMonth]?.amount ?? 0;
                    if (!(totalTarget > 0)) return 'text-slate-700';
                    return totalAmount >= totalTarget ? 'text-green-600' : 'text-red-600';
                  })()}`}
                >
                  {(() => {
                    const otherIdx = departmentNames.indexOf(SCOREBOARD_OTHER_COLUMN);
                    const endExclusive = otherIdx >= 0 ? otherIdx + 1 : departmentNames.length;
                    const totalTarget =
                      dataSource[selectedMonth]?.slice(0, endExclusive).reduce(
                        (sum: number, item: { count: number; amount: number; expected: number }) =>
                          sum + (item.expected || 0),
                        0,
                      ) || 0;
                    return totalTarget ? `₪${Math.ceil(totalTarget).toLocaleString()}` : '—';
                  })()}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </>
    );
  };

  // 2. Add effect to fetch real signed leads when showLeadsList is true
  useEffect(() => {
    if (!showLeadsList) return;
    setRealLeadsLoading(true);

    (async () => {
      try {
        // Calculate date 30 days ago
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const thirtyDaysAgoStr = thirtyDaysAgo.toISOString();

        // Fetch contracts signed (stage = 60) from last 30 days
        const { data: contractsData, error: contractsError } = await supabase
          .from('leads_leadstage')
          .select(`
            id,
            stage,
            date,
            creator_id,
            lead_id,
            newlead_id
          `)
          .eq('stage', 60)
          .gte('date', thirtyDaysAgoStr)
          .order('date', { ascending: false });

        if (contractsError) {
          setRealSignedLeads([]);
          setRealLeadsLoading(false);
          return;
        }

        // Get current user info
        const user = await resolveDashboardAuthUser();
        if (!user) {
          setRealSignedLeads([]);
          setRealLeadsLoading(false);
          return;
        }

        const { data: userData } = await supabase
          .from('users')
          .select(`
            id,
            full_name,
            employee_id,
            tenants_employee!employee_id(
              id,
              display_name
            )
          `)
          .eq('auth_id', user.id)
          .maybeSingle();

        const userFullName = (userData?.tenants_employee as any)?.display_name || userData?.full_name;
        const userEmployeeId = userData?.employee_id;

        // Filter contracts that belong to current user and deduplicate by lead
        const userContractsMap = new Map<string, any>();

        for (const contract of contractsData || []) {
          let belongsToUser = false;

          if (contract.creator_id) {
            belongsToUser = contract.creator_id === userEmployeeId;
          } else {
            // If creator_id is NULL, get closer from the lead
            if (contract.newlead_id) {
              const { data: newLead } = await supabase
                .from('leads')
                .select('closer')
                .eq('id', contract.newlead_id)
                .maybeSingle();

              if (newLead?.closer === userFullName) {
                belongsToUser = true;
              }
            } else if (contract.lead_id) {
              const { data: legacyLead } = await supabase
                .from('leads_lead')
                .select('closer_id')
                .eq('id', contract.lead_id)
                .maybeSingle();

              if (legacyLead?.closer_id === userEmployeeId) {
                belongsToUser = true;
              }
            }
          }

          if (belongsToUser) {
            // Deduplicate by lead_id/newlead_id - keep only the first (most recent) contract per lead
            const leadKey = contract.newlead_id ? `new_${contract.newlead_id}` : `legacy_${contract.lead_id}`;
            if (!userContractsMap.has(leadKey)) {
              userContractsMap.set(leadKey, contract);
            }
          }
        }

        // Convert map to array
        const userContracts = Array.from(userContractsMap.values());

        // Get unique lead IDs (both new and legacy) - already deduplicated
        const newLeadIds = [...new Set(userContracts.map(c => c.newlead_id).filter(Boolean))];
        const legacyLeadIds = [...new Set(userContracts.map(c => c.lead_id).filter(Boolean))];

        // Fetch new leads data
        let newLeadsData: any[] = [];
        if (newLeadIds.length > 0) {
          const { data: newLeads, error: newLeadsError } = await supabase
            .from('leads')
            .select(`
              id,
              lead_number,
              name,
              category,
              category_id,
              date_signed,
              number_of_applicants_meeting,
              balance,
              balance_currency,
              proposal_total,
              proposal_currency
            `)
            .in('id', newLeadIds);

          if (!newLeadsError && newLeads) {
            newLeadsData = newLeads;
          }
        }

        // Fetch legacy leads data
        let legacyLeadsData: any[] = [];
        if (legacyLeadIds.length > 0) {
          const { data: legacyLeads, error: legacyLeadsError } = await supabase
            .from('leads_lead')
            .select(`
              id,
              name,
              category_id,
              no_of_applicants,
              total,
              currency_id
            `)
            .in('id', legacyLeadIds);

          if (!legacyLeadsError && legacyLeads) {
            // Fetch currency codes
            const currencyIds = legacyLeads.map(l => l.currency_id).filter(Boolean);
            let currencyMap: Record<number, string> = {};

            if (currencyIds.length > 0) {
              const { data: currencies } = await supabase
                .from('accounting_currencies')
                .select('id, iso_code')
                .in('id', currencyIds);

              if (currencies) {
                currencyMap = currencies.reduce((acc, curr) => {
                  acc[curr.id] = curr.iso_code;
                  return acc;
                }, {} as Record<number, string>);
              }
            }

            legacyLeadsData = legacyLeads.map(lead => ({
              ...lead,
              currency_code: currencyMap[lead.currency_id] || '₪'
            }));
          }
        }

        // Fetch categories with main categories for category names
        const allCategoryIds = [
          ...new Set([
            ...newLeadsData.map(l => l.category_id).filter(Boolean),
            ...legacyLeadsData.map(l => l.category_id).filter(Boolean)
          ])
        ];

        let categoryMap: Record<number, string> = {};
        if (allCategoryIds.length > 0) {
          const { data: categories } = await supabase
            .from('misc_category')
            .select(`
              id,
              name,
              parent_id,
              misc_maincategory!parent_id(
                id,
                name,
                department_id,
                tenant_departement!fk_misc_maincategory_department_id(id, name)
              )
            `)
            .in('id', allCategoryIds);

          if (categories) {
            categoryMap = categories.reduce((acc, cat: any) => {
              // Format as "subcategory (main category)" or just "category" if no main category
              const mainCategory = Array.isArray(cat.misc_maincategory)
                ? cat.misc_maincategory[0]
                : cat.misc_maincategory;

              if (mainCategory?.name) {
                acc[cat.id] = `${cat.name} (${mainCategory.name})`;
              } else {
                acc[cat.id] = cat.name;
              }
              return acc;
            }, {} as Record<number, string>);
          }
        }

        // Combine and map contracts to leads with signed date
        const signedLeadsWithDate = userContracts.map(contract => {
          if (contract.newlead_id) {
            const lead = newLeadsData.find(l => l.id === contract.newlead_id);
            if (lead) {
              return {
                id: lead.id,
                lead_number: lead.lead_number,
                name: lead.name,
                category: categoryMap[lead.category_id] || lead.category || 'N/A',
                signed_date: contract.date,
                applicants: lead.number_of_applicants_meeting || 'N/A',
                value: lead.balance || lead.proposal_total || 0,
                currency: lead.balance_currency || lead.proposal_currency || '₪',
                lead_type: 'new'
              };
            }
          } else if (contract.lead_id) {
            const lead = legacyLeadsData.find(l => l.id === contract.lead_id);
            if (lead) {
              return {
                id: `legacy_${lead.id}`,
                lead_number: lead.id.toString(),
                name: lead.name,
                category: categoryMap[lead.category_id] || 'N/A',
                signed_date: contract.date,
                applicants: lead.no_of_applicants || 'N/A',
                value: lead.total || 0,
                currency: lead.currency_code || '₪',
                lead_type: 'legacy'
              };
            }
          }
          return null;
        }).filter(Boolean);

        // Sort by signed date (most recent first)
        signedLeadsWithDate.sort((a, b) => {
          if (!a || !b) return 0;
          const dateA = new Date(a.signed_date).getTime();
          const dateB = new Date(b.signed_date).getTime();
          return dateB - dateA;
        });

        setRealSignedLeads(signedLeadsWithDate);
      } catch (error) {
        setRealSignedLeads([]);
      } finally {
        setRealLeadsLoading(false);
      }
    })();
  }, [showLeadsList]);

  // 2. Add effect to fetch follow-up leads when expanded === 'overdue'
  useEffect(() => {
    if (expanded !== 'overdue') return;

    const fetchFollowUpLeads = async () => {
      if (followUpTab === 'today') {
        setTodayFollowUpsLoading(true);
        try {
          const { newLeads, legacyLeads } = await fetchFollowUpLeadsData('today', true);
          const combinedLeads = [...newLeads, ...legacyLeads];
          const processedLeads = await processOverdueLeadsForDisplay(combinedLeads, true);
          setTodayFollowUps(processedLeads);
          setOverdueFollowups(processedLeads.length);
        } catch (error) {
          setTodayFollowUps([]);
        } finally {
          setTodayFollowUpsLoading(false);
        }
      } else if (followUpTab === 'tomorrow') {
        setTomorrowFollowUpsLoading(true);
        try {
          const { newLeads, legacyLeads } = await fetchFollowUpLeadsData('tomorrow', true);
          const combinedLeads = [...newLeads, ...legacyLeads];
          const processedLeads = await processOverdueLeadsForDisplay(combinedLeads, true);
          setTomorrowFollowUps(processedLeads);
        } catch (error) {
          setTomorrowFollowUps([]);
        } finally {
          setTomorrowFollowUpsLoading(false);
        }
      } else if (followUpTab === 'future') {
        setFutureFollowUpsLoading(true);
        try {
          const { newLeads, legacyLeads } = await fetchFollowUpLeadsData('future', true);
          const combinedLeads = [...newLeads, ...legacyLeads];
          const processedLeads = await processOverdueLeadsForDisplay(combinedLeads, true);
          setFutureFollowUps(processedLeads);
        } catch (error) {
          setFutureFollowUps([]);
        } finally {
          setFutureFollowUpsLoading(false);
        }
      } else {
        // overdue
        setOverdueLeadsLoading(true);
        try {
          const { newLeads, legacyLeads } = await fetchOverdueLeadsData(false);
          const combinedLeads = [...newLeads, ...legacyLeads];
          const processedLeads = await processOverdueLeadsForDisplay(combinedLeads);
          setRealOverdueLeads(processedLeads);
        } catch (error) {
          setRealOverdueLeads([]);
        } finally {
          setOverdueLeadsLoading(false);
        }
      }
    };

    fetchFollowUpLeads();
  }, [expanded, followUpTab]);

  // Function to load all overdue leads
  const loadAllOverdueLeads = async () => {
    setLoadingMoreLeads(true);
    try {
      const { newLeads, legacyLeads, totalCount } = await fetchOverdueLeadsData(true);

      // Process all leads for display - pass true to indicate we want all leads
      const processedLeads = await processOverdueLeadsForDisplay([...newLeads, ...legacyLeads], true);

      setAllOverdueLeads(processedLeads);
      setShowAllOverdueLeads(true);
    } catch (error) {
    } finally {
      setLoadingMoreLeads(false);
    }
  };

  // Helper function to process overdue leads for display
  const processOverdueLeadsForDisplay = async (leadsData: any[], processAll = false) => {
    try {
      // Prefer explicit lead_type from follow_ups fetch — legacy rows always have string lead_number
      // and were wrongly classified as "new" then dropped by validNewLeads (lead_number === String(id)).
      const newLeads = leadsData.filter((lead) => {
        if (lead.lead_type === 'legacy') return false;
        if (lead.lead_type === 'new') return true;
        return (
          lead.lead_number &&
          typeof lead.lead_number === 'string' &&
          lead.lead_number.trim() !== '' &&
          !lead.id?.toString().startsWith('legacy_')
        );
      });

      const legacyLeads = leadsData.filter((lead) => {
        if (lead.lead_type === 'legacy') return true;
        if (lead.lead_type === 'new') return false;
        const hasRoleField =
          lead.expert_id ||
          lead.meeting_manager_id ||
          lead.meeting_lawyer_id ||
          lead.meeting_scheduler_id ||
          lead.case_handler_id ||
          lead.closer_id;
        const isLegacyId = typeof lead.id === 'number' || lead.id?.toString().startsWith('legacy_');
        return (!lead.lead_number && isLegacyId) || hasRoleField || isLegacyId;
      });
      // Fetch stage names for new leads
      let newLeadStageIds: number[] = [];
      if (newLeads.length > 0) {
        newLeadStageIds = [...new Set(newLeads.map(lead => lead.stage).filter((stage): stage is number =>
          stage !== null && stage !== undefined && typeof stage === 'number'
        ))];
      }

      let newLeadStageNameMap: { [key: number]: string } = {};
      if (newLeadStageIds.length > 0) {
        const { data: newLeadStages, error: newLeadStagesError } = await supabase
          .from('lead_stages')
          .select('id, name')
          .in('id', newLeadStageIds);

        if (!newLeadStagesError && newLeadStages) {
          newLeadStageNameMap = newLeadStages.reduce((acc: { [key: number]: string }, stage: any) => {
            acc[stage.id] = stage.name || getStageName(String(stage.id));
            return acc;
          }, {});
        }
      }

      // Fetch employee names for new leads (for expert_id, meeting_manager_id, and also check expert/manager fields if they're numeric IDs)
      let newLeadEmployeeIds: number[] = [];
      if (newLeads.length > 0) {
        const employeeIdSet = new Set<number>();

        // Collect from ID fields
        newLeads.forEach(lead => {
          if (lead.expert_id != null && lead.expert_id !== '') {
            const eid = typeof lead.expert_id === 'bigint' ? Number(lead.expert_id) : Number(lead.expert_id);
            if (Number.isFinite(eid) && eid > 0) employeeIdSet.add(eid);
          }
          if (lead.meeting_manager_id != null && lead.meeting_manager_id !== '') {
            const mid = typeof lead.meeting_manager_id === 'bigint' ? Number(lead.meeting_manager_id) : Number(lead.meeting_manager_id);
            if (Number.isFinite(mid) && mid > 0) employeeIdSet.add(mid);
          }

          // expert / manager may be stored as numeric id (number, bigint) or numeric string — never add non-numeric text
          if (lead.expert != null && lead.expert !== '') {
            if (typeof lead.expert === 'number' || typeof lead.expert === 'bigint') {
              const expertId = Number(lead.expert);
              if (Number.isFinite(expertId) && expertId > 0) employeeIdSet.add(expertId);
            } else if (typeof lead.expert === 'string' && !isNaN(Number(lead.expert))) {
              const expertId = Number(lead.expert);
              if (Number.isFinite(expertId) && expertId > 0) employeeIdSet.add(expertId);
            }
          }
          if (lead.manager != null && lead.manager !== '') {
            if (typeof lead.manager === 'number' || typeof lead.manager === 'bigint') {
              const managerId = Number(lead.manager);
              if (Number.isFinite(managerId) && managerId > 0) employeeIdSet.add(managerId);
            } else if (typeof lead.manager === 'string' && !isNaN(Number(lead.manager))) {
              const managerId = Number(lead.manager);
              if (Number.isFinite(managerId) && managerId > 0) employeeIdSet.add(managerId);
            }
          }
        });

        newLeadEmployeeIds = Array.from(employeeIdSet);
      }

      let newLeadEmployeeNameMap: { [key: number]: string } = {};
      if (newLeadEmployeeIds.length > 0) {
        const { data: newLeadEmployees, error: newLeadEmployeesError } = await supabase
          .from('tenants_employee')
          .select('id, display_name')
          .in('id', newLeadEmployeeIds);

        if (!newLeadEmployeesError && newLeadEmployees) {
          newLeadEmployeeNameMap = newLeadEmployees.reduce((acc: { [key: number]: string }, employee: any) => {
            acc[employee.id] = employee.display_name;
            return acc;
          }, {});
        }
      }

      // Fetch categories with main categories for new leads
      let newLeadCategoryIds: number[] = [];
      let newLeadCategoryNameMap: { [key: number]: string } = {};
      if (newLeads.length > 0) {
        newLeadCategoryIds = [...new Set(newLeads.map(lead => lead.category_id).filter((id): id is number => id !== null && id !== undefined && typeof id === 'number'))];

        if (newLeadCategoryIds.length > 0) {
          const { data: newLeadCategories, error: newLeadCategoriesError } = await supabase
            .from('misc_category')
            .select(`
              id,
              name,
              parent_id,
              misc_maincategory!parent_id(
                id,
                name
              )
            `)
            .in('id', newLeadCategoryIds);

          if (!newLeadCategoriesError && newLeadCategories) {
            newLeadCategoryNameMap = newLeadCategories.reduce((acc: { [key: number]: string }, category: any) => {
              // Format as "subcategory (main category)" or just "category" if no main category
              const mainCategory = Array.isArray(category.misc_maincategory)
                ? category.misc_maincategory[0]
                : category.misc_maincategory;

              if (mainCategory?.name) {
                acc[category.id] = `${category.name} (${mainCategory.name})`;
              } else {
                acc[category.id] = category.name;
              }
              return acc;
            }, {});
          }
        }
      }

      // Process new leads - filter out any that don't have lead_number (deleted leads)
      // Also filter out leads where lead_number equals the ID (which means it's deleted)
      const validNewLeads = newLeads.filter(lead => {
        if (!lead.lead_number || typeof lead.lead_number !== 'string' || lead.lead_number.trim() === '') {
          return false; // No lead_number = deleted
        }
        // Check if lead_number is actually the ID (UUID or numeric ID) - this also means deleted
        const leadIdStr = lead.id?.toString() || '';
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(lead.lead_number);
        const isRawId = lead.lead_number === leadIdStr || lead.lead_number === String(lead.id);
        if (isUUID || isRawId) {
          return false; // lead_number is the ID = deleted lead
        }
        return true; // Valid lead_number
      });
      const processedNewLeads = validNewLeads.map(lead => {
        // Resolve expert name - check if expert_id is set, or if expert field contains a numeric ID
        let expertName = 'Not assigned';
        if (lead.expert_id && typeof lead.expert_id === 'number') {
          expertName = newLeadEmployeeNameMap[lead.expert_id] || 'Not assigned';
        } else if (lead.expert) {
          // Check if expert is a numeric ID (string that can be converted to number)
          if (typeof lead.expert === 'string' && !isNaN(Number(lead.expert)) && Number(lead.expert) > 0) {
            const expertId = Number(lead.expert);
            expertName = newLeadEmployeeNameMap[expertId] || lead.expert;
          } else {
            // It's a text name, use it directly
            expertName = lead.expert;
          }
        }

        // Resolve manager name - check if meeting_manager_id is set, or if manager field contains a numeric ID
        let managerName = 'Not assigned';
        if (lead.meeting_manager_id && typeof lead.meeting_manager_id === 'number') {
          managerName = newLeadEmployeeNameMap[lead.meeting_manager_id] || 'Not assigned';
        } else if (lead.manager) {
          // Check if manager is a numeric ID (string that can be converted to number)
          if (typeof lead.manager === 'string' && !isNaN(Number(lead.manager)) && Number(lead.manager) > 0) {
            const managerId = Number(lead.manager);
            managerName = newLeadEmployeeNameMap[managerId] || lead.manager;
          } else {
            // It's a text name, use it directly
            managerName = lead.manager;
          }
        } else if (lead.meeting_manager && typeof lead.meeting_manager === 'string') {
          // Check if meeting_manager is a numeric ID
          if (!isNaN(Number(lead.meeting_manager)) && Number(lead.meeting_manager) > 0) {
            const managerId = Number(lead.meeting_manager);
            managerName = newLeadEmployeeNameMap[managerId] || lead.meeting_manager;
          } else {
            managerName = lead.meeting_manager;
          }
        }

        // Resolve category name - check if category_id is set, otherwise use category text field
        let categoryName = 'Not specified';
        if (lead.category_id && typeof lead.category_id === 'number') {
          categoryName = newLeadCategoryNameMap[lead.category_id] || lead.category || 'Not specified';
        } else if (lead.category && typeof lead.category === 'string') {
          categoryName = lead.category;
        }

        // Use lead_number directly from database - it's already fetched from the leads table
        // At this point we know lead_number exists and is valid (filtered above)
        return {
          ...lead,
          lead_type: 'new' as const,
          lead_number: lead.lead_number, // Use lead_number from database, guaranteed to exist
          stage_name: (lead.stage !== null && lead.stage !== undefined)
            ? (newLeadStageNameMap[lead.stage] || getStageName(String(lead.stage)))
            : 'Follow-up Required',
          expert_name: expertName,
          manager_name: managerName,
          category_name: categoryName,
          amount: lead.balance || 0,
          currency: lead.balance_currency || '₪',
          topic: lead.topic || 'Not specified',
          probability: lead.probability || 0
        };
      });

      // Process legacy leads with related data
      let stageNameMap: { [key: number]: string } = {};
      let employeeNameMap: { [key: number]: string } = {};
      let categoryNameMap: { [key: number]: string } = {};

      if (legacyLeads.length > 0) {
        const limitedLegacyLeads = (showAllOverdueLeads || processAll) ? legacyLeads : legacyLeads.slice(0, 10); // Use all leads when showing all or processing all

        // Collect unique IDs from limited leads (defensive: some legacy rows may contain non-numeric values).
        const stageIds = [
          ...new Set(
            limitedLegacyLeads
              .map((lead) => Number(lead.stage))
              .filter((n) => Number.isFinite(n) && n > 0)
          ),
        ];
        const employeeIds = [
          ...new Set(
            [
              ...limitedLegacyLeads.map((lead) => lead.expert_id),
              ...limitedLegacyLeads.map((lead) => lead.meeting_manager_id),
            ]
              .map((v) => Number(v))
              .filter((n) => Number.isFinite(n) && n > 0)
          ),
        ];
        const categoryIds = [
          ...new Set(
            limitedLegacyLeads
              .map((lead) => Number(lead.category_id))
              .filter((n) => Number.isFinite(n) && n > 0)
          ),
        ];
        // Fetch all related data in parallel for better performance
        const [stageResult, employeeResult, categoryResult] = await Promise.allSettled([
          stageIds.length > 0 ? supabase.from('lead_stages').select('id, name').in('id', stageIds) : Promise.resolve({ data: [] }),
          employeeIds.length > 0 ? supabase.from('tenants_employee').select('id, display_name').in('id', employeeIds) : Promise.resolve({ data: [] }),
          categoryIds.length > 0 ? supabase.from('misc_category').select(`
            id,
            name,
            parent_id,
            misc_maincategory!parent_id(
              id,
              name
            )
          `).in('id', categoryIds) : Promise.resolve({ data: [] })
        ]);

        // Build maps from results
        if (stageResult.status === 'fulfilled' && stageResult.value.data) {
          stageNameMap = stageResult.value.data.reduce((acc: { [key: number]: string }, stage: any) => {
            acc[stage.id] = stage.name || getStageName(String(stage.id));
            return acc;
          }, {});
        }

        if (employeeResult.status === 'fulfilled' && employeeResult.value.data) {
          employeeNameMap = employeeResult.value.data.reduce((acc: { [key: number]: string }, employee: any) => {
            acc[employee.id] = employee.display_name;
            return acc;
          }, {});
        }

        if (categoryResult.status === 'fulfilled' && categoryResult.value.data) {
          categoryNameMap = categoryResult.value.data.reduce((acc: { [key: number]: string }, category: any) => {
            // Format as "subcategory (main category)" or just "category" if no main category
            const mainCategory = Array.isArray(category.misc_maincategory)
              ? category.misc_maincategory[0]
              : category.misc_maincategory;

            if (mainCategory?.name) {
              acc[category.id] = `${category.name} (${mainCategory.name})`;
            } else {
              acc[category.id] = category.name;
            }
            return acc;
          }, {});
        }
      }

      // Process legacy leads (use all when showing all or processing all, otherwise limit to 10)
      const leadsToProcess = (showAllOverdueLeads || processAll) ? legacyLeads : legacyLeads.slice(0, 10);

      const processedLegacyLeads = leadsToProcess.map(lead => ({
        ...lead,
        id: `legacy_${lead.id}`,
        lead_number: lead.id?.toString() || '',
        lead_type: 'legacy' as const,
        stage_name: stageNameMap[lead.stage] || getStageName(String(lead.stage)) || 'Follow-up Required',
        expert_name: employeeNameMap[lead.expert_id] || 'Not assigned',
        manager_name: employeeNameMap[lead.meeting_manager_id] || 'Not assigned',
        category_name: categoryNameMap[lead.category_id] || 'Not specified',
        amount: lead.total || 0,
        currency: lead.currency_id || 1,
        topic: lead.topic || 'Not specified',
        probability: 0 // Legacy leads don't have probability field
      }));

      // Combine and filter out deleted leads (new leads without lead_number or with ID as lead_number)
      const allLeads = [...processedNewLeads, ...processedLegacyLeads]
        .filter(lead => {
          // For new leads, ensure they have a valid lead_number (deleted leads don't have one)
          if (lead.lead_type === 'new') {
            if (!lead.lead_number || typeof lead.lead_number !== 'string' || lead.lead_number.trim() === '') {
              return false; // No lead_number = deleted
            }
            // Check if lead_number is actually the ID (UUID or numeric ID) - this also means deleted
            const leadIdStr = lead.id?.toString() || '';
            const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(lead.lead_number);
            const isRawId = lead.lead_number === leadIdStr || lead.lead_number === String(lead.id);
            if (isUUID || isRawId) {
              return false; // lead_number is the ID = deleted lead
            }
            return true; // Valid lead_number
          }
          // Legacy leads are always included (they use ID as lead_number)
          return true;
        })
        .sort((a, b) => {
          if (!a.next_followup && !b.next_followup) return 0;
          if (!a.next_followup) return 1;
          if (!b.next_followup) return -1;
          return new Date(a.next_followup).getTime() - new Date(b.next_followup).getTime();
        });
      return allLeads;
    } catch (error) {
      return [];
    }
  };

  const messageBadgeCount = dashboardIsSuperuser ? latestMessagesAllLeads.length : latestMessages.length;
  const messageBadgeLabel = messageBadgeCount > 99 ? '99+' : String(messageBadgeCount);

  const renderDashboardInboxCard = (message: any, keyPrefix: string) => (
    <div
      key={`${keyPrefix}-${message.type}-${String(message.id)}`}
      className="bg-gradient-to-r from-white to-gray-50 rounded-xl p-5 shadow-lg border border-gray-100 hover:shadow-xl hover:scale-[1.02] transition-all duration-300 cursor-pointer group"
      onClick={() => {
        if (message.type === 'whatsapp' && message.client_id) {
          const tab = keyPrefix === 'all' ? 'all' : 'my';
          navigate(`/whatsapp?tab=${tab}&leadId=${encodeURIComponent(String(message.client_id))}`);
          return;
        }
        if (message.client_id && message.lead_number != null && message.lead_number !== '') {
          navigate(
            `/clients/${encodeURIComponent(String(message.lead_number))}?tab=interactions`
          );
        }
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <span
            className={`text-xs px-3 py-1.5 rounded-full font-medium shadow-sm animate-pulse ${
              message.type === 'email'
                ? isAltTheme
                  ? 'bg-gradient-to-r from-green-500 via-emerald-500 to-lime-600 text-white'
                  : 'bg-gradient-to-r from-pink-500 via-purple-500 to-purple-600 text-white'
                : isAltTheme
                  ? 'bg-gradient-to-r from-green-500 via-emerald-500 to-lime-400 text-white'
                  : 'bg-gradient-to-r from-blue-500 via-cyan-500 to-teal-400 text-white'
            }`}
          >
            {message.type === 'email' ? 'Email' : 'WhatsApp'}
          </span>
          <span className="font-bold text-gray-900 text-lg">{message.client_name}</span>
          {message.lead_number && (
            <span className="text-sm text-gray-600 font-medium">#{message.lead_number}</span>
          )}
        </div>
        <span className="text-sm text-gray-500 bg-gray-100 px-3 py-1 rounded-full">
          {new Date(message.created_at).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      </div>
      <p className="text-gray-700 text-sm line-clamp-2 mb-4 leading-relaxed">{message.content}</p>
      <div className="flex items-center justify-between pt-3 border-t border-gray-100">
        <span className="text-xs text-gray-600 font-medium">From: {message.sender}</span>
        <span
          className={`text-xs font-medium transition-colors ${
            isAltTheme ? 'text-green-600 group-hover:text-green-700' : 'text-primary group-hover:text-primary/80'
          }`}
        >
          View conversation →
        </span>
      </div>
    </div>
  );

  const postLoginWelcomeActive = hasDashboardWelcomePending();

  return (
    <>
    <div
      className={`min-h-screen bg-gray-100 p-0 md:p-6 space-y-8 dark:bg-base-300 ${
        postLoginWelcomeActive ? '' : 'animate-fade-in'
      }`}
    >
      {/* 1. Summary Boxes: 4 columns */}
      <div className="flex md:grid md:grid-cols-4 gap-3 md:gap-6 mb-8 w-full mt-6 md:mt-0 overflow-x-auto scrollbar-hide pb-2 md:pb-0 overflow-y-visible">
        {/* Meetings Today */}
        <div
          className={`flex-shrink-0 rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.02] relative overflow-visible p-4 md:p-6 w-[calc(50vw-0.75rem)] md:w-auto h-32 md:h-auto ml-4 md:ml-0 ${
            isDark2Theme
              ? 'border border-base-300 bg-base-200 text-base-content shadow-none'
              : `bg-gradient-to-tr ${isAltTheme ? 'from-green-500 via-emerald-600 to-lime-600' : 'from-pink-500 via-purple-500 to-purple-600'} text-white`
          }`}
          onClick={() => setExpanded(expanded === 'meetings' ? null : 'meetings')}
        >
          {/* Meetings in Next Hour Badge - Desktop: top, Mobile: bottom */}
          {meetingsInNextHour > 0 && nextHourMeetings.length > 0 && (
            <>
              {/* Desktop: Top Right */}
              <div className="hidden md:flex absolute top-1 right-2 z-10 group items-center gap-2 flex-wrap justify-end max-w-[calc(100%-1rem)]">
                {/* Text Badge - Active - Only show first meeting */}
                <span
                  className={`inline-flex items-center px-2.5 py-1 text-xs font-semibold whitespace-nowrap break-words ${isDark2Theme ? 'text-base-content' : 'text-white'}`}
                >
                  Meeting {formatTimeUntil(nextHourMeetings[0].meetingDateTime)} with {nextHourMeetings[0].name} ({nextHourMeetings[0].lead})
                </span>
                {/* Count Badge */}
                <span
                  className={`inline-flex items-center justify-center min-w-[28px] h-7 px-2.5 text-red-500 text-xs font-bold rounded-full shadow-lg animate-pulse cursor-help flex-shrink-0 ${
                    isDark2Theme ? 'bg-base-200 ring-2 ring-base-300' : 'bg-white ring-2 ring-white ring-opacity-75'
                  }`}
                  title={nextHourMeetings.map((meeting: any) =>
                    `Meeting ${formatTimeUntil(meeting.meetingDateTime)} with ${meeting.name} (${meeting.lead})`
                  ).join('\n')}
                >
                  {meetingsInNextHour}
                </span>
                {/* Custom Tooltip */}
                <div className="absolute right-0 top-full mt-2 w-[280px] max-w-[calc(100vw-2rem)] p-2.5 sm:p-3 bg-gray-900 text-white text-xs sm:text-sm rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 pointer-events-none whitespace-normal">
                  <div className="space-y-2">
                    {nextHourMeetings.map((meeting: any, index: number) => (
                      <div key={meeting.id || index} className="border-b border-gray-700 last:border-0 pb-2 last:pb-0">
                        <div className="font-semibold text-white text-[11px] sm:text-sm break-words leading-snug">
                          Meeting {formatTimeUntil(meeting.meetingDateTime)}
                        </div>
                        <div className="text-gray-300 text-[10px] sm:text-xs mt-0.5 sm:mt-1 break-words leading-relaxed">
                          with {meeting.name} ({meeting.lead})
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* Tooltip arrow */}
                  <div className="absolute -top-2 right-4 w-0 h-0 border-l-4 border-r-4 border-b-4 border-transparent border-b-gray-900"></div>
                </div>
              </div>

              {/* Mobile: Count Badge - Top Right */}
              <div className="md:hidden absolute top-2 right-2 z-10 group">
                <span
                  className={`inline-flex items-center justify-center min-w-[24px] h-6 px-2 text-red-500 text-[10px] font-bold rounded-full shadow-lg animate-pulse cursor-help flex-shrink-0 ${
                    isDark2Theme ? 'bg-base-200 ring-2 ring-base-300' : 'bg-white ring-2 ring-white ring-opacity-75'
                  }`}
                  title={nextHourMeetings.map((meeting: any) =>
                    `Meeting ${formatTimeUntil(meeting.meetingDateTime)} with ${meeting.name} (${meeting.lead})`
                  ).join('\n')}
                >
                  {meetingsInNextHour}
                </span>
                {/* Custom Tooltip */}
                <div className="absolute right-0 top-full mt-2 w-[280px] max-w-[calc(100vw-2rem)] p-2.5 bg-gray-900 text-white text-xs rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 pointer-events-none whitespace-normal">
                  <div className="space-y-2">
                    {nextHourMeetings.map((meeting: any, index: number) => (
                      <div key={meeting.id || index} className="border-b border-gray-700 last:border-0 pb-2 last:pb-0">
                        <div className="font-semibold text-white text-[11px] break-words leading-snug">
                          Meeting {formatTimeUntil(meeting.meetingDateTime)}
                        </div>
                        <div className="text-gray-300 text-[10px] mt-0.5 break-words leading-relaxed">
                          with {meeting.name} ({meeting.lead})
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* Tooltip arrow */}
                  <div className="absolute -top-2 right-4 w-0 h-0 border-l-4 border-r-4 border-b-4 border-transparent border-b-gray-900"></div>
                </div>
              </div>

              {/* Mobile: Text Notice - Bottom */}
              <div className="md:hidden absolute bottom-1 left-0 right-0 z-10 flex items-center justify-center px-2">
                <span
                  className={`inline-flex items-center px-2 py-0.5 text-[9px] font-semibold whitespace-normal break-words text-center leading-tight ${
                    isDark2Theme ? 'text-base-content' : 'text-white'
                  }`}
                >
                  Meeting {formatTimeUntil(nextHourMeetings[0].meetingDateTime)} with {nextHourMeetings[0].name} ({nextHourMeetings[0].lead})
                </span>
              </div>
            </>
          )}
          <div className="flex items-center gap-2 md:gap-4">
            <div
              className={`flex items-center justify-center w-12 h-12 md:w-14 md:h-14 rounded-full ${
                isDark2Theme ? 'border border-base-300 bg-base-200/40' : 'bg-white/20'
              }`}
            >
              <CalendarIcon
                className={`w-7 h-7 md:w-7 md:h-7 opacity-90 ${isDark2Theme ? 'text-base-content' : 'text-white'}`}
              />
            </div>
            <div>
              <div
                className={`text-3xl md:text-4xl font-extrabold leading-tight ${isDark2Theme ? 'text-base-content' : 'text-white'}`}
              >
                {meetingsToday}
              </div>
              <div
                className={`text-sm md:text-sm font-medium mt-1 ${isDark2Theme ? 'text-base-content/70' : 'text-white/80'}`}
              >
                Meetings Today
              </div>
            </div>
          </div>
          {/* SVG Graph Placeholder */}
          <svg
            className={`absolute bottom-2 right-2 w-10 h-5 md:w-16 md:h-8 ${isDark2Theme ? 'text-base-content/35' : 'text-white/40'}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 64 32"
          >
            <path d="M2 28 Q16 8 32 20 T62 8" />
          </svg>
        </div>

        {/* Follow ups */}
        <div
          className={`flex-shrink-0 rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.02] relative overflow-hidden p-4 md:p-6 w-[calc(50vw-0.75rem)] md:w-auto h-32 md:h-auto ${
            isDark2Theme
              ? 'border border-base-300 bg-base-200 text-base-content shadow-none'
              : `bg-gradient-to-tr ${isAltTheme ? 'from-emerald-600 via-green-600 to-green-500' : 'from-purple-600 via-blue-600 to-blue-500'} text-white`
          }`}
          onClick={() => setExpanded(expanded === 'overdue' ? null : 'overdue')}
        >
          <div className="flex items-center gap-2 md:gap-4">
            <div
              className={`flex items-center justify-center w-12 h-12 md:w-14 md:h-14 rounded-full ${
                isDark2Theme ? 'border border-base-300 bg-base-200/40' : 'bg-white/20'
              }`}
            >
              <ExclamationTriangleIcon
                className={`w-7 h-7 md:w-7 md:h-7 opacity-90 ${isDark2Theme ? 'text-base-content' : 'text-white'}`}
              />
            </div>
            <div>
              <div
                className={`text-3xl md:text-4xl font-extrabold leading-tight ${isDark2Theme ? 'text-base-content' : 'text-white'}`}
              >
                {overdueFollowups}
              </div>
              <div
                className={`text-sm md:text-sm font-medium mt-1 ${isDark2Theme ? 'text-base-content/70' : 'text-white/80'}`}
              >
                Today's Follow ups
              </div>
            </div>
          </div>
          {/* SVG Bar Chart Placeholder */}
          <svg
            className={`absolute bottom-2 right-2 w-10 h-5 md:w-12 md:h-8 ${isDark2Theme ? 'text-base-content/35' : 'text-white/40'}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 48 32"
          >
            <rect x="2" y="20" width="4" height="10" />
            <rect x="10" y="10" width="4" height="20" />
            <rect x="18" y="16" width="4" height="14" />
            <rect x="26" y="6" width="4" height="24" />
            <rect x="34" y="14" width="4" height="16" />
          </svg>
        </div>

        {/* New Messages */}
        <div
          className={`flex-shrink-0 rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.02] relative overflow-hidden p-4 md:p-6 w-[calc(50vw-0.75rem)] md:w-auto h-32 md:h-auto ${
            isDark2Theme
              ? 'border border-base-300 bg-base-200 text-base-content shadow-none'
              : `bg-gradient-to-tr ${isAltTheme ? 'from-green-500 via-emerald-500 to-lime-400' : 'from-blue-500 via-cyan-500 to-teal-400'} text-white`
          }`}
          onClick={() => setExpanded(expanded === 'messages' ? null : 'messages')}
        >
          <div className="flex items-center gap-2 md:gap-4">
            <div
              className={`flex items-center justify-center w-12 h-12 md:w-14 md:h-14 rounded-full ${
                isDark2Theme ? 'border border-base-300 bg-base-200/40' : 'bg-white/20'
              }`}
            >
              <ChatBubbleLeftRightIcon
                className={`w-7 h-7 md:w-7 md:h-7 mr-1 ${isDark2Theme ? 'text-base-content' : 'text-white'}`}
              />
            </div>
            <div>
              <div
                className={`text-3xl md:text-4xl font-extrabold leading-tight ${isDark2Theme ? 'text-base-content' : 'text-white'}`}
              >
                {latestMessages.length}
              </div>
              <div
                className={`text-sm md:text-sm font-medium mt-1 ${isDark2Theme ? 'text-base-content/70' : 'text-white/80'}`}
              >
                New Messages
              </div>
            </div>
          </div>
          {/* SVG Circle Placeholder */}
          <svg
            className={`absolute bottom-2 right-2 w-10 h-10 md:w-10 md:h-10 ${isDark2Theme ? 'text-base-content/35' : 'text-white/40'}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 32 32"
          >
            <circle cx="16" cy="16" r="12" />
            <text x="16" y="21" textAnchor="middle" fontSize="10" fill="currentColor" opacity="0.7">
              {messageBadgeLabel}
            </text>
          </svg>
        </div>

        {/* Clock In / Out */}
        {currentUserEmployeeId != null && (
          <ClockInBox
            employeeId={currentUserEmployeeId}
            isDark2Theme={isDark2Theme}
            isAltTheme={isAltTheme}
          />
        )}
      </div>

      {/* Expanded Content for Top Boxes */}
      {expanded === 'meetings' && (
        <div className="glass-card mt-4 animate-fade-in">
          {/* Desktop Table View */}
          <div className="hidden md:block">
            <Meetings />
          </div>
          {/* Mobile Card View (REAL DATA) */}
          <div className="md:hidden">
            <div className="space-y-4">
              <h3 className="text-xl font-bold text-gray-900 mb-4">Today's Meetings</h3>
              {meetingsLoading ? (
                <div className="text-center py-8 text-base-content/70">Loading...</div>
              ) : todayMeetings.length === 0 ? (
                <div className="text-center py-8 text-base-content/70">No meetings scheduled for today</div>
              ) : (
                <div className="flex gap-4 overflow-x-auto py-4 px-1 scrollbar-hide">
                  {todayMeetings.map((meeting, index) => (
                    <div key={meeting.id} className="min-w-[85vw] max-w-[90vw] bg-white rounded-2xl p-5 shadow-md hover:shadow-xl transition-all duration-200 transform hover:-translate-y-1 border border-gray-100 group flex flex-col justify-between h-full min-h-[340px] relative pb-16" style={{ flex: '0 0 85vw' }}>
                      <div className="flex-1 cursor-pointer flex flex-col">
                        {/* Lead Number and Name */}
                        <div className="mb-3 flex items-center gap-2">
                          <span className="text-xs font-semibold text-gray-400 tracking-widest">{meeting.lead}</span>
                          <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                          <h3 className={`text-lg font-extrabold text-gray-900 transition-colors truncate flex-1 ${isAltTheme ? 'group-hover:text-green-600' : 'group-hover:text-primary'}`}>{meeting.name}</h3>
                        </div>
                        <div className="space-y-2 divide-y divide-gray-100">
                          {/* User Role (Guest 1 or Guest 2) */}
                          {meeting.userRole && (
                            <div className="flex justify-between items-center py-1">
                              <span className="text-xs font-semibold text-gray-500">Your Role</span>
                              <span className={`text-sm font-bold ${isAltTheme ? 'text-green-600' : 'text-primary'}`}>{meeting.userRole}</span>
                            </div>
                          )}
                          {/* Time */}
                          <div className="flex justify-between items-center py-1">
                            <span className="text-xs font-semibold text-gray-500">Time</span>
                            <span className="text-sm font-bold text-gray-800">
                              {meeting.time && meeting.time.includes(':') && meeting.time.split(':').length === 3
                                ? meeting.time.substring(0, 5)
                                : meeting.time}
                            </span>
                          </div>
                          {/* Manager */}
                          <div className="flex justify-between items-center py-1">
                            <span className="text-xs font-semibold text-gray-500">Manager</span>
                            <span className="text-sm font-bold text-gray-800">{meeting.manager}</span>
                          </div>
                          {/* Topic */}
                          <div className="flex justify-between items-center py-1">
                            <span className="text-xs font-semibold text-gray-500">Topic</span>
                            <span className="text-sm font-bold text-gray-800">{meeting.topic}</span>
                          </div>
                          {/* Amount */}
                          <div className="flex justify-between items-center py-1">
                            <span className="text-xs font-semibold text-gray-500">Amount</span>
                            <span className="text-sm font-bold text-green-600">{meeting.value}</span>
                          </div>
                          {/* Expert */}
                          <div className="flex justify-between items-center py-1">
                            <span className="text-xs font-semibold text-gray-500">Expert</span>
                            <span className="text-sm font-bold text-gray-800">{meeting.expert}</span>
                          </div>
                          {/* Scheduler */}
                          <div className="flex justify-between items-center py-1">
                            <span className="text-xs font-semibold text-gray-500">Scheduler</span>
                            <span className="text-sm font-bold text-gray-800">{meeting.scheduler || '---'}</span>
                          </div>
                          {/* Stage */}
                          <div className="flex justify-between items-center py-1">
                            <span className="text-xs font-semibold text-gray-500">Stage</span>
                            <span className="text-sm font-bold text-gray-800">{meeting.stage || 'N/A'}</span>
                          </div>
                          {/* Location */}
                          <div className="flex justify-between items-center py-1">
                            <span className="text-xs font-semibold text-gray-500">Location</span>
                            <span className="text-sm font-bold text-gray-800">{meeting.location}</span>
                          </div>
                        </div>
                      </div>
                      {/* Action Buttons */}
                      {(() => {
                        // meeting.link already prefers explicit Teams URL and falls back to location default_link
                        const hasLink = !!getValidTeamsLink(meeting.link);
                        const isTeamsMeeting = !!meeting.teams_meeting_url || !!(meeting.link && getValidTeamsLink(meeting.link));
                        const hasDefaultForLocation = !!meetingLocationLinks[meeting.location];
                        const isOnline = isOnlineLocation(meeting.location || '');
                        const isStaffMeeting = meeting.isStaffMeeting === true;
                        // Show join button for:
                        // - meetings with valid Teams/online links
                        // - locations that have a default_link configured
                        // - staff meetings with links
                        return hasLink && (isTeamsMeeting || isOnline || hasDefaultForLocation || isStaffMeeting);
                      })() && (
                          <div className="absolute bottom-4 left-4 right-4">
                            {/* Join Meeting (Teams) */}
                            <button
                              className="btn btn-primary btn-xs sm:btn-sm w-full"
                              onClick={() => {
                                const url = getValidTeamsLink(
                                  meeting.link ||
                                  meeting.teams_meeting_url ||
                                  meetingLocationLinks[meeting.location]
                                );
                                if (url) {
                                  window.open(url, '_blank');
                                } else {
                                  alert('No meeting URL available');
                                }
                              }}
                              title={meeting.isStaffMeeting ? "Join Meeting" : "Teams Meeting"}
                            >
                              <VideoCameraIcon className="w-3 h-3 sm:w-4 sm:h-4" />
                            </button>
                          </div>
                        )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {expanded === 'overdue' && (
        <div className="glass-card mt-4 animate-fade-in">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-4 gap-4">
            <div className="font-bold text-lg text-base-content/80">Follow ups</div>

            {/* Tabs */}
            <div className="flex gap-2 items-center">
              <button
                onClick={() => setFollowUpTab('today')}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${followUpTab === 'today'
                  ? 'text-white shadow-md'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                style={followUpTab === 'today' ? { backgroundColor: '#3E2BCD' } : {}}
              >
                Today
              </button>
              <button
                onClick={() => setFollowUpTab('overdue')}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${followUpTab === 'overdue'
                  ? 'text-white shadow-md'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                style={followUpTab === 'overdue' ? { backgroundColor: '#3E2BCD' } : {}}
              >
                Overdue
              </button>
              <button
                onClick={() => setFollowUpTab('tomorrow')}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${followUpTab === 'tomorrow'
                  ? 'text-white shadow-md'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                style={followUpTab === 'tomorrow' ? { backgroundColor: '#3E2BCD' } : {}}
              >
                Tomorrow
              </button>
              <button
                onClick={() => setFollowUpTab('future')}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${followUpTab === 'future'
                  ? 'text-white shadow-md'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                style={followUpTab === 'future' ? { backgroundColor: '#3E2BCD' } : {}}
              >
                Future
              </button>
              {/* View Mode Toggle - Desktop only */}
              <div className="hidden md:flex">
                <button
                  onClick={() => setFollowUpViewMode(followUpViewMode === 'table' ? 'card' : 'table')}
                  className={`px-3 py-2 rounded-xl text-sm font-medium transition-all text-white shadow-md`}
                  style={{ backgroundColor: '#3E2BCD' }}
                  title={followUpViewMode === 'table' ? 'Switch to Card View' : 'Switch to Table View'}
                >
                  {followUpViewMode === 'table' ? (
                    <Squares2X2Icon className="w-5 h-5" />
                  ) : (
                    <TableCellsIcon className="w-5 h-5" />
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Get current leads based on tab */}
          {(() => {
            const isLoading = followUpTab === 'today' ? todayFollowUpsLoading :
              followUpTab === 'tomorrow' ? tomorrowFollowUpsLoading :
                followUpTab === 'future' ? futureFollowUpsLoading :
                  overdueLeadsLoading;
            const currentLeads = followUpTab === 'today' ? todayFollowUps :
              followUpTab === 'tomorrow' ? tomorrowFollowUps :
                followUpTab === 'future' ? futureFollowUps :
                  realOverdueLeads;

            if (isLoading) {
              return (
                <div className="flex justify-center items-center py-12">
                  <span className={`loading loading-spinner loading-lg ${isAltTheme ? 'text-green-600' : 'text-primary'}`}></span>
                </div>
              );
            }

            if (currentLeads.length === 0) {
              return (
                <div className="text-center py-12 text-gray-500">
                  No {followUpTab} follow-ups. Great job!
                </div>
              );
            }

            // Table View (Desktop only, Mobile always shows cards)
            // Use CSS media query approach - hide table on mobile, show cards
            if (followUpViewMode === 'table') {
              return (
                <>
                  {/* Desktop Table View */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="table w-full">
                      <thead>
                        <tr>
                          <th>Lead</th>
                          <th>Stage</th>
                          <th>Category</th>
                          <th>Topic</th>
                          <th>Expert</th>
                          <th>Manager</th>
                          <th>Amount</th>
                          <th>Follow-up Date</th>
                          {followUpTab === 'overdue' && <th>Days Overdue</th>}
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {currentLeads.map((lead) => {
                          const daysOverdue = lead.next_followup ? Math.floor((new Date().getTime() - new Date(lead.next_followup).getTime()) / (1000 * 3600 * 24)) : 0;
                          return (
                            <tr
                              key={lead.id}
                              className="cursor-pointer hover:bg-gray-50"
                              onClick={(e) => {
                                const isCtrlOrCmd = e.ctrlKey || e.metaKey;
                                const url = buildClientRoute(lead);
                                if (isCtrlOrCmd) {
                                  window.open(url, '_blank');
                                } else {
                                  navigate(url);
                                }
                              }}
                            >
                              <td>
                                <div className="flex flex-col">
                                  <span className="text-sm text-gray-500">
                                    {formatLeadNumberForDisplay(lead.lead_number)}
                                  </span>
                                  <span className="font-semibold text-gray-900">{lead.name}</span>
                                </div>
                              </td>
                              <td>{lead.stage_name || 'N/A'}</td>
                              <td>{lead.lead_type === 'legacy' ? lead.category_name : (lead.category_name || lead.category || 'N/A')}</td>
                              <td>{lead.topic || 'N/A'}</td>
                              <td>{lead.expert_name || 'N/A'}</td>
                              <td>{lead.manager_name || 'N/A'}</td>
                              <td>
                                {lead.lead_type === 'legacy'
                                  ? `₪${Math.ceil(lead.amount || 0).toLocaleString()}`
                                  : `${lead.balance_currency || '₪'}${Math.ceil(lead.balance || 0).toLocaleString()}`
                                }
                              </td>
                              <td>
                                {editingFollowUpId === lead.follow_up_id ? (
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="date"
                                      value={editFollowUpDate}
                                      onChange={(e) => setEditFollowUpDate(e.target.value)}
                                      className="input input-sm input-bordered"
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                    <button
                                      className="btn btn-xs btn-primary"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleSaveFollowUp(lead);
                                      }}
                                    >
                                      Save
                                    </button>
                                    <button
                                      className="btn btn-xs btn-ghost"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleCancelEditFollowUp();
                                      }}
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                ) : (
                                  <span>{lead.next_followup ? new Date(lead.next_followup).toLocaleDateString() : 'N/A'}</span>
                                )}
                              </td>
                              {followUpTab === 'overdue' && (
                                <td>{daysOverdue}</td>
                              )}
                              <td onClick={(e) => e.stopPropagation()}>
                                {editingFollowUpId !== lead.follow_up_id && (
                                  <div className="flex gap-1">
                                    <button
                                      className="btn btn-xs btn-ghost"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleEditFollowUp(lead);
                                      }}
                                      title="Edit follow-up date"
                                    >
                                      <PencilSquareIcon className="w-4 h-4" style={{ color: isAltTheme ? '#505d57' : '#3E28CD' }} />
                                    </button>
                                    <button
                                      className="btn btn-xs btn-ghost text-error"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteFollowUp(lead);
                                      }}
                                      title="Delete follow-up"
                                    >
                                      <TrashIcon className="w-4 h-4" style={{ color: isAltTheme ? '#505d57' : '#3E28CD' }} />
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {/* Mobile Card View (shown when table mode but on mobile) */}
                  <div className="md:hidden space-y-4">
                    {currentLeads.map((lead) => {
                      const daysOverdue = lead.next_followup ? Math.floor((new Date().getTime() - new Date(lead.next_followup).getTime()) / (1000 * 3600 * 24)) : 0;
                      return (
                        <div
                          key={lead.id}
                          className="bg-white rounded-2xl p-5 shadow-md hover:shadow-xl transition-all duration-200 border border-red-100 group flex flex-col justify-between min-h-[340px] relative cursor-pointer"
                          onClick={(e) => {
                            const isCtrlOrCmd = e.ctrlKey || e.metaKey;
                            const url = buildClientRoute(lead);
                            if (isCtrlOrCmd) {
                              window.open(url, '_blank');
                            } else {
                              navigate(url);
                            }
                          }}
                        >
                          <div className="flex-1 flex flex-col">
                            <div className="mb-3 flex flex-col gap-1">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold text-gray-400 tracking-widest">
                                  {formatLeadNumberForDisplay(lead.lead_number)}
                                </span>
                                {followUpTab === 'today' && (
                                  <span className="text-sm font-bold px-2 py-1 rounded bg-green-600 text-white">Today</span>
                                )}
                                {followUpTab === 'tomorrow' && (
                                  <span className={`text-sm font-bold px-2 py-1 rounded text-white ${isAltTheme ? 'bg-green-600' : 'bg-blue-600'}`}>Tomorrow</span>
                                )}
                                {followUpTab === 'future' && (
                                  <span className={`text-sm font-bold px-2 py-1 rounded text-white ${isAltTheme ? 'bg-green-600' : 'bg-purple-600'}`}>Future</span>
                                )}
                              </div>
                              <h3 className={`text-xl font-extrabold text-gray-900 transition-colors truncate ${isAltTheme ? 'group-hover:text-green-600' : 'group-hover:text-primary'}`}>{lead.name}</h3>
                            </div>
                            <div className="flex justify-between items-center py-1">
                              <span className="text-sm font-semibold text-gray-500">Stage</span>
                              <span className="text-sm font-bold text-black">
                                {lead.stage_name || 'Follow-up Required'}
                              </span>
                            </div>
                            <div className="space-y-2 divide-y divide-gray-100 mt-2">
                              <div className="flex justify-between items-center py-1">
                                <span className="text-sm font-semibold text-gray-500">Category</span>
                                <span className="text-sm font-bold text-gray-800">
                                  {lead.lead_type === 'legacy' ? lead.category_name : (lead.category_name || lead.category || 'Not specified')}
                                </span>
                              </div>
                              <div className="flex justify-between items-center py-1">
                                <span className="text-sm font-semibold text-gray-500">Topic</span>
                                <span className="text-sm font-bold text-gray-800">{lead.topic || 'Not specified'}</span>
                              </div>
                              <div className="flex justify-between items-center py-1">
                                <span className="text-sm font-semibold text-gray-500">Expert</span>
                                <span className="text-sm font-bold text-gray-800">
                                  {lead.expert_name || 'Not assigned'}
                                </span>
                              </div>
                              <div className="flex justify-between items-center py-1">
                                <span className="text-sm font-semibold text-gray-500">Amount</span>
                                <span className="text-sm font-bold text-gray-800">
                                  {lead.lead_type === 'legacy'
                                    ? `₪${Math.ceil(lead.amount || 0).toLocaleString()}`
                                    : `${lead.balance_currency || '₪'}${Math.ceil(lead.balance || 0).toLocaleString()}`
                                  }
                                </span>
                              </div>
                              <div className="flex justify-between items-center py-1">
                                <span className="text-sm font-semibold text-gray-500">Manager</span>
                                <span className="text-sm font-bold text-gray-800">
                                  {lead.manager_name || 'Not assigned'}
                                </span>
                              </div>
                              <div className="flex justify-between items-center py-1">
                                <span className="text-sm font-semibold text-gray-500">Probability</span>
                                <span className="text-sm font-bold text-gray-800">{lead.probability || 0}%</span>
                              </div>
                              {/* Follow-up Date */}
                              <div className="flex justify-between items-center py-1">
                                <span className="text-sm font-semibold text-gray-500">Follow-up Date</span>
                                {editingFollowUpId === lead.follow_up_id ? (
                                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                    <input
                                      type="date"
                                      value={editFollowUpDate}
                                      onChange={(e) => setEditFollowUpDate(e.target.value)}
                                      className="input input-xs input-bordered"
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                    <button
                                      className="btn btn-xs btn-primary"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleSaveFollowUp(lead);
                                      }}
                                    >
                                      Save
                                    </button>
                                    <button
                                      className="btn btn-xs btn-ghost"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleCancelEditFollowUp();
                                      }}
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                    <span className="text-sm font-bold text-gray-800">
                                      {lead.next_followup ? new Date(lead.next_followup).toLocaleDateString() : 'N/A'}
                                    </span>
                                    <button
                                      className="btn btn-xs btn-ghost"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleEditFollowUp(lead);
                                      }}
                                      title="Edit follow-up date"
                                    >
                                      <PencilSquareIcon className="w-4 h-4" style={{ color: isAltTheme ? '#505d57' : '#3E28CD' }} />
                                    </button>
                                    <button
                                      className="btn btn-xs btn-ghost text-error"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteFollowUp(lead);
                                      }}
                                      title="Delete follow-up"
                                    >
                                      <TrashIcon className="w-4 h-4" style={{ color: isAltTheme ? '#505d57' : '#3E28CD' }} />
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              );
            }

            // Card View (Mobile default, Desktop optional)
            return (
              <>
                {/* Desktop Card Grid View */}
                <div className="hidden md:grid grid-cols-2 lg:grid-cols-3 gap-6">
                  {currentLeads.map((lead) => {
                    const daysOverdue = lead.next_followup ? Math.floor((new Date().getTime() - new Date(lead.next_followup).getTime()) / (1000 * 3600 * 24)) : 0;
                    return (
                      <div
                        key={lead.id}
                        className="bg-white rounded-2xl p-5 shadow-md hover:shadow-xl transition-all duration-200 border border-red-100 group flex flex-col justify-between min-h-[340px] relative cursor-pointer"
                        onClick={() => navigate(buildClientRoute(lead))}
                      >
                        <div className="flex-1 flex flex-col">
                          {/* Lead Number and Name */}
                          <div className="mb-3 flex items-center gap-2">
                            <span className="text-sm font-semibold text-gray-400 tracking-widest">
                              {formatLeadNumberForDisplay(lead.lead_number)}
                            </span>
                            <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                            <h3 className={`text-xl font-extrabold text-gray-900 transition-colors truncate flex-1 ${isAltTheme ? 'group-hover:text-green-600' : 'group-hover:text-primary'}`}>{lead.name}</h3>
                            {followUpTab === 'today' && (
                              <span className="text-sm font-bold px-2 py-1 rounded bg-green-600 text-white">Today</span>
                            )}
                            {followUpTab === 'tomorrow' && (
                              <span className="text-sm font-bold px-2 py-1 rounded bg-blue-600 text-white">Tomorrow</span>
                            )}
                          </div>
                          {/* Stage */}
                          <div className="flex justify-between items-center py-1">
                            <span className="text-sm font-semibold text-gray-500">Stage</span>
                            <span className="text-sm font-bold text-black">
                              {lead.stage_name || 'Follow-up Required'}
                            </span>
                          </div>
                          <div className="space-y-2 divide-y divide-gray-100 mt-2">
                            {/* Category */}
                            <div className="flex justify-between items-center py-1">
                              <span className="text-sm font-semibold text-gray-500">Category</span>
                              <span className="text-sm font-bold text-gray-800">
                                {lead.lead_type === 'legacy' ? lead.category_name : (lead.category_name || lead.category || 'Not specified')}
                              </span>
                            </div>
                            {/* Topic */}
                            <div className="flex justify-between items-center py-1">
                              <span className="text-sm font-semibold text-gray-500">Topic</span>
                              <span className="text-sm font-bold text-gray-800">{lead.topic || 'Not specified'}</span>
                            </div>
                            {/* Expert */}
                            <div className="flex justify-between items-center py-1">
                              <span className="text-sm font-semibold text-gray-500">Expert</span>
                              <span className="text-sm font-bold text-gray-800">
                                {lead.expert_name || 'Not assigned'}
                              </span>
                            </div>
                            {/* Amount */}
                            <div className="flex justify-between items-center py-1">
                              <span className="text-sm font-semibold text-gray-500">Amount</span>
                              <span className="text-sm font-bold text-gray-800">
                                {lead.lead_type === 'legacy'
                                  ? `₪${Math.ceil(lead.amount || 0).toLocaleString()}`
                                  : `${lead.balance_currency || '₪'}${Math.ceil(lead.balance || 0).toLocaleString()}`
                                }
                              </span>
                            </div>
                            {/* Manager */}
                            <div className="flex justify-between items-center py-1">
                              <span className="text-sm font-semibold text-gray-500">Manager</span>
                              <span className="text-sm font-bold text-gray-800">
                                {lead.manager_name || 'Not assigned'}
                              </span>
                            </div>
                            {/* Probability */}
                            <div className="flex justify-between items-center py-1">
                              <span className="text-sm font-semibold text-gray-500">Probability</span>
                              <span className="text-sm font-bold text-gray-800">{lead.probability || 0}%</span>
                            </div>
                            {/* Follow-up Date */}
                            <div className="flex justify-between items-center py-1">
                              <span className="text-sm font-semibold text-gray-500">Follow-up Date</span>
                              {editingFollowUpId === lead.follow_up_id ? (
                                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                  <input
                                    type="date"
                                    value={editFollowUpDate}
                                    onChange={(e) => setEditFollowUpDate(e.target.value)}
                                    className="input input-xs input-bordered"
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                  <button
                                    className="btn btn-xs btn-primary"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleSaveFollowUp(lead);
                                    }}
                                  >
                                    Save
                                  </button>
                                  <button
                                    className="btn btn-xs btn-ghost"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleCancelEditFollowUp();
                                    }}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                  <span className="text-sm font-bold text-gray-800">
                                    {lead.next_followup ? new Date(lead.next_followup).toLocaleDateString() : 'N/A'}
                                  </span>
                                  <button
                                    className="btn btn-xs btn-ghost"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleEditFollowUp(lead);
                                    }}
                                    title="Edit follow-up date"
                                  >
                                    <PencilSquareIcon className="w-4 h-4" style={{ color: '#3E28CD' }} />
                                  </button>
                                  <button
                                    className="btn btn-xs btn-ghost text-error"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDeleteFollowUp(lead);
                                    }}
                                    title="Delete follow-up"
                                  >
                                    <TrashIcon className="w-4 h-4" style={{ color: '#3E28CD' }} />
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {/* Mobile Card View */}
                <div className="md:hidden space-y-4">
                  {currentLeads.map((lead) => {
                    const daysOverdue = lead.next_followup ? Math.floor((new Date().getTime() - new Date(lead.next_followup).getTime()) / (1000 * 3600 * 24)) : 0;
                    return (
                      <div
                        key={lead.id}
                        className="bg-white rounded-2xl p-5 shadow-md hover:shadow-xl transition-all duration-200 border border-red-100 group flex flex-col justify-between min-h-[340px] relative cursor-pointer"
                        onClick={() => navigate(buildClientRoute(lead))}
                      >
                        <div className="flex-1 flex flex-col">
                          {/* Lead Number and Name */}
                          <div className="mb-3 flex items-center gap-2">
                            <span className="text-sm font-semibold text-gray-400 tracking-widest">
                              {formatLeadNumberForDisplay(lead.lead_number)}
                            </span>
                            <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                            <h3 className={`text-xl font-extrabold text-gray-900 transition-colors truncate flex-1 ${isAltTheme ? 'group-hover:text-green-600' : 'group-hover:text-primary'}`}>{lead.name}</h3>
                            {followUpTab === 'today' && (
                              <span className="text-sm font-bold px-2 py-1 rounded bg-green-600 text-white">Today</span>
                            )}
                            {followUpTab === 'tomorrow' && (
                              <span className="text-sm font-bold px-2 py-1 rounded bg-blue-600 text-white">Tomorrow</span>
                            )}
                          </div>
                          {/* Stage */}
                          <div className="flex justify-between items-center py-1">
                            <span className="text-sm font-semibold text-gray-500">Stage</span>
                            <span className="text-sm font-bold text-black">
                              {lead.stage_name || 'Follow-up Required'}
                            </span>
                          </div>
                          <div className="space-y-2 divide-y divide-gray-100 mt-2">
                            {/* Category */}
                            <div className="flex justify-between items-center py-1">
                              <span className="text-sm font-semibold text-gray-500">Category</span>
                              <span className="text-sm font-bold text-gray-800">
                                {lead.lead_type === 'legacy' ? lead.category_name : (lead.category_name || lead.category || 'Not specified')}
                              </span>
                            </div>
                            {/* Topic */}
                            <div className="flex justify-between items-center py-1">
                              <span className="text-sm font-semibold text-gray-500">Topic</span>
                              <span className="text-sm font-bold text-gray-800">{lead.topic || 'Not specified'}</span>
                            </div>
                            {/* Expert */}
                            <div className="flex justify-between items-center py-1">
                              <span className="text-sm font-semibold text-gray-500">Expert</span>
                              <span className="text-sm font-bold text-gray-800">
                                {lead.expert_name || 'Not assigned'}
                              </span>
                            </div>
                            {/* Amount */}
                            <div className="flex justify-between items-center py-1">
                              <span className="text-sm font-semibold text-gray-500">Amount</span>
                              <span className="text-sm font-bold text-gray-800">
                                {lead.lead_type === 'legacy'
                                  ? `₪${Math.ceil(lead.amount || 0).toLocaleString()}`
                                  : `${lead.balance_currency || '₪'}${Math.ceil(lead.balance || 0).toLocaleString()}`
                                }
                              </span>
                            </div>
                            {/* Manager */}
                            <div className="flex justify-between items-center py-1">
                              <span className="text-sm font-semibold text-gray-500">Manager</span>
                              <span className="text-sm font-bold text-gray-800">
                                {lead.manager_name || 'Not assigned'}
                              </span>
                            </div>
                            {/* Probability */}
                            <div className="flex justify-between items-center py-1">
                              <span className="text-sm font-semibold text-gray-500">Probability</span>
                              <span className="text-sm font-bold text-gray-800">{lead.probability || 0}%</span>
                            </div>
                            {/* Follow-up Date */}
                            <div className="flex justify-between items-center py-1">
                              <span className="text-sm font-semibold text-gray-500">Follow-up Date</span>
                              {editingFollowUpId === lead.follow_up_id ? (
                                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                  <input
                                    type="date"
                                    value={editFollowUpDate}
                                    onChange={(e) => setEditFollowUpDate(e.target.value)}
                                    className="input input-xs input-bordered"
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                  <button
                                    className="btn btn-xs btn-primary"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleSaveFollowUp(lead);
                                    }}
                                  >
                                    Save
                                  </button>
                                  <button
                                    className="btn btn-xs btn-ghost"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleCancelEditFollowUp();
                                    }}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                  <span className="text-sm font-bold text-gray-800">
                                    {lead.next_followup ? new Date(lead.next_followup).toLocaleDateString() : 'N/A'}
                                  </span>
                                  <button
                                    className="btn btn-xs btn-ghost"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleEditFollowUp(lead);
                                    }}
                                    title="Edit follow-up date"
                                  >
                                    <PencilSquareIcon className="w-4 h-4" style={{ color: '#3E28CD' }} />
                                  </button>
                                  <button
                                    className="btn btn-xs btn-ghost text-error"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDeleteFollowUp(lead);
                                    }}
                                    title="Delete follow-up"
                                  >
                                    <TrashIcon className="w-4 h-4" style={{ color: '#3E28CD' }} />
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            );
          })()}
        </div>
      )}
      {expanded === 'messages' && (
        <div className="glass-card mt-4 animate-fade-in">
          <div className="space-y-4">
            <h3 className="text-xl font-bold text-gray-900 mb-1">Latest Messages</h3>
            {dashboardIsSuperuser ? (
              <p className="text-sm text-gray-500 mb-4">
               
              </p>
            ) : null}
            <div
              className={
                dashboardIsSuperuser ? 'grid grid-cols-1 lg:grid-cols-2 gap-6 items-start' : 'space-y-3'
              }
            >
              {dashboardIsSuperuser ? (
                <div className="space-y-3 min-w-0">
                  <h4 className="text-sm font-semibold text-gray-800">All leads</h4>
                  <div className="space-y-3">
                    {latestMessagesAllLeads.map((message) => renderDashboardInboxCard(message, 'all'))}
                  </div>
                  {latestMessagesAllLeads.length === 0 && (
                    <div className="text-center py-6 text-gray-500 text-sm">No recent messages in the last 7 days</div>
                  )}
                </div>
              ) : null}
              <div className="space-y-3 min-w-0">
                {dashboardIsSuperuser ? (
                  <h4 className="text-sm font-semibold text-gray-800">My contacts</h4>
                ) : null}
                <div className="space-y-3">
                  {latestMessages.map((message) => renderDashboardInboxCard(message, 'mine'))}
                </div>
                {latestMessages.length === 0 && (
                  <div className="text-center py-8 text-gray-500">
                    {dashboardIsSuperuser
                      ? 'No recent messages for leads where you have a saved role'
                      : 'No new messages in the last 7 days for leads where you have a saved role'}
                  </div>
                )}
              </div>
            </div>
            <div className="flex justify-center mt-4">
              <button
                type="button"
                className="btn btn-outline btn-primary"
                onClick={() => {
                  void refreshDashboardMessages();
                }}
              >
                Refresh Messages
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Performance scoreboard (full width; archived AI column: `dashboard/DashboardAiSuggestionsArchive.tsx`) */}
      <div className="mb-6 md:mb-10 w-full min-w-0">
            {/* Header - simple on background */}
            <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6 gap-4">
              <div className="flex items-center gap-3">
                <div className={`flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-tr ${isAltTheme ? 'from-green-600 to-emerald-600' : 'from-purple-600 to-indigo-600'}`}>
                  <ChartBarIcon className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h2 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-base-content">Performance Dashboard</h2>
                  <p className="text-gray-600 dark:text-base-content/70 text-sm mt-0.5">Real-time sales metrics and analytics</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="tabs tabs-boxed bg-gray-100 shadow-inner rounded-xl p-1 border border-gray-200">
                  {scoreboardTabs.map(tab => (
                    <a
                      key={tab}
                      className={`tab text-sm font-semibold px-4 py-2 rounded-lg transition-all ${scoreTab === tab 
                        ? (isAltTheme ? 'tab-active bg-white text-green-600 shadow-sm border border-green-200' : 'tab-active bg-white text-purple-600 shadow-sm border border-purple-200')
                        : 'text-gray-600 hover:bg-gray-50'}`}
                      onClick={() => setScoreTab(tab)}
                    >
                      {tab}
                    </a>
                  ))}
                </div>
              </div>
            </div>

            {/* Performance Summary Cards */}
            {/* COMMENTED OUT: 4 performance boxes (Leads This Month, Meetings Scheduled, Revenue This Month, Contracts Signed) */}
            {/* <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8">
                <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1">
                  <div className="flex items-center justify-between mb-3">
                    <div className={`p-2 rounded-lg ${isAltTheme ? 'bg-green-50' : 'bg-purple-50'}`}>
                      <UserGroupIcon className={`w-5 h-5 ${isAltTheme ? 'text-green-600' : 'text-purple-600'}`} />
                    </div>
                    {leadsLoading ? (
                      <span className="text-2xl font-bold text-gray-900">Loading...</span>
                    ) : (
                      <span className="text-2xl font-bold text-gray-900">{totalLeadsThisMonth}</span>
                    )}
                  </div>
                  <div className="text-sm text-gray-700 font-medium">Leads This Month</div>
                  <div className="text-xs text-gray-500 mt-1">
                    {leadsLoading ? (
                      "Calculating..."
                    ) : (
                      <span className={`font-medium ${isLeadGrowthPositive ? 'text-green-600' : (isAltTheme ? 'text-green-600' : 'text-purple-600')}`}>
                        {isLeadGrowthPositive ? '+' : ''}{leadGrowthPercentage.toFixed(1)}% from last month
                      </span>
                    )}
                  </div>
                </div>
                
                <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1">
                  <div className="flex items-center justify-between mb-3">
                    <div className={`p-2 rounded-lg ${isAltTheme ? 'bg-green-50' : 'bg-purple-50'}`}>
                      <CheckCircleIcon className={`w-5 h-5 ${isAltTheme ? 'text-green-600' : 'text-purple-600'}`} />
                    </div>
                    {conversionLoading ? (
                      <span className="text-2xl font-bold text-gray-900">Loading...</span>
                    ) : (
                      <span className="text-2xl font-bold text-gray-900">{meetingsScheduledThisMonth}</span>
                    )}
                  </div>
                  <div className="text-sm text-gray-700 font-medium">Meetings Scheduled</div>
                  <div className="text-xs text-gray-500 mt-1">
                    {conversionLoading ? (
                      "Calculating..."
                    ) : (
                      <span className={`font-medium ${isAltTheme ? 'text-green-600' : 'text-purple-600'}`}>
                        {conversionRate.toFixed(1)}% of new leads this month
                      </span>
                    )}
                  </div>
                </div>
                
                <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1">
                  <div className="flex items-center justify-between mb-3">
                    <div className={`p-2 rounded-lg ${isAltTheme ? 'bg-green-50' : 'bg-purple-50'}`}>
                      <ArrowTrendingUpIcon className={`w-5 h-5 ${isAltTheme ? 'text-green-600' : 'text-purple-600'}`} />
                    </div>
                    {revenueLoading ? (
                      <span className="text-2xl font-bold text-gray-900">Loading...</span>
                    ) : (
                      <span className="text-2xl font-bold text-gray-900">₪{Math.ceil(realRevenueThisMonth).toLocaleString()}</span>
                    )}
                  </div>
                  <div className="text-sm text-gray-700 font-medium">Revenue This Month</div>
                  <div className="text-xs text-gray-500 mt-1">
                    {revenueLoading ? (
                      "Calculating..."
                    ) : (
                      <span className={`font-medium ${isAboveTarget ? 'text-green-600' : (isAltTheme ? 'text-green-600' : 'text-purple-600')}`}>
                        {isAboveTarget ? '+' : ''}{revenuePercentage.toFixed(1)}% from ₪2M target
                      </span>
                    )}
                  </div>
                  {/* Progress Bar */}
            {/* {!revenueLoading && (
                    <div className="mt-3">
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div 
                          className={`h-2 rounded-full transition-all duration-500 ${
                            isAboveTarget ? 'bg-green-500' : (isAltTheme ? 'bg-green-500' : 'bg-purple-500')
                          }`}
                          style={{ width: `${Math.min(revenuePercentage, 100)}%` }}
                        ></div>
                      </div>
                      <div className="flex justify-between text-xs text-gray-500 mt-1">
                        <span>₪0</span>
                        <span>₪2M Target</span>
                      </div>
                    </div>
                  )}
                </div>
                
                <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1">
                  <div className="flex items-center justify-between mb-3">
                    <div className={`p-2 rounded-lg ${isAltTheme ? 'bg-green-50' : 'bg-purple-50'}`}>
                      <DocumentTextIcon className={`w-5 h-5 ${isAltTheme ? 'text-green-600' : 'text-purple-600'}`} />
                    </div>
                    {contractsLoading ? (
                      <span className="text-2xl font-bold text-gray-900">Loading...</span>
                    ) : (
                      <span className="text-2xl font-bold text-gray-900">{contractsSignedThisMonth}</span>
                    )}
                  </div>
                  <div className="text-sm text-gray-700 font-medium">Contracts Signed</div>
                  <div className="text-xs text-gray-500 mt-1">
                    {contractsLoading ? (
                      "Calculating..."
                    ) : (
                      <span className={`font-medium ${isContractsGrowthPositive ? 'text-green-600' : 'text-purple-600'}`}>
                        {isContractsGrowthPositive ? '+' : ''}{contractsPercentage.toFixed(1)}% from last month
                      </span>
                    )}
                  </div>
                </div>
              </div> */}

            {/* Department Performance Boxes */}
            {scoreTab === 'Tables' && (
              <div className="space-y-6">
                <div className="flex items-center gap-3 mb-4">
                  <h3 className="text-lg font-semibold text-slate-800 dark:text-base-content">Department Performance</h3>
                </div>
                {/* Agreement signed */}
                <div>
                  <div className="bg-white rounded-2xl border border-gray-200 shadow-lg overflow-hidden min-w-0 w-full">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between px-2 md:p-3 py-2 md:py-3 border-b border-slate-200 bg-white gap-2">
                      <div className={`text-xs md:text-sm font-semibold ${isAltTheme ? 'text-green-600' : 'text-[#3b28c7]'}`}>Agreement signed</div>
                      <div className="flex flex-wrap items-center gap-1 md:gap-2">
                        <span className="text-xs md:text-sm font-semibold text-slate-700 mr-1 md:mr-2">Filter by:</span>
                        <button className={`btn btn-xs ${showTodayCols ? (isAltTheme ? 'bg-[#505d57] text-white hover:bg-[#3d4743]' : 'btn-primary text-white') : 'btn-ghost text-slate-700'}`} onClick={() => setShowTodayCols(v => !v)}>
                          {todayFilterMode === 'week' ? 'Week' : 'Today'}
                        </button>
                        <button
                          className={`btn btn-xs ${todayFilterMode === 'week' ? (isAltTheme ? 'bg-[#505d57] text-white hover:bg-[#3d4743]' : 'btn-primary text-white') : 'btn-ghost text-slate-700'}`}
                          onClick={() => setTodayFilterMode(v => v === 'week' ? 'today' : 'week')}
                          title={todayFilterMode === 'week' ? 'Switch back to Today' : 'Show Week data'}
                        >
                          Week
                        </button>
                        <button className={`btn btn-xs ${showLast30Cols ? (isAltTheme ? 'bg-[#505d57] text-white hover:bg-[#3d4743]' : 'btn-primary text-white') : 'btn-ghost text-slate-700'}`} onClick={() => setShowLast30Cols(v => !v)}>Last 30d</button>
                        <button className={`btn btn-xs ${showLast3MonthsCols ? (isAltTheme ? 'bg-[#505d57] text-white hover:bg-[#3d4743]' : 'btn-primary text-white') : 'btn-ghost text-slate-700'}`} onClick={() => setShowLast3MonthsCols(v => !v)}>Last 3m</button>
                        <button className={`btn btn-xs ${showLastMonthCols ? (isAltTheme ? 'bg-[#505d57] text-white hover:bg-[#3d4743]' : 'btn-primary text-white') : 'btn-ghost text-slate-700'}`} onClick={() => setShowLastMonthCols(v => !v)}>This Month</button>
                        <div className="border-l border-slate-300 h-4 md:h-6 mx-1 md:mx-2"></div>
                        <details className="dropdown dropdown-end">
                          <summary className="btn btn-xs btn-ghost text-slate-700">
                            {selectedMonth} <svg className="w-2 h-2 md:w-3 md:h-3 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                          </summary>
                          <ul className="dropdown-content z-[1] p-2 shadow bg-base-100 rounded-box w-40 max-h-80 overflow-y-auto" style={{ display: 'flex', flexDirection: 'column' }}>
                            {months.map(month => (
                              <li key={month} style={{ width: '100%' }}>
                                <a
                                  onClick={(e) => {
                                    e.preventDefault();
                                    setSelectedMonth(month);
                                    // Close the details element
                                    const details = e.currentTarget.closest('details');
                                    if (details) {
                                      details.removeAttribute('open');
                                    }
                                  }}
                                  className={`block w-full p-2 text-sm hover:bg-gray-100 ${selectedMonth === month ? (isAltTheme ? 'bg-green-600 text-white' : 'bg-primary text-primary-content') : ''}`}
                                >
                                  {month}
                                </a>
                              </li>
                            ))}
                          </ul>
                        </details>
                        <details className="dropdown dropdown-end">
                          <summary className="btn btn-xs btn-ghost text-slate-700">
                            {selectedYear} <svg className="w-2 h-2 md:w-3 md:h-3 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                          </summary>
                          <ul className="dropdown-content z-[1] p-2 shadow bg-base-100 rounded-box w-24 max-h-60 overflow-y-auto" style={{ display: 'flex', flexDirection: 'column' }}>
                            {years.map(year => (
                              <li key={year} style={{ width: '100%' }}>
                                <a
                                  onClick={(e) => {
                                    e.preventDefault();
                                    setSelectedYear(year);
                                    // Close the details element
                                    const details = e.currentTarget.closest('details');
                                    if (details) {
                                      details.removeAttribute('open');
                                    }
                                  }}
                                  className="block w-full p-2 text-sm hover:bg-gray-100"
                                >
                                  {year}
                                </a>
                              </li>
                            ))}
                          </ul>
                        </details>
                      </div>
                    </div>
                    {departmentPerformanceLoading && !postLoginWelcomeActive ? (
                      <div className="flex justify-center items-center py-12">
                        <span className={`loading loading-spinner loading-lg ${isAltTheme ? 'text-green-600' : 'text-primary'}`}></span>
                      </div>
                    ) : !departmentPerformanceLoading ? (
                      renderColumnsView('agreement')
                    ) : null}
                  </div>
                </div>

                {/* Invoiced */}
                <div className="mt-4 md:mt-6">
                  <div className="bg-white rounded-2xl border border-gray-200 shadow-lg overflow-hidden min-w-0 w-full">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between px-2 md:p-3 py-2 md:py-3 border-b border-slate-200 bg-white gap-2">
                      <div className={`text-xs md:text-sm font-semibold ${isAltTheme ? 'text-green-600' : 'text-[#3b28c7]'}`}>Invoiced</div>
                      <div className="flex flex-wrap items-center gap-1 md:gap-2">
                        <span className="text-xs md:text-sm font-semibold text-slate-700 mr-1 md:mr-2">Filter by:</span>
                        <button className={`btn btn-xs ${showTodayCols ? (isAltTheme ? 'bg-[#505d57] text-white hover:bg-[#3d4743]' : 'btn-primary text-white') : 'btn-ghost text-slate-700'}`} onClick={() => setShowTodayCols(v => !v)}>
                          {todayFilterMode === 'week' ? 'Week' : 'Today'}
                        </button>
                        <button
                          className={`btn btn-xs ${todayFilterMode === 'week' ? (isAltTheme ? 'bg-[#505d57] text-white hover:bg-[#3d4743]' : 'btn-primary text-white') : 'btn-ghost text-slate-700'}`}
                          onClick={() => setTodayFilterMode(v => v === 'week' ? 'today' : 'week')}
                          title={todayFilterMode === 'week' ? 'Switch back to Today' : 'Show Week data'}
                        >
                          Week
                        </button>
                        <button className={`btn btn-xs ${showLast30Cols ? (isAltTheme ? 'bg-[#505d57] text-white hover:bg-[#3d4743]' : 'btn-primary text-white') : 'btn-ghost text-slate-700'}`} onClick={() => setShowLast30Cols(v => !v)}>Last 30d</button>
                        <button className={`btn btn-xs ${showLast3MonthsCols ? (isAltTheme ? 'bg-[#505d57] text-white hover:bg-[#3d4743]' : 'btn-primary text-white') : 'btn-ghost text-slate-700'}`} onClick={() => setShowLast3MonthsCols(v => !v)}>Last 3m</button>
                        <button className={`btn btn-xs ${showLastMonthCols ? (isAltTheme ? 'bg-[#505d57] text-white hover:bg-[#3d4743]' : 'btn-primary text-white') : 'btn-ghost text-slate-700'}`} onClick={() => setShowLastMonthCols(v => !v)}>This Month</button>
                        <div className="border-l border-slate-300 h-4 md:h-6 mx-1 md:mx-2"></div>
                        <details className="dropdown dropdown-end">
                          <summary className="btn btn-xs btn-ghost text-slate-700">
                            {selectedMonth} <svg className="w-2 h-2 md:w-3 md:h-3 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                          </summary>
                          <ul className="dropdown-content z-[1] p-2 shadow bg-base-100 rounded-box w-40 max-h-80 overflow-y-auto" style={{ display: 'flex', flexDirection: 'column' }}>
                            {months.map(month => (
                              <li key={month} style={{ width: '100%' }}>
                                <a
                                  onClick={(e) => {
                                    e.preventDefault();
                                    setSelectedMonth(month);
                                    // Close the details element
                                    const details = e.currentTarget.closest('details');
                                    if (details) {
                                      details.removeAttribute('open');
                                    }
                                  }}
                                  className={`block w-full p-2 text-sm hover:bg-gray-100 ${selectedMonth === month ? (isAltTheme ? 'bg-green-600 text-white' : 'bg-primary text-primary-content') : ''}`}
                                >
                                  {month}
                                </a>
                              </li>
                            ))}
                          </ul>
                        </details>
                        <details className="dropdown dropdown-end">
                          <summary className="btn btn-xs btn-ghost text-slate-700">
                            {selectedYear} <svg className="w-2 h-2 md:w-3 md:h-3 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                          </summary>
                          <ul className="dropdown-content z-[1] p-2 shadow bg-base-100 rounded-box w-24 max-h-60 overflow-y-auto" style={{ display: 'flex', flexDirection: 'column' }}>
                            {years.map(year => (
                              <li key={year} style={{ width: '100%' }}>
                                <a
                                  onClick={(e) => {
                                    e.preventDefault();
                                    setSelectedYear(year);
                                    // Close the details element
                                    const details = e.currentTarget.closest('details');
                                    if (details) {
                                      details.removeAttribute('open');
                                    }
                                  }}
                                  className="block w-full p-2 text-sm hover:bg-gray-100"
                                >
                                  {year}
                                </a>
                              </li>
                            ))}
                          </ul>
                        </details>
                      </div>
                    </div>
                    {invoicedDataLoading && !postLoginWelcomeActive ? (
                      <div className="flex justify-center items-center py-12">
                        <span className={`loading loading-spinner loading-lg ${isAltTheme ? 'text-green-600' : 'text-primary'}`}></span>
                      </div>
                    ) : !invoicedDataLoading ? (
                      renderColumnsView('invoiced')
                    ) : null}
                  </div>
                </div>
              </div>
            )}

            {/* Professional Chart Visualization - coloured box, no shadow */}
            {(scoreTab === 'Today' || scoreTab === selectedMonth || scoreTab === 'Last 30d') && (
              <div className={`rounded-2xl p-6 md:p-8 border-0 ${isAltTheme ? 'bg-teal-50/90 dark:bg-teal-950/30' : 'bg-indigo-50/90 dark:bg-indigo-950/30'}`}>
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div className={`p-3 rounded-xl ${isAltTheme ? 'bg-gradient-to-r from-green-600 to-emerald-600' : 'bg-gradient-to-r from-purple-600 to-indigo-600'}`}>
                      <ChartBarIcon className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-gray-900 dark:text-base-content">Performance Analytics</h3>
                      <p className="text-sm text-gray-600 dark:text-base-content/70">Real-time business metrics</p>
                    </div>
                  </div>
                  <div className={`rounded-xl p-4 border-0 ${isAltTheme ? 'bg-emerald-100/70' : 'bg-purple-100/70'}`}>
                    <div className="flex items-center gap-6">
                      <div className="flex items-center gap-2">
                        <div className={`w-4 h-4 rounded-full ${isAltTheme ? 'bg-green-600' : 'bg-purple-600'}`}></div>
                        <span className="text-sm font-medium text-gray-700 dark:text-base-content">Signed</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className={`w-4 h-4 rounded-full ${isAltTheme ? 'bg-emerald-500' : 'bg-cyan-500'}`}></div>
                        <span className="text-sm font-medium text-gray-700 dark:text-base-content">Due</span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className={`rounded-xl p-6 border-0 ${isAltTheme ? 'bg-white/50 dark:bg-black/20' : 'bg-white/50 dark:bg-black/20'}`}>
                  <div className="w-full h-[450px]" style={{ minWidth: '400px', minHeight: '450px' }}>
                    {(() => {
                      const chartData = scoreTab === 'Today' ? scoreboardBarDataToday : scoreTab === selectedMonth ? scoreboardBarDataMonth : scoreboardBarData30d;
                      return chartData && chartData.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%" minWidth={400} minHeight={450}>
                          <BarChart
                            data={chartData}
                            barCategoryGap={16}
                            margin={{ top: 30, right: 30, left: 20, bottom: 40 }}
                          >
                            <defs>
                              <linearGradient id="signedGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.8} />
                                <stop offset="100%" stopColor="#7c3aed" stopOpacity={0.9} />
                              </linearGradient>
                              <linearGradient id="dueGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.8} />
                                <stop offset="100%" stopColor="#0891b2" stopOpacity={0.9} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="2 2" stroke="#e5e7eb" opacity={0.3} />
                            <XAxis
                              dataKey="category"
                              tick={{ fontSize: 11, fill: '#4b5563', fontWeight: '500' }}
                              axisLine={{ stroke: '#d1d5db', strokeWidth: 1 }}
                              tickLine={{ stroke: '#d1d5db', strokeWidth: 1 }}
                              tickMargin={12}
                              interval={0}
                            />
                            <YAxis
                              tick={{ fontSize: 12, fill: '#4b5563' }}
                              axisLine={{ stroke: '#d1d5db', strokeWidth: 1 }}
                              tickLine={{ stroke: '#d1d5db', strokeWidth: 1 }}
                              width={45}
                              tickMargin={8}
                            />
                            <Tooltip
                              contentStyle={{
                                background: 'rgba(255,255,255,0.98)',
                                borderRadius: 16,
                                border: '1px solid #e5e7eb',
                                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
                                padding: '12px 16px'
                              }}
                              labelStyle={{ color: '#111827', fontWeight: 'bold', fontSize: '14px', marginBottom: '8px' }}
                              itemStyle={{ color: '#374151', fontSize: '13px', fontWeight: '500' }}
                              formatter={(value: number, name: string) => {
                                if (name === 'signed') return [`${Math.ceil(value).toLocaleString()} NIS`, 'Signed'];
                                if (name === 'due') return [`${Math.ceil(value).toLocaleString()} NIS`, 'Due'];
                                return [Math.ceil(value).toLocaleString(), name || 'Unknown'];
                              }}
                              cursor={{ fill: 'rgba(0, 0, 0, 0.05)' }}
                            />
                            <Bar
                              dataKey="signed"
                              name="signed"
                              fill="url(#signedGradient)"
                              radius={[8, 8, 0, 0]}
                              barSize={28}
                              stroke="#7c3aed"
                              strokeWidth={1}
                              strokeOpacity={0.3}
                            />
                            <Bar
                              dataKey="due"
                              name="due"
                              fill="url(#dueGradient)"
                              radius={[8, 8, 0, 0]}
                              barSize={28}
                              stroke="#0891b2"
                              strokeWidth={1}
                              strokeOpacity={0.3}
                            />
                          </BarChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="flex items-center justify-center h-full text-gray-500">
                          <div className="text-center">
                            <div className="text-lg font-medium mb-2">No data available</div>
                            <div className="text-sm">Chart will appear when data is loaded</div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Chart Statistics */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
                  <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-2 h-2 bg-purple-600 rounded-full"></div>
                      <span className="text-sm font-medium text-gray-600">Total Signed</span>
                    </div>
                    <div className="text-2xl font-bold text-gray-900">
                      {(() => {
                        const data = scoreTab === 'Today' ? scoreboardBarDataToday : scoreTab === selectedMonth ? scoreboardBarDataMonth : scoreboardBarData30d;
                        return data.reduce((sum: number, item: any) => sum + item.signed, 0);
                      })()}
                    </div>
                  </div>
                  <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-2 h-2 bg-cyan-500 rounded-full"></div>
                      <span className="text-sm font-medium text-gray-600">Total Due</span>
                    </div>
                    <div className="text-2xl font-bold text-gray-900">
                      {(() => {
                        const data = scoreTab === 'Today' ? scoreboardBarDataToday : scoreTab === selectedMonth ? scoreboardBarDataMonth : scoreboardBarData30d;
                        return data.reduce((sum: number, item: any) => sum + item.due, 0);
                      })()}
                    </div>
                  </div>
                  <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                      <span className="text-sm font-medium text-gray-600">Conversion Rate</span>
                    </div>
                    <div className="text-2xl font-bold text-gray-900">
                      {(() => {
                        const data = scoreTab === 'Today' ? scoreboardBarDataToday : scoreTab === selectedMonth ? scoreboardBarDataMonth : scoreboardBarData30d;
                        const signed = data.reduce((sum: number, item: any) => sum + item.signed, 0);
                        const due = data.reduce((sum: number, item: any) => sum + item.due, 0);
                        const total = signed + due;
                        return total > 0 ? `${Math.round((signed / total) * 100)}%` : '0%';
                      })()}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Quick Actions removed per request */}
      </div>

      {/* My Contribution - above Team Availability */}
      <div className="w-full mt-8">
        <MyContribution
          employeeId={currentUserEmployeeId}
          employeeName={currentUserFullName || ''}
        />
      </div>

      {/* Team Availability and Calendar Section */}
      <div className="w-full mt-12">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-6">
          {/* Team Availability Section */}
          <div className="bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden min-w-0">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 px-6 py-4 border-b border-gray-200">
              <div className="flex items-center justify-between w-full lg:w-auto">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-tr from-purple-500 to-blue-600 rounded-lg flex items-center justify-center">
                    <UserGroupIcon className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-lg font-bold text-gray-900">
                        Team Availability
                      </h2>
                      {dashboardIsSuperuser && (
                        <button
                          type="button"
                          className="btn btn-xs btn-outline btn-primary rounded-full px-3 min-h-0 h-7"
                          onClick={() => setIsTeamStatusModalOpen(true)}
                        >
                          View all
                        </button>
                      )}
                    </div>
                    <p className="text-sm text-gray-500">
                  {getDateDescription(teamAvailabilityDate)}
                    </p>
                  </div>
                </div>
                {/* My Availability Button - Mobile Only (icon only) */}
                <button
                  onClick={() => setIsMyAvailabilityModalOpen(true)}
                  className="btn btn-sm btn-primary lg:hidden btn-square"
                  title="My Availability"
                >
                  <CalendarIcon className="w-5 h-5" />
                </button>
              </div>

              {/* Center: Department Filter - Dropdown - Desktop Only */}
              <div className="hidden lg:flex items-center justify-center flex-1">
                <div className="relative">
                  <select
                    className="select select-bordered select-sm w-48"
                    value={departmentFilter}
                    onChange={(e) => setDepartmentFilter(e.target.value)}
                  >
                    <option value="">All Departments</option>
                    {availableDepartments.map((dept) => (
                      <option key={dept} value={dept}>
                        {dept}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const currentDate = new Date(teamAvailabilityDate + 'T00:00:00');
                    currentDate.setDate(currentDate.getDate() - 1);
                    const year = currentDate.getFullYear();
                    const month = String(currentDate.getMonth() + 1).padStart(2, '0');
                    const day = String(currentDate.getDate()).padStart(2, '0');
                    setTeamAvailabilityDate(`${year}-${month}-${day}`);
                  }}
                  className="btn btn-sm btn-ghost btn-circle"
                  title="Previous day"
                >
                  <ChevronLeftIcon className="w-5 h-5" />
                </button>
                <CalendarIcon className="w-5 h-5 text-gray-500" />
                <input
                  type="date"
                  className="input input-bordered input-sm"
                  value={teamAvailabilityDate}
                  onChange={(e) => setTeamAvailabilityDate(e.target.value)}
                  title="Select date to check availability"
                />
                <button
                  type="button"
                  onClick={() => {
                    const currentDate = new Date(teamAvailabilityDate + 'T00:00:00');
                    currentDate.setDate(currentDate.getDate() + 1);
                    const year = currentDate.getFullYear();
                    const month = String(currentDate.getMonth() + 1).padStart(2, '0');
                    const day = String(currentDate.getDate()).padStart(2, '0');
                    setTeamAvailabilityDate(`${year}-${month}-${day}`);
                  }}
                  className="btn btn-sm btn-ghost btn-circle"
                  title="Next day"
                >
                  <ChevronRightIcon className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Employee List - Grouped by Type */}
            {unavailableEmployeesLoading ? (
              <div className="flex justify-center items-center py-8 px-6">
                <div className="loading loading-spinner loading-lg text-gray-600"></div>
              </div>
            ) : (groupedUnavailableData.sick_days.length > 0 || groupedUnavailableData.vacation.length > 0 || groupedUnavailableData.general.length > 0) ? (
              <div className="pb-6 pt-4">
                {(() => {
                  const hasSickDays = groupedUnavailableData.sick_days.length > 0;
                  const hasVacation = groupedUnavailableData.vacation.length > 0;
                  const hasGeneral = groupedUnavailableData.general.length > 0;

                  // Helper function to render employee list rows
                  const renderEmployeeRow = (item: any, badgeColor: string, badgeText: string) => {
                    const employeeInitials = item.employeeName
                      .split(' ')
                      .map((n: string) => n[0])
                      .join('')
                      .toUpperCase()
                      .slice(0, 2);

                    const hasMore = item.allUnavailabilities && item.allUnavailabilities.length > 1;

                    return (
                      <>
                        <div
                          key={item.id}
                          role={hasMore ? 'button' : undefined}
                          tabIndex={hasMore ? 0 : undefined}
                          onClick={hasMore ? () => setExpandedEmployeeCards(prev => {
                            const newSet = new Set(prev);
                            if (newSet.has(item.employeeId)) newSet.delete(item.employeeId);
                            else newSet.add(item.employeeId);
                            return newSet;
                          }) : undefined}
                          onKeyDown={hasMore ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedEmployeeCards(prev => { const newSet = new Set(prev); if (newSet.has(item.employeeId)) newSet.delete(item.employeeId); else newSet.add(item.employeeId); return newSet; }); } } : undefined}
                          className={`flex items-center gap-2 md:gap-4 px-3 md:px-6 py-3 hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-b-0 min-w-0 ${hasMore ? 'cursor-pointer' : ''}`}
                        >
                          {/* Avatar + Name: on mobile name under avatar; on desktop avatar left of name+department */}
                          <div className="flex flex-col md:flex-row md:items-center gap-1 md:gap-4 flex-shrink-0 md:flex-1 md:min-w-0">
                            <div className="flex-shrink-0">
                              {item.photo_url ? (
                                <img
                                  src={item.photo_url}
                                  alt={item.employeeName}
                                  className="w-12 h-12 rounded-full object-cover"
                                  onError={(e) => {
                                    const target = e.target as HTMLImageElement;
                                    const targetParent = target.parentElement;
                                    if (targetParent) {
                                      target.style.display = 'none';
                                      const fallback = document.createElement('div');
                                      fallback.className = 'w-12 h-12 rounded-full flex items-center justify-center bg-gradient-to-br from-blue-500 to-purple-600 text-white text-sm font-bold';
                                      fallback.textContent = employeeInitials;
                                      targetParent.insertBefore(fallback, target);
                                    }
                                  }}
                                />
                              ) : (
                                <div className="w-12 h-12 rounded-full flex items-center justify-center bg-gradient-to-br from-blue-500 to-purple-600 text-white text-sm font-bold">
                                  {employeeInitials}
                                </div>
                              )}
                            </div>
                            <div className="min-w-0 text-center md:text-left">
                              <div className="font-semibold text-gray-900 text-sm md:text-base truncate">{item.employeeName}</div>
                              <div className="text-sm text-gray-500 truncate hidden md:block">{item.department || 'N/A'}</div>
                            </div>
                          </div>

                          {/* Status Badge: RTL-aware for Hebrew, uses remaining space on mobile */}
                          <div className="flex-1 min-w-0 md:flex-initial md:max-w-none">
                            <span
                              className={`inline-block px-3 py-1 rounded-full text-sm font-semibold truncate max-w-full ${badgeColor}`}
                              title={item.reason || badgeText}
                              dir="auto"
                            >
                              {item.reason || badgeText}
                            </span>
                          </div>

                          {/* Count (if more) on top of time, at right */}
                          <div className="flex flex-shrink-0 flex-col items-end gap-0.5 ml-auto text-right min-w-0">
                            {hasMore && (
                              <span className={`px-3 py-1 rounded-full text-sm font-semibold ${badgeColor}`} title={`${item.allUnavailabilities!.length - 1} more`}>
                                +{item.allUnavailabilities!.length - 1}
                              </span>
                            )}
                            <div className="font-semibold text-gray-900 text-sm md:text-base whitespace-nowrap">
                              {item.time && item.time !== 'All Day'
                                ? item.time.includes(' - ')
                                  ? item.time.split(' - ').map((t: string) => formatTimeString(t.trim())).join(' - ')
                                  : formatTimeString(item.time)
                                : 'All Day'}
                            </div>
                            {item.date && item.date.includes('to') && (
                              <div className="text-xs text-gray-500">{item.date}</div>
                            )}
                          </div>
                        </div>

                        {/* Expandable section for additional unavailabilities */}
                        {item.allUnavailabilities && item.allUnavailabilities.length > 1 && expandedEmployeeCards.has(item.employeeId) && (
                          <div className="bg-gray-50 border-b border-gray-100">
                            {item.allUnavailabilities.slice(1).map((unav: any, idx: number) => {
                              const formattedTime = unav.time && unav.time !== 'All Day' && unav.time.includes(':')
                                ? unav.time.split(' - ').map((t: string) => formatTimeString(t.trim())).join(' - ')
                                : unav.time !== 'All Day' ? unav.time : 'All Day';
                              return (
                                <div
                                  key={unav.id || idx}
                                  className="flex items-center gap-3 md:gap-4 px-4 md:px-6 py-3 hover:bg-gray-100 transition-colors"
                                >
                                  {/* Reason badge - left-aligned (no avatar/name in these rows) */}
                                  <div className="flex-shrink-0 min-w-0 max-w-[50%] md:max-w-none">
                                    <span className={`inline-block px-3 py-1 rounded-full text-sm font-semibold truncate max-w-full ${badgeColor}`} title={unav.reason || badgeText} dir="auto">
                                      {unav.reason || badgeText}
                                    </span>
                                  </div>

                                  <div className="flex-1 min-w-0" />

                                  {/* Time - right-aligned */}
                                  <div className="flex-shrink-0 text-right min-w-0">
                                    <div className="font-semibold text-gray-900 text-sm md:text-base whitespace-nowrap">
                                      {formattedTime}
                                    </div>
                                    {unav.date && unav.date.includes('to') && (
                                      <div className="text-xs text-gray-500 mt-0.5">{unav.date}</div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </>
                    );
                  };

                  return (
                    <div className="flex flex-col gap-8">
                      {/* Sick Days Section */}
                      {hasSickDays && (
                        <div className="flex flex-col">
                          <h3 className="text-base font-semibold text-gray-700 mb-3 px-6 flex items-center gap-2">
                            <FaceFrownIcon className="w-5 h-5 text-orange-500" />
                            Sick Days
                          </h3>
                          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                            {groupedUnavailableData.sick_days
                              .filter((item) => {
                                if (!departmentFilter.trim()) return true;
                                return item.department?.toLowerCase().includes(departmentFilter.toLowerCase());
                              })
                              .map((item) => renderEmployeeRow(item, 'bg-orange-100 text-orange-700', 'Sick Day'))}
                          </div>
                        </div>
                      )}

                      {/* Vacation Section */}
                      {hasVacation && (
                        <div className="flex flex-col">
                          <h3 className="text-base font-semibold text-gray-700 mb-3 px-6 flex items-center gap-2">
                            <SunIcon className="w-5 h-5 text-green-500" />
                            Vacation
                          </h3>
                          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                            {groupedUnavailableData.vacation
                              .filter((item) => {
                                if (!departmentFilter.trim()) return true;
                                return item.department?.toLowerCase().includes(departmentFilter.toLowerCase());
                              })
                              .map((item) => renderEmployeeRow(item, 'bg-green-100 text-green-700', 'Vacation'))}
                          </div>
                        </div>
                      )}

                      {/* General Section */}
                      {hasGeneral && (
                        <div className="flex flex-col">
                          <h3 className="text-base font-semibold text-gray-700 mb-3 px-6 flex items-center gap-2">
                            <CalendarDaysIcon className="w-5 h-5 text-gray-500" />
                            General
                          </h3>
                          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                            {groupedUnavailableData.general
                              .filter((item) => {
                                if (!departmentFilter.trim()) return true;
                                return item.department?.toLowerCase().includes(departmentFilter.toLowerCase());
                              })
                              .map((item) => renderEmployeeRow(item, 'bg-gray-100 text-gray-700', 'Unavailable'))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            ) : (
              <div className="px-6 pb-6 pt-8 text-center">
                <div className="flex flex-col items-center gap-4">
                  <div className="p-3 bg-green-100 rounded-full">
                    <CheckCircleIcon className="w-8 h-8 text-green-600" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">All Team Members Available</h3>
                    <p className="text-gray-600">
                      No employees are unavailable on {getDateDescription(teamAvailabilityDate)}. Great job team!
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* My Availability Calendar - Desktop Only */}
          <div className="hidden lg:block">
            <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6 h-full">
              <MyAvailabilitySection
                onAvailabilityChange={() => void loadTeamAvailability(teamAvailabilityDate, { background: true })}
                onOpenUploadDocs={() => setIsSickDaysUploadModalOpen(true)}
              />
            </div>
          </div>
        </div>
      </div>

      {/* 3. Employee Scoreboard Component */}
      {/* COMMENTED OUT: Employee performance 4 boxes (Top Closers, Top Schedulers, Top Experts, Top Handlers) */}
      {/* <EmployeeScoreboard /> */}

      {/* Closed deals without Payments plan Box - Lazy Loaded */}
      <div className="w-full mt-12">
        <Suspense fallback={<div className="text-center py-8 text-gray-500">Loading...</div>}>
          <NewHandlerCasesWidget maxItems={10} />
        </Suspense>
      </div>

      {/* Closed deals without Payments plan Box - Lazy Loaded */}
      <div className="w-full mt-12">
        <Suspense fallback={<div className="text-center py-8 text-gray-500">Loading...</div>}>
          <ClosedDealsWithoutPaymentPlanWidget maxItems={10} />
        </Suspense>
      </div>

      {/* My Waiting Leads Box - Lazy Loaded */}
      <div className="w-full mt-12">
        <Suspense fallback={<div className="text-center py-8 text-gray-500">Loading...</div>}>
          <WaitingForPriceOfferMyLeadsWidget maxItems={10} />
        </Suspense>
      </div>

      {/* 4. My Performance Graph (Full Width) - hidden on mobile */}
      <div className="w-full mt-12 hidden md:block">
        <div className="bg-white rounded-2xl shadow-lg border border-gray-200 w-full max-w-full">
          <div className="p-8">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between mb-6 gap-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="flex items-center justify-center w-12 h-12 rounded-full shadow bg-white">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                    <defs>
                      <linearGradient id="perfIconGradient" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
                        <stop stopColor="#a21caf" />
                        <stop offset="1" stopColor="#06b6d4" />
                      </linearGradient>
                    </defs>
                    <path d="M3 17V21M7 13V21M11 9V21M15 5V21M19 3V21" stroke="url(#perfIconGradient)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <span className="text-2xl font-bold text-gray-900">My Performance</span>
              </div>
              <div className="flex gap-6 text-sm md:text-base items-center">
                <div className="flex flex-col items-center">
                  <span className="font-bold text-gray-900 text-xl">{contractsLast30}</span>
                  <span className="text-gray-500">Last 30 Days</span>
                </div>
                <div className="flex flex-col items-center">
                  <span className="font-bold text-gray-900 text-xl">{contractsToday}</span>
                  <span className="text-gray-500">Today</span>
                </div>
                <div className="flex flex-col items-center">
                  <span className="font-bold text-gray-900 text-xl">{contractsThisMonth}</span>
                  <span className="text-gray-500">This Month</span>
                </div>
                {/* View Leads Button */}
                <button
                  className="btn btn-sm btn-outline border-gray-300 text-gray-700 hover:bg-gray-100 ml-2"
                  onClick={() => setShowLeadsList((v) => !v)}
                >
                  {showLeadsList ? 'Hide Leads' : 'View Leads'}
                </button>
              </div>
            </div>
            <div className="w-full h-72 bg-white" style={{ minWidth: '400px', minHeight: '288px' }}>
              {performanceData && performanceData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%" minWidth={400} minHeight={288}>
                  <LineChart data={performanceData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#222' }} axisLine={{ stroke: '#e5e7eb' }} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#222' }} axisLine={{ stroke: '#e5e7eb' }} tickLine={false} width={30} />
                    <Tooltip content={<PerformanceTooltip />} />
                    <Line
                      type="monotone"
                      dataKey="count"
                      stroke="#3b28c7"
                      strokeWidth={3}
                      dot={{ r: 5, stroke: '#3b28c7', strokeWidth: 2, fill: '#fff' }}
                      activeDot={{ r: 8, fill: '#3b28c7', stroke: '#000', strokeWidth: 3 }}
                      name="My Contracts"
                    />
                    <Line
                      type="monotone"
                      data={teamAverageData}
                      dataKey="avg"
                      stroke="#06b6d4"
                      strokeWidth={3}
                      dot={false}
                      name="Team Avg"
                      strokeDasharray="6 6"
                    />
                    {/* Highlight today */}
                    {performanceData.map((d, i) => d.isToday && (
                      <ReferenceDot key={i} x={d.date} y={d.count} r={10} fill="#3b28c7" stroke="#000" strokeWidth={3} />
                    ))}
                    {/* Highlight this month */}
                    {(() => {
                      const first = performanceData.findIndex(d => d.isThisMonth);
                      const last = performanceData.map(d => d.isThisMonth).lastIndexOf(true);
                      if (first !== -1 && last !== -1 && last > first) {
                        return (
                          <ReferenceArea x1={performanceData[first].date} x2={performanceData[last].date} fill="#3b28c7" fillOpacity={0.07} />
                        );
                      }
                      return null;
                    })()}
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-gray-500">
                  <div className="text-center">
                    <div className="text-lg font-medium mb-2">No performance data available</div>
                    <div className="text-sm">Chart will appear when data is loaded</div>
                  </div>
                </div>
              )}
            </div>
            {/* Legend for My Contracts and Team Avg */}
            <div className="flex gap-6 mt-4 items-center">
              <div className="flex items-center gap-2">
                <span className="inline-block w-6 h-2 rounded-full" style={{ background: '#3b28c7' }}></span>
                <span className="text-base font-semibold text-gray-900">My Contracts</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-block w-6 h-2 rounded-full" style={{ background: '#06b6d4' }}></span>
                <span className="text-base font-semibold text-gray-900">Team Avg</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      {
        showLeadsList && (
          <div className="glass-card mt-6 p-6 shadow-lg rounded-2xl w-full max-w-full animate-fade-in">
            <div className="font-bold text-lg mb-4 text-base-content/80">My Signed Leads (Last 30 Days)</div>
            {realLeadsLoading ? (
              <div className="flex justify-center items-center py-12"><span className="loading loading-spinner loading-lg text-primary"></span></div>
            ) : realSignedLeads.length === 0 ? (
              <div className="text-center py-12 text-gray-500">No signed leads found in the last 30 days</div>
            ) : (
              <>
                {/* Desktop Table View */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="table w-full">
                    <thead>
                      <tr>
                        <th>Lead Number + Client Name</th>
                        <th>Category</th>
                        <th>Signed Agreement Date</th>
                        <th>Applicants</th>
                        <th>Value (Amount)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {realSignedLeads.map((lead) => (
                        <tr
                          key={lead.id}
                          className="hover:bg-gray-50 cursor-pointer"
                          onClick={() => window.location.href = `/clients/${lead.lead_number}`}
                        >
                          <td>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-semibold text-gray-400 tracking-widest">{lead.lead_number}</span>
                              <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                              <span className="font-semibold text-gray-900">{lead.name}</span>
                            </div>
                          </td>
                          <td>{lead.category}</td>
                          <td>{lead.signed_date ? new Date(lead.signed_date).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'N/A'}</td>
                          <td>{lead.applicants}</td>
                          <td className="font-semibold text-green-600">
                            {(lead.currency === 'NIS' ? '₪' : (lead.currency || '₪'))}{lead.value ? Number(lead.value).toLocaleString() : '0'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* Mobile Card View */}
                <div className="md:hidden flex flex-col gap-4">
                  {realSignedLeads.map((lead) => (
                    <div
                      key={lead.id}
                      className="bg-white rounded-xl p-4 shadow-md border border-gray-100 cursor-pointer hover:shadow-lg transition-shadow"
                      onClick={() => window.location.href = `/clients/${lead.lead_number}`}
                    >
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-xs font-semibold text-gray-400 tracking-widest">{lead.lead_number}</span>
                        <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                        <span className="font-semibold text-gray-900 flex-1">{lead.name}</span>
                      </div>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-500">Category:</span>
                          <span className="font-semibold">{lead.category}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Signed Date:</span>
                          <span className="font-semibold">{lead.signed_date ? new Date(lead.signed_date).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'N/A'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Applicants:</span>
                          <span className="font-semibold">{lead.applicants}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Value:</span>
                          <span className="font-semibold text-green-600">
                            {(lead.currency === 'NIS' ? '₪' : (lead.currency || '₪'))}{lead.value ? Number(lead.value).toLocaleString() : '0'}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )
      }


      {/* Scoreboard deals modal (Agreement signed / Invoiced count badges) */}
      <DashboardScoreboardDealsModal
        isOpen={scoreboardDealsModal != null}
        onClose={() => setScoreboardDealsModal(null)}
        title={
          scoreboardDealsModal
            ? `${scoreboardDealsModal.tableType === 'agreement' ? 'Agreement signed' : 'Invoiced'} · ${scoreboardDealsModal.departmentName}`
            : 'Deals'
        }
        subtitle={scoreboardDealsModal ? `Period: ${scoreboardDealsModal.period}` : undefined}
        roleColumn={scoreboardDealsModal?.tableType === 'invoiced' ? 'handler' : 'closer'}
        loading={
          scoreboardDealsModal
            ? scoreboardDealsModal.tableType === 'agreement'
              ? !agreementScoreboardDealsReady
              : !invoicedScoreboardDealsReady
            : false
        }
        deals={
          scoreboardDealsModal
            ? (
                (scoreboardDealsModal.tableType === 'agreement'
                  ? agreementScoreboardDeals
                  : invoicedScoreboardDeals
                ).get(
                  scoreboardDealsCellKey(
                    scoreboardDealsModal.period,
                    scoreboardDealsModal.departmentName,
                  ),
                ) ?? []
              )
            : []
        }
      />

      {/* Unavailable Employees Modal */}
      <UnavailableEmployeesModal
        isOpen={isUnavailableEmployeesModalOpen}
        onClose={() => setIsUnavailableEmployeesModalOpen(false)}
      />

      {/* Team Status Modal — superusers only */}
      {dashboardIsSuperuser && (
        <TeamStatusModal
          isOpen={isTeamStatusModalOpen}
          onClose={() => setIsTeamStatusModalOpen(false)}
        />
      )}

      {/* My Availability Modal - Mobile Only */}
      {
        isMyAvailabilityModalOpen && (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-black bg-opacity-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
                <h2 className="text-xl font-bold text-gray-900">My Availability</h2>
                <button
                  onClick={() => setIsMyAvailabilityModalOpen(false)}
                  className="btn btn-sm btn-ghost btn-circle"
                  title="Close"
                >
                  <XMarkIcon className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6">
                <MyAvailabilitySection
                  onAvailabilityChange={() => void loadTeamAvailability(teamAvailabilityDate, { background: true })}
                  onOpenUploadDocs={() => setIsSickDaysUploadModalOpen(true)}
                />
              </div>
            </div>
          </div>
        )
      }

      {/* Sick Days Document Upload Modal */}
      <SickDaysDocumentUploadModal
        isOpen={isSickDaysUploadModalOpen}
        onClose={() => setIsSickDaysUploadModalOpen(false)}
        onDocumentUploaded={() => {
          // Refresh availability data if needed
          void loadTeamAvailability(teamAvailabilityDate, { background: true });
        }}
      />

    </div>
    </>
  );
};

export default Dashboard;
