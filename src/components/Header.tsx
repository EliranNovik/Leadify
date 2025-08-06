import React, { useState, useRef, useEffect } from 'react';
import { useLocation, Link, useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { searchLeads } from '../lib/supabase';
import { supabase } from '../lib/supabase';
import type { Lead } from '../lib/supabase';
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
} from '@heroicons/react/24/outline';
import { useMsal } from '@azure/msal-react';
import { loginRequest } from '../msalConfig';
import { FaRobot } from 'react-icons/fa';
import { FaWhatsapp } from 'react-icons/fa';

interface HeaderProps {
  onMenuClick: () => void;
  onSearchClick: () => void;
  isSearchOpen: boolean;
  setIsSearchOpen: (isOpen: boolean) => void;
  appJustLoggedIn?: boolean;
  onOpenAIChat?: () => void;
  isMenuOpen?: boolean;
  onOpenEmailThread?: () => void;
}

interface Notification {
  id: string;
  type: 'action' | 'info';
  message: string;
  time: string;
  read: boolean;
}

const mockNotifications: Notification[] = [
  {
    id: '1',
    type: 'action',
    message: 'Sarah assigned you as Expert for client David Cohen',
    time: '2 hours ago',
    read: false
  },
  {
    id: '2',
    type: 'info',
    message: 'Michael updated the meeting notes for Rachel Levy',
    time: '5 hours ago',
    read: false
  },
  {
    id: '3',
    type: 'action',
    message: 'Contract approval needed for Daniel Mizrahi',
    time: '1 day ago',
    read: true
  },
  {
    id: '4',
    type: 'info',
    message: 'Jonathan shared new documents in the case file',
    time: '2 days ago',
    read: true
  }
];

const Header: React.FC<HeaderProps> = ({ onMenuClick, onSearchClick, isSearchOpen, setIsSearchOpen, appJustLoggedIn, onOpenAIChat, isMenuOpen, onOpenEmailThread }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [isSearchActive, setIsSearchActive] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [searchResults, setSearchResults] = useState<Lead[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>(mockNotifications);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const notificationsRef = useRef<HTMLDivElement>(null);
  const searchDropdownRef = useRef<HTMLDivElement>(null);
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
  const searchHoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [showQuickActionsDropdown, setShowQuickActionsDropdown] = useState(false);
  const [showMobileQuickActionsDropdown, setShowMobileQuickActionsDropdown] = useState(false);
  const [showSignOutModal, setShowSignOutModal] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const unreadCount = notifications.filter(n => !n.read).length;

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
      label: 'Reports',
      path: '/reports',
      icon: DocumentChartBarIcon,
    },
    {
      label: 'Teams',
      path: '/teams',
      icon: UserGroupIcon,
    },
    {
      label: 'WhatsApp',
      path: '/whatsapp',
      icon: FaWhatsapp,
    },
    {
      label: 'Email Chat',
      action: 'email-thread',
      icon: EnvelopeIcon,
    },
  ];

  useEffect(() => {
    const handleClickOutside = (event: Event) => {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(event.target as Node) &&
        searchDropdownRef.current &&
        !searchDropdownRef.current.contains(event.target as Node)
      ) {
        if (!showFilterDropdown) {
          setIsSearchActive(false);
          setSearchResults([]);
          setSearchValue('');
        }
      }
      if (
        notificationsRef.current &&
        !notificationsRef.current.contains(event.target as Node)
      ) {
        setShowNotifications(false);
      }
      // Close quick actions dropdown when clicking outside
      const quickActionsDropdown = document.querySelector('[data-quick-actions-dropdown]');
      const dropdownMenu = document.querySelector('[data-dropdown-menu]');
      if (quickActionsDropdown && !quickActionsDropdown.contains(event.target as Node) && 
          dropdownMenu && !dropdownMenu.contains(event.target as Node)) {
        setShowQuickActionsDropdown(false);
        setShowMobileQuickActionsDropdown(false);
      }
    };

    // Add both mouse and touch events for better mobile support
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [showFilterDropdown]);

  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (searchValue.trim()) {
      setIsSearching(true);
      searchTimeoutRef.current = setTimeout(async () => {
        try {
          const results = await searchLeads(searchValue);
          setSearchResults(results);
        } catch (error) {
          console.error('Search error:', error);
        } finally {
          setIsSearching(false);
        }
      }, 300);
    } else {
      setSearchResults([]);
    }

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchValue]);

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
    // Fetch the current user's name from Supabase users table
    const fetchUserName = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user && user.email) {
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
      }
    };
    fetchUserName();
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
    setSearchValue(e.target.value);
  };

  const handleSearchResultClick = (lead: Lead) => {
    navigate(`/clients/${lead.lead_number}`);
    setSearchValue('');
    setSearchResults([]);
    setIsSearchActive(false);
  };

  const handleClearSearch = () => {
    setSearchValue('');
    setSearchResults([]);
    setIsSearchActive(false);
    searchInputRef.current?.blur();
  };

  const handleSearchMouseLeave = () => {
    // Only collapse if there's no search value and no results
    if (!searchValue.trim() && searchResults.length === 0) {
      // Add a small delay to prevent accidental collapses
      setTimeout(() => {
        // Double-check that we're still not hovering and still have no content
        if (!searchValue.trim() && searchResults.length === 0) {
          setIsSearchActive(false);
        }
      }, 150);
    }
  };

  const handleNotificationClick = () => {
    setShowNotifications(!showNotifications);
  };

  const markAllAsRead = () => {
    setNotifications(notifications.map(n => ({ ...n, read: true })));
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
    try {
      const isMobile = /iPhone|iPad|iPod|Android|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      if (isMobile) {
        await instance.loginRedirect(loginRequest);
      } else {
        const loginResponse = await instance.loginPopup(loginRequest);
        const account = instance.getAllAccounts()[0];
        setUserAccount(account);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('interaction_in_progress')) {
        return;
      }
    } finally {
      setIsMsalLoading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      console.log('Signing out from header...');
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error('Error signing out:', error);
        toast.error('Failed to sign out');
      } else {
        console.log('Successfully signed out from header');
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
  const categoryOptions = ["German Citizenship", "Austrian Citizenship", "Inquiry", "Consultation", "Other"];
  const languageOptions = ["English", "Hebrew", "German", "French", "Russian", "Other"];
  const reasonOptions = ["Inquiry", "Follow-up", "Complaint", "Consultation", "Other"];
  const tagOptions = ["VIP", "Urgent", "Family", "Business", "Other"];
  const statusOptions = ["new", "in_progress", "qualified", "not_qualified"];
  const sourceOptions = ["Manual", "AI Assistant", "Referral", "Website", "Other"];
  const stageOptions = [
    "created", "scheduler_assigned", "meeting_scheduled", "meeting_paid", "unactivated", "communication_started", "another_meeting", "revised_offer", "offer_sent", "waiting_for_mtng_sum", "client_signed", "client_declined", "lead_summary", "meeting_rescheduled", "meeting_ended"
  ];
  const topicOptions = ["German Citizenship", "Austrian Citizenship", "Inquiry", "Consultation", "Other"];

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
              onClick={() => setShowMobileQuickActionsDropdown(!showMobileQuickActionsDropdown)}
              className="flex items-center gap-1 px-3 py-2 rounded-lg font-medium transition-all duration-300 shadow-lg bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white"
            >
              <BoltIcon className="w-4 h-4 text-white" />
              <ChevronDownIcon className={`w-3 h-3 text-white transition-transform duration-200 ${showMobileQuickActionsDropdown ? 'rotate-180' : ''}`} />
            </button>
            
            {/* Dropdown Menu */}
            {showMobileQuickActionsDropdown && createPortal(
              <div 
                className="fixed w-40 bg-white rounded-xl shadow-2xl border border-gray-200 z-[9999] overflow-hidden"
                data-dropdown-menu
                style={{
                  top: '64px',
                  left: '8px',
                  right: '8px'
                }}
              >
                {navTabs.map(tab => {
                  const Icon = tab.icon;
                  if (tab.action === 'email-thread') {
                    return (
                      <button
                        key={tab.label}
                        onClick={() => {
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
                  return (
                    <Link
                      key={tab.path || tab.label}
                      to={tab.path || '/'}
                      onClick={() => setShowMobileQuickActionsDropdown(false)}
                      className="flex items-center gap-3 px-4 py-3 transition-all duration-200 text-gray-700"
                    >
                      <Icon className="w-5 h-5 text-gray-500" />
                      <span className="text-sm font-medium">{tab.label}</span>
                    </Link>
                  );
                })}
              </div>,
              document.body
            )}
          </div>
          
          <div className="h-16 flex items-center">
            <Link to="/" className="hidden md:block">
              <span className="md:ml-4 text-xl md:text-2xl font-extrabold tracking-tight" style={{ color: '#3b28c7', letterSpacing: '-0.03em' }}>RMQ 2.0</span>
            </Link>
          </div>
          {/* Quick Actions Dropdown - Desktop only */}
          <div className="hidden md:block relative ml-4" data-quick-actions-dropdown>
            <button
              ref={buttonRef}
              onClick={() => setShowQuickActionsDropdown(!showQuickActionsDropdown)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl font-medium transition-all duration-300 shadow-xl bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white"
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
              >
                {navTabs.map(tab => {
                  const Icon = tab.icon;
                  if (tab.action === 'email-thread') {
                    return (
                      <button
                        key={tab.label}
                        onClick={() => {
                          setShowQuickActionsDropdown(false);
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
                  return (
                    <Link
                      key={tab.path || tab.label}
                      to={tab.path || '/'}
                      onClick={() => setShowQuickActionsDropdown(false)}
                      className="flex items-center gap-3 px-4 py-3 transition-all duration-200 text-gray-700"
                    >
                      <Icon className="w-5 h-5 text-gray-500" />
                      <span className="text-sm font-medium">{tab.label}</span>
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
                  ? 'absolute top-1/2 -translate-y-1/2' 
                  : 'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-xl md:max-w-xl'
                : 'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-1'
            }`}
            style={{ 
              background: 'transparent',
              ...(isSearchActive && isMobile && { 
                width: 'calc(100vw - 64px)',
                left: '50%',
                transform: 'translateX(-50%)'
              })
            }}
            onMouseEnter={!isMobile ? () => {
              if (searchHoverTimeoutRef.current) {
                clearTimeout(searchHoverTimeoutRef.current);
                searchHoverTimeoutRef.current = null;
              }
              setIsSearchActive(true);
              setTimeout(() => searchInputRef.current?.focus(), 100);
            } : undefined}
            onMouseLeave={!isMobile ? () => {
              if (searchHoverTimeoutRef.current) {
                clearTimeout(searchHoverTimeoutRef.current);
              }
              searchHoverTimeoutRef.current = setTimeout(() => {
                if (!searchValue.trim() && searchResults.length === 0) {
                  setIsSearchActive(false);
                }
              }, 600);
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
                  onClick={() => setShowFilterDropdown(v => !v)}
                  tabIndex={0}
                  title="Advanced Filters"
                >
                  <FunnelIcon className="w-5 h-5 text-cyan-900" />
                </button>
              )}
              {/* Advanced filter dropdown */}
              {showFilterDropdown && (
                <div
                  className="fixed bg-white rounded-xl shadow-xl border border-white/30 z-60 p-6 animate-fadeInUp"
                  style={{
                    minWidth: 320,
                    top: searchDropdownStyle.top,
                    left: searchDropdownStyle.left + searchDropdownStyle.width + 16, // 16px margin to the right of search bar
                  }}
                >
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
                        {categoryOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1">Language</label>
                      <select className="select select-bordered w-full" value={advancedFilters.language} onChange={e => setAdvancedFilters(f => ({ ...f, language: e.target.value }))}>
                        <option value="">Please choose</option>
                        {languageOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1">Reason</label>
                      <select className="select select-bordered w-full" value={advancedFilters.reason} onChange={e => setAdvancedFilters(f => ({ ...f, reason: e.target.value }))}>
                        <option value="">Please choose</option>
                        {reasonOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1">Tags</label>
                      <select className="select select-bordered w-full" value={advancedFilters.tags} onChange={e => setAdvancedFilters(f => ({ ...f, tags: e.target.value }))}>
                        <option value="">Please choose</option>
                        {tagOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1">Status</label>
                      <select className="select select-bordered w-full" value={advancedFilters.status} onChange={e => setAdvancedFilters(f => ({ ...f, status: e.target.value }))}>
                        <option value="">Please choose</option>
                        {statusOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1">Source</label>
                      <select className="select select-bordered w-full" value={advancedFilters.source} onChange={e => setAdvancedFilters(f => ({ ...f, source: e.target.value }))}>
                        <option value="">Please choose</option>
                        {sourceOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1">Stage</label>
                      <select className="select select-bordered w-full" value={advancedFilters.stage} onChange={e => setAdvancedFilters(f => ({ ...f, stage: e.target.value }))}>
                        <option value="">Please choose</option>
                        {stageOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1">Topic</label>
                      <select className="select select-bordered w-full" value={advancedFilters.topic} onChange={e => setAdvancedFilters(f => ({ ...f, topic: e.target.value }))}>
                        <option value="">Please choose</option>
                        {topicOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="mt-4 flex justify-end gap-2">
                    <button className="btn btn-outline btn-sm" onClick={() => {
                      setShowFilterDropdown(false);
                      setIsSearchActive(false);
                      setSearchResults([]);
                      setSearchValue('');
                    }}>Cancel</button>
                    <button className="btn btn-primary btn-sm" onClick={async () => {
                      setIsAdvancedSearching(true);
                      try {
                        let query = supabase.from('leads').select('*');
                        console.log('[Filter] Applying filters:', advancedFilters);
                        
                        // Build the query based on selected filters
                        if (advancedFilters.category) {
                          query = query.eq('topic', advancedFilters.category);
                        }
                        if (advancedFilters.stage) {
                          query = query.eq('stage', advancedFilters.stage);
                        }
                        if (advancedFilters.status) {
                          query = query.eq('status', advancedFilters.status);
                        }
                        if (advancedFilters.fromDate) {
                          query = query.gte('created_at', advancedFilters.fromDate);
                        }
                        if (advancedFilters.toDate) {
                          query = query.lte('created_at', advancedFilters.toDate);
                        }
                        if (advancedFilters.fileId) {
                          query = query.ilike('lead_number', `%${advancedFilters.fileId}%`);
                        }
                        
                        const { data, error } = await query.order('created_at', { ascending: false });
                        console.log('[Filter] Query result:', { data, error, count: data?.length });
                        
                        if (error) throw error;
                        
                        setSearchResults(data || []);
                        setIsSearchActive(true);
                        setShowFilterDropdown(false);
                        
                        console.log('[Filter] Set search results:', data?.length || 0);
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
          </div>
        </div>

        {/* End of search bar container */}
        {isSearchActive && (searchValue.trim() || (searchResults.length > 0 && !isAdvancedSearching)) && (
          <div
            ref={searchDropdownRef}
            className="fixed bg-white rounded-xl shadow-xl border border-gray-200 max-h-96 overflow-y-auto z-50"
            style={{
              top: searchDropdownStyle.top,
              left: searchDropdownStyle.left,
              width: searchDropdownStyle.width,
              pointerEvents: showFilterDropdown ? 'none' : 'auto',
            }}
          >
            {isSearching || isAdvancedSearching ? (
              <div className="p-4 text-center text-gray-500">
                <div className="loading loading-spinner loading-sm"></div>
                <span className="ml-2">Searching...</span>
              </div>
            ) : searchResults.length > 0 ? (
              <div className="divide-y divide-gray-100">
                {searchResults.map((result) => (
                  <button
                    key={result.id}
                    className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-gray-50 transition-colors duration-200"
                    onClick={() => handleSearchResultClick(result)}
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-900">{result.name}</span>
                        <span className="text-sm text-gray-500 font-mono">{result.lead_number}</span>
                      </div>
                      {result.topic && (
                        <div className="text-sm text-gray-600 mt-1">{result.topic}</div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="p-4 text-center text-gray-500">
                {searchValue.trim() ? `No leads found for "${searchValue}"` : 'No results found'}
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
                    <h3 className="font-semibold">Notifications</h3>
                    <button 
                      className="btn btn-ghost btn-xs"
                      onClick={markAllAsRead}
                    >
                      Mark all as read
                    </button>
                  </div>
                </div>
                <div className="max-h-96 overflow-y-auto">
                  {notifications.map((notification) => (
                    <div 
                      key={notification.id}
                      className={`p-4 border-b border-base-200 hover:bg-base-200/50 ${!notification.read ? 'bg-base-200/20' : ''}`}
                    >
                      <div className="flex gap-3">
                        <div className={`w-2 h-2 rounded-full mt-2 ${notification.type === 'action' ? 'bg-primary' : 'bg-info'}`} />
                        <div className="flex-1">
                          <p className="text-sm">{notification.message}</p>
                          <p className="text-xs text-base-content/70 mt-1">{notification.time}</p>
                        </div>
                      </div>
                    </div>
                  ))}
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