import React, { useState, useRef, useEffect } from 'react';
import { 
  ChevronDownIcon, 
  ArrowRightOnRectangleIcon,
  CalculatorIcon,
  ShieldCheckIcon,
  BanknotesIcon,
  LinkIcon,
  UsersIcon,
  ChartBarIcon,
  Cog6ToothIcon,
  BuildingOffice2Icon,
  ChatBubbleLeftRightIcon
} from '@heroicons/react/24/outline';
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

interface AdminTab {
  label: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  subcategories: string[];
  requiresAdmin: boolean;
}

const ADMIN_TABS: AdminTab[] = [
  {
    label: 'Accounting',
    icon: CalculatorIcon,
    subcategories: ['Currencies', 'Currency rates', 'Money accounts', 'Vats'],
    requiresAdmin: true,
  },
  {
    label: 'Authentication',
    icon: ShieldCheckIcon,
    subcategories: ['Groups', 'Users'],
    requiresAdmin: true,
  },
  {
    label: 'Finances',
    icon: BanknotesIcon,
    subcategories: ['Payment plan rows'],
    requiresAdmin: true,
  },
  {
    label: 'Hooks',
    icon: LinkIcon,
    subcategories: ['Access Logs'],
    requiresAdmin: true,
  },
  {
    label: 'Leads',
    icon: UsersIcon,
    subcategories: ['Anchors', 'Contacts', 'Leads'],
    requiresAdmin: true,
  },
  {
    label: 'Marketing',
    icon: ChartBarIcon,
    subcategories: ['Marketing expenses', 'Marketing suppliers', 'Sales team expenses'],
    requiresAdmin: true,
  },
  {
    label: 'Misc',
    icon: Cog6ToothIcon,
    subcategories: [
      'Bonus formulas', 'Contract templates', 'Countries', 'Email Templates', 'Holidays', 'Languages', 'Lead Stage Reasons', 'Lead Sources', 'Lead Tags', 'Main Categories', 'Public messages', 'sub categories', 'whatsapp template olds'
    ],
    requiresAdmin: false, // Everyone can access Misc
  },
  {
    label: 'Tenants',
    icon: BuildingOffice2Icon,
    subcategories: ['Bank accounts', 'Departements', 'Employees', 'Firms', 'Meeting Locations'],
    requiresAdmin: true,
  },
  {
    label: 'Whatsapp',
    icon: ChatBubbleLeftRightIcon,
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

// Type for recent changes (combined access logs and user changes)
type RecentChange = {
  id: string | number;
  type: 'access_log' | 'user_change';
  created_at: string;
  updated_at?: string;
  request_method?: string;
  endpoint?: string;
  response_code?: number;
  user_name?: string;
  updated_by_name?: string;
  action?: string;
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
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  
  // State for sidebar collapse and employee data
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [employeeData, setEmployeeData] = useState<{
    department?: string;
    bonusRole?: string;
  } | null>(null);

  // State for recent changes
  const [recentChanges, setRecentChanges] = useState<RecentChange[]>([]);
  const [loadingChanges, setLoadingChanges] = useState(false);

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
      
      // Try to find user by auth ID first - using the same pattern as Sidebar
      let { data: userData, error } = await supabase
        .from('users')
        .select(`
          id,
          first_name,
          email,
          auth_id,
          employee_id,
          tenants_employee!employee_id(
            id,
            display_name,
            official_name,
            bonuses_role,
            department_id,
            tenant_departement!department_id(
              id,
              name
            )
          )
        `)
        .eq('auth_id', user.id)
        .maybeSingle();
      
      // If not found by auth_id, try by email
      if (!userData && user.email) {
        console.log('User not found by auth_id, trying by email:', user.email);
        const { data: userByEmail, error: emailError } = await supabase
          .from('users')
          .select(`
            id,
            first_name,
            email,
            auth_id,
            employee_id,
            tenants_employee!employee_id(
              id,
              display_name,
              official_name,
              bonuses_role,
              department_id,
              tenant_departement!department_id(
                id,
                name
              )
            )
          `)
          .eq('email', user.email)
          .maybeSingle();
        
        userData = userByEmail;
        error = emailError;
      }
      
      // Extract employee data from the joined query
      if (userData && userData.tenants_employee) {
        // Handle both array and single object responses
        const empData = Array.isArray(userData.tenants_employee) ? userData.tenants_employee[0] : userData.tenants_employee;
        
        if (empData) {
          // Set department
          const deptData = Array.isArray(empData.tenant_departement) ? empData.tenant_departement[0] : empData.tenant_departement;
          const deptName = deptData?.name || 'General';
          
          setEmployeeData({
            department: deptName,
            bonusRole: empData.bonuses_role || ''
          });
        }
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

  // Fetch recent changes
  const fetchRecentChanges = async () => {
    try {
      setLoadingChanges(true);
      
      // Fetch access logs
      const { data: accessLogs, error: accessError } = await supabase
        .from('access_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);

      // Fetch recent user changes with updated_by information
      const { data: userChanges, error: userError } = await supabase
        .from('users')
        .select(`
          id,
          email,
          first_name,
          full_name,
          updated_at,
          updated_by,
          users!updated_by(
            first_name,
            email
          )
        `)
        .not('updated_at', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(20);

      if (accessError) console.error('Error fetching access logs:', accessError);
      if (userError) console.error('Error fetching user changes:', userError);

      console.log('📊 Access logs:', accessLogs);
      console.log('👥 User changes:', userChanges);
      
      // Log first user change to inspect structure
      if (userChanges && userChanges.length > 0) {
        console.log('🔍 First user change structure:', userChanges[0]);
      }

      // Transform access logs
      const transformedAccessLogs: RecentChange[] = (accessLogs || []).map(log => ({
        id: log.id,
        type: 'access_log' as const,
        created_at: log.created_at,
        request_method: log.request_method,
        endpoint: log.endpoint,
        response_code: log.response_code
      }));

      // Transform user changes
      const transformedUserChanges: RecentChange[] = (userChanges || []).map(user => {
        // Handle the joined user data (which can be an array or single object)
        const updatedByUser = Array.isArray(user.users) ? user.users[0] : user.users;
        const change = {
          id: user.id,
          type: 'user_change' as const,
          created_at: user.updated_at || new Date().toISOString(),
          updated_at: user.updated_at,
          user_name: user.full_name || user.first_name || user.email,
          updated_by_name: updatedByUser?.first_name || updatedByUser?.email || 'System',
          action: 'User updated'
        };
        console.log('🔄 Transformed user change:', change);
        return change;
      });
      
      console.log('📋 Transformed user changes array:', transformedUserChanges);

      // Combine and sort by timestamp
      const combined = [...transformedAccessLogs, ...transformedUserChanges].sort((a, b) => 
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      ).slice(0, 20);

      console.log('✅ Combined recent changes:', combined);
      console.log('📊 User changes in combined:', combined.filter(c => c.type === 'user_change').length);
      console.log('📊 Access logs in combined:', combined.filter(c => c.type === 'access_log').length);
      setRecentChanges(combined);
    } catch (error) {
      console.error('Error fetching recent changes:', error);
    } finally {
      setLoadingChanges(false);
    }
  };

  // Fetch current user data on component mount
  useEffect(() => {
    fetchCurrentUser();
    fetchRecentChanges();
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

  // Helper to get role display name
  const getRoleDisplayName = (role: string | undefined): string => {
    if (!role) return '';
    const roleMap: { [key: string]: string } = {
      'pm': 'Project Manager',
      'se': 'Secretary',
      'dv': 'Developer',
      'dm': 'Department Manager',
      'b': 'Book Keeper',
      'f': 'Finance',
      'h': 'Handler',
      'e': 'Expert',
      'm': 'Manager',
      'l': 'Lawyer',
      'a': 'Administrator',
      's': 'Scheduler',
      'c': 'Coordinator',
      'p': 'Partner',
      'adv': 'Advocate',
      'advocate': 'Advocate',
      'handler': 'Handler',
      'expert': 'Expert',
      'manager': 'Manager',
      'lawyer': 'Lawyer',
      'admin': 'Administrator',
      'coordinator': 'Coordinator',
      'scheduler': 'Scheduler'
    };
    return roleMap[role.toLowerCase()] || role;
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/login');
  };

  return (
    <div className="flex h-screen bg-base-100 w-full overflow-hidden">
      {/* Left Sidebar - Desktop Tabs as Sidebar */}
      <aside 
        className="hidden md:flex flex-col bg-white border-r border-gray-200 shadow-lg fixed left-0 top-0 bottom-0 overflow-hidden transition-all duration-300 group"
        style={{ width: isSidebarCollapsed ? '64px' : '256px' }}
        onMouseEnter={() => setIsSidebarCollapsed(false)}
        onMouseLeave={() => setIsSidebarCollapsed(true)}
      >
        <div className={`border-b border-gray-200 flex-shrink-0 ${isSidebarCollapsed ? 'py-2' : 'py-4'} px-4`}>
          <h2 className={`text-xl font-bold text-gray-900 transition-opacity ${isSidebarCollapsed ? 'opacity-0 w-0 h-0' : 'opacity-100'}`}>
            {!isSidebarCollapsed && 'Admin Menu'}
          </h2>
          <div className={`absolute left-0 right-0 flex justify-center ${!isSidebarCollapsed ? 'hidden' : ''}`} style={{ top: '12px' }}>
            <span className="text-2xl font-bold text-gray-900">A</span>
          </div>
        </div>
        <div className={`flex-1 overflow-y-auto ${isSidebarCollapsed ? 'pt-16' : 'pt-2'}`}>
          {ADMIN_TABS.filter(tab => {
            const hasAccess = !tab.requiresAdmin || isAdmin;
            return hasAccess;
          }).map((tab, i) => {
            const Icon = tab.icon;
            return (
              <div key={tab.label} className="mb-2">
                <button
                  onClick={() => setOpenTab(openTab === i ? null : i)}
                  className={`w-full flex items-center ${isSidebarCollapsed ? 'justify-center' : 'justify-between'} p-3 mx-2 rounded-lg transition-all ${
                    openTab === i
                      ? 'bg-primary text-white shadow-md'
                      : isSidebarCollapsed 
                        ? 'hover:bg-gray-100 text-gray-900'
                        : 'hover:bg-gray-100 text-gray-900'
                  }`}
                >
                  {isSidebarCollapsed ? (
                    <Icon className="w-6 h-6" />
                  ) : (
                    <>
                      <span className="font-semibold">{tab.label}</span>
                      <ChevronDownIcon
                        className={`w-5 h-5 transition-transform ${openTab === i ? 'rotate-180' : ''}`}
                      />
                    </>
                  )}
                </button>
              {openTab === i && (
                <div className="mt-2 space-y-1 ml-6">
                  {tab.subcategories.map((sub, j) => (
                    <button
                      key={sub}
                      onClick={() => {
                        setSelected({ tab: i, sub: j });
                        setOpenTab(null);
                      }}
                      className={`w-full text-left px-4 py-2 rounded-lg transition-all ${
                        selected.tab === i && selected.sub === j
                          ? 'bg-primary/10 text-primary font-semibold'
                          : 'text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      {sub}
                    </button>
                  ))}
                </div>
              )}
            </div>
            );
          })}
        </div>
        
        {/* Footer with User Info and Logout */}
        <div className="p-4 border-t border-gray-200 flex-shrink-0 space-y-3">
          <div className={`space-y-1 ${isSidebarCollapsed ? 'hidden' : ''}`}>
            <div className="font-semibold text-gray-900">
              {currentUser?.first_name || currentUser?.email}
            </div>
            {employeeData?.bonusRole && (
              <div className="text-sm text-gray-600">{getRoleDisplayName(employeeData.bonusRole)}</div>
            )}
          </div>
          <button
            onClick={handleLogout}
            className={`w-full flex items-center ${isSidebarCollapsed ? 'justify-center' : 'justify-start'} p-2 rounded-lg transition-all hover:bg-red-50 text-red-600`}
          >
            <ArrowRightOnRectangleIcon className="w-5 h-5" />
            {!isSidebarCollapsed && <span className="ml-2 font-medium">Logout</span>}
          </button>
        </div>
      </aside>

      {/* Mobile Sidebar */}
      {isMobileSidebarOpen && (
        <div className="fixed inset-0 z-[10000] md:hidden">
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setIsMobileSidebarOpen(false)}
          />
          {/* Sidebar Panel */}
          <div className="absolute left-0 top-0 bottom-0 w-80 bg-white shadow-2xl overflow-y-auto">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-900">Admin Menu</h2>
              <button 
                onClick={() => setIsMobileSidebarOpen(false)}
                className="p-2 hover:bg-gray-100 rounded-lg"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4">
              {ADMIN_TABS.filter(tab => {
                const hasAccess = !tab.requiresAdmin || isAdmin;
                return hasAccess;
              }).map((tab, i) => (
                <div key={tab.label} className="mb-4">
                  <button
                    onClick={() => setOpenTab(openTab === i ? null : i)}
                    className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-gray-100 text-left font-semibold"
                  >
                    <span>{tab.label}</span>
                    <ChevronDownIcon
                      className={`w-5 h-5 transition-transform ${openTab === i ? 'rotate-180' : ''}`}
                    />
                  </button>
                  {openTab === i && (
                    <div className="mt-2 space-y-1">
                      {tab.subcategories.map((sub, j) => (
                        <button
                          key={sub}
                          onClick={() => {
                            setSelected({ tab: i, sub: j });
                            setOpenTab(null);
                            setIsMobileSidebarOpen(false);
                          }}
                          className="w-full text-left px-4 py-2 rounded-lg hover:bg-primary/10 text-sm"
                        >
                          {sub}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Mobile Menu Button */}
      <button
        onClick={() => setIsMobileSidebarOpen(true)}
        className="md:hidden fixed bottom-6 right-6 z-50 p-4 bg-primary text-white rounded-full shadow-lg hover:shadow-xl transition-all"
      >
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Main Content Area */}
      <div 
        className="flex-1 overflow-y-auto p-4 md:p-6 transition-all duration-300"
        style={{ marginLeft: window.innerWidth >= 768 ? (isSidebarCollapsed ? '64px' : '256px') : '0' }}
      >
      {/* Welcome Section */}
      <div className={`mb-12 transition-all duration-500 ease-in-out overflow-hidden ${
        isTopSectionCollapsed ? 'max-h-0 mb-0' : 'max-h-screen'
      }`}>
        <div className="text-center py-8">
          <h1 className="text-4xl md:text-4xl lg:text-5xl font-bold mb-4 leading-tight" style={{ color: '#4218CC' }}>
            {getTimeBasedGreeting()}{currentUser?.first_name ? `, ${currentUser.first_name}` : ''}!
          </h1>
          <p className="text-xl md:text-xl lg:text-2xl font-medium mb-8" style={{ color: '#4218CC' }}>Welcome to your CRM Admin Panel</p>
        </div>
        
        {/* Quick Action Buttons */}
        <div className={`flex md:grid md:grid-cols-2 lg:grid-cols-5 gap-6 max-w-6xl mx-auto transition-all duration-500 ease-in-out overflow-x-auto scrollbar-hide pb-2 md:pb-0 ${
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
            className="flex-shrink-0 rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl shadow-xl bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white relative overflow-hidden p-6 h-32 w-64 md:w-auto"
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
            className="flex-shrink-0 rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl shadow-xl bg-gradient-to-tr from-purple-600 via-blue-600 to-blue-500 text-white relative overflow-hidden p-6 h-32 w-64 md:w-auto"
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
            className="flex-shrink-0 rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl shadow-xl bg-gradient-to-tr from-blue-500 via-cyan-500 to-teal-400 text-white relative overflow-hidden p-6 h-32 w-64 md:w-auto"
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
            className="flex-shrink-0 rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl shadow-xl bg-gradient-to-tr from-[#4b2996] via-[#6c4edb] to-[#3b28c7] text-white relative overflow-hidden p-6 h-32 w-64 md:w-auto"
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
            className="flex-shrink-0 rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl shadow-xl bg-gradient-to-tr from-teal-400 via-green-400 to-green-600 text-white relative overflow-hidden p-6 h-32 w-64 md:w-auto"
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

      {/* Recent Changes Section - Only show when no specific content is selected */}
      {selected.tab === null && selected.sub === null && (
        <div className="w-full mt-8 px-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* User Changes */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                <svg className="w-6 h-6 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                User Changes
              </h3>
              {loadingChanges ? (
                <div className="flex justify-center items-center py-8">
                  <div className="loading loading-spinner loading-lg text-success"></div>
                </div>
              ) : (() => {
                const userChangeCount = recentChanges.filter(c => c.type === 'user_change').length;
                console.log('👥 User changes count:', userChangeCount);
                return userChangeCount > 0;
              })() ? (
                <div className="overflow-x-auto">
                  <table className="table table-sm w-full">
                    <thead>
                      <tr>
                        <th className="text-gray-900 font-semibold">User</th>
                        <th className="text-gray-900 font-semibold">Updated By</th>
                        <th className="text-gray-900 font-semibold">Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentChanges.filter(c => c.type === 'user_change').map((change) => (
                        <tr key={`${change.type}-${change.id}`}>
                          <td>
                            <div className="font-medium text-gray-900">{change.user_name}</div>
                          </td>
                          <td>
                            <div className="text-sm text-gray-600">
                              {change.updated_by_name || 'System'}
                            </div>
                          </td>
                          <td>
                            <div className="text-xs text-gray-500">
                              {new Date(change.created_at).toLocaleString()}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  No user changes found
                </div>
              )}
            </div>

            {/* Access Logs */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                <svg className="w-6 h-6 text-info" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                API Requests
              </h3>
              {loadingChanges ? (
                <div className="flex justify-center items-center py-8">
                  <div className="loading loading-spinner loading-lg text-info"></div>
                </div>
              ) : recentChanges.filter(c => c.type === 'access_log').length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="table table-sm w-full">
                    <thead>
                      <tr>
                        <th className="text-gray-900 font-semibold">Method</th>
                        <th className="text-gray-900 font-semibold">Endpoint</th>
                        <th className="text-gray-900 font-semibold">Status</th>
                        <th className="text-gray-900 font-semibold">Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentChanges.filter(c => c.type === 'access_log').map((change) => (
                        <tr key={`${change.type}-${change.id}`}>
                          <td>
                            <span className={`badge badge-sm ${
                              change.request_method === 'GET' ? 'badge-success' :
                              change.request_method === 'POST' ? 'badge-primary' :
                              change.request_method === 'PUT' ? 'badge-warning' :
                              change.request_method === 'DELETE' ? 'badge-error' :
                              'badge-neutral'
                            }`}>
                              {change.request_method}
                            </span>
                          </td>
                          <td>
                            <div className="text-xs text-gray-700 truncate max-w-xs" title={change.endpoint}>
                              {change.endpoint}
                            </div>
                          </td>
                          <td>
                            <span className={`badge badge-sm ${
                              change.response_code && change.response_code >= 200 && change.response_code < 300 ? 'badge-success' :
                              change.response_code && change.response_code >= 400 && change.response_code < 500 ? 'badge-warning' :
                              change.response_code && change.response_code >= 500 ? 'badge-error' :
                              'badge-neutral'
                            }`}>
                              {change.response_code}
                            </span>
                          </td>
                          <td>
                            <div className="text-xs text-gray-500">
                              {new Date(change.created_at).toLocaleString()}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  No API requests found
                </div>
              )}
            </div>
          </div>
        </div>
      )}

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


        {/* Content Area */}
        <div className="bg-base-100 rounded-xl shadow p-4 md:p-8 min-h-[200px] mt-4 md:mt-8">
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
        ) : null}
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
    </div>
  );
};

export default AdminPage; 