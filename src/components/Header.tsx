import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useLocation, Link, useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { searchLeads } from '../lib/legacyLeadsApi';
import { supabase } from '../lib/supabase';
import type { Lead } from '../lib/supabase';
import type { CombinedLead } from '../lib/legacyLeadsApi';
import { generateSearchVariants, buildMultilingualSearchConditions, transliterateHebrew, transliterateArabic, containsHebrew, containsArabic } from '../lib/transliteration';
import { toast } from 'react-hot-toast';
import { usePushNotifications } from '../hooks/usePushNotifications';
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
  CalendarIcon,
  ArrowRightOnRectangleIcon,
  UserGroupIcon,
  FunnelIcon,
  ChevronDownIcon,
  BoltIcon,
  ChatBubbleLeftRightIcon,
  StarIcon,
} from '@heroicons/react/24/outline';
import { useMsal } from '@azure/msal-react';
import { loginRequest } from '../msalConfig';
import { FaRobot } from 'react-icons/fa';
import { FaWhatsapp } from 'react-icons/fa';
import EmployeeModal from './EmployeeModal';
import RMQMessagesPage from '../pages/RMQMessagesPage';
import HighlightsPanel from './HighlightsPanel';
import { fetchStageNames, areStagesEquivalent, getStageName, getStageColour } from '../lib/stageUtils';

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

const Header: React.FC<HeaderProps> = ({ onMenuClick, onSearchClick, isSearchOpen, setIsSearchOpen, appJustLoggedIn, onOpenAIChat, isMenuOpen, onOpenEmailThread, onOpenWhatsApp, onOpenMessaging }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { sendNotificationForNewMessage } = usePushNotifications();
  const [isSearchActive, setIsSearchActive] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [searchResults, setSearchResults] = useState<CombinedLead[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchTimeoutRef = useRef<NodeJS.Timeout>();
  const isMouseOverSearchRef = useRef(false);
  const masterSearchResultsRef = useRef<CombinedLead[]>([]);
  const exactMatchesRef = useRef<CombinedLead[]>([]);
  const fuzzyMatchesRef = useRef<CombinedLead[]>([]);
  const previousSearchQueryRef = useRef<string>('');
  const fuzzySearchTimeoutRef = useRef<NodeJS.Timeout>();
  const showNoExactMatchTimeoutRef = useRef<NodeJS.Timeout>();
  const isSearchingRef = useRef<boolean>(false);
  const currentSearchQueryRef = useRef<string>(''); // Track current search query to prevent race conditions
  const [showNoExactMatch, setShowNoExactMatch] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const notificationsRef = useRef<HTMLDivElement>(null);
  const searchDropdownRef = useRef<HTMLDivElement>(null);
  const filterDropdownRef = useRef<HTMLDivElement>(null);
  const { instance } = useMsal();
  const [isMsalLoading, setIsMsalLoading] = useState(false);
  const [userAccount, setUserAccount] = useState<any>(null);
  const [isMsalInitialized, setIsMsalInitialized] = useState(false);
  const [userFullName, setUserFullName] = useState<string | null>(null);
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
  const [showMobileQuickActionsDropdown, setShowMobileQuickActionsDropdown] = useState(false);
  const [showSignOutModal, setShowSignOutModal] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const mobileButtonRef = useRef<HTMLButtonElement>(null);
  const [stageOptions, setStageOptions] = useState<string[]>([]);
  const [categoryOptions, setCategoryOptions] = useState<string[]>([]);
  const [sourceOptions, setSourceOptions] = useState<string[]>([]);
  const [languageOptions, setLanguageOptions] = useState<string[]>([]);
  const [hasAppliedFilters, setHasAppliedFilters] = useState(false);
  const [currentUserEmployee, setCurrentUserEmployee] = useState<any>(null);
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
  const [newLeadsCount, setNewLeadsCount] = useState<number>(0);
  const [isSuperUser, setIsSuperUser] = useState<boolean>(false);
  const createdStageIdsRef = useRef<number[]>([0, 11]);
  const schedulerStageIdsRef = useRef<number[]>([10]);
  const stageIdsReadyRef = useRef(false);
  const resolvingStageIdsRef = useRef<Promise<void> | null>(null);

  const unreadCount = rmqUnreadCount + (isSuperUser ? whatsappLeadsUnreadCount : 0) + assignmentNotifications.length + (isSuperUser ? emailLeadUnreadCount : 0);

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
    const loadDismissedAssignments = async () => {
      // Get auth user ID directly from Supabase auth
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser?.id) return;
      
      try {
        // Try to load from database first
        const { data: dismissals, error } = await supabase
          .from('assignment_notification_dismissals')
          .select('dismissal_key')
          .eq('user_id', authUser.id);
        
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
        console.error('Failed to load assignment notification dismissals:', error);
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
  }, []);

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
    // Get auth user ID directly from Supabase auth
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (!authUser?.id) {
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
              user_id: authUser.id,
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
  }, []);

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
          if (!showFilterDropdown && !searchValue.trim() && searchResults.length === 0 && !isSearching && !isMouseOverSearchRef.current) {
            setIsSearchActive(false);
            setSearchResults([]);
            setSearchValue('');
            setHasAppliedFilters(false);
          }
        }
      }, 100); // Small delay to prevent accidental closures
    };

    const handleDropdownClickOutside = (event: Event) => {
      const target = event.target as HTMLElement;
      
      // Close notifications when clicking outside
      if (
        notificationsRef.current &&
        !notificationsRef.current.contains(target as Node)
      ) {
        setShowNotifications(false);
      }
      
      // Close quick actions dropdown when clicking outside
      const quickActionsDropdown = document.querySelector('[data-quick-actions-dropdown]');
      const dropdownMenu = document.querySelector('[data-dropdown-menu]');
      
      // Check if target is a navigation link (Link component renders as <a>)
      const isNavigationLink = target.tagName === 'A' || target.closest('a');
      
      // Close dropdowns if clicking outside both dropdown and menu
      if (showQuickActionsDropdown || showMobileQuickActionsDropdown) {
        // Check if click is outside the button and the dropdown menu
        const clickedOutsideButton = !buttonRef.current?.contains(target as Node) && 
                                   !mobileButtonRef.current?.contains(target as Node);
        const clickedOutsideMenu = !dropdownMenu?.contains(target as Node);
        
        if ((clickedOutsideButton && clickedOutsideMenu) || isNavigationLink) {
          setShowQuickActionsDropdown(false);
          setShowMobileQuickActionsDropdown(false);
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
  }, [showFilterDropdown, showQuickActionsDropdown, showMobileQuickActionsDropdown]);

  // Close quick actions dropdown when route changes
  useEffect(() => {
    setShowQuickActionsDropdown(false);
    setShowMobileQuickActionsDropdown(false);
  }, [location.pathname]);

  // Handle escape key to close dropdowns
  useEffect(() => {
    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowQuickActionsDropdown(false);
        setShowMobileQuickActionsDropdown(false);
        setShowNotifications(false);
        setShowFilterDropdown(false);
      }
    };

    document.addEventListener('keydown', handleEscapeKey);
    return () => document.removeEventListener('keydown', handleEscapeKey);
  }, []);

  // Cleanup function to close all dropdowns when component unmounts
  useEffect(() => {
    return () => {
      setShowQuickActionsDropdown(false);
      setShowMobileQuickActionsDropdown(false);
      setShowNotifications(false);
      setShowFilterDropdown(false);
    };
  }, []);

  // Immediate prefix search - shows results as user types (no delay)
  const performImmediateSearch = async (query: string): Promise<CombinedLead[]> => {
    const trimmed = query.trim();
    if (!trimmed || trimmed.length < 1) return [];

    const lower = trimmed.toLowerCase();
    const digits = trimmed.replace(/\D/g, '');
    const isEmail = trimmed.includes('@');
    const isPhoneLike = digits.length >= 3;
    const isLeadNumber = /^[LC]?\d{1,6}$/i.test(trimmed.replace(/[^\dLC]/gi, ''));
    
    const results: CombinedLead[] = [];
    const seen = new Set<string>();

    try {
      // ALWAYS search by name and email immediately (for queries 2+ chars)
      // This allows users to find leads by typing just a few letters
      if (trimmed.length >= 2) {
        console.log('🔍 [Header Immediate Search] Starting name and email search for:', trimmed);
        
        // Generate name variants for multilingual search
        const nameVariants = generateSearchVariants(trimmed);
        const nameConditions = nameVariants.length > 1
          ? nameVariants.map(v => `name.ilike.${v.toLowerCase()}%`).join(',')
          : `name.ilike.${lower}%`;
        
        // Email prefix search (works even without @ symbol)
        const emailPrefix = lower.split('@')[0] || lower;
        const emailConditions = [
          `email.ilike.${emailPrefix}%`,
          `email.ilike.${lower}%`
        ].join(',');

        // Search new leads by name and email in parallel
        const [newLeadsByName, newLeadsByEmail] = await Promise.all([
          supabase
            .from('leads')
            .select('id, lead_number, name, email, phone, mobile, topic, stage, created_at')
            .or(nameConditions)
            .limit(20),
          supabase
            .from('leads')
            .select('id, lead_number, name, email, phone, mobile, topic, stage, created_at')
            .or(emailConditions)
            .limit(20)
        ]);

        // Process name matches
        if (newLeadsByName.data) {
          newLeadsByName.data.forEach((lead: any) => {
            const key = `new:${lead.id}`;
            if (!seen.has(key)) {
              const leadName = (lead.name || '').toLowerCase();
              const isExactMatch = leadName === lower;
              const isPrefixMatch = leadName.startsWith(lower);
              seen.add(key);
              results.push({
                id: lead.id,
                lead_number: lead.lead_number || '',
                name: lead.name || '',
                email: lead.email || '',
                phone: lead.phone || '',
                mobile: lead.mobile || '',
                topic: lead.topic || '',
                stage: String(lead.stage ?? ''),
                source: '',
                created_at: lead.created_at || '',
                updated_at: lead.created_at || '',
                notes: '',
                special_notes: '',
                next_followup: '',
                probability: '',
                category: '',
                language: '',
                balance: '',
                lead_type: 'new',
                unactivation_reason: null,
                deactivate_note: null,
                isFuzzyMatch: !isExactMatch && !isPrefixMatch,
              });
            }
          });
        }

        // Process email matches
        if (newLeadsByEmail.data) {
          newLeadsByEmail.data.forEach((lead: any) => {
            const key = `new:${lead.id}`;
            if (!seen.has(key)) {
              const leadEmail = (lead.email || '').toLowerCase().trim();
              const searchEmail = lower.trim();
              const hasDomain = lower.includes('@') && lower.split('@').length > 1 && lower.split('@')[1].length > 0;
              const isExactEmailMatch = hasDomain && leadEmail === searchEmail;
              const isEmailPrefixMatch = leadEmail.startsWith(emailPrefix) || leadEmail.startsWith(lower);
              seen.add(key);
              results.push({
                id: lead.id,
                lead_number: lead.lead_number || '',
                name: lead.name || '',
                email: lead.email || '',
                phone: lead.phone || '',
                mobile: lead.mobile || '',
                topic: lead.topic || '',
                stage: String(lead.stage ?? ''),
                source: '',
                created_at: lead.created_at || '',
                updated_at: lead.created_at || '',
                notes: '',
                special_notes: '',
                next_followup: '',
                probability: '',
                category: '',
                language: '',
                balance: '',
                lead_type: 'new',
                unactivation_reason: null,
                deactivate_note: null,
                isFuzzyMatch: !isExactEmailMatch && !isEmailPrefixMatch,
              });
            }
          });
        }

        // Search legacy leads by name and email in parallel
        const [legacyLeadsByName, legacyLeadsByEmail] = await Promise.all([
          supabase
            .from('leads_lead')
            .select('id, lead_number, name, email, phone, mobile, topic, stage, cdate')
            .or(nameConditions)
            .limit(20),
          supabase
            .from('leads_lead')
            .select('id, lead_number, name, email, phone, mobile, topic, stage, cdate')
            .or(emailConditions)
            .limit(20)
        ]);

        // Process legacy name matches
        if (legacyLeadsByName.data) {
          legacyLeadsByName.data.forEach((lead: any) => {
            const key = `legacy:${lead.id}`;
            if (!seen.has(key)) {
              const leadName = (lead.name || '').toLowerCase();
              const isExactMatch = leadName === lower;
              const isPrefixMatch = leadName.startsWith(lower);
              seen.add(key);
              results.push({
                id: `legacy_${lead.id}`,
                lead_number: String(lead.id),
                manual_id: String(lead.id),
                name: lead.name || '',
                email: lead.email || '',
                phone: lead.phone || '',
                mobile: lead.mobile || '',
                topic: lead.topic || '',
                stage: String(lead.stage ?? ''),
                source: '',
                created_at: lead.cdate || '',
                updated_at: lead.cdate || '',
                notes: '',
                special_notes: '',
                next_followup: '',
                probability: '',
                category: '',
                language: '',
                balance: '',
                lead_type: 'legacy',
                unactivation_reason: null,
                deactivate_note: null,
                isFuzzyMatch: !isExactMatch && !isPrefixMatch,
              });
            }
          });
        }

        // Process legacy email matches
        if (legacyLeadsByEmail.data) {
          legacyLeadsByEmail.data.forEach((lead: any) => {
            const key = `legacy:${lead.id}`;
            if (!seen.has(key)) {
              const leadEmail = (lead.email || '').toLowerCase().trim();
              const searchEmail = lower.trim();
              const hasDomain = lower.includes('@') && lower.split('@').length > 1 && lower.split('@')[1].length > 0;
              const isExactEmailMatch = hasDomain && leadEmail === searchEmail;
              const isEmailPrefixMatch = leadEmail.startsWith(emailPrefix) || leadEmail.startsWith(lower);
              seen.add(key);
              results.push({
                id: `legacy_${lead.id}`,
                lead_number: String(lead.id),
                manual_id: String(lead.id),
                name: lead.name || '',
                email: lead.email || '',
                phone: lead.phone || '',
                mobile: lead.mobile || '',
                topic: lead.topic || '',
                stage: String(lead.stage ?? ''),
                source: '',
                created_at: lead.cdate || '',
                updated_at: lead.cdate || '',
                notes: '',
                special_notes: '',
                next_followup: '',
                probability: '',
                category: '',
                language: '',
                balance: '',
                lead_type: 'legacy',
                unactivation_reason: null,
                deactivate_note: null,
                isFuzzyMatch: !isExactEmailMatch && !isEmailPrefixMatch,
              });
            }
          });
        }

        // Search contacts by name and email
        const [contactsByName, contactsByEmail] = await Promise.all([
          supabase
            .from('leads_contact')
            .select(`
              id,
              name,
              email,
              phone,
              mobile,
              newlead_id,
              lead_leadcontact (
                lead_id,
                newlead_id
              )
            `)
            .or(nameConditions)
            .limit(20),
          supabase
            .from('leads_contact')
            .select(`
              id,
              name,
              email,
              phone,
              mobile,
              newlead_id,
              lead_leadcontact (
                lead_id,
                newlead_id
              )
            `)
            .or(emailConditions)
            .limit(20)
        ]);

        // Process contacts and get their associated leads
        const allContacts = [
          ...(contactsByName.data || []),
          ...(contactsByEmail.data || [])
        ];
        const uniqueContacts = Array.from(new Map(allContacts.map(c => [c.id, c])).values());

        if (uniqueContacts.length > 0) {
          const uniqueLeadIds = new Set<string>();
          const uniqueLegacyIds = new Set<number>();
          
          uniqueContacts.forEach((contact: any) => {
            // Get associated leads from contact relationships
            if (contact.lead_leadcontact) {
              const relationships = Array.isArray(contact.lead_leadcontact) 
                ? contact.lead_leadcontact 
                : [contact.lead_leadcontact];
              
              relationships.forEach((rel: any) => {
                if (rel.newlead_id) {
                  uniqueLeadIds.add(String(rel.newlead_id));
                }
                if (rel.lead_id) {
                  uniqueLegacyIds.add(Number(rel.lead_id));
                }
              });
            }
            
            // Also check direct newlead_id on contact
            if (contact.newlead_id) {
              uniqueLeadIds.add(String(contact.newlead_id));
            }
          });

          // Fetch leads associated with contacts
          const [contactLeads, contactLegacyLeads] = await Promise.all([
            uniqueLeadIds.size > 0 ? supabase
              .from('leads')
              .select('id, lead_number, name, email, phone, mobile, topic, stage, created_at')
              .in('id', Array.from(uniqueLeadIds))
              .limit(50) : Promise.resolve({ data: [] }),
            uniqueLegacyIds.size > 0 ? supabase
              .from('leads_lead')
              .select('id, lead_number, name, email, phone, mobile, topic, stage, cdate')
              .in('id', Array.from(uniqueLegacyIds))
              .limit(50) : Promise.resolve({ data: [] })
          ]);

          // Add contact-associated leads to results
          if (contactLeads.data) {
            contactLeads.data.forEach((lead: any) => {
              const key = `new:${lead.id}`;
              if (!seen.has(key)) {
                const matchingContact = uniqueContacts.find((c: any) => {
                  const rels = Array.isArray(c.lead_leadcontact) ? c.lead_leadcontact : (c.lead_leadcontact ? [c.lead_leadcontact] : []);
                  return rels.some((r: any) => r.newlead_id === lead.id) || c.newlead_id === lead.id;
                });
                
                seen.add(key);
                results.push({
                  id: lead.id,
                  lead_number: lead.lead_number || '',
                  name: matchingContact?.name || lead.name || '',
                  email: matchingContact?.email || lead.email || '',
                  phone: matchingContact?.phone || lead.phone || '',
                  mobile: matchingContact?.mobile || lead.mobile || '',
                  topic: lead.topic || '',
                  stage: String(lead.stage ?? ''),
                  source: '',
                  created_at: lead.created_at || '',
                  updated_at: lead.created_at || '',
                  notes: '',
                  special_notes: '',
                  next_followup: '',
                  probability: '',
                  category: '',
                  language: '',
                  balance: '',
                  lead_type: 'new',
                  unactivation_reason: null,
                  deactivate_note: null,
                  isFuzzyMatch: false,
                  isContact: true,
                  contactName: matchingContact?.name || '',
                  isMainContact: false,
                });
              }
            });
          }

          if (contactLegacyLeads.data) {
            contactLegacyLeads.data.forEach((lead: any) => {
              const key = `legacy:${lead.id}`;
              if (!seen.has(key)) {
                const matchingContact = uniqueContacts.find((c: any) => {
                  const rels = Array.isArray(c.lead_leadcontact) ? c.lead_leadcontact : (c.lead_leadcontact ? [c.lead_leadcontact] : []);
                  return rels.some((r: any) => r.lead_id === lead.id);
                });
                
                seen.add(key);
                results.push({
                  id: `legacy_${lead.id}`,
                  lead_number: String(lead.id),
                  manual_id: String(lead.id),
                  name: matchingContact?.name || lead.name || '',
                  email: matchingContact?.email || lead.email || '',
                  phone: matchingContact?.phone || lead.phone || '',
                  mobile: matchingContact?.mobile || lead.mobile || '',
                  topic: lead.topic || '',
                  stage: String(lead.stage ?? ''),
                  source: '',
                  created_at: lead.cdate || '',
                  updated_at: lead.cdate || '',
                  notes: '',
                  special_notes: '',
                  next_followup: '',
                  probability: '',
                  category: '',
                  language: '',
                  balance: '',
                  lead_type: 'legacy',
                  unactivation_reason: null,
                  deactivate_note: null,
                  isFuzzyMatch: false,
                  isContact: true,
                  contactName: matchingContact?.name || '',
                  isMainContact: false,
                });
              }
            });
          }
        }

        console.log('🔍 [Header Immediate Search] Name/Email search results:', {
          totalResults: results.length,
          nameMatches: newLeadsByName.data?.length || 0,
          emailMatches: newLeadsByEmail.data?.length || 0,
          contactMatches: uniqueContacts.length
        });

        // Sort name/email results
        results.sort((a, b) => {
          if (a.isFuzzyMatch !== b.isFuzzyMatch) return a.isFuzzyMatch ? 1 : -1;
          return 0;
        });
      }

      // Email prefix search - immediate results (e.g., "keller@" matches "keller@jfjfj.com")
      // Also handles exact email matches (e.g., "keller@example.com" matches exactly)
      // NOTE: This is now redundant if name/email search above already ran, but kept for exact email matching
      if (isEmail || lower.includes('@')) {
        const emailPrefix = lower.split('@')[0] || lower;
        const hasDomain = lower.includes('@') && lower.split('@').length > 1 && lower.split('@')[1].length > 0;
        
        if (emailPrefix.length >= 1) {
          // Build search conditions: exact match first, then prefix matches
          const emailConditions: string[] = [];
          if (hasDomain) {
            // If full email provided (e.g., "keller@example.com"), search for exact match (no % wildcard)
            emailConditions.push(`email.ilike.${lower}`); // Exact match (case-insensitive, no wildcard)
          }
          // Always include prefix matches (e.g., "keller@" matches "keller@example.com")
          emailConditions.push(`email.ilike.${emailPrefix}%`);
          if (lower !== emailPrefix && !hasDomain) {
            emailConditions.push(`email.ilike.${lower}%`);
          }
          
          // Search new leads
          const { data: newLeads } = await supabase
            .from('leads')
            .select('id, lead_number, name, email, phone, mobile, topic, stage, created_at')
            .or(emailConditions.join(','))
            .limit(20);

          if (newLeads) {
            newLeads.forEach((lead: any) => {
              const key = `new:${lead.id}`;
              if (!seen.has(key)) {
                seen.add(key);
                // Check if email exactly matches (case-insensitive, trimmed)
                const leadEmail = (lead.email || '').toLowerCase().trim();
                const searchEmail = lower.trim();
                const isExactEmailMatch = hasDomain && leadEmail === searchEmail;
                results.push({
                  id: lead.id,
                  lead_number: lead.lead_number || '',
                  name: lead.name || '',
                  email: lead.email || '',
                  phone: lead.phone || '',
                  mobile: lead.mobile || '',
                  topic: lead.topic || '',
                  stage: String(lead.stage ?? ''),
                  source: '',
                  created_at: lead.created_at || '',
                  updated_at: lead.created_at || '',
                  notes: '',
                  special_notes: '',
                  next_followup: '',
                  probability: '',
                  category: '',
                  language: '',
                  balance: '',
                  lead_type: 'new',
                  unactivation_reason: null,
                  deactivate_note: null,
                  isFuzzyMatch: !isExactEmailMatch, // Only exact email matches are not fuzzy
                });
              }
            });
          }

          // Search legacy leads
          const { data: legacyLeads } = await supabase
            .from('leads_lead')
            .select('id, lead_number, name, email, phone, mobile, topic, stage, cdate')
            .or(emailConditions.join(','))
            .limit(20);

          if (legacyLeads) {
            legacyLeads.forEach((lead: any) => {
              const key = `legacy:${lead.id}`;
              if (!seen.has(key)) {
                seen.add(key);
                // Check if email exactly matches (case-insensitive, trimmed)
                const leadEmail = (lead.email || '').toLowerCase().trim();
                const searchEmail = lower.trim();
                const isExactEmailMatch = hasDomain && leadEmail === searchEmail;
                results.push({
                  id: `legacy_${lead.id}`,
                  lead_number: String(lead.id),
                  manual_id: String(lead.id),
                  name: lead.name || '',
                  email: lead.email || '',
                  phone: lead.phone || '',
                  mobile: lead.mobile || '',
                  topic: lead.topic || '',
                  stage: String(lead.stage ?? ''),
                  source: '',
                  created_at: lead.cdate || '',
                  updated_at: lead.cdate || '',
                  notes: '',
                  special_notes: '',
                  next_followup: '',
                  probability: '',
                  category: '',
                  language: '',
                  balance: '',
                  lead_type: 'legacy',
                  unactivation_reason: null,
                  deactivate_note: null,
                  isFuzzyMatch: !isExactEmailMatch, // Only exact email matches are not fuzzy
                });
              }
            });
          }

          // Search contacts - run in parallel for better performance
          const { data: contacts } = await supabase
            .from('leads_contact')
            .select('id, name, email, phone, mobile, newlead_id')
            .or(emailConditions.join(','))
            .limit(20);

          if (contacts && contacts.length > 0) {
            // Collect all unique newlead_ids first
            const uniqueLeadIds = Array.from(new Set(
              contacts
                .map(c => c.newlead_id)
                .filter(id => id != null)
            ));
            
            // Fetch all leads in parallel (single query instead of loop)
            if (uniqueLeadIds.length > 0) {
              const { data: leadsData } = await supabase
                .from('leads')
                .select('id, lead_number, topic, stage, created_at')
                .in('id', uniqueLeadIds);
              
              // Create a map for quick lookup
              const leadsMap = new Map((leadsData || []).map(lead => [lead.id, lead]));
              
              // Process contacts with their corresponding leads
              for (const contact of contacts) {
                if (contact.newlead_id) {
                  const lead = leadsMap.get(contact.newlead_id);
                  if (lead) {
                    const key = `new:${lead.id}:contact:${contact.id}`;
                    if (!seen.has(key)) {
                      seen.add(key);
                      // Check if email exactly matches (case-insensitive, trimmed)
                      const contactEmail = (contact.email || '').toLowerCase().trim();
                      const searchEmail = lower.trim();
                      const isExactEmailMatch = hasDomain && contactEmail === searchEmail;
                      results.push({
                        id: lead.id,
                        lead_number: lead.lead_number || '',
                        name: contact.name || '',
                        email: contact.email || '',
                        phone: contact.phone || '',
                        mobile: contact.mobile || '',
                        topic: lead.topic || '',
                        stage: String(lead.stage ?? ''),
                        source: '',
                        created_at: lead.created_at || '',
                        updated_at: lead.created_at || '',
                        notes: '',
                        special_notes: '',
                        next_followup: '',
                        probability: '',
                        category: '',
                        language: '',
                        balance: '',
                        lead_type: 'new',
                        unactivation_reason: null,
                        deactivate_note: null,
                        isFuzzyMatch: !isExactEmailMatch, // Only exact email matches are not fuzzy
                        isContact: true,
                        contactName: contact.name || '',
                        isMainContact: false,
                      });
                    }
                  }
                }
              }
            }
          }

          // Sort email results: exact matches first, then prefix matches
          results.sort((a, b) => {
            if (a.isFuzzyMatch !== b.isFuzzyMatch) {
              return a.isFuzzyMatch ? 1 : -1; // Exact matches (isFuzzyMatch: false) come first
            }
            return 0;
          });
          
          // Return early if we have email results (prioritize exact/prefix matches)
          if (results.length > 0) {
            return results;
          }
        }
      }

      // Lead number prefix search - use searchLeads for proper exact match and contact handling
      // MUST come BEFORE phone search to prioritize lead numbers over phone numbers
      if (isLeadNumber || (digits.length <= 6 && !isPhoneLike)) {
        const leadNumQuery = trimmed.replace(/[^\dLC]/gi, '');
        const numPart = leadNumQuery.replace(/[^\d]/g, '');
        
        if (numPart.length >= 1) {
          // Use searchLeads for lead number queries - it handles exact matches and contacts properly
          const leadResults = await searchLeads(trimmed);
          console.log('[performImmediateSearch] Lead number search - raw results from searchLeads:', {
            query: trimmed,
            numResults: leadResults.length,
            results: leadResults.map(r => ({
              id: r.id,
              lead_number: r.lead_number,
              name: r.name || r.contactName,
              isContact: r.isContact,
              isFuzzyMatch: r.isFuzzyMatch
            }))
          });
          
          // Mark exact matches based on lead_number
          // For lead number searches, only the lead itself (isContact: false) should be exact match
          // Contacts should be fuzzy matches even if they share the same lead_number
          const numPartLower = numPart.toLowerCase().trim();
          const processedResults = leadResults.map(result => {
            const resultLeadNum = (result.lead_number || '').toLowerCase().trim();
            // Remove any "L" or "C" prefix from result lead_number for comparison
            const resultLeadNumNoPrefix = resultLeadNum.replace(/^[lc]/i, '');
            
            // Only mark as exact match if:
            // 1. The lead_number (without prefix) exactly matches the numeric part
            // 2. AND it's not a contact (isContact: false or undefined)
            const isExactMatch = resultLeadNumNoPrefix === numPartLower && 
                                 (!result.isContact || result.isContact === false);
            const isPrefixMatch = resultLeadNumNoPrefix.startsWith(numPartLower);
            
            const finalIsFuzzy = result.isContact ? true : (!isExactMatch && !isPrefixMatch);
            
            return {
              ...result,
              // For lead number searches, contacts should always be fuzzy matches
              isFuzzyMatch: finalIsFuzzy
            };
          });
          
          console.log('[performImmediateSearch] Lead number search - processed results:', {
            query: trimmed,
            numResults: processedResults.length,
            results: processedResults.map(r => ({
              id: r.id,
              lead_number: r.lead_number,
              name: r.name || r.contactName,
              isContact: r.isContact,
              isFuzzyMatch: r.isFuzzyMatch
            }))
          });
          
          // Sort results: exact matches first
          processedResults.sort((a, b) => {
            if (a.isFuzzyMatch !== b.isFuzzyMatch) return a.isFuzzyMatch ? 1 : -1;
            return 0;
          });

          if (processedResults.length > 0) {
            console.log('[performImmediateSearch] Returning processed results:', processedResults.length);
            return processedResults;
          }
        }
      }

      // Phone/Mobile prefix search - immediate results (handles various formats)
      // Only run if NOT a lead number query (lead numbers take priority)
      if (isPhoneLike && digits.length >= 3 && !isLeadNumber) {
        // Normalize the search digits - handle formats like 00972, 972, 050, 50
        // Remove leading zeros and country code prefixes for better matching
        let normalizedDigits = digits;
        // If starts with 00, remove it (00972... -> 972...)
        if (normalizedDigits.startsWith('00')) {
          normalizedDigits = normalizedDigits.substring(2);
        }
        // If starts with 972, keep it but also try without
        const searchVariants = [normalizedDigits];
        if (normalizedDigits.startsWith('972')) {
          // Also search for local format (remove 972 prefix)
          const localFormat = normalizedDigits.substring(3);
          if (localFormat.length >= 3) {
            searchVariants.push(localFormat);
          }
        }
        // Also try with leading 0 (for local format like 050...)
        if (!normalizedDigits.startsWith('0') && normalizedDigits.length >= 3) {
          searchVariants.push('0' + normalizedDigits);
        }
        // Also try original digits (in case user typed exact format)
        if (!searchVariants.includes(digits)) {
          searchVariants.push(digits);
        }

        console.log('🔍 [Header Phone Search] Phone search started:', {
          query: trimmed,
          digits,
          normalizedDigits,
          searchVariants,
          isPhoneLike,
          isLeadNumber
        });

        // Helper function to validate if a phone match is meaningful
        // Rejects matches where numbers are too different
        const isValidPhoneMatch = (searchDigits: string, phoneDigits: string, matchType: 'prefix' | 'suffix'): boolean => {
          if (!phoneDigits || phoneDigits.length === 0) return false;
          
          const searchLen = searchDigits.length;
          const phoneLen = phoneDigits.length;
          
          // Exact match always passes
          if (phoneDigits === searchDigits) return true;
          
          // For prefix matches: require at least 6 digits match, and phone should be similar length
          if (matchType === 'prefix') {
            if (searchLen < 6) return false; // Need at least 6 digits for prefix match
            // Phone should be within reasonable range (not more than 3 digits longer)
            if (phoneLen > searchLen + 3) return false;
            // Phone should not be significantly shorter (at least 80% of search length)
            if (phoneLen < searchLen * 0.8) return false;
            return true;
          }
          
          // For suffix matches: require at least 7 digits match (more strict for suffix)
          if (matchType === 'suffix') {
            if (searchLen < 7) return false; // Need at least 7 digits for suffix match
            
            // Special case: if phone ends with search digits, and phone is longer,
            // allow up to 4 digits difference (for country code prefixes like +972)
            // This handles cases like: search "0507264998" (10 digits) matching "+9720507264998" (13 digits)
            if (phoneLen > searchLen) {
              const lengthDiff = phoneLen - searchLen;
              // Allow up to 4 digits difference for country code prefixes
              if (lengthDiff <= 4) {
                // Verify the phone actually ends with the search digits
                if (phoneDigits.endsWith(searchDigits)) {
                  return true;
                }
              }
            }
            
            // For same-length or shorter phones, use strict matching (within 2 digits)
            if (Math.abs(phoneLen - searchLen) <= 2) return true;
            
            return false;
          }
          
          return false;
        };

        // Build OR conditions for all variants
        // Use prefix matching (variant%) and suffix matching (%variant) but NOT contains matching (%variant%)
        // Only include variants that are long enough for meaningful matches
        const phoneConditions: string[] = [];
        const mobileConditions: string[] = [];
        searchVariants.forEach(variant => {
          // Prefix match: phone starts with variant (only if variant is at least 6 digits)
          if (variant.length >= 6) {
            phoneConditions.push(`phone.ilike.${variant}%`);
            mobileConditions.push(`mobile.ilike.${variant}%`);
          }
          // Suffix match: phone ends with variant (only if variant is at least 7 digits for stricter matching)
          if (variant.length >= 7) {
            phoneConditions.push(`phone.ilike.%${variant}`);
            mobileConditions.push(`mobile.ilike.%${variant}`);
          }
        });

        console.log('🔍 [Header Phone Search] Search conditions:', {
          phoneConditions,
          mobileConditions,
          combinedConditions: [...phoneConditions, ...mobileConditions].join(',')
        });

        // Search new leads
        const { data: newLeads } = await supabase
          .from('leads')
          .select('id, lead_number, name, email, phone, mobile, topic, stage, created_at')
          .or([...phoneConditions, ...mobileConditions].join(','))
          .limit(50);

        if (newLeads) {
          newLeads.forEach((lead: any) => {
            const key = `new:${lead.id}`;
            if (!seen.has(key)) {
              const phoneDigits = (lead.phone || '').replace(/\D/g, '');
              const mobileDigits = (lead.mobile || '').replace(/\D/g, '');
              
              // Check all variants for prefix or suffix matches (NOT middle matches)
              // Validate that matches are meaningful (similar length, significant overlap)
              let isPrefixMatch = false;
              let isSuffixMatch = false;
              
              for (const variant of searchVariants) {
                // Prefix match: phone starts with variant AND passes validation
                if (phoneDigits.startsWith(variant) && isValidPhoneMatch(variant, phoneDigits, 'prefix')) {
                  isPrefixMatch = true;
                  break;
                }
                if (mobileDigits.startsWith(variant) && isValidPhoneMatch(variant, mobileDigits, 'prefix')) {
                  isPrefixMatch = true;
                  break;
                }
                // Suffix match: phone ends with variant AND passes validation
                if (variant.length >= 7 && phoneDigits.endsWith(variant) && isValidPhoneMatch(variant, phoneDigits, 'suffix')) {
                  isSuffixMatch = true;
                  break;
                }
                if (variant.length >= 7 && mobileDigits.endsWith(variant) && isValidPhoneMatch(variant, mobileDigits, 'suffix')) {
                  isSuffixMatch = true;
                  break;
                }
              }
              
              if (isPrefixMatch || isSuffixMatch) {
                seen.add(key);
                results.push({
                  id: lead.id,
                  lead_number: lead.lead_number || '',
                  name: lead.name || '',
                  email: lead.email || '',
                  phone: lead.phone || '',
                  mobile: lead.mobile || '',
                  topic: lead.topic || '',
                  stage: String(lead.stage ?? ''),
                  source: '',
                  created_at: lead.created_at || '',
                  updated_at: lead.created_at || '',
                  notes: '',
                  special_notes: '',
                  next_followup: '',
                  probability: '',
                  category: '',
                  language: '',
                  balance: '',
                  lead_type: 'new',
                  unactivation_reason: null,
                  deactivate_note: null,
                  isFuzzyMatch: !isPrefixMatch,
                });
              }
            }
          });
        }

        // Search legacy leads
        const { data: legacyLeads } = await supabase
          .from('leads_lead')
          .select('id, lead_number, name, email, phone, mobile, topic, stage, cdate')
          .or([...phoneConditions, ...mobileConditions].join(','))
          .limit(50);

        console.log('🔍 [Header Phone Search] Legacy leads query result:', {
          count: legacyLeads?.length || 0,
          sample: legacyLeads?.[0] ? {
            id: legacyLeads[0].id,
            phone: legacyLeads[0].phone,
            mobile: legacyLeads[0].mobile
          } : null
        });

        if (legacyLeads) {
          legacyLeads.forEach((lead: any) => {
            const key = `legacy:${lead.id}`;
            if (!seen.has(key)) {
              const phoneDigits = (lead.phone || '').replace(/\D/g, '');
              const mobileDigits = (lead.mobile || '').replace(/\D/g, '');
              
              // Check all variants for exact matches first, then prefix/suffix matches (NOT middle matches)
              // Validate that matches are meaningful (similar length, significant overlap)
              let isExactMatch = false;
              let isPrefixMatch = false;
              let isSuffixMatch = false;
              
              for (const variant of searchVariants) {
                // Check for exact match
                if (phoneDigits === variant || mobileDigits === variant) {
                  isExactMatch = true;
                  break;
                }
                // Check for prefix match with validation
                if (phoneDigits.startsWith(variant) && isValidPhoneMatch(variant, phoneDigits, 'prefix')) {
                  isPrefixMatch = true;
                  break;
                }
                if (mobileDigits.startsWith(variant) && isValidPhoneMatch(variant, mobileDigits, 'prefix')) {
                  isPrefixMatch = true;
                  break;
                }
                // Check for suffix match with validation (only if variant is at least 7 digits)
                if (variant.length >= 7 && phoneDigits.endsWith(variant) && isValidPhoneMatch(variant, phoneDigits, 'suffix')) {
                  isSuffixMatch = true;
                  break;
                }
                if (variant.length >= 7 && mobileDigits.endsWith(variant) && isValidPhoneMatch(variant, mobileDigits, 'suffix')) {
                  isSuffixMatch = true;
                  break;
                }
              }
              
              if (isExactMatch || isPrefixMatch || isSuffixMatch) {
                seen.add(key);
                results.push({
                  id: `legacy_${lead.id}`,
                  lead_number: String(lead.id),
                  manual_id: String(lead.id),
                  name: lead.name || '',
                  email: lead.email || '',
                  phone: lead.phone || '',
                  mobile: lead.mobile || '',
                  topic: lead.topic || '',
                  stage: String(lead.stage ?? ''),
                  source: '',
                  created_at: lead.cdate || '',
                  updated_at: lead.cdate || '',
                  notes: '',
                  special_notes: '',
                  next_followup: '',
                  probability: '',
                  category: '',
                  language: '',
                  balance: '',
                  lead_type: 'legacy',
                  unactivation_reason: null,
                  deactivate_note: null,
                  isFuzzyMatch: !isExactMatch && !isPrefixMatch, // Exact or prefix match = not fuzzy
                });
              }
            }
          });
        }

        // Search contacts - CRITICAL: This was missing!
        console.log('🔍 [Header Phone Search] Searching contacts with variants:', searchVariants);
        
        // DEBUG: Check specific contact if query matches pattern
        if (digits === '9720507264998' || digits === '0507264998') {
          const { data: debugContact } = await supabase
            .from('leads_contact')
            .select('id, name, phone, mobile, newlead_id')
            .eq('id', 53550)
            .single();
          
          console.log('🔍 [Header Phone Search] DEBUG - Contact 53550:', {
            found: !!debugContact,
            contact: debugContact ? {
              id: debugContact.id,
              name: debugContact.name,
              phone: debugContact.phone,
              phoneDigits: (debugContact.phone || '').replace(/\D/g, ''),
              mobile: debugContact.mobile,
              mobileDigits: (debugContact.mobile || '').replace(/\D/g, ''),
              newlead_id: debugContact.newlead_id
            } : null,
            searchQuery: trimmed,
            searchDigits: digits,
            searchVariants: searchVariants,
            wouldMatch: debugContact ? {
              phoneMatch: searchVariants.some(v => {
                const phoneDigits = (debugContact.phone || '').replace(/\D/g, '');
                return (phoneDigits.startsWith(v) && isValidPhoneMatch(v, phoneDigits, 'prefix')) || 
                       (v.length >= 7 && phoneDigits.endsWith(v) && isValidPhoneMatch(v, phoneDigits, 'suffix'));
              }),
              mobileMatch: searchVariants.some(v => {
                const mobileDigits = (debugContact.mobile || '').replace(/\D/g, '');
                return (mobileDigits.startsWith(v) && isValidPhoneMatch(v, mobileDigits, 'prefix')) || 
                       (v.length >= 7 && mobileDigits.endsWith(v) && isValidPhoneMatch(v, mobileDigits, 'suffix'));
              })
            } : null
          });
        }
        
        // Build contact search conditions - use prefix and suffix matching (NOT contains)
        // Only include variants that are long enough for meaningful matches
        const contactPhoneConditions: string[] = [];
        const contactMobileConditions: string[] = [];
        searchVariants.forEach(variant => {
          // Prefix match: phone starts with variant (only if variant is at least 6 digits)
          if (variant.length >= 6) {
            contactPhoneConditions.push(`phone.ilike.${variant}%`);
            contactMobileConditions.push(`mobile.ilike.${variant}%`);
          }
          // Suffix match: phone ends with variant (only if variant is at least 7 digits for stricter matching)
          if (variant.length >= 7) {
            contactPhoneConditions.push(`phone.ilike.%${variant}`);
            contactMobileConditions.push(`mobile.ilike.%${variant}`);
          }
        });

        const { data: contacts, error: contactsError } = await supabase
          .from('leads_contact')
          .select(`
            id,
            name,
            email,
            phone,
            mobile,
            newlead_id,
            lead_leadcontact (
              lead_id,
              newlead_id
            )
          `)
          .or([...contactPhoneConditions, ...contactMobileConditions].join(','))
          .limit(50);

        console.log('🔍 [Header Phone Search] Contacts query result:', {
          count: contacts?.length || 0,
          error: contactsError,
          queryConditions: [...contactPhoneConditions, ...contactMobileConditions].join(','),
          allContacts: contacts?.map(c => ({
            id: c.id,
            name: c.name,
            phone: c.phone,
            phoneDigits: (c.phone || '').replace(/\D/g, ''),
            mobile: c.mobile,
            mobileDigits: (c.mobile || '').replace(/\D/g, ''),
            newlead_id: c.newlead_id,
            relationships: c.lead_leadcontact
          })) || []
        });

        if (contacts && contacts.length > 0) {
          // Collect all unique lead IDs from contacts
          const uniqueLeadIds = new Set<string>();
          const uniqueLegacyIds = new Set<number>();
          
          contacts.forEach((contact: any) => {
            // Check if contact phone/mobile matches any variant
            const contactPhoneDigits = (contact.phone || '').replace(/\D/g, '');
            const contactMobileDigits = (contact.mobile || '').replace(/\D/g, '');
            
            console.log('🔍 [Header Phone Search] Checking contact match:', {
              contactId: contact.id,
              contactPhone: contact.phone,
              contactPhoneDigits,
              contactMobile: contact.mobile,
              contactMobileDigits,
              searchVariants
            });
            
            let contactMatches = false;
            let matchReason = '';
            for (const variant of searchVariants) {
              // Exact match: always accept
              if (contactPhoneDigits === variant || contactMobileDigits === variant) {
                contactMatches = true;
                matchReason = `exact match: ${contactPhoneDigits === variant ? 'phone' : 'mobile'} === ${variant}`;
                break;
              }
              // Prefix match: phone starts with variant AND passes validation
              if (contactPhoneDigits.startsWith(variant)) {
                const isValid = isValidPhoneMatch(variant, contactPhoneDigits, 'prefix');
                console.log('🔍 [Header Phone Search] Prefix check:', {
                  variant,
                  contactPhoneDigits,
                  startsWith: true,
                  isValid,
                  reason: isValid ? 'prefix match passed' : 'prefix match failed validation'
                });
                if (isValid) {
                  contactMatches = true;
                  matchReason = `prefix match: phone starts with ${variant}`;
                  break;
                }
              }
              if (contactMobileDigits.startsWith(variant)) {
                const isValid = isValidPhoneMatch(variant, contactMobileDigits, 'prefix');
                console.log('🔍 [Header Phone Search] Prefix check (mobile):', {
                  variant,
                  contactMobileDigits,
                  startsWith: true,
                  isValid,
                  reason: isValid ? 'prefix match passed' : 'prefix match failed validation'
                });
                if (isValid) {
                  contactMatches = true;
                  matchReason = `prefix match: mobile starts with ${variant}`;
                  break;
                }
              }
              // Suffix match: phone ends with variant AND passes validation (only if variant is at least 7 digits)
              if (variant.length >= 7 && contactPhoneDigits.endsWith(variant)) {
                const isValid = isValidPhoneMatch(variant, contactPhoneDigits, 'suffix');
                console.log('🔍 [Header Phone Search] Suffix check:', {
                  variant,
                  contactPhoneDigits,
                  endsWith: true,
                  isValid,
                  reason: isValid ? 'suffix match passed' : 'suffix match failed validation'
                });
                if (isValid) {
                  contactMatches = true;
                  matchReason = `suffix match: phone ends with ${variant}`;
                  break;
                }
              }
              if (variant.length >= 7 && contactMobileDigits.endsWith(variant)) {
                const isValid = isValidPhoneMatch(variant, contactMobileDigits, 'suffix');
                console.log('🔍 [Header Phone Search] Suffix check (mobile):', {
                  variant,
                  contactMobileDigits,
                  endsWith: true,
                  isValid,
                  reason: isValid ? 'suffix match passed' : 'suffix match failed validation'
                });
                if (isValid) {
                  contactMatches = true;
                  matchReason = `suffix match: mobile ends with ${variant}`;
                  break;
                }
              }
            }
            
            console.log('🔍 [Header Phone Search] Contact match result:', {
              contactId: contact.id,
              contactMatches,
              matchReason: matchReason || 'no match found'
            });
            
            if (!contactMatches) return;
            
            // Get associated leads from contact relationships
            if (contact.lead_leadcontact) {
              const relationships = Array.isArray(contact.lead_leadcontact) 
                ? contact.lead_leadcontact 
                : [contact.lead_leadcontact];
              
              relationships.forEach((rel: any) => {
                if (rel.newlead_id) {
                  uniqueLeadIds.add(String(rel.newlead_id));
                }
                if (rel.lead_id) {
                  uniqueLegacyIds.add(Number(rel.lead_id));
                }
              });
            }
            
            // Also check direct newlead_id on contact
            if (contact.newlead_id) {
              uniqueLeadIds.add(String(contact.newlead_id));
            }
          });

          console.log('🔍 [Header Phone Search] Contact lead associations:', {
            uniqueLeadIds: Array.from(uniqueLeadIds),
            uniqueLegacyIds: Array.from(uniqueLegacyIds),
            totalContacts: contacts.length,
            matchedContacts: contacts.filter((c: any) => {
              const phoneDigits = (c.phone || '').replace(/\D/g, '');
              const mobileDigits = (c.mobile || '').replace(/\D/g, '');
              return searchVariants.some(v => 
                (phoneDigits === v || mobileDigits === v) || // Exact match
                (phoneDigits.startsWith(v) && isValidPhoneMatch(v, phoneDigits, 'prefix')) ||
                (mobileDigits.startsWith(v) && isValidPhoneMatch(v, mobileDigits, 'prefix')) ||
                (v.length >= 7 && phoneDigits.endsWith(v) && isValidPhoneMatch(v, phoneDigits, 'suffix')) ||
                (v.length >= 7 && mobileDigits.endsWith(v) && isValidPhoneMatch(v, mobileDigits, 'suffix'))
              );
            }).length
          });

          // If contacts have no lead associations, still show them as standalone results
          const contactsWithoutLeads = contacts.filter((contact: any) => {
            const contactPhoneDigits = (contact.phone || '').replace(/\D/g, '');
            const contactMobileDigits = (contact.mobile || '').replace(/\D/g, '');
            
            let contactMatches = false;
            for (const variant of searchVariants) {
              // Exact match: always accept
              if (contactPhoneDigits === variant || contactMobileDigits === variant) {
                contactMatches = true;
                break;
              }
              // Prefix match: phone starts with variant AND passes validation
              if (contactPhoneDigits.startsWith(variant) && isValidPhoneMatch(variant, contactPhoneDigits, 'prefix')) {
                contactMatches = true;
                break;
              }
              if (contactMobileDigits.startsWith(variant) && isValidPhoneMatch(variant, contactMobileDigits, 'prefix')) {
                contactMatches = true;
                break;
              }
              // Suffix match: phone ends with variant AND passes validation (only if variant is at least 7 digits)
              if (variant.length >= 7 && contactPhoneDigits.endsWith(variant) && isValidPhoneMatch(variant, contactPhoneDigits, 'suffix')) {
                contactMatches = true;
                break;
              }
              if (variant.length >= 7 && contactMobileDigits.endsWith(variant) && isValidPhoneMatch(variant, contactMobileDigits, 'suffix')) {
                contactMatches = true;
                break;
              }
            }
            
            if (!contactMatches) return false;
            
            // Check if contact has any lead associations
            const hasLeadAssociations = 
              (contact.lead_leadcontact && (
                (Array.isArray(contact.lead_leadcontact) && contact.lead_leadcontact.length > 0) ||
                (!Array.isArray(contact.lead_leadcontact) && contact.lead_leadcontact)
              )) ||
              contact.newlead_id;
            
            return !hasLeadAssociations;
          });

          // Add contacts without lead associations as standalone results
          console.log('🔍 [Header Phone Search] Contacts without leads:', {
            count: contactsWithoutLeads.length,
            contacts: contactsWithoutLeads.map((c: any) => ({
              id: c.id,
              name: c.name,
              phone: c.phone,
              phoneDigits: (c.phone || '').replace(/\D/g, ''),
              mobile: c.mobile,
              mobileDigits: (c.mobile || '').replace(/\D/g, ''),
              hasAssociations: !!(c.lead_leadcontact || c.newlead_id)
            }))
          });

          contactsWithoutLeads.forEach((contact: any) => {
            const key = `contact:${contact.id}`;
            if (!seen.has(key)) {
              seen.add(key);
              console.log('🔍 [Header Phone Search] Adding standalone contact:', {
                id: contact.id,
                name: contact.name,
                phone: contact.phone,
                mobile: contact.mobile
              });
              results.push({
                id: `contact_${contact.id}`,
                lead_number: '',
                name: contact.name || '',
                email: contact.email || '',
                phone: contact.phone || '',
                mobile: contact.mobile || '',
                topic: '',
                stage: '',
                source: '',
                created_at: '',
                updated_at: '',
                notes: '',
                special_notes: '',
                next_followup: '',
                probability: '',
                category: '',
                language: '',
                balance: '',
                lead_type: 'contact',
                unactivation_reason: null,
                deactivate_note: null,
                isFuzzyMatch: false,
                isContact: true,
                contactName: contact.name || '',
                isMainContact: false,
              });
            }
          });

          // Fetch new leads associated with contacts
          if (uniqueLeadIds.size > 0) {
            const { data: contactLeads, error: contactLeadsError } = await supabase
              .from('leads')
              .select('id, lead_number, name, email, phone, mobile, topic, stage, created_at')
              .in('id', Array.from(uniqueLeadIds))
              .limit(50);

            console.log('🔍 [Header Phone Search] Fetched leads from contacts:', {
              count: contactLeads?.length || 0,
              error: contactLeadsError,
              leadIds: contactLeads?.map(l => l.id) || []
            });

            if (contactLeads) {
              contactLeads.forEach((lead: any) => {
                const key = `new:${lead.id}`;
                if (!seen.has(key)) {
                  // Find the contact that matched
                  const matchingContact = contacts.find((c: any) => {
                    const rels = Array.isArray(c.lead_leadcontact) ? c.lead_leadcontact : (c.lead_leadcontact ? [c.lead_leadcontact] : []);
                    return rels.some((r: any) => r.newlead_id === lead.id) || c.newlead_id === lead.id;
                  });
                  
                  seen.add(key);
                  results.push({
                    id: lead.id,
                    lead_number: lead.lead_number || '',
                    name: matchingContact?.name || lead.name || '',
                    email: matchingContact?.email || lead.email || '',
                    phone: matchingContact?.phone || lead.phone || '',
                    mobile: matchingContact?.mobile || lead.mobile || '',
                    topic: lead.topic || '',
                    stage: String(lead.stage ?? ''),
                    source: '',
                    created_at: lead.created_at || '',
                    updated_at: lead.created_at || '',
                    notes: '',
                    special_notes: '',
                    next_followup: '',
                    probability: '',
                    category: '',
                    language: '',
                    balance: '',
                    lead_type: 'new',
                    unactivation_reason: null,
                    deactivate_note: null,
                    isFuzzyMatch: false, // Contact matches are considered exact
                    isContact: true,
                    contactName: matchingContact?.name || '',
                    isMainContact: false,
                  });
                }
              });
            }
          }

          // Fetch legacy leads associated with contacts
          if (uniqueLegacyIds.size > 0) {
            const { data: contactLegacyLeads, error: contactLegacyLeadsError } = await supabase
              .from('leads_lead')
              .select('id, lead_number, name, email, phone, mobile, topic, stage, cdate')
              .in('id', Array.from(uniqueLegacyIds))
              .limit(50);

            console.log('🔍 [Header Phone Search] Fetched legacy leads from contacts:', {
              count: contactLegacyLeads?.length || 0,
              error: contactLegacyLeadsError,
              leadIds: contactLegacyLeads?.map(l => l.id) || []
            });

            if (contactLegacyLeads) {
              contactLegacyLeads.forEach((lead: any) => {
                const key = `legacy:${lead.id}`;
                if (!seen.has(key)) {
                  // Find the contact that matched
                  const matchingContact = contacts.find((c: any) => {
                    const rels = Array.isArray(c.lead_leadcontact) ? c.lead_leadcontact : (c.lead_leadcontact ? [c.lead_leadcontact] : []);
                    return rels.some((r: any) => r.lead_id === lead.id);
                  });
                  
                  seen.add(key);
                  results.push({
                    id: `legacy_${lead.id}`,
                    lead_number: String(lead.id),
                    manual_id: String(lead.id),
                    name: matchingContact?.name || lead.name || '',
                    email: matchingContact?.email || lead.email || '',
                    phone: matchingContact?.phone || lead.phone || '',
                    mobile: matchingContact?.mobile || lead.mobile || '',
                    topic: lead.topic || '',
                    stage: String(lead.stage ?? ''),
                    source: '',
                    created_at: lead.cdate || '',
                    updated_at: lead.cdate || '',
                    notes: '',
                    special_notes: '',
                    next_followup: '',
                    probability: '',
                    category: '',
                    language: '',
                    balance: '',
                    lead_type: 'legacy',
                    unactivation_reason: null,
                    deactivate_note: null,
                    isFuzzyMatch: false, // Contact matches are considered exact
                    isContact: true,
                    contactName: matchingContact?.name || '',
                    isMainContact: false,
                  });
                }
              });
            }
          }
        }

        console.log('🔍 [Header Phone Search] Final results before sorting:', {
          totalResults: results.length,
          results: results.map(r => ({
            id: r.id,
            lead_number: r.lead_number,
            name: r.name || r.contactName,
            isContact: r.isContact,
            phone: r.phone,
            mobile: r.mobile
          }))
        });

        // Sort results: prefix matches first
        results.sort((a, b) => {
          if (a.isFuzzyMatch !== b.isFuzzyMatch) return a.isFuzzyMatch ? 1 : -1;
          return 0;
        });

        console.log('🔍 [Header Phone Search] Final results after sorting:', {
          totalResults: results.length,
          exactMatches: results.filter(r => !r.isFuzzyMatch).length,
          fuzzyMatches: results.filter(r => r.isFuzzyMatch).length
        });

        if (results.length > 0) {
          return results;
        }
      }

      // Name search with multilingual variants - immediate results for prefix matches
      // Only search by name if query is not email, phone, or lead number
      if (!isEmail && !isPhoneLike && !isLeadNumber && trimmed.length >= 2) {
        const nameVariants = generateSearchVariants(trimmed);
        
        // Build OR conditions for all variants (prefix match for speed)
        const nameConditions = nameVariants.length > 1
          ? nameVariants.map(v => `name.ilike.${v.toLowerCase()}%`).join(',')
          : `name.ilike.${lower}%`;

        // Search new leads by name
        const { data: newLeads } = await supabase
          .from('leads')
          .select('id, lead_number, name, email, phone, mobile, topic, stage, created_at')
          .or(nameConditions)
          .limit(20);

        if (newLeads) {
          newLeads.forEach((lead: any) => {
            const key = `new:${lead.id}`;
            if (!seen.has(key)) {
              const leadName = (lead.name || '').toLowerCase();
              const isExactMatch = leadName === lower;
              const isPrefixMatch = leadName.startsWith(lower);
              seen.add(key);
              results.push({
                id: lead.id,
                lead_number: lead.lead_number || '',
                name: lead.name || '',
                email: lead.email || '',
                phone: lead.phone || '',
                mobile: lead.mobile || '',
                topic: lead.topic || '',
                stage: String(lead.stage ?? ''),
                source: '',
                created_at: lead.created_at || '',
                updated_at: lead.created_at || '',
                notes: '',
                special_notes: '',
                next_followup: '',
                probability: '',
                category: '',
                language: '',
                balance: '',
                lead_type: 'new',
                unactivation_reason: null,
                deactivate_note: null,
                isFuzzyMatch: !isExactMatch && !isPrefixMatch,
              });
            }
          });
        }

        // Search legacy leads by name
        const { data: legacyLeads } = await supabase
          .from('leads_lead')
          .select('id, lead_number, name, email, phone, mobile, topic, stage, cdate')
          .or(nameConditions)
          .limit(20);

        if (legacyLeads) {
          legacyLeads.forEach((lead: any) => {
            const key = `legacy:${lead.id}`;
            if (!seen.has(key)) {
              const leadName = (lead.name || '').toLowerCase();
              const isExactMatch = leadName === lower;
              const isPrefixMatch = leadName.startsWith(lower);
              seen.add(key);
              results.push({
                id: `legacy_${lead.id}`,
                lead_number: String(lead.id),
                manual_id: String(lead.id),
                name: lead.name || '',
                email: lead.email || '',
                phone: lead.phone || '',
                mobile: lead.mobile || '',
                topic: lead.topic || '',
                stage: String(lead.stage ?? ''),
                source: '',
                created_at: lead.cdate || '',
                updated_at: lead.cdate || '',
                notes: '',
                special_notes: '',
                next_followup: '',
                probability: '',
                category: '',
                language: '',
                balance: '',
                lead_type: 'legacy',
                unactivation_reason: null,
                deactivate_note: null,
                isFuzzyMatch: !isExactMatch && !isPrefixMatch,
              });
            }
          });
        }

        // Sort name results: exact matches first, then prefix matches
        results.sort((a, b) => {
          if (a.isFuzzyMatch !== b.isFuzzyMatch) return a.isFuzzyMatch ? 1 : -1;
          return 0;
        });

        if (results.length > 0) {
          return results;
        }
      }

      // Final sort: exact matches first, then prefix matches, then fuzzy matches
      // Also prioritize name/email matches over other types
      results.sort((a, b) => {
        // Exact matches first
        if (a.isFuzzyMatch !== b.isFuzzyMatch) {
          return a.isFuzzyMatch ? 1 : -1;
        }
        // Prioritize new leads over legacy
        if (a.lead_type !== b.lead_type) {
          return a.lead_type === 'new' ? -1 : 1;
        }
        return 0;
      });

      console.log('🔍 [Header Immediate Search] Final results:', {
        total: results.length,
        exactMatches: results.filter(r => !r.isFuzzyMatch).length,
        fuzzyMatches: results.filter(r => r.isFuzzyMatch).length
      });

      return results;
    } catch (error) {
      console.error('Error performing immediate search:', error);
      return [];
    }
  };

  // Fuzzy search function - limited to 5 best results for name matching, sorted by relevance
  const performFuzzySearch = async (query: string): Promise<CombinedLead[]> => {
    const trimmed = query.trim();
    if (!trimmed || trimmed.length < 2) return [];

    // Only perform fuzzy search on names if query is long enough and no immediate results found
    // Use the existing searchLeads function but limit and prioritize results
    try {
      const allResults = await searchLeads(trimmed);
      
      // Sort by relevance: exact matches > starts with > contains
      const lower = trimmed.toLowerCase();
      const scoredResults = allResults.map(lead => {
        const name = (lead.contactName || lead.name || '').toLowerCase();
        const email = (lead.email || '').toLowerCase();
        const leadNumber = (lead.lead_number || '').toLowerCase();
        
        let score = 0;
        // Exact match gets highest score
        if (name === lower || email === lower || leadNumber === trimmed) {
          score = 100;
        } 
        // Starts with gets high score
        else if (name.startsWith(lower) || email.startsWith(lower) || leadNumber.startsWith(trimmed)) {
          score = 50;
        } 
        // Contains gets medium score
        else if (name.includes(lower) || email.includes(lower)) {
          // Calculate position - earlier in string = higher score
          const namePos = name.indexOf(lower);
          const emailPos = email.indexOf(lower);
          const earliestPos = namePos >= 0 && emailPos >= 0 
            ? Math.min(namePos, emailPos)
            : namePos >= 0 ? namePos : emailPos;
          score = 30 - Math.min(earliestPos, 20); // Closer to start = higher score (max 30)
        } 
        // No match
        else {
          score = 0;
        }
        
        return { lead, score };
      });
      
      // Sort by score (highest first = closest match first), then limit to 5
      scoredResults.sort((a, b) => b.score - a.score);
      const topResults = scoredResults.slice(0, 5).map(item => {
        // CRITICAL: Preserve the isFuzzyMatch flag from searchLeads
        // If searchLeads marked it as an exact match (isFuzzyMatch: false), keep it as exact
        // Only mark as fuzzy if it wasn't already marked as exact
        const isExactMatch = item.lead.isFuzzyMatch === false;
        return {
          ...item.lead,
          isFuzzyMatch: isExactMatch ? false : true, // Preserve exact matches, mark others as fuzzy
        };
      });
      
      return topResults;
    } catch (error) {
      console.error('Error performing fuzzy search:', error);
      return [];
    }
  };

  // Handle search - immediate prefix matching with fuzzy fallback
  useEffect(() => {
    // Clear any existing timeouts
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    if (fuzzySearchTimeoutRef.current) {
      clearTimeout(fuzzySearchTimeoutRef.current);
    }
    if (showNoExactMatchTimeoutRef.current) {
      clearTimeout(showNoExactMatchTimeoutRef.current);
    }
    
    // Reset "no exact match" state when search value changes (user is still typing)
    setShowNoExactMatch(false);

    const trimmedQuery = searchValue.trim();

    if (!trimmedQuery) {
      setSearchResults([]);
      masterSearchResultsRef.current = [];
      exactMatchesRef.current = [];
      fuzzyMatchesRef.current = [];
      previousSearchQueryRef.current = '';
      currentSearchQueryRef.current = '';
      setIsSearching(false);
      isSearchingRef.current = false;
      return;
    }

    // Update current search query ref to track which query we're processing
    currentSearchQueryRef.current = trimmedQuery;

    // Perform immediate prefix search (no delay for emails, phones, lead numbers)
    setIsSearching(true);
    isSearchingRef.current = true;
    
    (async () => {
      try {
        // First, try immediate prefix search (for emails, phones, lead numbers)
        const immediateResults = await performImmediateSearch(trimmedQuery);
        
        // CRITICAL: Check if query has changed while we were searching
        if (currentSearchQueryRef.current !== trimmedQuery) {
          // Query changed, ignore these results
          return;
        }
        
        if (immediateResults.length > 0) {
          // Re-evaluate exact matches based on the trimmed query to ensure accuracy for ALL search types
          const lowerTrimmed = trimmedQuery.toLowerCase().trim();
          const trimmedDigits = trimmedQuery.replace(/\D/g, '');
          
          // Check if query is email
          const hasDomainCheck = lowerTrimmed.includes('@') && lowerTrimmed.split('@').length > 1 && lowerTrimmed.split('@')[1].length > 0;
          
          // Check if query is phone-like
          const isPhoneQuery = /^[\d\s\-\+\(\)]+$/.test(trimmedQuery) && trimmedDigits.length >= 3;
          
          // Check if query is lead number-like
          const leadNumQuery = trimmedQuery.replace(/[^\dLC]/gi, '');
          const isLeadNumQuery = /^[LC]?\d+$/i.test(leadNumQuery);
          
          // Ensure exact matches are correctly marked (re-evaluate to fix any missed matches)
          // This is CRITICAL: We must re-check ALL results to ensure exact matches are properly identified
          const resultsWithExactFlags = immediateResults.map(result => {
            let isExactMatch = false;
            
            // Email exact match - check email field (for both leads and contacts)
            if (hasDomainCheck && result.email) {
              const resultEmail = (result.email || '').toLowerCase().trim();
              if (resultEmail === lowerTrimmed) {
                isExactMatch = true;
              }
            }
            
            // Phone exact match (check if phone or mobile exactly matches)
            if (!isExactMatch && isPhoneQuery) {
              const resultPhone = (result.phone || '').replace(/\D/g, '');
              const resultMobile = (result.mobile || '').replace(/\D/g, '');
              if (resultPhone === trimmedDigits || resultMobile === trimmedDigits) {
                isExactMatch = true;
              }
            }
            
            // Lead number exact match
            // For lead number searches, only the lead itself (not contacts) should be exact match
            if (!isExactMatch && isLeadNumQuery && result.lead_number) {
              const resultLeadNum = String(result.lead_number || '').toLowerCase().trim();
              // Remove any "L" or "C" prefix from result lead_number for comparison
              const resultLeadNumNoPrefix = resultLeadNum.replace(/^[lc]/i, '');
              // Extract numeric part from query (remove "L" or "C" prefix if present)
              const queryLeadNumNumeric = leadNumQuery.replace(/^[lc]/i, '').toLowerCase().trim();
              
              // Only mark as exact match if:
              // 1. The lead_number (without prefix) exactly matches the numeric part of query
              // 2. AND it's not a contact (isContact: false or undefined)
              if (resultLeadNumNoPrefix === queryLeadNumNumeric && 
                  (!result.isContact || result.isContact === false)) {
                isExactMatch = true;
              }
            }
            
            // If we found an exact match, ensure it's marked as not fuzzy
            if (isExactMatch) {
              return { ...result, isFuzzyMatch: false };
            }
            
            // For lead number searches, ensure contacts are always marked as fuzzy
            if (isLeadNumQuery && result.isContact) {
              return { ...result, isFuzzyMatch: true };
            }
            
            // Otherwise, keep the original fuzzy match flag (don't change prefix matches to fuzzy)
            return result;
          });
          
          // Sort immediate results: exact matches first, then fuzzy matches
          const sortedResults = [...resultsWithExactFlags].sort((a, b) => {
            if (a.isFuzzyMatch !== b.isFuzzyMatch) {
              return a.isFuzzyMatch ? 1 : -1; // Exact matches (isFuzzyMatch: false) come first
            }
            return 0;
          });
          
          // We have immediate results - show them right away (sorted)
          const exactMatches = sortedResults.filter(r => !r.isFuzzyMatch);
          const prefixMatches = sortedResults.filter(r => r.isFuzzyMatch);
          
          // CRITICAL: Double-check query hasn't changed before updating state
          if (currentSearchQueryRef.current !== trimmedQuery) {
            return;
          }
          
          // CRITICAL: Set refs and state together, and only mark as not searching AFTER results are set
          exactMatchesRef.current = exactMatches;
          fuzzyMatchesRef.current = prefixMatches;
          masterSearchResultsRef.current = sortedResults;
          
          // Set results FIRST, then mark as not searching
          // This ensures exact matches are available when the UI renders
          setSearchResults(sortedResults);
          
          // Only mark as not searching AFTER results are set
          // This prevents "No exact matches found" from showing prematurely
          setIsSearching(false);
          isSearchingRef.current = false;
          previousSearchQueryRef.current = trimmedQuery;
          
          // Delay showing "No exact matches found" until user stops typing AND all queries complete
          // Clear any existing timeout
          if (showNoExactMatchTimeoutRef.current) {
            clearTimeout(showNoExactMatchTimeoutRef.current);
          }
          
          // Only show "No exact matches found" if:
          // 1. There are no exact matches
          // 2. We're not currently searching (all queries completed)
          // 3. Wait a bit to ensure user has stopped typing
          if (exactMatches.length === 0) {
            showNoExactMatchTimeoutRef.current = setTimeout(() => {
              // Triple-check: query hasn't changed, we're not searching, and still no exact matches
              if (currentSearchQueryRef.current === trimmedQuery && !isSearchingRef.current && exactMatchesRef.current.length === 0) {
                setShowNoExactMatch(true);
              }
            }, 500); // 500ms delay after typing stops
          } else {
            setShowNoExactMatch(false);
          }
          
          // If query is long enough (3+ chars) and we only have prefix matches (or no exact matches), also try fuzzy name search
          // BUT: Only do this if we're sure there are NO exact matches (check refs, not local variable)
          // AND: Only if query hasn't changed
          if (trimmedQuery.length >= 3 && exactMatches.length === 0) {
            // Run fuzzy search in background (with longer delay to avoid blocking and allow user to finish typing)
            fuzzySearchTimeoutRef.current = setTimeout(async () => {
              try {
                // CRITICAL: Check if query has changed before proceeding
                if (currentSearchQueryRef.current !== trimmedQuery) {
                  return;
                }
                
                // Double-check that we still have no exact matches (in case they were added)
                const currentExactMatches = exactMatchesRef.current;
                if (currentExactMatches.length > 0) {
                  // Exact matches were found, don't overwrite with fuzzy results
                  return;
                }
                
                // Double-check query again before performing fuzzy search
                if (currentSearchQueryRef.current !== trimmedQuery) {
                  return;
                }
                
                const fuzzyResults = await performFuzzySearch(trimmedQuery);
                
                // CRITICAL: Final check - query must still match
                if (currentSearchQueryRef.current !== trimmedQuery) {
                  return;
                }
                
                // Combine prefix matches with fuzzy matches (fuzzy already limited to 5)
                // Limit total fuzzy results to 5 (prefix + name fuzzy)
                const allFuzzy = [...prefixMatches, ...fuzzyResults];
                // Sort all fuzzy by relevance and limit to 5
                const lower = trimmedQuery.toLowerCase();
                const scoredFuzzy = allFuzzy.map(lead => {
                  const name = (lead.contactName || lead.name || '').toLowerCase();
                  const email = (lead.email || '').toLowerCase();
                  let score = 0;
                  if (name.startsWith(lower) || email.startsWith(lower)) {
                    score = 50;
                  } else if (name.includes(lower) || email.includes(lower)) {
                    const namePos = name.indexOf(lower);
                    const emailPos = email.indexOf(lower);
                    const earliestPos = namePos >= 0 && emailPos >= 0 
                      ? Math.min(namePos, emailPos)
                      : namePos >= 0 ? namePos : emailPos;
                    score = 30 - Math.min(earliestPos, 20);
                  }
                  return { lead, score };
                });
                scoredFuzzy.sort((a, b) => b.score - a.score);
                const limitedFuzzy = scoredFuzzy.slice(0, 5).map(item => item.lead);
                
                // CRITICAL: Final check before updating state
                if (currentSearchQueryRef.current !== trimmedQuery) {
                  return;
                }
                
                // Get current exact matches (should be empty, but check anyway)
                const finalExactMatches = exactMatchesRef.current;
                
                // Only update if we still have no exact matches
                if (finalExactMatches.length === 0) {
                  fuzzyMatchesRef.current = limitedFuzzy;
                  const combinedResults = [...finalExactMatches, ...limitedFuzzy];
                  masterSearchResultsRef.current = combinedResults;
                  setSearchResults(combinedResults);
                  
                  // Update "No exact matches found" state after fuzzy search completes
                  if (limitedFuzzy.length > 0) {
                    if (showNoExactMatchTimeoutRef.current) {
                      clearTimeout(showNoExactMatchTimeoutRef.current);
                    }
                    showNoExactMatchTimeoutRef.current = setTimeout(() => {
                      // Only show if query hasn't changed and we're not searching
                      if (currentSearchQueryRef.current === trimmedQuery && !isSearchingRef.current) {
                        setShowNoExactMatch(true);
                      }
                    }, 300);
                  } else {
                    setShowNoExactMatch(false);
                  }
                }
              } catch (error) {
                console.error('Error performing fuzzy search:', error);
              }
            }, 600); // Increased delay to 600ms to allow user to finish typing
          }
        } else {
          // No immediate results - try fuzzy name search (only if query is 2+ chars)
          if (trimmedQuery.length >= 2) {
            fuzzySearchTimeoutRef.current = setTimeout(async () => {
              try {
                // Check if query has changed
                if (currentSearchQueryRef.current !== trimmedQuery) {
                  return;
                }
                
                const fuzzyResults = await performFuzzySearch(trimmedQuery);
                
                // Final check before updating
                if (currentSearchQueryRef.current !== trimmedQuery) {
                  return;
                }
                
                fuzzyMatchesRef.current = fuzzyResults;
                masterSearchResultsRef.current = fuzzyResults;
                setSearchResults(fuzzyResults);
                setIsSearching(false);
                isSearchingRef.current = false;
                previousSearchQueryRef.current = trimmedQuery;
              } catch (error) {
                console.error('Error performing fuzzy search:', error);
                // Only clear if query hasn't changed
                if (currentSearchQueryRef.current === trimmedQuery) {
                  setSearchResults([]);
                  masterSearchResultsRef.current = [];
                  setIsSearching(false);
                  isSearchingRef.current = false;
                }
              }
            }, 500); // Increased delay for fuzzy search to avoid too many requests
          } else {
            // Query too short - no results
            setSearchResults([]);
            masterSearchResultsRef.current = [];
            setIsSearching(false);
            isSearchingRef.current = false;
          }
        }
      } catch (error) {
        console.error('Error searching leads:', error);
        // Only clear if query hasn't changed
        if (currentSearchQueryRef.current === trimmedQuery) {
          setSearchResults([]);
          masterSearchResultsRef.current = [];
          exactMatchesRef.current = [];
          fuzzyMatchesRef.current = [];
          setIsSearching(false);
          isSearchingRef.current = false;
        }
      }
    })();
  }, [searchValue]);

  // Keep search active when filter dropdown is open
  useEffect(() => {
    if (showFilterDropdown && !isSearchActive) {
      setIsSearchActive(true);
    }
  }, [showFilterDropdown, isSearchActive]);

  // Fetch stage options from lead_stages table
  useEffect(() => {
    const fetchStageOptions = async () => {
      try {
        const { data, error } = await supabase
          .from('lead_stages')
          .select('name')
          .order('name');
        
        if (error) throw error;
        
        const stages = data?.map(stage => stage.name) || [];
        setStageOptions(stages);
      } catch (error) {
        console.error('Error fetching stage options:', error);
        // Fallback to hardcoded options if database fetch fails
        setStageOptions([
          "created", "scheduler_assigned", "meeting_scheduled", "meeting_paid", 
          "unactivated", "communication_started", "another_meeting", "revised_offer", 
          "offer_sent", "waiting_for_mtng_sum", "client_signed", "client_declined", 
          "lead_summary", "meeting_rescheduled", "meeting_ended"
        ]);
      }
    };

    fetchStageOptions();
  }, []);

  // Fetch category options from misc_category table
  useEffect(() => {
    const fetchCategoryOptions = async () => {
      try {
        const { data, error } = await supabase
          .from('misc_category')
          .select('name')
          .order('name');
        
        if (error) throw error;
        
        const categories = data?.map(category => category.name) || [];
        setCategoryOptions(categories);
      } catch (error) {
        console.error('Error fetching category options:', error);
        // Fallback to hardcoded options if database fetch fails
        setCategoryOptions([
          "German Citizenship", "Austrian Citizenship", "Inquiry", "Consultation", "Other"
        ]);
      }
    };

    fetchCategoryOptions();
  }, []);

  // Fetch source options from sources table
  useEffect(() => {
    const fetchSourceOptions = async () => {
      try {
        const { data, error } = await supabase
          .from('sources')
          .select('name')
          .order('name');
        
        if (error) throw error;
        
        const sources = data?.map(source => source.name) || [];
        setSourceOptions(sources);
      } catch (error) {
        console.error('Error fetching source options:', error);
        // Fallback to hardcoded options if database fetch fails
        setSourceOptions([
          "Manual", "AI Assistant", "Referral", "Website", "Other"
        ]);
      }
    };

    fetchSourceOptions();
  }, []);

  // Fetch language options from misc_language table
  useEffect(() => {
    const fetchLanguageOptions = async () => {
      try {
        const { data, error } = await supabase
          .from('misc_language')
          .select('name')
          .order('name');
        
        if (error) throw error;
        
        const languages = data?.map(language => language.name) || [];
        setLanguageOptions(languages);
      } catch (error) {
        console.error('Error fetching language options:', error);
        // Fallback to hardcoded options if database fetch fails
        setLanguageOptions([
          "English", "Hebrew", "German", "French", "Russian", "Other"
        ]);
      }
    };

    fetchLanguageOptions();
  }, []);

  useEffect(() => {
    const initializeMsal = async () => {
      if (!instance) return;
      
      try {
        await new Promise(resolve => setTimeout(resolve, 1000));
        
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

  useEffect(() => {
    // Fetch the current user's name and employee data from Supabase
    const fetchUserData = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user && user.email) {
        // Fetch user name
        const { data, error } = await supabase
          .from('users')
          .select('first_name, last_name, full_name, is_superuser')
          .eq('email', user.email)
          .single();
        if (!error && data) {
          // Set superuser status
          setIsSuperUser(data.is_superuser === true || data.is_superuser === 'true' || data.is_superuser === 1);
          
          // Use first_name + last_name if available, otherwise fall back to full_name
          if (data.first_name && data.last_name && data.first_name.trim() && data.last_name.trim()) {
            const fullName = `${data.first_name.trim()} ${data.last_name.trim()}`;
            setUserFullName(fullName);
          } else if (data.full_name && data.full_name.trim()) {
            setUserFullName(data.full_name.trim());
          } else {
            // Fallback to email if no name is available
            setUserFullName(user.email);
          }
        } else {
          // Try to get name from auth user metadata as fallback
          if (user.user_metadata?.first_name || user.user_metadata?.full_name) {
            const authName = user.user_metadata.first_name || user.user_metadata.full_name;
            setUserFullName(authName);
            
            // Try to sync user to custom table
            try {
              const { data: syncResult, error: syncError } = await supabase.rpc('sync_or_update_auth_user', {
                user_email: user.email
              });
              // Silent sync - no logging
            } catch (syncErr) {
              // Silent error handling
            }
          } else {
            setUserFullName(user.email);
          }
        }

        // Fetch current user's employee data using the new users-employee relationship
        try {
          // Get current user's data with employee relationship
          const { data: userData, error: userError } = await supabase
            .from('users')
            .select(`
              id,
              full_name,
              email,
              employee_id,
              is_superuser,
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
            .eq('auth_id', user.id)
            .single();

          if (!userError && userData) {
            // Set superuser status from userData if not already set
            if (userData.is_superuser !== undefined) {
              setIsSuperUser(userData.is_superuser === true || userData.is_superuser === 'true' || userData.is_superuser === 1);
            }
            
            if (userData.tenants_employee) {
              const empData = userData.tenants_employee;
              
              // Set current user for RMQ messages
              setCurrentUser(userData);
            
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

            // Also fetch all employees for the modal using the new pattern - only active users
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
                .filter(user => user.tenants_employee && user.email)
                .map(user => {
                  const employee = user.tenants_employee as any;
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
                    email: user.email
                  };
                });

              // Deduplicate by employee ID to prevent duplicates
              const uniqueEmployeesMap = new Map();
              processedEmployees.forEach(emp => {
                if (!uniqueEmployeesMap.has(emp.id)) {
                  uniqueEmployeesMap.set(emp.id, emp);
                }
              });
              const uniqueEmployees = Array.from(uniqueEmployeesMap.values());
              setAllEmployees(uniqueEmployees);
            }
            } else {
              // Set current user even if no employee data
              setCurrentUser(userData);
            }
          } else {
            // Set current user even if no employee data
            if (userData) {
              setCurrentUser(userData);
              // Set superuser status from userData if available
              const userDataWithSuperuser = userData as any;
              if (userDataWithSuperuser.is_superuser !== undefined) {
                setIsSuperUser(userDataWithSuperuser.is_superuser === true || userDataWithSuperuser.is_superuser === 'true' || userDataWithSuperuser.is_superuser === 1);
              }
            }
          }
        } catch (error) {
          console.error('Error fetching employee data:', error);
        }
      }
    };
    fetchUserData();
  }, []);

  // Fetch RMQ messages for notifications
  const fetchRmqMessages = async () => {
    if (!currentUser) {
      console.log('🔔 No current user for RMQ messages');
      return;
    }


    try {
      // Get conversations where the current user participates
      const { data: userConversations, error: convError } = await supabase
        .from('conversation_participants')
        .select('conversation_id')
        .eq('user_id', currentUser.id)
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
          .eq('user_id', currentUser.id)
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
          .neq('sender_id', currentUser.id); // Exclude user's own messages

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

      // Base query builder that excludes inactive leads
      const buildBaseQuery = (query: any) => {
        return query
          .neq('stage', 91) // Exclude inactive/dropped leads
          .is('unactivated_at', null); // Exclude leads that have been unactivated
      };

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
            .or('scheduler.is.null,scheduler.eq.')
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

      // Filter out leads where scheduler matches any employee display_name or id
      // This must match the exact logic in NewCasesPage.tsx
      if (employeeDisplayNames.length > 0 || employeeIds.length > 0) {
        allLeads = allLeads.filter(lead => {
          const scheduler = lead.scheduler;
          if (!scheduler || scheduler === '' || scheduler === '---') {
            return true; // Keep leads with no scheduler
          }
          
          // Check if scheduler matches any employee display name
          if (employeeDisplayNames.includes(scheduler)) {
            return false;
          }
          
          // Check if scheduler matches any employee ID
          if (employeeIds.includes(scheduler.toString())) {
            return false;
          }
          
          return true;
        });
      }

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
  }, [allEmployees, fetchNewLeadsCount, currentUser]);

  useEffect(() => {
    if (isSearchActive && searchContainerRef.current) {
      const rect = searchContainerRef.current.getBoundingClientRect();
      setSearchDropdownStyle({ top: rect.bottom + window.scrollY, left: rect.left + window.scrollX, width: rect.width });
    }
  }, [isSearchActive, showFilterDropdown, searchResults.length, searchValue]);

  // Animation effect for searchbar open/close
  useEffect(() => {
    let timeout: NodeJS.Timeout;
    if (isSearchActive) {
      timeout = setTimeout(() => setIsSearchAnimationDone(true), 700);
    } else {
      setIsSearchAnimationDone(false);
    }
    return () => clearTimeout(timeout);
  }, [isSearchActive]);

  const handleSearchFocus = () => {
    setIsSearchActive(true);
    searchInputRef.current?.focus();
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchValue(e.target.value);
  };

  const handleSearchResultClick = (lead: CombinedLead) => {
    navigate(`/clients/${lead.lead_number}`);
    closeSearchBar();
  };

  const handleClearSearch = () => {
    setSearchValue('');
    setSearchResults([]);
    masterSearchResultsRef.current = [];
    exactMatchesRef.current = [];
    fuzzyMatchesRef.current = [];
    previousSearchQueryRef.current = '';
    setIsSearchActive(false);
    setHasAppliedFilters(false);
    setIsSearching(false);
    isSearchingRef.current = false;
    setShowNoExactMatch(false);
    if (fuzzySearchTimeoutRef.current) {
      clearTimeout(fuzzySearchTimeoutRef.current);
    }
    if (showNoExactMatchTimeoutRef.current) {
      clearTimeout(showNoExactMatchTimeoutRef.current);
    }
    searchInputRef.current?.blur();
  };

  const closeSearchBar = () => {
    setIsSearchActive(false);
    setSearchResults([]);
    masterSearchResultsRef.current = [];
    exactMatchesRef.current = [];
    fuzzyMatchesRef.current = [];
    previousSearchQueryRef.current = '';
    setSearchValue('');
    setHasAppliedFilters(false);
    setShowFilterDropdown(false);
    setIsSearching(false);
    isSearchingRef.current = false;
    setShowNoExactMatch(false);
    if (fuzzySearchTimeoutRef.current) {
      clearTimeout(fuzzySearchTimeoutRef.current);
    }
    if (showNoExactMatchTimeoutRef.current) {
      clearTimeout(showNoExactMatchTimeoutRef.current);
    }
    searchInputRef.current?.blur();
  };

  const closeFilterDropdown = () => {
    setShowFilterDropdown(false);
  };


  const handleNotificationClick = () => {
    const newShowState = !showNotifications;
    setShowNotifications(newShowState);
    
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

  const handleSignOut = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error('Error signing out:', error);
        toast.error('Failed to sign out');
      } else {
        toast.success('Signed out successfully');
        // Navigate to login page instead of reload
        window.location.href = '/login';
      }
    } catch (error) {
      console.error('Unexpected error during sign out:', error);
      toast.error('Failed to sign out');
    }
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
      <div className="w-8 h-8 rounded-full bg-purple-500 flex items-center justify-center text-white text-sm font-bold">
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

  // Helper function to check if a lead is inactive
  const isInactiveLead = (lead: any) => {
    if (lead.lead_type === 'legacy') {
      // Legacy leads: status = 10 means inactive
      return lead.status === 10;
    } else {
      // New leads: check status column for 'inactive' text, or stage = '91' (Dropped/Spam/Irrelevant)
      return lead.status === 'inactive' || lead.stage === '91' || lead.stage === 91;
    }
  };

  // Memoize processed search results to prevent jumping/re-rendering
  const processedSearchResults = useMemo(() => {
    if (searchResults.length === 0) {
      return { exactMatches: [], fuzzyMatches: [] };
    }

    // Ensure results are sorted: exact matches first
    const sortedResults = [...searchResults].sort((a, b) => {
      if (a.isFuzzyMatch !== b.isFuzzyMatch) {
        return a.isFuzzyMatch ? 1 : -1; // Exact matches (isFuzzyMatch: false) come first
      }
      return 0;
    });
    
    const exactMatches = sortedResults.filter(r => !r.isFuzzyMatch);
    let allFuzzyMatches = sortedResults.filter(r => r.isFuzzyMatch);
    
    // Create a set of exact match lead identifiers to filter duplicates
    const exactMatchIdentifiers = new Set<string>();
    exactMatches.forEach(match => {
      const identifier = match.lead_number?.toString().trim() || match.id?.toString().trim() || '';
      if (identifier) {
        exactMatchIdentifiers.add(identifier.toLowerCase());
      }
    });
    
    // Filter out fuzzy matches that have the same lead_number or id as exact matches
    allFuzzyMatches = allFuzzyMatches.filter(fuzzyMatch => {
      const fuzzyIdentifier = fuzzyMatch.lead_number?.toString().trim() || fuzzyMatch.id?.toString().trim() || '';
      if (!fuzzyIdentifier) return true; // Keep if no identifier
      return !exactMatchIdentifiers.has(fuzzyIdentifier.toLowerCase());
    });
    
    // Sort fuzzy matches by relevance (closest match first)
    // Re-score fuzzy matches to ensure proper ordering
    const lower = searchValue.trim().toLowerCase();
    const scoredFuzzyMatches = allFuzzyMatches.map(lead => {
      const name = (lead.contactName || lead.name || '').toLowerCase();
      const email = (lead.email || '').toLowerCase();
      
      let score = 0;
      if (name.startsWith(lower) || email.startsWith(lower)) {
        score = 50; // Starts with
      } else if (name.includes(lower) || email.includes(lower)) {
        // Calculate position - earlier in string = higher score
        const namePos = name.indexOf(lower);
        const emailPos = email.indexOf(lower);
        const earliestPos = namePos >= 0 && emailPos >= 0 
          ? Math.min(namePos, emailPos)
          : namePos >= 0 ? namePos : emailPos;
        score = 30 - Math.min(earliestPos, 20); // Closer to start = higher score
      }
      
      return { lead, score };
    });
    
    // Sort by score (highest first = closest match first), then limit to 5
    scoredFuzzyMatches.sort((a, b) => b.score - a.score);
    const fuzzyMatches = scoredFuzzyMatches.slice(0, 5).map(item => item.lead);
    
    return { exactMatches, fuzzyMatches };
  }, [searchResults, searchValue]);

  // Stage badge function for search results
  const getStageBadge = (stage: string | number | null | undefined) => {
    const stageStr = stage ? String(stage).trim() : '';
    const stageName = stageStr ? getStageName(stageStr) : 'Contact';
    const isContact = !stageStr;
    
    // Use gradient for Contact badge (same as new messages box), solid color for stages
    if (isContact) {
      return (
        <span 
          className="badge badge-xs md:badge-sm text-[9px] md:text-xs px-1.5 py-0.5 md:px-2 md:py-1 bg-gradient-to-tr from-blue-500 via-cyan-500 to-teal-400 text-white border-none"
        >
          {stageName}
        </span>
      );
    }
    
    // Force all search result stage badges to use #391BC8
    const backgroundColor = '#391BC8';
    const textColor = getContrastingTextColor(backgroundColor);
    
    return (
      <span 
        className="badge badge-xs md:badge-sm text-[9px] md:text-xs px-1.5 py-0.5 md:px-2 md:py-1"
        style={{
          backgroundColor: backgroundColor,
          color: textColor,
          borderColor: backgroundColor,
        }}
      >
        {stageName}
      </span>
    );
  };

  return (
    <>
      <div className="navbar bg-base-100 px-2 md:px-0 h-16 fixed top-0 left-0 w-full z-50" style={{ boxShadow: 'none', borderBottom: 'none' }}>
        {/* Left section with menu and logo */}
        <div className={`flex-1 justify-start flex items-center gap-4 overflow-hidden transition-all duration-300 ${isSearchActive && isMobile ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
          <button className="md:hidden btn btn-ghost btn-square" onClick={onMenuClick} aria-label={isMenuOpen ? "Close menu" : "Open menu"}>
            {isMenuOpen ? (
              <XMarkIcon className="w-6 h-6" />
            ) : (
              <Bars3Icon className="w-6 h-6" />
            )}
          </button>
          
          {/* Quick Actions Dropdown - Mobile only */}
          <div className="md:hidden relative ml-2" data-quick-actions-dropdown>
            <button
              ref={mobileButtonRef}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setShowMobileQuickActionsDropdown(!showMobileQuickActionsDropdown);
                setShowQuickActionsDropdown(false); // Close desktop dropdown if open
              }}
              className="flex items-center gap-1 px-3 py-2.5 rounded-lg font-medium transition-all duration-300 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white"
            >
              <BoltIcon className="w-4 h-4 text-white" />
              <ChevronDownIcon className={`w-3 h-3 text-white transition-transform duration-200 ${showMobileQuickActionsDropdown ? 'rotate-180' : ''}`} />
            </button>
            
            {/* Dropdown Menu */}
            {showMobileQuickActionsDropdown && createPortal(
              <div 
                className="fixed w-48 bg-white rounded-xl shadow-2xl border border-gray-200 z-[9999] overflow-hidden"
                data-dropdown-menu
                style={{
                  top: '64px',
                  left: '8px',
                  right: '8px'
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {/* RMQ Messages Option */}
                <button
                  onClick={() => {
                    setShowMobileQuickActionsDropdown(false);
                    if (onOpenMessaging) {
                      onOpenMessaging();
                    }
                  }}
                  className="flex items-center gap-3 px-4 py-3 transition-all duration-200 text-gray-700 w-full text-left border-b border-gray-100 hover:bg-gray-50 relative"
                >
                  <ChatBubbleLeftRightIcon className="w-5 h-5 text-gray-500" />
                  <span className="text-sm font-medium">RMQ Messages</span>
                  {rmqUnreadCount > 0 && (
                    <span className="ml-auto bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                      {rmqUnreadCount > 9 ? '9+' : rmqUnreadCount}
                    </span>
                  )}
                </button>

                {/* WhatsApp Option */}
                <button
                  onClick={() => {
                    setShowMobileQuickActionsDropdown(false);
                    if (onOpenWhatsApp) {
                      onOpenWhatsApp();
                    }
                  }}
                  className="flex items-center gap-3 px-4 py-3 transition-all duration-200 text-gray-700 w-full text-left border-b border-gray-100 hover:bg-gray-50 relative"
                >
                  <FaWhatsapp className="w-5 h-5 text-green-500" />
                  <span className="text-sm font-medium">WhatsApp</span>
                  {whatsappClientsUnreadCount > 0 && (
                    <span className="ml-auto bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                      {whatsappClientsUnreadCount > 9 ? '9+' : whatsappClientsUnreadCount}
                    </span>
                  )}
                </button>

                {/* Email Thread Option */}
                <button
                  onClick={() => {
                    setShowMobileQuickActionsDropdown(false);
                    if (onOpenEmailThread) {
                      onOpenEmailThread();
                    }
                  }}
                  className="flex items-center gap-3 px-4 py-3 transition-all duration-200 text-gray-700 w-full text-left border-b border-gray-100 hover:bg-gray-50 relative"
                >
                  <EnvelopeIcon className="w-5 h-5 text-gray-500" />
                  <span className="text-sm font-medium">Email Thread</span>
                  {emailUnreadCount > 0 && (
                    <span className="ml-auto bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                      {emailUnreadCount > 9 ? '9+' : emailUnreadCount}
                    </span>
                  )}
                </button>

                {/* Highlights Option */}
                <button
                  onClick={() => {
                    setShowMobileQuickActionsDropdown(false);
                    setIsHighlightsPanelOpen(true);
                  }}
                  className="flex items-center gap-3 px-4 py-3 transition-all duration-200 text-gray-700 w-full text-left border-b border-gray-100 hover:bg-gray-50 relative"
                >
                  <StarIcon className="w-5 h-5" style={{ color: '#3E28CD' }} />
                  <span className="text-sm font-medium">My Highlights</span>
                </button>

                {/* My Profile Option */}
                <button
                  onClick={() => {
                    setShowMobileQuickActionsDropdown(false);
                    setShowQuickActionsDropdown(false);
                    if (currentUserEmployee) {
                      setIsEmployeeModalOpen(true);
                    } else {
                      toast.error('Unable to load your profile data');
                    }
                  }}
                  className="flex items-center gap-3 px-4 py-3 transition-all duration-200 text-gray-700 w-full text-left border-b border-gray-100"
                >
                  <UserIcon className="w-5 h-5 text-gray-500" />
                  <span className="text-sm font-medium">My Profile</span>
                </button>
                
                {navTabs
                  .filter(tab => isSuperUser || tab.path !== '/new-cases')
                  .map(tab => {
                  const Icon = tab.icon;
                  const showCount = tab.path === '/new-cases' && newLeadsCount > 0;
                  
                  // Skip WhatsApp and Email Thread as they're now handled above
                  if (tab.path === '/whatsapp' || tab.label === 'Email Thread') {
                    return null;
                  }
                  
                  return (
                    <Link
                      key={tab.path || tab.label}
                      to={tab.path || '/'}
                      onClick={() => {
                        setShowMobileQuickActionsDropdown(false);
                        setShowQuickActionsDropdown(false);
                      }}
                      className="flex items-center gap-3 px-4 py-3 transition-all duration-200 text-gray-700"
                    >
                      <Icon className="w-5 h-5 text-gray-500" />
                      <span className="text-sm font-medium">{tab.label}</span>
                      {showCount && (
                        <span className="ml-auto bg-red-500 text-white text-xs px-2 py-1 rounded-full font-semibold">
                          {newLeadsCount}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>,
              document.body
            )}
          </div>
          
          <div className="h-16 flex items-center">
            <Link to="/" className="hidden md:flex items-center gap-2">
           
              <span className="md:ml-2 text-xl md:text-2xl font-extrabold tracking-tight" style={{ color: '#3b28c7', letterSpacing: '-0.03em' }}>RMQ 2.0</span>
            </Link>
          </div>
          {/* Quick Actions Dropdown - Desktop only */}
          <div className="hidden md:block relative ml-4" data-quick-actions-dropdown>
            <button
              ref={buttonRef}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setShowQuickActionsDropdown(!showQuickActionsDropdown);
                setShowMobileQuickActionsDropdown(false); // Close mobile dropdown if open
              }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl font-medium transition-all duration-300 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white"
            >
              <BoltIcon className="w-5 h-5 text-white" />
              <span className="text-sm font-semibold">Quick Actions</span>
              <ChevronDownIcon className={`w-4 h-4 text-white transition-transform duration-200 ${showQuickActionsDropdown ? 'rotate-180' : ''}`} />
            </button>
            
            {/* Dropdown Menu */}
            {showQuickActionsDropdown && createPortal(
              <div 
                className="fixed w-48 bg-white rounded-xl shadow-2xl border border-gray-200 z-[9999] overflow-hidden"
                data-dropdown-menu
                style={{
                  top: buttonRef.current ? `${buttonRef.current.getBoundingClientRect().bottom + 8}px` : '0px',
                  left: buttonRef.current ? `${buttonRef.current.getBoundingClientRect().left}px` : '0px'
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {/* RMQ Messages Option - COMMENTED OUT */}
                {/* <button
                  onClick={() => {
                    setShowQuickActionsDropdown(false);
                    if (onOpenMessaging) {
                      onOpenMessaging();
                    }
                  }}
                  className="flex items-center gap-3 px-4 py-3 transition-all duration-200 text-gray-700 w-full text-left border-b border-gray-100 hover:bg-gray-50"
                >
                  <ChatBubbleLeftRightIcon className="w-5 h-5 text-gray-500" />
                  <span className="text-sm font-medium">RMQ Messages</span>
                </button> */}

                {/* My Profile Option */}
                <button
                  onClick={() => {
                    setShowQuickActionsDropdown(false);
                    setShowMobileQuickActionsDropdown(false);
                    if (currentUserEmployee) {
                      setIsEmployeeModalOpen(true);
                    } else {
                      toast.error('Unable to load your profile data');
                    }
                  }}
                  className="flex items-center gap-3 px-4 py-3 transition-all duration-200 text-gray-700 w-full text-left border-b border-gray-100"
                >
                  <UserIcon className="w-5 h-5 text-gray-500" />
                  <span className="text-sm font-medium">My Profile</span>
                </button>
                
                {navTabs
                  .filter(tab => isSuperUser || tab.path !== '/new-cases')
                  .map(tab => {
                  const Icon = tab.icon;
                  const showCount = tab.path === '/new-cases' && newLeadsCount > 0;
                  if (false) { // Removed action check
                    return (
                      <button
                        key={tab.label}
                        onClick={() => {
                          setShowQuickActionsDropdown(false);
                          setShowMobileQuickActionsDropdown(false);
                          if (onOpenEmailThread) {
                            onOpenEmailThread();
                          }
                        }}
                        className="flex items-center gap-3 px-4 py-3 transition-all duration-200 text-gray-700 w-full text-left"
                      >
                        <Icon className="w-5 h-5 text-gray-500" />
                        <span className="text-sm font-medium">{tab.label}</span>
                      </button>
                    );
                  }
                  if (tab.path === '/whatsapp') {
                    return (
                      <button
                        key={tab.label}
                        onClick={() => {
                          setShowQuickActionsDropdown(false);
                          setShowMobileQuickActionsDropdown(false);
                          if (onOpenWhatsApp) {
                            onOpenWhatsApp();
                          }
                        }}
                        className="flex items-center gap-3 px-4 py-3 transition-all duration-200 text-gray-700 w-full text-left relative"
                      >
                        <Icon className="w-5 h-5 text-gray-500" />
                        <span className="text-sm font-medium">{tab.label}</span>
                        {whatsappClientsUnreadCount > 0 && (
                          <span className="ml-auto bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                            {whatsappClientsUnreadCount > 9 ? '9+' : whatsappClientsUnreadCount}
                          </span>
                        )}
                      </button>
                    );
                  }
                  return (
                    <Link
                      key={tab.path || tab.label}
                      to={tab.path || '/'}
                      onClick={() => {
                        setShowQuickActionsDropdown(false);
                        setShowMobileQuickActionsDropdown(false);
                      }}
                      className="flex items-center gap-3 px-4 py-3 transition-all duration-200 text-gray-700"
                    >
                      <Icon className="w-5 h-5 text-gray-500" />
                      <span className="text-sm font-medium">{tab.label}</span>
                      {showCount && (
                        <span className="ml-auto bg-red-500 text-white text-xs px-2 py-1 rounded-full font-semibold">
                          {newLeadsCount}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>,
              document.body
            )}
          </div>
        </div>
        
        {/* Search bar */}
        <div className={`relative transition-all duration-300 ${isSearchActive && isMobile ? 'flex-1' : 'flex-1'}`}>
          <div
            ref={searchContainerRef}
            className={`min-w-12 min-h-[56px] transition-all duration-[700ms] ease-in-out cursor-pointer px-2 md:px-0 ${
              isSearchActive 
                ? isMobile 
                  ? 'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100vw-120px)]' 
                  : 'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-xl md:max-w-xl'
                : 'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-1'
            }`}
            style={{ 
              background: 'transparent'
            }}
            onMouseEnter={!isMobile ? () => {
              isMouseOverSearchRef.current = true;
              setIsSearchActive(true);
              setTimeout(() => searchInputRef.current?.focus(), 100);
            } : undefined}
            onMouseLeave={!isMobile ? () => {
              isMouseOverSearchRef.current = false;
              // Only close on mouse leave if filter dropdown is not open, no search value/results, and not searching
              if (!showFilterDropdown && !searchValue.trim() && searchResults.length === 0 && !isSearching) {
                setTimeout(() => {
                  // Double check that mouse is still not over search area
                  if (!isMouseOverSearchRef.current) {
                    setIsSearchActive(false);
                  }
                }, 300); // Longer delay to prevent accidental closures
              }
            } : undefined}
          >
            <div className={`relative flex items-center ${isSearchActive ? 'w-full' : 'w-10'} transition-all duration-[700ms] ease-in-out`}>
              {/* Large search icon (always visible) */}
              <button 
                className={`absolute left-3 flex items-center h-full z-10 transition-opacity duration-300 ${isSearchActive ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
                onClick={() => {
                  if (isMobile && !isSearchActive) {
                    setIsSearchActive(true);
                    setTimeout(() => {
                      searchInputRef.current?.focus();
                    }, 100);
                  }
                }}
              >
                <MagnifyingGlassIcon className={`${isMobile ? 'w-9 h-9' : 'w-8 h-8'} text-cyan-900 drop-shadow-md`} />
              </button>
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search for leads..."
                value={searchValue}
                onChange={handleSearchChange}
                onFocus={handleSearchFocus}
                onBlur={isMobile ? () => {
                  // On mobile, close search if no value, no results, and not searching
                  if (!searchValue.trim() && searchResults.length === 0 && !isSearching) {
                    setTimeout(() => setIsSearchActive(false), 150);
                  }
                } : undefined}
                className={`
                  w-full bg-white/10 border border-white/20 shadow-lg text-cyan-800 placeholder-cyan-900 rounded-xl focus:outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-300/40 transition-all duration-300 search-input-placeholder
                  ${isSearchActive ? 'opacity-100 visible pl-4' : 'opacity-0 invisible pl-14'}
                  ${searchValue.trim() || searchResults.length > 0 ? 'pr-12' : 'pr-4'}
                `}
                style={{ 
                  height: isMobile ? 48 : 44, 
                  fontSize: isMobile ? 16 : 14, 
                  fontWeight: 500, 
                  letterSpacing: '-0.01em', 
                  boxShadow: isSearchActive ? '0 4px 24px 0 rgba(0,0,0,0.10)' : undefined 
                }}
              />
              {/* Clear search button - visible on mobile when search is active */}
              {(searchValue.trim() || searchResults.length > 0) && (
                <button
                  onClick={handleClearSearch}
                  className={`absolute right-1 top-1/2 -translate-y-1/2 btn btn-ghost btn-sm btn-circle transition-all duration-300 ease-out text-white/80 hover:text-cyan-400 ${
                    isMobile && isSearchActive ? 'flex' : 'hidden md:flex'
                  }`}
                  title="Clear search"
                  style={{ background: 'rgba(255,255,255,0.10)' }}
                >
                  <XMarkIcon className="w-3 h-3" />
                </button>
              )}
              {/* Filter button inside input */}
              {isSearchActive && isSearchAnimationDone && (
                <button
                  type="button"
                  className="absolute right-8 top-1/2 -translate-y-1/2 btn btn-ghost btn-circle btn-sm hidden md:block"
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
                  <FunnelIcon className="w-5 h-5 text-cyan-900" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* End of search bar container */}
        {isSearchActive && typeof window !== 'undefined' && createPortal(
          <div className="fixed z-[10000] flex gap-4" style={{
            top: searchDropdownStyle.top,
            left: searchDropdownStyle.left,
            zIndex: 10000,
          }}>
            {/* Search Results - show if there's a search value (always show when searching or has value), or filters applied */}
            {(searchValue.trim() || isAdvancedSearching || hasAppliedFilters) && (
              <div
                ref={searchDropdownRef}
                className="bg-base-100 rounded-xl shadow-xl border border-base-300 max-h-96 overflow-y-auto search-dropdown"
                style={{
                  width: searchDropdownStyle.width,
                  zIndex: 10000,
                }}
                onMouseEnter={() => {
                  isMouseOverSearchRef.current = true;
                }}
                onMouseLeave={() => {
                  isMouseOverSearchRef.current = false;
                }}
              >
            {isSearching || isAdvancedSearching ? (
              <div className="p-4 text-center text-base-content/70">
                <div className="loading loading-spinner loading-sm"></div>
                <span className="ml-2">Searching...</span>
              </div>
            ) : searchResults.length > 0 ? (
              <div className="space-y-2">
                {/* Separate exact matches from fuzzy matches */}
                {(() => {
                  const { exactMatches, fuzzyMatches } = processedSearchResults;
                  
                  return (
                    <>
                      {/* Exact Matches Section - ALWAYS show first if they exist */}
                      {exactMatches.length > 0 && (
                        <>
                          {exactMatches.map((result, index) => {
                            const uniqueKey = result.lead_type === 'legacy' 
                              ? `exact_legacy_${result.id}_${result.contactName || result.name}_${index}`
                              : `exact_${result.id}_${result.contactName || result.name}_${index}`;
                            
                            const displayName = result.contactName || result.name || '';
                            
                            return (
                              <button
                                key={uniqueKey}
                                onClick={() => handleSearchResultClick(result)}
                                className="w-full px-2 py-2 md:px-4 md:py-3 text-left hover:bg-base-200 transition-colors rounded-lg border border-base-300 relative"
                              >
                                <div className="absolute top-1 right-1 md:top-2 md:right-2 z-10 flex flex-col gap-1 items-end">
                                  {getStageBadge(result.stage)}
                                  {isInactiveLead(result) && (
                                    <span className="badge badge-xs md:badge-sm text-[9px] md:text-xs px-1.5 py-0.5 md:px-2 md:py-1 bg-gray-500 text-white border-none">
                                      Inactive
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-start gap-2 md:gap-3 pr-20 md:pr-20">
                                  <div className="hidden md:flex w-10 h-10 rounded-full bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 items-center justify-center flex-shrink-0">
                                    <span className="font-semibold text-white">
                                      {displayName.charAt(0).toUpperCase()}
                                    </span>
                                  </div>
                                  <div className="flex-1 min-w-0" style={{ maxWidth: 'calc(100% - 60px)' }}>
                                    <div className="mb-0.5 md:mb-1">
                                      <p className="text-[9px] md:text-base font-semibold text-base-content break-words line-clamp-2 leading-tight" style={{ wordBreak: 'break-word', overflowWrap: 'break-word' }}>
                                        {result.isContact && !result.isMainContact ? 'Contact: ' : ''}{displayName}
                                      </p>
                                    </div>
                                    <div className="mb-0.5 md:mb-1">
                                      <span className="text-[8px] md:text-xs text-base-content/70 font-mono">{result.lead_number}</span>
                                    </div>
                                    {result.category && (
                                      <p className="text-[8px] md:text-sm text-base-content/80 truncate">
                                        <span className="font-medium">Category:</span> {result.category}
                                      </p>
                                    )}
                                    {result.topic && (
                                      <p className="text-[8px] md:text-sm text-base-content/80 truncate">
                                        <span className="font-medium">Topic:</span> {result.topic}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </>
                      )}
                      
                      {/* No exact match message - ONLY show when:
                          1. showNoExactMatch state is true (debounced, user stopped typing)
                          2. There are no exact matches
                          3. There are fuzzy matches to show
                          4. We're not currently searching (all queries completed)
                          5. Not in advanced search mode */}
                      {showNoExactMatch && exactMatches.length === 0 && fuzzyMatches.length > 0 && !isSearching && !isAdvancedSearching && (
                        <div className="px-2 py-1.5 md:px-4 md:py-2 border-b border-base-300">
                          <p className="text-[10px] md:text-sm text-base-content/70 font-medium">No exact matches found</p>
                        </div>
                      )}
                      
                      {/* Divider between exact and fuzzy matches */}
                      {exactMatches.length > 0 && fuzzyMatches.length > 0 && (
                        <div className="px-2 py-1.5 md:px-4 md:py-2 border-t border-base-300">
                          <p className="text-[10px] md:text-sm text-base-content/60 font-medium">Similar matches</p>
                        </div>
                      )}
                      
                      {/* Fuzzy Matches Section - limited to 5, sorted by closest match first */}
                      {fuzzyMatches.length > 0 && (
                        <>
                          {fuzzyMatches.map((result, index) => {
                            const uniqueKey = result.lead_type === 'legacy' 
                              ? `fuzzy_legacy_${result.id}_${result.contactName || result.name}_${index}`
                              : `fuzzy_${result.id}_${result.contactName || result.name}_${index}`;
                            
                            const displayName = result.contactName || result.name || '';
                            
                            return (
                              <button
                                key={uniqueKey}
                                onClick={() => handleSearchResultClick(result)}
                                className="w-full px-2 py-2 md:px-4 md:py-3 text-left hover:bg-base-200 transition-colors rounded-lg border border-base-300 relative opacity-90"
                              >
                                <div className="absolute top-1 right-1 md:top-2 md:right-2 z-10 flex flex-col gap-1 items-end">
                                  {getStageBadge(result.stage)}
                                  {isInactiveLead(result) && (
                                    <span className="badge badge-xs md:badge-sm text-[9px] md:text-xs px-1.5 py-0.5 md:px-2 md:py-1 bg-gray-500 text-white border-none">
                                      Inactive
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-start gap-2 md:gap-3 pr-20 md:pr-20">
                                  <div className="hidden md:flex w-10 h-10 rounded-full bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 items-center justify-center flex-shrink-0 opacity-80">
                                    <span className="font-semibold text-white">
                                      {displayName.charAt(0).toUpperCase()}
                                    </span>
                                  </div>
                                  <div className="flex-1 min-w-0" style={{ maxWidth: 'calc(100% - 60px)' }}>
                                    <div className="mb-0.5 md:mb-1">
                                      <p className="text-[9px] md:text-base font-semibold text-base-content break-words line-clamp-2 leading-tight" style={{ wordBreak: 'break-word', overflowWrap: 'break-word' }}>
                                        {result.isContact && !result.isMainContact ? 'Contact: ' : ''}{displayName}
                                      </p>
                                    </div>
                                    <div className="mb-0.5 md:mb-1">
                                      <span className="text-[8px] md:text-xs text-base-content/70 font-mono">{result.lead_number}</span>
                                    </div>
                                    {result.category && (
                                      <p className="text-[8px] md:text-sm text-base-content/80 truncate">
                                        <span className="font-medium">Category:</span> {result.category}
                                      </p>
                                    )}
                                    {result.topic && (
                                      <p className="text-[8px] md:text-sm text-base-content/80 truncate">
                                        <span className="font-medium">Topic:</span> {result.topic}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </>
                      )}
                    </>
                  );
                })()}
              </div>
            ) : searchValue.trim() ? (
              <div className="text-center py-8 text-base-content/70">
                <p className="text-sm">No contacts found</p>
                <p className="text-xs mt-1">Try a different search term</p>
              </div>
            ) : null}
              </div>
            )}
            
            {/* Advanced Filter Dropdown - positioned to the right of search results */}
            {showFilterDropdown && (
              <div 
                ref={filterDropdownRef} 
                className="bg-base-100 rounded-xl shadow-xl border border-base-300 p-6 animate-fadeInUp min-w-80 filter-dropdown"
                onMouseEnter={() => {
                  isMouseOverSearchRef.current = true;
                }}
                onMouseLeave={() => {
                  isMouseOverSearchRef.current = false;
                }}
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
                            .select('id, name, email, phone, mobile, topic, stage, cdate, lead_number, deactivate_notes, language_id')
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
                            .select('id, lead_number, name, email, phone, mobile, topic, stage, created_at')
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
                      
                      // Process legacy results
                      if (legacyPromise.status === 'fulfilled' && legacyPromise.value.data) {
                        // Fetch stage mapping
                        const { data: stageMapping } = await supabase
                          .from('lead_stages')
                          .select('id, name');
                        
                        const stageMap = new Map();
                        if (stageMapping) {
                          stageMapping.forEach(stage => {
                            stageMap.set(stage.id, stage.name);
                          });
                        }
                        
                        // Fetch language mapping
                        const { data: languageMapping } = await supabase
                          .from('misc_language')
                          .select('id, name');
                        
                        const languageMap = new Map();
                        if (languageMapping) {
                          languageMapping.forEach(language => {
                            languageMap.set(language.id, language.name);
                          });
                        }
                        
                        const transformedLegacyLeads = legacyPromise.value.data.map(lead => ({
                          id: `legacy_${lead.id}`,
                          lead_number: String(lead.id),
                          name: lead.name || '',
                          email: lead.email || '',
                          phone: lead.phone || '',
                          mobile: lead.mobile || '',
                          topic: lead.topic || '',
                          stage: stageMap.get(lead.stage) || String(lead.stage || ''),
                          source: '',
                          created_at: lead.cdate || '',
                          updated_at: lead.cdate || '',
                          notes: '',
                          special_notes: '',
                          next_followup: '',
                          probability: '',
                          category: '',
                          language: languageMap.get(lead.language_id) || '',
                          balance: '',
                          lead_type: 'legacy' as const,
                          unactivation_reason: null,
                          deactivate_note: lead.deactivate_notes || null,
                          isFuzzyMatch: false,
                        }));
                        results.push(...transformedLegacyLeads);
                      }
                      
                      // Process new leads results
                      if (newPromise.status === 'fulfilled' && newPromise.value.data) {
                        const transformedNewLeads = newPromise.value.data.map(lead => ({
                          id: lead.id,
                          lead_number: lead.lead_number || '',
                          name: lead.name || '',
                          email: lead.email || '',
                          phone: lead.phone || '',
                          mobile: lead.mobile || '',
                          topic: lead.topic || '',
                          stage: lead.stage || '',
                          source: '',
                          created_at: lead.created_at || '',
                          updated_at: lead.created_at || '',
                          notes: '',
                          special_notes: '',
                          next_followup: '',
                          probability: '',
                          category: '',
                          language: '',
                          balance: '',
                          lead_type: 'new' as const,
                          unactivation_reason: null,
                          deactivate_note: null,
                          isFuzzyMatch: false,
                        }));
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
        , document.body)}

        {/* Right section with notifications and user */}
        <div className={`flex-1 justify-end flex items-center gap-2 md:gap-4 transition-all duration-300 ${isSearchActive && isMobile ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
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

          {/* AI Assistant Button */}
          <button
            className="btn btn-ghost btn-circle hidden md:flex items-center justify-center"
            title="Open AI Assistant"
            onClick={handleAIClick}
          >
            <FaRobot className="w-7 h-7 text-primary" />
          </button>

          {/* WhatsApp Button */}
          <div className="relative hidden md:block">
            <button
              className="btn btn-ghost btn-circle flex items-center justify-center"
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
              className="btn btn-ghost btn-circle flex items-center justify-center"
              title="Open RMQ Messages"
              onClick={onOpenMessaging}
            >
              <ChatBubbleLeftRightIcon className="w-7 h-7 text-purple-600" />
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
              className="btn btn-ghost btn-circle flex items-center justify-center"
              title="Open Email Thread"
              onClick={onOpenEmailThread}
            >
              <EnvelopeIcon className="w-7 h-7 text-blue-600" />
            </button>
            {emailUnreadCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                {emailUnreadCount > 9 ? '9+' : emailUnreadCount}
              </span>
            )}
          </div>

          {/* Highlights Button */}
          <div className="relative hidden md:block">
            <button
              className="btn btn-ghost btn-circle flex items-center justify-center"
              title="My Highlights"
              onClick={() => setIsHighlightsPanelOpen(true)}
            >
              <StarIcon className="w-7 h-7" style={{ color: '#3E28CD' }} />
            </button>
          </div>

          {/* Microsoft sign in/out button */}
          <button 
            className={`btn btn-sm gap-2 hidden md:flex ${userAccount ? 'btn-primary' : 'btn-outline'}`} 
            onClick={handleMicrosoftSignIn} 
            disabled={isMsalLoading || !isMsalInitialized}
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="currentColor" d="M11.4 24H0V12.6h11.4V24zM24 24H12.6V12.6H24V24zM11.4 11.4H0V0h11.4v11.4zM24 11.4H12.6V0H24v11.4z"/>
            </svg>
            {userAccount ? (() => {
              const fullName = userAccount.name || userAccount.username || 'Signed in';
              // Extract only the English name before the dash
              const englishName = fullName.split(' - ')[0].split(' – ')[0];
              return englishName;
            })() : (isMsalLoading ? 'Signing in...' : 'Sign in')}
          </button>

          {/* Microsoft sign in/out - mobile only */}
          <button 
            className={`btn btn-sm btn-square md:hidden ${userAccount ? 'btn-primary' : 'btn-outline'}`} 
            onClick={handleMicrosoftSignIn} 
            disabled={isMsalLoading || !isMsalInitialized}
            title={userAccount ? 'Sign out' : 'Sign in with Microsoft'}
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="currentColor" d="M11.4 24H0V12.6h11.4V24zM24 24H12.6V12.6H24V24zM11.4 11.4H0V0h11.4v11.4zM24 11.4H12.6V0H24v11.4z"/>
            </svg>
          </button>

          {/* Notifications */}
          <div className="relative" ref={notificationsRef}>
            <button 
              className="btn btn-ghost btn-circle mr-1"
              onClick={handleNotificationClick}
            >
              <div className="indicator">
                <BellIcon className="w-6 h-6" />
                {unreadCount > 0 && (
                  <span className="indicator-item badge badge-primary badge-sm">{unreadCount}</span>
                )}
              </div>
            </button>

            {showNotifications && (
              <div
                className={`notification-dropdown shadow-xl rounded-xl overflow-hidden z-50 border border-gray-200 dark:border-gray-600 ${
                  isMobile
                    ? 'fixed inset-x-0 top-[72px] w-[calc(100vw-16px)] mx-auto text-[11px]'
                    : 'absolute right-0 mt-2 w-80 text-sm'
                }`}
              >
                <div className="p-4 border-b border-gray-200">
                  <div className="flex justify-between items-center">
                    <h3 className="font-semibold text-gray-900">Messages</h3>
                    <button 
                      className="btn btn-ghost btn-xs whitespace-nowrap text-gray-700 hover:text-gray-900"
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
                      <div className="p-3 bg-blue-50 border-b border-blue-100">
                        <div className="flex items-center gap-2">
                          <EnvelopeIcon className="w-4 h-4 text-blue-600" />
                          <span className="text-sm font-semibold text-blue-800">Email Leads</span>
                        </div>
                      </div>
                      {emailLeadMessages.map((message) => (
                        <div key={message.id} className="border-b border-blue-100">
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
                            className="w-full p-4 text-left hover:bg-blue-50 transition-colors duration-200 cursor-pointer"
                          >
                            <div className="flex gap-3">
                              <div className="flex-shrink-0">
                                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                                  <EnvelopeIcon className="w-4 h-4 text-blue-600" />
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
                                  <p className="text-xs text-blue-600 mt-1">
                                    {message.message_count} messages
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="px-4 py-2 border-t border-blue-100 flex justify-end">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEmailLeadMessageRead(message);
                              }}
                              className="text-xs font-medium text-blue-700 hover:text-blue-900"
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
                      <div className="p-3 bg-purple-50 border-b border-purple-100">
                        <div className="flex items-center gap-2">
                          <ChatBubbleLeftRightIcon className="w-4 h-4 text-purple-600" />
                          <span className="text-sm font-semibold text-purple-800">RMQ Messages</span>
                        </div>
                      </div>
                      {rmqMessages.length > 0 ? (
                        rmqMessages.map((message) => (
                          <div
                            key={message.id}
                            className="border-b border-purple-100 cursor-pointer"
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
                              className="w-full p-4 text-left hover:bg-purple-50 transition-colors duration-200"
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
                            <div className="px-4 pb-3 border-t border-purple-100 flex items-center justify-between text-[11px] text-gray-500">
                              <span>{formatMessageTime(message.sent_at)}</span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  dismissRmqMessage(message.id);
                                }}
                                className="text-xs font-medium text-purple-700 hover:text-purple-900"
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
                      <div className="p-3 bg-purple-50 border-b border-purple-100">
                        <div className="flex items-center gap-2">
                          <UserGroupIcon className="w-4 h-4 text-purple-600" />
                          <span className="text-sm font-semibold text-purple-800">Lead Assignments</span>
                        </div>
                      </div>
                      {assignmentNotifications.map(notification => (
                        <div
                          key={notification.key}
                          className="border-b border-purple-100 cursor-pointer"
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
                            className="w-full text-left p-4 hover:bg-purple-50 transition-colors duration-200"
                          >
                            <div className="flex items-start gap-3">
                              <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center">
                                <UserIcon className="w-4 h-4 text-purple-700" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-gray-800 leading-relaxed">
                                  <span className="font-semibold">{userFullName || 'You'}</span>, you have been assigned as{' '}
                                  <span className="font-semibold">{notification.roleLabel}</span> to lead{' '}
                                  <span className="font-semibold">{notification.leadNumber}</span>.
                                </p>
                                <p className="text-xs text-purple-600 mt-2">Tap to open lead</p>
                              </div>
                            </div>
                          </div>
                          <div className="px-4 pb-3 border-t border-purple-100 flex justify-end">
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
            )}
          </div>
        </div>
      </div>
      {/* Sign Out Confirmation Modal */}
      {showSignOutModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-primary rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-white" viewBox="0 0 24 24">
                  <path fill="currentColor" d="M11.4 24H0V12.6h11.4V24zM11.4 11.4H0V0h11.4v11.4zM24 11.4H12.6V0H24v11.4z"/>
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

      {/* Spacer to prevent content from being hidden behind the fixed header */}
      <div className="h-16 w-full" />
      
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
      
      <style>{`
        .notification-dropdown {
          background-color: #ffffff !important;
          opacity: 1 !important;
        }
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

export default Header;

