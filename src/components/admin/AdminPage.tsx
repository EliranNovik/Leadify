import React, { useState, useRef, useEffect, useMemo } from 'react';
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
  ChatBubbleLeftRightIcon,
  MagnifyingGlassIcon,
  ChevronDoubleRightIcon,
  ChevronDoubleLeftIcon
} from '@heroicons/react/24/outline';
import ContractTemplatesManager from './ContractTemplatesManager';
import UsersManager from './UsersManager';
// import PaymentPlanRowsManager from './PaymentPlanRowsManager';
import PaymentPlansManager from './PaymentPlansManager';
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
import EmailTemplatesManager from './EmailTemplatesManager';
import EmailTemplatesPlacementManager from './EmailTemplatesPlacementManager';
import PublicMessagesManager from './PublicMessagesManager';
import WebhookSettingsManager from './WebhookSettingsManager';
import EmployeeFieldAssignmentsManager from './EmployeeFieldAssignmentsManager';
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
    subcategories: [/* 'Payment plan rows', */ 'Payment Plans'],
    requiresAdmin: true,
  },
  {
    label: 'Hooks',
    icon: LinkIcon,
    subcategories: ['Access Logs', 'Settings'],
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
      'Bonus formulas', 'Contract templates', 'Countries', 'Email Templates', 'Email Templates Placement', 'Holidays', 'Languages', 'Lead Stage Reasons', 'Lead Sources', 'Lead Tags', 'Main Categories', 'Public messages', 'sub categories', 'whatsapp template olds'
    ],
    requiresAdmin: false, // Everyone can access Misc
  },
  {
    label: 'Tenants',
    icon: BuildingOffice2Icon,
    subcategories: ['Bank accounts', 'Departements', 'Employees', 'Employee Field Assignments', 'Firms', 'Meeting Locations'],
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
  info?: string;
  bodyRequest?: string;
};

interface AdminSectionOption {
  key: string;
  tabIndex: number;
  subIndex: number;
  tabLabel: string;
  subLabel: string;
  searchText: string;
}

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
  const [isSuperUser, setIsSuperUser] = useState<boolean>(false);
  const [isTopSectionCollapsed, setIsTopSectionCollapsed] = useState(false);
  const [dropdownPositions, setDropdownPositions] = useState<{ [key: number]: 'left' | 'right' }>({});
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  // State for sidebar collapse and employee data
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [employeeData, setEmployeeData] = useState<{
    department?: string;
    bonusRole?: string;
  } | null>(null);

  // State for recent changes
  const [recentChanges, setRecentChanges] = useState<RecentChange[]>([]);
  const [loadingChanges, setLoadingChanges] = useState(false);

  // Search navigation state
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const searchBoxRef = useRef<HTMLDivElement>(null);

  const availableSections = useMemo<AdminSectionOption[]>(() => {
    const filteredTabs = ADMIN_TABS.filter(tab => !tab.requiresAdmin || isAdmin);
    return filteredTabs.flatMap((tab, filteredTabIndex) => {
      return tab.subcategories.map((sub, subIndex) => ({
        key: `${tab.label}-${sub}`,
        tabIndex: filteredTabIndex,
        subIndex,
        tabLabel: tab.label,
        subLabel: sub,
        searchText: `${tab.label} ${sub}`.toLowerCase()
      }));
    });
  }, [isAdmin]);

  const filteredSections = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return availableSections.slice(0, 8);
    }
    return availableSections.filter(section => section.searchText.includes(query)).slice(0, 10);
  }, [searchQuery, availableSections]);

  const handleSearchSelect = (section: AdminSectionOption) => {
    setSelected({ tab: section.tabIndex, sub: section.subIndex });
    setOpenTab(null);
    setIsTopSectionCollapsed(true);
    setSearchQuery('');
    setIsSearchFocused(false);
    setIsMobileSidebarOpen(false);
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && filteredSections.length > 0) {
      event.preventDefault();
      handleSearchSelect(filteredSections[0]);
    }
    if (event.key === 'Escape') {
      setIsSearchFocused(false);
      setSearchQuery('');
    }
  };

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
      if (isSearchFocused && searchBoxRef.current && !searchBoxRef.current.contains(event.target as Node)) {
        setIsSearchFocused(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [openTab, isSearchFocused]);

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
          is_superuser,
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
            is_superuser,
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
        // Set superuser status
        setIsSuperUser(userData.is_superuser === true || userData.is_superuser === 'true' || userData.is_superuser === 1);
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

      // Fetch user change history entries
      const { data: userHistory, error: historyError } = await supabase
        .from('user_changes_history')
        .select('id, user_id, changed_by, field_name, old_value, new_value, changed_at')
        .order('changed_at', { ascending: false })
        .limit(40);

      if (accessError) console.error('Error fetching access logs:', accessError);
      if (historyError) console.error('Error fetching user history:', historyError);

      console.log('📊 Access logs:', accessLogs);
      console.log('🗂️ User change history:', userHistory);
      if (userHistory && userHistory.length > 0) {
        console.log('🔍 First history entry:', userHistory[0]);
      }

      const userIdSet = new Set<string>();
      (userHistory || []).forEach(entry => {
        if (entry.user_id) userIdSet.add(String(entry.user_id));
        if (entry.changed_by) userIdSet.add(String(entry.changed_by));
      });

      const userLookup = new Map<string, { full_name?: string; first_name?: string; last_name?: string; email?: string }>();
      if (userIdSet.size > 0) {
        const { data: userRecords, error: lookupError } = await supabase
          .from('users')
          .select('id, full_name, first_name, last_name, email')
          .in('id', Array.from(userIdSet));
        if (lookupError) {
          console.error('Error fetching user lookup data:', lookupError);
        } else {
          (userRecords || []).forEach(record => {
            userLookup.set(String(record.id), {
              full_name: record.full_name,
              first_name: record.first_name,
              last_name: (record as any).last_name,
              email: record.email,
            });
          });
        }
      }

      const getUserDisplayName = (userId?: string | number | null) => {
        if (!userId) return 'System';
        const entry = userLookup.get(String(userId));
        if (!entry) return 'System';
        return (
          entry.full_name ||
          [entry.first_name, entry.last_name].filter(Boolean).join(' ').trim() ||
          entry.email ||
          'System'
        );
      };

      const filteredAccessLogs = (accessLogs || []).filter(log => log.endpoint && log.endpoint.includes('/api/hook/catch'));
      console.log('📊 Access logs (filtered):', filteredAccessLogs);

      const transformedAccessLogs: RecentChange[] = filteredAccessLogs.map(log => {
        let info = '';
        let bodyRequest = '';
        if (log.request_body) {
          try {
            const parsed = JSON.parse(log.request_body);
            if (parsed && typeof parsed === 'object') {
              const entries = Object.entries(parsed).map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`);
              info = entries.join(' | ');
              const bodyEntries: string[] = [];
              if ('topic' in parsed) bodyEntries.push(`topic: ${parsed.topic}`);
              if ('source' in parsed) bodyEntries.push(`source: ${parsed.source}`);
              if ('email' in parsed) bodyEntries.push(`email: ${parsed.email}`);
              if (bodyEntries.length === 0 && Array.isArray(parsed)) {
                parsed.forEach((item: any, idx: number) => {
                  if (item && typeof item === 'object') {
                    ['topic', 'source', 'email'].forEach(field => {
                      if (field in item) bodyEntries.push(`${field}[${idx}]: ${item[field]}`);
                    });
                  }
                });
              }
              bodyRequest = bodyEntries.join(' | ');
            } else {
              info = String(log.request_body);
              bodyRequest = info;
            }
          } catch (error) {
            console.error('Failed to parse access log body:', error);
            info = String(log.request_body);
            bodyRequest = info;
          }
        }

        return {
          id: log.id,
          type: 'access_log' as const,
          created_at: log.created_at,
          request_method: log.request_method,
          endpoint: log.endpoint,
          response_code: log.response_code,
          info,
          bodyRequest,
        };
      });

      const historyByChange = new Map<string, { user_id: string | null; changed_by: string | null; changed_at: string | null; fields: Array<{ field: string; oldValue: any; newValue: any }> }>();
      (userHistory || []).forEach(entry => {
        const key = `${entry.user_id || 'unknown'}-${entry.changed_at || entry.id}`;
        if (!historyByChange.has(key)) {
          historyByChange.set(key, {
            user_id: entry.user_id ? String(entry.user_id) : null,
            changed_by: entry.changed_by ? String(entry.changed_by) : null,
            changed_at: entry.changed_at || null,
            fields: [],
          });
        }
        historyByChange.get(key)?.fields.push({
          field: entry.field_name,
          oldValue: entry.field_name === 'password' ? '•••••' : entry.old_value,
          newValue: entry.field_name === 'password' ? '•••••' : entry.new_value,
        });
      });

      const transformedUserChanges: RecentChange[] = Array.from(historyByChange.values()).map(entry => {
        const infoParts = entry.fields.map(({ field, oldValue, newValue }) => {
          const titleField = toTitleCase(field);
          const displayOld = oldValue === null || oldValue === undefined || oldValue === '' ? 'Empty' : oldValue;
          const displayNew = newValue === null || newValue === undefined || newValue === '' ? 'Empty' : newValue;
          return `${titleField}: ${displayOld} → ${displayNew}`;
        });
        if (infoParts.length === 0) infoParts.push('No field changes recorded');

        return {
          id: `history-${entry.user_id || 'unknown'}-${entry.changed_at || Date.now()}`,
          type: 'user_change' as const,
          created_at: entry.changed_at || new Date().toISOString(),
          user_name: getUserDisplayName(entry.user_id),
          updated_by_name: getUserDisplayName(entry.changed_by),
          action: 'User updated',
          info: infoParts.join(' | '),
        };
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

  const toTitleCase = (value: string) =>
    value
      .split('_')
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');

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
      'c': 'Closer',
      'p': 'Partner',
      'adv': 'Advocate',
      'advocate': 'Advocate',
      'handler': 'Handler',
      'expert': 'Expert',
      'manager': 'Manager',
      'lawyer': 'Lawyer',
      'admin': 'Administrator',
      'scheduler': 'Scheduler'
    };
    return roleMap[role.toLowerCase()] || role;
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/login');
  };

  // If user is not a superuser, show limited view
  if (!isSuperUser) {
    return (
      <div className="min-h-screen bg-base-100 w-full overflow-y-auto">
        <div className="w-full max-w-[95%] mx-auto px-4 py-8">
          {/* Welcome Section */}
          <div className="text-center py-8 mb-12">
            <h1 className="text-4xl md:text-4xl lg:text-5xl font-bold mb-4 leading-tight" style={{ color: '#4218CC' }}>
              {getTimeBasedGreeting()}{currentUser?.first_name ? `, ${currentUser.first_name}` : ''}!
            </h1>
            <p className="text-xl md:text-xl lg:text-2xl font-medium mb-8" style={{ color: '#4218CC' }}>Welcome to your CRM Admin Panel</p>
          </div>

          {/* Limited Access Boxes */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
            {/* Email Templates Box */}
            <button
              onClick={() => {
                const miscTab = ADMIN_TABS.findIndex(tab => tab.label === 'Misc');
                const emailTemplatesSub = ADMIN_TABS[miscTab]?.subcategories.findIndex(sub => sub === 'Email Templates');
                setSelected({ tab: miscTab, sub: emailTemplatesSub || 0 });
              }}
              className="rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl shadow-xl bg-gradient-to-tr from-purple-600 via-blue-600 to-blue-500 text-white relative overflow-hidden p-8 h-48"
            >
              <div className="flex items-center gap-4">
                <div className="flex items-center justify-center w-16 h-16 rounded-full bg-white/20 shadow">
                  <svg className="w-8 h-8 text-white opacity-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <div>
                  <div className="text-3xl font-extrabold text-white leading-tight">Email Templates</div>
                  <div className="text-white/80 text-sm font-medium mt-2">Manage email templates</div>
                </div>
              </div>
            </button>

            {/* Public Messages Box */}
            <button
              onClick={() => {
                const miscTab = ADMIN_TABS.findIndex(tab => tab.label === 'Misc');
                const publicMessagesSub = ADMIN_TABS[miscTab]?.subcategories.findIndex(sub => sub === 'Public messages');
                setSelected({ tab: miscTab, sub: publicMessagesSub || 0 });
              }}
              className="rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl shadow-xl bg-gradient-to-tr from-blue-500 via-cyan-500 to-teal-400 text-white relative overflow-hidden p-8 h-48"
            >
              <div className="flex items-center gap-4">
                <div className="flex items-center justify-center w-16 h-16 rounded-full bg-white/20 shadow">
                  <svg className="w-8 h-8 text-white opacity-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                  </svg>
                </div>
                <div>
                  <div className="text-3xl font-extrabold text-white leading-tight">Public Messages</div>
                  <div className="text-white/80 text-sm font-medium mt-2">Manage public messages</div>
                </div>
              </div>
            </button>
          </div>

          {/* Content Area for selected items */}
          {selected.tab !== null && selected.sub !== null && (
            <div className="w-full mt-8">
              {(() => {
                const miscTab = ADMIN_TABS.findIndex(tab => tab.label === 'Misc');
                const selectedTab = ADMIN_TABS[selected.tab];
                const selectedSub = selectedTab?.subcategories[selected.sub];

                if (selectedSub === 'Email Templates') {
                  return <div className="w-full"><EmailTemplatesManager isSuperUser={isSuperUser} /></div>;
                } else if (selectedSub === 'Public messages') {
                  return <div className="w-full"><PublicMessagesManager /></div>;
                }
                return null;
              })()}
            </div>
          )}

          {/* Logout Button */}
          <div className="flex justify-center mt-8">
            <button
              onClick={handleLogout}
              className="btn btn-outline btn-error"
            >
              <ArrowRightOnRectangleIcon className="w-5 h-5 mr-2" />
              Logout
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-base-100 w-full overflow-hidden">
      {/* Desktop Sidebar Overlay */}
      {isSidebarOpen && (
        <div className="fixed inset-0 z-[10000] hidden md:flex">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setIsSidebarOpen(false)}
          />
          {/* Sidebar Panel */}
          <aside className="relative w-80 bg-white shadow-2xl overflow-y-auto">
            <div className="border-b border-gray-200 flex-shrink-0 px-4 py-3 flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-900">Admin Menu</h2>
              <button
                onClick={() => setIsSidebarOpen(false)}
                className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                title="Close sidebar"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto pt-2">
              {ADMIN_TABS.filter(tab => {
                const hasAccess = !tab.requiresAdmin || isAdmin;
                return hasAccess;
              }).map((tab, i) => {
                const Icon = tab.icon;
                return (
                  <div key={tab.label} className="mb-2">
                    <button
                      onClick={() => setOpenTab(openTab === i ? null : i)}
                      className={`w-full flex items-center justify-between p-3 mx-2 rounded-lg transition-all ${openTab === i
                          ? 'bg-primary text-white shadow-md'
                          : 'hover:bg-gray-100 text-gray-900'
                        }`}
                    >
                      <div className="flex items-center gap-3">
                        <Icon className="w-6 h-6" />
                        <span className="font-semibold">{tab.label}</span>
                      </div>
                      <ChevronDownIcon
                        className={`w-5 h-5 transition-transform ${openTab === i ? 'rotate-180' : ''}`}
                      />
                    </button>
                    {openTab === i && (
                      <div className="mt-2 space-y-1 ml-6">
                        {tab.subcategories.map((sub, j) => (
                          <button
                            key={sub}
                            onClick={() => {
                              setSelected({ tab: i, sub: j });
                              setOpenTab(null);
                              setIsSidebarOpen(false);
                            }}
                            className={`w-full text-left px-4 py-2 rounded-lg transition-all ${selected.tab === i && selected.sub === j
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
              <div className="space-y-1">
                <div className="font-semibold text-gray-900">
                  {currentUser?.first_name || currentUser?.email}
                </div>
                {employeeData?.bonusRole && (
                  <div className="text-sm text-gray-600">{getRoleDisplayName(employeeData.bonusRole)}</div>
                )}
              </div>
              <button
                onClick={handleLogout}
                className="w-full flex items-center justify-start p-2 rounded-lg transition-all hover:bg-red-50 text-red-600"
              >
                <ArrowRightOnRectangleIcon className="w-5 h-5" />
                <span className="ml-2 font-medium">Logout</span>
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Desktop Menu Button */}
      <button
        onClick={() => setIsSidebarOpen(true)}
        className="hidden md:block fixed top-1/2 -translate-y-1/2 left-6 z-50 p-3 bg-primary text-white rounded-full shadow-lg hover:shadow-xl transition-all hover:scale-105"
        title="Open menu"
      >
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

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
        className="flex-1 overflow-y-auto px-2 sm:px-3 md:px-6 py-4 md:py-6 transition-all duration-300"
      >
        {/* Admin Search */}
        <div className="max-w-3xl mx-auto mb-8 w-full" ref={searchBoxRef}>
          <div className="relative">
            <MagnifyingGlassIcon className="w-6 h-6 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              className="input input-bordered w-full pl-12 pr-4 py-3 text-base md:text-lg shadow-sm focus:shadow-md transition-all"
              placeholder="Search admin sections…"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setIsSearchFocused(true);
              }}
              onFocus={() => setIsSearchFocused(true)}
              onKeyDown={handleSearchKeyDown}
            />
          </div>
          {isSearchFocused && (
            <div className="relative">
              <div className="absolute z-20 w-full bg-base-100 border border-base-200 rounded-2xl shadow-2xl mt-2 max-h-80 overflow-y-auto">
                {filteredSections.length > 0 ? (
                  filteredSections.map((section) => (
                    <button
                      key={section.key}
                      onClick={() => handleSearchSelect(section)}
                      className="w-full text-left px-4 py-3 hover:bg-primary/5 flex items-center justify-between gap-4"
                    >
                      <div>
                        <p className="font-semibold text-gray-900">{section.subLabel}</p>
                        <p className="text-xs text-gray-500">{section.tabLabel}</p>
                      </div>
                      <span className="text-xs text-gray-400">Enter ↵</span>
                    </button>
                  ))
                ) : (
                  <div className="px-4 py-4 text-sm text-gray-500">
                    No matching admin sections
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        {/* Welcome Section */}
        <div className={`mb-12 transition-all duration-500 ease-in-out overflow-hidden ${isTopSectionCollapsed ? 'max-h-0 mb-0' : 'max-h-screen'
          }`}>
          <div className="text-center py-8">
            <h1 className="text-4xl md:text-4xl lg:text-5xl font-bold mb-4 leading-tight" style={{ color: '#4218CC' }}>
              {getTimeBasedGreeting()}{currentUser?.first_name ? `, ${currentUser.first_name}` : ''}!
            </h1>
            <p className="text-xl md:text-xl lg:text-2xl font-medium mb-8" style={{ color: '#4218CC' }}>Welcome to your CRM Admin Panel</p>
          </div>

          {/* Quick Action Buttons */}
          <div className={`flex md:grid md:grid-cols-2 lg:grid-cols-5 gap-6 max-w-6xl mx-auto transition-all duration-500 ease-in-out overflow-x-auto scrollbar-hide pb-2 md:pb-0 ${isTopSectionCollapsed ? 'opacity-0 max-h-0 overflow-hidden' : 'opacity-100 max-h-screen'
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
              <svg className="absolute bottom-2 right-2 w-12 h-8 opacity-40" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 48 32"><rect x="2" y="20" width="4" height="10" /><rect x="10" y="10" width="4" height="20" /><rect x="18" y="16" width="4" height="14" /><rect x="26" y="6" width="4" height="24" /><rect x="34" y="14" width="4" height="16" /></svg>
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
              <svg className="absolute bottom-2 right-2 w-12 h-8 opacity-40" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 48 32"><rect x="2" y="8" width="4" height="16" /><rect x="8" y="12" width="4" height="12" /><rect x="14" y="6" width="4" height="18" /><rect x="20" y="10" width="4" height="14" /><rect x="26" y="14" width="4" height="10" /><rect x="32" y="4" width="4" height="20" /><rect x="38" y="8" width="4" height="16" /></svg>
            </button>
          </div>
        </div>

        {/* Recent Changes Section - Only show when no specific content is selected */}
        {selected.tab === null && selected.sub === null && (
          <div className="w-full mt-8 px-2 sm:px-3 md:px-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* User Changes */}
              <div className="rounded-xl p-6">
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
                    <table className="table w-full">
                      <thead>
                        <tr>
                          <th className="text-gray-900 font-semibold">User</th>
                          <th className="text-gray-900 font-semibold">Updated By</th>
                          <th className="text-gray-900 font-semibold">Info</th>
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
                              <div className="text-xs text-gray-600 break-words max-w-md">
                                {change.info || '—'}
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
              <div className="rounded-xl p-6">
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
                    <table className="table w-full">
                      <thead>
                        <tr>
                          <th className="text-gray-900 font-semibold">Method</th>
                          <th className="text-gray-900 font-semibold">Endpoint</th>
                          <th className="text-gray-900 font-semibold">Body</th>
                          <th className="text-gray-900 font-semibold">Status</th>
                          <th className="text-gray-900 font-semibold">Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recentChanges.filter(c => c.type === 'access_log').map((change) => (
                          <tr key={`${change.type}-${change.id}`}>
                            <td>
                              <span className="text-xs sm:text-sm font-medium text-gray-700">
                                {change.request_method}
                              </span>
                            </td>
                            <td>
                              <div className="text-xs text-gray-700 truncate max-w-xs" title={change.endpoint}>
                                {change.endpoint}
                              </div>
                            </td>
                            <td>
                              <div className="text-xs text-gray-600 break-words max-w-xs">
                                {change.bodyRequest && change.bodyRequest.trim() !== '' ? change.bodyRequest : '—'}
                              </div>
                            </td>
                            <td>
                              <span className="text-xs sm:text-sm font-medium text-gray-700">
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
            className={`fixed top-20 right-4 md:right-8 z-50 p-2 md:p-3 rounded-full shadow-lg transition-all duration-300 transform hover:scale-110 ${isTopSectionCollapsed
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
        <div className="min-h-[200px] mt-4 md:mt-8">
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
              ) : /* selectedTab?.label === 'Finances' &&
            selectedTab?.subcategories[selected.sub] === 'Payment plan rows' ? (
              <div className="w-full"><PaymentPlanRowsManager /></div>
            ) : */ selectedTab?.label === 'Finances' &&
                  selectedTab?.subcategories[selected.sub] === 'Payment Plans' ? (
                  <div className="w-full"><PaymentPlansManager /></div>
                ) : selectedTab?.label === 'Hooks' &&
                  selectedTab?.subcategories[selected.sub] === 'Access Logs' ? (
                  <div className="w-full"><AccessLogsManager /></div>
                ) : selectedTab?.label === 'Hooks' &&
                  selectedTab?.subcategories[selected.sub] === 'Settings' ? (
                  <div className="w-full"><WebhookSettingsManager /></div>
                ) : selectedTab?.label === 'Accounting' &&
                  selectedTab?.subcategories[selected.sub] === 'Currencies' ? (
                  <div className="w-full"><CurrenciesManager /></div>
                ) : selectedTab?.label === 'Tenants' &&
                  selectedTab?.subcategories[selected.sub] === 'Departements' ? (
                  <div className="w-full"><DepartmentsManager /></div>
                ) : selectedTab?.label === 'Tenants' &&
                  selectedTab?.subcategories[selected.sub] === 'Employees' ? (
                  <div className="w-full"><EmployeesManager /></div>
                ) : selectedTab?.label === 'Tenants' &&
                  selectedTab?.subcategories[selected.sub] === 'Employee Field Assignments' ? (
                  <div className="w-full"><EmployeeFieldAssignmentsManager /></div>
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
                  selectedTab?.subcategories[selected.sub] === 'Email Templates' ? (
                  <div className="w-full"><EmailTemplatesManager isSuperUser={isSuperUser} /></div>
                ) : selectedTab?.label === 'Misc' &&
                  selectedTab?.subcategories[selected.sub] === 'Email Templates Placement' ? (
                  <div className="w-full"><EmailTemplatesPlacementManager /></div>
                ) : selectedTab?.label === 'Misc' &&
                  selectedTab?.subcategories[selected.sub] === 'Public messages' ? (
                  <div className="w-full"><PublicMessagesManager /></div>
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