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
  SparklesIcon,
  DocumentChartBarIcon,
  CalendarIcon,
  ArrowRightOnRectangleIcon,
} from '@heroicons/react/24/outline';
import { useMsal } from '@azure/msal-react';
import { loginRequest } from '../msalConfig';

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
  const searchTimeoutRef = useRef<NodeJS.Timeout>();
  const { instance } = useMsal();
  const [isMsalLoading, setIsMsalLoading] = useState(false);
  const [userAccount, setUserAccount] = useState<any>(null);
  const [isMsalInitialized, setIsMsalInitialized] = useState(false);
  const [userFullName, setUserFullName] = useState<string | null>(null);

  const unreadCount = notifications.filter(n => !n.read).length;

  const navTabs = [
    {
      label: 'Calendar',
      path: '/calendar',
      icon: CalendarIcon,
    },
    {
      label: 'Reports',
      path: '/reports',
      icon: DocumentChartBarIcon,
    },
  ];

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(event.target as Node)
      ) {
        setIsSearchActive(false);
        setSearchResults([]);
        setSearchValue('');
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
  }, []);

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
            onMouseLeave={handleSearchMouseLeave}
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
                  w-full bg-white/10 border border-white/20 shadow-lg text-cyan-800 placeholder-cyan-900 rounded-xl pl-14 pr-10 focus:outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-300/40 transition-all duration-300
                  ${isSearchActive ? 'opacity-100 visible' : 'opacity-0 invisible'}
                  ${searchValue.trim() || searchResults.length > 0 ? 'pr-10' : ''}
                `}
                style={{ height: 44, fontSize: 16, fontWeight: 500, letterSpacing: '-0.01em', boxShadow: isSearchActive ? '0 4px 24px 0 rgba(0,0,0,0.10)' : undefined }}
              />
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
            </div>

            {/* Search Results Dropdown */}
            {isSearchActive && (searchResults.length > 0 || isSearching) && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-white/80 backdrop-blur-xl rounded-xl shadow-xl border border-white/30 max-h-96 overflow-y-auto z-50 transition-all duration-300 animate-fadeInUp">
                {isSearching ? (
                  <div className="p-4 text-center text-base-content/70">
                    Searching...
                  </div>
                ) : (
                  <div className="divide-y divide-white/30">
                    {searchResults.map((result, idx) => (
                      <button
                        key={result.id}
                        className="w-full px-4 py-3 flex items-center gap-3 text-left transition-colors duration-200 text-white/90 hover:bg-cyan-400/20 focus:bg-cyan-400/30 rounded-xl"
                        onClick={() => handleSearchResultClick(result)}
                        style={{ fontWeight: 500, fontSize: 16, letterSpacing: '-0.01em' }}
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-cyan-700">{result.name}</span>
                            <span className="text-sm text-cyan-500 font-bold">{result.lead_number}</span>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {/* Subtle shadow and border for dropdown */}
                <style>{`.animate-fadeInUp { animation: fadeInUp 0.3s cubic-bezier(.4,0,.2,1); } @keyframes fadeInUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }`}</style>
              </div>
            )}
          </div>
        </div>

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
            <SparklesIcon className="w-6 h-6 text-primary" />
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