import React, { useState, useRef, useEffect } from 'react';
import { ChevronDownIcon } from '@heroicons/react/24/outline';
import ContractTemplatesManager from './ContractTemplatesManager';
import UsersManager from './UsersManager';
import PaymentPlanRowsManager from './PaymentPlanRowsManager';
import AccessLogsManager from './AccessLogsManager';
import CurrenciesManager from './CurrenciesManager';
import DepartmentsManager from './DepartmentsManager';
import EmployeesManager from './EmployeesManager';
import SourcesManager from './SourcesManager';
import BankAccountsManager from './BankAccountsManager';
import MeetingLocationsManager from './MeetingLocationsManager';
import LanguagesManager from './LanguagesManager';
import HolidaysManager from './HolidaysManager';
import LeadTagsManager from './LeadTagsManager';
import LeadStageReasonsManager from './LeadStageReasonsManager';
import MainCategoriesManager from './MainCategoriesManager';
import SubCategoriesManager from './SubCategoriesManager';
import WhatsAppNumbersManager from './WhatsAppNumbersManager';
import WhatsAppTemplatesManager from './WhatsAppTemplatesManager';
import { useAdminRole } from '../../hooks/useAdminRole';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

const ADMIN_TABS = [
  {
    label: 'Accounting',
    subcategories: ['Currencies', 'Currency rates', 'Money accounts', 'Vats'],
    requiresAdmin: true,
  },
  {
    label: 'Authentication',
    subcategories: ['Groups', 'Users'],
    requiresAdmin: true,
  },
  {
    label: 'Finances',
    subcategories: ['Payment plan rows'],
    requiresAdmin: true,
  },
  {
    label: 'Hooks',
    subcategories: ['Access Logs'],
    requiresAdmin: true,
  },
  {
    label: 'Leads',
    subcategories: ['Anchors', 'Contacts', 'Leads'],
    requiresAdmin: true,
  },
  {
    label: 'Marketing',
    subcategories: ['Marketing expenses', 'Marketing suppliers', 'Sales team expenses'],
    requiresAdmin: true,
  },
  {
    label: 'Misc',
    subcategories: [
      'Bonus formulas', 'Contract templates', 'Countries', 'Email Templates', 'Holidays', 'Languages', 'Lead Stage Reasons', 'Lead Sources', 'Lead Tags', 'Main Categories', 'Public messages', 'sub categories', 'whatsapp template olds'
    ],
    requiresAdmin: false, // Everyone can access Misc
  },
  {
    label: 'Tenants',
    subcategories: ['Bank accounts', 'Departements', 'Employees', 'Firms', 'Meeting Locations'],
    requiresAdmin: true,
  },
  {
    label: 'Whatsapp',
    subcategories: ['Whatsapp numbers', 'Whats app templates'],
    requiresAdmin: true,
  },
];

// Type for leads
type Lead = { id: number; name: string; email: string; phone: string; stage: string; number: string };

// Type for access logs
type AccessLog = {
  id: number;
  created_at: string;
  request_method: string;
  endpoint: string;
  request_body: string;
  response_body: string;
  response_code: number;
};

// Type for users
type User = {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  full_name: string;
  created_at: string;
  is_active: boolean;
};

const AdminPage: React.FC = () => {
  const { isAdmin, isLoading, refreshAdminStatus } = useAdminRole();
  const navigate = useNavigate();
  const [openTab, setOpenTab] = useState<number | null>(null);
  const [selected, setSelected] = useState<{ tab: number | null; sub: number | null }>({ tab: null, sub: null });
  const tabBarRef = useRef<HTMLDivElement>(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(false);

  // State for current user
  const [currentUser, setCurrentUser] = useState<{ first_name?: string; email?: string } | null>(null);
  const [userLoading, setUserLoading] = useState(true);
  const [isTopSectionCollapsed, setIsTopSectionCollapsed] = useState(false);
  const [dropdownPositions, setDropdownPositions] = useState<{[key: number]: 'left' | 'right'}>({});
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Function to get time-based greeting
  const getTimeBasedGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good day';
    return 'Good evening';
  };

  // Auto-collapse top section when a table is opened
  useEffect(() => {
    const hasTableOpen = selected.tab !== null && selected.sub !== null;
    setIsTopSectionCollapsed(hasTableOpen);
  }, [selected]);

  // Recalculate dropdown positions on window resize
  useEffect(() => {
    const handleResize = () => {
      if (openTab !== null) {
        const position = calculateDropdownPosition(openTab);
        setDropdownPositions(prev => ({ ...prev, [openTab]: position }));
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [openTab]);

  // Outside click handler to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (openTab !== null && dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpenTab(null);
      }
    };

    // Add event listener when dropdown is open
    if (openTab !== null) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    // Cleanup event listener
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [openTab]);

  // Function to calculate dropdown position
  const calculateDropdownPosition = (tabIndex: number) => {
    if (!tabBarRef.current) return 'left';
    
    const tabBar = tabBarRef.current;
    const tabElement = tabBar.children[tabIndex] as HTMLElement;
    if (!tabElement) return 'left';
    
    const tabBarRect = tabBar.getBoundingClientRect();
    const tabRect = tabElement.getBoundingClientRect();
    const dropdownWidth = 224; // w-56 = 14rem = 224px
    const viewportWidth = window.innerWidth;
    
    // For mobile screens, use a more conservative approach
    const isMobile = viewportWidth < 768;
    
    if (isMobile) {
      // On mobile, check if the dropdown would overflow the viewport
      const spaceOnRight = viewportWidth - tabRect.left;
      const spaceOnLeft = tabRect.right;
      
      // If dropdown would overflow on the right, align to right
      if (spaceOnRight < dropdownWidth) {
        return 'right';
      }
      // If dropdown would overflow on the left when aligned right, center it
      if (spaceOnLeft < dropdownWidth) {
        return 'right'; // Use right alignment as fallback
      }
      return 'left';
    } else {
      // Desktop logic
      const spaceOnRight = tabBarRect.right - tabRect.left;
      const spaceOnLeft = tabRect.right - tabBarRect.left;
      
      return spaceOnRight < dropdownWidth && spaceOnLeft > dropdownWidth ? 'right' : 'left';
    }
  };

  // Function to fetch current user data
  const fetchCurrentUser = async () => {
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      
      if (authError) {
        console.error('Error getting auth user:', authError);
        setUserLoading(false);
        return;
      }
      
      if (!user) {
        console.log('No authenticated user found');
        setUserLoading(false);
        return;
      }
      
      console.log('Auth user ID:', user.id);
      console.log('Auth user email:', user.email);
      
      // Try to find user by auth ID first
      let { data: userData, error } = await supabase
        .from('users')
        .select('id, first_name, email, auth_id')
        .eq('auth_id', user.id)
        .maybeSingle();
      
      // If not found by auth_id, try by email
      if (!userData && user.email) {
        console.log('User not found by auth_id, trying by email:', user.email);
        const { data: userByEmail, error: emailError } = await supabase
          .from('users')
          .select('id, first_name, email, auth_id')
          .eq('email', user.email)
          .maybeSingle();
        
        userData = userByEmail;
        error = emailError;
      }
      
      if (error) {
        console.error('Error fetching user data:', error);
        console.error('Auth user details:', { id: user.id, email: user.email });
      } else if (userData) {
        console.log('Found user data:', userData);
        setCurrentUser({
          first_name: userData.first_name,
          email: userData.email
        });
      } else {
        console.log('❌ No user found in users table for auth user:', user.id);
        console.log('🔍 This means either:');
        console.log('   1. The user exists in Supabase Auth but not in the users table');
        console.log('   2. The auth_id field in users table is null or doesn\'t match');
        console.log('   3. The user was created in auth but not synced to users table');
        console.log('');
        console.log('💡 To fix this, you need to either:');
        console.log('   1. Create a user record in the users table with the correct auth_id');
        console.log('   2. Or update the existing user record to have the correct auth_id');
        console.log('');
        
        // Set a fallback with just the email from auth
        setCurrentUser({
          first_name: undefined,
          email: user.email || 'Unknown'
        });
      }
    } catch (error) {
      console.error('Error fetching current user:', error);
    } finally {
      setUserLoading(false);
    }
  };

  // Arrow visibility logic
  useEffect(() => {
    const checkArrows = () => {
      const el = tabBarRef.current;
      if (!el) return;
      setShowLeftArrow(el.scrollLeft > 2);
      setShowRightArrow(el.scrollWidth - el.clientWidth - el.scrollLeft > 2);
    };
    checkArrows();
    window.addEventListener('resize', checkArrows);
    if (tabBarRef.current) {
      tabBarRef.current.addEventListener('scroll', checkArrows);
    }
    return () => {
      window.removeEventListener('resize', checkArrows);
      if (tabBarRef.current) {
        tabBarRef.current.removeEventListener('scroll', checkArrows);
      }
    };
  }, [ADMIN_TABS.length]);

  const scrollTabs = (dir: 'left' | 'right') => {
    const el = tabBarRef.current;
    if (!el) return;
    const scrollAmount = el.clientWidth * 0.7;
    el.scrollBy({ left: dir === 'left' ? -scrollAmount : scrollAmount, behavior: 'smooth' });
  };

  // Fetch current user data on component mount
  useEffect(() => {
    fetchCurrentUser();
  }, []);



  // Show loading state
  if (isLoading || userLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="loading loading-spinner loading-lg"></div>
      </div>
    );
  }

  // Show access denied only if user is not admin AND not staff AND not superuser
  // But allow access to admin panel for all users, just with limited tabs
  if (!isAdmin) {
    // Don't block access completely, just show limited tabs
    // Silent check - no logging needed
  }

  return (
    <div className="p-6 w-full">
      {/* Welcome Section */}
      <div className={`mb-12 transition-all duration-500 ease-in-out overflow-hidden ${
        isTopSectionCollapsed ? 'max-h-0 mb-0' : 'max-h-screen'
      }`}>
        <div className="text-center py-12 relative">
          {/* Background decoration */}
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-secondary/5 rounded-3xl"></div>
          <div className="absolute top-0 left-1/2 transform -translate-x-1/2 w-32 h-32 bg-gradient-to-br from-primary/10 to-secondary/10 rounded-full blur-3xl"></div>
          
          <div className="relative z-10">
            <div className="inline-flex items-center gap-3 mb-6">
              <div className="p-3 bg-gradient-to-br from-primary to-secondary rounded-2xl shadow-lg">
                <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="text-left">
                <div className="text-sm font-semibold text-primary/80 uppercase tracking-wider">Admin Dashboard</div>
                <div className="text-xs text-base-content/60">Management Center</div>
              </div>
            </div>
            
            <h1 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-primary via-secondary to-primary bg-clip-text text-transparent mb-4 leading-tight">
              {getTimeBasedGreeting()}{currentUser?.first_name ? `, ${currentUser.first_name}` : ''}!
            </h1>
            <p className="text-base md:text-lg text-base-content/70 mb-8 font-medium">Welcome to your CRM Admin Panel</p>
          </div>
        </div>
        
        {/* Quick Action Buttons */}
        <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 max-w-6xl mx-auto transition-all duration-500 ease-in-out ${
          isTopSectionCollapsed ? 'opacity-0 max-h-0 overflow-hidden' : 'opacity-100 max-h-screen'
        }`}>
          <button
            onClick={() => {
              const usersTab = ADMIN_TABS.findIndex(tab => tab.label === 'Authentication');
              const usersSub = ADMIN_TABS[usersTab]?.subcategories.findIndex(sub => sub === 'Users');
              setSelected({ tab: usersTab, sub: usersSub || 0 });
              setOpenTab(null);
              setIsTopSectionCollapsed(true); // Auto-collapse after clicking
            }}
            className="rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl shadow-xl bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white relative overflow-hidden p-6 h-32"
          >
            <div className="flex items-center gap-4">
              <div className="flex items-center justify-center w-14 h-14 rounded-full bg-white/20 shadow">
                <svg className="w-7 h-7 text-white opacity-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
                </svg>
              </div>
              <div>
                <div className="text-3xl font-extrabold text-white leading-tight">Users</div>
                <div className="text-white/80 text-xs font-medium mt-1">Manage Users</div>
              </div>
            </div>
            {/* SVG Graph Placeholder */}
            <svg className="absolute bottom-2 right-2 w-16 h-8 opacity-40" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 64 32"><path d="M2 28 Q16 8 32 20 T62 8" /></svg>
          </button>
          
          <button
            onClick={() => {
              const employeesTab = ADMIN_TABS.findIndex(tab => tab.label === 'Tenants');
              const employeesSub = ADMIN_TABS[employeesTab]?.subcategories.findIndex(sub => sub === 'Employees');
              setSelected({ tab: employeesTab, sub: employeesSub || 0 });
              setOpenTab(null);
              setIsTopSectionCollapsed(true); // Auto-collapse after clicking
            }}
            className="rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl shadow-xl bg-gradient-to-tr from-purple-600 via-blue-600 to-blue-500 text-white relative overflow-hidden p-6 h-32"
          >
            <div className="flex items-center gap-4">
              <div className="flex items-center justify-center w-14 h-14 rounded-full bg-white/20 shadow">
                <svg className="w-7 h-7 text-white opacity-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m9-4a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              </div>
              <div>
                <div className="text-2xl font-extrabold text-white leading-tight">Employees</div>
                <div className="text-white/80 text-xs font-medium mt-1">Manage Team</div>
              </div>
            </div>
            {/* SVG Bar Chart Placeholder */}
            <svg className="absolute bottom-2 right-2 w-12 h-8 opacity-40" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 48 32"><rect x="2" y="20" width="4" height="10"/><rect x="10" y="10" width="4" height="20"/><rect x="18" y="16" width="4" height="14"/><rect x="26" y="6" width="4" height="24"/><rect x="34" y="14" width="4" height="16"/></svg>
          </button>
          
          <button
            onClick={() => {
              const sourcesTab = ADMIN_TABS.findIndex(tab => tab.label === 'Misc');
              const sourcesSub = ADMIN_TABS[sourcesTab]?.subcategories.findIndex(sub => sub === 'Lead Sources');
              setSelected({ tab: sourcesTab, sub: sourcesSub || 0 });
              setOpenTab(null);
              setIsTopSectionCollapsed(true); // Auto-collapse after clicking
            }}
            className="rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl shadow-xl bg-gradient-to-tr from-blue-500 via-cyan-500 to-teal-400 text-white relative overflow-hidden p-6 h-32"
          >
            <div className="flex items-center gap-4">
              <div className="flex items-center justify-center w-14 h-14 rounded-full bg-white/20 shadow">
                <svg className="w-7 h-7 text-white opacity-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
              </div>
              <div>
                <div className="text-3xl font-extrabold text-white leading-tight">Sources</div>
                <div className="text-white/80 text-xs font-medium mt-1">Lead Sources</div>
              </div>
            </div>
            {/* SVG Circle Placeholder */}
            <svg className="absolute bottom-2 right-2 w-10 h-10 opacity-40" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 32 32"><circle cx="16" cy="16" r="12" /><text x="16" y="21" textAnchor="middle" fontSize="10" fill="white" opacity="0.7">99+</text></svg>
          </button>
          
          <button
            onClick={() => {
              const contractsTab = ADMIN_TABS.findIndex(tab => tab.label === 'Misc');
              const contractsSub = ADMIN_TABS[contractsTab]?.subcategories.findIndex(sub => sub === 'Contract templates');
              setSelected({ tab: contractsTab, sub: contractsSub || 0 });
              setOpenTab(null);
              setIsTopSectionCollapsed(true); // Auto-collapse after clicking
            }}
            className="rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl shadow-xl bg-gradient-to-tr from-[#4b2996] via-[#6c4edb] to-[#3b28c7] text-white relative overflow-hidden p-6 h-32"
          >
            <div className="flex items-center gap-4">
              <div className="flex items-center justify-center w-14 h-14 rounded-full bg-white/20 shadow">
                <svg className="w-7 h-7 text-white opacity-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div>
                <div className="text-3xl font-extrabold text-white leading-tight">Contracts</div>
                <div className="text-white/80 text-xs font-medium mt-1">Templates</div>
              </div>
            </div>
            {/* SVG Line Chart Placeholder */}
            <svg className="absolute bottom-2 right-2 w-16 h-8 opacity-40" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 64 32"><polyline points="2,28 16,20 32,24 48,10 62,18" /></svg>
          </button>
          
          <button
            onClick={() => {
              const accessLogsTab = ADMIN_TABS.findIndex(tab => tab.label === 'Hooks');
              const accessLogsSub = ADMIN_TABS[accessLogsTab]?.subcategories.findIndex(sub => sub === 'Access Logs');
              setSelected({ tab: accessLogsTab, sub: accessLogsSub || 0 });
              setOpenTab(null);
              setIsTopSectionCollapsed(true); // Auto-collapse after clicking
            }}
            className="rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl shadow-xl bg-gradient-to-tr from-teal-400 via-green-400 to-green-600 text-white relative overflow-hidden p-6 h-32"
          >
            <div className="flex items-center gap-4">
              <div className="flex items-center justify-center w-14 h-14 rounded-full bg-white/20 shadow">
                <svg className="w-7 h-7 text-white opacity-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              </div>
              <div>
                <div className="text-3xl font-extrabold text-white leading-tight">Access</div>
                <div className="text-white/80 text-xs font-medium mt-1">Logs</div>
              </div>
            </div>
            {/* SVG Activity Log Placeholder */}
            <svg className="absolute bottom-2 right-2 w-12 h-8 opacity-40" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 48 32"><rect x="2" y="8" width="4" height="16"/><rect x="8" y="12" width="4" height="12"/><rect x="14" y="6" width="4" height="18"/><rect x="20" y="10" width="4" height="14"/><rect x="26" y="14" width="4" height="10"/><rect x="32" y="4" width="4" height="20"/><rect x="38" y="8" width="4" height="16"/></svg>
          </button>
        </div>
      </div>

      {/* Collapse/Expand Button */}
      <div className="relative">
        <button
          onClick={() => setIsTopSectionCollapsed(!isTopSectionCollapsed)}
          className={`fixed top-20 right-4 md:right-8 z-50 p-2 md:p-3 rounded-full shadow-lg transition-all duration-300 transform hover:scale-110 ${
            isTopSectionCollapsed 
              ? 'bg-gradient-to-r from-primary to-secondary text-white' 
              : 'bg-white text-primary border-2 border-primary/20 hover:border-primary/40'
          }`}
          title={isTopSectionCollapsed ? 'Show Welcome Section' : 'Hide Welcome Section'}
        >
          <svg 
            className={`w-5 h-5 md:w-6 md:h-6 transition-transform duration-300 ${isTopSectionCollapsed ? 'rotate-180' : ''}`} 
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor" 
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
          </svg>
        </button>
      </div>

      <div className="relative" style={{ minHeight: 48 }}>
        {/* Left Arrow */}
        {showLeftArrow && (
          <button
            className="absolute left-0 top-0 bottom-0 z-20 flex items-center px-1 bg-gradient-to-r from-white/90 via-white/60 to-transparent hover:bg-white/80 shadow-md rounded-l-xl"
            style={{ height: '100%' }}
            onClick={() => scrollTabs('left')}
            aria-label="Scroll left"
          >
            <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
        )}
        {/* Right Arrow */}
        {showRightArrow && (
          <button
            className="absolute right-0 top-0 bottom-0 z-20 flex items-center px-1 bg-gradient-to-l from-white/90 via-white/60 to-transparent hover:bg-white/80 shadow-md rounded-r-xl"
            style={{ height: '100%' }}
            onClick={() => scrollTabs('right')}
            aria-label="Scroll right"
          >
            <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          </button>
        )}
        <div
          ref={tabBarRef}
          className="flex border-b border-base-200/50 mb-0 gap-2 flex-nowrap scrollbar-hide overflow-x-auto bg-white/50 backdrop-blur-sm rounded-t-2xl shadow-sm"
          style={{
            WebkitOverflowScrolling: 'touch',
            minHeight: 0,
            overflowX: openTab !== null ? 'visible' : 'auto',
            height: 56,
          }}
        >
          {ADMIN_TABS
            .filter(tab => {
              const hasAccess = !tab.requiresAdmin || isAdmin;
              return hasAccess;
            }) // Only show tabs user has access to
            .map((tab, i) => {
            const isOpen = openTab === i;
            return (
              <div key={tab.label} className="relative flex-shrink-0" ref={openTab === i ? dropdownRef : null}>
                <button
                  className={`flex items-center gap-2 px-4 py-3 text-sm md:text-base font-semibold rounded-t-xl transition-all duration-300 whitespace-nowrap min-w-max relative overflow-hidden group
                    ${isOpen 
                      ? 'bg-gradient-to-b from-primary to-primary/90 text-white shadow-lg transform scale-105' 
                      : 'text-base-content/70 hover:text-primary hover:bg-white/80 hover:shadow-md hover:scale-105'}`}
                  style={{ outline: 'none' }}
                  onClick={() => {
                    if (!isOpen) {
                      const position = calculateDropdownPosition(i);
                      setDropdownPositions(prev => ({ ...prev, [i]: position }));
                    }
                    setOpenTab(isOpen ? null : i);
                  }}
                >
                  {/* Background effect for active tab */}
                  {isOpen && (
                    <div className="absolute inset-0 bg-gradient-to-b from-white/20 to-transparent rounded-t-xl"></div>
                  )}
                  
                  <span className="relative z-10">{tab.label}</span>
                  
                  <ChevronDownIcon
                    className={`w-4 h-4 md:w-5 md:h-5 transition-all duration-300 relative z-10 ${isOpen ? 'rotate-180 text-white' : 'text-base-content/60 group-hover:text-primary'}`}
                    aria-hidden="true"
                  />
                  
                  {/* Active indicator */}
                  {isOpen && (
                    <div className="absolute bottom-0 left-1/2 transform -translate-x-1/2 w-8 h-1 bg-white rounded-full"></div>
                  )}
                </button>
                
                {/* Subcategories dropdown under the open tab (vertical list) */}
                {isOpen && (
                  <div className={`absolute top-full z-50 bg-white border border-base-200/50 rounded-b-2xl shadow-xl flex flex-col w-full max-w-sm md:w-56 py-3 animate-fade-in max-h-80 overflow-y-auto backdrop-blur-sm ${
                    window.innerWidth < 768 
                      ? 'left-0 right-0 mx-2' 
                      : dropdownPositions[i] === 'right' ? 'right-0' : 'left-0'
                  }`}>
                    {tab.subcategories.map((sub, j) => (
                      <button
                        key={sub}
                        className={`w-full text-left px-4 py-3 text-sm font-medium rounded-lg transition-all duration-200 whitespace-nowrap mx-2 group
                          ${selected.tab === i && selected.sub === j
                            ? 'bg-gradient-to-r from-primary to-primary/90 text-white shadow-md transform scale-105'
                            : 'text-base-content hover:bg-primary/10 hover:text-primary hover:shadow-sm hover:scale-105'}`}
                        onClick={() => {
                          setSelected({ tab: i, sub: j });
                          setOpenTab(null);
                        }}
                      >
                        <span className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full transition-colors ${selected.tab === i && selected.sub === j ? 'bg-white' : 'bg-primary/30 group-hover:bg-primary'}`}></div>
                        {sub}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {/* Content Area */}
      <div className="bg-base-100 rounded-xl shadow p-8 min-h-[200px] mt-8">
        {/* Welcome message for non-admin users */}
        {!isAdmin && selected.tab === null && selected.sub === null && (
          <div className="text-center py-8">
            <div className="mb-4">
              <svg className="w-16 h-16 mx-auto text-primary mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <h2 className="text-2xl font-bold text-primary mb-2">Welcome to Admin Panel</h2>
              <p className="text-base-content/70 mb-4">You have limited access to the admin panel.</p>
            </div>
          </div>
        )}
        
        {selected.tab !== null && selected.sub !== null ? (
          // Check if user has access to this tab
          (() => {
            const filteredTabs = ADMIN_TABS.filter(tab => !tab.requiresAdmin || isAdmin);
            const selectedTab = filteredTabs[selected.tab];
            
            // If user is not admin and trying to access admin-only content, show access denied
            if (selectedTab && selectedTab.requiresAdmin && !isAdmin) {
              return (
                <div className="flex items-center justify-center text-xl font-semibold text-red-600">
                  <span className="text-base text-base-content/60 font-normal">Access Denied - Admin privileges required</span>
                </div>
              );
            }
            
            // Render content based on selected tab
            return selectedTab?.label === 'Misc' &&
            selectedTab?.subcategories[selected.sub] === 'Contract templates' ? (
              <div className="w-full"><ContractTemplatesManager /></div>
            ) : selectedTab?.label === 'Authentication' &&
            selectedTab?.subcategories[selected.sub] === 'Users' ? (
              <div className="w-full"><UsersManager /></div>
            ) : selectedTab?.label === 'Finances' &&
            selectedTab?.subcategories[selected.sub] === 'Payment plan rows' ? (
              <div className="w-full"><PaymentPlanRowsManager /></div>
            ) : selectedTab?.label === 'Hooks' &&
            selectedTab?.subcategories[selected.sub] === 'Access Logs' ? (
              <div className="w-full"><AccessLogsManager /></div>
            ) : selectedTab?.label === 'Accounting' &&
            selectedTab?.subcategories[selected.sub] === 'Currencies' ? (
              <div className="w-full"><CurrenciesManager /></div>
            ) : selectedTab?.label === 'Tenants' &&
            selectedTab?.subcategories[selected.sub] === 'Departements' ? (
              <div className="w-full"><DepartmentsManager /></div>
            ) : selectedTab?.label === 'Tenants' &&
            selectedTab?.subcategories[selected.sub] === 'Employees' ? (
              <div className="w-full"><EmployeesManager /></div>
            ) : selectedTab?.label === 'Misc' &&
            selectedTab?.subcategories[selected.sub] === 'Lead Sources' ? (
              <div className="w-full"><SourcesManager /></div>
            ) : selectedTab?.label === 'Tenants' &&
            selectedTab?.subcategories[selected.sub] === 'Bank accounts' ? (
              <div className="w-full"><BankAccountsManager /></div>
            ) : selectedTab?.label === 'Tenants' &&
            selectedTab?.subcategories[selected.sub] === 'Meeting Locations' ? (
              <div className="w-full"><MeetingLocationsManager /></div>
            ) : selectedTab?.label === 'Misc' &&
            selectedTab?.subcategories[selected.sub] === 'Languages' ? (
              <div className="w-full"><LanguagesManager /></div>
            ) : selectedTab?.label === 'Misc' &&
            selectedTab?.subcategories[selected.sub] === 'Holidays' ? (
              <div className="w-full"><HolidaysManager /></div>
            ) : selectedTab?.label === 'Misc' &&
            selectedTab?.subcategories[selected.sub] === 'Lead Tags' ? (
              <div className="w-full"><LeadTagsManager /></div>
            ) : selectedTab?.label === 'Misc' &&
            selectedTab?.subcategories[selected.sub] === 'Lead Stage Reasons' ? (
              <div className="w-full"><LeadStageReasonsManager /></div>
            ) : selectedTab?.label === 'Misc' &&
            selectedTab?.subcategories[selected.sub] === 'Main Categories' ? (
              <div className="w-full"><MainCategoriesManager /></div>
            ) : selectedTab?.label === 'Misc' &&
            selectedTab?.subcategories[selected.sub] === 'sub categories' ? (
              <div className="w-full"><SubCategoriesManager /></div>
            ) : selectedTab?.label === 'Whatsapp' &&
            selectedTab?.subcategories[selected.sub] === 'Whatsapp numbers' ? (
              <div className="w-full"><WhatsAppNumbersManager /></div>
            ) : selectedTab?.label === 'Whatsapp' &&
            selectedTab?.subcategories[selected.sub] === 'Whats app templates' ? (
              <div className="w-full"><WhatsAppTemplatesManager /></div>
            ) : (
              <div className="flex items-center justify-center text-xl font-semibold text-primary">
                {`${selectedTab?.label} / ${selectedTab?.subcategories[selected.sub]}`}
                <span className="ml-4 text-base text-base-content/60 font-normal">(Placeholder content)</span>
              </div>
            );
          })()
        ) : openTab !== null ? (
          <div className="flex items-center justify-center text-xl font-semibold text-primary">
            <span className="text-base text-base-content/60 font-normal">Select a subcategory</span>
          </div>
        ) : (
          <div className="text-center py-12">
            <div className="mb-6">
              <svg className="w-20 h-20 mx-auto text-primary mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <h2 className="text-2xl font-bold text-primary mb-2">Choose a Management Section</h2>
              <p className="text-base-content/70 mb-6">Select a category from the tabs above or use the quick action buttons to get started.</p>
            </div>
          </div>
        )}
      </div>
      {/* Glassy card style */}
      <style>{`
        .glass-card {
          background: rgba(255,255,255,0.70);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border-radius: 1.25rem;
          box-shadow: 0 4px 24px 0 rgba(0,0,0,0.08), 0 1.5px 8px 0 rgba(0,0,0,0.04);
          transition: box-shadow 0.2s, transform 0.2s;
        }
      `}</style>
    </div>
  );
};

export default AdminPage; 