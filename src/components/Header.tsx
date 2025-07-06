import React, { useState, useRef, useEffect } from 'react';
import { useLocation, Link, useNavigate } from 'react-router-dom';
import { searchLeads } from '../lib/supabase';
import { supabase } from '../lib/supabase';
import type { Lead } from '../lib/supabase';
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
} from '@heroicons/react/24/outline';
import { useMsal } from '@azure/msal-react';
import { loginRequest } from '../msalConfig';
import { FaRobot } from 'react-icons/fa';
import { createPortal } from 'react-dom';

interface HeaderProps {
  onMenuClick: () => void;
  onSearchClick: () => void;
  isSearchOpen: boolean;
  setIsSearchOpen: (isOpen: boolean) => void;
  appJustLoggedIn?: boolean;
  onOpenAIChat?: () => void;
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

const Header: React.FC<HeaderProps> = ({ onMenuClick, onSearchClick, isSearchOpen, setIsSearchOpen, appJustLoggedIn, onOpenAIChat }) => {
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

  const unreadCount = notifications.filter(n => !n.read).length;

  const navTabs = [
    {
      label: 'Calendar',
      path: '/calendar',
    },
    {
      label: 'Reports',
      path: '/reports',
    },
    {
      label: 'Teams',
      path: '/teams',
    },
  ];

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
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
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
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
    // Fetch the current user's full name from Supabase users table
    const fetchUserFullName = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user && user.email) {
        const { data, error } = await supabase
          .from('users')
          .select('full_name')
          .eq('email', user.email)
          .single();
        if (!error && data?.full_name) {
          setUserFullName(data.full_name);
        }
      }
    };
    fetchUserFullName();
  }, []);

  useEffect(() => {
    if (isSearchActive && searchContainerRef.current) {
      const rect = searchContainerRef.current.getBoundingClientRect();
      setSearchDropdownStyle({ top: rect.bottom + window.scrollY, left: rect.left + window.scrollX, width: rect.width });
    }
  }, [isSearchActive, showFilterDropdown, searchResults.length, searchValue]);

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
      console.error('MSAL is not initialized yet');
      return;
    }

    setIsMsalLoading(true);
    try {
      const isMobile = /iPhone|iPad|iPod|Android|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      if (isMobile) {
        await instance.loginRedirect(loginRequest);
      } else {
        const loginResponse = await instance.loginPopup(loginRequest);
        console.log('Login successful:', loginResponse);
        const account = instance.getAllAccounts()[0];
        setUserAccount(account);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('interaction_in_progress')) {
        console.log('Interaction already in progress, ignoring...');
        return;
      }
      console.error('MSAL login error:', error);
    } finally {
      setIsMsalLoading(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.reload();
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
        <div className="flex-1 justify-start flex items-center gap-4 overflow-hidden">
          <button className="md:hidden btn btn-ghost btn-square" onClick={onMenuClick} aria-label="Open menu">
            <Bars3Icon className="w-6 h-6" />
          </button>
          <div className="h-16 flex items-center">
            <Link to="/">
              <span className="ml-4 text-2xl font-extrabold tracking-tight" style={{ color: '#3b28c7', letterSpacing: '-0.03em' }}>RMQ 2.0</span>
            </Link>
          </div>
          {/* Nav Tabs */}
          <nav className="flex gap-2 ml-4">
            {navTabs.map(tab => {
              const isActive = location.pathname === tab.path;
              return (
                <Link
                  key={tab.path}
                  to={tab.path}
                  className={`flex items-center px-3 py-2 rounded-lg font-medium transition-colors duration-200 ${isActive ? 'bg-primary text-white shadow' : 'hover:bg-base-200 text-base-content/80'}`}
                >
                  <span>{tab.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
        
        {/* Search bar */}
        <div className="flex-1 justify-center flex relative ml-[-32px] md:ml-[-48px]">
          <div 
            ref={searchContainerRef}
            className={`relative ${isSearchActive ? 'w-full max-w-sm' : 'w-1'} transition-all duration-500 ease-out`}
            onMouseEnter={() => {
              setIsSearchActive(true);
              setTimeout(() => searchInputRef.current?.focus(), 100);
            }}
          >
            <div className={`relative flex items-center ${isSearchActive ? 'w-full' : 'w-10'} transition-all duration-500 ease-out`}>
              {/* Large search icon (always visible) */}
              <span className="absolute left-4 flex items-center h-full pointer-events-none">
                <MagnifyingGlassIcon className="w-8 h-8 text-cyan-900 drop-shadow-md" />
              </span>
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search for leads..."
                value={searchValue}
                onChange={handleSearchChange}
                onFocus={handleSearchFocus}
                className={`
                  w-full bg-white/10 border border-white/20 shadow-lg text-cyan-800 placeholder-cyan-900 rounded-xl pl-14 pr-16 focus:outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-300/40 transition-all duration-300
                  ${isSearchActive ? 'opacity-100 visible' : 'opacity-0 invisible'}
                  ${searchValue.trim() || searchResults.length > 0 ? 'pr-16' : ''}
                `}
                style={{ height: 44, fontSize: 16, fontWeight: 500, letterSpacing: '-0.01em', boxShadow: isSearchActive ? '0 4px 24px 0 rgba(0,0,0,0.10)' : undefined }}
              />
              {/* Filter button inside input */}
              {isSearchActive && (
                <button
                  type="button"
                  className="absolute right-10 top-1/2 -translate-y-1/2 btn btn-ghost btn-circle btn-sm"
                  onClick={() => setShowFilterDropdown(v => !v)}
                  tabIndex={0}
                  title="Advanced Filters"
                >
                  <FunnelIcon className="w-6 h-6 text-cyan-900" />
                </button>
              )}
              {/* Clear search button (unchanged) */}
              {(searchValue.trim() || searchResults.length > 0) && (
                <button
                  onClick={handleClearSearch}
                  className="absolute right-2 btn btn-ghost btn-sm btn-circle transition-all duration-300 ease-out text-white/80 hover:text-cyan-400"
                  title="Clear search"
                  style={{ background: 'rgba(255,255,255,0.10)' }}
                >
                  <XMarkIcon className="w-4 h-4" />
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
        <div className="flex-1 justify-end flex items-center gap-2 md:gap-4">
          {/* Sign out button and Welcome message - desktop only */}
          {/* <button
            className="btn btn-ghost btn-circle btn-sm mr-2 hidden md:inline-flex"
            title="Sign out"
            onClick={handleSignOut}
          >
            <ArrowRightOnRectangleIcon className="w-5 h-5" />
          </button> */}
          <span className={`text-base font-medium hidden md:inline-block ${appJustLoggedIn ? 'slide-fade-in' : ''}`}>
            Welcome, <span className="font-semibold">{userFullName || 'User'}</span>
          </span>

          {/* AI Assistant Button */}
          <button
            className="btn btn-ghost btn-circle flex items-center justify-center"
            title="Open AI Assistant"
            onClick={handleAIClick}
          >
            <FaRobot className="w-7 h-7 text-primary" />
          </button>

          {/* Microsoft sign in button */}
          <button 
            className="btn btn-outline btn-sm gap-2 hidden md:flex" 
            onClick={handleMicrosoftSignIn} 
            disabled={isMsalLoading || !!userAccount || !isMsalInitialized}
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="currentColor" d="M11.4 24H0V12.6h11.4V24zM24 24H12.6V12.6H24V24zM11.4 11.4H0V0h11.4v11.4zM24 11.4H12.6V0H24v11.4z"/>
            </svg>
            {!userAccount && (isMsalLoading ? 'Signing in...' : 'Sign in')}
          </button>

          {/* Microsoft sign in - mobile only */}
          <button 
            className="btn btn-outline btn-sm btn-square md:hidden" 
            onClick={handleMicrosoftSignIn} 
            disabled={isMsalLoading || !!userAccount || !isMsalInitialized}
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
      {/* Spacer to prevent content from being hidden behind the fixed header */}
      <div className="h-16 w-full" />
      <style>{`
        .glassy-notification-box {
          background: rgba(255,255,255,0.60);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border-radius: 1rem;
        }
      `}</style>
    </>
  );
};

export default Header; 