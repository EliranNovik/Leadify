import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useLocation, Link, useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { searchLeads } from '../lib/legacyLeadsApi';
import { supabase } from '../lib/supabase';
import type { Lead } from '../lib/supabase';
import type { CombinedLead } from '../lib/legacyLeadsApi';
import { toast } from 'react-hot-toast';
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
} from '@heroicons/react/24/outline';
import { useMsal } from '@azure/msal-react';
import { loginRequest } from '../msalConfig';
import { FaRobot } from 'react-icons/fa';
import { FaWhatsapp } from 'react-icons/fa';
import EmployeeModal from './EmployeeModal';
import RMQMessagesPage from '../pages/RMQMessagesPage';
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

const ASSIGNMENT_ROLE_COLUMNS = [
  { field: 'case_handler_id', label: 'Handler' },
  { field: 'meeting_manager_id', label: 'Manager' },
  { field: 'meeting_lawyer_id', label: 'Helper' },
  { field: 'meeting_scheduler_id', label: 'Scheduler' },
  { field: 'expert_id', label: 'Expert' },
  { field: 'closer_id', label: 'Closer' },
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
  const [isSearchActive, setIsSearchActive] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [searchResults, setSearchResults] = useState<CombinedLead[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const currentSearchIdRef = useRef(0);
  const isMouseOverSearchRef = useRef(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const notificationsRef = useRef<HTMLDivElement>(null);
  const searchDropdownRef = useRef<HTMLDivElement>(null);
  const filterDropdownRef = useRef<HTMLDivElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout>();
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
  const [isRmqModalOpen, setIsRmqModalOpen] = useState(false);
  const [selectedConversationId, setSelectedConversationId] = useState<number | undefined>();
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [newLeadsCount, setNewLeadsCount] = useState<number>(0);
  const createdStageIdsRef = useRef<number[]>([0, 11]);
  const schedulerStageIdsRef = useRef<number[]>([10]);
  const stageIdsReadyRef = useRef(false);
  const resolvingStageIdsRef = useRef<Promise<void> | null>(null);

  const unreadCount = rmqUnreadCount + whatsappLeadsUnreadCount + assignmentNotifications.length;

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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = localStorage.getItem(ASSIGNMENT_SEEN_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setSeenAssignmentKeys(new Set(parsed));
        }
      }
    } catch (error) {
      console.error('Failed to load assignment notification cache', error);
    }
  }, []);

  const persistSeenAssignments = useCallback((nextSet: Set<string>) => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(ASSIGNMENT_SEEN_STORAGE_KEY, JSON.stringify(Array.from(nextSet)));
    } catch (error) {
      console.error('Failed to persist assignment notification cache', error);
    }
  }, []);

  const rememberAssignments = useCallback((keys: string[]) => {
    if (!keys.length) return;
    setSeenAssignmentKeys(prev => {
      const next = new Set(prev);
      let changed = false;
      keys.forEach(key => {
        if (!next.has(key)) {
          next.add(key);
          changed = true;
        }
      });
      if (changed) {
        persistSeenAssignments(next);
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
          // Only close search bar if filter dropdown is not open, no search value/results, and mouse is not over search area
          if (!showFilterDropdown && !searchValue.trim() && searchResults.length === 0 && !isMouseOverSearchRef.current) {
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

  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    // Clear results immediately when search value changes
    setSearchResults([]);
    setIsSearching(false);
    
    // Increment search ID to invalidate any pending searches
    const searchId = Date.now(); // Use timestamp for unique ID
    currentSearchIdRef.current = searchId;

    if (searchValue.trim()) {
      setIsSearching(true);
      searchTimeoutRef.current = setTimeout(async () => {
        try {
          console.log('[Header] search start', { searchValue, searchId });
          const results = await searchLeads(searchValue);
          
          // Only set results if this is still the current search
          if (searchId === currentSearchIdRef.current) {
            console.log('[Header] search results', { count: results.length, first: results[0]?.lead_number, searchId });
            setSearchResults(results);
            setIsSearching(false);
          }
        } catch (error) {
          console.error('Search error:', error);
          // Only clear results if this is still the current search
          if (searchId === currentSearchIdRef.current) {
            setSearchResults([]);
            setIsSearching(false);
          }
        }
      }, 50); // Reduced to 50ms for much faster response
    }

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
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
          .select('first_name, last_name, full_name')
          .eq('email', user.email)
          .single();
        if (!error && data) {
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

          if (!userError && userData && userData.tenants_employee) {
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
              
              console.log('🔍 Header - Employees loaded:', {
                totalUsers: allEmployeesData?.length || 0,
                processedEmployees: processedEmployees.length,
                uniqueEmployees: uniqueEmployees.length,
                sampleEmployee: uniqueEmployees[0] ? {
                  id: uniqueEmployees[0].id,
                  name: uniqueEmployees[0].display_name,
                  email: uniqueEmployees[0].email
                } : null
              });
              
              setAllEmployees(uniqueEmployees);
            }
          } else {
            // Set current user even if no employee data
            setCurrentUser(userData);
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
      // Fetch incoming WhatsApp messages from numbers not connected to existing clients
      // These are messages where lead_id is null and direction is 'in' and not read yet
      let whatsappMessages: any[] = [];
      
      try {
        const { data, error } = await supabase
          .from('whatsapp_messages')
          .select('*')
          .is('lead_id', null)
          .eq('direction', 'in')
          .or('is_read.is.null,is_read.eq.false')
          .order('sent_at', { ascending: false })
          .limit(10); // Get latest 10 unread messages

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

      // Group messages by phone number to avoid duplicates
      const groupedMessages = whatsappMessages.reduce((acc, message) => {
        const phoneNumber = message.phone_number || message.sender_name;
        if (!acc[phoneNumber]) {
          acc[phoneNumber] = {
            phone_number: phoneNumber,
            sender_name: message.sender_name,
            latest_message: message.message,
            latest_message_time: message.sent_at,
            message_count: 1,
            id: message.id // Use the latest message ID as the group ID
          };
        } else {
          acc[phoneNumber].message_count++;
          // Keep the latest message
          if (new Date(message.sent_at) > new Date(acc[phoneNumber].latest_message_time)) {
            acc[phoneNumber].latest_message = message.message;
            acc[phoneNumber].latest_message_time = message.sent_at;
            acc[phoneNumber].id = message.id;
          }
        }
        return acc;
      }, {} as Record<string, any>);

      const groupedMessagesArray = Object.values(groupedMessages);
      setWhatsappLeadsMessages(groupedMessagesArray);
      setWhatsappLeadsUnreadCount(groupedMessagesArray.length);
    } catch (error) {
      console.error('Error in fetchWhatsappLeadsMessages:', error);
      setWhatsappLeadsMessages([]);
      setWhatsappLeadsUnreadCount(0);
    }
  };

  // Fetch WhatsApp clients unread count (messages from existing clients, lead_id is not null)
  const fetchWhatsappClientsUnreadCount = async () => {
    try {
      const { data, error } = await supabase
        .from('whatsapp_messages')
        .select('id')
        .not('lead_id', 'is', null)
        .eq('direction', 'in')
        .or('is_read.is.null,is_read.eq.false');

      if (error) {
        console.error('Error fetching WhatsApp clients unread count:', error);
        setWhatsappClientsUnreadCount(0);
        return;
      }

      setWhatsappClientsUnreadCount(data?.length || 0);
    } catch (error) {
      console.error('Error in fetchWhatsappClientsUnreadCount:', error);
      setWhatsappClientsUnreadCount(0);
    }
  };


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
  const fetchNewLeadsCount = async () => {
    try {
      await ensureStageIds();

      const createdFilters = createdStageIdsRef.current.length ? createdStageIdsRef.current : [0, 11];
      const schedulerFilters = schedulerStageIdsRef.current.length ? schedulerStageIdsRef.current : [10];

      const [createdResult, schedulerResult] = await Promise.all([
        supabase
          .from('leads')
          .select('id')
          .in('stage', createdFilters),
        supabase
          .from('leads')
          .select('id, scheduler')
          .in('stage', schedulerFilters)
          .or('scheduler.is.null,scheduler.eq.'),
      ]);

      if (createdResult.error) {
        console.error('Error fetching created leads for header count:', createdResult.error);
      }
      if (schedulerResult.error) {
        console.error('Error fetching scheduler leads for header count:', schedulerResult.error);
      }

      const createdIds = (createdResult.data || []).map(lead => lead.id);
      const schedulerIds = (schedulerResult.data || [])
        .filter(lead => !lead.scheduler || String(lead.scheduler).trim().length === 0)
        .map(lead => lead.id);

      const uniqueIds = new Set([...createdIds, ...schedulerIds]);
      setNewLeadsCount(uniqueIds.size);
    } catch (error) {
      console.error('Error fetching new leads count:', error);
      setNewLeadsCount(0);
    }
  };

  // Fetch RMQ messages and WhatsApp leads messages when user is loaded
  useEffect(() => {
    if (currentUser) {
      fetchRmqMessages();
      fetchWhatsappLeadsMessages();
      fetchWhatsappClientsUnreadCount();
      // Refresh messages every 60 seconds
      const interval = setInterval(() => {
        fetchRmqMessages();
        fetchWhatsappLeadsMessages();
        fetchWhatsappClientsUnreadCount();
      }, 60000);
      return () => clearInterval(interval);
    }
  }, [currentUser]);

  // Fetch new leads count when component mounts and every 30 seconds
  useEffect(() => {
    fetchNewLeadsCount();
    const interval = setInterval(fetchNewLeadsCount, 30000);
    return () => clearInterval(interval);
  }, []);

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
    const newValue = e.target.value;
    setSearchValue(newValue);
    
    // Clear results immediately when user types to prevent showing old results
    if (newValue.trim() !== searchValue.trim()) {
      setSearchResults([]);
    }
  };

  const handleSearchResultClick = (lead: CombinedLead) => {
    navigate(`/clients/${lead.lead_number}`);
    closeSearchBar();
  };

  const handleClearSearch = () => {
    setSearchValue('');
    setSearchResults([]);
    setIsSearchActive(false);
    setHasAppliedFilters(false);
    setIsSearching(false);
    searchInputRef.current?.blur();
  };

  const closeSearchBar = () => {
    setIsSearchActive(false);
    setSearchResults([]);
    setSearchValue('');
    setHasAppliedFilters(false);
    setShowFilterDropdown(false);
    setIsSearching(false);
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
      fetchWhatsappLeadsMessages();
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
      
      // Mark all WhatsApp leads messages as read
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
    return '';
  };

  const fetchAssignmentNotifications = useCallback(async () => {
    const employeeId = currentUserEmployee?.id ?? currentUser?.employee_id;
    if (!employeeId) return;

    const employeeIdStr = String(employeeId).trim();
    if (!employeeIdStr) return;
    const sanitizedEmployeeId = employeeIdStr.replace(/"/g, '\\"');

    const orFilter = ASSIGNMENT_ROLE_COLUMNS.map(role => `${role.field}.eq."${sanitizedEmployeeId}"`).join(',');
    if (!orFilter) return;

    const roleFields = ASSIGNMENT_ROLE_COLUMNS.map(role => role.field).join(', ');

    try {
      const [legacyResult, newResult] = await Promise.all([
        supabase
          .from('leads_lead')
          .select(`id, lead_number, manual_id, udate, ${roleFields}`)
          .or(orFilter)
          .order('udate', { ascending: false })
          .limit(50),
        supabase
          .from('leads')
          .select(`id, lead_number, manual_id, created_at, ${roleFields}`)
          .or(orFilter)
          .order('created_at', { ascending: false })
          .limit(50),
      ]);

      const notifications: AssignmentNotification[] = [];

      const pushNotifications = (rows: any[] | null | undefined, table: 'legacy' | 'new') => {
        if (!rows) return;
        rows.forEach(row => {
          ASSIGNMENT_ROLE_COLUMNS.forEach(role => {
            const value = row[role.field];
            if (value === null || value === undefined) return;
            if (String(value).trim() !== employeeIdStr) return;
            const timestamp =
              table === 'legacy'
                ? (row.udate || row.updated_at || row.created_at)
                : (row.updated_at || row.created_at);
            const key = [table, row.id, role.field, value, timestamp || ''].join(':');
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

  const handleWhatsappLeadsClick = () => {
    // Close notifications dropdown
    setShowNotifications(false);
    // Navigate to WhatsApp Leads page
    navigate('/whatsapp-leads');
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

  const handleAssignmentDismiss = (key: string) => {
    rememberAssignments([key]);
    setAssignmentNotifications(prev => prev.filter(notification => notification.key !== key));
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

  // Stage badge function for search results
  const getStageBadge = (stage: string | number | null | undefined) => {
    if (!stage || (typeof stage === 'string' && !stage.trim())) {
      return (
        <span className="badge badge-sm bg-gray-100 text-gray-600">
          No Stage
        </span>
      );
    }
    
    const stageStr = String(stage);
    const stageName = getStageName(stageStr);
    const stageColor = getStageColour(stageStr);
    const textColor = getContrastingTextColor(stageColor);
    
    // Use the stage color if available, otherwise use default purple
    const backgroundColor = stageColor || '#3b28c7';
    
    return (
      <span 
        className="badge badge-sm text-xs px-2 py-1"
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
                  className="flex items-center gap-3 px-4 py-3 transition-all duration-200 text-gray-700 w-full text-left border-b border-gray-100 hover:bg-gray-50"
                >
                  <ChatBubbleLeftRightIcon className="w-5 h-5 text-gray-500" />
                  <span className="text-sm font-medium">RMQ Messages</span>
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
                  className="flex items-center gap-3 px-4 py-3 transition-all duration-200 text-gray-700 w-full text-left border-b border-gray-100 hover:bg-gray-50"
                >
                  <EnvelopeIcon className="w-5 h-5 text-gray-500" />
                  <span className="text-sm font-medium">Email Thread</span>
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
                
                {navTabs.map(tab => {
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
                
                {navTabs.map(tab => {
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
              // Only close on mouse leave if filter dropdown is not open and no search value/results
              if (!showFilterDropdown && !searchValue.trim() && searchResults.length === 0) {
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
                  // On mobile, close search if no value and no results
                  if (!searchValue.trim() && searchResults.length === 0) {
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
        {isSearchActive && (
          <div className="fixed z-50 flex gap-4" style={{
            top: searchDropdownStyle.top,
            left: searchDropdownStyle.left,
          }}>
            {/* Search Results - only show if there are results, searching, or filters applied */}
            {((searchValue.trim() && (searchResults.length > 0 || isSearching)) || isAdvancedSearching || hasAppliedFilters) && (
              <div
                ref={searchDropdownRef}
                className="bg-white rounded-xl shadow-xl border border-gray-200 max-h-96 overflow-y-auto"
                style={{
                  width: searchDropdownStyle.width,
                }}
                onMouseEnter={() => {
                  isMouseOverSearchRef.current = true;
                }}
                onMouseLeave={() => {
                  isMouseOverSearchRef.current = false;
                }}
              >
            {isSearching || isAdvancedSearching ? (
              <div className="p-4 text-center text-gray-500">
                <div className="loading loading-spinner loading-sm"></div>
                <span className="ml-2">Searching...</span>
              </div>
            ) : searchResults.length > 0 ? (
              <div>
                {(() => {
                  // Use the same exact matching logic as the search function
                  const trimmedQuery = searchValue.trim();
                  const digitsOnly = trimmedQuery.replace(/\D/g, '');
                  const lastFiveDigits = digitsOnly.slice(-5);
                  const isPhoneQuery = lastFiveDigits.length === 5;
                  
                  const exactMatches = searchResults.filter(result => {
                    // For phone queries, check if the last 5 digits match exactly
                    if (isPhoneQuery) {
                      const resultPhoneDigits = (result.phone || '').replace(/\D/g, '');
                      const resultMobileDigits = (result.mobile || '').replace(/\D/g, '');
                      return resultPhoneDigits.endsWith(lastFiveDigits) || resultMobileDigits.endsWith(lastFiveDigits);
                    }
                    
                    // For other queries, use exact string matching
                    return result.name.toLowerCase() === trimmedQuery.toLowerCase() ||
                           result.lead_number === trimmedQuery ||
                           result.email.toLowerCase() === trimmedQuery.toLowerCase() ||
                           result.phone === trimmedQuery ||
                           result.mobile === trimmedQuery;
                  });
                  
                  const otherResults = searchResults.filter(result => !exactMatches.includes(result));
                  
                  return (
                    <>
                      {/* Exact Matches Section */}
                      {exactMatches.length > 0 && (
                        <div className="divide-y divide-gray-100">
                          {exactMatches.map((result) => (
                            <button
                              key={result.id}
                              className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-gray-50 transition-colors duration-200"
                              onClick={() => handleSearchResultClick(result)}
                            >
                              <div className="flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <div className="flex flex-col md:flex-row md:items-center gap-1 md:gap-2 flex-1">
                                    {result.stage && (
                                      <div className="md:hidden">
                                        {getStageBadge(result.stage)}
                                      </div>
                                    )}
                                    <div className="flex items-center gap-2">
                                      <span className="font-semibold text-gray-900">{result.name}</span>
                                      <span className="text-sm text-gray-500 font-mono">{result.lead_number}</span>
                                    </div>
                                  </div>
                                  {result.stage && (
                                    <div className="hidden md:block md:ml-auto">
                                      {getStageBadge(result.stage)}
                                    </div>
                                  )}
                                </div>
                                {result.topic && (
                                  <div className="text-sm text-gray-600 mt-1">{result.topic}</div>
                                )}
                                {/* Unactivation Status */}
                                {(() => {
                                  const isLegacy = result.id?.toString().startsWith('legacy_');
                                  const unactivationReason = isLegacy ? result.deactivate_note : result.unactivation_reason;
                                  return unactivationReason || (result.stage && (result.stage === '91' || result.stage === 'unactivated'));
                                })() && (
                                  <div className="flex items-center gap-2 mt-1">
                                    <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                                    <span className="text-xs text-red-600 font-medium">
                                      {result.unactivation_reason ? 'Unactivated' : 'Dropped (Spam/Irrelevant)'}
                                    </span>
                                  </div>
                                )}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                      
                      {/* Separator and "Did you mean" section - only show if no exact matches */}
                      {exactMatches.length === 0 && otherResults.length > 0 && (
                        <div className="px-4 py-2 border-t border-gray-200 bg-gray-50">
                          <div className="text-xs font-medium text-gray-600">Did you mean...</div>
                        </div>
                      )}
                      
                      {/* Other Results Section - only show if no exact matches */}
                      {exactMatches.length === 0 && otherResults.length > 0 && (
                        <div className="divide-y divide-gray-100">
                          {otherResults.map((result) => (
                            <button
                              key={result.id}
                              className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-gray-50 transition-colors duration-200"
                              onClick={() => handleSearchResultClick(result)}
                            >
                              <div className="flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <div className="flex flex-col md:flex-row md:items-center gap-1 md:gap-2 flex-1">
                                    {result.stage && (
                                      <div className="md:hidden">
                                        {getStageBadge(result.stage)}
                                      </div>
                                    )}
                                    <div className="flex items-center gap-2">
                                      <span className="font-semibold text-gray-900">{result.name}</span>
                                      <span className="text-sm text-gray-500 font-mono">{result.lead_number}</span>
                                    </div>
                                  </div>
                                  {result.stage && (
                                    <div className="hidden md:block md:ml-auto">
                                      {getStageBadge(result.stage)}
                                    </div>
                                  )}
                                </div>
                                {result.topic && (
                                  <div className="text-sm text-gray-600 mt-1">{result.topic}</div>
                                )}
                                {/* Unactivation Status */}
                                {(() => {
                                  const isLegacy = result.id?.toString().startsWith('legacy_');
                                  const unactivationReason = isLegacy ? result.deactivate_note : result.unactivation_reason;
                                  return unactivationReason || (result.stage && (result.stage === '91' || result.stage === 'unactivated'));
                                })() && (
                                  <div className="flex items-center gap-2 mt-1">
                                    <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                                    <span className="text-xs text-red-600 font-medium">
                                      {result.unactivation_reason ? 'Unactivated' : 'Dropped (Spam/Irrelevant)'}
                                    </span>
                                  </div>
                                )}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            ) : searchValue.trim() ? (
              <div className="p-4 text-center text-gray-500">
                No leads found for "{searchValue}"
              </div>
            ) : null}
              </div>
            )}
            
            {/* Advanced Filter Dropdown - positioned to the right of search results */}
            {showFilterDropdown && (
              <div 
                ref={filterDropdownRef} 
                className="bg-white rounded-xl shadow-xl border border-gray-200 p-6 animate-fadeInUp min-w-80"
                onMouseEnter={() => {
                  isMouseOverSearchRef.current = true;
                }}
                onMouseLeave={() => {
                  isMouseOverSearchRef.current = false;
                }}
              >
                <div className="mb-4 flex justify-between items-start">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">Advanced Filters</h3>
                    <p className="text-sm text-gray-600">Filter search results by specific criteria</p>
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
        )}

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
          
          <button
            className="btn btn-ghost btn-circle hidden md:flex items-center justify-center"
            title="Open RMQ Messages"
            onClick={onOpenMessaging}
          >
            <ChatBubbleLeftRightIcon className="w-7 h-7 text-purple-600" />
          </button>

          {/* Email Thread Button */}
          <button
            className="btn btn-ghost btn-circle hidden md:flex items-center justify-center"
            title="Open Email Thread"
            onClick={onOpenEmailThread}
          >
            <EnvelopeIcon className="w-7 h-7 text-blue-600" />
          </button>

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
              <div className="absolute right-0 mt-2 w-80 glassy-notification-box shadow-xl rounded-xl overflow-hidden z-50">
                <div className="p-4 border-b border-base-200">
                  <div className="flex justify-between items-center">
                    <h3 className="font-semibold">Messages</h3>
                    <button 
                      className="btn btn-ghost btn-xs whitespace-nowrap hover:bg-gray-100 hover:text-gray-800"
                      onClick={markAllAsRead}
                    >
                      Read
                    </button>
                  </div>
                </div>
                <div className="max-h-96 overflow-y-auto">
                  {/* RMQ Messages Section */}
                  {currentUser && (
                    <div className="border-b border-base-200">
                      {rmqMessages.length > 0 ? (
                        rmqMessages.map((message) => (
                          <button
                            key={message.id}
                            onClick={() => handleRmqMessageClick(message)}
                            className="w-full p-4 text-left hover:bg-purple-50 transition-colors duration-200 border-b border-purple-100"
                          >
                            <div className="flex gap-3">
                              <div className="flex-shrink-0">
                                {getConversationIcon(message)}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between">
                                  <p className="text-sm font-semibold text-gray-900 truncate">
                                    {getConversationTitle(message)}
                                  </p>
                                  <p className="text-xs text-gray-500 ml-2">
                                    {formatMessageTime(message.sent_at)}
                                  </p>
                                </div>
                                <p className="text-xs text-gray-600 mt-1 truncate">
                                  {getMessageDisplayText(message)}
                                </p>
                              </div>
                            </div>
                          </button>
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
                    <div className="border-b border-base-200">
                      <div className="p-3 bg-blue-50 border-b border-blue-100">
                        <div className="flex items-center gap-2">
                          <UserGroupIcon className="w-4 h-4 text-blue-600" />
                          <span className="text-sm font-semibold text-blue-800">Lead Assignments</span>
                        </div>
                      </div>
                      {assignmentNotifications.map(notification => (
                        <div
                          key={notification.key}
                          className="p-4 text-left hover:bg-blue-50 transition-colors duration-200 border-b border-blue-100"
                        >
                          <div className="flex items-start gap-3">
                            <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                              <UserIcon className="w-4 h-4 text-blue-700" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-gray-800 leading-relaxed">
                                <span className="font-semibold">{userFullName || 'You'}</span>, you have been assigned as{' '}
                                <span className="font-semibold">{notification.roleLabel}</span> to lead{' '}
                                <span className="font-semibold">{notification.leadNumber}</span>.
                              </p>
                              <div className="mt-3 flex flex-wrap gap-2">
                                <button
                                  className="btn btn-xs btn-primary"
                                  onClick={() => handleAssignmentOpen(notification)}
                                >
                                  Open lead
                                </button>
                                <button
                                  className="btn btn-xs"
                                  onClick={() => handleAssignmentDismiss(notification.key)}
                                >
                                  Dismiss
                                </button>
                              </div>
                            </div>
                            <button
                              className="text-gray-400 hover:text-gray-600"
                              onClick={() => handleAssignmentDismiss(notification.key)}
                              title="Dismiss"
                            >
                              <XMarkIcon className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {/* WhatsApp Leads Messages Section */}
                  {whatsappLeadsMessages.length > 0 && (
                    <div className="border-b border-base-200">
                      <div className="p-3 bg-green-50 border-b border-green-100">
                        <div className="flex items-center gap-2">
                          <FaWhatsapp className="w-4 h-4 text-green-600" />
                          <span className="text-sm font-semibold text-green-800">WhatsApp Leads</span>
                        </div>
                      </div>
                      {whatsappLeadsMessages.map((message) => (
                        <button
                          key={message.id}
                          onClick={handleWhatsappLeadsClick}
                          className="w-full p-4 text-left hover:bg-green-50 transition-colors duration-200 border-b border-green-100"
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
                                <div className="flex items-center gap-2">
                                  <p className="text-xs text-gray-500">
                                    {new Date(message.latest_message_time).toLocaleTimeString([], { 
                                      hour: '2-digit', 
                                      minute: '2-digit' 
                                    })}
                                  </p>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleWhatsappMessageRead(message);
                                    }}
                                    className="btn btn-ghost btn-xs text-green-600 hover:bg-green-100"
                                    title="Mark as read"
                                  >
                                    ✓
                                  </button>
                                </div>
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
                        </button>
                      ))}
                    </div>
                  )}
                  
                  {/* Empty state - only show if no messages at all */}
                  {rmqMessages.length === 0 && whatsappLeadsMessages.length === 0 && !currentUser && (
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
      
      <style>{`
        .glassy-notification-box {
          background: rgba(255,255,255,0.60);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border-radius: 1rem;
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