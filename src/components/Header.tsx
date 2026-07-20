import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useLocation, Link, useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { supabase, authRetryQueryOnce } from '../lib/supabase';
import { readBootstrappedDisplayName } from '../lib/authBootstrap';
import type { Lead } from '../lib/supabase';
import type { CombinedLead } from '../lib/legacyLeadsApi';
import {
  buildClientRouteFromRecentLead,
  navigateLeadContactSearchResult,
} from '../lib/leadContactSearchUi';
import { toast } from 'react-hot-toast';
import { usePushNotifications } from '../hooks/usePushNotifications';
import { useLeadContactSearch } from '../hooks/useLeadContactSearch';
import LeadContactSearchResults from './search/LeadContactSearchResults';
import Siriwave from 'react-siriwave';
import {
  Bars3Icon,
  MagnifyingGlassIcon,
  BellIcon,
  XMarkIcon,
  HashtagIcon,
  EnvelopeIcon,
  PhoneIcon,
  UserIcon,
  DocumentChartBarIcon,
  BuildingOffice2Icon,
  CalendarIcon,
  ArrowRightOnRectangleIcon,
  UserGroupIcon,
  FunnelIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  BoltIcon,
  ChatBubbleLeftRightIcon,
  StarIcon,
  Cog6ToothIcon,
  ShieldCheckIcon,
  ClipboardDocumentCheckIcon,
} from '@heroicons/react/24/outline';
import { useMsal } from '@azure/msal-react';
import { loginRequest } from '../msalConfig';
import { FaRobot } from 'react-icons/fa';
import { FaWhatsapp } from 'react-icons/fa';
import AdminChangeUserModal from './AdminChangeUserModal';
import EmployeeModal from './EmployeeModal';
import RMQMessagesPage from '../pages/RMQMessagesPage';
import HighlightsPanel from './HighlightsPanel';
import TeamStatusModal from './TeamStatusModal';
import ManualClockInApprovalModal from './ManualClockInApprovalModal';
import { fetchCombinedPendingHrApprovalCount } from '../lib/hrApprovals';
import { useManualClockInApprovalLiveRefresh } from '../hooks/useManualClockInApprovalLiveRefresh';
import { fetchStageNames, areStagesEquivalent, getStageName, getStageColour } from '../lib/stageUtils';
import { getRecentLeads, addRecentLead, type RecentLead } from '../lib/recentSearchStorage';
import {
  leadViewIdentityFromCombinedLead,
  recordEmployeeLeadView,
} from '../lib/employeeLeadReporting';
import { EXTERNAL_USER_HEADER_PADDING } from '../lib/externalUserLayout';
import { useExternalUser, shouldDeferInternalChrome } from '../hooks/useExternalUser';
import { useSignOutWithClockOut } from '../hooks/useSignOutWithClockOut';
import { useAuthContext } from '../contexts/AuthContext';
import { useAdminProfileBypass } from '../hooks/useAdminProfileBypass';
import { useOptionalClockInGate } from '../hooks/useClockInGate';
import { ADMIN_PROFILE_BYPASS_CHANGED_EVENT } from '../lib/adminClockInBypass';
import { clearAdminImpersonationGrant } from '../lib/adminImpersonationGrant';
import { clearClockInGateCache } from '../lib/clockInGateCache';
import { getMobileAwareCacheTtlMs } from '../lib/mobileCache';
import { runMailboxCatchUpSync } from '../lib/mailboxApi';

interface HeaderProps {
  onMenuClick: () => void;
  onSearchClick: () => void;
  isSearchOpen: boolean;
  setIsSearchOpen: (isOpen: boolean) => void;
  appJustLoggedIn?: boolean;
  onOpenAIChat?: () => void;
  isMenuOpen?: boolean;
  onOpenEmailThread?: () => void;
  onOpenWhatsApp?: () => void;
  onOpenMessaging?: () => void;
  /** When the shell has no md:pl-24 (client detail), pad header chrome clear of the floating sidebar. */
  clearFloatingSidebar?: boolean;
}

interface Notification {
  id: string;
  type: 'action' | 'info';
  message: string;
  time: string;
  read: boolean;
}

interface AssignmentNotification {
  key: string;
  table: 'legacy' | 'new';
  leadId: string | number;
  leadRouteId: string | number;
  leadNumber: string;
  roleLabel: string;
  updatedAt?: string;
}

const ASSIGNMENT_ROLE_FIELDS = [
  {
    label: 'Handler',
    legacyField: 'case_handler_id',
    newNumericField: 'case_handler_id', // May be used for handler
    newTextField: 'handler' // Primary field for handler in new leads
  },
  {
    label: 'Manager',
    legacyField: 'meeting_manager_id',
    newNumericField: 'meeting_manager_id', // Only field used for manager in new leads
    newTextField: null // NOT used - manager is saved as ID, not text
  },
  {
    label: 'Helper',
    legacyField: 'meeting_lawyer_id',
    newNumericField: 'meeting_lawyer_id', // Only field used for helper in new leads
    newTextField: null // NOT used - helper is saved as ID, not text
  },
  {
    label: 'Scheduler',
    legacyField: 'meeting_scheduler_id',
    newNumericField: null, // NOT used - scheduler is saved as text, not ID
    newTextField: 'scheduler' // Only field used for scheduler in new leads
  },
  {
    label: 'Expert',
    legacyField: 'expert_id',
    newNumericField: 'expert', // Only field used for expert in new leads (not expert_id)
    newTextField: null // NOT used - expert is saved as ID, not text
  },
  {
    label: 'Closer',
    legacyField: 'closer_id',
    newNumericField: null, // NOT used - closer is saved as text, not ID
    newTextField: 'closer' // Only field used for closer in new leads
  },
] as const;

const ASSIGNMENT_SEEN_STORAGE_KEY = 'rmq_assignment_seen_v1';

interface RMQMessage {
  id: number;
  conversation_id: number;
  sender_id: string;
  content: string;
  message_type: 'text' | 'file' | 'image' | 'system';
  sent_at: string;
  sender: {
    id: string;
    full_name: string;
    tenants_employee?: {
      display_name: string;
      photo_url?: string;
    };
  };
  conversation: {
    id: number;
    type: 'direct' | 'group' | 'announcement';
    title?: string;
  };
}

// Mock notifications removed - now using only RMQ messages

const Header: React.FC<HeaderProps> = ({ onMenuClick, onSearchClick, isSearchOpen, setIsSearchOpen, appJustLoggedIn, onOpenAIChat, isMenuOpen, onOpenEmailThread, onOpenWhatsApp, onOpenMessaging, clearFloatingSidebar = false }) => {
  // Check if alternative (green) theme is active - make it reactive
  const [isAltTheme, setIsAltTheme] = useState(() => document.documentElement.classList.contains('theme-alt'));
  // Dark mode: Tailwind `dark` class is set for both dark and Dark 2 themes
  const [isDarkMode, setIsDarkMode] = useState(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  );
  const location = useLocation();
  const navigate = useNavigate();
  const { sendNotificationForNewMessage } = usePushNotifications();
  const { isExternalUser, isLoading: isLoadingExternal } = useExternalUser();
  const [isSearchActive, setIsSearchActive] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [searchResults, setSearchResults] = useState<CombinedLead[]>([]);
  const isMouseOverSearchRef = useRef(false);
  /** Cleared on re-enter; prevents stacked timeouts when moving bar → portaled preview */
  const searchHoverCloseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const HEADER_SEARCH_INPUT_ID = 'header-search-input';
  const notificationsRef = useRef<HTMLDivElement>(null);
  const searchDropdownRef = useRef<HTMLDivElement>(null);
  const filterDropdownRef = useRef<HTMLDivElement>(null);
  const { instance } = useMsal();
  const {
    user: authContextUser,
    userFullName: authUserFullName,
    userInitials: authUserInitials,
    profilePhotoUrl: authProfilePhotoUrl,
    sessionRefreshNonce,
    supabaseSessionReady,
    isSuperUser,
  } = useAuthContext();
  const { bypass: adminProfileBypass, clearBypass: clearAdminBypass } = useAdminProfileBypass();
  const clockInGate = useOptionalClockInGate();
  const showAdminBypassBadge = Boolean(adminProfileBypass && clockInGate?.adminBypassActive);
  const { requestSignOut, signOutModal } = useSignOutWithClockOut();
  const [isMsalLoading, setIsMsalLoading] = useState(false);
  const [userAccount, setUserAccount] = useState<any>(null);
  const [isMsalInitialized, setIsMsalInitialized] = useState(false);
  const [userFullName, setUserFullName] = useState<string | null>(() =>
    typeof window !== 'undefined' ? readBootstrappedDisplayName() : null
  );
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const [advancedFilters, setAdvancedFilters] = useState({
    fromDate: '',
    toDate: '',
    category: '',
    language: '',
    reason: '',
    tags: '',
    fileId: '',
    status: '',
    source: '',
    eligibilityDeterminedOnly: false,
    stage: '',
    topic: '',
    content: '',
  });
  const [isAdvancedSearching, setIsAdvancedSearching] = useState(false);
  const [searchDropdownStyle, setSearchDropdownStyle] = useState({ top: 0, left: 0, width: 0 });
  const [isSearchAnimationDone, setIsSearchAnimationDone] = useState(false);
  const [showQuickActionsDropdown, setShowQuickActionsDropdown] = useState(false);
  const [quickMenuSearchValue, setQuickMenuSearchValue] = useState('');
  const [showQuickMenuAllDropdown, setShowQuickMenuAllDropdown] = useState(false);
  const [showSignOutModal, setShowSignOutModal] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [stageOptions, setStageOptions] = useState<string[]>([]);
  const [categoryOptions, setCategoryOptions] = useState<string[]>([]);
  const [sourceOptions, setSourceOptions] = useState<string[]>([]);
  const [languageOptions, setLanguageOptions] = useState<string[]>([]);
  const [hasAppliedFilters, setHasAppliedFilters] = useState(false);
  const { results: textSearchResults, loading: textSearchLoading } = useLeadContactSearch(searchValue, {
    enabled: supabaseSessionReady && searchValue.trim().length >= 2 && !hasAppliedFilters,
    limit: 20,
  });
  const activeSearchResults =
    searchValue.trim().length >= 2 && !hasAppliedFilters ? textSearchResults : searchResults;
  const activeSearchLoading =
    searchValue.trim().length >= 2 && !hasAppliedFilters ? textSearchLoading : isAdvancedSearching;
  const [currentUserEmployee, setCurrentUserEmployee] = useState<any>(null);
  const [externalUserProfile, setExternalUserProfile] = useState<{ photo_url?: string | null } | null>(null);
  /** Prefer live employee row; fall back to auth display cache so avatar matches name on first paint after refresh */
  const resolvedHeaderPhotoUrl =
    [adminProfileBypass?.targetPhotoUrl, externalUserProfile?.photo_url, currentUserEmployee?.photo_url, currentUserEmployee?.photo, authProfilePhotoUrl].find(
      (u) => typeof u === 'string' && u.trim() !== ''
    )?.trim() ?? null;
  const [isEmployeeModalOpen, setIsEmployeeModalOpen] = useState(false);
  const [allEmployees, setAllEmployees] = useState<any[]>([]);
  const [assignmentNotifications, setAssignmentNotifications] = useState<AssignmentNotification[]>([]);
  const [seenAssignmentKeys, setSeenAssignmentKeys] = useState<Set<string>>(new Set());

  // RMQ Messages state
  const [rmqMessages, setRmqMessages] = useState<RMQMessage[]>([]);
  const [rmqUnreadCount, setRmqUnreadCount] = useState(0);
  const [whatsappLeadsMessages, setWhatsappLeadsMessages] = useState<any[]>([]);
  const [whatsappLeadsUnreadCount, setWhatsappLeadsUnreadCount] = useState(0);
  const [whatsappClientsUnreadCount, setWhatsappClientsUnreadCount] = useState(0);
  const [emailUnreadCount, setEmailUnreadCount] = useState(0);
  const [emailLeadMessages, setEmailLeadMessages] = useState<Array<{
    id: string;
    sender_email: string | null;
    sender_name: string | null;
    latest_subject: string;
    latest_preview: string;
    latest_sent_at: string;
    message_count: number;
    message_ids: number[];
  }>>([]);
  const [emailLeadUnreadCount, setEmailLeadUnreadCount] = useState(0);
  const [isRmqModalOpen, setIsRmqModalOpen] = useState(false);
  const [selectedConversationId, setSelectedConversationId] = useState<number | undefined>();
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [isHighlightsPanelOpen, setIsHighlightsPanelOpen] = useState(false);
  const [isTeamStatusModalOpen, setIsTeamStatusModalOpen] = useState(false);
  const [isClockInApprovalModalOpen, setIsClockInApprovalModalOpen] = useState(false);
  const [pendingClockInApprovalCount, setPendingClockInApprovalCount] = useState(0);
  const [newLeadsCount, setNewLeadsCount] = useState<number>(0);
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);
  const [isAdminChangeUserOpen, setIsAdminChangeUserOpen] = useState(false);
  const profileDropdownRef = useRef<HTMLDivElement>(null);
  const profileButtonRefMobile = useRef<HTMLButtonElement>(null);
  const profileDropdownRefDesktop = useRef<HTMLDivElement>(null);
  const notificationsButtonRef = useRef<HTMLButtonElement>(null);
  const [notificationsDropdownPosition, setNotificationsDropdownPosition] = useState({ top: 0, left: 0, width: 0 });
  const createdStageIdsRef = useRef<number[]>([0, 11]);
  const schedulerStageIdsRef = useRef<number[]>([10]);
  const stageIdsReadyRef = useRef(false);
  const resolvingStageIdsRef = useRef<Promise<void> | null>(null);

  const unreadCount = rmqUnreadCount + (isSuperUser ? whatsappLeadsUnreadCount : 0) + assignmentNotifications.length + (isSuperUser ? emailLeadUnreadCount : 0);

  // Reactive theme detection
  useEffect(() => {
    const checkTheme = () => {
      const el = document.documentElement;
      setIsAltTheme(el.classList.contains('theme-alt'));
      setIsDarkMode(el.classList.contains('dark'));
    };

    checkTheme();
    const observer = new MutationObserver(checkTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme']
    });

    const handleThemeChange = (e: CustomEvent) => {
      setTimeout(checkTheme, 50);
    };
    window.addEventListener('themechange', handleThemeChange as EventListener);

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'theme') {
        setTimeout(checkTheme, 100);
      }
    };
    // Use the standard StorageEvent.
    window.addEventListener('storage', handleStorageChange as unknown as EventListener);

    return () => {
      observer.disconnect();
      window.removeEventListener('themechange', handleThemeChange as EventListener);
      window.removeEventListener('storage', handleStorageChange as unknown as EventListener);
    };
  }, []);

  // Mobile detection
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      const isMobileWidth = window.innerWidth < 768;
      setIsMobile(isMobileWidth);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Load dismissed assignment keys from database
  useEffect(() => {
    if (!authContextUser?.id) return;

    const loadDismissedAssignments = async () => {
      try {
        const { data: dismissals, error } = await authRetryQueryOnce(() =>
          supabase
            .from('assignment_notification_dismissals')
            .select('dismissal_key')
            .eq('user_id', authContextUser.id)
        );

        if (!error && dismissals) {
          const dismissedKeys = new Set(dismissals.map((d: any) => d.dismissal_key));
          setSeenAssignmentKeys(dismissedKeys);
          // Also update localStorage as cache
          if (typeof window !== 'undefined') {
            try {
              localStorage.setItem(ASSIGNMENT_SEEN_STORAGE_KEY, JSON.stringify(Array.from(dismissedKeys)));
            } catch (e) {
              // Ignore localStorage errors
            }
          }
          return;
        }

        // Fallback to localStorage if database query fails (for backward compatibility)
        if (typeof window !== 'undefined') {
          const stored = localStorage.getItem(ASSIGNMENT_SEEN_STORAGE_KEY);
          if (stored) {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed)) {
              setSeenAssignmentKeys(new Set(parsed));
            }
          }
        }
      } catch (error) {
        // Fallback to localStorage
        if (typeof window !== 'undefined') {
          try {
            const stored = localStorage.getItem(ASSIGNMENT_SEEN_STORAGE_KEY);
            if (stored) {
              const parsed = JSON.parse(stored);
              if (Array.isArray(parsed)) {
                setSeenAssignmentKeys(new Set(parsed));
              }
            }
          } catch (e) {
            // Ignore errors
          }
        }
      }
    };

    loadDismissedAssignments();
  }, [authContextUser?.id]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleEmailUnreadEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ count: number }>).detail;
      if (detail && typeof detail.count === 'number') {
        setEmailUnreadCount(detail.count);
      }
    };
    const handleRmqUnreadEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ count: number }>).detail;
      if (detail && typeof detail.count === 'number') {
        setRmqUnreadCount(detail.count);
      }
    };

    window.addEventListener('email:unread-count', handleEmailUnreadEvent as EventListener);
    window.addEventListener('rmq:unread-count', handleRmqUnreadEvent as EventListener);

    return () => {
      window.removeEventListener('email:unread-count', handleEmailUnreadEvent as EventListener);
      window.removeEventListener('rmq:unread-count', handleRmqUnreadEvent as EventListener);
    };
  }, []);

  const persistSeenAssignments = useCallback(async (nextSet: Set<string>, keysToAdd: string[] = []) => {
    if (!authContextUser?.id) {
      // Fallback to localStorage if no user
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(ASSIGNMENT_SEEN_STORAGE_KEY, JSON.stringify(Array.from(nextSet)));
        } catch (error) {
          console.error('Failed to persist assignment notification cache', error);
        }
      }
      return;
    }

    // Save new keys to database
    if (keysToAdd.length > 0) {
      try {
        // Insert each dismissal individually, using upsert to handle duplicates
        for (const key of keysToAdd) {
          const { error } = await supabase
            .from('assignment_notification_dismissals')
            .upsert({
              user_id: authContextUser.id,
              dismissal_key: key,
              dismissed_at: new Date().toISOString()
            }, {
              onConflict: 'user_id,dismissal_key'
            });

          if (error) {
            console.error('Failed to save dismissal to database:', error);
          }
        }

        // Also update localStorage as cache
        if (typeof window !== 'undefined') {
          try {
            localStorage.setItem(ASSIGNMENT_SEEN_STORAGE_KEY, JSON.stringify(Array.from(nextSet)));
          } catch (e) {
            // Ignore localStorage errors
          }
        }
      } catch (error) {
        console.error('Error saving dismissals to database:', error);
        // Fallback to localStorage
        if (typeof window !== 'undefined') {
          try {
            localStorage.setItem(ASSIGNMENT_SEEN_STORAGE_KEY, JSON.stringify(Array.from(nextSet)));
          } catch (e) {
            // Ignore localStorage errors
          }
        }
      }
    } else {
      // Just update localStorage cache
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(ASSIGNMENT_SEEN_STORAGE_KEY, JSON.stringify(Array.from(nextSet)));
        } catch (error) {
          console.error('Failed to persist assignment notification cache', error);
        }
      }
    }
  }, [authContextUser?.id]);

  const rememberAssignments = useCallback((keys: string[]) => {
    if (!keys.length) return;
    setSeenAssignmentKeys(prev => {
      const next = new Set(prev);
      const keysToAdd: string[] = [];
      keys.forEach(key => {
        if (!next.has(key)) {
          next.add(key);
          keysToAdd.push(key);
        }
      });
      if (keysToAdd.length > 0) {
        persistSeenAssignments(next, keysToAdd);
      }
      return next;
    });
  }, [persistSeenAssignments]);

  const navTabs = [
    {
      label: 'Calendar',
      path: '/calendar',
      icon: CalendarIcon,
    },
    {
      label: 'Lead Search',
      path: '/lead-search',
      icon: MagnifyingGlassIcon,
    },
    {
      label: 'Assign Leads',
      path: '/new-cases',
      icon: UserGroupIcon,
    },
    {
      label: 'Handler Management',
      path: '/handler-management',
      icon: UserGroupIcon,
    },
    {
      label: 'Reports',
      path: '/reports',
      icon: DocumentChartBarIcon,
    },
    // {
    //   label: 'Teams',
    //   path: '/teams',
    //   icon: UserGroupIcon,
    // },


  ];

  const fetchPendingClockInApprovals = useCallback(async () => {
    if (!isSuperUser) {
      setPendingClockInApprovalCount(0);
      return;
    }
    try {
      const count = await fetchCombinedPendingHrApprovalCount();
      setPendingClockInApprovalCount(count);
    } catch (err) {
      console.error('Header pending clock-in approvals:', err);
    }
  }, [isSuperUser]);

  useEffect(() => {
    void fetchPendingClockInApprovals();
  }, [fetchPendingClockInApprovals]);

  useManualClockInApprovalLiveRefresh({
    enabled: isSuperUser,
    channelSuffix: 'header',
    onChange: fetchPendingClockInApprovals,
  });

  const quickMenuItems = useMemo(() => {
    const items: Array<{
      id: string;
      label: string;
      description: string;
      keywords: string[];
      icon: any;
      badge?: string | number | null;
      onSelect: () => void;
    }> = [];

    navTabs
      .filter(tab => isSuperUser || tab.path !== '/new-cases')
      .forEach((tab) => {
        const isNewCases = tab.path === '/new-cases';
        items.push({
          id: `nav_${tab.path}`,
          label: tab.label,
          description: tab.path,
          keywords: [tab.label, tab.path, tab.label.replace(/\s+/g, ''), 'page', 'route'],
          icon: tab.icon,
          badge: isNewCases && newLeadsCount > 0 ? newLeadsCount : null,
          onSelect: () => {
            setShowQuickActionsDropdown(false);
            navigate(tab.path || '/');
          },
        });
        if (tab.path === '/reports' && isSuperUser) {
          items.push({
            id: 'report_external_firms',
            label: 'External Firms',
            description: '/reports/external-firms',
            keywords: [
              'External Firms',
              'external firms',
              'external',
              'firms',
              'reports',
              'marketing',
              'partners',
              'tenants',
            ],
            icon: BuildingOffice2Icon,
            onSelect: () => {
              setShowQuickActionsDropdown(false);
              navigate('/reports/external-firms');
            },
          });
        }
      });

    // Keep hamburger search aligned with Sidebar pages (including grouped sub-items).
    const sidebarSearchItems: Array<{ label: string; path: string; keywords?: string[] }> = [
      { label: 'Dashboard', path: '/', keywords: ['home', 'main'] },
      { label: 'Collection', path: '/collection' },
      { label: 'Calendar', path: '/calendar' },
      { label: 'Waiting for Price Offer', path: '/waiting-for-price-offer', keywords: ['price offer', 'waiting'] },
      { label: 'Finance Pipeline', path: '/reports/finance-management', keywords: ['finance', 'collection', 'expenses'] },
      { label: 'HR Management', path: '/reports/hr-management', keywords: ['hr', 'employees', 'human resources'] },
      { label: 'Hot Leads', path: '/scheduler-tool', keywords: ['hot', 'priority', 'scheduler'] },
      { label: 'Pipeline', path: '/pipeline' },
      { label: 'Expert', path: '/expert' },
      { label: 'Create New', path: '/create', keywords: ['new lead', 'create lead'] },
      { label: 'Lead Search', path: '/lead-search' },
      { label: 'Double Leads', path: '/double-leads', keywords: ['duplicates'] },
      { label: 'Assign Leads', path: '/new-cases' },
      { label: 'New Handler Cases', path: '/new-handler-cases' },
      { label: 'My Cases', path: '/my-cases' },
      { label: 'Retention Cases', path: '/retainer-handler-cases' },
      { label: 'Case Manager', path: '/case-manager' },
      { label: 'My Performance', path: '/performance' },
      { label: 'Employee Performance', path: '/employee-performance' },
      { label: 'Documents', path: '/documents' },
      { label: 'WhatsApp Leads', path: '/whatsapp-leads', keywords: ['whatsapp', 'wa'] },
      { label: 'Email Leads', path: '/email-leads', keywords: ['email', 'mail'] },
      { label: 'Calls Ledger', path: '/calls-ledger', keywords: ['calls', 'phone'] },
      { label: 'Reports', path: '/reports' },
      {
        label: 'External Firms',
        path: '/reports/external-firms',
        keywords: ['external', 'firms', 'marketing', 'partners', 'tenants'],
      },
      { label: 'Settings', path: '/settings' },
      ...(currentUser?.extern
        ? [
            { label: 'Report', path: '/external-reports', keywords: ['external', 'marketing', 'performance', 'funnel'] },
            { label: 'External settings', path: '/external-settings', keywords: ['external', 'profile', 'firm'] },
          ]
        : []),
      { label: 'Admin Panel', path: '/admin', keywords: ['admin'] },
    ];

    const existingPaths = new Set(
      items
        .map((entry) => entry.description)
        .filter((desc) => typeof desc === 'string' && desc.startsWith('/'))
    );

    sidebarSearchItems
      .filter((entry) => {
        if (entry.path === '/new-cases' && !isSuperUser) return false;
        if (entry.path === '/reports/hr-management' && !isSuperUser) return false;
        if (entry.path === '/reports/external-firms' && !isSuperUser) return false;
        return true;
      })
      .forEach((entry) => {
        if (existingPaths.has(entry.path)) return;
        items.push({
          id: `sidebar_${entry.path.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`,
          label: entry.label,
          description: entry.path,
          keywords: [entry.label, entry.path, 'sidebar', 'page', ...(entry.keywords || [])],
          icon: DocumentChartBarIcon,
          onSelect: () => {
            setShowQuickActionsDropdown(false);
            navigate(entry.path);
          },
        });
      });

    items.push(
      {
        id: 'home',
        label: 'Dashboard',
        description: '/',
        keywords: ['home', 'dashboard', 'main', 'landing', 'index', '/'],
        icon: UserGroupIcon,
        onSelect: () => {
          setShowQuickActionsDropdown(false);
          navigate('/');
        },
      },
      {
        id: 'my_profile',
        label: 'My Profile',
        description: '/my-profile',
        keywords: ['profile', 'me', 'account', 'user', 'my profile'],
        icon: UserIcon,
        onSelect: () => {
          setShowQuickActionsDropdown(false);
          navigate('/my-profile');
        },
      },
      {
        id: 'settings',
        label: 'Settings',
        description: '/settings',
        keywords: ['settings', 'preferences', 'config', 'system'],
        icon: Cog6ToothIcon,
        onSelect: () => {
          setShowQuickActionsDropdown(false);
          navigate('/settings');
        },
      },
      {
        id: 'highlights',
        label: 'Highlights',
        description: 'Open highlights panel',
        keywords: ['highlights', 'important', 'pinned', 'starred'],
        icon: StarIcon,
        onSelect: () => {
          setShowQuickActionsDropdown(false);
          setIsHighlightsPanelOpen(true);
        },
      }
    );

    if (isSuperUser) {
      items.push({
        id: 'team_status',
        label: 'Team Status',
        description: 'View team availability and clock-in status',
        keywords: ['team', 'status', 'availability', 'clock', 'unavailability', 'staff', 'employees'],
        icon: UserGroupIcon,
        onSelect: () => {
          setShowQuickActionsDropdown(false);
          setIsTeamStatusModalOpen(true);
        },
      });
      items.push({
        id: 'clock_in_approval',
        label: 'HR Approvals',
        description: 'Review manual clock-in, WFH, and leave requests',
        keywords: [
          'clock',
          'clock-in',
          'clock-out',
          'approval',
          'manual',
          'working hours',
          'timesheet',
          'leave',
          'sick',
          'vacation',
          'hr',
        ],
        icon: ClipboardDocumentCheckIcon,
        badge: pendingClockInApprovalCount > 0 ? pendingClockInApprovalCount : null,
        onSelect: () => {
          setShowQuickActionsDropdown(false);
          setIsClockInApprovalModalOpen(true);
        },
      });
    }

    if (typeof onOpenAIChat === 'function') {
      items.push({
        id: 'rmq_ai',
        label: 'RMQ AI',
        description: 'Open AI chat',
        keywords: ['ai', 'assistant', 'chat', 'rmq ai', 'bot'],
        icon: FaRobot,
        onSelect: () => {
          setShowQuickActionsDropdown(false);
          onOpenAIChat();
        },
      });
    }

    if (typeof onOpenWhatsApp === 'function') {
      items.push({
        id: 'whatsapp',
        label: 'WhatsApp',
        description: 'Open WhatsApp inbox',
        keywords: ['whatsapp', 'wa', 'messages', 'chat'],
        icon: FaWhatsapp,
        badge: whatsappClientsUnreadCount > 0 ? (whatsappClientsUnreadCount > 9 ? '9+' : whatsappClientsUnreadCount) : null,
        onSelect: () => {
          setShowQuickActionsDropdown(false);
          onOpenWhatsApp();
        },
      });
    }

    if (typeof onOpenEmailThread === 'function') {
      items.push({
        id: 'email_thread',
        label: 'Email Thread',
        description: 'Open email conversations',
        keywords: ['email', 'mail', 'thread', 'inbox'],
        icon: EnvelopeIcon,
        onSelect: () => {
          setShowQuickActionsDropdown(false);
          onOpenEmailThread();
        },
      });
    }

    const reportSearchItems = [
      { label: 'External firms', category: 'Marketing', route: '/reports/external-firms', superuserOnly: true },
      { label: 'Sources pie', category: 'Marketing' },
      { label: 'Category & source', category: 'Marketing' },
      { label: 'Convertion', category: 'Marketing' },
      { label: 'Convertion Steps', category: 'Marketing' },
      { label: 'Scheduled', category: 'Meetings' },
      { label: 'Signed', category: 'Sales', route: '/sales/signed' },
      { label: 'Bonuses (v4)', category: 'Sales' },
      { label: 'Expert', category: 'Pipelines' },
      { label: 'Sales Pipeline', category: 'Pipelines', route: '/reports/closer-super-pipeline' },
      { label: 'Experts Results', category: 'Experts' },
      { label: 'All', category: 'Contribution' },
      { label: 'M&M Contribution profitability', category: 'Contribution', route: '/reports/sales-contribution' },
      { label: 'Collection', category: 'Finances', route: '/reports/collection-finances' },
      { label: 'Collection Due', category: 'Finances', route: '/reports/collection-due' },
      { label: 'Edit Contracts', category: 'Tools', route: '/reports/edit-contracts' },
      { label: 'Re-assign leads', category: 'Tools', route: '/reports/reassign-leads' },
      { label: 'Employee Unavailabilities', category: 'Tools', route: '/reports/employee-unavailabilities' },
      { label: 'Employee Salaries', category: 'Tools', route: '/reports/employee-salaries' },
      { label: 'Leads Report', category: 'Tools', route: '/reports/leads-report' },
      { label: 'Employee Info', category: 'Employees', route: '/reports/employee-info' },
    ];

    reportSearchItems
      .filter((report) => isSuperUser || !(report as { superuserOnly?: boolean }).superuserOnly)
      .forEach((report) => {
      const targetPath = report.route || `/reports?report=${encodeURIComponent(report.label)}`;
      items.push({
        id: `report_${report.label.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
        label: report.label,
        description: `${report.category} report`,
        keywords: [
          report.label,
          report.category,
          'report',
          'reports',
          'analytics',
          targetPath,
        ],
        icon: DocumentChartBarIcon,
        onSelect: () => {
          setShowQuickActionsDropdown(false);
          navigate(targetPath);
        },
      });
    });

    return items;
  }, [isSuperUser, navTabs, newLeadsCount, navigate, onOpenAIChat, onOpenEmailThread, onOpenWhatsApp, whatsappClientsUnreadCount, currentUser, pendingClockInApprovalCount]);

  const filteredQuickMenuItems = useMemo(() => {
    const q = quickMenuSearchValue.trim().toLowerCase();
    if (!q) return quickMenuItems;

    const scoreItem = (item: (typeof quickMenuItems)[number]): number => {
      const label = item.label.toLowerCase();
      const desc = item.description.toLowerCase();
      const keywords = item.keywords.join(' ').toLowerCase();
      const haystack = `${label} ${desc} ${keywords}`;
      const labelWords = label.split(/[\s/-]+/).filter(Boolean);

      if (label === q) return 1000;
      if (label.startsWith(q)) return 900;
      if (labelWords.some((word) => word.startsWith(q))) return 860;
      if (label.includes(q)) return 750;
      if (desc.startsWith(q)) return 650;
      if (desc.includes(q)) return 600;
      if (keywords.includes(q)) return 500;

      // Keep fuzzy search stricter: only allow subsequence matching for >=3 chars.
      if (q.length < 3) return 0;

      // Lightweight fuzzy subsequence score for typos/partial matches.
      let qi = 0;
      let bonus = 0;
      for (let i = 0; i < haystack.length && qi < q.length; i += 1) {
        if (haystack[i] === q[qi]) {
          bonus += i < label.length ? 8 : 3;
          qi += 1;
        }
      }
      return qi === q.length ? 250 + bonus : 0;
    };

    return quickMenuItems
      .map((item) => ({ item, score: scoreItem(item) }))
      .filter((entry) => {
        if (entry.score <= 0) return false;
        // Short queries must be strong matches to reduce noise.
        if (q.length <= 2) return entry.score >= 860;
        if (q.length === 3) return entry.score >= 500;
        return entry.score >= 300;
      })
      .sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label))
      .map((entry) => entry.item)
      .slice(0, 10);
  }, [quickMenuItems, quickMenuSearchValue]);

  useEffect(() => {
    let clickTimeout: NodeJS.Timeout;
    let isScrolling = false;

    const handleScroll = () => {
      isScrolling = true;
      // Clear any pending click outside handler during scroll
      if (clickTimeout) {
        clearTimeout(clickTimeout);
      }
      // Reset scrolling flag after scroll ends
      setTimeout(() => {
        isScrolling = false;
      }, 150);
    };

    const handleClickOutside = (event: Event) => {
      // Don't close if we're currently scrolling
      if (isScrolling) {
        return;
      }

      // Clear any existing timeout
      if (clickTimeout) {
        clearTimeout(clickTimeout);
      }

      // Add a small delay to prevent accidental closures during scrolling
      clickTimeout = setTimeout(() => {
        if (
          searchContainerRef.current &&
          !searchContainerRef.current.contains(event.target as Node) &&
          searchDropdownRef.current &&
          !searchDropdownRef.current.contains(event.target as Node) &&
          filterDropdownRef.current &&
          !filterDropdownRef.current.contains(event.target as Node)
        ) {
          // Only close search bar if filter dropdown is not open, no search value/results, not searching, and mouse is not over search area
          if (!showFilterDropdown && !searchValue.trim() && activeSearchResults.length === 0 && !activeSearchLoading && !isMouseOverSearchRef.current) {
            setIsSearchActive(false);
            setIsSearchOpen(false);
            setSearchResults([]);
            setSearchValue('');
            setHasAppliedFilters(false);
          }
        }
      }, 100); // Small delay to prevent accidental closures
    };

    const handleDropdownClickOutside = (event: Event) => {
      const target = event.target as HTMLElement;

      // Close notifications when clicking outside (dropdown may be portaled)
      const insideNotificationsTrigger =
        notificationsRef.current?.contains(target as Node) ||
        profileDropdownRef.current?.contains(target as Node) ||
        document.querySelector('[data-profile-dropdown-mobile]')?.contains(target as Node);
      if (!insideNotificationsTrigger) {
        const notificationDropdownEl = document.querySelector('[data-notification-dropdown]');
        if (!notificationDropdownEl?.contains(target as Node)) {
          setShowNotifications(false);
        }
      }

      // Close profile dropdown when clicking outside (check both mobile and desktop profile refs)
      // Mobile dropdown is portaled to body, so also check data-profile-dropdown-mobile
      const mobileDropdownEl = document.querySelector('[data-profile-dropdown-mobile]');
      const outsideMobile = !profileDropdownRef.current?.contains(target as Node) && !mobileDropdownEl?.contains(target as Node);
      const outsideDesktop = !profileDropdownRefDesktop.current?.contains(target as Node);
      if (outsideMobile && outsideDesktop) {
        setShowProfileDropdown(false);
      }

      // Close quick actions dropdown when clicking outside
      const quickActionsDropdown = document.querySelector('[data-quick-actions-dropdown]');
      const dropdownMenu = document.querySelector('[data-dropdown-menu]');

      // Check if target is a navigation link (Link component renders as <a>)
      const isNavigationLink = target.tagName === 'A' || target.closest('a');

      // Close dropdowns if clicking outside both dropdown and menu
      if (showQuickActionsDropdown) {
        // Check if click is outside the button and the dropdown menu
        const clickedOutsideButton = !buttonRef.current?.contains(target as Node);
        const clickedOutsideMenu = !dropdownMenu?.contains(target as Node);

        if ((clickedOutsideButton && clickedOutsideMenu) || isNavigationLink) {
          setShowQuickActionsDropdown(false);
        }
      }
    };

    // Use click events for all dropdowns
    document.addEventListener('click', handleDropdownClickOutside);
    // Add scroll listener to prevent closing during scroll
    document.addEventListener('scroll', handleScroll, true);

    return () => {
      if (clickTimeout) {
        clearTimeout(clickTimeout);
      }
      document.removeEventListener('click', handleDropdownClickOutside);
      document.removeEventListener('scroll', handleScroll, true);
    };
  }, [showFilterDropdown, showQuickActionsDropdown, showProfileDropdown]);

  // Close quick actions and profile dropdown when route changes
  useEffect(() => {
    setShowQuickActionsDropdown(false);
    setShowProfileDropdown(false);
  }, [location.pathname]);

  // Lock body scroll while mobile profile sheet is open
  useEffect(() => {
    if (!showProfileDropdown || !isMobile) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [showProfileDropdown, isMobile]);

  useEffect(() => {
    if (!showQuickActionsDropdown) {
      setQuickMenuSearchValue('');
      setShowQuickMenuAllDropdown(false);
    }
  }, [showQuickActionsDropdown]);

  // Handle escape key to close dropdowns
  useEffect(() => {
    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowQuickActionsDropdown(false);
        setShowNotifications(false);
        setShowFilterDropdown(false);
        setShowProfileDropdown(false);
      }
    };

    document.addEventListener('keydown', handleEscapeKey);
    return () => document.removeEventListener('keydown', handleEscapeKey);
  }, []);

  // Cleanup function to close all dropdowns when component unmounts
  useEffect(() => {
    return () => {
      setShowQuickActionsDropdown(false);
      setShowNotifications(false);
      setShowFilterDropdown(false);
      setShowProfileDropdown(false);
    };
  }, []);

  // Keep search active when filter dropdown is open
  useEffect(() => {
    if (showFilterDropdown && !isSearchActive) {
      setIsSearchActive(true);
    }
  }, [showFilterDropdown, isSearchActive]);

  // Advanced search filter dropdowns — refetch when session hydrates or token refreshes (RLS + joins need JWT).
  useEffect(() => {
    if (!supabaseSessionReady) return;
    let cancelled = false;

    const loadOne = async (
      table: string,
      setter: React.Dispatch<React.SetStateAction<string[]>>,
      fallback: string[]
    ) => {
      try {
        const { data, error } = await supabase.from(table).select('name').order('name');
        if (error) throw error;
        if (cancelled) return;
        const names = (data ?? []).map((row: { name?: string }) => row.name).filter(Boolean) as string[];
        setter(names);
      } catch (error) {
        console.error(`Error fetching ${table} options:`, error);
        if (!cancelled) setter(fallback);
      }
    };

    void Promise.all([
      loadOne(
        'lead_stages',
        setStageOptions,
        [
          'created', 'scheduler_assigned', 'meeting_scheduled', 'meeting_paid',
          'unactivated', 'communication_started', 'another_meeting', 'revised_offer',
          'offer_sent', 'waiting_for_mtng_sum', 'client_signed', 'client_declined',
          'lead_summary', 'meeting_rescheduled', 'meeting_ended',
        ]
      ),
      loadOne(
        'misc_category',
        setCategoryOptions,
        ['German Citizenship', 'Austrian Citizenship', 'Inquiry', 'Consultation', 'Other']
      ),
      loadOne('sources', setSourceOptions, ['Manual', 'AI Assistant', 'Referral', 'Website', 'Other']),
      loadOne(
        'misc_language',
        setLanguageOptions,
        ['English', 'Hebrew', 'German', 'French', 'Russian', 'Other']
      ),
    ]);

    return () => {
      cancelled = true;
    };
  }, [supabaseSessionReady, sessionRefreshNonce]);

  useEffect(() => {
    const initializeMsal = async () => {
      if (!instance) return;

      try {
        const accounts = instance.getAllAccounts();
        if (accounts.length > 0) {
          setUserAccount(accounts[0]);
        }
        setIsMsalInitialized(true);
      } catch (error) {
        console.error('Failed to initialize MSAL:', error);
      }
    };

    initializeMsal();
  }, [instance]);

  // AuthContext bumps sessionRefreshNonce on token/visibility refresh — refetch header profile once (no duplicate listeners)
  const lastHeaderNonceRef = useRef<number | null>(null);

  useEffect(() => {
    if (!authContextUser?.id) {
      setCurrentUser(null);
      setCurrentUserEmployee(null);
      setUserFullName('');
      setAllEmployees([]);
      return;
    }

    const skipSessionCache =
      lastHeaderNonceRef.current !== null && sessionRefreshNonce !== lastHeaderNonceRef.current;
    lastHeaderNonceRef.current = sessionRefreshNonce;

    const user = authContextUser;
    const cacheKey = `header_userData_${user.id}`;
    const cacheTimestampKey = `header_userData_${user.id}_timestamp`;
    const CACHE_DURATION = getMobileAwareCacheTtlMs(30 * 60 * 1000);

    const fetchUserData = async () => {
      if (skipSessionCache) {
        try {
          sessionStorage.removeItem(cacheKey);
          sessionStorage.removeItem(cacheTimestampKey);
        } catch (_) {}
      }

      try {
        const cachedData = sessionStorage.getItem(cacheKey);
        const cachedTimestamp = sessionStorage.getItem(cacheTimestampKey);

        if (!skipSessionCache && cachedData && cachedTimestamp) {
          const age = Date.now() - parseInt(cachedTimestamp, 10);
          if (age < CACHE_DURATION) {
            const data = JSON.parse(cachedData);
            // Cache safety: older cached payloads may miss `extern` (used for External settings menu).
            if (data?.currentUser && typeof data.currentUser.extern === 'undefined') {
              throw new Error('Header cache missing extern flag; refetching');
            }
            setUserFullName(data.userFullName || '');
            if (data.currentUser) setCurrentUser(data.currentUser);
            if (data.currentUserEmployee) setCurrentUserEmployee(data.currentUserEmployee);
            if (data.allEmployees) setAllEmployees(data.allEmployees);
            return;
          }
        }
      } catch (error) {
        console.error('Error reading header user data cache:', error);
      }

      if (user.email) {
        let fullNameValue = '';

        const { data, error } = await supabase
          .from('users')
          .select('first_name, last_name, full_name')
          .eq('email', user.email)
          .single();
        if (!error && data) {
          if (data.first_name && data.last_name && data.first_name.trim() && data.last_name.trim()) {
            fullNameValue = `${data.first_name.trim()} ${data.last_name.trim()}`;
            setUserFullName(fullNameValue);
          } else if (data.full_name && data.full_name.trim()) {
            fullNameValue = data.full_name.trim();
            setUserFullName(fullNameValue);
          } else {
            fullNameValue = user.email || '';
            setUserFullName(fullNameValue);
          }
        } else {
          if (user.user_metadata?.first_name || user.user_metadata?.full_name) {
            const authName = user.user_metadata.first_name || user.user_metadata.full_name;
            fullNameValue = authName;
            setUserFullName(authName);
            try {
              await supabase.rpc('sync_or_update_auth_user', { user_email: user.email });
            } catch (_) {}
          } else {
            fullNameValue = user.email || '';
            setUserFullName(fullNameValue);
          }
        }

        try {
          const { data: userData, error: userError } = await supabase
            .from('users')
            .select(`
              id,
              full_name,
              email,
              employee_id,
              is_superuser,
              extern,
              tenants_employee!employee_id(
                id,
                display_name,
                official_name,
                bonuses_role,
                department_id,
                user_id,
                photo_url,
                photo,
                phone,
                mobile,
                phone_ext,
                tenant_departement!department_id(
                  id,
                  name
                )
              )
            `)
            .eq('auth_id', user.id)
            .single();

          if (!userError && userData) {
            const maybeLoadExternalProfile = async () => {
              try {
                if (!(userData as any)?.extern) {
                  setExternalUserProfile(null);
                  return;
                }
                const { data: prof, error: profErr } = await supabase
                  .from('firm_contacts')
                  .select('profile_image_url')
                  .eq('user_id', String(userData.id))
                  .maybeSingle();
                if (profErr) throw profErr;
                setExternalUserProfile({ photo_url: (prof as any)?.profile_image_url ?? null });
              } catch (e) {
                console.warn('Header external profile load failed:', e);
                setExternalUserProfile(null);
              }
            };

            if (userData.tenants_employee) {
              const empData = userData.tenants_employee;

              setCurrentUser(userData);
              void maybeLoadExternalProfile();

              setCurrentUserEmployee({
                ...empData,
                department: (empData as any).tenant_departement?.name || 'General',
                email: userData.email,
                is_active: true,
                performance_metrics: {
                  total_meetings: 0,
                  completed_meetings: 0,
                  total_revenue: 0,
                  average_rating: 0,
                  last_activity: 'No activity'
                }
              });

              const { data: allEmployeesData, error: allEmployeesError } = await supabase
                .from('users')
                .select(`
                id,
                full_name,
                email,
                employee_id,
                is_active,
                tenants_employee!employee_id(
                  id,
                  display_name,
                  bonuses_role,
                  department_id,
                  user_id,
                  photo_url,
                  photo,
                  phone,
                  mobile,
                  phone_ext,
                  tenant_departement!department_id(
                    id,
                    name
                  )
                )
              `)
                .not('employee_id', 'is', null)
                .eq('is_active', true);

              if (!allEmployeesError && allEmployeesData) {
                const processedEmployees = allEmployeesData
                  .filter(u => u.tenants_employee && u.email)
                  .map(u => {
                    const employee = u.tenants_employee as any;
                    return {
                      id: employee.id,
                      display_name: employee.display_name,
                      bonuses_role: employee.bonuses_role,
                      department_id: employee.department_id,
                      user_id: employee.user_id,
                      photo_url: employee.photo_url,
                      photo: employee.photo,
                      phone: employee.phone,
                      mobile: employee.mobile,
                      phone_ext: employee.phone_ext,
                      department: employee.tenant_departement?.name || 'General',
                      email: u.email
                    };
                  });

                const uniqueEmployeesMap = new Map();
                processedEmployees.forEach(emp => {
                  if (!uniqueEmployeesMap.has(emp.id)) {
                    uniqueEmployeesMap.set(emp.id, emp);
                  }
                });
                const uniqueEmployees = Array.from(uniqueEmployeesMap.values());
                setAllEmployees(uniqueEmployees);

                setTimeout(() => {
                  try {
                    const finalFullName = fullNameValue || userData.full_name || user.email || '';
                    const finalCurrentUserEmployee = {
                      ...empData,
                      department: (empData as any).tenant_departement?.name || 'General',
                      email: userData.email,
                      is_active: true,
                      performance_metrics: {
                        total_meetings: 0,
                        completed_meetings: 0,
                        total_revenue: 0,
                        average_rating: 0,
                        last_activity: 'No activity'
                      }
                    };
                    sessionStorage.setItem(cacheKey, JSON.stringify({
                      userFullName: finalFullName,
                      currentUser: userData,
                      currentUserEmployee: finalCurrentUserEmployee,
                      allEmployees: uniqueEmployees,
                    }));
                    sessionStorage.setItem(cacheTimestampKey, Date.now().toString());
                  } catch (cacheError) {
                    console.error('Error caching header user data:', cacheError);
                  }
                }, 100);
              }
            } else {
              setCurrentUser(userData);
              void maybeLoadExternalProfile();

              setTimeout(() => {
                try {
                  const finalFullName = fullNameValue || userData.full_name || user.email || '';
                  sessionStorage.setItem(cacheKey, JSON.stringify({
                    userFullName: finalFullName,
                    currentUser: userData,
                    currentUserEmployee: null,
                    allEmployees: [],
                  }));
                  sessionStorage.setItem(cacheTimestampKey, Date.now().toString());
                } catch (cacheError) {
                  console.error('Error caching header user data:', cacheError);
                }
              }, 100);
            }
          } else if (userData) {
            setCurrentUser(userData);
            setTimeout(() => {
              try {
                const finalFullName = fullNameValue || (userData as any)?.full_name || user.email || '';
                sessionStorage.setItem(cacheKey, JSON.stringify({
                  userFullName: finalFullName,
                  currentUser: userData,
                  currentUserEmployee: null,
                  allEmployees: [],
                }));
                sessionStorage.setItem(cacheTimestampKey, Date.now().toString());
              } catch (cacheError) {
                console.error('Error caching header user data:', cacheError);
              }
            }, 100);
          }
        } catch (error) {
          console.error('Error fetching employee data:', error);
        }
      }
    };
    fetchUserData();
  }, [authContextUser?.id, sessionRefreshNonce]);

  useEffect(() => {
    if (!authContextUser?.id) return;

    const applyBypassProfile = async () => {
      if (!adminProfileBypass?.targetEmployeeId) return;

      const { data: empData, error } = await supabase
        .from('tenants_employee')
        .select(`
          id,
          display_name,
          official_name,
          bonuses_role,
          department_id,
          user_id,
          photo_url,
          photo,
          phone,
          mobile,
          phone_ext,
          tenant_departement!department_id(
            id,
            name
          )
        `)
        .eq('id', adminProfileBypass.targetEmployeeId)
        .maybeSingle();

      if (error || !empData) return;

      setUserFullName(adminProfileBypass.targetDisplayName);
      setCurrentUserEmployee({
        ...empData,
        department: (empData as any).tenant_departement?.name || 'General',
        email: currentUser?.email,
        is_active: true,
        performance_metrics: {
          total_meetings: 0,
          completed_meetings: 0,
          total_revenue: 0,
          average_rating: 0,
          last_activity: 'No activity',
        },
      });
    };

    const invalidateAndRefetch = () => {
      if (!authContextUser?.id) return;
      try {
        sessionStorage.removeItem(`header_userData_${authContextUser.id}`);
        sessionStorage.removeItem(`header_userData_${authContextUser.id}_timestamp`);
      } catch {
        // ignore
      }
      void fetchUserDataFromBypassEvent();
    };

    const fetchUserDataFromBypassEvent = async () => {
      if (adminProfileBypass?.targetEmployeeId) {
        await applyBypassProfile();
        return;
      }

      const cacheKey = `header_userData_${authContextUser.id}`;
      const cacheTimestampKey = `header_userData_${authContextUser.id}_timestamp`;
      try {
        sessionStorage.removeItem(cacheKey);
        sessionStorage.removeItem(cacheTimestampKey);
      } catch {
        // ignore
      }

      const user = authContextUser;
      const { data: userData } = await supabase
        .from('users')
        .select(`
          id,
          full_name,
          email,
          employee_id,
          is_superuser,
          extern,
          tenants_employee!employee_id(
            id,
            display_name,
            official_name,
            bonuses_role,
            department_id,
            user_id,
            photo_url,
            photo,
            phone,
            mobile,
            phone_ext,
            tenant_departement!department_id(
              id,
              name
            )
          )
        `)
        .eq('auth_id', user.id)
        .maybeSingle();

      if (!userData) return;

      setCurrentUser(userData);
      if (userData.tenants_employee) {
        const empData = userData.tenants_employee;
        const fullName =
          (empData as any).official_name ||
          (empData as any).display_name ||
          userData.full_name ||
          user.email ||
          '';
        setUserFullName(fullName);
        setCurrentUserEmployee({
          ...empData,
          department: (empData as any).tenant_departement?.name || 'General',
          email: userData.email,
          is_active: true,
          performance_metrics: {
            total_meetings: 0,
            completed_meetings: 0,
            total_revenue: 0,
            average_rating: 0,
            last_activity: 'No activity',
          },
        });
      }
    };

    void fetchUserDataFromBypassEvent();

    const onBypassChanged = () => invalidateAndRefetch();
    window.addEventListener(ADMIN_PROFILE_BYPASS_CHANGED_EVENT, onBypassChanged);
    return () => window.removeEventListener(ADMIN_PROFILE_BYPASS_CHANGED_EVENT, onBypassChanged);
  }, [
    adminProfileBypass?.targetEmployeeId,
    adminProfileBypass?.targetDisplayName,
    authContextUser?.id,
    currentUser?.email,
  ]);

  // Fetch RMQ messages for notifications
  const fetchRmqMessages = async () => {
    if (!currentUser) {
      console.log('🔔 No current user for RMQ messages');
      return;
    }

    const participantUserId = currentUser.id != null ? String(currentUser.id).trim() : '';
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        participantUserId
      );
    if (!isUuid) {
      // currentUser may be hydrated before public.users.id is available (avoids uuid "undefined")
      return;
    }

    try {
      // Get conversations where the current user participates
      const { data: userConversations, error: convError } = await supabase
        .from('conversation_participants')
        .select('conversation_id')
        .eq('user_id', participantUserId)
        .eq('is_active', true);

      if (convError) {
        console.error('Error fetching user conversations:', convError);
        return;
      }

      const conversationIds = userConversations?.map(c => c.conversation_id) || [];

      if (conversationIds.length === 0) {
        setRmqMessages([]);
        setRmqUnreadCount(0);
        return;
      }

      // First, get user's last_read_at for each conversation
      // Only query if we have conversation IDs to avoid empty array issues
      let userParticipants: any[] = [];
      let lastReadMap = new Map();

      try {
        const { data, error: participantsError } = await supabase
          .from('conversation_participants')
          .select('conversation_id, last_read_at')
          .eq('user_id', participantUserId)
          .in('conversation_id', conversationIds);

        if (participantsError) {
          console.error('Error fetching user participants:', participantsError);
          // Continue with empty map if participants query fails
        } else {
          userParticipants = data || [];
        }
      } catch (err) {
        console.error('Error fetching user participants:', err);
        // Continue with empty map
      }

      // Create a map of conversation_id -> last_read_at
      userParticipants.forEach(participant => {
        lastReadMap.set(participant.conversation_id, participant.last_read_at);
      });

      // Get messages that are actually unread (sent after last_read_at)
      const unreadMessagesPromises = conversationIds.map(async (convId) => {
        const lastReadAt = lastReadMap.get(convId);

        let query = supabase
          .from('messages')
          .select(`
            id,
            conversation_id,
            sender_id,
            content,
            message_type,
            sent_at,
            sender:users!sender_id(
              id,
              full_name,
              tenants_employee!left(
                display_name,
                photo_url
              )
            )
          `)
          .eq('conversation_id', convId)
          .eq('is_deleted', false)
          .neq('sender_id', participantUserId); // Exclude user's own messages

        // Only get messages sent after the user's last read timestamp
        if (lastReadAt) {
          query = query.gt('sent_at', lastReadAt);
        }

        const { data, error } = await query
          .order('sent_at', { ascending: false })
          .limit(5); // Limit per conversation to avoid too many messages

        if (error) {
          console.error(`Error fetching unread messages for conversation ${convId}:`, error);
          return [];
        }

        return data || [];
      });

      const unreadMessagesArrays = await Promise.all(unreadMessagesPromises);
      const messagesData = unreadMessagesArrays.flat();

      // Get conversation details for each message
      const messagesWithConversations = await Promise.all(
        (messagesData || []).map(async (message: any) => {
          const { data: conversationData } = await supabase
            .from('conversations')
            .select('id, type, title')
            .eq('id', message.conversation_id)
            .single();

          return {
            ...message,
            conversation: conversationData || { id: message.conversation_id, type: 'direct' }
          };
        })
      );


      setRmqMessages(messagesWithConversations);

      // Calculate unread count based on actual messages fetched
      setRmqUnreadCount(messagesWithConversations.length);
    } catch (error) {
      console.error('Error in fetchRmqMessages:', error);
    }
  };

  // Fetch WhatsApp leads messages (unread messages from new leads)
  const fetchWhatsappLeadsMessages = async () => {
    try {
      // Fetch incoming WhatsApp messages - same logic as WhatsAppLeadsPage
      // Only filter by lead_id or legacy_id (backend handles phone number matching)
      let whatsappMessages: any[] = [];

      try {
        const { data, error } = await supabase
          .from('whatsapp_messages')
          .select('*')
          .eq('direction', 'in')
          .or('is_read.is.null,is_read.eq.false')
          .order('sent_at', { ascending: false })
          .limit(50); // Get more messages to properly filter

        if (error) {
          console.error('Error fetching WhatsApp leads messages:', error);
          // Set empty state on error
          setWhatsappLeadsMessages([]);
          setWhatsappLeadsUnreadCount(0);
          return;
        }

        whatsappMessages = data || [];
      } catch (err) {
        console.error('Error fetching WhatsApp leads messages:', err);
        // Set empty state on error
        setWhatsappLeadsMessages([]);
        setWhatsappLeadsUnreadCount(0);
        return;
      }

      if (!whatsappMessages || whatsappMessages.length === 0) {
        setWhatsappLeadsMessages([]);
        setWhatsappLeadsUnreadCount(0);
        return;
      }

      // Helper function to extract phone number (same as WhatsAppLeadsPage)
      const extractPhoneNumber = (senderName: string): string | null => {
        if (!senderName) return null;
        const phoneRegex = /(\+?9725[0-9]{8}|05[0-9]{8}|5[0-9]{8})/;
        const match = senderName.match(phoneRegex);
        return match ? match[1] : null;
      };

      const extractPhoneFromMessage = (message: string): string | null => {
        if (!message) return null;
        const phoneRegex = /(\+?9725[0-9]{8}|05[0-9]{8}|5[0-9]{8})/;
        const match = message.match(phoneRegex);
        return match ? match[1] : null;
      };

      // Filter and group messages by phone number (same logic as WhatsAppLeadsPage)
      const leadMap = new Map<string, any>();

      whatsappMessages.forEach((message) => {
        // Use phone_number field directly from database, fallback to extraction if not available
        const phoneNumber = message.phone_number || extractPhoneNumber(message.sender_name) || extractPhoneFromMessage(message.message) || 'unknown';

        // Consider connected only if linked to a lead via FK (lead_id or legacy_id)
        // Backend should handle phone number matching, frontend only checks if lead exists
        const isConnected = !!message.lead_id || !!message.legacy_id;

        // Only include unconnected leads
        if (isConnected || phoneNumber === 'unknown') {
          return; // Skip connected leads
        }

        if (!leadMap.has(phoneNumber)) {
          leadMap.set(phoneNumber, {
            phone_number: phoneNumber,
            sender_name: message.sender_name,
            latest_message: message.message,
            latest_message_time: message.sent_at,
            message_count: 1,
            id: message.id // Use the latest message ID as the group ID
          });
        } else {
          const existingLead = leadMap.get(phoneNumber)!;
          existingLead.message_count++;
          // Keep the latest message
          if (new Date(message.sent_at) > new Date(existingLead.latest_message_time)) {
            existingLead.latest_message = message.message;
            existingLead.latest_message_time = message.sent_at;
            existingLead.id = message.id;
          }
        }
      });

      const groupedMessagesArray = Array.from(leadMap.values())
        .sort((a, b) => new Date(b.latest_message_time).getTime() - new Date(a.latest_message_time).getTime())
        .slice(0, 10); // Limit to latest 10 unconnected leads

      setWhatsappLeadsMessages(groupedMessagesArray);
      setWhatsappLeadsUnreadCount(groupedMessagesArray.length);
    } catch (error) {
      console.error('Error in fetchWhatsappLeadsMessages:', error);
      setWhatsappLeadsMessages([]);
      setWhatsappLeadsUnreadCount(0);
    }
  };

  // Fetch WhatsApp clients unread count (messages from existing clients, lead_id is not null)
  const fetchWhatsappClientsUnreadCount = useCallback(async () => {
    try {
      // If user is superuser, count all unread messages
      if (isSuperUser) {
        const { data, error } = await supabase
          .from('whatsapp_messages')
          .select('id')
          .eq('direction', 'in')
          .or('is_read.is.null,is_read.eq.false');

        if (error) {
          console.error('Error fetching WhatsApp clients unread count:', error);
          setWhatsappClientsUnreadCount(0);
          return;
        }

        setWhatsappClientsUnreadCount(data?.length || 0);
        return;
      }

      // For non-superusers, filter by "My Contacts" logic (role matching)
      // If we don't have user data, don't count any (should not happen, but safety check)
      if (!currentUserEmployee?.id && !currentUser?.employee_id && !userFullName) {
        setWhatsappClientsUnreadCount(0);
        return;
      }

      // Fetch all unread WhatsApp messages with lead_id, contact_id, and legacy_id
      const { data: whatsappMessages, error: whatsappError } = await supabase
        .from('whatsapp_messages')
        .select('id, lead_id, contact_id, legacy_id')
        .eq('direction', 'in')
        .or('is_read.is.null,is_read.eq.false');

      if (whatsappError) {
        console.error('Error fetching WhatsApp clients unread count:', whatsappError);
        setWhatsappClientsUnreadCount(0);
        return;
      }

      if (!whatsappMessages || whatsappMessages.length === 0) {
        setWhatsappClientsUnreadCount(0);
        return;
      }

      // Get unique lead IDs and contact IDs
      const uniqueLeadIds = new Set<string>();
      const uniqueContactIds = new Set<number>();
      const uniqueLegacyIds = new Set<number>();

      whatsappMessages.forEach((msg: any) => {
        if (msg.lead_id) {
          uniqueLeadIds.add(String(msg.lead_id));
        }
        if (msg.contact_id) {
          uniqueContactIds.add(Number(msg.contact_id));
        }
        if (msg.legacy_id) {
          uniqueLegacyIds.add(Number(msg.legacy_id));
        }
      });

      // Also fetch legacy interactions (for legacy leads with WhatsApp messages)
      const { data: legacyInteractions, error: legacyError } = await supabase
        .from('leads_leadinteractions')
        .select('lead_id')
        .eq('kind', 'w')
        .not('lead_id', 'is', null);

      if (!legacyError && legacyInteractions) {
        legacyInteractions.forEach((interaction: any) => {
          if (interaction.lead_id) {
            uniqueLegacyIds.add(Number(interaction.lead_id));
          }
        });
      }

      const employeeId = currentUserEmployee?.id || currentUser?.employee_id;
      const fullName = userFullName?.trim().toLowerCase();

      let matchingLeadIds = new Set<string>();
      let matchingLegacyIds = new Set<number>();
      let matchingContactIds = new Set<number>();

      // Fetch new leads and filter by role
      if (uniqueLeadIds.size > 0) {
        const { data: newLeads, error: newLeadsError } = await supabase
          .from('leads')
          .select('id, closer, scheduler, handler, manager, helper, expert, case_handler_id')
          .in('id', Array.from(uniqueLeadIds));

        if (!newLeadsError && newLeads) {
          newLeads.forEach((lead: any) => {
            // Check text fields (scheduler, closer, handler are saved as display names)
            if (fullName) {
              const textFields = [lead.closer, lead.scheduler, lead.handler];
              if (textFields.some(field => field && typeof field === 'string' && field.trim().toLowerCase() === fullName)) {
                matchingLeadIds.add(String(lead.id));
                return;
              }
            }

            // Check numeric fields (manager, helper, expert, case_handler_id are saved as employee IDs)
            if (employeeId) {
              const numericFields = [lead.manager, lead.helper, lead.expert, lead.case_handler_id];
              if (numericFields.some(field => field !== null && field !== undefined && String(field) === String(employeeId))) {
                matchingLeadIds.add(String(lead.id));
              }
            }
          });
        }
      }

      // Fetch legacy leads and filter by role
      if (uniqueLegacyIds.size > 0) {
        const { data: legacyLeads, error: legacyLeadsError } = await supabase
          .from('leads_lead')
          .select('id, closer_id, meeting_scheduler_id, meeting_manager_id, meeting_lawyer_id, expert_id, case_handler_id')
          .in('id', Array.from(uniqueLegacyIds));

        if (!legacyLeadsError && legacyLeads && employeeId) {
          legacyLeads.forEach((lead: any) => {
            const numericFields = [lead.closer_id, lead.meeting_scheduler_id, lead.meeting_manager_id, lead.meeting_lawyer_id, lead.expert_id, lead.case_handler_id];
            if (numericFields.some(field => field !== null && field !== undefined && String(field) === String(employeeId))) {
              matchingLegacyIds.add(Number(lead.id));
            }
          });
        }
      }

      // Fetch contacts and check their associated leads
      if (uniqueContactIds.size > 0) {
        // Fetch contact-to-lead relationships
        const { data: relationships, error: relationshipsError } = await supabase
          .from('lead_leadcontact')
          .select('contact_id, newlead_id, lead_id')
          .in('contact_id', Array.from(uniqueContactIds));

        if (!relationshipsError && relationships && relationships.length > 0) {
          const contactToNewLeadMap = new Map<number, string>();
          const contactToLegacyLeadMap = new Map<number, number>();

          relationships.forEach((rel: any) => {
            if (rel.contact_id) {
              if (rel.newlead_id) {
                contactToNewLeadMap.set(Number(rel.contact_id), String(rel.newlead_id));
              }
              if (rel.lead_id) {
                contactToLegacyLeadMap.set(Number(rel.contact_id), Number(rel.lead_id));
              }
            }
          });

          // Get all unique leads associated with contacts
          const newLeadIdsForContacts = Array.from(new Set(Array.from(contactToNewLeadMap.values())));
          const legacyLeadIdsForContacts = Array.from(new Set(Array.from(contactToLegacyLeadMap.values())));

          // Fetch and filter new leads for contacts
          if (newLeadIdsForContacts.length > 0) {
            const { data: newLeadsForContacts, error: newLeadsError } = await supabase
              .from('leads')
              .select('id, closer, scheduler, handler, manager, helper, expert, case_handler_id')
              .in('id', newLeadIdsForContacts);

            if (!newLeadsError && newLeadsForContacts) {
              const matchingNewLeadIds = new Set<string>();
              newLeadsForContacts.forEach((lead: any) => {
                // Check text fields
                if (fullName) {
                  const textFields = [lead.closer, lead.scheduler, lead.handler];
                  if (textFields.some(field => field && typeof field === 'string' && field.trim().toLowerCase() === fullName)) {
                    matchingNewLeadIds.add(String(lead.id));
                    return;
                  }
                }

                // Check numeric fields
                if (employeeId) {
                  const numericFields = [lead.manager, lead.helper, lead.expert, lead.case_handler_id];
                  if (numericFields.some(field => field !== null && field !== undefined && String(field) === String(employeeId))) {
                    matchingNewLeadIds.add(String(lead.id));
                  }
                }
              });

              // Map matching leads back to contacts
              contactToNewLeadMap.forEach((leadId, contactId) => {
                if (matchingNewLeadIds.has(leadId)) {
                  matchingContactIds.add(contactId);
                }
              });
            }
          }

          // Fetch and filter legacy leads for contacts
          if (legacyLeadIdsForContacts.length > 0) {
            const { data: legacyLeadsForContacts, error: legacyLeadsError } = await supabase
              .from('leads_lead')
              .select('id, closer_id, meeting_scheduler_id, meeting_manager_id, meeting_lawyer_id, expert_id, case_handler_id')
              .in('id', legacyLeadIdsForContacts);

            if (!legacyLeadsError && legacyLeadsForContacts && employeeId) {
              const matchingLegacyLeadIds = new Set<number>();
              legacyLeadsForContacts.forEach((lead: any) => {
                const numericFields = [lead.closer_id, lead.meeting_scheduler_id, lead.meeting_manager_id, lead.meeting_lawyer_id, lead.expert_id, lead.case_handler_id];
                if (numericFields.some(field => field !== null && field !== undefined && String(field) === String(employeeId))) {
                  matchingLegacyLeadIds.add(Number(lead.id));
                }
              });

              // Map matching leads back to contacts
              contactToLegacyLeadMap.forEach((leadId, contactId) => {
                if (matchingLegacyLeadIds.has(leadId)) {
                  matchingContactIds.add(contactId);
                }
              });
            }
          }

          // Also check legacy_id directly from messages (more accurate)
          whatsappMessages.forEach((msg: any) => {
            if (msg.contact_id && msg.legacy_id && matchingLegacyIds.has(Number(msg.legacy_id))) {
              matchingContactIds.add(Number(msg.contact_id));
            }
          });
        }
      }

      // Count messages that match user's roles
      const count = whatsappMessages.filter((msg: any) => {
        // Check if message is from a matching lead (new)
        if (msg.lead_id && matchingLeadIds.has(String(msg.lead_id))) {
          return true;
        }

        // Check if message is from a matching legacy lead
        if (msg.legacy_id && matchingLegacyIds.has(Number(msg.legacy_id))) {
          return true;
        }

        // Check if message is from a matching contact
        if (msg.contact_id && matchingContactIds.has(Number(msg.contact_id))) {
          return true;
        }

        return false;
      }).length;

      setWhatsappClientsUnreadCount(count);
    } catch (error) {
      console.error('Error in fetchWhatsappClientsUnreadCount:', error);
      setWhatsappClientsUnreadCount(0);
    }
  }, [isSuperUser, currentUserEmployee, currentUser, userFullName]);

  const fetchEmailUnreadCount = useCallback(async () => {
    try {
      // Blocked sender emails to ignore (same as EmailThreadLeadPage.tsx)
      const BLOCKED_SENDER_EMAILS = new Set([
        'wordpress@german-and-austrian-citizenship.lawoffice.org.il',
        'wordpress@insolvency-law.com',
        'wordpress@citizenship-for-children.usa-immigration.lawyer',
        'lawoffic@israel160.jetserver.net',
        'list@wordfence.com',
        'wordpress@usa-immigration.lawyer',
        'wordpress@heritage-based-european-citizenship.lawoffice.org.il',
        'wordpress@heritage-based-european-citizenship-heb.lawoffice.org.il',
        'no-reply@lawzana.com',
        'support@lawfirms1.com',
        'no-reply@zoom.us',
        'info@israel-properties.com',
        'notifications@invoice4u.co.il',
        'isetbeforeyou@yahoo.com',
        'no-reply@support.microsoft.com',
        'ivy@pipe.hnssd.com',
        'no-reply@mail.instagram.com',
        'no_reply@email.apple.com',
        'noreplay@maskyoo.co.il',
        'email@german-and-austrian-citizenship.lawoffice.org.il',
        'noreply@mobilepunch.com',
        'notification@facebookmail.com',
        'news@events.imhbusiness.com',
      ]);

      const BLOCKED_DOMAINS: string[] = [
        'lawoffice.org.il',
      ];

      const isEmailBlocked = (email: string): boolean => {
        const normalizedEmail = email.toLowerCase().trim();
        if (!normalizedEmail) return true;

        if (BLOCKED_SENDER_EMAILS.has(normalizedEmail)) {
          return true;
        }

        const emailDomain = normalizedEmail.split('@')[1];
        if (emailDomain && BLOCKED_DOMAINS.some(domain => emailDomain === domain || emailDomain.endsWith(`.${domain}`))) {
          return true;
        }

        return false;
      };

      // Fetch unread incoming emails with client_id, legacy_id, and sender_email
      const { data: emailsData, error: emailsError } = await supabase
        .from('emails')
        .select('id, client_id, legacy_id, sender_email')
        .eq('direction', 'incoming')
        .or('is_read.is.null,is_read.eq.false');

      if (emailsError) {
        console.error('Error fetching email unread count:', emailsError);
        setEmailUnreadCount(0);
        return;
      }

      if (!emailsData || emailsData.length === 0) {
        setEmailUnreadCount(0);
        return;
      }

      // Filter out blocked sender emails and domains
      const filteredEmailsData = emailsData.filter((email: any) => {
        const senderEmail = email.sender_email?.toLowerCase() || '';
        return senderEmail && !isEmailBlocked(senderEmail);
      });

      if (filteredEmailsData.length === 0) {
        setEmailUnreadCount(0);
        return;
      }

      // If we don't have user data, count all filtered emails
      if (!currentUserEmployee?.id && !currentUser?.employee_id && !userFullName) {
        setEmailUnreadCount(filteredEmailsData.length);
        return;
      }

      // Get unique client IDs (new leads) and legacy IDs from filtered emails
      const uniqueClientIds = new Set<string>();
      const uniqueLegacyIds = new Set<number>();

      filteredEmailsData.forEach((email: any) => {
        if (email.client_id) {
          uniqueClientIds.add(String(email.client_id));
        }
        if (email.legacy_id) {
          uniqueLegacyIds.add(Number(email.legacy_id));
        }
      });

      // Fetch leads with role fields
      const newLeadIds = Array.from(uniqueClientIds);
      const legacyLeadIds = Array.from(uniqueLegacyIds).filter(id => !isNaN(id));

      let matchingLeadIds = new Set<string>();
      let matchingLegacyIds = new Set<number>();

      // Fetch new leads
      if (newLeadIds.length > 0) {
        const { data: newLeads, error: newLeadsError } = await supabase
          .from('leads')
          .select('id, closer, scheduler, handler, meeting_manager_id, meeting_lawyer_id, expert_id, case_handler_id')
          .in('id', newLeadIds);

        if (!newLeadsError && newLeads) {
          const employeeId = currentUserEmployee?.id || currentUser?.employee_id;
          const fullName = userFullName?.trim().toLowerCase();

          newLeads.forEach((lead: any) => {
            // Check text fields (scheduler, closer, handler are saved as display names)
            if (fullName) {
              const textFields = [lead.closer, lead.scheduler, lead.handler];
              if (textFields.some(field => field && typeof field === 'string' && field.trim().toLowerCase() === fullName)) {
                matchingLeadIds.add(String(lead.id));
                return;
              }
            }

            // Check numeric fields (manager, expert, helper are saved as employee IDs)
            // Also check case_handler_id for handler role
            if (employeeId) {
              const numericFields = [lead.meeting_manager_id, lead.meeting_lawyer_id, lead.expert_id, lead.case_handler_id];
              if (numericFields.some(field => field && String(field) === String(employeeId))) {
                matchingLeadIds.add(String(lead.id));
              }
            }
          });
        }
      }

      // Fetch legacy leads
      if (legacyLeadIds.length > 0) {
        const { data: legacyLeads, error: legacyLeadsError } = await supabase
          .from('leads_lead')
          .select('id, closer_id, meeting_scheduler_id, meeting_manager_id, meeting_lawyer_id, expert_id, case_handler_id')
          .in('id', legacyLeadIds);

        if (!legacyLeadsError && legacyLeads) {
          const employeeId = currentUserEmployee?.id || currentUser?.employee_id;

          if (employeeId) {
            legacyLeads.forEach((lead: any) => {
              const numericFields = [lead.closer_id, lead.meeting_scheduler_id, lead.meeting_manager_id, lead.meeting_lawyer_id, lead.expert_id, lead.case_handler_id];
              if (numericFields.some(field => field && String(field) === String(employeeId))) {
                matchingLegacyIds.add(Number(lead.id));
              }
            });
          }
        }
      }

      // Count emails that belong to matching leads (using filtered emails)
      const count = filteredEmailsData.filter((email: any) => {
        if (email.client_id && matchingLeadIds.has(String(email.client_id))) {
          return true;
        }
        if (email.legacy_id && matchingLegacyIds.has(Number(email.legacy_id))) {
          return true;
        }
        return false;
      }).length;

      setEmailUnreadCount(count);
    } catch (error) {
      console.error('Unexpected error fetching email unread count:', error);
      setEmailUnreadCount(0);
    }
  }, [currentUserEmployee, currentUser, userFullName]);

  const fetchEmailLeadMessages = useCallback(async () => {
    try {
      // Blocked sender emails to ignore (same as EmailThreadLeadPage.tsx)
      const BLOCKED_SENDER_EMAILS = new Set([
        'wordpress@german-and-austrian-citizenship.lawoffice.org.il',
        'wordpress@insolvency-law.com',
        'wordpress@citizenship-for-children.usa-immigration.lawyer',
        'lawoffic@israel160.jetserver.net',
        'list@wordfence.com',
        'wordpress@usa-immigration.lawyer',
        'wordpress@heritage-based-european-citizenship.lawoffice.org.il',
        'wordpress@heritage-based-european-citizenship-heb.lawoffice.org.il',
        'no-reply@lawzana.com',
        'support@lawfirms1.com',
        'no-reply@zoom.us',
        'info@israel-properties.com',
        'notifications@invoice4u.co.il',
        'isetbeforeyou@yahoo.com',
        'no-reply@support.microsoft.com',
        'ivy@pipe.hnssd.com',
        'no-reply@mail.instagram.com',
        'no_reply@email.apple.com',
        'noreplay@maskyoo.co.il',
        'email@german-and-austrian-citizenship.lawoffice.org.il',
        'noreply@mobilepunch.com',
        'notification@facebookmail.com',
        'news@events.imhbusiness.com',
      ]);

      const BLOCKED_DOMAINS: string[] = [
        'lawoffice.org.il',
      ];

      const isEmailBlocked = (email: string): boolean => {
        const normalizedEmail = email.toLowerCase().trim();
        if (!normalizedEmail) return true;

        if (BLOCKED_SENDER_EMAILS.has(normalizedEmail)) {
          return true;
        }

        const emailDomain = normalizedEmail.split('@')[1];
        if (emailDomain && BLOCKED_DOMAINS.some(domain => emailDomain === domain || emailDomain.endsWith(`.${domain}`))) {
          return true;
        }

        return false;
      };

      const { data, error } = await supabase
        .from('emails')
        .select('id, sender_name, sender_email, subject, body_preview, body_html, sent_at, recipient_list')
        .eq('direction', 'incoming')
        .or('is_read.is.null,is_read.eq.false')
        .ilike('recipient_list', '%office@lawoffice.org.il%')
        .order('sent_at', { ascending: false })
        .limit(50);

      if (error) {
        console.error('Error fetching email lead messages:', error);
        setEmailLeadMessages([]);
        setEmailLeadUnreadCount(0);
        return;
      }

      // Filter out blocked sender emails and domains
      const filteredData = (data || []).filter((email: any) => {
        const senderEmail = email.sender_email?.toLowerCase() || '';
        return senderEmail && !isEmailBlocked(senderEmail);
      });

      const groupedMap = new Map<string, {
        id: string;
        sender_email: string | null;
        sender_name: string | null;
        latest_subject: string;
        latest_preview: string;
        latest_sent_at: string;
        message_count: number;
        message_ids: number[];
      }>();

      filteredData.forEach(email => {
        const key = (email.sender_email || `unknown-${email.id}`).toLowerCase();
        const previewText = email.body_preview || email.body_html || '';
        if (!groupedMap.has(key)) {
          groupedMap.set(key, {
            id: key,
            sender_email: email.sender_email,
            sender_name: email.sender_name,
            latest_subject: email.subject || 'No Subject',
            latest_preview: previewText,
            latest_sent_at: email.sent_at,
            message_count: 1,
            message_ids: [email.id],
          });
        } else {
          const entry = groupedMap.get(key)!;
          entry.message_count += 1;
          entry.message_ids.push(email.id);
          if (new Date(email.sent_at) > new Date(entry.latest_sent_at)) {
            entry.latest_subject = email.subject || 'No Subject';
            entry.latest_preview = previewText;
            entry.latest_sent_at = email.sent_at;
          }
        }
      });

      const grouped = Array.from(groupedMap.values()).sort(
        (a, b) => new Date(b.latest_sent_at).getTime() - new Date(a.latest_sent_at).getTime()
      );
      setEmailLeadMessages(grouped);
      setEmailLeadUnreadCount(grouped.length);
    } catch (error) {
      console.error('Unexpected error fetching email lead messages:', error);
      setEmailLeadMessages([]);
      setEmailLeadUnreadCount(0);
    }
  }, []);


  const ensureStageIds = async () => {
    if (stageIdsReadyRef.current) {
      return;
    }

    if (!resolvingStageIdsRef.current) {
      resolvingStageIdsRef.current = (async () => {
        try {
          const stageMap = await fetchStageNames();
          const entries = Object.entries(stageMap).filter(([, name]) => !!name);

          const createdMatches = entries
            .filter(([, name]) => areStagesEquivalent(name, 'Created'))
            .map(([id]) => Number(id))
            .filter(id => !Number.isNaN(id));

          const schedulerMatches = entries
            .filter(([, name]) => areStagesEquivalent(name, 'Scheduler Assigned'))
            .map(([id]) => Number(id))
            .filter(id => !Number.isNaN(id));

          const resolvedCreated = createdMatches.length ? createdMatches : [];
          const resolvedScheduler = schedulerMatches.length ? schedulerMatches : [];

          createdStageIdsRef.current = Array.from(new Set([...resolvedCreated, 0, 11]));
          schedulerStageIdsRef.current = Array.from(new Set([...resolvedScheduler, 10]));
        } catch (error) {
          console.error('Error resolving stage IDs for new leads count:', error);
          createdStageIdsRef.current = [0, 11];
          schedulerStageIdsRef.current = [10];
        } finally {
          stageIdsReadyRef.current = true;
          resolvingStageIdsRef.current = null;
        }
      })();
    }

    await resolvingStageIdsRef.current;
  };

  // Fetch new leads count
  const fetchNewLeadsCount = useCallback(async () => {
    try {
      await ensureStageIds();

      // Match NewCasesPage exactly: default to [0] for created, [10] for scheduler
      const createdFilters = createdStageIdsRef.current.length ? createdStageIdsRef.current : [0];
      const schedulerFilters = schedulerStageIdsRef.current.length ? schedulerStageIdsRef.current : [10];

      // Get all employee display names and IDs to exclude from scheduler field
      // ALWAYS fetch employees to ensure we have the latest data (matching NewCasesPage logic)
      // This is critical for accurate filtering
      let employeesToCheck = allEmployees;

      // Always fetch fresh employee data to match NewCasesPage behavior
      try {
        const { data: employeesData, error: employeesError } = await supabase
          .from('users')
          .select(`
            id,
            full_name,
            email,
            employee_id,
            is_active,
            tenants_employee!employee_id(
              id,
              display_name
            )
          `)
          .not('employee_id', 'is', null)
          .eq('is_active', true);

        if (!employeesError && employeesData) {
          const processedEmployees = (employeesData || [])
            .filter(user => user.tenants_employee && user.email)
            .map(user => {
              const employee = user.tenants_employee as any;
              return {
                id: employee.id,
                display_name: employee.display_name
              };
            });

          const uniqueEmployeesMap = new Map();
          processedEmployees.forEach(emp => {
            if (!uniqueEmployeesMap.has(emp.id)) {
              uniqueEmployeesMap.set(emp.id, emp);
            }
          });
          employeesToCheck = Array.from(uniqueEmployeesMap.values());
        }
      } catch (error) {
        console.error('Error fetching employees for count:', error);
      }

      const employeeDisplayNames = employeesToCheck.map(emp => emp.display_name).filter(Boolean);
      const employeeIds = employeesToCheck.map(emp => emp.id.toString()).filter(Boolean);

      // "Today" range in local time, expressed as UTC timestamps for Postgres.
      const now = new Date();
      const startOfTodayLocal = new Date(now);
      startOfTodayLocal.setHours(0, 0, 0, 0);
      const endOfTodayLocal = new Date(now);
      endOfTodayLocal.setHours(23, 59, 59, 999);
      const startIso = startOfTodayLocal.toISOString();
      const endIso = endOfTodayLocal.toISOString();

      // Base query builder that excludes inactive leads
      const buildBaseQuery = (query: any) => {
        return query
          .neq('stage', 91) // Exclude inactive/dropped leads
          .is('unactivated_at', null) // Exclude leads that have been unactivated
          .gte('created_at', startIso)
          .lte('created_at', endIso);
      };

      // Fetch all leads for the stages, then filter client-side (matching NewCasesPage logic)
      // This ensures we don't miss any leads with no scheduler
      const [createdResult, schedulerResult] = await Promise.all([
        buildBaseQuery(
          supabase
            .from('leads')
            .select('id, scheduler') // IMPORTANT: Include scheduler field to filter by it
            .in('stage', createdFilters)
        ),
        buildBaseQuery(
          supabase
            .from('leads')
            .select('id, scheduler')
            .in('stage', schedulerFilters)
        ),
      ]);

      if (createdResult.error) {
        console.error('Error fetching created leads for header count:', createdResult.error);
        // Don't throw, just log and continue with empty data
      }
      if (schedulerResult.error) {
        console.error('Error fetching scheduler leads for header count:', schedulerResult.error);
        // Don't throw, just log and continue with empty data
      }

      // Combine all leads first (matching NewCasesPage logic)
      let allLeads = [
        ...(createdResult.data || []),
        ...(schedulerResult.data || []),
      ];

      // Filter to only show leads with no scheduler assigned
      // This matches exactly how NewCasesPage.tsx handles unassigned scheduler (null, '---', empty, or 'not assigned')
      // This matches the logic in RolesTab.tsx where unassigned scheduler is saved as null
      allLeads = allLeads.filter(lead => {
        const scheduler = lead.scheduler;
        // Keep leads with no scheduler: null, undefined, empty string, '---', or 'not assigned'
        if (scheduler === null || scheduler === undefined) {
          return true;
        }
        // Handle string values
        if (typeof scheduler === 'string') {
          const trimmed = scheduler.trim();
          return trimmed === '' || trimmed === '---' || trimmed.toLowerCase() === 'not assigned';
        }
        // Exclude any lead that has a non-null, non-empty scheduler value
        return false;
      });

      // Remove duplicates (matching NewCasesPage logic)
      const uniqueLeads = allLeads.filter((lead, index, self) =>
        index === self.findIndex(l => l.id === lead.id)
      );

      const uniqueIds = new Set(uniqueLeads.map(lead => lead.id));
      setNewLeadsCount(uniqueIds.size);
    } catch (error) {
      console.error('Error fetching new leads count:', error);
      setNewLeadsCount(0);
    }
  }, [allEmployees]);

  // Fetch RMQ messages and WhatsApp leads messages when user is loaded
  useEffect(() => {
    if (currentUser) {
      fetchRmqMessages();
      if (isSuperUser) {
        fetchWhatsappLeadsMessages();
        fetchEmailLeadMessages();
        fetchEmailUnreadCount();
      }
      fetchWhatsappClientsUnreadCount();
      // Refresh messages every 60 seconds
      const interval = setInterval(() => {
        fetchRmqMessages();
        if (isSuperUser) {
          fetchWhatsappLeadsMessages();
          fetchEmailLeadMessages();
          fetchEmailUnreadCount();
        }
        fetchWhatsappClientsUnreadCount();
      }, 60000);
      return () => clearInterval(interval);
    }
  }, [currentUser, isSuperUser, fetchEmailUnreadCount, fetchEmailLeadMessages, fetchWhatsappClientsUnreadCount]);

  // Send push notifications when new messages arrive
  // Only trigger on count changes, not on message array reference changes
  // The hook internally tracks message IDs to prevent duplicates
  // Use a ref to debounce rapid count changes
  const lastNotificationCheckRef = useRef<{ whatsapp: number; rmq: number }>({ whatsapp: 0, rmq: 0 });

  useEffect(() => {
    if (currentUser) {
      // Only call if counts actually changed (not just re-render)
      const whatsappChanged = whatsappLeadsUnreadCount !== lastNotificationCheckRef.current.whatsapp;
      const rmqChanged = rmqUnreadCount !== lastNotificationCheckRef.current.rmq;

      if (whatsappChanged || rmqChanged) {
        sendNotificationForNewMessage(
          unreadCount,
          whatsappLeadsUnreadCount,
          rmqUnreadCount,
          whatsappLeadsMessages,
          rmqMessages
        );

        // Update refs
        lastNotificationCheckRef.current = {
          whatsapp: whatsappLeadsUnreadCount,
          rmq: rmqUnreadCount
        };
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadCount, whatsappLeadsUnreadCount, rmqUnreadCount, currentUser, sendNotificationForNewMessage]);
  // Note: whatsappLeadsMessages and rmqMessages are intentionally excluded from deps
  // to prevent re-triggering on array reference changes. The hook tracks message IDs internally.

  useEffect(() => {
    if (!currentUser) {
      fetchEmailLeadMessages();
      fetchEmailUnreadCount();
    }
  }, [currentUser, fetchEmailLeadMessages, fetchEmailUnreadCount]);

  // Re-fetch email unread count when user employee data changes (for "My Contacts" filtering)
  useEffect(() => {
    if (currentUser || currentUserEmployee || userFullName) {
      fetchEmailUnreadCount();
    }
  }, [currentUserEmployee, userFullName, fetchEmailUnreadCount]);

  // Fetch new leads count when component mounts and every 30 seconds
  // Also refetch when employees are loaded (needed for filtering)
  // IMPORTANT: Wait for employees to be loaded before calculating count
  useEffect(() => {
    if (!supabaseSessionReady) return;
    // Only fetch if we have employees loaded OR if we're still waiting (to avoid blocking)
    // The fetchNewLeadsCount function will fetch employees if needed, but it's better to wait
    if (allEmployees.length > 0 || currentUser) {
      fetchNewLeadsCount();
    }
    const interval = setInterval(() => {
      if (allEmployees.length > 0 || currentUser) {
        fetchNewLeadsCount();
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [allEmployees, fetchNewLeadsCount, currentUser, supabaseSessionReady, sessionRefreshNonce]);

  useEffect(() => {
    if (!isSearchActive || !searchContainerRef.current) return;
    const measure = () => {
      if (!searchContainerRef.current) return;
      const rect = searchContainerRef.current.getBoundingClientRect();
      // Portal uses position:fixed — top/left must be viewport coords (getBoundingClientRect), not + scrollY/X
      if (isMobile) {
        const margin = 12;
        setSearchDropdownStyle({ top: rect.bottom, left: margin, width: window.innerWidth - margin * 2 });
      } else {
        setSearchDropdownStyle({ top: rect.bottom, left: rect.left, width: rect.width });
      }
    };
    measure();
    // Re-measure after search bar expand animation (700ms) to get full width
    const t = setTimeout(measure, 750);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [isSearchActive, showFilterDropdown, activeSearchResults.length, searchValue, isMobile, isSearchAnimationDone]);

  // Animation effect for searchbar open/close (box appears early in expand)
  useEffect(() => {
    let timeout: NodeJS.Timeout;
    if (isSearchActive) {
      timeout = setTimeout(() => setIsSearchAnimationDone(true), 500);
    } else {
      setIsSearchAnimationDone(false);
    }
    return () => clearTimeout(timeout);
  }, [isSearchActive]);

  // On mobile: when search bar opens, focus the input so the keyboard opens without tapping again (delayed until bar has expanded)
  useEffect(() => {
    if (!isSearchActive || !isMobile) return;
    const t1 = setTimeout(() => {
      searchInputRef.current?.focus();
    }, 450);
    const t2 = setTimeout(() => {
      searchInputRef.current?.focus();
    }, 750);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [isSearchActive, isMobile]);

  const handleSearchFocus = () => {
    setIsSearchActive(true);
    searchInputRef.current?.focus();
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchValue(e.target.value);
    if (hasAppliedFilters) {
      setHasAppliedFilters(false);
      setSearchResults([]);
    }
  };

  const handleSearchResultClick = (lead: CombinedLead) => {
    addRecentLead({
      id: lead.lead_type === 'legacy' ? String(lead.id).replace(/^legacy_/, '') : String(lead.lead_number || lead.id),
      name: lead.contactName || lead.name || '',
      lead_number: lead.lead_number || String(lead.id),
      lead_type: lead.lead_type,
    });
    const identity = leadViewIdentityFromCombinedLead(lead);
    if (identity) {
      void recordEmployeeLeadView(identity);
    }
    navigateLeadContactSearchResult(lead, navigate);
    closeSearchBar();
  };

  const handleClearSearch = () => {
    if (searchHoverCloseTimeoutRef.current != null) {
      clearTimeout(searchHoverCloseTimeoutRef.current);
      searchHoverCloseTimeoutRef.current = null;
    }
    setSearchValue('');
    setSearchResults([]);
    setIsSearchActive(false);
    setIsSearchOpen(false);
    setHasAppliedFilters(false);
    searchInputRef.current?.blur();
  };

  const closeSearchBar = () => {
    if (searchHoverCloseTimeoutRef.current != null) {
      clearTimeout(searchHoverCloseTimeoutRef.current);
      searchHoverCloseTimeoutRef.current = null;
    }
    setIsSearchActive(false);
    setIsSearchOpen(false);
    setSearchResults([]);
    setSearchValue('');
    setHasAppliedFilters(false);
    setShowFilterDropdown(false);
    searchInputRef.current?.blur();
  };

  const closeFilterDropdown = () => {
    setShowFilterDropdown(false);
  };

  /** Shared search results UI — used in desktop dropdown and inline on mobile overlay */
  const renderHeaderSearchDropdownBody = () => (
    <LeadContactSearchResults
      results={activeSearchResults}
      loading={activeSearchLoading}
      query={searchValue}
      onSelect={handleSearchResultClick}
    />
  );

  const clearSearchHoverCloseTimer = useCallback(() => {
    if (searchHoverCloseTimeoutRef.current != null) {
      clearTimeout(searchHoverCloseTimeoutRef.current);
      searchHoverCloseTimeoutRef.current = null;
    }
  }, []);

  const scheduleSearchHoverClose = useCallback(() => {
    clearSearchHoverCloseTimer();
    // Only auto-close on hover-away when idle (no query, filters, or in-flight search)
    if (
      !showFilterDropdown &&
      !searchValue.trim() &&
      activeSearchResults.length === 0 &&
      !activeSearchLoading &&
      !hasAppliedFilters
    ) {
      searchHoverCloseTimeoutRef.current = setTimeout(() => {
        searchHoverCloseTimeoutRef.current = null;
        if (!isMouseOverSearchRef.current) {
          setIsSearchActive(false);
          setIsSearchOpen(false);
        }
      }, 280);
    }
  }, [
    clearSearchHoverCloseTimer,
    showFilterDropdown,
    searchValue,
    activeSearchResults.length,
    activeSearchLoading,
    hasAppliedFilters,
  ]);

  const handleDesktopSearchMouseEnter = useCallback(() => {
    isMouseOverSearchRef.current = true;
    clearSearchHoverCloseTimer();
    setIsSearchActive(true);
    setTimeout(() => searchInputRef.current?.focus(), 100);
  }, [clearSearchHoverCloseTimer]);

  const handleDesktopSearchMouseLeave = useCallback(() => {
    isMouseOverSearchRef.current = false;
    scheduleSearchHoverClose();
  }, [scheduleSearchHoverClose]);

  const handleDesktopSearchDropdownMouseEnter = useCallback(() => {
    isMouseOverSearchRef.current = true;
    clearSearchHoverCloseTimer();
  }, [clearSearchHoverCloseTimer]);

  const handleDesktopSearchDropdownMouseLeave = useCallback(() => {
    isMouseOverSearchRef.current = false;
    scheduleSearchHoverClose();
  }, [scheduleSearchHoverClose]);

  useEffect(() => {
    return () => clearSearchHoverCloseTimer();
  }, [clearSearchHoverCloseTimer]);

  const handleNotificationClick = () => {
    const newShowState = !showNotifications;
    setShowNotifications(newShowState);

    if (newShowState) {
      const anchor =
        (isMobile ? profileButtonRefMobile.current : notificationsButtonRef.current) ??
        notificationsButtonRef.current;
      const rect = anchor?.getBoundingClientRect();
      if (rect) {
        // Keep the dropdown within the viewport, opening below the bell.
        const width = isMobile ? 288 : 320; // w-72 / w-80
        const gutter = 12;
        const left = Math.max(
          gutter,
          Math.min(rect.right - width, window.innerWidth - width - gutter)
        );
        setNotificationsDropdownPosition({ top: rect.bottom + 8, left, width });
      }
    }

    // Fetch RMQ messages and WhatsApp leads messages when opening notifications
    if (newShowState && currentUser) {
      fetchRmqMessages();
      if (isSuperUser) {
        fetchWhatsappLeadsMessages();
        fetchEmailLeadMessages();
        fetchEmailUnreadCount();
      }
      fetchWhatsappClientsUnreadCount();
    }
    if (newShowState && (currentUser || currentUserEmployee)) {
      fetchAssignmentNotifications();
    }
  };

  useEffect(() => {
    if (!showNotifications) return;

    const updatePosition = () => {
      const anchor =
        (isMobile ? profileButtonRefMobile.current : notificationsButtonRef.current) ??
        notificationsButtonRef.current;
      const rect = anchor?.getBoundingClientRect();
      if (!rect) return;
      const width = isMobile ? 288 : 320;
      const gutter = 12;
      const left = Math.max(
        gutter,
        Math.min(rect.right - width, window.innerWidth - width - gutter)
      );
      setNotificationsDropdownPosition({ top: rect.bottom + 8, left, width });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [showNotifications, isMobile]);

  const markAllAsRead = async () => {
    if (!currentUser) {
      if (assignmentNotifications.length > 0) {
        rememberAssignments(assignmentNotifications.map(notification => notification.key));
        setAssignmentNotifications([]);
      }
      return;
    }

    try {
      // Get all conversations where the user participates
      const { data: userConversations, error: convError } = await supabase
        .from('conversation_participants')
        .select('conversation_id')
        .eq('user_id', currentUser.id)
        .eq('is_active', true);

      if (convError) {
        console.error('Error fetching user conversations for mark all as read:', convError);
        return;
      }

      const conversationIds = userConversations?.map(c => c.conversation_id) || [];

      // Mark all conversations as read by updating last_read_at to current timestamp
      const currentTime = new Date().toISOString();

      for (const convId of conversationIds) {
        await supabase.rpc('mark_conversation_as_read', {
          conv_id: convId,
          user_uuid: currentUser.id
        });
      }

      // Clear all RMQ messages from notifications
      setRmqMessages([]);
      setRmqUnreadCount(0);

      // Mark all WhatsApp leads messages as read - Only for superusers
      if (isSuperUser) {
        const whatsappMessageIds = whatsappLeadsMessages.map(m => m.id);
        if (whatsappMessageIds.length > 0) {
          const { error: whatsappError } = await supabase
            .from('whatsapp_messages')
            .update({
              is_read: true,
              read_at: new Date().toISOString(),
              read_by: currentUser.id
            })
            .in('id', whatsappMessageIds);

          if (whatsappError) {
            console.error('Error marking WhatsApp messages as read:', whatsappError);
          }
        }

        // Clear WhatsApp leads messages from notifications
        setWhatsappLeadsMessages([]);
        setWhatsappLeadsUnreadCount(0);

        // Mark email lead messages as read
        const emailIds = emailLeadMessages.flatMap(message => message.message_ids);
        if (emailIds.length > 0) {
          const { error: emailError } = await supabase
            .from('emails')
            .update({
              is_read: true,
              read_at: new Date().toISOString(),
              read_by: currentUser.id
            })
            .in('id', emailIds);

          if (emailError) {
            console.error('Error marking email lead messages as read:', emailError);
          }
        }
        setEmailLeadMessages([]);
        setEmailLeadUnreadCount(0);
        fetchEmailUnreadCount();
      }
      if (assignmentNotifications.length > 0) {
        rememberAssignments(assignmentNotifications.map(notification => notification.key));
        setAssignmentNotifications([]);
      }

    } catch (error) {
      console.error('Error marking all conversations as read:', error);
    }
  };

  const handleAIClick = () => {
    if (typeof onOpenAIChat === 'function') {
      onOpenAIChat();
    }
  };

  const handleMicrosoftSignIn = async () => {
    if (!instance || !isMsalInitialized) {
      toast.error('Sign-in is not ready yet. Please try again in a moment.');
      return;
    }

    // If user is already signed in, show sign out confirmation
    if (userAccount) {
      setShowSignOutModal(true);
      return;
    }

    setIsMsalLoading(true);

    // Dispatch custom event to signal sign-in start
    window.dispatchEvent(new CustomEvent('msal:signInStart'));

    try {
      const isMobile = /iPhone|iPad|iPod|Android|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      if (isMobile) {
        await instance.loginRedirect(loginRequest);
      } else {
        const loginResponse = await instance.loginPopup(loginRequest);
        const account = instance.getAllAccounts()[0];
        setUserAccount(account);

        // Dispatch custom event to signal sign-in success
        window.dispatchEvent(new CustomEvent('msal:signInSuccess'));

        try {
          const uid = authContextUser?.id;
          if (uid) {
            void runMailboxCatchUpSync(uid).catch(() => {});
          }
        } catch {
          /* ignore */
        }
      }
    } catch (error) {
      // Dispatch custom event to signal sign-in failure
      window.dispatchEvent(new CustomEvent('msal:signInFailure'));

      if (error instanceof Error && error.message.includes('interaction_in_progress')) {
        return;
      }
    } finally {
      setIsMsalLoading(false);
    }
  };

  const handleSignOut = () => {
    void requestSignOut();
  };

  const handleExitAdminBypass = async () => {
    clearAdminBypass();
    clearAdminImpersonationGrant();
    clearClockInGateCache();
    await supabase.auth.signOut().catch(() => {});
    navigate('/login', { replace: true });
  };

  const handleAdminWorkerSwitched = () => {
    setIsAdminChangeUserOpen(false);
    window.location.assign('/');
  };

  const renderAdminBypassControls = (className = '') => {
    if (!showAdminBypassBadge || !adminProfileBypass) return null;

    return (
      <div className={`flex items-center gap-2 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-medium text-amber-900 md:text-xs ${className}`}>
        <button
          type="button"
          className="whitespace-nowrap hover:underline"
          onClick={() => setIsAdminChangeUserOpen(true)}
        >
          Change user
        </button>
        <span className="text-amber-700/70" aria-hidden>·</span>
        <button
          type="button"
          className="whitespace-nowrap hover:underline"
          onClick={() => void handleExitAdminBypass()}
        >
          Log out
        </button>
      </div>
    );
  };

  const handleMicrosoftSignOut = async () => {
    if (!instance) return;

    try {
      await instance.logoutPopup();
      setUserAccount(null);
      setShowSignOutModal(false);
    } catch (error) {
      // Silent error handling
    }
  };

  // Add missing dropdown options and fields for advanced filters
  const reasonOptions = ["Inquiry", "Follow-up", "Complaint", "Consultation", "Other"];
  const tagOptions = ["VIP", "Urgent", "Family", "Business", "Other"];
  const statusOptions = ["new", "in_progress", "qualified", "not_qualified"];

  // Helper functions for RMQ messages
  const formatMessageTime = (timestamp: string): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));

    if (diffInMinutes < 1) return 'Just now';
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    if (diffInMinutes < 1440) return `${Math.floor(diffInMinutes / 60)}h ago`;
    return `${Math.floor(diffInMinutes / 1440)}d ago`;
  };

  const getConversationTitle = (message: RMQMessage): string => {
    if (message.conversation.title) return message.conversation.title;

    if (message.conversation.type === 'direct') {
      return message.sender.tenants_employee?.display_name || message.sender.full_name || 'Unknown User';
    }

    return 'Group Chat';
  };

  const getConversationIcon = (message: RMQMessage): JSX.Element => {
    if (message.conversation.type === 'group') {
      return (
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-green-500 to-teal-500 flex items-center justify-center text-white text-sm font-bold">
          <UserGroupIcon className="w-4 h-4" />
        </div>
      );
    }

    // For direct messages, show sender's photo or initials
    const senderName = message.sender.tenants_employee?.display_name || message.sender.full_name || 'Unknown User';
    const photoUrl = message.sender.tenants_employee?.photo_url;

    if (photoUrl && photoUrl.trim() !== '') {
      return (
        <img
          src={photoUrl}
          alt={senderName}
          className="w-8 h-8 rounded-full object-cover"
        />
      );
    }

    return (
      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold ${isAltTheme ? 'bg-green-600' : 'bg-purple-500'}`}>
        {senderName.charAt(0).toUpperCase()}
      </div>
    );
  };

  const getMessageDisplayText = (message: RMQMessage): string => {
    if (message.conversation.type === 'group') {
      const senderName = message.sender.tenants_employee?.display_name || message.sender.full_name || 'Unknown User';
      return `${senderName}: ${message.content}`;
    }

    // For direct messages, just show the content without sender name
    return message.content;
  };

  const getLeadRouteIdentifier = (row: any, table: 'legacy' | 'new') => {
    if (!row) return '';
    const leadNumber = row.lead_number?.toString().trim();
    if (leadNumber) return leadNumber;
    if (table === 'legacy') {
      const legacyId = row.id?.toString().trim();
      if (legacyId) return legacyId;
    }
    return '';
  };

  const resolveNumericEmployeeId = useCallback(async () => {
    const candidateIds = [
      currentUserEmployee?.id,
      currentUserEmployee?.tenants_employee?.id,
      currentUser?.employee_id,
      (currentUser as any)?.tenants_employee?.id,
    ]
      .filter((value) => value !== undefined && value !== null)
      .map((value) => String(value).trim());

    for (const id of candidateIds) {
      if (/^\d+$/.test(id)) {
        return id;
      }
    }

    const candidateNames = [
      currentUserEmployee?.display_name,
      currentUser?.full_name,
      userFullName,
    ]
      .filter(Boolean)
      .map((name) => String(name).trim())
      .filter((name) => name.length > 0);

    if (candidateNames.length > 0) {
      const { data, error } = await supabase
        .from('tenants_employee')
        .select('id, display_name')
        .in('display_name', candidateNames)
        .limit(1);

      if (!error && data && data.length > 0) {
        const resolvedId = data[0].id;
        if (resolvedId !== undefined && resolvedId !== null) {
          const trimmed = String(resolvedId).trim();
          if (/^\d+$/.test(trimmed)) {
            return trimmed;
          }
        }
      }
    }

    console.warn('Unable to resolve numeric employee ID for assignment notifications.');
    return null;
  }, [currentUser, currentUserEmployee, userFullName]);

  const fetchAssignmentNotifications = useCallback(async () => {
    const numericEmployeeId = await resolveNumericEmployeeId();
    if (!numericEmployeeId) return;

    const stringIdentifierCandidates = [
      currentUserEmployee?.display_name,
      currentUser?.full_name,
      userFullName
    ]
      .filter(Boolean)
      .map(value => String(value).trim())
      .filter(value => value.length > 0);

    const sanitizedStringIdentifiers: string[] = stringIdentifierCandidates.map(value =>
      value.replace(/"/g, '\\"')
    );
    const normalizedStringIdentifiers: string[] = stringIdentifierCandidates.map(value =>
      value.toLowerCase()
    );

    const addNumericCondition = (arr: string[], field?: string, value?: string) => {
      if (!field || !value) return;
      arr.push(`${field}.eq.${value}`);
    };

    const addStringCondition = (arr: string[], field?: string, value?: string) => {
      if (!field || !value) return;
      arr.push(`${field}.eq."${value}"`);
    };

    const legacyConditions: string[] = [];
    const newConditions: string[] = [];

    ASSIGNMENT_ROLE_FIELDS.forEach(role => {
      addNumericCondition(legacyConditions, role.legacyField, numericEmployeeId);
      if (role.newNumericField) {
        addNumericCondition(newConditions, role.newNumericField, numericEmployeeId);
      }
      if (role.newTextField) {
        sanitizedStringIdentifiers.forEach((identifier: string) => {
          addStringCondition(newConditions, role.newTextField!, identifier);
        });
      }
    });

    const legacyOrFilter = legacyConditions.length ? legacyConditions.join(',') : null;
    const newOrFilter = newConditions.length ? newConditions.join(',') : null;

    const legacyRoleFields = ASSIGNMENT_ROLE_FIELDS
      .map(role => role.legacyField)
      .filter(Boolean)
      .join(', ');
    const newRoleFields = Array.from(
      new Set(
        ASSIGNMENT_ROLE_FIELDS.flatMap(role =>
          [role.newNumericField, role.newTextField].filter(Boolean)
        )
      )
    ).join(', ');

    try {
      const [legacyResult, newResult] = await Promise.all([
        legacyOrFilter
          ? supabase
            .from('leads_lead')
            .select(`id, lead_number, manual_id, udate, ${legacyRoleFields}`)
            .or(legacyOrFilter)
            .order('udate', { ascending: false })
            .limit(50)
          : Promise.resolve({ data: [], error: null }),
        newOrFilter
          ? supabase
            .from('leads')
            .select(`id, lead_number, manual_id, created_at, ${newRoleFields}`)
            .or(newOrFilter)
            .order('created_at', { ascending: false })
            .limit(50)
          : Promise.resolve({ data: [], error: null }),
      ]);

      const notifications: AssignmentNotification[] = [];

      const numericMatchValues = [numericEmployeeId];

      const pushNotifications = (rows: any[] | null | undefined, table: 'legacy' | 'new') => {
        if (!rows) return;
        rows.forEach(row => {
          ASSIGNMENT_ROLE_FIELDS.forEach(role => {
            const { legacyField, newNumericField, newTextField } = role;
            let match = false;
            let matchedField = '';
            let matchedValue: string | number | null = null;

            if (table === 'legacy' && legacyField) {
              const value = row[legacyField];
              if (value !== null && value !== undefined) {
                const valueStr = String(value).trim();
                if (numericMatchValues.includes(valueStr)) {
                  match = true;
                  matchedField = legacyField;
                  matchedValue = value;
                }
              }
            }

            if (!match && table === 'new') {
              // For new leads, check fields based on how they're saved in RolesTab:
              // - manager, expert, helper: saved as numeric IDs only
              // - scheduler, closer, handler: saved as text (display names) only
              // - handler: may also have case_handler_id

              // Check numeric field first (for manager, expert, helper, and potentially handler)
              if (newNumericField) {
                const value = row[newNumericField];
                if (value !== null && value !== undefined) {
                  const valueStr = String(value).trim();
                  if (numericMatchValues.includes(valueStr)) {
                    match = true;
                    matchedField = newNumericField;
                    matchedValue = value;
                  }
                }
              }
              // Check text field (for scheduler, closer, handler)
              if (!match && newTextField) {
                const value = row[newTextField];
                if (value !== null && value !== undefined) {
                  const valueStr = String(value).trim().toLowerCase();
                  if (normalizedStringIdentifiers.includes(valueStr)) {
                    match = true;
                    matchedField = newTextField;
                    matchedValue = value;
                  }
                }
              }
            }

            if (!match) return;

            const timestamp =
              table === 'legacy'
                ? (row.udate || row.created_at)
                : (row.updated_at || row.created_at || row.createdAt);
            const key = [table, row.id, matchedField, matchedValue, timestamp || ''].join(':');
            if (seenAssignmentKeys.has(key)) return;
            notifications.push({
              key,
              table,
              leadId: row.id,
              leadRouteId: getLeadRouteIdentifier(row, table),
              leadNumber: getLeadRouteIdentifier(row, table),
              roleLabel: role.label,
              updatedAt: timestamp,
            });
          });
        });
      };

      if (legacyResult.error) {
        console.error('Error fetching legacy assignments:', legacyResult.error);
      } else {
        pushNotifications(legacyResult.data, 'legacy');
      }

      if (newResult.error) {
        console.error('Error fetching lead assignments:', newResult.error);
      } else {
        pushNotifications(newResult.data, 'new');
      }

      setAssignmentNotifications(notifications);
    } catch (error) {
      console.error('Error fetching assignment notifications:', error);
    }
  }, [currentUser?.employee_id, currentUserEmployee?.id, seenAssignmentKeys]);

  useEffect(() => {
    if (!currentUser && !currentUserEmployee) return;
    fetchAssignmentNotifications();
    const interval = setInterval(() => {
      fetchAssignmentNotifications();
    }, 60000);
    return () => clearInterval(interval);
  }, [currentUser, currentUserEmployee, fetchAssignmentNotifications]);

  const handleRmqMessageClick = async (message: RMQMessage) => {
    // Close notifications dropdown
    setShowNotifications(false);
    // Set the conversation ID to open
    setSelectedConversationId(message.conversation_id);
    // Open RMQ messages modal with the specific conversation selected
    setIsRmqModalOpen(true);

    // Mark this conversation as read in the database
    if (currentUser) {
      try {
        await supabase.rpc('mark_conversation_as_read', {
          conv_id: message.conversation_id,
          user_uuid: currentUser.id
        });
      } catch (error) {
        console.error('Error marking conversation as read:', error);
      }
    }

    // Remove all messages from this conversation from the notifications
    setRmqMessages(prev => prev.filter(m => m.conversation_id !== message.conversation_id));
    setRmqUnreadCount(prev => {
      const messagesFromThisConv = rmqMessages.filter(m => m.conversation_id === message.conversation_id);
      return Math.max(0, prev - messagesFromThisConv.length);
    });
  };

  const handleWhatsappLeadsClick = (phoneNumber?: string) => {
    // Close notifications dropdown
    setShowNotifications(false);
    // Navigate to WhatsApp Leads page with optional phone number parameter
    if (phoneNumber) {
      navigate(`/whatsapp-leads?phone=${encodeURIComponent(phoneNumber)}`);
    } else {
      navigate('/whatsapp-leads');
    }
  };

  const handleEmailLeadClick = () => {
    setShowNotifications(false);
    navigate('/email-leads');
  };

  const handleWhatsappMessageRead = async (message: any) => {
    try {
      // Mark the specific message as read
      const { error } = await supabase
        .from('whatsapp_messages')
        .update({
          is_read: true,
          read_at: new Date().toISOString(),
          read_by: currentUser?.id
        })
        .eq('id', message.id);

      if (error) {
        console.error('Error marking WhatsApp message as read:', error);
        return;
      }

      // Remove this message from the notifications
      setWhatsappLeadsMessages(prev => prev.filter(m => m.id !== message.id));
      setWhatsappLeadsUnreadCount(prev => Math.max(0, prev - 1));

      console.log('✅ WhatsApp message marked as read');
    } catch (error) {
      console.error('Error marking WhatsApp message as read:', error);
    }
  };

  const handleEmailLeadMessageRead = async (message: typeof emailLeadMessages[number]) => {
    try {
      if (message.message_ids.length > 0) {
        const { error } = await supabase
          .from('emails')
          .update({
            is_read: true,
            read_at: new Date().toISOString(),
            read_by: currentUser?.id || null
          })
          .in('id', message.message_ids);

        if (error) {
          console.error('Error marking email lead messages as read:', error);
          return;
        }
      }

      setEmailLeadMessages(prev => prev.filter(m => m.id !== message.id));
      setEmailLeadUnreadCount(prev => Math.max(0, prev - 1));
      fetchEmailUnreadCount();
    } catch (error) {
      console.error('Error marking email leads as read:', error);
    }
  };

  const dismissRmqMessage = (messageId: number) => {
    setRmqMessages(prev => prev.filter(m => m.id !== messageId));
    setRmqUnreadCount(prev => Math.max(0, prev - 1));
  };

  const dismissAssignmentNotification = (notification: AssignmentNotification) => {
    rememberAssignments([notification.key]);
    setAssignmentNotifications(prev => prev.filter(item => item.key !== notification.key));
  };

  const handleAssignmentOpen = (notification: AssignmentNotification) => {
    rememberAssignments([notification.key]);
    setAssignmentNotifications(prev => prev.filter(item => item.key !== notification.key));
    setShowNotifications(false);
    navigate(`/clients/${notification.leadRouteId}`);
  };

  // Helper function to get contrasting text color based on background
  const getContrastingTextColor = (hexColor?: string | null) => {
    // When we don't have a specific stage colour, we default to white text
    // on the default purple background so the label stays readable.
    if (!hexColor) return '#ffffff';

    let sanitized = hexColor.trim();
    if (sanitized.startsWith('#')) sanitized = sanitized.slice(1);
    if (sanitized.length === 3) {
      sanitized = sanitized.split('').map(char => char + char).join('');
    }
    if (!/^[0-9a-fA-F]{6}$/.test(sanitized)) {
      return '#ffffff';
    }

    const r = parseInt(sanitized.slice(0, 2), 16) / 255;
    const g = parseInt(sanitized.slice(2, 4), 16) / 255;
    const b = parseInt(sanitized.slice(4, 6), 16) / 255;

    // Calculate luminance (perceived brightness)
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return luminance > 0.55 ? '#111827' : '#ffffff';
  };

  // Root / external-home: avoid painting full internal header until extern vs staff is known (refresh flash).
  // Render an empty header shell (no spinner) so the page-level loader is the only loading indicator.
  if (shouldDeferInternalChrome(location.pathname, isLoadingExternal)) {
    return (
      <>
        <div
          data-mobile-header={isMobile ? 'floating' : undefined}
          className="navbar navbar-safe-x md:px-0 h-11 md:h-12 fixed top-0 left-0 right-0 z-50 w-full max-w-[100vw] bg-white dark:bg-base-100 md:bg-base-100 border-b-0 shadow-none md:border-b md:border-base-200 md:dark:border-base-300 pt-safe pb-1.5 md:pb-0 md:pt-0"
          aria-hidden
        />
      </>
    );
  }

  // External user header - simplified view
  if (isExternalUser && !isLoadingExternal) {
    const extHeaderNavItemClass =
      'relative inline-flex h-9 min-h-0 shrink-0 items-center justify-center rounded-lg px-2.5 text-sm font-semibold tracking-tight text-base-content/80 md:px-3.5 ' +
      'transition-[color,transform,box-shadow,background-color] duration-200 ease-out ' +
      'hover:-translate-y-px hover:bg-base-200/70 hover:text-base-content hover:shadow-md dark:hover:bg-base-300/45 ' +
      'active:translate-y-0 active:scale-[0.97] active:shadow-sm ' +
      'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-2 focus-visible:ring-offset-base-100 dark:focus-visible:ring-offset-base-100';
    const extHeaderSignOutClass =
      'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-base-content/70 transition-all duration-200 ease-out ' +
      'hover:bg-base-200/70 hover:text-base-content hover:shadow-md dark:hover:bg-base-300/45 active:scale-[0.96] ' +
      'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-2 focus-visible:ring-offset-base-100 dark:focus-visible:ring-offset-base-100';
    const mobileBackButtonClass =
      'md:hidden inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#3b28c7] text-white shadow-md ring-2 ring-white/25 hover:bg-[#3224b0] active:scale-95 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3b28c7]/40 focus-visible:ring-offset-2';

    return (
      <>
        <div
          data-mobile-header={isMobile ? 'floating' : undefined}
          className={`navbar navbar-safe-x relative h-11 md:h-12 fixed top-0 left-0 right-0 z-50 w-full max-w-[100vw] bg-white dark:bg-base-100 md:bg-base-100 border-b-0 shadow-none md:border-b-0 md:border-transparent pt-safe pb-1.5 md:pb-0 md:pt-0 ${EXTERNAL_USER_HEADER_PADDING}`}
        >
          {/* Left: Logo */}
          <div className="flex-1 justify-start flex items-center">
            <div className="flex h-11 md:h-12 items-center gap-2 md:gap-3 px-1">
              <Link to="/external-home" className="flex items-center gap-2">
                <span
                  className="md:ml-2 text-xl md:text-2xl font-extrabold tracking-tight"
                  style={{ color: isAltTheme ? '#505d57' : '#3b28c7', letterSpacing: '-0.03em' }}
                >
                  RMQ 2.0
                </span>
              </Link>
            </div>
          </div>

          {/* Desktop: inline nav */}
          <div className="absolute left-1/2 z-10 hidden max-w-[min(94vw,36rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-x-1 gap-y-1 md:flex md:max-w-none md:flex-nowrap md:gap-2">
            <Link to="/external-home" className={extHeaderNavItemClass}>
              Dashboard
            </Link>
            <Link to="/external-reports" className={extHeaderNavItemClass}>
              Report
            </Link>
            <Link to="/access-logs" className={extHeaderNavItemClass}>
              Access logs
            </Link>
            <Link to="/external-settings" className={extHeaderNavItemClass}>
              Settings
            </Link>
            <button
              type="button"
              onClick={() => {
                if (onOpenMessaging) onOpenMessaging();
              }}
              className={`${extHeaderNavItemClass} gap-1.5 group`}
              title="RMQ Messages"
            >
              RMQ Messages
              {rmqUnreadCount > 0 && (
                <span className="bg-red-500 text-white text-xs font-bold rounded-full min-w-[20px] h-5 px-1.5 inline-flex items-center justify-center shadow-sm ring-1 ring-white/25 transition-transform duration-200 group-hover:scale-[1.04]">
                  {rmqUnreadCount > 9 ? '9+' : rmqUnreadCount}
                </span>
              )}
            </button>
          </div>

          {/* Right: mobile hamburger + desktop sign out */}
          <div className="flex-1 justify-end flex items-center pr-1 md:pr-0">
            {/* Mobile hamburger */}
            <div className="dropdown dropdown-end md:hidden">
              <button
                type="button"
                className={extHeaderSignOutClass}
                title="Menu"
              >
                <Bars3Icon className="w-6 h-6" />
              </button>
              <ul className="menu dropdown-content mt-2 w-64 rounded-box bg-base-100 p-2 shadow-lg border border-base-200">
                <li><Link to="/external-home">Dashboard</Link></li>
                <li><Link to="/external-reports">Report</Link></li>
                <li><Link to="/access-logs">Access logs</Link></li>
                <li><Link to="/external-settings">Settings</Link></li>
                <li>
                  <button
                    type="button"
                    onClick={() => onOpenMessaging?.()}
                    className="flex items-center justify-between"
                  >
                    <span>RMQ Messages</span>
                    {rmqUnreadCount > 0 && (
                      <span className="badge badge-error badge-sm text-white">{rmqUnreadCount > 9 ? '9+' : rmqUnreadCount}</span>
                    )}
                  </button>
                </li>
                <li><button type="button" onClick={handleSignOut}>Log out</button></li>
                <li className="mt-1"><div className="divider my-1" /></li>
                <li className="pointer-events-none">
                  <div className="flex items-center gap-3">
                    <div className="avatar">
                      <div className="w-9 rounded-full ring-1 ring-base-200">
                        {(externalUserProfile as any)?.photo_url || authProfilePhotoUrl ? (
                          <img src={String((externalUserProfile as any)?.photo_url || authProfilePhotoUrl)} alt="" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-base-200 text-xs font-semibold text-base-content/70">
                            {String(userFullName || authUserFullName || 'U').trim().slice(0, 2).toUpperCase()}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate">
                        {userFullName || authUserFullName || 'User'}
                      </div>
                    </div>
                  </div>
                </li>
              </ul>
            </div>

            {/* Desktop sign out */}
            <button
              onClick={handleSignOut}
              className={`hidden md:inline-flex ${extHeaderSignOutClass}`}
              title="Sign Out"
            >
              <ArrowRightOnRectangleIcon className="w-5 h-5" />
            </button>

            {location.pathname !== '/login' && (
              <button
                type="button"
                onClick={() => navigate(-1)}
                className={mobileBackButtonClass}
                aria-label="Go back"
              >
                <ChevronLeftIcon className="h-5 w-5" aria-hidden />
              </button>
            )}
          </div>

        </div>
      </>
    );
  }

  const mobileBackButtonClass =
    'md:hidden inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#3b28c7] text-white shadow-md ring-2 ring-white/25 hover:bg-[#3224b0] active:scale-95 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3b28c7]/40 focus-visible:ring-offset-2';

  return (
    <>
      <div
        data-mobile-header={isMobile ? 'floating' : undefined}
        className={`navbar navbar-safe-x flex-nowrap md:px-0 h-11 md:h-12 md:max-h-12 fixed top-0 left-0 right-0 z-50 w-full max-w-[100vw] bg-white dark:bg-base-100 md:bg-base-100 border-b-0 shadow-none md:border-b-0 md:border-transparent pt-safe pb-1.5 md:pb-0 md:pt-0 ${clearFloatingSidebar ? 'md:pl-2 md:pr-6 lg:pr-8 border-b-0 shadow-none' : ''}`}
      >
        {/* Left section with menu and logo */}
        <div className={`shrink-0 flex items-center gap-2 md:gap-4 overflow-hidden md:overflow-visible transition-all duration-300 ${isSearchActive && isMobile ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
          <button
            type="button"
            className="btn btn-ghost md:hidden min-h-0 h-10 w-10 p-0 border-0 text-base-content/90 hover:bg-base-200/60 dark:hover:bg-base-300/40 rounded-lg"
            onClick={onMenuClick}
            aria-label={isMenuOpen ? "Close menu" : "Open menu"}
          >
            {isMenuOpen ? (
              <XMarkIcon className="w-7 h-7" />
            ) : (
              <Bars3Icon className="w-7 h-7" />
            )}
          </button>

          {/* Profile + dropdown: mobile only */}
          <div className="relative flex items-center flex-shrink-0 md:hidden" ref={profileDropdownRef}>
            <div className="relative">
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 z-30 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white dark:ring-base-100">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
              <button
                ref={profileButtonRefMobile}
                type="button"
                className="btn btn-ghost min-h-0 h-10 w-10 p-0 rounded-full border-0 flex items-center justify-center overflow-hidden ring-0 hover:bg-base-200/50 dark:hover:bg-base-300/30"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowProfileDropdown((v) => !v);
                }}
                aria-expanded={showProfileDropdown}
                aria-haspopup="true"
              >
              {resolvedHeaderPhotoUrl ? (
                <>
                  <span
                    className="w-10 h-10 min-w-[2.5rem] min-h-[2.5rem] flex-shrink-0 rounded-full bg-base-300 block bg-no-repeat bg-center"
                    style={{
                      backgroundImage: `url(${resolvedHeaderPhotoUrl})`,
                      backgroundSize: 'cover',
                    }}
                  />
                  <img
                    src={resolvedHeaderPhotoUrl}
                    alt=""
                    className="hidden"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      target.previousElementSibling?.classList.add('hidden');
                      target.nextElementSibling?.classList.remove('hidden');
                    }}
                  />
                </>
              ) : null}
              <span className={`w-10 h-10 min-w-[2.5rem] min-h-[2.5rem] flex-shrink-0 rounded-full overflow-hidden aspect-square bg-base-300 flex items-center justify-center ${resolvedHeaderPhotoUrl ? 'hidden' : ''}`}>
                {(authUserInitials || authUserFullName || userFullName) ? (
                  <span className="text-sm font-semibold text-base-content/80">
                    {(authUserInitials || (authUserFullName || userFullName || '').trim().split(/\s+/).map(n => n[0]).join('').toUpperCase().slice(0, 2)) || 'U'}
                  </span>
                ) : (
                  <UserIcon className="w-5 h-5 text-base-content/70" />
                )}
              </span>
              </button>
            </div>
            {showProfileDropdown && isMobile && createPortal(
              <div
                className="fixed inset-0 z-[100] md:hidden flex items-end justify-center"
                data-profile-dropdown-mobile
                role="presentation"
              >
                <div
                  className="absolute inset-0 bg-black/50"
                  onClick={() => setShowProfileDropdown(false)}
                  aria-hidden="true"
                />
                <div
                  className="relative w-full max-h-[min(88vh,640px)] flex flex-col bg-base-100 rounded-t-3xl shadow-2xl overflow-hidden"
                  role="menu"
                  onClick={(e) => e.stopPropagation()}
                  style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))' }}
                >
                  <div className="flex justify-center pt-3 pb-2 shrink-0">
                    <div className="h-1 w-10 rounded-full bg-base-300" aria-hidden />
                  </div>

                  <div className="flex items-center gap-3 px-5 pb-4 border-b border-base-200 shrink-0">
                    <div className="relative shrink-0">
                      {resolvedHeaderPhotoUrl ? (
                        <span
                          className="block h-12 w-12 rounded-full bg-base-300 bg-cover bg-center ring-2 ring-base-200"
                          style={{ backgroundImage: `url(${resolvedHeaderPhotoUrl})` }}
                        />
                      ) : (
                        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-base-300 text-base font-semibold text-base-content/80 ring-2 ring-base-200">
                          {(authUserInitials || (authUserFullName || userFullName || '').trim().split(/\s+/).map(n => n[0]).join('').toUpperCase().slice(0, 2)) || 'U'}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-base font-semibold text-base-content truncate">
                        {currentUserEmployee?.official_name || currentUserEmployee?.display_name || userFullName || authUserFullName || 'User'}
                      </p>
                      <p className="text-sm text-base-content/60 truncate">Account menu</p>
                    </div>
                  </div>

                  <div className="overflow-y-auto min-h-0">
                    <button
                      type="button"
                      role="menuitem"
                      className="flex w-full items-center gap-4 border-b border-base-200 px-5 py-4 text-left transition-colors hover:bg-base-200/50 active:bg-base-200/70"
                      onClick={() => {
                        setShowProfileDropdown(false);
                        navigate('/organization');
                      }}
                    >
                      <BuildingOffice2Icon className="h-6 w-6 shrink-0 text-base-content/60" />
                      <span className="flex flex-1 items-center justify-between gap-3 min-w-0">
                        <span className="text-base font-medium">Organization</span>
                        <span className="badge badge-primary badge-sm shrink-0 uppercase tracking-wide">
                          New
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="flex w-full items-center gap-4 border-b border-base-200 px-5 py-4 text-left transition-colors hover:bg-base-200/50 active:bg-base-200/70"
                      onClick={() => {
                        setShowProfileDropdown(false);
                        navigate('/my-profile');
                      }}
                    >
                      <UserIcon className="h-6 w-6 shrink-0 text-base-content/60" />
                      <span className="text-base font-medium">View profile</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="flex w-full items-center gap-4 border-b border-base-200 px-5 py-4 text-left transition-colors hover:bg-base-200/50 active:bg-base-200/70"
                      onClick={() => {
                        setShowProfileDropdown(false);
                        handleNotificationClick();
                      }}
                    >
                      <BellIcon className="h-6 w-6 shrink-0 text-base-content/60" />
                      <span className="flex flex-1 items-center justify-between gap-3 min-w-0">
                        <span className="text-base font-medium">Notifications</span>
                        {unreadCount > 0 && (
                          <span className="badge badge-primary badge-sm min-w-[1.25rem] px-1.5">
                            {unreadCount > 9 ? '9+' : unreadCount}
                          </span>
                        )}
                      </span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="flex w-full items-center gap-4 border-b border-base-200 px-5 py-4 text-left transition-colors hover:bg-base-200/50 active:bg-base-200/70"
                      onClick={() => {
                        setShowProfileDropdown(false);
                        setIsHighlightsPanelOpen(true);
                      }}
                    >
                      <StarIcon className="h-6 w-6 shrink-0" style={{ color: '#3E28CD' }} />
                      <span className="text-base font-medium">Highlights</span>
                    </button>
                    {typeof onOpenAIChat === 'function' && (
                      <button
                        type="button"
                        role="menuitem"
                        className="flex w-full items-center gap-4 border-b border-base-200 px-5 py-4 text-left transition-colors hover:bg-base-200/50 active:bg-base-200/70"
                        onClick={() => {
                          setShowProfileDropdown(false);
                          onOpenAIChat();
                        }}
                      >
                        <FaRobot className="h-6 w-6 shrink-0 text-base-content/60" />
                        <span className="text-base font-medium">RMQ AI</span>
                      </button>
                    )}
                    <button
                      type="button"
                      role="menuitem"
                      className="flex w-full items-center gap-4 border-b border-base-200 px-5 py-4 text-left transition-colors hover:bg-base-200/50 active:bg-base-200/70"
                      onClick={() => {
                        setShowProfileDropdown(false);
                        navigate('/settings');
                      }}
                    >
                      <Cog6ToothIcon className="h-6 w-6 shrink-0 text-base-content/60" />
                      <span className="text-base font-medium">Settings</span>
                    </button>
                    {currentUser?.extern && (
                      <button
                        type="button"
                        role="menuitem"
                        className="flex w-full items-center gap-4 border-b border-base-200 px-5 py-4 text-left transition-colors hover:bg-base-200/50 active:bg-base-200/70"
                        onClick={() => {
                          setShowProfileDropdown(false);
                          navigate('/external-settings');
                        }}
                      >
                        <Cog6ToothIcon className="h-6 w-6 shrink-0 text-base-content/60" />
                        <span className="text-base font-medium">External settings</span>
                      </button>
                    )}
                    {!userAccount && (
                      <button
                        type="button"
                        role="menuitem"
                        className="flex w-full items-center gap-4 border-b border-base-200 px-5 py-4 text-left transition-colors hover:bg-base-200/50 active:bg-base-200/70 disabled:opacity-60"
                        onClick={() => {
                          setShowProfileDropdown(false);
                          handleMicrosoftSignIn();
                        }}
                        disabled={isMsalLoading || !isMsalInitialized}
                      >
                        <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24">
                          <path fill="currentColor" d="M11.4 24H0V12.6h11.4V24zM24 24H12.6V12.6H24V24zM11.4 11.4H0V0h11.4v11.4zM24 11.4H12.6V0H24v11.4z" />
                        </svg>
                        <span className="text-base font-medium">Sign in with Microsoft</span>
                      </button>
                    )}
                    <button
                      type="button"
                      role="menuitem"
                      className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-error/10 active:bg-error/15 text-error"
                      onClick={() => {
                        setShowProfileDropdown(false);
                        handleSignOut();
                      }}
                    >
                      <ArrowRightOnRectangleIcon className="h-6 w-6 shrink-0" />
                      <span className="text-base font-medium">Log out</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    className="mx-4 mt-3 mb-1 flex h-12 w-[calc(100%-2rem)] items-center justify-center rounded-xl bg-base-200/80 text-base font-semibold text-base-content active:bg-base-300"
                    onClick={() => setShowProfileDropdown(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>,
              document.body
            )}
          </div>

          {renderAdminBypassControls('md:hidden ml-1 shrink-0')}

          {/* Desktop: hamburger flush left, RMQ logo next to it */}
          <div className="hidden md:flex items-center h-10 pl-0 md:pl-0">
            <button
              ref={buttonRef}
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setShowQuickActionsDropdown(!showQuickActionsDropdown);
              }}
              className="btn btn-ghost btn-square min-h-9 h-9 w-9 p-0 flex items-center justify-center rounded-xl"
              aria-label={showQuickActionsDropdown ? 'Close menu' : 'Open menu'}
              title="Quick Actions"
              data-quick-actions-dropdown
            >
              <Bars3Icon className="w-6 h-6" />
            </button>
            <Link to="/" className="flex items-center ml-1.5" onClick={() => setShowQuickActionsDropdown(false)}>
              <span className="text-xl md:text-2xl font-extrabold tracking-tight" style={{ color: isAltTheme ? '#505d57' : '#3b28c7', letterSpacing: '-0.03em' }}>RMQ 2.0</span>
            </Link>
            {/* Desktop only: profile image + name + dropdown next to RMQ */}
            <div className="hidden md:block relative ml-3 flex items-center flex-shrink-0" ref={profileDropdownRefDesktop}>
              <button
                type="button"
                className="btn btn-ghost gap-2 min-h-0 h-9 w-auto min-w-[2.25rem] pl-2 pr-2 rounded-full flex items-center justify-start flex-shrink-0"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setShowProfileDropdown((v) => !v);
                }}
                aria-expanded={showProfileDropdown}
                aria-haspopup="true"
              >
                {resolvedHeaderPhotoUrl ? (
                  <>
                    <span
                      className="w-8 h-8 min-w-[2rem] min-h-[2rem] flex-shrink-0 rounded-full bg-base-300 block bg-no-repeat bg-center"
                      style={{
                        backgroundImage: `url(${resolvedHeaderPhotoUrl})`,
                        backgroundSize: 'contain',
                      }}
                    />
                    <img
                      src={resolvedHeaderPhotoUrl}
                      alt=""
                      className="hidden"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        target.previousElementSibling?.classList.add('hidden');
                        target.nextElementSibling?.classList.remove('hidden');
                      }}
                    />
                  </>
                ) : null}
                <span className={`w-8 h-8 min-w-[2rem] min-h-[2rem] flex-shrink-0 rounded-full overflow-hidden aspect-square bg-base-300 flex items-center justify-center ${resolvedHeaderPhotoUrl ? 'hidden' : ''}`}>
                  {(authUserInitials || authUserFullName || userFullName) ? (
                  <span className="text-xs font-semibold text-base-content/80">
                      {(authUserInitials || (authUserFullName || userFullName || '').trim().split(/\s+/).map(n => n[0]).join('').toUpperCase().slice(0, 2)) || 'U'}
                    </span>
                  ) : (
                    <UserIcon className="w-4 h-4 text-base-content/70" />
                  )}
                </span>
                <span className="font-medium text-base-content max-w-[120px] truncate text-sm">
                  {currentUserEmployee?.official_name || currentUserEmployee?.display_name || userFullName || authUserFullName || 'User'}
                </span>
                <ChevronDownIcon className={`w-4 h-4 flex-shrink-0 transition-transform ${showProfileDropdown ? 'rotate-180' : ''}`} />
              </button>
              {showProfileDropdown && (
                <div
                  className="absolute left-0 top-full mt-2 w-52 py-1 rounded-xl shadow-xl border border-base-300 bg-base-100 z-50"
                  role="menu"
                >
                  <button
                    type="button"
                    role="menuitem"
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-base-200 transition-colors"
                    onClick={() => {
                      setShowProfileDropdown(false);
                      navigate('/organization');
                    }}
                  >
                    <BuildingOffice2Icon className="w-5 h-5 text-base-content/70" />
                    <span className="flex flex-1 items-center justify-between gap-2 min-w-0">
                      <span>Organization</span>
                      <span className="badge badge-primary badge-sm shrink-0 uppercase tracking-wide">
                        New
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-base-200 transition-colors"
                    onClick={() => {
                      setShowProfileDropdown(false);
                      navigate('/my-profile');
                    }}
                  >
                    <UserIcon className="w-5 h-5 text-base-content/70" />
                    View profile
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-base-200 transition-colors"
                    onClick={() => {
                      setShowProfileDropdown(false);
                      setIsHighlightsPanelOpen(true);
                    }}
                  >
                    <StarIcon className="w-5 h-5 text-base-content/70" style={{ color: '#3E28CD' }} />
                    Highlights
                  </button>
                  {typeof onOpenAIChat === 'function' && (
                    <button
                      type="button"
                      role="menuitem"
                      className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-base-200 transition-colors"
                      onClick={() => {
                        setShowProfileDropdown(false);
                        onOpenAIChat();
                      }}
                    >
                      <FaRobot className="w-5 h-5 text-base-content/70" />
                      RMQ AI
                    </button>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-base-200 transition-colors"
                    onClick={() => {
                      setShowProfileDropdown(false);
                      navigate('/settings');
                    }}
                  >
                    <Cog6ToothIcon className="w-5 h-5 text-base-content/70" />
                    Settings
                  </button>
                  {currentUser?.extern && (
                    <button
                      type="button"
                      role="menuitem"
                      className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-base-200 transition-colors"
                      onClick={() => {
                        setShowProfileDropdown(false);
                        navigate('/external-settings');
                      }}
                    >
                      <Cog6ToothIcon className="w-5 h-5 text-base-content/70" />
                      External settings
                    </button>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-base-200 transition-colors"
                    onClick={() => {
                      setShowProfileDropdown(false);
                      if (userAccount) {
                        setShowSignOutModal(true);
                      } else {
                        handleMicrosoftSignIn();
                      }
                    }}
                    disabled={isMsalLoading || !isMsalInitialized}
                  >
                    <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24">
                      <path fill="currentColor" d="M11.4 24H0V12.6h11.4V24zM24 24H12.6V12.6H24V24zM11.4 11.4H0V0h11.4v11.4zM24 11.4H12.6V0H24v11.4z" />
                    </svg>
                    <span className={userAccount ? 'text-primary' : 'text-base-content/70'}>
                      {userAccount ? 'Signed in' : 'Sign in with Microsoft'}
                    </span>
                  </button>
                  <div className="border-t border-base-300 my-1" />
                  <button
                    type="button"
                    role="menuitem"
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-base-200 transition-colors text-error"
                    onClick={() => {
                      setShowProfileDropdown(false);
                      handleSignOut();
                    }}
                  >
                    <ArrowRightOnRectangleIcon className="w-5 h-5" />
                    Log out
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Desktop: overlay + left-side panel when hamburger menu is open */}
          {showQuickActionsDropdown && createPortal(
            <>
              <div
                className="fixed inset-0 bg-black/40 z-[9998] hidden md:block"
                data-dropdown-menu
                aria-hidden="true"
                onClick={() => setShowQuickActionsDropdown(false)}
              />
              <div
                className="fixed left-0 top-0 h-full w-72 max-w-[85vw] bg-base-100 shadow-2xl z-[9999] hidden md:flex flex-col overflow-hidden"
                data-dropdown-menu
                onClick={(e) => e.stopPropagation()}
              >
                {/* RMQ 2.0 at top */}
                <div className="flex-shrink-0 pt-3 px-4 pb-2 border-b border-base-300">
                  <span className="text-xl font-extrabold tracking-tight" style={{ color: isAltTheme ? '#505d57' : '#3b28c7', letterSpacing: '-0.03em' }}>RMQ 2.0</span>
                </div>
                {/* Menu search + links/results */}
                <div className="flex-1 min-h-0 flex flex-col">
                  <div className="px-4 py-3 border-b border-base-300 bg-white dark:bg-gray-900">
                    <div className="relative">
                      <div className="flex items-center gap-2">
                        <div className="relative flex-1 min-w-0">
                          <MagnifyingGlassIcon className="w-4 h-4 text-base-content/50 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                          <input
                            type="text"
                            value={quickMenuSearchValue}
                            onChange={(e) => {
                              setQuickMenuSearchValue(e.target.value);
                              if (showQuickMenuAllDropdown) setShowQuickMenuAllDropdown(false);
                            }}
                            placeholder="Search pages, tools, files..."
                            className="w-full h-10 pl-9 pr-3 rounded-lg border border-base-300 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/50"
                            autoComplete="off"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowQuickMenuAllDropdown((prev) => !prev)}
                          className={`h-10 px-3 rounded-lg border border-base-300 transition-colors text-sm font-medium flex items-center gap-1.5 ${showQuickMenuAllDropdown ? 'bg-primary/10 text-primary' : 'bg-base-100 hover:bg-base-200'}`}
                          aria-expanded={showQuickMenuAllDropdown}
                          aria-haspopup="menu"
                          title="Show all pages and files"
                        >
                          All
                          <ChevronDownIcon className={`w-4 h-4 transition-transform ${showQuickMenuAllDropdown ? 'rotate-180' : ''}`} />
                        </button>
                      </div>
                    </div>
                    <p className="text-[11px] text-base-content/60 mt-1">
                    </p>
                  </div>
                  <div className="flex-1 overflow-y-auto py-2">
                    {showQuickMenuAllDropdown ? (
                      quickMenuItems.map((item, index) => {
                        const Icon = item.icon;
                        return (
                          <React.Fragment key={`all_inline_${item.id}`}>
                            {index > 0 && <div className="border-t border-base-300" />}
                            <button
                              type="button"
                              onClick={() => {
                                setShowQuickMenuAllDropdown(false);
                                item.onSelect();
                              }}
                              className="flex items-center gap-3 px-4 py-3 transition-all duration-150 text-gray-700 dark:text-base-content w-full text-left hover:bg-base-200"
                            >
                              <Icon className="w-5 h-5 text-gray-500" />
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-medium truncate">{item.label}</div>
                                <div className="text-xs text-base-content/60 truncate">{item.description}</div>
                              </div>
                              {item.badge ? (
                                <span className="ml-auto bg-red-500 text-white text-xs px-2 py-1 rounded-full font-semibold">
                                  {item.badge}
                                </span>
                              ) : null}
                            </button>
                          </React.Fragment>
                        );
                      })
                    ) : quickMenuSearchValue.trim() ? (
                      filteredQuickMenuItems.length > 0 ? (
                        filteredQuickMenuItems.map((item, index) => {
                          const Icon = item.icon;
                          return (
                            <React.Fragment key={item.id}>
                              {index > 0 && <div className="border-t border-base-300" />}
                              <button
                                type="button"
                                onClick={item.onSelect}
                                className="flex items-center gap-3 px-4 py-3 transition-all duration-150 text-gray-700 dark:text-base-content w-full text-left hover:bg-base-200"
                              >
                                <Icon className="w-5 h-5 text-gray-500" />
                                <div className="min-w-0 flex-1">
                                  <div className="text-sm font-medium truncate">{item.label}</div>
                                  <div className="text-xs text-base-content/60 truncate">{item.description}</div>
                                </div>
                                {item.badge ? (
                                  <span className="ml-auto bg-red-500 text-white text-xs px-2 py-1 rounded-full font-semibold">
                                    {item.badge}
                                  </span>
                                ) : null}
                              </button>
                            </React.Fragment>
                          );
                        })
                      ) : (
                        <div className="px-4 py-6 text-sm text-base-content/65">
                          No matches found. Try a shorter term or another keyword.
                        </div>
                      )
                    ) : (
                      <>
                        {isSuperUser && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setShowQuickActionsDropdown(false);
                                setIsTeamStatusModalOpen(true);
                              }}
                              className="flex items-center gap-3 px-4 py-3 transition-all duration-150 text-gray-700 dark:text-base-content w-full text-left hover:bg-base-200"
                            >
                              <UserGroupIcon className="w-5 h-5 text-gray-500" />
                              <span className="text-sm font-medium">Team Status</span>
                            </button>
                            <div className="border-t border-base-300" />
                            <button
                              type="button"
                              onClick={() => {
                                setShowQuickActionsDropdown(false);
                                setIsClockInApprovalModalOpen(true);
                              }}
                              className="flex items-center gap-3 px-4 py-3 transition-all duration-150 text-gray-700 dark:text-base-content w-full text-left hover:bg-base-200"
                            >
                              <ClipboardDocumentCheckIcon className="w-5 h-5 text-gray-500" />
                              <span className="text-sm font-medium">Clock-in approval</span>
                              {pendingClockInApprovalCount > 0 && (
                                <span className="ml-auto bg-red-500 text-white text-xs px-2 py-1 rounded-full font-semibold">
                                  {pendingClockInApprovalCount}
                                </span>
                              )}
                            </button>
                            <div className="border-t border-base-300" />
                          </>
                        )}
                        {navTabs
                        .filter(tab => isSuperUser || tab.path !== '/new-cases')
                        .map((tab, index) => {
                          const Icon = tab.icon;
                          const showCount = tab.path === '/new-cases' && newLeadsCount > 0;
                          return (
                            <React.Fragment key={tab.path || tab.label}>
                              {index > 0 && <div className="border-t border-base-300" />}
                              <Link
                                to={tab.path || '/'}
                                onClick={() => {
                                  setShowQuickActionsDropdown(false);
                                }}
                                className="flex items-center gap-3 px-4 py-3 transition-all duration-150 text-gray-700 dark:text-base-content w-full text-left hover:bg-base-200"
                              >
                                <Icon className="w-5 h-5 text-gray-500" />
                                <span className="text-sm font-medium">{tab.label}</span>
                                {showCount && (
                                  <span className="ml-auto bg-red-500 text-white text-xs px-2 py-1 rounded-full font-semibold">
                                    {newLeadsCount}
                                  </span>
                                )}
                              </Link>
                            </React.Fragment>
                          );
                        })}
                      </>
                    )}
                  </div>
                </div>
                {/* Employee profile at bottom */}
                <div className="flex-shrink-0 px-4 py-4 pb-6 border-t border-base-300 flex items-center gap-3">
                  <button
                    type="button"
                    className="flex-shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 hover:opacity-90 transition-opacity"
                    aria-label="View profile"
                    onClick={() => {
                      setShowQuickActionsDropdown(false);
                      navigate('/my-profile');
                    }}
                  >
                    {resolvedHeaderPhotoUrl ? (
                      <span
                        className="w-12 h-12 min-w-[3rem] min-h-[3rem] flex-shrink-0 rounded-full bg-base-300 block bg-no-repeat bg-center"
                        style={{
                          backgroundImage: `url(${resolvedHeaderPhotoUrl})`,
                          backgroundSize: 'cover',
                        }}
                      />
                    ) : (
                      <span className="w-12 h-12 min-w-[3rem] min-h-[3rem] flex-shrink-0 rounded-full bg-base-300 flex items-center justify-center text-base-content/80 font-semibold text-sm">
                        {(authUserInitials || authUserFullName || userFullName)
                          ? (authUserInitials || (authUserFullName || userFullName || '').trim().split(/\s+/).map(n => n[0]).join('').toUpperCase().slice(0, 2))
                          : 'U'}
                      </span>
                    )}
                  </button>
                  <div className="flex flex-col min-w-0 flex-1">
                    <div className="flex items-center gap-2 w-full min-w-0">
                      <span className="font-medium text-sm text-base-content truncate min-w-0 flex-1">
                        {currentUserEmployee?.official_name || currentUserEmployee?.display_name || userFullName || authUserFullName || 'User'}
                      </span>
                      {isSuperUser && (
                        <span className="flex-shrink-0 w-9 h-9 rounded-full bg-green-500 flex items-center justify-center" title="Admin">
                          <ShieldCheckIcon className="w-5 h-5 text-white" />
                        </span>
                      )}
                    </div>
                    {currentUserEmployee?.department && (
                      <span className="text-xs text-base-content/60 truncate">
                        {currentUserEmployee.department}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </>,
            document.body
          )}
            {renderAdminBypassControls('hidden md:flex ml-2 shrink-0')}
        </div>

        {/* Search bar — centered; desktop: always visible; mobile: hidden until opened (icon next to bell) */}
        <div
          className={`relative transition-all duration-300 flex-1 min-w-0 md:h-12 md:items-center ${
            isMobile && !isSearchActive ? 'hidden md:flex' : 'flex'
          }`}
        >
          <div
            ref={searchContainerRef}
            className={`min-w-12 min-h-12 md:min-h-0 md:h-12 transition-all duration-[700ms] ease-in-out cursor-pointer px-2 md:px-0 ${isSearchActive
              ? isMobile
                ? 'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100vw-120px)]'
                : 'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-xl md:max-w-xl'
              : isMobile
                ? 'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(42vw,9rem)] max-w-[152px]'
                : 'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-1 md:w-48'
              }`}
            style={{
              background: 'transparent'
            }}
            onMouseEnter={!isMobile ? handleDesktopSearchMouseEnter : undefined}
            onMouseLeave={!isMobile ? handleDesktopSearchMouseLeave : undefined}
          >
            <div
              className={`relative flex items-center rounded-full transition-all duration-[700ms] ease-in-out ${
                isSearchActive
                  ? isMobile
                    ? 'w-full overflow-hidden bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-600 shadow-none'
                    : 'w-full overflow-hidden border border-base-300/60 dark:border-base-content/12 bg-base-200/60 dark:bg-base-300/20 shadow-inner'
                  : isMobile
                    ? 'w-full min-h-9 h-9 border-0 bg-transparent shadow-none box-border'
                    : 'w-12 min-w-12 md:w-48 md:min-w-48 overflow-visible md:border md:border-base-300/60 dark:md:border-base-content/12 md:bg-base-200/60 dark:md:bg-base-300/20 md:shadow-inner'
              }`}
              style={isSearchActive && isDarkMode && isMobile ? { borderColor: 'rgba(96, 165, 250, 0.75)' } : undefined}
            >
              {/* Search icon left — mobile: always; desktop active: Siriwave; desktop idle: icon */}
              {isMobile ? (
                <span
                  className="absolute left-2 top-1/2 -translate-y-1/2 flex items-center justify-center z-10 w-9 h-9 pointer-events-none text-gray-500 dark:text-gray-400"
                  aria-hidden
                >
                  <MagnifyingGlassIcon className="w-4 h-4 flex-shrink-0" />
                </span>
              ) : !isMobile && isSearchActive ? (
                <span className="absolute left-2 top-1/2 -translate-y-1/2 flex items-center justify-center z-10 w-9 h-9 flex-shrink-0 pointer-events-none" aria-hidden>
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center overflow-hidden flex-shrink-0 ring-1 ring-base-content/10"
                    style={{
                      backgroundColor: isDarkMode ? '#ffffff' : '#4218cc',
                    }}
                  >
                    <div className="w-7 h-7 overflow-hidden rounded-full flex items-center justify-center [&>div]:!flex [&>div]:!items-center [&>div]:!justify-center [&_canvas]:!block">
                      <Siriwave
                        theme="ios"
                        width={32}
                        height={32}
                        amplitude={0.9}
                        speed={0.08}
                        frequency={4}
                        color={isDarkMode ? '#1e3a5f' : '#ffffff'}
                        cover={false}
                        autostart
                        pixelDepth={0.03}
                      />
                    </div>
                  </div>
                </span>
              ) : (
                <span className="absolute left-2 top-1/2 -translate-y-1/2 flex items-center justify-center z-10 w-9 h-9 flex-shrink-0 pointer-events-none text-gray-500 dark:text-gray-400" aria-hidden>
                  <MagnifyingGlassIcon className="w-5 h-5 flex-shrink-0" />
                </span>
              )}
              <input
                id={HEADER_SEARCH_INPUT_ID}
                ref={searchInputRef}
                type="text"
                placeholder="Search..."
                value={searchValue}
                onChange={handleSearchChange}
                onFocus={handleSearchFocus}
                onBlur={isMobile ? () => {
                  // On mobile, close search if no value, no results, and not searching
                  if (!searchValue.trim() && activeSearchResults.length === 0 && !activeSearchLoading) {
                    setTimeout(() => {
                      setIsSearchActive(false);
                      setIsSearchOpen(false);
                    }, 150);
                  }
                } : undefined}
                className={`
                  w-full bg-transparent border-0 rounded-full text-gray-800 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-0 transition-all duration-300 search-input-placeholder
                  ${isSearchActive ? 'opacity-100 visible pl-12' : isMobile ? 'opacity-100 visible pl-9 pr-2 text-sm' : 'opacity-100 visible pl-12'}
                  ${searchValue.trim() || activeSearchResults.length > 0 ? 'pr-12' : isMobile && !isSearchActive ? 'pr-2' : 'pr-4'}
                `}
                style={{
                  height: isMobile ? (isSearchActive ? 48 : 36) : 44,
                  fontSize: isMobile ? (isSearchActive ? 16 : 13) : 14,
                  fontWeight: 500,
                  letterSpacing: '-0.01em'
                }}
              />
              {/* Clear search button - visible when search is active */}
              {(searchValue.trim() || activeSearchResults.length > 0) && (
                <button
                  onClick={handleClearSearch}
                  className={`absolute right-1 top-1/2 -translate-y-1/2 btn btn-ghost btn-sm btn-circle transition-all duration-300 ease-out text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 flex ${
                    isMobile ? 'h-7 w-7 min-h-7' : ''
                  }`}
                  title="Clear search"
                >
                  <XMarkIcon className="w-5 h-5" />
                </button>
              )}
              {/* Filter button inside input */}
              {isSearchActive && isSearchAnimationDone && (
                <button
                  type="button"
                  className="absolute right-8 top-1/2 -translate-y-1/2 btn btn-ghost btn-circle btn-sm hidden md:block text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
                  onClick={() => {
                    setShowFilterDropdown(v => !v);
                    // Ensure search stays active when opening filter
                    if (!isSearchActive) {
                      setIsSearchActive(true);
                    }
                  }}
                  tabIndex={0}
                  title="Advanced Filters"
                >
                  <FunnelIcon className="w-5 h-5" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* End of search bar container */}
        {isSearchActive && typeof window !== 'undefined' && createPortal(
          <>
            {/* Mobile: full-screen white panel — search results scroll inline here; recently viewed when no query */}
            {isMobile && (
              <div
                className="fixed inset-x-0 bottom-0 bg-white dark:bg-gray-900 z-[49] md:hidden flex flex-col min-h-0 top-[calc(2.75rem+env(safe-area-inset-top,0px)+0.5rem)]"
                onClick={() => {
                  setIsSearchActive(false);
                  setIsSearchOpen(false);
                  searchInputRef.current?.blur();
                }}
              >
                <div
                  ref={searchDropdownRef}
                  className="scrollbar-hide flex-1 overflow-y-auto min-h-0 pt-4 px-4 pb-8"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="max-w-xl mx-auto space-y-6">
                    {(searchValue.trim() || isAdvancedSearching || hasAppliedFilters) ? (
                      <div className="text-base-content">
                        {renderHeaderSearchDropdownBody()}
                      </div>
                    ) : getRecentLeads().length > 0 ? (
                      <div>
                        <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-2">Recently viewed</h3>
                        <div className="space-y-1">
                          {getRecentLeads().map((lead) => (
                            <button
                              key={`lead-${lead.id}`}
                              onClick={() => {
                                navigate(buildClientRouteFromRecentLead(lead));
                                closeSearchBar();
                              }}
                              className="w-full px-4 py-3 text-left rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-base-content flex items-center gap-2"
                            >
                              <UserIcon className="w-5 h-5 text-gray-400 flex-shrink-0" />
                              <div className="min-w-0 flex-1">
                                <p className="font-medium truncate">{lead.name || 'Unknown'}</p>
                                <p className="text-sm text-gray-500 dark:text-gray-400 truncate">#{lead.lead_number}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="py-8 text-center text-base-content/60 text-sm">
                        <p className="mb-2">No recently viewed leads yet.</p>
                        <p>Search above or visit a client to see them here.</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
            {/* Desktop: floating search dropdown below the bar (mobile uses inline panel above) */}
            {!isMobile && (
            <div
              className="fixed z-[10000] flex gap-4 pointer-events-auto -mt-1.5 pt-1.5"
              style={{
                top: searchDropdownStyle.top,
                left: searchDropdownStyle.left,
                zIndex: 10000,
              }}
            >
            {/* Search Results - show when there's a search value, or filters applied */}
            {(searchValue.trim() || isAdvancedSearching || hasAppliedFilters) ? (
              <div
                ref={searchDropdownRef}
                className="search-dropdown scrollbar-hide bg-base-100 rounded-xl shadow-xl border border-base-300 max-h-96 overflow-y-auto min-w-0"
                style={{
                  width: searchDropdownStyle.width,
                  zIndex: 10000,
                }}
                onMouseEnter={handleDesktopSearchDropdownMouseEnter}
                onMouseLeave={handleDesktopSearchDropdownMouseLeave}
              >
                {renderHeaderSearchDropdownBody()}
              </div>
            ) : isSearchActive && isSearchAnimationDone ? (
              /* Desktop: Recently viewed leads - white box below search bar when no query (appears when search bar is fully open) */
              <div
                ref={searchDropdownRef}
                className="search-dropdown scrollbar-hide bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-base-300 max-h-96 overflow-y-auto md:min-w-0"
                style={{
                  width: searchDropdownStyle.width,
                  zIndex: 10000,
                }}
                onMouseEnter={handleDesktopSearchDropdownMouseEnter}
                onMouseLeave={handleDesktopSearchDropdownMouseLeave}
              >
                <div className="p-4 space-y-4">
                  {getRecentLeads().length > 0 ? (
                    <div>
                      <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-2">Recently viewed</h3>
                      <div className="space-y-1">
                        {getRecentLeads().map((lead) => (
                          <button
                            key={`lead-${lead.id}`}
                            onClick={() => {
                              navigate(buildClientRouteFromRecentLead(lead));
                              closeSearchBar();
                            }}
                            className="w-full px-3 py-2 text-left rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-base-content flex items-center gap-2 text-sm"
                          >
                            <UserIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />
                            <div className="min-w-0 flex-1">
                              <p className="font-medium truncate">{lead.name || 'Unknown'}</p>
                              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">#{lead.lead_number}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="py-6 text-center text-base-content/60 text-sm">
                      <p className="mb-1">No recently viewed leads yet.</p>
                      <p>Search above or visit a client to see them here.</p>
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {/* Advanced Filter Dropdown - positioned to the right of search results (desktop only) */}
            {showFilterDropdown && !isMobile && (
              <div
                ref={filterDropdownRef}
                className="bg-base-100 rounded-xl shadow-xl border border-base-300 p-6 animate-fadeInUp min-w-80 filter-dropdown"
                onMouseEnter={handleDesktopSearchDropdownMouseEnter}
                onMouseLeave={handleDesktopSearchDropdownMouseLeave}
              >
                <div className="mb-4 flex justify-between items-start">
                  <div>
                    <h3 className="text-lg font-semibold text-base-content mb-2">Advanced Filters</h3>
                    <p className="text-sm text-base-content/80">Filter search results by specific criteria</p>
                  </div>
                  <button
                    onClick={closeFilterDropdown}
                    className="btn btn-ghost btn-sm btn-circle"
                    title="Close filters"
                  >
                    <XMarkIcon className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold mb-1">From date</label>
                    <input type="date" className="input input-bordered w-full" value={advancedFilters.fromDate} onChange={e => setAdvancedFilters(f => ({ ...f, fromDate: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">To date</label>
                    <input type="date" className="input input-bordered w-full" value={advancedFilters.toDate} onChange={e => setAdvancedFilters(f => ({ ...f, toDate: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">Category</label>
                    <select className="select select-bordered w-full" value={advancedFilters.category} onChange={e => setAdvancedFilters(f => ({ ...f, category: e.target.value }))}>
                      <option value="">Please choose</option>
                      {categoryOptions.map((opt, index) => <option key={`category-${index}-${opt}`} value={opt}>{opt}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">Language</label>
                    <select className="select select-bordered w-full" value={advancedFilters.language} onChange={e => setAdvancedFilters(f => ({ ...f, language: e.target.value }))}>
                      <option value="">Please choose</option>
                      {languageOptions.map((opt, index) => <option key={`language-${index}-${opt}`} value={opt}>{opt}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">Reason</label>
                    <select className="select select-bordered w-full" value={advancedFilters.reason} onChange={e => setAdvancedFilters(f => ({ ...f, reason: e.target.value }))}>
                      <option value="">Please choose</option>
                      {reasonOptions.map((opt, index) => <option key={`reason-${index}-${opt}`} value={opt}>{opt}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">Tags</label>
                    <select className="select select-bordered w-full" value={advancedFilters.tags} onChange={e => setAdvancedFilters(f => ({ ...f, tags: e.target.value }))}>
                      <option value="">Please choose</option>
                      {tagOptions.map((opt, index) => <option key={`tag-${index}-${opt}`} value={opt}>{opt}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">Status</label>
                    <select className="select select-bordered w-full" value={advancedFilters.status} onChange={e => setAdvancedFilters(f => ({ ...f, status: e.target.value }))}>
                      <option value="">Please choose</option>
                      {statusOptions.map((opt, index) => <option key={`status-${index}-${opt}`} value={opt}>{opt}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">Source</label>
                    <select className="select select-bordered w-full" value={advancedFilters.source} onChange={e => setAdvancedFilters(f => ({ ...f, source: e.target.value }))}>
                      <option value="">Please choose</option>
                      {sourceOptions.map((opt, index) => <option key={`source-${index}-${opt}`} value={opt}>{opt}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">Stage</label>
                    <select className="select select-bordered w-full" value={advancedFilters.stage} onChange={e => setAdvancedFilters(f => ({ ...f, stage: e.target.value }))}>
                      <option value="">Please choose</option>
                      {stageOptions.map((opt, index) => <option key={`stage-${index}-${opt}`} value={opt}>{opt}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">Topic</label>
                    <input
                      type="text"
                      className="input input-bordered w-full"
                      placeholder="Enter topic..."
                      value={advancedFilters.topic}
                      onChange={e => setAdvancedFilters(f => ({ ...f, topic: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="mt-6 flex justify-end gap-2">
                  <button className="btn btn-outline btn-sm" onClick={() => {
                    closeSearchBar();
                  }}>Cancel</button>
                  <button className="btn btn-primary btn-sm" onClick={async () => {
                    setIsAdvancedSearching(true);
                    try {

                      // Search both legacy and new leads with filters
                      const [legacyPromise, newPromise] = await Promise.allSettled([
                        // Search legacy leads with filters
                        (async () => {
                          let legacyQuery = supabase
                            .from('leads_lead')
                            .select('id, name, email, phone, mobile, topic, stage, cdate, lead_number, deactivate_notes, language_id, lead_stages!fk_leads_lead_stage(id, name, colour), misc_language!leads_lead_language_id_fkey(id, name)')
                            .limit(50);


                          // Apply filters to legacy leads
                          if (advancedFilters.category) {
                            legacyQuery = legacyQuery.eq('topic', advancedFilters.category);
                          }
                          if (advancedFilters.stage) {
                            // For now, skip stage filtering for legacy leads since we need to map stage names to IDs
                          }
                          if (advancedFilters.language) {
                            // For now, skip language filtering for legacy leads since we need to map language names to IDs
                          }

                          if (advancedFilters.fromDate && advancedFilters.toDate) {
                            // Try a different approach - use filter with date range
                            legacyQuery = legacyQuery.filter('cdate', 'gte', advancedFilters.fromDate).filter('cdate', 'lte', advancedFilters.toDate);
                          } else if (advancedFilters.fromDate) {
                            legacyQuery = legacyQuery.filter('cdate', 'gte', advancedFilters.fromDate);
                          } else if (advancedFilters.toDate) {
                            legacyQuery = legacyQuery.filter('cdate', 'lte', advancedFilters.toDate);
                          }
                          if (advancedFilters.fileId) {
                            legacyQuery = legacyQuery.ilike('id', `%${advancedFilters.fileId}%`);
                          }
                          if (advancedFilters.topic) {
                            legacyQuery = legacyQuery.ilike('topic', `%${advancedFilters.topic}%`);
                          }

                          const result = await legacyQuery.order('cdate', { ascending: false });
                          return result;
                        })(),

                        // Search new leads with filters
                        (async () => {
                          let newQuery = supabase
                            .from('leads')
                            .select('id, lead_number, name, email, phone, mobile, topic, stage, created_at, lead_stages!leads_stage_fkey(name, colour), misc_category!category_id(name)')
                            .limit(50);


                          // Apply filters to new leads
                          if (advancedFilters.category) {
                            newQuery = newQuery.eq('topic', advancedFilters.category);
                          }
                          if (advancedFilters.stage) {
                            newQuery = newQuery.eq('stage', advancedFilters.stage);
                          }
                          if (advancedFilters.status) {
                            newQuery = newQuery.eq('status', advancedFilters.status);
                          }
                          if (advancedFilters.fromDate && advancedFilters.toDate) {
                            newQuery = newQuery.gte('created_at', advancedFilters.fromDate).lte('created_at', advancedFilters.toDate);
                          } else if (advancedFilters.fromDate) {
                            newQuery = newQuery.gte('created_at', advancedFilters.fromDate);
                          } else if (advancedFilters.toDate) {
                            newQuery = newQuery.lte('created_at', advancedFilters.toDate);
                          }
                          if (advancedFilters.fileId) {
                            newQuery = newQuery.ilike('lead_number', `%${advancedFilters.fileId}%`);
                          }
                          if (advancedFilters.topic) {
                            newQuery = newQuery.ilike('topic', `%${advancedFilters.topic}%`);
                          }

                          const result = await newQuery.order('created_at', { ascending: false });
                          return result;
                        })()
                      ]);

                      const results: any[] = [];

                      // Process legacy results (use joined stage and language from query)
                      if (legacyPromise.status === 'fulfilled' && legacyPromise.value.data) {
                        const transformedLegacyLeads = legacyPromise.value.data.map((lead: any) => {
                          const stageJoin = Array.isArray(lead.lead_stages) ? lead.lead_stages[0] : lead.lead_stages;
                          const languageJoin = Array.isArray(lead.misc_language) ? lead.misc_language[0] : lead.misc_language;
                          return {
                            id: `legacy_${lead.id}`,
                            lead_number: String(lead.id),
                            name: lead.name || '',
                            email: lead.email || '',
                            phone: lead.phone || '',
                            mobile: lead.mobile || '',
                            topic: lead.topic || '',
                            stage: stageJoin?.name ?? String(lead.stage || ''),
                            stage_colour: stageJoin?.colour ?? '',
                            source: '',
                            created_at: lead.cdate || '',
                            updated_at: lead.cdate || '',
                            notes: '',
                            special_notes: '',
                            next_followup: '',
                            probability: '',
                            category: '',
                            language: languageJoin?.name ?? '',
                            balance: '',
                            lead_type: 'legacy' as const,
                            unactivation_reason: null,
                            deactivate_note: lead.deactivate_notes || null,
                            isFuzzyMatch: false,
                          };
                        });
                        results.push(...transformedLegacyLeads);
                      }

                      // Process new leads results (use joined stage and category from query)
                      if (newPromise.status === 'fulfilled' && newPromise.value.data) {
                        const transformedNewLeads = newPromise.value.data.map((lead: any) => {
                          const stageJoin = Array.isArray(lead.lead_stages) ? lead.lead_stages[0] : lead.lead_stages;
                          const categoryJoin = Array.isArray(lead.misc_category) ? lead.misc_category[0] : lead.misc_category;
                          return {
                            id: lead.id,
                            lead_number: lead.lead_number || '',
                            name: lead.name || '',
                            email: lead.email || '',
                            phone: lead.phone || '',
                            mobile: lead.mobile || '',
                            topic: lead.topic || '',
                            stage: stageJoin?.name ?? String(lead.stage ?? ''),
                            stage_colour: stageJoin?.colour ?? '',
                            source: '',
                            created_at: lead.created_at || '',
                            updated_at: lead.created_at || '',
                            notes: '',
                            special_notes: '',
                            next_followup: '',
                            probability: '',
                            category: categoryJoin?.name ?? '',
                            language: '',
                            balance: '',
                            lead_type: 'new' as const,
                            unactivation_reason: null,
                            deactivate_note: null,
                            isFuzzyMatch: false,
                          };
                        });
                        results.push(...transformedNewLeads);
                      }


                      setSearchResults(results);
                      setIsSearchActive(true);
                      setHasAppliedFilters(true);
                      // Keep filter dropdown open - only close when user clicks X or Cancel

                    } catch (error) {
                      console.error('[Filter] Error applying filters:', error);
                      setSearchResults([]);
                      setShowFilterDropdown(false);
                    } finally {
                      setIsAdvancedSearching(false);
                    }
                  }}>Apply Filters</button>
                </div>
              </div>
            )}
          </div>
          )}
          </>
          , document.body)}

        {/* Right section with notifications and user */}
        <div className={`ml-auto md:ml-0 shrink-0 flex items-center justify-end gap-1.5 md:gap-4 pr-1 md:pr-0 transition-all duration-300 ${isSearchActive && isMobile ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
          {/* Sign out button and Welcome message - desktop only */}
          {/* <button
            className="btn btn-ghost btn-circle btn-sm mr-2 hidden md:inline-flex"
            title="Sign out"
            onClick={handleSignOut}
          >
            <ArrowRightOnRectangleIcon className="w-5 h-5" />
          </button> */}
          {/* <span className={`text-base font-medium hidden md:inline-block ${appJustLoggedIn ? 'slide-fade-in' : ''}`}>
            Welcome, <span className="font-semibold">{userFullName || 'User'}</span>
          </span> */}

          {/* WhatsApp Button */}
          <div className="relative hidden md:block">
            <button
              type="button"
              className="btn btn-ghost border-0 min-h-0 h-10 w-10 p-0 rounded-lg flex items-center justify-center text-base-content/90 hover:bg-base-200/70"
              title="Open WhatsApp"
              onClick={onOpenWhatsApp}
            >
              <FaWhatsapp className="w-7 h-7 text-green-600" />
            </button>
            {whatsappClientsUnreadCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                {whatsappClientsUnreadCount > 9 ? '9+' : whatsappClientsUnreadCount}
              </span>
            )}
          </div>

          <div className="relative hidden md:block">
            <button
              type="button"
              className="btn btn-ghost border-0 min-h-0 h-10 w-10 p-0 rounded-lg flex items-center justify-center text-base-content/90 hover:bg-base-200/70"
              title="Open RMQ Messages"
              onClick={onOpenMessaging}
            >
              <ChatBubbleLeftRightIcon className={`w-7 h-7 ${isAltTheme ? 'text-green-600' : 'text-purple-600'}`} />
            </button>
            {rmqUnreadCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                {rmqUnreadCount > 9 ? '9+' : rmqUnreadCount}
              </span>
            )}
          </div>

          {/* Email Thread Button */}
          <div className="relative hidden md:block">
            <button
              type="button"
              className="btn btn-ghost border-0 min-h-0 h-10 w-10 p-0 rounded-lg flex items-center justify-center text-base-content/90 hover:bg-base-200/70"
              title="Open Email Thread"
              onClick={onOpenEmailThread}
            >
              <EnvelopeIcon className={`w-7 h-7 ${isAltTheme ? 'text-green-600' : 'text-blue-600'}`} />
            </button>
            {emailUnreadCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                {emailUnreadCount > 9 ? '9+' : emailUnreadCount}
              </span>
            )}
          </div>

          {/* Mobile: search opens from icon only (sits next to bell); desktop search stays in center */}
          <button
            type="button"
            className="btn btn-ghost md:hidden min-h-0 h-10 w-10 p-0 border-0 text-base-content/90 hover:bg-base-200/60 dark:hover:bg-base-300/40 rounded-lg"
            aria-label="Search"
            onClick={() => {
              setIsSearchOpen(true);
              setIsSearchActive(true);
              window.setTimeout(() => searchInputRef.current?.focus(), 0);
            }}
          >
            <MagnifyingGlassIcon className="w-7 h-7" />
          </button>

          {/* Notifications — desktop only (mobile bell lives on profile avatar) */}
          <div className="relative hidden md:flex h-10 w-10 shrink-0 items-center justify-center md:h-auto md:w-auto" ref={notificationsRef}>
            <button
              type="button"
              ref={notificationsButtonRef}
              className="btn btn-ghost h-10 w-10 min-h-10 min-w-10 p-0 border-0 mr-0 rounded-lg text-base-content/90 hover:bg-base-200/60 dark:hover:bg-base-300/40 md:mr-1 md:h-12 md:w-12 md:min-h-12 md:min-w-12 md:rounded-full"
              onClick={handleNotificationClick}
            >
              <div className="indicator">
                <BellIcon className="w-7 h-7" />
                {unreadCount > 0 && (
                  <span className="indicator-item badge badge-primary min-w-[1rem] h-4 md:min-w-[1.375rem] md:h-5.5 text-[11px] md:text-xs flex items-center justify-center px-1">{unreadCount}</span>
                )}
              </div>
            </button>

            {showNotifications && typeof window !== 'undefined' && createPortal((
              <div
                data-notification-dropdown
                className={`notification-dropdown shadow-xl rounded-xl overflow-hidden z-[9999] border border-gray-200 dark:border-gray-600 fixed ${isMobile ? 'notification-dropdown-mobile text-[13px]' : 'text-sm'}`}
                style={{
                  top: notificationsDropdownPosition.top,
                  left: notificationsDropdownPosition.left,
                  width: notificationsDropdownPosition.width || (isMobile ? 288 : 320),
                  maxWidth: 'calc(100vw - 24px)',
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className={`border-b border-gray-200 ${isMobile ? 'p-3' : 'p-4'}`}>
                  <div className="flex justify-between items-center">
                    <h3 className={`font-semibold text-gray-900 ${isMobile ? 'text-sm' : ''}`}>Messages</h3>
                    <button
                      className={`btn btn-ghost whitespace-nowrap text-gray-700 hover:text-gray-900 ${isMobile ? 'btn-xs text-[13px]' : 'btn-xs'}`}
                      onClick={markAllAsRead}
                    >
                      Read
                    </button>
                  </div>
                </div>
                <div className="max-h-96 overflow-y-auto">
                  {/* WhatsApp Leads Messages Section - Only for superusers */}
                  {isSuperUser && whatsappLeadsMessages.length > 0 && (
                    <div className="border-b border-gray-200">
                      <div className="p-3 bg-green-50 border-b border-green-100">
                        <div className="flex items-center gap-2">
                          <FaWhatsapp className="w-4 h-4 text-green-600" />
                          <span className="text-sm font-semibold text-green-800">WhatsApp Leads</span>
                        </div>
                      </div>
                      {whatsappLeadsMessages.map((message) => (
                        <div key={message.id} className="border-b border-green-100">
                          <div
                            role="button"
                            tabIndex={0}
                            onClick={() => handleWhatsappLeadsClick(message.phone_number)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                handleWhatsappLeadsClick(message.phone_number);
                              }
                            }}
                            className="w-full p-4 text-left hover:bg-green-50 transition-colors duration-200 cursor-pointer"
                          >
                            <div className="flex gap-3">
                              <div className="flex-shrink-0">
                                <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
                                  <PhoneIcon className="w-4 h-4 text-green-600" />
                                </div>
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between">
                                  <p className="text-sm font-semibold text-gray-900 truncate">
                                    {message.sender_name && message.sender_name !== message.phone_number && !message.sender_name.match(/^\d+$/)
                                      ? message.sender_name
                                      : message.phone_number}
                                  </p>
                                  <p className="text-xs text-gray-500">
                                    {new Date(message.latest_message_time).toLocaleTimeString([], {
                                      hour: '2-digit',
                                      minute: '2-digit'
                                    })}
                                  </p>
                                </div>
                                <p className="text-xs text-gray-600 mt-1 truncate">
                                  {message.latest_message}
                                </p>
                                {message.message_count > 1 && (
                                  <p className="text-xs text-green-600 mt-1">
                                    {message.message_count} messages
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="px-4 py-2 border-t border-green-100 flex justify-end">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleWhatsappMessageRead(message);
                              }}
                              className="text-xs font-medium text-green-700 hover:text-green-900"
                            >
                              Dismiss
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Email Leads Messages Section - Only for superusers */}
                  {isSuperUser && emailLeadMessages.length > 0 && (
                    <div className="border-b border-gray-200">
                      <div className={`p-3 border-b ${isAltTheme ? 'bg-green-50 border-green-100' : 'bg-blue-50 border-blue-100'}`}>
                        <div className="flex items-center gap-2">
                          <EnvelopeIcon className={`w-4 h-4 ${isAltTheme ? 'text-green-600' : 'text-blue-600'}`} />
                          <span className={`text-sm font-semibold ${isAltTheme ? 'text-green-800' : 'text-blue-800'}`}>Email Leads</span>
                        </div>
                      </div>
                      {emailLeadMessages.map((message) => (
                        <div key={message.id} className={`border-b ${isAltTheme ? 'border-green-100' : 'border-blue-100'}`}>
                          <div
                            role="button"
                            tabIndex={0}
                            onClick={handleEmailLeadClick}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                handleEmailLeadClick();
                              }
                            }}
                            className={`w-full p-4 text-left transition-colors duration-200 cursor-pointer ${isAltTheme ? 'hover:bg-green-50' : 'hover:bg-blue-50'}`}
                          >
                            <div className="flex gap-3">
                              <div className="flex-shrink-0">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${isAltTheme ? 'bg-green-100' : 'bg-blue-100'}`}>
                                  <EnvelopeIcon className={`w-4 h-4 ${isAltTheme ? 'text-green-600' : 'text-blue-600'}`} />
                                </div>
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between">
                                  <p className="text-sm font-semibold text-gray-900 truncate">
                                    {message.sender_name || message.sender_email || 'Unknown Sender'}
                                  </p>
                                  <p className="text-xs text-gray-500">
                                    {new Date(message.latest_sent_at).toLocaleTimeString([], {
                                      hour: '2-digit',
                                      minute: '2-digit'
                                    })}
                                  </p>
                                </div>
                                <p className="text-xs text-gray-600 mt-1 truncate">
                                  {message.latest_subject}
                                </p>
                                {message.latest_preview && (
                                  <p className="text-xs text-gray-500 mt-1 truncate">
                                    {message.latest_preview.replace(/<[^>]+>/g, '')}
                                  </p>
                                )}
                                {message.message_count > 1 && (
                                  <p className={`text-xs mt-1 ${isAltTheme ? 'text-green-600' : 'text-blue-600'}`}>
                                    {message.message_count} messages
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className={`px-4 py-2 border-t flex justify-end ${isAltTheme ? 'border-green-100' : 'border-blue-100'}`}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEmailLeadMessageRead(message);
                              }}
                              className={`text-xs font-medium ${isAltTheme ? 'text-green-700 hover:text-green-900' : 'text-blue-700 hover:text-blue-900'}`}
                            >
                              Dismiss
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* RMQ Messages Section */}
                  {currentUser && (
                    <div className="border-b border-gray-200">
                      <div className={`p-3 border-b ${isAltTheme ? 'bg-green-50 border-green-100' : 'bg-purple-50 border-purple-100'}`}>
                        <div className="flex items-center gap-2">
                          <ChatBubbleLeftRightIcon className={`w-4 h-4 ${isAltTheme ? 'text-green-600' : 'text-purple-600'}`} />
                          <span className={`text-sm font-semibold ${isAltTheme ? 'text-green-800' : 'text-purple-800'}`}>RMQ Messages</span>
                        </div>
                      </div>
                      {rmqMessages.length > 0 ? (
                        rmqMessages.map((message) => (
                          <div
                            key={message.id}
                            className={`border-b cursor-pointer ${isAltTheme ? 'border-green-100' : 'border-purple-100'}`}
                          >
                            <div
                              role="button"
                              tabIndex={0}
                              onClick={() => handleRmqMessageClick(message)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  handleRmqMessageClick(message);
                                }
                              }}
                              className={`w-full p-4 text-left transition-colors duration-200 ${isAltTheme ? 'hover:bg-green-50' : 'hover:bg-purple-50'}`}
                            >
                              <div className="flex gap-3">
                                <div className="flex-shrink-0">
                                  {getConversationIcon(message)}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-semibold text-gray-900 truncate">
                                    {getConversationTitle(message)}
                                  </p>
                                  <p className="text-xs text-gray-600 mt-1 truncate">
                                    {getMessageDisplayText(message)}
                                  </p>
                                </div>
                              </div>
                            </div>
                            <div className={`px-4 pb-3 border-t flex items-center justify-between text-xs md:text-[11px] text-gray-500 ${isAltTheme ? 'border-green-100' : 'border-purple-100'}`}>
                              <span>{formatMessageTime(message.sent_at)}</span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  dismissRmqMessage(message.id);
                                }}
                                className={`text-xs font-medium ${isAltTheme ? 'text-green-700 hover:text-green-900' : 'text-purple-700 hover:text-purple-900'}`}
                              >
                                Dismiss
                              </button>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="p-4 text-center text-gray-500">
                          <ChatBubbleLeftRightIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
                          <p className="text-sm">No recent messages</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Lead Assignment Notifications */}
                  {assignmentNotifications.length > 0 && (
                    <div className="border-b border-gray-200">
                      <div className={`p-3 border-b ${isAltTheme ? 'bg-green-50 border-green-100' : 'bg-purple-50 border-purple-100'}`}>
                        <div className="flex items-center gap-2">
                          <UserGroupIcon className={`w-4 h-4 ${isAltTheme ? 'text-green-600' : 'text-purple-600'}`} />
                          <span className={`text-sm font-semibold ${isAltTheme ? 'text-green-800' : 'text-purple-800'}`}>Lead Assignments</span>
                        </div>
                      </div>
                      {assignmentNotifications.map(notification => (
                        <div
                          key={notification.key}
                          className={`border-b cursor-pointer ${isAltTheme ? 'border-green-100' : 'border-purple-100'}`}
                        >
                          <div
                            role="button"
                            tabIndex={0}
                            onClick={() => handleAssignmentOpen(notification)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                handleAssignmentOpen(notification);
                              }
                            }}
                            className={`w-full text-left p-4 transition-colors duration-200 ${isAltTheme ? 'hover:bg-green-50' : 'hover:bg-purple-50'}`}
                          >
                            <div className="flex items-start gap-3">
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${isAltTheme ? 'bg-green-100' : 'bg-purple-100'}`}>
                                <UserIcon className={`w-4 h-4 ${isAltTheme ? 'text-green-700' : 'text-purple-700'}`} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-gray-800 leading-relaxed">
                                  <span className="font-semibold">{userFullName || 'You'}</span>, you have been assigned as{' '}
                                  <span className="font-semibold">{notification.roleLabel}</span> to lead{' '}
                                  <span className="font-semibold">{notification.leadNumber}</span>.
                                </p>
                                <p className={`text-xs mt-2 ${isAltTheme ? 'text-green-600' : 'text-purple-600'}`}>Tap to open lead</p>
                              </div>
                            </div>
                          </div>
                          <div className={`px-4 pb-3 border-t flex justify-end ${isAltTheme ? 'border-green-100' : 'border-purple-100'}`}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                dismissAssignmentNotification(notification);
                              }}
                              className="text-xs font-medium text-purple-700 hover:text-purple-900"
                            >
                              Dismiss
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Empty state - only show if no messages at all */}
                  {rmqMessages.length === 0 &&
                    (isSuperUser ? (whatsappLeadsMessages.length === 0 && emailLeadMessages.length === 0) : true) &&
                    assignmentNotifications.length === 0 &&
                    !currentUser && (
                      <div className="p-8 text-center text-gray-500">
                        <ChatBubbleLeftRightIcon className="w-12 h-12 mx-auto mb-3 opacity-50" />
                        <p className="font-medium">No new messages</p>
                        <p className="text-sm">You're all caught up!</p>
                      </div>
                    )}
                </div>
              </div>
            ), document.body)}
          </div>

          {location.pathname !== '/login' && (
            <button
              type="button"
              onClick={() => navigate(-1)}
              className={`${mobileBackButtonClass} z-[60]`}
              aria-label="Go back"
            >
              <ChevronLeftIcon className="h-5 w-5" aria-hidden />
            </button>
          )}
        </div>
      </div>
      {signOutModal}
      {adminProfileBypass ? (
        <AdminChangeUserModal
          isOpen={isAdminChangeUserOpen}
          adminAuthUserId={adminProfileBypass.adminAuthUserId}
          currentUserId={adminProfileBypass.targetUserId}
          onClose={() => setIsAdminChangeUserOpen(false)}
          onSwitched={handleAdminWorkerSwitched}
        />
      ) : null}

      {/* Sign Out Confirmation Modal */}
      {showSignOutModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isAltTheme ? 'bg-green-600' : 'bg-primary'}`}>
                <svg className="w-6 h-6 text-white" viewBox="0 0 24 24">
                  <path fill="currentColor" d="M11.4 24H0V12.6h11.4V24zM11.4 11.4H0V0h11.4v11.4zM24 11.4H12.6V0H24v11.4z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold">Sign Out</h3>
                <p className="text-sm text-gray-600">
                  Ready to sign out as <span className="font-medium">{(() => {
                    const fullName = userAccount?.name || userAccount?.username || 'Microsoft User';
                    // Extract only the English name before the dash
                    const englishName = fullName.split(' - ')[0].split(' – ')[0];
                    return englishName;
                  })()}</span>?
                </p>
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <button
                className="btn btn-outline btn-sm"
                onClick={() => setShowSignOutModal(false)}
              >
                No, Cancel
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleMicrosoftSignOut}
              >
                Yes, Sign Out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main content offset is app-main-scroll on <main> (safe area + header height) */}

      {/* Employee Modal for My Profile */}
      <EmployeeModal
        employee={currentUserEmployee}
        allEmployees={allEmployees}
        isOpen={isEmployeeModalOpen}
        onClose={() => setIsEmployeeModalOpen(false)}
      />

      {/* RMQ Messages Modal */}
      <RMQMessagesPage
        isOpen={isRmqModalOpen}
        initialConversationId={selectedConversationId}
        onClose={() => {
          setIsRmqModalOpen(false);
          setSelectedConversationId(undefined);
          // Refresh messages when closing modal
          fetchRmqMessages();
        }}
      />

      {/* Highlights Panel */}
      <HighlightsPanel
        isOpen={isHighlightsPanelOpen}
        onClose={() => setIsHighlightsPanelOpen(false)}
      />

      {isSuperUser && (
        <TeamStatusModal
          isOpen={isTeamStatusModalOpen}
          onClose={() => setIsTeamStatusModalOpen(false)}
        />
      )}

      {isSuperUser && (
        <ManualClockInApprovalModal
          isOpen={isClockInApprovalModalOpen}
          onClose={() => setIsClockInApprovalModalOpen(false)}
          onUpdated={() => void fetchPendingClockInApprovals()}
        />
      )}

      <style>{`
        .notification-dropdown {
          background-color: #ffffff !important;
          opacity: 1 !important;
        }
        .notification-dropdown-mobile .text-sm { font-size: 0.8125rem !important; }
        .notification-dropdown-mobile .text-xs { font-size: 0.75rem !important; }
        /* Frosted glass effect in dark mode */
        .dark .notification-dropdown {
          background: rgba(15, 23, 42, 0.7) !important;
          backdrop-filter: blur(20px) !important;
          -webkit-backdrop-filter: blur(20px) !important;
          border-color: rgba(255, 255, 255, 0.1) !important;
          box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37) !important;
          opacity: 1 !important;
        }
        /* Force light text colors in dark mode */
        .dark .notification-dropdown .text-gray-900 {
          color: #f9fafb !important;
        }
        .dark .notification-dropdown .text-gray-800 {
          color: #f3f4f6 !important;
        }
        .dark .notification-dropdown .text-gray-700 {
          color: #e5e7eb !important;
        }
        .dark .notification-dropdown .text-gray-600 {
          color: #d1d5db !important;
        }
        .dark .notification-dropdown .text-gray-500 {
          color: #9ca3af !important;
        }
        /* Ensure borders are visible in dark mode */
        .dark .notification-dropdown .border-gray-200 {
          border-color: #374151 !important;
        }
        .dark .notification-dropdown .border-gray-100,
        .dark .notification-dropdown .border-green-100,
        .dark .notification-dropdown .border-blue-100,
        .dark .notification-dropdown .border-purple-100 {
          border-color: #374151 !important;
        }
        /* Update colored section backgrounds for dark mode */
        .dark .notification-dropdown .bg-green-50 {
          background-color: #1f3a2e !important;
        }
        .dark .notification-dropdown .bg-blue-50 {
          background-color: #1e2a3a !important;
        }
        .dark .notification-dropdown .bg-purple-50 {
          background-color: #2a1f3a !important;
        }
        /* Remove hover effects in dark mode - use very high specificity */
        .dark .notification-dropdown div.hover\:bg-green-50:hover,
        .dark .notification-dropdown div.hover\:bg-blue-50:hover,
        .dark .notification-dropdown div.hover\:bg-green-50:hover,
        .dark .notification-dropdown div.hover\:bg-purple-50:hover,
        .dark .notification-dropdown button.hover\:bg-green-50:hover,
        .dark .notification-dropdown button.hover\:bg-blue-50:hover,
        .dark .notification-dropdown button.hover\:bg-purple-50:hover {
          background-color: transparent !important;
        }
        /* Override any element with hover background classes */
        .dark .notification-dropdown [class*="hover:bg-green-50"]:hover,
        .dark .notification-dropdown [class*="hover:bg-blue-50"]:hover,
        .dark .notification-dropdown [class*="hover:bg-purple-50"]:hover {
          background-color: transparent !important;
        }
        .search-input-placeholder::placeholder {
          font-size: 16px !important;
        }
        @media (min-width: 768px) {
          .search-input-placeholder::placeholder {
            font-size: 18px !important;
          }
        }
      `}</style>
    </>
  );
};

export default React.memo(Header);

