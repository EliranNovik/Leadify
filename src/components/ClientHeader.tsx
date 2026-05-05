import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
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
    Bars3Icon,
    DocumentTextIcon,
    LinkIcon,
    FlagIcon,
    XMarkIcon,
    RectangleStackIcon,
    LockClosedIcon,
    DocumentArrowUpIcon,
} from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { getStageName, getStageColour, areStagesEquivalent } from '../lib/stageUtils';
import { addToHighlights, removeFromHighlights } from '../lib/highlightsUtils';
import { getUnactivationReasonFromId } from '../lib/unactivationReasons';
import CallOptionsModal from './CallOptionsModal';
import LeadTagsModal from './LeadTagsModal';
import { fetchLeadContacts } from '../lib/contactHelpers';
import type { ContactInfo } from '../lib/contactHelpers';
import type { WhatsAppPageSelectedContact } from '../pages/WhatsAppPage';
import { FaWhatsapp } from 'react-icons/fa';
import { fetchUnpaidTotalsByCurrency, getVatRateForLegacyLead, pickUnpaidBaseAndVatForCurrency, type UnpaidByCurrencyMap } from '../lib/financeUnpaidTotal';
import { useAuthContext } from '../contexts/AuthContext';
import { fetchStageActorInfo } from '../lib/leadStageManager';
import { SubEffortsLogModal } from './SubEffortsLogModal';
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
import { caseProbabilityFromFactors, type ProbabilitySlidersValues } from './client-tabs/ProbabilitySlidersModal';
import DocumentModal from './DocumentModal';
import { CLIENT_HEADER_ONEDRIVE_SUBFOLDER } from '../lib/leadOneDrivePaths';

// Lightweight in-memory caches to avoid refetching static dropdown data on mobile.
let cachedLeadSources: Array<{ id: number | string; name: string }> | null = null;
let cachedLeadSourcesPromise: Promise<Array<{ id: number | string; name: string }>> | null = null;

let cachedCurrencies: Array<{ id: number | string; name: string; iso_code: string | null }> | null = null;
let cachedCurrenciesPromise: Promise<
  Array<{ id: number | string; name: string; iso_code: string | null }>
> | null = null;

let cachedCategories: any[] | null = null;
let cachedCategoriesPromise: Promise<any[]> | null = null;

let cachedLanguages: Array<{ id: number | string; name: string }> | null = null;
let cachedLanguagesPromise: Promise<Array<{ id: number | string; name: string }>> | null = null;

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

/** Neutral meta chips (language, source, applicants, category, topic) — primary stage colour stays on stage badge only */
const META_CHIP =
    'inline-flex max-w-full min-w-0 shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-gray-700 bg-base-200/80 dark:bg-gray-700/90 dark:text-gray-200';

/** Larger chips for the four primary meta items: language, source, category, topic */
const META_CHIP_TOP =
    'inline-flex max-w-full min-w-0 shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-sm font-medium text-gray-700 bg-base-200/80 dark:bg-gray-700/90 dark:text-gray-200';

interface ClientHeaderProps {
    selectedClient: any;
    refreshClientData: (clientId: number | string) => Promise<void>;
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
    setIsDuplicateModalOpen: (isOpen: boolean) => void;
    setIsDuplicateDropdownOpen: (isOpen: boolean) => void;
    isDuplicateDropdownOpen: boolean;
    setShowSubLeadDrawer: (show: boolean) => void;
    openEditLeadDrawer: () => void;
    handleActivation: () => void;
    setShowUnactivationModal: (show: boolean) => void;
    renderStageBadge: (anchor?: 'badge' | 'mobile' | 'desktop') => React.ReactNode;
    getEmployeeDisplayName: (id: string | null | undefined) => string;
    allEmployees?: any[];
    dropdownsContent?: React.ReactNode;
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
    hasScheduledMeetings?: boolean;
    isStageNumeric?: boolean;
    stageNumeric?: number;
    /** When true, hides Timeline and History buttons (e.g. external user modal) */
    hideHistoryAndTimeline?: boolean;
    /** When true, hides the Actions dropdown (cog icon) (e.g. external user modal) */
    hideActionsDropdown?: boolean;
    /** When true, hides the Total Value badge (e.g. external user modal) */
    hideTotalValueBadge?: boolean;
    /** When true, Total Value is driven by payment plan and locked. */
    hasPaymentPlan?: boolean;
    /** Sum of payment plan base (lead currency) when locked. */
    paymentPlanBaseTotal?: number | null;
    /** Sum of payment plan VAT (lead currency) when locked. */
    paymentPlanVatTotal?: number | null;
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
}

const ClientHeader: React.FC<ClientHeaderProps> = ({
    selectedClient,
    refreshClientData,
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
    setIsDuplicateModalOpen,
    setIsDuplicateDropdownOpen,
    isDuplicateDropdownOpen,
    setShowSubLeadDrawer,
    openEditLeadDrawer,
    handleActivation,
    setShowUnactivationModal,
    renderStageBadge,
    getEmployeeDisplayName,
    allEmployees = [],
    dropdownsContent,
    dropdownItems,
    handlePaymentReceivedNewClient,
    handleScheduleMenuClick,
    handleStageUpdate,
    openSendOfferModal,
    handleOpenSignedDrawer,
    handleOpenDeclinedDrawer,
    setShowRescheduleDrawer,
    scheduleMenuLabel,
    hasScheduledMeetings,
    isStageNumeric,
    stageNumeric,
    hideHistoryAndTimeline = false,
    hideActionsDropdown = false,
    hideTotalValueBadge = false,
    hasPaymentPlan = false,
    paymentPlanBaseTotal = null,
    paymentPlanVatTotal = null,
    disableCategoryModal = false,
    onCombineLeads,
    onOpenWhatsAppForContact,
    flaggedConversationCount = 0,
    onSwitchClientTab,
    pendingProbabilityValues = null,
    pendingProbabilitySaving = false,
    onDismissPendingProbability,
}) => {
    const navigate = useNavigate();
    const [subEfforts, setSubEfforts] = useState<Array<{ id: number; name: string }>>([]);
    const [isLoadingSubEfforts, setIsLoadingSubEfforts] = useState(false);
    const [isSavingSubEffort, setIsSavingSubEffort] = useState(false);
    const [leadSubEfforts, setLeadSubEfforts] = useState<any[]>([]);
    const [isLoadingLeadSubEfforts, setIsLoadingLeadSubEfforts] = useState(false);
    const [isSubEffortsModalOpen, setIsSubEffortsModalOpen] = useState(false);
    const [subEffortsModalRowId, setSubEffortsModalRowId] = useState<string | number | null>(null);
    const [isEditingCategory, setIsEditingCategory] = useState(false);
    /** Unpaid finance plan totals by currency (from payment_plans / finances_paymentplanrow, excludes paid rows). */
    const [unpaidByCurrency, setUnpaidByCurrency] = useState<UnpaidByCurrencyMap | null>(null);
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
    const activeHandlerLeadRealtimeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    /** Latest row identity + active_handler_type for poll + realtime client-side match (avoids stale closures). */
    const leadHandlerSyncRef = useRef<{
        clientId: string | number;
        idStr: string;
        isLegacy: boolean;
        legacyNum: number | null;
        canonicalNewId: string | null;
        activeType: number;
    } | null>(null);

    /** Keep header (incl. active handler toggle) in sync when this row changes in the DB (other tabs, My Cases, etc.). */
    useEffect(() => {
        if (!selectedClient?.id) return;
        const clientId = selectedClient.id;
        const idStr = String(clientId);
        const isLegacy = idStr.startsWith('legacy_') || selectedClient.lead_type === 'legacy';

        let legacyNum: number | null = null;
        if (isLegacy) {
            const n = parseInt(idStr.replace(/^legacy_/, ''), 10);
            if (Number.isNaN(n)) return;
            legacyNum = n;
        }
        const canonicalNewId = !isLegacy ? idStr.toLowerCase() : null;

        const activeType = Number((selectedClient as any).active_handler_type) === 1 ? 1 : 2;
        leadHandlerSyncRef.current = {
            clientId,
            idStr,
            isLegacy,
            legacyNum,
            canonicalNewId,
            activeType,
        };

        const table: 'leads' | 'leads_lead' = isLegacy ? 'leads_lead' : 'leads';

        const rowMatchesPayload = (payload: { new?: Record<string, unknown> } | null) => {
            const nid = payload?.new?.id;
            if (nid == null) return false;
            if (isLegacy && legacyNum != null) return Number(nid) === legacyNum;
            if (!canonicalNewId) return false;
            return String(nid).toLowerCase() === canonicalNewId;
        };

        const debounceMs = 400;
        const scheduleRefresh = () => {
            if (activeHandlerLeadRealtimeTimerRef.current) {
                clearTimeout(activeHandlerLeadRealtimeTimerRef.current);
            }
            activeHandlerLeadRealtimeTimerRef.current = setTimeout(() => {
                activeHandlerLeadRealtimeTimerRef.current = null;
                void refreshClientData(clientId);
            }, debounceMs);
        };

        const pollMs = 10000;
        const pollActiveHandlerFromDb = async () => {
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
            const snap = leadHandlerSyncRef.current;
            if (!snap) return;
            try {
                if (snap.isLegacy && snap.legacyNum != null) {
                    const { data, error } = await supabase
                        .from('leads_lead')
                        .select('active_handler_type')
                        .eq('id', snap.legacyNum)
                        .maybeSingle();
                    if (error || !data) return;
                    const remote = Number(data.active_handler_type) === 1 ? 1 : 2;
                    if (remote !== snap.activeType) void refreshClientData(snap.clientId);
                } else {
                    const { data, error } = await supabase
                        .from('leads')
                        .select('active_handler_type')
                        .eq('id', snap.idStr)
                        .maybeSingle();
                    if (error || !data) return;
                    const remote = Number(data.active_handler_type) === 1 ? 1 : 2;
                    if (remote !== snap.activeType) void refreshClientData(snap.clientId);
                }
            } catch {
                /* ignore */
            }
        };

        let cancelled = false;
        let channel: ReturnType<typeof supabase.channel> | null = null;
        let pollIntervalId: number | null = null;

        void supabase.auth
            .getSession()
            .then(async ({ data: { session } }) => {
                if (cancelled) return;
                const token = session?.access_token;
                if (token) {
                    try {
                        await supabase.realtime.setAuth(token);
                    } catch {
                        /* Realtime may still work with anon JWT */
                    }
                }
                if (cancelled) return;

                // No server-side filter: filtered postgres_changes often fails (UUID/RLS/replication).
                // Match CalendarPage pattern — filter client-side to this lead only.
                channel = supabase
                    .channel(`client-header-lead-${encodeURIComponent(idStr)}`)
                    .on(
                        'postgres_changes',
                        { event: 'UPDATE', schema: 'public', table },
                        (payload: { new?: Record<string, unknown> }) => {
                            if (!rowMatchesPayload(payload)) return;
                            scheduleRefresh();
                        }
                    )
                    .subscribe((status, err) => {
                        if (import.meta.env.DEV) {
                            if (status === 'SUBSCRIBED') {
                                console.info('[ClientHeader] Realtime subscribed:', table, idStr);
                            }
                            if (status === 'CHANNEL_ERROR' || err) {
                                console.warn('[ClientHeader] Realtime channel issue:', status, err);
                            }
                        }
                    });

                pollIntervalId = window.setInterval(() => {
                    void pollActiveHandlerFromDb();
                }, pollMs);
                void pollActiveHandlerFromDb();
            })
            .catch(() => {
                if (cancelled) return;
                channel = supabase
                    .channel(`client-header-lead-${encodeURIComponent(idStr)}-fallback`)
                    .on(
                        'postgres_changes',
                        { event: 'UPDATE', schema: 'public', table },
                        (payload: { new?: Record<string, unknown> }) => {
                            if (!rowMatchesPayload(payload)) return;
                            scheduleRefresh();
                        }
                    )
                    .subscribe();
                pollIntervalId = window.setInterval(() => {
                    void pollActiveHandlerFromDb();
                }, pollMs);
                void pollActiveHandlerFromDb();
            });

        return () => {
            cancelled = true;
            if (activeHandlerLeadRealtimeTimerRef.current) {
                clearTimeout(activeHandlerLeadRealtimeTimerRef.current);
                activeHandlerLeadRealtimeTimerRef.current = null;
            }
            if (pollIntervalId != null) {
                window.clearInterval(pollIntervalId);
                pollIntervalId = null;
            }
            if (channel) {
                void supabase.removeChannel(channel);
                channel = null;
            }
        };
    }, [selectedClient?.id, selectedClient?.lead_type, refreshClientData]);

    /** Keep poll + realtime row match in sync when active_handler_type updates without remounting the channel. */
    useEffect(() => {
        const r = leadHandlerSyncRef.current;
        if (!r || String(r.idStr) !== String(selectedClient?.id ?? '')) return;
        r.activeType = Number((selectedClient as any)?.active_handler_type) === 1 ? 1 : 2;
    }, [selectedClient?.id, (selectedClient as any)?.active_handler_type]);

    useEffect(() => {
        selectedClientRef.current = selectedClient;
    }, [selectedClient]);

    useEffect(() => {
        let cancelled = false;
        const id = selectedClient?.id;
        if (id == null || id === '') {
            setUnpaidByCurrency(null);
            return;
        }
        (async () => {
            try {
                const map = await fetchUnpaidTotalsByCurrency(id, selectedClient?.lead_type);
                if (!cancelled) setUnpaidByCurrency(map);
            } catch {
                if (!cancelled) setUnpaidByCurrency(null);
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
                    const map = await fetchUnpaidTotalsByCurrency(selectedClient.id, selectedClient?.lead_type);
                    setUnpaidByCurrency(map);
                } catch {
                    setUnpaidByCurrency(null);
                }
            })();
        };
        window.addEventListener('paymentPlan:changed', handler as EventListener);
        return () => window.removeEventListener('paymentPlan:changed', handler as EventListener);
    }, [selectedClient?.id, selectedClient?.lead_type]);

    const { user, userFullName } = useAuthContext();
    const [publicUserId, setPublicUserId] = useState<string | null>(null);
    /** lead_field_key → metadata (own flags; RLS). */
    const [leadFieldFlagMeta, setLeadFieldFlagMeta] = useState<Map<string, ContentFlagMeta>>(() => new Map());
    const [flagTypes, setFlagTypes] = useState<FlagTypeRow[]>([]);
    const [tagsModalOpen, setTagsModalOpen] = useState(false);
    const [headerDocumentsModalOpen, setHeaderDocumentsModalOpen] = useState(false);
    const [headerSupabaseDocumentsCount, setHeaderSupabaseDocumentsCount] = useState<number>(0);
    const [leadTags, setLeadTags] = useState<string[]>([]);
    /** RMQ chat messages flagged to this lead (all users). */
    const [rmqMessageFlagCount, setRmqMessageFlagCount] = useState(0);

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
        }).then((map) => {
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
            if (!cancelled) setRmqMessageFlagCount(n);
        });
        return () => {
            cancelled = true;
        };
    }, [selectedClient?.id, selectedClient?.lead_type]);

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
        void (async () => {
            try {
                if (isLegacy) {
                    const legacyId = parseInt(rawId.replace(/^legacy_/, ''), 10);
                    if (!legacyId || Number.isNaN(legacyId)) {
                        if (!cancelled) setLeadTags([]);
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
                    if (!cancelled) setLeadTags(tags);
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
                        if (!cancelled) setLeadTags(tags);
                        return;
                    }
                }

                if (!cancelled) setLeadTags(normalizeTagsValue((selectedClient as any)?.tags));
            } catch {
                if (!cancelled) setLeadTags(normalizeTagsValue((selectedClient as any)?.tags));
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
     * Sub-efforts dropdown + inline log + SubEffortsLogModal for stages 60, 70, 100, 105, 110, 150 (and name equivalents).
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

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            // Only load when relevant to avoid extra DB calls
            if (!subEffortsStageFlags.loadSubEffortsCatalog) {
                return;
            }
            setIsLoadingSubEfforts(true);
            try {
                // Prefer filtering by `active` (admin-controlled). Fallback for environments where
                // the column hasn't been deployed yet.
                const withActive = await supabase
                    .from('sub_efforts')
                    .select('id, name, active')
                    .eq('active', true)
                    .order('name', { ascending: true });

                if (!withActive.error) {
                    if (!cancelled) {
                        setSubEfforts(
                            (withActive.data as any[])?.map(r => ({ id: Number(r.id), name: String(r.name) })) ?? []
                        );
                    }
                } else {
                    const err: any = withActive.error;
                    const msg = String(err?.message || '');
                    if (err?.code === '42703' && msg.toLowerCase().includes('active')) {
                        const fallback = await supabase
                            .from('sub_efforts')
                            .select('id, name')
                            .order('name', { ascending: true });
                        if (fallback.error) throw fallback.error;
                        if (!cancelled) {
                            setSubEfforts((fallback.data as any[])?.map(r => ({ id: Number(r.id), name: String(r.name) })) ?? []);
                        }
                    } else {
                        throw withActive.error;
                    }
                }
            } catch (e) {
                console.error('Error loading sub_efforts:', e);
                if (!cancelled) setSubEfforts([
                    { id: 1, name: 'Aplication submitted' },
                    { id: 2, name: 'Communication with client' },
                ]);
            } finally {
                if (!cancelled) setIsLoadingSubEfforts(false);
            }
        };
        void load();
        return () => { cancelled = true; };
    }, [subEffortsStageFlags.loadSubEffortsCatalog]);

    const fetchLeadSubEfforts = useCallback(async () => {
        if (!selectedClient?.id) return;
        if (!subEffortsStageFlags.fetchLeadSubEffortRows) return;

        const idStr = String(selectedClient.id);
        const isLegacy = idStr.startsWith('legacy_') || selectedClient.lead_type === 'legacy';
        const legacyId = isLegacy ? Number.parseInt(idStr.replace('legacy_', ''), 10) : null;
        const newLeadId = !isLegacy ? idStr : null;

        setIsLoadingLeadSubEfforts(true);
        try {
            let q = supabase
                .from('lead_sub_efforts')
                .select(`
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
                    document_url,
                    internal_notes,
                    client_notes,
                    sub_efforts ( id, name ),
                    tenants_employee ( id, display_name, photo_url, photo )
                `)
                .order('created_at', { ascending: false })
                .limit(25);

            if (isLegacy && legacyId) {
                q = q.eq('legacy_lead_id', legacyId);
            } else if (newLeadId) {
                q = q.eq('new_lead_id', newLeadId);
            }

            const { data, error } = await q;
            if (error) throw error;
            setLeadSubEfforts((data as any[]) ?? []);
        } catch (e) {
            console.error('Error fetching lead_sub_efforts:', e);
        } finally {
            setIsLoadingLeadSubEfforts(false);
        }
    }, [selectedClient?.id, selectedClient?.lead_type, subEffortsStageFlags.fetchLeadSubEffortRows]);

    useEffect(() => {
        void fetchLeadSubEfforts();
    }, [fetchLeadSubEfforts]);

    const handleSelectSubEffort = useCallback(
        async (opt: { id: number; name: string }) => {
            if (!selectedClient?.id) return;
            if (isSavingSubEffort) return;
            setIsSavingSubEffort(true);
            try {
                // Prevent duplicates (same sub_effort only once per lead)
                const alreadyUsed = leadSubEfforts?.some((r: any) => {
                    const isActive = (r as any)?.active !== false;
                    const id = Number((r as any)?.sub_effort_id ?? (r as any)?.sub_efforts?.id);
                    return isActive && Number.isFinite(id) && id === Number(opt.id);
                });
                if (alreadyUsed) {
                    toast.error('This sub effort was already added for this lead.');
                    return;
                }

                const actor = await fetchStageActorInfo();
                const idStr = String(selectedClient.id);
                const isLegacy = idStr.startsWith('legacy_') || selectedClient.lead_type === 'legacy';
                const legacyId = isLegacy ? Number.parseInt(idStr.replace('legacy_', ''), 10) : null;
                const newLeadId = !isLegacy ? idStr : null;

                const payload: any = {
                    sub_effort_id: opt.id,
                    employee_id: actor.employeeId ?? null,
                    created_by: actor.fullName ?? null,
                    updated_by: actor.fullName ?? null,
                    internal: false,
                    active: true,
                };
                if (legacyId) payload.legacy_lead_id = legacyId;
                if (newLeadId) payload.new_lead_id = newLeadId;

                const { error } = await supabase.from('lead_sub_efforts').insert(payload);
                if (error) throw error;

                toast.success(`Sub effort added: ${opt.name}`);
                await fetchLeadSubEfforts();
            } catch (e: any) {
                console.error('Error creating lead_sub_efforts row:', e);
                toast.error(`Failed to add sub effort: ${e?.message || 'Unknown error'}`);
            } finally {
                setIsSavingSubEffort(false);
            }
        },
        [selectedClient?.id, selectedClient?.lead_type, isSavingSubEffort, fetchLeadSubEfforts, leadSubEfforts]
    );

    const openSubEffortsModal = useCallback((rowId?: string | number | null) => {
        setSubEffortsModalRowId(rowId ?? null);
        setIsSubEffortsModalOpen(true);
    }, []);

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
    const [allCategories, setAllCategories] = useState<any[]>([]);
    const [isLoadingCategories, setIsLoadingCategories] = useState(false);
    const [showLanguageModal, setShowLanguageModal] = useState(false);
    const [languageInputValue, setLanguageInputValue] = useState('');
    const [showLanguageDropdown, setShowLanguageDropdown] = useState(false);
    const [allLanguages, setAllLanguages] = useState<Array<{ id: number | string; name: string }>>([]);
    const [savingLanguage, setSavingLanguage] = useState(false);
    const [showTopicModal, setShowTopicModal] = useState(false);
    const [topicInputValue, setTopicInputValue] = useState('');
    const [savingTopic, setSavingTopic] = useState(false);
    const [allSources, setAllSources] = useState<Array<{ id: number | string, name: string }>>([]);
    const [allCurrencies, setAllCurrencies] = useState<Array<{ id: number | string, name: string, iso_code: string | null }>>([]);
    const [showStageDropdown, setShowStageDropdown] = useState(false);
    const [isCallModalOpen, setIsCallModalOpen] = useState(false);
    const [callPhoneNumber, setCallPhoneNumber] = useState('');
    const [callContactName, setCallContactName] = useState('');

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
                    cachedLeadSourcesPromise = (async () => {
                        const { data, error } = await supabase
                            .from('misc_leadsource')
                            .select('id, name')
                            .eq('active', true)
                            .order('order', { ascending: true, nullsFirst: false });
                        if (error) throw error;
                        return data || [];
                    })();
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

    // Fetch categories
    useEffect(() => {
        const fetchCategories = async () => {
            try {
                setIsLoadingCategories(true);
                if (cachedCategories) {
                    setAllCategories(cachedCategories);
                    return;
                }
                if (!cachedCategoriesPromise) {
                    cachedCategoriesPromise = (async () => {
                        const { data, error } = await supabase
                            .from('misc_category')
                            .select(`
            id,
            name,
            misc_maincategory ( id, name )
          `)
                            .order('name');

                        if (error) throw error;
                        return data || [];
                    })();
                }
                const rows = await cachedCategoriesPromise;
                cachedCategories = rows;
                setAllCategories(rows);
            } catch (error) {
                console.error('Error fetching categories:', error);
            } finally {
                setIsLoadingCategories(false);
            }
        };
        fetchCategories();
    }, []);

    // Fetch languages (misc_language) — same list as Edit Lead / legacy language_id resolution
    useEffect(() => {
        const fetchLanguages = async () => {
            try {
                if (cachedLanguages) {
                    setAllLanguages(cachedLanguages);
                    return;
                }
                if (!cachedLanguagesPromise) {
                    cachedLanguagesPromise = (async () => {
                        const { data, error } = await supabase
                            .from('misc_language')
                            .select('id, name')
                            .order('name', { ascending: true });
                        if (error) throw error;
                        return (data || []).filter((row: any) => row?.name);
                    })();
                }
                const rows = await cachedLanguagesPromise;
                cachedLanguages = rows;
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

    /** Always opens Call Options modal (direct / OneCom) — same as previous phone-tap behavior for supported regions, now for all numbers */
    const handleCallPrimaryPhone = useCallback(() => {
        if (!displayPhone) return;
        setCallPhoneNumber(displayPhone);
        setCallContactName(selectedClient?.name || '');
        setIsCallModalOpen(true);
    }, [displayPhone, selectedClient?.name]);

    const handleHeaderWhatsAppClick = useCallback(async () => {
        if (!onOpenWhatsAppForContact) return;
        if (!displayPhone || displayPhone === '---') {
            toast.error('No phone number');
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
            const target = norm(displayPhone);
            const matched: ContactInfo | undefined =
                contacts.find(
                    (c) => norm(c.phone || '') === target || norm(c.mobile || '') === target
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
                    phone: displayPhone.trim(),
                    email: displayEmail ?? null,
                    lead_number: selectedClient?.lead_number,
                });
            }
        } catch (e) {
            console.error(e);
            toast.error('Could not open WhatsApp');
        }
    }, [onOpenWhatsAppForContact, displayPhone, displayEmail, selectedClient]);

    // Helper function to get category display name with main category
    const getCategoryDisplayName = (categoryId: number | string | null | undefined, fallbackCategory?: string): string => {
        if (!categoryId) {
            return fallbackCategory || 'No Category';
        }

        const category = allCategories.find((cat: any) => {
            const catId = typeof cat.id === 'bigint' ? Number(cat.id) : cat.id;
            const searchId = typeof categoryId === 'string' ? parseInt(categoryId, 10) : categoryId;
            return catId === searchId || Number(catId) === Number(searchId);
        });

        if (category) {
            if (category.misc_maincategory?.name) {
                return `${category.name} (${category.misc_maincategory.name})`;
            } else {
                return category.name;
            }
        }

        return fallbackCategory || 'No Category';
    };

    // Get the full category display name (subcategory + main category)
    const displayCategory = getCategoryDisplayName(selectedClient?.category_id, selectedClient?.category);

    const filteredCategories = allCategories.filter((category) => {
        const categoryName = category.misc_maincategory?.name
            ? `${category.name} (${category.misc_maincategory.name})`
            : category.name;
        // Safely handle categoryInputValue being potentially undefined
        return categoryName.toLowerCase().includes((categoryInputValue || '').toLowerCase());
    });

    const displayLanguageChip =
        selectedClient?.language && String(selectedClient.language).trim() !== ''
            ? String(selectedClient.language).trim()
            : '---';

    const displayTopicChip =
        selectedClient?.topic && String(selectedClient.topic).trim() !== ''
            ? String(selectedClient.topic).trim()
            : '---';

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

    // Helper function to get source display name from misc_leadsource
    const getSourceDisplayName = (sourceId: string | number | null | undefined, fallbackSource?: string) => {
        if (!sourceId || sourceId === '---' || sourceId === '' || sourceId === null || sourceId === undefined) {
            return fallbackSource || '';
        }

        // Convert sourceId to string/number for comparison (handle bigint)
        const sourceIdStr = String(sourceId).trim();
        if (sourceIdStr === '' || sourceIdStr === 'null' || sourceIdStr === 'undefined') {
            return fallbackSource || '';
        }

        // Find source in loaded sources - compare as numbers or strings
        const source = allSources.find((src: any) => {
            const srcId = String(src.id).trim();
            const searchId = sourceIdStr;
            return srcId === searchId || Number(srcId) === Number(searchId);
        });

        if (source) {
            return source.name;
        }

        // Fallback to the source name if source_id not found
        return fallbackSource || '';
    };

    // Helper function to get currency name from accounting_currencies table
    // Always uses accounting_currencies.name column, never hardcoded values
    const getCurrencyName = (currencyId: string | number | null | undefined, accountingCurrencies?: any): string => {
        // Default to currency_id 1 if not set
        const finalCurrencyId = currencyId ?? 1;

        // First, try to use accounting_currencies join data if provided
        if (accountingCurrencies) {
            const currencyRecord = Array.isArray(accountingCurrencies) ? accountingCurrencies[0] : accountingCurrencies;
            if (currencyRecord?.name && currencyRecord.name.trim() !== '') {
                return currencyRecord.name.trim();
            }
        }

        // If currencies haven't loaded yet, return empty string (will be handled by fallback)
        if (!allCurrencies || allCurrencies.length === 0) {
            return '';
        }

        // Convert currencyId to number for comparison (handle bigint)
        const currencyIdNum = typeof finalCurrencyId === 'string' ? parseInt(finalCurrencyId, 10) : Number(finalCurrencyId);
        if (isNaN(currencyIdNum)) {
            // If invalid, try to get currency_id 1
            const defaultCurrency = allCurrencies.find((curr: any) => {
                if (!curr || !curr.id) return false;
                const currId = typeof curr.id === 'bigint' ? Number(curr.id) : curr.id;
                const currIdNum = typeof currId === 'string' ? parseInt(currId, 10) : Number(currId);
                return !isNaN(currIdNum) && currIdNum === 1;
            });
            if (defaultCurrency && defaultCurrency.name && defaultCurrency.name.trim() !== '') {
                return defaultCurrency.name.trim();
            }
            return '';
        }

        // Find currency in loaded currencies - compare as numbers
        const currency = allCurrencies.find((curr: any) => {
            if (!curr || !curr.id) return false;
            const currId = typeof curr.id === 'bigint' ? Number(curr.id) : curr.id;
            const currIdNum = typeof currId === 'string' ? parseInt(currId, 10) : Number(currId);
            return !isNaN(currIdNum) && currIdNum === currencyIdNum;
        });

        if (currency && currency.name && currency.name.trim() !== '') {
            return currency.name.trim();
        }

        // Fallback: try to get currency_id 1
        const defaultCurrency = allCurrencies.find((curr: any) => {
            if (!curr || !curr.id) return false;
            const currId = typeof curr.id === 'bigint' ? Number(curr.id) : curr.id;
            const currIdNum = typeof currId === 'string' ? parseInt(currId, 10) : Number(currId);
            return !isNaN(currIdNum) && currIdNum === 1;
        });

        if (defaultCurrency && defaultCurrency.name && defaultCurrency.name.trim() !== '') {
            return defaultCurrency.name.trim();
        }

        // Ultimate fallback: return empty string (should not happen if currencies are loaded)
        return '';
    };

    // Lead Number
    const renderLeadNumber = () => {
        if (!selectedClient) return '---';
        // Linked-only subleads (linked_master_lead): show actual lead number only, no "/" or suffix, no "legacy_" prefix
        const hasLinkedMasterLead = selectedClient.linked_master_lead != null && (typeof selectedClient.linked_master_lead === 'number' || (typeof selectedClient.linked_master_lead === 'string' && String(selectedClient.linked_master_lead).trim() !== ''));
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
    const blurDropdown = () => (document.activeElement as HTMLElement | null)?.blur();

    const moreActionsMenuUlClass =
        'dropdown-content z-[250] menu p-2 shadow-2xl bg-base-100 rounded-box w-72 mb-2 border border-base-200 mt-2';

    const moreActionsMenuItems = (
        <>
            {!hideHistoryAndTimeline && (
                <>
                    <li>
                        <a
                            onClick={() => {
                                handleTimelineClick();
                                blurDropdown();
                            }}
                        >
                            <ClockIcon className="h-4 w-4" /> Timeline
                        </a>
                    </li>
                    <li>
                        <a
                            onClick={() => {
                                handleHistoryClick();
                                blurDropdown();
                            }}
                        >
                            <ArchiveBoxIcon className="h-4 w-4" /> History
                        </a>
                    </li>
                    <div className="divider my-1" />
                </>
            )}
            {duplicateContacts && duplicateContacts.length > 0 && !hideActionsDropdown && (
                <>
                    <li>
                        <a
                            className="text-amber-800"
                            onClick={() => {
                                setIsDuplicateModalOpen(true);
                                blurDropdown();
                            }}
                        >
                            <DocumentDuplicateIcon className="h-4 w-4" />
                            Duplicate contacts ({duplicateContacts.length})
                        </a>
                    </li>
                    <div className="divider my-1" />
                </>
            )}
            {!hideActionsDropdown && (
                <>
                    {dropdownItems && (
                        <>
                            {dropdownItems}
                            <div className="divider my-1" />
                        </>
                    )}
                    {(() => {
                        const isLegacy = selectedClient?.lead_type === 'legacy' || selectedClient?.id?.toString().startsWith('legacy_');
                        const isUnactivated = isLegacy ? selectedClient?.status === 10 : selectedClient?.status === 'inactive';
                        return isUnactivated ? (
                            <li>
                                <a className="font-medium text-green-600" onClick={() => { handleActivation(); blurDropdown(); }}>
                                    <CheckCircleIcon className="h-4 w-4" /> Activate Case
                                </a>
                            </li>
                        ) : (
                            <li>
                                <a className="font-medium text-red-600" onClick={() => { setShowUnactivationModal(true); blurDropdown(); }}>
                                    <NoSymbolIcon className="h-4 w-4" /> Deactivate / Spam
                                </a>
                            </li>
                        );
                    })()}
                    <li>
                        <a
                            onClick={async () => {
                                if (!selectedClient?.id) return;
                                const isLegacyLead = selectedClient.lead_type === 'legacy' || selectedClient.id?.toString().startsWith('legacy_');
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
                                blurDropdown();
                            }}
                        >
                            {isInHighlightsState ? (
                                <>
                                    <StarIcon className="h-4 w-4 fill-current text-purple-600" /> Remove from Highlights
                                </>
                            ) : (
                                <>
                                    <StarIcon className="h-4 w-4" /> Add to Highlights
                                </>
                            )}
                        </a>
                    </li>
                    <div className="divider my-1" />
                    <li>
                        <a
                            onClick={() => {
                                openEditLeadDrawer();
                                blurDropdown();
                            }}
                        >
                            <PencilSquareIcon className="h-4 w-4" /> Edit Details
                        </a>
                    </li>
                    <li>
                        <a
                            onClick={() => {
                                setShowSubLeadDrawer(true);
                                blurDropdown();
                            }}
                        >
                            <Squares2X2Icon className="h-4 w-4" /> Create Sub-Lead
                        </a>
                    </li>
                    {onCombineLeads && (
                        <li>
                            <a
                                onClick={() => {
                                    onCombineLeads();
                                    blurDropdown();
                                }}
                            >
                                <LinkIcon className="h-4 w-4" /> Combine leads
                            </a>
                        </li>
                    )}
                    {isSuperuser && (
                        <>
                            <div className="divider my-1" />
                            <li>
                                <a
                                    className="text-red-600 hover:bg-red-50"
                                    onClick={() => {
                                        setShowDeleteModal(true);
                                        blurDropdown();
                                    }}
                                >
                                    <TrashIcon className="h-4 w-4" /> Delete Lead
                                </a>
                            </li>
                        </>
                    )}
                </>
            )}
        </>
    );

    const renderMoreActionsDropdown = (triggerClassName: string) => (
        <div className="dropdown dropdown-end">
            <label tabIndex={0} className={triggerClassName} aria-label="More actions">
                <EllipsisHorizontalIcon className="h-6 w-6" />
            </label>
            <ul tabIndex={0} className={moreActionsMenuUlClass}>
                {moreActionsMenuItems}
            </ul>
        </div>
    );

    const renderCompactHistoryIconRow = () => {
        const dup = duplicateContacts && duplicateContacts.length > 0;
        if (hideHistoryAndTimeline && !dup) return null;
        return (
            <div className="flex flex-wrap items-center justify-end gap-1">
                {headerDocsLeadNumber ? (
                    <button
                        type="button"
                        onClick={openHeaderDocumentsModal}
                        className="btn btn-ghost btn-sm relative h-auto min-h-0 p-1.5 text-gray-600 hover:bg-base-200 hover:text-gray-900"
                        title="Case documents on OneDrive"
                        aria-label="Case documents"
                    >
                        <DocumentArrowUpIcon className="h-6 w-6" />
                        {headerSupabaseDocumentsCount > 0 && (
                            <span
                                className="absolute -right-1 -top-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1 text-[11px] font-bold text-white"
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
                            className="btn btn-ghost btn-sm relative h-auto min-h-0 p-1.5 text-purple-700 hover:bg-purple-50 dark:text-purple-200 dark:hover:bg-purple-900/30"
                            title="Tags"
                            aria-label="Tags"
                        >
                            <TagIcon className="h-5 w-5" />
                            {tagsCount > 0 && (
                                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-purple-600 px-0.5 text-[10px] font-bold text-white">
                                    {tagsCount > 99 ? '99+' : tagsCount}
                                </span>
                            )}
                        </button>
                        <button
                            type="button"
                            onClick={openFlaggedConversationsModal}
                            disabled={!publicUserId}
                            className="btn btn-ghost btn-sm relative h-auto min-h-0 p-1.5 text-amber-700 hover:bg-amber-50 disabled:pointer-events-none disabled:opacity-40 dark:text-amber-300 dark:hover:bg-amber-900/30"
                            title={publicUserId ? 'Flagged items on this lead' : 'Sign in to use flags'}
                            aria-label="Flagged items"
                        >
                            <FlagIcon className="h-5 w-5" />
                            {totalFlagBadge > 0 && (
                                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-amber-500 px-0.5 text-[10px] font-bold text-white">
                                    {totalFlagBadge > 99 ? '99+' : totalFlagBadge}
                                </span>
                            )}
                        </button>
                        <button
                            type="button"
                            onClick={handleHistoryClick}
                            className="btn btn-ghost btn-sm h-auto min-h-0 p-1.5 text-gray-600 hover:bg-base-200 hover:text-gray-900"
                            title="View History"
                            aria-label="View History"
                        >
                            <ArchiveBoxIcon className="h-5 w-5" />
                        </button>
                    </>
                )}
                {dup && (
                    <button
                        type="button"
                        onClick={() => setIsDuplicateModalOpen(true)}
                        className="btn btn-circle btn-warning btn-sm"
                        title={
                            duplicateContacts.length === 1
                                ? `Duplicate Contact: ${duplicateContacts[0].contactName} in Lead ${duplicateContacts[0].leadNumber}`
                                : `${duplicateContacts.length} Duplicate Contacts`
                        }
                        aria-label="Duplicate contacts"
                    >
                        <DocumentDuplicateIcon className="w-5 h-5" />
                    </button>
                )}
            </div>
        );
    };

    const stageAdjacentTagsFlags =
        !hideHistoryAndTimeline ? (
            <div className="flex shrink-0 items-center gap-1">
                <button
                    type="button"
                    onClick={() => setTagsModalOpen(true)}
                    className="btn btn-ghost btn-sm relative h-auto min-h-0 p-2 text-purple-700 hover:bg-purple-50 dark:text-purple-200 dark:hover:bg-purple-900/30 md:p-1.5"
                    title="Tags"
                    aria-label="Tags"
                >
                    <TagIcon className="h-6 w-6 md:h-7 md:w-7" />
                    {tagsCount > 0 && (
                        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-purple-600 px-0.5 text-[10px] font-bold text-white">
                            {tagsCount > 99 ? '99+' : tagsCount}
                        </span>
                    )}
                </button>
                <button
                    type="button"
                    onClick={openFlaggedConversationsModal}
                    disabled={!publicUserId}
                    className="btn btn-ghost btn-sm relative h-auto min-h-0 p-2 text-amber-700 hover:bg-amber-50 disabled:pointer-events-none disabled:opacity-40 dark:text-amber-300 dark:hover:bg-amber-900/30 md:p-1.5"
                    title={publicUserId ? 'Flagged items on this lead' : 'Sign in to use flags'}
                    aria-label="Flagged items"
                >
                    <FlagIcon className="h-6 w-6 md:h-7 md:w-7" />
                    {totalFlagBadge > 0 && (
                        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-amber-500 px-0.5 text-[10px] font-bold text-white">
                            {totalFlagBadge > 99 ? '99+' : totalFlagBadge}
                        </span>
                    )}
                </button>
            </div>
        ) : null;

    return (
        <div className="bg-transparent">
            <div className="w-full px-4 sm:px-6 lg:px-8 py-4 space-y-5 md:space-y-5 md:py-5">

                {/* Top Row: Identity & Status */}
                <div className="mb-0 flex flex-col gap-5 md:mb-0 md:gap-4">
                    {/* Mobile: SaaS header — identity, contact card, stage + chips */}
                    <div className="flex w-full flex-col gap-5 md:hidden">
                        <header className="relative z-0 flex w-full min-w-0 flex-col gap-0">
                            <div className="flex w-full min-w-0 items-start justify-between gap-3">
                                <div className="min-w-0 flex-1 pr-1 text-left">
                                    <p className="font-mono text-xs font-medium tabular-nums text-base-content/50">
                                        {renderLeadNumber()}
                                    </p>
                                </div>
                                <div className="flex shrink-0 flex-col items-end gap-2 self-start pt-0.5">
                                    {stageAdjacentTagsFlags}
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
                                            className="btn btn-square btn-sm btn-ghost relative shrink-0 border-0 text-gray-700 hover:bg-base-200 hover:text-gray-900"
                                            title={isSubLead ? `View master` : `View ${subLeadsCount} sub-leads`}
                                        >
                                            <Squares2X2Icon className="h-6 w-6" />
                                            <span
                                                className="absolute -right-1 -top-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1 text-xs font-bold text-white"
                                                style={{ backgroundColor: '#3a3a3a' }}
                                            >
                                                {(subLeadsCount || 0) + 1}
                                            </span>
                                        </button>
                                    ) : null}
                                </div>
                            </div>
                            <div className="mt-3 flex w-full min-w-0 items-center justify-between gap-3">
                                <h1 className="min-w-0 flex-1 text-left text-2xl font-semibold leading-[1.2] tracking-tight text-gray-900 dark:text-white">
                                    {selectedClient.name || 'Unnamed Lead'}
                                </h1>
                                <div className="flex shrink-0 items-center justify-end">{renderStageBadge('mobile')}</div>
                            </div>
                        </header>

                        <div className="rounded-2xl border border-base-200/90 bg-base-100 px-4 py-5 shadow-sm dark:border-base-300/55 dark:bg-base-200/20 dark:shadow-none">
                            <div className="flex flex-col gap-4">
                                <div className="flex min-w-0 items-center gap-3">
                                    {displayEmail ? (
                                        <button
                                            type="button"
                                            className="btn btn-ghost btn-sm h-auto min-h-0 shrink-0 p-2 text-gray-500 hover:bg-base-200 hover:text-gray-900 dark:text-gray-400"
                                            title="Copy email"
                                            aria-label="Copy email"
                                            onClick={() => {
                                                void navigator.clipboard.writeText(displayEmail).then(() => toast.success('Email copied'));
                                            }}
                                        >
                                            <ClipboardDocumentIcon className="h-5 w-5" />
                                        </button>
                                    ) : null}
                                    <p
                                        className="min-w-0 flex-1 text-[15px] font-medium leading-snug text-gray-900 dark:text-gray-100"
                                        title={displayEmail || ''}
                                    >
                                        {displayEmail || '—'}
                                    </p>
                                </div>
                                <div className="flex min-w-0 items-center gap-3">
                                    {displayPhone ? (
                                        <button
                                            type="button"
                                            className="btn btn-ghost btn-sm h-auto min-h-0 shrink-0 p-2 text-gray-500 hover:bg-base-200 hover:text-gray-900 dark:text-gray-400"
                                            title="Copy phone number"
                                            aria-label="Copy phone number"
                                            onClick={() => {
                                                void navigator.clipboard.writeText(displayPhone).then(() => toast.success('Phone copied'));
                                            }}
                                        >
                                            <ClipboardDocumentIcon className="h-5 w-5" />
                                        </button>
                                    ) : null}
                                    <p
                                        className="min-w-0 flex-1 text-[15px] font-medium leading-snug text-gray-900 dark:text-gray-100"
                                        title={displayPhone ? formatPhoneNumberDisplay(displayPhone) : ''}
                                    >
                                        {displayPhone ? formatPhoneNumberDisplay(displayPhone) : '—'}
                                    </p>
                                </div>
                                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-base-200/80 pt-4 dark:border-base-300/45">
                                    <div className="flex flex-wrap items-center gap-3">
                                        {displayPhone ? (
                                            <button
                                                type="button"
                                                className="btn btn-square min-h-[3rem] min-w-[3rem] rounded-full border-0 bg-gray-100 p-0 text-gray-700 hover:bg-gray-200 dark:bg-gray-700/40 dark:text-gray-100 dark:hover:bg-gray-700/60"
                                                title="Call"
                                                aria-label="Call"
                                                onClick={handleCallPrimaryPhone}
                                            >
                                                <PhoneArrowUpRightIcon className="h-6 w-6" aria-hidden />
                                            </button>
                                        ) : null}
                                        {onOpenWhatsAppForContact && displayPhone ? (
                                            <button
                                                type="button"
                                                className="btn btn-square min-h-[3rem] min-w-[3rem] rounded-full border-0 bg-emerald-50 p-0 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-200 dark:hover:bg-emerald-900/45"
                                                title="WhatsApp"
                                                aria-label="WhatsApp"
                                                onClick={() => void handleHeaderWhatsAppClick()}
                                            >
                                                <FaWhatsapp className="h-6 w-6" aria-hidden />
                                            </button>
                                        ) : null}
                                        {displayEmail ? (
                                            <button
                                                type="button"
                                                className="btn btn-square min-h-[3rem] min-w-[3rem] rounded-full border-0 bg-sky-50 p-0 text-sky-800 hover:bg-sky-100 dark:bg-sky-900/25 dark:text-sky-200 dark:hover:bg-sky-900/40"
                                                title="Email"
                                                aria-label="Email"
                                                onClick={() => window.open(`mailto:${displayEmail}`, '_blank')}
                                            >
                                                <EnvelopeIcon className="h-6 w-6" aria-hidden />
                                            </button>
                                        ) : null}
                                    </div>
                                    <div className="flex shrink-0 items-center gap-2">
                                        {!hideActionsDropdown && (
                                            <>
                                                <button
                                                    type="button"
                                                    onClick={openHeaderDocumentsModal}
                                                    disabled={!headerDocsLeadNumber}
                                                    className="btn btn-square relative rounded-full border-2 border-base-300 btn-ghost min-h-[3.25rem] min-w-[3.25rem] disabled:pointer-events-none disabled:opacity-40"
                                                    title={
                                                        headerDocsLeadNumber
                                                            ? 'Case documents on OneDrive'
                                                            : 'Lead number required'
                                                    }
                                                    aria-label="Case documents"
                                                >
                                                    <DocumentArrowUpIcon className="h-6 w-6" aria-hidden />
                                                    {headerSupabaseDocumentsCount > 0 && (
                                                        <span
                                                            className="absolute -right-1 -top-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1 text-[11px] font-bold text-white"
                                                            style={{ backgroundColor: '#3a3a3a' }}
                                                        >
                                                            {headerSupabaseDocumentsCount > 99 ? '99+' : headerSupabaseDocumentsCount}
                                                        </span>
                                                    )}
                                                </button>
                                                {renderMoreActionsDropdown(
                                                    'btn btn-square rounded-full border-2 border-base-300 btn-ghost min-h-[3.25rem] min-w-[3.25rem]'
                                                )}
                                            </>
                                        )}
                                        {hideActionsDropdown ? renderCompactHistoryIconRow() : null}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="relative z-0 flex flex-col gap-4 pt-1">
                            <div className="flex flex-wrap justify-center gap-2.5 px-0.5">
                                <button
                                    type="button"
                                    className={`${META_CHIP_TOP} border-0 font-sans focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/50 ${
                                        disableCategoryModal
                                            ? 'cursor-default'
                                            : 'cursor-pointer hover:bg-gray-200/90 dark:hover:bg-gray-600'
                                    }`}
                                    onClick={disableCategoryModal ? undefined : () => openMetaModal('language')}
                                >
                                    <GlobeAltIcon className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
                                    <span className="truncate">{displayLanguageChip}</span>
                                </button>
                                <span className={META_CHIP_TOP}>
                                    <LinkIcon className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
                                    <span className="min-w-0 max-w-[14rem] truncate">
                                        {getSourceDisplayName(selectedClient.source_id, selectedClient.source) || '---'}
                                    </span>
                                </span>
                                {applicantsCount != null && Number(applicantsCount) > 0 && (
                                    <span className={META_CHIP} title="Applicants">
                                        <UserIcon className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
                                        {applicantsCount}
                                    </span>
                                )}
                                <button
                                    type="button"
                                    className={`${META_CHIP_TOP} border-0 font-sans focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/50 ${
                                        disableCategoryModal
                                            ? 'cursor-default'
                                            : 'cursor-pointer hover:bg-gray-200/90 dark:hover:bg-gray-600'
                                    }`}
                                    onClick={disableCategoryModal ? undefined : () => openMetaModal('category')}
                                >
                                    <RectangleStackIcon className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
                                    <span className="min-w-0 max-w-[14rem] truncate">{displayCategory}</span>
                                </button>
                                <button
                                    type="button"
                                    className={`${META_CHIP_TOP} border-0 font-sans focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/50 ${
                                        disableCategoryModal
                                            ? 'cursor-default'
                                            : 'cursor-pointer hover:bg-gray-200/90 dark:hover:bg-gray-600'
                                    }`}
                                    onClick={disableCategoryModal ? undefined : () => openMetaModal('topic')}
                                >
                                    <DocumentTextIcon className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
                                    <span className="min-w-0 max-w-[14rem] truncate">{displayTopicChip}</span>
                                </button>
                            </div>

                        </div>

                        {!hideTotalValueBadge && (
                            <div className="w-full border-t border-gray-100 pb-8 pt-4 dark:border-gray-800">
                            {(() => {
                            const isLegacyLead = selectedClient?.id?.toString().startsWith('legacy_');
                            let currency = '';
                            const accountingCurrencies = (selectedClient as any)?.accounting_currencies;
                            if (accountingCurrencies) {
                                const currencyRecord = Array.isArray(accountingCurrencies) ? accountingCurrencies[0] : accountingCurrencies;
                                if (currencyRecord?.name && currencyRecord.name.trim() !== '') {
                                    currency = currencyRecord.name.trim();
                                }
                            }
                            if (!isLegacyLead) {
                                const currencyId = (selectedClient as any)?.currency_id ?? 1;
                                const numericCurrencyId = typeof currencyId === 'string' ? parseInt(currencyId, 10) : Number(currencyId);
                                if (!isNaN(numericCurrencyId) && numericCurrencyId > 0) {
                                    currency = getCurrencyName(numericCurrencyId, accountingCurrencies);
                                    if (!currency || currency.trim() === '') currency = getCurrencyName(1);
                                } else {
                                    currency = getCurrencyName(1);
                                }
                            } else {
                                if (!currency && selectedClient?.currency_id) {
                                    const currencyFromId = getCurrencyName(selectedClient.currency_id, accountingCurrencies);
                                    if (currencyFromId && currencyFromId.trim() !== '') currency = currencyFromId;
                                }
                                if (!currency || currency.trim() === '') currency = selectedClient?.balance_currency || '';
                                if (!currency || currency.trim() === '') currency = getCurrencyName(1);
                            }
                            let baseAmount: number;
                            if (isLegacyLead) {
                                const currencyId = (selectedClient as any)?.currency_id;
                                let numericCurrencyId = typeof currencyId === 'string' ? parseInt(currencyId, 10) : Number(currencyId);
                                if (!numericCurrencyId || isNaN(numericCurrencyId)) numericCurrencyId = 1;
                                baseAmount = numericCurrencyId === 1
                                    ? Number((selectedClient as any)?.total_base ?? 0)
                                    : Number((selectedClient as any)?.total ?? 0);
                            } else {
                                baseAmount = Number(selectedClient?.balance || selectedClient?.proposal_total || 0);
                            }

                            if (hasPaymentPlan) {
                                if (paymentPlanBaseTotal !== null) baseAmount = Number(paymentPlanBaseTotal) || 0;
                            }
                            const subcontractorFee = Number(selectedClient?.subcontractor_fee ?? 0);
                            // Primary figure = full lead total (ex VAT in DB); subcontractor is shown + net below
                            const mainAmount = baseAmount;
                            const netAfterSubcontractor =
                                subcontractorFee > 0 ? baseAmount - subcontractorFee : null;
                            const potentialAmount = isLegacyLead
                                ? Number((selectedClient as any)?.potential_total ?? 0) || 0
                                : Number(
                                      (selectedClient as any)?.potential_value ??
                                          (selectedClient as any)?.potential_total ??
                                          0
                                  ) || 0;
                            /** Not the same as meeting applicants — uses potential_applicants_meeting / potential_applicants */
                            const potentialApplicantsMeeting = isLegacyLead
                                ? Number(
                                      (selectedClient as any)?.potential_applicants_meeting ??
                                          (selectedClient as any)?.potential_applicants ??
                                          0
                                  ) || 0
                                : Number((selectedClient as any)?.potential_applicants_meeting ?? 0) || 0;
                            let vatAmount = 0;
                            let shouldShowVAT = false;
                            const vatValue = selectedClient?.vat;
                            if (isLegacyLead) {
                                shouldShowVAT = true;
                                if (vatValue !== null && vatValue !== undefined) {
                                    const vatStr = String(vatValue).toLowerCase().trim();
                                    if (vatStr === 'false' || vatStr === '0' || vatStr === 'no' || vatStr === 'excluded') shouldShowVAT = false;
                                }
                                if (hasPaymentPlan && paymentPlanVatTotal !== null) {
                                    vatAmount = Number(paymentPlanVatTotal) || 0;
                                    shouldShowVAT = vatAmount > 0;
                                } else if (!hasPaymentPlan && shouldShowVAT) {
                                    // When there's no payment plan, totals are treated as NET (same mental model as FinancesTab).
                                    const vatRate = getVatRateForLegacyLead((selectedClient as any)?.date_signed || (selectedClient as any)?.created_at || null);
                                    vatAmount = Math.round((baseAmount * vatRate) * 100) / 100;
                                } else if (shouldShowVAT) {
                                    // Legacy fallback: legacy totals may already be gross; avoid inventing VAT when missing.
                                    vatAmount = Number((selectedClient as any)?.vat_value ?? 0) || 0;
                                    if (!vatAmount) {
                                        shouldShowVAT = false;
                                    }
                                }
                            } else {
                                shouldShowVAT = true;
                                if (vatValue !== null && vatValue !== undefined) {
                                    const vatStr = String(vatValue).toLowerCase().trim();
                                    if (vatStr === 'false' || vatStr === '0' || vatStr === 'no' || vatStr === 'excluded') shouldShowVAT = false;
                                }
                                if (shouldShowVAT) {
                                    vatAmount =
                                        selectedClient?.vat_value && Number(selectedClient.vat_value) > 0
                                            ? Number(selectedClient.vat_value)
                                            : baseAmount * getVatRateForLegacyLead((selectedClient as any)?.date_signed || (selectedClient as any)?.created_at || null);
                                }
                            }
                            const unpaidOutstandingPair =
                                unpaidByCurrency === null
                                    ? null
                                    : pickUnpaidBaseAndVatForCurrency(unpaidByCurrency, currency);
                            const unpaidGross =
                                unpaidOutstandingPair != null
                                    ? unpaidOutstandingPair.base + unpaidOutstandingPair.vat
                                    : 0;
                            return (
                                <div className="group relative cursor-pointer text-right" onClick={() => setIsBalanceModalOpen(true)}>
                                    <div className="space-y-2">
                                        <p className="text-[10px] font-semibold uppercase tracking-wide text-base-content/40">Total</p>
                                        <div className="flex items-end justify-end gap-2">
                                            <p className="text-3xl font-bold leading-none tracking-tight text-gray-900 dark:text-white inline-flex items-center gap-2">
                                                <span>{currency}{Number(mainAmount.toFixed(2)).toLocaleString()}</span>
                                                {hasPaymentPlan && <LockClosedIcon className="h-4 w-4 text-gray-500 dark:text-gray-300" title="Locked by payment plan" />}
                                            </p>
                                            {shouldShowVAT && vatAmount > 0 && (
                                                <p className="pb-0.5 text-sm text-gray-600 dark:text-gray-400">
                                                    +{vatAmount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })} VAT
                                                </p>
                                            )}
                                        </div>
                                        {subcontractorFee > 0 && netAfterSubcontractor !== null && (
                                            <p className="text-[11px] text-base-content/50">
                                                Net {currency}
                                                {Number(netAfterSubcontractor.toFixed(2)).toLocaleString()}
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
                                        {unpaidOutstandingPair !== null && unpaidGross > 0 && (
                                            <div className="pt-2 border-t border-gray-200/80 dark:border-gray-600">
                                                <p className="text-[10px] font-semibold uppercase tracking-wide text-base-content/35">
                                                    Outstanding
                                                </p>
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
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })()}
                            </div>
                        )}
                    </div>

                    {/* Desktop: SaaS three-zone header */}
                    <div className="hidden md:grid md:grid-cols-[minmax(0,1.05fr)_minmax(0,1.5fr)_minmax(0,1fr)] md:items-start md:gap-6 lg:gap-8">
                        <div className="flex min-w-0 flex-col gap-1.5 justify-self-start text-left">
                            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                                <span className="text-sm font-medium tabular-nums text-gray-500 dark:text-gray-400">
                                    {renderLeadNumber()}
                                </span>
                                <h1 className="min-w-0 text-[1.375rem] font-semibold leading-snug tracking-tight text-gray-900 dark:text-white">
                                    {selectedClient.name || 'Unnamed Lead'}
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
                                        className="btn btn-square btn-sm btn-ghost relative shrink-0 border-0 text-gray-700 hover:bg-base-200 hover:text-gray-900"
                                        title={
                                            isSubLead
                                                ? `View master dashboard (${(subLeadsCount || 0) + 1} total leads)`
                                                : `View all ${subLeadsCount || 0} sub-lead${subLeadsCount !== 1 ? 's' : ''} and master lead (${(subLeadsCount || 0) + 1} total)`
                                        }
                                    >
                                        <Squares2X2Icon className="w-6 h-6" />
                                        <span
                                            className="absolute -top-1 -right-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1 text-xs font-bold text-white"
                                            style={{ backgroundColor: '#3a3a3a' }}
                                        >
                                            {(subLeadsCount || 0) + 1}
                                        </span>
                                    </button>
                                ) : null}
                            </div>
                            <div className="mt-3 flex w-full min-w-0 flex-col gap-3">
                                <div className="flex min-w-0 flex-wrap items-center gap-2">
                                    {displayEmail ? (
                                        <button
                                            type="button"
                                            className="btn btn-ghost btn-sm h-auto min-h-0 shrink-0 p-1.5 text-gray-600 hover:bg-base-200 hover:text-gray-900"
                                            title="Copy email"
                                            aria-label="Copy email"
                                            onClick={() => {
                                                void navigator.clipboard.writeText(displayEmail).then(() => toast.success('Email copied'));
                                            }}
                                        >
                                            <ClipboardDocumentIcon className="h-5 w-5" />
                                        </button>
                                    ) : null}
                                    <p
                                        className="min-w-0 flex-1 truncate text-sm font-medium leading-normal text-gray-900 dark:text-gray-100"
                                        title={displayEmail || ''}
                                    >
                                        {displayEmail || '—'}
                                    </p>
                                </div>
                                <div className="flex min-w-0 flex-wrap items-center gap-2">
                                    {displayPhone ? (
                                        <button
                                            type="button"
                                            className="btn btn-ghost btn-sm h-auto min-h-0 shrink-0 p-1.5 text-gray-600 hover:bg-base-200 hover:text-gray-900"
                                            title="Copy phone number"
                                            aria-label="Copy phone number"
                                            onClick={() => {
                                                void navigator.clipboard.writeText(displayPhone).then(() => toast.success('Phone copied'));
                                            }}
                                        >
                                            <ClipboardDocumentIcon className="h-5 w-5" />
                                        </button>
                                    ) : null}
                                    <p
                                        className="min-w-0 flex-1 truncate text-sm font-medium leading-normal text-gray-900 dark:text-gray-100"
                                        title={displayPhone ? formatPhoneNumberDisplay(displayPhone) : ''}
                                    >
                                        {displayPhone ? formatPhoneNumberDisplay(displayPhone) : '—'}
                                    </p>
                                </div>
                                <div className="flex min-w-0 flex-wrap items-center gap-3">
                                    {displayPhone ? (
                                        <button
                                            type="button"
                                            className="btn btn-square min-h-11 min-w-11 rounded-full border-0 bg-gray-100 p-0 text-gray-700 hover:bg-gray-200 dark:bg-gray-700/40 dark:text-gray-100 dark:hover:bg-gray-700/60"
                                            title="Call"
                                            aria-label="Call"
                                            onClick={handleCallPrimaryPhone}
                                        >
                                            <PhoneArrowUpRightIcon className="h-5 w-5" aria-hidden />
                                        </button>
                                    ) : null}
                                    {onOpenWhatsAppForContact && displayPhone ? (
                                        <button
                                            type="button"
                                            className="btn btn-square min-h-11 min-w-11 rounded-full border-0 bg-emerald-50 p-0 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-200 dark:hover:bg-emerald-900/45"
                                            title="WhatsApp"
                                            aria-label="WhatsApp"
                                            onClick={() => void handleHeaderWhatsAppClick()}
                                        >
                                            <FaWhatsapp className="h-5 w-5" aria-hidden />
                                        </button>
                                    ) : null}
                                    {displayEmail ? (
                                        <button
                                            type="button"
                                            className="btn btn-square min-h-11 min-w-11 rounded-full border-0 bg-sky-50 p-0 text-sky-800 hover:bg-sky-100 dark:bg-sky-900/25 dark:text-sky-200 dark:hover:bg-sky-900/40"
                                            title="Email"
                                            aria-label="Email"
                                            onClick={() => window.open(`mailto:${displayEmail}`, '_blank')}
                                        >
                                            <EnvelopeIcon className="h-5 w-5" aria-hidden />
                                        </button>
                                    ) : null}
                                </div>
                            </div>
                        </div>
                        {/* CENTER — stage + meta chips (language, source, applicants, category, topic) */}
                        <div className="flex min-h-0 min-w-0 flex-col items-center gap-3 px-2 pt-0.5">
                            <div className="flex w-full flex-wrap items-center justify-center gap-2">
                                <div className="flex shrink-0 justify-center">{renderStageBadge('desktop')}</div>
                                {stageAdjacentTagsFlags}
                            </div>
                            <div className="flex w-full max-w-xl flex-wrap items-center justify-center gap-2.5">
                                <button
                                    type="button"
                                    className={`${META_CHIP_TOP} border-0 font-sans focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/50 ${
                                        disableCategoryModal
                                            ? 'cursor-default'
                                            : 'cursor-pointer hover:bg-gray-200/90 dark:hover:bg-gray-600'
                                    }`}
                                    onClick={disableCategoryModal ? undefined : () => openMetaModal('language')}
                                >
                                    <GlobeAltIcon className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
                                    <span className="truncate">{displayLanguageChip}</span>
                                </button>
                                <span className={META_CHIP_TOP}>
                                    <LinkIcon className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
                                    <span className="min-w-0 max-w-[12rem] truncate lg:max-w-[16rem]">
                                        {getSourceDisplayName(selectedClient.source_id, selectedClient.source) || '---'}
                                    </span>
                                </span>
                                {applicantsCount != null && Number(applicantsCount) > 0 && (
                                    <span className={META_CHIP} title="Applicants">
                                        <UserIcon className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
                                        {applicantsCount}
                                    </span>
                                )}
                                <button
                                    type="button"
                                    className={`${META_CHIP_TOP} border-0 font-sans focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/50 ${
                                        disableCategoryModal
                                            ? 'cursor-default'
                                            : 'cursor-pointer hover:bg-gray-200/90 dark:hover:bg-gray-600'
                                    }`}
                                    onClick={disableCategoryModal ? undefined : () => openMetaModal('category')}
                                >
                                    <RectangleStackIcon className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
                                    <span className="min-w-0 max-w-[12rem] truncate lg:max-w-[16rem]">{displayCategory}</span>
                                </button>
                                <button
                                    type="button"
                                    className={`${META_CHIP_TOP} border-0 font-sans focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/50 ${
                                        disableCategoryModal
                                            ? 'cursor-default'
                                            : 'cursor-pointer hover:bg-gray-200/90 dark:hover:bg-gray-600'
                                    }`}
                                    onClick={disableCategoryModal ? undefined : () => openMetaModal('topic')}
                                >
                                    <DocumentTextIcon className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
                                    <span className="min-w-0 max-w-[12rem] truncate lg:max-w-[16rem]">{displayTopicChip}</span>
                                </button>
                            </div>

                        </div>

                        {/* RIGHT — total value + more actions */}
                        <div className="flex min-w-0 max-w-sm flex-col items-end gap-3 justify-self-end self-start">
                            {(() => {
                                if (hideTotalValueBadge) return null;
                                const isLegacyLead = selectedClient?.id?.toString().startsWith('legacy_');

                                let currency = '';
                                const accountingCurrencies = (selectedClient as any)?.accounting_currencies;
                                if (accountingCurrencies) {
                                    const currencyRecord = Array.isArray(accountingCurrencies) ? accountingCurrencies[0] : accountingCurrencies;
                                    if (currencyRecord?.name && currencyRecord.name.trim() !== '') {
                                        currency = currencyRecord.name.trim();
                                    }
                                }

                                if (!isLegacyLead) {
                                    const currencyId = (selectedClient as any)?.currency_id ?? 1;
                                    const numericCurrencyId = typeof currencyId === 'string' ? parseInt(currencyId, 10) : Number(currencyId);
                                    if (!isNaN(numericCurrencyId) && numericCurrencyId > 0) {
                                        currency = getCurrencyName(numericCurrencyId, accountingCurrencies);
                                        if (!currency || currency.trim() === '') {
                                            currency = getCurrencyName(1);
                                        }
                                    } else {
                                        currency = getCurrencyName(1);
                                    }
                                } else {
                                    if (!currency && selectedClient?.currency_id) {
                                        const currencyFromId = getCurrencyName(selectedClient.currency_id, accountingCurrencies);
                                        if (currencyFromId && currencyFromId.trim() !== '') {
                                            currency = currencyFromId;
                                        }
                                    }
                                    if (!currency || currency.trim() === '') {
                                        currency = selectedClient?.balance_currency || '';
                                    }
                                    if (!currency || currency.trim() === '') {
                                        currency = getCurrencyName(1);
                                    }
                                }

                                let baseAmount: number;
                                if (isLegacyLead) {
                                    const currencyId = (selectedClient as any)?.currency_id;
                                    let numericCurrencyId = typeof currencyId === 'string' ? parseInt(currencyId, 10) : Number(currencyId);
                                    if (!numericCurrencyId || isNaN(numericCurrencyId)) numericCurrencyId = 1;

                                    if (numericCurrencyId === 1) {
                                        baseAmount = Number((selectedClient as any)?.total_base ?? 0);
                                    } else {
                                        baseAmount = Number((selectedClient as any)?.total ?? 0);
                                    }
                                } else {
                                    baseAmount = Number(selectedClient?.balance || selectedClient?.proposal_total || 0);
                                }

                                // When payment plan exists, Total Value should match plan totals (no double VAT).
                                if (hasPaymentPlan && paymentPlanBaseTotal !== null) {
                                    baseAmount = Number(paymentPlanBaseTotal) || 0;
                                }

                                const subcontractorFee = Number(selectedClient?.subcontractor_fee ?? 0);
                                const mainAmount = baseAmount;
                                const netAfterSubcontractor =
                                    subcontractorFee > 0 ? baseAmount - subcontractorFee : null;
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

                                let vatAmount = 0;
                                let shouldShowVAT = false;
                                const vatValue = selectedClient?.vat;

                                if (isLegacyLead) {
                                    shouldShowVAT = true;
                                    if (vatValue !== null && vatValue !== undefined) {
                                        const vatStr = String(vatValue).toLowerCase().trim();
                                        if (vatStr === 'false' || vatStr === '0' || vatStr === 'no' || vatStr === 'excluded') shouldShowVAT = false;
                                    }
                                    if (hasPaymentPlan && paymentPlanVatTotal !== null) {
                                        vatAmount = Number(paymentPlanVatTotal) || 0;
                                        shouldShowVAT = vatAmount > 0;
                                    } else if (!hasPaymentPlan && shouldShowVAT) {
                                        const vatRate = getVatRateForLegacyLead((selectedClient as any)?.date_signed || (selectedClient as any)?.created_at || null);
                                        vatAmount = Math.round((baseAmount * vatRate) * 100) / 100;
                                    } else if (shouldShowVAT) {
                                        vatAmount = Number((selectedClient as any)?.vat_value ?? 0) || 0;
                                        if (!vatAmount) shouldShowVAT = false;
                                    }
                                } else {
                                    shouldShowVAT = true;
                                    if (vatValue !== null && vatValue !== undefined) {
                                        const vatStr = String(vatValue).toLowerCase().trim();
                                        if (vatStr === 'false' || vatStr === '0' || vatStr === 'no' || vatStr === 'excluded') shouldShowVAT = false;
                                    }

                                    if (shouldShowVAT) {
                                        if (selectedClient?.vat_value && Number(selectedClient.vat_value) > 0) {
                                            vatAmount = Number(selectedClient.vat_value);
                                        } else {
                                            const vatRate = getVatRateForLegacyLead((selectedClient as any)?.date_signed || (selectedClient as any)?.created_at || null);
                                            vatAmount = baseAmount * vatRate;
                                        }
                                    }
                                }

                                const unpaidOutstandingPairDesktop =
                                    unpaidByCurrency === null
                                        ? null
                                        : pickUnpaidBaseAndVatForCurrency(unpaidByCurrency, currency);
                                const unpaidGrossDesktop =
                                    unpaidOutstandingPairDesktop != null
                                        ? unpaidOutstandingPairDesktop.base + unpaidOutstandingPairDesktop.vat
                                        : 0;

                                return (
                                    <div
                                        className="group relative w-full max-w-xs cursor-pointer text-right"
                                        onClick={() => setIsBalanceModalOpen(true)}
                                    >
                                        <div className="space-y-1.5">
                                            <p className="text-[10px] font-semibold uppercase tracking-wide text-base-content/40">Total</p>
                                            <div className="flex items-end justify-end gap-2">
                                                <p className="text-3xl font-bold leading-none tracking-tight text-gray-900 dark:text-white inline-flex items-center gap-2">
                                                    <span>{currency}{Number(mainAmount.toFixed(2)).toLocaleString()}</span>
                                                    {hasPaymentPlan && <LockClosedIcon className="h-4 w-4 text-gray-500 dark:text-gray-300" title="Locked by payment plan" />}
                                                </p>
                                                {shouldShowVAT && vatAmount > 0 && (
                                                    <p className="pb-1 text-sm text-gray-600 dark:text-gray-400">
                                                        +{vatAmount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })} VAT
                                                    </p>
                                                )}
                                            </div>
                                            {subcontractorFee > 0 && netAfterSubcontractor !== null && (
                                                <p className="text-[11px] text-base-content/50">
                                                    Net {currency}
                                                    {Number(netAfterSubcontractor.toFixed(2)).toLocaleString()}
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
                                            {unpaidOutstandingPairDesktop !== null && unpaidGrossDesktop > 0 && (
                                                <div className="border-t border-gray-200/80 pt-1 dark:border-gray-600">
                                                    <p className="text-[10px] font-semibold uppercase tracking-wide text-base-content/35">
                                                        Outstanding
                                                    </p>
                                                    <div className="flex items-end justify-end gap-2">
                                                        <p className="text-2xl font-bold leading-none text-base-content/55">
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
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })()}
                            <div className="flex w-full max-w-xs flex-wrap items-center justify-end gap-2 border-t border-gray-200/80 pt-3 dark:border-gray-600">
                                {!hideActionsDropdown && (
                                    <>
                                        <button
                                            type="button"
                                            onClick={openHeaderDocumentsModal}
                                            disabled={!headerDocsLeadNumber}
                                            className="btn btn-sm btn-square relative rounded-full border border-base-300 btn-ghost min-h-10 min-w-10 disabled:pointer-events-none disabled:opacity-40"
                                            title={
                                                headerDocsLeadNumber
                                                    ? 'Case documents on OneDrive'
                                                    : 'Lead number required'
                                            }
                                            aria-label="Case documents"
                                        >
                                            <DocumentArrowUpIcon className="h-6 w-6" aria-hidden />
                                            {headerSupabaseDocumentsCount > 0 && (
                                                <span
                                                    className="absolute -right-1 -top-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1 text-[11px] font-bold text-white"
                                                    style={{ backgroundColor: '#3a3a3a' }}
                                                >
                                                    {headerSupabaseDocumentsCount > 99 ? '99+' : headerSupabaseDocumentsCount}
                                                </span>
                                            )}
                                        </button>
                                        {renderMoreActionsDropdown(
                                            'btn btn-sm btn-square rounded-full border border-base-300 btn-ghost min-h-10 min-w-10'
                                        )}
                                    </>
                                )}
                                {hideActionsDropdown ? renderCompactHistoryIconRow() : null}
                            </div>
                        </div>
                    </div>

                    {/* Case unactivated Badge - Between client name and stage badge */}
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

                        return (
                            <div className="flex flex-col items-center gap-2.5">
                                <div className="bg-red-100 text-red-800 rounded-lg px-4 py-3 border border-red-300">
                                    <div className="whitespace-nowrap text-base">
                                        Case inactive
                                        {unactivationReason && (
                                            <span className="ml-2 text-sm font-normal">
                                                ({unactivationReason})
                                            </span>
                                        )}
                                    </div>
                                </div>
                                {(selectedClient as any)?.deactivate_notes && (
                                    <div className="text-sm font-normal break-words max-w-full px-3 leading-relaxed text-gray-700">
                                        {(selectedClient as any).deactivate_notes}
                                    </div>
                                )}
                                {(selectedClient?.unactivated_by || selectedClient?.unactivated_at) && (
                                    <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 dark:border-gray-700 dark:bg-gray-800">
                                        <div className="text-xs font-normal text-center text-gray-700 dark:text-gray-300">
                                            by {selectedClient.unactivated_by || '---'}
                                            {selectedClient.unactivated_by && selectedClient.unactivated_at && ' / '}
                                            {selectedClient.unactivated_at && (
                                                <>at {new Date(selectedClient.unactivated_at).toLocaleDateString('en-US', {
                                                    year: 'numeric',
                                                    month: 'short',
                                                    day: 'numeric',
                                                    hour: '2-digit',
                                                    minute: '2-digit'
                                                })}</>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })()}
                </div>

                {/* Stage Logic Buttons - Mobile: Below timeline/history/stage badge row (btn-md + text-base for tap targets) */}
                <div className="flex md:hidden items-center gap-4 flex-wrap mt-7">
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

                        // Closed state: keep showing Sub efforts log for stage 200, otherwise show "No action available"
                        if (selectedClient && (areStagesEquivalent(currentStageName, 'Case Closed') || (isStageNumeric && stageNumeric === 200))) {
                            if ((isStageNumeric && stageNumeric === 200) || Number((selectedClient as any)?.stage) === 200) {
                                return (
                                    <>
                                        <div className="w-full mt-3 flex justify-end">
                                            <div className="w-full max-w-xl ml-auto">
                                                {isLoadingLeadSubEfforts ? (
                                                    <div className="text-sm text-gray-500">Loading sub efforts…</div>
                                                ) : leadSubEfforts.length > 0 ? (
                                                    <div className="rounded-2xl border border-base-200 bg-base-100 px-4 py-3 shadow-sm">
                                                        <div className="flex items-center justify-between gap-3 mb-2">
                                                            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                                                Sub efforts log
                                                            </div>
                                                            <button
                                                                type="button"
                                                                className="btn btn-ghost btn-xs"
                                                                onClick={() => openSubEffortsModal(null)}
                                                            >
                                                                View all
                                                            </button>
                                                        </div>
                                                        <div className="space-y-1.5">
                                                            {leadSubEfforts.map((row: any) => {
                                                                const name = row?.sub_efforts?.name ?? '—';
                                                                const who = row?.tenants_employee?.display_name ?? row?.created_by ?? '—';
                                                                const when = row?.created_at ? new Date(row.created_at).toLocaleString() : '—';
                                                                return (
                                                                    <button
                                                                        key={row.id}
                                                                        type="button"
                                                                        onClick={() => openSubEffortsModal(row.id)}
                                                                        className="w-full text-left rounded-xl border border-base-200 bg-gray-50/60 px-3 py-2 hover:bg-gray-50 transition"
                                                                    >
                                                                        <div className="flex items-center justify-between gap-3">
                                                                            <div className="min-w-0">
                                                                                <div className="font-semibold text-sm truncate text-gray-800">{name}</div>
                                                                                <div className="mt-0.5 text-xs text-gray-500 truncate">
                                                                                    by <span className="font-medium text-gray-700">{String(who)}</span>
                                                                                </div>
                                                                            </div>
                                                                            <div className="text-[11px] text-gray-400 whitespace-nowrap">{when}</div>
                                                                        </div>
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="text-sm text-gray-500">No sub efforts yet.</div>
                                                )}
                                            </div>
                                        </div>
                                        <SubEffortsLogModal
                                            open={isSubEffortsModalOpen}
                                            onClose={() => setIsSubEffortsModalOpen(false)}
                                            rows={leadSubEfforts}
                                            leadNumber={selectedClient?.lead_number ?? null}
                                            initialSelectedRowId={subEffortsModalRowId}
                                            onRefresh={() => void fetchLeadSubEfforts()}
                                        />
                                    </>
                                );
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
                                {(areStagesEquivalent(currentStageName, 'Handler Set') ||
                                    (isStageNumeric && stageNumeric === 105)) && (!hasPaymentPlan || nextDuePayment) ? (
                                    <div className="w-full flex justify-center">
                                        {!hasPaymentPlan ? (
                                            <div className="w-full max-w-xl rounded-2xl border border-red-200/70 bg-red-50 px-4 py-3 text-red-900 shadow-sm">
                                                <div className="flex items-center justify-between gap-3">
                                                    <div className="flex items-center gap-2 text-sm font-semibold">
                                                        <ExclamationTriangleIcon className="h-5 w-5" />
                                                        Missing payment plan
                                                    </div>
                                                    <div className="text-xs text-red-800/80 whitespace-nowrap">
                                                        Finances → payment plan
                                                    </div>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="w-full max-w-xl rounded-2xl border border-amber-200/70 bg-amber-50 px-4 py-3 text-amber-900 shadow-sm">
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
                                                                    <span className="text-xs text-amber-800/80 whitespace-nowrap">
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
                                        <div className="flex items-center justify-end gap-3">
                                            {subEffortsStageFlags.showFinalizeCaseWithSubEfforts && (
                                                <button
                                                    onClick={() => updateLeadStage(200)}
                                                    className="btn btn-neutral btn-md rounded-full px-4 shadow-lg gap-2 text-base transition-all hover:scale-105"
                                                >
                                                    <CheckCircleIcon className="w-4 h-4" />
                                                    Finalize Case
                                                </button>
                                            )}
                                            <div className="dropdown dropdown-end">
                                                <button
                                                    type="button"
                                                    className="btn btn-neutral btn-md rounded-full px-4 shadow-lg gap-2 text-base transition-all hover:scale-105"
                                                    disabled={isLoadingSubEfforts || isSavingSubEffort}
                                                >
                                                    <DocumentCheckIcon className="w-4 h-4" />
                                                    Sub efforts
                                                    <ChevronDownIcon className="w-4 h-4" />
                                                </button>
                                                <ul tabIndex={0} className="dropdown-content z-[330] menu p-2 shadow bg-base-100 rounded-box w-72">
                                                    {(() => {
                                                        const usedActive = new Set(
                                                            (leadSubEfforts || [])
                                                                .filter((r: any) => (r as any)?.active !== false)
                                                                .map((r: any) => Number((r as any)?.sub_effort_id ?? (r as any)?.sub_efforts?.id))
                                                                .filter((n: any) => Number.isFinite(n))
                                                        );
                                                        const allOpts = (subEfforts.length > 0 ? subEfforts : [
                                                            { id: 1, name: 'Aplication submitted' },
                                                            { id: 2, name: 'Communication with client' },
                                                        ]);
                                                        const remaining = allOpts.filter(opt => !usedActive.has(Number(opt.id)));
                                                        if (remaining.length === 0) {
                                                            return (
                                                                <li>
                                                                    <span className="px-3 py-2 text-sm text-gray-500">
                                                                        No more sub efforts
                                                                    </span>
                                                                </li>
                                                            );
                                                        }
                                                        return remaining.map(opt => (
                                                            <li key={opt.id}>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        void handleSelectSubEffort(opt);
                                                                    }}
                                                                    className="text-sm"
                                                                >
                                                                    {opt.name}
                                                                </button>
                                                            </li>
                                                        ));
                                                    })()}
                                                </ul>
                                            </div>
                                        </div>
                                        <div className="w-full mt-3 flex justify-end">
                                            <div className="w-full max-w-xl ml-auto">
                                            {isLoadingLeadSubEfforts ? (
                                                <div className="text-sm text-gray-500">Loading sub efforts…</div>
                                            ) : leadSubEfforts.length > 0 ? (
                                                <div className="rounded-2xl border border-base-200 bg-base-100 px-4 py-3 shadow-sm">
                                                    <div className="flex items-center justify-between gap-3 mb-2">
                                                        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                                            Sub efforts log
                                                        </div>
                                                        <button
                                                            type="button"
                                                            className="btn btn-ghost btn-xs"
                                                            onClick={() => openSubEffortsModal(null)}
                                                        >
                                                            View all
                                                        </button>
                                                    </div>
                                                    <div className="space-y-1.5">
                                                        {leadSubEfforts.map((row: any) => {
                                                            const name = row?.sub_efforts?.name ?? '—';
                                                            const who = row?.tenants_employee?.display_name ?? row?.created_by ?? '—';
                                                            const when = row?.created_at ? new Date(row.created_at).toLocaleString() : '—';
                                                            return (
                                                                <button
                                                                    key={row.id}
                                                                    type="button"
                                                                    onClick={() => openSubEffortsModal(row.id)}
                                                                    className="w-full text-left rounded-xl border border-base-200 bg-gray-50/60 px-3 py-2 hover:bg-gray-50 transition"
                                                                >
                                                                    <div className="flex items-center justify-between gap-3">
                                                                        <div className="min-w-0">
                                                                            <div className="font-semibold text-sm truncate text-gray-800">{name}</div>
                                                                            <div className="mt-0.5 text-xs text-gray-500 truncate">
                                                                                by <span className="font-medium text-gray-700">{String(who)}</span>
                                                                            </div>
                                                                        </div>
                                                                        <div className="text-[11px] text-gray-400 whitespace-nowrap">{when}</div>
                                                                    </div>
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="text-sm text-gray-500">No sub efforts yet.</div>
                                            )}
                                            </div>
                                        </div>
                                        <SubEffortsLogModal
                                            open={isSubEffortsModalOpen}
                                            onClose={() => setIsSubEffortsModalOpen(false)}
                                            rows={leadSubEfforts}
                                            leadNumber={selectedClient?.lead_number ?? null}
                                            initialSelectedRowId={subEffortsModalRowId}
                                            onRefresh={() => void fetchLeadSubEfforts()}
                                        />
                                    </>
                                )}

                                {/* Stage 200: keep showing Sub efforts log (read-only) */}
                                {(() => {
                                    const inferredStageNumeric = Number((selectedClient as any)?.stage ?? stageNumeric ?? NaN);
                                    return (isStageNumeric && stageNumeric === 200) || inferredStageNumeric === 200;
                                })() && (
                                    <>
                                        <div className="w-full mt-3 flex justify-end">
                                            <div className="w-full max-w-xl ml-auto">
                                                {isLoadingLeadSubEfforts ? (
                                                    <div className="text-sm text-gray-500">Loading sub efforts…</div>
                                                ) : leadSubEfforts.length > 0 ? (
                                                    <div className="rounded-2xl border border-base-200 bg-base-100 px-4 py-3 shadow-sm">
                                                        <div className="flex items-center justify-between gap-3 mb-2">
                                                            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                                                Sub efforts log
                                                            </div>
                                                            <button
                                                                type="button"
                                                                className="btn btn-ghost btn-xs"
                                                                onClick={() => openSubEffortsModal(null)}
                                                            >
                                                                View all
                                                            </button>
                                                        </div>
                                                        <div className="space-y-1.5">
                                                            {leadSubEfforts.map((row: any) => {
                                                                const name = row?.sub_efforts?.name ?? '—';
                                                                const who = row?.tenants_employee?.display_name ?? row?.created_by ?? '—';
                                                                const when = row?.created_at ? new Date(row.created_at).toLocaleString() : '—';
                                                                return (
                                                                    <button
                                                                        key={row.id}
                                                                        type="button"
                                                                        onClick={() => openSubEffortsModal(row.id)}
                                                                        className="w-full text-left rounded-xl border border-base-200 bg-gray-50/60 px-3 py-2 hover:bg-gray-50 transition"
                                                                    >
                                                                        <div className="flex items-center justify-between gap-3">
                                                                            <div className="min-w-0">
                                                                                <div className="font-semibold text-sm truncate text-gray-800">{name}</div>
                                                                                <div className="mt-0.5 text-xs text-gray-500 truncate">
                                                                                    by <span className="font-medium text-gray-700">{String(who)}</span>
                                                                                </div>
                                                                            </div>
                                                                            <div className="text-[11px] text-gray-400 whitespace-nowrap">{when}</div>
                                                                        </div>
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="text-sm text-gray-500">No sub efforts yet.</div>
                                                )}
                                            </div>
                                        </div>
                                        <SubEffortsLogModal
                                            open={isSubEffortsModalOpen}
                                            onClose={() => setIsSubEffortsModalOpen(false)}
                                            rows={leadSubEfforts}
                                            leadNumber={selectedClient?.lead_number ?? null}
                                            initialSelectedRowId={subEffortsModalRowId}
                                            onRefresh={() => void fetchLeadSubEfforts()}
                                        />
                                    </>
                                )}

                                {/* Payment request sent Stage */}
                                {areStagesEquivalent(currentStageName, 'payment_request_sent') && handlePaymentReceivedNewClient && (
                                    <button
                                        onClick={handlePaymentReceivedNewClient}
                                        className="btn btn-success btn-md text-white rounded-full px-4 shadow-lg shadow-green-100 hover:shadow-green-200 gap-2 text-base transition-all hover:scale-105"
                                    >
                                        <CheckCircleIcon className="w-4 h-4" />
                                        Payment Received - new Client !!!
                                    </button>
                                )}

                                {/* Another meeting Stage - Check this first to avoid duplicates */}
                                {areStagesEquivalent(currentStageName, 'another_meeting') && (
                                    <>
                                        {setShowRescheduleDrawer && (
                                            <button
                                                onClick={() => setShowRescheduleDrawer(true)}
                                                className="btn btn-outline btn-md rounded-full px-4 shadow-lg gap-2 text-base transition-all hover:scale-105"
                                            >
                                                <ArrowPathIcon className="w-4 h-4" />
                                                Meeting ReScheduling
                                            </button>
                                        )}
                                        {handleStageUpdate && (
                                            <button
                                                onClick={() => handleStageUpdate('Meeting Ended')}
                                                className="btn btn-neutral btn-md rounded-full px-4 shadow-lg gap-2 text-base transition-all hover:scale-105"
                                            >
                                                <CheckCircleIcon className="w-4 h-4" />
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
                                                        className="btn btn-primary btn-md rounded-full px-4 shadow-lg gap-2 text-base transition-all hover:scale-105"
                                                    >
                                                        <CalendarDaysIcon className="w-4 h-4" />
                                                        {scheduleMenuLabel}
                                                    </button>
                                                )}
                                            {setShowRescheduleDrawer && (
                                                <button
                                                    onClick={() => setShowRescheduleDrawer(true)}
                                                    className="btn btn-outline btn-md rounded-full px-4 shadow-lg gap-2 text-base transition-all hover:scale-105"
                                                >
                                                    <ArrowPathIcon className="w-4 h-4" />
                                                    Meeting ReScheduling
                                                </button>
                                            )}
                                            {/* Meeting Ended - only show for stage 21 if there are upcoming meetings, and exclude another_meeting */}
                                            {handleStageUpdate &&
                                                !areStagesEquivalent(currentStageName, 'another_meeting') &&
                                                (!(areStagesEquivalent(currentStageName, 'Meeting rescheduling') || (isStageNumeric && stageNumeric === 21)) || hasScheduledMeetings) && (
                                                    <button
                                                        onClick={() => handleStageUpdate('Meeting Ended')}
                                                        className="btn btn-neutral btn-md rounded-full px-4 shadow-lg gap-2 text-base transition-all hover:scale-105"
                                                    >
                                                        <CheckCircleIcon className="w-4 h-4" />
                                                        Meeting Ended
                                                    </button>
                                                )}
                                        </>
                                    )}

                                {/* Waiting for meeting summary Stage */}
                                {areStagesEquivalent(currentStageName, 'waiting_for_mtng_sum') && openSendOfferModal && (
                                    <button
                                        onClick={openSendOfferModal}
                                        className="btn btn-primary btn-md rounded-full px-4 shadow-lg gap-2 text-base transition-all hover:scale-105"
                                    >
                                        <DocumentCheckIcon className="w-4 h-4" />
                                        Send Price Offer
                                    </button>
                                )}

                                {/* Communication Started Stage */}
                                {areStagesEquivalent(currentStageName, 'Communication started') && (
                                    <>
                                        {handleScheduleMenuClick && scheduleMenuLabel && (
                                            <button
                                                onClick={handleScheduleMenuClick}
                                                className="btn btn-primary btn-md rounded-full px-4 shadow-lg gap-2 text-base transition-all hover:scale-105"
                                            >
                                                <CalendarDaysIcon className="w-4 h-4" />
                                                {scheduleMenuLabel}
                                            </button>
                                        )}
                                        {handleStageUpdate && (
                                            <button
                                                onClick={() => handleStageUpdate('Communication Started')}
                                                className="btn btn-outline btn-md rounded-full px-4 shadow-lg gap-2 text-base transition-all hover:scale-105"
                                            >
                                                <ChatBubbleLeftRightIcon className="w-4 h-4" />
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
                                                className="btn btn-primary btn-md rounded-full px-4 shadow-lg gap-2 text-base transition-all hover:scale-105"
                                            >
                                                <CalendarDaysIcon className="w-4 h-4" />
                                                {scheduleMenuLabel}
                                            </button>
                                        )}
                                        {handleOpenSignedDrawer && (
                                            <button
                                                onClick={handleOpenSignedDrawer}
                                                className="btn btn-success btn-md text-white rounded-full px-4 shadow-lg shadow-green-100 hover:shadow-green-200 gap-2 text-base transition-all hover:scale-105"
                                            >
                                                <HandThumbUpIcon className="w-4 h-4" />
                                                Client signed
                                            </button>
                                        )}
                                        {handleOpenDeclinedDrawer && (
                                            <button
                                                onClick={handleOpenDeclinedDrawer}
                                                className="btn btn-error btn-md text-white rounded-full px-4 shadow-lg gap-2 text-base transition-all hover:scale-105"
                                            >
                                                <HandThumbDownIcon className="w-4 h-4" />
                                                Client declined
                                            </button>
                                        )}
                                        {openSendOfferModal && (
                                            <button
                                                onClick={openSendOfferModal}
                                                className="btn btn-outline btn-md rounded-full px-4 shadow-lg gap-2 text-base transition-all hover:scale-105"
                                            >
                                                <PencilSquareIcon className="w-4 h-4" />
                                                Revised price offer
                                            </button>
                                        )}
                                    </>
                                )}

                                {/* Stage 60: no action buttons (handler assignment is required and auto-advances to "Handler Set") */}

                                {/* General stages - Schedule Meeting and Communication Started */}
                                {/* Only show for stages that haven't been handled by specific sections above */}
                                {selectedClient &&
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
                                                    className="btn btn-primary btn-md rounded-full px-4 shadow-lg gap-2 text-base transition-all hover:scale-105"
                                                >
                                                    <CalendarDaysIcon className="w-4 h-4" />
                                                    {scheduleMenuLabel}
                                                </button>
                                            )}
                                            {handleStageUpdate && (
                                                <button
                                                    onClick={() => handleStageUpdate('Communication Started')}
                                                    className="btn btn-outline btn-md rounded-full px-4 shadow-lg gap-2 text-base transition-all hover:scale-105"
                                                >
                                                    <ChatBubbleLeftRightIcon className="w-4 h-4" />
                                                    Communication Started
                                                </button>
                                            )}
                                        </>
                                    )}
                            </>
                        );
                    })()}
                </div>

                {/* Assign scheduler / handler — centered (compact width) */}
                {dropdownsContent && (
                    <div className="flex justify-center w-full pt-2">
                        <div className="w-full max-w-xs sm:max-w-sm">
                            {dropdownsContent}
                        </div>
                    </div>
                )}

                {/* Workflow Actions Bar - Roles and Quick Actions */}
                <div className="mt-7 pt-6 md:mt-0 md:pt-6 w-full">
                    <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-4">Assigned Team</p>
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
                              if (fromJoin && String(fromJoin).trim() && String(fromJoin).trim() !== '---') return String(fromJoin).trim();
                              return getEmployeeDisplayNameFromId((selectedClient as any).meeting_scheduler_id);
                            }
                            return selectedClient.scheduler || '---';
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
                        const hasHandlerRole = !isRoleEmpty(handlerId, handlerDisplay);
                        const hasRetentionRole = !isRoleEmpty(retentionHandlerId, retentionHandlerDisplay);
                        const showDualHandlerToggle = hasHandlerRole && hasRetentionRole && !isUnactivated;

                        // Group roles by employee ID
                        const roleGroups = new Map<string, { id: string | number | null; roles: string[]; display: string }>();

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

                        return (
                            <div className="flex flex-wrap items-center justify-between w-full gap-6">
                                {/* Assigned Team - inline, small avatars, text focus */}
                                <div className="flex items-center gap-6 min-w-0 flex-wrap">
                                    {Array.from(roleGroups.values()).map((group, index) => (
                                        <div key={index} className="flex items-center gap-2">
                                            <EmployeeAvatar employeeId={group.id} size="md" />
                                            <div className="flex flex-col min-w-0">
                                                <span className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">
                                                  {group.roles.join(', ')}
                                                </span>
                                                <span className="text-sm font-medium text-gray-700 truncate">{formatRoleDisplay(group.display)}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {/* Handler and Retainer Handler - avatars + active role segmented control (same semantics as My Cases) */}
                                {(hasHandlerRole || hasRetentionRole) && (
                                    <div className="flex flex-wrap items-end justify-center gap-4 sm:gap-6 mx-auto">
                                        {hasHandlerRole && (
                                            <div className="flex items-center gap-2 min-w-0">
                                                <div
                                                    className={`relative shrink-0 overflow-visible rounded-full p-0.5 transition-[box-shadow,opacity,ring-color] duration-500 ease-out ${
                                                        activeHandlerTypeForLead === 2
                                                            ? 'opacity-100 ring-2 ring-emerald-500 shadow-[0_0_14px_rgba(16,185,129,0.32)]'
                                                            : 'opacity-80 ring-2 ring-transparent'
                                                    }`}
                                                >
                                                    {activeHandlerTypeForLead === 2 && (
                                                        <span
                                                            key={handlerActiveRingNonce}
                                                            className="pointer-events-none absolute inset-[-4px] z-0 rounded-full animate-handler-active-ring-flash"
                                                            aria-hidden
                                                        />
                                                    )}
                                                    <div className="relative z-[1]">
                                                        <EmployeeAvatar employeeId={handlerId} size="md" />
                                                    </div>
                                                    {activeHandlerTypeForLead === 2 && (
                                                        <div className="absolute -top-0.5 -right-0.5 z-[2] bg-emerald-500 rounded-full p-0.5 ring-2 ring-white transition-transform duration-300 ease-out">
                                                            <CheckCircleIcon className="w-3 h-3 text-white" />
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="flex flex-col min-w-0">
                                                    <span className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">
                                                        Handler
                                                    </span>
                                                    <span className="text-sm font-medium text-gray-700 truncate">
                                                        {formatRoleDisplay(handlerDisplay)}
                                                    </span>
                                                </div>
                                            </div>
                                        )}

                                        {showDualHandlerToggle && (
                                            <div className="relative flex shrink-0 items-center">
                                                <div className="inline-flex h-11 min-w-[8.25rem] items-stretch gap-0.5 rounded-full border border-base-300/50 bg-base-200/90 p-1 shadow-inner">
                                                    <button
                                                        type="button"
                                                        aria-label="Case handler active on this file"
                                                        onClick={() => void updateActiveHandlerType(2)}
                                                        title="Case handler drives this file (Active Cases)"
                                                        className={`relative flex h-9 min-w-[3.25rem] flex-1 shrink-0 items-center justify-center rounded-full transition-all duration-300 ease-out ${
                                                            activeHandlerTypeForLead === 2
                                                                ? 'bg-emerald-50 shadow-sm ring-1 ring-emerald-200 dark:bg-emerald-900/30 dark:ring-emerald-900/40'
                                                                : 'bg-transparent hover:bg-base-100/70'
                                                        }`}
                                                    >
                                                        <UserIcon
                                                            className={`h-4 w-4 shrink-0 transition-colors duration-300 ${
                                                                activeHandlerTypeForLead === 2
                                                                    ? 'text-emerald-800 dark:text-emerald-100'
                                                                    : 'text-gray-500'
                                                            }`}
                                                            aria-hidden
                                                        />
                                                        <span className="sr-only">Case handler</span>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        aria-label="Retention handler active on this file"
                                                        onClick={() => void updateActiveHandlerType(1)}
                                                        title="Retention handler active (Non-Active Cases)"
                                                        className={`relative flex h-9 min-w-[3.25rem] flex-1 shrink-0 items-center justify-center rounded-full transition-all duration-300 ease-out ${
                                                            activeHandlerTypeForLead === 1
                                                                ? 'bg-sky-50 shadow-sm ring-1 ring-sky-200 dark:bg-sky-900/25 dark:ring-sky-900/40'
                                                                : 'bg-transparent hover:bg-base-100/70'
                                                        }`}
                                                    >
                                                        <RectangleStackIcon
                                                            className={`h-4 w-4 shrink-0 transition-colors duration-300 ${
                                                                activeHandlerTypeForLead === 1
                                                                    ? 'text-sky-800 dark:text-sky-100'
                                                                    : 'text-gray-500'
                                                            }`}
                                                            aria-hidden
                                                        />
                                                        <span className="sr-only">Retention handler</span>
                                                    </button>
                                                </div>
                                            </div>
                                        )}

                                        {hasRetentionRole && (
                                            <div className="flex items-center gap-2 min-w-0">
                                                <div
                                                    className={`relative shrink-0 overflow-visible rounded-full p-0.5 transition-[box-shadow,opacity,ring-color] duration-500 ease-out ${
                                                        activeHandlerTypeForLead === 1
                                                            ? 'opacity-100 ring-2 ring-emerald-500 shadow-[0_0_14px_rgba(16,185,129,0.32)]'
                                                            : 'opacity-80 ring-2 ring-transparent'
                                                    }`}
                                                >
                                                    {activeHandlerTypeForLead === 1 && (
                                                        <span
                                                            key={handlerActiveRingNonce}
                                                            className="pointer-events-none absolute inset-[-4px] z-0 rounded-full animate-handler-active-ring-flash"
                                                            aria-hidden
                                                        />
                                                    )}
                                                    <div className="relative z-[1]">
                                                        <EmployeeAvatar employeeId={retentionHandlerId} size="md" />
                                                    </div>
                                                    {activeHandlerTypeForLead === 1 && (
                                                        <div className="absolute -top-0.5 -right-0.5 z-[2] bg-emerald-500 rounded-full p-0.5 ring-2 ring-white transition-transform duration-300 ease-out">
                                                            <CheckCircleIcon className="w-3 h-3 text-white" />
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="flex flex-col min-w-0">
                                                    <span className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">
                                                        R-Handler
                                                    </span>
                                                    <span className="text-sm font-medium text-gray-700 truncate">
                                                        {formatRoleDisplay(retentionHandlerDisplay)}
                                                    </span>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Group 3: Quick Action Buttons (Right) */}
                                <div className="hidden md:flex items-center gap-3 flex-wrap justify-end min-w-[200px]">
                                    {isUnactivated ? (
                                        <div className="px-4 py-2 text-sm text-gray-600">
                                            Please activate lead in actions first to see the stage buttons.
                                        </div>
                                    ) : (
                                        <>
                                            {/* Closed state check */}
                                            {selectedClient && (areStagesEquivalent(currentStageName, 'Case Closed') || (isStageNumeric && stageNumeric === 200)) ? (
                                                ((isStageNumeric && stageNumeric === 200) || Number((selectedClient as any)?.stage) === 200) ? (
                                                    <>
                                                        <div className="w-full mt-3 flex justify-end">
                                                            <div className="w-full max-w-xl ml-auto">
                                                                {isLoadingLeadSubEfforts ? (
                                                                    <div className="text-sm text-gray-500">Loading sub efforts…</div>
                                                                ) : leadSubEfforts.length > 0 ? (
                                                                    <div className="rounded-2xl border border-base-200 bg-base-100 px-4 py-3 shadow-sm">
                                                                        <div className="flex items-center justify-between gap-3 mb-2">
                                                                            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                                                                Sub efforts log
                                                                            </div>
                                                                            <button
                                                                                type="button"
                                                                                className="btn btn-ghost btn-xs"
                                                                                onClick={() => openSubEffortsModal(null)}
                                                                            >
                                                                                View all
                                                                            </button>
                                                                        </div>
                                                                        <div className="space-y-1.5">
                                                                            {leadSubEfforts.map((row: any) => {
                                                                                const name = row?.sub_efforts?.name ?? '—';
                                                                                const who = row?.tenants_employee?.display_name ?? row?.created_by ?? '—';
                                                                                const when = row?.created_at ? new Date(row.created_at).toLocaleString() : '—';
                                                                                return (
                                                                                    <button
                                                                                        key={row.id}
                                                                                        type="button"
                                                                                        onClick={() => openSubEffortsModal(row.id)}
                                                                                        className="w-full text-left rounded-xl border border-base-200 bg-gray-50/60 px-3 py-2 hover:bg-gray-50 transition"
                                                                                    >
                                                                                        <div className="flex items-center justify-between gap-3">
                                                                                            <div className="min-w-0">
                                                                                                <div className="font-semibold text-sm truncate text-gray-800">{name}</div>
                                                                                                <div className="mt-0.5 text-xs text-gray-500 truncate">
                                                                                                    by <span className="font-medium text-gray-700">{String(who)}</span>
                                                                                                </div>
                                                                                            </div>
                                                                                            <div className="text-[11px] text-gray-400 whitespace-nowrap">{when}</div>
                                                                                        </div>
                                                                                    </button>
                                                                                );
                                                                            })}
                                                                        </div>
                                                                    </div>
                                                                ) : (
                                                                    <div className="text-sm text-gray-500">No sub efforts yet.</div>
                                                                )}
                                                            </div>
                                                        </div>
                                                        <SubEffortsLogModal
                                                            open={isSubEffortsModalOpen}
                                                            onClose={() => setIsSubEffortsModalOpen(false)}
                                                            rows={leadSubEfforts}
                                                            leadNumber={selectedClient?.lead_number ?? null}
                                                            initialSelectedRowId={subEffortsModalRowId}
                                                            onRefresh={() => void fetchLeadSubEfforts()}
                                                        />
                                                    </>
                                                ) : (
                                                    <div className="px-4 py-2 text-sm text-gray-600">
                                                        No action available
                                                    </div>
                                                )
                                            ) : (
                                                <>
                                                    {/* Stage 105 (Handler Nominated): show missing plan or next payment banner */}
                                                    {(((isStageNumeric && stageNumeric === 105) || Number((selectedClient as any)?.stage) === 105) &&
                                                        (!hasPaymentPlan || nextDuePayment)) ? (
                                                        <div className="w-full flex justify-center">
                                                            {!hasPaymentPlan ? (
                                                                <div className="w-full max-w-xl rounded-2xl border border-red-200/70 bg-red-50 px-4 py-3 text-red-900 shadow-sm">
                                                                    <div className="flex items-center justify-between gap-3">
                                                                        <div className="flex items-center gap-2 text-sm font-semibold">
                                                                            <ExclamationTriangleIcon className="h-5 w-5" />
                                                                            Missing payment plan
                                                                        </div>
                                                                        <div className="text-xs text-red-800/80 whitespace-nowrap">
                                                                            Finances → payment plan
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            ) : (
                                                                <div className="w-full max-w-xl rounded-2xl border border-amber-200/70 bg-amber-50 px-4 py-3 text-amber-900 shadow-sm">
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
                                                                                        <span className="text-xs text-amber-800/80 whitespace-nowrap">
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
                                                            <div className="flex items-center justify-end gap-3">
                                                                {subEffortsStageFlags.showFinalizeCaseWithSubEfforts && (
                                                                    <button
                                                                        onClick={() => updateLeadStage(200)}
                                                                        className="btn btn-outline btn-ghost rounded-full px-5 gap-2"
                                                                    >
                                                                        <CheckCircleIcon className="w-5 h-5" />
                                                                        Finalize Case
                                                                    </button>
                                                                )}
                                                                <div className="dropdown dropdown-end">
                                                                    <button
                                                                        type="button"
                                                                        className="btn btn-outline btn-ghost rounded-full px-5 gap-2"
                                                                        disabled={isLoadingSubEfforts || isSavingSubEffort}
                                                                    >
                                                                        <DocumentCheckIcon className="w-5 h-5" />
                                                                        Sub efforts
                                                                        <ChevronDownIcon className="w-4 h-4" />
                                                                    </button>
                                                                    <ul tabIndex={0} className="dropdown-content z-[330] menu p-2 shadow bg-base-100 rounded-box w-72">
                                                                        {(() => {
                                                                            const usedActive = new Set(
                                                                                (leadSubEfforts || [])
                                                                                    .filter((r: any) => (r as any)?.active !== false)
                                                                                    .map((r: any) =>
                                                                                        Number((r as any)?.sub_effort_id ?? (r as any)?.sub_efforts?.id)
                                                                                    )
                                                                                    .filter((n: any) => Number.isFinite(n))
                                                                            );
                                                                            const allOpts = (subEfforts.length > 0 ? subEfforts : [
                                                                                { id: 1, name: 'Aplication submitted' },
                                                                                { id: 2, name: 'Communication with client' },
                                                                            ]);
                                                                            const remaining = allOpts.filter(opt => !usedActive.has(Number(opt.id)));
                                                                            if (remaining.length === 0) {
                                                                                return (
                                                                                    <li>
                                                                                        <span className="px-3 py-2 text-sm text-gray-500">
                                                                                            No more sub efforts
                                                                                        </span>
                                                                                    </li>
                                                                                );
                                                                            }
                                                                            return remaining.map(opt => (
                                                                                <li key={opt.id}>
                                                                                    <button
                                                                                        type="button"
                                                                                        onClick={() => {
                                                                                            void handleSelectSubEffort(opt);
                                                                                        }}
                                                                                        className="text-sm"
                                                                                    >
                                                                                        {opt.name}
                                                                                    </button>
                                                                                </li>
                                                                            ));
                                                                        })()}
                                                                    </ul>
                                                                </div>
                                                            </div>
                                                            <div className="w-full mt-3 flex justify-end">
                                                                <div className="w-full max-w-xl ml-auto">
                                                                {isLoadingLeadSubEfforts ? (
                                                                    <div className="text-sm text-gray-500">Loading sub efforts…</div>
                                                                ) : leadSubEfforts.length > 0 ? (
                                                                    <div className="rounded-2xl border border-base-200 bg-base-100 px-4 py-3 shadow-sm">
                                                                        <div className="flex items-center justify-between gap-3 mb-2">
                                                                            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                                                                Sub efforts log
                                                                            </div>
                                                                            <button
                                                                                type="button"
                                                                                className="btn btn-ghost btn-xs"
                                                                                onClick={() => openSubEffortsModal(null)}
                                                                            >
                                                                                View all
                                                                            </button>
                                                                        </div>
                                                                        <div className="space-y-1.5">
                                                                            {leadSubEfforts.map((row: any) => {
                                                                                const name = row?.sub_efforts?.name ?? '—';
                                                                                const who = row?.tenants_employee?.display_name ?? row?.created_by ?? '—';
                                                                                const when = row?.created_at ? new Date(row.created_at).toLocaleString() : '—';
                                                                                return (
                                                                                    <button
                                                                                        key={row.id}
                                                                                        type="button"
                                                                                        onClick={() => openSubEffortsModal(row.id)}
                                                                                        className="w-full text-left rounded-xl border border-base-200 bg-gray-50/60 px-3 py-2 hover:bg-gray-50 transition"
                                                                                    >
                                                                                        <div className="flex items-center justify-between gap-3">
                                                                                            <div className="min-w-0">
                                                                                                <div className="font-semibold text-sm truncate text-gray-800">{name}</div>
                                                                                                <div className="mt-0.5 text-xs text-gray-500 truncate">
                                                                                                    by <span className="font-medium text-gray-700">{String(who)}</span>
                                                                                                </div>
                                                                                            </div>
                                                                                            <div className="text-[11px] text-gray-400 whitespace-nowrap">{when}</div>
                                                                                        </div>
                                                                                    </button>
                                                                                );
                                                                            })}
                                                                        </div>
                                                                    </div>
                                                                ) : (
                                                                    <div className="text-sm text-gray-500">No sub efforts yet.</div>
                                                                )}
                                                                </div>
                                                            </div>
                                                            <SubEffortsLogModal
                                                                open={isSubEffortsModalOpen}
                                                                onClose={() => setIsSubEffortsModalOpen(false)}
                                                                rows={leadSubEfforts}
                                                                leadNumber={selectedClient?.lead_number ?? null}
                                                                initialSelectedRowId={subEffortsModalRowId}
                                                                onRefresh={() => void fetchLeadSubEfforts()}
                                                            />
                                                        </>
                                                    )}

                                                    {/* Stage 200: keep showing Sub efforts log (read-only) */}
                                                    {(() => {
                                                        const inferredStageNumeric = Number((selectedClient as any)?.stage ?? stageNumeric ?? NaN);
                                                        return (isStageNumeric && stageNumeric === 200) || inferredStageNumeric === 200;
                                                    })() && (
                                                        <>
                                                            <div className="w-full mt-3 flex justify-end">
                                                                <div className="w-full max-w-xl ml-auto">
                                                                    {isLoadingLeadSubEfforts ? (
                                                                        <div className="text-sm text-gray-500">Loading sub efforts…</div>
                                                                    ) : leadSubEfforts.length > 0 ? (
                                                                        <div className="rounded-2xl border border-base-200 bg-base-100 px-4 py-3 shadow-sm">
                                                                            <div className="flex items-center justify-between gap-3 mb-2">
                                                                                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                                                                    Sub efforts log
                                                                                </div>
                                                                                <button
                                                                                    type="button"
                                                                                    className="btn btn-ghost btn-xs"
                                                                                    onClick={() => openSubEffortsModal(null)}
                                                                                >
                                                                                    View all
                                                                                </button>
                                                                            </div>
                                                                            <div className="space-y-1.5">
                                                                                {leadSubEfforts.map((row: any) => {
                                                                                    const name = row?.sub_efforts?.name ?? '—';
                                                                                    const who = row?.tenants_employee?.display_name ?? row?.created_by ?? '—';
                                                                                    const when = row?.created_at ? new Date(row.created_at).toLocaleString() : '—';
                                                                                    return (
                                                                                        <button
                                                                                            key={row.id}
                                                                                            type="button"
                                                                                            onClick={() => openSubEffortsModal(row.id)}
                                                                                            className="w-full text-left rounded-xl border border-base-200 bg-gray-50/60 px-3 py-2 hover:bg-gray-50 transition"
                                                                                        >
                                                                                            <div className="flex items-center justify-between gap-3">
                                                                                                <div className="min-w-0">
                                                                                                    <div className="font-semibold text-sm truncate text-gray-800">{name}</div>
                                                                                                    <div className="mt-0.5 text-xs text-gray-500 truncate">
                                                                                                        by <span className="font-medium text-gray-700">{String(who)}</span>
                                                                                                    </div>
                                                                                                </div>
                                                                                                <div className="text-[11px] text-gray-400 whitespace-nowrap">{when}</div>
                                                                                            </div>
                                                                                        </button>
                                                                                    );
                                                                                })}
                                                                            </div>
                                                                        </div>
                                                                    ) : (
                                                                        <div className="text-sm text-gray-500">No sub efforts yet.</div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <SubEffortsLogModal
                                                                open={isSubEffortsModalOpen}
                                                                onClose={() => setIsSubEffortsModalOpen(false)}
                                                                rows={leadSubEfforts}
                                                                leadNumber={selectedClient?.lead_number ?? null}
                                                                initialSelectedRowId={subEffortsModalRowId}
                                                                onRefresh={() => void fetchLeadSubEfforts()}
                                                            />
                                                        </>
                                                    )}

                                                    {/* Payment request sent Stage */}
                                                    {areStagesEquivalent(currentStageName, 'payment_request_sent') && handlePaymentReceivedNewClient && (
                                                        <button
                                                            onClick={handlePaymentReceivedNewClient}
                                                            className="btn btn-success rounded-full px-5 gap-2"
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
                                                                    className="btn btn-outline rounded-full px-5 gap-2"
                                                                >
                                                                    <ArrowPathIcon className="w-5 h-5" />
                                                                    Meeting ReScheduling
                                                                </button>
                                                            )}
                                                            {handleStageUpdate && (
                                                                <button
                                                                    onClick={() => handleStageUpdate('Meeting Ended')}
                                                                    className="btn btn-outline btn-ghost rounded-full px-5 gap-2"
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
                                                                            className="btn btn-primary rounded-full px-5 gap-2"
                                                                        >
                                                                            <CalendarDaysIcon className="w-5 h-5" />
                                                                            {scheduleMenuLabel}
                                                                        </button>
                                                                    )}
                                                                {setShowRescheduleDrawer && (
                                                                    <button
                                                                        onClick={() => setShowRescheduleDrawer(true)}
                                                                        className="btn btn-outline rounded-full px-5 gap-2"
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
                                                                            className="btn btn-outline btn-ghost rounded-full px-5 gap-2"
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
                                                            className="btn btn-primary rounded-full px-5 gap-2"
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
                                                                    className="btn btn-primary rounded-full px-5 gap-2"
                                                                >
                                                                    <CalendarDaysIcon className="w-5 h-5" />
                                                                    {scheduleMenuLabel}
                                                                </button>
                                                            )}
                                                            {handleStageUpdate && (
                                                                <button
                                                                    onClick={() => handleStageUpdate('Communication Started')}
                                                                    className="btn btn-outline rounded-full px-5 gap-2"
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
                                                                    className="btn btn-primary rounded-full px-5 gap-2"
                                                                >
                                                                    <CalendarDaysIcon className="w-5 h-5" />
                                                                    {scheduleMenuLabel}
                                                                </button>
                                                            )}
                                                            {handleOpenSignedDrawer && (
                                                                <button
                                                                    onClick={handleOpenSignedDrawer}
                                                                    className="btn btn-success rounded-full px-5 gap-2"
                                                                >
                                                                    <HandThumbUpIcon className="w-5 h-5" />
                                                                    Client signed
                                                                </button>
                                                            )}
                                                            {handleOpenDeclinedDrawer && (
                                                                <button
                                                                    onClick={handleOpenDeclinedDrawer}
                                                                    className="btn btn-error rounded-full px-5 gap-2"
                                                                >
                                                                    <HandThumbDownIcon className="w-5 h-5" />
                                                                    Client declined
                                                                </button>
                                                            )}
                                                            {openSendOfferModal && (
                                                                <button
                                                                    onClick={openSendOfferModal}
                                                                    className="btn btn-outline rounded-full px-5 gap-2"
                                                                >
                                                                    <PencilSquareIcon className="w-5 h-5" />
                                                                    Revised price offer
                                                                </button>
                                                            )}
                                                        </>
                                                    )}

                                                    {/* Stage 60: no action buttons (handler assignment is required and auto-advances to "Handler Set") */}

                                                    {/* General stages - Schedule Meeting and Communication Started */}
                                                    {selectedClient &&
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
                                                                        className="btn btn-primary rounded-full px-5 gap-2"
                                                                    >
                                                                        <CalendarDaysIcon className="w-5 h-5" />
                                                                        {scheduleMenuLabel}
                                                                    </button>
                                                                )}
                                                                {handleStageUpdate && (
                                                                    <button
                                                                        onClick={() => handleStageUpdate('Communication Started')}
                                                                        className="btn btn-outline rounded-full px-5 gap-2"
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
                                    )}
                                </div>
                            </div>
                        );
                    })()}
                </div>


                {/* Category Edit Modal */}
                {showCategoryModal && (
                    <div
                        className="fixed inset-0 bg-black/50 flex items-center justify-center z-[330]"
                        onClick={() => {
                            setShowCategoryModal(false);
                            setShowCategoryDropdown(false);
                            setCategoryInputValue('');
                        }}
                    >
                        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
                            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Edit Category</h3>

                            <div className="mb-6">
                                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Category</label>
                                <input
                                    autoFocus
                                    type="text"
                                    className="input input-bordered w-full"
                                    placeholder="Search categories..."
                                    value={categoryInputValue}
                                    onChange={e => {
                                        const v = e.target.value;
                                        setCategoryInputValue(v);
                                        setShowCategoryDropdown(v.trim().length > 0);
                                    }}
                                    onFocus={() => setShowCategoryDropdown(categoryInputValue.trim().length > 0)}
                                />
                                {showCategoryDropdown && filteredCategories.length > 0 && (
                                    <div className="mt-2 max-h-60 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 shadow-lg">
                                        {filteredCategories.slice(0, 20).map((cat: any) => {
                                            const displayName = cat.misc_maincategory?.name
                                                ? `${cat.name} (${cat.misc_maincategory.name})`
                                                : cat.name;
                                            return (
                                                <div
                                                    key={cat.id}
                                                    className="px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer text-sm"
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

                            <div className="flex gap-3 justify-end">
                                <button
                                    className="btn btn-ghost"
                                    onClick={() => {
                                        setShowCategoryModal(false);
                                        setShowCategoryDropdown(false);
                                        setCategoryInputValue('');
                                    }}
                                >
                                    Cancel
                                </button>
                                <button
                                    className="btn btn-primary"
                                    onClick={async () => {
                                        await handleSaveCategory();
                                        setShowCategoryModal(false);
                                        setShowCategoryDropdown(false);
                                        setCategoryInputValue('');
                                    }}
                                >
                                    Save
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {showLanguageModal && (
                    <div
                        className="fixed inset-0 bg-black/50 flex items-center justify-center z-[330]"
                        onClick={() => {
                            setShowLanguageModal(false);
                            setShowLanguageDropdown(false);
                            setLanguageInputValue('');
                        }}
                    >
                        <div
                            className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md p-6"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Edit Language</h3>

                            <div className="mb-6">
                                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                    Language
                                </label>
                                <input
                                    autoFocus
                                    type="text"
                                    className="input input-bordered w-full"
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
                                    <div className="mt-2 max-h-60 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 shadow-lg">
                                        {filteredLanguages.slice(0, 20).map((lang) => (
                                            <div
                                                key={String(lang.id)}
                                                className="px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer text-sm"
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

                            <div className="flex gap-3 justify-end">
                                <button
                                    type="button"
                                    className="btn btn-ghost"
                                    disabled={savingLanguage}
                                    onClick={() => {
                                        setShowLanguageModal(false);
                                        setShowLanguageDropdown(false);
                                        setLanguageInputValue('');
                                    }}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-primary"
                                    disabled={savingLanguage}
                                    onClick={() => void handleSaveLanguage()}
                                >
                                    {savingLanguage ? <span className="loading loading-spinner loading-sm" /> : 'Save'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {showTopicModal && (
                    <div
                        className="fixed inset-0 bg-black/50 flex items-center justify-center z-[330]"
                        onClick={() => {
                            setShowTopicModal(false);
                            setTopicInputValue('');
                        }}
                    >
                        <div
                            className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md p-6"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Edit Topic</h3>

                            <div className="mb-6">
                                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                    Topic
                                </label>
                                <input
                                    autoFocus
                                    type="text"
                                    className="input input-bordered w-full"
                                    placeholder="Topic (optional)"
                                    value={topicInputValue}
                                    onChange={(e) => setTopicInputValue(e.target.value)}
                                />
                            </div>

                            <div className="flex gap-3 justify-end">
                                <button
                                    type="button"
                                    className="btn btn-ghost"
                                    disabled={savingTopic}
                                    onClick={() => {
                                        setShowTopicModal(false);
                                        setTopicInputValue('');
                                    }}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-primary"
                                    disabled={savingTopic}
                                    onClick={() => void handleSaveTopic()}
                                >
                                    {savingTopic ? <span className="loading loading-spinner loading-sm" /> : 'Save'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

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
            </div>
        </div>
    );
};

export default ClientHeader;
