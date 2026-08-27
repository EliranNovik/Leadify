import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
    UserIcon,
    EnvelopeIcon,
    PhoneArrowUpRightIcon,
    ClipboardDocumentIcon,
    TagIcon,
    GlobeAltIcon,
    CurrencyDollarIcon,
    CalendarDaysIcon,
    ChartBarIcon,
    CheckCircleIcon,
    ExclamationTriangleIcon,
    DocumentDuplicateIcon,
    ArrowRightIcon,
    PencilIcon,
    ChevronDownIcon,
    ChevronRightIcon,
    PlayIcon,
    DocumentCheckIcon,
    NoSymbolIcon,
    StarIcon,
    PencilSquareIcon,
    Squares2X2Icon,
    TrashIcon,
    ArrowPathIcon,
    ChatBubbleLeftRightIcon,
    HandThumbUpIcon,
    HandThumbDownIcon,
    ClockIcon,
    ArchiveBoxIcon,
    EllipsisHorizontalIcon,
    EllipsisVerticalIcon,
    Bars3Icon,
    DocumentTextIcon,
    LinkIcon,
    FlagIcon,
    XMarkIcon,
    ShareIcon,
    MagnifyingGlassIcon,
    RectangleStackIcon,
    LockClosedIcon,
    DocumentArrowUpIcon,
    DocumentPlusIcon,
    BookmarkIcon,
} from '@heroicons/react/24/outline';
import { BookmarkIcon as BookmarkIconSolid } from '@heroicons/react/24/solid';
import { supabase } from '../lib/supabase';
import { isNonSelfLinkedMasterLead } from '../lib/masterLeadApi';
import toast from 'react-hot-toast';
import { getStageName, getStageColour, areStagesEquivalent, shouldShowAssignSchedulerField } from '../lib/stageUtils';
import { HEADER_ROLE_ASSIGN_WIDTH_CLASS } from './HeaderRoleAssignField';
import { addToHighlights, removeFromHighlights } from '../lib/highlightsUtils';
import { getUnactivationReasonFromId } from '../lib/unactivationReasons';
import CallOptionsModal from './CallOptionsModal';
import LeadTagsModal from './LeadTagsModal';
import { fetchLeadContacts } from '../lib/contactHelpers';
import {
    fetchActiveLeadSourceOptions,
    getSourceDisplayFromJoin,
    leadSourceIdForDb,
    lookupSourceNameById,
    normalizeLeadSourceId,
} from '../lib/leadSourceId';
import type { ContactInfo } from '../lib/contactHelpers';
import type { WhatsAppPageSelectedContact } from '../pages/WhatsAppPage';
import { FaWhatsapp } from 'react-icons/fa';
import { fetchUnpaidTotalsByCurrency, getVatRateForLegacyLead, pickUnpaidBaseAndVatForCurrency, pickUnpaidExpenseForCurrency, type UnpaidByCurrencyMap, type UnpaidExpenseByCurrencyMap } from '../lib/financeUnpaidTotal';
import { useAuthContext } from '../contexts/AuthContext';
import { createLeadShare, resolveAuthEmployeeId } from '../lib/leadShares';
import { buildCalendarClientRoute } from '../lib/calendarClientRoute';
import { fetchStageActorInfo } from '../lib/leadStageManager';
import { SubEffortsLogModal } from './SubEffortsLogModal';
// import { SubEffortsLogSidebar } from './SubEffortsLogSidebar';
import {
    ensureLeadSubEffortRows,
    dedupeLeadSubEffortRows,
    fetchSubEffortsForMiscCategory,
    fetchActiveSubEffortTemplates,
    addLeadSubEffortRow,
    removeLeadSubEffortRow,
    leadSubEffortIdentity,
    resolveLeadMiscCategoryId,
} from '../lib/leadSubEfforts';
import {
    fetchPublicUserId,
    fetchLeadFieldFlagsForLead,
    fetchFlagTypes,
    formatFlaggedAt,
    flagTypeLabel,
    flagTypeBadgeClass,
    flaggedModalViewButtonClass,
    type ContentFlagMeta,
    type FlagTypeRow,
} from '../lib/userContentFlags';
import { fetchRmqFlagCountForLead } from '../lib/rmqMessageLeadFlags';
import {
    dispatchScrollToPinnedInteraction,
    fetchLeadPinnedInteractions,
    PINNED_INTERACTIONS_CHANGED_EVENT,
    resolveLeadPinnedIdentity,
    unpinLeadInteractionById,
    type LeadPinnedInteractionRow,
} from '../lib/leadPinnedInteractions';
import { caseProbabilityFromFactors, type ProbabilitySlidersValues } from './client-tabs/ProbabilitySlidersModal';
import DocumentModal from './DocumentModal';
import { CLIENT_HEADER_ONEDRIVE_SUBFOLDER } from '../lib/leadOneDrivePaths';
import { parseLeadCurrencyId, resolveLeadCurrencyName } from '../lib/leadCurrencyDisplay';
import {
    ensureLeadCategories,
    ensureLeadLanguages,
    getCachedCategoriesSync,
    getCachedLanguagesSync,
    resolveLeadMetaChips,
    resolveLeadSourceName,
    writeResolvedLeadMeta,
} from '../lib/leadMetaDisplay';
import ClientHeaderTotalInNis from './ClientHeaderTotalInNis';
import EditLeadDrawer from './EditLeadDrawer';
import MobileBottomSheet from './MobileBottomSheet';
import EditFieldModal, {
    EDIT_FIELD_DROPDOWN,
    EDIT_FIELD_DROPDOWN_ITEM,
    EDIT_FIELD_INPUT,
    EditFieldLabel,
} from './EditFieldModal';
import ClientPortalAdminCard from './portal/ClientPortalAdminCard';
import LeadEmployeeCostModal from './LeadEmployeeCostModal';
import PinnedInteractionsModal from './PinnedInteractionsModal';
import LeadRemainingTimeBar from './LeadRemainingTimeBar';
import LeadOverBudgetGateModal, {
    LeadBudgetExtensionRequestModal,
} from './LeadOverBudgetGateModal';
import {
    fetchLeadEmployeeCostSummary,
    fetchLeadPaymentPlanBaseTotalNis,
    resolveLeadIdentityForCost,
    resolveLeadTotalValueNis,
    type LeadEmployeeCostSummary,
} from '../lib/leadEmployeeCost';
import { LEAD_ALLOCATION_SAVED_EVENT } from '../lib/employeeLeadReporting';
import {
    createLeadBudgetExtensionRequest,
} from '../lib/leadBudgetExtensionRequests';
import {
    fetchFirmPaidExpenseReductionTotal,
    fetchFirmPaidExpenseReductionTotalNis,
    resolveLeadFeeIdentity,
} from '../lib/leadExpenses';
import {
    clientsTabCacheLeadKey,
    readClientsTabCache,
    writeClientsTabCache,
} from '../lib/clientsTabCache';

type ClientHeaderCostCacheSlice = {
    summary: LeadEmployeeCostSummary | null;
    firmPaidExpenseTotal?: number;
    /** Last painted Total badge (after fees/expenses) — used so refresh does not flash the unlocked lead total. */
    displayMainAmount?: number;
    displayVatAmount?: number;
    displayHasPlan?: boolean;
};

function patchHeaderCostCache(
    leadKey: string | null | undefined,
    patch: Partial<ClientHeaderCostCacheSlice>,
) {
    const prev = readClientsTabCache<ClientHeaderCostCacheSlice>(leadKey, 'header');
    writeClientsTabCache(leadKey, 'header', {
        summary: patch.summary !== undefined ? patch.summary : prev?.summary ?? null,
        firmPaidExpenseTotal:
            patch.firmPaidExpenseTotal !== undefined
                ? patch.firmPaidExpenseTotal
                : prev?.firmPaidExpenseTotal,
        displayMainAmount:
            patch.displayMainAmount !== undefined ? patch.displayMainAmount : prev?.displayMainAmount,
        displayVatAmount:
            patch.displayVatAmount !== undefined ? patch.displayVatAmount : prev?.displayVatAmount,
        displayHasPlan:
            patch.displayHasPlan !== undefined ? patch.displayHasPlan : prev?.displayHasPlan,
    });
}

function unlockedLeadContractBase(selectedClient: any): number {
    const isLegacyLead = selectedClient?.id?.toString().startsWith('legacy_');
    const numericCurrencyId = parseLeadCurrencyId(selectedClient?.currency_id) ?? 1;
    if (isLegacyLead) {
        return numericCurrencyId === 1
            ? Number(selectedClient?.total_base ?? 0)
            : Number(selectedClient?.total ?? 0);
    }
    return Number(selectedClient?.balance || selectedClient?.proposal_total || 0) || 0;
}

// Lightweight in-memory caches to avoid refetching static dropdown data on mobile.
let cachedLeadSources: Array<{ id: string; name: string }> | null = null;
let cachedLeadSourcesPromise: Promise<Array<{ id: string; name: string }>> | null = null;

// Resolved { sourceId, name } per lead id. Lets us show a lead's source instantly when navigating
// back and skip re-running the source_id DB fetch for a lead we've already resolved this session.
type ResolvedLeadSource = { sourceId: string | null; name: string | null } | null;
const resolvedLeadSourceCache = new Map<string, ResolvedLeadSource>();

// Per-lead caches for the header's tag / flag count badges, so they render instantly when navigating
// back instead of flickering up from empty/0 while their async fetches run.
const leadTagsCache = new Map<string, string[]>();
const leadFieldFlagMetaCache = new Map<string, Map<string, ContentFlagMeta>>();
const rmqMessageFlagCountCache = new Map<string, number>();

/** Stage 105 banner: hide while loading (null); show missing only when explicitly false. */
function shouldShowHandlerPaymentBanner(
  hasPaymentPlan: boolean | null | undefined,
  nextDuePayment: unknown
): boolean {
  if (hasPaymentPlan === null || hasPaymentPlan === undefined) return false;
  if (hasPaymentPlan === false) return true;
  return Boolean(nextDuePayment);
}

function isMissingPaymentPlanBanner(hasPaymentPlan: boolean | null | undefined): boolean {
  return hasPaymentPlan === false;
}

let cachedCurrencies: Array<{ id: number | string; name: string; iso_code: string | null }> | null = null;
let cachedCurrenciesPromise: Promise<
  Array<{ id: number | string; name: string; iso_code: string | null }>
> | null = null;


const leadFieldFlagLabel = (key: string): string => {
    const map: Record<string, string> = {
        expert_notes: 'Expert opinion',
        handler_notes: 'Handler opinion',
    };
    return map[key] ?? key.replace(/_/g, ' ');
};

const normalizeTagsValue = (value: unknown): string[] => {
    if (!value) return [];
    if (Array.isArray(value)) {
        return value
            .map((item) => String(item || '').trim())
            .filter(Boolean);
    }
    return String(value)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
};

/** External Firms report — shared header / panel styling */
const CLIENT_HEADER_CARD = 'rounded-[18px] bg-white shadow-sm px-4 py-3.5 sm:px-5 sm:py-4';
const CLIENT_HEADER_SHELL = `${CLIENT_HEADER_CARD} w-full`;
/** Clears fixed app Header on mobile (clients-detail-scroll sets main padding-top: 0). */
const CLIENT_HEADER_APP_INSET_MOBILE =
    'pt-[calc(env(safe-area-inset-top,0px)+2.75rem+1.75rem)]';
/**
 * Clear floating staff sidebar: left-4 (1rem) + w-20 (5rem) + gap.
 * Use pl-* only (not px-*) so page right-padding utilities never override left inset.
 */
const CLIENT_HEADER_SIDEBAR_PAD = 'md:pl-40';
/**
 * Clear fixed client tab rail (4.75rem collapsed) plus the same horizontal inset as
 * Clients tab content (`md:px-5` / `lg:px-6` / `xl:px-8`) so header actions
 * line up with the cards below.
 */
const CLIENT_HEADER_NAV_RAIL_PAD =
    'md:pl-[calc(4.75rem+1.25rem)] lg:pl-[calc(4.75rem+1.5rem)] xl:pl-[calc(4.75rem+2rem)]';
/** Right + mobile left page padding — never sets md:pl so sidebar pad stays intact. */
const CLIENT_HEADER_PAGE_X = 'pl-3 pr-3 sm:pl-4 sm:pr-4 md:pr-6 lg:pr-8 xl:pr-10';
/** Right-only page padding when left inset already includes content gutter (nav rail). */
const CLIENT_HEADER_PAGE_X_WITH_RAIL = 'pr-3 sm:pr-4 md:pr-5 lg:pr-6 xl:pr-8';
/**
 * Desktop top strip — edge-to-edge white.
 * Uses a dedicated spacer for the fixed navbar height so the name never sits under it.
 */
const CLIENT_HEADER_TOP_BAND = 'client-header-top-band w-full bg-white dark:bg-base-100';

const CLIENT_HEADER_SECTION_LABEL =
    'text-[11px] font-semibold uppercase tracking-widest text-base-content/40';

const TEAM_ROLE_LABEL =
    'text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-base-content/45';
const CLIENT_HEADER_INNER_PANEL = CLIENT_HEADER_CARD;

/** Light grey pills for language, source, category, topic (below header box). */
const META_BADGE_WHITE =
    'inline-flex max-w-full min-w-0 shrink-0 items-center gap-2 rounded-[18px] bg-gray-100 px-3.5 py-2.5 text-sm font-medium text-gray-500 shadow-none border-0 dark:bg-base-200 dark:text-base-content/55';

const META_BADGE_WHITE_BTN =
    `${META_BADGE_WHITE} font-sans transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/50 cursor-pointer hover:shadow-md`;

/** Compact chips — light grey, larger icons than stage buttons. */
const META_BADGE_CONNECTED =
    'inline-flex max-w-full min-w-0 shrink-0 items-center gap-2 rounded-full border-0 bg-gray-100 px-3 py-2 text-[13px] font-medium text-gray-500 shadow-none dark:bg-base-200 dark:text-base-content/55';

const META_BADGE_CONNECTED_BTN =
    `${META_BADGE_CONNECTED} font-sans transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/50 cursor-pointer hover:bg-gray-200 dark:hover:bg-base-200`;

const CLIENT_HEADER_LEAD_NUMBER =
    'mt-0 block text-sm font-medium tabular-nums text-gray-500 dark:text-base-content/45';

const META_ICON_LANGUAGE = 'h-6 w-6 shrink-0 text-sky-600';
const META_ICON_SOURCE = 'h-6 w-6 shrink-0 text-violet-600';
const META_ICON_CATEGORY = 'h-6 w-6 shrink-0 text-amber-600';
const META_ICON_TOPIC = 'h-6 w-6 shrink-0 text-emerald-600';
const META_ICON_APPLICANTS = 'h-6 w-6 shrink-0 text-rose-600';

const HEADER_ACTION_ICON = 'h-6 w-6 shrink-0';

/** Perfect circle badge for each header action icon. overflow-visible so count badges aren’t clipped. */
const HEADER_ACTION_BAR_ROUND_BADGE =
    'btn btn-circle btn-ghost aspect-square pointer-events-auto relative !h-12 !w-12 !min-h-12 !min-w-12 !max-h-12 !max-w-12 shrink-0 !overflow-visible border border-base-200/50 !bg-white !p-0 text-base-content/75 shadow-sm transition-colors duration-150 dark:border-base-300/45 dark:!bg-base-100';

const HEADER_ACTION_BAR_CALL_BTN =
    `${HEADER_ACTION_BAR_ROUND_BADGE} hover:!bg-gray-100 hover:text-gray-800 dark:hover:!bg-gray-700/55 dark:hover:text-gray-100`;

const HEADER_ACTION_BAR_WHATSAPP_BTN =
    `${HEADER_ACTION_BAR_ROUND_BADGE} text-emerald-700 hover:!bg-emerald-50 hover:text-emerald-800 dark:text-emerald-300 dark:hover:!bg-emerald-900/35`;

const HEADER_ACTION_BAR_EMAIL_BTN =
    `${HEADER_ACTION_BAR_ROUND_BADGE} text-sky-700 hover:!bg-sky-50 hover:text-sky-800 dark:text-sky-300 dark:hover:!bg-sky-900/35`;

const HEADER_ACTION_BAR_DOCS_BTN =
    `${HEADER_ACTION_BAR_ROUND_BADGE} hover:!bg-indigo-50 hover:text-indigo-700 dark:hover:!bg-indigo-900/30 dark:hover:text-indigo-200`;

const HEADER_ACTION_BAR_TIMELINE_BTN =
    `${HEADER_ACTION_BAR_ROUND_BADGE} hover:!bg-cyan-50 hover:text-cyan-800 dark:hover:!bg-cyan-900/30 dark:hover:text-cyan-200`;

const HEADER_ACTION_BAR_HISTORY_BTN =
    `${HEADER_ACTION_BAR_ROUND_BADGE} hover:!bg-slate-100 hover:text-slate-800 dark:hover:!bg-slate-700/55 dark:hover:text-slate-100`;

/** Round badge for the header actions menu trigger (aligned with meta chips). */
const HEADER_ACTIONS_MENU_TRIGGER =
    'btn btn-circle btn-ghost aspect-square pointer-events-auto relative z-[1] !h-10 !w-10 !min-h-10 !min-w-10 !max-h-10 !max-w-10 shrink-0 !overflow-visible border border-neutral-200 !bg-white !p-0 text-black shadow-sm transition-colors duration-150 hover:!bg-neutral-100 sm:!h-11 sm:!w-11 sm:!min-h-11 sm:!min-w-11';

const HEADER_ACTIONS_MENU_TRIGGER_CONNECTED =
    'btn btn-circle btn-ghost aspect-square pointer-events-auto relative z-[1] !h-9 !w-9 !min-h-9 !min-w-9 !max-h-9 !max-w-9 shrink-0 !overflow-visible border-0 !bg-neutral-200 !p-0 text-black shadow-none transition-colors duration-150 hover:!bg-neutral-300';

const HEADER_ACTIONS_FAB_BTN =
    'btn btn-circle btn-ghost aspect-square relative !h-11 !w-11 !min-h-11 !min-w-11 !max-h-11 !max-w-11 shrink-0 !overflow-visible !p-0 shadow-md backdrop-blur-md transition-none';

const HEADER_ACTIONS_FAB_LABEL =
    'pointer-events-none inline-flex max-w-[9.5rem] shrink-0 items-center rounded-full border px-2.5 py-1 text-xs font-semibold text-white shadow-md backdrop-blur-md';

const HEADER_ACTIONS_DROPDOWN_PANEL =
    'absolute right-5 top-3 z-50 origin-top-right overflow-visible sm:right-5 xl:right-10';

/** Clears the fixed-navbar spacer inside `.client-header-top-band`. */
const HEADER_ACTIONS_DROPDOWN_PANEL_CONNECTED =
    'absolute right-5 top-[5.25rem] z-50 origin-top-right overflow-visible sm:right-5 xl:right-10';

const HEADER_ACTIONS_DROPDOWN_PANEL_ATTACHED =
    'absolute right-0 top-[calc(100%+0.5rem)] z-50 origin-top-right overflow-visible';

const HEADER_ACTIONS_FAB_TONE: Record<
    'violet' | 'slate' | 'emerald' | 'sky' | 'cyan' | 'indigo' | 'purple' | 'amber' | 'orange',
    { btn: string; label: string }
> = {
    violet: {
        btn: '!bg-violet-500/30 border-violet-200/55 text-violet-900 dark:text-violet-100',
        label: 'border-violet-200/30 bg-violet-950/55',
    },
    slate: {
        btn: '!bg-slate-500/25 border-slate-200/55 text-slate-900 dark:text-slate-100',
        label: 'border-slate-200/30 bg-slate-950/55',
    },
    emerald: {
        btn: '!bg-emerald-500/30 border-emerald-200/55 text-emerald-900 dark:text-emerald-100',
        label: 'border-emerald-200/30 bg-emerald-950/55',
    },
    sky: {
        btn: '!bg-sky-500/30 border-sky-200/55 text-sky-900 dark:text-sky-100',
        label: 'border-sky-200/30 bg-sky-950/55',
    },
    cyan: {
        btn: '!bg-cyan-500/30 border-cyan-200/55 text-cyan-900 dark:text-cyan-100',
        label: 'border-cyan-200/30 bg-cyan-950/55',
    },
    indigo: {
        btn: '!bg-indigo-500/30 border-indigo-200/55 text-indigo-900 dark:text-indigo-100',
        label: 'border-indigo-200/30 bg-indigo-950/55',
    },
    purple: {
        btn: '!bg-purple-500/30 border-purple-200/55 text-purple-900 dark:text-purple-100',
        label: 'border-purple-200/30 bg-purple-950/55',
    },
    amber: {
        btn: '!bg-amber-500/30 border-amber-200/55 text-amber-950 dark:text-amber-100',
        label: 'border-amber-200/30 bg-amber-950/55',
    },
    orange: {
        btn: '!bg-orange-500/30 border-orange-200/55 text-orange-950 dark:text-orange-100',
        label: 'border-orange-200/30 bg-orange-950/55',
    },
};

/** Continuous dock magnification from fractional hover position (scale only). */
function headerActionsDockScale(hoveredIndex: number | null, index: number): number {
    if (hoveredIndex == null) return 1;
    const distance = Math.abs(index - hoveredIndex);
    const waveRadius = 1.65;
    if (distance >= waveRadius) return 1;
    const t = distance / waveRadius;
    const wave = Math.cos(t * (Math.PI / 2));
    return 1 + 0.36 * wave * wave;
}

const HEADER_ACTIONS_DOCK_TRANSITION_RESET =
    'transform 160ms cubic-bezier(0.33, 1, 0.68, 1)';

const HEADER_ACTION_BAR_BTN = HEADER_ACTION_BAR_ROUND_BADGE;

const CONTACT_MODAL_LINK =
    'inline-flex items-center gap-1 text-sm font-medium text-base-content/65 transition-colors hover:text-primary';

const CONTACT_MODAL_LINK_WHATSAPP =
    'inline-flex items-center gap-1 text-sm font-medium text-emerald-600 transition-colors hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300';

const HEADER_TAGS_BTN_CLASS =
    'btn btn-circle btn-ghost relative shrink-0 !overflow-visible border border-purple-200/80 bg-purple-50 text-purple-700 hover:border-purple-300 hover:bg-purple-100 min-h-[2.5rem] min-w-[2.5rem] p-0 dark:border-purple-800/50 dark:bg-purple-900/30 dark:text-purple-200 dark:hover:bg-purple-900/45 md:min-h-[2.75rem] md:min-w-[2.75rem]';

const HEADER_FLAGS_BTN_CLASS =
    'btn btn-circle btn-ghost relative shrink-0 !overflow-visible border border-amber-200/80 bg-amber-50 text-amber-700 hover:border-amber-300 hover:bg-amber-100 min-h-[2.5rem] min-w-[2.5rem] p-0 disabled:pointer-events-none disabled:opacity-40 dark:border-amber-800/50 dark:bg-amber-900/30 dark:text-amber-300 dark:hover:bg-amber-900/45 md:min-h-[2.75rem] md:min-w-[2.75rem]';

const HEADER_ACTION_BAR_TAGS_BTN =
    `${HEADER_ACTION_BAR_ROUND_BADGE} text-purple-700 hover:!bg-purple-50 hover:text-purple-800 dark:text-purple-300 dark:hover:!bg-purple-900/30`;

const HEADER_ACTION_BAR_FLAGS_BTN =
    `${HEADER_ACTION_BAR_ROUND_BADGE} disabled:pointer-events-none disabled:opacity-40 text-amber-700 hover:!bg-amber-50 hover:text-amber-800 dark:text-amber-300 dark:hover:!bg-amber-900/30`;

const HEADER_ACTION_BAR_DUPLICATES_BTN =
    `${HEADER_ACTION_BAR_ROUND_BADGE} text-orange-700 hover:!bg-orange-50 hover:text-orange-800 dark:text-orange-300 dark:hover:!bg-orange-900/30`;

const HEADER_DUPLICATES_BTN_CLASS =
    'btn btn-circle btn-ghost relative shrink-0 !overflow-visible border border-orange-200/80 bg-orange-50 text-orange-700 hover:border-orange-300 hover:bg-orange-100 min-h-[2.5rem] min-w-[2.5rem] p-0 dark:border-orange-800/50 dark:bg-orange-900/30 dark:text-orange-300 dark:hover:bg-orange-900/45 md:min-h-[2.75rem] md:min-w-[2.75rem]';

const MORE_ACTIONS_SECTION_LABEL =
    'px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500';

const MORE_ACTIONS_SHEET_ITEM =
    'client-actions-drawer-item group flex w-full items-center gap-3 rounded-xl border border-transparent px-3 py-3 text-left text-[15px] font-medium leading-snug text-black';

const MORE_ACTIONS_ICON_BOX =
    'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-black';

const ACTIONS_DRAWER_COUNT =
    'ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-black px-1.5 text-[11px] font-semibold text-white';

const MORE_ACTIONS_ICON_TONE_DEFAULT =
    'bg-base-200/70 text-base-content/70 group-hover:bg-base-200 dark:group-hover:bg-base-300/50';

const MORE_ACTIONS_ICON_TONE_SUCCESS =
    'bg-emerald-50 text-emerald-700 group-hover:bg-emerald-100 dark:bg-emerald-900/25 dark:text-emerald-300';

const MORE_ACTIONS_ICON_TONE_DANGER =
    'bg-red-50 text-red-600 group-hover:bg-red-100 dark:bg-red-900/25 dark:text-red-400';

const MORE_ACTIONS_ICON_TONE_WARNING =
    'bg-amber-50 text-amber-800 group-hover:bg-amber-100 dark:bg-amber-900/25 dark:text-amber-300';

const MORE_ACTIONS_ICON_TONE_PRIMARY =
    'bg-indigo-50 text-indigo-700 group-hover:bg-indigo-100 dark:bg-indigo-900/25 dark:text-indigo-300';

const MORE_ACTIONS_ICON_TONE_PURPLE =
    'bg-purple-50 text-purple-700 group-hover:bg-purple-100 dark:bg-purple-900/25 dark:text-purple-300';

const HEADER_ACTION_SHEET_ICON_TONE: Record<
    'violet' | 'slate' | 'emerald' | 'sky' | 'cyan' | 'indigo' | 'purple' | 'amber' | 'orange',
    string
> = {
    violet: MORE_ACTIONS_ICON_TONE_PURPLE,
    slate: MORE_ACTIONS_ICON_TONE_DEFAULT,
    emerald: MORE_ACTIONS_ICON_TONE_SUCCESS,
    sky: MORE_ACTIONS_ICON_TONE_PRIMARY,
    cyan: MORE_ACTIONS_ICON_TONE_DEFAULT,
    indigo: MORE_ACTIONS_ICON_TONE_PRIMARY,
    purple: MORE_ACTIONS_ICON_TONE_PURPLE,
    amber: MORE_ACTIONS_ICON_TONE_WARNING,
    orange: MORE_ACTIONS_ICON_TONE_WARNING,
};

/** Stage workflow actions — soft purple oval pills (same tone as date/meta chips). */
const STAGE_ACTION_BTN_BASE =
    'inline-flex items-center justify-center gap-2 min-h-10 !overflow-visible rounded-full px-5 py-2 text-sm font-semibold whitespace-nowrap border-0 shadow-none transition-colors duration-150';

const STAGE_ACTION_BTN_CLASS =
    `${STAGE_ACTION_BTN_BASE} bg-gray-200 text-gray-500 hover:bg-gray-300 dark:bg-base-300 dark:text-base-content/55 dark:hover:bg-base-200`;

const STAGE_ACTION_BTN_CLASS_COMPACT = STAGE_ACTION_BTN_CLASS;

const HEADER_PINNED_BTN_CLASS =
    'inline-flex h-10 w-10 shrink-0 items-center justify-center relative !overflow-visible rounded-full border-0 bg-gray-200 text-sky-700 shadow-none transition-colors duration-150 hover:bg-gray-300 dark:bg-base-300 dark:text-sky-300 dark:hover:bg-base-200';

const CLIENT_SIGNED_STAGE_BTN_CLASS =
    `${STAGE_ACTION_BTN_BASE} bg-gray-200 text-gray-500 hover:bg-gray-300 dark:bg-base-300 dark:text-base-content/55 dark:hover:bg-base-200`;

const CLIENT_DECLINED_STAGE_BTN_CLASS =
    `${STAGE_ACTION_BTN_BASE} bg-gray-200 text-gray-500 hover:bg-gray-300 dark:bg-base-300 dark:text-base-content/55 dark:hover:bg-base-200`;

const CLIENT_SIGNED_STAGE_BTN_COMPACT = CLIENT_SIGNED_STAGE_BTN_CLASS;

const CLIENT_DECLINED_STAGE_BTN_COMPACT = CLIENT_DECLINED_STAGE_BTN_CLASS;

interface ClientHeaderProps {
    selectedClient: any;
    refreshClientData: (clientId: number | string) => Promise<void>;
    /** True while a background server refresh is in flight (e.g. cache-first load on mobile). */
    isClientSyncing?: boolean;
    isSubLead?: boolean;
    masterLeadNumber?: string | null;
    isMasterLead?: boolean;
    subLeadsCount?: number;
    nextDuePayment?: any;
    setIsBalanceModalOpen: (isOpen: boolean) => void;
    currentStageName: string;
    handleStartCase: () => void;
    updateLeadStage: (newStage: string | number) => Promise<void>;
    isInHighlightsState: boolean;
    isSuperuser: boolean;
    setShowDeleteModal: (show: boolean) => void;
    duplicateContacts: any[];
    setIsDuplicateDropdownOpen: (isOpen: boolean) => void;
    isDuplicateDropdownOpen: boolean;
    setShowSubLeadDrawer: (show: boolean) => void;
    /** @deprecated Use built-in edit drawer; kept for pages that host their own drawer */
    openEditLeadDrawer?: () => void;
    /** Notifies parent when the header-hosted edit drawer opens/closes */
    onEditLeadDrawerOpenChange?: (open: boolean) => void;
    /** Increment from parent (e.g. nav rail Edit) to open the header-hosted edit drawer */
    editLeadOpenRequest?: number;
    handleActivation: () => void;
    setShowUnactivationModal: (show: boolean) => void;
    renderStageBadge: (anchor?: 'badge' | 'mobile' | 'desktop') => React.ReactNode;
    getEmployeeDisplayName: (id: string | null | undefined) => string;
    allEmployees?: any[];
    dropdownsContent?: React.ReactNode;
    /** Inline assign-scheduler field (Created / Precommunication) — replaces stage action buttons. */
    assignSchedulerContent?: React.ReactNode;
    dropdownItems?: React.ReactNode;
    // Additional handlers for stage actions
    handlePaymentReceivedNewClient?: () => void;
    handleScheduleMenuClick?: () => void;
    handleStageUpdate?: (newStage: string) => Promise<void>;
    openSendOfferModal?: () => void;
    handleOpenSignedDrawer?: () => void;
    handleOpenDeclinedDrawer?: () => void;
    setShowRescheduleDrawer?: (show: boolean) => void;
    scheduleMenuLabel?: string;
    /** Top-left stage-row Schedule Meeting button (post stage 60). Triggers the MeetingTab Schedule drawer. */
    onMeetingScheduleClick?: () => void;
    /** Top-left stage-row Reschedule Meeting button (post stage 60). Triggers the MeetingTab Reschedule drawer. */
    onMeetingRescheduleClick?: () => void;
    hasScheduledMeetings?: boolean;
    isStageNumeric?: boolean;
    stageNumeric?: number;
    /** When true, hides Timeline and History buttons (e.g. external user modal) */
    hideHistoryAndTimeline?: boolean;
    /** When true, hides the Actions dropdown (cog icon) (e.g. external user modal) */
    hideActionsDropdown?: boolean;
    /** When true, hides the Total Value badge (e.g. external user modal) */
    hideTotalValueBadge?: boolean;
    /** When true, Total Value is driven by payment plan and locked. null = still loading. */
    hasPaymentPlan?: boolean | null;
    /** Sum of payment plan base (lead currency) when locked. */
    paymentPlanBaseTotal?: number | null;
    /** Sum of payment plan VAT (lead currency) when locked. */
    paymentPlanVatTotal?: number | null;
    /** Sum of expense (no VAT) payment rows (lead currency) when locked. */
    paymentPlanExpenseNoVatTotal?: number | null;
    /** When true, category is display-only and does not open the category modal on click (e.g. external user modal) */
    disableCategoryModal?: boolean;
    /** Opens the Combine leads modal (this lead as master, link another lead to it) */
    onCombineLeads?: () => void;
    /** Opens app WhatsApp modal for this lead (contact match or lead phone) */
    onOpenWhatsAppForContact?: (payload: WhatsAppPageSelectedContact) => void;
    /** Count of flagged Interactions timeline rows (from Interactions tab when loaded). */
    flaggedConversationCount?: number;
    /** Switch client detail tab (e.g. expert, interactions) for flagged-item navigation. */
    onSwitchClientTab?: (tabId: string) => void;
    /** Pending case probability after choosing “conversation” on high-probability gate; save when user flags a message. */
    pendingProbabilityValues?: ProbabilitySlidersValues | null;
    pendingProbabilitySaving?: boolean;
    onDismissPendingProbability?: () => void;
    /** Flush layout on client detail page: no outer white band, aligned page padding. */
    connectToAppHeader?: boolean;
    /**
     * When set with connectToAppHeader, places this nav flush under the white top band
     * with header actions + children in the column to its right.
     */
    navRail?: React.ReactNode;
    /** Rendered beside navRail under the white top band (e.g. client tab content). */
    children?: React.ReactNode;
    /**
     * When false, hides the stage-105 missing-plan / next-payment banner in the header
     * (Clients shows it next to tab titles instead). Default true for modals.
     */
    showHandlerPaymentBanner?: boolean;
}

const ClientHeader: React.FC<ClientHeaderProps> = ({
    selectedClient,
    refreshClientData,
    isClientSyncing = false,
    isSubLead,
    masterLeadNumber,
    isMasterLead,
    subLeadsCount,
    nextDuePayment,
    setIsBalanceModalOpen,
    currentStageName,
    handleStartCase,
    updateLeadStage,
    isInHighlightsState,
    isSuperuser,
    setShowDeleteModal,
    duplicateContacts,
    setIsDuplicateDropdownOpen,
    isDuplicateDropdownOpen,
    setShowSubLeadDrawer,
    openEditLeadDrawer: openEditLeadDrawerProp,
    onEditLeadDrawerOpenChange,
    editLeadOpenRequest = 0,
    handleActivation,
    setShowUnactivationModal,
    renderStageBadge,
    getEmployeeDisplayName,
    allEmployees = [],
    dropdownsContent,
    assignSchedulerContent,
    dropdownItems,
    handlePaymentReceivedNewClient,
    handleScheduleMenuClick,
    handleStageUpdate,
    openSendOfferModal,
    handleOpenSignedDrawer,
    handleOpenDeclinedDrawer,
    setShowRescheduleDrawer,
    scheduleMenuLabel,
    onMeetingScheduleClick,
    onMeetingRescheduleClick,
    hasScheduledMeetings,
    isStageNumeric,
    stageNumeric,
    hideHistoryAndTimeline = false,
    hideActionsDropdown = false,
    hideTotalValueBadge = false,
    hasPaymentPlan = null,
    paymentPlanBaseTotal = null,
    paymentPlanVatTotal = null,
    paymentPlanExpenseNoVatTotal = null,
    disableCategoryModal = false,
    onCombineLeads,
    onOpenWhatsAppForContact,
    flaggedConversationCount = 0,
    onSwitchClientTab,
    pendingProbabilityValues = null,
    pendingProbabilitySaving = false,
    onDismissPendingProbability,
    connectToAppHeader = false,
    navRail = null,
    children = null,
    showHandlerPaymentBanner = true,
}) => {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const sidebarPadClass = navRail ? CLIENT_HEADER_NAV_RAIL_PAD : CLIENT_HEADER_SIDEBAR_PAD;
    const pagePadClass = navRail ? CLIENT_HEADER_PAGE_X_WITH_RAIL : CLIENT_HEADER_PAGE_X;
    const [subEfforts, setSubEfforts] = useState<Array<{ id: number; name: string; sort_order: number }>>([]);
    const [isLoadingSubEfforts, setIsLoadingSubEfforts] = useState(false);
    const [leadSubEfforts, setLeadSubEfforts] = useState<any[]>([]);
    const [isLoadingLeadSubEfforts, setIsLoadingLeadSubEfforts] = useState(false);
    const [isSubEffortsModalOpen, setIsSubEffortsModalOpen] = useState(false);
    const [subEffortsModalRowId, setSubEffortsModalRowId] = useState<string | number | null>(null);
    const [initialClientUploadsOpen, setInitialClientUploadsOpen] = useState(false);
    const [subEffortAddOptions, setSubEffortAddOptions] = useState<
        Array<{ id: number; name: string; sort_order: number; default_client_visible: boolean }>
    >([]);
    const [isLoadingSubEffortAddOptions, setIsLoadingSubEffortAddOptions] = useState(false);
    const [isAddingLeadSubEffort, setIsAddingLeadSubEffort] = useState(false);
    const [isRemovingLeadSubEffort, setIsRemovingLeadSubEffort] = useState(false);
    const subEffortsProvisionKeyRef = useRef<string | null>(null);
    const subEffortsFetchInFlightRef = useRef(false);
    const [editLeadDrawerOpen, setEditLeadDrawerOpen] = useState(false);
    const [clientPortalModalOpen, setClientPortalModalOpen] = useState(false);
    const [moreActionsSheetOpen, setMoreActionsSheetOpen] = useState(false);
    const [headerActionsMenuOpen, setHeaderActionsMenuOpen] = useState(false);
    const [sharePanelOpen, setSharePanelOpen] = useState(false);
    const [shareSearch, setShareSearch] = useState('');
    const [shareSelectedEmployeeId, setShareSelectedEmployeeId] = useState<number | null>(null);
    const [shareSubmitting, setShareSubmitting] = useState(false);
    const [currentShareEmployeeId, setCurrentShareEmployeeId] = useState<number | null>(null);
    const [inactiveNotesExpanded, setInactiveNotesExpanded] = useState(false);
    const headerActionsMenuRef = useRef<HTMLDivElement | null>(null);

    const closeMoreActionsSheet = useCallback(() => setMoreActionsSheetOpen(false), []);
    const closeHeaderActionsMenu = useCallback(() => {
        setHeaderActionsMenuOpen(false);
        setSharePanelOpen(false);
        setShareSearch('');
        setShareSelectedEmployeeId(null);
    }, []);
    const toggleHeaderActionsMenu = useCallback(
        () => setHeaderActionsMenuOpen((open) => !open),
        [],
    );

    const setEditLeadDrawerOpenState = useCallback(
        (open: boolean) => {
            setEditLeadDrawerOpen(open);
            onEditLeadDrawerOpenChange?.(open);
        },
        [onEditLeadDrawerOpenChange],
    );

    const handleOpenEditLeadDrawer = useCallback(() => {
        if (openEditLeadDrawerProp) {
            openEditLeadDrawerProp();
        } else {
            setEditLeadDrawerOpenState(true);
        }
    }, [openEditLeadDrawerProp, setEditLeadDrawerOpenState]);

    useEffect(() => {
        if (!editLeadOpenRequest) return;
        handleOpenEditLeadDrawer();
    }, [editLeadOpenRequest, handleOpenEditLeadDrawer]);

    const [isEditingCategory, setIsEditingCategory] = useState(false);
    /** Unpaid finance plan totals by currency (from payment_plans / finances_paymentplanrow, excludes paid rows). */
    const [unpaidByCurrency, setUnpaidByCurrency] = useState<UnpaidByCurrencyMap | null>(null);
    const [unpaidExpenseByCurrency, setUnpaidExpenseByCurrency] = useState<UnpaidExpenseByCurrencyMap | null>(null);
    const togglingActiveHandlerRef = useRef(false);
    type ActiveRoleRevealState = {
        activeType: 1 | 2;
        employeeId: string | number | null;
        displayName: string;
        roleTitle: string;
    };
    const [activeRoleReveal, setActiveRoleReveal] = useState<ActiveRoleRevealState | null>(null);
    const [activeRoleRevealEntered, setActiveRoleRevealEntered] = useState(false);
    const activeRoleRevealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const activeRoleRevealRafRef = useRef<number | null>(null);
    /** Always latest lead row — `updateActiveHandlerType` must not close over stale `active_handler_type` (stable useCallback deps). */
    const selectedClientRef = useRef(selectedClient);
    /** Bumped after a successful active-handler toggle so avatar ring flash replays. */
    const [handlerActiveRingNonce, setHandlerActiveRingNonce] = useState(0);
    const [headerFinancialDetailsOpen, setHeaderFinancialDetailsOpen] = useState(false);
    const [leadEmployeeCostSummary, setLeadEmployeeCostSummary] =
        useState<LeadEmployeeCostSummary | null>(() => {
            const key = clientsTabCacheLeadKey(selectedClient);
            return readClientsTabCache<ClientHeaderCostCacheSlice>(key, 'header')?.summary ?? null;
        });
    const [leadEmployeeCostLoading, setLeadEmployeeCostLoading] = useState(false);
    /** Bumped when a daily lead allocation is saved so cost / time-left refetch. */
    const [leadAllocationCostRefreshNonce, setLeadAllocationCostRefreshNonce] = useState(0);
    /** Firm-paid expenses (amount + VAT) — reduce Total; client-paid do not. Net shows full total without fees/expenses. */
    const [firmPaidExpenseTotal, setFirmPaidExpenseTotal] = useState(() => {
        const key = clientsTabCacheLeadKey(selectedClient);
        return readClientsTabCache<ClientHeaderCostCacheSlice>(key, 'header')?.firmPaidExpenseTotal ?? 0;
    });
    const [leadEmployeeCostModalOpen, setLeadEmployeeCostModalOpen] = useState(false);
    const [leadEmployeeCostModalMode, setLeadEmployeeCostModalMode] = useState<
        'overview' | 'warning'
    >('overview');
    const [overBudgetGateOpen, setOverBudgetGateOpen] = useState(false);
    const [budgetExtensionRequestOpen, setBudgetExtensionRequestOpen] = useState(false);
    const [budgetExtensionSubmitting, setBudgetExtensionSubmitting] = useState(false);
    const leadEmployeeCostFetchIdRef = useRef(0);
    const overBudgetGateShownForLeadRef = useRef<string | null>(null);

    useEffect(() => {
        setHeaderFinancialDetailsOpen(false);
        setMoreActionsSheetOpen(false);
        setHeaderActionsMenuOpen(false);
        setInactiveNotesExpanded(false);
        setLeadEmployeeCostModalOpen(false);
        setOverBudgetGateOpen(false);
        setBudgetExtensionRequestOpen(false);
        overBudgetGateShownForLeadRef.current = null;
    }, [selectedClient?.id]);

    useEffect(() => {
        if (!selectedClient?.id) {
            setFirmPaidExpenseTotal(0);
            return;
        }
        let cancelled = false;
        const identity = resolveLeadFeeIdentity(selectedClient);
        if (!identity) {
            return;
        }
        void fetchFirmPaidExpenseReductionTotal(identity)
            .then((total) => {
                if (cancelled) return;
                setFirmPaidExpenseTotal(total);
                patchHeaderCostCache(clientsTabCacheLeadKey(selectedClient), {
                    firmPaidExpenseTotal: total,
                });
            })
            .catch((err) => {
                console.error('[ClientHeader] firm-paid expense total fetch failed:', err);
                // Keep the last known amount — zeroing here flashes a higher Total.
            });
        return () => {
            cancelled = true;
        };
    }, [selectedClient?.id, selectedClient?.lead_type]);

    useEffect(() => {
        if (!selectedClient?.id) {
            setLeadEmployeeCostSummary(null);
            setLeadEmployeeCostLoading(false);
            return;
        }

        const leadKey = clientsTabCacheLeadKey(selectedClient);
        const cached = readClientsTabCache<ClientHeaderCostCacheSlice>(leadKey, 'header');
        if (cached?.summary) {
            setLeadEmployeeCostSummary(cached.summary);
        }
        if (cached?.firmPaidExpenseTotal != null) {
            setFirmPaidExpenseTotal(cached.firmPaidExpenseTotal);
        }

        const fetchId = ++leadEmployeeCostFetchIdRef.current;
        // Only show loading when we have nothing cached/painted for this lead.
        if (!cached?.summary) {
            setLeadEmployeeCostLoading(true);
        } else {
            setLeadEmployeeCostLoading(false);
        }

        void (async () => {
            try {
                const identity = resolveLeadFeeIdentity(selectedClient);
                const [firmPaidExpenseTotalNis, planBaseNis] = await Promise.all([
                    identity ? fetchFirmPaidExpenseReductionTotalNis(identity) : Promise.resolve(0),
                    hasPaymentPlan === true
                        ? fetchLeadPaymentPlanBaseTotalNis(selectedClient)
                        : Promise.resolve(null),
                ]);
                if (leadEmployeeCostFetchIdRef.current !== fetchId) return;

                const leadTotalValueNis = await resolveLeadTotalValueNis(selectedClient, {
                    hasPaymentPlan:
                        planBaseNis != null ||
                        (hasPaymentPlan === true && paymentPlanBaseTotal != null),
                    paymentPlanBaseTotal:
                        planBaseNis != null ? planBaseNis : paymentPlanBaseTotal,
                    paymentPlanBaseTotalIsNis: planBaseNis != null,
                    firmPaidExpenseTotalNis,
                });
                if (leadEmployeeCostFetchIdRef.current !== fetchId) return;

                const summary = await fetchLeadEmployeeCostSummary({
                    client: selectedClient,
                    leadTotalValueNis,
                });
                if (leadEmployeeCostFetchIdRef.current !== fetchId) return;

                setLeadEmployeeCostSummary(summary);
                patchHeaderCostCache(leadKey, {
                    summary,
                    firmPaidExpenseTotal: cached?.firmPaidExpenseTotal ?? firmPaidExpenseTotal,
                });

                const leadKeyGate = String(selectedClient.id);
                if (
                    summary.exceedsCap &&
                    overBudgetGateShownForLeadRef.current !== leadKeyGate
                ) {
                    const stageId = Number(
                        (isStageNumeric && stageNumeric != null
                            ? stageNumeric
                            : (selectedClient as any)?.stage) ?? NaN,
                    );
                    if (Number.isFinite(stageId) && stageId >= 105) {
                        overBudgetGateShownForLeadRef.current = leadKeyGate;
                        setOverBudgetGateOpen(true);
                    }
                } else if (!summary.exceedsCap) {
                    setOverBudgetGateOpen(false);
                }
            } catch (err) {
                console.error('[ClientHeader] lead employee cost fetch failed:', err);
                // Keep painted cache on soft failure
            } finally {
                if (leadEmployeeCostFetchIdRef.current !== fetchId) return;
                setLeadEmployeeCostLoading(false);
            }
        })();
    }, [
        selectedClient?.id,
        selectedClient?.balance,
        selectedClient?.proposal_total,
        selectedClient?.total,
        selectedClient?.total_base,
        selectedClient?.currency_id,
        selectedClient?.lead_type,
        selectedClient?.subcontractor_fee,
        hasPaymentPlan,
        paymentPlanBaseTotal,
        firmPaidExpenseTotal,
        leadAllocationCostRefreshNonce,
    ]);

    useEffect(() => {
        const onSaved = () => {
            setLeadAllocationCostRefreshNonce((n) => n + 1);
        };
        window.addEventListener(LEAD_ALLOCATION_SAVED_EVENT, onSaved);
        return () => window.removeEventListener(LEAD_ALLOCATION_SAVED_EVENT, onSaved);
    }, []);

    const openLeadEmployeeCostModal = useCallback((mode: 'overview' | 'warning') => {
        setLeadEmployeeCostModalMode(mode);
        setLeadEmployeeCostModalOpen(true);
    }, []);

    /** Lead Cost badge + time bar + cost modal: from Handler Set (105) onward only. */
    const showLeadCostUi = useMemo(() => {
        const fromProp =
            isStageNumeric && stageNumeric != null && Number.isFinite(stageNumeric)
                ? stageNumeric
                : null;
        const fromClient = Number((selectedClient as any)?.stage);
        const stageId =
            fromProp != null
                ? fromProp
                : Number.isFinite(fromClient)
                  ? fromClient
                  : null;
        if (stageId != null) return stageId >= 105;
        return (
            areStagesEquivalent(currentStageName, 'Handler Set') ||
            areStagesEquivalent(currentStageName, 'Handler Started') ||
            areStagesEquivalent(currentStageName, 'Application submitted') ||
            areStagesEquivalent(currentStageName, 'Case Closed')
        );
    }, [selectedClient, currentStageName, isStageNumeric, stageNumeric]);

    /** Handler / R-Handler chips: from Client signed agreement (60) onward only. */
    const showHandlerRolesInHeader = useMemo(() => {
        const fromProp =
            isStageNumeric && stageNumeric != null && Number.isFinite(stageNumeric)
                ? stageNumeric
                : null;
        const fromClient = Number((selectedClient as any)?.stage);
        const stageId =
            fromProp != null
                ? fromProp
                : Number.isFinite(fromClient)
                  ? fromClient
                  : null;
        if (stageId != null) return stageId >= 60;
        return (
            areStagesEquivalent(currentStageName, 'Client signed agreement') ||
            areStagesEquivalent(currentStageName, 'payment_request_sent') ||
            areStagesEquivalent(currentStageName, 'Success') ||
            areStagesEquivalent(currentStageName, 'Handler Set') ||
            areStagesEquivalent(currentStageName, 'Handler Started') ||
            areStagesEquivalent(currentStageName, 'Application submitted') ||
            areStagesEquivalent(currentStageName, 'Case Closed')
        );
    }, [selectedClient, currentStageName, isStageNumeric, stageNumeric]);

    const openFinancesExpensesFeesTab = useCallback(() => {
        try {
            sessionStorage.setItem('financesSubTab', 'expenses-fees');
        } catch {
            /* ignore */
        }
        onSwitchClientTab?.('finances');
        if (typeof window !== 'undefined') {
            window.dispatchEvent(
                new CustomEvent('finances:openExpensesFees', {
                    detail: { leadId: selectedClient?.id },
                }),
            );
        }
    }, [onSwitchClientTab, selectedClient?.id]);

    const handleSkipOverBudgetGate = useCallback(() => {
        if (selectedClient?.id) {
            // Dismiss for this visit only — page refresh remounts and shows the gate again.
            overBudgetGateShownForLeadRef.current = String(selectedClient.id);
        }
        setOverBudgetGateOpen(false);
        setBudgetExtensionRequestOpen(false);
    }, [selectedClient?.id]);

    const handleOpenBudgetExtensionRequest = useCallback(() => {
        setBudgetExtensionRequestOpen(true);
    }, []);

    const handleSubmitBudgetExtensionRequest = useCallback(
        async (params: { requestedExtraMs: number; reason: string }) => {
            if (!selectedClient || !leadEmployeeCostSummary) return;
            const identity = resolveLeadIdentityForCost(selectedClient);
            if (!identity) {
                toast.error('Could not resolve lead identity for this request');
                return;
            }
            setBudgetExtensionSubmitting(true);
            try {
                await createLeadBudgetExtensionRequest({
                    leadType: identity.isLegacy ? 'legacy' : 'new',
                    newLeadId: identity.newLeadId,
                    legacyLeadId: identity.legacyLeadId,
                    leadNumber: identity.leadNumber,
                    clientName: selectedClient.name || null,
                    requestedExtraMs: params.requestedExtraMs,
                    requestReason: params.reason,
                    costAtRequestNis: leadEmployeeCostSummary.totalCostNis,
                    maxAtRequestNis: leadEmployeeCostSummary.maxAllowedCostNis,
                    workedMsAtRequest: leadEmployeeCostSummary.totalWorkedMs,
                });
                toast.success('Management request sent');
                setBudgetExtensionRequestOpen(false);
                handleSkipOverBudgetGate();
            } catch (error) {
                console.error(error);
                toast.error(error instanceof Error ? error.message : 'Failed to send request');
            } finally {
                setBudgetExtensionSubmitting(false);
            }
        },
        [selectedClient, leadEmployeeCostSummary, handleSkipOverBudgetGate],
    );

    // Lead row live sync is owned by Clients.tsx (useRealtimeRefresh + silent syncClientFromServer).
    // Header renders stage/roles/handler from selectedClient props — do not duplicate RT or poll here.

    useEffect(() => {
        selectedClientRef.current = selectedClient;
    }, [selectedClient]);

    useEffect(() => {
        let cancelled = false;
        const id = selectedClient?.id;
        if (id == null || id === '') {
            setUnpaidByCurrency(null);
            setUnpaidExpenseByCurrency(null);
            return;
        }
        (async () => {
            try {
                const { contract, expense } = await fetchUnpaidTotalsByCurrency(id, selectedClient?.lead_type);
                if (!cancelled) {
                    setUnpaidByCurrency(contract);
                    setUnpaidExpenseByCurrency(expense);
                }
            } catch {
                if (!cancelled) {
                    setUnpaidByCurrency(null);
                    setUnpaidExpenseByCurrency(null);
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [selectedClient?.id, selectedClient?.lead_type]);

    // Refresh "Remaining Lead Value" immediately when payment plans change.
    useEffect(() => {
        const handler = (e: Event) => {
            const evt = e as CustomEvent<{ leadId?: string }>;
            const leadId = evt?.detail?.leadId;
            if (!leadId || !selectedClient?.id) return;
            if (String(selectedClient.id) !== String(leadId)) return;
            void (async () => {
                try {
                    const { contract, expense } = await fetchUnpaidTotalsByCurrency(selectedClient.id, selectedClient?.lead_type);
                    setUnpaidByCurrency(contract);
                    setUnpaidExpenseByCurrency(expense);
                } catch {
                    setUnpaidByCurrency(null);
                    setUnpaidExpenseByCurrency(null);
                }
                const identity = resolveLeadFeeIdentity(selectedClient);
                if (identity) {
                    try {
                        const total = await fetchFirmPaidExpenseReductionTotal(identity);
                        setFirmPaidExpenseTotal(total);
                        patchHeaderCostCache(clientsTabCacheLeadKey(selectedClient), {
                            firmPaidExpenseTotal: total,
                        });
                    } catch {
                        // Keep last known amount
                    }
                }
            })();
        };
        window.addEventListener('paymentPlan:changed', handler as EventListener);
        return () => window.removeEventListener('paymentPlan:changed', handler as EventListener);
    }, [selectedClient?.id, selectedClient?.lead_type]);

    const { user, userFullName } = useAuthContext();
    const [publicUserId, setPublicUserId] = useState<string | null>(null);
    /** lead_field_key → metadata (own flags; RLS). */
    const [leadFieldFlagMeta, setLeadFieldFlagMeta] = useState<Map<string, ContentFlagMeta>>(() => {
        const id = selectedClient?.id?.toString();
        return (id && leadFieldFlagMetaCache.get(id)) || new Map();
    });
    const [flagTypes, setFlagTypes] = useState<FlagTypeRow[]>([]);
    const [tagsModalOpen, setTagsModalOpen] = useState(false);
    const [pinnedInteractionsModalOpen, setPinnedInteractionsModalOpen] = useState(false);
    const [pinnedInteractions, setPinnedInteractions] = useState<LeadPinnedInteractionRow[]>([]);
    const [pinnedInteractionsLoading, setPinnedInteractionsLoading] = useState(false);
    const [headerDocumentsModalOpen, setHeaderDocumentsModalOpen] = useState(false);
    const [headerSupabaseDocumentsCount, setHeaderSupabaseDocumentsCount] = useState<number>(0);
    const [leadTags, setLeadTags] = useState<string[]>(() => {
        const id = selectedClient?.id?.toString();
        return (id && leadTagsCache.get(id)) || [];
    });
    /** RMQ chat messages flagged to this lead (all users). */
    const [rmqMessageFlagCount, setRmqMessageFlagCount] = useState(() => {
        const id = selectedClient?.id?.toString();
        return (id && rmqMessageFlagCountCache.get(id)) || 0;
    });

    useEffect(() => {
        if (!user?.id) {
            setPublicUserId(null);
            return;
        }
        let cancelled = false;
        void fetchPublicUserId(supabase, user.id).then((id) => {
            if (!cancelled) setPublicUserId(id);
        });
        return () => {
            cancelled = true;
        };
    }, [user?.id]);

    useEffect(() => {
        if (!publicUserId || !selectedClient?.id) {
            setLeadFieldFlagMeta(new Map());
            return;
        }
        const cacheKey = String(selectedClient.id);
        // Show the cached flag set instantly (if any) so the badge doesn't flicker, then refresh.
        const cached = leadFieldFlagMetaCache.get(cacheKey);
        if (cached) setLeadFieldFlagMeta(cached);
        const isLegacy =
            selectedClient.lead_type === 'legacy' || selectedClient.id?.toString().startsWith('legacy_');
        const legacyId = isLegacy
            ? Number.parseInt(String(selectedClient.id).replace(/^legacy_/, ''), 10)
            : null;
        const newUuid = !isLegacy && selectedClient.id != null ? String(selectedClient.id) : null;
        let cancelled = false;
        void fetchLeadFieldFlagsForLead(supabase, publicUserId, {
            newLeadId: newUuid || undefined,
            legacyLeadId: legacyId != null && !Number.isNaN(legacyId) ? legacyId : undefined,
            allUsers: true,
        }).then((map) => {
            leadFieldFlagMetaCache.set(cacheKey, map);
            if (!cancelled) setLeadFieldFlagMeta(map);
        });
        return () => {
            cancelled = true;
        };
    }, [publicUserId, selectedClient?.id, selectedClient?.lead_type]);

    useEffect(() => {
        if (!selectedClient?.id) {
            setRmqMessageFlagCount(0);
            return;
        }
        const rawId = String((selectedClient as any)?.id ?? '');
        // Show the cached count instantly (if any) so the badge doesn't flicker from 0, then refresh.
        const cachedCount = rmqMessageFlagCountCache.get(rawId);
        if (cachedCount != null) setRmqMessageFlagCount(cachedCount);
        const isLegacy =
            (selectedClient as any)?.lead_type === 'legacy' ||
            rawId.startsWith('legacy_') ||
            (rawId !== '' && !rawId.includes('-') && /^\d+$/.test(rawId));
        const legacyId = isLegacy ? parseInt(rawId.replace(/^legacy_/, ''), 10) : null;
        const newUuid = !isLegacy && rawId.includes('-') ? rawId : null;
        let cancelled = false;
        void fetchRmqFlagCountForLead(supabase, {
            newLeadId: newUuid || undefined,
            legacyLeadId: legacyId != null && !Number.isNaN(legacyId) ? legacyId : undefined,
        }).then((n) => {
            rmqMessageFlagCountCache.set(rawId, n);
            if (!cancelled) setRmqMessageFlagCount(n);
        });
        return () => {
            cancelled = true;
        };
    }, [selectedClient?.id, selectedClient?.lead_type]);

    const refreshPinnedInteractions = useCallback(async () => {
        const identity = resolveLeadPinnedIdentity(selectedClient || {});
        if (!identity) {
            setPinnedInteractions([]);
            return;
        }
        setPinnedInteractionsLoading(true);
        try {
            const rows = await fetchLeadPinnedInteractions(supabase, identity);
            setPinnedInteractions(rows);
        } finally {
            setPinnedInteractionsLoading(false);
        }
    }, [selectedClient?.id, selectedClient?.lead_type]);

    useEffect(() => {
        void refreshPinnedInteractions();
    }, [refreshPinnedInteractions]);

    useEffect(() => {
        const handler = (event: Event) => {
            const leadKey = (event as CustomEvent<{ leadKey?: string | null }>).detail?.leadKey;
            if (leadKey && selectedClient?.id != null && String(leadKey) !== String(selectedClient.id)) {
                return;
            }
            void refreshPinnedInteractions();
        };
        window.addEventListener(PINNED_INTERACTIONS_CHANGED_EVENT, handler as EventListener);
        return () => {
            window.removeEventListener(PINNED_INTERACTIONS_CHANGED_EVENT, handler as EventListener);
        };
    }, [refreshPinnedInteractions, selectedClient?.id]);

    useEffect(() => {
        if (!selectedClient?.id) {
            setLeadTags([]);
            return;
        }
        const rawId = String((selectedClient as any)?.id ?? '');
        const isLegacy =
            (selectedClient as any)?.lead_type === 'legacy' ||
            rawId.startsWith('legacy_') ||
            (rawId !== '' && !rawId.includes('-') && /^\d+$/.test(rawId));

        let cancelled = false;
        // Cache + apply so the tags badge stays put across navigation and only updates when it actually changes.
        const applyTags = (tags: string[]) => {
            leadTagsCache.set(rawId, tags);
            if (!cancelled) setLeadTags(tags);
        };

        // Show cached tags instantly (if any) so the badge doesn't flicker from empty, then refresh.
        const cachedTags = leadTagsCache.get(rawId);
        if (cachedTags) setLeadTags(cachedTags);

        void (async () => {
            try {
                if (isLegacy) {
                    const legacyId = parseInt(rawId.replace(/^legacy_/, ''), 10);
                    if (!legacyId || Number.isNaN(legacyId)) {
                        applyTags([]);
                        return;
                    }
                    const { data, error } = await supabase
                        .from('leads_lead_tags')
                        .select('misc_leadtag(name)')
                        .eq('lead_id', legacyId);
                    if (error) throw error;
                    const tags =
                        (data || [])
                            .map((r: any) =>
                                Array.isArray(r.misc_leadtag) ? r.misc_leadtag[0]?.name : r.misc_leadtag?.name
                            )
                            .filter(Boolean) ?? [];
                    applyTags(tags);
                    return;
                }

                for (const col of ['newlead_id', 'new_lead_id'] as const) {
                    const { data, error } = await supabase
                        .from('leads_lead_tags')
                        .select('misc_leadtag(name)')
                        .eq(col, rawId);
                    if (!error) {
                        const tags =
                            (data || [])
                                .map((r: any) =>
                                    Array.isArray(r.misc_leadtag) ? r.misc_leadtag[0]?.name : r.misc_leadtag?.name
                                )
                                .filter(Boolean) ?? [];
                        applyTags(tags);
                        return;
                    }
                }

                applyTags(normalizeTagsValue((selectedClient as any)?.tags));
            } catch {
                applyTags(normalizeTagsValue((selectedClient as any)?.tags));
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [selectedClient?.id, (selectedClient as any)?.lead_type]);

    useEffect(() => {
        let cancelled = false;
        void fetchFlagTypes(supabase).then((rows) => {
            if (!cancelled) setFlagTypes(rows);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    /**
     * Sub-efforts dropdown + collapsible sidebar log + SubEffortsLogModal for stages 60, 70, 100, 105, 110, 150 (and name equivalents).
     * "Finalize case" in that row only for 110 / 150. Stage 200: fetch + catalog for log-only UI elsewhere.
     */
    const subEffortsStageFlags = useMemo(() => {
        const inferred = Number((selectedClient as any)?.stage ?? stageNumeric ?? NaN);
        const n = (val: number) => inferred === val || (isStageNumeric && stageNumeric === val);

        const clientSigned = areStagesEquivalent(currentStageName, 'Client signed agreement') || n(60);
        const paymentRequestSent = areStagesEquivalent(currentStageName, 'payment_request_sent') || n(70);
        const successStage = areStagesEquivalent(currentStageName, 'Success') || n(100);
        const handlerSet = areStagesEquivalent(currentStageName, 'Handler Set') || n(105);
        const handlerStarted = areStagesEquivalent(currentStageName, 'Handler Started') || n(110);
        const applicationSubmitted = areStagesEquivalent(currentStageName, 'Application submitted') || n(150);

        const showPickerLogAndModal =
            clientSigned ||
            paymentRequestSent ||
            successStage ||
            handlerSet ||
            handlerStarted ||
            applicationSubmitted;

        const showFinalizeCaseWithSubEfforts = handlerStarted || applicationSubmitted;

        const closed200 = (isStageNumeric && stageNumeric === 200) || inferred === 200;
        return {
            showPickerLogAndModal,
            showFinalizeCaseWithSubEfforts,
            loadSubEffortsCatalog: showPickerLogAndModal || closed200,
            fetchLeadSubEffortRows: showPickerLogAndModal || closed200,
        };
    }, [selectedClient?.id, (selectedClient as any)?.stage, currentStageName, isStageNumeric, stageNumeric]);

    const leadMiscCategoryId = useMemo(
        () => resolveLeadMiscCategoryId(selectedClient as { category_id?: unknown } | null),
        [selectedClient?.category_id, selectedClient?.id],
    );

    const showAssignSchedulerInHeader = useMemo(() => {
        if (!selectedClient) return false;
        const inferred = Number((selectedClient as any)?.stage ?? NaN);
        const numeric =
            isStageNumeric && stageNumeric != null
                ? stageNumeric
                : Number.isFinite(inferred)
                  ? inferred
                  : undefined;
        return shouldShowAssignSchedulerField(currentStageName, selectedClient, numeric);
    }, [selectedClient, currentStageName, isStageNumeric, stageNumeric]);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            if (!subEffortsStageFlags.loadSubEffortsCatalog) {
                return;
            }
            setIsLoadingSubEfforts(true);
            try {
                const items = await fetchSubEffortsForMiscCategory(supabase, leadMiscCategoryId);
                if (!cancelled) setSubEfforts(items);
            } catch (e) {
                console.error('Error loading sub_efforts for case type:', e);
                if (!cancelled) setSubEfforts([]);
            } finally {
                if (!cancelled) setIsLoadingSubEfforts(false);
            }
        };
        void load();
        return () => { cancelled = true; };
    }, [subEffortsStageFlags.loadSubEffortsCatalog, leadMiscCategoryId]);

    useEffect(() => {
        subEffortsProvisionKeyRef.current = null;
    }, [selectedClient?.id, leadMiscCategoryId]);

    const fetchLeadSubEfforts = useCallback(async () => {
        if (!selectedClient?.id) return;
        if (!subEffortsStageFlags.fetchLeadSubEffortRows && !isSubEffortsModalOpen) return;
        if (subEffortsFetchInFlightRef.current) return;

        const { legacyId, newLeadId } = leadSubEffortIdentity(selectedClient);
        if (!legacyId && !newLeadId) return;

        const provisionKey = `${String(selectedClient.id)}:${leadMiscCategoryId ?? 'none'}`;

        subEffortsFetchInFlightRef.current = true;
        setIsLoadingLeadSubEfforts(true);
        try {
            const selectBase = `
                    id,
                    legacy_lead_id,
                    new_lead_id,
                    employee_id,
                    created_at,
                    created_by,
                    updated_by,
                    updated_at,
                    internal,
                    active,
                    sort_order,
                    document_url,
                    internal_notes,
                    client_notes,
                    sub_effort_id,
                    sub_efforts (
                        id,
                        name,
                        sort_order,
                        percentage,
                        description,
                        default_client_visible,
                        sub_category_efforts (
                            id,
                            name,
                            sort_order
                        )
                    ),
                    tenants_employee ( id, display_name, photo_url, photo )
                `;
            const selectWithManual = selectBase.replace(
                'sub_effort_id,',
                'sub_effort_id,\n                    manually_added,',
            );

            const buildQuery = (selectQuery: string) => {
                let q = supabase
                    .from('lead_sub_efforts')
                    .select(selectQuery)
                    .order('sort_order', { ascending: true })
                    .order('created_at', { ascending: true })
                    .limit(500);
                if (legacyId) q = q.eq('legacy_lead_id', legacyId);
                else if (newLeadId) q = q.eq('new_lead_id', newLeadId);
                return q;
            };

            let q = buildQuery(selectWithManual);
            let { data, error } = await q;
            if (error && /manually_added/i.test(String(error.message ?? ''))) {
                q = buildQuery(selectBase);
                ({ data, error } = await q);
            }
            if (error) throw error;
            let rows = (data as any[]) ?? [];

            const catalog = leadMiscCategoryId
                ? await fetchSubEffortsForMiscCategory(supabase, leadMiscCategoryId)
                : [];

            if (catalog.length > 0 && subEffortsProvisionKeyRef.current !== provisionKey) {
                const actor = await fetchStageActorInfo();
                const inserted = await ensureLeadSubEffortRows(supabase, {
                    catalog,
                    legacyLeadId: legacyId,
                    newLeadId,
                    actor,
                });
                subEffortsProvisionKeyRef.current = provisionKey;
                if (inserted) {
                    const { data: refreshed, error: refreshError } = await q;
                    if (refreshError) throw refreshError;
                    rows = (refreshed as any[]) ?? [];
                }
            }

            // Category defaults for display; keep manually added extras only.
            if (catalog.length > 0) {
                const allowedIds = new Set(catalog.map((item) => item.id));
                rows = rows.filter((row) => {
                    const id = Number((row as any)?.sub_effort_id ?? (row as any)?.sub_efforts?.id);
                    if (!Number.isFinite(id) || id <= 0) return false;
                    if (allowedIds.has(id)) return true;
                    return Boolean((row as any)?.manually_added);
                });
            }

            setLeadSubEfforts(dedupeLeadSubEffortRows(rows));
            if (catalog.length > 0) {
                setSubEfforts(catalog);
            }
        } catch (e) {
            console.error('Error fetching lead_sub_efforts:', e);
        } finally {
            subEffortsFetchInFlightRef.current = false;
            setIsLoadingLeadSubEfforts(false);
        }
    }, [
        selectedClient?.id,
        selectedClient?.lead_type,
        subEffortsStageFlags.fetchLeadSubEffortRows,
        isSubEffortsModalOpen,
        leadMiscCategoryId,
    ]);

    useEffect(() => {
        void fetchLeadSubEfforts();
    }, [fetchLeadSubEfforts]);

    const openSubEffortsModal = useCallback((rowId?: string | number | null) => {
        setSubEffortsModalRowId(rowId ?? null);
        setIsSubEffortsModalOpen(true);
    }, []);

    useEffect(() => {
        if (!selectedClient?.id) return;
        const openUploads = searchParams.get('clientUploads') === '1';
        const openSub = searchParams.get('subEfforts') === '1' || openUploads;
        if (!openSub) return;

        setInitialClientUploadsOpen(openUploads);
        openSubEffortsModal(null);

        const next = new URLSearchParams(searchParams);
        next.delete('subEfforts');
        next.delete('clientUploads');
        setSearchParams(next, { replace: true });
    }, [selectedClient?.id, searchParams, setSearchParams, openSubEffortsModal]);

    useEffect(() => {
        if (!isSubEffortsModalOpen) return;
        let cancelled = false;
        setIsLoadingSubEffortAddOptions(true);
        void (async () => {
            try {
                const opts = await fetchActiveSubEffortTemplates(supabase);
                if (!cancelled) setSubEffortAddOptions(opts);
            } catch (e) {
                console.error('Failed to load sub effort templates:', e);
                if (!cancelled) setSubEffortAddOptions([]);
            } finally {
                if (!cancelled) setIsLoadingSubEffortAddOptions(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [isSubEffortsModalOpen]);

    const handleAddLeadSubEffort = useCallback(
        async (opt: { id: number; name: string }) => {
            if (!selectedClient?.id) return null;
            const identity = leadSubEffortIdentity(selectedClient);
            const legacyLeadId = identity.legacyId;
            const newLeadId = identity.newLeadId;
            if (!legacyLeadId && !newLeadId) {
                toast.error('Cannot add sub effort: lead identity missing');
                return null;
            }
            setIsAddingLeadSubEffort(true);
            try {
                const actor = await fetchStageActorInfo();
                const template = subEffortAddOptions.find((o) => o.id === opt.id);
                const newId = await addLeadSubEffortRow(supabase, {
                    subEffortId: opt.id,
                    legacyLeadId,
                    newLeadId,
                    defaultClientVisible: template?.default_client_visible,
                    actor,
                });
                await fetchLeadSubEfforts();
                if (newId == null) {
                    toast.error('Sub effort already on this lead');
                    return null;
                }
                toast.success(`Added “${opt.name}”`);
                return newId;
            } catch (e) {
                console.error(e);
                toast.error(e instanceof Error ? e.message : 'Failed to add sub effort');
                return null;
            } finally {
                setIsAddingLeadSubEffort(false);
            }
        },
        [selectedClient, subEffortAddOptions, fetchLeadSubEfforts],
    );

    const handleRemoveLeadSubEffort = useCallback(
        async (rowId: string | number) => {
            const row = leadSubEfforts.find((r) => String(r?.id) === String(rowId));
            const name =
                String(row?.sub_efforts?.name ?? row?.name ?? '').trim() || 'this sub effort';
            if (
                !window.confirm(
                    `Remove “${name}” from this lead’s workflow? This does not delete the template.`,
                )
            ) {
                return;
            }
            setIsRemovingLeadSubEffort(true);
            try {
                await removeLeadSubEffortRow(supabase, rowId);
                if (String(subEffortsModalRowId) === String(rowId)) {
                    setSubEffortsModalRowId(null);
                }
                await fetchLeadSubEfforts();
                toast.success('Sub effort removed');
            } catch (e) {
                console.error(e);
                toast.error(e instanceof Error ? e.message : 'Failed to remove sub effort');
            } finally {
                setIsRemovingLeadSubEffort(false);
            }
        },
        [leadSubEfforts, subEffortsModalRowId, fetchLeadSubEfforts],
    );

    useEffect(() => {
        window.dispatchEvent(
            new CustomEvent('sub-efforts-modal:open-change', { detail: { open: isSubEffortsModalOpen } }),
        );
    }, [isSubEffortsModalOpen]);

    // Local state for employees (matching RolesTab pattern)
    const [localAllEmployees, setLocalAllEmployees] = useState<any[]>(allEmployees || []);

    // Update local employees state when prop changes (matching RolesTab exactly)
    useEffect(() => {
        if (allEmployees && allEmployees.length > 0) {
            setLocalAllEmployees(allEmployees);
        }
    }, [allEmployees]);

    // Fetch employees if prop is empty (matching RolesTab pattern)
    useEffect(() => {
        if ((!allEmployees || allEmployees.length === 0) && localAllEmployees.length === 0) {
            const fetchEmployees = async () => {
                const { data, error } = await supabase
                    .from('tenants_employee')
                    .select('id, display_name, photo_url, photo')
                    .order('display_name', { ascending: true });

                if (!error && data) {
                    setLocalAllEmployees(data);
                }
            };
            fetchEmployees();
        }
    }, [allEmployees, localAllEmployees.length]);

    // Use prop if available, otherwise use local state (matching RolesTab pattern)
    const employeesToUse = (allEmployees && allEmployees.length > 0) ? allEmployees : localAllEmployees;
    const employeesToUseRef = useRef(employeesToUse);
    employeesToUseRef.current = employeesToUse;

    const updateActiveHandlerType = useCallback(
        async (newType: 1 | 2) => {
            const sc = selectedClientRef.current;
            if (!sc?.id || togglingActiveHandlerRef.current) return;
            const current = Number((sc as any).active_handler_type) === 1 ? 1 : 2;
            if (current === newType) return;

            const idStr = String(sc.id);
            const isLegacy = idStr.startsWith('legacy_') || sc.lead_type === 'legacy';

            const employees = employeesToUseRef.current || [];
            const resolveNumericEmployeeId = (value: unknown): number | null => {
                if (value == null || value === '' || value === '---' || value === '--') return null;
                if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
                const s = String(value).trim();
                if (!s) return null;
                if (/^\d+$/.test(s)) {
                    const n = Number(s);
                    return Number.isFinite(n) && n > 0 ? n : null;
                }
                const emp = employees.find(
                    (e: any) => e?.display_name && e.display_name.trim().toLowerCase() === s.toLowerCase()
                );
                if (emp?.id == null) return null;
                const n = typeof emp.id === 'bigint' ? Number(emp.id) : Number(emp.id);
                return Number.isFinite(n) && n > 0 ? n : null;
            };

            const isLegacyLead = sc.lead_type === 'legacy' || idStr.startsWith('legacy_');
            const ch = (sc as any).case_handler_id;
            let handlerId: number | null = null;
            if (ch != null && String(ch).trim() !== '') {
                const n = Number(ch);
                handlerId = Number.isFinite(n) && n > 0 ? n : null;
            } else if (!isLegacyLead) {
                handlerId = resolveNumericEmployeeId((sc as any).handler);
            }
            const retentionHandlerId = (sc as any).retainer_handler_id ? Number((sc as any).retainer_handler_id) : null;

            const getName = (id: number | null) => {
                if (id == null) return '---';
                const idAsNumber = id;
                const employee = employees.find((emp: any) => {
                    if (!emp?.id) return false;
                    const empId = typeof emp.id === 'bigint' ? Number(emp.id) : Number(emp.id);
                    return !Number.isNaN(empId) && empId === idAsNumber;
                });
                return employee?.display_name || '---';
            };

            const buildReveal = (): ActiveRoleRevealState => {
                if (newType === 2) {
                    return {
                        activeType: 2,
                        employeeId: handlerId,
                        displayName: getName(handlerId),
                        roleTitle: 'Case handler',
                    };
                }
                return {
                    activeType: 1,
                    employeeId: retentionHandlerId,
                    displayName: getName(retentionHandlerId),
                    roleTitle: 'Retention handler',
                };
            };

            togglingActiveHandlerRef.current = true;
            try {
                if (isLegacy) {
                    const legacyId = parseInt(idStr.replace(/^legacy_/, ''), 10);
                    if (Number.isNaN(legacyId)) throw new Error('Invalid legacy lead id');
                    const { error } = await supabase
                        .from('leads_lead')
                        .update({ active_handler_type: newType })
                        .eq('id', legacyId);
                    if (error) throw error;
                } else {
                    const { error } = await supabase
                        .from('leads')
                        .update({ active_handler_type: newType })
                        .eq('id', sc.id);
                    if (error) throw error;
                }
                setHandlerActiveRingNonce((n) => n + 1);
                setActiveRoleReveal(buildReveal());
                await refreshClientData(sc.id);
            } catch (e: any) {
                console.error('updateActiveHandlerType:', e);
                toast.error(e?.message || 'Failed to update active handler');
            } finally {
                togglingActiveHandlerRef.current = false;
            }
        },
        [refreshClientData]
    );

    useEffect(() => {
        if (!activeRoleReveal) {
            setActiveRoleRevealEntered(false);
            return;
        }
        setActiveRoleRevealEntered(false);
        if (activeRoleRevealRafRef.current != null) {
            cancelAnimationFrame(activeRoleRevealRafRef.current);
        }
        activeRoleRevealRafRef.current = requestAnimationFrame(() => {
            activeRoleRevealRafRef.current = requestAnimationFrame(() => {
                setActiveRoleRevealEntered(true);
                activeRoleRevealRafRef.current = null;
            });
        });
        if (activeRoleRevealTimerRef.current) clearTimeout(activeRoleRevealTimerRef.current);
        activeRoleRevealTimerRef.current = setTimeout(() => {
            setActiveRoleReveal(null);
            activeRoleRevealTimerRef.current = null;
        }, 2800);
        return () => {
            if (activeRoleRevealTimerRef.current) {
                clearTimeout(activeRoleRevealTimerRef.current);
                activeRoleRevealTimerRef.current = null;
            }
            if (activeRoleRevealRafRef.current != null) {
                cancelAnimationFrame(activeRoleRevealRafRef.current);
                activeRoleRevealRafRef.current = null;
            }
        };
    }, [activeRoleReveal]);

    // Helper function to get employee by ID or name (matching RolesTab logic exactly)
    const getEmployeeById = (employeeIdOrName: string | number | null | undefined) => {
        // Use the employeesToUse variable defined above (matching RolesTab)

        if (!employeeIdOrName || employeeIdOrName === '---' || employeeIdOrName === '--' || employeeIdOrName === '') {
            return null;
        }

        // First, try to match by ID
        const employeeById = employeesToUse.find((emp: any) => {
            const empId = typeof emp.id === 'bigint' ? Number(emp.id) : emp.id;
            const searchId = typeof employeeIdOrName === 'string' ? parseInt(employeeIdOrName, 10) : employeeIdOrName;

            if (isNaN(Number(searchId))) return false;

            if (empId.toString() === searchId.toString()) return true;
            if (Number(empId) === Number(searchId)) return true;

            return false;
        });

        if (employeeById) {
            return employeeById;
        }

        // If not found by ID, try to match by display name
        if (typeof employeeIdOrName === 'string') {
            const employeeByName = employeesToUse.find((emp: any) => {
                if (!emp.display_name) return false;
                return emp.display_name.trim().toLowerCase() === employeeIdOrName.trim().toLowerCase();
            });

            if (employeeByName) {
                return employeeByName;
            }
        }

        // Debug logging
        if (employeesToUse.length > 0) {
            console.warn('[ClientHeader] Employee not found:', {
                searchValue: employeeIdOrName,
                employeesCount: employeesToUse.length,
                sampleEmployees: employeesToUse.slice(0, 3).map((e: any) => ({ id: e.id, display_name: e.display_name }))
            });
        }

        return null;
    };

    // Helper function to get employee initials
    const getEmployeeInitials = (name: string | null | undefined): string => {
        if (!name || name === '---' || name === '--' || name === 'Not assigned') return '';
        const parts = name.trim().split(' ');
        if (parts.length >= 2) {
            return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
        }
        return name.substring(0, 2).toUpperCase();
    };

    // Helper function to format role display value
    const formatRoleDisplay = (value: string | number | null | undefined): string => {
        // Convert to string first to handle numbers and other types
        const stringValue = value != null ? String(value) : '';

        if (!stringValue || stringValue === '---' || stringValue === '--' || stringValue === 'Not assigned' || stringValue === 'Unassigned' || stringValue.trim() === '') {
            return '---';
        }
        return stringValue;
    };

    // Helper function to format phone number with dashes for better readability (single row)
    const formatPhoneNumberDisplay = (phone: string | null | undefined): string => {
        if (!phone || phone === '---' || phone.trim() === '') return phone || '---';

        // Remove existing formatting to normalize
        const digitsOnly = phone.replace(/[\s\-\(\)]/g, '');

        // If it's already formatted nicely with dashes/spaces, return as-is
        if (phone.includes('-') || phone.includes(' ') || phone.includes('(')) {
            return phone;
        }

        // Format based on common patterns (all on one line)
        // US/Canada: +1XXXXXXXXXX -> +1 (XXX) XXX-XXXX
        if (digitsOnly.startsWith('+1') || (digitsOnly.startsWith('1') && digitsOnly.length === 11)) {
            const num = digitsOnly.startsWith('+1') ? digitsOnly.substring(2) : digitsOnly.substring(1);
            if (num.length === 10) {
                return `+1 (${num.substring(0, 3)}) ${num.substring(3, 6)}-${num.substring(6)}`;
            }
        }

        // Israeli: +972XXXXXXXXX or 0XXXXXXXXX -> +972 XX-XXX-XXXX or 0XX-XXX-XXXX
        if (digitsOnly.startsWith('+972') || digitsOnly.startsWith('972')) {
            const num = digitsOnly.startsWith('+972') ? digitsOnly.substring(4) : digitsOnly.substring(3);
            if (num.length === 9) {
                return `+972 ${num.substring(0, 2)}-${num.substring(2, 5)}-${num.substring(5)}`;
            }
        }

        // UK: +44XXXXXXXXXX -> +44 XXXX XXXXXX
        if (digitsOnly.startsWith('+44') || digitsOnly.startsWith('44')) {
            const num = digitsOnly.startsWith('+44') ? digitsOnly.substring(3) : digitsOnly.substring(2);
            if (num.length === 10) {
                return `+44 ${num.substring(0, 4)} ${num.substring(4)}`;
            }
        }

        // Australian: +61XXXXXXXXX -> +61 X XXXX XXXX
        if (digitsOnly.startsWith('+61') || digitsOnly.startsWith('61')) {
            const num = digitsOnly.startsWith('+61') ? digitsOnly.substring(3) : digitsOnly.substring(2);
            if (num.length === 9) {
                return `+61 ${num.substring(0, 1)} ${num.substring(1, 5)} ${num.substring(5)}`;
            }
        }

        // Generic formatting for other numbers: add dashes
        if (digitsOnly.length > 6) {
            // Find country code if present
            let countryCode = '';
            let numberPart = digitsOnly;

            if (digitsOnly.startsWith('+')) {
                // Extract country code (1-3 digits after +)
                const afterPlus = digitsOnly.substring(1);
                if (afterPlus.startsWith('1') && afterPlus.length > 10) {
                    countryCode = '+1';
                    numberPart = afterPlus.substring(1);
                } else if (afterPlus.length > 9) {
                    // Try 2-3 digit country codes
                    const twoDigit = afterPlus.substring(0, 2);
                    const threeDigit = afterPlus.substring(0, 3);
                    if (['44', '61', '27', '33', '49', '39'].includes(twoDigit) && afterPlus.length > 10) {
                        countryCode = `+${twoDigit}`;
                        numberPart = afterPlus.substring(2);
                    } else if (['972', '351', '353'].includes(threeDigit) && afterPlus.length > 11) {
                        countryCode = `+${threeDigit}`;
                        numberPart = afterPlus.substring(3);
                    }
                }
            }

            // Format the number part with dashes
            let formatted = numberPart;
            if (numberPart.length > 6) {
                // Format as XXX-XXX-XXXX or similar
                const chunks: string[] = [];
                let remaining = numberPart;

                // Take chunks from the end
                while (remaining.length > 4) {
                    chunks.unshift(remaining.slice(-3));
                    remaining = remaining.slice(0, -3);
                }
                if (remaining.length > 0) {
                    chunks.unshift(remaining);
                }

                formatted = chunks.join('-');
            }

            if (countryCode) {
                return `${countryCode} ${formatted}`;
            }
            return formatted;
        }

        // If no special formatting applies, return original
        return phone;
    };

    // Helper function to get employee display name from ID - SIMPLE: match ID, return display_name
    const getEmployeeDisplayNameFromId = (employeeId: string | number | null | undefined): string => {
        if (!employeeId || employeeId === '---' || employeeId === null || employeeId === undefined) return '---';
        if (!employeesToUse || employeesToUse.length === 0) return '---';

        const idAsNumber = typeof employeeId === 'string' ? parseInt(employeeId, 10) : Number(employeeId);
        if (isNaN(idAsNumber)) return '---';

        const employee = employeesToUse.find((emp: any) => {
            if (!emp || !emp.id) return false;
            const empId = typeof emp.id === 'bigint' ? Number(emp.id) : (typeof emp.id === 'string' ? parseInt(emp.id, 10) : Number(emp.id));
            return !isNaN(empId) && empId === idAsNumber;
        });

        return employee?.display_name || '---';
    };

    // Track image errors per employee to prevent flickering (persists across re-renders)
    const imageErrorCache = useRef<Map<string | number, boolean>>(new Map());

    // Component to render employee avatar (exact copy from RolesTab)
    const EmployeeAvatar: React.FC<{
        employeeId: string | number | null | undefined;
        size?: 'sm' | 'md' | 'lg' | 'xl' | 'hero';
    }> = ({ employeeId, size = 'md' }) => {
        const [imageError, setImageError] = useState(false);
        const employee = getEmployeeById(employeeId);
        const sizeClasses =
            size === 'sm'
                ? 'w-8 h-8 text-xs'
                : size === 'md'
                  ? 'w-12 h-12 text-sm'
                  : size === 'lg'
                    ? 'w-16 h-16 text-base'
                    : size === 'xl'
                      ? 'w-24 h-24 text-2xl'
                      : 'w-36 h-36 text-4xl';

        // Check cache first to prevent flickering
        const cacheKey = employeeId?.toString() || '';
        const cachedError = imageErrorCache.current.get(cacheKey) || false;

        // Debug logging
        if (employeeId && !employee) {
            console.warn('[ClientHeader EmployeeAvatar] No employee found for:', employeeId, 'employeesToUse length:', employeesToUse?.length);
        }

        if (!employee) {
            return null;
        }

        const photoUrl = employee.photo_url || employee.photo;
        const initials = getEmployeeInitials(employee.display_name);

        // Use cached error if available, otherwise use state
        const hasError = cachedError || imageError;

        // If we know there's no photo URL or we have a cached error, show initials immediately
        if (hasError || !photoUrl) {
            return (
                <div
                    className={`${sizeClasses} rounded-full flex items-center justify-center bg-gray-200 text-gray-600 font-medium flex-shrink-0 cursor-pointer hover:opacity-80 transition-opacity`}
                    onClick={() => {
                        if (employee.id) {
                            navigate(`/my-profile/${employee.id}`);
                        }
                    }}
                    title={`View ${employee.display_name}'s profile`}
                >
                    {initials}
                </div>
            );
        }

        // Try to render image
        return (
            <img
                src={photoUrl}
                alt={employee.display_name}
                className={`${sizeClasses} rounded-full object-cover flex-shrink-0 cursor-pointer hover:opacity-80 transition-opacity`}
                onClick={() => {
                    if (employee.id) {
                        navigate(`/my-profile/${employee.id}`);
                    }
                }}
                onError={() => {
                    // Cache the error to prevent flickering on re-renders
                    if (cacheKey) {
                        imageErrorCache.current.set(cacheKey, true);
                    }
                    setImageError(true);
                }}
                title={`View ${employee.display_name}'s profile`}
            />
        );
    };
    const [showCategoryModal, setShowCategoryModal] = useState(false);
    const [categoryInputValue, setCategoryInputValue] = useState('');
    const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
    const [allCategories, setAllCategories] = useState<any[]>(() => getCachedCategoriesSync());
    const [showLanguageModal, setShowLanguageModal] = useState(false);
    const [languageInputValue, setLanguageInputValue] = useState('');
    const [showLanguageDropdown, setShowLanguageDropdown] = useState(false);
    const [allLanguages, setAllLanguages] = useState<Array<{ id: number | string; name: string }>>(
        () => getCachedLanguagesSync(),
    );
    const [savingLanguage, setSavingLanguage] = useState(false);
    const [showTopicModal, setShowTopicModal] = useState(false);
    const [topicInputValue, setTopicInputValue] = useState('');
    const [savingTopic, setSavingTopic] = useState(false);
    // Seed from the module-level cache so source names resolve synchronously on remount/navigation
    // back, instead of flashing empty and falling through to a late `leads` DB fetch.
    const [allSources, setAllSources] = useState<Array<{ id: string; name: string }>>(
        () => cachedLeadSources ?? [],
    );
    // Bumped after a background source_id fetch writes the module cache, so the memo below recomputes.
    const [sourceFetchNonce, setSourceFetchNonce] = useState(0);

    /**
     * New leads: { source_id, name } resolved SYNCHRONOUSLY during render (join → source_id+allSources
     * → session cache), so the source badge appears in the same paint as the other meta chips instead
     * of popping in a frame later. The async DB fetch below only runs when none of these can resolve it.
     */
    const resolvedNewLeadSource = useMemo<{ sourceId: string | null; name: string | null } | null>(() => {
        void sourceFetchNonce; // re-run once a background fetch has populated the cache
        const clientId = selectedClient?.id?.toString();
        if (!clientId) return null;

        const joinName = getSourceDisplayFromJoin(selectedClient);
        const propSourceId = normalizeLeadSourceId(selectedClient?.source_id);

        if (joinName) return { sourceId: propSourceId, name: joinName };
        if (propSourceId) {
            const name = lookupSourceNameById(propSourceId, allSources);
            if (name) return { sourceId: propSourceId, name };
        }
        if (resolvedLeadSourceCache.has(clientId)) return resolvedLeadSourceCache.get(clientId)!;
        return propSourceId ? { sourceId: propSourceId, name: null } : null;
    }, [
        selectedClient?.id,
        selectedClient?.lead_type,
        selectedClient?.source_id,
        selectedClient?.misc_leadsource,
        allSources,
        sourceFetchNonce,
    ]);

    // Persist every resolved source into the session cache. This keeps the source visible across
    // background syncs that briefly deliver a selectedClient object WITHOUT source_id: the memo above
    // then falls back to this cache instead of momentarily showing '---'.
    useEffect(() => {
        const clientId = selectedClient?.id?.toString();
        if (!clientId) return;
        if (resolvedNewLeadSource && (resolvedNewLeadSource.name || resolvedNewLeadSource.sourceId)) {
            resolvedLeadSourceCache.set(clientId, resolvedNewLeadSource);
        }
    }, [selectedClient?.id, resolvedNewLeadSource]);

    const [allCurrencies, setAllCurrencies] = useState<Array<{ id: number | string, name: string, iso_code: string | null }>>([]);
    const [showStageDropdown, setShowStageDropdown] = useState(false);
    const [isCallModalOpen, setIsCallModalOpen] = useState(false);
    const [callPhoneNumber, setCallPhoneNumber] = useState('');
    const [callContactName, setCallContactName] = useState('');
    const [contactDetailsModalOpen, setContactDetailsModalOpen] = useState(false);

    // Persisted contact info state (ported from ClientInformationBox)
    const [legacyContactInfo, setLegacyContactInfo] = useState<{ email: string | null, phone: string | null }>({
        email: null,
        phone: null
    });
    const legacyContactFetchRef = useRef<string | null>(null);

    // Clear/sync all client-derived state when entering another lead so we never show the previous lead's data
    useEffect(() => {
        const clientId = selectedClient?.id?.toString() ?? null;
        if (!clientId) {
            setLegacyContactInfo({ email: null, phone: null });
            setCategoryInputValue('');
            legacyContactFetchRef.current = null;
            return;
        }
        // (Source is derived synchronously via useMemo, so there's nothing to clear/flash here.)
        setLegacyContactInfo({ email: null, phone: null });
        setCategoryInputValue('');
        setShowCategoryDropdown(false);
        setShowStageDropdown(false);
        setShowCategoryModal(false);
        setIsEditingCategory(false);
        setShowLanguageModal(false);
        setShowLanguageDropdown(false);
        setLanguageInputValue('');
        setShowTopicModal(false);
        setTopicInputValue('');
        setContactDetailsModalOpen(false);
        setActiveRoleReveal(null);
        setActiveRoleRevealEntered(false);
        if (activeRoleRevealTimerRef.current) {
            clearTimeout(activeRoleRevealTimerRef.current);
            activeRoleRevealTimerRef.current = null;
        }
        legacyContactFetchRef.current = null;
    }, [selectedClient?.id]);

    // Fetch sources from misc_leadsource table
    useEffect(() => {
        const fetchSources = async () => {
            try {
                if (cachedLeadSources) {
                    setAllSources(cachedLeadSources);
                    return;
                }
                if (!cachedLeadSourcesPromise) {
                    cachedLeadSourcesPromise = fetchActiveLeadSourceOptions().then((opts) =>
                        opts.map((o) => ({ id: o.id, name: o.name })),
                    );
                }
                const rows = await cachedLeadSourcesPromise;
                cachedLeadSources = rows;
                setAllSources(rows);
            } catch (error) {
                console.error('Error fetching sources:', error);
            }
        };

        fetchSources();
    }, []);

    // New leads: only when the source can't be resolved synchronously (no join, no source_id on the
    // prop, and nothing cached yet) do we hit the DB once. The result is written to the module cache
    // and a nonce bump makes the memo above pick it up — display stays flicker-free in every other case.
    useEffect(() => {
        const clientId = selectedClient?.id?.toString() ?? null;
        if (!clientId) return;

        const isLegacyLead =
            selectedClient?.lead_type === 'legacy' || clientId.startsWith('legacy_');
        if (isLegacyLead) return; // legacy leads resolve synchronously from their own join/source_id

        const joinName = getSourceDisplayFromJoin(selectedClient);
        const propSourceId = normalizeLeadSourceId(selectedClient?.source_id);
        const syncName = resolveLeadSourceName(selectedClient, allSources);

        // Already resolvable synchronously (memo handles it) or already fetched this session → no DB call.
        if (joinName || syncName) return;
        if (propSourceId && lookupSourceNameById(propSourceId, allSources)) return;
        if (resolvedLeadSourceCache.has(clientId)) return;

        let cancelled = false;

        (async () => {
            try {
                const { data, error } = await supabase
                    .from('leads')
                    .select('source_id, misc_leadsource!fk_leads_source_id ( id, name )')
                    .eq('id', selectedClient.id)
                    .maybeSingle();
                if (error) throw error;

                const sourceId = normalizeLeadSourceId(data?.source_id);
                const name =
                    getSourceDisplayFromJoin(data) ??
                    (sourceId ? lookupSourceNameById(sourceId, allSources) : null);
                resolvedLeadSourceCache.set(clientId, sourceId || name ? { sourceId, name } : null);
            } catch (error) {
                console.error('Error fetching lead source_id:', error);
                const fallbackName =
                    joinName ??
                    (propSourceId ? lookupSourceNameById(propSourceId, allSources) : null);
                resolvedLeadSourceCache.set(
                    clientId,
                    propSourceId || fallbackName ? { sourceId: propSourceId, name: fallbackName } : null,
                );
            } finally {
                if (!cancelled) setSourceFetchNonce((n) => n + 1);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [
        selectedClient?.id,
        selectedClient?.lead_type,
        selectedClient?.source_id,
        selectedClient?.misc_leadsource,
        allSources,
    ]);

    // Fetch currencies from accounting_currencies table
    useEffect(() => {
        const fetchCurrencies = async () => {
            try {
                if (cachedCurrencies) {
                    setAllCurrencies(cachedCurrencies);
                    return;
                }
                if (!cachedCurrenciesPromise) {
                    cachedCurrenciesPromise = (async () => {
                        const { data, error } = await supabase
                            .from('accounting_currencies')
                            .select('id, name, iso_code')
                            .order('order', { ascending: true, nullsFirst: false });
                        if (error) throw error;
                        return data || [];
                    })();
                }
                const rows = await cachedCurrenciesPromise;
                cachedCurrencies = rows;
                setAllCurrencies(rows);
            } catch (error) {
                console.error('Error fetching currencies:', error);
            }
        };

        fetchCurrencies();
    }, []);

    // Fetch categories / languages once per session (shared module cache with Clients).
    useEffect(() => {
        const fetchCategories = async () => {
            try {
                const rows = await ensureLeadCategories();
                setAllCategories(rows);
            } catch (error) {
                console.error('Error fetching categories:', error);
            }
        };
        fetchCategories();
    }, []);

    useEffect(() => {
        const fetchLanguages = async () => {
            try {
                const rows = await ensureLeadLanguages();
                setAllLanguages(rows);
            } catch (error) {
                console.error('Error fetching languages:', error);
            }
        };
        fetchLanguages();
    }, []);

    // Fetch legacy contact info — clear first when client changes to avoid showing previous lead's data
    useEffect(() => {
        if (!selectedClient) {
            setLegacyContactInfo({ email: null, phone: null });
            return;
        }

        // Clear immediately so we never show the previous lead's email/phone (avoids cache/stale display)
        setLegacyContactInfo({ email: null, phone: null });

        const currentClientId = selectedClient?.id?.toString() ?? null;
        legacyContactFetchRef.current = currentClientId;
        const isLegacyLead = selectedClient?.lead_type === 'legacy' || (currentClientId ?? '').startsWith('legacy_');

        const fetchLegacyContactInfo = async () => {
            if (!currentClientId) return;
            if (isLegacyLead) {
                const legacyId = currentClientId.replace('legacy_', '');
                try {
                    const persistedContactKey = `clientsPage_contactData_${legacyId}`;
                    const persistedContactData = sessionStorage.getItem(persistedContactKey);
                    if (persistedContactData && legacyContactFetchRef.current === currentClientId) {
                        setLegacyContactInfo(JSON.parse(persistedContactData));
                        return;
                    }
                } catch (error) { console.error(error); }

                try {
                    const { data: leadContacts } = await supabase
                        .from('lead_leadcontact')
                        .select(`main, contact_id`)
                        .eq('lead_id', legacyId)
                        .eq('main', 'true');

                    if (leadContacts && leadContacts.length > 0) {
                        const mainContactId = leadContacts[0].contact_id;
                        const { data: contactData } = await supabase
                            .from('leads_contact')
                            .select('email, phone')
                            .eq('id', mainContactId)
                            .single();

                        if (contactData && legacyContactFetchRef.current === currentClientId) {
                            setLegacyContactInfo(contactData);
                            try {
                                sessionStorage.setItem(`clientsPage_contactData_${legacyId}`, JSON.stringify(contactData));
                            } catch (e) { }
                        }
                    }
                } catch (error) { console.error(error); }
            }
        };
        fetchLegacyContactInfo();
    }, [selectedClient]);

    // Handle category save
    const handleSaveCategory = async () => {
        if (!selectedClient || !categoryInputValue.trim()) return;
        try {
            const isLegacyLead = selectedClient?.lead_type === 'legacy' || selectedClient?.id?.toString().startsWith('legacy_');
            const tableName = isLegacyLead ? 'leads_lead' : 'leads';
            const idField = 'id';
            const clientId = isLegacyLead ? selectedClient.id.toString().replace('legacy_', '') : selectedClient.id;

            const foundCategory = allCategories.find((cat: any) => {
                const expectedFormat = cat.misc_maincategory?.name
                    ? `${cat.name} (${cat.misc_maincategory.name})`
                    : cat.name;
                return expectedFormat.toLowerCase().includes(categoryInputValue.toLowerCase()) ||
                    cat.name.toLowerCase().includes(categoryInputValue.toLowerCase());
            });

            if (!foundCategory) {
                toast.error('Category not found. Please select from the dropdown.');
                return;
            }

            const { error } = await supabase
                .from(tableName)
                .update({
                    category_id: foundCategory.id,
                    category: foundCategory.name,
                    category_last_edited_by: 'System User', // Simplified for now
                    category_last_edited_at: new Date().toISOString(),
                })
                .eq(idField, clientId);

            if (error) throw error;
            toast.success('Category updated');
            setIsEditingCategory(false);
            setShowCategoryDropdown(false);
            if (refreshClientData) await refreshClientData(selectedClient.id);
        } catch (error) {
            console.error(error);
            toast.error('Failed to update category');
        }
    };

    const handleSaveLanguage = async () => {
        if (!selectedClient) return;
        const trimmed = languageInputValue.trim();
        if (!trimmed) {
            toast.error('Please select a language from the list.');
            return;
        }
        const foundLanguage =
            allLanguages.find((l) => l.name.toLowerCase() === trimmed.toLowerCase()) ||
            allLanguages.find(
                (l) =>
                    l.name.toLowerCase().includes(trimmed.toLowerCase()) ||
                    trimmed.toLowerCase().includes(l.name.toLowerCase())
            );
        if (!foundLanguage) {
            toast.error('Language not found. Please select from the dropdown.');
            return;
        }
        setSavingLanguage(true);
        try {
            const isLegacyLead =
                selectedClient?.lead_type === 'legacy' || selectedClient?.id?.toString().startsWith('legacy_');
            const tableName = isLegacyLead ? 'leads_lead' : 'leads';
            const clientId = isLegacyLead ? selectedClient.id.toString().replace('legacy_', '') : selectedClient.id;

            const payload: Record<string, unknown> = isLegacyLead
                ? { language_id: foundLanguage.id }
                : { language: foundLanguage.name, language_id: foundLanguage.id };

            const { error } = await supabase.from(tableName).update(payload).eq('id', clientId);

            if (error) throw error;
            toast.success('Language updated');
            setShowLanguageModal(false);
            setShowLanguageDropdown(false);
            setLanguageInputValue('');
            if (refreshClientData) await refreshClientData(selectedClient.id);
        } catch (error) {
            console.error(error);
            toast.error('Failed to update language');
        } finally {
            setSavingLanguage(false);
        }
    };

    const handleSaveTopic = async () => {
        if (!selectedClient) return;
        const nextTopic = topicInputValue.trim();
        setSavingTopic(true);
        try {
            const isLegacyLead =
                selectedClient?.lead_type === 'legacy' || selectedClient?.id?.toString().startsWith('legacy_');
            const tableName = isLegacyLead ? 'leads_lead' : 'leads';
            const clientId = isLegacyLead ? selectedClient.id.toString().replace('legacy_', '') : selectedClient.id;

            const { error } = await supabase.from(tableName).update({ topic: nextTopic }).eq('id', clientId);

            if (error) throw error;
            toast.success('Topic updated');
            setShowTopicModal(false);
            setTopicInputValue('');
            if (refreshClientData) await refreshClientData(selectedClient.id);
        } catch (error) {
            console.error(error);
            toast.error('Failed to update topic');
        } finally {
            setSavingTopic(false);
        }
    };

    const displayEmail = legacyContactInfo.email || selectedClient?.email;
    const displayPhone = legacyContactInfo.phone || selectedClient?.phone;
    const displayMobile = selectedClient?.mobile;

    const copyContactValue = useCallback(async (value: string, label: string) => {
        const trimmed = value?.trim();
        if (!trimmed) return;
        try {
            await navigator.clipboard.writeText(trimmed);
            toast.success(`${label} copied`);
        } catch {
            toast.error(`Could not copy ${label.toLowerCase()}`);
        }
    }, []);

    const openCallModal = useCallback(
        (phone: string) => {
            const trimmed = phone?.trim();
            if (!trimmed || trimmed === '---') {
                toast.error('No phone number');
                return;
            }
            setCallPhoneNumber(trimmed);
            setCallContactName(selectedClient?.name || '');
            setIsCallModalOpen(true);
            setContactDetailsModalOpen(false);
        },
        [selectedClient?.name],
    );

    /** Always opens Call Options modal (direct / OneCom) — same as previous phone-tap behavior for supported regions, now for all numbers */
    const handleCallPrimaryPhone = useCallback(() => {
        if (!displayPhone) return;
        openCallModal(displayPhone);
    }, [displayPhone, openCallModal]);

    const openWhatsAppForNumber = useCallback(
        async (phone: string) => {
            const trimmed = phone?.trim();
            if (!trimmed || trimmed === '---') {
                toast.error('No phone number');
                return;
            }
            if (!onOpenWhatsAppForContact) {
                const digits = trimmed.replace(/\D/g, '');
                if (!digits) {
                    toast.error('Invalid phone number');
                    return;
                }
                window.open(`https://wa.me/${digits}`, '_blank');
                setContactDetailsModalOpen(false);
                return;
            }
            const isLegacyLead =
                selectedClient?.lead_type === 'legacy' || String(selectedClient?.id || '').startsWith('legacy_');
            const leadId = isLegacyLead
                ? String(selectedClient.id).replace(/^legacy_/, '')
                : selectedClient.id;

            try {
                const contacts = await fetchLeadContacts(leadId, isLegacyLead);
                const norm = (s: string) => s.replace(/[\s\-\(\)]/g, '').replace(/^\+/, '');
                const target = norm(trimmed);
                const matched: ContactInfo | undefined =
                    contacts.find(
                        (c) => norm(c.phone || '') === target || norm(c.mobile || '') === target,
                    ) ||
                    contacts.find((c) => c.isMain) ||
                    contacts[0];

                if (matched) {
                    onOpenWhatsAppForContact({
                        contact: matched,
                        leadId,
                        leadType: isLegacyLead ? 'legacy' : 'new',
                        lead_number: selectedClient?.lead_number,
                    });
                } else {
                    onOpenWhatsAppForContact({
                        leadOnly: true,
                        leadId,
                        leadType: isLegacyLead ? 'legacy' : 'new',
                        name: selectedClient?.name || '',
                        phone: trimmed,
                        email: displayEmail ?? null,
                        lead_number: selectedClient?.lead_number,
                    });
                }
                setContactDetailsModalOpen(false);
            } catch (e) {
                console.error(e);
                toast.error('Could not open WhatsApp');
            }
        },
        [onOpenWhatsAppForContact, displayEmail, selectedClient],
    );

    const handleHeaderWhatsAppClick = useCallback(async () => {
        if (!displayPhone) return;
        await openWhatsAppForNumber(displayPhone);
    }, [displayPhone, openWhatsAppForNumber]);

    const openEmailClient = useCallback((email: string) => {
        const trimmed = email?.trim();
        if (!trimmed) {
            toast.error('No email address');
            return;
        }
        window.open(`mailto:${trimmed}`, '_blank');
        setContactDetailsModalOpen(false);
    }, []);

    // Get the full category display name (subcategory + main category)
    const leadMetaChips = useMemo(
        () => {
            void sourceFetchNonce;
            const chips = resolveLeadMetaChips(selectedClient, {
                languages: allLanguages,
                categories: allCategories,
                sources: allSources,
            });
            const sourceFromMemo = resolvedNewLeadSource?.name?.trim();
            if (sourceFromMemo) chips.source = sourceFromMemo;
            return chips;
        },
        [
            selectedClient,
            allLanguages,
            allCategories,
            allSources,
            sourceFetchNonce,
            resolvedNewLeadSource,
        ],
    );

    useEffect(() => {
        if (!selectedClient?.id) return;
        if (leadMetaChips.language || leadMetaChips.source || leadMetaChips.category || leadMetaChips.topic) {
            writeResolvedLeadMeta(selectedClient, leadMetaChips);
        }
    }, [selectedClient, leadMetaChips]);

    const displayCategory = leadMetaChips.category || 'No Category';
    const displayLanguageChip = leadMetaChips.language || '---';
    const displayTopicChip = leadMetaChips.topic || '---';
    const displaySourceChip = leadMetaChips.source || '---';

    const filteredCategories = allCategories.filter((category) => {
        const categoryName = category.misc_maincategory?.name
            ? `${category.name} (${category.misc_maincategory.name})`
            : category.name;
        // Safely handle categoryInputValue being potentially undefined
        return categoryName.toLowerCase().includes((categoryInputValue || '').toLowerCase());
    });

    const filteredLanguages = allLanguages.filter((lang) =>
        lang.name.toLowerCase().includes((languageInputValue || '').toLowerCase())
    );

    const openMetaModal = (which: 'category' | 'language' | 'topic') => {
        setShowCategoryModal(which === 'category');
        setShowCategoryDropdown(false);
        setShowLanguageModal(which === 'language');
        setShowLanguageDropdown(false);
        setShowTopicModal(which === 'topic');
        if (which === 'category') setCategoryInputValue('');
        if (which === 'language') setLanguageInputValue('');
        if (which === 'topic') setTopicInputValue('');
    };

    // --- Render Helpers ---

    const getCurrencyName = (currencyId: string | number | null | undefined, accountingCurrencies?: any): string => {
        return resolveLeadCurrencyName(currencyId, accountingCurrencies, allCurrencies);
    };

    const headerTotalBadge = useMemo(() => {
        const isLegacyLead = selectedClient?.id?.toString().startsWith('legacy_');
        const numericCurrencyId = parseLeadCurrencyId((selectedClient as any)?.currency_id) ?? 1;
        const currency = getCurrencyName(
            numericCurrencyId,
            (selectedClient as any)?.accounting_currencies,
        );
        const leadKey = clientsTabCacheLeadKey(selectedClient);
        const held = readClientsTabCache<ClientHeaderCostCacheSlice>(leadKey, 'header');
        const planPending = hasPaymentPlan == null;

        let contractBase: number | null = null;
        if (hasPaymentPlan === true) {
            if (paymentPlanBaseTotal != null) contractBase = Number(paymentPlanBaseTotal) || 0;
        } else if (hasPaymentPlan === false) {
            contractBase = unlockedLeadContractBase(selectedClient);
        } else if (paymentPlanBaseTotal != null) {
            contractBase = Number(paymentPlanBaseTotal) || 0;
        }

        const subcontractorFee = Number(selectedClient?.subcontractor_fee ?? 0);
        const firmExpense = Math.max(0, Number(firmPaidExpenseTotal) || 0);
        const totalReductions =
            (subcontractorFee > 0 ? subcontractorFee : 0) + firmExpense;

        const potentialAmount = isLegacyLead
            ? Number((selectedClient as any)?.potential_total ?? 0) || 0
            : Number(
                  (selectedClient as any)?.potential_value ??
                      (selectedClient as any)?.potential_total ??
                      0
              ) || 0;
        const potentialApplicantsMeeting = isLegacyLead
            ? Number(
                  (selectedClient as any)?.potential_applicants_meeting ??
                      (selectedClient as any)?.potential_applicants ??
                      0
              ) || 0
            : Number((selectedClient as any)?.potential_applicants_meeting ?? 0) || 0;

        const unpaidOutstandingPair =
            unpaidByCurrency === null
                ? null
                : pickUnpaidBaseAndVatForCurrency(unpaidByCurrency, currency);
        const unpaidGross =
            unpaidOutstandingPair != null
                ? unpaidOutstandingPair.base + unpaidOutstandingPair.vat
                : 0;
        const unpaidExpenseAmount = pickUnpaidExpenseForCurrency(unpaidExpenseByCurrency, currency);

        const computeVat = (baseAmount: number) => {
            let vatAmount = 0;
            let shouldShowVAT = false;
            const vatValue = selectedClient?.vat;
            if (isLegacyLead) {
                shouldShowVAT = true;
                if (vatValue !== null && vatValue !== undefined) {
                    const vatStr = String(vatValue).toLowerCase().trim();
                    if (vatStr === 'false' || vatStr === '0' || vatStr === 'no' || vatStr === 'excluded') {
                        shouldShowVAT = false;
                    }
                }
                if (hasPaymentPlan === true && paymentPlanVatTotal !== null) {
                    vatAmount = Number(paymentPlanVatTotal) || 0;
                    shouldShowVAT = vatAmount > 0;
                } else if (hasPaymentPlan === false && shouldShowVAT) {
                    const vatRate = getVatRateForLegacyLead(
                        (selectedClient as any)?.date_signed || (selectedClient as any)?.created_at || null,
                    );
                    vatAmount = Math.round((baseAmount * vatRate) * 100) / 100;
                } else if (shouldShowVAT) {
                    vatAmount = Number((selectedClient as any)?.vat_value ?? 0) || 0;
                    if (!vatAmount) shouldShowVAT = false;
                }
            } else {
                shouldShowVAT = true;
                if (vatValue !== null && vatValue !== undefined) {
                    const vatStr = String(vatValue).toLowerCase().trim();
                    if (vatStr === 'false' || vatStr === '0' || vatStr === 'no' || vatStr === 'excluded') {
                        shouldShowVAT = false;
                    }
                }
                if (shouldShowVAT) {
                    if (selectedClient?.vat_value && Number(selectedClient.vat_value) > 0) {
                        vatAmount = Number(selectedClient.vat_value);
                    } else {
                        const vatRate = getVatRateForLegacyLead(
                            (selectedClient as any)?.date_signed || (selectedClient as any)?.created_at || null,
                        );
                        vatAmount = baseAmount * vatRate;
                    }
                }
            }
            return { vatAmount, shouldShowVAT };
        };

        if (planPending && contractBase == null) {
            if (held?.displayMainAmount != null) {
                const vatAmount = Number(held.displayVatAmount) || 0;
                const baseAmount = held.displayMainAmount;
                const netWithoutFeesAndExpenses = null;
                return {
                    currency,
                    isLegacyLead,
                    planPending: true,
                    amountReady: true,
                    showLocked: held.displayHasPlan === true,
                    baseAmount,
                    mainAmount: held.displayMainAmount,
                    netWithoutFeesAndExpenses,
                    vatAmount,
                    shouldShowVAT: vatAmount > 0,
                    subcontractorFee,
                    potentialAmount,
                    potentialApplicantsMeeting,
                    unpaidOutstandingPair,
                    unpaidGross,
                    unpaidExpenseAmount,
                    hasExpandableFinancialDetails:
                        (paymentPlanExpenseNoVatTotal != null && paymentPlanExpenseNoVatTotal > 0) ||
                        potentialAmount > 0 ||
                        potentialApplicantsMeeting > 0 ||
                        unpaidGross > 0 ||
                        unpaidExpenseAmount > 0,
                };
            }
            return {
                currency,
                isLegacyLead,
                planPending: true,
                amountReady: false,
                showLocked: false,
                baseAmount: 0,
                mainAmount: 0,
                netWithoutFeesAndExpenses: null as number | null,
                vatAmount: 0,
                shouldShowVAT: false,
                subcontractorFee,
                potentialAmount,
                potentialApplicantsMeeting,
                unpaidOutstandingPair,
                unpaidGross,
                unpaidExpenseAmount,
                hasExpandableFinancialDetails: false,
            };
        }

        const baseAmount = contractBase ?? 0;
        const mainAmount = Math.max(0, baseAmount - totalReductions);
        const netWithoutFeesAndExpenses =
            totalReductions > 0 ? baseAmount : null;
        const { vatAmount, shouldShowVAT } = planPending
            ? {
                  vatAmount: Number(held?.displayVatAmount) || 0,
                  shouldShowVAT: (Number(held?.displayVatAmount) || 0) > 0,
              }
            : computeVat(baseAmount);

        return {
            currency,
            isLegacyLead,
            planPending,
            amountReady: true,
            showLocked: hasPaymentPlan === true || (planPending && held?.displayHasPlan === true),
            baseAmount,
            mainAmount,
            netWithoutFeesAndExpenses,
            vatAmount,
            shouldShowVAT,
            subcontractorFee,
            potentialAmount,
            potentialApplicantsMeeting,
            unpaidOutstandingPair,
            unpaidGross,
            unpaidExpenseAmount,
            hasExpandableFinancialDetails:
                netWithoutFeesAndExpenses !== null ||
                (paymentPlanExpenseNoVatTotal != null && paymentPlanExpenseNoVatTotal > 0) ||
                potentialAmount > 0 ||
                potentialApplicantsMeeting > 0 ||
                unpaidGross > 0 ||
                unpaidExpenseAmount > 0,
        };
        // getCurrencyName closes over allCurrencies
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        selectedClient,
        hasPaymentPlan,
        paymentPlanBaseTotal,
        paymentPlanVatTotal,
        paymentPlanExpenseNoVatTotal,
        firmPaidExpenseTotal,
        unpaidByCurrency,
        unpaidExpenseByCurrency,
        allCurrencies,
    ]);

    useEffect(() => {
        if (!headerTotalBadge.amountReady || headerTotalBadge.planPending) return;
        patchHeaderCostCache(clientsTabCacheLeadKey(selectedClient), {
            displayMainAmount: headerTotalBadge.mainAmount,
            displayVatAmount: headerTotalBadge.shouldShowVAT ? headerTotalBadge.vatAmount : 0,
            displayHasPlan: hasPaymentPlan === true,
            firmPaidExpenseTotal,
        });
    }, [
        headerTotalBadge.amountReady,
        headerTotalBadge.planPending,
        headerTotalBadge.mainAmount,
        headerTotalBadge.shouldShowVAT,
        headerTotalBadge.vatAmount,
        hasPaymentPlan,
        firmPaidExpenseTotal,
        selectedClient,
    ]);

    // Lead Number
    const renderLeadNumber = () => {
        if (!selectedClient) return '---';
        // Linked-only subleads (non-self linked_master_lead): show actual lead number only, no "/" or suffix, no "legacy_" prefix
        const hasLinkedMasterLead = isNonSelfLinkedMasterLead(
          selectedClient.linked_master_lead,
          selectedClient.lead_number,
          selectedClient.id
        );
        if (hasLinkedMasterLead) {
            let raw = selectedClient.lead_number || selectedClient.manual_id || selectedClient.id || '---';
            let rawStr = raw.toString();
            // Remove legacy_ prefix so we show e.g. 193599 not legacy_193599
            if (rawStr.startsWith('legacy_')) rawStr = rawStr.replace(/^legacy_/, '');
            // For linked leads never show "/" and suffix - use actual lead id if stored value looks like master/suffix
            if (rawStr.includes('/')) {
                const idStr = (selectedClient.id ?? '').toString().replace(/^legacy_/, '');
                if (idStr && idStr !== '---') rawStr = idStr;
                else rawStr = rawStr.split('/')[0];
            }
            const isSuccessStage = selectedClient.stage === '100' || selectedClient.stage === 100;
            if (isSuccessStage && rawStr && !rawStr.startsWith('C')) {
                return rawStr.replace(/^L/, 'C');
            }
            return rawStr;
        }

        let displayNumber = selectedClient.lead_number || selectedClient.manual_id || selectedClient.id || '---';
        const displayStr = displayNumber.toString();
        const hasExistingSuffix = displayStr.includes('/');
        let baseNumber = hasExistingSuffix ? displayStr.split('/')[0] : displayStr;
        const existingSuffix = hasExistingSuffix ? displayStr.split('/').slice(1).join('/') : null;

        const isSuccessStage = selectedClient.stage === '100' || selectedClient.stage === 100;
        if (isSuccessStage && baseNumber && !baseNumber.toString().startsWith('C')) {
            baseNumber = baseNumber.toString().replace(/^L/, 'C');
        }

        // Add /1 suffix to master leads (frontend only)
        // A lead is a master if: it has no master_id AND it has subleads (count > 0).
        // Do not use isMasterLead alone — Clients used to set it optimistically before fetch, which caused flicker.
        const hasNoMasterId = !selectedClient.master_id || String(selectedClient.master_id).trim() === '';
        const hasSubLeads = (subLeadsCount || 0) > 0;
        const isMasterWithSubLeads = hasNoMasterId && hasSubLeads;

        // Only add /1 to master leads that actually have subleads
        if (isMasterWithSubLeads && !hasExistingSuffix) {
            return `${baseNumber}/1`;
        } else if (hasExistingSuffix) {
            return `${baseNumber}/${existingSuffix}`;
        }
        return baseNumber;
    };

    // Get lead identifier for navigation (same logic as TimelineHistoryButtons)
    const getLeadIdentifier = (): string | null => {
        if (!selectedClient) return null;

        const isLegacy = selectedClient.lead_type === 'legacy' || selectedClient.id?.toString().startsWith('legacy_');
        if (isLegacy) {
            const clientId = selectedClient.id?.toString();
            const directId = (selectedClient as any).id;
            if (typeof directId === 'number') {
                return directId.toString();
            }
            if (clientId && clientId.startsWith('legacy_')) {
                return clientId.replace('legacy_', '');
            }
            return clientId;
        }
        return selectedClient.lead_number || (selectedClient as any).manual_id || null;
    };

    const leadIdentifier = getLeadIdentifier();

    const shareableEmployees = useMemo(() => {
        const term = shareSearch.trim().toLowerCase();
        return (employeesToUse || [])
            .filter((emp: any) => {
                const id = Number(emp?.id);
                if (!Number.isFinite(id) || id <= 0) return false;
                if (currentShareEmployeeId && id === currentShareEmployeeId) return false;
                const name = String(emp.display_name || emp.official_name || '').trim();
                if (!name) return false;
                if (!term) return true;
                return name.toLowerCase().includes(term);
            })
            .sort((a: any, b: any) =>
                String(a.display_name || '').localeCompare(String(b.display_name || ''), undefined, { sensitivity: 'base' }),
            );
    }, [employeesToUse, shareSearch, currentShareEmployeeId]);

    const handleShareLead = async () => {
        if (!shareSelectedEmployeeId || shareSubmitting) return;
        const routeId = String(leadIdentifier || selectedClient?.lead_number || '').trim();
        if (!routeId) {
            toast.error('Lead number required');
            return;
        }
        setShareSubmitting(true);
        try {
            let fromId = currentShareEmployeeId;
            if (!fromId) {
                fromId = await resolveAuthEmployeeId(user?.id);
                setCurrentShareEmployeeId(fromId);
            }
            if (!fromId) {
                toast.error('Could not identify your employee profile');
                return;
            }
            const selected = employeesToUse.find((emp: any) => Number(emp.id) === shareSelectedEmployeeId);
            const result = await createLeadShare({
                leadNumber: String(selectedClient?.lead_number || routeId).trim(),
                leadRouteId: buildCalendarClientRoute(selectedClient),
                leadName: selectedClient?.name ? String(selectedClient.name).trim() : null,
                sharedByEmployeeId: fromId,
                sharedWithEmployeeId: shareSelectedEmployeeId,
            });
            if (!result.ok) {
                toast.error(result.message);
                return;
            }
            toast.success(`Shared with ${selected?.display_name || 'employee'}`);
            closeHeaderActionsMenu();
        } catch (error) {
            console.error('Share lead failed:', error);
            toast.error('Could not share lead');
        } finally {
            setShareSubmitting(false);
        }
    };

    const handleTimelineClick = () => {
        if (!leadIdentifier) return;
        const encodedIdentifier = encodeURIComponent(String(leadIdentifier));
        navigate(`/clients/${encodedIdentifier}/timeline`);
    };

    const handleHistoryClick = () => {
        if (!leadIdentifier) return;
        const encodedIdentifier = encodeURIComponent(String(leadIdentifier));
        navigate(`/clients/${encodedIdentifier}/history`);
    };

    const handleDuplicatesClick = () => {
        if (!leadIdentifier) return;
        const encodedIdentifier = encodeURIComponent(String(leadIdentifier));
        navigate(`/clients/${encodedIdentifier}/duplicates`);
        setIsDuplicateDropdownOpen(false);
    };

    const goToFlaggedExpertOpinion = () => {
        onSwitchClientTab?.('expert');
        window.setTimeout(() => {
            document.getElementById('expert-opinion-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 400);
    };
    const goToFlaggedHandlerOpinion = () => {
        onSwitchClientTab?.('expert');
        window.setTimeout(() => {
            document.getElementById('handler-opinion-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 400);
    };
    const goToFlaggedInteractions = () => {
        onSwitchClientTab?.('interactions');
    };

    const openFlaggedConversationsModal = () => {
        onSwitchClientTab?.('interactions');
        // Give InteractionsTab a moment to mount after tab switch.
        window.setTimeout(() => {
            window.dispatchEvent(new Event('rmq:open-flagged-conversations'));
        }, 250);
    };

    const openPinnedInteractionsModal = () => {
        setPinnedInteractionsModalOpen(true);
        void refreshPinnedInteractions();
    };

    const handleViewPinnedInteraction = (pin: LeadPinnedInteractionRow) => {
        setPinnedInteractionsModalOpen(false);
        onSwitchClientTab?.('interactions');
        window.setTimeout(() => {
            dispatchScrollToPinnedInteraction(pin.channel, pin.external_id);
        }, 280);
    };

    const handleUnpinPinnedInteraction = async (pin: LeadPinnedInteractionRow) => {
        const { error } = await unpinLeadInteractionById(supabase, pin.id);
        if (error) {
            toast.error(error);
            return;
        }
        setPinnedInteractions((prev) => prev.filter((row) => row.id !== pin.id));
        window.dispatchEvent(
            new CustomEvent(PINNED_INTERACTIONS_CHANGED_EVENT, {
                detail: { leadKey: selectedClient?.id != null ? String(selectedClient.id) : null },
            }),
        );
        toast.success('Removed from saved interactions');
    };

    if (!selectedClient) return null;

    const headerDocsLeadNumber =
        String(selectedClient.lead_number ?? '').trim() ||
        String((selectedClient as any)?.manual_id ?? '').trim();

    const openHeaderDocumentsModal = () => {
        if (!headerDocsLeadNumber) {
            toast.error('Add a lead number to use OneDrive documents.');
            return;
        }
        setHeaderDocumentsModalOpen(true);
    };

    const flaggedByLabel = userFullName ?? user?.email ?? 'You';

    // `flaggedConversationCount` is kept in sync by InteractionsTab and represents the total flagged items
    // on this lead (flagged conversations + flagged lead fields). Fallback to leadField-only flags when
    // InteractionsTab hasn't reported yet.
    const totalFlagBadge =
        (flaggedConversationCount > 0 ? flaggedConversationCount : leadFieldFlagMeta.size) + rmqMessageFlagCount;
    const tagsCount = leadTags.length;

    const applicantsCount =
        (selectedClient as any)?.no_of_applicants || selectedClient?.number_of_applicants_meeting || null;

    const renderClientMetaBadges = (variant: 'floating' | 'connected' = 'floating') => {
        const badge = variant === 'connected' ? META_BADGE_CONNECTED : META_BADGE_WHITE;
        const badgeBtn = variant === 'connected' ? META_BADGE_CONNECTED_BTN : META_BADGE_WHITE_BTN;
        const languageIcon = META_ICON_LANGUAGE;
        const sourceIcon = META_ICON_SOURCE;
        const applicantsIcon = META_ICON_APPLICANTS;
        const categoryIcon = META_ICON_CATEGORY;
        const topicIcon = META_ICON_TOPIC;
        const idleHover =
            disableCategoryModal
                ? variant === 'connected'
                    ? 'cursor-default'
                    : 'cursor-default hover:shadow-sm'
                : '';

        return (
            <>
                <button
                    type="button"
                    data-client-meta-language
                    className={`${badgeBtn} ${idleHover}`}
                    onClick={disableCategoryModal ? undefined : () => openMetaModal('language')}
                >
                    <GlobeAltIcon className={languageIcon} aria-hidden />
                    <span className="truncate">{displayLanguageChip}</span>
                </button>
                <span className={badge}>
                    <LinkIcon className={sourceIcon} aria-hidden />
                    <span className="min-w-0 max-w-[12rem] truncate sm:max-w-[14rem] lg:max-w-[16rem]">
                        {displaySourceChip}
                    </span>
                </span>
                {applicantsCount != null && Number(applicantsCount) > 0 ? (
                    <span className={badge} title="Applicants">
                        <UserIcon className={applicantsIcon} aria-hidden />
                        {applicantsCount}
                    </span>
                ) : null}
                <button
                    type="button"
                    className={`${badgeBtn} ${idleHover}`}
                    onClick={disableCategoryModal ? undefined : () => openMetaModal('category')}
                >
                    <RectangleStackIcon className={categoryIcon} aria-hidden />
                    <span className="min-w-0 max-w-[12rem] truncate sm:max-w-[14rem] lg:max-w-[16rem]">
                        {displayCategory}
                    </span>
                </button>
                <button
                    type="button"
                    className={`${badgeBtn} ${idleHover}`}
                    onClick={disableCategoryModal ? undefined : () => openMetaModal('topic')}
                >
                    <DocumentTextIcon className={topicIcon} aria-hidden />
                    <span className="min-w-0 max-w-[12rem] truncate sm:max-w-[14rem] lg:max-w-[16rem]">
                        {displayTopicChip}
                    </span>
                </button>
            </>
        );
    };

    const renderMoreActionRow = ({
        icon: Icon,
        label,
        onClick,
        iconTone = 'default',
        className = '',
    }: {
        icon: React.ComponentType<{ className?: string }>;
        label: React.ReactNode;
        onClick: () => void;
        iconTone?: 'default' | 'success' | 'danger' | 'warning' | 'primary' | 'purple';
        className?: string;
    }) => {
        return (
            <button type="button" className={`${MORE_ACTIONS_SHEET_ITEM} ${className}`.trim()} onClick={onClick}>
                <span className={MORE_ACTIONS_ICON_BOX}>
                    <Icon className="h-5 w-5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">{label}</span>
                <ChevronRightIcon
                    className="h-4 w-4 shrink-0 text-neutral-400 transition-colors group-hover:text-black"
                    aria-hidden
                />
            </button>
        );
    };

    const renderMoreActionSection = (title: string, children: React.ReactNode) => {
        if (!children) return null;
        return (
            <section className="flex flex-col gap-2">
                <p className={MORE_ACTIONS_SECTION_LABEL}>{title}</p>
                <div className="flex flex-col gap-2">{children}</div>
            </section>
        );
    };

    const moreActionsMenuItems = (
        <div className="flex flex-col gap-5">
            {duplicateContacts && duplicateContacts.length > 0 && !hideActionsDropdown
                ? renderMoreActionSection(
                      'Attention',
                      renderMoreActionRow({
                          icon: DocumentDuplicateIcon,
                          label: `Duplicate contacts (${duplicateContacts.length})`,
                          iconTone: 'warning',
                          onClick: () => {
                              handleDuplicatesClick();
                              closeMoreActionsSheet();
                          },
                      }),
                  )
                : null}

            {!hideActionsDropdown ? (
                <>
                    {renderMoreActionSection(
                        'Lead',
                        <>
                            {renderMoreActionRow({
                                icon: isInHighlightsState ? StarIcon : StarIcon,
                                label: isInHighlightsState ? 'Remove from Highlights' : 'Add to Highlights',
                                onClick: async () => {
                                    if (!selectedClient?.id) return;
                                    const isLegacyLead =
                                        selectedClient.lead_type === 'legacy' ||
                                        selectedClient.id?.toString().startsWith('legacy_');
                                    const leadId = isLegacyLead
                                        ? typeof selectedClient.id === 'string'
                                            ? parseInt(selectedClient.id.replace('legacy_', ''), 10)
                                            : selectedClient.id
                                        : selectedClient.id;
                                    const leadNumber = selectedClient.lead_number || selectedClient.id?.toString();
                                    if (isInHighlightsState) {
                                        await removeFromHighlights(leadId, isLegacyLead);
                                    } else {
                                        await addToHighlights(leadId, leadNumber, isLegacyLead);
                                    }
                                    closeMoreActionsSheet();
                                },
                            })}
                            {renderMoreActionRow({
                                icon: PencilSquareIcon,
                                label: 'Edit Details',
                                iconTone: 'primary',
                                onClick: () => {
                                    closeMoreActionsSheet();
                                    handleOpenEditLeadDrawer();
                                },
                            })}
                            {renderMoreActionRow({
                                icon: LinkIcon,
                                label: 'Client portal',
                                iconTone: 'default',
                                onClick: () => {
                                    setClientPortalModalOpen(true);
                                    closeMoreActionsSheet();
                                },
                            })}
                            {renderMoreActionRow({
                                icon: Squares2X2Icon,
                                label: 'Create Sub-Lead',
                                iconTone: 'default',
                                onClick: () => {
                                    setShowSubLeadDrawer(true);
                                    closeMoreActionsSheet();
                                },
                            })}
                            {onCombineLeads
                                ? renderMoreActionRow({
                                      icon: LinkIcon,
                                      label: 'Combine leads',
                                      iconTone: 'default',
                                      onClick: () => {
                                          onCombineLeads();
                                          closeMoreActionsSheet();
                                      },
                                  })
                                : null}
                        </>,
                    )}

                    {renderMoreActionSection(
                        'Status',
                        (() => {
                            const isLegacy =
                                selectedClient?.lead_type === 'legacy' ||
                                selectedClient?.id?.toString().startsWith('legacy_');
                            const isUnactivated = isLegacy
                                ? selectedClient?.status === 10
                                : selectedClient?.status === 'inactive';
                            return isUnactivated
                                ? renderMoreActionRow({
                                      icon: CheckCircleIcon,
                                      label: 'Activate Case',
                                      onClick: () => {
                                          handleActivation();
                                          closeMoreActionsSheet();
                                      },
                                  })
                                : renderMoreActionRow({
                                      icon: NoSymbolIcon,
                                      label: 'Deactivate / Spam',
                                      onClick: () => {
                                          setShowUnactivationModal(true);
                                          closeMoreActionsSheet();
                                      },
                                  });
                        })(),
                    )}

                    {isSuperuser
                        ? renderMoreActionSection(
                              'Danger zone',
                              renderMoreActionRow({
                                  icon: TrashIcon,
                                  label: 'Delete Lead',
                                  onClick: () => {
                                      setShowDeleteModal(true);
                                      closeMoreActionsSheet();
                                  },
                              }),
                          )
                        : null}
                </>
            ) : null}
        </div>
    );

    const renderMoreActionsTrigger = (triggerClassName: string) => (
        <button
            type="button"
            className={triggerClassName}
            aria-label="More actions"
            onClick={() => setMoreActionsSheetOpen(true)}
        >
            <EllipsisHorizontalIcon className={HEADER_ACTION_ICON} />
        </button>
    );

    const runHeaderAction = useCallback(
        (action: () => void) => {
            closeHeaderActionsMenu();
            action();
        },
        [closeHeaderActionsMenu],
    );

    const getHeaderActionItems = () => {
        const items: Array<{
            key: string;
            label: string;
            title?: string;
            tone: keyof typeof HEADER_ACTIONS_FAB_TONE;
            disabled?: boolean;
            onClick: () => void;
            children: React.ReactNode;
            count?: number;
        }> = [];

        if (displayPhone) {
            items.push({
                key: 'call',
                label: 'Call',
                title: 'Call',
                tone: 'slate',
                onClick: () => runHeaderAction(handleCallPrimaryPhone),
                children: <PhoneArrowUpRightIcon className={HEADER_ACTION_ICON} aria-hidden />,
            });
        }

        if (onOpenWhatsAppForContact && displayPhone) {
            items.push({
                key: 'whatsapp',
                label: 'WhatsApp',
                title: 'WhatsApp',
                tone: 'emerald',
                onClick: () => runHeaderAction(() => void handleHeaderWhatsAppClick()),
                children: <FaWhatsapp className={HEADER_ACTION_ICON} aria-hidden />,
            });
        }

        if (displayEmail) {
            items.push({
                key: 'email',
                label: 'Email',
                title: 'Email',
                tone: 'sky',
                onClick: () =>
                    runHeaderAction(() => window.open(`mailto:${displayEmail}`, '_blank')),
                children: <EnvelopeIcon className={HEADER_ACTION_ICON} aria-hidden />,
            });
        }

        if (!hideHistoryAndTimeline) {
            items.push(
                {
                    key: 'timeline',
                    label: 'Timeline',
                    title: 'View Timeline',
                    tone: 'cyan',
                    onClick: () => runHeaderAction(handleTimelineClick),
                    children: <ClockIcon className={HEADER_ACTION_ICON} aria-hidden />,
                },
                {
                    key: 'history',
                    label: 'History',
                    title: 'View History',
                    tone: 'slate',
                    onClick: () => runHeaderAction(handleHistoryClick),
                    children: <ArchiveBoxIcon className={HEADER_ACTION_ICON} aria-hidden />,
                },
            );
        }

        items.push({
            key: 'documents',
            label: 'Documents',
            title: headerDocsLeadNumber
                ? 'Case documents on OneDrive'
                : 'Lead number required',
            tone: 'indigo',
            disabled: !headerDocsLeadNumber,
            onClick: () => runHeaderAction(openHeaderDocumentsModal),
            count: headerSupabaseDocumentsCount,
            children: <DocumentArrowUpIcon className={HEADER_ACTION_ICON} aria-hidden />,
        });

        items.push({
            key: 'create-word',
            label: 'Create Word document',
            title: leadIdentifier
                ? 'Create a Word document with letterhead'
                : 'Lead number required',
            tone: 'indigo',
            disabled: !leadIdentifier,
            onClick: () =>
                runHeaderAction(() => {
                    if (!leadIdentifier) return;
                    navigate(`/clients/${encodeURIComponent(String(leadIdentifier))}/word-document`);
                }),
            children: <DocumentPlusIcon className={HEADER_ACTION_ICON} aria-hidden />,
        });

        items.push({
            key: 'tags',
            label: 'Tags',
            title: 'Tags',
            tone: 'purple',
            onClick: () => runHeaderAction(() => setTagsModalOpen(true)),
            count: tagsCount,
            children: <TagIcon className={HEADER_ACTION_ICON} aria-hidden />,
        });

        items.push({
            key: 'flags',
            label: 'Flags',
            title: publicUserId ? 'Flagged items on this lead' : 'Sign in to use flags',
            tone: 'amber',
            disabled: !publicUserId,
            onClick: () => runHeaderAction(openFlaggedConversationsModal),
            count: totalFlagBadge,
            children: <FlagIcon className={HEADER_ACTION_ICON} aria-hidden />,
        });

        return items;
    };

    const renderHeaderActionsSheetList = () => {
        const items = getHeaderActionItems();
        return (
            <div className="flex flex-col">
                <div data-keep-actions-open className="mb-1">
                    <button
                        type="button"
                        className={`${MORE_ACTIONS_SHEET_ITEM} ${sharePanelOpen ? 'bg-neutral-50' : ''}`}
                        onClick={() => {
                            setSharePanelOpen((open) => {
                                const next = !open;
                                if (next && !currentShareEmployeeId && user?.id) {
                                    void resolveAuthEmployeeId(user.id).then((id) => {
                                        if (id) setCurrentShareEmployeeId(id);
                                    });
                                }
                                if (!next) {
                                    setShareSearch('');
                                    setShareSelectedEmployeeId(null);
                                }
                                return next;
                            });
                        }}
                    >
                        <span className={MORE_ACTIONS_ICON_BOX}>
                            <ShareIcon className={HEADER_ACTION_ICON} aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">Share</span>
                        <ChevronDownIcon
                            className={`h-4 w-4 shrink-0 text-neutral-400 transition-transform ${sharePanelOpen ? 'rotate-180 text-black' : ''}`}
                            aria-hidden
                        />
                    </button>
                    {sharePanelOpen ? (
                        <div className="mt-1 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                            <label className="relative block">
                                <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" aria-hidden />
                                <input
                                    type="search"
                                    className="input input-bordered h-10 w-full rounded-lg border-neutral-200 bg-white pl-9 text-sm"
                                    placeholder="Search employee"
                                    value={shareSearch}
                                    onChange={(e) => setShareSearch(e.target.value)}
                                    autoFocus
                                />
                            </label>
                            <div className="mt-2 max-h-52 overflow-y-auto rounded-lg bg-white">
                                {shareableEmployees.length === 0 ? (
                                    <p className="px-3 py-4 text-center text-sm text-neutral-500">No employees found</p>
                                ) : (
                                    shareableEmployees.map((emp: any) => {
                                        const empId = Number(emp.id);
                                        const selected = shareSelectedEmployeeId === empId;
                                        const photoUrl = String(emp.photo_url || emp.photo || '').trim();
                                        const initials = getEmployeeInitials(emp.display_name);
                                        return (
                                            <button
                                                key={empId}
                                                type="button"
                                                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-neutral-50 ${selected ? 'bg-neutral-100' : ''}`}
                                                onClick={() => setShareSelectedEmployeeId(empId)}
                                            >
                                                {photoUrl ? (
                                                    <img src={photoUrl} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover bg-neutral-200" />
                                                ) : (
                                                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-[11px] font-semibold text-neutral-700">
                                                        {initials}
                                                    </span>
                                                )}
                                                <span className="min-w-0 flex-1 truncate font-medium text-black">{emp.display_name}</span>
                                            </button>
                                        );
                                    })
                                )}
                            </div>
                            <div className="mt-3 flex justify-end">
                            <button
                                type="button"
                                className="inline-flex h-9 items-center gap-1.5 rounded-full bg-black px-4 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
                                disabled={!shareSelectedEmployeeId || shareSubmitting}
                                onClick={() => void handleShareLead()}
                            >
                                <ShareIcon className="h-4 w-4" aria-hidden />
                                {shareSubmitting ? 'Sharing…' : 'Share'}
                            </button>
                            </div>
                        </div>
                    ) : null}
                </div>
                {items.map((item) => (
                    <button
                        key={item.key}
                        type="button"
                        className={`${MORE_ACTIONS_SHEET_ITEM} ${item.disabled ? 'pointer-events-none opacity-40' : ''}`}
                        disabled={item.disabled}
                        onClick={item.onClick}
                    >
                        <span className={MORE_ACTIONS_ICON_BOX}>{item.children}</span>
                        <span className="min-w-0 flex-1">{item.label}</span>
                        {item.count && item.count > 0 ? (
                            <span className={ACTIONS_DRAWER_COUNT}>
                                {item.count > 99 ? '99+' : item.count}
                            </span>
                        ) : (
                            <ChevronRightIcon className="h-4 w-4 shrink-0 text-neutral-400 transition-colors group-hover:text-black" aria-hidden />
                        )}
                    </button>
                ))}
            </div>
        );
    };

    const renderHeaderActionsMenuTrigger = (
        variant: 'floating' | 'connected' = 'floating',
    ) => {
        if (hideActionsDropdown) return null;
        const triggerClass =
            variant === 'connected' ? HEADER_ACTIONS_MENU_TRIGGER_CONNECTED : HEADER_ACTIONS_MENU_TRIGGER;
        return (
            <div className="relative z-40" ref={headerActionsMenuRef} data-header-actions-menu>
                <button
                    type="button"
                    className={`${triggerClass} ${headerActionsMenuOpen ? '!bg-black !text-white hover:!bg-neutral-800' : ''}`}
                    aria-label={headerActionsMenuOpen ? 'Close actions' : 'Open actions'}
                    aria-expanded={headerActionsMenuOpen}
                    aria-haspopup="dialog"
                    onClick={toggleHeaderActionsMenu}
                >
                    {headerActionsMenuOpen ? (
                        <XMarkIcon className="h-5 w-5 sm:h-6 sm:w-6" aria-hidden />
                    ) : (
                        <EllipsisVerticalIcon className="h-5 w-5 sm:h-6 sm:w-6" aria-hidden />
                    )}
                </button>
            </div>
        );
    };


    const needsDesktopStagePaymentBanner =
        !!showHandlerPaymentBanner &&
        !!selectedClient &&
        (((isStageNumeric && stageNumeric === 105) || Number((selectedClient as any)?.stage) === 105) &&
            shouldShowHandlerPaymentBanner(hasPaymentPlan, nextDuePayment));

    const renderDesktopStageLogicButtons = (opts?: { inline?: boolean }) => {
        const inline = opts?.inline === true;

                                        const isLegacy = selectedClient?.lead_type === 'legacy' || selectedClient?.id?.toString().startsWith('legacy_');
                                        const isUnactivated = isLegacy
                                            ? selectedClient?.status === 10
                                            : selectedClient?.status === 'inactive';
                                        if (isUnactivated) {
                                            return (
                                        <div className={`text-sm text-gray-600 ${inline ? 'px-1 py-0' : 'px-4 py-2'}`}>
                                            Please activate lead in actions first to see the stage buttons.
                                        </div>
                                            );
                                        }
                                        return (
                                        <>
                                            {/* Closed state check */}
                                            {selectedClient && (areStagesEquivalent(currentStageName, 'Case Closed') || (isStageNumeric && stageNumeric === 200)) ? (
                                                ((isStageNumeric && stageNumeric === 200) || Number((selectedClient as any)?.stage) === 200) ? (
                                                    null
                                                ) : (
                                                    <div className={`text-sm text-gray-600 ${inline ? 'px-1 py-0' : 'px-4 py-2'}`}>
                                                        No action available
                                                    </div>
                                                )
                                            ) : (
                                                <>
                                                    {/* Stage 105 payment banners stay on the dedicated row (not cramped into meta) */}
                                                    {!inline && showHandlerPaymentBanner &&
                                                    (((isStageNumeric && stageNumeric === 105) || Number((selectedClient as any)?.stage) === 105) &&
                                                        shouldShowHandlerPaymentBanner(hasPaymentPlan, nextDuePayment)) ? (
                                                        <div className="w-full flex justify-center">
                                                            {isMissingPaymentPlanBanner(hasPaymentPlan) ? (
                                                                <div className="w-full max-w-xl rounded-2xl border-0 bg-gray-50 px-4 py-3 text-slate-800">
                                                                    <div className="flex items-center justify-between gap-3">
                                                                        <div className="flex items-center gap-2 text-sm font-semibold">
                                                                            <ExclamationTriangleIcon className="h-5 w-5" />
                                                                            Missing payment plan
                                                                        </div>
                                                                        <div className="text-xs text-slate-500 whitespace-nowrap">
                                                                            Finances → payment plan
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            ) : (
                                                                <div className="w-full max-w-xl rounded-2xl border-0 bg-gray-50 px-4 py-3 text-slate-800">
                                                                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5">
                                                                        <div className="text-sm font-semibold">Next payment due</div>
                                                                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-end gap-2 sm:gap-3">
                                                                            <div className="text-sm tabular-nums text-right whitespace-nowrap">
                                                                                {(() => {
                                                                                    const isLegacy = !!(nextDuePayment as any)?.isLegacy;
                                                                                    const base = Number((nextDuePayment as any)?.value ?? 0);
                                                                                    const vat = Number(
                                                                                        isLegacy
                                                                                            ? (nextDuePayment as any)?.vat_value ?? 0
                                                                                            : (nextDuePayment as any)?.value_vat ?? 0
                                                                                    );
                                                                                    const gross =
                                                                                        (Number.isFinite(base) ? base : 0) + (Number.isFinite(vat) ? vat : 0);
                                                                                    const currency =
                                                                                        (nextDuePayment as any)?.currency ??
                                                                                        (nextDuePayment as any)?.accounting_currencies?.iso_code ??
                                                                                        (nextDuePayment as any)?.accounting_currencies?.name ??
                                                                                        '';
                                                                                    const dateRaw =
                                                                                        (nextDuePayment as any)?.due_date ?? (nextDuePayment as any)?.date ?? null;
                                                                                    const dateLabel = dateRaw ? new Date(dateRaw).toLocaleDateString() : '—';
                                                                                    const amountLabel = Number.isFinite(gross)
                                                                                        ? gross.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })
                                                                                        : '0';
                                                                                    return (
                                                                                        <span>
                                                                                            <span className="font-semibold">
                                                                                                {currency ? `${currency} ` : ''}
                                                                                                {amountLabel}
                                                                                            </span>
                                                                                            {' · '}
                                                                                            <span className="opacity-80">{dateLabel}</span>
                                                                                        </span>
                                                                                    );
                                                                                })()}
                                                                            </div>
                                                                            {(() => {
                                                                                const isLegacy = !!(nextDuePayment as any)?.isLegacy;
                                                                                const ready =
                                                                                    (nextDuePayment as any)?.ready_to_pay === true ||
                                                                                    ((isLegacy && !!(nextDuePayment as any)?.due_date) ? true : false);
                                                                                if (!ready) return null;
                                                                                const by =
                                                                                    (nextDuePayment as any)?.ready_to_pay_by_display_name ??
                                                                                    (nextDuePayment as any)?.tenants_employee?.display_name ??
                                                                                    (nextDuePayment as any)?.updated_by ??
                                                                                    (nextDuePayment as any)?.paid_by ??
                                                                                    '—';
                                                                                return (
                                                                                    <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                                                                                        <span className="btn btn-success btn-sm pointer-events-none gap-1.5 text-white rounded-full px-3">
                                                                                            <CheckCircleIcon className="h-4 w-4" />
                                                                                            Sent to finance
                                                                                        </span>
                                                                                        <span className="text-xs text-slate-500 whitespace-nowrap">
                                                                                            by <span className="font-semibold">{String(by)}</span>
                                                                                        </span>
                                                                                    </div>
                                                                                );
                                                                            })()}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    ) : null}

                                                    {/* Stages 60 / 70 / 100 / 105 / 110 / 150: sub-efforts; finalize only on 110 & 150 */}
                                                    {subEffortsStageFlags.showPickerLogAndModal && (
                                                        <>
                                                            <div className="flex items-center justify-end gap-3 flex-wrap">
                                                                {(onMeetingScheduleClick || onMeetingRescheduleClick) && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => {
                                                                            if (hasScheduledMeetings && onMeetingRescheduleClick) {
                                                                                onMeetingRescheduleClick();
                                                                            } else if (onMeetingScheduleClick) {
                                                                                onMeetingScheduleClick();
                                                                            }
                                                                        }}
                                                                        className={STAGE_ACTION_BTN_CLASS_COMPACT}
                                                                    >
                                                                        {hasScheduledMeetings ? (
                                                                            <ArrowPathIcon className="w-5 h-5" />
                                                                        ) : (
                                                                            <CalendarDaysIcon className="w-5 h-5" />
                                                                        )}
                                                                        {hasScheduledMeetings ? 'Reschedule Meeting' : 'Schedule Meeting'}
                                                                    </button>
                                                                )}
                                                                {subEffortsStageFlags.showFinalizeCaseWithSubEfforts && (
                                                                    <button
                                                                        onClick={() => updateLeadStage(200)}
                                                                        className={STAGE_ACTION_BTN_CLASS_COMPACT}
                                                                    >
                                                                        <CheckCircleIcon className="w-5 h-5" />
                                                                        Finalize Case
                                                                    </button>
                                                                )}
                                                                <button
                                                                    type="button"
                                                                    className={STAGE_ACTION_BTN_CLASS_COMPACT}
                                                                    onClick={() => openSubEffortsModal(null)}
                                                                    disabled={isLoadingLeadSubEfforts || isLoadingSubEfforts}
                                                                    title={
                                                                        !leadMiscCategoryId
                                                                            ? 'Set case type on the lead to load sub efforts'
                                                                            : undefined
                                                                    }
                                                                >
                                                                    <DocumentCheckIcon className="w-5 h-5" />
                                                                    Sub efforts
                                                                    {(leadSubEfforts?.length ?? 0) > 0 ? (
                                                                        <span className="badge badge-sm badge-primary min-h-5 h-5 shrink-0 px-1.5">
                                                                            {leadSubEfforts.length}
                                                                        </span>
                                                                    ) : null}
                                                                </button>
                                                            </div>
                                                        </>
                                                    )}

                                                    {/* Payment request sent Stage */}
                                                    {areStagesEquivalent(currentStageName, 'payment_request_sent') && handlePaymentReceivedNewClient && (
                                                        <button
                                                            onClick={handlePaymentReceivedNewClient}
                                                            className={STAGE_ACTION_BTN_CLASS_COMPACT}
                                                        >
                                                            <CheckCircleIcon className="w-5 h-5" />
                                                            Payment Received - new Client !!!
                                                        </button>
                                                    )}

                                                    {/* Another meeting Stage */}
                                                    {areStagesEquivalent(currentStageName, 'another_meeting') &&
                                                        !((isStageNumeric && stageNumeric === 105) || Number((selectedClient as any)?.stage) === 105) && (
                                                        <>
                                                            {setShowRescheduleDrawer && (
                                                                <button
                                                                    onClick={() => setShowRescheduleDrawer(true)}
                                                                    className={STAGE_ACTION_BTN_CLASS_COMPACT}
                                                                >
                                                                    <ArrowPathIcon className="w-5 h-5" />
                                                                    Meeting ReScheduling
                                                                </button>
                                                            )}
                                                            {handleStageUpdate && (
                                                                <button
                                                                    onClick={() => handleStageUpdate('Meeting Ended')}
                                                                    className={STAGE_ACTION_BTN_CLASS_COMPACT}
                                                                >
                                                                    <CheckCircleIcon className="w-5 h-5" />
                                                                    Meeting Ended
                                                                </button>
                                                            )}
                                                        </>
                                                    )}

                                                    {/* Meeting scheduled / Meeting rescheduling Stages */}
                                                    {!areStagesEquivalent(currentStageName, 'another_meeting') &&
                                                        (areStagesEquivalent(currentStageName, 'meeting_scheduled') ||
                                                            areStagesEquivalent(currentStageName, 'Meeting rescheduling') ||
                                                            (isStageNumeric && (stageNumeric === 55 || stageNumeric === 21))) && (
                                                            <>
                                                                {!areStagesEquivalent(currentStageName, 'meeting_scheduled') &&
                                                                    !areStagesEquivalent(currentStageName, 'Meeting rescheduling') &&
                                                                    handleScheduleMenuClick &&
                                                                    scheduleMenuLabel && (
                                                                        <button
                                                                            onClick={handleScheduleMenuClick}
                                                                            className={STAGE_ACTION_BTN_CLASS_COMPACT}
                                                                        >
                                                                            <CalendarDaysIcon className="w-5 h-5" />
                                                                            {scheduleMenuLabel}
                                                                        </button>
                                                                    )}
                                                                {setShowRescheduleDrawer && (
                                                                    <button
                                                                        onClick={() => setShowRescheduleDrawer(true)}
                                                                        className={STAGE_ACTION_BTN_CLASS_COMPACT}
                                                                    >
                                                                        <ArrowPathIcon className="w-5 h-5" />
                                                                        Meeting ReScheduling
                                                                    </button>
                                                                )}
                                                                {handleStageUpdate &&
                                                                    !areStagesEquivalent(currentStageName, 'another_meeting') &&
                                                                    (!(areStagesEquivalent(currentStageName, 'Meeting rescheduling') || (isStageNumeric && stageNumeric === 21)) || hasScheduledMeetings) && (
                                                                        <button
                                                                            onClick={() => handleStageUpdate('Meeting Ended')}
                                                                            className={STAGE_ACTION_BTN_CLASS_COMPACT}
                                                                        >
                                                                            <CheckCircleIcon className="w-5 h-5" />
                                                                            Meeting Ended
                                                                        </button>
                                                                    )}
                                                            </>
                                                        )}

                                                    {/* Waiting for meeting summary Stage */}
                                                    {areStagesEquivalent(currentStageName, 'waiting_for_mtng_sum') && openSendOfferModal && (
                                                        <button
                                                            onClick={openSendOfferModal}
                                                            className={STAGE_ACTION_BTN_CLASS_COMPACT}
                                                        >
                                                            <DocumentCheckIcon className="w-5 h-5" />
                                                            Send Price Offer
                                                        </button>
                                                    )}

                                                    {/* Communication Started Stage */}
                                                    {areStagesEquivalent(currentStageName, 'Communication started') &&
                                                        !((isStageNumeric && stageNumeric === 105) || Number((selectedClient as any)?.stage) === 105) && (
                                                        <>
                                                            {handleScheduleMenuClick && scheduleMenuLabel && (
                                                                <button
                                                                    onClick={handleScheduleMenuClick}
                                                                    className={STAGE_ACTION_BTN_CLASS_COMPACT}
                                                                >
                                                                    <CalendarDaysIcon className="w-5 h-5" />
                                                                    {scheduleMenuLabel}
                                                                </button>
                                                            )}
                                                            {handleStageUpdate && (
                                                                <button
                                                                    onClick={() => handleStageUpdate('Communication Started')}
                                                                    className={STAGE_ACTION_BTN_CLASS_COMPACT}
                                                                >
                                                                    <ChatBubbleLeftRightIcon className="w-5 h-5" />
                                                                    {isStageNumeric && stageNumeric === 15 ? 'Scheduling Notes' : 'Communication Started'}
                                                                </button>
                                                            )}
                                                        </>
                                                    )}

                                                    {/* Meeting summary + Agreement sent Stage */}
                                                    {areStagesEquivalent(currentStageName, 'Mtng sum+Agreement sent') && (
                                                        <>
                                                            {handleScheduleMenuClick && scheduleMenuLabel && (
                                                                <button
                                                                    onClick={handleScheduleMenuClick}
                                                                    className={STAGE_ACTION_BTN_CLASS_COMPACT}
                                                                >
                                                                    <CalendarDaysIcon className="w-5 h-5" />
                                                                    {scheduleMenuLabel}
                                                                </button>
                                                            )}
                                                            {handleOpenSignedDrawer && (
                                                                <button
                                                                    onClick={handleOpenSignedDrawer}
                                                                    className={CLIENT_SIGNED_STAGE_BTN_COMPACT}
                                                                >
                                                                    <HandThumbUpIcon className="w-5 h-5" />
                                                                    Client signed
                                                                </button>
                                                            )}
                                                            {handleOpenDeclinedDrawer && (
                                                                <button
                                                                    onClick={handleOpenDeclinedDrawer}
                                                                    className={CLIENT_DECLINED_STAGE_BTN_COMPACT}
                                                                >
                                                                    <HandThumbDownIcon className="w-5 h-5" />
                                                                    Client declined
                                                                </button>
                                                            )}
                                                            {openSendOfferModal && (
                                                                <button
                                                                    onClick={openSendOfferModal}
                                                                    className={STAGE_ACTION_BTN_CLASS_COMPACT}
                                                                >
                                                                    <PencilSquareIcon className="w-5 h-5" />
                                                                    Revised price offer
                                                                </button>
                                                            )}
                                                        </>
                                                    )}

                                                    {/* Stage 60: no action buttons (handler assignment is required and auto-advances to "Handler Set") */}

                                                    {/* Created / Precommunication — assign scheduler instead of stage buttons */}
                                                    {showAssignSchedulerInHeader && assignSchedulerContent ? (
                                                        <div className={`${inline ? 'shrink-0' : 'ml-auto shrink-0'} ${HEADER_ROLE_ASSIGN_WIDTH_CLASS}`}>
                                                            {assignSchedulerContent}
                                                        </div>
                                                    ) : null}

                                                    {/* General stages - Schedule Meeting and Communication Started */}
                                                    {selectedClient &&
                                                        !showAssignSchedulerInHeader &&
                                                        !areStagesEquivalent(currentStageName, 'Handler Set') &&
                                                        !areStagesEquivalent(currentStageName, 'Handler Started') &&
                                                        !areStagesEquivalent(currentStageName, 'Application submitted') &&
                                                        !areStagesEquivalent(currentStageName, 'payment_request_sent') &&
                                                        !areStagesEquivalent(currentStageName, 'another_meeting') &&
                                                        !areStagesEquivalent(currentStageName, 'meeting_scheduled') &&
                                                        !areStagesEquivalent(currentStageName, 'Meeting rescheduling') &&
                                                        !areStagesEquivalent(currentStageName, 'waiting_for_mtng_sum') &&
                                                        !areStagesEquivalent(currentStageName, 'Communication started') &&
                                                        !areStagesEquivalent(currentStageName, 'Mtng sum+Agreement sent') &&
                                                        !areStagesEquivalent(currentStageName, 'Success') &&
                                                        !areStagesEquivalent(currentStageName, 'handler_assigned') &&
                                                        !areStagesEquivalent(currentStageName, 'client_signed') &&
                                                        !areStagesEquivalent(currentStageName, 'client signed agreement') &&
                                                        !areStagesEquivalent(currentStageName, 'Client signed agreement') &&
                                                        !((isStageNumeric && stageNumeric === 105) || Number((selectedClient as any)?.stage) === 105) &&
                                                        !(isStageNumeric && (stageNumeric === 21 || stageNumeric === 55)) && (
                                                            <>
                                                                {handleScheduleMenuClick && scheduleMenuLabel && (
                                                                    <button
                                                                        onClick={handleScheduleMenuClick}
                                                                        className={STAGE_ACTION_BTN_CLASS_COMPACT}
                                                                    >
                                                                        <CalendarDaysIcon className="w-5 h-5" />
                                                                        {scheduleMenuLabel}
                                                                    </button>
                                                                )}
                                                                {handleStageUpdate && (
                                                                    <button
                                                                        onClick={() => handleStageUpdate('Communication Started')}
                                                                        className={STAGE_ACTION_BTN_CLASS_COMPACT}
                                                                    >
                                                                        <ChatBubbleLeftRightIcon className="w-5 h-5" />
                                                                        Communication Started
                                                                    </button>
                                                                )}
                                                            </>
                                                        )}
                                                </>
                                            )}
                                        </>
                                        );
    };

    const renderPinnedInteractionsButton = () => (
        <button
            type="button"
            className={HEADER_PINNED_BTN_CLASS}
            onClick={openPinnedInteractionsModal}
            title="Saved interactions"
            aria-label="Saved interactions"
        >
            {pinnedInteractions.length > 0 ? (
                <BookmarkIconSolid className="h-5 w-5" aria-hidden />
            ) : (
                <BookmarkIcon className="h-5 w-5" aria-hidden />
            )}
            {pinnedInteractions.length > 0 ? (
                <span className="absolute -right-0.5 -top-0.5 z-10 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-sky-600 px-0.5 text-[10px] font-bold text-white">
                    {pinnedInteractions.length > 99 ? '99+' : pinnedInteractions.length}
                </span>
            ) : null}
        </button>
    );

    const renderMetaBadgesRow = (
        variant: 'floating' | 'connected' = 'floating',
    ) => (
        <div className="relative z-30 flex w-full min-w-0 items-center gap-2 sm:gap-2.5">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 sm:gap-2">
                {renderClientMetaBadges(variant)}
            </div>
            <div className="hidden shrink-0 items-center justify-end gap-2 xl:flex xl:flex-nowrap">
                {!needsDesktopStagePaymentBanner ? renderDesktopStageLogicButtons({ inline: true }) : null}
                {renderPinnedInteractionsButton()}
            </div>
            <div className="flex shrink-0 items-center">
                {renderHeaderActionsMenuTrigger(variant)}
            </div>
        </div>
    );

    const renderTimelineHistoryButtons = (timelineBtnClass: string, historyBtnClass?: string) => {
        const historyClass = historyBtnClass ?? timelineBtnClass;
        return !hideHistoryAndTimeline ? (
            <>
                <button
                    type="button"
                    onClick={handleTimelineClick}
                    className={timelineBtnClass}
                    title="View Timeline"
                    aria-label="View Timeline"
                >
                    <ClockIcon className={HEADER_ACTION_ICON} aria-hidden />
                </button>
                <button
                    type="button"
                    onClick={handleHistoryClick}
                    className={historyClass}
                    title="View History"
                    aria-label="View History"
                >
                    <ArchiveBoxIcon className={HEADER_ACTION_ICON} aria-hidden />
                </button>
            </>
        ) : null;
    };

    const renderCompactHistoryIconRow = () => {
        const dup = duplicateContacts && duplicateContacts.length > 0;
        if (hideHistoryAndTimeline && !dup) return null;
        return (
            <div className="flex flex-wrap items-center justify-end gap-1">
                {headerDocsLeadNumber ? (
                    <button
                        type="button"
                        onClick={openHeaderDocumentsModal}
                        className="btn btn-ghost btn-sm relative h-auto min-h-0 overflow-visible p-1.5 text-gray-600 hover:bg-base-200 hover:text-gray-900"
                        title="Case documents on OneDrive"
                        aria-label="Case documents"
                    >
                        <DocumentArrowUpIcon className="h-6 w-6" />
                        {headerSupabaseDocumentsCount > 0 && (
                            <span
                                className="absolute -right-1 -top-1 z-10 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1 text-[11px] font-bold text-white"
                                style={{ backgroundColor: '#3a3a3a' }}
                            >
                                {headerSupabaseDocumentsCount > 99 ? '99+' : headerSupabaseDocumentsCount}
                            </span>
                        )}
                    </button>
                ) : null}
                {!hideHistoryAndTimeline && (
                    <>
                        <button
                            type="button"
                            onClick={handleTimelineClick}
                            className="btn btn-ghost btn-sm h-auto min-h-0 p-1.5 text-gray-600 hover:bg-base-200 hover:text-gray-900"
                            title="View Timeline"
                            aria-label="View Timeline"
                        >
                            <ClockIcon className="h-5 w-5" />
                        </button>
                        <button
                            type="button"
                            onClick={() => setTagsModalOpen(true)}
                            className={HEADER_TAGS_BTN_CLASS}
                            title="Tags"
                            aria-label="Tags"
                        >
                            <TagIcon className="h-5 w-5" />
                            {tagsCount > 0 && (
                                <span className="absolute -right-0.5 -top-0.5 z-10 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-purple-600 px-0.5 text-[10px] font-bold text-white">
                                    {tagsCount > 99 ? '99+' : tagsCount}
                                </span>
                            )}
                        </button>
                        <button
                            type="button"
                            onClick={openFlaggedConversationsModal}
                            disabled={!publicUserId}
                            className={HEADER_FLAGS_BTN_CLASS}
                            title={publicUserId ? 'Flagged items on this lead' : 'Sign in to use flags'}
                            aria-label="Flagged items"
                        >
                            <FlagIcon className="h-5 w-5" />
                            {totalFlagBadge > 0 && (
                                <span className="absolute -right-0.5 -top-0.5 z-10 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-amber-500 px-0.5 text-[10px] font-bold text-white">
                                    {totalFlagBadge > 99 ? '99+' : totalFlagBadge}
                                </span>
                            )}
                        </button>
                    </>
                )}
                {dup ? (
                    <button
                        type="button"
                        onClick={handleDuplicatesClick}
                        className={HEADER_DUPLICATES_BTN_CLASS}
                        title={
                            duplicateContacts.length === 1
                                ? `Duplicate Contact: ${duplicateContacts[0].contactName} in Lead ${duplicateContacts[0].leadNumber}`
                                : `${duplicateContacts.length} Duplicate Contacts`
                        }
                        aria-label="Duplicate contacts"
                    >
                        <DocumentDuplicateIcon className="h-5 w-5" />
                        <span className="absolute -right-0.5 -top-0.5 z-10 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-orange-500 px-0.5 text-[10px] font-bold text-white">
                            {duplicateContacts.length > 9 ? '9+' : duplicateContacts.length}
                        </span>
                    </button>
                ) : null}
                {!hideHistoryAndTimeline && (
                    <button
                        type="button"
                        onClick={handleHistoryClick}
                        className="btn btn-ghost btn-sm h-auto min-h-0 p-1.5 text-gray-600 hover:bg-base-200 hover:text-gray-900"
                        title="View History"
                        aria-label="View History"
                    >
                        <ArchiveBoxIcon className="h-5 w-5" />
                    </button>
                )}
            </div>
        );
    };

    const renderTagsFlagsButtons = (
        tagsBtnClass: string,
        flagsBtnClass: string,
        iconClass = 'h-5 w-5',
        duplicatesBtnClass?: string,
    ) => (
            <>
                {!hideHistoryAndTimeline ? (
                    <>
                        <button
                            type="button"
                            onClick={() => setTagsModalOpen(true)}
                            className={tagsBtnClass}
                            title="Tags"
                            aria-label="Tags"
                        >
                            <TagIcon className={iconClass} />
                            {tagsCount > 0 && (
                                <span className="absolute -right-0.5 -top-0.5 z-10 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-purple-600 px-0.5 text-[10px] font-bold text-white">
                                    {tagsCount > 99 ? '99+' : tagsCount}
                                </span>
                            )}
                        </button>
                        <button
                            type="button"
                            onClick={openFlaggedConversationsModal}
                            disabled={!publicUserId}
                            className={flagsBtnClass}
                            title={publicUserId ? 'Flagged items on this lead' : 'Sign in to use flags'}
                            aria-label="Flagged items"
                        >
                            <FlagIcon className={iconClass} />
                            {totalFlagBadge > 0 && (
                                <span className="absolute -right-0.5 -top-0.5 z-10 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-amber-500 px-0.5 text-[10px] font-bold text-white">
                                    {totalFlagBadge > 99 ? '99+' : totalFlagBadge}
                                </span>
                            )}
                        </button>
                    </>
                ) : null}
                {duplicateContacts && duplicateContacts.length > 0 ? (
                    <button
                        type="button"
                        onClick={handleDuplicatesClick}
                        className={duplicatesBtnClass || HEADER_ACTION_BAR_DUPLICATES_BTN}
                        title={
                            duplicateContacts.length === 1
                                ? `Duplicate Contact: ${duplicateContacts[0].contactName} in Lead ${duplicateContacts[0].leadNumber}`
                                : `${duplicateContacts.length} Duplicate Contacts`
                        }
                        aria-label="Duplicate contacts"
                    >
                        <DocumentDuplicateIcon className={iconClass} />
                        <span className="absolute -right-0.5 -top-0.5 z-10 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-orange-500 px-0.5 text-[10px] font-bold text-white">
                            {duplicateContacts.length > 9 ? '9+' : duplicateContacts.length}
                        </span>
                    </button>
                ) : null}
            </>
        );

    const renderHeaderDocsButton = () => (
        <button
            type="button"
            onClick={openHeaderDocumentsModal}
            disabled={!headerDocsLeadNumber}
            className={`${HEADER_ACTION_BAR_DOCS_BTN} disabled:pointer-events-none disabled:opacity-40`}
            title={headerDocsLeadNumber ? 'Case documents on OneDrive' : 'Lead number required'}
            aria-label="Case documents"
        >
            <DocumentArrowUpIcon className={HEADER_ACTION_ICON} aria-hidden />
            {headerSupabaseDocumentsCount > 0 && (
                <span
                    className="absolute -right-1 -top-1 z-10 flex h-4 min-w-[1rem] items-center justify-center rounded-full px-0.5 text-[10px] font-bold text-white"
                    style={{ backgroundColor: '#3a3a3a' }}
                >
                    {headerSupabaseDocumentsCount > 99 ? '99+' : headerSupabaseDocumentsCount}
                </span>
            )}
        </button>
    );

    const renderSegmentedHeaderActions = (wrapperClassName = '') => {
        if (hideActionsDropdown) {
            return renderCompactHistoryIconRow();
        }

        // Primary actions live in the meta-row circle menu (right rail + overlay).
        return (
            <div className={`flex flex-wrap items-center gap-2 ${wrapperClassName}`.trim()}>
                {renderHeaderActionsMenuTrigger('floating')}
            </div>
        );
    };

    const renderClickableClientName = (titleClassName: string) => (
        <button
            type="button"
            onClick={() => setContactDetailsModalOpen(true)}
            className={`min-w-0 text-left transition-colors hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-sm ${titleClassName}`}
            title="View contact details"
        >
            {selectedClient.name || 'Unnamed Lead'}
        </button>
    );

    const renderContactDetailField = (
        label: 'Mobile' | 'Email' | 'Phone',
        rawValue: string | null | undefined,
    ) => {
        const trimmed = rawValue?.trim();
        const display =
            label === 'Email'
                ? trimmed || '—'
                : trimmed
                  ? formatPhoneNumberDisplay(trimmed)
                  : '—';
        const canCallOrWhatsApp = Boolean(trimmed && trimmed !== '---');

        return (
            <div>
                <p className="text-sm text-base-content/50">{label}</p>
                <p className="mt-0.5 text-base text-base-content">{display}</p>
                {trimmed ? (
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                        {label !== 'Email' && canCallOrWhatsApp ? (
                            <>
                                <button
                                    type="button"
                                    className={CONTACT_MODAL_LINK}
                                    onClick={() => openCallModal(trimmed)}
                                >
                                    <PhoneArrowUpRightIcon className="h-4 w-4" aria-hidden />
                                    Call
                                </button>
                                <button
                                    type="button"
                                    className={CONTACT_MODAL_LINK_WHATSAPP}
                                    onClick={() => void openWhatsAppForNumber(trimmed)}
                                >
                                    <FaWhatsapp className="h-4 w-4" aria-hidden />
                                    WhatsApp
                                </button>
                            </>
                        ) : null}
                        {label === 'Email' && trimmed ? (
                            <button
                                type="button"
                                className={CONTACT_MODAL_LINK}
                                onClick={() => openEmailClient(trimmed)}
                            >
                                <EnvelopeIcon className="h-4 w-4" aria-hidden />
                                Email
                            </button>
                        ) : null}
                        <button
                            type="button"
                            className={CONTACT_MODAL_LINK}
                            onClick={() => void copyContactValue(trimmed, label)}
                        >
                            <ClipboardDocumentIcon className="h-4 w-4" aria-hidden />
                            Copy
                        </button>
                    </div>
                ) : null}
            </div>
        );
    };

    return (
        <div
            className={
                connectToAppHeader
                    ? 'w-full min-w-0'
                    : 'w-full min-w-0 space-y-4'
            }
        >
                <div
                    className={
                        connectToAppHeader
                            ? 'relative w-full'
                            : `${CLIENT_HEADER_SHELL} relative mt-5 md:mt-7`
                    }
                >
                    <div
                        className={
                            connectToAppHeader
                                ? 'flex w-full flex-col gap-4 md:gap-0'
                                : 'flex w-full flex-col gap-5 px-4 py-4 sm:px-5 sm:pb-5 md:gap-4'
                        }
                    >
                    {/* Mobile: SaaS header — identity, contact card, stage + chips */}
                    <div
                        className={
                            connectToAppHeader
                                ? `flex w-full flex-col gap-5 md:hidden ${CLIENT_HEADER_APP_INSET_MOBILE} ${sidebarPadClass} ${pagePadClass}`
                                : 'flex w-full flex-col gap-5 md:hidden'
                        }
                    >                        <header className="relative z-0 flex w-full min-w-0 flex-col gap-2">
                            <div className="flex w-full min-w-0 items-start gap-3">
                                <div className="min-w-0 flex-1 pr-1 text-left">
                                    <div className="min-w-0">
                                        <div className="flex min-w-0 items-center gap-1.5">
                                            <h1 className="min-w-0 truncate text-2xl font-bold leading-tight tracking-tight text-base-content/95">
                                                {renderClickableClientName('font-bold')}
                                            </h1>
                                            {(isSubLead && masterLeadNumber) || (isMasterLead && (subLeadsCount || 0) > 0) ? (
                                                <button
                                                    onClick={() => {
                                                        if (isSubLead && masterLeadNumber) navigate(`/clients/${masterLeadNumber}/master`);
                                                        else if (isMasterLead && selectedClient) {
                                                            const isLegacyLead = selectedClient.lead_type === 'legacy' || selectedClient.id?.toString().startsWith('legacy_');
                                                            const identifier = isLegacyLead
                                                                ? selectedClient.id.toString().replace('legacy_', '')
                                                                : (selectedClient.lead_number || selectedClient.manual_id || selectedClient.id?.toString() || '');
                                                            navigate(`/clients/${encodeURIComponent(identifier)}/master`);
                                                        }
                                                    }}
                                                    className="btn btn-square btn-sm btn-ghost relative -my-1 shrink-0 overflow-visible border-0 text-base-content/70 hover:bg-base-200 hover:text-base-content"
                                                    title={isSubLead ? `View master` : `View ${subLeadsCount} sub-leads`}
                                                    aria-label={isSubLead ? 'View master dashboard' : 'View master dashboard'}
                                                >
                                                    <Squares2X2Icon className="h-6 w-6" />
                                                    <span
                                                        className="absolute -right-1 -top-1 z-10 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1 text-xs font-bold text-white"
                                                        style={{ backgroundColor: '#3a3a3a' }}
                                                    >
                                                        {(subLeadsCount || 0) + 1}
                                                    </span>
                                                </button>
                                            ) : null}
                                            <div className="shrink-0">{renderStageBadge('mobile')}</div>
                                        </div>
                                        <p className={CLIENT_HEADER_LEAD_NUMBER}>
                                            {renderLeadNumber()}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </header>

                        <div className="rounded-[18px] bg-white px-4 py-5 shadow-sm sm:px-5">
                            <div className="flex flex-col gap-4">
                                <div className="flex min-w-0 items-start gap-3">
                                    {displayEmail ? (
                                        <button
                                            type="button"
                                            className="btn btn-ghost btn-sm h-auto min-h-0 shrink-0 p-2 text-base-content/45 hover:bg-base-200 hover:text-base-content"
                                            title="Copy email"
                                            aria-label="Copy email"
                                            onClick={() => {
                                                void navigator.clipboard.writeText(displayEmail).then(() => toast.success('Email copied'));
                                            }}
                                        >
                                            <ClipboardDocumentIcon className="h-5 w-5" />
                                        </button>
                                    ) : null}
                                    <div className="min-w-0 flex-1">
                                        <p className={CLIENT_HEADER_SECTION_LABEL}>Email</p>
                                        <p
                                            className="mt-0.5 min-w-0 text-[15px] font-medium leading-snug text-base-content/85"
                                            title={displayEmail || ''}
                                        >
                                            {displayEmail || '—'}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex min-w-0 items-start gap-3">
                                    {displayPhone ? (
                                        <button
                                            type="button"
                                            className="btn btn-ghost btn-sm h-auto min-h-0 shrink-0 p-2 text-base-content/45 hover:bg-base-200 hover:text-base-content"
                                            title="Copy phone number"
                                            aria-label="Copy phone number"
                                            onClick={() => {
                                                void navigator.clipboard.writeText(displayPhone).then(() => toast.success('Phone copied'));
                                            }}
                                        >
                                            <ClipboardDocumentIcon className="h-5 w-5" />
                                        </button>
                                    ) : null}
                                    <div className="min-w-0 flex-1">
                                        <p className={CLIENT_HEADER_SECTION_LABEL}>Phone</p>
                                        <p
                                            className="mt-0.5 min-w-0 text-[15px] font-medium leading-snug text-base-content/85"
                                            title={displayPhone ? formatPhoneNumberDisplay(displayPhone) : ''}
                                        >
                                            {displayPhone ? formatPhoneNumberDisplay(displayPhone) : '—'}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {renderMetaBadgesRow()}

                        {!hideTotalValueBadge && (
                            <div className="w-full border-t border-base-200/70 pb-8 pt-4 dark:border-base-300/40">
                            {(() => {
                            const {
                                currency,
                                amountReady,
                                showLocked,
                                mainAmount,
                                netWithoutFeesAndExpenses,
                                vatAmount,
                                shouldShowVAT,
                                subcontractorFee,
                                potentialAmount,
                                potentialApplicantsMeeting,
                                unpaidOutstandingPair,
                                unpaidGross,
                                unpaidExpenseAmount,
                            } = headerTotalBadge;
                            return (
                                <div className="group relative cursor-pointer text-right" onClick={() => setIsBalanceModalOpen(true)}>
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-end gap-2">
                                            <span
                                                className="inline-flex items-center gap-1.5"
                                                onClick={(e) => e.stopPropagation()}
                                                onKeyDown={(e) => e.stopPropagation()}
                                            >
                                                {subcontractorFee > 0 ? (
                                                    <button
                                                        type="button"
                                                        className="badge badge-sm h-5 min-h-5 shrink-0 border-0 bg-red-100 px-2 font-semibold text-red-700 hover:bg-red-200"
                                                        title="View fees in Finances"
                                                        onClick={() => openFinancesExpensesFeesTab()}
                                                    >
                                                        Fee {currency}
                                                        {Number(subcontractorFee.toFixed(2)).toLocaleString()}
                                                    </button>
                                                ) : null}
                                            </span>
                                        </div>
                                        <div className="flex flex-col items-end">
                                            <p className="inline-flex items-center gap-2 text-3xl font-bold leading-none tracking-tight text-base-content/95">
                                                {amountReady ? (
                                                    <span>{currency}{Number(mainAmount.toFixed(2)).toLocaleString()}</span>
                                                ) : (
                                                    <span className="inline-block h-8 w-28 animate-pulse rounded-md bg-base-200/80" aria-hidden />
                                                )}
                                                {showLocked && <LockClosedIcon className="h-4 w-4 text-base-content/45" title="Locked by payment plan" />}
                                            </p>
                                            {amountReady && shouldShowVAT && vatAmount > 0 && (
                                                <p className="mt-0.5 text-sm text-base-content/55">
                                                    +{vatAmount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })} VAT
                                                </p>
                                            )}
                                        </div>
                                        {amountReady ? (
                                        <ClientHeaderTotalInNis
                                            clientId={selectedClient?.id}
                                            leadType={selectedClient?.lead_type}
                                            currencyInput={(selectedClient as any)?.currency_id ?? 1}
                                            subtotal={mainAmount}
                                            vat={shouldShowVAT && vatAmount > 0 ? vatAmount : 0}
                                        />
                                        ) : null}
                                        {netWithoutFeesAndExpenses !== null && (
                                            <p className="text-[11px] text-base-content/50">
                                                Net {currency}
                                                {Number(netWithoutFeesAndExpenses.toFixed(2)).toLocaleString()}
                                            </p>
                                        )}
                                        {paymentPlanExpenseNoVatTotal != null && paymentPlanExpenseNoVatTotal > 0 && (
                                            <p className="text-[11px] text-base-content/50">
                                                Exp. {currency}
                                                {Number(paymentPlanExpenseNoVatTotal.toFixed(2)).toLocaleString()}
                                            </p>
                                        )}
                                        {potentialAmount > 0 && (
                                            <p className="text-[11px] font-medium text-base-content/55">
                                                Pot. {currency}
                                                {Number(potentialAmount.toFixed(2)).toLocaleString()}
                                            </p>
                                        )}
                                        {potentialApplicantsMeeting > 0 && (
                                            <p className="text-[11px] text-base-content/45" title="Potential applicants">
                                                Pot. appl. {Math.trunc(potentialApplicantsMeeting).toLocaleString()}
                                            </p>
                                        )}
                                        {(unpaidGross > 0 || unpaidExpenseAmount > 0) && (
                                            <div className={`mt-2 ${CLIENT_HEADER_INNER_PANEL} text-right`}>
                                                <p className={CLIENT_HEADER_SECTION_LABEL}>Outstanding</p>
                                                {unpaidOutstandingPair !== null && unpaidGross > 0 && (
                                                    <div className="flex items-end justify-end gap-2">
                                                        <p className="text-xl font-bold leading-none text-base-content/55">
                                                            {currency}
                                                            {Number(unpaidOutstandingPair.base.toFixed(2)).toLocaleString()}
                                                        </p>
                                                        {unpaidOutstandingPair.vat > 0 && (
                                                            <p className="pb-0.5 text-sm text-base-content/40">
                                                                +
                                                                {unpaidOutstandingPair.vat.toLocaleString(undefined, {
                                                                    minimumFractionDigits: 0,
                                                                    maximumFractionDigits: 2,
                                                                })}{' '}
                                                                VAT
                                                            </p>
                                                        )}
                                                    </div>
                                                )}
                                                {unpaidExpenseAmount > 0 && (
                                                    <p className="text-[11px] text-base-content/45">
                                                        + {currency}
                                                        {Number(unpaidExpenseAmount.toFixed(2)).toLocaleString()} expenses (no VAT)
                                                    </p>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })()}
                            </div>
                        )}
                    </div>

                    {/* Desktop: dense single-strip header */}
                    <div className="relative hidden md:block md:w-full">
                    <div
                        className={
                            connectToAppHeader
                                ? `${CLIENT_HEADER_TOP_BAND} relative`
                                : `${CLIENT_HEADER_CARD} relative w-full`
                        }
                    >
                        {connectToAppHeader ? (
                            <div className="client-header-top-band__navbar-spacer" aria-hidden />
                        ) : null}
                        <div
                            className={
                                connectToAppHeader
                                    ? 'client-header-top-band__body'
                                    : undefined
                            }
                        >
                        <div
                            className={
                                connectToAppHeader
                                    ? 'flex w-full min-w-0 items-center justify-between gap-6 lg:gap-10'
                                    : 'flex w-full min-w-0 items-center justify-between gap-4'
                            }
                        >
                            <div
                                className={
                                    connectToAppHeader
                                        ? 'min-w-0 max-w-[42%] shrink text-left'
                                        : 'min-w-0 max-w-[42%] shrink text-left sm:max-w-[48%]'
                                }
                            >
                                <div className="min-w-0 shrink">
                                    <div className="flex min-w-0 items-center gap-1.5">
                                        <h1 className="min-w-0 truncate text-lg font-bold leading-tight tracking-tight text-base-content/95 sm:text-xl">
                                            {renderClickableClientName('font-bold sm:text-xl')}
                                        </h1>
                                        {(isSubLead && masterLeadNumber) || (isMasterLead && (subLeadsCount || 0) > 0) ? (
                                            <button
                                                onClick={() => {
                                                    if (isSubLead && masterLeadNumber) {
                                                        navigate(`/clients/${masterLeadNumber}/master`);
                                                    } else if (isMasterLead && selectedClient) {
                                                        const isLegacyLead = selectedClient.lead_type === 'legacy' || selectedClient.id?.toString().startsWith('legacy_');
                                                        let identifier: string;
                                                        if (isLegacyLead) {
                                                            identifier = selectedClient.id.toString().replace('legacy_', '');
                                                        } else {
                                                            identifier = selectedClient.lead_number || selectedClient.manual_id || selectedClient.id?.toString() || '';
                                                        }
                                                        navigate(`/clients/${encodeURIComponent(identifier)}/master`);
                                                    }
                                                }}
                                                className="btn btn-square btn-sm btn-ghost relative shrink-0 overflow-visible border-0 text-base-content/70 hover:bg-base-200 hover:text-base-content"
                                                title={
                                                    isSubLead
                                                        ? `View master dashboard (${(subLeadsCount || 0) + 1} total leads)`
                                                        : `View all ${subLeadsCount || 0} sub-lead${subLeadsCount !== 1 ? 's' : ''} and master lead (${(subLeadsCount || 0) + 1} total)`
                                                }
                                            >
                                                <Squares2X2Icon className="w-6 h-6" />
                                                <span
                                                    className="absolute -top-1 -right-1 z-10 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1 text-xs font-bold text-white"
                                                    style={{ backgroundColor: '#3a3a3a' }}
                                                >
                                                    {(subLeadsCount || 0) + 1}
                                                </span>
                                            </button>
                                        ) : null}
                                        <div className="shrink-0">{renderStageBadge('desktop')}</div>
                                    </div>
                                    <span className={CLIENT_HEADER_LEAD_NUMBER}>
                                        {renderLeadNumber()}
                                    </span>
                                </div>
                            </div>
                            <div
                                className={`flex min-w-0 flex-1 basis-0 items-start gap-3 ${
                                    !hideTotalValueBadge ? 'border-l border-base-200/70 pl-4' : ''
                                }`.trim()}
                            >
                            {!hideTotalValueBadge ? (
                                <div className="w-fit max-w-[min(100%,14rem)] shrink-0 text-left sm:max-w-xs">
                            {(() => {
                                const {
                                    currency,
                                    amountReady,
                                    showLocked,
                                    mainAmount,
                                    netWithoutFeesAndExpenses,
                                    vatAmount,
                                    shouldShowVAT,
                                    subcontractorFee,
                                    potentialAmount,
                                    potentialApplicantsMeeting,
                                    unpaidOutstandingPair: unpaidOutstandingPairDesktop,
                                    unpaidGross: unpaidGrossDesktop,
                                    unpaidExpenseAmount: unpaidExpenseAmountDesktop,
                                    hasExpandableFinancialDetails,
                                } = headerTotalBadge;

                                return (
                                    <>
                                        <div className="flex w-full items-center justify-start gap-2">
                                            {subcontractorFee > 0 ? (
                                                <button
                                                    type="button"
                                                    className="badge badge-sm h-5 min-h-5 shrink-0 border-0 bg-red-100 px-2 font-semibold text-red-700 hover:bg-red-200"
                                                    title="View fees in Finances"
                                                    onClick={() => openFinancesExpensesFeesTab()}
                                                >
                                                    Fee {currency}
                                                    {Number(subcontractorFee.toFixed(2)).toLocaleString()}
                                                </button>
                                            ) : null}
                                        </div>
                                        <button
                                            type="button"
                                            className="w-full text-left"
                                            onClick={() => setIsBalanceModalOpen(true)}
                                        >
                                            <div className="flex flex-col items-start">
                                                <p className="inline-flex items-center gap-2 text-2xl font-bold leading-none tracking-tight text-base-content/95 sm:text-3xl">
                                                    {amountReady ? (
                                                        <span>{currency}{Number(mainAmount.toFixed(2)).toLocaleString()}</span>
                                                    ) : (
                                                        <span className="inline-block h-8 w-28 animate-pulse rounded-md bg-base-200/80" aria-hidden />
                                                    )}
                                                    {showLocked && (
                                                        <LockClosedIcon className="h-4 w-4 text-base-content/45" title="Locked by payment plan" />
                                                    )}
                                                </p>
                                            </div>
                                        </button>
                                        {(amountReady && shouldShowVAT && vatAmount > 0) || (amountReady && hasExpandableFinancialDetails) ? (
                                            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                                                {amountReady && shouldShowVAT && vatAmount > 0 ? (
                                                    <button
                                                        type="button"
                                                        className="text-sm text-base-content/55"
                                                        onClick={() => setIsBalanceModalOpen(true)}
                                                    >
                                                        +{vatAmount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })} VAT
                                                    </button>
                                                ) : null}
                                                {hasExpandableFinancialDetails ? (
                                                    <button
                                                        type="button"
                                                        className="btn btn-ghost btn-xs h-7 min-h-7 w-7 min-w-7 p-0 text-base-content/55"
                                                        onClick={() => setHeaderFinancialDetailsOpen((open) => !open)}
                                                        aria-expanded={headerFinancialDetailsOpen}
                                                        aria-label={headerFinancialDetailsOpen ? 'Hide financial details' : 'Show more financial details'}
                                                        title={headerFinancialDetailsOpen ? 'Less' : 'More'}
                                                    >
                                                        <ChevronDownIcon
                                                            className={`h-3.5 w-3.5 transition-transform duration-200 ${headerFinancialDetailsOpen ? 'rotate-180' : ''}`}
                                                        />
                                                    </button>
                                                ) : null}
                                            </div>
                                        ) : null}
                                        {headerFinancialDetailsOpen && hasExpandableFinancialDetails ? (
                                            <div className="mt-1.5 space-y-1 border-t border-base-200/70 pt-2 text-left">
                                                <ClientHeaderTotalInNis
                                                    clientId={selectedClient?.id}
                                                    leadType={selectedClient?.lead_type}
                                                    currencyInput={(selectedClient as any)?.currency_id ?? 1}
                                                    subtotal={mainAmount}
                                                    vat={shouldShowVAT && vatAmount > 0 ? vatAmount : 0}
                                                />
                                                {netWithoutFeesAndExpenses !== null && (
                                                    <p className="text-[11px] text-base-content/50">
                                                        Net {currency}
                                                        {Number(netWithoutFeesAndExpenses.toFixed(2)).toLocaleString()}
                                                    </p>
                                                )}
                                                {paymentPlanExpenseNoVatTotal != null && paymentPlanExpenseNoVatTotal > 0 && (
                                                    <p className="text-[11px] text-base-content/50">
                                                        Exp. {currency}
                                                        {Number(paymentPlanExpenseNoVatTotal.toFixed(2)).toLocaleString()}
                                                    </p>
                                                )}
                                                {potentialAmount > 0 && (
                                                    <p className="text-[11px] font-medium text-base-content/55">
                                                        Pot. {currency}
                                                        {Number(potentialAmount.toFixed(2)).toLocaleString()}
                                                    </p>
                                                )}
                                                {potentialApplicantsMeeting > 0 && (
                                                    <p className="text-[11px] text-base-content/45" title="Potential applicants">
                                                        Pot. appl. {Math.trunc(potentialApplicantsMeeting).toLocaleString()}
                                                    </p>
                                                )}
                                                {(unpaidGrossDesktop > 0 || unpaidExpenseAmountDesktop > 0) && (
                                                    <div className="mt-1 rounded-lg bg-base-200/35 px-2.5 py-2 text-left">
                                                        <p className={CLIENT_HEADER_SECTION_LABEL}>Outstanding</p>
                                                        {unpaidOutstandingPairDesktop !== null && unpaidGrossDesktop > 0 && (
                                                            <div className="flex items-end justify-start gap-2">
                                                                <p className="text-xl font-bold leading-none text-base-content/55">
                                                                    {currency}
                                                                    {Number(unpaidOutstandingPairDesktop.base.toFixed(2)).toLocaleString()}
                                                                </p>
                                                                {unpaidOutstandingPairDesktop.vat > 0 && (
                                                                    <p className="pb-1 text-sm text-base-content/40">
                                                                        +
                                                                        {unpaidOutstandingPairDesktop.vat.toLocaleString(undefined, {
                                                                            minimumFractionDigits: 0,
                                                                            maximumFractionDigits: 2,
                                                                        })}{' '}
                                                                        VAT
                                                                    </p>
                                                                )}
                                                            </div>
                                                        )}
                                                        {unpaidExpenseAmountDesktop > 0 && (
                                                            <p className="text-[11px] text-base-content/45">
                                                                + {currency}
                                                                {Number(unpaidExpenseAmountDesktop.toFixed(2)).toLocaleString()} expenses (no VAT)
                                                            </p>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        ) : null}
                                    </>
                                );
                            })()}
                                </div>
                            ) : null}

                    <div className="min-w-0 flex-1">
                    {(() => {
                        const isLegacyLead = selectedClient?.lead_type === 'legacy' || selectedClient?.id?.toString().startsWith('legacy_');

                        // Helper functions for display
                        const getCloserDisplay = (): string => {
                            if (isLegacyLead) {
                              const fromJoin = (selectedClient as any).closer;
                              if (fromJoin && String(fromJoin).trim() && String(fromJoin).trim() !== '---') return String(fromJoin).trim();
                              return getEmployeeDisplayNameFromId((selectedClient as any).closer_id);
                            }
                            const closer = selectedClient.closer;
                            if (!closer || closer === '---' || closer === '--') return '---';
                            if (/^\d+$/.test(String(closer).trim())) return getEmployeeDisplayNameFromId(Number(closer));
                            const employee = allEmployees.find((emp: any) => emp.display_name && emp.display_name.trim() === String(closer).trim());
                            return employee ? employee.display_name : closer;
                        };

                        const getExpertDisplay = (): string => {
                            if (isLegacyLead) {
                              const fromJoin = (selectedClient as any).expert;
                              if (fromJoin && String(fromJoin).trim() && String(fromJoin).trim() !== '---') return String(fromJoin).trim();
                              return getEmployeeDisplayNameFromId((selectedClient as any).expert_id);
                            }
                            return getEmployeeDisplayNameFromId((selectedClient as any).expert) || '---';
                        };

                        const getHandlerDisplay = (): string => {
                            if (isLegacyLead) {
                                const fromJoin = (selectedClient as any).handler;
                                if (fromJoin && String(fromJoin).trim() && String(fromJoin).trim() !== '---' && String(fromJoin).toLowerCase() !== 'not assigned') return String(fromJoin).trim();
                                const handlerId = (selectedClient as any).case_handler_id;
                                if (handlerId) return getEmployeeDisplayNameFromId(handlerId) || '---';
                                return '---';
                            }
                            if ((selectedClient as any).case_handler_id) {
                                const handlerId = (selectedClient as any).case_handler_id;
                                return getEmployeeDisplayNameFromId(handlerId) || '---';
                            }
                            const handlerValue = (selectedClient as any).handler;
                            if (!handlerValue || handlerValue === '---' || handlerValue === '--') return '---';
                            if (typeof handlerValue === 'number' || (typeof handlerValue === 'string' && !isNaN(Number(handlerValue)) && handlerValue.toString().trim() !== '')) {
                                return getEmployeeDisplayNameFromId(handlerValue) || '---';
                            }
                            return handlerValue || '---';
                        };

                        const getSchedulerDisplay = (): string => {
                            if (isLegacyLead) {
                              const fromJoin = (selectedClient as any).scheduler;
                              if (fromJoin && String(fromJoin).trim() && String(fromJoin).trim() !== '---') {
                                const joined = String(fromJoin).trim();
                                // Partner booking may leave a numeric id here — resolve to name
                                if (/^\d+$/.test(joined)) {
                                  return getEmployeeDisplayNameFromId(joined) || joined;
                                }
                                return joined;
                              }
                              return getEmployeeDisplayNameFromId((selectedClient as any).meeting_scheduler_id);
                            }
                            const schedulerValue = selectedClient.scheduler;
                            if (!schedulerValue || schedulerValue === '---' || schedulerValue === '--') return '---';
                            // Automated booking stores tenants_employee.id (e.g. "177") — show display_name
                            if (
                              typeof schedulerValue === 'number' ||
                              (typeof schedulerValue === 'string' && /^\d+$/.test(schedulerValue.trim()))
                            ) {
                              return getEmployeeDisplayNameFromId(schedulerValue) || String(schedulerValue);
                            }
                            return String(schedulerValue);
                        };

                        /** tenants_employee.id is numeric — never pass display names into avatar / batch id queries. */
                        const resolveNumericEmployeeId = (value: unknown): number | null => {
                            if (value == null || value === '' || value === '---' || value === '--') return null;
                            if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
                            const s = String(value).trim();
                            if (!s) return null;
                            if (/^\d+$/.test(s)) {
                                const n = Number(s);
                                return Number.isFinite(n) && n > 0 ? n : null;
                            }
                            const emp = allEmployees.find((e: any) =>
                                e?.display_name && e.display_name.trim().toLowerCase() === s.toLowerCase()
                            );
                            if (emp?.id == null) return null;
                            const n = typeof emp.id === 'bigint' ? Number(emp.id) : Number(emp.id);
                            return Number.isFinite(n) && n > 0 ? n : null;
                        };

                        // Role IDs for Avatars
                        const closerId = (() => {
                            if (isLegacyLead) return (selectedClient as any).closer_id ? Number((selectedClient as any).closer_id) : null;
                            return resolveNumericEmployeeId(selectedClient.closer);
                        })();

                        const expertId = (() => {
                            if (isLegacyLead) return (selectedClient as any).expert_id ? Number((selectedClient as any).expert_id) : null;
                            const expertId = (selectedClient as any).expert;
                            return expertId ? Number(expertId) : null;
                        })();

                        const handlerId = (() => {
                            const ch = (selectedClient as any).case_handler_id;
                            if (ch != null && String(ch).trim() !== '') {
                                const n = Number(ch);
                                return Number.isFinite(n) && n > 0 ? n : null;
                            }
                            if (isLegacyLead) return null;
                            return resolveNumericEmployeeId((selectedClient as any).handler);
                        })();

                        const schedulerId = (() => {
                            if (isLegacyLead) return (selectedClient as any).meeting_scheduler_id ? Number((selectedClient as any).meeting_scheduler_id) : null;
                            return resolveNumericEmployeeId(selectedClient.scheduler);
                        })();

                        const retentionHandlerId = (selectedClient as any).retainer_handler_id ? Number((selectedClient as any).retainer_handler_id) : null;

                        const closerDisplay = getCloserDisplay();
                        const expertDisplay = getExpertDisplay();
                        const handlerDisplay = getHandlerDisplay();
                        const schedulerDisplay = getSchedulerDisplay();
                        const retentionHandlerDisplay = getEmployeeDisplayNameFromId(retentionHandlerId);

                        const isRoleEmpty = (id: any, display: string) => {
                            const displayLower = display ? display.toLowerCase().trim() : '';
                            const isNotAssigned = displayLower.includes('not_assigned') || displayLower.includes('not assigned') || displayLower === 'not assigned' || displayLower === 'unassigned';
                            if (!id && (!display || display === '---' || display === '--' || isNotAssigned)) return true;
                            if (id && isNotAssigned) return true;
                            return false;
                        };

                        const isUnactivated = isLegacyLead
                            ? (selectedClient?.status === 10)
                            : (selectedClient?.status === 'inactive');

                        const activeHandlerTypeForLead = Number((selectedClient as any).active_handler_type) === 1 ? 1 : 2;
                        const hasHandlerRole = showHandlerRolesInHeader && !isRoleEmpty(handlerId, handlerDisplay);
                        const hasRetentionRole = showHandlerRolesInHeader && !isRoleEmpty(retentionHandlerId, retentionHandlerDisplay);
                        const showDualHandlerToggle = hasHandlerRole && hasRetentionRole && !isUnactivated;

                        // Group roles by employee ID. From Handler Set (105)+ with cost UI:
                        // only Handler + Retention + time bar (hide Expert / Scheduler / Closer).
                        const roleGroups = new Map<string, { id: string | number | null; roles: string[]; display: string }>();

                        if (!showLeadCostUi) {
                            if (!isRoleEmpty(closerId, closerDisplay)) {
                                const key = closerId ? closerId.toString() : closerDisplay;
                                if (!roleGroups.has(key)) {
                                    roleGroups.set(key, { id: closerId, roles: [], display: closerDisplay });
                                }
                                roleGroups.get(key)!.roles.push('Closer');
                            }

                            if (!isRoleEmpty(expertId, expertDisplay)) {
                                const key = expertId ? expertId.toString() : expertDisplay;
                                if (!roleGroups.has(key)) {
                                    roleGroups.set(key, { id: expertId, roles: [], display: expertDisplay });
                                }
                                roleGroups.get(key)!.roles.push('Expert');
                            }

                            if (!isRoleEmpty(schedulerId, schedulerDisplay)) {
                                const key = schedulerId ? schedulerId.toString() : schedulerDisplay;
                                if (!roleGroups.has(key)) {
                                    roleGroups.set(key, { id: schedulerId, roles: [], display: schedulerDisplay });
                                }
                                roleGroups.get(key)!.roles.push('Scheduler');
                            }
                        }

                        type TeamEntry = {
                            key: string;
                            id: number | null;
                            rolesLabel: string;
                            display: string;
                            kind: 'group' | 'handler' | 'retention';
                        };

                        const teamEntries: TeamEntry[] = [];
                        Array.from(roleGroups.values()).forEach((group, index) => {
                            teamEntries.push({
                                key: `g-${index}`,
                                id: group.id != null ? Number(group.id) : null,
                                rolesLabel: group.roles.join(', '),
                                display: group.display,
                                kind: 'group',
                            });
                        });
                        if (hasHandlerRole) {
                            teamEntries.push({
                                key: 'handler',
                                id: handlerId,
                                rolesLabel: 'Handler',
                                display: handlerDisplay,
                                kind: 'handler',
                            });
                        }
                        if (hasRetentionRole) {
                            teamEntries.push({
                                key: 'r-handler',
                                id: retentionHandlerId,
                                rolesLabel: 'R-Handler',
                                display: retentionHandlerDisplay,
                                kind: 'retention',
                            });
                        }

                        const renderTeamMemberContent = (
                            entry: TeamEntry,
                            options?: { showHandlerRing?: boolean; handlerActive?: boolean },
                        ) => (
                            <div className="flex shrink-0 items-center gap-2">
                                {entry.kind === 'handler' || entry.kind === 'retention' ? (
                                    <div
                                        className={`relative shrink-0 overflow-visible rounded-full p-0.5 transition-[box-shadow,opacity,ring-color] duration-500 ease-out ${
                                            options?.showHandlerRing && options?.handlerActive
                                                ? 'opacity-100 ring-2 ring-emerald-500 shadow-[0_0_14px_rgba(16,185,129,0.32)]'
                                                : 'opacity-80 ring-2 ring-transparent'
                                        }`}
                                    >
                                        {options?.showHandlerRing && options?.handlerActive ? (
                                            <span
                                                key={handlerActiveRingNonce}
                                                className="pointer-events-none absolute inset-[-4px] z-0 rounded-full animate-handler-active-ring-flash"
                                                aria-hidden
                                            />
                                        ) : null}
                                        <div className="relative z-[1]">
                                            <EmployeeAvatar employeeId={entry.id} size="md" />
                                        </div>
                                        {options?.showHandlerRing && options?.handlerActive ? (
                                            <div className="absolute -top-0.5 -right-0.5 z-[2] rounded-full bg-emerald-500 p-0.5 ring-2 ring-white">
                                                <CheckCircleIcon className="h-3 w-3 text-white" />
                                            </div>
                                        ) : null}
                                    </div>
                                ) : (
                                    <EmployeeAvatar employeeId={entry.id} size="md" />
                                )}
                                <div className="flex min-w-0 flex-col">
                                    <span className={`whitespace-nowrap ${TEAM_ROLE_LABEL}`}>
                                        {entry.rolesLabel}
                                    </span>
                                    <span className="whitespace-nowrap text-sm font-semibold text-base-content/85">
                                        {formatRoleDisplay(entry.display)}
                                    </span>
                                </div>
                            </div>
                        );

                        const renderTeamMemberCard = (
                            entry: TeamEntry,
                            options?: { showHandlerRing?: boolean; handlerActive?: boolean },
                        ) => (
                            <div
                                key={entry.key}
                                className="flex shrink-0 items-center"
                            >
                                {renderTeamMemberContent(entry, options)}
                            </div>
                        );

                        const teamMemberCardOptions = (entry: TeamEntry) => ({
                            showHandlerRing: entry.kind !== 'group',
                            handlerActive:
                                entry.kind === 'handler'
                                    ? activeHandlerTypeForLead === 2
                                    : entry.kind === 'retention'
                                      ? activeHandlerTypeForLead === 1
                                      : false,
                        });

                        return (
                            <div className="flex w-full min-w-0 items-start justify-between gap-8 lg:gap-12">
                                {showLeadCostUi ? (
                                    <LeadRemainingTimeBar
                                        summary={leadEmployeeCostSummary}
                                        loading={leadEmployeeCostLoading}
                                        align="start"
                                        className="w-auto shrink-0"
                                        showStatusIcon
                                        onClick={() =>
                                            openLeadEmployeeCostModal(
                                                leadEmployeeCostSummary?.exceedsCap ? 'warning' : 'overview',
                                            )
                                        }
                                    />
                                ) : (
                                    <span className="min-w-0" />
                                )}
                                <div className="flex min-w-0 flex-col items-end gap-2">
                                    <div className="flex max-w-full flex-wrap items-center justify-end gap-x-4 gap-y-2">
                                        {teamEntries.map((entry) =>
                                            renderTeamMemberCard(entry, teamMemberCardOptions(entry)),
                                        )}
                                    </div>
                                    {teamEntries.length === 0 && !showLeadCostUi ? (
                                        <span className="text-sm text-base-content/45">No team assigned</span>
                                    ) : null}
                                    {showDualHandlerToggle ? (
                                        <div className="flex w-fit shrink-0 items-center justify-center">
                                            <div className="inline-flex h-10 min-w-[8.25rem] items-stretch gap-0.5 rounded-full border border-base-300/50 bg-base-200/90 p-1 shadow-inner">
                                                <button
                                                    type="button"
                                                    aria-label="Case handler active on this file"
                                                    onClick={() => void updateActiveHandlerType(2)}
                                                    title="Case handler drives this file (Active Cases)"
                                                    className={`relative flex h-8 min-w-[3.25rem] flex-1 shrink-0 items-center justify-center rounded-full transition-all duration-300 ease-out ${
                                                        activeHandlerTypeForLead === 2
                                                            ? 'bg-emerald-50 shadow-sm ring-1 ring-emerald-200 dark:bg-emerald-900/30 dark:ring-emerald-900/40'
                                                            : 'bg-transparent hover:bg-base-100/70'
                                                    }`}
                                                >
                                                    <UserIcon
                                                        className={`h-4 w-4 shrink-0 ${
                                                            activeHandlerTypeForLead === 2
                                                                ? 'text-emerald-800 dark:text-emerald-100'
                                                                : 'text-base-content/45'
                                                        }`}
                                                        aria-hidden
                                                    />
                                                </button>
                                                <button
                                                    type="button"
                                                    aria-label="Retention handler active on this file"
                                                    onClick={() => void updateActiveHandlerType(1)}
                                                    title="Retention handler active (Non-Active Cases)"
                                                    className={`relative flex h-8 min-w-[3.25rem] flex-1 shrink-0 items-center justify-center rounded-full transition-all duration-300 ease-out ${
                                                        activeHandlerTypeForLead === 1
                                                            ? 'bg-sky-50 shadow-sm ring-1 ring-sky-200 dark:bg-sky-900/25 dark:ring-sky-900/40'
                                                            : 'bg-transparent hover:bg-base-100/70'
                                                    }`}
                                                >
                                                    <RectangleStackIcon
                                                        className={`h-4 w-4 shrink-0 ${
                                                            activeHandlerTypeForLead === 1
                                                                ? 'text-sky-800 dark:text-sky-100'
                                                                : 'text-base-content/45'
                                                        }`}
                                                        aria-hidden
                                                    />
                                                </button>
                                            </div>
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                        );
                    })()}
                    </div>
                    </div>
                        </div>
                        </div>
                        {connectToAppHeader ? (
                            <div className="client-header-meta-band">
                                {renderMetaBadgesRow('connected')}
                            </div>
                        ) : null}
                    </div>
                    </div>

                    {!connectToAppHeader ? (
                    <div className="mt-2.5 flex w-full min-w-0">
                        {renderMetaBadgesRow('floating')}
                    </div>
                    ) : null}

                    <div
                        className={
                            connectToAppHeader
                                ? `${navRail ? 'mt-0 pt-3' : 'mt-3'} hidden w-full flex-col items-stretch gap-2 md:flex ${
                                      needsDesktopStagePaymentBanner || dropdownsContent ? '' : 'xl:hidden'
                                  } ${sidebarPadClass} ${pagePadClass}`
                                : `mt-3 hidden w-full flex-col items-stretch gap-2 md:flex ${
                                      needsDesktopStagePaymentBanner || dropdownsContent ? '' : 'xl:hidden'
                                  }`
                        }
                    >
                        <div className={`flex w-full flex-wrap items-center gap-2 ${needsDesktopStagePaymentBanner ? '' : 'xl:hidden'}`}>
                            <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
                                    {renderDesktopStageLogicButtons()}
                                    {renderPinnedInteractionsButton()}
                            </div>
                        </div>
                        {dropdownsContent ? (
                            <div className={`relative z-10 shrink-0 pt-1 ${HEADER_ROLE_ASSIGN_WIDTH_CLASS}`}>
                                {dropdownsContent}
                            </div>
                        ) : null}
                    </div>

                {/* Case inactive — centred banner under the header white box */}
                {(() => {
                    const isLegacy = selectedClient?.lead_type === 'legacy' || selectedClient?.id?.toString().startsWith('legacy_');
                    const isUnactivated = isLegacy ? (selectedClient?.status === 10) : (selectedClient?.status === 'inactive');
                    if (!isUnactivated) return null;

                    // Get unactivation reason
                    let unactivationReason = selectedClient?.unactivation_reason;
                    if (isLegacy && !unactivationReason) {
                        const reasonId = (selectedClient as any)?.reason_id;
                        if (reasonId) {
                            const reasonFromId = getUnactivationReasonFromId(reasonId);
                            if (reasonFromId) {
                                unactivationReason = reasonFromId;
                            }
                        }
                    }

                    const deactivateNotes = String((selectedClient as any)?.deactivate_notes ?? '').trim();
                    const notesNeedToggle = deactivateNotes.length > 72 || deactivateNotes.includes('\n');
                    const notesIsRtl = /[\u0590-\u05FF]/.test(deactivateNotes);
                    const unactivatedBy = selectedClient?.unactivated_by;
                    const unactivatedEmployee = unactivatedBy ? getEmployeeById(unactivatedBy) : null;

                    return (
                        <div
                            className={
                                connectToAppHeader
                                    ? `mt-5 w-full ${sidebarPadClass} ${pagePadClass}`
                                    : 'mt-5 w-full'
                            }
                        >
                        <div className="w-full rounded-[18px] bg-red-50 px-4 py-3 text-red-800 shadow-sm dark:bg-red-900/20 dark:text-red-200">
                            <div className="flex flex-col items-center gap-2 text-center">
                                <span className="inline-flex items-center justify-center gap-2 text-lg font-semibold md:text-xl">
                                    <NoSymbolIcon className="h-6 w-6 shrink-0 md:h-7 md:w-7" aria-hidden />
                                    Case inactive
                                    {unactivationReason && (
                                        <span className="text-base font-normal md:text-lg">({unactivationReason})</span>
                                    )}
                                </span>

                                {deactivateNotes && (
                                    <div className="w-full max-w-3xl">
                                        <p
                                            dir={notesIsRtl ? 'rtl' : 'ltr'}
                                            className={`text-sm font-normal leading-relaxed text-red-900/80 dark:text-red-200/80 ${
                                                notesIsRtl ? 'text-right' : 'text-center'
                                            } ${!inactiveNotesExpanded && notesNeedToggle ? 'line-clamp-2' : ''}`}
                                        >
                                            {deactivateNotes}
                                        </p>
                                        {notesNeedToggle && (
                                            <div className={`mt-2 flex ${notesIsRtl ? 'justify-end' : 'justify-center'}`}>
                                                <button
                                                    type="button"
                                                    className="inline-flex items-center rounded-full bg-red-600/12 px-3.5 py-1 text-xs font-semibold text-red-800/85 transition-colors hover:bg-red-600/18 dark:bg-red-400/12 dark:text-red-200/90 dark:hover:bg-red-400/18"
                                                    onClick={() => setInactiveNotesExpanded((expanded) => !expanded)}
                                                >
                                                    {inactiveNotesExpanded ? 'Show less' : 'Show more'}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {(unactivatedBy || selectedClient?.unactivated_at) && (
                                    <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm font-normal text-red-900/70 dark:text-red-200/70">
                                        {unactivatedBy && (
                                            <span className="inline-flex items-center gap-2">
                                                <span>by</span>
                                                {unactivatedEmployee ? (
                                                    <EmployeeAvatar employeeId={unactivatedEmployee.id} size="sm" />
                                                ) : (
                                                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-200/80 text-xs font-semibold text-red-800 dark:bg-red-800/50 dark:text-red-100">
                                                        {getEmployeeInitials(unactivatedBy)}
                                                    </div>
                                                )}
                                                <span className="font-medium text-red-900/85 dark:text-red-100/90">
                                                    {unactivatedBy}
                                                </span>
                                            </span>
                                        )}
                                        {selectedClient?.unactivated_at && (
                                            <span>
                                                at{' '}
                                                {new Date(selectedClient.unactivated_at).toLocaleDateString('en-US', {
                                                    year: 'numeric',
                                                    month: 'short',
                                                    day: 'numeric',
                                                    hour: '2-digit',
                                                    minute: '2-digit',
                                                })}
                                            </span>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                        </div>
                    );
                })()}

                {/* Stage Logic Buttons - Mobile: Below timeline/history/stage badge row (btn-md + text-base for tap targets) */}
                <div
                    className={
                        connectToAppHeader
                            ? `mt-7 flex w-full flex-wrap items-center gap-4 md:hidden ${sidebarPadClass} ${pagePadClass}`
                            : 'mt-7 flex w-full flex-wrap items-center gap-4 md:hidden'
                    }
                >                    {renderPinnedInteractionsButton()}
                    {/* Check if case is unactivated - show message instead of buttons */}
                    {(() => {
                        const isLegacy = selectedClient?.lead_type === 'legacy' || selectedClient?.id?.toString().startsWith('legacy_');
                        const isUnactivated = isLegacy
                            ? (selectedClient?.status === 10)
                            : (selectedClient?.status === 'inactive');

                        if (isUnactivated) {
                            return (
                                <div className="px-4 py-2 text-sm text-gray-600">
                                    Please activate lead in actions first to see the stage buttons.
                                </div>
                            );
                        }
                        return null;
                    })()}

                    {/* Stage buttons - only show if case is activated */}
                    {(() => {
                        const isLegacy = selectedClient?.lead_type === 'legacy' || selectedClient?.id?.toString().startsWith('legacy_');
                        const isUnactivated = isLegacy
                            ? (selectedClient?.status === 10)
                            : (selectedClient?.status === 'inactive');

                        if (isUnactivated) {
                            return null; // Don't show any stage buttons if unactivated
                        }

                        // Closed state: sub-efforts sidebar handles stage 200 log; otherwise show "No action available"
                        if (selectedClient && (areStagesEquivalent(currentStageName, 'Case Closed') || (isStageNumeric && stageNumeric === 200))) {
                            if ((isStageNumeric && stageNumeric === 200) || Number((selectedClient as any)?.stage) === 200) {
                                return null;
                            }
                            return (
                                <div className="px-4 py-2 text-sm text-gray-600">
                                    No action available
                                </div>
                            );
                        }

                        return (
                            <>
                                {/* Stage 105: no action buttons (advances via payments plan) */}
                                {showHandlerPaymentBanner &&
                                (areStagesEquivalent(currentStageName, 'Handler Set') ||
                                    (isStageNumeric && stageNumeric === 105)) && shouldShowHandlerPaymentBanner(hasPaymentPlan, nextDuePayment) ? (
                                    <div className="w-full flex justify-center">
                                        {isMissingPaymentPlanBanner(hasPaymentPlan) ? (
                                            <div className="w-full max-w-xl rounded-2xl border-0 bg-gray-50 px-4 py-3 text-slate-800">
                                                <div className="flex items-center justify-between gap-3">
                                                    <div className="flex items-center gap-2 text-sm font-semibold">
                                                        <ExclamationTriangleIcon className="h-5 w-5" />
                                                        Missing payment plan
                                                    </div>
                                                    <div className="text-xs text-slate-500 whitespace-nowrap">
                                                        Finances → payment plan
                                                    </div>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="w-full max-w-xl rounded-2xl border-0 bg-gray-50 px-4 py-3 text-slate-800">
                                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5">
                                                    <div className="text-sm font-semibold">Next payment due</div>
                                                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-end gap-2 sm:gap-3">
                                                        <div className="text-sm tabular-nums text-right whitespace-nowrap">
                                                        {(() => {
                                                        const isLegacy = !!(nextDuePayment as any)?.isLegacy;
                                                        const base = Number((nextDuePayment as any)?.value ?? 0);
                                                        const vat = Number(
                                                            isLegacy
                                                                ? (nextDuePayment as any)?.vat_value ?? 0
                                                                : (nextDuePayment as any)?.value_vat ?? 0
                                                        );
                                                        const gross =
                                                            (Number.isFinite(base) ? base : 0) + (Number.isFinite(vat) ? vat : 0);
                                                        const currency =
                                                            (nextDuePayment as any)?.currency ??
                                                            (nextDuePayment as any)?.accounting_currencies?.iso_code ??
                                                            (nextDuePayment as any)?.accounting_currencies?.name ??
                                                            '';
                                                        const dateRaw =
                                                            (nextDuePayment as any)?.due_date ?? (nextDuePayment as any)?.date ?? null;
                                                        const dateLabel = dateRaw ? new Date(dateRaw).toLocaleDateString() : '—';
                                                        const amountLabel = Number.isFinite(gross)
                                                            ? gross.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })
                                                            : '0';
                                                        return (
                                                            <span>
                                                                <span className="font-semibold">
                                                                    {currency ? `${currency} ` : ''}
                                                                    {amountLabel}
                                                                </span>
                                                                {' · '}
                                                                <span className="opacity-80">{dateLabel}</span>
                                                            </span>
                                                        );
                                                    })()}
                                                        </div>
                                                        {(() => {
                                                            const isLegacy = !!(nextDuePayment as any)?.isLegacy;
                                                            const ready =
                                                                (nextDuePayment as any)?.ready_to_pay === true ||
                                                                ((isLegacy && !!(nextDuePayment as any)?.due_date) ? true : false);
                                                            if (!ready) return null;
                                                            const by =
                                                                (nextDuePayment as any)?.ready_to_pay_by_display_name ??
                                                                (nextDuePayment as any)?.tenants_employee?.display_name ??
                                                                (nextDuePayment as any)?.updated_by ??
                                                                (nextDuePayment as any)?.paid_by ??
                                                                '—';
                                                            return (
                                                                <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                                                                    <span className="btn btn-success btn-sm pointer-events-none gap-1.5 text-white rounded-full px-3">
                                                                        <CheckCircleIcon className="h-4 w-4" />
                                                                        Sent to finance
                                                                    </span>
                                                                    <span className="text-xs text-slate-500 whitespace-nowrap">
                                                                        by <span className="font-semibold">{String(by)}</span>
                                                                    </span>
                                                                </div>
                                                            );
                                                        })()}
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ) : null}

                                {/* Stages 60 / 70 / 100 / 105 / 110 / 150: sub-efforts; finalize only on 110 & 150 */}
                                {subEffortsStageFlags.showPickerLogAndModal && (
                                    <>
                                        <div className="flex items-center justify-end gap-3 flex-wrap">
                                            {(onMeetingScheduleClick || onMeetingRescheduleClick) && (
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        if (hasScheduledMeetings && onMeetingRescheduleClick) {
                                                            onMeetingRescheduleClick();
                                                        } else if (onMeetingScheduleClick) {
                                                            onMeetingScheduleClick();
                                                        }
                                                    }}
                                                    className={STAGE_ACTION_BTN_CLASS}
                                                >
                                                    {hasScheduledMeetings ? (
                                                        <ArrowPathIcon className="w-5 h-5" />
                                                    ) : (
                                                        <CalendarDaysIcon className="w-5 h-5" />
                                                    )}
                                                    {hasScheduledMeetings ? 'Reschedule Meeting' : 'Schedule Meeting'}
                                                </button>
                                            )}
                                            {subEffortsStageFlags.showFinalizeCaseWithSubEfforts && (
                                                <button
                                                    onClick={() => updateLeadStage(200)}
                                                    className={STAGE_ACTION_BTN_CLASS}
                                                >
                                                    <CheckCircleIcon className="w-5 h-5" />
                                                    Finalize Case
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                className={STAGE_ACTION_BTN_CLASS}
                                                onClick={() => openSubEffortsModal(null)}
                                                disabled={isLoadingLeadSubEfforts || isLoadingSubEfforts}
                                                title={
                                                    !leadMiscCategoryId
                                                        ? 'Set case type on the lead to load sub efforts'
                                                        : undefined
                                                }
                                            >
                                                <DocumentCheckIcon className="w-5 h-5" />
                                                Sub efforts
                                                    {(leadSubEfforts?.length ?? 0) > 0 ? (
                                                    <span className="badge badge-sm badge-primary min-h-5 h-5 shrink-0 px-1.5">
                                                        {leadSubEfforts.length}
                                                    </span>
                                                ) : null}
                                            </button>
                                        </div>
                                    </>
                                )}

                                {/* Payment request sent Stage */}
                                {areStagesEquivalent(currentStageName, 'payment_request_sent') && handlePaymentReceivedNewClient && (
                                    <button
                                        onClick={handlePaymentReceivedNewClient}
                                        className={STAGE_ACTION_BTN_CLASS}
                                    >
                                        <CheckCircleIcon className="w-5 h-5" />
                                        Payment Received - new Client !!!
                                    </button>
                                )}

                                {/* Another meeting Stage - Check this first to avoid duplicates */}
                                {areStagesEquivalent(currentStageName, 'another_meeting') && (
                                    <>
                                        {setShowRescheduleDrawer && (
                                            <button
                                                onClick={() => setShowRescheduleDrawer(true)}
                                                className={STAGE_ACTION_BTN_CLASS}
                                            >
                                                <ArrowPathIcon className="w-5 h-5" />
                                                Meeting ReScheduling
                                            </button>
                                        )}
                                        {handleStageUpdate && (
                                            <button
                                                onClick={() => handleStageUpdate('Meeting Ended')}
                                                className={STAGE_ACTION_BTN_CLASS}
                                            >
                                                <CheckCircleIcon className="w-5 h-5" />
                                                Meeting Ended
                                            </button>
                                        )}
                                    </>
                                )}

                                {/* Meeting scheduled / Meeting rescheduling Stages - Exclude another_meeting to avoid duplicates */}
                                {!areStagesEquivalent(currentStageName, 'another_meeting') &&
                                    (areStagesEquivalent(currentStageName, 'meeting_scheduled') ||
                                        areStagesEquivalent(currentStageName, 'Meeting rescheduling') ||
                                        (isStageNumeric && (stageNumeric === 55 || stageNumeric === 21))) && (
                                        <>
                                            {/* Schedule Meeting button - only for stage 55, not for "Meeting scheduled" or "Meeting rescheduled" */}
                                            {!areStagesEquivalent(currentStageName, 'meeting_scheduled') &&
                                                !areStagesEquivalent(currentStageName, 'Meeting rescheduling') &&
                                                handleScheduleMenuClick &&
                                                scheduleMenuLabel && (
                                                    <button
                                                        onClick={handleScheduleMenuClick}
                                                        className={STAGE_ACTION_BTN_CLASS}
                                                    >
                                                        <CalendarDaysIcon className="w-5 h-5" />
                                                        {scheduleMenuLabel}
                                                    </button>
                                                )}
                                            {setShowRescheduleDrawer && (
                                                <button
                                                    onClick={() => setShowRescheduleDrawer(true)}
                                                    className={STAGE_ACTION_BTN_CLASS}
                                                >
                                                    <ArrowPathIcon className="w-5 h-5" />
                                                    Meeting ReScheduling
                                                </button>
                                            )}
                                            {/* Meeting Ended - only show for stage 21 if there are upcoming meetings, and exclude another_meeting */}
                                            {handleStageUpdate &&
                                                !areStagesEquivalent(currentStageName, 'another_meeting') &&
                                                (!(areStagesEquivalent(currentStageName, 'Meeting rescheduling') || (isStageNumeric && stageNumeric === 21)) || hasScheduledMeetings) && (
                                                    <button
                                                        onClick={() => handleStageUpdate('Meeting Ended')}
                                                        className={STAGE_ACTION_BTN_CLASS}
                                                    >
                                                        <CheckCircleIcon className="w-5 h-5" />
                                                        Meeting Ended
                                                    </button>
                                                )}
                                        </>
                                    )}

                                {/* Waiting for meeting summary Stage */}
                                {areStagesEquivalent(currentStageName, 'waiting_for_mtng_sum') && openSendOfferModal && (
                                    <button
                                        onClick={openSendOfferModal}
                                        className={STAGE_ACTION_BTN_CLASS}
                                    >
                                        <DocumentCheckIcon className="w-5 h-5" />
                                        Send Price Offer
                                    </button>
                                )}

                                {/* Communication Started Stage */}
                                {areStagesEquivalent(currentStageName, 'Communication started') && (
                                    <>
                                        {handleScheduleMenuClick && scheduleMenuLabel && (
                                            <button
                                                onClick={handleScheduleMenuClick}
                                                className={STAGE_ACTION_BTN_CLASS}
                                            >
                                                <CalendarDaysIcon className="w-5 h-5" />
                                                {scheduleMenuLabel}
                                            </button>
                                        )}
                                        {handleStageUpdate && (
                                            <button
                                                onClick={() => handleStageUpdate('Communication Started')}
                                                className={STAGE_ACTION_BTN_CLASS}
                                            >
                                                <ChatBubbleLeftRightIcon className="w-5 h-5" />
                                                {isStageNumeric && stageNumeric === 15 ? 'Scheduling Notes' : 'Communication Started'}
                                            </button>
                                        )}
                                    </>
                                )}

                                {/* Meeting summary + Agreement sent Stage */}
                                {areStagesEquivalent(currentStageName, 'Mtng sum+Agreement sent') && (
                                    <>
                                        {handleScheduleMenuClick && scheduleMenuLabel && (
                                            <button
                                                onClick={handleScheduleMenuClick}
                                                className={STAGE_ACTION_BTN_CLASS}
                                            >
                                                <CalendarDaysIcon className="w-5 h-5" />
                                                {scheduleMenuLabel}
                                            </button>
                                        )}
                                        {handleOpenSignedDrawer && (
                                            <button
                                                onClick={handleOpenSignedDrawer}
                                                className={CLIENT_SIGNED_STAGE_BTN_CLASS}
                                            >
                                                <HandThumbUpIcon className="w-5 h-5" />
                                                Client signed
                                            </button>
                                        )}
                                        {handleOpenDeclinedDrawer && (
                                            <button
                                                onClick={handleOpenDeclinedDrawer}
                                                className={CLIENT_DECLINED_STAGE_BTN_CLASS}
                                            >
                                                <HandThumbDownIcon className="w-5 h-5" />
                                                Client declined
                                            </button>
                                        )}
                                        {openSendOfferModal && (
                                            <button
                                                onClick={openSendOfferModal}
                                                className={STAGE_ACTION_BTN_CLASS}
                                            >
                                                <PencilSquareIcon className="w-5 h-5" />
                                                Revised price offer
                                            </button>
                                        )}
                                    </>
                                )}

                                {/* Stage 60: no action buttons (handler assignment is required and auto-advances to "Handler Set") */}

                                {/* Created / Precommunication — assign scheduler instead of stage buttons */}
                                {showAssignSchedulerInHeader && assignSchedulerContent ? (
                                    <div className={HEADER_ROLE_ASSIGN_WIDTH_CLASS}>{assignSchedulerContent}</div>
                                ) : null}

                                {/* General stages - Schedule Meeting and Communication Started */}
                                {/* Only show for stages that haven't been handled by specific sections above */}
                                {selectedClient &&
                                    !showAssignSchedulerInHeader &&
                                    !areStagesEquivalent(currentStageName, 'Handler Set') &&
                                    !areStagesEquivalent(currentStageName, 'Handler Started') &&
                                    !areStagesEquivalent(currentStageName, 'Application submitted') &&
                                    !areStagesEquivalent(currentStageName, 'payment_request_sent') &&
                                    !areStagesEquivalent(currentStageName, 'another_meeting') &&
                                    !areStagesEquivalent(currentStageName, 'meeting_scheduled') &&
                                    !areStagesEquivalent(currentStageName, 'Meeting rescheduling') &&
                                    !areStagesEquivalent(currentStageName, 'waiting_for_mtng_sum') &&
                                    !areStagesEquivalent(currentStageName, 'Communication started') &&
                                    !areStagesEquivalent(currentStageName, 'Mtng sum+Agreement sent') &&
                                    !areStagesEquivalent(currentStageName, 'Success') &&
                                    !areStagesEquivalent(currentStageName, 'handler_assigned') &&
                                    !areStagesEquivalent(currentStageName, 'client_signed') &&
                                    !areStagesEquivalent(currentStageName, 'client signed agreement') &&
                                    !areStagesEquivalent(currentStageName, 'Client signed agreement') &&
                                    !((isStageNumeric && stageNumeric === 105) || Number((selectedClient as any)?.stage) === 105) &&
                                    !(isStageNumeric && (stageNumeric === 21 || stageNumeric === 55)) && (
                                        <>
                                            {handleScheduleMenuClick && scheduleMenuLabel && (
                                                <button
                                                    onClick={handleScheduleMenuClick}
                                                    className={STAGE_ACTION_BTN_CLASS}
                                                >
                                                    <CalendarDaysIcon className="w-5 h-5" />
                                                    {scheduleMenuLabel}
                                                </button>
                                            )}
                                            {handleStageUpdate && (
                                                <button
                                                    onClick={() => handleStageUpdate('Communication Started')}
                                                    className={STAGE_ACTION_BTN_CLASS}
                                                >
                                                    <ChatBubbleLeftRightIcon className="w-5 h-5" />
                                                    Communication Started
                                                </button>
                                            )}
                                        </>
                                    )}
                            </>
                        );
                    })()}
                </div>

                {/* Mobile: assigned team */}
                <div
                    className={
                        connectToAppHeader
                            ? `mt-7 pt-6 md:hidden w-full ${sidebarPadClass} ${pagePadClass}`
                            : 'mt-7 pt-6 md:hidden w-full px-1 sm:px-2'
                    }
                >                    {(() => {
                        const isLegacyLead = selectedClient?.lead_type === 'legacy' || selectedClient?.id?.toString().startsWith('legacy_');

                        const getCloserDisplay = (): string => {
                            if (isLegacyLead) {
                              const fromJoin = (selectedClient as any).closer;
                              if (fromJoin && String(fromJoin).trim() && String(fromJoin).trim() !== '---') return String(fromJoin).trim();
                              return getEmployeeDisplayNameFromId((selectedClient as any).closer_id);
                            }
                            const closer = selectedClient.closer;
                            if (!closer || closer === '---' || closer === '--') return '---';
                            if (/^\d+$/.test(String(closer).trim())) return getEmployeeDisplayNameFromId(Number(closer));
                            const employee = allEmployees.find((emp: any) => emp.display_name && emp.display_name.trim() === String(closer).trim());
                            return employee ? employee.display_name : closer;
                        };

                        const getExpertDisplay = (): string => {
                            if (isLegacyLead) {
                              const fromJoin = (selectedClient as any).expert;
                              if (fromJoin && String(fromJoin).trim() && String(fromJoin).trim() !== '---') return String(fromJoin).trim();
                              return getEmployeeDisplayNameFromId((selectedClient as any).expert_id);
                            }
                            return getEmployeeDisplayNameFromId((selectedClient as any).expert) || '---';
                        };

                        const getHandlerDisplay = (): string => {
                            if (isLegacyLead) {
                                const fromJoin = (selectedClient as any).handler;
                                if (fromJoin && String(fromJoin).trim() && String(fromJoin).trim() !== '---' && String(fromJoin).toLowerCase() !== 'not assigned') return String(fromJoin).trim();
                                const handlerId = (selectedClient as any).case_handler_id;
                                if (handlerId) return getEmployeeDisplayNameFromId(handlerId) || '---';
                                return '---';
                            }
                            if ((selectedClient as any).case_handler_id) {
                                const handlerId = (selectedClient as any).case_handler_id;
                                return getEmployeeDisplayNameFromId(handlerId) || '---';
                            }
                            const handlerValue = (selectedClient as any).handler;
                            if (!handlerValue || handlerValue === '---' || handlerValue === '--') return '---';
                            if (typeof handlerValue === 'number' || (typeof handlerValue === 'string' && !isNaN(Number(handlerValue)) && handlerValue.toString().trim() !== '')) {
                                return getEmployeeDisplayNameFromId(handlerValue) || '---';
                            }
                            return handlerValue || '---';
                        };

                        const getSchedulerDisplay = (): string => {
                            if (isLegacyLead) {
                              const fromJoin = (selectedClient as any).scheduler;
                              if (fromJoin && String(fromJoin).trim() && String(fromJoin).trim() !== '---') {
                                const joined = String(fromJoin).trim();
                                // Partner booking may leave a numeric id here — resolve to name
                                if (/^\d+$/.test(joined)) {
                                  return getEmployeeDisplayNameFromId(joined) || joined;
                                }
                                return joined;
                              }
                              return getEmployeeDisplayNameFromId((selectedClient as any).meeting_scheduler_id);
                            }
                            const schedulerValue = selectedClient.scheduler;
                            if (!schedulerValue || schedulerValue === '---' || schedulerValue === '--') return '---';
                            // Automated booking stores tenants_employee.id (e.g. "177") — show display_name
                            if (
                              typeof schedulerValue === 'number' ||
                              (typeof schedulerValue === 'string' && /^\d+$/.test(schedulerValue.trim()))
                            ) {
                              return getEmployeeDisplayNameFromId(schedulerValue) || String(schedulerValue);
                            }
                            return String(schedulerValue);
                        };

                        const resolveNumericEmployeeId = (value: unknown): number | null => {
                            if (value == null || value === '' || value === '---' || value === '--') return null;
                            if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
                            const s = String(value).trim();
                            if (!s) return null;
                            if (/^\d+$/.test(s)) {
                                const n = Number(s);
                                return Number.isFinite(n) && n > 0 ? n : null;
                            }
                            const emp = allEmployees.find((e: any) =>
                                e?.display_name && e.display_name.trim().toLowerCase() === s.toLowerCase()
                            );
                            if (emp?.id == null) return null;
                            const n = typeof emp.id === 'bigint' ? Number(emp.id) : Number(emp.id);
                            return Number.isFinite(n) && n > 0 ? n : null;
                        };

                        const closerId = (() => {
                            if (isLegacyLead) return (selectedClient as any).closer_id ? Number((selectedClient as any).closer_id) : null;
                            return resolveNumericEmployeeId(selectedClient.closer);
                        })();
                        const expertId = (() => {
                            if (isLegacyLead) return (selectedClient as any).expert_id ? Number((selectedClient as any).expert_id) : null;
                            const expertId = (selectedClient as any).expert;
                            return expertId ? Number(expertId) : null;
                        })();
                        const handlerId = (() => {
                            const ch = (selectedClient as any).case_handler_id;
                            if (ch != null && String(ch).trim() !== '') {
                                const n = Number(ch);
                                return Number.isFinite(n) && n > 0 ? n : null;
                            }
                            if (isLegacyLead) return null;
                            return resolveNumericEmployeeId((selectedClient as any).handler);
                        })();
                        const schedulerId = (() => {
                            if (isLegacyLead) return (selectedClient as any).meeting_scheduler_id ? Number((selectedClient as any).meeting_scheduler_id) : null;
                            return resolveNumericEmployeeId(selectedClient.scheduler);
                        })();
                        const retentionHandlerId = (selectedClient as any).retainer_handler_id ? Number((selectedClient as any).retainer_handler_id) : null;

                        const closerDisplay = getCloserDisplay();
                        const expertDisplay = getExpertDisplay();
                        const handlerDisplay = getHandlerDisplay();
                        const schedulerDisplay = getSchedulerDisplay();
                        const retentionHandlerDisplay = getEmployeeDisplayNameFromId(retentionHandlerId);

                        const isRoleEmpty = (id: any, display: string) => {
                            const displayLower = display ? display.toLowerCase().trim() : '';
                            const isNotAssigned = displayLower.includes('not_assigned') || displayLower.includes('not assigned') || displayLower === 'not assigned' || displayLower === 'unassigned';
                            if (!id && (!display || display === '---' || display === '--' || isNotAssigned)) return true;
                            if (id && isNotAssigned) return true;
                            return false;
                        };

                        const isUnactivated = isLegacyLead
                            ? (selectedClient?.status === 10)
                            : (selectedClient?.status === 'inactive');

                        const activeHandlerTypeForLead = Number((selectedClient as any).active_handler_type) === 1 ? 1 : 2;
                        const hasHandlerRole = showHandlerRolesInHeader && !isRoleEmpty(handlerId, handlerDisplay);
                        const hasRetentionRole = showHandlerRolesInHeader && !isRoleEmpty(retentionHandlerId, retentionHandlerDisplay);
                        const showDualHandlerToggle = hasHandlerRole && hasRetentionRole && !isUnactivated;

                        const roleGroups = new Map<string, { id: string | number | null; roles: string[]; display: string }>();
                        if (!showLeadCostUi) {
                            if (!isRoleEmpty(closerId, closerDisplay)) {
                                const key = closerId ? closerId.toString() : closerDisplay;
                                if (!roleGroups.has(key)) roleGroups.set(key, { id: closerId, roles: [], display: closerDisplay });
                                roleGroups.get(key)!.roles.push('Closer');
                            }
                            if (!isRoleEmpty(expertId, expertDisplay)) {
                                const key = expertId ? expertId.toString() : expertDisplay;
                                if (!roleGroups.has(key)) roleGroups.set(key, { id: expertId, roles: [], display: expertDisplay });
                                roleGroups.get(key)!.roles.push('Expert');
                            }
                            if (!isRoleEmpty(schedulerId, schedulerDisplay)) {
                                const key = schedulerId ? schedulerId.toString() : schedulerDisplay;
                                if (!roleGroups.has(key)) roleGroups.set(key, { id: schedulerId, roles: [], display: schedulerDisplay });
                                roleGroups.get(key)!.roles.push('Scheduler');
                            }
                        }

                        return (
                            <div className="flex w-full flex-col gap-2">
                                {showLeadCostUi ? (
                                    <LeadRemainingTimeBar
                                        summary={leadEmployeeCostSummary}
                                        loading={leadEmployeeCostLoading}
                                        align="start"
                                        className="w-full max-w-md self-stretch"
                                        showStatusIcon
                                        onClick={() =>
                                            openLeadEmployeeCostModal(
                                                leadEmployeeCostSummary?.exceedsCap ? 'warning' : 'overview',
                                            )
                                        }
                                    />
                                ) : null}
                                {Array.from(roleGroups.values()).map((group, index) => (
                                    <div
                                        key={index}
                                        className={`${CLIENT_HEADER_CARD} flex w-full flex-col justify-center`}
                                    >
                                        <div className="flex shrink-0 items-center gap-2">
                                            <EmployeeAvatar employeeId={group.id} size="md" />
                                            <div className="flex flex-col">
                                                <span className={`whitespace-nowrap ${TEAM_ROLE_LABEL}`}>
                                                    {group.roles.join(', ')}
                                                </span>
                                                <span className="whitespace-nowrap text-sm font-semibold text-base-content/85">
                                                    {formatRoleDisplay(group.display)}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                {hasHandlerRole ? (
                                    <div className={`${CLIENT_HEADER_CARD} flex w-full flex-col justify-center`}>
                                        <div className="flex shrink-0 items-center gap-2">
                                            <EmployeeAvatar employeeId={handlerId} size="md" />
                                            <div className="flex flex-col">
                                                <span className={`whitespace-nowrap ${TEAM_ROLE_LABEL}`}>Handler</span>
                                                <span className="whitespace-nowrap text-sm font-semibold text-base-content/85">
                                                    {formatRoleDisplay(handlerDisplay)}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                ) : null}
                                {hasRetentionRole ? (
                                    <div className={`${CLIENT_HEADER_CARD} flex w-full flex-col justify-center`}>
                                        <div className="flex shrink-0 items-center gap-2">
                                            <EmployeeAvatar employeeId={retentionHandlerId} size="md" />
                                            <div className="flex flex-col">
                                                <span className={`whitespace-nowrap ${TEAM_ROLE_LABEL}`}>R-Handler</span>
                                                <span className="whitespace-nowrap text-sm font-semibold text-base-content/85">
                                                    {formatRoleDisplay(retentionHandlerDisplay)}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                        );
                    })()}
                </div>

                </div>
                </div>

                {/* Category Edit Modal */}
                <MobileBottomSheet
                    open={headerActionsMenuOpen}
                    onClose={closeHeaderActionsMenu}
                    title="Actions"
                    subtitle={
                        selectedClient?.name
                            ? `${selectedClient.name}${selectedClient?.lead_number ? ` · #${selectedClient.lead_number}` : ''}`
                            : undefined
                    }
                    desktopLayout="drawer-right"
                    zIndex={325}
                    headerClassName="!border-b border-neutral-200"
                    contentClassName="!px-3 !pb-6 !bg-white"
                    overlayClassName="bg-black/40"
                    sheetClassName="md:max-w-[min(100%,22rem)] md:shadow-xl md:!border-l md:!border-neutral-200 md:!bg-white"
                >
                    <div
                        onClick={(e) => {
                            const target = e.target as HTMLElement;
                            if (target.closest('[data-keep-actions-open]')) return;
                            if (target.closest('button, a, [role="button"]')) {
                                closeHeaderActionsMenu();
                                closeMoreActionsSheet();
                            }
                        }}
                    >
                        {renderHeaderActionsSheetList()}
                        {!hideActionsDropdown ? (
                            <div className="mt-6 border-t border-neutral-200 pt-5">
                                {moreActionsMenuItems}
                            </div>
                        ) : null}
                    </div>
                </MobileBottomSheet>

                <MobileBottomSheet
                    open={moreActionsSheetOpen}
                    onClose={closeMoreActionsSheet}
                    title="Actions"
                    subtitle={
                        selectedClient?.name
                            ? `${selectedClient.name}${selectedClient?.lead_number ? ` · #${selectedClient.lead_number}` : ''}`
                            : undefined
                    }
                    desktopLayout="drawer-right"
                    zIndex={330}
                    headerClassName="!border-b-0"
                    sheetClassName="md:max-w-[min(100%,22rem)] md:shadow-2xl"
                    contentClassName="!px-4 !pb-6 bg-base-200/25 dark:bg-base-300/10"
                    overlayClassName="backdrop-blur-[1px]"
                >
                    <div
                        onClick={(e) => {
                            const target = e.target as HTMLElement;
                            if (target.closest('button, a, [role="button"]')) {
                                closeMoreActionsSheet();
                            }
                        }}
                    >
                        {moreActionsMenuItems}
                    </div>
                </MobileBottomSheet>

                <MobileBottomSheet
                    open={contactDetailsModalOpen}
                    onClose={() => setContactDetailsModalOpen(false)}
                    title={selectedClient?.name || 'Contact details'}
                    subtitle={selectedClient?.lead_number ? `#${selectedClient.lead_number}` : undefined}
                    zIndex={320}
                    sheetClassName="md:max-w-sm md:!border-0 max-md:!border-t-0"
                    headerClassName="!border-0"
                    contentClassName="!px-5 !pb-6"
                >
                    <div className="flex flex-col gap-5">
                        {renderContactDetailField('Mobile', displayMobile)}
                        {renderContactDetailField('Email', displayEmail)}
                        {renderContactDetailField('Phone', displayPhone)}
                    </div>
                </MobileBottomSheet>

                <EditFieldModal
                    open={showCategoryModal}
                    onClose={() => {
                        setShowCategoryModal(false);
                        setShowCategoryDropdown(false);
                        setCategoryInputValue('');
                    }}
                    title="Edit Category"
                    subtitle={selectedClient?.name}
                    onSave={async () => {
                        await handleSaveCategory();
                        setShowCategoryModal(false);
                        setShowCategoryDropdown(false);
                        setCategoryInputValue('');
                    }}
                >
                    <div>
                        <EditFieldLabel>Category</EditFieldLabel>
                        <input
                            autoFocus
                            type="text"
                            className={EDIT_FIELD_INPUT}
                            placeholder="Search categories..."
                            value={categoryInputValue}
                            onChange={(e) => {
                                const v = e.target.value;
                                setCategoryInputValue(v);
                                setShowCategoryDropdown(v.trim().length > 0);
                            }}
                            onFocus={() => setShowCategoryDropdown(categoryInputValue.trim().length > 0)}
                        />
                        {showCategoryDropdown && filteredCategories.length > 0 && (
                            <div className={EDIT_FIELD_DROPDOWN}>
                                {filteredCategories.slice(0, 20).map((cat: any) => {
                                    const displayName = cat.misc_maincategory?.name
                                        ? `${cat.name} (${cat.misc_maincategory.name})`
                                        : cat.name;
                                    return (
                                        <div
                                            key={cat.id}
                                            className={EDIT_FIELD_DROPDOWN_ITEM}
                                            onClick={() => {
                                                setCategoryInputValue(displayName);
                                                setShowCategoryDropdown(false);
                                            }}
                                        >
                                            {displayName}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </EditFieldModal>

                <EditFieldModal
                    open={showLanguageModal}
                    onClose={() => {
                        setShowLanguageModal(false);
                        setShowLanguageDropdown(false);
                        setLanguageInputValue('');
                    }}
                    title="Edit Language"
                    subtitle={selectedClient?.name}
                    saving={savingLanguage}
                    onSave={() => void handleSaveLanguage()}
                >
                    <div>
                        <EditFieldLabel>Language</EditFieldLabel>
                        <input
                            autoFocus
                            type="text"
                            className={EDIT_FIELD_INPUT}
                            placeholder="Search languages..."
                            value={languageInputValue}
                            onChange={(e) => {
                                const v = e.target.value;
                                setLanguageInputValue(v);
                                setShowLanguageDropdown(v.trim().length > 0);
                            }}
                            onFocus={() => setShowLanguageDropdown(languageInputValue.trim().length > 0)}
                        />
                        {showLanguageDropdown && filteredLanguages.length > 0 && (
                            <div className={EDIT_FIELD_DROPDOWN}>
                                {filteredLanguages.slice(0, 20).map((lang) => (
                                    <div
                                        key={String(lang.id)}
                                        className={EDIT_FIELD_DROPDOWN_ITEM}
                                        onClick={() => {
                                            setLanguageInputValue(lang.name);
                                            setShowLanguageDropdown(false);
                                        }}
                                    >
                                        {lang.name}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </EditFieldModal>

                <EditFieldModal
                    open={showTopicModal}
                    onClose={() => {
                        setShowTopicModal(false);
                        setTopicInputValue('');
                    }}
                    title="Edit Topic"
                    subtitle={selectedClient?.name}
                    saving={savingTopic}
                    onSave={() => void handleSaveTopic()}
                >
                    <div>
                        <EditFieldLabel>Topic</EditFieldLabel>
                        <input
                            autoFocus
                            type="text"
                            className={EDIT_FIELD_INPUT}
                            placeholder="Topic (optional)"
                            value={topicInputValue}
                            onChange={(e) => setTopicInputValue(e.target.value)}
                        />
                    </div>
                </EditFieldModal>

                {/* Call Options Modal */}
                <CallOptionsModal
                    isOpen={isCallModalOpen}
                    onClose={() => setIsCallModalOpen(false)}
                    phoneNumber={callPhoneNumber}
                    leadName={callContactName}
                />

                <DocumentModal
                    isOpen={headerDocumentsModalOpen}
                    onClose={() => setHeaderDocumentsModalOpen(false)}
                    leadNumber={headerDocsLeadNumber}
                    clientName={selectedClient.name || ''}
                    clientId={(selectedClient as any)?.id ?? null}
                    onedriveSubFolder={CLIENT_HEADER_ONEDRIVE_SUBFOLDER}
                    modalTitle="Case documents"
                    requireCaseDocumentClassification
                    onDocumentCountChange={setHeaderSupabaseDocumentsCount}
                />

                <LeadTagsModal
                    isOpen={tagsModalOpen}
                    onClose={() => setTagsModalOpen(false)}
                    leadId={(selectedClient as any)?.id}
                    isLegacyLead={
                        (() => {
                            const rawId = String((selectedClient as any)?.id ?? '');
                            return (
                                (selectedClient as any)?.lead_type === 'legacy' ||
                                rawId.startsWith('legacy_') ||
                                (rawId !== '' && !rawId.includes('-') && /^\d+$/.test(rawId))
                            );
                        })()
                    }
                    initialTags={leadTags}
                    onSaved={async (next) => {
                        setLeadTags(next);
                        const id = (selectedClient as any)?.id;
                        if (id != null) {
                            leadTagsCache.set(String(id), next);
                            await refreshClientData(id);
                        }
                    }}
                />

                {activeRoleReveal &&
                    createPortal(
                        <div
                            className={`fixed inset-0 z-[500] flex items-center justify-center p-4 sm:p-8 transition-[opacity,backdrop-filter] duration-500 ease-out ${
                                activeRoleRevealEntered ? 'bg-black/60 opacity-100 backdrop-blur-[10px]' : 'opacity-0 backdrop-blur-0'
                            }`}
                            onClick={() => setActiveRoleReveal(null)}
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="active-role-reveal-title"
                        >
                            <div
                                className={`relative w-full max-w-md overflow-hidden rounded-2xl border px-8 pb-0 pt-11 shadow-[0_24px_64px_-16px_rgba(15,23,42,0.22)] transition-all duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none dark:shadow-[0_24px_64px_-16px_rgba(0,0,0,0.55)] ${
                                    activeRoleRevealEntered
                                        ? 'translate-y-0 scale-100 rotate-0 opacity-100'
                                        : 'translate-y-10 scale-[0.82] rotate-[-2deg] opacity-0'
                                } ${
                                    activeRoleReveal.activeType === 2
                                        ? 'border-emerald-200/90 bg-gradient-to-b from-white via-white to-emerald-50/50 dark:border-emerald-900/50 dark:from-gray-950 dark:via-gray-950 dark:to-emerald-950/25'
                                        : 'border-rose-200/90 bg-gradient-to-b from-white via-white to-rose-50/45 dark:border-rose-900/45 dark:from-gray-950 dark:via-gray-950 dark:to-rose-950/20'
                                }`}
                                onClick={(e) => e.stopPropagation()}
                            >
                                {/* Single static wash — no pulse/blur stacks (reads cleaner on screen) */}
                                <div
                                    className={`pointer-events-none absolute inset-0 ${
                                        activeRoleReveal.activeType === 2
                                            ? 'bg-[radial-gradient(ellipse_85%_55%_at_50%_-5%,rgba(16,185,129,0.11),transparent_62%)]'
                                            : 'bg-[radial-gradient(ellipse_85%_55%_at_50%_-5%,rgba(244,63,94,0.09),transparent_62%)]'
                                    }`}
                                    aria-hidden
                                />

                                <div className="relative flex flex-col items-center text-center">
                                    <p
                                        id="active-role-reveal-title"
                                        className="text-[10px] font-semibold uppercase tracking-[0.28em] text-gray-500/90 dark:text-gray-400"
                                    >
                                        Active role on this lead
                                    </p>
                                    <p
                                        className={`mt-3 text-2xl font-bold tracking-tight sm:text-3xl ${
                                            activeRoleReveal.activeType === 2
                                                ? 'text-emerald-700 dark:text-emerald-300'
                                                : 'text-rose-700 dark:text-rose-300'
                                        }`}
                                    >
                                        {activeRoleReveal.roleTitle}
                                    </p>
                                    <p className="mt-2 max-w-xs text-sm text-gray-600 dark:text-gray-300">
                                        {activeRoleReveal.displayName !== '---'
                                            ? activeRoleReveal.displayName
                                            : 'This role is now driving the file for workflows and visibility.'}
                                    </p>

                                    <div
                                        className={`relative mt-10 flex items-center justify-center transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
                                            activeRoleRevealEntered ? 'scale-100' : 'scale-50'
                                        }`}
                                    >
                                        <div
                                            className={`absolute inset-[-14px] rounded-full opacity-80 motion-safe:animate-[ping_1.4s_cubic-bezier(0,0,0.2,1)_1] ${
                                                activeRoleReveal.activeType === 2
                                                    ? 'bg-emerald-400/35'
                                                    : 'bg-rose-400/35'
                                            }`}
                                            aria-hidden
                                        />
                                        <div
                                            className={`relative rounded-full p-1 shadow-xl ring-4 ring-offset-4 ring-offset-base-100 dark:ring-offset-gray-950 ${
                                                activeRoleReveal.activeType === 2
                                                    ? 'ring-emerald-500/80 shadow-emerald-500/25'
                                                    : 'ring-rose-500/80 shadow-rose-500/25'
                                            }`}
                                        >
                                            {activeRoleReveal.employeeId ? (
                                                <EmployeeAvatar employeeId={activeRoleReveal.employeeId} size="hero" />
                                            ) : (
                                                <div
                                                    className={`flex h-36 w-36 items-center justify-center rounded-full bg-gradient-to-br font-bold text-white shadow-inner ${
                                                        activeRoleReveal.activeType === 2
                                                            ? 'from-emerald-500 to-teal-700'
                                                            : 'from-rose-500 to-pink-700'
                                                    }`}
                                                >
                                                    {getEmployeeInitials(activeRoleReveal.displayName) ? (
                                                        <span className="text-4xl tracking-tight">
                                                            {getEmployeeInitials(activeRoleReveal.displayName)}
                                                        </span>
                                                    ) : (
                                                        <UserIcon className="h-16 w-16 opacity-90" aria-hidden />
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                        <StarIcon
                                            className={`pointer-events-none absolute -right-2 -top-2 h-8 w-8 motion-safe:animate-pulse ${
                                                activeRoleReveal.activeType === 2
                                                    ? 'text-amber-400 drop-shadow-md'
                                                    : 'text-amber-300 drop-shadow-md'
                                            }`}
                                            aria-hidden
                                        />
                                    </div>

                                </div>

                                <div className="relative mt-10 border-t border-gray-200/80 bg-white/60 px-6 py-4 dark:border-gray-700/80 dark:bg-gray-950/40">
                                    <button
                                        type="button"
                                        className="mx-auto flex w-full max-w-[14rem] items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50 active:bg-gray-100 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200 dark:hover:border-gray-500 dark:hover:bg-gray-800 dark:active:bg-gray-950"
                                        onClick={() => setActiveRoleReveal(null)}
                                    >
                                        <XMarkIcon className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
                                        Dismiss
                                    </button>
                                    <p className="mt-2.5 text-center text-[11px] font-medium text-gray-400 dark:text-gray-500">
                                        Or click outside to close
                                    </p>
                                </div>
                            </div>
                        </div>,
                        document.body
                    )}

                {pendingProbabilityValues &&
                    createPortal(
                        <div className="pointer-events-auto fixed bottom-4 right-4 z-[330] w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-amber-200/90 bg-amber-50/95 p-4 shadow-xl backdrop-blur-sm dark:border-amber-700/50 dark:bg-amber-950/90">
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <p className="text-sm font-semibold text-amber-950 dark:text-amber-100">
                                        Case probability pending
                                    </p>
                                    <p className="mt-1 text-xs text-amber-900/85 dark:text-amber-200/90">
                                        {pendingProbabilitySaving
                                            ? 'Saving…'
                                            : flaggedConversationCount > 0
                                              ? 'Saving…'
                                              : 'Flag a message on Interactions to save.'}
                                    </p>
                                    {pendingProbabilitySaving ? (
                                        <div className="mt-2 flex items-center gap-2">
                                            <span className="loading loading-spinner loading-sm text-amber-800" />
                                        </div>
                                    ) : (
                                        <p className="mt-2 text-lg font-bold tabular-nums text-amber-950 dark:text-amber-50">
                                            {caseProbabilityFromFactors(
                                                pendingProbabilityValues.legal,
                                                pendingProbabilityValues.seriousness,
                                                pendingProbabilityValues.financial
                                            )}
                                            %
                                        </p>
                                    )}
                                </div>
                                {onDismissPendingProbability && !pendingProbabilitySaving && (
                                    <button
                                        type="button"
                                        className="btn btn-ghost btn-xs btn-square shrink-0 text-amber-900 dark:text-amber-100"
                                        onClick={onDismissPendingProbability}
                                        aria-label="Dismiss"
                                    >
                                        <XMarkIcon className="h-4 w-4" />
                                    </button>
                                )}
                            </div>
                        </div>,
                        document.body
                    )}
            {selectedClient && showLeadCostUi && (
                <LeadEmployeeCostModal
                    open={leadEmployeeCostModalOpen}
                    onClose={() => setLeadEmployeeCostModalOpen(false)}
                    loading={leadEmployeeCostLoading}
                    summary={leadEmployeeCostSummary}
                    mode={leadEmployeeCostModalMode}
                    isSuperuser={isSuperuser}
                />
            )}
            {selectedClient && showLeadCostUi && (
                <LeadOverBudgetGateModal
                    open={overBudgetGateOpen && !budgetExtensionRequestOpen}
                    summary={leadEmployeeCostSummary}
                    isSuperuser={isSuperuser}
                    onRequestManagement={handleOpenBudgetExtensionRequest}
                    onSkip={handleSkipOverBudgetGate}
                />
            )}
            {selectedClient && showLeadCostUi && (
                <LeadBudgetExtensionRequestModal
                    open={budgetExtensionRequestOpen}
                    summary={leadEmployeeCostSummary}
                    isSuperuser={isSuperuser}
                    submitting={budgetExtensionSubmitting}
                    onClose={() => setBudgetExtensionRequestOpen(false)}
                    onSubmit={handleSubmitBudgetExtensionRequest}
                />
            )}
            {!openEditLeadDrawerProp && selectedClient && (
                <EditLeadDrawer
                    isOpen={editLeadDrawerOpen}
                    onClose={() => setEditLeadDrawerOpenState(false)}
                    lead={selectedClient}
                    onSave={() => refreshClientData(selectedClient.id)}
                    totalLocked={hasPaymentPlan === true}
                />
            )}
            {selectedClient && (
                <ClientPortalAdminCard
                    leadId={String(selectedClient.id ?? '')}
                    leadType={selectedClient.lead_type}
                    leadNumber={(selectedClient as { lead_number?: string }).lead_number}
                    open={clientPortalModalOpen}
                    onOpenChange={setClientPortalModalOpen}
                    showTrigger={false}
                />
            )}
            {selectedClient && (subEffortsStageFlags.fetchLeadSubEffortRows || isSubEffortsModalOpen) && (
                <>
                    {/* Floating side-tab scroll indicator removed — open sub efforts from header actions instead. */}
                    <SubEffortsLogModal
                        open={isSubEffortsModalOpen}
                        onClose={() => {
                            setIsSubEffortsModalOpen(false);
                            setInitialClientUploadsOpen(false);
                        }}
                        rows={leadSubEfforts}
                        leadNumber={headerDocsLeadNumber || selectedClient?.lead_number || null}
                        clientName={selectedClient?.name || null}
                        leadStage={(selectedClient as any)?.stage ?? null}
                        clientId={(selectedClient as any)?.id ?? null}
                        initialSelectedRowId={subEffortsModalRowId}
                        initialClientUploadsOpen={initialClientUploadsOpen}
                        onRefresh={() => void fetchLeadSubEfforts()}
                        categoryLinkedCount={subEfforts.length}
                        hasLeadCaseType={leadMiscCategoryId != null}
                        subEffortOptions={subEffortAddOptions.map((o) => ({ id: o.id, name: o.name }))}
                        isLoadingSubEffortOptions={isLoadingSubEffortAddOptions}
                        isAddingSubEffort={isAddingLeadSubEffort}
                        onAddSubEffort={handleAddLeadSubEffort}
                        isRemovingSubEffort={isRemovingLeadSubEffort}
                        onRemoveSubEffort={handleRemoveLeadSubEffort}
                    />
                </>
            )}
            <PinnedInteractionsModal
                open={pinnedInteractionsModalOpen}
                onClose={() => setPinnedInteractionsModalOpen(false)}
                loading={pinnedInteractionsLoading}
                pins={pinnedInteractions}
                onView={handleViewPinnedInteraction}
                onUnpin={handleUnpinPinnedInteraction}
            />
        </div>
    );
};

export default ClientHeader;
